// Equipment: consoles and devices that occupy the ship's slots.
//
// Consoles are the fine-tuning layer over the skill tree — same modifier
// system, but swappable at a starbase without spending skill points.

import { ADDITIVE_MODS } from './ship.js';

export const CONSOLES = {
  // --- Tactical ---
  phaser_relay: { id: 'phaser_relay', slot: 'tactical', name: 'Phaser Relay', tier: 1,
    mods: { beamDamage: 0.11 }, description: '+11% phaser damage.' },
  torpedo_targeting: { id: 'torpedo_targeting', slot: 'tactical', name: 'Torpedo Targeting Console', tier: 1,
    mods: { torpedoDamage: 0.13 }, description: '+13% torpedo damage.' },
  prefire_chamber: { id: 'prefire_chamber', slot: 'tactical', name: 'Prefire Chamber', tier: 2,
    mods: { critSeverity: 0.15, critChance: 0.02 }, description: 'Harder critical hits.' },
  targeting_scanners: { id: 'targeting_scanners', slot: 'tactical', name: 'Targeting Scanners', tier: 2,
    mods: { accuracy: 0.09 }, description: '+9% accuracy.' },

  // --- Engineering ---
  ablative_armor: { id: 'ablative_armor', slot: 'engineering', name: 'Ablative Armour', tier: 2,
    mods: { damageResist: 0.07 }, description: 'Flat 7% damage reduction.' },
  sif_generator: { id: 'sif_generator', slot: 'engineering', name: 'SIF Generator', tier: 1,
    mods: { hullMax: 0.1 }, description: '+10% maximum hull.' },
  eps_conduits: { id: 'eps_conduits', slot: 'engineering', name: 'EPS Flow Regulator', tier: 1,
    mods: {}, special: 'powerTransfer', value: 30, description: 'Power rebalances much faster.' },
  rcs_thrusters: { id: 'rcs_thrusters', slot: 'engineering', name: 'RCS Accelerators', tier: 1,
    mods: { turn: 0.16 }, description: '+16% turn rate.' },
  emergency_batteries: { id: 'emergency_batteries', slot: 'engineering', name: 'Emergency Power Cells', tier: 2,
    mods: { repairRate: 0.3 }, description: 'Faster damage control.' },

  // --- Science ---
  shield_capacitor: { id: 'shield_capacitor', slot: 'science', name: 'Shield Capacitor', tier: 1,
    mods: { shieldMax: 0.12 }, description: '+12% shield capacity.' },
  shield_emitters: { id: 'shield_emitters', slot: 'science', name: 'Field Emitter Array', tier: 1,
    mods: { shieldRegen: 0.25 }, description: '+25% shield regeneration.' },
  sensor_array: { id: 'sensor_array', slot: 'science', name: 'Multispectral Sensor Array', tier: 2,
    mods: { stealthDetect: 0.4 }, special: 'scan', value: 2, description: 'See cloaked ships sooner.' },
  inertial_dampers: { id: 'inertial_dampers', slot: 'science', name: 'Inertial Dampers', tier: 1,
    mods: { defense: 0.12 }, description: 'Incoming fire misses more often.' },
  biofunction_monitor: { id: 'biofunction_monitor', slot: 'science', name: 'Biofunction Monitor', tier: 2,
    mods: {}, special: 'crewProtect', value: 0.35, description: 'Fewer crew casualties from hull hits.' },

  // --- Devices (consumable, one use per engagement) ---
  // `say` is the phrase that reaches the device from the order line, declared
  // here so the button prints it and a test checks it from ONE source.
  //
  // It is not derivable from the name, which is why it is written down: saying
  // "Hull Patch Kit" reads as the watch bill, and "Class-IV Probe" — like every
  // other wording of the probe — used to be swallowed by `scan`, leaving the
  // one device in the locker you LAUNCH addressable by nothing at all.
  shield_battery: { id: 'shield_battery', slot: 'device', name: 'Shield Battery', consumable: true,
    say: 'shield battery',
    description: 'Instantly restores 40% shields to all facings.' },
  weapons_battery: { id: 'weapons_battery', slot: 'device', name: 'Weapons Battery', consumable: true,
    say: 'weapons battery',
    description: 'Weapon power to maximum for 20 seconds.' },
  engine_battery: { id: 'engine_battery', slot: 'device', name: 'Engine Battery', consumable: true,
    say: 'engine battery',
    description: 'Engine power to maximum for 20 seconds.' },
  hull_patch: { id: 'hull_patch', slot: 'device', name: 'Hull Patch Kit', consumable: true,
    say: 'use a hull patch',
    description: 'Restores 20% hull and extinguishes all fires.' },
  probe: { id: 'probe', slot: 'device', name: 'Class-IV Probe', consumable: true,
    say: 'launch a probe',
    description: 'Full scan of a system or anomaly without approaching it.' },
};

export const CONSOLE_LIST = Object.values(CONSOLES);

/**
 * Equipment that was installed as a package.
 *
 * The fourteen consoles above are a flat list: each has its own modifier and
 * there is no reason to prefer any combination to any other, so fitting the
 * ship is arithmetic rather than a decision. Star Trek Online's answer is the
 * equipment set, and the reason it works there is the reason it works here —
 * real refits came as packages (docs/RESEARCH.md §19).
 *
 * Both of these are grounded in something that was genuinely one installation
 * rather than assembled to fill a grid:
 *
 *   The 2270s refit ran the phasers off the MAIN REACTOR. Power came from the
 *   engines, which is why they cut out on an antimatter imbalance — a weapon
 *   drawing from the warp plant cannot fire while the plant is sick. The
 *   phaser upgrade was not independent of the engine upgrade; it was a
 *   consequence of it.
 *
 *   The navigational deflector was a COMBINED SYSTEM with the ship's main
 *   duotronic sensors, and a Constitution carried two arrays. The emitter, the
 *   sensors and the deflector are one suite, so fitting part of it is fitting
 *   part of a system.
 *
 * Two pieces give a modest bonus, three the full one. What this deliberately
 * does NOT take from STO is the rarity ladder and the upgrade economy: those
 * are a free-to-play game's retention mechanics, and there is no retention to
 * buy here.
 */
export const SETS = {
  refit: {
    id: 'refit', name: 'Refit weapons package',
    pieces: ['prefire_chamber', 'eps_conduits', 'phaser_relay'],
    bonuses: {
      2: { mods: { beamDamage: 0.08 }, text: 'The banks draw from the main reactor: +8% beam damage.' },
      3: { mods: { beamDamage: 0.14, critSeverity: 0.12 }, text: 'Full refit coupling: +14% beam damage and harder criticals.' },
    },
  },
  duotronic: {
    id: 'duotronic', name: 'Duotronic sensor suite',
    pieces: ['shield_emitters', 'sensor_array', 'shield_capacitor'],
    bonuses: {
      2: { mods: { shieldRegen: 0.12 }, text: 'Deflector and sensors on one bus: +12% shield regeneration.' },
      3: { mods: { shieldRegen: 0.2, defense: 0.08 }, text: 'The whole suite: +20% regeneration, and harder to hit.' },
    },
  },
};

export const SET_LIST = Object.values(SETS);

/** Which set a console belongs to, or null. Built once, read often. */
const SET_OF = {};
for (const set of SET_LIST) {
  for (const piece of set.pieces) SET_OF[piece] = set.id;
}
export function setOf(consoleId) { return SET_OF[consoleId] ?? null; }

export class Loadout {
  /** @param {object} slots e.g. { tactical: 3, engineering: 3, science: 2, device: 2 } */
  constructor(slots) {
    this.slots = { tactical: 0, engineering: 0, science: 0, device: 0, ...slots };
    this.equipped = { tactical: [], engineering: [], science: [], device: [] };
    this.inventory = [];
  }

  capacity(slot) { return this.slots[slot] ?? 0; }
  used(slot) { return this.equipped[slot]?.length ?? 0; }
  free(slot) { return this.capacity(slot) - this.used(slot); }

  equip(consoleId) {
    const c = CONSOLES[consoleId];
    if (!c) return false;
    if (this.free(c.slot) <= 0) return false;
    const idx = this.inventory.indexOf(consoleId);
    if (idx === -1) return false;
    this.inventory.splice(idx, 1);
    this.equipped[c.slot].push(consoleId);
    return true;
  }

  unequip(consoleId) {
    const c = CONSOLES[consoleId];
    if (!c) return false;
    const idx = this.equipped[c.slot].indexOf(consoleId);
    if (idx === -1) return false;
    this.equipped[c.slot].splice(idx, 1);
    this.inventory.push(consoleId);
    return true;
  }

  acquire(consoleId, count = 1) {
    for (let i = 0; i < count; i++) this.inventory.push(consoleId);
  }

  /** All equipped console ids, flat. */
  get all() {
    return Object.values(this.equipped).flat();
  }

  /**
   * Which sets are aboard, and how much of each.
   *
   * Counted over EQUIPPED consoles only. A piece sitting in the hold is not
   * wired into anything, which is the whole point of a set being an
   * installation rather than an inventory.
   *
   * @returns {Array<{set, have, bonus}>} — only sets with a live bonus.
   */
  activeSets() {
    // DISTINCT pieces. Three phaser relays are three phaser relays, not a
    // complete refit — a set is three different parts of one installation, and
    // counting copies would make the bonus a reward for owning the same thing
    // three times.
    const seen = new Map();
    for (const id of this.all) {
      const setId = setOf(id);
      if (!setId) continue;
      if (!seen.has(setId)) seen.set(setId, new Set());
      seen.get(setId).add(id);
    }
    const out = [];
    for (const [setId, ids] of seen) {
      const have = ids.size;
      const set = SETS[setId];
      if (!set) continue;
      // The best tier this many pieces earns.
      const tier = Object.keys(set.bonuses)
        .map(Number).filter((n) => have >= n).sort((a, b) => b - a)[0];
      if (tier) out.push({ set, have, bonus: set.bonuses[tier], pieces: tier });
    }
    return out;
  }

  /** Combined modifiers for Ship.applyMods. */
  shipMods() {
    const mods = {};
    const add = (k, v) => {
      if (ADDITIVE_MODS.has(k)) mods[k] = (mods[k] ?? 0) + v;
      else mods[k] = (mods[k] ?? 1) * (1 + v);
    };

    for (const id of this.all) {
      const c = CONSOLES[id];
      if (!c?.mods) continue;
      for (const [k, v] of Object.entries(c.mods)) add(k, v);
    }

    // And what the pieces are worth together. Folded in here rather than at
    // the call site, because `shipMods` is the one place the ship asks what it
    // is carrying — a bonus applied anywhere else would be a second answer to
    // the same question, and the two would drift.
    for (const { bonus } of this.activeSets()) {
      for (const [k, v] of Object.entries(bonus.mods ?? {})) add(k, v);
    }
    return mods;
  }

  /** Sum of a named special across equipped consoles. */
  special(name) {
    let total = 0;
    for (const id of this.all) {
      const c = CONSOLES[id];
      if (c?.special === name) total += c.value ?? 1;
    }
    return total;
  }

  /** Devices are consumed, so they need their own accounting. */
  useDevice(deviceId) {
    const idx = this.equipped.device.indexOf(deviceId);
    if (idx === -1) return false;
    this.equipped.device.splice(idx, 1);
    return true;
  }

  /**
   * Resize when changing ships. Anything that no longer fits goes to inventory.
   *
   * The hull is the only source of slot counts — nothing in the game grants a
   * bay that the class does not have — so this is the one place the two can be
   * reconciled, and every path that puts the captain aboard a different ship
   * has to come through it. Missing it was worth a great deal in both
   * directions: a captain moved from a Constitution to a Constellation kept
   * three tactical consoles firing on a hull with two bays, and a captain
   * promoted to an Excelsior could never fill her third science bay because
   * the loadout still believed it was flying a ship with two.
   *
   * Reports what happened rather than doing it quietly. Losing a console is
   * the sort of thing a captain should be told at the moment it happens, and
   * a bay opening up is the reason to go and look at the ship screen.
   *
   * What comes out when a bay is lost is the LAST thing fitted there. Not a
   * judgement about which console is worth more — there is no honest way to
   * weigh beam damage against shield capacity — but it is at least the rule a
   * captain can predict and undo.
   *
   * @returns {{stowed: string[], gained: Record<string, number>}}
   */
  refitTo(slots) {
    const before = this.slots;
    this.slots = { tactical: 0, engineering: 0, science: 0, device: 0, ...slots };
    const stowed = [];
    const gained = {};
    for (const slot of Object.keys(this.equipped)) {
      while (this.used(slot) > this.capacity(slot)) {
        const out = this.equipped[slot].pop();
        this.inventory.push(out);
        stowed.push(out);
      }
      const more = this.capacity(slot) - (before?.[slot] ?? 0);
      if (more > 0) gained[slot] = more;
    }
    return { stowed, gained };
  }

  save() {
    return { slots: this.slots, equipped: this.equipped, inventory: this.inventory };
  }

  static load(data, slots) {
    const l = new Loadout(data?.slots ?? slots);
    if (data) {
      l.equipped = { tactical: [], engineering: [], science: [], device: [], ...data.equipped };
      l.inventory = data.inventory ?? [];
    }
    // The hull the captain is standing in wins over whatever the save says he
    // had bays for. A save written before changing ships resized the loadout
    // carries the old ship's counts, and loading it would have restored a
    // Constitution's bays aboard a Constellation.
    if (slots) l.refitTo(slots);
    return l;
  }
}

/** Starting kit for a new captain. */
export function startingLoadout(shipClass) {
  const l = new Loadout(shipClass.slots ?? { tactical: 2, engineering: 2, science: 2, device: 2 });
  l.acquire('phaser_relay');
  l.acquire('sif_generator');
  l.acquire('shield_capacitor');
  l.acquire('rcs_thrusters');
  l.acquire('shield_battery', 2);
  l.acquire('hull_patch');
  for (const id of ['phaser_relay', 'sif_generator', 'shield_capacitor', 'rcs_thrusters',
    'shield_battery', 'shield_battery', 'hull_patch']) {
    l.equip(id);
  }
  return l;
}
