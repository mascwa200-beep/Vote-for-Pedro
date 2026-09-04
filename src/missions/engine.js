// Mission state machine.
//
// An episode is a graph of stages. Each stage offers choices; a choice can be
// gated on skills, standing, ledger flags, or crew who are still alive. Every
// terminal stage writes to the ledger, which is what makes an episode's
// outcome outlive the episode.

import { emit } from '../core/events.js';

export class Mission {
  /**
   * @param {object} def episode definition
   * @param {object} ctx { game }
   */
  constructor(def, ctx) {
    this.def = def;
    this.ctx = ctx;
    this.id = def.id;
    this.stageId = def.start;
    this.history = [];
    this.vars = { ...(def.vars ?? {}) };
    this.complete = false;
    this.outcome = null;
  }

  get stage() {
    return this.def.stages[this.stageId];
  }

  get title() { return this.def.title; }

  /**
   * Where a stage happens.
   *
   * An episode declares the system it is set in. A stage inherits that unless
   * it says otherwise: `system: 'alpha_centauri'` moves it, and
   * `system: null` means it happens wherever the ship is — a conversation in
   * the ready room, a decision about a report, an argument with a first
   * officer.
   *
   * The key is `system` and NOT `where`, which is already taken and means
   * something else entirely: the ROOM aboard ship a stage happens in, read by
   * `stageIsHere` in the UI. Reusing it made the mission panel announce that
   * they were waiting for the captain "in alpha_centauri" as though a star
   * system were a compartment.
   *
   * Before this, nothing anywhere read the location. An episode set at Cestus
   * III could be started, advanced and finished from Sol, which made the
   * destination you flew to decoration and the galaxy a menu.
   */
  stageLocation(stage = this.stage) {
    if (stage && Object.prototype.hasOwnProperty.call(stage, 'system')) return stage.system;
    return this.def.system ?? null;
  }

  /**
   * Is the ship where this stage happens?
   *
   * @returns {{ok: boolean, reason?: string, need?: string}}
   */
  testLocation(stage = this.stage) {
    const need = this.stageLocation(stage);
    if (!need) return { ok: true };
    const at = this.ctx.game?.locationId;
    // A game with no location at all — a test harness, a half-built state —
    // is not somewhere else, it is nowhere, and refusing every choice there
    // would strand a caller who never asked to be gated.
    if (!at) return { ok: true };
    if (at === need) return { ok: true };
    const name = this.ctx.game?.galaxy?.get?.(need)?.name ?? need;
    return { ok: false, need, reason: `We would have to be at ${name}, Captain.` };
  }

  /** Choices the player can currently take, with locked ones explained. */
  choices() {
    const stage = this.stage;
    if (!stage?.choices) return [];
    // The whole stage is somewhere, so this is tested once rather than per
    // choice — every choice at a stage happens in the same place.
    const here = this.testLocation(stage);
    return stage.choices
      .filter((c) => !c.hidden || this.test(c.hidden) === false)
      .map((c) => {
        const gate = c.requires ? this.testRequirement(c.requires) : { ok: true };
        if (!here.ok) return { ...c, locked: true, lockReason: here.reason };
        return { ...c, locked: !gate.ok, lockReason: gate.reason };
      });
  }

  testRequirement(req) {
    const g = this.ctx.game;
    if (req.skill) {
      const have = g.progress.ranksIn(req.skill);
      if (have < (req.ranks ?? 1)) {
        return { ok: false, reason: `Requires ${req.skill.replace(/_/g, ' ')} ${req.ranks ?? 1}` };
      }
    }
    if (req.standing) {
      for (const [faction, min] of Object.entries(req.standing)) {
        if (g.ledger.standingOf(faction) < min) {
          return { ok: false, reason: `Requires better standing with the ${faction}` };
        }
      }
    }
    if (req.flag && !g.ledger.has(req.flag)) {
      return { ok: false, reason: 'Not yet available' };
    }
    if (req.notFlag && g.ledger.has(req.notFlag)) {
      return { ok: false, reason: 'No longer possible' };
    }
    if (req.officer) {
      const o = g.crew.at(req.officer);
      if (!o) return { ok: false, reason: `Requires a living ${req.officer.replace(/_/g, ' ')}` };
    }
    if (req.var) {
      for (const [k, v] of Object.entries(req.var)) {
        if (this.vars[k] !== v) return { ok: false, reason: 'Not available' };
      }
    }
    if (req.torpedoes && g.ship.torpedoes < req.torpedoes) {
      return { ok: false, reason: `Requires ${req.torpedoes} torpedoes` };
    }
    return { ok: true };
  }

  test(cond) {
    return this.testRequirement(cond).ok;
  }

  /**
   * Take a choice. Runs its effects and moves to the next stage.
   * @returns {object} { stage, effects }
   */
  choose(choiceId) {
    const choice = this.choices().find((c) => c.id === choiceId);
    if (!choice || choice.locked) return null;

    this.history.push({ stageId: this.stageId, choiceId });
    // A choice that starts a fight does not get to pay for it yet.
    //
    // `applyEffects` ran the experience, the standing and the ledger record
    // before the shooting started, and a terminal choice then called `finish`
    // in the same breath — so "Hold position" at Organia banked the reward for
    // holding, and "Fight it" paid out for beating a Borg cube, before either
    // fight had begun. You could take the money and run, and the episode was
    // already recorded as won.
    const startsFight = !!choice.effects?.combat;
    const applied = this.applyEffects(choice.effects ?? {}, { hold: startsFight });

    // A choice can branch on a resolved check.
    let nextId = choice.next;
    if (typeof nextId === 'function') nextId = nextId(this, applied);
    if (choice.branch) {
      nextId = applied.success ? choice.branch.success : choice.branch.failure;
    }

    emit('mission:choice', { mission: this, choice, applied });

    if (startsFight) {
      // Settled by `settleCombat` when the engagement resolves.
      this.pending = {
        held: applied.held ?? {},
        outcome: choice.outcome ?? applied.outcome ?? 'complete',
        terminal: !nextId || !this.def.stages[nextId],
        // And WHO is coming, so the fight can be ordered again after a reload.
        //
        // Two halves are set when a stage orders a battle: this mark, which
        // says a reward is being held, and `game.pendingCombat`, which holds
        // the ships. `update` turns the second into an engagement one tick
        // later. Only the first was ever saved — this one is restored on load
        // deliberately, "dropping it would strand the episode on a stage it can
        // never leave" — so a save taken inside that one-tick window kept the
        // half that waits and dropped the half that arrives, and the episode
        // waited for a battle that was never coming.
        //
        // The spec is the episode's own plain data, so carrying it here costs a
        // faction and a list of class ids, and lets `Game.load` re-order the
        // fight for records already written that way.
        combat: choice.effects?.combat ?? null,
      };
    }

    if (!startsFight && (!nextId || !this.def.stages[nextId])) {
      return this.finish(choice.outcome ?? applied.outcome ?? 'complete', applied);
    }

    if (!nextId || !this.def.stages[nextId]) {
      // A terminal fight: stay on this stage until it is decided.
      return { stage: this.stage, effects: applied, awaiting: 'combat' };
    }

    this.stageId = nextId;
    emit('mission:stage', { mission: this, stage: this.stage });
    return { stage: this.stage, effects: applied };
  }

  /**
   * Apply a choice's declared effects to the world.
   *
   * `hold` keeps back the parts that are a REWARD for what happens next —
   * experience, standing, ledger records, flags — and returns them instead of
   * applying them. It is set when the choice queues a fight: see `choose`.
   * The rest still applies, because damage and lost time are the price of
   * getting into the fight rather than the prize for winning it.
   */
  applyEffects(effects, { hold = false } = {}) {
    const g = this.ctx.game;
    const out = { messages: [] };
    if (hold) {
      const { standing, record, flag, xp, ...rest } = effects;
      out.held = { standing, record, flag, xp };
      effects = rest;
    }

    if (effects.setVar) Object.assign(this.vars, effects.setVar);

    if (effects.check) {
      const team = g.awayTeam ?? g.buildAwayTeam();
      const result = team.check(g.rng, effects.check.type, {
        difficulty: effects.check.difficulty ?? 0.5,
        hazard: effects.check.hazard ?? 'elevated',
        captainBonus: g.progress.awayScienceBonus,
      });
      out.success = result.success;
      out.checkResult = result;
      out.messages.push(result.text);
      if (result.killed) g.ledger.loseOfficer(result.killed, { system: g.locationId, mission: this.id });
      if (result.securityLost) {
        g.ledger.record('lives_lost', { count: result.securityLost, text: 'Security crewman killed', mission: this.id });
      }
    }

    if (effects.roll) {
      out.success = g.rng.chance(effects.roll);
    }

    if (effects.standing) {
      for (const [faction, delta] of Object.entries(effects.standing)) {
        g.ledger.adjustStanding(faction, delta, this.def.title);
        out.messages.push(
          `${faction.charAt(0).toUpperCase() + faction.slice(1)} standing ${delta > 0 ? '+' : ''}${delta}.`,
        );
      }
    }

    if (effects.record) {
      for (const [kind, detail] of Object.entries(effects.record)) {
        g.ledger.record(kind, typeof detail === 'object'
          ? { ...detail, mission: this.id, stardate: g.clock.stardate }
          : { count: detail, mission: this.id, stardate: g.clock.stardate });
      }
    }

    if (effects.flag) {
      for (const f of [].concat(effects.flag)) g.ledger.setFlag(f);
    }

    // "Silent Partnership — every mission reward is increased by half. They
    // take their cut invisibly." Two hundred and eighty Bars of Latinum for
    // nothing at all: the perk went into a Set no code read.
    //
    // The reward a mission pays is its experience — `item` is the only other
    // thing an episode grants, and half a console is not a thing. Applied
    // here rather than at each episode, so a new episode cannot forget it.
    if (effects.xp && g.perk?.('ferengi_partner')) {
      effects = { ...effects, xp: Math.round(effects.xp * 1.5) };
    }

    if (effects.xp) {
      // `awardXP` carries out the promotion as well as recording it: the level,
      // the proficiency bonus and the banked feat used to happen in a listener
      // in main.js, so a captain promoted by a mission got the pip and nothing
      // else unless somebody was looking at the screen.
      g.awardXP(effects.xp);
      out.messages.push(`Service record updated: +${effects.xp} experience.`);
    }

    if (effects.damage) {
      g.ship.takeDamage(g.ship.maxHull * effects.damage, {
        bearing: 0, type: 'energy', rng: g.rng,
      });
      out.messages.push('The ship took damage.');
    }

    if (effects.repair) {
      g.ship.repair(g.ship.maxHull * effects.repair);
      out.messages.push('Repairs completed.');
    }

    if (effects.item) {
      for (const id of [].concat(effects.item)) g.loadout.acquire(id);
      out.messages.push('Equipment acquired.');
    }

    if (effects.combat) {
      out.combat = effects.combat;
    }

    if (effects.time) {
      // Authored in days, spent in hours, through the door every other timed
      // order in the game goes through — so a stage that says "this took three
      // days" is three days of the commission and of the ship's work.
      g.spendHours(effects.time * 24);
    }

    return out;
  }

  /**
   * The fight this episode ordered is over.
   *
   * Won means the declared outcome and the reward held back for it. Anything
   * else — broken off, talked out of, lost — means the episode ends without
   * it: you did not do the thing the ending says you did.
   */
  settleCombat(combatOutcome) {
    const pending = this.pending;
    if (!pending) return null;
    this.pending = null;

    const won = combatOutcome === 'victory' || combatOutcome === 'routed';
    if (!won) {
      return pending.terminal
        ? this.finish('broke_off', { messages: ['The engagement ended before it was settled.'] })
        : null;
    }

    const applied = this.applyEffects(pending.held ?? {});
    return pending.terminal ? this.finish(pending.outcome, applied) : { effects: applied };
  }

  finish(outcome, applied = {}) {
    this.complete = true;
    this.outcome = outcome;
    const ending = this.def.endings?.[outcome];
    if (ending) {
      const g = this.ctx.game;
      if (ending.effects) {
        // Merged, not overwritten. `applied` already carries what the choice
        // itself did — the standing that moved, the experience earned — and
        // Object.assign replaced its `messages` array wholesale with the
        // ending's, so on a terminal choice the player was told what the ending
        // did and never what their own decision had cost or paid.
        const endEffects = this.applyEffects(ending.effects);
        const merged = [...(applied.messages ?? []), ...(endEffects.messages ?? [])];
        Object.assign(applied, endEffects);
        applied.messages = merged;
      }
      g.ledger.record('mission_complete', {
        text: `${this.def.title}: ${ending.label ?? outcome}`,
        mission: this.id, outcome, stardate: g.clock.stardate,
      });
    } else {
      // An episode that ends on an outcome it never declared still ended, and
      // the record is the whole point of the ledger. `broke_off` is the one
      // that gets here: no episode writes an ending for the captain leaving.
      this.ctx.game.ledger.record('mission_complete', {
        text: `${this.def.title}: ${outcome.replace(/_/g, ' ')}`,
        mission: this.id, outcome, stardate: this.ctx.game.clock.stardate,
      });
    }
    emit('mission:complete', { mission: this, outcome, ending, applied });
    return { complete: true, outcome, ending, effects: applied };
  }

  save() {
    return {
      id: this.id, stageId: this.stageId, history: this.history,
      vars: this.vars, complete: this.complete, outcome: this.outcome,
      pending: this.pending ?? null,
    };
  }
}

/** Registry of episode definitions, populated by missions/episodes/index.js. */
export class MissionBook {
  constructor(episodes = []) {
    this.episodes = episodes;
    this.byId = Object.fromEntries(episodes.map((e) => [e.id, e]));
    this.completed = new Set();
    this.active = null;
  }

  /** Episodes offered at a location, given the world state. */
  availableAt(systemId, game) {
    return this.episodes.filter((e) => {
      if (this.completed.has(e.id)) return false;
      if (e.system && e.system !== systemId) return false;
      if (e.minRank && game.progress.rankIndex < e.minRank) return false;
      if (e.requiresFlag && !game.ledger.has(e.requiresFlag)) return false;
      if (e.blockedByFlag && game.ledger.has(e.blockedByFlag)) return false;
      if (e.requiresCompleted && !e.requiresCompleted.every((id) => this.completed.has(id))) return false;
      if (e.minStanding) {
        for (const [f, v] of Object.entries(e.minStanding)) {
          if (game.ledger.standingOf(f) < v) return false;
        }
      }
      return true;
    });
  }

  /**
   * Begin an episode.
   *
   * Refuses while another is half-finished. This was a bare assignment, so
   * starting a second episode silently replaced the first: it was never marked
   * complete, never written to the ledger, and was offered again later from its
   * opening stage — with every flag, standing change and point of experience it
   * had already paid still paid. Measured on `shakedown`: a hundred experience,
   * banked, and the episode back on the board to be run again.
   *
   * Walking away is still allowed. It is `abandon` now, and it says so in the
   * record, which is the difference between a decision and an accident.
   */
  start(episodeId, game) {
    const def = this.byId[episodeId];
    if (!def) return null;
    if (this.active && !this.active.complete) return null;
    this.active = new Mission(def, { game });
    emit('mission:start', { mission: this.active });
    return this.active;
  }

  /**
   * Give up on the episode in progress, on purpose and on the record.
   *
   * Not the same as finishing it: the episode does NOT go into `completed`, so
   * it can be picked up again from the beginning — but the ledger carries the
   * fact that it was walked away from, and the captain chose it.
   */
  abandon(game) {
    const m = this.active;
    if (!m || m.complete) return null;
    this.active = null;
    game?.ledger?.record?.('mission_abandoned', {
      text: `${m.def.title}: broken off at ${m.stageId}`,
      mission: m.id, stardate: game.clock?.stardate,
    });
    emit('mission:abandon', { mission: m });
    return m;
  }

  finishActive() {
    if (this.active) {
      this.completed.add(this.active.id);
      const done = this.active;
      this.active = null;
      return done;
    }
    return null;
  }

  save() {
    return { completed: [...this.completed], active: this.active?.save() ?? null };
  }

  load(data, game) {
    if (!data) return;
    this.completed = new Set(data.completed ?? []);
    if (data.active && this.byId[data.active.id]) {
      const m = new Mission(this.byId[data.active.id], { game });
      m.stageId = data.active.stageId;
      m.history = data.active.history ?? [];
      m.vars = data.active.vars ?? {};
      m.complete = data.active.complete ?? false;
      m.outcome = data.active.outcome ?? null;
      // A reward being held for a fight that has not finished yet. Dropping it
      // on load would strand the episode on a stage it can never leave.
      m.pending = data.active.pending ?? null;
      this.active = m;
    }
  }
}
