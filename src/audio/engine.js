// The mixer: bus graph, ambience, and the public play() surface.
//
// AudioContext creation is deferred until the first user gesture, which is
// what mobile browsers require. Nothing is fetched, so "loading" audio is
// just building an oscillator graph — microseconds, not a progress bar.

import { CUES, busFor } from './sfx.js';
import { drone, impulseResponse } from './synth.js';

const ALERT_AMBIENCE = {
  normal: { pitch: 58, gain: 0.05, filter: 300 },
  yellow: { pitch: 62, gain: 0.07, filter: 420 },
  red: { pitch: 68, gain: 0.09, filter: 560 },
  warp: { pitch: 84, gain: 0.1, filter: 900 },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.buses = {};
    this.volumes = { master: 0.8, ui: 0.9, sfx: 1.0, alert: 0.9, ambience: 0.7, voice: 1.0 };
    this.ambience = null;
    this.alertLevel = 'normal';
    this.lastPlayed = new Map();
    this.voiceEnabled = true;
    this.voice = null;
  }

  /** Must be called from a user gesture handler. Safe to call repeatedly. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ready;
    }
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return false;

    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.volumes.master;
    master.connect(ctx.destination);

    // A short convolution gives the console the sense of a room around it.
    const verb = ctx.createConvolver();
    verb.buffer = impulseResponse(ctx, 1.4, 3.6);
    const verbSend = ctx.createGain();
    verbSend.gain.value = 0.14;
    verbSend.connect(verb).connect(master);

    // Compressor keeps a torpedo volley from clipping the phone speaker.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    comp.connect(master);

    for (const name of ['ui', 'sfx', 'alert', 'ambience', 'voice']) {
      const g = ctx.createGain();
      g.gain.value = this.volumes[name] ?? 1;
      g.connect(comp);
      if (name !== 'ui' && name !== 'voice') g.connect(verbSend);
      this.buses[name] = g;
    }

    this.master = master;
    this.ready = true;
    this.startAmbience();
    return true;
  }

  setVolume(name, value) {
    this.volumes[name] = value;
    if (!this.ready) return;
    if (name === 'master') this.master.gain.value = value;
    else if (this.buses[name]) this.buses[name].gain.value = value;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ready) return;
    this.master.gain.value = on ? this.volumes.master : 0;
  }

  /**
   * Fire a named cue.
   * `throttle` suppresses repeats within N ms — stops a fast weapon cycle
   * from stacking twenty identical voices and turning to mush.
   */
  play(cue, opts = {}) {
    if (!this.enabled || !this.ready) return;
    const fn = CUES[cue];
    if (!fn) return;

    const throttle = opts.throttle ?? 0;
    if (throttle > 0) {
      const now = performance.now();
      const last = this.lastPlayed.get(cue) ?? -Infinity;
      if (now - last < throttle) return;
      this.lastPlayed.set(cue, now);
    }

    try {
      fn(this.ctx, this.buses[busFor(cue)] ?? this.buses.sfx, opts);
    } catch {
      // A dropped sound must never take the bridge down with it.
    }
  }

  // ---------------- Ambience ----------------

  startAmbience() {
    if (!this.ready || this.ambience) return;
    const bus = this.buses.ambience;
    const cfg = ALERT_AMBIENCE.normal;
    this.ambience = {
      engine: drone(this.ctx, bus, { type: 'sawtooth', pitch: cfg.pitch, filterFreq: cfg.filter, detune: 7 }),
      air: drone(this.ctx, bus, { type: 'triangle', pitch: cfg.pitch * 3.1, filterFreq: 900, detune: 3, q: 0.5 }),
    };
    this.ambience.engine.fadeTo(cfg.gain, 2.0);
    this.ambience.air.fadeTo(cfg.gain * 0.25, 2.0);
  }

  /** normal | yellow | red | warp */
  setAlertLevel(level) {
    if (level === this.alertLevel) return;
    this.alertLevel = level;
    if (!this.ready || !this.ambience) return;
    const cfg = ALERT_AMBIENCE[level] ?? ALERT_AMBIENCE.normal;
    this.ambience.engine.setPitch(cfg.pitch, 1.2);
    this.ambience.engine.fadeTo(cfg.gain, 1.2);
    this.ambience.air.setPitch(cfg.pitch * 3.1, 1.2);
    this.ambience.air.fadeTo(cfg.gain * 0.25, 1.2);
    if (this.ambience.engine.biq) {
      const now = this.ctx.currentTime;
      const f = this.ambience.engine.biq.frequency;
      f.cancelScheduledValues(now);
      f.setValueAtTime(f.value, now);
      f.linearRampToValueAtTime(cfg.filter, now + 1.2);
    }
  }

  stopAmbience() {
    if (!this.ambience) return;
    this.ambience.engine.stop();
    this.ambience.air.stop();
    this.ambience = null;
  }

  // ---------------- Computer / officer voice ----------------

  /**
   * Speaks through the device's own offline TTS. Availability varies by
   * device; the game never depends on it for information, so a silent
   * device loses nothing but flavour.
   */
  speak(text, { pitch = 0.9, rate = 1.0, volume = 0.9, computer = false } = {}) {
    if (!this.voiceEnabled || !text) return;
    const synth = globalThis.speechSynthesis;
    if (!synth) return;
    try {
      const utter = new globalThis.SpeechSynthesisUtterance(text);
      utter.pitch = computer ? 0.6 : pitch;
      utter.rate = computer ? 0.92 : rate;
      utter.volume = volume * this.volumes.voice * (this.enabled ? 1 : 0);
      const voices = synth.getVoices();
      if (voices.length) {
        const preferred = voices.find((v) => /en[-_]?(GB|US)/i.test(v.lang)) ?? voices[0];
        utter.voice = preferred;
      }
      synth.speak(utter);
    } catch {
      // TTS is optional flavour.
    }
  }

  cancelSpeech() {
    try { globalThis.speechSynthesis?.cancel(); } catch { /* optional */ }
  }
}

export const audio = new AudioEngine();
