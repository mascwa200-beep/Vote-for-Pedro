// The character sheet is the headline feature, and half of it is not read.
//
// "Your captain is a character sheet." Twelve species, seven origins, seven
// careers, personal traits and feats, each declaring a `mechanic` object. Swept
// by name across the whole of `src/`:
//
//     61 mechanic keys declared
//     29 read by something
//     32 read by NOTHING
//
// The instrument is built and controlled below, because three separate probes
// lied earlier in this work and a clean number is worth nothing until the thing
// producing it has been shown to see a positive case. It classifies six keys
// that are demonstrably consumed as read, and an invented key as dead, and it
// counts BOTH consumption paths: `mechanic('key')` by literal, and the direct
// property reads (`species.mechanic?.critBonus`, `m.advantageOn`) that a
// literal-only sweep would call dead.
//
// The 32 are not all the same thing, which is why this file counts them rather
// than wiring them. §68's lesson, in that file's own words: a sweep whose only
// output is "wire everything you find" is a sweep that will eventually break
// something. At least two kinds are in there —
//
//   leftovers      `saveDisadvantage` and `attackAdvantage` on `reckless`
//                  describe an attack roll and a saving throw. Gameplay no
//                  longer rolls a d20 at all: `rules/resolve.js` replaced it
//                  with a margin, and `rules/dice.js` `save()` has no caller
//                  outside its own file. Those are not unwired features, they
//                  are text describing a design the game moved away from, and
//                  the fix is words rather than code.
//
//   real gaps      `xpRate` and `inquiryImmune`, both wired by the change this
//                  file arrived with, and both covered below.
//
// So the count is a RATCHET. It may go down, by wiring or by honest deletion,
// and it may not go up.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import * as CHARACTER from '../src/rules/character.js';
import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';
import { DIFFICULTIES } from '../src/rules/difficulty.js';

/** Every .js file under src/, as one string. */
function sourceText() {
  let out = '';
  const walk = (d) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      if (n.isDirectory()) walk(`${d}/${n.name}`);
      else if (n.name.endsWith('.js')) out += readFileSync(`${d}/${n.name}`, 'utf8');
    }
  };
  walk('src');
  return out;
}

/** Every `mechanic` key any species, origin, career, trait or feat declares. */
function declared() {
  const keys = new Map();
  for (const [name, val] of Object.entries(CHARACTER)) {
    if (!Array.isArray(val)) continue;
    for (const entry of val) {
      for (const k of Object.keys(entry?.mechanic ?? {})) {
        if (!keys.has(k)) keys.set(k, []);
        keys.get(k).push(`${name}:${entry.id}`);
      }
    }
  }
  return keys;
}

/** Every key something actually consumes, by either path. */
function consumed(src = sourceText()) {
  const out = new Set();
  // `character.mechanic('key')`, the ordinary path.
  for (const m of src.matchAll(/mechanic\??\.?\(\s*['`]([A-Za-z]+)['`]/g)) out.add(m[1]);
  // `species.mechanic?.critBonus` — a direct property read, which a
  // literal-only sweep reports as dead. This is the correction §68 records
  // about its own first draft, applied before making the claim rather than
  // after.
  for (const m of src.matchAll(/mechanic\??\.([A-Za-z]+)/g)) out.add(m[1]);
  // `(m.advantageOn ?? [])` in `hasAdvantageOn` — consumption by iteration.
  for (const m of src.matchAll(/\bm\.([A-Za-z]+)\s*\?\?\s*\[\]/g)) out.add(m[1]);
  return out;
}

describe('the sweep, and the instrument that produced it', () => {
  test('it sees keys that are demonstrably consumed', () => {
    // The positive control. Every one of these has a call site that can be
    // pointed at, so a sweep that misses any of them is measuring nothing.
    const read = consumed();
    for (const k of ['casualtyReduction', 'recoveryRate', 'salvageBonus',
      'coreRecovery', 'critRange', 'critBonus', 'advantageOn']) {
      assert.ok(read.has(k), `the sweep cannot see ${k}, which is read`);
    }
  });

  test('and does not see one that does not exist', () => {
    // The negative control, and the reason the number below is credible.
    assert.equal(consumed().has('thisKeyIsDeclaredByNobodyAtAll'), false);
  });

  test('the ratchet: no more than 32 declared mechanics are read by nothing', () => {
    // It may go down — by wiring one, or by deleting one honestly — and it may
    // not go up. A new trait that declares a mechanic and forgets to wire it
    // fails here rather than shipping as a card that promises something.
    const keys = declared();
    const read = consumed();
    const dead = [...keys.keys()].filter((k) => !read.has(k)).sort();
    assert.ok(keys.size >= 55, `only ${keys.size} mechanics declared; has the sheet shrunk?`);
    assert.ok(dead.length <= 32,
      `${dead.length} declared mechanics are read by nothing:\n  ${dead.join('\n  ')}`);
  });

  test('and the two this change wired are out of that set', () => {
    const read = consumed();
    assert.ok(read.has('xpRate'), 'experience does not scale again');
    assert.ok(read.has('inquiryImmune'), 'the one upside of insubordinate is gone again');
  });
});

const captain = ({ difficulty = 'lieutenant', traits = [], seed = 4n } = {}) => new Game({
  seed, crewMode: 'original', difficulty,
  character: new Character({ speciesId: 'human', careerId: 'command', traits }),
  shipClass: 'constitution',
});

describe('the difficulty card promised XP ×2.6 and granted ×1', () => {
  test('every rung now grants exactly what its own card says', () => {
    // Asserted against the DECLARED rate rather than against a table of
    // expected numbers here, because the point is that the pill and the award
    // are the same number — a second constant in this file could agree with
    // neither.
    for (const d of DIFFICULTIES) {
      const g = captain({ difficulty: d.id });
      const before = g.progress.xp;
      g.awardXP(1000);
      assert.equal(g.progress.xp - before, Math.round(1000 * d.xpRate),
        `${d.id} card says ×${d.xpRate}`);
    }
  });

  test('and it moves the ladder in the direction the table intends', () => {
    // Measured end to end rather than asserted per-award: harder rungs advance
    // faster, which is the compensation for a harder game, and Lieutenant — the
    // rung the table calls "the intended experience, no thumb on the scale
    // either way" — is exactly 1.00.
    const awards = (id) => {
      const g = captain({ difficulty: id });
      let n = 0;
      while (g.progress.nextRank && n < 100000) { g.awardXP(1000); n++; }
      return n;
    };
    const ref = awards('lieutenant');
    assert.ok(ref > 40, `${ref} awards to the top rank`);
    assert.ok(awards('fleet_admiral') < ref * 0.5, 'the top rung does not advance faster');
    assert.ok(awards('story') < ref, 'the gentle rung is a slog');
    // And nothing is free: a rung cannot reach the top on one award.
    for (const d of DIFFICULTIES) assert.ok(awards(d.id) > 20, `${d.id} ranks up too fast`);
  });

  test('and the character sheet multiplies with the rung, not instead of it', () => {
    const plain = captain({ difficulty: 'admiral' });
    const slow = captain({ difficulty: 'admiral', traits: ['insubordinate'] });
    const gain = (g) => { const b = g.progress.xp; g.awardXP(1000); return g.progress.xp - b; };
    const a = gain(plain);
    const b = gain(slow);
    assert.ok(b < a, `${b} against ${a}`);
    assert.equal(b, Math.round(1000 * 2.2 * 0.9), 'the two rates do not compound');
  });

  test('and there is still exactly one door for experience', () => {
    // The wiring point depends on it. `officers.js` says nothing may call
    // `.addXP` outside `Game.awardXP`; if a second caller appears it will
    // silently bypass both rates.
    const src = sourceText();
    const calls = [...src.matchAll(/progress\.addXP\(/g)].length;
    assert.equal(calls, 1, `${calls} places call progress.addXP; the scaling has a hole`);
  });
});

describe('a negative trait whose one upside did not exist', () => {
  // "Start with a reprimand on file and slower promotion — but immune to a
  // board of inquiry." Three mechanics; `startingReprimand` was read, the other
  // two were not. So the trait delivered both penalties and no compensation,
  // and wiring `xpRate: 0.9` without `inquiryImmune` would have made it worse.
  test('the board does not convene on a captain who declares immunity', () => {
    const g = captain({ traits: ['insubordinate'] });
    assert.equal(g.ledger.openInquiry('the loss of a ship'), false);
    assert.equal(g.ledger.inquiryOpen, false);
  });

  test('and it does on one who does not, which is what makes that mean anything', () => {
    const g = captain();
    assert.equal(g.ledger.openInquiry('the loss of a ship'), true);
    assert.equal(g.ledger.inquiryOpen, true);
  });

  test('and an open board still freezes the ladder for everybody else', () => {
    // The cost the immunity is worth having against.
    const g = captain();
    g.ledger.openInquiry('the loss of a ship');
    const promo = g.progress.addXP(500000, { ledger: g.ledger });
    assert.equal(promo?.blocked, true, 'promotion was not held');
  });

  test('and the immunity survives a save and a load', () => {
    // Derived from the character rather than serialised, so this is the test
    // that the derivation happens on BOTH paths.
    const g = captain({ traits: ['insubordinate'] });
    const back = Game.load(JSON.parse(JSON.stringify(g.save())));
    assert.equal(back.ledger.inquiryImmune, true);
    assert.equal(back.ledger.openInquiry('the loss of a ship'), false);
  });
});
