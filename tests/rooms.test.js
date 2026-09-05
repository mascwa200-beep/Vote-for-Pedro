// Seventeen rooms, and every scene on the bridge.
//
// `stage.where` names the compartment a scene happens in — `'bridge'` by
// default, `'anywhere'`, `'surface'`, or any `ROOMS` key. The ship has
// seventeen walkable rooms with stations, props and a walk system, and across
// sixteen episodes and seventy-two stages **no stage had ever set one**.
//
// So the survivor of Wolf 359 woke up in a stage whose speaker is literally
// 'Sickbay', whose text reads "nobody in the room wants to answer" — and the
// captain was on the bridge for it.
//
// And the room was not enforced anywhere except by declining to DRAW the
// choices. `mission_choice` takes a choice by index out of `mission.choices()`
// and checks only whether it is locked, so a captain on the bridge could say
// "option two" and advance a scene in sickbay. Measured before any stage set a
// `where` at all:
//
//     the captain is standing in : bridge
//     the scene is happening in  : sickbay
//     choices the engine offers  : accept, question
//     gave the order anyway      : start -> trials

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { EPISODES, EPISODE_BY_ID } from '../src/missions/episodes/index.js';
import { ROOMS } from '../src/world/interiors.data.js';

const game = (seed = 4n) => new Game({ seed, crewMode: 'original' });

/** Walk the captain, and let them arrive. */
function walkTo(g, roomId) {
  const r = g.goToRoom(roomId);
  for (let n = 0; n < 4000 && g.walkOrder; n++) g.update(1 / 30);
  return r;
}

describe('a scene happens in a room, and the room is enforced', () => {
  test('an order given from the wrong compartment does not land', () => {
    // Through the engine's own door, which is what `mission_choice` uses.
    const g = game();
    const m = g.missions.start('shakedown', g);
    g.locationId = 'sol';
    // On a COPY. `Mission.stage` hands back the shipped definition object, so a
    // test that writes to it changes the episode for every test after it — and
    // the first draft of this file did exactly that, then failed three tests
    // down claiming the tutorial sends a new captain to the planet surface.
    m.def = { ...m.def, stages: { ...m.def.stages, start: { ...m.def.stages.start, where: 'sickbay' } } };

    assert.equal(g.walk.roomId, 'bridge');
    assert.equal(m.choices().filter((c) => !c.locked).length, 0,
      'the engine offered a scene happening two decks down');
    const before = m.stageId;
    g.chooseMission(m.stage.choices[0].id);
    assert.equal(m.stageId, before, 'the order landed from the wrong room');

    // And the lock says where to go, rather than "not available".
    const why = m.choices()[0].lockReason;
    assert.match(why, /Sickbay/, why);
  });

  test('and lands once the captain is standing there', () => {
    const g = game();
    const m = g.missions.start('shakedown', g);
    g.locationId = 'sol';
    m.def = { ...m.def, stages: { ...m.def.stages, start: { ...m.def.stages.start, where: 'sickbay' } } };
    walkTo(g, 'sickbay');
    assert.equal(g.walk.roomId, 'sickbay');
    const before = m.stageId;
    g.chooseMission(m.choices().find((c) => !c.locked).id);
    assert.notEqual(m.stageId, before, 'the scene would not advance from its own room');
  });

  test('the star system is still checked first', () => {
    // Two gates, and they must not shadow each other: a captain in the right
    // room of a ship in the wrong system should be told about the system.
    const g = game();
    const m = g.missions.start('shakedown', g);
    g.locationId = 'vulcan';
    m.stageId = 'trials';              // happens at Alpha Centauri
    const why = m.choices()[0].lockReason;
    assert.match(why, /Alpha Centauri|would have to be at/i, why);
  });

  test('“anywhere” is anywhere, including ashore', () => {
    const g = game();
    const m = g.missions.start('shakedown', g);
    g.locationId = 'sol';
    m.def = { ...m.def, stages: { ...m.def.stages, start: { ...m.def.stages.start, where: 'anywhere' } } };
    for (const room of ['bridge', 'engineering', 'cargo']) {
      walkTo(g, room);
      assert.equal(m.testWhere().ok, true, `"anywhere" refused ${room}`);
    }
  });

  test('a scene on the surface needs the captain on the surface', () => {
    const g = game();
    const m = g.missions.start('shakedown', g);
    g.locationId = 'sol';
    m.def = { ...m.def, stages: { ...m.def.stages, start: { ...m.def.stages.start, where: 'surface' } } };
    assert.equal(m.testWhere().ok, false, 'a surface scene played from the bridge');
    assert.match(m.testWhere().reason, /surface/i);
  });

  test('and a harness with no interior at all is not in the wrong room', () => {
    // The same reasoning `testLocation` uses for a game with no location: a
    // half-built state is nowhere, not somewhere else, and refusing every
    // choice there would strand a caller that never asked to be gated.
    const g = game();
    const m = g.missions.start('shakedown', g);
    const walk = g.walk;
    g.walk = null;
    assert.equal(m.testWhere({ where: 'sickbay' }).ok, true);
    g.walk = walk;
  });
});

describe('the scenes that ask you to get up', () => {
  // Only where being in the room IS the point, and each one where the episode
  // had already said so in its own speaker line.
  //
  // Every placed stage is listed, with the speaker that justifies it, so the
  // REASON for each placement is in the test rather than in somebody's memory.
  // Ten of a hundred and nineteen stages; it was two of seventy-two when this
  // file was written.
  const PLACED = [
    { ep: 'wolf359_salvage', stage: 'revived', where: 'sickbay', speaker: 'Sickbay' },
    { ep: 'tholian_border', stage: 'lock', where: 'transporter', speaker: 'Transporter Room' },
    { ep: 'qonos_council', stage: 'blade', where: 'armoury', speaker: 'Armoury' },
    { ep: 'cardassia_debt', stage: 'briefing', where: 'briefing', speaker: 'Briefing room' },
    { ep: 'utopia_certification', stage: 'trials', where: 'engineering', speaker: 'Engineering' },
    { ep: 'vega_line', stage: 'hearing', where: 'briefing', speaker: 'Drafting committee' },
    { ep: 'khitomer_accord', stage: 'brig', where: 'brig', speaker: 'The prisoner' },
    // The two that were added with this table. Both are the same interrogation
    // continuing in the same cell, and both were 'anywhere' — so a captain
    // could walk back up to the bridge halfway through and finish it there.
    { ep: 'khitomer_accord', stage: 'stonewalled', where: 'brig', speaker: 'The prisoner' },
    { ep: 'khitomer_accord', stage: 'bargained', where: 'brig', speaker: 'The prisoner' },
    // Its speaker has been 'Engineering' since it was written, and the scene is
    // a chief engineer standing at a core he does not want to run that hard.
    { ep: 'devron_anomaly', stage: 'inside', where: 'engineering', speaker: 'Engineering' },
  ];

  test('each is in the room its own speaker names', () => {
    for (const p of PLACED) {
      const stage = EPISODE_BY_ID[p.ep].stages[p.stage];
      assert.ok(stage, `${p.ep}/${p.stage} does not exist`);
      assert.equal(stage.where, p.where, `${p.ep}/${p.stage}`);
      assert.equal(stage.speaker, p.speaker);
      assert.ok(ROOMS[p.where], `${p.where} is not a compartment of this ship`);
    }
  });

  test('and the table is the whole of them, not a sample', () => {
    // Otherwise the justifications above drift out of date silently: a stage
    // placed without a line here would be placed for no recorded reason.
    const actual = [];
    for (const ep of EPISODES) {
      for (const [sid, stage] of Object.entries(ep.stages ?? {})) {
        const w = stage.where;
        if (w && w !== 'anywhere' && w !== 'surface') actual.push(`${ep.id}/${sid}`);
      }
    }
    assert.deepEqual(
      actual.sort(),
      PLACED.map((p) => `${p.ep}/${p.stage}`).sort(),
      'a stage names a compartment and PLACED does not say why',
    );
  });

  test('and the captain can walk to every room a stage names', () => {
    // A stage in a compartment nobody can reach is a stranded episode. Walked,
    // not looked up — `findRoom` succeeding is not the same as arriving.
    const named = new Set();
    for (const ep of EPISODES) {
      for (const stage of Object.values(ep.stages ?? {})) {
        const w = stage.where;
        if (w && w !== 'anywhere' && w !== 'surface') named.add(w);
      }
    }
    // A ratchet, in the shape of the "less forgetful" one in echoes.test.js: it
    // only moves one way. Two rooms of seventeen when this file was written,
    // six now. The number that answers "how many rooms can you actually do
    // something in" is this one, and it is the point of the exercise.
    assert.ok(named.size >= 6, `only ${named.size} rooms are used by any episode`);
    for (const room of named) {
      const g = game();
      walkTo(g, room);
      assert.equal(g.walk.roomId, room, `the captain could not reach ${room}`);
    }
  });

  test('the first episode does not ask a new captain to find a turbolift', () => {
    // `shakedown` is the tutorial and its report stage is the fifth screen in
    // the game. Its speaker is 'Ready Room' and it is deliberately NOT in the
    // captain's quarters: the room gate is enforced now, so that would make
    // "walk to a compartment" something a new captain has to work out before
    // they can finish the first episode.
    for (const stage of Object.values(EPISODE_BY_ID.shakedown.stages)) {
      assert.ok(!stage.where || stage.where === 'anywhere',
        `the tutorial sends the captain to ${stage.where}`);
    }
  });

  // Episodes that do not happen aboard this ship. A Great Hall on Qo'noS, a
  // Senate chamber, a yard at Mars, a board of review at Earth.
  //
  // Some of them DO have a scene aboard — the armoury before the challenge, the
  // briefing room the night before a Cardassian tribunal, the cell at Khitomer
  // — so the rule is not "all anywhere". It is that every stage says where it
  // is, because the one thing none of them is, is the bridge of your own ship.
  const OFF_SHIP = [
    'court_martial', 'homecoming', 'qonos_council', 'romulus_debt',
    'cardassia_debt', 'khitomer_accord', 'utopia_certification',
    'vulcan_long_peace', 'vega_line',
  ];

  /** Stages of an episode that would fall through to the default, 'bridge'. */
  const defaulting = (id) => Object.entries(EPISODE_BY_ID[id].stages)
    .filter(([, s]) => !s.where).map(([sid]) => `${id}/${sid}`);

  test('a hearing at a starbase is not held on your own bridge', () => {
    // This named `court_martial` alone, and `homecoming` — the last four
    // stages of the campaign, a board of review at Earth with a casualty list
    // on the table and nobody offering you a chair — was held on your bridge
    // for exactly as long as this test named one episode instead of the rule.
    const bad = OFF_SHIP.flatMap(defaulting);
    assert.deepEqual(bad, [], 'held on the bridge of the ship it is not aboard');
  });

  test('and that check can see a stage that forgot to say', () => {
    // The positive control. `deepEqual([], [])` passes just as happily when
    // `where` is not read at all, so prove the instrument reacts: strip the
    // key off a copy of the stage that was actually wrong and check it lands.
    const real = EPISODE_BY_ID.homecoming.stages.start;
    assert.equal(real.where, 'anywhere', 'the fix this test exists for is gone');
    const { where, ...stripped } = real;
    assert.equal(where, 'anywhere');
    assert.equal(!stripped.where, true, 'a stage with no `where` was not seen as one');
  });

  test('and an episode aboard your own ship is NOT required to say so', () => {
    // The other control, and the reason OFF_SHIP is a list rather than a
    // sweep. 'bridge' is the default because most scenes are on the bridge,
    // and a rule of "every stage must declare" would be a rule about
    // punctuation rather than about where anything happens.
    assert.ok(defaulting('vega_raid').length > 0,
      'every stage aboard now declares a room, so this control proves nothing');
  });
});

describe('the panel and the engine give one answer', () => {
  test('every room an episode names is a real compartment', () => {
    for (const ep of EPISODES) {
      for (const [sid, stage] of Object.entries(ep.stages ?? {})) {
        const w = stage.where;
        if (!w || w === 'anywhere' || w === 'surface') continue;
        assert.ok(ROOMS[w], `${ep.id}/${sid} happens in "${w}", which is not aboard`);
      }
    }
  });

  test('and no stage confuses a compartment with a star system', () => {
    // The trap `stageLocation`'s comment already warns about, now that both
    // keys are in use on shipped stages.
    for (const ep of EPISODES) {
      for (const [sid, stage] of Object.entries(ep.stages ?? {})) {
        if (stage.where) {
          assert.ok(!ROOMS[stage.system ?? ''],
            `${ep.id}/${sid} names a compartment in \`system\``);
        }
        if (Object.prototype.hasOwnProperty.call(stage, 'system') && stage.system) {
          assert.ok(!ROOMS[stage.system], `${ep.id}/${sid}: system "${stage.system}" is a room`);
        }
      }
    }
  });
});
