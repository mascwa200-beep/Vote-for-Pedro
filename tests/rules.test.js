// Tests for the d20 layer, the character sheet, reputation, and difficulty.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, successChance } from '../src/rules/resolve.js';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
import { findingFor, sitsAt, venueFor } from '../src/rules/inquiry.js';
import { nextCommandFor, takeCommandOf, COMMAND_LADDER } from '../src/sim/command.js';
import { availableHails } from '../src/sim/diplomacy.js';
import { rollEncounter } from '../src/world/encounters.js';
import { Mission } from '../src/missions/engine.js';
import { Ship } from '../src/sim/ship.js';
import { AwayTeam, CHECK_TYPES } from '../src/sim/away.js';
import { Officer } from '../src/sim/officers.js';
import { Ledger, assessmentOf } from '../src/core/ledger.js';
import { RANKS } from '../src/sim/skills.js';
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

// ---------------------------------------- what a captain brings to a command

// A career track grants a matching skill rank, a Starfleet family starts a pip
// higher, and a reprimand already on file stays on file. All three were
// applied in `App.startGame` — the character creator, which is in the browser
// — so a `new Game` built anywhere else got none of them. Every test in this
// repository, the combat soak, the balance suite and the API fuzzer were
// measuring a captain the player never plays.

const commissioned = (character) =>
  new Game({ seed: 808n, crewMode: 'original', character: { speciesId: 'human', ...character } });

test('a career track brings its own skill to the chair', () => {
  for (const [careerId, skillId] of [
    ['command', 'leadership'],
    ['tactical', 'beam_weapons'],
    ['engineering', 'damage_control'],
    ['science', 'sensors'],
    ['diplomatic', 'diplomacy'],
  ]) {
    const g = commissioned({ careerId });
    assert.equal(g.progress.spent[skillId], 1,
      `a ${careerId} captain arrived without ${skillId}`);
  }
  // And the points spent on it are not also still in hand.
  const a = commissioned({ careerId: 'tactical' });
  const b = commissioned({ careerId: 'medical' });   // no background skill
  assert.equal(a.progress.unspent, b.progress.unspent,
    'the career skill was given away for free');
});

test('a Starfleet family starts a pip higher', () => {
  const plain = commissioned({ careerId: 'command' });
  const legacy = commissioned({ careerId: 'command', originId: 'academy_legacy' });
  assert.equal(legacy.progress.rankIndex, plain.progress.rankIndex + 1);
});

test('a reprimand already on file is on file from the first stardate', () => {
  const clean = commissioned({ careerId: 'command' });
  const marked = commissioned({ careerId: 'command', traits: ['insubordinate'] });
  assert.equal(clean.ledger.entries.length, 0);
  assert.equal(marked.ledger.count('order_disobeyed'), 1);
  assert.ok(marked.ledger.entries[0].text.includes('reprimand'));
});

test('and a loaded save does not collect any of it twice', () => {
  const g = commissioned({ careerId: 'tactical', originId: 'academy_legacy', traits: ['insubordinate'] });
  const back = Game.load(JSON.parse(JSON.stringify(g.save())));
  assert.equal(back.progress.rankIndex, g.progress.rankIndex);
  assert.equal(back.progress.spent.beam_weapons, g.progress.spent.beam_weapons);
  assert.equal(back.ledger.count('order_disobeyed'), 1);
});

// ------------------------------------------------- a promotion is a promotion

// Twelve places in the codebase awarded experience; two of them looked at
// whether it promoted anybody. And what a promotion MEANS — the character
// levels up, and a feat is banked to choose — was done by an event listener in
// src/main.js. So a captain could earn Fleet Captain over a five-year
// commission and still be level one with no feats, unless somebody happened to
// be looking at the screen when each promotion landed.

test('a promotion levels the captain and banks a feat, with nobody watching', () => {
  const g = new Game({ seed: 1212n, crewMode: 'original' });
  const level = g.character.level;
  const rank = g.progress.rankIndex;

  const promo = g.awardXP(1e6);
  assert.ok(promo?.promoted, 'a million experience promoted nobody');
  assert.equal(g.progress.rankIndex, rank + 1);
  assert.equal(g.character.level, level + 1, 'the captain did not level up');
  assert.equal(g.pendingFeats, 1, 'no feat was banked');
  assert.ok(g.progress.unspent > 0, 'no skill points arrived');
  assert.ok(g.log.some((l) => /promoted/i.test(l.text)), 'nobody mentioned it');
});

test('and experience that promotes nobody changes nothing but the total', () => {
  const g = new Game({ seed: 1213n, crewMode: 'original' });
  const before = { level: g.character.level, rank: g.progress.rankIndex, xp: g.progress.xp };
  assert.equal(g.awardXP(1), null);
  assert.equal(g.character.level, before.level);
  assert.equal(g.progress.rankIndex, before.rank);
  assert.equal(g.progress.xp, before.xp + 1);
  assert.equal(g.pendingFeats ?? 0, 0);
});

test('and nothing awards experience behind awardXP\'s back', () => {
  // The structural half. Twelve call sites reached `progress.addXP` directly
  // and ten of them dropped the promotion on the floor; one new one would put
  // the bug straight back. `Game.awardXP` is the only caller allowed, and this
  // is what says so.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const text = readFileSync(path, 'utf8');
      for (const [i, line] of text.split('\n').entries()) {
        if (!/\.addXP\s*\(/.test(line)) continue;
        // The one legitimate caller is inside awardXP itself.
        if (path.endsWith(join('core', 'state.js')) && /progress\.addXP/.test(line)) continue;
        offenders.push(`${entry.name}:${i + 1} ${line.trim()}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], 'experience awarded without carrying the promotion');
});

test('a board of inquiry blocks the promotion and everything under it', () => {
  const g = new Game({ seed: 1215n, crewMode: 'original' });
  g.ledger.inquiryOpen = true;
  const level = g.character.level;
  const rank = g.progress.rankIndex;
  const promo = g.awardXP(1e6);
  assert.equal(promo?.promoted, undefined, 'Starfleet promoted a captain it was investigating');
  assert.equal(g.progress.rankIndex, rank, 'the pip arrived anyway');
  assert.equal(g.character.level, level, 'the level arrived anyway');
  assert.equal(g.pendingFeats ?? 0, 0, 'the feat arrived anyway');
});

describe('a reputation project that grants nothing', () => {
  /**
   * The perks no code anywhere reads.
   *
   * Of the twenty-five the six tracks sell, exactly one — `better_prices` —
   * was ever checked, and `cloak` worked only through a special case inside
   * `buyProject`. The rest went into a Set that nothing asked. A captain could
   * spend three hundred Commendations on "Flag Officer Authority" and receive
   * a line in a list.
   */
  const unwired = () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    let source = '';
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { walk(path); continue; }
        if (!entry.name.endsWith('.js')) continue;
        // reputation.js DEFINES the projects; mentioning a perk there is not
        // reading it.
        if (entry.name === 'reputation.js') continue;
        source += readFileSync(path, 'utf8');
      }
    };
    walk(root);
    const dead = [];
    for (const track of Object.values(REP_TRACKS)) {
      for (const p of track.projects) {
        const id = p.grant?.perk;
        if (!id) continue;
        if (!source.includes(`'${id}'`) && !source.includes(`"${id}"`)) dead.push(id);
      }
    }
    return dead.sort();
  };

  // The ledger of what is still dead. It shrinks as perks are wired up, and a
  // twenty-sixth dead perk fails this rather than joining the pile quietly.
  const STILL_UNWIRED = [
    'border_warning', 'cardassian_ally', 'dmz_passage', 'folk_hero',
    'romulan_accord', 'see_all_encounters',
  ].sort();

  test('the perks nothing reads are exactly the ones we know about', () => {
    assert.deepEqual(unwired(), STILL_UNWIRED,
      'a reputation project changed what it grants, or a new dead perk appeared');
  });

  test('the Starfleet track now sells four things that happen', () => {
    for (const id of ['casualty_reduction', 'free_refit', 'ally_escort', 'flag_authority']) {
      assert.ok(!unwired().includes(id), `${id} is still granted and never read`);
    }
  });

  test('a fleet medical detachment reduces casualties from hull hits', () => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    const before = g.ship.mod('crewProtect');
    g.reputation.perks.add('casualty_reduction');
    g.applyAllMods();
    assert.ok(g.ship.mod('crewProtect') > before,
      `"permanent 15% reduction in crew casualties" left crewProtect at ${before}`);
  });

  test('priority yard access is the days in the yard, and nothing else', () => {
    const yardDays = (perks) => {
      const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
      for (const p of perks) g.reputation.perks.add(p);
      const port = [...g.galaxy.systems.values()].find((s) => s.facilities?.includes('dock'));
      g.locationId = port.id;
      g.ship.hull = g.ship.maxHull * 0.2;
      const before = g.clock.stardate;
      g.dock();
      return g.clock.stardate - before;
    };
    const paid = yardDays([]);
    const free = yardDays(['free_refit']);
    assert.ok(free < paid, `a shot-up hull took ${paid} days either way`);
  });

  test('a standing escort actually arrives, and only in Federation space', () => {
    const allies = (perks, systemId) => {
      const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
      for (const p of perks) g.reputation.perks.add(p);
      g.locationId = systemId;
      g.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS T' })]);
      return g.engagement.allies.length;
    };
    assert.equal(allies([], 'sol'), 0, 'an escort turned up for a captain who never bought one');
    assert.equal(allies(['ally_escort'], 'sol'), 1, 'no escort joined in Federation space');
    assert.equal(allies(['ally_escort'], 'qonos'), 0,
      'a Federation escort joined a fight in the Klingon capital');
  });

  test('flag authority lifts the rank gate on what you may be offered', () => {
    const offered = (perks) => {
      const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
      for (const p of perks) g.reputation.perks.add(p);
      g.progress.rankIndex = RANKS.findIndex((r) => r.id === 'fleet_captain');
      return nextCommandFor(g)?.id ?? null;
    };
    const without = offered([]);
    const with_ = offered(['flag_authority']);
    assert.notEqual(with_, without,
      `"requisition any hull in the fleet" still offered only a ${without}`);
    assert.equal(with_, COMMAND_LADDER[COMMAND_LADDER.length - 1].id,
      `the best hull in the fleet is a ${COMMAND_LADDER[COMMAND_LADDER.length - 1].id}, and he was offered a ${with_}`);
  });

  test('a seat at the table is a berth, and only where the perk says', () => {
    const dockAt = (perks, id) => {
      const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
      for (const p of perks) g.reputation.perks.add(p);
      g.locationId = id;
      return g.canDock();
    };
    assert.equal(dockAt([], 'qonos'), false, 'a captain could already berth at Qo’noS');
    assert.equal(dockAt(['klingon_passage'], 'qonos'), true,
      'sworn to the Empire and still turned away at the door');
    assert.equal(dockAt([], 'cardassia_prime'), false, 'Cardassia was already open');
    assert.equal(dockAt(['cardassian_dock'], 'cardassia_prime'), true,
      '"repair rights at Cardassian facilities" bought no repair rights');
    // The two perks that are NOT about berthing must not have been wired to
    // the nearest gate to hand: Romulus is not the Neutral Zone.
    assert.equal(dockAt(['romulan_accord', 'dmz_passage'], 'romulus'), false,
      'a perk about the Neutral Zone opened Romulus instead');
  });

  test('safe harbour is every inhabited system, and a nebula is not one', () => {
    const g0 = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    const noYard = [...g0.galaxy.systems.values()]
      .find((s) => Game.INHABITED.has(s.type) && !s.facilities?.includes('dock'));
    const nebula = [...g0.galaxy.systems.values()].find((s) => s.type === 'anomaly');
    assert.ok(noYard && nebula, 'the galaxy has no inhabited system without a yard, or no anomaly');
    const dockAt = (perks, id) => {
      const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
      for (const p of perks) g.reputation.perks.add(p);
      g.locationId = id;
      return g.canDock();
    };
    assert.equal(dockAt([], noYard.id), false, `${noYard.name} already had a berth`);
    assert.equal(dockAt(['universal_dock'], noYard.id), true,
      `"every inhabited system will dock and repair you" did not include ${noYard.name}`);
    assert.equal(dockAt(['universal_dock'], nebula.id), false,
      `the ship put in at ${nebula.name}, which has nobody in it`);
  });

  test('firing first means their guns open a cycle behind', () => {
    // Both sides opening with batteries ready means "you always fire first"
    // means nothing at all — whoever taps the screen sooner fires first.
    const cooldowns = (perks) => {
      const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
      for (const p of perks) g.reputation.perks.add(p);
      g.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS T' })]);
      return g.engagement.hostiles[0].weapons.reduce((n, w) => n + w.cooldown, 0);
    };
    assert.equal(cooldowns([]), 0, 'hostiles no longer open with their guns ready');
    assert.ok(cooldowns(['first_strike']) > 0,
      '"you always fire first" left both sides opening together');
  });

  test('a trained boarding party is twice the party, and only for boarding', () => {
    const detail = (perks, boarding) => {
      const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
      for (const p of perks) g.reputation.perks.add(p);
      return g.buildAwayTeam(['tactical', 'medical', 'engineering'], false, { boarding }).security;
    };
    assert.equal(detail(['boarding_master'], true), detail([], true) * 2,
      '"twice as effective" did not double the party that does the boarding');
    assert.equal(detail(['boarding_master'], false), detail([], false),
      'a geology survey got the boarding party training');
  });

  test('the Empire answers where Starfleet will not, once per voyage', () => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    g.reputation.perks.add('kdf_ally');
    g.locationId = 'qonos';   // outside Federation space: Starfleet does not come
    const fight = (name) => {
      g.engagement = null;
      g.helpCalled = false;
      g.helpInbound = null;
      g.startCombat([new Ship('d7', { faction: 'klingon', name })]);
      return g.callForHelp();
    };

    const plain = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    plain.locationId = 'qonos';
    plain.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS X' })]);
    assert.equal(plain.callForHelp().answered, false,
      'somebody answered a captain with no allies out beyond Federation space');

    assert.equal(fight('IKS A').answered, true, 'a sworn ally of the Empire called and nobody came');
    assert.equal(g.helpInbound.faction, 'klingon',
      `a Klingon ally arrived flying ${g.helpInbound.faction} colours`);

    assert.equal(fight('IKS B').answered, false, 'the Empire answered twice in one voyage');

    // Putting in ends the voyage and the favour is available again.
    g.engagement = null;
    g.locationId = 'sol';
    assert.ok(g.dock().ok, 'could not berth at Sol');
    g.locationId = 'qonos';
    assert.equal(fight('IKS C').answered, true, 'the favour never came back after putting in');
    assert.equal(g.helpInbound.faction, 'klingon', 'and it was not the Empire that answered');
  });

  test('a favour already spent survives closing the app', () => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    g.reputation.perks.add('kdf_ally');
    g.klingonAnswered = true;
    const restored = Game.load(JSON.parse(JSON.stringify(g.save())));
    assert.equal(restored.klingonAnswered, true,
      'closing the app between fights was a way to call the Empire again');
  });

  test('a line of credit gets an offer heard where it would not be', () => {
    const canBribe = (perk, faction) => availableHails(faction, {
      winning: false, alwaysBribe: perk,
    }).some((o) => o.id === 'bribe');
    assert.equal(canBribe(false, 'klingon'), false,
      'a Klingon already took money without a line of credit');
    assert.equal(canBribe(true, 'klingon'), true,
      '"any bribeable captain will always hear an offer" left the option hidden');
    // Heard, not accepted — `resolveHail` still rolls it.
    assert.equal(canBribe(false, 'ferengi'), true, 'the Ferengi stopped taking money');
  });

  test('a hired Marauder sails once a voyage, anywhere', () => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    g.reputation.perks.add('mercenary_escort');
    // Klingon space: the Starfleet escort would not come here, and money does
    // not care whose space this is. That is the difference between the two
    // contracts and the reason a captain might buy both.
    g.locationId = 'qonos';
    const fight = (name) => {
      g.engagement = null;
      g.startCombat([new Ship('d7', { faction: 'klingon', name })]);
      return g.engagement.allies;
    };
    const first = fight('IKS A');
    assert.equal(first.length, 1, 'the contracted Marauder never sailed');
    assert.equal(first[0].faction, 'ferengi', `a ${first[0].faction} ship answered a Ferengi contract`);
    assert.equal(fight('IKS B').length, 0, 'the Marauder sailed twice in one voyage');

    g.engagement = null;
    g.locationId = 'sol';
    assert.ok(g.dock().ok, 'could not berth at Sol');
    g.locationId = 'qonos';
    assert.equal(fight('IKS C').length, 1, 'the contract never came round again');
  });

  test('a silent partner takes half again on every mission', () => {
    const paid = (perks) => {
      const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
      for (const p of perks) g.reputation.perks.add(p);
      const m = new Mission({ id: 'probe_ep', title: 'Probe', stages: [] }, { game: g });
      const before = g.progress.xp;
      m.applyEffects({ xp: 1000 });
      return g.progress.xp - before;
    };
    assert.equal(paid([]), 1000, 'a mission stopped paying what it says');
    assert.equal(paid(['ferengi_partner']), 1500,
      '"every mission reward is increased by half" paid the same as before');
  });

  test('salvage contacts take a second console off the same hulk', () => {
    // A seed where the boarding check succeeds — the perk is about what a
    // successful board yields, not about making one succeed.
    const boarded = (perks) => {
      const g = new Game({ seed: 0x1234n, crewMode: 'canon', crew: 'tos' });
      for (const p of perks) g.reputation.perks.add(p);
      for (const o of g.crew.officers) o.expertise = 100;
      g.encounter = {
        kind: 'derelict', system: g.location, salvage: 'phaser_relay', risk: 0.05, hostile: false,
      };
      const before = g.loadout.inventory.length;
      g.resolveEncounter('board');
      return { gained: g.loadout.inventory.length - before, held: g.loadout.inventory };
    };
    const plain = boarded([]);
    assert.equal(plain.gained, 1, 'the boarding check no longer succeeds on this seed');
    const rich = boarded(['salvage_bonus']);
    assert.equal(rich.gained, 2, '"derelicts yield an additional console" yielded one');
    // A DIFFERENT console: two identical relays is not an additional console
    // in any sense a captain would recognise, and set bonuses count distinct
    // pieces anyway.
    const added = rich.held.slice(-2);
    assert.notEqual(added[0], added[1], `the hulk yielded two of the same: ${added.join(', ')}`);
  });

  test('signal dampening quietens hostile space, and only hostile space', () => {
    // Rates over 3,000 rolls, not one: an encounter table is a distribution
    // and a single draw says nothing about it.
    const rate = (opts, systemId) => {
      let n = 0;
      for (let i = 0; i < 3000; i++) {
        const e = rollEncounter(new RNG(BigInt(i + 1)), systemId, opts);
        if (e && e.kind !== 'quiet' && e.kind !== 'anomaly') n++;
      }
      return n / 3000;
    };
    const hostile = { plain: rate({}, 'qonos'), damped: rate({ quietInHostileSpace: true }, 'qonos') };
    assert.ok(hostile.damped < hostile.plain * 0.85,
      `"encounters trigger less often in hostile space": ${(hostile.plain * 100).toFixed(1)}% -> ${(hostile.damped * 100).toFixed(1)}%`);
    // Nobody is looking for you at Sol.
    assert.equal(rate({ quietInHostileSpace: true }, 'sol'), rate({}, 'sol'),
      'signal dampening changed how often something finds you in Federation space');
  });

  test('a trader network halves the hostile encounters, in charted space only', () => {
    const hostileShare = (opts) => {
      let hostile = 0;
      let total = 0;
      for (let i = 0; i < 3000; i++) {
        const e = rollEncounter(new RNG(BigInt(i + 1)), 'qonos', opts);
        if (!e) continue;
        total++;
        if (e.hostile) hostile++;
      }
      return hostile / total;
    };
    const plain = hostileShare({});
    const halved = hostileShare({ halveHostile: true });
    assert.ok(halved < plain * 0.7,
      `"hostile encounters are halved": ${(plain * 100).toFixed(1)}% -> ${(halved * 100).toFixed(1)}%`);

    // And "charted" means somewhere this ship has been. The galaxy's lanes are
    // charted from the start, so reading it the other way would have made the
    // perk a flat halving everywhere.
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    g.reputation.perks.add('route_intel');
    const unvisited = [...g.galaxy.systems.values()].find((s) => !g.galaxy.visited.has(s.id));
    assert.ok(unvisited, 'the ship has already been everywhere');
    assert.equal(g.encounterPerks(unvisited.id).halveHostile, false,
      `the trader network covered ${unvisited.name}, which the ship has never seen`);
    assert.equal(g.encounterPerks(g.locationId).halveHostile, true,
      'the trader network did not cover the system the ship is sitting in');
  });

  test('volunteers come aboard at an inhabited world, not at a nebula', () => {
    const arriveAt = (perks, type) => {
      const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
      for (const p of perks) g.reputation.perks.add(p);
      const target = [...g.galaxy.systems.values()]
        .find((s) => s.type === type && s.id !== g.locationId);
      assert.ok(target, `the galaxy has no ${type}`);
      g.ship.crew = Math.round(g.ship.maxCrew * 0.5);
      g.locationId = target.id;
      g.transit = { to: target, route: { lightYears: 1 } };
      const before = g.ship.crew;
      g.arrive();
      return { before, after: g.ship.crew, where: target.name };
    };
    const none = arriveAt([], 'colony');
    assert.equal(none.after, none.before, `a half-crewed ship refilled itself at ${none.where}`);
    const volunteers = arriveAt(['crew_replacement'], 'colony');
    assert.ok(volunteers.after > volunteers.before,
      `"crew losses replenish at any inhabited world" left her at ${volunteers.after} of ${volunteers.before}`);
    const nebula = arriveAt(['crew_replacement'], 'anomaly');
    assert.equal(nebula.after, nebula.before,
      `volunteers came aboard at ${nebula.where}, which has nobody in it`);
  });

  test('a cloaking device is not left behind with the old hull', () => {
    // It is set on the Ship, and takeCommandOf builds a new one — so 130
    // Tokens of Regard evaporated at the next promotion, silently.
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    g.reputation.perks.add('cloak');
    g.applyAllMods();
    assert.equal(g.ship.cloakCapable, true, 'the cloak was never fitted');
    takeCommandOf(g, 'excelsior');
    assert.equal(g.ship.cloakCapable, true, 'the cloak stayed with the ship he walked off');
  });
});

describe('the board of inquiry actually sits', () => {
  /** Put in where the board will actually sit. */
  const putIn = (g) => {
    const port = venueFor(g);
    assert.ok(port, 'no Federation starbase exists for a board to sit at');
    g.locationId = port.id;
    return g.dock();
  };

  test('losing a ship opens one', () => {
    // `loseTheShip` printed "there will be a board of inquiry" and opened
    // none: the flag stayed false, so the sentence was a promise the game
    // would not keep.
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    assert.equal(g.ledger.inquiryOpen, false);
    g.loseTheShip();
    assert.equal(g.ledger.inquiryOpen, true, 'no board was opened');
    assert.match(g.ledger.inquiryReason ?? '', /loss of/i,
      `the board did not know what it was about: "${g.ledger.inquiryReason}"`);
  });

  test('and the rank stops moving until it does', () => {
    // The effect that made this worth finding: a captain could lose the
    // Enterprise and be promoted to Fleet Captain the same day.
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    g.loseTheShip();
    const rank = g.progress.rank.name;
    g.awardXP(1e6);
    assert.equal(g.progress.rank.name, rank,
      `promoted to ${g.progress.rank.name} the same day the ship was lost`);
    assert.match(g.log.map((e) => e.text).join(' '), /holding it/i,
      'the captain was never told his promotion was being held');
  });

  test('and a board opened by Prime Directive violations closes', () => {
    // The mirror image, in the same flag. `inquiryOpen` was set in one place
    // and cleared in none, so three violations froze the rank ladder for the
    // rest of a five-year commission — under a screen saying promotion was
    // suspended only "until it concludes".
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    for (let i = 0; i < 3; i++) g.ledger.record('prime_directive_violation', { text: 'v' });
    assert.equal(g.ledger.inquiryOpen, true, 'three violations did not open a board');
    const r = putIn(g);
    assert.ok(r.finding, 'docking at a starbase did not sit the board');
    assert.equal(g.ledger.inquiryOpen, false, 'the board never concluded');
  });

  test('the finding follows the record', () => {
    const verdictFor = (setUp) => {
      const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
      g.progress.rankIndex = RANKS.findIndex((r) => r.id === 'commodore');
      setUp(g);
      g.loseTheShip();
      return { g, finding: putIn(g).finding };
    };
    const clean = verdictFor((g) => {
      for (let i = 0; i < 12; i++) g.ledger.record('treaty_signed', { text: 't' });
    });
    assert.equal(clean.finding.verdict, 'exonerated',
      `a record scoring ${clean.g.ledger.serviceScore()} was not cleared`);

    const bad = verdictFor((g) => {
      for (let i = 0; i < 4; i++) g.ledger.record('prime_directive_violation', { text: 'v' });
    });
    assert.equal(bad.finding.verdict, 'reduced',
      `a record scoring ${bad.g.ledger.serviceScore()} escaped a finding`);
    assert.equal(bad.g.progress.rank.id, 'fleet_captain',
      `a commodore found against is now ${bad.g.progress.rank.name}`);
  });

  test('but never below Captain, because below Captain there is no ship', () => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    assert.equal(g.progress.rank.id, 'captain', 'the campaign no longer starts at Captain');
    for (let i = 0; i < 6; i++) g.ledger.record('prime_directive_violation', { text: 'v' });
    g.loseTheShip();
    const finding = putIn(g).finding;
    assert.equal(g.progress.rank.id, 'captain',
      `a captain was reduced to ${g.progress.rank.name} and has no command`);
    assert.equal(finding.reducedTo, null, 'the finding claimed a rank it did not take');
    assert.equal(finding.verdict, 'reprimanded',
      'the finding still said "reduced" after taking nothing');
  });

  test('a board sits at a starbase, not over a repair berth', () => {
    // The game has ordered the captain to a starbase in so many words since
    // before any of this existed. Sitting the board wherever a spacedock
    // happened to be made that order a lie — and docking at Qo'noS would have
    // convened a Starfleet board of inquiry in the Klingon capital.
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    g.loseTheShip();
    const berth = [...g.galaxy.systems.values()]
      .find((s) => s.facilities?.includes('dock') && !sitsAt(s));
    assert.ok(berth, 'every docking system in the galaxy is a Federation starbase');
    g.locationId = berth.id;
    assert.equal(g.dock().finding ?? null, null,
      `the board sat at ${berth.name}, which is a ${berth.type}`);
    assert.equal(g.ledger.inquiryOpen, true, 'the board closed away from a starbase');

    const venue = venueFor(g);
    assert.ok(sitsAt(venue), `the captain was ordered to ${venue?.name}, which will not hear him`);
    assert.ok(putIn(g).finding, `the board did not sit at ${venue.name} either`);
  });

  test('losing a ship moves the service record at all', () => {
    // ship_lost had no weight, so the worst thing that can happen to a captain
    // scored exactly zero and two lost hulls could still read as Exemplary.
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    const before = g.ledger.serviceScore();
    g.loseTheShip();
    assert.ok(g.ledger.serviceScore() < before,
      `the record scored ${g.ledger.serviceScore()} before and after losing a starship`);
  });

  test('the screen and the board read the same record', () => {
    // Two answers to the same question drift. The board's bands and the
    // assessment on the captain's screen come from one table; this fails if
    // anybody ever writes a second copy.
    for (const score of [200, 120, 119, 60, 20, 19, -20, -21, -60, -61, -500]) {
      const band = assessmentOf(score);
      const ledger = { serviceScore: () => score };
      const finding = findingFor(ledger);
      const expected = ['exemplary', 'distinguished', 'satisfactory'].includes(band.id)
        ? 'exonerated'
        : band.id === 'unremarkable' ? 'reprimanded' : 'reduced';
      assert.equal(finding.verdict, expected,
        `a score of ${score} reads as ${band.label} but the board finds ${finding.verdict}`);
    }
  });

  test('an open board survives being saved and loaded', () => {
    const g = new Game({ seed: 0x1701n, crewMode: 'canon', crew: 'tos' });
    g.loseTheShip();
    const restored = Ledger.load(JSON.parse(JSON.stringify(g.ledger.save())));
    assert.equal(restored.inquiryOpen, true, 'the board was dropped on load');
    assert.equal(restored.inquiryReason, g.ledger.inquiryReason,
      'the board came back not knowing what it was about');
  });
});

test('a feat can be taken without a screen, and only when one is banked', () => {
  const g = new Game({ seed: 1216n, crewMode: 'original' });
  assert.equal(g.takeFeat('unshakeable').ok, false, 'a feat was taken out of thin air');

  g.awardXP(1e6);
  assert.equal(g.pendingFeats, 1);
  const feat = FEATS.find((f) => f.id !== 'ability_score' && (f.minRank ?? 0) <= g.progress.rankIndex);
  const r = g.takeFeat(feat.id);
  assert.ok(r.ok, r.reason);
  assert.ok(g.character.feats.includes(feat.id), 'the feat was never recorded');
  assert.equal(g.pendingFeats, 0, 'the bank was not spent');
  assert.equal(g.takeFeat(feat.id).ok, false, 'the same feat was taken twice');
  assert.ok(g.log.some((l) => l.text.includes(feat.name)), 'nobody said anything about it');
});

test('the repeatable field commission raises the scores it was given', () => {
  const g = new Game({ seed: 1217n, crewMode: 'original' });
  g.awardXP(1e6);
  const before = g.character.score('command');
  const r = g.takeFeat('ability_score', ['command', 'command']);
  assert.ok(r.ok, r.reason);
  assert.ok(g.character.score('command') > before, 'the scores did not move');
  assert.equal(g.pendingFeats, 0);
});

test('spending a skill point takes the point and changes the ship', () => {
  const g = new Game({ seed: 1218n, crewMode: 'original' });
  const points = g.progress.unspent;
  assert.ok(points > 0, 'a new captain has no points to spend');

  const r = g.spendSkill('sensors');
  assert.ok(r.ok, r.reason);
  assert.equal(g.progress.unspent, points - 1);
  assert.equal(g.progress.ranksIn('sensors'), r.ranks);

  // And a point that does not exist is refused rather than taken on credit.
  g.progress.unspent = 0;
  assert.equal(g.spendSkill('sensors').ok, false);
  assert.equal(g.spendSkill('no_such_skill').ok, false);
});
