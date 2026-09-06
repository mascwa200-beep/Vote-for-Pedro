// What actually happens to a captain, and how often the same thing happens.
//
// Written after a measurement rather than after a feature. Four thousand rolls
// of `rollEncounter` across every system said the commonest thing in the game
// was an anomaly — 52% of every non-quiet encounter, all seven of them the
// same sentence with a different noun in it — and that three of the eight
// kinds had exactly one line of text each.
//
// The cause was structural, not a weighting mistake. In safe Federation space
// `danger` is 0.18, so 82% of rolls take the "nothing much happened" branch,
// and that branch was a coin flip between silence and "Sensors are reading a
// gravitic eddy."
//
// So these tests are about DISTRIBUTION, which is the thing that was wrong.
// A content test that only checks a table has entries in it cannot see the
// problem this file exists for.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { RNG, hashSeed } from '../src/core/rng.js';
import {
  rollEncounter, ENCOUNTER_KINDS, SIGNALS,
} from '../src/world/encounters.js';
import { SYSTEMS } from '../src/world/systems.data.js';
import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';

/** Roll a lot of encounters across the whole map and tally what came up. */
function survey(rolls = 4000) {
  const kinds = {};
  const pairs = {};
  const titles = new Set();
  const texts = new Set();
  let live = 0;
  for (let seed = 0; seed < rolls; seed++) {
    const sys = SYSTEMS[seed % SYSTEMS.length];
    const e = rollEncounter(new RNG(hashSeed(`survey${seed}`)), sys.id, {});
    if (!e || e.kind === 'quiet') continue;
    live++;
    kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    const key = `${e.kind}/${e.subtype ?? e.anomaly?.id ?? e.speciesName ?? '-'}`;
    pairs[key] = (pairs[key] ?? 0) + 1;
    if (e.title) titles.add(e.title);
    if (e.text) texts.add(e.text);
  }
  return { kinds, pairs, titles, texts, live };
}

describe('the list of kinds is the list of kinds', () => {
  test('every kind the world actually rolls is a declared kind', () => {
    // Derived from what `rollEncounter` PRODUCES, not from the declaration.
    //
    // The first version of this guard iterated ENCOUNTER_KINDS and asked
    // whether each was covered — which means deleting an entry made it check
    // less and pass, and it did: the control ran clean. A list cannot be the
    // authority on its own completeness.
    //
    // `trapped` had been produced by `buildTrap` since traps were written and
    // was absent from the array. Two guards enumerate ENCOUNTER_KINDS to decide
    // their coverage, so it was covered by neither, and that is how a trap
    // whose button printed the wrong power channel survived a test whose whole
    // subject is buttons printing the wrong thing.
    const rolled = new Set();
    for (let seed = 0; seed < 4000; seed++) {
      const sys = SYSTEMS[seed % SYSTEMS.length];
      const e = rollEncounter(new RNG(hashSeed(`kinds${seed}`)), sys.id, {});
      if (e?.kind) rolled.add(e.kind);
    }
    assert.ok(rolled.size >= 8, `only ${rolled.size} kinds rolled; the survey has gone blind`);
    const undeclared = [...rolled].filter((k) => !ENCOUNTER_KINDS.includes(k)).sort();
    assert.deepEqual(undeclared, [],
      'kinds the game rolls that ENCOUNTER_KINDS does not name, so nothing that enumerates it covers them');
  });

  test('and every declared kind is one the world can actually roll', () => {
    // The other direction, so the array cannot grow entries that describe
    // nothing. `challenge` is deliberately not a kind — it is a patrol with a
    // flag — and this is what would catch it being added as one.
    const rolled = new Set();
    for (let seed = 0; seed < 4000; seed++) {
      const sys = SYSTEMS[seed % SYSTEMS.length];
      const e = rollEncounter(new RNG(hashSeed(`kinds${seed}`)), sys.id, {});
      if (e?.kind) rolled.add(e.kind);
    }
    const phantom = ENCOUNTER_KINDS.filter((k) => !rolled.has(k)).sort();
    assert.deepEqual(phantom, [], 'declared kinds the world never produces');
  });
});

describe('what a five-year mission is made of', () => {
  const s = survey();

  test('no one thing is most of what happens', () => {
    // The measurement this file was written after: anomalies were 52% of every
    // live encounter in the game. A player's default experience of a starship
    // command simulator was a sentence about a gravitic eddy.
    // 28%, and the two quiet-watch kinds measure 26.0% and 24.0% — deliberately
    // close to the bar, because they are supposed to be most of a five-year
    // mission BETWEEN them and neither is supposed to be it alone. The figure
    // is deterministic, so a tight bar is a regression detector rather than a
    // flake.
    const worst = Object.entries(s.kinds).sort((a, b) => b[1] - a[1])[0];
    assert.ok(worst[1] / s.live < 0.28,
      `${worst[0]} is ${Math.round(worst[1] / s.live * 100)}% of everything that happens`);
    // And specifically the one that was: it is a fifth of the game now, not a
    // half, and the assertion names it so a regression says which.
    const anomalyShare = (s.kinds.anomaly ?? 0) / s.live;
    assert.ok(anomalyShare < 0.3,
      `anomalies are back to ${Math.round(anomalyShare * 100)}% of everything`);
  });

  test('and the quiet watches are not all the same watch', () => {
    // The other half of the same problem. `signal` is what a quiet branch
    // produces now, and if it had one entry it would simply be the new
    // anomaly.
    const bySignal = Object.entries(s.pairs).filter(([k]) => k.startsWith('signal/'));
    assert.ok(bySignal.length >= 6,
      `only ${bySignal.length} kinds of quiet watch ever came up`);
    const biggest = bySignal.sort((a, b) => b[1] - a[1])[0];
    assert.ok(biggest[1] / s.live < 0.08,
      `${biggest[0]} alone is ${Math.round(biggest[1] / s.live * 100)}% of the game`);
  });

  test('every kind that can happen more than one way, does', () => {
    // Patrol was 15% of all encounters and had ONE line of text. Derelict and
    // convoy had three and one. Named individually rather than as a loop over
    // ENCOUNTER_KINDS, because ambush and trapped legitimately have one shape
    // each and a loop would either fail on them or be weakened to pass.
    for (const [kind, least] of [['patrol', 5], ['derelict', 6], ['convoy', 5],
      ['distress', 4], ['anomaly', 6], ['signal', 6]]) {
      const n = Object.keys(s.pairs).filter((k) => k.startsWith(`${kind}/`)).length;
      assert.ok(n >= least, `${kind} came up in only ${n} form(s)`);
    }
  });

  test('the whole thing says more than a hundred different things', () => {
    // A blunt floor on prose, because every assertion above is about shape and
    // a table of seven identical sentences would satisfy all of them.
    assert.ok(s.texts.size >= 100,
      `the game has ${s.texts.size} distinct opening lines for an encounter`);
    assert.ok(s.titles.size >= 28, `and ${s.titles.size} distinct titles`);
  });

  test('a derelict that looks worse is worse', () => {
    // The risk used to be rolled independently of the description, so "something
    // cut it open from the inside" could be the safest wreck in the game and a
    // quiet intact hull the most dangerous. Measured across the pool rather
    // than asserted on one roll, because both are ranges.
    // Twenty thousand rolls, not three: a derelict is 5% of live encounters
    // and there are seven kinds of one, so three thousand rolls produced four
    // plague hulks and a mean over four samples of a range is not a
    // measurement of anything.
    const worst = { intact: [], opened: [], plague: [] };
    for (let seed = 0; seed < 20000; seed++) {
      const e = rollEncounter(new RNG(hashSeed(`d${seed}`)), 'wolf359', {});
      if (e?.kind !== 'derelict') continue;
      if (worst[e.subtype]) worst[e.subtype].push(e.risk);
    }
    const mean = (a) => a.reduce((n, v) => n + v, 0) / a.length;
    for (const k of Object.keys(worst)) {
      assert.ok(worst[k].length >= 20,
        `only ${worst[k].length} ${k} derelicts in 20,000 rolls — too few to average`);
    }
    assert.ok(mean(worst.opened) > mean(worst.intact),
      'a hull cut open from the inside is no more dangerous than an intact one');
    assert.ok(mean(worst.plague) > mean(worst.opened),
      'a sealed quarantine is no more dangerous than a hull with a hole in it');
  });

  test('a convoy pays for what it is carrying', () => {
    // Same shape of bug: the purse was a flat 200-700 with no relation to the
    // cargo, so escorting medical freighters on a deadline and escorting grain
    // paid the same.
    const purse = {};
    for (let seed = 0; seed < 6000; seed++) {
      const e = rollEncounter(new RNG(hashSeed(`c${seed}`)), 'rigel', {});
      if (e?.kind !== 'convoy') continue;
      (purse[e.subtype] ??= []).push(e.escortReward);
    }
    const mean = (a) => a.reduce((n, v) => n + v, 0) / a.length;
    assert.ok((purse.grain?.length ?? 0) > 3 && (purse.dilithium?.length ?? 0) > 3,
      'not enough convoys to compare');
    assert.ok(mean(purse.dilithium) > mean(purse.grain) * 1.5,
      `sealed ore pays ${Math.round(mean(purse.dilithium))} and grain `
      + `${Math.round(mean(purse.grain))}`);
  });
});

describe('answering a signal', () => {
  const gameAt = (place) => {
    const g = new Game({
      seed: 3n, crewMode: 'original', shipClass: 'constitution',
      character: new Character({ speciesId: 'human', careerId: 'command' }),
    });
    g.locationId = place;
    return g;
  };

  /** Put one specific signal on the viewer, the way an arrival would. */
  const put = (g, id) => {
    const sig = SIGNALS.find((x) => x.id === id);
    assert.ok(sig, `no signal called ${id}`);
    g.encounter = {
      kind: 'signal', system: g.location, hostile: false, hailable: false,
      subtype: sig.id, signal: sig, title: sig.title, text: sig.text,
    };
    return sig;
  };

  test('it offers exactly two answers, and both are real', () => {
    const g = gameAt('sol');
    put(g, 'mail_packet');
    const ids = g.encounterChoices().map((c) => c.id);
    assert.deepEqual(ids, ['answer', 'withdraw']);
    // The cost is on the button. A captain on a schedule is entitled to know
    // what the courier is going to take off him before he says yes.
    const answer = g.encounterChoices()[0];
    assert.match(answer.sub ?? '', /hours/i, `the button said "${answer.sub}"`);
  });

  test('answering costs the hours it said it would', () => {
    const g = gameAt('sol');
    const sig = put(g, 'relay_drift');
    const before = g.clock.stardate;
    const xpBefore = g.progress.xp;
    const out = g.resolveEncounter('answer');
    assert.ok(out.messages.some((m) => m.includes('bearing')), out.messages.join(' | '));
    assert.equal(g.encounter, null, 'the signal stayed on the viewer');
    assert.ok(g.clock.stardate > before, 'answering took no time at all');
    assert.ok(g.progress.xp > xpBefore, `no experience for ${sig.id}`);
    assert.ok(g.ledger.counters.signal_answered >= 1, 'nothing went in the record');
  });

  test('declining costs nothing and still goes in the log', () => {
    const g = gameAt('sol');
    put(g, 'shore_request');
    const before = g.clock.stardate;
    g.resolveEncounter('withdraw');
    assert.equal(g.encounter, null);
    assert.equal(g.clock.stardate, before, 'saying no cost time');
  });

  test('a night off puts every station back on the board', () => {
    // The one signal whose payment is not experience or standing. There is no
    // morale stat in this game and inventing one to justify a line of prose
    // would be the wrong way round, so a rested watch is expressed in the
    // currency that exists: the bridge officers' trays come off cooldown.
    const g = gameAt('sol');
    const officers = g.crew?.officers ?? [];
    assert.ok(officers.length > 0, 'nobody aboard');
    let put_ = 0;
    for (const o of officers) {
      for (const id of o.abilities) { o.startCooldown(id); put_++; }
    }
    assert.ok(put_ > 0, 'no ability could be put on cooldown, so this proves nothing');
    assert.ok(officers.some((o) => o.abilities.some((id) => !o.ready(id))),
      'the setup did not actually make anybody unready');

    put(g, 'shore_request');
    g.resolveEncounter('answer');
    for (const o of officers) {
      for (const id of o.abilities) {
        assert.ok(o.ready(id) || !o.available,
          `${o.name} is still not ready to ${id} after a night off`);
      }
    }
  });

  test('a passing ship fills in the map, and only next door', () => {
    const g = gameAt('sol');
    const links = g.location.links ?? [];
    assert.ok(links.length >= 2, 'Sol has fewer than two neighbours');
    const before = new Set(g.galaxy.surveyed);
    put(g, 'passing_ship');
    g.resolveEncounter('answer');
    const gained = [...g.galaxy.surveyed].filter((id) => !before.has(id));
    assert.deepEqual(gained.sort(), links.slice(0, 2).sort(),
      'their track covered somewhere they had not been');
  });

  test('standing goes to whoever actually asked', () => {
    // A colony administrator in Federation space credits the Federation; the
    // same request out past the border credits the people who live there.
    const home = gameAt('sol');
    // Starfleet standing STARTS AT ITS CEILING of 100, so a captain in good
    // odour gains nothing measurable from a favour — which is correct, and
    // meant the first version of this test asserted 100 > 100 and called the
    // feature broken. Knocked down first, so there is headroom to observe.
    home.ledger.adjustStanding('federation', -20, 'test setup');
    put(home, 'colony_survey');
    const fedBefore = home.ledger.standingOf('federation');
    assert.ok(fedBefore < 100, 'the setup did not leave room for standing to rise');
    home.resolveEncounter('answer');
    assert.ok(home.ledger.standingOf('federation') > fedBefore,
      'helping a Federation colony did nothing for Starfleet');

    const out = gameAt('qonos');
    assert.equal(out.location.faction, 'klingon', 'the control system changed hands');
    put(out, 'colony_survey');
    const fed = out.ledger.standingOf('federation');
    const kli = out.ledger.standingOf('klingon');
    out.resolveEncounter('answer');
    assert.equal(out.ledger.standingOf('federation'), fed,
      'helping a Klingon colony credited Starfleet');
    assert.ok(out.ledger.standingOf('klingon') > kli,
      'helping a Klingon colony did nothing for the Klingons');
  });

  test('the panel says who is telling you', () => {
    // `beginEncounter` printed every encounter as coming from SCIENCE, which
    // was right when everything on the viewer was a sensor contact. A courier
    // hailing with nine weeks of mail is comms, and the department heads
    // asking for a night off is not a sensor reading at all — it arrived on
    // screen under the caption SCIENCE.
    const g = gameAt('sol');
    const sig = put(g, 'shore_request');
    assert.equal(sig.from, 'bridge', 'a note from the crew comes over comms');
    g.encounter = null;
    g.beginEncounter({
      kind: 'signal', system: g.location, hostile: false, from: sig.from,
      subtype: sig.id, signal: sig, title: sig.title, text: sig.text,
    });
    // Found by its TEXT, not by being last. An anomaly raises a yellow alert
    // straight after the contact line, so "the last thing in the log" is the
    // alert and comes from the captain — which is how the control below
    // failed on correct code the first time it was run.
    const said = (game, text) => game.log.filter((l) => l.text === text).pop();
    assert.equal(said(g, sig.text)?.source, 'bridge',
      `it came from ${said(g, sig.text)?.source}`);

    // Every signal names a station, and the courier ones are comms.
    for (const s2 of SIGNALS) {
      assert.ok(s2.from, `${s2.id} does not say who is telling you`);
    }
    assert.ok(SIGNALS.filter((s2) => s2.from === 'comms').length >= 6,
      'signals arrive over something other than the comms board');

    // The control: an anomaly is still a sensor contact and still says so.
    const other = gameAt('sol');
    other.beginEncounter({
      kind: 'anomaly', system: other.location, hostile: false,
      anomaly: { id: 'x', name: 'Rift', hazard: 0.3, value: 2 },
      title: 'Rift', text: 'Sensors are reading a rift.',
    });
    assert.equal(said(other, 'Sensors are reading a rift.')?.source, 'science',
      'an anomaly stopped coming from science');
  });

  test('every signal in the table can be answered without throwing', () => {
    // The blunt one. Eight entries, each with its own combination of hours,
    // experience, standing, charts and rest, and a typo in any of them is a
    // crash in front of the player.
    for (const sig of SIGNALS) {
      const g = gameAt('sol');
      put(g, sig.id);
      const out = g.resolveEncounter('answer');
      assert.ok(out.messages.length > 0, `${sig.id} said nothing`);
      assert.equal(g.encounter, null, `${sig.id} left itself on the viewer`);
    }
    assert.ok(ENCOUNTER_KINDS.includes('signal'), 'signal is not a kind the game can roll');
  });
});
