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
    assert.equal(EPISODES.length, 22);
    assert.equal(new Set(EPISODES.map((e) => e.system)).size, 21);
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
    // is set by the game rather than by any episode, so 18 is the count of
    // WRITTEN decisions that gate something. It was 13.
    const gated = [...written].filter((f) => read.has(f)).length;
    assert.ok(gated >= 18,
      `only ${gated} of ${written.size} recorded decisions gate anything; it was 13 before this`);
  });
});
