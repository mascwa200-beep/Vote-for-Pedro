// Five audits and one line.
//
// The plan finished; this is the continuous item, and a lower-yield pass is
// supposed to look like this — mostly clean, with the negatives written down so
// nobody hunts them again.
//
//     ship modifiers        stealthDetect: written by five, read by none    FOUND
//     the sensor array      special: 'scan' reached nothing                 FOUND
//     reputation perks      all 25 read                                     clean
//     station panels        all 36 resolve to a console or a report         clean
//     mastery traits        applied in shipMods, choosable from UI and order clean
//     order actions         all 69 parsed actions have a handler            clean
//     duty details          the picker and the payout disagreed             one line
//
// The first two shipped separately. This file holds the last one and the four
// negatives, as tests, so each stays true.
//
// The duty finding is small and is described as small. `teamFitness` decides
// how a detail turns out and weighs a person as `(expertise + discipline) / 2`.
// The screen's own picker sorted by `expertise` alone. Measured over six
// hundred assignments across sixty rosters, the auto-picked team was not the
// best available 31 times — 5.2% — losing a mean of 2.97 fitness and at worst
// 10.50, against a scale where a matched speciality is 40. It is here because
// the game had two answers to one question and graded the captain against the
// other one.

import { test, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { ASSIGNMENTS, SPECIALITIES, teamFitness, bestTeamFor, personFitness } from '../src/sim/duty.js';
import { REPORTING_STATIONS } from '../src/sim/consoles.js';
import { ROOM_LIST } from '../src/world/interiors.data.js';
import { REP_TRACKS } from '../src/rules/reputation.js';
import { TRAITS as SHIP_TRAITS } from '../src/sim/mastery.js';
import { parseOrder, orderHelp, commandReference } from '../src/ui/orders.js';

/** Every k-subset of a list. */
function* subsets(list, k) {
  if (list.length < k) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    yield idx.map((i) => list[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === list.length - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

describe('the ship sends the people it says are best for the job', () => {
  test('the picker never leaves a better team standing on the deck', () => {
    // Exhaustive against every combination the roster allows, which is what
    // "best available" has to mean for the claim to be worth making.
    let evaluated = 0;
    let worse = 0;
    let worstGap = 0;
    for (let seed = 1n; seed <= 60n; seed++) {
      const g = new Game({ seed, crewMode: 'original' });
      const free = (g.dutyRoster ?? []).filter((p) => p.available);
      if (free.length < 2 || free.length > 12) continue;
      for (const a of Object.values(ASSIGNMENTS)) {
        const k = Math.max(1, a.team ?? 1);
        const got = teamFitness(a, bestTeamFor(a, free));
        let best = got;
        for (const cand of subsets(free, Math.min(k, free.length))) {
          const f = teamFitness(a, cand);
          if (f > best) best = f;
        }
        evaluated++;
        if (best > got + 1e-9) { worse++; worstGap = Math.max(worstGap, best - got); }
      }
    }
    assert.ok(evaluated > 300, `only ${evaluated} assignments evaluated`);
    assert.equal(worse, 0,
      `${worse} of ${evaluated} picks left a better team behind, worst by ${worstGap.toFixed(2)}`);
  });

  test('and the screen asks the same function, not a second one of its own', () => {
    // The divergence itself: `main.js` had its own ranking written out, by
    // speciality then division then `expertise`. One place answers this now.
    const main = readFileSync('src/main.js', 'utf8');
    assert.match(main, /bestTeamFor\(/);
    const send = main.slice(main.indexOf('sendDetail('), main.indexOf('sendDetail(') + 1400);
    assert.doesNotMatch(send, /b\.expertise/, 'the screen is ranking the roster itself again');
  });

  test('and a person is worth what the payout says they are worth', () => {
    // `personFitness` is the shared term. Discipline has to count, because the
    // grading counts it — that is the whole of the bug.
    const at = (expertise, discipline) => personFitness(
      { wants: 'none', team: 1 },
      { speciality: 'x', division: 'y', expertise, discipline },
    );
    assert.ok(at(90, 90) > at(90, 40), 'discipline counts for nothing in the pick');
    assert.ok(at(90, 60) > at(60, 60), 'expertise counts for nothing in the pick');
  });

  test('and a matched speciality still beats a better generalist', () => {
    const a = { wants: 'sensor_analyst', team: 1 };
    const spec = SPECIALITIES.sensor_analyst;
    assert.ok(spec, 'there is no such speciality, so this proves nothing');
    const matched = { speciality: 'sensor_analyst', division: spec.division, expertise: 60, discipline: 60 };
    const better = { speciality: 'other', division: 'other', expertise: 100, discipline: 100 };
    assert.ok(personFitness(a, matched) > personFitness(a, better),
      'the right person for the job lost to a better person for a different one');
  });
});

describe('four things that were checked and are clean', () => {
  test('every reputation perk on sale is read by something', () => {
    const granted = new Set();
    for (const t of Object.values(REP_TRACKS ?? {})) {
      for (const p of t.projects ?? []) if (p.grant?.perk) granted.add(p.grant.perk);
    }
    assert.ok(granted.size >= 20, `${granted.size} perks on sale`);
    const all = ['src/core/state.js', 'src/main.js', 'src/ui/screens.js', 'src/sim/command.js',
      'src/missions/engine.js', 'src/sim/diplomacy.js', 'src/sim/combat.js']
      .map((f) => readFileSync(f, 'utf8')).join('\n');
    // Read by name, or through the two tables that hold perk ids as data.
    const tables = readFileSync('src/core/state.js', 'utf8');
    const unread = [...granted].filter((p) =>
      !new RegExp(`perk\\(['"]${p}['"]\\)`).test(all)
      && !new RegExp(`['"]${p}['"]`).test(tables)
      && !new RegExp(`\\b${p}\\b`).test(all));
    assert.deepEqual(unread, [], 'perks the player can buy and nothing reads');
  });

  test('every station aboard opens a console or answers with a report', () => {
    // A station that resolves to neither tells the captain "there is nothing on
    // this board for you" from a console the deck plan says exists.
    //
    // Two drafts of this got it wrong in the same direction: `REPORTING_STATIONS`
    // is an ARRAY of ids and was read with `Object.keys`, and then the
    // no-panel branch ran before the report check. Both reported four working
    // consoles as broken. The reporting stations carry no `panel` on purpose.
    const main = readFileSync('src/main.js', 'utf8');
    const block = main.slice(main.indexOf('const STATION_PANEL'),
      main.indexOf('}', main.indexOf('const STATION_PANEL')) + 1);
    const known = new Set([...block.matchAll(/([a-z_]+)\s*:/g)].map((m) => m[1]));
    const sw = main.slice(main.indexOf('switch (key)', main.indexOf('openConsole')));
    for (const m of sw.slice(0, 4000).matchAll(/case '([a-z_]+)':/g)) known.add(m[1]);
    const reports = new Set(REPORTING_STATIONS);

    const orphans = [];
    let n = 0;
    for (const room of ROOM_LIST) {
      for (const st of room.stations ?? []) {
        n++;
        if (reports.has(st.id)) continue;
        if (!st.panel || !known.has(st.panel)) orphans.push(`${room.id}.${st.id} (${st.panel})`);
      }
    }
    assert.ok(n >= 30, `${n} stations`);
    assert.deepEqual(orphans, []);
  });

  test('every starship trait can be chosen and is applied', () => {
    const main = readFileSync('src/main.js', 'utf8');
    const screens = readFileSync('src/ui/screens.js', 'utf8');
    assert.match(main, /chooseTrait/, 'no order chooses a doctrine');
    assert.match(screens, /chooseTrait/, 'no screen chooses a doctrine');
    const mastery = readFileSync('src/sim/mastery.js', 'utf8');
    const mods = mastery.slice(mastery.indexOf('shipMods()'));
    assert.match(mods, /const trait = this\.trait/, 'shipMods does not fold the trait in');
    for (const t of Object.values(SHIP_TRAITS)) {
      assert.ok(Object.keys(t.mods ?? {}).length, `${t.id} grants nothing`);
    }
  });

  test('every order the parser can produce has somewhere to go', () => {
    // Through `parseOrder`, which is exported, on every phrase the game's own
    // help text lists. An earlier draft imported `ORDERS` — which exists in
    // orders.js and is NOT exported — got `undefined`, swallowed it with `?? []`
    // and reported "0 orphans" having examined nothing at all. The count below
    // is asserted for exactly that reason.
    const phrases = [];
    const collect = (v) => {
      if (typeof v === 'string') phrases.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(orderHelp());
    collect(commandReference({ examples: 8 }));
    assert.ok(phrases.length > 200, `only ${phrases.length} phrases harvested`);

    const actions = new Set();
    for (const p of phrases) {
      let r = null;
      try { r = parseOrder(p); } catch { continue; }
      const a = r?.action ?? r?.order?.action;
      if (a) actions.add(a);
    }
    assert.ok(actions.size > 40, `only ${actions.size} distinct actions parsed`);

    const main = readFileSync('src/main.js', 'utf8');
    const exec = main.slice(main.indexOf('executeOrder('));
    const handled = new Set([...exec.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]));
    const orphan = [...actions].filter((a) => !handled.has(a)).sort();
    assert.deepEqual(orphan, [], 'orders the parser builds and executeOrder ignores');
  });
});
