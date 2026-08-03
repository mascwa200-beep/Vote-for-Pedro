// Balance regression tests.
//
// These exist because a plausible-looking set of difficulty multipliers once
// made a Constitution lose 20 times out of 20 to a single light raider. The
// numbers below are simulated, not asserted from theory, because the paper
// figures were exactly what hid that bug: they double-counted fore and aft
// batteries that a ship facing its target can never fire together.
//
// The simulated pilot only steers, throttles, and swaps power presets. It does
// not use bridge officer abilities, devices, or subsystem targeting, so a real
// player has meaningful headroom above every number here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';
import { Character } from '../src/rules/character.js';
import { DIFFICULTIES } from '../src/rules/difficulty.js';
import { SHIP_CLASSES, SHIP_LIST } from '../src/world/ships.data.js';

/** Keep the nose on the target, keep moving, and route power sensibly. */
function pilot(g) {
  const eng = g.engagement;
  if (!eng || eng.over) return;
  eng.comeAboutTo(eng.target);
  g.ship.throttle = 0.6;
  g.ship.power.applyPreset(g.ship.shieldPct < 0.35 ? 'defense' : 'attack');
}

/**
 * Run N duels and report how they went.
 * `routed` counts as a player success — a Klingon breaking off at 12% hull is
 * a win, not a draw.
 */
function duel({ playerClass, enemyClass, difficulty, runs = 12, allies = 0 }) {
  let survived = 0;
  let lost = 0;
  for (let seed = 0; seed < runs; seed++) {
    const character = new Character({ speciesId: 'andorian', careerId: 'tactical' });
    const g = new Game({
      seed: BigInt(seed + 1), crewMode: 'original', character, difficulty,
      shipClass: playerClass,
    });
    const hostiles = [new Ship(enemyClass, { faction: SHIP_CLASSES[enemyClass].faction, name: 'Test' })];
    for (let i = 0; i < allies; i++) {
      hostiles.push(new Ship(enemyClass, { faction: SHIP_CLASSES[enemyClass].faction, name: `Test ${i + 2}` }));
    }
    g.startCombat(hostiles);
    for (let i = 0; i < 40000 && g.engagement && !g.engagement.over; i++) {
      if (i % 15 === 0) pilot(g);
      g.update(1 / 30);
    }
    const outcome = g.engagement?.outcome;
    if (outcome === 'destroyed') lost++; else survived++;
  }
  return { survived, lost, runs, survivalRate: survived / runs };
}

// ---------------------------------------------------------------- the floor

test('the starting ship reliably survives a light raider at the intended difficulty', () => {
  const r = duel({ playerClass: 'constitution', enemyClass: 'bird_of_prey', difficulty: 'lieutenant' });
  assert.equal(r.lost, 0, `a Constitution lost ${r.lost}/${r.runs} to a B'rel at Lieutenant`);
});

test('a heavy cruiser out-shoots a light raider frontally', () => {
  // The specific bug this guards: a raider's forward battery must not exceed
  // a capital ship's. The raider's edge is speed, agility, and the cloak.
  const forward = (id) => {
    const cls = SHIP_CLASSES[id];
    return cls.weapons
      .filter((w) => (w.facing ?? 0) === 0)
      .reduce((n, w) => n + w.damage / w.cycle, 0);
  };
  assert.ok(forward('constitution') > forward('bird_of_prey'),
    `Constitution ${forward('constitution').toFixed(1)} should exceed B'rel ${forward('bird_of_prey').toFixed(1)}`);
  assert.ok(forward('excelsior') > forward('d7'));
  assert.ok(forward('sovereign') > forward('vorcha'));
});

test('Story difficulty cannot lose the ship at all', () => {
  const r = duel({ playerClass: 'constitution', enemyClass: 'vorcha', difficulty: 'story', runs: 8 });
  assert.equal(r.lost, 0, 'the ship cannot be lost on Story');
});

// ---------------------------------------------------------------- the ceiling

test('a tier-appropriate ship can still win at the hardest difficulty', () => {
  // Fleet Admiral must be brutal, not impossible. A Sovereign against a
  // single same-tier opponent should come through more often than not.
  const r = duel({ playerClass: 'sovereign', enemyClass: 'vorcha', difficulty: 'fleet_admiral' });
  assert.ok(r.survivalRate >= 0.5,
    `Sovereign survived only ${r.survived}/${r.runs} against one Vor'cha at Fleet Admiral`);
});

test('the hardest difficulty is still dangerous', () => {
  // The other direction: it must not be a walkover either.
  const r = duel({ playerClass: 'excelsior', enemyClass: 'neghvar', difficulty: 'fleet_admiral', runs: 10 });
  assert.ok(r.lost > 0, 'an Excelsior should not reliably beat a Negh’Var at Fleet Admiral');
});

test('no difficulty is an unwinnable wall in a same-tier duel', () => {
  // Every rung gets checked, because the wall appeared silently at the top.
  for (const d of DIFFICULTIES) {
    const r = duel({
      playerClass: 'constitution_refit', enemyClass: 'ktinga', difficulty: d.id, runs: 6,
    });
    assert.ok(r.survived > 0,
      `${d.name}: a Constitution refit never survived a K't'inga (${r.lost}/${r.runs} losses)`);
  }
});

// ---------------------------------------------------------------- the shape

test('difficulty makes the same fight measurably harder', () => {
  // Survival rate saturates at both ends of the ladder, so the honest signal
  // is how much ship you have left when the shooting stops.
  const cost = (difficulty) => {
    let hull = 0;
    const runs = 10;
    for (let seed = 0; seed < runs; seed++) {
      const g = new Game({
        seed: BigInt(seed + 1), crewMode: 'original', difficulty, shipClass: 'constitution',
        character: new Character({ speciesId: 'andorian', careerId: 'tactical' }),
      });
      g.startCombat([new Ship('galor', { faction: 'cardassian', name: 'Test' })]);
      for (let i = 0; i < 40000 && g.engagement && !g.engagement.over; i++) {
        if (i % 15 === 0) pilot(g);
        g.update(1 / 30);
      }
      hull += g.ship.hullPct;
    }
    return hull / runs;
  };
  const easy = cost('cadet');
  const hard = cost('admiral');
  assert.ok(easy > hard + 0.1,
    `hull remaining: cadet ${easy.toFixed(2)} vs admiral ${hard.toFixed(2)} — difficulty is not biting`);
});

test('being outnumbered is the main lever at high difficulty', () => {
  // Enemy counts rise faster than enemy hulls; that is the intended shape.
  const first = DIFFICULTIES[0];
  const last = DIFFICULTIES.at(-1);
  const countGrowth = last.enemyCount / first.enemyCount;
  const hullGrowth = last.enemyHull / first.enemyHull;
  assert.ok(countGrowth > hullGrowth * 1.5,
    `count grew ${countGrowth.toFixed(2)}x but hull grew ${hullGrowth.toFixed(2)}x — enemies are becoming sponges`);
});

test('no enemy hull becomes an absurd damage sponge', () => {
  const last = DIFFICULTIES.at(-1);
  assert.ok(last.enemyHull <= 1.5, `top-end enemy hull multiplier is ${last.enemyHull}`);
  assert.ok(last.enemyDamage / last.playerDamage <= 2.0,
    'the damage exchange ratio at the top should stay under 2x');
});

// ---------------------------------------------------------------- data sanity

test('player-commandable ships gain overall power with tier', () => {
  // Tier tracks total capability, not any single axis. The Defiant is a
  // deliberate glass cannon — it out-guns hulls twice its size and dies to
  // them — so the comparison is on combined firepower and durability.
  const forwardDps = (cls) => cls.weapons
    .filter((w) => (w.facing ?? 0) === 0)
    .reduce((n, w) => n + w.damage / w.cycle, 0);
  const power = (cls) => forwardDps(cls) * (cls.hull + cls.shields);

  const byTier = new Map();
  for (const cls of SHIP_LIST) {
    if (cls.faction !== 'federation' || !cls.boffSeats || cls.id === 'runabout') continue;
    const best = byTier.get(cls.tier) ?? 0;
    byTier.set(cls.tier, Math.max(best, power(cls)));
  }
  const tiers = [...byTier.keys()].sort((a, b) => a - b);
  for (let i = 1; i < tiers.length; i++) {
    assert.ok(byTier.get(tiers[i]) > byTier.get(tiers[i - 1]),
      `the best tier ${tiers[i]} hull is not stronger than the best tier ${tiers[i - 1]} hull`);
  }
});

test('every ship has a coherent weapon fit', () => {
  for (const cls of SHIP_LIST) {
    for (const w of cls.weapons ?? []) {
      assert.ok(w.damage > 0, `${cls.id}/${w.id} damage`);
      assert.ok(w.cycle > 0, `${cls.id}/${w.id} cycle`);
      assert.ok(w.degrees > 0 && w.degrees <= 360, `${cls.id}/${w.id} arc ${w.degrees}`);
      assert.ok(['beam', 'cannon', 'torpedo'].includes(w.type), `${cls.id}/${w.id} type`);
    }
    // Anything that is not a civilian hull must be able to shoot back.
    if (!cls.civilian) assert.ok((cls.weapons ?? []).length > 0, `${cls.id} is unarmed`);
  }
});
