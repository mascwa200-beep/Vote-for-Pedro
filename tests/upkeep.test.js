// Latinum had one way in and no way out.
//
// The hail option is called "Offer them latinum". `resolveHail` has returned
// `cost: 'latinum'` on a successful bribe since it was written. `Game.hail`
// never read that field. Measured over two hundred attempts against an Orion
// raider:
//
//     bribes accepted 165/200 | latinum actually changed hands 0 times
//
// And it was worse than a free option, because there was nothing else to spend
// it on either. Latinum had exactly ONE income in the whole game — escort
// contracts — and no expenditure anywhere: a number that started at 500, only
// rose, and was guarded by an invariant that it stay non-negative, which it
// could not fail to do.
//
// Alongside it, six character mechanics that all describe what a ship costs to
// keep. Every one of them was declared on a species, an origin or a trait, and
// read by nothing:
//
//     fieldRepair  1.3   frontier_colony     hull 40.0% -> 53.6% either way
//     repairTime   0.5   tinkerer            2.500 days in the yard either way
//     recoveryRate 2     denobulan, beloved  severity 0.500 after 48h either way
//     salvageBonus 1     tinkerer            identical haul off the same wreck
//     rescueXP     1.6   refugee             +400 experience either way
//     tradeBonus   0.25  civilian_transport  +400 latinum either way
//
// The carriers matter and were checked before anything was built on them: an
// earlier draft of this file measured `fieldRepair` on a Tellarite and
// `salvageBonus` on a Ferengi, neither of whom has ever declared either.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Character, PLAYER_SPECIES, ORIGINS, TRAITS } from '../src/rules/character.js';
import { Ship } from '../src/sim/ship.js';
import { availableHails } from '../src/sim/diplomacy.js';
import { salvageWreck } from '../src/sim/fabrication.js';

const game = (opts = {}, { seed = 4n } = {}) => new Game({
  seed,
  crewMode: 'original',
  shipClass: 'constitution',
  character: new Character({ speciesId: 'human', careerId: 'command', ...opts }),
});

const PLAIN = {};
const FRONTIER = { originId: 'frontier_colony' };
const TINKER = { traits: ['tinkerer'] };
const DENOB = { speciesId: 'denobulan' };
const CIVIL = { originId: 'civilian_transport' };
const REFUGEE = { originId: 'refugee' };

describe('a bribe is a thing you pay for', () => {
  test('offering latinum now costs latinum', () => {
    let bought = 0;
    let paid = 0;
    for (let s = 1n; s <= 200n; s++) {
      const g = game(PLAIN, { seed: s });
      const before = g.latinum;
      g.startCombat([new Ship('orion_raider', { faction: 'orion', name: 'X' })]);
      if (g.hail('bribe').outcome !== 'bought_off') continue;
      bought++;
      if (g.latinum < before) paid++;
    }
    assert.ok(bought > 100, `only ${bought} of 200 bribes were accepted, so this measures little`);
    assert.equal(paid, bought, `${bought} bribes accepted and ${paid} of them paid for`);
  });

  test('and the price is what you would otherwise have to fight', () => {
    // `forcePower`, in Constitutions, so Lanchester's square law is already in
    // it: three D7s cost far more than three times one D7 because three D7s
    // are worth far more than three times one D7 in a fight.
    const price = (ids) => {
      const g = game();
      g.startCombat(ids.map((c, i) => new Ship(c, { faction: 'orion', name: `X${i}` })));
      return g.bribePrice();
    };
    const raider = price(['orion_raider']);
    const cruiser = price(['d7']);
    const squadron = price(['d7', 'd7', 'd7']);
    assert.ok(raider < cruiser && cruiser < squadron,
      `raider ${raider}, cruiser ${cruiser}, squadron ${squadron}`);
    assert.ok(raider >= 50, 'nobody takes a derisory offer');
    assert.ok(squadron > 1000, `a squadron costs ${squadron}, which is pocket change`);
  });

  test('and an offer you cannot cover is not offered', () => {
    const g = game();
    g.startCombat([new Ship('d7', { faction: 'orion', name: 'X' })]);
    const priced = g.bribePrice();
    const offered = (purse) => availableHails('orion',
      { winning: false, latinum: purse, bribePrice: priced }).some((o) => o.id === 'bribe');
    assert.equal(offered(priced + 1), true);
    assert.equal(offered(priced - 1), false, 'a bribe was offered to a captain who could not pay it');
  });

  test('and a caller that says nothing about money is unchanged', () => {
    // The gate must not make the option vanish for the fuzzer, the invariant
    // checker, or any caller written before there was a price.
    assert.equal(availableHails('orion', { winning: false }).some((o) => o.id === 'bribe'), true);
  });

  test('and the purse never goes negative, which an invariant already asserts', () => {
    const g = game();
    g.latinum = 10;
    g.startCombat([new Ship('d7', { faction: 'orion', name: 'X' })]);
    for (let i = 0; i < 20; i++) g.hail('bribe');
    assert.ok(g.latinum >= 0, `latinum is ${g.latinum}`);
  });

  test('and it goes on the record, because money leaving the ship is an event', () => {
    let found = false;
    for (let s = 1n; s <= 40n && !found; s++) {
      const g = game(PLAIN, { seed: s });
      g.startCombat([new Ship('orion_raider', { faction: 'orion', name: 'X' })]);
      if (g.hail('bribe').outcome !== 'bought_off') continue;
      found = g.log.some((l) => /latinum transferred/i.test(l.text));
    }
    assert.ok(found, 'nobody was told what it cost');
  });
});

describe('six mechanics about what a ship costs to keep', () => {
  test('the carriers are the ones the tables actually name', () => {
    // Checked first, and it caught a draft of this file measuring two of them
    // against species that have never declared them. A bar measured on the
    // wrong captain is not a bar.
    const owner = (key) => {
      const out = [];
      for (const list of [PLAYER_SPECIES, ORIGINS, TRAITS]) {
        for (const e of list) if (e.mechanic?.[key] !== undefined) out.push(e.id);
      }
      return out;
    };
    assert.deepEqual(owner('fieldRepair'), ['frontier_colony']);
    assert.deepEqual(owner('repairTime'), ['tinkerer']);
    assert.deepEqual(owner('salvageBonus'), ['tinkerer']);
    assert.deepEqual(owner('rescueXP'), ['refugee']);
    assert.deepEqual(owner('tradeBonus'), ['civilian_transport']);
    assert.deepEqual(owner('recoveryRate').sort(), ['beloved', 'denobulan']);
  });

  test('a frontier captain keeps a hull going between starbases', () => {
    const hull = (o) => {
      const g = game(o);
      g.ship.hull = g.ship.maxHull * 0.4;
      g.passTime(48);
      return g.ship.hullPct;
    };
    assert.ok(hull(FRONTIER) > hull(PLAIN) + 0.02,
      `${(100 * hull(PLAIN)).toFixed(1)}% against ${(100 * hull(FRONTIER)).toFixed(1)}%`);
  });

  test('and it is the field, not the firefight', () => {
    // `fieldRepair` is deliberately NOT on `ship.mod('repairRate')`, which is
    // the in-combat damage-control path. Being better at keeping her going
    // between starbases is a different claim from being better at patching her
    // while she is being shot at, and the card makes the first one.
    assert.equal(game(FRONTIER).ship.mod('repairRate'), game(PLAIN).ship.mod('repairRate'));
  });

  test('a tinkerer halves the days in the yard', () => {
    const days = (o) => {
      const g = game(o);
      g.ship.hull = g.ship.maxHull * 0.3;
      g.locationId = 'sol';
      const t0 = g.clock.stardate;
      g.dock();
      return g.clock.stardate - t0;
    };
    const plain = days(PLAIN);
    assert.ok(plain > 1, `a damaged ship spent ${plain} days alongside, so there is nothing to halve`);
    assert.ok(Math.abs(days(TINKER) / plain - 0.5) < 0.05,
      `${plain.toFixed(2)} days became ${days(TINKER).toFixed(2)}`);
  });

  test('and gets twice as much off a wreck', () => {
    const haul = (o) => {
      const g = game(o);
      const r = salvageWreck(g, g.rng, { tier: 5 });
      return Object.values(r.haul ?? r).reduce((n, v) => n + (Number(v) || 0), 0);
    };
    assert.ok(haul(TINKER) > haul(PLAIN) * 1.5,
      `${haul(PLAIN)} against ${haul(TINKER)}`);
  });

  test('a doctor by training gets people out of sickbay sooner', () => {
    // Through `passTime`, which is the door sickbay actually uses — a bare
    // `officer.recover(48)` takes the rate as an argument and defaults it to
    // one, so calling it directly measures nothing about the captain.
    const left = (o) => {
      const g = game(o);
      const off = g.crew.officers[0];
      off.injure(0.9);
      g.passTime(48);
      return off.injurySeverity;
    };
    assert.ok(left(DENOB) < left(PLAIN) - 0.1,
      `severity ${left(PLAIN).toFixed(2)} against ${left(DENOB).toFixed(2)}`);
    assert.ok(left({ traits: ['beloved'] }) < left(PLAIN) - 0.1, 'the trait does nothing');
  });

  test('a refugee is paid more for a rescue', () => {
    const xp = (o) => {
      const g = game(o);
      g.encounter = { kind: 'distress', lives: 600, system: g.location };
      const before = g.progress.xp;
      g.resolveEncounter('assist');
      return g.progress.xp - before;
    };
    assert.ok(xp(REFUGEE) > xp(PLAIN) * 1.4, `${xp(PLAIN)} against ${xp(REFUGEE)}`);
  });

  test('and a trader is paid more for a contract', () => {
    const earned = (o) => {
      const g = game(o);
      g.encounter = { kind: 'escort', escortReward: 400, factionId: 'federation', system: g.location };
      const before = g.latinum;
      g.resolveEncounter('escort');
      return g.latinum - before;
    };
    assert.ok(earned(PLAIN) > 0, 'nobody was paid at all, so this measures nothing');
    assert.ok(earned(CIVIL) > earned(PLAIN), `${earned(PLAIN)} against ${earned(CIVIL)}`);
  });

  test('and none of them touches a captain who was never promised it', () => {
    // The control. Six bonuses that all applied to everybody would be a
    // difficulty change wearing six names.
    const g = game(PLAIN);
    for (const key of ['fieldRepair', 'repairTime', 'recoveryRate', 'salvageBonus',
      'rescueXP', 'tradeBonus']) {
      assert.equal(g.character.mechanic(key), undefined, `a plain captain has ${key}`);
    }
  });
});
