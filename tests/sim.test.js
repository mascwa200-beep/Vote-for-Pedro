// Simulation tests. These cover the parts where a wrong number is invisible
// on screen but decides whether a fight is winnable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { RNG, hashSeed } from '../src/core/rng.js';
import { Ship, facingForBearing, inArc, FACINGS, facingForDirection } from '../src/sim/ship.js';
import { PowerGrid, effectiveness } from '../src/sim/power.js';
import {
  Engagement, rangeFactor, ARENA_RADIUS, MAX_WEAPON_RANGE, WITHDRAW_SECONDS, OUTCOMES,
} from '../src/sim/combat.js';
import { CaptainProgress, RANKS } from '../src/sim/skills.js';
import { Loadout, startingLoadout, CONSOLES } from '../src/sim/loadout.js';
import { Ledger } from '../src/core/ledger.js';
import { on } from '../src/core/events.js';
import { Galaxy, warpSpeed, travelHours, fuelCost, plotTransit } from '../src/world/galaxy.js';
import { rollEncounter } from '../src/world/encounters.js';
import { Mission, MissionBook } from '../src/missions/engine.js';
import { EPISODES } from '../src/missions/episodes/index.js';
import { parseOrder } from '../src/ui/orders.js';
import { Game } from '../src/core/state.js';
import { getShipClass, SHIP_LIST } from '../src/world/ships.data.js';
import { DIFFICULTIES } from '../src/rules/difficulty.js';
import { SYSTEMS, SYSTEM_BY_ID } from '../src/world/systems.data.js';
import { buildRoster, STATIONS } from '../src/world/crews.data.js';
import { resolveHail, HAIL_ENDING } from '../src/sim/diplomacy.js';
import { ABILITIES, ABILITY_LIST, abilityPool, Officer } from '../src/sim/officers.js';
import { CAREERS, Character } from '../src/rules/character.js';
import { checkAll } from '../src/sim/invariants.js';

// ---------------------------------------------------------------- RNG

test('RNG is deterministic for a given seed', () => {
  const a = new RNG(0x1701n);
  const b = new RNG(0x1701n);
  const seqA = Array.from({ length: 64 }, () => a.float());
  const seqB = Array.from({ length: 64 }, () => b.float());
  assert.deepEqual(seqA, seqB);
});

test('RNG diverges for different seeds', () => {
  const a = new RNG(1n);
  const b = new RNG(2n);
  assert.notEqual(a.float(), b.float());
});

test('RNG state is 64-bit and floats stay in [0,1)', () => {
  const r = new RNG(hashSeed('enterprise'));
  for (let i = 0; i < 5000; i++) {
    const raw = r.next();
    assert.ok(raw >= 0n && raw < (1n << 64n), 'draw must fit in 64 bits');
    const f = r.float();
    assert.ok(f >= 0 && f < 1, `float out of range: ${f}`);
  }
});

test('RNG restores exactly from a save', () => {
  const r = new RNG(hashSeed('restore'));
  for (let i = 0; i < 137; i++) r.float();
  const saved = r.save();
  const expected = Array.from({ length: 10 }, () => r.float());

  const restored = RNG.load(saved);
  const actual = Array.from({ length: 10 }, () => restored.float());
  assert.deepEqual(actual, expected);
});

test('RNG int respects inclusive bounds', () => {
  const r = new RNG(7n);
  const seen = new Set();
  for (let i = 0; i < 3000; i++) seen.add(r.int(3, 7));
  assert.deepEqual([...seen].sort((a, b) => a - b), [3, 4, 5, 6, 7]);
});

test('same seed builds an identical galaxy and encounter stream', () => {
  const roll = (seed) => {
    const rng = new RNG(seed);
    const g = new Galaxy(rng);
    return {
      systems: g.systems.map((s) => s.id),
      encounters: Array.from({ length: 20 }, () =>
        rollEncounter(rng, 'archanis', { ledger: new Ledger() })?.kind),
    };
  };
  assert.deepEqual(roll(0xbeefn), roll(0xbeefn));
});

// ---------------------------------------------------------------- geometry

test('bearings map to the correct shield facing', () => {
  assert.equal(facingForBearing(0), 'fore');
  assert.equal(facingForBearing(44), 'fore');
  assert.equal(facingForBearing(-44), 'fore');
  assert.equal(facingForBearing(90), 'starboard');
  assert.equal(facingForBearing(-90), 'port');
  assert.equal(facingForBearing(180), 'aft');
  assert.equal(facingForBearing(-180), 'aft');
  assert.equal(facingForBearing(200), 'aft');
  assert.equal(facingForBearing(359), 'fore');
});

test('firing arcs include and exclude correctly', () => {
  const forward90 = { facing: 0, degrees: 90 };
  assert.ok(inArc(0, forward90));
  assert.ok(inArc(44, forward90));
  assert.ok(!inArc(46, forward90));
  assert.ok(!inArc(180, forward90));

  const aft200 = { facing: 180, degrees: 200 };
  assert.ok(inArc(180, aft200));
  assert.ok(inArc(90, aft200));
  assert.ok(!inArc(0, aft200));
});

test('range falloff behaves per weapon type', () => {
  assert.equal(rangeFactor('beam', 2000), 0);
  assert.ok(rangeFactor('beam', 100) > rangeFactor('beam', 800));
  assert.equal(rangeFactor('torpedo', 1000), 1, 'torpedoes track, so no falloff');

  // Cannons hold their damage well up close and then collapse; beams degrade
  // gently the whole way out. That trade is the reason to fly one or the other.
  assert.ok(rangeFactor('cannon', 310) > rangeFactor('beam', 450), 'cannons dominate mid-range');
  assert.ok(rangeFactor('cannon', 560) < rangeFactor('beam', 810), 'and collapse at the edge');
  assert.equal(rangeFactor('cannon', 700), 0, 'a cannon simply cannot reach beam range');
  assert.ok(rangeFactor('beam', 700) > 0);
});

// ---------------------------------------------------------------- power

test('power effectiveness scales around the 50 nominal', () => {
  assert.equal(effectiveness(50), 1);
  assert.ok(effectiveness(100) > effectiveness(50));
  assert.ok(effectiveness(25) < effectiveness(50));
  assert.ok(effectiveness(0) >= 0.4, 'power alone never fully disables a system');
});

test('power grid never exceeds its cap', () => {
  const grid = new PowerGrid(200);
  grid.set('weapons', 100);
  grid.set('shields', 100);
  grid.set('engines', 100);
  grid.set('auxiliary', 100);
  assert.ok(grid.total <= 200, `total was ${grid.total}`);
});

test('diverting power protects the targeted subsystem', () => {
  const grid = new PowerGrid(200);
  grid.set('shields', 100);
  assert.equal(grid.target.shields, 100);
  assert.ok(grid.total <= 200);
});

test('power levels ease toward target rather than snapping', () => {
  const grid = new PowerGrid(200);
  grid.applyPreset('attack');
  assert.ok(!grid.settled, 'should not be settled immediately');
  grid.update(0.1);
  assert.ok(grid.levels.weapons > 50 && grid.levels.weapons < 100, 'mid-transfer');
  for (let i = 0; i < 100; i++) grid.update(0.1);
  assert.ok(grid.settled);
});

// ---------------------------------------------------------------- ship

test('every ship class instantiates with sane stats', () => {
  for (const cls of SHIP_LIST) {
    const s = new Ship(cls.id);
    assert.ok(s.maxHull > 0, `${cls.id} hull`);
    assert.ok(s.maxShield > 0, `${cls.id} shields`);
    assert.equal(s.hullPct, 1);
    assert.ok(Math.abs(s.shieldPct - 1) < 1e-9);
    for (const f of FACINGS) assert.ok(s.shields[f] > 0);
  }
});

test('damage hits the facing it arrives on, not the others', () => {
  const s = new Ship('constitution');
  const before = { ...s.shields };
  s.takeDamage(400, { bearing: 0, rng: new RNG(1n) });
  assert.ok(s.shields.fore < before.fore, 'forward shield took it');
  assert.equal(s.shields.aft, before.aft, 'aft shield untouched');
  assert.equal(s.shields.port, before.port);
});

test('shields bleed through even when healthy', () => {
  const s = new Ship('constitution');
  const result = s.takeDamage(200, { bearing: 0, rng: new RNG(2n) });
  assert.ok(result.hullDamage > 0, 'some damage always reaches the hull');
  assert.ok(result.shieldDamage > result.hullDamage);
});

test('a downed facing sends everything to the hull', () => {
  const s = new Ship('constitution');
  s.shields.fore = 0;
  const hullBefore = s.hull;
  s.takeDamage(500, { bearing: 0, rng: new RNG(3n) });
  assert.ok(s.hull < hullBefore - 400, 'nearly all of it reached the hull');
});

test('torpedo piercing beats a beam of the same yield through shields', () => {
  const rng = new RNG(11n);
  const a = new Ship('constitution');
  const b = new Ship('constitution');
  const beam = a.takeDamage(500, { bearing: 0, type: 'energy', shieldPiercing: 0, rng });
  const torp = b.takeDamage(500, { bearing: 0, type: 'kinetic', shieldPiercing: 0.25, rng });
  assert.ok(torp.hullDamage > beam.hullDamage);
});

test('hull loss kills crew', () => {
  const s = new Ship('constitution');
  s.shieldsUp = false;
  const before = s.crew;
  s.takeDamage(s.maxHull * 0.3, { bearing: 0, rng: new RNG(4n) });
  assert.ok(s.crew < before, 'a serious hull hit costs lives');
});

test('a destroyed warp core starts a breach that ejecting survives', () => {
  const s = new Ship('constitution');
  s.damageSubsystem('warpcore', 1.0);
  assert.ok(s.breaching, 'core destruction begins a breach');
  assert.ok(s.ejectCore(), 'the core can be ejected');
  assert.ok(!s.breaching, 'ejecting stops the countdown');
  assert.ok(s.coreEjected);
  assert.ok(s.power.cap < s.cls.powerCap, 'and costs most of the power budget');
});

test('an unattended breach destroys the ship', () => {
  const s = new Ship('constitution');
  s.beginBreach(2);
  const rng = new RNG(5n);
  for (let i = 0; i < 100; i++) s.update(0.1, rng);
  assert.ok(s.destroyed);
  assert.equal(s.destroyCause, 'warp core breach');
});

test('Borg adaptation reduces repeated damage of one type', () => {
  const cube = new Ship('borg_cube');
  const rng = new RNG(6n);
  cube.shieldsUp = false;
  const first = cube.takeDamage(1000, { bearing: 0, type: 'energy', rng });
  for (let i = 0; i < 40; i++) cube.takeDamage(1000, { bearing: 0, type: 'energy', rng });
  const later = cube.takeDamage(1000, { bearing: 0, type: 'energy', rng });
  assert.ok(later.hullDamage < first.hullDamage, 'the same weapon stops working');
});

test('restore returns a wrecked ship to full', () => {
  const s = new Ship('constitution');
  s.shieldsUp = false;
  s.takeDamage(3000, { bearing: 0, rng: new RNG(7n) });
  s.fires = 4;
  s.restore();
  assert.equal(s.hull, s.maxHull);
  assert.equal(s.fires, 0);
  assert.ok(s.shieldsUp);
});

// ---------------------------------------------------------------- combat

test('an engagement resolves to a decision and never hangs', () => {
  const rng = new RNG(0x1701n);
  const player = new Ship('constitution', { isPlayer: true, name: 'Enterprise' });
  const enemy = new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Test' });
  const eng = new Engagement(player, [enemy], rng);

  let steps = 0;
  while (!eng.over && steps < 30000) { eng.update(1 / 30); steps++; }
  assert.ok(eng.over, 'the engagement ended');
  assert.ok(OUTCOMES.includes(eng.outcome), `'${eng.outcome}' is not an ending`);
});

test('combat is reproducible from the same seed', () => {
  const run = () => {
    const rng = new RNG(0xabcdefn);
    const player = new Ship('constitution', { isPlayer: true });
    const enemy = new Ship('d7', { faction: 'klingon' });
    const eng = new Engagement(player, [enemy], rng);
    for (let i = 0; i < 900 && !eng.over; i++) eng.update(1 / 30);
    return { outcome: eng.outcome, hull: player.hull, enemyHull: enemy.hull };
  };
  assert.deepEqual(run(), run());
});

// ---- Fire at Will: the order that used to punish you for giving it --------
//
// It declared `special: 'multitarget'`, which nothing implemented, and carried
// `mods: { damage: 0.8 }` — the PRICE of the spreading that never happened. So
// the game's rank-1 tactical order was a 20% gunnery penalty and nothing else.

/** A player under fire from one torpedo-armed hostile, at point-blank. */
function torpedoDuel({ atWill, seed = 0x5150n }) {
  const rng = new RNG(seed);
  const player = new Ship('constitution', { isPlayer: true });
  const enemy = new Ship('d7', { faction: 'klingon', name: 'IKS T' });
  const eng = new Engagement(player, [enemy], rng);
  if (atWill) {
    player.addBuff({ id: 'fire_at_will', label: 'Fire at Will', until: 999, mods: {} });
  }
  return { eng, player, enemy };
}

test('“fire at will” reaches the ability, not the plain fire order', () => {
  // The phrase is in the lexicon for the generic `fire` order as well, so the
  // one a captain would actually say for this ability could have gone to
  // plain firing instead. Abilities take precedence, with plain fire as the
  // fallback — this is what says so.
  const order = parseOrder('fire at will');
  assert.equal(order.action, 'ability');
  assert.equal(order.ability, 'fire_at_will');
  assert.equal(order.fallback?.action, 'fire', 'the plain fire order is no longer the fallback');
});

test('point defence takes an inbound torpedo off the board', () => {
  // Counted through the event, and the shot must never LAND. The first version
  // of this test asserted only that the projectile was gone and the hull was
  // whole — which a torpedo satisfies by arriving and being stopped by the
  // screens, so it passed on code that had no point defence at all.
  // Twenty torpedoes, not one. The intercept is a roll — about 5% a tick, and
  // a torpedo crosses the envelope in nine — so a single-torpedo test is a
  // coin toss dressed as an assertion, and the first version of this one
  // failed on working code for that reason alone.
  let stopped = 0;
  let landed = 0;
  const offA = on('combat:point-defence', () => { stopped++; });
  const offB = on('combat:torpedo-impact', () => { landed++; });
  for (let n = 0; n < 20; n++) {
    const { eng, player, enemy } = torpedoDuel({ atWill: true, seed: 0x5150n + BigInt(n) });
    eng.projectiles.push({
      kind: 'torpedo', attacker: enemy, target: player, weapon: { type: 'torpedo' },
      x: player.x + 200, y: player.y, z: 0, speed: 420, life: 6,
    });
    for (let i = 0; i < 90 && eng.projectiles.length; i++) eng.updateProjectiles(1 / 30);
    assert.equal(eng.projectiles.length, 0, 'a torpedo is still out there');
  }
  offA?.(); offB?.();
  assert.ok(stopped > 0, 'the batteries never engaged a single torpedo in twenty');
  assert.equal(stopped + landed, 20,
    `${stopped} stopped and ${landed} landed, of twenty fired`);
});

test('and without the order the same torpedo arrives', () => {
  // Counted through the event rather than by looking for hull damage: a
  // torpedo that arrives may be stopped by the screens, which is the shields
  // doing their job and not the point defence doing anything.
  const { eng, player, enemy } = torpedoDuel({ atWill: false });
  let stopped = 0;
  const off = on('combat:point-defence', () => { stopped++; });
  eng.projectiles.push({
    kind: 'torpedo', attacker: enemy, target: player, weapon: { type: 'torpedo' },
    x: player.x + 120, y: player.y, z: 0, speed: 420, life: 6,
  });
  for (let i = 0; i < 60 && eng.projectiles.length; i++) eng.updateProjectiles(1 / 30);
  off?.();
  assert.equal(stopped, 0, 'point defence fired without the order being given');
  assert.equal(eng.projectiles.length, 0, 'the torpedo never got anywhere');
});

test('point defence never touches the ship’s own torpedoes', () => {
  // The batteries are swatting at what is coming IN. A spread of ours passing
  // the saucer on its way out is not a threat.
  const { eng, player, enemy } = torpedoDuel({ atWill: true });
  let stopped = 0;
  const off = on('combat:point-defence', () => { stopped++; });
  eng.projectiles.push({
    kind: 'torpedo', attacker: player, target: enemy, weapon: { type: 'torpedo' },
    x: player.x + 60, y: player.y, z: 0, speed: 420, life: 6,
  });
  for (let i = 0; i < 60; i++) eng.updateProjectiles(1 / 30);
  off?.();
  assert.equal(stopped, 0, 'the ship shot down its own torpedo');
});

test('and it takes nothing away from the ship you are shooting at', () => {
  // This is why point defence is the reading that works. Three others were
  // built — dividing the banks between ships, and releasing out-of-arc banks
  // with and without the damage penalty — and all three measured WORSE than
  // not giving the order, because `fireWeapon` puts a bank on cooldown and a
  // shot at a secondary steals a future shot at the primary.
  const shotsIn = (atWill) => {
    const rng = new RNG(0x2001n);
    const player = new Ship('constitution', { isPlayer: true });
    const enemy = new Ship('d7', { faction: 'klingon' });
    const eng = new Engagement(player, [enemy], rng);
    if (atWill) player.addBuff({ id: 'fire_at_will', label: 'FAW', until: 999, mods: {} });
    for (let i = 0; i < 600 && !eng.over; i++) eng.update(1 / 30);
    return eng.shotsFired;
  };
  assert.equal(shotsIn(true), shotsIn(false),
    'giving the order changed how many shots the ship put out');
});

test('a weapon out of arc does not fire', () => {
  const rng = new RNG(9n);
  const player = new Ship('constitution', { isPlayer: true });
  const enemy = new Ship('freighter', { faction: 'independent' });
  const eng = new Engagement(player, [enemy], rng);

  // Put the target directly astern and face away from it.
  enemy.x = -500; enemy.y = 0;
  player.x = 0; player.y = 0; player.heading = 0;
  const torpedo = player.weapons.find((w) => w.id === 'torpedo_fwd');
  torpedo.cooldown = 0;
  assert.equal(eng.fireWeapon(player, torpedo, enemy), false,
    'a 90-degree forward tube cannot fire astern');
});

test('subsystem targeting degrades the subsystem it names', () => {
  const rng = new RNG(10n);
  const player = new Ship('constitution', { isPlayer: true });
  const enemy = new Ship('galor', { faction: 'cardassian' });
  const eng = new Engagement(player, [enemy], rng);
  enemy.shieldsUp = false;
  eng.setTarget(enemy);
  eng.targetSubsystem('engines');

  const before = enemy.subsystems.engines;
  for (let i = 0; i < 40; i++) {
    for (const w of player.weapons) { w.cooldown = 0; eng.fireWeapon(player, w, enemy); }
  }
  assert.ok(enemy.subsystems.engines < before, 'engines were degraded');
});

// ---------------------------------------------------------------- progression

test('rank thresholds increase monotonically', () => {
  for (let i = 1; i < RANKS.length; i++) {
    assert.ok(RANKS[i].xp > RANKS[i - 1].xp, `${RANKS[i].id} threshold`);
  }
});

test('experience promotes and grants points', () => {
  const p = new CaptainProgress({ rankIndex: 0, xp: 0, unspent: 0 });
  const promo = p.addXP(RANKS[1].xp);
  assert.ok(promo?.promoted);
  assert.equal(p.rankIndex, 1);
  assert.ok(p.unspent > 0);
});

test('an open inquiry blocks promotion', () => {
  const p = new CaptainProgress({ rankIndex: 0, xp: 0, unspent: 0 });
  const ledger = new Ledger();
  ledger.inquiryOpen = true;
  const result = p.addXP(RANKS[1].xp, { ledger });
  assert.ok(result?.blocked);
  assert.equal(p.rankIndex, 0);
});

test('skill points produce real ship modifiers', () => {
  const p = new CaptainProgress({ unspent: 5 });
  const base = new Ship('constitution');
  const baseHull = base.maxHull;

  p.spend('hull_plating');
  p.spend('hull_plating');
  const buffed = new Ship('constitution');
  buffed.applyMods(p.shipMods());
  assert.ok(buffed.maxHull > baseHull, 'structural integrity ranks raise max hull');
});

test('skills cannot exceed their maximum', () => {
  const p = new CaptainProgress({ unspent: 99 });
  for (let i = 0; i < 20; i++) p.spend('beam_weapons');
  assert.equal(p.ranksIn('beam_weapons'), 5);
});

test('respec refunds every point', () => {
  const p = new CaptainProgress({ unspent: 4 });
  p.spend('beam_weapons'); p.spend('targeting');
  const refunded = p.respec();
  assert.equal(refunded, 2);
  assert.equal(p.unspent, 4);
});

// ---------------------------------------------------------------- loadout

test('consoles respect slot capacity', () => {
  const l = new Loadout({ tactical: 1, engineering: 0, science: 0, device: 0 });
  l.acquire('phaser_relay', 2);
  assert.ok(l.equip('phaser_relay'));
  assert.ok(!l.equip('phaser_relay'), 'the second one does not fit');
});

test('a refit to fewer slots moves the overflow to storage', () => {
  const l = startingLoadout(getShipClass('constitution'));
  const equippedBefore = l.all.length;
  l.refitTo({ tactical: 0, engineering: 0, science: 0, device: 0 });
  assert.equal(l.all.length, 0);
  assert.ok(l.inventory.length >= equippedBefore);
});

test('console modifiers accumulate', () => {
  const l = new Loadout({ tactical: 2, engineering: 0, science: 0, device: 0 });
  l.acquire('phaser_relay', 2);
  l.equip('phaser_relay'); l.equip('phaser_relay');
  const mods = l.shipMods();
  assert.ok(mods.beamDamage > 1.2, `expected stacking, got ${mods.beamDamage}`);
});

// ---------------------------------------------------------------- galaxy

test('warp speed follows the cube law', () => {
  assert.equal(warpSpeed(1), 1);
  assert.equal(warpSpeed(2), 8);
  assert.equal(warpSpeed(6), 216);
});

test('higher warp is faster and thirstier', () => {
  assert.ok(travelHours(10, 8) < travelHours(10, 4));
  assert.ok(fuelCost(10, 8) > fuelCost(10, 4));
});

test('every system link points at a real system', () => {
  for (const s of SYSTEMS) {
    for (const link of s.links ?? []) {
      assert.ok(SYSTEM_BY_ID[link], `${s.id} links to unknown system ${link}`);
    }
  }
});

test('the galaxy graph is fully connected', () => {
  const g = new Galaxy(new RNG(1n));
  const seen = new Set(['sol']);
  const queue = ['sol'];
  while (queue.length) {
    for (const nb of g.adjacency[queue.pop()] ?? []) {
      if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
    }
  }
  assert.equal(seen.size, g.systems.length, 'every system is reachable from Sol');
});

test('routing finds a path and it is contiguous', () => {
  const g = new Galaxy(new RNG(1n));
  const route = g.route('sol', 'cardassia_prime');
  assert.ok(route, 'a charted route exists');
  assert.equal(route.path[0], 'sol');
  assert.equal(route.path.at(-1), 'cardassia_prime');
  for (let i = 1; i < route.path.length; i++) {
    assert.ok(g.adjacency[route.path[i - 1]].includes(route.path[i]),
      `${route.path[i - 1]} is not adjacent to ${route.path[i]}`);
  }
});

test('a course costs fuel and is refused when it cannot be paid', () => {
  const g = new Galaxy(new RNG(1n));
  const ship = new Ship('constitution', { isPlayer: true });
  const ok = plotTransit(g, 'sol', 'vulcan', 6, ship);
  assert.ok(ok.transit);
  assert.ok(ok.fuel > 0);

  ship.antimatter = 0.01;
  const broke = plotTransit(g, 'sol', 'cardassia_prime', 9, ship);
  assert.ok(broke.error, 'refused for want of antimatter');
});

test('an ejected core grounds the ship', () => {
  const g = new Galaxy(new RNG(1n));
  const ship = new Ship('constitution', { isPlayer: true });
  ship.ejectCore.call(Object.assign(ship, { breaching: true }));
  const result = plotTransit(g, 'sol', 'vulcan', 6, ship);
  assert.ok(result.error, 'no warp without a core');
});

test('transit reaches its destination', () => {
  const g = new Galaxy(new RNG(1n));
  const ship = new Ship('constitution', { isPlayer: true });
  const { transit } = plotTransit(g, 'sol', 'vulcan', 8, ship);
  let state = 'travelling';
  for (let i = 0; i < 10000 && state !== 'arrived'; i++) state = transit.update(1 / 30);
  assert.equal(state, 'arrived');
  assert.equal(transit.to.id, 'vulcan');
});

// ---------------------------------------------------------------- crews

test('canonical rosters cover every station', () => {
  for (const era of ['tos', 'tng', 'ds9', 'voy']) {
    const roster = buildRoster({ mode: 'canon', era }, new RNG(1n));
    for (const station of STATIONS) {
      assert.ok(roster.some((o) => o.station === station.id),
        `${era} is missing ${station.id}`);
    }
  }
});

test('generated crews cover every station and vary by seed', () => {
  const a = buildRoster({ mode: 'original' }, new RNG(1n));
  const b = buildRoster({ mode: 'original' }, new RNG(2n));
  for (const station of STATIONS) {
    assert.ok(a.some((o) => o.station === station.id));
  }
  assert.notDeepEqual(a.map((o) => o.name), b.map((o) => o.name));
});

// ---------------------------------------------------------------- missions

test('every episode is structurally sound', () => {
  for (const ep of EPISODES) {
    assert.ok(ep.id && ep.title, 'episode needs an id and title');
    assert.ok(ep.stages[ep.start], `${ep.id}: start stage "${ep.start}" does not exist`);
    for (const [stageId, stage] of Object.entries(ep.stages)) {
      assert.ok(stage.text, `${ep.id}/${stageId} has no text`);
      assert.ok(stage.choices?.length, `${ep.id}/${stageId} has no choices`);
      for (const choice of stage.choices) {
        assert.ok(choice.id && choice.label, `${ep.id}/${stageId} choice needs id and label`);
        // A choice must either go somewhere real or terminate the episode.
        if (typeof choice.next === 'function') {
          // Routing that reads what the captain did. The engine has accepted a
          // function here since it was written; the check that a route lands on
          // a real stage is worth more than the convenience of a bare closure,
          // so such a route declares every stage it can reach and this walks
          // them. A function with no `targets` is unroutable and fails here.
          assert.ok(choice.next.targets?.length,
            `${ep.id}/${stageId}/${choice.id} routes dynamically without declaring its targets`);
          for (const target of choice.next.targets) {
            assert.ok(ep.stages[target],
              `${ep.id}/${stageId}/${choice.id} can route to missing stage "${target}"`);
          }
        } else if (choice.next) {
          assert.ok(ep.stages[choice.next],
            `${ep.id}/${stageId}/${choice.id} points at missing stage "${choice.next}"`);
        } else if (choice.branch) {
          for (const target of Object.values(choice.branch)) {
            assert.ok(ep.stages[target], `${ep.id}/${stageId} branch target "${target}" missing`);
          }
        } else {
          assert.ok(choice.outcome, `${ep.id}/${stageId}/${choice.id} neither branches nor ends`);
          assert.ok(ep.endings?.[choice.outcome],
            `${ep.id}: no ending defined for outcome "${choice.outcome}"`);
        }
      }
    }
  }
});

test('every episode system exists in the charts', () => {
  for (const ep of EPISODES) {
    if (ep.system) assert.ok(SYSTEM_BY_ID[ep.system], `${ep.id} is set at unknown system ${ep.system}`);
  }
});

test('a mission runs to an ending and writes to the ledger', () => {
  const game = new Game({ seed: 42n, crewMode: 'original' });
  const book = new MissionBook(EPISODES);
  const mission = book.start('shakedown', game);
  assert.ok(mission);

  let guard = 0;
  let flew = 0;
  while (!mission.complete && guard++ < 50) {
    // A stage happens somewhere. The shakedown's orders say Alpha Centauri, so
    // the trials are at Alpha Centauri and the ship has to actually go — which
    // is the point of gating stages by location, and is asserted below.
    const here = mission.testLocation();
    if (!here.ok) { game.locationId = here.need; flew++; }
    const choices = mission.choices().filter((c) => !c.locked);
    assert.ok(choices.length, 'a stage must offer at least one open choice');
    mission.choose(choices[0].id);
  }
  assert.ok(mission.complete, 'the mission reached an ending');
  assert.ok(flew > 0, 'the shakedown was completed without ever leaving Sol');
  assert.ok(game.ledger.entries.some((e) => e.kind === 'mission_complete'));
});

test('locked choices are reported with a reason', () => {
  const game = new Game({ seed: 43n, crewMode: 'original' });
  game.progress.spent = {};
  const book = new MissionBook(EPISODES);
  const mission = book.start('archanis_claim', game);
  const talk = mission.choices().find((c) => c.id === 'talk');
  assert.ok(talk.locked, 'the diplomacy option is gated');
  assert.ok(talk.lockReason, 'and says why');
});

// ---------------------------------------------------------------- ledger

test('the ledger tallies and scores', () => {
  const l = new Ledger();
  l.record('colony_saved', { count: 2 });
  l.record('prime_directive_violation');
  assert.equal(l.count('colony_saved'), 2);
  assert.ok(typeof l.serviceScore() === 'number');
  assert.ok(l.assessment().label);
});

test('three Prime Directive violations open an inquiry', () => {
  const l = new Ledger();
  assert.ok(!l.inquiryOpen);
  l.record('prime_directive_violation');
  l.record('prime_directive_violation');
  assert.ok(!l.inquiryOpen);
  l.record('prime_directive_violation');
  assert.ok(l.inquiryOpen, 'the third one is the one that counts');
});

test('standing is clamped and tiers change', () => {
  const l = new Ledger();
  l.adjustStanding('klingon', -500);
  assert.equal(l.standingOf('klingon'), -100);
  l.adjustStanding('klingon', 500);
  assert.equal(l.standingOf('klingon'), 100);
});

test('lost officers and destroyed ships are recorded permanently', () => {
  const l = new Ledger();
  l.loseOfficer({ name: 'Vell', station: 'tactical', rank: 'Lieutenant' });
  l.destroyShip({ name: 'IKS Test', classId: 'd7', faction: 'klingon' });
  assert.equal(l.lostOfficers.length, 1);
  assert.equal(l.destroyedShips.length, 1);
  const restored = Ledger.load(l.save());
  assert.equal(restored.lostOfficers.length, 1);
  assert.equal(restored.destroyedShips.length, 1);
});

// ---------------------------------------------------------------- diplomacy

test('the Borg do not answer hails', () => {
  const result = resolveHail(new RNG(1n), 'identify', { factionId: 'borg', standing: -100 });
  assert.equal(result.outcome, 'ignored');
  assert.equal(result.endsCombat, false);
});

test('bribery works on the bribeable and is unavailable elsewhere', () => {
  let bought = 0;
  for (let i = 0; i < 200; i++) {
    const r = resolveHail(new RNG(BigInt(i)), 'bribe', { factionId: 'ferengi', standing: 10, enemyHullPct: 0.5 });
    if (r.outcome === 'bought_off') bought++;
  }
  assert.ok(bought > 100, `expected bribery to usually work on Ferengi, got ${bought}/200`);
});

// A hail's RESULT is not an ENDING, and nothing used to notice.
//
// `resolveHail` names what happened at the table — surrendered, bought_off,
// deterred. `Engagement.end` takes one of five endings and silently falls back
// on "routed" for anything it does not recognise, which is the ending that
// means "we drove them off in a fight" and pays accordingly. So every hail that
// ended a battle paid a battle's experience and a `combat_victory` reputation
// on top of the award the hail itself already carries.
//
// This is a structural test on purpose: a seventh hail outcome added later is
// not finished until it is mapped, and this fails until it is.
test('every hail outcome that ends a fight maps to a real ending', () => {
  const source = readFileSync(new URL('../src/sim/diplomacy.js', import.meta.url), 'utf8');
  // Every `outcome: '...'` resolveHail can return, read out of the file rather
  // than listed here, so the two cannot drift apart.
  const produced = [...source.matchAll(/outcome:\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(produced.length >= 6, `found only ${produced.length} hail outcomes`);

  for (const [result, ending] of Object.entries(HAIL_ENDING)) {
    assert.ok(produced.includes(result), `HAIL_ENDING maps '${result}', which nothing produces`);
    assert.ok(OUTCOMES.includes(ending), `'${result}' maps to '${ending}', which is not an ending`);
  }

  // The ones that do NOT end a fight need no mapping; the ones that do, do.
  //
  // This half used to be a tautology. It filtered `produced` through a
  // hand-typed Set of exactly the six keys of HAIL_ENDING, and then asserted
  // that each survivor was in HAIL_ENDING — so it checked only the entries
  // that were already there and could not fail. The doc comment on the table
  // says "a test asserts exactly that rather than trusting anyone to
  // remember", and until now it did not: a seventh outcome that ended a fight
  // would have been skipped past by the very filter meant to select it.
  //
  // The real predicate is `endsCombat` on the result, so that is what is read.
  // Anything not literally `false` counts, which keeps the conditional case —
  // `acknowledged` carries `endsCombat: !tier.hostile` and ends a fight
  // whenever the other side is not hostile.
  const endsAFight = new Set();
  for (const block of source.matchAll(/\{[^{}]*\}/g)) {
    if (!/endsCombat:/.test(block[0]) || /endsCombat:\s*false/.test(block[0])) continue;
    const named = block[0].match(/outcome:\s*'([a-z_]+)'/);
    if (named) endsAFight.add(named[1]);
  }
  // Prove the scrape found the shape before believing what it did not find.
  assert.ok(endsAFight.size >= 4,
    `only ${endsAFight.size} hail outcomes were found to end a fight — the scrape is broken, not the table`);

  const unmapped = [...endsAFight].filter((outcome) => !HAIL_ENDING[outcome]);
  assert.deepEqual(unmapped, [],
    `hail outcomes that end a fight with no ending mapped: ${unmapped.join(', ')}`);
});

test('talking your way out pays what the talking is worth, not a battle', () => {
  // Driven through `hail`, not through a hand-called `end`, because the bug
  // lived in the wiring between them.
  const tried = [];
  for (const option of ['bribe', 'negotiate', 'offer_aid', 'demand_surrender']) {
    let done = false;
    for (let seed = 1; seed <= 400 && !done; seed++) {
      const g = new Game({ seed: BigInt(seed) * 104729n });
      g.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS Talk' })], { name: 'Parley' });
      // Visibly winning, so demanding a surrender is a credible thing to do.
      for (const h of g.engagement.hostiles) h.hull = h.maxHull * 0.15;
      const before = g.progress.xp;
      const result = g.hail(option);
      if (!result?.endsCombat) continue;
      g.update(1 / 30);
      done = true;
      tried.push(option);

      assert.equal(g.lastCombat?.outcome, 'parley',
        `${option} ended the fight as '${g.lastCombat?.outcome}'`);
      assert.equal(Math.round(g.progress.xp - before), result.xp,
        `${option} paid ${Math.round(g.progress.xp - before)} where the hail is worth ${result.xp}`);
      // And no salvage: you agreed to stand down, not to strip their dead.
      assert.equal(g.wreck, null, `${option} left a wreck behind`);
      assert.equal(g.engagement, null, `${option} left the engagement behind`);
    }
  }
  assert.equal(tried.length, 4, `only ${tried.join(', ')} ever succeeded`);
});

test('the after-action record knows whether anybody actually fired', () => {
  // The panel says "Nobody fired a shot" after a parley, and until this counter
  // existed there was no way to tell that apart from a parley reached after two
  // minutes of shooting. A message that cannot be wrong is worth four lines.
  const quiet = new Game({ seed: 5150n });
  quiet.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS Quiet' })], { name: 'Quiet' });
  quiet.engagement.end('parley');
  quiet.update(1 / 30);
  assert.equal(quiet.lastCombat.shotsFired, 0, 'shots were counted in a fight nobody fought');

  const loud = new Game({ seed: 5150n });
  loud.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS Loud' })], { name: 'Loud' });
  const eng = loud.engagement;
  for (const h of eng.hostiles) { h.x = 200; h.y = 0; h.z = 0; }
  loud.ship.x = 0; loud.ship.y = 0; loud.ship.z = 0; loud.ship.heading = 0;
  for (let t = 0; t < 90; t++) { eng.fireAll(); loud.update(1 / 30); }
  const fired = eng.shotsFired;
  assert.ok(fired > 0, 'a fight full of shooting counted none');
  eng.end('parley');
  loud.update(1 / 30);
  assert.equal(loud.lastCombat.shotsFired, fired,
    'the record disagrees with the fight it describes');
});

// ---------------------------------------------------------------- orders

test('the order parser handles a full natural course order', () => {
  const o = parseOrder('Helm, set course for Vulcan, warp eight');
  assert.equal(o.action, 'course');
  assert.equal(o.system, 'vulcan');
  assert.equal(o.warp, 8);
});

test('the order parser handles terse forms', () => {
  const o = parseOrder('warp 9 to Bajor');
  assert.equal(o.action, 'course');
  assert.equal(o.system, 'bajor');
  assert.equal(o.warp, 9);
});

test('the order parser understands the tactical vocabulary', () => {
  assert.equal(parseOrder('red alert').level, 'red');
  assert.equal(parseOrder('shields up').up, true);
  assert.equal(parseOrder('lower shields').up, false);
  assert.equal(parseOrder('fire torpedoes').weaponType, 'torpedo');
  assert.equal(parseOrder('target their engines').subsystem, 'engines');
  assert.equal(parseOrder('target their warp core').subsystem, 'warpcore');
  assert.equal(parseOrder('divert power to shields').subsystem, 'shields');
  assert.equal(parseOrder('all power to weapons').amount, 100);
  assert.equal(parseOrder('all stop').value, 0);
  // A third, not the two-decimal approximation the regex table used to return.
  assert.ok(Math.abs(parseOrder('ahead one third').value - 1 / 3) < 1e-9);
  assert.equal(parseOrder('open a channel').action, 'hail');
  assert.equal(parseOrder('damage report').action, 'status');
  assert.equal(parseOrder('eject the warp core').action, 'eject_core');
});

test('the order parser recognises officer abilities by their spoken phrase', () => {
  assert.equal(parseOrder('attack pattern alpha').ability, 'attack_pattern_alpha');
  assert.equal(parseOrder('emergency power to shields').ability, 'emergency_power_shields');
});

test('a phrase that is both an ability and a plain order carries a fallback', () => {
  // "Evasive manoeuvres" is a bridge officer power, but if nobody aboard has
  // trained it the order must still reach the helm.
  const o = parseOrder('evasive manoeuvres');
  assert.equal(o.action, 'ability');
  assert.equal(o.ability, 'evasive_maneuvers');
  assert.equal(o.fallback?.action, 'evasive');
  assert.equal(o.fallback?.value, true);
});

test('the order parser reports what it does not understand', () => {
  assert.ok(parseOrder('qwertyuiop asdfghjkl zxcvbnm').unknown);
  assert.ok(parseOrder('').unknown);
});

test('a verb it knows with an object it does not gets a question, not silence', () => {
  // "Make me a sandwich" is understood perfectly well as a build order. What
  // it lacks is something the shop can build, and the engineer saying so is a
  // better answer than the computer pretending not to have heard.
  const r = parseOrder('make me a sandwich');
  assert.equal(r.unknown, undefined);
  assert.match(r.error ?? '', /Build what/);
});

test('the parser strips forms of address', () => {
  for (const phrase of ['Mister Sulu, all stop', 'Number one, all stop', 'all stop']) {
    assert.equal(parseOrder(phrase).value, 0, phrase);
  }
});

// ---------------------------------------------------------------- game

test('a new game starts in a coherent state', () => {
  const g = new Game({ seed: 1701n, crewMode: 'canon', era: 'tos' });
  assert.equal(g.locationId, 'sol');
  assert.ok(g.crew.living.length >= 6);
  assert.equal(g.ship.hullPct, 1);
  assert.ok(g.availableMissions().length > 0, 'there is something to do at Sol');
});

test('setting a course consumes antimatter and enters transit', () => {
  const g = new Game({ seed: 1702n, crewMode: 'original' });
  const before = g.ship.antimatter;
  const r = g.setCourse('vulcan', 8);
  assert.ok(r.ok);
  assert.ok(g.ship.antimatter < before);
  assert.equal(g.mode, 'transit');
});

test('a full save round-trips', () => {
  const g = new Game({ seed: 1703n, crewMode: 'canon', era: 'tng' });
  g.progress.addXP(4000, { ledger: g.ledger });
  g.ledger.record('colony_saved', { text: 'test' });
  g.ledger.adjustStanding('klingon', -30);
  g.ship.takeDamage(600, { bearing: 90, rng: g.rng });
  g.locationId = 'vulcan';
  g.clock.advanceStardate(12);

  const restored = Game.load(JSON.parse(JSON.stringify(g.save())));
  assert.equal(restored.locationId, 'vulcan');
  assert.equal(restored.clock.stardate, g.clock.stardate);
  assert.equal(restored.progress.xp, g.progress.xp);
  assert.equal(restored.ledger.standingOf('klingon'), g.ledger.standingOf('klingon'));
  assert.equal(restored.ledger.count('colony_saved'), 1);
  assert.equal(Math.round(restored.ship.hull), Math.round(g.ship.hull));
  assert.equal(Math.round(restored.ship.maxHull), Math.round(g.ship.maxHull));
  assert.equal(restored.crew.living.length, g.crew.living.length);
  for (const f of FACINGS) {
    assert.equal(Math.round(restored.ship.shields[f]), Math.round(g.ship.shields[f]), f);
  }
});

test('the game ticks for a long stretch without throwing', () => {
  const g = new Game({ seed: 1704n, crewMode: 'original' });
  g.setCourse('archanis', 8);
  for (let i = 0; i < 20000; i++) g.update(1 / 30);
  assert.ok(g.clock.stardate > 4523.3, 'time passed');
});

test('docking repairs the ship and replaces the crew', () => {
  const g = new Game({ seed: 1705n, crewMode: 'original' });
  g.ship.shieldsUp = false;
  g.ship.takeDamage(2000, { bearing: 0, rng: g.rng });
  const damagedHull = g.ship.hull;
  const r = g.dock();
  assert.ok(r.ok, 'Sol has a dock');
  assert.ok(g.ship.hull > damagedHull);
  assert.equal(g.ship.crew, g.ship.maxCrew);
});

test('combat losses are written to the ledger permanently', () => {
  const g = new Game({ seed: 1706n, crewMode: 'original' });
  const enemy = new Ship('orion_raider', { faction: 'orion', name: 'Test Raider' });
  g.startCombat([enemy]);
  enemy.destroy('test');
  g.finishCombat('victory');
  assert.equal(g.ledger.destroyedShips.length, 1);
  assert.ok(g.ledger.standingOf('orion') < 0);
});

// ================================================================ the arena
//
// These exist because fuzzing 220 engagements produced one that never ended: a
// Jem'Hadar attack ship at 13% hull ran to 64,574 units — twenty-one times the
// tactical volume and fifty-four times the longest weapon range — was never
// flagged as fleeing, and so satisfied no end condition. It could not be
// reached and could not reach us. That is survivable when you can disengage,
// and a permanent soft-lock when you cannot: the Tholian web and the Kobayashi
// Maru both set canWarpOut = false.

test('nothing can leave the tactical arena', () => {
  const g = new Game({ seed: 41n, crewMode: 'original' });
  g.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Bortas' })]);
  const eng = g.engagement;
  const runner = eng.hostiles[0];

  // Point it straight out and hold the throttle down for ten minutes.
  runner.desiredHeading = 0;
  runner.heading = 0;
  for (let i = 0; i < 18000; i++) {
    runner.throttle = 1;
    runner.desiredHeading = 0;
    g.update(1 / 30);
    if (eng.over) break;
  }

  const out = Math.hypot(runner.x, runner.y, runner.z ?? 0);
  assert.ok(out <= ARENA_RADIUS * 1.05,
    `a hostile reached ${Math.round(out)} units; the arena is ${ARENA_RADIUS}`);
});

test('a fight nobody can reach ends instead of running forever', () => {
  const g = new Game({ seed: 42n, crewMode: 'original' });
  g.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Bortas' })]);
  const eng = g.engagement;
  // Put it well beyond any weapon, which is the state the fuzzer found.
  const far = eng.hostiles[0];
  far.x = 60000; far.y = 0; far.z = 0;

  for (let i = 0; i < 3000 && !eng.over; i++) g.update(1 / 30);
  assert.equal(eng.over, true, 'the engagement never resolved');
  assert.equal(eng.outcome, 'routed');
});

test('an unreachable hostile still ends a fight you are not allowed to leave', () => {
  // The soft-lock proper. Webbed, and the only hostile has run out of reach.
  const g = new Game({ seed: 43n, crewMode: 'original' });
  g.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Bortas' })]);
  const eng = g.engagement;
  eng.canWarpOut = false;
  eng.webbed = true;
  eng.hostiles[0].x = 60000;

  for (let i = 0; i < 3000 && !eng.over; i++) g.update(1 / 30);
  assert.equal(eng.over, true, 'no way to win, no way to leave, and it never ended');
});

test('the web does not outlive the ship that spun it', () => {
  const g = new Game({ seed: 44n, crewMode: 'original' });
  g.startCombat([
    new Ship('tholian_web_spinner', { faction: 'tholian', name: 'Lattice Warden' }),
    new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Bortas' }),
  ]);
  const eng = g.engagement;
  eng.webbed = true;
  eng.canWarpOut = false;

  // Kill the spinner; the other hostile keeps the fight going.
  eng.hostiles[0].destroyed = true;
  for (let i = 0; i < 200 && !eng.over; i++) g.update(1 / 30);

  assert.equal(eng.webbed, false, 'the web survived its caster');
  assert.equal(eng.canWarpOut, true, 'still pinned by a ship that no longer exists');
});

// =============================================================== withdrawal

// Fleeing had no exit. A ship broke off, cloaked, outran you, and then stayed
// on the board as a live hostile for the rest of the engagement — blocking
// every end condition that asks whether any hostile is left.
// "All hostiles fleeing" already ended a fight where everyone ran. The gap was
// the mix: one ship breaks off while another keeps fighting, and the runner
// then sits on the board forever — unreachable, unkillable, and enough on its
// own to stop the engagement resolving.
test('a hostile that breaks off and gets clear actually leaves', () => {
  const g = new Game({ seed: 77n, crewMode: 'original' });
  g.startCombat([
    new Ship('bird_of_prey', { name: 'IKS Runner' }),
    new Ship('d7', { name: 'IKS Stayer' }),
  ]);
  const eng = g.engagement;
  const [runner, stayer] = eng.hostiles;
  const park = (ship, range) => {
    ship.x = eng.player.x + range; ship.y = eng.player.y; ship.z = eng.player.z ?? 0;
    ship.throttle = 0;
  };

  runner.fleeing = true;
  eng.setTarget(runner);

  // Just short of the threshold the runner is still in the fight.
  for (let t = 0; t < Math.floor(WITHDRAW_SECONDS * 30) - 4; t++) {
    park(runner, MAX_WEAPON_RANGE + 400);
    park(stayer, 400);
    eng.update(1 / 30);
  }
  assert.equal(eng.over, false, 'the fight ended before the runner was clear');
  assert.equal(runner.withdrawn ?? false, false, 'the runner left too early');

  for (let t = 0; t < 60; t++) {
    park(runner, MAX_WEAPON_RANGE + 400);
    park(stayer, 400);
    eng.update(1 / 30);
  }
  assert.equal(runner.withdrawn, true, 'the runner never got away');
  assert.equal(eng.over, false, 'one ship leaving ended a fight the other was still in');
  assert.equal(eng.target, stayer, 'the reticle stayed locked on a ship that had gone');
  assert.deepEqual(eng.liveHostiles, [stayer]);

  // And with the last one gone under its own power, it is a rout, not a kill.
  stayer.fleeing = true;
  for (let t = 0; t < 60; t++) eng.update(1 / 30);
  assert.equal(eng.outcome, 'routed', 'letting them run counted as destroying them');
});

test('a hostile that stays in range is not treated as having withdrawn', () => {
  const g = new Game({ seed: 78n, crewMode: 'original' });
  g.startCombat([new Ship('bird_of_prey', { name: 'IKS Stubborn' })]);
  const eng = g.engagement;
  const s = eng.hostiles[0];
  s.fleeing = true;
  s.throttle = 0;

  for (let t = 0; t < 30 * 30; t++) {
    s.x = eng.player.x + 200; s.y = eng.player.y; s.z = eng.player.z ?? 0;
    if (eng.over) break;
    eng.update(1 / 30);
  }
  assert.equal(s.withdrawn ?? false, false, 'a ship 200 units away was allowed to escape');
});

test('destroying every hostile is still a victory, not a rout', () => {
  const g = new Game({ seed: 79n, crewMode: 'original' });
  g.startCombat([new Ship('bird_of_prey', { name: 'IKS Doomed' })]);
  const eng = g.engagement;
  eng.hostiles[0].destroy('test');
  eng.update(1 / 30);
  assert.equal(eng.outcome, 'victory');
});

// ============================================================== fight fuzzing

// Fuzzing 220 engagements once turned up one that never ended: a Jem'Hadar
// attack ship at 13% hull ran to 64,574 units — 21x the tactical volume and 54x
// the longest weapon range. It was never flagged `fleeing`, so "all hostiles
// routed" never fired; it could not be reached and could not reach us. Paired
// with a Tholian web (which revokes warp-out) that is a permanent soft-lock.
//
// This test is the standing proof that fights terminate. It drives the player
// as a player would — an idle captain against an unarmed freighter is a
// standoff by construction and proves nothing.
test('every fight ends, and nothing leaves the arena', () => {
  // Derived, not remembered. This was eleven hostiles of eighteen and four
  // difficulties of twelve, under a title that says "every fight" — so seven
  // hulls and eight rungs of the ladder had never once been driven to an end
  // condition by the test whose whole subject is that fights terminate.
  const HOSTILES = SHIP_LIST.filter((c) => c.faction !== 'federation').map((c) => c.id);
  const DIFFS = DIFFICULTIES.map((d) => d.id);
  let maxRadius = 0;
  const unresolved = [];

  for (let i = 0; i < 216; i++) {
    const seed = BigInt(31000 + i);
    const id = HOSTILES[i % HOSTILES.length];
    const g = new Game({ seed, crewMode: 'original', difficulty: DIFFS[i % DIFFS.length] });
    const count = 1 + (i % 3);
    g.startCombat(Array.from({ length: count }, (_, k) => new Ship(id, { name: `Hostile ${k + 1}` })));
    const eng = g.engagement;

    for (let t = 0; t < 30000 && !eng.over; t++) {
      if (!eng.target || eng.target.destroyed) eng.cycleTarget();
      const mark = eng.target ?? eng.liveHostiles[0];
      if (mark) eng.comeAboutTo(mark);
      eng.setThrottle(1);
      eng.fireAll();
      g.update(1 / 30);
      for (const s of [eng.player, ...eng.hostiles]) {
        maxRadius = Math.max(maxRadius, Math.hypot(s.x, s.y, s.z ?? 0));
        assert.ok(Number.isFinite(s.x + s.y + (s.z ?? 0) + s.heading + s.hull),
          `${id} went non-finite at seed ${seed}`);
      }
    }
    if (!eng.over) unresolved.push(`${id} x${count} @ ${seed}`);
  }

  assert.deepEqual(unresolved, [], 'fights that never ended');
  assert.ok(maxRadius <= ARENA_RADIUS + 1,
    `a ship reached ${Math.round(maxRadius)} units, outside the ${ARENA_RADIUS}-unit arena`);
});

// ============================================================= number hygiene

// `Math.max(0, Math.min(1, NaN))` is NaN. Every clamp in the simulation was
// written that way, so a single bad number walked straight through and poisoned
// whatever it touched — and a ship whose position is NaN never recovers, in any
// engagement, for the rest of the save. It is the most complete soft-lock in
// the game and it costs one guard to make impossible.
//
// The parser does not produce these (20,000 hostile inputs, zero non-finite
// values in any order it returned). Saves, arithmetic edge cases and future
// callers can, and the sim should not be one bad number away from unusable.
const HOSTILE_NUMBERS = [Infinity, -Infinity, NaN, 1e308, -1e308, 1e-320];

const shipIsSane = (ship, label) => {
  for (const k of ['x', 'y', 'z', 'heading', 'pitch', 'throttle', 'hull']) {
    assert.ok(Number.isFinite(ship[k] ?? 0), `${label} left ship.${k} = ${ship[k]}`);
  }
  for (const f of FACINGS) {
    assert.ok(Number.isFinite(ship.shields[f]), `${label} left shields.${f} = ${ship.shields[f]}`);
  }
  assert.ok(ship.hull >= 0, `${label} left hull at ${ship.hull}`);
};

const inCombat = () => {
  const g = new Game({ seed: 999n, crewMode: 'original' });
  g.startCombat([new Ship('d7', { name: 'IKS Control' })]);
  return g;
};

test('helm orders cannot be poisoned by a bad number', () => {
  for (const v of HOSTILE_NUMBERS) {
    for (const [name, apply] of [
      ['setThrottle', (g) => g.engagement.setThrottle(v)],
      ['setHeading', (g) => g.engagement.setHeading(v)],
      ['setPitch', (g) => g.engagement.setPitch(v)],
    ]) {
      const g = inCombat();
      apply(g);
      for (let t = 0; t < 60; t++) g.update(1 / 30);
      shipIsSane(g.ship, `${name}(${v})`);
    }
    const g = inCombat();
    g.engagement.setThrottle(v);
    assert.ok(g.ship.throttle >= 0 && g.ship.throttle <= 1,
      `setThrottle(${v}) left throttle at ${g.ship.throttle}`);
  }
});

test('power routing cannot be poisoned by a bad number', () => {
  for (const v of HOSTILE_NUMBERS) {
    const g = inCombat();
    g.ship.power.set('weapons', v);
    for (const k of Object.keys(g.ship.power.target)) {
      const p = g.ship.power.target[k];
      assert.ok(Number.isFinite(p) && p >= 0 && p <= 100,
        `power.set(weapons, ${v}) left ${k} at ${p}`);
    }
  }
});

test('damage and repair cannot be poisoned by a bad number', () => {
  for (const v of HOSTILE_NUMBERS) {
    const a = inCombat();
    a.ship.takeDamage(v, { direction: 0, type: 'beam', rng: a.rng });
    shipIsSane(a.ship, `takeDamage(${v})`);

    const b = inCombat();
    b.ship.repair(v);
    shipIsSane(b.ship, `repair(${v})`);
    assert.ok(b.ship.hull <= b.ship.maxHull + 1e-9, `repair(${v}) overfilled the hull`);
  }
});

test('a wreck cannot be repaired back into a ship', () => {
  // Found by widening the API fuzzer to end fights every legal way rather than
  // three of the five. `repair()` added hull to whatever it was called on, so
  // a destroyed hull under damage control came back flagged `destroyed` with
  // hull left — the one state `ship.destroyed.hull` exists to forbid, and the
  // fuzzer's report was blunter than that: "a save loaded broken".
  const s = new Ship('constitution', { isPlayer: true, name: 'Enterprise' });
  s.destroy('test');
  assert.equal(s.hull, 0, 'destroy() left hull behind');

  s.repair(7);
  assert.ok(s.destroyed, 'a repair un-destroyed the ship');
  assert.equal(s.hull, 0, `repair() gave a wreck ${s.hull} hull back`);

  // And it stays broken through the save, which is what made this more than a
  // tidy-up: the corrupt ship persisted into the record.
  const reloaded = Ship.load(s.save());
  assert.ok(!(reloaded.destroyed && reloaded.hull > 1e-6),
    `a destroyed ship saved with ${reloaded.hull} hull`);

  // `restore()` is the way back, and it clears the flag rather than papering
  // over it — the distinction the repair guard depends on.
  s.restore();
  assert.ok(!s.destroyed, 'restore() left the ship flagged destroyed');
  assert.equal(s.hull, s.maxHull);
});

test('shield reinforcement cannot be poisoned by a bad number', () => {
  for (const v of HOSTILE_NUMBERS) {
    const g = inCombat();
    g.ship.reinforceShield('fore', v);
    shipIsSane(g.ship, `reinforceShield(fore, ${v})`);
    for (const f of FACINGS) {
      assert.ok(g.ship.shields[f] >= -1e-9 && g.ship.shields[f] <= g.ship.maxShield * 1.2 + 1e-6,
        `reinforceShield(fore, ${v}) left ${f} at ${g.ship.shields[f]}`);
    }
  }
});

test('a decoy cannot be poisoned by a bad number', () => {
  for (const v of HOSTILE_NUMBERS) {
    const g = inCombat();
    g.engagement.deployDecoy(v);
    for (let t = 0; t < 60; t++) g.update(1 / 30);
    assert.ok(Number.isFinite(g.engagement.decoyTimer),
      `deployDecoy(${v}) left decoyTimer = ${g.engagement.decoyTimer}`);
    shipIsSane(g.ship, `deployDecoy(${v})`);
  }
});

// ============================================================ travel numbers

// travelHours and fuelCost feed the stardate and the antimatter reserve. A NaN
// in either is the same unrecoverable class as a NaN position: it is written to
// the save, and every later arithmetic on it stays NaN.
//
// Nothing in normal play reaches these — plotTransit derives distance from
// system coordinates and the parser clamps warp factors to 1..9.9, and 4,680
// plotted routes across all 40 systems produced no bad value. This is the same
// defence in depth as the helm orders: a distance is never negative, a duration
// is never negative, and neither is ever NaN.
test('travel arithmetic survives numbers it should never see', () => {
  const HOSTILE = [0, -1, -1e9, 1e308, Infinity, -Infinity, NaN, 1e-320];
  for (const factor of HOSTILE) {
    const speed = warpSpeed(factor);
    assert.ok(Number.isFinite(speed) && speed >= 1,
      `warpSpeed(${factor}) = ${speed}`);

    for (const ly of HOSTILE) {
      const hours = travelHours(ly, factor);
      assert.ok(Number.isFinite(hours), `travelHours(${ly}, ${factor}) = ${hours}`);
      assert.ok(hours >= 0, `travelHours(${ly}, ${factor}) = ${hours}, negative`);

      const fuel = fuelCost(ly, factor);
      assert.ok(Number.isFinite(fuel), `fuelCost(${ly}, ${factor}) = ${fuel}`);
      assert.ok(fuel >= 0, `fuelCost(${ly}, ${factor}) = ${fuel}, negative`);
    }
  }
});

test('a zero or negative efficiency does not make travel free or infinite', () => {
  for (const eff of [0, -1, NaN, Infinity]) {
    const hours = travelHours(10, 6, eff);
    const fuel = fuelCost(10, 6, eff);
    assert.ok(Number.isFinite(hours) && hours > 0, `travelHours(10, 6, ${eff}) = ${hours}`);
    assert.ok(Number.isFinite(fuel) && fuel > 0, `fuelCost(10, 6, ${eff}) = ${fuel}`);
  }
});

test('faster warp never takes longer', () => {
  for (let ly = 1; ly <= 60; ly += 7) {
    let previous = Infinity;
    for (const factor of [1, 2, 3, 4, 5, 6, 7, 8, 9, 9.9]) {
      const hours = travelHours(ly, factor);
      assert.ok(hours <= previous + 1e-9,
        `warp ${factor} takes ${hours.toFixed(2)}h over ${ly} ly, longer than the slower factor's ${previous.toFixed(2)}h`);
      previous = hours;
    }
  }
});

// ---------------------------------------------------------- the warp switches
//
// "Warp eight" used to be an order the game acknowledged and then discarded:
// the helm said "warp eight standing by", nothing recorded it, and the next
// course was plotted at six. These assert the effect, not the acknowledgement.

test('the standing warp factor is what a course is actually plotted at', () => {
  const slow = new Game({ seed: 1801n, crewMode: 'canon', era: 'tos' });
  const fast = new Game({ seed: 1801n, crewMode: 'canon', era: 'tos' });

  slow.setWarpFactor(2);
  fast.setWarpFactor(8);
  assert.ok(slow.setCourse('vulcan').ok);
  assert.ok(fast.setCourse('vulcan').ok);

  assert.equal(slow.transit.warpFactor, 2);
  assert.equal(fast.transit.warpFactor, 8);
  assert.ok(fast.transit.totalHours < slow.transit.totalHours,
    `warp 8 took ${fast.transit.totalHours}h and warp 2 took ${slow.transit.totalHours}h`);
});

test('a factor the drive cannot reach is clamped, and says so', () => {
  const g = new Game({ seed: 1802n, crewMode: 'canon', era: 'tos' });
  const max = g.ship.cls.maxWarp;
  const r = g.setWarpFactor(9.9);
  assert.equal(r.factor, max, `asked for 9.9 on a warp-${max} drive and got ${r.factor}`);
  assert.equal(r.limited, true, 'the helm did not report that it was limited');
  assert.equal(g.warpFactor, max);
});

test('nonsense on the switch does not become a nonsense course', () => {
  const g = new Game({ seed: 1803n, crewMode: 'canon', era: 'tos' });
  for (const bad of [0, -4, NaN, undefined, 'eight', Infinity]) {
    g.setWarpFactor(bad);
    assert.ok(g.warpFactor >= 1 && g.warpFactor <= g.ship.cls.maxWarp,
      `${String(bad)} set the standing factor to ${g.warpFactor}`);
  }
});

test('the standing factor survives a save', () => {
  const g = new Game({ seed: 1804n, crewMode: 'canon', era: 'tos' });
  g.setWarpFactor(3);
  const restored = Game.load(JSON.parse(JSON.stringify(g.save())));
  assert.equal(restored.warpFactor, 3);
});

test('a record written before the switches existed still cruises at six', () => {
  const g = new Game({ seed: 1805n, crewMode: 'canon', era: 'tos' });
  const data = JSON.parse(JSON.stringify(g.save()));
  delete data.warpFactor;
  assert.equal(Game.load(data).warpFactor, 6);
});

// ---------------------------------------------------------------- orbit

test('standard orbit is a place the ship actually is', () => {
  const g = new Game({ seed: 4242 });
  assert.equal(g.orbit, null, 'a commission does not start in orbit');
  assert.equal(g.orbitBody, null);

  const r = g.enterOrbit();
  assert.ok(r.ok, r.error);
  assert.ok(g.orbitBody, 'the order succeeded and the ship is orbiting nothing');
  assert.equal(g.orbitBody.id, r.body.id);
  assert.match(g.orbitLabel, /Sol/, `the crew calls it "${g.orbitLabel}"`);
  // Never the star. You do not make standard orbit around a sun.
  assert.notEqual(g.orbitBody.kind, 'star');

  const again = g.enterOrbit();
  assert.ok(again.already, 'the order was taken twice and moved the ship');

  assert.ok(g.breakOrbit().ok);
  assert.equal(g.orbit, null);
  assert.ok(!g.breakOrbit().ok, 'breaking an orbit the ship is not in reported success');
});

test('a course cancels the orbit, and arriving does not restore it', () => {
  const g = new Game({ seed: 99 });
  g.enterOrbit();
  assert.ok(g.orbit);

  const dest = g.galaxy.systems.find((s) => s.id !== g.locationId);
  assert.ok(g.setCourse(dest.id).ok);
  assert.equal(g.orbit, null, 'the ship went to warp still holding an orbit');

  g.transit.elapsedReal = g.transit.realSeconds;
  g.arrive();
  assert.equal(g.orbit, null, 'arriving somewhere put the ship in orbit nobody ordered');
});

test('an orbit survives the save, and a stale one does not come back', () => {
  const g = new Game({ seed: 7 });
  g.enterOrbit();
  const wanted = g.orbit.bodyId;

  const back = Game.load(JSON.parse(JSON.stringify(g.save())));
  assert.equal(back.orbit?.bodyId, wanted, 'the ship came out of the save somewhere else');
  assert.equal(back.orbitBody?.id, wanted);

  // A record whose orbit belongs to a system the ship is not in restores to
  // station-keeping rather than to an orbit of a world light-years away.
  const raw = g.save();
  raw.orbit = { systemId: 'somewhere-else', bodyId: wanted };
  assert.equal(Game.load(JSON.parse(JSON.stringify(raw))).orbit, null);

  // As does one naming a body that does not exist.
  const bogus = g.save();
  bogus.orbit = { systemId: g.locationId, bodyId: 'sol:body:99' };
  assert.equal(Game.load(JSON.parse(JSON.stringify(bogus))).orbit, null);
});

test('the ship cannot make orbit at warp', () => {
  const g = new Game({ seed: 31 });
  const dest = g.galaxy.systems.find((s) => s.id !== g.locationId);
  g.setCourse(dest.id);
  const r = g.enterOrbit();
  assert.ok(!r.ok, 'the helm made orbit while the ship was between stars');
  assert.match(r.error, /warp/i);
});

test('"standard orbit" and "break orbit" are orders you can give', () => {
  const g = new Game({ seed: 11 });
  const enter = parseOrder('standard orbit', g);
  assert.equal(enter.action, 'orbit', JSON.stringify(enter));

  const leave = parseOrder('break orbit', g);
  assert.equal(leave.action, 'break_orbit', JSON.stringify(leave));

  // The two share every word but one, so this is the pair most at risk of
  // collapsing into each other.
  assert.equal(parseOrder('take us into orbit', g).action, 'orbit');
  assert.equal(parseOrder('get us out of orbit', g).action, 'break_orbit');

  // And neither has eaten the orders that were already there.
  assert.equal(parseOrder('get us out of here', g).action, 'warp_out');
  assert.equal(parseOrder('all stop', g).action, 'throttle');
});

// ---------------------------------------------------------- the transporter

test('beaming down needs an orbit, a room, and a world to stand on', () => {
  const g = new Game({ seed: 8080 });

  // Not in orbit: refused, and for that reason.
  let r = g.beamDown();
  assert.ok(!r.ok);
  assert.match(r.error, /orbit/i);

  g.enterOrbit();
  // In orbit but sitting on the bridge. This is the refusal that matters: the
  // game has no button that teleports the captain out of the chair.
  r = g.beamDown();
  assert.ok(!r.ok, 'beamed down from the bridge');
  assert.match(r.error, /transporter room/i);

  g.walk.enter('transporter');
  r = g.beamDown();
  assert.ok(r.ok, r.error);
  assert.ok(g.ashore, 'the order succeeded and the captain is still aboard');
  assert.equal(g.walk.roomId, 'surface');
  assert.equal(g.walk.room.name, r.label);
});

test('a gas giant has nothing to beam down to', async () => {
  const g = new Game({ seed: 5 });
  const sys = g.location;
  const { vista } = await import('../src/gfx/vista.js');
  const gas = vista(sys.id, sys.type).bodies.find((b) => b.kind === 'gas');
  if (!gas) return;   // not every system has one; the check is conditional
  g.enterOrbit(gas.id);
  g.walk.enter('transporter');
  const r = g.beamDown();
  assert.ok(!r.ok, 'the captain stood on a gas giant');
  assert.match(r.error, /no surface/i);
});

test('the surface is a real place, and it is the same place twice', () => {
  const g = new Game({ seed: 3 });
  g.enterOrbit();
  g.walk.enter('transporter');
  g.beamDown();

  const room = g.walk.room;
  assert.ok(room.surface === true);
  assert.ok(room.props.length > 5, 'a planet with nothing on it');
  assert.ok(room.exits.length === 0, 'the surface has a door in it');
  // You arrive where you were put down, not by a doorway.
  assert.ok(Math.hypot(g.walk.x, g.walk.z) < 1.5, 'materialised somewhere odd');

  const before = room.props.map((p) => p.at.join(','));
  g.beamUp();
  g.beamDown();
  assert.deepEqual(g.walk.room.props.map((p) => p.at.join(',')), before,
    'the same world was generated differently on the second visit');
});

test('beaming up puts the captain back on the pads', () => {
  const g = new Game({ seed: 61 });
  g.enterOrbit();
  g.walk.enter('transporter');
  g.beamDown();
  const r = g.beamUp();
  assert.ok(r.ok, r.error);
  assert.equal(g.walk.roomId, 'transporter');
  const [px, pz] = g.walk.room.padCentre;
  assert.ok(Math.hypot(g.walk.x - px, g.walk.z - pz) < 0.6, 'materialised by the door, not on the pads');
  assert.ok(!g.beamUp().ok, 'beamed up from the ship');
});

test('a captain saved on a planet is still on it when the game comes back', () => {
  const g = new Game({ seed: 77 });
  g.enterOrbit();
  g.walk.enter('transporter');
  g.beamDown();
  const label = g.walk.room.name;

  const back = Game.load(JSON.parse(JSON.stringify(g.save())));
  assert.ok(back.ashore, 'the save came back aboard');
  assert.equal(back.walk.room.name, label);

  // And a record that says "on the surface" without an orbit to hang it on
  // comes back aboard rather than standing on nothing.
  const raw = g.save();
  raw.orbit = null;
  assert.ok(!Game.load(JSON.parse(JSON.stringify(raw))).ashore);
});

test('the ship does not leave without the captain', () => {
  const g = new Game({ seed: 4242 });
  g.enterOrbit();
  g.walk.enter('transporter');
  assert.ok(g.beamDown().ok);

  // Both orders that would take the ship out from under a landing party.
  const broke = g.breakOrbit();
  assert.ok(!broke.ok, 'the ship broke orbit with the captain on the ground');
  assert.match(broke.error, /surface/i);

  const here = g.locationId;
  const elsewhere = g.galaxy.systems.find((s) => s.id !== here).id;
  const course = g.setCourse(elsewhere);
  assert.ok(!course.ok, 'the ship warped away with the captain on the ground');
  assert.match(course.error, /surface/i);

  // Nothing moved: still ashore, still in orbit, no transit running.
  assert.ok(g.ashore);
  assert.ok(g.orbit, 'the refused order cleared the orbit anyway');
  assert.equal(g.transit, null);
  assert.equal(g.locationId, here);

  // And once the captain is aboard, both orders work.
  assert.ok(g.beamUp().ok);
  assert.ok(g.setCourse(elsewhere).ok, 'the guard outlived the landing party');
});

test('a walker in a room that is not there reaches for nothing', () => {
  const g = new Game({ seed: 4243 });
  g.enterOrbit();
  g.walk.enter('transporter');
  g.beamDown();

  // Clear the generated world out from under the walker without moving it —
  // the state the fuzzer reached by other means, and the frame after it used
  // to throw rather than come back empty.
  g.walk.roomId = 'nowhere-at-all';
  assert.equal(g.walk.room, undefined);
  assert.equal(g.walk.nearestStation(), null);
  assert.equal(g.walk.nearestExit(), null);
  assert.doesNotThrow(() => g.walk.step({ move: [1, 0] }, 1 / 30));
  assert.doesNotThrow(() => g.update(1 / 30));
});

test('"beam down" and "energize" are opposite orders', () => {
  const g = new Game({ seed: 12 });
  assert.equal(parseOrder('beam down', g).action, 'beam_down');
  assert.equal(parseOrder('two to beam down', g).action, 'beam_down');
  assert.equal(parseOrder('energize', g).action, 'transport');
  assert.equal(parseOrder('beam us back', g).action, 'transport');
  // And neither has eaten walking to a compartment.
  assert.equal(parseOrder('take me down to sickbay', g).action, 'go_to_room');
});

// --------------------------------------------------- something on the planet

test('a world has things on it worth walking to', async () => {
  const { makeSurface, FEATURE_KINDS } = await import('../src/world/surface.js');
  const { ROOMS } = await import('../src/world/interiors.data.js');

  for (const kind of ['planet', 'desert', 'ice', 'moon']) {
    makeSurface({ id: `feat:${kind}`, kind, ordinal: 2 }, 'Test II');
    const stations = ROOMS.surface.stations;
    assert.ok(stations.length >= 2, `${kind}: only ${stations.length} features`);

    for (const f of stations) {
      // The three fields that turn scenery into gameplay.
      assert.ok(FEATURE_KINDS.includes(f.kind), `${f.id}: ${f.kind} is not a feature kind`);
      assert.ok(f.check, `${f.id} tests nothing`);
      assert.ok(f.hazard, `${f.id} risks nothing`);
      assert.ok(Object.keys(f.yield ?? {}).length > 0, `${f.id} gives nothing`);
      assert.equal(f.panel, 'survey');
      // Reachable: outside the pad, inside the walkable radius.
      const d = Math.hypot(f.at[0], f.at[1]);
      assert.ok(d > 3, `${f.id} is ${d.toFixed(1)} m from the beam-in point`);
      assert.ok(d < 15, `${f.id} is out past the walkable ground at ${d.toFixed(1)} m`);
    }
  }
});

test('a gas giant has nothing to walk to, because there is nowhere to stand', async () => {
  const { makeSurface } = await import('../src/world/surface.js');
  const { ROOMS } = await import('../src/world/interiors.data.js');
  makeSurface({ id: 'feat:gas', kind: 'gas', ordinal: 5 }, 'Test V');
  assert.equal(ROOMS.surface.stations.length, 0);
});

test('the same world has the same things on it every visit', async () => {
  const { makeSurface } = await import('../src/world/surface.js');
  const { ROOMS } = await import('../src/world/interiors.data.js');
  const shot = () => ROOMS.surface.stations.map((f) => `${f.kind}@${f.at.map((n) => n.toFixed(3))}`);
  makeSurface({ id: 'feat:stable', kind: 'planet', ordinal: 1 }, 'Test I');
  const first = shot();
  makeSurface({ id: 'feat:other', kind: 'planet', ordinal: 1 }, 'Other I');
  makeSurface({ id: 'feat:stable', kind: 'planet', ordinal: 1 }, 'Test I');
  assert.deepEqual(shot(), first, 'the world rearranged itself between visits');
});

test('surveying takes a real check and pays out once', () => {
  const g = new Game({ seed: 909 });
  g.enterOrbit();
  g.walk.enter('transporter');
  assert.ok(g.beamDown().ok);

  const feature = g.walk.room.stations[0];
  assert.ok(feature, 'nothing to survey');
  const before = { ...g.stores };

  const r = g.surveyFeature(feature.id);
  assert.ok(r.ok, r.error);
  // A real resolution, with the arithmetic the rest of the game shows.
  assert.ok(typeof r.result.success === 'boolean');
  assert.ok(Array.isArray(r.result.parts) && r.result.parts.length > 0,
    'the survey produced no itemised modifier');

  if (r.result.success) {
    const gained = Object.entries(feature.yield)
      .some(([m, n]) => (g.stores[m] ?? 0) === (before[m] ?? 0) + n);
    assert.ok(gained, 'a successful survey put nothing in the hold');
  }

  // And it is done. A seam you have already cut out is not a seam.
  const again = g.surveyFeature(feature.id);
  assert.ok(!again.ok && again.done, 'the same feature paid out twice');
});

test('you cannot survey from the bridge', () => {
  const g = new Game({ seed: 12 });
  const r = g.surveyFeature('feature0');
  assert.ok(!r.ok);
  assert.match(r.error, /surface/i);
});

// ------------------------------------------------- episodes where you are

test('a stage will not resolve from the wrong place', async () => {
  // An episode used to be a screen you were teleported to. A stage that says it
  // happens on the surface has to actually happen on the surface — otherwise
  // "beam down and see" is a sentence in a text box rather than a thing you do.
  const { INTENTS } = await import('../src/lang/lexicon.js');
  const choice = INTENTS.find((i) => i.id === 'mission_choice');
  assert.ok(choice, 'there is no way to pick a stage option by saying so');

  // Ordinals before cardinals: "the second one" contains the word "one", and a
  // single pass in order reads it as option one and picks the wrong thing in
  // the middle of an episode.
  assert.equal(choice.build({ text: 'option one' }).index, 0);
  assert.equal(choice.build({ text: 'the second one' }).index, 1);
  assert.equal(choice.build({ text: 'take the third' }).index, 2);
  assert.equal(choice.build({ text: 'go with the first' }).index, 0);
});

test('picking an option by voice takes the same path as pressing it', () => {
  const g = new Game({ seed: 4 });
  const ep = g.missions.episodes[0];
  assert.ok(ep);
  // Through the game rather than the book: `MissionBook.start` takes the game
  // as its second argument and a stage's effects reach for it.
  g.startMission(ep.id);
  const before = g.missions.active.stageId;
  const choices = g.missions.active.choices();
  assert.ok(choices.length > 0, 'a stage with nothing to decide');

  // The order carries an INDEX, because the parser cannot know what an episode
  // wrote in its labels — it can only count.
  const picked = choices[0];
  const r = g.chooseMission(picked.id);
  assert.ok(r, 'the choice did nothing');
  assert.notEqual(g.missions.active?.stageId ?? null, before,
    'the episode did not move on');
});

// ----------------------------------------- the power tray, without a screen

// Seventeen bridge officer abilities, seven career signatures and four
// devices. Every one of them used to be implemented inside src/main.js, which
// is to say inside the browser: headless they did not exist, so nothing below
// could have been written at all, the soak could never fire one, and the
// API fuzzer's `g.character?.useSignature?.(g)` was optional-chaining into
// nothing and passing for it.
//
// These assert the EFFECT of each power, not that the table has an entry.

/** A game in a fight, with one officer holding one named ability. */
function armed(abilityId, opts = {}) {
  const g = new Game({ seed: 4711n, crewMode: 'original', difficulty: 'commander', ...opts });
  g.startCombat([new Ship('d7', { name: 'Target' })], { relentless: true });
  const a = ABILITIES[abilityId];
  const officer = g.crew.at(a.dept === 'command' ? 'helm' : a.dept) ?? g.crew.living[0];
  if (!officer.abilities.includes(abilityId)) officer.abilities.push(abilityId);
  officer.cooldowns = {};
  return { g, officer };
}

const hasBuff = (ship, id) => (ship.buffs ?? []).some((b) => b.id === id);

test('every bridge officer ability can be fired without a screen', () => {
  for (const id of Object.keys(ABILITIES)) {
    const { g, officer } = armed(id);
    if (id === 'eject_core') g.ship.breaching = true;
    const r = g.useAbility(officer, id);
    assert.ok(r.ok, `${id} refused: ${r.reason}`);
    // Ejecting the core is the one power with no cooldown, because it is not
    // a thing you do twice: the ship's own guard stops that, not a timer.
    if (ABILITIES[id].cooldown > 0) {
      assert.ok(officer.cooldowns[id] > 0, `${id} started no cooldown`);
      assert.ok(!officer.ready(id), `${id} was ready again immediately`);
      assert.equal(g.useAbility(officer, id).ok, false, `${id} fired twice`);
    } else {
      assert.equal(g.ship.ejectCore(), false, `${id} could be done twice`);
    }
  }
});

test('an ability with modifiers puts them on the ship', () => {
  for (const [id, a] of Object.entries(ABILITIES)) {
    if (!a.mods) continue;
    const { g, officer } = armed(id);
    assert.ok(!hasBuff(g.ship, id), `${id} was already running`);
    g.useAbility(officer, id);
    assert.ok(hasBuff(g.ship, id), `${id} granted nothing`);
  }
});

test('the abilities that do a thing do the thing', () => {
  // Damage control teams put fires out.
  {
    const { g, officer } = armed('damage_control');
    g.ship.fires = 3;
    g.useAbility(officer, 'damage_control');
    assert.equal(g.ship.fires, 0, 'the fires were left burning');
  }
  // A tachyon sweep uncloaks whoever is out there.
  {
    const { g, officer } = armed('tachyon_sweep');
    const cloaky = g.engagement.liveHostiles[0];
    cloaky.cloakCapable = true;
    cloaky.cloaked = true;
    g.useAbility(officer, 'tachyon_sweep');
    assert.equal(cloaky.cloaked, false, 'they stayed cloaked through a tachyon sweep');
  }
  // Jamming their sensors lands on THEM, not on us.
  {
    const { g, officer } = armed('jam_sensors');
    g.useAbility(officer, 'jam_sensors');
    for (const s of g.engagement.liveHostiles) {
      assert.ok(hasBuff(s, 'jammed'), `${s.name} was not jammed`);
    }
    assert.ok(!hasBuff(g.ship, 'jammed'), 'we jammed ourselves');
  }
  // A scan comes back with something to read.
  {
    const { g, officer } = armed('scan_target');
    const r = g.useAbility(officer, 'scan_target');
    assert.equal(r.report?.kind, 'scan');
    assert.ok(r.report.lines.length >= 3, 'a scan that reported nothing');
  }
  // Rotating harmonics clears whatever the enemy had learned about us.
  {
    const { g, officer } = armed('shield_harmonics');
    g.engagement.hostiles[0].adaptation = { phaser: 0.4 };
    g.useAbility(officer, 'shield_harmonics');
    assert.deepEqual(g.engagement.hostiles[0].adaptation, {});
  }
  // Ejecting the core takes the core — and only when there is one to eject.
  {
    const { g, officer } = armed('eject_core');
    g.useAbility(officer, 'eject_core');
    assert.equal(g.ship.coreEjected, false, 'the core went out with nothing wrong');
    officer.cooldowns = {};
    g.ship.breaching = true;
    g.useAbility(officer, 'eject_core');
    assert.ok(g.ship.coreEjected || g.ship.destroyed, 'the core is still aboard');
  }
});

test('an ability nobody has is refused rather than fired', () => {
  const g = new Game({ seed: 12n, crewMode: 'original' });
  const stranger = g.crew.living[0];
  const unknown = Object.keys(ABILITIES).find((id) => !stranger.abilities.includes(id));
  assert.equal(g.useAbility(stranger, unknown).ok, false, 'an officer used a power they do not have');
  assert.equal(g.useAbility('nowhere', 'fire_at_will').ok, false, 'a station nobody mans gave an order');
  assert.equal(g.useAbility(null, 'not_an_ability').ok, false);
});

test('every career signature fires once, and only once, per engagement', () => {
  for (const career of CAREERS) {
    const g = new Game({
      seed: 909n, crewMode: 'original',
      character: new Character({ speciesId: 'human', careerId: career.id }),
    });
    g.startCombat([new Ship('d7', { name: 'Target' })], { relentless: true });
    const r = g.useSignature();
    assert.ok(r.ok, `${career.id}: ${r.reason}`);
    assert.ok(r.line, `${career.id} announced nothing`);
    assert.equal(g.character.signatureUsed, true);
    assert.equal(g.useSignature().ok, false, `${career.id} fired twice in one engagement`);
  }
});

test('each signature leaves its own mark', () => {
  const sig = (careerId, before) => {
    const g = new Game({
      seed: 55n, crewMode: 'original',
      character: new Character({ speciesId: 'human', careerId }),
    });
    g.startCombat([new Ship('d7', { name: 'Target' })], { relentless: true });
    before?.(g);
    const r = g.useSignature();
    assert.ok(r.ok, `${careerId}: ${r.reason}`);
    return g;
  };

  // Command: every station is ready again.
  {
    const g = sig('command', (game) => {
      for (const o of game.crew.officers) o.cooldowns = { anything: 30 };
    });
    for (const o of g.crew.officers) {
      assert.deepEqual(o.cooldowns, {}, `${o.name} was left on cooldown`);
    }
  }
  // Tactical: a guaranteed crit is banked and a subsystem chosen.
  {
    const g = sig('tactical');
    assert.ok(g.engagement.guaranteedCrits >= 1);
    assert.ok(g.engagement.targetedSubsystem, 'called shot at nothing in particular');
  }
  // Engineering: hull back, fires out.
  {
    const g = sig('engineering', (game) => {
      game.ship.hull = game.ship.maxHull * 0.4;
      game.ship.fires = 2;
    });
    assert.ok(g.ship.hullPct > 0.6, `hull only reached ${g.ship.hullPct}`);
    assert.equal(g.ship.fires, 0);
  }
  // Science and Intelligence and Medical each hang a buff on the ship.
  for (const [careerId, buffId] of [
    ['science', 'insight'], ['intelligence', 'prior_knowledge'], ['medical', 'triage'],
  ]) {
    const g = sig(careerId);
    assert.ok((g.ship.buffs ?? []).some((b) => b.id === buffId),
      `${careerId} granted no ${buffId}`);
  }
  // Medical also gets somebody back on their feet.
  {
    const g = sig('medical', (game) => { game.crew.living[0].injure(0.5); });
    assert.ok(!g.crew.officers.some((o) => o.alive && o.injured),
      'the wounded officer stayed in sickbay');
  }
  // Diplomatic forces the channel and says who to open it with.
  {
    const g = sig('diplomatic');
    assert.equal(g.parleyForced, true);
    assert.ok(g.useSignature().ok === false);
  }
  // Intelligence also sets their weapons back.
  {
    const g = sig('intelligence');
    for (const s of g.engagement.liveHostiles) {
      for (const w of s.weapons) assert.ok(w.cooldown >= 6, `${s.name} could still shoot`);
    }
  }
});

test('a signature that needs a fight is refused outside one', () => {
  for (const careerId of ['tactical', 'diplomatic']) {
    const g = new Game({
      seed: 3n, crewMode: 'original',
      character: new Character({ speciesId: 'human', careerId }),
    });
    assert.equal(g.useSignature().ok, false, `${careerId} fired on a quiet bridge`);
    assert.equal(g.character.signatureUsed, false, `${careerId} was spent on nothing`);
  }
});

test('devices are spent, and spending one does something', () => {
  const g = new Game({ seed: 71n, crewMode: 'original' });
  g.startCombat([new Ship('d7', { name: 'Target' })], { relentless: true });

  // Whatever the loadout starts with, each device is checked on its own terms.
  const effects = {
    shield_battery: (game) => {
      for (const f of FACINGS) game.ship.shields[f] = 0;
      return () => assert.ok(game.ship.shields.fore > 0, 'the battery charged nothing');
    },
    weapons_battery: (game) => () =>
      assert.ok((game.ship.buffs ?? []).some((b) => b.id === 'weapons_battery')),
    engine_battery: (game) => () =>
      assert.ok((game.ship.buffs ?? []).some((b) => b.id === 'engine_battery')),
    hull_patch: (game) => {
      game.ship.hull = game.ship.maxHull * 0.5;
      game.ship.fires = 2;
      return () => {
        assert.ok(game.ship.hullPct > 0.55, 'the patch patched nothing');
        assert.equal(game.ship.fires, 0);
      };
    },
    // The probe was the one device this test did not cover, and it is the one
    // with the most behind it: a pre-spend guard, a catalogue, XP, a survey
    // mark and reputation. Its own comment in sim/powers.js records that it
    // once "had no case at all below and fell through to the default, which
    // spends the device and logs 'probe discharged'" — so the device most
    // likely to break quietly was the device nothing checked.
    //
    // It needs something out there to probe. That is the guard, not an
    // accident of setup: a probe fired at empty space is refused before it is
    // spent.
    probe: (game) => {
      game.encounter = {
        kind: 'anomaly',
        system: { id: game.locationId },
        anomaly: { name: 'Test Rift', value: 2 },
      };
      const before = game.ledger.entries.length;
      return () => {
        assert.ok(game.ledger.entries.length > before, 'the probe catalogued nothing');
        assert.equal(game.ledger.entries.at(-1).kind, 'anomaly_catalogued');
        assert.equal(game.encounter, null, 'the anomaly is still out there after a full survey');
      };
    },
  };

  // Every device in the game, named from the loadout rather than from this
  // list. The list used to cover four of the five and the floor below was
  // `tried >= 3`, so the missing one could never have made this fail.
  const carried = Object.values(CONSOLES).filter((c) => c.slot === 'device').map((c) => c.id);
  assert.deepEqual(Object.keys(effects).sort(), [...carried].sort(),
    'a device the game carries that this test has no arrangement for');

  const tried = [];
  for (const [id, arrange] of Object.entries(effects)) {
    // Exactly one in the locker, regardless of what the starting loadout
    // rolled, so "spent" means something.
    g.loadout.equipped.device = [id];
    const check = arrange(g);
    const r = g.useDevice(id);
    assert.ok(r.ok, `${id} could not be used at all: ${r.reason}`);
    tried.push(id);
    check();

    // Re-arrange before asking again. The probe taught this: after a survey
    // the anomaly is gone, so a second attempt is refused for having nothing
    // to probe — which looks exactly like "the charge is spent" and proves
    // nothing about it. Set the world back up, and the refusal that comes back
    // is the empty locker.
    arrange(g);
    const again = g.useDevice(id);
    assert.equal(again.ok, false, `${id} was used twice from one charge`);
    assert.equal(again.reason, 'none left',
      `${id} was refused for "${again.reason}" rather than for being spent`);
  }
  assert.deepEqual(tried.sort(), [...carried].sort(), 'not every device was exercised');
});

// --------------------------------------------- breaking off a course under way

// "Drop out of warp" was a button in the Under Way panel and nothing else: it
// moved the ship, advanced the calendar, cleared the transit and set the mode,
// all inside src/ui/screens.js. So there was no way to abort a course without
// a screen, the system you stopped at was never marked visited, nothing was
// ever waiting there when you arrived — and the phrase printed on the button
// said "all stop", which at warp did something else entirely.

test('a course can be broken off, and it puts the ship somewhere real', () => {
  // A flight that is still running after twenty seconds. About 7% of courses
  // are interrupted by something finding the ship before then — measured at
  // 7.0% before the encounter stream changed and 7.5% after, which is the same
  // rate — so pinning one seed made this test's PRECONDITION a coin toss
  // rather than making it test anything. The sibling test below already skips
  // an interrupted flight for the same reason.
  let g = null;
  const stardateOf = (game) => game.clock.stardate;
  let stardate = 0;
  for (let seed = 4801; seed < 4830 && !g; seed++) {
    const candidate = new Game({ seed: BigInt(seed), crewMode: 'original' });
    const elsewhere = candidate.galaxy.systems.find((s) => s.id !== candidate.locationId).id;
    if (!candidate.setCourse(elsewhere, 6).ok) continue;
    stardate = stardateOf(candidate);
    // Part way there, so the nearest system is a real choice.
    for (let i = 0; i < 600 && candidate.transit; i++) candidate.update(1 / 30);
    if (candidate.transit) g = candidate;
  }
  assert.ok(g, 'no seed in thirty gave a flight still running after twenty seconds');

  const r = g.dropOutOfWarp();
  assert.ok(r.ok, r.error);
  assert.equal(g.transit, null, 'the ship is still under way');
  assert.ok(['bridge', 'encounter'].includes(g.mode), `left the game in ${g.mode}`);
  assert.equal(g.locationId, r.system.id);
  assert.ok(g.galaxy.visited.has(g.locationId), 'the ship stopped somewhere it has never been');
  assert.ok(g.clock.stardate > stardate, 'the flight took no time at all');
  assert.ok(g.log.some((l) => /impulse/i.test(l.text)), 'nobody said anything about it');
});

test('and it is refused when the ship is not going anywhere', () => {
  const g = new Game({ seed: 4802n, crewMode: 'original' });
  const r = g.dropOutOfWarp();
  assert.ok(!r.ok);
  assert.match(r.error, /under way/i);
});

test('breaking off leaves the game in a state the checker accepts', () => {
  // Twenty stops, at every point along a flight, checked against every rule.
  for (let at = 30; at <= 900; at += 90) {
    const g = new Game({ seed: BigInt(4900 + at), crewMode: 'original' });
    const elsewhere = g.galaxy.systems.find((s) => s.id !== g.locationId).id;
    if (!g.setCourse(elsewhere, 6).ok) continue;
    for (let i = 0; i < at && g.transit; i++) g.update(1 / 30);
    if (!g.transit) continue;
    assert.ok(g.dropOutOfWarp().ok);
    for (let i = 0; i < 120; i++) g.update(1 / 30);
    assert.deepEqual(checkAll(g, { arenaRadius: ARENA_RADIUS }), [],
      `breaking off at tick ${at} left the game broken`);
  }
});

// ------------------------------------ every station is a different station

// Medical and Operations had no abilities of their own, and `abilityPool`
// pointed them at Command's — so the doctor and the helmsman called attack
// patterns and four of the seven officers on a bridge held an identical tray.
// `learnStartingAbilities` then took `pool.slice(0, 3)`, a truncation rather
// than a rule, which made every officer of a department identical to every
// other and left six abilities held by nobody at all.

const DEPTS = ['command', 'tactical', 'operations', 'engineering', 'science', 'medical'];

test('every department has abilities of its own, and borrows none', () => {
  const seen = new Map();
  for (const dept of DEPTS) {
    const pool = abilityPool(dept);
    assert.ok(pool.length >= 3, `${dept} has ${pool.length} abilities of its own`);
    for (const a of pool) {
      assert.equal(a.dept, dept, `${a.id} is in ${dept}'s pool but belongs to ${a.dept}`);
      assert.equal(seen.has(a.id), false, `${a.id} is in both ${seen.get(a.id)} and ${dept}`);
      seen.set(a.id, dept);
    }
  }
  assert.equal(seen.size, Object.keys(ABILITIES).length, 'an ability belongs to no department');
});

test('nothing in the table is held by nobody', () => {
  // The test that would have failed for the whole life of this table.
  //
  // The rule it encodes is the one that replaced `pool.slice(0, 3)`: ranks one
  // and two are the working repertoire a bridge arrives with, and rank three
  // is what training opens up. So the only acceptable reason for an ability to
  // be unheld at commission is that it is rank three — and every rank three
  // must be trainable by somebody, or it is decoration.
  const g = new Game({ seed: 3131n, crewMode: 'canon', crew: 'tos' });
  const held = new Set(g.crew.officers.flatMap((o) => o.abilities));
  const trainable = new Set(g.crew.officers.flatMap((o) => g.trainableFor(o).map((a) => a.id)));

  const missing = ABILITY_LIST.filter((a) => a.rank <= 2 && !held.has(a.id)).map((a) => a.id);
  assert.deepEqual(missing, [], 'a working ability nobody on the bridge holds');

  const unteachable = ABILITY_LIST
    .filter((a) => a.rank >= 3 && !held.has(a.id) && !trainable.has(a.id))
    .map((a) => a.id);
  assert.deepEqual(unteachable, [], 'abilities nobody aboard can ever reach');
});

test('two officers on the same bridge are not the same officer', () => {
  const g = new Game({ seed: 3132n, crewMode: 'canon', crew: 'tos' });
  const trays = g.crew.officers.map((o) => o.abilities.join(','));

  // The helm and comms share a department, so some trays repeat; what must not
  // happen is one tray repeated across most of the bridge.
  const distinct = new Set(trays);
  assert.ok(distinct.size >= 5, `only ${distinct.size} distinct trays on seven stations`);

  // And the doctor does not fly the ship.
  const doc = g.crew.at('medical');
  assert.ok(doc.abilities.length > 0, 'the doctor has nothing to do');
  for (const id of doc.abilities) {
    assert.equal(ABILITIES[id].dept, 'medical', `the doctor knows ${id}, which is not medicine`);
  }
});

test('a green officer arrives with less than a veteran', () => {
  const green = new Officer({ station: 'tactical', name: 'Green', expertise: 40 });
  const veteran = new Officer({ station: 'tactical', name: 'Veteran', expertise: 95 });
  assert.ok(veteran.abilities.length > green.abilities.length,
    `green ${green.abilities.length}, veteran ${veteran.abilities.length}`);
  // Rank three is training's job on both of them.
  for (const o of [green, veteran]) {
    for (const id of o.abilities) {
      assert.ok(ABILITIES[id].rank <= 2, `${o.name} arrived knowing ${id}, which is rank three`);
    }
  }
});

test('every ability can be spoken, and none of them took an order that existed', () => {
  const g = new Game({ seed: 3133n, crewMode: 'original' });
  for (const a of Object.values(ABILITIES)) {
    const o = parseOrder(a.order, g);
    assert.equal(o?.action, 'ability', `"${a.order}" is not an ability order`);
    assert.equal(o.ability, a.id, `"${a.order}" reaches ${o.ability}, not ${a.id}`);
  }
  // The orders most at risk from the new phrasing: the career signatures own
  // "triage" and "look alive", and "battle stations" has always been an alert.
  for (const [said, action] of [
    ['triage', 'signature'], ['look alive', 'signature'], ['work a miracle', 'signature'],
    ['battle stations', 'alert'], ['take the conn', 'hand_over_con'],
    ['weapons battery', 'device'], ['all stop', 'throttle'],
  ]) {
    assert.equal(parseOrder(said, g).action, action, `"${said}"`);
  }
});

test('training an officer costs a day and only works when it should', () => {
  const g = new Game({ seed: 3134n, crewMode: 'canon', crew: 'tos' });
  const doc = g.crew.at('medical');
  const before = g.clock.stardate;
  const known = doc.abilities.length;

  const r = g.trainOfficer('medical', 'surgical_bay');
  assert.ok(r.ok, r.reason);
  assert.equal(doc.abilities.length, known + 1);
  assert.ok(doc.abilities.includes('surgical_bay'));
  assert.ok(g.clock.stardate > before, 'the training took no time at all');
  assert.ok(g.log.some((l) => /training/i.test(l.text)), 'nobody logged it');

  assert.equal(g.trainOfficer('medical', 'surgical_bay').ok, false, 'trained twice');
  assert.equal(g.trainOfficer('medical', 'high_yield').ok, false, 'the doctor trained as a gunner');
  assert.equal(g.trainOfficer('nowhere', 'high_yield').ok, false);
  assert.equal(g.trainOfficer('medical', 'not_an_ability').ok, false);

  // In sickbay, or gone, and the answer is no.
  doc.injure(0.5);
  assert.equal(g.trainOfficer('medical', 'surgical_bay').ok, false, 'trained from a biobed');

  // And it survives a save, which is the point of teaching somebody anything.
  const back = Game.load(JSON.parse(JSON.stringify(g.save())));
  assert.ok(back.crew.at('medical').abilities.includes('surgical_bay'));
});

test('training is gated on the captain, not the officer', () => {
  const g = new Game({ seed: 3135n, crewMode: 'canon', crew: 'tos' });
  g.progress.rankIndex = 0;   // Ensign: cleared for very little
  const low = g.trainableFor(g.crew.at('science'));
  g.progress.rankIndex = 8;   // and much later
  const high = g.trainableFor(g.crew.at('science'));
  assert.ok(high.length > low.length,
    `an ensign could train ${low.length} things, a flag officer ${high.length}`);
});

/** An officer holding a named ability, trained for it if they were not. */
function trained(g, station, abilityId) {
  const officer = g.crew.at(station);
  if (!officer.abilities.includes(abilityId)) {
    const r = g.trainOfficer(officer, abilityId);
    assert.ok(r.ok, `could not train ${station} in ${abilityId}: ${r.reason}`);
  }
  return officer;
}

test('the abilities that reach past the ship do reach past it', () => {
  // Hold Formation is the only power that speaks to an ally, and allies have
  // existed in `Engagement` since it was written with nothing to say to them.
  {
    const g = new Game({ seed: 3136n, crewMode: 'original' });
    const friend = new Ship('miranda', { faction: 'federation', name: 'USS Friend' });
    g.startCombat([new Ship('d7', { name: 'Target' })], { allies: [friend], relentless: true });
    const officer = trained(g, 'first_officer', 'hold_formation');
    const r = g.useAbility(officer, 'hold_formation');
    assert.ok(r.ok, r.reason);
    assert.ok((friend.buffs ?? []).some((b) => b.id === 'hold_formation'), 'the ally got nothing');
    assert.equal(r.report.allies, 1);
  }
  // A false signal throws out everybody's targeting solution.
  {
    const g = new Game({ seed: 3137n, crewMode: 'original' });
    g.startCombat([new Ship('d7', { name: 'A' }), new Ship('d7', { name: 'B' })], { relentless: true });
    for (const s of g.engagement.liveHostiles) { s.aiTarget = g.ship; for (const w of s.weapons) w.cooldown = 0; }
    const officer = trained(g, 'helm', 'false_signal');
    assert.ok(g.useAbility(officer, 'false_signal').ok);
    for (const s of g.engagement.liveHostiles) {
      assert.equal(s.aiTarget, null, `${s.name} kept its lock`);
      assert.ok(s.weapons.every((w) => w.cooldown > 0), `${s.name} could still shoot`);
      assert.ok((s.buffs ?? []).some((b) => b.id === 'reacquiring'));
    }
  }
  // Traffic analysis reads the whole board, which nothing else does.
  {
    const g = new Game({ seed: 3138n, crewMode: 'original' });
    g.startCombat([new Ship('d7', { name: 'A' }), new Ship('vorcha', { name: 'B' })], { relentless: true });
    const r = g.useAbility(trained(g, 'comms', 'traffic_analysis'), 'traffic_analysis');
    assert.ok(r.ok, r.reason);
    assert.equal(r.report.count, 2, 'the sweep missed a ship');
    assert.ok(r.report.lines.every((l) => /hull \d+%/.test(l)));
  }
});

test('the medical abilities are worth having, and act on people', () => {
  // Sickbay treats the wounded, and nothing else in a fight ever did: the
  // injured total climbs with every hull hit and only ever went up.
  {
    const g = new Game({ seed: 3139n, crewMode: 'canon', crew: 'tos' });
    g.startCombat([new Ship('d7', { name: 'Target' })], { relentless: true });
    g.trainOfficer('medical', 'surgical_bay');
    g.ship.injured = 200;
    const r = g.useAbility(g.crew.at('medical'), 'surgical_bay');
    assert.ok(r.ok, r.reason);
    assert.ok(g.ship.injured < 200, 'nobody was treated');
    assert.ok(r.report.treated > 0);
  }
  // And one officer is cleared for duty.
  {
    const g = new Game({ seed: 3140n, crewMode: 'canon', crew: 'tos' });
    g.startCombat([new Ship('d7', { name: 'Target' })], { relentless: true });
    g.crew.at('science').injure(0.5);
    assert.ok(g.crew.officers.some((o) => o.alive && o.injured));
    const r = g.useAbility(trained(g, 'medical', 'back_to_duty'), 'back_to_duty');
    assert.ok(r.ok, r.reason);
    assert.equal(g.crew.officers.some((o) => o.alive && o.injured), false, 'still in sickbay');
    assert.ok(r.report.officer, 'nobody was named');
  }
  // Casualty teams reduce what a hull hit costs in people.
  {
    const cost = (withTeams) => {
      const g = new Game({ seed: 3141n, crewMode: 'canon', crew: 'tos' });
      g.startCombat([new Ship('d7', { name: 'Target' })], { relentless: true });
      if (withTeams) {
        const r = g.useAbility(trained(g, 'medical', 'casualty_teams'), 'casualty_teams');
        assert.ok(r.ok, r.reason);
      }
      const before = g.ship.crew;
      g.ship.takeDamage(g.ship.maxHull * 0.3, { bypassShields: true });
      return before - g.ship.crew;
    };
    assert.ok(cost(true) < cost(false), 'casualty teams saved nobody');
  }
});

// ================================================== what the power grid buys

// Four channels, four one-tap presets, and one of them was a lie. Auxiliary is
// the sensor channel by every name the game gives it — the parser maps
// "sensors", "science", "computer" and "transporter" onto it, and the preset is
// labelled Science with the order phrase "power to auxiliary" — and it fed
// nothing but damage control. So the Science posture made the ship no better at
// science, which is the one thing its name promises.
//
// And the order that says "sensors" did not read the sensors either:
// `scanSystem` in main.js returned a constant list of facts about the system
// that no state of the array and no setting of the grid could change.

/** A ship at a named posture, ready to be measured. */
function atPosture(preset, { seed = 90n, systemId = 'devron' } = {}) {
  const g = new Game({ seed, crewMode: 'original' });
  g.locationId = systemId;
  g.ship.power.applyPreset(preset);
  // Levels ease toward the order at 55 units a second; measure the ship the
  // captain actually gets, not the one he asked for a tick ago.
  for (let i = 0; i < 30 * 10 && !g.ship.power.settled; i++) g.update(1 / 30);
  return g;
}

test('nominal power leaves the sensors exactly where they were', () => {
  // Not a guard: `sensorQuality` did not exist before, so this fails on the old
  // code for the uninteresting reason. What it is for is the BALANCE promise —
  // factor(50) is 1.0, so routing the sensor reading through the grid is free
  // at the default distribution and a captain who never touches the sliders
  // sees no difference at all. If it ever fails, that stopped being true.
  const g = atPosture('balanced');
  assert.equal(g.ship.power.factor('auxiliary'), 1);
  assert.equal(g.sensorQuality, g.ship.subsystems.sensors);
});

test('power to auxiliary is power to the sensors', () => {
  const balanced = atPosture('balanced');
  const science = atPosture('science');
  assert.ok(science.sensorQuality > balanced.sensorQuality * 1.2,
    `science posture bought ${science.sensorQuality} against ${balanced.sensorQuality}`);
  // And starving it costs.
  const starved = atPosture('attack');
  assert.ok(starved.sensorQuality < balanced.sensorQuality,
    'auxiliary at 25 read the same as auxiliary at 50');
});

test('an anomaly resolves more often with the power behind it', () => {
  // The effect, not the formula: run the same anomaly at both postures across
  // many seeds and count how often the readings come back.
  const resolved = (preset) => {
    let hits = 0;
    for (let seed = 1n; seed <= 120n; seed++) {
      const g = atPosture(preset, { seed });
      g.beginEncounter({
        kind: 'anomaly', system: g.location, hostile: false,
        anomaly: { id: 'protostar', name: 'Protostar', hazard: 0.25, value: 2 },
        title: 'Anomaly', text: 'Something out there.',
      });
      const out = g.resolveEncounter('scan');
      if (out.messages.some((m) => /catalogued/i.test(m))) hits++;
    }
    return hits;
  };
  const balanced = resolved('balanced');
  const science = resolved('science');
  assert.ok(science > balanced,
    `science posture resolved ${science} of 120 against balanced ${balanced} — the same`);
});

test('a sensor sweep says more when the sensors have power behind them', () => {
  const balanced = atPosture('balanced').sensorSweep();
  const science = atPosture('science').sensorSweep();
  assert.ok(science.length > balanced.length,
    `a science-posture sweep returned ${science.length} lines, the same as balanced`);
  assert.ok(science.some((l) => /on file/i.test(l)),
    'a full sweep never said whether science had the system already');
});

test('and a broken array is reported, with the thing that would fix it', () => {
  const g = atPosture('balanced');
  g.ship.subsystems.sensors = 0.3;
  const thin = g.sensorSweep();
  assert.ok(thin.some((l) => /30 percent/.test(l)),
    'a sensor array at a third of itself swept as if it were whole');

  // A whole array with the power starved off it says the other thing.
  const starved = atPosture('attack');
  assert.ok(starved.sensorSweep().some((l) => /more power to auxiliary/i.test(l)),
    'the sweep came back thin and never said why');
});

test('a bad reading never withholds what a captain needs to fly', () => {
  // Fails on the old code only because `sensorSweep` did not exist, so it
  // proves nothing about what was there before. It is here to hold a design
  // line going forward: degrading a sweep into hiding the charted lanes or the
  // hazard would be a worse game, not a deeper one. The reading ADDS at
  // strength; it does not gate at weakness.
  const g = atPosture('attack', { systemId: 'badlands_1' });
  g.ship.subsystems.sensors = 0.1;
  const lines = g.sensorSweep().join(' ');
  assert.ok(/Charted lanes from here:/.test(lines), 'a poor reading lost the lanes');
  assert.ok(/Hazard:/.test(lines), 'a poor reading lost the hazard warning');
});

test('every posture is better at the thing it is named for', () => {
  // The guard that would have caught this. A preset called Science whose
  // effect is not science is indistinguishable from a preset that does
  // nothing, and nothing in the suite asked.
  const base = atPosture('balanced');

  const attack = atPosture('attack');
  assert.ok(attack.ship.power.factor('weapons') > base.ship.power.factor('weapons'),
    'Attack posture was no better at shooting');

  const defense = atPosture('defense');
  assert.ok(defense.ship.shieldRegen * defense.ship.power.factor('shields')
    > base.ship.shieldRegen * base.ship.power.factor('shields'),
  'Defense posture was no better at holding the shields');

  const speed = atPosture('speed');
  assert.ok(speed.ship.maxSpeed > base.ship.maxSpeed,
    'Speed posture was no faster');

  const science = atPosture('science');
  assert.ok(science.sensorQuality > base.sensorQuality,
    'Science posture was no better at science, which is the whole of its name');
});

// ============================================ the ship between the fights

// `Ship.update` was reached from exactly one place — `Engagement.update` — so
// outside a fight the player's ship was a frozen object. The power grid never
// settled, fires burned forever and burned nothing, shields never came back,
// buffs never expired and subsystems never mended. Every one of those
// mechanics was written and none of them ran unless somebody was shooting.

/** Bridge time, in seconds, with nobody on the board. */
function onTheBridge(g, seconds) {
  for (let i = 0; i < Math.round(seconds * 30); i++) g.update(1 / 30);
  return g;
}

test('a power reroute on the bridge actually reaches the grid', () => {
  const g = new Game({ seed: 90n, crewMode: 'original' });
  g.ship.power.applyPreset('attack');
  assert.equal(g.ship.power.target.weapons, 100, 'the order was not recorded at all');
  onTheBridge(g, 10);
  assert.equal(g.ship.power.levels.weapons, 100,
    'the preset lit up green and the grid never moved');
  assert.ok(g.ship.power.factor('weapons') > 1,
    'the order reached the levels and changed nothing that reads them');
});

test('fires are fought when the shooting stops', () => {
  const g = new Game({ seed: 90n, crewMode: 'original' });
  g.ship.fires = 3;
  onTheBridge(g, 60);
  assert.equal(g.ship.fires, 0,
    'a ship left a battle alight and was still alight a minute later');
});

test('and they cost her while they burn', () => {
  const g = new Game({ seed: 90n, crewMode: 'original' });
  const before = g.ship.hull;
  g.ship.fires = 3;
  onTheBridge(g, 60);
  assert.ok(g.ship.hull < before,
    'three fires burned themselves out without touching the hull');
});

test('shields come back between fights', () => {
  const g = new Game({ seed: 90n, crewMode: 'original' });
  for (const f of FACINGS) g.ship.shields[f] = 0;
  onTheBridge(g, 90);
  assert.ok(g.ship.shieldPct > 0.9,
    `a facing beaten flat was still flat after a minute and a half (${g.ship.shieldPct})`);
});

test('and so do the subsystems, slowly', () => {
  const g = new Game({ seed: 90n, crewMode: 'original' });
  g.ship.subsystems.engines = 0.3;
  onTheBridge(g, 10);
  const after10 = g.ship.subsystems.engines;
  assert.ok(after10 > 0.3, 'a damaged engine never mended at all');
  assert.ok(after10 < 1, 'ten seconds put a wrecked engine back to new');
});

test('but the hull does not, which is what a starbase is for', () => {
  // A guard, and it passed before the change too — the old code mended nothing
  // out of combat because it stepped nothing. It is here because it is the
  // line the change deliberately does not cross: time buys shields, fires and
  // subsystems, and never buys hull.
  const g = new Game({ seed: 90n, crewMode: 'original' });
  g.ship.hull = g.ship.maxHull * 0.4;
  const before = g.ship.hull;
  onTheBridge(g, 120);
  assert.equal(g.ship.hull, before, 'time alone put the hull back together');
});

test('a ship that limps away alight is not a ship condemned', () => {
  // The survivability floor DAMAGE_CONTROL_OFF_ACTION stands for. At the
  // in-action rate this ship burned to death on her own bridge in thirty-two
  // seconds with no enemy on the board and no posture that changed it.
  for (const preset of ['attack', 'balanced', 'science']) {
    const g = new Game({ seed: 90n, crewMode: 'original' });
    g.ship.hull = g.ship.maxHull * 0.15;
    g.ship.fires = 4;
    g.ship.power.applyPreset(preset);
    onTheBridge(g, 120);
    assert.equal(g.ship.destroyed, false,
      `${preset} posture: she burned to death on the bridge`);
    assert.equal(g.ship.fires, 0, `${preset} posture: still burning after two minutes`);
  }
});

test('and the power she puts behind damage control decides what it costs her', () => {
  const cost = (preset) => {
    const g = new Game({ seed: 90n, crewMode: 'original' });
    g.ship.hull = g.ship.maxHull * 0.5;
    g.ship.fires = 4;
    g.ship.power.applyPreset(preset);
    const before = g.ship.hull;
    onTheBridge(g, 120);
    return before - g.ship.hull;
  };
  assert.ok(cost('science') < cost('attack'),
    'power to auxiliary bought nothing against a fire');
});

test('the parties are thinner while the ship is still being fought', () => {
  // Same fire, same power, the difference being whether anyone is shooting.
  const burn = (inAction) => {
    const g = new Game({ seed: 90n, crewMode: 'original' });
    g.ship.fires = 4;
    let t = 0;
    while (g.ship.fires > 0 && t < 30 * 600) { g.ship.update(1 / 30, g.rng, { inAction }); t++; }
    return t;
  };
  assert.ok(burn(true) > burn(false) * 2,
    'a fire was no harder to fight with an enemy on the board');
});

test('the upkeep does not disturb the seeded world', () => {
  // Passes on the old code too, where nothing was stepped and so nothing was
  // drawn — it is a guard against a regression this change could have
  // introduced rather than a proof about the old behaviour, and it caught one:
  // `Ship.update` draws from the RNG it is handed, and it now draws on ticks it
  // never used to. From `game.rng` that would shift every seeded outcome
  // downstream — the same voyage going differently depending on whether the
  // ship happened to be alight on the way out. It draws from `upkeepRng`.
  const voyage = (burn) => {
    const g = new Game({ seed: 4242n, crewMode: 'original' });
    if (burn) { g.ship.fires = 4; onTheBridge(g, 40); }
    g.setCourse('vulcan');
    for (let i = 0; i < 30 * 2000 && g.transit; i++) g.update(1 / 30);
    return { at: g.locationId, kind: g.encounter?.kind ?? null, title: g.encounter?.title ?? null };
  };
  assert.deepEqual(voyage(true), voyage(false),
    'a fire on the way out changed what was waiting at the other end');
});

// ============================================== somebody else's boarding party

// Three defects in one mechanic, and the first is the reason the other two were
// never noticed.
//
// `boarding_action` — the alternative to killing a ship, three steps at extreme
// hazard — was gated on the target's `shieldPct <= 0.05`. That is the MEAN
// across six facings, and combat cannot drive a mean to five per cent: fire
// lands on one facing while the other five regenerate. Across forty ordinary
// engagements the lowest mean a hostile ever reached was 0.497. So it was never
// once offered in a fight, and every test that exercised it flattened all six
// facings by hand.
//
// Nothing had ever boarded the PLAYER. `ship.boarders` was a counter the game
// could only decrement — the defence in `Ship.update` was written in full and
// no code anywhere set one above zero — so the `intruder_alert` cue sat
// reserved and the `boarding_drill` duty detail rehearsed repelling people who
// could not arrive.
//
// And that defence never ended. It takes `Math.min(boarders, killed)` a tick,
// so once the party is smaller than the defenders can kill in a second it
// decays geometrically and never reaches zero.

/** Fly at the target and shoot, which is what makes a facing go flat. */
function brawl(g, seconds = 300, watch = null) {
  for (let t = 0; t < 30 * seconds && g.engagement && !g.engagement.over; t++) {
    const eng = g.engagement;
    if (!eng.target || eng.target.destroyed) eng.cycleTarget();
    const mark = eng.target ?? eng.liveHostiles[0];
    if (mark) eng.comeAboutTo(mark);
    eng.setThrottle(1);
    eng.fireAll();
    g.update(1 / 30);
    if (watch) watch(g);
  }
  return g;
}

test('a boarding party goes through the facing that is down, not through an average', async () => {
  // Loaded here rather than at the top of the file: run against a tree
  // without it, a static import fails the whole file instead of this test,
  // and then nothing in it can be compared against the old behaviour.
  const { boardableState } = await import('../src/sim/ai.js');
  const g = new Game({ seed: 7n, crewMode: 'original' });
  g.startCombat([new Ship('d7', { name: 'Target' })], { relentless: true });
  const foe = g.engagement.hostiles[0];
  foe.hull = foe.maxHull * 0.2;
  foe.x = 200; foe.y = 0; foe.z = 0;
  g.ship.x = 0; g.ship.y = 0; g.ship.z = 0;

  // Every facing up: nobody boards anybody.
  for (const f of FACINGS) foe.shields[f] = foe.maxShield;
  assert.equal(boardableState(foe, g.ship), false, 'boardable through raised shields');

  // The facing AWAY from us flat, and the rest up. The mean has dropped and
  // the gap is on the wrong side, so it is still no.
  const toward = facingForDirection(foe.directionFrom(g.ship));
  const away = { fore: 'aft', aft: 'fore', port: 'starboard', starboard: 'port', dorsal: 'ventral', ventral: 'dorsal' }[toward];
  foe.shields[away] = 0;
  assert.equal(boardableState(foe, g.ship), false,
    'boardable through the shield on the far side of the ship');

  // The facing toward us flat: that is the gap you beam through.
  foe.shields[away] = foe.maxShield;
  foe.shields[toward] = 0;
  assert.equal(boardableState(foe, g.ship), true, 'the gap toward us was not a gap');
});

test('and the condition is one a real fight actually produces', () => {
  // The whole point. On the old rule this was zero out of forty.
  let offered = 0;
  for (let seed = 1n; seed <= 40n; seed++) {
    const g = new Game({ seed, crewMode: 'original', difficulty: 'commander' });
    g.startCombat([new Ship('d7', { name: 'Target' })]);
    let saw = false;
    brawl(g, 300, (game) => {
      if (game.availableAwayMissions().some((m) => m.id === 'boarding_action')) saw = true;
    });
    if (saw) offered++;
  }
  assert.ok(offered >= 3,
    `a boarding party was offered in ${offered} of forty ordinary fights — the mechanic is unreachable`);
  assert.ok(offered <= 30,
    `${offered} of forty is not an alternative to killing, it is the default`);
});

test('a hostile can put a party aboard us, which nothing could ever do', () => {
  const g = new Game({ seed: 7n, crewMode: 'original' });
  g.startCombat([new Ship('d7', { name: 'IKS Target' })], { relentless: true });
  const foe = g.engagement.hostiles[0];
  const before = g.ship.boarders;
  const sent = g.ship.receiveBoarders(Math.round(foe.crew * 0.18), foe);
  assert.ok(sent > 0, 'nobody came across');
  assert.ok(g.ship.boarders > before, 'the counter that only ever went down still only goes down');
});

test('and the fight for the ship ends', () => {
  // On the old code this ran until the heat death of the commission: after ten
  // minutes a boarded ship still had 1e-264 Klingons aboard and `boarders > 0`
  // was still true, so the block went on damaging a subsystem about once a
  // second and drawing from the RNG every tick, forever.
  for (const party of [10, 40, 80]) {
    const g = new Game({ seed: 7n, crewMode: 'original' });
    g.ship.receiveBoarders(party);
    let t = 0;
    while (g.ship.boarders > 0 && !g.ship.destroyed && t < 30 * 600) { g.update(1 / 30); t++; }
    assert.equal(g.ship.boarders, 0, `${party} boarders were still aboard after ten minutes`);
    assert.ok(t < 30 * 60, `${party} boarders took ${(t / 30).toFixed(0)}s to repel`);
    assert.deepEqual(checkAll(g, { arenaRadius: ARENA_RADIUS }), []);
  }
});

test('and it costs the crew who fought them', () => {
  const g = new Game({ seed: 7n, crewMode: 'original' });
  const before = g.ship.crew;
  g.ship.receiveBoarders(60);
  while (g.ship.boarders > 0 && !g.ship.destroyed) g.update(1 / 30);
  assert.ok(g.ship.crew < before,
    'sixty intruders were repelled without costing a single member of the crew');
  assert.ok(g.ship.crew > before * 0.5, 'repelling them killed half the ship');
});

test('turning out the guard makes the fight shorter and cheaper', async () => {
  const { REPEL_STRENGTH, REPEL_DURATION } = await import('../src/sim/ship.js');
  const fight = (ordered) => {
    const g = new Game({ seed: 7n, crewMode: 'original' });
    const before = g.ship.crew;
    g.ship.receiveBoarders(80);
    if (ordered) {
      g.ship.addBuff({
        id: 'repel_boarders', label: 'Security to all decks',
        until: REPEL_DURATION, mods: { repelBoarders: REPEL_STRENGTH },
      });
    }
    let t = 0;
    while (g.ship.boarders > 0 && !g.ship.destroyed && t < 30 * 600) { g.update(1 / 30); t++; }
    return { seconds: t / 30, lost: before - g.ship.crew };
  };
  const alone = fight(false);
  const guard = fight(true);
  assert.ok(guard.seconds < alone.seconds,
    `the guard made no difference to the time (${guard.seconds} vs ${alone.seconds})`);
  assert.ok(guard.lost < alone.lost,
    `the guard made no difference to the cost (${guard.lost} vs ${alone.lost})`);
});

test('the people who fight them are whole people', () => {
  // Found by looking at a screenshot. Everything else that kills crew floors
  // it — `takeDamage` uses Math.floor, a fire takes one at a time — and the
  // repel loop subtracted a continuous quantity, which nobody had ever seen
  // because nothing had ever put a boarding party aboard anything. The
  // tactical overlay printed the result straight: `Crew 426.1326943672293`,
  // on a bridge display, in the middle of a fight.
  const g = new Game({ seed: 7n, crewMode: 'original' });
  const before = g.ship.crew;
  g.ship.receiveBoarders(80);
  let t = 0;
  while (g.ship.boarders > 0 && t < 30 * 600) {
    g.update(1 / 30); t++;
    assert.ok(Number.isInteger(g.ship.crew), `crew went fractional: ${g.ship.crew}`);
  }
  assert.ok(g.ship.crew < before, 'a boarding party was repelled at no cost at all');
  // And the checker objects if anything else ever produces it.
  g.ship.crew -= 0.5;
  assert.ok(checkAll(g, { arenaRadius: ARENA_RADIUS }).some((v) => v.code === 'ship.crew.fractional'));
});

test('a boarding is a fight in progress, and survives the app closing', () => {
  const g = new Game({ seed: 7n, crewMode: 'original' });
  g.ship.receiveBoarders(50);
  for (let i = 0; i < 30 * 2; i++) g.update(1 / 30);
  const mid = g.ship.boarders;
  assert.ok(mid > 0);
  const back = Game.load(JSON.parse(JSON.stringify(g.save())));
  assert.ok(Math.abs(back.ship.boarders - mid) < 1e-6,
    'a save taken during a boarding came back with the intruders gone');
  let t = 0;
  while (back.ship.boarders > 0 && t < 30 * 600) { back.update(1 / 30); t++; }
  assert.equal(back.ship.boarders, 0);
  assert.deepEqual(checkAll(back, { arenaRadius: ARENA_RADIUS }), []);
});

test('and a record written before any of this loads without one aboard', () => {
  // Passes either way — the old code never wrote the field, so it read as
  // absent then too. It is here as the migration guard: every save in
  // existence predates this mechanic, and none of them may load with a
  // boarding party already in the corridors.
  const g = new Game({ seed: 7n, crewMode: 'original' });
  const raw = JSON.parse(JSON.stringify(g.save()));
  delete raw.ship.boarders;
  const old = Game.load(raw);
  assert.equal(old.ship.boarders, 0);
  assert.deepEqual(checkAll(old, { arenaRadius: ARENA_RADIUS }), []);
});

test('the factions that board are the ones whose doctrine is to take a ship', () => {
  // An effect, measured: Cardassians grind at range and do not board, so a
  // Galor never puts anybody aboard however badly the fight goes.
  const boardedBy = (id, difficulty, count) => {
    let seen = 0;
    for (let seed = 1n; seed <= 20n; seed++) {
      const g = new Game({ seed, crewMode: 'original', difficulty });
      g.startCombat(Array.from({ length: count }, (_, i) => new Ship(id, { name: `${id} ${i}` })));
      let saw = false;
      brawl(g, 300, (game) => { if (game.ship.boarders > 0) saw = true; });
      if (saw) seen++;
    }
    return seen;
  };
  assert.equal(boardedBy('galor', 'admiral', 2), 0,
    'a Cardassian ship boarded us, and attrition doctrine does not board');
  assert.ok(boardedBy('d7', 'admiral', 2) > 0, 'Klingons never once tried to take the ship');
});
