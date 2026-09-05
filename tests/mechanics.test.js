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
// 60 / 34 / 26 after the second pass, which wired three more and DELETED one:
// `noRefusal` on `by_the_book` was a second name for `noObjection`, which
// `powers.js` already reads, so the trait promised "officers never refuse your
// orders" through a key nothing looked at while the working key sat on a
// different card. §68's `hazardScale` again.
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
import { Ship } from '../src/sim/ship.js';

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

  test('the ratchet: no more than 19 declared mechanics are read by nothing', () => {
    // It may go down — by wiring one, or by deleting one honestly — and it may
    // not go up. A new trait that declares a mechanic and forgets to wire it
    // fails here rather than shipping as a card that promises something.
    const keys = declared();
    const read = consumed();
    const dead = [...keys.keys()].filter((k) => !read.has(k)).sort();
    assert.ok(keys.size >= 55, `only ${keys.size} mechanics declared; has the sheet shrunk?`);
    assert.ok(dead.length <= 19,
      `${dead.length} declared mechanics are read by nothing:\n  ${dead.join('\n  ')}`);
  });

  test('and everything wired so far is out of that set', () => {
    const read = consumed();
    for (const k of ['xpRate', 'inquiryImmune', 'federationGain', 'peaceGain', 'killPenalty',
      'accuracyBonus', 'hazardDisadvantage',
      'compensation', 'panicBelowQuarter', 'diplomacyDisadvantage', 'fearFactor']) {
      assert.ok(read.has(k), `${k} is read by nothing again`);
    }
  });

  test('and the duplicate that was deleted is gone', () => {
    // `noRefusal` and `noObjection` were two names for one effect. Deleting the
    // unread name is the fix; declaring both again would put the trait back to
    // promising something through a key nobody reads.
    const keys = declared();
    assert.equal(keys.has('noRefusal'), false,
      'noRefusal is back; powers.js reads noObjection and nothing reads this');
    assert.ok(keys.has('noObjection'));
  });
});

const captain = ({
  difficulty = 'lieutenant', traits = [], seed = 4n,
  shipClass = 'constitution', speciesId = 'human', careerId = 'command',
} = {}) => new Game({
  seed, crewMode: 'original', difficulty,
  character: new Character({ speciesId, careerId, traits }),
  shipClass,
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

describe('what the card says about standing, and what the ledger did', () => {
  // Four promises on three cards, none of them kept, and two of them were
  // duplicates of mechanics that already worked under a different name.
  const rep = (g) => Object.values(g.reputation.tracks).reduce((n, t) => n + t.xp, 0);

  test('By the Book adds to Federation GAINS and not to losses', () => {
    // "+2 to Federation standing gains." Gains only, which is what the card
    // says: a captain who follows regulations is not also insulated from the
    // cost of breaking them.
    const move = (traits, delta) => {
      const g = captain({ traits });
      // From 50, because a Starfleet captain starts at 100 and a gain clamps.
      // The first draft of this measurement read "no effect" off that clamp.
      g.ledger.standing.federation = 50;
      g.ledger.adjustStanding('federation', delta, 'test');
      return g.ledger.standing.federation - 50;
    };
    assert.equal(move([], 6), 6);
    assert.equal(move(['by_the_book'], 6), 8);
    assert.equal(move([], -6), -6);
    assert.equal(move(['by_the_book'], -6), -6, 'the trait softened a loss');
  });

  test('and it does not reach other factions', () => {
    const g = captain({ traits: ['by_the_book'] });
    g.ledger.standing.klingon = 0;
    g.ledger.adjustStanding('klingon', 6, 'test');
    assert.equal(g.ledger.standing.klingon, 6);
  });

  test('the Idealist really does get double from a peaceful outcome', () => {
    const plain = captain();
    const ideal = captain({ traits: ['idealist'] });
    plain.earnReputation('first_contact');
    ideal.earnReputation('first_contact');
    assert.ok(rep(plain) > 0, 'the control earned nothing, so this proves nothing');
    assert.equal(rep(ideal), rep(plain) * 2);
  });

  test('and the multiplier is the one the trait declares, not a copy of it', () => {
    // The correction this change is about: `earnReputation` used to say
    // `hasTrait('idealist') ? 2 : 1`, duplicating the number on the card, so
    // editing the trait would have changed the promise and not the game.
    // Comments stripped first. The first draft of this assertion matched the
    // COMMENT that explains what the old code was, which is a guard tripped by
    // prose rather than by code — the same class of instrument error as every
    // other one this file records, one layer up.
    const code = readFileSync('src/core/state.js', 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, /hasTrait\('idealist'\)/,
      'the trait is hardcoded again instead of read');
    assert.match(code, /mechanic\('peaceGain'\)/);
  });

  test('and pays for it when it destroys something', () => {
    // "Destroying a ship costs double standing." The other half, and both
    // halves ship together — wiring only the bonus would make a trait declared
    // `positive: false` into a free one.
    const cost = (traits) => {
      const g = captain({ traits });
      g.ledger.standing.klingon = 0;
      const foe = new Ship('d7', { faction: 'klingon', name: 'K' });
      const eng = g.startCombat([foe], {});
      foe.hull = 0; foe.destroyed = true;
      eng.end('victory');
      g.settleCombat?.('victory');
      return g.ledger.standing.klingon;
    };
    const plain = cost([]);
    const ideal = cost(['idealist']);
    assert.ok(plain < 0, `the control lost no standing (${plain})`);
    assert.equal(ideal, plain * 2, `${ideal} against ${plain}`);
  });

  test('and a bridge that does not argue is one mechanic, not two names', () => {
    const g = captain({ traits: ['by_the_book'] });
    assert.equal(g.character.mechanic('noObjection'), true);
    assert.equal(g.character.mechanic('noRefusal'), undefined);
    // And it is the key `powers.js` actually asks for.
    assert.match(readFileSync('src/sim/powers.js', 'utf8'), /mechanic\('noObjection'\)/);
  });
});

describe('the trait the README quotes, which traded nothing', () => {
  // "Reckless gives advantage on every attack and disadvantage on every saving
  // throw" — the README's own example of a genuine mechanical trade, declaring
  // `attackAdvantage` and `saveDisadvantage`, both read by nothing. Gameplay
  // stopped rolling a d20 when `resolve.js` replaced the die with a margin:
  // there is no attack roll and no saving throw to attach to.
  test('the d20 vocabulary is gone from it', () => {
    const keys = declared();
    assert.equal(keys.has('attackAdvantage'), false);
    assert.equal(keys.has('saveDisadvantage'), false);
    assert.ok(keys.has('accuracyBonus'));
    assert.ok(keys.has('hazardDisadvantage'));
  });

  test('and the ship really does shoot straighter', () => {
    const acc = (traits) => {
      const g = captain({ traits });
      return g.ship.accuracy ?? g.ship.mods?.accuracy ?? null;
    };
    const plain = acc([]);
    const wild = acc(['reckless']);
    assert.ok(plain !== null, 'accuracy is not on the ship, so this measures nothing');
    assert.ok(wild > plain, `${wild} against ${plain}`);
  });

  test('and the landing party pays for it, but only against a real hazard', () => {
    // The narrowing, and the reason it is not "disadvantage on everything":
    // measured over 400 checks, applying it to routine scans as well took away
    // success from 68.3% to 49.5% — too much for a complication a player takes
    // alongside a single advantage. A saving throw is a reaction to danger.
    const rate = (traits, hazard, runs = 300) => {
      let ok = 0;
      for (let seed = 0; seed < runs; seed++) {
        const g = captain({ traits, seed: BigInt(seed + 1) });
        if (g.buildAwayTeam().check(g.rng, 'science', { hazard }).success) ok++;
      }
      return ok / runs;
    };
    // Unaffected where the work is ordinary.
    assert.equal(rate([], 'routine'), rate(['reckless'], 'routine'));
    assert.equal(rate([], 'elevated'), rate(['reckless'], 'elevated'));
    // And clearly worse where it is not.
    assert.ok(rate(['reckless'], 'dangerous') < rate([], 'dangerous') * 0.8,
      'a dangerous hazard is no worse for a reckless captain');
    assert.ok(rate(['reckless'], 'extreme') < rate([], 'extreme') * 0.8);
  });

  test('and this is the first thing in the game to use disadvantage at all', () => {
    // `resolve()` has documented a `disadvantage` argument since it was written
    // and no caller anywhere had ever passed one — the whole downside half of
    // the resolution system was unreachable code.
    const src = sourceText();
    assert.match(src, /disadvantage,/, 'nothing passes disadvantage to resolve');
    const g = captain({ traits: ['reckless'] });
    const roll = g.buildAwayTeam().check(g.rng, 'science', { hazard: 'extreme' });
    assert.equal(roll.disadvantage, true, 'the roll did not come back marked');
  });
});

describe('two more traits that did nothing, and a method nobody calls', () => {
  // `Character.checkModifier` applied `hasTrait('haunted') ? +3` — the same 3
  // the trait declares as `compensation`, hardcoded, and the FOURTH instance of
  // that shape after `critSeverity`, `hazardScale` and `peaceGain`.
  //
  // It is also a method with no caller anywhere in `src/`. `AwayTeam.
  // modifierFor` is what the game uses and it builds the modifier itself, so
  // Haunted's +3 was dead code inside a dead method: a trait declared
  // `positive: false` that cost nothing and gave nothing.
  const team = (traits, hull = 1) => {
    const g = captain({ traits });
    g.ship.hull = g.ship.maxHull * hull;
    return g;
  };
  const rate = (traits, checkType, hull, runs = 300) => {
    let ok = 0;
    for (let seed = 0; seed < runs; seed++) {
      const g = captain({ traits, seed: BigInt(seed + 1) });
      g.ship.hull = g.ship.maxHull * hull;
      if (g.buildAwayTeam().check(g.rng, checkType, { hazard: 'elevated' }).success) ok++;
    }
    return ok / runs;
  };

  test('the +3 is no longer written out beside the number it copies', () => {
    const code = readFileSync('src/rules/character.js', 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, /hasTrait\('haunted'\)/,
      'the trait is hardcoded again instead of read');
  });

  test('and Haunted pays on everything except the check it charges', () => {
    const plain = team([]).buildAwayTeam();
    const hurt = team(['haunted']).buildAwayTeam();
    assert.equal(hurt.modifierFor('science').total, plain.modifierFor('science').total + 3);
    assert.equal(hurt.modifierFor('command').total, plain.modifierFor('command').total,
      'the compensation is paid on the check it is meant to charge');
    // Itemised, because `parts` exists so a captain can see which of his own
    // history produced the number.
    assert.ok(hurt.modifierFor('science').parts.some((p) => /ship you lost/i.test(p.source)));
  });

  test('and charges it only when the ship is nearly gone', () => {
    assert.equal(rate(['haunted'], 'command', 1), rate([], 'command', 1),
      'a whole ship panicked a haunted captain');
    assert.ok(rate(['haunted'], 'command', 0.2) < rate([], 'command', 0.2) * 0.95,
      'a quarter-hull ship did not');
    // And the compensation still applies down there, on everything else.
    assert.ok(rate(['haunted'], 'science', 0.2) > rate([], 'science', 0.2));
  });

  test('and Notorious is worse at diplomacy and nothing else', () => {
    assert.ok(rate(['notorious'], 'diplomacy', 1) < rate([], 'diplomacy', 1) * 0.95,
      'a captain hostiles fear negotiates just as well');
    assert.equal(rate(['notorious'], 'science', 1), rate([], 'science', 1));
  });
});

describe('hostiles that break off sooner out of fear', () => {
  // Notorious's other half, wired one pass after its Diplomacy penalty. And a
  // second duplicate folded into it: the Living Legend feat said "enemies
  // hesitate" through `enemyHesitation`, which is the same thing `fearFactor`
  // says, and a second knob doing one job is what §68 deleted `hazardScale`
  // for. The feat declares the working key now, at a smaller number.
  const brokeOffAt = (traits, feats, classId, faction, runs = 40) => {
    const at = [];
    for (let seed = 0; seed < runs; seed++) {
      // An Excelsior with a tactical captain, not the Constitution the rest of
      // this file uses. Against a Constitution the player is destroyed in most
      // of these fights before the D7 ever decides to run, and the first draft
      // of this test measured "too few break-offs to compare" for exactly that
      // reason — the harness, not the mechanic.
      const g = captain({
        traits, seed: BigInt(seed + 1), shipClass: 'excelsior',
        speciesId: 'andorian', careerId: 'tactical',
      });
      for (const f of feats ?? []) g.character.feats.push(f);
      const foe = new Ship(classId, { faction, name: 'T' });
      g.startCombat([foe]);
      let hull = null;
      for (let i = 0; i < 40000 && g.engagement && !g.engagement.over; i++) {
        g.engagement.update(1 / 30);
        if (foe.fleeing && hull === null) hull = foe.hullPct;
      }
      if (hull !== null) at.push(hull);
    }
    return { ran: at.length, mean: at.length ? at.reduce((a, b) => a + b, 0) / at.length : null };
  };

  test('the duplicate is gone and the feat declares the working key', () => {
    const keys = declared();
    assert.equal(keys.has('enemyHesitation'), false,
      'enemyHesitation is back; it is fearFactor under another name');
    assert.ok(keys.has('fearFactor'));
  });

  test('a Klingon breaks off with more hull left against a captain they fear', () => {
    // Measured at the moment the flag flips, not from the outcome: a fleeing
    // D7 is nearly dead either way, so survival barely moves and the duel is
    // too coarse an instrument to see this at all. The first attempt used it
    // and read 30% against 33%.
    const plain = brokeOffAt([], null, 'd7', 'klingon');
    const feared = brokeOffAt(['notorious'], null, 'd7', 'klingon');
    assert.ok(plain.ran > 20 && feared.ran > 20, 'too few break-offs to compare');
    assert.ok(feared.mean > plain.mean * 1.5,
      `${(feared.mean * 100).toFixed(1)}% against ${(plain.mean * 100).toFixed(1)}%`);
  });

  test('and the feat is worth less than the trait, which is what it costs', () => {
    // Notorious pays for its 0.15 with disadvantage on every Diplomacy check.
    // The feat's 0.08 is a rank-five second clause.
    const legend = brokeOffAt([], ['legend'], 'd7', 'klingon');
    const plain = brokeOffAt([], null, 'd7', 'klingon');
    const feared = brokeOffAt(['notorious'], null, 'd7', 'klingon');
    assert.ok(legend.mean > plain.mean, 'the feat does nothing');
    assert.ok(legend.mean < feared.mean, 'the feat is worth as much as the trait');
  });

  test('and nothing frightens a Borg cube', () => {
    // The zero-preservation, and the reason fear is ADDED where the base is
    // above nought rather than multiplied into it. `fanatic` and `assimilate`
    // break off at exactly zero, and that is the whole meaning of those two
    // doctrines.
    const cube = brokeOffAt(['notorious'], null, 'borg_cube', 'borg', 8);
    assert.equal(cube.ran, 0, 'a Borg cube ran away');
  });
});
