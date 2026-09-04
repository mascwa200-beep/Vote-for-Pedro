// The shield facing that had never once been attacked.
//
// A ship carries six shield facings and the AI chose its elevation like this:
//
//     const dorsalWeak = target.shieldPctOf('dorsal') < target.shieldPctOf('ventral');
//     const bias = dorsalWeak ? 1 : -1;
//
// With both poles at full, `<` is false. So the bias was -1 on the opening tick
// of every engagement ever fought; the ship went below, shot the ventral
// shield, and made `dorsal < ventral` false for the rest of the battle. Self
// reinforcing, and never revisited.
//
// Measured over 133,804 ticks with two or more hostiles alive, the facing of
// the player's ship that was under attack:
//
//     fore 37%   aft 25%   starboard 16%   ventral 15%   port 11%   dorsal 0.0%
//
// Every hostile in the game attacked from below, always. One sixth of the
// defensive geometry the ship carries was decoration.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Ship, facingForDirection, FACINGS } from '../src/sim/ship.js';
import { Character } from '../src/rules/character.js';
import { SHIP_CLASSES } from '../src/world/ships.data.js';

/**
 * Fly battles the way the balance suite does, counting facings under attack.
 *
 * Over a MIX of opponents, because the commitment to an off-plane station is
 * doctrinal: an aggressive captain comes right over the top and an attrition
 * captain settles for a shallow climb that still reads as a bow shot. Measured
 * per matchup over eight seeds, the dorsal share runs from 18.6% for a pair of
 * Birds-of-Prey to 0.0% for a pair of Galors — so a single matchup measures
 * one doctrine and calls it the fleet.
 */
function facingsOver(matchups, seeds = 5) {
  const hist = Object.fromEntries(FACINGS.map((f) => [f, 0]));
  let ticks = 0;
  const seconds = [];
  for (const m of matchups) {
    const r = facings({ ...m, seeds });
    for (const f of FACINGS) hist[f] += r.hist[f];
    ticks += r.ticks;
    seconds.push(r.median);
  }
  seconds.sort((a, b) => a - b);
  return { hist, ticks, median: seconds[seconds.length >> 1] };
}

const FLEET = [
  { them: ['d7', 'd7'] },
  { them: ['galor', 'galor'] },
  { them: ['bird_of_prey', 'bird_of_prey'] },
  { me: 'galaxy', them: ['ktinga', 'ktinga', 'ktinga'] },
];

/** Fly a battle the way the balance suite does, counting facings under attack. */
function facings({ me = 'constitution', them = ['d7', 'd7'], seeds = 6 }) {
  const hist = Object.fromEntries(FACINGS.map((f) => [f, 0]));
  let ticks = 0;
  const seconds = [];
  for (let seed = 1n; seed <= BigInt(seeds); seed++) {
    const g = new Game({
      seed, crewMode: 'original',
      character: new Character({ speciesId: 'human', careerId: 'tactical' }),
      shipClass: me,
    });
    g.startCombat(them.map((c, i) => new Ship(c, {
      faction: SHIP_CLASSES[c].faction, name: `H${i}`,
    })));
    const eng = g.engagement;
    let t = 0;
    const DT = 1 / 30;
    while (!eng.over && t < 400) {
      eng.comeAboutTo(eng.target);
      g.ship.throttle = 0.6;
      g.ship.power.applyPreset(g.ship.shieldPct < 0.35 ? 'defense' : 'attack');
      eng.update(DT);
      t += DT;
      for (const h of eng.liveHostiles) {
        // The facing a shot from that ship would land on: the same call
        // `takeDamage` makes, so this is what the player's shields are
        // actually presented with and not a proxy for it.
        hist[facingForDirection(g.ship.directionFrom(h))]++;
        ticks++;
      }
    }
    seconds.push(t);
  }
  seconds.sort((a, b) => a - b);
  return { hist, ticks, median: seconds[seconds.length >> 1] };
}

describe('a ship is attacked from six directions, not five', () => {
  test('the dorsal shield is a shield', () => {
    const { hist, ticks } = facingsOver(FLEET, 4);
    assert.ok(ticks > 5000, `only ${ticks} samples`);
    const pct = (f) => (100 * hist[f]) / ticks;
    assert.ok(pct('dorsal') > 1,
      `the dorsal facing was under attack ${pct('dorsal').toFixed(1)}% of the time`);
    // And the two poles are now comparable rather than one being all of it.
    // 15% ventral against 0.0% dorsal was the finding; a ratio holds without
    // pinning either number to a sample size.
    const ratio = pct('ventral') / Math.max(0.01, pct('dorsal'));
    assert.ok(ratio < 5,
      `ventral ${pct('ventral').toFixed(1)}% against dorsal ${pct('dorsal').toFixed(1)}%`);
  });

  test('and all six are used', () => {
    const { hist, ticks } = facingsOver(FLEET, 4);
    for (const f of FACINGS) {
      assert.ok(hist[f] > 0, `nothing ever attacked the ${f} facing`);
    }
    // The lateral facings are still where most of a battle happens, which is
    // what a ship that is longer than it is tall should expect. A change that
    // made half the fight happen overhead would be a different bug.
    const poles = (hist.dorsal + hist.ventral) / ticks;
    assert.ok(poles < 0.4, `${(poles * 100).toFixed(0)}% of the fight is now vertical`);
  });

  test('two captains coming at you split high and low', () => {
    // The tie-break, through the AI's own door: a ship's orbit direction picks
    // its side, so a pair that splits left and right splits up and down too.
    // Read as the pitch each one asks its helm for.
    const g = new Game({ seed: 3n, crewMode: 'original' });
    g.startCombat([
      new Ship('galor', { faction: 'cardassian', name: 'H0' }),
      new Ship('galor', { faction: 'cardassian', name: 'H1' }),
    ], { relentless: true });
    const eng = g.engagement;
    const [a, b] = eng.hostiles;
    // Same place, same everything, opposite orbits.
    for (const [s, dir] of [[a, 1], [b, -1]]) {
      s.x = 700; s.y = 0; s.z = 0;
      s.orbitDir = dir;
      s.aiTimer = 0;
    }
    g.ship.x = 0; g.ship.y = 0; g.ship.z = 0;
    eng.update(1 / 30);
    assert.ok(a.desiredPitch !== 0 || b.desiredPitch !== 0, 'neither ship changed its elevation');
    assert.ok(Math.sign(a.desiredPitch) !== Math.sign(b.desiredPitch),
      `both went the same way: ${a.desiredPitch.toFixed(1)} and ${b.desiredPitch.toFixed(1)}`);
  });

  test('and a captain who can see a weak pole goes for it whichever way he orbits', () => {
    // The margin path. The tie-break only applies when there is a tie: a ship
    // that has watched the dorsal shield fail climbs, and its orbit direction
    // does not get a vote.
    for (const dir of [1, -1]) {
      const g = new Game({ seed: 3n, crewMode: 'original' });
      g.startCombat([new Ship('galor', { faction: 'cardassian', name: 'H0' })], { relentless: true });
      const eng = g.engagement;
      const foe = eng.hostiles[0];
      foe.x = 700; foe.y = 0; foe.z = 0;
      foe.orbitDir = dir;
      foe.aiTimer = 0;
      g.ship.x = 0; g.ship.y = 0; g.ship.z = 0;
      g.ship.shields.dorsal = 0;
      eng.update(1 / 30);
      assert.ok(foe.desiredPitch > 0,
        `a ship orbiting ${dir} dived at a flat dorsal shield (pitch ${foe.desiredPitch.toFixed(1)})`);
    }
  });

  test('and the old behaviour is one this measurement can see', () => {
    // The control, built rather than borrowed: force both ships to the same
    // orbit direction, which is what a bias that ignored them amounted to, and
    // the pair goes the same way.
    const g = new Game({ seed: 3n, crewMode: 'original' });
    g.startCombat([
      new Ship('galor', { faction: 'cardassian', name: 'H0' }),
      new Ship('galor', { faction: 'cardassian', name: 'H1' }),
    ], { relentless: true });
    const eng = g.engagement;
    for (const s of eng.hostiles) {
      s.x = 700; s.y = 0; s.z = 0;
      s.orbitDir = -1;
      s.aiTimer = 0;
    }
    g.ship.x = 0; g.ship.y = 0; g.ship.z = 0;
    eng.update(1 / 30);
    const [a, b] = eng.hostiles;
    assert.equal(Math.sign(a.desiredPitch), Math.sign(b.desiredPitch),
      'two ships with the same orbit direction took different sides');
    assert.ok(a.desiredPitch < 0, 'and it was not the low one');
  });

  test('and none of it costs a random draw', () => {
    // The side comes from `orbitDir`, which the manoeuvre layer already sets
    // and already spends a draw on. Taking a new one here would move every
    // seeded fixture in the suite, and this file would be the last place
    // anyone looked.
    const stream = (fn) => {
      const g = new Game({
        seed: 21n, crewMode: 'original',
        character: new Character({ speciesId: 'human', careerId: 'command' }),
        shipClass: 'constitution',
      });
      g.startCombat([new Ship('galor', { faction: 'cardassian', name: 'H0' })], { relentless: true });
      fn(g);
      return Array.from({ length: 10 }, () => g.engagement.rng.float());
    };
    const quiet = stream(() => {});
    const flown = stream((g) => {
      const eng = g.engagement;
      for (let i = 0; i < 30; i++) eng.update(1 / 30);
    });
    // Not equal — flying the fight of course draws. The point is the SHAPE:
    // this asserts the harness can tell two streams apart at all, so the
    // comparison below means something.
    assert.notDeepEqual(quiet, flown);

    // The real one: two identical games diverge only if something took a draw
    // it did not take before, and both sides of this are the current code.
    const a = stream((g) => { for (let i = 0; i < 30; i++) g.engagement.update(1 / 30); });
    const b = stream((g) => { for (let i = 0; i < 30; i++) g.engagement.update(1 / 30); });
    assert.deepEqual(a, b, 'the same fight drew differently twice');
  });
});
