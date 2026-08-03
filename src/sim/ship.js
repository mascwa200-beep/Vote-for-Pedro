// A ship in the simulation — player or otherwise.
//
// Shields are six independent facings. Subsystems degrade independently and
// affect what the ship can actually do. Crew is a resource that dies.

import { PowerGrid } from './power.js';
import { getShipClass, FEDERATION_REGISTRIES } from '../world/ships.data.js';
import { clamp } from '../core/num.js';
import { emit } from '../core/events.js';

// Six facings, not four.
//
// A ship is a solid in space and can be shot at from above and below, and once
// the simulation has a third axis, pretending otherwise means an attacker who
// climbs is hitting a shield that geometrically is not there. The dorsal and
// ventral facings are the real cost of going 3D: they touch damage resolution,
// the AI, the display, saves, and balance. They are worth paying for once.
export const FACINGS = ['fore', 'aft', 'port', 'starboard', 'dorsal', 'ventral'];

export const FACING_LABEL = {
  fore: 'Forward', aft: 'Aft', port: 'Port', starboard: 'Starboard',
  dorsal: 'Dorsal', ventral: 'Ventral',
};

/**
 * Ship-local axes, in simulation coordinates: +x is the bow, +y is starboard,
 * +z is dorsal. The renderer maps this to its own +y-up convention; nothing
 * else in the simulation needs to care.
 */
export const FACING_AXIS = {
  fore: [1, 0, 0],
  aft: [-1, 0, 0],
  starboard: [0, 1, 0],
  port: [0, -1, 0],
  dorsal: [0, 0, 1],
  ventral: [0, 0, -1],
};

const DEG = Math.PI / 180;

/** A horizontal bearing in degrees, as a unit direction. */
export function bearingToDirection(bearing) {
  const b = bearing * DEG;
  return [Math.cos(b), Math.sin(b), 0];
}

/** Modifiers that add rather than multiply. */
export const ADDITIVE_MODS = new Set(['critChance', 'critSeverity', 'damageResist', 'crewProtect']);

export const SUBSYSTEM_KEYS = ['weapons', 'shields', 'engines', 'auxiliary', 'warpcore', 'sensors', 'lifesupport'];

/**
 * Which shield facing covers a direction, given in ship-local coordinates.
 *
 * The dominant axis wins. This is the six-sided generalisation of the old
 * quadrant test and agrees with it exactly in the plane: a bearing of 45°
 * still lands on the bow, 46° still lands to starboard.
 */
export function facingForDirection(dir) {
  const [x, y, z] = dir;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ax >= ay && ax >= az) return x >= 0 ? 'fore' : 'aft';
  if (ay >= az) return y >= 0 ? 'starboard' : 'port';
  return z >= 0 ? 'dorsal' : 'ventral';
}

/** Bearing (deg, 0 = dead ahead) to the shield facing that covers it. */
export function facingForBearing(bearing) {
  return facingForDirection(bearingToDirection(bearing));
}

/**
 * Is a direction inside a weapon's firing arc?
 *
 * A cone test rather than an angle comparison, so an arc restricts elevation as
 * well as bearing — a forward phaser bank does not bear on something directly
 * above the saucer just because it is ahead in plan view.
 *
 * Accepts a local direction vector or, for the two-dimensional callers that
 * predate this, a plain bearing in degrees.
 */
export function inArc(dirOrBearing, weapon) {
  const dir = Array.isArray(dirOrBearing) ? dirOrBearing : bearingToDirection(dirOrBearing);
  const half = (weapon.degrees ?? 360) / 2;
  if (half >= 180) return true;

  const axis = bearingToDirection(weapon.facing ?? 0);
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const cos = (dir[0] * axis[0] + dir[1] * axis[1] + dir[2] * axis[2]) / len;
  // Guard the floating-point edge so a shot exactly on the arc boundary is in.
  return cos >= Math.cos(half * DEG) - 1e-9;
}

export class Ship {
  /**
   * @param {string} classId key into SHIP_CLASSES
   * @param {object} opts    { name, registry, faction, isPlayer, skillMods }
   */
  constructor(classId, opts = {}) {
    const cls = getShipClass(classId);
    if (!cls) throw new Error(`Unknown ship class: ${classId}`);

    this.classId = classId;
    this.cls = cls;
    this.name = opts.name ?? cls.name;
    this.registry = opts.registry ?? (cls.faction === 'federation' ? FEDERATION_REGISTRIES[0] : '');
    this.faction = opts.faction ?? cls.faction;
    this.isPlayer = !!opts.isPlayer;
    this.civilian = !!cls.civilian;

    // ---- durability ----
    this.maxHull = cls.hull;
    this.hull = cls.hull;
    // Divided six ways rather than four. The total pool is unchanged; what
    // changes is that each facing holds less of it and there are two more
    // surfaces to be hit through.
    this.maxShield = cls.shields / FACINGS.length;
    this.shields = Object.fromEntries(FACINGS.map((f) => [f, this.maxShield]));
    this.shieldRegen = cls.shieldRegen / FACINGS.length;
    this.shieldsUp = true;

    // ---- crew ----
    this.maxCrew = cls.crew;
    this.crew = cls.crew;
    this.injured = 0;

    // ---- movement ----
    // x/y is the plane, z is altitude. Heading is a compass bearing and pitch
    // is nose-up in degrees; roll is carried for the renderer and for banking
    // into a turn, and has no effect on where weapons bear.
    this.x = 0; this.y = 0; this.z = 0;
    this.heading = 0;              // degrees, 0 = +x
    this.pitch = 0;                // degrees, + = nose up
    this.roll = 0;                 // degrees, + = starboard wing down
    this.throttle = 0;             // 0..1 of impulse
    this.desiredHeading = 0;
    this.desiredPitch = 0;
    this.velocity = { x: 0, y: 0, z: 0 };

    // ---- systems ----
    this.power = new PowerGrid(cls.powerCap);
    this.subsystems = Object.fromEntries(SUBSYSTEM_KEYS.map((k) => [k, 1.0])); // 1 = intact
    this.weapons = (cls.weapons ?? []).map((w) => ({ ...w, cooldown: 0, enabled: true }));
    this.torpedoes = cls.weapons?.some((w) => w.type === 'torpedo') ? 60 : 0;
    this.maxTorpedoes = this.torpedoes;
    this.antimatter = 100;

    // ---- states ----
    this.cloakCapable = !!cls.cloak;
    this.cloaked = false;
    this.cloakCooldown = 0;
    this.destroyed = false;
    this.breaching = false;
    this.breachTimer = 0;
    this.coreEjected = false;
    this.fires = 0;
    this.boarders = 0;
    this.adaptation = {};          // Borg: damage type -> resistance 0..0.9
    this.evasive = false;

    // ---- modifiers from skills, consoles, officer abilities ----
    this.mods = {
      damage: 1, shieldMax: 1, shieldRegen: 1, hullMax: 1, turn: 1,
      impulse: 1, accuracy: 1, defense: 1, critChance: 0.05, critSeverity: 0.5,
      repairRate: 1, torpedoDamage: 1, beamDamage: 1, cannonDamage: 1,
      damageResist: 0, stealthDetect: 1, crewProtect: 0,
    };
    this.buffs = [];               // { id, label, until, mods }

    if (opts.skillMods) this.applyMods(opts.skillMods);
    this.recomputeDerived();
  }

  // ---------------- derived stats ----------------

  applyMods(mods) {
    for (const [k, v] of Object.entries(mods)) {
      if (typeof v !== 'number') continue;
      if (ADDITIVE_MODS.has(k)) this.mods[k] += v;
      else this.mods[k] = (this.mods[k] ?? 1) * v;
    }
    this.recomputeDerived();
  }

  recomputeDerived() {
    // Raising a maximum scales the current value with it, so installing a
    // hull console does not leave the ship reading as pre-damaged.
    const prevMaxShield = this.maxShield;
    const prevMaxHull = this.maxHull;

    this.maxHull = this.cls.hull * this.mods.hullMax;
    this.maxShield = (this.cls.shields / FACINGS.length) * this.mods.shieldMax;

    if (prevMaxShield > 0) {
      const ratio = this.maxShield / prevMaxShield;
      for (const f of FACINGS) this.shields[f] = Math.min(this.maxShield, this.shields[f] * ratio);
    }
    if (prevMaxHull > 0) {
      this.hull = Math.min(this.maxHull, this.hull * (this.maxHull / prevMaxHull));
    } else {
      this.hull = Math.min(this.hull, this.maxHull);
    }
  }

  /** Combined modifier including temporary buffs. */
  mod(key) {
    let value = this.mods[key] ?? 1;
    for (const b of this.buffs) {
      const v = b.mods?.[key];
      if (typeof v !== 'number') continue;
      if (ADDITIVE_MODS.has(key)) value += v;
      else value *= v;
    }
    return value;
  }

  addBuff(buff) {
    this.buffs = this.buffs.filter((b) => b.id !== buff.id);
    this.buffs.push(buff);
  }

  hasBuff(id) {
    return this.buffs.some((b) => b.id === id);
  }

  // ---------------- health readouts ----------------

  get hullPct() { return this.maxHull > 0 ? this.hull / this.maxHull : 0; }
  get shieldPct() {
    const total = FACINGS.reduce((n, f) => n + this.shields[f], 0);
    return this.maxShield > 0 ? total / (this.maxShield * FACINGS.length) : 0;
  }
  shieldPctOf(facing) {
    return this.maxShield > 0 ? this.shields[facing] / this.maxShield : 0;
  }
  get crewPct() { return this.maxCrew > 0 ? this.crew / this.maxCrew : 0; }

  /** Overall condition, used for status reports and AI decisions. */
  get condition() {
    if (this.destroyed) return 'destroyed';
    if (this.breaching) return 'critical';
    if (this.hullPct < 0.25) return 'critical';
    if (this.hullPct < 0.55) return 'serious';
    if (this.hullPct < 0.85 || this.shieldPct < 0.4) return 'damaged';
    return 'nominal';
  }

  // ---------------- speed & manoeuvre ----------------

  get maxSpeed() {
    return this.cls.impulse * 100
      * this.power.factor('engines')
      * this.subsystems.engines
      * this.mod('impulse')
      * (this.evasive ? 1.25 : 1);
  }

  get turnRate() {
    return this.cls.turnRate
      * (0.6 + 0.4 * this.power.factor('engines'))
      * this.subsystems.engines
      * this.mod('turn')
      * (this.evasive ? 1.4 : 1);
  }

  /** Chance an incoming shot misses, from speed and evasive manoeuvres. */
  get defenseRating() {
    const speedFactor = Math.min(1, this.throttle) * 0.18;
    return (speedFactor + (this.evasive ? 0.16 : 0)) * this.mod('defense');
  }

  /**
   * A world-space offset expressed in this ship's own frame.
   *
   * Yaw first, then pitch — the inverse of how the orientation is applied — so
   * the result is a unit vector in the ship-local axes that FACING_AXIS and
   * inArc are defined against. Roll is deliberately not undone: rolling the
   * ship spins the hull about its own nose and moves nothing relative to it.
   */
  localDirection(dx, dy, dz) {
    const h = this.heading * DEG;
    const ch = Math.cos(h);
    const sh = Math.sin(h);
    const x1 = dx * ch + dy * sh;
    const y1 = -dx * sh + dy * ch;

    const p = (this.pitch ?? 0) * DEG;
    const cp = Math.cos(p);
    const sp = Math.sin(p);
    const x2 = x1 * cp + dz * sp;
    const z2 = -x1 * sp + dz * cp;

    const len = Math.hypot(x2, y1, z2) || 1;
    return [x2 / len, y1 / len, z2 / len];
  }

  /** Direction to a target, in this ship's frame. */
  directionTo(target) {
    return this.localDirection(target.x - this.x, target.y - this.y, (target.z ?? 0) - (this.z ?? 0));
  }

  /** Direction an attacker lies in, in this ship's frame — which facing it hits. */
  directionFrom(source) {
    return this.localDirection(source.x - this.x, source.y - this.y, (source.z ?? 0) - (this.z ?? 0));
  }

  /**
   * Horizontal bearing to a target, relative to current heading.
   * Retained because plenty of the game reasons in the plane — the AI's
   * steering, the log lines, the 2D display — and none of that needs elevation.
   */
  bearingTo(target) {
    const abs = Math.atan2(target.y - this.y, target.x - this.x) * 180 / Math.PI;
    let rel = abs - this.heading;
    rel = ((rel % 360) + 360) % 360;
    if (rel > 180) rel -= 360;
    return rel;
  }

  /** Bearing from the target's perspective — which of ITS facings we hit. */
  bearingFrom(source) {
    const abs = Math.atan2(source.y - this.y, source.x - this.x) * 180 / Math.PI;
    let rel = abs - this.heading;
    rel = ((rel % 360) + 360) % 360;
    if (rel > 180) rel -= 360;
    return rel;
  }

  /** Elevation angle to a target in degrees, + = above us. */
  elevationTo(target) {
    const dz = (target.z ?? 0) - (this.z ?? 0);
    const flat = Math.hypot(target.x - this.x, target.y - this.y);
    return Math.atan2(dz, flat) * 180 / Math.PI;
  }

  distanceTo(target) {
    return Math.hypot(target.x - this.x, target.y - this.y, (target.z ?? 0) - (this.z ?? 0));
  }

  // ---------------- per-step update ----------------

  update(dt, rng) {
    if (this.destroyed) return;

    this.power.update(dt);

    // Buffs expire.
    if (this.buffs.length) {
      this.buffs = this.buffs.filter((b) => b.until === undefined || b.until > 0);
      for (const b of this.buffs) if (b.until !== undefined) b.until -= dt;
      this.buffs = this.buffs.filter((b) => b.until === undefined || b.until > 0);
    }

    // Movement — yaw, then pitch, then integrate along the nose.
    let diff = this.desiredHeading - this.heading;
    diff = ((diff % 360) + 360) % 360;
    if (diff > 180) diff -= 360;
    const maxTurn = this.turnRate * dt;
    const yawStep = Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;
    this.heading = (((this.heading + yawStep) % 360) + 360) % 360;

    // Pitching is slower than yawing on every hull here. Starships are built
    // around a horizontal plane and a captain who climbs to escape is trading
    // time for the manoeuvre, which is what makes elevation a real decision
    // rather than a free extra direction to run in.
    const wantPitch = Math.max(-70, Math.min(70, this.desiredPitch ?? 0));
    const pitchDiff = wantPitch - this.pitch;
    const maxPitch = this.turnRate * 0.55 * dt;
    this.pitch += Math.abs(pitchDiff) <= maxPitch ? pitchDiff : Math.sign(pitchDiff) * maxPitch;

    // Bank into the turn. Cosmetic, but it is what makes a hull read as flying
    // rather than sliding, and it costs one lerp.
    const wantRoll = Math.max(-38, Math.min(38, -yawStep / Math.max(dt, 1e-6) * 0.9));
    this.roll += (wantRoll - this.roll) * Math.min(1, dt * 2.2);

    const speed = this.maxSpeed * this.throttle;
    const h = this.heading * DEG;
    const p = this.pitch * DEG;
    const flat = Math.cos(p) * speed;
    this.velocity.x = Math.cos(h) * flat;
    this.velocity.y = Math.sin(h) * flat;
    this.velocity.z = Math.sin(p) * speed;
    this.x += this.velocity.x * dt;
    this.y += this.velocity.y * dt;
    this.z = (this.z ?? 0) + this.velocity.z * dt;

    // Shield regeneration — suppressed while cloaked or shields down.
    if (this.shieldsUp && !this.cloaked && this.subsystems.shields > 0.05) {
      const rate = this.shieldRegen * this.power.factor('shields')
        * this.subsystems.shields * this.mod('shieldRegen') * dt;
      for (const f of FACINGS) {
        this.shields[f] = Math.min(this.maxShield, this.shields[f] + rate);
      }
    }

    // Weapon cooldowns tick faster with weapon power.
    const cycleRate = 0.6 + 0.4 * this.power.factor('weapons') * this.subsystems.weapons;
    for (const w of this.weapons) {
      if (w.cooldown > 0) w.cooldown = Math.max(0, w.cooldown - dt * cycleRate);
    }
    if (this.cloakCooldown > 0) this.cloakCooldown = Math.max(0, this.cloakCooldown - dt);

    // Fires burn crew and hull until damage control gets to them.
    if (this.fires > 0) {
      this.hull -= this.fires * 6 * dt;
      if (rng && rng.chance(0.4 * dt)) this.crew = Math.max(0, this.crew - 1);
      // Auxiliary power runs damage control.
      const control = 0.06 * this.power.factor('auxiliary') * this.mod('repairRate') * dt;
      if (rng && rng.chance(control)) this.fires--;
      if (this.hull <= 0) this.beginBreach();
    }

    // Boarders fight the crew.
    if (this.boarders > 0 && rng) {
      const defenders = Math.max(1, this.crew * 0.05);
      const losses = Math.min(this.boarders, Math.max(0, rng.normal(defenders * 0.4, 2))) * dt;
      this.boarders = Math.max(0, this.boarders - losses);
      this.crew = Math.max(0, this.crew - losses * 0.8);
      if (rng.chance(0.5 * dt)) this.damageSubsystem(rng.pick(SUBSYSTEM_KEYS), 0.05);
    }

    // Passive subsystem repair (only out of the red).
    const repair = 0.012 * this.power.factor('auxiliary') * this.mod('repairRate') * dt;
    for (const k of SUBSYSTEM_KEYS) {
      if (this.subsystems[k] < 1) this.subsystems[k] = Math.min(1, this.subsystems[k] + repair);
    }

    // Warp core breach countdown.
    if (this.breaching) {
      this.breachTimer -= dt;
      if (this.breachTimer <= 0) this.destroy('warp core breach');
    }

    if (this.crew <= 0 && !this.destroyed) this.destroy('total crew loss');
  }

  // ---------------- damage ----------------

  /**
   * Apply damage at a bearing.
   * @returns {object} { shieldDamage, hullDamage, facing, penetrated, crewKilled }
   */
  takeDamage(amount, {
    bearing = 0, direction = null, type = 'energy',
    shieldPiercing = 0, rng = null, subsystem = null,
  } = {}) {
    if (this.destroyed) return { shieldDamage: 0, hullDamage: 0, facing: 'fore', penetrated: false, crewKilled: 0 };

    // A hit that is not a finite, non-negative quantity is not a hit. Negative
    // damage healed the ship; -Infinity took the hull to NaN and nothing after
    // that was recoverable.
    amount = clamp(amount, 0, this.maxHull * 100);

    // A direction covers all six facings; a bare bearing is the planar case and
    // is still accepted, because plenty of damage in this game — boarding,
    // hazards, collisions — has no meaningful elevation.
    const facing = direction ? facingForDirection(direction) : facingForBearing(bearing);
    let incoming = amount * (1 - Math.min(0.85, this.mod('damageResist')));

    // Borg-style adaptation: repeated damage of one type stops working.
    if (this.cls.adapts) {
      const adapt = this.adaptation[type] ?? 0;
      incoming *= 1 - adapt;
      this.adaptation[type] = Math.min(0.9, adapt + 0.012);
    }

    let shieldDamage = 0;
    let hullDamage = 0;

    const shieldUp = this.shieldsUp && this.subsystems.shields > 0.05;
    if (shieldUp) {
      // A fraction always bleeds through even a healthy shield.
      const bleed = 0.08 + shieldPiercing;
      const toShield = incoming * (1 - bleed);
      const toHull = incoming * bleed;

      shieldDamage = Math.min(this.shields[facing], toShield);
      this.shields[facing] -= shieldDamage;
      const overflow = toShield - shieldDamage;
      hullDamage = toHull + overflow;
    } else {
      hullDamage = incoming;
    }

    // Floored at zero. A hull read as -456,745 is a ship that is very destroyed
    // and, to every percentage the UI computes from it, absurd — hullPct goes
    // deeply negative and the bars, the log lines and the AI's break-off
    // threshold all read nonsense.
    this.hull = Math.max(0, this.hull - hullDamage);

    // Crew casualties scale with how hard the hull was hit, less whatever
    // medical provision the ship carries — the biofunction monitor, a
    // physician captain, and Triage all feed the same number.
    let crewKilled = 0;
    if (hullDamage > 0 && this.maxCrew > 0) {
      const severity = hullDamage / this.maxHull;
      const protection = 1 - Math.min(0.85, this.mod('crewProtect'));
      crewKilled = Math.floor(
        this.maxCrew * severity * 0.55 * protection * (rng ? rng.range(0.5, 1.5) : 1),
      );
      crewKilled = Math.min(this.crew, crewKilled);
      this.crew -= crewKilled;
      this.injured += Math.floor(crewKilled * 1.6);
    }

    // Subsystem damage: targeted, or randomly from a hull hit.
    if (hullDamage > 0) {
      if (subsystem) {
        this.damageSubsystem(subsystem, (hullDamage / this.maxHull) * 3.2);
      } else if (rng && rng.chance(Math.min(0.6, hullDamage / this.maxHull * 5))) {
        this.damageSubsystem(rng.pick(SUBSYSTEM_KEYS), (hullDamage / this.maxHull) * 1.8);
      }
      // Hard hits start fires.
      if (rng && hullDamage > this.maxHull * 0.04 && rng.chance(0.35)) this.fires++;
    }

    // Cloaks fail when the ship is hit.
    if (this.cloaked && hullDamage > 0) this.decloak();

    if (this.hull <= 0 && !this.breaching) this.beginBreach();

    return { shieldDamage, hullDamage, facing, penetrated: hullDamage > 0, crewKilled };
  }

  damageSubsystem(key, amount) {
    if (!(key in this.subsystems)) return;
    this.subsystems[key] = Math.max(0, this.subsystems[key] - amount);
    if (key === 'warpcore' && this.subsystems.warpcore <= 0.15 && !this.breaching) {
      this.beginBreach(this.subsystems.warpcore <= 0 ? 12 : 28);
    }
    if (key === 'shields' && this.subsystems.shields <= 0.05) this.shieldsUp = false;
  }

  beginBreach(seconds = 20) {
    if (this.breaching || this.coreEjected) {
      if (this.hull <= 0) this.destroy('catastrophic hull failure');
      return;
    }
    this.breaching = true;
    this.breachTimer = seconds;
    // The most dramatic thing that happens to a starship, and it used to happen
    // in silence: the warning tone was written in sfx.js and played from
    // nowhere. There is one way out — eject the core — and the player needs to
    // be told the clock has started.
    emit('ship:breach', { ship: this, seconds });
  }

  /** The one way out of a breach. Costs you warp drive for the rest of the fight. */
  ejectCore() {
    if (!this.breaching || this.coreEjected) return false;
    this.breaching = false;
    this.coreEjected = true;
    this.breachTimer = 0;
    this.subsystems.warpcore = 0;
    this.power.cap = Math.round(this.cls.powerCap * 0.45);
    this.power.normalize();
    return true;
  }

  destroy(cause = 'destroyed') {
    if (this.destroyed) return;
    this.destroyed = true;
    this.destroyCause = cause;
    this.hull = 0;
    for (const f of FACINGS) this.shields[f] = 0;
  }

  // ---------------- actions ----------------

  cloak() {
    if (!this.cloakCapable || this.cloaked || this.cloakCooldown > 0) return false;
    this.cloaked = true;
    this.shieldsUp = false;
    this.cloakCooldown = 6;
    return true;
  }

  decloak() {
    if (!this.cloaked) return false;
    this.cloaked = false;
    this.shieldsUp = true;
    this.cloakCooldown = 4;
    return true;
  }

  /**
   * Emergency shield reinforcement to one facing, taken from the others.
   *
   * The receiving facing is capped at 1.2x max, so it can only ever absorb a
   * limited amount. Charge is conserved: we work out the headroom first and
   * draw exactly that much, proportionally, rather than stripping a fixed
   * fraction off five facings and letting the overflow evaporate.
   */
  reinforceShield(facing, fraction = 0.35) {
    if (!FACINGS.includes(facing)) return false;
    const others = FACINGS.filter((f) => f !== facing);
    const draw = clamp(fraction, 0, 1);
    const available = others.reduce((n, f) => n + this.shields[f] * draw, 0);
    const headroom = Math.max(0, this.maxShield * 1.2 - this.shields[facing]);
    const wanted = Math.min(available, headroom);
    if (wanted <= 0) return true;

    // `available` is a fixed fraction of the pool, so scaling by wanted/available
    // keeps each facing's contribution proportional to what it actually holds.
    const scale = wanted / available;
    let pooled = 0;
    for (const f of others) {
      const take = this.shields[f] * draw * scale;
      this.shields[f] -= take;
      pooled += take;
    }
    this.shields[facing] = Math.min(this.maxShield * 1.2, this.shields[facing] + pooled);
    return true;
  }

  repair(amount) {
    // Guarded, and never negative: `repair(-Infinity)` used to drive the hull
    // to -Infinity, which is a destroyed ship the game does not know is dead.
    const healed = clamp(amount, 0, this.maxHull);
    this.hull = Math.min(this.maxHull, this.hull + healed);
    for (const k of SUBSYSTEM_KEYS) {
      this.subsystems[k] = Math.min(1, this.subsystems[k] + healed / this.maxHull);
    }
    if (this.subsystems.shields > 0.05) this.shieldsUp = true;
    if (this.hull > 0) { this.breaching = false; this.breachTimer = 0; }
    return this.hull;
  }

  /** Full starbase overhaul. */
  restore() {
    this.hull = this.maxHull;
    for (const f of FACINGS) this.shields[f] = this.maxShield;
    for (const k of SUBSYSTEM_KEYS) this.subsystems[k] = 1;
    this.shieldsUp = true;
    this.fires = 0;
    this.boarders = 0;
    this.breaching = false;
    this.breachTimer = 0;
    this.coreEjected = false;
    this.power.cap = this.cls.powerCap;
    this.torpedoes = this.maxTorpedoes;
    this.antimatter = 100;
    this.injured = 0;
    this.adaptation = {};
    this.destroyed = false;
  }

  // ---------------- persistence ----------------

  save() {
    return {
      classId: this.classId, name: this.name, registry: this.registry, faction: this.faction,
      hull: this.hull, shields: this.shields, shieldsUp: this.shieldsUp,
      crew: this.crew, injured: this.injured,
      subsystems: this.subsystems, torpedoes: this.torpedoes, antimatter: this.antimatter,
      fires: this.fires, coreEjected: this.coreEjected, mods: this.mods,
      power: this.power.save(),
    };
  }

  static load(data) {
    const s = new Ship(data.classId, { name: data.name, registry: data.registry, faction: data.faction, isPlayer: true });

    // Modifiers first, so the maxima are correct before the saved hull and
    // shield values — which were recorded in that scaled space — are restored.
    if (data.mods) {
      s.mods = { ...s.mods, ...data.mods };
      s.recomputeDerived();
    }

    Object.assign(s, {
      hull: data.hull, shieldsUp: data.shieldsUp ?? true,
      crew: data.crew, injured: data.injured ?? 0,
      torpedoes: data.torpedoes ?? s.torpedoes, antimatter: data.antimatter ?? 100,
      fires: data.fires ?? 0, coreEjected: data.coreEjected ?? false,
    });
    // Shield migration, from four facings to six.
    //
    // A save written before the third axis existed has no dorsal or ventral
    // entry, and its four values were recorded against a per-facing maximum a
    // half larger than the current one. Spreading over the defaults supplies
    // the two new facings at full charge, and the clamp keeps the old four from
    // reading as over-full. An old commission therefore loads as a ship that
    // has been to a starbase, which is the kindest reading available and the
    // only one that cannot produce a shield above its own maximum.
    s.shields = { ...s.shields, ...(data.shields ?? {}) };
    for (const f of FACINGS) {
      s.shields[f] = Math.max(0, Math.min(s.maxShield, s.shields[f] ?? s.maxShield));
    }
    s.subsystems = { ...s.subsystems, ...(data.subsystems ?? {}) };
    s.power = PowerGrid.load(data.power, s.cls.powerCap);
    return s;
  }
}
