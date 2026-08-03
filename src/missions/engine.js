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

  /** Choices the player can currently take, with locked ones explained. */
  choices() {
    const stage = this.stage;
    if (!stage?.choices) return [];
    return stage.choices
      .filter((c) => !c.hidden || this.test(c.hidden) === false)
      .map((c) => {
        const gate = c.requires ? this.testRequirement(c.requires) : { ok: true };
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
    const applied = this.applyEffects(choice.effects ?? {});

    // A choice can branch on a resolved check.
    let nextId = choice.next;
    if (typeof nextId === 'function') nextId = nextId(this, applied);
    if (choice.branch) {
      nextId = applied.success ? choice.branch.success : choice.branch.failure;
    }

    emit('mission:choice', { mission: this, choice, applied });

    if (!nextId || !this.def.stages[nextId]) {
      return this.finish(choice.outcome ?? applied.outcome ?? 'complete', applied);
    }

    this.stageId = nextId;
    emit('mission:stage', { mission: this, stage: this.stage });
    return { stage: this.stage, effects: applied };
  }

  /** Apply a choice's declared effects to the world. */
  applyEffects(effects) {
    const g = this.ctx.game;
    const out = { messages: [] };

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

    if (effects.xp) {
      const promo = g.progress.addXP(effects.xp, { ledger: g.ledger });
      if (promo?.promoted) emit('captain:promoted', promo);
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
      g.clock.advanceStardate(effects.time);
    }

    return out;
  }

  finish(outcome, applied = {}) {
    this.complete = true;
    this.outcome = outcome;
    const ending = this.def.endings?.[outcome];
    if (ending) {
      const g = this.ctx.game;
      if (ending.effects) Object.assign(applied, this.applyEffects(ending.effects));
      g.ledger.record('mission_complete', {
        text: `${this.def.title}: ${ending.label ?? outcome}`,
        mission: this.id, outcome, stardate: g.clock.stardate,
      });
    }
    emit('mission:complete', { mission: this, outcome, ending, applied });
    return { complete: true, outcome, ending, effects: applied };
  }

  save() {
    return {
      id: this.id, stageId: this.stageId, history: this.history,
      vars: this.vars, complete: this.complete, outcome: this.outcome,
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

  start(episodeId, game) {
    const def = this.byId[episodeId];
    if (!def) return null;
    this.active = new Mission(def, { game });
    emit('mission:start', { mission: this.active });
    return this.active;
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
      this.active = m;
    }
  }
}
