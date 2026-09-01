// The bridge watch, and who has the con.
//
// The property being defended here is that the bridge is never empty. Before
// this existed, walking off the bridge left the ship in nobody's hands and
// closing the app stopped time until a summary panel explained it away. The
// tests below assert the effects of that being fixed — an officer named, the
// con changing hands in both directions, and a report that comes back with
// them — rather than the shape of the tables it is built out of.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  seniority, watchOrder, nextInLine, WATCHES, watchAt, assignWatches, handbackReport,
} from '../src/sim/watch.js';
import { Game } from '../src/core/state.js';
import { parseOrder } from '../src/ui/orders.js';

/** A game whose captain is where the test needs them, without walking there. */
function commissioned(opts = {}) {
  return new Game({ seed: 91n, crewMode: 'canon', era: 'tos', ...opts });
}

/** Put the captain somewhere instantly; the walk itself is walk.test.js's job. */
function stand(g, roomId) {
  g.walkOrder = null;
  g.walk.enter(roomId);
}

describe('seniority', () => {
  test('rank comes before post', () => {
    const commander = { rank: 'Commander', station: 'science' };
    const lieutenant = { rank: 'Lieutenant', station: 'first_officer' };
    const [rc] = seniority(commander);
    const [rl] = seniority(lieutenant);
    assert.ok(rc < rl, 'a lieutenant outranked a commander');
  });

  test('at equal rank the first officer is the captain\'s relief', () => {
    const xo = { rank: 'Commander', station: 'first_officer' };
    const helm = { rank: 'Commander', station: 'helm' };
    const [, px] = seniority(xo);
    const [, ph] = seniority(helm);
    assert.ok(px < ph, 'the helmsman was called before the first officer');
  });

  test('a rank nobody has heard of sorts last instead of crashing', () => {
    const [r] = seniority({ rank: 'Grand Nagus', station: 'comms' });
    const [c] = seniority({ rank: 'Ensign', station: 'comms' });
    assert.ok(r > c, 'an unknown rank outranked an ensign');
    assert.doesNotThrow(() => seniority(null));
  });

  test('a militia major is in the chain of command, not below the ensigns', () => {
    // DS9's first officer held a Bajoran rank. Sorted as an unknown she would
    // have been the last person on the ship called on to take the con.
    const [major] = seniority({ rank: 'Major', station: 'first_officer' });
    const [ensign] = seniority({ rank: 'Ensign', station: 'helm' });
    assert.ok(major < ensign, 'the station\'s second-in-command sorted below an ensign');
  });
});

describe('who is fit to stand a watch', () => {
  const crew = (list) => ({ officers: list.map((o) => ({ alive: true, injured: false, ...o })) });

  test('the dead and the injured are not on the watch bill', () => {
    const c = crew([
      { name: 'A', rank: 'Commander', station: 'first_officer', injured: true },
      { name: 'B', rank: 'Lieutenant Commander', station: 'engineering' },
      { name: 'C', rank: 'Lieutenant', station: 'helm', alive: false },
    ]);
    assert.deepEqual(watchOrder(c).map((o) => o.name), ['B']);
    assert.equal(nextInLine(c).name, 'B');
  });

  test('one officer listed at two posts stands one watch, not two', () => {
    // The TOS roster has its science officer standing in as first officer.
    const g = commissioned();
    const names = watchOrder(g.crew).map((o) => o.name);
    assert.equal(new Set(names).size, names.length, `${names.join(', ')} contains a duplicate`);
  });

  test('nobody left standing means nobody takes the con', () => {
    const c = crew([{ name: 'A', rank: 'Commander', station: 'first_officer', alive: false }]);
    assert.equal(nextInLine(c), null);
  });

  test('the officer who just handed it back is not handed it straight back', () => {
    const c = crew([
      { name: 'A', rank: 'Commander', station: 'first_officer' },
      { name: 'B', rank: 'Lieutenant', station: 'helm' },
    ]);
    const first = nextInLine(c);
    assert.equal(nextInLine(c, first).name, 'B');
  });
});

describe('the watch bill', () => {
  test('the day is covered end to end with no hour in two watches', () => {
    for (let h = 0; h < 24; h++) {
      const w = watchAt(h);
      assert.ok(w, `hour ${h} had no watch`);
      const all = WATCHES.filter((x) => h >= x.from && h < x.to);
      assert.equal(all.length, 1, `hour ${h} is in ${all.length} watches`);
    }
  });

  test('an hour off the end of the clock still lands on a watch', () => {
    assert.equal(watchAt(25).id, watchAt(1).id);
    assert.equal(watchAt(-1).id, watchAt(23).id);
  });

  test('no watch gets all the senior officers and none gets nobody', () => {
    const g = commissioned();
    const bill = g.watchBill;
    const sizes = WATCHES.map((w) => bill[w.id].length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1,
      `watches are lopsided: ${sizes.join('/')}`);
    // The senior officer of each watch should differ; round-robin down the
    // seniority list is what guarantees that, and by-department would not.
    const leads = WATCHES.map((w) => bill[w.id][0]?.name).filter(Boolean);
    assert.equal(new Set(leads).size, leads.length, `two watches share a senior officer`);
  });

  test('everybody fit to stand one is on it exactly once', () => {
    const g = commissioned();
    const bill = assignWatches(g.crew);
    const placed = WATCHES.flatMap((w) => bill[w.id]).map((o) => o.name);
    assert.deepEqual(placed.slice().sort(), watchOrder(g.crew).map((o) => o.name).sort());
  });
});

describe('the handback report', () => {
  const spock = { rank: 'Commander', name: 'Spock' };

  test('a quiet watch still gets reported', () => {
    const lines = handbackReport(spock, 6);
    assert.ok(lines.length >= 2, 'a quiet watch said nothing at all');
    assert.match(lines[0], /Nothing to report/);
    assert.match(lines.at(-1), /You have the con/);
  });

  test('what happened is in the officer\'s mouth, not a panel\'s', () => {
    const lines = handbackReport(spock, 30, ['Hull integrity is at 62 percent.']);
    assert.match(lines[0], /^Commander Spock:/);
    assert.ok(!/Nothing to report/.test(lines[0]), 'reported nothing while holding a report');
    assert.ok(lines.includes('Hull integrity is at 62 percent.'));
  });

  test('the span is said in the units a person would use', () => {
    assert.match(handbackReport(spock, 0.4)[0], /the last hour/);
    assert.match(handbackReport(spock, 9)[0], /9 hours/);
    assert.match(handbackReport(spock, 72)[0], /3\.0 days/);
  });
});

describe('the con changes hands', () => {
  test('a commission starts with the captain holding it', () => {
    const g = commissioned();
    assert.equal(g.conStation, null);
    assert.equal(g.conOfficer, null);
    assert.equal(g.onBridge, true);
  });

  test('leaving the bridge hands it to the next ranking officer', () => {
    const g = commissioned();
    const relief = g.watchOrder[0];
    stand(g, 'engineering');
    g.updateCon();
    assert.ok(g.conOfficer, 'the bridge was left in nobody\'s hands');
    assert.equal(g.conOfficer.name, relief.name);
  });

  test('coming back to the bridge gets it back, with a report', () => {
    const g = commissioned();
    stand(g, 'engineering');
    g.updateCon();
    const held = g.conOfficer;
    stand(g, 'bridge');
    const before = g.log.length;
    g.updateCon();
    assert.equal(g.conStation, null, 'the captain did not get the con back');
    const said = g.log.slice(before).map((e) => e.text).join('\n');
    assert.ok(said.includes(held.name), `the report never mentioned ${held.name}:\n${said}`);
    assert.match(said, /I have the con\./);
  });

  test('an officer given it deliberately keeps it when you walk back in', () => {
    const g = commissioned();
    const r = g.handOverCon();
    assert.equal(r.ok, true, r.reason);
    stand(g, 'engineering');
    g.updateCon();
    stand(g, 'bridge');
    g.updateCon();
    assert.ok(g.conOfficer, 'a deliberate handover was undone by walking through a door');
    const back = g.takeCon();
    assert.equal(back.ok, true);
    assert.equal(g.conStation, null);
  });

  test('you can name who gets it', () => {
    const g = commissioned();
    const scotty = g.crew.officers.find((o) => o.station === 'engineering');
    const r = g.handOverCon('engineering');
    assert.equal(r.ok, true, r.reason);
    assert.equal(g.conOfficer.name, scotty.name);
  });

  test('naming somebody who is not aboard is refused, not guessed at', () => {
    const g = commissioned();
    const r = g.handOverCon('archer');
    assert.equal(r.ok, false);
    assert.equal(g.conStation, null, 'the con went to somebody who does not exist');
  });

  test('taking it when you already have it is refused rather than silent', () => {
    const g = commissioned();
    const r = g.takeCon();
    assert.equal(r.ok, false);
    assert.match(r.reason, /You have the con/);
  });

  test('beaming down leaves somebody on the bridge', () => {
    const g = commissioned();
    const body = g.galaxy.systems[g.locationId]?.bodies?.find?.((b) => b.kind !== 'gas' && b.kind !== 'star');
    g.enterOrbit(body?.id ?? null);
    stand(g, 'transporter');
    g.updateCon();
    const r = g.beamDown();
    if (r.ok) assert.equal(g.ashore, true);
    // Whether or not this world could be landed on, walking off the bridge to
    // the transporter room is already enough to have passed the con.
    assert.ok(g.conOfficer, 'the captain left the ship and nobody had it');
  });

  test('the watch survives a save and a load', () => {
    const g = commissioned();
    g.handOverCon();
    g.conHours = 4;
    g.conLines.push('A conduit blew on deck 12.');
    const held = g.conOfficer.name;

    const back = Game.load(JSON.parse(JSON.stringify(g.save())));
    assert.equal(back.conOfficer?.name, held, 'the con was lost across a reload');
    assert.equal(back.conGiven, true);
    const lines = back.takeCon().lines;
    assert.ok(lines.some((l) => l.includes('conduit')),
      `the watch forgot what it had to report: ${lines.join(' | ')}`);
  });

  test('a record written before there was a watch loads with the captain holding it', () => {
    const g = commissioned();
    const data = JSON.parse(JSON.stringify(g.save()));
    delete data.con;
    const back = Game.load(data);
    assert.equal(back.conStation, null);
  });
});

describe('the orders', () => {
  test('"you have the con" and "I have the con" are opposite orders', () => {
    const give = parseOrder('you have the con');
    const take = parseOrder('i have the con');
    assert.equal(give.action, 'hand_over_con', JSON.stringify(give));
    assert.equal(take.action, 'take_con', JSON.stringify(take));
  });

  test('asking who has it is a question, not a handover', () => {
    const asked = parseOrder('who has the con');
    assert.equal(asked.action, 'watch_bill', JSON.stringify(asked));
  });

  test('the ways a captain actually says it all land', () => {
    for (const said of ['number one you have the con', 'take the con', 'relieve me',
      'you have the bridge', 'stand the watch']) {
      assert.equal(parseOrder(said).action, 'hand_over_con', `"${said}" -> ${JSON.stringify(parseOrder(said))}`);
    }
    for (const said of ['i have the con', 'i will take the con', 'give me the con',
      'the con is mine']) {
      assert.equal(parseOrder(said).action, 'take_con', `"${said}" -> ${JSON.stringify(parseOrder(said))}`);
    }
    for (const said of ['read me the watch bill', 'who is on duty', 'what watch is it']) {
      assert.equal(parseOrder(said).action, 'watch_bill', `"${said}" -> ${JSON.stringify(parseOrder(said))}`);
    }
  });

  test('the con orders did not steal anybody else\'s words', () => {
    assert.equal(parseOrder('take the chair').action, 'chair');
    assert.equal(parseOrder('stand up').action, 'chair');
    assert.equal(parseOrder('take us into standard orbit').action, 'orbit');
  });
});

describe('the ship in the officer\'s hands', () => {
  const DAY = 24 * 60 * 60 * 1000;

  /** A clock the test moves by hand. */
  function fakeClock() {
    let t = Date.parse('2380-01-01T00:00:00Z');
    const fn = () => t;
    fn.advance = (ms) => { t += ms; };
    return fn;
  }

  test('an absence is reported by whoever had the con, not by the game', () => {
    const now = fakeClock();
    const g = new Game({ seed: 5n, crewMode: 'original', now });
    g.ship.hull = g.ship.maxHull * 0.5;
    now.advance(2 * DAY);

    const r = g.syncCampaign();
    assert.ok(r.hours > 47, `credited ${r.hours} hours`);
    assert.ok(r.lines.length > 0, 'the captain came back to silence');
    assert.match(r.lines[0], /I had the con for/,
      `the absence was still a panel: ${r.lines[0]}`);
    assert.match(r.lines.at(-1), /You have the con, Captain\./);
    assert.equal(g.conStation, null, 'the captain was on the bridge and did not get it back');
  });

  test('away from the bridge, the officer holds it until you come back', () => {
    const now = fakeClock();
    const g = new Game({ seed: 5n, crewMode: 'original', now });
    stand(g, 'engineering');
    g.updateCon();
    const held = g.conOfficer.name;
    now.advance(2 * DAY);

    const r = g.syncCampaign();
    assert.ok(g.conOfficer, 'the con was handed back to an empty chair');
    assert.match(r.lines.join('\n'), new RegExp(held));

    stand(g, 'bridge');
    const back = g.takeCon();
    assert.match(back.lines[0], /I had the con for/);
    assert.ok(back.lines.length > 2, 'two days of ship\'s business reported as nothing');
  });

  test('the watch does not repeat itself once it has reported', () => {
    const now = fakeClock();
    const g = new Game({ seed: 5n, crewMode: 'original', now });
    stand(g, 'engineering');
    g.updateCon();
    now.advance(2 * DAY);
    g.syncCampaign();
    stand(g, 'bridge');
    const first = g.takeCon().lines.length;
    assert.ok(first > 0);

    stand(g, 'engineering');
    g.updateCon();
    stand(g, 'bridge');
    const second = g.takeCon().lines;
    assert.ok(!second.some((l) => /hull|fire|damage control/i.test(l)),
      `the same report came back twice: ${second.join(' | ')}`);
  });
});
