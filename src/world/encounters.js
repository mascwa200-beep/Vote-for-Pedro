// What you run into out there.
//
// Encounters are weighted by where you are, who you have annoyed, and what
// the ledger already records. A captain with a reputation for firing first
// meets more people willing to fire first.

import { SYSTEM_BY_ID } from './systems.data.js';
import { FACTIONS, isHostile } from './factions.data.js';
import { Ship } from '../sim/ship.js';

/** Which hostile hulls each faction fields. */
const FLEETS = {
  klingon: ['bird_of_prey', 'bird_of_prey', 'd7', 'ktinga', 'vorcha', 'neghvar'],
  romulan: ['scoutship', 'scoutship', 'warbird'],
  cardassian: ['galor', 'galor', 'keldon'],
  ferengi: ['marauder'],
  orion: ['orion_raider', 'orion_raider'],
  tholian: ['tholian_web_spinner'],
  dominion: ['jem_hadar_attack', 'jem_hadar_attack', 'jem_hadar_battleship'],
  borg: ['borg_cube', 'bioship'],
  independent: ['freighter', 'transport'],
};

/** Which factions patrol which sectors, and how heavily. */
const SECTOR_PRESENCE = {
  sol: { federation: 8, independent: 2 },
  vulcan: { federation: 7, independent: 2 },
  andor: { federation: 6, klingon: 1, independent: 2 },
  rigel: { independent: 4, orion: 3, ferengi: 2, federation: 3 },
  donatu: { klingon: 5, federation: 4 },
  archanis: { klingon: 6, federation: 3 },
  qonos: { klingon: 9 },
  neutral: { romulan: 5, federation: 3 },
  romulus: { romulan: 9 },
  bajor: { federation: 4, cardassian: 3, independent: 3 },
  cardassia: { cardassian: 9 },
  badlands: { cardassian: 3, independent: 3, orion: 2 },
  tholia: { tholian: 8 },
  frontier: { independent: 2, klingon: 2, romulan: 2 },
  deepspace: { independent: 1, borg: 1 },
  risa: { federation: 6, independent: 3, orion: 1 },
  betazed: { federation: 7, independent: 2 },
  ferenginar: { ferengi: 8, orion: 2 },
  gamma: { dominion: 9, independent: 1 },
};

export const ENCOUNTER_KINDS = [
  'patrol', 'distress', 'derelict', 'anomaly', 'ambush', 'convoy', 'first_contact', 'quiet',
];

/**
 * Roll one encounter for a location.
 * @returns {object|null} encounter descriptor, or null for an uneventful arrival
 */
export function rollEncounter(rng, systemId, { ledger, inTransit = false } = {}) {
  const system = SYSTEM_BY_ID[systemId];
  if (!system) return null;
  const presence = SECTOR_PRESENCE[system.sector] ?? { independent: 2 };

  // Safe space is mostly quiet; the frontier is not.
  const danger = system.faction === 'federation' && !system.contested ? 0.18
    : system.contested ? 0.6
    : system.unexplored ? 0.55
    : system.hazard ? 0.5
    : 0.4;

  if (rng.float() > danger && !inTransit) {
    return rng.chance(0.45) ? { kind: 'quiet', system } : buildAnomaly(rng, system);
  }

  const table = [
    { kind: 'patrol', weight: 30 },
    { kind: 'distress', weight: system.faction === 'federation' ? 22 : 14 },
    { kind: 'derelict', weight: 10 },
    { kind: 'anomaly', weight: system.anomalous ? 30 : 12 },
    { kind: 'ambush', weight: system.contested || system.border ? 24 : 8 },
    { kind: 'convoy', weight: 10 },
    { kind: 'first_contact', weight: system.unexplored ? 22 : 2 },
  ];
  const pick = rng.weighted(table);

  switch (pick.kind) {
    case 'patrol': return buildPatrol(rng, system, presence, ledger);
    case 'ambush': return buildAmbush(rng, system, presence, ledger);
    case 'distress': return buildDistress(rng, system);
    case 'derelict': return buildDerelict(rng, system);
    case 'convoy': return buildConvoy(rng, system, presence);
    case 'first_contact': return buildFirstContact(rng, system);
    case 'anomaly':
    default: return buildAnomaly(rng, system);
  }
}

function pickFaction(rng, presence, { exclude = ['federation'] } = {}) {
  const options = Object.entries(presence)
    .filter(([id]) => !exclude.includes(id))
    .map(([id, weight]) => ({ id, weight }));
  if (!options.length) return 'independent';
  return rng.weighted(options).id;
}

function buildPatrol(rng, system, presence, ledger) {
  const factionId = pickFaction(rng, presence);
  const standing = ledger?.standingOf(factionId) ?? FACTIONS[factionId]?.baseStanding ?? 0;
  const hostile = isHostile(standing);
  const count = rng.int(1, factionId === 'borg' ? 1 : 2);
  return {
    kind: 'patrol', system, factionId, hostile,
    ships: makeShips(rng, factionId, count),
    hailable: FACTIONS[factionId]?.hailable ?? false,
    title: `${FACTIONS[factionId]?.adjective ?? 'Unknown'} patrol`,
    text: hostile
      ? `${FACTIONS[factionId].adjective} vessels closing on an intercept course. They are arming weapons.`
      : `A ${FACTIONS[factionId].adjective} patrol is holding position and scanning us. No weapons charged — yet.`,
  };
}

function buildAmbush(rng, system, presence, ledger) {
  const factionId = pickFaction(rng, presence, { exclude: ['federation', 'independent'] });
  const count = rng.int(2, 3);
  return {
    kind: 'ambush', system, factionId, hostile: true, surprise: true,
    ships: makeShips(rng, factionId, count),
    hailable: false,
    title: 'Ambush',
    text: FACTIONS[factionId]?.cloakCapable
      ? 'Sensors read nothing — then everything. Ships decloaking off both bows.'
      : `${FACTIONS[factionId]?.adjective ?? 'Hostile'} ships coming out of the debris field, weapons hot.`,
  };
}

function buildDistress(rng, system) {
  const kinds = [
    { id: 'freighter_attacked', text: 'A civilian freighter is under attack and losing containment.', hostile: true },
    { id: 'medical', text: 'A colony transport reports a viral outbreak aboard. Fourteen hundred people.', hostile: false },
    { id: 'stranded', text: 'A survey team is stranded with a failing life-support system.', hostile: false },
    { id: 'colony_raid', text: 'A colony is being raided. Their defence grid is already down.', hostile: true },
  ];
  const pick = rng.pick(kinds);
  const factionId = pick.hostile ? rng.pick(['orion', 'klingon', 'ferengi']) : null;
  return {
    kind: 'distress', system, subtype: pick.id, hostile: pick.hostile, factionId,
    ships: pick.hostile ? makeShips(rng, factionId, rng.int(1, 2)) : [],
    victims: pick.hostile ? [new Ship('freighter', { name: 'SS Kobayashi', faction: 'independent' })] : [],
    lives: rng.int(80, 2400),
    title: 'Distress call',
    text: pick.text,
    // Ignoring a distress call is a real choice with a real cost.
    ignorable: true,
  };
}

function buildDerelict(rng, system) {
  return {
    kind: 'derelict', system,
    title: 'Derelict vessel',
    text: rng.pick([
      'A ship adrift, no power, no life signs on the first sweep. Hull is intact.',
      'A drifting hulk. Something cut it open from the inside.',
      'An unregistered vessel, dark, tumbling slowly. Sensors read faint biosigns.',
    ]),
    salvage: rng.pick(['phaser_relay', 'shield_capacitor', 'ablative_armor', 'sensor_array', 'eps_conduits']),
    risk: rng.range(0.15, 0.5),
    hostile: false,
  };
}

function buildConvoy(rng, system, presence) {
  const factionId = pickFaction(rng, presence, { exclude: [] });
  return {
    kind: 'convoy', system, factionId, hostile: false,
    title: 'Merchant convoy',
    text: `A ${FACTIONS[factionId]?.adjective ?? 'civilian'} convoy hails us for an escort through the sector.`,
    hailable: true,
    escortReward: rng.int(200, 700),
  };
}

function buildFirstContact(rng, system) {
  const names = ['Kelvan', 'Sheliak', 'Xindi-Aquatic', 'Melkotian', 'Excalbian', 'Medusan', 'Tamarian'];
  return {
    kind: 'first_contact', system, hostile: false,
    speciesName: rng.pick(names),
    title: 'First contact',
    text: 'An unknown vessel of unfamiliar configuration. No match in the database. They are transmitting.',
    // The Prime Directive is a live question here, not decoration.
    preWarp: rng.chance(0.35),
  };
}

function buildAnomaly(rng, system) {
  const anomalies = [
    { id: 'subspace_rift', name: 'Subspace rift', hazard: 0.4, value: 3 },
    { id: 'protostar', name: 'Protostar', hazard: 0.25, value: 2 },
    { id: 'gravitic_eddy', name: 'Gravitic eddy', hazard: 0.5, value: 2 },
    { id: 'ion_storm', name: 'Ion storm', hazard: 0.6, value: 1 },
    { id: 'dark_matter', name: 'Dark matter nebula', hazard: 0.35, value: 4 },
    { id: 'chroniton_field', name: 'Chroniton field', hazard: 0.45, value: 4 },
    { id: 'derelict_probe', name: 'Ancient probe', hazard: 0.2, value: 5 },
  ];
  const a = rng.pick(anomalies);
  return {
    kind: 'anomaly', system, anomaly: a, hostile: false,
    title: a.name,
    text: `Sensors are reading a ${a.name.toLowerCase()}. Science requests permission to investigate.`,
  };
}

function makeShips(rng, factionId, count) {
  const pool = FLEETS[factionId] ?? ['orion_raider'];
  const names = {
    klingon: ['IKS Vor’cha', 'IKS Ch’Tang', 'IKS Bortas', 'IKS Rotarran'],
    romulan: ['IRW Terix', 'IRW Belak', 'IRW Valdore'],
    cardassian: ['CDS Prakesh', 'CDS Aldara', 'CDS Vetar'],
    ferengi: ['Kreechta', 'Krayton'],
    orion: ['Green Wind', 'Profit Margin', 'Syndicate Raider'],
    tholian: ['Assembly Spinner', 'Lattice Warden'],
    dominion: ['Jem’Hadar 4-7', 'Jem’Hadar 9-1'],
    borg: ['Borg Cube'],
    independent: ['SS Odin', 'SS Norkova'],
  }[factionId] ?? ['Unknown Vessel'];

  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(new Ship(rng.pick(pool), { name: names[i % names.length], faction: factionId }));
  }
  return out;
}

/** Hazard tick for systems that are actively dangerous to sit in. */
export function environmentalHazard(system, ship, rng, dt) {
  if (!system?.hazard) return null;
  switch (system.hazard) {
    case 'plasma_storm':
      if (rng.chance(0.35 * dt)) {
        ship.takeDamage(rng.range(40, 130), { bearing: rng.range(-180, 180), type: 'energy', rng });
        return 'A plasma front just raked the hull.';
      }
      return null;
    case 'debris':
      if (rng.chance(0.12 * dt)) {
        ship.takeDamage(rng.range(15, 60), { bearing: 0, type: 'kinetic', rng });
        return 'Debris impact on the forward shields.';
      }
      return null;
    case 'temporal':
      if (rng.chance(0.08 * dt)) return 'Chronometers are disagreeing with each other again.';
      return null;
    case 'tholian_web':
      if (rng.chance(0.1 * dt)) return 'Energy filaments are forming off the port bow.';
      return null;
    case 'nebula':
      // Static discharge blinds the sensor grid rather than damaging the hull.
      if (rng.chance(0.3 * dt)) {
        ship.damageSubsystem('sensors', 0.05);
        return 'Static discharge across the sensor array. We are half blind in here.';
      }
      return null;
    case 'metreon':
      if (rng.chance(0.2 * dt)) {
        ship.damageSubsystem('warpcore', 0.02);
        return 'Metreon particles are collecting in the nacelles. Warp drive is unreliable here.';
      }
      return null;
    default:
      return null;
  }
}
