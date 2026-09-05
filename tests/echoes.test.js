// The second instalment of "a game that remembers".
//
// `consequences.js` took the count of written-and-gated decisions from 13 to
// 18. These two go after the largest seams that were left:
//
//   vega_saved / vega_grid_restored   set by `vega_raid`, ACT 1 — the second
//                                     episode in the game — and read by
//                                     nothing for the rest of a commission.
//   borg_warned / borg_data /         set by `the_cube`, ACT 4. Three of the
//   borg_hurt                         biggest decisions in the book, and
//                                     nothing ever mentioned them.
//
// Two things are different this time and both are asserted below.
//
// FIRST, they are in different acts. `consequences.js` put both of its
// episodes in act 5, which left the book bottom-heavy — act 1 had two and act
// 5 had four. A consequence only has to come after the thing it reads, so
// Vega's is act 3 and a captain meets it while the raid is recent.
//
// SECOND, they chain to each other: `The Vega Line` (act 3) writes the
// standing order for colony defence, and `What the Cube Left` (act 5) is where
// the frontier either has that order or does not. That is a flag written by
// new content and read by new content, which is the shape the whole exercise
// is for — and the reason this file checks that the chain is walkable rather
// than merely declared.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';
import { EPISODES } from '../src/missions/episodes/index.js';
import { ECHO_EPISODES } from '../src/missions/episodes/echoes.js';
import { SYSTEMS } from '../src/world/systems.data.js';

function captain({ seed = 11n, flags = [], completed = [] } = {}) {
  const g = new Game({
    seed,
    crewMode: 'original',
    character: new Character({ speciesId: 'human', careerId: 'command' }),
    shipClass: 'excelsior',
  });
  while (g.progress.nextRank) g.progress.addXP(200000, { ledger: g.ledger });
  for (const f of flags) g.ledger.setFlag(f);
  for (const id of completed) g.missions.completed.add(id);
  return g;
}

const offered = (g, system, id) =>
  g.missions.availableAt(system, g).some((e) => e.id === id);

function flagsWritten(episodes) {
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

function gateReads(episodes) {
  const read = new Set();
  for (const ep of episodes) {
    if (ep.requiresFlag) read.add(ep.requiresFlag);
    if (ep.blockedByFlag) read.add(ep.blockedByFlag);
    for (const stage of Object.values(ep.stages ?? {})) {
      for (const c of stage.choices ?? []) if (c.requires?.flag) read.add(c.requires.flag);
    }
  }
  return read;
}

const actsThatSet = (flag) =>
  EPISODES.filter((ep) => flagsWritten([ep]).has(flag)).map((ep) => ep.act);

describe('two more, and this time not both at the end', () => {
  test('the book is 24 over 23 systems, and both new ones are somewhere empty', () => {
    assert.equal(ECHO_EPISODES.length, 2);
    assert.equal(EPISODES.length, 24);
    const by = Object.fromEntries(
      (Array.isArray(SYSTEMS) ? SYSTEMS : Object.values(SYSTEMS)).map((s) => [s.id, s]));
    for (const ep of ECHO_EPISODES) {
      assert.ok(by[ep.system], `${ep.id} is set at a system that does not exist`);
      const others = EPISODES.filter((e) => e.system === ep.system && e.id !== ep.id);
      assert.equal(others.length, 0, `${ep.system} already had ${others.map((e) => e.id)}`);
    }
  });

  test('and they are in different acts, which is the correction to the last pair', () => {
    // `consequences.js` put both in act 5 and left act 1 with two episodes
    // against act 5's four. If a later instalment stacks act 5 again this
    // says so.
    const acts = ECHO_EPISODES.map((e) => e.act);
    assert.equal(new Set(acts).size, 2, `both new episodes are in act ${acts[0]}`);
    const byAct = {};
    for (const e of EPISODES) byAct[e.act] = (byAct[e.act] ?? 0) + 1;
    const counts = Object.values(byAct);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 5,
      `the book is lopsided: ${JSON.stringify(byAct)}`);
  });
});

describe('the reach backwards', () => {
  test('each is gated on the episode it reads, and the gate really gates', () => {
    for (const ep of ECHO_EPISODES) {
      assert.ok(ep.requiresCompleted?.length, `${ep.id} declares no requiresCompleted`);
      const without = captain();
      assert.equal(offered(without, ep.system, ep.id), false,
        `${ep.id} was offered to a captain who never flew ${ep.requiresCompleted}`);
      const with_ = captain({ completed: ep.requiresCompleted });
      assert.equal(offered(with_, ep.system, ep.id), true,
        `${ep.id} was withheld from a captain who flew ${ep.requiresCompleted}`);
    }
  });

  test('and the longest reach goes all the way back to act one', () => {
    // `vega_raid` is the second episode in the game and has no rank gate at
    // all. Reading it in act 3 is the longest backwards reach in the book.
    const vega = ECHO_EPISODES.find((e) => e.id === 'vega_line');
    assert.ok(vega, 'the Vega episode is gone, so this proves nothing');
    const reads = [...gateReads([vega])];
    assert.ok(reads.length >= 2, `it gates only ${reads.length} choices`);
    for (const f of reads) {
      const acts = actsThatSet(f);
      assert.ok(acts.length, `${f} is read and nothing sets it`);
      assert.equal(Math.min(...acts), 1,
        `${f} is first set in act ${Math.min(...acts)}, not act 1`);
    }
    assert.ok(vega.act > 1 && vega.act < 5,
      `the payoff is act ${vega.act}; the point was not to stack act 5 again`);
  });

  test('and every gated choice reads a flag first earned strictly earlier', () => {
    let checked = 0;
    for (const ep of ECHO_EPISODES) {
      for (const stage of Object.values(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) {
          if (!c.requires?.flag) continue;
          checked++;
          const acts = actsThatSet(c.requires.flag);
          assert.ok(acts.length, `${ep.id}/${c.id} reads ${c.requires.flag}, which nothing sets`);
          assert.ok(Math.min(...acts) < ep.act,
            `${ep.id} is act ${ep.act} and reads ${c.requires.flag}, first set in act ${Math.min(...acts)}`);
        }
      }
    }
    assert.ok(checked >= 5, `only ${checked} gated choices, so this proves little`);
  });

  test('and none of those flags was gating anything before', () => {
    const elsewhere = gateReads(EPISODES.filter((e) => !ECHO_EPISODES.includes(e)));
    for (const f of gateReads(ECHO_EPISODES)) {
      // `grid_doctrine` is the exception and is the next test's whole subject:
      // it is written by one of these two and read by the other.
      if (f === 'grid_doctrine') continue;
      assert.equal(elsewhere.has(f), false,
        `${f} was already gating something, so reading it here is not new`);
    }
  });
});

describe('and the two of them chain to each other', () => {
  test('the act-3 episode writes what the act-5 one reads', () => {
    const vega = ECHO_EPISODES.find((e) => e.id === 'vega_line');
    const cube = ECHO_EPISODES.find((e) => e.id === 'beta_reticuli');
    assert.ok(flagsWritten([vega]).has('grid_doctrine'), 'the Vega episode no longer writes it');
    assert.ok(gateReads([cube]).has('grid_doctrine'), 'the frontier episode no longer reads it');
    assert.ok(vega.act < cube.act, 'the chain runs backwards');
  });

  test('and the choice it unlocks is really unreachable without it', () => {
    // The control. A `requires` that the engine ignores would leave the choice
    // on the screen for everybody and every assertion above would still pass.
    const cube = ECHO_EPISODES.find((e) => e.id === 'beta_reticuli');
    const stage = Object.values(cube.stages).find((s) =>
      (s.choices ?? []).some((c) => c.requires?.flag === 'grid_doctrine'));
    assert.ok(stage, 'no stage gates a choice on grid_doctrine');

    const g = captain({ completed: cube.requiresCompleted });
    const visible = (game) => stage.choices.filter((c) =>
      !c.requires?.flag || game.ledger.has(c.requires.flag)).map((c) => c.id);

    const without = visible(g);
    assert.equal(without.includes('grid'), false,
      'the grid choice is offered to a captain who never wrote the order');
    g.ledger.setFlag('grid_doctrine');
    assert.ok(visible(g).includes('grid'),
      'the grid choice stayed hidden from a captain who wrote the order');
    assert.ok(visible(g).length > without.length, 'the flag changed nothing');
  });
});

describe('and neither writes anything down that nobody reads', () => {
  test('every flag these two set is read by something', () => {
    const read = gateReads(EPISODES);
    for (const list of Object.values(Game.FACTION_MEMORY ?? {})) {
      for (const e of list) read.add(e.flag);
    }
    const mine = flagsWritten(ECHO_EPISODES);
    assert.ok(mine.size >= 1, 'these episodes set no flags at all');
    for (const f of mine) {
      assert.ok(read.has(f), `${f} is written by the new episodes and read by nothing`);
    }
  });

  test('and the book is less forgetful again', () => {
    // 13 before `consequences.js`, 18 after it, 24 now. A ratchet: it only
    // moves one way, and if a later change makes it worse this says so.
    const written = flagsWritten(EPISODES);
    const read = gateReads(EPISODES);
    const gated = [...written].filter((f) => read.has(f)).length;
    assert.ok(gated >= 24,
      `only ${gated} of ${written.size} recorded decisions gate anything; it was 18 before this`);
  });
});
