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
import { DIFFICULTIES } from '../src/rules/difficulty.js';
import {
  SCENARIO, AXES, GAMBIT_TIER, GAMBIT_ENCOUNTERS,
  gambitStatus, recordOf, scoreAppeal, forceChannel, resolveGambit,
} from '../src/missions/kobayashi.js';

const gameWith = (opts = {}) => new Game({ seed: 3n, crewMode: 'original', ...opts });

/** Put the ship in a fight, so there is somebody to hail. */
function inAFight(g) {
  g.runKobayashiMaru();
  return g;
}

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

  // This test used to drive the engagement with `g.update()` and no orders at
  // all — an idle captain, who dies to anything. It passed, and it was
  // measuring nothing. Played properly (chase the target, come about, fire,
  // evade) Story mode won 200 runs out of 200 at 66% hull, because Story hands
  // out +35% damage, +60% shield regen and takes 35% off every enemy hull.
  //
  // A no-win scenario has to be no-win for a player who is trying.
  const playItToWin = (g, ticks = 40000) => {
    const eng = g.engagement;
    for (let t = 0; t < ticks && !eng.over; t++) {
      if (!eng.target || eng.target.destroyed) eng.cycleTarget();
      const mark = eng.target ?? eng.liveHostiles[0];
      if (mark) eng.comeAboutTo(mark);
      eng.setThrottle(1);
      eng.evasive(true);
      eng.fireAll();
      g.update(1 / 30);
    }
    return eng;
  };

  test('is unwinnable by fighting, at every difficulty, played to win', () => {
    const beaten = [];
    for (const def of DIFFICULTIES) {
      for (let i = 0; i < 4; i++) {
        const g = new Game({ seed: BigInt(600 + i), crewMode: 'original', difficulty: def.id });
        g.runKobayashiMaru();
        const eng = playItToWin(g);
        if (eng.outcome === 'victory' || eng.outcome === 'routed') beaten.push(`${def.id} @ ${600 + i}`);
        assert.equal(eng.over, true, `${def.id}: the exercise never resolved`);
      }
    }
    assert.deepEqual(beaten, [], 'the freighter was saved by shooting');
  });

  test('the exercise is the same exercise for everyone', () => {
    // Difficulty scales fleets and hulls everywhere else in the game. Fleet
    // Admiral fielded a fourth Klingon here and Story took a third off each
    // hull, which is exactly the tuning the scenario is supposed to be immune
    // to.
    const fleets = DIFFICULTIES.map((def) => {
      const g = new Game({ seed: 5n, crewMode: 'original', difficulty: def.id });
      g.runKobayashiMaru();
      return {
        id: def.id,
        count: g.engagement.hostiles.length,
        hull: Math.round(g.engagement.hostiles[0].maxHull),
        playerDamage: g.ship.mods.damage,
      };
    });
    const first = fleets[0];
    for (const f of fleets) {
      assert.equal(f.count, first.count, `${f.id} fields ${f.count} ships, not ${first.count}`);
      assert.equal(f.hull, first.hull, `${f.id} faces ${f.hull} hull, not ${first.hull}`);
      assert.equal(f.playerDamage, first.playerDamage,
        `${f.id} flies with a ${f.playerDamage}x damage modifier`);
    }
  });

  test('the difficulty bonuses come back when the exercise ends', () => {
    const g = new Game({ seed: 5n, crewMode: 'original', difficulty: 'story' });
    const campaignDamage = g.ship.mods.damage;
    g.runKobayashiMaru();
    assert.ok(g.ship.mods.damage < campaignDamage, 'the simulator kept the Story bonuses');
    g.engagement.end('destroyed');
    g.finishCombat('destroyed');
    assert.equal(g.ship.mods.damage, campaignDamage,
      'the campaign never got its difficulty modifiers back');
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
    // In a fight, because that is what the technique is for. Forcing a channel
    // reroutes the order line into an appeal, so doing it with nobody out
    // there left every later order being read as a speech to a Klingon
    // commander who was never present.
    const green = inAFight(gameWith());
    assert.equal(forceChannel(green).ok, false);
    assert.equal(green.parleyForced, undefined);

    const veteran = inAFight(decorated(gameWith()));
    assert.equal(forceChannel(veteran).ok, true);
    assert.equal(veteran.parleyForced, true, 'the forced-hail path was not actually engaged');
    assert.equal(veteran.gambitOpen, true);
  });

  test('and refuses when there is nobody on the other end', () => {
    const veteran = decorated(gameWith());
    const r = forceChannel(veteran);
    assert.equal(r.ok, false, 'a channel was forced open to an empty system');
    assert.equal(veteran.gambitOpen, undefined);
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
    const g = inAFight(decorated(gameWith()));
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

// ========================================================= channel lifecycle

// `gambitOpen` reroutes the order line: whatever you type becomes something you
// say to the Klingon commander rather than an order to your crew. Nothing ever
// closed it except speaking, so forcing the channel and then not speaking left
// every later order for the rest of the session being read as an appeal.
describe('the forced channel closes on its own', () => {
  test('the fight ending closes the channel', () => {
    const g = decorated(gameWith());
    g.runKobayashiMaru();
    assert.equal(forceChannel(g).ok, true);
    assert.equal(g.gambitOpen, true);

    g.engagement.end('destroyed');
    g.finishCombat('destroyed');

    assert.equal(g.gambitOpen, false, 'the channel outlived the engagement');
    assert.equal(g.parleyForced, false, 'the forced-hail flag outlived the engagement');
  });

  test('the channel does not survive leaving the scenario', () => {
    const g = decorated(gameWith());
    g.runKobayashiMaru();
    forceChannel(g);
    g.engagement.end('routed');
    g.finishCombat('routed');
    assert.equal(g.inKobayashi, false, 'the scenario never ended');
    assert.equal(g.gambitOpen, false);
  });

  test('speaking still closes it', () => {
    const g = decorated(gameWith());
    g.runKobayashiMaru();
    forceChannel(g);
    resolveGambit(g, 'This is Captain Kirk.');
    assert.equal(g.gambitOpen, false);
  });
});

// ================================================================ threat axis

// The threat axis matched a bare "force", so declining to use force scored as
// a threat: -3, enough on its own to turn a winning appeal into a losing one.
describe('the threat axis reads what was meant', () => {
  const scored = (text) => scoreAppeal(text, recordOf(decorated(gameWith())));
  const threatened = (text) => scored(text).hits.some((h) => h.id === 'threat');

  test('declining to use force is not a threat', () => {
    assert.equal(threatened('I would rather not use force here.'), false);
    assert.equal(threatened('I have no wish to force this.'), false);
    assert.equal(threatened('There is no need for a show of force.'), false);
  });

  test('an actual threat still costs', () => {
    assert.equal(threatened('Stand down or I will destroy you.'), true);
    assert.equal(threatened('We will fire on your lead cruiser.'), true);
    assert.equal(threatened('I will force you out of this sector.'), true);
  });

  test('offering to surrender is not the captain threatening anyone', () => {
    assert.equal(threatened('I am prepared to surrender my ship for their lives.'), false);
  });
});
