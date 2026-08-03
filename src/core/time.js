// Stardates and the fixed-timestep clock.
//
// The sim advances in fixed 1/30s steps regardless of frame rate, so combat
// resolves identically on a 60Hz and a 120Hz panel — which the Pixel has.

export const SIM_STEP = 1 / 30;
const MAX_STEPS_PER_FRAME = 6; // never spiral if the tab was backgrounded

export class Clock {
  constructor(stardate = 4523.3) {
    this.stardate = stardate;
    this.accumulator = 0;
    this.lastFrame = 0;
    this.scale = 1;
    this.paused = false;
  }

  /**
   * Feed a rAF timestamp; get back how many fixed steps to run.
   * @returns {number} step count
   */
  frame(timestampMs) {
    if (!this.lastFrame) { this.lastFrame = timestampMs; return 0; }
    let dt = (timestampMs - this.lastFrame) / 1000;
    this.lastFrame = timestampMs;
    if (this.paused) return 0;
    dt = Math.min(dt, 0.25); // clamp a long stall into one visible hitch
    this.accumulator += dt * this.scale;
    let steps = 0;
    while (this.accumulator >= SIM_STEP && steps < MAX_STEPS_PER_FRAME) {
      this.accumulator -= SIM_STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    return steps;
  }

  /** Interpolation alpha for smooth rendering between fixed steps. */
  get alpha() {
    return this.accumulator / SIM_STEP;
  }

  /** Advance the calendar. One stardate unit is roughly a day. */
  advanceStardate(units) {
    this.stardate = Math.round((this.stardate + units) * 10) / 10;
  }

  format() {
    return this.stardate.toFixed(1);
  }
}

/** Elapsed-time formatter for logs and ETAs. */
export function formatDuration(hours) {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (hours < 24) return `${hours.toFixed(1)} hours`;
  const days = hours / 24;
  if (days < 30) return `${days.toFixed(1)} days`;
  return `${(days / 30.44).toFixed(1)} months`;
}
