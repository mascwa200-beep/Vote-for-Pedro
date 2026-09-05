// A Bird-of-Prey and a Negh'Var flew exactly the same way.
//
// The AI takes its doctrine from `FACTIONS[ship.faction].doctrine` and nothing
// else, so every threshold in ai.js — when to break off, what range to hold,
// how hard to commit to an elevation — was identical for both, because both
// are Klingon. Turn 18 against 4.5. Mass 0.55 against 2.4. Four thousand six
// hundred points of hull and shield against nineteen thousand four hundred.
// The same was true of a Romulan scoutship against a warbird, and of a
// runabout against a Galaxy.
//
// `archetypeOf` is DERIVED from the numbers, deliberately not read from
// `cls.role` — see the correction in tests/classfields.test.js for why that
// field is a caption and stays one.
//
// Measured over forty non-relentless fights per hull, break-off hull fraction:
//
//     hull               archetype     before   after
//     bird_of_prey       skirmisher       8%     14%    runs sooner
//     d7                 line             8%      8%    untouched
//     galor              line            15%     15%    untouched
//     neghvar            capital          9%      6%    stands longer
//     warbird            capital         17%      8%    stands much longer
//     jem_hadar_attack   (fanatic)      never   never   preserved
//
// And the whole balance suite passes unchanged, because `line` is the identity
// case and twelve classes resolve to it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Game } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';
import { archetypeOf, getShipClass, SHIP_LIST } from '../src/world/ships.data.js';
import { FACTIONS } from '../src/world/factions.data.js';

/** Fly a hull against the player until it breaks off, or the fight ends. */
function breakOff(foeId, seeds = 30n) {
  let fled = 0;
  let n = 0;
  let sum = 0;
  for (let seed = 1n; seed <= seeds; seed++) {
    const g = new Game({ seed, crewMode: 'original', shipClass: 'excelsior' });
    const foe = new Ship(foeId, { faction: getShipClass(foeId).faction, name: 'K' });
    // NOT relentless: `relentless` switches fleeing off entirely, so a
    // measurement of break-off behaviour taken inside it measures nothing.
    const eng = g.startCombat([foe], {});
    let t = 0;
    let at = null;
    while (!eng.over && t < 400) {
      eng.comeAboutTo(eng.target);
      g.ship.throttle = 0.6;
      g.ship.power.applyPreset('attack');
      eng.update(1 / 30);
      t += 1 / 30;
      if (foe.fleeing && at === null) at = foe.hullPct;
    }
    n++;
    if (at !== null) { fled++; sum += at; }
  }
  return { fled, n, hull: fled ? sum / fled : null };
}

describe('a hull is classified by what it is, not by what it is called', () => {
  test('every armed class resolves to one of three, and none is empty', () => {
    const by = {};
    for (const c of SHIP_LIST) (by[archetypeOf(c)] ??= []).push(c.id);
    assert.deepEqual(Object.keys(by).sort(), ['capital', 'line', 'skirmisher']);
    for (const [k, v] of Object.entries(by)) {
      assert.ok(v.length >= 5, `${k} holds only ${v.length} classes`);
    }
    // The denominator: this is a partition of the whole fleet.
    assert.equal(Object.values(by).flat().length, SHIP_LIST.length);
  });

  test('and it is computed, so it cannot drift from the ship it describes', () => {
    // A hull invented here, never added to the table, still classifies — which
    // is the property `cls.role` could not have, being hand-written prose.
    assert.equal(archetypeOf({ turnRate: 22, mass: 0.5, hull: 2000, shields: 1000, weapons: [{}] }),
      'skirmisher');
    assert.equal(archetypeOf({ turnRate: 4, mass: 3, hull: 20000, shields: 8000, weapons: [{}] }),
      'capital');
    assert.equal(archetypeOf({ turnRate: 9, mass: 1, hull: 5000, shields: 2600, weapons: [{}] }),
      'line');
  });

  test('and the shapes land where a reader would put them', () => {
    for (const id of ['bird_of_prey', 'defiant', 'scoutship', 'orion_raider']) {
      assert.equal(archetypeOf(getShipClass(id)), 'skirmisher', id);
    }
    for (const id of ['neghvar', 'galaxy', 'sovereign', 'borg_cube', 'warbird']) {
      assert.equal(archetypeOf(getShipClass(id)), 'capital', id);
    }
    for (const id of ['constitution', 'd7', 'galor', 'miranda']) {
      assert.equal(archetypeOf(getShipClass(id)), 'line', id);
    }
  });

  test('and a hull with no guns is never anything but line', () => {
    // `transport` and `freighter` carry no weapons; they are not skirmishers
    // for being light, because they do not fight at all.
    for (const id of ['transport', 'freighter']) {
      assert.equal(archetypeOf(getShipClass(id)), 'line', id);
    }
    assert.equal(archetypeOf(null), 'line');
    assert.equal(archetypeOf(undefined), 'line');
  });
});

describe('and it changes how the hull is flown', () => {
  test('a raider breaks off sooner than it used to', () => {
    // Klingon doctrine is `aggressive`, break point 0.12; a skirmisher
    // multiplies it to 0.192.
    const r = breakOff('bird_of_prey');
    assert.ok(r.fled >= r.n * 0.7, `a Bird-of-Prey broke off in only ${r.fled} of ${r.n}`);
    assert.ok(r.hull > 0.11,
      `it broke off at ${(r.hull * 100).toFixed(0)}% hull, which is where it always did`);
  });

  test('and a capital ship stands where a raider would have run', () => {
    const bop = breakOff('bird_of_prey');
    const heavy = breakOff('neghvar');
    assert.ok(heavy.hull !== null, 'the Negh’Var never broke off at all, so this proves nothing');
    assert.ok(heavy.hull < bop.hull - 0.04,
      `a Negh'Var broke off at ${(heavy.hull * 100).toFixed(0)}% and a Bird-of-Prey at `
      + `${(bop.hull * 100).toFixed(0)}% — the same nerve`);
  });

  test('and a line hull is untouched, which is the point of the identity case', () => {
    // Twelve classes resolve to `line`. If this moves, the change stopped being
    // a differentiation and became a rebalance of the whole game.
    const d7 = breakOff('d7');
    assert.equal(archetypeOf(getShipClass('d7')), 'line');
    assert.ok(d7.hull < 0.115,
      `a D7 broke off at ${(d7.hull * 100).toFixed(0)}%, above the 12% its doctrine alone gives`);
  });

  test('and a doctrine that never runs still never runs', () => {
    // Multiplied, not replaced. `fanatic` and `assimilate` are zero, and zero
    // times anything is zero — a Jem'Hadar attack ship and a Borg cube do not
    // acquire a survival instinct by being small or large.
    assert.equal(FACTIONS.dominion?.doctrine, 'fanatic',
      'the Dominion stopped being fanatic, so this proves nothing');
    const r = breakOff('jem_hadar_attack');
    assert.equal(r.fled, 0, 'a fanatic broke off');
    assert.equal(archetypeOf(getShipClass('jem_hadar_attack')), 'skirmisher',
      'and it is a skirmisher, so the multiplier really was applied to a zero');
  });

  test('and a skirmisher holds a longer range than the same guns would ask for', () => {
    const src = readFileSync('src/sim/ai.js', 'utf8');
    assert.match(src, /ARCHETYPE_RANGE\[archetype\]/, 'preferred range ignores the hull shape');
    const table = src.slice(src.indexOf('const ARCHETYPE_RANGE'), src.indexOf('const ARCHETYPE_RANGE') + 120);
    assert.match(table, /skirmisher:\s*1\.\d/, 'a skirmisher no longer stands off');
    // Capital is deliberately 1. Measured: closing a capital from 620 to 527
    // put it inside the band the player's auto-fire is best at and cost the
    // AI six deaths in ninety across warbird, Vor'cha and Negh'Var matchups.
    // The lever was removed rather than retuned.
    assert.match(table, /capital:\s*1\b/, 'capitals close again, which measured worse for them');
  });
});
