// Text normalisation for the command layer.
//
// Everything the captain types arrives here first. The job is to reduce the
// enormous variety of ways a person phrases an order down to a form the intent
// matcher can score, without throwing away the words that carry meaning.
//
// The design constraint that shapes this whole directory: it must work with the
// radio off, forever, in a bundle small enough to precache. That rules out a
// language model and rules in tables. Tables get you a long way if you build
// them from how people actually talk rather than from how a grammar says they
// should.

/** Contractions, including the sloppy ones people actually type. */
const CONTRACTIONS = [
  [/\bcan'?t\b/g, 'can not'],
  [/\bwon'?t\b/g, 'will not'],
  [/\bshan'?t\b/g, 'shall not'],
  [/\bain'?t\b/g, 'is not'],
  [/\bdon'?t\b/g, 'do not'],
  [/\bdoesn'?t\b/g, 'does not'],
  [/\bdidn'?t\b/g, 'did not'],
  [/\bisn'?t\b/g, 'is not'],
  [/\baren'?t\b/g, 'are not'],
  [/\bwasn'?t\b/g, 'was not'],
  [/\bweren'?t\b/g, 'were not'],
  [/\bhasn'?t\b/g, 'has not'],
  [/\bhaven'?t\b/g, 'have not'],
  [/\bhadn'?t\b/g, 'had not'],
  [/\bcouldn'?t\b/g, 'could not'],
  [/\bshouldn'?t\b/g, 'should not'],
  [/\bwouldn'?t\b/g, 'would not'],
  [/\blet'?s\b/g, 'let us'],
  [/\bit'?s\b/g, 'it is'],
  [/\bthat'?s\b/g, 'that is'],
  [/\bwhat'?s\b/g, 'what is'],
  [/\bwhere'?s\b/g, 'where is'],
  [/\bwho'?s\b/g, 'who is'],
  [/\bhere'?s\b/g, 'here is'],
  [/\bthere'?s\b/g, 'there is'],
  [/\bwe'?re\b/g, 'we are'],
  [/\bthey'?re\b/g, 'they are'],
  [/\byou'?re\b/g, 'you are'],
  [/\bi'?m\b/g, 'i am'],
  [/\bwe'?ll\b/g, 'we will'],
  [/\bi'?ll\b/g, 'i will'],
  [/\byou'?ll\b/g, 'you will'],
  [/\bthey'?ll\b/g, 'they will'],
  [/\bwe'?ve\b/g, 'we have'],
  [/\bi'?ve\b/g, 'i have'],
  [/\byou'?ve\b/g, 'you have'],
  [/\bi'?d\b/g, 'i would'],
  [/\bwe'?d\b/g, 'we would'],
];

/**
 * Casual speech and typing shortcuts. Ordered longest-first within the table
 * so that "gonna" is handled before "on".
 */
const SLANG = [
  [/\bgonna\b/g, 'going to'],
  [/\bwanna\b/g, 'want to'],
  [/\bgotta\b/g, 'have to'],
  [/\bgimme\b/g, 'give me'],
  [/\blemme\b/g, 'let me'],
  [/\bc'?mon\b/g, 'come on'],
  [/\bkinda\b/g, 'kind of'],
  [/\bsorta\b/g, 'sort of'],
  [/\bout+a\b/g, 'out of'],
  [/\b'?em\b/g, 'them'],
  [/\b'?bout\b/g, 'about'],
  [/\bya\b/g, 'you'],
  [/\bu\b/g, 'you'],
  [/\bpls\b/g, 'please'],
  [/\bplz\b/g, 'please'],
  [/\basap\b/g, 'immediately'],
  [/\bthru\b/g, 'through'],
  [/\btho\b/g, 'though'],
  [/\bcuz\b/g, 'because'],
  [/\bcos\b/g, 'because'],
  [/\bok\b/g, 'okay'],
];

/**
 * Naval, Starfleet and British/American spelling equivalences.
 * These are folded to one canonical spelling so the lexicon only lists one.
 */
const EQUIVALENCES = [
  [/\bbrake\b/g, 'break'],
  [/\bwrap\b/g, 'warp'],
  [/\bfacter\b/g, 'factor'],
  [/\bmanoeuvres?\b/g, 'maneuver'],
  [/\bmaneuvers\b/g, 'maneuver'],
  [/\bmanouvers?\b/g, 'maneuver'],
  [/\bmanuevers?\b/g, 'maneuver'],
  [/\bdefen[cs]e\b/g, 'defense'],
  [/\bdefensive\b/g, 'defense'],
  [/\bcolour\b/g, 'color'],
  [/\banaly[sz]e\b/g, 'analyze'],
  [/\banaly[sz]is\b/g, 'analyze'],
  [/\bmetres?\b/g, 'meter'],
  [/\bstarboard side\b/g, 'starboard'],
  [/\bport side\b/g, 'port'],
  [/\bstbd\b/g, 'starboard'],
  [/\bmr\b/g, 'mister'],
  [/\bms\b/g, 'miss'],
  [/\bdr\b/g, 'doctor'],
  [/\bcmdr\b/g, 'commander'],
  [/\blt\b/g, 'lieutenant'],
  [/\bcapt\b/g, 'captain'],
  [/\badm\b/g, 'admiral'],
  [/\bens\b/g, 'ensign'],
  [/\bcpo\b/g, 'chief'],
  [/\bconn\b/g, 'helm'],
  [/\bnav\b/g, 'navigation'],
  [/\btac\b/g, 'tactical'],
  [/\bops\b/g, 'operations'],
  [/\bengi?n?e?e?ring\b/g, 'engineering'],
  [/\bbelay\b/g, 'cancel'],
  [/\bavast\b/g, 'cancel'],
  [/\bphotons?\b/g, 'torpedo'],
  [/\btorps?\b/g, 'torpedo'],
  [/\btorpedoe?s\b/g, 'torpedo'],
  [/\bphasers\b/g, 'phaser'],
  [/\bdisruptors?\b/g, 'phaser'],
  [/\bshields\b/g, 'shield'],
  [/\bengines\b/g, 'engine'],
  [/\bnacelles?\b/g, 'engine'],
  [/\bsensors\b/g, 'sensor'],
  [/\bweapons\b/g, 'weapon'],
  [/\bdeflectors?\b/g, 'shield'],
  [/\bviewscreen\b/g, 'viewscreen'],
  [/\bview screen\b/g, 'viewscreen'],
  [/\bmain viewer\b/g, 'viewscreen'],
  [/\bon-?screen\b/g, 'onscreen'],
];

/**
 * Politeness and framing that carries no operational meaning. Stripped before
 * scoring so "could you please have the helm bring us about" scores the same as
 * "come about".
 */
const FILLER = [
  /\b(?:i (?:want|need) (?:you )?to|i would like (?:you )?to|i'd like (?:you )?to)\b/g,
  /\b(?:could|would|can|will) you (?:please )?\b/g,
  /\b(?:please|kindly|if you would|if you please|for me)\b/g,
  /\b(?:let us|let me)\b/g,
  /\b(?:go ahead and|make sure (?:you|to)|be sure to|try to|attempt to)\b/g,
  /\b(?:right (?:now|away)|at once|immediately|on the double|smartly|quickly|now)\b/g,
  /\b(?:aye|acknowledged|understood|roger|copy that|affirmative)\b/g,
  /\b(?:okay|alright|well|so|um|uh|er|hmm)\b/g,
  /\b(?:i say again|say again|repeat)\b/g,
];

/** Who is being addressed. Recognised, then removed — but reported. */
const STATIONS = {
  helm: 'helm',
  navigation: 'helm',
  navigator: 'helm',
  helmsman: 'helm',
  pilot: 'helm',
  tactical: 'tactical',
  weapons: 'tactical',
  security: 'security',
  engineering: 'engineering',
  engineer: 'engineering',
  science: 'science',
  sciences: 'science',
  communications: 'comms',
  comms: 'comms',
  comm: 'comms',
  operations: 'ops',
  sickbay: 'medical',
  medical: 'medical',
  doctor: 'medical',
  medbay: 'medical',
  transporter: 'transporter',
  'transporter room': 'transporter',
  'shuttle bay': 'shuttlebay',
  hangar: 'shuttlebay',
  computer: 'computer',
  'damage control': 'damagecontrol',
  environmental: 'environmental',
};

const RANKS = ['mister', 'miss', 'missus', 'commander', 'lieutenant', 'ensign',
  'doctor', 'chief', 'captain', 'admiral', 'crewman', 'yeoman', 'number one'];

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80,
  ninety: 90, hundred: 100,
};

/** Words that do not help identify an intent and only add noise to scoring. */
export const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'and', 'or', 'is', 'are', 'be', 'we', 'us',
  'our', 'i', 'you', 'your', 'it', 'that', 'this', 'do', 'does', 'did', 'not',
  'have', 'has', 'had', 'am', 'was', 'were', 'will', 'would', 'shall', 'should',
  'can', 'could', 'may', 'might', 'must', 'at', 'in', 'on', 'for', 'with',
  'from', 'by', 'as', 'if', 'then', 'than', 'so', 'but', 'just', 'very',
]);

/**
 * Character-level canonicalisation only: case, punctuation, contractions,
 * slang, and spelling equivalences. No filler stripping and no addressee
 * extraction, because those are things you do to a sentence and not to a
 * dictionary entry.
 *
 * Exported because the lexicon runs its own phrases through this at load time.
 * If it did not, the lexicon would have to be written in the folded dialect by
 * hand — "fire all weapon" — and the first person to write the plural would
 * silently break that intent.
 */
export function fold(raw) {
  let t = String(raw ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[“”]/g, '"');

  // Punctuation goes, but hyphens inside words and decimal points survive
  // because "one-third" and "warp 8.5" both matter.
  t = t.replace(/[^\w\s'.\-/]/g, ' ');

  for (const [re, sub] of CONTRACTIONS) t = t.replace(re, sub);
  for (const [re, sub] of SLANG) t = t.replace(re, sub);

  // Apostrophes have done their work; drop them so "captains" and "captain's"
  // are the same token.
  t = t.replace(/'/g, '');

  for (const [re, sub] of EQUIVALENCES) t = t.replace(re, sub);

  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Fold a raw line into canonical form, and report what the shape of the
 * sentence tells us beyond its words.
 * @returns {{text: string, tokens: string[], station: string|null, urgent: boolean, negated: boolean}}
 */
export function normalize(raw) {
  const urgent = /\b(?:now|immediately|at once|right away|on the double|asap|hurry|fast|quick)\b/i
    .test(String(raw ?? ''));

  let t = fold(raw);

  // A negation anywhere flips several intents ("do not fire", "belay that").
  const negated = /\b(?:not|never|cancel|abort|disregard|stand down|hold off)\b/.test(t);

  for (const re of FILLER) t = t.replace(re, ' ');

  t = t.replace(/\s+/g, ' ').trim();

  const { station, rest } = extractStation(t);

  return {
    text: rest,
    tokens: rest.split(' ').filter(Boolean),
    station,
    urgent,
    negated,
    // The whole folded line, before the addressee was pulled off it.
    //
    // Needed because several compartments are ALSO station names — sickbay,
    // engineering — so "go to sickbay" had the word stripped as an address and
    // arrived at the room matcher as the bare phrase "go to". Every entity that
    // can collide with a station name has to be looked for here instead.
    full: t,
  };
}

/**
 * Pull the addressee off the front — "helm," "mister sulu," "tactical" — and
 * report it, because who you addressed is meaningful even when the rest of the
 * order is unambiguous. Addresses can also appear at the end ("fire, tactical").
 */
function extractStation(text) {
  let rest = text;
  let station = null;

  const stationNames = Object.keys(STATIONS).sort((a, b) => b.length - a.length);

  for (let pass = 0; pass < 2; pass++) {
    // A rank followed by a name: "mister sulu", "doctor mccoy", "number one".
    const rankRe = new RegExp(`^(?:${RANKS.join('|')})\\s+(?:[a-z]+\\s*)?[,]?\\s*`);
    const before = rest;
    rest = rest.replace(rankRe, '');
    if (rest !== before) continue;

    let matched = false;
    for (const name of stationNames) {
      const head = new RegExp(`^${name}\\b[,]?\\s*`);
      const tail = new RegExp(`[,]?\\s*\\b${name}$`);
      if (head.test(rest)) {
        station ??= STATIONS[name];
        rest = rest.replace(head, '');
        matched = true;
        break;
      }
      if (tail.test(rest) && rest.split(' ').length > 1) {
        station ??= STATIONS[name];
        rest = rest.replace(tail, '');
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }

  // A station can also be named in the middle of a sentence — "what does
  // engineering say". That is still an address, so it is reported; but it is
  // left in the text, because unlike a leading "Engineering," it is carrying
  // grammatical weight and removing it mangles the sentence.
  if (!station) {
    for (const name of stationNames) {
      if (new RegExp(`\\b${name}\\b`).test(rest)) { station = STATIONS[name]; break; }
    }
  }

  return { station, rest: rest.trim() || text };
}

/**
 * Read a number out of text, spelled or numeric.
 * "warp factor eight" -> 8, "seventy five percent" -> 75, "one third" -> 0.333
 */
export function readNumber(text, fallback = null) {
  const t = String(text);

  if (/\bone third\b|\b1\/3\b/.test(t)) return 1 / 3;
  if (/\btwo thirds?\b|\b2\/3\b/.test(t)) return 2 / 3;
  if (/\bthree quarters\b|\b3\/4\b/.test(t)) return 0.75;
  if (/\b(?:one )?quarter\b|\b1\/4\b/.test(t)) return 0.25;
  if (/\b(?:one )?half\b|\b1\/2\b/.test(t)) return 0.5;

  const digits = t.match(/\b(\d+(?:\.\d+)?)\b/);
  if (digits) return parseFloat(digits[1]);

  // "twenty five" reads as 25; a bare "twenty" as 20.
  const words = t.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const a = NUMBER_WORDS[words[i]];
    if (a === undefined) continue;
    const b = NUMBER_WORDS[words[i + 1]];
    if (a >= 20 && a < 100 && b !== undefined && b < 10) return a + b;
    return a;
  }
  return fallback;
}

export { STATIONS, NUMBER_WORDS };
