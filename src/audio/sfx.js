// Named sound cues, each synthesized on demand.
//
// Design notes: these are original sounds built to fit the fiction, not
// reproductions of any recording. Phaser fire is a resonant swept tone over a
// filtered noise bed; the klaxon is a two-tone alternation with a hard filter;
// the LCARS chirps are short FM blips at fixed intervals so the console reads
// as one instrument.

import { tone, noiseBurst, fmTone } from './synth.js';

/**
 * Each cue is (ctx, bus, opts) => void. `bus` is the routed destination for
 * that cue's category so the mixer can duck/mute by group.
 */
export const CUES = {
  // ---------- UI ----------
  ui_tap: (ctx, bus) => {
    fmTone(ctx, bus, { carrier: 1180, ratio: 1.5, index: 220, duration: 0.045, gain: 0.13, release: 0.04 });
  },
  ui_select: (ctx, bus) => {
    fmTone(ctx, bus, { carrier: 880, ratio: 2.0, index: 300, duration: 0.05, gain: 0.15, release: 0.05 });
    fmTone(ctx, bus, { at: 0.055, carrier: 1320, ratio: 2.0, index: 240, duration: 0.05, gain: 0.12, release: 0.05 });
  },
  ui_back: (ctx, bus) => {
    fmTone(ctx, bus, { carrier: 740, ratio: 1.4, index: 200, duration: 0.05, gain: 0.13, release: 0.05 });
    fmTone(ctx, bus, { at: 0.055, carrier: 520, ratio: 1.4, index: 180, duration: 0.06, gain: 0.11, release: 0.06 });
  },
  ui_deny: (ctx, bus) => {
    fmTone(ctx, bus, { carrier: 220, ratio: 1.1, index: 160, duration: 0.09, gain: 0.16, release: 0.06, type: 'square' });
    fmTone(ctx, bus, { at: 0.1, carrier: 180, ratio: 1.1, index: 140, duration: 0.11, gain: 0.14, release: 0.08, type: 'square' });
  },
  ui_confirm: (ctx, bus) => {
    tone(ctx, bus, { type: 'triangle', pitch: 620, duration: 0.06, gain: 0.13 });
    tone(ctx, bus, { at: 0.06, type: 'triangle', pitch: 930, duration: 0.06, gain: 0.13 });
    tone(ctx, bus, { at: 0.12, type: 'triangle', pitch: 1240, duration: 0.1, gain: 0.12 });
  },
  computer_ack: (ctx, bus) => {
    fmTone(ctx, bus, { carrier: 1480, ratio: 3.0, index: 340, duration: 0.06, gain: 0.12, release: 0.05 });
    fmTone(ctx, bus, { at: 0.07, carrier: 1960, ratio: 3.0, index: 300, duration: 0.07, gain: 0.1, release: 0.06 });
  },
  computer_query: (ctx, bus) => {
    fmTone(ctx, bus, { carrier: 900, ratio: 2.5, index: 260, duration: 0.07, gain: 0.11, release: 0.05 });
    fmTone(ctx, bus, { at: 0.08, carrier: 1200, ratio: 2.5, index: 260, duration: 0.07, gain: 0.11, release: 0.05 });
    fmTone(ctx, bus, { at: 0.16, carrier: 1010, ratio: 2.5, index: 240, duration: 0.09, gain: 0.1, release: 0.07 });
  },

  // ---------- Alerts ----------
  red_alert: (ctx, bus) => {
    // Two-tone klaxon, three cycles, with a resonant sweep under each.
    for (let i = 0; i < 3; i++) {
      const t = i * 0.86;
      tone(ctx, bus, { type: 'sawtooth', pitch: [440, 620], at: t, duration: 0.38, gain: 0.2, release: 0.05, curve: 'linear' });
      tone(ctx, bus, { type: 'square', pitch: [220, 310], at: t, duration: 0.38, gain: 0.08, release: 0.05, curve: 'linear' });
      tone(ctx, bus, { type: 'sawtooth', pitch: [620, 440], at: t + 0.43, duration: 0.38, gain: 0.2, release: 0.05, curve: 'linear' });
      tone(ctx, bus, { type: 'square', pitch: [310, 220], at: t + 0.43, duration: 0.38, gain: 0.08, release: 0.05, curve: 'linear' });
    }
  },
  yellow_alert: (ctx, bus) => {
    for (let i = 0; i < 2; i++) {
      tone(ctx, bus, { type: 'triangle', pitch: 520, at: i * 0.42, duration: 0.2, gain: 0.15, release: 0.08 });
      tone(ctx, bus, { type: 'triangle', pitch: 392, at: i * 0.42 + 0.2, duration: 0.2, gain: 0.13, release: 0.08 });
    }
  },
  alert_clear: (ctx, bus) => {
    tone(ctx, bus, { type: 'sine', pitch: 660, duration: 0.14, gain: 0.13 });
    tone(ctx, bus, { at: 0.15, type: 'sine', pitch: 880, duration: 0.22, gain: 0.12 });
  },
  intruder_alert: (ctx, bus) => {
    for (let i = 0; i < 4; i++) {
      tone(ctx, bus, { type: 'square', pitch: 780, at: i * 0.3, duration: 0.12, gain: 0.14, release: 0.04 });
      tone(ctx, bus, { type: 'square', pitch: 585, at: i * 0.3 + 0.13, duration: 0.12, gain: 0.14, release: 0.04 });
    }
  },
  hail_incoming: (ctx, bus) => {
    tone(ctx, bus, { type: 'sine', pitch: [1200, 1600], duration: 0.1, gain: 0.12 });
    tone(ctx, bus, { at: 0.12, type: 'sine', pitch: [1600, 1200], duration: 0.1, gain: 0.12 });
    tone(ctx, bus, { at: 0.26, type: 'sine', pitch: [1200, 1800], duration: 0.16, gain: 0.11 });
  },
  boatswain: (ctx, bus) => {
    // Boatswain's whistle: a rising then falling pure tone.
    tone(ctx, bus, { type: 'sine', pitch: [900, 2100], duration: 0.28, gain: 0.1, release: 0.02 });
    tone(ctx, bus, { at: 0.3, type: 'sine', pitch: 2100, duration: 0.16, gain: 0.1, release: 0.02 });
    tone(ctx, bus, { at: 0.47, type: 'sine', pitch: [2100, 1000], duration: 0.3, gain: 0.09, release: 0.06 });
  },

  // ---------- Weapons ----------
  phaser: (ctx, bus, { power = 1 } = {}) => {
    const dur = 0.34 + power * 0.2;
    tone(ctx, bus, { type: 'sawtooth', pitch: [1400, 820], duration: dur, gain: 0.16 * power, release: 0.06 });
    tone(ctx, bus, { type: 'square', pitch: [700, 410], duration: dur, gain: 0.07 * power, release: 0.06 });
    noiseBurst(ctx, bus, { duration: dur, gain: 0.09 * power, filter: 'bandpass', freq: 2400, freqEnd: 900, q: 6 });
  },
  phaser_heavy: (ctx, bus) => {
    tone(ctx, bus, { type: 'sawtooth', pitch: [1100, 560], duration: 0.7, gain: 0.2, release: 0.1 });
    tone(ctx, bus, { type: 'square', pitch: [366, 186], duration: 0.7, gain: 0.11, release: 0.1 });
    noiseBurst(ctx, bus, { duration: 0.7, gain: 0.12, filter: 'bandpass', freq: 1800, freqEnd: 620, q: 5 });
  },
  disruptor: (ctx, bus) => {
    fmTone(ctx, bus, { carrier: 620, ratio: 1.7, index: 900, duration: 0.3, gain: 0.18, release: 0.08, type: 'sawtooth' });
    noiseBurst(ctx, bus, { duration: 0.3, gain: 0.1, filter: 'bandpass', freq: 1400, freqEnd: 500, q: 3 });
  },
  torpedo_launch: (ctx, bus) => {
    noiseBurst(ctx, bus, { duration: 0.16, gain: 0.22, filter: 'lowpass', freq: 1800, freqEnd: 300, q: 1 });
    tone(ctx, bus, { type: 'sine', pitch: [180, 60], duration: 0.34, gain: 0.2, release: 0.14 });
    tone(ctx, bus, { at: 0.04, type: 'triangle', pitch: [900, 240], duration: 0.3, gain: 0.09, release: 0.1 });
  },
  torpedo_impact: (ctx, bus) => {
    noiseBurst(ctx, bus, { duration: 0.5, gain: 0.34, filter: 'lowpass', freq: 900, freqEnd: 90, q: 0.9, pink: true });
    tone(ctx, bus, { type: 'sine', pitch: [120, 34], duration: 0.6, gain: 0.28, release: 0.3 });
  },

  // ---------- Damage ----------
  shield_impact: (ctx, bus, { severity = 0.5 } = {}) => {
    noiseBurst(ctx, bus, { duration: 0.22, gain: 0.12 + severity * 0.16, filter: 'bandpass', freq: 1600, freqEnd: 700, q: 2.4 });
    tone(ctx, bus, { type: 'sine', pitch: [520, 260], duration: 0.24, gain: 0.1 + severity * 0.1, release: 0.1 });
  },
  hull_impact: (ctx, bus, { severity = 0.5 } = {}) => {
    noiseBurst(ctx, bus, { duration: 0.36, gain: 0.18 + severity * 0.2, filter: 'lowpass', freq: 1200, freqEnd: 140, q: 1, pink: true });
    tone(ctx, bus, { type: 'sine', pitch: [140, 48], duration: 0.42, gain: 0.16 + severity * 0.14, release: 0.2 });
    fmTone(ctx, bus, { carrier: 90, ratio: 3.7, index: 220, duration: 0.3, gain: 0.1, release: 0.16 });
  },
  console_explode: (ctx, bus) => {
    noiseBurst(ctx, bus, { duration: 0.18, gain: 0.26, filter: 'highpass', freq: 1400, q: 0.7 });
    noiseBurst(ctx, bus, { at: 0.02, duration: 0.4, gain: 0.16, filter: 'bandpass', freq: 800, freqEnd: 180, q: 1.4 });
    tone(ctx, bus, { type: 'sawtooth', pitch: [300, 60], duration: 0.3, gain: 0.12, release: 0.2 });
  },
  hull_groan: (ctx, bus) => {
    fmTone(ctx, bus, { carrier: 62, ratio: 1.41, index: 90, duration: 1.4, gain: 0.14, release: 0.6, type: 'triangle' });
    noiseBurst(ctx, bus, { duration: 1.4, gain: 0.05, filter: 'bandpass', freq: 220, freqEnd: 140, q: 4, pink: true });
  },
  core_breach_warning: (ctx, bus) => {
    for (let i = 0; i < 6; i++) {
      tone(ctx, bus, { type: 'square', pitch: 1000, at: i * 0.5, duration: 0.14, gain: 0.16, release: 0.04 });
      tone(ctx, bus, { type: 'square', pitch: 1000, at: i * 0.5 + 0.18, duration: 0.14, gain: 0.16, release: 0.04 });
    }
  },
  explosion: (ctx, bus) => {
    noiseBurst(ctx, bus, { duration: 1.2, gain: 0.4, filter: 'lowpass', freq: 1400, freqEnd: 60, q: 0.8, pink: true });
    tone(ctx, bus, { type: 'sine', pitch: [90, 24], duration: 1.4, gain: 0.32, release: 0.6 });
    noiseBurst(ctx, bus, { at: 0.05, duration: 0.5, gain: 0.2, filter: 'highpass', freq: 900 });
  },

  // ---------- Ship systems ----------
  warp_engage: (ctx, bus) => {
    tone(ctx, bus, { type: 'sawtooth', pitch: [90, 1600], duration: 1.5, gain: 0.16, release: 0.3 });
    tone(ctx, bus, { type: 'sine', pitch: [45, 800], duration: 1.5, gain: 0.14, release: 0.3 });
    noiseBurst(ctx, bus, { duration: 1.6, gain: 0.1, filter: 'bandpass', freq: 200, freqEnd: 3600, q: 3, pink: true });
    tone(ctx, bus, { at: 1.4, type: 'sine', pitch: [1800, 300], duration: 0.5, gain: 0.1, release: 0.3 });
  },
  warp_drop: (ctx, bus) => {
    tone(ctx, bus, { type: 'sawtooth', pitch: [1400, 110], duration: 0.9, gain: 0.14, release: 0.3 });
    noiseBurst(ctx, bus, { duration: 0.9, gain: 0.09, filter: 'bandpass', freq: 3000, freqEnd: 180, q: 2.6, pink: true });
  },
  impulse_burn: (ctx, bus) => {
    noiseBurst(ctx, bus, { duration: 0.8, gain: 0.1, filter: 'lowpass', freq: 400, freqEnd: 900, q: 1, pink: true });
    tone(ctx, bus, { type: 'triangle', pitch: [70, 130], duration: 0.8, gain: 0.09, release: 0.3 });
  },
  transporter: (ctx, bus) => {
    // Shimmering cluster of detuned partials over a rising filtered noise bed.
    const base = 420;
    for (let i = 0; i < 7; i++) {
      tone(ctx, bus, {
        type: 'sine', at: i * 0.03,
        pitch: [base * (1 + i * 0.18), base * (1 + i * 0.18) * 1.9],
        duration: 1.5 - i * 0.08, gain: 0.05, release: 0.4,
      });
    }
    noiseBurst(ctx, bus, { duration: 1.6, gain: 0.09, filter: 'bandpass', freq: 700, freqEnd: 4200, q: 8 });
  },
  tractor_beam: (ctx, bus) => {
    fmTone(ctx, bus, { carrier: 140, ratio: 1.33, index: 300, duration: 1.2, gain: 0.13, release: 0.4, type: 'triangle' });
    tone(ctx, bus, { type: 'sine', pitch: [200, 210], duration: 1.2, gain: 0.08, release: 0.4 });
  },
  cloak: (ctx, bus) => {
    tone(ctx, bus, { type: 'triangle', pitch: [900, 60], duration: 1.3, gain: 0.13, release: 0.4 });
    noiseBurst(ctx, bus, { duration: 1.3, gain: 0.08, filter: 'bandpass', freq: 2600, freqEnd: 160, q: 5 });
  },
  decloak: (ctx, bus) => {
    tone(ctx, bus, { type: 'triangle', pitch: [60, 900], duration: 1.0, gain: 0.14, release: 0.3 });
    noiseBurst(ctx, bus, { duration: 1.0, gain: 0.09, filter: 'bandpass', freq: 160, freqEnd: 2600, q: 5 });
  },
  scan: (ctx, bus) => {
    for (let i = 0; i < 4; i++) {
      tone(ctx, bus, { type: 'sine', pitch: [700 + i * 90, 1500 + i * 90], at: i * 0.16, duration: 0.14, gain: 0.08, release: 0.06 });
    }
  },
  scan_complete: (ctx, bus) => {
    tone(ctx, bus, { type: 'sine', pitch: 1046, duration: 0.09, gain: 0.11 });
    tone(ctx, bus, { at: 0.1, type: 'sine', pitch: 1318, duration: 0.09, gain: 0.11 });
    tone(ctx, bus, { at: 0.2, type: 'sine', pitch: 1568, duration: 0.16, gain: 0.1 });
  },
  door: (ctx, bus) => {
    noiseBurst(ctx, bus, { duration: 0.34, gain: 0.14, filter: 'bandpass', freq: 400, freqEnd: 1500, q: 2.2 });
    tone(ctx, bus, { type: 'sine', pitch: [200, 420], duration: 0.3, gain: 0.06, release: 0.1 });
  },
  power_reroute: (ctx, bus) => {
    fmTone(ctx, bus, { carrier: 320, ratio: 2.1, index: 420, duration: 0.24, gain: 0.12, release: 0.1 });
    tone(ctx, bus, { at: 0.1, type: 'triangle', pitch: [420, 700], duration: 0.2, gain: 0.09, release: 0.08 });
  },
  dock: (ctx, bus) => {
    tone(ctx, bus, { type: 'sine', pitch: [220, 180], duration: 0.9, gain: 0.12, release: 0.3 });
    noiseBurst(ctx, bus, { at: 0.5, duration: 0.5, gain: 0.12, filter: 'lowpass', freq: 500, freqEnd: 160, q: 1, pink: true });
  },
  promotion: (ctx, bus) => {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => {
      tone(ctx, bus, { type: 'triangle', pitch: n, at: i * 0.16, duration: 0.2, gain: 0.13, release: 0.16 });
      tone(ctx, bus, { type: 'sine', pitch: n * 2, at: i * 0.16, duration: 0.2, gain: 0.05, release: 0.16 });
    });
  },
};

export const CUE_NAMES = Object.keys(CUES);

/** Which mixer bus each cue routes through. */
export const CUE_BUS = {
  ui_tap: 'ui', ui_select: 'ui', ui_back: 'ui', ui_deny: 'ui', ui_confirm: 'ui',
  computer_ack: 'ui', computer_query: 'ui', scan: 'ui', scan_complete: 'ui',
  red_alert: 'alert', yellow_alert: 'alert', alert_clear: 'alert',
  intruder_alert: 'alert', hail_incoming: 'alert', boatswain: 'alert',
  core_breach_warning: 'alert', promotion: 'alert',
};

export function busFor(cue) {
  return CUE_BUS[cue] ?? 'sfx';
}
