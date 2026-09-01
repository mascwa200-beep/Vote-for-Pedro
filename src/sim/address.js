// Who the captain is talking to.
//
// Almost every order on this bridge is said to somebody. "Mr. Sulu, warp six",
// "Bones, get down here", "Spock, what do you make of it" — the name is not
// decoration, it is half the line, and the game heard none of it. One regex in
// main.js matched a surname for the single order that hands over the con, and
// every other order in the game was addressed to nobody in particular.
//
// This resolves an address against the ACTUAL ROSTER, which is the only place
// that knows who is aboard: the lexicon cannot, because a captain can serve
// with the 1966 crew, the 1987 crew, or seven people it generated this morning.
//
// Four ways to name somebody, and the crew answers to all of them:
//
//   By surname, with or without an honorific — "Spock", "Mr. Spock",
//     "Commander Spock", "Doctor McCoy", "Lieutenant Uhura".
//   By the post — "helm", "science", "the chief engineer", "tactical".
//   By the standing form of address — "Number One" is the first officer on
//     any ship in Starfleet, whoever holds the job.
//   By what their friends call them, where the roster records it.
//
// The address may lead ("Spock, scan it") or trail ("Take us out, Mr. Sulu"),
// because both are how people talk, and what comes back is the officer AND the
// order with the address removed — so the parser sees "scan it" either way.

/**
 * Forms of address that belong to a POST rather than a person.
 *
 * "Number One" is the first officer of any ship, and a captain who says it is
 * addressing whoever currently holds the job — which changes when somebody is
 * hurt, which is exactly why this maps to the station and not to a name.
 */
const BY_POST = {
  'number one': 'first_officer',
  'number 1': 'first_officer',
  exec: 'first_officer',
  'executive officer': 'first_officer',
  xo: 'first_officer',
  'first officer': 'first_officer',
  helm: 'helm',
  helmsman: 'helm',
  navigator: 'helm',
  conn: 'helm',
  tactical: 'tactical',
  'tactical officer': 'tactical',
  security: 'tactical',
  weapons: 'tactical',
  science: 'science',
  'science officer': 'science',
  sciences: 'science',
  engineering: 'engineering',
  engineer: 'engineering',
  'chief engineer': 'engineering',
  doctor: 'medical',
  doc: 'medical',
  medical: 'medical',
  'chief medical officer': 'medical',
  communications: 'comms',
  comms: 'comms',
  'communications officer': 'comms',
};

/**
 * Honorifics that precede a name and are not part of it.
 *
 * `mr` covers "Mister" and "Mr." both, because normalisation has already taken
 * the full stop off by the time anything here runs — and if it has not, the
 * trim below takes it.
 */
const HONORIFICS = [
  'mister', 'mr', 'mrs', 'ms', 'miss', 'doctor', 'dr', 'nurse',
  'captain', 'commander', 'lieutenant', 'lt', 'ensign', 'chief', 'admiral',
  'commodore', 'crewman', 'specialist', 'subcommander', 'major', 'colonel',
];

/** Lower-cased, punctuation gone — but NOT the comma, which is structure. */
const strip = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[.!?;:]+/g, ' ')
  .replace(/\s*,\s*/g, ', ')
  .replace(/\s+/g, ' ')
  .trim();

/** The same, with the commas taken out too. Names do not contain them. */
const bare = (s) => strip(s).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

/** The part of a name people actually call somebody by. */
export function surnameOf(officer) {
  const parts = String(officer?.name ?? '').trim().split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

/**
 * Every string this officer answers to, longest first.
 *
 * Longest first matters: "chief engineer" has to be tried before "chief", or
 * an order to the chief engineer is addressed to a chief petty officer and the
 * word "engineer" is left in the order for the parser to trip over.
 */
export function namesFor(officer, station = officer?.station) {
  const out = new Set();
  const full = bare(officer?.name);
  const last = surnameOf(officer);
  if (full) out.add(full);
  if (last) out.add(last);
  for (const nick of officer?.aliases ?? []) {
    const n = bare(nick);
    if (n) out.add(n);
  }
  for (const [form, post] of Object.entries(BY_POST)) {
    if (post === station) out.add(form);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * Who was spoken to, and what was said to them.
 *
 * @param {string} line   the order as the captain typed it
 * @param {object} crew   the ship's company; only `officers` is read
 * @returns {{officer: object|null, station: string|null, order: string,
 *            form: string|null, leading: boolean}}
 *   `order` is the line with the address removed, and is the whole line
 *   unchanged when nobody was named — so this is safe to run over every order.
 */
export function addressedTo(line, crewOrGame) {
  // Callers hold a game far more often than they hold a crew, and handing one
  // over used to mean `officers` came back undefined and every address matched
  // the post table instead of the roster.
  const crew = crewOrGame?.officers ? crewOrGame : crewOrGame?.crew ?? null;
  const raw = String(line ?? '');
  const said = strip(raw);
  const blank = { officer: null, station: null, order: raw, form: null, leading: false };
  if (!said) return blank;

  // Only officers who can answer. Addressing a name is how a captain finds out
  // somebody is in sickbay, so the order still resolves — it just resolves to
  // whoever is standing that post now, which is what `watchOrder` decides.
  const officers = (crew?.officers ?? []).filter((o) => o?.alive);

  /** Every (phrase, officer) pair anybody aboard answers to, longest first. */
  const forms = [];
  for (const o of officers) {
    for (const name of namesFor(o)) forms.push([name, o]);
  }
  // A post nobody is standing is still a post — "helm, warp six" should reach
  // the helm even if the helm officer is in sickbay and somebody is covering.
  for (const [form, station] of Object.entries(BY_POST)) {
    if (!officers.some((o) => o.station === station)) forms.push([form, { station }]);
  }
  forms.sort((a, b) => b[0].length - a[0].length);

  for (const [form, who] of forms) {
    // An honorific is optional and may be doubled in practice ("Mr. Chief
    // Engineer" nobody says, but "Lieutenant Commander Data" they do), so the
    // pattern allows a run of them.
    const hon = `(?:(?:${HONORIFICS.join('|')})\\s+)*`;
    const esc = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Leading: "Mr. Spock, scan it".
    const lead = new RegExp(`^${hon}${esc}\\b[\\s,]*`, 'i');
    if (lead.test(said)) {
      const rest = said.replace(lead, '').trim();
      // "Spock" on its own is addressing somebody, not ordering them about,
      // and an empty order is not something the parser can do anything with.
      if (rest) {
        return {
          officer: who.name ? who : null, station: who.station ?? null,
          order: bare(rest), form, leading: true,
        };
      }
    }

    // Trailing: "Take us out, Mr. Sulu."
    //
    // The comma is REQUIRED here and optional at the front, and that asymmetry
    // is load-bearing. A post is also an ordinary English word: "take me down
    // to engineering" ends with the name of a station and is not addressed to
    // anybody, it is a request to walk there. A line that BEGINS with a post
    // is always an address, because nothing else starts that way.
    const tail = new RegExp(`,\\s*${hon}${esc}\\s*$`, 'i');
    if (tail.test(said)) {
      const rest = said.replace(tail, '').trim();
      if (rest) {
        return {
          officer: who.name ? who : null, station: who.station ?? null,
          order: bare(rest), form, leading: false,
        };
      }
    }
  }

  return blank;
}

/**
 * The officer who should answer an order, given who was named.
 *
 * Naming somebody who cannot answer is not an error and must not swallow the
 * order: a captain who says "Spock, scan it" while Spock is unconscious in
 * sickbay has still given a perfectly good order to the science station, and
 * the person standing it answers. Saying so out loud is the game's job, not
 * this function's.
 */
export function answeringFor(address, crewOrGame) {
  const crew = crewOrGame?.officers ? crewOrGame : crewOrGame?.crew ?? null;
  if (!address?.station) return address?.officer ?? null;
  const named = address.officer;
  if (named?.alive && !named.injured) return named;
  const onStation = crew?.at?.(address.station);
  if (onStation?.alive && !onStation.injured) return onStation;
  return named ?? onStation ?? null;
}
