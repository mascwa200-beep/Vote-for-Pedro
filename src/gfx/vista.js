// What is outside the window when nobody is shooting.
//
// The tactical display only ever had something to draw during a fight. A
// viewscreen that goes black the moment the shooting stops is not a viewscreen,
// it is a combat camera — so this file answers the other question: you are
// parked at Rigel VII, you say "on screen", what do you see?
//
// A primary and a handful of worlds, placed once per system and identical every
// time you come back. That last part is the whole point. A planet that moves
// between visits is a screensaver; a planet that is exactly where you left it is
// a place.
//
// Two rules this file exists to keep:
//
//   The campaign's RNG is never touched. `Game.rng` is a save-file-critical
//   stream — drawing from it to decide the colour of a moon would desynchronise
//   a five-year commission from its own seed. Everything here hashes the system
//   id instead, so generating a vista is observationally free.
//
//   No meshes are built. This is placement only. `bodyMesh` in scene.js turns a
//   `kind` into geometry, and it memoises per kind, so forty systems of scenery
//   cost six meshes total.

// The camera arithmetic for the viewscreen lives here rather than in the view
// that uses it, for one reason: `ui/tactical3d.js` cannot be imported outside a
// browser — it reaches for `document` at module load through its touch helpers.
// Putting the two pure functions the viewscreen camera is built from in a file
// node can import is the difference between testing them and hoping.

import { vec3 } from './math.js';
import { hashSeed } from '../core/rng.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Vertical field of view for a viewport of this shape.
 *
 * The old fixed 52° vertical was tuned on a laptop. On a phone held upright the
 * viewport is about 0.46 wide to tall, and 52° vertical works out to twenty-five
 * degrees horizontal — a letterbox turned on its side, through which you can see
 * almost nothing. Fixing the *horizontal* angle and solving for the vertical is
 * the correct way round: the width of what you can see is what matters, and it
 * then stays constant as the shape of the window changes.
 *
 * The clamp is what stops the arithmetic from being silly at extremes — a very
 * tall window would otherwise demand a vertical FOV past 120°, which is all
 * distortion and no information.
 */
export function fovFor(aspect, horizontalDeg = 82) {
  // A viewport of NaN is not a hypothetical: `getBoundingClientRect` on a node
  // that is mid-swap returns zeros, and 0/0 is how a black screen starts.
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const halfH = Math.tan(horizontalDeg * DEG / 2);
  const fovy = 2 * Math.atan(halfH / a);
  // The ceiling is a real limit, not a rounding: a very tall window would
  // otherwise demand 113 degrees vertical to hold 82 horizontal, and that is
  // all barrel distortion and no information. Where it binds, the horizontal
  // view narrows — which is why the viewer's bezel pins the picture at 16:9
  // rather than letting it take the shape of the phone.
  return clamp(fovy, 46 * DEG, 88 * DEG);
}

/** The narrowest horizontal view any viewport shape can be reduced to. */
export function horizontalFov(aspect, horizontalDeg = 82) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return 2 * Math.atan(Math.tan(fovFor(a, horizontalDeg) / 2) * a);
}

/**
 * The direction a hull's nose points, in render space.
 *
 * The simulation carries a compass heading in the xy plane with z for altitude;
 * render space is +y up with sim y mapped onto render z. Getting this conversion
 * wrong gives you a viewscreen that looks ninety degrees off the bow and swings
 * the wrong way when you turn, which is exactly as disorienting as it sounds.
 */
export function noseOf(ship, out = vec3()) {
  const h = (ship?.heading ?? 0) * DEG;
  const p = (ship?.pitch ?? 0) * DEG;
  const flat = Math.cos(p);
  out[0] = Math.cos(h) * flat;
  out[1] = Math.sin(p);
  out[2] = Math.sin(h) * flat;
  return out;
}

/** xorshift32 from a seed. Small, fast, and entirely separate from the sim. */
function stream(seed) {
  let h = seed || 0x9e3779b9;
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

// Which worlds a system tends to have. `bodyMesh` knows six kinds; these are
// the pools each system type draws from, so the Neutral Zone does not look like
// Risa and a dead system looks dead.
const KIND_POOLS = {
  core: ['planet', 'planet', 'desert', 'moon'],
  homeworld: ['planet', 'planet', 'moon', 'ice'],
  colony: ['planet', 'desert', 'moon'],
  starbase: ['planet', 'moon', 'ice'],
  station: ['gas', 'moon', 'ice'],
  outpost: ['desert', 'ice', 'moon'],
  anomaly: ['gas', 'gas', 'ice'],
  deadspace: ['moon', 'ice'],
};

// How many worlds are worth drawing. Deadspace is nearly empty on purpose —
// Wolf 359 should feel like an absence, and an empty sky is how you say that.
const BODY_COUNT = {
  core: [3, 4], homeworld: [3, 4], colony: [2, 3], starbase: [2, 3],
  station: [2, 3], outpost: [1, 3], anomaly: [2, 3], deadspace: [0, 1],
};

// Star colour by class, which the palette in scene.js does not vary — so the
// tint is applied per draw instead. Hot blue-white through to a dim red dwarf.
const STAR_TINTS = [
  [1.00, 0.94, 0.82], [1.00, 0.86, 0.55], [1.00, 0.72, 0.42],
  [0.86, 0.90, 1.00], [1.00, 0.58, 0.38],
];

/**
 * Scenery for one system, in render space (+y up), centred on the origin.
 *
 * Distances are chosen against the renderer's 40,000-unit far plane and the
 * 3,000-unit tactical volume: near enough that a world fills a useful slice of
 * the screen, far enough that flying at it during a fight never reaches it.
 *
 * @param {string} systemId
 * @param {string} type    system type from systems.data.js
 * @returns {{bodies: Array, focus: object|null}} focus is what the screen
 *          points at when first opened — the largest thing worth looking at.
 */
export function vistaFor(systemId, type = 'colony') {
  // `hashSeed` returns a 64-bit BigInt; the local stream is a 32-bit
  // xorshift, so it is folded rather than truncated — taking the low word
  // alone throws away exactly the bits the avalanche put the entropy in.
  const h64 = hashSeed(`vista:${systemId}`);
  const rnd = stream(Number((h64 ^ (h64 >> 32n)) & 0xffffffffn));
  const pool = KIND_POOLS[type] ?? KIND_POOLS.colony;
  const [lo, hi] = BODY_COUNT[type] ?? BODY_COUNT.colony;
  const count = lo + Math.floor(rnd() * (hi - lo + 1));

  const bodies = [];

  // The primary. Always present, always the farthest thing, and always the
  // brightest — it is the only object in the sky that is its own light source.
  const starBearing = rnd() * Math.PI * 2;
  const starHeight = (rnd() - 0.5) * 0.34;
  const starDist = 26000 + rnd() * 8000;
  bodies.push({
    id: `${systemId}:primary`,
    kind: 'star',
    x: Math.cos(starBearing) * starDist,
    y: starHeight * starDist,
    z: Math.sin(starBearing) * starDist,
    radius: 2000 + rnd() * 1400,
    tint: STAR_TINTS[Math.floor(rnd() * STAR_TINTS.length)],
    emissive: 1,
    spin: 0,
  });

  // Worlds, spread around the full circle rather than clustered ahead. Turning
  // the ship has to be how you find them, or the sky is wallpaper.
  //
  // Bearings are dealt from evenly spaced arcs with jitter inside each, which
  // avoids the clumping a uniform random gives you at these small counts — two
  // planets overlapping at 4,000 units reads as one badly-drawn planet.
  const arc = (Math.PI * 2) / Math.max(1, count);
  for (let i = 0; i < count; i++) {
    const bearing = i * arc + rnd() * arc;
    const height = (rnd() - 0.5) * 0.30;
    const dist = 4200 + rnd() * 9000;
    const kind = pool[Math.floor(rnd() * pool.length)];
    bodies.push({
      id: `${systemId}:body:${i}`,
      // Worlds are numbered outward from the primary, which is how they are
      // named — "Rigel VII" is the seventh planet and not a codename. The
      // vista deals bearings evenly and distances randomly, so the ordinal is
      // assigned here in placement order rather than sorted by distance: a
      // world's number must not change because a later one was rolled closer.
      ordinal: i + 1,
      kind,
      x: Math.cos(bearing) * dist,
      y: height * dist,
      z: Math.sin(bearing) * dist,
      // Angular size, not absolute size, is what reads: a gas giant far out and
      // a moon close in should both fill a satisfying part of the screen.
      // These are radii as a fraction of distance, so they ARE the angular
      // sizes — a planet subtends about twenty degrees, which is a quarter of
      // the viewer's width. The first pass used a third of these and every
      // world came out a pea.
      radius: dist * (kind === 'gas' ? 0.26 : kind === 'moon' ? 0.11 : 0.18),
      // The body palette in scene.js is mid-tone, and mid-tone under a 0.22
      // ambient with the key light coming from above reads as near-black on a
      // phone. The lift is applied here rather than in the palette because the
      // same meshes are lit differently everywhere else they are used.
      tint: [1.5, 1.5, 1.5],
      emissive: 0,
      // A slow roll so a parked ship is not a still photograph. Purely visual;
      // nothing in the simulation reads it.
      spin: (rnd() - 0.5) * 0.05,
    });
  }

  // What the screen points at when you open it. The nearest real world if there
  // is one, because a planet filling the frame is the shot; the primary if the
  // system is empty, because an empty screen is not.
  const worlds = bodies.filter((b) => b.kind !== 'star');
  const focus = worlds.length
    ? worlds.reduce((best, b) => (Math.hypot(b.x, b.y, b.z) < Math.hypot(best.x, best.y, best.z) ? b : best))
    : bodies[0] ?? null;

  return { systemId, type, bodies, focus };
}

const ROMAN = [
  '', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
];

/**
 * What the crew calls a world out loud: "Rigel VII", or "the primary".
 *
 * Roman numerals rather than names, because the vista is generated and a
 * generated proper noun is a name nobody wrote — "Rigel VII" is a real way to
 * refer to a place the ship has never been, and "Zyrothrax" is a slot machine.
 */
export function worldLabel(systemName, body) {
  if (!body) return systemName;
  if (body.kind === 'star') return `the ${systemName} primary`;
  return `${systemName} ${ROMAN[body.ordinal] ?? body.ordinal}`;
}

/** The render-space compass bearing of a point, in radians. */
export function bearingOf(body) {
  return Math.atan2(body.z, body.x);
}

const CACHE = new Map();

/** Memoised, because the viewscreen asks for this every frame. */
export function vista(systemId, type) {
  const key = `${systemId}:${type}`;
  let v = CACHE.get(key);
  if (!v) {
    v = vistaFor(systemId, type);
    // Forty systems is the whole galaxy, so this can never grow unbounded —
    // but the cap is here anyway, because "can never" is how leaks start.
    if (CACHE.size > 64) CACHE.clear();
    CACHE.set(key, v);
  }
  return v;
}
