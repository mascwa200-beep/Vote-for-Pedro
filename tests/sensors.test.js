// A console slot, four skill points, and a science officer, all spent on
// nothing.
//
// `stealthDetect` was written by five things and read by none:
//
//     ship.js:314        the baseline                                     1
//     skills.js:58       "Sensor Analysis — cloak detection and scan
//                         quality", a science node, four ranks          +0.15/rank
//     loadout.js:37      "Multispectral Sensor Array — see cloaked ships
//                         sooner", tier two, two slot value              +0.4
//     character.js:547   the captain's Science ability                   +6%/point
//     state.js:1539      a watch officer's expertise                     +10%
//
// Nothing anywhere called `mod('stealthDetect')`. Measured over forty
// sixty-second runs against a Bird of Prey held cloaked throughout:
//
//     stealthDetect 1.150   mean damage onto a cloaked target   1714
//     stealthDetect 2.912   mean damage onto a cloaked target   1714
//
// Exactly 1714 both ways, and two of the five contributors are things the
// player pays for with a limited resource.
//
// The 2.912 was 2.080 in a first draft of this file, because the harness
// fitted the console with `loadout.fit('science', 'sensor_array')` — a method
// that does not exist, optional-chained into nothing, so the console was never
// aboard and the figure was skills and Science only. The API is `equip`. That
// is the sixth time this run a probe has invented one, and this one would have
// understated the very thing the file is about.
//
// I put the fifth of those five there myself, wiring the con, by copying the
// shape of the captain's contribution without checking that anything read it.
// Same defect as the write-only flags, committed while writing the PRs about
// them.
//
// The console was worse: it declares `special: 'scan'` as well, and scan
// quality was built from `progress.scanBonus` (the skill tree) plus
// `sensorQuality` (the subsystem times its power). A fitted array reached
// neither. BOTH of its effects were dead.

import { test, describe } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';
import { Ship } from '../src/sim/ship.js';
import { SKILLS } from '../src/sim/skills.js';
import { CONSOLES } from '../src/sim/loadout.js';

const SHARP = { command: 12, tactics: 12, engineering: 10, science: 20, medicine: 10, diplomacy: 10 };
const DULL = { command: 12, tactics: 12, engineering: 10, science: 8, medicine: 10, diplomacy: 10 };

/** A captain, optionally having bought the two things sold for this. */
function captain(kind, seed = 3n) {
  const g = new Game({
    seed,
    crewMode: 'original',
    shipClass: 'constitution',
    character: new Character({
      speciesId: 'human', careerId: 'science',
      baseScores: kind === 'sharp' ? SHARP : DULL,
    }),
  });
  if (kind === 'sharp') {
    g.progress.unspent = 20;
    for (let i = 0; i < 4; i++) g.progress.spend?.('sensors');
    g.loadout.acquire('sensor_array');
    g.loadout.equip('sensor_array');
    g.applyAllMods();
  }
  return g;
}

/** Sixty seconds of shooting at a ship that stays cloaked. Damage landed. */
function damageOntoCloaked(kind, seeds = 40n) {
  let dealt = 0;
  for (let seed = 1n; seed <= seeds; seed++) {
    const g = captain(kind, seed);
    const foe = new Ship('bird_of_prey', { faction: 'klingon', name: 'K' });
    const eng = g.startCombat([foe], { relentless: true });
    foe.hull = foe.maxHull;
    for (const f of Object.keys(foe.shields)) foe.shields[f] = 0;
    const start = foe.hull;
    for (let i = 0; i < 30 * 60 && !eng.over; i++) {
      foe.cloaked = true;
      eng.comeAboutTo(foe);
      g.ship.throttle = 0.4;
      eng.update(1 / 30);
    }
    dealt += Math.max(0, start - foe.hull);
  }
  return Math.round(dealt / Number(seeds));
}

describe('the things sold for seeing through a cloak', () => {
  test('the cards say what they are for', () => {
    // Asserted against the tables, so the claim this file makes about what the
    // player was sold cannot drift away from what is actually on sale.
    assert.match(SKILLS.sensors.description, /cloak detection/i);
    assert.equal(SKILLS.sensors.mods.stealthDetect, 0.15);
    assert.match(CONSOLES.sensor_array.description, /cloaked/i);
    assert.equal(CONSOLES.sensor_array.mods.stealthDetect, 0.4);
    assert.ok(CONSOLES.sensor_array.value >= 2, 'the array is not a costly fitting');
  });

  test('and buying them moves the number they move', () => {
    // The control for everything below: if the contributors ever stop
    // stacking, the measurement is comparing two identical captains.
    const dull = captain('dull').ship.mod('stealthDetect');
    const sharp = captain('sharp').ship.mod('stealthDetect');
    assert.ok(sharp > dull + 0.5, `${dull} against ${sharp}`);
  });

  test('and it is worth something against a ship that is actually cloaked', () => {
    const dull = damageOntoCloaked('dull');
    const sharp = damageOntoCloaked('sharp');
    assert.ok(sharp > dull * 1.1,
      `${dull} damage against ${sharp} over forty sixty-second runs`);
  });

  test('and a cloak is never worth more than the flat half it always was', () => {
    // Floored at 1. This is a discount on the enemy's advantage, not a new
    // axis — nothing may make a cloaked ship HARDER to hit than it has been
    // since the flat 0.5 was tuned.
    const g = captain('dull');
    g.ship.mods.stealthDetect = 0.2;
    assert.ok(g.ship.mod('stealthDetect') < 1);
    // Reach the same expression the gunnery uses, through a real shot.
    const foe = new Ship('bird_of_prey', { faction: 'klingon', name: 'K' });
    const eng = g.startCombat([foe], { relentless: true });
    foe.cloaked = true;
    let hits = 0;
    for (let i = 0; i < 30 * 40 && !eng.over; i++) {
      const before = foe.hull;
      eng.comeAboutTo(foe);
      g.ship.throttle = 0.4;
      eng.update(1 / 30);
      if (foe.hull < before) hits++;
    }
    assert.ok(hits >= 0, 'the fight ran');
    assert.ok(g.ship.mod('stealthDetect') < 1, 'the probe changed the thing it was measuring');
  });

  test('and a captain who bought nothing fights the same battle as before', () => {
    // The balance control, and the one that decides whether this may ship.
    // Measured against the heavy cloaking classes — warbird, vorcha, neghvar —
    // because Birds of Prey are won 90 times in 90 either way and cannot tell
    // the two apart. 24 of 90 before this change and 24 of 90 after it.
    let won = 0;
    let n = 0;
    for (const [me, them] of [
      ['constitution', ['warbird', 'warbird']],
      ['miranda', ['vorcha']],
      ['excelsior', ['neghvar', 'warbird']],
    ]) {
      for (let seed = 1n; seed <= 30n; seed++) {
        const g = new Game({ seed, crewMode: 'original', shipClass: me });
        const eng = g.startCombat(
          them.map((c, i) => new Ship(c, { faction: 'klingon', name: `K${i}` })),
          { relentless: true });
        let t = 0;
        while (!eng.over && t < 400) {
          eng.comeAboutTo(eng.target);
          g.ship.throttle = 0.6;
          g.ship.power.applyPreset(g.ship.shieldPct < 0.35 ? 'defense' : 'attack');
          eng.update(1 / 30);
          t += 1 / 30;
        }
        n++;
        if (eng.outcome === 'victory') won++;
      }
    }
    assert.equal(n, 90);
    assert.ok(Math.abs(won - 24) <= 5, `${won} of 90 won, against 24 before the change`);
  });
});

describe('and the array does the other thing it says too', () => {
  test('a fitted sensor array improves scan quality', () => {
    // `special: 'scan'`, declared on the console and read by nothing. Scan
    // quality was `progress.scanBonus` — which comes from the SKILL tree — plus
    // `sensorQuality`, which is the subsystem times its power. A fitted array
    // reached neither of them.
    const plain = captain('dull');
    const fitted = captain('dull');
    fitted.loadout.acquire('sensor_array');
    fitted.loadout.equip('sensor_array');
    assert.ok(fitted.loadout.special('scan') > 0, 'the array was not fitted, so this proves nothing');
    assert.ok(fitted.scanQuality > plain.scanQuality,
      `scan quality ${plain.scanQuality} against ${fitted.scanQuality}`);
  });

  test('and the skill node still reaches it, in the same units', () => {
    // One place that says what scan quality is made of, so the two sources
    // cannot drift onto two scales that merely happen to be added together.
    const g = captain('dull');
    const before = g.scanQuality;
    g.progress.unspent = 10;
    g.progress.spend?.('sensors');
    assert.ok(g.scanQuality > before, 'a rank in Sensor Analysis changed nothing');
    // A two-value console is worth two ranks of the node.
    const perRank = g.scanQuality - before;
    const fitted = captain('dull');
    fitted.loadout.acquire('sensor_array');
    fitted.loadout.equip('sensor_array');
    const perConsole = fitted.scanQuality - captain('dull').scanQuality;
    assert.ok(Math.abs(perConsole - perRank * CONSOLES.sensor_array.value) < 1e-9,
      `a rank is worth ${perRank} and the array ${perConsole}`);
  });
});

describe('and nothing else the ship carries is written and never read', () => {
  test('every modifier the ship stores is consumed somewhere', () => {
    // The sweep that found this one. `stealthDetect` was the single key the
    // ship stored, four systems contributed to, and no code ever asked for.
    const base = new Ship('constitution', { faction: 'federation', name: 'T' });
    const stored = Object.keys(base.mods);
    assert.ok(stored.length >= 18, `${stored.length} modifiers`);

    const files = [];
    (function walk(dir) {
      for (const e of readdirSync(dir)) {
        const p = `${dir}/${e}`;
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.js')) files.push(p);
      }
    })('src');
    const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');

    const unread = stored.filter((k) => !new RegExp(`mod\\(['"]${k}['"]\\)`).test(all));
    assert.deepEqual(unread, [], 'modifiers the ship carries and nothing ever asks for');
  });
});
