// The standing proof that a fight cannot go wrong.
//
// tests/sim.test.js already proves specific things about combat: that fights
// terminate, that nothing leaves the arena, that a hostile number cannot poison
// the helm. Each of those was written after a specific bug, which means each of
// them only ever catches that bug again.
//
// This file is the other half. src/sim/invariants.js states every rule the
// simulation must obey; the soak below runs a large sample of fights and checks
// ALL of those rules on EVERY tick, so a rule written once defends every fight
// anybody ever adds — including the ones nobody thought to write a test for.
//
// Two real defects were found the first time it ran, and both have their own
// regression test at the bottom of this file:
//
//   Fires subtracted from the hull without a floor, so a burning ship went to
//   negative hull and every percentage computed from it read nonsense.
//
//   `finishCombat` — the experience, the salvage, the faction standing, the
//   casualty record, losing the ship — was called from ONE event listener in
//   main.js, which is to say only when a screen was attached. Headless, a
//   fight ended and nothing followed it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkCombat, checkGame, checkAll, Watchdog, LIMITS, bySeverity,
} from '../src/sim/invariants.js';
import { Game } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';
import { ARENA_RADIUS } from '../src/sim/combat.js';

const STEP = 1 / 30;
const OPTS = { arenaRadius: ARENA_RADIUS };

/** A game already shooting at something. */
function fight(hostileId = 'd7', { count = 1, seed = 7n, difficulty = 'commander' } = {}) {
  const g = new Game({ seed, crewMode: 'original', difficulty });
  g.startCombat(Array.from({ length: count }, (_, i) =>
    new Ship(hostileId, { name: `Hostile ${i + 1}` })));
  return g;
}

/** Drive the player like a player: nose on the target, throttle down, guns out. */
function pilot(g) {
  const eng = g.engagement;
  if (!eng || eng.over) return;
  if (!eng.target || eng.target.destroyed) eng.cycleTarget();
  const mark = eng.target ?? eng.liveHostiles[0];
  if (mark) eng.comeAboutTo(mark);
  eng.setThrottle(1);
  eng.fireAll();
}

describe('the checker itself', () => {
  test('a healthy fight violates nothing', () => {
    const g = fight();
    assert.deepEqual(checkAll(g, OPTS), []);
  });

  test('it never throws, whatever it is handed', () => {
    for (const junk of [null, undefined, {}, { allShips: null }, { hostiles: 5 },
      { allShips: [null, undefined, 'a ship'] }]) {
      assert.doesNotThrow(() => checkCombat(junk, OPTS), `checkCombat(${JSON.stringify(junk)})`);
      assert.doesNotThrow(() => checkGame(junk), `checkGame(${JSON.stringify(junk)})`);
    }
  });

  test('it does not mutate what it inspects', () => {
    const g = fight('vorcha', { count: 2 });
    for (let i = 0; i < 300; i++) { pilot(g); g.update(STEP); }
    const before = JSON.stringify(g.engagement?.save?.() ?? {
      t: g.engagement?.time, hull: g.ship.hull, x: g.ship.x, y: g.ship.y,
    });
    checkAll(g, OPTS);
    const after = JSON.stringify(g.engagement?.save?.() ?? {
      t: g.engagement?.time, hull: g.ship.hull, x: g.ship.x, y: g.ship.y,
    });
    assert.equal(before, after, 'the invariant checker changed the state it was reading');
  });

  test('it catches a poisoned position', () => {
    const g = fight();
    g.engagement.hostiles[0].x = NaN;
    const v = checkAll(g, OPTS);
    assert.ok(v.some((x) => x.code === 'ship.x.finite'), JSON.stringify(v));
    assert.equal(v[0].severity, 'fatal', 'a NaN position did not sort worst-first');
  });

  test('it catches a ship outside the arena', () => {
    const g = fight();
    g.engagement.hostiles[0].x = ARENA_RADIUS * 20;
    assert.ok(checkAll(g, OPTS).some((x) => x.code === 'ship.arena'));
  });

  test('it catches a fight that can no longer end', () => {
    // Every hostile gone, the player alive, and `over` still false. This is the
    // soft-lock shape, and it is the single most important rule in the file.
    const g = fight();
    g.engagement.hostiles.length = 0;
    assert.ok(checkCombat(g.engagement, OPTS).some((x) => x.code === 'eng.unresolved'));
  });

  test('it catches a target that has left the board', () => {
    const g = fight('bird_of_prey', { count: 2 });
    g.engagement.target = g.engagement.hostiles[0];
    g.engagement.hostiles[0].withdrawn = true;
    assert.ok(checkCombat(g.engagement, OPTS).some((x) => x.code === 'eng.target.withdrawn'));
  });

  test('it catches a projectile leak', () => {
    const g = fight();
    const p = g.engagement.projectiles[0] ?? {
      x: 0, y: 0, z: 0, life: 4, speed: 400,
      target: g.engagement.hostiles[0], attacker: g.ship, weapon: { name: 'torpedo' },
    };
    g.engagement.projectiles = Array.from({ length: LIMITS.projectiles + 1 }, () => ({ ...p }));
    assert.ok(checkCombat(g.engagement, OPTS).some((x) => x.code === 'eng.projectiles.leak'));
  });

  test('zero hull is legal while the core is counting down, and not otherwise', () => {
    const g = fight();
    const enemy = g.engagement.hostiles[0];
    enemy.hull = 0;
    enemy.breaching = true;
    assert.ok(!checkAll(g, OPTS).some((x) => x.code === 'ship.zerohull.adrift'),
      'a breaching ship at zero hull was reported as a defect');
    enemy.breaching = false;
    assert.ok(checkAll(g, OPTS).some((x) => x.code === 'ship.zerohull.adrift'),
      'a ship at zero hull with no breach running went unreported');
  });
});

describe('the watchdog', () => {
  test('it reports each distinct problem once and counts the repeats', () => {
    const g = fight();
    const seen = [];
    const dog = new Watchdog({ onViolation: (v) => seen.push(v.code) });
    g.engagement.hostiles[0].y = NaN;
    for (let i = 0; i < 10; i++) dog.tick(g, OPTS);

    assert.deepEqual([...new Set(seen)], seen, 'the same code was reported twice');
    assert.ok(seen.includes('ship.y.finite'));
    const entry = dog.summary.find((v) => v.code === 'ship.y.finite');
    assert.ok(entry.count >= 10, `counted ${entry.count} of 10 ticks`);
  });

  test('it can throw, for tests that want a fight to stop at the first fault', () => {
    const g = fight();
    const dog = new Watchdog({ throwOn: 'fatal' });
    assert.doesNotThrow(() => dog.tick(g, OPTS));
    g.ship.x = Infinity;
    assert.throws(() => dog.tick(g, OPTS), /invariant violated \[ship\.x\.finite\]/);
  });

  test('sampling every Nth tick costs a fraction of the checks', () => {
    const g = fight();
    const dog = new Watchdog({ every: 10 });
    for (let i = 0; i < 100; i++) dog.tick(g, OPTS);
    assert.equal(dog.ticks, 100);
    assert.equal(dog.checked, 10);
  });
});

// ================================================================= the soak

// The point of the whole file. Every rule, every tick, across a spread of
// hulls, hostile counts and difficulty rungs — and then three hundred more
// ticks AFTER each fight resolves, because "combat's done and the stuff that
// comes after is messed up" is its own failure mode.
test('no rule is ever broken, in any fight, at any difficulty', () => {
  const HOSTILES = [
    'bird_of_prey', 'd7', 'ktinga', 'vorcha', 'neghvar', 'warbird', 'scoutship',
    'galor', 'keldon', 'marauder', 'orion_raider', 'tholian_web_spinner',
    'jem_hadar_attack', 'jem_hadar_battleship', 'borg_cube', 'freighter', 'transport',
  ];
  const DIFFS = ['story', 'cadet', 'lieutenant', 'commander', 'captain', 'admiral', 'fleet_admiral'];

  const dog = new Watchdog();
  let unresolved = 0;
  let ticks = 0;

  for (let i = 0; i < 68; i++) {
    const g = new Game({
      seed: BigInt(84000 + i), crewMode: 'original', difficulty: DIFFS[i % DIFFS.length],
    });
    const id = HOSTILES[i % HOSTILES.length];
    g.startCombat(Array.from({ length: 1 + (i % 3) }, (_, k) =>
      new Ship(id, { name: `Hostile ${k + 1}` })));
    const eng = g.engagement;

    for (let t = 0; t < 20000 && g.engagement && !g.engagement.over; t++) {
      pilot(g);
      g.update(STEP);
      dog.tick(g, OPTS);
      ticks++;
    }
    if (g.engagement && !g.engagement.over) unresolved++;

    // And the aftermath. The fight is settled; the game must stay sane.
    for (let t = 0; t < 300; t++) { g.update(STEP); dog.tick(g, OPTS); ticks++; }
    assert.ok(eng.over, `${id} x${1 + (i % 3)}: the engagement object never closed`);
  }

  assert.equal(unresolved, 0, 'fights that never ended');
  assert.ok(ticks > 100000, `only ${ticks} ticks simulated; the soak is not soaking`);
  assert.deepEqual(dog.summary.map((v) => `${v.severity} ${v.code}: ${v.text}`), [],
    `${dog.total} invariant violations across ${ticks} ticks`);
});

test('a fight survives being saved and loaded on any tick', () => {
  // The player can close the app mid-fight. What comes back has to be sane
  // even though the engagement itself does not survive a reload.
  for (const at of [1, 40, 300, 1200]) {
    const g = fight('vorcha', { seed: BigInt(500 + at) });
    for (let t = 0; t < at && g.engagement && !g.engagement.over; t++) { pilot(g); g.update(STEP); }

    const back = Game.load(JSON.parse(JSON.stringify(g.save())));
    assert.deepEqual(checkGame(back), [], `a save at tick ${at} loaded into a broken game`);
    for (let t = 0; t < 200; t++) back.update(STEP);
    assert.deepEqual(checkGame(back), [], `a save at tick ${at} went wrong 200 ticks after loading`);
  }
});

// ============================================================== regressions

test('fire cannot drive the hull below zero', () => {
  // Every write to the hull is floored at zero except this one was not, and it
  // is the only damage applied outside takeDamage. A ship burning at zero hull
  // kept subtracting for the whole twenty-second breach countdown.
  const g = fight();
  const s = g.ship;
  s.hull = 1;
  s.fires = 9;
  for (let t = 0; t < 400; t++) {
    s.update(STEP, g.rng);
    assert.ok(s.hull >= 0, `hull reached ${s.hull} on tick ${t}`);
    assert.ok(s.hullPct >= 0, `hullPct reached ${s.hullPct}`);
  }
});

describe('the game finishes its own fights', () => {
  // finishCombat used to run from one on('combat:end') listener in main.js.
  // Nothing here attaches a screen, so all of it is proof that the rules no
  // longer depend on one being attached.

  test('the engagement is cleared and the mode goes back', () => {
    const g = fight('scoutship');
    for (let t = 0; t < 20000 && g.engagement && !g.engagement.over; t++) { pilot(g); g.update(STEP); }
    for (let t = 0; t < 10; t++) g.update(STEP);

    assert.equal(g.engagement, null, 'the finished engagement was left lying around');
    assert.notEqual(g.mode, 'combat', 'the game stayed in combat mode after the fight');
    assert.ok(g.lastCombat, 'no after-action record was written');
    assert.ok(['victory', 'routed', 'destroyed', 'escaped'].includes(g.lastCombat.outcome),
      `outcome was ${g.lastCombat.outcome}`);
  });

  test('the after-action record says what actually happened', () => {
    const g = fight('freighter');
    for (let t = 0; t < 20000 && g.engagement && !g.engagement.over; t++) { pilot(g); g.update(STEP); }
    for (let t = 0; t < 10; t++) g.update(STEP);

    const r = g.lastCombat;
    assert.equal(r.hostiles, 1);
    assert.ok(r.seconds > 0, `the fight took ${r.seconds} seconds`);
    assert.ok(r.hullLeft >= 0 && r.hullLeft <= 1, `hull left ${r.hullLeft}`);
    assert.equal(r.systemId, g.locationId);
  });

  test('experience is awarded once, not once per tick', () => {
    const g = fight('scoutship');
    const before = g.progress.xp;
    for (let t = 0; t < 20000 && g.engagement && !g.engagement.over; t++) { pilot(g); g.update(STEP); }
    for (let t = 0; t < 5; t++) g.update(STEP);
    const once = g.progress.xp;
    for (let t = 0; t < 600; t++) g.update(STEP);

    if (g.lastCombat.outcome === 'victory' || g.lastCombat.outcome === 'routed') {
      assert.ok(once > before, 'a won fight awarded no experience');
    }
    assert.equal(g.progress.xp, once, 'experience kept accruing after the fight ended');
  });

  test('finishing twice is a no-op, not a second payout', () => {
    const g = fight('scoutship');
    for (let t = 0; t < 20000 && g.engagement && !g.engagement.over; t++) { pilot(g); g.update(STEP); }
    for (let t = 0; t < 5; t++) g.update(STEP);
    const xp = g.progress.xp;
    const stores = JSON.stringify(g.stores);

    g.finishCombat('victory');
    g.finishCombat('victory');
    assert.equal(g.progress.xp, xp, 'a second finishCombat paid out again');
    assert.equal(JSON.stringify(g.stores), stores, 'a second finishCombat salvaged the wreck again');
  });
});
