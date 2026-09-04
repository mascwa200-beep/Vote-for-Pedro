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
  const PLACED = [
    { ep: 'wolf359_salvage', stage: 'revived', where: 'sickbay', speaker: 'Sickbay' },
    { ep: 'tholian_border', stage: 'lock', where: 'transporter', speaker: 'Transporter Room' },
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
    assert.ok(named.size >= 2, `only ${named.size} rooms are used by any episode`);
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

  test('a hearing at a starbase is not held on your own bridge', () => {
    // The other direction. The default is 'bridge' and it is enforced now, so
    // a scene that is not aboard this ship has to say so — the Board of
    // Inquiry sits in conference room four, Starbase 11.
    for (const [sid, stage] of Object.entries(EPISODE_BY_ID.court_martial.stages)) {
      assert.equal(stage.where, 'anywhere', `court_martial/${sid} is held on the bridge`);
    }
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
