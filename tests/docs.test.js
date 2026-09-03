// The documentation, checked against the game.
//
// Two documents make claims about the code. Nothing read either of them until
// this file existed, and both had drifted:
//
//   docs/MANUAL.md said `"engineering, report"` and tapping Engineering were
//   "the same code path". The phrase parses to `status`. It had been wrong for
//   as long as the sentence existed, and a fix to the chair in #91 moved the
//   button without moving the manual.
//
//   README.md stated eleven content counts. Six were stale — the lexicon had
//   nearly tripled, the galaxy had grown three systems, and the test count was
//   off by a factor of four.
//
// The shape here is the one that closed the button-phrase class: read the claim
// out of the document, compare it against the live data, and assert the scrape
// found something before believing what it says. A scrape that matches nothing
// passes every assertion under it — that has happened twice in this project.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Game } from '../src/core/state.js';
import { parseOrder } from '../src/ui/orders.js';
import { SYSTEMS } from '../src/world/systems.data.js';
import { SHIP_LIST } from '../src/world/ships.data.js';
import { EPISODES } from '../src/missions/episodes/index.js';
import { PLAYER_SPECIES } from '../src/rules/character.js';
import { DIFFICULTIES } from '../src/rules/difficulty.js';
import { TRACK_LIST } from '../src/rules/reputation.js';
import { CUES } from '../src/audio/sfx.js';
import { INTENTS, phraseCount } from '../src/lang/lexicon.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const README = readFileSync(join(HERE, '..', 'README.md'), 'utf8');
const MANUAL = readFileSync(join(HERE, '..', 'docs', 'MANUAL.md'), 'utf8');

/** Non-blank, non-comment corpus lines — the same filter the corpus test uses. */
function corpusOrders() {
  return readFileSync(join(HERE, 'corpus', 'orders.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .length;
}

describe('the README describes this game and not an earlier one', () => {
  // Each row: what the README says it counts, the regex that finds the number,
  // and the live value. Pulled from the document rather than restated here, so
  // that editing the prose without editing the number fails.
  const CLAIMS = [
    ['star systems', /(\d+) star systems/, () => SYSTEMS.length],
    ['ship classes', /(\d+) ship classes/, () => SHIP_LIST.length],
    ['authored episodes', /(\d+) authored episodes/, () => EPISODES.length],
    ['species', /(\d+)\s*\n?species/, () => PLAYER_SPECIES.length],
    ['difficulties', /(\d+) difficulties/, () => DIFFICULTIES.length],
    ['reputation tracks', /(\d+) reputation tracks/, () => TRACK_LIST.length],
    ['sound cues', /(\d+) synthesized sound cues/, () => Object.keys(CUES).length],
    ['lexicon phrasings', /lexicon of (\d+) phrasings/, () => phraseCount()],
    ['weighted keywords', /(\d+) weighted keywords/,
      () => INTENTS.reduce((n, i) => n + Object.keys(i.keywords ?? {}).length, 0)],
    ['intents', /across\n(\d+) intents/, () => INTENTS.length],
    ['corpus orders', /(\d+) hand-written paraphrases/, corpusOrders],
    ['corpus orders (content list)', /(\d+)-order corpus/, corpusOrders],
  ];

  test('every number it states is the number the code has', () => {
    const wrong = [];
    let found = 0;
    for (const [what, re, actual] of CLAIMS) {
      const m = README.match(re);
      if (!m) { wrong.push(`${what}: the README no longer states this at all`); continue; }
      found++;
      const stated = Number(m[1]);
      const real = actual();
      if (stated !== real) wrong.push(`${what}: README says ${stated}, actual ${real}`);
    }
    // Prove the regexes still find the claims before trusting their silence.
    assert.equal(found, CLAIMS.length, `only ${found} of ${CLAIMS.length} claims were located in the README`);
    assert.deepEqual(wrong, [], `${wrong.length} of ${CLAIMS.length} stated counts have drifted`);
  });

  test('and the phrasing count it repeats in two places agrees with itself', () => {
    // The lexicon size appears twice, in the prose and in the content list. They
    // drifted together last time, but nothing said they had to.
    const a = README.match(/lexicon of (\d+) phrasings/);
    const b = README.match(/lexicon of (\d+) phrasings tested against/);
    assert.ok(a && b, 'the README states its lexicon size in fewer than two places now');
    assert.equal(a[1], b[1]);
  });

  test('the test count is stated as a floor, because a number cannot stay true', () => {
    // Deliberately not an exact count: every test added would falsify it, and a
    // README nobody can keep true is a README nobody keeps.
    const m = README.match(/npm test\s+# (\d+)\+ tests/);
    assert.ok(m, 'the README should state its test count as "N+ tests"');
    assert.ok(Number(m[1]) >= 1000, `the floor is ${m[1]}, which is below the suite's size`);
  });
});

describe('the manual teaches phrases the game answers to', () => {
  /** Backticked spans that are meant to be typed at the order line. */
  function documentedPhrases() {
    const out = [];
    for (const m of MANUAL.matchAll(/`([^`]{3,60})`/g)) {
      const p = m[1].replace(/^"|"$/g, '').trim();
      // Not orders: file paths, <slot> templates, and arithmetic.
      if (/\.(js|mjs|txt|md|json|html)\b|\//.test(p)) continue;
      if (/[<>]/.test(p)) continue;
      if (/[÷×−+=]/.test(p)) continue;
      out.push(p);
    }
    return out;
  }

  test('every phrase it prints parses to an order', () => {
    const g = new Game({ seed: 5n, crewMode: 'original' });
    const phrases = documentedPhrases();
    // Without this the whole test passes on an empty list.
    assert.ok(phrases.length >= 40, `only scraped ${phrases.length} phrases from the manual`);

    const dud = [];
    for (const p of phrases) {
      const r = parseOrder(p, g);
      const o = r.order ?? r;
      // An order that needs an argument the bare phrase does not give is being
      // ASKED for it, which is a correct outcome — "set a course" is printed in
      // the manual exactly to show that the helm asks which system.
      if (r.error) continue;
      if (r.unknown || !o.action) dud.push(`"${p}"`);
    }
    assert.deepEqual(dud, [], `${dud.length} documented phrases the game does not understand`);
  });

  test('and the intercom line reaches the intercom, not a damage report', () => {
    // The specific claim that was false, and the reason "does it parse" is not
    // the check: "engineering, report" parses perfectly well, to `status`.
    const g = new Game({ seed: 5n, crewMode: 'original' });
    const m = MANUAL.match(/`(engineering[^`]*)` and tapping \*\*Engineering\*\*/);
    assert.ok(m, 'the manual no longer makes the intercom equivalence claim');
    const r = parseOrder(m[1], g);
    const o = r.order ?? r;
    assert.equal(o.action, 'intercom', `the manual documents "${m[1]}", which is a ${o.action} order`);
    assert.equal(o.dept, 'engineering');
  });

  test('and the comma is the whole difference, which is why the manual says so', () => {
    // A guard on the explanation the manual now carries: if this ever stops
    // being true, the paragraph explaining it is wrong and should go.
    const g = new Game({ seed: 5n, crewMode: 'original' });
    assert.equal((parseOrder('engineering report', g)).action, 'intercom');
    assert.equal((parseOrder('engineering, report', g)).action, 'status');
  });
});
