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
import { DIFFICULTIES } from '../src/rules/difficulty.js';
import { SHIP_LIST } from '../src/world/ships.data.js';
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
import { takeCommandOf } from '../src/sim/command.js';
import { COMMISSION_DAYS } from '../src/campaign/clock.js';
import { EPISODES } from '../src/missions/episodes/index.js';
import { parseOrder } from '../src/ui/orders.js';
import { ABILITIES } from '../src/sim/officers.js';
// The canonical lists the pools below are drawn from. Hand-written copies of
// these are what let three of the fuzzer's calls do nothing at all.
import { SUBSYSTEM_KEYS } from '../src/sim/ship.js';
import { PRESETS, SUBSYSTEMS } from '../src/sim/power.js';
import { RECIPE_BY_ID } from '../src/sim/fabrication.js';
import { AWAY_TEMPLATES } from '../src/sim/away.js';

/**
 * Compression at which one tick is one commission hour.
 *
 * A voyage is flown in commission hours now, not in the four to twenty-six
 * seconds of play every voyage used to take whatever its length. So a test
 * that ticks its way to a destination compresses the commission — the same
 * accommodation `campaign.test.js` uses to run five years in a few
 * milliseconds. One tick is 1/30 s, so 108,000 makes it exactly one hour.
 */
const HOUR_PER_TICK = 108000;


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
  // Derived, not remembered.
  //
  // This was a hand-written seventeen of the eighteen non-Federation hulls —
  // `bioship` had never been through it — and seven of the twelve rungs, under
  // a title that says "at any difficulty". The five it never visited include
  // `commodore`, `rear_admiral` and `vice_admiral`, which are three of the five
  // rungs where the ship can be lost for good and the record cannot be taken
  // back. A rule broken only under permadeath would have had nowhere to show.
  //
  // Widened to the whole matrix, nothing broke — the game was sound across all
  // of it. But a guard that says "any" has to mean any, or the next change gets
  // the same free pass this one had.
  const HOSTILES = SHIP_LIST.filter((c) => c.faction !== 'federation').map((c) => c.id);
  const DIFFS = DIFFICULTIES.map((d) => d.id);

  // The instrument, before anything is believed about what it found. A
  // derivation that silently narrows is the same defect as a list that
  // silently drifts, and it fails more quietly.
  assert.equal(DIFFS.length, DIFFICULTIES.length, 'the ladder lost rungs on the way in');
  assert.ok(DIFFS.length >= 12, `only ${DIFFS.length} rungs`);
  assert.ok(HOSTILES.length >= 18, `only ${HOSTILES.length} hostile hulls`);
  assert.equal(HOSTILES.includes('constitution'), false, 'the player\u2019s own hull is in the enemy list');
  // Every one is actually reached: 216 fights over 18 hulls and 12 rungs walks
  // both lists whole, and the modulo arithmetic below is what makes that true.
  assert.equal(216 % HOSTILES.length, 0, 'the hull rotation does not divide the run');
  assert.equal(216 % DIFFS.length, 0, 'the rung rotation does not divide the run');

  const dog = new Watchdog();
  let unresolved = 0;
  let ticks = 0;

  for (let i = 0; i < 216; i++) {
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
    const g = new Game({ seed: BigInt(seed), crewMode, difficulty, shipClass, compression: HOUR_PER_TICK });
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
  const g = new Game({ seed: 3n, crewMode: 'original', compression: HOUR_PER_TICK });
  g.locationId = 'alpha_centauri';
  g.beginEncounter({
    kind: 'patrol', system: g.location, hostile: false,
    factionId: 'klingon', title: 'Patrol', text: 'Somebody is watching.',
  });
  assert.equal(g.encounter.system.id, 'alpha_centauri');

  g.setCourse('sol');
  // Genuinely under way, and past the midpoint, so the system the ship is
  // dropped into is the one it was heading for rather than the one it left.
  // Ticked to a fraction of the VOYAGE rather than for a count of seconds: a
  // voyage is measured in commission hours now, and twenty seconds of play is
  // no longer most of one.
  while (g.transit && g.transit.progress < 0.6) g.update(STEP);
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
  // The list used to wrap round to the first name again, which contradicted
  // the assertion three lines below it: past the end of the list, two ships in
  // one engagement had the same name and the tactical display offered the
  // captain two identical targets. It never came up while a force was one or
  // two hulls. A force is now built to a strength, the Orion list is three
  // names long, and three raiders is the commonest Orion encounter there is.
  assert.equal(hostileName('klingon', HOSTILE_NAMES.klingon.length),
    `${HOSTILE_NAMES.klingon[0]} II`, 'the list wraps onto a name already in use');
  assert.equal(hostileName('nobody_in_particular', 0), 'Unknown Vessel');

  // Past the end of the shortest list in the table, which is where it broke.
  const orions = Array.from({ length: 6 }, (_, i) => hostileName('orion', i));
  assert.equal(new Set(orions).size, 6, `six raiders, ${new Set(orions).size} names`);

  // `strength` is in Constitutions, not hulls — a warbird is 1.67 of one, so
  // three Constitutions of Romulan is a warbird with a scout or two alongside.
  const fleet = buildHostiles(g.rng, 'romulan', 3, ['warbird', 'scoutship']);
  assert.ok(fleet.length >= 1 && fleet.length <= 6, `${fleet.length} hulls`);
  for (const s of fleet) assert.ok(named(s), `an unnamed hostile: ${s.name}`);
  assert.equal(new Set(fleet.map((s) => s.name)).size, fleet.length,
    `${fleet.length} ships, ${new Set(fleet.map((s) => s.name)).size} names`);

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

describe('a fight interrupted by the phone is still a fight that happened', () => {
  // The autosave fires on `visibilitychange` and `beforeunload` — src/main.js
  // wires both — so on the phone this game is built for, taking a call in the
  // middle of a battle writes a save. `Game.save()` does not serialise the
  // engagement, and `Game.load` sets the mode back to the bridge on purpose.
  // That part is deliberate and documented: a fight "should not resume
  // mid-air".
  //
  // What was not deliberate is that nothing settled it. The enemy simply
  // stopped existing, the hull kept every point of damage the fight had cost,
  // the alert dropped to normal, and no after-action record was written — so
  // there was no trace the battle had ever been fought.
  //
  // The comment above that mode line convicts it. The transit case was fixed
  // for exactly this shape: "the fuel was charged and the voyage was not."
  // Here the damage was taken and the fight was not.

  test('the damage is kept, so the fight has to be accounted for', () => {
    const g = new Game({ seed: 31n, crewMode: 'original' });
    g.startCombat([new Ship('d7', { name: 'IKS Interrupted' })], { relentless: true });
    g.engagement.autoFire = true;
    for (let i = 0; i < 900; i++) g.update(STEP);

    // The fight has to have cost something, or this proves nothing.
    const hurt = g.ship.hullPct;
    assert.ok(hurt < 0.99, `the fight cost the ship nothing (${hurt}) — nothing to account for`);
    assert.ok(g.engagement && !g.engagement.over, 'the fight ended on its own before the save');

    const reloaded = Game.load(JSON.parse(JSON.stringify(g.save())));

    // The damage survives. That is correct and is the whole problem: a game
    // that keeps the wounds has to keep the reason for them.
    assert.ok(Math.abs(reloaded.ship.hullPct - hurt) < 1e-9,
      'the hull damage did not survive the save');

    assert.ok(reloaded.lastCombat,
      'the ship came back damaged from a battle with no after-action record of it');
    assert.equal(reloaded.lastCombat.outcome, 'interrupted');
    assert.equal(reloaded.engagement, null, 'a fight resumed mid-air');
    assert.equal(reloaded.alert, 'normal', 'still at battle stations with nobody to fight');
  });

  test('and the record of a fight that DID finish survives a save too', () => {
    // The second half, and a defect on its own. `lastCombat` is written by
    // finishCombat and read by the after-action panel in main.js, and its own
    // comment says it "survives the fight, which is what an after-action
    // report is for". It did not survive a SAVE — nothing serialised it — so
    // the panel came back empty after every reload, for every outcome.
    const g = new Game({ seed: 44n, crewMode: 'original' });
    g.startCombat([new Ship('scoutship', { faction: 'romulan', name: 'IRW Brief' })],
      { relentless: true });
    g.engagement.autoFire = true;
    for (let i = 0; i < 30000 && g.engagement && !g.engagement.over; i++) g.update(STEP);
    for (let i = 0; i < 60; i++) g.update(STEP);

    assert.ok(g.lastCombat, 'the fight did not finish, so there is nothing to carry');
    assert.notEqual(g.lastCombat.outcome, 'interrupted',
      'this fight was meant to end on its own, not be cut short by the save');
    const before = { ...g.lastCombat };

    const reloaded = Game.load(JSON.parse(JSON.stringify(g.save())));
    assert.deepEqual(reloaded.lastCombat, before,
      'the after-action record did not survive the save');
  });
});

describe('the conditions a captain sets outlive the app being closed', () => {
  // The serializer is hand-written in both directions, so a field is carried
  // only because somebody listed it twice. A round-trip diff of a lived-in
  // game found three that nobody did — and all three are orders with
  // mechanical weight, not decoration.
  //
  // The alert is the one that costs something. `effectRepairs` pays
  // `blue ? 0.18 : 0.12` of the hull and `blue ? 0.6 : 0.8` stardate, so a
  // captain who limps in, calls blue alert for maintenance stations and then
  // takes a phone call comes back at normal — with every later repair worth a
  // third less, silently, until they think to call it again.
  //
  // The mode reset beside these is deliberate and documented at length. These
  // three were not documented at all, which is the difference between a
  // decision and an oversight.

  test('an alert condition, an evasive order and an elevation all come back', () => {
    const g = new Game({ seed: 909n, crewMode: 'original' });
    g.setAlert('blue');
    g.ship.evasive = true;
    g.ship.desiredPitch = -12;
    for (let i = 0; i < 60; i++) g.update(STEP);

    // The orders have to have taken, or the round trip proves nothing.
    assert.equal(g.alert, 'blue', 'the alert was never set');
    assert.equal(g.ship.evasive, true);
    assert.equal(g.ship.desiredPitch, -12);
    assert.ok(!g.engagement, 'no fight here — that case is the test below');

    const back = Game.load(JSON.parse(JSON.stringify(g.save())));
    assert.equal(back.alert, 'blue', 'the ship stood down from maintenance stations by itself');
    assert.equal(back.ship.evasive, true, 'the helm stopped evading without being told to');
    assert.equal(back.ship.desiredPitch, -12, 'the helm levelled off without being told to');
  });

  test('and blue alert is worth something, which is why losing it matters', () => {
    // The assertion that makes the one above more than bookkeeping. If these
    // ever pay the same, the alert is decoration and the round trip is a
    // preference rather than a defect.
    const at = (level) => {
      const g = new Game({ seed: 909n, crewMode: 'original' });
      g.ship.hull = g.ship.maxHull * 0.5;
      g.setAlert(level);
      const r = g.effectRepairs();
      return r.after - r.before;
    };
    assert.ok(at('blue') > at('normal'),
      'blue alert repairs no better than normal, so the condition carries nothing');
  });

  test('but a fight cut short by the save stands down instead of resuming', () => {
    // #101 made a save taken mid-battle wake with the action broken off. Red
    // alert and an evasive helm restored for a fight that is over would be
    // worse than losing them: battle stations with nobody to fight.
    const g = new Game({ seed: 909n, crewMode: 'original' });
    g.startCombat([new Ship('d7', { name: 'IKS Standing' })], { relentless: true });
    g.setAlert('red');
    g.ship.evasive = true;
    for (let i = 0; i < 300; i++) g.update(STEP);
    assert.equal(g.alert, 'red', 'the fight did not put the ship at battle stations');
    assert.ok(g.engagement && !g.engagement.over, 'the fight ended before the save');

    const back = Game.load(JSON.parse(JSON.stringify(g.save())));
    assert.ok(back.lastCombat, 'the interrupted fight was not recorded');
    assert.equal(back.alert, 'normal', 'still at battle stations with nobody to fight');
    assert.equal(back.ship.evasive, false, 'still evading a fight that is over');
  });
});

describe('asking the same question twice gives the same ship', () => {
  // `applyAllMods` resets ship.mods to the class baseline and then applies
  // every source of modifiers in turn — progress, loadout, mastery, character,
  // difficulty. Each of those calls ends in `recomputeDerived`, which rescales
  // the current hull and shields by `newMax / prevMax` so that raising a
  // maximum does not leave the ship reading as pre-damaged.
  //
  // Done five times in a row, that sends the hull down to the unmodded scale
  // and back up, and 4588 * (4200/4620) * (4620/4200) is not 4588. It is
  // called on construction, on load, on promotion, on equipping a console and
  // on a difficulty change, and it returned a slightly different ship each
  // time it was asked the same question.

  test('applying every modifier twice changes nothing the second time', () => {
    const g = new Game({ seed: 909n, crewMode: 'original' });
    g.ship.takeDamage(400, { facing: 'port' });
    // A damaged ship, because the rescale only shows on a hull that is not
    // full: at 100% the clamp to maxHull hides the drift completely.
    assert.ok(g.ship.hull < g.ship.maxHull, 'the ship took no damage, so nothing can drift');

    const shape = () => JSON.stringify({
      hull: g.ship.hull,
      maxHull: g.ship.maxHull,
      shields: { ...g.ship.shields },
      maxShield: g.ship.maxShield,
      mods: { ...g.ship.mods },
    });

    g.applyAllMods();
    const once = shape();
    g.applyAllMods();
    assert.equal(shape(), once, 'the ship changed between two identical applications');
    for (let i = 0; i < 8; i++) g.applyAllMods();
    assert.equal(shape(), once, 'the ship drifted over repeated applications');
  });

  test('and a maximum that goes up still does not read as damage', () => {
    // What the rescale is for, and what the fix must not break. Raising
    // `hullMax` on a half-dead ship has to keep the PERCENTAGE, not the
    // absolute hull — otherwise fitting a console reads as taking a hit.
    const g = new Game({ seed: 909n, crewMode: 'original' });
    g.ship.hull = g.ship.maxHull * 0.5;
    const before = g.ship.hullPct;
    g.ship.applyMods({ hullMax: 1.25 });
    assert.ok(Math.abs(g.ship.hullPct - before) < 1e-9,
      `fitting a bigger hull moved the reading from ${before} to ${g.ship.hullPct}`);
    assert.ok(g.ship.maxHull > 0);
  });
});

describe('a reloaded game runs the same game', () => {
  // Nothing in the suite checked this, and it is the claim the whole project
  // rests on: the simulation is deterministic, so a record written and read
  // back has to carry on exactly where it left off.

  /** Everything that would betray a divergence, including the RNG's position. */
  const fingerprint = (g) => JSON.stringify({
    stardate: g.clock.stardate,
    hull: g.ship.hull,
    shields: { ...g.ship.shields },
    antimatter: g.ship.antimatter,
    locationId: g.locationId,
    crew: g.ship.crew,
    logs: g.log.length,
    ledger: g.ledger.entries.length,
    rng: g.rng.save(),
  });

  test('saved outside a fight, it continues identically', () => {
    const a = new Game({ seed: 4242n, crewMode: 'original' });
    // Damaged BEFORE the save, and this is not incidental. At full hull
    // `recomputeDerived` clamps to maxHull, which hides the rescale
    // completely — the first version of this test passed against the very
    // drift it was written to catch, because the ship it saved was unhurt.
    a.ship.takeDamage(400, { facing: 'port' });
    const to = a.galaxy.systems.find((s) => s.id !== a.locationId);
    a.setCourse(to.id, 7);
    // A voyage, so the encounter and upkeep streams are actually drawing.
    for (let i = 0; i < 1200; i++) { a.update(STEP); if (a.engagement) a.engagement.end('routed'); }
    assert.ok(!a.engagement, 'a fight was running — that is the case below');
    assert.ok(Number(a.rng.save().count) > 0, 'the RNG was never drawn from, so this proves nothing');
    assert.ok(a.ship.hull < a.ship.maxHull, 'the ship healed up, so the clamp hides everything');

    const b = Game.load(JSON.parse(JSON.stringify(a.save())));
    const run = (g) => {
      for (let i = 0; i < 3000; i++) { g.update(STEP); if (g.engagement) g.engagement.end('routed'); }
    };
    run(a); run(b);
    assert.equal(fingerprint(b), fingerprint(a),
      'a reloaded game drifted away from the one it was copied from');
  });

  test('but a fight caught by the save is EXPECTED to diverge, and why', () => {
    // Not a defect, and recorded here so nobody reads it as one. A save taken
    // mid-battle wakes with the action broken off rather than resuming it —
    // deliberate, and the reason Game.load gives for waking on the bridge. The
    // two copies are therefore facing different futures on purpose: one still
    // has a hostile in front of it and the other does not.
    const a = new Game({ seed: 4242n, crewMode: 'original' });
    a.startCombat([new Ship('d7', { name: 'IKS Diverge' })], { relentless: true });
    for (let i = 0; i < 300; i++) a.update(STEP);
    assert.ok(a.engagement && !a.engagement.over, 'the fight ended before the save');

    const b = Game.load(JSON.parse(JSON.stringify(a.save())));
    assert.equal(b.engagement, null, 'the fight resumed, which it must not');
    assert.equal(b.lastCombat?.outcome, 'interrupted',
      'the interrupted fight was not recorded, which is what makes the divergence honest');
  });
});

describe('a commission that cannot go on ends, rather than sitting there', () => {
  // Found by a long soak. A full tank is about ten neighbour jumps at warp 7,
  // and nothing refuels a ship except a starbase or a reputation perk — no
  // recipe makes antimatter and it does not regenerate. At 13 of the galaxy's
  // 43 systems an empty tank means no course the ship can afford and no
  // docking facility either.
  //
  // So a captain could run dry at Romulus and simply stop: unable to move,
  // unable to refuel, with the game neither continuing nor ending. That is the
  // one outcome a five-year commission must not have.

  /** A ship on an empty tank at a system with no way out. */
  const strand = (systemId) => {
    const g = new Game({ seed: 8080n, crewMode: 'original' });
    g.locationId = systemId;
    g.ship.antimatter = 0.05;
    return g;
  };

  /** Somewhere with no dock and nothing affordable next door. */
  const deadEnd = () => {
    const probe = new Game({ seed: 8080n, crewMode: 'original' });
    for (const sys of probe.galaxy.systems) {
      const g = strand(sys.id);
      if (g.dock?.().ok) continue;
      const canMove = g.galaxy.neighbors(sys.id)
        .some((n) => strand(sys.id).setCourse(n.id, 1).ok);
      if (!canMove) return sys.id;
    }
    return null;
  };

  test('there is somewhere a ship can be stuck, or this guards nothing', () => {
    // The positive case, proved before anything below is believed. If the
    // galaxy ever changes so that every system has a way out, this whole
    // describe block is dead weight and should say so out loud.
    assert.ok(deadEnd(), 'no system strands a ship any more — delete this guard');
  });

  test('being unable to move anywhere ends the commission', () => {
    const g = strand(deadEnd());
    assert.equal(g.over, false, 'the game was already over before the check ran');
    // A tick is all it should take to notice.
    g.update(STEP);
    assert.equal(g.over, true, 'the ship is stranded and the commission is still running');
    assert.ok(/adrift|strand|antimatter|fuel/i.test(g.overReason ?? ''),
      `the commission ended for "${g.overReason}", which does not say why`);
  });

  test('and it does not fire on a ship that can still limp somewhere', () => {
    // The half that matters more. Ending a commission by mistake is worse than
    // the soft-lock: a captain who can still make one warp-1 hop is not
    // stranded, and neither is one sitting at a starbase with an empty tank.
    const probe = new Game({ seed: 8080n, crewMode: 'original' });
    let limped = null;
    let docked = null;
    for (const sys of probe.galaxy.systems) {
      const g = strand(sys.id);
      if (!docked && g.dock?.().ok) docked = sys.id;
      if (!limped && g.galaxy.neighbors(sys.id).some((n) => strand(sys.id).setCourse(n.id, 1).ok)) {
        limped = sys.id;
      }
      if (limped && docked) break;
    }
    assert.ok(limped && docked, 'could not find both an escapable system and a dockable one');

    for (const [where, why] of [[limped, 'can still reach a neighbour'], [docked, 'is at a dock']]) {
      const g = strand(where);
      for (let i = 0; i < 60; i++) g.update(STEP);
      assert.equal(g.over, false, `a ship that ${why} had its commission ended at ${where}`);
    }
  });

  test('and a full tank is never mistaken for an empty one', () => {
    const g = new Game({ seed: 8080n, crewMode: 'original' });
    assert.equal(g.ship.antimatter, 100);
    for (let i = 0; i < 300; i++) g.update(STEP);
    assert.equal(g.over, false, 'a fuelled ship at Sol was declared stranded');
  });
});

describe('a ship lost where nobody was shooting is still a ship lost', () => {
  // `loseTheShip` is the game's whole policy for losing a hull: difficulty
  // decides whether it can happen at all, the first loss costs standing and
  // gets you a board and a replacement, and the second ends the career because
  // Starfleet does not hand out a third. It was called from exactly one place
  // — `finishCombat` — so it only ever ran when the ship died in a fight.
  //
  // A ship can die outside one. A plasma storm in the Badlands does 40 to 130
  // damage a second through `takeDamage`, which destroys the hull like anything
  // else: parked there at 6% the ship breaches at about the fiftieth second.
  // Nothing noticed. The captain was left in command of a destroyed ship —
  // hull at zero, still on the bridge, no replacement offered, no ending, and
  // the invariant checker quiet because the ship IS correctly flagged
  // destroyed.

  /** A weakened ship somewhere that will finish it off. */
  const inTheStorm = () => {
    const g = new Game({ seed: 5150n, crewMode: 'original' });
    const storm = g.galaxy.systems.find((s) => s.hazard === 'plasma_storm');
    assert.ok(storm, 'the charts no longer have a plasma storm to be caught in');
    g.locationId = storm.id;
    g.ship.hull = g.ship.maxHull * 0.06;
    g.ship.shieldsUp = false;
    for (const f of Object.keys(g.ship.shields)) g.ship.shields[f] = 0;
    return g;
  };

  test('the hazard really does destroy a ship outside a fight', () => {
    // The positive case. If the storm ever stops being able to kill, the test
    // below proves nothing and should say so rather than passing quietly.
    const g = inTheStorm();
    let destroyed = false;
    for (let i = 0; i < 40000 && !destroyed; i++) {
      g.update(STEP);
      destroyed = g.ship.destroyed;
    }
    assert.ok(destroyed, 'a 6% hull sat in a plasma storm and survived');
    assert.ok(!g.engagement, 'something started a fight — this is the out-of-combat path');
  });

  test('and losing it there costs what losing it in a fight costs', () => {
    const g = inTheStorm();
    const before = g.ship.name;
    for (let i = 0; i < 40000 && !g.ship.destroyed; i++) g.update(STEP);
    // A few more ticks for the consequence to land.
    for (let i = 0; i < 60; i++) g.update(STEP);

    assert.equal(g.shipsLost, 1, 'the ship was destroyed and the record does not show it lost');
    assert.ok(g.ledger.entries.some((e) => e.kind === 'ship_lost'),
      'no ledger entry for a ship lost');
    // Either a new command or a finished career — never a destroyed ship the
    // captain is still standing on.
    assert.ok(g.over || !g.ship.destroyed,
      `still in command of ${before}, which is destroyed, with the game running`);
  });

  test('and a second loss ends the career, wherever it happens', () => {
    const g = inTheStorm();
    g.shipsLost = 1;   // one already gone, as after a fight
    for (let i = 0; i < 40000 && !g.ship.destroyed; i++) g.update(STEP);
    for (let i = 0; i < 60; i++) g.update(STEP);
    assert.equal(g.over, true, 'a second ship was lost and the commission continued');
  });

  test('but a ship that is merely damaged is left alone', () => {
    // The half that must not misfire: hazards hurt, and being hurt is not
    // being lost.
    const g = new Game({ seed: 5150n, crewMode: 'original' });
    g.ship.hull = g.ship.maxHull * 0.4;
    for (let i = 0; i < 3000; i++) g.update(STEP);
    assert.equal(g.over, false, 'a damaged but living ship ended the commission');
    assert.ok(!g.shipsLost, 'a damaged ship was recorded as lost');
  });
});

// ============================================================ the five years

describe('the commission ends when the five years are up', () => {
  // The headline feature of the whole game is that it is a *five-year* mission,
  // and the clock that measures it was read by nothing.
  //
  // `CampaignClock.complete` is computed correctly, `progress` pins at 1 and
  // `remainingText()` will say "The five-year mission is complete." on the
  // bridge — and then the game carries on. Measured before the fix: day 1,856
  // of 1,826, `complete: true`, the bridge announcing the mission finished, and
  // `over: false` with no reason, no assessment, no ending. Year six, day
  // thirty-one, still steering.
  //
  // Same shape as the stranding and the out-of-combat hull loss above: a real
  // terminal condition that exactly one module knew about.

  /** A commission driven to its end on an injected clock, in 48-hour steps. */
  const flyToTheEnd = (extraDays = 40, seed = 4242n) => {
    let t = 1_700_000_000_000;
    const g = new Game({ seed, now: () => t });
    const target = COMMISSION_DAYS + extraDays;
    for (let step = 0; step < 1200 && g.campaign.elapsedDays < target; step++) {
      t += 48 * 3600 * 1000;         // under MAX_ABSENCE_HOURS, so nothing is forfeited
      g.syncCampaign();
      for (let i = 0; i < 20; i++) g.update(STEP);
      if (g.over) break;
    }
    return g;
  };

  test('the clock really does reach the end of the commission', () => {
    // The positive case first. If the clock ever stops being drivable this way,
    // every test below would pass by never getting there.
    let t = 1_700_000_000_000;
    const g = new Game({ seed: 4242n, now: () => t });
    assert.equal(g.campaign.complete, false, 'a commission began already finished');
    for (let step = 0; step < 1200 && !g.campaign.complete; step++) {
      t += 48 * 3600 * 1000;
      g.campaign.sync();
      g.campaign.drainPending();
    }
    assert.equal(g.campaign.complete, true, 'the campaign clock never reached 1,826 days');
    assert.ok(g.campaign.elapsedDays >= COMMISSION_DAYS,
      `elapsed ${g.campaign.elapsedDays} days, needed ${COMMISSION_DAYS}`);
  });

  test('serving out the five years ends the commission', () => {
    const g = flyToTheEnd();
    assert.equal(g.over, true,
      `day ${Math.floor(g.campaign.elapsedDays)} of ${COMMISSION_DAYS} and the commission is still running`);
    assert.ok(g.overReason, 'the commission ended with no reason to show the captain');
  });

  test('and it ends as a completion, not as a loss', () => {
    // This is the whole point of the ending: five years served is the good
    // outcome. It must be distinguishable from being stranded or losing the
    // ship, because the end-of-commission screen reads the same field.
    const g = flyToTheEnd();
    assert.equal(g.commissionCompleted, true,
      'the five years were served and the ending does not say so');
    assert.ok(!/lost|stranded/i.test(g.overReason), `read as a failure: ${g.overReason}`);
    assert.equal(g.shipsLost, 0, 'the ship was lost on the way, so this proves nothing');
    assert.ok(g.ledger.entries.some((e) => e.kind === 'commission_completed'),
      'nothing in the record says the commission was completed');
  });

  test('the record still assesses, and the assessment is not the ending', () => {
    // The screen shows `ledger.assessment()`. Completing a commission must not
    // be worth service points of its own — the bands were tuned without it, and
    // a captain does not get to be Exemplary for merely surviving.
    const g = flyToTheEnd();
    const a = g.ledger.assessment();
    assert.ok(a && a.label, 'no assessment at the end of a completed commission');
    assert.equal(typeof g.ledger.serviceScore(), 'number');
  });

  test('a commission that is not up does not end', () => {
    // The half that must not misfire. Four years in is four years in.
    let t = 1_700_000_000_000;
    const g = new Game({ seed: 77n, now: () => t });
    for (let step = 0; step < 700 && g.campaign.elapsedDays < COMMISSION_DAYS - 100; step++) {
      t += 48 * 3600 * 1000;
      g.syncCampaign();
      for (let i = 0; i < 20; i++) g.update(STEP);
    }
    assert.ok(g.campaign.elapsedDays > 1000, 'the probe never got far enough to mean anything');
    assert.equal(g.over, false,
      `ended at day ${Math.floor(g.campaign.elapsedDays)} of ${COMMISSION_DAYS}`);
    assert.ok(!g.commissionCompleted, 'an unfinished commission was marked complete');
  });

  test('the commission does not end twice', () => {
    const g = flyToTheEnd();
    const entries = () => g.ledger.entries.filter((e) => e.kind === 'commission_completed').length;
    const once = entries();
    for (let i = 0; i < 600; i++) g.update(STEP);
    assert.equal(entries(), once, 'the end of the commission was recorded more than once');
  });

  test('and a commission that has ended still says why after a reload', () => {
    // `over` was saved and `overReason` was not, so reloading a finished
    // commission produced a screen that said only "Your command has ended."
    // and would not say what had happened.
    const g = new Game({ seed: 9n });
    g.gameOver('a second ship lost — no further command was offered');
    const back = Game.load(g.save());
    assert.equal(back.over, true, 'a finished commission reloaded as though it were running');
    assert.equal(back.overReason, g.overReason, 'the reason the commission ended did not survive a reload');
  });

  test('and a completed commission reloads as completed', () => {
    const g = flyToTheEnd();
    const back = Game.load(g.save());
    assert.equal(back.over, true);
    assert.equal(back.commissionCompleted, true,
      'a completed commission reloaded as a failure');
  });
});

// ================================================ borders you did not fly over

describe('a border is a fact about where you are, not about how you got there', () => {
  // Found by a verification check that failed once in three runs and would not
  // reproduce — "the treaty rider clears the zone, and says so rather than
  // being silent", with `said: false` and everything else right. It was not a
  // flake in the test. It was the test catching a real thing intermittently,
  // because the thing itself only happens when a course is interrupted.
  //
  // `crossTheZone()` and `enterTheDMZ()` were called from exactly one place —
  // `arrive()`. Two other paths put the ship in a system: being forced out of
  // warp mid-course (state.js, the transit tick), and `dropOutOfWarp()`, the
  // order to break off a course. Neither noticed a border.
  //
  // Measured over 400 flights into the Romulan Neutral Zone: 354 arrivals, all
  // 354 charged as a crossing — and 11 flights that were jumped on the way in,
  // none of them charged. The ship was sitting inside the Zone and the
  // Romulans had not logged it. Get intercepted and the treaty violation does
  // not happen.
  //
  // The same 400 flights into the demilitarised zone: 27 ended with the ship
  // parked inside it, `inTheDMZ` false, nobody having noticed. That is the
  // check that kept failing.

  /**
   * The first game, over a scan of seeds, that ends up at `target` having been
   * forced out of warp rather than having arrived.
   *
   * Written as a scan rather than a hard-coded seed because the interception is
   * a 2%-per-second roll on the main stream: pinning a seed would pin every
   * other roll in the flight with it, and the next change to any of them would
   * quietly turn this into a test of nothing.
   */
  const flightJumpedInto = (from, target, prep = () => {}) => {
    for (let s = 1n; s <= 400n; s++) {
      const g = new Game({ seed: s, compression: HOUR_PER_TICK });
      g.locationId = from;
      g.ship.antimatter = g.ship.maxAntimatter;
      prep(g);
      if (!g.setCourse(target).ok) continue;
      for (let i = 0; i < 30 * 3000 && g.transit; i++) g.update(STEP);
      if (g.locationId !== target) continue;
      if (g.log.some((l) => /forced out of warp/i.test(l.text ?? ''))) return g;
    }
    return null;
  };

  /** The same flight, flown to its end without being interrupted. */
  const flightInto = (from, target, prep = () => {}) => {
    for (let s = 1n; s <= 400n; s++) {
      const g = new Game({ seed: s, compression: HOUR_PER_TICK });
      g.locationId = from;
      g.ship.antimatter = g.ship.maxAntimatter;
      prep(g);
      if (!g.setCourse(target).ok) continue;
      for (let i = 0; i < 30 * 3000 && g.transit; i++) g.update(STEP);
      if (g.locationId !== target) continue;
      if (!g.log.some((l) => /forced out of warp/i.test(l.text ?? ''))) return g;
    }
    return null;
  };

  const crossedTheZone = (g) => g.ledger.entries.some((e) => /Neutral Zone/i.test(e.text ?? ''));

  test('flying into the Neutral Zone is a crossing, and is charged as one', () => {
    // The positive case. Everything below is a comparison against this, so if
    // arriving ever stops being a violation the rest must fail loudly rather
    // than agree with a broken baseline.
    const g = flightInto('neutral_zone_1', 'devron');
    assert.ok(g, 'no uninterrupted flight into the Zone in 400 seeds');
    assert.ok(crossedTheZone(g), 'arriving at Devron was not recorded as a crossing');
    assert.ok(g.ledger.standingOf('romulan') < 0, 'the Romulans did not mind at all');
    assert.equal(g.inTheZone, true);
  });

  test('and so is being forced out of warp inside it', () => {
    const g = flightJumpedInto('neutral_zone_1', 'devron');
    assert.ok(g, 'no interrupted flight into the Zone in 400 seeds — the probe cannot see the case');
    assert.equal(g.locationId, 'devron');
    assert.ok(crossedTheZone(g),
      'the ship was dropped out of warp inside the Romulan Neutral Zone and nobody logged it');
    assert.equal(g.inTheZone, true, 'inside the Zone and the game does not think so');
  });

  test('the demilitarised zone notices a ship that was jumped on the way in', () => {
    const g = flightJumpedInto('setlik', 'dmz_volnar', (x) => { x.inTheDMZ = false; });
    assert.ok(g, 'no interrupted flight into the DMZ in 400 seeds');
    assert.equal(g.inTheDMZ, true,
      'the ship is parked in the demilitarised zone and the game does not think it is there');
  });

  test('and the treaty rider still says so when the arrival was not an arrival', () => {
    // This is the verification check that kept failing, as a unit test.
    const g = flightJumpedInto('setlik', 'dmz_volnar', (x) => {
      x.inTheDMZ = false;
      x.reputation.perks.add('dmz_passage');
    });
    assert.ok(g, 'no interrupted flight into the DMZ in 400 seeds');
    assert.ok(g.log.some((l) => /waved through|treaty rider/i.test(l.text ?? '')),
      'the rider cleared the zone silently, which is indistinguishable from not working');
  });

  test('breaking off a course inside the Zone is a crossing too', () => {
    // `dropOutOfWarp` is the order, not the ambush: same position, same treaty.
    const g = new Game({ seed: 31n, compression: HOUR_PER_TICK });
    g.locationId = 'neutral_zone_1';
    g.ship.antimatter = g.ship.maxAntimatter;
    assert.ok(g.setCourse('devron').ok, 'could not lay in the course at all');
    // Far enough along that the nearest system on the route is the destination.
    while (g.transit && g.transit.progress < 0.9) g.update(STEP);
    assert.ok(g.transit, 'the flight ended before it could be broken off');
    const out = g.dropOutOfWarp();
    assert.ok(out.ok, 'the order to break off was refused');
    assert.equal(g.locationId, 'devron', 'coasted in somewhere else — this proves nothing');
    assert.ok(crossedTheZone(g),
      'broke off a course inside the Neutral Zone and it was not recorded as a crossing');
  });

  test('but being forced out somewhere ordinary is not a border incident', () => {
    // The half that must not misfire. Most interceptions happen nowhere near a
    // line, and none of them are treaty violations.
    const g = flightJumpedInto('sol', 'wolf359');
    assert.ok(g, 'no interrupted flight to Wolf 359 in 400 seeds');
    assert.ok(!crossedTheZone(g), 'an ordinary interception was written up as a treaty violation');
    assert.equal(g.inTheZone, false);
    assert.equal(g.inTheDMZ, false);
  });

  test('and leaving a zone that way re-arms it', () => {
    // The second-order half. `inTheDMZ` is "we are already in, do not say it
    // twice"; if leaving by interception never cleared it, the NEXT entry would
    // be silent for the rest of the commission.
    const armed = (x) => { x.inTheDMZ = true; };
    const flown = flightInto('dmz_volnar', 'setlik', armed);
    assert.ok(flown, 'no uninterrupted flight out of the DMZ in 400 seeds');
    assert.equal(flown.inTheDMZ, false,
      'flew out of the demilitarised zone and the game still thinks we are in it');

    // And by the path this whole suite is about.
    const jumped = flightJumpedInto('dmz_volnar', 'setlik', armed);
    assert.ok(jumped, 'no interrupted flight out of the DMZ in 400 seeds');
    assert.equal(jumped.inTheDMZ, false,
      'was forced out of warp beyond the zone and the game still thinks we are inside it');
  });
});

// ========================================================= leading from the front

describe('the captain can lead a landing party, and it costs something', () => {
  // `captainLeads` is a whole mechanic: the order line understands "I'll lead",
  // "with me", "myself" and "personally" in two separate parsers, it is worth
  // +2 on every check in `modifierFor`, and `check()` rolls a wound for the
  // captain at 35% of the officer death chance when the hazard is lethal.
  //
  // None of it reached the game.
  //
  //   The order was parsed and dropped. `away_team` passes `order.captainLeads`
  //   to `buildAwayTeam` on ONE branch — the one that says "there is nowhere to
  //   send them, Captain" and does nothing. When there is somewhere to send
  //   them, `awayMission` built the team with `captainLeads` hard-coded false.
  //
  //   And the risk was computed and read by nobody. `result.captainWounded` was
  //   set in `away.js` and appears nowhere else in `src/` — no log line, no
  //   entry in the record, not a sentence in `buildCheckText`. Measured over
  //   600 lethal checks with the captain leading: it fired twice, and both
  //   times the report talked about the science officer.

  const leadOrders = ["away team, i'll lead", 'landing party, with me'];

  test('the order line hears a captain saying they will go', () => {
    // The positive case: if this ever stops parsing, everything below is
    // testing a road nobody can drive down.
    const g = new Game({ seed: 1n });
    for (const t of leadOrders) {
      const o = parseOrder(t, g.crew);
      assert.equal(o?.action, 'away_team', `"${t}" no longer assembles a team`);
      assert.equal(o.captainLeads, true, `"${t}" was not heard as the captain going`);
    }
    assert.equal(parseOrder('away team', g.crew).captainLeads, false,
      'an ordinary away team order now sends the captain down as well');
  });

  /** A derelict to board, which is the away mission that needs no fight. */
  const withAWreck = (seed = 8n) => {
    const g = new Game({ seed });
    // The shape `finishCombat` leaves behind. `wreckHere` is a getter over it.
    g.wreck = { tier: 2, systemId: g.locationId, hulls: 1, name: 'derelict', boarded: false };
    return g;
  };

  test('and a landing party the captain leads knows they are on it', () => {
    const g = withAWreck();
    assert.ok(g.availableAwayMissions().some((t) => t.id === 'derelict_search'),
      'no derelict to board — the probe cannot see the case');
    const r = g.awayMission('derelict_search', { captainLeads: true });
    assert.ok(r.ok, `the mission did not run: ${r.reason}`);
    assert.equal(g.awayTeam.captainLeads, true,
      'the captain said they were leading and the landing party went without them');
  });

  test('and one they do not lead still does not take them', () => {
    const g = withAWreck();
    const r = g.awayMission('derelict_search');
    assert.ok(r.ok, `the mission did not run: ${r.reason}`);
    assert.equal(g.awayTeam.captainLeads, false,
      'the captain went down with a party they never said they would lead');
  });

  test('a captain who goes down is said to have gone down', () => {
    // The consequence half. Scanned rather than seeded for the same reason as
    // the border suite: the wound is a roll, and pinning a seed would pin every
    // other roll in the mission with it.
    let found = null;
    for (let s = 1n; s <= 400n && !found; s++) {
      const g = withAWreck(s);
      const r = g.awayMission('derelict_search', { captainLeads: true });
      if (r.ok && r.captainWounded) found = { g, r };
    }
    assert.ok(found, 'no captain was wounded in 400 landing parties — the probe sees nothing');
    const { g, r } = found;
    assert.ok(g.log.some((l) => /you are hit|carrying you back/i.test(l.text ?? '')),
      'the captain was wounded and the ship was never told');
    assert.ok(g.ledger.entries.some((e) => e.kind === 'captain_wounded'),
      'nothing in the record says the captain was hurt leading a landing party');
    assert.equal(r.of, 3, 'a mission broken off reported fewer objectives than it had');
    // The party stops where the captain went down, so the wound is always on
    // the last step attempted. Being hit on the third of three is a real case
    // and looks identical, which is why breaking off is proved separately.
    let brokeOff = null;
    for (let s = 1n; s <= 400n && !brokeOff; s++) {
      const gg = withAWreck(s);
      const rr = gg.awayMission('derelict_search', { captainLeads: true });
      if (rr.ok && rr.captainWounded && rr.steps.length < 3) brokeOff = rr;
    }
    assert.ok(brokeOff,
      'no landing party ever broke off early — the captain goes down and it carries on');
  });

  test('and an unhurt captain does not stop the mission', () => {
    // Must not misfire: most landing parties come back with everyone on them.
    let ran = 0;
    for (let s = 1n; s <= 60n; s++) {
      const g = withAWreck(s);
      const r = g.awayMission('derelict_search', { captainLeads: true });
      if (!r.ok || r.captainWounded) continue;
      ran++;
      assert.equal(r.steps.length, 3,
        'a landing party with nobody hurt came back early');
      assert.ok(!g.ledger.entries.some((e) => e.kind === 'captain_wounded'),
        'an unhurt captain was written up as wounded');
    }
    assert.ok(ran > 20, `only ${ran} clean landing parties in 60 — this proves little`);
  });

  test('a mission broken off is not reported as a clean sweep', () => {
    // The denominator. `won === steps.length` counted the objectives ATTEMPTED,
    // so a party that broke off after one success out of three read as a
    // success — which was already true for a wiped-out team before the captain
    // could be wounded at all.
    for (let s = 1n; s <= 400n; s++) {
      const g = withAWreck(s);
      const r = g.awayMission('derelict_search', { captainLeads: true });
      if (!r.ok || r.steps.length === 3) continue;
      assert.equal(r.of, 3, 'a broken-off mission shrank the objectives it was measured against');
      assert.ok(r.outcome !== 'success' || r.passed === 3,
        `broke off after ${r.passed} of 3 and reported ${r.outcome}`);
    }
  });
});

// =============================================== the fight an episode ordered

describe('an episode is settled by its own fight and no other', () => {
  // `settleCombat` says what it is for in its first line — "The fight this
  // episode ordered is over" — and it was called at the end of EVERY fight,
  // with nothing checking that the fight that just ended was that one.
  //
  // So a stage's held reward was paid out by whatever the captain shot next.
  // Measured, taking the stage's fight choice while already in an ordinary
  // engagement and then finishing THAT fight:
  //
  //   the_cube          episode complete: true engaged   xp +2350  banked +1
  //   tholian_border    episode complete: true fought_out xp +2890  banked +1
  //   organia_question  episode complete: true defended   xp +2350  banked +1
  //
  // An ordinary Bird-of-Prey is worth 550. The Borg cube episode was completed,
  // banked and paid 1,800 experience for killing a Bird-of-Prey at Sol — and
  // the cube itself then arrived, for an episode that was already over.
  //
  // Reachable in one session with no save and no reload, and reachable again
  // across one: a fight interrupted by a save is never resumed (see the
  // interrupted-combat handling in `load`), so the episode goes on waiting and
  // the next fight anywhere settles it.

  /** Walk an episode to the stage that orders a fight, without taking it. */
  const atTheFightStage = (def, seed = 5n) => {
    const g = new Game({ seed });
    const m = g.missions.start(def.id, g);
    if (!m) return null;
    for (let i = 0; i < 40; i++) {
      if (m.complete) return null;
      const need = m.stageLocation?.(m.stage);
      if (need) g.locationId = need;
      const open = m.choices().filter((c) => !c.locked);
      if (!open.length) return null;
      if (open[0].effects?.combat) return { g, m, choiceId: open[0].id };
      if (!g.chooseMission(open[0].id)) return null;
    }
    return null;
  };

  /** Somebody with nothing to do with any episode. */
  const anOrdinaryFight = (g) => {
    g.startCombat([new Ship('bird_of_prey', { name: 'IKS Nothing', faction: 'klingon' })]);
    for (const s of g.engagement.hostiles) { s.hull = 1; s.destroyed = false; }
  };

  const fightToTheEnd = (g) => {
    for (let i = 0; i < 30 * 600 && g.engagement && !g.engagement.over; i++) g.update(STEP);
    for (let i = 0; i < 60; i++) g.update(STEP);
  };

  /** Every episode that has a stage ordering a fight, so none is missed. */
  const withFights = EPISODES.map((d) => [d, atTheFightStage(d)]).filter(([, f]) => f);

  test('there are episodes that order a fight', () => {
    // The positive case. If episodes ever stop queueing combat, everything
    // below passes by testing nothing.
    assert.ok(withFights.length >= 5,
      `only ${withFights.length} episodes reach a stage that orders a fight`);
  });

  test("and the episode's own fight still settles it", () => {
    // The half that must keep working, and the reason this is not fixed by
    // simply not calling `settleCombat`.
    let settled = 0;
    for (const [def] of withFights) {
      const f = atTheFightStage(def);
      if (!f) continue;
      f.g.chooseMission(f.choiceId);
      for (let i = 0; i < 5 && !f.g.engagement; i++) f.g.update(STEP);
      if (!f.g.engagement) continue;
      for (const s of f.g.engagement.hostiles) { s.hull = 1; s.destroyed = false; }
      fightToTheEnd(f.g);
      assert.equal(f.m.pending, null,
        `${def.id}: the episode fought its own fight and is still waiting on one`);
      settled++;
    }
    assert.ok(settled >= 5, `only ${settled} episodes settled their own fight`);
  });

  test('a stage that orders a fight during one sends its enemies into that fight', () => {
    // Held apart because it looks like the defect and is not it. `startCombat`
    // called during a fight does not start a second one: it puts the new ships
    // into the engagement in progress — "More of them, closing" — so the
    // episode's enemies really are in that fight and it really does answer for
    // it. All seven episodes that order a fight do this.
    //
    // Asked by identity rather than by counting hostiles: the ordinary hostile
    // can die on the same tick the episode's arrives, and the count never
    // moves. Counting said they had not joined, which is how this was nearly
    // filed as a bug.
    let joined = 0;
    for (const [def] of withFights) {
      const f = atTheFightStage(def);
      if (!f) continue;
      const { g, m } = f;
      anOrdinaryFight(g);
      if (!g.chooseMission(f.choiceId)) continue;
      assert.ok(m.pending, `${def.id}: the stage did not queue a fight at all`);
      const ordered = g.pendingCombat?.ships ?? [];
      assert.ok(ordered.length, `${def.id}: the stage ordered a fight with nobody in it`);
      g.update(STEP);
      assert.ok(g.engagement && ordered.some((s) => g.engagement.hostiles.includes(s)),
        `${def.id}: the enemies the stage ordered never arrived`);
      assert.equal(g.engagement.missionFightId, m.pending.fightId,
        `${def.id}: its enemies are in this fight and it does not answer for it`);
      joined++;
    }
    assert.equal(joined, withFights.length,
      `only ${joined} of ${withFights.length} episodes put their enemies into the fight`);
  });

  test('and a fight broken off by a save does not settle it later either', () => {
    // The across-a-save route, on the only record that can still produce it.
    //
    // A stage's fight is re-ordered on load now, so a save taken in that window
    // comes back with the ships still coming and nothing is left dangling. What
    // CAN still dangle is a record written before the stage's combat spec was
    // carried: `pending` comes back, `combat` is not there to rebuild from, and
    // inventing a battle for it would be worse than not having one. So those
    // episodes wait — and the thing this guard was written for is that the next
    // fight anywhere must not answer for them.
    //
    // The legacy shape is built here rather than waited for, because the game
    // no longer writes it.
    let checked = 0;
    for (const [def] of withFights) {
      const f = atTheFightStage(def);
      if (!f) continue;
      f.g.chooseMission(f.choiceId);
      for (let i = 0; i < 5 && !f.g.engagement; i++) f.g.update(STEP);
      if (!f.g.engagement) continue;

      const record = JSON.parse(JSON.stringify(f.g.save()));
      if (record.missions?.active?.pending) delete record.missions.active.pending.combat;
      const back = Game.load(record);
      const bm = back.missions.active;
      if (!bm?.pending) continue;      // already settled, nothing to prove here
      assert.equal(back.pendingCombat, null,
        `${def.id}: a record with no combat spec queued a fight out of nothing`);
      checked++;
      back.locationId = 'sol';
      back.mode = MODES.BRIDGE;
      const banked = back.missions.completed.size;
      anOrdinaryFight(back);
      fightToTheEnd(back);
      assert.equal(bm.complete, false,
        `${def.id} was completed after a reload by a fight somewhere else`);
      assert.equal(back.missions.completed.size, banked,
        `${def.id} was banked after a reload by a fight somewhere else`);
    }
    assert.ok(checked >= 3, `only ${checked} episodes were left waiting across a save`);
  });
});

// ==================================================== what the watch holds on to

describe('a watch report is something a captain can actually hear', () => {
  // `conLines` is what the officer with the con is holding to tell you when you
  // are next on the bridge, and nothing ever emptied it except `takeCon`. Every
  // resume off the bridge, and every fight, pushed more on.
  //
  // Measured, a captain off the bridge across a five-year commission — away
  // twelve hours at a time, twice a day:
  //
  //   resumes    10 | conLines    10 | save  10KB
  //   resumes   500 | conLines   500 | save  43KB
  //   resumes  3650 | conLines  3650 | save 206KB
  //
  // Two things wrong with that and they have one fix. The save grows without
  // bound — 206KB, and the autosave ring keeps three of them, on a phone. And
  // the report is unusable: the watch officer hands back 3,652 lines, when the
  // entire point of the handover is that it is what you come back to.
  //
  // `pushLog` has capped the ship's log at 400 since it was written, and
  // `MAX_ABSENCE_HOURS` is the same idea applied to time. This is that rule
  // applied to the one list that never had it.

  /** A commission resumed `n` times with the captain somewhere else. */
  const awayFromTheBridge = (n) => {
    let t = 1_700_000_000_000;
    const g = new Game({ seed: 3n, now: () => t });
    g.walk.roomId = 'sickbay';       // what `onBridge` actually reads
    assert.equal(g.onBridge, false, 'the probe never got the captain off the bridge');
    for (let i = 0; i < n; i++) {
      t += 12 * 3600 * 1000;
      g.syncCampaign();
    }
    return g;
  };

  test('the watch really does hold a report for a captain who is elsewhere', () => {
    // The positive case, and it needed proving twice: `mode = 'walk'` does not
    // put the captain off the bridge — `onBridge` reads `walk.roomId` — and the
    // first version of this measured a parked ship that wrote nothing at all.
    const g = awayFromTheBridge(10);
    assert.ok(g.conLines.length > 0, 'ten absences and the watch has nothing to say');
    assert.ok(g.conOfficer, 'nobody took the con while the captain was off the bridge');
  });

  test('and it stays a report rather than becoming an archive', () => {
    const g = awayFromTheBridge(3650);
    assert.ok(g.conLines.length <= Game.MAX_CON_LINES,
      `the watch officer is holding ${g.conLines.length} lines to read out`);
  });

  test('so the record does not grow without bound behind the captain', () => {
    const short = JSON.stringify(awayFromTheBridge(10).save()).length;
    const long = JSON.stringify(awayFromTheBridge(3650).save()).length;
    assert.ok(long < short * 4,
      `the save went from ${(short / 1024).toFixed(0)}KB to ${(long / 1024).toFixed(0)}KB `
      + 'over one commission spent off the bridge');
    assert.ok(long < 60 * 1024, `${(long / 1024).toFixed(0)}KB of save after five years`);
  });

  test('and what it could not keep is said, not silently dropped', () => {
    const g = awayFromTheBridge(3650);
    g.walk.roomId = 'bridge';
    const { lines } = g.takeCon();
    assert.ok(lines.length <= Game.MAX_CON_LINES + 3,
      `the handback was ${lines.length} lines long`);
    assert.ok(lines.some((l) => /earlier/i.test(l)),
      'thousands of entries were dropped and the report does not mention them');
  });

  test('but a short watch reports everything, and says nothing about earlier ones', () => {
    // Must not misfire: the ordinary case is a captain who stepped out for an
    // afternoon, and every line of that belongs in the handover.
    const g = awayFromTheBridge(3);
    const held = g.conLines.length;
    assert.ok(held > 0 && held < Game.MAX_CON_LINES, `held ${held} lines after three absences`);
    g.walk.roomId = 'bridge';
    const { lines } = g.takeCon();
    assert.ok(lines.length >= held, 'a short watch dropped part of its own report');
    assert.ok(!lines.some((l) => /earlier/i.test(l)),
      'a short watch claimed there were earlier entries it could not keep');
  });

  test('and taking the con still empties it', () => {
    const g = awayFromTheBridge(3650);
    g.walk.roomId = 'bridge';
    g.takeCon();
    assert.equal(g.conLines.length, 0, 'the con was taken back and the watch is still holding lines');
    const after = JSON.stringify(g.save()).length;
    assert.ok(after < 30 * 1024, `${(after / 1024).toFixed(0)}KB of save after the report was given`);
  });
});

// ================================ an after-action report for a ship you have

describe('the last battle is reported against the ship that fought it', () => {
  // `lastCombat` survives the engagement on purpose — "anything that wanted to
  // know how the last battle went had to read a live engagement before it was
  // cleared, which is a race dressed up as an API". It also survives the SHIP.
  //
  // Starfleet gives you a different hull twice: when you lose one, and when you
  // take a command offer. Both go through `takeCommandOf`, and neither touches
  // the report. So a costly battle in a Galaxy, followed by the loss of that
  // Galaxy, leaves the after-action report saying:
  //
  //   the last battle is recorded as costing 811 of a crew of 750
  //
  // More people than the new ship carries. `checkGame` already calls that
  // illegal, with a comment saying "a count larger than the crew is not a number
  // anybody should be shown" — and the number the panel shows is exactly this
  // one, next to a hull percentage read from the ship the captain is on NOW
  // rather than the one the battle was fought in.
  //
  // The record already carries `hullLeft`. It did not carry the complement, so
  // there was nothing to check the casualties against except a ship that had
  // changed underneath them.

  /** A costly battle, and then Starfleet hands over a smaller hull. */
  const foughtThenReassigned = (seed = 3n) => {
    const g = new Game({ seed, shipClass: 'galaxy' });
    const flew = g.ship.classId;
    const complement = g.ship.maxCrew;
    g.startCombat([new Ship('d7', { name: 'IKS Something', faction: 'klingon' })]);
    g.ship.crew = Math.round(g.ship.maxCrew * 0.2);
    g.engagement.end('victory');
    for (let i = 0; i < 120; i++) g.update(STEP);
    return { g, flew, complement };
  };

  test('a costly battle really is recorded as costly', () => {
    // The positive case: if the casualties stop being recorded there is nothing
    // here to be wrong about.
    const { g, complement } = foughtThenReassigned();
    assert.ok(g.lastCombat, 'no after-action report at all');
    assert.ok(g.lastCombat.crewLost > complement * 0.5,
      `the battle cost ${g.lastCombat.crewLost} of ${complement}, which is not a costly battle`);
    assert.deepEqual(checkAll(g, { arenaRadius: ARENA_RADIUS })
      .filter((v) => v.code === 'game.lastCombat.crew'), [],
    'the report was already illegal before the ship changed');
  });

  test('and it stays a legal number when the ship changes underneath it', () => {
    const { g, flew } = foughtThenReassigned();
    g.shipsLost = 0;
    g.ship.hull = 0;
    g.ship.destroyed = true;
    g.loseTheShip();
    assert.notEqual(g.ship.classId, flew, 'the ship did not change, so this proves nothing');
    assert.deepEqual(checkAll(g, { arenaRadius: ARENA_RADIUS })
      .filter((v) => v.code === 'game.lastCombat.crew').map((v) => v.text), [],
    'the last battle is reported against a ship that did not fight it');
  });

  test('and it says which ship fought it, and what she carried', () => {
    // What makes the number checkable at all. Without the complement there is
    // nothing to compare the casualties against except whatever hull the captain
    // happens to be standing on.
    const { g, flew, complement } = foughtThenReassigned();
    assert.equal(g.lastCombat.complement, complement,
      'the report does not say how many people were aboard');
    assert.ok(g.lastCombat.shipName, 'the report does not say which ship fought');
    assert.ok(g.lastCombat.crewLost <= g.lastCombat.complement,
      `${g.lastCombat.crewLost} lost of a complement of ${g.lastCombat.complement}`);
  });

  test('and it survives a reload still saying so', () => {
    const { g, complement } = foughtThenReassigned();
    const back = Game.load(JSON.parse(JSON.stringify(g.save())));
    assert.equal(back.lastCombat?.complement, complement,
      'the complement did not survive a save');
    assert.deepEqual(checkAll(back, { arenaRadius: ARENA_RADIUS })
      .filter((v) => v.code === 'game.lastCombat.crew'), []);
  });

  test('but an ordinary battle on the ship that fought it is unchanged', () => {
    // Must not misfire: the common case is one ship, one fight, one report.
    const { g, complement } = foughtThenReassigned();
    assert.equal(g.ship.maxCrew, complement, 'the ship changed and it should not have');
    assert.ok(g.lastCombat.crewLost > 0 && g.lastCombat.crewLost <= complement);
    assert.deepEqual(checkAll(g, { arenaRadius: ARENA_RADIUS }), []);
  });
});

// ========================================= an encounter you fly away from

describe('an encounter is over when the ship leaves', () => {
  // `setCourse` clears the orbit and lays in the course. It did not clear the
  // ENCOUNTER, and `arrive` only overwrites one — and only when the arrival roll
  // produces something that is not quiet, which most of the time it does not.
  // So whatever was on the viewer when the captain said "set course for Sol"
  // was still live, in a system the ship was no longer anywhere near.
  //
  // Measured over 60 single hops: 39 arrivals produced an encounter, and 15 of
  // those were still live after flying away.
  //
  //   seed 1   anomaly at alpha_centauri -> ship at sol
  //   seed 13  trapped at utopia         -> ship at sol
  //
  // The checker already calls this illegal — `game.encounter.elsewhere` in
  // src/sim/invariants.js — and its comment describes the consequence. Nothing
  // had ever flown away from an encounter to trip it, because until this suite
  // nothing flew anywhere with something on the viewer.
  //
  // It is reachable from the order line. `App.executeOrder` intercepts only the
  // orders an encounter itself offers — `encounter_choice`, `warp_out`, `fire`,
  // `scan`, `hail` — so "helm, set course for Sol" falls straight through to the
  // course arm with a derelict still on screen.

  /** Fly one hop and stop wherever something is waiting. */
  const flyUntilSomethingIsWaiting = (seed) => {
    const g = new Game({ seed: BigInt(seed), compression: HOUR_PER_TICK });
    g.ship.antimatter = g.ship.maxAntimatter;
    const near = g.galaxy.neighbors(g.locationId);
    const to = near[seed % near.length];
    if (!g.setCourse(to.id).ok) return null;
    for (let i = 0; i < 30 * 3000 && g.transit; i++) g.update(STEP);
    return g.encounter ? g : null;
  };

  test('flying a leg really does turn something up', () => {
    // The positive case. If arrivals stop producing encounters this suite is
    // testing an empty room and should say so.
    let found = 0;
    for (let s = 1; s <= 60; s++) if (flyUntilSomethingIsWaiting(s)) found++;
    assert.ok(found >= 10, `only ${found} of 60 legs had anything waiting at the far end`);
  });

  test('and leaving it behind does not leave it live', () => {
    const stale = [];
    for (let s = 1; s <= 60; s++) {
      const g = flyUntilSomethingIsWaiting(s);
      if (!g) continue;
      const kind = g.encounter.kind;
      const left = g.locationId;
      g.ship.antimatter = g.ship.maxAntimatter;
      const on = g.galaxy.neighbors(g.locationId)[0];
      if (!g.setCourse(on.id).ok) continue;
      for (let i = 0; i < 30 * 3000 && g.transit; i++) g.update(STEP);
      const broke = checkAll(g, { arenaRadius: ARENA_RADIUS })
        .filter((v) => v.code === 'game.encounter.elsewhere');
      if (broke.length) stale.push(`seed ${s}: ${kind} left at ${left}, ship at ${g.locationId}`);
    }
    assert.deepEqual(stale.slice(0, 6), [],
      `${stale.length} encounters were still live in a system the ship had left`);
  });

  test('and the alert it raised stands down with it', () => {
    // Flying away IS withdrawing, so it must go through the same door: the
    // alert stands down and `encounter:end` is emitted. A bare `encounter =
    // null` would clear the state and leave the ship at yellow for the rest of
    // the commission with nothing to be at yellow about.
    let checked = 0;
    for (let s = 1; s <= 60 && checked < 3; s++) {
      const g = flyUntilSomethingIsWaiting(s);
      if (!g || g.alert === 'normal' || g.alert === 'red') continue;
      checked++;
      g.ship.antimatter = g.ship.maxAntimatter;
      const on = g.galaxy.neighbors(g.locationId)[0];
      if (!g.setCourse(on.id).ok) { checked--; continue; }
      assert.equal(g.encounter, null, 'the course was laid in and the encounter is still there');
      assert.equal(g.alert, 'normal',
        `left an encounter behind and the ship is still at ${g.alert}`);
    }
    assert.ok(checked >= 1, 'no encounter in 60 legs ever raised an alert to stand down');
  });

  test('but a course that is refused leaves the encounter alone', () => {
    // Must not misfire. A course the helm rejects is not a departure, and the
    // thing on the viewer is still in front of the ship.
    let checked = 0;
    for (let s = 1; s <= 60 && checked < 3; s++) {
      const g = flyUntilSomethingIsWaiting(s);
      if (!g) continue;
      g.ship.antimatter = 0;                       // nothing is affordable
      const on = g.galaxy.neighbors(g.locationId)[0];
      const r = g.setCourse(on.id);
      if (r.ok) continue;                          // it went anyway; not this case
      checked++;
      assert.ok(g.encounter, 'a refused course threw away the encounter anyway');
    }
    assert.ok(checked >= 1, 'no course was ever refused, so this proves nothing');
  });
});

// ================================= a hulk you left is lost however you left

describe('a wreck is lost when the ship leaves, whichever way it leaves', () => {
  // `arrive` has this clause and says exactly why: "`finishCombat` describes the
  // salvage as a choice — strip it, or leave the system and lose it — and
  // leaving did not lose it… A wreck could be banked for the whole five years
  // and cashed in whenever the machine shop ran dry, which is not a choice at
  // all."
  //
  // `dropOutOfWarp` sets `locationId`, `transit`, `orbit` and `mode`, and does
  // not have that clause. So the choice is not a choice: break off the course
  // instead of completing it and the hulk is banked anyway.
  //
  //   positive case      -> outcome: victory | wreck: sol
  //   arrived at vulcan  -> wreck: (gone, as arrive intends)
  //   dropped out vulcan -> wreck: sol            <- still held
  //
  // Two paths reach the same state — the ship is in a different system from the
  // hulk — and only one of them applied the rule. Same shape as the border
  // check, which had the same problem on the same two paths.

  /** A fight that actually leaves a hulk behind. */
  const aWreckAtSol = (seed = 4n) => {
    const g = new Game({ seed, compression: HOUR_PER_TICK });
    g.ship.antimatter = g.ship.maxAntimatter;
    // `relentless`, because an ordinary hostile breaks off before it dies and
    // a routed ship leaves nothing. Without this the probe measures an empty
    // system and every assertion below passes for the wrong reason.
    g.startCombat([new Ship('d7', { name: 'IKS Something', faction: 'klingon' })], { relentless: true });
    for (const h of g.engagement.hostiles) { h.hull = 1; h.destroyed = false; }
    for (let i = 0; i < 30 * 600 && g.engagement && !g.engagement.over; i++) g.update(STEP);
    for (let i = 0; i < 200; i++) g.update(STEP);
    return g;
  };

  test('a fight really does leave a hulk', () => {
    // The positive case, and it needed `relentless` to exist at all.
    const g = aWreckAtSol();
    assert.equal(g.lastCombat?.outcome, 'victory', 'nothing was destroyed, so there is no hulk');
    assert.ok(g.wreck, 'the fight left no wreck to lose');
    assert.equal(g.wreck.systemId, g.locationId);
  });

  test('and flying the course to its end loses it', () => {
    // The rule as `arrive` already applies it — the baseline the other path
    // must agree with.
    const g = aWreckAtSol();
    g.ship.antimatter = g.ship.maxAntimatter;
    assert.ok(g.setCourse(g.galaxy.neighbors(g.locationId)[0].id).ok);
    for (let i = 0; i < 30 * 3000 && g.transit; i++) g.update(STEP);
    assert.equal(g.wreck, null, 'arriving somewhere else kept the hulk');
  });

  test('and so does breaking the course off part way', () => {
    const g = aWreckAtSol();
    const left = g.locationId;
    g.ship.antimatter = g.ship.maxAntimatter;
    assert.ok(g.setCourse(g.galaxy.neighbors(g.locationId)[0].id).ok);
    while (g.transit && g.transit.progress < 0.9) g.update(STEP);
    assert.ok(g.transit, 'the course finished before it could be broken off');
    assert.ok(g.dropOutOfWarp().ok, 'the order to break off was refused');
    assert.notEqual(g.locationId, left, 'coasted back to where it started; this proves nothing');
    assert.equal(g.wreck, null,
      `broke off a course and the hulk is still banked at ${g.wreck?.systemId}`);
  });

  test('but a hulk in the system the ship is in is still there', () => {
    // Must not misfire. The whole point of a wreck is that you can strip it
    // while you are standing over it.
    const g = aWreckAtSol();
    for (let i = 0; i < 600; i++) g.update(STEP);
    assert.ok(g.wreck, 'the hulk vanished without the ship going anywhere');
    assert.ok(g.wreckHere, 'the hulk is here and the ship cannot see it');
  });
});

// ============================== an episode's fight survives the app closing

describe("an episode's ordered fight is still ordered after a reload", () => {
  // `chooseMission` does two things when a stage orders a battle: it sets
  // `game.pendingCombat` with the ships, and it marks `mission.pending` with the
  // reward being held for it. `update` starts the fight on the next tick.
  //
  // `pendingCombat` appears in the constructor, the setter and the consumer —
  // and NOWHERE in `save()` or `load()`. `Mission.save` carries `pending`, and
  // `MissionBook.load` restores it deliberately: "Dropping it on load would
  // strand the episode on a stage it can never leave."
  //
  // So a save taken in that one-tick window keeps the half that waits and drops
  // the half that arrives. All seven episodes that queue a fight:
  //
  //   vega_raid … the_cube:  clean before save
  //                          after reload + 300 ticks: mission.awaiting-ghost
  //                          mission complete: false
  //
  // Not a hard lock — choosing the stage again re-queues it — but the reward
  // held for the first fight is never paid, and the ship's log fills with
  // "Computer: internal anomaly [mission.awaiting-ghost]" on a sampled tick
  // forever. The window is one tick, and the browser saves on
  // `visibilitychange`: backgrounding the app the instant you order the attack
  // is exactly how a player reaches it.

  /** Walk an episode to the stage that orders a fight, and order it. */
  const orderedTheFight = (def, seed = 5n) => {
    const g = new Game({ seed });
    const m = g.missions.start(def.id, g);
    if (!m) return null;
    for (let i = 0; i < 40; i++) {
      if (m.complete) return null;
      const need = m.stageLocation?.(m.stage);
      if (need) g.locationId = need;
      const open = m.choices().filter((c) => !c.locked);
      if (!open.length) return null;
      if (open[0].effects?.combat) {
        if (!g.chooseMission(open[0].id)) return null;
        return g.pendingCombat ? g : null;
      }
      if (!g.chooseMission(open[0].id)) return null;
    }
    return null;
  };

  const withFights = EPISODES.map((d) => [d, orderedTheFight(d)]).filter(([, g]) => g);

  test('episodes really do order fights', () => {
    // The positive case. If stages stop queueing combat this suite is about
    // nothing.
    assert.ok(withFights.length >= 5,
      `only ${withFights.length} episodes reached a stage that orders a fight`);
    for (const [def, g] of withFights) {
      assert.ok(g.pendingCombat, `${def.id} marked the episode without queueing the ships`);
      assert.ok(g.missions.active.pending, `${def.id} queued ships without marking the episode`);
      assert.deepEqual(checkAll(g, { arenaRadius: ARENA_RADIUS }), [],
        `${def.id} was already broken before anything was saved`);
    }
  });

  test('and the ships are still coming after the app is closed and reopened', () => {
    for (const [def] of withFights) {
      const g = orderedTheFight(def);
      if (!g) continue;
      const back = Game.load(JSON.parse(JSON.stringify(g.save())));
      // The tick that would have started it.
      for (let i = 0; i < 300; i++) back.update(STEP);
      assert.deepEqual(checkAll(back, { arenaRadius: ARENA_RADIUS })
        .filter((v) => v.code === 'mission.awaiting-ghost').map((v) => v.text), [],
      `${def.id} is waiting on a battle that is never coming`);
    }
  });

  test('and flying it wins the episode the stage was about', () => {
    // The consequence, not just the invariant: the held reward is paid and the
    // episode moves on. This is what the captain lost.
    let settled = 0;
    for (const [def] of withFights) {
      const g = orderedTheFight(def);
      if (!g) continue;
      const back = Game.load(JSON.parse(JSON.stringify(g.save())));
      for (let i = 0; i < 10 && !back.engagement; i++) back.update(STEP);
      if (!back.engagement) continue;
      for (const h of back.engagement.hostiles) { h.hull = 1; h.destroyed = false; }
      for (let i = 0; i < 30 * 600 && back.engagement && !back.engagement.over; i++) back.update(STEP);
      for (let i = 0; i < 120; i++) back.update(STEP);
      assert.equal(back.missions.active?.pending ?? null, null,
        `${def.id} fought its fight and is still waiting on one`);
      settled++;
    }
    assert.ok(settled >= 5, `only ${settled} episodes could fight the fight they had ordered`);
  });

  test('but an episode with no fight ordered queues nothing on load', () => {
    // Must not misfire: most saves are not taken in that one-tick window, and a
    // reload must not conjure a battle nobody asked for.
    const g = new Game({ seed: 5n });
    const m = g.missions.start('shakedown', g);
    assert.ok(m, 'the shakedown is no longer startable');
    const back = Game.load(JSON.parse(JSON.stringify(g.save())));
    for (let i = 0; i < 300; i++) back.update(STEP);
    assert.equal(back.pendingCombat, null, 'a reload queued a fight out of nothing');
    assert.equal(back.engagement, null, 'a reload started a fight out of nothing');
    assert.deepEqual(checkAll(back, { arenaRadius: ARENA_RADIUS }), []);
  });
});

// ============================== a change of ship is a change of ship

describe('the mastery track follows the captain, not the hull', () => {
  // `takeCommandOf` carries the rule in a comment — "The track follows the
  // captain, not the hull: the points already earned in other classes stay in
  // the map and are waiting if he ever flies one again" — and its neighbour
  // `yardReport` says it is "shared by all three ways a captain ends up in a
  // different hull: promotion, a board of inquiry, and the change-of-command
  // screen".
  //
  // The change-of-command screen was the one that was not. `App.changeShip`
  // built its own `new Ship(...)`, refitted the loadout and applied the mods,
  // and never touched `mastery.classId`. Measured on a Constitution worked up
  // to tier five and swapped for an Excelsior:
  //
  //   changeShip     flying excelsior | track: constitution | tier 5
  //   takeCommandOf  flying excelsior | track: excelsior    | tier 0
  //
  // Five tiers of bonuses on a hull nobody had ever flown, and six systems have
  // a shipyard — one of them Sol, so it is a button a captain can press on the
  // first day.

  const workedUp = (classId = 'constitution') => {
    const g = new Game({ seed: 2n, shipClass: classId });
    g.mastery.points[g.ship.classId] = 100000;
    return g;
  };

  test('a ship really can be worked up, and the tier means something', () => {
    // The positive case. If mastery stops accumulating there is no bonus to
    // carry anywhere and the rest of this proves nothing.
    const g = workedUp();
    assert.equal(g.mastery.classId, 'constitution');
    assert.ok(g.mastery.tier >= 4, `a fully worked-up hull is only tier ${g.mastery.tier}`);
  });

  test('and a new hull starts unlearned, however the captain got into it', () => {
    const g = workedUp();
    const before = g.mastery.tier;
    const took = takeCommandOf(g, 'excelsior');
    assert.ok(took.ok, took.reason);
    assert.equal(g.ship.classId, 'excelsior');
    assert.equal(g.mastery.classId, 'excelsior',
      'the mastery track is still pointed at the ship the captain no longer flies');
    assert.ok(g.mastery.tier < before,
      `carried tier ${g.mastery.tier} onto a hull nobody has flown`);
  });

  test('and the yard keeps her name and her number', () => {
    // What the shipyard needs from the shared path, and the reason it had its
    // own copy: a refit is the same ship coming out of dock as a different
    // class, not a new command. Promotion and a board of inquiry pass neither
    // and get a fresh hull with a fresh name, which is what those are.
    const g = workedUp();
    // A number that is NOT the default a fresh hull would be given. The first
    // version of this assertion passed without the fix, because a starting
    // Constitution carries NCC-1701 and so does every new Federation hull — so
    // it was comparing a value against itself and proving nothing.
    g.ship.registry = 'NCC-1764';
    const name = g.ship.name;
    const registry = g.ship.registry;
    assert.notEqual(registry, new Game({ seed: 1n }).ship.registry,
      'the probe is using the default registry again and cannot see a change');
    assert.ok(takeCommandOf(g, 'excelsior', { name, registry }).ok);
    assert.equal(g.ship.name, name, 'the yard renamed her');
    assert.equal(g.ship.registry, registry, 'the yard changed her number');
    assert.equal(g.mastery.classId, 'excelsior', 'keeping the name kept the old mastery');
  });

  test('and the points already earned are still waiting', () => {
    // The other half of the rule: the track follows the captain, so going back
    // to a class he has flown finds it as he left it.
    const g = workedUp();
    const earned = g.mastery.tier;
    takeCommandOf(g, 'excelsior');
    assert.ok(g.mastery.tier < earned);
    takeCommandOf(g, 'constitution');
    assert.equal(g.mastery.classId, 'constitution');
    assert.equal(g.mastery.tier, earned, 'the work put into the old hull was thrown away');
  });
});
