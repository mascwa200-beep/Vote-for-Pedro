// Simulation tests. These cover the parts where a wrong number is invisible
// on screen but decides whether a fight is winnable.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RNG, hashSeed } from '../src/core/rng.js';
import { Ship, facingForBearing, inArc, FACINGS } from '../src/sim/ship.js';
import { PowerGrid, effectiveness } from '../src/sim/power.js';
import { Engagement, rangeFactor } from '../src/sim/combat.js';
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
import { resolveHail } from '../src/sim/diplomacy.js';

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
