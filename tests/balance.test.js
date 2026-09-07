// Balance regression tests.
//
// These exist because a plausible-looking set of difficulty multipliers once
// made a Constitution lose 20 times out of 20 to a single light raider. The
// numbers below are simulated, not asserted from theory, because the paper
// figures were exactly what hid that bug: they double-counted fore and aft
// batteries that a ship facing its target can never fire together.
//
// The simulated pilot only steers, throttles, and swaps power presets. It does
// not use bridge officer abilities, devices, or subsystem targeting.
//
// That used to end "so a real player has meaningful headroom above every number
// here", which was an assumption stated as a fact and wrong about the one part
// of it anything here could check. Measured, subsystem targeting was NEGATIVE
// headroom at every one of its seven targets — see the tests at the foot of this
// file. The abilities and devices remain unmeasured, and are therefore not
// claimed either way.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Game } from '../src/core/state.js';
import {
  Ship, SUBSYSTEM_KEYS, TARGETABLE_SUBSYSTEMS, CALLED_SHOT_HULL, CALLED_SHOT_PLAYER,
} from '../src/sim/ship.js';
import { Character } from '../src/rules/character.js';
import { DIFFICULTIES } from '../src/rules/difficulty.js';
import { SHIP_CLASSES, SHIP_LIST } from '../src/world/ships.data.js';
import { Engagement } from '../src/sim/combat.js';
import { DifficultySettings } from '../src/rules/difficulty.js';

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
    // Read from the after-action record, not from the engagement. The game
    // clears the engagement the moment it finishes the fight, which is the
    // whole point of `lastCombat` existing.
    const outcome = g.lastCombat?.outcome ?? g.engagement?.outcome;
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

/**
 * A true one-on-one, bypassing the difficulty's fleet-size lever so the
 * per-ship stat ladder can be measured on its own. Above Vice Admiral
 * `startCombat` fields reinforcements, which is a separate axis.
 */
function singleOpponent({ playerClass, enemyClass, difficulty, runs = 10 }) {
  const settings = new DifficultySettings(difficulty);
  let survived = 0;
  for (let seed = 0; seed < runs; seed++) {
    const g = new Game({
      seed: BigInt(seed + 1), crewMode: 'original', difficulty, shipClass: playerClass,
      character: new Character({ speciesId: 'andorian', careerId: 'tactical' }),
    });
    const enemy = new Ship(enemyClass, { faction: SHIP_CLASSES[enemyClass].faction, name: 'Test' });
    enemy.applyMods(settings.enemyMods());
    g.engagement = new Engagement(g.ship, [enemy], g.rng);
    g.mode = 'combat';
    for (let i = 0; i < 40000 && !g.engagement.over; i++) {
      if (i % 15 === 0) pilot(g);
      g.engagement.update(1 / 30);
      g.ship.update(1 / 30, g.rng);
    }
    if (g.engagement.outcome !== 'destroyed') survived++;
  }
  return { survived, runs, survivalRate: survived / runs };
}

test('a single same-tier opponent stays beatable at every rung', () => {
  // This is the promise the difficulty text makes at the top of the ladder:
  // "any single opponent is still beatable; they simply stop arriving one at
  // a time." If that ever stops being true, the ladder has become a wall.
  for (const d of DIFFICULTIES) {
    const r = singleOpponent({
      playerClass: 'sovereign', enemyClass: 'vorcha', difficulty: d.id, runs: 8,
    });
    assert.ok(r.survivalRate >= 0.5,
      `${d.name}: a Sovereign survived only ${r.survived}/${r.runs} against one Vor'cha`);
  }
});

test('being outnumbered is survivable by disengaging', () => {
  // At the top of the ladder you are outnumbered, and two same-tier ships is
  // roughly a four-to-one disadvantage — a fight you are meant to break off,
  // not win. That escape hatch has to actually work.
  let escaped = 0;
  const runs = 10;
  for (let seed = 0; seed < runs; seed++) {
    const g = new Game({
      seed: BigInt(seed + 1), crewMode: 'original', difficulty: 'fleet_admiral',
      shipClass: 'sovereign',
      character: new Character({ speciesId: 'andorian', careerId: 'tactical' }),
    });
    g.startCombat([new Ship('vorcha', { faction: 'klingon', name: 'Test' })]);
    assert.ok(g.engagement.hostiles.length > 1, 'Fleet Admiral should outnumber you');
    for (let i = 0; i < 50000 && g.engagement && !g.engagement.over; i++) {
      if (i % 15 === 0) {
        const e = g.engagement;
        if (g.ship.hullPct < 0.5 && e.warpOutTimer <= 0) e.beginWarpOut();
        if (e.warpOutTimer > 0) { g.ship.throttle = 1; g.ship.evasive = true; }
        else { e.comeAboutTo(e.target); g.ship.throttle = 0.6; }
      }
      g.update(1 / 30);
    }
    if ((g.lastCombat?.outcome ?? g.engagement?.outcome) === 'escaped') escaped++;
  }
  assert.ok(escaped >= runs * 0.8,
    `a captain who breaks off should get away: ${escaped}/${runs}`);
});

test('the hardest difficulty is still dangerous', () => {
  // The other direction: it must not be a walkover either.
  const r = duel({ playerClass: 'excelsior', enemyClass: 'neghvar', difficulty: 'fleet_admiral', runs: 10 });
  assert.ok(r.lost > 0, 'an Excelsior should not reliably beat a Negh’Var at Fleet Admiral');
});

test('no difficulty is an unwinnable wall for a tier-appropriate ship', () => {
  // Every rung gets checked, because the wall appeared silently at the top.
  for (const d of DIFFICULTIES) {
    const r = singleOpponent({
      playerClass: 'constitution_refit', enemyClass: 'ktinga', difficulty: d.id, runs: 6,
    });
    assert.ok(r.survived > 0,
      `${d.name}: a Constitution refit never survived a K't'inga (${r.runs - r.survived}/${r.runs} losses)`);
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
      // The ship that fought, not whatever ship the captain has afterwards.
      //
      // Losing a hull now costs you that hull and Starfleet assigns another,
      // so reading `g.ship` after the fight measured a REPLACEMENT at full
      // health — and the hardest difficulty, which loses ships most often,
      // came out with the most hull left. The fight is what is being measured.
      const fought = g.ship;
      for (let i = 0; i < 40000 && g.engagement && !g.engagement.over; i++) {
        if (i % 15 === 0) pilot(g);
        g.update(1 / 30);
      }
      hull += fought.destroyed ? 0 : fought.hullPct;
    }
    return hull / runs;
  };
  const easy = cost('cadet');
  const hard = cost('admiral');
  assert.ok(easy > hard + 0.1,
    `hull remaining: cadet ${easy.toFixed(2)} vs admiral ${hard.toFixed(2)} — difficulty is not biting`);
});

test('being outnumbered is the main lever at high difficulty', () => {
  // Originally this compared numbers in the difficulty table, which is exactly
  // how the lever stayed disconnected for so long. Drive a real fight instead.
  const fielded = (difficulty) => {
    const g = new Game({ seed: 1n, crewMode: 'original', difficulty });
    g.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: 'Test' })]);
    return g.engagement.hostiles.length;
  };
  assert.ok(fielded('fleet_admiral') > fielded('lieutenant'),
    'the top of the ladder must actually field more hulls in a real engagement');

  // Measure the ramp above the intended baseline, not above Story's assisted
  // floor — Story's generosity otherwise inflates every ratio equally.
  const base = DIFFICULTIES.find((d) => d.id === 'lieutenant');
  const top = DIFFICULTIES.at(-1);
  const countRamp = top.enemyCount / base.enemyCount;
  const hullRamp = top.enemyHull / base.enemyHull;
  const damageRamp = top.enemyDamage / base.enemyDamage;
  assert.ok(countRamp > hullRamp && countRamp > damageRamp,
    `above Lieutenant: count ${countRamp.toFixed(2)}x, hull ${hullRamp.toFixed(2)}x, `
    + `damage ${damageRamp.toFixed(2)}x — count should dominate`);
  assert.ok(hullRamp <= 1.35, `enemy hull ramps ${hullRamp.toFixed(2)}x above baseline — sponges`);
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

// -------------------------------------------------- what a called shot is worth
//
// The comment at the top of this file says the simulated pilot "does not use
// bridge officer abilities, devices, or subsystem targeting, so a real player
// has meaningful headroom above every number here." That was a claim in prose
// and it was false in the one part anything here could check.
//
// Measured over sixty seeded runs a cell, a Miranda against three Birds-of-Prey
// at `captain`, varying only what the captain aimed at:
//
//     hull (default) 58%   engines 47%   warpcore 37%   weapons 28%
//     shields 25%   sensors 22%   auxiliary 22%   lifesupport 22%
//
// Every one of the seven was worse than not using the feature. Not a lever with
// a tradeoff — a button that was always a mistake, under a manual promising
// that "targeting a subsystem trades total damage for a specific outcome".

test('a called shot costs the captain less hull damage than it costs a hostile', () => {
  // The mechanism, asserted without a simulation so it cannot be noise.
  //
  // One constant was doing two jobs. §31 set 0.70 by reading player deaths and
  // battle length — the right numbers for the question it asked, which was how
  // hard the enemy's new called shots should land. The captain's price is not
  // that quantity: it is what an option costs the person choosing it, and at
  // 0.70 no target was worth choosing.
  assert.ok(CALLED_SHOT_PLAYER > CALLED_SHOT_HULL,
    `the captain pays ${CALLED_SHOT_PLAYER} and a hostile ${CALLED_SHOT_HULL} — the split is backwards`);
  // And not so far that it is free. 1.00 is the strictly-dominant configuration
  // §31 removed: measured, weapons 78% and engines 83% against a 65% baseline.
  assert.ok(CALLED_SHOT_PLAYER < 1,
    'a called shot that costs the captain nothing is the free upgrade §31 removed');

  const hit = (multiplier) => {
    const s = new Ship('d7', { faction: 'klingon', name: 'Target' });
    s.shieldsUp = false;
    const before = s.hull;
    s.takeDamage(500, { subsystem: 'weapons', calledShotHull: multiplier });
    return before - s.hull;
  };
  const captain = hit(CALLED_SHOT_PLAYER);
  const hostile = hit(CALLED_SHOT_HULL);
  assert.ok(captain > hostile,
    `the captain's called shot took ${captain.toFixed(1)} hull and a hostile's ${hostile.toFixed(1)}`);
});

test('and it is a choice: one target beats hull fire, others do not', () => {
  // The outcome, which is what the mechanism is for. Fewer runs than the sixty
  // above, so the margin asserted is the direction and not the figure.
  const aimed = (sub, runs = 30) => {
    let survived = 0;
    for (let seed = 0; seed < runs; seed++) {
      const g = new Game({
        seed: BigInt(seed + 1), crewMode: 'original', difficulty: 'captain', shipClass: 'miranda',
        character: new Character({ speciesId: 'andorian', careerId: 'tactical' }),
      });
      const hostiles = [];
      for (let i = 0; i < 3; i++) hostiles.push(new Ship('bird_of_prey', { faction: 'klingon', name: `H${i}` }));
      g.startCombat(hostiles);
      for (let i = 0; i < 40000 && g.engagement && !g.engagement.over; i++) {
        if (i % 15 === 0 && g.engagement.target) {
          pilot(g);
          if (sub && g.engagement.targetedSubsystem !== sub) g.engagement.targetSubsystem(sub);
        }
        g.update(1 / 30);
      }
      if ((g.lastCombat?.outcome ?? g.engagement?.outcome) !== 'destroyed') survived++;
    }
    return survived / runs;
  };
  const hull = aimed(null);
  const engines = aimed('engines');
  const sensors = aimed('sensors');

  // Worth taking somewhere: stopping three raiders from manoeuvring is worth
  // the hull damage it costs to do it.
  assert.ok(engines >= hull,
    `aiming at engines survives ${(engines * 100).toFixed(0)}% against ${(hull * 100).toFixed(0)}% for hull fire`);
  // And not always right, which is the other half of being a choice. A lever
  // that is correct every time is as shallow as one that is correct never.
  assert.ok(sensors < hull,
    `aiming at sensors survives ${(sensors * 100).toFixed(0)}%, which is not worse than hull fire's ${(hull * 100).toFixed(0)}%`);
});

test('nothing is offered as a target that cannot be shot out', () => {
  // `auxiliary` is read by nothing in the game and `lifesupport` by one log
  // line about our OWN casualties, so neither does anything to the ship being
  // shot at. Held at zero on every hostile from the first tick, both leave the
  // fight at exactly the survival and length of crippling nothing at all — and
  // the targeting panel recommended one of them by name.
  //
  // Read from the source with comments stripped. A flag named in a sentence
  // explaining why it is inert would otherwise count as a reader of itself,
  // which is the defect `guards.test.js` exists to record.
  const HERE = dirname(fileURLToPath(import.meta.url));
  const root = join(HERE, '..', 'src');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:'"\\])\/\/.*$/, '$1')).join('\n');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? walk(join(d, e.name))
    : (e.name.endsWith('.js') ? [join(d, e.name)] : [])));
  const source = walk(root).map((f) => strip(readFileSync(f, 'utf8'))).join('\n');
  const readsOf = (key) => (source.match(new RegExp(`subsystems\\.${key}\\b`, 'g')) ?? []).length;

  for (const key of TARGETABLE_SUBSYSTEMS) {
    assert.ok(SUBSYSTEM_KEYS.includes(key), `${key} is offered and is not a subsystem`);
    // Two: the declaration in SUBSYSTEM_KEYS is not a read, and one lone
    // mention is what `lifesupport` has.
    assert.ok(readsOf(key) > 2,
      `${key} is offered as a target and is read ${readsOf(key)} times`);
  }
  const excluded = SUBSYSTEM_KEYS.filter((k) => !TARGETABLE_SUBSYSTEMS.includes(k));
  assert.deepEqual(excluded.sort(), ['auxiliary', 'lifesupport'],
    'the set of subsystems not worth aiming at has changed — measure it before moving it');
  for (const key of excluded) {
    assert.ok(readsOf(key) <= 1,
      `${key} is excluded from targeting but read ${readsOf(key)} times — it may do something now`);
  }
});
