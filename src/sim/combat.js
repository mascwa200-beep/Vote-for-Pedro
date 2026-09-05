// Combat resolution.
//
// A tactical engagement is a fixed-step simulation in three dimensions. The
// player gives orders; helm and tactical execute them over time. Nothing
// resolves instantly, which is what makes power routing and facing decisions
// matter.
//
// Nothing here rolls a die. Accuracy, damage and evasion are continuous
// quantities built from the situation and the ship — the d20 belongs to the
// character sheet, not to whether a phaser connects.

import { emit } from '../core/events.js';
import {
  Ship, FACINGS, SUBSYSTEM_KEYS, inArc, facingForBearing, facingForDirection, FACING_LABEL,
} from './ship.js';
import { chooseAction } from './ai.js';
import { OPEN_ARENA, buildArena, blockedBy, insideSolid, conditionsAt } from './arena.js';
import { assessEngagement, classPower, forcePower } from './assess.js';
import { clamp, wrapDegrees, finite } from '../core/num.js';

export const WEAPON_RANGE = {
  beam: 900,
  cannon: 620,
  torpedo: 1200,
};

/** The longest reach any weapon in the game has. */
export const MAX_WEAPON_RANGE = Math.max(...Object.values(WEAPON_RANGE));

/** How long a fleeing ship must stay out of weapons range before it is gone. */
export const WITHDRAW_SECONDS = 8;

/**
 * How close an inbound torpedo has to be before the batteries can swat it.
 *
 * A quarter of beam range: this is a shot at something already inside the
 * screens, not a duel with the launcher.
 */
export const POINT_DEFENCE_RANGE = 220;

/**
 * Chance per second of stopping one, before the weapons array and accuracy
 * are taken into account.
 *
 * Chosen by measurement, 30 fights a cell, Constitution at Lieutenant — how
 * long the ship lasts in a fight it is losing, which is what a defensive
 * ability is for:
 *
 *      rate    vs 2 D7      vs 3 D7      vs 3 scoutships (no tubes)
 *      0.8     40s -> 48s   20s -> 24s   127s -> 131s, 0 intercepts
 *      1.6     40s -> 64s   20s -> 29s   127s -> 131s, 0 intercepts
 *      2.4     40s -> 64s   20s -> 32s   127s -> 131s, 0 intercepts
 *
 * 2.4 buys nothing over 1.6 in the two-ship fight, so 1.6 is where the returns
 * stop. The last column is the trade working in the other direction: against a
 * hostile with no torpedo tubes there is nothing to intercept, the 20% damage
 * penalty is all the order does, and the fight takes four seconds longer.
 */
export const POINT_DEFENCE_PER_SECOND = 1.6;

/**
 * How far from the centre of the engagement anything may get.
 *
 * There was no such bound, and fuzzing found what that costs: a Jem'Hadar
 * attack ship at 13% hull ran to 64,574 units — twenty-one times the tactical
 * volume, fifty-four times the longest weapon range — and simply kept going. It
 * was never flagged as fleeing, so no end condition fired; it could not be
 * reached and could not reach us; the engagement would have run forever.
 *
 * That is merely tedious when you can disengage. It is a permanent soft-lock
 * when you cannot, and two things take that away: the Tholian web, which is
 * reachable in ordinary play, and the Kobayashi Maru, by design.
 */
export const ARENA_RADIUS = 2600;

/** Every way a fight can finish. `end` accepts nothing else. */
// `interrupted` is not something the simulation decides — it is what happens
// when the game is SAVED with a fight still running. The autosave fires when
// the app is backgrounded, which on a phone is a call arriving, and a fight
// cannot be resumed from a save: Game.load says so out loud and means it.
//
// It is an ending rather than a special case because the alternative is what
// used to happen. The engagement was simply not serialised, so the enemy
// stopped existing while the hull kept every point of damage the fight had
// cost, at normal alert, with no record that a battle had been fought at all.
/**
 * Every way a fight can end.
 *
 * `failed` is the newest and the only one that is neither a win nor a loss: the
 * ship came through it and the thing the fight was FOR did not. Losing the
 * freighter you were escorting is not a defeat by the reckoning everything
 * downstream uses — `state.js` computes `won = victory || routed` and
 * `lost = destroyed`, and a failed escort is neither — but it is emphatically
 * not a victory either, and before objectives existed there was no way to say
 * so. Every existing consumer tests a specific outcome for equality, so this
 * falls through all of them and earns exactly what it should: no credit, and
 * no loss of the ship.
 */
export const OUTCOMES = ['victory', 'routed', 'escaped', 'parley', 'destroyed', 'interrupted', 'failed'];

/**
 * What a fight is FOR.
 *
 * `Engagement.objective` has been declared, documented in the constructor's own
 * JSDoc, and read by nothing since it was written — so every battle in the game
 * was won by emptying the board and there was no way to express "cripple her,
 * do not kill her" or "the freighter has to live". The mission book has wanted
 * both for a long time and has had to settle for prose.
 *
 * Two of these are only meaningful because of work that landed first:
 * `disable` needs per-mount knockout to be a state a ship can actually be in,
 * and `protect` needs hull archetypes that differ enough that some hostiles
 * genuinely go after the escortee rather than all going for the player.
 */
export const OBJECTIVES = {
  destroy: { label: 'Destroy them', line: 'Destroy the hostiles.' },
  disable: { label: 'Disable them', line: 'Disable them. Do not destroy them.' },
  protect: { label: 'Protect the escort', line: 'Whatever else happens, they live.' },
  survive: { label: 'Survive', line: 'Hold on. Help is coming.' },
};

/** A hostile that can no longer shoot: destroyed, or every gun out. */
export function disarmed(ship) {
  if (!ship) return true;
  if (ship.destroyed || ship.withdrawn) return true;
  if ((ship.subsystems?.weapons ?? 1) <= 0.05) return true;
  const guns = ship.weapons ?? [];
  return guns.length > 0 && guns.every((w) => w.enabled === false || (w.damage ?? 0) <= 0);
}

/** Beyond this, nobody can do anything to anybody and the fight is decided. */
export const DISENGAGE_RANGE = MAX_WEAPON_RANGE * 1.6;

/**
 * A ship anyone can still act on: present, alive, and not gone to warp.
 *
 * There are two ways to leave a fight and the code only ever remembered one of
 * them. `destroyed` was checked in four places — the guns, the torpedoes
 * already in flight, the player's lock and the AI's — and `withdrawn` in none
 * of them, although the log says out loud that the ship "has broken contact
 * and gone to warp".
 *
 * What that bought, measured: an allied captain whose target withdrew kept the
 * lock forever, flew off after a ship that is no longer being simulated, and
 * took no further part in the battle while a live hostile sat beside it. And a
 * ship that got away could still be shot — 2600 hull down to 2588 on the first
 * volley — so the escape it had just earned was not one.
 *
 * One predicate, used everywhere, so there is a single answer to whether a
 * ship is still in the fight.
 */
export function stillEngaged(ship) {
  return !!ship && !ship.destroyed && !ship.withdrawn;
}

/** Damage falls off with range; cannons fall off hardest. */
export function rangeFactor(type, distance) {
  const max = WEAPON_RANGE[type] ?? 900;
  if (distance > max) return 0;
  const t = distance / max;
  if (type === 'cannon') return Math.max(0.15, 1 - t * t * 1.15);
  if (type === 'torpedo') return 1;               // torpedoes track; no falloff
  return Math.max(0.3, 1 - t * 0.7);              // beams
}

export class Engagement {
  /**
   * @param {Ship} player
   * @param {Ship[]} hostiles
   * @param {RNG} rng
   * @param {object} opts { allies, objective, name, onEnd }
   */
  constructor(player, hostiles, rng, opts = {}) {
    this.player = player;
    this.hostiles = hostiles;
    this.allies = opts.allies ?? [];
    this.rng = rng;
    this.name = opts.name ?? 'Engagement';
    this.objective = OBJECTIVES[opts.objective] ? opts.objective : 'destroy';
    // How long `survive` has to be survived for. Zero on every other
    // objective, which is what keeps the check in `settle` inert for them.
    this.objectiveTime = Math.max(0, Number(opts.objectiveTime) || 0);
    this.time = 0;
    this.over = false;
    this.outcome = null;
    // Set by whoever owns this fight, and called the instant it ends. See end().
    this.onEnd = opts.onEnd ?? null;
    this.stepping = false;
    this.settleWhenSafe = false;
    this.projectiles = [];
    this.effects = [];
    this.log = [];
    this.target = hostiles[0] ?? null;
    this.targetedSubsystem = null;
    this.autoFire = true;
    this.warpOutTimer = 0;
    // Consumed by the Tactical career's Called Shot.
    this.guaranteedCrits = 0;
    // Seconds every live hostile has spent out of everyone's reach.
    this.separationTimer = 0;
    // Seconds of ion-pod decoy still confusing hostile targeting.
    this.decoyTimer = 0;
    /**
     * The terrain this fight is fought in. See src/sim/arena.js.
     *
     * Never null. An open-space fight gets OPEN_ARENA, which is frozen and
     * empty, so every call site below can ask it questions unconditionally.
     * Filled in by `placeCombatants` below, which is the only place that knows
     * where everyone starts — and a rock dropped on top of a starting position
     * is a hostile that cannot be shot from anywhere, because every line to it
     * crosses the rock it is standing in.
     */
    this.arena = opts.arena ?? OPEN_ARENA;
    /**
     * The stream the terrain is rolled from, and why it is not `rng`.
     *
     * Building an arena takes random draws. Taking them from the fight's own
     * stream would have moved every seeded outcome in the game on the day
     * terrain was added — the same battle would play out differently depending
     * on whether the place it happened in had weather. `Game.startCombat`
     * derives a separate stream keyed by the system.
     */
    this.arenaRng = opts.arenaRng ?? null;
    this.hazard = opts.hazard ?? null;
    // Nobody in this fight breaks off. Set only by the Kobayashi Maru, where a
    // hostile that could be routed would make the no-win scenario winnable by
    // flying — which is the one thing it must never be.
    this.relentless = opts.relentless === true;
    /** How much sooner hostiles break off. See `ai.js` and Notorious. */
    this.fear = Number.isFinite(opts.fear) ? opts.fear : 0;
    // How many people were aboard when this started.
    //
    // Crew losses are permanent, so the standing deficit is the whole
    // campaign's dead and not this battle's. Without a mark at the start,
    // every fight reported every death that had ever happened.
    this.crewAtStart = player?.crew ?? 0;
    this.shotsFired = 0;
    // Whether the tactical officer has already remarked on a torpedo being
    // swatted down. Explicitly false rather than undefined, like `over`.
    this.saidPointDefence = false;
    // Same, for a shot that broke against a rock and for the gas closing in.
    this.saidBlocked = false;
    this.saidMurk = false;
    // Ships whose destruction has already been announced. A death is a
    // one-time event and the sweep that finds it runs every tick.
    this.mourned = new Set();
    // Gun mounts whose loss has already been announced, the same way. A bank
    // sits below the threshold for as long as it takes to repair, and the
    // sweep that notices runs every tick.
    this.saidMount = new Set();

    this.placeCombatants();
    // Metreon gas will not let a warp field form. Read AFTER the arena is
    // built, which placeCombatants does.
    this.canWarpOut = opts.canWarpOut !== false && !this.arena.noWarp;

    // What tactical makes of it, before a shot is fired.
    //
    // Played through the encounter generator, a hostile encounter either did
    // nothing at all or took the ship: ten Cardassian patrols out of ten, five
    // Borg out of five, against Ferengi and Orion patrols that never took the
    // hull below 90%. The game already intends the bad ones to be broken off
    // rather than won — `beginWarpOut` exists and the difficulty ladder's main
    // lever is enemy COUNT — and it had no way of saying which those were.
    this.assessment = assessEngagement({
      player: this.player, allies: this.allies, hostiles: this.hostiles,
    });
    if (this.assessment) {
      this.pushLog(this.assessment.line, 'tactical');
    }
  }

  /**
   * Weigh the fight as it stands now.
   *
   * Separate from `this.assessment`, which is the OPENING reading and is what
   * tactical said before a shot was fired. This one is live: a fight that was
   * outmatched three ships ago is not outmatched now, and a captain watching a
   * bar wants the second number, not the first.
   */
  assess() {
    return assessEngagement({
      player: this.player, allies: this.allies, hostiles: this.liveHostiles,
    });
  }

  /**
   * Everything still physically present.
   *
   * A ship that has broken off and gone to warp is NOT. It used to be: it kept
   * being stepped, kept being clamped back inside the arena by holdTheArena,
   * and so a hostile the log had just announced as gone came about at the
   * boundary and flew back through the middle of the fight — still drawn, still
   * solid, and no longer targetable, because `liveHostiles` had written it off.
   */
  get allShips() {
    return [this.player, ...this.allies, ...this.hostiles.filter((s) => !s.withdrawn)];
  }

  /**
   * Hostiles still in the fight.
   *
   * A ship that has broken off and got clear is neither destroyed nor present.
   * Before withdrawal existed a fleeing ship stayed on the board forever: at 3%
   * hull, cloaked, faster than you, and permanently blocking every end
   * condition that asks whether any hostile is left. Fuzzing caught a
   * Bird-of-Prey doing exactly that — a stern chase at matched speed, frozen at
   * 1,639 units for the sixteen simulated minutes before the harness gave up.
   */
  get liveHostiles() {
    return this.hostiles.filter((s) => !s.destroyed && !s.withdrawn);
  }

  /**
   * Hostiles arrive spread across a shell rather than a fan.
   *
   * The elevations are deliberately modest — a few degrees, not a sphere's
   * worth. A patrol that opens from directly overhead is disorienting rather
   * than tactical, and the point of the third axis is that climbing is a
   * decision made during the fight, not the state it starts in.
   */
  placeCombatants() {
    this.player.x = 0; this.player.y = 0; this.player.z = 0;
    this.player.heading = 0; this.player.desiredHeading = 0;
    this.player.pitch = 0; this.player.desiredPitch = 0;

    this.hostiles.forEach((s, i) => {
      const angle = (-50 + i * 40) * Math.PI / 180;
      const dist = 700 + i * 90;
      // Alternate above and below, widening with each additional hull.
      const elevation = (i % 2 === 0 ? 1 : -1) * Math.min(18, 6 + i * 4) * Math.PI / 180;
      s.x = Math.cos(angle) * Math.cos(elevation) * dist;
      s.y = Math.sin(angle) * Math.cos(elevation) * dist;
      s.z = Math.sin(elevation) * dist;
      s.heading = (angle * 180 / Math.PI) + 180;
      s.desiredHeading = s.heading;
      s.pitch = 0;
      s.desiredPitch = 0;
      s.throttle = 0.5;
    });

    this.allies.forEach((s, i) => {
      s.x = -320 - i * 120;
      s.y = (i % 2 === 0 ? 1 : -1) * (140 + i * 60);
      s.z = (i % 2 === 0 ? -1 : 1) * (40 + i * 20);
      s.heading = 0; s.desiredHeading = 0;
      s.pitch = 0; s.desiredPitch = 0;
      s.throttle = 0.4;
    });

    // And the terrain, now that there are positions to keep clear of.
    //
    // Rebuilt rather than kept when reinforcements arrive, because
    // `placeCombatants` runs again for those and the new arrivals need the
    // same guarantee the first wave got. The stream is derived and rewound to
    // the same seed each time, so the rocks do not move — see `arenaRng`.
    if (this.arenaRng && this.hazard) {
      this.arena = buildArena(this.arenaRng(), this.hazard, {
        radius: ARENA_RADIUS,
        clear: this.allShips.map((s) => ({ x: s.x, y: s.y, z: s.z ?? 0 })),
      });
    }
  }

  // ---------------- orders ----------------

  setTarget(ship) {
    // `validTarget` rather than a bare destroyed check: a hostile that has
    // broken off and gone to warp is not destroyed either, and locking onto one
    // pointed the guns and the camera at a ship that is no longer there.
    if (this.validTarget(ship)) {
      this.target = ship;
      this.pushLog(`Target locked: ${ship.name}.`, 'tactical');
      emit('combat:target', ship);
    }
  }

  cycleTarget() {
    const live = this.liveHostiles;
    if (!live.length) return;
    const idx = live.indexOf(this.target);
    this.setTarget(live[(idx + 1) % live.length]);
  }

  /**
   * Aim for one system rather than the hull.
   *
   * Only a system that exists. "Target their bridge" is a thing a captain says
   * and no ship in this game has a `bridge` subsystem, so the order set
   * `targetedSubsystem = 'bridge'`, every shot asked to damage a key that was
   * not in the table, `damageSubsystem` returned early — and the result was an
   * order that removed ALL subsystem damage from the fight while reporting
   * that it had been given.
   */
  targetSubsystem(key) {
    if (key && !SUBSYSTEM_KEYS.includes(key)) {
      this.pushLog(`We have no firing solution on their ${key}, Captain.`, 'tactical');
      return false;
    }
    this.targetedSubsystem = key ?? null;
    this.pushLog(key ? `Targeting ${key}.` : 'Targeting hull.', 'tactical');
    return true;
  }

  // Every one of these goes through a NaN-safe guard rather than a bare
  // Math.min/Math.max pair. `Math.max(0, Math.min(1, NaN))` is NaN, and a NaN
  // heading turns the ship's position into NaN on the next update and never
  // gives it back.
  setThrottle(v) { this.player.throttle = clamp(v, 0, 1); }
  setHeading(deg) { this.player.desiredHeading = wrapDegrees(deg); }

  setPitch(deg) { this.player.desiredPitch = clamp(deg, -70, 70); }

  /** Steer to bring the target into the forward arc, in both axes. */
  comeAboutTo(ship) {
    if (!ship) return;
    const abs = Math.atan2(ship.y - this.player.y, ship.x - this.player.x) * 180 / Math.PI;
    this.setHeading(abs);
    this.setPitch(this.player.elevationTo(ship));
  }

  evasive(on) {
    this.player.evasive = on;
    this.pushLog(on ? 'Evasive manoeuvres.' : 'Resuming standard flight.', 'helm');
  }

  /**
   * A hot, ship-shaped object in the water. For `seconds`, everything shooting
   * at us has to decide which return is the real one, and gets it wrong often
   * enough to matter.
   */
  deployDecoy(seconds) {
    this.decoyTimer = Math.max(this.decoyTimer, clamp(seconds, 0, 600));
    this.effects.push({ kind: 'explosion', x: this.player.x, y: this.player.y, z: this.player.z ?? 0, life: 0.8 });
    this.pushLog('Decoy away — their targeting solutions just got harder.', 'tactical');
  }

  /** Attempt to break off. Takes time, and the enemy gets those seconds. */
  beginWarpOut() {
    if (!this.canWarpOut) {
      // Say WHY. "We are pinned" is the Kobayashi Maru's answer and it is the
      // wrong one in the Briar Patch, where the reason is a property of the
      // place the captain chose to fly into and could choose to leave.
      this.pushLog(this.arena.noWarp
        ? `No warp field will form in ${this.arena.name}, Captain. We fight or we crawl.`
        : 'Cannot disengage — we are pinned.', 'helm');
      return false;
    }
    if (this.player.subsystems.warpcore < 0.2 || this.player.coreEjected) {
      this.pushLog('Warp drive is offline. We cannot outrun them.', 'engineering');
      return false;
    }
    if (this.warpOutTimer > 0) return false;
    this.warpOutTimer = 8;
    this.pushLog('Helm plotting an escape course. Eight seconds to warp.', 'helm');
    emit('combat:warpout-begin');
    return true;
  }

  // ---------------- firing ----------------

  /** Fire everything that bears on the current target. */
  /**
   * Open fire.
   *
   * @param {string} type 'all', or one of the weapon types — 'beam',
   *        'cannon', 'torpedo'. The parser has always read this off the order
   *        ("fire phasers" gives 'beam') and it was thrown away here, so every
   *        order to fire fired everything: asking for phasers launched photon
   *        torpedoes, and a captain holding torpedoes for one shot could not.
   */
  fireAll(type = 'all') {
    if (!this.validTarget(this.target)) return 0;
    const wanted = this.player.weapons.filter(
      (w) => type === 'all' || type === undefined || w.type === type,
    );
    if (!wanted.length) {
      this.pushLog(`We have no ${type} weapons, Captain.`, 'tactical');
      return 0;
    }
    let fired = 0;
    for (const w of wanted) {
      if (this.fireWeapon(this.player, w, this.target)) fired++;
    }
    if (!fired) this.pushLog('No weapons bear on the target.', 'tactical');
    return fired;
  }

  fireWeapon(attacker, weapon, target) {
    if (!stillEngaged(target) || attacker.destroyed) return false;
    if (weapon.cooldown > 0 || !weapon.enabled) return false;
    if (attacker.cloaked) return false;
    if (weapon.type === 'torpedo' && attacker.torpedoes <= 0) return false;
    if (attacker.subsystems.weapons <= 0.05) return false;

    // A cone in the attacker's own frame, so an arc restricts elevation as
    // well as bearing: a forward bank does not bear on something directly above
    // the saucer merely because it is ahead in plan view.
    if (!inArc(attacker.directionTo(target), weapon)) return false;

    const distance = attacker.distanceTo(target);
    if (distance > (WEAPON_RANGE[weapon.type] ?? 900)) return false;

    // Nobody fires through rock.
    //
    // The first version let the shot go, spent the cooldown, and drew the
    // beam terminating on the rock — legible, and wrong: a gunner with no
    // firing solution does not pull the trigger, and a cooldown burned on a
    // shot that cannot arrive is a punishment for the enemy's position rather
    // than a reward for your own. Holding fire is what makes cover COVER:
    // getting a rock between you and them stops the incoming fire instead of
    // making it miss.
    //
    // Checked here, before the cooldown, so it applies to every shooter in
    // the fight — the player's auto-fire, the hostiles, and the allies.
    if (blockedBy(this.arena, attacker, target)) {
      if (attacker === this.player && !this.saidBlocked) {
        this.saidBlocked = true;
        this.pushLog('No firing solution — there is rock between us and them.', 'tactical');
      }
      return false;
    }

    weapon.cooldown = weapon.cycle;
    // Whether a shot was ever fired in this engagement, which the after-action
    // report needs and could not otherwise know. "Nobody fired" is a real thing
    // to be able to say about a battle that ended in a negotiation, and there
    // was no way to tell it apart from one that ended after two minutes of
    // shooting.
    this.shotsFired++;

    if (weapon.type === 'torpedo') {
      attacker.torpedoes = Math.max(0, attacker.torpedoes - 1);
      this.projectiles.push({
        kind: 'torpedo', attacker, target, weapon,
        x: attacker.x, y: attacker.y, z: attacker.z ?? 0,
        speed: 420, life: 6,
        subsystem: attacker === this.player ? this.targetedSubsystem : (attacker.calledShot ?? null),
      });
      emit('combat:fire', { attacker, weapon, type: 'torpedo' });
      return true;
    }

    // Beams and cannons resolve immediately, with a visible trace.
    //
    // A called shot, from either side.
    //
    // This read `null` for everybody who was not the player, so the order the
    // player has had since the order line existed — worth about three times the
    // subsystem damage of untargeted fire — was one no enemy captain had ever
    // given. `ai.js` decides what each doctrine goes for and sets it.
    const result = this.resolveHit(attacker, target, weapon, distance,
      attacker === this.player ? this.targetedSubsystem : (attacker.calledShot ?? null));
    this.effects.push({
      kind: weapon.type,
      from: { x: attacker.x, y: attacker.y, z: attacker.z ?? 0 },
      to: { x: target.x, y: target.y, z: target.z ?? 0 },
      life: 0.35, hit: result.hit, faction: attacker.faction,
    });
    emit('combat:fire', { attacker, weapon, type: weapon.type, result });
    return true;
  }

  /** Roll accuracy, apply damage, emit the consequences. */
  resolveHit(attacker, target, weapon, distance, subsystem = null) {
    const falloff = rangeFactor(weapon.type, distance);
    if (falloff <= 0) return { hit: false, reason: 'out of range' };

    // Gas at either end of the shot. Standing in it blinds you; standing in
    // it also hides you, and the worse of the two is what the gunner has to
    // work with. "The nebula will scramble our shields and sensors" — this is
    // the sensors half.
    const murk = Math.max(
      conditionsAt(this.arena, attacker).sensorNoise,
      conditionsAt(this.arena, target).sensorNoise,
    );
    const accuracy = 0.92 * attacker.mod('accuracy')
      * (0.7 + 0.3 * attacker.subsystems.sensors) * (1 - murk);
    // A decoy in the water only troubles the people shooting at us.
    const decoy = (target === this.player && this.decoyTimer > 0) ? 0.22 : 0;
    // A cloak is worth less against somebody who is looking for it.
    //
    // `stealthDetect` was written by five things and read by none. The ship
    // carried it in `mods`, the baseline set it to 1, a science skill node
    // called "Cloak detection and scan quality" added 0.15 a rank, a tier-two
    // console called "See cloaked ships sooner" added 0.4 for two slot value,
    // the captain's Science ability added 6% a point, and a watch officer's
    // expertise added up to 10%. Nothing anywhere called
    // `mod('stealthDetect')`.
    //
    // Measured over forty sixty-second runs against a Bird of Prey held
    // cloaked throughout: a captain at 1.150 and one at 2.080 — four skill
    // points and the console — both landed a mean of **1714** damage. Exactly
    // 1714. Two of the five contributors are things the player pays for.
    //
    // Floored at 1 so nothing can ever make a cloak worth MORE than the flat
    // half it has always been: this is a discount on the enemy's advantage,
    // not a new axis.
    const cloakEvade = target.cloaked
      ? 0.5 / Math.max(1, attacker.mod('stealthDetect'))
      : 0;
    const evade = target.defenseRating + cloakEvade + decoy;
    if (!this.rng.chance(Math.max(0.08, accuracy - evade))) {
      return { hit: false, reason: 'miss' };
    }

    const typeMod = weapon.type === 'torpedo' ? attacker.mod('torpedoDamage')
      : weapon.type === 'cannon' ? attacker.mod('cannonDamage')
      : attacker.mod('beamDamage');

    let damage = weapon.damage * falloff * typeMod * attacker.mod('damage')
      * attacker.power.factor('weapons') * attacker.subsystems.weapons
      * this.rng.range(0.9, 1.1);

    // A Called Shot spends itself on the next hit that lands, guaranteeing
    // the critical rather than merely improving the odds.
    let crit = this.rng.chance(attacker.mod('critChance'));
    if (attacker === this.player && this.guaranteedCrits > 0) {
      crit = true;
      this.guaranteedCrits--;
      this.pushLog('Called shot — direct hit.', 'tactical');
    }
    if (crit) damage *= 1 + attacker.mod('critSeverity');

    const direction = target.directionFrom(attacker);
    const dmgType = weapon.type === 'torpedo' ? 'kinetic' : 'energy';
    // Torpedoes largely ignore shields; that's their whole role.
    const piercing = weapon.type === 'torpedo' ? 0.25 : 0;

    const result = target.takeDamage(damage, {
      direction, type: dmgType, shieldPiercing: piercing, rng: this.rng, subsystem,
      // Who fired. The one place in the game where a ship is hurt BY somebody
      // rather than by a hazard, and the fact the AI's target selection has
      // always claimed to use.
      from: attacker,
    });

    // Where on the hull it landed, and how big the hull is.
    //
    // An effect outlives the tick that made it and may outlive the ship it
    // landed on, so it carries what a renderer needs rather than a reference
    // to something that might be a wreck by the time the flare fades. `from`
    // is the unit vector toward whoever fired, which is also the direction the
    // struck facing points.
    const ax = attacker.x - target.x;
    const ay = attacker.y - target.y;
    const az = (attacker.z ?? 0) - (target.z ?? 0);
    const ad = Math.hypot(ax, ay, az) || 1;
    this.effects.push({
      kind: 'impact', x: target.x, y: target.y, z: target.z ?? 0, life: 0.4,
      facing: result.facing, penetrated: result.penetrated, crit,
      from: { x: ax / ad, y: ay / ad, z: az / ad },
      classId: target.classId,
    });

    emit('combat:hit', {
      attacker, target, weapon, damage, crit, ...result,
      isPlayerTarget: target === this.player,
    });

    if (target === this.player) {
      const severity = Math.min(1, result.hullDamage / (this.player.maxHull * 0.05));
      emit('combat:player-hit', { severity, ...result });
      if (result.crewKilled > 0) {
        this.pushLog(`Casualties on ${result.facing === 'fore' ? 'decks four through six' : 'the lower decks'} — ${result.crewKilled} dead.`, 'medical');
      }
    }

    if (target.destroyed) this.onDestroyed(target, attacker);
    return { hit: true, damage, crit, ...result };
  }

  /**
   * A ship dies once, however it died.
   *
   * This used to be called from exactly one place — straight after a hit
   * landed, on `if (target.destroyed)`. The trouble is that a hit never
   * destroys anything: `takeDamage` takes the hull to zero and starts a warp
   * core breach, and the ship is not flagged destroyed until that countdown
   * runs out twenty seconds later, inside `Ship.update`. So the explosion, the
   * sound, the `combat:destroyed` event and the log line fired only in the rare
   * case of a ship being hit again while already breaching. Almost every kill
   * in this game happened in complete silence.
   *
   * `reportDeaths` now sweeps for anything that died on this tick whatever
   * killed it — the breach, a fire, a hull that finally gave, the last of the
   * crew — and the set makes saying it twice impossible.
   */
  onDestroyed(ship, killer = null) {
    if (!ship || this.mourned.has(ship)) return;
    this.mourned.add(ship);
    this.effects.push({ kind: 'explosion', x: ship.x, y: ship.y, z: ship.z ?? 0, life: 1.6 });
    emit('combat:destroyed', { ship, killer, byPlayer: killer === this.player });
    const cause = ship.destroyCause && ship.destroyCause !== 'destroyed'
      ? ` — ${ship.destroyCause}` : '';
    this.pushLog(`${ship.name} destroyed${cause}.`, 'tactical');
  }

  /** Everything that died since the last tick, reported once each. */
  /**
   * Say when a gun goes out, and when it comes back.
   *
   * The player's own mounts and the current target's only. Announcing every
   * bank on every hostile in a five-ship engagement is not information, it is
   * a wall — the same judgement `saidPointDefence` and `saidBlocked` above
   * already make about their own one-off lines.
   *
   * Keyed on the mount object in a Set, so a bank that sits below the
   * threshold for the thirty seconds it takes to repair is announced once, not
   * nine hundred times. Removed from the set when it is restored, so the pair
   * can happen again later in the same fight.
   */
  reportMounts() {
    const watched = [this.player, this.target].filter(Boolean);
    for (const s of watched) {
      const mine = s === this.player;
      for (const w of s.weapons ?? []) {
        if (w.enabled === false && !this.saidMount.has(w)) {
          this.saidMount.add(w);
          this.pushLog(mine
            ? `We have lost the ${mountName(w).toLowerCase()}.`
            // "tubes", "cannons", "banks" — the label is always plural, so
            // the verb is too. It read "Their forward tubes is out."
            : `Their ${mountName(w).toLowerCase()} are out.`, 'tactical');
        } else if (w.enabled !== false && this.saidMount.has(w)) {
          this.saidMount.delete(w);
          if (mine) this.pushLog(`The ${mountName(w).toLowerCase()} are back, Captain.`, 'engineering');
        }
      }
    }
  }

  reportDeaths() {
    this.reportMounts();
    for (const s of this.allShips) {
      if (s.destroyed) this.onDestroyed(s, null);
    }
    // A ship that withdrew is out of `allShips`, and one that dies on the way
    // out still died. Checked separately rather than by widening the sweep,
    // because widening it would put wrecks back inside the arena clamp.
    for (const s of this.hostiles) {
      if (s.withdrawn && s.destroyed) this.onDestroyed(s, null);
    }
  }

  /**
   * Something you can actually shoot: present, alive, and still in this fight.
   *
   * A target reference outlives the ship it points at. That is what made
   * auto-fire go quiet halfway through every battle — the guns kept their lock
   * on a wreck and the `!this.target.destroyed` guard turned them off for the
   * rest of the engagement, with no indication that anything had happened.
   */
  validTarget(ship) {
    return stillEngaged(ship)
      && (this.hostiles.includes(ship) || this.allies.includes(ship));
  }

  // ---------------- step ----------------

  /**
   * One tick, and then — if this tick ended the fight — the settling of it.
   *
   * `step` is the simulation; `update` is the simulation plus the one thing
   * that must happen after it and cannot happen during it. Everything that
   * follows a battle (the experience, the salvage, the standing, the casualty
   * record, losing the ship) throws this engagement away, and doing that from
   * inside `step` would pull the object out from under the rest of the tick.
   *
   * Splitting it in two is what lets `end()` be honest: a fight is settled the
   * moment it ends, wherever it ends — a hail answered with a surrender, a
   * scenario stopped by the captain talking, or a hostile blowing up in the
   * middle of `step` — and never one frame later.
   */
  update(dt) {
    if (this.over) return;
    this.stepping = true;
    try {
      this.step(dt);
    } finally {
      this.stepping = false;
    }
    // The stack is clear now, so it is safe to hand the fight back.
    if (this.settleWhenSafe) {
      this.settleWhenSafe = false;
      this.onEnd?.(this);
    }
  }

  step(dt) {
    this.time += dt;

    // `inAction`: the parties fighting a fire are whoever can be spared while
    // the ship is being fought. Off action the whole watch is on it — see
    // DAMAGE_CONTROL_OFF_ACTION in src/sim/ship.js.
    for (const s of this.allShips) s.update(dt, this.rng, { inAction: true });

    // And then the weather, to everyone in it.
    //
    // AFTER the ships have updated, so the regeneration a hull just did inside
    // a nebula is taken back off it rather than fighting the suppression for
    // priority. Before it, the two alternate and the shields flicker.
    this.weatherOn(dt);

    // Whatever died on that step gets its explosion before anything else acts.
    this.reportDeaths();

    // The guns keep looking for something to shoot at.
    //
    // Without this the lock survives the ship: auto-fire held a dead target,
    // failed its own `!destroyed` guard, and silently stopped firing for the
    // rest of the battle. Re-acquiring is what a tactical officer does without
    // being told, and it is the difference between a fight and a slideshow.
    if (!this.validTarget(this.target)) {
      const next = this.liveHostiles[0] ?? null;
      if (next) {
        this.target = next;
        emit('combat:target', next);
        this.pushLog(`Target destroyed. Re-acquiring: ${next.name}.`, 'tactical');
      } else {
        this.target = null;
      }
    }

    // Hostile and allied captains act.
    for (const s of this.liveHostiles) {
      chooseAction(s, this, dt);
    }
    for (const s of this.allies.filter((a) => !a.destroyed)) {
      chooseAction(s, this, dt, { allyOf: this.player });
    }

    // Player auto-fire keeps the guns working while you handle everything else.
    if (this.autoFire && this.target && !this.target.destroyed && !this.player.destroyed) {
      for (const w of this.player.weapons) this.fireWeapon(this.player, w, this.target);
    }

    if (this.decoyTimer > 0) this.decoyTimer = Math.max(0, this.decoyTimer - dt);

    this.holdTheArena();
    this.keepOutOfRocks();
    this.settleWithdrawals(dt);

    this.updateProjectiles(dt);
    this.updateEffects(dt);

    // Resolution. The player's own survival is decided FIRST.
    //
    // The warp-out countdown used to be checked ahead of it, so dying on the
    // very tick the eight seconds ran out ended the fight as 'escaped' — with
    // a destroyed ship. Nothing then took the ship away from you, because
    // losing the ship hangs off the 'destroyed' outcome, and the campaign
    // carried on with a wreck.
    if (this.player.destroyed) return this.end('destroyed');

    // Disengagement.
    if (this.warpOutTimer > 0) {
      // The escape has to keep being possible for the whole eight seconds. It
      // was checked once, at the order, and never again — so a core ejected
      // mid-countdown, or a Tholian web closing around you, still got you to
      // warp on a ship with no warp drive.
      if (!this.canWarpOut || this.player.coreEjected
        || this.player.subsystems.warpcore < 0.2) {
        this.warpOutTimer = 0;
        this.pushLog('We have lost the warp drive — we are not going anywhere.', 'engineering');
      } else {
        this.warpOutTimer -= dt;
        if (this.warpOutTimer <= 0) return this.end('escaped');
      }
    }
    if (this.settle()) return;

    // A fight in which nobody can touch anybody is over, whatever the AI
    // thinks it is doing. Held for a few seconds so a fast pass through the
    // outer edge does not end an engagement that is still live.
    const unreachable = this.liveHostiles.every(
      (s) => this.player.distanceTo(s) > DISENGAGE_RANGE,
    );
    this.separationTimer = unreachable ? this.separationTimer + dt : 0;
    if (this.separationTimer > 6) return this.end('routed');
  }

  /**
   * The end conditions that need no clock, checked wherever the board changes.
   *
   * The tick is not the only thing that empties a board. A boarding party
   * taking a bridge withdraws the last hostile from OUTSIDE the tick, and the
   * fight then sat with nobody left to shoot, the player alive and `over`
   * still false — which is `eng.unresolved`, the soft-lock shape, and the most
   * important rule in the invariant file. It lasted one frame, and one frame
   * is what the renderer draws.
   *
   * The warp-out countdown and the separation timer stay in `step`, because
   * both of them are clocks and this is deliberately not.
   *
   * @returns {boolean} whether the fight is over
   */
  settle() {
    if (this.over) return true;
    if (this.player.destroyed) { this.end('destroyed'); return true; }

    // What the fight was FOR, checked before what is left on the board.
    //
    // Losing the escort ends it whatever else is happening — there is no
    // recovering an objective whose whole content was that somebody survived,
    // and letting the player go on to kill every hostile and be told they won
    // would be the game reporting the opposite of what happened.
    if (this.objective === 'protect') {
      const escort = this.allies.filter((s) => s && !s.withdrawn);
      if (escort.length && escort.every((s) => s.destroyed)) {
        this.pushLog('They are gone, Captain. That was what we were here for.', 'tactical');
        this.end('failed');
        return true;
      }
    }
    // Lasting is winning. `objectiveTime` is set by whoever staged the fight.
    if (this.objective === 'survive' && this.objectiveTime > 0 && this.time >= this.objectiveTime) {
      this.end('victory');
      return true;
    }
    // Disabled is as good as destroyed, and is the point of the order. Only
    // reachable because a mount can be knocked out one bank at a time — before
    // that, "no working weapons" was a state no hostile could be put into
    // short of killing it.
    if (this.objective === 'disable' && this.liveHostiles.length
      && this.liveHostiles.every((s) => disarmed(s))) {
      this.pushLog('They are disarmed, Captain. Every gun on that hull is out.', 'tactical');
      this.end('victory');
      return true;
    }

    if (!this.liveHostiles.length) {
      // An empty board is a win only if you emptied it. Anyone who withdrew
      // under their own power was routed, not destroyed, and the ledger cares
      // about the difference.
      this.end(this.hostiles.every((s) => s.destroyed) ? 'victory' : 'routed');
      return true;
    }
    if (this.liveHostiles.every((s) => s.fleeing)) { this.end('routed'); return true; }
    return false;
  }

  /**
   * "Fire at Will" — the gunners engage ordnance as well as ships.
   *
   * The order carried `mods: { damage: 0.8 }`, a 20% penalty priced against
   * spreading fire, and `special: 'multitarget'`, which nothing anywhere
   * implemented. So the cost landed and the benefit did not: measured over 40
   * fights against two D7s, 0.28 kills without the order and 0.15 with it. It
   * is the first tactical ability a captain is given and it made him worse.
   *
   * Three ways of spreading fire were built and all three measured WORSE than
   * not giving the order — dividing the banks between ships, and releasing
   * out-of-arc banks with and without the penalty, at −51%, −51% and −22% of
   * hull dealt against three hostiles. The cause is structural: `fireWeapon`
   * puts a bank on cooldown, so a shot at a secondary target steals a future
   * shot at the primary, and a fight here is decided by killing things.
   *
   * Point defence is the reading that works, because it takes NOTHING away
   * from the ship you are trying to kill. No bank is diverted and no cooldown
   * is spent elsewhere; the batteries simply also swat at what is coming in.
   *
   * The trade is real in both directions: seven hostile classes carry no
   * torpedo tubes at all, and against those the 20% penalty is all the order
   * does.
   */
  pointDefence(p, dt) {
    if (p.kind !== 'torpedo' || p.target !== this.player) return false;
    if (!this.player.buffs?.some((b) => b.id === 'fire_at_will')) return false;
    // A point-blank shot: the batteries are swatting at something already
    // inside the screens, not sniping at launch.
    if (this.player.distanceTo(p) > POINT_DEFENCE_RANGE) return false;
    // A shot-up weapons array is worse at it, the same as every other piece of
    // gunnery in this file, and the chance is per second rather than per tick
    // so it does not depend on the timestep.
    const skill = this.player.subsystems.weapons * this.player.mod('accuracy');
    if (!this.rng.chance(POINT_DEFENCE_PER_SECOND * skill * dt)) return false;

    this.effects.push({ kind: 'explosion', x: p.x, y: p.y, z: p.z ?? 0, life: 0.4 });
    // Once per fight. The captain needs to learn the order does this; he does
    // not need a line every time a torpedo comes in.
    if (!this.saidPointDefence) {
      this.saidPointDefence = true;
      this.pushLog('Firing at will — we took that one out before it reached us.', 'tactical');
    }
    emit('combat:point-defence', { x: p.x, y: p.y, z: p.z ?? 0 });
    return true;
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      p.life -= dt;
      // A torpedo cannot follow a ship to warp any more than it can follow one
      // into a fireball. Both are "the thing I was aimed at is not there".
      if (!stillEngaged(p.target) || p.life <= 0) { p.dead = true; continue; }
      if (this.pointDefence(p, dt)) { p.dead = true; continue; }
      const dx = p.target.x - p.x;
      const dy = p.target.y - p.y;
      const dz = (p.target.z ?? 0) - (p.z ?? 0);
      const dist = Math.hypot(dx, dy, dz);

      // A torpedo that flies into a rock detonates on the rock.
      //
      // Tested along the SEGMENT it is about to travel, not at the point it
      // ends up. A projectile moves 420 units a second — fourteen a tick at
      // 1/30 — and testing only the arrival point means anything thinner than
      // that is tunnelled straight through. That is not a problem at today's
      // rock sizes and is exactly the kind of thing that stops being true
      // quietly.
      if (dist > 0) {
        const step = Math.min(dist, p.speed * dt);
        const ahead = {
          x: p.x + (dx / dist) * step,
          y: p.y + (dy / dist) * step,
          z: (p.z ?? 0) + (dz / dist) * step,
        };
        const struck = insideSolid(this.arena, p) ?? blockedBy(this.arena, p, ahead);
        if (struck) {
          this.effects.push({ kind: 'explosion', x: p.x, y: p.y, z: p.z ?? 0, life: 0.5 });
          p.dead = true;
          continue;
        }
      }
      if (dist < 26) {
        // A torpedo that has arrived has arrived.
        //
        // The range used here was the LAUNCHER's distance to the target at the
        // moment of impact, not the torpedo's. Torpedoes fly for up to six
        // seconds and both ships keep moving, so a shooter that had since
        // drifted past the 1,200-unit torpedo range made `rangeFactor` return
        // zero — and the torpedo arrived, exploded, and did nothing at all.
        // Passing zero says what is true: the weapon is touching the hull.
        const result = this.resolveHit(p.attacker, p.target, p.weapon, 0, p.subsystem);
        emit('combat:torpedo-impact', { ...result, x: p.x, y: p.y, z: p.z ?? 0 });
        p.dead = true;
        continue;
      }
      p.x += (dx / dist) * p.speed * dt;
      p.y += (dy / dist) * p.speed * dt;
      p.z = (p.z ?? 0) + (dz / dist) * p.speed * dt;
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  updateEffects(dt) {
    for (const e of this.effects) e.life -= dt;
    this.effects = this.effects.filter((e) => e.life > 0);
  }

  /**
   * The fight is over, and the game is told so immediately.
   *
   * `over` used to be a flag somebody else had to notice. The tick loop
   * noticed it, so a fight that ended inside `step` was settled on the same
   * tick — but a fight ended from an ORDER (a hail answered with a surrender,
   * the Kobayashi gambit talked to a finish, a test or a harness saying so
   * outright) sat finished-but-unsettled until the next tick came round.
   *
   * One frame is not nothing: the renderer draws between ticks, so the plot
   * showed a battle that was over and the order bar offered to fire on nobody.
   * The running game's own watchdog is what reported it, as `game.mode.stuck`.
   *
   * `onEnd` is set by the game that owns the engagement. If the fight ended
   * inside `step`, the call is deferred to the end of `update` — settling it
   * mid-step would throw the engagement away with the rest of the tick still
   * to run on it.
   */
  end(outcome) {
    if (this.over) return;
    this.over = true;
    // A fight that is over has an outcome, always. `eng.outcome` in the
    // invariant file says so, everything downstream reads it, and nothing in
    // the game supplies a blank one — but this is a public method and a
    // missing argument used to produce a finished engagement with no result.
    // "Routed" is the neutral reading: it stopped, and nobody says why.
    this.outcome = OUTCOMES.includes(outcome) ? outcome : 'routed';
    emit('combat:end', { outcome, engagement: this });
    if (this.stepping) this.settleWhenSafe = true;
    else this.onEnd?.(this);
  }

  /**
   * Say something, once.
   *
   * The combat log holds sixty lines. `fireAll` reports "No weapons bear on
   * the target" every time the trigger is pulled with the enemy outside an
   * arc, which in a stern chase is thirty times a second — so a minute of
   * manoeuvring flushed the entire log and the line that said a ship had blown
   * up was gone before anybody could read it.
   *
   * A repeat of the line already at the bottom becomes a count on that line
   * instead of a new one. Nothing is lost and nothing is drowned.
   */
  pushLog(text, source = 'bridge') {
    const last = this.log[this.log.length - 1];
    if (last && last.text === text && last.source === source) {
      last.repeats = (last.repeats ?? 1) + 1;
      last.time = this.time;
      emit('combat:log', last);
      return;
    }
    const entry = { text, source, time: this.time };
    this.log.push(entry);
    if (this.log.length > 60) this.log.shift();
    emit('combat:log', entry);
  }

  /**
   * Keep everyone inside the arena.
   *
   * A ship that reaches the boundary is turned back rather than teleported —
   * the position is clamped to the sphere so nothing can escape, and the
   * desired heading is pointed inward so the AI stops driving into the wall.
   * Clamping alone would leave a ship grinding against the edge at full
   * throttle forever, which looks broken and pins the auto-framing camera.
   */
  /**
   * What standing in the gas does, every tick, to everyone standing in it.
   *
   * Shields will not hold a charge and a cloak will not hold at all. Both are
   * the Mutara Nebula and both cut in the player's favour as often as against
   * it — a Bird-of-Prey cannot hide in there either, which is the whole reason
   * a Constitution would choose to fight in one.
   */
  weatherOn(dt) {
    if (!this.arena.features.length) return;
    for (const s of this.allShips) {
      if (s.destroyed) continue;
      const c = conditionsAt(this.arena, s);
      if (c.depth <= 0) continue;

      if (c.breaksCloak && s.cloaked) {
        s.decloak();
        this.pushLog(`${s === this.player ? 'Our' : `${s.name}'s`} cloak will not hold in this.`,
          s === this.player ? 'engineering' : 'tactical');
      }
      if (c.shieldSuppression > 0 && s.shieldsUp) {
        // A share of the ceiling a second, so it bites the same on a runabout
        // as on a Galaxy rather than being decided by which has more to lose.
        const bleed = s.maxShield * 0.12 * c.shieldSuppression * dt;
        for (const f of FACINGS) s.shields[f] = Math.max(0, s.shields[f] - bleed);
      }
      if (s === this.player && !this.saidMurk && c.depth > 0.4) {
        this.saidMurk = true;
        this.pushLog(`We are in the ${this.arena.name}. Sensors and shields are both going to suffer.`,
          'science');
      }
    }
  }

  /**
   * Nobody flies through a rock.
   *
   * The alternative is not merely ugly: a ship parked inside a solid feature
   * cannot be shot from anywhere — every line to it crosses the rock it is
   * standing in — which is a hostile that cannot be killed and an end
   * condition that never fires. Pushed out along the radius rather than
   * stopped, because stopping it leaves it there.
   */
  keepOutOfRocks() {
    if (!this.arena.features.length) return;
    for (const s of this.allShips) {
      if (s.destroyed) continue;
      const rock = insideSolid(this.arena, s);
      if (!rock) continue;
      const dx = s.x - rock.x;
      const dy = s.y - rock.y;
      const dz = (s.z ?? 0) - rock.z;
      // Dead centre has no outward direction, so pick one rather than divide
      // by zero. It is a degenerate case and it does happen: a ship that
      // starts a manoeuvre from inside gets pushed to the same face every
      // tick, which is fine — what matters is that it leaves.
      const d = Math.hypot(dx, dy, dz);
      const [ux, uy, uz] = d > 1e-6 ? [dx / d, dy / d, dz / d] : [1, 0, 0];
      const surface = rock.r + 12;
      s.x = rock.x + ux * surface;
      s.y = rock.y + uy * surface;
      s.z = rock.z + uz * surface;
    }
  }

  holdTheArena() {
    for (const s of this.allShips) {
      const d = Math.hypot(s.x, s.y, s.z ?? 0);
      if (d <= ARENA_RADIUS) continue;

      // Wrecks are clamped too. They stop steering but they do not stop
      // existing, and the auto-framing camera frames on every hull it can see —
      // a hulk left outside the volume drags the view out with it.
      const k = ARENA_RADIUS / d;
      s.x *= k; s.y *= k; s.z = (s.z ?? 0) * k;
      if (s.destroyed) continue;

      // The captain still has the helm.
      //
      // The clamp holds everyone inside the volume, but rewriting the desired
      // heading is steering — and doing it to the player took the helm out of
      // their hands without a word: the ship turned back from the boundary on
      // its own and the order they had just given was gone. The AI is told
      // where to go; the player is told what happened.
      if (s === this.player) {
        this.pushLog('We are at the edge of the engagement volume, Captain.', 'helm');
        continue;
      }

      // Point back toward the middle of the engagement.
      s.desiredHeading = Math.atan2(-s.y, -s.x) * 180 / Math.PI;
      const flat = Math.hypot(s.x, s.y) || 1;
      s.desiredPitch = Math.atan2(-(s.z ?? 0), flat) * 180 / Math.PI;
    }
  }

  /**
   * Let a ship that broke off and got clear actually go.
   *
   * Fleeing was a state with no exit: the ship ran, cloaked, outpaced you, and
   * stayed on the board as a live hostile for as long as the engagement lasted.
   * A captain who has stayed out of your reach for a solid few seconds has got
   * away, which is what a rout means, and the fight can end.
   *
   * The delay matters. Ending the moment a fleeing ship crosses weapons range
   * would let a fast attacker slip out and back in during a single pass.
   */
  settleWithdrawals(dt) {
    for (const s of this.hostiles) {
      if (s.destroyed || s.withdrawn) continue;
      const clear = !this.relentless
        && s.fleeing
        && this.player.distanceTo(s) > MAX_WEAPON_RANGE;
      s.withdrawTimer = clear ? (s.withdrawTimer ?? 0) + dt : 0;
      if (s.withdrawTimer <= WITHDRAW_SECONDS) continue;

      s.withdrawn = true;
      this.pushLog(`${s.name} has broken contact and gone to warp.`, 'tactical');
      if (this.target === s) this.target = this.liveHostiles[0] ?? null;
      // And everyone else's lock. Only the player's was dropped here, so an
      // allied captain went on chasing a ship that had gone — the lock is
      // cleared rather than left for the AI to notice, because withdrawal is
      // settled after the captains have already acted this tick, and a lock on
      // a ship that has left the fight should not survive even that long.
      for (const other of this.allShips) {
        if (other.aiTarget === s) other.aiTarget = null;
      }
    }
  }

  /** Status summary an officer would read aloud. */
  statusReport() {
    const p = this.player;
    const shieldLines = FACINGS
      .map((f) => `${f} ${Math.round(p.shieldPctOf(f) * 100)}%`)
      .join(', ');
    // Which banks are out, so the mechanic has a voice through an order the
    // captain already has. No new intent and no new phrasing — `status` has
    // always existed and this rides it, which is why this whole change touches
    // none of the counts README states and docs.test.js scrapes.
    const out = p.weapons.filter((w) => w.enabled === false);
    return {
      hull: Math.round(p.hullPct * 100),
      shields: shieldLines,
      crew: p.crew,
      casualties: p.maxCrew - p.crew,
      hostiles: this.liveHostiles.length,
      condition: p.condition,
      weapons: out.length
        ? `${out.map((w) => mountName(w)).join(' and ')} out of action`
        : 'all banks answering',
    };
  }
}

/**
 * What a gun mount is called, out loud.
 *
 * `FACING_LABEL` in ship.js has existed for a long time and its declaration was
 * the ONLY occurrence of its own name anywhere in src/ or tests/ — six labels
 * written down and read by nothing. This is its first reader: the arc a mount
 * covers is exactly what a bridge crew would name it by.
 *
 * Falls back to the mount's own `name` for anything whose facing is not one of
 * the six, and to the id for anything with neither.
 */
function mountName(w) {
  if (!w) return 'mount';
  const label = FACING_LABEL[facingForBearing(w.facing ?? 0)];
  const kind = w.type === 'torpedo' ? 'tubes'
    : w.type === 'cannon' ? 'cannons' : 'banks';
  return label ? `${label} ${kind}` : (w.name ?? String(w.id ?? 'mount'));
}

/** Build a hostile group appropriate to a faction and difficulty. */
/**
 * What an enemy ship is called.
 *
 * This table existed twice — here and in world/encounters.js — and a third
 * code path, the one a mission stage uses to start a fight, had neither and
 * named its ships "klingon vessel 1". Two copies of a list is one copy too
 * many; three ways of naming the same thing is a game that reads as unfinished
 * in the one place the player is looking hardest.
 */
export const HOSTILE_NAMES = {
  klingon: ['IKS Vor’cha', 'IKS Ch’Tang', 'IKS Bortas', 'IKS Rotarran', 'IKS Ning’tao'],
  romulan: ['IRW Terix', 'IRW Belak', 'IRW Valdore', 'IRW Khazara', 'IRW Devoras'],
  cardassian: ['CDS Prakesh', 'CDS Aldara', 'CDS Vetar', 'CDS Groumall'],
  ferengi: ['Kreechta', 'Krayton', 'Quark’s Fortune'],
  orion: ['Syndicate Raider', 'Green Wind', 'Profit Margin'],
  tholian: ['Assembly Spinner', 'Lattice Warden'],
  dominion: ['Jem’Hadar 4-7', 'Jem’Hadar 9-1', 'Jem’Hadar 2-2'],
  borg: ['Borg Cube'],
  // Starfleet is in here because ships of the line turn up on your side as
  // well as in front of you — a relief answering a distress call is named from
  // the same table as a hostile, because a ship is a ship.
  federation: [
    'USS Farragut', 'USS Potemkin', 'USS Lexington', 'USS Exeter', 'USS Yorktown',
    'USS Hood', 'USS Republic', 'USS Defiance', 'USS Endeavour', 'USS Kongo',
  ],
  independent: ['SS Vico', 'SS Odin', 'SS Norkova'],
};

/**
 * The nth ship of a faction in one engagement.
 *
 * The lists are short — three Orion names, two Tholian — and a patrol is no
 * longer one or two hulls, so the wrap has to say which one it is. Four raiders
 * used to be Syndicate Raider, Green Wind, Profit Margin and Syndicate Raider
 * again, which the tactical display then offered as two identical targets.
 */
export function hostileName(factionId, index = 0) {
  const list = HOSTILE_NAMES[factionId] ?? ['Unknown Vessel'];
  const name = list[index % list.length];
  const lap = Math.floor(index / list.length);
  return lap ? `${name} ${romanNumeral(lap + 1)}` : name;
}

/**
 * II, III… for a hull whose name has come round again.
 *
 * Lives here rather than in `core/state.js`, which had the only copy, because
 * there are now two places that run out of names: reinforcements added by the
 * difficulty setting, and a force built to a strength that wants more hulls
 * than the faction has names for. Both have to agree, or `stripSuffix` — which
 * matches `I{1,3}|IV|V|VI` — silently stops stripping.
 */
const ROMAN = ['', '', 'II', 'III', 'IV', 'V', 'VI'];
export const romanNumeral = (n) => ROMAN[n] ?? String(n);

/** "IKS Bortas" and "IKS Bortas II" should not become "IKS Bortas II II". */
export const stripSuffix = (name) => String(name).replace(/\s+(?:I{1,3}|IV|V|VI)$/, '');

/**
 * Never more hulls than the tactical display can stay readable with.
 *
 * The same six `Game.scaleHostileFleet` uses, and for the same reason. Kept
 * here as well because a force is now built to a WEIGHT, and the arithmetic
 * that turns a weight into hulls will happily ask for nine Orion raiders.
 */
export const MAX_FORCE_HULLS = 6;

/**
 * How often a force is drawn without regard to what the situation was worth.
 *
 * One encounter in twelve. High enough that a long commission meets a capital
 * ship; low enough that meeting one is a thing that happened rather than a
 * Tuesday.
 */
export const CAPITAL_CHANCE = 0.08;

/**
 * A hostile force of a given strength, drawn from a pool of classes.
 *
 * `strength` is in Constitutions (see `classPower`), not in hulls. That is the
 * whole change: for the life of the project this argument was named `strength`,
 * documented as strength, and used as a count — `rng.int(1, 2)` hulls picked
 * uniformly from a pool spanning a scout to a battleship.
 *
 * Measured through `rollEncounter`, one encounter kind in one system, four
 * hundred rolls of each, against a Constitution:
 *
 *     Qo'noS      "A Klingon patrol"    ratio 0.05 .. 2.44  — 45x
 *                 worst: two Negh'Vars (hopeless, dead every time)
 *                 best:  one Bird-of-Prey (favourable, free)
 *     Rigel       "An Orion patrol"     ratio 1.32 .. 10.72
 *                 worst: two Marauders (still in the player's favour)
 *                 best:  one Orion raider (no contest)
 *
 * Identical text both times. The captain could not tell a walkover from a
 * funeral, and 47% of Klingon patrols were funerals.
 *
 * How it builds: pick a lead from the classes that could plausibly make up a
 * force this size — nothing whose single hull outweighs the whole force by more
 * than `overshoot` — then add escorts, each lighter than the lead, for as long
 * as adding one brings the force CLOSER to the target. The square law does the
 * rest: `n` identical hulls are worth n² of one, so light classes arrive in
 * packs and capitals arrive alone, without either being written down anywhere.
 *
 *     strength   klingon                       orion
 *     0.6        a Bird-of-Prey                three raiders
 *     1.0        two Birds-of-Prey, or a D7    three raiders
 *     1.6        a D7, or a Vor'cha            four raiders
 *     2.5        a Vor'cha, or two K't'ingas   five raiders
 *     4.0        a Vor'cha and a Bird-of-Prey  six raiders
 *                or a Negh'Var, alone
 *
 * The Orion raider's own description says "Dangerous in threes, worthless
 * alone." It is now possible for the game to field three.
 */
export function buildHostiles(rng, factionId, strength = 1, classPool = []) {
  const classes = pickForce(rng, strength, classPool);
  return classes.map((cls, i) => new Ship(cls, {
    name: hostileName(factionId, i), faction: factionId,
  }));
}

/**
 * The classes that make up a force of the given strength.
 *
 * Split out from `buildHostiles` so it can be costed and asserted on without
 * building ships, and so the encounter text can say what is coming.
 */
export function pickForce(rng, strength, classPool = [], {
  overshoot = 1.6, capitalChance = CAPITAL_CHANCE,
} = {}) {
  const armed = [...new Set(classPool)].filter((c) => classPower(c) > 0);
  // A convoy of freighters is a pool with no fighting power in it. It is still
  // a thing that turns up, so it comes back as one hull rather than as nothing.
  if (!armed.length) return classPool.slice(0, 1);

  const want = Math.max(0.01, strength);
  // Sometimes what turns up is not what the situation warranted. Costing every
  // force to the target made a Borg cube unreachable — the Borg pool is two
  // capitals and the deepspace garrison is worth 0.2 of a Constitution, so the
  // affordability rule fielded a bioship every time and the cube, which is the
  // game's whole illustration of a fight you run from, stopped existing outside
  // scripted missions. It also left a Sovereign with nothing to fear anywhere
  // on the map: 1% of deep-space encounters rated dangerous and none worse.
  //
  // This is the encounter that is genuinely out of scale, and it is rare on
  // purpose. The captain is not ambushed by it in the dark: the bridge weighs
  // the fight and says so before a shot is fired.
  const wild = rng.chance(capitalChance);
  const affordable = wild ? armed : armed.filter((c) => classPower(c) <= want * overshoot);
  const lightest = armed.reduce((a, b) => (classPower(a) <= classPower(b) ? a : b));
  const eligible = affordable.length ? affordable : [lightest];
  // Weighted by the pool's own repetition, because that is how the fleet tables
  // say which hull is common: the Klingon list names bird_of_prey twice.
  const weighted = classPool.filter((c) => eligible.includes(c));
  const lead = rng.pick(weighted.length ? weighted : eligible);

  // An escort is lighter than the ship it escorts. Two Negh'Vars is not a
  // patrol with a big flagship, it is a war.
  const escorts = armed.filter((c) => classPower(c) <= classPower(lead));
  const force = [lead];
  while (force.length < MAX_FORCE_HULLS) {
    const err = Math.abs(forcePower(force) - want);
    const better = escorts.filter((c) => Math.abs(forcePower([...force, c]) - want) < err);
    if (!better.length) break;
    force.push(rng.pick(better));
  }
  return force;
}

export { FACINGS, facingForBearing };
