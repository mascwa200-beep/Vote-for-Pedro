// Entity extraction: the nouns an order can be about.
//
// Everything here is derived from the game's own data at load time rather than
// restated. If a system is added to systems.data.js it becomes addressable by
// name in the same breath, with fuzzy and phonetic matching for free — which is
// the whole reason this file reads the data instead of listing it.

import { SYSTEMS } from '../world/systems.data.js';
import { FACTION_LIST } from '../world/factions.data.js';
import { SUBSYSTEMS } from '../sim/power.js';
import { RECIPES } from '../sim/fabrication.js';
import { FACINGS } from '../sim/ship.js';
import { similarity } from './fuzzy.js';
import { soundsLike } from './phonetic.js';

/** Words that are never a destination even though they look like nouns. */
const NOT_A_PLACE = new Set([
  'course', 'warp', 'speed', 'power', 'shield', 'weapon', 'engine', 'target',
  'sensor', 'hull', 'crew', 'captain', 'ship', 'vessel', 'them', 'him', 'her',
  'space', 'system', 'sector', 'here', 'there', 'home', 'base',
]);

/** Aliases the data files do not carry but people certainly type. */
const PLACE_ALIASES = {
  earth: 'sol', terra: 'sol', 'sector 001': 'sol', home: 'sol',
  headquarters: 'sol', hq: 'sol', 'starfleet command': 'sol',
  ds9: 'terok_nor', 'deep space nine': 'terok_nor', 'deep space 9': 'terok_nor',
  'deep space': 'terok_nor', terok: 'terok_nor',
  kronos: 'qonos', "qo'nos": 'qonos', 'the homeworld': 'qonos',
  'the zone': 'neutral_zone_1', 'neutral zone': 'neutral_zone_1', rnz: 'neutral_zone_1',
  badlands: 'badlands_1', 'the badlands': 'badlands_1',
  'utopia planitia': 'utopia', 'the yards': 'utopia',
};

const FACING_WORDS = {
  fore: 'fore', forward: 'fore', front: 'fore', bow: 'fore', ahead: 'fore',
  aft: 'aft', rear: 'aft', stern: 'aft', behind: 'aft', back: 'aft',
  port: 'port', larboard: 'port', left: 'port',
  starboard: 'starboard', right: 'starboard',
  dorsal: 'dorsal', top: 'dorsal', upper: 'dorsal', above: 'dorsal',
  ventral: 'ventral', bottom: 'ventral', lower: 'ventral', below: 'ventral',
  underside: 'ventral', belly: 'ventral',
};

/** Our own power grid channels — where power can be sent. */
const POWER_WORDS = {
  weapon: 'weapons', phaser: 'weapons', gun: 'weapons', armament: 'weapons',
  shield: 'shields', deflector: 'shields', screen: 'shields',
  engine: 'engines', impulse: 'engines', propulsion: 'engines', drive: 'engines',
  thruster: 'engines', warp: 'engines',
  auxiliary: 'auxiliary', aux: 'auxiliary', sensor: 'auxiliary',
  science: 'auxiliary', computer: 'auxiliary', transporter: 'auxiliary',
};

/** Their systems — what a targeting order can single out. */
const TARGET_WORDS = {
  weapon: 'weapons', phaser: 'weapons', gun: 'weapons', torpedo: 'weapons',
  'weapon array': 'weapons', battery: 'weapons',
  shield: 'shields', deflector: 'shields', screen: 'shields',
  'shield generator': 'shields', 'shield emitter': 'shields',
  engine: 'engines', impulse: 'engines', nacelle: 'engines', thruster: 'engines',
  'impulse engine': 'engines', 'warp nacelle': 'engines', propulsion: 'engines',
  core: 'warpcore', reactor: 'warpcore', 'warp core': 'warpcore',
  'antimatter': 'warpcore', 'power plant': 'warpcore', 'warp drive': 'warpcore',
  sensor: 'sensors', 'sensor array': 'sensors', scanner: 'sensors', eyes: 'sensors',
  'life support': 'lifesupport', lifesupport: 'lifesupport',
  environmental: 'lifesupport', 'air supply': 'lifesupport',
  bridge: 'bridge', 'command deck': 'bridge',
};

/** Build a compact search index once, at module load. */
function buildPlaces() {
  const entries = [];
  for (const s of SYSTEMS) {
    const names = new Set([
      s.name.toLowerCase(),
      s.id.replace(/_/g, ' '),
    ]);
    // "the Enterprise incident" style prefixes people drop.
    const bare = s.name.toLowerCase().replace(/^(?:the|uss|iks|irw|starbase)\s+/, '');
    if (bare.length > 3) names.add(bare);
    // First word, when it is distinctive enough to stand alone.
    const first = bare.split(/[\s-]/)[0];
    if (first.length > 4) names.add(first);

    for (const n of names) {
      if (!n || NOT_A_PLACE.has(n)) continue;
      entries.push({ id: s.id, name: n, words: n.split(' ') });
    }
  }
  for (const [alias, id] of Object.entries(PLACE_ALIASES)) {
    if (SYSTEMS.some((s) => s.id === id)) {
      entries.push({ id, name: alias, words: alias.split(' ') });
    }
  }
  // Longest names first so "deep space 9" beats "deep space".
  entries.sort((a, b) => b.name.length - a.name.length);
  return entries;
}

const PLACES = buildPlaces();

const FACTION_NAMES = FACTION_LIST.flatMap((f) => {
  const out = [{ id: f.id, name: f.id }];
  if (f.name) out.push({ id: f.id, name: f.name.toLowerCase() });
  if (f.adjective) out.push({ id: f.id, name: f.adjective.toLowerCase() });
  return out;
});

/**
 * Find a destination in the order text.
 * Exact substring first, then per-token fuzzy and phonetic, so "set course for
 * vulkan" and "take us to andoria" both land.
 * @returns {{id: string, name: string, exact: boolean}|null}
 */
export function findPlace(text, tokens) {
  for (const p of PLACES) {
    if (text.includes(p.name)) return { id: p.id, name: p.name, exact: true };
  }

  let best = null;
  for (const p of PLACES) {
    if (p.words.length > 1) continue;      // single-word fuzzing only
    for (const tok of tokens) {
      if (tok.length < 4 || NOT_A_PLACE.has(tok)) continue;
      const s = similarity(tok, p.name);
      // Deliberately strict. A destination is the one slot where guessing
      // wrong sends the ship somewhere the captain never asked for, and short
      // words are one edit from each other constantly: "come" scores 0.8
      // against "home".
      if (s > 0.8 && (!best || s > best.score)) {
        best = { id: p.id, name: p.name, exact: false, score: s };
      } else if (!best && soundsLike(tok, p.name)) {
        best = { id: p.id, name: p.name, exact: false, score: 0.7 };
      }
    }
  }
  return best;
}

/** Which shield facing or side of the ship is meant. */
export function findFacing(text, tokens) {
  for (const tok of tokens) {
    const f = FACING_WORDS[tok];
    if (f) return f;
  }
  for (const tok of tokens) {
    if (tok.length < 4) continue;
    for (const word of Object.keys(FACING_WORDS)) {
      if (similarity(tok, word) > 0.75 || soundsLike(tok, word)) {
        return FACING_WORDS[word];
      }
    }
  }
  return null;
}

/** Which of our own power channels is meant. */
export function findPowerChannel(text, tokens) {
  for (const tok of tokens) {
    const s = POWER_WORDS[tok];
    if (s && SUBSYSTEMS.includes(s)) return s;
  }
  for (const tok of tokens) {
    if (tok.length < 4) continue;
    for (const [word, sub] of Object.entries(POWER_WORDS)) {
      if (similarity(tok, word) > 0.78) return sub;
    }
  }
  return null;
}

/** Which of *their* systems a targeting order singles out. */
export function findTargetSystem(text, tokens) {
  const phrases = Object.keys(TARGET_WORDS)
    .filter((k) => k.includes(' '))
    .sort((a, b) => b.length - a.length);
  for (const p of phrases) {
    if (text.includes(p)) return TARGET_WORDS[p];
  }
  for (const tok of tokens) {
    const s = TARGET_WORDS[tok];
    if (s) return s;
  }
  for (const tok of tokens) {
    if (tok.length < 5) continue;
    const stem = tok.replace(/s$/, '');
    for (const [word, sub] of Object.entries(TARGET_WORDS)) {
      if (word.includes(' ')) continue;
      // Looser than the other extractors on purpose: these are long technical
      // nouns typed under pressure, and "nacels" is not another subsystem.
      if (similarity(tok, word) > 0.72 || similarity(stem, word) > 0.72) return sub;
    }
  }
  return null;
}

/**
 * Which thing in the recipe book an order is about.
 *
 * Built from the book itself, so the shop can learn to make something new
 * without this function changing — the same reason every other extractor here
 * reads the game's data rather than restating it.
 */
const RECIPE_WORDS = RECIPES.map((r) => ({
  id: r.id,
  words: `${r.name} ${r.id.replace(/_/g, ' ')}`
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((w) => w.length > 3),
}));

export function findRecipe(text) {
  let best = null;
  let bestScore = 0;
  for (const r of RECIPE_WORDS) {
    let score = 0;
    for (const w of r.words) {
      if (text.includes(w)) score += w.length;
      else if (text.includes(w.replace(/s$/, ''))) score += w.length - 1;
    }
    if (score > bestScore) { bestScore = score; best = r.id; }
  }
  return best;
}

/** Which faction is being talked about. */
export function findFaction(text, tokens) {
  for (const f of FACTION_NAMES) {
    if (text.includes(f.name)) return f.id;
  }
  for (const tok of tokens) {
    if (tok.length < 5) continue;
    for (const f of FACTION_NAMES) {
      if (similarity(tok, f.name) > 0.8) return f.id;
    }
  }
  return null;
}

/**
 * Warp factor, specifically. "warp 8", "warp factor eight", "maximum warp",
 * "best speed" — but not the 8 in "target their number 8 emitter".
 */
export function findWarpFactor(text) {
  if (/\b(?:maximum|max|best|emergency|top|full)\s+(?:possible\s+)?(?:warp|speed)\b/.test(text)) {
    return 9.9;
  }
  const m = text.match(/\bwarp\s*(?:factor\s*)?(\d+(?:\.\d+)?)\b/);
  if (m) return Math.max(1, Math.min(9.9, parseFloat(m[1])));

  const words = 'one|two|three|four|five|six|seven|eight|nine';
  const w = text.match(new RegExp(`\\bwarp\\s*(?:factor\\s*)?(${words})\\b`));
  if (w) {
    const idx = words.split('|').indexOf(w[1]);
    return idx + 1;
  }
  return null;
}

/** A percentage, if one was given. */
export function findPercent(text) {
  const m = text.match(/\b(\d+(?:\.\d+)?)\s*(?:percent|%)/);
  return m ? parseFloat(m[1]) : null;
}

/** A compass bearing, with optional elevation — "bearing 210 mark 15". */
export function findBearing(text) {
  const m = text.match(/\b(?:bearing|heading|course)\s*(?:to\s*)?(\d{1,3})(?:\s*(?:mark|by|\/)\s*(-?\d{1,3}))?/);
  if (!m) return null;
  return {
    bearing: parseInt(m[1], 10) % 360,
    mark: m[2] !== undefined ? parseInt(m[2], 10) : 0,
  };
}

/** Everything the parser can name, for the help sheet and for tests. */
export function gazetteerSummary() {
  return {
    places: PLACES.length,
    facings: new Set(Object.values(FACING_WORDS)).size,
    powerChannels: SUBSYSTEMS.length,
    targetSystems: new Set(Object.values(TARGET_WORDS)).size,
    factions: new Set(FACTION_NAMES.map((f) => f.id)).size,
  };
}

export { FACINGS, SUBSYSTEMS, FACING_WORDS, TARGET_WORDS, POWER_WORDS };
