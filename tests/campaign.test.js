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
import { takeCommandOf, COMMAND_LADDER } from '../src/sim/command.js';
import { FEDERATION_REGISTRIES } from '../src/world/ships.data.js';
import { checkAll } from '../src/sim/invariants.js';
import { ARENA_RADIUS } from '../src/sim/combat.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ship } from '../src/sim/ship.js';
import { AWAY_TEMPLATES, HAZARD_LEVEL, awayHours } from '../src/sim/away.js';
import { ABILITY_LIST } from '../src/sim/officers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
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

// ---------------------------------------------------------------------------
// The commission runs while you are on the bridge.
//
// `commissionHours` was written by `syncCampaign` and by nothing else, and
// `syncCampaign` runs on load and when the tab comes back — so the five-year
// mission advanced only while nobody was playing it, and the hours a captain
// sat through were then billed a second time as an absence.

import { SIM_STEP } from '../src/core/time.js';

/** Hold the conn for a span, with the wall clock keeping pace as a phone would. */
function holdTheConn(g, now, hours) {
  const ticks = Math.round(hours * 3600 / SIM_STEP);
  for (let i = 0; i < ticks; i++) {
    now.advance(SIM_STEP * 1000);
    g.update(SIM_STEP);
  }
  return g;
}

describe('time passes while somebody is watching it', () => {
  const hurt = (now, opts = {}) => {
    const g = new Game({ seed: 9n, crewMode: 'original', now, ...opts });
    g.ship.hull = g.ship.maxHull * 0.3;
    return g;
  };

  test('two hours in the chair are two hours of the commission', () => {
    // Measured before the fix: 0.0000 days. The clock only ran when you left.
    const now = fakeClock();
    const g = hurt(now);
    holdTheConn(g, now, 2);
    assert.ok(Math.abs(g.campaign.elapsedDays * 24 - 2) < 0.01,
      `two hours of play advanced the commission by ${(g.campaign.elapsedDays * 24).toFixed(3)} hours`);
  });

  test('and are not then charged again as an absence', () => {
    // The other half, and the one with teeth. Before the fix, backgrounding
    // and immediately foregrounding after two hours of play credited the whole
    // two hours as time away — repairing the hull for them, and having the
    // watch officer report on a watch the captain had stood themselves.
    const now = fakeClock();
    const g = hurt(now);
    holdTheConn(g, now, 2);
    const hull = g.ship.hullPct;

    const r = g.syncCampaign();   // the tab goes away and comes straight back
    assert.equal(r.hours, 0, `credited ${r.hours} hours of absence to a captain who never left`);
    assert.deepEqual(r.lines, [], `reported an absence that did not happen: ${r.lines.join(' / ')}`);
    assert.equal(g.ship.hullPct, hull, 'the same hours repaired the ship twice');
  });

  test('and the same span does the same work, watched or not', () => {
    // The parity that stops "close the app to repair" being a strategy. Two
    // days at the conn and two days ashore have to leave the same ship.
    const atTheConn = fakeClock();
    const played = hurt(atTheConn);
    holdTheConn(played, atTheConn, 48);

    const ashore = fakeClock();
    const left = hurt(ashore);
    ashore.advance(48 * HOUR);
    left.syncCampaign();

    assert.ok(Math.abs(played.ship.hullPct - left.ship.hullPct) < 1e-9,
      `at the conn ${played.ship.hullPct} vs ashore ${left.ship.hullPct}`);
    assert.ok(Math.abs(played.campaign.elapsedDays - left.campaign.elapsedDays) < 1e-6,
      `${played.campaign.elapsedDays} vs ${left.campaign.elapsedDays} days`);
  });

  test('and compression scales the hours in the chair too', () => {
    // Otherwise the setting the game offers for demonstrating a five-year
    // mission would only apply to the part of it nobody is watching.
    const now = fakeClock();
    const g = hurt(now, { compression: 24 });
    holdTheConn(g, now, 2);
    assert.ok(Math.abs(g.campaign.elapsedDays - 2) < 0.01,
      `two hours at x24 gave ${g.campaign.elapsedDays.toFixed(3)} days, not two`);
  });

  test('and a save mid-watch neither loses nor duplicates the banked minutes', () => {
    // Lived time is spent in quarter-hour slices, so there is always a
    // remainder in hand. Dropping it on every save would let a player put the
    // app down and pick it up to keep a job permanently minutes from done.
    const now = fakeClock();
    const g = hurt(now);
    holdTheConn(g, now, 0.1);
    assert.ok(g.livedHours > 0, 'nothing was banked at all');

    const back = Game.load(JSON.parse(JSON.stringify(g.save())), { now });
    assert.ok(Math.abs(back.livedHours - g.livedHours) < 1e-9,
      `banked ${g.livedHours} and reloaded ${back.livedHours}`);
    assert.equal(back.syncCampaign().hours, 0, 'the watch was credited again on reload');
  });

  test('and a fight is still not a repair yard', () => {
    // The guard that was inside `syncCampaign` moved into `passTime`, so it now
    // covers the tick path as well as the absence one — which it has to, since
    // the tick path is the one that runs during a battle.
    const now = fakeClock();
    const g = hurt(now);
    g.engagement = { over: false };
    const hull = g.ship.hullPct;
    holdTheConn(g, now, 6);
    assert.equal(g.ship.hullPct, hull, 'damage control rebuilt the hull mid-engagement');
    assert.ok(g.campaign.elapsedDays > 0.2, 'and time stopped, which it does not');
  });
});

// ---------------------------------------------------------------------------
// A voyage takes the hours it takes.
//
// `Transit.realSeconds` was `clamp(log10(hours + 10) * 9, 4, 26)` and progress
// was `elapsedReal / realSeconds`, so every voyage in the galaxy took between
// four and twenty-six seconds of play whatever its length. Sol to Vulcan at
// warp 8 is 291 hours; it was over in fourteen seconds, and the days it should
// have cost were handed to the calendar in a lump at the door.

/** Compression at which one tick is one commission hour. */
const HOUR_PER_TICK = 108000;

describe('a voyage takes the hours it takes', () => {
  const underway = (opts = {}) => {
    const g = new Game({ seed: 31n, crewMode: 'original', ...opts });
    g.ship.antimatter = g.ship.maxAntimatter;
    assert.equal(g.setCourse('vulcan', 8).ok, true, 'could not lay in the course');
    return g;
  };

  test('a long haul is a long haul and a short hop is not', () => {
    // The measurement the old scale could not make: two voyages of very
    // different lengths took the same fourteen seconds.
    const far = underway({ compression: HOUR_PER_TICK });
    const near = new Game({ seed: 31n, crewMode: 'original', compression: HOUR_PER_TICK });
    near.ship.antimatter = near.ship.maxAntimatter;
    assert.equal(near.setCourse('alpha_centauri', 8).ok, true);
    assert.ok(far.transit.totalHours > near.transit.totalHours * 2,
      `${far.transit.totalHours}h vs ${near.transit.totalHours}h — pick a longer haul`);

    // Fly both for the same span of the commission. The short one must be
    // further along, and by the ratio of their lengths.
    for (const g of [far, near]) {
      for (let i = 0; i < 10 && g.transit; i++) g.update(SIM_STEP);   // ten hours of it
    }
    assert.ok(near.transit.progress > far.transit.progress * 2,
      `after ten hours: near ${near.transit.progress}, far ${far.transit.progress}`);
  });

  test('and ten hours of the commission fly ten hours of it', () => {
    const g = underway({ compression: HOUR_PER_TICK });
    const total = g.transit.totalHours;
    for (let i = 0; i < 10 && g.transit; i++) g.update(SIM_STEP);
    assert.ok(g.transit, `the whole ${total}h voyage finished in ten hours`);
    assert.ok(Math.abs(g.transit.spentHours - 10) < 0.01,
      `flew ${g.transit.spentHours} hours in ten`);
  });

  test('and she arrives while the app is closed', () => {
    // The half that makes it a commission rather than a wait. Lay in a course,
    // put the phone down, come back: the ship is where you sent her.
    const now = fakeClock();
    const g = underway({ now });
    const total = g.transit.totalHours;
    assert.ok(total > MAX_ABSENCE_HOURS, `pick a voyage longer than one absence (${total}h)`);

    now.advance(Math.ceil(total + 1) * HOUR);
    g.syncCampaign();

    assert.equal(g.transit, null, `still under way after ${total} hours away`);
    assert.equal(g.locationId, 'vulcan', `woke up at ${g.locationId}`);
  });

  test('and the calendar is not paid twice for the same trip', () => {
    // Arrival used to hand the clock the whole voyage, because the voyage took
    // fourteen seconds and the days had to come from somewhere. They are spent
    // as they pass now, so granting them again would charge for the trip twice.
    const now = fakeClock();
    const g = underway({ now, compression: HOUR_PER_TICK });
    const total = g.transit.totalHours;
    const before = g.clock.stardate;
    for (let i = 0; i < Math.ceil(total) + 50 && g.transit; i++) g.update(SIM_STEP);
    assert.equal(g.transit, null, 'never arrived');

    const days = g.clock.stardate - before;
    assert.ok(Math.abs(days - total / 24) < 0.5,
      `a ${(total / 24).toFixed(1)}-day voyage moved the calendar ${days.toFixed(1)} days`);
  });

  test('and a record written on the old scale resumes where it left off', () => {
    // Saves already on phones carry `elapsedReal` against the old four-to-
    // twenty-six-second budget. Read as hours it would strand a ship eleven
    // seconds into a twelve-day run; read as the fraction it stood for, a
    // captain three quarters of the way to Vulcan is still three quarters of
    // the way to Vulcan.
    const g = underway();
    const total = g.transit.totalHours;
    const record = JSON.parse(JSON.stringify(g.save()));
    delete record.transit.spentHours;
    const budget = Math.max(4, Math.min(26, Math.log10(total + 10) * 9));
    record.transit.elapsedReal = budget * 0.75;

    const back = Game.load(record);
    assert.ok(back.transit, 'the old voyage did not load at all');
    assert.ok(Math.abs(back.transit.progress - 0.75) < 1e-6,
      `resumed at ${back.transit.progress} rather than three quarters`);
    assert.ok(Math.abs(back.transit.spentHours - total * 0.75) < 1e-6,
      `resumed ${back.transit.spentHours} hours into a ${total}-hour voyage`);
  });

  test('and breaking off part way does not refund the hours flown', () => {
    const g = underway({ compression: HOUR_PER_TICK });
    const before = g.clock.stardate;
    while (g.transit && g.transit.progress < 0.5) g.update(SIM_STEP);
    assert.ok(g.transit, 'the voyage finished before it could be broken off');
    const flown = g.transit.spentHours;
    assert.ok(g.dropOutOfWarp().ok, 'the order to break off was refused');
    const moved = (g.clock.stardate - before) * 24;
    assert.ok(Math.abs(moved - flown) < 1, `flew ${flown}h and the calendar moved ${moved}h`);
  });
});

// ---------------------------------------------------------------------------
// A landing party costs time, and a world is done with once.
//
// Measured before this: thirty-two diplomatic landings at Vulcan back to back,
// 190 experience, stardate 4523.3 -> 4523.3. The same two officers opened the
// same discussion with the same government thirty-two times in an afternoon
// and were paid for it every time — the only free action in a game where a
// repair costs most of a day and docking costs two.

describe('a landing party costs time, and a world is done with once', () => {
  const inOrbitAt = (where, seed = 8n) => {
    const g = new Game({ seed, crewMode: 'original' });
    g.locationId = where;
    assert.ok(g.enterOrbit().ok, `could not make orbit at ${where}`);
    return g;
  };

  test('thirty-two landings at Vulcan are one landing at Vulcan', () => {
    const g = inOrbitAt('vulcan');
    let ran = 0;
    let refusal = null;
    for (let i = 0; i < 32; i++) {
      const r = g.awayMission('diplomatic_landing');
      if (!r.ok) { refusal = r.reason; break; }
      ran++;
    }
    assert.equal(ran, 1, `${ran} landings at the same world`);
    assert.match(refusal ?? '', /nowhere to send/i, `refused with: ${refusal}`);
    assert.deepEqual(g.availableAwayMissions().map((t) => t.id), [],
      'the offer came back at a world already done with');
  });

  test('and it charged the hours the hazard says it takes', () => {
    const g = inOrbitAt('vulcan');
    const before = { sd: g.clock.stardate, days: g.campaign.elapsedDays };
    const r = g.awayMission('diplomatic_landing');
    assert.equal(r.ok, true, r.reason);

    const hazard = HAZARD_LEVEL[AWAY_TEMPLATES.diplomatic_landing.hazard];
    assert.equal(r.hours, hazard.hours, `charged ${r.hours}h for a ${hazard.id} landing`);
    // Both clocks, and by the same amount. One of them used not to move at all.
    assert.ok(Math.abs((g.clock.stardate - before.sd) * 24 - hazard.hours) < 1e-6,
      `the calendar moved ${(g.clock.stardate - before.sd) * 24} hours`);
    assert.ok(Math.abs((g.campaign.elapsedDays - before.days) * 24 - hazard.hours) < 1e-6,
      `the commission moved ${(g.campaign.elapsedDays - before.days) * 24} hours`);
  });

  test('and a more dangerous world keeps the party down longer', () => {
    // The whole of what "time by hazard" means, asserted against the table
    // rather than against numbers copied out of it.
    const levels = ['routine', 'elevated', 'dangerous', 'extreme']
      .map((id) => HAZARD_LEVEL[id].hours);
    for (let i = 1; i < levels.length; i++) {
      assert.ok(levels[i] > levels[i - 1],
        `hazard ${i} is ${levels[i]}h and hazard ${i - 1} is ${levels[i - 1]}h`);
    }
    // Except the one the fiction will not have. A boarding action happens at
    // weapons range in the middle of a battle; a day and a quarter cannot pass.
    assert.ok(awayHours(AWAY_TEMPLATES.boarding_action) < 1,
      `a boarding action takes ${awayHours(AWAY_TEMPLATES.boarding_action)} hours`);
    assert.equal(awayHours(AWAY_TEMPLATES.colony_rescue), HAZARD_LEVEL.elevated.hours,
      'a template with no override should take what its hazard says');
  });

  test('and the next world along is a different world', () => {
    // The control for the assertion above: if "done with" were global rather
    // than per world, the first test would pass for the wrong reason.
    const g = inOrbitAt('vulcan');
    assert.equal(g.awayMission('diplomatic_landing').ok, true);
    g.locationId = 'andoria';
    assert.ok(g.enterOrbit().ok);
    assert.ok(g.availableAwayMissions().some((t) => t.id === 'diplomatic_landing'),
      'a world nobody has landed on refused a landing party');
  });

  test('and failing does not re-arm the offer', () => {
    // Otherwise retrying until it works is the correct play, and a colony you
    // failed to evacuate is a colony you evacuate on the fourth attempt.
    const g = inOrbitAt('vulcan');
    const r = g.awayMission('diplomatic_landing');
    assert.equal(r.ok, true);
    // Whatever it returned — success, partial or failure — the world is done.
    assert.ok(['success', 'partial', 'failure'].includes(r.outcome), r.outcome);
    assert.deepEqual(g.availableAwayMissions().map((t) => t.id), [],
      `a ${r.outcome} landing left the offer standing`);
  });

  test('and the record of where you have been survives a save', () => {
    const g = inOrbitAt('vulcan');
    assert.equal(g.awayMission('diplomatic_landing').ok, true);
    const back = Game.load(JSON.parse(JSON.stringify(g.save())));
    back.locationId = 'vulcan';
    assert.ok(back.enterOrbit().ok);
    assert.deepEqual(back.availableAwayMissions().map((t) => t.id), [],
      'reloading forgot which worlds had already been landed on');
  });

  test('and the hours the party was down did the ship’s work too', () => {
    // `spendHours` goes through the same `passTime` an absence and the tick
    // loop use, so an afternoon on the surface is an afternoon aboard.
    const g = inOrbitAt('vulcan');
    g.ship.hull = g.ship.maxHull * 0.5;
    const hull = g.ship.hullPct;
    assert.equal(g.awayMission('diplomatic_landing').ok, true);
    assert.ok(g.ship.hullPct > hull,
      `damage control did nothing for the ${HAZARD_LEVEL.routine.hours} hours the party was down`);
  });
});

// ---------------------------------------------------------------------------
// One clock.
//
// `advanceStardate` had fifteen callers, each with its own number in days, and
// not one of them touched the commission clock. That is how the bridge came to
// show a stardate that had wandered a year and a half from a commission still
// on day one: twenty-five hops moved one number and left the other where it
// started. Every order that costs time goes through `spendHours` now, and the
// date has three callers left — time going by, an order that cost some, and an
// absence.

describe('one clock', () => {
  /** Every order in the game that costs the captain time. */
  const TIMED_ORDERS = {
    'a long-range scan': (g) => g.sensorSweep(),
    'ordered repairs': (g) => { g.ship.hull = g.ship.maxHull * 0.5; return g.effectRepairs(); },
    'docking': (g) => { g.ship.hull = g.ship.maxHull * 0.5; return g.dock(); },
    'an afternoon at the bench': (g) => {
      g.ship.hull = g.ship.maxHull * 0.9;
      assert.ok(g.fabricate('hull_patch').ok !== false, 'nothing went on the bench');
      return g.workTheShop(8);
    },
    'a landing party': (g) => {
      g.locationId = 'vulcan';
      assert.ok(g.enterOrbit().ok);
      return g.awayMission('diplomatic_landing');
    },
    'training an officer': (g) => {
      // Named against the real table rather than a guessed accessor. An
      // ability the officer already holds, or one above the captain's rank,
      // is refused — and a refused order that costs no time would make this
      // row of the table pass for the wrong reason, which the `moved` count
      // below is there to catch.
      // In their own department, within the captain's clearance, and not one
      // they already hold — `trainOfficer` refuses all three, and a refusal
      // costs no time, which would make this row pass for the wrong reason.
      let pair = null;
      for (const o of g.crew.officers.filter((x) => x.alive && !x.injured)) {
        const a = ABILITY_LIST.find((x) => x.dept === o.dept
          && x.rank <= g.progress.rank.tier
          && !o.abilities.includes(x.id));
        if (a) { pair = { officer: o, ability: a }; break; }
      }
      assert.ok(pair, 'nobody aboard could be trained in anything');
      const r = g.trainOfficer(pair.officer, pair.ability.id);
      assert.equal(r.ok !== false, true, `training was refused: ${r?.reason}`);
      return r;
    },
  };

  test('every order that costs time moves both clocks by the same amount', () => {
    // The measurement that names the whole defect. Before this, each of these
    // moved the stardate and left the commission where it was.
    const disagreed = [];
    let moved = 0;
    for (const [what, order] of Object.entries(TIMED_ORDERS)) {
      const g = new Game({ seed: 12n, crewMode: 'original' });
      const sd = g.clock.stardate;
      const days = g.campaign.elapsedDays;
      order(g);
      const onTheDate = (g.clock.stardate - sd) * 24;
      const onTheCommission = (g.campaign.elapsedDays - days) * 24;
      if (onTheDate > 0) moved++;
      if (Math.abs(onTheDate - onTheCommission) > 1e-6) {
        disagreed.push(`${what}: date ${onTheDate.toFixed(2)}h, commission ${onTheCommission.toFixed(2)}h`);
      }
    }
    // The control: an order list where nothing costs time would pass the
    // agreement check trivially.
    assert.ok(moved === Object.keys(TIMED_ORDERS).length,
      `only ${moved} of ${Object.keys(TIMED_ORDERS).length} orders cost any time at all`);
    assert.deepEqual(disagreed, [], 'orders where the two clocks disagree');
  });

  test('and the date is moved by three things and no others', () => {
    // Read from the source, because this is a claim about the shape of the code
    // and no behavioural test can see a fourth caller being added.
    const src = readFileSync(join(HERE, '..', 'src', 'core', 'state.js'), 'utf8');
    const callers = src.split('\n').filter((l) => /clock\.advanceStardate\(/.test(l));
    assert.equal(callers.length, 3,
      `advanceStardate has ${callers.length} callers in state.js:\n  ${callers.join('\n  ')}`);
    for (const dir of ['main.js', 'missions/engine.js']) {
      const other = readFileSync(join(HERE, '..', 'src', dir), 'utf8');
      assert.ok(!/clock\.advanceStardate\(/.test(other),
        `${dir} moves the date by hand instead of through spendHours`);
    }
  });

  test('and an hour at the bench is an hour like any other', () => {
    // `workTheShop` called `advanceFabrication` and `advanceAssignments` itself
    // and nothing else, so its hours were the one span in the game that
    // repaired no hull and healed nobody.
    const g = new Game({ seed: 12n, crewMode: 'original' });
    g.ship.hull = g.ship.maxHull * 0.5;
    assert.ok(g.fabricate('hull_patch').ok !== false);
    const hull = g.ship.hullPct;
    const r = g.workTheShop(8);
    assert.equal(r.ok, true, r.reason ?? r.error);
    assert.ok(g.ship.hullPct > hull,
      'eight hours at the bench and damage control did nothing anywhere else');
  });

  test('and the shop still reports what it finished, exactly once', () => {
    // `spendHours` writes finished work into the log; `workTheShop` reports it
    // through its return value. Both would be two lines for one job.
    const g = new Game({ seed: 12n, crewMode: 'original' });
    g.ship.hull = g.ship.maxHull * 0.5;
    assert.ok(g.fabricate('hull_patch').ok !== false);
    const before = g.log.length;
    const r = g.workTheShop(400);
    assert.equal(r.ok, true, r.reason ?? r.error);
    assert.ok(r.done, 'four hundred hours and the bench was never cleared');
    const said = g.log.slice(before).filter((l) => /is finished, Captain/.test(l.text ?? ''));
    assert.equal(said.length, 0,
      `the shop announced its own job as well as reporting it: ${said.map((l) => l.text).join(' | ')}`);
  });
});

// ---------------------------------------------------------------------------
// Coming back to a ship that has been somewhere.
//
// Now that a course is flown in commission hours rather than in fourteen
// seconds of play, the crossing is the main thing that happens across an
// absence — and it was the one thing the report did not mention. Lay in a
// twelve-day course for Vulcan, close the app, come back to a ship AT Vulcan,
// and the watch officer talked about hull plating. It was in the ship's log
// ("Arrived at Vulcan.") and not in the one report a returning player reads.

describe('coming back to a ship that has been somewhere', () => {
  const bound = (now, opts = {}) => {
    const g = new Game({ seed: 55n, crewMode: 'original', now, ...opts });
    g.ship.antimatter = g.ship.maxAntimatter;
    assert.equal(g.setCourse('vulcan', 8).ok, true);
    return g;
  };

  test('an arrival that happened while you were away is reported', () => {
    const now = fakeClock();
    const g = bound(now);
    const total = g.transit.totalHours;
    now.advance(Math.ceil(total + 5) * HOUR);
    const r = g.syncCampaign();

    assert.equal(g.locationId, 'vulcan', 'never arrived at all');
    const said = r.lines.filter((l) => /vulcan/i.test(l));
    assert.ok(said.length,
      `came back to a ship at Vulcan and was told: ${r.lines.join(' | ')}`);
    assert.match(said[0], /out of warp/i, said[0]);
  });

  test('and a voyage still running is reported, with how far is left', () => {
    const now = fakeClock();
    const g = bound(now);
    const total = g.transit.totalHours;
    now.advance(24 * HOUR);
    const r = g.syncCampaign();

    assert.ok(g.transit, 'the voyage finished when it should not have');
    const said = r.lines.find((l) => /under way for vulcan/i.test(l));
    assert.ok(said, `told nothing about the crossing: ${r.lines.join(' | ')}`);
    // The number has to be the real one, not a placeholder.
    assert.match(said, /\d+ percent of the way/, said);
    assert.match(said, /days out|hours out/, said);
    const pct = Number(said.match(/(\d+) percent/)[1]);
    assert.ok(Math.abs(pct - g.transit.progress * 100) < 1,
      `report says ${pct}% and the transit is at ${(g.transit.progress * 100).toFixed(1)}%`);
    assert.ok(pct > 0 && pct < 100, `a whole voyage or none of it: ${pct}%`);
    void total;
  });

  test('and a ship sitting in orbit is not told about a voyage', () => {
    // The control. A report that always mentions a crossing is not reporting
    // the crossing, it is printing a line.
    const now = fakeClock();
    const g = new Game({ seed: 55n, crewMode: 'original', now });
    g.ship.hull = g.ship.maxHull * 0.5;
    now.advance(24 * HOUR);
    const r = g.syncCampaign();
    assert.ok(r.lines.length, 'no report at all');
    assert.deepEqual(r.lines.filter((l) => /under way|out of warp/i.test(l)), [],
      'a ship that never left Sol was told about a voyage');
  });
});

// ---------------------------------------------------------------------------
// The same leg, flown two ways.
//
// The verification the plan asked for and nothing had run: a commission played
// across a simulated close-and-return has to arrive at the same place with the
// same clock as one watched the whole way. Running it by hand is what turned up
// the NaN tank, because the fingerprints disagreed and the field that disagreed
// was `NaN`.

describe('the same leg, flown two ways', () => {
  const HOURS = 300;   // Sol -> Vulcan at warp 8 is 291.5 of them

  const laidIn = (now) => {
    const g = new Game({ seed: 61n, crewMode: 'original', now, compression: HOUR_PER_TICK });
    g.ship.antimatter = g.ship.maxAntimatter;
    g.ship.hull = g.ship.maxHull * 0.6;
    assert.equal(g.setCourse('vulcan', 8).ok, true, 'could not lay in the course');
    assert.ok(g.transit.totalHours < HOURS,
      `the voyage is ${g.transit.totalHours}h and the test only spends ${HOURS}`);
    return g;
  };

  /** Watched the whole way: one commission hour per tick. */
  const watchedAllTheWay = () => {
    let t = 1_800_000_000_000;
    const g = laidIn(() => t);
    for (let i = 0; i < HOURS; i++) g.update(SIM_STEP);
    return g;
  };

  /** Closed for exactly the same span of the commission. */
  const closedAndResumed = () => {
    let t = 1_800_000_000_000;
    const g = laidIn(() => t);
    t += (HOURS / HOUR_PER_TICK) * HOUR;
    g.syncCampaign();
    return g;
  };

  test('she is in the same place, on the same date, with the same clock', () => {
    const watched = watchedAllTheWay();
    const closed = closedAndResumed();

    // The control first: both actually got somewhere. Two ships that never
    // left Sol would agree about everything.
    assert.equal(watched.locationId, 'vulcan', `watched ended at ${watched.locationId}`);
    assert.ok(!watched.transit, 'the watched voyage never finished');

    assert.equal(closed.locationId, watched.locationId,
      `closed ended at ${closed.locationId}, watched at ${watched.locationId}`);
    assert.equal(closed.mode, watched.mode,
      `closed woke in ${closed.mode}, watched in ${watched.mode}`);
    assert.ok(Math.abs(closed.clock.stardate - watched.clock.stardate) < 1e-6,
      `stardate ${closed.clock.stardate} vs ${watched.clock.stardate}`);
    assert.ok(Math.abs(closed.campaign.elapsedDays - watched.campaign.elapsedDays) < 1e-6,
      `commission ${closed.campaign.elapsedDays} vs ${watched.campaign.elapsedDays} days`);
  });

  test('and the ship herself came through it the same way', () => {
    // Hull and tank as well as the clock, because "the same place" is not much
    // of a claim if the ship that got there is a different ship. This is also
    // the assertion the NaN tank failed: `undefined` in, NaN out, and the two
    // paths disagreed on a field nobody was looking at.
    const watched = watchedAllTheWay();
    const closed = closedAndResumed();
    for (const [what, a, b] of [
      ['hull', watched.ship.hullPct, closed.ship.hullPct],
      ['antimatter', watched.ship.antimatter, closed.ship.antimatter],
      ['torpedoes', watched.ship.torpedoes, closed.ship.torpedoes],
    ]) {
      assert.ok(Number.isFinite(a) && Number.isFinite(b),
        `${what} is not a number: watched ${a}, closed ${b}`);
      assert.ok(Math.abs(a - b) < 1e-9, `${what}: watched ${a}, closed ${b}`);
    }
  });
});

// ---------------------------------------------------------------------------
// The order line, after there is nobody to give orders.
//
// `over` is set by three endings — a career finished by a second ship lost, a
// ship stranded with no port in reach, and the five years served. The app
// routes to the ending screen for all three. The model did not.

describe('a captain who is no longer a captain', () => {
  /** Serve the whole five years by playing, which nothing could do before. */
  const served = () => {
    const g = new Game({ seed: 4242n, crewMode: 'original', compression: HOUR_PER_TICK });
    g.ship.antimatter = g.ship.maxAntimatter;
    for (let i = 0; i < COMMISSION_DAYS * 24 + 100 && !g.over; i++) g.update(SIM_STEP);
    return g;
  };

  /** A career ended by a second ship lost. */
  const relieved = () => {
    const g = new Game({ seed: 77n, crewMode: 'original', compression: HOUR_PER_TICK });
    g.ship.antimatter = g.ship.maxAntimatter;
    g.shipsLost = 1;
    g.ship.hull = 0;
    g.ship.destroyed = true;
    for (let i = 0; i < 400 && !g.over; i++) g.update(SIM_STEP);
    return g;
  };

  test('the five years can be served by playing, and they end', () => {
    // The control for everything below, and a path nothing could reach until
    // the commission clock ran while the app was open: the only previous way
    // to 1,826 days was to leave the game shut for five years.
    const g = served();
    assert.equal(g.over, true, `still steering on day ${g.campaign.elapsedDays.toFixed(1)}`);
    assert.equal(g.campaign.complete, true);
    assert.ok(g.campaign.elapsedDays >= COMMISSION_DAYS,
      `ended on day ${g.campaign.elapsedDays}`);
    assert.match(g.overReason ?? '', /commission is complete/i, g.overReason);
    assert.deepEqual(checkAll(g, { arenaRadius: ARENA_RADIUS }), [],
      'the end of the five years is an illegal state');
  });

  test('and a career ended is a career ended', () => {
    const g = relieved();
    assert.equal(g.over, true, 'a second ship lost did not end the career');
    assert.match(g.overReason ?? '', /no further command/i, g.overReason);
  });

  test('and neither of them takes another order', () => {
    // Measured before this: after "no further command was offered",
    // `setCourse` returned `{ ok: true }` and the ship went to warp. Docking
    // and ordered repairs did too. That is the shape `endOfCommission`'s own
    // comment was written to prevent — "Year six, day thirty-one, still
    // steering" — and the fix that stopped the clock's ending being ignored
    // did not stop the orders being taken.
    for (const [what, g] of [['the five years served', served()], ['a career ended', relieved()]]) {
      const orders = {
        'set a course': () => g.setCourse(g.galaxy.neighbors(g.locationId)[0]?.id, 7),
        'enter orbit': () => g.enterOrbit(),
        'dock': () => g.dock(),
        'order repairs': () => { g.ship.hull = g.ship.maxHull * 0.5; return g.effectRepairs(); },
        'work the shop': () => g.workTheShop(8),
        'a landing party': () => g.awayMission('diplomatic_landing'),
        'train an officer': () => g.trainOfficer(g.crew.officers[0], 'fire_at_will'),
        'fabricate': () => g.fabricate('hull_patch'),
      };
      for (const [order, give] of Object.entries(orders)) {
        const r = give();
        assert.equal(r?.ok, false, `${what}: "${order}" was accepted`);
        // And refused for the RIGHT reason. Several of these would be refused
        // anyway — an empty bench, a wrong department, a tank already dry —
        // and a test that only checked `ok === false` would pass without the
        // guard existing at all.
        assert.match(r.error ?? r.reason ?? '', /command has ended/i,
          `${what}: "${order}" was refused, but for the wrong reason: ${r.error ?? r.reason}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// A new command gets a new number.
//
// `Ship` falls back to `FEDERATION_REGISTRIES[0]` when given no registry, and
// that is NCC-1701. So every Federation hull a captain was ever handed carried
// the same number, and nine of the ten registries in that list had never been
// used by anything. Lose the Enterprise, be given a Constellation, and she is
// `USS Lexington NCC-1701` — a fresh name on the dead ship's number.

describe('a new command gets a new number', () => {
  /** Lose the ship you have and be given another, the way the game does it. */
  const relievedOfHer = (seed) => {
    const g = new Game({ seed, crewMode: 'original', compression: HOUR_PER_TICK });
    const lost = { name: g.ship.name, registry: g.ship.registry, classId: g.ship.classId };
    g.ship.hull = 0;
    g.ship.destroyed = true;
    for (let i = 0; i < 400 && !g.over; i++) g.update(SIM_STEP);
    return { g, lost, got: { name: g.ship.name, registry: g.ship.registry, classId: g.ship.classId } };
  };

  test('the replacement does not carry the lost ship’s registry', () => {
    // Across several seeds, because one seed drawing a different number could
    // be luck rather than a rule.
    const runs = [3n, 31n, 77n, 909n, 4242n].map(relievedOfHer);
    for (const r of runs) {
      assert.equal(r.g.shipsLost, 1, 'the first ship was not recorded as lost');
      assert.ok(!r.g.over, `the career ended on the first loss: ${r.g.overReason}`);
      assert.notEqual(r.got.registry, r.lost.registry,
        `${r.got.name} came out of the yard carrying ${r.lost.name}'s number`);
      assert.ok(FEDERATION_REGISTRIES.includes(r.got.registry),
        `${r.got.registry} is not a Starfleet registry`);
      assert.notEqual(r.got.name, r.lost.name, 'and she was given the same name too');
    }
    // The control that makes the above mean something: the lost ships really
    // did all carry the same number, so "different from the lost one" is a
    // claim about the fix and not about the seeds happening to differ.
    const lostNumbers = new Set(runs.map((r) => r.lost.registry));
    assert.equal(lostNumbers.size, 1,
      `the ships lost carried ${lostNumbers.size} different numbers, so this proves less than it looks`);
  });

  test('and the yard refit still keeps her name and her number', () => {
    // The other half, and the reason this is not simply "always draw a new
    // number": a refit is the SAME ship coming out of dock as a different
    // class. `takeCommandOf`'s comment says so, and #116 exists to make it true.
    const g = new Game({ seed: 31n, crewMode: 'original', compression: HOUR_PER_TICK });
    const was = { name: g.ship.name, registry: g.ship.registry };
    const r = takeCommandOf(g, 'excelsior', { name: was.name, registry: was.registry });
    assert.equal(r.ok, true, r.reason);
    assert.equal(g.ship.name, was.name, 'the yard renamed her');
    assert.equal(g.ship.registry, was.registry, 'the yard renumbered her');
    assert.equal(g.ship.classId, 'excelsior', 'the yard did not refit her');
  });

  test('and every registry in the list is one the game can hand out', () => {
    // Nine of the ten had never been used by anything, which is how a list of
    // ten numbers sat in the data for the whole project as one number.
    const seen = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const g = new Game({ seed: BigInt(seed), crewMode: 'original', compression: HOUR_PER_TICK });
      takeCommandOf(g, 'constellation');
      seen.add(g.ship.registry);
    }
    assert.ok(seen.size >= 5,
      `sixty new commands drew only ${seen.size} distinct numbers: ${[...seen].join(', ')}`);
    for (const r of seen) {
      assert.ok(FEDERATION_REGISTRIES.includes(r), `${r} is not in the list`);
    }
  });
});

// ---------------------------------------------------------------------------
// The whole command ladder, one rung at a time.
//
// Nine promotions from an Oberth to a Galaxy. Nothing walked it: `wiring` takes
// one command, `#116` swaps one hull at the yard, and the tour never leaves the
// class it starts in. What a captain who serves long enough to see all nine
// actually gets — a fresh ship each time, the track following the captain, the
// bays resized, and nothing illegal at any rung — was never checked end to end.

describe('the whole command ladder, one rung at a time', () => {
  const climbed = (() => {
    const g = new Game({ seed: 5n, crewMode: 'original', compression: HOUR_PER_TICK });
    const rungs = [];
    for (const { id } of COMMAND_LADDER) {
      if (id === g.ship.classId) continue;
      const before = { name: g.ship.name, registry: g.ship.registry };
      const r = takeCommandOf(g, id);
      rungs.push({
        id, ok: r.ok, reason: r.reason,
        name: g.ship.name, registry: g.ship.registry, classId: g.ship.classId,
        mastery: g.mastery?.classId,
        sameNameAsLast: g.ship.name === before.name,
        sameNumberAsLast: g.ship.registry === before.registry,
        violations: checkAll(g, { arenaRadius: ARENA_RADIUS }).map((v) => `${v.severity} ${v.code}`),
      });
      for (let i = 0; i < 60; i++) g.update(SIM_STEP);
    }
    return { g, rungs };
  })();

  test('every rung on the ladder can actually be taken', () => {
    // The control: a ladder where every promotion is refused would satisfy
    // every assertion below about the ones that were not.
    assert.ok(climbed.rungs.length >= 8,
      `only ${climbed.rungs.length} rungs were attempted`);
    const refused = climbed.rungs.filter((r) => !r.ok);
    assert.deepEqual(refused.map((r) => `${r.id}: ${r.reason}`), [],
      'rungs the ladder offers and the game refuses');
    for (const r of climbed.rungs) {
      assert.equal(r.classId, r.id, `asked for ${r.id} and got ${r.classId}`);
    }
  });

  test('and the track follows the captain up it', () => {
    // `takeCommandOf`'s stated rule — "the track follows the captain, not the
    // hull" — which #116 exists to make true from the shipyard screen too.
    for (const r of climbed.rungs) {
      assert.equal(r.mastery, r.id,
        `flying a ${r.classId} with the mastery track pointed at ${r.mastery}`);
    }
  });

  test('and each new command is a different ship from the last', () => {
    for (const r of climbed.rungs) {
      assert.equal(r.sameNumberAsLast, false,
        `${r.id} came out of the yard carrying the number she went in with`);
      assert.equal(r.sameNameAsLast, false,
        `${r.id} came out of the yard carrying the name she went in with`);
      assert.ok(FEDERATION_REGISTRIES.includes(r.registry),
        `${r.registry} is not a Starfleet registry`);
    }
  });

  test('and nothing anywhere on the ladder was illegal', () => {
    for (const r of climbed.rungs) {
      assert.deepEqual(r.violations, [], `${r.id} was an illegal state`);
    }
    // And the ship at the top survives being put down and picked up.
    const back = Game.load(JSON.parse(JSON.stringify(climbed.g.save())),
      { compression: HOUR_PER_TICK });
    for (let i = 0; i < 300; i++) back.update(SIM_STEP);
    assert.equal(back.ship.classId, climbed.g.ship.classId, 'woke up in a different hull');
    assert.equal(back.ship.registry, climbed.g.ship.registry, 'woke up with a different number');
    assert.deepEqual(checkAll(back, { arenaRadius: ARENA_RADIUS }), [],
      'the ship at the top of the ladder loaded broken');
  });
});

// ---------------------------------------------------------------------------
// What the ship got done while nobody was watching.
//
// The same shape as the voyage that was missing from this report: a two-day
// job in the machine shop finished while the captain was away, the log
// recorded it — twice — and the one screen a returning player reads talked
// about hull plating. Committing to a two-day job is supposed to be a decision
// rather than a button, and a decision whose outcome is never reported is a
// decision the player does not see land.

describe('what the ship got done while nobody was watching', () => {
  /** A ship with a long job on the bench and a detail out. */
  const busy = (now) => {
    const g = new Game({ seed: 12n, crewMode: 'original', now });
    g.ship.hull = g.ship.maxHull * 0.5;
    // A replacement pallet is wanted when the ARRAY is hurt, not the hull —
    // "Nothing aboard needs it, Captain." is what a probe gets for assuming
    // otherwise, and it looks exactly like a bench that cannot be used.
    for (const k of Object.keys(g.ship.subsystems)) g.ship.subsystems[k] = 0.4;
    g.stores = { duranium: 200, isolinear: 200, deuterium: 200, salvage: 200 };
    assert.notEqual(g.fabricate('sensor_pallet').ok, false, 'nothing went on the bench');
    assert.ok(g.fabrication, 'the bench is empty');
    return g;
  };

  test('a job that finishes while you are away is in the report, not just the log', () => {
    const now = fakeClock();
    const g = busy(now);
    const hours = g.fabrication.hoursRemaining;
    assert.ok(hours > 24, `pick a job longer than a day (${hours}h)`);

    now.advance(Math.ceil(hours + 12) * HOUR);
    const r = g.syncCampaign();

    assert.equal(g.fabrication, null, 'the job never finished');
    const said = r.lines.filter((l) => /pallet/i.test(l));
    assert.ok(said.length,
      `came back to a finished job and was told: ${r.lines.join(' | ')}`);
    assert.match(said[0], /while you were away/i, said[0]);
  });

  test('and a ship with an empty bench is not told about one', () => {
    // The control. A report that always mentions the shop is not reporting the
    // shop, it is printing a line — the same trap as the voyage line in #122.
    const now = fakeClock();
    const g = new Game({ seed: 12n, crewMode: 'original', now });
    g.ship.hull = g.ship.maxHull * 0.5;
    assert.equal(g.fabrication, null, 'this ship was supposed to have an empty bench');
    now.advance(48 * HOUR);
    const r = g.syncCampaign();
    assert.ok(r.lines.length, 'no report at all');
    assert.deepEqual(r.lines.filter((l) => /bench|finished while you were away/i.test(l)), [],
      'a ship with nothing on the bench was told something came off it');
  });

  test('and the job still survives being saved half-done', () => {
    // Not new, but it is the thing the report above is reporting ON, and a
    // half-finished job silently reset by a save would make the rest of this
    // suite describe something that cannot happen.
    const now = fakeClock();
    const g = busy(now);
    now.advance(10 * HOUR);
    g.syncCampaign();
    const left = g.fabrication?.hoursRemaining;
    assert.ok(left > 0 && left < 48, `ten hours in and ${left}h left of 48`);

    const back = Game.load(JSON.parse(JSON.stringify(g.save())), { now });
    assert.ok(back.fabrication, 'the bench was cleared by a save');
    assert.ok(Math.abs(back.fabrication.hoursRemaining - left) < 1e-9,
      `${left}h left before the save and ${back.fabrication.hoursRemaining}h after`);
  });
});

// ---------------------------------------------------------------------------
// The ship's people, not only her plating.
//
// The third and fourth findings of one shape. The report finds room for "all
// fires are out" and had nothing to say about a named bridge officer who spent
// three days in sickbay and walked back onto the bridge. In a game where the
// ones who die on an away mission are the ones you sent, that is at least as
// much news as a fire going out.

describe('the ship’s people, not only her plating', () => {
  const withHurtCrew = (now) => {
    const g = new Game({ seed: 12n, crewMode: 'original', now });
    const [bad, light] = g.crew.officers;
    bad.injure(0.9);      // still in sickbay after three days
    light.injure(0.3);    // back on her feet
    return { g, bad, light };
  };

  test('an officer who comes back on duty is named', () => {
    const now = fakeClock();
    const { g, bad, light } = withHurtCrew(now);
    assert.equal(bad.injured, true);
    assert.equal(light.injured, true);

    now.advance(72 * HOUR);
    const r = g.syncCampaign();

    // The control on the whole test: one recovered and one did not, so the
    // report has something to say and something to leave out. If both had
    // recovered, "names the recovered" and "names everyone" look identical.
    assert.equal(light.injured, false, 'the lightly hurt officer never recovered');
    assert.equal(bad.injured, true, 'the badly hurt officer recovered too — pick a worse wound');

    const said = r.lines.filter((l) => l.includes(light.name));
    assert.ok(said.length, `${light.name} came back on duty and was not mentioned: ${r.lines.join(' | ')}`);
    assert.match(said[0], /sickbay/i, said[0]);
    assert.deepEqual(r.lines.filter((l) => l.includes(bad.name) && /back on duty/i.test(l)), [],
      `${bad.name} is still in sickbay and was reported back on duty`);
  });

  test('and a ship with nobody hurt is not told about sickbay', () => {
    // The same control the bench line needed. A report that always mentions
    // the crew is not reporting the crew.
    const now = fakeClock();
    const g = new Game({ seed: 12n, crewMode: 'original', now });
    g.ship.hull = g.ship.maxHull * 0.6;
    assert.deepEqual(g.crew.officers.filter((o) => o.injured).map((o) => o.name), [],
      'this crew was supposed to be fit');
    now.advance(72 * HOUR);
    const r = g.syncCampaign();
    assert.ok(r.lines.length, 'no report at all');
    assert.deepEqual(r.lines.filter((l) => /sickbay|back on duty/i.test(l)), [],
      'a ship with nobody hurt was told somebody came out of sickbay');
  });

  test('and the shields coming back is deliberately NOT reported', () => {
    // They return over every quiet absence, and a line that appears in every
    // report is not reporting anything. Written down so the omission reads as
    // a decision rather than as the same defect left unfixed.
    const now = fakeClock();
    const g = new Game({ seed: 12n, crewMode: 'original', now });
    for (const f of Object.keys(g.ship.shields)) g.ship.shields[f] = 0;
    now.advance(72 * HOUR);
    const r = g.syncCampaign();
    assert.ok(g.ship.shields[Object.keys(g.ship.shields)[0]] > 0,
      'the shields did not come back, so this asserts nothing');
    assert.deepEqual(r.lines.filter((l) => /shield/i.test(l)), [],
      'the report started mentioning shields');
  });
});
