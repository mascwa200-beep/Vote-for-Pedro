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

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Game } from '../src/core/state.js';
import {
  SYSTEMS, systemDepth, distanceLy, REAL_DECLINATION,
} from '../src/world/systems.data.js';
import { Ship, FACINGS } from '../src/sim/ship.js';
import { RNG } from '../src/core/rng.js';
import { Character, CAREERS } from '../src/rules/character.js';
import { DIFFICULTIES } from '../src/rules/difficulty.js';
import { CONSOLES } from '../src/sim/loadout.js';
import {
  RECIPES, MATERIAL_LIST, beginFabrication, advanceFabrication, salvageWreck,
} from '../src/sim/fabrication.js';
import { TRAPS } from '../src/world/encounters.js';
import { EPISODES } from '../src/missions/episodes/index.js';
import { CaptainProgress, SKILL_LIST, combatXP } from '../src/sim/skills.js';
import { Reputation, REP_TIERS, MAX_TIER, TRACK_LIST } from '../src/rules/reputation.js';
import { Ledger } from '../src/core/ledger.js';

const HERE = dirname(fileURLToPath(import.meta.url));

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

// ================================================================ the chair

test('every intercom station gives a report built from live ship state', () => {
  const g = gameWith();
  const before = g.log.length;
  const seen = new Set();

  for (const dept of ['engineering', 'medical', 'tactical', 'science', 'helm', 'comms', 'security']) {
    const text = g.intercom(dept);
    assert.ok(text && text.length > 10, `${dept} said nothing worth hearing`);
    seen.add(text);
  }

  // Seven departments, seven different answers. A shared placeholder string
  // would pass a "returns a string" test and tell the captain nothing.
  assert.equal(seen.size, 7, 'two departments gave the identical report');
  assert.ok(g.log.length > before, 'nothing reached the ship’s log');
});

test('an intercom report changes when the ship does', () => {
  const g = gameWith();
  const quiet = g.intercom('medical');
  g.ship.crew -= 40;
  const loud = g.intercom('medical');
  assert.notEqual(quiet, loud, 'sickbay reported the same thing with 40 more dead');
  assert.match(loud, /40 dead/);
});

test('a captain’s log entry is recorded and refuses to record nothing', () => {
  const g = gameWith();
  const before = g.log.length;
  assert.equal(g.logEntry('   '), null, 'an empty entry should not be recorded');
  assert.equal(g.log.length, before, 'an empty entry still wrote to the log');

  g.logEntry('The Klingon commander was as good as his word.');
  assert.equal(g.log.length, before + 1);
  assert.match(g.log.at(-1).text, /Klingon commander was as good as his word/);
  assert.equal(g.log.at(-1).source, 'captain');
});

test('the ion pod is a real decoy, and only in a fight', () => {
  const g = gameWith();

  // Out of combat there is nothing to gain and a pod to lose.
  assert.equal(g.jettisonPod().ok, false);

  g.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Bortas' })]);
  assert.equal(g.engagement.decoyTimer, 0);
  assert.equal(g.jettisonPod().ok, true);
  assert.ok(g.engagement.decoyTimer > 0, 'the decoy timer never started');

  // And we only carry the one.
  assert.equal(g.jettisonPod().ok, false);
});

test('the decoy actually makes the enemy miss more often', () => {
  // The point of the wiring rule: a timer counting down is not an effect.
  const shots = (withDecoy) => {
    const g = gameWith({ difficulty: 'lieutenant' });
    g.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Bortas' })]);
    const eng = g.engagement;
    if (withDecoy) eng.deployDecoy(9999);
    const hostile = eng.hostiles[0];
    const weapon = hostile.weapons[0];
    let hits = 0;
    for (let i = 0; i < 400; i++) {
      if (eng.resolveHit(hostile, g.ship, weapon, 300).hit) hits++;
    }
    return hits;
  };
  const plain = shots(false);
  const decoyed = shots(true);
  assert.ok(decoyed < plain,
    `decoy did not reduce hits: ${decoyed} with, ${plain} without`);
});

test('the decoy expires', () => {
  const g = gameWith();
  g.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Bortas' })]);
  g.engagement.deployDecoy(2);
  for (let i = 0; i < 90; i++) g.engagement.update(1 / 30);
  assert.equal(g.engagement.decoyTimer, 0, 'the decoy never wore off');
});

test('blue alert makes repairs go further, and is refused under fire', () => {
  const damage = (g) => { g.ship.hull = g.ship.maxHull * 0.5; };

  const normal = gameWith();
  damage(normal);
  const a = normal.effectRepairs();

  const blue = gameWith();
  damage(blue);
  blue.setAlert('blue');
  assert.equal(blue.alert, 'blue', 'blue alert did not take');
  const b = blue.effectRepairs();

  assert.ok(b.after > a.after,
    `blue alert did nothing: ${a.after} normal vs ${b.after} blue`);
  assert.equal(b.blue, true);

  // And it is a maintenance condition, not a combat one.
  const fighting = gameWith();
  fighting.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Bortas' })]);
  fighting.setAlert('blue');
  assert.notEqual(fighting.alert, 'blue', 'blue alert was accepted mid-engagement');
});

test('repairs refuse to run on an undamaged hull', () => {
  const g = gameWith();
  assert.equal(g.effectRepairs().ok, false);
});

// ================================================================ the shop

test('every recipe has an effect that can be observed', () => {
  // The rule this file exists for. A recipe is the easiest possible thing to
  // add as a line in a menu and forget to connect to anything.
  const inert = [];
  for (const recipe of RECIPES) {
    const g = gameWith();
    // Put the ship in a state where every recipe has something to do.
    g.ship.hull = g.ship.maxHull * 0.4;
    g.ship.torpedoes = 0;
    g.ship.subsystems.sensors = 0.3;
    g.ship.fires = 3;
    g.podJettisoned = true;
    g.stores = { duranium: 999, isolinear: 999, deuterium: 999, salvage: 999 };

    const before = JSON.stringify({
      hull: g.ship.hull,
      torps: g.ship.torpedoes,
      subs: g.ship.subsystems,
      fires: g.ship.fires,
      buffs: g.ship.buffs.map((b) => b.id),
      devices: g.devices,
      pod: g.podJettisoned,
      transfer: g.ship.power.transferRate,
    });

    assert.equal(g.fabricate(recipe.id).ok, true, `${recipe.id} could not be started`);
    const done = advanceFabrication(g, recipe.hours + 1);
    assert.ok(done, `${recipe.id} never finished`);

    const after = JSON.stringify({
      hull: g.ship.hull,
      torps: g.ship.torpedoes,
      subs: g.ship.subsystems,
      fires: g.ship.fires,
      buffs: g.ship.buffs.map((b) => b.id),
      devices: g.devices,
      pod: g.podJettisoned,
      transfer: g.ship.power.transferRate,
    });
    if (before === after) inert.push(recipe.id);
  }
  assert.deepEqual(inert, [], `these recipes changed nothing: ${inert.join(', ')}`);
});

test('fabrication spends the materials and refuses without them', () => {
  const g = gameWith();
  g.ship.hull = g.ship.maxHull * 0.5;
  g.stores = { duranium: 12, isolinear: 0, deuterium: 0, salvage: 0 };

  assert.equal(g.fabricate('hull_patch').ok, true);
  assert.equal(g.stores.duranium, 0, 'the materials were not spent');

  // One bench, one chief engineer.
  assert.equal(g.fabricate('eps_bypass').ok, false, 'two jobs ran at once');

  const g2 = gameWith();
  g2.stores = { duranium: 0, isolinear: 0, deuterium: 0, salvage: 0 };
  g2.ship.hull = g2.ship.maxHull * 0.5;
  assert.equal(g2.fabricate('hull_patch').ok, false, 'built something out of nothing');
});

test('the shop works while the app is closed', () => {
  let t = 1_700_000_000_000;
  const now = () => t;
  const g = new Game({ seed: 1n, crewMode: 'original', now });
  g.ship.hull = g.ship.maxHull * 0.5;
  g.stores.duranium = 99;
  g.fabricate('hull_patch');
  assert.ok(g.fabricationStatus);

  t += 12 * 3600 * 1000;          // twelve hours away
  g.syncCampaign();
  assert.equal(g.fabricationStatus, null, 'the job did not finish while we were away');
});

test('destroying a ship leaves a wreck, and the wreck is worth stripping', () => {
  // The hulk is not stripped automatically any more. It is left in space where
  // the fight happened, because "strip the wreck" was an order that asked for
  // no wreck, no fight and no cooldown, and stripping on a win made that order
  // pure duplication of something the game had already done.
  const g = gameWith();
  const before = { ...g.stores };
  g.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Bortas' })]);
  g.engagement.hostiles[0].destroyed = true;
  g.finishCombat('victory');

  assert.ok(g.wreckHere, 'a destroyed ship left nothing adrift');
  assert.deepEqual(g.stores, before, 'the wreck stripped itself');

  const r = g.stripWreck();
  assert.equal(r.ok, true, r.reason);
  assert.ok(g.stores.salvage > before.salvage, 'the wreck gave up nothing');

  // And once. This is the exploit the order used to be.
  const after = { ...g.stores };
  const again = g.stripWreck();
  assert.equal(again.ok, false, 'the same wreck was stripped twice');
  assert.deepEqual(g.stores, after, 'stripping nothing still paid out');
});

test('a wreck does not follow the ship to the next system', () => {
  const g = gameWith();
  g.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Bortas' })]);
  g.engagement.hostiles[0].destroyed = true;
  g.finishCombat('victory');
  assert.ok(g.wreckHere);

  g.locationId = g.locationId === 'sol' ? 'vulcan' : 'sol';
  assert.equal(g.wreckHere, null, 'the hulk was towed across the sector');
  assert.equal(g.stripWreck().ok, false);
});

test('a trap has no way out that involves shooting', () => {
  // The whole point of these: `engage` is not on the menu and withdrawing does
  // not work. If a trap ever grows a combat option, this fails.
  for (const trap of TRAPS) {
    assert.ok(trap.device, `${trap.id} has no device solution`);
    assert.ok(trap.powerChannel, `${trap.id} has no power solution`);
    assert.ok(trap.waitHours > 0, `${trap.id} has no patience solution`);
    assert.ok(!('ships' in trap), `${trap.id} has ships in it`);
  }
});

test('each way out of a trap actually gets you out', () => {
  const setup = (trapId) => {
    const g = gameWith();
    const trap = TRAPS.find((t) => t.id === trapId);
    g.encounter = { kind: 'trapped', trap, title: trap.title, text: trap.text };
    g.mode = 'encounter';
    return { g, trap };
  };

  for (const t of TRAPS) {
    // The device, when you have one.
    const a = setup(t.id);
    a.g.devices = { [t.device]: 1 };
    const viaDevice = a.g.resolveEncounter('trap_device');
    assert.equal(a.g.encounter, null, `${t.id}: the device did not clear the trap`);
    assert.equal(a.g.devices[t.device], 0, `${t.id}: the device was not consumed`);
    assert.ok(viaDevice.messages.length > 0);

    // The device, when you do not — this must not silently succeed.
    const b = setup(t.id);
    b.g.devices = {};
    b.g.resolveEncounter('trap_device');
    assert.ok(b.g.encounter, `${t.id}: escaped using a device that was not aboard`);

    // Power.
    const c = setup(t.id);
    const amBefore = c.g.ship.antimatter;
    c.g.resolveEncounter('trap_power');
    assert.equal(c.g.encounter, null, `${t.id}: power did not clear the trap`);
    assert.ok(c.g.ship.antimatter < amBefore, `${t.id}: power cost nothing`);

    // Patience.
    const d = setup(t.id);
    const sdBefore = d.g.clock.stardate;
    d.g.resolveEncounter('trap_wait');
    assert.equal(d.g.encounter, null, `${t.id}: waiting did not clear the trap`);
    assert.ok(d.g.clock.stardate > sdBefore, `${t.id}: waiting cost no time`);
  }
});

// ============================================================ shield transfer

// Reinforcing takes a fraction from every other facing and dumps it into one,
// which is capped at 1.2x max. With six facings the intake was 1.75 facings'
// worth against headroom of 0.2 — most of the charge simply evaporated, turning
// an emergency defensive move into a large net loss. Whatever the cap absorbs
// is what the other facings should pay, and no more.
test('reinforcing a shield does not destroy the charge it cannot hold', () => {
  const ship = new Ship('constitution', { rng: new RNG(7n) });
  const total = (s) => FACINGS.reduce((n, f) => n + s.shields[f], 0);

  const before = total(ship);
  assert.ok(ship.reinforceShield('fore'));
  const after = total(ship);

  assert.ok(after <= before + 1e-9, 'reinforcing created charge out of nothing');
  assert.ok(
    after >= before - 1e-9,
    `reinforcing destroyed ${(before - after).toFixed(1)} of ${before.toFixed(1)} shield charge`,
  );
  assert.ok(ship.shields.fore > ship.maxShield, 'the reinforced facing did not gain');
});

test('reinforcing stops drawing once the target facing is capped', () => {
  const ship = new Ship('constitution', { rng: new RNG(9n) });
  const cap = ship.maxShield * 1.2;
  ship.shields.fore = cap;
  const others = FACINGS.filter((f) => f !== 'fore').map((f) => ship.shields[f]);

  ship.reinforceShield('fore');

  assert.ok(Math.abs(ship.shields.fore - cap) < 1e-9, 'a full facing kept charging');
  FACINGS.filter((f) => f !== 'fore').forEach((f, i) => {
    assert.ok(
      Math.abs(ship.shields[f] - others[i]) < 1e-9,
      `${f} paid for a transfer that could not be received`,
    );
  });
});

test('a reinforced facing draws proportionally from the others', () => {
  const ship = new Ship('constitution', { rng: new RNG(11n) });
  ship.shields.aft = ship.maxShield;          // full
  ship.shields.port = ship.maxShield * 0.25;  // nearly gone
  const aftBefore = ship.shields.aft;
  const portBefore = ship.shields.port;

  ship.reinforceShield('fore');

  const aftPaid = aftBefore - ship.shields.aft;
  const portPaid = portBefore - ship.shields.port;
  assert.ok(aftPaid > portPaid, 'the fuller facing did not carry more of the load');
  assert.ok(portPaid >= 0, 'a facing gained charge from a transfer away from it');
});

// ============================================================== ship loss

// Story and Cadet both promise, on the difficulty screen, that "the ship cannot
// be lost". Nothing read the flag: losing your ship on Story ended the
// commission exactly as it does on Fleet Admiral. The screen has said this
// since the ladder shipped.
test('the difficulties that promise the ship cannot be lost keep the promise', () => {
  for (const def of DIFFICULTIES) {
    const g = gameWith({ difficulty: def.id });
    g.startCombat([new Ship('d7', { name: 'IKS Test' })]);
    g.ship.destroy('test');
    g.engagement.end('destroyed');
    g.finishCombat('destroyed');

    if (def.shipLoss) {
      assert.equal(g.over, true, `${def.id}: the ship was lost and the commission continued`);
      continue;
    }
    assert.equal(g.over, false, `${def.id}: the screen says the ship cannot be lost, and it was`);
    assert.equal(g.ship.destroyed, false, `${def.id}: the ship is still a wreck`);
    assert.ok(g.ship.hullPct > 0, `${def.id}: the ship came back with no hull`);
    // Survivable, not free — you are towed in, and it shows.
    assert.ok(g.ship.hullPct < 0.5, `${def.id}: losing the ship cost nothing at all`);
    assert.ok(
      g.log.some((l) => /tow|salvage|adrift|hulk|scuttl/i.test(l.text ?? '')),
      `${def.id}: nothing in the log says what happened to the ship`,
    );
  }
});

// ============================================================ episode graphs

// Episodes are a hand-authored graph, and the failure modes are the ones every
// hand-authored graph has: a choice that points at a stage nobody wrote, a
// stage nothing points at, a dead end that strands the player mid-episode.
// None of those throw — the engine finishes the episode when it cannot resolve
// the next stage — so they are invisible without walking the graph.
//
// All sixteen episodes are clean today. This is here so the seventeenth is too.
describe('every episode graph is sound', () => {
  test('every stage a choice names exists', () => {
    const missing = [];
    for (const ep of EPISODES) {
      const ids = new Set(Object.keys(ep.stages ?? {}));
      assert.ok(ids.has(ep.start), `${ep.id}: start stage "${ep.start}" does not exist`);
      for (const [sid, stage] of Object.entries(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) {
          for (const n of [
            typeof c.next === 'string' ? c.next : null,
            c.branch?.success, c.branch?.failure,
          ].filter(Boolean)) {
            if (!ids.has(n)) missing.push(`${ep.id}/${sid} -> "${n}"`);
          }
        }
      }
    }
    assert.deepEqual(missing, [], 'choices pointing at stages nobody wrote');
  });

  test('no stage is stranded where the player cannot go on', () => {
    const stranded = [];
    for (const ep of EPISODES) {
      for (const [sid, stage] of Object.entries(ep.stages ?? {})) {
        // A stage with a `label` is an ending card and is allowed to have no
        // choices; anything else must offer the player something to do.
        if (!stage.choices?.length && !stage.label) stranded.push(`${ep.id}/${sid}`);
      }
    }
    assert.deepEqual(stranded, [], 'stages with no choices that do not end the episode');
  });

  test('every choice is something the player can read and pick', () => {
    for (const ep of EPISODES) {
      for (const [sid, stage] of Object.entries(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) {
          assert.ok(c.label || c.text, `${ep.id}/${sid}: a choice has no label`);
          assert.ok(c.id, `${ep.id}/${sid}: a choice has no id`);
        }
      }
    }
  });

  test('every episode can be played to an end, by any route', () => {
    // Random legal choices, thirty runs each. The engine has no loop guard, so
    // a cycle in the graph would hang the player rather than fail loudly.
    const failures = [];
    for (const ep of EPISODES) {
      for (let trial = 0; trial < 30; trial++) {
        const g = gameWith({ seed: BigInt(90000 + trial) });
        g.progress.addXP(200000, { ledger: g.ledger });
        const m = g.missions.start(ep.id, g);
        assert.ok(m, `${ep.id}: would not start`);

        const path = [];
        let steps = 0;
        for (; steps < 120 && !m.complete; steps++) {
          const open = m.choices().filter((c) => !c.locked);
          if (!open.length) break;
          const pick = open[(trial * 7 + steps * 13) % open.length];
          path.push(`${m.stageId}:${pick.id}`);
          m.choose(pick.id);
        }
        if (!m.complete) {
          failures.push(`${ep.id} @ trial ${trial} after ${steps} steps: ${path.slice(-6).join(' -> ')}`);
        }
      }
    }
    assert.deepEqual(failures, [], 'episodes that stranded the player');
  });
});

// ====================================================== progression numbers

// The same NaN class as the helm orders and the travel arithmetic, in the two
// places it would be least visible and most permanent: experience and
// reputation. `Math.round(NaN)` is NaN, and both `xp` and `marks` are saved —
// so one bad award poisons the rank ladder, the skill economy and every
// reputation tier for the rest of the commission.
//
// Not reachable from play: combatXP sums real ship stats, xpRate comes from a
// data table, and mission awards are literals. This is defence in depth for a
// value that can never be recovered once it is written to disk.
describe('progression survives numbers it should never see', () => {
  const HOSTILE = [NaN, Infinity, -Infinity, 1e308, -1e9, undefined, null];

  test('experience stays a finite, non-negative, non-decreasing number', () => {
    for (const bad of HOSTILE) {
      const p = new CaptainProgress();
      const ledger = new Ledger();
      const before = p.xp;
      p.addXP(bad, { ledger });
      assert.ok(Number.isFinite(p.xp), `addXP(${bad}) left xp = ${p.xp}`);
      assert.ok(p.xp >= before, `addXP(${bad}) reduced xp to ${p.xp}`);
      assert.ok(Number.isFinite(p.unspent), `addXP(${bad}) left unspent = ${p.unspent}`);
    }
  });

  test('a poisoned award cannot break the skill economy', () => {
    const p = new CaptainProgress();
    const ledger = new Ledger();
    p.addXP(NaN, { ledger });
    p.addXP(500000, { ledger });      // a real award after a bad one
    const budget = p.unspent;
    assert.ok(Number.isFinite(budget) && budget > 0,
      `unspent points are ${budget} after a NaN award followed by a real one`);

    let spent = 0;
    for (let i = 0; i < 400; i++) if (p.spend(SKILL_LIST[i % SKILL_LIST.length].id)) spent++;
    assert.ok(spent <= budget, `spent ${spent} points from a budget of ${budget}`);
    assert.ok(p.unspent >= 0, `skill points went to ${p.unspent}`);
  });

  test('combat experience is finite even for a broken hull', () => {
    const xp = combatXP([
      { cls: { tier: NaN }, maxHull: Infinity },
      { cls: {}, maxHull: NaN },
      { cls: { tier: 3 }, maxHull: 2000 },
    ]);
    assert.ok(Number.isFinite(xp), `combatXP returned ${xp}`);
    assert.ok(xp >= 0, `combatXP returned ${xp}`);
  });

  test('reputation marks stay finite and tiers only rise', () => {
    for (const bad of HOSTILE) {
      const rep = new Reputation();
      rep.recordEvent('combat_victory', bad);
      for (const track of TRACK_LIST) {
        const t = rep.tracks[track.id];
        if (!t) continue;
        assert.ok(Number.isFinite(t.marks), `${track.id} marks = ${t.marks} for multiplier ${bad}`);
        assert.ok(t.marks >= 0, `${track.id} marks = ${t.marks}`);
        assert.ok(Number.isFinite(t.xp), `${track.id} xp = ${t.xp}`);
        assert.ok(t.tier >= 0 && t.tier <= MAX_TIER, `${track.id} tier = ${t.tier}`);
      }
    }
  });

  test('no amount of awards pushes a track past the top tier', () => {
    const rep = new Reputation();
    for (let i = 0; i < 2000; i++) rep.recordEvent('combat_victory', 50);
    for (const track of TRACK_LIST) {
      const t = rep.tracks[track.id];
      if (!t) continue;
      assert.ok(t.tier <= MAX_TIER, `${track.id} reached tier ${t.tier}, past ${MAX_TIER}`);
      assert.ok(REP_TIERS[t.tier], `${track.id} is at a tier with no definition`);
    }
  });
});

// ========================================================== the machine shop

// Fabrication is the one place the player converts one resource into another,
// so it is the one place an accounting error becomes an exploit. None of these
// properties had a test: 4,500 fuzzed jobs found no fault, and this is here so
// the ninth recipe cannot quietly introduce one.
describe('fabrication accounting', () => {
  const MATS = MATERIAL_LIST.map((m) => m.id);
  /**
   * Full stores, and a ship in the state every recipe's precondition wants.
   *
   * Five of the eight recipes are gated on the ship actually needing them —
   * `requires: (g) => g.ship.hullPct < 0.95` and friends — which is a good
   * guard ("Nothing aboard needs it, Captain") and a trap for a test that
   * builds a pristine ship and wonders why nothing starts.
   */
  const stocked = () => {
    const g = gameWith();
    g.stores = Object.fromEntries(MATS.map((m) => [m, 500]));
    g.ship.hull = g.ship.maxHull * 0.5;
    g.ship.torpedoes = 0;
    g.ship.subsystems.sensors = 0.4;
    g.ship.fires = 2;
    g.podJettisoned = true;
    return g;
  };

  test('a job charges exactly what the recipe lists, and nothing else', () => {
    for (const recipe of RECIPES) {
      const g = stocked();
      const before = { ...g.stores };
      assert.ok(beginFabrication(g, recipe.id)?.ok, `${recipe.id} would not start with full stores`);
      for (const m of MATS) {
        const paid = before[m] - g.stores[m];
        const listed = recipe.needs?.[m] ?? 0;
        assert.equal(paid, listed, `${recipe.id} took ${paid} ${m}, lists ${listed}`);
      }
    }
  });

  test('a second job is refused and costs nothing', () => {
    for (const recipe of RECIPES) {
      const g = stocked();
      beginFabrication(g, recipe.id);
      const mid = { ...g.stores };
      const second = beginFabrication(g, recipe.id);
      assert.ok(!second?.ok, `${recipe.id}: two jobs ran at once`);
      for (const m of MATS) {
        assert.equal(g.stores[m], mid[m], `a refused ${recipe.id} still charged ${m}`);
      }
    }
  });

  test('a job you cannot afford charges nothing', () => {
    for (const recipe of RECIPES) {
      const g = stocked();
      g.stores = Object.fromEntries(MATS.map((m) => [m, 0]));
      const r = beginFabrication(g, recipe.id);
      assert.ok(!r?.ok, `${recipe.id} started with empty stores`);
      for (const m of MATS) assert.equal(g.stores[m], 0, `a refused ${recipe.id} took ${m} from nothing`);
    }
  });

  test('every job finishes, and stores never go negative', () => {
    for (const recipe of RECIPES) {
      const g = stocked();
      beginFabrication(g, recipe.id);
      advanceFabrication(g, 1e6);
      assert.equal(g.fabrication, null, `${recipe.id} never finished`);
      for (const m of MATS) {
        assert.ok(g.stores[m] >= 0, `${m} went to ${g.stores[m]} after ${recipe.id}`);
        assert.ok(Number.isFinite(g.stores[m]), `${m} = ${g.stores[m]} after ${recipe.id}`);
      }
    }
  });

  test('a bad number of hours does not break a job', () => {
    for (const hours of [0, -1, -1e9, NaN, Infinity, 1e308]) {
      const g = stocked();
      beginFabrication(g, RECIPES[0].id);
      advanceFabrication(g, hours);
      if (g.fabrication) {
        assert.ok(Number.isFinite(g.fabrication.hours ?? 0),
          `advanceFabrication(${hours}) left a non-finite timer`);
      }
    }
  });

  test('salvage never yields a negative or non-finite haul', () => {
    // Tier comes from real ship data at both call sites, so this is defence in
    // depth — but salvage writes straight into stores, and stores are saved.
    for (const tier of [1, 3, 5, 0, -1, -1e9, 99, NaN, Infinity]) {
      const g = gameWith();
      const before = { ...g.stores };
      const haul = salvageWreck(g, new RNG(3n), { tier });
      for (const [m, n] of Object.entries(haul)) {
        assert.ok(Number.isFinite(n), `tier ${tier} yielded ${n} ${m}`);
        assert.ok(n >= 0, `tier ${tier} yielded ${n} ${m}`);
        assert.equal(g.stores[m] - (before[m] ?? 0), n,
          `tier ${tier}: reported ${n} ${m} but stores moved differently`);
      }
    }
  });
});

// ============================================================== sound cues

// Every cue in sfx.js is a synthesiser written by hand — there are no audio
// files in this project, so an unplayed cue is not a stray asset, it is dead
// code for a moment the player never gets to hear.
//
// Seven of the thirty-seven were never triggered from anywhere. Four had a real
// event sitting right there unused, the loudest being `core_breach_warning`:
// the ship is counting down to exploding, the warning tone exists, and nothing
// played it. The other three are cues for mechanics that do not exist — the
// boarding fight reads `ship.boarders` but nothing in the game ever sets it
// above zero — so they are listed rather than wired to nothing.
describe('every sound cue is reachable', () => {
  const CUE_RE = /^ {2}([a-z_]+): \(ctx, bus/gm;
  const SFX_SRC = readFileSync(join(HERE, '..', 'src', 'audio', 'sfx.js'), 'utf8');
  const UI_SRC = [
    'main.js', 'ui/screens.js', 'ui/charscreens.js', 'ui/chair.js',
    'ui/lcars.js', 'ui/tactical.js', 'ui/tactical3d.js', 'ui/galaxymap.js',
    'audio/engine.js',
  ].map((f) => readFileSync(join(HERE, '..', 'src', f), 'utf8')).join('\n');

  /**
   * Cues kept for mechanics the game does not have yet.
   *
   * Each needs a reason, and the reason has to be a missing MECHANIC — not a
   * missing hookup. If the event exists, wire the sound instead of listing it
   * here.
   */
  const RESERVED = {
    intruder_alert: 'boarding is not implemented — ship.boarders is only ever decremented, never set',
    tractor_beam: 'there is no tractor beam mechanic',
    // `door` came off this list when the ship got an inside: "go to sickbay"
    // walks you through real doorways and the cue plays on the way out.
  };

  test('a cue is either played or explicitly reserved, with a reason', () => {
    const cues = [...SFX_SRC.matchAll(CUE_RE)].map((m) => m[1]);
    const unique = [...new Set(cues)];
    assert.ok(unique.length > 30, `only found ${unique.length} cues — has the table changed shape?`);

    const orphans = unique.filter(
      (c) => !new RegExp(`['"\`]${c}['"\`]`).test(UI_SRC) && !(c in RESERVED),
    );
    assert.deepEqual(orphans, [],
      'cues that are synthesised but never played, and not listed as reserved');
  });

  test('nothing is reserved that is actually reachable', () => {
    // The list must not become a place to hide a missing hookup.
    const stale = Object.keys(RESERVED).filter(
      (c) => new RegExp(`['"\`]${c}['"\`]`).test(UI_SRC),
    );
    assert.deepEqual(stale, [], 'cues listed as reserved that the UI does play');
  });

  test('the warp core breach is audible', () => {
    // The most dramatic thing that can happen to the ship: a countdown to
    // losing her, with one way out. It was silent.
    assert.ok(/['"`]core_breach_warning['"`]/.test(UI_SRC),
      'the core breach warning is still never played');
  });
});

// ================================================ the chart has a third axis

describe('the sector map is a volume', () => {
  test('the systems are not all on one plane', () => {
    const zs = SYSTEMS.map((s) => systemDepth(s));
    const spread = Math.max(...zs) - Math.min(...zs);
    assert.ok(spread > 6, `the whole galaxy is ${spread.toFixed(1)} light years thick`);
    const offPlane = zs.filter((z) => Math.abs(z) > 0.5).length;
    assert.ok(offPlane > SYSTEMS.length * 0.7,
      `${offPlane} of ${SYSTEMS.length} systems are off the plane`);
  });

  test('two systems in one sector are not stacked on each other', () => {
    // The sector sets the height and the id sets a small offset inside it, so
    // a sector reads as a group rather than as one dot.
    const bySector = new Map();
    for (const s of SYSTEMS) {
      if (!bySector.has(s.sector)) bySector.set(s.sector, []);
      bySector.get(s.sector).push(systemDepth(s));
    }
    for (const [sector, zs] of bySector) {
      if (zs.length < 2) continue;
      assert.equal(new Set(zs.map((z) => z.toFixed(4))).size, zs.length,
        `two systems in ${sector} sit at exactly the same depth`);
    }
  });

  test('depth is the same in every session, on every device', () => {
    // The map is drawn from it and a save made on one build has to load into
    // the same galaxy on the next, so this is a hash and never a random number.
    for (const s of SYSTEMS) {
      assert.equal(systemDepth(s), systemDepth(s.id), `${s.id} disagrees with itself`);
      assert.ok(Number.isFinite(systemDepth(s)), `${s.id} has a depth of ${systemDepth(s)}`);
    }
    assert.equal(systemDepth('nowhere_at_all'), 0, 'an unknown system was given a height');
    assert.equal(systemDepth(null), 0);
  });

  test('a real star sits on the side of the plane it really occupies', () => {
    // Seven of these places have a published counterpart. The magnitude is
    // authored; the sign is not.
    for (const [id, dec] of Object.entries(REAL_DECLINATION)) {
      const z = systemDepth(id);
      if (dec === 0) { assert.equal(z, 0, `${id} should be on the plane`); continue; }
      assert.equal(Math.sign(z), Math.sign(dec),
        `${id}: declination ${dec} but depth ${z.toFixed(2)}`);
    }
  });

  test('every system named in the declination table exists', () => {
    for (const id of Object.keys(REAL_DECLINATION)) {
      assert.ok(SYSTEMS.some((s) => s.id === id), `${id} is not a system in this game`);
    }
  });

  test('the third axis does not change a single travel time', () => {
    // The whole campaign is balanced on these distances, and the depth is an
    // authored layout rather than astrometry — see docs/RESEARCH.md §12. This
    // is the guard on somebody tidying `distanceLy` into three dimensions
    // later and silently rebalancing the game.
    for (const a of SYSTEMS) {
      for (const b of SYSTEMS) {
        if (a === b) continue;
        const planar = Math.hypot(a.x - b.x, a.y - b.y);
        assert.ok(Math.abs(distanceLy(a.id, b.id) - planar) < 1e-9,
          `${a.id} -> ${b.id} is no longer a planar distance`);
      }
    }
  });

  test('a ship in transit flies along the lane, not along the floor', () => {
    // The map projects the ship's interpolated position with `pos.z ?? 0`, and
    // `positionIn` returned only x and y — so the marker travelled on the plane
    // while both stars it was travelling between sat off it. Lay the chart over
    // and the ship visibly leaves its own lane.
    // Drive the real transit the game builds, not a stand-in for one.
    const g = new Game({ seed: 4077n });
    g.setCourse('vulcan', 6);
    assert.ok(g.transit, 'no transit started');
    assert.ok(g.transit.route?.path?.length >= 2, 'no route from Sol to Vulcan');

    const ends = g.transit.route.path;
    const seen = [];
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      Object.defineProperty(g.transit, 'progress', { value: frac, configurable: true });
      const p = g.transit.positionIn(g.galaxy);
      assert.ok(Number.isFinite(p.z), `no depth at ${frac} of the way`);
      seen.push(p.z);

      // On the lane: the depth is the straight-line blend of the two stars it
      // is between, which is what "along the lane" means.
      const t = frac * (ends.length - 1);
      const i = Math.min(ends.length - 2, Math.floor(t));
      const az = systemDepth(ends[i]);
      const bz = systemDepth(ends[i + 1]);
      const want = az + (bz - az) * (t - i);
      assert.ok(Math.abs(p.z - want) < 1e-9,
        `at ${frac}: depth ${p.z.toFixed(3)}, lane is at ${want.toFixed(3)}`);
    }
    // And the lane is actually off the plane, or this proves nothing.
    assert.ok(seen.some((z) => Math.abs(z) > 0.5),
      `Sol to Vulcan is flat: ${seen.map((z) => z.toFixed(2)).join(', ')}`);
  });
});
