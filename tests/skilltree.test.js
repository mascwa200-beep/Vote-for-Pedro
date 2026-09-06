// The skill tree, and the two numbers the away check was given and never read.
//
// The tree is where the experience the whole game awards actually goes: four
// branches, seventeen skills, a limited number of points and no way to get one
// back. Twelve of the seventeen buy a ship modifier and those all work. The
// other five buy a `special` — a named effect some other system is supposed to
// ask for — and three of those five were asked for by nobody:
//
//   away_science     Exobiology, three ranks of the science branch. Its one
//                    reader in the whole of src/ handed it to `AwayTeam.check`
//                    as a `captainBonus` option `check` does not accept and
//                    never has. `mods` is empty, so the skill bought NOTHING.
//   crew_morale      Inspiration. No reader at all.
//   ally_bonus       Fleet Tactics. No reader at all — its `mods.damage` half
//                    works, so the ship gets the 4% and "and any allied ships’"
//                    is the part that does not happen.
//
// This file closes the first and holds the other two on a ratchet, so the count
// can only come down.
//
// The same call site was dropping a second number. Eleven episode choices
// declare `check.difficulty` — 0.4 through 0.6 on a 0.05 grid — and `check` had
// no such parameter, so every episode check in the game ran at its hazard's
// default DC. Two `dangerous` scenes as different as talking a saboteur down
// and holding a breaching core against a deadline were exactly the same roll.
//
// Measured, 800 checks per cell:
//
//   declared    0.40   0.45   0.50   0.55   0.60
//   success    94.9%  92.0%  88.4%  85.5%  77.3%
//
//   exobiology     0      1      2      3
//   science    69.4%  79.6%  83.9%  89.6%
//   medical    38.4%  51.0%  53.1%  60.5%
//   combat     55.3%  55.3%  55.3%  55.3%    <- the control, and it is exact

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';
import { RNG, hashSeed } from '../src/core/rng.js';
import { SKILLS, SKILL_LIST } from '../src/sim/skills.js';

/** A captain with `ranks` points already spent on one skill. */
const captain = (skill = null, ranks = 0) => {
  const g = new Game({
    seed: 11n, crewMode: 'original', difficulty: 'lieutenant',
    character: new Character({ speciesId: 'human', careerId: 'science' }),
    shipClass: 'constitution',
  });
  g.progress.xp = 100000;
  g.progress.unspent = 20;
  for (let i = 0; i < ranks; i++) g.progress.spend(skill);
  return g;
};

/**
 * Every .js file under src/ except skills.js, as one string, WITH THE COMMENTS
 * STRIPPED.
 *
 * Without that this sweep is blind, and it was: the comment in `state.js`
 * explaining that `awayScienceBonus` used to have no reader is itself a
 * five-syllable match for `awayScienceBonus`, so unwiring the skill entirely
 * left this file reporting a healthy tree. Prose about dead code reads exactly
 * like live code to a regular expression — the fourth time that has been true
 * in this repo, and the first time it hid a real unwiring rather than merely
 * failing loudly.
 */
function readersOutsideTheTree() {
  let out = '';
  const walk = (d) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      if (n.isDirectory()) walk(`${d}/${n.name}`);
      else if (n.name.endsWith('.js') && n.name !== 'skills.js') {
        out += readFileSync(`${d}/${n.name}`, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
      }
    }
  };
  walk('src');
  return out;
}

/** The getter on CaptainProgress that exposes each named special. */
const GETTER = {
  warpEfficiency: 'warpEfficiency',
  scan: 'scanBonus',
  away_science: 'awayScienceBonus',
  officer_cooldown: 'officerCooldownBonus',
  diplomacy: 'diplomacyBonus',
  ally_bonus: 'allyBonus',
  crew_morale: 'moraleBonus',
};

describe('a skill point buys something', () => {
  test('every special the tree sells has a getter, or the sweep is blind', () => {
    // The instrument first. If a skill grew a `special` with no entry above,
    // the sweep below would skip it and report a clean tree that is not clean.
    for (const s of SKILL_LIST) {
      if (!s.special) continue;
      assert.ok(GETTER[s.special], `${s.id} sells '${s.special}' and this file does not know it`);
    }
  });

  test('and the sweep can tell a read getter from an unread one', () => {
    // The negative control. `warpEfficiency` has thirty-odd readers and
    // `notAGetterAtAll` has none; if both came back the same the probe below
    // is measuring the file list rather than the code.
    const src = readersOutsideTheTree();
    assert.match(src, /warpEfficiency/);
    assert.doesNotMatch(src, /notAGetterAtAll/);
  });

  test('and the specials nothing reads are down to two', () => {
    const src = readersOutsideTheTree();
    const dead = SKILL_LIST
      .filter((s) => s.special && !new RegExp(`\\b${GETTER[s.special]}\\b`).test(src))
      .map((s) => s.id);
    // A ratchet, and it only moves one way. Three before this change:
    // exobiology, inspiration, tactics. Exobiology is wired; the other two are
    // the next sweep's, and this number must never go back up.
    assert.ok(dead.length <= 2,
      `${dead.length} skills buy nothing: ${dead.join(', ')}`);
    assert.deepEqual(dead.includes('exobiology'), false,
      'exobiology went back to buying nothing');
  });

  test('and no skill sells an empty promise on both halves at once', () => {
    // A skill with no `mods` AND a dead `special` is a point spent on air.
    // Inspiration is the last one, and it is named here so closing it is a
    // one-line edit to this test rather than an archaeology exercise.
    const src = readersOutsideTheTree();
    const hollow = SKILL_LIST.filter((s) => !Object.keys(s.mods ?? {}).length
      && (!s.special || !new RegExp(`\\b${GETTER[s.special]}\\b`).test(src))).map((s) => s.id);
    assert.deepEqual(hollow, ['inspiration']);
  });
});

describe('exobiology is a science and medical skill, and only that', () => {
  const rate = (checkType, ranks, n = 400) => {
    let won = 0;
    for (let i = 0; i < n; i++) {
      const team = captain('exobiology', ranks).buildAwayTeam();
      // The seed does NOT vary with `ranks`. It did in the first draft, so the
      // control drifted 51% to 56% on noise alone and read as a small effect.
      if (team.check(new RNG(hashSeed(`${checkType}:${i}`)), checkType,
        { hazard: 'dangerous' }).success) won++;
    }
    return won / n;
  };

  test('a rank reaches the away team at all', () => {
    const none = captain('exobiology', 0).buildAwayTeam().modifierFor('science');
    const full = captain('exobiology', 3).buildAwayTeam().modifierFor('science');
    assert.equal(full.total - none.total, 3, 'three ranks are worth three points');
    assert.ok(full.parts.some((p) => p.source === 'exobiology'),
      'the captain cannot see where the points came from');
    assert.equal(none.parts.some((p) => p.source === 'exobiology'), false);
  });

  test('and it makes science and medicine go better', () => {
    assert.ok(rate('science', 3) > rate('science', 0) + 0.1);
    assert.ok(rate('medical', 3) > rate('medical', 0) + 0.1);
  });

  test('and it does not make anyone better at shooting', () => {
    // The control, paired to the decimal: same seeds, same officers, same
    // hazard, and the only difference is three ranks of a science skill.
    assert.equal(rate('combat', 3), rate('combat', 0));
    assert.equal(rate('stealth', 3), rate('stealth', 0));
  });

  test('and the tree still sells it as what it now is', () => {
    assert.match(SKILLS.exobiology.description, /away team/i);
  });
});

describe('the difficulty a stage declares is the difficulty it gets', () => {
  const dcFor = (declared) => {
    const team = captain().buildAwayTeam();
    return team.check(new RNG(hashSeed('dc')), 'science', { declared, hazard: 'elevated' }).difficulty;
  };

  test('the five values episodes actually use land on five different DCs', () => {
    const seen = [0.4, 0.45, 0.5, 0.55, 0.6].map(dcFor);
    assert.equal(new Set(seen).size, 5, `the dial collapsed: ${seen.join(', ')}`);
    // Monotone, and harder means harder — not merely different.
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i] > seen[i - 1], seen.join(', '));
  });

  test('and a neutral dial is exactly the hazard, so nothing else moved', () => {
    // The control for the whole change: every caller that does not declare a
    // difficulty must roll precisely what it rolled before.
    const team = captain().buildAwayTeam();
    const plain = team.check(new RNG(hashSeed('dc')), 'science', { hazard: 'elevated' }).difficulty;
    assert.equal(dcFor(0.5), plain);
  });

  test('and it composes with an explicit dc rather than replacing it', () => {
    const team = captain().buildAwayTeam();
    const at = (declared) => team.check(new RNG(hashSeed('dc')), 'science',
      { dc: 16, declared, hazard: 'routine' }).difficulty;
    assert.equal(at(0.5) - at(0.4), 2);
    assert.equal(at(0.6) - at(0.5), 2);
  });

  test('and every episode that declares one declares a value inside the grid', () => {
    // If a stage ever writes 0.9 it becomes a fifth hazard band by accident.
    let files = '';
    for (const n of readdirSync('src/missions/episodes')) {
      files += readFileSync(`src/missions/episodes/${n}`, 'utf8');
    }
    const declared = [...files.matchAll(/difficulty:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
    assert.ok(declared.length >= 11, `only ${declared.length} declared difficulties found`);
    for (const d of declared) {
      assert.ok(d >= 0.3 && d <= 0.7, `${d} is outside the band the dial was scaled for`);
      assert.equal(Math.round(d * 20), d * 20, `${d} is off the 0.05 grid`);
    }
  });

  test('and the engine no longer passes an option nothing accepts', () => {
    // Comments stripped first. The comment explaining the removal names the
    // option it removed, and the first draft of this guard failed on its own
    // prose — the third time that has happened in this repo.
    const engine = readFileSync('src/missions/engine.js', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(engine, /captainBonus/,
      'captainBonus is back, and check still does not take it');
    assert.match(engine, /declared: effects\.check\.difficulty/);
  });
});
