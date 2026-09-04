// What the other captain does about it.
//
// Every hostile in the game used to fly a course, choose a range, and shoot,
// and that was the whole of the repertoire. These tests are about the orders
// they give now — that the orders fire, that they fire for a reason, that the
// player is told, and that the one order which presses an advantage can be
// answered.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';
import { Character } from '../src/rules/character.js';
import { ABILITIES } from '../src/sim/officers.js';
import { FACTIONS } from '../src/world/factions.data.js';
import { SHIP_CLASSES } from '../src/world/ships.data.js';
import { DOCTRINE_TACTICS, chooseTactic, tickTactics } from '../src/sim/tactics.js';

function battle({ me = 'constitution', them = ['d7'], seed = 1, place = 'sol' } = {}) {
  const g = new Game({
    seed: BigInt(seed), crewMode: 'original', shipClass: me,
    character: new Character({ speciesId: 'human', careerId: 'tactical' }),
  });
  g.locationId = place;
  g.startCombat(them.map((c, i) => new Ship(c, {
    faction: SHIP_CLASSES[c].faction, name: `H${i + 1}`,
  })));
  return { g, eng: g.engagement };
}

/** Fly it, with a pilot that either breaks off when hurt or does not. */
function fly(eng, g, { breakOffAt = null, cap = 600 } = {}) {
  let t = 0;
  let ordered = false;
  while (!eng.over && t < cap) {
    eng.comeAboutTo(eng.target);
    g.ship.throttle = 0.6;
    g.ship.power.applyPreset(g.ship.shieldPct < 0.35 ? 'defense' : 'attack');
    if (breakOffAt !== null && !ordered && g.ship.hullPct < breakOffAt) {
      ordered = true;
      eng.beginWarpOut();
    }
    eng.update(1 / 30);
    t += 1 / 30;
  }
  return { seconds: t, outcome: eng.outcome };
}

describe('the orders the other captain gives', () => {
  test('every doctrine in the world data has tactics', () => {
    // The same rule the arena kinds live under: a doctrine added to
    // factions.data.js with no entry here would fly exactly as it did before
    // and nothing would say so.
    const declared = new Set(Object.values(FACTIONS).map((f) => f.doctrine).filter(Boolean));
    assert.ok(declared.size >= 8, `only ${declared.size} doctrines in the world data`);
    for (const d of declared) {
      assert.ok(DOCTRINE_TACTICS[d]?.length, `doctrine '${d}' has no tactics`);
    }
    // And nothing here belongs to a doctrine nobody flies.
    for (const d of Object.keys(DOCTRINE_TACTICS)) {
      assert.ok(declared.has(d), `DOCTRINE_TACTICS.${d} is a doctrine no faction has`);
    }
    // Every tactic is a real ability out of the player's own tray — that is
    // the point of the module, and a typo here would silently give a doctrine
    // one fewer order than it looks like it has.
    for (const [d, list] of Object.entries(DOCTRINE_TACTICS)) {
      for (const id of list) {
        assert.ok(ABILITIES[id], `${d} lists '${id}', which is not an ability`);
      }
    }
  });

  test('an order is given for a reason, and not otherwise', () => {
    const { g, eng } = battle();
    const h = eng.hostiles[0];
    // Untouched: nothing to react to.
    assert.equal(chooseTactic(h, g.ship, eng, 'aggressive'), null,
      'a captain at full strength gave an order anyway');

    // Shields nearly gone: reroute.
    for (const f of Object.keys(h.shields)) h.shields[f] = h.maxShield * 0.1;
    assert.equal(chooseTactic(h, g.ship, eng, 'aggressive'), 'emergency_power_shields');
    assert.ok(h.hasBuff('emergency_power_shields'));
    // And the log said so, naming the ship.
    const said = eng.log[eng.log.length - 1]?.text ?? '';
    assert.match(said, new RegExp(`^${h.name} `), `the log said "${said}"`);

    // Not twice: it is on cooldown now.
    assert.equal(chooseTactic(h, g.ship, eng, 'aggressive'), null,
      'the same order was given twice in a row');
    assert.ok(h.tacticCooldowns.emergency_power_shields > 0);
  });

  test('a cooldown runs on the frame clock, not the decision clock', () => {
    // `chooseAction` re-decides twice a second; a cooldown ticked there would
    // run at two thirds speed at 30fps and every enemy ability would last half
    // as long again as the player's own.
    //
    // Driven through `eng.update` rather than by calling `tickTactics`
    // directly. The first version called it directly and so tested only its
    // arithmetic: deleting the call site in ai.js entirely left it passing,
    // which the control found and the test did not.
    const { g, eng } = battle();
    const h = eng.hostiles[0];
    h.tacticCooldowns = { brace_for_impact: 10 };
    for (let i = 0; i < 30; i++) {
      g.ship.throttle = 0.6;
      eng.update(1 / 30);
    }
    assert.ok(Math.abs(h.tacticCooldowns.brace_for_impact - 9) < 0.05,
      `one second of engagement took ${(10 - h.tacticCooldowns.brace_for_impact).toFixed(3)}s `
      + 'off a ten-second cooldown');
    // And the helper's own arithmetic, so a failure above says which half.
    const solo = { tacticCooldowns: { x: 5 } };
    for (let i = 0; i < 30; i++) tickTactics(solo, 1 / 30);
    assert.ok(Math.abs(solo.tacticCooldowns.x - 4) < 1e-6);
  });

  test('going evasive is taken back when the order expires', () => {
    // `ship.evasive` is a plain boolean and the buff is a separate thing with
    // a clock on it. Nothing else in the game would ever clear the flag, so a
    // raider that jinked once would have flown evasive for the rest of the
    // engagement on a fifteen-second order.
    const { g, eng } = battle({ them: ['orion_raider'] });
    const h = eng.hostiles[0];
    h.hull = h.maxHull * 0.4;
    assert.equal(chooseTactic(h, g.ship, eng, 'opportunist'), 'evasive_maneuvers');
    assert.equal(h.evasive, true, 'the order did not set the flag');
    tickTactics(h, 1 / 30);
    assert.equal(h.evasive, true, 'the flag was dropped while the order still stood');
    // Age the buff out the way Ship.update does.
    h.buffs = h.buffs.filter((b) => b.id !== 'evasive_maneuvers');
    tickTactics(h, 1 / 30);
    assert.equal(h.evasive, false, 'the flag outlived the order');
  });

  test('a cloaked captain and a fleeing one give no orders', () => {
    const { g, eng } = battle({ them: ['bird_of_prey'] });
    const h = eng.hostiles[0];
    h.hull = h.maxHull * 0.3;
    for (const f of Object.keys(h.shields)) h.shields[f] = 0;

    h.cloakCooldown = 0;
    assert.ok(h.cloak(), 'the setup could not cloak');
    assert.equal(chooseTactic(h, g.ship, eng, 'ambush'), null,
      'a cloaked ship gave an order that would have lit her up');
    h.decloak();

    h.fleeing = true;
    assert.equal(chooseTactic(h, g.ship, eng, 'ambush'), null,
      'a ship already running gave a fighting order');
    h.fleeing = false;
    // The control: with neither of those true the same state DOES produce one,
    // so the two nulls above are refusals and not an empty condition.
    assert.ok(chooseTactic(h, g.ship, eng, 'ambush'),
      'the state used for both refusals produces no order anyway');
  });

  test('the orders reach the fight, in every fight', () => {
    // Counted through the log, which is also what the player sees: a buff
    // nobody is told about is difficulty rather than depth.
    for (const them of [['d7'], ['warbird'], ['galor', 'galor'], ['jem_hadar_attack']]) {
      let fights = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const { g, eng } = battle({ them, seed });
        fly(eng, g);
        // TWO things, because either alone passes without the feature.
        //
        // A cooldown having been set is proof an order was actually given.
        // The log line is proof the player was told — and matching it as
        // "the ship's name, then anything" is not enough: `ai.js` already
        // writes "H1 is breaking off." when a hostile runs, so the first
        // version of this test passed with the whole feature deleted. The
        // control caught it; the test did not.
        const gave = eng.hostiles.some((h) => Object.values(h.tacticCooldowns ?? {}).length > 0);
        const told = eng.log.some((l) => eng.hostiles.some(
          (h) => l.text?.startsWith(`${h.name} `) && !/breaking off/.test(l.text)));
        if (gave && told) fights++;
      }
      assert.equal(fights, 4, `${them.join('+')}: orders were given in only ${fights}/4 battles`);
    }
  });

  test('the one order that presses an advantage can be answered', () => {
    // `attack_pattern_alpha` is the only offensive tactic and it fires when
    // the foe is under a third of her hull — a captain finishing somebody off.
    // It is a real increase in danger, and the answer to it is the one the
    // announcement invites: leave.
    //
    // Measured over four matchups, twenty-four seeds each, with the same
    // simple pilot: fighting to the end loses the ship 38 times in 96, and
    // breaking off at 35% hull loses it 3.
    const MATCHUPS = [['warbird'], ['galor', 'galor'], ['d7', 'd7']];
    const run = (breakOffAt) => {
      let destroyed = 0;
      let total = 0;
      for (const them of MATCHUPS) {
        for (let seed = 1; seed <= 6; seed++) {
          const { g, eng } = battle({ them, seed });
          fly(eng, g, { breakOffAt });
          total++;
          if (eng.outcome === 'destroyed') destroyed++;
        }
      }
      return { destroyed, total };
    };
    const stayed = run(null);
    const left = run(0.35);
    assert.ok(stayed.destroyed > 0,
      'nobody died even fighting to the end — this measures nothing');
    assert.ok(left.destroyed < stayed.destroyed,
      `breaking off lost the ship ${left.destroyed}/${left.total} against `
      + `${stayed.destroyed}/${stayed.total} fighting on — disengaging is no answer at all`);
  });

  test('a warp core breach leaves its countdown at zero, not one frame under', () => {
    // Not a tactics test — a tactics test FOUND it. The enemy captains changed
    // which ships died and how, and a freighter that had never been lost to a
    // breach in the tour-of-duty soak was lost to one, at which point the
    // invariant checker reported `ship.breachTimer is -0.0333` on 413
    // consecutive ticks.
    //
    // `update` returns early on a destroyed ship and `destroy` returns early
    // on one already destroyed, so whatever the timer holds on the tick the
    // hull is lost is what it holds for ever — and it held one frame below
    // zero. Every hull ever lost to a breach, for the whole life of the code,
    // and it took a change somewhere else to make one of them get checked.
    const ship = new Ship('freighter', { faction: 'independent', name: 'Test' });
    ship.beginBreach(0.1);
    for (let i = 0; i < 10 && !ship.destroyed; i++) ship.update(1 / 30, null);
    assert.equal(ship.destroyed, true, 'the breach never went off');
    assert.equal(ship.breachTimer, 0,
      `a finished countdown reads ${ship.breachTimer}`);
    // And it stays there: further ticks must not drive it anywhere.
    for (let i = 0; i < 10; i++) ship.update(1 / 30, null);
    assert.equal(ship.breachTimer, 0);
  });

  test('an escort takes the same orders, and not the aggressive ones', () => {
    // Starfleet's doctrine is `balanced`, and the only ships in the game
    // flying it are on the player's side. A ship detached to stand with you is
    // there to stand: it gets the defensive tray and not the kill press.
    assert.ok(DOCTRINE_TACTICS.balanced?.length, 'Starfleet has no tactics');
    assert.equal(DOCTRINE_TACTICS.balanced.includes('attack_pattern_alpha'), false,
      'an escort breaks formation to finish somebody off');
    const { g, eng } = battle();
    const ally = new Ship('miranda', { faction: 'federation', name: 'USS Test' });
    for (const f of Object.keys(ally.shields)) ally.shields[f] = ally.maxShield * 0.1;
    assert.equal(chooseTactic(ally, eng.hostiles[0], eng, 'balanced'), 'emergency_power_shields');
    assert.ok(ally.hasBuff('emergency_power_shields'));
    void g;
  });
});
