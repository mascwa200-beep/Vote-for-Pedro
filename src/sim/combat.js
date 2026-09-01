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
import { Ship, FACINGS, SUBSYSTEM_KEYS, inArc, facingForBearing, facingForDirection } from './ship.js';
import { chooseAction } from './ai.js';
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
export const OUTCOMES = ['victory', 'routed', 'escaped', 'parley', 'destroyed'];

/** Beyond this, nobody can do anything to anybody and the fight is decided. */
export const DISENGAGE_RANGE = MAX_WEAPON_RANGE * 1.6;

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
   * @param {object} opts { allies, objective, escapeAt, name }
   */
  constructor(player, hostiles, rng, opts = {}) {
    this.player = player;
    this.hostiles = hostiles;
    this.allies = opts.allies ?? [];
    this.rng = rng;
    this.name = opts.name ?? 'Engagement';
    this.objective = opts.objective ?? 'destroy';
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
    this.canWarpOut = opts.canWarpOut !== false;
    // Nobody in this fight breaks off. Set only by the Kobayashi Maru, where a
    // hostile that could be routed would make the no-win scenario winnable by
    // flying — which is the one thing it must never be.
    this.relentless = opts.relentless === true;
    // How many people were aboard when this started.
    //
    // Crew losses are permanent, so the standing deficit is the whole
    // campaign's dead and not this battle's. Without a mark at the start,
    // every fight reported every death that had ever happened.
    this.crewAtStart = player?.crew ?? 0;
    this.shotsFired = 0;
    // Ships whose destruction has already been announced. A death is a
    // one-time event and the sweep that finds it runs every tick.
    this.mourned = new Set();

    this.placeCombatants();
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
    if (!this.canWarpOut) { this.pushLog('Cannot disengage — we are pinned.', 'helm'); return false; }
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
    if (!target || target.destroyed || attacker.destroyed) return false;
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
        subsystem: attacker === this.player ? this.targetedSubsystem : null,
      });
      emit('combat:fire', { attacker, weapon, type: 'torpedo' });
      return true;
    }

    // Beams and cannons resolve immediately, with a visible trace.
    const result = this.resolveHit(attacker, target, weapon, distance,
      attacker === this.player ? this.targetedSubsystem : null);
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

    const accuracy = 0.92 * attacker.mod('accuracy')
      * (0.7 + 0.3 * attacker.subsystems.sensors);
    // A decoy in the water only troubles the people shooting at us.
    const decoy = (target === this.player && this.decoyTimer > 0) ? 0.22 : 0;
    const evade = target.defenseRating + (target.cloaked ? 0.5 : 0) + decoy;
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
  reportDeaths() {
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
    return !!ship && !ship.destroyed && !ship.withdrawn
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

    for (const s of this.allShips) s.update(dt, this.rng);

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

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      p.life -= dt;
      if (p.target.destroyed || p.life <= 0) { p.dead = true; continue; }
      const dx = p.target.x - p.x;
      const dy = p.target.y - p.y;
      const dz = (p.target.z ?? 0) - (p.z ?? 0);
      const dist = Math.hypot(dx, dy, dz);
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
    }
  }

  /** Status summary an officer would read aloud. */
  statusReport() {
    const p = this.player;
    const shieldLines = FACINGS
      .map((f) => `${f} ${Math.round(p.shieldPctOf(f) * 100)}%`)
      .join(', ');
    return {
      hull: Math.round(p.hullPct * 100),
      shields: shieldLines,
      crew: p.crew,
      casualties: p.maxCrew - p.crew,
      hostiles: this.liveHostiles.length,
      condition: p.condition,
    };
  }
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

/** The nth ship of a faction in one engagement. */
export function hostileName(factionId, index = 0) {
  const list = HOSTILE_NAMES[factionId] ?? ['Unknown Vessel'];
  return list[index % list.length];
}

/**
 * A hostile force of a given strength, drawn from a pool of classes.
 *
 * Written when combat was, and called from nowhere for the whole life of the
 * project: `world/encounters.js` grew its own copy rather than importing this
 * one. It is the single builder now.
 */
export function buildHostiles(rng, factionId, strength = 1, classPool = []) {
  const count = Math.max(1, Math.round(strength));
  const out = [];
  for (let i = 0; i < count; i++) {
    const cls = rng.pick(classPool);
    if (!cls) break;
    out.push(new Ship(cls, { name: hostileName(factionId, i), faction: factionId }));
  }
  return out;
}

export { FACINGS, facingForBearing };
