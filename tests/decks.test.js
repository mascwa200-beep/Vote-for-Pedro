// Every ship in the game wore a Constitution's deck plan.
//
// `DIMENSIONS.decks` — thirty-one records, one per hull, published figures with
// a source in RESEARCH §13 — was written and read by nothing. The interior is
// one fixed plan of eight decks numbered 1 to 19, and it did not vary by class,
// so the number a captain read was the Constitution's whatever they were
// flying:
//
//     oberth       8 decks   walked to "Deck 11 — Engineering" and "Deck 19"
//     defiant      4 decks   eleven rooms below the keel
//     runabout     1 deck    fifteen, including a hangar deck and a brig
//
// The Oberth is not a corner case: it is the bottom rung of COMMAND_LADDER, the
// ship a career starts on. The runabout is worse — `commandableAt` puts it on
// sale at TIER ONE, so a captain can walk into any shipyard on their first day,
// take a twenty-three-metre ship with a crew of four, and ride a turbolift to
// deck nineteen.
//
// Renumbering, not removal. A Defiant has an engine room; it does not have one
// on deck 11. What was wrong was the number, and the number is the part the
// captain reads.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Game } from '../src/core/state.js';
import {
  ROOM_LIST, ROOMS, DECKS, PLAN_DECKS, LIFT_STOPS, deckPlanFor, deckLabelFor,
} from '../src/world/interiors.data.js';
import { SHIP_CLASSES, commandableAt } from '../src/world/ships.data.js';
import { DIMENSIONS } from '../src/gfx/blueprint.js';

/** Every hull the player can actually be standing on. */
const PLAYABLE = commandableAt(9).map((c) => c.id);

describe('the published deck count is a real number now', () => {
  test('every class carries it, and it agrees with the figure the renderer uses', () => {
    // Two copies, held together, exactly as `crew` already is — the blueprint
    // file's own rule is that a duplicated number is a number that disagrees
    // eventually, and the answer this repo already reached is a test, not a
    // second lookup path.
    const ids = Object.keys(SHIP_CLASSES);
    assert.equal(ids.length, 31, `${ids.length} classes`);
    for (const id of ids) {
      assert.ok(Number.isInteger(SHIP_CLASSES[id].decks),
        `${id}.decks is ${SHIP_CLASSES[id].decks}`);
      assert.equal(SHIP_CLASSES[id].decks, DIMENSIONS[id].decks,
        `${id}: ships.data says ${SHIP_CLASSES[id].decks}, dimensions say ${DIMENSIONS[id].decks}`);
    }
  });

  test('and the hulls a captain can command run from 1 deck to 42', () => {
    // The denominator. If this ever collapses to one hull size the tests below
    // are comparing a ship with itself.
    assert.ok(PLAYABLE.length >= 10, `${PLAYABLE.length} commandable hulls`);
    const counts = PLAYABLE.map((id) => SHIP_CLASSES[id].decks);
    assert.ok(Math.min(...counts) <= 4, `smallest command has ${Math.min(...counts)} decks`);
    assert.ok(Math.max(...counts) >= 40, `largest command has ${Math.max(...counts)} decks`);
  });
});

describe('no room is below the keel of the ship it is on', () => {
  test('on every hull the player can command', () => {
    // The defect, stated as the thing that must never be true again. Measured
    // through `Game.deckOf`, the door the screens ask through.
    const bad = [];
    let checked = 0;
    for (const id of PLAYABLE) {
      const g = new Game({ seed: 4n, crewMode: 'original', shipClass: id });
      for (const room of ROOM_LIST) {
        if (room.deck == null) continue;
        checked++;
        const d = g.deckOf(room);
        if (d > SHIP_CLASSES[id].decks || d < 1) {
          bad.push(`${id}(${SHIP_CLASSES[id].decks} decks).${room.id} on deck ${d}`);
        }
      }
    }
    assert.ok(checked > 150, `only ${checked} room-hull pairs checked`);
    assert.deepEqual(bad, []);
  });

  test('and the control: the raw plan really does go below several of them', () => {
    // Without this the test above passes on a plan that never exceeded any
    // hull, and proves nothing. The raw `room.deck` is what shipped.
    const over = [];
    for (const id of PLAYABLE) {
      const n = SHIP_CLASSES[id].decks;
      const deep = ROOM_LIST.filter((r) => r.deck != null && r.deck > n);
      if (deep.length) over.push(`${id}:${deep.length}`);
    }
    assert.ok(over.length >= 3,
      `the unrenumbered plan overran only ${over.length} hulls (${over.join(' ')})`);
  });
});

describe('the renumbering keeps the ship a ship', () => {
  test('the bridge is deck 1 on everything that floats', () => {
    for (const id of PLAYABLE) {
      const g = new Game({ seed: 4n, crewMode: 'original', shipClass: id });
      assert.equal(g.deckOf('bridge'), 1, `${id} has its bridge below deck 1`);
    }
  });

  test('and nothing overtakes anything: the order down the ship never changes', () => {
    const order = [...PLAN_DECKS];
    for (const id of PLAYABLE) {
      const map = deckPlanFor(SHIP_CLASSES[id].decks);
      let last = 0;
      for (const d of order) {
        const got = map.get(d);
        assert.ok(got >= last, `${id}: plan deck ${d} came out above the deck before it`);
        last = got;
      }
    }
  });

  test('and rooms that share a deck on a Constitution share one everywhere', () => {
    // Deck 7 is transporters, armoury, brig and cargo. They are one space on a
    // small ship too — what they must never be is scattered.
    const groups = new Map();
    for (const r of ROOM_LIST) {
      if (r.deck == null) continue;
      if (!groups.has(r.deck)) groups.set(r.deck, []);
      groups.get(r.deck).push(r.id);
    }
    const shared = [...groups.values()].filter((g) => g.length > 1);
    assert.ok(shared.length >= 2, `only ${shared.length} decks hold more than one room`);
    for (const id of PLAYABLE) {
      const g = new Game({ seed: 4n, crewMode: 'original', shipClass: id });
      for (const roomIds of shared) {
        const decks = new Set(roomIds.map((r) => g.deckOf(r)));
        assert.equal(decks.size, 1, `${id}: ${roomIds.join('/')} came apart onto ${[...decks]}`);
      }
    }
  });

  test('and a Constitution is untouched, because those numbers are the ones people know', () => {
    const g = new Game({ seed: 4n, crewMode: 'original', shipClass: 'constitution' });
    for (const r of ROOM_LIST) {
      if (r.deck == null) continue;
      assert.equal(g.deckOf(r), r.deck, `${r.id} moved on a Constitution`);
    }
    // And so is everything with room for the plan as written.
    for (const id of ['excelsior', 'galaxy', 'sovereign', 'ambassador', 'nebula']) {
      const big = new Game({ seed: 4n, crewMode: 'original', shipClass: id });
      assert.equal(big.deckOf('engineering'), ROOMS.engineering.deck, `${id} renumbered needlessly`);
    }
  });

  test('and hulls of different sizes get different plans', () => {
    // The bug in the first draft: spreading the eight levels by INDEX put a
    // Miranda's engineering, a Constellation's and an Intrepid's all on deck 7
    // — twelve, fourteen and fifteen decks with an identical plan, which is the
    // flatness this is supposed to fix. Scaling by depth instead.
    const seen = new Map();
    for (const id of ['defiant', 'oberth', 'miranda', 'constellation', 'intrepid']) {
      const key = PLAN_DECKS.map((d) => deckPlanFor(SHIP_CLASSES[id].decks).get(d)).join(',');
      seen.set(id, key);
    }
    assert.equal(new Set(seen.values()).size, seen.size,
      `hulls sharing a plan: ${[...seen].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  });

  test('and the deepest room lands on the keel of a small ship, not halfway up', () => {
    // A hangar deck is the bottom of the ship. On a hull too small for the
    // plan's own numbers it should still be the bottom.
    for (const id of ['defiant', 'oberth', 'miranda']) {
      const n = SHIP_CLASSES[id].decks;
      assert.equal(deckPlanFor(n).get(PLAN_DECKS[PLAN_DECKS.length - 1]), n,
        `${id}: the lowest deck in the plan is not the lowest deck of the ship`);
    }
  });
});

describe('the label a captain reads', () => {
  test('carries the renumbered deck and keeps the name', () => {
    assert.equal(deckLabelFor(19, 23), DECKS[19]);
    assert.match(deckLabelFor(19, 4), /^Deck 4 — Hangar deck$/);
    assert.match(deckLabelFor(11, 8), /^Deck \d+ — Engineering$/);
  });

  test('and the game answers through one function, not one per screen', () => {
    const g = new Game({ seed: 4n, crewMode: 'original', shipClass: 'defiant' });
    for (const r of ROOM_LIST) {
      if (r.deck == null) continue;
      assert.equal(g.deckLabel(r), deckLabelFor(r.deck, 4), `${r.id}`);
      assert.ok(g.deckLabel(r).startsWith(`Deck ${g.deckOf(r)} `),
        `${r.id}: the label and the number disagree`);
    }
  });

  test('and a room with no deck answers null rather than "Deck undefined"', () => {
    // The turbolift is the one room that is not on a deck, because it is how
    // you change decks.
    const g = new Game({ seed: 4n, crewMode: 'original', shipClass: 'oberth' });
    assert.equal(ROOMS.turbolift.deck, 1, 'the lift stopped being on deck 1, so this proves nothing');
    assert.equal(g.deckOf('no_such_room'), null);
    assert.equal(g.deckLabel('no_such_room'), null);
  });
});

describe('the turbolift tells you which deck it is going to', () => {
  test('every stop it serves has a deck on this hull', () => {
    assert.ok(LIFT_STOPS.length >= 6, `${LIFT_STOPS.length} lift stops`);
    for (const id of PLAYABLE) {
      const g = new Game({ seed: 4n, crewMode: 'original', shipClass: id });
      for (const s of LIFT_STOPS) {
        const label = g.deckLabel(s.to);
        assert.ok(label, `${id}: the lift offers ${s.to} with no deck`);
        assert.ok(g.deckOf(s.to) <= SHIP_CLASSES[id].decks,
          `${id}: the lift offers ${s.to} below the keel`);
      }
    }
  });

  test('and the lift control panel is a panel, not the default branch', () => {
    // `lift_control` is the only station in the turbolift and the reason the
    // compartment has a console. Its case sat alongside `default:` and answered
    // "Working, Captain."
    //
    // It passed `tests/audit.test.js` because that guard collects `case '<id>':`
    // labels out of the switch — the same failure as the sound-cue guard, which
    // was satisfied by `case 'cloak':` in the order dispatcher. A case label is
    // not a panel.
    const main = readFileSync('src/main.js', 'utf8');
    const i = main.indexOf("case 'turbolift':");
    assert.ok(i > 0, 'the turbolift console case is gone');
    const branch = main.slice(i, i + 900);
    assert.doesNotMatch(branch.slice(0, branch.indexOf('break;')), /default:/,
      'the turbolift console is sharing the default branch again');
    assert.match(branch, /liftStops\(\)/, 'the lift control panel offers no stops');
    assert.match(branch, /deckLabel\(/, 'the lift control panel names no decks');
  });

  test('and the station that opens it is really in the lift', () => {
    const lift = ROOMS.turbolift;
    assert.ok(lift.lift, 'the turbolift is not marked as a lift');
    const st = (lift.stations ?? []).find((s) => s.panel === 'turbolift');
    assert.ok(st, 'no station in the lift opens the turbolift panel');
  });
});
