// Every station aboard, and what operating it actually opens.
//
// Three separate defects in three consecutive changes had the same shape: a
// station declared a `panel` key, `STATION_PANEL` in main.js aliased that key to
// a general screen, and the general screen was wrong for the room the station
// stands in.
//
//   biobed, medlab      medical -> crew    the personnel ROSTER, in sickbay
//   brig_control        damage  -> ship    hull integrity, in the brig
//   bay_doors           damage  -> ship    hull integrity, in the shuttlebay
//   rec_food            shop    -> shop    the MACHINE SHOP — hull patches,
//                                          torpedo casings, graviton charges —
//                                          from a food synthesiser, in the room
//                                          the deck plan calls "the one room
//                                          aboard that is not for working in"
//
// None of those keys was wrong everywhere. `damage -> ship` is right for the
// bridge damage-control board, the intermix monitor and the auxiliary damage
// board; `shop` is right for the machine shop itself. A key correct three times
// in four is exactly what a sweep records as fine and moves on from.
//
// So this file is not another sweep. It is the DECISION, written down: the full
// map of station to console, and for every console more than one station opens,
// the reason they share it. A new station cannot be added without landing in
// this table, and a share that is not justified here fails.
//
// Same purpose as the `role` note in `tests/classfields.test.js`: the next
// person to sweep for this pattern should find the reasoning, not the field.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ROOMS } from '../src/world/interiors.data.js';
import { REPORTING_STATIONS } from '../src/sim/consoles.js';

const MAIN = readFileSync('src/main.js', 'utf8');

/** `STATION_PANEL`, read off main.js rather than duplicated here. */
function aliases() {
  const start = MAIN.indexOf('const STATION_PANEL');
  const block = MAIN.slice(start, MAIN.indexOf('}', start) + 1);
  const out = {};
  for (const m of block.matchAll(/([a-z_]+)\s*:\s*'([a-z_]+)'/g)) out[m[1]] = m[2];
  assert.ok(Object.keys(out).length >= 12, 'STATION_PANEL is not where this test expects it');
  return out;
}

/** Every station aboard: `room.station` -> the console key it opens, or 'report'. */
function opens() {
  const alias = aliases();
  const out = {};
  for (const [rid, room] of Object.entries(ROOMS)) {
    for (const s of room.stations ?? []) {
      out[`${rid}.${s.id}`] = s.panel ? (alias[s.panel] ?? s.panel) : 'report';
    }
  }
  return out;
}

// Consoles that more than one station opens, and why that is right.
//
// The justification is the point of the table. "These four open the same panel"
// is a fact; "these four are all power boards" is a decision.
const SHARED = {
  power: {
    who: ['bridge.engineering', 'engineering.main_console', 'auxcontrol.aux_power'],
    why: 'three power boards, and the panel is the power distribution',
  },
  tactical: {
    who: ['bridge.weapons', 'armoury.weapons_locker', 'auxcontrol.aux_weapons'],
    why: 'two weapons boards and the armoury, which is a combat compartment: '
      + 'standing in it during a fight, the tactical plot is the thing you want',
  },
  ship: {
    who: ['bridge.damagecontrol', 'engineering.core_monitor', 'auxcontrol.aux_damage'],
    why: 'three damage boards, and the ship screen IS the subsystem readout. '
      + 'The brig and the bay doors used to be on this list and were the reason '
      + 'to write this file',
  },
  helm: {
    who: ['bridge.helm', 'auxcontrol.aux_helm'],
    why: 'the helm and the auxiliary helm, which is the same job from deck eight',
  },
  galaxy: {
    who: ['bridge.navigation', 'hangar.flight_control'],
    why: 'navigation, and flight control — where a flight would be planned from',
  },
  medical: {
    who: ['sickbay.biobed', 'sickbay.medlab'],
    why: 'both in the ward, and the ward has one sick list',
  },
  log: {
    who: ['quarters.desk', 'crewquarters.crew_terminal'],
    why: "the ship's log is a public record; a rating can read it from a desk "
      + 'terminal on deck three',
  },
  transport: {
    who: ['transporter.transporter_console', 'cargo.cargo_transporter'],
    why: 'two transporter pads, and the panel refuses for the same reasons at '
      + 'either — no orbit, nowhere below, already ashore',
  },
  crew: {
    who: ['briefing.briefing_terminal', 'rec.rec_terminal'],
    why: 'two terminals, and the roster is the same roster from either',
  },
  shop: {
    who: ['engineering.machine_shop', 'armoury.issue_desk', 'cargo.manifest'],
    why: 'the machine shop, and two places its STORES are the business of — '
      + 'the armoury issues from them and the cargo bay holds them. '
      + 'The food synthesiser used to be on this list',
  },
  report: {
    who: [
      'bridge.gravity', 'bridge.environmental', 'bridge.security', 'sickbay.cmo_desk',
      'brig.brig_control', 'hangar.bay_doors', 'rec.rec_food',
    ],
    why: 'not a console at all — seven stations that are places you ASK '
      + 'something, answered by sim/consoles.js',
  },
};

describe('every station aboard, and what it opens', () => {
  test('the table is the whole ship, with nothing left out', () => {
    // A new station cannot be added without landing here, which is the point:
    // the next one that would have quietly taken a wrong general screen has to
    // be argued for instead.
    const live = opens();
    const declared = new Set(Object.values(SHARED).flatMap((s) => s.who));
    const solo = Object.entries(live).filter(([id]) => !declared.has(id));

    // Everything not in the table opens a console only IT opens.
    const counts = {};
    for (const key of Object.values(live)) counts[key] = (counts[key] ?? 0) + 1;
    for (const [id, key] of solo) {
      assert.equal(counts[key], 1,
        `${id} shares "${key}" with another station and SHARED does not say why`);
    }
    assert.ok(Object.keys(live).length >= 34, `${Object.keys(live).length} stations`);
    assert.ok(solo.length >= 4, `only ${solo.length} stations have a console to themselves`);
  });

  test('and every share it declares is the share the ship has', () => {
    const live = opens();
    for (const [key, { who, why }] of Object.entries(SHARED)) {
      assert.ok(why && why.length > 25, `${key} is shared with no reason given`);
      const actual = Object.entries(live).filter(([, k]) => k === key).map(([id]) => id).sort();
      assert.deepEqual(actual, [...who].sort(),
        `"${key}" is opened by a different set of stations than the table says`);
    }
  });

  test('and the four that were wrong are not wrong any more', () => {
    // Named individually, because a set comparison passes just as happily when
    // two stations swap their mistakes.
    const live = opens();
    assert.equal(live['sickbay.biobed'], 'medical');
    assert.equal(live['sickbay.medlab'], 'medical');
    assert.equal(live['brig.brig_control'], 'report');
    assert.equal(live['hangar.bay_doors'], 'report');
    assert.equal(live['rec.rec_food'], 'report');
    // And the keys they used to resolve to still exist and are still correct
    // for the stations that legitimately use them — the fix was not to delete
    // the alias.
    assert.equal(live['bridge.damagecontrol'], 'ship');
    assert.equal(live['engineering.machine_shop'], 'shop');
  });

  test('and every station answered by a report really has no panel', () => {
    // The invariant `tests/consoles.test.js` rests on, checked from this side
    // too: a station either opens a panel or reports, never both, or the panel
    // wins in `useWhatIsInFront` and the report is dead code.
    const live = opens();
    const reporting = Object.entries(live).filter(([, k]) => k === 'report').map(([id]) => id);
    assert.deepEqual(reporting.sort(), [...SHARED.report.who].sort());
    for (const id of reporting) {
      const [rid, sid] = id.split('.');
      const st = (ROOMS[rid].stations ?? []).find((s) => s.id === sid);
      assert.equal(st.panel, null, `${id} declares a panel and a report`);
      assert.ok(REPORTING_STATIONS.includes(sid), `${id} has no report behind it`);
    }
  });
});

describe('the one this file was written for', () => {
  test('the rec deck is not a workshop, and its own deck plan says so', () => {
    // The contradiction, stated as the thing that must not come back. The
    // machine shop makes hull patches, torpedo casings, graviton charges and a
    // coolant purge; nothing on that list is edible.
    const plan = readFileSync('src/world/interiors.data.js', 'utf8');
    const rec = plan.slice(plan.indexOf("id: 'rec',"), plan.indexOf("id: 'crewquarters',"));
    assert.match(rec, /not for working in/,
      'the comment that makes this a contradiction is gone');
    assert.doesNotMatch(rec, /rec_food[^\n]*panel: 'shop'/,
      'the food synthesiser opens the machine shop again');
  });
});
