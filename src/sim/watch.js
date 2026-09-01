// The bridge watch, and who has the con.
//
// A starship is crewed around the clock and the captain is one person. The
// game has run for its whole life as though the bridge were empty whenever the
// player was not looking at it — you closed the app mid-sector and the ship
// simply stopped, then a summary panel told you what had happened as though
// nobody had been there.
//
// Somebody was there. Handing the con over is the single most-repeated piece of
// business on that show, and it is the thing that makes the ship feel crewed
// rather than driven: you leave the bridge, the next ranking officer takes it,
// they hold it while you are gone, and they tell you what happened when you get
// back.
//
// Pure functions over a crew, with no game object and no renderer, so all of it
// is testable outside a browser.

/**
 * Seniority, most senior first.
 *
 * Rank first, then the post: at equal rank a first officer outranks a helmsman
 * for the purposes of the watch, which is a real thing and not a tiebreak
 * invented for convenience — the first officer is the captain's relief.
 */
const RANK_ORDER = [
  'Admiral', 'Vice Admiral', 'Rear Admiral', 'Commodore', 'Fleet Captain',
  'Captain', 'Commander', 'Lieutenant Commander', 'Lieutenant',
  'Lieutenant JG', 'Ensign',
];

/**
 * Ranks that are not Starfleet's, placed against the ladder above.
 *
 * The rosters carry a Bajoran militia Major who was a station's first officer,
 * a chief petty officer, a civilian constable and a hologram. Only the first of
 * those slots into the chain of command anywhere near the top, and leaving it
 * out is not a cosmetic bug — an unranked officer sorts to the bottom, so the
 * DS9 roster's second-in-command would have been the last person called on.
 *
 * The enlisted and the civilians are deliberately absent. They keep the ship
 * running and they do not stand a bridge watch, and the sort puts them last
 * without needing to be told.
 */
const RANK_EQUIVALENT = {
  Major: 'Commander',
  Colonel: 'Captain',
  Subcommander: 'Commander',
};

/** Which posts stand a watch, in the order they are called on. */
const RELIEF_ORDER = [
  'first_officer', 'tactical', 'helm', 'science', 'engineering',
  'comms', 'security', 'ops', 'navigation', 'medical',
];

/** Lower is more senior. Unknown ranks sort to the bottom rather than crashing. */
export function seniority(officer) {
  const rank = officer?.rank ?? '';
  const r = RANK_ORDER.indexOf(RANK_EQUIVALENT[rank] ?? rank);
  const post = RELIEF_ORDER.indexOf(officer?.station ?? '');
  return [(r === -1 ? RANK_ORDER.length : r), (post === -1 ? RELIEF_ORDER.length : post)];
}

/**
 * The crew who could take the con, most senior first.
 *
 * Only officers who are actually available. Somebody in sickbay does not have
 * the con, and neither does somebody who is dead — which sounds obvious and is
 * exactly the sort of thing a ranking sort gets wrong when the roster is a flat
 * list and injuries are a boolean somewhere else.
 */
export function watchOrder(crew) {
  // One body, one watch. A roster can list the same officer at two posts — the
  // TOS crew has its science officer standing in as first officer, which is
  // true to the show and would otherwise put one Vulcan on two watches at once.
  const seen = new Set();
  const officers = (crew?.officers ?? []).filter((o) => {
    if (!o?.alive || o.injured) return false;
    if (seen.has(o.name)) return false;
    seen.add(o.name);
    return true;
  });
  return officers.slice().sort((a, b) => {
    const [ra, pa] = seniority(a);
    const [rb, pb] = seniority(b);
    return ra - rb || pa - pb;
  });
}

/**
 * Who takes the con when the captain leaves it.
 *
 * @param {object} crew
 * @param {object|null} except an officer who cannot take it — normally the one
 *        who just handed it back, so the con does not bounce.
 */
export function nextInLine(crew, except = null) {
  const order = watchOrder(crew);
  return order.find((o) => o !== except) ?? null;
}

/**
 * The three watches a day is divided into.
 *
 * Alpha, beta and gamma, eight hours each, which is how a ship at sea and a
 * ship in this franchise both do it. Alpha is the day watch and starts at 0800
 * — the captain's watch, which is why the bridge you walk onto at the start of
 * a commission is the one with the senior staff on it.
 */
export const WATCHES = [
  { id: 'alpha', name: 'Alpha watch', from: 8, to: 16 },
  { id: 'beta', name: 'Beta watch', from: 16, to: 24 },
  { id: 'gamma', name: 'Gamma watch', from: 0, to: 8 },
];

/** Which watch is standing at this hour of the ship's day. */
export function watchAt(hour) {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  return WATCHES.find((w) => h >= w.from && h < w.to) ?? WATCHES[2];
}

/**
 * Assign the crew to watches.
 *
 * Round-robin down the seniority list rather than by department, so no single
 * watch gets all the senior officers and none of them is left with nobody who
 * can make a decision. The senior staff land on alpha because they are first in
 * the list, which is both correct and what the show does.
 */
export function assignWatches(crew) {
  const order = watchOrder(crew);
  const roster = { alpha: [], beta: [], gamma: [] };
  order.forEach((o, i) => {
    roster[WATCHES[i % WATCHES.length].id].push(o);
  });
  return roster;
}

/**
 * What the officer with the con says when they hand it back.
 *
 * A report rather than a summary panel. The difference matters: a panel is the
 * game telling you what happened, and this is a person telling you what they
 * did about it while you were not there.
 */
export function handbackReport(officer, hours, lines = []) {
  if (!officer) return lines;
  const span = hours < 1 ? 'the last hour'
    : hours < 24 ? `the last ${Math.round(hours)} hours`
      : `the last ${(hours / 24).toFixed(1)} days`;
  const opener = lines.length
    ? `${officer.rank} ${officer.name}: I had the con for ${span}.`
    : `${officer.rank} ${officer.name}: I had the con for ${span}. Nothing to report.`;
  return [opener, ...lines, `${officer.rank} ${officer.name}: You have the con, Captain.`];
}
