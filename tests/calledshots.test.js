// The order no enemy captain had ever given.
//
// The player has been able to call a shot at a named system since the order
// line existed. `fireWeapon` reads `this.targetedSubsystem` for the player and
// passed `null` for everybody else, so a Klingon captain who had been fighting
// for two minutes had never once tried for the engines — and it is worth about
// three times the subsystem damage of untargeted fire.
//
// Measured across a hundred and twenty fights against five factions, the lowest
// any of the player's systems fell to during the battle:
//
//                     before            after
//     Klingon      lifesupport 0.873   shields 0.000
//     Cardassian   weapons     0.887   weapons 0.002
//     Romulan      weapons     0.911   engines 0.424
//
// Before, the worst-hit system was whatever a random draw picked and it barely
// moved. After, each faction reliably wrecks the one thing its own doctrine
// depends on.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Ship, SUBSYSTEM_KEYS, CALLED_SHOT_HULL, facingForDirection } from '../src/sim/ship.js';
import { Character } from '../src/rules/character.js';
import { SHIP_CLASSES } from '../src/world/ships.data.js';
import { FACTIONS } from '../src/world/factions.data.js';

/** Fly a battle the way the balance suite does. */
function brawl({ me = 'constitution', them = ['d7'], seed = 1n, limit = 400, each = null }) {
  const g = new Game({
    seed, crewMode: 'original',
    character: new Character({ speciesId: 'human', careerId: 'tactical' }),
    shipClass: me,
  });
  g.startCombat(them.map((c, i) => new Ship(c, {
    faction: SHIP_CLASSES[c].faction, name: `H${i}`,
  })));
  const eng = g.engagement;
  let t = 0;
  const DT = 1 / 30;
  while (!eng.over && t < limit) {
    eng.comeAboutTo(eng.target);
    g.ship.throttle = 0.6;
    g.ship.power.applyPreset(g.ship.shieldPct < 0.35 ? 'defense' : 'attack');
    eng.update(DT);
    t += DT;
    each?.(g, eng, t);
  }
  return { g, eng, seconds: t };
}

describe('an enemy captain calls a shot', () => {
  test('and it is the one his doctrine depends on', () => {
    // Doctrine asserted through behaviour: fly the fight and read what the
    // hostiles actually set. A table held against itself would pass on a
    // table nothing reads.
    //
    // The player's ship is chosen per opponent so the test is about the
    // doctrine and not about whether that class can hurt a Constitution.
    // Measured over thirty battles, how often each ever got a facing below the
    // threshold at all: a Galor 30/30, a Marauder 7/30 against a Constitution
    // and 26/30 against a Miranda — and an Orion raider and a Romulan scout
    // 0/30, never once taking any facing of a Constitution below 0.74. A
    // Jem'Hadar attack ship manages 28/30 against a Constitution and 0/30
    // against a Galaxy, which is a hull it cannot reach past at all.
    const WANT = {
      d7: ['shields', 'constitution'],      // Klingon, aggressive — the kill
      galor: ['weapons', 'constitution'],   // Cardassian, attrition — the guns first
      warbird: ['engines', 'constitution'], // Romulan, ambush — strike and leave
      jem_hadar_attack: ['warpcore', 'constitution'], // Dominion, fanatic — cost unweighed
      marauder: ['engines', 'miranda'],     // Ferengi, opportunist — the hull intact
      borg_cube: ['shields', 'galaxy'],     // Borg, assimilate — the boarding door
    };
    const seen = {};
    for (const [cls, [want, me]] of Object.entries(WANT)) {
      // Eight seeds, not four. A Marauder against a Constitution rarely gets
      // through the shields at all, so whether it ever reaches the threshold
      // in a given battle is a coin toss — and a four-seed sample of a coin
      // toss fails whenever anything upstream shifts the seeds.
      for (let seed = 1n; seed <= 8n && !seen[cls]; seed++) {
        brawl({
          me, them: [cls], seed,
          each: (g, eng) => {
            for (const h of eng.liveHostiles) if (h.calledShot) seen[cls] = h.calledShot;
          },
        });
      }
      assert.equal(seen[cls], want, `a ${cls} called for ${seen[cls] ?? 'nothing'}`);
    }
  });

  test('every doctrine in the game names a system that exists', () => {
    // The bug this shape of table produced once already: `targetSubsystem`
    // documents an order that set `targetedSubsystem = 'bridge'`, a key no
    // ship has, so every shot asked to damage nothing and the order silently
    // removed all subsystem damage from the fight.
    const doctrines = new Set(Object.values(FACTIONS).map((f) => f.doctrine));
    assert.ok(doctrines.size >= 8, `only ${doctrines.size} doctrines to check`);
    const called = new Set();
    for (const faction of Object.keys(FACTIONS)) {
      const cls = Object.values(SHIP_CLASSES).find((c) => c.faction === faction);
      if (!cls) continue;
      const ship = new Ship(cls.id, { faction });
      // Reach the table the only way anything else does: through a fight.
      brawl({
        them: [cls.id], seed: 3n, limit: 90,
        each: (g, eng) => {
          for (const h of eng.liveHostiles) if (h.calledShot) called.add(h.calledShot);
        },
      });
      void ship;
    }
    assert.ok(called.size >= 3, `only ${called.size} distinct systems were ever called`);
    for (const key of called) {
      assert.ok(SUBSYSTEM_KEYS.includes(key), `somebody called a shot at "${key}"`);
    }
  });

  test('and he does not announce it every time a shield flickers', () => {
    // The threshold is a shield FACING and a shield facing crosses it
    // repeatedly, so a line on each crossing is a message every few seconds
    // from every hostile on the board.
    const { eng } = brawl({ them: ['galor', 'galor'], seed: 5n });
    const lines = eng.log.filter((l) => /is firing on our /.test(l.text ?? ''));
    assert.ok(lines.length > 0, 'nothing was ever announced');
    assert.ok(lines.length <= 2, `${lines.length} announcements from two ships`);
    const names = new Set(lines.map((l) => l.text.split(' ')[0]));
    assert.equal(names.size, lines.length, 'one ship said it twice');
  });

  test('and not while the shields he is shooting at are up', () => {
    // Subsystem damage needs a hit that reached the hull, so aiming at a
    // system through a full shield is not wrong — it is nothing. Announcing
    // it anyway is announcing weather.
    const g = new Game({ seed: 9n, crewMode: 'original' });
    g.startCombat([new Ship('galor', { faction: 'cardassian', name: 'H0' })], { relentless: true });
    const eng = g.engagement;
    const foe = eng.hostiles[0];
    foe.x = 400; foe.y = 0; foe.z = 0;
    g.ship.x = 0; g.ship.y = 0; g.ship.z = 0;
    for (const f of SUBSYSTEM_KEYS) void f;
    // Everything up: nothing called, however long the fight runs.
    for (let i = 0; i < 60; i++) {
      for (const key of Object.keys(g.ship.shields)) g.ship.shields[key] = g.ship.maxShield;
      eng.update(1 / 30);
    }
    assert.equal(foe.calledShot ?? null, null, 'a shot was called through a full shield');

    // The facing he is shooting at, flat. That is when it starts.
    const toward = facingForDirection(g.ship.directionFrom(foe));
    for (let i = 0; i < 60; i++) {
      g.ship.shields[toward] = 0;
      eng.update(1 / 30);
    }
    assert.equal(foe.calledShot, 'weapons', 'nothing was called at a flat facing');
  });
});

describe('and a called shot costs something', () => {
  test('it trades hull damage for the system', () => {
    // Naming a system used to be strictly better than not naming one: the
    // hull took exactly as much and the system took 3.2 times the hull
    // fraction instead of 1.8 on a roll it usually lost. A choice with no
    // cost is not a choice.
    const hit = (subsystem) => {
      const s = new Ship('constitution', { faction: 'federation' });
      s.shieldsUp = false;
      const before = s.hull;
      s.takeDamage(400, { direction: [1, 0, 0], type: 'beam', rng: null, subsystem });
      return { hull: before - s.hull, engines: s.subsystems.engines };
    };
    const plain = hit(null);
    const called = hit('engines');
    assert.ok(plain.hull > 0, 'the control shot did nothing at all');
    const ratio = called.hull / plain.hull;
    assert.ok(Math.abs(ratio - CALLED_SHOT_HULL) < 0.02,
      `a called shot did ${(ratio * 100).toFixed(0)}% of the hull damage, not `
      + `${(CALLED_SHOT_HULL * 100).toFixed(0)}%`);
    // And bought something with it. `rng: null` means the untargeted path
    // cannot roll a random system at all, so the control is exactly zero.
    assert.equal(plain.engines, 1, 'an untargeted shot damaged a system with no rng to roll');
    assert.ok(called.engines < 0.9, `the engines are at ${called.engines} after a called shot`);
  });

  test('and the cost is real enough to matter', () => {
    // A cost of a couple of percent is a rounding error dressed as a
    // decision. Measured: at no cost at all the player died 53 times in 120
    // fights and the median battle ran 40 seconds; at this cost, 48 and 50
    // against 38 and 46 with nobody but the player calling shots.
    assert.ok(CALLED_SHOT_HULL <= 0.8 && CALLED_SHOT_HULL >= 0.5,
      `a called shot keeps ${CALLED_SHOT_HULL} of its hull damage, which is not a trade`);
  });

  test('and both weapon paths carry it', () => {
    // `fireWeapon` reads the subsystem twice — once when it queues a torpedo
    // and once when a beam or cannon resolves immediately — and the two are
    // separate lines. Disabling only the beam one left every assertion in this
    // file passing, because a D7 carries torpedoes and they were enough.
    const each = (type) => {
      const g = new Game({ seed: 6n, crewMode: 'original' });
      g.startCombat([new Ship('d7', { faction: 'klingon', name: 'H0' })], { relentless: true });
      const eng = g.engagement;
      const foe = eng.hostiles[0];
      const weapon = foe.weapons.find((w) => (w.type === 'torpedo') === (type === 'torpedo'));
      assert.ok(weapon, `a D7 has no ${type}`);
      foe.x = 300; foe.y = 0; foe.z = 0;
      g.ship.x = 0; g.ship.y = 0; g.ship.z = 0;
      for (const k of Object.keys(g.ship.shields)) g.ship.shields[k] = 0;
      g.ship.shieldsUp = false;
      let low = 1;
      for (let i = 0; i < 200 && !eng.over; i++) {
        // Set INSIDE the loop. `chooseAction` runs during `update` and decides
        // the called shot afresh on every decision tick, so a value set once
        // before the loop is null again after the first frame — and the
        // measurement then reports that the wiring does not work when what it
        // has actually measured is the AI changing its mind.
        for (const k of Object.keys(g.ship.shields)) g.ship.shields[k] = 0;
        g.ship.shieldsUp = false;
        foe.calledShot = 'engines';
        weapon.cooldown = 0;
        eng.fireWeapon(foe, weapon, g.ship);
        eng.update(1 / 30);
        low = Math.min(low, g.ship.subsystems.engines);
      }
      return low;
    };
    for (const type of ['beam', 'torpedo']) {
      assert.ok(each(type) < 0.9,
        `a called shot fired as a ${type} never reached the engines`);
    }
  });

  test('the player pays it too', () => {
    // Symmetric on purpose. The rule a captain learns by using it is the rule
    // that gets used on him, and an AI-only cost would be a difficulty dial
    // wearing a mechanic's clothes.
    const run = (key) => {
      const g = new Game({ seed: 4n, crewMode: 'original' });
      g.startCombat([new Ship('d7', { faction: 'klingon', name: 'H0' })], { relentless: true });
      const eng = g.engagement;
      const foe = eng.hostiles[0];
      foe.shieldsUp = false;
      const before = foe.hull;
      eng.targetSubsystem(key);
      // The LOW WATER MARK again: subsystems repair passively out of the red,
      // and chip damage from a shot that mostly hit a shield is healed between
      // ticks. Read at the end, both runs report 1.00 and the assertion below
      // is comparing two ships that have finished mending.
      let engines = 1;
      for (let i = 0; i < 240; i++) {
        eng.comeAboutTo(foe);
        eng.update(1 / 30);
        engines = Math.min(engines, foe.subsystems.engines);
      }
      return { hull: before - foe.hull, engines };
    };
    const plain = run(null);
    const called = run('engines');
    assert.ok(plain.hull > 0 && called.hull > 0, 'neither run did any damage');
    assert.ok(called.hull < plain.hull,
      `calling the shot cost the player nothing: ${called.hull.toFixed(0)} against ${plain.hull.toFixed(0)}`);
    assert.ok(called.engines < plain.engines,
      'and bought nothing: engines ended at '
      + `${called.engines.toFixed(2)} either way`);
  });
});

describe('what it does to the player over a whole battle', () => {
  test('each faction wrecks the system its own doctrine wants', () => {
    const worst = (them, me = 'constitution') => {
      const low = Object.fromEntries(SUBSYSTEM_KEYS.map((k) => [k, 1]));
      for (let seed = 1n; seed <= 6n; seed++) {
        // The LOW WATER MARK, sampled during the battle. Read afterwards
        // every number is 1.000 for every opponent including the ones that
        // killed the player every time, because ending an engagement runs
        // `resolveCombat` and the ship that comes back is repaired.
        brawl({
          me, them, seed,
          each: (g) => {
            for (const k of SUBSYSTEM_KEYS) low[k] = Math.min(low[k], g.ship.subsystems[k]);
          },
        });
      }
      return Object.entries(low).sort((a, b) => a[1] - b[1])[0];
    };
    const klingon = worst(['d7', 'd7']);
    assert.equal(klingon[0], 'shields',
      `a pair of D7s took our ${klingon[0]} down furthest, not our shields`);
    assert.ok(klingon[1] < 0.4, `and only to ${klingon[1].toFixed(2)}`);

    const cardassian = worst(['galor', 'galor']);
    assert.equal(cardassian[0], 'weapons',
      `a pair of Galors took our ${cardassian[0]} down furthest, not our weapons`);
    assert.ok(cardassian[1] < 0.4, `and only to ${cardassian[1].toFixed(2)}`);
  });

  test('and the battle is still a battle', () => {
    // The guard on the whole change. Called shots make the enemy better, and
    // an enemy who is better in a way that stalls the fight is worse. Nobody
    // knocks the player's guns out and then circles for five minutes.
    const runs = [];
    for (let seed = 1n; seed <= 8n; seed++) {
      runs.push(brawl({ them: ['galor', 'galor'], seed }).seconds);
    }
    runs.sort((a, b) => a - b);
    const median = runs[runs.length >> 1];
    assert.ok(median < 150, `the median battle now runs ${median.toFixed(0)} seconds`);
    assert.ok(runs[runs.length - 1] < 400, 'a battle ran to the time limit');
  });
});
