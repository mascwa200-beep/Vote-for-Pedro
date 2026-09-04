// A patrol was a number of hulls, not an amount of force.
//
// `buildHostiles(rng, factionId, strength, pool)` has had that third argument
// named `strength` and documented as strength since combat was written, and
// used it as a count. The encounter generator asked for `rng.int(1, 2)` of them
// and drew uniformly from a pool spanning a scout to a battleship.
//
// Measured through `rollEncounter` — one encounter kind, one system, four
// hundred rolls of each, weighed against a Constitution:
//
//     Qo'noS   "A Klingon patrol"   ratio 0.05 .. 2.44 — a 45x spread
//              worst: two Negh'Vars      (outmatched, dead every time)
//              best:  one Bird-of-Prey   (favourable, free)
//     Rigel    "An Orion patrol"    ratio 1.32 .. 10.72
//              worst: two Marauders      (still in the player's favour)
//              best:  one Orion raider   (no contest)
//
// Identical text both times, and 47% of Klingon patrols were funerals. At the
// other end the Orion Raider's own description reads "Dangerous in threes,
// worthless alone" and the generator had never once fielded three.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';
import { RNG } from '../src/core/rng.js';
import {
  buildHostiles, pickForce, hostileName, MAX_FORCE_HULLS, CAPITAL_CHANCE,
} from '../src/sim/combat.js';
import { classPower, forcePower, shipPower, assessEngagement } from '../src/sim/assess.js';
import { rollEncounter, SECTOR_PRESENCE } from '../src/world/encounters.js';
import { SYSTEM_BY_ID } from '../src/world/systems.data.js';
import { SHIP_CLASSES } from '../src/world/ships.data.js';

const KLINGON = ['bird_of_prey', 'bird_of_prey', 'd7', 'ktinga', 'vorcha', 'neghvar'];
const ORION = ['orion_raider', 'orion_raider'];

/** Hostile forces a player actually meets, rolled through the real generator. */
function rolledForces({ me, systems, rolls = 4000, seed = 99n }) {
  const rng = new RNG(seed);
  const ship = new Ship(me, { faction: 'federation' });
  const out = [];
  for (let i = 0; i < rolls; i++) {
    const e = rollEncounter(rng, systems[i % systems.length], {
      player: ship,
      // A captain everyone has a reason to shoot at, so the sample is hostile
      // encounters rather than four thousand cargo manifests.
      ledger: { standingOf: () => -60 },
    });
    if (e?.hostile && e.ships?.length) out.push({ e, ship });
  }
  return out;
}

const sectorSystems = (sectors) => Object.values(SYSTEM_BY_ID)
  .filter((s) => sectors.includes(s.sector)).map((s) => s.id);

describe('a force is an amount of fighting, not a number of hulls', () => {
  test('the same patrol in the same place is the same size of fight', () => {
    // The finding, asserted where it was found. Not "the fight is fair" — a
    // patrol over Qo'noS should be hard — but that the captain reading
    // "A Klingon patrol" is being told something.
    for (const [systemId, ceiling] of [['qonos', 6], ['archanis', 6]]) {
      const me = new Ship('constitution', { faction: 'federation' });
      const rng = new RNG(7n);
      const ratios = [];
      for (let i = 0; i < 20000 && ratios.length < 400; i++) {
        const e = rollEncounter(rng, systemId, { player: me, ledger: { standingOf: () => -60 } });
        if (e?.kind !== 'patrol' || !e.hostile || !e.ships?.length) continue;
        const a = assessEngagement({ player: me, hostiles: e.ships });
        if (a) ratios.push(a.ratio);
      }
      assert.ok(ratios.length > 100, `only ${ratios.length} patrols at ${systemId}`);
      ratios.sort((a, b) => a - b);
      const spread = ratios[ratios.length - 1] / ratios[0];
      assert.ok(spread < ceiling,
        `"A Klingon patrol" at ${systemId} spans ${spread.toFixed(0)}x in fighting power `
        + `(${ratios[0].toFixed(2)} to ${ratios[ratios.length - 1].toFixed(2)})`);
    }
  });

  test('and the old behaviour is one this measurement can see', () => {
    // The control, built inline rather than borrowed, because the code it
    // measures is gone: one or two hulls drawn uniformly from the pool, which
    // is what `makeShips` did.
    const me = new Ship('constitution', { faction: 'federation' });
    const rng = new RNG(7n);
    const ratios = [];
    for (let i = 0; i < 400; i++) {
      const n = 1 + (rng.float() < 0.5 ? 0 : 1);
      const ships = Array.from({ length: n }, () => new Ship(rng.pick(KLINGON), { faction: 'klingon' }));
      ratios.push(assessEngagement({ player: me, hostiles: ships }).ratio);
    }
    ratios.sort((a, b) => a - b);
    const spread = ratios[ratios.length - 1] / ratios[0];
    assert.ok(spread > 20,
      `the control only spanned ${spread.toFixed(0)}x, so the assertion above proves nothing`);
  });

  test('three Orion raiders are a fight and one is an errand', () => {
    // "Dangerous in threes, worthless alone" — ships.data.js, written long
    // before anything could field three.
    const one = forcePower(['orion_raider']);
    const three = forcePower(['orion_raider', 'orion_raider', 'orion_raider']);
    assert.ok(Math.abs(three / one - 9) < 0.01, `three raiders are ${(three / one).toFixed(2)} of one`);

    const rng = new RNG(4n);
    const sizes = Array.from({ length: 200 }, () => pickForce(rng, 0.8, ORION).length);
    const median = sizes.sort((a, b) => a - b)[sizes.length >> 1];
    assert.ok(median >= 3, `an Orion force worth 0.8 Constitutions is ${median} raiders`);
  });

  test('and a capital arrives alone, or with an escort lighter than itself', () => {
    const rng = new RNG(8n);
    let saw = 0;
    for (let i = 0; i < 400; i++) {
      const force = pickForce(rng, 4.5, KLINGON, { capitalChance: 0 });
      assert.ok(force.length <= MAX_FORCE_HULLS, `${force.length} hulls`);
      if (!force.includes('neghvar')) continue;
      saw++;
      // Two Negh'Vars is not a patrol with a big flagship, it is a war.
      assert.equal(force.filter((c) => c === 'neghvar').length, 1,
        `a patrol of ${force.join(' + ')}`);
      const lead = classPower('neghvar');
      for (const c of force) {
        assert.ok(classPower(c) <= lead + 1e-9, `${c} is escorting something lighter than it`);
      }
    }
    assert.ok(saw > 10, `a Negh'Var never turned up in 400 forces worth 4.5 Constitutions`);
  });

  test('a force lands near the strength it was asked for', () => {
    // Not exactly: hulls are lumpy and the square law is lumpier. But a force
    // built for 2.5 must not come out worth 0.2 or 12.
    const rng = new RNG(12n);
    const POOLS = {
      klingon: KLINGON, orion: ORION,
      romulan: ['scoutship', 'scoutship', 'warbird'],
      cardassian: ['galor', 'galor', 'keldon'],
      dominion: ['jem_hadar_attack', 'jem_hadar_attack', 'jem_hadar_battleship'],
    };
    for (const want of [0.3, 0.8, 1.6, 2.5, 4.0]) {
      for (const [faction, pool] of Object.entries(POOLS)) {
        const errs = [];
        for (let i = 0; i < 120; i++) {
          // Capital chance off: this measures the costing, and the wild draw
          // is by definition the case that ignores it.
          errs.push(forcePower(pickForce(rng, want, pool, { capitalChance: 0 })) / want);
        }
        errs.sort((a, b) => a - b);
        const median = errs[errs.length >> 1];
        assert.ok(median > 0.25 && median < 2.6,
          `${faction} asked for ${want} and the median force was worth ${(median * want).toFixed(2)}`);
      }
    }
  });

  test('an unarmed pool still turns up', () => {
    // Independent space fields freighters and transports, which have no guns
    // at all. Costing them by power divides by zero; they are still a thing
    // that happens to you.
    const rng = new RNG(2n);
    const force = pickForce(rng, 2, ['freighter', 'transport']);
    assert.ok(force.length >= 1, 'a convoy of nothing');
    assert.ok(force.every((c) => SHIP_CLASSES[c]), force.join('+'));
  });
});

describe('what a garrison sends', () => {
  test('a heavier ship draws a heavier answer, and only where somebody is looking', () => {
    // Not the enemy scaling to the player: a garrison seeing a warship and
    // sending what that is worth, scaled by how much of it is there. At Andor
    // the Klingon presence is 1 and it stays a shrug.
    const deep = sectorSystems(['qonos', 'romulus', 'cardassia', 'gamma']);
    const home = sectorSystems(['sol', 'vulcan', 'andor']);
    const weight = (me, systems) => {
      const rolled = rolledForces({ me, systems });
      const p = rolled.map((r) => forcePower(r.e.ships.map((s) => s.classId))).sort((a, b) => a - b);
      return { median: p[p.length >> 1], n: p.length };
    };
    const deepSmall = weight('miranda', deep);
    const deepBig = weight('sovereign', deep);
    assert.ok(deepSmall.n > 100 && deepBig.n > 100, 'not enough hostile encounters to read');
    assert.ok(deepBig.median > deepSmall.median * 1.5,
      `a Sovereign in hostile space drew ${deepBig.median.toFixed(2)} where a Miranda drew `
      + `${deepSmall.median.toFixed(2)} — the garrison is not answering the ship`);

    // And the same Sovereign at home does not summon a fleet.
    const homeBig = weight('sovereign', home);
    assert.ok(homeBig.median < deepBig.median,
      `Sol answered a Sovereign with ${homeBig.median.toFixed(2)} and Qo'noS with `
      + `${deepBig.median.toFixed(2)}`);
  });

  test('a small ship in deep space is still in trouble', () => {
    // The property the response term must not destroy. If the garrison sized
    // itself to the player and nothing else, a Miranda over Qo'noS would meet
    // a Miranda-sized patrol, and the map would stop meaning anything.
    const deep = sectorSystems(['qonos', 'romulus', 'cardassia', 'gamma']);
    const rolled = rolledForces({ me: 'miranda', systems: deep });
    assert.ok(rolled.length > 100, `only ${rolled.length} hostile encounters`);
    const bad = rolled.filter((r) => {
      const a = assessEngagement({ player: r.ship, hostiles: r.e.ships });
      return a && (a.band === 'hopeless' || a.band === 'dangerous');
    });
    const share = bad.length / rolled.length;
    assert.ok(share > 0.5,
      `only ${(share * 100).toFixed(0)}% of what a Miranda meets at Qo'noS is dangerous or worse`);
  });

  test('and a flagship has something to be afraid of', () => {
    // The gap the response term and the capital draw exist to close. Measured
    // before either: 1% of what a Sovereign met in deep space rated dangerous,
    // and nothing at all rated worse. A ship the game lets you earn had no
    // fight left in the galaxy.
    const deep = sectorSystems(['qonos', 'romulus', 'cardassia', 'gamma', 'deepspace']);
    const rolled = rolledForces({ me: 'sovereign', systems: deep });
    assert.ok(rolled.length > 100, `only ${rolled.length} hostile encounters`);
    const hard = rolled.filter((r) => {
      const a = assessEngagement({ player: r.ship, hostiles: r.e.ships });
      return a && (a.band === 'hopeless' || a.band === 'dangerous');
    });
    assert.ok(hard.length / rolled.length > 0.04,
      `${((100 * hard.length) / rolled.length).toFixed(1)}% of deep space worries a Sovereign`);
  });

  test('the Borg cube can still turn up', () => {
    // It is the game's whole illustration of a fight you break off rather than
    // win, and costing every force to the situation deleted it: the Borg pool
    // is two capitals, the deepspace garrison is worth a fraction of a
    // Constitution, and the affordability rule fielded a bioship every time.
    // The behaviour first, so that turning the draw off fails this test for
    // the reason it exists rather than on the constant three lines below.
    const rng = new RNG(5n);
    let cubes = 0;
    for (let i = 0; i < 4000; i++) {
      if (pickForce(rng, 0.5, ['borg_cube', 'bioship']).includes('borg_cube')) cubes++;
    }
    assert.ok(cubes > 20, `a cube appeared ${cubes} times in 4000 Borg forces`);
    // And it is rare. A cube every other encounter is not a Borg cube.
    assert.ok(cubes < 800, `a cube appeared in ${((100 * cubes) / 4000).toFixed(0)}% of Borg forces`);
    assert.ok(CAPITAL_CHANCE > 0 && CAPITAL_CHANCE < 0.2, `capital chance ${CAPITAL_CHANCE}`);
  });

  test('and the wild draw is the only thing that overshoots', () => {
    // The control for the test above: with it off, a force worth half a
    // Constitution never contains a twenty-Constitution ship.
    const rng = new RNG(5n);
    for (let i = 0; i < 1000; i++) {
      const force = pickForce(rng, 0.5, ['borg_cube', 'bioship'], { capitalChance: 0 });
      assert.ok(!force.includes('borg_cube'), `a cube answered a 0.5-Constitution situation`);
    }
  });
});

describe('the costing itself', () => {
  test('a class is worth what its guns and its hull say, in Constitutions', () => {
    assert.ok(Math.abs(classPower('constitution') - 1) < 1e-9, 'the unit is not one');
    // Read off the class table with no Ship built, so it has to agree with the
    // ship the game actually flies.
    for (const id of ['bird_of_prey', 'neghvar', 'orion_raider', 'galor', 'borg_cube']) {
      const live = shipPower(new Ship(id, { faction: SHIP_CLASSES[id].faction }));
      assert.ok(Math.abs(live - classPower(id)) < 1e-6,
        `${id}: the class costs ${classPower(id).toFixed(3)} and the hull ${live.toFixed(3)}`);
    }
    assert.equal(classPower('freighter'), 0, 'a freighter has guns');
    assert.equal(classPower('no_such_class'), 0);
  });

  test('a force is not the sum of its ships', () => {
    // The square law again, which is the entire reason packs work.
    const one = forcePower(['bird_of_prey']);
    assert.ok(Math.abs(forcePower(['bird_of_prey', 'bird_of_prey']) / one - 4) < 0.01);
    assert.ok(Math.abs(forcePower(Array(3).fill('bird_of_prey')) / one - 9) < 0.01);
    assert.equal(forcePower([]), 0);
    assert.equal(forcePower(null), 0);
    // A mixed force is more than either half, and less than double the heavier.
    const mixed = forcePower(['vorcha', 'bird_of_prey']);
    assert.ok(mixed > forcePower(['vorcha']) && mixed < forcePower(['vorcha', 'vorcha']));
  });
});

describe('and the game still plays', () => {
  test('a rolled force reaches combat with distinct, named ships', () => {
    // Through the game's own door: roll until something hostile turns up, take
    // the fight, and require of it what the tactical display requires.
    const g = new Game({ seed: 14n, crewMode: 'original' });
    let started = 0;
    for (let i = 0; i < 400 && started < 12; i++) {
      const enc = rollEncounter(g.rng, 'qonos', {
        player: g.ship, ledger: { standingOf: () => -60 },
      });
      if (!enc?.hostile || !enc.ships?.length) continue;
      const eng = g.startCombat(enc.ships.map((s) => new Ship(s.classId, {
        name: s.name, faction: s.faction,
      })));
      if (!eng) continue;
      started++;
      assert.ok(eng.hostiles.length >= 1 && eng.hostiles.length <= 6,
        `${eng.hostiles.length} hostiles on the display`);
      const names = eng.hostiles.map((s) => s.name);
      assert.equal(new Set(names).size, names.length, `two ships called the same thing: ${names}`);
      assert.ok(eng.assessment, 'the bridge said nothing about a fight it could see');
      g.engagement = null;
      g.mode = 'space';
    }
    assert.ok(started >= 8, `only ${started} fights started`);
  });

  test('every faction on the map can field a force at its own presence', () => {
    // A faction whose pool cannot produce anything at the strength its sector
    // calls for is a faction that has quietly left the game.
    // Through `rollEncounter`, so the fleet pool it reads is the one the game
    // reads. Passing a pool in by hand would prove only that this test knows
    // how to build a list.
    const rng = new RNG(31n);
    const me = new Ship('constitution', { faction: 'federation' });
    const fielded = new Map();
    for (const [sector, presence] of Object.entries(SECTOR_PRESENCE)) {
      const systems = Object.values(SYSTEM_BY_ID).filter((s) => s.sector === sector);
      if (!systems.length) continue;
      const want = Object.keys(presence).filter((f) => f !== 'federation');
      const seen = new Set();
      for (let i = 0; i < 4000 && seen.size < want.length; i++) {
        const e = rollEncounter(rng, systems[i % systems.length].id, {
          player: me, ledger: { standingOf: () => -60 },
        });
        if (!e?.hostile || !e.factionId) continue;
        assert.ok(e.ships?.length >= 1,
          `${e.factionId} fielded nothing for a ${e.kind} at ${sector}`);
        // A distress call draws its raiders from its own short list rather
        // than from the sector's presence, so Orions turn up at Sol. They
        // still have to field ships — the assertion above — but they are not
        // what this loop is waiting for.
        if (want.includes(e.factionId)) seen.add(e.factionId);
      }
      fielded.set(sector, seen);
      for (const f of want) {
        assert.ok(seen.has(f), `${f} never fielded anything in ${sector}`);
      }
    }
    assert.equal(fielded.size, Object.keys(SECTOR_PRESENCE).length);
  });
});
