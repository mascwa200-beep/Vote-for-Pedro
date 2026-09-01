// Senior staff rosters.
//
// Two modes, chosen at new-game:
//   'canon'    — serve with the senior staff of a chosen pre-2000 era
//   'original' — a generated crew with the same station coverage
//
// Canon entries record name, species, rank and station only. No dialogue,
// scripts, likenesses, or other creative material is reproduced; officers
// speak lines this game writes for them, driven by their own trait values.

export const DEPARTMENTS = ['command', 'tactical', 'engineering', 'science', 'medical', 'operations'];

export const STATIONS = [
  { id: 'first_officer', label: 'First Officer', dept: 'command' },
  { id: 'tactical', label: 'Tactical Officer', dept: 'tactical' },
  { id: 'engineering', label: 'Chief Engineer', dept: 'engineering' },
  { id: 'science', label: 'Science Officer', dept: 'science' },
  { id: 'medical', label: 'Chief Medical Officer', dept: 'medical' },
  { id: 'helm', label: 'Helm Officer', dept: 'operations' },
  { id: 'comms', label: 'Communications Officer', dept: 'operations' },
];

/**
 * Traits drive both simulation modifiers and the tone of an officer's
 * acknowledgements. Each is 0..100.
 *   discipline — how exactly they execute an order they disagree with
 *   daring     — willingness to attempt low-probability manoeuvres
 *   candor     — how bluntly they tell you an order is a mistake
 *   expertise  — raw skill in their department
 */
export const ERAS = {
  tos: {
    id: 'tos', name: 'Original Series era', stardate: 4523.3,
    shipClass: 'constitution',
    description: 'Deep space, thin support, and a five-year mission with no relief crew.',
    crew: [
      { station: 'first_officer', name: 'Spock', species: 'Vulcan/Human', rank: 'Commander',
        discipline: 96, daring: 55, candor: 88, expertise: 94, secondary: 'science' },
      { station: 'medical', name: 'Leonard McCoy', species: 'Human', rank: 'Lieutenant Commander',
        discipline: 62, daring: 48, candor: 99, expertise: 92, aliases: ['bones'] },
      { station: 'engineering', name: 'Montgomery Scott', species: 'Human', rank: 'Lieutenant Commander',
        discipline: 84, daring: 72, candor: 76, expertise: 97, aliases: ['scotty'] },
      { station: 'helm', name: 'Hikaru Sulu', species: 'Human', rank: 'Lieutenant',
        discipline: 90, daring: 82, candor: 55, expertise: 88 },
      { station: 'comms', name: 'Nyota Uhura', species: 'Human', rank: 'Lieutenant',
        discipline: 92, daring: 68, candor: 62, expertise: 91 },
      { station: 'tactical', name: 'Pavel Chekov', species: 'Human', rank: 'Ensign',
        discipline: 88, daring: 78, candor: 58, expertise: 74 },
      { station: 'science', name: 'Spock', species: 'Vulcan/Human', rank: 'Commander',
        discipline: 96, daring: 55, candor: 88, expertise: 96, alias: true },
    ],
  },
  tng: {
    id: 'tng', name: 'Next Generation era', stardate: 44286.5,
    shipClass: 'excelsior',
    description: 'A larger fleet, families aboard, and a Prime Directive enforced in writing.',
    crew: [
      { station: 'first_officer', name: 'William T. Riker', species: 'Human', rank: 'Commander',
        discipline: 86, daring: 84, candor: 74, expertise: 89 },
      { station: 'science', name: 'Data', species: 'Android', rank: 'Lieutenant Commander',
        discipline: 99, daring: 60, candor: 82, expertise: 98, secondary: 'operations' },
      { station: 'engineering', name: 'Geordi La Forge', species: 'Human', rank: 'Lieutenant Commander',
        discipline: 88, daring: 70, candor: 68, expertise: 94 },
      { station: 'tactical', name: 'Worf', species: 'Klingon', rank: 'Lieutenant',
        discipline: 94, daring: 90, candor: 86, expertise: 91 },
      { station: 'medical', name: 'Beverly Crusher', species: 'Human', rank: 'Commander',
        discipline: 82, daring: 62, candor: 88, expertise: 95 },
      { station: 'helm', name: 'Wesley Crusher', species: 'Human', rank: 'Ensign',
        discipline: 80, daring: 86, candor: 60, expertise: 76 },
      { station: 'comms', name: 'Deanna Troi', species: 'Betazoid/Human', rank: 'Commander',
        discipline: 78, daring: 58, candor: 92, expertise: 88 },
    ],
  },
  ds9: {
    id: 'ds9', name: 'Deep Space Nine era', stardate: 48959.1,
    shipClass: 'miranda',
    description: 'A border posting, a shooting war coming, and allies who each want something.',
    crew: [
      { station: 'first_officer', name: 'Kira Nerys', species: 'Bajoran', rank: 'Major',
        discipline: 68, daring: 94, candor: 97, expertise: 88 },
      { station: 'science', name: 'Jadzia Dax', species: 'Trill', rank: 'Lieutenant Commander',
        discipline: 84, daring: 88, candor: 78, expertise: 95 },
      { station: 'engineering', name: 'Miles O’Brien', species: 'Human', rank: 'Chief Petty Officer',
        discipline: 90, daring: 66, candor: 82, expertise: 96 },
      { station: 'medical', name: 'Julian Bashir', species: 'Human', rank: 'Lieutenant',
        discipline: 76, daring: 80, candor: 84, expertise: 93 },
      { station: 'tactical', name: 'Worf', species: 'Klingon', rank: 'Lieutenant Commander',
        discipline: 94, daring: 90, candor: 86, expertise: 93 },
      { station: 'helm', name: 'Nog', species: 'Ferengi', rank: 'Ensign',
        discipline: 82, daring: 76, candor: 64, expertise: 72 },
      { station: 'comms', name: 'Odo', species: 'Changeling', rank: 'Constable',
        discipline: 88, daring: 62, candor: 96, expertise: 86 },
    ],
  },
  voy: {
    id: 'voy', name: 'Voyager era', stardate: 49011.4,
    shipClass: 'constellation',
    description: 'No starbase, no resupply, no relief. Every torpedo you fire is one you cannot replace.',
    crew: [
      { station: 'first_officer', name: 'Chakotay', species: 'Human', rank: 'Commander',
        discipline: 74, daring: 82, candor: 86, expertise: 87 },
      { station: 'science', name: 'Seven of Nine', species: 'Human/ex-Borg', rank: 'Crewman',
        discipline: 70, daring: 78, candor: 99, expertise: 97 },
      { station: 'engineering', name: 'B’Elanna Torres', species: 'Klingon/Human', rank: 'Lieutenant',
        discipline: 66, daring: 90, candor: 94, expertise: 95 },
      { station: 'tactical', name: 'Tuvok', species: 'Vulcan', rank: 'Lieutenant Commander',
        discipline: 98, daring: 52, candor: 90, expertise: 92 },
      { station: 'medical', name: 'The Doctor', species: 'Hologram', rank: 'EMH Mark I',
        discipline: 72, daring: 66, candor: 98, expertise: 94 },
      { station: 'helm', name: 'Tom Paris', species: 'Human', rank: 'Lieutenant',
        discipline: 64, daring: 96, candor: 72, expertise: 90 },
      { station: 'comms', name: 'Harry Kim', species: 'Human', rank: 'Ensign',
        discipline: 92, daring: 68, candor: 58, expertise: 78 },
    ],
  },
};

export const ERA_LIST = Object.values(ERAS);

// ---------------------------------------------------------------------------
// Original crew generation
// ---------------------------------------------------------------------------

export const SPECIES = [
  { id: 'human', name: 'Human', weight: 40, bonus: {}, },
  { id: 'vulcan', name: 'Vulcan', weight: 10, bonus: { discipline: 14, daring: -12, expertise: 6 } },
  { id: 'andorian', name: 'Andorian', weight: 8, bonus: { daring: 14, candor: 10, discipline: -6 } },
  { id: 'tellarite', name: 'Tellarite', weight: 6, bonus: { candor: 20, discipline: -4 } },
  { id: 'betazoid', name: 'Betazoid', weight: 6, bonus: { candor: 12, expertise: 4 } },
  { id: 'trill', name: 'Trill', weight: 6, bonus: { expertise: 10, discipline: 4 } },
  { id: 'bolian', name: 'Bolian', weight: 6, bonus: { discipline: 8 } },
  { id: 'denobulan', name: 'Denobulan', weight: 4, bonus: { expertise: 8, candor: 6 } },
  { id: 'bajoran', name: 'Bajoran', weight: 5, bonus: { daring: 10, candor: 8, discipline: -4 } },
  { id: 'klingon', name: 'Klingon', weight: 3, bonus: { daring: 18, candor: 12, discipline: -8 } },
  { id: 'saurian', name: 'Saurian', weight: 3, bonus: { discipline: 6, expertise: 4 } },
  { id: 'caitian', name: 'Caitian', weight: 3, bonus: { daring: 8 } },
];

const GIVEN_NAMES = [
  'Ayla', 'Marcus', 'Ilyana', 'Toren', 'Sabine', 'Kessler', 'Naomi', 'Davenport',
  'Ines', 'Corwin', 'Petra', 'Halvorsen', 'Yusuf', 'Amara', 'Dominic', 'Renn',
  'Teodora', 'Kavi', 'Solene', 'Ashford', 'Miriam', 'Bastian', 'Noor', 'Ravel',
  'Elise', 'Okonkwo', 'Tam', 'Lindqvist', 'Rosa', 'Ferreira', 'Idris', 'Wen',
];

const SURNAMES = [
  'Reyes', 'Okafor', 'Sandoval', 'Whitlock', 'Novak', 'Barrow', 'Castellan',
  'Duvall', 'Ferris', 'Grayson', 'Hallward', 'Ibarra', 'Kestrel', 'Lavigne',
  'Marchetti', 'Nakamura', 'Oyelaran', 'Petrov', 'Quill', 'Rasmussen',
  'Silvestri', 'Thorne', 'Ustinov', 'Vance', 'Wray', 'Yarrow', 'Zheng',
];

const VULCAN_NAMES = ['T’Pren', 'Sovik', 'T’Lara', 'Selek', 'V’Nara', 'Storek', 'T’Vasi', 'Sepel'];
const ANDORIAN_NAMES = ['Thessa Zh’Vaar', 'Shran Th’Rell', 'Talas Sh’Ferro', 'Keval Ch’Idris'];
const TELLARITE_NAMES = ['Gral Bokk', 'Naaz Terev', 'Skalaar Voh', 'Bern Gruut'];
const KLINGON_NAMES = ['Korrath', 'B’Elanna Vey', 'Kurn’ak', 'Mara Sutai', 'Torvak'];
const BAJORAN_NAMES = ['Latha Reon', 'Vedra Nol', 'Anjel Ruu', 'Prin Talek'];
const TRILL_NAMES = ['Ezren Valo', 'Nima Adal', 'Corvan Bex', 'Ilani Rehl'];

const NAMES_BY_SPECIES = {
  vulcan: VULCAN_NAMES,
  andorian: ANDORIAN_NAMES,
  tellarite: TELLARITE_NAMES,
  klingon: KLINGON_NAMES,
  bajoran: BAJORAN_NAMES,
  trill: TRILL_NAMES,
};

const RANK_BY_STATION = {
  first_officer: 'Commander',
  tactical: 'Lieutenant',
  engineering: 'Lieutenant Commander',
  science: 'Lieutenant Commander',
  medical: 'Lieutenant Commander',
  helm: 'Lieutenant',
  comms: 'Lieutenant',
};

const clamp100 = (n) => Math.max(1, Math.min(100, Math.round(n)));

/** Build one original officer for a station. */
export function generateOfficer(rng, station) {
  const species = rng.weighted(SPECIES);
  const pool = NAMES_BY_SPECIES[species.id];
  const name = pool
    ? rng.pick(pool)
    : `${rng.pick(GIVEN_NAMES)} ${rng.pick(SURNAMES)}`;

  const base = {
    discipline: rng.normal(78, 12),
    daring: rng.normal(70, 16),
    candor: rng.normal(70, 16),
    expertise: rng.normal(82, 10),
  };
  for (const [k, v] of Object.entries(species.bonus)) base[k] += v;

  return {
    station,
    name,
    species: species.name,
    speciesId: species.id,
    rank: RANK_BY_STATION[station] ?? 'Lieutenant',
    discipline: clamp100(base.discipline),
    daring: clamp100(base.daring),
    candor: clamp100(base.candor),
    expertise: clamp100(base.expertise),
  };
}

/** A full original senior staff covering every station. */
export function generateCrew(rng) {
  return STATIONS.map((s) => generateOfficer(rng, s.id));
}

/** Resolve the roster for a chosen crew mode. */
export function buildRoster({ mode, era }, rng) {
  if (mode === 'canon') {
    const src = ERAS[era] ?? ERAS.tos;
    // `alias: true` entries are the same person double-hatted at a second
    // station; keep one canonical record per station.
    return src.crew.map((c) => ({ ...c, canon: true, speciesId: null }));
  }
  return generateCrew(rng);
}
