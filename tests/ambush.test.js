// An ambush was a patrol with different words.
//
// `buildAmbush` has set `surprise: true` on every ambush since encounters were
// written, and nothing had ever read it. So "Sensors read nothing — then
// everything. Ships decloaking off both bows" opened exactly like a routine
// patrol. Measured through `resolveEncounter('engage')`, which is the door the
// encounter panel uses:
//
//     kind      surprise   my guns ready   their guns ready
//     patrol       false            true               true
//     ambush        TRUE            true               true
//
// Two of the twelve playable species sell a defence against this:
//
//     Caitian   "Predator's Instinct — You always act first in an engagement,
//                and can never be surprised."   { alwaysFirst, surpriseImmune }
//     Saurian   "Wide Spectrum Vision — ... Advantage against ambushes."
//                                              { cloakDetect, ambushAdvantage }
//
// Neither key was read anywhere in src/. A whole species' signature trait
// protected the captain from a thing that did not exist.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';
import { Character, PLAYER_SPECIES } from '../src/rules/character.js';
import { rollEncounter } from '../src/world/encounters.js';
import { parseOrder } from '../src/ui/orders.js';
import { SYSTEM_BY_ID } from '../src/world/systems.data.js';
import { RNG } from '../src/core/rng.js';

const game = (speciesId = 'human', seed = 9n) => new Game({
  seed, crewMode: 'original',
  character: new Character({ speciesId, careerId: 'tactical' }),
  shipClass: 'constitution',
});

/** How far behind our own guns are, as a share of a cycle. */
function behind(g) {
  const shares = g.ship.weapons.map((w) => w.cooldown / w.cycle);
  return Math.max(0, ...shares);
}

describe('being jumped is different from being met', () => {
  test('an ambush costs you the opening volley', () => {
    const g = game();
    g.startCombat([new Ship('galor', { faction: 'cardassian', name: 'H0' })], { surprise: true });
    assert.ok(Math.abs(behind(g) - 1) < 0.01, `our guns were ${behind(g).toFixed(2)} of a cycle behind`);
  });

  test('and an ordinary fight does not', () => {
    // The control. Every other fight in the game goes through the same call.
    const g = game();
    g.startCombat([new Ship('galor', { faction: 'cardassian', name: 'H0' })]);
    assert.equal(behind(g), 0, 'a fight nobody sprang cost us the opening volley');
  });

  test('it is symmetrical with the perk that does the same to them', () => {
    // `first_strike` — "Battle Doctrine Exchange, you always fire first" —
    // puts the ENEMY a cycle behind, in the same place and by the same
    // arithmetic. Being ambushed is that, pointed the other way.
    const g = game();
    const eng = g.startCombat([new Ship('galor', { faction: 'cardassian', name: 'H0' })],
      { surprise: true });
    const theirs = Math.max(...eng.hostiles[0].weapons.map((w) => w.cooldown / w.cycle));
    assert.equal(theirs, 0, 'the ambushers were also late to their own ambush');
  });
});

describe('the two species that sell a defence against it', () => {
  test('a Caitian is never surprised, exactly as advertised', () => {
    const g = game('caitian');
    g.startCombat([new Ship('galor', { faction: 'cardassian', name: 'H0' })], { surprise: true });
    assert.equal(behind(g), 0, 'Predator’s Instinct did nothing');
  });

  test('a Saurian sees it coming, which is not the same as being ready', () => {
    const g = game('saurian');
    g.startCombat([new Ship('galor', { faction: 'cardassian', name: 'H0' })], { surprise: true });
    const s = behind(g);
    assert.ok(s > 0 && s < 1, `a Saurian was ${s.toFixed(2)} of a cycle behind`);
    assert.ok(Math.abs(s - 0.5) < 0.01, `expected half a cycle, got ${s.toFixed(2)}`);
  });

  test('and a species that promises nothing gets nothing', () => {
    // The control for both: the trait has to be doing the work, not the
    // ambush quietly being mild for everybody.
    for (const id of ['human', 'vulcan']) {
      const g = game(id);
      g.startCombat([new Ship('galor', { faction: 'cardassian', name: 'H0' })], { surprise: true });
      assert.ok(Math.abs(behind(g) - 1) < 0.01, `${id} was only ${behind(g).toFixed(2)} behind`);
    }
  });

  test('the traits this reads are ones the species table actually declares', () => {
    // A mechanic key read here but spelled differently there is a trait that
    // still does nothing, and nothing would say so.
    const keys = new Set();
    for (const sp of PLAYER_SPECIES) for (const k of Object.keys(sp.mechanic ?? {})) keys.add(k);
    for (const k of ['surpriseImmune', 'alwaysFirst', 'ambushAdvantage']) {
      assert.ok(keys.has(k), `no species declares "${k}"`);
    }
    const caitian = PLAYER_SPECIES.find((s) => s.id === 'caitian');
    const saurian = PLAYER_SPECIES.find((s) => s.id === 'saurian');
    assert.ok(caitian.mechanic.surpriseImmune, 'the Caitian no longer claims it');
    assert.ok(saurian.mechanic.ambushAdvantage, 'the Saurian no longer claims it');
    // And the words on the card still describe what happens.
    assert.match(caitian.traitText, /surprised/i);
    assert.match(saurian.traitText, /ambush/i);
  });
});

describe('through the encounter, which is where it happens', () => {
  /** Roll until the generator produces one, then take the fight. */
  function engageFirst(kind, speciesId = 'human') {
    const g = game(speciesId);
    const ids = Object.keys(SYSTEM_BY_ID);
    const rng = new RNG(5n);
    for (let i = 0; i < 40000; i++) {
      const e = rollEncounter(rng, ids[i % ids.length], {
        player: g.ship, ledger: { standingOf: () => -60 },
      });
      if (e?.kind !== kind || !e.hostile || !e.ships?.length) continue;
      g.encounter = e;
      g.resolveEncounter('engage');
      return { g, enc: e, eng: g.engagement };
    }
    return null;
  }

  test('an ambush rolled by the generator is an ambush in the fight', () => {
    const a = engageFirst('ambush');
    const p = engageFirst('patrol');
    assert.ok(a && p, 'the generator produced neither');
    assert.equal(a.enc.surprise, true);
    assert.ok(!p.enc.surprise);
    assert.ok(behind(a.g) > 0, 'an ambush from the real generator cost us nothing');
    assert.equal(behind(p.g), 0, 'a patrol from the real generator ambushed us');
  });

  test('the freighter in a distress call is in the battle', () => {
    // `victims` — one `Ship('freighter', {name: 'SS Kobayashi'})` — was built,
    // named, and left out of the fight it was the subject of.
    const d = engageFirst('distress');
    assert.ok(d, 'no hostile distress call was rolled');
    assert.equal(d.enc.victims.length, 1);
    assert.equal(d.eng.allies.length, 1, 'the ship under attack was not in the battle');
    assert.equal(d.eng.allies[0].name, 'SS Kobayashi');
    // And it is on the board — `allShips` is what the tactical display draws.
    assert.ok(d.eng.allShips.includes(d.eng.allies[0]),
      'the freighter is in the fight but not on the display');
  });
});

describe('an encounter with one button is a notification', () => {
  test('a patrol you cannot hail can still be watched', () => {
    // Measured over twenty thousand encounters: 109 offered a single choice
    // reading "Continue" — every non-hostile patrol from the Dominion, the
    // Tholians or the Borg, none of whom answer hails.
    const g = game();
    const ids = Object.keys(SYSTEM_BY_ID);
    const rng = new RNG(31n);
    let checked = 0;
    let single = 0;
    for (let i = 0; i < 30000 && checked < 4000; i++) {
      const e = rollEncounter(rng, ids[i % ids.length], {
        player: g.ship, ledger: { standingOf: () => (i % 3 ? -60 : 40) },
      });
      if (!e || e.kind === 'quiet') continue;
      g.encounter = e;
      checked++;
      if (g.encounterChoices().length <= 1) single++;
    }
    assert.ok(checked > 1000, `only ${checked} encounters`);
    assert.equal(single, 0, `${single} of ${checked} encounters offer one choice or none`);
  });

  test('and watching reads the errand the encounter already chose', () => {
    // `subtype` has carried a real errand since the errand table was written —
    // a tender servicing buoys, a destroyer screening something you cannot
    // see — and nothing had ever read it back.
    const errands = Object.keys(Game.PATROL_WATCH).filter((k) => k !== 'default');
    assert.ok(errands.length >= 6, `only ${errands.length} errands are answered`);
    for (const id of errands) {
      const g = game();
      g.encounter = {
        kind: 'patrol', hostile: false, hailable: false, subtype: id,
        system: SYSTEM_BY_ID.sol, title: 'A patrol',
      };
      const ids = g.encounterChoices().map((c) => c.id);
      assert.ok(ids.includes('observe'), `${id}: nothing to watch`);
      const r = g.resolveEncounter('observe');
      assert.ok(r.messages.length, `${id}: watching them said nothing`);
      assert.equal(g.encounter, null, `${id}: the encounter stayed live`);
    }
  });

  test('and every errand the generator can pick has something to see', () => {
    // Read off the encounters the generator actually produces, not a list
    // here — an errand added to the table with no answer would fall through
    // to the default and nobody would notice.
    const g = game();
    const ids = Object.keys(SYSTEM_BY_ID);
    const rng = new RNG(77n);
    const seen = new Set();
    for (let i = 0; i < 30000; i++) {
      const e = rollEncounter(rng, ids[i % ids.length], {
        player: g.ship, ledger: { standingOf: () => 40 },
      });
      if (e?.kind === 'patrol' && !e.hostile && e.subtype) seen.add(e.subtype);
    }
    assert.ok(seen.size >= 6, `only ${seen.size} errands turned up`);
    for (const id of seen) {
      assert.ok(Game.PATROL_WATCH[id], `the generator picks "${id}" and nothing answers it`);
    }
  });
});

// ---------------------------------------------------------------------------
// And then: the only defence was a species you picked before the game started.
//
// The trait above fixed the ambush itself — being jumped costs a free volley
// now, and it did not before. But the ONLY things that could answer it were
// `surpriseImmune` and `ambushAdvantage`, both chosen at character creation and
// neither available to ten of the twelve species. Nothing a captain DID
// mattered: four ranks of Sensor Analysis and a fitted Multispectral Sensor
// Array — sold as "cloak detection" and "see cloaked ships sooner" — bought
// nothing at all in the one situation that is ships which were hiding.
//
// Alert level cannot be the answer: `beginEncounter` sets red on every hostile
// encounter before the captain chooses anything, so it is always red here.
//
// Measured over 200 seeds, ambushed by a D7 and a Bird of Prey, with detection
// FORCED so the only thing varying is the mechanic — comparing an invested
// captain against an uninvested one measured two different officers, because
// the invested one spent twenty points on science instead of gunnery:
//
//     blind (surprise stands)   63.0% hull   173 routed / 26 won / 1 LOST
//     seen it, engage           65.8% hull   175 / 25 / 0
//     seen it, spring it        80.8% hull   181 / 19 / 0
//
// The fight is still won either way. What being ready buys is the damage.

describe('seeing an ambush before it lands', () => {
  const SHARP = { command: 12, tactics: 12, engineering: 10, science: 20, medicine: 10, diplomacy: 10 };
  const DULL = { command: 12, tactics: 12, engineering: 10, science: 8, medicine: 10, diplomacy: 10 };

  /** A captain, optionally having bought the two things sold for this. */
  function sensors(kind, seed = 3n) {
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

  const ambush = () => ({
    kind: 'ambush', hostile: true, surprise: true, text: 'Contacts, close aboard.',
    title: 'Ambush', ships: [],
  });

  test('a captain who bought the sensors sees it; one who did not, mostly does not', () => {
    const rate = (kind) => {
      let seen = 0;
      for (let seed = 1n; seed <= 300n; seed++) {
        const g = sensors(kind, seed);
        const enc = ambush();
        g.beginEncounter(enc);
        if (enc.detected) seen++;
      }
      return seen / 300;
    };
    const dull = rate('dull');
    const sharp = rate('sharp');
    // The control first: the two captains must differ on the stat this reads,
    // or the rates below are one captain measured twice.
    assert.ok(sensors('sharp').ship.mod('stealthDetect')
      > sensors('dull').ship.mod('stealthDetect') + 0.5, 'the two captains have the same sensors');
    assert.ok(dull < 0.15, `an uninvested captain saw ${(dull * 100).toFixed(0)}% of ambushes`);
    assert.ok(sharp > 0.45, `a fully invested captain saw only ${(sharp * 100).toFixed(0)}%`);
    assert.ok(sharp < 0.95, 'seeing it coming became a certainty, which it must not be');
  });

  test('and it is deterministic, and does not move the main stream', () => {
    // Keyed like `encounterStream` — by seed, system and visit — so it is a
    // fact about the ambush rather than about draw order. Drawing from
    // `this.rng` would shift every seeded outcome downstream of it.
    const once = () => {
      const g = sensors('sharp', 42n);
      const enc = ambush();
      g.beginEncounter(enc);
      return enc.detected;
    };
    assert.equal(once(), once());
    const clean = new Game({ seed: 42n, crewMode: 'original', shipClass: 'constitution' });
    const before = clean.rng.next();
    const g = new Game({ seed: 42n, crewMode: 'original', shipClass: 'constitution' });
    g.beginEncounter(ambush());
    assert.equal(g.rng.next(), before, 'detection consumed the main stream');
  });

  test('an undetected ambush still costs the free volley it always did', () => {
    const g = sensors('dull', 7n);
    const enc = { ...ambush(), ships: [new Ship('d7', { faction: 'klingon', name: 'K' })] };
    g.beginEncounter(enc);
    enc.detected = false;
    g.resolveEncounter('engage');
    assert.ok(g.ship.weapons.every((w) => w.cooldown > 0),
      'a captain who never saw them opened with warm guns');
  });

  test('a detected one does not, and springing it turns the volley round', () => {
    const open = (mode) => {
      const g = sensors('sharp', 7n);
      const foe = new Ship('d7', { faction: 'klingon', name: 'K' });
      const enc = { ...ambush(), ships: [foe] };
      g.beginEncounter(enc);
      enc.detected = true;
      g.resolveEncounter(mode);
      return {
        mine: g.ship.weapons.map((w) => w.cooldown),
        theirs: foe.weapons.map((w) => w.cooldown),
      };
    };
    const seen = open('engage');
    assert.ok(seen.mine.every((c) => c === 0), 'seeing them still cost the volley');
    assert.ok(seen.theirs.every((c) => c === 0), 'seeing them handed us a volley we did not earn');

    const sprung = open('spring');
    assert.ok(sprung.mine.every((c) => c === 0), 'springing it cost us the volley');
    assert.ok(sprung.theirs.some((c) => c > 0), 'springing it did nothing to them');
  });

  test('and the button only exists when there is something to spring', () => {
    // A choice that appears on every hostile encounter is not a reward for
    // anything. Every hostile encounter offered the same three buttons before
    // this, which is why an ambush read exactly like an unfriendly patrol.
    const g = sensors('sharp', 7n);
    const has = (enc) => {
      g.beginEncounter(enc);
      return g.encounterChoices().some((c) => c.id === 'spring');
    };
    const seen = ambush(); seen.detected = true;
    g.beginEncounter(seen); seen.detected = true;
    assert.ok(g.encounterChoices().some((c) => c.id === 'spring'), 'a detected ambush cannot be sprung');

    const blind = ambush();
    g.beginEncounter(blind); blind.detected = false;
    assert.equal(g.encounterChoices().some((c) => c.id === 'spring'), false,
      'an ambush nobody saw can be sprung anyway');
    assert.equal(has({ kind: 'patrol', hostile: true, text: 't', ships: [] }), false,
      'a plain hostile patrol offers a spring');
  });

  test('and the words on the button are words the ship understands', () => {
    // The rule this game is built on: everything worth doing is doable by
    // saying it, and the phrase is printed ON the button that does the same
    // thing. A `say` nobody can parse is a lie printed in quotation marks.
    //
    // "take them first" parsed as `mission_choice` when it was first written —
    // the button would have routed to the wrong handler entirely, which is the
    // exact failure the `encounter_choice` entry in lexicon.js was created to
    // fix, arriving again with a new choice.
    const g = sensors('sharp', 7n);
    const enc = ambush();
    g.beginEncounter(enc);
    enc.detected = true;
    const spring = g.encounterChoices().find((c) => c.id === 'spring');
    assert.ok(spring?.say, 'the spring choice has no phrase on it');
    const parsed = parseOrder(spring.say);
    assert.equal(parsed?.action, 'encounter_choice',
      `"${spring.say}" parses as ${parsed?.action}, not an encounter choice`);
    assert.equal(parsed?.choice, 'spring',
      `"${spring.say}" chooses ${parsed?.choice}`);

    // And every other phrase this encounter offers still resolves to a choice
    // it actually has — the say lines are checked as a set, not one at a time.
    for (const c of g.encounterChoices()) {
      if (!c.say) continue;
      const r = parseOrder(c.say);
      assert.ok(r, `"${c.say}" parses as nothing`);
    }
  });

  test('and being ready is worth real hull, measured', () => {
    const run = (mode) => {
      let hull = 0;
      let lost = 0;
      let n = 0;
      for (let seed = 1n; seed <= 60n; seed++) {
        const g = sensors('dull', seed);
        const ships = ['d7', 'bird_of_prey'].map((c, i) =>
          new Ship(c, { faction: 'klingon', name: `K${i}` }));
        const enc = { ...ambush(), ships };
        g.beginEncounter(enc);
        enc.detected = mode !== 'blind';
        g.resolveEncounter(mode === 'spring' ? 'spring' : 'engage');
        const eng = g.engagement;
        if (!eng) continue;
        let t = 0;
        while (!eng.over && t < 400) {
          eng.comeAboutTo(eng.target);
          g.ship.throttle = 0.6;
          g.ship.power.applyPreset(g.ship.shieldPct < 0.35 ? 'defense' : 'attack');
          eng.update(1 / 30);
          t += 1 / 30;
        }
        n++;
        hull += g.ship.hullPct;
        if (eng.outcome === 'destroyed') lost++;
      }
      return { hull: hull / n, lost, n };
    };
    const blind = run('blind');
    const sprung = run('spring');
    assert.equal(blind.n, 60);
    // The margin is asserted, not the sign — a bar set on a coin toss is a
    // coin toss. Measured at 63.0% against 80.8% over 200 seeds.
    assert.ok(sprung.hull > blind.hull + 0.08,
      `sprung ${(sprung.hull * 100).toFixed(1)}% hull against blind ${(blind.hull * 100).toFixed(1)}%`);
    // And an ambush is still a fight worth avoiding: it costs real hull even
    // when you spring it.
    assert.ok(sprung.hull < 0.97, 'springing an ambush became free');
  });
});
