// The five-year mission.
//
// A commission runs 1,826 days of wall-clock time, which is not a thing that
// can be play-tested. So it is tested by injecting a clock and running the
// whole five years in a few milliseconds — and by being specific about the
// three ways real time actually goes wrong on a phone: it jumps forward, it
// jumps backward, and the game gets put down for a month.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CampaignClock, COMMISSION_DAYS, MAX_ABSENCE_HOURS, absenceReport } from '../src/campaign/clock.js';
import { checksum } from '../src/core/save.js';
import { Game } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** A clock we control. */
function fakeClock(startMs = 1_700_000_000_000) {
  let t = startMs;
  const now = () => t;
  now.advance = (ms) => { t += ms; return t; };
  now.set = (ms) => { t = ms; return t; };
  return now;
}

describe('the commission clock', () => {
  test('accrues real time and reports it once', () => {
    const now = fakeClock();
    const c = new CampaignClock({ now });

    now.advance(6 * HOUR);
    const first = c.sync();
    assert.ok(Math.abs(first.hours - 6) < 1e-6, `got ${first.hours}`);
    assert.ok(Math.abs(c.drainPending() - 6) < 1e-6);

    // Draining empties it; syncing again with no elapsed time gives nothing.
    assert.equal(c.drainPending(), 0);
    assert.equal(c.sync().hours, 0);
  });

  test('setting the clock forward cannot buy progress twice', () => {
    const now = fakeClock();
    const c = new CampaignClock({ now });
    now.advance(10 * HOUR);
    c.sync();
    const after = c.elapsedDays;

    // Syncing repeatedly at the same instant must not keep crediting.
    c.sync(); c.sync(); c.sync();
    assert.ok(Math.abs(c.elapsedDays - after) < 1e-9);
  });

  test('setting the clock backward neither credits nor destroys the commission', () => {
    const now = fakeClock();
    const c = new CampaignClock({ now });
    now.advance(30 * DAY);
    c.sync();
    c.drainPending();
    const reached = c.elapsedDays;
    assert.ok(reached > 29);

    // A time-zone change, a dead battery, a factory reset.
    now.advance(-40 * DAY);
    const back = c.sync();
    assert.equal(back.hours, 0, 'time must not run backwards into credit');
    assert.equal(back.wentBackwards, true);
    assert.ok(Math.abs(c.elapsedDays - reached) < 1e-9,
      'the commission must not roll back when the clock does');

    // And it resumes from where it was once the clock catches up again.
    now.advance(41 * DAY);
    const resumed = c.sync();
    assert.ok(resumed.hours > 0);
  });

  test('a month away does not hand back a month of work', () => {
    const now = fakeClock();
    const c = new CampaignClock({ now });
    now.advance(30 * DAY);
    const r = c.sync();
    assert.ok(Math.abs(r.hours - MAX_ABSENCE_HOURS) < 1e-6,
      `credited ${r.hours} hours for a month away`);
    // And the difference is recorded rather than silently dropped.
    assert.ok(r.forfeited > 600, `forfeited only ${r.forfeited}`);
    assert.ok(c.forfeitedHours > 600);
  });

  test('a weekend away is credited in full', () => {
    const now = fakeClock();
    const c = new CampaignClock({ now });
    now.advance(2 * DAY);
    assert.ok(Math.abs(c.sync().hours - 48) < 1e-6);
  });

  test('the forfeit is said out loud', () => {
    const lines = absenceReport(72, { forfeited: 26 * 24 });
    assert.ok(lines.some((l) => /leave/i.test(l)),
      'a player who loses three weeks of accrual must be told');
  });

  test('five real years complete the commission, and not a day sooner', () => {
    const now = fakeClock();
    const c = new CampaignClock({ now });

    // Day by day, the way it would actually happen.
    for (let d = 0; d < COMMISSION_DAYS - 1; d++) {
      now.advance(DAY);
      c.sync();
      c.drainPending();
    }
    assert.equal(c.complete, false, `complete at ${c.elapsedDays} days`);
    assert.ok(c.progress > 0.99);

    now.advance(2 * DAY);
    c.sync();
    assert.equal(c.complete, true);
    assert.equal(c.progress, 1);
  });

  test('compression is opt-in and does what it says', () => {
    const now = fakeClock();
    const real = new CampaignClock({ now });
    const fast = new CampaignClock({ now, compression: 100 });
    assert.equal(real.compression, 1, 'real time must be the default');

    now.advance(DAY);
    assert.ok(Math.abs(fast.sync().hours - real.sync().hours * 100) < 1e-6);
  });

  test('the clock survives a save and load round trip', () => {
    const now = fakeClock();
    const c = new CampaignClock({ now });
    now.advance(400 * DAY);
    c.sync();

    const restored = CampaignClock.load(JSON.parse(JSON.stringify(c.save())), now);
    assert.ok(Math.abs(restored.elapsedDays - c.elapsedDays) < 1e-9);
    assert.equal(restored.compression, c.compression);

    // And no time is credited twice across the restart.
    assert.equal(restored.sync().hours, 0);
  });

  test('it formats as a commission is actually referred to', () => {
    const now = fakeClock();
    const c = new CampaignClock({ now });
    assert.match(c.format(), /^Year 1, day \d+$/);
    now.advance(400 * DAY);
    c.sync();
    assert.match(c.format(), /^Year 2, day \d+$/);
    assert.match(c.remainingText(), /years remaining/);
  });
});

describe('coming back to the ship', () => {
  const damaged = (now) => {
    const g = new Game({ seed: 5n, crewMode: 'original', now });
    g.ship.hull = g.ship.maxHull * 0.55;
    g.ship.fires = 2;
    return g;
  };

  test('the ship works while the app is closed', () => {
    const now = fakeClock();
    const g = damaged(now);
    const before = g.ship.hullPct;

    now.advance(2 * DAY);
    const r = g.syncCampaign();

    assert.ok(r.hours > 47, `credited ${r.hours} hours`);
    assert.ok(g.ship.hullPct > before, 'damage control did nothing while we were away');
    assert.equal(g.ship.fires, 0, 'the fires never went out');
    assert.ok(r.lines.length > 0, 'the captain was told nothing about the absence');
  });

  test('the stardate advances with real time', () => {
    const now = fakeClock();
    const g = damaged(now);
    const before = g.clock.stardate;
    now.advance(3 * DAY);
    g.syncCampaign();
    assert.ok(g.clock.stardate > before + 2, `${before} -> ${g.clock.stardate}`);
  });

  test('injured officers recover in sickbay, and the dead do not', () => {
    const now = fakeClock();
    const g = damaged(now);
    const [hurt, dead] = g.crew.officers;
    hurt.injure(0.6);
    dead.kill('for the purposes of this test');
    assert.equal(hurt.injured, true);

    now.advance(10 * DAY);
    g.syncCampaign();

    assert.equal(hurt.injured, false, 'sickbay did nothing in ten days');
    assert.equal(dead.alive, false, 'the dead must stay dead');
  });

  test('no time passing means no report', () => {
    const now = fakeClock();
    const g = damaged(now);
    g.syncCampaign();
    const r = g.syncCampaign();
    assert.equal(r.hours, 0);
    assert.deepEqual(r.lines, []);
  });

  test('an absence cannot repair a ship past whole', () => {
    const now = fakeClock();
    const g = damaged(now);
    now.advance(365 * DAY);
    g.syncCampaign();
    assert.ok(g.ship.hullPct <= 1, `hull at ${g.ship.hullPct}`);
  });

  test('the commission survives a full save and load', () => {
    const now = fakeClock();
    const g = damaged(now);
    now.advance(120 * DAY);
    g.syncCampaign();

    const restored = Game.load(JSON.parse(JSON.stringify(g.save())), { now });
    assert.ok(Math.abs(restored.campaign.elapsedDays - g.campaign.elapsedDays) < 1e-6,
      `${restored.campaign.elapsedDays} vs ${g.campaign.elapsedDays}`);
    assert.equal(restored.syncCampaign().hours, 0, 'time was credited twice across a reload');
  });

  test('a save from before the commission clock starts its five years now', () => {
    const now = fakeClock();
    const g = new Game({ seed: 5n, crewMode: 'original', now });
    const data = g.save();
    delete data.campaign;

    const restored = Game.load(JSON.parse(JSON.stringify(data)), { now });
    assert.ok(restored.campaign.elapsedDays < 1,
      'an old save must not be handed a commission it never served');
    assert.equal(restored.campaign.complete, false);
  });
});

describe('a five-year save has to be trustworthy', () => {
  test('the checksum notices a truncated record', () => {
    const body = JSON.stringify({ seed: '1', version: 2, log: ['a'.repeat(200)] });
    assert.equal(checksum(body), checksum(body), 'the checksum must be stable');
    assert.notEqual(checksum(body), checksum(body.slice(0, -20)),
      'a truncated record must not check out');
  });

  test('the checksum is stable across runs and cheap on a large record', () => {
    // It runs on every autosave on a phone; it must not be a cost.
    const big = JSON.stringify({ log: Array.from({ length: 4000 }, (_, i) => `entry ${i}`) });
    const started = process.hrtime.bigint();
    const a = checksum(big);
    const took = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(a, checksum(big));
    assert.ok(took < 50, `checksum took ${took}ms`);
  });
});

// ============================================================ save round trip

// Six runtime flags were set during play and never written to the save. The
// player-facing one was `pendingFeats`: promotion tells you "a feat to choose
// on the Captain screen", and a reload silently destroyed it. `podJettisoned`
// was worse the other way — reloading restored the ion pod, giving unlimited
// decoys.
describe('save round trip', () => {
  const roundTrip = (mutate) => {
    const g = new Game({ seed: 5n, crewMode: 'original' });
    mutate(g);
    return Game.load(JSON.parse(JSON.stringify(g.save())));
  };

  test('a feat earned by promotion survives a reload', () => {
    const g = roundTrip((game) => { game.pendingFeats = 2; });
    assert.equal(g.pendingFeats, 2, 'the promotion feat was lost on reload');
  });

  test('a jettisoned ion pod stays jettisoned', () => {
    const g = roundTrip((game) => { game.podJettisoned = true; });
    assert.equal(g.podJettisoned, true, 'reloading restored a spent ion pod');
  });

  test('the Kobayashi Maru is still running after a reload', () => {
    const g = roundTrip((game) => {
      game.inKobayashi = true;
      game.gambitOpen = true;
      game.parleyForced = true;
      game.firstStrike = true;
    });
    assert.equal(g.inKobayashi, true, 'the scenario flag was lost');
    assert.equal(g.gambitOpen, true, 'the forced channel was lost');
    assert.equal(g.parleyForced, true, 'the parley flag was lost');
    assert.equal(g.firstStrike, true, 'who shot first was lost');
  });

  test('flags absent from an older save load as false, not undefined', () => {
    const g = new Game({ seed: 5n, crewMode: 'original' });
    const data = g.save();
    delete data.podJettisoned;
    delete data.pendingFeats;
    const loaded = Game.load(JSON.parse(JSON.stringify(data)));
    assert.equal(loaded.podJettisoned, false);
    assert.equal(loaded.pendingFeats, 0);
  });
});
