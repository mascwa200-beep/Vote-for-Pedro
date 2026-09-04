// What the tactical officer says when the shooting is about to start.
//
// Played through the encounter generator with the balance suite's own pilot —
// a Constitution, thirty-three hostile encounters out of four hundred rolls —
// the distribution of outcomes was not a curve. It was two piles:
//
//     Cardassian patrol   10 of 10 encounters lost the ship
//     Borg                 5 of  5 lost the ship
//     Klingon patrol       4 of  7 lost the ship
//     Ferengi              3 of  4 never took the hull below 90%
//     Orion, independent   never took the hull below 99%
//
// A fight is either nothing or it is fatal, and the captain found out which by
// having it. The game already intends the bad ones to be broken off rather
// than won — `beginWarpOut` exists, the balance suite asserts it works, and the
// difficulty ladder's main lever is enemy COUNT — and it never said which those
// were.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';
import { Character } from '../src/rules/character.js';
import { SHIP_CLASSES } from '../src/world/ships.data.js';
import {
  assessEngagement, powerOf, outputOf, enduranceOf, ASSESSMENT_BANDS,
} from '../src/sim/assess.js';

/** Fly a battle the way the balance suite does. */
function battle({ me, them, seed }) {
  const g = new Game({
    seed, crewMode: 'original',
    character: new Character({ speciesId: 'human', careerId: 'tactical' }),
    shipClass: me,
  });
  g.startCombat(them.map((c, i) => new Ship(c, {
    faction: SHIP_CLASSES[c].faction, name: `H${i}`,
  })));
  const eng = g.engagement;
  const opening = eng.assessment;
  // The ship that FOUGHT. Losing a hull costs you that hull and Starfleet
  // assigns another, so reading `g.ship` afterwards measures a replacement at
  // full health.
  const fought = g.ship;
  let t = 0;
  let low = 1;
  const DT = 1 / 30;
  while (!eng.over && t < 400) {
    eng.comeAboutTo(eng.target);
    g.ship.throttle = 0.6;
    g.ship.power.applyPreset(g.ship.shieldPct < 0.35 ? 'defense' : 'attack');
    eng.update(DT);
    t += DT;
    low = Math.min(low, fought.hullPct);
  }
  return { opening, lost: eng.outcome === 'destroyed', low, g, eng };
}

const CASES = [
  { me: 'constitution', them: ['orion_raider'] },
  { me: 'constitution', them: ['bird_of_prey'] },
  { me: 'constitution', them: ['bird_of_prey', 'bird_of_prey'] },
  { me: 'constitution', them: ['galor'] },
  { me: 'constitution', them: ['galor', 'galor'] },
  { me: 'constitution', them: ['d7'] },
  { me: 'constitution', them: ['d7', 'd7'] },
  { me: 'constitution', them: ['warbird'] },
  { me: 'galaxy', them: ['ktinga', 'ktinga', 'ktinga'] },
  { me: 'sovereign', them: ['borg_cube'] },
  { me: 'excelsior', them: ['galor', 'galor'] },
];

describe('the ship weighs a fight before it has it', () => {
  test('and the reading predicts how the fight goes', () => {
    // The property the whole thing lives or dies by. Grouped by BAND rather
    // than asserted per matchup, because what the assessment claims is that
    // the band means something, not that any one duel comes out a certain way.
    const bands = {};
    for (const c of CASES) {
      for (let seed = 1n; seed <= 4n; seed++) {
        const r = battle({ ...c, seed });
        assert.ok(r.opening, `${c.me} v ${c.them.join('+')} had no assessment`);
        const b = (bands[r.opening.band] ??= { n: 0, lost: 0, low: 0 });
        b.n++;
        b.lost += r.lost ? 1 : 0;
        b.low += r.low;
      }
    }
    // Every band the cases produce has to have been seen, or the ordering
    // below is asserted over two points.
    assert.ok(Object.keys(bands).length >= 4,
      `only ${Object.keys(bands).length} bands appeared`);

    // Ordered by how much ship is left. Measured over twenty-four matchups and
    // ten battles each: 100% / 98% / 81% / 67% / 0%.
    const seen = ASSESSMENT_BANDS.filter((b) => bands[b]);
    const hull = seen.map((b) => bands[b].low / bands[b].n);
    for (let i = 1; i < hull.length; i++) {
      assert.ok(hull[i] <= hull[i - 1] + 0.02,
        `${seen[i - 1]} left ${(hull[i - 1] * 100).toFixed(0)}% of the hull and `
        + `${seen[i]} left ${(hull[i] * 100).toFixed(0)}% — the bands are not ordered`);
    }

    // And the one that says run means run.
    assert.ok(bands.hopeless, 'no matchup was ever rated hopeless');
    assert.equal(bands.hopeless.lost, bands.hopeless.n,
      `${bands.hopeless.n - bands.hopeless.lost} of ${bands.hopeless.n} "outmatched" `
      + 'fights were survivable by fighting them');
    for (const b of ['nocontest', 'favourable', 'even']) {
      if (!bands[b]) continue;
      assert.equal(bands[b].lost, 0, `a fight rated ${b} lost the ship`);
    }
  });

  test('the bridge says it, once, before anybody shoots', () => {
    const { eng, opening } = battle({ me: 'constitution', them: ['galor', 'galor'], seed: 2n });
    assert.equal(opening.band, 'hopeless');
    const said = eng.log.filter((l) => l.text === opening.line);
    assert.equal(said.length, 1, `the assessment was announced ${said.length} times`);
    assert.match(opening.line, /break off/, opening.line);
  });

  test('and it is live, not the opening bell', () => {
    // A battle that was outmatched three ships ago is not outmatched now, and
    // the pill on the tactical display is the one a captain reads to decide
    // whether to run.
    const g = new Game({ seed: 5n, crewMode: 'original' });
    g.startCombat([
      new Ship('galor', { faction: 'cardassian', name: 'H0' }),
      new Ship('galor', { faction: 'cardassian', name: 'H1' }),
      new Ship('galor', { faction: 'cardassian', name: 'H2' }),
    ], { relentless: true });
    const eng = g.engagement;
    const before = eng.assess();
    for (const h of eng.hostiles.slice(1)) h.destroy('test');
    const after = eng.assess();
    assert.ok(after.ratio > before.ratio * 2,
      `killing two of three moved the reading from ${before.ratio.toFixed(2)} to ${after.ratio.toFixed(2)}`);
    assert.equal(eng.assessment.band, before.band,
      'the opening reading changed when the fight did');
  });

  test('and a fight with nobody in it is not a walkover', () => {
    // Infinity and a cheerful line about how short this will be.
    assert.equal(assessEngagement({ player: null, hostiles: [] }), null);
    assert.equal(assessEngagement({
      player: new Ship('constitution', { faction: 'federation' }), hostiles: [],
    }), null);
    assert.equal(assessEngagement(), null);
  });

  test('a destroyed hostile is not a hostile', () => {
    const me = new Ship('constitution', { faction: 'federation' });
    const them = [
      new Ship('galor', { faction: 'cardassian' }),
      new Ship('galor', { faction: 'cardassian' }),
    ];
    const both = assessEngagement({ player: me, hostiles: them });
    them[1].destroy('test');
    const one = assessEngagement({ player: me, hostiles: them });
    assert.ok(one.ratio > both.ratio * 2, 'a wreck is still being counted as a warship');
    // And a ship that has broken off and gone is gone too.
    const [a, b] = [new Ship('galor', { faction: 'cardassian' }), new Ship('galor', { faction: 'cardassian' })];
    b.withdrawn = true;
    assert.equal(
      assessEngagement({ player: me, hostiles: [a, b] }).ratio,
      assessEngagement({ player: me, hostiles: [a] }).ratio,
    );
  });
});

describe('the arithmetic behind it', () => {
  test('two of a ship are four times one of it, not two', () => {
    // Lanchester's square law for aimed fire, which is the shape the
    // measurements have: one Galor takes a Constitution to 83% hull and two of
    // them kill it every single time. A linear model cannot produce that cliff
    // and would rate the pair 'dangerous' rather than 'outmatched'.
    const one = [new Ship('galor', { faction: 'cardassian' })];
    const two = [...one, new Ship('galor', { faction: 'cardassian' })];
    const r = powerOf(two) / powerOf(one);
    assert.ok(Math.abs(r - 4) < 0.01, `two ships are ${r.toFixed(2)} times one`);
  });

  test('a ship with no guns cannot fight and a ship with no hull cannot last', () => {
    const s = new Ship('constitution', { faction: 'federation' });
    assert.ok(outputOf(s) > 0 && enduranceOf(s) > 0);
    assert.equal(powerOf([{ weapons: [], maxHull: 5000, maxShield: 900 }]), 0);
    assert.equal(powerOf([{ weapons: s.weapons, maxHull: 0, maxShield: 0 }]), 0);
    assert.equal(powerOf([]), 0);
    assert.equal(powerOf(null), 0);
  });

  test('and every band is reachable from a real matchup', () => {
    // A band nothing can produce is a band that is not in the game. Reached
    // through the fleet rather than by feeding the function numbers.
    const reach = new Set();
    const P = (me) => new Ship(me, { faction: SHIP_CLASSES[me].faction });
    const H = (list) => list.map((c) => new Ship(c, { faction: SHIP_CLASSES[c].faction }));
    for (const [me, them] of [
      ['constitution', ['orion_raider']],
      ['constitution', ['bird_of_prey']],
      ['constitution', ['galor']],
      ['constitution', ['warbird']],
      ['constitution', ['galor', 'galor']],
    ]) {
      reach.add(assessEngagement({ player: P(me), hostiles: H(them) }).band);
    }
    assert.deepEqual([...reach].sort(), [...ASSESSMENT_BANDS].sort(),
      'some band cannot be produced by any real pairing');
  });

  test('allies count on our side', () => {
    const me = new Ship('constitution', { faction: 'federation' });
    const them = [new Ship('galor', { faction: 'cardassian' }), new Ship('galor', { faction: 'cardassian' })];
    const alone = assessEngagement({ player: me, hostiles: them });
    const helped = assessEngagement({
      player: me, allies: [new Ship('excelsior', { faction: 'federation' })], hostiles: them,
    });
    assert.ok(helped.ratio > alone.ratio * 2, 'an Excelsior alongside changed nothing');
    assert.equal(alone.band, 'hopeless');
    assert.notEqual(helped.band, 'hopeless');
  });
});
