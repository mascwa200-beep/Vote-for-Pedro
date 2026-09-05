// The episode that happens aboard.
//
// RESEARCH §69 counted every scene in the book against the seventeen
// compartments a captain can walk to. Seven stages of a hundred and nineteen
// named a room, and TEN ROOMS had never hosted a scene at all: the captain's
// own quarters, crew quarters, the rec deck, cargo, the hangar, auxiliary
// control, the turbolift and all three corridors.
//
// That is not a defect in those rooms. It is what happens when every episode is
// written as a thing the ship ARRIVES AT. Twenty-four of them are about a
// system, a border, a hearing or a hull, and the bridge is where a captain
// deals with all of those — so the bridge is where they all are.
//
// `long_watch` is about the ship. Its first stage is anchored to a star system
// and every stage after it sets `system: null`, which `Mission.stageLocation`
// has supported since it was written and which nothing had ever used: the ship
// goes on with its transit while the captain walks his own decks.
//
// These tests are about the two properties that make it worth having.
//
// FIRST, it has to be WALKABLE — nine stages across seven compartments on six
// decks, and if any leg of that is unreachable the episode strands the player
// somewhere between deck three and deck eleven. Walked, not looked up.
//
// SECOND, it has to REMEMBER. Four flags, all four gated on, three of them by
// the finale — because an episode about what a captain writes in his own log is
// worth nothing if the board that reads that log never mentions it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';
import { EPISODES, EPISODE_BY_ID } from '../src/missions/episodes/index.js';
import { LONG_WATCH_EPISODES } from '../src/missions/episodes/longwatch.js';
import { ROOMS } from '../src/world/interiors.data.js';

const EP = LONG_WATCH_EPISODES[0];

function captain({ seed = 21n, flags = [] } = {}) {
  const g = new Game({
    seed, crewMode: 'original',
    character: new Character({ speciesId: 'human', careerId: 'command' }),
    shipClass: 'constitution',
  });
  while (g.progress.nextRank) g.progress.addXP(200000, { ledger: g.ledger });
  for (const f of flags) g.ledger.setFlag(f);
  return g;
}

/**
 * Fly and walk to wherever the current stage is.
 *
 * Called before READING the choices as well as before taking one. The first
 * draft of this file only walked inside `play`, so every test that inspected
 * `m.choices()` after arriving at a new stage was inspecting them from the
 * previous room — where the room gate locks all of them — and read "the gated
 * choice is absent" from a list that was empty for a different reason. The same
 * mistake `tests/episodevars.test.js` was making, found the same way.
 */
function stand(g, m) {
  const there = m.testLocation();
  if (!there.ok) g.locationId = there.need;
  const inside = m.testWhere();
  if (!inside.ok && inside.need && inside.need !== 'surface') {
    g.goToRoom(inside.need);
    for (let n = 0; n < 20000 && g.walkOrder; n++) g.update(1 / 30);
    assert.equal(g.walk.roomId, inside.need, `could not reach ${inside.need}`);
  }
}

/** What the captain can take, standing where the scene is. */
const openHere = (g, m) => {
  stand(g, m);
  return m.choices().filter((c) => !c.locked).map((c) => c.id);
};

/** Fly and walk to wherever the current stage is, then take a choice. */
function play(g, m, id) {
  stand(g, m);
  const open = m.choices().filter((c) => !c.locked).map((c) => c.id);
  assert.ok(open.includes(id), `${m.stageId}: "${id}" is locked; open: ${open.join(',')}`);
  g.chooseMission(id);
  return open;
}

const start = (g) => {
  const m = g.missions.start('long_watch', g);
  g.locationId = EP.system;
  return m;
};

describe('an episode about the ship rather than about somewhere', () => {
  test('only its first stage is anchored to a star system', () => {
    // The mechanism that lets it happen aboard. `stageLocation` returns
    // `stage.system` when the KEY is present — so an explicit null means "the
    // ship can be anywhere", which is the whole difference between an
    // investigation and a destination.
    assert.equal(EP.system, 'deep_1');
    const anchored = [];
    const loose = [];
    for (const [sid, stage] of Object.entries(EP.stages)) {
      if (Object.prototype.hasOwnProperty.call(stage, 'system')) {
        assert.equal(stage.system, null, `${sid} names a system of its own`);
        loose.push(sid);
      } else anchored.push(sid);
    }
    assert.deepEqual(anchored, ['start'], `anchored: ${anchored.join(', ')}`);
    assert.ok(loose.length >= 8, `only ${loose.length} stages are free of the chart`);
  });

  test('and the ship really is free to move once it has started', () => {
    // The control. If `system: null` were ignored, the episode would fall back
    // to the episode's own system and every stage after the first would demand
    // the ship stay at Deep Space 1 for six weeks.
    const g = captain();
    const m = start(g);
    play(g, m, 'go');
    g.locationId = 'sol';
    assert.equal(m.testLocation().ok, true,
      'the investigation is pinned to the system it started in');
  });

  test('and it uses five compartments the book had never used', () => {
    const usedElsewhere = new Set();
    for (const ep of EPISODES) {
      if (ep.id === EP.id) continue;
      for (const s of Object.values(ep.stages ?? {})) {
        if (s.where && s.where !== 'anywhere' && s.where !== 'surface') usedElsewhere.add(s.where);
      }
    }
    const mine = new Set();
    for (const s of Object.values(EP.stages)) {
      if (s.where && s.where !== 'anywhere' && s.where !== 'surface') mine.add(s.where);
    }
    const fresh = [...mine].filter((r) => !usedElsewhere.has(r)).sort();
    assert.deepEqual(fresh, ['auxcontrol', 'cargo', 'crewquarters', 'quarters', 'rec'],
      `fresh rooms: ${fresh.join(', ')}`);
    for (const r of mine) assert.ok(ROOMS[r], `${r} is not a compartment of this ship`);
  });
});

describe('and every deck of it can actually be reached', () => {
  test('the long route plays end to end, through all seven compartments', () => {
    // Walked, not looked up. Nine stages on six decks: a leg that cannot be
    // made strands the player halfway through his own ship.
    const g = captain();
    const m = start(g);
    const rooms = [];
    for (const id of ['go', 'trace', 'stores', 'bunk', 'read', 'ask', 'charge', 'hold', 'both']) {
      play(g, m, id);
      rooms.push(g.walk.roomId);
    }
    assert.equal(m.complete, true, `stranded at ${m.stageId}`);
    assert.ok(new Set(rooms).size >= 7, `only visited ${new Set(rooms).size} compartments`);
    // And the corridors and the lift are what got him there, which is what
    // §69 says corridors are for.
    assert.ok(rooms.includes('quarters'), 'never reached the captain’s own quarters');
  });

  test('and so does the short one, which skips most of the ship', () => {
    // A player who does not want to walk the decks is not forced to. The
    // shortest honest route is bridge, engineering, auxiliary control, and the
    // desk in your quarters.
    const g = captain();
    const m = start(g);
    for (const id of ['go', 'trace', 'wait', 'stop', 'truth']) play(g, m, id);
    assert.equal(m.complete, true, `stranded at ${m.stageId}`);
  });

  test('and the shortest of all never leaves the bridge', () => {
    // "It is eleven minutes. Let it alone." An episode that can only be
    // finished by walking six decks is an episode a player can be trapped in.
    const g = captain();
    const m = start(g);
    assert.equal(g.walk.roomId, 'bridge');
    play(g, m, 'ignore');
    assert.equal(m.complete, true);
    assert.equal(g.walk.roomId, 'bridge', 'the way out of it required a walk');
  });
});

describe('the two things you can only learn by being there', () => {
  test('the letter is what makes her a person rather than a breach', () => {
    const stage = EP.stages.middle_watch;
    const gated = stage.choices.find((c) => c.id === 'sit');
    assert.ok(gated, 'the choice that reads the letter is gone');
    assert.deepEqual(gated.requires, { var: { read_the_letter: true } });

    // Reached without reading it: the choice is not on offer.
    const g = captain();
    const m = start(g);
    for (const id of ['go', 'trace', 'stores', 'bunk', 'leave', 'ask']) play(g, m, id);
    assert.equal(m.stageId, 'middle_watch');
    const without = openHere(g, m);
    assert.equal(without.includes('sit'), false, 'offered to a captain who left it alone');
    assert.ok(without.length >= 2, `nothing else is open either: ${without.join(',')}`);
  });

  test('and sitting in the dark is the only way to see her check first', () => {
    // `sat_in_the_dark` was written by three different routes and read by
    // nothing in the first draft — the exact defect `tests/episodevars.test.js`
    // exists for, walked into again while writing the episode that is about
    // not overlooking things. It gates this.
    const g = captain();
    const m = start(g);
    for (const id of ['go', 'trace', 'wait']) play(g, m, id);
    assert.equal(m.stageId, 'middle_watch');
    assert.ok(openHere(g, m).includes('watched'));

    const other = captain();
    const m2 = start(other);
    for (const id of ['go', 'trace', 'stores', 'deck', 'ask']) play(other, m2, id);
    assert.equal(m2.stageId, 'middle_watch');
    assert.equal(openHere(other, m2).includes('watched'), false,
      'offered to a captain who came in by the door');
  });
});

describe('and the board that reads your log actually reads it', () => {
  const finale = EPISODE_BY_ID.homecoming;
  const gatedOn = (flag) => {
    const out = [];
    for (const [sid, stage] of Object.entries(finale.stages)) {
      for (const c of stage.choices ?? []) if (c.requires?.flag === flag) out.push(`${sid}/${c.id}`);
    }
    return out;
  };

  test('three of its four flags are read at the finale, and the fourth in itself', () => {
    // An episode about what a captain writes down is worth nothing if the
    // board reviewing his command never mentions it.
    assert.deepEqual(gatedOn('logged_the_watch'), ['questioned/watch']);
    assert.deepEqual(gatedOn('logged_a_fault'), ['questioned/the_fault']);
    assert.deepEqual(gatedOn('the_watch_stood'), ['commended/watch']);
    // The fourth chains inside the episode: letting the carrier go is what
    // opens the entry in which the breach is yours.
    const own = EP.stages.the_write_up.choices.find((c) => c.id === 'mine');
    assert.ok(own, 'the entry that takes the breach on yourself is gone');
    assert.deepEqual(own.requires, { flag: 'let_the_signal_go' });
  });

  test('and that entry is really unreachable without letting the signal go', () => {
    // The control: a `requires` the engine ignored would leave the choice on
    // screen for everybody and the assertion above would still pass.
    const g = captain();
    const m = start(g);
    for (const id of ['go', 'trace', 'wait', 'stop']) play(g, m, id);
    assert.equal(m.stageId, 'the_write_up');
    const without = openHere(g, m);
    assert.equal(without.includes('mine'), false,
      'offered to a captain who took the case off her');

    const g2 = captain();
    const m2 = start(g2);
    for (const id of ['go', 'trace', 'wait', 'finish']) play(g2, m2, id);
    assert.equal(m2.stageId, 'the_write_up');
    const with_ = openHere(g2, m2);
    assert.ok(with_.includes('mine'), 'withheld from a captain who stood there while it went');
    assert.ok(with_.length > without.length, 'the flag changed nothing');
  });

  test('and taking the breach on yourself costs you standing, not gains it', () => {
    // The shape of the decision. If the humane choice were also the profitable
    // one it would not be a decision, and this episode would be a reward for
    // reading the flavour text.
    const own = EP.stages.the_write_up.choices.find((c) => c.id === 'mine');
    const plain = EP.stages.the_write_up.choices.find((c) => c.id === 'truth');
    assert.ok(own.effects.standing.federation < 0,
      `taking the blame paid ${own.effects.standing.federation}`);
    assert.ok(plain.effects.standing.federation > 0);
    assert.ok(own.effects.xp > plain.effects.xp, 'and it is not worth doing at all');
  });
});
