// Captain progression: rank, experience, and a spendable skill tree.
//
// Skill points buy modifiers that go straight into Ship.mods, so a point in
// Beam Weapons is a real number in the damage formula, not a cosmetic tier.

import { ADDITIVE_MODS } from './ship.js';
import { finite } from '../core/num.js';

export const RANKS = [
  { id: 'ensign', name: 'Ensign', tier: 1, xp: 0, skillPoints: 2 },
  { id: 'lieutenant_jg', name: 'Lieutenant JG', tier: 1, xp: 800, skillPoints: 2 },
  { id: 'lieutenant', name: 'Lieutenant', tier: 2, xp: 2200, skillPoints: 3 },
  { id: 'lt_commander', name: 'Lieutenant Commander', tier: 3, xp: 5000, skillPoints: 3 },
  { id: 'commander', name: 'Commander', tier: 3, xp: 9500, skillPoints: 4 },
  { id: 'captain', name: 'Captain', tier: 4, xp: 17000, skillPoints: 4 },
  { id: 'fleet_captain', name: 'Fleet Captain', tier: 5, xp: 28000, skillPoints: 5 },
  { id: 'commodore', name: 'Commodore', tier: 5, xp: 44000, skillPoints: 5 },
  { id: 'rear_admiral', name: 'Rear Admiral', tier: 6, xp: 66000, skillPoints: 6 },
  { id: 'vice_admiral', name: 'Vice Admiral', tier: 6, xp: 95000, skillPoints: 6 },
  { id: 'admiral', name: 'Admiral', tier: 6, xp: 135000, skillPoints: 8 },
];

/**
 * Skills. `mods` is per rank invested; `max` caps investment.
 * Branch order matters for the tree layout in the UI.
 */
export const SKILLS = {
  // --- Tactical ---
  beam_weapons: { id: 'beam_weapons', branch: 'tactical', name: 'Beam Weapons', max: 5,
    mods: { beamDamage: 0.06 }, description: 'Phaser array output per rank.' },
  cannon_weapons: { id: 'cannon_weapons', branch: 'tactical', name: 'Cannon Weapons', max: 5,
    mods: { cannonDamage: 0.07 }, description: 'Cannon output per rank.' },
  torpedoes: { id: 'torpedoes', branch: 'tactical', name: 'Projectile Weapons', max: 5,
    mods: { torpedoDamage: 0.07 }, description: 'Torpedo yield per rank.' },
  targeting: { id: 'targeting', branch: 'tactical', name: 'Targeting Systems', max: 5,
    mods: { accuracy: 0.03, critChance: 0.012 }, description: 'Accuracy and critical chance.' },
  weapons_training: { id: 'weapons_training', branch: 'tactical', name: 'Weapons Training', max: 3,
    mods: { critSeverity: 0.08 }, description: 'Critical hit severity.' },

  // --- Engineering ---
  hull_plating: { id: 'hull_plating', branch: 'engineering', name: 'Structural Integrity', max: 5,
    mods: { hullMax: 0.05 }, description: 'Maximum hull strength per rank.' },
  damage_resistance: { id: 'damage_resistance', branch: 'engineering', name: 'Hull Plating', max: 5,
    mods: { damageResist: 0.025 }, description: 'Flat damage reduction.' },
  impulse_thrusters: { id: 'impulse_thrusters', branch: 'engineering', name: 'Impulse Thrusters', max: 4,
    mods: { impulse: 0.05, turn: 0.05 }, description: 'Speed and turn rate.' },
  warp_theory: { id: 'warp_theory', branch: 'engineering', name: 'Warp Theory', max: 4,
    mods: {}, special: 'warpEfficiency', description: 'Fuel efficiency and warp travel time.' },
  damage_control: { id: 'damage_control', branch: 'engineering', name: 'Damage Control', max: 4,
    mods: { repairRate: 0.15 }, description: 'Repair speed and fire suppression.' },

  // --- Science ---
  shield_systems: { id: 'shield_systems', branch: 'science', name: 'Shield Systems', max: 5,
    mods: { shieldMax: 0.06 }, description: 'Shield capacity per facing.' },
  shield_regeneration: { id: 'shield_regeneration', branch: 'science', name: 'Shield Regeneration', max: 4,
    mods: { shieldRegen: 0.12 }, description: 'Shield recharge rate.' },
  sensors: { id: 'sensors', branch: 'science', name: 'Sensor Analysis', max: 4,
    mods: { stealthDetect: 0.15 }, special: 'scan', description: 'Cloak detection and scan quality.' },
  countermeasures: { id: 'countermeasures', branch: 'science', name: 'Countermeasures', max: 4,
    mods: { defense: 0.08 }, description: 'Chance incoming fire misses.' },
  exobiology: { id: 'exobiology', branch: 'science', name: 'Exobiology', max: 3,
    mods: {}, special: 'away_science', description: 'Away team science and medical outcomes.' },

  // --- Command ---
  leadership: { id: 'leadership', branch: 'command', name: 'Leadership', max: 4,
    mods: {}, special: 'officer_cooldown', description: 'Bridge officer cooldowns recover faster.' },
  diplomacy: { id: 'diplomacy', branch: 'command', name: 'Diplomacy', max: 5,
    mods: {}, special: 'diplomacy', description: 'Negotiation, hails, and reputation gains.' },
  tactics: { id: 'tactics', branch: 'command', name: 'Fleet Tactics', max: 3,
    mods: { damage: 0.04 }, special: 'ally_bonus', description: 'Your damage, and any allied ships’.' },
  inspiration: { id: 'inspiration', branch: 'command', name: 'Inspiration', max: 3,
    mods: {}, special: 'crew_morale', description: 'Crew survive hits better; officers object less.' },
};

export const SKILL_LIST = Object.values(SKILLS);
export const BRANCHES = ['tactical', 'engineering', 'science', 'command'];

export const BRANCH_LABEL = {
  tactical: 'Tactical', engineering: 'Engineering', science: 'Science', command: 'Command',
};

export class CaptainProgress {
  constructor(data = {}) {
    this.xp = data.xp ?? 0;
    this.rankIndex = data.rankIndex ?? 5; // start at Captain — you command a starship
    this.spent = data.spent ?? {};
    this.unspent = data.unspent ?? 6;
  }

  get rank() { return RANKS[this.rankIndex]; }
  get rankName() { return this.rank.name; }
  get shipTier() { return this.rank.tier; }

  get nextRank() { return RANKS[this.rankIndex + 1] ?? null; }

  /** Progress toward next promotion, 0..1. */
  get rankProgress() {
    const next = this.nextRank;
    if (!next) return 1;
    const floor = this.rank.xp;
    return Math.max(0, Math.min(1, (this.xp - floor) / (next.xp - floor)));
  }

  /**
   * Award experience. Promotion also requires a service record that is not
   * under inquiry — Starfleet does not promote captains it is investigating.
   * @returns {object|null} promotion info
   */
  addXP(amount, { ledger = null } = {}) {
    // Guarded for the same reason the helm orders are: `Math.round(NaN)` is
    // NaN, `xp` is saved, and a poisoned experience total takes the rank
    // ladder and the whole skill economy with it, permanently.
    const gain = Math.max(0, Math.round(finite(amount, 0)));
    this.xp = Math.min(Number.MAX_SAFE_INTEGER, this.xp + gain);
    const next = this.nextRank;
    if (!next || this.xp < next.xp) return null;
    if (ledger?.inquiryOpen) return { blocked: true, reason: 'board of inquiry' };
    this.rankIndex++;
    this.unspent += next.skillPoints;
    return { promoted: true, rank: this.rank, points: next.skillPoints };
  }

  ranksIn(skillId) { return this.spent[skillId] ?? 0; }

  canSpend(skillId) {
    const skill = SKILLS[skillId];
    if (!skill) return false;
    return this.unspent > 0 && this.ranksIn(skillId) < skill.max;
  }

  spend(skillId) {
    if (!this.canSpend(skillId)) return false;
    this.spent[skillId] = this.ranksIn(skillId) + 1;
    this.unspent--;
    return true;
  }

  /** Full refund — available at a starbase, for a price. */
  respec() {
    const refund = Object.values(this.spent).reduce((n, v) => n + v, 0);
    this.spent = {};
    this.unspent += refund;
    return refund;
  }

  /** Roll every invested skill into a mods object for Ship.applyMods. */
  shipMods() {
    const mods = {};
    for (const [id, ranks] of Object.entries(this.spent)) {
      const skill = SKILLS[id];
      if (!skill) continue;
      for (const [k, v] of Object.entries(skill.mods ?? {})) {
        if (ADDITIVE_MODS.has(k)) {
          mods[k] = (mods[k] ?? 0) + v * ranks;
        } else {
          mods[k] = (mods[k] ?? 1) * (1 + v * ranks);
        }
      }
    }
    return mods;
  }

  /** Non-combat effects that other systems query directly. */
  special(name) {
    let total = 0;
    for (const [id, ranks] of Object.entries(this.spent)) {
      if (SKILLS[id]?.special === name) total += ranks;
    }
    return total;
  }

  get diplomacyBonus() { return this.special('diplomacy') * 0.09; }
  get warpEfficiency() { return 1 + this.special('warpEfficiency') * 0.08; }
  get scanBonus() { return this.special('scan') * 0.12; }
  get awayScienceBonus() { return this.special('away_science') * 0.1; }
  get officerCooldownBonus() { return this.special('officer_cooldown') * 0.08; }
  get moraleBonus() { return this.special('crew_morale') * 0.1; }
  get allyBonus() { return this.special('ally_bonus') * 0.06; }

  save() {
    return { xp: this.xp, rankIndex: this.rankIndex, spent: this.spent, unspent: this.unspent };
  }

  static load(data) { return new CaptainProgress(data ?? {}); }
}

/** XP for a combat victory, scaled by what you actually beat. */
export function combatXP(hostiles) {
  return hostiles.reduce(
    (n, s) => n + finite(s.cls?.tier, 1) * 140 + Math.max(0, finite(s.maxHull, 0)) / 20,
    0,
  );
}
