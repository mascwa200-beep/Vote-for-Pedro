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
