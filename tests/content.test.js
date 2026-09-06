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
import { readFileSync } from 'node:fs';

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

describe('and you do not read the same sentence all commission', () => {
  // The measurement this half was written after.
  //
  // The frequency of an anomaly had already been fixed once — the note below
  // records anomalies at 52% of every live encounter and the work done to bring
  // them down. But how OFTEN you meet a kind and how many different things it
  // says are two problems, and only the first had been solved. Anomalies had
  // SEVEN entries and one sentence between them, with the name swapped into the
  // gap, and a commission meets about twenty-two of them.
  //
  //   kind            met/commission   texts before   after
  //   anomaly                   21.6              1      24
  //   signal                    19.6              8      16
  //   trapped                    6.5              3       6
  //   first_contact              2.1              1       8
  //
  // Asserted as a RELATION between two measured quantities rather than a bar
  // somebody picked: a kind must carry enough prose that its opening is not
  // read more than twice in a commission. Anomalies at one sentence scored
  // 21.6 and would fail this by a factor of ten.
  const COMMISSION = 120;

  test('no kind makes you read one opening more than twice a commission', () => {
    const rolls = 6000;
    const met = {};
    const texts = {};
    for (let seed = 0; seed < rolls; seed++) {
      const sys = SYSTEMS[seed % SYSTEMS.length];
      const e = rollEncounter(new RNG(hashSeed(`prose${seed}`)), sys.id, {});
      // `quiet` is not shown to anybody — `beginEncounter` is skipped for it —
      // so it has no prose to repeat and counting it would be counting a
      // non-event.
      if (!e || e.kind === 'quiet') continue;
      met[e.kind] = (met[e.kind] ?? 0) + 1;
      (texts[e.kind] ??= new Set()).add(e.text ?? '');
    }
    // The instrument, before anything is believed about it.
    assert.ok(Object.keys(met).length >= 8, `only ${Object.keys(met).length} kinds rolled`);

    const worn = [];
    for (const [kind, n] of Object.entries(met)) {
      const perCommission = (n / rolls) * COMMISSION;
      const distinct = texts[kind].size;
      const rereads = perCommission / distinct;
      if (rereads > 2) {
        worn.push(`${kind}: ${distinct} openings for ${perCommission.toFixed(1)} meetings `
          + `= the same words ${rereads.toFixed(1)} times`);
      }
    }
    assert.deepEqual(worn, [], 'kinds whose prose a captain runs out of');
  });

  test('and every kind says something at all', () => {
    // A kind with no text would score zero rereads and pass the relation above
    // by having nothing to repeat, which is the wrong way to satisfy it.
    const seen = {};
    for (let seed = 0; seed < 3000; seed++) {
      const sys = SYSTEMS[seed % SYSTEMS.length];
      const e = rollEncounter(new RNG(hashSeed(`said${seed}`)), sys.id, {});
      if (!e || e.kind === 'quiet') continue;
      (seen[e.kind] ??= new Set()).add(e.text ?? '');
    }
    for (const [kind, set] of Object.entries(seen)) {
      for (const t of set) {
        assert.ok(t && t.length > 20, `${kind} put "${t}" in front of a captain`);
      }
    }
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
    // `distress` was 4 against a floor of 4 — the only kind in this list sitting
    // exactly on its bar, which is a guard that can catch a deletion and
    // nothing else. Eight ship now, and the floor follows them.
    for (const [kind, least] of [['patrol', 5], ['derelict', 6], ['convoy', 5],
      ['distress', 8], ['anomaly', 6], ['signal', 6]]) {
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

// ============================================ the call, and who is on the end of it

/**
 * A distress call is the one encounter that puts somebody else on the board,
 * and for a long time it did not care what happened to them.
 *
 * Measured before this: twelve hostile distress calls flown to the end. The
 * ship the captain came to save was destroyed in three of them, and the
 * encounter was a win in all twelve — because encounter fights had no objective
 * and defaulted to `destroy`. The rescue did not depend on rescuing anybody.
 */
describe('a distress call is about whoever is calling', () => {
  /** Every distinct distress call the generator can produce. */
  function calls(rolls = 4000) {
    const out = [];
    for (let seed = 0; seed < rolls; seed++) {
      const sys = SYSTEMS[seed % SYSTEMS.length];
      const e = rollEncounter(new RNG(hashSeed(`distress${seed}`)), sys.id, {});
      if (e?.kind === 'distress') out.push(e);
    }
    return out;
  }
  const ALL = calls();

  test('the number on the button is the number in the sentence', () => {
    // `lives` is not decoration: the button reads "N lives at stake", the
    // ledger records it as `lives_saved`, and the experience award scales with
    // it. It was one roll — `rng.int(80, 2400)` — for every subtype, so the
    // screen could say "Fourteen hundred people." over a button offering to
    // save ninety-six of them.
    //
    // The number is parsed out of the prose rather than listed here, so a
    // sentence that names a figure is checked against the figure it names and
    // nothing has to be kept in step by hand.
    const WORDS = {
      fourteen: 14, thirteen: 13, twelve: 12, eleven: 11, ten: 10,
      nine: 9, eight: 8, seven: 7, six: 6, five: 5, four: 4, three: 3, two: 2,
    };
    let checked = 0;
    for (const e of ALL) {
      const m = /\b([a-z]+)\s+hundred\b/i.exec(e.text);
      if (!m) continue;
      const stated = (WORDS[m[1].toLowerCase()] ?? 0) * 100;
      if (!stated) continue;
      checked++;
      assert.equal(e.lives, stated,
        `"${m[0]}" in the text, and ${e.lives} on the button`);
    }
    assert.ok(checked > 0, 'no distress text names a number, so this proves nothing');
  });

  test('the lives at stake suit the thing that is happening', () => {
    // A survey team is a team and a colony is a colony. Asserted as a relation
    // between subtypes rather than a table of numbers: whatever the ranges are,
    // the smallest sort of call must not be able to out-number the largest.
    const range = (id) => {
      const v = ALL.filter((e) => e.subtype === id).map((e) => e.lives);
      return v.length ? { lo: Math.min(...v), hi: Math.max(...v), n: v.length } : null;
    };
    const small = ['shuttle_down', 'stranded'].map(range).filter(Boolean);
    const large = ['colony_raid'].map(range).filter(Boolean);
    assert.ok(small.length && large.length, 'the subtypes under test are not being rolled');
    for (const s2 of small) {
      for (const l of large) {
        assert.ok(s2.hi < l.lo,
          `a small call reaches ${s2.hi} lives and a colony starts at ${l.lo}`);
      }
    }
  });

  test('the ship that is staged is the ship the sentence describes', () => {
    // A colony raid staged a freighter — the same object as "a civilian
    // freighter is under attack", for a sentence about a colony. Derived from
    // the text: a call that says "freighter" stages one, and a call that does
    // not, does not.
    let seen = 0;
    for (const e of ALL) {
      if (!e.victims?.length) continue;
      seen++;
      const hull = e.victims[0].classId;
      if (/freighter/i.test(e.text)) {
        assert.equal(hull, 'freighter', `${e.subtype} names a freighter and stages a ${hull}`);
      } else {
        assert.notEqual(hull, 'freighter',
          `${e.subtype} stages a freighter for a sentence that does not mention one`);
      }
    }
    assert.ok(seen > 0, 'no distress call stages anybody');
  });

  test('not every ship in distress is the same ship', () => {
    const names = new Set(ALL.flatMap((e) => (e.victims ?? []).map((v) => v.name)));
    assert.ok(names.size >= 5,
      `every rescue in the game is one of ${names.size} ship(s): ${[...names].join(', ')}`);
  });

  test('a call that stages somebody asks the fight to keep them alive', () => {
    // The objective is what makes the rescue about the rescue. Without it the
    // fight is `destroy` and the freighter is scenery that can burn.
    let staged = 0;
    for (const e of ALL) {
      if (e.victims?.length) {
        staged++;
        assert.equal(e.objective, 'protect',
          `${e.subtype} puts a ship on the board and does not ask anyone to protect it`);
      } else {
        assert.equal(e.objective, undefined,
          `${e.subtype} asks for a protect objective with nobody to protect`);
      }
    }
    assert.ok(staged > 0, 'no distress call stages anybody');
  });

  test('losing the ship you came for loses the rescue', () => {
    // End to end, through `Game`, because the objective has to survive the trip
    // from the encounter into a real engagement — the spec is not the fight.
    // Rolled FRESH for each arm, not shared. `startCombat` takes the
    // encounter's own `Ship` objects as allies, so killing the victim in one
    // arm leaves it destroyed for the next one — the second experiment then
    // runs on a corpse and reports the first arm's answer twice.
    const roll = () => {
      for (let seed = 0; seed < 4000; seed++) {
        const sys = SYSTEMS[seed % SYSTEMS.length];
        const e = rollEncounter(new RNG(hashSeed(`distress${seed}`)), sys.id, {});
        if (e?.kind === 'distress' && e.victims?.length && e.hostile && e.ships?.length) return e;
      }
      return null;
    };
    assert.ok(roll(), 'the generator produced no hostile distress call with a victim');

    const fly = (killVictim) => {
      const hostile = roll();
      const g = new Game({
        seed: 9n, crewMode: 'original', shipClass: 'constitution', difficulty: 'lieutenant',
        character: new Character({ speciesId: 'human', careerId: 'command' }),
      });
      g.encounter = hostile;
      // Through `resolveEncounter('engage')`, which is the door the player
      // uses. Calling `startCombat` here and passing the objective by hand
      // would prove the objective works and prove nothing about whether the
      // encounter path hands it over — and that path is the change.
      g.resolveEncounter('engage');
      const eng = g.engagement;
      assert.ok(eng, 'no fight started');
      assert.equal(eng.objective, 'protect', 'the encounter objective never reached the fight');
      assert.equal(eng.protectees.length, 1, 'nobody is being protected, so this proves nothing');
      if (killVictim) for (const v of eng.protectees) v.destroyed = true;
      for (let i = 0; i < 40000 && g.engagement && !g.engagement.over; i++) {
        if (i % 15 === 0) {
          g.engagement.comeAboutTo(g.engagement.target);
          g.ship.throttle = 0.6;
          g.ship.power.applyPreset('attack');
        }
        // The other arm keeps her alive rather than hoping she lives. She is a
        // civilian hull in a firefight and she dies on her own about a quarter
        // of the time, so "did not kill her" is not the same experiment as
        // "she survived" — and a control that only sometimes controls is not
        // one.
        if (!killVictim) for (const v of eng.protectees) v.hull = v.maxHull;
        g.update(1 / 30);
      }
      return g.lastCombat?.outcome ?? eng.outcome;
    };

    assert.equal(fly(true), 'failed',
      'the ship we came to save was destroyed and the rescue was not a failure');
    assert.notEqual(fly(false), 'failed',
      'the rescue failed with the ship we came for still flying');
  });

  test('leaving a call costs the same however the panel is shaped', () => {
    // `encounterChoices` returns early for any hostile encounter, above the
    // `distress` case, so a call with raiders on it never gets `ignore` — it
    // gets `withdraw`, which fell through to a shared arm and did nothing.
    // Measured: 126 of 337 calls are hostile, so for 37% of them a captain
    // could fly away from people asking for help and the game recorded
    // neither the standing nor the fact — while declining to divert for a
    // stranded survey team, the same act and a smaller one, cost three points.
    //
    // Asserted as a relation over whatever the generator produces rather than
    // as two numbers: whichever exit a call offers, taking it must cost the
    // same and leave a mark.
    const exits = new Map();
    for (const e of ALL) {
      const g = new Game({
        seed: 5n, crewMode: 'original', shipClass: 'constitution',
        character: new Character({ speciesId: 'human', careerId: 'command' }),
      });
      g.encounter = e;
      const ids = g.encounterChoices().map((c) => c.id);
      const exit = ids.includes('ignore') ? 'ignore' : 'withdraw';
      const before = g.ledger.standingOf('federation');
      const marks = g.ledger.entries?.length ?? 0;
      g.resolveEncounter(exit);
      exits.set(exit, {
        delta: g.ledger.standingOf('federation') - before,
        recorded: (g.ledger.entries?.length ?? 0) > marks,
      });
    }
    assert.equal(exits.size, 2,
      `only one kind of exit was exercised: ${[...exits.keys()].join(', ')}`);
    const [a, b] = [...exits.values()];
    assert.ok(a.recorded && b.recorded, 'an exit that leaves no mark on the record');
    assert.ok(a.delta < 0 && b.delta < 0, 'an exit that costs nothing');
    assert.equal(a.delta, b.delta,
      `one way out costs ${a.delta} and the other ${b.delta}`);
  });

  test('and nothing else is charged for walking away', () => {
    // `withdraw` is how a captain also leaves an anomaly, a signal, a patrol, a
    // convoy, a derelict and a first contact — nine kind-and-hostility
    // combinations. None of those is an abandonment, and a cost on the shared
    // arm would price them all.
    let checked = 0;
    for (let seed = 0; seed < 1200; seed++) {
      const sys = SYSTEMS[seed % SYSTEMS.length];
      const e = rollEncounter(new RNG(hashSeed(`away${seed}`)), sys.id, {});
      if (!e || e.kind === 'quiet' || e.kind === 'distress') continue;
      const g = new Game({
        seed: 5n, crewMode: 'original', shipClass: 'constitution',
        character: new Character({ speciesId: 'human', careerId: 'command' }),
      });
      g.encounter = e;
      if (!g.encounterChoices().some((c) => c.id === 'withdraw')) continue;
      checked++;
      const before = g.ledger.standingOf('federation');
      g.resolveEncounter('withdraw');
      assert.equal(g.ledger.standingOf('federation'), before,
        `withdrawing from ${e.kind} cost Federation standing`);
    }
    assert.ok(checked > 50, `only ${checked} non-distress withdrawals exercised`);
  });

  test('every call shows what is at stake on it', () => {
    // `lives` is rolled for every subtype and was printed only on the `assist`
    // button, which the hostile early return makes unreachable — so on a raided
    // colony, the largest stakes in the encounter layer at 600 to 3,200 people,
    // the figure was computed and shown nowhere.
    for (const e of ALL) {
      const g = new Game({
        seed: 5n, crewMode: 'original', shipClass: 'constitution',
        character: new Character({ speciesId: 'human', careerId: 'command' }),
      });
      g.encounter = e;
      const subs = g.encounterChoices().map((c) => c.sub ?? '').join(' | ');
      assert.ok(subs.includes(String(e.lives)),
        `${e.subtype} risks ${e.lives} lives and no button says so: ${subs}`);
    }
  });

  test('the panel names whoever the call is about', () => {
    // The briefing listed the two Orion raiders and never the transport lifting
    // people off the colony — the one ship on the board whose survival decides
    // the outcome, absent from the panel about it.
    //
    // Read from the source: the panel is DOM built inside a screen function
    // with no seam to call, and what is being guarded is that it renders both
    // lists and not just the one.
    const screens = readFileSync('src/ui/screens.js', 'utf8');
    const i = screens.indexOf('export function encounterPanel');
    assert.ok(i > 0, 'the encounter panel has moved');
    const block = screens.slice(i, screens.indexOf('const choices =', i));
    assert.ok(/enc\.ships/.test(block), 'the panel stopped naming the hostiles');
    assert.ok(/enc\.victims/.test(block),
      'the panel names the hostiles and not the ship the encounter is about');
  });

  test('no distress branch is a door the player cannot open', () => {
    // The `assist` case carried twelve commented lines for "the distress call
    // that turns out to be a trap", guarded by a test that called
    // `resolveEncounter('assist')` directly — through a door
    // `encounterChoices` never opens, because it returns early for every
    // hostile encounter above the `distress` case. It also staged its fight
    // with no allies and no objective, so had anyone reached it the ship being
    // rescued would not have been in the battle.
    //
    // Derived: collect every choice id the panel actually offers on a distress
    // call, then require the resolver's distress-only branches to be among
    // them.
    const offered = new Set();
    for (const e of ALL) {
      const g = new Game({
        seed: 5n, crewMode: 'original', shipClass: 'constitution',
        character: new Character({ speciesId: 'human', careerId: 'command' }),
      });
      g.encounter = e;
      for (const c of g.encounterChoices()) offered.add(c.id);
    }
    assert.ok(offered.size >= 4, `only ${offered.size} ids ever offered`);
    // `assist` and `ignore` are the two the non-hostile panel adds; both must
    // still be reachable, and nothing may resolve a distress call that is not.
    for (const id of ['assist', 'ignore', 'engage', 'withdraw']) {
      assert.ok(offered.has(id), `${id} resolves a distress call and is never offered`);
    }
    const state = readFileSync('src/core/state.js', 'utf8');
    assert.ok(!/enc\.hostile && enc\.ships\?\.length/.test(state),
      'the unreachable hostile arm of the assist branch is back');
  });

  test('a rescue that succeeded is recorded as a rescue, whichever door', () => {
    // `finishCombat` reads only the outcome, so answering a call by fighting
    // for it paid combat experience and nothing else: a raided colony fought
    // and won with the transport still flying recorded `distress_answered: 0`
    // and `lives_saved: 0`, where the same call answered quietly recorded 1 and
    // every one of the lives. The button says "Go to their aid".
    //
    // Compared as a record SHAPE against the quiet door rather than against
    // numbers, so the two ways of answering a call cannot drift apart.
    const mk = () => new Game({
      seed: 5n, crewMode: 'original', shipClass: 'constitution', difficulty: 'lieutenant',
      character: new Character({ speciesId: 'human', careerId: 'command' }),
    });
    const shape = (g) => ({
      answered: g.ledger.counters?.distress_answered ?? 0,
      lives: g.ledger.counters?.lives_saved ?? 0,
    });

    const quiet = ALL.find((e) => !e.hostile);
    const raid = ALL.find((e) => e.hostile && e.victims?.length && e.ships?.length);
    assert.ok(quiet && raid, 'the generator produced only one shape of call');

    const a = mk(); a.encounter = quiet; a.resolveEncounter('assist');
    assert.deepEqual(shape(a), { answered: 1, lives: quiet.lives });

    const fly = (keepAlive) => {
      const g = mk();
      g.encounter = raid;
      g.resolveEncounter('engage');
      const eng = g.engagement;
      assert.ok(eng?.rescue, 'the fight does not know it is a rescue');
      for (let i = 0; i < 40000 && g.engagement && !g.engagement.over; i++) {
        if (i % 15 === 0) {
          g.engagement.comeAboutTo(g.engagement.target);
          g.ship.throttle = 0.6;
          g.ship.power.applyPreset('attack');
        }
        for (const v of eng.protectees) {
          if (keepAlive) v.hull = v.maxHull; else v.destroyed = true;
        }
        g.update(1 / 30);
      }
      return shape(g);
    };

    assert.deepEqual(fly(true), { answered: 1, lives: raid.lives },
      'the transport came through and the record shows a firefight');
    assert.deepEqual(fly(false), { answered: 0, lives: 0 },
      'the ship we came for was destroyed and the rescue was credited anyway');
  });
});
