// "Prefer whoever is hurting them most, otherwise the player."
//
// That comment sat above this, in `src/sim/ai.js`:
//
//     const candidates = [engagement.player, ...engagement.allies].filter(stillEngaged);
//     ship.aiTarget = candidates.includes(engagement.player) ? engagement.player : candidates[0];
//
// It never looked at who was hurting them, because nothing anywhere recorded
// who was hurting whom. And the target was chosen ONCE — the pick sat inside
// `if (!stillEngaged(ship.aiTarget))` — so even a rule that could read it would
// only ever have run on the opening tick, before anybody had fired.
//
// What that cost, measured:
//
//     the SS Kobayashi, the freighter in "a civilian freighter is under
//     attack and losing containment", over twenty battles against three
//     raiders:            destroyed 0, damaged 0, UNTOUCHED 20
//
//     a Galaxy-class escort firing alongside a Miranda, twenty battles
//     against two D7s:    damaged 3, untouched 17
//
// Every ally in the game was unshootable while the player lived — including the
// escorts that three separate reputation perks are sold to buy.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Ship, THREAT_HALF_LIFE } from '../src/sim/ship.js';
import { SHIP_CLASSES } from '../src/world/ships.data.js';

const hostile = (cls, i = 0) =>
  new Ship(cls, { faction: SHIP_CLASSES[cls].faction, name: `H${i}` });

/** Fly a fight to its end and report what happened to the ally. */
function withAlly({ me, them, ally, seeds = 20 }) {
  let lost = 0;
  let hurt = 0;
  const left = [];
  for (let seed = 1n; seed <= BigInt(seeds); seed++) {
    const g = new Game({ seed, crewMode: 'original', shipClass: me });
    const friend = new Ship(ally, { name: 'USS Hood', faction: 'federation' });
    const eng = g.startCombat(them.map(hostile), { allies: [friend], relentless: true });
    let t = 0;
    while (!eng.over && t < 300) {
      eng.comeAboutTo(eng.target);
      g.ship.throttle = 0.6;
      eng.update(1 / 30);
      t += 1 / 30;
    }
    if (friend.destroyed) lost++;
    else if (friend.hullPct < 0.999) hurt++;
    left.push(friend.destroyed ? 0 : friend.hullPct);
  }
  left.sort((a, b) => a - b);
  return { lost, hurt, untouched: seeds - lost - hurt, median: left[seeds >> 1] };
}

describe('a ship that is being shot at knows who is shooting', () => {
  test('damage is remembered against whoever dealt it', () => {
    const g = new Game({ seed: 2n, crewMode: 'original' });
    const a = hostile('galor', 0);
    const b = hostile('galor', 1);
    const me = g.ship;
    assert.equal(me.threatFrom(a), 0);

    me.takeDamage(500, { bearing: 0, from: a });
    me.takeDamage(200, { bearing: 0, from: b });
    assert.equal(me.threatFrom(a), 500);
    assert.equal(me.threatFrom(b), 200);
    assert.equal(me.worstThreat([a, b]), a);

    me.takeDamage(400, { bearing: 0, from: b });
    assert.equal(me.worstThreat([a, b]), b, 'the bigger total did not become the worse threat');
  });

  test('and a hazard is nobody', () => {
    // Plasma fronts, debris, collisions and boarding all take damage with no
    // attacker. None of them may become a target.
    const g = new Game({ seed: 2n, crewMode: 'original' });
    g.ship.takeDamage(900, { bearing: 0 });
    assert.equal(g.ship.threat.size, 0);
    g.ship.takeDamage(900, { bearing: 0, from: g.ship });
    assert.equal(g.ship.threat.size, 0, 'the ship recorded itself as a threat');
  });

  test('and a grudge fades', () => {
    // Lately, not ever. A ship that shot at you and has been running since is
    // not the one to come about for.
    const g = new Game({ seed: 2n, crewMode: 'original' });
    const a = hostile('galor');
    g.ship.takeDamage(1000, { bearing: 0, from: a });
    const before = g.ship.threatFrom(a);
    for (let i = 0; i < 30 * THREAT_HALF_LIFE; i++) g.ship.update(1 / 30, g.rng);
    const after = g.ship.threatFrom(a);
    assert.ok(Math.abs(after / before - 0.5) < 0.05,
      `one half-life took ${before.toFixed(0)} to ${after.toFixed(0)}`);
    // And it is eventually forgotten outright rather than kept forever.
    for (let i = 0; i < 30 * THREAT_HALF_LIFE * 12; i++) g.ship.update(1 / 30, g.rng);
    assert.equal(g.ship.threat.size, 0, 'the grudge outlived the war');
  });

  test('and a ship out of the yard is not still holding a grudge', () => {
    // Asserted against `restore()` itself, with no fallback. The first draft
    // of this test cleared the map by hand when the method it guessed at did
    // not exist, which made it pass while proving nothing.
    const g = new Game({ seed: 2n, crewMode: 'original' });
    g.ship.takeDamage(1000, { bearing: 0, from: hostile('galor') });
    assert.ok(g.ship.threat.size > 0, 'nothing was recorded to clear');
    g.ship.restore();
    assert.equal(g.ship.threat.size, 0, 'a full overhaul left the grudge in place');
  });
});

describe('the freighter in a distress call is a ship that can be lost', () => {
  test('it is shot at, and sometimes destroyed', () => {
    const r = withAlly({ me: 'miranda', them: ['orion_raider', 'orion_raider', 'orion_raider'],
      ally: 'freighter' });
    assert.equal(r.untouched, 0, `the freighter was untouched in ${r.untouched} of 20 battles`);
    assert.ok(r.lost > 0, 'the freighter survived every battle');
    assert.ok(r.median < 0.9,
      `the freighter came out of the median battle at ${(100 * r.median).toFixed(0)}% hull`);
  });

  test('and raiders go for it before anyone has given them a reason not to', () => {
    // The opening tick. They were already shooting it when the captain
    // arrived; rule 2 is what makes rule 1 mean anything, because the reason
    // to stop is that you started shooting.
    const g = new Game({ seed: 4n, crewMode: 'original', shipClass: 'miranda' });
    const victim = new Ship('freighter', { name: 'SS Kobayashi', faction: 'independent' });
    const eng = g.startCombat([hostile('orion_raider')], { allies: [victim] });
    eng.update(1 / 30);
    assert.equal(eng.hostiles[0].aiTarget, victim,
      'the raider ignored the defenceless ship it came for');
  });

  test('and it turns on you once you are the one hurting it', () => {
    // A Galor rather than a raider: hurting a 1900-hull raider enough to be
    // noticed also makes it run, and a fleeing ship never reaches target
    // selection at all. The first draft of this test hit an Orion for 1200 and
    // then wondered why nothing reconsidered.
    const g = new Game({ seed: 4n, crewMode: 'original', shipClass: 'constitution' });
    const victim = new Ship('freighter', { name: 'SS Kobayashi', faction: 'independent' });
    const eng = g.startCombat([hostile('galor')], { allies: [victim], relentless: true });
    eng.update(1 / 30);
    assert.equal(eng.hostiles[0].aiTarget, victim);
    // Hurt it enough to be worth noticing, and not enough to send it home.
    eng.hostiles[0].takeDamage(900, { bearing: 0, from: g.ship });
    for (let i = 0; i < 200; i++) eng.update(1 / 30);
    assert.equal(eng.hostiles[0].aiTarget, g.ship,
      'it kept shooting the freighter while we took its shields off');
  });
});

describe('an escort that fires draws fire', () => {
  test('a heavier ally alongside a lighter captain is shot at', () => {
    const r = withAlly({ me: 'miranda', them: ['d7', 'd7'], ally: 'galaxy' });
    assert.ok(r.untouched <= 4,
      `the escort was untouched in ${r.untouched} of 20 battles`);
  });

  test('and so is a lighter one, because it is still shooting', () => {
    const r = withAlly({ me: 'constitution', them: ['d7', 'd7'], ally: 'miranda' });
    assert.ok(r.untouched <= 4,
      `the escort was untouched in ${r.untouched} of 20 battles`);
  });

  test('a hostile thinks again rather than choosing once', () => {
    // The pick used to sit inside `if (!stillEngaged(ship.aiTarget))`, so it
    // ran on the opening tick and never again. Everything above depends on
    // this: a rule about who is hurting you is worthless if it is only asked
    // before anybody has been hurt.
    const g = new Game({ seed: 6n, crewMode: 'original', shipClass: 'constitution' });
    const friend = new Ship('galaxy', { name: 'USS Hood', faction: 'federation' });
    const eng = g.startCombat([hostile('d7')], { allies: [friend], relentless: true });
    eng.update(1 / 30);
    const first = eng.hostiles[0].aiTarget;
    assert.equal(first, g.ship, 'it did not open on the player');
    // Now let the ally be the one hurting it, by a wide margin.
    for (let i = 0; i < 8; i++) {
      eng.hostiles[0].takeDamage(400, { bearing: 0, from: friend });
    }
    for (let i = 0; i < 200; i++) eng.update(1 / 30);
    assert.equal(eng.hostiles[0].aiTarget, friend, 'it never reconsidered');
  });

  test('and it does not thrash between two ships trading fire', () => {
    // Hysteresis. A ship that came about every time the numbers crossed would
    // spend the battle turning instead of shooting.
    const g = new Game({ seed: 7n, crewMode: 'original', shipClass: 'constitution' });
    const friend = new Ship('constitution', { name: 'USS Hood', faction: 'federation' });
    const eng = g.startCombat([hostile('neghvar')], { allies: [friend], relentless: true });
    const foe = eng.hostiles[0];
    let switches = 0;
    let last = null;
    for (let i = 0; i < 900; i++) {
      // Both hurt it, near enough equally, all the way through.
      foe.takeDamage(30, { bearing: 0, from: g.ship });
      foe.takeDamage(31, { bearing: 0, from: friend });
      eng.update(1 / 30);
      if (foe.aiTarget !== last) { switches++; last = foe.aiTarget; }
    }
    assert.ok(switches < 8, `it changed its mind ${switches} times in thirty seconds`);
  });
});

describe('and none of it changes a fight nobody else is in', () => {
  test('a solo battle is exactly what it was', () => {
    // The control that matters most. With no allies there is one candidate, so
    // a change to how a target is CHOSEN must move nothing at all — and this
    // is the measurement that says the balance is untouched: 71 of 100 lost,
    // before and after, to the ship.
    let lost = 0;
    let n = 0;
    for (const [me, them] of [
      ['constitution', ['galor', 'galor']],
      ['constitution', ['d7', 'd7']],
      ['miranda', ['bird_of_prey', 'bird_of_prey']],
      ['excelsior', ['keldon', 'keldon']],
    ]) {
      for (let seed = 1n; seed <= 25n; seed++) {
        const g = new Game({ seed, crewMode: 'original', shipClass: me });
        const eng = g.startCombat(them.map(hostile));
        let t = 0;
        while (!eng.over && t < 400) {
          eng.comeAboutTo(eng.target);
          g.ship.throttle = 0.6;
          g.ship.power.applyPreset(g.ship.shieldPct < 0.35 ? 'defense' : 'attack');
          eng.update(1 / 30);
          t += 1 / 30;
        }
        n++;
        if (eng.outcome === 'destroyed') lost++;
      }
    }
    assert.equal(n, 100);
    assert.ok(Math.abs(lost - 71) <= 6, `${lost} of 100 lost, against 71 before the change`);
  });

  test('and a hostile with nobody to shoot at does not crash', () => {
    const g = new Game({ seed: 8n, crewMode: 'original' });
    const eng = g.startCombat([hostile('galor')]);
    g.ship.destroy('test');
    for (let i = 0; i < 60; i++) eng.update(1 / 30);
    assert.ok(true, 'the fight kept running with nobody to shoot');
  });
});
