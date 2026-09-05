// Power distribution — the STO model.
//
// Four subsystems draw from a fixed pool. Each level above/below the 50 nominal
// scales that subsystem's output. Presets are one tap; the sliders underneath
// are the real control, and they're what a captain actually orders.

import { clamp } from '../core/num.js';

export const SUBSYSTEMS = ['weapons', 'shields', 'engines', 'auxiliary'];

export const SUBSYSTEM_LABEL = {
  weapons: 'Weapons',
  shields: 'Shields',
  engines: 'Engines',
  auxiliary: 'Auxiliary',
};

/**
 * What each channel actually buys, in the words an officer would use.
 *
 * Four unlabelled sliders told a captain nothing about what he was trading
 * away, and the Auxiliary one was the worst of them: the parser calls that
 * channel "sensors" and the preset above calls it Science, so the one thing a
 * captain could reasonably infer from the screen was the one thing it did not
 * do. These are read by the power panel and are the screen's half of the
 * contract — if a line here stops being true, the effect it names has moved.
 */
export const SUBSYSTEM_EFFECT = {
  weapons: 'Beam and cannon damage, and how fast the banks recharge.',
  shields: 'How quickly the facings come back after a hit.',
  engines: 'Impulse speed and how hard she turns.',
  auxiliary: 'Sensor resolution, damage control, and fire suppression.',
};

export const PRESETS = {
  balanced: { id: 'balanced', label: 'Balanced', order: 'Standard distribution',
    levels: { weapons: 50, shields: 50, engines: 50, auxiliary: 50 } },
  attack: { id: 'attack', label: 'Attack', order: 'Power to weapons',
    levels: { weapons: 100, shields: 40, engines: 35, auxiliary: 25 } },
  defense: { id: 'defense', label: 'Defense', order: 'Power to shields',
    levels: { weapons: 40, shields: 100, engines: 35, auxiliary: 25 } },
  speed: { id: 'speed', label: 'Speed', order: 'Power to engines',
    levels: { weapons: 35, shields: 40, engines: 100, auxiliary: 25 } },
  science: { id: 'science', label: 'Science', order: 'Power to auxiliary',
    levels: { weapons: 30, shields: 45, engines: 25, auxiliary: 100 } },
};

export const PRESET_LIST = Object.values(PRESETS);

/** A subsystem at `level` performs at this multiple of nominal. */
export function effectiveness(level) {
  // 50 -> 1.0, 100 -> 1.5, 25 -> 0.75, 0 -> 0.4 (never fully dead from power alone)
  if (level >= 50) return 1 + (level - 50) * 0.01;
  return Math.max(0.4, 1 - (50 - level) * 0.012);
}

export class PowerGrid {
  /**
   * @param {number} cap total distributable power (ship's powerCap)
   */
  constructor(cap = 200, auxBonus = 0) {
    this.cap = cap;
    this.auxBonus = Math.max(0, Number(auxBonus) || 0);
    this.levels = { ...PRESETS.balanced.levels };
    this.preset = 'balanced';
    // Rebalancing is not instant — the EPS grid takes a moment to settle.
    this.target = { ...this.levels };
    this.transferRate = 55; // power units per second
    // Balanced is 50 to each of four subsystems, which is 200 — and plenty of
    // hulls have a smaller grid than that. A Bird-of-Prey has a cap of 190, so
    // it was built drawing 200 and was over its own budget from the first tick
    // of its existence, with every `factor()` reading computed off a
    // distribution the ship could not actually supply.
    this.normalize();
    this.levels = { ...this.target };
  }

  get total() {
    return SUBSYSTEMS.reduce((n, s) => n + this.target[s], 0);
  }

  /** Apply a named preset. */
  applyPreset(id) {
    const p = PRESETS[id];
    if (!p) return false;
    this.target = { ...p.levels };
    this.preset = id;
    this.normalize();
    return true;
  }

  /**
   * Set one subsystem, stealing from or giving back to the others so the
   * total stays within cap. This is what "divert power to shields" does.
   */
  set(subsystem, value) {
    if (!SUBSYSTEMS.includes(subsystem)) return false;
    // Rounded after the guard: Math.round(NaN) is NaN, and a NaN power level
    // silently disables the subsystem it was meant to boost.
    this.target[subsystem] = Math.round(clamp(value, 0, 100));
    this.preset = 'custom';
    this.normalize(subsystem);
    return true;
  }

  /** Shift `amount` into a subsystem, drawn evenly from the rest. */
  divert(subsystem, amount = 25) {
    return this.set(subsystem, this.target[subsystem] + amount);
  }

  /** Keep the sum at or under cap by draining the others proportionally. */
  normalize(protectedSub = null) {
    const budget = this.cap;
    let total = this.total;
    if (total <= budget) return;

    let excess = total - budget;
    const donors = SUBSYSTEMS.filter((s) => s !== protectedSub && this.target[s] > 0);
    // Drain proportional to how much each donor has above zero.
    for (let pass = 0; pass < 4 && excess > 0.01; pass++) {
      const pool = donors.reduce((n, s) => n + this.target[s], 0);
      if (pool <= 0) break;
      for (const s of donors) {
        const share = (this.target[s] / pool) * excess;
        const taken = Math.min(this.target[s], share);
        this.target[s] -= taken;
      }
      excess = this.total - budget;
    }
    for (const s of SUBSYSTEMS) this.target[s] = Math.max(0, Math.round(this.target[s]));

    // The protected subsystem is protected from being DRAINED, not exempt from
    // the cap. With the donors emptied and the total still over budget it was
    // simply left there — so after ejecting the warp core, which cuts the cap
    // to 45 per cent, asking for 100 to weapons kept 100 to weapons and the
    // whole point of the ejection penalty went away.
    if (protectedSub && this.total > budget) {
      const others = SUBSYSTEMS.reduce((n, s) => (s === protectedSub ? n : n + this.target[s]), 0);
      this.target[protectedSub] = Math.max(0, Math.round(budget - others));
    }

    // Rounding four numbers up can put the total back over the cap by a couple
    // of points, which is how a grid at 92 of 90 survived a function whose
    // entire job is "keep the sum at or under cap". Shave the largest until it
    // does not.
    let over = this.total - budget;
    while (over > 0) {
      const biggest = SUBSYSTEMS.reduce((a, b) => (this.target[a] >= this.target[b] ? a : b));
      if (this.target[biggest] <= 0) break;
      const take = Math.min(over, this.target[biggest]);
      this.target[biggest] -= take;
      over -= take;
    }
  }

  /** Ease actual levels toward target. Called every sim step. */
  update(dt) {
    for (const s of SUBSYSTEMS) {
      const diff = this.target[s] - this.levels[s];
      if (Math.abs(diff) < 0.01) { this.levels[s] = this.target[s]; continue; }
      const step = Math.sign(diff) * Math.min(Math.abs(diff), this.transferRate * dt);
      this.levels[s] += step;
    }
  }

  /** Effectiveness multiplier for a subsystem right now. */
  factor(subsystem) {
    // `auxBonus` is a dedicated science package, not a bigger grid: three
    // hulls declare it (25, 35, 30) and all three are science ships. It was
    // written on the class and read by nothing, so an Oberth ran her sensors,
    // her damage control and her fire suppression off exactly the same
    // auxiliary any freighter had.
    //
    // It is added HERE rather than to `cap`, because a bigger cap is power the
    // captain could put into the weapons — which is not what a science package
    // is. This is auxiliary the ship has whatever else the grid is doing.
    const bonus = subsystem === 'auxiliary' ? (this.auxBonus ?? 0) : 0;
    return effectiveness((this.levels[subsystem] ?? 50) + bonus);
  }

  /** True once actual levels have caught up with the order. */
  get settled() {
    return SUBSYSTEMS.every((s) => Math.abs(this.target[s] - this.levels[s]) < 0.5);
  }

  save() {
    return { cap: this.cap, levels: this.levels, target: this.target, preset: this.preset };
  }

  static load(data, cap = 200, auxBonus = 0) {
    // `auxBonus` is class data, not saved state — it comes back from the hull
    // rather than the record, so an old save on a science ship still gets it.
    const g = new PowerGrid(data?.cap ?? cap, auxBonus);
    if (data) {
      g.levels = { ...g.levels, ...data.levels };
      g.target = { ...g.target, ...data.target };
      g.preset = data.preset ?? 'custom';
    }
    return g;
  }
}
