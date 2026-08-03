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
  shield_battery: { id: 'shield_battery', slot: 'device', name: 'Shield Battery', consumable: true,
    description: 'Instantly restores 40% shields to all facings.' },
  weapons_battery: { id: 'weapons_battery', slot: 'device', name: 'Weapons Battery', consumable: true,
    description: 'Weapon power to maximum for 20 seconds.' },
  engine_battery: { id: 'engine_battery', slot: 'device', name: 'Engine Battery', consumable: true,
    description: 'Engine power to maximum for 20 seconds.' },
  hull_patch: { id: 'hull_patch', slot: 'device', name: 'Hull Patch Kit', consumable: true,
    description: 'Restores 20% hull and extinguishes all fires.' },
  probe: { id: 'probe', slot: 'device', name: 'Class-IV Probe', consumable: true,
    description: 'Full scan of a system or anomaly without approaching it.' },
};

export const CONSOLE_LIST = Object.values(CONSOLES);

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

  /** Combined modifiers for Ship.applyMods. */
  shipMods() {
    const mods = {};
    for (const id of this.all) {
      const c = CONSOLES[id];
      if (!c?.mods) continue;
      for (const [k, v] of Object.entries(c.mods)) {
        if (ADDITIVE_MODS.has(k)) {
          mods[k] = (mods[k] ?? 0) + v;
        } else {
          mods[k] = (mods[k] ?? 1) * (1 + v);
        }
      }
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

  /** Resize when changing ships. Anything that no longer fits goes to inventory. */
  refitTo(slots) {
    this.slots = { tactical: 0, engineering: 0, science: 0, device: 0, ...slots };
    for (const slot of Object.keys(this.equipped)) {
      while (this.used(slot) > this.capacity(slot)) {
        this.inventory.push(this.equipped[slot].pop());
      }
    }
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
