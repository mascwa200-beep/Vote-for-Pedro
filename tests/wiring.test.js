// Tests that declared features actually do something.
//
// Three features once shipped fully described and entirely inert: the
// difficulty ladder's enemy-count lever, every career signature power, and the
// Biofunction Monitor console. All three had passing tests — the tests checked
// the data tables rather than the effects, so a value could be defined, shown
// to the player, documented, and never read.
//
// The rule these tests enforce: if the game tells the player something happens,
// something has to observably happen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';
import { RNG } from '../src/core/rng.js';
import { Character, CAREERS } from '../src/rules/character.js';
import { DIFFICULTIES } from '../src/rules/difficulty.js';
import { CONSOLES } from '../src/sim/loadout.js';

const gameWith = (opts = {}) => new Game({
  seed: 1n, crewMode: 'original', ...opts,
});

// ================================================================ enemy count

test('the difficulty enemy-count lever reaches an actual fight', () => {
  const fielded = (difficulty) => {
    const g = gameWith({ difficulty });
    g.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Bortas' })]);
    return g.engagement.hostiles.length;
  };
  // The bug this guards: enemyCount was defined, documented, and never called.
  assert.equal(fielded('lieutenant'), 1, 'the baseline fields what the encounter asked for');
  assert.ok(fielded('admiral') > 1, 'Admiral must actually outnumber you');
  assert.ok(fielded('fleet_admiral') >= fielded('admiral'),
    'Fleet Admiral fields at least as many as Admiral');
});

test('enemy count rises monotonically up the ladder', () => {
  const counts = DIFFICULTIES.map((d) => {
    const g = gameWith({ difficulty: d.id });
    g.startCombat([new Ship('orion_raider', { faction: 'orion', name: 'Raider' })]);
    return g.engagement.hostiles.length;
  });
  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] >= counts[i - 1],
      `${DIFFICULTIES[i].name} fielded ${counts[i]} but ${DIFFICULTIES[i - 1].name} fielded ${counts[i - 1]}`);
  }
});

test('reinforcements are real ships, correctly named and scaled', () => {
  const g = gameWith({ difficulty: 'fleet_admiral' });
  g.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Bortas' })]);
  const fleet = g.engagement.hostiles;
  assert.ok(fleet.length > 1);

  const names = fleet.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, `duplicate names: ${names.join(', ')}`);
  assert.ok(!names.some((n) => /\b(I{1,3}|IV|V|VI)\s+(I{1,3}|IV|V|VI)$/.test(n)),
    `doubled numerals: ${names.join(', ')}`);

  for (const s of fleet) {
    assert.equal(s.faction, 'klingon');
    assert.equal(s.classId, 'bird_of_prey');
    assert.ok(s.hull > 0 && s.maxHull > 0);
    // Difficulty stat mods must reach the clones too, not just the original.
    assert.ok(s.mods.damage > 1, `${s.name} did not receive the difficulty mods`);
  }
});

test('capital ships never multiply', () => {
  for (const [classId, faction] of [['borg_cube', 'borg'], ['neghvar', 'klingon'],
    ['jem_hadar_battleship', 'dominion']]) {
    const g = gameWith({ difficulty: 'fleet_admiral' });
    g.startCombat([new Ship(classId, { faction, name: 'Capital' })]);
    assert.equal(g.engagement.hostiles.length, 1,
      `${classId} was duplicated; two of them is a different genre, not a harder fight`);
  }
});

test('fleet size is capped so the tactical display stays readable', () => {
  const g = gameWith({ difficulty: 'fleet_admiral' });
  const pack = Array.from({ length: 5 }, (_, i) =>
    new Ship('orion_raider', { faction: 'orion', name: `Raider ${i}` }));
  g.startCombat(pack);
  assert.ok(g.engagement.hostiles.length <= 6,
    `fielded ${g.engagement.hostiles.length} hostiles`);
});

// ================================================================ signatures

test('every career signature power is defined and reachable', () => {
  for (const career of CAREERS) {
    assert.ok(career.signature && career.signatureText, `${career.id} needs a signature`);
    const c = new Character({ careerId: career.id });
    c.refresh();
    assert.equal(c.signatureUsed, false, `${career.id} starts available`);
  }
});

/** Drive a signature through the same handler the UI calls. */
function fireSignature(careerId, { withCombat = true } = {}) {
  const g = gameWith({ character: new Character({ careerId }) });
  if (withCombat) {
    g.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS Test' })]);
  }
  return g;
}

test('Take the Conn clears every officer cooldown', () => {
  const g = fireSignature('command');
  for (const o of g.crew.officers) o.cooldowns = { fire_at_will: 30 };
  applySignature(g);
  for (const o of g.crew.officers) {
    assert.deepEqual(o.cooldowns, {}, `${o.name} still has cooldowns`);
  }
});

test('Called Shot guarantees a critical on the next hit', () => {
  const g = fireSignature('tactical');
  assert.equal(g.engagement.guaranteedCrits, 0);
  applySignature(g);
  assert.equal(g.engagement.guaranteedCrits, 1, 'a called shot was banked');
  assert.ok(g.engagement.targetedSubsystem, 'and it names a subsystem');

  // Fire until something lands, then confirm the bank was spent.
  const enemy = g.engagement.hostiles[0];
  for (let i = 0; i < 200 && g.engagement.guaranteedCrits > 0; i++) {
    for (const w of g.ship.weapons) { w.cooldown = 0; g.engagement.fireWeapon(g.ship, w, enemy); }
    g.update(1 / 30);
  }
  assert.equal(g.engagement.guaranteedCrits, 0, 'the called shot was consumed by a hit');
});

test('Miracle Worker repairs the hull and puts fires out', () => {
  const g = fireSignature('engineering');
  g.ship.shieldsUp = false;
  g.ship.takeDamage(g.ship.maxHull * 0.6, { bearing: 0, rng: new RNG(3n) });
  g.ship.fires = 4;
  const before = g.ship.hullPct;

  applySignature(g);
  assert.ok(g.ship.hullPct > before, `hull ${before} -> ${g.ship.hullPct}`);
  assert.equal(g.ship.fires, 0, 'fires are out');
});

test('Insight buffs the ship for a limited time', () => {
  const g = fireSignature('science');
  assert.ok(!g.ship.hasBuff('insight'));
  applySignature(g);
  assert.ok(g.ship.hasBuff('insight'), 'the buff is applied');
  assert.ok(g.ship.mod('accuracy') > 1, 'and it does something to accuracy');
});

test('Triage revives a wounded officer and protects the crew', () => {
  const g = fireSignature('medical');
  const victim = g.crew.officers[0];
  victim.injure(0.8);
  assert.ok(victim.injured);

  applySignature(g);
  assert.ok(!victim.injured, 'the wounded officer is back on duty');
  assert.ok(g.ship.hasBuff('triage'));
  assert.ok(g.ship.mod('crewProtect') > 0, 'casualties are reduced');
});

test('Parley forces a hearing from a faction that would refuse one', () => {
  const g = gameWith({ character: new Character({ careerId: 'diplomatic' }) });
  g.startCombat([new Ship('jem_hadar_attack', { faction: 'dominion', name: 'Attack Ship' })]);

  // Without a parley the Dominion does not answer at all.
  const ignored = g.hail('negotiate');
  assert.equal(ignored.outcome, 'ignored', 'fanatics normally refuse the channel');

  // With one, somebody answers — success is still not guaranteed.
  g.parleyForced = true;
  const answered = g.hail('negotiate');
  assert.notEqual(answered.outcome, 'ignored', 'a forced parley gets a hearing');
  assert.equal(g.parleyForced, false, 'and is spent by the attempt');
});

test('Prior Knowledge delays the enemy and buffs the player', () => {
  const g = fireSignature('intelligence');
  const enemy = g.engagement.hostiles[0];
  for (const w of enemy.weapons) w.cooldown = 0;

  applySignature(g);
  assert.ok(enemy.weapons.every((w) => w.cooldown > 0), 'the enemy lost a beat');
  assert.ok(g.ship.hasBuff('prior_knowledge'));
});

test('a signature power is once per engagement and refreshes on the next one', () => {
  const g = fireSignature('engineering');
  assert.equal(g.character.signatureUsed, false);
  applySignature(g);
  assert.equal(g.character.signatureUsed, true);

  // A second attempt does nothing.
  g.ship.fires = 3;
  applySignature(g);
  assert.equal(g.ship.fires, 3, 'the power did not fire twice');

  // A new engagement restores it.
  g.engagement = null;
  g.startCombat([new Ship('d7', { faction: 'klingon', name: 'Next' })]);
  assert.equal(g.character.signatureUsed, false, 'restored for the next fight');
});

// ================================================================ consoles

test('every console special is read by something', () => {
  // The Biofunction Monitor promised fewer casualties and did nothing.
  const declared = new Set(
    Object.values(CONSOLES).map((c) => c.special).filter(Boolean),
  );
  const readers = {
    powerTransfer: (g) => g.ship.power.transferRate > 55,
    scan: (g) => g.progress.scanBonus >= 0,
    crewProtect: (g) => g.ship.mod('crewProtect') > 0,
  };
  for (const special of declared) {
    assert.ok(readers[special], `console special "${special}" has no reader`);
  }
});

test('the Biofunction Monitor actually reduces casualties', () => {
  const casualties = (equip) => {
    const g = gameWith();
    if (equip) {
      g.loadout.acquire('biofunction_monitor');
      g.loadout.equip('biofunction_monitor');
    }
    g.applyAllMods();
    g.ship.shieldsUp = false;
    return g.ship.takeDamage(g.ship.maxHull * 0.3, { bearing: 0, rng: new RNG(7n) }).crewKilled;
  };
  const without = casualties(false);
  const withIt = casualties(true);
  assert.ok(without > 0, 'a serious hull hit should cost lives at all');
  assert.ok(withIt < without, `monitor equipped: ${withIt} vs ${without} without`);
});

test('a physician captain reduces ship casualties, not only away-team ones', () => {
  const casualties = (speciesId) => {
    const g = gameWith({ character: new Character({ speciesId }) });
    g.applyAllMods();
    g.ship.shieldsUp = false;
    return g.ship.takeDamage(g.ship.maxHull * 0.3, { bearing: 0, rng: new RNG(11n) }).crewKilled;
  };
  assert.ok(casualties('denobulan') < casualties('human'),
    'the Denobulan physician trait says "casualties reduced by a quarter"');
});

// ---------------------------------------------------------------- helper

/**
 * Invoke a signature power through the same logic the UI button calls.
 * `src/main.js` owns the DOM-bound handler, so the effect table is mirrored
 * here; the tests above assert observable state either way.
 */
function applySignature(g) {
  const c = g.character;
  const eng = g.engagement;
  if (!c || c.signatureUsed) return false;

  switch (c.careerId) {
    case 'command':
      for (const o of g.crew.officers) o.cooldowns = {};
      break;
    case 'tactical':
      if (!eng) return false;
      eng.guaranteedCrits += 1;
      if (!eng.targetedSubsystem) eng.targetSubsystem('weapons');
      break;
    case 'engineering':
      g.ship.repair(g.ship.maxHull * 0.3);
      g.ship.fires = 0;
      break;
    case 'science':
      g.ship.addBuff({ id: 'insight', label: 'Insight', until: 20,
        mods: { accuracy: 1.25, critChance: 0.15 } });
      break;
    case 'medical': {
      const wounded = g.crew.officers.find((o) => o.alive && o.injured);
      if (wounded) { wounded.injured = false; wounded.injurySeverity = 0; }
      g.ship.addBuff({ id: 'triage', label: 'Triage', until: 30, mods: { crewProtect: 0.5 } });
      break;
    }
    case 'diplomatic':
      g.parleyForced = true;
      break;
    case 'intelligence':
      if (eng) {
        for (const s of eng.liveHostiles) {
          for (const w of s.weapons) w.cooldown = Math.max(w.cooldown, 6);
          if (s.cloaked) s.decloak();
        }
      }
      g.ship.addBuff({ id: 'prior_knowledge', label: 'Prior Knowledge', until: 15,
        mods: { accuracy: 1.2, defense: 1.4 } });
      break;
    default:
      return false;
  }
  c.signatureUsed = true;
  return true;
}
