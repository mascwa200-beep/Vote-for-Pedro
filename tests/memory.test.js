// Fifty-seven things the ship wrote down and never read again.
//
// The campaign ledger records what the captain did, as flags: `archanis_massacre`,
// `torvan_owes_you`, `paid_orions`, `kang_respects_you`. Fifty-seven of them are
// written by the episode book. Eight are read, all eight by `requiresFlag` and
// `requires: { flag }` inside other episodes. **Nothing outside
// `src/missions/episodes/` reads a single mission flag**, and that includes the
// one system whose entire job is the other side's opinion of you.
//
// Measured at 120 seeds, a Klingon negotiation through `Game.hail`:
//
//     nothing remembered                          40.0%
//     Kang has spoken for you at the council      40.0%
//     you refused a surrender and killed 42       40.0%
//
// `resolveHail` did have one thing it called memory — `firstStrike`, with the
// comment "you shot first; they remember" — a single boolean about the last few
// minutes, next to a five-year record nobody opened.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';
import { resolveHail } from '../src/sim/diplomacy.js';
import { EPISODES } from '../src/missions/episodes/index.js';
import { FACTIONS } from '../src/world/factions.data.js';

const AGREED = new Set(['stand_down', 'surrendered', 'bought_off', 'warned_off', 'stood_down']);

/** Hail them, the way the game does, and count who agreed. */
function rate(flags, { faction = 'klingon', foe = 'd7', option = 'negotiate', n = 120n } = {}) {
  let ok = 0;
  let seen = 0;
  for (let s = 1n; s <= n; s++) {
    const g = new Game({ seed: s, crewMode: 'original' });
    for (const f of flags) g.ledger.setFlag(f);
    g.startCombat([new Ship(foe, { faction, name: 'X' })]);
    const r = g.hail(option);
    seen++;
    if (AGREED.has(r.outcome)) ok++;
  }
  return ok / seen;
}

/**
 * Every flag any episode actually writes.
 *
 * Choices AND endings. The first draft of this walked choices only and reported
 * `romulan_favour` as a flag the memory table had invented — it is set by
 * `romulus_debt`'s "The record corrected" ending, which is exactly where a
 * flag about how Romulus feels afterwards belongs. An inventory that misses a
 * whole shape of write is worse than no inventory: it accuses the code.
 */
const WRITTEN = new Set();
for (const ep of EPISODES) {
  for (const stage of Object.values(ep.stages ?? {})) {
    for (const choice of stage.choices ?? []) {
      for (const f of [].concat(choice.effects?.flag ?? [])) WRITTEN.add(f);
    }
  }
  for (const ending of Object.values(ep.endings ?? {})) {
    for (const f of [].concat(ending.effects?.flag ?? [])) WRITTEN.add(f);
  }
}

describe('the other side remembers what you did to them', () => {
  test('a captain with no history gets the plain answer', () => {
    // The control the two below are measured against.
    const plain = rate([]);
    assert.ok(plain > 0.2 && plain < 0.7,
      `${(100 * plain).toFixed(1)}% is too far from the middle to measure a shift either way`);
  });

  test('and one Kang has spoken for does better', () => {
    const plain = rate([]);
    const known = rate(['kang_respects_you', 'qonos_upheld']);
    assert.ok(known - plain > 0.15,
      `${(100 * plain).toFixed(1)}% against ${(100 * known).toFixed(1)}% with Kang behind us`);
  });

  test('and one who refused a surrender at Archanis does very much worse', () => {
    // "Finish them" — surrender refused, forty-two lives. The Klingons had this
    // written down about the captain for the whole rest of the campaign and it
    // changed nothing about how they answered a channel.
    const plain = rate([]);
    const butcher = rate(['archanis_massacre', 'fired_first_archanis']);
    assert.ok(plain - butcher > 0.25,
      `${(100 * plain).toFixed(1)}% against ${(100 * butcher).toFixed(1)}% after Archanis`);
  });

  test('and it is the whole record, not the last thing that happened', () => {
    // A captain who did both should land between the two, not on whichever
    // flag was set most recently.
    const both = rate(['kang_respects_you', 'archanis_massacre']);
    const good = rate(['kang_respects_you', 'qonos_upheld']);
    const bad = rate(['archanis_massacre', 'fired_first_archanis']);
    assert.ok(both < good && both > bad,
      `${(100 * both).toFixed(1)}% is not between ${(100 * bad).toFixed(1)}% and ${(100 * good).toFixed(1)}%`);
  });
});

describe('the table is built out of flags the game actually sets', () => {
  test('every flag it names is one an episode writes', () => {
    // The defect this whole run keeps finding, pointed at the fix for it: a
    // memory table naming a flag nothing sets would read as a feature and be
    // as dead as the thing it replaced. There is no typo that survives this.
    const missing = [];
    for (const [faction, entries] of Object.entries(Game.FACTION_MEMORY)) {
      for (const e of entries) {
        if (!WRITTEN.has(e.flag)) missing.push(`${faction}: ${e.flag}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  test('and every faction it names is one that exists and answers a channel', () => {
    for (const [id, entries] of Object.entries(Game.FACTION_MEMORY)) {
      assert.ok(FACTIONS[id], `${id} is not a faction`);
      assert.notEqual(FACTIONS[id].doctrine, 'assimilate',
        `${id} does not answer hails, so a memory of it can never be read`);
      assert.ok(entries.length > 0);
      for (const e of entries) {
        assert.ok(e.line && e.line.length > 10, `${e.flag} has nothing to say`);
        assert.ok(Math.abs(e.weight) > 0 && Math.abs(e.weight) <= 0.4, `${e.flag} weighs ${e.weight}`);
      }
    }
  });

  test('and a flag nobody has means nothing is remembered', () => {
    const g = new Game({ seed: 1n, crewMode: 'original' });
    const m = g.factionMemory('klingon');
    assert.equal(m.weight, 0);
    assert.equal(m.line, null);
    assert.deepEqual(m.reasons, []);
  });

  test('and a flag outside the table moves nothing', () => {
    // Forty-five of the fifty-seven are still not read here, deliberately —
    // `core_tuned` is not a thing the Klingon Empire has an opinion about.
    const g = new Game({ seed: 1n, crewMode: 'original' });
    g.ledger.setFlag('core_tuned');
    g.ledger.setFlag('wolf_scanned');
    assert.equal(g.factionMemory('klingon').weight, 0);
  });

  test('and one faction\'s memory is not another\'s', () => {
    const g = new Game({ seed: 1n, crewMode: 'original' });
    g.ledger.setFlag('archanis_massacre');
    assert.ok(g.factionMemory('klingon').weight < 0);
    assert.equal(g.factionMemory('romulan').weight, 0,
      'the Romulans took the Klingons\' side of a grievance');
    assert.equal(g.factionMemory('ferengi').weight, 0);
  });
});

describe('and it cannot be stacked into a formality', () => {
  test('the whole good record put together is still bounded', () => {
    const g = new Game({ seed: 1n, crewMode: 'original' });
    for (const e of Game.FACTION_MEMORY.klingon) g.ledger.setFlag(e.flag);
    const m = g.factionMemory('klingon');
    assert.ok(Math.abs(m.weight) <= 0.4);
  });

  test('and the pure function clamps it again on its own account', () => {
    // `resolveHail` is exported and takes a context object; a caller that
    // trusted its caller for its bounds would be a hole in it.
    const g = new Game({ seed: 1n, crewMode: 'original' });
    const wild = resolveHail(g.rng, 'negotiate', { factionId: 'klingon', memory: 99 });
    const sane = resolveHail(g.rng, 'negotiate', { factionId: 'klingon', memory: 0.4 });
    assert.ok(wild.outcome);
    assert.ok(sane.outcome);
    // A memory of 99 must not be a different kind of answer from a memory of
    // 0.4 — it must be the same clamped one.
    let both = 0;
    for (let s = 1n; s <= 60n; s++) {
      const a = new Game({ seed: s, crewMode: 'original' });
      const b = new Game({ seed: s, crewMode: 'original' });
      const x = resolveHail(a.rng, 'negotiate', { factionId: 'klingon', memory: 99 });
      const y = resolveHail(b.rng, 'negotiate', { factionId: 'klingon', memory: 0.4 });
      if (x.outcome === y.outcome) both++;
    }
    assert.equal(both, 60, 'an unclamped memory produced a different answer');
  });

  test('and the Borg still do not answer', () => {
    // Their doctrine returns before any of this is reached. A memory table
    // entry for them would read as a feature and never be consulted, which is
    // the exact thing this PR is about.
    assert.equal('borg' in Game.FACTION_MEMORY, false);
    const g = new Game({ seed: 1n, crewMode: 'original' });
    g.startCombat([new Ship('borg_cube', { faction: 'borg', name: 'Cube' })]);
    assert.equal(g.hail('negotiate').outcome, 'ignored');
  });
});

describe('and the bridge says why', () => {
  test('the comms officer names the reason before the reply comes back', () => {
    // "Nothing happened" is the worst answer a bridge can give, and "they
    // refused" without a reason is the second worst.
    const g = new Game({ seed: 3n, crewMode: 'original' });
    g.ledger.setFlag('archanis_massacre');
    g.startCombat([new Ship('d7', { faction: 'klingon', name: 'X' })]);
    const before = g.log.length;
    g.hail('negotiate');
    const said = g.log.slice(before).map((l) => l.text).join(' | ');
    assert.match(said, /Archanis/, `nobody mentioned why: ${said}`);
  });

  test('and says nothing when there is nothing to say', () => {
    const g = new Game({ seed: 3n, crewMode: 'original' });
    g.startCombat([new Ship('d7', { faction: 'klingon', name: 'X' })]);
    const before = g.log.length;
    g.hail('negotiate');
    const said = g.log.slice(before).map((l) => l.text).join(' | ');
    assert.doesNotMatch(said, /remember/i, `the bridge invented a history: ${said}`);
  });
});
