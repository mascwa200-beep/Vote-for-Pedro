// The stations that had nothing behind them.
//
// Thirty-six stations aboard, and four opened no panel at all: environmental
// control, gravity control and the security board on the bridge, and the chief
// medical officer's desk in sickbay. Walking to one and operating it produced
// "That station is not mine to work, Captain" — spoken by the officer standing
// at it, which is the one person it certainly is.
//
// These tests are about what those four now say, and the property that makes a
// readout worth walking to: it has to CHANGE. A console that prints the same
// page whatever has happened to the ship is a picture of a console.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';
import { ROOMS } from '../src/world/interiors.data.js';
import { stationReport, REPORTING_STATIONS } from '../src/sim/consoles.js';
import { boardedRooms, occupantsOf } from '../src/sim/occupancy.js';

const ship = (fn) => {
  const g = new Game({
    seed: 3n, crewMode: 'original', shipClass: 'constitution',
    character: new Character({ speciesId: 'human', careerId: 'command' }),
  });
  fn?.(g);
  return g;
};

/** Every line of a station's report, as one string, for matching. */
const said = (g, id) => (stationReport(g, id)?.lines ?? []).join(' | ');

const beaten = (g) => {
  g.setAlert('red');
  g.ship.crew = Math.round(g.ship.maxCrew * 0.82);
  g.ship.subsystems.lifesupport = 0.4;
  g.ship.subsystems.auxiliary = 0.55;
  g.ship.fires = 2;
  g.crew.officers[2].injured = true; g.crew.officers[2].injurySeverity = 0.8;
  g.crew.officers[4].injured = true; g.crew.officers[4].injurySeverity = 0.2;
};

describe('the stations that answer', () => {
  test('exactly the stations with no panel of their own', () => {
    // The rule that keeps the two from drifting: a station either opens a
    // panel or it reports, and never both. A station that gained a panel later
    // and kept a report here would open the panel and the report would be
    // dead code nobody could reach.
    const panelless = [];
    for (const room of Object.values(ROOMS)) {
      for (const s of room.stations ?? []) if (!s.panel) panelless.push(s.id);
    }
    assert.deepEqual([...REPORTING_STATIONS].sort(), panelless.sort(),
      'a station either opens a panel or reports, and these two lists disagree');
    assert.ok(panelless.length >= 4, `only ${panelless.length} stations had nothing behind them`);
  });

  test('every one of them says something, on any ship', () => {
    for (const state of [null, beaten, (g) => { g.ship.boarders = 30; g.setAlert('red'); }]) {
      const g = ship(state);
      for (const id of REPORTING_STATIONS) {
        const r = stationReport(g, id);
        assert.ok(r, `${id} reported nothing`);
        assert.ok(r.title && r.title.length > 3, `${id} has no title`);
        assert.ok(r.lines.length >= 2, `${id} said ${r.lines.length} line(s)`);
        for (const l of r.lines) {
          assert.equal(typeof l, 'string');
          assert.ok(l.length > 8, `${id} said "${l}"`);
          assert.ok(!/undefined|NaN|\[object/.test(l), `${id} said "${l}"`);
        }
      }
    }
  });

  test('and a station that is not one of them reports nothing at all', () => {
    // Null rather than an empty report: "this station has nothing behind it"
    // and "this station has nothing to say" are different things, and used to
    // be the same one.
    const g = ship();
    assert.equal(stationReport(g, 'helm'), null);
    assert.equal(stationReport(g, 'no_such_station'), null);
    assert.equal(stationReport(g, null), null);
    assert.equal(stationReport(null, 'security'), null);
  });

  test('every one of them changes when the ship does', () => {
    // The property that makes a readout worth walking to. Checked on all four
    // together, because three that respond and one that prints a constant
    // would pass any per-station assertion written loosely enough.
    const whole = ship();
    const hurt = ship(beaten);
    for (const id of REPORTING_STATIONS) {
      assert.notEqual(said(whole, id), said(hurt, id),
        `${id} prints the same page on a fresh ship and a wrecked one`);
    }
  });

  test('life support counts the air, and says how long it lasts', () => {
    const g = ship((x) => { x.ship.subsystems.lifesupport = 0.4; });
    const s = said(g, 'environmental');
    assert.match(s, /40%/, s);
    assert.match(s, /hours of breathable air/, s);
    // And keeps quiet about the margin when there is no margin to worry about,
    // because a number printed every time is a number nobody reads.
    assert.doesNotMatch(said(ship(), 'environmental'), /hours of breathable air/);
    // Fires are compartments, so they belong on this board and nowhere else.
    assert.match(said(ship((x) => { x.ship.fires = 3; }), 'environmental'), /3 fires burning/);
    assert.doesNotMatch(said(ship(), 'environmental'), /burning/);
  });

  test('the security board says where they are, and it is not everywhere', () => {
    // The bug this found in the occupancy layer. A boarding party was placed
    // in every room it could possibly be in, so thirty intruders reported
    // contacts on all six locations — which tells a captain nothing and leaves
    // nowhere aboard that is clear.
    const clear = ship();
    assert.match(said(clear, 'security'), /No unauthorised personnel/);

    const small = ship((g) => { g.setAlert('red'); g.ship.boarders = 8; });
    const large = ship((g) => { g.setAlert('red'); g.ship.boarders = 40; });
    assert.match(said(small, 'security'), /INTRUDER ALERT/);
    assert.ok(boardedRooms(8).length < boardedRooms(40).length,
      'a party of forty has got no further than a party of eight');
    assert.ok(boardedRooms(8).length >= 1, 'a boarding party is nowhere at all');

    // The board and the corridor cannot disagree, and this has to read what
    // the BOARD ACTUALLY PRINTS. The first version compared `boardedRooms`
    // against `occupantsOf` — both sides of the occupancy layer — and never
    // looked at the console at all, so a board that named all six locations
    // regardless passed it.
    for (const g of [small, large]) {
      const named = boardedRooms(g.ship.boarders);
      const line = (stationReport(g, 'security').lines
        .find((l) => l.startsWith('Contacts on:')) ?? '')
        .replace('Contacts on:', '').replace(/\.$/, '').trim();
      const contacts = line ? line.split(',').map((x) => x.trim()) : [];
      assert.equal(contacts.length, named.length,
        `the board names ${contacts.length} places and they have got to ${named.length}`);
      // A small party has not reached the bridge, and the board must not say
      // it has.
      if (named.length < 6) {
        assert.doesNotMatch(line, /the bridge/,
          `a party of ${g.ship.boarders} is reported on the bridge: "${line}"`);
      }
      // And every room the occupancy layer puts intruders in is one the board
      // named, in both directions.
      for (const id of Object.keys(ROOMS)) {
        const there = occupantsOf(g, id).some((o) => o.intruder);
        assert.equal(there, named.includes(id),
          `${id}: the reach says ${named.includes(id)} and the room says ${there}`);
      }
    }
  });

  test('the doctor knows who is in his sickbay, by name', () => {
    const g = ship((x) => {
      x.crew.officers[2].injured = true;
      x.crew.officers[2].injurySeverity = 0.8;
    });
    const s = said(g, 'cmo_desk');
    assert.match(s, new RegExp(g.crew.officers[2].name), s);
    assert.match(s, /serious/, s);
    // The control: an officer who is fine is not on the list.
    assert.doesNotMatch(s, new RegExp(g.crew.officers[0].name), s);
    assert.match(said(ship(), 'cmo_desk'), /No officer is on the sick list/);
  });

  test('the doctor counts the dead as well as the hurt', () => {
    const whole = ship();
    assert.match(said(whole, 'cmo_desk'), /none of them lost/);
    const costly = ship((g) => { g.ship.crew = g.ship.maxCrew - 40; });
    assert.match(said(costly, 'cmo_desk'), /40 of the complement lost/);
  });

  test('gravity reads the auxiliary power the field draws from', () => {
    // Not a subsystem of its own — it hangs off auxiliary, which is exactly
    // the sort of thing standing at the console is for finding out.
    const g = ship((x) => { x.ship.subsystems.auxiliary = 0.3; });
    const s = said(g, 'gravity');
    assert.match(s, /flutter|failing/, s);
    assert.match(said(ship(), 'gravity'), /Nobody has noticed a thing/);
  });
});
