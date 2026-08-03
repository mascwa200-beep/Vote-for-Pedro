// Edit distance, for orders that are typed badly rather than spoken.
//
// Optimised Damerau-Levenshtein with a bounded band: we only ever ask "is this
// within k edits", never "how far apart are these exactly", so the algorithm can
// abandon a row the moment every cell in it exceeds k. On the vocabulary sizes
// here that turns an O(mn) comparison into something closer to O(k·n).

/**
 * Damerau-Levenshtein distance, giving up once it exceeds `max`.
 * @returns {number} the distance, or max + 1 if it is further than max
 */
export function distance(a, b, max = 3) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (!la) return lb;
  if (!lb) return la;

  // Two rolling rows plus the one before them, for transpositions.
  //
  // Rows are pre-filled with an over-budget sentinel rather than left sparse.
  // They must be: the band only computes cells near the diagonal, and the next
  // row reads its neighbours — so an untouched cell has to be a number that
  // loses every comparison. Leaving them undefined poisons the row with NaN,
  // which silently reports every long pair as "too far apart" instead of
  // erroring, and cost this parser every typo in a word of seven letters or
  // more before it was caught.
  const OVER = max + 1;
  let prev2 = null;
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1).fill(OVER);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    const lo = Math.max(1, i - max);
    const hi = Math.min(lb, i + max);

    let best = OVER;
    for (let j = lo; j <= hi; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost,     // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);   // transposition
      }
      curr[j] = v;
      if (v < best) best = v;
    }

    if (best > max) return OVER;

    prev2 = prev;
    prev = curr;
    curr = new Array(lb + 1).fill(OVER);
    curr[0] = i + 1;
  }

  return prev[lb] > max ? OVER : prev[lb];
}

/**
 * Similarity on 0..1, tolerant in proportion to word length.
 * Short words get almost no budget — turning "aft" into "all" is a different
 * order, not a typo — while long ones get up to three edits.
 */
export function similarity(a, b) {
  if (a === b) return 1;
  const len = Math.max(a.length, b.length);
  if (len < 4) return 0;
  const budget = len <= 5 ? 1 : len <= 8 ? 2 : 3;
  const d = distance(a, b, budget);
  if (d > budget) return 0;
  return 1 - d / (len + 1);
}

/**
 * Best match for `word` among `candidates`.
 * @returns {{word: string, score: number}|null}
 */
export function bestMatch(word, candidates, threshold = 0.62) {
  let best = null;
  for (const c of candidates) {
    const s = similarity(word, c);
    if (s >= threshold && (!best || s > best.score)) best = { word: c, score: s };
  }
  return best;
}
