// Twenty-six of forty-three systems hosted nothing, and Act 5 held one episode.
//
// Among the empty ones were two places the map had already written an episode's
// worth of description for and never put an episode in:
//
//     Cardassia Prime   "Central Command, the Obsidian Order, and a customs
//                        process designed as an interrogation."
//     Khitomer          "Neutral ground, chosen because both empires could
//                        reach it and neither could hold it."
//
// Both of these follow from earlier episodes, the way the capitals do — the
// Terok Nor treaty (Act 3) pays into Cardassia (Act 4), and the Great Hall
// (Act 4) pays into Khitomer (Act 5). Act 5 was the finale on its own.
//
// The rule this file exists to hold, which is the one the last three PRs were
// all about: NEW CONTENT MAY NOT WRITE A FLAG NOTHING READS. Forty-one of the
// book's fifty-seven are still write-only and that is a known debt; adding to
// it while shipping a PR about it would be indefensible.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';
import { EPISODES } from '../src/missions/episodes/index.js';
import { ACCORD_EPISODES } from '../src/missions/episodes/accords.js';
import { SYSTEMS } from '../src/world/systems.data.js';

/** A flag officer, optionally carrying what an earlier episode gave them. */
function captain({ seed = 6n, flags = [] } = {}) {
  const g = new Game({
    seed,
    crewMode: 'original',
    character: new Character({ speciesId: 'human', careerId: 'command' }),
    shipClass: 'excelsior',
  });
  // One rank per call — `addXP` promotes at most once however much you hand it.
  while (g.progress.nextRank) g.progress.addXP(200000, { ledger: g.ledger });
  for (const f of flags) g.ledger.setFlag(f);
  return g;
}

/** Every flag anything in the book reads, by any of the four ways it can. */
function flagsRead() {
  const read = new Set();
  for (const ep of EPISODES) {
    if (ep.requiresFlag) read.add(ep.requiresFlag);
    if (ep.blockedByFlag) read.add(ep.blockedByFlag);
    for (const stage of Object.values(ep.stages ?? {})) {
      for (const choice of stage.choices ?? []) {
        for (const key of ['requires', 'hidden']) {
          if (choice[key]?.flag) read.add(choice[key].flag);
          if (choice[key]?.notFlag) read.add(choice[key].notFlag);
        }
      }
    }
  }
  for (const list of Object.values(Game.FACTION_MEMORY)) {
    for (const e of list) read.add(e.flag);
  }
  return read;
}

/** Every flag a given set of episodes writes — choices AND endings. */
function flagsWritten(episodes) {
  const written = new Set();
  for (const ep of episodes) {
    for (const stage of Object.values(ep.stages ?? {})) {
      for (const choice of stage.choices ?? []) {
        for (const f of [].concat(choice.effects?.flag ?? [])) written.add(f);
      }
    }
    // Endings too. Seven of the book's flags are set here and nowhere else,
    // and an inventory that walks choices only will accuse the code of
    // inventing them — see RESEARCH.md §45.
    for (const ending of Object.values(ep.endings ?? {})) {
      for (const f of [].concat(ending.effects?.flag ?? [])) written.add(f);
    }
  }
  return written;
}

describe('two worlds that had a description and no episode', () => {
  test('they are where the map says they are', () => {
    const by = Object.fromEntries(SYSTEMS.map((s) => [s.id, s]));
    assert.equal(by.cardassia_prime.faction, 'cardassian');
    assert.equal(by.khitomer.faction, 'independent');
    for (const ep of ACCORD_EPISODES) {
      assert.ok(by[ep.system], `${ep.id} is set at a system that does not exist`);
    }
  });

  test('and the book is two episodes longer and one act less thin', () => {
    assert.equal(EPISODES.length, 24);
    const byAct = {};
    for (const e of EPISODES) byAct[e.act] = (byAct[e.act] ?? 0) + 1;
    assert.ok(byAct[5] >= 2, `Act 5 still has ${byAct[5]} episode(s) in it`);
    assert.equal(new Set(EPISODES.map((e) => e.system)).size, 23);
  });
});

describe('each one follows from something the captain actually did', () => {
  test('offered only to a captain who earned it', () => {
    // Through `availableAt`, which is the door the briefing room and the map
    // marker both read. `missions.start` deliberately does not check this, so
    // asserting on `start` would prove nothing.
    for (const [id, flag, system] of [
      ['cardassia_debt', 'torvan_owes_you', 'cardassia_prime'],
      ['khitomer_accord', 'qonos_upheld', 'khitomer'],
    ]) {
      const without = captain();
      assert.ok(!without.missions.availableAt(system, without).some((e) => e.id === id),
        `${id} was offered to a captain who never earned it`);
      const with_ = captain({ flags: [flag] });
      assert.ok(with_.missions.availableAt(system, with_).some((e) => e.id === id),
        `${id} was withheld from a captain carrying ${flag}`);
    }
  });

  test('and the episode that pays for it comes strictly earlier', () => {
    // A chain that needs a flag from a LATER act is a chain nobody can walk.
    const paidBy = (flag) => EPISODES.filter((ep) =>
      flagsWritten([ep]).has(flag)).map((ep) => ep.act);
    for (const ep of ACCORD_EPISODES) {
      const acts = paidBy(ep.requiresFlag);
      assert.ok(acts.length, `nothing sets ${ep.requiresFlag}`);
      assert.ok(Math.min(...acts) < ep.act,
        `${ep.id} is act ${ep.act} and needs a flag first paid in act ${Math.min(...acts)}`);
    }
  });
});

describe('and neither of them writes anything down that nobody reads', () => {
  test('every flag the new episodes set is read by something', () => {
    // The rule for new content, and the whole point of the three PRs before
    // this one. The first draft of these two episodes set six flags nothing
    // anywhere read — `quoted_the_clause`, `named_the_source`,
    // `torvan_owes_you_nothing`, `named_the_house` and two more — which is the
    // exact defect I had just written a PR about. Three were deleted, and
    // three became things the game consults.
    const written = flagsWritten(ACCORD_EPISODES);
    const read = flagsRead();
    assert.ok(written.size >= 5, `only ${written.size} flags to check`);
    const dead = [...written].filter((f) => !read.has(f)).sort();
    assert.deepEqual(dead, []);
  });

  test('and three of them are things a faction now remembers', () => {
    const g = captain();
    for (const [flag, faction] of [
      ['torvan_clear', 'cardassian'],
      ['khitomer_signed', 'klingon'],
      ['kang_owes_you', 'klingon'],
    ]) {
      const before = g.factionMemory(faction).weight;
      g.ledger.setFlag(flag);
      assert.ok(g.factionMemory(faction).weight > before,
        `${flag} changed nothing about how the ${faction} answer a channel`);
    }
  });
});

describe('the endgame at Khitomer is gated on what you went and found out', () => {
  const khitomer = ACCORD_EPISODES.find((e) => e.id === 'khitomer_accord');
  const ninth = khitomer.stages.ninth;

  test('a captain who never went down to the brig can only sign eight pages', () => {
    // The cost of handing the prisoner over and staying at the table. You
    // cannot speak to a page you did not read or name a house nobody told you
    // about — and exactly one route is left, which is what makes the choice
    // to go down there matter.
    const open = ninth.choices.filter((c) => !c.requires);
    assert.deepEqual(open.map((c) => c.id), ['neither']);
    assert.equal(open[0].outcome, 'eight_pages');
  });

  test('and one who did has all four', () => {
    const learned = new Set(['read_the_ninth', 'khitomer_source']);
    const open = ninth.choices.filter((c) => !c.requires || learned.has(c.requires.flag));
    assert.equal(open.length, 4);
    assert.deepEqual([...new Set(open.map((c) => c.outcome))].sort(),
      ['eight_pages', 'kangs_accord', 'signed']);
  });

  test('and both of those flags are set on the way there', () => {
    // A gate on a flag no route sets is a locked door with no key.
    const written = flagsWritten([khitomer]);
    for (const f of ['read_the_ninth', 'khitomer_source']) {
      assert.ok(written.has(f), `nothing in the episode sets ${f}`);
    }
  });
});

describe('and each has a scene in a compartment nothing had ever used', () => {
  test('the briefing room and the brig', () => {
    // Both were among the six rooms with no functional reference outside the
    // deck plan. `stage.where` is enforced by the engine, so these are places
    // the captain has to physically walk to.
    const rooms = new Set();
    for (const ep of ACCORD_EPISODES) {
      for (const stage of Object.values(ep.stages)) {
        if (stage.where && stage.where !== 'anywhere') rooms.add(stage.where);
      }
    }
    assert.ok(rooms.has('briefing'), 'nothing happens in the briefing room');
    assert.ok(rooms.has('brig'), 'nothing happens in the brig');
  });

  test('and the engine will hold the captain to it', () => {
    const g = captain({ flags: ['torvan_owes_you'] });
    g.locationId = 'cardassia_prime';
    const m = g.missions.start('cardassia_debt', g);
    assert.ok(m, 'the episode would not start');
    // Stand on the bridge and ask for the briefing-room stage.
    g.walk.enter('bridge');
    const stage = { ...m.stage, where: 'briefing' };
    assert.equal(m.testWhere(stage).ok, false);
    g.walk.enter('briefing');
    assert.equal(m.testWhere(stage).ok, true);
  });

  test('and every off-ship stage says so, or the engine parks it on the bridge', () => {
    // `where` defaults to 'bridge'. A scene on Cardassia that forgets to say
    // 'anywhere' is a scene the captain can only have by standing in his own
    // command chair, which is the defect `stage.where` was built to catch.
    for (const ep of ACCORD_EPISODES) {
      for (const [id, stage] of Object.entries(ep.stages)) {
        assert.ok(stage.where, `${ep.id}.${id} does not say where it happens`);
      }
    }
  });
});
