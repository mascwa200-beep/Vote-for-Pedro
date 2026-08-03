// Continuous outcome resolution.
//
// This is what replaced the d20 in gameplay.
//
// The character sheet is still a role-playing character sheet — ability scores,
// proficiency, feats, levels, the whole apparatus in rules/character.js, and
// rules/dice.js is still there to build it. What is gone is rolling a
// twenty-sided die to decide whether an away team gets through a hull breach.
//
// The reason is not that dice are bad. It is that a d20 has a flat
// distribution, which means a competent officer fails a routine task one time
// in twenty no matter how good they are, and the size of the failure carries no
// information. That reads as a board game. What this game wants is the opposite:
// outcomes that come from the situation and the people, where being better makes
// you reliably better, and where the *margin* — how comfortably, how badly —
// is what drives what happens next.
//
// So: capability against difficulty, plus a bounded random swing, giving a
// margin rather than a pass or a fail. Everything downstream reads the margin.
//
// The arithmetic is still fully itemised. Nothing about this is less auditable
// than the die was; the breakdown the player sees is the same list of terms it
// always was, and the only thing that changed is the shape of the uncertainty.

/**
 * What an unmodified attempt is worth before capability is added.
 *
 * This number is not arbitrary and getting it wrong is the trap this file fell
 * into first. Every difficulty number in the game — the hazard table, the
 * mission specs, the difficulty ladder's adjustments — was written against a
 * d20, where the die itself contributes 10.5 on average and the modifier is a
 * comparatively small nudge on top. Replacing the die with a swing centred on
 * zero silently removes that 10.5 from every single check in the game, and
 * turns a routine survey into a near-certain disaster.
 *
 * So the baseline is supplied explicitly, the difficulty numbers keep their
 * tuned values, and the change is confined to the *shape* of the uncertainty
 * rather than its centre.
 */
const BASELINE = 10.5;

/**
 * How wide the random swing is.
 *
 * A d20 has a standard deviation of about 5.77 and, being flat, spends as much
 * time at its extremes as at its middle. This is deliberately a little tighter
 * and normally distributed, so the typical result sits near what the officer is
 * actually capable of. Compared against the die: a competent officer on routine
 * work succeeds a little more often, and — the point of the change — no longer
 * fails catastrophically one time in twenty regardless of how good they are.
 */
const SWING = 5.2;

/** Beyond this many points either way, the outcome is exceptional. */
const EXCEPTIONAL = 7.5;

/** Hard bound on the swing, so nothing is ever truly impossible or certain. */
const MAX_SWING = 13;

/**
 * Resolve one contested outcome.
 *
 * @param {RNG} rng
 * @param {object} opts
 *   capability  the actor's total relevant skill, already itemised by the caller
 *   difficulty  what they are up against, on the same scale
 *   advantage   true to take the better of two swings, false for the worse
 *   steady      0..1; how much the actor's training damps the swing
 *   luck        difficulty-granted nudge in the actor's favour
 * @returns {object} margin, success, degree, and the flags the prose reads
 */
export function resolve(rng, {
  capability = 0, difficulty = 10, advantage = false, disadvantage = false,
  steady = 0, luck = 0, label = '',
} = {}) {
  const draw = () => {
    // A normal draw rather than a uniform one: most attempts land near what the
    // actor is actually capable of, and the extremes are rare rather than
    // evenly likely. This is the whole difference from a d20.
    const raw = rng.normal ? rng.normal(0, 1) : (rng.float() + rng.float() + rng.float() - 1.5) / 0.5;
    return Math.max(-MAX_SWING, Math.min(MAX_SWING, raw * SWING * (1 - 0.35 * steady)));
  };

  let swing = draw();
  if (advantage && !disadvantage) swing = Math.max(swing, draw());
  else if (disadvantage && !advantage) swing = Math.min(swing, draw());

  const margin = BASELINE + capability + swing + luck - difficulty;
  const success = margin >= 0;

  // Degree, on the same scale the old check reported, so callers that branched
  // on it keep working: 0 is a bare pass, 1 a comfortable one, 2 or more a rout.
  const degree = Math.max(0, Math.floor(Math.abs(margin) / 5));

  return {
    label,
    capability,
    difficulty,
    swing: Math.round(swing * 10) / 10,
    margin: Math.round(margin * 10) / 10,
    success,
    degree,
    exceptional: margin >= EXCEPTIONAL,
    disaster: margin <= -EXCEPTIONAL,
    // Named to match what the prose and the consequence table already read.
    criticalSuccess: margin >= EXCEPTIONAL,
    criticalFailure: margin <= -EXCEPTIONAL,
    advantage: advantage && !disadvantage,
    disadvantage: disadvantage && !advantage,
  };
}

/** A one-line summary, for the log. */
export function formatResolution(r, label = r.label) {
  const sign = r.margin >= 0 ? '+' : '';
  const verdict = r.criticalSuccess ? 'decisive'
    : r.criticalFailure ? 'disastrous'
    : r.success ? 'success' : 'failure';
  return `${label}: ${sign}${r.margin.toFixed(1)} — ${verdict}`;
}

/** Plain-language name for a difficulty number, unchanged from the old scale. */
export function describeDifficulty(n) {
  if (n <= 8) return 'routine';
  if (n <= 12) return 'straightforward';
  if (n <= 16) return 'demanding';
  if (n <= 20) return 'severe';
  if (n <= 25) return 'forbidding';
  return 'all but impossible';
}

/**
 * Probability of success given a capability edge — used by the tests to assert
 * the curve is the shape this file claims, rather than trusting the comment.
 */
export function successChance(edge, { steady = 0 } = {}) {
  // `edge` is capability minus difficulty; the baseline is added here so
  // callers reason in the same units the difficulty table is written in.
  const sd = SWING * (1 - 0.35 * steady);
  edge += BASELINE;
  // Normal CDF via an Abramowitz-and-Stegun style erf approximation.
  const z = edge / (sd * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  const erf = z >= 0 ? y : -y;
  return 0.5 * (1 + erf);
}

/**
 * Named difficulty numbers. The same scale the d20 checks used, kept
 * deliberately: the numbers were tuned against real play and there is no reason
 * to re-tune them merely because the distribution around them changed.
 */
export const DIFFICULTY = {
  trivial: 5,
  easy: 10,
  moderate: 13,
  hard: 16,
  formidable: 19,
  heroic: 22,
  impossible: 26,
};

export { SWING, EXCEPTIONAL, BASELINE };
