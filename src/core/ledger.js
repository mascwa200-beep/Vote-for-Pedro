// The consequence ledger.
//
// This is the part that makes decisions matter. Nothing here is ever rolled
// back: officers who die stay dead, ships destroyed stay destroyed, colonies
// lost stay lost, and Starfleet keeps its own copy of your record.
//
// Everything else in the game reads this — mission availability, encounter
// generation, docking rights, promotion boards, and the ending.

import { emit } from './events.js';
import { FACTIONS, standingTier } from '../world/factions.data.js';

/**
 * Weights that feed the eventual Starfleet review of your command.
 *
 * Exported so a test can hold it against `WEIGHTLESS_RECORDS` below and against
 * every kind actually written in src/. `serviceScore` reads a missing kind as
 * zero, so without that sweep the difference between "worth nothing" and
 * "forgotten" is invisible from inside the game.
 */
export const RECORD_WEIGHTS = {
  lives_saved: 0.02,
  lives_lost: -0.05,
  crew_lost: -1.2,
  prime_directive_violation: -14,
  first_contact: 8,
  ship_destroyed_hostile: 1.5,
  ship_destroyed_civilian: -25,
  // Losing your own ship weighed NOTHING. The single worst thing that can
  // happen to a starship captain moved the review by zero, so a captain who
  // had lost two hulls could still be assessed Exemplary. Worse than losing a
  // colony you were sent to protect, not as bad as killing civilians yourself.
  ship_lost: -20,
  colony_saved: 12,
  colony_lost: -10,
  treaty_signed: 15,
  treaty_broken: -18,
  distress_answered: 4,
  distress_ignored: -6,
  surrender_accepted: 3,
  surrender_refused: -8,
  anomaly_catalogued: 3,
  order_disobeyed: -5,
  // A citation, weighing nothing.
  //
  // Six episode endings award one, and `consequences.js` says in its own
  // comment why it chose a record over a flag: "the durable consequence is the
  // `commendation` on the service record, which the Starfleet review really
  // does read." It did not. `serviceScore` sums `RECORD_WEIGHTS[kind] ?? 0`, so
  // a kind with no entry contributes exactly zero and says nothing about it —
  // and that score is what `findingFor` turns into exonerated, reprimanded or
  // reduced in rank at a Board of Inquiry. A captain could arrive at a hearing
  // with six commendations and none of them counted.
  //
  // Worth a first contact. Both are a notable thing done once and formally
  // noted, and a treaty at 15 should still outrank either.
  commendation: 8,
  // Its sibling weighed -14 and this weighed nothing.
  //
  // Every episode that writes it also charges standing to the faction whose
  // border it was, so crossing the Neutral Zone and firing first cost you with
  // the Romulans — and then left no mark at all on the record Starfleet reads
  // at the hearing. Less grave than a Prime Directive violation, which is about
  // a whole culture rather than a treaty line, and the same as ignoring a
  // distress call.
  violated_border: -6,
};

/**
 * Kinds that are recorded and deliberately weigh NOTHING.
 *
 * `serviceScore` cannot tell a kind that was left out from a kind that was left
 * out on purpose — both come to `?? 0` — which is how a commendation came to be
 * worth the same as a log entry. `endOfCommission` had already established the
 * right practice for the one case it knew about, in a comment on the call:
 * "recorded, and deliberately weightless... a captain does not get to be
 * Exemplary for having merely lasted."
 *
 * So the intent is written down rather than inferred, and `tests/rules.test.js`
 * holds every kind written anywhere in src/ to being in exactly one of these
 * two tables. A new record kind can no longer score zero by omission.
 *
 * None of these is a merit or a demerit. They are the things that happened.
 */
export const WEIGHTLESS_RECORDS = {
  away_mission: 'a landing party is an event, and its outcome is recorded separately',
  bribe_paid: 'the price is paid in latinum and in Ferengi regard, both immediately',
  captain_wounded: 'the cost of leading in person, already paid by the party breaking off',
  command_accepted: 'taking a command is the start of a record, not an entry in one',
  command_declined: 'and so is declining one',
  commission_completed: 'a captain does not get to be Exemplary for having merely lasted',
  inquiry_concluded: 'the finding is the consequence; this is the fact that it happened',
  mission_complete: 'weighting it would make the review a count of missions flown',
  objective_failed: 'what the failure cost is recorded by whatever it cost',
  ship_captured: 'a prize is worth what the salvage and the standing are worth',
  ship_crippled: 'not a kill, and the kill is what the record counts',
  ship_stranded: 'a hazard survived, not a thing done well or badly',
  signal_answered: 'answering a beacon is courtesy, and it pays in what it finds',
};

/**
 * How Starfleet reads a service score, worst last.
 *
 * Exported because the board of inquiry (rules/inquiry.js) decides its finding
 * on the same bands, and a second copy of these numbers would be a second
 * answer to the same question — the screen and the board would eventually
 * disagree about the same record.
 */
export const ASSESSMENTS = [
  { id: 'exemplary', label: 'Exemplary', from: 120 },
  { id: 'distinguished', label: 'Distinguished', from: 60 },
  { id: 'satisfactory', label: 'Satisfactory', from: 20 },
  { id: 'unremarkable', label: 'Unremarkable', from: -20 },
  { id: 'concerning', label: 'Concerning', from: -60 },
  { id: 'censure', label: 'Subject to Censure', from: -Infinity },
];

/** The band a score falls in, ignoring whether a board happens to be sitting. */
export function assessmentOf(score) {
  return ASSESSMENTS.find((a) => score >= a.from) ?? ASSESSMENTS[ASSESSMENTS.length - 1];
}

export class Ledger {
  constructor() {
    this.entries = [];        // full narrative record, in order
    this.counters = {};       // tallies by kind
    this.flags = new Set();   // one-shot world facts, e.g. 'organia_intervened'
    this.standing = Object.fromEntries(
      Object.values(FACTIONS).map((f) => [f.id, f.baseStanding]),
    );
    this.destroyedShips = [];
    this.lostOfficers = [];
    this.commendations = [];
    this.reprimands = [];
    this.inquiryOpen = false;
    /** Set by the Game from the character sheet. See `openInquiry`. */
    this.inquiryImmune = false;
    /** Flat bonus on Federation standing GAINS. Set by the Game. */
    this.federationGain = 0;
    // What the board is about, so it can be named on the screen and in its own
    // finding. A board with no subject was a flag, not a proceeding.
    this.inquiryReason = null;
    this.findings = [];
  }

  // ------------- recording -------------

  /**
   * Record something that happened.
   *
   * `kind` must appear in `RECORD_WEIGHTS` or in `WEIGHTLESS_RECORDS`, and a
   * test holds every kind written anywhere in src/ to that. It used to say "or
   * any custom tag", which is how a commendation came to be worth nothing: an
   * unlisted kind scores zero and nothing anywhere says whether that was meant.
   *
   * @param {string} kind    a RECORD_WEIGHTS or WEIGHTLESS_RECORDS key
   * @param {object} detail  { stardate, system, text, count, faction, ... }
   */
  record(kind, detail = {}) {
    // Everything that happens, happens on a date.
    //
    // `stardate` was only ever recorded when a caller thought to pass it, and
    // most did not — so the Service Record, which is the whole point of keeping
    // this, rendered most of a five-year commission as "SD —". The ledger now
    // carries the current date and stamps anything that did not bring its own.
    const entry = {
      kind,
      stardate: this.stardate ?? null,
      ...detail,
      seq: this.entries.length,
    };
    this.entries.push(entry);
    this.counters[kind] = (this.counters[kind] ?? 0) + (detail.count ?? 1);

    if (kind === 'prime_directive_violation') {
      this.reprimands.push(entry);
      // Three violations and Starfleet stops writing letters.
      if ((this.counters[kind] ?? 0) >= 3) {
        this.openInquiry('a pattern of Prime Directive violations', entry);
      }
    }
    // What gets cited. Saving a colony, a first contact, a treaty signed — and
    // a commendation, which was the one kind this list left out.
    //
    // The three above are things Starfleet commends you FOR. `commendation` is
    // the citation itself, awarded by an episode ending, and it was the only
    // record in the game named after this list that did not appear on it.
    if (kind === 'colony_saved' || kind === 'first_contact'
      || kind === 'treaty_signed' || kind === 'commendation') {
      this.commendations.push(entry);
    }

    emit('ledger:record', entry);
    return entry;
  }

  /** Permanent officer loss. */
  loseOfficer(officer, detail = {}) {
    this.lostOfficers.push({ name: officer.name, station: officer.station, ...detail });
    this.record('crew_lost', { text: `${officer.rank} ${officer.name} killed`, ...detail });
  }

  /** Permanent ship kill — that hull never appears again. */
  destroyShip(ship, detail = {}) {
    this.destroyedShips.push({ name: ship.name, cls: ship.classId, faction: ship.faction, ...detail });
    this.record(
      ship.civilian ? 'ship_destroyed_civilian' : 'ship_destroyed_hostile',
      { text: `${ship.name} destroyed`, faction: ship.faction, ...detail },
    );
  }

  // ------------- the board of inquiry -------------
  //
  // `inquiryOpen` used to be set in exactly one place and cleared in none. So
  // the flag had two failures at once: the event the game actually calls a
  // board of inquiry — losing your ship — never set it, and the one thing
  // that did set it (a third Prime Directive violation) froze the rank ladder
  // for the rest of the commission, under a screen promising that promotion
  // was suspended only "until it concludes".
  //
  // Both callers now come through one door, and there is a door out.
  // RESEARCH.md §22: a board convenes at a starbase, reads the record, and
  // returns a finding. Sitting it lives in rules/inquiry.js — the ledger holds
  // the fact of it, not the verdict.

  /** @returns {boolean} true if this opened one that was not already open. */
  openInquiry(reason, detail = {}) {
    // "Immune to a board of inquiry" — the one thing `insubordinate` offers in
    // exchange for a reprimand on file and slower promotion. The flag is set by
    // the Game from the character sheet, because a ledger does not know whose
    // it is; both callers come through this door, so this is the only place it
    // has to be asked.
    if (this.inquiryImmune) return false;
    if (this.inquiryOpen) return false;
    this.inquiryOpen = true;
    this.inquiryReason = reason;
    emit('ledger:inquiry', { reason, ...detail });
    return true;
  }

  /** Record the board's finding and close it. */
  closeInquiry(finding) {
    if (!this.inquiryOpen) return false;
    const closed = { reason: this.inquiryReason, ...finding };
    this.inquiryOpen = false;
    this.inquiryReason = null;
    this.findings.push(closed);
    // The finding goes on the record either way. An exoneration is worth
    // having on paper, and a captain who was cleared should be able to see it
    // rather than only noticing that a warning stopped appearing.
    this.record('inquiry_concluded', { text: closed.text ?? closed.label });
    if (finding?.verdict !== 'exonerated') this.reprimands.push(closed);
    emit('ledger:inquiry-closed', closed);
    return true;
  }

  // ------------- flags -------------

  setFlag(flag) {
    if (this.flags.has(flag)) return false;
    this.flags.add(flag);
    emit('ledger:flag', flag);
    return true;
  }

  has(flag) {
    return this.flags.has(flag);
  }

  count(kind) {
    return this.counters[kind] ?? 0;
  }

  // ------------- reputation -------------

  adjustStanding(factionId, delta, reason = '') {
    if (!(factionId in this.standing)) return;
    const before = this.standing[factionId];
    // "By the Book — +2 to Federation standing gains." Declared on the trait
    // and read by nothing. On GAINS only, which is what the card says: a
    // captain who follows regulations is not also insulated from the cost of
    // breaking them. Set by the Game from the character sheet; a ledger does
    // not know whose it is.
    const bonus = factionId === 'federation' && delta > 0 ? (this.federationGain ?? 0) : 0;
    const after = Math.max(-100, Math.min(100, before + delta + bonus));
    this.standing[factionId] = after;
    const tierBefore = standingTier(before).id;
    const tierAfter = standingTier(after).id;
    if (tierBefore !== tierAfter) {
      emit('ledger:standing-tier', { factionId, from: tierBefore, to: tierAfter, reason });
    }
    emit('ledger:standing', { factionId, before, after, delta, reason });
  }

  standingOf(factionId) {
    return this.standing[factionId] ?? 0;
  }

  // ------------- the review -------------

  /** Weighted score Starfleet uses at promotion boards and at the ending. */
  serviceScore() {
    let score = 0;
    for (const [kind, n] of Object.entries(this.counters)) {
      score += (RECORD_WEIGHTS[kind] ?? 0) * n;
    }
    return Math.round(score);
  }

  /** Human-readable assessment of the command record so far. */
  assessment() {
    if (this.inquiryOpen) return { id: 'inquiry', label: 'Under Board of Inquiry' };
    return assessmentOf(this.serviceScore());
  }

  /** Most recent N entries that carry narrative text. */
  recent(n = 12) {
    return this.entries.filter((e) => e.text).slice(-n).reverse();
  }

  // ------------- persistence -------------

  save() {
    return {
      entries: this.entries,
      counters: this.counters,
      flags: [...this.flags],
      standing: this.standing,
      destroyedShips: this.destroyedShips,
      lostOfficers: this.lostOfficers,
      commendations: this.commendations,
      reprimands: this.reprimands,
      inquiryOpen: this.inquiryOpen,
      inquiryReason: this.inquiryReason,
      findings: this.findings,
    };
  }

  static load(data) {
    const l = new Ledger();
    if (!data) return l;
    Object.assign(l, {
      entries: data.entries ?? [],
      counters: data.counters ?? {},
      standing: { ...l.standing, ...(data.standing ?? {}) },
      destroyedShips: data.destroyedShips ?? [],
      lostOfficers: data.lostOfficers ?? [],
      commendations: data.commendations ?? [],
      reprimands: data.reprimands ?? [],
      inquiryOpen: data.inquiryOpen ?? false,
      // A board hanging over a captain has to still be hanging over him after
      // he closes the app, and it has to still know what it is about.
      inquiryReason: data.inquiryReason ?? (data.inquiryOpen ? 'your command record' : null),
      findings: data.findings ?? [],
    });
    l.flags = new Set(data.flags ?? []);
    return l;
  }
}
