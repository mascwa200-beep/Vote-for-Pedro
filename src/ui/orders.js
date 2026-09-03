// Natural-language order parsing.
//
// "Helm, set course for Vulcan, warp eight" has to work, and so does
// "warp 8 vulcan". The grammar is intentionally forgiving: match the verb,
// then hunt the rest of the line for the arguments that verb needs.

import { SYSTEMS } from '../world/systems.data.js';
import { SUBSYSTEMS } from '../sim/power.js';
import { FACINGS } from '../sim/ship.js';
import { ABILITIES } from '../sim/officers.js';
import { parseText, CONFIDENT } from '../lang/parse.js';
import { intentHelp, phraseCount, INTENTS, STATION_AFFINITY } from '../lang/lexicon.js';
import { findRoom } from '../world/interiors.data.js';
import { addressedTo } from '../sim/address.js';

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, half: 0.5, full: 1, maximum: 1, max: 1, all: 1, none: 0, zero: 0,
};

// Strip the officer being addressed, when there is no roster to consult.
//
// This is the fallback. It knows honorifics and posts and cannot know a NAME,
// because a captain may serve with the 1966 crew, the 1987 crew, or seven
// people the game generated this morning. When a crew is passed to
// `parseOrder`, src/sim/address.js does this properly and says who was spoken
// to; this list is what is left for the callers that have no crew to hand.
const ADDRESS = /^\s*(?:mister|mr\.?|miss|ms\.?|commander|lieutenant|ensign|doctor|chief|number one|helm|tactical|engineering|science|comms?|communications|bridge|computer)\s*,?\s*/i;

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function stripAddress(text) {
  let out = text;
  // Officers can be addressed by name too.
  for (let i = 0; i < 2; i++) out = out.replace(ADDRESS, '');
  return out.trim();
}

function parseNumber(text, fallback = null) {
  const digits = text.match(/\b(\d+(?:\.\d+)?)\b/);
  if (digits) return parseFloat(digits[1]);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }
  return fallback;
}

/** Fuzzy-match a destination by name or id. */
function findSystem(text) {
  const t = normalize(text);
  let best = null;
  let bestLen = 0;
  for (const s of SYSTEMS) {
    const candidates = [s.name.toLowerCase(), s.id.replace(/_/g, ' ')];
    for (const c of candidates) {
      if (t.includes(c) && c.length > bestLen) { best = s; bestLen = c.length; }
    }
    // "DS9", "the badlands", loose forms
    const short = s.name.toLowerCase().replace(/^(the|uss|starbase)\s+/, '');
    if (short.length > 3 && t.includes(short) && short.length > bestLen) {
      best = s; bestLen = short.length;
    }
  }
  return best;
}

function findFacing(text) {
  if (/\b(forward|fore|front|bow)\b/.test(text)) return 'fore';
  if (/\b(aft|rear|stern|behind)\b/.test(text)) return 'aft';
  if (/\bport\b/.test(text)) return 'port';
  if (/\b(starboard|stbd)\b/.test(text)) return 'starboard';
  return null;
}

function findSubsystem(text) {
  if (/\b(weapon|weapons|phaser|phasers|guns)\b/.test(text)) return 'weapons';
  if (/\b(shield|shields|deflector)\b/.test(text)) return 'shields';
  if (/\b(engine|engines|impulse|propulsion)\b/.test(text)) return 'engines';
  if (/\b(aux|auxiliary|sensors|science)\b/.test(text)) return 'auxiliary';
  return null;
}

function findTargetSubsystem(text) {
  if (/\b(weapon|weapons|disruptor|phaser)\b/.test(text)) return 'weapons';
  if (/\b(shield|shields)\b/.test(text)) return 'shields';
  if (/\b(engine|engines|nacelle|nacelles|impulse)\b/.test(text)) return 'engines';
  if (/\b(warp core|core|reactor)\b/.test(text)) return 'warpcore';
  if (/\b(sensor|sensors)\b/.test(text)) return 'sensors';
  if (/\b(life support|lifesupport)\b/.test(text)) return 'lifesupport';
  return null;
}

/**
 * The order table. Each entry: { id, test, build }.
 * `build` returns the command object the game executes.
 */
const ORDERS = [
  // ---- Navigation ----
  {
    id: 'set_course',
    help: 'Helm, set course for <system>, warp <n>',
    // Naming a compartment rules this out. Without the guard the regex layer
    // claimed "go to sickbay" and answered "Which system, Captain?" — the same
    // failure as in the lexicon, arriving one layer lower down.
    test: (t, raw) => !findRoom(raw ?? t)
      && (/\b(set (a )?course|lay in a course|plot a course|course for|take us to|head for|make for|proceed to|go to|warp to)\b/.test(t)
        || (/\bwarp\s*\d/.test(t) && findSystem(t))),
    build: (t) => {
      const system = findSystem(t);
      if (!system) return { error: 'Which system, Captain?' };
      const warpMatch = t.match(/warp\s*(?:factor\s*)?(\d+(?:\.\d+)?)/);
      const warp = warpMatch ? parseFloat(warpMatch[1]) : (parseNumber(t.replace(/\d+\s*(percent|%)/, ''), null) ?? 6);
      return { action: 'course', system: system.id, warp: Math.max(1, Math.min(9.9, warp)) };
    },
  },
  {
    id: 'warp_factor',
    help: 'Warp <n>',
    test: (t) => /^warp\s*(factor\s*)?\d/.test(t),
    build: (t) => ({ action: 'warp_factor', warp: parseNumber(t, 6) }),
  },
  {
    id: 'all_stop',
    help: 'All stop',
    test: (t) => /\ball stop\b|\bfull stop\b|\bhold position\b|\bstation keeping\b/.test(t),
    build: () => ({ action: 'throttle', value: 0 }),
  },
  {
    id: 'ahead',
    help: 'Ahead full / ahead one third',
    test: (t) => /\bahead\b|\bimpulse\b|\bthrottle\b/.test(t),
    build: (t) => {
      let v = 1;
      if (/one third|1\/3/.test(t)) v = 0.33;
      else if (/two thirds|2\/3/.test(t)) v = 0.66;
      else if (/half/.test(t)) v = 0.5;
      else if (/slow|dead slow/.test(t)) v = 0.2;
      else {
        const pct = t.match(/(\d+)\s*(?:percent|%)/);
        if (pct) v = Math.min(1, parseInt(pct[1], 10) / 100);
      }
      return { action: 'throttle', value: v };
    },
  },
  {
    id: 'come_about',
    help: 'Come about / bring us around',
    test: (t) => /\bcome about\b|\bbring us (a)?round\b|\bturn (in)?to them\b|\bface them\b|\bcome to bearing\b/.test(t),
    build: (t) => {
      const deg = t.match(/bearing\s*(\d+)/);
      return deg ? { action: 'heading', value: parseInt(deg[1], 10) } : { action: 'come_about' };
    },
  },
  {
    id: 'evasive',
    help: 'Evasive manoeuvres',
    test: (t) => /\bevasive\b/.test(t),
    build: (t) => ({ action: 'evasive', value: !/\b(cancel|belay|stop|end|resume)\b/.test(t) }),
  },
  {
    id: 'warp_out',
    help: 'Get us out of here',
    test: (t) => /\b(get us out|break off|disengage|retreat|withdraw|run|flee)\b/.test(t),
    build: () => ({ action: 'warp_out' }),
  },
  {
    id: 'dock',
    help: 'Request docking',
    test: (t) => /\bdock\b|\brequest docking\b|\bput in for repairs\b|\bresupply\b/.test(t),
    build: () => ({ action: 'dock' }),
  },

  // ---- Alert & shields ----
  {
    id: 'alert',
    help: 'Red alert / yellow alert / stand down',
    test: (t) => /\b(red alert|yellow alert|battle stations|stand down|condition green)\b/.test(t),
    build: (t) => ({
      action: 'alert',
      level: /red alert|battle stations/.test(t) ? 'red'
        : /yellow/.test(t) ? 'yellow' : 'normal',
    }),
  },
  {
    id: 'shields',
    help: 'Shields up / shields down',
    test: (t) => /\bshields?\s*(up|down|raise|lower)\b|\braise shields?\b|\blower shields?\b|\bdrop shields?\b/.test(t),
    build: (t) => ({ action: 'shields', up: !/\b(down|lower|drop)\b/.test(t) }),
  },
  {
    id: 'reinforce',
    help: 'Reinforce forward shields',
    test: (t) => /\b(reinforce|strengthen|bolster|all power to the)\b.*\bshield/.test(t)
      || (/\bshield/.test(t) && findFacing(t) && /\breinforce|transfer\b/.test(t)),
    build: (t) => {
      const facing = findFacing(t);
      return facing ? { action: 'reinforce', facing } : { error: 'Which facing, Captain?' };
    },
  },

  // ---- Power ----
  {
    id: 'power',
    help: 'Divert power to shields / weapons / engines',
    test: (t) => /\b(divert|reroute|transfer|shift|shunt|route)\b.*\bpower\b/.test(t)
      || /\bpower to\b/.test(t) || /\ball (available )?power to\b/.test(t),
    build: (t) => {
      const sub = findSubsystem(t);
      if (!sub) return { error: 'Power to which system, Captain?' };
      const pct = t.match(/(\d+)\s*(?:percent|%)/);
      const amount = /\ball\b|\bmaximum\b|\beverything\b/.test(t) ? 100
        : pct ? parseInt(pct[1], 10) : 25;
      return { action: 'power', subsystem: sub, amount };
    },
  },
  {
    id: 'power_preset',
    help: 'Attack pattern power / defensive posture / balanced power',
    test: (t) => /\b(attack|defensive|defence|defense|speed|science|balanced|standard)\s*(power|posture|configuration|distribution|preset)\b/.test(t),
    build: (t) => ({
      action: 'preset',
      preset: /attack/.test(t) ? 'attack'
        : /defen[cs]/.test(t) ? 'defense'
        : /speed/.test(t) ? 'speed'
        : /science/.test(t) ? 'science' : 'balanced',
    }),
  },

  // ---- Weapons ----
  {
    id: 'target_subsystem',
    help: 'Target their engines / weapons / shields',
    test: (t) => /\btarget(ing)?\b/.test(t) && findTargetSubsystem(t),
    build: (t) => ({ action: 'target_subsystem', subsystem: findTargetSubsystem(t) }),
  },
  {
    id: 'target',
    help: 'Target the lead ship / next target',
    test: (t) => /\btarget\b|\block (weapons )?on\b|\bnext target\b|\bswitch targets?\b/.test(t),
    build: (t) => /\bnext|switch|cycle\b/.test(t)
      ? { action: 'cycle_target' }
      : { action: 'target_nearest' },
  },
  // Ahead of `fire` on purpose: these tests run in order, and /\bfire\b/
  // matches "cease fire" perfectly well.
  {
    id: 'cease_fire',
    help: 'Cease fire / hold fire',
    test: (t) => /\bcease fire\b|\bhold fire\b|\bstop firing\b|\bweapons hold\b/.test(t),
    build: () => ({ action: 'cease_fire' }),
  },
  {
    id: 'fire',
    help: 'Fire / fire phasers / fire torpedoes',
    test: (t) => /\bfire\b|\bopen fire\b|\bshoot\b|\bengage them\b|\bweapons free\b/.test(t),
    build: (t) => ({
      action: 'fire',
      weaponType: /torpedo|photon/.test(t) ? 'torpedo'
        : /phaser|beam|disruptor/.test(t) ? 'beam' : 'all',
    }),
  },

  // ---- Comms ----
  {
    id: 'hail',
    help: 'Open a channel / hail them',
    test: (t) => /\bhail\b|\bopen a channel\b|\bopen channel\b|\bon screen\b|\bput them on\b/.test(t),
    build: () => ({ action: 'hail' }),
  },
  {
    id: 'surrender_demand',
    help: 'Demand their surrender',
    test: (t) => /\bdemand (their )?surrender\b|\btell them to surrender\b/.test(t),
    build: () => ({ action: 'hail_option', option: 'demand_surrender' }),
  },

  // ---- Ship's systems ----
  {
    id: 'scan',
    help: 'Scan them / full sensor sweep',
    test: (t) => /\bscan\b|\bsensor sweep\b|\banaly[sz]e\b|\breadings\b/.test(t),
    build: () => ({ action: 'scan' }),
  },
  {
    id: 'status',
    help: 'Damage report / status report',
    test: (t) => /\b(damage report|status report|report|status|how are we)\b/.test(t),
    build: () => ({ action: 'status' }),
  },
  {
    id: 'eject_core',
    help: 'Eject the warp core',
    test: (t) => /\beject (the )?(warp )?core\b/.test(t),
    build: () => ({ action: 'eject_core' }),
  },
  {
    id: 'brace',
    help: 'All hands brace for impact',
    test: (t) => /\bbrace\b/.test(t),
    build: () => ({ action: 'ability', ability: 'brace_for_impact' }),
  },
  {
    id: 'away_team',
    help: 'Assemble an away team',
    test: (t) => /\baway team\b|\bbeam down\b|\blanding party\b/.test(t),
    build: (t) => ({ action: 'away_team', captainLeads: /\bi'?ll lead\b|\bwith me\b|\bi'?m going\b/.test(t) }),
  },
  {
    id: 'transporter',
    help: 'Energize',
    test: (t) => /\benergi[sz]e\b|\bbeam (them|him|her|it) (up|aboard)\b/.test(t),
    build: () => ({ action: 'transport' }),
  },
];

/**
 * Asking for somebody to be TAUGHT a thing rather than to do it.
 *
 * Deliberately narrow. "Drill" is in because a drill is training; "practise"
 * and "rehearse" are not, because `boarding_drill` and the duty details already
 * own that sense and mean something else by it.
 */
const TRAINING = /\b(?:train|trains|training|trained|teach|teaches|teaching|taught|qualify|qualified|instruct|instructed)\b/;

/** Abilities are addressable by their order phrase, e.g. "attack pattern alpha". */
function matchAbility(t) {
  for (const a of Object.values(ABILITIES)) {
    if (t.includes(normalize(a.order))) return a.id;
    // The ability's own name also addresses it — but only when the name is
    // distinctive. A one-word name like "Brace" swallows every sentence it
    // appears in, so "brace the port shields" became a bridge-officer power
    // instead of an order to reinforce a shield facing.
    const name = normalize(a.name);
    if (name.includes(' ') && t.includes(name)) return a.id;
  }
  return null;
}

/**
 * Parse a typed order.
 *
 * Order of precedence, and the reasoning for it:
 *
 *  1. Bridge officer abilities. "Evasive manoeuvres" is a trained power before
 *     it is a helm instruction, so it wins — but it carries the ordinary
 *     reading as a fallback for when nobody aboard can execute it.
 *  2. The scoring pipeline, when it is confident. It weighs the whole sentence,
 *     which the table cannot: the table tests regexes in file order, so
 *     `/\bfire\b/` sitting above `cease fire` meant "cease fire" opened fire,
 *     and `/\bimpulse\b/` above the targeting rule meant "target their impulse
 *     engines" was read as a throttle change. Those were real bugs, and this
 *     ordering is what fixes them.
 *  3. The table, for anything the pipeline was unsure about. It is exact and
 *     cheap, and it is the safety net for phrasings the lexicon has not learned.
 *  4. The pipeline again, at lower confidence, so an uncertain reading still
 *     reaches the captain as a question rather than as silence.
 *
 * @returns {object} one of
 *   { action, ... }                     execute it
 *   { confirm, order, alternatives }    understood, but ask first
 *   { error }                           understood, missing something
 *   { unknown: true, suggestions }      not understood
 */
export function parseOrder(raw, crew = null) {
  if (!raw || !raw.trim()) return { unknown: true };

  // Who was spoken to, if the caller knows who is aboard.
  //
  // "Mr. Sulu, warp six" and "warp six" are the same order; the difference is
  // that the first one is said to somebody, and that somebody should be the
  // one who answers. Resolving it here rather than inside each intent means
  // every order in the game gets it, including the ones added tomorrow.
  const address = crew ? addressedTo(raw, crew) : null;
  const said = address?.order ?? raw;

  const full = normalize(said);
  const t = crew ? full : stripAddress(full);

  const plain = matchPlainOrder(t, said);
  const natural = parseText(said);

  // Whatever the order turns out to be, it remembers who it was given to.
  const to = (order) => (address?.station || address?.officer
    ? { ...order, raw, addressee: { station: address.station, name: address.officer?.name ?? null, form: address.form } }
    : { ...order, raw });

  // Training somebody in an ability is not using it.
  //
  // `matchAbility` matches any line CONTAINING an ability's order phrase or its
  // name, and it runs first, so "train high yield torpedoes" was read as an
  // order to FIRE high yield torpedoes — an ability the officer does not have
  // yet, which is the entire reason you were asking to train them in it. There
  // was no phrase that trained anybody, in either direction: the Train button
  // printed the ability's ORDER phrase underneath itself, which is the words
  // that use it once learned.
  const ability = matchAbility(t);
  if (ability && TRAINING.test(t)) return to({ action: 'train', ability });
  if (ability) {
    const fallback = plain && !plain.unknown && !plain.error ? plain
      : (natural && !natural.unknown && !natural.confirm ? natural : null);
    return to({ action: 'ability', ability, fallback });
  }

  if (natural?.action && natural.confidence >= CONFIDENT) return to(natural);
  if (plain && !plain.unknown && !plain.error) return to(plain);
  if (natural && !natural.unknown) return to(natural);

  return to(plain?.error ? plain : natural);
}

function matchPlainOrder(t, raw) {
  for (const order of ORDERS) {
    // `raw` is passed so a test can consult the UNSTRIPPED line. Only
    // `set_course` needs it, and it needs it badly: it owns the phrase "go to",
    // and "go to sickbay" is not a course.
    if (order.test(t, raw)) {
      const built = order.build(t);
      return { ...built, orderId: order.id, raw };
    }
  }
  return { unknown: true, raw };
}

// Which department an order belongs to, for the reference sheet. The lexicon
// already carries this as station -> intent ids, for tie-breaking when an order
// is addressed to somebody; inverting it here gives the grouping for free
// rather than maintaining a second table that can drift out of step.
const STATION_OF = (() => {
  const map = {};
  for (const [station, ids] of Object.entries(STATION_AFFINITY)) {
    for (const id of ids) if (!(id in map)) map[id] = station;
  }
  // `intercom` is pushed onto every station's list, so the inversion above
  // assigns it to whichever came first.
  //
  // The rest of these are orders the affinity table does not carry, because
  // affinity exists to break ties when an order is ADDRESSED to a station and
  // nobody says "tactical, red alert". They are grouped here by where the
  // control physically is, which is what a reference sheet is for. Anything not
  // listed falls through to Command, so a new intent appears in the manual by
  // default rather than being dropped from it.
  Object.assign(map, {
    intercom: 'chair', alert: 'chair', jettison_pod: 'chair',
    viewscreen: 'chair', magnify: 'chair', log_entry: 'chair',
    hand_over_con: 'chair', take_con: 'chair', watch_bill: 'chair',
    chart_tilt: 'helm',
    diagnostic: 'engineering',
    fabricate: 'engineering', work_shop: 'engineering', salvage: 'engineering',
  });
  return map;
})();

const STATION_LABEL = {
  helm: 'Helm',
  tactical: 'Tactical',
  engineering: 'Engineering',
  science: 'Science',
  comms: 'Communications',
  medical: 'Sickbay',
  transporter: 'Transporter room',
  security: 'Security',
  chair: 'The chair',
  command: 'Command',
};

// The order the departments read in, which is roughly the order you use them.
const STATION_ORDER = [
  'helm', 'tactical', 'engineering', 'science', 'comms',
  'transporter', 'medical', 'security', 'chair', 'command',
];

/**
 * Every order the game understands, grouped by the station that carries it out,
 * with the alternate phrasings the parser accepts.
 *
 * This exists because the parser is much more forgiving than it looks, and a
 * player who has only ever seen the buttons has no way to discover that. The
 * phrasings are the point: showing that "come about", "bring us around" and
 * "get our nose on them" are the same order is what teaches you that you can
 * simply say what you mean.
 *
 * @param {number} examples how many phrasings to show per order
 */
export function commandReference({ examples = 4 } = {}) {
  const groups = new Map();
  const push = (station, entry) => {
    if (!groups.has(station)) groups.set(station, []);
    groups.get(station).push(entry);
  };

  for (const intent of INTENTS) {
    push(STATION_OF[intent.id] ?? 'command', {
      id: intent.id,
      help: intent.help,
      // Longest first is how the lexicon sorts them, and the longest phrasings
      // are the most natural-sounding ones — which is what to show.
      examples: intent.phrases.slice(0, examples),
      total: intent.phrases.length,
    });
  }

  const out = [];
  for (const station of STATION_ORDER) {
    const entries = groups.get(station);
    if (entries?.length) out.push({ station, label: STATION_LABEL[station] ?? station, entries });
  }
  // Anything the lexicon grows a station for that this file has not been told
  // about still appears, rather than silently vanishing from the manual.
  for (const [station, entries] of groups) {
    if (!STATION_ORDER.includes(station)) {
      out.push({ station, label: STATION_LABEL[station] ?? station, entries });
    }
  }

  return {
    groups: out,
    abilities: Object.values(ABILITIES).map((a) => ({ name: a.name, order: a.order })),
    phrasings: phraseCount(),
    intents: INTENTS.length,
  };
}

/** Everything the parser understands, for the manual and the help sheet. */
export function orderHelp() {
  const base = ORDERS.map((o) => o.help);
  const abilities = Object.values(ABILITIES).map((a) => a.order);
  const natural = intentHelp().map((i) => i.help);
  return {
    orders: [...new Set([...base, ...natural])],
    abilities: [...new Set(abilities)],
    phrasings: phraseCount(),
  };
}

export { findSystem, SUBSYSTEMS, FACINGS };
