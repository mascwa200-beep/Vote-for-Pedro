// The Game object: everything the simulation owns, in one place.

import { RNG, hashSeed } from './rng.js';
import { Clock } from './time.js';
import { Ledger } from './ledger.js';
import { emit } from './events.js';

import { Ship } from '../sim/ship.js';
import { Crew, Officer } from '../sim/officers.js';
import { CaptainProgress, combatXP } from '../sim/skills.js';
import { Loadout, startingLoadout } from '../sim/loadout.js';
import { Engagement } from '../sim/combat.js';
import { AwayTeam } from '../sim/away.js';
import { resolveHail, STANDING_EFFECTS } from '../sim/diplomacy.js';

import { Galaxy, plotTransit } from '../world/galaxy.js';
import { rollEncounter, environmentalHazard } from '../world/encounters.js';
import { buildRoster, ERAS } from '../world/crews.data.js';
import { getShipClass, FEDERATION_REGISTRIES } from '../world/ships.data.js';
import { SYSTEM_BY_ID } from '../world/systems.data.js';

import { MissionBook } from '../missions/engine.js';
import { EPISODES } from '../missions/episodes/index.js';

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

    // ---- captain ----
    this.captain = {
      name: options.captainName ?? 'Kirk',
      firstName: options.captainFirstName ?? 'James',
      species: options.species ?? 'Human',
      pronouns: options.pronouns ?? 'they/them',
      background: options.background ?? 'command',
      serialNumber: options.serialNumber ?? 'SC-937-0176-CEC',
    };

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
    this.missions = new MissionBook(EPISODES);
    this.locationId = options.startAt ?? 'sol';
    this.galaxy.markVisited(this.locationId);

    // ---- runtime ----
    this.mode = MODES.BRIDGE;
    this.transit = null;
    this.engagement = null;
    this.encounter = null;
    this.awayTeam = null;
    this.alert = 'normal';
    this.log = [];
    this.pendingCombat = null;
    this.firstStrike = false;
    this.latinum = 500;

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
      damageResist: 0, stealthDetect: 1,
    };
    this.ship.applyMods(this.progress.shipMods());
    this.ship.applyMods(this.loadout.shipMods());
    const eps = this.loadout.special('powerTransfer');
    if (eps) this.ship.power.transferRate = 55 + eps;
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
    this.alert = level;
    emit('alert', level);
    this.pushLog(
      level === 'red' ? 'Red alert. All hands to battle stations.'
        : level === 'yellow' ? 'Yellow alert.'
        : 'Stand down from alert.',
      'captain',
    );
  }

  // ------------------------------------------------------------------ orders

  /**
   * Set course and engage.
   * @returns {object} { ok, error }
   */
  setCourse(destinationId, warpFactor = 6) {
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
        this.startCombat(enc.ships ?? [], { name: enc.title });
        return { messages: ['Engaging.'], combat: true };

      case 'hail': {
        this.mode = MODES.ENCOUNTER;
        out.hail = true;
        return out;
      }

      case 'assist': {
        const lives = enc.lives ?? 200;
        this.ledger.record('distress_answered', { text: `Assisted at ${enc.system.name}`, system: enc.system.id });
        this.ledger.record('lives_saved', { count: lives, system: enc.system.id });
        this.progress.addXP(300 + lives / 6, { ledger: this.ledger });
        this.ledger.adjustStanding('federation', STANDING_EFFECTS.answered_distress, 'Answered a distress call');
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
        out.messages.push('Close survey complete. Science has what they need.');
        break;
      }

      case 'board': {
        const team = this.buildAwayTeam();
        const r1 = team.check(this.rng, 'engineering', { difficulty: enc.risk ?? 0.4, hazard: 'dangerous' });
        out.messages.push(r1.text);
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
        this.latinum += enc.escortReward ?? 300;
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
      standing: this.ledger.standingOf(factionId),
      diplomacyBonus: this.progress.diplomacyBonus,
      winning: eng ? this.ship.hullPct > enemyHull : false,
      playerHullPct: this.ship.hullPct,
      enemyHullPct: enemyHull,
      firstStrike: this.firstStrike,
    });

    this.pushLog(result.text, 'comms');
    if (result.standingDelta) {
      this.ledger.adjustStanding(factionId, result.standingDelta, 'Hail');
    }
    if (result.xp) this.progress.addXP(result.xp, { ledger: this.ledger });

    if (result.surrender) {
      this.ledger.record('surrender_accepted', { text: 'Accepted a surrender', faction: factionId });
    }

    if (result.endsCombat) {
      if (eng) { eng.end(result.outcome); }
      else this.endEncounter();
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

  startCombat(hostiles, opts = {}) {
    if (!hostiles.length) return null;
    this.setAlert('red');
    this.engagement = new Engagement(this.ship, hostiles, this.rng, opts);
    this.mode = MODES.COMBAT;
    this.engagement.pushLog(`${hostiles.length} hostile contact${hostiles.length > 1 ? 's' : ''}.`, 'tactical');
    emit('combat:begin', this.engagement);
    return this.engagement;
  }

  /** Called when Engagement emits combat:end. */
  finishCombat(outcome) {
    const eng = this.engagement;
    if (!eng) return;

    const killed = eng.hostiles.filter((s) => s.destroyed);
    for (const s of killed) {
      this.ledger.destroyShip(s, { system: this.locationId, stardate: this.clock.stardate });
      this.ledger.adjustStanding(
        s.faction,
        s.civilian ? STANDING_EFFECTS.destroyed_civilian : STANDING_EFFECTS.destroyed_their_ship,
        'Ship destroyed in combat',
      );
    }

    if (outcome === 'victory' || outcome === 'routed') {
      const xp = combatXP(eng.hostiles);
      const promo = this.progress.addXP(xp, { ledger: this.ledger });
      this.pushLog(`Engagement concluded. +${Math.round(xp)} experience.`, 'captain');
      if (promo?.promoted) emit('captain:promoted', promo);
    }

    // Casualties are permanent and recorded by name where we have one.
    const lost = this.ship.maxCrew - this.ship.crew;
    if (lost > 0) {
      this.ledger.record('lives_lost', {
        count: lost, text: `${lost} crew lost in action at ${this.location?.name}`, system: this.locationId,
      });
    }

    this.engagement = null;
    this.firstStrike = false;
    this.mode = MODES.BRIDGE;
    this.setAlert(outcome === 'destroyed' ? 'red' : 'normal');
    emit('combat:resolved', { outcome, killed });

    if (outcome === 'destroyed') this.gameOver('ship lost with all hands');
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
      const ships = (spec.ships ?? []).map((cls, i) =>
        new Ship(cls, { name: `${spec.faction} vessel ${i + 1}`, faction: spec.faction }));
      this.pendingCombat = { ships, returnToMission: true };
    }

    if (result.complete) {
      this.missions.finishActive();
      this.mode = MODES.BRIDGE;
    }
    return result;
  }

  // ------------------------------------------------------------------ away teams

  buildAwayTeam(stations = ['science', 'medical', 'tactical'], captainLeads = false) {
    const members = stations.map((s) => this.crew.at(s)).filter(Boolean);
    this.awayTeam = new AwayTeam(members, captainLeads);
    return this.awayTeam;
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
        this.engagement.update(dt);
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

  gameOver(reason) {
    this.over = true;
    this.overReason = reason;
    emit('game:over', { reason, ledger: this.ledger, assessment: this.ledger.assessment() });
  }

  // ------------------------------------------------------------------ save

  save() {
    return {
      version: 1,
      seed: this.seed.toString(),
      rng: this.rng.save(),
      captain: this.captain,
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
    };
  }

  static load(data) {
    const g = new Game({
      seed: BigInt(data.seed),
      captainName: data.captain?.name,
      crewMode: data.crewMode,
      era: data.era,
    });
    g.rng = RNG.load(data.rng);
    g.captain = { ...g.captain, ...data.captain };
    g.crew = Crew.load(data.crew);
    g.ship = Ship.load(data.ship);
    g.progress = CaptainProgress.load(data.progress);
    g.loadout = Loadout.load(data.loadout, g.ship.cls.slots);
    g.ledger = Ledger.load(data.ledger);
    g.galaxy.load(data.galaxy);
    g.missions.load(data.missions, g);
    g.locationId = data.locationId ?? 'sol';
    g.clock = new Clock(data.stardate ?? 4523.3);
    g.latinum = data.latinum ?? 500;
    g.log = data.log ?? [];
    g.over = data.over ?? false;
    g.mode = MODES.BRIDGE;
    g.applyAllMods();
    return g;
  }
}

export { SYSTEM_BY_ID };
