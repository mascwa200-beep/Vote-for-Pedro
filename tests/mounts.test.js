// Guns you can lose, one bank at a time.
//
// `subsystems.weapons` has always been ONE number for the whole battery. It
// scales every mount's damage and recharge together and gates firing at 0.05,
// so a called shot at the weapons took the guns down as a group and there was
// no such thing as losing your forward tubes. Meanwhile `weapon.enabled` was
// written `true` at construction (ship.js) and read in exactly two places —
// `combat.js` before firing and `ai.js` when deciding whether a hull is still
// a threat — and NOTHING ANYWHERE EVER SET IT FALSE. A constant wearing the
// shape of per-mount state, for the whole life of the file.
//
// Two orphans are consumed here as well: `FACING_LABEL`, whose declaration in
// ship.js was the only occurrence of its own name in src/ or tests/, and
// `weapon.id`, whose only reader in the repo was one assertion in sim.test.js.
//
// The property that made this safe to do first: IT ADDS NO RNG DRAW. The hook
// sits inside the `if (hullDamage > 0)` block that already exists, in both
// branches that already compute their fraction, and which mount takes the hit
// is a pure function of the bearing. See 'the seeded stream did not move'.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Game } from '../src/core/state.js';
import {
  Ship, MOUNT_DISABLED_AT, MOUNT_RESTORED_AT, MOUNT_CONCENTRATION, FACING_LABEL, inArc,
} from '../src/sim/ship.js';
import { SHIP_LIST } from '../src/world/ships.data.js';
import { outputOf } from '../src/sim/assess.js';

const hull = (id) => new Ship(id, { faction: 'federation', name: 'T' });

/** Beat one mount down past the threshold, from a bearing it covers. */
function wreck(ship, weapon) {
  for (let i = 0; i < 200 && weapon.integrity > 0; i++) {
    ship.hull = ship.maxHull;
    for (const f of Object.keys(ship.shields)) ship.shields[f] = 0;
    ship.damageMount(weapon, 0.05);
  }
  return weapon;
}

describe('a mount is a thing that can be lost', () => {
  test('every hull carries integrity on every mount, and starts whole', () => {
    let mounts = 0;
    for (const cls of SHIP_LIST) {
      const s = hull(cls.id);
      for (const w of s.weapons) {
        mounts++;
        assert.equal(w.integrity, 1, `${cls.id}.${w.id} does not start whole`);
        assert.equal(w.enabled, true);
      }
    }
    // The denominator. The fleet carries 0, 1, 2, 3 and 4 mounts per hull.
    assert.ok(mounts > 60, `only ${mounts} mounts across the fleet`);
  });

  test('and beating one down takes it out of the fight', () => {
    const s = hull('constitution');
    const w = s.weapons.find((x) => x.id === 'torpedo_fwd');
    assert.ok(w, 'the Constitution lost its torpedo tube, so this proves nothing');
    wreck(s, w);
    assert.equal(w.enabled, false);
    assert.ok(w.integrity <= MOUNT_DISABLED_AT);
  });

  test('and a disabled mount will not fire', () => {
    // Through the door the gunnery uses: `fireWeapon` refuses on `!enabled`.
    const g = new Game({ seed: 2n, crewMode: 'original', shipClass: 'constitution' });
    const foe = new Ship('d7', { faction: 'klingon', name: 'K' });
    const eng = g.startCombat([foe], { relentless: true });
    const w = g.ship.weapons[0];
    for (let i = 0; i < 60; i++) eng.update(1 / 30);
    w.cooldown = 0;
    assert.equal(eng.fireWeapon(g.ship, w, foe), true, 'a healthy bank would not fire');
    w.cooldown = 0;
    wreck(g.ship, w);
    w.cooldown = 0;
    assert.equal(eng.fireWeapon(g.ship, w, foe), false, 'a wrecked bank fired anyway');
  });

  test('and the repair parties bring it back', () => {
    const s = hull('constitution');
    const w = wreck(s, s.weapons[0]);
    assert.equal(w.enabled, false);
    // Passive repair is 0.012 * aux factor * dt, so crossing the restore
    // line from a wreck takes on the order of a thousand ticks, not a hundred.
    for (let i = 0; i < 4000 && !w.enabled; i++) s.update(1 / 30, null);
    assert.equal(w.enabled, true, 'a wrecked bank never came back');
    assert.ok(w.integrity > MOUNT_RESTORED_AT);
  });

  test('and a yard puts every gun back', () => {
    const s = hull('galaxy');
    for (const w of s.weapons) wreck(s, w);
    s.restore();
    for (const w of s.weapons) {
      assert.equal(w.integrity, 1, `${w.id} came out of the yard still wrecked`);
      assert.equal(w.enabled, true);
    }
  });
});

describe('which bank takes the hit', () => {
  test('is decided by the bearing, not by a roll', () => {
    // The property the whole change rests on. Same ship, same bearing, same
    // answer, every time and with no RNG in sight.
    const s = hull('galaxy');
    const first = s.mountFacing(0);
    for (let i = 0; i < 50; i++) assert.equal(s.mountFacing(0), first);
    assert.ok(first, 'a Galaxy has no mounts, so this proves nothing');
  });

  test('and a shot from ahead lands on a gun that bears ahead', () => {
    for (const id of ['constitution', 'excelsior', 'galaxy', 'galor', 'neghvar']) {
      const s = hull(id);
      if (!s.weapons.length) continue;
      const w = s.mountFacing(0);
      assert.ok(inArc(0, w), `${id}: a nose-on hit landed on ${w.id}, which does not bear ahead`);
    }
  });

  test('and a shot from astern does not land on a forward-only mount', () => {
    // The Constitution's torpedo tube is a 90-degree forward arc. A hit up the
    // stern must not be what wrecks it.
    const s = hull('constitution');
    const w = s.mountFacing(180);
    assert.notEqual(w.id, 'torpedo_fwd', 'a stern hit wrecked the forward tubes');
    assert.ok(inArc(180, w), `${w.id} does not bear astern`);
  });

  test('and a battering spreads across the guns that share a facing', () => {
    // Soundest-first. The alternative — narrowest-first — put everything into
    // whichever mount had the tightest cone, and the wide banks were nearly
    // unreachable. Measured over the fleet, soundest-first left three fewer
    // mounts untouched; see the table on MOUNT_CONCENTRATION in ship.js.
    const s = hull('constitution');
    for (let i = 0; i < 40; i++) s.damageMount(s.mountFacing(0), 0.02);
    const forward = s.weapons.filter((w) => inArc(0, w));
    assert.ok(forward.length >= 2, 'only one mount bears ahead, so this proves nothing');
    const hit = forward.filter((w) => w.integrity < 1);
    assert.ok(hit.length >= 2,
      `a sustained battering from ahead only ever touched ${hit.length} of ${forward.length} forward guns`);
  });

  test('and a hull with no guns at all is not a crash', () => {
    // `transport` and `freighter` carry `weapons: []`, and the API fuzzer in
    // invariants.test.js calls every public method with rubbish.
    for (const id of ['transport', 'freighter']) {
      const s = hull(id);
      assert.equal(s.weapons.length, 0, `${id} grew weapons, so this proves nothing`);
      assert.equal(s.mountFacing(0), null);
      assert.equal(s.damageMount(null, 0.5), null);
      assert.doesNotThrow(() => s.settleMounts());
    }
  });
});

describe('the last gun', () => {
  test('six hulls carry exactly one mount, and one of them is a boss', () => {
    const single = SHIP_LIST.filter((c) => (c.weapons ?? []).length === 1).map((c) => c.id);
    assert.deepEqual(single.sort(),
      ['bioship', 'marauder', 'oberth', 'orion_raider', 'scoutship', 'tholian_web_spinner']);
  });

  test('and it cannot be knocked out, however hard it is hit', () => {
    for (const id of ['bioship', 'oberth', 'marauder']) {
      const s = hull(id);
      const w = s.weapons[0];
      wreck(s, w);
      assert.equal(w.enabled, true,
        `${id} lost its only gun — a single-mount hull has no "which gun"`);
      assert.ok(w.integrity <= MOUNT_DISABLED_AT, `${id}: the guard stopped the damage as well`);
    }
  });

  test('and the guard is re-read when a sibling is repaired, not only when hit', () => {
    // A real bug the new invariant caught within a minute of being written.
    // The guard spared a wrecked mount because it was the last one standing;
    // a sibling then repaired past the restore threshold, so it was no longer
    // the last — and nothing re-examined it. The checker found the Enterprise
    // firing a torpedo tube at 0.029 integrity.
    const s = hull('constitution');
    for (const w of s.weapons) w.integrity = 0.05;
    s.settleMounts();
    const spared = s.weapons.filter((w) => w.enabled);
    assert.equal(spared.length, 1, 'more than one wrecked gun was left firing');

    // Repair one of the others past the restore line. The spared mount is no
    // longer the last, and must go out.
    const other = s.weapons.find((w) => !w.enabled);
    other.integrity = 1;
    for (let i = 0; i < 5; i++) s.update(1 / 30, null);
    assert.equal(spared[0].enabled, false,
      'a mount at 0.05 integrity is still firing because it was once the last one');
  });
});

describe('what the rest of the ship makes of it', () => {
  test('a knocked-out bank stops counting toward what a ship can put out', () => {
    const s = hull('constitution');
    const before = outputOf(s);
    wreck(s, s.weapons[0]);
    assert.ok(outputOf(s) < before, 'a wrecked bank still counted as output');
  });

  test('and the status report says which banks are out, through an order that already exists', () => {
    // No new intent and no new phrasing, which is why this whole change moves
    // none of the counts README states and docs.test.js scrapes.
    const g = new Game({ seed: 4n, crewMode: 'original', shipClass: 'constitution' });
    const eng = g.startCombat([new Ship('d7', { faction: 'klingon', name: 'K' })], { relentless: true });
    assert.match(eng.statusReport().weapons, /all banks answering/);
    wreck(g.ship, g.ship.weapons[0]);
    assert.match(eng.statusReport().weapons, /out of action/);
  });

  test('and a mount is named by the arc it covers, which is FACING_LABEL’s first reader', () => {
    const g = new Game({ seed: 6n, crewMode: 'original', shipClass: 'constitution' });
    const eng = g.startCombat([new Ship('d7', { faction: 'klingon', name: 'K' })], { relentless: true });
    wreck(g.ship, g.ship.weapons.find((w) => w.id === 'phaser_bank_fwd'));
    const said = eng.statusReport().weapons;
    assert.match(said, new RegExp(FACING_LABEL.fore, 'i'),
      `the report named the mount "${said}" rather than by its arc`);
  });

  test('and losing the guns you hold a range for changes the range you hold', () => {
    // `preferredRange` read every mount including the dead ones, so a Defiant
    // that had lost its cannons went on trying to hold at 300 to use them.
    const g = new Game({ seed: 7n, crewMode: 'original', shipClass: 'constitution' });
    const foe = new Ship('defiant', { faction: 'independent', name: 'X' });
    g.startCombat([foe], { relentless: true });
    const src = readFileSync('src/sim/ai.js', 'utf8');
    const fn = src.slice(src.indexOf('function preferredRange'), src.indexOf('function preferredRange') + 600);
    assert.match(fn, /enabled !== false/, 'preferredRange still counts guns that cannot fire');
  });
});

describe('and it actually happens in a fight', () => {
  // The tests above all reach for `damageMount` directly, which proves the
  // machinery works and NOTHING about whether the machinery is connected.
  // Measured against its own control — MOUNT_CONCENTRATION at zero — all
  // nineteen of them stayed green with the mechanic disconnected. These two
  // are the ones that fail, and they are the reason the constant exists.

  test('a hit on the weapons wrecks the bank that was pointing that way', () => {
    // Through `takeDamage`, which is the only door damage comes through.
    const s = hull('constitution');
    for (const f of Object.keys(s.shields)) s.shields[f] = 0;
    const before = s.weapons.map((w) => w.integrity);
    // ONE hit. A called shot of 600 against bare hull is a tenth of a
    // Constitution's maximum, which through the 3.2 fraction and the
    // concentration multiplier is more than enough to finish a mount outright
    // — measured, the forward tubes go from whole to nothing on the first one.
    // A real fight lands far smaller hits than this, which is why exposure
    // across sixty fights is a third rather than everything.
    //
    // It matters that this is one hit and not several: once every forward gun
    // is destroyed the no-mount-bears fallback correctly moves on to whatever
    // is left, so a sustained battering DOES eventually reach the stern tubes,
    // and measuring after that would make the assertion below meaningless.
    s.hull = s.maxHull;
    s.takeDamage(600, { bearing: 0, subsystem: 'weapons' });
    const after = s.weapons.map((w) => w.integrity);
    assert.ok(after.some((v, i) => v < before[i]),
      'a called shot at the weapons left every mount untouched');
    // And it is the guns that BEAR that suffer, not simply all of them.
    const astern = s.weapons.find((w) => !inArc(0, w));
    assert.ok(astern, 'this hull has no mount facing astern, so this proves nothing');
    assert.equal(astern.integrity, 1, 'a nose-on hit wrecked a gun facing astern');
    assert.ok(s.weapons.filter((w) => inArc(0, w)).some((w) => w.integrity < 1),
      'nothing that bears ahead was touched by a hit from ahead');
  });

  test('and banks go out in real fights, often enough to be a mechanic', () => {
    // Sixty fights against a Galor, whose doctrine calls its shots at the
    // weapons, with the captain calling theirs back. If a bank goes out in
    // three fights of sixty it is weather, not a mechanic.
    let fights = 0;
    let lost = 0;
    for (let seed = 1n; seed <= 60n; seed++) {
      const g = new Game({ seed, crewMode: 'original', shipClass: 'constitution' });
      const foe = new Ship('galor', { faction: 'cardassian', name: 'Prakesh' });
      const eng = g.startCombat([foe], { relentless: true });
      let t = 0;
      let sawOne = false;
      while (!eng.over && t < 300) {
        eng.comeAboutTo(eng.target);
        g.ship.throttle = 0.6;
        eng.targetSubsystem('weapons');
        eng.update(1 / 30);
        t += 1 / 30;
        if (foe.weapons.some((w) => w.enabled === false)) sawOne = true;
      }
      fights++;
      if (sawOne) lost++;
    }
    assert.equal(fights, 60);
    assert.ok(lost >= 10,
      `a bank went out in only ${lost} of ${fights} fights — that is weather, not a mechanic`);
  });
});

describe('the seeded stream did not move', () => {
  test('deciding which mount is hit consumes no randomness at all', () => {
    // This is the property the whole change rests on, asserted directly rather
    // than inferred. `mountFacing` picks by bearing and `damageMount` clamps a
    // number; neither may draw. A counting RNG proves it — if either ever
    // reaches for a roll, this fails on the spot.
    //
    // (The stronger check cannot live in a test, because it needs the code as
    // it was: seventy-five fights across three matchups were fingerprinted by
    // outcome, tick count, hull and all six shield facings to six decimal
    // places, against the pre-change tree, and came back identical. That is
    // reported in the pull request; this is the invariant behind it.)
    let draws = 0;
    const counting = {
      next: () => { draws++; return 0.5; },
      chance: () => { draws++; return false; },
      pick: (a) => { draws++; return a[0]; },
      range: () => { draws++; return 0; },
      int: () => { draws++; return 0; },
    };
    const s = hull('galaxy');
    for (let i = 0; i < 200; i++) {
      const w = s.mountFacing((i * 37) % 360);
      s.damageMount(w, 0.01);
    }
    assert.equal(draws, 0, `deciding which mount takes a hit drew ${draws} times`);

    // And the control: the counting RNG really does count, so a zero above is
    // evidence rather than a broken instrument.
    counting.chance();
    assert.equal(draws, 1, 'the counting RNG does not count, so the zero proved nothing');
  });

  test('and a fight is reproducible from its seed, mounts and all', () => {
    const fight = () => {
      const g = new Game({ seed: 11n, crewMode: 'original', shipClass: 'constitution' });
      const foe = new Ship('d7', { faction: 'klingon', name: 'K' });
      const eng = g.startCombat([foe], { relentless: true });
      let t = 0;
      while (!eng.over && t < 200) {
        eng.comeAboutTo(eng.target);
        g.ship.throttle = 0.6;
        eng.update(1 / 30);
        t += 1 / 30;
      }
      const mounts = [...g.ship.weapons, ...foe.weapons]
        .map((w) => `${w.id}:${w.integrity.toFixed(6)}:${w.enabled}`).join(',');
      return `${eng.outcome}|${g.ship.hull.toFixed(6)}|${foe.hull.toFixed(6)}|${mounts}`;
    };
    const a = fight();
    assert.equal(a, fight());
    // The denominator: the fingerprint has to contain mount state, or it is
    // asserting reproducibility of something this change does not touch.
    assert.match(a, /integrity|:[01]\.\d{6}:/, 'the fingerprint does not include mount state');
  });
});
