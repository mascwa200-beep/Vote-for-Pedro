// What you run into out there.
//
// Encounters are weighted by where you are, who you have annoyed, and what
// the ledger already records. A captain with a reputation for firing first
// meets more people willing to fire first.

import { SYSTEM_BY_ID, SECTORS } from './systems.data.js';
import { FACTIONS, isHostile } from './factions.data.js';
import { Ship } from '../sim/ship.js';
import { buildHostiles } from '../sim/combat.js';
import { shipPower } from '../sim/assess.js';

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
// Exported so a test can ask who is supposed to be somewhere. The table is the
// definition of presence; a test that reads it is checking that the ships which
// actually turn up are drawn from the right column, which is an effect.
export const SECTOR_PRESENCE = {
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
  // Both governments patrol the zone and neither runs it, and the people
  // who actually live there are a third of the traffic. RESEARCH.md §25.
  dmz: { cardassian: 4, federation: 3, independent: 3 },
  tholia: { tholian: 8 },
  frontier: { independent: 2, klingon: 2, romulan: 2 },
  deepspace: { independent: 1, borg: 1 },
  risa: { federation: 6, independent: 3, orion: 1 },
  betazed: { federation: 7, independent: 2 },
  ferenginar: { ferengi: 8, orion: 2 },
  gamma: { dominion: 9, independent: 1 },
};

export const ENCOUNTER_KINDS = [
  'patrol', 'distress', 'derelict', 'anomaly', 'ambush', 'convoy', 'first_contact',
  'signal', 'quiet',
];

/**
 * The traffic of a galaxy somebody actually lives in.
 *
 * Measured over four thousand rolls before this existed, the commonest thing
 * that happened to a captain was an anomaly: 52% of every non-quiet encounter
 * in the game, all seven of them the same sentence with a different noun in
 * it. The cause is structural rather than a weighting mistake — in safe
 * Federation space `danger` is 0.18, so 82% of rolls take the quiet branch,
 * and that branch was a coin flip between nothing at all and "Sensors are
 * reading a gravitic eddy. Science requests permission to investigate."
 *
 * These are what a starship in charted space actually meets. Low stakes on
 * purpose — a courier is not a crisis — but not nothing: a mail packet is the
 * only news from home a five-year mission gets, and the ship's own people are
 * what a commission is made of between systems.
 *
 * `answer` is what taking the call costs and gives. A signal nobody answers is
 * a line in the log and no more, which is a real choice on a schedule.
 */
export const SIGNALS = [
  {
    id: 'mail_packet',
    from: 'comms',
    title: 'Courier packet',
    text: 'A Starfleet courier is holding station with a mail packet for us. '
      + 'Nine weeks of it.',
    answer: 'Take the packet aboard',
    say: 'take the packet aboard',
    hint: 'The only news from home this mission gets.',
    result: 'The packet is distributed within the hour. The mess is loud tonight.',
    hours: 0.4,
    xp: 60,
  },
  {
    id: 'passing_ship',
    from: 'comms',
    title: 'Passing traffic',
    text: 'A Federation transport outbound on the reciprocal heading. '
      + 'They are asking to exchange position reports.',
    answer: 'Exchange reports',
    say: 'exchange reports',
    hint: 'Courtesy, and a look at where they have been.',
    result: 'Their track fills in two systems of ours that were guesswork.',
    hours: 0.2,
    xp: 40,
    charts: true,
  },
  {
    id: 'relay_drift',
    from: 'comms',
    title: 'Subspace relay',
    text: 'The relay buoy in this system has drifted out of alignment. '
      + 'Nobody within a month of here will be able to raise Starfleet.',
    answer: 'Realign it',
    say: 'realign it',
    hint: 'An hour of the watch, and a sector keeps its mail.',
    result: 'The buoy is back on its bearing and answering. Logged with Operations.',
    hours: 1.1,
    xp: 90,
    standing: 2,
  },
  {
    id: 'colony_survey',
    from: 'comms',
    title: 'Colony request',
    text: 'A colony administrator is asking whether we would run a weather '
      + 'sweep on our way past. Their own satellite failed in the spring.',
    answer: 'Run the sweep',
    say: 'run the sweep',
    hint: 'Twenty minutes of sensor time. It matters to them.',
    result: 'Science hands over a season of forecasts. The administrator is '
      + 'audibly relieved.',
    hours: 0.6,
    xp: 80,
    standing: 2,
  },
  {
    id: 'fleet_news',
    from: 'comms',
    title: 'General frequency',
    text: 'Fleet news on the general frequency. Promotions, losses, and a '
      + 'shipyard schedule nobody believes.',
    answer: 'Pipe it through the ship',
    say: 'pipe it through the ship',
    hint: 'Everyone aboard knows somebody on that list.',
    result: 'The list is read on all decks. Two names on it are known here.',
    hours: 0.2,
    xp: 30,
  },
  {
    id: 'navigational_buoy',
    from: 'comms',
    title: 'Automated beacon',
    text: 'A beacon on the distress band — automated, decades old, and '
      + 'repeating a hazard warning for a star that has since stopped being one.',
    answer: 'Update it and move on',
    say: 'update it',
    hint: 'Somebody has to, and nobody has since 2251.',
    result: 'The beacon carries a current warning now. Small work, honest work.',
    hours: 0.5,
    xp: 50,
    standing: 1,
  },
  {
    id: 'medical_consult',
    from: 'comms',
    title: 'Medical consult',
    text: 'A freighter master is asking for the doctor. One of his people has '
      + 'something he has never seen and no surgeon closer than Starbase 11.',
    answer: 'Put the doctor on',
    say: 'put the doctor on',
    hint: 'A consultation over subspace, and a diagnosis.',
    result: 'A diagnosis, a treatment, and a very quiet thank you.',
    hours: 0.7,
    xp: 70,
    standing: 3,
  },
  {
    id: 'shore_request',
    from: 'bridge',
    title: 'A request from the crew',
    text: 'The department heads have put a note in front of you. The watch has '
      + 'been long and they are asking for a night of it back.',
    answer: 'Grant it',
    say: 'grant it',
    hint: 'The best part of two hours. The watch comes back sharp.',
    result: 'The mess is opened, the music is bad, and every officer aboard is '
      + 'ready for whatever is next.',
    hours: 1.6,
    xp: 40,
    // The one real effect the game can give a rested watch, and it is a good
    // one: every bridge officer's tray comes off cooldown. There is no morale
    // stat in this game, and inventing one to justify a line of prose would be
    // the wrong way round — this uses what is already modelled, and a captain
    // who spends two hours before a border crossing gets a full tray for it.
    rested: true,
  },
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

export function rollEncounter(rng, systemId, {
  ledger, inTransit = false, quietInHostileSpace = false, halveHostile = false,
  distressSooner = false, challengeBy = null, player = null,
} = {}) {
  const system = SYSTEM_BY_ID[systemId];
  if (!system) return null;
  const presence = SECTOR_PRESENCE[system.sector] ?? { independent: 2 };

  // A warship in a demilitarised zone is not rolled for. Somebody comes and
  // asks about it — see RESEARCH.md §25, and `Game.enterTheDMZ`, which is what
  // decides that this is one of those arrivals.
  if (challengeBy) return buildChallenge(rng, system, challengeBy, ledger);

  // What a garrison sees coming. Zero when the caller does not pass a ship,
  // which leaves the presence table on its own and is what every test that
  // rolls encounters without a game does.
  const intruder = player ? shipPower(player) : 0;

  // Safe space is mostly quiet; the frontier is not.
  let danger = system.faction === 'federation' && !system.contested ? 0.18
    : system.contested ? 0.6
    : system.unexplored ? 0.55
    : system.hazard ? 0.5
    : 0.4;

  // "Signal Dampening — encounters trigger less often in hostile space."
  // Seventy Tokens of Regard, and it did nothing at all: the perk went into a
  // Set nothing read. In hostile space only, which is what it says and what
  // Romulan signal work would plausibly buy — a quiet ship is harder to find
  // where somebody is looking for you, and nobody is looking at Vulcan.
  if (quietInHostileSpace && system.faction !== 'federation') danger *= 0.6;

  // Traps are rare and are not gated on danger: a gravimetric shear does not
  // care whose space you are in.
  if (rng.chance(system.hazard ? 0.1 : 0.045)) return buildTrap(rng, system);

  if (rng.float() > danger && !inTransit) {
    // Nothing much happened — but "nothing much" is most of a five-year
    // mission and it was a coin flip between silence and a generic anomaly.
    // Three ways for a quiet watch to go now, and the anomaly is the least
    // likely of them: it is the one that repeats.
    if (rng.chance(0.55)) return { kind: 'quiet', system };
    return rng.chance(0.5) ? buildSignal(rng, system) : buildAnomaly(rng, system);
  }

  const table = [
    { kind: 'patrol', weight: 30 },
    // "A Name They Know — distress calls reach you sooner." A ship people
    // have heard of is the one they call, and they call it earlier; this is
    // the weight of somebody needing you rather than something else happening.
    { kind: 'distress', weight: (system.faction === 'federation' ? 22 : 14) * (distressSooner ? 2 : 1) },
    { kind: 'derelict', weight: 10 },
    { kind: 'anomaly', weight: system.anomalous ? 30 : 12 },
    { kind: 'ambush', weight: system.contested || system.border ? 24 : 8 },
    { kind: 'convoy', weight: 10 },
    { kind: 'first_contact', weight: system.unexplored ? 22 : 2 },
    // Traffic is thickest where people are, which is the opposite of every
    // other row in this table.
    { kind: 'signal', weight: system.faction === 'federation' ? 14 : 6 },
  ];
  const pick = rng.weighted(table);

  const built = (() => {
    switch (pick.kind) {
      case 'patrol': return buildPatrol(rng, system, presence, ledger, intruder);
      case 'ambush': return buildAmbush(rng, system, presence, ledger, intruder);
      case 'distress': return buildDistress(rng, system);
      case 'derelict': return buildDerelict(rng, system);
      case 'convoy': return buildConvoy(rng, system, presence);
      case 'first_contact': return buildFirstContact(rng, system);
      case 'signal': return buildSignal(rng, system);
      case 'anomaly':
      default: return buildAnomaly(rng, system);
    }
  })();

  // "Trader Network — hostile encounters in charted space are halved."
  //
  // Applied to what was BUILT rather than to the weights, because whether a
  // patrol is hostile depends on the captain's standing and is not knowable
  // from the table. Halving the ambush weight would also have halved the
  // friendly patrols, which is not what a trader network sells.
  //
  // The caller decides what "charted" means — it passes the flag only for a
  // system the ship has actually visited.
  if (halveHostile && built?.hostile && rng.chance(0.5)) {
    return rng.chance(0.45) ? { kind: 'quiet', system } : buildAnomaly(rng, system);
  }
  return built;
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

/**
 * How much force a faction has out here, in Constitutions.
 *
 * `SECTOR_PRESENCE` already says this and has said it since the map was
 * written: Klingons are a 1 at Andor and a 9 at Qo'noS. Until now the number
 * only decided WHO you met, never how much of them — a patrol was `rng.int(1,2)`
 * hulls in both places, so a border sweep and the defence of the homeworld were
 * the same encounter with a different adjective.
 *
 * Per point of presence. A 9 is a fight a Constitution should think about; a 1
 * is a single light hull asking what you are doing here.
 */
const STRENGTH_PER_PRESENCE = 0.22;

/** An ambush is chosen by the people springing it. It is heavier on purpose. */
const AMBUSH_MULTIPLIER = 1.7;

/** Raiders shooting up a freighter brought enough for a freighter. */
const RAIDER_STRENGTH = 0.5;

/**
 * How much of what a captain is flying a defence force answers with.
 *
 * Presence alone tops out at nine, so the heaviest patrol in the game was worth
 * 2.0 Constitutions and a Sovereign is worth 6.8 of one. Measured over four
 * thousand rolls, the band a hostile encounter came out at:
 *
 *     ship           no contest  favourable  even  dangerous  outmatched
 *     Miranda                0%          0%   24%        26%         46%
 *     Constitution           0%         24%   26%        22%         24%
 *     Excelsior             50%         13%   27%         6%          0%
 *     Galaxy                63%         28%    5%         0%          0%
 *     Sovereign             67%         30%    0%         0%          0%
 *
 * A flagship never met anything. This is not the enemy scaling to the player —
 * it is a garrison seeing a warship coming and sending what that is worth, and
 * it is scaled by presence, so it is a real answer at Qo'noS and a shrug at
 * Andor. A Miranda over Qo'noS is still in exactly as much trouble as it was:
 * a 0.36 response added to a 2.0 garrison changes nothing about a 0.45 ship.
 *
 * The coefficient was swept rather than chosen, over the same four thousand
 * rolls split by where the ship actually is — home space, the near frontier,
 * and deep space — reading the share of hostile encounters that came out
 * dangerous or worse:
 *
 *     coefficient   Constitution near   Excelsior deep   Sovereign deep
 *     0.42                        29%              27%              1%
 *     0.60                        39%              37%              7%
 *     0.80                        41%              47%             11%
 *     1.00                        42%              57%             27%
 *
 * 0.80 is where a flagship finally has something to worry about without an
 * Excelsior spending half the map being hunted. At 1.00 the Excelsior's
 * favourable band collapses from 26% to 1%, which is a ship that has stopped
 * having good days.
 */
const RESPONSE_TO_INTRUDER = 0.8;

/** The presence table's own ceiling, so a response is a fraction of a full one. */
const FULL_PRESENCE = 9;

const forceStrength = (presence, factionId, { scale = 1, playerPower = 0 } = {}) => {
  const here = presence?.[factionId] ?? 2;
  const garrison = here * STRENGTH_PER_PRESENCE;
  const answer = RESPONSE_TO_INTRUDER * Math.max(0, playerPower) * (here / FULL_PRESENCE);
  return Math.max(0.15, (garrison + answer) * scale);
};

function pickFaction(rng, presence, { exclude = ['federation'] } = {}) {
  const options = Object.entries(presence)
    .filter(([id]) => !exclude.includes(id))
    .map(([id, weight]) => ({ id, weight }));
  if (!options.length) return 'independent';
  return rng.weighted(options).id;
}

function buildPatrol(rng, system, presence, ledger, intruder = 0) {
  const factionId = pickFaction(rng, presence);
  const standing = ledger?.standingOf(factionId) ?? FACTIONS[factionId]?.baseStanding ?? 0;
  const hostile = isHostile(standing);
  const errand = rng.pick(PATROL_ERRANDS);
  return {
    kind: 'patrol', system, factionId, hostile,
    ships: makeShips(rng, factionId, forceStrength(presence, factionId, { playerPower: intruder })),
    hailable: FACTIONS[factionId]?.hailable ?? false,
    subtype: hostile ? 'intercept' : errand.id,
    title: `${FACTIONS[factionId]?.adjective ?? 'Unknown'} patrol`,
    text: hostile
      ? `${FACTIONS[factionId].adjective} vessels closing on an intercept course. They are arming weapons.`
      : `${article(FACTIONS[factionId].adjective)} ${FACTIONS[factionId].adjective} `
        + `${errand.text}`,
  };
}

/**
 * What a patrol that is not hostile is actually doing out here.
 *
 * Measured over four thousand rolls, `patrol` was the single commonest
 * encounter in the game at 15% of everything — and it had exactly one line of
 * text. A government's ships have somewhere to be, and saying where is most of
 * what makes two encounters with the same faction feel like two encounters.
 */
const PATROL_ERRANDS = [
  { id: 'scanning', text: 'patrol is holding position and scanning us. No weapons charged — yet.' },
  { id: 'border_run', text: 'border cutter is running the line, and has slowed to look at us.' },
  { id: 'tender', text: 'tender is out here servicing navigation buoys, with an escort that would rather be elsewhere.' },
  { id: 'search', text: 'squadron is quartering the system in a search pattern. They do not say what for.' },
  { id: 'convoy_screen', text: 'destroyer is screening something we cannot see, and would like us to keep our distance.' },
  { id: 'relief', text: 'ship is running relief supplies and is behind schedule.' },
  { id: 'survey', text: 'survey ship is working a grid and is visibly annoyed at the interruption.' },
];

/**
 * Being asked what a warship is doing here.
 *
 * A patrol with a reason, rather than a patrol that happened. Their manner is
 * `buildPatrol`'s: a government that already dislikes you arrives on an
 * intercept course, one that tolerates you holds station and scans. What is
 * different is that they say why they have stopped you, and that the answer to
 * it — the treaty rider the Cardassian track sells — is a thing a captain can
 * go and earn.
 */
function buildChallenge(rng, system, factionId, ledger) {
  const patrol = buildPatrol(rng, system, { [factionId]: 1 }, ledger);
  const adj = FACTIONS[factionId]?.adjective ?? 'Unknown';
  return {
    ...patrol,
    challenge: true,
    hailable: FACTIONS[factionId]?.hailable ?? false,
    title: `Challenged in the ${SECTORS[system.sector]?.name ?? 'zone'}`,
    text: patrol.hostile
      ? `${adj} warships are closing, and they are not asking. This is a `
        + 'demilitarised zone and we are the largest weapon in it.'
      : `${article(adj)} ${adj} patrol has put itself across our bow and is `
        + 'asking, politely, what a starship of this tonnage is doing inside a '
        + 'demilitarised zone.',
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

function buildAmbush(rng, system, presence, ledger, intruder = 0) {
  const factionId = pickFaction(rng, presence, { exclude: ['federation', 'independent'] });
  return {
    kind: 'ambush', system, factionId, hostile: true, surprise: true,
    ships: makeShips(rng, factionId, forceStrength(presence, factionId,
      { scale: AMBUSH_MULTIPLIER, playerPower: intruder })),
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
    ships: pick.hostile ? makeShips(rng, factionId, RAIDER_STRENGTH) : [],
    victims: pick.hostile ? [new Ship('freighter', { name: 'SS Kobayashi', faction: 'independent' })] : [],
    lives: rng.int(80, 2400),
    title: 'Distress call',
    text: pick.text,
    // Ignoring a distress call is a real choice with a real cost.
    ignorable: true,
  };
}

/**
 * What kind of dead ship it is.
 *
 * Three lines of text and no other difference, before this: the risk was rolled
 * separately from the description, so "something cut it open from the inside"
 * could be the safest derelict in the game and a quiet intact hull the most
 * dangerous. The risk belongs to the thing being described.
 */
const DERELICTS = [
  { id: 'intact', risk: [0.10, 0.22],
    text: 'A ship adrift, no power, no life signs on the first sweep. Hull is intact.' },
  { id: 'opened', risk: [0.42, 0.62],
    text: 'A drifting hulk. Something cut it open from the inside.' },
  { id: 'biosigns', risk: [0.35, 0.55],
    text: 'An unregistered vessel, dark, tumbling slowly. Sensors read faint biosigns.' },
  { id: 'scuttled', risk: [0.18, 0.30],
    text: 'A freighter, scuttled deliberately and recently. The hold was emptied first.' },
  { id: 'ancient', risk: [0.25, 0.40],
    text: 'A hull of no configuration in the database, and metallurgy that says it has '
      + 'been out here a very long time.' },
  { id: 'starfleet', risk: [0.30, 0.48],
    text: 'A Starfleet hull. The registry is burned off and the log buoy is gone.' },
  { id: 'plague', risk: [0.50, 0.70],
    text: 'A transport with her running lights still on, her hatches sealed from outside, '
      + 'and a quarantine beacon nobody has answered.' },
];

function buildDerelict(rng, system) {
  const d = rng.pick(DERELICTS);
  return {
    kind: 'derelict', system,
    subtype: d.id,
    title: 'Derelict vessel',
    text: d.text,
    salvage: rng.pick(SALVAGE_POOL),
    // The risk belongs to the wreck being described, not to a separate roll.
    risk: rng.range(d.risk[0], d.risk[1]),
    hostile: false,
  };
}

/**
 * What the convoy is carrying, and what it is worth to them to arrive.
 *
 * The reward was a flat 200–700 with no relation to the cargo, so escorting
 * medical supplies through a war zone and escorting grain paid the same. The
 * cargo sets the purse and the purse says what the run is.
 */
const CARGOES = [
  { id: 'grain', pay: [180, 320], text: 'grain hulls, riding low and slow' },
  { id: 'medical', pay: [420, 760], text: 'medical freighters on a deadline they will not discuss' },
  { id: 'colonists', pay: [300, 560], text: 'colony transports with four thousand people aboard' },
  { id: 'dilithium', pay: [600, 980], text: 'ore carriers under seal, and a purser who keeps counting them' },
  { id: 'machinery', pay: [260, 480], text: 'heavy-lift ships carrying a shipyard in pieces' },
  { id: 'unspecified', pay: [500, 900], text: 'three unmarked hulls whose master will not say what is in them' },
];

function buildConvoy(rng, system, presence) {
  const factionId = pickFaction(rng, presence, { exclude: [] });
  const adj = FACTIONS[factionId]?.adjective ?? 'civilian';
  const cargo = rng.pick(CARGOES);
  return {
    kind: 'convoy', system, factionId, hostile: false,
    subtype: cargo.id,
    title: 'Merchant convoy',
    text: `${article(adj)} ${adj} convoy — ${cargo.text} — hails us for an escort `
      + 'through the sector.',
    hailable: true,
    escortReward: rng.int(cargo.pay[0], cargo.pay[1]),
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

/**
 * A signal, and whether it is worth the ship's time.
 *
 * Deliberately not gated on anything: a courier finds you wherever you are,
 * and a beacon nobody has serviced since 2251 is more likely on the frontier
 * than at Earth, not less.
 */
function buildSignal(rng, system) {
  const sig = rng.pick(SIGNALS);
  return {
    kind: 'signal', system, hostile: false, hailable: false,
    subtype: sig.id,
    // Who is telling you. `beginEncounter` prints this as the station heading
    // on the panel, and a note from the department heads is not a sensor
    // reading.
    from: sig.from ?? 'comms',
    signal: sig,
    title: sig.title,
    text: sig.text,
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

/** @param strength in Constitutions — see `buildHostiles`, not a hull count. */
function makeShips(rng, factionId, strength) {
  const pool = FLEETS[factionId] ?? ['orion_raider'];
  // One table, in src/sim/combat.js. This file used to carry its own copy,
  // which is how a Klingon cruiser could be an IKS Rotarran in an encounter
  // and "klingon vessel 1" when a mission stage started the same fight.
  return buildHostiles(rng, factionId, strength, pool);
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
