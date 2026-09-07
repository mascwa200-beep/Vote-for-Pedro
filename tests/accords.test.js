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
    // A ratchet, not a snapshot. Three separate files asserted the book was
    // exactly 24 episodes long, so adding a twenty-fifth failed all three for
    // no reason connected to what any of them tests. Each file already asserts
    // that ITS OWN episodes are present, distinct and somewhere empty; the
    // total only has to not go backwards.
    assert.ok(EPISODES.length >= 25, `the book is ${EPISODES.length} episodes`);
    const byAct = {};
    for (const e of EPISODES) byAct[e.act] = (byAct[e.act] ?? 0) + 1;
    assert.ok(byAct[5] >= 2, `Act 5 still has ${byAct[5]} episode(s) in it`);
    // Distinct systems, ratcheted for the same reason as the count above.
    assert.ok(new Set(EPISODES.map((e) => e.system)).size >= 24,
      `${new Set(EPISODES.map((e) => e.system)).size} systems host an episode`);
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

// §111. Donatu V, read at Khitomer.
//
// The prisoner scene is leverage: a Klingon technician with a Cardassian charge
// is in YOUR brig on the second morning, and the two roads out of it are handing
// him to the Klingons or going down to see him alone. Both make him somebody's
// card.
//
// A captain who transmitted one text to two fleets at Donatu V — act 3, both
// commands, neither learning it from the other — has done this before at a
// larger scale and under worse odds. Told to both rooms in the same breath, the
// technician stops being a card and goes back to being a nineteen-year-old with
// a satchel.
describe('the captain who defused Donatu can defuse this', () => {
  const ep = EPISODES.find((e) => e.id === 'khitomer_accord');
  const stage = ep.stages.table;

  const open = (flags) => {
    const g = captain({ flags });
    return stage.choices
      .filter((c) => !c.requires?.flag || g.ledger.has(c.requires.flag))
      .map((c) => c.id);
  };

  test('telling both delegations at once is only for the captain who did it before', () => {
    const gated = stage.choices.find((c) => c.id === 'both_rooms');
    assert.ok(gated, 'the Donatu move is gone from the table');
    assert.deepEqual(gated.requires, { flag: 'donatu_accord' });

    const without = open([]);
    assert.equal(without.includes('both_rooms'), false,
      'offered to a captain who never brokered Donatu');
    assert.equal(without.length, 2, 'the two original roads are no longer both there');

    assert.ok(open(['donatu_accord']).includes('both_rooms'), 'Donatu bought nothing');
  });

  test('and it is a road, not a better version of an existing one', () => {
    // It has to go somewhere and pay differently, or it is the same choice with
    // a nicer label. It reaches the ninth page without spending the prisoner,
    // which is what the week is actually about.
    const gated = stage.choices.find((c) => c.id === 'both_rooms');
    assert.equal(gated.next, 'ninth', 'the Donatu move does not reach the ninth page');
    const hand = stage.choices.find((c) => c.id === 'hand');
    assert.ok(gated.effects.standing.klingon > hand.effects.standing.klingon,
      'handing him over is worth as much to the Klingons as not needing to');
    assert.ok((gated.effects.standing.federation ?? 0) > 0,
      'the Federation gets nothing for a captain who kept the table together');
  });

  test('and a captain can hold what it asks for alongside the episode gate', () => {
    // The §110 trap: `captured_cloak` could never be read inside `romulus_debt`
    // because it is the sibling of the flag that episode requires. The general
    // guard lives in `wiring.test.js`; what is asserted here is the specific
    // fact — `donatu_accord` and this episode's `qonos_upheld` are written by
    // different episodes, so nothing makes a captain choose between them.
    const writers = (flag) => new Set(EPISODES
      .filter((e) => Object.values(e.stages ?? {}).some((s) => (s.choices ?? [])
        .some((c) => [].concat(c.effects?.flag ?? []).includes(flag))))
      .map((e) => e.id));
    const donatu = writers('donatu_accord');
    const upheld = writers(ep.requiresFlag);
    assert.ok(donatu.size && upheld.size, 'one of the two flags is written by nothing');
    assert.equal([...donatu].some((id) => upheld.has(id)), false,
      `both are written inside ${[...donatu].join(',')}, so a captain may have to choose`);
  });
});

// §113. Terok Nor, read at Khitomer.
//
// The prisoner has just given up the paymaster and asked, in the first
// frightened thing he has said, that nobody be told he gave it. Both roads out
// of `bargained` spend him anyway — one at the table, one quietly.
//
// A captain who took a conceded point back before signing at Terok Nor in act 3
// has a third: reopen the concession on its own merits. A harder argument, and
// the one that leaves a nineteen-year-old out of it.
describe('the captain who reopened a concession once can do it again', () => {
  const ep = EPISODES.find((e) => e.id === 'khitomer_accord');
  const stage = ep.stages.bargained;

  const open = (flags) => {
    const g = captain({ flags });
    return stage.choices
      .filter((c) => !c.requires?.flag || g.ledger.has(c.requires.flag))
      .map((c) => c.id);
  };

  test('reopening the page is only for the captain who has done it before', () => {
    const gated = stage.choices.find((c) => c.id === 'reopen');
    assert.ok(gated, 'the third road out of the cell is gone');
    assert.deepEqual(gated.requires, { flag: 'dmz_clause_recovered' });

    const without = open([]);
    assert.equal(without.includes('reopen'), false,
      'offered to a captain who never reopened anything at Terok Nor');
    assert.equal(without.length, 2, 'the two original roads are no longer both there');
    assert.ok(open(['dmz_clause_recovered']).includes('reopen'), 'Terok Nor bought nothing');
  });

  test('and it is the road that does not spend the man who gave him the name', () => {
    // The distinction the scene is built on. Both original roads carry the name
    // to the table or use it quietly; this one carries neither.
    const reopen = stage.choices.find((c) => c.id === 'reopen');
    const sourced = stage.choices.filter((c) => c.id !== 'reopen');
    for (const c of sourced) {
      assert.ok([].concat(c.effects?.flag ?? []).includes('read_the_ninth'),
        `${c.id} no longer reads the page, so the comparison below is wrong`);
    }
    assert.ok([].concat(reopen.effects.flag).includes('read_the_ninth'),
      'reopening the page arrives at the ninth stage without having read it');
    assert.equal([].concat(reopen.effects.flag).includes('khitomer_source'), false,
      'the road that leaves him out of it still names the paymaster');
  });

  test('and it does not strand the captain among locked choices at the ninth page', () => {
    // `ninth` gates three of its four choices. A road into it that failed to set
    // `read_the_ninth` would put a captain in a room where almost everything is
    // greyed out — which is why both siblings set it and why this one must.
    const g = captain({ flags: ['dmz_clause_recovered', 'read_the_ninth'] });
    const m = g.missions.start('khitomer_accord', g);
    g.locationId = ep.system;
    m.stageId = 'ninth';
    const open2 = m.choices().filter((c) => !c.locked).map((c) => c.id);
    assert.ok(open2.length >= 2, `only ${open2.length} choices open at the ninth page`);
  });
});

// §118. Organia, at a Federation-Klingon table.
describe('the last power that stopped this war', () => {
  const ep = EPISODES.find((e) => e.id === 'khitomer_accord');
  const stage = ep.stages.start;

  const open = (flags) => {
    const g = captain({ flags });
    return stage.choices
      .filter((c) => !c.requires?.flag || g.ledger.has(c.requires.flag))
      .map((c) => c.id);
  };

  test('is something one captain at the table has filed a report on', () => {
    // Kang has just said two of the four days are for the funeral of whoever
    // tries to stop the accord. Every other captain hears a threat.
    const gated = stage.choices.find((c) => c.id === 'organia');
    assert.ok(gated, 'the Organia answer is gone');
    assert.deepEqual(gated.requires, { flag: 'organia_revealed' });
    assert.equal(open([]).includes('organia'), false,
      'offered to a captain who never found out what they were');
    assert.equal(open([]).length, 2, 'the two original openings are no longer both there');
    assert.ok(open(['organia_revealed']).includes('organia'), 'Organia bought nothing');
  });

  test('and it is act 2 read in act 5, which is the reach worth having', () => {
    const acts = EPISODES
      .filter((e) => Object.values(e.stages ?? {}).some((s) => (s.choices ?? [])
        .some((c) => [].concat(c.effects?.flag ?? []).includes('organia_revealed'))))
      .map((e) => e.act);
    assert.ok(acts.length, 'nothing sets organia_revealed');
    assert.equal(Math.min(...acts), 2);
    assert.equal(ep.act, 5);
  });

  test('and Starfleet is paid too, because he is telling a Klingon what he filed', () => {
    // A captain volunteering a piece of classified assessment to a Klingon in
    // orbit over a treaty. Starfleet's view of that depends on the accord being
    // signed, so both tracks move rather than the Klingon one alone.
    const gated = stage.choices.find((c) => c.id === 'organia');
    assert.ok(gated.effects.standing.klingon > 0);
    assert.ok(gated.effects.standing.federation > 0);
  });
});

// ------------------------------------------------ a lock with a door behind it
//
// `cardassia_debt/start/clause` was gated on `dmz_accord` and carried the
// comment "Only a captain who actually signed it. Two of the treaty's endings
// set this and one does not." Both sentences are true about `cardassian_treaty`
// and neither survives being read here.
//
// The episode requires `torvan_owes_you`, written at the treaty's `clause/quiet`
// — and `quiet` goes to `talks`, where both remaining choices sign. The captain
// who did not sign took `clause/press` instead and never earned the flag that
// brings him to Cardassia. So the gate was shown as earned to a room in which
// everybody had earned it: §111's dead lock with its sign reversed, and the
// general guard for it now lives in `wiring.test.js`.
describe('the clause quoted from memory', () => {
  const ep = ACCORD_EPISODES.find((e) => e.id === 'cardassia_debt');
  const clause = () => ep.stages.start.choices.find((c) => c.id === 'clause');

  const diplomat = (ranks) => {
    const g = captain({ flags: ['torvan_owes_you'] });
    for (let i = 0; i < ranks; i++) {
      assert.ok(g.progress.spend('diplomacy'), `could not buy diplomacy rank ${i + 1}`);
    }
    return g;
  };

  test('asks for the skill, because the deed cannot tell these captains apart', () => {
    const c = clause();
    assert.ok(c, 'the clause is gone');
    assert.deepEqual(c.requires, { skill: 'diplomacy', ranks: 3 },
      'the clause is gated on something other than the diplomacy that reads it');
  });

  test('and the deed it used to ask for is one every captain here already has', () => {
    // Measured on the treaty's own graph rather than asserted: from the stage
    // that writes `torvan_owes_you`, every road out signs the accord. This is
    // the fact that made the old gate meaningless, and if the treaty ever grows
    // a road that does not sign, the old gate becomes viable again and this
    // test should be the thing that says so.
    const treaty = EPISODES.find((e) => e.id === 'cardassian_treaty');
    const writes = Object.entries(treaty.stages).flatMap(([sid, s]) =>
      (s.choices ?? []).filter((c) =>
        [].concat(c.effects?.flag ?? []).includes('torvan_owes_you'))
        .map((c) => ({ sid, c })));
    assert.equal(writes.length, 1, 'torvan_owes_you is written in more than one place now');

    const after = treaty.stages[writes[0].c.next];
    assert.ok(after, 'the stage that writes torvan_owes_you no longer leads anywhere');
    assert.ok((after.choices ?? []).length >= 2, 'the road after it is no longer a choice');
    for (const c of after.choices) {
      assert.ok([].concat(c.effects?.flag ?? []).includes('dmz_accord'),
        `${writes[0].c.next}/${c.id} does not sign, so dmz_accord would discriminate again`);
    }
  });

  test('and the skill gate does discriminate, in both directions', () => {
    const need = clause().requires.ranks;
    const open = (g) => ep.stages.start.choices
      .filter((c) => !c.requires?.skill || g.progress.ranksIn(c.requires.skill) >= c.requires.ranks)
      .map((c) => c.id);

    assert.equal(open(diplomat(need - 1)).includes('clause'), false,
      `offered at diplomacy ${need - 1}`);
    assert.ok(open(diplomat(need)).includes('clause'), `refused at diplomacy ${need}`);
  });

  test('and refusing it strands nobody, because two roads out of the stage are free', () => {
    const free = ep.stages.start.choices.filter((c) => !c.requires);
    assert.ok(free.length >= 2,
      `only ${free.length} ungated roads out of the customs shed`);
  });
});
