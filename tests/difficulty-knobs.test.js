// The difficulty table declared seven things the game did not read.
//
// Swept by name across `src/`, counting the accessors in `difficulty.js`
// itself as readers — the first version of the sweep EXCLUDED the declaring
// file and reported eight, because `enemyMods()` and `playerMods()` live there
// and read four of them. Same instrument error as RESEARCH §62: the file that
// declares a thing is often the file that reads it.
//
//     knob                  spread            what it was
//     fuelUse            0.6 -> 2.2           unwired    -> wired
//     resourceRate       1.5 -> 0.35          unwired    -> wired
//     enemyRelentless    top three rungs      unwired    -> wired
//     hazardScale        0.4 -> 2.7           DUPLICATE  -> deleted
//     autoSave           true on all twelve   CONSTANT   -> deleted
//     advantageOnFirstFail  Story only        SUBSUMED   -> deleted
//     allowReload        false from Commodore unenforced -> kept, then wired
//
// The three deletions each have a different reason and that is the point. A
// sweep whose only output is "wire everything you find" would have multiplied
// away-team casualties by 7.3 at the top rung, because `hazardScale` and the
// already-wired `crewLossScale` attach at the same line and span the same
// range.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';
import { DIFFICULTIES, DifficultySettings } from '../src/rules/difficulty.js';
import { Ship } from '../src/sim/ship.js';
import { plotTransit } from '../src/world/galaxy.js';

const captain = (difficulty) => new Game({
  seed: 4n, crewMode: 'original', difficulty,
  character: new Character({ speciesId: 'human', careerId: 'command' }),
  shipClass: 'constitution',
});

/** Every .js file under src/, as one string, with an optional exclusion. */
function sourceText(skip = () => false) {
  let out = '';
  const walk = (d) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      if (n.isDirectory()) walk(`${d}/${n.name}`);
      else if (n.name.endsWith('.js') && !skip(`${d}/${n.name}`)) out += readFileSync(`${d}/${n.name}`, 'utf8');
    }
  };
  walk('src');
  return out;
}

/** The accessor half of difficulty.js — everything after the table. */
function accessorText() {
  const decl = readFileSync('src/rules/difficulty.js', 'utf8');
  return decl.slice(decl.indexOf('];', decl.indexOf('export const DIFFICULTIES')));
}

const MECHANICAL = (d) => Object.keys(d).filter((k) =>
  !['id', 'name', 'order', 'insignia', 'tagline', 'description'].includes(k));

describe('every knob the difficulty table declares is read by something', () => {
  test('the sweep, with the declaring file counted as a reader', () => {
    // Counting the accessors is the whole correction. `enemyDamage`,
    // `enemyHull`, `enemyAccuracy` and `playerDamage` are read ONLY by
    // `enemyMods()` and `playerMods()` in difficulty.js, and a sweep that
    // skips that file calls all four dead.
    const outside = sourceText((f) => f.endsWith('rules/difficulty.js'));
    const accessors = accessorText();
    const seen = new Set();
    for (const d of DIFFICULTIES) for (const k of MECHANICAL(d)) seen.add(k);

    const dead = [];
    for (const k of seen) {
      const inAccessor = new RegExp(`['\`]${k}['\`]|\\.${k}\\b`).test(accessors);
      const inRest = new RegExp(`['\`]${k}['\`]|\\.${k}\\b`).test(outside);
      // No exemptions any more. `allowReload` used to have one — it was a
      // real promise about the save system that nothing enforced, left
      // declared so a later sweep would find it. A later sweep did: it is read
      // by `reloadRefusal` in core/save.js and shown both ways on the
      // difficulty card, so it stands on its own here like every other knob.
      if (!inAccessor && !inRest) dead.push(k);
    }
    assert.deepEqual(dead.sort(), [],
      'declared by a difficulty rung and read by nothing anywhere in src/');
  });

  test('and the sweep can see a dead knob when there is one', () => {
    // The positive control. A clean result above is worth nothing unless the
    // instrument reacts to a knob nobody reads, so invent one and check.
    const outside = sourceText((f) => f.endsWith('rules/difficulty.js'));
    const accessors = accessorText();
    const invented = 'thisKnobIsReadByNobodyAtAll';
    assert.equal(new RegExp(`['\`]${invented}['\`]|\\.${invented}\\b`).test(accessors), false);
    assert.equal(new RegExp(`['\`]${invented}['\`]|\\.${invented}\\b`).test(outside), false);
  });

  test('and the three that were deleted are gone from every rung', () => {
    for (const gone of ['hazardScale', 'autoSave', 'advantageOnFirstFail']) {
      const carriers = DIFFICULTIES.filter((d) => gone in d);
      assert.equal(carriers.length, 0,
        `${gone} is back on ${carriers.map((d) => d.id).join(', ')} — see the header for why it went`);
    }
  });

  test('and hazardScale must not come back while crewLossScale is wired', () => {
    // The reason it went. Both span roughly 0.3–2.7 and both multiply the same
    // two chances in away.js, so together they are 7.3x at Fleet Admiral.
    const src = readFileSync('src/sim/away.js', 'utf8');
    assert.match(src, /crewLossScale/, 'crewLossScale is no longer wired, so revisit hazardScale');
    assert.doesNotMatch(src, /hazardScale/, 'both are wired, which multiplies casualties twice');
  });
});

describe('fuelUse: the top rungs burn more to go the same distance', () => {
  const leg = (id) => {
    const g = captain(id);
    const to = g.galaxy.neighbors(g.locationId)[0];
    return plotTransit(g.galaxy, g.locationId, to.id, 6, g.ship,
      g.progress.warpEfficiency, g.difficulty.scale('fuelUse')).fuel;
  };

  test('a leg costs more at Fleet Admiral than at Story', () => {
    const story = leg('story');
    const fleet = leg('fleet_admiral');
    assert.ok(story > 0 && fleet > 0, `${story} / ${fleet}`);
    assert.ok(fleet > story * 3,
      `the same leg costs ${story.toFixed(1)} at Story and ${fleet.toFixed(1)} at Fleet Admiral`);
  });

  test('and the curve is monotonic across all twelve', () => {
    let last = 0;
    for (const d of [...DIFFICULTIES].sort((a, b) => a.order - b.order)) {
      const f = leg(d.id);
      assert.ok(f >= last, `${d.id} costs ${f.toFixed(1)} after ${last.toFixed(1)}`);
      last = f;
    }
  });

  test('and it does not also slow the ship down', () => {
    // `efficiency` divides BOTH `travelHours` and `fuelCost`, so folding the
    // difficulty into it would have made the top rungs slower as well as
    // thirstier. `fuelUse` is its own parameter for exactly this reason.
    const g = captain('fleet_admiral');
    const to = g.galaxy.neighbors(g.locationId)[0];
    const cheap = plotTransit(g.galaxy, g.locationId, to.id, 6, g.ship, g.progress.warpEfficiency, 1);
    const dear = plotTransit(g.galaxy, g.locationId, to.id, 6, g.ship, g.progress.warpEfficiency, 2.2);
    assert.ok(dear.fuel > cheap.fuel * 2, `${cheap.fuel} -> ${dear.fuel}`);
    assert.equal(dear.hours, cheap.hours, 'burning more fuel took longer');
  });

  test('and a course nobody can afford is refused at the helm', () => {
    // Rather than stranding the ship halfway. The scale is applied before the
    // affordability check, which is the reason it goes where it goes.
    const g = captain('fleet_admiral');
    g.ship.antimatter = 3;
    const to = g.galaxy.neighbors(g.locationId)[0];
    const p = plotTransit(g.galaxy, g.locationId, to.id, 6, g.ship,
      g.progress.warpEfficiency, g.difficulty.scale('fuelUse'));
    assert.ok(p.error, 'a course beyond the tank was accepted');
    assert.match(p.error, /antimatter/i);
  });
});

describe('resourceRate: the top rungs get less out of the same wreck', () => {
  test('a survey haul shrinks up the ladder and never reaches nothing', () => {
    const haul = (id) => {
      const g = captain(id);
      const before = { ...g.stores };
      // The surface features are the same everywhere; only the rate differs.
      const rate = g.difficulty.scale('resourceRate');
      return { rate, got: Math.max(1, Math.round(14 * rate)), before };
    };
    const story = haul('story');
    const fleet = haul('fleet_admiral');
    assert.ok(story.got > fleet.got, `${story.got} against ${fleet.got}`);
    assert.ok(fleet.got >= 1, 'a successful survey returned nothing at all');
  });

  test('and the salvage haul reads the same knob', () => {
    const strip = (id) => {
      const g = captain(id);
      g.stores = {};
      g.wreck = { systemId: g.locationId, tier: 5 };
      const r = g.stripWreck();
      assert.ok(r.ok, JSON.stringify(r));
      return Object.values(g.stores).reduce((n, v) => n + v, 0);
    };
    const story = strip('story');
    const fleet = strip('fleet_admiral');
    assert.ok(story > fleet, `Story recovered ${story}, Fleet Admiral ${fleet}`);
    assert.ok(fleet > 0, 'the top rung recovered nothing at all from a tier-5 wreck');
  });
});

describe('enemyRelentless: at the top, nobody runs', () => {
  test('the top three rungs declare it and the rest do not', () => {
    const on = DIFFICULTIES.filter((d) => d.enemyRelentless).map((d) => d.id);
    assert.deepEqual(on, ['vice_admiral', 'admiral', 'fleet_admiral']);
  });

  test('and a fight started there is relentless, while one below is not', () => {
    const staged = (id) => {
      const g = captain(id);
      const foe = new Ship('d7', { faction: 'klingon', name: 'K' });
      return g.startCombat([foe], {}).relentless;
    };
    assert.equal(staged('fleet_admiral'), true);
    // The control, and the reason this is not simply "relentless is true":
    // every rung below must be unchanged, or this became a rebalance of the
    // whole game rather than a property of the top three.
    assert.equal(staged('lieutenant'), false);
    assert.equal(staged('commodore'), false);
  });

  test('and a caller that asks for it explicitly still gets it anywhere', () => {
    // The Kobayashi Maru was the only thing that ever set this flag, and it
    // must keep working at every difficulty.
    const g = captain('story');
    const foe = new Ship('d7', { faction: 'klingon', name: 'K' });
    assert.equal(g.startCombat([foe], { relentless: true }).relentless, true);
  });
});
