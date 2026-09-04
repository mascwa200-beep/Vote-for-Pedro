// Three species traits that were words on the character sheet.
//
// A check resolves through `AwayTeam.check`, and it asked exactly one question
// about the captain: `hasAdvantageOn(ability)`, which reads `advantageOn` and
// nothing else. Measured through `Game.buildAwayTeam` and that same check, 400
// runs at DC 14:
//
//     species        healthy   ship below half hull
//     human            61.0%          61.0%
//     bajoran          56.0%          56.0%     "advantage while below half hull"
//     half_vulcan      61.0%          61.0%     "advantage on Science, or Command"
//     vulcan           85.3%          85.3%     advantageOn: read since it was written
//
// The Vulcan column is the control: advantage is worth about 24 points here and
// the measurement can plainly see it. The Bajoran and the half-Vulcan promised
// it and never got it.
//
// And the Human — the species most captains are — promised "Once per away
// mission, reroll a failed check." `AwayTeam.canReroll()` has existed since the
// away team did and was called from nowhere; `rerollsRemaining` was set by
// `Character.refresh`, which `startCombat` calls and the away system does not,
// and decremented by nothing at all.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Character, PLAYER_SPECIES } from '../src/rules/character.js';

const game = (speciesId, { seed = 1n, hurt = false } = {}) => {
  const g = new Game({
    seed, crewMode: 'original',
    character: new Character({ speciesId, careerId: 'command' }),
    shipClass: 'constitution',
  });
  if (hurt) g.ship.hull = g.ship.maxHull * 0.3;
  return g;
};

/** Success rate of a check, through the game's own team and its own roll. */
function rate(speciesId, { hurt = false, type = 'science', n = 300, before = null } = {}) {
  let wins = 0;
  for (let s = 1n; s <= BigInt(n); s++) {
    const g = game(speciesId, { seed: s, hurt });
    before?.(g);
    const team = g.buildAwayTeam();
    if (team.check(g.rng, type, { dc: 14, hazard: 'routine' }).success) wins++;
  }
  return wins / n;
}

describe('advantage is worth something, and the measurement can see it', () => {
  test('the control: a species that already had it', () => {
    // `advantageOn` has been read through `hasAdvantageOn` since it was
    // written. If this gap ever closes, every assertion below is measuring
    // nothing and would pass for the wrong reason.
    const plain = rate('human');
    const vulcan = rate('vulcan');
    assert.ok(vulcan - plain > 0.15,
      `advantage is worth ${((vulcan - plain) * 100).toFixed(1)} points, which is not enough to see`);
  });
});

describe('Resistance Veteran — advantage while the ship is below half hull', () => {
  test('the Bajoran gets it when the ship is in trouble', () => {
    const healthy = rate('bajoran');
    const desperate = rate('bajoran', { hurt: true });
    assert.ok(desperate - healthy > 0.15,
      `${(100 * healthy).toFixed(1)}% healthy against ${(100 * desperate).toFixed(1)}% hurt`);
  });

  test('and nobody else does', () => {
    // The control. A hurt ship must not help a captain who was never promised
    // it, or the trait is not the thing doing the work.
    for (const sp of ['human', 'vulcan']) {
      const d = rate(sp, { hurt: true }) - rate(sp);
      assert.ok(Math.abs(d) < 0.05,
        `${sp} gained ${(100 * d).toFixed(1)} points from a damaged ship`);
    }
  });

  test('and the threshold is half, read off the ship the party came from', () => {
    const team = (pct) => {
      const g = game('bajoran');
      g.ship.hull = g.ship.maxHull * pct;
      return g.buildAwayTeam();
    };
    assert.equal(team(0.9).desperate(), false);
    assert.equal(team(0.51).desperate(), false);
    assert.equal(team(0.49).desperate(), true);
    assert.equal(team(0.1).desperate(), true);
    // A team built with no ship behind it is not desperate, it is a harness.
    assert.equal(team(0.3).hullPct < 0.5, true);
  });
});

describe('Two Disciplines — choose Logic or Instinct before any check', () => {
  test('a half-Vulcan has the advantage on the discipline that is live', () => {
    const g = game('half_vulcan');
    assert.deepEqual(g.character.disciplines, ['science', 'command']);
    const team = g.buildAwayTeam();
    // Unchosen falls to the first, so a captain who never picks still has one.
    assert.equal(team.disciplineCovers('science'), true);
    assert.equal(team.disciplineCovers('command'), false);

    assert.equal(g.character.chooseDiscipline('command'), true);
    assert.equal(team.disciplineCovers('command'), true);
    assert.equal(team.disciplineCovers('science'), false);
  });

  test('and it is one at a time, not both', () => {
    // The whole point of "choose". A trait that granted both would be strictly
    // better than the Vulcan's, which grants one.
    const g = game('half_vulcan');
    const team = g.buildAwayTeam();
    for (const chosen of ['science', 'command']) {
      g.character.chooseDiscipline(chosen);
      const covered = g.character.disciplines.filter((a) => team.disciplineCovers(a));
      assert.deepEqual(covered, [chosen]);
    }
  });

  test('and it cannot be set to something the captain was never promised', () => {
    // A save file or a misheard order must not grant advantage on an ability
    // outside the two the mechanic lists.
    const g = game('half_vulcan');
    assert.equal(g.character.chooseDiscipline('engineering'), false);
    assert.equal(g.buildAwayTeam().disciplineCovers('engineering'), false);
    // And a species with no such trait cannot choose at all.
    const h = game('human');
    assert.deepEqual(h.character.disciplines, []);
    assert.equal(h.character.chooseDiscipline('science'), false);
    assert.equal(h.buildAwayTeam().disciplineCovers('science'), false);
  });

  test('and the choice survives a save', () => {
    const g = game('half_vulcan');
    g.character.chooseDiscipline('command');
    const back = new Character(JSON.parse(JSON.stringify(g.character.save())));
    assert.equal(back.discipline, 'command');
  });

  test('it shows up in the rolls', () => {
    const chosen = (d) => rate('half_vulcan', {
      type: 'science', before: (g) => g.character.chooseDiscipline(d),
    });
    const onScience = chosen('science');
    const onCommand = chosen('command');
    assert.ok(onScience - onCommand > 0.15,
      `science ${(100 * onScience).toFixed(1)}% against command ${(100 * onCommand).toFixed(1)}% `
      + 'on a science check');
  });
});

describe('Adaptable — once per away mission, reroll a failed check', () => {
  /** Fly a landing party through the door the order gives. */
  function landings(speciesId, n = 100) {
    let wins = 0;
    let steps = 0;
    for (let s = 1n; s <= BigInt(n); s++) {
      const g = game(speciesId, { seed: s });
      g.enterOrbit();
      const offer = g.availableAwayMissions();
      if (!offer.length) continue;
      const r = g.awayMission(offer[0].id);
      for (const st of r.steps ?? []) { steps++; if (st.success) wins++; }
    }
    return { steps, rate: steps ? wins / steps : 0 };
  }

  test('a Human landing party does better than one that cannot reroll', () => {
    const human = landings('human');
    const bolian = landings('bolian');
    assert.ok(human.steps > 100 && bolian.steps > 100, 'not enough landings to read');
    assert.ok(human.rate - bolian.rate > 0.1,
      `human ${(100 * human.rate).toFixed(1)}% against bolian ${(100 * bolian.rate).toFixed(1)}%`);
  });

  test('the reroll is spent, not merely counted', () => {
    const g = game('human');
    const team = g.buildAwayTeam();
    assert.equal(team.canReroll(), true, 'a new landing party has no reroll');
    // Force a failure the reroll must answer.
    const opts = { dc: 40, hazard: 'routine' };
    const first = team.check(g.rng, 'science', opts);
    assert.equal(first.success, false, 'DC 40 was passed, so this proves nothing');
    team.rerollIfPossible(g.rng, 'science', opts, first);
    assert.equal(team.canReroll(), false, 'the reroll was not spent');
    // And it does not come back within the same mission.
    const again = team.rerollIfPossible(g.rng, 'science', opts,
      team.check(g.rng, 'science', opts));
    assert.ok(!again.rerolled, 'a second reroll in one mission');
  });

  test('and a success is never rerolled', () => {
    const g = game('human');
    const team = g.buildAwayTeam();
    const win = team.check(g.rng, 'science', { dc: 1, hazard: 'routine' });
    assert.equal(win.success, true);
    const after = team.rerollIfPossible(g.rng, 'science', { dc: 1 }, win);
    assert.equal(after, win, 'a passing check was rolled again');
    assert.equal(team.canReroll(), true, 'a success spent the reroll');
  });

  test('it refreshes per MISSION, which is what the trait says', () => {
    // `Character.refresh` is called by `startCombat`. Getting into a fight is
    // not going on an away mission, and before this the reroll was replenished
    // by the one and spent by neither.
    const g = game('human');
    const first = g.buildAwayTeam();
    first.rerollIfPossible(g.rng, 'science', { dc: 40 },
      first.check(g.rng, 'science', { dc: 40 }));
    assert.equal(first.canReroll(), false);
    const second = g.buildAwayTeam();
    assert.equal(second.canReroll(), true, 'a new landing party did not get the reroll back');
  });

  test('and a species without the trait never has one', () => {
    for (const sp of ['vulcan', 'bolian', 'bajoran']) {
      assert.equal(game(sp).buildAwayTeam().canReroll(), false, `${sp} rerolled`);
    }
  });
});

describe('the traits these read are ones the tables declare', () => {
  test('each promise is still on the card it was read from', () => {
    const by = Object.fromEntries(PLAYER_SPECIES.map((s) => [s.id, s]));
    assert.equal(by.bajoran.mechanic.desperateAdvantage, true);
    assert.match(by.bajoran.traitText, /below half hull/i);
    assert.deepEqual(by.half_vulcan.mechanic.switchableAdvantage, ['science', 'command']);
    assert.match(by.half_vulcan.traitText, /choose/i);
    assert.equal(by.human.mechanic.rerollPerMission, 1);
    assert.match(by.human.traitText, /reroll/i);
  });
});
