// The known galaxy, as a graph of named star systems.
//
// Coordinates are light-years on a flat galactic plane centred on Sol (0,0),
// which is enough geometry for warp travel time to feel like distance.
// `links` are the charted lanes; travel between unlinked systems is possible
// but costs a navigational penalty (see world/galaxy.js).

/**
 * How far each sector sits above or below the plane of the chart, in light
 * years. See docs/RESEARCH.md §12.
 *
 * The local stellar neighbourhood is not a disc. Inside twenty light years the
 * galactic disc is a thousand light years thick, so the nearest stars sit above
 * and below Sol as readily as beside it — Alpha Centauri is sixty-one degrees
 * below the celestial equator and 61 Cygni is thirty-nine above it. A sector
 * map drawn on a tabletop is not a simplification of that, it is a different
 * arrangement.
 *
 * Depth is assigned per sector rather than per star. The x and y in this file
 * are an authored layout — the travel times between neighbours are what the
 * campaign is balanced on, and Rigel is twenty-two units away here against 860
 * light years in the sky — so inventing astrometry for the third axis and not
 * the other two would be a pretence. What the sectors buy instead is
 * STRUCTURE: the political blocs sit at different heights, so the map reads as
 * a volume with something in it rather than a scatter.
 *
 * Where a system has a real counterpart, the SIGN follows the real
 * declination. Alpha Centauri is below the plane and 61 Cygni is above it,
 * because that part is free to be true.
 */
export const SECTOR_DEPTH = {
  sol: 0,             // the origin, by definition
  vulcan: -1.4,       // 40 Eridani A and 61 Cygni pull opposite ways; Vulcan is below
  andor: -3.2,        // Epsilon Indi, 57 degrees south
  rigel: -2.1,
  donatu: 2.6,
  archanis: 3.4,
  qonos: 4.8,         // the Empire sits high off the plane, and stays there
  neutral: -1.1,
  romulus: -4.4,      // and the Star Empire low, on the other side of the zone
  bajor: 1.7,
  cardassia: 2.9,
  badlands: 0.8,      // the one place where the plane itself is unreliable
  tholia: -5.6,       // the Assembly is the furthest thing from anybody
  risa: -0.9,
  betazed: 1.2,
  gamma: 6.2,         // through the wormhole, and nothing about it is nearby
  ferenginar: 3.1,
  frontier: -2.7,
  deepspace: 5.1,
};

export const SECTORS = {
  sol: { id: 'sol', name: 'Sector 001', owner: 'federation', color: '#9cf' },
  vulcan: { id: 'vulcan', name: 'Vulcan Sector', owner: 'federation', color: '#9cf' },
  andor: { id: 'andor', name: 'Andor Sector', owner: 'federation', color: '#9cf' },
  rigel: { id: 'rigel', name: 'Rigel Sector', owner: 'federation', color: '#9cf' },
  donatu: { id: 'donatu', name: 'Donatu Sector', owner: 'contested', color: '#e5533d' },
  archanis: { id: 'archanis', name: 'Archanis Sector', owner: 'contested', color: '#e5533d' },
  qonos: { id: 'qonos', name: 'Qo’noS Sector', owner: 'klingon', color: '#e5533d' },
  neutral: { id: 'neutral', name: 'Romulan Neutral Zone', owner: 'neutral_zone', color: '#7ed957' },
  romulus: { id: 'romulus', name: 'Romulan Space', owner: 'romulan', color: '#7ed957' },
  bajor: { id: 'bajor', name: 'Bajor Sector', owner: 'federation', color: '#d9a441' },
  cardassia: { id: 'cardassia', name: 'Cardassian Union', owner: 'cardassian', color: '#d9a441' },
  badlands: { id: 'badlands', name: 'The Badlands', owner: 'contested', color: '#ff9a3c' },
  tholia: { id: 'tholia', name: 'Tholian Assembly', owner: 'tholian', color: '#ff6fae' },
  risa: { id: 'risa', name: 'Risa Sector', owner: 'federation', color: '#9cf' },
  betazed: { id: 'betazed', name: 'Betazed Sector', owner: 'federation', color: '#9cf' },
  gamma: { id: 'gamma', name: 'Gamma Quadrant', owner: 'dominion', color: '#b08cff' },
  ferenginar: { id: 'ferenginar', name: 'Ferengi Alliance', owner: 'ferengi', color: '#e9913c' },
  frontier: { id: 'frontier', name: 'Beta Quadrant Frontier', owner: 'unexplored', color: '#8ea2c6' },
  deepspace: { id: 'deepspace', name: 'Uncharted Space', owner: 'unexplored', color: '#6f7f9c' },
};

/**
 * type: starbase | core | colony | outpost | station | anomaly | deadspace | homeworld
 * facilities: dock (repair/resupply), shipyard (refit/change ship), medical, academy, trade
 */
export const SYSTEMS = [
  // ---- Federation core ----
  {
    id: 'sol', name: 'Sol', sector: 'sol', x: 0, y: 0, type: 'core', faction: 'federation',
    facilities: ['dock', 'shipyard', 'medical', 'academy', 'trade'],
    description: 'Earth. Starfleet Headquarters, Utopia Planitia, and every admiral who has read your file.',
    links: ['vulcan', 'alpha_centauri', 'wolf359', 'tellar'],
  },
  {
    id: 'alpha_centauri', name: 'Alpha Centauri', sector: 'sol', x: -4.4, y: 1.2, type: 'colony', faction: 'federation',
    facilities: ['dock', 'trade'],
    description: 'The oldest colony. Vineyards, shipwrights, and a traffic control officer with no patience.',
    links: ['sol', 'vulcan', 'rigel'],
  },
  {
    id: 'wolf359', name: 'Wolf 359', sector: 'sol', x: 7.8, y: -3.1, type: 'deadspace', faction: 'federation',
    facilities: [],
    hazard: 'debris',
    description: 'A graveyard with coordinates. Sensors still read hull fragments in a slow orbit.',
    links: ['sol', 'vega', 'frontier_1'],
  },
  {
    id: 'vulcan', name: 'Vulcan', sector: 'vulcan', x: -16.5, y: 4.2, type: 'homeworld', faction: 'federation',
    facilities: ['dock', 'medical', 'academy', 'trade'],
    description: 'The Forge, the monasteries, and the Science Academy that keeps rejecting your survey data.',
    links: ['sol', 'alpha_centauri', 'andoria', 'tellar'],
  },
  {
    id: 'andoria', name: 'Andoria', sector: 'andor', x: -21.0, y: 15.5, type: 'homeworld', faction: 'federation',
    facilities: ['dock', 'shipyard', 'trade'],
    description: 'An ice moon with a war record. The Imperial Guard still runs its own patrols.',
    links: ['vulcan', 'tellar', 'donatu_v'],
  },
  {
    id: 'tellar', name: 'Tellar Prime', sector: 'vulcan', x: -11.2, y: 11.0, type: 'homeworld', faction: 'federation',
    facilities: ['dock', 'trade'],
    description: 'Tellarites argue as a greeting. Expect the docking clearance to come with an insult.',
    links: ['sol', 'vulcan', 'andoria'],
  },
  {
    id: 'rigel', name: 'Rigel VII', sector: 'rigel', x: -9.0, y: -12.4, type: 'colony', faction: 'independent',
    facilities: ['dock', 'trade'],
    description: 'A rough port on a rough world. Starfleet has a consulate and a long list of incidents.',
    links: ['alpha_centauri', 'vega', 'orion_reach'],
  },
  {
    id: 'vega', name: 'Vega Colony', sector: 'sol', x: 4.2, y: -9.8, type: 'colony', faction: 'federation',
    facilities: ['dock', 'medical'],
    description: 'Agricultural, exposed, and the first thing anyone raiding the sector reaches.',
    links: ['wolf359', 'rigel', 'starbase_11'],
  },
  {
    id: 'starbase_11', name: 'Starbase 11', sector: 'rigel', x: 9.5, y: -14.0, type: 'starbase', faction: 'federation',
    facilities: ['dock', 'shipyard', 'medical', 'trade'],
    description: 'Full repair bays, a competent yardmaster, and the nearest place to convene a court-martial.',
    links: ['vega', 'orion_reach', 'archanis'],
  },

  // ---- Klingon border ----
  {
    id: 'donatu_v', name: 'Donatu V', sector: 'donatu', x: -18.0, y: 26.5, type: 'outpost', faction: 'federation',
    facilities: ['dock'],
    contested: true,
    description: 'Site of an inconclusive battle nobody wants repeated. Both fleets still patrol it.',
    links: ['andoria', 'archanis', 'organia'],
  },
  {
    id: 'archanis', name: 'Archanis IV', sector: 'archanis', x: -4.0, y: 27.0, type: 'colony', faction: 'federation',
    facilities: ['dock'],
    contested: true,
    description: 'A Federation colony the Empire has never stopped claiming out loud.',
    links: ['donatu_v', 'starbase_11', 'organia', 'qonos'],
  },
  {
    id: 'organia', name: 'Organia', sector: 'archanis', x: -11.5, y: 33.0, type: 'colony', faction: 'independent',
    facilities: [],
    anomalous: true,
    description: 'A pre-industrial world of unnerving calm, positioned exactly where two empires must meet.',
    links: ['donatu_v', 'archanis', 'qonos'],
  },
  {
    id: 'qonos', name: 'Qo’noS', sector: 'qonos', x: -6.0, y: 42.0, type: 'homeworld', faction: 'klingon',
    facilities: ['dock', 'trade'],
    requiresStanding: { klingon: 10 },
    description: 'The First City. Arriving uninvited is an act of either diplomacy or suicide.',
    links: ['archanis', 'organia', 'frontier_2'],
  },

  // ---- Romulan border ----
  {
    id: 'neutral_zone_1', name: 'Outpost 4', sector: 'neutral', x: 21.0, y: 12.0, type: 'outpost', faction: 'federation',
    facilities: ['dock'],
    border: true,
    description: 'One of the asteroid outposts watching the Zone. Treaty says nobody crosses. Treaty is old.',
    links: ['sol', 'wolf359', 'neutral_zone_2', 'devron'],
  },
  {
    id: 'neutral_zone_2', name: 'Outpost 8', sector: 'neutral', x: 27.5, y: 5.0, type: 'outpost', faction: 'federation',
    facilities: ['dock'],
    border: true,
    description: 'Sister station to Outpost 4. Its last three sensor logs have gaps nobody can explain.',
    links: ['neutral_zone_1', 'devron', 'starbase_11'],
  },
  {
    id: 'devron', name: 'Devron System', sector: 'neutral', x: 31.0, y: 14.5, type: 'anomaly', faction: 'none',
    facilities: [],
    anomalous: true,
    hazard: 'temporal',
    description: 'Inside the Zone. Sensor returns here contradict themselves depending on when you look.',
    links: ['neutral_zone_1', 'neutral_zone_2', 'romulus'],
  },
  {
    id: 'romulus', name: 'Romulus', sector: 'romulus', x: 41.0, y: 20.0, type: 'homeworld', faction: 'romulan',
    facilities: ['dock'],
    requiresStanding: { romulan: 25 },
    description: 'Beyond the Zone. Crossing this line without invitation is an act of war, formally.',
    links: ['devron', 'frontier_2'],
  },

  // ---- Cardassian / Bajoran ----
  {
    id: 'bajor', name: 'Bajor', sector: 'bajor', x: 18.0, y: -22.0, type: 'homeworld', faction: 'federation',
    facilities: ['dock', 'medical', 'trade'],
    description: 'Recovering from occupation, and deeply uninterested in being administered again.',
    links: ['terok_nor', 'starbase_11', 'badlands_1'],
  },
  {
    id: 'terok_nor', name: 'Deep Space 9', sector: 'bajor', x: 20.5, y: -24.5, type: 'station', faction: 'federation',
    facilities: ['dock', 'shipyard', 'medical', 'trade'],
    description: 'A Cardassian station under Bajoran flag with a Federation crew, beside a stable wormhole.',
    links: ['bajor', 'badlands_1', 'cardassia_prime'],
  },
  {
    id: 'badlands_1', name: 'The Badlands', sector: 'badlands', x: 26.0, y: -30.0, type: 'anomaly', faction: 'none',
    facilities: [],
    hazard: 'plasma_storm',
    description: 'Plasma storms that tear a ship apart and hide anyone willing to risk them.',
    links: ['bajor', 'terok_nor', 'cardassia_prime', 'deep_1'],
  },
  {
    id: 'cardassia_prime', name: 'Cardassia Prime', sector: 'cardassia', x: 33.0, y: -34.0, type: 'homeworld', faction: 'cardassian',
    facilities: ['dock'],
    requiresStanding: { cardassian: 20 },
    description: 'Central Command, the Obsidian Order, and a customs process designed as an interrogation.',
    links: ['terok_nor', 'badlands_1', 'deep_1'],
  },

  // ---- Fringe ----
  {
    id: 'orion_reach', name: 'Orion Reach', sector: 'rigel', x: -2.0, y: -22.0, type: 'station', faction: 'orion',
    facilities: ['trade'],
    description: 'A market station where the cargo manifests are fiction and everyone knows it.',
    links: ['rigel', 'starbase_11', 'deep_2'],
  },
  {
    id: 'tholian_edge', name: 'Tholian Frontier', sector: 'tholia', x: 38.0, y: -8.0, type: 'deadspace', faction: 'tholian',
    facilities: [],
    hazard: 'tholian_web',
    description: 'The Assembly marks its border precisely. Ships that drift over it are not returned.',
    links: ['neutral_zone_2', 'deep_1'],
  },
  {
    id: 'frontier_1', name: 'Beta Reticuli', sector: 'frontier', x: 14.0, y: 4.0, type: 'anomaly', faction: 'none',
    facilities: [],
    description: 'Charted once, briefly, by a survey ship that did not file a second report.',
    links: ['wolf359', 'frontier_2', 'deep_2'],
  },
  {
    id: 'frontier_2', name: 'Gamma Hydra', sector: 'frontier', x: 22.0, y: 34.0, type: 'outpost', faction: 'federation',
    facilities: ['dock'],
    description: 'A listening post at the far edge of charted space. Four staff, one subspace relay.',
    links: ['frontier_1', 'qonos', 'romulus', 'deep_2'],
  },
  {
    id: 'deep_1', name: 'Unnamed — Grid 4471', sector: 'deepspace', x: 44.0, y: -22.0, type: 'anomaly', faction: 'none',
    facilities: [],
    unexplored: true,
    description: 'No survey on file. The catalogue lists a mass and nothing else.',
    links: ['badlands_1', 'cardassia_prime', 'tholian_edge'],
  },
  {
    id: 'deep_2', name: 'Unnamed — Grid 9902', sector: 'deepspace', x: 30.0, y: 44.0, type: 'anomaly', faction: 'none',
    facilities: [],
    unexplored: true,
    description: 'Beyond the relay network. Whatever you find here, you report weeks later.',
    links: ['frontier_1', 'frontier_2', 'orion_reach'],
  },

  // ---- Federation interior, expanded ----
  {
    id: 'risa', name: 'Risa', sector: 'risa', x: -14.0, y: -18.0, type: 'colony', faction: 'federation',
    facilities: ['dock', 'medical', 'trade'],
    description: 'Engineered weather, engineered hospitality, and the only system where Starfleet crews outnumber the locals.',
    links: ['alpha_centauri', 'rigel', 'betazed'],
  },
  {
    id: 'betazed', name: 'Betazed', sector: 'betazed', x: -22.0, y: -9.0, type: 'homeworld', faction: 'federation',
    facilities: ['dock', 'medical', 'academy', 'trade'],
    description: 'Nothing you are thinking is private here, and the customs officer will mention it.',
    links: ['risa', 'vulcan', 'alpha_centauri'],
  },
  {
    id: 'starbase_1', name: 'Starbase 1', sector: 'sol', x: 2.4, y: 3.1, type: 'starbase', faction: 'federation',
    facilities: ['dock', 'shipyard', 'medical', 'academy', 'trade'],
    description: 'Earth orbit. The fleet yard, the archive, and the office where the orders are written.',
    links: ['sol', 'wolf359', 'neutral_zone_1'],
  },
  {
    id: 'utopia', name: 'Utopia Planitia', sector: 'sol', x: -1.6, y: 2.2, type: 'station', faction: 'federation',
    facilities: ['dock', 'shipyard'],
    description: 'Mars orbit. Where the hulls are built, and where yours was signed off two months late.',
    links: ['sol', 'starbase_1'],
  },
  {
    id: 'setlik', name: 'Setlik III', sector: 'bajor', x: 24.5, y: -18.0, type: 'colony', faction: 'federation',
    facilities: ['dock'],
    contested: true,
    description: 'A colony with a massacre in its history and a garrison that has never fully stood down.',
    links: ['bajor', 'starbase_11', 'cardassia_prime'],
  },
  {
    id: 'khitomer', name: 'Khitomer', sector: 'archanis', x: -1.5, y: 36.0, type: 'outpost', faction: 'independent',
    facilities: ['dock'],
    description: 'Neutral ground, chosen because both empires could reach it and neither could hold it.',
    links: ['archanis', 'organia', 'qonos'],
  },
  {
    id: 'narendra', name: 'Narendra III', sector: 'donatu', x: -24.0, y: 33.0, type: 'colony', faction: 'klingon',
    facilities: [],
    contested: true,
    description: 'A Klingon outpost. What a Federation ship chooses to do here tends to be remembered for decades.',
    links: ['donatu_v', 'organia'],
  },
  {
    id: 'ferenginar', name: 'Ferenginar', sector: 'ferenginar', x: 12.0, y: -34.0, type: 'homeworld', faction: 'ferengi',
    facilities: ['dock', 'trade'],
    description: 'It has been raining for four hundred years. Everything else is negotiable.',
    links: ['orion_reach', 'bajor', 'deep_2'],
  },
  {
    id: 'wormhole', name: 'Bajoran Wormhole', sector: 'bajor', x: 22.8, y: -26.8, type: 'anomaly', faction: 'none',
    facilities: [],
    anomalous: true,
    description: 'Stable, artificial, and seventy thousand light-years long. The only door to the Gamma Quadrant.',
    links: ['terok_nor', 'gamma_1'],
  },
  {
    id: 'gamma_1', name: 'Idran', sector: 'gamma', x: 46.0, y: -44.0, type: 'anomaly', faction: 'none',
    facilities: [],
    unexplored: true,
    description: 'The far side of the wormhole. Seventy thousand light-years from any help at all.',
    links: ['wormhole', 'gamma_2'],
  },
  {
    id: 'gamma_2', name: 'Founders’ Homeworld', sector: 'gamma', x: 54.0, y: -50.0, type: 'homeworld', faction: 'dominion',
    facilities: [],
    unexplored: true,
    requiresStanding: { dominion: 40 },
    description: 'A rogue world in a nebula. Everything on the other side of the wormhole answers to what is here.',
    links: ['gamma_1'],
  },
  {
    id: 'mutara', name: 'Mutara Nebula', sector: 'rigel', x: 3.0, y: -19.0, type: 'anomaly', faction: 'none',
    facilities: [],
    hazard: 'nebula',
    description: 'Static discharge blinds shields and sensors alike in here. It reduces a battle to two ships guessing.',
    links: ['rigel', 'vega', 'orion_reach'],
  },
  {
    id: 'briar', name: 'Briar Patch', sector: 'frontier', x: 19.0, y: 20.0, type: 'anomaly', faction: 'none',
    facilities: [],
    hazard: 'metreon',
    description: 'Metreon gas across two dozen light-years. Warp drive does not work in here, and everyone knows it.',
    links: ['frontier_1', 'frontier_2', 'neutral_zone_1'],
  },
];

export const SYSTEM_BY_ID = Object.fromEntries(SYSTEMS.map((s) => [s.id, s]));

export function getSystem(id) {
  return SYSTEM_BY_ID[id];
}

/** Straight-line distance in light-years. */
/**
 * Chart distance between two systems, in light years.
 *
 * PLANAR, DELIBERATELY. `systemDepth` gives every system a third axis so the
 * sector map can be looked at from somewhere other than directly above, and
 * that axis is an authored layout rather than astrometry — see
 * docs/RESEARCH.md §12. Folding it into this function would change the length
 * of every lane in the game, and therefore every warp transit, every fuel cost
 * and the whole balance of the campaign, in exchange for accuracy that does not
 * exist. The depth is for the eye. The distance is for the helm.
 *
 * There is a test that holds this apart, because it is exactly the sort of
 * thing somebody tidies up later without noticing what it costs.
 */
export function distanceLy(a, b) {
  const sa = typeof a === 'string' ? SYSTEM_BY_ID[a] : a;
  const sb = typeof b === 'string' ? SYSTEM_BY_ID[b] : b;
  if (!sa || !sb) return Infinity;
  return Math.hypot(sa.x - sb.x, sa.y - sb.y);
}

/**
 * Declination of the real star a system stands in for, in degrees.
 *
 * Seven of these places have a published counterpart in the sky. Nothing else
 * about the layout is astrometric, but the SIGN of the depth can be, and where
 * it can be it is: Alpha Centauri sits below the plane and 61 Cygni above it,
 * because that is where they actually are.
 */
export const REAL_DECLINATION = {
  sol: 0,                 // the origin
  alpha_centauri: -60.83, // Alpha Centauri
  wolf359: 7.01,          // Wolf 359
  vulcan: -7.65,          // 40 Eridani A
  tellar: 38.75,          // 61 Cygni
  andoria: -56.79,        // Epsilon Indi
  vega: 38.78,            // Vega
  frontier_1: -62.50,     // Beta Reticuli, standing in for Zeta Reticuli
};

/**
 * How far above or below the plane of the chart a system sits, in light years.
 *
 * The sector sets the magnitude; a system's own id sets a small offset inside
 * it, so two worlds in one sector are not coplanar. The offset is a hash rather
 * than a random number because this has to give the same answer in every
 * session, on every device, forever — the map is drawn from it and a save made
 * on one build has to load into the same galaxy on the next.
 */
export function systemDepth(system) {
  const sys = typeof system === 'string' ? SYSTEM_BY_ID[system] : system;
  if (!sys) return 0;

  const base = SECTOR_DEPTH[sys.sector] ?? 0;

  // FNV-1a over the id, the same hash the saves are checksummed with, mapped
  // to roughly ±1.2 light years of scatter within the sector.
  let h = 0x811c9dc5;
  for (let i = 0; i < sys.id.length; i++) {
    h ^= sys.id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const jitter = ((h % 2401) / 2400 - 0.5) * 2.4;

  const dec = REAL_DECLINATION[sys.id];
  if (dec === undefined) return base + jitter;

  // A real star: the magnitude still comes from the sector, so the map keeps
  // its structure, but it goes on the side of the plane the star is really on.
  const size = Math.abs(base) + Math.abs(jitter);
  if (dec === 0) return 0;
  return Math.sign(dec) * size;
}
