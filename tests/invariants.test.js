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

// ================================================== what the audit turned up

describe('a kill is an event, whatever did the killing', () => {
  // `onDestroyed` used to be called from one place: straight after a hit
  // landed, on `if (target.destroyed)`. But a hit never destroys anything —
  // takeDamage takes the hull to zero and starts a warp core breach, and the
  // ship is not flagged destroyed until that countdown ends twenty seconds
  // later inside Ship.update. So the explosion, the sound, the event and the
  // log line fired only when a ship was hit again while already breaching.
  // Almost every kill in this game happened in complete silence.

  test('a ship that dies to its own breach is still announced', async () => {
    const { on } = await import('../src/core/events.js');
    const seen = [];
    on('combat:destroyed', ({ ship }) => seen.push(ship.name));

    // Relentless, or the fight ends the instant a hostile at zero hull is
    // flagged as fleeing and the breach never gets to run.
    const g = new Game({ seed: 7n, crewMode: 'original' });
    g.startCombat([new Ship('scoutship', { name: 'Doomed' })], { relentless: true });
    const enemy = g.engagement.hostiles[0];
    enemy.hull = 0;
    enemy.beginBreach(0.5);
    for (let t = 0; t < 120 && g.engagement && !g.engagement.over; t++) g.update(STEP);

    assert.ok(enemy.destroyed, 'the breach never went off');
    assert.ok(seen.includes(enemy.name), `nothing announced the death of ${enemy.name}`);
  });

  test('and announced exactly once', () => {
    const g = fight('scoutship');
    const eng = g.engagement;
    const enemy = eng.hostiles[0];
    enemy.hull = 0;
    enemy.destroy('catastrophic hull failure');
    eng.reportDeaths();
    eng.reportDeaths();
    eng.onDestroyed(enemy, g.ship);
    const said = eng.log.filter((l) => /destroyed/.test(l.text));
    assert.equal(said.length, 1, said.map((l) => l.text).join(' | '));
    assert.match(said[0].text, /catastrophic hull failure/);
  });
});

describe('the guns keep looking for something to shoot', () => {
  test('a destroyed target is replaced, not held', () => {
    const g = fight('scoutship', { count: 2 });
    const eng = g.engagement;
    const first = eng.target;
    first.hull = 0;
    first.destroy();
    g.update(STEP);

    assert.notEqual(g.engagement.target, first, 'auto-fire kept its lock on a wreck');
    assert.ok(g.engagement.target, 'the guns were left with no target at all');
    assert.ok(eng.log.some((l) => /Re-acquiring/.test(l.text)), 'nobody said so');
  });

  test('a target that has gone to warp cannot be locked', () => {
    const g = fight('bird_of_prey', { count: 2 });
    const eng = g.engagement;
    const runner = eng.hostiles[0];
    const stayer = eng.hostiles[1];
    eng.setTarget(stayer);
    runner.withdrawn = true;
    eng.setTarget(runner);
    assert.equal(eng.target, stayer, 'locked onto a ship that had left the system');
  });

  test('a ship that has gone to warp is no longer flown around the arena', () => {
    // holdTheArena clamps everything present and turns it back toward the
    // middle. A withdrawn hostile was still present, so a ship the log had
    // just announced as gone came about at the boundary and flew back through
    // the fight — drawn, solid, and untargetable.
    const g = fight('bird_of_prey', { count: 2 });
    const eng = g.engagement;
    const gone = eng.hostiles[0];
    gone.withdrawn = true;
    gone.x = ARENA_RADIUS * 4;
    const before = gone.x;
    for (let t = 0; t < 60; t++) g.update(STEP);
    assert.equal(gone.x, before, 'a withdrawn ship was still being steered');
    assert.ok(!eng.allShips.includes(gone), 'a withdrawn ship is still in the fight');
  });
});

describe('breaking off', () => {
  test('dying on the escape tick is dying, not escaping', () => {
    const g = fight('vorcha');
    const eng = g.engagement;
    eng.warpOutTimer = STEP / 2;
    g.ship.hull = 0;
    g.ship.destroy('catastrophic hull failure');
    g.update(STEP);

    assert.equal(g.lastCombat?.outcome ?? eng.outcome, 'destroyed',
      'a destroyed ship warped away and kept the campaign going');
  });

  test('the escape has to stay possible for all eight seconds', () => {
    // Checked once, at the order, and never again — so a core ejected during
    // the countdown still got you to warp on a ship with no warp drive.
    const g = fight('d7');
    const eng = g.engagement;
    assert.equal(eng.beginWarpOut(), true);
    assert.ok(eng.warpOutTimer > 0);
    // The warp core takes a hit during the run-up, which is exactly the
    // situation the countdown was never re-checking.
    g.ship.damageSubsystem('warpcore', 1);
    g.update(STEP);
    assert.equal(eng.warpOutTimer, 0, 'the countdown carried on without a warp drive');
    assert.ok(eng.log.some((l) => /not going anywhere/.test(l.text)));
  });
});

test('an order can only target a system that exists', () => {
  // "Target their bridge" is a thing a captain says, and no ship in this game
  // has a `bridge` subsystem — so the order set targetedSubsystem to a key
  // damageSubsystem returns early on, silently removing ALL subsystem damage
  // from the fight while reporting that the order had been given.
  const g = fight();
  const eng = g.engagement;
  assert.equal(eng.targetSubsystem('bridge'), false);
  assert.equal(eng.targetedSubsystem, null);
  assert.equal(eng.targetSubsystem('engines'), true);
  assert.equal(eng.targetedSubsystem, 'engines');
  assert.equal(eng.targetSubsystem(null), true);
  assert.equal(eng.targetedSubsystem, null);
});

test('the combat log does not drown itself', () => {
  // The log holds sixty lines and "No weapons bear on the target" is reported
  // every time the trigger is pulled out of arc — thirty times a second in a
  // stern chase. A minute of manoeuvring flushed every real event out of it.
  const g = fight();
  const eng = g.engagement;
  for (let i = 0; i < 500; i++) eng.pushLog('No weapons bear on the target.', 'tactical');
  eng.pushLog('Hostile destroyed.', 'tactical');

  const noise = eng.log.filter((l) => /No weapons bear/.test(l.text));
  assert.equal(noise.length, 1, `${noise.length} copies of one line`);
  assert.equal(noise[0].repeats, 500);
  assert.ok(eng.log.some((l) => /Hostile destroyed/.test(l.text)),
    'the line that mattered was pushed out of the log');
});

test('a warp core breach survives being saved', () => {
  // Left out of the save, a record taken during the twenty seconds you have to
  // eject the core came back as a ship at zero hull with no countdown running
  // and no way to die — which is exactly `ship.zerohull.adrift`.
  const g = fight();
  g.ship.hull = 0;
  g.ship.beginBreach(20);
  const back = Game.load(JSON.parse(JSON.stringify(g.save())));

  assert.equal(back.ship.breaching, true, 'the breach was cancelled by saving');
  assert.ok(back.ship.breachTimer > 0, `breach timer came back as ${back.ship.breachTimer}`);
  assert.deepEqual(checkGame(back), []);
});

test('a record written before breaches were saved still loads sanely', () => {
  const g = fight();
  g.ship.hull = 0;
  g.ship.beginBreach(20);
  const data = JSON.parse(JSON.stringify(g.save()));
  delete data.ship.breaching;
  delete data.ship.breachTimer;

  const back = Game.load(data);
  assert.equal(back.ship.breaching, true, 'an old save left a dead ship that could not die');
  assert.deepEqual(checkGame(back), []);
});

test('casualties are counted per fight, not per campaign', () => {
  // Crew losses are permanent, so `maxCrew - crew` is the whole campaign's
  // dead. Every later battle re-reported every death that had ever happened.
  const g = fight('scoutship');
  g.ship.crew -= 40;
  g.finishCombat('victory');
  assert.equal(g.lastCombat.crewLost, 40);

  g.startCombat([new Ship('scoutship', { name: 'Second' })]);
  g.finishCombat('victory');
  assert.equal(g.lastCombat.crewLost, 0, 'a fight in which nobody was hurt reported the last one’s dead');

  const recorded = g.ledger.entries.filter((e) => e.kind === 'lives_lost');
  assert.equal(recorded.length, 1, 'the ledger recorded a second casualty entry for the same deaths');
});

describe('a fight cannot be started into a mess', () => {
  test('a second fight reinforces the first instead of deleting it', () => {
    // startCombat used to overwrite `this.engagement` outright: the battle in
    // progress was dropped with no outcome, no experience, no salvage and no
    // ledger entry, and the ships in it stopped existing.
    const g = fight('d7');
    const first = g.engagement;
    const before = first.hostiles.length;
    g.startCombat([new Ship('bird_of_prey', { name: 'Latecomer' })]);

    assert.equal(g.engagement, first, 'the fight in progress was thrown away');
    assert.ok(g.engagement.hostiles.length > before, 'the new hostiles never arrived');
    assert.deepEqual(checkAll(g, OPTS), []);
  });

  test('a captain on a planet is brought back before the shooting starts', () => {
    const g = new Game({ seed: 3n, crewMode: 'original' });
    const body = g.galaxy.systems.find((sys) => sys.id === g.locationId)?.bodies
      ?.find?.((b) => b.kind !== 'gas' && b.kind !== 'star');
    if (!body) return;                      // no landable world in this system
    g.enterOrbit(body.id);
    g.walkOrder = null;
    g.walk.enter('transporter');
    if (!g.beamDown().ok) return;
    assert.equal(g.ashore, true);

    g.startCombat([new Ship('d7', { name: 'Ambush' })]);
    assert.equal(g.ashore, false, 'the captain was left on a planet during a battle');
    assert.deepEqual(checkGame(g), []);
  });

  test('a fight drops the ship out of warp rather than running underneath it', () => {
    const g = new Game({ seed: 3n, crewMode: 'original' });
    const somewhere = g.galaxy.systems.map((sys) => sys.id).find((id) => id !== g.locationId);
    g.setCourse(somewhere, 6);
    assert.ok(g.transit, 'the course was never laid in');

    g.startCombat([new Ship('d7', { name: 'Interceptor' })]);
    assert.equal(g.transit, null, 'the ship was at warp and in a battle at once');
    assert.deepEqual(checkGame(g), []);
  });
});

test('the no-win scenario does not end the commission', () => {
  // The Kobayashi Maru is unwinnable by design and was fought with the real
  // ship, so running it ended the campaign on every difficulty where losing
  // the ship is fatal — which is most of them. A cadet loses the scenario, not
  // their command.
  const g = new Game({ seed: 6n, crewMode: 'original', difficulty: 'commander' });
  g.runKobayashiMaru();
  for (let t = 0; t < 40000 && g.engagement && !g.engagement.over; t++) { pilot(g); g.update(STEP); }
  for (let t = 0; t < 5; t++) g.update(STEP);

  assert.equal(g.lastCombat?.outcome, 'destroyed', 'the no-win scenario was won');
  assert.equal(g.over, false, `the commission ended: ${g.overReason}`);
  assert.equal(g.ship.destroyed, false);
  assert.ok(g.ship.crew > 0, 'the simulator killed the real crew');
  assert.equal(g.kobayashiRuns, 1, 'the attempt went unrecorded');
  assert.deepEqual(checkGame(g), []);
});

test('a ship recovered after a loss has people on it', () => {
  // `restore()` puts the hull and the systems back and says nothing about the
  // crew, so a ship recovered from total crew loss came back with nobody
  // aboard — and a ship with no crew is destroyed on the first tick, so it
  // died again at the start of every later fight, forever.
  const g = new Game({ seed: 11n, crewMode: 'original', difficulty: 'story' });
  g.ship.crew = 0;
  g.ship.destroy('total crew loss');
  g.loseTheShip();

  assert.equal(g.over, false, 'Story difficulty ended the commission anyway');
  assert.ok(g.ship.crew > 0, 'the ship was recovered with nobody aboard');

  g.startCombat([new Ship('scoutship', { name: 'Next' })]);
  for (let t = 0; t < 60; t++) g.update(STEP);
  assert.equal(g.ship.destroyed, false, 'the recovered ship died on the first tick of the next fight');
});

test('an injury outlives the scene it happened in', () => {
  // Healing at `dt * 0.02` is a full recovery in fifty seconds of sitting on
  // the bridge, while the campaign rule says the same injury takes 120 hours.
  // An officer hurt in a battle was back at their post before the wreck had
  // finished burning, and the sickbay that works while the app is closed could
  // never have an effect.
  const g = fight();
  const officer = g.crew.officers[0];
  officer.injured = true;
  officer.injurySeverity = 1;

  for (let t = 0; t < 30 * 300; t++) g.update(STEP);   // five minutes of play
  assert.equal(officer.injured, true, 'five minutes of play healed a serious injury');

  officer.recover(200);                                 // and then time passes
  assert.equal(officer.injured, false, 'campaign time never healed it either');
});

test('a watch officer who fought a battle has something to report', () => {
  const g = new Game({ seed: 8n, crewMode: 'canon', era: 'tos' });
  g.walkOrder = null;
  g.walk.enter('engineering');
  g.updateCon();
  const held = g.conOfficer;
  assert.ok(held, 'nobody took the con');

  g.startCombat([new Ship('scoutship', { name: 'Raider' })]);
  for (let t = 0; t < 20000 && g.engagement && !g.engagement.over; t++) { pilot(g); g.update(STEP); }
  for (let t = 0; t < 5; t++) g.update(STEP);

  g.walkOrder = null;
  g.walk.enter('bridge');
  const lines = g.takeCon().lines.join('\n');
  assert.ok(!/Nothing to report/.test(lines),
    `an officer who fought a battle reported nothing:\n${lines}`);
  assert.match(lines, /engaged/i);
  assert.match(lines, /Hull integrity/);
});

describe('the damage model holds together', () => {
  test('shields come back when the emitter is repaired', () => {
    // One hit on the shield generator used to cost you shields for the rest of
    // the commission: losing the emitter drops them, and nothing raised them
    // again once passive repair had walked the subsystem back to 1.0.
    const s = new Ship('constitution', { isPlayer: true });
    s.damageSubsystem('shields', 1);
    assert.equal(s.shieldsUp, false);
    for (let t = 0; t < 30 * 600; t++) s.update(STEP, null);
    assert.ok(s.subsystems.shields > 0.9, 'the emitter never repaired');
    assert.equal(s.shieldsUp, true, 'the shields stayed down forever');
  });

  test('shields lowered on purpose stay down', () => {
    const s = new Ship('constitution', { isPlayer: true });
    s.shieldsUp = false;
    s.shieldsDown = true;
    for (let t = 0; t < 30 * 60; t++) s.update(STEP, null);
    assert.equal(s.shieldsUp, false, 'the ship raised its own shields against orders');
  });

  test('reinforcing a facing does not destroy the charge it moved', () => {
    // The order moves 20% overcharge onto one facing; the regeneration clamp
    // was a flat minimum against maxShield and deleted it on the next tick, so
    // the order took charge off five facings and threw it away.
    const s = new Ship('constitution', { isPlayer: true });
    s.shields.fore = s.maxShield * 0.3;
    const pool = () => Object.values(s.shields).reduce((a, b) => a + b, 0);
    const before = pool();
    s.reinforceShield('fore');
    const ordered = s.shields.fore;
    assert.ok(ordered > s.maxShield, 'the order produced no overcharge at all');

    s.update(STEP, null);
    assert.ok(s.shields.fore > s.maxShield, `the overcharge was deleted: ${s.shields.fore}`);
    assert.ok(pool() >= before - 1e-6, `the pool lost ${(before - pool()).toFixed(1)} points of charge`);
  });

  test('an overcharged facing settles back rather than holding forever', () => {
    const s = new Ship('constitution', { isPlayer: true });
    s.shields.fore = s.maxShield * 1.2;
    for (let t = 0; t < 30 * 600; t++) s.update(STEP, null);
    assert.ok(Math.abs(s.shields.fore - s.maxShield) < 1,
      `overcharge held at ${s.shields.fore} against a max of ${s.maxShield}`);
  });

  test('an ability that raises a maximum actually raises it', () => {
    // recomputeDerived read `this.mods` rather than `this.mod()`, so buffs were
    // computed, displayed, and ignored by the only numbers they existed for.
    const s = new Ship('constitution', { isPlayer: true });
    const base = s.maxShield;
    s.addBuff({ id: 'shield_harmonics', until: 30, mods: { shieldMax: 1.2 } });
    assert.ok(s.maxShield > base * 1.19, `maxShield stayed at ${s.maxShield}`);

    for (let t = 0; t < 30 * 40; t++) s.update(STEP, null);
    assert.ok(Math.abs(s.maxShield - base) < 1e-6,
      `the buff expired and left the maximum at ${s.maxShield}`);
  });
});

describe('the guns fire what was asked for', () => {
  /** Put the target dead ahead, in range, with everything loaded. */
  function lineUp(g) {
    const eng = g.engagement;
    const foe = eng.hostiles[0];
    foe.x = 300; foe.y = 0; foe.z = 0;
    g.ship.x = 0; g.ship.y = 0; g.ship.z = 0;
    g.ship.heading = 0; g.ship.desiredHeading = 0;
    eng.setTarget(foe);
    for (const w of g.ship.weapons) w.cooldown = 0;
    return eng;
  }

  test('"fire phasers" does not launch photon torpedoes', () => {
    const g = fight();
    const eng = lineUp(g);
    const before = g.ship.torpedoes;
    eng.fireAll('beam');
    assert.equal(g.ship.torpedoes, before, 'an order for phasers spent torpedoes');
  });

  test('"fire torpedoes" launches them', () => {
    const g = fight();
    const eng = lineUp(g);
    const before = g.ship.torpedoes;
    eng.fireAll('torpedo');
    assert.ok(g.ship.torpedoes < before, 'an order for torpedoes launched nothing');
  });

  test('a torpedo that arrives does damage, however far the shooter has drifted', () => {
    // The range used at impact was the LAUNCHER's current distance, not the
    // torpedo's. Torpedoes fly for up to six seconds while both ships move, so
    // a shooter past the 1,200-unit range watched its torpedo arrive and do
    // nothing at all.
    const g = fight('freighter');
    const eng = lineUp(g);
    const foe = eng.hostiles[0];
    foe.shieldsUp = false;
    eng.fireAll('torpedo');
    assert.ok(eng.projectiles.length > 0, 'nothing was launched');

    // The shooter runs well out of torpedo range while it is in flight.
    g.ship.x = -4000;
    const hullBefore = foe.hull;
    for (let t = 0; t < 200 && eng.projectiles.length; t++) eng.updateProjectiles(STEP);
    assert.ok(foe.hull < hullBefore,
      'the torpedo arrived and did nothing because the shooter had moved');
  });
});

describe('nothing repairs the ship mid-firefight', () => {
  test('docking is refused under fire', () => {
    const g = fight();
    g.ship.hull = g.ship.maxHull * 0.2;
    const r = g.dock();
    assert.equal(r.ok, false, 'a spacedock door opened during a battle');
    assert.ok(g.ship.hullPct < 0.25, 'the ship was repaired anyway');
  });

  test('the machine shop is sealed at red alert', () => {
    const g = fight();
    g.stores.duranium = 999;
    assert.equal(g.fabricate('hull_patch').ok, false, 'the shop took a job under fire');
    assert.equal(g.workTheShop(4).ok, false, 'hours were worked under fire');
  });
});

describe('the grid never draws more than it has', () => {
  test('ejecting the core actually costs you the power', () => {
    // `normalize` protects a subsystem from being DRAINED; it was also
    // exempting it from the cap. After ejecting the warp core — which cuts the
    // cap to 45 per cent — asking for 100 to weapons kept 100 to weapons, and
    // the whole point of the ejection penalty went away.
    const s = new Ship('constitution', { isPlayer: true });
    s.beginBreach(20);
    s.ejectCore();
    s.power.set('weapons', 100);
    assert.ok(s.power.total <= s.power.cap,
      `drawing ${s.power.total} against a cap of ${s.power.cap}`);
  });

  test('no preset and no request can exceed the cap', () => {
    const s = new Ship('constitution', { isPlayer: true });
    for (const cap of [s.power.cap, 90, 40, 10]) {
      s.power.cap = cap;
      for (const preset of ['attack', 'defense', 'speed', 'science', 'balanced']) {
        s.power.applyPreset(preset);
        assert.ok(s.power.total <= cap, `${preset} drew ${s.power.total} of ${cap}`);
      }
      for (const sub of Object.keys(s.power.target)) {
        s.power.set(sub, 100);
        assert.ok(s.power.total <= cap, `${sub} at full drew ${s.power.total} of ${cap}`);
      }
    }
  });

  test('the checker notices an overdrawn grid', () => {
    const g = fight();
    g.ship.power.target.weapons = 500;
    assert.ok(checkAll(g, OPTS).some((v) => v.code === 'power.overcap'));
  });
});

test('a doomed attack ship can actually reach what it is ramming', () => {
  // The ram steered in the plane while the contact test measured distance in
  // three dimensions, so a target even slightly above or below was never
  // reached: the ship flew past, under, and out of the fight instead of doing
  // the one thing its doctrine exists for.
  const g = new Game({ seed: 17n, crewMode: 'original' });
  g.startCombat([new Ship('jem_hadar_attack', { name: 'Doomed' })], { relentless: true });
  const eng = g.engagement;
  const foe = eng.hostiles[0];
  foe.hull = foe.maxHull * 0.1;
  // Put it clearly above the player, which is the case that never worked.
  foe.x = 600; foe.y = 0; foe.z = 400;
  g.ship.x = 0; g.ship.y = 0; g.ship.z = 0;
  g.ship.throttle = 0;

  for (let t = 0; t < 30 * 120 && g.engagement && !g.engagement.over; t++) g.update(STEP);
  const closed = Math.hypot(foe.x - g.ship.x, foe.y - g.ship.y, (foe.z ?? 0) - (g.ship.z ?? 0));
  assert.ok(foe.destroyed || closed < 400,
    `it never closed: ${Math.round(closed)} units away, destroyed=${foe.destroyed}`);
});

describe('what the adversarial audit confirmed', () => {
  test('a forced channel cannot outlive the fight it belongs to', () => {
    // The no-win scenario could be beaten by force-quitting it. An engagement
    // is never saved, but the flags that belong to one were — so the first
    // thing typed after resuming was swallowed as an appeal to a commander who
    // was not there, and a scoring sentence wrote `kobayashi_maru_solved` into
    // the permanent record and paid the reputation.
    const g = new Game({ seed: 5n, crewMode: 'original' });
    g.reputation.tracks.klingon.tier = 5;
    for (let i = 0; i < 4; i++) g.ledger.record('ship_destroyed_hostile');
    for (let i = 0; i < 3; i++) g.ledger.record('ship_spared');
    g.runKobayashiMaru();
    for (let i = 0; i < 300; i++) g.update(STEP);
    assert.equal(g.forceChannel().ok, true, 'the channel would not open in the scenario');

    const back = Game.load(JSON.parse(JSON.stringify(g.save())));
    assert.equal(back.gambitOpen, false);
    assert.equal(back.inKobayashi, false);

    const r = back.makeAppeal(
      'I am Captain Reyes. You know my record. I have spared three of your crews. Let them go.');
    assert.equal(r.success, false, 'the scenario was won on an empty bridge');
    assert.ok(!back.ledger.counters.kobayashi_maru_solved);
  });

  test('an appeal with nobody listening is refused wherever it comes from', () => {
    const g = new Game({ seed: 5n, crewMode: 'original' });
    g.gambitOpen = true;
    g.parleyForced = true;
    const r = g.makeAppeal('You know my record. Let them go.');
    assert.equal(r.success, false);
    assert.equal(g.gambitOpen, false, 'the channel stayed open with nobody on it');
  });

  test('the arena turns the AI around, not the captain', () => {
    // Clamping a position holds everyone inside the volume. Rewriting the
    // desired heading is steering, and doing it to the player took the helm out
    // of their hands mid-order without a word.
    const g = fight();
    const eng = g.engagement;
    g.ship.x = ARENA_RADIUS + 400;
    g.ship.y = 0;
    eng.setHeading(0);
    const ordered = g.ship.desiredHeading;
    eng.holdTheArena();

    assert.ok(Math.hypot(g.ship.x, g.ship.y, g.ship.z ?? 0) <= ARENA_RADIUS + 1,
      'the player was not held inside the arena');
    assert.equal(g.ship.desiredHeading, ordered, 'the arena flew the ship for the captain');
    assert.ok(eng.log.some((l) => /edge of the engagement volume/.test(l.text)),
      'nobody mentioned hitting the edge');

    // The AI still gets turned around, because nobody is giving it orders.
    const foe = eng.hostiles[0];
    foe.x = ARENA_RADIUS + 400; foe.y = 0; foe.desiredHeading = 0;
    eng.holdTheArena();
    assert.notEqual(foe.desiredHeading, 0, 'a hostile ground against the wall forever');
  });

  test('a captain saved on a planet wakes up where they were standing', () => {
    // Walker.load resolves the saved position against the room it can see, and
    // the surface does not exist until Game.load rebuilds it — so a captain
    // saved out among the outcrops woke up on the beam-in point.
    const g = new Game({ seed: 3n, crewMode: 'original' });
    const body = g.galaxy.systems.find((sys) => sys.id === g.locationId)?.bodies
      ?.find?.((b) => b.kind !== 'gas' && b.kind !== 'star');
    if (!body) return;
    g.enterOrbit(body.id);
    g.walkOrder = null;
    g.walk.enter('transporter');
    if (!g.beamDown().ok) return;

    // Walk away from the pads.
    g.walk.x += 40;
    g.walk.z -= 25;
    const [wx, wz] = [g.walk.x, g.walk.z];

    const back = Game.load(JSON.parse(JSON.stringify(g.save())));
    assert.equal(back.walk.roomId, 'surface', 'the captain was brought aboard by reloading');
    assert.ok(Math.hypot(back.walk.x - wx, back.walk.z - wz) < 1,
      `moved from ${wx.toFixed(1)},${wz.toFixed(1)} to ${back.walk.x.toFixed(1)},${back.walk.z.toFixed(1)}`);
  });
});

describe('a fight that ends on a sentence ends immediately', () => {
  // Found by the watchdog running inside the real app, which is the whole
  // reason it is in there: `game.mode.stuck — the fight is over but the game
  // is still in combat mode`.
  //
  // Fights that end during the tick were settled by the tick. Fights that end
  // because of something the CAPTAIN SAID — a hail answered with a surrender,
  // the Kobayashi gambit — ran from an order handler outside the tick and left
  // the game in combat mode with a finished engagement until the next frame.
  //
  // The renderer draws between ticks. For that frame the tactical view showed
  // a battle that was over, the order bar offered to fire on nobody, and
  // anything reading `game.mode` got the wrong answer.

  /** Every way the game can settle a fight, and what must be true after. */
  function settled(g, how) {
    assert.equal(g.mode, 'bridge', `${how}: still in ${g.mode} mode`);
    assert.equal(g.engagement, null, `${how}: the engagement was left hanging`);
    assert.equal(g.alert, 'normal', `${how}: still at battle stations`);
    assert.ok(g.lastCombat, `${how}: no after-action record`);
    assert.deepEqual(checkAll(g, OPTS), [], `${how}: the checker still objects`);
  }

  test('the tick settles a fight the tick ended', () => {
    const g = fight('bird_of_prey');
    for (let i = 0; i < 30 * 240 && !g.lastCombat; i++) { pilot(g); g.update(STEP); }
    settled(g, 'fought to a finish');
  });

  test('a hail that ends the fight settles it on the spot', () => {
    // Walk a fight to where a hail can end it, then keep talking until one
    // does. Whatever the diplomacy roll says, the two states that must never
    // coexist are a finished engagement and combat mode.
    let ended = 0;
    for (let seed = 1n; seed <= 12n; seed++) {
      const g = fight('d7', { seed, difficulty: 'story' });
      for (let i = 0; i < 30 * 20; i++) { pilot(g); g.update(STEP); }
      if (!g.engagement || g.engagement.over) continue;

      for (let attempt = 0; attempt < 12 && !g.lastCombat; attempt++) {
        g.hail(attempt % 2 ? 'negotiate' : 'demand_surrender');
        if (g.engagement && !g.engagement.over) { pilot(g); g.update(STEP); }
      }
      if (!g.lastCombat) continue;   // nobody talked their way out of this one
      ended++;
      settled(g, `hail on seed ${seed}`);
    }
    assert.ok(ended > 0, 'no hail in twelve fights ever ended one');
  });

  test('the Kobayashi gambit settles it on the spot', () => {
    const g = new Game({ seed: 11n, crewMode: 'original' });
    if (typeof g.runKobayashiMaru !== 'function') return;
    g.runKobayashiMaru();
    g.gambitOpen = true;
    const r = g.makeAppeal(
      'I am not asking as an officer. There are eighty-one people on that ship '
      + 'and they are freezing. Let me take them off and I will go, and you have '
      + 'my word I will log every word of this.');
    if (!r?.success) return;   // the appeal is judged, not scripted
    settled(g, 'talked them down');
  });

  test('ending an engagement by hand settles it without a tick', () => {
    // The general guarantee, and the one that stops this being fixed once per
    // call site: whoever ends a fight, however they reach it, the game is out
    // of combat before the next line of their code runs. No tick required.
    for (const outcome of ['victory', 'routed', 'escaped', 'parley']) {
      const g = fight('d7');
      g.engagement.end(outcome);
      settled(g, `end('${outcome}') by hand`);
      assert.equal(g.lastCombat.outcome, outcome);
    }
  });

  test('settling does not happen underneath a running tick', () => {
    // The other half of the same guarantee. A fight that ends INSIDE the
    // engagement's own step must not be thrown away while the rest of that
    // step is still running on it — so the hand-back waits for the stack to
    // clear, and by the time `update` returns it has happened.
    const g = fight('bird_of_prey');
    let sawTornDown = 0;
    const originalStep = g.engagement.step.bind(g.engagement);
    g.engagement.step = (dt) => {
      originalStep(dt);
      // Still mid-step: the engagement must still be the game's.
      if (g.engagement === null || g.mode !== 'combat') sawTornDown++;
    };
    for (let i = 0; i < 30 * 240 && !g.lastCombat; i++) { pilot(g); g.update(STEP); }
    assert.equal(sawTornDown, 0, 'the engagement was cleared mid-step');
    settled(g, 'ended inside the step');
  });

  test('no order leaves the game watching a fight that is over', () => {
    // The general form, checked the way the app checks it: a watchdog on every
    // tick, driving a fight to its end through each ending in turn.
    for (const seed of [3n, 9n, 21n]) {
      const g = fight('d7', { seed, difficulty: 'story' });
      const dog = new Watchdog({ every: 1 });
      for (let i = 0; i < 30 * 300; i++) {
        pilot(g);
        g.update(STEP);
        dog.tick(g, OPTS);
        if (g.lastCombat) break;
      }
      assert.deepEqual(dog.summary.map((v) => v.code), [],
        `seed ${seed}: ${dog.summary.map((v) => v.text).join(' | ')}`);
    }
  });
});

// ====================================== every ending, in every situation

describe('the aftermath of a fight is coherent whatever the fight was', () => {
  // "Okay, engage in combat. Okay, combat's done. And the stuff that comes
  // after it is also messed up."
  //
  // Individual endings have their own tests. What none of them covered is the
  // CROSS PRODUCT: five outcomes against the half-dozen situations a captain
  // can be in when the shooting starts. A fight that ends cleanly on an empty
  // bridge is not evidence that one ending in orbit, mid-mission, with the con
  // handed to the first officer, leaves anything behind in one piece.
  //
  // Every combination below has to satisfy the same list, so a rule added to
  // src/sim/invariants.js defends all of them at once.

  const OUTCOMES = ['victory', 'routed', 'escaped', 'parley', 'destroyed'];

  /** The situations a captain can be in when the shooting starts. */
  const SITUATIONS = {
    'on a quiet bridge': () => {},
    'in standard orbit': (g) => {
      const body = g.galaxy.systems.find((s) => s.id === g.locationId)?.bodies
        ?.find?.((b) => b.kind !== 'gas' && b.kind !== 'star');
      if (body) g.enterOrbit(body.id);
    },
    'with the con handed over': (g) => { g.handOverCon?.(); },
    'on a mission': (g) => {
      const m = g.availableMissions?.()[0];
      if (m) g.startMission(m.id);
    },
    'at red alert with shields already down': (g) => {
      g.setAlert('red');
      for (const f of Object.keys(g.ship.shields)) g.ship.shields[f] = 0;
      g.ship.shieldsUp = false;
    },
    'already carrying a wreck': (g) => {
      g.wreck = { tier: 2, systemId: g.locationId, hulls: 1, name: 'Earlier kill' };
    },
  };

  /**
   * Force a fight to a given ending without waiting for the dice.
   *
   * Through `Ship.destroy`, not by setting the flag: destroying a ship zeroes
   * its hull and its shields, and a test that sets `destroyed = true` on its
   * own builds a state the simulation cannot reach and then complains the
   * checker noticed.
   */
  function endWith(g, outcome) {
    const eng = g.engagement;
    if (outcome === 'victory') for (const s of eng.hostiles) s.destroy('test');
    if (outcome === 'routed') for (const s of eng.hostiles) s.fleeing = true;
    if (outcome === 'destroyed') g.ship.destroy('test');
    eng.end(outcome);
  }

  for (const outcome of OUTCOMES) {
    for (const [where, setUp] of Object.entries(SITUATIONS)) {
      test(`${outcome}, ${where}`, () => {
        const g = new Game({ seed: 5n, crewMode: 'original', difficulty: 'commander' });
        setUp(g);
        const wasAshore = g.walk?.roomId === 'surface';
        const orbitBefore = g.orbitBody ?? g.orbit ?? null;

        g.startCombat([new Ship('d7', { name: 'Hostile' })]);
        assert.equal(g.mode, 'combat', 'the fight did not start');

        for (let i = 0; i < 30 * 4; i++) { pilot(g); g.update(STEP); }
        if (!g.lastCombat) endWith(g, outcome);

        // Whatever happened, the simulation must be self-consistent.
        assert.deepEqual(checkAll(g, OPTS), [], 'the checker objects to the result');

        // And the fight must be finished, not merely stopped.
        assert.equal(g.engagement, null, 'an engagement was left hanging');
        assert.ok(g.mode === 'bridge' || g.over,
          `left in ${g.mode} mode with the fight over`);
        assert.ok(g.lastCombat, 'no after-action record was written');
        assert.ok(Number.isFinite(g.lastCombat.crewLost) && g.lastCombat.crewLost >= 0,
          `crewLost is ${g.lastCombat.crewLost}`);
        assert.ok(g.lastCombat.crewLost <= g.ship.maxCrew,
          `${g.lastCombat.crewLost} lost from a crew of ${g.ship.maxCrew}`);

        // The bridge stands down unless the ship was lost.
        if (!g.over && g.lastCombat.outcome !== 'destroyed') {
          assert.equal(g.alert, 'normal', 'still at battle stations');
        }

        // Where the ship WAS is not changed by a fight it survived.
        if (!g.over) {
          assert.equal(g.walk?.roomId === 'surface', wasAshore,
            'the captain was moved between the ship and the ground by a battle');
          const orbitAfter = g.orbitBody ?? g.orbit ?? null;
          assert.equal(!!orbitAfter, !!orbitBefore, 'orbit was gained or lost in a fight');
        }
      });
    }
  }

  test('the orders a fight forbids come back when it ends', () => {
    // dock, fabricate and the machine shop all refuse mid-combat. Refusing
    // FOREVER because a flag was left set is the same bug as accepting them
    // during a battle, and much harder to notice.
    const g = fight('d7');
    assert.equal(g.dock().ok, false, 'docked in the middle of a firefight');

    g.engagement.end('routed');
    assert.equal(g.mode, 'bridge');
    const after = g.dock();
    assert.ok(typeof after === 'object' && after !== null, 'dock returned nothing');
    assert.notEqual(after.reason, 'in combat',
      'the ship is still refusing to dock because of a battle that is over');
  });

  test('the same fight cannot pay out twice', () => {
    // `end` is idempotent and so is the settling behind it. Calling it again
    // must not hand out the experience, the salvage or the standing a second
    // time — and nothing stops a UI, a mission stage and the tick all having a
    // go at it in the same frame.
    const g = fight('d7');
    for (const s of g.engagement.hostiles) s.destroy('test');
    g.engagement.end('victory');

    const record = { ...g.lastCombat };
    const xp = g.progress.xp;
    const kills = g.ledger.counters?.ships_destroyed ?? 0;
    const wreck = g.wreckHere;

    g.finishCombat('victory');
    g.finishCombat('victory');
    g.update(STEP);

    assert.deepEqual({ ...g.lastCombat }, record, 'the after-action record was rewritten');
    assert.equal(g.progress.xp, xp, 'the experience was paid twice');
    assert.equal(g.ledger.counters?.ships_destroyed ?? 0, kills, 'the kill was counted twice');
    assert.deepEqual(g.wreckHere, wreck, 'a second hulk appeared out of nothing');
  });
});
