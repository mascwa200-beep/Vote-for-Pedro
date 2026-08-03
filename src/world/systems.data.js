// The known galaxy, as a graph of named star systems.
//
// Coordinates are light-years on a flat galactic plane centred on Sol (0,0),
// which is enough geometry for warp travel time to feel like distance.
// `links` are the charted lanes; travel between unlinked systems is possible
// but costs a navigational penalty (see world/galaxy.js).

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
];

export const SYSTEM_BY_ID = Object.fromEntries(SYSTEMS.map((s) => [s.id, s]));

export function getSystem(id) {
  return SYSTEM_BY_ID[id];
}

/** Straight-line distance in light-years. */
export function distanceLy(a, b) {
  const sa = typeof a === 'string' ? SYSTEM_BY_ID[a] : a;
  const sb = typeof b === 'string' ? SYSTEM_BY_ID[b] : b;
  if (!sa || !sb) return Infinity;
  return Math.hypot(sa.x - sb.x, sa.y - sb.y);
}
