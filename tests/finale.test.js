// "The board has read all of it before you walked in."
//
// It had not. `homecoming` is the Act-5 review of a five-year command and it was
// ONE stage, ONE choice, +1000 experience. The only thing it knew about that
// command was that it had reached flag rank.
//
// Measured across the sixteen shipped episodes: forty-three flags are set and
// FORTY-TWO of them are read by nothing at all. The one exception,
// `inquiry_summoned`, is not set by an episode either — `main.js` sets it from
// the ledger's own inquiry event. So `requires.flag` (engine.js:105),
// `requires.notFlag` (:108) and `requires.officer` (:111) had zero uses across
// seventy-two stages, and a captain who falsified a shakedown report, started a
// shooting war at Archanis, or handed Starfleet the Borg shield harmonics
// walked into the same room and heard the same sentence.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';
import { EPISODES, EPISODE_BY_ID } from '../src/missions/episodes/index.js';
import { ASSESSMENTS } from '../src/core/ledger.js';

/** A captain at the end of a commission, with the record they earned. */
function captain({ seed = 5n, record = () => {}, flags = [] } = {}) {
  const g = new Game({
    seed, crewMode: 'original',
    character: new Character({ speciesId: 'human', careerId: 'command' }),
    shipClass: 'constitution',
  });
  // `addXP` promotes at most one rank per call — a promotion is an event, not
  // an arithmetic result — so a captain who reached flag rank got there one
  // step at a time, and a single enormous award leaves them a Fleet Captain.
  while (g.progress.nextRank) g.progress.addXP(200000, { ledger: g.ledger });
  record(g.ledger);
  for (const f of flags) g.ledger.setFlag(f);
  return g;
}

/** Convene the board and report where it sat. */
function convene(g) {
  const m = g.missions.start('homecoming', g);
  g.locationId = 'sol';
  g.chooseMission('stand');
  return m;
}

/** A record good enough that the board stands up. */
const good = (l) => {
  l.record('colony_saved', { count: 6 });
  l.record('treaty_signed', { count: 3 });
  l.record('first_contact', { count: 2 });
};
/** A record that gets the finding read before the evidence. */
const bad = (l) => {
  l.record('prime_directive_violation', { count: 2 });
  l.record('ship_destroyed_civilian', { count: 2 });
  l.record('colony_lost', { count: 2 });
};

describe('the board reads the record it convened about', () => {
  test('and sits in a different room depending on what it says', () => {
    const rooms = new Map();
    for (const [name, rec] of [['good', good], ['thin', () => {}], ['bad', bad]]) {
      const g = captain({ record: rec });
      const m = convene(g);
      rooms.set(name, { stage: m.stageId, band: g.ledger.assessment().id });
    }
    assert.equal(rooms.get('good').stage, 'commended', `good record -> ${rooms.get('good').stage}`);
    assert.equal(rooms.get('thin').stage, 'questioned', `thin record -> ${rooms.get('thin').stage}`);
    assert.equal(rooms.get('bad').stage, 'censured', `bad record -> ${rooms.get('bad').stage}`);
    // Three different rooms, which is the whole point.
    assert.equal(new Set([...rooms.values()].map((r) => r.stage)).size, 3);
  });

  test('and the bands are the ledger’s own, not a second copy of them', () => {
    // `rules/inquiry.js` decides its finding on these same six bands, on
    // purpose, so the screen and the board cannot disagree about one record.
    // A finale that invented a seventh set would be that second answer.
    const ids = new Set(ASSESSMENTS.map((a) => a.id));
    for (const id of ['exemplary', 'distinguished', 'satisfactory', 'unremarkable', 'concerning', 'censure']) {
      assert.ok(ids.has(id), `the ledger no longer bands "${id}"`);
    }
    // Every band a real score can produce lands the captain in a real room.
    const targets = new Set(EPISODE_BY_ID.homecoming.stages.start.choices[0].next.targets);
    for (const score of [400, 150, 80, 30, 0, -40, -200]) {
      const g = captain();
      // Straight through the ledger's own scoring, not a stubbed band.
      g.ledger.counters = { colony_saved: Math.max(0, Math.round(score / 12)) };
      if (score < 0) g.ledger.counters = { colony_lost: Math.round(-score / 10) };
      const m = convene(g);
      assert.ok(targets.has(m.stageId),
        `a score of ${score} sat the board somewhere that is not a stage`);
    }
  });

  test('a decision five years ago is still in the room', () => {
    // `spared_warbird` is set in Outpost 4, whose own ending text reads "Some
    // years later, that decision comes back in your favour." It never did.
    const withIt = convene(captain({ record: good, flags: ['spared_warbird'] }));
    const without = convene(captain({ record: good }));
    const open = (m) => m.choices().filter((c) => !c.locked).map((c) => c.id);
    assert.ok(open(withIt).includes('romulan'),
      'the Romulan deposition is not offered to a captain who earned it');
    assert.ok(!open(without).includes('romulan'),
      'the Romulan deposition is offered to a captain who never spared anybody');
    // Locked, not absent — that is the contract `missionPanel` renders.
    const gated = without.choices().find((c) => c.id === 'romulan');
    assert.ok(gated?.locked && gated.lockReason, 'a locked choice with no reason on it');
  });

  test('and so is the report you flattered on the shakedown cruise', () => {
    const m = convene(captain({ flags: ['falsified_report'] }));
    assert.equal(m.stageId, 'questioned');
    assert.ok(m.choices().filter((c) => !c.locked).map((c) => c.id).includes('correct'));
  });

  test('every flag the board reads is one an episode can actually set', () => {
    // A gate on a flag nothing writes is a choice no captain can ever take,
    // which is worse than not writing it. Collected from the shipped episodes.
    const written = new Set();
    for (const ep of EPISODES) {
      for (const stage of Object.values(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) {
          for (const f of [].concat(c.effects?.flag ?? [])) written.add(f);
        }
      }
      for (const e of Object.values(ep.endings ?? {})) {
        for (const f of [].concat(e.effects?.flag ?? [])) written.add(f);
      }
    }
    // Plus the one the ledger raises rather than an episode.
    written.add('inquiry_summoned');
    const read = [];
    for (const ep of EPISODES) {
      for (const [sid, stage] of Object.entries(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) {
          for (const f of [].concat(c.requires?.flag ?? [], c.requires?.notFlag ?? [])) {
            read.push({ f, where: `${ep.id}/${sid}/${c.id}` });
          }
        }
      }
      if (ep.requiresFlag) read.push({ f: ep.requiresFlag, where: `${ep.id}(gate)` });
    }
    assert.ok(read.length >= 5, `only ${read.length} flags are read anywhere`);
    assert.deepEqual(read.filter((r) => !written.has(r.f)), [],
      'gates on flags no episode ever sets');
  });

  test('an officer who did not survive the commission does not speak at it', () => {
    // `requires.officer` — the only thing that ever made a permanent officer
    // death from an away-team check cost anything later, and it had no uses.
    const alive = convene(captain({ record: good }));
    assert.ok(alive.choices().filter((c) => !c.locked).map((c) => c.id).includes('crew'));

    const g = captain({ record: good });
    const xo = g.crew.at('first_officer');
    assert.ok(xo, 'no first officer to lose');
    xo.kill('test');
    const m = convene(g);
    const gated = m.choices().find((c) => c.id === 'crew');
    assert.ok(gated?.locked, 'a dead first officer stood up and spoke');
    assert.match(gated.lockReason, /first officer/i, gated.lockReason);
  });
});

describe('the finale is still a finale', () => {
  test('every route through it ends the episode', () => {
    // Played, not read: each room, each choice that a maximal record opens.
    for (const [name, rec, flags] of [
      ['commended', good, ['spared_warbird', 'the_watch_stood']],
      // `logged_the_watch` is `long_watch`'s: the night on deck eight, written
      // up honestly. Added here rather than to a new case because this list is
      // "every flag that opens a choice at this stage", and a flag missing from
      // it makes the loop below assert that a gated choice is unlocked for a
      // captain who never earned it.
      ['questioned', () => {}, ['falsified_report', 'borg_weakness', 'kang_respects_you', 'logged_the_watch', 'logged_a_fault']],
      ['censured', bad, ['dmz_accord', 'inquiry_resolved']],
    ]) {
      const room = convene(captain({ record: rec, flags })).stageId;
      const stage = EPISODE_BY_ID.homecoming.stages[room];
      assert.ok(stage, `${name} sat the board in "${room}"`);
      for (const c of stage.choices) {
        const g = captain({ record: rec, flags });
        const m = convene(g);
        const pick = m.choices().find((x) => x.id === c.id);
        assert.ok(pick && !pick.locked, `${room}/${c.id} was locked for the record that opens it`);
        g.chooseMission(c.id);
        assert.equal(m.complete, true, `${room}/${c.id} did not end the review`);
        assert.ok(g.ledger.has('command_reviewed'), `${room}/${c.id} left no finding`);
      }
    }
  });

  test('and it convenes for anybody who got that far', () => {
    // `requiresCompleted: []` used to sit on this episode. `[].every()` is
    // true, so it gated nothing — an unfinished thought rather than a rule. It
    // is gone rather than filled in: gating the finale on a list of episodes
    // would strand a captain who took a different route through the galaxy,
    // and a review of a thin career should SAY so, not fail to convene.
    assert.equal(EPISODE_BY_ID.homecoming.requiresCompleted, undefined);
    const g = captain();
    assert.equal(g.missions.completed.size, 0);
    g.locationId = 'sol';
    const offered = g.missions.availableAt('sol', g).map((e) => e.id);
    assert.ok(offered.includes('homecoming'),
      `a flag officer at Earth was offered ${offered.join(', ') || 'nothing'}`);
  });

  test('no stage of it is only reachable by having done something', () => {
    // The walker constraint: `tests/wiring.test.js` plays every episode thirty
    // times with random legal choices and no flags at all, and strands on a
    // stage where nothing is open.
    for (const [sid, stage] of Object.entries(EPISODE_BY_ID.homecoming.stages)) {
      const ungated = stage.choices.filter((c) => !c.requires);
      assert.ok(ungated.length, `homecoming/${sid}: every way out of the room is gated`);
    }
  });
});
