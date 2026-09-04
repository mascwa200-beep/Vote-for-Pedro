// The Game object: everything the simulation owns, in one place.

import { RNG, hashSeed } from './rng.js';
import { Clock } from './time.js';
import { Ledger } from './ledger.js';
import { emit } from './events.js';

import { Ship, FACINGS, SHIELD_OVERCHARGE } from '../sim/ship.js';
import { Crew, Officer, ABILITIES, ABILITY_LIST } from '../sim/officers.js';
import { CaptainProgress, combatXP, SKILLS } from '../sim/skills.js';
import { Loadout, startingLoadout, CONSOLES } from '../sim/loadout.js';
import { Engagement, ARENA_RADIUS, hostileName, HOSTILE_NAMES } from '../sim/combat.js';
import { buildArena } from '../sim/arena.js';
import { AwayTeam, AWAY_TEMPLATES, HAZARD_LEVEL, awayHours } from '../sim/away.js';
import { Walker, stepToward, findRoom, resolve as resolveIn } from '../sim/walk.js';
import { nextInLine, watchOrder, watchAt, assignWatches, handbackReport } from '../sim/watch.js';
import { checkAll, Watchdog } from '../sim/invariants.js';
import { boardableState, BOARDING_RANGE } from '../sim/ai.js';
import { STARTING_STORES, beginFabrication, advanceFabrication, salvageWreck, RECIPE_BY_ID } from '../sim/fabrication.js';
import {
  buildDutyRoster, advanceAssignments, beginAssignment, dutySlots, DutyOfficer, replaceLosses,
} from '../sim/duty.js';
import { ShipMastery } from '../sim/mastery.js';
import {
  offerCommand, acceptCommandOffer, declineCommandOffer, takeCommandOf, replacementFor,
  yardReport,
} from '../sim/command.js';
import { resolveHail, STANDING_EFFECTS, HAIL_ENDING } from '../sim/diplomacy.js';
import { applyAbility, applySignature, applyDevice } from '../sim/powers.js';

import { Galaxy, Transit, plotTransit } from '../world/galaxy.js';
// Placement only, and deterministic from the system id — see gfx/vista.js. The
// state needs it to answer "orbit of what", which is a question about the world
// and not about the renderer.
import { vista, worldLabel } from '../gfx/vista.js';
import { makeSurface, clearSurface, surfaceReport } from '../world/surface.js';
import { ROOMS } from '../world/interiors.data.js';
import { rollEncounter, environmentalHazard, SALVAGE_POOL } from '../world/encounters.js';
import { FACTIONS } from '../world/factions.data.js';
import { buildRoster, ERAS, STATIONS } from '../world/crews.data.js';

/**
 * What to call a station that has nobody at it.
 *
 * The crew roster covers seven posts. The log speaks for more than seven — the
 * captain, security, the transporter room, navigation and ops all have lines
 * and no officer to say them, and fell back to printing their own id.
 */
const STATION_LABEL = {
  ...Object.fromEntries(STATIONS.map((s) => [s.id, s.label])),
  security: 'Security',
  transporter: 'Transporter Room',
  navigation: 'Navigation',
  ops: 'Ops',
  computer: 'Computer',
  // The captain is the player. Their own lines are already tagged CAPTAIN, so
  // they carry no speaker name at all.
  captain: null,
};
import { getShipClass, FEDERATION_REGISTRIES } from '../world/ships.data.js';
import { SYSTEM_BY_ID, distanceLy } from '../world/systems.data.js';

import { MissionBook } from '../missions/engine.js';
import {
  SCENARIO as KOBAYASHI, gambitStatus, forceChannel, resolveGambit, recordOf, closeChannel,
} from '../missions/kobayashi.js';
import { EPISODES } from '../missions/episodes/index.js';

import { Character, FEAT_BY_ID } from '../rules/character.js';
import { Reputation, REP_TRACKS } from '../rules/reputation.js';
import { DifficultySettings, DEFAULT_DIFFICULTY } from '../rules/difficulty.js';
import { convene, findingFor } from '../rules/inquiry.js';
import { CampaignClock, absenceReport, COMMISSION_DAYS } from '../campaign/clock.js';

/**
 * Ceiling on hostiles in one engagement. Beyond this the tactical display
 * stops being readable on a phone, whatever the difficulty asks for.
 */
const MAX_HOSTILES = 6;

/**
 * How much lived time the tick loop banks before spending it on the ship.
 *
 * A quarter of an hour of commission time. At real time that is a quarter of
 * an hour in the chair; at ×1000 it is under a second, which is the point of
 * compression. Short enough that nothing the player is waiting on is held up
 * by it, long enough that the jobs it drives are given a number rather than a
 * rounding error thirty times a second.
 */
const LIVED_SLICE_HOURS = 0.25;

/**
 * Away templates that are about a place rather than about a target.
 *
 * These are the ones a world is done with once. The other two are gated by the
 * thing they are about — a hostile's boardable state, and a hulk that has not
 * been boarded — and filtering those by system would refuse the second hostile
 * in a fight and the second wreck in a system.
 */
const PLACE_TEMPLATES = new Set(['colony_rescue', 'diplomatic_landing', 'covert_landing']);

/**
 * The chance, per commission hour under way, that something drops us out.
 *
 * This was `0.02 * dt` — two per cent per second of PLAY — which worked only
 * because a voyage lasted four to twenty-six seconds whatever its length, and
 * so came to roughly a one-in-four chance per voyage regardless of whether the
 * ship was crossing a system or the Federation. Left alone against a clock that
 * now runs a twelve-day voyage for twelve days, it would have made being
 * intercepted a certainty within the first minute.
 *
 * Per hour instead, so the risk is proportional to the time spent exposed —
 * which is the shape it should always have had. A ten-hour hop is about one in
 * a hundred; the two-hundred-and-ninety-hour run to Vulcan is about one in
 * four, which is where the old number landed for every voyage at once.
 */
const INTERCEPT_PER_HOUR = 0.001;

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

/**
 * The skill a career track brings with it. One rank, on the thing that track
 * is for, so a tactical captain starts able to shoot and a science captain
 * starts able to read a sensor return.
 */
const BACKGROUND_SKILL = {
  command: 'leadership', tactical: 'beam_weapons',
  engineering: 'damage_control', science: 'sensors', diplomatic: 'diplomacy',
};

export class Game {
  constructor(options = {}) {
    this.seed = options.seed ?? hashSeed(String(Date.now()));
    this.rng = new RNG(this.seed);
    // Housekeeping aboard the ship between fights — fires being fought, crew
    // lost to them — on a stream of its own.
    //
    // `Ship.update` draws from the RNG it is handed, and stepping the ship
    // outside combat means it draws on ticks it never used to. From
    // `this.rng` that would shift every seeded outcome downstream of it: the
    // same battle would play out differently depending on whether the ship
    // happened to be alight on the way there. Same reasoning as `derived()`
    // below, but persistent, because this one is drawn from every tick.
    this.upkeepRng = new RNG(hashSeed(`upkeep:${this.seed}`));

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

    // The rest of the crew. Sized from the hull's complement rather than a
    // constant — a runabout does not carry a xenobiologist and a cartographer
    // and a yeoman. See docs/RESEARCH.md §18.
    //
    // Built from its OWN stream, derived from the seed, rather than from
    // `this.rng`. Drawing a dozen names out of the main stream shifts every
    // random number the game makes afterwards, which silently re-rolls every
    // seeded outcome in the campaign — the balance tests noticed within a
    // minute of it being written. A derived stream gives the same people for
    // the same seed forever and leaves everything downstream exactly as it was.
    this.dutyRoster = buildDutyRoster(
      new RNG(hashSeed(`duty:${this.seed}`)), getShipClass(classId)?.crew ?? 0,
    );
    this.assignments = [];
    // What the crew have learned about this particular hull. Tracked per class
    // because that is what familiarity is (RESEARCH.md §20) — though the
    // campaign gives a captain one command and never a second, so in practice
    // this is one crew learning one ship over five years.
    this.mastery = new ShipMastery(classId);
    // Hulls this career has cost, and any standing offer of another.
    this.shipsLost = 0;
    this.commandOffer = null;
    this.declinedCommands = [];
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
    // How much the watch could not hold on to. Counted rather than hidden, the
    // same way `forfeitedHours` records an absence too long to credit.
    this.conDropped = 0;
    this.log = [];
    this.pendingCombat = null;
    // Which fight an episode is waiting on.
    //
    // `settleCombat` says what it is for in its own first line — "the fight
    // this episode ordered is over" — and it was called at the end of every
    // fight, with nothing checking that the fight that just ended was that one.
    // So a stage's held reward was paid out by whatever the captain shot next.
    // Saved, so an id issued before a reload cannot collide with one after it.
    this.missionFightSeq = 0;
    this.firstStrike = false;
    // Whether this fight's call for help has been made, and what is on its way.
    this.helpCalled = false;
    this.helpInbound = null;
    // The Empire answers once per VOYAGE, not once per fight, and the hired
    // Marauder sails once per voyage too. Both reset at the next berth, which
    // is what makes one a favour and the other a contract rather than buttons.
    this.klingonAnswered = false;
    this.marauderHired = false;
    // Whether she is already over the line into the Neutral Zone.
    this.inTheZone = false;
    this.inTheDMZ = false;
    // Explicitly false rather than undefined: `over` is read as a boolean all
    // over the UI and the save, and an unset field reads as "not over" by luck.
    this.over = false;
    this.overReason = null;
    // Set when the five years were served, rather than when the career was cut
    // short. Same reasoning as `over`: read as a boolean, so it starts as one.
    this.commissionCompleted = false;
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
    // Lived time banked but not yet spent on the ship. Saved, because losing it
    // silently on every save would let a player pick the app up and put it down
    // repeatedly to keep a fabrication job permanently a quarter-hour from done.
    this.livedHours = 0;
    // `templateId@systemId` for every landing party that has already gone down
    // somewhere this commission. A colony is evacuated once. See
    // `availableAwayMissions`.
    this.awayDone = new Set();

    this.commission();
    this.pushLog(`Assumed command of the ${this.ship.name}, ${this.ship.registry}.`, 'captain');
  }

  // ------------------------------------------------------------------ setup

  /**
   * What a captain brings to their first command.
   *
   * A career track grants a matching skill rank; a Starfleet family starts a
   * pip higher and with the scrutiny to match; a reprimand already on file
   * stays on file. All three of these were applied in `App.startGame`, which
   * is the character creator, which is in the browser — so a `new Game` built
   * anywhere else got none of them. Every test, the soak, the fuzzer and the
   * balance suite were measuring a captain the player never plays: no starting
   * skill, no rank bonus, no reprimand.
   *
   * `Game.load` replaces `progress` and `ledger` wholesale after construction,
   * so a loaded save keeps the record it saved and does not collect this twice.
   */
  commission() {
    const skillId = BACKGROUND_SKILL[this.character?.careerId];
    if (skillId && SKILLS[skillId]) {
      this.progress.unspent++;
      this.progress.spend(skillId);
    }
    if (this.character?.mechanic('startingRankBonus')) {
      this.progress.rankIndex = Math.min(this.progress.rankIndex + 1, 10);
    }
    if (this.character?.mechanic('startingReprimand')) {
      this.ledger.record('order_disobeyed', {
        text: 'Prior reprimand on file at time of commission',
      });
    }
    this.applyAllMods();
  }

  /**
   * Credit something the crew learned about this hull, and say so if it told.
   *
   * The mods are only recomputed when a tier is actually crossed. Mastery
   * points move on every hour under way, and re-deriving every modifier on the
   * ship several thousand times a commission to change nothing is work for
   * nothing.
   */
  creditMastery(kind, count = 1) {
    if (!this.mastery) return null;
    const result = this.mastery.award(kind, count);
    if (!result.tierUp) return result;
    this.applyAllMods();
    this.pushLog(
      `${this.ship.name} has her crew, Captain — ${result.tierUp.name}. ${result.tierUp.text}`,
      'engineering',
    );
    emit('mastery:tier', { tier: result.tierUp, mastery: this.mastery });
    return result;
  }

  /**
   * Does the captain hold this reputation perk?
   *
   * One door, because there was not one. Of the twenty-five perks the six
   * reputation tracks sell, exactly ONE was ever read — `better_prices`, at a
   * single inline call site — and `cloak` worked only through a special case
   * inside `buyProject`. The other twenty-three were added to a Set that
   * nothing ever asked. A captain could spend three hundred Commendations on
   * "Flag Officer Authority" and receive a line in a list.
   *
   * Reading them through here means a perk that is granted and never checked
   * is a grep away from being found, rather than invisible.
   */
  perk(id) {
    return !!this.reputation?.has(id);
  }

  /**
   * A seeded stream of its own, for anything that must not disturb `game.rng`.
   *
   * Drawing from the main stream for a name or an ETA shifts every seeded
   * outcome downstream of it, so the same battle would play out differently
   * depending on whether a perk happened to be held. Keyed by the seed, the
   * place and the date, so it is deterministic and still varies.
   */
  derived(tag) {
    return new RNG(hashSeed(`${tag}:${this.seed}:${this.locationId}:${this.clock.stardate}`));
  }

  /**
   * What the captain's reputation changes about what finds him.
   *
   * One place, so all three call sites of `rollEncounter` agree — the arrival
   * roll, the aborted-transit roll and the mid-transit roll were otherwise
   * three chances to forget a perk.
   *
   * "Charted space" is space this ship has actually been to. The galaxy's
   * lanes are charted from the start, so reading it that way would have made
   * "in charted space" mean "everywhere" and the perk a flat halving.
   */
  /**
   * The warning the Obsidian Order would give, or null if the course is clean.
   *
   * Reads the same two facts the game already enforces — `requiresStanding`,
   * which decides whether a system will berth you, and the faction's standing,
   * which decides who shoots — rather than inventing a third notion of a
   * border. A warning about a line the game does not actually draw would be
   * worse than no warning.
   */
  crossingWarningFor(dest) {
    if (!dest) return null;
    const shut = Object.entries(dest.requiresStanding ?? {})
      .filter(([f, v]) => this.ledger.standingOf(f) < v && !this.perk(Game.PASSAGE_PERKS[f]));
    if (shut.length) {
      const [f, v] = shut[0];
      return `A word before we go, Captain: ${dest.name} will not open a berth to us. `
        + `They want ${v} and our standing with them is ${Math.round(this.ledger.standingOf(f))}.`;
    }
    // The line that matters most is the one that is an act of war. Said before
    // the course is laid in, which is the only moment a warning helps.
    if (Game.insideTheZone(dest) && !this.perk('romulan_accord')) {
      return `A word before we go, Captain: ${dest.name} is inside the Neutral Zone. `
        + 'Crossing is a treaty violation and the Romulans will log it.';
    }
    // The other line, and a different warning, because it is a different rule:
    // nobody is forbidden from being there. We are forbidden from being there
    // in this. RESEARCH.md §25.
    if (Game.insideTheDMZ(dest) && !this.perk('dmz_passage')) {
      return `A word before we go, Captain: ${dest.name} is inside the demilitarised `
        + 'zone. We are permitted to be there. A heavy cruiser is not, and somebody '
        + 'will come and say so.';
    }
    const owner = dest.faction;
    if (owner && owner !== 'federation' && owner !== 'independent') {
      const standing = this.ledger.standingOf(owner);
      if (standing < 0) {
        return `A word before we go, Captain: ${dest.name} is ${owner} space and they `
          + `have us at ${Math.round(standing)}. We will not be made welcome.`;
      }
    }
    return null;
  }

  /**
   * What is waiting at a system, as a stream of its own.
   *
   * The encounter used to be drawn from `game.rng`, which made it a function
   * of everything the captain had done beforehand — every damage roll in every
   * fight shifted what was waiting at the next system. That is fine until
   * something has to KNOW what is waiting before arriving, and then it is
   * impossible: the state of the main stream at the moment of arrival is not
   * knowable in advance.
   *
   * Keyed by the seed, the system and WHICH VISIT this is, so it is a fact
   * about a place and a moment rather than about the draw order. Measured
   * before changing it: the whole suite and the whole browser harness pass
   * either way, so nothing depended on encounters consuming the main stream.
   *
   * `ahead` looks one visit further on, which is what a peek needs: `arrive`
   * calls `markVisited` before it rolls, so the roll for the visit now
   * beginning already counts it.
   */
  encounterStream(systemId, ahead = 0) {
    const n = this.galaxy.visitCount(systemId) + ahead;
    return new RNG(hashSeed(`encounter:${this.seed}:${systemId}:${n}`));
  }

  /**
   * "Intelligence Sharing — you know what is waiting before you arrive."
   *
   * Two hundred Tokens of Regard, and it was the last of the twenty-five
   * perks to do nothing. It could not have been wired to the old encounter
   * roll at all, which is why it waited: see `encounterStream`.
   *
   * @returns {object|null} the encounter that will be there, or null.
   */
  peekEncounter(systemId) {
    if (!this.perk('see_all_encounters')) return null;
    if (systemId === this.locationId) return null;
    return rollEncounter(this.encounterStream(systemId, 1), systemId, {
      ledger: this.ledger, ...this.encounterPerks(systemId),
    });
  }

  /** Inside the Zone: the `neutral` sector, minus the posts watching it. */
  static insideTheZone(sys) {
    return sys?.sector === 'neutral' && sys?.faction !== 'federation';
  }

  /**
   * Inside the demilitarised zone — and unlike the Zone above, all of it.
   *
   * The Romulan Neutral Zone excludes the Federation outposts watching it,
   * because those are ours and being at one is not a crossing. The
   * demilitarised zone has no such exception: the colonies in it belong to
   * both governments by the terms of the treaty that drew it, and a Starfleet
   * cruiser at the Federation one is exactly as demilitarising as a cruiser at
   * the Cardassian one. RESEARCH.md §25.
   */
  static insideTheDMZ(sys) {
    return sys?.sector === 'dmz';
  }

  /**
   * Crossing the Romulan Neutral Zone.
   *
   * The game drew this line, said twice in its own text that crossing it is a
   * treaty violation — "Treaty says nobody crosses. Treaty is old." on the
   * outposts, and the whole Kobayashi Maru briefing — and then let a ship fly
   * straight through with nothing happening at all. RESEARCH.md §23: the Zone
   * was drawn by the treaty that ended the Earth-Romulan War and entry by
   * either side is an act of war, which is the thing "Balance of Terror" is
   * built on.
   *
   * ONCE per crossing, not once per arrival: the Romulans notice a ship coming
   * over the line, not a ship sitting where it already is. Leaving the Zone
   * arms it again.
   *
   * The campaign sends you in — `devron_anomaly` is an act-3 episode inside
   * the Zone — so this is a price on a thing worth doing, not a wall.
   */
  crossTheZone() {
    const inside = Game.insideTheZone(this.location);
    if (!inside) { this.inTheZone = false; return null; }
    if (this.inTheZone) return null;
    this.inTheZone = true;

    // "Private Accord — the Neutral Zone opens to you. Officially, this never
    // happened." Three hundred and twenty Tokens of Regard, and it opened
    // nothing, because nothing was ever shut. An arrangement nobody writes
    // down is exactly the shape of a sanctioned crossing (§23), so with it
    // there is no violation to record.
    if (this.perk('romulan_accord')) {
      this.pushLog(
        `Across the line, Captain. Nobody is hailing us and nobody will admit `
        + 'to that. Officially, this never happened.',
        'comms',
      );
      return { crossed: true, sanctioned: true };
    }

    this.ledger.adjustStanding('romulan', STANDING_EFFECTS.violated_border, 'Crossed the Romulan Neutral Zone');
    this.ledger.record('treaty_broken', {
      text: `Crossed into the Neutral Zone at ${this.location?.name ?? 'an unnamed system'}`,
      system: this.locationId,
    });
    this.pushLog(
      'We are inside the Zone, Captain. That is a treaty violation and they '
      + 'will have logged it the moment we crossed.',
      'comms',
    );
    return { crossed: true, sanctioned: false };
  }

  /**
   * Arriving in the demilitarised zone in a warship.
   *
   * Deliberately NOT `crossTheZone` in another colour. Crossing the Romulan
   * Neutral Zone is the violation and it is charged, once, on the crossing.
   * Nothing is charged here, because being in the demilitarised zone is not a
   * violation — people live in it and freighters cross it. What the treaty
   * forbids is militarising it, and the largest weapon in the zone is us. So
   * the answer is not a penalty, it is somebody coming to ask.
   *
   * "Standing Treaty Rider — free movement through the demilitarised zone" is
   * the Cardassian track's tier-four project, and a rider is an amendment to
   * the treaty that drew the line. It does not forgive a violation; it is the
   * paper that makes the presence lawful, which is a thing you produce when
   * somebody asks. So it stops the asking — and SAYS that it did, because a
   * perk that silently prevents something a captain never sees is
   * indistinguishable from one that does nothing at all, which is the defect
   * this codebase has spent a dozen changes rooting out.
   *
   * Once per entry, like the crossing: leaving the zone arms it again.
   *
   * @returns {'challenged'|'cleared'|null}
   */
  enterTheDMZ() {
    if (!Game.insideTheDMZ(this.location)) { this.inTheDMZ = false; return null; }
    if (this.inTheDMZ) return null;
    this.inTheDMZ = true;

    if (this.perk('dmz_passage')) {
      this.officerSays('comms',
        'We are being scanned, Captain — and waved through. The treaty rider is '
        + 'on file with both governments and they have found it.',
        'report');
      return 'cleared';
    }
    return 'challenged';
  }

  /**
   * Order the ships an episode's stage asked for.
   *
   * Shared by `chooseMission`, which does it when the captain takes the choice,
   * and by `Game.load`, which does it for a record saved in the one tick
   * between the order and the fight arriving. One place, so the two cannot
   * drift about how a mission's hostiles are built or named.
   *
   * @param {object} spec  the stage's `effects.combat`
   * @param {number|null} fightId  reuse the id from a restored record, so the
   *   engagement still answers for the episode that is waiting on it
   */
  orderTheStagesFight(spec, fightId = null) {
    if (!spec) return null;
    // Named, like every other hostile in the game. A mission stage used to
    // field "klingon vessel 1" while an ordinary encounter with the same ship
    // called it the IKS Rotarran.
    const ships = (spec.ships ?? []).map((cls, i) =>
      new Ship(cls, { name: hostileName(spec.faction, i), faction: spec.faction }));
    if (!ships.length) return null;
    const id = fightId ?? ++this.missionFightSeq;
    if (fightId != null) this.missionFightSeq = Math.max(this.missionFightSeq, fightId);
    this.pendingCombat = { ships, canWarpOut: spec.canWarpOut, fightId: id };
    return id;
  }

  /**
   * Notice where the ship has ended up.
   *
   * A border is a fact about a position, not about how you got there. Both of
   * these were called from exactly one place — `arrive()` — so they only ever
   * ran when a course was flown to its end. There are two other ways to be
   * standing somewhere: being forced out of warp mid-course, and giving the
   * order to break off. Neither noticed a line.
   *
   * Measured over 400 flights into the Romulan Neutral Zone: every one of the
   * 354 that arrived was charged as a crossing, and none of the 11 that were
   * jumped on the way in were. The ship sat inside the Zone with the Romulans
   * none the wiser, which made being intercepted a way to avoid the treaty
   * violation you were flying into.
   *
   * It also matters in the other direction. `inTheZone` and `inTheDMZ` mean
   * "already inside, do not say it twice", and leaving by any path that did not
   * reset them would have left the next entry silent for the rest of the
   * commission.
   *
   * @returns {'challenged'|'cleared'|null} what the DMZ made of it
   */
  noticeTheBorder() {
    this.crossTheZone();
    return this.enterTheDMZ();
  }

  /**
   * The hulk you left behind is gone.
   *
   * `finishCombat` describes the salvage as a choice — "strip it, or leave the
   * system and lose it" — and leaving did not lose it. `wreckHere` stopped
   * offering the hulk once you were elsewhere, so it LOOKED lost, but the
   * object survived in the save and came back the moment you returned to that
   * system. A wreck could be banked for the whole five years and cashed in
   * whenever the machine shop ran dry, which is not a choice at all.
   *
   * That clause lived inside `arrive`, and `arrive` is not the only way to end
   * up in a different system from the hulk: breaking off a course leaves the
   * ship at the nearest system on the route, and kept the wreck. So the choice
   * was still not a choice — take the other exit and the hulk was banked
   * anyway. Hoisted here so a third departure cannot forget it, exactly as
   * `noticeTheBorder` was hoisted for the same two paths.
   */
  loseTheHulkBehindUs() {
    if (this.wreck && this.wreck.systemId !== this.locationId) this.wreck = null;
  }

  encounterPerks(systemId) {
    return {
      quietInHostileSpace: this.perk('reduced_detection'),
      halveHostile: this.perk('route_intel') && this.galaxy.visited.has(systemId),
      distressSooner: this.perk('folk_hero'),
    };
  }

  /** Recompute ship modifiers from skills + consoles. Call after any change. */
  applyAllMods() {
    // What the ship has left, as a fraction, before any of this runs.
    //
    // Every `applyMods` below ends in `recomputeDerived`, which rescales the
    // current hull and shields by `newMax / prevMax` so that raising a maximum
    // does not leave the ship reading as pre-damaged. Correct once. Done five
    // times in a row after a reset to the baseline, it walks the hull down to
    // the unmodded scale and back up again, and
    // `4588 * (4200/4620) * (4620/4200)` is not 4588.
    //
    // So this asked the same question twice and got a slightly different ship:
    // the hull crept up an ulp per call for the first three calls, and it is
    // called on construction, on load, on promotion, on fitting a console and
    // on a difficulty change. Capturing the fraction here and restoring it at
    // the end conserves exactly what the rescale exists to conserve, once
    // instead of five times.
    const hullPct = this.ship.maxHull > 0 ? this.ship.hull / this.ship.maxHull : null;
    const shieldPct = this.ship.maxShield > 0
      ? Object.fromEntries(FACINGS.map((f) => [f, this.ship.shields[f] / this.ship.maxShield]))
      : null;

    // Reset to the class baseline, then reapply everything.
    this.ship.mods = {
      damage: 1, shieldMax: 1, shieldRegen: 1, hullMax: 1, turn: 1,
      impulse: 1, accuracy: 1, defense: 1, critChance: 0.05, critSeverity: 0.5,
      repairRate: 1, torpedoDamage: 1, beamDamage: 1, cannonDamage: 1,
      damageResist: 0, stealthDetect: 1, crewProtect: 0,
    };
    this.ship.applyMods(this.progress.shipMods());
    this.ship.applyMods(this.loadout.shipMods());
    // What the crew know about this hull is part of what the hull can do.
    if (this.mastery) this.ship.applyMods(this.mastery.shipMods());
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
      + (this.character?.mechanic('casualtyReduction') ?? 0)
      // "Fleet Medical Detachment — permanent 15% reduction in crew
      // casualties." It said permanent and it did nothing at all.
      + (this.perk('casualty_reduction') ? 0.15 : 0);
    if (crewProtect) this.ship.applyMods({ crewProtect });

    // A cloaking device is fitted to the SHIP, and the ship changes. A captain
    // who bought one for 130 Tokens of Regard and was then promoted, or lost
    // his ship to a Klingon, found it quietly gone with the old hull: the flag
    // is set on the Ship, and `takeCommandOf` builds a new one. The perk is the
    // captain's, so it is reapplied wherever he is standing.
    if (this.perk('cloak')) this.ship.cloakCapable = true;

    const eps = this.loadout.special('powerTransfer');
    if (eps) this.ship.power.transferRate = 55 + eps;
    if (this.character?.hasFeat('master_engineer')) this.ship.power.transferRate = 400;

    // And put the ship back where it was, proportionally. One rescale against
    // the maxima this method finally settled on, rather than one per source of
    // modifiers against whatever the maxima happened to be halfway through.
    if (hullPct !== null) this.ship.hull = Math.min(this.ship.maxHull, hullPct * this.ship.maxHull);
    if (shieldPct !== null) {
      for (const f of FACINGS) {
        this.ship.shields[f] = Math.min(this.ship.maxShield * SHIELD_OVERCHARGE, shieldPct[f] * this.ship.maxShield);
      }
    }
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

  /**
   * Award experience, and carry out the promotion if it earns one.
   *
   * Twelve places in this codebase awarded experience. Two of them checked
   * whether it promoted the captain; the other ten threw the answer away, so
   * a promotion earned by an away mission, an anomaly, a first survey, a
   * mission reward or a diplomatic success happened silently: the rank index
   * moved and nothing else did, not even the announcement.
   *
   * And what a promotion MEANS — the character levels up, proficiency goes up
   * with it, and a feat is banked to choose — lived in an event listener in
   * src/main.js. Headless, a captain could make Fleet Captain over five years
   * and still be level one with no feats, which is the entire character half
   * of the game not happening.
   */
  awardXP(amount, { silent = false } = {}) {
    const promo = this.progress.addXP(amount, { ledger: this.ledger });
    // A promotion earned and held is worth saying. `addXP` has always returned
    // {blocked: true} and nobody read it, so a captain under inquiry simply saw
    // his rank stop moving with no explanation offered anywhere.
    //
    // Once, not on every award: xp arrives from combat, missions and duty
    // details, and repeating it would be a log full of the same sentence.
    if (promo?.blocked) {
      if (!this.promotionHeld) {
        this.promotionHeld = true;
        const would = findingFor(this.ledger);
        this.pushLog(
          'You have earned the next rank, Captain, and the board of inquiry is '
          + `holding it. On the record as it stands the finding would be: ${would.label.toLowerCase()}.`,
          'comms',
        );
      }
      return promo;
    }
    if (!promo?.promoted) return promo ?? null;

    this.character?.levelUp();
    this.pendingFeats = (this.pendingFeats ?? 0) + 1;
    this.applyAllMods();
    if (!silent) {
      this.pushLog(
        `Promoted to ${promo.rank.name}. ${promo.points} skill points and a feat to choose.`,
        'captain',
      );
    }
    // A promotion is how you stop being a starship captain (RESEARCH.md §21).
    // Starfleet does not simply move you: it offers, and the offer stands until
    // it is taken or turned down, because refusing it is the interesting half.
    const offer = offerCommand(this);
    if (offer && !silent) {
      this.pushLog(
        `Starfleet offers you a ${offer.name}, Captain. `
        + `${this.ship.name} would go to somebody else, and her crew's five years `
        + 'of knowing her would go with her.',
        'comms',
      );
    }
    emit('captain:promoted', promo);
    return promo;
  }

  /** Take the bigger ship. Spends what the crew knew about this one. */
  acceptCommand() {
    // Not while people are shooting at you.
    //
    // Taking a new hull builds a new Ship and points `game.ship` at it, and the
    // running engagement went on holding the OLD object: the enemy kept firing
    // at a ship you no longer commanded while your orders went to one that was
    // not in the battle. That is `game.engagement.ship`, which the watchdog
    // rates FATAL, and it is reachable from the order line with one phrase in
    // the middle of a firefight.
    //
    // Losing the ship is a different matter and is left alone — that hands you
    // a replacement after the battle has ended, not during it.
    if (this.engagement && !this.engagement.over) {
      return { ok: false, reason: 'Not in the middle of an engagement, Captain.' };
    }
    const before = this.ship?.name;
    const r = acceptCommandOffer(this);
    if (!r.ok) return r;
    this.pushLog(
      `${this.ship.name} is yours, Captain. ${before} goes to another captain. `
      + 'Nobody aboard has worked this hull up yet.',
      'captain',
    );
    const yard = yardReport(r, CONSOLES);
    if (yard) this.pushLog(yard, 'engineering');
    return r;
  }

  /** Keep the ship you know. */
  declineCommand() {
    const r = declineCommandOffer(this);
    if (r.ok) {
      this.pushLog(`We stay with ${r.kept}, Captain. Starfleet is informed.`, 'captain');
    }
    return r;
  }

  /**
   * Ask Starfleet whether there is a ship going, after all.
   *
   * Refusing a command stops Starfleet raising it again, which is right — it
   * was being put to the captain at every promotion for the rest of his career.
   * But a captain who turns down the best hull his rank carries would then
   * never be offered anything again for the whole commission, and a decision
   * made once at Fleet Captain should not be binding at Admiral.
   *
   * So the refusals lapse when he asks. All of them, rather than some subtler
   * subset: he has reopened the conversation, and a rule about which of his
   * old refusals still counted would be impossible to explain on a screen.
   *
   * @returns {{ok: boolean, reason?: string, offer?: object}}
   */
  requestCommand() {
    if (this.commandOffer) {
      return {
        ok: false,
        reason: `Starfleet has already offered you a ${this.commandOffer.name}, Captain.`,
      };
    }
    this.declinedCommands = [];
    const offer = offerCommand(this);
    if (!offer) {
      return {
        ok: false,
        reason: `There is nothing above ${this.ship.name} that your rank would carry, Captain.`,
      };
    }
    this.pushLog(
      `Starfleet has a ${offer.name} going, Captain, and your name is on the list.`,
      'comms',
    );
    return { ok: true, offer };
  }

  /**
   * Take one of the feats a promotion banked.
   *
   * `character.takeFeat` records the feat. Spending the bank, recomputing the
   * ship modifiers the feat changes and saying so were done in the sheet
   * screen, so a feat taken any other way was free and had no effect on the
   * ship — the two things that make it worth taking.
   *
   * `payload` is the ability list for the repeatable Field Commission; the
   * screen asks which scores one at a time, and passes them here together.
   */
  takeFeat(featId, payload = null) {
    if (!(this.pendingFeats > 0)) return { ok: false, reason: 'Nothing to choose, Captain.' };
    if (!this.character?.takeFeat(featId, payload)) {
      return { ok: false, reason: 'Not available, Captain.' };
    }
    this.pendingFeats--;
    this.applyAllMods();
    const name = FEAT_BY_ID[featId]?.name ?? featId;
    this.pushLog(featId === 'ability_score'
      ? 'Field commission: ability scores raised.'
      : `Qualified: ${name}.`, 'captain');
    return { ok: true, featId, name, remaining: this.pendingFeats };
  }

  /**
   * Spend a skill point.
   *
   * One rank, and the ship modifiers that depend on it recomputed. Spending
   * without recomputing left the point spent and the ship unchanged until
   * something else happened to call `applyAllMods`, which is a rank that does
   * nothing for an unpredictable length of time.
   */
  spendSkill(skillId) {
    if (!this.progress.spend(skillId)) return { ok: false, reason: 'No points, Captain.' };
    this.applyAllMods();
    return { ok: true, skillId, ranks: this.progress.ranksIn(skillId), left: this.progress.unspent };
  }

  /**
   * Spend marks on a reputation project, and receive what it grants.
   *
   * `reputation.buy` deducts the cost and records the perk. What the project
   * actually GIVES you — the torpedoes, the antimatter, the console, the
   * cloaking device nobody signed for — was applied in src/main.js, so a
   * project bought without a screen attached took the marks and delivered
   * nothing. Same shape as the power tray, and the same fix.
   */
  buyProject(trackId, projectId) {
    const project = this.reputation?.buy(trackId, projectId);
    if (!project) return { ok: false, reason: 'Not available, Captain.' };

    const grant = project.grant ?? {};
    const lines = [];
    if (grant.console) {
      this.loadout.acquire(grant.console);
      const name = CONSOLES[grant.console]?.name ?? grant.console;
      lines.push(`${name} received from ${trackId}.`);
    }
    if (grant.torpedoes) {
      const before = this.ship.torpedoes;
      this.ship.torpedoes = Math.min(this.ship.maxTorpedoes, before + grant.torpedoes);
      lines.push(`Magazine restocked: ${this.ship.torpedoes - before} torpedoes aboard.`);
    }
    if (grant.antimatter) {
      this.ship.antimatter = Math.min(100, this.ship.antimatter + grant.antimatter);
      lines.push(`Antimatter topped up to ${Math.round(this.ship.antimatter)}%.`);
    }
    if (grant.perk === 'cloak') {
      this.ship.cloakCapable = true;
      lines.push('A cloaking device has been installed. Nobody has signed for it.');
    }
    if (grant.title) lines.push(`You are now styled "${grant.title}".`);

    for (const line of lines) this.pushLog(line, 'engineering');
    this.applyAllMods();
    emit('reputation:project', { trackId, project });
    return { ok: true, project, lines };
  }

  get location() { return this.galaxy.get(this.locationId); }

  get stardate() { return this.clock.format(); }

  // ------------------------------------------------------------------ sensors

  /**
   * How well the sensors are working right now.
   *
   * The array's health times the power behind it. Auxiliary is the sensor
   * channel by every name the game gives it — the parser maps "sensors",
   * "science", "computer" and "transporter" onto it, and the one-tap preset
   * is labelled Science with the order phrase "power to auxiliary" — and it
   * fed nothing but damage control. So the Science posture made the ship no
   * better at science, which is the one thing its name promises.
   *
   * Nominal is 1.0 and that is deliberate: at balanced power this is exactly
   * `subsystems.sensors`, so nothing that reads it changes at the default
   * distribution. Spending power is what buys the difference — 1.5 at
   * auxiliary 100, 0.4 at auxiliary 0.
   */
  get sensorQuality() {
    return this.ship.subsystems.sensors * this.ship.power.factor('auxiliary');
  }

  /**
   * What the sensors make of the system the ship is sitting in.
   *
   * This lived in main.js and read no ship state at all: a ship with her
   * sensor array blown to a fifth read a system exactly as well as one fresh
   * out of the yard, and the auxiliary power the order line calls "sensors"
   * made no difference to the order that says "sensors". It is simulation, so
   * it belongs here where it can be run without a screen — the same reason
   * the abilities live in src/sim/powers.js.
   *
   * Nothing a captain needs to navigate is ever withheld: the lanes and the
   * hazard are safety information and print at any reading. A better reading
   * ADDS, it does not gate — and a poor one names the thing that would fix it,
   * because an order that quietly returns less is indistinguishable from an
   * order that is broken.
   */
  sensorSweep() {
    const sys = this.location;
    const q = this.sensorQuality;
    const lines = [`${sys.name}. ${sys.description}`];

    const neighbors = this.galaxy.neighbors(sys.id);
    lines.push(`Charted lanes from here: ${neighbors.map((n) => n.name).join(', ') || 'none'}.`);
    if (sys.hazard) lines.push(`Hazard: ${sys.hazard.replace(/_/g, ' ')}. Recommend we do not linger.`);

    const missions = this.availableMissions();
    if (missions.length) {
      lines.push(`Standing orders available here: ${missions.map((m) => m.title).join(', ')}.`);
    }

    // A working array picks the system apart: what is down there to stand on,
    // and whether anything is adrift. Both are already in the model and
    // neither was ever reported.
    if (q >= 1) {
      const worlds = vista(sys.id, sys.type).bodies.filter((b) => b.kind !== 'star');
      lines.push(worlds.length
        ? `${worlds.length} bod${worlds.length === 1 ? 'y' : 'ies'} in the system. We can make orbit.`
        : 'Nothing here but the primary. Nowhere to put a landing party.');
      if (this.wreckHere) {
        lines.push(`Something is adrift out there — ${this.wreckHere.name}. Salvage teams could cross.`);
      }
    }

    // And an array with real power behind it says whether science already has
    // this one on file, which is the difference between surveying a system and
    // surveying it twice.
    if (q >= 1.25) {
      lines.push(this.galaxy.surveyed.has(sys.id)
        ? 'Science has this system on file. Nothing new to catalogue.'
        : 'Nothing on file for this system. Anything we find here is new.');
    }

    // Under nominal the sweep is thin, and the captain is told why rather than
    // left to wonder whether the order works.
    if (q < 1) {
      lines.push(this.ship.subsystems.sensors < 0.9
        ? `The array is at ${Math.round(this.ship.subsystems.sensors * 100)} percent, Captain. `
          + 'These readings are the best it will give us until it is repaired.'
        : 'The readings are thin, Captain. More power to auxiliary and I can do better.');
    }

    // A long look at something. Two and a half hours of it.
    this.spendHours(2.4);
    return lines;
  }

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
    // Nobody is at every station. Five of them have no officer on the roster —
    // captain, security, transporter, navigation, ops — and the fallback was
    // the raw id, so the log printed "captain: Log entry recorded." underneath
    // a line already tagged CAPTAIN: the identifier twice, once in lower case.
    //
    // The captain is the player rather than a member of the crew, so their own
    // lines carry no speaker at all — the tag on the line already says who is
    // talking. Everything else falls back to the station's proper name.
    const who = officer ? officer.name : STATION_LABEL[station] ?? null;
    this.pushLog(who ? `${who}: ${text}` : text, station);
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
    const done = this.noLongerInCommand();
    if (done) return { ok: false, reason: done.reason };
    const s = this.ship;
    if (s.hullPct >= 1) return { ok: false, reason: 'The hull is sound, Captain.' };
    const blue = this.alert === 'blue';
    const before = s.hullPct;
    s.repair(s.maxHull * (blue ? 0.18 : 0.12));
    this.spendHours(blue ? 14.4 : 19.2);
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
    this.conDropped = 0;
    if (spoken) {
      this.pushLog(`${officer.rank} ${officer.name}, you have the con.`, 'captain');
      this.officerSays(officer.station, 'Aye, Captain. I have the con.', 'report');
    }
    emit('con', { officer, held: true });
    return { ok: true, officer };
  }

  /**
   * Give the watch officer something to tell the captain when they are back.
   *
   * Capped, because this list was emptied by exactly one thing — the captain
   * taking the con — and filled by every resume and every fight. A captain who
   * plays off the bridge accumulated it for the whole commission: measured over
   * five years of twelve-hour absences, 3,650 lines and a 206KB save, with the
   * autosave ring keeping three of those on a phone. And the report itself
   * became unreadable, which is worse, because being told what happened while
   * you were away is the entire reason the con exists.
   *
   * `pushLog` has capped the ship's log at 400 since it was written and
   * `MAX_ABSENCE_HOURS` is the same idea applied to time. This is a spoken
   * report, so the ceiling is what somebody can stand to be told.
   */
  holdForTheCaptain(...lines) {
    for (const line of lines) {
      this.conLines.push(line);
      if (this.conLines.length > Game.MAX_CON_LINES) {
        this.conLines.shift();
        this.conDropped++;
      }
    }
  }

  /** The most a watch officer will read out before summarising the rest. */
  static get MAX_CON_LINES() { return 40; }

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

    const lines = officer
      ? handbackReport(officer, this.conHours, this.conLines, this.conDropped)
      : this.conLines.slice();
    this.conStation = null;
    this.conGiven = false;
    this.conHours = 0;
    this.conLines = [];
    this.conDropped = 0;
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
    const done = this.noLongerInCommand();
    if (done) return done;
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
    // Not with the captain on the ground.
    //
    // Breaking orbit while ashore left the landing party on a world the ship
    // had left, `ashore` still true, and the transporter with nothing under
    // it — and the next order to set a course took the ship out of the system
    // entirely. You could maroon yourself, and the only thing that ever
    // noticed was the API fuzzer walking into a room that was no longer there.
    if (this.ashore) {
      return { ok: false, error: 'You are on the surface, Captain. We are not leaving without you.' };
    }
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
    const done = this.noLongerInCommand();
    if (done) return done;
    if (this.mode === MODES.COMBAT) return { ok: false, error: 'We are under fire, Captain.' };
    // The same refusal `breakOrbit` gives, for the same reason: a course order
    // clears the orbit on its way out, so without this the ship would leave the
    // system with the captain still standing on the planet.
    if (this.ashore) {
      return { ok: false, error: 'You are on the surface, Captain. We are not leaving without you.' };
    }
    const plan = plotTransit(
      this.galaxy, this.locationId, destinationId, warpFactor,
      this.ship, this.progress.warpEfficiency,
    );
    if (plan.error) {
      this.officerSays('helm', plan.error, 'object');
      return { ok: false, error: plan.error };
    }

    this.transit = plan.transit;
    // Flying away is withdrawing.
    //
    // This cleared the orbit and not the ENCOUNTER, and `arrive` only overwrites
    // one — and only when the arrival roll produces something that is not quiet,
    // which most of the time it does not. So whatever was on the viewer when the
    // captain laid in a course stayed live in a system the ship was no longer
    // anywhere near: measured over sixty legs, thirty-nine turned something up
    // and fifteen of those were still there afterwards.
    //
    // `checkGame` has called that illegal since before this line existed
    // (`game.encounter.elsewhere`); nothing had ever flown away from an
    // encounter to trip it. And it is not invisible in play — `hail` reads the
    // encounter's faction before the engagement's, and `availableAwayMissions`
    // reads its kind, so a distress call left four light years back offers a
    // landing party at a world with no emergency.
    //
    // Through `endEncounter` rather than a bare null, because that is the same
    // door `resolveEncounter('withdraw')` uses: the alert stands down and
    // `encounter:end` is emitted, so the bridge is told what the captain just
    // did. Done AFTER the plan is accepted — a course the helm refuses is not a
    // departure, and the thing on the viewer is still in front of the ship.
    if (this.encounter) this.endEncounter();
    // You cannot hold an orbit and leave the system. Cleared silently: the helm
    // announcing a break the captain did not order is noise, and the course
    // report immediately after says where the ship is going instead.
    this.orbit = null;
    this.mode = MODES.TRANSIT;
    this.ship.antimatter = Math.max(0, this.ship.antimatter - plan.fuel);

    const dest = this.galaxy.get(destinationId);
    this.officerSays('helm', `Course laid in for ${dest.name}, warp ${plan.factor.toFixed(0)}.`);
    this.pushLog(`Engaged at warp ${plan.factor.toFixed(0)} for ${dest.name}.`, 'captain');
    // "Obsidian Order Courtesy — you are warned before you cross a line that
    // matters." A hundred and twenty Writs of Accord, and no warning was ever
    // given about anything: the perk went into a Set nothing read.
    //
    // A line that matters is one the ship cannot cross without consequence:
    // a border into space whose owner will not have you, or a system that
    // will turn you away at the door. Said when the course is laid in, which
    // is the only moment a warning is worth anything.
    if (this.perk('border_warning')) {
      const warning = this.crossingWarningFor(dest);
      if (warning) this.officerSays('comms', warning, 'warn');
    }
    emit('transit:begin', { transit: this.transit, destination: dest });
    return { ok: true, transit: this.transit, hours: plan.hours, fuel: plan.fuel };
  }

  /**
   * Break off a course under way, and coast in to whatever is nearest.
   *
   * This was implemented inside the Under Way panel in src/ui/screens.js: a
   * button that moved the ship to a system, advanced the calendar, cleared the
   * transit and set the mode, with none of it reachable from anywhere else.
   * So there was no way to abort a course without a screen, the system you
   * stopped at was never marked visited, nothing was ever waiting there when
   * you got there — and the phrase printed on the button did something else
   * entirely, which is the one thing this project does not allow a button
   * to do.
   */
  dropOutOfWarp() {
    const t = this.transit;
    if (!t) return { ok: false, error: 'We are not under way, Captain.' };

    const near = t.nearestSystem(this.galaxy);
    this.locationId = near.id;
    // Same reason as `arrive`: the hours flown before breaking off have
    // already been spent by the clock that flew them.
    this.transit = null;
    this.orbit = null;
    this.mode = MODES.BRIDGE;

    this.loseTheHulkBehindUs();

    const isNew = this.galaxy.markVisited(this.locationId);
    this.pushLog(`Dropped to impulse at ${near.name}.`, 'helm');
    emit('arrived', { system: near, isNew, aborted: true });

    // Where you stopped is where you are. Breaking off a course inside the
    // Neutral Zone is the same crossing as flying into it deliberately, and the
    // Cardassians ask the same question of a heavy cruiser that coasted into
    // the demilitarised zone as of one that arrived there.
    const dmz = this.noticeTheBorder();

    // Stopping in the middle of nowhere is exactly when something finds you.
    const enc = rollEncounter(this.encounterStream(this.locationId), this.locationId, {
      ledger: this.ledger,
      ...this.encounterPerks(this.locationId),
      ...(dmz === 'challenged' ? { challengeBy: 'cardassian' } : {}),
    });
    if (enc && enc.kind !== 'quiet') this.beginEncounter(enc);
    return { ok: true, system: near, isNew };
  }

  /** Arrive: advance the calendar, roll for what is waiting. */
  arrive() {
    const t = this.transit;
    if (!t) return;
    this.locationId = t.to.id;
    // The calendar is NOT advanced here any more. It used to be handed the
    // whole voyage at the door, because the voyage itself took fourteen
    // seconds and the days had to come from somewhere. They are spent as they
    // pass now, hour by hour, by whoever is spending them — the tick loop or a
    // resume — so granting them again on arrival would pay for the trip twice.
    // Distance under way is where a crew actually learn a ship. Docked time is
    // not credited, which is why this is here and not in the campaign sync.
    //
    // The DISTANCE and not the hours: crediting hours paid eight times as much
    // for the same journey at warp 4 as at warp 8, so the way to master your
    // ship was to crawl. See EARNINGS in sim/mastery.js.
    this.creditMastery('lightYear', t.route?.lightYears ?? 0);
    // A detail sent out before a two-day voyage used to be advanced by the
    // whole voyage here, because the voyage took fourteen seconds and nothing
    // aboard noticed its hours going by. Those hours are now spent as they
    // pass, by `passTime`, so advancing them again on arrival would bring a
    // survey party back from a fortnight's work after a week of it.

    // Beside the crossing, and for the same reason: getting there is the moment
    // somebody notices. What it returns steers the encounter roll below.
    const dmz = this.noticeTheBorder();

    // Putting in somewhere Starfleet keeps people makes up the ship's
    // complement of specialists. The roster could only ever shrink before
    // this, and a commission ground it down until there were not enough of
    // them left to run a detail at all — see `replaceLosses`.
    for (const person of replaceLosses(this)) {
      this.pushLog(
        `${person.name}, ${person.label}, has come aboard at ${this.location?.name ?? 'the station'}.`,
        'comms',
      );
    }
    // "Volunteer Crew — crew losses replenish at any inhabited world." Fifty
    // Letters of Thanks, and nothing read the perk: the ship's complement only
    // ever came back at a spacedock, so a captain who had earned the goodwill
    // of every colony in the sector still limped between starbases.
    //
    // Volunteers, not a draft: they make up the numbers, and they do NOT bring
    // back the officers in the ledger by name. Nothing does that.
    if (this.perk('crew_replacement') && Game.INHABITED.has(this.location?.type)
      && this.ship.crew < this.ship.maxCrew) {
      const before = this.ship.crew;
      this.ship.crew = this.ship.maxCrew;
      this.pushLog(
        `${this.ship.crew - before} volunteers have come aboard at `
        + `${this.location?.name ?? 'the colony'}, Captain. They know your name.`,
        'comms',
      );
    }
    this.transit = null;
    // Arriving somewhere new is not arriving in orbit. The order to make orbit
    // is a separate one and the captain gives it.
    this.orbit = null;
    this.mode = MODES.BRIDGE;

    this.loseTheHulkBehindUs();

    const isNew = this.galaxy.markVisited(this.locationId);
    this.pushLog(`Arrived at ${t.to.name}.`, 'helm');
    if (isNew && t.to.unexplored) {
      this.ledger.record('anomaly_catalogued', { text: `First survey of ${t.to.name}`, system: t.to.id });
      this.awardXP(250);
    }
    emit('arrived', { system: t.to, isNew });

    const enc = rollEncounter(this.encounterStream(this.locationId), this.locationId, {
      ledger: this.ledger,
      ...this.encounterPerks(this.locationId),
      ...(dmz === 'challenged' ? { challengeBy: 'cardassian' } : {}),
    });
    if (enc && enc.kind !== 'quiet') this.beginEncounter(enc);
  }

  // ------------------------------------------------------------------ encounters

  beginEncounter(encounter) {
    this.encounter = encounter;
    this.mode = MODES.ENCOUNTER;
    // WHO IS TELLING YOU. Science, for everything, was right when everything
    // on the viewer was a sensor contact — an anomaly, a derelict, a hull on
    // an intercept course. A courier hailing with the mail is comms, and the
    // department heads asking for a night off is not a sensor reading at all;
    // the panel prints this as the station heading, so a note from the crew
    // arrived over the caption SCIENCE.
    this.pushLog(encounter.text, encounter.from ?? 'science');
    if (encounter.hostile) this.setAlert('red');
    else if (encounter.kind === 'anomaly' || encounter.kind === 'derelict') this.setAlert('yellow');
    emit('encounter:begin', encounter);
  }

  /**
   * What the captain may do about whatever is in front of the ship.
   *
   * This was built inside `encounterPanel` in src/ui/screens.js — a switch on
   * the encounter kind that appended buttons — so the only thing that knew
   * what choices existed was the thing drawing them. The consequence was the
   * central rule of this game broken across a whole panel: of the twenty-one
   * labels that switch prints, THREE said what they did. The rest were not
   * merely unsayable, they were wired to something else —
   *
   *   "Engage" asked which warp factor.
   *   "Withdraw" broke off a fight that was not happening.
   *   "Decline" refused a command nobody had offered.
   *   "Render assistance" called FOR help, which is the opposite.
   *   "Take us in close" was read as taking standing orders.
   *
   * So it lives here, where the order line can read it too, and each choice
   * carries the words that reach it. `say` is not decoration: it is checked
   * against the parser by a test, because a phrase printed on a button and
   * never tried is exactly how the panel got into this state.
   *
   * @returns {Array<{id, label, sub, color, say}>}
   */
  encounterChoices() {
    const enc = this.encounter;
    if (!enc) return [];
    const out = [];
    const add = (id, label, say, sub = null, color = '') => out.push({ id, label, say, sub, color });

    if (enc.hostile) {
      add('engage', 'Engage', 'engage them', 'Red alert. Bring weapons to bear.', 'red');
      if (enc.hailable !== false && FACTIONS[enc.factionId]?.hailable) {
        add('hail', 'Hail them', 'hail them', 'Talking is free until it is not.', 'lilac');
      }
      add('withdraw', 'Withdraw', 'withdraw', 'Leave the system.', 'ghost');
      return out;
    }

    switch (enc.kind) {
      case 'distress':
        add('assist', 'Render assistance', 'render assistance',
          `${enc.lives ?? 'Unknown'} lives at stake. Costs time.`, 'green');
        add('ignore', 'Continue on course', 'ignore it',
          'It will be in the log either way.', 'ghost');
        break;
      case 'derelict':
        add('board', 'Send an away team', 'board it',
          'Salvage is possible. So is the other thing.', 'amber');
        add('scan', 'Scan from here', 'scan it', 'Safer. Less useful.', 'ice');
        add('withdraw', 'Leave it', 'withdraw', null, 'ghost');
        break;
      case 'anomaly':
        add('approach', 'Take us in close', 'take us in close',
          `Hazard rating ${Math.round((enc.anomaly?.hazard ?? 0.3) * 100)}%.`, 'amber');
        add('scan', 'Scan from a safe distance', 'scan it', null, 'ice');
        add('withdraw', 'Note it and move on', 'withdraw', null, 'ghost');
        break;
      case 'convoy':
        add('escort', 'Provide escort', 'provide escort',
          `${enc.escortReward ?? 300} credits. Costs time.`, 'green');
        add('withdraw', 'Decline', 'withdraw', null, 'ghost');
        break;
      case 'first_contact':
        if (enc.preWarp) {
          add('withdraw', 'Withdraw without revealing ourselves', 'withdraw',
            'The Directive exists for a reason.', 'green');
          add('contact_prewarp', 'Make contact anyway', 'make contact anyway',
            'This cannot be undone.', 'red');
        } else {
          add('contact_peaceful', 'Open a channel', 'hail them',
            'First contact protocol.', 'green');
          add('scan', 'Scan them first', 'scan it', null, 'ice');
          add('withdraw', 'Withdraw', 'withdraw', null, 'ghost');
        }
        break;
      case 'trapped': {
        // Deliberately no "engage" and no "withdraw". There is nothing to
        // shoot and nowhere to go; what gets you out is something you built,
        // something you divert power to, or the patience to sit it out.
        const trap = enc.trap ?? {};
        const held = this.devices?.[trap.device] ?? 0;
        const recipe = RECIPE_BY_ID[trap.device];
        const name = recipe?.name?.toLowerCase() ?? 'device';
        add('trap_device',
          held > 0 ? `Use the ${name}` : `No ${name} aboard`,
          held > 0 ? 'use the device' : '',
          held > 0 ? 'The clean way out — if you thought of it in advance.'
            : 'You would need to have built one already.',
          held > 0 ? 'green' : 'ghost');
        add('trap_power', `Everything to ${trap.powerChannel ?? 'auxiliary'}`,
          'everything to auxiliary', 'Costs antimatter and unbalances the grid.', 'amber');
        add('trap_wait', 'Ride it out', 'ride it out',
          `${trap.waitHours ?? 0} hours${trap.damage ? ', and it will hurt' : ''}.`, 'ice');
        break;
      }
      case 'patrol':
        if (enc.hailable) add('hail', 'Hail them', 'hail them', null, 'lilac');
        add('withdraw', 'Continue', 'withdraw', null, 'ghost');
        break;
      case 'signal': {
        // Two ways for a quiet watch to go, and the second one is real: a
        // captain on a schedule declines a beacon he has no time for, and the
        // hours a signal costs are the same hours everything else costs.
        const sig = enc.signal ?? {};
        add('answer', sig.answer ?? 'Answer', sig.say ?? 'answer it',
          `${sig.hint ?? ''}${sig.hours ? ` About ${sig.hours} hours.` : ''}`.trim(), 'green');
        add('withdraw', 'Log it and continue', 'withdraw',
          'It goes in the record either way.', 'ghost');
        break;
      }
      default:
        add('withdraw', 'Continue', 'withdraw', null, 'ghost');
        break;
    }
    return out;
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
        this.spendHours(trap.waitHours);
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
        this.awardXP(300 + lives / 6);
        this.ledger.adjustStanding('federation', STANDING_EFFECTS.answered_distress, 'Answered a distress call');
        this.earnReputation('distress_answered');
        this.spendHours(14.4);
        out.messages.push(`Assistance rendered. ${lives} lives saved.`);
        if (enc.hostile && enc.ships?.length) {
          // Spent, exactly as in `engage` above and for the same reason. The
          // distress call that turns out to be a trap left this set: you won
          // the fight, flew four light years, and the game still believed
          // there was a freighter under attack back at Sol — so hailing at the
          // new system opened a channel to the ambushers' faction, because
          // `hail` reads the encounter's faction before the engagement's.
          this.encounter = null;
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
        // `sensorQuality` rather than the array's health alone: auxiliary is
        // the sensor channel, and at balanced power the two are identical, so
        // this is a nominal no-op that pays a captain who spends the power.
        const quality = 0.5 + this.progress.scanBonus + this.sensorQuality * 0.3;
        const success = this.rng.chance(quality);
        if (success) {
          this.ledger.record('anomaly_catalogued', {
            text: `Catalogued ${enc.anomaly?.name ?? 'phenomenon'} at ${enc.system.name}`, system: enc.system.id,
          });
          this.awardXP(120 * (enc.anomaly?.value ?? 1));
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
        this.awardXP(260 * (enc.anomaly?.value ?? 1));
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
          // "Salvage Contacts — derelicts yield an additional console." Fifty-
          // five Bars of Latinum, and no derelict ever yielded anything extra.
          //
          // A DIFFERENT console, not a second of the same one: two identical
          // relays is not an additional console in any sense a captain would
          // recognise, and the set bonuses count distinct pieces anyway. From
          // a derived stream, so a perk cannot shift the seeded galaxy.
          if (this.perk('salvage_bonus')) {
            const pool = SALVAGE_POOL.filter((id) => id !== enc.salvage);
            const extra = pool[Math.floor(this.derived(`salvage:${enc.system.id}`).float() * pool.length)];
            this.loadout.acquire(extra);
            out.messages.push(
              `Your Ferengi contacts had a buyer's list. ${CONSOLES[extra]?.name ?? extra} came off her too.`,
            );
          }
          this.awardXP(350);
        }
        break;
      }

      case 'answer': {
        // A signal answered. Everything it gives is something the game already
        // models — hours off the commission clock, experience, standing with
        // whoever asked, and a line in the record. Nothing here invents a
        // statistic to justify a sentence of prose.
        const sig = enc.signal ?? {};
        this.encounter = null;
        if (sig.hours) this.spendHours(sig.hours);
        if (sig.xp) this.awardXP(sig.xp);
        if (sig.standing) {
          // Whoever actually asked. A colony administrator in Federation space
          // credits the Federation; a freighter master out past the border
          // credits the people who live there.
          const who = enc.system?.faction ?? 'federation';
          this.ledger.adjustStanding(who, sig.standing, sig.title ?? 'Answered a signal');
        }
        if (sig.charts) {
          // Their track, which is the two systems next door they have just
          // come through. Real knowledge, gained by being sociable.
          const neighbours = (enc.system?.links ?? []).slice(0, 2);
          for (const id of neighbours) this.galaxy.markSurveyed(id, 'Reported by passing traffic');
          if (neighbours.length) {
            out.messages.push(`Their track covers ${neighbours.length} system`
              + `${neighbours.length === 1 ? '' : 's'} next door.`);
          }
        }
        if (sig.rested) {
          // A rested watch, expressed in the only currency the game has for
          // it: every bridge officer's tray comes off cooldown.
          let cleared = 0;
          for (const o of this.crew?.officers ?? []) {
            for (const k of Object.keys(o.cooldowns ?? {})) {
              if (o.cooldowns[k] > 0) { o.cooldowns[k] = 0; cleared++; }
            }
          }
          if (cleared) out.messages.push('Every station reports ready.');
        }
        this.ledger.record('signal_answered', {
          text: `${sig.title ?? 'Signal'} at ${enc.system?.name ?? 'an unnamed system'}`,
          system: enc.system?.id,
        });
        out.messages.push(sig.result ?? 'Answered.');
        break;
      }

      case 'escort': {
        this.ledger.adjustStanding(enc.factionId ?? 'independent', STANDING_EFFECTS.completed_escort, 'Escort completed');
        this.latinum += Math.round((enc.escortReward ?? 300) * (this.perk('better_prices') ? 1.25 : 1));
        this.earnReputation('escort_completed');
        this.awardXP(280);
        this.spendHours(19.2);
        out.messages.push(`Escort complete. ${enc.escortReward ?? 300} credits transferred.`);
        break;
      }

      case 'contact_peaceful': {
        const success = this.rng.chance(0.5 + this.progress.diplomacyBonus);
        if (success) {
          this.ledger.record('first_contact', {
            text: `First contact with the ${enc.speciesName}`, system: enc.system.id,
          });
          this.awardXP(900);
          this.ledger.adjustStanding('federation', STANDING_EFFECTS.first_contact_peaceful, 'First contact');
          this.earnReputation('first_contact');
          out.messages.push(`Contact established with the ${enc.speciesName}. They are... cautious, but talking.`);
        } else {
          out.messages.push('They break off without answering. The database gets a new entry and nothing else.');
          this.awardXP(200);
        }
        break;
      }

      case 'contact_prewarp': {
        // The Prime Directive is a real gate with real consequences.
        this.ledger.record('prime_directive_violation', {
          text: `Revealed the ship to a pre-warp culture at ${enc.system.name}`, system: enc.system.id,
        });
        this.ledger.adjustStanding('federation', STANDING_EFFECTS.prime_directive_violation, 'Prime Directive violation');
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
    if (result.xp) this.awardXP(result.xp);

    if (result.surrender) {
      this.ledger.record('surrender_accepted', { text: 'Accepted a surrender', faction: factionId });
      this.earnReputation('accepted_surrender');
    }

    if (result.endsCombat) {
      // A hail's result is not an ending — see HAIL_ENDING. Passing it straight
      // through meant `end` did not recognise it and fell back on "routed",
      // which pays a battle's experience and reputation for a conversation.
      if (eng) { eng.end(HAIL_ENDING[result.outcome] ?? 'parley'); }
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
      // And whatever was going on where we left is not going on here.
      //
      // This branch moves the ship and nothing cleared what it was holding, so
      // an encounter begun at the system the course started from stayed live,
      // pointing at a place the ship was no longer in — `game.encounter.
      // elsewhere`, the same orphan shape the comment on that invariant
      // already describes for `helpInbound`. It is invisible in play because
      // the encounter panel only draws in ENCOUNTER mode, and `hail` reads the
      // encounter's faction before the engagement's, so hailing after the
      // battle opened a channel to people in another star system.
      //
      // Found by the order monkey in tools/verify-app.mjs, which is the only
      // thing that gives orders in an order nobody would think to write down.
      this.encounter = null;
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
    // The escorts a reputation buys.
    //
    // Three of these now, so they are a table rather than a third copy of the
    // same twenty lines. Each was sold and none of them ever arrived: the
    // perks went into a Set nothing in the game read, and `Engagement` has
    // supported `opts.allies` the whole time with nothing putting one in.
    //
    // LIGHT units, every one — an escort is a ship detached to stand with you,
    // and a second Galaxy would decide the fight rather than help with it.
    //
    // Names come from a DERIVED stream. Drawing from `game.rng` for a name
    // would shift every seeded outcome downstream of the fight, so the same
    // battle would play out differently depending on which perks were held.
    const allies = [...(opts.allies ?? [])];
    if (!opts.scripted) {
      for (const e of Game.ESCORTS) {
        if (!this.perk(e.perk)) continue;
        if (e.space && this.location?.faction !== e.space) continue;
        if (e.oncePerVoyage && this[e.flag]) continue;
        if (e.oncePerVoyage) this[e.flag] = true;
        allies.push(new Ship(e.classId, {
          name: hostileName(e.faction, Math.floor(this.derived(e.perk).float() * 12)),
          faction: e.faction,
        }));
        if (e.line) this.pushLog(e.line, 'comms');
      }
    }
    // "Battle Doctrine Exchange — you always fire first in an engagement."
    //
    // Firing first has to MEAN something, and both sides opening with their
    // batteries ready means it means nothing: whoever taps the screen sooner
    // fires first. So the hostiles open one cycle behind, which is a real free
    // volley and is what the Empire teaching you their opening actually buys.
    //
    // NOT `game.firstStrike`, which is a different thing wearing the same
    // name — that flag means the captain shot at somebody peaceful and costs
    // 25% off every diplomacy roll.
    if (this.perk('first_strike')) {
      for (const s of fleet) for (const w of s.weapons) w.cooldown = w.cycle;
      this.pushLog('Their gunnery is slow off the mark, Captain. Empire doctrine.', 'tactical');
    }
    // The terrain, from what the map has said about this system all along.
    //
    // Six systems carry a `hazard` — a debris field at Wolf 359, a nebula at
    // Mutara, a plasma storm in the Badlands — and until now the only thing
    // that read it was the red pill on the system panel and a slightly higher
    // encounter chance. A battle in the Mutara Nebula was a battle in orbit of
    // Earth with different words on the screen.
    //
    // From a DERIVED stream, for the same reason the escorts' names are: rolls
    // taken from `this.rng` here would move every seeded outcome downstream of
    // the fight, so the same battle would play out differently depending on
    // whether the place it happened in had weather.
    // A FACTORY, not a stream: the engagement rebuilds the arena whenever it
    // re-places the combatants, and reinforcements do that mid-fight. Handing
    // it a live stream would move the rocks when the second wave arrived.
    const hazard = this.location?.hazard ?? null;
    const arenaRng = () => this.derived(`arena:${this.locationId}`);
    // `onEnd` is how a fight settles itself the moment it ends, from wherever
    // it ends. See Engagement.end.
    this.engagement = new Engagement(this.ship, fleet, this.rng, {
      ...opts, allies, hazard, arenaRng, onEnd: () => this.resolveCombat(),
    });
    if (this.engagement.arena.features.length) {
      this.engagement.pushLog(
        `We are fighting in a ${this.engagement.arena.name}, Captain.`, 'science');
    }
    if (allies.length > (opts.allies?.length ?? 0)) {
      this.pushLog(`${allies[allies.length - 1].name} is closing to support us, Captain.`, 'comms');
    }
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
    // Whether the game happens to be in combat MODE is not the question. A
    // finished engagement has to be settled wherever the game has got to,
    // because everything that follows a battle hangs off it — and requiring
    // the mode meant anything that moved the mode out from under a running
    // fight left one over-but-unsettled forever.
    const eng = this.engagement;
    if (!eng?.over) return false;
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
    // A battle teaches a crew their ship whatever the outcome — losing teaches
    // too. An exercise does not: the simulator is not this hull.
    if (!simulated) this.creditMastery('battle');

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
      const promo = this.awardXP(xp, { silent: true });
      this.pushLog(`Engagement concluded. +${Math.round(xp)} experience.`, 'captain');
      if (promo?.promoted) {
        this.pushLog(`Promoted to ${promo.rank.name}. ${promo.points} skill points and a feat to choose.`, 'captain');
      }
    }

    // Say so, rather than letting the hostile appear to evaporate.
    //
    // An interrupted fight is the one ending the captain did not choose and
    // was not told about: the app was backgrounded and the battle could not be
    // saved. Without a line here the ship simply wakes on the bridge, damaged,
    // with nobody to fight and no explanation.
    if (outcome === 'interrupted') {
      this.pushLog('Action broken off. The engagement was not carried to a decision.', 'captain');
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
      // Which ship fought it, and how many she carried.
      //
      // The report outlives the engagement on purpose. It also outlives the
      // SHIP: Starfleet hands over a different hull when one is lost and when a
      // command offer is taken, and neither touched this. So a costly battle in
      // a Galaxy followed by the loss of that Galaxy left the report saying it
      // had cost 811 of a crew of 750 — more people than the new ship carries —
      // because the only thing to check the casualties against was whatever
      // hull the captain was standing on now.
      shipName: this.ship.name,
      complement: this.ship.maxCrew,
      shotsFired: eng.shotsFired ?? 0,
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
        interrupted: `We were engaged. The action was broken off before it was decided.`,
      }[outcome] ?? `We were engaged. The outcome was ${outcome}.`;
      this.holdForTheCaptain(`${told} Hull integrity is at ${Math.round(this.ship.hullPct * 100)} percent.`);
      if (lost > 0) this.holdForTheCaptain(`We lost ${lost} of the crew.`);
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
    // Back to the bridge — unless the captain is somewhere else entirely. A
    // fight that finishes while a mission is on screen should not throw the
    // player off it.
    if (this.mode === MODES.COMBAT) this.mode = MODES.BRIDGE;
    this.setAlert(outcome === 'destroyed' ? 'red' : 'normal');

    // You said you were going to warp, so go — and go BEFORE anybody is told
    // how the fight ended.
    //
    // Breaking off ran a full eight-second countdown, announced "helm plotting
    // an escape course", reported "we are clear and at warp" — and left the
    // ship in the same system, in the same orbit, having burned nothing. The
    // one ending in the game that is ABOUT leaving was the only one that did
    // not move you. Now the countdown finishes into a real transit, which is
    // also what makes breaking off cost something: the antimatter, the days,
    // and arriving somewhere you did not choose.
    //
    // This sat below the emit when it was written, and `emit` is synchronous:
    // the panel that reports the ending read `game.transit` twenty lines before
    // anything set it, so every successful escape announced that the ship was
    // going nowhere and then went somewhere. The same defect the whole change
    // was made to fix, one line apart from the fix. It has to happen first.
    if (outcome === 'escaped' && !simulated) this.escapeToWarp();

    // An episode that ordered this fight has been waiting on it. Won means the
    // ending it declared and the reward held back for it; anything else means
    // the episode ends without them, because you did not do the thing the
    // ending says you did.
    // And only that fight settles it. Measured before this: taking a stage's
    // fight choice while already in an ordinary engagement, then finishing that
    // engagement, completed and banked the Borg cube episode and paid its 1,800
    // experience for killing a Bird-of-Prey at Sol — after which the cube
    // itself arrived, for an episode that was already over.
    const waiting = this.missions?.active?.pending;
    const oursToSettle = !!waiting && eng?.missionFightId != null
      && eng.missionFightId === waiting.fightId;
    const settled = oursToSettle ? this.missions.active.settleCombat(outcome) : null;
    if (settled?.complete) {
      this.missions.finishActive();
      if (!simulated) this.creditMastery('mission');
      this.pushLog(`${settled.ending?.label ?? 'The episode ends.'}`, 'captain');
    }

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

  /**
   * Where an escape course actually goes.
   *
   * The nearest charted neighbour: fleeing is the shortest hop out of the
   * system, not a considered destination, and it has to be somewhere the ship
   * could plot a course to in eight seconds. Deterministic, because everything
   * here is — the same fight from the same seed strands you in the same place.
   *
   * Failing to leave is a real outcome and it says so, in the words of whatever
   * actually stopped it — a dry tank and a wrecked warp core are not the same
   * problem and the crew would not report them the same way.
   *
   * The course is SEARCHED with `plotTransit`, which is pure, and only then
   * committed with `setCourse`. Trying `setCourse` speculatively made the helm
   * officer recite a separate refusal for every candidate system into the
   * combat log — seven "insufficient antimatter" lines and then a shrug.
   */
  escapeToWarp() {
    const here = this.locationId;
    const options = this.galaxy.neighbors(here)
      .filter((s) => s && s.id !== here)
      .sort((a, b) => distanceLy(here, a.id) - distanceLy(here, b.id));

    // Flat out if the tank will stand it, and as slow as it must be if not.
    //
    // Fuel goes as the 2.4th power of the warp factor, so the difference
    // between running at warp 8 and running at warp 1 is a factor of about a
    // hundred and fifty. Asking only about maximum warp told a ship with
    // 1.5% antimatter — ample to reach any of Sol's seven neighbours at warp
    // one — that it was not going anywhere, and left it sitting in the system
    // it had just fled a fight in.
    const top = Math.max(1, Math.round(this.ship.cls.maxWarp ?? 8));
    let why = null;

    for (const dest of options) {
      for (let factor = top; factor >= 1; factor--) {
        const plan = plotTransit(
          this.galaxy, here, dest.id, factor, this.ship, this.progress.warpEfficiency,
        );
        if (plan.error) { why = plan.error; continue; }
        const result = this.setCourse(dest.id, factor);
        if (result.ok) {
          this.pushLog(`Clear of them and running for ${dest.name}, warp ${factor}.`, 'helm');
          return result;
        }
        why = result.error ?? why;
      }
    }

    // Nothing worked. Say which nothing.
    const stuck = why ?? 'There is nowhere charted to run to.';
    this.officerSays('helm', `We are clear of them, Captain, but we are not going anywhere. ${stuck}`, 'report');
    return { ok: false, error: stuck };
  }

  // ------------------------------------------------------------------ missions

  /** Give up the episode in progress. Recorded, because it was a decision. */
  abandonMission() {
    const running = this.missions.active;
    if (!running || running.complete) {
      return { ok: false, error: 'We are not in the middle of anything, Captain.' };
    }
    this.missions.abandon(this);
    if (this.mode === MODES.MISSION) this.mode = MODES.BRIDGE;
    this.pushLog(`${running.title}: broken off.`, 'captain');
    this.officerSays('comms', `Logged, Captain. ${running.title} is closed out unfinished.`, 'report');
    return { ok: true, mission: running };
  }

  availableMissions() {
    return this.missions.availableAt(this.locationId, this);
  }

  startMission(id) {
    // One episode at a time. Starting a second used to replace the first
    // silently — see MissionBook.start.
    const running = this.missions.active;
    if (running && !running.complete) {
      const why = `We are still in the middle of ${running.title}, Captain.`;
      this.officerSays('comms', why, 'object');
      return { ok: false, error: why, active: running };
    }
    const m = this.missions.start(id, this);
    if (m) {
      // Not while people are shooting.
      //
      // `chooseMission` has always been careful about this — setting the mode
      // during a battle orphans the engagement, because Game.update stops
      // stepping it. Starting one was not: the fight kept its object, stopped
      // being ticked, and when something finally ended it the settle was
      // skipped because the mode was no longer COMBAT. That left an engagement
      // over-but-unsettled and a relief ship inbound to a battle that was not
      // running. Found by the API fuzzer.
      if (!this.engagement || this.engagement.over) this.mode = MODES.MISSION;
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
      // No `returnToMission` flag. There used to be one, set here and read by
      // nobody: the consumer in `update` destructures what it needs and drops
      // the rest. It was not a missing feature either — a mission stage hangs
      // on the bridge's own side strip (`missionPanel`), so a fight that
      // finishes and puts you back on the bridge has already put you back on
      // the mission. A field naming an intention nothing acts on is worse than
      // no field: it reads like the behaviour is handled.
      //
      // `canWarpOut` IS carried, because a stage can be about not being able to
      // leave. The Tholian web stage says in so many words that this is "a ship
      // that cannot go to warp until the lattice is broken", and there was no
      // way for it to say that to the engagement — so breaking off warped you
      // cleanly out of the thing holding you.
      // Both ends of the same token: the fight that is about to start, and the
      // episode that is waiting for it. Nothing else can answer for it.
      const fightId = this.orderTheStagesFight(spec);
      if (m.pending && fightId != null) m.pending.fightId = fightId;
    }

    if (result.complete) {
      this.earnReputation('mission_complete');
      this.missions.finishActive();
      // An episode seen through is the other thing that teaches a crew a ship.
      this.creditMastery('mission');
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

  buildAwayTeam(stations = ['science', 'medical', 'tactical'], captainLeads = false, opts = {}) {
    const members = stations.map((s) => this.crew.at(s)).filter(Boolean);
    this.awayTeam = new AwayTeam(members, {
      captainLeads,
      character: this.character,
      difficulty: this.difficulty,
      // "Boarding Party Training — your boarding parties are twice as
      // effective." The security detail is the boarding party: they are what
      // the check counts, and they are what dies. So twice as many of them,
      // which is both halves of "effective" at once — the party is better at
      // taking a bridge and the officers are further back in the queue when
      // somebody has to be hit.
      ...(opts.boarding && this.perk('boarding_master') ? { security: 8 } : {}),
      // People who know the ship turn out to help — where there are people.
      // Not on a boarding action: the locals aboard a hostile cruiser are the
      // ones being boarded.
      locals: !opts.boarding && this.perk('folk_hero') && Game.INHABITED.has(this.location?.type)
        ? 2 : 0,
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
    //
    // `boardableState` rather than the condition that used to be written out
    // here, because the same rule now governs somebody boarding US and one
    // rule should have one definition. The old one read `s.shieldPct <= 0.05`
    // — the MEAN of six facings — which combat cannot produce: fire lands on
    // one facing while the other five regenerate, and across forty ordinary
    // engagements the lowest mean a hostile ever reached was 0.497. So this
    // was never offered in a fight, and every test that exercised it flattened
    // all six facings by hand.
    const boardable = eng && !eng.over
      ? eng.liveHostiles.find((s) => !s.cloaked
        && boardableState(s, this.ship)
        && this.ship.distanceTo(s) < BOARDING_RANGE)
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
        //
        // The pre-warp flag lives on the ENCOUNTER — buildFirstContact sets it
        // — and `unexplored` is a flag on the system, not one of its eight
        // types. Reading `sys.preWarp` and `sys.type === 'unexplored'` meant
        // this template could never be offered anywhere, which left the
        // captain at a first contact with obey-or-violate and no third path.
        // `sys.preWarp` stays in case a system is ever authored with one.
        if (this.encounter?.preWarp || sys.preWarp || sys.unexplored) {
          out.push({ ...AWAY_TEMPLATES.covert_landing });
        }
      }
    }

    // A world is done with once. Thirty-two diplomatic landings at Vulcan back
    // to back was a real measurement, not a hypothetical: the same two officers
    // opened the same discussion with the same government thirty-two times in
    // an afternoon and were paid for it every time.
    //
    // Only the templates that are about a PLACE. A boarding action is about a
    // ship and is gated by that ship's state; a derelict search is about a hulk
    // and is gated by `wreckHere.boarded`. Filtering those by system would stop
    // a captain boarding the second hostile in a fight, or the second wreck in
    // a system, which is not what "once per world" means.
    return out.filter((t) => !PLACE_TEMPLATES.has(t.id)
      || !this.awayDone.has(`${t.id}@${this.locationId}`));
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
  awayMission(templateId, opts = {}) {
    const done = this.noLongerInCommand();
    if (done) return { ok: false, reason: done.reason };
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
    // Whether the captain goes down with them. `captainLeads` was hard-coded
    // false here, so the one branch that ever honoured "I'll lead" was the one
    // that says there is nowhere to send anybody — the order was understood by
    // two parsers and then dropped on every path that actually ran a mission.
    const team = this.buildAwayTeam(stations, !!opts.captainLeads,
      { boarding: template.id === 'boarding_action' });
    if (!team.members.length) {
      return { ok: false, reason: 'There is nobody fit to send, Captain.' };
    }

    this.pushLog(`${template.title}${opts.captainLeads ? ', with the captain leading' : ''}. `
      + 'Landing party is away.', 'transporter');
    const steps = [];
    let captainWounded = false;
    for (const step of template.steps) {
      const r = team.check(this.rng, step.check, {
        dc: step.dc, hazard: template.hazard, label: step.text,
      });
      this.pushLog(`${step.text} — ${r.formatted}`, 'science');
      if (r.killed) this.pushLog(`We lost ${r.killed.name}.`, 'medical');
      else if (r.injured) this.pushLog(`${r.injured.name} is hurt.`, 'medical');
      steps.push({ text: step.text, success: r.success, officer: r.officer?.name ?? null });
      // The captain going down ends the landing party, for the same reason a
      // team with nobody left standing does: whoever is still on their feet is
      // carrying somebody. That is the price of the +2 for leading, and it was
      // not being charged — `captainWounded` was set and read by nobody.
      if (r.captainWounded) {
        captainWounded = true;
        this.pushLog(
          'You are hit, Captain. The party is breaking off and carrying you back to the ship.',
          'medical',
        );
        this.ledger.record('captain_wounded', {
          text: `Wounded leading ${template.title.toLowerCase()} at `
            + `${this.location?.name ?? this.locationId}`,
          system: this.locationId,
        });
        break;
      }
      // A team that has nobody left standing does not carry on.
      if (!team.members.length) break;
    }

    // Measured against the objectives the mission HAD, not the ones it got to.
    // With `steps.length` as the denominator a party that broke off after one
    // success out of three read as a clean sweep — already true for a wiped-out
    // team, and the captain going down is a second way to break off.
    const total = template.steps.length;
    const won = steps.filter((s) => s.success).length;
    const outcome = won === total ? 'success'
      : won === 0 ? 'failure' : 'partial';
    const lost = team.casualties.filter((c) => c.killed).length;

    this.applyAwayOutcome(template, outcome, won, total);

    const report = {
      ok: true, id: template.id, title: template.title, outcome,
      steps, passed: won, of: total, captainWounded,
      casualties: team.casualties.slice(), lost,
    };
    this.lastAway = report;
    // A world is done with once, whatever the party brought back: a colony you
    // failed to evacuate is a colony that has been evacuated as far as it is
    // going to be, and letting failure re-arm the offer would make retrying
    // until it works the correct play.
    if (PLACE_TEMPLATES.has(template.id)) {
      this.awayDone.add(`${template.id}@${this.locationId}`);
    }
    // What it cost. Charged after the checks are rolled, so the hours the party
    // was down do their work — damage control, the shop, the details — against
    // a ship whose casualties are already aboard.
    const hours = awayHours(template);
    this.spendHours(hours);
    report.hours = hours;
    this.ledger.record('away_mission', {
      text: `${template.title}: ${won} of ${total} objectives`
        + (lost ? `, ${lost} lost` : '')
        + (captainWounded ? ', broken off with the captain wounded' : ''),
      system: this.locationId,
    });
    this.pushLog(
      `Landing party is back aboard. ${won} of ${total} objectives.`
      + (lost ? ` We lost ${lost}.` : ''),
      'transporter',
    );
    emit('away:mission', report);
    return report;
  }

  /** What a landing party's result changes about the world it happened in. */
  applyAwayOutcome(template, outcome, won, total) {
    const share = total ? won / total : 0;
    this.awardXP(Math.round(120 * share * (HAZARD_LEVEL[template.hazard]?.death ?? 0.05) * 20));

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
      this.ledger.adjustStanding('federation', STANDING_EFFECTS.observed_during_survey, 'Observed by a pre-warp culture');
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
      this.awardXP(60);
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

    // "Sworn Ally of the Empire — a Klingon battlecruiser answers your call
    // once per voyage."
    //
    // Which is exactly the two cases below, where Starfleet does not come. A
    // sworn ally is worth having precisely where your own service will not
    // reach you, and the perk was sold for 290 Marks of Honour and never
    // read. Once per VOYAGE, not per fight: the Empire is doing you a favour,
    // and the debt resets when you next put in.
    const starfleetSilent = (!friendly && tier < 2) || standing < -20;
    if (starfleetSilent && this.perk('kdf_ally') && !this.klingonAnswered) {
      this.klingonAnswered = true;
      this.helpCalled = true;
      const eta = 18 + this.derived('kdf-help').float() * 22;
      this.helpInbound = {
        classId: 'd7',
        name: hostileName('klingon', 0),
        faction: 'klingon',
        eta,
      };
      this.pushLog(
        `${this.helpInbound.name} answers on a Klingon frequency, Captain. `
        + `Estimated ${Math.round(eta)} seconds. They say they are owed a song for this.`,
        'comms',
      );
      emit('help:called', this.helpInbound);
      return { ok: true, answered: true, eta, ship: this.helpInbound.name };
    }

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

    // The faction the caller said, not always Starfleet. A sworn ally of the
    // Empire who calls for help gets a D7, and hardcoding 'federation' here
    // would have put a Klingon battlecruiser on the board flying Starfleet
    // colours — which the renderer, the AI's target selection and the log
    // would all have believed.
    const ally = new Ship(inbound.classId, {
      name: inbound.name, faction: inbound.faction ?? 'federation',
    });
    eng.allies.push(ally);
    eng.placeCombatants();
    eng.pushLog(`${ally.name} dropping out of warp, Captain. She is engaging.`, 'comms');
    // No reputation for being rescued. Whatever the fleet thinks of a captain
    // who needed help, it is not a commendation, and the ledger already
    // records the engagement itself.
    emit('help:arrived', ally);
  }

  // ------------------------------------------------------------------ docking

  /**
   * Berthing rights a reputation project buys outright.
   *
   * Only the two whose descriptions are ABOUT berthing. "Free passage through
   * Klingon space, and a seat at the table" is a berth at Qo'noS, and
   * "repair rights at Cardassian facilities" is a berth at Cardassia Prime.
   *
   * Deliberately NOT `romulan_accord` ("the Neutral Zone opens to you") or
   * `dmz_passage` ("free movement through the demilitarised zone"): the two
   * remaining gated systems are Romulus and the Founders' Homeworld, and
   * neither is the Neutral Zone or the DMZ. Wiring a perk to whatever
   * mechanism is nearest to hand is how a project comes to do something other
   * than what it says, which is barely better than doing nothing.
   */
  static PASSAGE_PERKS = {
    klingon: 'klingon_passage',
    cardassian: 'cardassian_dock',
  };

  /** Somewhere with people in it — a "Safe Harbour" is not an anomaly. */
  static INHABITED = new Set(['core', 'colony', 'homeworld', 'starbase', 'outpost', 'station']);

  /**
   * Ships a reputation brings to a fight.
   *
   * `space` is the faction whose territory the perk covers, or null for
   * anywhere. `oncePerVoyage` spends a flag that `dock()` clears — the
   * difference between a standing authorisation and a favour or a contract,
   * and it is what each project's own wording says.
   */
  static ESCORTS = [
    {
      perk: 'ally_escort', classId: 'miranda', faction: 'federation', space: 'federation',
    },
    {
      // Money does not care whose space this is, which is the whole difference
      // between this and the Starfleet escort and the reason to buy both.
      perk: 'mercenary_escort', classId: 'marauder', faction: 'ferengi', space: null,
      oncePerVoyage: true, flag: 'marauderHired',
      line: 'The Marauder is answering, Captain. They want it noted that this is '
        + 'the contracted engagement.',
    },
    {
      // "A Galor escorts you through Cardassian space, watching very
      // carefully." Watching you, is the implication, and they come anyway.
      perk: 'cardassian_ally', classId: 'galor', faction: 'cardassian', space: 'cardassian',
      line: 'A Galor is standing off our beam, Captain. Union colours. '
        + 'They are watching us at least as closely as they are watching them.',
    },
  ];

  canDock() {
    const sys = this.location;
    // "Safe Harbour — every inhabited system will dock and repair you." A
    // colony with no yard finds you a berth anyway; a nebula does not, because
    // there is nobody in it to ask.
    const harbour = this.perk('universal_dock') && Game.INHABITED.has(sys?.type);
    if (!harbour && !sys?.facilities?.includes('dock')) return false;
    if (sys.requiresStanding) {
      for (const [f, v] of Object.entries(sys.requiresStanding)) {
        // The gate is the whole of what these projects were selling, and it
        // was never lifted: a captain sworn to the Empire was still turned
        // away at Qo'noS for want of ten points of standing.
        if (this.perk(Game.PASSAGE_PERKS[f]) || harbour) continue;
        if (this.ledger.standingOf(f) < v) return false;
      }
    }
    return true;
  }

  dock() {
    const done = this.noLongerInCommand();
    if (done) return done;
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
    // "Priority Yard Access — refits and repairs at any starbase cost no
    // time." The whole of what that project sells is the stardate below, and
    // it was charged in full to every captain who bought it.
    //
    // Not zero: the ship still has to be alongside. But the days in the yard
    // are what the yard access buys, so a hull that came in shot to pieces is
    // turned round in the same time as one that came in for stores.
    // A new voyage begins alongside, so the Empire's favour and the Marauder's
    // contracted engagement are both available again.
    this.klingonAnswered = false;
    this.marauderHired = false;
    const yard = this.perk('free_refit') ? 0.5 : (damaged ? 2.5 : 0.5);
    this.spendHours(yard * 24);
    this.pushLog(`Docked at ${this.location.name}. Repairs and resupply complete.`
      + (this.perk('free_refit') && damaged ? ' Priority yard access — she was turned round overnight.' : ''),
      'engineering');
    emit('docked', this.location);
    // A board of inquiry sits ashore, not on patrol (RESEARCH.md §22). This is
    // the only way one ever concludes: before this, the flag that suspends
    // promotion was set in one place and cleared in none, so three Prime
    // Directive violations froze the rank ladder for the rest of a five-year
    // commission — under a screen promising it lasted only until the board
    // concluded.
    const finding = convene(this);
    if (finding) {
      // A rank held by a closed board can be earned again, and should be said
      // again if a second board ever holds it.
      this.promotionHeld = false;
      // Two days for it. A hearing is not a formality you attend between
      // resupply and departure.
      this.spendHours(48);
      this.pushLog(finding.text, 'comms');
      if (finding.reducedTo) {
        this.pushLog(`Your rank is now ${finding.reducedTo}.`, 'captain');
      }
    }
    return { ok: true, finding: finding ?? null };
  }

  // ------------------------------------------------------------------ tick

  update(dt) {
    // The commission runs while you are on the bridge.
    //
    // `campaign.commissionHours` was written by `syncCampaign` and by nothing
    // else, and `syncCampaign` is called on load and when the tab comes back —
    // so the five-year mission advanced only while nobody was playing it.
    // Measured: two hours of continuous play moved the commission clock by
    // 0.0000 days, and then one background-and-foreground with zero seconds
    // closed credited all two hours as an absence and repaired the hull for
    // them. Time the captain sat through was worth nothing until they left.
    //
    // First, and unconditional. Time does not stop for a fight, for a board of
    // inquiry, or for a career that has already ended — and the commission's
    // own end at 1,826 days is checked ninety lines below, which is the first
    // thing that can now be reached by playing rather than by walking away.
    // Spent in slices rather than every tick. `advanceFabrication` and
    // `advanceAssignments` are the same functions an absence runs, and calling
    // them thirty times a second with four ten-thousandths of an hour each is
    // both wasteful and, for anything that rounds, wrong. A quarter of an hour
    // is short enough that nothing waits on it and long enough to be a number.
    const lived = this.campaign?.advanceOpen(dt) ?? 0;
    // The stardate is the commission clock read out loud. Twelve call sites
    // still advance it by hand for a specific act; this is the one that
    // advances it because time is passing, which is what a date is.
    if (lived > 0) this.clock.advanceStardate(lived / 24);
    this.livedHours += lived;
    if (this.livedHours >= LIVED_SLICE_HOURS) {
      const lived = this.livedHours;
      this.livedHours = 0;
      const { finished, returned } = this.passTime(lived, { livedThrough: true });
      if (finished) {
        this.pushLog(`${finished.recipe.name} is finished, Captain. ${finished.text}`, 'engineering');
      }
      for (const back of returned) {
        this.pushLog(`${back.assignment.name} is back aboard. ${back.text}`, 'comms');
      }
    }
    this.crew.update(dt * (1 + this.progress.officerCooldownBonus));

    // A ship lost where nobody was shooting is still a ship lost.
    //
    // `loseTheShip` is the whole policy — difficulty decides whether a hull can
    // be lost at all, the first loss costs standing and brings a board and a
    // replacement, and the second ends the career. It was reached from exactly
    // one place, `finishCombat`, so it only ever ran when the ship died in a
    // fight.
    //
    // A ship can die outside one. A plasma storm in the Badlands does 40 to 130
    // damage a second through `takeDamage`, which breaches a hull like anything
    // else; a ship parked there at 6% is gone inside a minute. Nothing noticed,
    // and the captain was left in command of a destroyed ship — no replacement,
    // no ending, and the invariant checker quiet, because the ship is correctly
    // flagged destroyed. It is only the commission that had not been told.
    if (this.ship.destroyed && !this.over && !(this.engagement && !this.engagement.over)) {
      this.pushLog(
        `${this.ship.name} has been lost at ${this.location?.name ?? 'an uncharted position'}.`,
        'captain',
      );
      this.loseTheShip();
      return;
    }

    // Five years, and then you are relieved.
    //
    // `CampaignClock` counted the whole thing correctly — 1,826 days, banked at
    // the compression in force when they passed, monotonic against a phone
    // clock that moves in either direction — and then NOTHING READ IT. The
    // bridge would print "The five-year mission is complete." out of
    // `remainingText()` while the game carried blithely on: measured at day
    // 1,856, `complete` true, `progress` pinned at 1, `over` false. Year six,
    // day thirty-one, still steering.
    //
    // Checked before `stranded()` on purpose. A captain who reaches the last
    // day of a commission with dry tanks has served the five years; Starfleet
    // sends a tender and takes the ship back. Being out of fuel on the morning
    // you are relieved is the fleet's problem, not the end of a career.
    if (this.campaign?.complete && !this.over) return this.endOfCommission();

    // A commission that cannot go on is over, and says so.
    //
    // Running the tank dry somewhere with no berth and nothing affordable next
    // door used to leave the game in the one state a five-year commission must
    // not have: unable to move, unable to refuel, neither continuing nor
    // ending. Losing the ship ends a career; so does losing the ability to fly
    // her, and for the same reason — the record stands on what happened, not
    // on the player sitting at a helm that answers nothing.
    if (this.stranded()) {
      this.pushLog(
        `${this.ship.name} is adrift at ${this.location?.name ?? 'an empty system'} with dry tanks `
        + 'and no berth within reach. There is nothing further to order.',
        'engineering',
      );
      this.ledger.record('ship_stranded', {
        text: `${this.ship.name} stranded at ${this.location?.name ?? this.locationId}`,
        system: this.locationId,
      });
      return this.gameOver('stranded with no antimatter and no port within reach');
    }
    this.updateWalk(dt);

    // The ship is alive whether or not anyone is shooting at her.
    //
    // `Ship.update` was reached from exactly one place — `Engagement.update`
    // in src/sim/combat.js — so outside a fight the player's ship was a frozen
    // object. Everything that file steps stopped at the moment the last
    // hostile left the board:
    //
    //   The power grid never settled. "Power to shields" on the bridge moved
    //   `target` and never moved `levels`, so the preset lit up green, the
    //   slider stayed where the captain put it, and every `factor()` reading
    //   in the game went on describing the distribution he had replaced. The
    //   order took effect one tick into the NEXT battle.
    //
    //   Fires burned forever and burned nothing. Damage control is in that
    //   method, so a ship that left a battle alight kept "2 fires still
    //   burning" on her engineering report for the rest of the commission —
    //   a damage report that was permanently and visibly wrong.
    //
    //   Shields never came back. A facing beaten flat stayed flat across
    //   every transit until the ship either docked or found another fight.
    //
    //   Buffs never expired, subsystems never mended, and a warp core left
    //   counting down stopped counting.
    //
    // The hull is deliberately NOT in that list: nothing in `Ship.update`
    // repairs hull, so a starbase and the machine shop are still the only
    // things that put a ship back together. What time buys is her shields,
    // her subsystems and the fires — which is the line the game already drew
    // everywhere else.
    if (this.mode !== MODES.COMBAT) this.ship.update(dt, this.upkeepRng);
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
        // Commission hours, not seconds of play. Fed every tick rather than in
        // the quarter-hour slices the ship's work is spent in, so the course
        // plot advances smoothly instead of jumping.
        const arrived = this.flyOn(lived);
        if (!arrived && this.rng.chance(INTERCEPT_PER_HOUR * lived) && !this.transit.interrupted) {
          // Something drops us out of warp mid-course.
          //
          // On the MAIN stream, unlike the arrival roll. Being intercepted is
          // a random event in time and in the space between two systems; what
          // is waiting AT a system is a fact about that place and that visit.
          // Sharing one key between them made intelligence about the
          // destination describe the ambush on the way to it instead — the
          // forecast said "nothing waiting" and the ship met a distress call
          // it had been told nothing about, because the two rolls read the
          // same key with different options.
          // Rolled for where the ship will actually STOP, not for where it was
          // pointed.
          //
          // This branch drops the ship at the nearest system on the route and
          // then began an encounter built for the destination, so the encounter
          // was live in a system it was never in — `game.encounter.elsewhere`,
          // about one in thirteen mid-course ambushes. Two thirds of those
          // fielded somebody with no presence where the ship had stopped:
          // setting course from Starbase 1 for the Neutral Zone and being
          // forced out of warp a light-year from Earth put a Romulan warbird
          // in the Sol system. Whoever jumps you is a fact about where you are
          // when they do it.
          //
          // `nearestSystem` reads position only, so it is the same answer
          // before the interrupt as after it.
          const near = this.transit.nearestSystem(this.galaxy);
          const enc = rollEncounter(this.rng, near.id, { ledger: this.ledger, inTransit: true, ...this.encounterPerks(near.id) });
          if (enc && enc.hostile) {
            this.transit.interrupt('hostile contact');
            this.locationId = near.id;
            this.transit = null;
            this.pushLog('We have been forced out of warp.', 'helm');
            // Being jumped on the way in does not make the line you were
            // dropped behind stop being there. The encounter is already chosen
            // and already hostile, so this records the border and says so
            // without re-rolling: you have company either way.
            this.noticeTheBorder();
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
      const { ships, canWarpOut, fightId } = this.pendingCombat;
      this.pendingCombat = null;
      const eng = this.startCombat(ships, {
        name: 'Engagement',
        ...(canWarpOut === false ? { canWarpOut: false } : {}),
      });
      // The fight now on the screen answers for the episode only if the
      // episode's enemies are actually in it. `startCombat` does not always
      // start one: called during a fight it puts the new ships into the
      // engagement in progress instead — "More of them, closing" — which is
      // still the episode's fight, and refuses outright when handed nobody.
      if (eng && ships.some((s) => eng.hostiles.includes(s))) eng.missionFightId = fightId;
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
      // A ship lost is a ship lost — not, by itself, the end of a career.
      //
      // The difficulty screen promises that "the ship can be lost". It never
      // promised the commission ends, and reading the flag that way meant the
      // single most dramatic thing that can happen to a starship captain was a
      // game-over screen. Kirk destroyed the Enterprise, was tried for it,
      // was reduced in rank, and was given the Enterprise-A (RESEARCH.md §21).
      //
      // He was given exactly one. So is the player: the second loss is where a
      // career ends, because Starfleet does not hand out a third hull.
      this.shipsLost = (this.shipsLost ?? 0) + 1;
      if (this.shipsLost > 1) {
        return this.gameOver('a second ship lost — no further command was offered');
      }

      const lost = this.ship.name;
      const board = replacementFor(this);
      this.ledger.record('ship_lost', {
        text: `${lost} lost at ${this.location?.name ?? 'an unknown system'}`,
        system: this.locationId,
      });
      // The reckoning, and it costs something real before the ship arrives.
      this.ledger.adjustStanding('federation', -12, 'Loss of a starship');
      // And an actual board, which this used to promise in the next line and
      // never convene: the flag was never set, so a captain could lose the
      // Enterprise and be promoted to Fleet Captain the same day. It sits when
      // he next makes port (RESEARCH.md §22).
      this.ledger.openInquiry(`the loss of ${lost}`);
      this.pushLog(
        `${lost} is gone, Captain. There will be a board of inquiry when we next `
        + 'put in, and it is already on your record.',
        'comms',
      );
      const took = takeCommandOf(this, board.id);
      if (!took.ok) return this.gameOver('ship lost and no hull available');
      this.pushLog(
        `Starfleet assigns you ${this.ship.name}. She is not ${lost}, and nobody `
        + 'aboard has worked her up.',
        'captain',
      );
      const yard = yardReport(took, CONSOLES);
      if (yard) this.pushLog(yard, 'engineering');
      emit('ship:replaced', { ship: this.ship, lost });
      return null;
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

  /**
   * Above this much antimatter, no ship is stranded anywhere in the charts.
   *
   * The cheapest thing any ship can do is warp 1 to its nearest neighbour, and
   * the dearest such hop in the galaxy costs well under this. It exists so the
   * check below is a cheap comparison on the common path and only walks the
   * neighbours when the tank is genuinely low.
   */
  static get STRANDED_FUEL() { return 5; }

  /**
   * Can this ship still get anywhere?
   *
   * A full tank is about ten neighbour jumps at warp 7, nothing regenerates
   * antimatter, and no recipe makes it — so a captain who does not dock will
   * run dry eventually. At 13 of the galaxy's 43 systems that means no course
   * the ship can afford and no docking facility either, and the commission
   * simply stopped: unable to move, unable to refuel, neither continuing nor
   * ending.
   *
   * Warp 1 to the nearest neighbour is the cheapest thing a ship can do, so if
   * that is refused everywhere and there is no berth here, there is nothing
   * left to try.
   */
  stranded() {
    if (this.over || this.transit || this.ashore) return false;
    if (this.engagement && !this.engagement.over) return false;
    if (this.canDock()) return false;
    // Cheap guard first: a ship with fuel for the cheapest hop is not stuck,
    // and this runs on a tick.
    if (this.ship.antimatter > Game.STRANDED_FUEL) return false;

    return !this.galaxy.neighbors(this.locationId).some((n) => !plotTransit(
      this.galaxy, this.locationId, n.id, 1, this.ship, this.progress.warpEfficiency,
    ).error);
  }

  /**
   * The five years are up. Hand the ship back.
   *
   * This is the only *good* ending the game has, and it goes through the same
   * door as the bad ones because there is only one door — the end-of-commission
   * screen reads `overReason` and `ledger.assessment()` whatever brought the
   * captain to it. What separates them is `commissionCompleted`, so the screen
   * can tell a career that finished from one that ended.
   */
  endOfCommission() {
    const years = (this.campaign.elapsedDays / 365.25).toFixed(1);
    this.pushLog(
      `${this.ship.name} is ordered home. ${this.campaign.format()} — the commission is complete `
      + `after ${years} years, and command passes to relief at the earliest opportunity.`,
      'captain',
    );
    // Recorded, and deliberately weightless: `RECORD_WEIGHTS` has no entry for
    // this, so `serviceScore()` counts it as zero. The assessment bands were
    // tuned without a completion bonus, and a captain does not get to be
    // Exemplary for having merely lasted. What the five years were worth is
    // already in the rest of the record.
    this.ledger.record('commission_completed', {
      text: `Five-year commission completed aboard ${this.ship.name}`,
      system: this.locationId,
      count: 1,
    });
    return this.gameOver(
      `the five-year commission is complete — ${Math.floor(this.campaign.elapsedDays)} days served`,
      { completed: true },
    );
  }

  gameOver(reason, { completed = false } = {}) {
    this.over = true;
    this.overReason = reason;
    // Whether this was a career finished or a career ended. The screen changes
    // its whole tone on it, so it is a field rather than something re-derived
    // by matching on the wording of `reason`.
    this.commissionCompleted = completed;
    emit('game:over', {
      reason, completed, ledger: this.ledger, assessment: this.ledger.assessment(),
    });
  }

  // ------------------------------------------------------------------ save

  save() {
    return {
      version: 2,
      seed: this.seed.toString(),
      rng: this.rng.save(),
      upkeepRng: this.upkeepRng.save(),
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
      missionFightSeq: this.missionFightSeq,
      locationId: this.locationId,
      // Where the ship is GOING, not only where it last was. See Transit.save.
      transit: this.transit?.save?.() ?? null,
      mode: this.mode,
      stardate: this.clock.stardate,
      latinum: this.latinum,
      log: this.log.slice(-80),
      over: this.over ?? false,
      // `over` was saved and the reason for it was not, so a captain who
      // reloaded a finished commission got an end-of-commission screen that
      // said only "Your command has ended." and would not say what had
      // happened — the one screen whose entire job is to tell you.
      overReason: this.overReason ?? null,
      commissionCompleted: this.commissionCompleted ?? false,
      // The alert condition is an order with a price on it, not a colour.
      // `effectRepairs` pays `blue ? 0.18 : 0.12` of the hull and `blue ? 0.6
      // : 0.8` stardate, so a captain who called maintenance stations and then
      // closed the app came back at normal with every later repair worth a
      // third less, and nothing to say why.
      alert: this.alert,
      // The stamp every ledger entry gets. It is re-set from the clock on each
      // tick, so it was only ever wrong in the window between a load and the
      // first update — but an entry recorded in that window went into the
      // permanent record stamped `stardate: null`.
      ledgerStardate: this.ledger.stardate ?? null,
      // The after-action record. Its own comment says it "survives the fight,
      // which is what an after-action report is for" — and it did not survive
      // a save, because nothing wrote it down. The panel that reads it in
      // main.js came back empty after every reload.
      lastCombat: this.lastCombat ?? null,
      // A fight that was still running when the record was written.
      //
      // `Game.load` deliberately wakes on the bridge and does not resume a
      // battle; the comment there explains why and it is right. What was
      // missing is the other half: nothing serialised the engagement and
      // nothing accounted for it, so the hostile stopped existing while the
      // hull kept every point of damage the fight had cost, the alert fell
      // back to normal, and no record was written. The ship came back wounded
      // from a battle the game had no memory of.
      //
      // That is the shape of the bug fixed a few lines below this, in this
      // same file: "the fuel was charged and the voyage was not". Here the
      // damage was taken and the fight was not.
      //
      // Written rather than settled, because `save()` is a snapshot and must
      // not change the game it is describing. Ending the fight here broke
      // every caller that saves mid-battle without meaning to stop it — the
      // browser harness stages fights for portraits and reported
      // "fight-ended-mid-portrait" for eight checks at once.
      interruptedCombat: this.engagement && !this.engagement.over
        ? {
          outcome: 'interrupted',
          name: this.engagement.name,
          killed: this.engagement.hostiles.filter((h) => h.destroyed).length,
          hostiles: this.engagement.hostiles.length,
          hullLeft: this.ship.hullPct,
          crewLost: Math.max(0, Math.round((this.engagement.crewAtStart ?? this.ship.maxCrew) - this.ship.crew)),
          shotsFired: this.engagement.shotsFired ?? 0,
          seconds: Math.round(this.engagement.time),
          systemId: this.locationId,
          stardate: this.clock.stardate,
        }
        : null,
      campaign: this.campaign?.save() ?? null,
      livedHours: this.livedHours,
      awayDone: [...this.awayDone],
      stores: this.stores,
      fabrication: this.fabrication,
      dutyRoster: (this.dutyRoster ?? []).map((p) => p.save()),
      mastery: this.mastery?.save() ?? null,
      // How many hulls this career has cost, and any standing offer of
      // another. Both are decisions the campaign has already made or put to
      // the captain, and a save that forgot them would hand back a second
      // first ship or lose an offer that was made.
      shipsLost: this.shipsLost ?? 0,
      commandOffer: this.commandOffer ?? null,
      declinedCommands: this.declinedCommands ?? [],
      assignments: this.assignments ?? [],
      devices: this.devices,
      kobayashiRuns: this.kobayashiRuns ?? 0,
      // A favour already spent this voyage. Dropped on load, closing the app
      // between fights would have been a way to call the Empire again.
      klingonAnswered: this.klingonAnswered === true,
      marauderHired: this.marauderHired === true,
      // Whether she is already over the line. Dropped on load, a save taken
      // inside the Zone would be charged for the crossing again on the next
      // arrival, without the ship having moved.
      inTheZone: this.inTheZone === true,
      inTheDMZ: this.inTheDMZ === true,

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
        ? {
          station: this.conStation, given: this.conGiven === true,
          hours: this.conHours, lines: this.conLines, dropped: this.conDropped,
        }
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
   * The order line, after there is nobody to give orders.
   *
   * `over` is set by three endings — a career finished by a second ship lost, a
   * ship stranded with no port in reach, and the five years served — and the
   * app routes to the ending screen for all three. The MODEL did not: measured
   * after "a second ship lost — no further command was offered", `setCourse`
   * came back `{ ok: true }` and the ship went to warp. Docking and ordered
   * repairs did too, and the commission clock ran on to day 1,848.
   *
   * That is the shape `endOfCommission`'s own comment was added to prevent —
   * "Year six, day thirty-one, still steering" — and the fix that stopped the
   * clock's ending being ignored did not stop the orders being taken. In this
   * game the rule belongs in the model rather than in the screen, which is the
   * stated reason `dropOutOfWarp` and `trainOfficer` were both hoisted out of
   * one, so a captain who is no longer a captain is told so here.
   *
   * @returns {object|null} a refusal, or null if there is still a commission
   */
  noLongerInCommand() {
    if (!this.over) return null;
    return { ok: false, error: 'Your command has ended, Captain.', reason: 'Your command has ended, Captain.' };
  }

  /**
   * Spend a span of the commission on something the captain ordered.
   *
   * The one door for "this took a while". It moves the commission clock and
   * the calendar together, and it does the work of those hours — damage
   * control, the machine shop, the details that are out — through the same
   * `passTime` an absence and the tick loop use, so an afternoon on the
   * surface is an afternoon aboard as well.
   *
   * Distinct from the tick loop, which spends hours as they pass. This spends
   * them because an ORDER cost them: the ship is somewhere else afterwards in
   * time rather than in space.
   *
   * With this door open, `advanceStardate` has exactly three callers left, and
   * between them they are the whole of why a date moves: time going by while
   * the captain sits there, an order that cost some, and an absence. It used to
   * have fifteen, each with its own number in days, none of which touched the
   * commission clock — which is how the bridge came to show a stardate that had
   * wandered a year and a half from a commission still on day one.
   *
   * @param {number} hours commission hours the order cost
   * @param {object} opts `announce: false` for a caller that reports what came
   *   back itself, so the shop's job is not written into the log twice.
   * @returns {{hours: number, finished: object|null, returned: object[]}}
   */
  spendHours(hours, { announce = true } = {}) {
    if (!(hours > 0)) return { hours: 0, finished: null, returned: [] };
    this.campaign?.spend(hours);
    this.clock.advanceStardate(hours / 24);
    const { finished, returned } = this.passTime(hours);
    if (announce) {
      if (finished) {
        this.pushLog(`${finished.recipe.name} is finished, Captain. ${finished.text}`, 'engineering');
      }
      for (const back of returned) {
        this.pushLog(`${back.assignment.name} is back aboard. ${back.text}`, 'comms');
      }
    }
    return { hours, finished, returned };
  }

  /**
   * Fly the course, if one is laid in, for a span of the commission.
   *
   * Deliberately not part of `passTime`, and deliberately fed a different
   * number. `passTime` spends WORK — hours of damage control and of the machine
   * shop, capped at `MAX_ABSENCE_HOURS` per absence, because a ship nobody is
   * commanding does not repair itself at full rate for a month. A voyage is not
   * work. It is the calendar: the ship is at warp whether anyone is watching or
   * not, and she does not stop three days out because the app was closed for a
   * fortnight. Flying her on capped hours put her 72 hours into a 291-hour run
   * no matter how long the captain was away.
   *
   * @param {number} hours commission hours elapsed, uncapped
   */
  flyOn(hours) {
    if (!(hours > 0) || !this.transit) return false;
    if (this.transit.update(hours) !== 'arrived') return false;
    this.arrive();
    return true;
  }

  /**
   * What a span of hours does to a ship, whoever was watching.
   *
   * All of this lived inside `syncCampaign` and was reachable from nowhere
   * else, so every one of these things happened exclusively while the app was
   * closed. Damage control did nothing for a captain sitting in the chair; the
   * machine shop only ever finished a job during an absence. The way to repair
   * a ship was to stop playing it, and after the tick loop stopped crediting
   * play time as absence that became the only way.
   *
   * Both callers now spend the same hours through the same door: `syncCampaign`
   * with the hours nobody watched, the tick loop with the hours they did.
   *
   * @param {number} hours commission hours to spend
   * @param {object} opts `livedThrough` when the tick loop has already stepped
   *   the ship and the crew through these hours — fires, shields and injuries
   *   are handled there, second by second, and doing them again here would
   *   heal an injured officer twice for the same hour.
   */
  passTime(hours, { livedThrough = false } = {}) {
    const none = { finished: null, returned: [] };
    if (!(hours > 0)) return none;

    // Time passes during a firefight; damage control does not get to rebuild
    // your shields in the middle of one. Without this guard, backgrounding the
    // app for three days mid-engagement returned hull 20% -> 43%, shields
    // 0% -> 100% and fires 3 -> 0 while a Klingon was still shooting.
    if (this.engagement && !this.engagement.over) return none;

    const ship = this.ship;

    // Repair: a full hull from nothing would take about a fortnight underway,
    // which is slower than a starbase and faster than nothing. Nothing in
    // `Ship.update` repairs hull — that is deliberate and stated there — so
    // this is the only thing that does it under way, watched or not.
    if (ship.hullPct < 1 && !ship.destroyed) {
      const perHour = ship.maxHull / (14 * 24);
      ship.repair(perHour * hours * ship.mod('repairRate'));
    }

    if (!livedThrough) {
      // Fires go out. Slowly, and one at a time.
      if (ship.fires > 0) ship.fires = Math.max(0, ship.fires - Math.floor(hours / 6));

      // Shields recharge to full given a quiet watch.
      if (hours > 2 && ship.shieldsUp) {
        for (const f of Object.keys(ship.shields)) ship.shields[f] = ship.maxShield;
      }

      // The crew heals, and the dead stay dead.
      for (const officer of this.crew.officers) {
        if (officer.alive && officer.injured) officer.recover?.(hours);
      }
    }

    // The machine shop works too. A two-day job is a two-day job whether you
    // are watching it or not — which is what makes committing to one a
    // decision rather than a button.
    const finished = advanceFabrication(this, hours);

    // And the details that were out. Same clock, same reason: a survey party
    // sent out on Tuesday is back on Thursday whether anybody was watching.
    const returned = advanceAssignments(this, hours, this.rng);

    return { finished, returned };
  }

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
    const { hours, elapsed, forfeited, wentBackwards } = this.campaign.sync();
    // The ship flies on the calendar, not on the work allowance. Done before
    // the early return below, because a voyage completing is the whole reason
    // an absence with nothing to repair is still worth something.
    //
    // What it did is carried into the report. The crossing is the main thing
    // that happens across an absence now, and it was the one thing the report
    // did not mention: come back to a ship that crossed sixteen light years
    // and the watch officer talked about hull plating.
    const arrived = this.flyOn(elapsed);
    const voyage = arrived
      ? { arrivedAt: this.location?.name ?? this.locationId }
      : this.transit
        ? {
          to: this.transit.to?.name ?? this.transit.to?.id,
          progress: this.transit.progress,
          hoursLeft: this.transit.remainingHours,
        }
        : null;
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

    const ship = this.ship;
    const before = { hull: ship.hullPct, fires: ship.fires };
    // Who was in sickbay when the captain left, so the ones who are not any
    // more can be named on their way back.
    const wereHurt = this.crew.officers.filter((o) => o.alive && o.injured);

    const { finished, returned } = this.passTime(pending);
    if (finished) {
      this.pushLog(`${finished.recipe.name} completed while you were away. ${finished.text}`, 'engineering');
    }
    for (const back of returned) {
      this.pushLog(`${back.assignment.name} finished while you were away. ${back.text}`, 'comms');
    }
    const fighting = !!this.engagement && !this.engagement.over;

    // One stardate unit is roughly a day.
    this.clock.advanceStardate(pending / 24);

    const lines = fighting
      ? [`${pending < 24 ? `${Math.round(pending)} hours` : `${(pending / 24).toFixed(1)} days`} have passed, and we are still under fire. Nothing has been repaired.`]
      : absenceReport(pending, {
        ship, forfeited, voyage, finished, returned,
        backOnDuty: wereHurt.filter((o) => o.alive && !o.injured).map((o) => o.name),
      });
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
      this.holdForTheCaptain(...lines);
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
  // ------------------------------------------------------- powers and devices

  /**
   * Fire a bridge officer ability.
   *
   * `who` is an officer, a station name, or nothing at all — in which case the
   * ability finds the officer who has it. `what` is an ability id or record.
   *
   * All of this used to live in the screen, which meant the entire STO-style
   * power tray existed only when a browser was attached: no test could fire
   * one, the soak never saw a buffed ship, and a fuzzer line reading
   * `g.character?.useSignature?.(g)` had been optional-chaining into nothing
   * for as long as it had been written.
   */
  useAbility(who, what) {
    const abilityId = typeof what === 'string' ? what : what?.id;
    let officer = null;
    if (typeof who === 'object' && typeof who?.ready === 'function') officer = who;
    // No station named: whoever holds the ability answers, which is what
    // "fire at will" means when it is typed rather than tapped. A station that
    // IS named and is not manned is refused — falling through to whoever else
    // could do it would mean an order to a dead officer being carried out by
    // somebody the captain did not address.
    else if (who == null) officer = abilityId ? this.crew.officerFor(abilityId) : null;
    else officer = this.crew.at(who) ?? null;
    if (!officer) return { ok: false, reason: 'nobody at that station, Captain.' };
    return applyAbility(this, officer, what ?? abilityId);
  }

  /** Every ability that could be fired right now, with its officer. */
  readyAbilities() {
    return this.crew.readyAbilities();
  }

  /**
   * Teach an officer something new. A day of ship's time.
   *
   * `officer.learn` records it. The day, the log line, the recomputed ship
   * modifiers and every refusal were in the officer detail modal in
   * `src/ui/screens.js` — so training was one more thing that only existed
   * when a screen was attached, and it was the only route to the six
   * abilities nobody held at commission.
   */
  trainOfficer(who, abilityId) {
    const done = this.noLongerInCommand();
    if (done) return { ok: false, reason: done.reason };
    const officer = (typeof who === 'object' && typeof who?.learn === 'function')
      ? who
      : this.crew.at(who);
    if (!officer) return { ok: false, reason: 'Nobody at that station, Captain.' };
    if (!officer.alive) return { ok: false, reason: `${officer.name} is gone, Captain.` };
    if (officer.injured) return { ok: false, reason: `${officer.name} is in sickbay, Captain.` };

    const ability = ABILITIES[abilityId];
    if (!ability) return { ok: false, reason: 'No such training, Captain.' };
    if (ability.dept !== officer.dept) {
      return { ok: false, reason: `That is not ${officer.name}'s department, Captain.` };
    }
    if (officer.abilities.includes(abilityId)) {
      return { ok: false, reason: `${officer.name} already knows that one, Captain.` };
    }
    // Gated on the CAPTAIN's rank, not the officer's: what a crew is allowed to
    // train for is a function of the ship's standing orders.
    if (ability.rank > this.progress.rank.tier) {
      return { ok: false, reason: 'We are not cleared for that yet, Captain.' };
    }

    if (!officer.learn(abilityId)) return { ok: false, reason: 'Training did not take, Captain.' };
    this.spendHours(24);
    this.applyAllMods();
    this.pushLog(`${officer.name} completed training in ${ability.name}.`, 'captain');
    return { ok: true, officer, ability };
  }

  /** What each officer could still be taught, given the captain's rank. */
  trainableFor(who) {
    const officer = (typeof who === 'object' && typeof who?.learn === 'function')
      ? who
      : this.crew.at(who);
    if (!officer?.alive) return [];
    return ABILITY_LIST.filter((a) => a.dept === officer.dept
      && !officer.abilities.includes(a.id)
      && a.rank <= this.progress.rank.tier);
  }

  /** The career signature: one large effect, once per engagement. */
  useSignature() {
    return applySignature(this);
  }

  /** Spend one device out of the loadout. */
  useDevice(id) {
    return applyDevice(this, id);
  }

  fabricate(recipeId) {
    const done = this.noLongerInCommand();
    if (done) return done;
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
    const done = this.noLongerInCommand();
    if (done) return done;
    if (this.engagement && !this.engagement.over) {
      return { ok: false, error: 'Not while we are under fire, Captain.' };
    }
    // The details out are not the machine shop, and they do not wait on it.
    // Spending hours is spending hours: this used to sit below the guard
    // beneath it, so a survey party sent out on a ship with nothing on the
    // bench never came back at all.
    //
    // Through `spendHours` rather than by calling `advanceFabrication` and
    // `advanceAssignments` here, which is what it used to do. Those were the
    // right two functions and they were not the whole span: an hour at the
    // bench was the one hour in the game that repaired no hull and healed
    // nobody, because it never went through the door every other hour does.
    // `announce: false` because this reports what came back to its caller.
    const bench = !!this.fabrication;
    const { finished, returned } = this.spendHours(hours, { announce: false });
    if (!bench) {
      if (returned.length) return { ok: true, done: null, back: returned, remaining: 0 };
      return { ok: false, reason: 'Nothing on the bench, Captain.' };
    }
    return { ok: true, done: finished, back: returned, remaining: this.fabrication?.hoursRemaining ?? 0 };
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
    // Older records predate the upkeep stream; a fresh one from the seed is
    // right for them, because nothing in the world was ever drawn from it.
    g.upkeepRng = data.upkeepRng ? RNG.load(data.upkeepRng) : new RNG(hashSeed(`upkeep:${g.seed}`));
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
    // Older records carry no counter; starting past any id they could hold
    // keeps a stale `pending` from being answered by a fight ordered later.
    g.missionFightSeq = data.missionFightSeq ?? 0;
    // And the fight the episode is waiting on, ordered again.
    //
    // `pendingCombat` is not in the save — the ships are built from the stage's
    // own data, so there is nothing to serialise that the episode does not
    // already carry. What WAS missing is this: the mark saying a reward is held
    // came back and the ships did not, so the episode waited for a battle that
    // was never coming, forever, on every record saved in the one tick between
    // the order and its arrival.
    //
    // Re-ordered with the id the record already holds, so the engagement still
    // answers for the episode waiting on it. A record written before the spec
    // was carried has no `combat` and is left alone: there is nothing to
    // rebuild it from, and inventing a battle is worse than not having one.
    const waiting = g.missions.active?.pending;
    if (waiting?.combat) g.orderTheStagesFight(waiting.combat, waiting.fightId ?? null);
    g.locationId = data.locationId ?? 'sol';
    g.clock = new Clock(data.stardate ?? 4523.3);
    g.latinum = data.latinum ?? 500;
    g.log = data.log ?? [];
    g.over = data.over ?? false;
    // Both default for a save written before they were carried. A record from
    // then reads as "ended, reason unknown", which is what it actually is.
    g.overReason = data.overReason ?? null;
    g.commissionCompleted = data.commissionCompleted ?? false;
    // The condition the captain left the ship in — unless the record caught a
    // fight, in which case that fight is over by the time anyone reads this
    // and battle stations with nobody to fight is worse than losing the order.
    // The helm stands down with it, for the same reason.
    g.alert = data.interruptedCombat ? 'normal' : (data.alert ?? 'normal');
    if (data.interruptedCombat) g.ship.evasive = false;

    // A record written mid-battle wakes up with the battle accounted for. The
    // fight is not resumed — see the mode comment below — but the captain is
    // told the action was broken off rather than finding the enemy simply
    // gone, and the panel that reads `lastCombat` has something to show.
    if (data.ledgerStardate != null) g.ledger.stardate = data.ledgerStardate;
    g.lastCombat = data.interruptedCombat ?? data.lastCombat ?? null;
    if (data.interruptedCombat) {
      g.log = [...g.log, {
        text: 'Action broken off. The engagement was not carried to a decision.',
        source: 'captain',
        stardate: data.interruptedCombat.stardate,
      }];
    }

    // Back on the course you were flying.
    //
    // The transit was not saved at all and the mode was forced to the bridge,
    // so closing the app at warp put the ship back in the system it had left
    // with the antimatter for the trip already spent and no days elapsed. The
    // fuel was charged and the voyage was not.
    //
    // The mode still defaults to the bridge, which is the right place to wake
    // up for every other state — a fight, an encounter and a mission stage are
    // all things the game re-derives or that should not resume mid-air. A
    // voyage is the exception, because it is the one that is BETWEEN places.
    g.mode = MODES.BRIDGE;
    g.transit = Transit.load(data.transit, g.galaxy);
    if (g.transit) g.mode = MODES.TRANSIT;

    // A save from before the commission clock existed starts its five years
    // now rather than pretending the time already passed. Nobody should lose a
    // campaign they had not begun.
    g.campaign = CampaignClock.load(data.campaign, opts.now ?? undefined);
    g.livedHours = Math.max(0, Number(data.livedHours) || 0);
    g.awayDone = new Set(Array.isArray(data.awayDone) ? data.awayDone : []);
    if (opts.compression) g.campaign.compression = opts.compression;

    g.stores = { ...STARTING_STORES, ...(data.stores ?? {}) };
    g.fabrication = data.fabrication ?? null;
    // The roster is rebuilt from the seed by the constructor, so a save that
    // predates it still has one. What loads here is what happened TO them:
    // who is out, who is in sickbay, and who did not come back.
    if (Array.isArray(data.dutyRoster) && data.dutyRoster.length) {
      g.dutyRoster = data.dutyRoster.map((p) => new DutyOfficer(p));
    }
    g.assignments = Array.isArray(data.assignments) ? data.assignments : [];
    // What the crew had learned about this hull. A save written before mastery
    // existed loads as a crew who have learned nothing yet, which is exactly
    // what a fresh track means and needs no migration.
    g.mastery = ShipMastery.load(data.mastery, g.ship.classId);
    // Ships this career has cost. Clamped to what a running commission can
    // actually have survived: two losses is the end, so a record claiming two
    // on a game that is not over is incoherent, and the forgiving reading is
    // that the next one is the last. A genuine save taken after the second
    // loss carries `over` and keeps its count.
    const lost = Number.isFinite(data.shipsLost) && data.shipsLost >= 0
      ? Math.floor(data.shipsLost) : 0;
    g.shipsLost = g.over ? lost : Math.min(1, lost);
    g.klingonAnswered = data.klingonAnswered === true;
    g.marauderHired = data.marauderHired === true;
    // The saved flag, but the ship's actual position wins: a record edited to
    // claim she is over the line when she is not would otherwise let her cross
    // for free on the way in.
    g.inTheZone = data.inTheZone === true && Game.insideTheZone(g.location);
    g.inTheDMZ = data.inTheDMZ === true && Game.insideTheDMZ(g.location);
    // Only an offer of a hull that exists, so a hand-edited record cannot put
    // the captain aboard something the registry has never heard of.
    g.commandOffer = data.commandOffer?.classId && getShipClass(data.commandOffer.classId)
      ? data.commandOffer : null;
    // Hulls this captain has already turned down. Filtered to classes that
    // exist, for the same reason the offer is: a record naming a ship the
    // registry has never heard of would silently narrow what is offered.
    g.declinedCommands = Array.isArray(data.declinedCommands)
      ? data.declinedCommands.filter((id) => getShipClass(id)) : [];
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
    // A record written before the cap can carry more than the cap allows. Trim
    // it on the way in rather than handing the captain the archive it was.
    g.conDropped = data.con?.dropped ?? 0;
    if (g.conLines.length > Game.MAX_CON_LINES) {
      g.conDropped += g.conLines.length - Game.MAX_CON_LINES;
      g.conLines = g.conLines.slice(-Game.MAX_CON_LINES);
    }
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
    // The engagement is not restored — a fight cannot be saved — so restoring
    // the flags that belong to it left the order line hijacked with nobody on
    // the other end. `finishCombat` closes the channel for exactly this reason
    // and its comment says so; the load path reached the same state by another
    // door and never ran it. The result was that the no-win scenario could be
    // beaten by force-quitting it and then typing one sentence on an empty
    // bridge: a scoring appeal wrote `kobayashi_maru_solved` to the permanent
    // ledger and paid the reputation, with no Klingons and no freighter.
    //
    // `firstStrike` is one of those flags and was being restored one line
    // above this comment. It is set by opening fire on an encounter that was
    // not hostile and cleared by `finishCombat` beside the engagement itself,
    // and `resolveHail` reads it to take a quarter off the chance of being
    // heard — "you shot first; they remember". Carried across a reload with no
    // fight to belong to, it made every later hail in the commission, against
    // every faction, anywhere in the galaxy, an appeal by a captain who had
    // fired on people who were never there. Nothing ever cleared it, because
    // the only thing that clears it is the end of a fight that is not running.
    g.firstStrike = false;
    g.gambitOpen = false;
    g.parleyForced = false;
    g.inKobayashi = false;

    g.applyAllMods();
    return g;
  }
}

export { SYSTEM_BY_ID };
