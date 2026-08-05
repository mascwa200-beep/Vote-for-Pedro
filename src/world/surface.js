// The ground under a landing party.
//
// Every other room in this game is a fixed set that was measured off blueprints
// and built once. A planet cannot be: there are forty systems, each with up to
// four worlds, and the ship goes where the captain says. So the surface is
// generated — from the world's own id, so it is the same place every time you
// come back to it, and never from `Game.rng`, so walking around on it cannot
// desynchronise a five-year commission from its own seed.
//
// It is shaped like every other room on purpose. The walker, the collision
// resolver, the console dispatch and the renderer all take a room, and a planet
// that was a special case in each of them would be four chances to get it
// wrong. It is a room with a sky instead of a ceiling.

import { ROOMS } from './interiors.data.js';
import { hashSeed } from '../core/rng.js';

/** How far a landing party can walk from the beam-down point, in metres. */
export const SURFACE_RADIUS = 15;

/**
 * The look of each world type, in the two or three colours that decide it.
 *
 * `ground` and `rock` are lit; `sky` and `haze` are not, because a sky is the
 * light source. The gas giant has an entry because a landing party can be put
 * on a moon of one and see it overhead — not because anybody stands on it.
 */
const LOOK = {
  planet: {
    ground: [0.32, 0.40, 0.22], rock: [0.38, 0.35, 0.30],
    sky: [0.26, 0.46, 0.80], haze: [0.72, 0.82, 0.92],
    weather: 'thin cloud, and air you can breathe',
  },
  desert: {
    ground: [0.62, 0.48, 0.28], rock: [0.48, 0.36, 0.24],
    sky: [0.62, 0.50, 0.40], haze: [0.86, 0.74, 0.58],
    weather: 'dust in the air, and not much of the air',
  },
  ice: {
    ground: [0.80, 0.86, 0.92], rock: [0.60, 0.68, 0.76],
    sky: [0.42, 0.56, 0.76], haze: [0.88, 0.93, 0.98],
    weather: 'nothing moving, and nothing warm',
  },
  moon: {
    // No atmosphere means no scattering, which means the sky is BLACK at noon.
    // It is the single most telling thing about standing on an airless body and
    // it costs one palette entry to get right.
    ground: [0.44, 0.43, 0.42], rock: [0.32, 0.31, 0.31],
    sky: [0.02, 0.02, 0.03], haze: [0.06, 0.06, 0.08],
    weather: 'no atmosphere at all — suits, and the stars are out',
  },
  gas: {
    ground: [0.46, 0.42, 0.36], rock: [0.34, 0.31, 0.28],
    sky: [0.52, 0.44, 0.34], haze: [0.80, 0.72, 0.58],
    weather: 'a sky with no floor under it',
  },
};

/** What the sensors say before anybody steps off the pad. */
export function surfaceReport(kind) {
  return (LOOK[kind] ?? LOOK.planet).weather;
}

/**
 * Build the surface of one world as a room, and register it.
 *
 * @param {object} body   a vista body: {id, kind, ordinal}
 * @param {string} label  what the crew calls it — "Vulcan IV"
 * @returns {object} the room, already in ROOMS under the id `surface`
 */
export function makeSurface(body, label) {
  const look = LOOK[body.kind] ?? LOOK.planet;
  const h = hashSeed(`surface:${body.id}`);
  const seed = Number(h & 0x7fffffffn);

  // A local stream, so the scatter is deterministic per world and costs the
  // campaign's own RNG nothing.
  let s = seed || 1;
  const rnd = () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0;
    return (s >>> 0) / 4294967296;
  };

  // Boulders, thrown outside the pad circle so nobody materialises inside one.
  // Dealt from evenly spaced arcs rather than uniformly at random, which at
  // these counts is the difference between scattered and clumped.
  const count = 9 + Math.floor(rnd() * 5);
  const arc = (Math.PI * 2) / count;
  const props = Array.from({ length: count }, (_, i) => {
    const a = i * arc + rnd() * arc;
    const d = 3.4 + rnd() * (SURFACE_RADIUS - 5);
    const tone = 0.82 + rnd() * 0.34;
    return {
      id: `rock${i}`,
      kind: 'rock',
      label: 'A boulder',
      at: [Math.sin(a) * d, Math.cos(a) * d],
      facing: rnd() * Math.PI * 2,
      radius: 0.5 + rnd() * 1.1,
      solid: true,
      color: [look.rock[0] * tone, look.rock[1] * tone, look.rock[2] * tone],
    };
  });

  const room = {
    id: 'surface',
    name: label,
    // Not a deck. Nothing about a planet is on deck seven, and the turbolift
    // must never offer it as a stop — which it cannot, because LIFT_STOPS is
    // built from the rooms that have a lift door and this one has no doors.
    deck: null,
    surface: true,
    world: body.id,
    kind: body.kind,
    shape: { kind: 'surface', radius: SURFACE_RADIUS, height: 2.4, seed },
    palette: look,
    stations: [],
    props,
    exits: [],
    // Distinct per world, so the mesh cache does not hand back the last planet.
    cacheKey: `surface:${body.id}`,
  };

  ROOMS.surface = room;
  return room;
}

/** Take the surface back out of the world once the party is aboard. */
export function clearSurface() {
  delete ROOMS.surface;
}
