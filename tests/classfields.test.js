// Five fields on the ship classes that nothing read, and only two of them
// should be wired.
//
// The same sweep that found `stealthDetect`, pointed at the world data with the
// denominator asserted first:
//
//     SYSTEMS        43 records, 16 distinct fields, ZERO orphans
//     SHIP_CLASSES   31 records, 29 distinct fields, FIVE orphans
//
// Four of the five appear nowhere else in `src/` at all. The fifth does, and
// this file said otherwise — see the correction on `boffSeats` below:
//
//     boffSeats         13 classes, a [{dept, rank}] seat layout
//     auxBonus           3 classes (25, 35, 30) — all three science hulls
//     saucerSeparation   1 class (galaxy)
//     ablative           1 class (defiant)
//     refitOf            1 class (constitution_refit -> constitution)
//
// Two are wired here. THREE ARE DELIBERATELY LEFT, and the reasons are the
// point of this file — a sweep whose only output is "wire everything you find"
// is a sweep that will eventually break something.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Ship, ABLATIVE_RESIST } from '../src/sim/ship.js';
import { SHIP_CLASSES, commandableAt } from '../src/world/ships.data.js';
import { ABILITIES } from '../src/sim/officers.js';

/** A ship of this class, power settled, so `factor` reads a real level. */
function settled(classId, preset = 'balanced') {
  const s = new Ship(classId, { faction: 'federation', name: 'T' });
  s.power.applyPreset(preset);
  s.power.levels = { ...s.power.target };
  return s;
}

describe('auxBonus: three science hulls that ran on a freighter\'s auxiliary', () => {
  test('the field is on the hulls the sweep said it was on', () => {
    const carriers = Object.values(SHIP_CLASSES).filter((c) => c.auxBonus);
    assert.equal(carriers.length, 3, `${carriers.length} hulls declare auxBonus`);
    for (const c of carriers) assert.ok(c.auxBonus >= 25);
  });

  test('and a science hull now works its auxiliary harder than a freighter', () => {
    const plain = settled('miranda').power.factor('auxiliary');
    for (const id of ['oberth', 'nebula', 'intrepid']) {
      const sci = settled(id).power.factor('auxiliary');
      assert.ok(sci > plain + 0.2, `${id} ${sci.toFixed(3)} against miranda ${plain.toFixed(3)}`);
    }
  });

  test('and it is auxiliary, not a bigger grid', () => {
    // A larger `cap` would be power the captain could put into the weapons,
    // which is not what a science package is. The total the grid distributes
    // must be untouched.
    const sci = settled('oberth');
    assert.equal(sci.power.cap, SHIP_CLASSES.oberth.powerCap,
      'the science package became general-purpose power');
    assert.ok(sci.power.factor('weapons') <= settled('oberth').power.factor('weapons') + 1e-9);
  });

  test('and it survives a save, because it comes off the hull', () => {
    const s = settled('oberth');
    const back = Ship.load(JSON.parse(JSON.stringify(s.save())));
    assert.equal(back.power.auxBonus, SHIP_CLASSES.oberth.auxBonus);
    assert.ok(back.power.factor('auxiliary') > settled('miranda').power.factor('auxiliary'));
  });
});

describe('ablative: one hull that was armoured on paper', () => {
  test('exactly one class carries it', () => {
    const carriers = Object.values(SHIP_CLASSES).filter((c) => c.ablative);
    assert.equal(carriers.length, 1);
    assert.equal(carriers[0].id, 'defiant');
  });

  test('and it takes less from the same hit', () => {
    const hit = (id) => {
      const s = new Ship(id, { faction: 'federation', name: 'T' });
      for (const f of Object.keys(s.shields)) s.shields[f] = 0;
      const before = s.hull;
      s.takeDamage(1000, { bearing: 0 });
      return before - s.hull;
    };
    const armoured = hit('defiant');
    const bare = hit('intrepid');
    assert.ok(armoured < bare, `${armoured} against ${bare}`);
    assert.ok(Math.abs(armoured / bare - (1 - ABLATIVE_RESIST)) < 0.02,
      `${armoured} of ${bare} is not ${ABLATIVE_RESIST} of resistance`);
  });

  test('and it survives the modifier stack being rebuilt', () => {
    // Taken off the class, the way `cls.adapts` is, precisely so that
    // `applyAllMods` resetting `mods` to the baseline cannot erase the
    // plating. A refit, a promotion or a console change would otherwise
    // unarmour the ship.
    const g = new Game({ seed: 2n, crewMode: 'original', shipClass: 'defiant' });
    const hit = () => {
      for (const f of Object.keys(g.ship.shields)) g.ship.shields[f] = 0;
      const before = g.ship.hull;
      g.ship.takeDamage(500, { bearing: 0 });
      const took = before - g.ship.hull;
      g.ship.hull = g.ship.maxHull;
      return took;
    };
    const first = hit();
    g.applyAllMods();
    assert.ok(Math.abs(hit() - first) < 1e-6, 'rebuilding the modifiers stripped the armour');
  });

  test('and the total resistance is still capped', () => {
    // 0.85 is the ceiling and the plating has to leave room under it for
    // everything a captain fits on top.
    assert.ok(ABLATIVE_RESIST > 0 && ABLATIVE_RESIST < 0.3);
    const s = new Ship('defiant', { faction: 'federation', name: 'T' });
    s.applyMods({ damageResist: 5 });
    for (const f of Object.keys(s.shields)) s.shields[f] = 0;
    const before = s.hull;
    s.takeDamage(1000, { bearing: 0 });
    assert.ok(before - s.hull >= 1000 * 0.15 - 1, 'a ship became immune');
  });
});

describe('three that are left alone, and why', () => {
  test('boffSeats names three or four departments; the bridge has six', () => {
    // The measurement that decided it. Enforcing the seat layout would leave a
    // Galaxy — 1,014 crew and a full sickbay — unable to use ANY medical
    // ability, and a Miranda unable to use `evasive_maneuvers`, which is rank
    // one. The data is an STO tactical/engineering/science/universal station
    // layout and does not map onto this game's six-department bridge.
    const depts = new Set(Object.values(ABILITIES).map((a) => a.dept));
    assert.equal(depts.size, 6, `the bridge has ${depts.size} departments`);

    const galaxy = SHIP_CLASSES.galaxy.boffSeats;
    assert.ok(galaxy, 'the galaxy declares no seats, so this proves nothing');
    const named = new Set(galaxy.map((s) => s.dept));
    assert.ok(named.size < depts.size,
      'the seat layout names every department, so the mismatch is gone and this can be revisited');
    assert.equal(named.has('medical'), false,
      'the galaxy now seats a medical officer, so the reason recorded here no longer holds');

    // And it is still declared, so a future sweep finds it again.
    const carriers = Object.values(SHIP_CLASSES).filter((c) => c.boffSeats);
    assert.equal(carriers.length, 13);
  });

  test('but boffSeats is NOT unread — it decides what the shipyard sells', () => {
    // A correction to this file's own header. The sweep that produced it
    // reported `boffSeats` as appearing nowhere else in `src/`, and it does:
    //
    //     ships.data.js:499  s.faction === 'federation' && s.boffSeats && s.tier <= tier
    //
    // `commandableAt` uses it as a truthiness flag meaning "a hull the player
    // may command", which is why thirteen classes carry it and eighteen do
    // not. It was missed because it lives in the file that DECLARES the field,
    // and the sweep looked everywhere else. Reading the seat CONTENTS is still
    // nobody's job, and the test above is still the reason that stays true —
    // but the field is load-bearing and deleting it would empty every shipyard
    // in the game.
    const commandable = commandableAt(9);
    assert.ok(commandable.length >= 10, `${commandable.length} hulls on sale`);
    for (const c of commandable) {
      assert.ok(c.boffSeats, `${c.id} is on sale without a seat layout`);
    }
    // And the gate is real: every Federation hull WITHOUT seats is unbuyable.
    const seatless = Object.values(SHIP_CLASSES)
      .filter((c) => c.faction === 'federation' && !c.boffSeats);
    for (const c of seatless) {
      assert.ok(!commandable.some((o) => o.id === c.id),
        `${c.id} has no seats and is on sale anyway, so the flag is not the gate`);
    }
  });

  test('saucerSeparation is a feature, not an unread number', () => {
    // One class. Wiring it means two ships from one hull — placement, the AI,
    // the renderer, saves, and what happens when one half is destroyed. That
    // is not a defect-hunt change.
    const carriers = Object.values(SHIP_CLASSES).filter((c) => c.saucerSeparation);
    assert.equal(carriers.length, 1);
    assert.equal(carriers[0].id, 'galaxy');
  });

  test('refitOf was wired, and the wiring was wrong', () => {
    // Half the parent hull's mastery, on the argument that a refit is the same
    // ship in the ways that matter to the people who fly her. Both the game and
    // the fiction disagreed: `tests/wiring.test.js` asserts that taking a new
    // command starts at tier 0 with the shakedown applied — "no shakedown on a
    // hull nobody has flown" — and the promotion from a Constitution offers
    // exactly the Constitution Refit, so the two collided head-on. The one
    // famous refit in the franchise is the case where a veteran crew had to
    // learn their own ship again.
    //
    // It stays unread on purpose. This asserts the decision, so the next sweep
    // finds the reason instead of the field.
    const g = new Game({ seed: 2n, crewMode: 'original', shipClass: 'constitution' });
    g.mastery.points.constitution = 1700;
    g.mastery.classId = 'constitution_refit';
    assert.equal(g.mastery.current, 0,
      'a refit inherited mastery, which contradicts the shakedown rule in wiring.test.js');
    assert.equal(SHIP_CLASSES.constitution_refit.refitOf, 'constitution');
  });
});
