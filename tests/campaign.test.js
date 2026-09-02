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

  test('a forced channel does not survive a reload', () => {
    // This test used to assert the opposite, and the opposite was a hole.
    //
    // An engagement cannot be saved, so restoring the flags that belong to one
    // left the order line hijacked with nobody on the other end: the next thing
    // the player typed after resuming was swallowed as an appeal to a Klingon
    // commander who was not there, and if it scored, it wrote
    // `kobayashi_maru_solved` into the permanent record and paid the
    // reputation. The no-win scenario could be beaten by force-quitting it.
    const g = roundTrip((game) => {
      game.inKobayashi = true;
      game.gambitOpen = true;
      game.parleyForced = true;
      game.firstStrike = true;
    });
    assert.equal(g.engagement, null, 'a fight was somehow restored');
    assert.equal(g.gambitOpen, false, 'the channel came back open to nobody');
    assert.equal(g.parleyForced, false, 'the parley flag outlived its fight');
    assert.equal(g.inKobayashi, false, 'the scenario outlived the engagement that was it');
    // This assertion used to read `true`, and it was the one flag the fix
    // above did not move.
    //
    // `firstStrike` belongs to a fight exactly as much as the other three do.
    // It is set by opening fire on an encounter that was not hostile, and
    // `finishCombat` clears it on the line immediately after
    // `this.engagement = null`. Nothing else in the game clears it. So the old
    // behaviour was incoherent in both directions: play the fight out and the
    // flag is gone in seconds; force-quit the same fight and it lasts the rest
    // of the commission, taking a quarter off the chance of being heard on
    // every hail, against every faction, anywhere in the galaxy — for a shot
    // fired at people who are no longer there.
    //
    // If shooting first were meant to be remembered, it would be remembered in
    // the ledger, which is what standing is for, and finishing the fight would
    // not wipe it.
    assert.equal(g.firstStrike, false, 'who shot first outlived the fight it was about');
  });

  test('and an appeal into that silence is refused, not scored', () => {
    const g = roundTrip((game) => {
      game.reputation.tracks.klingon.tier = 5;
      for (let i = 0; i < 4; i++) game.ledger.record('ship_destroyed_hostile');
      for (let i = 0; i < 3; i++) game.ledger.record('ship_spared');
      game.inKobayashi = true;
      game.gambitOpen = true;
    });
    const r = g.makeAppeal('You know my record. I have spared three of your crews. Let them go.');
    assert.equal(r.success, false, 'the no-win scenario was won on an empty bridge');
    assert.ok(!g.ledger.counters.kobayashi_maru_solved,
      'a permanent record was written for a fight that never happened');
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

// ========================================================== the backup ring

// The ring exists for one stated reason, in save.js's own words: not
// "presenting a blank bridge to somebody four years into a commission".
//
// It was defeated by its own legacy escape hatch. readRecord trusts any stored
// value that is valid JSON but not shaped like a checksummed record, on the
// grounds that saves written before checksums existed are plain payloads. That
// is true, and the test for it was too weak: `{"hello":"world"}` and `[]` are
// also valid JSON that is not shaped like a checksummed record.
//
// Corrupt an autosave into anything that still parses and loadSave returned the
// junk instead of walking the ring. main.js catches the resulting Game.load
// failure and offers a NEW GAME — with three good backups sitting unused.
describe('the backup ring', () => {
  const makeStore = () => {
    const map = new Map();
    return {
      map,
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, v),
      removeItem: (k) => map.delete(k),
      key: (i) => [...map.keys()][i] ?? null,
      get length() { return map.size; },
    };
  };

  const autosaveKey = (store) => [...store.map.keys()].find((k) => !k.includes('backup'));

  /** Save `n` generations, then replace the live autosave with `junk`. */
  const withCorruptAutosave = async (junk, generations = 3) => {
    globalThis.localStorage = makeStore();
    const save = await import('../src/core/save.js');
    let last;
    for (let gen = 1; gen <= generations; gen++) {
      const g = new Game({ seed: BigInt(gen), crewMode: 'original' });
      g.latinum = 1000 + gen;
      last = g.latinum;
      save.saveGame(g);
    }
    globalThis.localStorage.map.set(autosaveKey(globalThis.localStorage), junk);
    return { loaded: save.loadSave(), newest: last };
  };

  test('a clean save round-trips without claiming a recovery', async () => {
    globalThis.localStorage = makeStore();
    const save = await import('../src/core/save.js');
    const g = new Game({ seed: 11n, crewMode: 'original' });
    g.latinum = 4242;
    assert.equal(save.saveGame(g), true);

    const loaded = save.loadSave();
    assert.ok(loaded, 'a save written to a clean store did not come back');
    assert.equal(loaded.latinum, 4242);
    assert.ok(!loaded.recoveredFromBackup, 'a clean save claimed it came from a backup');
  });

  test('junk that happens to be valid JSON does not defeat the ring', async () => {
    for (const junk of ['{"hello":"world"}', '[]', '{"body":123}', '{"sum":1}', '"a string"', '42']) {
      const { loaded, newest } = await withCorruptAutosave(junk);
      assert.ok(loaded, `${junk}: the commission was lost outright`);
      assert.ok(loaded.recoveredFromBackup,
        `${junk}: returned the junk instead of walking the ring`);
      assert.ok(loaded.seed, `${junk}: recovered something with no seed`);
      assert.ok(loaded.latinum <= newest, `${junk}: recovered a save from the future`);
    }
  });

  test('the older corruptions still recover', async () => {
    for (const junk of ['', 'not json at all {{{', '{"sum":"x","body":"truncated']) {
      const { loaded } = await withCorruptAutosave(junk);
      assert.ok(loaded?.recoveredFromBackup, `${junk}: did not recover`);
    }
  });

  test('a genuine pre-checksum save still loads', async () => {
    // This is what the escape hatch is for, and it has to keep working.
    globalThis.localStorage = makeStore();
    const save = await import('../src/core/save.js');
    const g = new Game({ seed: 12n, crewMode: 'original' });
    g.latinum = 777;
    save.saveGame(g);
    // Rewrite it in the old format: the bare payload, no checksum wrapper.
    const store = globalThis.localStorage;
    const wrapped = JSON.parse(store.map.get(autosaveKey(store)));
    store.map.set(autosaveKey(store), wrapped.body);

    const loaded = save.loadSave();
    assert.ok(loaded, 'a legacy save was rejected');
    assert.equal(loaded.latinum, 777);
    assert.ok(!loaded.recoveredFromBackup, 'a valid legacy save was treated as corrupt');
  });

  test('when everything is corrupt it fails honestly rather than throwing', async () => {
    globalThis.localStorage = makeStore();
    const save = await import('../src/core/save.js');
    save.saveGame(new Game({ seed: 13n, crewMode: 'original' }));
    for (const k of [...globalThis.localStorage.map.keys()]) {
      globalThis.localStorage.map.set(k, '{"not":"a save"}');
    }
    assert.equal(save.loadSave(), null, 'returned data when every record was junk');
  });
});
