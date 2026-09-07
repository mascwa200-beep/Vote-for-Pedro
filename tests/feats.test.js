// Six of the twelve feats did nothing at all.
//
// A feat costs a promotion. There are twelve, and this is what they were,
// measured on `origin/main` through the game's own entry points:
//
//     ability_score        raises scores                    works
//     xenobiologist        advantageOn                      works
//     polymath             extraProficiencies               works
//     tactical_genius      critSeverity hard-coded beside    half
//                          the table; critRange dead
//     master_engineer      instantPower hard-coded;          half
//                          coreRecovery dead
//     legend               repGain read; enemyHesitation     half
//                          dead
//     diplomatic_immunity  universalPassage                 NOTHING
//     fleet_tactician      allyCommand                      NOTHING
//     inspiring            officerCooldown, noObjection     NOTHING
//     survivor             deathSave                        NOTHING
//     unshakeable          autoSave                         NOTHING
//     improviser           noUntrainedPenalty               NOTHING
//
// The four gated systems in the galaxy, with a Diplomatic Immunity captain
// standing in each of them: `canDock()` false, false, false, false — and the
// helm still read out the warning that they would not open a berth. Two feats
// in a row, `master_engineer` and `inspiring`, produced byte-identical results
// with and without them.
//
// The last two are left alone deliberately and RESEARCH.md §42 says why: they
// are phrased against `rules/dice.js`'s saving throw and an untrained penalty,
// and the game has neither. Guessing at what they ought to mean is how a
// project comes to do something other than what its cards say.
//
// One thing found on the way, which had to be fixed before "officers never
// object" could mean anything: an officer's objection was computed on every
// ability, put on the result object — and then spoken as
// `a.say ?? officer.acknowledge(reaction)`. All twenty-six abilities carry a
// `say`. The right-hand side had never once evaluated.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Character, FEAT_BY_ID } from '../src/rules/character.js';
import { Ship } from '../src/sim/ship.js';
import { ABILITIES } from '../src/sim/officers.js';
import { applyAbility } from '../src/sim/powers.js';
import { SYSTEMS } from '../src/world/systems.data.js';

/** A captain with the named feats and nothing else unusual about them. */
const game = (feats = [], { seed = 3n, scores = null, shipClass = 'constitution' } = {}) => new Game({
  seed,
  crewMode: 'original',
  shipClass,
  character: new Character({
    speciesId: 'human',
    careerId: 'command',
    feats,
    ...(scores ? { baseScores: scores } : {}),
  }),
});

const GATED = SYSTEMS.filter((s) => s.requiresStanding);

describe('Diplomatic Immunity — enter any home system regardless of standing', () => {
  test('there are gated systems, and a captain of no standing is shut out of them', () => {
    // The control, and it has to come first: if the galaxy ever stops gating
    // anything, every assertion below passes while proving nothing.
    assert.ok(GATED.length >= 4, `${GATED.length} systems ask for standing`);
    const g = game();
    for (const sys of GATED) {
      g.locationId = sys.id;
      assert.equal(g.canDock(), false, `${sys.id} berthed a captain of no standing`);
    }
  });

  test('and the feat opens the ones that have a berth to open', () => {
    const g = game(['diplomatic_immunity']);
    const opened = [];
    for (const sys of GATED) {
      g.locationId = sys.id;
      if (g.canDock()) opened.push(sys.id);
    }
    assert.deepEqual(opened.sort(), ['cardassia_prime', 'qonos', 'romulus']);
    // Founders' Homeworld is the fourth, and it stays shut for a reason that
    // is not standing: it has no dock in its facilities at all. The feat says
    // "regardless of standing", so it lifts the standing gate and leaves the
    // absence of a berth exactly where it was.
    const founders = SYSTEMS.find((s) => s.id === 'gamma_2');
    assert.ok(!founders.facilities?.includes('dock'));
  });

  test('and the warning stops being given about a door that is open', () => {
    // Both halves, or a captain is warned off a berth and then given it. They
    // were the same expression written out twice in two methods, which is how
    // that happens.
    const plain = game();
    const dip = game(['diplomatic_immunity']);
    for (const id of ['qonos', 'romulus', 'cardassia_prime']) {
      const sys = plain.galaxy.get(id);
      assert.match(String(plain.crossingWarningFor(sys)), /will not open a berth/);
      assert.doesNotMatch(String(dip.crossingWarningFor(sys)), /will not open a berth/);
    }
  });

  test('and it is standing it lifts, not the Neutral Zone', () => {
    // The discipline the note on PASSAGE_PERKS already sets: a treaty line
    // closes on a captain in perfect standing exactly as hard as on one in
    // disgrace, so "regardless of standing" cannot be what opens it.
    const dip = game(['diplomatic_immunity']);
    const zone = SYSTEMS.find((s) => Game.insideTheZone(s) && !s.requiresStanding);
    assert.ok(zone, 'nothing is inside the Neutral Zone');
    assert.match(String(dip.crossingWarningFor(dip.galaxy.get(zone.id))), /Neutral Zone/);
  });
});

describe('Tactical Genius — critical hits on a natural 19 or 20', () => {
  test('the crit range is read off the feat rather than printed on it', () => {
    // A ship starts at 0.05: one twentieth, which is a natural 20. Nineteen is
    // two twentieths. The number in the FEATS table is what does the work.
    const plain = game().character.shipMods();
    const genius = game(['tactical_genius']).character.shipMods();
    assert.ok(Math.abs((genius.critChance - plain.critChance) - 0.05) < 1e-9,
      `crit chance moved by ${genius.critChance - plain.critChance}`);
  });

  test('and the severity is the one the card promises, not a copy of it', () => {
    // This used to be `bump('critSeverity', 0.1)` beside a feat that declared
    // 0.1, so the card and the ship could disagree forever without a test
    // noticing. Asserted against the table.
    const declared = FEAT_BY_ID.tactical_genius.mechanic.critSeverity;
    assert.equal(game(['tactical_genius']).character.shipMods().critSeverity, declared);
    assert.equal(game().character.shipMods().critSeverity, undefined);
  });

  test('and it reaches the ship the captain is standing on', () => {
    // shipMods is applied by `applyCharacter`; the measurement that matters is
    // what the gunnery actually reads.
    assert.ok(game(['tactical_genius']).ship.mod('critChance')
      - game().ship.mod('critChance') > 0.049);
  });
});

describe('Master Engineer — the core can be ejected and later recovered', () => {
  const breached = (feats) => {
    const g = game(feats);
    g.ship.beginBreach(20);
    assert.equal(g.ship.ejectCore(), true);
    return g;
  };

  test('anyone can eject one; almost nobody can go back for it', () => {
    const plain = breached([]);
    assert.equal(plain.ship.coreEjected, true);
    assert.equal(plain.ship.coreRecoverable, false);
    const r = plain.recoverCore();
    assert.equal(r.ok, false);
    assert.match(r.reason, /Nobody aboard/);
    assert.equal(plain.ship.coreEjected, true, 'the core came back anyway');
  });

  test('and the engineer does', () => {
    const g = breached(['master_engineer']);
    assert.equal(g.ship.coreRecoverable, true);
    assert.equal(g.ship.subsystems.warpcore, 0);
    assert.equal(g.recoverCore().ok, true);
    assert.equal(g.ship.coreEjected, false);
    assert.ok(g.ship.subsystems.warpcore > 0, 'a recovered core is not a core');
    assert.equal(g.ship.power.cap, g.ship.cls.powerCap, 'the ship is still on half power');
  });

  test('and it comes back cold, not new', () => {
    const g = breached(['master_engineer']);
    g.recoverCore();
    assert.ok(g.ship.subsystems.warpcore < 0.6,
      `a core walked back into its housing came out at ${g.ship.subsystems.warpcore}`);
  });

  test('not while they are shooting', () => {
    const g = breached(['master_engineer']);
    g.startCombat([new Ship('galor', { faction: 'cardassian', name: 'Bok' })]);
    const r = g.recoverCore();
    assert.equal(r.ok, false);
    assert.match(r.reason, /shooting/);
    assert.equal(g.ship.coreEjected, true);
  });

  test('and only once — the core is not a renewable resource', () => {
    const g = breached(['master_engineer']);
    assert.equal(g.recoverCore().ok, true);
    const again = g.recoverCore();
    assert.equal(again.ok, false);
    assert.match(again.reason, /There is a core in the ship/);
  });

  test('and a yard fits a new one, leaving nothing out there to recover', () => {
    const g = breached(['master_engineer']);
    g.ship.restore();
    assert.equal(g.ship.coreEjected, false);
    assert.equal(g.ship.coreRecoverable, false);
    assert.equal(g.recoverCore().ok, false);
  });

  test('and a save taken with the core adrift remembers it is out there', () => {
    const g = breached(['master_engineer']);
    const back = Ship.load(JSON.parse(JSON.stringify(g.ship.save())));
    assert.equal(back.coreEjected, true);
    assert.equal(back.coreRecoverable, true);
  });
});

describe('Survivor — once per commission, survive it at 1% hull', () => {
  /**
   * Kill the ship the way a battle kills it.
   *
   * Two things the first draft of this got wrong. `takeDamage` does not
   * destroy anything — a hull at zero starts a warp core breach, and the
   * breach runs out in `update` — so asserting on the next line is asserting
   * about a ship with twenty seconds still on its clock. And one enormous hit
   * kills the entire crew on the way through, which is a different death with
   * a different name; measured over sixty battles a Miranda could not win, the
   * ship was lost 58 times to catastrophic hull failure and twice to total
   * crew loss, so the enormous hit was the rare case dressed up as the normal
   * one. Small repeated hits, which is what being shot at is.
   */
  const sink = (g, seconds = 60) => {
    for (let n = 0; n < 40 && !g.ship.destroyed && g.ship.hull > 0; n++) {
      g.ship.takeDamage(g.ship.maxHull * 0.06, { bearing: 0 }, g.rng);
    }
    for (let i = 0; i < 30 * seconds && !g.ship.destroyed; i++) g.ship.update(1 / 30, g.rng);
    return g.ship;
  };

  test('a captain without it dies when the hull goes', () => {
    assert.equal(sink(game()).destroyed, true);
  });

  test('and a captain with it walks away from the same hit', () => {
    const g = game(['survivor']);
    assert.equal(g.ship.deathSaves, 1, 'the allowance never reached the ship');
    const s = sink(g);
    assert.equal(s.destroyed, false);
    assert.ok(s.hullPct > 0 && s.hullPct < 0.02,
      `survived at ${(100 * s.hullPct).toFixed(2)}% hull`);
    assert.equal(s.breaching, false, 'saved, and still counting down');
  });

  test('once, and then never again this commission', () => {
    const g = game(['survivor']);
    assert.equal(sink(g).destroyed, false);
    assert.equal(sink(g).destroyed, true, 'the ship survived twice');
  });

  test('and it answers every way the game can kill you, not just gunnery', () => {
    // Put in `destroy` rather than at the likeliest call site. A ship is
    // destroyed by weapons fire, by a breach it ran out of time on, by losing
    // its whole crew and by a hull that fails while the core is clear; a feat
    // that answered only one of those would be a feat that worked when the
    // game happened to kill you the expected way.
    const g = game(['survivor']);
    g.ship.beginBreach(1);
    for (let i = 0; i < 300 && !g.ship.destroyed; i++) g.ship.update(1 / 30, g.rng);
    assert.equal(g.ship.destroyed, false, 'the breach went off anyway');
    assert.equal(g.ship.deathSaves, 0, 'it survived without spending anything');
  });

  test('and not with nobody left alive to work it', () => {
    // One hit big enough to take the whole crew with it. The ship is lost to
    // total crew loss, and the save is still on the sheet — spending it here
    // would buy exactly one tick, because `update` finds the crew at zero on
    // the next pass and there would be nothing left to spend.
    const g = game(['survivor']);
    g.ship.takeDamage(999999, { bearing: 0 });
    assert.equal(g.ship.crew, 0);
    for (let i = 0; i < 300 && !g.ship.destroyed; i++) g.ship.update(1 / 30, g.rng);
    assert.equal(g.ship.destroyed, true);
    assert.equal(g.ship.destroyCause, 'total crew loss');
    assert.equal(g.ship.deathSavesSpent, 0, 'the save was spent on a death it cannot prevent');
  });

  test('and it is not refunded by a refit', () => {
    // `applyAllMods` runs again every time anything touches the ship's
    // modifiers. An allowance restored by changing a console is not once per
    // commission.
    const g = game(['survivor']);
    sink(g);
    assert.equal(g.ship.deathSaves, 0);
    g.applyAllMods();
    assert.equal(g.ship.deathSaves, 0, 'a recompute handed the save back');
  });

  test('and a save file does not hand it back either', () => {
    const g = game(['survivor']);
    sink(g);
    const back = Ship.load(JSON.parse(JSON.stringify(g.ship.save())));
    assert.equal(back.deathSavesSpent, 1);
  });

  test('and neither does losing the ship, which is the one that got through', () => {
    // The two tests above guard a refit and a save file. Neither guards the
    // one thing that actually replaces the object the counter lives on.
    // `deathSavesSpent` is a field on the Ship — so `destroy` can write it
    // without a back-reference to the campaign — and a replacement hull is a
    // new Ship with the counter at zero. Measured before the fix: the feat
    // fired TWICE in one commission, once aboard the Miranda and again aboard
    // the Hood that replaced her.
    const g = game(['survivor']);
    sink(g);
    assert.equal(g.ship.deathSavesSpent, 1, 'the fixture never spent the save');

    const lost = g.ship;
    g.loseTheShip();
    assert.notEqual(g.ship, lost, 'the fixture never actually replaced the ship');
    g.applyAllMods();
    assert.equal(g.ship.deathSavesSpent, 1,
      'a new hull came with the allowance reset');
    assert.equal(g.ship.deathSaves, 0,
      'losing the ship handed the once-per-commission save back');
  });

  test('and the captain is told when it happens', () => {
    // The save is the most violent thing that can happen to a ship without
    // ending the commission: the hull snaps to 1%, a running breach stops, any
    // boarding party vanishes and every facing goes flat, in one tick. It
    // emitted `ship:deathsave`, which had no listener anywhere, and said
    // nothing on any other path — so it read as a display fault, and the
    // allowance was spent with nothing to show it.
    const g = game(['survivor']);
    const before = g.log.length;
    sink(g);
    g.update(1 / 30);
    const said = g.log.slice(before).filter((e) => /one percent of hull/.test(e.text ?? ''));
    assert.equal(said.length, 1,
      `the ship was saved and the campaign log said it ${said.length} times`);

    // And exactly once, however long the commission runs afterwards.
    for (let i = 0; i < 200; i++) g.update(1 / 30);
    assert.equal(g.log.filter((e) => /one percent of hull/.test(e.text ?? '')).length, 1,
      'the sweep runs every tick and said it again');
  });

  test('and the combat log says it too, while the fight is still going on', () => {
    // Two surfaces on purpose, the same way losing the ship has two: the
    // combat log is where the captain is looking at that second, and the
    // campaign log is the record that outlives the sixty lines the combat log
    // keeps. `Ship.destroy` returns before setting `destroyed`, so the sweep
    // that reports kills walks straight past a save — it is the same silence
    // `onDestroyed` was written to end, reached from the other side.
    const g = game(['survivor']);
    const eng = g.startCombat([new Ship('neghvar', { faction: 'klingon', name: 'N1' })],
      { relentless: true });
    assert.equal(eng.log.filter((e) => /should have been lost/.test(e.text)).length, 0,
      'the engagement announced a save before anything happened');

    sink(g);
    eng.update(1 / 30);
    const said = eng.log.filter((e) => /should have been lost/.test(e.text));
    assert.equal(said.length, 1, `the combat log said it ${said.length} times`);

    for (let i = 0; i < 120; i++) eng.update(1 / 30);
    assert.equal(eng.log.filter((e) => /should have been lost/.test(e.text)).length, 1,
      'the sweep runs every tick and said it again');

    // And the NEXT fight does not re-announce it. The counter survives the
    // battle it was spent in, so a sweep that started from an empty map would
    // open every subsequent engagement by reporting a rescue that happened in
    // a previous one. Written because the control for it — seeding the map
    // empty — passed everything above: the case only exists once a ship walks
    // into a fight with the save already gone.
    //
    // The first draft of this called `startCombat` again without ending the
    // fight, which returns the SAME engagement, so it re-read the line the
    // first fight had already written and failed for a reason that had nothing
    // to do with the seeding.
    assert.equal(g.ship.deathSavesSpent, 1, 'the fixture never spent the save');
    eng.end('victory');
    g.resolveCombat?.();
    g.engagement = null;
    g.ship.restore();
    assert.equal(g.ship.deathSavesSpent, 1, 'restoring the ship handed the save back');

    const next = g.startCombat([new Ship('neghvar', { faction: 'klingon', name: 'N2' })],
      { relentless: true });
    assert.notEqual(next, eng, 'the fixture never actually started a second fight');
    next.update(1 / 30);
    assert.equal(next.log.filter((e) => /should have been lost/.test(e.text)).length, 0,
      'the next engagement opened by announcing the previous one\'s rescue');
  });

  test('and a campaign loaded afterwards does not announce it a second time', () => {
    // `deathSavesSpent` is saved with the ship. A counter that started at zero
    // on load would find it already spent and report a rescue that happened
    // before the save file was written.
    const g = game(['survivor']);
    sink(g);
    g.update(1 / 30);
    assert.equal(g.ship.deathSavesSpent, 1, 'the fixture never spent the save');

    const reloaded = Game.load(JSON.parse(JSON.stringify(g.save())));
    assert.equal(reloaded.ship.deathSavesSpent, 1, 'the save file lost the spent counter');
    const before = reloaded.log.length;
    for (let i = 0; i < 60; i++) reloaded.update(1 / 30);
    assert.equal(reloaded.log.slice(before).filter((e) => /one percent of hull/.test(e.text ?? '')).length, 0,
      'loading a campaign re-announced a save spent before the file was written');
  });
});

describe('Inspiring Presence — cooldowns recover faster, officers never object', () => {
  const withOfficer = (feats, abilityId) => {
    const g = game(feats);
    const officer = g.crew.officers.find((o) => o.abilities.includes(abilityId))
      ?? g.crew.officers.find((o) => o.learn(abilityId));
    return { g, officer };
  };

  test('forty per cent faster is the same wait divided by one point four', () => {
    const a = withOfficer([], 'fire_at_will');
    const b = withOfficer(['inspiring'], 'fire_at_will');
    applyAbility(a.g, a.officer, 'fire_at_will');
    applyAbility(b.g, b.officer, 'fire_at_will');
    const plain = a.officer.cooldowns.fire_at_will;
    const fast = b.officer.cooldowns.fire_at_will;
    assert.ok(plain > 0, 'nothing went on cooldown at all');
    assert.ok(Math.abs(fast * 1.4 - plain) < 1e-6,
      `${plain.toFixed(2)} seconds became ${fast.toFixed(2)}`);
  });

  test('an officer who thinks an order is wrong says so in their own voice', () => {
    // And this is the defect underneath the feat: the objection was computed,
    // stored, and then spoken as the ability's canned line, because the line
    // was `a.say ?? officer.acknowledge(reaction)` and every ability has a
    // `say`. The right-hand side had never evaluated.
    const { g, officer } = withOfficer([], 'stimulants');
    officer.candor = 95;
    officer.discipline = 95;
    const r = applyAbility(g, officer, 'stimulants');
    assert.equal(r.ok, true, 'an objection is not a refusal');
    assert.equal(r.reaction, 'object');
    assert.notEqual(r.line, ABILITIES.stimulants.say,
      'the objecting officer said the cheerful line');
  });

  test('and a refusal is a refusal', () => {
    // `reactTo` has documented three answers since it was written and the
    // third one did nothing: the order went through regardless and the
    // officer's line about it was discarded too.
    //
    // Ordered with a weight no SHIPPED ability carries. Back to Duty was tried
    // at 0.55 and the canon TOS doctor refused it every time, which took a
    // rank-two ability away from a whole crew for good; the table now stops
    // below the line on purpose, and this is the branch tested where it lives
    // rather than by making the game worse to reach it.
    const { g, officer } = withOfficer([], 'back_to_duty');
    officer.candor = 95;
    officer.discipline = 40;
    const grave = { ...ABILITIES.back_to_duty, ethicalWeight: 0.9 };
    const r = applyAbility(g, officer, grave);
    assert.equal(r.ok, false);
    assert.equal(r.reaction, 'refuse');
    assert.equal(officer.cooldowns.back_to_duty ?? 0, 0,
      'an order that was not carried out cost the station its clock');
  });

  test('and neither happens to a captain the bridge would follow anywhere', () => {
    for (const id of ['stimulants', 'back_to_duty']) {
      const { g, officer } = withOfficer(['inspiring'], id);
      officer.candor = 95;
      officer.discipline = 40;
      const r = applyAbility(g, officer, { ...ABILITIES[id], ethicalWeight: 0.9 });
      assert.equal(r.ok, true, `${id} was still refused`);
      assert.equal(r.reaction, 'comply');
      assert.equal(r.line, ABILITIES[id].say);
    }
  });

  test('and the two halves are independent', () => {
    // A captain with no feat still gets compliance out of a disciplined
    // officer, so the test above is not simply measuring "inspiring makes
    // things work".
    const { g, officer } = withOfficer([], 'stimulants');
    officer.candor = 30;
    officer.discipline = 95;
    assert.equal(applyAbility(g, officer, 'stimulants').reaction, 'comply');
  });
});

describe('Fleet Tactician — allied ships gain your Tactics modifier', () => {
  const SHARP = {
    command: 14, tactics: 20, engineering: 12, science: 12, medicine: 10, diplomacy: 10,
  };
  const fight = (feats) => {
    const g = game(feats, { scores: SHARP });
    const friend = new Ship('miranda', { name: 'USS Hood', faction: 'federation' });
    const eng = g.startCombat([new Ship('galor', { faction: 'cardassian', name: 'Bok' })],
      { allies: [friend], relentless: true });
    return { g, friend, eng };
  };

  test('the captain has a Tactics modifier worth lending', () => {
    const c = game([], { scores: SHARP }).character;
    assert.ok(c.mod('tactics') >= 5, `a Tactics modifier of ${c.mod('tactics')}`);
    assert.equal(c.allyMods(), null, 'a captain without the feat lends something');
  });

  test('and an ally that came with the captain shoots the way the captain does', () => {
    const plain = fight([]);
    const fleet = fight(['fleet_tactician']);
    assert.ok(fleet.friend.mod('accuracy') > plain.friend.mod('accuracy') + 0.05,
      `ally accuracy ${plain.friend.mod('accuracy')} against ${fleet.friend.mod('accuracy')}`);
    assert.ok(fleet.friend.mod('critChance') > plain.friend.mod('critChance'),
      'the ally crits no better than before');
  });

  test('and the player ship is not double-counted', () => {
    // The captain's own Tactics already reaches their own ship through
    // `shipMods`. Lending it to themselves as well would make the feat a
    // personal gunnery upgrade wearing a squadron's name.
    const plain = fight([]);
    const fleet = fight(['fleet_tactician']);
    assert.equal(fleet.g.ship.mod('accuracy'), plain.g.ship.mod('accuracy'));
  });

  test('and a ship that answers a distress call mid-fight gets it too', () => {
    const { g, eng } = fight(['fleet_tactician']);
    g.helpInbound = { eta: 0.1, classId: 'miranda', name: 'USS Yorktown', faction: 'federation' };
    g.updateHelp(1);
    const arrival = eng.allies[eng.allies.length - 1];
    assert.equal(arrival.name, 'USS Yorktown');
    assert.ok(arrival.mod('accuracy') > 1.05,
      'the ship that came when we called was not in the squadron');
  });

  test('and it shows in the fight', () => {
    // The measurement that says it is worth a rank-four feat. A fixed sixty
    // seconds rather than a race to the end: both squadrons clear two Galors
    // eventually, and what the Tactician buys is how much is left of them when
    // the minute is up.
    const remaining = (feats) => {
      let left = 0;
      for (let seed = 1n; seed <= 20n; seed++) {
        const g = game(feats, { seed, scores: SHARP });
        const friend = new Ship('galaxy', { name: 'USS Hood', faction: 'federation' });
        const eng = g.startCombat(
          ['galor', 'galor'].map((c, i) => new Ship(c, { faction: 'cardassian', name: `H${i}` })),
          { allies: [friend], relentless: true });
        for (let i = 0; i < 30 * 60 && !eng.over; i++) {
          eng.comeAboutTo(eng.target);
          g.ship.throttle = 0.6;
          eng.update(1 / 30);
        }
        left += eng.hostiles.reduce((n, s2) => n + (s2.destroyed ? 0 : s2.hullPct), 0);
      }
      return left;
    };
    const plain = remaining([]);
    const fleet = remaining(['fleet_tactician']);
    assert.ok(fleet < plain,
      `${plain.toFixed(2)} hostile hulls left standing against ${fleet.toFixed(2)} with the Tactician`);
  });
});
