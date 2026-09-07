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
const RESEARCH = readFileSync(join(HERE, '..', 'docs', 'RESEARCH.md'), 'utf8');

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

// ---------------------------------------------------------------- the register
//
// docs/RESEARCH.md is the longest document in the repository and consists almost
// entirely of measurements, and until this block nothing had ever checked one of
// them. §107 records what that cost: "episode content is wide but shallow" rode
// four consecutive pull requests as an established fact, and when it was finally
// measured the figures were all correct and the reading was wrong three separate
// ways — the nine episodes "finishable in a single choice" are nine episodes you
// are allowed to DECLINE, one of which is the deepest in the game.
//
// This covers §107 and not the register. Every other number in that document is
// still unguarded prose.

/** Every choice in the book, with the stage and episode it belongs to. */
function everyChoice() {
  const out = [];
  for (const ep of EPISODES) {
    for (const [stageId, stage] of Object.entries(ep.stages ?? {})) {
      for (const c of stage.choices ?? []) out.push({ ep, stageId, stage, c });
    }
  }
  return out;
}

const gatedIn = (ep) => Object.values(ep.stages ?? {})
  .reduce((n, s) => n + (s.choices ?? []).filter((c) => c.requires).length, 0);
const choicesIn = (ep) => Object.values(ep.stages ?? {})
  .reduce((n, s) => n + (s.choices ?? []).length, 0);

/** Distinct routes through an episode, following EVERY branch destination. */
function pathsThrough(ep) {
  const memo = new Map();
  const walk = (id, depth) => {
    if (depth > 25) return 1;
    if (memo.has(id)) return memo.get(id);
    const s = ep.stages?.[id];
    if (!s) return 1;
    memo.set(id, 1);            // a cycle contributes one route, not infinite
    let n = 0;
    for (const c of s.choices ?? []) {
      const dests = c.next ? [c.next] : (c.branch ? Object.values(c.branch) : []);
      if (!dests.length) { n += 1; continue; }
      for (const d of dests) n += walk(d, depth + 1);
    }
    memo.set(id, n || 1);
    return n || 1;
  };
  return walk(ep.start, 0);
}

describe('the register states figures it has actually measured', () => {
  const byId = (id) => EPISODES.find((e) => e.id === id);

  // Same shape as the README block above: the number is pulled OUT of the prose
  // rather than restated here, so editing the sentence without editing the
  // figure fails.
  const CLAIMS = [
    ['episodes', /(\d+) authored\nepisodes, \d+ stages and \d+ choices/, () => EPISODES.length],
    ['stages', /\d+ authored\nepisodes, (\d+) stages and \d+ choices/,
      () => EPISODES.reduce((n, e) => n + Object.keys(e.stages ?? {}).length, 0)],
    ['choices', /\d+ authored\nepisodes, \d+ stages and (\d+) choices/, () => everyChoice().length],
    ['gated choices', /\*\*(\d+) of \d+ choices carry a `requires`\*\*/,
      () => everyChoice().filter((x) => x.c.requires).length],
    ['gated denominator', /\*\*\d+ of (\d+) choices carry a `requires`\*\*/, () => everyChoice().length],
    ['long_watch choices', /carries (\d+) choices across \d+ stages and [\d,]+\ndistinct paths/,
      () => choicesIn(byId('long_watch'))],
    ['long_watch stages', /carries \d+ choices across (\d+) stages and [\d,]+\ndistinct paths/,
      () => Object.keys(byId('long_watch').stages).length],
    // Written with a thousands separator, because the prose says "1,349" and
    // will keep crossing a thousand as episodes gain roads. `stated` below
    // strips the commas rather than the document avoiding them.
    ['long_watch paths', /carries \d+ choices across \d+ stages and ([\d,]+)\ndistinct paths/,
      () => pathsThrough(byId('long_watch'))],
    ['homecoming gated', /(\d+) of `homecoming`'s \d+ choices are gated/,
      () => gatedIn(byId('homecoming'))],
    ['homecoming choices', /\d+ of `homecoming`'s (\d+) choices are gated/,
      () => choicesIn(byId('homecoming'))],
    ['episodes offering a decline', /(\d+) episodes offer an ending on\ntheir opening stage/,
      () => EPISODES.filter((e) => (e.stages[e.start]?.choices ?? [])
        .some((c) => c.outcome && !c.next && !c.branch)).length],
  ];

  test('every number §107 states is the number the episodes have', () => {
    const wrong = [];
    let found = 0;
    for (const [what, re, actual] of CLAIMS) {
      const m = RESEARCH.match(re);
      if (!m) { wrong.push(`${what}: §107 no longer states this at all`); continue; }
      found++;
      const stated = Number(String(m[1]).replace(/,/g, ''));
      const real = actual();
      if (stated !== real) wrong.push(`${what}: §107 says ${stated}, actual ${real}`);
    }
    // The assertion this whole section exists because of: a regex that stops
    // matching must fail loudly, not pass by finding nothing to disagree with.
    assert.equal(found, CLAIMS.length,
      `only ${found} of ${CLAIMS.length} of §107's figures could be located in RESEARCH.md`);
    assert.deepEqual(wrong, [], `${wrong.length} of §107's figures have drifted`);
  });

  test('the running count of deeds still to wire is the count that is still to wire', () => {
    // Eight consecutive sections end with "N flags to go", and until §116 not one
    // of them had ever been checked. Three were wrong: §112 by two, §113 and
    // §115 by one each, and §114 was right by accident.
    //
    // The cause is worth naming, because it is §107's disease in my own hands:
    // a number the register repeats about itself reads like a restatement of
    // something already verified rather than a new claim, so nobody measures it
    // — and I was subtracting from the previous section's figure instead of
    // counting the list. Three of the flags I subtracted were never on the list
    // at all; the faction-memory table already read them.
    //
    // Only the LAST occurrence is checked. The earlier ones are a record of what
    // was true when each section was written, and rewriting history to satisfy a
    // test would be the opposite of the point.
    const all = [...RESEARCH.matchAll(/\n([A-Z][a-z]+(?:-[a-z]+)?) flags to go/g)];
    assert.ok(all.length >= 5,
      `only ${all.length} "N flags to go" lines found, so this asserts nothing`);

    const WORDS = {
      zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
      eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
      fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
      nineteen: 19, twenty: 20, thirty: 30,
    };
    const toNumber = (word) => {
      const [tens, units] = word.toLowerCase().split('-');
      if (units === undefined) return WORDS[tens];
      return WORDS[tens] === undefined || WORDS[units] === undefined
        ? undefined : WORDS[tens] + WORDS[units];
    };

    const stated = toNumber(all[all.length - 1][1]);
    assert.ok(stated !== undefined,
      `the last count reads "${all[all.length - 1][1]}", which is not a number I can parse`);

    // The registry in wiring.test.js is the authority — it is asserted against
    // the book in both directions, so it cannot itself drift.
    const wiring = readFileSync(join(HERE, 'wiring.test.js'), 'utf8');
    const block = wiring.slice(
      wiring.indexOf('const WRITTEN_AND_UNREAD = {'),
      wiring.indexOf('};', wiring.indexOf('const WRITTEN_AND_UNREAD = {')));
    // Not line-anchored: the registry packs several entries onto a line, and the
    // first draft of this scrape counted 14 of 19 because of it. The guard caught
    // that only because the expected value was stated rather than derived from
    // the same broken read — which is the whole argument for writing the number
    // down instead of computing both sides the same way.
    const candidates = [...block.matchAll(/(\w+): 'candidate'/g)].length;
    assert.ok(candidates >= 10,
      `only ${candidates} candidates scraped from the registry, so this asserts little`);

    assert.equal(stated, candidates,
      `the register's last count says ${stated} deeds still to wire; the registry lists ${candidates}`);

  });

  test('and the clause after the comma is checked too', () => {
    // Every section since §112 ended "N flags to go, three of them act-5
    // blocked". §116 found the N wrong and guarded it. Nobody checked the rest
    // of the sentence for seven sections, and it was false by then: no flag on
    // the list is written in act 5 any more.
    //
    // The qualifier survived precisely BECAUSE the number beside it was
    // measured. A sentence half of which is guarded reads as a guarded
    // sentence. So the half that describes the shape of the debt is now
    // measured as well.
    const wiring = readFileSync(join(HERE, 'wiring.test.js'), 'utf8');
    const block = wiring.slice(
      wiring.indexOf('const WRITTEN_AND_UNREAD = {'),
      wiring.indexOf('};', wiring.indexOf('const WRITTEN_AND_UNREAD = {')));
    const candidates = [...block.matchAll(/(\w+): 'candidate'/g)].map((m) => m[1]);
    assert.ok(candidates.length >= 10,
      `only ${candidates.length} candidates scraped, so this asserts little`);

    // The act that first writes each flag, from the episodes rather than names.
    const firstAct = new Map();
    for (const e of EPISODES) {
      const note = (f) => firstAct.set(f, Math.min(firstAct.get(f) ?? Infinity, e.act));
      for (const s of Object.values(e.stages ?? {})) {
        for (const c of s.choices ?? []) for (const f of [].concat(c.effects?.flag ?? [])) note(f);
      }
      for (const en of Object.values(e.endings ?? {})) {
        for (const f of [].concat(en.effects?.flag ?? [])) note(f);
      }
    }
    const lastAct = Math.max(...EPISODES.map((e) => e.act));

    const blocked = candidates.filter((f) => firstAct.get(f) === lastAct);
    assert.match(RESEARCH, /None is written in act 5; (\w+) are act-4 deeds/,
      'the register no longer states the shape of the debt in a form this can read');
    assert.equal(blocked.length, 0,
      `${blocked.length} candidates are written in the final act (${blocked.join(', ')}), `
      + 'but the register says none is');

    const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
    const stated = WORDS[RESEARCH.match(/None is written in act 5; (\w+) are act-4 deeds/)[1]];
    const shallow = candidates.filter((f) => firstAct.get(f) === lastAct - 1);
    assert.equal(stated, shallow.length,
      `the register says ${stated} act-4 deeds; the registry has ${shallow.length}`);
  });

  test('the episodes it names as gating nothing are the episodes that gate nothing', () => {
    // Scraped as a list, so an episode that gains its first gate has to leave
    // the document — and one that loses its last has to join it.
    // The count is captured rather than baked in, because the whole point of
    // this section is that the number should fall as episodes learn to read the
    // record — pinning "Four" here made the guard fail the first time it did.
    // Captured, it still has to agree with the list beneath it.
    const block = RESEARCH.match(
      /(\w+) episodes gate nothing whatsoever:\n\n((?:- `[a-z0-9_]+`\n)+)/);
    assert.ok(block, '§107 no longer names the episodes that gate nothing');
    const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    const stated = WORDS.indexOf(block[1].toLowerCase());
    assert.ok(stated >= 0, `§107 says "${block[1]} episodes gate nothing", which is not a number`);

    const named = [...block[2].matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1]).sort();
    assert.ok(named.length >= 1, 'the list scraped empty, so this asserted nothing');
    assert.equal(stated, named.length,
      `§107 says ${block[1]} episodes gate nothing and then lists ${named.length}`);

    const actual = EPISODES.filter((e) => gatedIn(e) === 0).map((e) => e.id).sort();
    assert.deepEqual(named, actual,
      'the episodes §107 says read nothing the captain did are not those episodes');
  });

  test('an episode you can decline is not an episode with one choice', () => {
    // The reading that was wrong for four pull requests, as an assertion. Nine
    // episodes end on their opening stage; what makes each a DECLINE rather
    // than a dead end is that the same stage also offers a way in.
    const declines = EPISODES.filter((e) => (e.stages[e.start]?.choices ?? [])
      .some((c) => c.outcome && !c.next && !c.branch));
    assert.ok(declines.length >= 5, `only ${declines.length} episodes to check`);

    const deadEnds = declines.filter((e) => !(e.stages[e.start].choices ?? [])
      .some((c) => c.next || c.branch));
    assert.deepEqual(deadEnds.map((e) => e.id), [],
      'an episode ends on its opening stage with no other way to go');

    // And the counterexample the correction rests on: the deepest episode in
    // the book is one of the nine.
    assert.ok(declines.some((e) => e.id === 'long_watch'),
      '§107 rests on long_watch being declinable, and it is not');
    const median = EPISODES.map(choicesIn).sort((a, b) => a - b)[Math.floor(EPISODES.length / 2)];
    assert.ok(choicesIn(byId('long_watch')) > median,
      'long_watch is no longer larger than the median episode, so §107 needs a new counterexample');
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
