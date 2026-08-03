// The five-year mission, in real time.
//
// A commission runs 1,826 days of wall-clock time — five years and a leap day.
// The ship repairs, the crew recovers, research completes and long missions
// advance whether the app is open or not, because a five-year mission that only
// runs while you are looking at it is not a five-year mission, it is a very
// long play session.
//
// Three things this has to survive, and they are the whole design:
//
//   THE CLOCK GOING FORWARD. Setting the phone's date ahead must not buy
//   progress. A high-water mark is stored and time only ever accrues from it.
//
//   THE CLOCK GOING BACKWARD. Time zones, daylight saving, a factory reset, a
//   dead battery. Elapsed time is clamped at zero rather than going negative,
//   and the anchor is re-based so the save is not poisoned.
//
//   BEING PUT DOWN FOR A MONTH. A commission that is abandoned for eight weeks
//   should not credit eight weeks of repair in one instant and hand back a
//   pristine ship. There is a ceiling on what a single absence can deliver.
//
// And one honest concession. Real time is the point and the default, but a save
// that can only be exercised in real time cannot be tested, demoed, or
// recovered from a bug — so there is a compression factor, it is 1.0 unless you
// change it, and the game says plainly what changing it costs.

/** The commission, in days. Five years, with the leap day. */
export const COMMISSION_DAYS = 1826;

const MS_PER_HOUR = 3600 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * The most a single absence can credit, in hours.
 *
 * Long enough that going to bed, or away for a weekend, returns real progress.
 * Short enough that leaving the game for a month does not hand back a fully
 * repaired ship, a rested crew and every research project finished at once —
 * which would make the passage of time a reward for not playing.
 */
export const MAX_ABSENCE_HOURS = 72;

/** Wall-clock source, injectable so five years can be simulated in a test. */
export const systemClock = () => Date.now();

export class CampaignClock {
  /**
   * @param {object} opts
   *   startedAt    epoch ms the commission began
   *   now          clock function, for tests
   *   compression  1 = real time; higher runs the campaign faster
   */
  constructor(opts = {}) {
    this.now = opts.now ?? systemClock;
    this.startedAt = opts.startedAt ?? this.now();
    // Monotonic: the furthest point the commission has ever reached.
    this.highWater = opts.highWater ?? this.startedAt;
    this.lastSeen = opts.lastSeen ?? this.startedAt;
    this.compression = Math.max(1, opts.compression ?? 1);
    // Time that accrued while the app was closed and has not been spent yet.
    this.pendingHours = opts.pendingHours ?? 0;
    // Total credited campaign time, in hours, after compression.
    this.creditedHours = opts.creditedHours ?? 0;
    // Absences that were larger than the ceiling, recorded rather than hidden.
    this.forfeitedHours = opts.forfeitedHours ?? 0;
  }

  /**
   * Bring the clock up to now, and report what happened while we were away.
   *
   * Called on load and on resume. Everything else in the campaign reads the
   * result rather than the wall clock, so there is exactly one place where real
   * time enters the simulation.
   *
   * @returns {{hours: number, forfeited: number, wentBackwards: boolean}}
   */
  sync() {
    const wall = this.now();
    let wentBackwards = false;

    if (wall < this.lastSeen) {
      // The clock moved back. Re-anchor rather than accrue a negative, and do
      // not punish the player for a time-zone change by rolling the commission
      // backwards — the high-water mark is what the campaign is measured
      // against, and it never falls.
      wentBackwards = true;
      this.lastSeen = wall;
      return { hours: 0, forfeited: 0, wentBackwards };
    }

    const rawHours = (wall - this.lastSeen) / MS_PER_HOUR;
    this.lastSeen = wall;
    if (wall > this.highWater) this.highWater = wall;

    const capped = Math.min(rawHours, MAX_ABSENCE_HOURS);
    const forfeited = rawHours - capped;
    const credited = capped * this.compression;

    this.pendingHours += credited;
    this.creditedHours += credited;
    this.forfeitedHours += forfeited;

    return { hours: credited, forfeited, wentBackwards };
  }

  /** Take the accrued time, leaving the counter empty. */
  drainPending() {
    const hours = this.pendingHours;
    this.pendingHours = 0;
    return hours;
  }

  /** Days elapsed in the commission so far, against the high-water mark. */
  get elapsedDays() {
    return Math.max(0, (this.highWater - this.startedAt) / MS_PER_DAY) * this.compression;
  }

  /** 0..1 through the five years. */
  get progress() {
    return Math.min(1, this.elapsedDays / COMMISSION_DAYS);
  }

  get daysRemaining() {
    return Math.max(0, COMMISSION_DAYS - this.elapsedDays);
  }

  get complete() {
    return this.elapsedDays >= COMMISSION_DAYS;
  }

  /** "Year two, day 143" — how a commission is actually referred to. */
  format() {
    const days = Math.floor(this.elapsedDays);
    const year = Math.floor(days / 365.25) + 1;
    const dayOfYear = Math.floor(days - Math.floor((year - 1) * 365.25)) + 1;
    return `Year ${year}, day ${dayOfYear}`;
  }

  /** A readable summary of how long is left, for the bridge. */
  remainingText() {
    const days = Math.ceil(this.daysRemaining);
    if (days <= 0) return 'The five-year mission is complete.';
    if (days < 60) return `${days} days remaining on this commission.`;
    const months = Math.round(days / 30.44);
    if (months < 24) return `${months} months remaining on this commission.`;
    return `${(days / 365.25).toFixed(1)} years remaining on this commission.`;
  }

  save() {
    return {
      startedAt: this.startedAt,
      highWater: this.highWater,
      lastSeen: this.lastSeen,
      compression: this.compression,
      pendingHours: this.pendingHours,
      creditedHours: this.creditedHours,
      forfeitedHours: this.forfeitedHours,
    };
  }

  static load(data, now = systemClock) {
    if (!data) return new CampaignClock({ now });
    return new CampaignClock({ ...data, now });
  }
}

/**
 * Turn an absence into a readable ship's log.
 *
 * The player has been away; the ship has not. This is what they come back to,
 * and it is the difference between "time passed" as a number and time passing
 * as something that happened to a crew.
 */
export function absenceReport(hours, { ship = null, forfeited = 0 } = {}) {
  const lines = [];
  if (hours < 0.5) return lines;

  const span = hours < 24
    ? `${Math.round(hours)} hours`
    : `${(hours / 24).toFixed(1)} days`;
  lines.push(`${span} have passed since you last took the conn.`);

  if (ship) {
    if (ship.hullPct < 1) {
      lines.push(`Damage control has been working the whole time. Hull integrity is at ${Math.round(ship.hullPct * 100)} percent.`);
    }
    if (ship.fires > 0) {
      lines.push(`${ship.fires} fire${ship.fires > 1 ? 's are' : ' is'} still burning.`);
    }
  }

  if (forfeited > 24) {
    // Said out loud rather than quietly dropped. A player who leaves for a
    // month should be told that a month did not all count, not left to work it
    // out from a repair bill that does not add up.
    lines.push(`Starfleet logged ${Math.round(forfeited / 24)} days of your absence as leave. Only the first three days counted toward the ship's work.`);
  }

  return lines;
}
