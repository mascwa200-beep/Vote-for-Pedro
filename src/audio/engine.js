// The mixer: bus graph, ambience, and the public play() surface.
//
// AudioContext creation is deferred until the first user gesture, which is
// what mobile browsers require. Nothing is fetched, so "loading" audio is
// just building an oscillator graph — microseconds, not a progress bar.

import { CUES, busFor } from './sfx.js';
import { drone, wind, impulseResponse } from './synth.js';

// The bridge hum.
//
// This is the most-heard sound in the whole show — it is under every scene set
// aboard, and its absence is what makes a quiet bridge feel like a menu rather
// than a room. It was mixed at 0.05, which on a phone is inaudible, so the
// ship simply had no presence at all.
//
// Pitched around 55 Hz with the air layer three octaves up, which is where the
// original engine rumble sits: low enough to feel, with enough upper content
// to survive a speaker that cannot reproduce 55 Hz at all.
const ALERT_AMBIENCE = {
  normal: { pitch: 55, gain: 0.16, filter: 320 },
  yellow: { pitch: 60, gain: 0.20, filter: 440 },
  red: { pitch: 66, gain: 0.26, filter: 600 },
  warp: { pitch: 82, gain: 0.30, filter: 940 },
};

/**
 * What each compartment sounds like, as multipliers on the alert bed.
 *
 * docs/RESEARCH.md §9: every set on that show had its own sonic identity, and
 * the identities were not subtle. The bridge is continuous panel bleeps and
 * chirps over a bed. Engineering is the same idea an octave down — heavy
 * generators, loud. The transporter room has its own throb of power, distinct
 * from the bridge. This game had ONE drone everywhere, which is the sound of a
 * ship with a single room in it.
 *
 * Multipliers rather than absolute values, because the alert condition also
 * moves this bed and the two have to compose: red alert in engineering is the
 * engineering bed raised, not the bridge's red bed played downstairs.
 *
 *   pitch  — where the fundamental sits. Down is bigger machinery.
 *   gain   — how loud the room is. Engineering is a room you shout in.
 *   filter — how much high end survives. A machine space is bright with
 *            harmonics; a cabin is muffled by soft furnishing.
 *   chirps — panel bleeps per second, 0 for rooms that had none.
 */
const ROOM_AMBIENCE = {
  bridge: { pitch: 1.0, gain: 1.0, filter: 1.0, chirps: 0.7 },
  // Down an octave and half again as loud. The reactor room is the one
  // compartment where you can hear the ship being a ship.
  engineering: { pitch: 0.5, gain: 1.55, filter: 1.9, chirps: 0.25 },
  // Its own throb: up a fifth, tighter, and a slow beat under it.
  transporter: { pitch: 1.5, gain: 1.05, filter: 0.8, chirps: 0.35 },
  // Medical monitors, quiet and high.
  sickbay: { pitch: 2.0, gain: 0.62, filter: 1.3, chirps: 0.5 },
  // Soft furnishing eats the high end and most of the level.
  quarters: { pitch: 1.0, gain: 0.45, filter: 0.55, chirps: 0 },
  briefing: { pitch: 1.0, gain: 0.55, filter: 0.7, chirps: 0.1 },
  // A moving car in a shaft: the hum rises and there is nothing else in it.
  turbolift: { pitch: 1.25, gain: 0.85, filter: 1.15, chirps: 0 },
  corridor_a: { pitch: 0.85, gain: 0.7, filter: 0.9, chirps: 0.15 },
};

const DEFAULT_ROOM = { pitch: 1.0, gain: 1.0, filter: 1.0, chirps: 0.2 };

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.buses = {};
    // Unity, not a cut. This used to default to 0.8 with a slider ceiling of
    // 1.0, so the game started 2 dB down and the player could recover exactly
    // that much — on a phone speaker in a room with any noise in it, the
    // difference between audible and not.
    this.volumes = { master: 1.0, ui: 1.0, sfx: 1.0, alert: 1.0, ambience: 0.8, voice: 1.0 };
    this.ambience = null;
    // Where the captain is standing, which decides the bed. Null until told.
    this.roomId = null;
    this.roomKey = null;
    this.outdoors = false;
    this.airless = false;
    this.chirpTimer = null;
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
    //
    // The knee was 22 dB wide at a −14 dB threshold, so it started bending at
    // −25 dBFS — below where ordinary cues sit, meaning everything got reduced
    // a little and nothing was ever restored. A tighter knee leaves normal
    // cues alone and only catches the volley it exists for.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 6;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;

    // Makeup gain. A DynamicsCompressorNode reduces and never restores — Web
    // Audio gives you no makeup stage — so without this every loud moment is
    // permanently quieter than it should be and nothing gives it back.
    const makeup = ctx.createGain();
    makeup.gain.value = 1.9;
    comp.connect(makeup).connect(master);

    for (const name of ['ui', 'sfx', 'alert', 'ambience', 'voice']) {
      const g = ctx.createGain();
      g.gain.value = this.volumes[name] ?? 1;
      g.connect(comp);
      if (name !== 'ui' && name !== 'voice') g.connect(verbSend);
      this.buses[name] = g;
    }

    this.master = master;
    this.makeup = makeup;
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
    this.rebuildAmbience();
  }

  /**
   * Build the bed the current place asks for.
   *
   * Rebuilt rather than retuned when the PLACE changes, because a planet and a
   * ship are not the same instrument: one is two detuned oscillators through a
   * lowpass and the other is pink noise through a moving bandpass. Retuning
   * cannot turn one into the other. Within a place — walking from the bridge to
   * engineering, or going to red alert — the same voices are retuned, which is
   * why the transition is a slide and not a cut.
   */
  rebuildAmbience() {
    if (!this.ready) return;
    this.stopAmbience();
    const bus = this.buses.ambience;

    // No air, no sound. Nothing to start.
    if (this.airless) { this.scheduleChirps(0); return; }

    if (this.outdoors) {
      // Weather, not machinery. No chirps either: there are no panels on a
      // planet, and the silence where they were is most of what tells you that
      // you are not aboard any more.
      this.ambience = { engine: wind(this.ctx, bus, { centre: 430, gain: 0.14, q: 0.8 }), air: null };
      this.ambience.engine.fadeTo(0.15, 2.5);
      this.scheduleChirps(0);
      return;
    }

    const cfg = this.ambienceConfig();
    this.ambience = {
      engine: drone(this.ctx, bus, { type: 'sawtooth', pitch: cfg.pitch, filterFreq: cfg.filter, detune: 7 }),
      air: drone(this.ctx, bus, { type: 'triangle', pitch: cfg.pitch * 3.1, filterFreq: 900, detune: 3, q: 0.5 }),
    };
    this.ambience.engine.fadeTo(cfg.gain, 2.0);
    // 0.45, not 0.25. A phone speaker cannot reproduce the 55 Hz fundamental
    // at all — the air layer three octaves up is the entire sound as far as
    // the device is concerned, so mixing it as a faint garnish left the bridge
    // silent on exactly the hardware this game is built for.
    this.ambience.air.fadeTo(cfg.gain * 0.45, 2.0);
    this.scheduleChirps(cfg.chirps);
  }

  /** normal | yellow | red | warp */
  setAlertLevel(level) {
    if (level === this.alertLevel) return;
    this.alertLevel = level;
    this.retuneAmbience(1.2);
  }

  /**
   * Which compartment the captain is standing in.
   *
   * `airless` is the one that is not a mixing decision. There is no medium on a
   * moon, so there is no sound — not a quiet room tone, nothing. It is the most
   * arresting thing about standing on an airless body and the game can have it
   * for free, because silence is what you get by not starting anything.
   */
  setRoom(roomId, { outdoors = false, airless = false } = {}) {
    const next = `${roomId}:${outdoors ? 'out' : 'in'}:${airless ? 'dead' : 'air'}`;
    if (next === this.roomKey) return;
    this.roomKey = next;
    this.roomId = roomId;
    this.outdoors = outdoors;
    this.airless = airless;
    if (!this.ready) return;
    this.rebuildAmbience();
  }

  /** The bed the current room and alert condition ask for, as one object. */
  ambienceConfig() {
    const alert = ALERT_AMBIENCE[this.alertLevel] ?? ALERT_AMBIENCE.normal;
    const room = ROOM_AMBIENCE[this.roomId] ?? DEFAULT_ROOM;
    return {
      pitch: alert.pitch * room.pitch,
      gain: alert.gain * room.gain,
      filter: alert.filter * room.filter,
      chirps: room.chirps,
    };
  }

  retuneAmbience(seconds = 1.2) {
    if (!this.ready || !this.ambience) return;
    const cfg = this.ambienceConfig();
    const { engine, air } = this.ambience;
    if (engine) {
      engine.setPitch(cfg.pitch, seconds);
      engine.fadeTo(cfg.gain, seconds);
      if (engine.biq) {
        const now = this.ctx.currentTime;
        const f = engine.biq.frequency;
        f.cancelScheduledValues(now);
        f.setValueAtTime(f.value, now);
        f.linearRampToValueAtTime(cfg.filter, now + seconds);
      }
    }
    if (air) {
      air.setPitch(cfg.pitch * 3.1, seconds);
      air.fadeTo(cfg.gain * 0.45, seconds);
    }
    this.scheduleChirps(cfg.chirps);
  }

  /**
   * Panel bleeps, at a rate the room decides.
   *
   * Scheduled one at a time rather than on a fixed interval: a bleep every
   * exactly 1.4 seconds is a metronome, and a metronome is the one thing a
   * background must never be. Each one books the next at a random distance, so
   * the pattern never repeats and the ear stops tracking it.
   */
  scheduleChirps(rate) {
    // `arm` rather than a bare setTimeout: a bed that reschedules itself
    // forever will hold a Node process open forever, which is how a test run
    // that passes still never exits. Browsers hand back a number and ignore
    // this; Node hands back a Timeout and lets go of it.
    const arm = (fn, ms) => {
      const t = setTimeout(fn, ms);
      t?.unref?.();
      return t;
    };
    if (this.chirpTimer) { clearTimeout(this.chirpTimer); this.chirpTimer = null; }
    if (!this.ready || !this.enabled || !(rate > 0)) return;
    const tick = () => {
      this.chirpTimer = null;
      if (!this.ready || !this.enabled) return;
      // Muted while somebody is talking to you or shooting at you: the bed is
      // meant to be under everything, not competing with it.
      if (this.alertLevel !== 'red') this.play('panel_chirp');
      const mean = 1 / rate;
      this.chirpTimer = arm(tick, mean * (0.45 + Math.random() * 1.4) * 1000);
    };
    this.chirpTimer = arm(tick, 300 + Math.random() * 900);
  }

  stopAmbience() {
    if (this.chirpTimer) { clearTimeout(this.chirpTimer); this.chirpTimer = null; }
    if (!this.ambience) return;
    this.ambience.engine?.stop();
    this.ambience.air?.stop();
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
