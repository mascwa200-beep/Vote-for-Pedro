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
import { parseOrder, commandReference, orderHelp } from '../src/ui/orders.js';
import { article } from '../src/world/encounters.js';
import { FACTIONS } from '../src/world/factions.data.js';

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

  test('a correctly spelled word is not a typo of a facing', () => {
    // The bug: `similarity('power', 'lower')` is 0.83, inside the fuzzy
    // threshold, so EVERY order containing the word `power` came back carrying
    // a ventral facing nobody typed. `fire`, `core` and `more` all became fore;
    // `stop` became dorsal; `head` became ahead. Eighteen ordinary words.
    //
    // Only `reinforce` reads a facing, and it REQUIRES one — so "reinforce the
    // shields" with no facing named quietly reinforced whichever face the
    // hallucination picked, and any order containing "fire" or "more" could
    // satisfy the requirement outright.
    for (const word of ['power', 'fire', 'core', 'more', 'stop', 'head',
      'force', 'light', 'night', 'fight', 'bear', 'read', 'blow', 'slower']) {
      assert.equal(findFacing(word, [word]), null,
        `"${word}" was read as a facing`);
    }
  });

  test('the fuzzy pass still forgives an actual typo', () => {
    // The guard must not have simply disabled it.
    assert.equal(findFacing('forwrad', ['forwrad']), 'fore');
    assert.equal(findFacing('starbord', ['starbord']), 'starboard');
  });

  test('no word the lexicon itself uses resolves to a facing by accident', () => {
    // The general form, so a new phrasing cannot reintroduce this.
    const exact = new Set(['fore', 'forward', 'front', 'bow', 'ahead', 'aft',
      'rear', 'stern', 'behind', 'back', 'port', 'larboard', 'left', 'starboard',
      'right', 'dorsal', 'top', 'upper', 'above', 'ventral', 'bottom', 'lower',
      'below', 'underside', 'belly']);
    const wrong = [];
    for (const intent of INTENTS) {
      for (const phrase of intent.phrases) {
        for (const w of phrase.split(/\s+/)) {
          if (exact.has(w) || w.length < 4) continue;
          const f = findFacing(w, [w]);
          if (f) wrong.push(`"${w}" (in ${intent.id}) reads as ${f}`);
        }
      }
    }
    assert.deepEqual(wrong.slice(0, 10), [], `${wrong.length} phantom facing(s)`);
  });

  test('reinforce asks for a facing rather than inventing one', () => {
    // The observable consequence of the fix. Before it, this reinforced the
    // ventral shield, because "power" hallucinated one.
    const bare = parseText('reinforce the shields');
    assert.ok((bare.confidence ?? 0) < CONFIDENT,
      `"reinforce the shields" fired at ${(bare.confidence ?? 0).toFixed(2)} with no facing named`);

    const named = parseText('reinforce the forward shields');
    assert.equal(named.intent, 'reinforce');
    assert.ok(named.confidence >= CONFIDENT);
  });

  test('a facing decides between routing power and reinforcing a face', () => {
    // A power channel has no facing. Naming one means you are talking about a
    // shield face, and the word `power` used to carry all of these to the grid
    // with the word `forward` — the point of the sentence — discarded.
    assert.equal(parseText('divert power to shields').intent, 'power');
    assert.equal(parseText('all power to weapons').intent, 'power');
    assert.equal(parseText('more power to the forward shields').intent, 'reinforce');
    assert.equal(parseText('all power to the forward shield').intent, 'reinforce');
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

// ================================================== the command reference
//
// `orderHelp()` assembled exactly this from the day the parser was written and
// was never imported by anything. The game shipped with a natural-language
// layer that accepts hundreds of phrasings and no way to find out — which is
// the same "documented and inert" failure this file already exists to catch,
// one level up: the feature works, and nobody can reach it.
//
// So these assert the property that makes a manual worth having, which is that
// it is complete. A reference that quietly omits an order is worse than none,
// because the player concludes the order does not exist.

describe('the command reference', () => {
  const ref = commandReference();

  test('every intent in the lexicon appears in the manual', () => {
    const listed = new Set(ref.groups.flatMap((g) => g.entries.map((e) => e.id)));
    const missing = INTENTS.map((i) => i.id).filter((id) => !listed.has(id));
    assert.deepEqual(missing, [], 'orders the player has no way to discover');
  });

  test('no order is listed twice under different stations', () => {
    const seen = new Map();
    const dupes = [];
    for (const g of ref.groups) {
      for (const e of g.entries) {
        if (seen.has(e.id)) dupes.push(`${e.id} in both ${seen.get(e.id)} and ${g.label}`);
        seen.set(e.id, g.label);
      }
    }
    assert.deepEqual(dupes, []);
  });

  test('every entry carries phrasings, because the phrasings are the point', () => {
    // A list of order names teaches you nothing you could not guess from the
    // buttons. Seeing that "come about", "bring us around" and "get our nose on
    // them" are one order is what teaches you to just say what you mean.
    const bare = [];
    for (const g of ref.groups) {
      for (const e of g.entries) {
        if (!e.examples.length) bare.push(e.id);
        if (!e.help || e.help.length < 5) bare.push(`${e.id} (no help line)`);
      }
    }
    assert.deepEqual(bare, []);
  });

  test('the examples are real phrasings the parser accepts', () => {
    // The failure this catches: a manual that drifts from the parser and
    // teaches phrasings that do not work. Every example is run through the
    // real parser and must come back as the order it is filed under.
    const wrong = [];
    for (const g of ref.groups) {
      for (const e of g.entries) {
        for (const phrase of e.examples) {
          const r = parseText(phrase);
          // Some orders need an object the bare phrase does not supply — "set
          // course" with no system. Being ASKED for it is a correct outcome;
          // being routed to a different order is not.
          if (r.intent && r.intent !== e.id && r.confidence >= CONFIDENT) {
            wrong.push(`"${phrase}" is filed under ${e.id} but parses as ${r.intent}`);
          }
        }
      }
    }
    assert.deepEqual(wrong.slice(0, 8), [], `${wrong.length} example(s) do not parse as themselves`);
  });

  test('no station group is empty, and none is a dumping ground', () => {
    for (const g of ref.groups) {
      assert.ok(g.entries.length > 0, `${g.label} is an empty heading`);
      assert.ok(g.entries.length <= INTENTS.length * 0.4,
        `${g.label} holds ${g.entries.length} of ${INTENTS.length} orders, which is not a grouping`);
    }
  });

  test('the manual counts what the lexicon actually carries', () => {
    assert.equal(ref.phrasings, phraseCount());
    assert.equal(ref.intents, INTENTS.length);
    assert.ok(ref.abilities.length > 5, `only ${ref.abilities.length} officer abilities listed`);
    for (const a of ref.abilities) {
      assert.ok(a.name && a.order, `an ability is missing its name or its order: ${JSON.stringify(a)}`);
    }
  });

  test('asking for help is itself an order', () => {
    // Otherwise the manual is only reachable by finding the button, which is
    // the discovery problem it exists to solve.
    for (const phrase of ['help', 'what can i say', 'what are my orders', 'show me the orders']) {
      const r = parseText(phrase);
      assert.equal(r.intent, 'help', `"${phrase}" parsed as ${r.intent}`);
    }
  });

  test('asking for help does not shoot anybody', () => {
    // "I need help" in a firefight must not become an order. The veto list is
    // what keeps a distress call and a request for the manual apart.
    for (const phrase of ['send help to the colony', 'they need medical assistance', 'render aid']) {
      const r = parseText(phrase);
      assert.notEqual(r.intent, 'help', `"${phrase}" opened the manual`);
    }
  });

  test('orderHelp still works, since it is the older shape of the same thing', () => {
    const h = orderHelp();
    assert.ok(h.orders.length > 20, `${h.orders.length} orders`);
    assert.ok(h.abilities.length > 5);
    assert.equal(h.phrasings, phraseCount());
  });
});

describe('the prose the game writes', () => {
  test('an article agrees with the word after it', () => {
    // "A Independent patrol is holding position" shipped in the log. The
    // adjectives come from factions.data.js and two of them start with a vowel,
    // so the article cannot be a literal in the template.
    for (const f of Object.values(FACTIONS)) {
      const expected = /^[aeiou]/i.test(f.adjective) ? 'An' : 'A';
      assert.equal(article(f.adjective), expected,
        `"${article(f.adjective)} ${f.adjective}" reads wrong`);
    }
  });

  test('no template hardcodes an article in front of faction data', () => {
    // The general form: a literal "A ${...}" is the shape of the bug.
    const src = readFileSync(join(HERE, '..', 'src', 'world', 'encounters.js'), 'utf8');
    const hardcoded = src.match(/`A \$\{|`An \$\{/g) ?? [];
    assert.deepEqual(hardcoded, [], 'an article is hardcoded in front of data');
  });
});

describe('orders are the primary interface', () => {
  // The order line is supposed to be how this game is played, with buttons as
  // the alternative rather than the other way round. That only holds if every
  // capability the interface offers can also be SAID — a button with no phrase
  // behind it quietly turns the text box into decoration.

  test('every capability the buttons offer can also be spoken', () => {
    const capability = [
      // Where the ship goes.
      ['set course for vulcan', 'course'],
      ['warp 8', 'warp_factor'],
      ['all stop', 'throttle'],
      ['standard orbit', 'orbit'],
      ['break orbit', 'break_orbit'],
      ['get us out of here', 'warp_out'],
      // Where the captain goes, and what they touch when they get there.
      ['take me to the armoury', 'go_to_room'],
      ['stand up', 'chair'],
      ['use it', 'use'],
      ['survey that', 'survey_here'],
      ['two to beam down', 'beam_down'],
      ['energise', 'transport'],
      // Fighting.
      ['fire phasers', 'fire'],
      ['cease fire', 'cease_fire'],
      ['shields up', 'shields'],
      ['red alert', 'alert'],
      ['evasive action', 'evasive'],
      ['target their engines', 'target_subsystem'],
      // Everything else with a panel behind it.
      ['open a channel', 'hail'],
      ['scan the system', 'scan'],
      ['status report', 'status'],
      ['captains log', 'log_entry'],
    ];

    const mute = [];
    for (const [said, action] of capability) {
      const r = parseText(said);
      const got = r.action ?? r.order?.action ?? null;
      if (got !== action) mute.push(`"${said}" -> ${got ?? 'nothing'}, wanted ${action}`);
    }
    assert.deepEqual(mute, []);
  });

  test('a place name has to be a word, not a run of letters inside one', () => {
    // "console" contains "sol". So do "solar", "resolve" and "absolutely" —
    // and an exact place match stands aside every intent that yields to a named
    // destination, so "operate the console" was an order to fly to Earth.
    assert.equal(parseText('operate the console').action, 'use');
    assert.equal(parseText('use the console').action, 'use');

    // And naming a real system still works, which is the half that matters.
    assert.equal(parseText('set course for sol').system, 'sol');
    assert.equal(parseText('take us to vulcan').system, 'vulcan');
  });

  test('using what is in front of you is not confused with opening a channel', () => {
    // They share the verb, and one of them is the single most-used order in
    // the game.
    assert.equal(parseText('open a channel').action, 'hail');
    assert.equal(parseText('open hailing frequencies').action, 'hail');
    assert.equal(parseText('open that console').action, 'use');
  });

  test('a tricorder over one rock is not a sensor sweep of the system', () => {
    assert.equal(parseText('survey that').action, 'survey_here');
    assert.equal(parseText('take a reading').action, 'survey_here');
    assert.equal(parseText('scan the system').action, 'scan');
    assert.equal(parseText('scan for ships').action, 'scan');
  });
});

describe('the phrases printed on the buttons are real orders', () => {
  test('every phrase a button teaches actually parses to something', () => {
    // The button labels carry a `say:` that claims "this phrase does what this
    // button does". A phrase that does not parse is worse than no phrase at
    // all: it teaches a language the game does not speak.
    //
    // Kept as a list rather than scraped out of the DOM because screens.js
    // cannot be imported outside a browser — so the discipline is that a new
    // `say:` gets a line here, and the parity check above covers the rest.
    const printed = [
      'stand up', 'take the chair', 'all stop', 'energise', 'use it',
      'survey that', 'two to beam down', 'break orbit', 'through the door',
      'scan the system', 'magnify', 'on screen', 'come about', 'climb',
      'level off', 'dive', 'fire phasers', 'next target', 'open a channel',
      'steady as she goes', 'request docking', 'get us out of here',
      'target their weapons', 'target their shields', 'target their engines',
      'take me to the sickbay',
    ];
    const dud = [];
    for (const phrase of printed) {
      const r = parseText(phrase);
      if (r.unknown || (!r.action && !r.order?.action)) dud.push(phrase);
    }
    assert.deepEqual(dud, []);
  });
});
