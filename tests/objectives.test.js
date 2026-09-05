// Every battle in the game was won by emptying the board.
//
// `Engagement.objective` has been declared since the class was written, named
// in the constructor's own JSDoc, and read by NOTHING. So there was no way to
// express "cripple her, do not kill her" or "whatever else happens, the
// freighter lives" — the mission book has wanted both for a long time and had
// to settle for saying so in prose while the fight underneath resolved the only
// way it could.
//
// Two of the four are only possible because of what landed first:
//
//     disable   needs per-mount knockout, so that "no working guns" is a state
//               a hostile can be PUT INTO short of killing it
//     protect   needs hull archetypes that differ, so that some hostiles
//               genuinely go for the escortee instead of all going for you
//
// And `failed` is the first outcome in this game that is neither a win nor a
// loss. `state.js` computes `won = victory || routed` and `lost = destroyed`;
// a captain who came through the fight and lost the ship they were escorting is
// neither, and there was previously no way to say it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';
import { OUTCOMES, OBJECTIVES, disarmed } from '../src/sim/combat.js';

/**
 * Knock every gun off a hull, properly.
 *
 * Setting `enabled = false` alone does NOT work and the first draft of this
 * file did exactly that: integrity stays at 1, so the ship's own repair pass
 * re-enables the bank on the very next tick — which is the passive repair
 * behaving correctly, and a good demonstration that `enabled` is derived state
 * rather than the authoritative one.
 */
function disarm(ship) {
  for (const w of ship.weapons) ship.damageMount(w, 1);
  // The last-gun guard spares one mount on any hull, so the array-wide gate is
  // what finishes the job — which is exactly the division of labour the guard
  // was written around.
  ship.subsystems.weapons = 0;
  return ship;
}

/** A fight with an objective on it. */
function staged(objective, { me = 'constitution', them = ['d7'], allies = [], ...rest } = {}) {
  const g = new Game({ seed: 4n, crewMode: 'original', shipClass: me });
  const foes = them.map((c, i) => new Ship(c, { faction: 'klingon', name: `K${i}` }));
  const escort = allies.map((c, i) => new Ship(c, { faction: 'federation', name: `E${i}` }));
  const eng = g.startCombat(foes, { objective, allies: escort, relentless: true, ...rest });
  return { g, eng, foes, escort };
}

describe('a fight can be for something other than killing everyone', () => {
  test('the four objectives exist and each says what it wants', () => {
    assert.deepEqual(Object.keys(OBJECTIVES).sort(),
      ['destroy', 'disable', 'protect', 'survive']);
    for (const [id, o] of Object.entries(OBJECTIVES)) {
      assert.ok(o.label && o.line, `${id} has no words on it`);
    }
  });

  test('and an unknown one falls back to destroying them', () => {
    // A save or an episode naming an objective this build does not have must
    // not produce a fight with no win condition at all.
    const { eng } = staged('annihilate_everything');
    assert.equal(eng.objective, 'destroy');
  });

  test('and `failed` is a real outcome that is neither won nor lost', () => {
    assert.ok(OUTCOMES.includes('failed'));
    // The reckoning everything downstream uses. `failed` must satisfy neither.
    const won = (o) => o === 'victory' || o === 'routed';
    const lost = (o) => o === 'destroyed';
    assert.equal(won('failed'), false);
    assert.equal(lost('failed'), false);
  });
});

describe('disable: cripple her, do not kill her', () => {
  test('a hostile with every gun out counts as disarmed', () => {
    const foe = new Ship('d7', { faction: 'klingon', name: 'K' });
    assert.equal(disarmed(foe), false, 'a healthy D7 is already disarmed, so this proves nothing');
    disarm(foe);
    assert.equal(disarmed(foe), true);
  });

  test('and so does one that is destroyed, or has gone to warp', () => {
    const dead = new Ship('d7', { faction: 'klingon', name: 'K' });
    dead.destroyed = true;
    assert.equal(disarmed(dead), true);
    const gone = new Ship('d7', { faction: 'klingon', name: 'K' });
    gone.withdrawn = true;
    assert.equal(disarmed(gone), true);
  });

  test('and the fight is won the moment the last gun goes out', () => {
    const { eng, foes } = staged('disable');
    assert.equal(eng.over, false);
    disarm(foes[0]);
    eng.update(1 / 30);
    assert.equal(eng.over, true, 'every hostile is disarmed and the fight went on');
    assert.equal(eng.outcome, 'victory');
    assert.equal(foes[0].destroyed, false, 'the hostile was destroyed, which is not disabling it');
  });

  test('and the same board does NOT end a destroy fight', () => {
    // The control. If this ended too, the objective is not what ended the one
    // above — the fight simply stopped for some other reason.
    const { eng, foes } = staged('destroy');
    disarm(foes[0]);
    eng.update(1 / 30);
    assert.equal(eng.over, false,
      'a destroy fight ended when the hostile was merely disarmed');
  });
});

describe('protect: whatever else happens, they live', () => {
  test('losing the escort loses the fight, with every hostile still alive', () => {
    const { eng, escort, foes } = staged('protect', { allies: ['transport'] });
    assert.equal(escort.length, 1, 'no escort was staged, so this proves nothing');
    assert.equal(eng.over, false);
    escort[0].destroyed = true;
    eng.update(1 / 30);
    assert.equal(eng.over, true, 'the escort died and the fight carried on');
    assert.equal(eng.outcome, 'failed');
    assert.ok(foes.some((f) => !f.destroyed), 'the hostiles were dead anyway');
  });

  test('and it is not a defeat: the ship is not lost', () => {
    const { g, eng, escort } = staged('protect', { allies: ['transport'] });
    escort[0].destroyed = true;
    eng.update(1 / 30);
    assert.equal(eng.outcome, 'failed');
    assert.equal(g.ship.destroyed, false);
    // And nothing credited it as a win.
    assert.equal(eng.outcome === 'victory' || eng.outcome === 'routed', false);
  });

  test('and the same death does NOT end a destroy fight', () => {
    const { eng, escort } = staged('destroy', { allies: ['transport'] });
    escort[0].destroyed = true;
    eng.update(1 / 30);
    assert.equal(eng.over, false, 'an escort died in an ordinary fight and ended it');
  });

  test('and an escort that survives leaves the fight to be won normally', () => {
    const { eng, foes } = staged('protect', { allies: ['transport'] });
    for (const f of foes) f.destroyed = true;
    eng.update(1 / 30);
    assert.equal(eng.outcome, 'victory');
  });
});

describe('survive: hold on, help is coming', () => {
  test('lasting the time wins it, with the hostiles untouched', () => {
    const { eng, foes } = staged('survive', { objectiveTime: 3 });
    let t = 0;
    while (!eng.over && t < 10) { eng.update(1 / 30); t += 1 / 30; }
    assert.equal(eng.outcome, 'victory');
    assert.ok(t >= 3, `it ended after ${t.toFixed(1)}s, before the three it had to last`);
    assert.ok(foes.some((f) => !f.destroyed), 'it was won by killing them after all');
  });

  test('and with no time set it behaves like any other fight', () => {
    // `objectiveTime` defaults to zero, which is what keeps the check inert
    // for the three objectives that do not use it.
    const { eng } = staged('survive');
    assert.equal(eng.objectiveTime, 0);
    let t = 0;
    while (!eng.over && t < 5) { eng.update(1 / 30); t += 1 / 30; }
    assert.equal(eng.over, false, 'a survive fight with no clock ended on its own');
  });
});

describe('and a mission can ask for one', () => {
  test('the objective survives the queue between a stage and the fight', () => {
    // `pendingCombat` is plain data because it has to survive a save, so the
    // objective travels as data too rather than as a live Engagement.
    const g = new Game({ seed: 8n, crewMode: 'original', shipClass: 'constitution' });
    // `orderTheStagesFight` is the real name. A first draft called
    // `queueMissionCombat?.()`, which does not exist, and the optional chain
    // swallowed it — caught only because the assertion below states its own
    // denominator instead of trusting the call.
    const id = g.orderTheStagesFight({
      faction: 'klingon', ships: ['d7'], objective: 'disable',
    });
    assert.ok(g.pendingCombat, 'no fight was queued, so this proves nothing');
    assert.equal(g.pendingCombat.objective, 'disable');
    assert.ok(id != null);
  });
});
