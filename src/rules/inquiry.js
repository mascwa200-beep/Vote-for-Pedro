// The board of inquiry, and what it finds.
//
// The grounding is docs/RESEARCH.md §22, and the three things it takes from
// the series are the three things this file does.
//
// A board convenes at a STARBASE. Kirk's court-martial in "Court Martial" is
// held at Starbase 11: the ship puts in, the officers go ashore, and a panel
// sits in a room. Nothing about that can happen on patrol. So a board opened
// in deep space is a thing hanging over a captain until he next makes port,
// which is exactly the interval a campaign wants.
//
// The RECORD is the evidence. The whole device of that episode is that the
// computer log is treated as incontrovertible. The game already keeps a
// service record with a weighted score, and until now that number did nothing
// but print itself on a screen — so reading the finding off it is not a
// mechanic invented for the occasion. It is the one the record was for.
//
// And the worst finding costs a RANK, not a career. Kirk pled guilty after
// Genesis and was reduced from Admiral to Captain, and the reduction is what
// put him back on a ship. The floor follows from the same fact: reduced *to*
// Captain and no further, because below Captain there is no starship, and the
// campaign is about commanding one.

import { RANKS } from '../sim/skills.js';
import { assessmentOf } from '../core/ledger.js';
import { emit } from '../core/events.js';

/**
 * The findings.
 *
 * Which one applies is decided by the assessment band the record already sits
 * in — `assessmentOf` from the ledger, the same function that labels the
 * captain's own screen. The thresholds are not restated here, because two
 * copies of them would drift and this file would be the one that ended up
 * disagreeing with the record it is supposed to be reading.
 */
export const FINDINGS = {
  exonerated: {
    verdict: 'exonerated',
    label: 'Exonerated',
    standing: 0,
    text: 'The board finds no fault. The circumstances are entered in the record.',
  },
  reprimanded: {
    verdict: 'reprimanded',
    label: 'Formal reprimand',
    standing: -10,
    text: 'The board issues a formal reprimand. It stays on your record.',
  },
  reduced: {
    verdict: 'reduced',
    label: 'Reduced in rank',
    standing: -15,
    text: 'The board finds against you. You are reduced in rank.',
  },
};

/** The rank a board will not reduce a captain below. */
export const RANK_FLOOR = 'captain';

/**
 * Whether a board can sit here.
 *
 * A Federation STARBASE, not merely anywhere with a spacedock. The game
 * already ordered the captain to Starbase 11 in so many words, so sitting the
 * board over a repair berth at Vulcan would have made that order a lie — and
 * docking at Qo'noS would have convened a Starfleet board of inquiry in the
 * Klingon capital, which is the sort of thing a seam produces when nobody
 * checks. Both of the game's starbases carry docking facilities, so this is a
 * destination rather than a wall.
 */
export function sitsAt(system) {
  return system?.type === 'starbase' && system?.faction === 'federation';
}

/**
 * Where the captain is ordered to appear: the nearest starbase that will hear
 * him. Named on the screen, so the order is one he can actually follow.
 */
export function venueFor(game) {
  const here = game?.location;
  const bases = [...(game?.galaxy?.systems?.values() ?? [])].filter(sitsAt);
  if (!bases.length || !here) return bases[0] ?? null;
  return bases.reduce((best, s) => {
    const d = (s.x - here.x) ** 2 + (s.y - here.y) ** 2;
    return d < best.d ? { s, d } : best;
  }, { s: bases[0], d: Infinity }).s;
}

/**
 * What the board WOULD find, without sitting it.
 *
 * Split out so the screen can warn a captain what he is sailing into. A
 * verdict he can only discover by docking is a trap, and §22's point is that
 * the finding turns on a record he can already read.
 */
export function findingFor(ledger) {
  // NOT `ledger.assessment()`, which reports 'inquiry' while a board is
  // sitting — true, but useless to the board itself, which is asking what the
  // record says apart from the fact that it is being read. Same bands, taken
  // from the same table.
  const band = assessmentOf(ledger?.serviceScore?.() ?? 0).id;
  if (band === 'unremarkable') return FINDINGS.reprimanded;
  if (band === 'concerning' || band === 'censure') return FINDINGS.reduced;
  return FINDINGS.exonerated;
}

/**
 * Sit the board. Applies the finding and closes the inquiry.
 *
 * Deterministic — a function of the record, with no draw from `game.rng`.
 * Taking one would shift every downstream seeded outcome, and a captain ought
 * to be able to see a verdict coming from the record he has been keeping.
 *
 * @returns {object|null} the finding, or null if no board was open.
 */
export function convene(game) {
  const ledger = game?.ledger;
  if (!ledger?.inquiryOpen) return null;
  if (!sitsAt(game.location)) return null;
  const reason = ledger.inquiryReason ?? 'your command record';
  const base = findingFor(ledger);
  const finding = { ...base, reason, reducedTo: null };

  if (base.verdict === 'reduced') {
    const floor = RANKS.findIndex((r) => r.id === RANK_FLOOR);
    const p = game.progress;
    if (p && p.rankIndex > floor) {
      p.rankIndex--;
      finding.reducedTo = p.rank?.name ?? null;
      // And the experience that earned the rank goes with it.
      //
      // `rankIndex--` on its own was the whole demotion, and it lasted until
      // the next thing that happened. `addXP` promotes when the banked total
      // passes the next threshold (skills.js:115-120) — and after a reduction
      // the "next" threshold is one the captain went past long ago, so:
      //
      //     rank before dock : Fleet Captain
      //     finding          : Reduced in rank -> Captain
      //     one more xp point: promoted -> Fleet Captain, +5 skill points
      //
      // The heaviest penalty in the game was undone by a single point, and
      // paid five skill points for the privilege. Setting the total back to
      // the threshold of the rank he now holds means the gap has to be flown
      // again, which is what a reduction in rank is. The surplus that went
      // with it was a claim on the rank ABOVE the one taken, and he has no
      // claim on that either.
      //
      // Skill points already spent are NOT clawed back. Nothing in
      // CaptainProgress can unspend one, and a demotion that silently
      // corrupted a skill tree would be a worse bug than the one this fixes.
      p.xp = RANKS[p.rankIndex]?.xp ?? p.xp;
    } else {
      // Already at the floor: the finding stands on the record, but there is
      // no rank to take. The verdict changes with the label, so nothing
      // downstream can read 'reduced' and go looking for the rank that went.
      finding.verdict = 'reprimanded';
      finding.label = 'Formal reprimand';
      finding.text = 'The board finds against you. There is no rank to take; '
        + 'the finding stands on your record.';
    }
  }

  if (finding.standing) {
    ledger.adjustStanding('federation', finding.standing, `Board of inquiry: ${reason}`);
  }
  finding.text = `Board of inquiry into ${reason}. ${finding.text}`;
  ledger.closeInquiry(finding);
  emit('inquiry:concluded', finding);
  return finding;
}
