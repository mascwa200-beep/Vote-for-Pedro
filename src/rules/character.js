// The captain as a character sheet.
//
// Six ability scores, a species, an origin, a background, personal traits, and
// feats earned on promotion. Every one of these is load-bearing: scores feed
// the d20 modifiers, species and origin shift the scores, traits alter checks
// in named situations, and feats change what you are allowed to attempt.

import { abilityMod, proficiencyBonus } from './dice.js';

// ---------------------------------------------------------------- abilities

/**
 * Trek-shaped abilities rather than the tabletop six. Each maps to things a
 * captain actually does, and each is used by at least three systems.
 */
export const ABILITIES = [
  {
    id: 'command', name: 'Command', abbr: 'CMD',
    description: 'Presence, decisiveness, and the authority to be obeyed under fire.',
    governs: 'Officer cooldowns, crew morale, rally effects, and contested wills.',
  },
  {
    id: 'tactics', name: 'Tactics', abbr: 'TAC',
    description: 'Reading an engagement and knowing where the other captain will be.',
    governs: 'Weapon accuracy, critical chance, and boarding actions.',
  },
  {
    id: 'engineering', name: 'Engineering', abbr: 'ENG',
    description: 'Understanding the machine well enough to talk it out of failing.',
    governs: 'Repair speed, power routing, warp efficiency, and jury-rigging.',
  },
  {
    id: 'science', name: 'Science', abbr: 'SCI',
    description: 'Analysis, anomalies, and noticing the detail that changes the problem.',
    governs: 'Scans, anomaly research, cloak detection, and technical solutions.',
  },
  {
    id: 'medicine', name: 'Medicine', abbr: 'MED',
    description: 'Keeping people alive, which is most of what the job turns out to be.',
    governs: 'Casualty rates, officer recovery, and away-team survival.',
  },
  {
    id: 'diplomacy', name: 'Diplomacy', abbr: 'DIP',
    description: 'Persuasion, protocol, and knowing which silence to leave alone.',
    governs: 'Hails, negotiations, first contact, and reputation gains.',
  },
];

export const ABILITY_IDS = ABILITIES.map((a) => a.id);
export const ABILITY_BY_ID = Object.fromEntries(ABILITIES.map((a) => [a.id, a]));

/** Point-buy costs, 8 through 15, as in the tabletop standard. */
export const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;
export const ABILITY_HARD_CAP = 20;

export function pointBuyCost(scores) {
  return ABILITY_IDS.reduce((n, id) => n + (POINT_BUY_COST[scores[id]] ?? 0), 0);
}

/** The classic array, for players who would rather not do arithmetic. */
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

// ---------------------------------------------------------------- species

export const PLAYER_SPECIES = [
  {
    id: 'human', name: 'Human',
    bonuses: { command: 1, diplomacy: 1, science: 1 },
    trait: 'Adaptable',
    traitText: 'Once per away mission, reroll a failed check.',
    mechanic: { rerollPerMission: 1 },
    description: 'Unremarkable at everything and unreasonably good at recovering from it.',
  },
  {
    id: 'vulcan', name: 'Vulcan',
    bonuses: { science: 2, engineering: 1 },
    penalties: { diplomacy: -1 },
    trait: 'Logical Discipline',
    traitText: 'Advantage on Science checks. Immune to fear and morale effects.',
    mechanic: { advantageOn: ['science'], fearImmune: true },
    description: 'Superior strength, superior recall, and no patience for a hunch.',
  },
  {
    id: 'andorian', name: 'Andorian',
    bonuses: { tactics: 2, command: 1 },
    penalties: { diplomacy: -1 },
    trait: 'Keth Honour',
    traitText: 'Advantage on Tactics checks. Critical hits deal an extra die.',
    mechanic: { advantageOn: ['tactics'], critBonus: 0.15 },
    description: 'Militarised for four thousand years and disinclined to pretend otherwise.',
  },
  {
    id: 'tellarite', name: 'Tellarite',
    bonuses: { engineering: 2, diplomacy: 1 },
    penalties: { medicine: -1 },
    trait: 'Argumentative',
    traitText: 'Advantage on Diplomacy checks made by disagreeing. Officers object more.',
    mechanic: { advantageOn: ['diplomacy'], officerFriction: 0.2 },
    description: 'Negotiates by insult and considers agreement the end of a conversation.',
  },
  {
    id: 'betazoid', name: 'Betazoid',
    bonuses: { diplomacy: 2, medicine: 1 },
    penalties: { tactics: -1 },
    trait: 'Empathic',
    traitText: 'You can sense a hail\'s true intent before answering it.',
    mechanic: { senseIntent: true, advantageOn: ['diplomacy'] },
    description: 'Knows what the other captain wants before they have finished saying otherwise.',
  },
  {
    id: 'trill', name: 'Trill',
    bonuses: { science: 1, diplomacy: 1, command: 1 },
    trait: 'Joined',
    traitText: 'Lifetimes of memory: gain one extra proficiency, and start one level higher in a chosen ability.',
    mechanic: { extraProficiency: 1, hostMemories: true },
    description: 'Several careers deep, with the disadvantage of remembering all of them.',
  },
  {
    id: 'bajoran', name: 'Bajoran',
    bonuses: { command: 1, tactics: 1, medicine: 1 },
    trait: 'Resistance Veteran',
    traitText: 'Advantage on checks made while your ship is below half hull.',
    mechanic: { desperateAdvantage: true },
    description: 'Learned command in a war nobody expected them to win.',
  },
  {
    id: 'denobulan', name: 'Denobulan',
    bonuses: { medicine: 2, science: 1 },
    penalties: { tactics: -1 },
    trait: 'Physician',
    traitText: 'Casualties reduced by a quarter. Injured officers recover twice as fast.',
    mechanic: { casualtyReduction: 0.25, recoveryRate: 2 },
    description: 'Cheerful, sleepless for six days at a stretch, and very hard to alarm.',
  },
  {
    id: 'bolian', name: 'Bolian',
    bonuses: { engineering: 1, command: 1, medicine: 1 },
    trait: 'Unflappable',
    traitText: 'Never suffers disadvantage from being outnumbered.',
    mechanic: { ignoreOutnumbered: true },
    description: 'Talks through a hull breach the way other people talk through a queue.',
  },
  {
    id: 'saurian', name: 'Saurian',
    bonuses: { tactics: 1, engineering: 1, science: 1 },
    trait: 'Wide Spectrum Vision',
    traitText: 'Cloaked ships are detected at longer range. Advantage against ambushes.',
    mechanic: { cloakDetect: 0.4, ambushAdvantage: true },
    description: 'Sees further into the spectrum than the sensors do, and says so quietly.',
  },
  {
    id: 'caitian', name: 'Caitian',
    bonuses: { tactics: 1, medicine: 1, diplomacy: 1 },
    trait: 'Predator\'s Instinct',
    traitText: 'You always act first in an engagement, and can never be surprised.',
    mechanic: { alwaysFirst: true, surpriseImmune: true },
    description: 'Patient, then suddenly not.',
  },
  {
    id: 'half_vulcan', name: 'Human/Vulcan',
    bonuses: { science: 1, command: 1, diplomacy: 1 },
    trait: 'Two Disciplines',
    traitText: 'Choose Logic or Instinct before any check: advantage on Science, or on Command.',
    mechanic: { switchableAdvantage: ['science', 'command'] },
    description: 'Belonging to two worlds, at some cost to both.',
  },
];

export const SPECIES_BY_ID = Object.fromEntries(PLAYER_SPECIES.map((s) => [s.id, s]));

// ---------------------------------------------------------------- origins

/** Where you were raised. Shifts scores and opens dialogue. */
export const ORIGINS = [
  {
    id: 'core_world', name: 'Core World',
    bonuses: { diplomacy: 1, science: 1 },
    description: 'Earth, Vulcan, Andoria — the centre, with all the assumptions that come with it.',
    perk: 'Federation standing recovers faster after a reprimand.',
    mechanic: { federationRecovery: 1.5 },
  },
  {
    id: 'frontier_colony', name: 'Frontier Colony',
    bonuses: { engineering: 1, tactics: 1 },
    description: 'A long way from resupply, where you fixed things because nobody else would.',
    perk: 'Repairs made away from a starbase are 30% more effective.',
    mechanic: { fieldRepair: 1.3 },
  },
  {
    id: 'starship_born', name: 'Born Aboard',
    bonuses: { engineering: 1, command: 1 },
    description: 'Raised in corridors. You knew a bad warp signature before you could read.',
    perk: 'You always know the ship\'s exact condition without a damage report.',
    mechanic: { intuitiveShip: true },
  },
  {
    id: 'occupied_world', name: 'Occupied World',
    bonuses: { tactics: 1, medicine: 1 },
    description: 'Bajor, Setlik, somewhere the Federation reached late.',
    perk: 'Advantage on checks made while outnumbered.',
    mechanic: { outnumberedAdvantage: true },
  },
  {
    id: 'civilian_transport', name: 'Merchant Family',
    bonuses: { diplomacy: 1, engineering: 1 },
    description: 'Freighters and trade routes, and every port\'s customs officer by name.',
    perk: 'Better prices, and Ferengi and Orion contacts open sooner.',
    mechanic: { tradeBonus: 0.25, syndicateContacts: true },
  },
  {
    id: 'academy_legacy', name: 'Starfleet Family',
    bonuses: { command: 1, tactics: 1 },
    description: 'A surname the admiralty already knows, for better and considerably for worse.',
    perk: 'Start at a higher rank, with a correspondingly higher standard applied to you.',
    mechanic: { startingRankBonus: 1, higherExpectations: true },
  },
  {
    id: 'refugee', name: 'Displaced',
    bonuses: { medicine: 1, science: 1 },
    description: 'Your homeworld is a story you tell rather than a place you can return to.',
    perk: 'Rescue and evacuation missions grant substantially more experience.',
    mechanic: { rescueXP: 1.6 },
  },
];

export const ORIGIN_BY_ID = Object.fromEntries(ORIGINS.map((o) => [o.id, o]));

// ---------------------------------------------------------------- careers

/** Your track before the centre seat. Grants proficiencies and a signature ability. */
export const CAREERS = [
  {
    id: 'command', name: 'Command',
    proficiencies: ['command', 'diplomacy'],
    description: 'The bridge, from the bottom of it upward.',
    signature: 'Take the Conn',
    signatureText: 'Once per engagement, immediately reset every bridge officer cooldown.',
  },
  {
    id: 'tactical', name: 'Tactical',
    proficiencies: ['tactics', 'command'],
    description: 'Weapons, security, and the arithmetic of a firing solution.',
    signature: 'Called Shot',
    signatureText: 'Once per engagement, your next attack automatically critically hits a chosen subsystem.',
  },
  {
    id: 'engineering', name: 'Engineering',
    proficiencies: ['engineering', 'science'],
    description: 'Below decks, where the ship is actually kept in the sky.',
    signature: 'Miracle Worker',
    signatureText: 'Once per engagement, instantly restore 30% hull and extinguish every fire.',
  },
  {
    id: 'science', name: 'Science',
    proficiencies: ['science', 'medicine'],
    description: 'Sensors, laboratories, and the reports nobody at Command reads.',
    signature: 'Insight',
    signatureText: 'Once per engagement, reveal every enemy weakness and gain advantage on all checks for 20 seconds.',
  },
  {
    id: 'medical', name: 'Medical',
    proficiencies: ['medicine', 'science'],
    description: 'Sickbay, and the argument with the captain that follows every away mission.',
    signature: 'Triage',
    signatureText: 'Once per engagement, revive a fallen officer and halve casualties for 30 seconds.',
  },
  {
    id: 'diplomatic', name: 'Diplomatic Corps',
    proficiencies: ['diplomacy', 'command'],
    description: 'Attached to Starfleet rather than of it, which everyone mentions.',
    signature: 'Parley',
    signatureText: 'Once per engagement, force a hostile captain to hear you out regardless of doctrine.',
  },
  {
    id: 'intelligence', name: 'Starfleet Intelligence',
    proficiencies: ['tactics', 'science'],
    description: 'A service record with gaps in it that you are not cleared to discuss.',
    signature: 'Prior Knowledge',
    signatureText: 'Once per engagement, know an enemy\'s exact intentions and act before they do.',
  },
];

export const CAREER_BY_ID = Object.fromEntries(CAREERS.map((c) => [c.id, c]));

// ---------------------------------------------------------------- traits

/** Personal traits. Each is a genuine trade — a benefit paid for. */
export const TRAITS = [
  {
    id: 'by_the_book', name: 'By the Book', positive: true,
    text: 'Regulations are there for a reason. +2 to Federation standing gains; officers never refuse your orders.',
    // `noObjection`, not `noRefusal`. Both names meant the same thing — a
    // bridge that does not argue — and only one of them was ever read:
    // `powers.js` asks for `noObjection`, which the Inspiring Presence feat
    // declares. So this trait promised "officers never refuse your orders" and
    // a second key with no reader anywhere. §68's `hazardScale` again: two
    // names for one effect, one of them wired.
    mechanic: { federationGain: 2, noObjection: true },
    conflicts: ['maverick'],
  },
  {
    id: 'maverick', name: 'Maverick', positive: true,
    text: 'Advantage on any check the regulations forbid. Prime Directive violations cost double.',
    mechanic: { improvisedAdvantage: true, directivePenalty: 2 },
    conflicts: ['by_the_book'],
  },
  {
    id: 'cool_under_fire', name: 'Cool Under Fire', positive: true,
    // "or being outnumbered" removed, because away missions are refused in
    // combat — a landing party is never outnumbered while it is working, and
    // the card should not promise relief from a circumstance that cannot arise.
    text: 'A breaching core and fires on the decks do not reach your landing parties.',
    mechanic: { ignorePressure: true },
  },
  {
    id: 'tinkerer', name: 'Tinkerer', positive: true,
    text: 'Salvage yields an extra console. Field repairs cost half the time.',
    mechanic: { salvageBonus: 1, repairTime: 0.5 },
  },
  {
    id: 'xenolinguist', name: 'Xenolinguist', positive: true,
    text: 'First contact never fails outright, and unhailable factions may answer once.',
    mechanic: { contactFloor: true, reachUnhailable: true },
  },
  {
    id: 'tactician', name: 'Natural Tactician', positive: true,
    text: 'You always know the enemy\'s weakest shield facing without scanning.',
    mechanic: { autoWeakFacing: true },
  },
  {
    id: 'beloved', name: 'Beloved by the Crew', positive: true,
    text: 'Casualties reduced by 20%. Officers recover from injury twice as fast.',
    mechanic: { casualtyReduction: 0.2, recoveryRate: 2 },
  },
  {
    id: 'haunted', name: 'Haunted', positive: false,
    text: 'You have lost a ship before. Disadvantage on Command checks below 25% hull — but +3 to all others.',
    mechanic: { panicBelowQuarter: true, compensation: 3 },
  },
  {
    id: 'reckless', name: 'Reckless', positive: false,
    text: 'Your ship shoots straighter — and your landing parties pay for it.',
    // Said in the currency this game actually has.
    //
    // It declared `attackAdvantage` and `saveDisadvantage` — an attack roll and
    // a saving throw — and the README quoted this trait as its example of a
    // genuine mechanical trade. Gameplay stopped rolling a d20 when
    // `rules/resolve.js` replaced the die with a margin: there is no attack
    // roll and no saving throw to attach to, and both keys were read by
    // nothing. RESEARCH §70 counted 32 like them.
    //
    // The promise is kept, in the two places this game puts it. Shooting is the
    // ship's `accuracy`, which `shipMods` already contributes to from the
    // captain. The saving throw is the away team: the one thing that resolves a
    // check, and the one place a captain is personally at risk. `resolve()` has
    // taken a `disadvantage` argument since it was written and NOTHING has ever
    // passed one — this is its first caller.
    mechanic: { accuracyBonus: 0.1, hazardDisadvantage: true },
  },
  {
    id: 'idealist', name: 'Idealist', positive: false,
    text: 'Double reputation from peaceful outcomes. Destroying a ship costs double standing.',
    mechanic: { peaceGain: 2, killPenalty: 2 },
  },
  {
    id: 'notorious', name: 'Notorious', positive: false,
    text: 'Hostiles break off sooner out of fear. Diplomacy checks are made at disadvantage.',
    mechanic: { fearFactor: 0.15, diplomacyDisadvantage: true },
  },
  {
    id: 'insubordinate', name: 'History of Insubordination', positive: false,
    text: 'Start with a reprimand on file and slower promotion — but immune to a board of inquiry.',
    mechanic: { startingReprimand: true, xpRate: 0.9, inquiryImmune: true },
  },
];

export const TRAIT_BY_ID = Object.fromEntries(TRAITS.map((t) => [t.id, t]));
export const MAX_TRAITS = 2;

// ---------------------------------------------------------------- feats

/** Chosen on promotion. Larger, rarer, and often unlocking new verbs. */
export const FEATS = [
  { id: 'ability_score', name: 'Field Commission', repeatable: true,
    text: 'Raise one ability score by 2, or two scores by 1 each.', minRank: 0 },
  { id: 'tactical_genius', name: 'Tactical Genius', minRank: 2,
    text: 'Critical hits on a natural 19 or 20. +10% critical severity.',
    mechanic: { critRange: 19, critSeverity: 0.1 } },
  { id: 'master_engineer', name: 'Master Engineer', minRank: 2,
    text: 'The warp core can be ejected and later recovered. Power rebalances instantly.',
    mechanic: { coreRecovery: true, instantPower: true } },
  { id: 'diplomatic_immunity', name: 'Diplomatic Immunity', minRank: 3,
    text: 'You may enter any faction\'s home system regardless of standing.',
    mechanic: { universalPassage: true } },
  { id: 'xenobiologist', name: 'Xenobiologist', minRank: 2,
    text: 'Advantage on all Medicine and Science checks made planetside.',
    mechanic: { advantageOn: ['medicine', 'science'] } },
  { id: 'fleet_tactician', name: 'Fleet Tactician', minRank: 4,
    text: 'Allied ships in your engagements gain your Tactics modifier.',
    mechanic: { allyCommand: true } },
  { id: 'unshakeable', name: 'Unshakeable', minRank: 3,
    text: 'Once per engagement, automatically succeed on a failed saving throw.',
    mechanic: { autoSave: 1 } },
  { id: 'improviser', name: 'Improviser', minRank: 1,
    text: 'You may attempt any check untrained without disadvantage.',
    mechanic: { noUntrainedPenalty: true } },
  { id: 'inspiring', name: 'Inspiring Presence', minRank: 3,
    text: 'Bridge officer cooldowns recover 40% faster. Officers never object.',
    mechanic: { officerCooldown: 0.4, noObjection: true } },
  { id: 'survivor', name: 'Survivor', minRank: 4,
    text: 'Once per commission, survive what would destroy the ship at 1% hull.',
    mechanic: { deathSave: 1 } },
  { id: 'polymath', name: 'Polymath', minRank: 2,
    text: 'Gain proficiency in two additional abilities.',
    mechanic: { extraProficiencies: 2 } },
  { id: 'legend', name: 'Living Legend', minRank: 5,
    text: 'Every faction\'s reputation gains are increased by half. Enemies hesitate.',
    // `fearFactor`, not `enemyHesitation`. "Enemies hesitate" and "hostiles
    // break off sooner out of fear" are one thing, and only one of the two keys
    // was ever going to be wired — a second knob doing the same job is what §68
    // deleted `hazardScale` for. Smaller than Notorious's 0.15, which is that
    // trait's whole upside and is paid for with disadvantage on every
    // Diplomacy check; this is a rank-five feat's second clause.
    //
    // They do not stack: `mechanic()` returns the first source that defines a
    // key, and a trait is consulted before a feat. A notorious captain who
    // becomes a legend keeps the higher of the two, which is the right way
    // round.
    mechanic: { repGain: 1.5, fearFactor: 0.08 } },
];

export const FEAT_BY_ID = Object.fromEntries(FEATS.map((f) => [f.id, f]));

// ---------------------------------------------------------------- the sheet

export class Character {
  constructor(data = {}) {
    this.firstName = data.firstName ?? 'Alexander';
    this.lastName = data.lastName ?? 'Reyes';
    this.pronouns = data.pronouns ?? 'they/them';
    this.speciesId = data.speciesId ?? 'human';
    this.originId = data.originId ?? 'core_world';
    this.careerId = data.careerId ?? 'command';
    this.traits = data.traits ?? [];
    this.feats = data.feats ?? [];
    this.serialNumber = data.serialNumber ?? 'SC-937-0176-CEC';

    // Base scores before species and origin are applied.
    this.baseScores = data.baseScores ?? {
      command: 14, tactics: 13, engineering: 12, science: 12, medicine: 10, diplomacy: 10,
    };

    this.proficiencies = data.proficiencies ?? [];
    this.level = data.level ?? 1;
    this.signatureUsed = false;
    this.featUses = data.featUses ?? {};
    this.rerollsRemaining = 0;
    // "Two Disciplines — choose Logic or Instinct before any check." A real
    // choice needs somewhere to live, and it has to survive a save or it is
    // not a choice, it is a default. Null means "whichever the mechanic lists
    // first", so a captain who never picks still gets one of the two.
    this.discipline = data.discipline ?? null;

    if (!this.proficiencies.length) this.applyCareerProficiencies();
  }

  get name() { return `${this.firstName} ${this.lastName}`.trim(); }
  get species() { return SPECIES_BY_ID[this.speciesId] ?? SPECIES_BY_ID.human; }
  get origin() { return ORIGIN_BY_ID[this.originId] ?? ORIGINS[0]; }
  get career() { return CAREER_BY_ID[this.careerId] ?? CAREERS[0]; }

  applyCareerProficiencies() {
    this.proficiencies = [...new Set([
      ...this.career.proficiencies,
      ...(this.species.mechanic?.extraProficiency ? ['command'] : []),
    ])];
  }

  /** Final score for an ability: base + species + origin + feat increases. */
  score(abilityId) {
    let n = this.baseScores[abilityId] ?? 10;
    n += this.species.bonuses?.[abilityId] ?? 0;
    n += this.species.penalties?.[abilityId] ?? 0;
    n += this.origin.bonuses?.[abilityId] ?? 0;
    n += this.featScoreBonus(abilityId);
    return Math.min(ABILITY_HARD_CAP, Math.max(1, n));
  }

  featScoreBonus(abilityId) {
    return (this.featUses.abilityIncreases ?? [])
      .filter((x) => x === abilityId).length;
  }

  scores() {
    return Object.fromEntries(ABILITY_IDS.map((id) => [id, this.score(id)]));
  }

  mod(abilityId) {
    return abilityMod(this.score(abilityId));
  }

  get proficiencyBonus() {
    return proficiencyBonus(this.level);
  }

  isProficient(abilityId) {
    return this.proficiencies.includes(abilityId);
  }

  /**
   * The number added to a d20 for a given ability check.
   * Untrained abilities simply lack the proficiency bonus, unless a feat or
   * the Improviser trait says otherwise.
   */
  checkModifier(abilityId, { situational = 0 } = {}) {
    let total = this.mod(abilityId) + situational;
    if (this.isProficient(abilityId)) total += this.proficiencyBonus;
    // Read from the mechanic, not written out again.
    //
    // This was `if (this.hasTrait('haunted')) total += 3` — the same 3 the
    // trait declares as `compensation`, hardcoded, and the fourth instance of
    // that shape in this codebase after `critSeverity`, `hazardScale` and
    // `peaceGain`.
    //
    // It was also in a method with NO CALLER. `AwayTeam.modifierFor` is what
    // the game actually uses, and it builds the modifier itself, so Haunted's
    // +3 was dead code inside a dead method — a trait declared `positive:
    // false` that cost nothing and gave nothing. The live wiring is in
    // `sim/away.js`; this stays consistent with it so the two cannot disagree
    // if anything ever calls this.
    total += this.compensationOn(abilityId);
    return total;
  }

  /**
   * "Haunted — disadvantage on Command below 25% hull, and +3 to all others."
   *
   * The "all others" half, and it is deliberately not every ability: the
   * penalty is on Command, so the compensation is on everything that is not
   * Command. A trait that paid on the same check it charged would net to
   * nothing on the check that matters and to a bonus everywhere else.
   */
  compensationOn(abilityId) {
    if (abilityId === 'command') return 0;
    return this.mechanic('compensation') ?? 0;
  }

  /**
   * Pick which of the switchable disciplines is live.
   *
   * Refuses anything the character does not actually have, so a save file or a
   * misheard order cannot grant advantage on an ability nobody was promised.
   */
  chooseDiscipline(abilityId) {
    const list = this.mechanic('switchableAdvantage');
    if (!Array.isArray(list) || !list.includes(abilityId)) return false;
    this.discipline = abilityId;
    return true;
  }

  /** The disciplines this character may switch between, if any. */
  get disciplines() {
    const list = this.mechanic('switchableAdvantage');
    return Array.isArray(list) ? list : [];
  }

  hasTrait(id) { return this.traits.includes(id); }
  hasFeat(id) { return this.feats.includes(id); }

  /** Collect a named mechanic value from species, origin, traits, and feats. */
  mechanic(key) {
    const sources = [
      this.species.mechanic, this.origin.mechanic,
      ...this.traits.map((t) => TRAIT_BY_ID[t]?.mechanic),
      ...this.feats.map((f) => FEAT_BY_ID[f]?.mechanic),
    ].filter(Boolean);
    for (const src of sources) {
      if (src[key] !== undefined) return src[key];
    }
    return undefined;
  }

  /** Does anything grant advantage on this ability? */
  hasAdvantageOn(abilityId) {
    const sources = [
      this.species.mechanic, this.origin.mechanic,
      ...this.traits.map((t) => TRAIT_BY_ID[t]?.mechanic),
      ...this.feats.map((f) => FEAT_BY_ID[f]?.mechanic),
    ].filter(Boolean);
    return sources.some((m) => (m.advantageOn ?? []).includes(abilityId));
  }

  /** Ship modifiers contributed by the character sheet itself. */
  shipMods() {
    const mods = {};
    const add = (k, v) => { mods[k] = (mods[k] ?? 1) * v; };
    const bump = (k, v) => { mods[k] = (mods[k] ?? 0) + v; };

    // Ability modifiers feed the ship directly — a captain with high Tactics
    // makes the whole crew shoot better.
    bump('critChance', Math.max(0, this.mod('tactics')) * 0.012);
    add('accuracy', 1 + Math.max(0, this.mod('tactics')) * 0.02);
    add('repairRate', 1 + Math.max(0, this.mod('engineering')) * 0.06);
    add('shieldRegen', 1 + Math.max(0, this.mod('engineering')) * 0.03);
    add('stealthDetect', 1 + Math.max(0, this.mod('science')) * 0.06);

    // "Critical hits on a natural 19 or 20."
    //
    // The twenty-sided die is gone from gameplay — rules/resolve.js says why —
    // but the thing that sentence is ABOUT is alive and is called `critChance`,
    // which every ship starts with at 0.05: one twentieth, which is a natural
    // 20. A crit range of 19 is two twentieths. So the feat's own declared
    // number is what sets the bump, and `critRange` stops being a number
    // printed on a card that nothing anywhere read.
    const critRange = this.mechanic('critRange');
    if (critRange) bump('critChance', Math.max(0, (21 - critRange) / 20 - 0.05));
    // Read from the mechanic rather than written out a second time. This line
    // used to be `if (this.hasFeat('tactical_genius')) bump('critSeverity', 0.1)`
    // — the same 0.1 the feat declares, duplicated, so editing the feat table
    // would have changed what the card promised and not what the ship did.
    const critSeverity = this.mechanic('critSeverity');
    if (critSeverity) bump('critSeverity', critSeverity);
    // "Reckless — your ship shoots straighter." Read here for the same reason
    // the two lines above are: the number is on the card, and writing it out a
    // second time is how a promise drifts from what the game does.
    const accuracyBonus = this.mechanic('accuracyBonus');
    if (accuracyBonus) add('accuracy', 1 + accuracyBonus);
    if (this.species.mechanic?.critBonus) bump('critChance', this.species.mechanic.critBonus * 0.1);
    return mods;
  }

  /**
   * What this captain lends to ships that are not theirs.
   *
   * "Allied ships in your engagements gain your Tactics modifier" — the same
   * two terms Tactics contributes to your own ship above, and no others. A
   * Fleet Tactician makes the squadron shoot the way you do; they do not
   * repair or scan the way your engineer and your science officer do, because
   * your engineer and your science officer are not aboard those ships.
   *
   * @returns {object|null} mods to apply to an ally, or null if nothing to lend
   */
  allyMods() {
    if (!this.mechanic('allyCommand')) return null;
    const t = Math.max(0, this.mod('tactics'));
    if (!t) return null;
    return { accuracy: 1 + t * 0.02, critChance: t * 0.012 };
  }

  /** Reset per-engagement resources. */
  refresh() {
    this.signatureUsed = false;
    this.rerollsRemaining = this.species.mechanic?.rerollPerMission ?? 0;
  }

  levelUp() {
    this.level++;
    return { level: this.level, proficiencyBonus: this.proficiencyBonus };
  }

  takeFeat(featId, payload = null) {
    const feat = FEAT_BY_ID[featId];
    if (!feat) return false;
    if (featId === 'ability_score') {
      // Repeatable; payload is the list of abilities raised.
      this.featUses.abilityIncreases = [
        ...(this.featUses.abilityIncreases ?? []),
        ...[].concat(payload ?? []),
      ];
      this.feats.push(featId);
      return true;
    }
    if (this.feats.includes(featId)) return false;
    this.feats.push(featId);
    if (feat.mechanic?.extraProficiencies) {
      const missing = ABILITY_IDS.filter((a) => !this.proficiencies.includes(a));
      this.proficiencies.push(...missing.slice(0, feat.mechanic.extraProficiencies));
    }
    return true;
  }

  save() {
    return {
      firstName: this.firstName, lastName: this.lastName, pronouns: this.pronouns,
      speciesId: this.speciesId, originId: this.originId, careerId: this.careerId,
      traits: this.traits, feats: this.feats, baseScores: this.baseScores,
      proficiencies: this.proficiencies, level: this.level,
      featUses: this.featUses, serialNumber: this.serialNumber,
      discipline: this.discipline,
    };
  }

  static load(data) { return new Character(data ?? {}); }
}

/** A randomly rolled captain, for players who want to get straight in. */
export function randomCharacter(rng) {
  const species = rng.pick(PLAYER_SPECIES);
  const origin = rng.pick(ORIGINS);
  const career = rng.pick(CAREERS);
  const array = rng.shuffle([...STANDARD_ARRAY]);
  const baseScores = Object.fromEntries(ABILITY_IDS.map((id, i) => [id, array[i]]));

  const positives = TRAITS.filter((t) => t.positive);
  const negatives = TRAITS.filter((t) => !t.positive);
  const traits = [rng.pick(positives).id, rng.pick(negatives).id];

  return new Character({
    firstName: rng.pick(['Ayla', 'Marcus', 'Ilyana', 'Toren', 'Sabine', 'Kessler', 'Naomi', 'Idris']),
    lastName: rng.pick(['Reyes', 'Okafor', 'Sandoval', 'Novak', 'Barrow', 'Thorne', 'Zheng', 'Vance']),
    speciesId: species.id, originId: origin.id, careerId: career.id,
    baseScores, traits,
  });
}
