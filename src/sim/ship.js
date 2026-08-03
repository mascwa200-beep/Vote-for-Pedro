// A ship in the simulation — player or otherwise.
//
// Shields are four independent facings. Subsystems degrade independently and
// affect what the ship can actually do. Crew is a resource that dies.

import { PowerGrid } from './power.js';
import { getShipClass, FEDERATION_REGISTRIES } from '../world/ships.data.js';

export const FACINGS = ['fore', 'aft', 'port', 'starboard'];

export const FACING_LABEL = {
  fore: 'Forward', aft: 'Aft', port: 'Port', starboard: 'Starboard',
};

/** Modifiers that add rather than multiply. */
export const ADDITIVE_MODS = new Set(['critChance', 'critSeverity', 'damageResist', 'crewProtect']);

export const SUBSYSTEM_KEYS = ['weapons', 'shields', 'engines', 'auxiliary', 'warpcore', 'sensors', 'lifesupport'];

/** Bearing (deg, 0 = dead ahead) to the shield facing that covers it. */
export function facingForBearing(bearing) {
  let b = ((bearing % 360) + 360) % 360;
  if (b > 180) b -= 360;              // normalise to -180..180
  if (b >= -45 && b <= 45) return 'fore';
  if (b > 45 && b < 135) return 'starboard';
  if (b < -45 && b > -135) return 'port';
  return 'aft';
}

/** Is `bearing` inside a weapon's firing arc? */
export function inArc(bearing, weapon) {
  let rel = bearing - (weapon.facing ?? 0);
  rel = ((rel % 360) + 360) % 360;
  if (rel > 180) rel -= 360;
  return Math.abs(rel) <= (weapon.degrees ?? 360) / 2;
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
    this.maxShield = cls.shields / 4;          // per facing
    this.shields = Object.fromEntries(FACINGS.map((f) => [f, this.maxShield]));
    this.shieldRegen = cls.shieldRegen / 4;    // per facing per second
    this.shieldsUp = true;

    // ---- crew ----
    this.maxCrew = cls.crew;
    this.crew = cls.crew;
    this.injured = 0;

    // ---- movement ----
    this.x = 0; this.y = 0;
    this.heading = 0;              // degrees, 0 = +x
    this.throttle = 0;             // 0..1 of impulse
    this.desiredHeading = 0;
    this.velocity = { x: 0, y: 0 };

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
    this.maxShield = (this.cls.shields / 4) * this.mods.shieldMax;

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
    return this.maxShield > 0 ? total / (this.maxShield * 4) : 0;
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

  /** Bearing from this ship to a point, relative to current heading. */
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

  distanceTo(target) {
    return Math.hypot(target.x - this.x, target.y - this.y);
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

    // Movement.
    let diff = this.desiredHeading - this.heading;
    diff = ((diff % 360) + 360) % 360;
    if (diff > 180) diff -= 360;
    const maxTurn = this.turnRate * dt;
    this.heading += Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;
    this.heading = ((this.heading % 360) + 360) % 360;

    const speed = this.maxSpeed * this.throttle;
    const rad = this.heading * Math.PI / 180;
    this.velocity.x = Math.cos(rad) * speed;
    this.velocity.y = Math.sin(rad) * speed;
    this.x += this.velocity.x * dt;
    this.y += this.velocity.y * dt;

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
  takeDamage(amount, { bearing = 0, type = 'energy', shieldPiercing = 0, rng = null, subsystem = null } = {}) {
    if (this.destroyed) return { shieldDamage: 0, hullDamage: 0, facing: 'fore', penetrated: false, crewKilled: 0 };

    const facing = facingForBearing(bearing);
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

    this.hull -= hullDamage;

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

  /** Emergency shield reinforcement to one facing, taken from the others. */
  reinforceShield(facing, fraction = 0.35) {
    if (!FACINGS.includes(facing)) return false;
    const others = FACINGS.filter((f) => f !== facing);
    let pooled = 0;
    for (const f of others) {
      const take = this.shields[f] * fraction;
      this.shields[f] -= take;
      pooled += take;
    }
    this.shields[facing] = Math.min(this.maxShield * 1.2, this.shields[facing] + pooled);
    return true;
  }

  repair(amount) {
    this.hull = Math.min(this.maxHull, this.hull + amount);
    for (const k of SUBSYSTEM_KEYS) {
      this.subsystems[k] = Math.min(1, this.subsystems[k] + amount / this.maxHull);
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
    s.shields = { ...s.shields, ...(data.shields ?? {}) };
    s.subsystems = { ...s.subsystems, ...(data.subsystems ?? {}) };
    s.power = PowerGrid.load(data.power, s.cls.powerCap);
    return s;
  }
}
