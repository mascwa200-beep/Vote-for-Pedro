// One room in seventeen that you have to be standing in.
//
// The ship has seventeen walkable compartments. Sickbay has three stations.
// The chief surgeon's desk carries no `panel`, so it falls through to
// `sim/consoles.js` and gives a real sick list — who is hurt, how badly, and
// what the commission has cost. The biobed and the medical laboratory, three
// metres away, both declared `panel: 'medical'`, and `STATION_PANEL` in main.js
// aliased 'medical' onto 'crew':
//
//     biobed    -> medical -> crew    the crew ROSTER
//     medlab    -> medical -> crew    the crew ROSTER
//     cmo_desk  -> (no panel)         the sick list
//
// The roster is a personnel screen. It knows everybody's department and
// nobody's injuries. So one station in the ward told the truth and two opened a
// filing cabinet.
//
// The board that replaces it shows the thing the simulation has always known
// and never displayed: `Officer.recover` clears an injury at
// `hours * recoveryRate / 120`, so every injured officer has had an exact
// number of hours between them and their post since the campaign-time sickbay
// was written, and nothing anywhere printed it.
//
// And it carries the one order in the game that has to be given from a
// particular room. `seeToTheWounded` is `effectRepairs` for the crew: it spends
// commission hours and adds NO healing path, no roll and no balance surface —
// `passTime` was always going to do the healing. It buys with the calendar what
// waiting already buys, which is why it is safe, and the five-year clock is why
// it still costs something.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';
import { Ship } from '../src/sim/ship.js';
import { ROOMS } from '../src/world/interiors.data.js';
import { REPORTING_STATIONS } from '../src/sim/consoles.js';

const MAIN = readFileSync('src/main.js', 'utf8');

function captain({ seed = 7n, ...rest } = {}) {
  return new Game({
    seed, crewMode: 'original',
    character: new Character({ speciesId: 'human', careerId: 'command' }),
    shipClass: 'constitution', ...rest,
  });
}

/** Walk the captain, and let them arrive. */
function walkTo(g, roomId) {
  g.goToRoom(roomId);
  for (let n = 0; n < 4000 && g.walkOrder; n++) g.update(1 / 30);
  return g.walk.roomId;
}

/** Put somebody in the ward, at a stated severity. */
function hurt(g, n = 1, severity = 0.5) {
  const who = g.crew.officers.filter((o) => o.alive).slice(0, n);
  for (const o of who) { o.injured = true; o.injurySeverity = severity; }
  return who;
}

describe('the ward has its own board', () => {
  test('"medical" no longer opens the crew roster', () => {
    const block = MAIN.slice(MAIN.indexOf('const STATION_PANEL'),
      MAIN.indexOf('}', MAIN.indexOf('const STATION_PANEL')) + 1);
    assert.doesNotMatch(block, /medical:\s*'crew'/,
      'the biobed opens the personnel roster again');
    assert.match(block, /medical:\s*'medical'/);
    // And the case exists, because an alias with no console falls to
    // `default:` and says "Working, Captain." — which is how the briefing room
    // spent its whole life.
    const sw = MAIN.slice(MAIN.indexOf('switch (key)', MAIN.indexOf('openConsole')));
    assert.match(sw.slice(0, 6000), /case 'medical':/);
  });

  test('and every station in the ward is answered by something', () => {
    // Read off the deck plan rather than asserted from memory. Two open the
    // board; the surgeon's desk has no panel and is answered by consoles.js,
    // and that split is the point — a station either opens a panel or reports.
    const ward = ROOMS.sickbay.stations ?? [];
    assert.ok(ward.length >= 3, `${ward.length} stations in sickbay`);
    const panelled = ward.filter((s) => s.panel);
    const reporting = ward.filter((s) => !s.panel);
    assert.deepEqual(panelled.map((s) => s.panel), ['medical', 'medical'],
      'a station in the ward opens something other than the ward board');
    for (const s of reporting) {
      assert.ok(REPORTING_STATIONS.includes(s.id),
        `${s.id} has no panel and no report, so it answers with nothing`);
    }
  });
});

describe('hours in sickbay, spent rather than waited out', () => {
  test('it is refused anywhere but sickbay, and the refusal says where', () => {
    const g = captain();
    hurt(g, 1, 0.4);
    assert.equal(g.walk.roomId, 'bridge');
    const no = g.seeToTheWounded();
    assert.equal(no.ok, false);
    assert.match(no.reason, /sickbay/i, no.reason);
  });

  test('and it works standing in it', () => {
    const g = captain();
    const [who] = hurt(g, 1, 0.4);
    assert.equal(walkTo(g, 'sickbay'), 'sickbay');
    const before = who.injurySeverity;
    const r = g.seeToTheWounded();
    assert.equal(r.ok, true, r.reason);
    assert.ok(r.hours > 0, `it cost ${r.hours} hours`);
    assert.ok(who.injurySeverity < before,
      `severity ${before} -> ${who.injurySeverity}`);
  });

  test('and it costs the commission the hours it says it does', () => {
    // The whole price of the order. If the clock did not move this would be
    // free healing rather than a trade.
    const g = captain();
    hurt(g, 1, 0.5);
    walkTo(g, 'sickbay');
    const date = g.clock.stardate;
    const r = g.seeToTheWounded();
    assert.ok(r.ok, r.reason);
    assert.ok(g.clock.stardate > date,
      `the stardate did not move for ${r.hours} hours`);
  });

  test('and a light case walks out of the ward', () => {
    // The shape of the order: long enough to get the least badly hurt of them
    // back on their feet. A board that never returns anybody is a progress bar.
    const g = captain();
    const [who] = hurt(g, 1, 0.1);
    walkTo(g, 'sickbay');
    const r = g.seeToTheWounded();
    assert.ok(r.ok, r.reason);
    assert.deepEqual(r.back, [who.name], JSON.stringify(r));
    assert.equal(who.injured, false);
    assert.equal(r.still, 0);
  });

  test('and a bad case does not, and says so rather than lying', () => {
    const g = captain();
    hurt(g, 1, 1);
    walkTo(g, 'sickbay');
    const r = g.seeToTheWounded();
    assert.ok(r.ok, r.reason);
    assert.deepEqual(r.back, []);
    assert.equal(r.still, 1);
    // Capped at a day, so a severe injury is several of these rather than one
    // button that skips a week.
    assert.ok(r.hours <= 24, `${r.hours} hours in one order`);
  });

  test('and repeating it eventually clears the ward', () => {
    // The cap has to be a pace, not a wall.
    const g = captain();
    const [who] = hurt(g, 1, 1);
    walkTo(g, 'sickbay');
    let orders = 0;
    while (who.injured && orders < 20) { g.seeToTheWounded(); orders++; }
    assert.equal(who.injured, false, `still hurt after ${orders} orders`);
    assert.ok(orders >= 4, `a severe injury cleared in ${orders} order(s)`);
  });
});

describe('what it refuses, and why', () => {
  test('nobody on the sick list', () => {
    const g = captain();
    walkTo(g, 'sickbay');
    const r = g.seeToTheWounded();
    assert.equal(r.ok, false);
    assert.match(r.reason, /sick list/i, r.reason);
  });

  test('and not while we are under fire', () => {
    const g = captain();
    hurt(g, 1, 0.4);
    walkTo(g, 'sickbay');
    g.startCombat([new Ship('d7', { faction: 'klingon', name: 'K' })], {});
    const r = g.seeToTheWounded();
    assert.equal(r.ok, false);
    assert.match(r.reason, /fire/i, r.reason);
  });

  test('and a game with no walker is nowhere, not somewhere else', () => {
    // The same reasoning `Mission.testWhere` uses. A harness that never built
    // an interior has not failed to walk to sickbay.
    const g = captain();
    hurt(g, 1, 0.2);
    const walk = g.walk;
    g.walk = null;
    const r = g.seeToTheWounded();
    g.walk = walk;
    assert.equal(r.ok, true, r.reason);
  });
});

describe('the captain’s own training is read here', () => {
  test('a doubled recoveryRate gets more out of the same order', () => {
    // `recoveryRate` is declared 2 by the Denobulan species and by the
    // `beloved` trait, and until the campaign-time sickbay was written nothing
    // read it at all. This is its second reader, and the first one a player can
    // see working.
    const measure = (speciesId, severity) => {
      const g = captain({ character: new Character({ speciesId, careerId: 'command' }) });
      const [who] = hurt(g, 1, severity);
      walkTo(g, 'sickbay');
      const r = g.seeToTheWounded();
      return { rate: r.rate, hours: r.hours, left: who.injurySeverity };
    };

    // A light case, where neither captain is anywhere near the day-long cap:
    // the order asks for HALF the hours, because half is all it needs.
    const lightPlain = measure('human', 0.15);
    const lightMedic = measure('denobulan', 0.15);
    assert.equal(lightPlain.rate, 1, JSON.stringify(lightPlain));
    assert.equal(lightMedic.rate, 2, JSON.stringify(lightMedic));
    assert.ok(lightMedic.hours < lightPlain.hours,
      `${lightMedic.hours} h against ${lightPlain.hours} h`);
    assert.equal(lightPlain.left, 0);
    assert.equal(lightMedic.left, 0);

    // And a bad one, where both are capped at a day and the hours are
    // IDENTICAL — so the only thing that can differ is what the day bought.
    // This is the half a single measurement would have got wrong: the first
    // draft of this test asserted "fewer hours" at severity 0.5, where both
    // captains hit the cap and the assertion was about the cap, not the rate.
    const badPlain = measure('human', 1);
    const badMedic = measure('denobulan', 1);
    assert.equal(badMedic.hours, badPlain.hours, 'both should be capped at a day');
    assert.ok(badMedic.left < badPlain.left,
      `the same 24 hours left ${badMedic.left} and ${badPlain.left}`);
  });
});
