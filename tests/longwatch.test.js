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

// And what the captain did in an EARLIER EPISODE.
//
// Everything above is about what this episode can learn about itself — the
// letter, the dark room. §107 found the other half missing across the whole
// book: thirty flags recorded deeds and were read by nothing, and `long_watch`
// gated three choices, all three on its own variables. It knew everything about
// its own night and nothing about the four acts behind it.
//
// Two of the thirty are about the same thing this episode is about — the gap
// between the record and the person — and both are act 2:
//
//   marru_left  Rigel. "Break orbit and file it", and the ending is called
//               `left_her`. You turned somebody into paperwork.
//   vell_lost   Wolf 359. The pod stopped at its last stage, Lieutenant
//               Commander Aris Vell never woke, and you entered her name in the
//               log yourself rather than have it done for you.
describe('and it reads what you did before you ever heard of Marchetti', () => {
  const toMiddleWatch = ['go', 'trace', 'stores', 'bunk', 'leave', 'ask'];

  test('the captain who filed Marru away is the one who thinks to ask', () => {
    const gated = EP.stages.middle_watch.choices.find((c) => c.id === 'her_words');
    assert.ok(gated, 'the choice that asks her is gone');
    assert.deepEqual(gated.requires, { flag: 'marru_left' });

    const g = captain();
    const m = start(g);
    for (const id of toMiddleWatch) play(g, m, id);
    assert.equal(m.stageId, 'middle_watch');
    assert.equal(openHere(g, m).includes('her_words'), false,
      'offered to a captain who never left anybody at Rigel');

    const did = captain({ flags: ['marru_left'] });
    const m2 = start(did);
    for (const id of toMiddleWatch) play(did, m2, id);
    assert.ok(openHere(did, m2).includes('her_words'), 'Rigel bought nothing');
  });

  test('the captain who wrote Vell into a log knows what a name in one is worth', () => {
    const gated = EP.stages.the_write_up.choices.find((c) => c.id === 'like_vell');
    assert.ok(gated, 'the choice that writes her name properly is gone');
    assert.deepEqual(gated.requires, { flag: 'vell_lost' });

    const g = captain();
    const m = start(g);
    for (const id of [...toMiddleWatch, 'stop']) play(g, m, id);
    assert.equal(m.stageId, 'the_write_up');
    assert.equal(openHere(g, m).includes('like_vell'), false,
      'offered to a captain who never wrote that entry');

    const did = captain({ flags: ['vell_lost'] });
    const m2 = start(did);
    for (const id of [...toMiddleWatch, 'stop']) play(did, m2, id);
    assert.equal(m2.stageId, 'the_write_up');
    assert.ok(openHere(did, m2).includes('like_vell'), 'Wolf 359 bought nothing');
  });

  test('and asking her is read at the desk, not written and forgotten', () => {
    // This file's own header records walking into exactly that defect while
    // writing the episode about not overlooking things: `sat_in_the_dark` was
    // written by three routes and read by none. `she_was_asked` is set by one
    // choice and it had better be the reason another one opens.
    const did = captain({ flags: ['marru_left'] });
    const m = start(did);
    for (const id of toMiddleWatch) play(did, m, id);
    play(did, m, 'her_words');
    assert.equal(m.stageId, 'the_write_up');
    assert.equal(m.vars.she_was_asked, true, 'asking her set nothing');
    assert.ok(openHere(did, m).includes('her_account'), 'she was asked and it changed no entry');

    // The same captain, who took the case instead of asking.
    const other = captain({ flags: ['marru_left'] });
    const m2 = start(other);
    for (const id of [...toMiddleWatch, 'stop']) play(other, m2, id);
    assert.equal(m2.stageId, 'the_write_up');
    assert.equal(openHere(other, m2).includes('her_account'), false,
      'her account was on offer to a captain who never asked for it');
  });

  test('a road that closed at Rigel does not tell the captain to come back later', () => {
    // §108: 29 of the book's 36 flag gates ask for a deed from an earlier
    // episode, where "Not yet available" is a promise nothing can keep.
    const g = captain();
    const m = start(g);
    for (const id of toMiddleWatch) play(g, m, id);
    // Standing in the room first. Reading the choices from the corridor gives
    // every one of them the room's lock reason — the mistake this file's header
    // records, walked into again by the test asserting on lock reasons.
    stand(g, m);
    const shut = m.choices().find((c) => c.id === 'her_words');
    assert.equal(shut.locked, true);
    assert.match(shut.lockReason, /record/i,
      `a road that closed at Rigel says "${shut.lockReason}"`);
  });
});
