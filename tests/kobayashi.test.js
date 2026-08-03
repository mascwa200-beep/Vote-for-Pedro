// The Kobayashi Maru.
//
// Two things have to be true, and they pull against each other, which is why
// this file exists rather than a couple of assertions bolted onto another one.
//
// The scenario must stay unwinnable. Not hard — unwinnable. If it can be beaten
// by flying well then it is a tuning value, and the exercise means nothing.
//
// The technique must be earned, and must be earned by the *right* thing. Not a
// level, not an unlock token: reputation actually accumulated with the Empire,
// and a ledger that shows they have met you. And what you say has to be checked
// against that record, so that claiming a reputation you do not have fails.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import {
  SCENARIO, AXES, GAMBIT_TIER, GAMBIT_ENCOUNTERS,
  gambitStatus, recordOf, scoreAppeal, forceChannel, resolveGambit,
} from '../src/missions/kobayashi.js';

const gameWith = (opts = {}) => new Game({ seed: 3n, crewMode: 'original', ...opts });

/** A captain the Empire has actually met, several times. */
function decorated(g) {
  g.reputation.tracks.klingon.tier = GAMBIT_TIER;
  for (let i = 0; i < 4; i++) g.ledger.record('ship_destroyed_hostile');
  for (let i = 0; i < 3; i++) g.ledger.record('ship_spared');
  g.ledger.record('treaty_signed');
  return g;
}

describe('the scenario', () => {
  test('is available from the first day', () => {
    const g = gameWith();
    assert.equal(typeof g.runKobayashiMaru, 'function');
    g.runKobayashiMaru();
    assert.ok(g.engagement, 'the simulator did not start');
    assert.equal(g.kobayashiRuns, 1);
  });

  test('has no escape course', () => {
    const g = gameWith();
    g.runKobayashiMaru();
    assert.equal(g.engagement.canWarpOut, false, 'you could simply leave');
    assert.equal(g.engagement.beginWarpOut(), false);
  });

  test('is unwinnable by fighting, at the easiest difficulty there is', () => {
    // Story mode. Full player bonuses, no permadeath, every advantage the game
    // hands out. If it is survivable here it is not a no-win scenario.
    let survived = 0;
    for (let i = 0; i < 8; i++) {
      const g = new Game({ seed: BigInt(600 + i), crewMode: 'original', difficulty: 'story' });
      g.runKobayashiMaru();
      const eng = g.engagement;
      for (let t = 0; t < 30000 && !eng.over; t++) g.update(1 / 30);
      if (eng.outcome === 'victory' || eng.outcome === 'routed') survived++;
    }
    assert.equal(survived, 0, `the freighter was saved by shooting ${survived} time(s) in 8`);
  });

  test('the odds are stated rather than hidden', () => {
    assert.equal(SCENARIO.hostiles.length, 3);
    assert.ok(SCENARIO.briefing.join(' ').includes('381') || SCENARIO.briefing.length >= 3);
  });
});

describe('earning the technique', () => {
  test('a new captain cannot do it, and is told exactly why', () => {
    const g = gameWith();
    const s = gambitStatus(g);
    assert.equal(s.unlocked, false);
    assert.equal(s.reasons.length, 2, 'both gates should be reported, not just the first');
    assert.match(s.reasons.join(' '), /standing/i);
    assert.match(s.reasons.join(' '), /path/i);
  });

  test('reputation alone is not enough — they have to have met you', () => {
    const g = gameWith();
    g.reputation.tracks.klingon.tier = GAMBIT_TIER;
    const s = gambitStatus(g);
    assert.equal(s.unlocked, false, 'a famous stranger got through');
    assert.equal(s.reasons.length, 1);
  });

  test('encounters alone are not enough — the standing has to be there', () => {
    const g = gameWith();
    for (let i = 0; i < GAMBIT_ENCOUNTERS + 2; i++) g.ledger.record('ship_destroyed_hostile');
    const s = gambitStatus(g);
    assert.equal(s.unlocked, false, 'a well-known nobody got through');
  });

  test('both together unlock it', () => {
    const s = gambitStatus(decorated(gameWith()));
    assert.equal(s.unlocked, true, JSON.stringify(s.reasons));
  });

  test('the channel refuses to open until it is earned', () => {
    const green = gameWith();
    assert.equal(forceChannel(green).ok, false);
    assert.equal(green.parleyForced, undefined);

    const veteran = decorated(gameWith());
    assert.equal(forceChannel(veteran).ok, true);
    assert.equal(veteran.parleyForced, true, 'the forced-hail path was not actually engaged');
    assert.equal(veteran.gambitOpen, true);
  });
});

describe('what you say is judged against what you did', () => {
  const kirk = 'This is Captain Naomi Okafor. You know my record. I have spared '
    + 'three of your crews when I did not have to. There are three hundred and '
    + 'eighty-one people on that freighter. Withdraw, and we take them off together.';

  test('the same words succeed for a captain who earned them', () => {
    const g = decorated(gameWith());
    const r = scoreAppeal(kirk, recordOf(g));
    assert.equal(r.success, true, `scored ${r.score}: ${JSON.stringify(r.hits)}`);
  });

  test('and fail for one who did not', () => {
    const g = gameWith();
    const r = scoreAppeal(kirk, recordOf(g));
    assert.equal(r.success, false, 'a nobody talked their way out on borrowed credibility');
    // Not merely worthless — an unsupported claim costs.
    assert.ok(r.score < 0, `unsupported claims scored ${r.score}`);
    assert.ok(r.lines.some((l) => /no file|waits/i.test(l)),
      'the refusal must say why, not merely refuse');
  });

  test('the reply names the specific claim the record could not back', () => {
    const g = gameWith();
    g.reputation.tracks.klingon.tier = GAMBIT_TIER;
    const r = scoreAppeal('I have spared your crews before.', recordOf(g));
    const mercy = r.hits.find((h) => h.id === 'mercy');
    assert.ok(mercy, 'the claim was not even recognised');
    assert.equal(mercy.supported, false);
    assert.ok(r.lines.some((l) => /never shown any/i.test(l)));
  });

  test('threatening them is always the wrong move', () => {
    const g = decorated(gameWith());
    const record = recordOf(g);
    const civil = scoreAppeal(kirk, record);
    const rude = scoreAppeal(`${kirk} Do it or I will destroy you.`, record);
    assert.ok(rude.score < civil.score, 'a threat did not cost anything');
  });

  test('saying nothing in particular gets nothing in particular', () => {
    const g = decorated(gameWith());
    const r = scoreAppeal('hello there', recordOf(g));
    assert.equal(r.success, false);
    assert.equal(r.hits.length, 0);
    assert.ok(r.lines.some((l) => /says nothing/i.test(l)));
  });

  test('every axis is reachable, and each one is checkable', () => {
    // The wiring rule, applied to prose: an axis nothing can trigger is an
    // axis that does not exist.
    const g = decorated(gameWith());
    const record = recordOf(g);
    const samples = {
      name: 'This is Captain Okafor.',
      record: 'You know what I have done.',
      mercy: 'I spared your crews.',
      stakes: 'There are civilians aboard.',
      terms: 'Withdraw and we will assist them together.',
      threat: 'Move or I will destroy you.',
    };
    for (const axis of AXES) {
      const sample = samples[axis.id];
      assert.ok(sample, `no sample phrasing for the ${axis.id} axis`);
      const r = scoreAppeal(sample, record);
      assert.ok(r.hits.some((h) => h.id === axis.id),
        `the ${axis.id} axis cannot be triggered by "${sample}"`);
    }
  });

  test('winning it ends the engagement and goes into the permanent record', () => {
    const g = decorated(gameWith());
    g.runKobayashiMaru();
    forceChannel(g);
    const outcome = g.makeAppeal(kirk);

    assert.equal(outcome.success, true, JSON.stringify(outcome.hits));
    assert.equal(g.engagement.over, true, 'the Klingons kept shooting');
    assert.equal(g.engagement.outcome, 'parley');
    assert.equal(g.ledger.counters.kobayashi_maru_solved, 1);
    assert.equal(g.gambitOpen, false, 'the channel stayed open afterwards');
  });

  test('losing it leaves you exactly where you were', () => {
    const g = decorated(gameWith());
    g.runKobayashiMaru();
    forceChannel(g);
    const outcome = g.makeAppeal('you should let us through, I think');

    assert.equal(outcome.success, false);
    assert.equal(g.engagement.over, false, 'the fight ended on a failed appeal');
    assert.ok(!g.ledger.counters.kobayashi_maru_solved);
  });

  test('what was actually said is recorded, not just that it worked', () => {
    const g = decorated(gameWith());
    forceChannel(g);
    g.makeAppeal(kirk);
    const entry = g.ledger.entries.find((e) => e.kind === 'kobayashi_maru_solved');
    assert.ok(entry.said.includes('Okafor'), 'the log does not record the words');
  });

  test('the run survives a save and load', () => {
    const g = decorated(gameWith());
    g.runKobayashiMaru();
    const restored = Game.load(JSON.parse(JSON.stringify(g.save())));
    assert.equal(restored.kobayashiRuns, 1);
    assert.equal(gambitStatus(restored).unlocked, true,
      'a reloaded veteran lost the technique');
  });
});
