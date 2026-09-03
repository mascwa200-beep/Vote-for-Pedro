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
  checkCombat, checkGame, checkAll, Watchdog, LIMITS, bySeverity, LEGAL_MODES,
} from '../src/sim/invariants.js';
import { Game, MODES } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';
import {
  ARENA_RADIUS, buildHostiles, hostileName, HOSTILE_NAMES, OUTCOMES,
  Engagement, MAX_WEAPON_RANGE,
} from '../src/sim/combat.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RNG } from '../src/core/rng.js';
import { Galaxy, plotTransit } from '../src/world/galaxy.js';
import { parseOrder } from '../src/ui/orders.js';
import { ABILITIES } from '../src/sim/officers.js';
// The canonical lists the pools below are drawn from. Hand-written copies of
// these are what let three of the fuzzer's calls do nothing at all.
import { SUBSYSTEM_KEYS } from '../src/sim/ship.js';
import { PRESETS, SUBSYSTEMS } from '../src/sim/power.js';
import { RECIPE_BY_ID } from '../src/sim/fabrication.js';
import { AWAY_TEMPLATES } from '../src/sim/away.js';

const HERE_ROOT = dirname(fileURLToPath(import.meta.url));
const readSrc = (...parts) => readFileSync(join(HERE_ROOT, '..', 'src', ...parts), 'utf8');

/**
 * The departments the intercom answers to, taken from the chair that calls it.
 *
 * `src/ui/chair.js` cannot be imported here — it reaches `document` through
 * touch.js — so its table is read as text, the way wiring.test.js reads
 * main.js. The soak used to pass 'sickbay', which is the LABEL on that button;
 * the id is `medical`, and `Game.intercom` answers anything it does not
 * recognise with the security report. So the soak asked security twice and the
 * doctor never, and got a plausible-looking answer both times.
 */
const INTERCOM_DEPTS = [...readSrc('ui', 'chair.js')
  .match(/INTERCOM_STATIONS = \[([\s\S]*?)\];/)[1]
  .matchAll(/id:\s*'([a-z_]+)'/g)].map((m) => m[1]);

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

// A tour of duty, rather than a fight.
//
// The soak above runs sixty-eight engagements and every one of them is the
// FIRST engagement of a brand new commission. That is not how the game is
// played, and it is not where the bugs are: "combat's done and the stuff that
// comes after it is also messed up" is about the second fight, and the third,
// on a ship that is already damaged, already short of crew, already carrying a
// wreck it never salvaged and a distress call it never cancelled.
//
// So this runs one captain through eight consecutive engagements with the
// ordinary business of a starship in between — repairs, orbits, salvage,
// handing over the con, a log entry — and checks every rule on every tick of
// all of it. The fights themselves are flown much harder than `pilot` flies
// them: subsystem targeting, evasive, decoys, alert levels, a distress call,
// the career signature, and occasionally an order to break off entirely.
test('a tour of duty: fight after fight, on one commission', () => {
  // Rosters by era, and a player ship to match, because the balance the game
  // is built to has always been tier-appropriate: two ships of your own tier
  // is a fight you break off, and two ships a tier above ends the commission
  // in one engagement. A tour that puts a 2260s Constitution against a pair of
  // Vor'chas is not testing the aftermath, it is testing how fast a ship dies.
  const TOS = ['bird_of_prey', 'd7', 'orion_raider', 'scoutship', 'freighter'];
  const TNG = ['ktinga', 'galor', 'marauder', 'keldon', 'bird_of_prey'];
  const LATE = ['vorcha', 'galor', 'keldon', 'jem_hadar_attack', 'marauder'];

  const dog = new Watchdog();
  let ticks = 0;
  let fought = 0;
  let lost = 0;
  const outcomes = new Set();
  const usedPowers = new Set();

  for (const [seed, difficulty, crewMode, shipClass, HOSTILES] of [
    [91001, 'story', 'canon', 'constitution', TOS],
    [91002, 'lieutenant', 'original', 'constitution_refit', TOS],
    [91003, 'commander', 'original', 'excelsior', TNG],
    [91004, 'captain', 'canon', 'galaxy', TNG],
    [91005, 'fleet_admiral', 'original', 'sovereign', LATE],
  ]) {
    const g = new Game({ seed: BigInt(seed), crewMode, difficulty, shipClass });
    const rand = (() => {
      let s = seed >>> 0;
      return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
    })();
    const pick = (list) => list[Math.floor(rand() * list.length)];

    for (let f = 0; f < 8 && !g.over; f++) {
      const id = HOSTILES[(seed + f) % HOSTILES.length];
      const count = 1 + ((seed + f) % 2);
      g.startCombat(Array.from({ length: count }, (_, k) =>
        new Ship(id, { name: `${id} ${k + 1}` })));
      assert.ok(g.engagement, `${difficulty}: fight ${f + 1} never started`);
      fought++;
      for (let t = 0; t < 20000 && g.engagement && !g.engagement.over; t++) {
        const eng = g.engagement;
        if (!eng.target || eng.target.destroyed) eng.cycleTarget();
        const mark = eng.target ?? eng.liveHostiles[0];
        if (mark) eng.comeAboutTo(mark);
        eng.setThrottle(0.35 + rand() * 0.65);
        // A captain who is losing breaks off, which is what the ladder is
        // designed around and what makes a tour last more than one fight.
        //
        // One fight in every tour is also broken off on purpose, because a
        // captain who is winning never triggers the clause above — and once
        // the tour started awarding experience between engagements the
        // captains stopped losing, so the "escaped" path and everything
        // downstream of it went unwalked. As a per-tick roll this drowned the
        // tour instead: a fight is thousands of ticks long, so even a
        // one-in-a-thousand chance decided almost every engagement.
        if ((g.ship.hullPct < 0.35 && eng.warpOutTimer <= 0) || (f === 5 && t === 900)) {
          eng.beginWarpOut();
          eng.evasive(true);
        }

        const roll = rand();
        // 'warp_core' is not a key — it is spelt `warpcore` — and
        // `targetSubsystem` rejects anything not in SUBSYSTEM_KEYS, so this
        // soak had only ever targeted weapons, shields and engines.
        if (roll < 0.004) eng.targetSubsystem(pick([...SUBSYSTEM_KEYS, null]));
        else if (roll < 0.008) eng.evasive(rand() < 0.5);
        else if (roll < 0.010) eng.deployDecoy(2 + rand() * 4);
        else if (roll < 0.012) g.setAlert(pick(['red', 'yellow', 'normal']));
        else if (roll < 0.013) g.callForHelp();
        else if (roll < 0.014) g.useSignature();
        else if (roll < 0.030) {
          // The power tray. Whatever is off cooldown, fired at random — this
          // is the most stateful part of combat (buffs stacking, durations
          // expiring, specials reaching into the hostiles) and until it moved
          // out of the screen no soak could reach it at all.
          const ready = g.readyAbilities();
          if (ready.length) {
            const p = ready[Math.floor(rand() * ready.length)];
            if (g.useAbility(p.officer, p.ability.id).ok) usedPowers.add(p.ability.id);
          }
        } else if (roll < 0.034) {
          g.useDevice(pick(['shield_battery', 'weapons_battery', 'engine_battery', 'hull_patch']));
        }
        eng.fireAll(rand() < 0.15 ? 'torpedo' : 'all');

        g.update(STEP);
        dog.tick(g, OPTS);
        ticks++;
      }

      // The fight is over. Everything that hangs off that has to have
      // happened, on the spot, with nothing left half-finished.
      assert.equal(g.engagement, null,
        `${difficulty} fight ${f + 1}: the engagement was never cleared away`);
      assert.ok(g.lastCombat, `${difficulty} fight ${f + 1}: no after-action record`);
      assert.ok(OUTCOMES.includes(g.lastCombat.outcome),
        `${difficulty} fight ${f + 1}: outcome was ${JSON.stringify(g.lastCombat.outcome)}`);
      assert.equal(g.helpInbound, null, 'a relief ship outlived the fight it was sent to');
      outcomes.add(g.lastCombat.outcome);
      if (g.over) { lost++; break; }

      // A fight broken off ends at warp, because breaking off now goes
      // somewhere. Ride it out to wherever the escape course led — that is the
      // sequence a captain actually flies, and it walks `arrive` on a ship that
      // just ran, which nothing else does.
      if (g.lastCombat.outcome === 'escaped' && g.transit) {
        const ranTo = g.transit.to.id;
        for (let t = 0; t < 30 * 400 && g.transit; t++) { g.update(STEP); dog.tick(g, OPTS); ticks++; }
        assert.equal(g.transit, null,
          `${difficulty} fight ${f + 1}: the escape course never arrived`);
        assert.equal(g.locationId, ranTo,
          `${difficulty} fight ${f + 1}: ran for ${ranTo} and ended up at ${g.locationId}`);
        // Arriving can drop an encounter in your lap, which is fair, but the
        // tour is measuring fights it started itself.
        if (g.encounter) g.endEncounter();
        if (g.engagement && !g.engagement.over) g.engagement.end('routed');
        g.update(STEP);
      }
      assert.equal(g.mode, 'bridge', `${difficulty} fight ${f + 1}: left the game in ${g.mode}`);

      // Damage control between engagements, which is what a captain who
      // intends to fight another one does. Without it a tour is four fights
      // long on the harder rungs and the test measures nothing after that.
      for (let i = 0; i < 4; i++) g.effectRepairs();
      if (g.canDock()) g.dock();

      // And the ordinary business of a starship. Each of these is a real
      // order, and each is checked as thoroughly as a tick of combat is.
      const between = [
        () => g.effectRepairs(),
        () => g.dock(),
        () => g.diagnostic(5),
        () => g.stripWreck(),
        () => g.salvage(),
        () => g.enterOrbit(),
        () => g.breakOrbit(),
        () => g.logEntry(`After action, engagement ${f + 1}.`),
        // 'sickbay' is the LABEL; the department is `medical`. Game.intercom
        // falls through to the security report for anything it does not know,
        // so this asked security twice and the doctor never.
        () => g.intercom(pick(INTERCOM_DEPTS)),
        () => g.handOverCon(),
        () => g.takeCon(),
        () => g.workTheShop(1),
        () => g.availableMissions(),
        () => g.setAlert('normal'),
        () => g.awardXP(2500),
        () => {
          if (g.pendingFeats > 0) g.takeFeat('unshakeable');
        },
        () => {
          if (g.progress.unspent > 0) g.spendSkill('beam_weapons');
        },
        () => {
          // Training, which is the only route to the rank-three abilities.
          // Without it the tour fired twenty-one of the twenty-six and the
          // five it never reached were exactly the five that training exists
          // for — so the soak proved nothing at all about them.
          //
          // EVERY available officer, not the first one with something to
          // learn. Stopping at the first made reaching any PARTICULAR rank-
          // three ability a matter of which officer happened to come up
          // trainable first, so the coverage below held by alignment rather
          // than by construction: stepping the ship between fights changed how
          // long the fights ran, the walk landed differently, and
          // `ramming_speed` — helm and comms only, and the last thing either
          // learns — stopped being reached. It trains and fires exactly as it
          // did; the tour had simply stopped rolling it. Coverage that depends
          // on luck is not coverage.
          for (const o of g.crew.available) {
            const next = g.trainableFor(o)[0];
            if (next) g.trainOfficer(o, next.id);
          }
        },
      ];
      for (let i = 0; i < 8; i++) {
        pick(between)();
        for (let t = 0; t < 80; t++) { g.update(STEP); dog.tick(g, OPTS); ticks++; }
      }
      // A save round trip between fights, because the player closes the app.
      const back = Game.load(JSON.parse(JSON.stringify(g.save())));
      assert.deepEqual(checkAll(back, OPTS), [],
        `${difficulty}: the save between fights ${f + 1} and ${f + 2} loaded broken`);
    }
  }

  assert.ok(fought >= 30, `only ${fought} engagements in the tour`);
  assert.ok(ticks > 60000, `only ${ticks} ticks; the tour is not touring`);
  assert.ok(outcomes.has('escaped'), 'no fight was ever broken off');
  assert.ok(outcomes.has('victory') || outcomes.has('routed'),
    `nothing was ever won: ${[...outcomes]}`);
  assert.ok(lost < 5, 'every commission ended with the ship lost');
  // No silent gaps: a power the soak never fires is a power the soak says
  // nothing about, and saying nothing is not the same as saying it is fine.
  const neverFired = Object.keys(ABILITIES).filter((id) => !usedPowers.has(id));
  assert.deepEqual(neverFired, [], 'abilities the tour never once used');

  assert.deepEqual(dog.summary.map((v) => `${v.severity} ${v.code}: ${v.text}`), [],
    `${dog.total} invariant violations across ${ticks} ticks of a tour`);
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
    assert.ok(OUTCOMES.includes(g.lastCombat.outcome),
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
    // Out of combat means the bridge — or at warp, if the way out was running.
    // Breaking off now goes somewhere, which is what it always said it did.
    const ran = g.lastCombat?.outcome === 'escaped';
    assert.ok(g.mode === 'bridge' || (ran && g.mode === 'transit'),
      `${how}: still in ${g.mode} mode`);
    assert.equal(g.engagement, null, `${how}: the engagement was left hanging`);
    // Losing the ship does not stand the crew down.
    //
    // This asserted `normal` for every ending, which is why the caller below
    // iterated four of the five and left `destroyed` out — the one ending this
    // helper could not express. `finishCombat` ends with
    // `setAlert(outcome === 'destroyed' ? 'red' : 'normal')`, and until this
    // line said so, nothing in the suite asserted that at all: the only
    // `'red'` in tests/ was the parser reading the phrase "red alert".
    const lost = g.lastCombat?.outcome === 'destroyed';
    assert.equal(g.alert, lost ? 'red' : 'normal',
      lost ? `${how}: stood down after losing the ship` : `${how}: still at battle stations`);
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
    // Every ending, from the list combat.js publishes. This used to name four
    // of them by hand and omit `destroyed`, which is the ending a captain is
    // most likely to reach and the one the guarantee most needs to hold for.
    for (const outcome of OUTCOMES) {
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

  // `OUTCOMES` is imported at the top of this file. It used to be re-declared
  // here as well, which shadowed the import for everything below — so the
  // comment above, promising that every case satisfies "the same list", was
  // satisfied by a hand-written copy that nothing kept in step.

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
        // Breaking off now goes to warp, because that is what breaking off
        // said it was doing for the whole life of the game while leaving the
        // ship exactly where it was. So an escape ends at warp and everything
        // else ends on the bridge.
        const restingPlaces = outcome === 'escaped' ? ['bridge', 'transit'] : ['bridge'];
        assert.ok(restingPlaces.includes(g.mode) || g.over,
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

        // Where the ship WAS is not changed by a fight it survived — except by
        // running from one, which is the whole point of running. An escape
        // leaves orbit and leaves the system, and is the only ending that does.
        if (!g.over && outcome !== 'escaped') {
          assert.equal(g.walk?.roomId === 'surface', wasAshore,
            'the captain was moved between the ship and the ground by a battle');
          const orbitAfter = g.orbitBody ?? g.orbit ?? null;
          assert.equal(!!orbitAfter, !!orbitBefore, 'orbit was gained or lost in a fight');
        }
        if (!g.over && outcome === 'escaped') {
          // Never abandoned on the surface, whatever else running costs.
          assert.equal(g.walk?.roomId === 'surface', false,
            'the ship ran and left the captain standing on a planet');
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
    const kills = g.ledger.destroyedShips.length;
    const wreck = g.wreckHere;

    g.finishCombat('victory');
    g.finishCombat('victory');
    g.update(STEP);

    assert.deepEqual({ ...g.lastCombat }, record, 'the after-action record was rewritten');
    assert.equal(g.progress.xp, xp, 'the experience was paid twice');
    assert.equal(g.ledger.destroyedShips.length, kills, 'the kill was counted twice');
    assert.deepEqual(g.wreckHere, wreck, 'a second hulk appeared out of nothing');
  });
});

// ============================================= a side of the fight that existed

describe('somebody answers the distress call', () => {
  // `Engagement` has supported allies since it was written: placed on the
  // board, flown by the AI, drawn by all three renderers, targeted by hostiles
  // and counted by every rule in this file. Nothing in the game ever created
  // one. A whole side of the battle existed and was unreachable.

  test('there is nobody to call when nobody is shooting', () => {
    const g = new Game({ seed: 4n, crewMode: 'original' });
    assert.equal(g.callForHelp().ok, false);
  });

  test('the call is made once per fight, and again in the next one', () => {
    const g = fight('d7');
    assert.equal(g.callForHelp().ok, true);
    assert.equal(g.callForHelp().ok, false, 'the call went out twice');

    g.engagement.end('routed');
    g.startCombat([new Ship('d7', { name: 'More of them' })]);
    assert.equal(g.callForHelp().ok, true, 'a new fight inherited the old call');
  });

  test('help arrives, fights, and is on your side', () => {
    const g = fight('d7');
    const call = g.callForHelp();
    assert.equal(call.answered, true, call.reason);

    for (let i = 0; i < 30 * 90 && !g.engagement?.allies.length; i++) {
      pilot(g); g.update(STEP);
      if (!g.engagement || g.engagement.over) break;
    }
    const ally = g.engagement?.allies?.[0];
    assert.ok(ally, 'nobody came');
    assert.equal(ally.faction, 'federation');
    assert.ok(g.engagement.allShips.includes(ally), 'the ally is not on the board');

    // And every rule that applies to a combatant applies to this one.
    assert.deepEqual(checkAll(g, OPTS), []);
  });

  test('nobody comes for the no-win scenario', () => {
    const g = new Game({ seed: 8n, crewMode: 'original' });
    if (typeof g.runKobayashiMaru !== 'function') return;
    g.runKobayashiMaru();
    assert.equal(g.callForHelp().ok, false, 'the Kobayashi Maru was made winnable');
  });

  test('a wrecked subspace radio cannot call anybody', () => {
    const g = fight('d7');
    g.ship.subsystems.comms = 0.1;
    assert.equal(g.callForHelp().ok, false);
  });

  test('the relief does not follow you into the next battle', () => {
    // The countdown has a ship at the end of it. Left set past the fight it
    // was called for, the next engagement gets a free ally dropping out of
    // warp for a call the captain never made.
    const g = fight('d7');
    g.callForHelp();
    assert.ok(g.helpInbound, 'nothing was inbound');
    g.engagement.end('victory');
    assert.equal(g.helpInbound, null, 'a ship is still on its way to a finished fight');
    assert.deepEqual(checkAll(g, OPTS), []);
  });

  test('the checker objects to help inbound to a fight that is over', () => {
    const g = fight('d7');
    g.engagement.end('victory');
    g.helpInbound = { classId: 'miranda', name: 'USS Nowhere', eta: 5 };
    assert.ok(checkAll(g, OPTS).some((v) => v.code === 'game.help.orphan'),
      JSON.stringify(checkAll(g, OPTS)));
  });

  test('the checker knows what a mode is', () => {
    // Every rule about the mode asked whether it was the RIGHT one. None asked
    // whether it was a mode at all, so a garbage value out of an old save
    // routed to no screen: a blank panel that takes no orders and says nothing.
    const g = fight('d7');
    g.engagement.end('victory');
    g.update(STEP);
    assert.deepEqual(checkAll(g, OPTS), []);

    g.mode = 'tactical';   // a screen, once; never a mode
    assert.ok(checkAll(g, OPTS).some((v) => v.code === 'game.mode.unknown'),
      JSON.stringify(checkAll(g, OPTS)));
  });

  test('the set of legal modes is the set of modes', () => {
    // Spelled out in the invariants file so it does not import the module that
    // imports it. This is the guard on the two drifting apart.
    assert.deepEqual([...LEGAL_MODES].sort(), Object.values(MODES).sort());
  });

  test('the checker objects to a hulk adrift in nowhere', () => {
    const g = fight('d7');
    g.engagement.end('victory');
    g.update(STEP);

    // Salvage compares the hulk's system to where the ship is now, and the
    // machine shop multiplies its tier into a yield. Neither survives nonsense.
    g.wreck = { tier: 2, systemId: null, hulls: 1, name: 'IKS Nowhere' };
    assert.ok(checkAll(g, OPTS).some((v) => v.code === 'game.wreck.nowhere'));

    g.wreck = { tier: NaN, systemId: 'sol', hulls: 1, name: 'IKS Nowhere' };
    assert.ok(checkAll(g, OPTS).some((v) => v.code === 'game.wreck.tier'));

    g.wreck = { tier: 2, systemId: 'sol', hulls: 0, name: 'IKS Nowhere' };
    assert.ok(checkAll(g, OPTS).some((v) => v.code === 'game.wreck.hulls'));
  });

  test('the after-action record cannot claim more dead than the ship carries', () => {
    // The panel after a fight now reads `lastCombat.crewLost` rather than doing
    // its own arithmetic, which is what made it report every death the
    // commission had ever suffered. This guards the field it reads.
    const g = fight('d7');
    g.engagement.end('victory');
    g.update(STEP);
    assert.ok(g.lastCombat, 'no after-action record');
    assert.deepEqual(checkAll(g, OPTS), []);

    g.lastCombat.crewLost = g.ship.maxCrew + 1;
    assert.ok(checkAll(g, OPTS).some((v) => v.code === 'game.lastCombat.crew'),
      JSON.stringify(checkAll(g, OPTS)));
  });

  test('an ally does not break the aftermath', () => {
    // The whole reason this is in the invariants file rather than the sim one:
    // a third party on the board is exactly the sort of thing that makes the
    // salvage, the casualty count and the ledger disagree with each other.
    const g = fight('d7');
    g.callForHelp();
    for (let i = 0; i < 30 * 240 && !g.lastCombat; i++) { pilot(g); g.update(STEP); }
    assert.ok(g.lastCombat, 'the fight never ended');
    assert.deepEqual(checkAll(g, OPTS), []);
    assert.equal(g.engagement, null);
    assert.ok(g.lastCombat.killed <= g.lastCombat.hostiles,
      `${g.lastCombat.killed} kills out of ${g.lastCombat.hostiles} hostiles — an ally was counted`);
  });

  test('an ally lost in the fight is not counted as a kill of yours', () => {
    const g = fight('d7');
    g.callForHelp();
    for (let i = 0; i < 30 * 90 && !g.engagement?.allies.length; i++) {
      pilot(g); g.update(STEP);
      if (!g.engagement || g.engagement.over) break;
    }
    const ally = g.engagement?.allies?.[0];
    if (!ally) return;
    ally.destroy('test');
    const before = g.ledger.destroyedShips.length;
    for (const s of g.engagement.hostiles) s.destroy('test');
    g.engagement.end('victory');
    assert.equal(g.lastCombat.killed, g.lastCombat.hostiles,
      'the ally was tallied with the enemy');
    const logged = g.ledger.destroyedShips.slice(before);
    assert.equal(logged.length, g.lastCombat.hostiles,
      `the ledger recorded ${logged.length} kills for ${g.lastCombat.hostiles} hostiles`);
    assert.ok(!logged.some((k) => k.faction === 'federation'),
      'a Starfleet ship went into the record as one of your kills');
  });
});

// ============================================ the landing parties nobody could send

describe('a landing party goes somewhere', () => {
  // AWAY_TEMPLATES has held five multi-step missions since the away system was
  // written — hazard levels, per-step checks, difficulty classes on every one —
  // and no code has ever read the table. The order existed too: "assemble an
  // away team" put one together and reported it standing by, which is a
  // landing party that never went anywhere.

  /** A hostile beaten to the point where a boarding party can cross. */
  function crippled(g) {
    const foe = g.engagement.hostiles[0];
    for (const f of Object.keys(foe.shields)) foe.shields[f] = 0;
    foe.hull = foe.maxHull * 0.2;
    foe.x = 200; foe.y = 0; foe.z = 0;
    g.ship.x = 0; g.ship.y = 0; g.ship.z = 0;
    return foe;
  }

  test('there is nowhere to send one from an empty bridge', () => {
    const g = new Game({ seed: 2n, crewMode: 'original' });
    assert.deepEqual(g.availableAwayMissions(), []);
    assert.equal(g.awayMission('boarding_action').ok, false);
  });

  test('a beaten ship can be boarded, and a healthy one cannot', () => {
    const g = fight('d7');
    assert.deepEqual(g.availableAwayMissions(), [],
      'a boarding party was offered against full shields');
    crippled(g);
    assert.deepEqual(g.availableAwayMissions().map((t) => t.id), ['boarding_action']);
  });

  test('every step is run and every result is reported', () => {
    const g = fight('d7');
    crippled(g);
    const r = g.awayMission('boarding_action');
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.of, 3, 'a three-step template ran a different number of steps');
    assert.equal(r.steps.length <= 3, true);
    assert.ok(['success', 'partial', 'failure'].includes(r.outcome));
    assert.equal(r.passed, r.steps.filter((s) => s.success).length);
    assert.deepEqual(checkAll(g, OPTS), [], 'the checker objects after a boarding action');
  });

  test('a bridge taken is a ship out of the fight, and not a kill', () => {
    // The whole point of crippling instead of killing. It must not show up in
    // the destroyed-ships record, because it was not destroyed.
    let taken = 0;
    for (let seed = 1n; seed <= 40n && !taken; seed++) {
      const g = fight('d7', { seed, difficulty: 'story' });
      const foe = crippled(g);
      const r = g.awayMission('boarding_action');
      if (r.outcome !== 'success') continue;
      taken++;
      assert.equal(foe.withdrawn, true, 'the boarded ship kept fighting');
      assert.equal(foe.destroyed, false, 'boarding a ship blew it up');
      assert.ok(!g.ledger.destroyedShips.some((k) => k.name === foe.name),
        'a captured ship went into the record as a kill');
      assert.ok(!g.engagement || g.engagement.target !== foe,
        'the guns are still locked on a ship that has gone');
      assert.deepEqual(checkAll(g, OPTS), []);
    }
    assert.ok(taken > 0, 'no boarding action in forty attempts ever succeeded');
  });

  test('the fight ends when the last hostile is boarded', () => {
    for (let seed = 1n; seed <= 40n; seed++) {
      const g = fight('d7', { seed, difficulty: 'story' });
      crippled(g);
      if (g.awayMission('boarding_action').outcome !== 'success') continue;
      for (let i = 0; i < 30 * 20 && !g.lastCombat; i++) g.update(STEP);
      assert.ok(g.lastCombat, 'the board emptied and the fight never ended');
      assert.equal(g.mode, 'bridge');
      assert.deepEqual(checkAll(g, OPTS), []);
      return;
    }
  });

  test('a party with nobody left standing stops', () => {
    // The loop breaks when the team is gone. Without it the remaining steps
    // run against an empty team, which is a check with no officer behind it.
    const g = fight('d7', { difficulty: 'admiral' });
    crippled(g);
    const r = g.awayMission('boarding_action');
    assert.ok(r.steps.length >= 1);
    assert.ok(r.steps.length <= 3);
  });

  test('the away order sends them somewhere instead of standing by', () => {
    const g = fight('d7');
    crippled(g);
    const order = parseOrder('board them', g);
    assert.equal(order.action, 'away_team');
    assert.equal(order.prefer, 'board', 'the parser lost which mission was meant');
  });
});

// =========================================== the Prime Directive's third path

describe('a pre-warp culture can be studied without being met', () => {
  // `covert_landing` was written with everything it needs — three steps, a
  // dangerous hazard rating, and its own consequence for being seen — and its
  // gate read `sys.preWarp` (a flag that lives on ENCOUNTERS) and
  // `sys.type === 'unexplored'` (a flag that lives on the system, not its
  // type). Two near misses, so at a pre-warp first contact the captain was
  // offered obey-or-violate and nothing else.

  /** A ship in orbit somewhere, which is what a landing party needs. */
  function inOrbit(systemId, { seed = 11n } = {}) {
    const g = new Game({ seed, crewMode: 'original' });
    g.locationId = systemId;
    const r = g.enterOrbit();
    assert.equal(r.ok, true, `nothing to orbit at ${systemId}: ${r.error}`);
    return g;
  }

  /** The encounter that raises the question. */
  function firstContact(g, preWarp) {
    g.beginEncounter({
      kind: 'first_contact', system: g.locationId, hostile: false,
      speciesName: 'Melkotian', title: 'First contact',
      text: 'An unknown vessel of unfamiliar configuration.',
      preWarp,
    });
  }

  const offered = (g) => g.availableAwayMissions().map((t) => t.id);

  test('a covert survey is offered at a pre-warp first contact', () => {
    const g = inOrbit('sol');
    assert.ok(!offered(g).includes('covert_landing'),
      'Sol offered a covert survey before anyone was found to survey');
    firstContact(g, true);
    assert.ok(offered(g).includes('covert_landing'),
      'a pre-warp culture in front of the ship and still no way to study it');
  });

  test('and at an unexplored system, which is the flag the gate meant', () => {
    // deep_1, deep_2, gamma_1 and gamma_2 carry `unexplored: true`. None of
    // them has ever had `type: 'unexplored'`, which is what the gate read.
    for (const id of ['deep_1', 'deep_2', 'gamma_1', 'gamma_2']) {
      const g = inOrbit(id);
      assert.ok(g.location.unexplored, `${id} is not flagged unexplored any more`);
      assert.ok(offered(g).includes('covert_landing'),
        `no covert survey at ${id}, which is the whole reason the flag exists`);
    }
  });

  test('and nowhere a covert survey would be absurd', () => {
    // A guard, not a proof: this passed before the gate was fixed too. It is
    // here so a later widening of the gate cannot quietly offer a covert
    // survey of Earth.
    for (const id of ['sol', 'vulcan', 'andoria', 'qonos']) {
      const g = inOrbit(id);
      assert.ok(!offered(g).includes('covert_landing'),
        `${id} offered a covert survey of a warp-capable homeworld`);
    }
    const warpCapable = inOrbit('sol');
    firstContact(warpCapable, false);
    assert.ok(!offered(warpCapable).includes('covert_landing'),
      'a covert survey was offered of a culture that flies its own starships');
  });

  test('the survey needs orbit, like every other landing party', () => {
    // Also a guard rather than a proof — it passed before the gate was fixed,
    // because before the fix nothing was offered anywhere. It holds the
    // `!eng && body && sys` precondition in place now that something is.
    const g = new Game({ seed: 11n, crewMode: 'original' });
    g.locationId = 'deep_1';
    assert.equal(g.orbit, null);
    assert.ok(!offered(g).includes('covert_landing'),
      'a landing party was offered from open space');
    assert.equal(g.awayMission('covert_landing').ok, false);
  });

  test('being seen by a pre-warp culture costs standing', () => {
    // The consequence was written when the template was and has never once
    // run. It is the reason the third path is a real choice and not a free
    // one: the survey is dangerous, and being observed is what failing means.
    let seen = 0;
    for (let seed = 1n; seed <= 60n && !seen; seed++) {
      const g = inOrbit('deep_1', { seed });
      firstContact(g, true);
      const before = g.ledger.standingOf('federation');
      const r = g.awayMission('covert_landing');
      assert.equal(r.ok, true, r.reason);
      assert.equal(r.of, 3, 'a three-step template ran a different number of steps');
      if (r.outcome !== 'failure') continue;
      seen++;
      assert.ok(g.ledger.standingOf('federation') < before,
        'the landing party was observed by a pre-warp culture and Starfleet did not care');
      assert.deepEqual(checkAll(g, OPTS), [], 'the checker objects after a covert survey');
    }
    assert.ok(seen > 0, 'no covert survey in sixty attempts was ever botched');
  });

  test('a survey that goes well is quiet, and still a real away mission', () => {
    let clean = 0;
    for (let seed = 1n; seed <= 60n && !clean; seed++) {
      const g = inOrbit('deep_1', { seed });
      firstContact(g, true);
      const before = g.ledger.standingOf('federation');
      const r = g.awayMission('covert_landing');
      if (r.outcome !== 'success') continue;
      clean++;
      assert.equal(r.passed, 3);
      assert.equal(g.ledger.standingOf('federation'), before,
        'a survey nobody noticed still cost the captain standing');
      assert.deepEqual(checkAll(g, OPTS), []);
    }
    assert.ok(clean > 0, 'no covert survey in sixty attempts ever went clean');
  });

  test('every away template is reachable from some state', () => {
    // The guard that would have caught this. A template declared in the table,
    // given steps and a hazard rating and a consequence, and gated on a field
    // nothing sets, is indistinguishable from a template that does not exist.
    const reached = new Set();
    const note = (g) => { for (const t of g.availableAwayMissions()) reached.add(t.id); };

    const boarding = fight('d7');
    const foe = boarding.engagement.hostiles[0];
    for (const f of Object.keys(foe.shields)) foe.shields[f] = 0;
    foe.hull = foe.maxHull * 0.2;
    foe.x = 200; foe.y = 0; foe.z = 0;
    boarding.ship.x = 0; boarding.ship.y = 0; boarding.ship.z = 0;
    note(boarding);

    const distress = inOrbit('sol');
    distress.beginEncounter({ kind: 'distress', system: 'sol', hostile: false, lives: 40, text: 'A freighter is calling for help.' });
    note(distress);

    note(inOrbit('alpha_centauri'));    // a colony: colony_rescue
    note(inOrbit('vulcan'));            // a homeworld: diplomatic_landing
    note(inOrbit('deep_1'));            // unexplored: covert_landing

    // A hulk comes from winning a fight, so win one — the wreck has to exist
    // by the path the game actually takes to it.
    const won = fight('d7');
    won.engagement.hostiles[0].destroy('test');
    for (let i = 0; i < 30 * 30 && !won.lastCombat; i++) won.update(STEP);
    assert.ok(won.wreckHere, 'a fight was won and left nothing adrift');
    note(won);

    assert.deepEqual([...Object.keys(AWAY_TEMPLATES)].filter((id) => !reached.has(id)), [],
      'an away template exists in the table and no state in the game can offer it');
  });
});

test('a fight that drops you out of warp leaves nothing behind at the old system', () => {
  // Found by the order monkey in tools/verify-app.mjs — a fuzz failure that
  // took three sightings to pin down, because it needs an encounter, a course
  // laid in over the top of it, and a fight starting mid-flight, in that
  // order. Nothing anybody would think to write down.
  //
  // `startCombat` drops a ship out of warp and moves `locationId` to the
  // nearest system. It was not clearing `this.encounter`, so what was
  // happening at the system the course started from stayed live, pointing at a
  // place the ship was no longer in. Invisible in play, because the encounter
  // panel only draws in ENCOUNTER mode — but `hail` reads the encounter's
  // faction before the engagement's, so hailing after the battle opened a
  // channel to people in another star system.
  const g = new Game({ seed: 3n, crewMode: 'original' });
  g.locationId = 'alpha_centauri';
  g.beginEncounter({
    kind: 'patrol', system: g.location, hostile: false,
    factionId: 'klingon', title: 'Patrol', text: 'Somebody is watching.',
  });
  assert.equal(g.encounter.system.id, 'alpha_centauri');

  g.setCourse('sol');
  for (let i = 0; i < 30 * 20; i++) g.update(STEP);
  assert.ok(g.transit, 'the ship never got under way');

  g.startCombat([new Ship('d7', { name: 'Ambusher' })]);
  assert.notEqual(g.locationId, 'alpha_centauri', 'the ship never dropped out of warp');
  assert.equal(g.encounter, null,
    `an encounter at ${g.encounter?.system?.id} outlived the system it was in`);
  assert.deepEqual(checkAll(g, OPTS), []);
});

test('reinforcing a shield is not an anomaly', () => {
  // Found by the order monkey in tools/verify-app.mjs on its first run, which
  // is the point of having one: `pilot()` in this file has never reinforced a
  // shield, so no fight the soak has ever run could reach the state.
  //
  // `reinforceShield` moves charge from five facings onto one and deliberately
  // pushes it past `maxShield` — that IS the order. The checker read the
  // normal ceiling, so giving an ordinary tactical order put an anomaly in the
  // ship's log, and would have done so in front of a player with the debug
  // flag on.
  const g = fight('d7');
  g.ship.reinforceShield('port');
  assert.ok(g.ship.shields.port > g.ship.maxShield,
    'the order did not overcharge anything, so this proves nothing');
  assert.deepEqual(checkAll(g, OPTS), []);

  // And the ceiling is still a ceiling.
  g.ship.shields.port = g.ship.maxShield * 3;
  assert.ok(checkAll(g, OPTS).some((v) => v.code === 'ship.shield.overmax'));
});

test('the overcharge bleeds back off on its own', () => {
  const g = fight('d7');
  g.ship.reinforceShield('port');
  const peak = g.ship.shields.port;
  for (let i = 0; i < 30 * 40; i++) g.update(STEP);
  assert.ok(g.ship.shields.port < peak,
    'a reinforced facing held its overcharge forever');
  assert.deepEqual(checkAll(g, OPTS), []);
});

test('being dead is not a kind of being hurt', () => {
  // Found by the order monkey, walking through orbit, a boarding action and a
  // save/load round trip. `injured` survived death, so an officer wounded on
  // one away mission and killed on the next was dead AND on the sick list —
  // which is what `officer.dead-and-injured` says must never happen, and what
  // every roster panel then reported.
  const g = fight('d7');
  const officer = g.crew.officers[0];
  officer.injure(0.7);
  assert.equal(officer.injured, true);
  officer.kill('test');
  assert.equal(officer.injured, false, 'a dead officer is still on the sick list');
  assert.deepEqual(checkAll(g, OPTS), []);

  // And the checker still objects if anything else produces the state.
  officer.injured = true;
  assert.ok(checkAll(g, OPTS).some((v) => v.code === 'officer.dead-and-injured'));
});

test('nothing brings the dead back on duty', () => {
  const g = fight('d7');
  const officer = g.crew.officers[0];
  officer.injure(0.5);
  assert.equal(officer.heal(), true);
  assert.equal(officer.injured, false);
  officer.kill('test');
  assert.equal(officer.heal(), false, 'the dead were returned to duty');
  assert.equal(officer.alive, false);
});

test('an enemy ship has a name, whoever fielded it', () => {
  // Three code paths put hostiles on the board — a random encounter, a mission
  // stage, and the Kobayashi Maru — and they carried two copies of a name
  // table between them. The mission-stage path had neither and fielded
  // "klingon vessel 1" while an ordinary encounter with the identical ship
  // called it the IKS Rotarran.
  const g = new Game({ seed: 6n, crewMode: 'original' });
  const named = (s) => s.name && !/^\w+ vessel \d+$/i.test(s.name) && !/^Hostile/i.test(s.name);

  assert.equal(hostileName('klingon', 0), HOSTILE_NAMES.klingon[0]);
  assert.equal(hostileName('klingon', HOSTILE_NAMES.klingon.length), HOSTILE_NAMES.klingon[0],
    'the list does not wrap');
  assert.equal(hostileName('nobody_in_particular', 0), 'Unknown Vessel');

  const fleet = buildHostiles(g.rng, 'romulan', 3, ['warbird', 'scoutship']);
  assert.equal(fleet.length, 3);
  for (const s of fleet) assert.ok(named(s), `an unnamed hostile: ${s.name}`);
  assert.equal(new Set(fleet.map((s) => s.name)).size, 3, 'three ships, one name');

  // And the relief that answers a distress call comes from the same table.
  g.startCombat([new Ship('d7', { name: 'Hostile' })]);
  const call = g.callForHelp();
  if (call.answered) {
    assert.ok(HOSTILE_NAMES.federation.includes(call.ship),
      `${call.ship} is not on the Starfleet list`);
  }
});

// =========================================== the same idea, one layer down

describe('the game survives being called wrongly', () => {
  // The order monkey in tools/verify-app.mjs gives every phrasing to a running
  // app, which is the right test for "an order at the wrong moment". It cannot
  // be the test for "a method with the wrong argument", because the parser
  // never produces one — and every one of these methods is public, is called
  // from a UI that can be mid-render, and several are reachable from a save
  // file somebody edited.
  //
  // So: call them, with plausible arguments and with rubbish, in a shuffled
  // order, thousands of times, and require the same two things the app
  // requires. Nothing throws. Nothing breaks a rule.

  /** Deterministic, so a failure names a sequence rather than a mood. */
  function stream(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 0x100000000;
    };
  }

  const JUNK = [
    undefined, null, NaN, Infinity, -Infinity, 0, -1, 1e9, '', 'nonsense',
    {}, [], true, false, -0.5, '7', { id: 'nope' },
  ];

  /** One pass, from one seed. Three of them run below. */
  function fuzz(seed, difficulty) {
    const rand = stream(seed);
    const pick = (list) => list[Math.floor(rand() * list.length)];

    const g = new Game({ seed: BigInt(seed), crewMode: 'original', difficulty });
    const systems = g.galaxy.systems.map((s) => s.id);
    const bodies = (g.galaxy.systems.find((s) => s.id === g.locationId)?.bodies ?? [])
      .map((b) => b.id);
    const rooms = ['bridge', 'sickbay', 'engineering', 'transporter', 'nowhere', ''];
    const facings = ['fore', 'aft', 'port', 'starboard', 'dorsal', 'ventral', 'sideways'];
    const subsystems = ['weapons', 'shields', 'engines', 'warpcore', 'transporter', 'wings'];

    // Every call the UI can make, with the arguments the UI can make it with —
    // and with rubbish, because a save file is a thing a person can edit.
    const CALLS = [
      () => g.setCourse(pick([...systems, ...JUNK]), pick([1, 6, 9, ...JUNK])),
      () => g.enterOrbit(pick([...bodies, ...JUNK])),
      () => g.breakOrbit(),
      () => g.beamDown(),
      () => g.beamUp(),
      () => g.dock(),
      () => g.hail(pick(['identify', 'warn', 'negotiate', 'threaten', ...JUNK])),
      () => g.callForHelp(),
      () => g.awayMission(pick(['boarding_action', 'derelict_search', 'colony_rescue', ...JUNK])),
      () => g.availableAwayMissions(),
      () => g.stripWreck(),
      // 'torpedoes' is not a recipe id, so the shop refused every job the
      // fuzzer ever gave it and the whole success path went unexercised.
      // `RECIPES` is an ARRAY, so `Object.keys` on it would be "0","1","2" —
      // a pool as dead as the 'torpedoes' it replaced. The ids live in
      // RECIPE_BY_ID, and this was caught by checking that a real id is
      // actually accepted rather than by assuming it.
      () => g.fabricate(pick([...JUNK, ...Object.keys(RECIPE_BY_ID)])),
      () => g.workTheShop(pick([1, 8, ...JUNK])),
      () => g.setAlert(pick(['red', 'yellow', 'normal', 'blue', ...JUNK])),
      () => g.handOverCon(pick(['first_officer', 'helm', ...JUNK])),
      () => g.takeCon(),
      () => g.diagnostic(pick([1, 5, ...JUNK])),
      () => g.startCombat([new Ship(pick(['d7', 'bird_of_prey']), { name: 'Fuzz' })]),
      () => g.engagement?.setThrottle(pick([0, 0.5, 1, ...JUNK])),
      () => g.engagement?.setHeading(pick([0, 180, 359, ...JUNK])),
      () => g.engagement?.fireAll(pick(['all', 'beam', 'torpedo', ...JUNK])),
      () => g.engagement?.targetSubsystem(pick([...subsystems, ...JUNK])),
      () => g.engagement?.cycleTarget(),
      () => g.engagement?.beginWarpOut(),
      () => g.engagement?.end(pick([...OUTCOMES, ...JUNK])),
      () => g.ship.reinforceShield(pick([...facings, ...JUNK])),
      () => { g.ship.shieldsUp = pick([true, false]); },
      () => g.ship.cloak(),
      () => g.ship.decloak(),
      () => g.ship.ejectCore(),
      () => g.ship.damageSubsystem(pick([...subsystems, ...JUNK]), pick([0.2, 5, ...JUNK])),
      () => g.ship.takeDamage(pick([50, 5000, ...JUNK]), { facing: pick(facings) }),
      () => g.ship.repair(pick([10, 1000, ...JUNK])),
      () => g.ship.power.set(pick(['weapons', 'shields', 'engines', ...JUNK]), pick([0, 50, 200, ...JUNK])),
      () => g.walk.enter(pick(rooms)),
      () => g.walk.step(
        { forward: pick([1, 0, -1, ...JUNK]), turn: pick([0, 1, ...JUNK]) },
        pick([1 / 30, 0, 10, ...JUNK]),
      ),
      () => g.walk.useExit(pick([...rooms, ...JUNK])),
      () => g.walk.sit(pick([true, false])),
      () => g.buildAwayTeam(),
      () => g.surveyFeature(pick([...JUNK, 'feature0', 'feature1'])),
      () => g.update(1 / 30),

      // The campaign layer, which the combat soak never touches.
      () => g.startMission(pick([...JUNK, ...(g.availableMissions?.() ?? []).map((m) => m.id)])),
      () => g.chooseMission(pick([...JUNK, '0', 'a'])),
      () => g.earnReputation(pick(['combat_victory', 'colony_saved', ...JUNK])),
      () => g.progress.addXP(pick([100, 1e6, ...JUNK]), { ledger: g.ledger }),
      () => g.ledger.adjustStanding(pick(['klingon', 'federation', ...JUNK]), pick([5, -400, ...JUNK]), 'fuzz'),
      () => g.pushLog(pick(['line', ...JUNK]), pick(['helm', ...JUNK])),
      // `g.setPreset` never existed; this optional-chained to nothing on every
      // one of 4000 calls a seed. The real method is on the power grid, and
      // the pool is now every preset the game has rather than two of them
      // plus 'evade', which is not one.
      () => g.ship.power.applyPreset(pick([...Object.keys(PRESETS), ...JUNK])),
      () => g.ship.power.set(pick([...SUBSYSTEMS, ...JUNK]), pick([0, 50, 100, ...JUNK])),
      () => g.useSignature(),
      () => {
        const ready = g.readyAbilities();
        return ready.length ? g.useAbility(ready[0].officer, ready[0].ability.id) : null;
      },
      () => g.useAbility(pick([...JUNK, 'helm', 'tactical']), pick([...JUNK, 'fire_at_will', 'eject_core'])),
      () => g.useDevice(pick([...JUNK, 'shield_battery', 'hull_patch'])),

      // Everything that used to live in the screen, now that it can be
      // reached: the promotion ladder and both of its payoffs, the standing
      // projects, and breaking off a course under way.
      () => g.awardXP(pick([50, 1e6, ...JUNK])),
      () => g.takeFeat(pick([...JUNK, 'unshakeable', 'improviser', 'ability_score']),
        pick([null, ['command', 'daring'], ...JUNK])),
      () => g.spendSkill(pick([...JUNK, 'sensors', 'leadership', 'beam_weapons'])),
      () => g.buyProject(pick([...JUNK, 'federation', 'klingon']),
        pick([...JUNK, 'fed_t1_torpedoes', 'rom_t3_cloak'])),
      () => g.dropOutOfWarp(),
      () => g.crew.at(pick(['helm', 'science', ...JUNK])),
      () => g.crew.officers[0]?.injure(pick([0.5, 5, ...JUNK])),

      // And what the app would come back as if it were closed right here.
      () => {
        const back = Game.load(JSON.parse(JSON.stringify(g.save())));
        for (const v of checkAll(back, OPTS)) {
          throw new Error(`a save loaded broken: ${v.code} — ${v.text}`);
        }
      },
    ];

    const threw = [];
    const broke = new Set();
    for (let i = 0; i < 4000; i++) {
      const call = pick(CALLS);
      try {
        call();
      } catch (err) {
        threw.push(`call ${i}: ${err?.message ?? err}`);
        if (threw.length > 3) break;
      }
      // A dead captain stops the sweep testing anything; put the ship back.
      //
      // The whole game-over has to be undone, not just the flag. A career now
      // ends on the SECOND hull lost, so leaving the count behind meant every
      // resurrection after that was a commission running with more ships lost
      // than a commission can have — which the sweep rightly complained about,
      // for a state only this harness can produce.
      if (g.over) {
        g.over = false;
        g.overReason = null;
        g.shipsLost = 0;
        g.ship.restore();
        g.ship.crew = g.ship.maxCrew;
      }
      for (const v of checkAll(g, OPTS)) broke.add(`${v.code} — ${v.text}`);
    }

    return { threw, broke: [...broke] };
  }

  // Three seeds and three difficulty rungs: casualty scaling, permadeath and
  // the enemy-count multiplier all move with the rung, and each of them is a
  // different set of numbers flowing through the same calls.
  for (const [seed, difficulty] of [
    [0x9e3779b9, 'commander'],
    [0x85ebca6b, 'story'],
    [0xc2b2ae35, 'fleet_admiral'],
  ]) {
    test(`no public call throws or breaks a rule — seed ${seed.toString(16)}, ${difficulty}`, () => {
      const { threw, broke } = fuzz(seed, difficulty);
      assert.deepEqual(threw, [], 'a public call threw');
      assert.deepEqual(broke, [], 'a public call left the simulation broken');
    });
  }
});

test('ejecting the core does not put a hull back together', () => {
  // Found by the API fuzzer. `ejectCore` cleared `breaching` unconditionally,
  // so a ship already at zero hull came out of it not destroyed, not breaching
  // and not repairable — the one state `ship.zerohull.adrift` exists to forbid.
  // The fight could then never end on 'destroyed' and the campaign carried on
  // with a wreck the game did not know was a wreck.
  const g = fight('d7');
  g.ship.beginBreach(20);
  g.ship.hull = 0;
  assert.deepEqual(checkAll(g, OPTS), [], 'zero hull mid-breach is legal and was reported');

  g.ship.ejectCore();
  assert.equal(g.ship.destroyed, true, 'the ship came out of a breach at zero hull, intact');
  assert.deepEqual(checkAll(g, OPTS), []);
});

test('ejecting the core with a hull left is still the way out', () => {
  // The other half: the order has to keep working, or the fix above is just a
  // way of losing the ship.
  const g = fight('d7');
  g.ship.hull = g.ship.maxHull * 0.4;
  g.ship.beginBreach(20);
  assert.equal(g.ship.ejectCore(), true);
  assert.equal(g.ship.destroyed, false, 'ejecting the core killed a ship that was fine');
  assert.equal(g.ship.breaching, false);
  assert.equal(g.ship.subsystems.warpcore, 0);
  assert.deepEqual(checkAll(g, OPTS), []);
});

test('a subsystem cannot be damaged to nonsense', () => {
  // `takeDamage` clamps through a NaN-safe helper; `damageSubsystem` did raw
  // arithmetic, and one non-finite write to a number the damage model, the
  // power grid and the AI all read every tick is permanent.
  const g = fight('d7');
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'lots', {}]) {
    g.ship.damageSubsystem('engines', bad);
    assert.ok(Number.isFinite(g.ship.subsystems.engines),
      `damageSubsystem('engines', ${String(bad)}) left ${g.ship.subsystems.engines}`);
    assert.ok(g.ship.subsystems.engines >= 0 && g.ship.subsystems.engines <= 1);
  }
  assert.deepEqual(checkAll(g, OPTS), []);
});

// -------------------------------------------------------------------------
// There are two ways to leave a fight.
//
// `destroyed` was checked everywhere and `withdrawn` nowhere, although the
// combat log says out loud that the ship "has broken contact and gone to
// warp". These are the consequences of that, each measured before it was
// fixed.

describe('a ship that broke contact is out of the fight for everyone', () => {
  /** A fight with one hostile about to run and one that stays. */
  const routed = () => {
    const rng = new RNG(0x1701n);
    const player = new Ship('constitution', { isPlayer: true, name: 'Enterprise' });
    const ally = new Ship('constitution', { faction: 'federation', name: 'Potemkin' });
    const runner = new Ship('bird_of_prey', { faction: 'klingon', name: 'Runner' });
    const stayer = new Ship('bird_of_prey', { faction: 'klingon', name: 'Stayer' });
    const eng = new Engagement(player, [runner, stayer], rng, { allies: [ally] });

    ally.aiTarget = runner;
    // The ally cannot shoot, so the runner lives long enough to get away.
    ally.weapons = [];
    player.x = 0; player.y = 0; player.z = 0;
    ally.x = 0; ally.y = 200; ally.z = 0;
    stayer.x = 300; stayer.y = 0; stayer.z = 0;
    // Far enough from the player to count as clear, and fleeing already.
    runner.x = MAX_WEAPON_RANGE * 3; runner.y = 0; runner.z = 0;
    runner.fleeing = true;

    let ticks = 0;
    while (ticks < 900 && !runner.withdrawn && !eng.over) { eng.update(STEP); ticks++; }
    assert.ok(runner.withdrawn, 'the runner never got away, so nothing below is being tested');
    return { eng, player, ally, runner, stayer };
  };

  test("an allied captain's lock does not outlive the ship", () => {
    const { ally, runner } = routed();
    assert.notEqual(ally.aiTarget, runner,
      'the ally is still locked on a ship that has left the fight');
  });

  test('and the ally goes back to fighting whoever is left', () => {
    const { eng, ally, stayer } = routed();
    for (let i = 0; i < 5 && !eng.over; i++) eng.update(STEP);
    assert.equal(ally.aiTarget, stayer,
      'the ally never re-acquired the hostile that was standing right there');
  });

  test('a ship that got away cannot be shot', () => {
    const rng = new RNG(0x1701n);
    const player = new Ship('constitution', { isPlayer: true, name: 'Enterprise' });
    const gone = new Ship('bird_of_prey', { faction: 'klingon', name: 'Gone' });
    const eng = new Engagement(player, [gone], rng);

    gone.withdrawn = true;
    gone.x = 200; gone.y = 0; gone.z = 0;
    player.x = 0; player.y = 0; player.z = 0;
    player.heading = 0; player.pitch = 0;

    const before = gone.hull;
    let fired = false;
    for (const w of player.weapons) {
      w.cooldown = 0;
      if (eng.fireWeapon(player, w, gone)) fired = true;
    }
    assert.equal(fired, false, 'a weapon bore on a ship that has gone to warp');
    assert.equal(gone.hull, before, 'a ship that escaped still took damage');
  });

  test('a torpedo already in flight cannot follow it to warp', () => {
    const rng = new RNG(0x1701n);
    const player = new Ship('constitution', { isPlayer: true, name: 'Enterprise' });
    const gone = new Ship('bird_of_prey', { faction: 'klingon', name: 'Gone' });
    const eng = new Engagement(player, [gone], rng);
    gone.x = 300; gone.y = 0; gone.z = 0;
    player.x = 0; player.y = 0; player.z = 0;

    eng.projectiles.push({
      kind: 'torpedo', attacker: player, target: gone, weapon: player.weapons[0],
      x: 280, y: 0, z: 0, speed: 420, life: 6, subsystem: null,
    });
    gone.withdrawn = true;

    const before = gone.hull;
    eng.updateProjectiles(STEP);
    assert.equal(gone.hull, before, 'a torpedo chased a ship to warp and hit it');
  });

  test('the invariant sweep can see a lock on a ship that has left', () => {
    const rng = new RNG(0x1701n);
    const player = new Ship('constitution', { isPlayer: true, name: 'Enterprise' });
    const ally = new Ship('constitution', { faction: 'federation', name: 'Potemkin' });
    const gone = new Ship('bird_of_prey', { faction: 'klingon', name: 'Gone' });
    const stayer = new Ship('bird_of_prey', { faction: 'klingon', name: 'Stayer' });
    const eng = new Engagement(player, [gone, stayer], rng, { allies: [ally] });

    assert.equal(checkCombat(eng, OPTS).some((v) => v.code === 'eng.aitarget.absent'), false,
      'the sweep complained about a fight in which nothing is wrong');

    gone.withdrawn = true;
    ally.aiTarget = gone;
    assert.ok(checkCombat(eng, OPTS).some((v) => v.code === 'eng.aitarget.absent'),
      'nothing noticed a captain locked on a ship that is no longer in the fight');
  });
});

// -------------------------------------------------------------------------
// Ship state the sweep was not looking at.
//
// Hull, shields, crew, torpedoes, fires, subsystems, power and position were
// all checked. The antimatter reserve, the breach countdown, and the two flags
// that decide whether a ship survives a breach were not.

describe('the numbers a save can carry that nothing was reading', () => {
  /** The violation codes for one ship, on its own, out of any fight. */
  const sweep = (ship) => {
    const eng = new Engagement(ship, [new Ship('d7', { name: 'Opponent' })], new RNG(1n));
    return checkCombat(eng, OPTS).map((v) => v.code);
  };

  test('a broken antimatter figure does not survive the load', () => {
    const record = new Ship('constitution', { isPlayer: true, name: 'Enterprise' }).save();
    record.antimatter = NaN;
    const ship = Ship.load(record);
    assert.ok(Number.isFinite(ship.antimatter),
      `antimatter loaded as ${ship.antimatter}`);
  });

  test('and the ship can no longer fly anywhere for free', () => {
    const record = new Ship('constitution', { isPlayer: true, name: 'Enterprise' }).save();
    record.antimatter = NaN;
    const ship = Ship.load(record);

    const galaxy = new Galaxy(new RNG(1n));
    const plan = plotTransit(galaxy, 'sol', 'qonos', 9, ship);
    // Either priced or refused — but priced against a reserve the game can read.
    if (plan.transit) {
      ship.antimatter = Math.max(0, ship.antimatter - plan.fuel);
      assert.ok(Number.isFinite(ship.antimatter),
        `the reserve came back as ${ship.antimatter} after flying the course`);
      assert.ok(ship.antimatter < 100, 'the course cost nothing');
    }
  });

  test('the sweep says so if a bad reserve turns up another way', () => {
    const ship = new Ship('constitution', { isPlayer: true, name: 'Enterprise' });
    assert.equal(sweep(ship).some((c) => c.startsWith('ship.antimatter')), false,
      'complained about a ship with a full tank');
    ship.antimatter = NaN;
    assert.ok(sweep(ship).includes('ship.antimatter.finite'),
      'nothing noticed an unreadable antimatter reserve');
    ship.antimatter = 140;
    assert.ok(sweep(ship).includes('ship.antimatter.range'),
      'nothing noticed a reserve above a full tank');
  });

  test('a save cannot be both breaching and core-ejected', () => {
    const s = new Ship('constitution', { isPlayer: true, name: 'Enterprise' });
    s.beginBreach(20);
    const record = s.save();
    record.coreEjected = true;      // the flags are saved independently

    const loaded = Ship.load(record);
    assert.equal(loaded.breaching && loaded.coreEjected, false,
      'loaded counting down to an explosion it had already prevented');
    // And the ship is in one of the two states that actually exist.
    assert.ok(loaded.destroyed || !loaded.breaching || loaded.ejectCore(),
      'the one way out of a breach was gone and the breach was still running');
  });

  test('the sweep sees a breach running on a core that is not there', () => {
    const ship = new Ship('constitution', { isPlayer: true, name: 'Enterprise' });
    assert.equal(sweep(ship).includes('ship.breach.ejected'), false,
      'complained about an undamaged ship');
    ship.breaching = true;
    ship.breachTimer = 12;
    ship.coreEjected = true;
    assert.ok(sweep(ship).includes('ship.breach.ejected'),
      'nothing noticed a breach counting down with the core already gone');
  });

  test('the sweep sees a countdown that is not a number', () => {
    const ship = new Ship('constitution', { isPlayer: true, name: 'Enterprise' });
    ship.breaching = true;
    ship.breachTimer = NaN;
    assert.ok(sweep(ship).includes('ship.breachTimer'),
      'nothing noticed a breach countdown of NaN');
  });

  test('a ship with no cloaking device cannot be cloaked', () => {
    const ship = new Ship('constitution', { isPlayer: true, name: 'Enterprise' });
    assert.equal(ship.cloakCapable, false, 'a Constitution should carry no cloak');
    assert.equal(ship.cloak(), false, 'it cloaked when it has nothing to cloak with');
    assert.equal(sweep(ship).includes('ship.cloak.incapable'), false,
      'complained about a ship that is not cloaked');

    // Set past the order layer, which is the only way this can happen.
    ship.cloaked = true;
    assert.ok(sweep(ship).includes('ship.cloak.incapable'),
      'nothing noticed a ship cloaked without a cloaking device');
  });

  test('the countdown running out is not itself a violation', () => {
    // The timer is decremented and then tested, so it is a fraction below zero
    // on the tick it expires. The rule has to tolerate that and nothing wider.
    const ship = new Ship('constitution', { isPlayer: true, name: 'Enterprise' });
    ship.breaching = true;
    ship.breachTimer = -1.5e-13;
    assert.equal(sweep(ship).includes('ship.breachTimer'), false,
      'floating-point dust on the last tick was reported as a broken ship');
    ship.breachTimer = -0.5;
    assert.ok(sweep(ship).includes('ship.breachTimer'),
      'a countdown half a second past due went unreported');
  });
});

test('shooting first does not outlive the fight it happened in', () => {
  // The flag is read by `resolveHail` to take a quarter off the chance of
  // being heard. It is cleared by `finishCombat`, and by nothing else — so a
  // fight that ends by being force-quit rather than finished used to leave it
  // set for the rest of the commission.
  const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
  g.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS Target' })]);
  g.firstStrike = true;

  // Legal while the fight is running: that is what the flag is for.
  assert.equal(checkGame(g).some((v) => v.code === 'game.firstStrike.orphan'), false,
    'the sweep complained about a captain who really had just fired first');

  const resumed = Game.load(g.save());
  assert.equal(resumed.engagement, null, 'a fight was somehow restored');
  assert.equal(resumed.firstStrike, false,
    'the next hail in the campaign is still an appeal by someone who shot first');
  assert.equal(checkGame(resumed).some((v) => v.code === 'game.firstStrike.orphan'), false,
    'the resumed game is in a state its own invariants forbid');
});

test('and the sweep can see the flag standing on its own', () => {
  const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
  assert.equal(g.engagement, null, 'no fight should be running yet');
  g.firstStrike = true;
  assert.ok(checkGame(g).some((v) => v.code === 'game.firstStrike.orphan'),
    'nothing noticed a first strike in a battle that is not running');
});

describe('the fuzzer can actually reach what it fuzzes', () => {
  // A call that does not exist is not a test, it is a line.
  //
  // The API fuzzer above drives 4000 random calls per seed and checks every
  // invariant after each one. One of its calls was `g.setPreset?.(...)`. There
  // is no `setPreset` on Game — the method is `g.ship.power.applyPreset` — so
  // the optional chain swallowed it, silently, on every iteration of every
  // seed since it was written. Nothing failed, nothing was covered, and the
  // line read exactly like coverage.
  //
  // Optional chaining is the right tool for a method that may legitimately be
  // absent on some game states. It is also the perfect place to hide a typo,
  // so the names get checked once, here.

  const HERE_DIR = dirname(fileURLToPath(import.meta.url));

  test('every intercom station has a report of its own', () => {
    // The fallthrough this protects: `Game.intercom` looks the department up in
    // a local table and answers `reports[dept] ?? reports.security` — so a
    // station whose id has no entry does not fail, it quietly reads back the
    // security report. That is what the soak was doing to itself for
    // 'sickbay', and it is what the game would do to a real button if the two
    // lists ever drifted.
    const reportsBlock = readSrc('core', 'state.js').match(/const reports = \{([\s\S]*?)\n {4}\};/);
    assert.ok(reportsBlock, 'the intercom no longer builds a reports table');
    const answered = [...reportsBlock[1].matchAll(/^ {6}([a-z_]+):/gm)].map((m) => m[1]);
    assert.ok(answered.length >= 5, `only scraped ${answered.length} intercom reports`);
    assert.ok(INTERCOM_DEPTS.length >= 5, `only scraped ${INTERCOM_DEPTS.length} chair stations`);

    const g = new Game({ seed: 3n, crewMode: 'original' });
    const fallback = g.intercom('a department that does not exist');
    const silent = INTERCOM_DEPTS.filter((d) => !answered.includes(d));
    assert.deepEqual(silent, [],
      `chair stations with no intercom report of their own: ${silent.join(', ')}`);
    // And prove the fallthrough is real, so the check above is worth making.
    assert.equal(fallback, g.intercom('security'),
      'an unknown department no longer falls through to security — this guard can be simpler');
  });

  test('and the values it fuzzes with are values the game accepts', () => {
    // The other half, and the one I got wrong myself while fixing the first.
    //
    // A pool of legal-looking values that the target rejects is exactly as
    // dead as a method that does not exist, and it looks even more like
    // coverage. The fuzzer fabricated 'torpedoes', which is not a recipe id,
    // so the shop refused every job it was ever given. Replacing that pool
    // with `Object.keys(RECIPES)` swapped it for "0","1","2" — RECIPES is an
    // array — and refused just as quietly. Caught only by asking whether
    // anything was accepted.
    //
    // So: for each pool drawn from a canonical list, prove the game takes at
    // least one of it.
    const g = new Game({ seed: 17n, crewMode: 'original' });

    const accepted = Object.keys(RECIPE_BY_ID).filter((id) => {
      const r = g.fabricate(id);
      if (r?.ok) g.fabrication = null;
      return r?.ok;
    });
    assert.ok(accepted.length > 0,
      'the machine shop accepted none of the recipe ids the fuzzer offers it');

    const took = Object.keys(PRESETS).filter((id) => {
      g.ship.power.applyPreset(id);
      return g.ship.power.preset === id;
    });
    assert.deepEqual(took, Object.keys(PRESETS), 'a power preset the grid will not take');

    g.startCombat([new Ship('d7', { name: 'IKS Pool' })], { relentless: true });
    const targetable = SUBSYSTEM_KEYS.filter((k) => g.engagement.targetSubsystem(k));
    assert.deepEqual(targetable, [...SUBSYSTEM_KEYS],
      'a subsystem key the targeting computer rejects');
    g.engagement.end('routed');

    // Distinct reports, not merely seven calls that return: 'sickbay' returned
    // the security report word for word, and counting calls would have missed
    // that completely.
    const spoken = new Set(INTERCOM_DEPTS.map((d) => g.intercom(d)));
    assert.equal(spoken.size, INTERCOM_DEPTS.length,
      'two intercom stations give the identical report');
  });

  test('every optional call it makes names a method that exists', () => {
    // Comments stripped first. The paragraph above this test quotes the call
    // it was written for, and a guard that trips over its own explanation is
    // worse than no guard — it teaches people not to write the explanation.
    const src = readFileSync(join(HERE_DIR, 'invariants.test.js'), 'utf8')
      .split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
    const named = [...src.matchAll(/\bg\.([a-zA-Z_$][\w$]*)\?\.\(/g)].map((m) => m[1]);
    // Prove the scrape sees the shape before believing it found nothing.
    assert.ok(named.length >= 2,
      `only found ${named.length} optional calls on the game — the scrape is broken, not the code`);

    const g = new Game({ seed: 3n, crewMode: 'original' });
    const missing = [...new Set(named)].filter((name) => typeof g[name] !== 'function');
    assert.deepEqual(missing, [],
      `the fuzzer optionally calls methods Game does not have: ${missing.join(', ')}`);
  });
});
