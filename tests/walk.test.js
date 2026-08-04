// Walking the ship, tested without a screen.
//
// The whole reason `sim/walk.js` and `world/interiors.data.js` have no
// rendering in them is this file. "You cannot walk through a wall", "every room
// is reachable from every other" and "the doors go somewhere that exists" are
// properties, not things to check by wandering around with a controller — and
// the last one in particular is the sort of thing that breaks silently when
// somebody renames a room.
//
// What is NOT asserted here is that any of it looks good. That is a screenshot.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  Walker, resolve, confine, route, connectivity, findRoom, stepToward,
  WALKER_RADIUS, WALK_SPEED, RUN_SPEED, REACH,
} from '../src/sim/walk.js';
import { ROOMS, ROOM_LIST, START_ROOM, DECKS } from '../src/world/interiors.data.js';
import { findPlace } from '../src/lang/gazetteer.js';
import { normalize } from '../src/lang/normalize.js';

import { Game } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';
import { parseOrder } from '../src/ui/orders.js';

/** Is this point inside the room's walls, allowing for the walker's width? */
function insideWalls(room, x, z, slack = 1e-6) {
  if (room.shape.kind === 'ring') {
    return Math.hypot(x, z) <= room.shape.radius - WALKER_RADIUS + slack;
  }
  return Math.abs(x) <= room.shape.width / 2 - WALKER_RADIUS + slack
    && Math.abs(z) <= room.shape.depth / 2 - WALKER_RADIUS + slack;
}

describe('the ship is a coherent place', () => {
  test('every door leads to a room that exists', () => {
    const broken = [];
    for (const room of ROOM_LIST) {
      for (const e of room.exits ?? []) {
        if (!ROOMS[e.to]) broken.push(`${room.id} has a door to "${e.to}"`);
      }
    }
    assert.deepEqual(broken, []);
  });

  test('every door is in the wall it is supposed to be in', () => {
    // A doorway placed inside the room rather than on its edge is a hole in
    // mid-air: you walk to it, get confined by a wall that is somewhere else,
    // and the room becomes a prison with a visible exit.
    const misplaced = [];
    for (const room of ROOM_LIST) {
      if (room.lift) continue;   // the lift's doors are generated, all at one spot
      for (const e of room.exits ?? []) {
        const [x, z] = e.at;
        const onEdge = room.shape.kind === 'ring'
          ? Math.abs(Math.hypot(x, z) - room.shape.radius) < 0.6
          : Math.abs(Math.abs(x) - room.shape.width / 2) < 0.6
            || Math.abs(Math.abs(z) - room.shape.depth / 2) < 0.6;
        if (!onEdge) misplaced.push(`${room.id} -> ${e.to} at [${x}, ${z}]`);
      }
    }
    assert.deepEqual(misplaced, []);
  });

  test('every room is reachable from every other', () => {
    // A ship with an unreachable deck is a bug that only shows up when
    // somebody tries to go there, which on a five-year commission could be
    // months in.
    assert.deepEqual(connectivity(), []);
  });

  test('the lift stops exactly where a room has a lift door', () => {
    // The stop list is the RECIPROCAL of the rooms with a lift door, generated
    // rather than typed. Two failures it rules out: a room with a lift door the
    // lift does not serve (you can get in and not out), and a lift that opens
    // straight into sickbay, which would make the corridor outside it pointless
    // and the ship a menu with walls painted on.
    const stops = new Set(ROOMS.turbolift.exits.map((e) => e.to));
    for (const room of ROOM_LIST) {
      if (room.lift) continue;
      const hasDoor = (room.exits ?? []).some((e) => e.to === 'turbolift');
      assert.equal(stops.has(room.id), hasDoor,
        hasDoor ? `${room.id} has a lift door the lift does not serve`
          : `the lift opens into ${room.id}, which has no lift door`);
    }
    // And the rooms off a corridor are genuinely off a corridor.
    assert.ok(!stops.has('sickbay'), 'the lift opens straight into sickbay');
    assert.ok(!stops.has('quarters'), 'the lift opens straight into the quarters');
  });

  test('a free-standing prop leaves room to walk around it', () => {
    // The constraint that has to hold: a solid circle needs its own radius plus
    // a walker's width of clearance from every wall, or there is a spot where
    // the wall pushes you into the prop, the prop pushes you into the wall, and
    // neither constraint can be satisfied. A console set INTO a wall is exempt,
    // because the wall is what stops you and it has no back to get behind.
    const tight = [];
    for (const room of ROOM_LIST) {
      const solids = [
        ...(room.props ?? []).filter((p) => p.solid && p.radius > 0),
        ...(room.stations ?? []).filter((st) => st.mounted !== 'wall')
          .map((st) => ({ ...st, radius: 0.42 })),
      ];
      for (const p of solids) {
        const need = p.radius + 2 * WALKER_RADIUS;
        const gap = room.shape.kind === 'ring'
          ? room.shape.radius - Math.hypot(p.at[0], p.at[1])
          : Math.min(room.shape.width / 2 - Math.abs(p.at[0]),
            room.shape.depth / 2 - Math.abs(p.at[1]));
        if (gap < need - 1e-9) {
          tight.push(`${room.id}/${p.id}: ${gap.toFixed(2)}m of clearance, needs ${need.toFixed(2)}m`);
        }
      }
    }
    assert.deepEqual(tight, []);
  });

  test('every station says whether it is on the floor or in a wall', () => {
    for (const room of ROOM_LIST) {
      for (const st of room.stations ?? []) {
        assert.ok(st.mounted === 'wall' || st.mounted === 'floor',
          `${room.id}/${st.id} has no mount, so collision cannot tell what it is`);
      }
    }
  });

  test('every station stands inside its own room', () => {
    const outside = [];
    for (const room of ROOM_LIST) {
      for (const s of room.stations ?? []) {
        if (!insideWalls(room, s.at[0], s.at[1], 0.6)) {
          outside.push(`${room.id}/${s.id} at [${s.at}]`);
        }
      }
      for (const p of room.props ?? []) {
        if (!insideWalls(room, p.at[0], p.at[1], 0.8)) {
          outside.push(`${room.id}/${p.id} at [${p.at}]`);
        }
      }
    }
    assert.deepEqual(outside, []);
  });

  test('no two stations occupy the same spot', () => {
    const clashes = [];
    for (const room of ROOM_LIST) {
      const list = room.stations ?? [];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const d = Math.hypot(list[i].at[0] - list[j].at[0], list[i].at[1] - list[j].at[1]);
          if (d < 0.9) clashes.push(`${room.id}: ${list[i].id} and ${list[j].id} are ${d.toFixed(2)}m apart`);
        }
      }
    }
    assert.deepEqual(clashes, []);
  });

  test('station ids are unique within a room, and panels name something', () => {
    for (const room of ROOM_LIST) {
      const ids = (room.stations ?? []).map((s) => s.id);
      assert.equal(new Set(ids).size, ids.length, `${room.id} has duplicate station ids`);
      for (const s of room.stations ?? []) {
        assert.ok(s.label && s.label.length > 2, `${room.id}/${s.id} has no label`);
        assert.ok(s.panel === null || typeof s.panel === 'string',
          `${room.id}/${s.id} has a strange panel: ${s.panel}`);
      }
    }
  });

  test('the bridge is the 1966 bridge', () => {
    // docs/RESEARCH.md §3: a ring, with helm and navigation side by side in the
    // MIDDLE of the room forward of the chair, not out on the ring with the
    // others. That is the one detail everybody remembers and the one a naive
    // "space them evenly around the circle" gets wrong.
    const b = ROOMS.bridge;
    assert.equal(b.shape.kind, 'ring');
    assert.equal(b.stations.length, 10, 'the documented bridge has ten stations');

    const helm = b.stations.find((s) => s.id === 'helm');
    const nav = b.stations.find((s) => s.id === 'navigation');
    const chair = b.props.find((p) => p.id === 'chair');

    const helmR = Math.hypot(helm.at[0], helm.at[1]);
    assert.ok(helmR < b.shape.radius * 0.55,
      `helm is ${helmR.toFixed(1)}m out, which is on the ring rather than in the middle`);
    assert.ok(helm.at[1] > chair.at[1], 'helm is not forward of the chair');
    assert.ok(nav.at[1] > chair.at[1], 'navigation is not forward of the chair');
    assert.ok(Math.abs(helm.at[1] - nav.at[1]) < 0.3, 'helm and navigation are not side by side');
    assert.ok(helm.at[0] * nav.at[0] < 0, 'helm and navigation are on the same side');

    // Both look at the viewscreen, which is forward.
    assert.ok(b.viewscreen.at[1] > 0, 'the viewscreen is not forward');
    assert.ok(Math.abs(helm.facing) < 0.2 && Math.abs(nav.facing) < 0.2,
      'the helm does not face the viewscreen');

    // The other eight ring the outer elevation.
    for (const s of b.stations) {
      if (s.id === 'helm' || s.id === 'navigation') continue;
      const r = Math.hypot(s.at[0], s.at[1]);
      assert.ok(r > b.shape.radius * 0.7,
        `${s.id} is ${r.toFixed(1)}m out, which is not on the ring`);
    }
  });

  test('every deck a room claims has a name', () => {
    for (const room of ROOM_LIST) {
      assert.ok(DECKS[room.deck], `${room.id} is on deck ${room.deck}, which is not a deck`);
    }
  });
});

describe('you cannot walk through a wall', () => {
  test('a walker driven hard at every wall stays inside the room', () => {
    // Sixteen directions, held for four seconds each, in every room. Four
    // seconds at a run is fourteen metres, which is longer than any room here.
    for (const room of ROOM_LIST) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const w = new Walker({ roomId: room.id, x: 0, z: 0, yaw: 0, seated: false });
        for (let t = 0; t < 120; t++) {
          w.step({ move: [Math.sin(a), Math.cos(a)], run: true }, 1 / 30);
        }
        // A walker standing in a doorway is legitimately outside the wall.
        const inDoor = (room.exits ?? []).some(
          (e) => Math.hypot(w.x - e.at[0], w.z - e.at[1]) < (e.width ?? 1.2),
        );
        assert.ok(insideWalls(room, w.x, w.z, 0.05) || inDoor,
          `${room.id}: walked to [${w.x.toFixed(2)}, ${w.z.toFixed(2)}] heading ${a.toFixed(2)}`);
      }
    }
  });

  test('a walker never ends up inside a solid prop', () => {
    for (const room of ROOM_LIST) {
      for (const p of room.props ?? []) {
        if (!p.solid || !(p.radius > 0)) continue;
        // Start on top of the prop and walk in eight directions.
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const w = new Walker({ roomId: room.id, x: p.at[0], z: p.at[1], yaw: 0, seated: false });
          for (let t = 0; t < 30; t++) w.step({ move: [Math.sin(a), Math.cos(a)] }, 1 / 30);
          const d = Math.hypot(w.x - p.at[0], w.z - p.at[1]);
          assert.ok(d >= p.radius + WALKER_RADIUS - 0.02,
            `${room.id}/${p.id}: walker ended ${d.toFixed(2)}m from a ${p.radius}m prop`);
        }
      }
    }
  });

  test('a wall stops you but does not stop you dead', () => {
    // The property that makes a thumb-stick feel like walking: pressed into a
    // wall at an angle, you slide ALONG it. Rejecting the move instead is
    // technically correct and unbearable to control on a touch screen.
    const w = new Walker({ roomId: 'sickbay', x: 0, z: -1.6, yaw: 0, seated: false });
    const room = ROOMS.sickbay;
    // Drive into the +x wall at 45 degrees, long enough to reach it and then
    // keep pressing.
    for (let t = 0; t < 150; t++) w.step({ move: [1, 1] }, 1 / 30);
    assert.ok(w.x > room.shape.width / 2 - WALKER_RADIUS - 0.05, 'never reached the wall');
    assert.ok(w.z > 0.5, `slid to z=${w.z.toFixed(2)} — the move was rejected, not resolved`);
  });

  test('a walker dropped in a wall is put back inside', () => {
    // Save files outlive geometry. A record written before a room was resized
    // must not wake up inside a bulkhead with no way out.
    for (const room of ROOM_LIST) {
      for (const [x, z] of [[999, 999], [-999, 0], [0, -999], [1e9, -1e9]]) {
        const [rx, rz] = resolve(room, x, z);
        assert.ok(Number.isFinite(rx) && Number.isFinite(rz), `${room.id}: resolved to [${rx}, ${rz}]`);
        const inDoor = (room.exits ?? []).some(
          (e) => Math.hypot(rx - e.at[0], rz - e.at[1]) < (e.width ?? 1.2) * 1.2,
        );
        assert.ok(insideWalls(room, rx, rz, 0.05) || inDoor,
          `${room.id}: [${x}, ${z}] resolved to [${rx.toFixed(2)}, ${rz.toFixed(2)}]`);
      }
    }
  });

  test('nonsense input does not produce a nonsense position', () => {
    const w = new Walker({ roomId: 'bridge', seated: false });
    for (const bad of [
      { move: [NaN, NaN] }, { move: [Infinity, 0] }, { turn: NaN },
      { move: null }, {}, { move: ['a', 'b'] },
    ]) {
      w.step(bad, 1 / 30);
      assert.ok(Number.isFinite(w.x) && Number.isFinite(w.z) && Number.isFinite(w.yaw),
        `${JSON.stringify(bad)} put the walker at [${w.x}, ${w.z}] yaw ${w.yaw}`);
    }
    // And a nonsense timestep, which is what a backgrounded tab produces.
    for (const dt of [NaN, -1, 1e9, Infinity]) {
      w.step({ move: [1, 1] }, dt);
      assert.ok(Number.isFinite(w.x) && Number.isFinite(w.z));
    }
  });

  test('diagonal movement is not faster than straight', () => {
    // The oldest bug in first-person movement, and still the most common.
    const straight = new Walker({ roomId: 'corridor_a', x: 0, z: -5, yaw: 0, seated: false });
    const diagonal = new Walker({ roomId: 'corridor_a', x: 0, z: -5, yaw: 0, seated: false });
    for (let t = 0; t < 15; t++) {
      straight.step({ move: [0, 1] }, 1 / 30);
      diagonal.step({ move: [1, 1] }, 1 / 30);
    }
    const ds = Math.hypot(straight.x - 0, straight.z + 5);
    const dd = Math.hypot(diagonal.x - 0, diagonal.z + 5);
    assert.ok(dd <= ds + 1e-6, `diagonal covered ${dd.toFixed(2)}m against ${ds.toFixed(2)}m straight`);
  });

  test('running is faster than walking, and both are human speeds', () => {
    assert.ok(RUN_SPEED > WALK_SPEED);
    assert.ok(WALK_SPEED > 1.0 && RUN_SPEED < 6.0, 'nobody walks at that speed');
  });
});

describe('getting about', () => {
  test('a door puts you in the next room, not on top of what is in it', () => {
    const w = new Walker({ roomId: 'bridge', seated: false });
    w.previousRoomId = 'bridge';
    const r = w.enter('turbolift');
    assert.ok(r.ok);
    assert.equal(w.roomId, 'turbolift');
    assert.ok(insideWalls(ROOMS.turbolift, w.x, w.z, 0.3), `arrived at [${w.x}, ${w.z}]`);

    // The specific failure: arriving at the origin of the bridge drops you in
    // the captain's chair.
    const back = new Walker({ roomId: 'turbolift', seated: false });
    back.previousRoomId = 'turbolift';
    back.enter('bridge');
    const chair = ROOMS.bridge.props.find((p) => p.id === 'chair');
    const d = Math.hypot(back.x - chair.at[0], back.z - chair.at[1]);
    assert.ok(d > chair.radius, `arrived ${d.toFixed(2)}m from the chair, which is inside it`);
  });

  test('you arrive facing into the room rather than at the door', () => {
    const w = new Walker({ roomId: 'turbolift', seated: false });
    w.previousRoomId = 'turbolift';
    w.enter('sickbay');
    // Walking forward from where you land must take you further in, not out.
    const before = Math.hypot(w.x, w.z);
    for (let t = 0; t < 10; t++) w.step({ move: [0, 1] }, 1 / 30);
    assert.ok(Math.hypot(w.x, w.z) < before + 0.2,
      'you arrive facing the wall you just came through');
  });

  test('walking into a doorway takes you through it', () => {
    // Beside the chair, not in it — walking aft from dead centre means walking
    // straight through the captain's chair, which is exactly what it is there
    // to stop you doing.
    const w = new Walker({ roomId: 'bridge', x: 1.1, z: -1.0, yaw: Math.PI, seated: false });
    let moved = null;
    for (let t = 0; t < 200 && !moved; t++) {
      // Steer at the door as a player would, rather than walking blind.
      const door = ROOMS.bridge.exits[0];
      w.yaw = Math.atan2(door.at[0] - w.x, door.at[1] - w.z);
      w.step({ move: [0, 1] }, 1 / 30);
      if (w.atExit) moved = w.useExit();
    }
    assert.ok(moved?.ok, 'walked aft on the bridge for three seconds and never found the turbolift');
    assert.equal(w.roomId, 'turbolift');
  });

  test('you can walk to a console and it knows you are there', () => {
    const w = new Walker({ roomId: 'engineering', x: 0, z: 0, yaw: 0, seated: false });
    const target = ROOMS.engineering.stations.find((s) => s.id === 'main_console');
    // Point at it and walk.
    w.yaw = Math.atan2(target.at[0] - w.x, target.at[1] - w.z);
    for (let t = 0; t < 120 && !w.atStation; t++) w.step({ move: [0, 1] }, 1 / 30);
    assert.equal(w.atStation?.id, 'main_console',
      `ended at ${w.atStation?.id ?? 'nothing'} from [${w.x.toFixed(2)}, ${w.z.toFixed(2)}]`);
  });

  test('a console out of reach is not reported as within it', () => {
    const w = new Walker({ roomId: 'engineering', x: 0, z: 0, yaw: 0, seated: false });
    w.step({}, 1 / 30);
    const nearest = ROOMS.engineering.stations
      .map((s) => Math.hypot(s.at[0], s.at[1]))
      .sort((a, b) => a - b)[0];
    if (nearest > REACH) assert.equal(w.atStation, null, 'reported a station from across the room');
  });

  test('the lift asks which deck rather than picking one', () => {
    // A lift has ONE door and every stop is behind it, so "walk through the
    // nearest exit" is not a question it can answer. Before it took a
    // destination, the lift was a room you could enter and not leave: every
    // generated exit sat at the same point, the nearest-exit search returned
    // whichever came first, and it was the same one every time.
    const w = new Walker({ roomId: 'bridge', seated: false });
    w.previousRoomId = 'bridge';
    w.enter('turbolift');
    w.step({}, 1 / 30);
    assert.ok(w.atExit, 'standing in the lift and not at its door');

    const vague = w.useExit();
    assert.equal(vague.ok, false, 'the lift guessed a deck');
    assert.equal(vague.needsDestination, true);
    assert.equal(w.roomId, 'turbolift');

    assert.ok(w.liftStops().length > 1, 'the lift serves one place');
    const named = w.useExit('engineering');
    assert.ok(named.ok, named.reason);
    assert.equal(w.roomId, 'engineering');
  });

  test('the lift refuses a deck it does not serve', () => {
    const w = new Walker({ roomId: 'turbolift', x: 0, z: 0.9, yaw: 0, seated: false });
    w.step({}, 1 / 30);
    const r = w.useExit('sickbay');
    assert.equal(r.ok, false, 'the lift opened straight into sickbay');
    assert.equal(w.roomId, 'turbolift');
  });

  test('naming a door you are not standing at does not teleport you', () => {
    // The obvious way this argument gets abused: `useExit('engineering')` from
    // the middle of sickbay. Reach is checked first, name second.
    const w = new Walker({ roomId: 'sickbay', x: 0, z: 0, yaw: 0, seated: false });
    w.step({}, 1 / 30);
    const r = w.useExit('corridor_a');
    assert.equal(r.ok, false, `crossed the room by naming a door: now in ${w.roomId}`);
    assert.equal(w.roomId, 'sickbay');
  });

  test('every room can be routed to from the bridge', () => {
    for (const room of ROOM_LIST) {
      const path = route('bridge', room.id);
      assert.ok(path, `no route from the bridge to ${room.id}`);
      assert.equal(path[0], 'bridge');
      assert.equal(path[path.length - 1], room.id);
      // And every hop is a real door.
      for (let i = 0; i < path.length - 1; i++) {
        const doors = (ROOMS[path[i]].exits ?? []).map((e) => e.to);
        assert.ok(doors.includes(path[i + 1]),
          `${path[i]} has no door to ${path[i + 1]}`);
      }
    }
  });

  test('the route is the short way round', () => {
    // Bridge to sickbay is bridge -> lift -> corridor -> sickbay, and any
    // route longer than that means the search is not breadth-first.
    // Bridge -> lift -> corridor -> sickbay. Anything longer means the search
    // is not breadth-first; anything shorter means the lift opens into rooms it
    // should not.
    assert.deepEqual(route('bridge', 'sickbay'), ['bridge', 'turbolift', 'corridor_a', 'sickbay']);
    assert.deepEqual(route('bridge', 'bridge'), ['bridge']);
    assert.equal(route('bridge', 'nowhere'), null);
  });
});

describe('the chair', () => {
  test('a new commission starts seated IN it, not near it', () => {
    // The default position used to be a fixed point a metre behind the chair,
    // so the game began with the captain standing in the command well
    // insisting he was sitting down — and every walk started a metre closer to
    // the door than it should have.
    const w = new Walker();
    assert.equal(w.roomId, START_ROOM);
    assert.equal(w.seated, true);
    const chair = ROOMS.bridge.props.find((p) => p.id === 'chair');
    assert.equal(w.x, chair.at[0]);
    assert.equal(w.z, chair.at[1]);
  });

  test('seated, you do not move', () => {
    const w = new Walker();
    const { x, z } = w;
    for (let t = 0; t < 60; t++) w.step({ move: [1, 1], run: true }, 1 / 30);
    assert.equal(w.x, x);
    assert.equal(w.z, z);
  });

  test('but you can still look around', () => {
    // The captain turns to Spock without getting up.
    const w = new Walker();
    const before = w.yaw;
    for (let t = 0; t < 30; t++) w.step({ turn: 1.0 }, 1 / 30);
    assert.notEqual(w.yaw, before);
  });

  test('standing up puts you beside the chair, not inside it', () => {
    const w = new Walker();
    w.sit(false);
    assert.equal(w.seated, false);
    const chair = ROOMS.bridge.props.find((p) => p.id === 'chair');
    const d = Math.hypot(w.x - chair.at[0], w.z - chair.at[1]);
    assert.ok(d >= chair.radius, `stood up ${d.toFixed(2)}m from a ${chair.radius}m chair`);
  });

  test('you cannot take the chair from another deck', () => {
    const w = new Walker({ roomId: 'engineering', seated: false });
    const r = w.sit(true);
    assert.equal(r.ok, false);
    assert.equal(w.seated, false);
  });

  test('sitting back down returns you to the chair exactly', () => {
    const w = new Walker();
    const chair = ROOMS.bridge.props.find((p) => p.id === 'chair');
    w.sit(false);
    for (let t = 0; t < 30; t++) w.step({ move: [1, 0] }, 1 / 30);
    w.sit(true);
    assert.equal(w.x, chair.at[0]);
    assert.equal(w.z, chair.at[1]);
    assert.equal(w.seated, true);
  });
});

describe('naming a room', () => {
  test('the rooms people actually say', () => {
    const cases = {
      'sickbay': 'sickbay', 'sick bay': 'sickbay', 'the infirmary': 'sickbay',
      'engineering': 'engineering', 'the engine room': 'engineering',
      'transporter room': 'transporter', 'the transporter room': 'transporter',
      'briefing room': 'briefing', 'conference room': 'briefing',
      'my quarters': 'quarters', 'the bridge': 'bridge', 'turbolift': 'turbolift',
    };
    for (const [said, id] of Object.entries(cases)) {
      assert.equal(findRoom(said)?.id, id, `"${said}"`);
    }
  });

  test('a longer name beats the short one inside it', () => {
    // "transporter room" must not resolve on the bare word "transporter" first
    // and then be wrong about which one — they agree here, but the scan order
    // is what makes that true and it is worth pinning.
    assert.equal(findRoom('take us to the transporter room')?.id, 'transporter');
  });

  test('a room is not a star system', () => {
    // The obvious failure: "go to sickbay" becoming a course for a system.
    // These two resolvers see the same text and must not both claim it.
    for (const said of ['sickbay', 'engineering', 'the bridge', 'my quarters',
      'briefing room', 'transporter room', 'turbolift']) {
      const tokens = normalize(said).tokens;
      const place = findPlace(normalize(said).text, tokens);
      assert.equal(place, null, `"${said}" resolved to the system ${place?.name}`);
    }
  });

  test('a star system is not a room', () => {
    for (const said of ['vulcan', 'rigel', 'qo nos', 'sol', 'andoria', 'wolf 359']) {
      assert.equal(findRoom(said), null, `"${said}" resolved to a room`);
    }
  });

  test('nonsense names nothing', () => {
    for (const said of ['', null, undefined, '   ', 'the pool', 'deck 40', '!!!']) {
      assert.equal(findRoom(said), null, `"${said}"`);
    }
  });
});

describe('persistence', () => {
  test('where you were standing survives a save', () => {
    const w = new Walker({ roomId: 'sickbay', seated: false });
    for (let t = 0; t < 20; t++) w.step({ move: [0.4, 1], turn: 0.3 }, 1 / 30);
    const restored = Walker.load(JSON.parse(JSON.stringify(w.save())));
    assert.equal(restored.roomId, w.roomId);
    assert.ok(Math.abs(restored.x - w.x) < 1e-9);
    assert.ok(Math.abs(restored.z - w.z) < 1e-9);
    assert.ok(Math.abs(restored.yaw - w.yaw) < 1e-9);
    assert.equal(restored.seated, w.seated);
  });

  test('a save with a room that no longer exists lands on the bridge', () => {
    const w = Walker.load({ roomId: 'holodeck', x: 3, z: 3, yaw: 1 });
    assert.equal(w.roomId, START_ROOM);
    assert.ok(insideWalls(ROOMS.bridge, w.x, w.z, 0.5));
  });

  test('a corrupt save does not produce a walker in a wall', () => {
    for (const bad of [
      { roomId: 'bridge', x: NaN, z: NaN },
      { roomId: 'sickbay', x: 1e9, z: -1e9 },
      { roomId: 'engineering', x: null, z: undefined, yaw: 'north' },
      {},
    ]) {
      const w = Walker.load(bad);
      assert.ok(Number.isFinite(w.x) && Number.isFinite(w.z) && Number.isFinite(w.yaw),
        `${JSON.stringify(bad)} loaded to [${w.x}, ${w.z}] yaw ${w.yaw}`);
      const inDoor = (w.room.exits ?? []).some(
        (e) => Math.hypot(w.x - e.at[0], w.z - e.at[1]) < (e.width ?? 1.2) * 1.2,
      );
      assert.ok(insideWalls(w.room, w.x, w.z, 0.05) || inDoor,
        `${JSON.stringify(bad)} loaded into a wall at [${w.x.toFixed(2)}, ${w.z.toFixed(2)}]`);
    }
  });

  test('the save carries no live objects', () => {
    // It goes through JSON.stringify with the rest of the record, so anything
    // in here that is not a plain value is silently lost.
    const w = new Walker({ roomId: 'briefing', seated: false });
    w.step({ move: [1, 0] }, 1 / 30);
    const saved = w.save();
    for (const [k, v] of Object.entries(saved)) {
      assert.ok(v === null || ['string', 'number', 'boolean'].includes(typeof v),
        `save carries ${k} as a ${typeof v}`);
    }
  });
});

describe('a walk that actually gets somewhere', () => {
  // The single most valuable check in this subsystem: it proves the geometry,
  // the room graph, the collision and the doors all agree at once. Any one of
  // them being wrong and the walker never arrives.
  //
  // The walker here is a PLAYER, not a pathfinder: it aims at the next door and
  // presses forward, with no idea what is between it and the doorway. When it
  // stops making progress it sidesteps, because that is what a thumb on a stick
  // does. Anything cleverer would be testing the pathfinder rather than the
  // ship — the first run of this was a straight-line walker that got stuck on
  // the captain's chair on the way out of the bridge, which is the chair doing
  // its job.
  const walkTo = (fromId, toId, seconds = 60) => {
    const w = new Walker({ roomId: fromId, x: 0, z: 0, yaw: 0, seated: false });
    [w.x, w.z] = resolve(w.room, 0, 0);
    const steps = Math.round(seconds * 30);
    let lastDistance = Infinity;
    let stuck = 0;
    let sidestep = 0;
    let side = 1;

    for (let t = 0; t < steps; t++) {
      if (w.roomId === toId) return { w, arrived: true, t };

      const path = route(w.roomId, toId);
      if (!path || path.length < 2) return { w, arrived: false, t, why: 'no route' };
      const door = (w.room.exits ?? []).find((e) => e.to === path[1]);
      if (!door) return { w, arrived: false, t, why: `no door to ${path[1]}` };

      const dx = door.at[0] - w.x;
      const dz = door.at[1] - w.z;
      const d = Math.hypot(dx, dz);

      if (d > lastDistance - 0.005) stuck++; else stuck = 0;
      lastDistance = d;
      if (stuck > 12 && sidestep <= 0) { sidestep = 22; side = -side; stuck = 0; }

      w.yaw = Math.atan2(dx, dz);
      if (sidestep > 0) {
        sidestep--;
        w.step({ move: [side, 0.35] }, 1 / 30);
      } else {
        w.step({ move: [0, 1] }, 1 / 30);
      }
      // In the lift you have to say which deck; everywhere else the door is
      // the only one within reach and the name is redundant.
      if (w.atExit) {
        const r = w.useExit(path[1]);
        if (r.ok) { lastDistance = Infinity; stuck = 0; sidestep = 0; }
      }
    }
    return { w, arrived: w.roomId === toId, t: steps, why: 'ran out of time' };
  };

  for (const target of ['sickbay', 'engineering', 'transporter', 'briefing', 'quarters']) {
    test(`you can walk from the bridge to ${target}`, () => {
      const { w, arrived, t, why } = walkTo('bridge', target);
      assert.ok(arrived,
        `stuck in ${w.roomId} at [${w.x.toFixed(2)}, ${w.z.toFixed(2)}] after ${(t / 30).toFixed(1)}s (${why})`);
    });
  }

  test('and back again', () => {
    const { w } = walkTo('bridge', 'engineering');
    const back = walkTo(w.roomId, 'bridge');
    assert.ok(back.arrived, `stuck in ${back.w.roomId} on the way back`);
  });

  test('a walk through the whole ship never leaves the ship', () => {
    // Every pair, with the walls checked at EVERY step rather than only at the
    // end — a walker who clips through a bulkhead and back in would otherwise
    // pass. This is the check that proves the geometry, the room graph, the
    // collision and the doors all agree at once.
    for (const from of ROOM_LIST) {
      for (const to of ROOM_LIST) {
        if (from.id === to.id) continue;
        const { w, arrived, why } = walkTo(from.id, to.id, 60);
        assert.ok(arrived, `${from.id} -> ${to.id}: stuck in ${w.roomId} (${why})`);
      }
    }
  });

  test('and never once outside the hull on the way', () => {
    // The same journeys, asserting the walls at every single frame.
    for (const to of ['engineering', 'sickbay', 'transporter', 'quarters', 'briefing']) {
      const w = new Walker({ roomId: 'bridge', x: 0, z: 0, yaw: 0, seated: false });
      [w.x, w.z] = resolve(w.room, 0, 0);
      let lastDistance = Infinity;
      let stuck = 0;
      let sidestep = 0;
      let side = 1;
      for (let t = 0; t < 1800 && w.roomId !== to; t++) {
        const path = route(w.roomId, to);
        const door = (w.room.exits ?? []).find((e) => e.to === path?.[1]);
        if (!door) break;
        const d = Math.hypot(door.at[0] - w.x, door.at[1] - w.z);
        if (d > lastDistance - 0.005) stuck++; else stuck = 0;
        lastDistance = d;
        if (stuck > 12 && sidestep <= 0) { sidestep = 22; side = -side; stuck = 0; }
        w.yaw = Math.atan2(door.at[0] - w.x, door.at[1] - w.z);
        w.step({ move: sidestep-- > 0 ? [side, 0.35] : [0, 1] }, 1 / 30);

        const inDoor = (w.room.exits ?? []).some(
          (e) => Math.hypot(w.x - e.at[0], w.z - e.at[1]) < (e.width ?? 1.2),
        );
        assert.ok(insideWalls(w.room, w.x, w.z, 0.05) || inDoor,
          `left ${w.room.id} at [${w.x.toFixed(2)}, ${w.z.toFixed(2)}] heading for ${to}`);

        // In the lift you have to say which deck; everywhere else the door is
      // the only one within reach and the name is redundant.
      if (w.atExit) {
        const r = w.useExit(path[1]);
        if (r.ok) { lastDistance = Infinity; stuck = 0; sidestep = 0; }
      }
      }
      assert.equal(w.roomId, to, `never reached ${to}`);
    }
  });
});

// `confine` is exported for the renderer to reuse on camera placement, so it
// has to behave sensibly on its own rather than only inside `resolve`.
describe('confine on its own', () => {
  test('a point already inside is left where it is', () => {
    for (const room of ROOM_LIST) {
      const [x, z] = confine(room, 0.1, 0.1);
      assert.equal(x, 0.1);
      assert.equal(z, 0.1);
    }
  });

  test('a ring confines to a circle and a box to a rectangle', () => {
    const [rx, rz] = confine(ROOMS.bridge, 100, 0);
    assert.ok(Math.abs(Math.hypot(rx, rz) - (ROOMS.bridge.shape.radius - WALKER_RADIUS)) < 1e-9);

    const [bx] = confine(ROOMS.sickbay, 100, 0);
    assert.ok(Math.abs(bx - (ROOMS.sickbay.shape.width / 2 - WALKER_RADIUS)) < 1e-9);
  });
});

describe('walking there on your own', () => {
  // `stepToward` is what "go to sickbay" runs. The test the whole subsystem
  // exists for: type it, advance the simulation, and actually arrive.
  test('you get up out of the chair to go somewhere', () => {
    const w = new Walker();               // seated, on the bridge
    const memory = {};
    stepToward(w, 'engineering', 1 / 30, memory);
    assert.equal(w.seated, false, 'walked to engineering without standing up');
  });

  for (const room of ['sickbay', 'engineering', 'transporter', 'briefing', 'quarters', 'turbolift']) {
    test(`"go to ${room}" arrives within a minute of walking`, () => {
      const w = new Walker();
      const memory = {};
      let arrived = false;
      let t = 0;
      for (; t < 60 * 30 && !arrived; t++) {
        arrived = stepToward(w, room, 1 / 30, memory).arrived;
      }
      assert.ok(arrived,
        `still in ${w.roomId} at [${w.x.toFixed(2)}, ${w.z.toFixed(2)}] after 60 seconds`);
      assert.equal(w.roomId, room);
      // A walk takes time. A second and a half to the nearest lift stop, five
      // to sickbay — the lift is quick because a turbolift is quick, and the
      // corridor beyond it is not.
      assert.ok(t > 30, `arrived in ${(t / 30).toFixed(1)}s, which is a teleport, not a walk`);
    });
  }

  test('a walk to nowhere reports blocked rather than wandering forever', () => {
    const w = new Walker({ seated: false });
    const r = stepToward(w, 'holodeck', 1 / 30, {});
    assert.equal(r.blocked, true);
    assert.equal(w.roomId, 'bridge');
  });

  test('a walk to where you already are is already over', () => {
    const w = new Walker({ roomId: 'sickbay', seated: false });
    const r = stepToward(w, 'sickbay', 1 / 30, {});
    assert.equal(r.arrived, true);
  });
});

// ============================================ the ship, with a game around it
//
// Everything above is the walker on its own. These assert the thing the plan
// called the single most valuable check in the subsystem: type "go to sickbay",
// run the simulation, and actually be in sickbay. It proves the geometry, the
// room graph, the collision, the autopilot AND the parser all agree at once —
// which five separate assertions would not.

describe('going somewhere, as an order', () => {
  const play = (g, seconds) => {
    for (let t = 0; t < seconds * 30; t++) g.update(1 / 30);
  };

  test('a new commission begins in the chair', () => {
    const g = new Game({ seed: 3001n, crewMode: 'canon', era: 'tos' });
    assert.equal(g.walk.roomId, 'bridge');
    assert.equal(g.walk.seated, true);
  });

  test('"go to sickbay" puts the captain in sickbay', () => {
    const g = new Game({ seed: 3002n, crewMode: 'canon', era: 'tos' });
    const order = parseOrder('go to sickbay');
    assert.equal(order.action, 'go_to_room', `parsed as ${order.action}`);
    assert.equal(order.room, 'sickbay');

    assert.ok(g.goToRoom(order.room).ok);
    play(g, 30);
    assert.equal(g.walk.roomId, 'sickbay', `still in ${g.walk.roomId}`);
    assert.equal(g.walkOrder, null, 'the walk never finished');
    assert.equal(g.walk.seated, false, 'arrived in sickbay still sitting down');
  });

  test('it takes time, and the crew keeps working while you walk', () => {
    const g = new Game({ seed: 3003n, crewMode: 'canon', era: 'tos' });
    g.goToRoom('engineering');
    play(g, 0.5);
    assert.equal(g.walk.roomId !== 'engineering', true, 'that was a teleport');
    assert.ok(g.walkOrder, 'the walk ended before it began');
    play(g, 30);
    assert.equal(g.walk.roomId, 'engineering');
  });

  test('the log records leaving and arriving', () => {
    const g = new Game({ seed: 3004n, crewMode: 'canon', era: 'tos' });
    const before = g.log.length;
    g.goToRoom('briefing');
    play(g, 30);
    const added = g.log.slice(before).map((l) => l.text).join(' | ');
    assert.match(added, /Making for/);
    assert.match(added, /Arrived at/);
  });

  test('you cannot wander off during a firefight', () => {
    const g = new Game({ seed: 3005n, crewMode: 'canon', era: 'tos' });
    g.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Test' })]);
    const r = g.goToRoom('engineering');
    assert.equal(r.ok, false, 'left the bridge mid-battle');
    assert.equal(g.walkOrder, null);
  });

  test('a walk to nowhere gives up and says so', () => {
    const g = new Game({ seed: 3006n, crewMode: 'canon', era: 'tos' });
    assert.equal(g.goToRoom('the holodeck').ok, false);
    assert.equal(g.walkOrder, null);
  });

  test('"stand up" and "take the chair" work, and are opposites', () => {
    const g = new Game({ seed: 3007n, crewMode: 'canon', era: 'tos' });

    const up = parseOrder('stand up');
    assert.equal(up.action, 'chair');
    assert.equal(up.sit, false, '"stand up" was read as sitting down');
    g.takeChair(up.sit);
    assert.equal(g.walk.seated, false);

    const down = parseOrder('take the chair');
    assert.equal(down.action, 'chair');
    assert.equal(down.sit, true, '"take the chair" was read as standing up');
    g.takeChair(down.sit);
    assert.equal(g.walk.seated, true);
  });

  test('taking the chair from another deck walks you back to it', () => {
    const g = new Game({ seed: 3008n, crewMode: 'canon', era: 'tos' });
    g.goToRoom('engineering');
    play(g, 30);
    assert.equal(g.walk.roomId, 'engineering');

    const r = g.takeChair(true);
    assert.equal(r.ok, true);
    assert.equal(r.walking, true, 'sat down in the chair from eleven decks away');
    play(g, 40);
    assert.equal(g.walk.roomId, 'bridge');
  });

  test('where you are standing survives a save', () => {
    const g = new Game({ seed: 3009n, crewMode: 'canon', era: 'tos' });
    g.goToRoom('transporter');
    play(g, 30);
    const restored = Game.load(JSON.parse(JSON.stringify(g.save())));
    assert.equal(restored.walk.roomId, 'transporter');
    assert.ok(Math.abs(restored.walk.x - g.walk.x) < 1e-9);
    assert.equal(restored.walk.seated, false);
  });

  test('a record from before the ship had an inside loads into the chair', () => {
    const g = new Game({ seed: 3010n, crewMode: 'canon', era: 'tos' });
    const data = JSON.parse(JSON.stringify(g.save()));
    delete data.walk;
    const restored = Game.load(data);
    assert.equal(restored.walk.roomId, 'bridge');
    assert.equal(restored.walk.seated, true);
  });

  test('"go to sickbay" is not a course for a star system', () => {
    // The failure the room matcher was written to avoid. Both resolvers see
    // this text and only one of them may claim it.
    for (const said of ['go to sickbay', 'take me to engineering',
      'go to the transporter room', 'back to the bridge']) {
      const order = parseOrder(said);
      assert.equal(order.action, 'go_to_room', `"${said}" parsed as ${order.action}`);
    }
    // And the reverse: naming a system is still a course.
    for (const said of ['set course for Vulcan', 'take us to Rigel', 'go to Sol']) {
      const order = parseOrder(said);
      assert.equal(order.action, 'course', `"${said}" parsed as ${order.action}`);
    }
  });
});

describe('a compartment and a star system are different things', () => {
  // This took three passes to get right and each failure was a different layer,
  // so all three are pinned. The whole problem is that a ship's inside and the
  // galaxy outside it share the same English.

  test('the addressee stripper does not eat the room you named', () => {
    // Sickbay and engineering are STATION names as well as compartments, and
    // the normaliser pulls an addressee off the line before anything is scored.
    // "Go to sickbay" reached the scorer as the bare phrase "go to". The full
    // line is kept for exactly this.
    const n = normalize('go to sickbay');
    assert.equal(n.text, 'go to', 'the normaliser changed shape');
    assert.equal(n.full, 'go to sickbay', 'the unstripped line is not carried');
    assert.equal(findRoom(n.full)?.id, 'sickbay');
  });

  test('naming a compartment rules out a course, in both parser layers', () => {
    // The lexicon and the older regex matcher BOTH own the phrase "go to", and
    // both had to be taught. Fixing one left the other answering "Which system,
    // Captain?" from one layer down.
    for (const said of ['go to sickbay', 'go to engineering', 'take me to my quarters',
      'go to the briefing room', 'back to the bridge', 'down to the transporter room']) {
      const order = parseOrder(said);
      assert.equal(order.action, 'go_to_room', `"${said}" parsed as ${order.action ?? order.error}`);
      assert.ok(order.room, `"${said}" named no room`);
    }
  });

  test('naming a system is still a course, and still asks when it is missing', () => {
    for (const said of ['set course for Vulcan', 'take us to Rigel', 'lay in a course for Sol',
      'head for Andoria']) {
      assert.equal(parseOrder(said).action, 'course', `"${said}"`);
    }
    // A course with no destination still asks rather than guessing a room.
    const vague = parseOrder('set course');
    assert.equal(vague.action, undefined);
    assert.match(vague.error ?? '', /system/i);
  });

  test('addressing a station is not walking to it', () => {
    // "Sickbay, report" is the intercom. It must not send the captain down
    // five decks to ask in person.
    for (const said of ['sickbay, report', 'engineering, damage report',
      'bridge to engineering']) {
      assert.notEqual(parseOrder(said).action, 'go_to_room', `"${said}" started a walk`);
    }
  });
});
