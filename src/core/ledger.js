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

/** Weights that feed the eventual Starfleet review of your command. */
const RECORD_WEIGHTS = {
  lives_saved: 0.02,
  lives_lost: -0.05,
  crew_lost: -1.2,
  prime_directive_violation: -14,
  first_contact: 8,
  ship_destroyed_hostile: 1.5,
  ship_destroyed_civilian: -25,
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
};

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
  }

  // ------------- recording -------------

  /**
   * Record something that happened.
   * @param {string} kind    a RECORD_WEIGHTS key or any custom tag
   * @param {object} detail  { stardate, system, text, count, faction, ... }
   */
  record(kind, detail = {}) {
    const entry = { kind, ...detail, seq: this.entries.length };
    this.entries.push(entry);
    this.counters[kind] = (this.counters[kind] ?? 0) + (detail.count ?? 1);

    if (kind === 'prime_directive_violation') {
      this.reprimands.push(entry);
      // Three violations and Starfleet stops writing letters.
      if ((this.counters[kind] ?? 0) >= 3 && !this.inquiryOpen) {
        this.inquiryOpen = true;
        emit('ledger:inquiry', entry);
      }
    }
    if (kind === 'colony_saved' || kind === 'first_contact' || kind === 'treaty_signed') {
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
    const after = Math.max(-100, Math.min(100, before + delta));
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
    const s = this.serviceScore();
    if (this.inquiryOpen) return { id: 'inquiry', label: 'Under Board of Inquiry' };
    if (s >= 120) return { id: 'exemplary', label: 'Exemplary' };
    if (s >= 60) return { id: 'distinguished', label: 'Distinguished' };
    if (s >= 20) return { id: 'satisfactory', label: 'Satisfactory' };
    if (s >= -20) return { id: 'unremarkable', label: 'Unremarkable' };
    if (s >= -60) return { id: 'concerning', label: 'Concerning' };
    return { id: 'censure', label: 'Subject to Censure' };
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
    });
    l.flags = new Set(data.flags ?? []);
    return l;
  }
}
