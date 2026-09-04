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
    // Work hours credited to the ship — capped per absence.
    this.creditedHours = opts.creditedHours ?? 0;
    // Commission hours elapsed — uncapped, and banked at the compression that
    // was in force when they passed.
    //
    // These two are genuinely different quantities and conflating them is a
    // bug in either direction. A month away is a month of the five years gone,
    // because the calendar does not wait for you; it is *not* a month of
    // damage control, because a ship nobody is commanding does not repair
    // itself at full rate for a month. Commission time is uncapped, work is
    // capped, and this is where they part company.
    this.commissionHours = opts.commissionHours
      // Migrate a save written before the two were separated: everything it
      // credited was, at that point, both.
      ?? opts.creditedHours ?? 0;
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

    // The calendar does not wait for you, and it is banked at the compression
    // in force right now rather than recomputed later from the current
    // setting. That is what stops the Options switch rewriting history.
    this.commissionHours += rawHours * this.compression;

    return { hours: credited, forfeited, wentBackwards };
  }

  /**
   * Credit time that passed with the app open and the simulation running.
   *
   * `sync()` is for time nobody watched. It caps what a single absence can
   * deliver and it hands back a report, because the captain was not there and
   * has to be told. This is the other half — the hours a captain spends in the
   * chair — and it is deliberately not the same method: there is no ceiling,
   * because nothing is being credited that was not lived through, and there is
   * no report, because the captain was watching.
   *
   * Without it the five-year mission advanced only while nobody was playing
   * it. Measured: two hours of continuous play moved the commission clock by
   * exactly nothing, and then a single background-and-foreground with zero
   * seconds closed credited the whole two hours as an absence — repairing the
   * hull, and having the watch officer report on a watch the captain had stood
   * themselves. Both halves of that were wrong in the same place.
   *
   * Taken from the simulation's own fixed step rather than from the wall clock.
   * `Clock.frame` is where real time is allowed into the sim; everything after
   * it works in `dt`, and a second reading of the wall clock down here would
   * make the same seed play a different commission on a slower phone.
   *
   * @param {number} realSeconds elapsed sim time, unscaled
   * @returns {number} commission hours credited
   */
  advanceOpen(realSeconds) {
    if (!(realSeconds > 0)) return 0;
    const hours = (realSeconds / 3600) * this.compression;
    this.commissionHours += hours;
    // The wall time those hours account for, so a resume does not charge for
    // them a second time. If the sim ran slower than real time — a throttled
    // tab, a long frame, a phone that went to sleep — this lags the wall clock
    // and `sync()` credits the difference as the absence it actually was.
    this.lastSeen += realSeconds * 1000;
    return hours;
  }

  /** Take the accrued time, leaving the counter empty. */
  drainPending() {
    const hours = this.pendingHours;
    this.pendingHours = 0;
    return hours;
  }

  /**
   * Days elapsed in the commission so far.
   *
   * Accumulated as time passes rather than recomputed as wall-clock elapsed
   * times the *current* compression. That distinction is the whole of a nasty
   * bug: with the multiplication done here, selecting x1000 in Options
   * instantly finished a five-year commission — 400 real days read as 400,000 —
   * and selecting x1 again un-finished it. Banking each interval at the
   * compression in force when it passed is both correct and stable under a
   * setting the player is invited to change mid-commission.
   */
  get elapsedDays() {
    return Math.max(0, this.commissionHours / 24);
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
      commissionHours: this.commissionHours,
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
    // Phrased from the constant rather than around it, so tuning the ceiling
    // cannot leave this sentence quietly lying to the player.
    const counted = MAX_ABSENCE_HOURS < 48
      ? `${Math.round(MAX_ABSENCE_HOURS)} hours`
      : `${Math.round(MAX_ABSENCE_HOURS / 24)} days`;
    lines.push(`Starfleet logged ${Math.round(forfeited / 24)} days of your absence as leave. Only the first ${counted} counted toward the ship's work.`);
  }

  return lines;
}
