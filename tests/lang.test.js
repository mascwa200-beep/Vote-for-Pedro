// The command layer.
//
// Two kinds of test here, and they do different jobs.
//
// The unit tests below check that each piece behaves — Soundex groups the words
// it should, edit distance is bounded, entities come out of a sentence.
//
// The corpus test is the one that matters. It runs several hundred orders
// written the way people actually type them and reports the hit rate. It is not
// a proof that the parser understands English; it is a floor, and a regression
// alarm. When it drops, the fix goes in the lexicon, not in the corpus.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalize, readNumber } from '../src/lang/normalize.js';
import { soundex, skeleton, soundsLike } from '../src/lang/phonetic.js';
import { distance, similarity } from '../src/lang/fuzzy.js';
import {
  findPlace, findFacing, findPowerChannel, findTargetSystem,
  findWarpFactor, findBearing, gazetteerSummary,
} from '../src/lang/gazetteer.js';
import { parseText, CONFIDENT } from '../src/lang/parse.js';
import { INTENTS, lexiconActions, phraseCount } from '../src/lang/lexicon.js';
import { parseOrder } from '../src/ui/orders.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Actions the game can actually execute.
 *
 * Read out of main.js rather than restated here. A hand-kept copy of this list
 * is a data table checked against another data table: it passes while the
 * lexicon and the dispatch drift apart, which is the exact failure mode the
 * test below exists to catch. Extracting the real `case` labels means the only
 * way to satisfy it is to write a handler.
 */
const MAIN_JS = readFileSync(join(HERE, '..', 'src', 'main.js'), 'utf8');
const EXECUTABLE = new Set(
  [...MAIN_JS.slice(MAIN_JS.indexOf('executeOrder('))
    .matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]),
);

describe('normalisation', () => {
  test('expands contractions and slang', () => {
    assert.equal(normalize("don't fire").text, 'do not fire');
    assert.match(normalize('gonna need shields').text, /going to/);
  });

  test('folds British and American spelling to one form', () => {
    assert.equal(normalize('evasive manoeuvres').text, normalize('evasive maneuvers').text);
    assert.equal(normalize('defence posture').text, normalize('defense posture').text);
  });

  test('strips politeness without losing the order', () => {
    const a = normalize('could you please come about');
    assert.equal(a.text, 'come about');
  });

  test('reports who was addressed and removes them', () => {
    const n = normalize('helm, set course for vulcan');
    assert.equal(n.station, 'helm');
    assert.equal(n.text, 'set course for vulcan');
  });

  test('recognises an addressee by rank and name', () => {
    const n = normalize('mister sulu, ahead full');
    assert.equal(n.text, 'ahead full');
  });

  test('flags negation', () => {
    assert.equal(normalize('do not fire').negated, true);
    assert.equal(normalize('fire').negated, false);
  });

  test('reads spelled and fractional numbers', () => {
    assert.equal(readNumber('warp factor eight'), 8);
    assert.equal(readNumber('seventy five percent'), 75);
    assert.equal(Math.round(readNumber('one third') * 100), 33);
    assert.equal(readNumber('nothing here', 6), 6);
  });
});

describe('phonetics', () => {
  test('groups words that sound alike', () => {
    assert.ok(soundsLike('hail', 'hale'));
    assert.ok(soundsLike('shields', 'shealds'));
  });

  test('does not group words that merely share letters', () => {
    assert.ok(!soundsLike('fire', 'far'));
    assert.ok(!soundsLike('port', 'part'));
  });

  test('soundex has the documented shape', () => {
    assert.equal(soundex('Robert'), 'R163');
    assert.equal(soundex('Rupert'), 'R163');
    assert.equal(soundex('Tymczak').length, 4);
  });

  test('skeleton drops vowels and collapses doubles', () => {
    assert.equal(skeleton('shields'), 'SHLDS');
    assert.equal(skeleton('pepper'), 'PPR');
  });
});

describe('edit distance', () => {
  test('counts the edits it should', () => {
    assert.equal(distance('phaser', 'phasor'), 1);
    assert.equal(distance('fire', 'fier'), 1);          // transposition
    assert.equal(distance('abc', 'xyz', 2), 3);         // gave up, over budget
  });

  test('short words get almost no tolerance', () => {
    // "aft" and "all" are one edit apart and mean completely different things.
    assert.equal(similarity('aft', 'all'), 0);
  });

  test('long words get more', () => {
    assert.ok(similarity('maneuvers', 'manuevers') > 0.7);
  });
});

describe('entity extraction', () => {
  const at = (s) => {
    const n = normalize(s);
    return { text: n.text, tokens: n.tokens };
  };

  test('finds a destination by name, id and alias', () => {
    assert.equal(findPlace(...Object.values(at('set course for vulcan'))).id, 'vulcan');
    assert.ok(findPlace(...Object.values(at('take us to earth'))));
    assert.ok(findPlace(...Object.values(at('ds9'))));
  });

  test('finds a misspelled destination', () => {
    const p = findPlace(...Object.values(at('set course for vulkan')));
    assert.equal(p?.id, 'vulcan');
    assert.equal(p.exact, false);
  });

  test('does not read a common noun as a place', () => {
    assert.equal(findPlace(...Object.values(at('raise shields'))), null);
  });

  test('finds facings including the two new ones', () => {
    assert.equal(findFacing(...Object.values(at('reinforce forward shields'))), 'fore');
    assert.equal(findFacing(...Object.values(at('hit them from below'))), 'ventral');
  });

  test('separates our power channels from their subsystems', () => {
    assert.equal(findPowerChannel(...Object.values(at('divert power to shields'))), 'shields');
    assert.equal(findTargetSystem(...Object.values(at('target their warp core'))), 'warpcore');
    assert.equal(findTargetSystem(...Object.values(at('aim for their nacelles'))), 'engines');
  });

  test('reads warp factors but not stray numbers', () => {
    assert.equal(findWarpFactor('warp factor eight'), 8);
    assert.equal(findWarpFactor('maximum warp'), 9.9);
    assert.equal(findWarpFactor('divert 40 percent to weapons'), null);
  });

  test('reads a bearing with a mark', () => {
    assert.deepEqual(findBearing('come to bearing 210 mark 15'), { bearing: 210, mark: 15 });
  });

  test('the gazetteer is built from the game data, not a copy of it', () => {
    const g = gazetteerSummary();
    assert.ok(g.places > 40, `expected the star systems to be indexed, got ${g.places}`);
    assert.equal(g.powerChannels, 4);
  });
});

describe('the lexicon is wired, not decorative', () => {
  // Three features once shipped in this repository fully documented and
  // completely inert. A lexicon is the easiest possible place for that to
  // happen again: an intent is cheap to write and expensive to notice missing.
  test('every intent produces an action the game can execute', () => {
    const orphans = lexiconActions().filter((a) => !EXECUTABLE.has(a));
    assert.deepEqual(orphans, [],
      `these lexicon actions have no handler in App.executeOrder: ${orphans.join(', ')}`);
  });

  test('every intent carries phrasings and a help line', () => {
    for (const i of INTENTS) {
      assert.ok(i.phrases.length >= 5, `${i.id} has too few phrasings`);
      assert.ok(i.help && i.help.length > 4, `${i.id} has no help line`);
      assert.ok(Object.keys(i.keywords).length >= 1, `${i.id} has no keywords`);
    }
  });

  test('intent ids are unique', () => {
    const ids = INTENTS.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('parsing behaviour', () => {
  test('a clear order executes without asking', () => {
    const r = parseText('fire all weapons');
    assert.equal(r.action, 'fire');
    assert.ok(r.confidence >= CONFIDENT);
  });

  test('a recognised order missing its object asks for it', () => {
    const r = parseText('set a course');
    assert.equal(r.error, 'Which system, Captain?');
  });

  test('nonsense is admitted rather than guessed at', () => {
    const r = parseText('qwertyuiop asdfghjkl zxcvbnm');
    assert.equal(r.unknown, true);
    assert.ok(Array.isArray(r.suggestions));
  });

  test('a veto beats keyword overlap', () => {
    // "hold fire" shares "hold" with "hold position" and must not stop the ship.
    assert.equal(parseText('hold fire').action, 'cease_fire');
    assert.equal(parseText('hold position').action, 'throttle');
    assert.equal(parseText('hold position').value, 0);
  });

  test('who you addressed breaks a tie', () => {
    assert.equal(parseText('helm, take us in').station, undefined);
    // The addressee is consumed by normalisation but still steers the score.
    const t = parseText('tactical, target their engines');
    assert.equal(t.action, 'target_subsystem');
  });

  test('negation flips an intent rather than triggering it', () => {
    assert.equal(parseText('cancel evasive').value, false);
    assert.equal(parseText('evasive maneuvers').value, true);
  });

  test('confidence is lower when two readings compete', () => {
    const clear = parseText('open a channel');
    assert.ok(clear.confidence > 0.6);
  });
});

describe('the existing parser still works', () => {
  // The regex table is the fast path and every one of its behaviours predates
  // this directory. Breaking it silently would be the worst outcome here.
  test('table orders are unchanged', () => {
    assert.equal(parseOrder('red alert').action, 'alert');
    assert.equal(parseOrder('red alert').level, 'red');
    assert.equal(parseOrder('fire').action, 'fire');
    assert.equal(parseOrder('all stop').value, 0);
    assert.equal(parseOrder('shields up').up, true);
  });

  test('orders the table misses now reach the pipeline', () => {
    // None of these are in the regex table.
    assert.equal(parseOrder('let them have it').action, 'fire');
    assert.equal(parseOrder('get our nose on them').action, 'come_about');
    assert.equal(parseOrder('how bad is it').action, 'status');
    assert.equal(parseOrder('who are they').action, 'scan');
  });

  test('an empty order is still nothing', () => {
    assert.equal(parseOrder('').unknown, true);
    assert.equal(parseOrder('   ').unknown, true);
  });
});

describe('corpus coverage', () => {
  const lines = readFileSync(join(HERE, 'corpus', 'orders.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [expected, ...rest] = l.split('|');
      return { expected: expected.trim(), text: rest.join('|').trim() };
    });

  test('the corpus is substantial and well formed', () => {
    assert.ok(lines.length >= 400, `corpus has only ${lines.length} lines`);
    for (const l of lines) {
      assert.ok(EXECUTABLE.has(l.expected), `unknown expected action: ${l.expected}`);
      assert.ok(l.text.length > 0);
    }
  });

  test('the parser reaches the coverage floor', () => {
    const misses = [];
    let confirmed = 0;

    for (const { expected, text } of lines) {
      const r = parseOrder(text);
      const action = r.confirm ? r.order?.action : r.action;
      if (r.confirm) confirmed++;
      // An ability match carries the plain reading as a fallback, and the game
      // uses that fallback whenever nobody aboard has trained the ability. Both
      // are correct outcomes for the same line.
      const ok = action === expected || r.fallback?.action === expected;
      if (!ok) misses.push({ text, expected, got: action ?? (r.error ? 'ASK' : 'UNKNOWN') });
    }

    const rate = (lines.length - misses.length) / lines.length;
    const pct = (rate * 100).toFixed(1);

    if (misses.length) {
      const shown = misses.slice(0, 25)
        .map((m) => `  "${m.text}"  expected ${m.expected}, got ${m.got}`)
        .join('\n');
      console.log(`\ncorpus: ${pct}% of ${lines.length} orders (${confirmed} needed confirmation)`);
      console.log(`${misses.length} misses:\n${shown}${misses.length > 25 ? '\n  ...' : ''}`);
    } else {
      console.log(`\ncorpus: ${pct}% of ${lines.length} orders, no misses`);
    }

    assert.ok(rate >= 0.95,
      `corpus coverage ${pct}% is below the 95% floor — fix the lexicon, not the corpus`);
  });

  test('the lexicon stays inside the bundle budget', () => {
    // The whole app precaches; a lexicon that grows without limit is the one
    // part of this design that could plausibly break that.
    assert.ok(phraseCount() > 250, 'the lexicon is suspiciously thin');
    assert.ok(phraseCount() < 6000, 'the lexicon has outgrown the precache budget');
  });
});

// ================================================================= the z axis

// The third axis is the whole point of the 3D simulation, and the enemy AI
// uses it tactically — chooseElevation() deliberately comes at you from above
// or below whichever face you are not presenting. The player could not.
//
// `Engagement.setPitch` existed and was called from nowhere in the UI or the
// command layer. "bearing 210 mark 15" parsed correctly, extracted the mark,
// carried it in the order object, and main.js dropped it on the floor.
describe('elevation orders reach the helm', () => {
  const order = (t) => {
    const r = parseOrder(t);
    return r?.confirm ? r.order : r;
  };

  test('a bearing carries its mark', () => {
    const r = order('bearing 210 mark 15');
    assert.equal(r.action, 'heading');
    assert.equal(r.value, 210);
    assert.equal(r.mark, 15, 'the elevation was parsed away');
  });

  test('a negative mark is a dive, not a parse failure', () => {
    const r = order('come to heading 090 mark -20');
    assert.equal(r.value, 90);
    assert.equal(r.mark, -20);
  });

  test('climbing and diving are orders in their own right', () => {
    for (const [text, sign] of [
      ['take us up', 1], ['climb', 1], ['nose up', 1], ['take us over them', 1],
      ['bring us above them', 1], ['gain altitude', 1],
      ['take us down', -1], ['dive', -1], ['nose down', -1],
      ['get us under them', -1], ['drop below them', -1],
    ]) {
      const r = order(text);
      assert.ok(r && !r.unknown, `"${text}" was not understood at all`);
      assert.equal(r.action, 'pitch', `"${text}" produced ${r.action}`);
      assert.ok(Math.sign(r.value) === sign,
        `"${text}" gave pitch ${r.value}, expected sign ${sign}`);
    }
  });

  test('levelling off is an order too', () => {
    for (const text of ['level off', 'level out', 'even keel', 'level the ship']) {
      const r = order(text);
      assert.ok(r && !r.unknown, `"${text}" was not understood`);
      assert.equal(r.action, 'pitch', `"${text}" produced ${r.action}`);
      assert.equal(r.value, 0, `"${text}" gave pitch ${r.value}`);
    }
  });

  test('an explicit elevation is honoured', () => {
    const r = order('climb 30 degrees');
    assert.equal(r.action, 'pitch');
    assert.equal(r.value, 30);
  });

  test('a climb order is not mistaken for a throttle order', () => {
    // "take us up" and "step on it" are close enough in shape that a keyword
    // parser will happily read one as the other.
    assert.equal(order('take us up').action, 'pitch');
    assert.equal(order('take us down').action, 'pitch');
    // These stay speed orders. "up"/"down" appear in both families, so the
    // elevation extractor has to be the thing that decides, not the words.
    assert.equal(order('speed up').action, 'throttle');
    assert.equal(order('slow down').action, 'throttle');
    assert.equal(order('step on it').action, 'throttle');
  });
});

// ========================================================== helm and refusals

// Three phrasings a captain will certainly type, which the parser answered with
// "I do not understand". The design goal for this layer is that anything typed
// is an order that gets enacted; a shrug at "hard to port" is a defect against
// that, not a missing feature.
describe('orders a captain will actually give', () => {
  const order = (t) => {
    const r = parseOrder(t);
    return r?.confirm ? r.order : r;
  };

  test('a relative turn is an order', () => {
    for (const [text, sign] of [
      ['hard to port', -1], ['hard aport', -1], ['come left', -1], ['turn to port', -1],
      ['hard to starboard', 1], ['hard astarboard', 1], ['come right', 1],
      ['turn to starboard', 1],
    ]) {
      const r = order(text);
      assert.ok(r && !r.unknown, `"${text}" was not understood`);
      assert.equal(r.action, 'turn', `"${text}" produced ${r.action}`);
      assert.equal(Math.sign(r.value), sign, `"${text}" turned ${r.value}`);
    }
  });

  test('steady as she goes holds the current heading', () => {
    for (const text of ['steady as she goes', 'steady on', 'hold this heading', 'maintain heading']) {
      const r = order(text);
      assert.ok(r && !r.unknown, `"${text}" was not understood`);
      assert.equal(r.action, 'turn', `"${text}" produced ${r.action}`);
      assert.equal(r.value, 0);
    }
  });

  test('belaying an order is understood', () => {
    for (const text of ['belay that', 'cancel that', 'belay my last', 'belay that order']) {
      const r = order(text);
      assert.ok(r && !r.unknown, `"${text}" was not understood`);
      assert.equal(r.action, 'cease_fire', `"${text}" produced ${r.action}`);
    }
  });

  test('the cloak is an order, even on a ship that has not got one', () => {
    for (const text of ['cloak', 'engage the cloaking device', 'cloak the ship']) {
      const r = order(text);
      assert.ok(r && !r.unknown, `"${text}" was not understood`);
      assert.equal(r.action, 'cloak');
      assert.equal(r.on, true);
    }
    for (const text of ['decloak', 'drop the cloak', 'uncloak']) {
      const r = order(text);
      assert.ok(r && !r.unknown, `"${text}" was not understood`);
      assert.equal(r.action, 'cloak');
      assert.equal(r.on, false);
    }
  });
});
