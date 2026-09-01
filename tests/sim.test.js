// Simulation tests. These cover the parts where a wrong number is invisible
// on screen but decides whether a fight is winnable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { RNG, hashSeed } from '../src/core/rng.js';
import { Ship, facingForBearing, inArc, FACINGS } from '../src/sim/ship.js';
import { PowerGrid, effectiveness } from '../src/sim/power.js';
import {
  Engagement, rangeFactor, ARENA_RADIUS, MAX_WEAPON_RANGE, WITHDRAW_SECONDS, OUTCOMES,
} from '../src/sim/combat.js';
import { CaptainProgress, RANKS } from '../src/sim/skills.js';
import { Loadout, startingLoadout } from '../src/sim/loadout.js';
import { Ledger } from '../src/core/ledger.js';
import { Galaxy, warpSpeed, travelHours, fuelCost, plotTransit } from '../src/world/galaxy.js';
import { rollEncounter } from '../src/world/encounters.js';
import { Mission, MissionBook } from '../src/missions/engine.js';
import { EPISODES } from '../src/missions/episodes/index.js';
import { parseOrder } from '../src/ui/orders.js';
import { Game } from '../src/core/state.js';
import { getShipClass, SHIP_LIST } from '../src/world/ships.data.js';
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
  assert.ok(['victory', 'destroyed', 'routed', 'escaped'].includes(eng.outcome));
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
        if (choice.next) {
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
  while (!mission.complete && guard++ < 50) {
    const choices = mission.choices().filter((c) => !c.locked);
    assert.ok(choices.length, 'a stage must offer at least one open choice');
    mission.choose(choices[0].id);
  }
  assert.ok(mission.complete, 'the mission reached an ending');
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
  const ending = new Set(['surrendered', 'bought_off', 'stand_down', 'deterred', 'accepted_aid', 'acknowledged']);
  for (const outcome of produced) {
    if (!ending.has(outcome)) continue;
    assert.ok(HAIL_ENDING[outcome], `'${outcome}' ends a fight and has no ending mapped`);
  }
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
  const HOSTILES = [
    'bird_of_prey', 'd7', 'warbird', 'jem_hadar_attack', 'galor', 'marauder',
    'tholian_web_spinner', 'orion_raider', 'vorcha', 'keldon', 'freighter',
  ];
  const DIFFS = ['story', 'cadet', 'commander', 'captain'];
  let maxRadius = 0;
  const unresolved = [];

  for (let i = 0; i < 112; i++) {
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
  };

  let tried = 0;
  for (const [id, arrange] of Object.entries(effects)) {
    // Exactly one in the locker, regardless of what the starting loadout
    // rolled, so "spent" means something.
    g.loadout.equipped.device = [id];
    const check = arrange(g);
    const r = g.useDevice(id);
    if (!r.ok) continue;   // a loadout that cannot carry it is not a failure
    tried++;
    check();
    assert.equal(g.useDevice(id).ok, false, `${id} was used twice from one charge`);
  }
  assert.ok(tried >= 3, `only ${tried} devices could be used at all`);
});

// --------------------------------------------- breaking off a course under way

// "Drop out of warp" was a button in the Under Way panel and nothing else: it
// moved the ship, advanced the calendar, cleared the transit and set the mode,
// all inside src/ui/screens.js. So there was no way to abort a course without
// a screen, the system you stopped at was never marked visited, nothing was
// ever waiting there when you arrived — and the phrase printed on the button
// said "all stop", which at warp did something else entirely.

test('a course can be broken off, and it puts the ship somewhere real', () => {
  const g = new Game({ seed: 4801n, crewMode: 'original' });
  const from = g.locationId;
  const elsewhere = g.galaxy.systems.find((s) => s.id !== from).id;
  assert.ok(g.setCourse(elsewhere, 6).ok);
  const stardate = g.clock.stardate;

  // Part way there, so the nearest system is a real choice.
  for (let i = 0; i < 600 && g.transit; i++) g.update(1 / 30);
  assert.ok(g.transit, 'the transit finished before it could be broken off');

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
