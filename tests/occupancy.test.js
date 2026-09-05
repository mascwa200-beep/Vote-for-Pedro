// Who is in the room, and why they are in that one.
//
// The ship has seventeen rooms and thirty-six stations. Twenty-eight of those
// stations have somebody standing at them, and the eight that do not are in the
// captain's quarters, the briefing room, the recreation room, the crew quarters
// and the turbolift — so the two rooms that exist for no reason except to be
// where four hundred and thirty people LIVE were the two rooms with nobody in
// them.
//
// And nothing about the interior ever changed, because a crew figure is drawn
// from a station's `crew` field and that is static data. Sickbay held one
// medical officer whether nobody was hurt or the ship had just taken forty
// casualties. The mess was equally deserted at normal alert and at red. A
// boarding party could be cutting through deck seven with the corridor outside
// standing empty.
//
// These tests are about what CHANGES, because that was the thing that did not.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';
import { ROOMS } from '../src/world/interiors.data.js';
import { occupantsOf, headcountOf } from '../src/sim/occupancy.js';
import { stepToward, route } from '../src/sim/walk.js';
import { officerMesh, officerStandsAt } from '../src/gfx/room.js';

const ship = (fn) => {
  const g = new Game({
    seed: 3n, crewMode: 'original', shipClass: 'constitution',
    character: new Character({ speciesId: 'human', careerId: 'command' }),
  });
  fn?.(g);
  return g;
};

const crewIn = (g, id) => occupantsOf(g, id).filter((o) => !o.intruder).length;
const hostilesIn = (g, id) => occupantsOf(g, id).filter((o) => o.intruder).length;

describe('the ship has people in it', () => {
  test('the rooms that had nobody in them have somebody in them', () => {
    // The specific finding. A station is the only thing that used to put a
    // figure in a room, and these two rooms have no crewed station — so a mess
    // hall and a bunk room aboard a ship of four hundred and thirty were
    // empty at every moment of a five-year mission.
    const g = ship();
    for (const id of ['rec', 'crewquarters']) {
      const stationed = (ROOMS[id].stations ?? []).filter((s) => s.crew).length;
      assert.equal(stationed, 0, `${id} has a crewed station, so this proves nothing`);
      assert.ok(crewIn(g, id) > 0, `${id} is still empty`);
    }
  });

  test('the mess empties at red alert, and the corridors do not', () => {
    // The most legible rule in the file: a captain who walks into a deserted
    // recreation room at red alert has been told something true about his ship
    // without a word being printed.
    //
    // The corridor is the control. Without it "everybody vanishes at red
    // alert" would satisfy the first half, and that is a bug rather than a
    // feature — at action stations four hundred people are all GOING
    // somewhere.
    const quiet = ship();
    const action = ship((g) => g.setAlert('red'));
    assert.ok(crewIn(quiet, 'rec') >= 4, `the mess holds ${crewIn(quiet, 'rec')} when quiet`);
    assert.equal(crewIn(action, 'rec'), 0, 'somebody is still in the mess at red alert');
    assert.ok(crewIn(action, 'corridor_a') > crewIn(quiet, 'corridor_a'),
      'the corridors did not get busier at action stations');
    assert.ok(crewIn(action, 'corridor_sec') > crewIn(quiet, 'corridor_sec'),
      'security did not turn out at red alert');
  });

  test('a battered ship has a full sickbay and a busy engineering', () => {
    const whole = ship();
    const beaten = ship((g) => {
      g.ship.crew = Math.round(g.ship.maxCrew * 0.86);
      g.ship.hull = g.ship.maxHull * 0.5;
      g.ship.fires = 2;
      g.crew.officers[1].injured = true;
      g.crew.officers[3].injured = true;
    });
    assert.ok(crewIn(beaten, 'sickbay') > crewIn(whole, 'sickbay'),
      'sickbay is no fuller after a battle than before one');
    assert.ok(crewIn(beaten, 'engineering') > crewIn(whole, 'engineering'),
      'nobody turned out to fight the fires');
    // And it is the CASUALTIES doing it, not merely the alert: an undamaged
    // ship at red alert must not fill its sickbay.
    const scared = ship((g) => g.setAlert('red'));
    assert.equal(crewIn(scared, 'sickbay'), crewIn(whole, 'sickbay'),
      'sickbay filled up because of the alert rather than because of casualties');
  });

  test('a decimated crew has fewer people to put in the mess', () => {
    const full = ship();
    const thin = ship((g) => { g.ship.crew = Math.round(g.ship.maxCrew * 0.3); });
    assert.ok(crewIn(thin, 'rec') < crewIn(full, 'rec'),
      `the mess holds ${crewIn(thin, 'rec')} on a third of a crew and `
      + `${crewIn(full, 'rec')} on a full one`);
  });

  test('a boarding party is aboard, and looks like one', () => {
    // `ship.boarders` has existed since a hostile could send a party across,
    // and the defence against them is written out in full in `Ship.update` —
    // defenders drawn from the crew, losses on both sides, a subsystem wrecked
    // every second or so. None of it was ever VISIBLE.
    const calm = ship();
    const boarded = ship((g) => { g.setAlert('red'); g.ship.boarders = 24; });

    assert.equal(hostilesIn(calm, 'corridor_sec'), 0,
      'there are intruders aboard a ship nobody has boarded');
    assert.ok(hostilesIn(boarded, 'corridor_sec') > 0, 'the boarding party is invisible');
    assert.ok(hostilesIn(boarded, 'engineering') > 0, 'they are not going for engineering');

    // Not everywhere: a raid that is uniformly distributed through seventeen
    // rooms is a crowd, not a boarding party.
    assert.equal(hostilesIn(boarded, 'rec'), 0, 'the boarding party is in the mess hall');
    assert.equal(hostilesIn(boarded, 'sickbay'), 0, 'the boarding party is in sickbay');

    // And they are unmistakable. A first-person view has no labels on
    // anything, so the only thing that says "this one should not be here" is
    // the colour of the uniform.
    const them = officerMesh('intruder', 'wall');
    const us = officerMesh('ops', 'wall');
    const mid = (m) => {
      const f = m.stride / 4;
      const i = Math.floor(m.vertexCount / 2) * f;
      return [m.data[i + 6], m.data[i + 7], m.data[i + 8]];
    };
    const [a, b] = [mid(them), mid(us)];
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.3,
      `an intruder is ${a} and a crewman is ${b} — indistinguishable at a glance`);
  });

  test('nobody is standing inside the furniture', () => {
    // The placement is rejection sampling with a hard cap, so a person who
    // cannot be placed is simply not there — which is correct, and means this
    // has to check the ones who WERE placed.
    for (const [id, room] of Object.entries(ROOMS)) {
      const g = ship((x) => { x.ship.boarders = 24; });
      for (const who of occupantsOf(g, id)) {
        for (const p of room.props ?? []) {
          if (p.solid === false) continue;
          const d = Math.hypot(who.at[0] - p.at[0], who.at[1] - p.at[1]);
          assert.ok(d >= (p.radius ?? 0.6) * 0.8 + 0.33,
            `somebody is standing in ${p.id ?? p.kind} in ${id}`);
        }
        const w = (room.shape?.width ?? 8) / 2;
        const d = (room.shape?.depth ?? 8) / 2;
        assert.ok(Math.abs(who.at[0]) <= w && Math.abs(who.at[1]) <= d,
          `somebody is standing outside the bulkheads of ${id}`);
      }
    }
  });

  test('the same ship in the same state puts the same people in the same places', () => {
    // Called every frame by the renderer. A hash rather than a random draw, so
    // the mess does not reshuffle itself thirty times a second and walking out
    // of a room and back does not replace everybody in it.
    const a = ship();
    const b = ship();
    for (const id of Object.keys(ROOMS)) {
      assert.deepEqual(occupantsOf(a, id), occupantsOf(b, id), `${id} is not deterministic`);
      assert.deepEqual(occupantsOf(a, id), occupantsOf(a, id), `${id} changes between calls`);
    }
  });

  test('and it never touches the simulation', () => {
    // The scenery must not move the game. A draw taken from `game.rng` here
    // would make what happens in a commission depend on which rooms the
    // captain happened to look at.
    const a = ship();
    const b = ship();
    for (const id of Object.keys(ROOMS)) occupantsOf(a, id);
    for (let i = 0; i < 20; i++) {
      assert.equal(a.rng.float(), b.rng.float(),
        'the random stream moved because somebody looked at a room');
    }
  });

  test('the count on the caption is the count in the room', () => {
    const g = ship((x) => { x.setAlert('red'); x.ship.boarders = 24; });
    for (const id of Object.keys(ROOMS)) {
      const h = headcountOf(g, id);
      const stationed = (ROOMS[id].stations ?? []).filter((s) => s.crew).length;
      assert.equal(h.crew, stationed + crewIn(g, id), `${id} miscounts its crew`);
      assert.equal(h.intruders, hostilesIn(g, id), `${id} miscounts the intruders`);
    }
  });

  test('every alert the game can set changes something, and none of them throws', () => {
    // `Game.setAlert` uses normal, yellow, red and blue. There is no 'green',
    // and the first version of the security-corridor rule tested for one —
    // which did nothing and looked like it did something.
    const seen = new Set();
    for (const level of ['normal', 'yellow', 'red', 'blue']) {
      const g = ship((x) => x.setAlert(level));
      assert.equal(g.alert, level, `the ship would not go to ${level}`);
      const shape = Object.keys(ROOMS).map((id) => crewIn(g, id)).join(',');
      seen.add(shape);
    }
    assert.equal(seen.size, 4,
      `four alert levels produced ${seen.size} different ships — one of them does nothing`);
  });
});

// ---------------------------------------------------------------------------
// The captain walked through the crew.
//
// `resolve()` in walk.js keeps the captain out of the bulkheads and off the
// furniture — `confine` then `avoidProps` — and people are neither. Nothing
// has ever stopped the viewpoint passing straight through a person.
//
// Measured over every one of the 252 room-to-room routes the ship has, walked
// with the game's own autopilot and sampled every tick:
//
//                                          before    after
//     routes passing within 0.35 m            30        0
//     closest pass of all                   0.03 m   0.53 m
//     walking frames inside 0.35 m         1.4%      0.0%
//
// 0.35 is the figure's own radius: `officerMesh` builds a torso 0.40 wide with
// arms out to ±0.315, so a camera closer than that is INSIDE the person.
//
// The cause was not the collision code. It was one number in the placement:
// the wall inset was 0.8, subtracted flat from the half-extent, which is a
// sensible standoff in a nine-metre room and a catastrophe in a 2.6-metre
// corridor — half of 2.6 is 1.3, less 0.8 leaves 0.5, so every person in a
// corridor was placed in its middle METRE. Which is the metre the captain has
// to walk down, because a corridor's doors are at its ends.
//
// Fixed where it was caused. The two rejected alternatives are worth naming:
// pushing people aside as the captain approaches would make the crowd move
// thirty times a second (the hash in occupancy.js exists to stop exactly
// that), and hiding a figure the camera is inside would leave the captain
// still walking through them, with a person popping out of the world in a
// 2.6-metre corridor where there is nowhere for the eye to miss it.
// ---------------------------------------------------------------------------

/** Every figure standing in the room the captain is in, camera-height. */
function figuresIn(g, roomId) {
  const room = ROOMS[roomId];
  const out = [];
  for (const st of room?.stations ?? []) {
    if (st.crew) out.push({ at: officerStandsAt(st), what: `station:${st.id}` });
  }
  for (const who of occupantsOf(g, roomId)) out.push({ at: who.at, what: 'occupant' });
  return out;
}

/**
 * Walk the ship's own autopilot from one room to another, watching the crew.
 *
 * `stepToward` is the thing behind "go to sickbay" — it aims at the next door
 * and presses forward with no idea what is between, which is the whole reason
 * this can happen at all.
 */
function walkWatching(from, to) {
  const g = ship();
  if (!g.walk.enter(from).ok) return null;
  if (!route(from, to)) return null;
  const memory = {};
  let min = Infinity;
  let what = null;
  let frames = 0;
  for (let i = 0; i < 3000; i++) {
    for (const f of figuresIn(g, g.walk.roomId)) {
      const d = Math.hypot(f.at[0] - g.walk.x, f.at[1] - g.walk.z);
      if (d < min) { min = d; what = `${g.walk.roomId}/${f.what}`; }
    }
    frames++;
    const r = stepToward(g.walk, to, 1 / 30, memory);
    if (r.arrived || r.blocked) break;
  }
  return { min, what, frames, arrived: g.walk.roomId === to };
}

describe('and the captain does not walk through them', () => {
  const ids = Object.keys(ROOMS);

  test('no route on the ship takes the camera inside a person', () => {
    const walks = [];
    for (const from of ids) {
      for (const to of ids) {
        if (from === to) continue;
        const r = walkWatching(from, to);
        if (r && r.min < Infinity) walks.push({ from, to, ...r });
      }
    }

    // The denominator, stated before the clean result is believed. A sweep
    // that walked nothing, or that never got near anybody, would pass this
    // test by measuring nothing at all.
    assert.ok(walks.length >= 200, `only ${walks.length} routes were walked`);
    assert.ok(walks.reduce((n, w) => n + w.frames, 0) >= 15000,
      'the walks ended immediately, so nothing was sampled');

    const worst = walks.reduce((a, b) => (b.min < a.min ? b : a));
    assert.ok(worst.min >= 0.35,
      `${worst.from} to ${worst.to} passes within ${worst.min.toFixed(2)} m of `
      + `${worst.what} — the camera is inside them`);
  });

  test('and the instrument above can see somebody at a known distance', () => {
    // The positive case, so the clean result above is evidence rather than a
    // measurement that was never taken. Engineering's machine shop puts an
    // officer 0.52 m from where you arrive on the deck — the closest anyone
    // stands to the captain anywhere on the ship, close enough to speak to and
    // not close enough to be standing in.
    const r = walkWatching('engineering', 'bridge');
    assert.ok(r, 'engineering to the bridge is not a route, so this proves nothing');
    assert.ok(r.min < 0.6 && r.min >= 0.35,
      `the nearest figure measured ${r.min.toFixed(2)} m, not the 0.52 m expected`);
    assert.match(r.what, /^engineering\/station:/, `it found ${r.what}`);
  });

  test('a corridor keeps its people, which is what the rule must not cost', () => {
    // The security corridor is 2.6 m across with FOUR doors on it — twelve
    // lanes over a width that holds one and a half — so every spot in it is
    // somebody's way through. Requiring the lane took it from three people at
    // red alert to one, silently. The bulkhead fallback is what buys them back,
    // and this is the assertion that keeps it honest.
    for (const level of ['normal', 'yellow', 'red', 'blue']) {
      const g = ship((x) => x.setAlert(level));
      for (const id of ids) {
        assert.equal(crewIn(g, id), headcountOf(g, id).crew
          - (ROOMS[id].stations ?? []).filter((s) => s.crew).length,
        `${id} lost people at ${level} alert`);
      }
    }
    const red = ship((x) => x.setAlert('red'));
    assert.equal(crewIn(red, 'corridor_sec'), 3,
      'the security corridor emptied at red alert, which is when it matters most');
  });

  test('and they stand along the walls of it rather than down the middle', () => {
    // The picture this buys, stated as geometry: in a corridor, everybody is
    // further out than the old 0.5 m half-width could ever have put them.
    const g = ship((x) => x.setAlert('red'));
    const room = ROOMS.corridor_sec;
    const half = room.shape.width / 2;
    const people = occupantsOf(g, 'corridor_sec');
    assert.ok(people.length >= 2, `only ${people.length} people, so this proves nothing`);
    for (const who of people) {
      assert.ok(Math.abs(who.at[0]) > 0.5,
        `somebody is standing ${who.at[0].toFixed(2)} m off the centreline of a `
        + `${room.shape.width} m corridor`);
      assert.ok(Math.abs(who.at[0]) < half, 'somebody is standing in the bulkhead');
    }
  });
});
