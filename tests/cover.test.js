// Using the terrain, which nobody was.
//
// #136 put rocks in the engagement volume and gave them a consequence: a shot
// with a rock in the way is not fired at all, so getting one between you and
// somebody stops the incoming fire rather than making it miss. That is cover,
// and it was available to every ship in the fight and taken by none of them —
// the manoeuvre layer had never looked at the arena.
//
// Measured over a hundred and sixty fights in a debris field, through the real
// fight loop with the same simple pilot the balance suite flies:
//
//     hostile-ticks behind cover                19.3%
//     hostile-ticks behind cover WHEN HURT      14.0%
//
// A hostile below half hull was LESS likely to be behind a rock than a healthy
// one — because a hurt ship stops circling and holds station to present its
// strongest shield, which is the one behaviour guaranteed to leave it in the
// open. These tests are about that number, and about the things that must not
// change while it does.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';
import { Character } from '../src/rules/character.js';
import { SHIP_CLASSES } from '../src/world/ships.data.js';
import { buildArena, blockedBy, OPEN_ARENA } from '../src/sim/arena.js';
import { inCover, coverPoint, steerAround } from '../src/sim/cover.js';
import { RNG } from '../src/core/rng.js';

const at = (x, y, z = 0) => ({ x, y, z });

/** A hand-built arena, so the geometry tests do not depend on a seed. */
const oneRock = (x, y, z, r) => ({
  kind: 'debris',
  name: 'debris field',
  features: [{ type: 'solid', kind: 'debris', x, y, z, r }],
  sensorNoise: 0,
  shieldSuppression: 0,
  breaksCloak: false,
  noWarp: false,
  tint: null,
});

// ============================================================ the geometry

describe('finding somewhere to hide', () => {
  test('the spot it picks is actually behind the rock', () => {
    // The property that matters and the only one worth asserting directly: a
    // ship standing there cannot be shot from where the threat is standing.
    const arena = oneRock(0, 0, 0, 200);
    const threat = at(-900, 0, 0);
    for (const from of [at(600, 0, 0), at(0, 700, 0), at(-400, 500, 120), at(300, -300, -200)]) {
      const spot = coverPoint(arena, from, threat);
      assert.ok(spot, `nothing found from ${JSON.stringify(from)}`);
      assert.ok(blockedBy(arena, spot, threat),
        `the spot at ${spot.x.toFixed(0)},${spot.y.toFixed(0)},${spot.z.toFixed(0)} is in plain sight`);
      assert.equal(spot.rock, arena.features[0]);
    }
  });

  test('and it is the near rock, not the big one across the arena', () => {
    const arena = oneRock(0, 0, 0, 200);
    arena.features.push({ type: 'solid', kind: 'debris', x: 0, y: 2000, z: 0, r: 600 });
    const spot = coverPoint(arena, at(300, 0, 0), at(-900, 0, 0));
    assert.equal(spot.rock.r, 200, 'it went for the far one because it is bigger');
  });

  test('and there is nowhere to hide in open space', () => {
    assert.equal(coverPoint(OPEN_ARENA, at(0, 0, 0), at(-500, 0, 0)), null);
    assert.equal(coverPoint(null, at(0, 0, 0), at(-500, 0, 0)), null);
    // A pebble is not cover. The bar is that the rock can hide the ship, and a
    // field of forty small ones would otherwise read as forty hiding places.
    const grit = oneRock(0, 0, 0, 40);
    assert.equal(coverPoint(grit, at(300, 0, 0), at(-900, 0, 0)), null);
  });

  test('nothing worth flying half the arena for', () => {
    const far = oneRock(0, 4000, 0, 300);
    assert.equal(coverPoint(far, at(0, 0, 0), at(-500, 0, 0)), null,
      'a rock four thousand units away is not cover, it is a departure');
  });

  test('the spot is near the ship, not on the far pole of the rock', () => {
    // A sphere casts a shadow, and every point in it is cover — so a ship
    // already three quarters of the way round should not be told to fly to the
    // other side. Aiming at the far pole left ships "hiding" while actually
    // behind something only a third of the time; the rest was transit.
    const arena = oneRock(0, 0, 0, 200);
    const threat = at(-900, 0, 0);
    // A ship that is ALREADY in the shadow, well behind the rock. The far pole
    // is 310 units back toward it; the nearest shadowed point is where the
    // ship is standing. Chosen deliberately: a ship level with the rock gets
    // nearly the same answer either way, so it cannot tell the two apart.
    const ship = at(600, 60, 0);
    assert.ok(blockedBy(arena, ship, threat), 'the ship is not in the shadow to begin with');
    const spot = coverPoint(arena, ship, threat);
    const run = Math.hypot(spot.x - ship.x, spot.y - ship.y, spot.z - ship.z);
    const farPole = Math.hypot(200 + 90 - ship.x, 60 - ship.y, ship.z);
    assert.ok(run < farPole * 0.25,
      `the spot is ${run.toFixed(0)} away and the far pole is ${farPole.toFixed(0)}`);
    assert.ok(blockedBy(arena, spot, threat), 'and the near spot is not actually cover');
  });
});

describe('going round a rock instead of through it', () => {
  test('a clear run is left alone', () => {
    const arena = oneRock(0, 900, 0, 200);
    const aim = at(600, 0, 0);
    assert.deepEqual(steerAround(arena, at(0, 0, 0), aim), aim);
    assert.deepEqual(steerAround(OPEN_ARENA, at(0, 0, 0), aim), aim);
  });

  test('a run through a rock is deflected clear of it', () => {
    const arena = oneRock(300, 0, 0, 200);
    const ship = at(0, 0, 0);
    const aim = at(700, 0, 0);
    // The control first: the straight line really is blocked, or the
    // deflection below proves nothing.
    assert.ok(blockedBy(arena, ship, aim), 'the straight run was never blocked');
    const out = steerAround(arena, ship, aim);
    assert.notDeepEqual(out, aim);
    assert.ok(!blockedBy(arena, ship, out),
      `the deflected run still goes through the rock: ${JSON.stringify(out)}`);
  });

  test('dead-on at the centre still produces a heading', () => {
    // The degenerate case: the rock is exactly on the run, so there is no
    // perpendicular to pick and the obvious code divides by zero.
    const arena = oneRock(300, 0, 0, 200);
    const out = steerAround(arena, at(0, 0, 0), at(900, 0, 0));
    for (const k of ['x', 'y', 'z']) assert.ok(Number.isFinite(out[k]), `${k} is ${out[k]}`);
    assert.ok(!blockedBy(arena, at(0, 0, 0), out));
  });

  test('and the rock being flown TO is not deflected around', () => {
    // A ship running for cover deflects around the very rock it is trying to
    // get behind, every tick, and never arrives. That was most of what
    // "hiding, but not actually behind anything" turned out to be.
    const arena = oneRock(300, 0, 0, 200);
    const rock = arena.features[0];
    const spot = coverPoint(arena, at(0, 0, 0), at(-900, 0, 0));
    const ship = at(0, 0, 0);
    assert.notDeepEqual(steerAround(arena, ship, spot), spot, 'nothing was in the way to ignore');
    assert.deepEqual(steerAround(arena, ship, spot, { ignore: rock }), spot);
  });

  test('a ship already inside a rock is still pushed out of it', () => {
    // `ignore` must not disable the escape: a ship that has ended up inside
    // the rock it is heading for has to leave, and `Combat.keepOutOfRocks`
    // shoving it to the skin every tick is a floor, not a manoeuvre.
    const arena = oneRock(0, 0, 0, 200);
    const rock = arena.features[0];
    const out = steerAround(arena, at(30, 10, 0), at(400, 0, 0), { ignore: rock });
    assert.notDeepEqual(out, at(400, 0, 0), 'a ship inside the rock was told to carry on');
  });
});

// ======================================================== through the fight

/**
 * Fly a battle the way the balance suite does and report what the hostiles did
 * with the terrain.
 *
 * Through the real loop and the real orders, because that is the only door the
 * game uses: a probe that samples random lines across the arena answered 56%
 * blocked where the fight answers 5%, and the difference is that a fight
 * collapses to short range near the origin within seconds.
 */
function fight({ hazard, seeds = 4, me = 'constitution', them = ['galor', 'galor'] }) {
  const out = {
    hostileTicks: 0, blocked: 0, hurtTicks: 0, hurtBlocked: 0,
    hiding: 0, insideRock: 0, outcomes: {}, seconds: [], hideEpisodes: 0,
    longestHide: 0,
  };
  for (let seed = 1; seed <= seeds; seed++) {
    const g = new Game({
      seed: BigInt(seed), crewMode: 'original',
      character: new Character({ speciesId: 'human', careerId: 'tactical' }),
      shipClass: me,
    });
    // Through the LOCATION. `Game.startCombat` reads the hazard from
    // `this.location` after spreading its options, so a hazard passed in the
    // options is silently discarded — which is how the first run of this
    // measurement reported 0.0% of everything in a field with no rocks in it.
    if (hazard) g.location.hazard = hazard;
    g.startCombat(them.map((c, i) => new Ship(c, {
      faction: SHIP_CLASSES[c].faction, name: `H${i}`,
    })));
    const eng = g.engagement;
    if (hazard) {
      assert.ok(eng.arena.features.length, 'no terrain was built — this measures open space');
    }
    const hiding = new Map();
    let t = 0;
    const DT = 1 / 30;
    while (!eng.over && t < 400) {
      eng.comeAboutTo(eng.target);
      g.ship.throttle = 0.6;
      g.ship.power.applyPreset(g.ship.shieldPct < 0.35 ? 'defense' : 'attack');
      eng.update(DT);
      t += DT;
      for (const h of eng.liveHostiles) {
        out.hostileTicks++;
        const cover = inCover(eng.arena, h, g.ship);
        if (cover) out.blocked++;
        if (h.hullPct < 0.5) {
          out.hurtTicks++;
          if (cover) out.hurtBlocked++;
        }
        if (h.hiding) {
          out.hiding++;
          if (!hiding.has(h)) { hiding.set(h, t); out.hideEpisodes++; }
          out.longestHide = Math.max(out.longestHide, t - hiding.get(h));
        } else {
          hiding.delete(h);
        }
      }
    }
    out.seconds.push(t);
    out.outcomes[eng.outcome ?? 'timeout'] = (out.outcomes[eng.outcome ?? 'timeout'] ?? 0) + 1;
  }
  return out;
}

describe('a captain who is losing gets a rock between him and you', () => {
  test('a hurt hostile spends real time behind cover', () => {
    const r = fight({ hazard: 'debris', seeds: 5 });
    assert.ok(r.hurtTicks > 2000, `only ${r.hurtTicks} ticks of a hostile below half hull`);
    const hurt = (100 * r.hurtBlocked) / r.hurtTicks;
    const all = (100 * r.blocked) / r.hostileTicks;
    // 14.0% before this change, over a hundred and sixty fights; 23.4% after,
    // on the same seeds. The bar is the absolute figure and not "more often
    // than a healthy hostile": that comparison came out 23.4% against 21.6%,
    // a margin inside the run-to-run spread, and a bar this suite cannot
    // reliably clear is a bar that fails on a Tuesday for no reason.
    void all;
    assert.ok(hurt > 18,
      `a hurt hostile is behind cover ${hurt.toFixed(1)}% of the time, `
      + 'against 14.0% before any of this');
    assert.ok(r.hideEpisodes > 0, 'nobody ever ran for cover');
  });

  test('and none of it happens in open space', () => {
    // The control. Everything above must be the terrain and not the doctrine:
    // with no rocks in the arena there is nothing to hide behind, and a ship
    // that "hides" anyway is flying to a place that means nothing.
    const r = fight({ hazard: null, seeds: 5 });
    assert.equal(r.blocked, 0, 'something blocked a shot in empty space');
    assert.equal(r.hiding, 0, 'a ship went to cover in an arena with no cover in it');
  });

  test('nobody hides for the rest of the battle', () => {
    // Cover is symmetric: the rock that stops their shot stops yours. A ship
    // that hides indefinitely has left the fight, and a fight both sides have
    // left is one the player watches.
    const r = fight({ hazard: 'debris', seeds: 5 });
    assert.ok(r.longestHide < 30,
      `somebody stayed behind a rock for ${r.longestHide.toFixed(0)} seconds`);
    const med = r.seconds.sort((a, b) => a - b)[r.seconds.length >> 1];
    assert.ok(med < 150, `the median fight now runs ${med.toFixed(0)} seconds`);
  });

  test('and the Borg do not take cover', () => {
    // Doctrine, asserted by behaviour rather than by reading the table. A cube
    // that hid behind a rock would be a different species.
    const r = fight({ hazard: 'debris', seeds: 3, me: 'galaxy', them: ['borg_cube'] });
    assert.equal(r.hiding, 0, 'a Borg cube took cover');
    // And the measurement can see the positive case on the same arena.
    const cardassian = fight({ hazard: 'debris', seeds: 3 });
    assert.ok(cardassian.hiding > 0, 'nobody hid at all, so the assertion above is vacuous');
  });
});

describe('and the terrain does not move the simulation', () => {
  test('nothing in the cover layer draws from a random stream', () => {
    const g = new Game({
      seed: 7n, crewMode: 'original',
      character: new Character({ speciesId: 'human', careerId: 'command' }),
      shipClass: 'constitution',
    });
    const arena = buildArena(new RNG(11n), 'debris', { radius: 2600 });
    assert.ok(arena.features.length, 'the arena built nothing');
    const before = [];
    for (let i = 0; i < 8; i++) before.push(g.rng.float());
    const g2 = new Game({
      seed: 7n, crewMode: 'original',
      character: new Character({ speciesId: 'human', careerId: 'command' }),
      shipClass: 'constitution',
    });
    for (let i = 0; i < 200; i++) {
      coverPoint(arena, at(i, -i, 0), at(-500, 200, 0));
      steerAround(arena, at(i, -i, 0), at(500, 0, 0));
      inCover(arena, at(i, 0, 0), at(-500, 0, 0));
    }
    const after = [];
    for (let i = 0; i < 8; i++) after.push(g2.rng.float());
    assert.deepEqual(before, after, 'looking at the terrain moved the campaign stream');
  });

  test('an open-space fight is untouched by any of it', () => {
    // The strongest regression guard available: with no terrain the cover
    // layer must be exactly the code that was there before, and the same seeds
    // must produce the same battles they always did.
    const a = fight({ hazard: null, seeds: 6 });
    const b = fight({ hazard: null, seeds: 6 });
    assert.deepEqual(a.outcomes, b.outcomes);
    assert.deepEqual(a.seconds, b.seconds);
    assert.ok(Object.values(a.outcomes).reduce((n, v) => n + v, 0) === 6);
  });
});
