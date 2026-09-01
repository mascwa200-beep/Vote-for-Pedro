// Tests for the d20 layer, the character sheet, reputation, and difficulty.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, successChance } from '../src/rules/resolve.js';
import { readFileSync } from 'node:fs';

import { RNG } from '../src/core/rng.js';
import {
  check, contest, roll, rollDamage, abilityMod, proficiencyBonus,
  describeDC, formatCheck, DC,
} from '../src/rules/dice.js';
import {
  Character, randomCharacter, ABILITY_IDS, PLAYER_SPECIES, ORIGINS, CAREERS,
  TRAITS, FEATS, POINT_BUY_COST, pointBuyCost, STANDARD_ARRAY, SPECIES_BY_ID,
} from '../src/rules/character.js';
import {
  Reputation, REP_TRACKS, REP_TIERS, REP_AWARDS, TRACK_LIST,
} from '../src/rules/reputation.js';
import {
  DIFFICULTIES, DifficultySettings, getDifficulty, DEFAULT_DIFFICULTY,
} from '../src/rules/difficulty.js';
import { AwayTeam, CHECK_TYPES } from '../src/sim/away.js';
import { Officer } from '../src/sim/officers.js';
import { Game } from '../src/core/state.js';

// ================================================================ dice

test('ability modifiers follow the standard table', () => {
  assert.equal(abilityMod(10), 0);
  assert.equal(abilityMod(11), 0);
  assert.equal(abilityMod(12), 1);
  assert.equal(abilityMod(8), -1);
  assert.equal(abilityMod(20), 5);
  assert.equal(abilityMod(1), -5);
});

test('proficiency scales with level', () => {
  assert.equal(proficiencyBonus(1), 2);
  assert.equal(proficiencyBonus(4), 2);
  assert.equal(proficiencyBonus(5), 3);
  assert.equal(proficiencyBonus(17), 6);
});

test('a d20 check stays within its arithmetic bounds', () => {
  const rng = new RNG(1n);
  for (let i = 0; i < 2000; i++) {
    const r = check(rng, { modifier: 3, dc: 12 });
    assert.ok(r.natural >= 1 && r.natural <= 20);
    assert.equal(r.total, r.natural + 3);
  }
});

test('a natural 20 always succeeds and a natural 1 always fails', () => {
  const rng = new RNG(2n);
  let sawCritSuccess = false;
  let sawCritFail = false;
  for (let i = 0; i < 4000; i++) {
    // An impossible DC and a trivial one, to isolate the rule.
    const hard = check(rng, { modifier: -5, dc: 30 });
    if (hard.natural === 20) { assert.ok(hard.success, 'nat 20 beats DC 30'); sawCritSuccess = true; }
    const easy = check(rng, { modifier: 20, dc: 2 });
    if (easy.natural === 1) { assert.ok(!easy.success, 'nat 1 fails DC 2'); sawCritFail = true; }
  }
  assert.ok(sawCritSuccess && sawCritFail, 'both cases were exercised');
});

test('advantage raises the average and disadvantage lowers it', () => {
  const mean = (opts) => {
    const rng = new RNG(3n);
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) sum += check(rng, { ...opts, dc: 10 }).natural;
    return sum / n;
  };
  const flat = mean({});
  const adv = mean({ advantage: true });
  const dis = mean({ disadvantage: true });
  assert.ok(adv > flat + 1, `advantage ${adv} vs flat ${flat}`);
  assert.ok(dis < flat - 1, `disadvantage ${dis} vs flat ${flat}`);
});

test('advantage and disadvantage cancel exactly', () => {
  const rng = new RNG(4n);
  const r = check(rng, { advantage: true, disadvantage: true, dc: 10 });
  assert.equal(r.advantage, false);
  assert.equal(r.disadvantage, false);
  assert.equal(r.rolls.length, 1, 'only one die is rolled when they cancel');
});

test('luck rerolls a natural 1 a bounded number of times', () => {
  const n = 4000;
  const countOnes = (luck) => {
    const rng = new RNG(5n);
    let ones = 0;
    for (let i = 0; i < n; i++) {
      const r = check(rng, { dc: 10, luck });
      assert.ok(r.lucked <= luck, 'never more rerolls than granted');
      if (r.natural === 1) ones++;
    }
    return ones;
  };

  const without = countOnes(0);
  const withLuck = countOnes(2);
  assert.ok(without > 100, `sanity: ~5% of 4000 should be ones, got ${without}`);
  // Two rerolls take the chance of keeping a 1 from 1/20 to 1/8000, so it
  // should essentially vanish without being made impossible by construction.
  assert.ok(withLuck < without / 20, `luck should suppress fumbles: ${withLuck} vs ${without}`);
});

test('checks are deterministic for a given seed', () => {
  const run = () => {
    const rng = new RNG(0xd20n);
    return Array.from({ length: 40 }, () => check(rng, { modifier: 2, dc: 13 }).total);
  };
  assert.deepEqual(run(), run());
});

test('degree of success is ordered', () => {
  const rng = new RNG(6n);
  for (let i = 0; i < 1000; i++) {
    const r = check(rng, { modifier: 0, dc: 12 });
    if (r.criticalSuccess) assert.equal(r.degree, 2);
    if (r.criticalFailure) assert.equal(r.degree, -2);
    if (r.success && !r.criticalSuccess) assert.ok(r.degree >= 0);
    if (!r.success && !r.criticalFailure) assert.ok(r.degree < 0);
  }
});

test('a contest produces a winner and a margin', () => {
  const rng = new RNG(7n);
  const c = contest(rng, { modifier: 5 }, { modifier: 0 });
  assert.equal(typeof c.attackerWins, 'boolean');
  assert.equal(c.margin, c.attacker.total - c.defender.total);
});

test('dice pools and damage expressions roll in range', () => {
  const rng = new RNG(8n);
  const r = roll(rng, 3, 6, 2);
  assert.equal(r.dice.length, 3);
  assert.ok(r.total >= 5 && r.total <= 20);

  const dmg = rollDamage(rng, '2d6+3');
  assert.ok(dmg.total >= 5 && dmg.total <= 15, `got ${dmg.total}`);
  assert.equal(rollDamage(rng, 'nonsense').total, 0);
});

test('checks format legibly for the log', () => {
  const rng = new RNG(9n);
  const r = check(rng, { modifier: 4, dc: 15 });
  const text = formatCheck(r, 'Engineering');
  assert.match(text, /Engineering: d20/);
  assert.match(text, /DC 15/);
  assert.ok(describeDC(DC.hard).length > 0);
});

// ================================================================ character

test('every species, origin, and career is well formed', () => {
  for (const s of PLAYER_SPECIES) {
    assert.ok(s.id && s.name && s.trait && s.traitText, `species ${s.id}`);
    for (const k of Object.keys(s.bonuses ?? {})) {
      assert.ok(ABILITY_IDS.includes(k), `${s.id} bonuses unknown ability ${k}`);
    }
    for (const k of Object.keys(s.penalties ?? {})) {
      assert.ok(ABILITY_IDS.includes(k), `${s.id} penalties unknown ability ${k}`);
    }
  }
  for (const o of ORIGINS) {
    assert.ok(o.id && o.name && o.perk, `origin ${o.id}`);
    for (const k of Object.keys(o.bonuses ?? {})) {
      assert.ok(ABILITY_IDS.includes(k), `${o.id} unknown ability ${k}`);
    }
  }
  for (const c of CAREERS) {
    assert.ok(c.signature && c.signatureText, `career ${c.id}`);
    for (const p of c.proficiencies) {
      assert.ok(ABILITY_IDS.includes(p), `${c.id} unknown proficiency ${p}`);
    }
  }
});

test('species bonuses actually change the final scores', () => {
  const base = { command: 10, tactics: 10, engineering: 10, science: 10, medicine: 10, diplomacy: 10 };
  const human = new Character({ speciesId: 'human', originId: 'core_world', baseScores: base });
  const vulcan = new Character({ speciesId: 'vulcan', originId: 'core_world', baseScores: base });
  assert.ok(vulcan.score('science') > human.score('science'), 'Vulcans are better at science');
  assert.ok(vulcan.score('diplomacy') < vulcan.score('science'), 'and worse at diplomacy');
});

test('scores are capped and floored', () => {
  const c = new Character({
    speciesId: 'vulcan',
    baseScores: Object.fromEntries(ABILITY_IDS.map((id) => [id, 99])),
  });
  for (const id of ABILITY_IDS) assert.ok(c.score(id) <= 20, `${id} exceeded the cap`);
});

test('point buy costs match the standard table and budget', () => {
  assert.equal(POINT_BUY_COST[8], 0);
  assert.equal(POINT_BUY_COST[14], 7);
  assert.equal(POINT_BUY_COST[15], 9);
  const allEight = Object.fromEntries(ABILITY_IDS.map((id) => [id, 8]));
  assert.equal(pointBuyCost(allEight), 0);
  assert.equal(STANDARD_ARRAY.length, ABILITY_IDS.length, 'the array fills every ability');
});

test('proficiency is added to check modifiers only where trained', () => {
  const c = new Character({
    careerId: 'engineering',
    baseScores: Object.fromEntries(ABILITY_IDS.map((id) => [id, 10])),
    speciesId: 'human', originId: 'core_world',
  });
  const trained = c.checkModifier('engineering');
  const untrained = c.checkModifier('tactics');
  assert.ok(trained > untrained, `${trained} should beat ${untrained}`);
  assert.ok(c.isProficient('engineering'));
  assert.ok(!c.isProficient('tactics'));
});

test('species advantage is reported through the sheet', () => {
  const vulcan = new Character({ speciesId: 'vulcan' });
  assert.ok(vulcan.hasAdvantageOn('science'));
  assert.ok(!vulcan.hasAdvantageOn('tactics'));
});

test('traits and feats surface their mechanics', () => {
  const c = new Character({ traits: ['tinkerer'], feats: [] });
  assert.equal(c.mechanic('salvageBonus'), 1);
  c.takeFeat('tactical_genius');
  assert.ok(c.hasFeat('tactical_genius'));
  assert.equal(c.mechanic('critRange'), 19);
});

test('the ability-score feat is repeatable and raises scores', () => {
  const c = new Character({
    baseScores: Object.fromEntries(ABILITY_IDS.map((id) => [id, 10])),
    speciesId: 'human', originId: 'core_world',
  });
  const before = c.score('tactics');
  c.takeFeat('ability_score', ['tactics', 'tactics']);
  assert.equal(c.score('tactics'), before + 2);
  c.takeFeat('ability_score', ['tactics']);
  assert.equal(c.score('tactics'), before + 3);
});

test('non-repeatable feats cannot be taken twice', () => {
  const c = new Character();
  assert.ok(c.takeFeat('unshakeable'));
  assert.ok(!c.takeFeat('unshakeable'));
});

test('the character contributes real ship modifiers', () => {
  const weak = new Character({
    baseScores: Object.fromEntries(ABILITY_IDS.map((id) => [id, 8])),
    speciesId: 'human', originId: 'core_world',
  });
  const strong = new Character({
    baseScores: Object.fromEntries(ABILITY_IDS.map((id) => [id, 15])),
    speciesId: 'andorian', originId: 'frontier_colony',
  });
  assert.ok(strong.shipMods().accuracy > weak.shipMods().accuracy,
    'a tactically gifted captain shoots straighter');
});

test('a character round-trips through save and load', () => {
  const c = new Character({
    firstName: 'Ilyana', lastName: 'Vance', speciesId: 'trill',
    originId: 'frontier_colony', careerId: 'science', traits: ['maverick', 'reckless'],
  });
  c.takeFeat('improviser');
  c.levelUp();
  const restored = Character.load(JSON.parse(JSON.stringify(c.save())));
  assert.equal(restored.name, c.name);
  assert.equal(restored.speciesId, 'trill');
  assert.equal(restored.level, c.level);
  assert.deepEqual(restored.traits, c.traits);
  assert.deepEqual(restored.scores(), c.scores());
});

test('random characters are valid and vary by seed', () => {
  const a = randomCharacter(new RNG(1n));
  const b = randomCharacter(new RNG(2n));
  for (const c of [a, b]) {
    assert.ok(SPECIES_BY_ID[c.speciesId], 'real species');
    assert.equal(c.traits.length, 2);
    for (const id of ABILITY_IDS) assert.ok(c.score(id) >= 1);
  }
  assert.notEqual(`${a.name}${a.speciesId}`, `${b.name}${b.speciesId}`);
});

// ================================================================ difficulty

test('the difficulty ladder is ordered and complete', () => {
  assert.equal(DIFFICULTIES[0].id, 'story');
  assert.equal(DIFFICULTIES.at(-1).id, 'fleet_admiral');
  for (let i = 1; i < DIFFICULTIES.length; i++) {
    assert.equal(DIFFICULTIES[i].order, DIFFICULTIES[i - 1].order + 1, DIFFICULTIES[i].id);
  }
  for (const d of DIFFICULTIES) {
    assert.ok(d.name && d.tagline && d.description, `${d.id} needs presentation text`);
  }
});

test('difficulty monotonically increases enemy strength and decreases yours', () => {
  for (let i = 1; i < DIFFICULTIES.length; i++) {
    const prev = DIFFICULTIES[i - 1];
    const cur = DIFFICULTIES[i];
    assert.ok(cur.enemyDamage >= prev.enemyDamage, `${cur.id} enemy damage`);
    assert.ok(cur.enemyHull >= prev.enemyHull, `${cur.id} enemy hull`);
    assert.ok(cur.playerDamage <= prev.playerDamage, `${cur.id} player damage`);
    assert.ok(cur.dcShift >= prev.dcShift, `${cur.id} dc shift`);
  }
});

test('Story protects the player and Fleet Admiral does not', () => {
  const story = new DifficultySettings('story');
  const fleet = new DifficultySettings('fleet_admiral');
  assert.equal(story.permadeath, false);
  assert.ok(story.luck > 0);
  assert.ok(story.dc(15) < 15, 'Story lowers DCs');

  assert.equal(fleet.permadeath, true);
  assert.equal(fleet.allowReload, false);
  assert.equal(fleet.ironman, true);
  assert.ok(fleet.dc(15) > 15, 'Fleet Admiral raises DCs');
});

test('DCs never fall below a floor even on Story', () => {
  assert.ok(new DifficultySettings('story').dc(4) >= 3);
});

test('difficulty scales enemy counts and produces usable mod objects', () => {
  const easy = new DifficultySettings('cadet');
  const hard = new DifficultySettings('admiral');
  assert.ok(hard.enemyCount(2) > easy.enemyCount(2));
  assert.ok(easy.enemyCount(1) >= 1, 'never fields zero enemies');
  for (const d of [easy, hard]) {
    for (const v of Object.values(d.enemyMods())) assert.ok(Number.isFinite(v));
    for (const v of Object.values(d.playerMods())) assert.ok(Number.isFinite(v));
  }
});

test('an unknown difficulty id falls back to the default', () => {
  assert.equal(getDifficulty('nonsense').id, DEFAULT_DIFFICULTY);
  assert.equal(DifficultySettings.load(null).id, DEFAULT_DIFFICULTY);
});

// ================================================================ reputation

test('every reputation track and project is well formed', () => {
  for (const track of TRACK_LIST) {
    assert.ok(track.name && track.currency, `${track.id}`);
    assert.ok(track.projects.length > 0, `${track.id} has projects`);
    for (const p of track.projects) {
      assert.ok(p.id && p.name && p.text, `${track.id}/${p.id}`);
      assert.ok(p.tier >= 1 && p.tier <= REP_TIERS.length - 1, `${p.id} tier range`);
      assert.ok(p.cost > 0, `${p.id} cost`);
      assert.ok(p.grant, `${p.id} grants something`);
    }
    // Costs should rise with tier, or the economy is meaningless.
    const sorted = [...track.projects].sort((a, b) => a.tier - b.tier);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].tier > sorted[i - 1].tier) {
        assert.ok(sorted[i].cost > sorted[i - 1].cost,
          `${track.id}: tier ${sorted[i].tier} should cost more than tier ${sorted[i - 1].tier}`);
      }
    }
  }
});

test('reputation awards reference real tracks', () => {
  for (const [event, table] of Object.entries(REP_AWARDS)) {
    for (const [faction, pair] of Object.entries(table)) {
      assert.ok(REP_TRACKS[faction], `${event} awards unknown faction ${faction}`);
      assert.equal(pair.length, 2, `${event}/${faction} needs [xp, marks]`);
      assert.ok(pair[0] > 0 && pair[1] > 0);
    }
  }
});

test('reputation only ever rises, and advances tiers', () => {
  const rep = new Reputation();
  const fed = rep.track('federation');
  assert.equal(fed.tier, 0);
  const before = fed.xp;
  for (let i = 0; i < 10; i++) rep.recordEvent('colony_saved');
  assert.ok(fed.xp > before);
  assert.ok(fed.tier > 0, 'ten saved colonies means something');
  assert.ok(fed.marks > 0);
});

test('projects are gated by tier and paid for in marks', () => {
  const rep = new Reputation();
  const fed = rep.track('federation');

  // Tier 0: nothing is available yet.
  assert.equal(fed.availableProjects().length, 0);
  assert.ok(fed.lockedProjects().length > 0);

  fed.tier = 1;
  fed.marks = 5;
  const project = fed.availableProjects()[0];
  assert.ok(project, 'tier 1 offers something');
  assert.ok(!fed.canAfford(project), 'five marks is not enough');
  assert.equal(rep.buy('federation', project.id), null, 'cannot buy what you cannot afford');

  fed.marks = 1000;
  const bought = rep.buy('federation', project.id);
  assert.ok(bought, 'now it can be bought');
  assert.equal(fed.marks, 1000 - project.cost, 'marks were spent');
  assert.ok(fed.completed.includes(project.id));
  assert.equal(rep.buy('federation', project.id), null, 'and cannot be bought twice');
});

test('project perks and titles are recorded', () => {
  const rep = new Reputation();
  const fed = rep.track('federation');
  fed.tier = 5;
  fed.marks = 9999;
  const flag = REP_TRACKS.federation.projects.find((p) => p.id === 'fed_t5_command');
  rep.buy('federation', flag.id);
  assert.ok(rep.has('flag_authority'));
  assert.ok(rep.allTitles.includes('Fleet Captain'));
  assert.equal(rep.peakTier, 5);
});

test('reputation round-trips through save and load', () => {
  const rep = new Reputation();
  rep.recordEvent('colony_saved');
  rep.recordEvent('first_contact');
  const kdf = rep.track('klingon');
  kdf.tier = 2; kdf.marks = 200;
  rep.buy('klingon', 'kdf_t2_boarding');

  const restored = Reputation.load(JSON.parse(JSON.stringify(rep.save())));
  assert.equal(restored.track('federation').xp, rep.track('federation').xp);
  assert.equal(restored.track('klingon').marks, rep.track('klingon').marks);
  assert.deepEqual(restored.track('klingon').completed, kdf.completed);
  assert.ok(restored.has('boarding_master'));
});

test('reputation and standing are genuinely independent', () => {
  const g = new Game({ seed: 99n, crewMode: 'original' });
  // Fight the Klingons well: reputation with the KDF rises even as the
  // diplomatic standing falls.
  const repBefore = g.reputation.track('klingon').xp;
  g.earnReputation('fought_while_losing');
  g.ledger.adjustStanding('klingon', -40, 'test');
  assert.ok(g.reputation.track('klingon').xp > repBefore, 'they respect the fight');
  assert.ok(g.ledger.standingOf('klingon') < 0, 'and still want you dead');
});

// ================================================================ away teams

test('away team outcomes are continuous, and still itemised', () => {
  const character = new Character({ careerId: 'science', speciesId: 'vulcan' });
  const officer = new Officer({ station: 'science', name: 'T’Pren', expertise: 90 });
  const team = new AwayTeam([officer], {
    character, difficulty: new DifficultySettings('lieutenant'),
  });

  const { total, parts } = team.modifierFor('science');
  assert.ok(parts.length >= 2, 'the modifier is explained, not just asserted');
  assert.ok(parts.some((p) => p.source === 'T’Pren'), 'the officer contributes');
  assert.ok(Number.isFinite(total));

  const r = team.check(new RNG(1n), 'science', { dc: 12 });
  // No die: a margin, and the terms that produced it.
  assert.equal(r.natural, undefined, 'away missions must not roll a d20 any more');
  assert.equal(typeof r.margin, 'number');
  assert.equal(typeof r.success, 'boolean');
  assert.equal(r.success, r.margin >= 0, 'success must follow from the margin');
  assert.ok(r.formatted.length > 4);
  assert.ok(Number.isFinite(r.capability) && Number.isFinite(r.difficulty));
});

test('every check type maps to a real ability', () => {
  for (const [id, spec] of Object.entries(CHECK_TYPES)) {
    assert.ok(ABILITY_IDS.includes(spec.ability), `${id} -> ${spec.ability}`);
    assert.ok(spec.label && spec.stations.length);
  }
});

test('Story difficulty never kills a named officer on an away mission', () => {
  const character = new Character();
  for (let seed = 0; seed < 40; seed++) {
    const officer = new Officer({ station: 'tactical', name: 'Ensign Ricky', daring: 20 });
    const team = new AwayTeam([officer], {
      character, difficulty: new DifficultySettings('story'), security: 0,
    });
    const rng = new RNG(BigInt(seed));
    for (let i = 0; i < 25; i++) team.check(rng, 'combat', { dc: 25, hazard: 'extreme' });
    assert.ok(officer.alive, `officer died on Story difficulty (seed ${seed})`);
  }
});

test('Fleet Admiral difficulty does kill people', () => {
  const character = new Character();
  let deaths = 0;
  for (let seed = 0; seed < 60; seed++) {
    const officer = new Officer({ station: 'tactical', name: 'Ensign Ricky', daring: 20 });
    const team = new AwayTeam([officer], {
      character, difficulty: new DifficultySettings('fleet_admiral'), security: 0,
    });
    const rng = new RNG(BigInt(seed + 500));
    for (let i = 0; i < 25 && officer.alive; i++) {
      team.check(rng, 'combat', { dc: 25, hazard: 'extreme' });
    }
    if (!officer.alive) deaths++;
  }
  assert.ok(deaths > 0, 'extreme hazard at the hardest difficulty should be lethal');
});

test('a capable captain succeeds more often than an incapable one', () => {
  const weak = new Character({
    baseScores: Object.fromEntries(ABILITY_IDS.map((id) => [id, 8])),
    speciesId: 'human', originId: 'core_world', careerId: 'command',
  });
  const strong = new Character({
    baseScores: Object.fromEntries(ABILITY_IDS.map((id) => [id, 15])),
    speciesId: 'vulcan', originId: 'core_world', careerId: 'science',
  });
  const rate = (character) => {
    let wins = 0;
    const n = 600;
    for (let i = 0; i < n; i++) {
      const team = new AwayTeam([], { character, difficulty: new DifficultySettings('lieutenant') });
      if (team.check(new RNG(BigInt(i)), 'science', { dc: 15, hazard: 'routine' }).success) wins++;
    }
    return wins / n;
  };
  assert.ok(rate(strong) > rate(weak) + 0.15,
    'ability scores must visibly change outcomes');
});

// ================================================================ integration

test('a game built with a character and difficulty is coherent', () => {
  const character = new Character({
    firstName: 'Naomi', lastName: 'Okafor', speciesId: 'andorian',
    originId: 'frontier_colony', careerId: 'tactical', traits: ['cool_under_fire'],
  });
  const g = new Game({ seed: 7n, crewMode: 'original', character, difficulty: 'commander' });

  assert.equal(g.character.name, 'Naomi Okafor');
  assert.equal(g.captain.species, 'Andorian');
  assert.equal(g.difficulty.id, 'commander');
  assert.ok(g.reputation.track('federation'));
  // The tactical Andorian should be shooting better than a default captain.
  const baseline = new Game({ seed: 7n, crewMode: 'original' });
  assert.ok(g.ship.mods.accuracy >= baseline.ship.mods.accuracy);
});

test('difficulty makes hostiles measurably tougher', () => {
  const build = (difficulty) => {
    const g = new Game({ seed: 11n, crewMode: 'original', difficulty });
    const { Ship } = g.ship.constructor === Object ? {} : { Ship: g.ship.constructor };
    const enemy = new Ship('d7', { faction: 'klingon', name: 'Test' });
    g.startCombat([enemy]);
    return enemy;
  };
  const easy = build('cadet');
  const hard = build('admiral');
  assert.ok(hard.maxHull > easy.maxHull, `${hard.maxHull} should exceed ${easy.maxHull}`);
  assert.ok(hard.mods.damage > easy.mods.damage);
});

test('a full game with the new systems round-trips through save and load', () => {
  const character = new Character({
    firstName: 'Toren', lastName: 'Kestrel', speciesId: 'trill',
    originId: 'academy_legacy', careerId: 'diplomatic', traits: ['idealist'],
  });
  const g = new Game({ seed: 13n, crewMode: 'canon', era: 'ds9', character, difficulty: 'captain' });
  g.earnReputation('colony_saved');
  g.earnReputation('first_contact');
  g.reputation.track('federation').marks = 500;
  g.reputation.buy('federation', 'fed_t1_torpedoes');
  g.character.takeFeat('improviser');

  const restored = Game.load(JSON.parse(JSON.stringify(g.save())));
  assert.equal(restored.character.name, 'Toren Kestrel');
  assert.equal(restored.character.speciesId, 'trill');
  assert.ok(restored.character.hasFeat('improviser'));
  assert.deepEqual(restored.character.traits, ['idealist']);
  assert.equal(restored.difficulty.id, 'captain');
  assert.equal(restored.reputation.track('federation').xp, g.reputation.track('federation').xp);
  assert.ok(restored.reputation.track('federation').completed.includes('fed_t1_torpedoes'));
});

test('a version 1 save without a character still loads', () => {
  const g = new Game({ seed: 17n, crewMode: 'original' });
  const data = JSON.parse(JSON.stringify(g.save()));
  delete data.character;
  delete data.reputation;
  delete data.difficulty;
  data.version = 1;

  const restored = Game.load(data);
  assert.ok(restored.character, 'a character sheet is synthesised');
  assert.ok(restored.reputation, 'reputation starts fresh');
  assert.equal(restored.difficulty.id, DEFAULT_DIFFICULTY);
});

// ================================================================ resolution

describe('continuous outcome resolution', () => {
  test('the baseline keeps the tuned difficulty numbers meaning what they meant', () => {
    // This is the bug this suite exists to prevent. Every difficulty number in
    // the game was written against a d20, which contributes 10.5 on average.
    // A swing centred on zero silently subtracts that from every check —
    // when it was missing, a capable science officer's routine survey went from
    // succeeding four times in five to failing nineteen times in twenty.
    const even = resolve(new RNG(7n), { capability: 10, difficulty: 10 });
    assert.ok(even.margin > 0 || even.margin > -13,
      'an evenly matched attempt should not be hopeless');
    assert.ok(Math.abs(successChance(0) - 0.98) < 0.05,
      `capability equal to difficulty should nearly always succeed, got ${successChance(0)}`);
    assert.ok(successChance(-10.5) > 0.45 && successChance(-10.5) < 0.55,
      'a ten-and-a-half point deficit is the coin flip the d20 called DC-equals-modifier');
  });

  test('capability dominates luck, which is the entire point', () => {
    const rng = new RNG(99n);
    const rate = (capability) => {
      let wins = 0;
      for (let i = 0; i < 2000; i++) {
        if (resolve(rng, { capability, difficulty: 15 }).success) wins++;
      }
      return wins / 2000;
    };
    const poor = rate(0);
    const good = rate(8);
    assert.ok(good - poor > 0.4, `capability barely mattered: ${poor} vs ${good}`);
  });

  test('no outcome is ever certain in either direction', () => {
    const rng = new RNG(3n);
    let hopelessWins = 0;
    let trivialLosses = 0;
    for (let i = 0; i < 4000; i++) {
      if (resolve(rng, { capability: 0, difficulty: 30 }).success) hopelessWins++;
      if (!resolve(rng, { capability: 20, difficulty: 5 }).success) trivialLosses++;
    }
    // Rare, but the swing is bounded rather than zero — a hopeless attempt can
    // still come off and a trivial one can still be fumbled.
    assert.ok(hopelessWins < 200, `hopeless work succeeded ${hopelessWins} times in 4000`);
    assert.ok(trivialLosses < 200, `trivial work failed ${trivialLosses} times in 4000`);
  });

  test('training makes an officer more consistent, not merely better', () => {
    const rng = new RNG(11n);
    const spread = (steady) => {
      const margins = [];
      for (let i = 0; i < 3000; i++) {
        margins.push(resolve(rng, { capability: 5, difficulty: 12, steady }).margin);
      }
      const mean = margins.reduce((a, b) => a + b, 0) / margins.length;
      return Math.sqrt(margins.reduce((a, b) => a + (b - mean) ** 2, 0) / margins.length);
    };
    // The thing a flat die could never express.
    assert.ok(spread(0.45) < spread(0) * 0.9,
      `steadiness did not narrow the spread: ${spread(0)} vs ${spread(0.45)}`);
  });

  test('advantage helps and disadvantage hurts', () => {
    const rng = new RNG(5n);
    const rate = (opts) => {
      let wins = 0;
      for (let i = 0; i < 1500; i++) if (resolve(rng, { capability: 3, difficulty: 15, ...opts }).success) wins++;
      return wins / 1500;
    };
    const plain = rate({});
    assert.ok(rate({ advantage: true }) > plain);
    assert.ok(rate({ disadvantage: true }) < plain);
  });

  test('the margin drives the degree and the exceptional flags', () => {
    const rout = resolve(new RNG(1n), { capability: 40, difficulty: 5 });
    assert.equal(rout.success, true);
    assert.equal(rout.criticalSuccess, true);
    assert.ok(rout.degree >= 2);

    const rout2 = resolve(new RNG(1n), { capability: 0, difficulty: 45 });
    assert.equal(rout2.success, false);
    assert.equal(rout2.criticalFailure, true);
  });

  test('the reported margin never contradicts the reported verdict', () => {
    // CI found this one. The margin is rounded for display and success was
    // derived from the unrounded value, so a true margin of -0.02 was shown as
    // "0.0" while reporting failure — and because JavaScript says `-0 >= 0`,
    // the sign did not even give it away. Roughly one attempt in a hundred.
    const rng = new RNG(2024n);
    for (let i = 0; i < 8000; i++) {
      const r = resolve(rng, { capability: 10, difficulty: 20.5 });
      assert.equal(r.success, r.margin >= 0,
        `margin ${r.margin} reported success=${r.success}`);
      assert.ok(!Object.is(r.margin, -0), 'a negative zero reached the card');
    }
  });

  test('resolution is deterministic from the seed, like everything else', () => {
    const a = resolve(new RNG(42n), { capability: 4, difficulty: 13 });
    const b = resolve(new RNG(42n), { capability: 4, difficulty: 13 });
    assert.deepEqual(a, b);
  });

  test('the d20 survives for the character sheet and nowhere else', () => {
    // Ability scores, feats and levels are still a role-playing character
    // sheet. What changed is what resolves an away mission.
    const src = readFileSync(new URL('../src/sim/away.js', import.meta.url), 'utf8');
    assert.ok(!/rules\/dice\.js/.test(src), 'away missions still import the dice');
    const diplo = readFileSync(new URL('../src/sim/diplomacy.js', import.meta.url), 'utf8');
    assert.ok(!/rules\/dice\.js/.test(diplo), 'diplomacy still imports the dice');
    const combat = readFileSync(new URL('../src/sim/combat.js', import.meta.url), 'utf8');
    assert.ok(!/rules\/dice\.js/.test(combat), 'combat still imports the dice');
  });
});

// ------------------------------------- reputation projects deliver what they say

// `reputation.buy` deducts the marks and records the perk. Everything a
// project actually GIVES — the torpedoes, the antimatter, the console, the
// cloaking device nobody signed for — was applied inside src/main.js, so a
// project bought without a screen attached took the payment and handed over
// nothing. The same shape of bug as the whole power tray living in the UI.

/** A captain with enough standing in one track to buy anything in it. */
function flush(trackId, tier = 5) {
  const g = new Game({ seed: 606n, crewMode: 'original' });
  const t = g.reputation.track(trackId);
  t.tier = tier;
  t.marks = 5000;
  return g;
}

test('a reputation project hands over what it promised', () => {
  // Torpedoes, from an empty magazine.
  {
    const g = flush('federation', 1);
    g.ship.torpedoes = 0;
    const r = g.buyProject('federation', 'fed_t1_torpedoes');
    assert.ok(r.ok, r.reason);
    assert.ok(g.ship.torpedoes > 0, 'the magazine is still empty');
    assert.ok(r.lines.length > 0, 'nothing was said about it');
  }
  // A console, into stores. It arrives in inventory rather than fitted: what
  // hangs in which slot is the captain's decision, not the quartermaster's.
  {
    const g = flush('federation', 1);
    const before = g.loadout.inventory.length;
    assert.ok(g.buyProject('federation', 'fed_t1_console').ok);
    assert.ok(g.loadout.inventory.length > before, 'the console never arrived');
    assert.ok(g.loadout.inventory.includes('shield_emitters'));
  }
  // The Romulan cloak, which is a capability the ship did not have.
  {
    const g = flush('romulan', 3);
    assert.equal(g.ship.cloakCapable, false, 'a Constitution came with a cloak');
    assert.ok(g.buyProject('romulan', 'rom_t3_cloak').ok);
    assert.equal(g.ship.cloakCapable, true, 'the cloaking device was never installed');
    assert.ok(g.reputation.has('cloak'));
  }
  // And a title is recorded on the track.
  {
    const g = flush('klingon', 5);
    assert.ok(g.buyProject('klingon', 'kdf_t5_ally').ok);
    assert.ok(g.reputation.allTitles.includes('Friend of the Empire'));
  }
});

test('a project cannot be bought twice, or without the marks', () => {
  const g = flush('federation', 1);
  assert.ok(g.buyProject('federation', 'fed_t1_torpedoes').ok);
  assert.equal(g.buyProject('federation', 'fed_t1_torpedoes').ok, false, 'bought twice');

  const poor = new Game({ seed: 607n, crewMode: 'original' });
  poor.reputation.track('federation').tier = 1;
  poor.reputation.track('federation').marks = 0;
  assert.equal(poor.buyProject('federation', 'fed_t1_torpedoes').ok, false, 'bought on credit');

  assert.equal(g.buyProject('federation', 'no_such_project').ok, false);
  assert.equal(g.buyProject('no_such_track', 'fed_t1_torpedoes').ok, false);
});

test('every project in every track can be bought and pays out', () => {
  // The whole table, so a grant shape nobody handles cannot be added quietly.
  for (const [trackId, track] of Object.entries(REP_TRACKS)) {
    for (const p of track.projects ?? []) {
      const g = flush(trackId);
      const r = g.buyProject(trackId, p.id);
      assert.ok(r.ok, `${trackId}/${p.id}: ${r.reason}`);
      // A perk-only project has nothing to announce, and that is fine — the
      // perk itself is the payload and the set is what reads it.
      if (p.grant?.perk) assert.ok(g.reputation.has(p.grant.perk), `${p.id} granted no perk`);
      if (p.grant?.title) assert.ok(g.reputation.allTitles.includes(p.grant.title));
      if (p.grant?.console || p.grant?.torpedoes || p.grant?.antimatter || p.grant?.title) {
        assert.ok(r.lines.length > 0, `${p.id} delivered silently`);
      }
    }
  }
});
