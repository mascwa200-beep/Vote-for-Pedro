// Numeric guards for the simulation's edges.
//
// The clamps in this game were all written as `Math.max(lo, Math.min(hi, v))`,
// which is correct for every number except the ones that matter: `Math.min(1,
// NaN)` is NaN, and `Math.max(0, NaN)` is NaN. A single bad value therefore
// walked straight through every clamp in the sim and poisoned whatever it
// touched — and NaN is contagious. Once a ship's position is NaN, every
// subsequent update multiplies NaN by a heading and stores NaN back. Nothing
// recovers it: not repair, not warping out, not ending the engagement. It is
// the most complete soft-lock the game can reach, and it is one guard away
// from being impossible.
//
// Fuzzing the parser with 20,000 hostile inputs produced no non-finite values,
// so this is not defending against typed orders. It is defending against saves,
// arithmetic edge cases, and every future caller — the sim should not be one
// bad number away from unusable.

/**
 * Coerce anything to a finite number.
 *
 * NaN, both infinities, and non-numeric values become `fallback`. This is the
 * gate: put it in front of a clamp rather than trusting the clamp.
 *
 * @param {*} v
 * @param {number} fallback  used when `v` is not a finite number
 */
export function finite(v, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Clamp to a range, NaN-safe.
 *
 * A non-finite input lands on `lo` rather than propagating, because every
 * caller here is clamping a quantity where the low end is the safe answer:
 * no throttle, no power, no damage.
 */
export function clamp(v, lo, hi) {
  const n = finite(v, lo);
  return n < lo ? lo : n > hi ? hi : n;
}

/** Wrap a bearing into 0..360, NaN-safe. */
export function wrapDegrees(v) {
  const n = finite(v, 0) % 360;
  return n < 0 ? n + 360 : n;
}
