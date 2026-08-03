// 64-bit deterministic pseudo-random number generation.
//
// The whole simulation is reproducible from a single 64-bit seed: the galaxy,
// every encounter roll, every damage variance. Saves store the seed and the
// draw counter, so a restored game continues the exact same number stream.
//
// xoshiro256** by Blackman & Vigna, on BigInt state. splitmix64 seeds it.

const M64 = (1n << 64n) - 1n;

const rotl = (x, k) => ((x << k) | (x >> (64n - k))) & M64;

/** splitmix64 — used to expand one seed into xoshiro's four state words. */
export function splitmix64(seed) {
  let z = BigInt.asUintN(64, seed);
  return () => {
    z = (z + 0x9e3779b97f4a7c15n) & M64;
    let x = z;
    x = ((x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
    x = ((x ^ (x >> 27n)) * 0x94d049bb133111ebn) & M64;
    return x ^ (x >> 31n);
  };
}

/** Hash an arbitrary string into a 64-bit seed (FNV-1a, then avalanched). */
export function hashSeed(str) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * 0x100000001b3n) & M64;
  }
  return splitmix64(h)();
}

export class RNG {
  /**
   * @param {bigint|number|string} seed
   * @param {bigint} [count] draws already consumed (for save restore)
   */
  constructor(seed = 0x1701n, count = 0n) {
    this.seed = typeof seed === 'bigint' ? BigInt.asUintN(64, seed)
      : typeof seed === 'number' ? BigInt.asUintN(64, BigInt(Math.floor(seed)))
      : hashSeed(String(seed));
    this.reset(count);
  }

  reset(count = 0n) {
    const sm = splitmix64(this.seed);
    this.s = [sm(), sm(), sm(), sm()];
    this.count = 0n;
    // Fast-forwarding by replay keeps restore exact without jump polynomials.
    for (let i = 0n; i < count; i++) this.next();
  }

  /** Raw 64-bit draw. */
  next() {
    const s = this.s;
    const result = (rotl((s[1] * 5n) & M64, 7n) * 9n) & M64;
    const t = (s[1] << 17n) & M64;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 45n);
    this.count++;
    return result;
  }

  /** Float in [0,1) with full 53-bit mantissa precision. */
  float() {
    return Number(this.next() >> 11n) / 9007199254740992; // 2^53
  }

  /** Float in [min,max). */
  range(min, max) {
    return min + this.float() * (max - min);
  }

  /** Integer in [min,max] inclusive. */
  int(min, max) {
    if (max < min) return min;
    return min + Number(this.next() % BigInt(max - min + 1));
  }

  /** True with probability p. */
  chance(p) {
    return this.float() < p;
  }

  pick(arr) {
    return arr.length ? arr[this.int(0, arr.length - 1)] : undefined;
  }

  /** Weighted pick. `weightOf` defaults to reading `.weight`. */
  weighted(arr, weightOf = (x) => x.weight ?? 1) {
    let total = 0;
    for (const item of arr) total += Math.max(0, weightOf(item));
    if (total <= 0) return this.pick(arr);
    let roll = this.float() * total;
    for (const item of arr) {
      roll -= Math.max(0, weightOf(item));
      if (roll <= 0) return item;
    }
    return arr[arr.length - 1];
  }

  /** In-place Fisher-Yates. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Approximately normal via Irwin-Hall; clamped to +/-3 sigma. */
  normal(mean = 0, sigma = 1) {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += this.float();
    const z = (sum - 3) / Math.sqrt(0.5);
    return mean + sigma * Math.max(-3, Math.min(3, z));
  }

  /** Independent stream derived from this seed — used per-system/per-mission. */
  fork(label) {
    return new RNG(BigInt.asUintN(64, this.seed ^ hashSeed(label)));
  }

  save() {
    return { seed: this.seed.toString(), count: this.count.toString() };
  }

  static load(data) {
    if (!data) return new RNG();
    return new RNG(BigInt(data.seed), BigInt(data.count ?? 0));
  }
}

/** Shared stream for presentation-only randomness (never affects sim outcomes). */
export const cosmetic = new RNG(hashSeed('cosmetic'));
