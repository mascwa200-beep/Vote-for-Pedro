// The mixer, and why it was too quiet to hear.
//
// The complaint was "the sound effects are too quiet". Measuring the graph
// found four compounding causes and no single bug, so these tests pin the
// arithmetic rather than any one line: what a cue's peak actually is by the
// time it reaches the speaker, and how much headroom the player can reach.
//
// A fake AudioContext is enough for all of it. Nothing here needs to make a
// sound — it needs to know how loud the sound would have been.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../src/audio/engine.js';
import { CUES, busFor } from '../src/audio/sfx.js';

// --------------------------------------------------------------- the fake

/**
 * An AudioParam that remembers the loudest value it was ever *asked* for.
 *
 * The construction default is deliberately not counted. A GainNode is born at
 * 1.0 and the synth then schedules it down to a real amplitude — if the
 * default seeded the peak, every cue would measure as unity and this whole
 * file would pass while measuring nothing.
 */
class FakeParam {
  constructor(value = 0) { this._v = value; this.peak = 0; }
  get value() { return this._v; }
  set value(v) { this._v = v; this._note(v); }
  _note(v) { if (Number.isFinite(v) && Math.abs(v) > Math.abs(this.peak)) this.peak = v; }
  setValueAtTime(v) { this.value = v; return this; }
  linearRampToValueAtTime(v) { this.value = v; return this; }
  exponentialRampToValueAtTime(v) { this.value = v; return this; }
  setTargetAtTime(v) { this.value = v; return this; }
  cancelScheduledValues() { return this; }
}

class FakeNode {
  constructor(kind) { this.kind = kind; this.outputs = []; }
  connect(dest) { this.outputs.push(dest); return dest; }
  disconnect() { this.outputs.length = 0; }
  start() {}
  stop() {}
}

class FakeGain extends FakeNode {
  constructor() { super('gain'); this.gain = new FakeParam(1); }
}

function fakeContext() {
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    state: 'running',
    destination: new FakeNode('destination'),
    resumeCalls: 0,
    resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); },
    createGain: () => new FakeGain(),
    createConvolver: () => Object.assign(new FakeNode('convolver'), { buffer: null }),
    createDynamicsCompressor: () => Object.assign(new FakeNode('comp'), {
      threshold: new FakeParam(-24), knee: new FakeParam(30), ratio: new FakeParam(12),
      attack: new FakeParam(0.003), release: new FakeParam(0.25),
      reduction: 0,
    }),
    createOscillator: () => Object.assign(new FakeNode('osc'), {
      frequency: new FakeParam(440), detune: new FakeParam(0), type: 'sine',
    }),
    createBufferSource: () => Object.assign(new FakeNode('source'), {
      buffer: null, loop: false, playbackRate: new FakeParam(1),
    }),
    createBiquadFilter: () => Object.assign(new FakeNode('biquad'), {
      frequency: new FakeParam(350), Q: new FakeParam(1), gain: new FakeParam(0), type: 'lowpass',
    }),
    createBuffer: (channels, length, rate) => ({
      numberOfChannels: channels,
      length,
      sampleRate: rate,
      getChannelData: () => new Float32Array(length),
    }),
  };
  return ctx;
}

/** Boot an engine on a fake context, exactly as unlock() would. */
function bootedEngine() {
  const ctx = fakeContext();
  const engine = new AudioEngine();
  globalThis.AudioContext = function AudioContextShim() { return ctx; };
  try {
    engine.unlock();
  } finally {
    delete globalThis.AudioContext;
  }
  return { engine, ctx };
}

/**
 * The gain a cue's loudest voice sees by the time it reaches the speaker.
 *
 * Walks the real graph the engine built: voice gain x bus x (makeup) x master.
 * Reverb is a parallel send and is deliberately not counted — it adds
 * loudness but the dry path is what has to be audible.
 */
function chainGain(engine, cueName) {
  const bus = engine.buses[busFor(cueName)] ?? engine.buses.sfx;
  let g = bus.gain.value;
  // Everything between the bus and the destination.
  let node = bus.outputs[0];
  const seen = new Set();
  while (node && !seen.has(node)) {
    seen.add(node);
    if (node.kind === 'gain') g *= node.gain.value;
    if (node.kind === 'destination') break;
    node = node.outputs[0];
  }
  return g;
}

/**
 * Does this node's output eventually arrive at `target`?
 *
 * The thing that separates an amplitude gain from a modulation gain: an
 * amplitude reaches the bus, a modulator terminates on an AudioParam.
 */
function reaches(node, target, seen = new Set()) {
  if (node === target) return true;
  if (!node || seen.has(node) || !Array.isArray(node.outputs)) return false;
  seen.add(node);
  return node.outputs.some((out) => reaches(out, target, seen));
}

// ------------------------------------------------------------------ tests

describe('the mixer is loud enough to hear', () => {
  // A cue whose peak lands below about -14 dBFS is lost against road noise on
  // a phone speaker. -14 dBFS is a linear amplitude of 0.2.
  //
  // The whole set used to sit between -28 and -10 dBFS, with the median around
  // -18. It now runs -12 to -1. This floor is set just under the quietest
  // survivor so a future cue cannot be added at the old levels.
  const AUDIBLE = 0.2;

  test('every cue reaches the speaker at a usable level', () => {
    const { engine, ctx } = bootedEngine();
    const quiet = [];

    for (const name of Object.keys(CUES)) {
      const bus = engine.buses[busFor(name)] ?? engine.buses.sfx;
      const made = [];
      const realCreateGain = ctx.createGain;
      ctx.createGain = () => { const g = realCreateGain(); made.push(g); return g; };
      try { CUES[name](ctx, bus, {}); } catch { /* a cue that throws is another test */ }
      ctx.createGain = realCreateGain;

      // Only gains that actually reach the bus are amplitudes. `fmTone` builds
      // a gain node whose value is the modulation index — 340, 900, numbers
      // like that — and connects it to an oscillator's frequency AudioParam.
      // Counting those as loudness reads a cue as +55 dBFS and makes this
      // whole test pass while measuring nothing.
      const voicePeak = made
        .filter((g) => reaches(g, bus))
        .reduce((m, g) => Math.max(m, Math.abs(g.gain.peak)), 0);
      const peak = voicePeak * chainGain(engine, name);
      if (peak < AUDIBLE) quiet.push(`${name} peaks at ${peak.toFixed(3)}`);
    }

    assert.deepEqual(quiet, [], 'cues too quiet to hear on a phone speaker');
  });

  test('the master defaults to unity, not to a cut', () => {
    const { engine } = bootedEngine();
    assert.ok(engine.master.gain.value >= 1,
      `master starts at ${engine.master.gain.value}, so the game is quieter than it needs to be before anything else happens`);
  });

  test('the compressor gets makeup gain, because Web Audio has none', () => {
    // DynamicsCompressorNode reduces and never restores. Without a makeup
    // stage every loud moment is permanently quieter than it should be.
    const { engine } = bootedEngine();
    assert.ok(engine.makeup, 'no makeup gain stage exists');
    assert.ok(engine.makeup.gain.value > 1,
      `makeup gain is ${engine.makeup.gain.value}, which restores nothing`);
  });

  test('the volume sliders have headroom above the default', () => {
    const { engine } = bootedEngine();
    engine.setVolume('master', 2);
    assert.equal(engine.master.gain.value, 2,
      'master cannot be raised above 1, so a quiet phone cannot be compensated for');
  });
});

describe('mute', () => {
  test('mute silences the ship, and unmute brings it back', () => {
    const { engine } = bootedEngine();
    const before = engine.master.gain.value;
    engine.setEnabled(false);
    assert.equal(engine.master.gain.value, 0, 'muting left the master open');
    engine.setEnabled(true);
    assert.equal(engine.master.gain.value, before, 'unmuting did not restore the level');
  });

  test('a muted engine plays nothing', () => {
    const { engine, ctx } = bootedEngine();
    engine.setEnabled(false);
    let made = 0;
    const real = ctx.createOscillator;
    ctx.createOscillator = () => { made++; return real(); };
    engine.play('red_alert');
    ctx.createOscillator = real;
    assert.equal(made, 0, 'a muted engine still built a voice');
  });
});

describe('the context comes back', () => {
  // The bug this is really about: a phone suspends the AudioContext when the
  // app goes to the background, and nothing in the game ever resumed it. The
  // gesture listener in main.js removes itself after firing once. So the game
  // went permanently silent on the first time you looked at something else.
  test('unlock resumes a suspended context rather than giving up', () => {
    const { engine, ctx } = bootedEngine();
    ctx.state = 'suspended';
    engine.unlock();
    assert.equal(ctx.resumeCalls, 1, 'a suspended context was not resumed');
    assert.equal(ctx.state, 'running');
  });

  test('unlock is safe to call repeatedly on a running context', () => {
    const { engine, ctx } = bootedEngine();
    const busesBefore = engine.buses.sfx;
    engine.unlock();
    engine.unlock();
    assert.equal(engine.buses.sfx, busesBefore, 'unlock rebuilt the graph');
    assert.equal(ctx.resumeCalls, 0, 'a running context was needlessly resumed');
  });
});
