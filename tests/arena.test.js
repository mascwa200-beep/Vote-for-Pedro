// The terrain a fight is fought in.
//
// Written after the feature, and the feature had three bugs that only playing
// it found. Each of them has a test here and each of those tests has a control
// in the run that produced this file:
//
//   Features were scattered through the whole 2,600-unit arena. Over
//   ninety-six battles not one shot was ever blocked and no ship ever entered
//   a cloud, because a fight collapses to inside a thousand units in the first
//   few seconds and stays there.
//
//   The "never on top of a combatant" rule was applied to GAS as well as rock.
//   A plasma cloud is 780 units across and everybody starts within a thousand
//   units of the origin, so every placement attempt failed and two of the four
//   weather systems in the game came out as open space.
//
//   The blocked-shot rate was measured with random lines across the volume and
//   read 56%. Measured through `combat:fire` in real battles it was 5%. They
//   are not the same question and only one of them is the game.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { RNG, hashSeed } from '../src/core/rng.js';
import {
  ARENA_KINDS, OPEN_ARENA, OPEN_HAZARDS,
  buildArena, blockedBy, insideSolid, cloudAt, conditionsAt,
} from '../src/sim/arena.js';
import { ARENA_RADIUS } from '../src/sim/combat.js';
import { SYSTEMS } from '../src/world/systems.data.js';
import { Game } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';
import { Character } from '../src/rules/character.js';
import { on } from '../src/core/events.js';
import { checkCombat } from '../src/sim/invariants.js';

const stream = (tag = 'arena-test') => new RNG(hashSeed(tag));
const build = (hazard, tag = 'arena-test') => buildArena(stream(tag), hazard, {
  radius: ARENA_RADIUS, clear: [{ x: 0, y: 0, z: 0 }],
});

/** A fight, played by the same simple pilot the balance suite uses. */
function fight({ place, seed = 1, me = 'constitution', them = ['d7', 'd7'], cap = 400 }) {
  const g = new Game({
    seed: BigInt(seed), crewMode: 'original', shipClass: me,
    character: new Character({ speciesId: 'human', careerId: 'tactical' }),
  });
  g.locationId = place;
  g.startCombat(them.map((c, i) => new Ship(c, {
    faction: c.startsWith('jem') ? 'dominion' : c === 'galor' ? 'cardassian' : 'klingon',
    name: `H${i + 1}`,
  })));
  const eng = g.engagement;
  let t = 0;
  const violations = [];
  while (!eng.over && t < cap) {
    eng.comeAboutTo(eng.target);
    g.ship.throttle = 0.6;
    g.ship.power.applyPreset(g.ship.shieldPct < 0.35 ? 'defense' : 'attack');
    eng.update(1 / 30);
    t += 1 / 30;
    if (Math.round(t * 30) % 30 === 0) {
      violations.push(...checkCombat(eng, { arenaRadius: ARENA_RADIUS }));
    }
  }
  return { g, eng, seconds: t, violations };
}

describe('the place a fight happens in', () => {
  test('every hazard the world declares is either terrain or explicitly not', () => {
    // The whole point of the feature: the map has said these places are
    // different for as long as it has existed and combat read none of them.
    // A seventh hazard added to systems.data.js with no entry in either table
    // would silently fight in open space, which is the state this replaced.
    const declared = new Set(SYSTEMS.map((s) => s.hazard).filter(Boolean));
    assert.ok(declared.size >= 6, `only ${declared.size} hazards in the world data`);
    for (const h of declared) {
      assert.ok(ARENA_KINDS[h] || OPEN_HAZARDS[h],
        `system hazard '${h}' is neither terrain nor listed as deliberately not`);
    }
    // And the other way: terrain nothing in the world uses is dead code.
    for (const id of Object.keys(ARENA_KINDS)) {
      assert.ok(declared.has(id), `ARENA_KINDS.${id} is terrain no system ever has`);
    }
  });

  test('a system with no hazard fights in open space', () => {
    const open = build(null);
    assert.equal(open, OPEN_ARENA);
    assert.equal(open.features.length, 0);
    // And OPEN_ARENA is SHARED by every battle with no weather, so it must be
    // impossible to write to — the list as well as the object that holds it.
    // Shallow-frozen, this push succeeded, and the next fight at Sol had a
    // hundred and fifty malformed features in it.
    assert.throws(() => { OPEN_ARENA.features.push({}); }, TypeError);
    assert.throws(() => { OPEN_ARENA.kind = 'debris'; }, TypeError);
    assert.equal(OPEN_ARENA.features.length, 0);
  });

  test('the same fight in the same place gets the same rocks', () => {
    // Terrain is not serialised — a fight is never resumed from a save — so
    // the only thing that makes it stable across a reload is that it is a pure
    // function of the seed and the place.
    const a = build('debris');
    const b = build('debris');
    assert.deepEqual(a.features, b.features);
    assert.notDeepEqual(build('debris', 'other-seed').features, a.features);
  });

  test('every kind actually produces the features it claims', () => {
    // The bug this exists for: the Badlands and the Briar Patch were BUILT,
    // reported a kind and a name, and had zero features in them — every
    // placement attempt had failed the wrong constraint. Nothing said so.
    for (const [id, kind] of Object.entries(ARENA_KINDS)) {
      const a = build(id);
      assert.equal(a.kind, id);
      assert.ok(a.features.length > 0, `${id} built no features at all`);
      if (kind.solid) {
        assert.ok(a.features.some((f) => f.type === 'solid'), `${id} has no rock`);
      }
      if (kind.cloud) {
        assert.ok(a.features.some((f) => f.type === 'cloud'), `${id} has no gas`);
      }
      for (const f of a.features) {
        assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y) && Number.isFinite(f.z));
        assert.ok(f.r > 0, `${id} has a feature of radius ${f.r}`);
        assert.ok(Math.hypot(f.x, f.y, f.z) + f.r <= ARENA_RADIUS + 1,
          `${id} has a feature reaching outside the arena`);
      }
    }
  });

  test('rock keeps clear of where the ships start, and gas does not', () => {
    // Two opposite rules and the reason for both. A ship inside a rock cannot
    // be shot from any direction; a cloud with no ships in it is not weather.
    const rocks = build('debris').features.filter((f) => f.type === 'solid');
    assert.ok(rocks.length > 0);
    for (const f of rocks) {
      assert.ok(Math.hypot(f.x, f.y, f.z) > f.r,
        'a rock was placed on top of the player start');
    }
    // No two rocks are the same rock.
    for (const a of rocks) {
      for (const b of rocks) {
        if (a === b) continue;
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= a.r + b.r - 1e-6,
          'two rocks overlap');
      }
    }
    // And the gas covers where the fight is.
    for (const id of ['nebula', 'plasma_storm', 'metreon']) {
      const a = build(id);
      const r = new RNG(hashSeed('sample'));
      let inside = 0;
      for (let i = 0; i < 4000; i++) {
        const p = { x: r.range(-900, 900), y: r.range(-900, 900), z: r.range(-300, 300) };
        if (cloudAt(a, p) > 0) inside++;
      }
      assert.ok(inside / 4000 > 0.3,
        `${id} covers only ${Math.round(inside / 40)}% of the volume a fight happens in`);
    }
  });

  test('a shot is blocked by what is between, and not by what is behind', () => {
    // The clamp on the segment projection is the part that is easy to leave
    // out, and leaving it out blocks a shot fired AWAY from a rock.
    const rock = {
      kind: 'test', name: 'test', tint: null,
      features: [{ type: 'solid', kind: 'debris', x: 500, y: 0, z: 0, r: 100 }],
    };
    const origin = { x: 0, y: 0, z: 0 };
    assert.ok(blockedBy(rock, origin, { x: 1000, y: 0, z: 0 }), 'a rock dead ahead did not block');
    assert.equal(blockedBy(rock, origin, { x: -1000, y: 0, z: 0 }), null,
      'a rock BEHIND the shooter blocked a shot fired the other way');
    assert.equal(blockedBy(rock, origin, { x: 300, y: 0, z: 0 }), null,
      'a rock beyond the target blocked a shot that stops short of it');
    assert.equal(blockedBy(rock, origin, { x: 1000, y: 400, z: 0 }), null,
      'a rock 400 units off the line blocked a shot that misses it by 300');
    // Gas never blocks. It blinds, which is a different thing entirely.
    const gas = { features: [{ type: 'cloud', kind: 'nebula', x: 500, y: 0, z: 0, r: 400 }] };
    assert.equal(blockedBy(gas, origin, { x: 1000, y: 0, z: 0 }), null,
      'gas stopped a phaser');
    assert.equal(insideSolid(gas, { x: 500, y: 0, z: 0 }), null);
  });

  test('the gas is a gradient, not a wall you cross', () => {
    // A hard edge means a ship sitting on one has its shields flicker on and
    // off every tick.
    const a = build('nebula');
    const core = conditionsAt(a, { x: 0, y: 0, z: 0 });
    const rim = conditionsAt(a, { x: a.features[0].r * 0.92, y: 0, z: 0 });
    const outside = conditionsAt(a, { x: a.features[0].r * 1.2, y: 0, z: 0 });
    assert.equal(core.depth, 1);
    assert.ok(rim.depth > 0 && rim.depth < 1, `the rim reads ${rim.depth}`);
    assert.equal(outside.depth, 0);
    assert.ok(core.sensorNoise > rim.sensorNoise);
    assert.ok(core.breaksCloak, 'a nebula that does not break a cloak is not the Mutara Nebula');
    assert.equal(outside.breaksCloak, false);
    // And the kinds that have no such property do not acquire one.
    assert.equal(conditionsAt(build('metreon'), { x: 0, y: 0, z: 0 }).breaksCloak, false);
  });
});

describe('what terrain does to a battle', () => {
  test('a fight in a debris field has shots that never arrive', () => {
    // Counted through the event the game itself fires, not by sampling lines
    // through the volume — those two answers were 5% and 56% for the same
    // field, and only the first one is what a player experiences.
    const count = (place) => {
      let fired = 0;
      let blocked = 0;
      const off = on('combat:fire', (e) => {
        if (e.type === 'torpedo') return;
        fired++;
        if (e.result?.reason === 'blocked') blocked++;
      });
      try {
        for (let seed = 1; seed <= 4; seed++) fight({ place, seed });
      } finally { off?.(); }
      return { fired, blocked };
    };
    const rocks = count('wolf359');
    assert.ok(rocks.fired > 100, `only ${rocks.fired} shots fired`);
    assert.ok(rocks.blocked > 0, 'not one shot in four battles was blocked by the debris');
    // The control, and the whole claim: the same battle somewhere with no
    // terrain has none. Without this the assertion above passes on a build
    // where every shot everywhere is blocked.
    assert.equal(count('sol').blocked, 0, 'a shot was blocked in open space');
  });

  test('a nebula scrambles shields and sensors, and open space does not', () => {
    // "The nebula will scramble our shields and sensors." Both halves, and
    // both measured against the same fight fought at Sol.
    const at = (place) => {
      const { eng, seconds } = fight({ place, seed: 3 });
      return { seconds, shots: eng.shotsFired };
    };
    const open = at('sol');
    const murk = at('mutara');
    // Sensors: the same battle takes materially more shooting to settle,
    // because half of it misses.
    assert.ok(murk.shots > open.shots * 1.4,
      `${murk.shots} shots in the nebula against ${open.shots} at Sol`);
    assert.ok(murk.seconds > open.seconds * 1.4,
      `${murk.seconds.toFixed(0)}s in the nebula against ${open.seconds.toFixed(0)}s at Sol`);
  });

  test('a cloaked ship cannot hide in a nebula', () => {
    // The half of the Mutara rule that cuts in the player's favour, and the
    // reason a Constitution would ever choose to fight in one.
    // `cap: 0` so the battle has not been FOUGHT yet — the first version ran
    // the whole engagement first and then tried to cloak a ship that was by
    // then destroyed, so `cloak()` returned false for a reason that had
    // nothing to do with nebulae.
    const { eng } = fight({ place: 'mutara', seed: 2, them: ['bird_of_prey'], cap: 0 });
    const bop = eng.hostiles[0];
    bop.x = 0; bop.y = 0; bop.z = 0;
    bop.cloakCooldown = 0;
    assert.ok(bop.cloak(), 'a Bird-of-Prey could not cloak at all');
    eng.update(1 / 30);
    assert.equal(bop.cloaked, false, 'it stayed cloaked inside the nebula');

    // Control: the same ship, the same order, at Sol.
    const open = fight({ place: 'sol', seed: 2, them: ['bird_of_prey'], cap: 0 });
    const other = open.eng.hostiles[0];
    other.cloakCooldown = 0;
    assert.ok(other.cloak());
    open.eng.update(1 / 30);
    assert.equal(other.cloaked, true, 'a cloak failed in open space, where nothing should touch it');
  });

  test('no warp field will form in metreon gas', () => {
    const briar = fight({ place: 'briar', seed: 5, them: ['galor'], cap: 1 });
    assert.equal(briar.eng.canWarpOut, false);
    assert.equal(briar.eng.beginWarpOut(), false);
    const said = briar.eng.log[briar.eng.log.length - 1]?.text ?? '';
    // The REASON, not merely the refusal: "we are pinned" is the Kobayashi
    // Maru's answer and it is the wrong one here.
    assert.match(said, /metreon/i, `the refusal said "${said}"`);

    const sol = fight({ place: 'sol', seed: 5, them: ['galor'], cap: 1 });
    assert.equal(sol.eng.canWarpOut, true);
    assert.equal(sol.eng.beginWarpOut(), true);
  });

  test('nothing ends up inside a rock, in any of these battles', () => {
    // The soft-lock shape. A ship inside a solid feature cannot be shot from
    // any direction — every line to it crosses the rock it is standing in — so
    // it is a hostile that cannot be killed and an end condition that never
    // fires. The invariant checker says so; this drives it.
    for (const place of ['wolf359', 'mutara', 'badlands_1', 'briar', 'sol']) {
      for (let seed = 1; seed <= 3; seed++) {
        const { violations, eng } = fight({ place, seed });
        assert.deepEqual(violations, [],
          `${place} seed ${seed}: ${violations.map((v) => v.text).join('; ')}`);
        assert.ok(eng.over, `${place} seed ${seed} never finished`);
      }
    }
  });

  test('a ship pushed into a rock is put back outside it', () => {
    // Driven directly, because the fights above never produced one — which is
    // exactly why it needs its own test. Without it the recovery path is
    // written, believed, and never executed.
    const { eng } = fight({ place: 'wolf359', seed: 1, cap: 1 });
    const rock = eng.arena.features.find((f) => f.type === 'solid');
    assert.ok(rock, 'no rock to push anything into');
    const victim = eng.hostiles[0];
    victim.x = rock.x; victim.y = rock.y; victim.z = rock.z;
    assert.ok(insideSolid(eng.arena, victim), 'the setup did not put it inside');
    eng.update(1 / 30);
    assert.equal(insideSolid(eng.arena, victim), null,
      'a ship at the dead centre of a rock was left there');
  });
});
