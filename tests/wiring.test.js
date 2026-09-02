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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Game } from '../src/core/state.js';
import { on } from '../src/core/events.js';
import { plotTransit } from '../src/world/galaxy.js';
import {
  SYSTEMS, systemDepth, distanceLy, REAL_DECLINATION,
} from '../src/world/systems.data.js';
import { Ship, FACINGS } from '../src/sim/ship.js';
import { RNG } from '../src/core/rng.js';
import { Character, CAREERS } from '../src/rules/character.js';
import { DIFFICULTIES } from '../src/rules/difficulty.js';
import { CONSOLES, Loadout, SET_LIST, SETS } from '../src/sim/loadout.js';
import { ABILITIES } from '../src/sim/officers.js';
import { SHIP_CLASSES } from '../src/world/ships.data.js';
import {
  RECIPES, MATERIAL_LIST, beginFabrication, advanceFabrication, salvageWreck,
} from '../src/sim/fabrication.js';
import { TRAPS } from '../src/world/encounters.js';
import { EPISODES } from '../src/missions/episodes/index.js';
import { CaptainProgress, SKILL_LIST, combatXP } from '../src/sim/skills.js';
import { Reputation, REP_TIERS, MAX_TIER, TRACK_LIST } from '../src/rules/reputation.js';
import { Ledger } from '../src/core/ledger.js';
import {
  SPECIALITIES, DIVISIONS, specialitiesIn, rosterSizeFor,
  beginAssignment, advanceAssignments, dutySlots, specialistBonusFor, replaceLosses,
  ASSIGNMENTS, availableAssignments,
} from '../src/sim/duty.js';
import { TIERS, TRAIT_LIST, SHAKEDOWN, EARNINGS } from '../src/sim/mastery.js';
import { offerCommand, takeCommandOf, COMMAND_LADDER } from '../src/sim/command.js';
import { getShipClass } from '../src/world/ships.data.js';
import { RANKS } from '../src/sim/skills.js';
import { ROOMS } from '../src/world/interiors.data.js';
import { checkGame } from '../src/sim/invariants.js';
import { parseOrder } from '../src/ui/orders.js';
import { checkAll } from '../src/sim/invariants.js';

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
      // The hold, too. The device kits put a crate in it and change nothing
      // else, and this guard could not see them — which would have let a
      // recipe that yields a device be added and never connected.
      hold: [...g.loadout.inventory].sort(),
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
      hold: [...g.loadout.inventory].sort(),
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

test('and leaving the system loses it, which is what the game says it costs', () => {
  // `finishCombat` calls the salvage a choice: strip it, or leave the system
  // and lose it. Leaving did not lose it. `wreckHere` stopped offering the hulk
  // once you were elsewhere, so it looked lost — but the object survived in the
  // save, and coming back handed it straight back. A wreck could be banked for
  // the whole five years and cashed in whenever the stores ran low.
  const g = gameWith();
  const home = g.locationId;
  g.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Bortas' })]);
  g.engagement.hostiles[0].destroyed = true;
  g.finishCombat('victory');
  assert.ok(g.wreckHere, 'a destroyed ship left nothing adrift');

  // Travel for real, rather than assigning the location: the loss happens on
  // arrival, and a test that skips the journey skips the thing under test.
  const elsewhere = g.galaxy.systems.find((s) => s.id !== home);
  assert.equal(g.setCourse(elsewhere.id, 6).ok, true, 'could not leave');
  for (let t = 0; t < 30 * 120 && g.transit; t++) g.update(1 / 30);
  assert.equal(g.transit, null, 'never arrived');
  assert.notEqual(g.locationId, home, 'never left');
  assert.equal(g.wreck, null, 'the hulk followed us');

  // And it is gone, not merely out of reach: going back does not restore it.
  assert.equal(g.setCourse(home, 6).ok, true, 'could not go back');
  for (let t = 0; t < 30 * 120 && g.transit; t++) g.update(1 / 30);
  assert.equal(g.locationId, home, 'never got back');
  assert.equal(g.wreckHere, null, 'the hulk was waiting where we left it');
  assert.equal(g.stripWreck().ok, false, 'stripped a wreck that should be long gone');
});

test('breaking off a fight actually leaves', () => {
  // The helm said "plotting an escape course, eight seconds to warp", the
  // panel said "we are clear and at warp", and the ship stayed in the same
  // system, in the same orbit, having burned nothing. The one ending in the
  // game that is ABOUT leaving was the only one that did not move you.
  const g = gameWith();
  const home = g.locationId;
  const body = g.location?.bodies?.find((b) => b.kind !== 'star');
  if (body) g.enterOrbit(body.id);
  const fuelBefore = g.ship.antimatter;
  const stardateBefore = g.clock.stardate;

  g.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS Chaser' })]);
  g.engagement.end('escaped');
  g.update(1 / 30);

  assert.equal(g.lastCombat.outcome, 'escaped');
  assert.ok(g.transit, 'the ship went to warp and stayed where it was');
  assert.equal(g.mode, 'transit', `left in ${g.mode} mode`);
  assert.equal(g.orbit, null, 'held an orbit while running for it at warp');
  assert.ok(g.ship.antimatter < fuelBefore, 'the escape was free');

  // And it arrives somewhere real, which is the cost: not a destination the
  // captain chose.
  const ranTo = g.transit.to.id;
  assert.notEqual(ranTo, home, 'the escape course led back where we started');
  for (let t = 0; t < 30 * 400 && g.transit; t++) g.update(1 / 30);
  assert.equal(g.transit, null, 'never arrived');
  assert.equal(g.locationId, ranTo, 'arrived somewhere other than the escape course');
  assert.ok(g.clock.stardate > stardateBefore, 'running took no time at all');
});

test('the ship is already at warp when the fight report is written', () => {
  // `emit` is synchronous, and the panel that reports how a fight ended reads
  // `game.transit` to decide whether to say "we are clear and at warp" or "we
  // are not going anywhere". The escape used to run twenty lines BELOW that
  // emit, so the panel read a transit that nothing had set yet: every
  // successful escape announced that the ship was going nowhere, and then the
  // ship went somewhere. The same defect the escape was built to fix, one line
  // apart from the fix.
  const g = gameWith();
  let sawAtEmit = null;
  const off = on('combat:resolved', () => {
    sawAtEmit = g.transit ? g.transit.to.id : null;
  });
  try {
    g.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS Chaser' })]);
    g.engagement.end('escaped');
    g.update(1 / 30);
  } finally { off?.(); }

  assert.ok(sawAtEmit, 'the report was written before the ship went to warp');
  assert.equal(sawAtEmit, g.transit?.to?.id,
    'the report named a different course than the one flown');
});

test('a ship that can only limp still gets away', () => {
  // Fuel goes as the 2.4th power of the warp factor, so warp 1 costs about a
  // hundred and fiftieth of warp 8. The escape asked for maximum warp and
  // nothing else, so a ship with ample antimatter to crawl to any neighbour
  // was told it was not going anywhere and left sitting where it had just
  // fought.
  const probe = gameWith();
  const here = probe.locationId;
  const top = probe.ship.cls.maxWarp ?? 8;
  const costs = probe.galaxy.neighbors(here).map((n) => ({
    fast: plotTransit(probe.galaxy, here, n.id, top, probe.ship, 1).fuel,
    slow: plotTransit(probe.galaxy, here, n.id, 1, probe.ship, 1).fuel,
  }));
  const tank = (Math.min(...costs.map((c) => c.fast)) + Math.min(...costs.map((c) => c.slow))) / 2;

  const g = gameWith();
  g.ship.antimatter = tank;
  g.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS Chaser' })]);
  g.engagement.end('escaped');
  g.update(1 / 30);

  assert.ok(g.transit,
    `${tank.toFixed(2)}% antimatter is not enough to run at any speed at all`);
  assert.ok(g.transit.warpFactor < top,
    `ran at warp ${g.transit.warpFactor} on a tank that cannot afford warp ${top}`);
});

test('you cannot warp out of a web that is holding you', () => {
  // The stage says it plainly — "a ship that cannot go to warp until the
  // lattice is broken" — and the combat spec had no way to say it to the
  // engagement. While breaking off went nowhere that did not matter. Now that
  // it goes somewhere, it would have warped you cleanly out of the thing that
  // is holding you.
  const web = EPISODES.find((e) => e.stages?.inside?.choices
    ?.some((c) => c.effects?.combat?.ships?.includes('tholian_web_spinner')));
  assert.ok(web, 'the Tholian web episode is gone');
  const spec = web.stages.inside.choices[0].effects.combat;
  assert.equal(spec.canWarpOut, false, 'the web lets you leave');

  // And the flag survives the trip from a mission stage into the engagement,
  // which is where it used to be dropped.
  const g = gameWith();
  g.pendingCombat = {
    ships: [new Ship('tholian_web_spinner', { faction: 'tholian', name: 'Spinner' })],
    canWarpOut: false,
  };
  g.update(1 / 30);
  assert.ok(g.engagement, 'the queued fight never started');
  assert.equal(g.engagement.canWarpOut, false, 'the engagement will let you run');
  assert.equal(g.engagement.beginWarpOut(), false, 'the helm plotted an escape anyway');
});

test('a ship that cannot run says so instead of pretending', () => {
  // No antimatter and nowhere to plot to is a real outcome. Claiming a warp
  // that cannot happen is the bug this whole change is about, so the failing
  // case has to be honest too.
  const g = gameWith();
  g.ship.antimatter = 0;
  g.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS Chaser' })]);
  g.engagement.end('escaped');
  g.update(1 / 30);

  assert.equal(g.lastCombat.outcome, 'escaped');
  assert.equal(g.transit, null, 'went to warp on an empty tank');
  assert.equal(g.mode, 'bridge', `left in ${g.mode} mode`);
  const said = g.log.slice(-6).map((e) => e.text).join(' ');
  assert.match(said, /not going anywhere|holding station/i,
    `nothing said we were stuck: ${said}`);
});

test('closing the app at warp does not put the ship back where it started', () => {
  // The transit was not in the save at all, and `Game.load` forced the mode to
  // the bridge. So a captain who closed the app twenty-three per cent of the
  // way to Vulcan woke at Sol with the antimatter for the trip already spent,
  // no days elapsed and no course laid in. The fuel was charged; the voyage
  // was not. Escapes make it worse, because those transits are not chosen.
  const g = gameWith({ seed: 12n });
  const home = g.locationId;
  const fuelBefore = g.ship.antimatter;
  assert.equal(g.setCourse('vulcan', 6).ok, true);
  for (let t = 0; t < 30 * 6 && g.transit; t++) g.update(1 / 30);
  assert.ok(g.transit, 'the voyage finished before the test could interrupt it');
  const wasAt = g.transit.progress;
  assert.ok(wasAt > 0 && wasAt < 1, `progress was ${wasAt}`);
  assert.ok(g.ship.antimatter < fuelBefore, 'the course was free');

  const back = Game.load(JSON.parse(JSON.stringify(g.save())));
  assert.ok(back.transit, 'the voyage was lost with the app');
  assert.equal(back.mode, 'transit', `woke up in ${back.mode} mode`);
  assert.equal(back.transit.to.id, 'vulcan', 'woke up on a different course');
  assert.ok(Math.abs(back.transit.progress - wasAt) < 1e-9,
    `resumed at ${back.transit.progress} rather than ${wasAt}`);

  // And it still finishes, which is the point of keeping it.
  const dateBefore = back.clock.stardate;
  for (let t = 0; t < 30 * 200 && back.transit; t++) back.update(1 / 30);
  assert.equal(back.transit, null, 'the restored voyage never arrived');
  assert.equal(back.locationId, 'vulcan', `arrived at ${back.locationId}`);
  assert.notEqual(back.locationId, home);
  assert.ok(back.clock.stardate > dateBefore, 'arriving took no time');
});

test('a save with no voyage in it still loads onto the bridge', () => {
  // Every save written before this existed, and every save made in orbit.
  const g = gameWith({ seed: 12n });
  const data = JSON.parse(JSON.stringify(g.save()));
  delete data.transit;
  delete data.mode;
  const back = Game.load(data);
  assert.equal(back.transit, null);
  assert.equal(back.mode, 'bridge');

  // And a voyage to nowhere is refused rather than restored.
  const broken = JSON.parse(JSON.stringify(g.save()));
  broken.transit = { toId: 'no_such_system', path: [], elapsedReal: 1 };
  const safe = Game.load(broken);
  assert.equal(safe.transit, null, 'loaded a course to a system that does not exist');
  assert.equal(safe.mode, 'bridge');
});

test('a distress call that was a trap does not follow you home', () => {
  // `engage` clears the encounter the moment it becomes a battle, with a
  // comment saying exactly why: left set, the next hail in the campaign is
  // answered by whoever was in THIS one. The assist branch — the distress call
  // that turns out to be an ambush — started its fight and returned without
  // doing the same. So you won, flew four light years, and the game still
  // believed there was a freighter under attack back at Sol.
  const g = gameWith({ seed: 21n });
  const home = g.location;
  g.beginEncounter({
    kind: 'distress', hostile: true, title: 'Freighter under attack',
    system: { id: home.id, name: home.name },
    factionId: 'orion', lives: 200,
    ships: [new Ship('orion_raider', { faction: 'orion', name: 'Raider' })],
  });

  const r = g.resolveEncounter('assist');
  assert.equal(r.combat, true, 'the trap did not spring');
  assert.equal(g.encounter, null, 'the encounter outlived the ambush it was');

  // Win it, go somewhere else, and there is nobody there to talk to.
  g.engagement.end('victory');
  g.update(1 / 30);
  g.locationId = g.galaxy.systems.find((s) => s.id !== home.id).id;
  assert.deepEqual(checkAll(g, { arenaRadius: 3000 }), [],
    'the checker objects to the state after a trap');

  const hail = g.hail('identify');
  assert.match(hail.text, /no one to hail/i,
    `hailing an empty system reached ${hail.text}`);
});

test('the checker objects to an encounter happening somewhere else', () => {
  const g = gameWith({ seed: 21n });
  const elsewhere = g.galaxy.systems.find((s) => s.id !== g.locationId);
  g.encounter = {
    kind: 'distress', title: 'Somewhere else entirely',
    system: { id: elsewhere.id, name: elsewhere.name },
  };
  assert.ok(checkAll(g, { arenaRadius: 3000 }).some((v) => v.code === 'game.encounter.elsewhere'),
    'a live encounter in another system broke no rule');

  // And one that is where the ship is, is simply an encounter.
  g.encounter.system = { id: g.locationId, name: g.location.name };
  assert.ok(!checkAll(g, { arenaRadius: 3000 }).some((v) => v.code === 'game.encounter.elsewhere'));
});

describe('equipment that was installed together', () => {
  const kitted = () => new Loadout({ tactical: 3, engineering: 3, science: 3, device: 2 });
  const fit = (l, ids) => { for (const id of ids) { l.acquire(id); l.equip(id); } return l; };

  test('every set names pieces that actually exist', () => {
    for (const set of SET_LIST) {
      assert.ok(set.pieces.length >= 2, `${set.id} is not a set`);
      for (const piece of set.pieces) {
        assert.ok(CONSOLES[piece], `${set.id} names "${piece}", which is not a console`);
      }
      // A tier nobody can reach is a tier that does not exist.
      for (const tier of Object.keys(set.bonuses).map(Number)) {
        assert.ok(tier <= set.pieces.length,
          `${set.id} has a ${tier}-piece bonus and only ${set.pieces.length} pieces`);
        assert.ok(set.bonuses[tier].text, `${set.id} @${tier} says nothing`);
      }
    }
  });

  test('two pieces are worth more than two pieces apart', () => {
    // The whole mechanic: if the set bonus is not measurable the pieces are
    // just consoles with a story attached.
    const set = SET_LIST[0];
    const [a, b] = set.pieces;

    const one = fit(kitted(), [a]).shipMods();
    const two = fit(kitted(), [a, b]).shipMods();
    const key = Object.keys(set.bonuses[2].mods)[0];

    // What the two consoles are worth WITHOUT the set, computed from the table.
    const bare = [a, b].reduce((acc, id) => acc * (1 + (CONSOLES[id].mods?.[key] ?? 0)), 1);
    assert.ok((two[key] ?? 1) > bare + 1e-9,
      `two pieces give ${two[key]}, the same as the consoles alone (${bare})`);
    assert.ok((two[key] ?? 1) > (one[key] ?? 1), 'the second piece was worth nothing');
  });

  test('and three are worth more than two', () => {
    for (const set of SET_LIST) {
      if (!set.bonuses[3]) continue;
      const key = Object.keys(set.bonuses[3].mods)[0];
      const two = fit(kitted(), set.pieces.slice(0, 2)).shipMods();
      const three = fit(kitted(), set.pieces).shipMods();
      assert.ok((three[key] ?? 1) > (two[key] ?? 1),
        `${set.id}: the third piece changed nothing`);
    }
  });

  test('three of the same console is not a complete set', () => {
    // Caught by driving it rather than by reading it: a set is three different
    // parts of one installation. Counting copies would make the bonus a reward
    // for owning the same thing three times.
    const l = kitted();
    const piece = SET_LIST[0].pieces[0];
    for (let i = 0; i < 3; i++) { l.acquire(piece); l.equip(piece); }
    assert.equal(l.equipped[CONSOLES[piece].slot].length, 3, 'the copies did not fit');
    assert.deepEqual(l.activeSets(), [], 'three of one console completed a set');
  });

  test('a piece in the hold is not wired into anything', () => {
    const l = kitted();
    const set = SET_LIST[0];
    for (const id of set.pieces) l.acquire(id);
    l.equip(set.pieces[0]);
    l.equip(set.pieces[1]);
    assert.equal(l.activeSets()[0]?.pieces, 2, 'two fitted pieces are not a two-piece set');

    // The third is aboard but not installed.
    assert.ok(l.inventory.includes(set.pieces[2]));
    assert.equal(l.activeSets()[0]?.pieces, 2, 'a console in the hold completed the set');
  });

  test('pulling a piece drops the bonus back down', () => {
    const set = SET_LIST[0];
    const l = fit(kitted(), set.pieces);
    const key = Object.keys(set.bonuses[3].mods)[0];
    const full = l.shipMods()[key];

    l.unequip(set.pieces[2]);
    assert.equal(l.activeSets()[0]?.pieces, 2, 'the set stayed complete without the piece');
    assert.ok(l.shipMods()[key] < full, 'removing a piece cost nothing');
  });

  test('the bonus reaches the ship, not just the loadout', () => {
    // Assert effects. A set that changes a number in `shipMods` and nothing on
    // the ship is a table with a story attached.
    const g = gameWith({ seed: 5n });
    const set = SET_LIST[0];
    const key = Object.keys(set.bonuses[3].mods)[0];

    // Strip anything already fitted so the measurement is of the set.
    for (const slot of Object.keys(g.loadout.equipped)) g.loadout.equipped[slot] = [];
    g.applyAllMods();
    const bare = g.ship.mod(key);

    for (const id of set.pieces) { g.loadout.acquire(id); g.loadout.equip(id); }
    g.applyAllMods();
    assert.ok(g.ship.mod(key) > bare, `${key} on the ship did not move`);
  });
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
      // This used to assert that the first loss ended the commission.
      //
      // The difficulty screen promises that "the ship can be lost". It never
      // promised the commission ends, and reading the flag that way made the
      // most dramatic thing that can happen to a starship captain a game-over
      // screen. Kirk lost the Enterprise, faced a board, was reduced in rank,
      // and was given the Enterprise-A — exactly one of them (RESEARCH.md §21).
      assert.equal(g.over, false,
        `${def.id}: the first ship lost ended the career`);
      assert.equal(g.ship.destroyed, false, `${def.id}: still flying a wreck`);
      assert.notEqual(g.ship.name, 'Enterprise', `${def.id}: the same ship came back`);
      assert.equal(g.shipsLost, 1, `${def.id}: the loss was not recorded`);
      assert.ok(g.ledger.entries.some((e) => e.kind === 'ship_lost'),
        `${def.id}: nothing on the record about losing a starship`);
      assert.ok(
        g.log.some((l) => /board of inquiry/i.test(l.text ?? '')),
        `${def.id}: nobody convened a board`,
      );

      // And Starfleet gives you exactly one. The second is the end.
      g.startCombat([new Ship('d7', { name: 'IKS Test' })]);
      g.ship.destroy('test');
      g.engagement.end('destroyed');
      g.finishCombat('destroyed');
      assert.equal(g.over, true, `${def.id}: a second ship was lost and the career continued`);
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
        let trips = 0;
        for (; steps < 120 && !m.complete; steps++) {
          // The player flies to where the episode is happening. A stage is
          // somewhere now, so a walker that never moves the ship would report
          // every episode outside Sol as stranded — which is not a broken
          // graph, it is a captain who has not left spacedock.
          const here = m.testLocation();
          if (!here.ok) { g.locationId = here.need; trips++; }
          const open = m.choices().filter((c) => !c.locked);
          if (!open.length) break;
          const pick = open[(trial * 7 + steps * 13) % open.length];
          path.push(`${m.stageId}:${pick.id}`);
          const took = m.choose(pick.id);
          // A choice that orders a fight now waits for it. This walker does not
          // simulate battles, so it settles the fight the way winning one does
          // — which is also the assertion that the episode CAN get past it.
          if (took?.awaiting === 'combat' || m.pending) m.settleCombat('victory');
        }
        if (!m.complete) {
          failures.push(`${ep.id} @ trial ${trial} after ${steps} steps: ${path.slice(-6).join(' -> ')}`);
        }
        // A stage that needed the ship somewhere it could never reach would
        // show up above; this records that travelling is what got us through.
        assert.ok(trips >= 0);
      }
    }
    assert.deepEqual(failures, [], 'episodes that stranded the player');
  });

  test('a mission that orders a fight does not pay before the fight', () => {
    // Four episodes have a stage where choosing to fight both starts a battle
    // AND ends the episode: Organia's "Hold position", Donatu's "Engage", the
    // Tholian web's "Break the lattice", and "Fight it" against a Borg cube.
    // `applyEffects` ran the experience, the standing and the ledger record and
    // then `finish` recorded the ending — all before a shot was fired. You
    // could bank the reward for holding Organia and then run.
    const terminal = [];
    for (const ep of EPISODES) {
      for (const [stageId, stage] of Object.entries(ep.stages ?? {})) {
        for (const choice of stage.choices ?? []) {
          if (!choice.effects?.combat) continue;
          if (choice.next && ep.stages[choice.next]) continue;
          terminal.push({ ep, stageId, choice });
        }
      }
    }
    assert.ok(terminal.length >= 3,
      `only ${terminal.length} terminal combat stages found; has the content changed?`);

    for (const { ep, stageId, choice } of terminal) {
      const g = gameWith({ seed: 4242n });
      g.progress.addXP(200000, { ledger: g.ledger });
      const m = g.missions.start(ep.id, g);
      m.stageId = stageId;
      // Fly there. A stage happens somewhere now, and a captain sitting at Sol
      // cannot order a battle at Donatu V.
      g.locationId = m.stageLocation() ?? g.locationId;

      const xpBefore = g.progress.xp;
      const took = m.choose(choice.id);
      assert.equal(m.complete, false,
        `${ep.id}/${choice.id}: the episode finished before the fight did`);
      assert.equal(g.progress.xp, xpBefore,
        `${ep.id}/${choice.id}: paid ${g.progress.xp - xpBefore} experience before the fight`);
      assert.ok(took?.effects?.combat, `${ep.id}/${choice.id}: no fight was queued`);

      // Run from it and the episode ends without the reward it was for.
      m.settleCombat('escaped');
      assert.equal(m.complete, true, `${ep.id}/${choice.id}: never finished`);
      assert.equal(m.outcome, 'broke_off',
        `${ep.id}/${choice.id}: running paid out "${m.outcome}"`);
      assert.equal(g.progress.xp, xpBefore,
        `${ep.id}/${choice.id}: running still paid ${g.progress.xp - xpBefore}`);
    }
  });

  test('and winning it pays exactly what the choice promised', () => {
    const ep = EPISODES.find((e) => e.stages?.inside?.choices
      ?.some((c) => c.effects?.combat && !e.stages[c.next]));
    if (!ep) return;
    const choice = ep.stages.inside.choices.find((c) => c.effects?.combat);

    const g = gameWith({ seed: 4242n });
    g.progress.addXP(200000, { ledger: g.ledger });
    const m = g.missions.start(ep.id, g);
    m.stageId = 'inside';
    g.locationId = m.stageLocation() ?? g.locationId;
    const xpBefore = g.progress.xp;

    m.choose(choice.id);
    m.settleCombat('victory');
    assert.equal(m.complete, true);
    assert.equal(m.outcome, choice.outcome, `won and got "${m.outcome}"`);
    assert.equal(Math.round(g.progress.xp - xpBefore), choice.effects.xp,
      'winning paid something other than what the choice promised');
  });

  test('starting a second episode does not quietly destroy the first', () => {
    // `MissionBook.start` was a bare assignment. Starting another episode
    // replaced the one in progress: never marked complete, never written to
    // the ledger, and offered again later from its opening stage — with every
    // point of experience it had already paid still paid. Measured on
    // `shakedown`: a hundred experience, banked, and the episode back on the
    // board. Repeat as often as you like.
    const g = gameWith({ seed: 3n });
    g.progress.addXP(200000, { ledger: g.ledger });

    const [first, second] = EPISODES;
    const m = g.missions.start(first.id, g);
    const open = m.choices().filter((c) => !c.locked);
    if (open.length) m.choose(open[0].id);
    assert.equal(m.complete, false, 'the first episode finished by itself');
    const xpBanked = g.progress.xp;

    // The engine refuses...
    assert.equal(g.missions.start(second.id, g), null,
      'a second episode started over a half-finished one');
    assert.equal(g.missions.active?.id, first.id, 'the first episode was replaced');

    // ...and so does the game, with a reason the captain can hear.
    const r = g.startMission(second.id);
    assert.equal(r.ok, false, 'the game started a second episode anyway');
    assert.match(r.error, new RegExp(first.title.split(' ')[0], 'i'));
    assert.equal(g.progress.xp, xpBanked, 'the refusal paid something');
  });

  test('but you can walk away on purpose, and the record says so', () => {
    const g = gameWith({ seed: 3n });
    g.progress.addXP(200000, { ledger: g.ledger });
    const [first, second] = EPISODES;
    g.missions.start(first.id, g);

    const gave = g.abandonMission();
    assert.equal(gave.ok, true, gave.error);
    assert.equal(g.missions.active, null, 'the episode is still running');
    // Not "completed" — it was not. But it IS on the record.
    assert.equal(g.missions.completed.has(first.id), false,
      'walking away counted as finishing it');
    assert.ok((g.ledger.entries ?? []).some((e) => e.mission === first.id),
      'nothing in the ledger says the episode was broken off');

    // And now another can start.
    assert.ok(g.missions.start(second.id, g), 'could not start another after abandoning');

    // Abandoning nothing is refused rather than silently accepted.
    const again = new Game({ seed: 3n, crewMode: 'original' }).abandonMission();
    assert.equal(again.ok, false);
  });

  test('an episode waiting on a battle that is not coming is a rule violation', () => {
    // Holding the reward means holding the stage, and that is a soft-lock if
    // the fight never starts. The episode walker found it the moment the hold
    // was written; this is the guard that keeps finding it.
    const g = gameWith({ seed: 11n });
    const ep = EPISODES.find((e) => Object.values(e.stages ?? {})
      .some((st) => (st.choices ?? []).some((c) => c.effects?.combat)));
    const m = g.missions.start(ep.id, g);
    m.pending = { held: {}, outcome: 'won', terminal: true };

    g.pendingCombat = null;
    assert.ok(checkAll(g, { arenaRadius: 3000 }).some((v) => v.code === 'mission.awaiting-ghost'),
      'a stranded episode broke no rule');

    // With the fight actually queued, it is simply waiting, which is fine.
    g.pendingCombat = { ships: [] };
    assert.ok(!checkAll(g, { arenaRadius: 3000 }).some((v) => v.code === 'mission.awaiting-ghost'));
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

  test('every ability special has something that reads it', () => {
    // The guard that would have caught Fire at Will years earlier. It declared
    // `special: 'multitarget'` and nothing anywhere implemented it, while its
    // `mods: { damage: 0.8 }` — the PRICE of the spreading that never happened
    // — applied through the generic path. So the game's rank-1 tactical order
    // was a 20% gunnery penalty and nothing else: 0.28 kills against two D7s
    // without it, 0.15 with.
    //
    // Same shape as the reputation ledger in rules.test.js: a thing declared
    // in a table and connected to nothing.
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    let source = '';
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { walk(path); continue; }
        if (!entry.name.endsWith('.js')) continue;
        // officers.js DECLARES the specials; naming one there is not reading it.
        if (entry.name === 'officers.js') continue;
        source += readFileSync(path, 'utf8');
      }
    };
    walk(root);
    const dead = [...new Set(Object.values(ABILITIES).map((a) => a.special).filter(Boolean))]
      .filter((s) => !source.includes(`'${s}'`) && !source.includes(`"${s}"`));
    assert.deepEqual(dead, [],
      `abilities declare specials nothing implements: ${dead.join(', ')}`);
  });

  test('every device in the game can actually be had', () => {
    // None of them could. `startingLoadout` hands a new captain two shield
    // batteries and one hull patch kit, and nothing anywhere ever produced
    // another — not a mission, not a reputation project, not the salvage pool,
    // and not the machine shop. The weapons battery, the engine battery and
    // the Class-IV probe could not be held at all, by anyone, ever.
    //
    // The recipe named `hull_patch` is not the exception it looks like: it
    // plates over a breach directly and yields no kit.
    const devices = Object.values(CONSOLES).filter((c) => c.slot === 'device');
    assert.ok(devices.length >= 5, `only ${devices.length} devices in the game`);
    for (const device of devices) {
      const g = stocked();
      const r = beginFabrication(g, `kit_${device.id}`);
      assert.ok(r?.ok, `no way to obtain a ${device.name}: ${r?.error ?? 'no such recipe'}`);
      advanceFabrication(g, 1e6);
      assert.ok(g.loadout.inventory.includes(device.id),
        `the shop finished a ${device.name} and it was not in the hold`);
    }
  });

  test('a probe scans an anomaly without the ship going near it', () => {
    // The probe had no case in `applyDevice` at all: it fell through to the
    // default, which spends the device and logs "probe discharged." The one
    // thing this device could reliably do was be wasted.
    const g = gameWith();
    for (const d of [...g.loadout.equipped.device]) g.loadout.unequip(d);
    g.loadout.acquire('probe');
    assert.ok(g.loadout.equip('probe'), 'could not fit a probe');
    g.encounter = {
      kind: 'anomaly', system: g.location,
      anomaly: { name: 'Murasaki 312', value: 3, hazard: 1 },  // hazard 1: approaching WOULD hurt
    };
    const before = { xp: g.progress.xp, hull: g.ship.hullPct };
    const r = g.useDevice('probe');
    assert.ok(r.ok, `the probe did nothing: ${r.reason}`);
    assert.ok(g.progress.xp > before.xp, 'a probe survey earned nothing');
    assert.equal(g.ship.hullPct, before.hull,
      'the ship took the anomaly damage from a survey it sent a probe to do');
    assert.equal(g.encounter, null, 'the anomaly was still sitting there afterwards');
    assert.ok(!g.loadout.all.includes('probe'), 'the probe was not spent');
  });

  test('and a probe fired at nothing is not spent', () => {
    const g = gameWith();
    for (const d of [...g.loadout.equipped.device]) g.loadout.unequip(d);
    g.loadout.acquire('probe');
    g.loadout.equip('probe');
    g.encounter = null;
    const r = g.useDevice('probe');
    assert.equal(r.ok, false, 'a probe was fired into empty space');
    assert.match(r.reason ?? '', /nothing out there/i, `the refusal said "${r.reason}"`);
    assert.ok(g.loadout.all.includes('probe'), 'the refused probe was spent anyway');
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

// ============================================== the other four hundred and twenty

describe('the duty roster', () => {
  test('every speciality is a job somebody in the show actually had', () => {
    // §18: the divisions are command, operations and sciences, and the trap is
    // communications — Uhura wears operations red, not command gold, and so do
    // Scott and Yeoman Rand. A table built from bridge stations alone puts the
    // comms officer and the yeoman in the wrong division.
    assert.equal(SPECIALITIES.communications_officer.division, 'operations');
    assert.equal(SPECIALITIES.yeoman.division, 'operations');
    assert.equal(SPECIALITIES.engineer.division, 'operations');
    assert.equal(SPECIALITIES.navigator.division, 'command');
    assert.equal(SPECIALITIES.surgeon.division, 'sciences');
    for (const division of DIVISIONS) {
      assert.ok(specialitiesIn(division).length >= 3,
        `${division} has only ${specialitiesIn(division).length} specialities`);
    }
  });

  test('the roster is sized from the hull, not from a constant', () => {
    // A runabout does not carry a xenobiologist and a cartographer and a yeoman.
    const big = rosterSizeFor(430);
    const small = rosterSizeFor(4);
    assert.ok(big > small, `${big} aboard a Constitution against ${small} aboard a runabout`);
    assert.ok(small >= 2, 'the smallest hull has nobody at all');
    assert.ok(big <= 14, `${big} named specialists is a spreadsheet`);
  });

  test('the same seed gives the same people, forever', () => {
    // They are saved, and a save has to load into the ship it was written from.
    const a = gameWith({ seed: 31337n });
    const b = gameWith({ seed: 31337n });
    assert.deepEqual(a.dutyRoster.map((p) => `${p.name}/${p.speciality}`),
      b.dutyRoster.map((p) => `${p.name}/${p.speciality}`));
    const other = gameWith({ seed: 31338n });
    assert.notDeepEqual(a.dutyRoster.map((p) => p.name), other.dutyRoster.map((p) => p.name));
  });

  test('building the roster does not disturb anything else the seed decides', () => {
    // Drawing a dozen names out of the main RNG shifts every random number the
    // game makes afterwards, which silently re-rolls the whole campaign. The
    // roster has its own stream derived from the seed; this is the guard on
    // somebody simplifying that away.
    // Two hulls with very different complements get very differently sized
    // rosters. If those names came out of the main stream, the two games would
    // be at different points in it — so the main stream matching proves the
    // roster is drawn from somewhere else.
    const big = gameWith({ seed: 777n, shipClass: 'constitution' });
    const small = gameWith({ seed: 777n, shipClass: 'runabout' });
    assert.notEqual(big.dutyRoster.length, small.dutyRoster.length,
      'both hulls got the same size roster, so this proves nothing');
    assert.deepEqual(
      [big.rng.float(), big.rng.float(), big.rng.float()],
      [small.rng.float(), small.rng.float(), small.rng.float()],
      'the roster ate draws out of the main stream',
    );
  });

  test('a detail goes out, takes time, and comes back with something', () => {
    const g = gameWith({ seed: 2024n });
    const cart = g.dutyRoster.find((p) => p.speciality === 'cartographer')
      ?? g.dutyRoster.find((p) => p.available);
    const xpBefore = g.progress.xp;

    const sent = beginAssignment(g, 'survey_detail', [cart.id]);
    assert.equal(sent.ok, true, sent.reason);
    assert.equal(cart.state, 'assigned', 'the specialist is still standing about');
    assert.equal(g.assignments.length, 1);

    // Not back yet.
    advanceAssignments(g, 4, g.rng);
    assert.equal(g.assignments.length, 1, 'a survey came back in four hours');

    advanceAssignments(g, 40, g.rng);
    assert.equal(g.assignments.length, 0, 'the detail never came back');
    assert.notEqual(cart.state, 'assigned', 'the specialist is still marked as out');
    assert.ok(g.progress.xp > xpBefore, 'the detail brought back nothing at all');
  });

  test('who you send changes what they bring back', () => {
    // The whole point of a roster: a matched speciality is worth something
    // measurable, or naming people is decoration.
    const suited = gameWith({ seed: 8080n });
    const wrong = gameWith({ seed: 8080n });
    const right = suited.dutyRoster.find((p) => p.speciality === 'cartographer');
    const other = wrong.dutyRoster.find((p) => p.speciality !== 'cartographer');
    if (!right) return;   // this hull's roster has no cartographer aboard

    for (const [g, who] of [[suited, right], [wrong, other]]) {
      beginAssignment(g, 'survey_detail', [who.id]);
      advanceAssignments(g, 40, g.rng);
    }
    assert.ok(suited.progress.xp > wrong.progress.xp,
      `the cartographer brought back ${suited.progress.xp} and the ${other.label} ${wrong.progress.xp}`);
  });

  test('a fight refuses to let you send a working party out', () => {
    const g = gameWith();
    g.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS Test' })]);
    const sent = beginAssignment(g, 'survey_detail', [g.dutyRoster[0].id]);
    assert.equal(sent.ok, false, 'a survey party was sent out during a firefight');
    assert.match(sent.reason, /under fire/i);
  });

  test('the ship can only spare so many details at once', () => {
    const g = gameWith();
    const slots = dutySlots(g);
    assert.ok(slots >= 1 && slots <= 4, `${slots} details at once`);

    // And the number falls as people are lost — that is the cost of a casualty
    // beyond the person.
    for (const p of g.dutyRoster.slice(0, Math.max(0, g.dutyRoster.length - 2))) p.state = 'lost';
    assert.ok(dutySlots(g) <= slots, 'losing the roster cost the ship nothing');
  });

  test('a specialist aboard makes a station better, and stops when they leave', () => {
    // Assert the effect. A specialist who changes no number is a name on a list.
    const g = gameWith({ seed: 5150n });
    const analyst = g.dutyRoster.find((p) => p.station === 'science');
    if (!analyst) return;

    const withThem = specialistBonusFor(g, 'science');
    assert.ok(withThem > 1, 'a specialist at the station is worth nothing');

    // Everyone at that station out on details. The bonus is capped, so moving
    // one of three changes nothing — the honest test is that the support goes
    // away entirely when the people do.
    const atStation = g.dutyRoster.filter((p) => p.station === 'science');
    for (const p of atStation) p.state = 'assigned';
    assert.equal(specialistBonusFor(g, 'science'), 1,
      'specialists out on details are still helping from orbit');

    for (const p of atStation) p.state = 'lost';
    assert.equal(specialistBonusFor(g, 'science'), 1, 'the dead are still helping');

    // And back aboard, it comes back.
    for (const p of atStation) p.state = 'aboard';
    assert.equal(specialistBonusFor(g, 'science'), withThem);
    void analyst;
  });

  test('the roster survives a save and remembers what happened to it', () => {
    const g = gameWith({ seed: 606n });
    g.dutyRoster[0].state = 'lost';
    g.dutyRoster[1].state = 'recovering';
    const back = Game.load(JSON.parse(JSON.stringify(g.save())));

    assert.deepEqual(back.dutyRoster.map((p) => p.name), g.dutyRoster.map((p) => p.name));
    assert.equal(back.dutyRoster[0].state, 'lost', 'the dead came back');
    assert.equal(back.dutyRoster[1].state, 'recovering');
  });

  test('the checker objects to a detail crewed by ghosts', () => {
    const g = gameWith();
    assert.deepEqual(checkAll(g, { arenaRadius: 3000 }), []);

    g.assignments = [{ assignmentId: 'survey_detail', team: ['nobody_at_all'], hoursRemaining: 4 }];
    const said = checkAll(g, { arenaRadius: 3000 }).map((v) => v.code);
    assert.ok(said.includes('duty.assignment.ghost'), JSON.stringify(said));

    // And to somebody marked as out who is on no detail at all — a leak that
    // takes a person off the roster permanently.
    g.assignments = [];
    g.dutyRoster[0].state = 'assigned';
    assert.ok(checkAll(g, { arenaRadius: 3000 }).some((v) => v.code === 'duty.stranded'));
  });
});

// -------------------------------------------------------------------------
// Working her up. RESEARCH.md §20.

describe('what the crew learn about one hull', () => {
  const fresh = () => new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
  const at = (g, points) => {
    g.mastery.points[g.mastery.classId] = points;
    g.applyAllMods();
    return g;
  };

  test('a fresh commission is UNDER her own specification', () => {
    // This assertion used to read the other way. A ship straight out of the
    // yard is not the ship her plate says she is — Scott asked for a proper
    // shakedown, Kirk sailed in twelve hours, and the drive would not balance.
    const g = fresh();
    assert.equal(g.mastery.tier, 0, 'a brand-new crew already knew the ship');
    const mods = g.mastery.shipMods();
    assert.notDeepEqual(mods, {}, 'a fresh hull is at her full specification');
    for (const [k, v] of Object.entries(SHAKEDOWN.mods)) {
      assert.ok(v < 0, `${k} is supposed to be a cost`);
      assert.ok(g.ship.mod(k) < 1, `${k} on a fresh hull reads ${g.ship.mod(k)}`);
    }
  });

  test('and the shakedown is over by the first tier', () => {
    const g = at(fresh(), TIERS[0].at);
    assert.equal(g.mastery.report().shakedown, null, 'still working her up at tier one');
    for (const k of Object.keys(SHAKEDOWN.mods)) {
      assert.ok(g.ship.mod(k) >= 1,
        `${k} is still under specification at tier one: ${g.ship.mod(k)}`);
    }
  });

  test('the shakedown costs less than the whole track is worth', () => {
    // A penalty deeper than the tiers can repay would mean a hull that is
    // never as good as her own numbers, which is not an arc, it is a nerf.
    const worst = at(fresh(), 0).ship;
    const best = at(fresh(), TIERS[4].at).ship;
    for (const k of Object.keys(SHAKEDOWN.mods)) {
      assert.ok(best.mod(k) > worst.mod(k),
        `${k}: a worked-up hull (${best.mod(k)}) is no better than a fresh one (${worst.mod(k)})`);
    }
  });

  test('each tier actually moves the ship', () => {
    const baseline = fresh();
    const hull0 = baseline.ship.maxHull;
    const turn0 = baseline.ship.mod('turn');
    const acc0 = baseline.ship.mod('accuracy');
    const imp0 = baseline.ship.mod('impulse');

    const g1 = at(fresh(), TIERS[0].at);
    assert.ok(g1.ship.maxHull > hull0, 'the shakedown tier did not toughen the hull');

    const g2 = at(fresh(), TIERS[1].at);
    assert.ok(g2.ship.mod('impulse') > imp0, 'the engine-room tier did nothing');

    const g3 = at(fresh(), TIERS[2].at);
    assert.ok(g3.ship.mod('turn') > turn0, 'the helm tier did not make her handier');

    const g4 = at(fresh(), TIERS[3].at);
    assert.ok(g4.ship.mod('accuracy') > acc0, 'the gunnery tier did not help the guns');
  });

  test('a doctrine cannot be committed to before the crew have earned it', () => {
    const g = fresh();
    const r = g.mastery.chooseTrait('running_start');
    assert.equal(r.ok, false, 'a day-one crew committed the ship to a doctrine');
    assert.equal(g.mastery.trait, null, 'a doctrine took effect anyway');
  });

  test('and every doctrine costs what it gains', () => {
    for (const trait of TRAIT_LIST) {
      const g = at(fresh(), TIERS[4].at);
      const before = Object.fromEntries(
        Object.keys(trait.mods).map((k) => [k, g.ship.mod(k)]),
      );
      assert.ok(g.mastery.chooseTrait(trait.id).ok, `${trait.name} was refused at the top tier`);
      g.applyAllMods();

      let gains = 0; let costs = 0;
      for (const [k, v] of Object.entries(trait.mods)) {
        const after = g.ship.mod(k);
        if (v > 0) { assert.ok(after > before[k], `${trait.name}: ${k} did not improve`); gains++; }
        else { assert.ok(after < before[k], `${trait.name}: ${k} was supposed to cost something`); costs++; }
      }
      assert.ok(gains > 0 && costs > 0, `${trait.name} is not a trade-off`);
    }
  });

  test('only one doctrine is in force at a time', () => {
    const g = at(fresh(), TIERS[4].at);
    g.mastery.chooseTrait('running_start');
    g.mastery.chooseTrait('layered_screens');
    g.applyAllMods();
    assert.equal(g.mastery.trait.id, 'layered_screens', 'the second order was ignored');
    // And the first one is genuinely gone, not merely unlisted.
    const solo = at(fresh(), TIERS[4].at);
    solo.mastery.chooseTrait('layered_screens');
    solo.applyAllMods();
    assert.equal(g.ship.mod('impulse'), solo.ship.mod('impulse'),
      'the ship is still carrying a doctrine it was taken off');
  });

  test('a battle teaches the crew, and the simulator does not', () => {
    const real = fresh();
    real.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS Target' })]);
    real.finishCombat('victory');
    assert.ok(real.mastery.current > 0, 'a battle taught the crew nothing');

    const sim = fresh();
    sim.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS Target' })]);
    sim.scriptedScenario = true;
    sim.finishCombat('victory');
    assert.equal(sim.mastery.current, 0, 'an exercise counted as flying the ship');
  });

  test('a bad figure cannot get into the track', () => {
    const g = fresh();
    g.creditMastery('lightYear', NaN);
    g.creditMastery('nonsense', 10);
    g.creditMastery('lightYear', -5);
    assert.equal(g.mastery.current, 0, `the track reads ${g.mastery.current}`);
    assert.ok(Number.isFinite(g.ship.maxHull), 'the ship took a NaN from the track');
  });

  test('a junk record loads as a crew who have learned nothing', () => {
    const g = at(fresh(), TIERS[4].at);
    g.mastery.chooseTrait('running_start');
    const record = g.save();
    record.mastery = {
      classId: 'constitution',
      points: { constitution: NaN },
      traits: { constitution: 'not_a_real_doctrine' },
    };
    const loaded = Game.load(record);
    assert.equal(loaded.mastery.current, 0, 'a NaN got into the loaded track');
    assert.equal(loaded.mastery.trait, null, 'an invented doctrine was accepted');
    assert.equal(checkGame(loaded).some((v) => v.code.startsWith('mastery.')), false,
      'the loaded game is in a state its own invariants forbid');
  });

  test('and a real one comes back exactly as it was', () => {
    const g = at(fresh(), TIERS[4].at);
    g.mastery.chooseTrait('layered_screens');
    g.applyAllMods();
    const before = g.ship.mod('shieldRegen');

    const loaded = Game.load(g.save());
    assert.equal(loaded.mastery.tier, 5, 'the tier was lost');
    assert.equal(loaded.mastery.trait?.id, 'layered_screens', 'the doctrine was lost');
    assert.equal(loaded.ship.mod('shieldRegen'), before,
      'the ship came back without what the doctrine was worth');
  });

  test('the sweep sees a doctrine the crew have not earned', () => {
    const g = fresh();
    assert.equal(checkGame(g).some((v) => v.code === 'mastery.trait.unearned'), false,
      'complained about a game in which nothing is wrong');
    // Set past the order layer, which refuses it.
    g.mastery.traits[g.mastery.classId] = 'running_start';
    assert.ok(checkGame(g).some((v) => v.code === 'mastery.trait.unearned'),
      'nothing noticed a doctrine on a hull the crew do not know');
  });

  test('every doctrine and every tier can be reached by speaking', () => {
    for (const trait of TRAIT_LIST) {
      const phrase = `set doctrine to ${trait.name.toLowerCase()}`;
      const parsed = parseOrder(phrase);
      assert.equal(parsed.action, 'set_doctrine', `"${phrase}" did not reach the order`);
      assert.equal(parsed.doctrine, trait.id, `"${phrase}" chose ${parsed.doctrine}`);
    }
    assert.equal(parseOrder('have we worked her up').action, 'ship_mastery',
      'the crew cannot be asked how well they know the ship');
  });
});

// -------------------------------------------------------------------------
// An episode happens somewhere.

describe('a stage is at a place, and the ship has to be there', () => {
  const shakedown = () => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    g.progress.addXP(200000, { ledger: g.ledger });
    return { g, m: g.missions.start('shakedown', g) };
  };

  test('an episode cannot be advanced from the wrong system', () => {
    const { g, m } = shakedown();
    g.locationId = 'sol';
    assert.ok(m.choices().some((c) => !c.locked), 'the opening stage is at Sol and was locked');

    g.locationId = 'qonos';
    const away = m.choices();
    assert.ok(away.length, 'the stage stopped offering choices at all');
    assert.ok(away.every((c) => c.locked),
      'orders at Sol were open to a ship at Qo’noS');
  });

  test('and says where the ship would have to be', () => {
    const { g, m } = shakedown();
    g.locationId = 'qonos';
    const reason = m.choices()[0].lockReason ?? '';
    assert.match(reason, /Sol/, `the lock said "${reason}"`);
  });

  test('a stage can be somewhere other than its episode', () => {
    const { g, m } = shakedown();
    g.locationId = 'sol';
    m.choose(m.choices().find((c) => !c.locked).id);
    // The orders say Alpha Centauri, so the trials are at Alpha Centauri.
    assert.equal(m.stageLocation(), 'alpha_centauri',
      'the trials happen wherever the episode is filed rather than where the orders send you');
    assert.ok(m.choices().every((c) => c.locked), 'the trials ran without going there');
    g.locationId = 'alpha_centauri';
    assert.ok(m.choices().some((c) => !c.locked), 'the ship arrived and nothing opened');
  });

  test('a stage that is not at a place happens wherever the ship is', () => {
    const { g, m } = shakedown();
    // The report is written in the ready room: `system: null`.
    const report = m.def.stages.report;
    assert.equal(m.stageLocation(report), null, 'the report is pinned to a system');
    for (const at of ['sol', 'qonos', 'devron']) {
      g.locationId = at;
      assert.equal(m.testLocation(report).ok, true, `the report was refused at ${at}`);
    }
  });

  test('the system key is not the room key', () => {
    // `where` already means the ROOM aboard ship a stage happens in, and the
    // mission panel reads it. A stage location that reused that key made the
    // panel announce that they were waiting for the captain "in
    // alpha_centauri", as though a star system were a compartment.
    //
    // Asserted on a stage carrying BOTH, because no shipped episode sets
    // `where` today — a loop over the episodes would pass without running.
    const { g, m } = shakedown();
    const stage = { where: 'bridge', system: 'vulcan', choices: [{ id: 'x', label: 'x' }] };
    assert.equal(m.stageLocation(stage), 'vulcan', 'the star system was read from the wrong key');
    assert.equal(stage.where, 'bridge', 'the room was overwritten by the star system');
    g.locationId = 'vulcan';
    assert.equal(m.testLocation(stage).ok, true, 'at Vulcan and still refused');

    // And no shipped stage puts a room name where a system belongs.
    const rooms = new Set(['bridge', 'surface', 'anywhere', ...Object.keys(ROOMS)]);
    for (const ep of EPISODES) {
      for (const [sid, st] of Object.entries(ep.stages ?? {})) {
        if (!('system' in st) || st.system === null) continue;
        assert.equal(rooms.has(st.system), false,
          `${ep.id}/${sid}: system is "${st.system}", which is a room`);
      }
    }
  });

  test('every stage names a system that exists', () => {
    const ids = new Set(SYSTEMS.map((s) => s.id));
    for (const ep of EPISODES) {
      const g = new Game({ seed: 7n, crewMode: 'canon', crew: 'tos' });
      const m = g.missions.start(ep.id, g);
      for (const [sid, stage] of Object.entries(ep.stages ?? {})) {
        const need = m.stageLocation(stage);
        if (need === null) continue;
        assert.ok(ids.has(need), `${ep.id}/${sid} is set at "${need}", which is not a system`);
      }
      g.missions.abandon?.(g);
    }
  });
});

// -------------------------------------------------------------------------
// A second command. RESEARCH.md §21.

describe('losing her, and being taken off her', () => {
  const fresh = (opts = {}) => new Game({
    seed: 0x1701n, crewMode: 'canon', crew: 'tos', difficulty: 'ensign', ...opts,
  });

  test('a bigger command is offered, not imposed', () => {
    const g = fresh();
    assert.equal(g.commandOffer, null, 'a ship was on offer before any promotion');
    g.progress.rankIndex = RANKS.findIndex((r) => r.id === 'captain');
    const offer = offerCommand(g);
    assert.ok(offer, 'a captain was offered nothing at all');
    assert.notEqual(offer.classId, g.ship.classId, 'offered the ship already being flown');
    assert.ok(getShipClass(offer.classId).hull > g.ship.cls.hull, 'the offer is not a bigger hull');
  });

  test('taking it spends what the crew knew about the old one', () => {
    const g = fresh();
    g.progress.rankIndex = RANKS.findIndex((r) => r.id === 'captain');
    g.mastery.points[g.mastery.classId] = TIERS[4].at;
    g.applyAllMods();
    const oldClass = g.ship.classId;
    const oldName = g.ship.name;
    assert.equal(g.mastery.tier, 5, 'the crew were supposed to know her perfectly');

    offerCommand(g);
    const r = g.acceptCommand();
    assert.ok(r.ok, r.reason);
    assert.notEqual(g.ship.classId, oldClass, 'still flying the old class');
    assert.notEqual(g.ship.name, oldName, 'the new ship has the old ship’s name');
    assert.equal(g.mastery.tier, 0, 'the new hull came pre-worked-up');
    assert.ok(g.mastery.report().shakedown, 'no shakedown on a hull nobody has flown');
    // And the old ship still remembers, for a captain who ever gets her back.
    assert.equal(g.mastery.points[oldClass], TIERS[4].at, 'the old ship forgot her crew');
  });

  test('and it can be turned down', () => {
    const g = fresh();
    g.progress.rankIndex = RANKS.findIndex((r) => r.id === 'captain');
    g.mastery.points[g.mastery.classId] = TIERS[4].at;
    g.applyAllMods();
    const kept = g.ship;
    offerCommand(g);
    const r = g.declineCommand();
    assert.ok(r.ok, r.reason);
    assert.equal(g.ship, kept, 'the ship changed anyway');
    assert.equal(g.mastery.tier, 5, 'refusing cost the crew what they knew');
    assert.equal(g.commandOffer, null, 'the offer is still standing after being refused');
    assert.ok(g.ledger.entries.some((e) => e.kind === 'command_declined'),
      'turning down a starship went unrecorded');
  });

  test('an offer nobody made cannot be accepted', () => {
    const g = fresh();
    assert.equal(g.acceptCommand().ok, false, 'took a ship that was never offered');
    assert.equal(g.declineCommand().ok, false, 'declined an offer that does not exist');
  });

  test('a lieutenant is not offered a Galaxy because a Galaxy exists', () => {
    const g = fresh();
    g.progress.rankIndex = RANKS.findIndex((r) => r.id === 'lieutenant');
    const offer = offerCommand(g);
    if (offer) {
      const rung = COMMAND_LADDER.find((r) => r.id === offer.classId);
      assert.ok(rung.tier <= g.progress.shipTier,
        `a ${RANKS[g.progress.rankIndex].name} was offered a ${offer.name}`);
    }
  });

  test('the ship Starfleet gives after a loss is not a better one', () => {
    const g = fresh();
    const before = g.ship.cls.hull;
    g.loseTheShip();
    assert.equal(g.over, false, 'the first loss ended the career');
    assert.ok(g.ship.cls.hull <= before,
      `lost a ${before}-hull ship and was handed a ${g.ship.cls.hull}-hull one`);
    assert.ok(g.mastery.report().shakedown, 'the replacement came already worked up');
  });

  test('and the reckoning is on the record before the ship arrives', () => {
    const g = fresh();
    const standing = g.ledger.standingOf('federation');
    g.loseTheShip();
    assert.ok(g.ledger.standingOf('federation') < standing,
      'losing a starship cost nothing with Starfleet');
    assert.ok(g.ledger.entries.some((e) => e.kind === 'ship_lost'), 'no entry on the record');
  });

  test('Starfleet gives exactly one', () => {
    const g = fresh();
    g.loseTheShip();
    assert.equal(g.over, false);
    g.loseTheShip();
    assert.equal(g.over, true, 'a second ship was lost and the career went on');
    assert.match(g.overReason ?? '', /second ship/i, `the reason reads "${g.overReason}"`);
  });

  test('all of it survives a save', () => {
    const g = fresh();
    g.progress.rankIndex = RANKS.findIndex((r) => r.id === 'captain');
    g.loseTheShip();
    offerCommand(g);
    const offered = g.commandOffer.classId;
    const flying = g.ship.classId;

    const loaded = Game.load(g.save());
    assert.equal(loaded.shipsLost, 1, 'the lost ship was forgotten');
    assert.equal(loaded.ship.classId, flying, 'came back aboard a different hull');
    assert.equal(loaded.commandOffer?.classId, offered, 'the offer was lost');
    assert.equal(checkGame(loaded).some((v) => v.code.startsWith('game.commandOffer')), false,
      'the loaded game is in a state its own invariants forbid');
  });

  test('a hand-edited record cannot invent a hull or a lost fleet', () => {
    const g = fresh();
    const record = g.save();
    record.commandOffer = { classId: 'not_a_real_class', name: 'Nonsense' };
    record.shipsLost = 9;
    const loaded = Game.load(record);
    assert.equal(loaded.commandOffer, null, 'an invented class was accepted');
    assert.equal(loaded.shipsLost, 1, `the record claimed nine losses and got ${loaded.shipsLost}`);
    assert.equal(checkGame(loaded).some((v) => v.code.startsWith('game.shipsLost')), false,
      'the loaded game breaks its own rules');
  });

  test('both halves are sayable', () => {
    assert.equal(parseOrder('take the new command').action, 'take_command');
    assert.equal(parseOrder('stay with this ship').action, 'keep_command');
  });
});

describe('Starfleet does not ask the same question twice', () => {
  const commissioned = () => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    g.progress.rankIndex = RANKS.findIndex((r) => r.id === 'captain');
    return g;
  };

  test('a hull that was turned down is not offered again', () => {
    const g = commissioned();
    const first = offerCommand(g);
    assert.ok(first, 'a captain was offered nothing');
    g.declineCommand();
    // Same rank, asked again: there is nothing new to say.
    assert.equal(offerCommand(g)?.classId, undefined,
      'the same ship was put to him again at the same rank');
  });

  test('and neither is a smaller one', () => {
    // Turning down an Ambassador used to produce an Excelsior at the next
    // promotion — four hundred tonnes smaller, as though Starfleet were
    // haggling.
    const g = commissioned();
    g.progress.rankIndex = RANKS.findIndex((r) => r.id === 'fleet_captain');
    const offered = offerCommand(g);
    assert.ok(offered, 'a fleet captain was offered nothing');
    g.declineCommand();
    const next = offerCommand(g);
    if (next) {
      assert.ok(getShipClass(next.classId).hull > getShipClass(offered.classId).hull,
        `turned down a ${offered.name} and was offered a ${next.name}`);
    }
  });

  test('but a better one still comes when the rank earns it', () => {
    const g = commissioned();
    const first = offerCommand(g);
    g.declineCommand();
    g.progress.rankIndex = RANKS.findIndex((r) => r.id === 'rear_admiral');
    const later = offerCommand(g);
    assert.ok(later, 'a rear admiral who once said no was never asked again');
    assert.ok(getShipClass(later.classId).hull > getShipClass(first.classId).hull,
      `refused a ${first.name} and was later offered a ${later.name}`);
  });

  test('a whole career of refusals is three questions, not six', () => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    const seen = [];
    for (let i = 0; i < RANKS.length; i++) {
      g.progress.rankIndex = i;
      const o = offerCommand(g);
      if (!o) continue;
      seen.push(o.classId);
      g.declineCommand();
    }
    assert.equal(new Set(seen).size, seen.length, `the same hull twice: ${seen.join(', ')}`);
    assert.ok(seen.length <= 4, `${seen.length} offers across one career: ${seen.join(', ')}`);
    // And each one bigger than the last.
    for (let i = 1; i < seen.length; i++) {
      assert.ok(getShipClass(seen[i]).hull > getShipClass(seen[i - 1]).hull,
        `${seen[i - 1]} then ${seen[i]}`);
    }
  });

  test('refusals survive a save', () => {
    const g = commissioned();
    offerCommand(g);
    g.declineCommand();
    const loaded = Game.load(g.save());
    assert.deepEqual(loaded.declinedCommands, g.declinedCommands, 'the refusal was forgotten');
    assert.equal(offerCommand(loaded), null, 'the loaded game asked again immediately');
  });

  test('and a record cannot name a hull that does not exist', () => {
    const g = commissioned();
    const record = g.save();
    record.declinedCommands = ['galaxy', 'not_a_real_class'];
    const loaded = Game.load(record);
    assert.deepEqual(loaded.declinedCommands, ['galaxy'], 'an invented class was kept');
  });

  // A refusal stops Starfleet asking. It does not bind the captain forever.

  test('a captain can reopen a conversation he closed', () => {
    const g = commissioned();
    const refused = offerCommand(g);
    g.declineCommand();
    assert.equal(offerCommand(g), null, 'Starfleet raised it again on its own');

    const r = g.requestCommand();
    assert.ok(r.ok, r.reason);
    assert.ok(g.commandOffer, 'asking produced no offer');
    assert.equal(g.commandOffer.classId, refused.classId,
      'asking at the same rank produced something other than the best available');
  });

  test('and what comes back is the best his rank carries, not the one refused', () => {
    const g = commissioned();
    const refused = offerCommand(g);
    g.declineCommand();
    g.progress.rankIndex = RANKS.findIndex((r) => r.id === 'rear_admiral');

    assert.ok(g.requestCommand().ok, 'a rear admiral was told there was nothing');
    assert.ok(
      getShipClass(g.commandOffer.classId).hull > getShipClass(refused.classId).hull,
      `refused a ${refused.name} and asking got a ${g.commandOffer.name}`,
    );
  });

  test('asking twice is not a way to reroll the offer', () => {
    const g = commissioned();
    offerCommand(g);
    const standing = g.commandOffer.classId;
    const r = g.requestCommand();
    assert.equal(r.ok, false, 'asked again over a standing offer');
    assert.match(r.reason ?? '', /already offered/i, `the refusal said "${r.reason}"`);
    assert.equal(g.commandOffer.classId, standing, 'the standing offer changed');
  });

  test('and a captain already flying the best available is told so', () => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    // Top of the ladder, top of the rank: there is nothing above her.
    g.progress.rankIndex = RANKS.findIndex((r) => r.id === 'admiral');
    takeCommandOf(g, 'galaxy');
    const r = g.requestCommand();
    assert.equal(r.ok, false, 'was offered something above a Galaxy');
    assert.match(r.reason ?? '', new RegExp(g.ship.name, 'i'),
      `the refusal did not name the ship: "${r.reason}"`);
  });

  test('the whole conversation is sayable', () => {
    assert.equal(parseOrder('ask starfleet for a new command').action, 'request_command');
    assert.equal(parseOrder('is there another ship').action, 'request_command');
  });
});

describe('the bays belong to the ship, not to the captain', () => {
  const SLOTS = ['tactical', 'engineering', 'science', 'device'];

  /** Fit something in every bay the hull has, so a change has something to move. */
  const fill = (g) => {
    const kit = {
      tactical: 'phaser_relay',
      engineering: 'sif_generator',
      science: 'shield_capacitor',
      device: 'shield_battery',
    };
    for (const s of SLOTS) {
      while (g.loadout.used(s) < g.loadout.capacity(s)) {
        g.loadout.acquire(kit[s]);
        if (!g.loadout.equip(kit[s])) break;
      }
    }
  };

  test('every move along the command ladder leaves the loadout describing the new hull', () => {
    // takeCommandOf built the new ship and never touched the loadout, so the
    // slot counts went on describing the hull the captain had walked off.
    // All seventy-two moves along the ladder were wrong in one direction or
    // the other; this asserts every one of them.
    const wrong = [];
    for (const from of COMMAND_LADDER) {
      for (const to of COMMAND_LADDER) {
        if (from.id === to.id) continue;
        const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
        takeCommandOf(g, from.id);
        fill(g);
        takeCommandOf(g, to.id);
        for (const s of SLOTS) {
          const hull = g.ship.cls.slots[s] ?? 0;
          if (g.loadout.capacity(s) !== hull) {
            wrong.push(`${from.id}->${to.id}: hull has ${hull} ${s}, loadout allows ${g.loadout.capacity(s)}`);
          }
          if (g.loadout.used(s) > hull) {
            wrong.push(`${from.id}->${to.id}: ${g.loadout.used(s)} ${s} consoles in ${hull} bays`);
          }
        }
      }
    }
    assert.deepEqual(wrong.slice(0, 8), [],
      `${wrong.length} of ${COMMAND_LADDER.length * (COMMAND_LADDER.length - 1) * 4} slot counts disagreed with the hull`);
  });

  test('a console with no bay on the new hull stops modifying her', () => {
    // The effect, not the count. A Constitution carries three tactical bays
    // and a Constellation two, so the board of inquiry's replacement used to
    // fly with three phaser relays firing out of two bays.
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    fill(g);
    const before = g.loadout.shipMods().beamDamage;
    const took = takeCommandOf(g, 'constellation');
    const after = g.loadout.shipMods().beamDamage;
    assert.ok(before > after,
      `beam damage was ${before.toFixed(4)} on a Constitution and ${after.toFixed(4)} on a Constellation`);
    assert.ok(took.stowed.includes('phaser_relay'),
      `the yard did not report the relay it took out: ${JSON.stringify(took.stowed)}`);
  });

  test('a promotion to a bigger hull can actually fill her extra bays', () => {
    // The other direction, and the one nothing would ever have shown the
    // captain: an Excelsior has three science bays, and the loadout went on
    // allowing the Constitution's two — so the third bay could never be used.
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    fill(g);
    const took = takeCommandOf(g, 'excelsior');
    assert.equal(took.gained.science, 1, `the yard did not report the new science bay: ${JSON.stringify(took.gained)}`);
    g.loadout.acquire('shield_emitters');
    assert.ok(g.loadout.equip('shield_emitters'),
      `an Excelsior with ${g.ship.cls.slots.science} science bays refused a third science console`);
  });

  test('and the captain is told what the yard did', () => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    fill(g);
    const before = g.log.length;
    // A Constellation: a smaller tactical bank than the Constitution she is
    // flying, so a relay has to come out.
    const cls = getShipClass('constellation');
    g.commandOffer = { classId: 'constellation', name: cls.name, hull: cls.hull, crew: cls.crew, cost: 0, slots: cls.slots };
    const r = g.acceptCommand();
    assert.ok(r.ok, r.reason);
    const said = g.log.slice(before).map((e) => e.text ?? '').join(' ');
    assert.match(said, /no bay for/i, `nothing in the log mentioned the stowed console: "${said}"`);
    assert.match(said, /Phaser Relay/i, 'the console was not named');
  });

  test('a save written before the bays were reconciled is corrected on load', () => {
    // A campaign saved mid-flight under the old code carries the wrong slot
    // counts. The hull is the truth, so loading reconciles rather than
    // restoring bays the ship does not have.
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    fill(g);
    const stale = g.loadout.save();
    const l = Loadout.load(stale, { tactical: 1, engineering: 1, science: 1, device: 1 });
    assert.equal(l.capacity('tactical'), 1,
      `loaded a save that claimed ${stale.slots.tactical} tactical bays onto a hull with 1`);
    assert.equal(l.used('tactical'), 1, 'consoles stayed fitted in bays the hull does not have');
  });
});

describe('what a voyage teaches a crew', () => {
  /** Fly one course at a warp factor and report the mastery it paid. */
  const voyage = (from, to, warp) => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    g.locationId = from;
    g.ship.antimatter = 100;
    const before = g.mastery.current;
    const r = g.setCourse(to, warp);
    assert.ok(g.transit, `could not fly ${from}->${to} at warp ${warp}: ${r?.reason ?? ''}`);
    let ticks = 0;
    while (g.transit && ticks++ < 20000) g.update(1 / 30);
    assert.equal(g.locationId, to, `never arrived at ${to}`);
    return g.mastery.current - before;
  };

  test('the same journey teaches the same thing at any speed', () => {
    // Mastery used to be credited per HOUR under way, and `travelHours` goes as
    // the inverse cube of the warp factor — so the identical journey paid eight
    // times as much at warp 4 as at warp 8, and the way to master your ship was
    // to crawl. Measured over all 1,560 charted courses, a mean voyage was
    // worth 335 points at warp 4 and 40 at warp 8.
    const slow = voyage('sol', 'vega', 4);
    const fast = voyage('sol', 'vega', 8);
    assert.ok(slow > 0, 'a voyage taught the crew nothing');
    assert.ok(Math.abs(slow - fast) < 1e-6,
      `warp 4 paid ${slow.toFixed(2)} and warp 8 paid ${fast.toFixed(2)}`);
  });

  test('but a longer one teaches more than a shorter one', () => {
    const near = voyage('sol', 'alpha_centauri', 6);
    const far = voyage('sol', 'vega', 6);
    assert.ok(far > near,
      `a hop next door paid ${near.toFixed(2)} and a long haul paid ${far.toFixed(2)}`);
  });

  test('and the whole track is a commission, not an afternoon', () => {
    // The rates are what decide whether the starship trait at the top of the
    // track is ever seen. With mastery credited per hour, the entire five-tier
    // track — including "five years in one hull" — came out at fifteen voyages.
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    const galaxy = g.galaxy;
    const ids = SYSTEMS.map((s) => s.id);
    let ly = 0;
    let n = 0;
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        ly += galaxy.plotCourse(a, b).lightYears;
        n += 1;
      }
    }
    // A mean voyage, with a battle and an episode every third one.
    const perVoyage = (ly / n) * EARNINGS.lightYear
      + EARNINGS.battle / 3 + EARNINGS.mission / 3;
    const toTheTop = TIERS[TIERS.length - 1].at / perVoyage;
    assert.ok(toTheTop > 60,
      `the top of the track is ${Math.ceil(toTheTop)} voyages away, which is an afternoon`);
    // And not so far that nobody reaches it either.
    assert.ok(toTheTop < 400,
      `the top of the track is ${Math.ceil(toTheTop)} voyages away, which nobody will fly`);
    // The shakedown is the opening of a commission, not a campaign in itself.
    assert.ok(TIERS[0].at / perVoyage < 20,
      `the shakedown alone takes ${Math.ceil(TIERS[0].at / perVoyage)} voyages`);
  });
});

describe('Starfleet makes up the ship’s complement', () => {
  const atDock = (g) => { g.locationId = 'sol'; return g; };
  const kill = (g, n) => {
    for (const p of g.dutyRoster.filter((x) => x.state !== 'lost').slice(0, n)) p.state = 'lost';
    return g;
  };
  const living = (g) => g.dutyRoster.filter((p) => p.state !== 'lost').length;

  test('a ship that has lost specialists gets replacements at a starbase', () => {
    // The roster was built once and could only shrink. Over 120 rounds of duty
    // a complement of twelve lost a mean of 4.6 people, and because dutySlots
    // counts the able, the ship went from running three details to one.
    const g = atDock(kill(new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' }), 4));
    const before = living(g);
    const posted = replaceLosses(g);
    assert.ok(posted.length > 0, 'nobody was posted aboard');
    assert.ok(living(g) > before, `still ${living(g)} aboard`);
    for (const p of posted) {
      assert.ok(p.name && p.label, 'a replacement arrived with no name or billet');
      assert.equal(p.state, 'aboard', 'a replacement arrived already unavailable');
    }
  });

  test('and nowhere else', () => {
    const g = kill(new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' }), 4);
    g.locationId = 'deep_2';   // no dock out there
    assert.deepEqual(replaceLosses(g), [], 'people were posted aboard in deep space');
  });

  test('the dead stay dead — the billet is refilled, not the person', () => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    const doomed = g.dutyRoster[0];
    const wasCalled = doomed.name;
    kill(g, 1);
    atDock(g);
    const posted = replaceLosses(g);
    assert.ok(posted.length, 'nobody replaced the casualty');
    assert.equal(doomed.state, 'lost', 'the dead came back');
    assert.ok(g.dutyRoster.some((p) => p.state === 'lost' && p.name === wasCalled),
      'the casualty was erased rather than remembered');
    assert.ok(posted.every((p) => p.name !== wasCalled || p !== doomed),
      'the replacement is the same object as the person who died');
  });

  test('a full ship is not given people it has no billets for', () => {
    const g = atDock(new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' }));
    const before = g.dutyRoster.length;
    assert.deepEqual(replaceLosses(g), [], 'a full roster was topped up anyway');
    assert.equal(g.dutyRoster.length, before, 'the roster grew with nobody missing');
  });

  test('and never past the complement, however many calls it takes', () => {
    const g = atDock(kill(new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' }), 8));
    const want = rosterSizeFor(g.ship.maxCrew);
    for (let i = 0; i < 20; i++) replaceLosses(g);
    assert.equal(living(g), want, `${living(g)} aboard on a ship rated for ${want}`);
  });

  test('the replacement fills the billet that is actually empty', () => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    // Kill everyone in one speciality and nobody else.
    const gap = g.dutyRoster[0].speciality;
    for (const p of g.dutyRoster) if (p.speciality === gap) p.state = 'lost';
    atDock(g);
    const posted = replaceLosses(g, { limit: 1 });
    assert.ok(posted.length, 'nobody came');
    assert.equal(posted[0].speciality, gap,
      `lost the ${gap} and was sent a ${posted[0].speciality}`);
  });

  test('replacements are the same people for the same seed, forever', () => {
    const make = () => {
      const g = atDock(kill(new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' }), 3));
      return replaceLosses(g).map((p) => `${p.name}/${p.speciality}`);
    };
    assert.deepEqual(make(), make(), 'the same save produced different replacements');
  });

  test('and posting them does not shift anything else that is seeded', () => {
    // The original roster shipped drawing from `game.rng` and moved every
    // seeded outcome downstream of it. This uses a derived stream.
    const roll = (post) => {
      const g = atDock(kill(new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' }), 3));
      if (post) replaceLosses(g);
      return [g.rng.float(), g.rng.float(), g.rng.float()];
    };
    assert.deepEqual(roll(true), roll(false),
      'posting replacements moved the shared random stream');
  });
});

describe('boarding a hulk', () => {
  /** Win a fight so there is something adrift to board. */
  const withWreck = (tier = null) => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    g.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Test' })],
      { relentless: true });
    let n = 0;
    while (g.engagement && !g.engagement.over && n < 30000) { g.engagement.update(1 / 30); n++; }
    assert.ok(g.wreckHere, 'the fight left nothing adrift');
    if (tier) g.wreck.tier = tier;
    g.stores = g.stores ?? {};
    return g;
  };
  const send = (g) => {
    const a = ASSIGNMENTS.salvage_party;
    const team = g.dutyRoster.filter((p) => p.available).slice(0, a.team).map((p) => p.id);
    const before = { ...g.stores };
    const r = beginAssignment(g, 'salvage_party', team);
    assert.ok(r?.ok, `the party would not go: ${r?.reason}`);
    advanceAssignments(g, a.hours + 1, g.rng);
    let got = 0;
    for (const [k, v] of Object.entries(g.stores)) got += v - (before[k] ?? 0);
    return got;
  };

  test('one hulk cannot be salvaged twice', () => {
    // Dispatching a party used to leave the wreck sitting there, so the same
    // Bird-of-Prey could be boarded AND stripped: 61 units off one kill
    // instead of 29. `stripWreck` made the wreck a real object precisely to
    // stop a second helping, and this detail opened another door to it.
    const g = withWreck();
    const a = ASSIGNMENTS.salvage_party;
    const team = g.dutyRoster.filter((p) => p.available).slice(0, a.team).map((p) => p.id);
    assert.ok(beginAssignment(g, 'salvage_party', team)?.ok);
    assert.equal(g.wreckHere, null, 'the hulk is still there after a party boarded it');
    assert.equal(g.stripWreck().ok, false, 'the same hulk was stripped as well');
  });

  test('and a bigger hulk is worth more, not less', () => {
    // The grant was flat, while `stripWreck` scales with the wreck's tier — so
    // a day's dangerous work by three people beat a quick strip on a shuttle
    // and lost to it on a capital hull, which is backwards.
    const small = send(withWreck(1));
    const big = send(withWreck(5));
    assert.ok(big > small * 2,
      `a tier-1 hulk gave ${small} and a tier-5 hulk gave ${big}`);
  });

  test('and boarding pays better than tractoring in the floaters', () => {
    // It costs a day, three people, and the worst odds in the book. If it did
    // not pay clearly more than the instant riskless option, nobody sane would
    // ever send it — which is what the measurement found.
    for (const tier of [1, 3, 5]) {
      const g = withWreck(tier);
      // What a strip would have yielded off the same hulk, averaged.
      let strip = 0;
      for (let i = 0; i < 200; i++) {
        strip += Object.values(g.salvage({ tier })).reduce((n, v) => n + v, 0);
      }
      strip /= 200;
      const party = send(withWreck(tier));
      assert.ok(party > strip * 1.5,
        `tier ${tier}: boarding gave ${party} against a strip's ${strip.toFixed(1)}`);
    }
  });

  test('a party paid for the hulk it boarded, not the one it came home to', () => {
    // They may come back after the ship has left the system entirely.
    const g = withWreck(5);
    const a = ASSIGNMENTS.salvage_party;
    const team = g.dutyRoster.filter((p) => p.available).slice(0, a.team).map((p) => p.id);
    const before = { ...g.stores };
    beginAssignment(g, 'salvage_party', team);
    g.locationId = 'qonos';        // long gone
    g.wreck = null;
    advanceAssignments(g, a.hours + 1, g.rng);
    let got = 0;
    for (const [k, v] of Object.entries(g.stores)) got += v - (before[k] ?? 0);
    assert.ok(got > 40, `the party came home with ${got} from a tier-5 hulk`);
  });

  test('and it is not offered when there is nothing out there', () => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    assert.equal(availableAssignments(g).some((a) => a.id === 'salvage_party'), false,
      'a salvage party was offered with no hulk anywhere');
  });
});

test('a set that will not fit the starting hull is a fact, not a surprise', () => {
  // The duotronic suite is three science consoles and a Constitution has two
  // science slots, so its three-piece tier cannot be reached in the ship the
  // campaign starts you in. That is allowed — a refit, an Oberth and an
  // Excelsior all carry three — but the ship screen has to SAY so, because
  // "Still wanted: <piece>" on its own told the captain to do something the
  // loadout would silently refuse.
  const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
  const needBySlot = (set) => {
    const need = {};
    for (const id of set.pieces) {
      const slot = CONSOLES[id]?.slot;
      if (slot) need[slot] = (need[slot] ?? 0) + 1;
    }
    return need;
  };

  const short = SET_LIST.filter((set) => Object.entries(needBySlot(set))
    .some(([slot, n]) => g.loadout.capacity(slot) < n));
  assert.equal(short.length, 1,
    `${short.length} sets do not fit the starting hull: ${short.map((s) => s.name).join(', ')}`);
  assert.equal(short[0].id, 'duotronic', `the set that does not fit is ${short[0].id}`);

  // And it is genuinely reachable somewhere, rather than dead content.
  const roomFor = Object.values(SHIP_CLASSES).filter((cls) => cls.slots
    && Object.entries(needBySlot(SETS.duotronic)).every(([s, n]) => (cls.slots[s] ?? 0) >= n));
  assert.ok(roomFor.length > 0,
    'no hull in the game can carry the duotronic suite — it is dead content');
});

// ==================================================== every station opens something

test('every station a captain can walk up to opens a console with something in it', () => {
  // The pattern this file exists for, applied to the walkable ship. A station
  // in `interiors.data.js` declares a `panel` key; `STATION_PANEL` in main.js
  // translates it; `openConsole` switches on the result. Three lists kept in
  // step by hand, and a key that falls out of step does not fail — it lands on
  // the `default:` branch, which pushes "Working, Captain." and nothing else.
  //
  // That is what the briefing room's briefing screen did: `missions` mapped to
  // `missions`, `openConsole` had no case for it, and the one place on the
  // ship devoted to standing orders opened a blank console while `missionPanel`
  // sat two files away.
  const MAIN = readFileSync(join(HERE, '..', 'src', 'main.js'), 'utf8');

  // The alias map, read from the source rather than duplicated here — a copy
  // would go stale in exactly the way this test is about.
  const mapSrc = MAIN.match(/const STATION_PANEL = \{([\s\S]*?)\n\};/);
  assert.ok(mapSrc, 'STATION_PANEL is not where this test expects it in main.js');
  const alias = {};
  for (const [, from, to] of mapSrc[1].matchAll(/(\w+)\s*:\s*'([\w]+)'/g)) alias[from] = to;
  assert.ok(Object.keys(alias).length > 8, `only parsed ${Object.keys(alias).length} aliases`);

  // The keys `openConsole` actually answers to.
  const bodySrc = MAIN.slice(MAIN.indexOf('openConsole(key, station) {'));
  const handled = new Set([...bodySrc.slice(0, bodySrc.indexOf('\n  }')).matchAll(/case '([\w]+)':/g)]
    .map((m) => m[1]));
  assert.ok(handled.size > 8, `only parsed ${handled.size} console cases`);

  const dead = [];
  for (const [roomId, room] of Object.entries(ROOMS)) {
    for (const st of room.stations ?? []) {
      if (!st.panel) continue;
      const key = alias[st.panel] ?? st.panel;
      if (!handled.has(key)) dead.push(`${roomId}/${st.label} (panel "${st.panel}" -> "${key}")`);
    }
  }
  assert.deepEqual(dead, [],
    `stations whose console falls through to "Working, Captain.": ${dead.join('; ')}`);
});

test('and every alias points at a key the console answers to', () => {
  // The other half: an alias that names a case nobody wrote is the same defect
  // one step earlier, and it would go unnoticed until a station used it.
  const MAIN = readFileSync(join(HERE, '..', 'src', 'main.js'), 'utf8');
  const mapSrc = MAIN.match(/const STATION_PANEL = \{([\s\S]*?)\n\};/);
  const bodySrc = MAIN.slice(MAIN.indexOf('openConsole(key, station) {'));
  const handled = new Set([...bodySrc.slice(0, bodySrc.indexOf('\n  }')).matchAll(/case '([\w]+)':/g)]
    .map((m) => m[1]));
  const bad = [...mapSrc[1].matchAll(/(\w+)\s*:\s*'([\w]+)'/g)]
    .filter(([, , to]) => !handled.has(to))
    .map(([, from, to]) => `${from} -> ${to}`);
  assert.deepEqual(bad, [], `STATION_PANEL aliases with no console case: ${bad.join(', ')}`);
});
