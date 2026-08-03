// The parsing pipeline.
//
//   raw text
//     -> normalise (contractions, slang, spelling, filler, addressee)
//     -> extract entities (place, facing, power channel, target system, numbers)
//     -> score every intent (phrases, keywords, phonetics, fuzzy, station)
//     -> fill slots and emit a command, with a confidence
//
// Three outcomes, because pretending to be certain is worse than asking:
//
//   confident      the order executes
//   plausible      "I read that as X — confirm?"
//   lost           the officer asks, and offers the nearest readings
//
// What this is not: it is not a language model, and it does not understand
// English. It recognises orders. The measure of it is tests/lang.test.js, which
// runs a corpus of hand-written paraphrases and reports the hit rate rather than
// asserting the parser is good.

import { normalize } from './normalize.js';
import { similarity } from './fuzzy.js';
import { soundsLike } from './phonetic.js';
import {
  findPlace, findFacing, findPowerChannel, findTargetSystem,
  findFaction, findWarpFactor, findPercent, findBearing,
} from './gazetteer.js';
import { INTENTS, STATION_AFFINITY } from './lexicon.js';

/** Above this, act. Below the lower bound, admit you did not understand. */
export const CONFIDENT = 0.58;
export const PLAUSIBLE = 0.26;

/** What a phonetic or near-miss keyword hit is worth against an exact one. */
const FUZZY_CREDIT = 0.65;

/** Prompts for an intent that was recognised but is missing something. */
const SLOT_PROMPTS = {
  place: 'Which system, Captain?',
  facing: 'Which facing, Captain?',
  powerChannel: 'Power to which system, Captain?',
  targetSystem: 'Target which system, Captain?',
  warp: 'What warp factor, Captain?',
};

/**
 * Pull every entity the lexicon can reference out of a normalised line.
 * Done once per order rather than once per intent, because entity extraction is
 * the expensive half and the answer does not change between intents.
 */
function extract(norm) {
  const { text, tokens } = norm;
  return {
    text,
    tokens,
    station: norm.station,
    urgent: norm.urgent,
    negated: norm.negated,
    place: findPlace(text, tokens),
    facing: findFacing(text, tokens),
    powerChannel: findPowerChannel(text, tokens),
    targetSystem: findTargetSystem(text, tokens),
    faction: findFaction(text, tokens),
    warp: findWarpFactor(text),
    percent: findPercent(text),
    bearing: findBearing(text),
  };
}

/** Whole-word containment: `needle` must sit on word boundaries in `haystack`. */
function hasWord(haystack, needle) {
  const i = haystack.indexOf(needle);
  if (i < 0) return false;
  const before = i === 0 ? ' ' : haystack[i - 1];
  const after = haystack[i + needle.length] ?? ' ';
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
}

/**
 * Score one intent against the extracted order.
 * Returns a raw score; the caller turns the field of scores into a confidence.
 */
function scoreIntent(intent, ctx) {
  // A veto word is a hard no. "hold fire" must never read as "hold position",
  // and no amount of keyword overlap should be able to outvote that.
  //
  // Vetoes are matched phonetically as well as exactly, because a misspelling
  // has to be able to rule an intent out for the same reason it can rule one
  // in: "ceese fire" is not an order to open fire.
  if (intent.veto) {
    for (const v of intent.veto) {
      if (ctx.tokens.includes(v) || hasWord(ctx.text, v)) return 0;
      for (const tok of ctx.tokens) {
        if (tok.length >= 4 && soundsLike(tok, v)) return 0;
      }
    }
  }

  // Some intents are ruled out by an entity rather than a word. "Warp 8 to
  // Vulcan" names a destination, so it is a course order and not a speed order,
  // however much it looks like one.
  for (const slot of intent.vetoSlots ?? []) {
    if (ctx[slot] !== null && ctx[slot] !== undefined) return 0;
  }

  // And some intents cannot exist without one. Calling a department on the
  // intercom requires a department; without one the same words are an ordinary
  // status request. This is a precondition rather than a prompt, because there
  // is nothing sensible to ask.
  const excused = intent.mustHaveUnless?.test(ctx.text) ?? false;
  if (!excused) {
    for (const slot of intent.mustHave ?? []) {
      if (ctx[slot] === null || ctx[slot] === undefined) return 0;
    }
  }

  let score = 0;
  let matchedPhrase = null;

  // Phrases are the strongest signal, and longer phrases are stronger still —
  // "break off the engagement" is far more diagnostic than "break".
  //
  // Matching is on word boundaries, not substrings. Without that, warp_out's
  // "flee" fires on "starfleet command", which is not a request to run away.
  for (const phrase of intent.phrases) {
    if (!hasWord(ctx.text, phrase)) continue;
    const words = phrase.split(' ').length;
    // A one-word "phrase" is really just a keyword and is scored like one, so
    // it cannot outrank a genuine multi-word match.
    const value = words === 1 ? 1.8 : 2.4 + words * 0.55;
    if (value > score) { score = value; matchedPhrase = phrase; }
  }

  // Keywords accumulate. Exact hits pay full weight; a word that merely sounds
  // right or is one typo away pays a discount, which is enough to rescue an
  // order without being enough to invent one. The thresholds below are strict,
  // so the discount is modest — 0.5 was low enough that "ceese fire" scored
  // under the confidence floor and fell through to the table, which opened
  // fire.
  for (const [word, weight] of Object.entries(intent.keywords)) {
    if (ctx.tokens.includes(word)) {
      score += weight;
      continue;
    }
    for (const tok of ctx.tokens) {
      if (tok.length < 4) continue;
      // A misspelling keeps its plural even though normalisation has
      // singularised the correctly spelled word: "shealds" never became
      // "sheald". Comparing the stem as well is what closes that gap.
      const stem = tok.replace(/s$/, '');
      // 0.8 rather than 0.75, because at 0.75 a four-letter word matches
      // anything one edit away — "half" scores 0.8 against "halt", which is
      // the difference between half speed and a full stop.
      if (soundsLike(tok, word) || similarity(tok, word) > 0.8
        || (stem !== tok && (stem === word || soundsLike(stem, word) || similarity(stem, word) > 0.8))) {
        score += weight * FUZZY_CREDIT;
        break;
      }
    }
  }

  if (score <= 0) return 0;

  // Who you addressed breaks ties. "Helm, take us in" is navigation;
  // "Tactical, take us in" is not.
  if (ctx.station && STATION_AFFINITY[ctx.station]?.includes(intent.id)) {
    score += 1.3;
  }

  // Having the entity the intent needs is corroboration that we read it right.
  // Missing it is not fatal — that is what the slot prompt is for — but it does
  // make this intent a weaker explanation of the sentence.
  for (const slot of intent.requires ?? []) {
    if (ctx[slot] !== null && ctx[slot] !== undefined) score += 0.9;
    else score *= 0.5;
  }

  // Soft slots corroborate when present and are never asked about, because the
  // intent has a sensible default. "Go to warp" does not need interrogating
  // about which warp factor; it means go fast.
  for (const slot of intent.soft ?? []) {
    if (ctx[slot] !== null && ctx[slot] !== undefined) score += 0.9;
  }

  return { score, matchedPhrase };
}

/**
 * Parse a line into a command.
 *
 * @param {string} raw
 * @returns {object} one of:
 *   {action, ..., intent, confidence}                    execute it
 *   {confirm: true, order, reading, alternatives}         ask first
 *   {error}                                               understood, incomplete
 *   {unknown: true, suggestions}                          not understood
 */
export function parseText(raw) {
  if (!raw || !String(raw).trim()) return { unknown: true, raw, suggestions: [] };

  const norm = normalize(raw);
  const ctx = extract(norm);

  const ranked = [];
  for (const intent of INTENTS) {
    const r = scoreIntent(intent, ctx);
    if (!r || r.score <= 0) continue;
    ranked.push({ intent, score: r.score, phrase: r.matchedPhrase });
  }
  ranked.sort((a, b) => b.score - a.score);

  // A bare place name is an order. "Vulcan." "DS9." "Take us home." There is
  // no verb to score, and there does not need to be — naming somewhere you are
  // not is unambiguously a request to go there.
  if (ctx.place && (!ranked.length || ranked[0].score < 2.5)) {
    const brief = ctx.tokens.length <= 4 && ctx.place.exact;
    const order = {
      action: 'course',
      system: ctx.place.id,
      warp: ctx.warp ?? 6,
      intent: 'set_course',
      raw,
      confidence: brief ? 0.8 : 0.45,
    };
    if (brief) return order;
    return {
      confirm: true,
      order,
      reading: 'Helm, set course for <system>, warp <n>',
      confidence: order.confidence,
      alternatives: ranked.slice(0, 3).map((r) => ({ id: r.intent.id, help: r.intent.help })),
      raw,
    };
  }

  if (!ranked.length) {
    return { unknown: true, raw, suggestions: suggestFor(ctx) };
  }

  const top = ranked[0];
  const second = ranked[1]?.score ?? 0;
  const confidence = confidenceOf(top.score, second);

  // Recognised, but we are missing something it cannot run without.
  const missing = (top.intent.requires ?? []).find(
    (slot) => ctx[slot] === null || ctx[slot] === undefined,
  );
  if (missing && confidence >= PLAUSIBLE) {
    return {
      error: SLOT_PROMPTS[missing] ?? 'Say again, Captain?',
      intent: top.intent.id,
      missing,
      raw,
    };
  }

  const order = { ...top.intent.build(ctx), intent: top.intent.id, raw, confidence };

  if (confidence >= CONFIDENT) return order;

  if (confidence >= PLAUSIBLE) {
    return {
      confirm: true,
      order,
      reading: top.intent.help,
      confidence,
      alternatives: ranked.slice(1, 4).map((r) => ({ id: r.intent.id, help: r.intent.help })),
      raw,
    };
  }

  return { unknown: true, raw, suggestions: ranked.slice(0, 3).map((r) => r.intent.help) };
}

/**
 * Turn the top two scores into a 0..1 confidence.
 *
 * Two things have to be true before we act without asking: the best reading has
 * to be strong on its own, and it has to be clearly better than the next one. A
 * sentence that scores 8 on two different intents is not understood, however
 * high those numbers look.
 */
function confidenceOf(top, second) {
  const strength = top / (top + 1.6);
  const margin = top > 0 ? (top - second) / top : 1;
  return strength * (0.6 + 0.4 * Math.min(1, margin * 1.8));
}

/**
 * When nothing matched at all, the entities still tell us something. Someone who
 * typed a star system name probably wants to go there.
 */
function suggestFor(ctx) {
  const out = [];
  if (ctx.place) out.push('Helm, set course for <system>, warp <n>');
  if (ctx.targetSystem) out.push('Target their engines / weapons / warp core');
  if (ctx.facing) out.push('Reinforce the forward shields');
  if (!out.length) out.push('Damage report', 'Open a channel', 'Red alert');
  return out.slice(0, 3);
}

export { normalize, extract };
