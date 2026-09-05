// Difficulty, named up the Starfleet command ladder.
//
// These are not damage-slider presets. Each rung changes what the game is
// willing to do to you: whether officers can die permanently, whether saves
// can be reloaded, how hard the dice are, and how much the galaxy pushes back.
//
// -------------------------------------------------------------------------
// SIX KNOBS THIS TABLE DECLARED AND THE GAME DID NOT READ
//
// Swept by name across `src/`, counting the accessors in this file as readers
// — the first version of the sweep excluded this file and reported eight,
// because `enemyMods()` and `playerMods()` live here and read four of them.
//
// Two are now wired:
//
//   fuelUse        0.6 -> 2.2. Threaded into `plotTransit` as its own scale,
//                  NOT folded into `efficiency`: efficiency also divides
//                  `travelHours`, so that would have made the top rungs
//                  slower as well as thirstier.
//   resourceRate   1.5 -> 0.35. Survey yields and salvage hauls, floored at
//                  one unit so a successful survey never returns nothing.
//
// Three are DELETED, each for a different reason, and the reasons are the
// point — a sweep whose only output is "wire everything you find" will
// eventually break something:
//
//   hazardScale    0.4 -> 2.7, and a DUPLICATE. `crewLossScale` spans 0.3 to
//                  2.7 and is already multiplied into both the death and the
//                  injury chance in away.js, at exactly the line hazardScale
//                  would have attached to. Wiring both would have multiplied
//                  casualties by 7.3 at Fleet Admiral while looking like two
//                  reasonable numbers.
//   autoSave       `true` on all twelve rungs. A constant dressed as a
//                  setting; there is no difficulty at which it differs.
//   advantageOn-   true on Story alone — which already carries `luck: 2`, two
//   FirstFail      rerolls, wired and strictly more generous. The freebie was
//                  already granted by a knob that works.
//
// And one was KEPT, unread, on purpose — and has since been wired:
//
//   allowReload    false from Commodore up, with a getter on the class and no
//                  caller. "Saves cannot be reloaded at the top five rungs" is
//                  a real policy and a real promise, and enforcing it meant
//                  changing what the load screen offers — a change about the
//                  save system, not about this table. It was left declared and
//                  exposed so the next sweep would find the promise rather
//                  than quietly lose it. The next sweep found it: importing a
//                  record that would rewind the commission is now refused at
//                  those five rungs, and the difficulty card says so both ways
//                  beside permadeath and ship loss. `ironman` went with it —
//                  it named that combination and duplicated it.
// -------------------------------------------------------------------------
//
// Naming note: this is the real commissioned-officer progression — Cadet,
// Ensign, Lieutenant, Lieutenant Commander, Commander, Captain, Commodore,
// Rear Admiral, Vice Admiral, Admiral, Fleet Admiral. Story sits below all of
// it for players who want the episodes without the arithmetic. The difficulty
// name is separate from your character's rank; the UI keeps them distinct.

export const DIFFICULTIES = [
  {
    id: 'story', name: 'Story', order: 0,
    insignia: '—',
    tagline: 'The episodes, without the arithmetic.',
    description:
      'Nothing is permanently lost. Officers who fall are back next episode, the ship cannot be destroyed, '
      + 'and the dice are weighted your way. Play it for the voyage.',
    // --- combat ---
    enemyDamage: 0.45, enemyHull: 0.65, enemyCount: 0.7, enemyAccuracy: 0.75,
    playerDamage: 1.35, shieldRegen: 1.6, repairRate: 1.8,
    // --- dice ---
    dcShift: -3, luck: 2,
    // --- stakes ---
    permadeath: false, shipLoss: false, crewLossScale: 0.3,
    // --- economy ---
    xpRate: 1.25, fuelUse: 0.6, resourceRate: 1.5,
    // --- systems ---
    allowReload: true,
  },
  {
    id: 'cadet', name: 'Cadet', order: 1,
    insignia: '○',
    tagline: 'The Academy simulator. Mistakes are survivable.',
    description:
      'Officers can be wounded but not killed. The ship can be crippled but not lost. '
      + 'A good place to learn what the power grid actually does.',
    enemyDamage: 0.62, enemyHull: 0.78, enemyCount: 0.85, enemyAccuracy: 0.85,
    playerDamage: 1.2, shieldRegen: 1.3, repairRate: 1.4,
    dcShift: -2, luck: 1,
    permadeath: false, shipLoss: false, crewLossScale: 0.5,
    xpRate: 1.15, fuelUse: 0.75, resourceRate: 1.3,
    allowReload: true,
  },
  {
    id: 'ensign', name: 'Ensign', order: 2,
    insignia: '●',
    tagline: 'Your first posting. The universe starts keeping score.',
    description:
      'Officers can die. The ship can be lost. Everything is still tilted slightly in your favour, '
      + 'because you are new and everyone knows it.',
    enemyDamage: 0.8, enemyHull: 0.9, enemyCount: 1.0, enemyAccuracy: 0.93,
    playerDamage: 1.08, shieldRegen: 1.1, repairRate: 1.15,
    dcShift: -1, luck: 0,
    permadeath: true, shipLoss: true, crewLossScale: 0.8,
    xpRate: 1.05, fuelUse: 0.9, resourceRate: 1.1,
    allowReload: true,
  },
  {
    id: 'lieutenant', name: 'Lieutenant', order: 3,
    insignia: '●●',
    tagline: 'The intended experience.',
    description:
      'No thumb on the scale in either direction. This is the game as designed: '
      + 'fair dice, real losses, and a galaxy that does not care how your week is going.',
    enemyDamage: 1.0, enemyHull: 1.0, enemyCount: 1.0, enemyAccuracy: 1.0,
    playerDamage: 1.0, shieldRegen: 1.0, repairRate: 1.0,
    dcShift: 0, luck: 0,
    permadeath: true, shipLoss: true, crewLossScale: 1.0,
    xpRate: 1.0, fuelUse: 1.0, resourceRate: 1.0,
    allowReload: true,
  },
  {
    id: 'lt_commander', name: 'Lieutenant Commander', order: 4,
    insignia: '●●◐',
    tagline: 'Second officer. You are expected to know better.',
    description:
      'Enemies field more hulls and shoot straighter. Antimatter runs down faster, '
      + 'and the difference between a good power routing and a lazy one starts to show.',
    enemyDamage: 1.04, enemyHull: 1.03, enemyCount: 1.05, enemyAccuracy: 1.02,
    playerDamage: 1.0, shieldRegen: 0.9, repairRate: 0.9,
    dcShift: 1, luck: 0,
    permadeath: true, shipLoss: true, crewLossScale: 1.15,
    xpRate: 1.1, fuelUse: 1.15, resourceRate: 0.9,
    allowReload: true,
  },
  {
    id: 'commander', name: 'Commander', order: 5,
    insignia: '●●●',
    tagline: 'Executive officer. The margins get thin.',
    description:
      'Wolf packs instead of single raiders. Repairs take longer than the next engagement gives you. '
      + 'Away missions start costing people.',
    enemyDamage: 1.08, enemyHull: 1.06, enemyCount: 1.15, enemyAccuracy: 1.04,
    playerDamage: 0.99, shieldRegen: 0.85, repairRate: 0.8,
    dcShift: 2, luck: 0,
    permadeath: true, shipLoss: true, crewLossScale: 1.3,
    xpRate: 1.2, fuelUse: 1.25, resourceRate: 0.8,
    allowReload: true,
  },
  {
    id: 'captain', name: 'Captain', order: 6,
    insignia: '●●●●',
    tagline: 'The chair. Every decision is yours and so is every casualty.',
    description:
      'The galaxy fights properly. Enemy captains use their doctrines well, hazards bite, '
      + 'and there is no comfortable route through a contested sector.',
    enemyDamage: 1.12, enemyHull: 1.09, enemyCount: 1.25, enemyAccuracy: 1.06,
    playerDamage: 0.99, shieldRegen: 0.8, repairRate: 0.72,
    dcShift: 3, luck: 0,
    permadeath: true, shipLoss: true, crewLossScale: 1.5,
    xpRate: 1.35, fuelUse: 1.35, resourceRate: 0.72,
    allowReload: true,
  },
  {
    id: 'commodore', name: 'Commodore', order: 7,
    insignia: '★',
    tagline: 'Flag rank. Losses are now statistics you signed for.',
    description:
      'Autosave only — the record stands as written. Enemy formations are heavier than your hull '
      + 'was designed for, and resupply is a luxury.',
    enemyDamage: 1.16, enemyHull: 1.12, enemyCount: 1.4, enemyAccuracy: 1.08,
    playerDamage: 0.98, shieldRegen: 0.72, repairRate: 0.62,
    dcShift: 4, luck: 0,
    permadeath: true, shipLoss: true, crewLossScale: 1.7,
    xpRate: 1.5, fuelUse: 1.5, resourceRate: 0.62,
    allowReload: false,
  },
  {
    id: 'rear_admiral', name: 'Rear Admiral', order: 8,
    insignia: '★★',
    tagline: 'You are the reinforcements. Nobody is coming for you.',
    description:
      'One ship against numbers written for a task force. Any single opponent is still beatable; '
      + 'they simply stop arriving one at a time.',
    enemyDamage: 1.2, enemyHull: 1.15, enemyCount: 1.55, enemyAccuracy: 1.1,
    playerDamage: 0.98, shieldRegen: 0.65, repairRate: 0.55,
    dcShift: 5, luck: 0,
    permadeath: true, shipLoss: true, crewLossScale: 1.9,
    xpRate: 1.7, fuelUse: 1.65, resourceRate: 0.55,
    allowReload: false,
  },
  {
    id: 'vice_admiral', name: 'Vice Admiral', order: 9,
    insignia: '★★★',
    tagline: 'Attrition. The only question is what you accomplish first.',
    description:
      'Hostiles arrive in packs, coordinate, and do not break off. Repairs barely keep pace with the last '
      + 'engagement. Plan the war, not the battle.',
    enemyDamage: 1.24, enemyHull: 1.18, enemyCount: 1.7, enemyAccuracy: 1.12,
    playerDamage: 0.97, shieldRegen: 0.58, repairRate: 0.48,
    dcShift: 6, luck: 0,
    permadeath: true, shipLoss: true, crewLossScale: 2.1,
    xpRate: 1.9, fuelUse: 1.8, resourceRate: 0.48,
    allowReload: false,
    enemyRelentless: true,
  },
  {
    id: 'admiral', name: 'Admiral', order: 10,
    insignia: '★★★★',
    tagline: 'The no-win scenario, offered sincerely.',
    description:
      'You are always outnumbered and usually outgunned. Every away mission can take someone. '
      + 'The record is what survives, not the ship.',
    enemyDamage: 1.28, enemyHull: 1.21, enemyCount: 1.85, enemyAccuracy: 1.14,
    playerDamage: 0.97, shieldRegen: 0.5, repairRate: 0.4,
    dcShift: 7, luck: 0,
    permadeath: true, shipLoss: true, crewLossScale: 2.4,
    xpRate: 2.2, fuelUse: 2.0, resourceRate: 0.4,
    allowReload: false,
    enemyRelentless: true,
  },
  {
    id: 'fleet_admiral', name: 'Fleet Admiral', order: 11,
    insignia: '★★★★★',
    tagline: 'One command. One record. No second chances.',
    description:
      'Ironman. If the ship is lost, the commission is over and the record closes where it closes. '
      + 'There is no reload, because there is nothing to reload to.',
    enemyDamage: 1.32, enemyHull: 1.24, enemyCount: 2.0, enemyAccuracy: 1.16,
    playerDamage: 0.96, shieldRegen: 0.45, repairRate: 0.35,
    dcShift: 8, luck: 0,
    permadeath: true, shipLoss: true, crewLossScale: 2.7,
    xpRate: 2.6, fuelUse: 2.2, resourceRate: 0.35,
    allowReload: false,
    enemyRelentless: true,
  },
];

/**
 * Ironman: permanent losses, a ship that can be lost, and no reloading.
 *
 * DERIVED rather than declared. `ironman: true` was a field on Fleet Admiral
 * and nothing else, with exactly one reader — a red pill on the difficulty
 * card — and Fleet Admiral's actual save-and-death rules are identical to the
 * four rungs below it. So the top card claimed a distinction the table does not
 * make, which is §68's `autoSave` again: a flag that duplicates something
 * already expressed.
 *
 * Now it is the NAME for the combination, and it is true wherever the
 * combination is true — Commodore up, which is exactly the five rungs that
 * declare `allowReload: false`.
 */
export const isIronman = (def) =>
  !!(def?.permadeath && def?.shipLoss && def?.allowReload === false);

export const DIFFICULTY_BY_ID = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d]));

export const DEFAULT_DIFFICULTY = 'lieutenant';

export function getDifficulty(id) {
  return DIFFICULTY_BY_ID[id] ?? DIFFICULTY_BY_ID[DEFAULT_DIFFICULTY];
}

/**
 * Difficulty is read constantly by combat, dice, and the economy, so it is
 * wrapped rather than passed around as a bare object.
 */
export class DifficultySettings {
  constructor(id = DEFAULT_DIFFICULTY) {
    this.id = id;
    this.def = getDifficulty(id);
  }

  get name() { return this.def.name; }
  get insignia() { return this.def.insignia; }
  get order() { return this.def.order; }
  get ironman() { return isIronman(this.def); }
  get permadeath() { return !!this.def.permadeath; }
  get allowReload() { return !!this.def.allowReload; }

  /** Multiplier lookup with a safe default, so a missing key never yields NaN. */
  scale(key, fallback = 1) {
    const v = this.def[key];
    return typeof v === 'number' ? v : fallback;
  }

  /** Adjust a DC for the current difficulty. Story makes checks easier. */
  dc(base) {
    return Math.max(3, base + (this.def.dcShift ?? 0));
  }

  /** Free rerolls of a natural 1, granted only at the lowest rungs. */
  get luck() { return this.def.luck ?? 0; }

  /** Modifiers handed to a newly built enemy ship. */
  enemyMods() {
    return {
      damage: this.scale('enemyDamage'),
      hullMax: this.scale('enemyHull'),
      accuracy: this.scale('enemyAccuracy'),
    };
  }

  /** Modifiers handed to the player's ship on top of skills and consoles. */
  playerMods() {
    return {
      damage: this.scale('playerDamage'),
      shieldRegen: this.scale('shieldRegen'),
      repairRate: this.scale('repairRate'),
    };
  }

  /**
   * How many hostiles to field where the encounter asks for `n`.
   *
   * Floored rather than rounded, with a small bias: the intent is that
   * *patrols* get bigger up the ladder, not that every lone raider arrives
   * with a friend. A single contact stays single until the very top, while a
   * three-ship patrol grows steadily.
   */
  enemyCount(n) {
    return Math.max(1, Math.floor(n * this.scale('enemyCount') + 0.35));
  }

  save() { return { id: this.id }; }

  static load(data) {
    return new DifficultySettings(data?.id ?? DEFAULT_DIFFICULTY);
  }
}
