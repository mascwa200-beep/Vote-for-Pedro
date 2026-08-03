// Factions the Federation shares a galaxy with.
//
// `standing` is the player's reputation, -100 (open war) to +100 (allied).
// It is mutated by the consequence ledger and read by encounter generation,
// border transit, and mission availability.

export const FACTIONS = {
  federation: {
    id: 'federation',
    name: 'United Federation of Planets',
    short: 'Federation',
    adjective: 'Federation',
    color: '#9cf',
    baseStanding: 100,
    hailable: true,
    doctrine: 'balanced',
    description: 'Your own. Starfleet answers to the Council, and the Council reads your logs.',
  },
  klingon: {
    id: 'klingon',
    name: 'Klingon Empire',
    short: 'Klingon',
    adjective: 'Klingon',
    color: '#e5533d',
    baseStanding: -10,
    hailable: true,
    doctrine: 'aggressive',
    // Klingons respect a captain who fights well even while losing.
    respectsValor: true,
    description: 'Honour is currency. Retreat is debt. They will fire first and salute you after.',
  },
  romulan: {
    id: 'romulan',
    name: 'Romulan Star Empire',
    short: 'Romulan',
    adjective: 'Romulan',
    color: '#7ed957',
    baseStanding: -40,
    hailable: true,
    doctrine: 'ambush',
    cloakCapable: true,
    description: 'Patient, cloaked, and contemptuous. They do not open engagements they expect to lose.',
  },
  cardassian: {
    id: 'cardassian',
    name: 'Cardassian Union',
    short: 'Cardassian',
    adjective: 'Cardassian',
    color: '#d9a441',
    baseStanding: -25,
    hailable: true,
    doctrine: 'attrition',
    description: 'Order above all. They will negotiate at length and violate the terms precisely.',
  },
  ferengi: {
    id: 'ferengi',
    name: 'Ferengi Alliance',
    short: 'Ferengi',
    adjective: 'Ferengi',
    color: '#e9913c',
    baseStanding: 10,
    hailable: true,
    doctrine: 'opportunist',
    bribeable: true,
    description: 'Everything is for sale, including their withdrawal from a fight they are losing.',
  },
  tholian: {
    id: 'tholian',
    name: 'Tholian Assembly',
    short: 'Tholian',
    adjective: 'Tholian',
    color: '#ff6fae',
    baseStanding: -50,
    hailable: false,
    doctrine: 'territorial',
    description: 'Territorial to the point of geometry. Cross the line and the web closes.',
  },
  borg: {
    id: 'borg',
    name: 'Borg Collective',
    short: 'Borg',
    adjective: 'Borg',
    color: '#8fff8f',
    baseStanding: -100,
    hailable: false,
    doctrine: 'assimilate',
    adaptsToWeapons: true,
    description: 'They do not negotiate, threaten, or pursue. They arrive, and the arithmetic changes.',
  },
  dominion: {
    id: 'dominion',
    name: 'Dominion',
    short: 'Dominion',
    adjective: 'Jem’Hadar',
    color: '#b08cff',
    baseStanding: -70,
    hailable: false,
    doctrine: 'fanatic',
    description: 'Bred for this. They do not break, and they do not expect to survive.',
  },
  orion: {
    id: 'orion',
    name: 'Orion Syndicate',
    short: 'Orion',
    adjective: 'Orion',
    color: '#5fd6c4',
    baseStanding: -20,
    hailable: true,
    doctrine: 'opportunist',
    bribeable: true,
    description: 'Pirates with an accountant. They pick targets, not fights.',
  },
  independent: {
    id: 'independent',
    name: 'Unaligned Worlds',
    short: 'Independent',
    adjective: 'Independent',
    color: '#cccccc',
    baseStanding: 20,
    hailable: true,
    doctrine: 'defensive',
    description: 'Colonies, freighters, and people who would rather you moved along.',
  },
};

/** Reputation tiers — gate missions, docking rights, and who shoots on sight. */
export const STANDING_TIERS = [
  { min: 75, id: 'allied', label: 'Allied', hostile: false },
  { min: 40, id: 'friendly', label: 'Friendly', hostile: false },
  { min: 10, id: 'cordial', label: 'Cordial', hostile: false },
  { min: -10, id: 'neutral', label: 'Neutral', hostile: false },
  { min: -40, id: 'strained', label: 'Strained', hostile: false },
  { min: -70, id: 'hostile', label: 'Hostile', hostile: true },
  { min: -101, id: 'war', label: 'At War', hostile: true },
];

export function standingTier(value) {
  return STANDING_TIERS.find((t) => value >= t.min) ?? STANDING_TIERS[STANDING_TIERS.length - 1];
}

export function isHostile(value) {
  return standingTier(value).hostile;
}

export const FACTION_LIST = Object.values(FACTIONS);
