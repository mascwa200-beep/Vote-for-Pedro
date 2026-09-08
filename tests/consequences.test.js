// The mission book wrote down sixty-three decisions and read five of them.
//
// Measured over every episode stage, choice and ending, and then over every
// other line in `src/`, with the denominator stated first:
//
//     flags WRITTEN by episodes                       63
//       of those, gated on by an episode or stage     13
//       named anywhere else in src/ at all            30
//       WRITTEN AND READ BY NOTHING                   33
//
// (Nineteen flags are gated on in total after this change, but one of them —
// `inquiry_summoned` — is set by the game rather than by any episode, so the
// count of written-and-gated decisions is 18. Two different quantities, and
// the first draft of this file conflated them.)
//
// Four of the thirty-three are excusable: `came_clean`, `credited_the_crew`,
// `commended_command` and `censured_command` are all set by `homecoming`, the
// finale, so there is nothing after them to do the reading. The rest were
// decisions the game asked for, recorded, and never mentioned again.
//
// And `MissionBook.availableAt` already implemented five gates, of which three
// had never been used by anything:
//
//     minRank            12 episodes
//     requiresFlag        5 episodes
//     blockedByFlag       ZERO   <- used here
//     requiresCompleted   ZERO   <- used here
//     minStanding         ZERO   <- used here
//
// These two episodes use all three, and reach back past their own act to do
// it. That is the point: not more content, but content that knows what you did.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';
import { EPISODES } from '../src/missions/episodes/index.js';
import { CONSEQUENCE_EPISODES } from '../src/missions/episodes/consequences.js';
import { SYSTEMS } from '../src/world/systems.data.js';
import { TRACK_LIST } from '../src/rules/reputation.js';

/**
 * A flag officer, carrying whatever earlier episodes gave them.
 *
 * `completed` goes straight into the book's own set, which is what
 * `requiresCompleted` reads. Running the earlier episodes for real would make
 * this a test of those episodes.
 */
function captain({ seed = 6n, flags = [], completed = [], standing = {} } = {}) {
  const g = new Game({
    seed,
    crewMode: 'original',
    character: new Character({ speciesId: 'human', careerId: 'command' }),
    shipClass: 'excelsior',
  });
  while (g.progress.nextRank) g.progress.addXP(200000, { ledger: g.ledger });
  for (const f of flags) g.ledger.setFlag(f);
  for (const id of completed) g.missions.completed.add(id);
  // `adjustStanding` is a DELTA and nobody starts at zero — the Klingons open
  // at -10, so handing them 15 lands on 5 and the gate at 10 still refuses.
  // This sets an absolute value, which is what every caller here means.
  for (const [f, v] of Object.entries(standing)) {
    g.ledger.adjustStanding(f, v - g.ledger.standingOf(f));
  }
  return g;
}

const offered = (g, system, id) =>
  g.missions.availableAt(system, g).some((e) => e.id === id);

/** Every flag written by the whole book, choices and endings alike. */
function flagsWritten(episodes = EPISODES) {
  const out = new Set();
  for (const ep of episodes) {
    for (const stage of Object.values(ep.stages ?? {})) {
      for (const c of stage.choices ?? []) for (const f of [].concat(c.effects?.flag ?? [])) out.add(f);
      for (const f of [].concat(stage.effects?.flag ?? [])) out.add(f);
    }
    for (const e of Object.values(ep.endings ?? {})) {
      for (const f of [].concat(e.effects?.flag ?? [])) out.add(f);
    }
  }
  return out;
}

/** Which acts a flag can first be earned in. */
function actsThatSet(flag) {
  return EPISODES.filter((ep) => flagsWritten([ep]).has(flag)).map((ep) => ep.act);
}

describe('two more places, and both of them are somewhere', () => {
  test('the book is two longer and covers two more systems', () => {
    assert.equal(CONSEQUENCE_EPISODES.length, 2);
    // A ratchet, not a snapshot. Three separate files asserted the book was
    // exactly 24 episodes long, so adding a twenty-fifth failed all three for
    // no reason connected to what any of them tests. Each file already asserts
    // that ITS OWN episodes are present, distinct and somewhere empty; the
    // total only has to not go backwards.
    assert.ok(EPISODES.length >= 25, `the book is ${EPISODES.length} episodes`);
    // Distinct systems, ratcheted for the same reason as the count above.
    assert.ok(new Set(EPISODES.map((e) => e.system)).size >= 24,
      `${new Set(EPISODES.map((e) => e.system)).size} systems host an episode`);
  });

  test('and both systems exist and hosted nothing before', () => {
    const by = Object.fromEntries(
      (Array.isArray(SYSTEMS) ? SYSTEMS : Object.values(SYSTEMS)).map((s) => [s.id, s]));
    for (const ep of CONSEQUENCE_EPISODES) {
      assert.ok(by[ep.system], `${ep.id} is set at a system that does not exist`);
      const others = EPISODES.filter((e) => e.system === ep.system && e.id !== ep.id);
      assert.equal(others.length, 0,
        `${ep.system} already had ${others.map((e) => e.id).join(', ')}`);
    }
  });
});

describe('the three gates nothing had ever used', () => {
  test('requiresCompleted: the episode is not offered until the earlier one is finished', () => {
    for (const ep of CONSEQUENCE_EPISODES) {
      assert.ok(ep.requiresCompleted?.length, `${ep.id} declares no requiresCompleted`);
      // Without. The control: if this were offered anyway, the gate is inert
      // and everything below passes for the wrong reason.
      const without = captain({ standing: { klingon: 40 } });
      assert.equal(offered(without, ep.system, ep.id), false,
        `${ep.id} was offered to a captain who has not finished ${ep.requiresCompleted}`);
      // With.
      const with_ = captain({ completed: ep.requiresCompleted, standing: { klingon: 40 } });
      assert.equal(offered(with_, ep.system, ep.id), true,
        `${ep.id} was withheld from a captain who has finished ${ep.requiresCompleted}`);
    }
  });

  test('blockedByFlag: content you can lose, rather than fail', () => {
    const ep = CONSEQUENCE_EPISODES.find((e) => e.blockedByFlag);
    assert.ok(ep, 'nothing uses blockedByFlag, so this proves nothing');
    assert.equal(ep.blockedByFlag, 'deflected_blame');

    const clean = captain({ completed: ep.requiresCompleted });
    assert.equal(offered(clean, ep.system, ep.id), true,
      'a captain whose account held was not offered it');

    const marked = captain({ completed: ep.requiresCompleted, flags: ['deflected_blame'] });
    assert.equal(offered(marked, ep.system, ep.id), false,
      'a captain who put it on somebody else was offered it anyway');
  });

  test('and the flag that blocks it is one a real episode really sets', () => {
    // A gate on a flag nothing writes is a gate that never closes. `court_martial`
    // is act 3 and `deflected_blame` is one of its two outcomes.
    const acts = actsThatSet('deflected_blame');
    assert.ok(acts.length, 'nothing sets deflected_blame');
    assert.ok(Math.min(...acts) < 5,
      `deflected_blame is first set in act ${Math.min(...acts)}, at or after the episode it blocks`);
  });

  test('minStanding: the last link is a relationship, not a flag you were handed', () => {
    const ep = CONSEQUENCE_EPISODES.find((e) => e.minStanding);
    assert.ok(ep, 'nothing uses minStanding, so this proves nothing');
    const [[faction, want]] = Object.entries(ep.minStanding);

    const cold = captain({ completed: ep.requiresCompleted });
    assert.ok(cold.ledger.standingOf(faction) < want,
      `this captain already has ${faction} standing, so the control proves nothing`);
    assert.equal(offered(cold, ep.system, ep.id), false,
      `${ep.id} was offered without the ${faction} standing it asks for`);

    const warm = captain({ completed: ep.requiresCompleted, standing: { [faction]: want + 5 } });
    assert.equal(offered(warm, ep.system, ep.id), true,
      `${ep.id} was withheld from a captain in good standing`);
  });

  test('and the standing asked for is reachable, not a wall', () => {
    // Ten is `cordial`, one tier above neutral, and every faction starts at
    // zero. A gate set above what the game can actually pay out is content
    // nobody sees, which is the failure this whole file is about.
    const ep = CONSEQUENCE_EPISODES.find((e) => e.minStanding);
    const fresh = captain();
    for (const [f, v] of Object.entries(ep.minStanding)) {
      const from = fresh.ledger.standingOf(f);
      const gain = v - from;
      assert.ok(gain > 0, `${f} already starts at ${from}, so the gate is open from the first minute`);
      // The measurement that matters is the GAIN, not the threshold: the
      // Klingons open at -10, so an ask of 10 is twenty points of work. The
      // episodes on the way here hand out klingon standing in lots of 12 to
      // 20, so it is one good decision, not a grind.
      assert.ok(gain <= 40,
        `${f} starts at ${from} and the gate wants ${v} — ${gain} points is a wall, not an ask`);
    }
  });
});

describe('and they reach back past their own act', () => {
  test('every flag a choice reads is first earned strictly earlier', () => {
    // A chain that needs a flag from its own act or later is a chain nobody
    // can walk. Asserted over the reads this file adds, with the denominator
    // stated: there must BE some.
    let checked = 0;
    for (const ep of CONSEQUENCE_EPISODES) {
      for (const stage of Object.values(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) {
          const flag = c.requires?.flag;
          if (!flag) continue;
          checked++;
          const acts = actsThatSet(flag);
          assert.ok(acts.length, `${ep.id}/${c.id} reads ${flag}, which nothing sets`);
          assert.ok(Math.min(...acts) < ep.act,
            `${ep.id} is act ${ep.act} and reads ${flag}, first set in act ${Math.min(...acts)}`);
        }
      }
    }
    assert.ok(checked >= 4, `only ${checked} gated choices, so this proves little`);
  });

  test('and at least one of them reaches all the way back to the shakedown', () => {
    // The payoff the thirty-three were missing. `core_tuned` and
    // `trials_by_the_book` are set in the FIRST episode in the game, eight
    // ranks earlier, and were read by nothing until now.
    const reads = new Set();
    for (const ep of CONSEQUENCE_EPISODES) {
      for (const stage of Object.values(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) if (c.requires?.flag) reads.add(c.requires.flag);
      }
    }
    const fromActOne = [...reads].filter((f) => Math.min(...actsThatSet(f)) === 1);
    assert.ok(fromActOne.length >= 2,
      `only ${fromActOne.length} act-one decisions are read: ${[...reads].join(' ')}`);
  });

  test('and each of those flags was read by nothing before this', () => {
    // The claim in the header, asserted rather than recited. Every flag these
    // episodes gate a choice on must be one the REST of the book never gates
    // on — otherwise it was already doing work and this is not the payoff it
    // is described as.
    const elsewhere = new Set();
    for (const ep of EPISODES) {
      if (CONSEQUENCE_EPISODES.includes(ep)) continue;
      if (ep.requiresFlag) elsewhere.add(ep.requiresFlag);
      if (ep.blockedByFlag) elsewhere.add(ep.blockedByFlag);
      for (const stage of Object.values(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) if (c.requires?.flag) elsewhere.add(c.requires.flag);
      }
    }
    for (const ep of CONSEQUENCE_EPISODES) {
      for (const stage of Object.values(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) {
          const f = c.requires?.flag;
          if (!f) continue;
          assert.equal(elsewhere.has(f), false,
            `${f} was already gating something, so reading it here is not new`);
        }
      }
    }
  });
});

describe('and neither writes anything down that nobody reads', () => {
  test('every flag these two set is read by something', () => {
    // The rule this whole file exists to enforce, applied to itself first.
    const read = new Set();
    for (const ep of EPISODES) {
      if (ep.requiresFlag) read.add(ep.requiresFlag);
      if (ep.blockedByFlag) read.add(ep.blockedByFlag);
      for (const stage of Object.values(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) {
          if (c.requires?.flag) read.add(c.requires.flag);
          if (c.hidden?.flag) read.add(c.hidden.flag);
        }
      }
    }
    for (const list of Object.values(Game.FACTION_MEMORY ?? {})) {
      for (const e of list) read.add(e.flag);
    }
    // One flag, not two. `Clean Hands` sets none: a first draft gave it
    // `utopia_finding`, this test caught that nothing reads it, and rather
    // than invent a reader the flag was deleted — writing one more inert flag
    // in the file that complains about thirty-three of them would have been
    // remarkable. Its consequence is the `commendation` on the service
    // record, which the Starfleet review really does read.
    const mine = flagsWritten(CONSEQUENCE_EPISODES);
    assert.ok(mine.size >= 1, 'these episodes set no flags at all');
    for (const f of mine) {
      assert.ok(read.has(f), `${f} is written by the new episodes and read by nothing`);
    }
  });

  test('and the book is measurably less forgetful than it was', () => {
    // The number that started this. It only moves in one direction, and if a
    // later change makes it worse this says so.
    const written = flagsWritten();
    const read = new Set();
    for (const ep of EPISODES) {
      if (ep.requiresFlag) read.add(ep.requiresFlag);
      if (ep.blockedByFlag) read.add(ep.blockedByFlag);
      for (const stage of Object.values(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) if (c.requires?.flag) read.add(c.requires.flag);
      }
    }
    // Measured, not guessed, and the two numbers here are different
    // quantities: 19 flags are gated ON, but one of them (`inquiry_summoned`)
    // is set by the game rather than by any episode, so 18 was the count of
    // WRITTEN decisions that gate something. It was 13 before this file.
    //
    // This asserted `>= 18` and called itself a number that only moves in one
    // direction. So did the copy of it in `echoes.test.js`, at `>= 28`. By §111
    // the true figure was 39, so one floor was twenty-one adrift and the other
    // nine, and BOTH would have passed while a third of the book's memory was
    // deleted. A floor that nobody tightens is not a ratchet; it is a number
    // that used to mean something.
    //
    // Exact now, in both places, for the reason `WRITTEN_AND_UNREAD` is exact:
    // reality moving has to FORCE the record to move rather than merely invite
    // it. `echoes.test.js` carries the canonical statement and the history;
    // this one is older and stays because it is what that file is about. They
    // measure the same quantity and must move together.
    const gated = [...written].filter((f) => read.has(f)).length;
    assert.equal(gated, 57,
      `${gated} of ${written.size} recorded decisions gate something; the register says 57. `
      + 'The same count is asserted in echoes.test.js and RESEARCH.md §111; move all three.');
  });
});

// §111. The other road out of Organia.
//
// `our_order` has always offered "Enter what you saw at Organia into the record
// first", gated on `observed_organia` — the captain who watched from range in
// act 2. The counterpart was never written: a captain who beamed down, pressed
// the council, learned what they were and then KEPT IT OUT OF THE LOG has
// nothing to enter. He has something to admit.
//
// The two flags come from opposite opening choices at Organia, so no captain
// holds both. Two roads out of act 2, one to a customer.
describe('and the captain who buried Organia can say so', () => {
  const ep = EPISODES.find((e) => e.id === 'vulcan_long_peace');
  const stage = ep.stages.our_order;

  test('the admission is on offer only to a captain who buried it', () => {
    const gated = stage.choices.find((c) => c.id === 'organia_buried');
    assert.ok(gated, 'the admission is gone');
    assert.deepEqual(gated.requires, { flag: 'organia_secret' });

    const open = (flags) => {
      const g = captain({ flags });
      return stage.choices
        .filter((c) => !c.requires?.flag || g.ledger.has(c.requires.flag))
        .map((c) => c.id);
    };
    const none = open([]);
    assert.equal(none.includes('organia_buried'), false,
      'offered to a captain who never went down');
    assert.equal(none.includes('organia'), false,
      'the clean version is offered to a captain who never observed either');

    assert.ok(open(['organia_secret']).includes('organia_buried'), 'burying it bought nothing');
    assert.equal(open(['organia_secret']).includes('organia'), false,
      'a captain who buried it can also enter what he saw');
    assert.ok(open(['observed_organia']).includes('organia'));
  });

  test('and it costs him with Starfleet, which is what makes it worth doing', () => {
    // Every other choice at this stage pays federation standing. This one is
    // the only line in the scene that takes it away: a delegation being told
    // the Federation sat on a first contact is not applause, and the choice is
    // worth nothing if it is simply the better version of the clean one.
    const gated = stage.choices.find((c) => c.id === 'organia_buried');
    assert.ok(gated.effects.standing.federation < 0,
      `admitting a concealment pays ${gated.effects.standing.federation} federation standing`);
    for (const other of stage.choices.filter((c) => c.id !== 'organia_buried')) {
      assert.ok((other.effects.standing?.federation ?? 0) > 0,
        `${other.id} also costs federation standing, so the admission is not distinctive`);
    }
  });

  test('and no choice in the book pays into a reputation track that does not exist', () => {
    // §111's first draft rewarded the Organia admission in `vulcan` standing.
    // There are six tracks and Vulcan is not one of them, so it would have been
    // a line of prose the game silently ignored — the class §104 and §105 were
    // both about.
    //
    // That version of this test looked at ONE STAGE, which is the instance and
    // not the class. §114 widened it and found twelve shipped choices already
    // doing it: six paying `orion` and six paying `tholian`, both of which are
    // factions in `world/factions.data.js` and neither of which is a reputation
    // track. SIX of the twelve had no other standing line at all, so crossing a
    // Tholian border, going loud on Rigel and pursuing the raiders who took four
    // hundred colonists as cargo each cost the captain nothing anywhere.
    //
    // The lesson is the inverse of §110's. There the mistake was writing a guard
    // that already existed; here it was writing one narrower than the class it
    // was defending against, when the general version was three lines away and
    // free.
    const tracks = new Set(TRACK_LIST.map((t) => t.id ?? t));
    const dead = [];
    let checked = 0;
    const visit = (where, standing) => {
      for (const f of Object.keys(standing ?? {})) {
        checked++;
        if (!tracks.has(f)) dead.push(`${where} pays standing to "${f}"`);
      }
    };
    for (const ep of EPISODES) {
      for (const [sid, s] of Object.entries(ep.stages ?? {})) {
        for (const c of s.choices ?? []) visit(`${ep.id}/${sid}/${c.id}`, c.effects?.standing);
      }
      // Endings pay standing too, and the narrow version never looked at one.
      for (const [k, e] of Object.entries(ep.endings ?? {})) {
        visit(`${ep.id}!${k}`, e.effects?.standing);
      }
    }
    assert.ok(checked >= 60, `only ${checked} standing lines examined, so this asserts little`);
    assert.deepEqual(dead, [], `${dead.length} standing lines name no real track`);
  });
});

// §117. The account Sostrova heard about.
//
// `utopia_certification` opens with a yard that wants a captain to sign for a
// hull, and Vice Admiral Sostrova explaining why she asked this one: "She heard
// that a captain stood up at their own board of inquiry and gave an account that
// cost them something."
//
// That is a description of `came_clean` — Starbase 11, act 3, correcting the
// shakedown report before the board asked about it — and the episode was built
// around the deed without ever reading it. It already refuses the captain who
// went the other way, `blockedByFlag: deflected_blame`.
describe('the account this episode was written about', () => {
  const ep = EPISODES.find((e) => e.id === 'utopia_certification');
  const stage = ep.stages.starbase;

  const open = (flags) => {
    const g = captain({ flags, completed: ep.requiresCompleted ?? [] });
    return stage.choices
      .filter((c) => !c.requires?.flag || g.ledger.has(c.requires.flag))
      .map((c) => c.id);
  };

  test('is one the captain who gave it can name', () => {
    const gated = stage.choices.find((c) => c.id === 'name_it');
    assert.ok(gated, 'the road that names the report is gone');
    assert.deepEqual(gated.requires, { flag: 'came_clean' });
    assert.equal(open([]).includes('name_it'), false,
      'offered to a captain who never corrected anything');
    assert.ok(open(['came_clean']).includes('name_it'), 'Starbase 11 bought nothing');
  });

  test('and the gate can never be dead, because the two outcomes are one board', () => {
    // The reason this placement is safe rather than lucky. `came_clean` and
    // `deflected_blame` are outcomes of the same court-martial, so a captain
    // holding the first cannot hold the second — and the second is the only
    // thing that keeps him out of this episode. Every captain who came clean is
    // a captain this episode will admit.
    assert.equal(ep.blockedByFlag, 'deflected_blame');
    const sameStage = [];
    for (const e of EPISODES) {
      for (const s of Object.values(e.stages ?? {})) {
        const flags = (s.choices ?? []).map((c) => [].concat(c.effects?.flag ?? []));
        const has = (f) => flags.some((set) => set.includes(f));
        if (has('came_clean') && has('deflected_blame')) sameStage.push(e.id);
      }
    }
    assert.ok(sameStage.length,
      'came_clean and deflected_blame are no longer alternatives at one stage, so this gate can go dead');

    // And the positive half: a captain who came clean is offered the episode.
    const g = captain({ flags: ['came_clean'], completed: ep.requiresCompleted ?? [] });
    assert.equal(offered(g, ep.system, ep.id), true,
      'a captain who came clean is not offered the episode that asked for him');
  });
});

// ----------------------------------------------------------- the first question
//
// `shakedown`, act 1, the opening screen of the game. Nakamura's orders are up,
// the ship is finished, and the captain may acknowledge them or ask why the
// hurry. It is the second choice a player ever makes and until now nothing in
// twenty-six episodes had noticed it.
//
// This episode is set in the yard he asked. There is a hull in frame two months
// from launch, being certified on a survey the yard wrote about itself, which is
// what a hurry looks like once it has had four years to become a procedure.
describe('the question this captain asked before he had done anything', () => {
  const ep = EPISODES.find((e) => e.id === 'utopia_certification');
  const stage = ep.stages.start;

  const open = (flags) => {
    const g = captain({ flags, completed: ep.requiresCompleted ?? [] });
    return stage.choices
      .filter((c) => !c.requires?.flag || g.ledger.has(c.requires.flag))
      .map((c) => c.id);
  };

  test('is one he can ask again, in the same building', () => {
    const gated = stage.choices.find((c) => c.id === 'hurry');
    assert.ok(gated, 'the road that asks the yard again is gone');
    assert.deepEqual(gated.requires, { flag: 'asked_about_hurry' });
    assert.equal(open([]).includes('hurry'), false,
      'offered to a captain who acknowledged his orders and asked nothing');
    assert.ok(open(['asked_about_hurry']).includes('hurry'),
      'the first question in the game bought nothing');
    // It goes to the trials rather than to Sostrova's account of Starbase 11:
    // she is not going to answer, and what asking buys him is what he looks for
    // four days later.
    assert.equal(gated.next, 'trials');
  });

  test('and the deepest reach in the book is into the shakedown, four times over', () => {
    // The span of a gated choice: the act it is read in, minus the earliest act
    // that can write the flag it reads. Nothing had ever computed it, and the
    // register asserted it twice in prose and was wrong both times — §114
    // called an act-1-to-act-4 gate "the longest reach in the book" when §112
    // had already beaten it by an act, and the first draft of this test claimed
    // the record for the new gate and was wrong by three.
    //
    // What the measurement actually says is better than either claim. Every
    // gate at the maximum span reads a flag written in `shakedown` — the first
    // episode, the one that exists to teach the controls — and three of the
    // four are in THIS episode, which was already the deepest-reaching in the
    // book before anything was added to it. The captain returns to the yard he
    // launched from and is asked about the trials report he wrote, the tuning
    // pass he ran, and now the question he asked before he flew.
    //
    // Both wrong claims had the same cause, which is why this is a test and not
    // a comment: a fact about the whole book, stated from the two or three
    // episodes that happened to be open at the time.
    const firstAct = new Map();
    for (const e of EPISODES) {
      for (const s of Object.values(e.stages ?? {})) {
        for (const c of s.choices ?? []) {
          for (const f of [].concat(c.effects?.flag ?? [])) {
            firstAct.set(f, Math.min(firstAct.get(f) ?? Infinity, e.act));
          }
        }
      }
      for (const en of Object.values(e.endings ?? {})) {
        for (const f of [].concat(en.effects?.flag ?? [])) {
          firstAct.set(f, Math.min(firstAct.get(f) ?? Infinity, e.act));
        }
      }
    }

    const spans = [];
    for (const e of EPISODES) {
      for (const [sid, s] of Object.entries(e.stages ?? {})) {
        for (const c of s.choices ?? []) {
          const f = c.requires?.flag;
          if (!f || !firstAct.has(f)) continue;
          spans.push({ where: `${e.id}/${sid}/${c.id}`, flag: f, span: e.act - firstAct.get(f) });
        }
      }
    }
    assert.ok(spans.length >= 20, `only ${spans.length} gated choices span anything`);

    const longest = Math.max(...spans.map((s) => s.span));
    const deepest = spans.filter((s) => s.span === longest).sort((a, b) =>
      a.where.localeCompare(b.where));
    assert.equal(longest, 4, `the deepest reach is now ${longest} acts, not four`);
    assert.deepEqual(deepest.map((s) => s.where), [
      'homecoming/questioned/correct',
      'utopia_certification/start/hurry',
      'utopia_certification/the_memo/trials',
      'utopia_certification/trials/tuned',
    ], 'the set of deepest reaches has changed, and the register should say so');

    // The part worth pinning is not the number but where they all reach TO.
    // Every one of them lands on the opening episode, and the new gate did not
    // set a record so much as join a pattern that was already there.
    const wrote = (flag) => EPISODES.find((e) => Object.values(e.stages ?? {})
      .some((s) => (s.choices ?? []).some((c) =>
        [].concat(c.effects?.flag ?? []).includes(flag))));
    for (const s of deepest) {
      assert.equal(wrote(s.flag)?.id, 'shakedown',
        `${s.where} reads ${s.flag}, which is no longer written in the shakedown`);
    }
    assert.equal(deepest.filter((s) => s.where.startsWith('utopia_certification/')).length, 3,
      'this episode no longer holds three of the four deepest reaches in the book');
  });

  test('and nothing can keep the captain who asked it out of this yard', () => {
    // The gate's own safety check, in the shape §111 established. The only
    // thing that bars this episode is `deflected_blame`, written at the
    // court-martial in act 3; `asked_about_hurry` is written in act 1 by an
    // episode with no requirements of any kind. They cannot exclude each other
    // because they are not alternatives at any stage — nothing has to be given
    // up to hold both.
    const shakedown = EPISODES.find((e) => (e.stages.start.choices ?? [])
      .some((c) => [].concat(c.effects?.flag ?? []).includes('asked_about_hurry')));
    assert.ok(shakedown, 'nothing writes asked_about_hurry on an opening stage any more');
    assert.equal(shakedown.act, 1);
    assert.equal(shakedown.requiresFlag, undefined,
      'the first episode now demands something, so the first question is no longer free');
    assert.equal(shakedown.requiresCompleted, undefined);

    const g = captain({ flags: ['asked_about_hurry'], completed: ep.requiresCompleted ?? [] });
    assert.equal(offered(g, ep.system, ep.id), true,
      'the captain who asked the yard why the hurry is not offered the yard');
  });
});
