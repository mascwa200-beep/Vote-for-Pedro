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
import { readFileSync } from 'node:fs';

import { Game } from '../src/core/state.js';
import { roomMeshes } from '../src/gfx/room.js';
import { Walker } from '../src/sim/walk.js';
import { EPISODES, EPISODE_BY_ID } from '../src/missions/episodes/index.js';
import { ROOMS, ROOM_LIST } from '../src/world/interiors.data.js';

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
    // The other end of the same revival. It is the same room and the same
    // table, and the captain has to be standing at it either way — a failure
    // the player watches from the bridge is a line of text, and this one is
    // somebody dying in front of them.
    { ep: 'wolf359_salvage', stage: 'lost_her', where: 'sickbay', speaker: 'Sickbay' },
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

    // `long_watch` — the episode that happens aboard. Eight of its ten stages
    // name a compartment, and five of those compartments had never hosted a
    // scene in the whole book. It is the reason the room count moved.
    { ep: 'long_watch', stage: 'the_draw', where: 'engineering', speaker: 'Chief engineer' },
    { ep: 'long_watch', stage: 'dark_room', where: 'auxcontrol', speaker: 'Auxiliary control' },
    { ep: 'long_watch', stage: 'manifest', where: 'cargo', speaker: 'Cargo manifest' },
    { ep: 'long_watch', stage: 'the_bunk', where: 'crewquarters', speaker: 'Crew quarters' },
    { ep: 'long_watch', stage: 'the_deck', where: 'rec', speaker: 'Recreation deck' },
    // Being told nothing, in the room where you asked. The scene is a rec deck
    // full of people declining to give up a shipmate, and it only works if the
    // captain is standing in front of them when they do it.
    { ep: 'long_watch', stage: 'closed_ranks', where: 'rec', speaker: 'Recreation deck' },
    { ep: 'long_watch', stage: 'middle_watch', where: 'auxcontrol', speaker: 'Petty Officer Ile Marchetti' },
    { ep: 'long_watch', stage: 'the_cell', where: 'brig', speaker: 'Petty Officer Ile Marchetti' },
    { ep: 'long_watch', stage: 'the_write_up', where: 'quarters', speaker: "Captain's quarters" },
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

// ================= the fields every prop declares, and nobody was reading

describe('a prop is drawn the way it says it is', () => {
  /** The wallpanel quads: glow geometry in the band the panel occupies. */
  const panelExtent = (roomId) => {
    const m = roomMeshes(roomId).glow;
    const f = m.stride / 4;
    let minX = Infinity; let maxX = -Infinity;
    let minZ = Infinity; let maxZ = -Infinity; let n = 0;
    for (let i = 0; i < m.vertexCount; i++) {
      const o = i * f;
      const y = m.data[o + 1];
      // The panel's own two heights, exactly. A band catches whatever else the
      // room has glowing at chest height — the brig has three other pieces of
      // it — and an extent taken over those measures the room, not the panel.
      // Float32 in the buffer, so this compares with a tolerance rather than
      // for equality.
      if (Math.abs(y - 1.1) > 1e-3 && Math.abs(y - 1.7) > 1e-3) continue;
      n++;
      minX = Math.min(minX, m.data[o]); maxX = Math.max(maxX, m.data[o]);
      minZ = Math.min(minZ, m.data[o + 2]); maxZ = Math.max(maxZ, m.data[o + 2]);
    }
    return { n, minX, maxX, minZ, maxZ };
  };

  test('a wall panel is inside the room it is mounted in', () => {
    // `case 'wallpanel'` drew a quad spanning z-0.4 to z+0.4 at a fixed x — a
    // panel on an east or west wall — with the axis hardcoded. The brig's three
    // detention fields are on its aft bulkhead, so each spanned z from 2.0 to
    // 2.8 in a room whose wall is at 2.6: half of every field was outside the
    // room, inside the bulkhead.
    for (const room of ROOM_LIST) {
      const panels = (room.props ?? []).filter((p) => p.kind === 'wallpanel');
      if (!panels.length) continue;
      const hw = room.shape.width / 2;
      const hd = room.shape.depth / 2;
      const e = panelExtent(room.id);
      assert.ok(e.n > 0, `${room.id}: no panel geometry at all`);
      assert.ok(e.maxX <= hw + 1e-4 && e.minX >= -hw - 1e-4,
        `${room.id}: a wall panel reaches x ${e.minX.toFixed(2)}..${e.maxX.toFixed(2)} in a room ${hw * 2} across`);
      assert.ok(e.maxZ <= hd + 1e-4 && e.minZ >= -hd - 1e-4,
        `${room.id}: a wall panel reaches z ${e.minZ.toFixed(2)}..${e.maxZ.toFixed(2)} in a room ${hd * 2} deep`);
    }
  });

  test('and it is turned by the facing its own entry declares', () => {
    // The data was right the whole time: the corridors declare -PI/2 and the
    // brig declares 0, and the builder never asked. Tested on the OUTCOME
    // rather than by calling the builder — the brig's panels are on its aft
    // bulkhead, so with the facing read they run across the room in x and sit
    // at one z; with it ignored they run in z and punch through the wall.
    const brig = ROOMS.brig;
    const panels = (brig.props ?? []).filter((p) => p.kind === 'wallpanel');
    assert.equal(panels.length, 3, 'the detention fields are gone');
    const e = panelExtent('brig');
    assert.ok(e.maxX - e.minX > 2.5,
      `the detention fields do not run along the bulkhead: x spans ${(e.maxX - e.minX).toFixed(2)}`);
    assert.ok(e.maxZ - e.minZ < 0.9,
      `the detention fields still run into the bulkhead: z spans ${(e.maxZ - e.minZ).toFixed(2)}`);
    // And they are proud of the wall, on the room side of it.
    assert.ok(e.maxZ < brig.shape.depth / 2,
      `a detention field is flush with or through the bulkhead at z ${e.maxZ}`);
  });

  test('and the corridors did not move', () => {
    // They were already right — on east walls, with the facing that matches the
    // orientation the old code hardcoded. A change that fixes the brig by
    // turning everything ninety degrees would break these instead.
    const e = panelExtent('corridor_a');
    assert.ok(Math.abs(e.minX - 1.13) < 1e-4 && Math.abs(e.maxX - 1.13) < 1e-4,
      `corridor_a's panel left the wall: x ${e.minX}..${e.maxX}`);
    assert.ok(Math.abs(e.minZ - 2.6) < 1e-4 && Math.abs(e.maxZ - 3.4) < 1e-4,
      `corridor_a's panel changed span: z ${e.minZ}..${e.maxZ}`);
  });
});

describe('and told to the captain standing in front of it', () => {
  test('every labelled prop can be named from where it stands', () => {
    // Forty-three props, every one of them carrying a label, and nothing had
    // ever read one. A station or an exit still answers FIRST — the crosshair
    // must agree with the button under it — so a prop inside a console's reach
    // is legitimately named by the console.
    const missed = [];
    for (const room of ROOM_LIST) {
      for (const p of room.props ?? []) {
        if (!p.label) continue;
        const w = new Walker({ roomId: room.id, x: p.at[0], z: p.at[1] });
        w.step({}, 1 / 30);
        if (w.naming === p) continue;
        // Allowed only when something operable is in reach and answers first.
        if (w.atStation || w.atExit) continue;
        missed.push(`${room.id}/${p.kind} "${p.label}"`);
      }
    }
    assert.deepEqual(missed, [], 'a prop with a name nobody can be told');
  });

  test('and the crosshair is the thing that reads it', () => {
    // The accessor existing is not the accessor being used. `firstperson.js` is
    // DOM-bound and cannot be imported here, so this reads it as text the way
    // the rest of the suite does — without this, the whole naming path could be
    // unwired from the reticle and every other check here would still pass.
    const fp = readFileSync(new URL('../src/ui/firstperson.js', import.meta.url), 'utf8');
    const at = fp.indexOf('drawReticle');
    const body = at > 0 ? fp.slice(at, at + 2600) : fp;
    assert.ok(/walker\.naming/.test(body), 'the reticle does not ask what it is looking at');
  });

  test('but naming a thing never makes it operable', () => {
    // `looking` drives `useWhatIsInFront` and the Use button. A bunk is not a
    // console, and offering "Use a cell bunk" is the shape of the vent that
    // read "Open this console" until it was caught.
    for (const room of ROOM_LIST) {
      for (const p of room.props ?? []) {
        const w = new Walker({ roomId: room.id, x: p.at[0], z: p.at[1] });
        w.step({}, 1 / 30);
        assert.ok(!(room.props ?? []).includes(w.looking),
          `${room.id}: ${p.label ?? p.kind} is offered as something to use`);
      }
    }
  });
});
