// The capitals, and the first episodes that follow from another one.
//
// Ten of the map's twenty sectors hosted no episode at all, and among them was
// every great power's home space — Qo'noS, Romulus, Cardassia Prime, the Gamma
// Quadrant. Fifteen of forty-three systems had anything authored in them, and
// the endgame was thinnest of all: Act 4 had two episodes, Act 5 had one.
//
// Nothing chained, either. Sixteen episodes, forty-three flags, and the only
// cross-content dependency in the whole book was `court_martial` waiting on a
// flag the LEDGER raises rather than an episode.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';
import { EPISODES, EPISODE_BY_ID } from '../src/missions/episodes/index.js';
import { SYSTEM_BY_ID } from '../src/world/systems.data.js';
import { ROOMS } from '../src/world/interiors.data.js';

const NEW = ['qonos_council', 'romulus_debt'];

/** A flag officer, optionally carrying what an earlier episode gave them. */
function captain({ seed = 6n, flags = [], standing = {} } = {}) {
  const g = new Game({
    seed, crewMode: 'original',
    character: new Character({ speciesId: 'human', careerId: 'command' }),
    shipClass: 'excelsior',
  });
  // One rank per call — a promotion is an event, not an arithmetic result.
  while (g.progress.nextRank) g.progress.addXP(200000, { ledger: g.ledger });
  for (const f of flags) g.ledger.setFlag(f);
  for (const [k, v] of Object.entries(standing)) g.ledger.adjustStanding(k, v, 'test');
  return g;
}

/** Walk the captain and let them arrive. */
function walkTo(g, roomId) {
  g.goToRoom(roomId);
  for (let n = 0; n < 4000 && g.walkOrder; n++) g.update(1 / 30);
}

describe('an episode can follow from another episode', () => {
  test('the capitals are offered only to a captain who earned them', () => {
    // Through `availableAt`, which is the door the briefing room and the map
    // marker both read. `missions.start` deliberately does not check this, so
    // asserting on `start` would prove nothing.
    for (const [id, flag, system] of [
      ['qonos_council', 'kang_respects_you', 'qonos'],
      ['romulus_debt', 'spared_warbird', 'romulus'],
    ]) {
      const without = captain();
      assert.ok(!without.missions.availableAt(system, without).some((e) => e.id === id),
        `${id} was offered to a captain who never earned it`);

      const with_ = captain({ flags: [flag] });
      assert.ok(with_.missions.availableAt(system, with_).some((e) => e.id === id),
        `${id} was withheld from a captain carrying ${flag}`);
    }
  });

  test('and the flag it waits on is one an earlier episode actually pays', () => {
    // A gate on a flag nothing writes is an episode no captain can ever reach.
    const paid = new Map();
    for (const ep of EPISODES) {
      for (const [sid, stage] of Object.entries(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) {
          for (const f of [].concat(c.effects?.flag ?? [])) paid.set(f, `${ep.id}/${sid}`);
        }
      }
      for (const [k, e] of Object.entries(ep.endings ?? {})) {
        for (const f of [].concat(e.effects?.flag ?? [])) paid.set(f, `${ep.id}!${k}`);
      }
    }
    for (const id of NEW) {
      const need = EPISODE_BY_ID[id].requiresFlag;
      assert.ok(need, `${id} does not follow from anything`);
      assert.ok(paid.has(need), `${id} waits on "${need}", which no episode pays`);
      // And from an EARLIER act, or it is not a chain, it is a lock.
      const from = EPISODE_BY_ID[paid.get(need).split(/[/!]/)[0]];
      assert.ok(from.act < EPISODE_BY_ID[id].act,
        `${id} (act ${EPISODE_BY_ID[id].act}) waits on ${from.id} (act ${from.act})`);
    }
  });

  test('the world already agreed with the chain', () => {
    // Qo'noS refuses a berth below Klingon standing 10 and Romulus below
    // Romulan 25 — `requiresStanding`, written into the map long before this.
    // The episodes that pay those flags pay standing in the same direction, so
    // the ship that can dock is in practice the ship that earned the flag.
    assert.ok(SYSTEM_BY_ID.qonos.requiresStanding?.klingon > 0);
    assert.ok(SYSTEM_BY_ID.romulus.requiresStanding?.romulan > 0);
    const paysKlingon = EPISODE_BY_ID.archanis_claim;
    const found = JSON.stringify(paysKlingon).includes('kang_respects_you');
    assert.ok(found, 'Archanis no longer pays the flag Qo’noS waits on');
  });
});

describe('the capitals themselves', () => {
  test('each is set at a real system in a sector that had nothing', () => {
    for (const id of NEW) {
      const ep = EPISODE_BY_ID[id];
      assert.ok(ep, `${id} is not in the book`);
      const sys = SYSTEM_BY_ID[ep.system];
      assert.ok(sys, `${id} is set at unknown system ${ep.system}`);
      assert.equal(ep.act, 4, `${id} is act ${ep.act}`);
    }
    // And they close the gap they were written for.
    const acts = {};
    for (const ep of EPISODES) acts[ep.act] = (acts[ep.act] ?? 0) + 1;
    assert.ok(acts[4] >= 4, `act 4 still has only ${acts[4]} episodes`);
  });

  test('and every route through each of them ends', () => {
    // The walker in wiring.test.js does this for all episodes; this pins the
    // two new ones specifically, with the flags that open their extra routes.
    for (const id of NEW) {
      const ep = EPISODE_BY_ID[id];
      for (let trial = 0; trial < 12; trial++) {
        const g = captain({
          seed: BigInt(700 + trial),
          flags: ['kang_respects_you', 'spared_warbird',
            'fired_first_archanis', 'kang_left_room', 'fired_first_neutral_zone'],
        });
        const m = g.missions.start(id, g);
        g.locationId = ep.system;
        let steps = 0;
        for (; steps < 60 && !m.complete; steps++) {
          const here = m.testLocation();
          if (!here.ok) { g.locationId = here.need; continue; }
          const inside = m.testWhere();
          if (!inside.ok && inside.need !== 'surface') { walkTo(g, inside.need); continue; }
          const open = m.choices().filter((c) => !c.locked);
          assert.ok(open.length, `${id}/${m.stageId}: nothing open on trial ${trial}`);
          g.chooseMission(open[(trial * 5 + steps * 3) % open.length].id);
        }
        assert.ok(m.complete, `${id} did not end on trial ${trial} after ${steps} steps`);
      }
    }
  });

  test('no stage of them is only reachable by having done something', () => {
    // The walker constraint: it plays with no flags and no variables at all.
    for (const id of NEW) {
      for (const [sid, stage] of Object.entries(EPISODE_BY_ID[id].stages)) {
        assert.ok(stage.choices.some((c) => !c.requires),
          `${id}/${sid}: every way out is gated`);
      }
    }
  });

  test('and the one that sends you to the armoury sends you somewhere real', () => {
    // The armoury has existed since the interiors were written and no episode
    // had ever sent anybody to it.
    const stage = EPISODE_BY_ID.qonos_council.stages.blade;
    assert.equal(stage.where, 'armoury');
    assert.ok(ROOMS.armoury, 'there is no armoury aboard');
    const g = captain({ flags: ['kang_respects_you'] });
    const m = g.missions.start('qonos_council', g);
    g.locationId = 'qonos';
    m.stageId = 'blade';
    assert.equal(m.testWhere().ok, false, 'the blade scene played from the bridge');
    walkTo(g, 'armoury');
    assert.equal(m.testWhere().ok, true, 'the captain could not reach the armoury');
  });

  test('the blade you took off a Romulan yourself is a fourth one', () => {
    // §110. The armoury scene offers two Federation blades that are wrong and a
    // third the tactical officer will not account for. A captain who boarded a
    // decloaked warbird in the Neutral Zone in act 2 and took her cloaking
    // device off her by hand has a fourth, and it is the only one in the room
    // he took off an enemy himself — which is the answer Duras's accusation
    // actually calls for.
    const stage = EPISODE_BY_ID.qonos_council.stages.blade;
    const taken = stage.choices.find((c) => c.id === 'taken');
    assert.ok(taken, 'the blade taken off the Romulan is gone');
    assert.deepEqual(taken.requires, { flag: 'captured_cloak' });

    const open = (flags) => {
      const g = captain({ flags });
      const m = g.missions.start('qonos_council', g);
      g.locationId = 'qonos';
      m.stageId = 'blade';
      walkTo(g, 'armoury');
      return m.choices().filter((c) => !c.locked).map((c) => c.id);
    };
    assert.equal(open(['kang_respects_you']).includes('taken'), false,
      'offered to a captain who never boarded her');
    assert.ok(open(['kang_respects_you', 'captured_cloak']).includes('taken'),
      'the boarding bought nothing');
  });

  test('and a captain really can hold both of the flags that scene needs', () => {
    // The warning this file already carries: granting flags with `setFlag`
    // proves a gate READS a flag and never that anybody can hold it. Two
    // shipped choices died that way, one of them in this very episode
    // (`charge/own_it`, which wanted `archanis_massacre` alongside
    // `kang_respects_you`).
    //
    // `wiring.test.js` holds the general guard. What is asserted here is the
    // specific fact that makes this choice reachable: the two flags come from
    // DIFFERENT episodes, so nothing forces a captain to choose between them.
    // `captured_cloak` is a sibling of `spared_warbird` at one stage of
    // `outpost_silence`, which is exactly why the same flag cannot be read
    // inside `romulus_debt` — and nearly was, twice.
    const from = (flag) => {
      const out = new Set();
      for (const ep of EPISODES) {
        for (const stage of Object.values(ep.stages ?? {})) {
          for (const c of stage.choices ?? []) {
            if ([].concat(c.effects?.flag ?? []).includes(flag)) out.add(ep.id);
          }
        }
      }
      return out;
    };
    const cloak = from('captured_cloak');
    const kang = from('kang_respects_you');
    assert.ok(cloak.size && kang.size, 'one of the two flags is written by nothing');
    assert.equal([...cloak].some((id) => kang.has(id)), false,
      `both flags are written inside ${[...cloak].join(',')}, so a captain may have to choose`);
  });

  test('a scene held in a Klingon hall is not held on your own bridge', () => {
    // Both episodes happen off the ship. The room default is 'bridge' and the
    // engine enforces it, so every such stage has to say so.
    for (const id of NEW) {
      for (const [sid, stage] of Object.entries(EPISODE_BY_ID[id].stages)) {
        assert.ok(stage.where, `${id}/${sid} does not say where it happens`);
        if (stage.where !== 'anywhere') {
          assert.ok(ROOMS[stage.where], `${id}/${sid} happens in "${stage.where}"`);
        }
      }
    }
  });
});

describe('what the new episodes read back', () => {
  test('a captain who did the worse thing can say so', () => {
    // The gates these choices carry, and a correction to what this comment
    // used to say. It claimed `archanis_massacre` and `captured_cloak` were
    // "both write-only"; `archanis_massacre` is read by `Game.FACTION_MEMORY`
    // at -0.30. More to the point, both gates were IMPOSSIBLE — see the
    // holdability test below and the comments in `capitals.js`.
    for (const [id, system, stage, choice, flag] of [
      ['qonos_council', 'qonos', 'charge', 'own_it', 'fired_first_archanis'],
      ['qonos_council', 'qonos', 'charge', 'sent_away', 'kang_left_room'],
      ['qonos_council', 'qonos', 'seconded', 'my_dead', 'owned_archanis'],
      ['romulus_debt', 'romulus', 'told', 'came_first', 'fired_first_neutral_zone'],
      ['romulus_debt', 'romulus', 'testify', 'he_knew', 'told_telek_first'],
    ]) {
      const gate = EPISODE_BY_ID[id].requiresFlag;
      const open = (flags) => {
        const g = captain({ flags });
        const m = g.missions.start(id, g);
        g.locationId = system;
        m.stageId = stage;
        return m.choices();
      };
      const withIt = open([gate, flag]).find((c) => c.id === choice);
      const without = open([gate]).find((c) => c.id === choice);
      assert.ok(withIt && !withIt.locked, `${id}/${choice} locked for a captain who has ${flag}`);
      assert.ok(without?.locked, `${id}/${choice} open to a captain who does not`);
      assert.ok(without.lockReason, 'a locked choice with no reason on it');
    }
  });

  test('and a captain can hold what the gate asks for, by playing for it', () => {
    // The test above hands the flags over with `setFlag`. That proves the gate
    // READS the flag; it never asks whether a captain can HOLD it — and for
    // both shipped gates the answer was no.
    //
    //   qonos_council  gate kang_respects_you   choice needed archanis_massacre
    //   romulus_debt   gate spared_warbird      choice needed captured_cloak
    //
    // Every one of those four flags is written only by a TERMINAL choice of
    // one episode — `archanis_claim` and `outpost_silence` — and a playthrough
    // takes exactly one terminal choice, so the pairs were mutually exclusive.
    // The choices could never open, and every captain who reached those stages
    // was shown a greyed button with "Not yet available" on it forever.
    //
    // So this plays the route instead of granting the state, which is the only
    // version of the question the game can actually answer.
    const play = (g, id, choices) => {
      const m = g.missions.start(id, g);
      for (const cid of choices) {
        const here = m.testLocation();
        if (!here.ok) g.locationId = here.need;
        const inside = m.testWhere();
        if (!inside.ok && inside.need && inside.need !== 'surface') walkTo(g, inside.need);
        const pick = m.choices().find((c) => c.id === cid);
        assert.ok(pick && !pick.locked,
          `${id}/${m.stageId}/${cid}: ${pick ? 'locked — ' + pick.lockReason : 'no such choice'}`);
        m.choose(cid);
        if (m.pending) m.settleCombat('victory');
      }
      g.missions.finishActive();
      return m;
    };

    // Fire on Kang at Archanis, then take his people off the wreck.
    const klingon = captain();
    play(klingon, 'archanis_claim', ['attack', 'rescue']);
    assert.ok(klingon.ledger.has('fired_first_archanis'), 'the route did not fire first');
    assert.ok(klingon.ledger.has('kang_respects_you'), 'the route did not earn the berth');
    klingon.locationId = 'qonos';
    const council = klingon.missions.start('qonos_council', klingon);
    council.stageId = 'charge';
    const ownIt = council.choices().find((c) => c.id === 'own_it');
    assert.ok(ownIt && !ownIt.locked,
      'a captain who played for it still cannot read the list at Qo\'noS');
    // And the callback one stage later, which only opens by taking it.
    council.choose('own_it');
    const myDead = council.choices().find((c) => c.id === 'my_dead');
    assert.ok(myDead && !myDead.locked, 'the Council forgot what he just did in the room');

    // Fire first inside the Zone, then let the commander go home anyway.
    const romulan = captain();
    play(romulan, 'outpost_silence', ['silent', 'wait', 'fire', 'honour']);
    assert.ok(romulan.ledger.has('fired_first_neutral_zone'), 'the route did not fire first');
    assert.ok(romulan.ledger.has('spared_warbird'), 'the route did not earn the berth');
    romulan.locationId = 'romulus';
    const senate = romulan.missions.start('romulus_debt', romulan);
    senate.stageId = 'told';
    const cameFirst = senate.choices().find((c) => c.id === 'came_first');
    assert.ok(cameFirst && !cameFirst.locked,
      'a captain who played for it still cannot tell Telek what his record says');
    senate.choose('came_first');
    senate.choose('disarm');
    senate.choose('testify');
    const heKnew = senate.choices().find((c) => c.id === 'he_knew');
    assert.ok(heKnew && !heKnew.locked, 'the chamber forgot what he told Telek');
  });

  test('and the variable each one sets is read', () => {
    // Same rule as everywhere else: no third write-only mechanism.
    const written = new Set();
    const read = new Set();
    for (const id of NEW) {
      for (const stage of Object.values(EPISODE_BY_ID[id].stages)) {
        for (const c of stage.choices ?? []) {
          for (const k of Object.keys(c.effects?.setVar ?? {})) written.add(`${id}:${k}`);
          for (const k of Object.keys(c.requires?.var ?? {})) read.add(`${id}:${k}`);
          if (typeof c.next === 'function' && c.next.reads) read.add(`${id}:${c.next.reads}`);
        }
      }
    }
    assert.ok(written.size >= 2, `only ${written.size} variables set`);
    assert.deepEqual([...written].filter((k) => !read.has(k)), [],
      'variables the capitals write and nothing reads');
  });
});

// §114. The longest reach in the book.
//
// `centauri_drift` is act 1 — the second episode a captain ever flies. A Klingon
// scout is adrift eleven million kilometres inside Federation space with a
// reactor that is "not failed, failing, which is a slower and worse thing", and
// the lieutenant who answers the hail says they require nothing. `centauri_aid`
// is every road where he takes them off regardless: aboard, by bypass, under
// tow, or after they have formally refused in writing.
//
// Duras's charge in act 4 is that Kang vouched for an outsider.
describe('a Klingon crew he pulled off a dying ship in act one', () => {
  const stage = EPISODE_BY_ID.qonos_council.stages.charge;

  const open = (flags) => {
    const g = captain({ flags: ['kang_respects_you', ...flags] });
    return stage.choices
      .filter((c) => !c.requires?.flag || g.ledger.has(c.requires.flag))
      .map((c) => c.id);
  };

  test('answers the charge, and only for the captain who did it', () => {
    const gated = stage.choices.find((c) => c.id === 'centauri');
    assert.ok(gated, 'the Centauri answer is gone');
    assert.deepEqual(gated.requires, { flag: 'centauri_aid' });
    assert.equal(open([]).includes('centauri'), false,
      'offered to a captain who let them drift');
    assert.ok(open(['centauri_aid']).includes('centauri'), 'Alpha Centauri bought nothing');
  });

  test('and it really does reach back to the first act', () => {
    // The reach is the point of the section, so it is asserted rather than
    // described. `wiring.test.js` holds the general rule that a gate reads a
    // strictly earlier act; this pins the distance.
    const firstAct = Math.min(...EPISODES
      .filter((ep) => Object.values(ep.stages ?? {}).some((s) => (s.choices ?? [])
        .some((c) => [].concat(c.effects?.flag ?? []).includes('centauri_aid'))))
      .map((ep) => ep.act));
    assert.equal(firstAct, 1, `centauri_aid is first earned in act ${firstAct}`);
    assert.equal(EPISODE_BY_ID.qonos_council.act, 4);
  });

  test('and it costs him nothing with his own service, unlike the answer beside it', () => {
    // `sent_away` tells the Great Hall that a Federation officer once offered
    // Kang a way out, and pays -4 federation for it. This one is a rescue he
    // never mentioned to anybody, so there is nothing for Starfleet to mind.
    const centauri = stage.choices.find((c) => c.id === 'centauri');
    const sentAway = stage.choices.find((c) => c.id === 'sent_away');
    assert.equal(centauri.effects.standing.federation, undefined);
    assert.ok(sentAway.effects.standing.federation < 0,
      'the comparison this rests on has changed');
    assert.ok(centauri.effects.standing.klingon > sentAway.effects.standing.klingon,
      'the hall thinks less of a rescue than of a quotation');
  });
});

// §118. Donatu V, answered in the Great Hall.
describe('the captain who offered terms without stepping back', () => {
  const stage = EPISODE_BY_ID.qonos_council.stages.seconded;

  const open = (flags) => {
    const g = captain({ flags: ['kang_respects_you', ...flags] });
    return stage.choices
      .filter((c) => !c.requires?.flag || g.ledger.has(c.requires.flag))
      .map((c) => c.id);
  };

  test('can say so when Duras names a champion', () => {
    const gated = stage.choices.find((c) => c.id === 'from_here');
    assert.ok(gated, 'the Donatu answer is gone');
    assert.deepEqual(gated.requires, { flag: 'donatu_pressed' });
    assert.equal(open([]).includes('from_here'), false,
      'offered to a captain who never made that offer');
    assert.ok(open(['donatu_pressed']).includes('from_here'), 'Donatu bought nothing');
  });

  test('and it reaches the duel, because the Council will not be talked out of a rite', () => {
    // It changes who is understood to have chosen the challenge, not whether
    // there is one. A road that dodged the duel would be a different episode.
    const gated = stage.choices.find((c) => c.id === 'from_here');
    const accept = stage.choices.find((c) => c.id === 'accept');
    assert.equal(gated.next, accept.next);
    assert.equal(gated.outcome, undefined, 'it ends the episode instead of answering the challenge');
    // Parenthesised: `a > b ?? 0` parses as `(a > b) ?? 0`, which is the
    // comparison's own result and never the fallback — so the first draft of
    // this line compared against `undefined` and asserted `false`.
    assert.ok(gated.effects.standing.klingon > (accept.effects.standing?.klingon ?? 0),
      'the hall thinks no more of it than of simply accepting');
  });
});
