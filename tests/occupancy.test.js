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
import { officerMesh } from '../src/gfx/room.js';

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
