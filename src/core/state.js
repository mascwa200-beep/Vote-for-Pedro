// The Game object: everything the simulation owns, in one place.

import { RNG, hashSeed } from './rng.js';
import { Clock } from './time.js';
import { Ledger } from './ledger.js';
import { emit } from './events.js';

import { Ship } from '../sim/ship.js';
import { Crew, Officer } from '../sim/officers.js';
import { CaptainProgress, combatXP } from '../sim/skills.js';
import { Loadout, startingLoadout } from '../sim/loadout.js';
import { Engagement, ARENA_RADIUS, hostileName, HOSTILE_NAMES } from '../sim/combat.js';
import { AwayTeam, AWAY_TEMPLATES, HAZARD_LEVEL } from '../sim/away.js';
import { Walker, stepToward, findRoom, resolve as resolveIn } from '../sim/walk.js';
import { nextInLine, watchOrder, watchAt, assignWatches, handbackReport } from '../sim/watch.js';
import { checkAll, Watchdog } from '../sim/invariants.js';
import { STARTING_STORES, beginFabrication, advanceFabrication, salvageWreck, RECIPE_BY_ID } from '../sim/fabrication.js';
import { resolveHail, STANDING_EFFECTS } from '../sim/diplomacy.js';

import { Galaxy, plotTransit } from '../world/galaxy.js';
// Placement only, and deterministic from the system id — see gfx/vista.js. The
// state needs it to answer "orbit of what", which is a question about the world
// and not about the renderer.
import { vista, worldLabel } from '../gfx/vista.js';
import { makeSurface, clearSurface, surfaceReport } from '../world/surface.js';
import { ROOMS } from '../world/interiors.data.js';
import { rollEncounter, environmentalHazard } from '../world/encounters.js';
import { buildRoster, ERAS } from '../world/crews.data.js';
import { getShipClass, FEDERATION_REGISTRIES } from '../world/ships.data.js';
import { SYSTEM_BY_ID } from '../world/systems.data.js';

import { MissionBook } from '../missions/engine.js';
import {
  SCENARIO as KOBAYASHI, gambitStatus, forceChannel, resolveGambit, recordOf, closeChannel,
} from '../missions/kobayashi.js';
import { EPISODES } from '../missions/episodes/index.js';

import { Character } from '../rules/character.js';
import { Reputation, REP_TRACKS } from '../rules/reputation.js';
import { DifficultySettings, DEFAULT_DIFFICULTY } from '../rules/difficulty.js';
import { CampaignClock, absenceReport, COMMISSION_DAYS } from '../campaign/clock.js';

/**
 * Ceiling on hostiles in one engagement. Beyond this the tactical display
 * stops being readable on a phone, whatever the difficulty asks for.
 */
const MAX_HOSTILES = 6;

/** "IKS Bortas" and "IKS Bortas II" should not become "IKS Bortas II II". */
const stripSuffix = (name) => String(name).replace(/\s+(?:I{1,3}|IV|V|VI)$/, '');

const ROMAN = ['', '', 'II', 'III', 'IV', 'V', 'VI'];
const romanNumeral = (n) => ROMAN[n] ?? String(n);

/** Events the Idealist trait doubles reputation for. */
const PEACEFUL_EVENTS = new Set([
  'distress_answered', 'colony_saved', 'first_contact', 'treaty_signed',
  'accepted_surrender', 'honourable_release', 'agreement_honoured',
]);

export const MODES = {
  BRIDGE: 'bridge',       // at a location, taking orders
  TRANSIT: 'transit',     // at warp between systems
  COMBAT: 'combat',       // tactical engagement
  MISSION: 'mission',     // in an episode stage
  ENCOUNTER: 'encounter', // resolving a non-combat encounter
};

export class Game {
  constructor(options = {}) {
    this.seed = options.seed ?? hashSeed(String(Date.now()));
    this.rng = new RNG(this.seed);

    // ---- difficulty ----
    // Read by combat, the dice, and the economy, so it is established first.
    this.difficulty = new DifficultySettings(options.difficulty ?? DEFAULT_DIFFICULTY);

    // ---- captain ----
    this.character = options.character instanceof Character
      ? options.character
      : new Character(options.character ?? {
        firstName: options.captainFirstName ?? 'Alexander',
        lastName: options.captainName ?? 'Reyes',
        pronouns: options.pronouns ?? 'they/them',
        careerId: options.background ?? 'command',
      });
    this.character.refresh();
    // Kept as a flat view for the log, the topbar, and older save files.
    this.captain = {
      name: this.character.lastName,
      firstName: this.character.firstName,
      species: this.character.species.name,
      pronouns: this.character.pronouns,
      background: this.character.careerId,
      serialNumber: this.character.serialNumber,
    };
    this.reputation = new Reputation();

    // ---- crew ----
    this.crewMode = options.crewMode ?? 'canon';
    this.era = options.era ?? 'tos';
    const roster = buildRoster({ mode: this.crewMode, era: this.era }, this.rng);
    this.crew = new Crew(roster.map((r) => new Officer(r)));

    // ---- ship ----
    const eraDef = ERAS[this.era];
    const classId = options.shipClass ?? eraDef?.shipClass ?? 'constitution';
    this.progress = new CaptainProgress(options.progress);
    this.loadout = startingLoadout(getShipClass(classId));
    this.ship = new Ship(classId, {
      name: options.shipName ?? 'Enterprise',
      registry: options.registry ?? FEDERATION_REGISTRIES[0],
      faction: 'federation',
      isPlayer: true,
    });
    this.applyAllMods();

    // ---- world ----
    this.clock = new Clock(eraDef?.stardate ?? 4523.3);
    this.galaxy = new Galaxy(this.rng);
    this.ledger = new Ledger();
    this.ledger.stardate = eraDef?.stardate ?? 4523.3;
    this.missions = new MissionBook(EPISODES);
    this.locationId = options.startAt ?? 'sol';
    this.galaxy.markVisited(this.locationId);

    // ---- runtime ----
    this.mode = MODES.BRIDGE;
    this.transit = null;
    this.engagement = null;
    this.encounter = null;
    this.awayTeam = null;
    // Which world the ship is in standard orbit of, if any: {systemId, bodyId}.
    // A place, not a label — the view is drawn from it and a landing party is
    // put down from it.
    this.orbit = null;
    // A hulk adrift where the last fight happened, until it is stripped or
    // left behind. `{ tier, systemId, hulls, name }`.
    this.wreck = null;
    this.alert = 'normal';
    // What "engage" means until the helm is told otherwise. The eight flip
    // switches on the console set it; six is the cruise the game has always
    // assumed when nobody says.
    this.warpFactor = 6;
    // Where the captain physically is. A commission starts in the chair.
    //
    // The surface is cleared FIRST. It is the one room that lives in the global
    // room table without belonging there, and a new game — or a loaded one —
    // that inherited the last game's planet would put its captain on a world
    // this commission has never been to. `Walker` resolves its room out of that
    // table, so leaving it lying around is the whole bug.
    clearSurface();
    this.walk = new Walker();
    this.walkOrder = null;
    // Who has the con. Null means the captain does, which is where a
    // commission starts — in the chair, on the bridge, at the top of alpha
    // watch. Anything else is a station id, because a station is unique in a
    // roster and an officer object cannot survive a save.
    //
    // The simulation watching itself, first. A full invariant sweep of a
    // six-ship fight costs 24 microseconds and a simulation tick costs 0.4, so
    // checking every tick would be sixty times the cost of the thing being
    // checked. Twice a second is not — it is under a thousandth of the frame
    // budget, and nothing that goes wrong in this simulation goes wrong for
    // less than half a second.
    //
    // What it buys is that a glitch in the field is REPORTED rather than
    // silently wrong. Each distinct fault reaches the ship's log once, as an
    // anomaly with its code, so a player who sees something strange has
    // something to send back instead of a description of how it looked.
    this.watchdog = options.watchdog === false ? null : new Watchdog({
      every: options.debug ? 1 : 15,
      onViolation: (v) => {
        this.pushLog(`Computer: internal anomaly [${v.code}] — ${v.text}`, 'computer');
        emit('anomaly', v);
      },
    });
    this.conStation = null;
    // Whether the watch officer took it because the captain walked away, or
    // was given it. Given, they keep it until they are told otherwise; taken,
    // they hand it straight back when the captain returns to the bridge.
    this.conGiven = false;
    this.conHours = 0;
    this.conLines = [];
    this.log = [];
    this.pendingCombat = null;
    this.firstStrike = false;
    // Whether this fight's call for help has been made, and what is on its way.
    this.helpCalled = false;
    this.helpInbound = null;
    // Explicitly false rather than undefined: `over` is read as a boolean all
    // over the UI and the save, and an unset field reads as "not over" by luck.
    this.over = false;
    this.overReason = null;
    this.latinum = 500;

    // ---- stores and the machine shop ----
    this.stores = { ...STARTING_STORES };
    this.fabrication = null;
    this.devices = {};

    // ---- the commission ----
    // Five years of wall-clock time. The ship works whether the app is open or
    // not; this is the one place real time enters the simulation.
    this.campaign = new CampaignClock({
      now: options.now,
      compression: options.compression ?? 1,
    });

    this.pushLog(`Assumed command of the ${this.ship.name}, ${this.ship.registry}.`, 'captain');
  }

  // ------------------------------------------------------------------ setup

  /** Recompute ship modifiers from skills + consoles. Call after any change. */
  applyAllMods() {
    // Reset to the class baseline, then reapply everything.
    this.ship.mods = {
      damage: 1, shieldMax: 1, shieldRegen: 1, hullMax: 1, turn: 1,
      impulse: 1, accuracy: 1, defense: 1, critChance: 0.05, critSeverity: 0.5,
      repairRate: 1, torpedoDamage: 1, beamDamage: 1, cannonDamage: 1,
      damageResist: 0, stealthDetect: 1, crewProtect: 0,
    };
    this.ship.applyMods(this.progress.shipMods());
    this.ship.applyMods(this.loadout.shipMods());
    // The captain's own abilities are part of the ship's performance.
    if (this.character) this.ship.applyMods(this.character.shipMods());
    // Difficulty is a setting on the campaign, not on a training simulator.
    // Inside a scripted scenario the player flies the ship as designed, because
    // an exercise that got easier when you moved a slider would not be an
    // exercise. Story mode's bonuses alone turned the no-win scenario into a
    // 40-out-of-40 win at 66% hull.
    if (this.difficulty && !this.scriptedScenario) {
      this.ship.applyMods(this.difficulty.playerMods());
    }

    // The biofunction monitor and a physician captain both reduce casualties
    // from hull hits, not merely on away missions.
    const crewProtect = this.loadout.special('crewProtect')
      + (this.character?.mechanic('casualtyReduction') ?? 0);
    if (crewProtect) this.ship.applyMods({ crewProtect });

    const eps = this.loadout.special('powerTransfer');
    if (eps) this.ship.power.transferRate = 55 + eps;
    if (this.character?.hasFeat('master_engineer')) this.ship.power.transferRate = 400;
  }

  /**
   * Reputation is earned by named world events rather than sprinkled
   * everywhere, so the awards stay auditable in one place.
   */
  earnReputation(event) {
    if (!this.reputation) return;
    const mult = (this.character?.mechanic('repGain') ?? 1)
      * (this.character?.hasTrait('idealist') && PEACEFUL_EVENTS.has(event) ? 2 : 1);
    for (const up of this.reputation.recordEvent(event, mult)) {
      this.pushLog(
        `${REP_TRACKS[up.track]?.name ?? up.track} standing advanced to ${up.name}.`,
        'captain',
      );
      emit('reputation:tier', up);
    }
  }

  get location() { return this.galaxy.get(this.locationId); }

  get stardate() { return this.clock.format(); }

  // ------------------------------------------------------------------ log

  pushLog(text, source = 'bridge') {
    const entry = { text, source, stardate: this.clock.format(), t: this.log.length };
    this.log.push(entry);
    if (this.log.length > 400) this.log.shift();
    emit('log', entry);
    return entry;
  }

  /** An officer says something, in their own register. */
  officerSays(station, text, kind = 'order') {
    const officer = this.crew.at(station);
    const who = officer ? `${officer.name}` : station;
    this.pushLog(`${who}: ${text}`, station);
    emit('officer:speak', { officer, station, text, kind });
    return officer;
  }

  setAlert(level) {
    if (this.alert === level) return;
    // Blue is a maintenance condition, not a combat one. Asking for it while
    // people are shooting at you is a mistake the ship declines to make.
    if (level === 'blue' && this.engagement && !this.engagement.over) {
      this.officerSays('tactical', 'Not while we are under fire, Captain.', 'object');
      return;
    }
    this.alert = level;
    emit('alert', level);
    this.pushLog(
      level === 'red' ? 'Red alert. All hands to battle stations.'
        : level === 'yellow' ? 'Yellow alert.'
        : level === 'blue' ? 'Blue alert. Secure for docking and maintenance stations.'
        : 'Stand down from alert.',
      'captain',
    );
  }

  // ------------------------------------------------- the captain's chair
  //
  // Everything below is reachable from the chair panel and from a typed order,
  // through the same code path. The chair is not a second implementation of the
  // game; it is a set of shortcuts into this one.

  /**
   * Call a department on the intercom and get a real answer.
   * Each report is assembled from live ship state — nothing here is flavour
   * text with no number behind it.
   */
  intercom(dept) {
    const s = this.ship;
    const pct = (v) => `${Math.round(v * 100)} percent`;
    const reports = {
      engineering: () => {
        const worst = Object.entries(s.subsystems)
          .sort((a, b) => a[1] - b[1])[0];
        return s.coreEjected
          ? 'The core is gone, Captain. Impulse only until we reach a yard.'
          : `Warp core at ${pct(s.subsystems.warpcore)}. Worst system is ${worst[0]} at ${pct(worst[1])}.`
            + (s.fires > 0 ? ` ${s.fires} fire${s.fires > 1 ? 's' : ''} still burning.` : '');
      },
      medical: () => {
        const lost = s.maxCrew - s.crew;
        const hurt = this.crew.officers.filter((o) => o.injured).length;
        return lost === 0 && hurt === 0
          ? 'Sickbay is quiet, Captain. Nobody on my table.'
          : `${lost} dead, ${hurt} of the senior staff injured. Life support at ${pct(s.subsystems.lifesupport)}.`;
      },
      tactical: () => `Phasers at ${pct(s.subsystems.weapons)}, ${s.torpedoes} torpedoes in the magazine. `
        + `Shields ${s.shieldsUp ? 'up' : 'down'}.`,
      science: () => `Sensors at ${pct(s.subsystems.sensors)}. `
        + `${this.location.name}, ${this.location.type}${this.location.hazard ? `, ${this.location.hazard.replace(/_/g, ' ')}` : ''}.`,
      helm: () => (this.transit
        ? `Underway for ${this.transit.to.name}, warp ${this.transit.factor.toFixed(1)}.`
        : `Station keeping at ${this.location.name}. Engines at ${pct(s.subsystems.engines)}.`),
      comms: () => `Subspace is clear, Captain. ${this.reputation ? 'Nothing on the priority channels.' : ''}`.trim(),
      security: () => `${s.crew} aboard, all decks reporting. Hull at ${pct(s.hullPct)}.`,
    };
    const text = (reports[dept] ?? reports.security)();
    this.officerSays(dept, text, 'report');
    return text;
  }

  /**
   * Repair underway, without a starbase.
   *
   * Blue alert is the reason this is a method rather than three lines in the
   * bridge screen. Canonically blue alert covers docking, separation and
   * hazard conditions — the states where the crew is at maintenance stations
   * rather than battle stations — so calling it before you start work is worth
   * half as much again, and is refused in a fight for the obvious reason.
   */
  effectRepairs() {
    const s = this.ship;
    if (s.hullPct >= 1) return { ok: false, reason: 'The hull is sound, Captain.' };
    const blue = this.alert === 'blue';
    const before = s.hullPct;
    s.repair(s.maxHull * (blue ? 0.18 : 0.12));
    this.clock.advanceStardate(blue ? 0.6 : 0.8);
    this.pushLog(
      `Repair teams restored hull integrity to ${Math.round(s.hullPct * 100)}%.`
        + (blue ? ' Maintenance stations made the difference.' : ''),
      'engineering',
    );
    return { ok: true, before, after: s.hullPct, blue };
  }

  /**
   * Record a captain's log entry. It goes into the ship's log like any other
   * line and, unlike any other line, it is yours.
   */
  logEntry(text) {
    const clean = String(text ?? '').trim();
    if (!clean) return null;
    this.pushLog(`Captain's log, supplemental: ${clean}`, 'captain');
    this.ledger?.record?.('log_entry', { stardate: this.clock.format(), text: clean });
    return clean;
  }

  /**
   * Jettison the ion pod. Historically the chair's third labelled button, and
   * the only one of the three that does something other than change a light.
   *
   * In a fight the pod is a sensor decoy: it burns hot, it looks like a ship,
   * and for a while everything shooting at you is shooting slightly wide. Out
   * of a fight there is nothing to gain and a pod to lose, so the answer is no.
   */
  jettisonPod() {
    if (!this.engagement || this.engagement.over) {
      return { ok: false, reason: 'No reason to lose the pod, Captain.' };
    }
    if (this.podJettisoned) {
      return { ok: false, reason: 'The pod is already away. We only carry the one.' };
    }
    this.podJettisoned = true;
    this.engagement.deployDecoy(14);
    this.officerSays('engineering', 'Ion pod away. It will read like us for a minute or so.', 'report');
    return { ok: true };
  }

  /**
   * Advance a walk that is under way.
   *
   * "Go to sickbay" walks you there. It does not teleport you, and the
   * difference is the whole reason the ship has geometry: a lift ride and a
   * corridor are a minute of the captain's day, and being somewhere other than
   * the bridge is a thing that can matter when the shooting starts.
   */
  updateWalk(dt) {
    if (!this.walkOrder) return;
    const { toId } = this.walkOrder;
    this.walkOrder.memory ??= {};
    const r = stepToward(this.walk, toId, dt, this.walkOrder.memory);
    this.walkOrder.elapsed = (this.walkOrder.elapsed ?? 0) + dt;
    // The con changes hands the moment you step into the turbolift, not when
    // you arrive wherever you were going. Cheap to ask every frame: it is two
    // comparisons unless the answer has actually changed.
    this.updateCon();

    if (r.arrived) {
      this.walkOrder = null;
      this.pushLog(`Arrived at ${this.walk.room.name}.`, 'captain');
      emit('walk', { roomId: this.walk.roomId, arrived: true });
      return;
    }
    if (r.blocked) {
      this.walkOrder = null;
      this.pushLog(`There is no route to ${toId} from here.`, 'computer');
      return;
    }
    // A walk that has not arrived in two minutes is a walk that is not going
    // to. Better to say so than to leave the captain pacing forever.
    if (this.walkOrder.elapsed > 120) {
      this.walkOrder = null;
      this.pushLog(`Could not reach ${toId}. Standing by in ${this.walk.room.name}.`, 'computer');
    }
  }

  /** Set off for another part of the ship. */
  goToRoom(nameOrId) {
    const room = findRoom(nameOrId) ?? null;
    if (!room) return { ok: false, reason: 'There is no such compartment aboard, Captain.' };
    if (room.id === this.walk.roomId && !this.walkOrder) {
      return { ok: false, reason: `You are in ${room.name}, Captain.` };
    }
    if (this.mode === MODES.COMBAT) {
      return { ok: false, reason: 'Not while we are under fire, Captain.' };
    }
    this.walkOrder = { toId: room.id, memory: {}, elapsed: 0 };
    this.pushLog(`Making for ${room.name}.`, 'captain');
    return { ok: true, room };
  }

  // -------------------------------------------------------- the diagnostic

  /**
   * Run a diagnostic on the ship.
   *
   * A level one diagnostic is a real thing in this franchise and it is exactly
   * an invariant sweep: every system checked against what it is supposed to be,
   * by hand, taking hours, because the automated pass missed something. So the
   * order the show gives is wired to the checker this game actually has.
   *
   * Levels run 1 (everything, slowest) to 5 (a quick look). The level decides
   * how much is reported and how long the crew is busy with it, not whether the
   * invariants are checked — those are always all checked, because a checker
   * that skips rules to save time is a checker that reports a clean ship that
   * is not.
   *
   * @param {number} level 1..5
   * @returns {{level, clean, violations, lines, hours}}
   */
  diagnostic(level = 5) {
    const lvl = Math.min(5, Math.max(1, Math.round(Number(level) || 5)));
    const violations = checkAll(this, { arenaRadius: ARENA_RADIUS });
    const s = this.ship;
    const lines = [];

    lines.push(`Level ${['one', 'two', 'three', 'four', 'five'][lvl - 1]} diagnostic, ${s.name}.`);
    lines.push(`Hull integrity ${Math.round(s.hullPct * 100)} percent. Shields ${Math.round(s.shieldPct * 100)} percent${s.shieldsUp ? '' : ', down'}.`);

    // The deeper the level, the more of the ship is actually itemised. A level
    // five is the glance you get on the bridge; a level one is every system.
    const faults = Object.entries(s.subsystems)
      .filter(([, v]) => v < 0.999)
      .sort((a, b) => a[1] - b[1]);
    const show = lvl <= 2 ? faults : faults.slice(0, lvl <= 3 ? 3 : 1);
    for (const [k, v] of show) {
      lines.push(`${k} at ${Math.round(v * 100)} percent.`);
    }
    if (!faults.length) lines.push('All systems nominal.');
    if (s.fires > 0) lines.push(`${s.fires} fire${s.fires === 1 ? '' : 's'} still burning.`);
    if (s.breaching) lines.push(`Warp core breach in ${Math.round(s.breachTimer)} seconds.`);
    if (lvl <= 2) {
      lines.push(`Crew ${Math.round(s.crew)} of ${s.maxCrew}. Antimatter ${Math.round(s.antimatter)} percent.`);
      const casualties = this.crew.officers.filter((o) => !o.alive || o.injured);
      for (const o of casualties) {
        lines.push(`${o.rank} ${o.name} is ${o.alive ? 'in sickbay' : 'dead'}.`);
      }
    }

    // The part that is not in the show. A violation here is a fault in the
    // simulation rather than in the ship, and saying so plainly beats a silent
    // wrong number — this is the readout that tells you the game is broken
    // instead of leaving you to guess why the bars look odd.
    for (const v of violations) {
      lines.push(`ANOMALY [${v.code}] ${v.text}`);
    }

    const hours = [8, 4, 2, 1, 0.25][lvl - 1];
    for (const line of lines) this.pushLog(line, 'engineering');
    emit('diagnostic', { level: lvl, violations, lines });
    return { level: lvl, clean: violations.length === 0, violations, lines, hours };
  }

  // --------------------------------------------------------------- the con

  /** True while the captain is standing on their own bridge. */
  get onBridge() { return this.walk.roomId === 'bridge'; }

  /** The officer who has the con, or null when the captain has it. */
  get conOfficer() {
    return this.conStation ? (this.crew.at(this.conStation) ?? null) : null;
  }

  /**
   * The hour of the ship's day, 0..24.
   *
   * One stardate unit is one day everywhere else in this game, so the fraction
   * of a stardate is the fraction of a day, and the watch bill can be read
   * straight off the chronometer without a second clock to keep in step.
   */
  get shipHour() {
    const frac = this.clock.stardate - Math.floor(this.clock.stardate);
    return ((frac % 1) + 1) % 1 * 24;
  }

  /** Which of the three watches is standing right now. */
  get watch() { return watchAt(this.shipHour); }

  /** The whole watch bill: who stands alpha, beta and gamma. */
  get watchBill() { return assignWatches(this.crew); }

  /** The line of succession for the con, most senior first. */
  get watchOrder() { return watchOrder(this.crew); }

  /**
   * Hand the con over.
   *
   * @param {string|null} nameOrStation who to give it to; the next ranking
   *        officer available when not said.
   * @param {object} opts `given` marks a deliberate handover, which the officer
   *        keeps until told otherwise rather than surrendering the moment the
   *        captain walks back in.
   */
  handOverCon(nameOrStation = null, { given = true, spoken = true } = {}) {
    if (this.conStation && !nameOrStation) {
      // An officer already standing the watch because you walked off the
      // bridge is confirmed in it rather than told no — saying "you have the
      // con" to the person who already has it is how it is made official, and
      // it means they keep it when you walk back in.
      if (!this.conGiven && given) {
        this.conGiven = true;
        const holder = this.conOfficer;
        if (spoken && holder) {
          this.pushLog(`${holder.rank} ${holder.name}, you have the con.`, 'captain');
          this.officerSays(holder.station, 'Aye, Captain. I have the con.', 'report');
        }
        return { ok: true, officer: holder };
      }
      return { ok: false, reason: `${this.conOfficer?.name ?? 'The watch officer'} already has the con, Captain.` };
    }
    let officer = null;
    if (nameOrStation) {
      const want = String(nameOrStation).toLowerCase();
      officer = this.crew.officers.find((o) => o.alive && !o.injured
        && (o.station === want || o.name.toLowerCase().includes(want)));
      if (!officer) {
        return { ok: false, reason: `There is no one available by that name, Captain.` };
      }
    } else {
      officer = nextInLine(this.crew);
    }
    if (!officer) return { ok: false, reason: 'There is no one fit to relieve you, Captain.' };
    if (officer.station === this.conStation) {
      return { ok: false, reason: `${officer.name} already has the con, Captain.` };
    }

    this.conStation = officer.station;
    this.conGiven = given;
    this.conHours = 0;
    this.conLines = [];
    if (spoken) {
      this.pushLog(`${officer.rank} ${officer.name}, you have the con.`, 'captain');
      this.officerSays(officer.station, 'Aye, Captain. I have the con.', 'report');
    }
    emit('con', { officer, held: true });
    return { ok: true, officer };
  }

  /**
   * Take it back, and hear what happened.
   *
   * The report is the point. A watch that hands back "nothing to report" is a
   * watch that was stood, and one that hands back three lines about a hull
   * breach is the game telling you the ship kept going without you — which is
   * the whole reason the con exists rather than the bridge simply pausing.
   */
  takeCon({ spoken = true } = {}) {
    const officer = this.conOfficer;
    if (!this.conStation) return { ok: false, reason: 'You have the con, Captain.', lines: [] };

    const lines = officer ? handbackReport(officer, this.conHours, this.conLines) : this.conLines.slice();
    this.conStation = null;
    this.conGiven = false;
    this.conHours = 0;
    this.conLines = [];
    if (spoken) {
      for (const line of lines) this.pushLog(line, 'bridge');
      this.pushLog('I have the con.', 'captain');
    }
    emit('con', { officer, held: false });
    return { ok: true, officer, lines };
  }

  /**
   * Keep the con with whoever is actually on the bridge.
   *
   * Called every time the captain's position changes. Walk off the bridge and
   * the next ranking officer relieves you without being asked, because that is
   * what happens; walk back on and they give it back — unless you handed it to
   * them deliberately, in which case they keep it until you say otherwise.
   */
  updateCon() {
    if (this.over) return null;
    if (this.onBridge) {
      if (this.conStation && !this.conGiven) return this.takeCon();
      return null;
    }
    if (!this.conStation) {
      const r = this.handOverCon(null, { given: false, spoken: false });
      if (r.ok) {
        this.officerSays(r.officer.station, 'I have the con, Captain.', 'report');
      }
      return r;
    }
    return null;
  }

  /** Stand up from the chair, or take it. */
  takeChair(on = true) {
    if (on && this.walk.roomId !== 'bridge') {
      // Taking the chair from another deck means walking back to it first.
      const r = this.goToRoom('bridge');
      return r.ok
        ? { ok: true, walking: true, reason: 'Making for the bridge, Captain.' }
        : r;
    }
    this.walkOrder = null;
    const r = this.walk.sit(on);
    if (r.ok) this.pushLog(on ? 'Took the chair.' : 'Stood up from the chair.', 'captain');
    if (r.ok && on) this.updateCon();
    return r;
  }

  // ------------------------------------------------------------------ orders

  /**
   * Set course and engage.
   * @returns {object} { ok, error }
   */
  /**
   * The standing warp factor: what "engage" means until told otherwise.
   *
   * This is what the eight flip switches on the helm console set, and it is the
   * default every course is plotted at. Before it existed, "warp eight" was an
   * order the game acknowledged and then discarded — the helm said "warp eight
   * standing by" and the next course still went out at six.
   */
  setWarpFactor(factor) {
    const max = this.ship.cls.maxWarp ?? 8;
    const want = Math.max(1, Math.min(9.9, Number(factor) || 1));
    const set = Math.min(want, max);
    this.warpFactor = set;
    return { ok: true, factor: set, limited: set < want - 1e-9, max };
  }

  // ------------------------------------------------------------------ orbit

  /** The vista body the ship is in orbit of, or null. */
  get orbitBody() {
    if (!this.orbit || this.orbit.systemId !== this.locationId) return null;
    const sys = this.location;
    if (!sys) return null;
    return vista(sys.id, sys.type).bodies.find((b) => b.id === this.orbit.bodyId) ?? null;
  }

  /** What the crew calls the world below. */
  get orbitLabel() {
    const b = this.orbitBody;
    return b ? worldLabel(this.location?.name ?? 'the system', b) : null;
  }

  /**
   * Standard orbit.
   *
   * Given no world it takes the nearest one, which is what the order means when
   * a captain gives it without naming anything: there is one obvious thing you
   * came here to look at. Naming a world is how you pick a different one.
   */
  enterOrbit(bodyId = null) {
    if (this.transit) return { ok: false, error: 'We are still at warp, Captain.' };
    const sys = this.location;
    if (!sys) return { ok: false, error: 'We are nowhere in particular.' };

    const v = vista(sys.id, sys.type);
    const worlds = v.bodies.filter((b) => b.kind !== 'star');
    if (!worlds.length) {
      const err = `There is nothing to orbit at ${sys.name}, Captain.`;
      this.officerSays('helm', err, 'object');
      return { ok: false, error: err };
    }

    const body = (bodyId && worlds.find((b) => b.id === bodyId)) || v.focus || worlds[0];
    const label = worldLabel(sys.name, body);
    if (this.orbit?.bodyId === body.id && this.orbit.systemId === sys.id) {
      return { ok: true, body, label, already: true };
    }

    this.orbit = { systemId: sys.id, bodyId: body.id };
    this.officerSays('helm', `Standard orbit around ${label}, Captain.`);
    this.pushLog(`Assumed standard orbit of ${label}.`, 'helm');
    emit('orbit:enter', { body, label, system: sys });
    return { ok: true, body, label };
  }

  /** Out of orbit and back to station-keeping. */
  breakOrbit() {
    if (!this.orbit) return { ok: false, error: 'We are not in orbit, Captain.' };
    const label = this.orbitLabel;
    this.orbit = null;
    if (label) this.officerSays('helm', `Breaking orbit of ${label}.`);
    emit('orbit:leave', { label });
    return { ok: true, label };
  }

  // ------------------------------------------------------------ transporter

  /** True when the captain is standing on a world rather than aboard. */
  get ashore() { return this.walk.roomId === 'surface'; }

  /**
   * Beam down.
   *
   * Four things have to be true, and each of them is a different refusal: the
   * ship has to be in orbit of somewhere, nobody can be shooting, the captain
   * has to be standing in the transporter room, and the world has to be one a
   * person can stand on. The third is the one that matters most — this game
   * does not have a button that teleports you from the chair. You walk to the
   * transporter room and you stand on the pad, because that is what the room is
   * for and because a command you can give from anywhere is a menu.
   */
  beamDown() {
    if (this.ashore) return { ok: false, error: 'We are already on the surface, Captain.' };
    if (this.mode === MODES.COMBAT) return { ok: false, error: 'Not while we are under fire, Captain.' };
    const body = this.orbitBody;
    if (!body) {
      const err = 'We would have to make orbit first, Captain.';
      this.officerSays('transporter', err, 'object');
      return { ok: false, error: err };
    }
    if (body.kind === 'gas') {
      const err = `${this.orbitLabel} has no surface to beam down to.`;
      this.officerSays('science', err, 'object');
      return { ok: false, error: err };
    }
    if (this.walk.roomId !== 'transporter') {
      const err = 'You would have to be in the transporter room, Captain.';
      this.officerSays('transporter', err, 'object');
      return { ok: false, error: err };
    }

    const label = this.orbitLabel;
    makeSurface(body, label);
    this.walkOrder = null;
    this.walk.enter('surface');
    this.updateCon();
    this.pushLog(`Beamed down to ${label}. ${surfaceReport(body.kind)}.`, 'transporter');
    emit('beam', { down: true, label, body });
    return { ok: true, label, body };
  }

  /** And back. Always possible — the ship does not leave people behind. */
  beamUp() {
    if (!this.ashore) return { ok: false, error: 'We are aboard, Captain.' };
    const label = this.walk.room?.name ?? 'the surface';
    this.walkOrder = null;
    this.walk.enter('transporter');
    // On the pads, not by the door. `enter` puts you a step inside the way you
    // came, which is right for walking and wrong for materialising.
    const pad = ROOMS.transporter.padCentre;
    [this.walk.x, this.walk.z] = pad;
    clearSurface();
    this.pushLog(`Beamed up from ${label}.`, 'transporter');
    emit('beam', { down: false, label });
    return { ok: true, label };
  }

  setCourse(destinationId, warpFactor = this.warpFactor ?? 6) {
    if (this.mode === MODES.COMBAT) return { ok: false, error: 'We are under fire, Captain.' };
    const plan = plotTransit(
      this.galaxy, this.locationId, destinationId, warpFactor,
      this.ship, this.progress.warpEfficiency,
    );
    if (plan.error) {
      this.officerSays('helm', plan.error, 'object');
      return { ok: false, error: plan.error };
    }

    this.transit = plan.transit;
    // You cannot hold an orbit and leave the system. Cleared silently: the helm
    // announcing a break the captain did not order is noise, and the course
    // report immediately after says where the ship is going instead.
    this.orbit = null;
    this.mode = MODES.TRANSIT;
    this.ship.antimatter = Math.max(0, this.ship.antimatter - plan.fuel);

    const dest = this.galaxy.get(destinationId);
    this.officerSays('helm', `Course laid in for ${dest.name}, warp ${plan.factor.toFixed(0)}.`);
    this.pushLog(`Engaged at warp ${plan.factor.toFixed(0)} for ${dest.name}.`, 'captain');
    emit('transit:begin', { transit: this.transit, destination: dest });
    return { ok: true, transit: this.transit, hours: plan.hours, fuel: plan.fuel };
  }

  /** Arrive: advance the calendar, roll for what is waiting. */
  arrive() {
    const t = this.transit;
    if (!t) return;
    this.locationId = t.to.id;
    this.clock.advanceStardate(t.totalHours / 24);
    this.transit = null;
    // Arriving somewhere new is not arriving in orbit. The order to make orbit
    // is a separate one and the captain gives it.
    this.orbit = null;
    this.mode = MODES.BRIDGE;

    const isNew = this.galaxy.markVisited(this.locationId);
    this.pushLog(`Arrived at ${t.to.name}.`, 'helm');
    if (isNew && t.to.unexplored) {
      this.ledger.record('anomaly_catalogued', { text: `First survey of ${t.to.name}`, system: t.to.id });
      this.progress.addXP(250, { ledger: this.ledger });
    }
    emit('arrived', { system: t.to, isNew });

    const enc = rollEncounter(this.rng, this.locationId, { ledger: this.ledger });
    if (enc && enc.kind !== 'quiet') this.beginEncounter(enc);
  }

  // ------------------------------------------------------------------ encounters

  beginEncounter(encounter) {
    this.encounter = encounter;
    this.mode = MODES.ENCOUNTER;
    this.pushLog(encounter.text, 'science');
    if (encounter.hostile) this.setAlert('red');
    else if (encounter.kind === 'anomaly' || encounter.kind === 'derelict') this.setAlert('yellow');
    emit('encounter:begin', encounter);
  }

  /** Resolve an encounter choice. Returns messages for the UI. */
  resolveEncounter(choiceId) {
    const enc = this.encounter;
    if (!enc) return { messages: [] };
    const out = { messages: [] };

    switch (choiceId) {
      case 'engage':
        this.firstStrike = !enc.hostile;
        // The encounter is spent the moment it becomes a battle. Left set, the
        // next hail in the campaign was answered by whoever was in THIS one:
        // the wrong faction, the wrong ships, and a set of choices belonging
        // to a situation that ended some time ago.
        this.encounter = null;
        this.startCombat(enc.ships ?? [], { name: enc.title });
        return { messages: ['Engaging.'], combat: true };

      case 'hail': {
        this.mode = MODES.ENCOUNTER;
        out.hail = true;
        return out;
      }

      // ---- getting out of a trap ----
      case 'trap_device': {
        const trap = enc.trap;
        if (!trap || (this.devices?.[trap.device] ?? 0) < 1) {
          out.messages.push('We do not have one aboard, Captain.');
          return out;
        }
        this.devices[trap.device] -= 1;
        out.messages.push(trap.deviceText);
        this.encounter = null;
        this.mode = MODES.BRIDGE;
        this.earnReputation('crisis_averted');
        return out;
      }
      case 'trap_power': {
        const trap = enc.trap;
        if (!trap) return out;
        // Costs the grid: everything goes to one channel and the rest starves.
        this.ship.power.set(trap.powerChannel, 100);
        this.ship.antimatter = Math.max(0, this.ship.antimatter - 12);
        out.messages.push(trap.powerText);
        this.encounter = null;
        this.mode = MODES.BRIDGE;
        return out;
      }
      case 'trap_wait': {
        const trap = enc.trap;
        if (!trap) return out;
        this.clock.advanceStardate(trap.waitHours / 24);
        if (trap.damage) {
          this.ship.takeDamage(this.ship.maxHull * trap.damage, {
            bearing: 0, type: 'kinetic', rng: this.rng,
          });
        }
        out.messages.push(trap.waitText);
        if (trap.damage) {
          out.messages.push(`Hull integrity is down to ${Math.round(this.ship.hullPct * 100)} percent.`);
        }
        this.encounter = null;
        this.mode = MODES.BRIDGE;
        return out;
      }

      case 'assist': {
        const lives = enc.lives ?? 200;
        this.ledger.record('distress_answered', { text: `Assisted at ${enc.system.name}`, system: enc.system.id });
        this.ledger.record('lives_saved', { count: lives, system: enc.system.id });
        this.progress.addXP(300 + lives / 6, { ledger: this.ledger });
        this.ledger.adjustStanding('federation', STANDING_EFFECTS.answered_distress, 'Answered a distress call');
        this.earnReputation('distress_answered');
        this.clock.advanceStardate(0.6);
        out.messages.push(`Assistance rendered. ${lives} lives saved.`);
        if (enc.hostile && enc.ships?.length) {
          this.startCombat(enc.ships, { name: enc.title });
          out.combat = true;
          return out;
        }
        break;
      }

      case 'ignore':
        this.ledger.record('distress_ignored', {
          text: `Did not respond to a distress call at ${enc.system.name}`, system: enc.system.id,
        });
        this.ledger.adjustStanding('federation', STANDING_EFFECTS.ignored_distress, 'Ignored a distress call');
        out.messages.push('We continue on course. The channel stays open for a while, then stops.');
        break;

      case 'scan': {
        const quality = 0.5 + this.progress.scanBonus + this.ship.subsystems.sensors * 0.3;
        const success = this.rng.chance(quality);
        if (success) {
          this.ledger.record('anomaly_catalogued', {
            text: `Catalogued ${enc.anomaly?.name ?? 'phenomenon'} at ${enc.system.name}`, system: enc.system.id,
          });
          this.progress.addXP(120 * (enc.anomaly?.value ?? 1), { ledger: this.ledger });
          this.galaxy.markSurveyed(enc.system.id, enc.anomaly?.name);
          out.messages.push(`Full sensor profile obtained. ${enc.anomaly?.name ?? 'Phenomenon'} catalogued.`);
        } else {
          out.messages.push('The readings will not resolve. Science recommends a closer approach.');
        }
        break;
      }

      case 'approach': {
        const hazard = enc.anomaly?.hazard ?? 0.3;
        if (this.rng.chance(hazard)) {
          const dmg = this.ship.maxHull * this.rng.range(0.05, 0.16);
          this.ship.takeDamage(dmg, { bearing: this.rng.range(-180, 180), type: 'energy', rng: this.rng });
          out.messages.push('The ship took the brunt of it. Damage reports coming in.');
        }
        this.ledger.record('anomaly_catalogued', {
          count: enc.anomaly?.value ?? 2,
          text: `Close survey of ${enc.anomaly?.name ?? 'phenomenon'}`, system: enc.system.id,
        });
        this.progress.addXP(260 * (enc.anomaly?.value ?? 1), { ledger: this.ledger });
        this.galaxy.markSurveyed(enc.system.id, enc.anomaly?.name);
        this.earnReputation('anomaly_catalogued');
        out.messages.push('Close survey complete. Science has what they need.');
        break;
      }

      case 'board': {
        const team = this.buildAwayTeam();
        // DC scales with how dangerous the specific derelict looked.
        const r1 = team.check(this.rng, 'engineering', {
          dc: 10 + Math.round((enc.risk ?? 0.4) * 14), hazard: 'dangerous',
        });
        out.messages.push(r1);
        if (r1.killed) this.ledger.loseOfficer(r1.killed, { system: enc.system.id });
        if (r1.success && enc.salvage) {
          this.loadout.acquire(enc.salvage);
          out.messages.push('Salvage recovered and stowed.');
          this.progress.addXP(350, { ledger: this.ledger });
        }
        break;
      }

      case 'escort': {
        this.ledger.adjustStanding(enc.factionId ?? 'independent', STANDING_EFFECTS.completed_escort, 'Escort completed');
        this.latinum += Math.round((enc.escortReward ?? 300) * (this.reputation.has('better_prices') ? 1.25 : 1));
        this.earnReputation('escort_completed');
        this.progress.addXP(280, { ledger: this.ledger });
        this.clock.advanceStardate(0.8);
        out.messages.push(`Escort complete. ${enc.escortReward ?? 300} credits transferred.`);
        break;
      }

      case 'contact_peaceful': {
        const success = this.rng.chance(0.5 + this.progress.diplomacyBonus);
        if (success) {
          this.ledger.record('first_contact', {
            text: `First contact with the ${enc.speciesName}`, system: enc.system.id,
          });
          this.progress.addXP(900, { ledger: this.ledger });
          this.ledger.adjustStanding('federation', 12, 'First contact');
          this.earnReputation('first_contact');
          out.messages.push(`Contact established with the ${enc.speciesName}. They are... cautious, but talking.`);
        } else {
          out.messages.push('They break off without answering. The database gets a new entry and nothing else.');
          this.progress.addXP(200, { ledger: this.ledger });
        }
        break;
      }

      case 'contact_prewarp': {
        // The Prime Directive is a real gate with real consequences.
        this.ledger.record('prime_directive_violation', {
          text: `Revealed the ship to a pre-warp culture at ${enc.system.name}`, system: enc.system.id,
        });
        this.ledger.adjustStanding('federation', -18, 'Prime Directive violation');
        out.messages.push('They have seen the ship. Whatever happens to that culture now, it happened because of this.');
        break;
      }

      case 'withdraw':
      default:
        out.messages.push('We withdraw.');
        break;
    }

    this.endEncounter();
    return out;
  }

  /** Resolve a hail during an encounter or engagement. */
  hail(optionId) {
    const enc = this.encounter;
    const eng = this.engagement;
    const factionId = enc?.factionId ?? eng?.hostiles?.[0]?.faction;
    if (!factionId) return { text: 'There is no one to hail.' };

    const enemyHull = eng
      ? eng.liveHostiles.reduce((n, s) => n + s.hullPct, 0) / Math.max(1, eng.liveHostiles.length)
      : 1;

    const result = resolveHail(this.rng, optionId, {
      factionId,
      // The Diplomatic Corps signature forces a hearing from a faction whose
      // doctrine would otherwise refuse the channel outright.
      forced: this.parleyForced === true,
      standing: this.ledger.standingOf(factionId),
      diplomacyBonus: this.progress.diplomacyBonus,
      winning: eng ? this.ship.hullPct > enemyHull : false,
      playerHullPct: this.ship.hullPct,
      enemyHullPct: enemyHull,
      firstStrike: this.firstStrike,
    });

    this.parleyForced = false;
    this.pushLog(result.text, 'comms');
    if (result.standingDelta) {
      this.ledger.adjustStanding(factionId, result.standingDelta, 'Hail');
    }
    if (result.xp) this.progress.addXP(result.xp, { ledger: this.ledger });

    if (result.surrender) {
      this.ledger.record('surrender_accepted', { text: 'Accepted a surrender', faction: factionId });
      this.earnReputation('accepted_surrender');
    }

    if (result.endsCombat) {
      if (eng) { eng.end(result.outcome); }
      else this.endEncounter();
      // `end` settles the fight on the spot — see Engagement.end — so by the
      // line below there is no engagement left and the bridge is already back
      // to normal. Setting the alert again is what makes the ENCOUNTER branch
      // stand down too.
      this.setAlert('normal');
    }
    if (result.enraged && eng) {
      for (const s of eng.liveHostiles) s.fleeing = false;
    }
    emit('hail:result', result);
    return result;
  }

  endEncounter() {
    this.encounter = null;
    if (this.mode === MODES.ENCOUNTER) this.mode = MODES.BRIDGE;
    if (this.alert !== 'red') this.setAlert('normal');
    emit('encounter:end');
  }

  // ------------------------------------------------------------------ combat

  /**
   * Difficulty's main lever above Lieutenant is how many hulls arrive, not how
   * much each one absorbs. Reinforcements are cloned from the classes already
   * present, so an encounter never has to know the difficulty setting.
   *
   * Capital ships are exempt: two Borg cubes is not a harder fight, it is a
   * different genre. Anything at tier 7 or above arrives alone.
   */
  scaleHostileFleet(hostiles) {
    const wanted = this.difficulty.enemyCount(hostiles.length);
    if (wanted <= hostiles.length) return hostiles;

    const capital = hostiles.some((s) => (s.cls.tier ?? 1) >= 7);
    if (capital) return hostiles;

    // Never field more than the tactical display can stay readable with.
    const target = Math.min(wanted, MAX_HOSTILES);
    const fleet = [...hostiles];
    for (let i = fleet.length; i < target; i++) {
      const source = hostiles[i % hostiles.length];
      fleet.push(new Ship(source.classId, {
        name: `${stripSuffix(source.name)} ${romanNumeral(Math.floor(i / hostiles.length) + 1)}`,
        faction: source.faction,
      }));
    }
    return fleet;
  }

  /**
   * Every fight in the game passes through here — encounters, mission-scripted
   * combat, and anything added later — so difficulty is applied to the enemy
   * at this one point rather than at each generator.
   */
  startCombat(hostiles, opts = {}) {
    if (!hostiles.length) return null;

    // One fight at a time.
    //
    // A second call used to overwrite `this.engagement` outright: the fight in
    // progress was dropped on the floor with no outcome, no experience, no
    // salvage and no ledger entry, and the ships in it simply stopped
    // existing. Two things can do that — an encounter rolled while another is
    // resolving, and a mission stage that starts a battle during one.
    if (this.engagement && !this.engagement.over) {
      this.engagement.pushLog('More of them, closing.', 'tactical');
      for (const s of this.scaleHostileFleet(hostiles)) this.engagement.hostiles.push(s);
      this.engagement.placeCombatants();
      return this.engagement;
    }

    // A battle is fought from the bridge. If the captain is standing on a
    // planet when one starts, the ship is over their head and they are not on
    // it — so they come back first, which is what the transporter is for and
    // what the crew would do without being asked.
    if (this.ashore) {
      this.pushLog('Emergency beam-out — the ship is under attack.', 'transporter');
      this.beamUp();
    }
    // And out of the turbolift. Somebody has the con while the captain walks,
    // and that is fine, but the walk itself is abandoned: you do not stroll to
    // the cargo bay through a firefight.
    this.walkOrder = null;

    // A fight drops the ship out of warp rather than leaving the transit
    // running underneath it — a course that keeps advancing during a battle
    // arrives somewhere else entirely once the battle ends.
    if (this.transit) {
      const near = this.transit.nearestSystem?.(this.galaxy);
      if (near) this.locationId = near.id;
      this.transit = null;
      this.pushLog('Dropping out of warp — we are under attack.', 'helm');
    }

    // A scripted scenario fields exactly the ships it names, unmodified. Both
    // levers otherwise apply: Fleet Admiral added a fourth Klingon to the
    // Kobayashi Maru and Story took a third off every hull in it.
    const fleet = opts.scripted ? hostiles : this.scaleHostileFleet(hostiles);
    if (!opts.scripted) {
      const enemyMods = this.difficulty.enemyMods();
      for (const s of fleet) s.applyMods(enemyMods);
    }

    // Signature powers are once per engagement, so a new one restores them.
    this.character?.refresh();

    this.setAlert('red');
    // `onEnd` is how a fight settles itself the moment it ends, from wherever
    // it ends. See Engagement.end.
    this.engagement = new Engagement(this.ship, fleet, this.rng, {
      ...opts, onEnd: () => this.resolveCombat(),
    });
    this.mode = MODES.COMBAT;
    // A new fight is a new call. Left set, the answer to "we need help" is
    // "we already asked" for the rest of the commission.
    this.helpCalled = false;
    this.helpInbound = null;
    this.engagement.pushLog(`${fleet.length} hostile contact${fleet.length > 1 ? 's' : ''}.`, 'tactical');
    emit('combat:begin', this.engagement);
    return this.engagement;
  }

  /**
   * Settle a fight that has ended, wherever it ended.
   *
   * The tick loop finishes fights that end during the engagement's own update
   * — a ship blows up, the last hostile runs. But a fight can also stop
   * because of something the captain SAID: a hail that is answered with a
   * surrender, the Kobayashi gambit that talks the Klingons down. Those run
   * from an order handler, outside the tick, and used to leave the game in
   * combat mode with a finished engagement until the next frame ticked.
   *
   * One frame is not nothing. The renderer draws between ticks, so the tactical
   * view painted a battle that was already over, the order bar still offered
   * "fire all weapons" at nobody, and the watchdog — correctly — reported the
   * game stuck in combat mode. This is the single place a finished fight is
   * cleared, and everything that can end one calls it.
   *
   * It is a no-op unless there is genuinely a finished fight to settle, so it
   * is safe to call speculatively. It must NOT be called from inside
   * `Engagement.update`, which is why `combat:end` no longer resolves it.
   */
  resolveCombat() {
    const eng = this.engagement;
    if (!eng?.over || this.mode !== MODES.COMBAT) return false;
    this.finishCombat(eng.outcome);
    return true;
  }

  /** Called when Engagement emits combat:end. */
  finishCombat(outcome) {
    const eng = this.engagement;
    if (!eng) return;

    // Was this real, or was it the simulator?
    //
    // Captured before the flags are cleared below, because losing the ship is
    // decided at the very end of this method and by then they are gone.
    const simulated = this.inKobayashi === true || this.scriptedScenario === true;

    const killed = eng.hostiles.filter((s) => s.destroyed);
    for (const s of killed) {
      this.ledger.destroyShip(s, { system: this.locationId, stardate: this.clock.stardate });
      this.ledger.adjustStanding(
        s.faction,
        s.civilian ? STANDING_EFFECTS.destroyed_civilian : STANDING_EFFECTS.destroyed_their_ship,
        'Ship destroyed in combat',
      );
    }

    // A hulk is stores, and it is left in space until somebody goes and gets
    // it. This used to strip itself automatically the instant the shooting
    // stopped — which made the "strip the wreck" order pure duplication, and
    // that order asked for no wreck, no fight and no cooldown, so it could be
    // given on an empty bridge in an empty system as many times as you liked
    // for as much material as you wanted. An infinite machine shop.
    //
    // Now the wreck is a thing that exists. Strip it, or leave the system and
    // lose it, which is the choice the comment here always claimed it was.
    if (killed.length && (outcome === 'victory' || outcome === 'routed')) {
      this.wreck = {
        tier: Math.max(...killed.map((s) => s.cls.tier ?? 1)),
        systemId: this.locationId,
        hulls: killed.length,
        name: killed[0].name,
      };
      this.officerSays('engineering',
        `${killed.length === 1 ? 'A hulk is' : `${killed.length} hulks are`} adrift off the port bow. Salvage teams are standing by, Captain.`,
        'report');
    }

    if (outcome === 'victory' || outcome === 'routed') {
      const xp = combatXP(eng.hostiles) * this.difficulty.scale('xpRate');
      // The Empire respects a captain who kept fighting while losing.
      if (this.ship.hullPct < 0.35) this.earnReputation('fought_while_losing');
      this.earnReputation('combat_victory');
      const promo = this.progress.addXP(xp, { ledger: this.ledger });
      this.pushLog(`Engagement concluded. +${Math.round(xp)} experience.`, 'captain');
      if (promo?.promoted) emit('captain:promoted', promo);
    }

    // Casualties from THIS fight.
    //
    // The count used to be `maxCrew - crew`, which is the standing deficit and
    // not what happened here: crew losses are permanent, so every subsequent
    // battle re-reported every death that had ever happened. A campaign that
    // lost eleven people in its first engagement then recorded eleven more in
    // the next one where nobody was hurt, and the ledger, the after-action
    // report and the post-fight panel all grew without bound.
    const lost = Math.max(0, Math.round((eng.crewAtStart ?? this.ship.maxCrew) - this.ship.crew));
    if (lost > 0) {
      this.ledger.record('lives_lost', {
        count: lost, text: `${lost} crew lost in action at ${this.location?.name}`, system: this.locationId,
      });
    }

    // The after-action record.
    //
    // The engagement itself is thrown away here, and it used to be the only
    // place the result of a fight existed — so anything that wanted to know how
    // the last battle went had to read a live engagement before it was cleared,
    // which is a race dressed up as an API. This survives the fight, which is
    // what an after-action report is for.
    this.lastCombat = {
      outcome,
      name: eng.name,
      killed: killed.length,
      hostiles: eng.hostiles.length,
      hullLeft: this.ship.hullPct,
      crewLost: lost,
      seconds: Math.round(eng.time),
      systemId: this.locationId,
      stardate: this.clock.stardate,
    };

    // If somebody else had the bridge for this, it is theirs to report.
    if (this.conStation) {
      const told = {
        victory: `We were engaged by ${eng.hostiles.length} hostile${eng.hostiles.length === 1 ? '' : 's'} and destroyed ${killed.length}.`,
        routed: `We were engaged and drove them off.`,
        escaped: `We were engaged and broke off. We did not stay to finish it.`,
        destroyed: `We were engaged, and we lost the ship.`,
        parley: `We were engaged, and it ended in a negotiation.`,
      }[outcome] ?? `We were engaged. The outcome was ${outcome}.`;
      this.conLines.push(`${told} Hull integrity is at ${Math.round(this.ship.hullPct * 100)} percent.`);
      if (lost > 0) this.conLines.push(`We lost ${lost} of the crew.`);
    }

    this.engagement = null;
    this.firstStrike = false;
    this.helpCalled = false;
    this.helpInbound = null;
    // The scenario and any channel forced open inside it end with the fight.
    // Left set, `gambitOpen` turns every later typed order into an appeal to a
    // Klingon commander who is no longer there.
    closeChannel(this);
    this.inKobayashi = false;
    if (this.scriptedScenario) {
      this.scriptedScenario = false;
      this.applyAllMods();   // hand the difficulty bonuses back
    }
    this.mode = MODES.BRIDGE;
    this.setAlert(outcome === 'destroyed' ? 'red' : 'normal');
    emit('combat:resolved', { outcome, killed });

    // The Kobayashi Maru is a simulator, and it is unwinnable by design. Taking
    // it therefore ended the commission — permanently, on every difficulty
    // where losing the ship is fatal, which is most of them. A cadet who runs
    // the no-win scenario does not lose their ship; they lose the scenario, and
    // the record of how they behaved is the entire point.
    if (outcome === 'destroyed' && !simulated) this.loseTheShip();
    else if (outcome === 'destroyed') {
      this.ship.restore();
      this.ship.crew = this.ship.maxCrew;
      this.pushLog('Simulation ends. The bridge lights come back up.', 'computer');
    }
  }

  // ------------------------------------------------------------------ missions

  availableMissions() {
    return this.missions.availableAt(this.locationId, this);
  }

  startMission(id) {
    const m = this.missions.start(id, this);
    if (m) {
      this.mode = MODES.MISSION;
      this.pushLog(`Mission: ${m.title}`, 'captain');
    }
    return m;
  }

  chooseMission(choiceId) {
    const m = this.missions.active;
    if (!m) return null;
    const result = m.choose(choiceId);
    if (!result) return null;

    for (const msg of result.effects?.messages ?? []) this.pushLog(msg, 'bridge');

    // A stage can start a fight.
    if (result.effects?.combat) {
      const spec = result.effects.combat;
      // Named, like every other hostile in the game. A mission stage used to
      // field "klingon vessel 1" while an ordinary encounter with the same
      // ship called it the IKS Rotarran.
      const ships = (spec.ships ?? []).map((cls, i) =>
        new Ship(cls, { name: hostileName(spec.faction, i), faction: spec.faction }));
      this.pendingCombat = { ships, returnToMission: true };
    }

    if (result.complete) {
      this.earnReputation('mission_complete');
      this.missions.finishActive();
      // Not while people are shooting. Setting the mode back to BRIDGE during a
      // battle orphaned the engagement completely: Game.update stopped stepping
      // it, so it never reached an end condition, never paid out, and never
      // went away — the fight simply froze mid-air and the ship was stuck in it
      // for the rest of the campaign.
      if (!this.engagement || this.engagement.over) this.mode = MODES.BRIDGE;
    }
    return result;
  }

  // ------------------------------------------------------------------ away teams

  buildAwayTeam(stations = ['science', 'medical', 'tactical'], captainLeads = false) {
    const members = stations.map((s) => this.crew.at(s)).filter(Boolean);
    this.awayTeam = new AwayTeam(members, {
      captainLeads,
      character: this.character,
      difficulty: this.difficulty,
    });
    return this.awayTeam;
  }

  /**
   * The away missions this situation actually supports.
   *
   * `AWAY_TEMPLATES` has held five multi-step landing parties since the away
   * system was written — board a derelict, evacuate a colony, open a
   * negotiation, run a covert survey, take a hostile bridge — with hazard
   * levels, per-step checks and difficulty classes on every one of them. No
   * code has ever read the table. The whole of the casualty model, the
   * officer-selection model and the consequence scaling was reachable through
   * exactly one mission-stage button.
   *
   * What decides availability is where you are and what is in front of you,
   * which is the same rule the rest of this game runs on.
   */
  availableAwayMissions() {
    const out = [];
    const eng = this.engagement;

    // Taking a bridge. The ship has to be beaten first — a boarding party does
    // not go through raised shields — and this is what makes crippling a
    // hostile a real alternative to killing it.
    const boardable = eng && !eng.over
      ? eng.liveHostiles.find((s) => !s.cloaked
        && s.shieldPct <= 0.05
        && (s.hullPct <= 0.35 || s.subsystems.engines <= 0.15)
        && this.ship.distanceTo(s) < 900)
      : null;
    if (boardable) out.push({ ...AWAY_TEMPLATES.boarding_action, target: boardable });

    // A hulk with its logs still in it. Stripping a wreck is the machine shop's
    // job; boarding one is the science officer's, and they are different orders
    // with different risks.
    if (!eng && this.wreckHere && !this.wreckHere.boarded) {
      out.push({ ...AWAY_TEMPLATES.derelict_search });
    }

    if (!eng) {
      const body = this.orbitBody;
      const sys = this.location;
      if (body && sys) {
        if (this.encounter?.kind === 'distress' || sys.type === 'colony') {
          out.push({ ...AWAY_TEMPLATES.colony_rescue });
        }
        if (sys.type === 'homeworld' || sys.type === 'core' || sys.faction !== 'none') {
          out.push({ ...AWAY_TEMPLATES.diplomatic_landing });
        }
        // A world that has not invented warp is one you do not announce
        // yourself to. The Prime Directive is the reason this template exists.
        if (sys.preWarp || sys.type === 'frontier' || sys.type === 'unexplored') {
          out.push({ ...AWAY_TEMPLATES.covert_landing });
        }
      }
    }

    return out;
  }

  /**
   * Send the landing party, and live with what comes back.
   *
   * Every step is a real check against the officer best suited to it, with the
   * hazard level deciding how badly a failure hurts — the machinery in
   * src/sim/away.js, which already models injuries, deaths, security losses,
   * difficulty scaling and permadeath, and which nothing has been able to reach
   * with more than one step at a time.
   *
   * A step that fails does not end the mission. The team presses on with the
   * next one and the outcome is how many of them worked, because "three of the
   * four went right and we lost a man doing it" is the kind of result this
   * game is about and a pass/fail is not.
   */
  awayMission(templateId) {
    if (this.ashore) {
      return { ok: false, reason: 'You are already on the surface, Captain.' };
    }
    const available = this.availableAwayMissions();
    const template = available.find((t) => t.id === templateId);
    if (!template) {
      return { ok: false, reason: 'There is nowhere to send a team, Captain.' };
    }
    if (this.ship.subsystems.transporter !== undefined
      && this.ship.subsystems.transporter < 0.3) {
      return { ok: false, reason: 'The transporters are down, Captain.' };
    }

    // Who goes. A boarding action is security's job; everything else takes the
    // department the first step needs.
    const stations = template.id === 'boarding_action'
      ? ['tactical', 'medical', 'engineering']
      : ['science', 'medical', 'tactical'];
    const team = this.buildAwayTeam(stations, false);
    if (!team.members.length) {
      return { ok: false, reason: 'There is nobody fit to send, Captain.' };
    }

    this.pushLog(`${template.title}. Landing party is away.`, 'transporter');
    const steps = [];
    for (const step of template.steps) {
      const r = team.check(this.rng, step.check, {
        dc: step.dc, hazard: template.hazard, label: step.text,
      });
      this.pushLog(`${step.text} — ${r.formatted}`, 'science');
      if (r.killed) this.pushLog(`We lost ${r.killed.name}.`, 'medical');
      else if (r.injured) this.pushLog(`${r.injured.name} is hurt.`, 'medical');
      steps.push({ text: step.text, success: r.success, officer: r.officer?.name ?? null });
      // A team that has nobody left standing does not carry on.
      if (!team.members.length) break;
    }

    const won = steps.filter((s) => s.success).length;
    const outcome = won === steps.length ? 'success'
      : won === 0 ? 'failure' : 'partial';
    const lost = team.casualties.filter((c) => c.killed).length;

    this.applyAwayOutcome(template, outcome, won, steps.length);

    const report = {
      ok: true, id: template.id, title: template.title, outcome,
      steps, passed: won, of: steps.length,
      casualties: team.casualties.slice(), lost,
    };
    this.lastAway = report;
    this.ledger.record('away_mission', {
      text: `${template.title}: ${won} of ${steps.length} objectives`
        + (lost ? `, ${lost} lost` : ''),
      system: this.locationId,
    });
    this.pushLog(
      `Landing party is back aboard. ${won} of ${steps.length} objectives.`
      + (lost ? ` We lost ${lost}.` : ''),
      'transporter',
    );
    emit('away:mission', report);
    return report;
  }

  /** What a landing party's result changes about the world it happened in. */
  applyAwayOutcome(template, outcome, won, total) {
    const share = total ? won / total : 0;
    this.progress.addXP(Math.round(120 * share * (HAZARD_LEVEL[template.hazard]?.death ?? 0.05) * 20),
      { ledger: this.ledger });

    if (template.id === 'boarding_action' && template.target) {
      const foe = template.target;
      if (outcome === 'success') {
        // A bridge taken is a ship that stops fighting. It is not a kill, and
        // the record is careful about the difference.
        foe.fleeing = true;
        foe.withdrawn = true;
        // A withdrawn ship is off the board, and a lock on one is the exact
        // state `eng.target.withdrawn` exists to report. Clear it here rather
        // than waiting for the next tick to re-acquire, because the renderer
        // draws between ticks and would put a reticle on a ship that has gone.
        if (this.engagement?.target === foe) {
          this.engagement.target = this.engagement.liveHostiles[0] ?? null;
        }
        this.engagement?.pushLog(
          `${foe.name} is ours, Captain. Her crew have stood down.`, 'tactical');
        // Taking the last bridge on the board ends the battle THERE. Left to
        // the next tick, the fight spends a frame with nobody left to shoot
        // and `over` still false, which is the soft-lock shape exactly.
        this.engagement?.settle();
        this.ledger.record('ship_captured', {
          text: `${foe.name} boarded and taken`, faction: foe.faction, system: this.locationId,
        });
        this.earnReputation('accepted_surrender');
      } else if (outcome === 'failure') {
        this.engagement?.pushLog(
          'They have repelled the boarding party, Captain.', 'tactical');
      }
      return;
    }

    if (template.id === 'derelict_search' && this.wreck) {
      this.wreck.boarded = true;
      if (share >= 0.5) this.earnReputation('anomaly_catalogued');
    }
    if (template.id === 'colony_rescue' && outcome !== 'failure') {
      this.earnReputation(outcome === 'success' ? 'colony_saved' : 'distress_answered');
    }
    if (template.id === 'diplomatic_landing' && outcome === 'success') {
      this.earnReputation('first_contact');
    }
    if (template.id === 'covert_landing' && outcome === 'failure') {
      // Being seen is the failure that matters here, and it is not free.
      this.ledger.adjustStanding('federation', -6, 'Observed by a pre-warp culture');
      this.pushLog(
        'We were seen, Captain. That will be in the report to the Prime Directive board.',
        'science');
    }
  }

  /**
   * Survey a thing on a planet you have walked up to.
   *
   * The whole of the away-team machinery already existed and was reachable only
   * from a mission stage — a button in a text panel. This is the same machinery
   * reached the way the rest of the game is reached: by being somewhere and
   * using what is in front of you. The captain is on the surface, the captain
   * is standing at the outcrop, so the captain is the one leading it.
   *
   * Each feature resolves once. A seam you have already cut out is not a seam.
   */
  surveyFeature(featureId) {
    if (!this.ashore) return { ok: false, error: 'We are not on a surface, Captain.' };
    const room = this.walk.room;
    const feature = (room.stations ?? []).find((st) => st.id === featureId);
    if (!feature) return { ok: false, error: 'There is nothing there, Captain.' };

    this.surveyed = this.surveyed ?? {};
    const key = `${room.world}:${featureId}`;
    if (this.surveyed[key]) {
      return { ok: false, error: 'We have already been over that one, Captain.', done: true };
    }

    const team = this.buildAwayTeam(['science', 'medical', 'tactical'], true);
    const result = team.check(this.rng, feature.check, {
      hazard: feature.hazard,
      label: feature.label,
    });

    this.surveyed[key] = result.success ? 'found' : 'empty';

    if (result.success) {
      this.stores = this.stores ?? {};
      for (const [material, amount] of Object.entries(feature.yield ?? {})) {
        this.stores[material] = (this.stores[material] ?? 0) + amount;
      }
      this.pushLog(`${feature.label}: ${feature.found}`, 'science');
      this.ledger.record('anomaly_catalogued', {
        text: `Surveyed ${feature.label.toLowerCase()} on ${room.name}`,
        system: this.locationId,
      });
      this.progress.addXP(60, { ledger: this.ledger });
    } else {
      this.pushLog(`${feature.label}: ${feature.failed}`, 'science');
    }

    emit('survey', { feature, result });
    return { ok: true, feature, result };
  }

  // ------------------------------------------------------------- calling for help

  /**
   * Ask for a hand, and find out whether Starfleet is close enough to give one.
   *
   * `Engagement` has supported allies since it was written: they are placed on
   * the board, flown by the AI, drawn by all three renderers, targeted by
   * hostiles and counted by every rule in the invariant checker. Nothing in the
   * game ever created one. A whole side of the battle existed and was
   * unreachable, which on this project is the shape of about half the bugs.
   *
   * What decides it is the thing a captain would expect to decide it: where
   * you are and what your record says. Inside Federation space with a service
   * record Starfleet respects, somebody diverts. Deep in the Neutral Zone with
   * a record of shooting first, nobody does, and the reply says which.
   *
   * The help does not arrive instantly. A ship at warp takes time, and the
   * gap between the call and the arrival is the point — it is a decision about
   * whether you can hold on that long, not a button that wins the fight.
   */
  callForHelp() {
    const eng = this.engagement;
    if (!eng || eng.over) {
      return { ok: false, reason: 'There is no one shooting at us, Captain.' };
    }
    if (this.helpCalled) {
      return { ok: false, reason: 'We have already made the call, Captain. They are coming.' };
    }
    if (this.inKobayashi) {
      // The whole point of the scenario is that nobody is coming.
      return { ok: false, reason: 'No response on any Starfleet frequency. We are alone out here.' };
    }
    if (this.ship.subsystems.comms < 0.25) {
      return { ok: false, reason: 'Long-range communications are out, Captain. Nobody can hear us.' };
    }

    const here = this.location;
    const friendly = here?.faction === 'federation';
    const standing = this.ledger.standingOf('federation');
    const tier = this.reputation?.track('federation')?.tier ?? 0;

    // Somebody has to be near enough to come. Federation space always has a
    // patrol in it; outside it, only a record good enough to make a captain
    // break off what they are doing will bring one.
    if (!friendly && tier < 2) {
      this.helpCalled = true;
      this.pushLog('No Starfleet units within range, Captain. We are on our own.', 'comms');
      return { ok: true, answered: false, reason: 'No Starfleet units within range.' };
    }
    if (standing < -20) {
      this.helpCalled = true;
      this.pushLog(
        'Starfleet acknowledges the call and does not respond further, Captain.',
        'comms',
      );
      return { ok: true, answered: false, reason: 'Starfleet acknowledged and did not respond.' };
    }

    // What answers scales with the record. A commendable captain gets a
    // cruiser; a new one gets whatever was closest.
    const classId = tier >= 3 ? 'excelsior' : (tier >= 1 ? 'constitution' : 'miranda');
    // From the one ship-name table in src/sim/combat.js. A fourth private list
    // of Starfleet names is how the same vessel ends up called two things.
    const name = hostileName(
      'federation',
      Math.floor(this.rng.float() * HOSTILE_NAMES.federation.length),
    );
    // Between eighteen and forty seconds of holding on.
    const eta = 18 + this.rng.float() * 22;
    this.helpCalled = true;
    this.helpInbound = { classId, name, eta };
    this.pushLog(
      `${this.helpInbound.name} answers, Captain — she is coming about now. `
      + `Estimated ${Math.round(eta)} seconds.`,
      'comms',
    );
    emit('help:called', this.helpInbound);
    return { ok: true, answered: true, eta, ship: this.helpInbound.name };
  }

  /**
   * Bring the help in when its clock runs out.
   *
   * Called from the tick, so a fight that ends before the ETA simply never
   * sees it — which is right: they turn round and go home, and the log has
   * already said they were coming.
   */
  updateHelp(dt) {
    const inbound = this.helpInbound;
    if (!inbound) return;
    const eng = this.engagement;
    if (!eng || eng.over) { this.helpInbound = null; return; }

    inbound.eta -= dt;
    if (inbound.eta > 0) return;
    this.helpInbound = null;

    const ally = new Ship(inbound.classId, { name: inbound.name, faction: 'federation' });
    eng.allies.push(ally);
    eng.placeCombatants();
    eng.pushLog(`${ally.name} dropping out of warp, Captain. She is engaging.`, 'comms');
    // No reputation for being rescued. Whatever the fleet thinks of a captain
    // who needed help, it is not a commendation, and the ledger already
    // records the engagement itself.
    emit('help:arrived', ally);
  }

  // ------------------------------------------------------------------ docking

  canDock() {
    const sys = this.location;
    if (!sys?.facilities?.includes('dock')) return false;
    if (sys.requiresStanding) {
      for (const [f, v] of Object.entries(sys.requiresStanding)) {
        if (this.ledger.standingOf(f) < v) return false;
      }
    }
    return true;
  }

  dock() {
    // Not in the middle of a firefight. "Request docking" restores the hull,
    // the shields, every subsystem, the magazine and the whole crew — so given
    // during a battle it was a full repair, instantly, for nothing, and it
    // could be given again on the next tick.
    if (this.engagement && !this.engagement.over) {
      return { ok: false, error: 'Nobody is opening a spacedock door for us while we are under fire, Captain.' };
    }
    if (!this.canDock()) return { ok: false, error: 'No docking facilities here, Captain.' };
    const damaged = this.ship.hullPct < 1 || this.ship.crew < this.ship.maxCrew;
    this.ship.restore();
    // Replacements for the dead. The names in the ledger do not come back.
    this.ship.crew = this.ship.maxCrew;
    for (const o of this.crew.officers) {
      if (o.injured) { o.injured = false; o.injurySeverity = 0; }
    }
    this.clock.advanceStardate(damaged ? 2.5 : 0.5);
    this.pushLog(`Docked at ${this.location.name}. Repairs and resupply complete.`, 'engineering');
    emit('docked', this.location);
    return { ok: true };
  }

  // ------------------------------------------------------------------ tick

  update(dt) {
    this.crew.update(dt * (1 + this.progress.officerCooldownBonus));
    this.updateWalk(dt);
    // Keep the ledger's clock current, so anything recorded during this tick is
    // stamped without every caller having to remember to pass a date.
    this.ledger.stardate = this.clock.stardate;
    this.watchdog?.tick(this, { arenaRadius: ARENA_RADIUS });
    // A watch is time somebody stood, not only time the app was closed.
    //
    // conHours was written by syncCampaign alone, so an officer who held the
    // bridge through a battle while the captain was three decks down handed it
    // back with "I had the con for the last hour. Nothing to report."
    if (this.conStation) this.conHours += dt / 3600;

    switch (this.mode) {
      case MODES.TRANSIT: {
        if (!this.transit) { this.mode = MODES.BRIDGE; break; }
        const state = this.transit.update(dt);
        if (state === 'arrived') this.arrive();
        else if (this.rng.chance(0.02 * dt) && !this.transit.interrupted) {
          // Something drops us out of warp mid-course.
          const enc = rollEncounter(this.rng, this.transit.to.id, { ledger: this.ledger, inTransit: true });
          if (enc && enc.hostile) {
            this.transit.interrupt('hostile contact');
            const near = this.transit.nearestSystem(this.galaxy);
            this.locationId = near.id;
            this.transit = null;
            this.pushLog('We have been forced out of warp.', 'helm');
            this.beginEncounter(enc);
          }
        }
        break;
      }

      case MODES.COMBAT: {
        if (!this.engagement) { this.mode = MODES.BRIDGE; break; }
        this.updateHelp(dt);
        this.engagement.update(dt);
        // The game finishes its own fights.
        //
        // Everything that happens after a battle — the experience, the salvage,
        // the faction standing, the casualty record, losing the ship — used to
        // run from one `on('combat:end')` listener in main.js, which is to say
        // it only ran when a screen was attached. Headless, a fight ended and
        // nothing followed it: the engagement stayed non-null and over, the
        // mode stayed COMBAT, and every test that fought a battle went on to
        // assert against a state the real app never has.
        //
        // Doing it here rather than in the event also stops it being
        // re-entrant. `end()` emits from inside `engagement.update()`, so the
        // old listener nulled `this.engagement` while the engagement's own
        // update was still on the stack, one frame short of touching a field
        // on an object the game had already thrown away.
        this.resolveCombat();
        break;
      }

      case MODES.BRIDGE:
      case MODES.ENCOUNTER: {
        const msg = environmentalHazard(this.location, this.ship, this.rng, dt);
        if (msg) this.pushLog(msg, 'science');
        break;
      }

      default:
        break;
    }

    // A mission stage queued a fight; start it once the UI has caught up.
    if (this.pendingCombat && this.mode !== MODES.COMBAT) {
      const { ships } = this.pendingCombat;
      this.pendingCombat = null;
      this.startCombat(ships, { name: 'Engagement' });
    }
  }

  /**
   * The ship has been destroyed. Whether that ends the commission is a
   * difficulty setting the game already advertises and never honoured.
   *
   * Story and Cadet both say, on the difficulty screen, that "the ship cannot
   * be lost". Nothing read the flag, so losing your ship on Story ended the
   * commission exactly as it does on Fleet Admiral. It is not free at the lower
   * rungs either — you are towed in with a third of a hull and the log says so.
   */
  loseTheShip() {
    if (this.difficulty?.def?.shipLoss !== false) {
      return this.gameOver('ship lost with all hands');
    }

    this.ship.restore();
    // A crew, too. `restore` puts the hull and the systems back and says
    // nothing about the people, so a ship recovered after being destroyed by
    // total crew loss came back with nobody aboard — and Ship.update destroys
    // a ship with no crew, so it was killed again on the first tick of every
    // subsequent fight, forever. Replacements are found at the next starbase;
    // that is what "under tow" means.
    this.ship.crew = Math.max(this.ship.crew, Math.round(this.ship.maxCrew * 0.6));
    this.ship.hull = this.ship.maxHull * 0.3;
    for (const f of Object.keys(this.ship.shields)) this.ship.shields[f] = 0;
    this.ship.shieldsUp = false;
    this.ship.torpedoes = Math.floor(this.ship.maxTorpedoes * 0.25);
    this.ship.antimatter = Math.min(this.ship.antimatter, 35);

    this.pushLog(
      `${this.ship.name} was left adrift and under tow. Salvage crews have her at `
      + '30% hull, no shields, and a quarter magazine. The record stands.',
      'engineering',
    );
    this.ledger.record('ship_crippled', {
      text: `${this.ship.name} lost and recovered at ${this.location?.name ?? 'unknown'}`,
      system: this.locationId,
    });
    emit('ship:recovered', { ship: this.ship });
  }

  gameOver(reason) {
    this.over = true;
    this.overReason = reason;
    emit('game:over', { reason, ledger: this.ledger, assessment: this.ledger.assessment() });
  }

  // ------------------------------------------------------------------ save

  save() {
    return {
      version: 2,
      seed: this.seed.toString(),
      rng: this.rng.save(),
      captain: this.captain,
      character: this.character.save(),
      reputation: this.reputation.save(),
      difficulty: this.difficulty.save(),
      crewMode: this.crewMode,
      era: this.era,
      crew: this.crew.save(),
      ship: this.ship.save(),
      progress: this.progress.save(),
      loadout: this.loadout.save(),
      ledger: this.ledger.save(),
      galaxy: this.galaxy.save(),
      missions: this.missions.save(),
      locationId: this.locationId,
      stardate: this.clock.stardate,
      latinum: this.latinum,
      log: this.log.slice(-80),
      over: this.over ?? false,
      campaign: this.campaign?.save() ?? null,
      stores: this.stores,
      fabrication: this.fabrication,
      devices: this.devices,
      kobayashiRuns: this.kobayashiRuns ?? 0,

      // Runtime flags. These are cheap to write and expensive to lose: the
      // promotion feat vanishes without `pendingFeats`, and the ion pod comes
      // back from the dead without `podJettisoned`.
      pendingFeats: this.pendingFeats ?? 0,
      podJettisoned: this.podJettisoned === true,
      warpFactor: this.warpFactor,
      walk: this.walk.save(),
      // Which surface features have already been worked.
      //
      // Left out, every landing site reset on reload: the same outcrop could
      // be surveyed again for the same materials, the same experience and the
      // same ledger entry, indefinitely, by quitting to the menu and coming
      // back. A survey is a thing you did, and it stays done.
      surveyed: { ...(this.surveyed ?? {}) },
      wreck: this.wreck ?? null,
      // The watch, and what it has to report. A station id rather than the
      // officer, because the roster is rebuilt from its own record on load and
      // an officer object saved here would be a second, stale copy of them.
      con: this.conStation
        ? { station: this.conStation, given: this.conGiven === true, hours: this.conHours, lines: this.conLines }
        : null,
      // Two ids, not a position. The vista is regenerated from the system id on
      // load and is identical every time, so the world is still exactly where
      // it was — saving coordinates would only give them a chance to disagree.
      orbit: this.orbit ? { systemId: this.orbit.systemId, bodyId: this.orbit.bodyId } : null,
      firstStrike: this.firstStrike === true,
      inKobayashi: this.inKobayashi === true,
      gambitOpen: this.gambitOpen === true,
      parleyForced: this.parleyForced === true,
    };
  }

  // -------------------------------------------------- the five-year mission

  /**
   * Credit the time that passed while nobody was watching.
   *
   * Called on load and whenever the app comes back to the foreground. The ship
   * repairs, fires burn out, injured officers recover, and the stardate
   * advances — all in proportion to real hours, and all capped so a month away
   * does not hand back a pristine ship in one instant.
   *
   * @returns {{hours: number, lines: string[]}}
   */
  syncCampaign() {
    if (!this.campaign) return { hours: 0, lines: [] };
    const { hours, forfeited, wentBackwards } = this.campaign.sync();
    const pending = this.campaign.drainPending();
    if (pending <= 0) {
      // The clock going backwards is worth a line in the log: it is the kind of
      // thing a player should be told happened rather than left to wonder about
      // when their commission stops advancing.
      if (wentBackwards) {
        this.pushLog('Chronometer resynchronised against Starfleet time base.', 'science');
      }
      return { hours: 0, lines: [] };
    }

    // Time passes during a firefight; damage control does not get to rebuild
    // your shields in the middle of one. Without this guard, backgrounding the
    // app for three days mid-engagement returned hull 20% -> 43%, shields
    // 0% -> 100% and fires 3 -> 0 while a Klingon was still shooting.
    const fighting = !!this.engagement && !this.engagement.over;

    const ship = this.ship;
    const before = { hull: ship.hullPct, fires: ship.fires };

    // Repair: a full hull from nothing would take about a fortnight underway,
    // which is slower than a starbase and faster than nothing.
    if (!fighting && ship.hullPct < 1 && !ship.destroyed) {
      const perHour = ship.maxHull / (14 * 24);
      ship.repair(perHour * pending * ship.mod('repairRate'));
    }

    // Fires go out. Slowly, and one at a time.
    if (!fighting && ship.fires > 0) ship.fires = Math.max(0, ship.fires - Math.floor(pending / 6));

    // Shields recharge to full given a quiet watch.
    if (!fighting && pending > 2 && ship.shieldsUp) {
      for (const f of Object.keys(ship.shields)) ship.shields[f] = ship.maxShield;
    }

    // The crew heals, and the dead stay dead.
    if (!fighting) {
      for (const officer of this.crew.officers) {
        if (officer.alive && officer.injured) officer.recover?.(pending);
      }
    }

    // The machine shop works too. A two-day job is a two-day job whether you
    // are watching it or not — which is what makes committing to one a
    // decision rather than a button.
    const finished = fighting ? null : advanceFabrication(this, pending);
    if (finished) {
      this.pushLog(`${finished.recipe.name} completed while you were away. ${finished.text}`, 'engineering');
    }

    // One stardate unit is roughly a day.
    this.clock.advanceStardate(pending / 24);

    const lines = fighting
      ? [`${pending < 24 ? `${Math.round(pending)} hours` : `${(pending / 24).toFixed(1)} days`} have passed, and we are still under fire. Nothing has been repaired.`]
      : absenceReport(pending, { ship, forfeited });
    if (before.fires > 0 && ship.fires === 0) {
      lines.push('All fires are out. Damage control has secured the affected decks.');
    }
    if (ship.hullPct > before.hull + 0.02) {
      lines.push(`Hull integrity is up from ${Math.round(before.hull * 100)} to ${Math.round(ship.hullPct * 100)} percent.`);
    }
    // Somebody had this ship while you were gone.
    //
    // If the captain walked away without handing the con over — closed the app
    // in the chair, which is how it usually happens — the watch officer took it,
    // because that is what a watch is for. Everything that happened is theirs
    // to report, and they report it the moment the captain is back on the
    // bridge to hear it. Off the bridge, they hold on to it and say so.
    if (!this.conStation) this.handOverCon(null, { given: false, spoken: false });
    const relief = this.conOfficer;

    let report = lines;
    if (relief) {
      this.conHours += pending;
      this.conLines.push(...lines);
      if (this.onBridge) {
        report = this.takeCon().lines;
      } else {
        report = [`${relief.rank} ${relief.name} has the con and is standing by to report.`];
        this.pushLog(report[0], 'bridge');
      }
    } else {
      for (const line of lines) this.pushLog(line, 'engineering');
    }

    emit('campaign:resumed', { hours: pending, lines: report });
    return { hours: pending, lines: report };
  }

  // ------------------------------------------------- the Kobayashi Maru

  /**
   * Run the scenario. Available from the first day, and unwinnable.
   *
   * It is not tuned and it is not meant to be survived. What the simulator
   * measures is what you do when there is nothing to be done, and the log
   * records that whether you lived or not.
   */
  runKobayashiMaru() {
    this.kobayashiRuns = (this.kobayashiRuns ?? 0) + 1;
    this.inKobayashi = true;
    const hostiles = KOBAYASHI.hostiles.map((id, i) => new Ship(id, {
      faction: 'klingon',
      name: ['IKS Kh’Tevak', 'IKS Amar', 'IKS Klothos'][i] ?? `IKS Vessel ${i + 1}`,
    }));
    for (const line of KOBAYASHI.briefing) this.pushLog(line, 'computer');
    // Fixed parameters for everyone, at every rung of the ladder.
    this.scriptedScenario = true;
    this.applyAllMods();
    this.startCombat(hostiles, {
      name: KOBAYASHI.title,
      canWarpOut: false,
      relentless: KOBAYASHI.relentless,
      scripted: true,
    });
  }

  /** Whether the technique is available, and if not, why not. */
  get gambit() {
    return gambitStatus(this);
  }

  /** Make them answer a hail they have no intention of answering. */
  forceChannel() {
    const r = forceChannel(this);
    if (r.ok) {
      this.pushLog('All hailing frequencies — forced open. They are receiving whether they like it or not.', 'comms');
    }
    return r;
  }

  /** Say your piece. What you typed is the input; the ledger is the judge. */
  makeAppeal(text) {
    // There has to be somebody listening.
    //
    // Closing the channel on load fixes the reload route into this, but the
    // door itself belongs here: an appeal is a thing you say to a commander who
    // is shooting at you, and without a live fight it wrote a permanent
    // `kobayashi_maru_solved` to the ledger and paid the reputation for a
    // sentence typed on a quiet bridge.
    if (!this.engagement || this.engagement.over || !this.engagement.liveHostiles?.length) {
      closeChannel(this);
      return { success: false, text, reply: 'There is no one on the channel, Captain.' };
    }
    const outcome = resolveGambit(this, text);
    this.pushLog(`Captain, to the Klingon commander: "${outcome.text}"`, 'captain');
    this.pushLog(outcome.reply, 'comms');

    if (outcome.success) {
      // The freighter comes off. The engagement simply stops.
      if (this.engagement && !this.engagement.over) this.engagement.end('parley');
      this.inKobayashi = false;
    }
    return outcome;
  }

  /** The record the appeal will be judged against, for the UI to show first. */
  get serviceRecord() {
    return recordOf(this);
  }

  /** Start a job in the machine shop. */
  fabricate(recipeId) {
    // The machine shop is not a combat action. Left unguarded, a hull patch
    // could be started and finished under fire — hours of work compressed into
    // a battle, repeatedly, which is a free repair with extra steps.
    if (this.engagement && !this.engagement.over) {
      return { ok: false, error: 'The shop is sealed at red alert, Captain.' };
    }
    return beginFabrication(this, recipeId);
  }

  /**
   * Work the shop for a stretch of hours the player has chosen to spend, rather
   * than hours that merely passed. Costs the same time on the stardate.
   */
  workTheShop(hours = 1) {
    if (this.engagement && !this.engagement.over) {
      return { ok: false, error: 'Not while we are under fire, Captain.' };
    }
    if (!this.fabrication) return { ok: false, reason: 'Nothing on the bench, Captain.' };
    const done = advanceFabrication(this, hours);
    this.clock.advanceStardate(hours / 24);
    return { ok: true, done, remaining: this.fabrication?.hoursRemaining ?? 0 };
  }

  /** Strip a wreck for stores. */
  salvage(opts = {}) {
    return salvageWreck(this, this.rng, opts);
  }

  /** Is there anything out there worth sending a team to? */
  get wreckHere() {
    return this.wreck && this.wreck.systemId === this.locationId ? this.wreck : null;
  }

  /**
   * Send the salvage teams across.
   *
   * Once per wreck, and only where the wreck actually is. Refusals rather than
   * a silent no-op, because "strip the wreck" with nothing to strip used to
   * hand over materials anyway.
   */
  stripWreck() {
    const wreck = this.wreckHere;
    if (!wreck) {
      return { ok: false, reason: 'There is nothing out there to strip, Captain.' };
    }
    if (this.engagement && !this.engagement.over) {
      return { ok: false, reason: 'Not while we are still under fire, Captain.' };
    }
    const haul = this.salvage({ tier: wreck.tier });
    this.wreck = null;
    const summary = Object.entries(haul)
      .filter(([, n]) => n > 0)
      .map(([m, n]) => `${n} ${m}`)
      .join(', ');
    this.officerSays('engineering',
      summary ? `Salvage teams recovered ${summary} from the wreckage.`
        : 'There was nothing left worth bringing aboard, Captain.', 'report');
    return { ok: true, haul, summary };
  }

  /** What the shop is building, in a form the UI can render. */
  get fabricationStatus() {
    if (!this.fabrication) return null;
    const recipe = RECIPE_BY_ID[this.fabrication.recipeId];
    return {
      name: recipe?.name ?? 'Unknown work',
      hoursRemaining: this.fabrication.hoursRemaining,
      progress: 1 - this.fabrication.hoursRemaining / Math.max(1e-6, this.fabrication.hoursTotal),
    };
  }

  /** How far through the five-year mission this commission is. */
  get commissionProgress() {
    return this.campaign?.progress ?? 0;
  }

  static load(data, opts = {}) {
    const g = new Game({
      seed: BigInt(data.seed),
      captainName: data.captain?.name,
      crewMode: data.crewMode,
      era: data.era,
      // Version 1 saves predate the character sheet; Character's own
      // defaults fill the gaps rather than failing the load.
      character: data.character ?? undefined,
      difficulty: data.difficulty?.id,
      now: opts.now,
    });
    g.rng = RNG.load(data.rng);
    g.captain = { ...g.captain, ...data.captain };
    g.crew = Crew.load(data.crew);
    g.ship = Ship.load(data.ship);
    g.progress = CaptainProgress.load(data.progress);
    g.loadout = Loadout.load(data.loadout, g.ship.cls.slots);
    g.ledger = Ledger.load(data.ledger);
    g.reputation = Reputation.load(data.reputation);
    g.difficulty = DifficultySettings.load(data.difficulty);
    g.galaxy.load(data.galaxy);
    g.missions.load(data.missions, g);
    g.locationId = data.locationId ?? 'sol';
    g.clock = new Clock(data.stardate ?? 4523.3);
    g.latinum = data.latinum ?? 500;
    g.log = data.log ?? [];
    g.over = data.over ?? false;
    g.mode = MODES.BRIDGE;

    // A save from before the commission clock existed starts its five years
    // now rather than pretending the time already passed. Nobody should lose a
    // campaign they had not begun.
    g.campaign = CampaignClock.load(data.campaign, opts.now ?? undefined);
    if (opts.compression) g.campaign.compression = opts.compression;

    g.stores = { ...STARTING_STORES, ...(data.stores ?? {}) };
    g.fabrication = data.fabrication ?? null;
    g.devices = data.devices ?? {};
    g.kobayashiRuns = data.kobayashiRuns ?? 0;

    // Older saves predate these fields; they load as their off state rather
    // than as undefined, so a `=== true` check downstream stays meaningful.
    g.pendingFeats = data.pendingFeats ?? 0;
    g.podJettisoned = data.podJettisoned === true;
    // Records written before the flip switches existed have no standing
    // factor, and six is what the game used to assume.
    g.warpFactor = Number(data.warpFactor) > 0 ? Number(data.warpFactor) : 6;
    // Records written before the ship had an inside put you in the chair,
    // which is where every commission starts anyway.
    g.walk = Walker.load(data.walk ?? {});
    g.walkOrder = null;
    // Records written before there was a watch put the captain back in the
    // chair with the con, which is what they had.
    g.surveyed = { ...(data.surveyed ?? {}) };
    g.wreck = data.wreck ?? null;
    g.conStation = data.con?.station ?? null;
    g.conGiven = data.con?.given === true;
    g.conHours = Number(data.con?.hours) || 0;
    g.conLines = Array.isArray(data.con?.lines) ? data.con.lines.slice() : [];
    // An orbit only survives if it belongs to where the ship actually is. A
    // record saved mid-transit, or one carrying a body that no longer exists,
    // restores to station-keeping rather than to an orbit of nothing.
    const orb = data.orbit;
    g.orbit = orb && typeof orb.bodyId === 'string' && orb.systemId === g.locationId
      ? { systemId: orb.systemId, bodyId: orb.bodyId }
      : null;
    if (g.orbit && !g.orbitBody) g.orbit = null;
    // A record saved with the captain on a planet has to rebuild the planet
    // before it can put them back on it. `Walker.load` has already fallen back
    // to the bridge, because the room did not exist a moment ago — the position
    // it read out of the save is still the one it was standing at, so restoring
    // the id is enough to put the boots back in the same footprints.
    if (data.walk?.roomId === 'surface' && g.orbitBody) {
      makeSurface(g.orbitBody, g.orbitLabel);
      g.walk.roomId = 'surface';
      // And put them back where they were standing.
      //
      // `Walker.load` resolves the saved coordinates against the room it can
      // see, and at that point the surface does not exist yet — so it resolved
      // against the bridge fallback and a captain saved half a kilometre out
      // among the outcrops woke up on the beam-in point. The room exists now,
      // so the raw position can be resolved against the right geometry.
      const [sx, sz] = resolveIn(ROOMS.surface, Number(data.walk.x) || 0, Number(data.walk.z) || 0);
      g.walk.x = sx;
      g.walk.z = sz;
    }
    g.firstStrike = data.firstStrike === true;
    // Set below, alongside the channel it belongs to.
    // A forced channel does NOT survive a reload.
    //
    // The engagement is not restored — a fight cannot be saved — so restoring
    // the flags that belong to it left the order line hijacked with nobody on
    // the other end. `finishCombat` closes the channel for exactly this reason
    // and its comment says so; the load path reached the same state by another
    // door and never ran it. The result was that the no-win scenario could be
    // beaten by force-quitting it and then typing one sentence on an empty
    // bridge: a scoring appeal wrote `kobayashi_maru_solved` to the permanent
    // ledger and paid the reputation, with no Klingons and no freighter.
    g.gambitOpen = false;
    g.parleyForced = false;
    g.inKobayashi = false;

    g.applyAllMods();
    return g;
  }
}

export { SYSTEM_BY_ID };
