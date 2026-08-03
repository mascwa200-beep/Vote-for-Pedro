// Phonetic keys, for orders that are typed the way they sound.
//
// "hale them", "fier phasers", "shealds up", "evasiv manuvers" — none of these
// are in any table and all of them are obviously an order. Two cheap keys catch
// most of it:
//
//   soundex(word)   groups words by consonant sound class
//   skeleton(word)  drops vowels and collapses doubles
//
// Neither is clever. Both are deterministic, allocation-light, and run in a few
// microseconds, which matters because every candidate keyword in the lexicon is
// compared against every token of the order.

const SOUNDEX_CODES = {
  b: '1', f: '1', p: '1', v: '1',
  c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
  d: '3', t: '3',
  l: '4',
  m: '5', n: '5',
  r: '6',
};

/**
 * Standard Soundex: first letter, then three digits for the following
 * consonant sounds, with adjacent duplicates collapsed.
 * @returns {string} e.g. "hail" and "hale" both give "H400"
 */
export function soundex(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return '';

  const first = w[0];
  let out = first.toUpperCase();
  let prev = SOUNDEX_CODES[first] ?? '';

  for (let i = 1; i < w.length && out.length < 4; i++) {
    const ch = w[i];
    const code = SOUNDEX_CODES[ch] ?? '';

    // h and w are transparent: they do not break a run of the same sound.
    if (ch === 'h' || ch === 'w') continue;

    if (code && code !== prev) out += code;

    // Vowels do break a run, so "pepper" keeps both p sounds.
    prev = code || (('aeiouy'.includes(ch)) ? '' : prev);
  }

  return out.padEnd(4, '0');
}

/**
 * Consonant skeleton: the leading letter plus every consonant after it, with
 * doubles collapsed. Coarser than Soundex in some ways and finer in others,
 * which is the point — the two disagree on different mistakes.
 * @returns {string} "shealds" and "shields" both give "SHLDS"
 */
export function skeleton(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return '';

  let out = w[0];
  for (let i = 1; i < w.length; i++) {
    const ch = w[i];
    if ('aeiou'.includes(ch)) continue;
    // Collapse a genuine double letter — "pepper" has one — but not two of the
    // same consonant that were separated by a vowel we have just dropped.
    if (ch === w[i - 1]) continue;
    out += ch;
  }
  return out.toUpperCase();
}

/** First vowel in a word, or '' if it has none. */
function firstVowel(w) {
  for (const ch of w) if ('aeiouy'.includes(ch)) return ch;
  return '';
}

/**
 * Do two words plausibly sound the same?
 *
 * Both keys have to agree, and for short words the first vowel has to match as
 * well. That last condition is load-bearing: both keys throw vowels away, so
 * without it "fire" and "far" are identical, and so are "port" and "part" —
 * different orders, not typos. Short words are dense enough that almost any
 * three or four letters spell something else, while a seven-letter word that
 * survives both keys really is a misspelling of the same word.
 */
export function soundsLike(a, b) {
  if (a === b) return true;
  const wa = String(a).toLowerCase();
  const wb = String(b).toLowerCase();
  if (wa.length < 3 || wb.length < 3) return false;
  if (soundex(wa) !== soundex(wb) || skeleton(wa) !== skeleton(wb)) return false;
  if (Math.max(wa.length, wb.length) >= 6) return true;
  return firstVowel(wa) === firstVowel(wb);
}

/** Precompute both keys once per vocabulary word. */
export function phoneticKey(word) {
  return `${soundex(word)}|${skeleton(word)}`;
}
