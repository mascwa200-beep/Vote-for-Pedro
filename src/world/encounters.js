// What you run into out there.
//
// Encounters are weighted by where you are, who you have annoyed, and what
// the ledger already records. A captain with a reputation for firing first
// meets more people willing to fire first.

import { SYSTEM_BY_ID } from './systems.data.js';
import { FACTIONS, isHostile } from './factions.data.js';
import { Ship } from '../sim/ship.js';
import { buildHostiles } from '../sim/combat.js';

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
/**
 * What a derelict can be carrying.
 *
 * Exported because the Ferengi "Salvage Contacts" perk draws a SECOND console
 * from it, and a second private copy of this list is how a captain's contacts
 * come to know about parts no derelict in the galaxy actually carries.
 */
export const SALVAGE_POOL = [
  'phaser_relay', 'shield_capacitor', 'ablative_armor', 'sensor_array', 'eps_conduits',
];

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

  // Traps are rare and are not gated on danger: a gravimetric shear does not
  // care whose space you are in.
  if (rng.chance(system.hazard ? 0.1 : 0.045)) return buildTrap(rng, system);

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

/**
 * "A" or "An", for a name the data supplies.
 *
 * Faction adjectives are data, and two of them start with a vowel — the log
 * read "A Independent patrol" and "A Orion convoy". Vowel-initial is the only
 * rule worth encoding here; the ten adjectives in factions.data.js contain no
 * silent-h or long-u exceptions, and a general English article function would
 * be more machinery than the problem deserves.
 */
export function article(word) {
  return /^[aeiou]/i.test(String(word ?? '')) ? 'An' : 'A';
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
      : `${article(FACTIONS[factionId].adjective)} ${FACTIONS[factionId].adjective} patrol is holding position and scanning us. No weapons charged — yet.`,
  };
}

/**
 * A trap. Not a fight you are losing — a situation with no weapon in it.
 *
 * The point of these is that `engage` is not on the menu and `withdraw` does
 * not work. What gets you out is something you build, something you divert
 * power to, or the patience to sit still until whatever is out there loses
 * interest. It is the third option this game did not previously have.
 */
export const TRAPS = [
  {
    id: 'gravity_well',
    title: 'Gravimetric shear',
    text: 'We are held. A gravimetric eddy has the ship by the keel and impulse '
      + 'is not going to break it. Structural stress is climbing.',
    device: 'graviton_charge',
    deviceText: 'A graviton charge, detonated off the port quarter, tears the eddy open long enough to slip out.',
    powerChannel: 'engines',
    powerText: 'Everything to the engines, all at once. The frame screams and the ship comes free.',
    waitHours: 14,
    waitText: 'The eddy dissipates on its own, eventually. The wait costs fourteen hours and a lot of composure.',
    damage: 0.06,
  },
  {
    id: 'sensor_ghost',
    title: 'Something is hunting us',
    text: 'Sensors keep losing it. Whatever is out there is running silent, it '
      + 'has been matching our course for an hour, and it is closing.',
    device: 'sensor_decoy',
    deviceText: 'The decoy goes out cold and dumb. Whatever it is takes the bait and breaks off after it.',
    powerChannel: 'auxiliary',
    powerText: 'Every scrap of power to the sensors. The return resolves, they realise they have been seen, and they leave.',
    waitHours: 9,
    waitText: 'Silent running for nine hours. It loses interest, or decides we are not worth it.',
    damage: 0,
  },
  {
    id: 'containment_cascade',
    title: 'Containment cascade',
    text: 'A feedback loop in the containment field. It is building, and in about '
      + 'an hour it will not be a loop any more.',
    device: 'eps_bypass',
    deviceText: 'The bypass takes the load off the failing conduits and the cascade dies out.',
    powerChannel: 'auxiliary',
    powerText: 'Shunt everything spare into the containment field and hold it manually until it stabilises.',
    waitHours: 1,
    waitText: 'Nobody waits this one out. Engineering does it by hand, and it costs.',
    damage: 0.14,
  },
];

function buildTrap(rng, system) {
  const trap = rng.pick(TRAPS);
  return {
    kind: 'trapped', system, hostile: false, hailable: false,
    trap,
    title: trap.title,
    text: trap.text,
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
    salvage: rng.pick(SALVAGE_POOL),
    risk: rng.range(0.15, 0.5),
    hostile: false,
  };
}

function buildConvoy(rng, system, presence) {
  const factionId = pickFaction(rng, presence, { exclude: [] });
  return {
    kind: 'convoy', system, factionId, hostile: false,
    title: 'Merchant convoy',
    text: `${article(FACTIONS[factionId]?.adjective ?? 'civilian')} ${FACTIONS[factionId]?.adjective ?? 'civilian'} convoy hails us for an escort through the sector.`,
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
  // One table, in src/sim/combat.js. This file used to carry its own copy,
  // which is how a Klingon cruiser could be an IKS Rotarran in an encounter
  // and "klingon vessel 1" when a mission stage started the same fight.
  return buildHostiles(rng, factionId, count, pool);
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
