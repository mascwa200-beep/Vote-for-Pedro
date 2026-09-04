// What the tactical officer says when the shooting is about to start.
//
// Played through the encounter generator with the balance suite's own pilot — a
// Constitution, thirty-three hostile encounters out of four hundred rolls — the
// distribution of outcomes was not a curve. It was two piles:
//
//     Cardassian patrol   10 of 10 encounters lost the ship
//     Borg                 5 of  5 lost the ship
//     Klingon patrol       4 of  7 lost the ship
//     Ferengi              3 of  4 never took the hull below 90%
//     Orion, independent   never took the hull below 99%
//
// A fight is either nothing or it is fatal, and the captain finds out which by
// having it. That is the gap this closes. The game already intends outnumbered
// fights to be broken off rather than won — `beginWarpOut` exists, the balance
// suite asserts it works, and the difficulty ladder's main lever is enemy COUNT
// — and it never told anybody which fights those were.
//
// Nothing here changes a battle. It reads the ships and says what the bridge
// would say.

import { SHIP_CLASSES } from '../world/ships.data.js';

/**
 * Sustained damage a ship can put out, per second, on paper.
 *
 * Every weapon it carries, ignoring arcs and range: this is an assessment made
 * from a sensor return before a shot is fired, not a firing solution. A
 * tactical officer counting an opponent's guns counts all of them.
 */
export const outputOf = (ship) => (ship?.weapons ?? [])
  .reduce((n, w) => n + w.damage / Math.max(0.1, w.cycle), 0);

/**
 * What a ship can absorb: hull, plus six facings of shield.
 *
 * Discounted, because you never get the value of all six — a ship under fire
 * presents two or three of them and the rest go unused. 0.8 of the nominal
 * total is what the simulated fights bear out.
 */
export const enduranceOf = (ship) => (ship?.maxHull ?? 0) + (ship?.maxShield ?? 0) * 6 * 0.8;

/**
 * A side's fighting power: what it shoots with, times what it can take.
 *
 * Lanchester's square law for aimed fire, which is the right shape for this: two
 * identical ships are not twice one ship, they are four times one ship, because
 * they do twice the damage for twice as long. That is exactly the cliff the
 * measurements found — one Galor takes a Constitution to 83% hull and two of
 * them kill it every single time.
 */
export const powerOf = (ships) => {
  const live = (ships ?? []).filter((s) => s && !s.destroyed && !s.withdrawn);
  if (!live.length) return 0;
  return live.reduce((n, s) => n + outputOf(s), 0) * live.reduce((n, s) => n + enduranceOf(s), 0);
};

/**
 * The same arithmetic on a class rather than a hull, so a force can be costed
 * before it is built.
 *
 * Read straight off `SHIP_CLASSES` — `maxHull` is `cls.hull` and `maxShield` is
 * `cls.shields / 6`, so `enduranceOf`'s six facings come back to `cls.shields`
 * exactly. No `Ship` is constructed, which keeps this module out of a cycle and
 * makes costing a fleet free.
 */
const classStats = (classId) => {
  const cls = SHIP_CLASSES[classId];
  if (!cls) return { output: 0, endurance: 0 };
  return {
    output: outputOf(cls),
    endurance: enduranceOf({ maxHull: cls.hull ?? 0, maxShield: (cls.shields ?? 0) / 6 }),
  };
};

/**
 * A class's fighting power, in Constitutions.
 *
 * The unit is the ship of the line the game is named around, so the numbers in
 * the tables read as something: a Bird-of-Prey is 0.41 of a Constitution, a
 * Negh'Var is 4.6 of one, an Orion raider is 0.09 of one. That last number is
 * the whole point — the raider's own description says "dangerous in threes,
 * worthless alone", and until now the generator only ever fielded one or two.
 */
export const classPower = (classId) => {
  const { output, endurance } = classStats(classId);
  const unit = classStats('constitution');
  return (output * endurance) / (unit.output * unit.endurance);
};

/**
 * What a list of classes is worth together, under the same square law.
 *
 * Not the sum of `classPower` — that is the point of the law. Three Orion
 * raiders are worth 0.8 of a Constitution, not 0.27, which is why three of them
 * is a fight and one of them is an errand.
 */
export const forcePower = (classIds) => {
  const stats = (classIds ?? []).map(classStats);
  const unit = classStats('constitution');
  return (stats.reduce((n, s) => n + s.output, 0) * stats.reduce((n, s) => n + s.endurance, 0))
    / (unit.output * unit.endurance);
};

/**
 * A live hull's power, in the same Constitutions.
 *
 * `classPower` costs a class off the table; this costs the ship that actually
 * exists, refits, damage mods and all. What a defence force sees on its
 * long-range sensors when it decides how many ships to send.
 */
export const shipPower = (ship) => {
  const unit = classStats('constitution');
  return powerOf([ship]) / (unit.output * unit.endurance);
};

/**
 * The bands, and the numbers behind them.
 *
 * Twenty-four matchups, ten battles each, flown by the pilot the balance suite
 * uses — which does not disengage, use an officer's ability, or call a shot, so
 * a real captain has headroom above every row:
 *
 *     ratio   matchup                              lost    lowest hull
 *     11.9    Constitution v Orion raider           0/10      100%
 *      2.7    Constitution v Bird-of-Prey           0/10       98%
 *      1.45   Constitution v Galor                  0/10       83%
 *      1.12   Constitution v D7                     0/10       74%
 *      0.74   Galaxy v three K't'ingas              0/10       47%
 *      0.67   Constitution v D'deridex              0/10       57%
 *      0.37   Sovereign v Borg cube                10/10        0%
 *      0.36   Constitution v two Galors            10/10        0%
 *      0.28   Constitution v two D7s               10/10        0%
 *
 * Every fight that was always lost is below 0.4 and every fight that was never
 * lost is above it, on both sides of a boundary nothing was tuned to.
 */
const BANDS = [
  {
    id: 'nocontest', min: 3,
    label: 'no contest',
    line: 'They are outclassed, Captain. This will not take long.',
  },
  {
    id: 'favourable', min: 1.5,
    label: 'favourable',
    line: 'We have the advantage.',
  },
  {
    id: 'even', min: 0.8,
    label: 'even',
    line: 'An even match, Captain. It will cost us something.',
  },
  {
    id: 'dangerous', min: 0.4,
    label: 'dangerous',
    line: 'They have the advantage. We can take them, but not cheaply.',
  },
  {
    id: 'hopeless', min: 0,
    label: 'outmatched',
    // The one line that is advice rather than a reading, because it is the one
    // case where the game has an answer the captain may not know it has.
    line: 'We are outmatched. Recommend we break off before they close.',
  },
];

/**
 * Weigh the two sides of a fight.
 *
 * @returns {{ratio, band, label, line, ours, theirs}}
 */
export function assessEngagement({ player, allies = [], hostiles = [] } = {}) {
  const ours = powerOf([player, ...allies]);
  const theirs = powerOf(hostiles);
  // Nobody to fight is not a walkover, it is not a fight. Callers that ask
  // before the hostiles are placed used to get Infinity and a cheerful line
  // about how short this would be.
  if (!theirs || !ours) return null;
  const ratio = ours / theirs;
  const band = BANDS.find((b) => ratio >= b.min) ?? BANDS[BANDS.length - 1];
  return { ratio, band: band.id, label: band.label, line: band.line, ours, theirs };
}

/** The band ids, in order from best to worst. Exported so a test can hold them. */
export const ASSESSMENT_BANDS = BANDS.map((b) => b.id);
