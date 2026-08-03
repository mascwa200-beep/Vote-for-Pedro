// Low-level synthesis primitives.
//
// Everything the game plays is built from these at runtime. No sample files
// exist anywhere in this project, which is why there is nothing to preload.

/** Cached noise buffers, keyed by duration in tenths of a second. */
const noiseCache = new Map();

export function noiseBuffer(ctx, seconds = 1) {
  const key = Math.round(seconds * 10);
  if (noiseCache.has(key)) return noiseCache.get(key);
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseCache.set(key, buf);
  return buf;
}

/** Noise with a 1/f slope — reads as "big machine" rather than "hiss". */
export function pinkNoiseBuffer(ctx, seconds = 2) {
  const key = -Math.round(seconds * 10);
  if (noiseCache.has(key)) return noiseCache.get(key);
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  noiseCache.set(key, buf);
  return buf;
}

/**
 * Impulse response for the convolution reverb — a decaying noise burst.
 * Gives the bridge a sense of enclosed volume without any asset.
 */
export function impulseResponse(ctx, seconds = 1.6, decay = 3.2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

/**
 * A single oscillator voice with an ADSR-ish envelope.
 * `pitch` may be a number or [start, end] for a sweep.
 */
export function tone(ctx, dest, {
  type = 'sine', pitch = 440, at = 0, duration = 0.2,
  gain = 0.2, attack = 0.005, release = 0.08,
  detune = 0, curve = 'exponential',
} = {}) {
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.detune.value = detune;

  const [p0, p1] = Array.isArray(pitch) ? pitch : [pitch, pitch];
  osc.frequency.setValueAtTime(Math.max(1, p0), t0);
  if (p1 !== p0) {
    if (curve === 'exponential') {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, p1), t0 + duration);
    } else {
      osc.frequency.linearRampToValueAtTime(Math.max(1, p1), t0 + duration);
    }
  }

  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration + release);

  osc.connect(amp).connect(dest);
  osc.start(t0);
  osc.stop(t0 + duration + release + 0.05);
  return { osc, amp, endsAt: t0 + duration + release };
}

/** A filtered noise burst — impacts, transporters, explosions. */
export function noiseBurst(ctx, dest, {
  at = 0, duration = 0.3, gain = 0.3,
  filter = 'bandpass', freq = 900, q = 1.2, freqEnd = null,
  attack = 0.004, release = 0.1, pink = false,
} = {}) {
  const t0 = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = pink ? pinkNoiseBuffer(ctx, Math.max(0.5, duration + release))
                    : noiseBuffer(ctx, Math.max(0.5, duration + release));
  const biq = ctx.createBiquadFilter();
  biq.type = filter;
  biq.frequency.setValueAtTime(Math.max(20, freq), t0);
  biq.Q.value = q;
  if (freqEnd != null) {
    biq.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + duration);
  }
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration + release);

  src.connect(biq).connect(amp).connect(dest);
  src.start(t0);
  src.stop(t0 + duration + release + 0.05);
  return { src, amp, endsAt: t0 + duration + release };
}

/** Frequency-modulated voice — metallic, mechanical timbres. */
export function fmTone(ctx, dest, {
  at = 0, carrier = 300, ratio = 2.4, index = 400,
  duration = 0.4, gain = 0.25, attack = 0.005, release = 0.15, type = 'sine',
} = {}) {
  const t0 = ctx.currentTime + at;
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const modGain = ctx.createGain();
  const amp = ctx.createGain();

  car.type = type;
  mod.type = 'sine';
  car.frequency.value = carrier;
  mod.frequency.value = carrier * ratio;
  modGain.gain.setValueAtTime(index, t0);
  modGain.gain.exponentialRampToValueAtTime(1, t0 + duration);

  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration + release);

  mod.connect(modGain).connect(car.frequency);
  car.connect(amp).connect(dest);
  mod.start(t0); car.start(t0);
  mod.stop(t0 + duration + release + 0.05);
  car.stop(t0 + duration + release + 0.05);
  return { car, amp, endsAt: t0 + duration + release };
}

/** A sustained looping source the caller stops later (ambience, engine hum). */
export function drone(ctx, dest, {
  type = 'sawtooth', pitch = 60, gain = 0.06, filterFreq = 320, q = 0.8, detune = 6,
} = {}) {
  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();
  const biq = ctx.createBiquadFilter();
  const amp = ctx.createGain();

  oscA.type = type; oscB.type = type;
  oscA.frequency.value = pitch;
  oscB.frequency.value = pitch;
  oscB.detune.value = detune;
  biq.type = 'lowpass';
  biq.frequency.value = filterFreq;
  biq.Q.value = q;
  amp.gain.value = 0;

  oscA.connect(biq); oscB.connect(biq);
  biq.connect(amp).connect(dest);
  oscA.start(); oscB.start();

  return {
    amp, biq, oscA, oscB,
    fadeTo(value, seconds = 0.6) {
      const now = ctx.currentTime;
      amp.gain.cancelScheduledValues(now);
      amp.gain.setValueAtTime(Math.max(0.0001, amp.gain.value), now);
      amp.gain.linearRampToValueAtTime(value, now + seconds);
    },
    setPitch(value, seconds = 0.5) {
      const now = ctx.currentTime;
      for (const o of [oscA, oscB]) {
        o.frequency.cancelScheduledValues(now);
        o.frequency.setValueAtTime(o.frequency.value, now);
        o.frequency.linearRampToValueAtTime(Math.max(1, value), now + seconds);
      }
    },
    stop(fade = 0.4) {
      const now = ctx.currentTime;
      amp.gain.cancelScheduledValues(now);
      amp.gain.setValueAtTime(Math.max(0.0001, amp.gain.value), now);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + fade);
      oscA.stop(now + fade + 0.1);
      oscB.stop(now + fade + 0.1);
    },
  };
}
