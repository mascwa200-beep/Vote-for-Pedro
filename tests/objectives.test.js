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
import { Character } from '../src/rules/character.js';
import { EPISODES } from '../src/missions/episodes/index.js';

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

// ================================ the fights the mission book actually orders

/**
 * The engine had all four objectives and no episode had ever asked for one.
 *
 * Probed before any of this: 16 episode fights, 0 objectives. Every scripted
 * battle in the game was won by emptying the board — including the six whose
 * next stage is already written as though the enemy survived it.
 *
 * These guards are about the SHIPPED EPISODE DATA reaching a real engagement.
 * Asserting `effects.combat.objective === 'disable'` would only re-read the
 * line that was just written; every one of these stages the choice through the
 * game and reads the `Engagement` that comes out the other side.
 */
describe('the objectives the episodes ask for', () => {
  /** Every combat spec in the book, with where it came from. */
  const SPECS = [];
  for (const ep of EPISODES) {
    for (const [sid, stage] of Object.entries(ep.stages ?? {})) {
      for (const c of stage.choices ?? []) {
        if (c.effects?.combat) SPECS.push({ ep, sid, c, spec: c.effects.combat });
      }
    }
  }

  /** Stage one choice for real and hand back the engagement it produced. */
  function order(entry, { seed = 5n } = {}) {
    const g = new Game({
      seed, crewMode: 'original', shipClass: 'constitution', difficulty: 'lieutenant',
      character: new Character({ speciesId: 'human', careerId: 'command' }),
    });
    g.progress.addXP(200000, { ledger: g.ledger });
    const m = g.missions.start(entry.ep.id, g);
    m.stageId = entry.sid;
    const need = m.stageLocation(m.stage);
    if (need) g.locationId = need;
    m.choose(entry.c.id);
    // Both halves, exactly as `state.js` does it: the id has to land on the
    // mission or `finishCombat` will not recognise the fight as this one's.
    const fid = g.orderTheStagesFight(m.pending.combat);
    if (m.pending && fid != null) m.pending.fightId = fid;
    g.update(1 / 30);
    return { g, m, eng: g.engagement };
  }

  test('every objective an episode names is one the engine implements', () => {
    // A name the engine does not know is silently downgraded to `destroy` by
    // the constructor, and the Orders panel is hidden for `destroy` — so a typo
    // produces a working, wrong fight that looks exactly like a correct one.
    assert.ok(SPECS.length >= 16, `only ${SPECS.length} episode fights found`);
    for (const { ep, sid, c, spec } of SPECS) {
      assert.ok(OBJECTIVES[spec.objective ?? 'destroy'],
        `${ep.id}/${sid}/${c.id} asks for "${spec.objective}", which is not an objective`);
    }
  });

  test('the objective an episode asks for is the one the fight is given', () => {
    const named = SPECS.filter((s) => s.spec.objective);
    assert.ok(named.length >= 7,
      `only ${named.length} episode fights name an objective — this suite would prove little`);
    for (const entry of named) {
      const { eng } = order(entry);
      assert.ok(eng, `${entry.ep.id}/${entry.sid}/${entry.c.id} started no fight`);
      assert.equal(eng.objective, entry.spec.objective,
        `${entry.ep.id}/${entry.sid}/${entry.c.id} asked for ${entry.spec.objective}`);
      assert.equal(eng.objectiveTime, entry.spec.objectiveTime ?? 0,
        `${entry.ep.id}/${entry.sid}/${entry.c.id} lost its clock`);
    }
  });

  test('fights that share an aftermath stage share an objective', () => {
    // Derived, not listed. Both roads into `archanis_claim/battle` describe the
    // same crippled D7, and all four into `outpost_silence/battle` the same
    // living commander — so if one of them is a `disable` every one of them is,
    // or the shared prose is true down one road and false down another.
    const groups = new Map();
    for (const { ep, sid, c, spec } of SPECS) {
      if (typeof c.next !== 'string') continue;
      const key = `${ep.id}/${c.next}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ from: `${sid}/${c.id}`, objective: spec.objective ?? 'destroy' });
    }
    const shared = [...groups].filter(([, v]) => v.length > 1);
    assert.ok(shared.length >= 2, 'no aftermath stage is shared, so this proves nothing');
    for (const [key, arms] of shared) {
      const kinds = new Set(arms.map((a) => a.objective));
      assert.equal(kinds.size, 1,
        `${key} is reached by ${arms.map((a) => `${a.from} (${a.objective})`).join(' and ')}`);
    }
  });

  test('a disable fight ends with the hostile alive, on the shipped spec', () => {
    const entries = SPECS.filter((s) => s.spec.objective === 'disable');
    assert.ok(entries.length >= 6, `only ${entries.length} disable fights`);
    for (const entry of entries) {
      const { eng } = order(entry);
      for (const h of eng.hostiles) disarm(h);
      eng.update(1 / 30);
      assert.equal(eng.over, true,
        `${entry.ep.id}/${entry.sid}/${entry.c.id}: every gun is out and the fight went on`);
      assert.equal(eng.hostiles.every((h) => !h.destroyed), true,
        `${entry.ep.id}/${entry.sid}/${entry.c.id}: won by killing, which is not disabling`);
    }
  });

  test('the convoy is on the board, and is what the objective is about', () => {
    const entry = SPECS.find((s) => s.spec.objective === 'protect');
    assert.ok(entry, 'no episode asks for a protect objective');
    const { eng } = order(entry);
    assert.equal(eng.protectees.length, entry.spec.escort.length,
      'the escort the episode staged is not the escort the objective is about');
    assert.ok(eng.protectees.length > 0, 'an empty escort makes protect a no-op that always passes');
    for (const s of eng.protectees) assert.ok(eng.allies.includes(s), 'the escort is not in the fight');
  });

  test('a ship that joins later does not make the objective unfailable', () => {
    // The trap this whole `protectees` split exists for. A reputation perk's
    // escort and the relief ship `callForHelp` pushes in mid-fight both land in
    // `eng.allies`, and `settle` fails a protect objective only when EVERY ship
    // in the list it reads is dead. Reading `allies`, a captain who had bought
    // an escort could watch the convoy burn and never lose the objective.
    const entry = SPECS.find((s) => s.spec.objective === 'protect');
    const { eng } = order(entry);
    eng.allies.push(new Ship('miranda', { faction: 'federation', name: 'USS Late' }));
    for (const s of eng.protectees) s.destroyed = true;
    eng.update(1 / 30);
    assert.equal(eng.over, true, 'the convoy is gone and the fight went on');
    assert.equal(eng.outcome, 'failed');
  });

  test('losing the convoy is not the same as breaking off', () => {
    const entry = SPECS.find((s) => s.spec.objective === 'protect');

    const a = order(entry);
    for (const s of a.eng.protectees) s.destroyed = true;
    a.g.update(1 / 30);

    const b = order(entry);
    b.eng.end('escaped');
    b.g.update(1 / 30);

    assert.equal(a.eng.outcome, 'failed');
    assert.equal(b.eng.outcome, 'escaped');
    assert.equal(a.m.complete, true, 'the convoy was lost and the episode carried on regardless');
    assert.equal(a.m.outcome, entry.spec.failedOutcome);
    assert.notEqual(a.m.outcome, b.m.outcome,
      'losing the escort and walking away end the episode the same way');
  });

  test('every fight whose aftermath describes a survivor is not a destroy fight', () => {
    // The relation the whole change is for, derived from the prose rather than
    // from a list of episode ids. If the stage a fight lands on says the enemy
    // is crippled, venting, still alive or intact, then a fight that can only
    // be won by emptying the board is telling the player something untrue.
    const SURVIVED = /crippled|drifting|venting|dead in space|still alive|is intact|survivors/i;
    const wrong = [];
    for (const { ep, sid, c, spec } of SPECS) {
      if (typeof c.next !== 'string') continue;
      const after = ep.stages?.[c.next];
      if (!after?.text || !SURVIVED.test(after.text)) continue;
      if ((spec.objective ?? 'destroy') === 'destroy') {
        wrong.push(`${ep.id}/${sid}/${c.id} -> ${c.next}`);
      }
    }
    assert.deepEqual(wrong, [],
      'these fights can only be won by killing, and land on a stage that says otherwise');
  });
});
