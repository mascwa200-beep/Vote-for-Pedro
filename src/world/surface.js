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
 * What is worth walking over to.
 *
 * A landing party that beams down onto empty ground has not landed anywhere —
 * it has changed skybox. These are the things that make a world a place: a
 * mineral seam, something somebody built, something alive, something that came
 * down hard, and a fissure venting from below.
 *
 * Each carries the three fields that turn it from scenery into gameplay:
 *
 *   `check`   which of the away-team's competences it tests — the same
 *             CHECK_TYPES the mission engine has always used.
 *   `hazard`  how badly it can go, straight into HAZARD_LEVEL. A vent can
 *             kill somebody; a seam of duranium cannot.
 *   `yield`   what the ship gets out of it, in the materials the fabricator
 *             already consumes. Beaming down is now how you restock.
 *
 * They are placed as STATIONS rather than props, because a station is already
 * the thing the walker finds, the reticle names and the use-key opens. A
 * parallel list of "features" would have to be taught to all three separately.
 */
const FEATURES = {
  outcrop: {
    kind: 'outcrop', label: 'A mineral outcrop', panel: 'survey',
    check: 'science', hazard: 'routine',
    yield: { duranium: 14 },
    found: 'A seam of structural ore, close enough to the surface to cut out by hand.',
    failed: 'The seam pinches out a metre in. Not worth the transporter power.',
  },
  ruin: {
    kind: 'ruin', label: 'A standing ruin', panel: 'survey',
    check: 'science', hazard: 'elevated',
    yield: { isolinear: 12, salvage: 6 },
    found: 'Cut stone, and something optical still threaded through it. Somebody was here first.',
    failed: 'Weathered past reading. Whatever it said, it is not saying it now.',
  },
  wreck: {
    kind: 'wreck', label: 'A crashed hull', panel: 'survey',
    check: 'engineering', hazard: 'dangerous',
    yield: { salvage: 18, duranium: 8, isolinear: 6 },
    found: 'Her power cells are still live. Enough salvage to matter, and a registry to log.',
    failed: 'The frame shifts as soon as it is touched. Nothing comes out of this one safely.',
  },
  vent: {
    kind: 'vent', label: 'A thermal vent', panel: 'survey',
    check: 'engineering', hazard: 'dangerous',
    yield: { deuterium: 26 },
    found: 'Hydrogen, hot and coming up fast. Tap it and the tanks come back full.',
    failed: 'It surges before the intake is set. The party comes back without it.',
  },
  flora: {
    kind: 'flora', label: 'Something growing', panel: 'survey',
    check: 'medical', hazard: 'routine',
    yield: { salvage: 9 },
    found: 'Alive, and nothing like anything in the catalogue. That is a paper on its own.',
    failed: 'It closes as soon as it is touched, and nothing usable comes back up.',
  },
};

/** Which features a world type can have, and how many. */
const FEATURE_POOLS = {
  planet: { pool: ['flora', 'flora', 'ruin', 'outcrop', 'wreck'], count: [3, 5] },
  desert: { pool: ['outcrop', 'outcrop', 'ruin', 'wreck', 'vent'], count: [3, 4] },
  ice: { pool: ['outcrop', 'vent', 'wreck'], count: [2, 4] },
  // No air, no weather, nothing to erode anything: a moon keeps what lands on
  // it. Fewer features, and the ones there are skew to what fell out of the sky.
  moon: { pool: ['outcrop', 'wreck', 'outcrop'], count: [2, 3] },
  gas: { pool: [], count: [0, 0] },
};

export const FEATURE_KINDS = Object.keys(FEATURES);

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

  // The things worth walking over to. Placed after the boulders and on their
  // own ring of arcs, so a feature is never buried inside a rock and never
  // dropped on the beam-in point.
  const spec = FEATURE_POOLS[body.kind] ?? FEATURE_POOLS.planet;
  const [lo, hi] = spec.count;
  const featureCount = spec.pool.length
    ? lo + Math.floor(rnd() * (hi - lo + 1))
    : 0;
  const fArc = (Math.PI * 2) / Math.max(1, featureCount);
  const stations = Array.from({ length: featureCount }, (_, i) => {
    const template = FEATURES[spec.pool[Math.floor(rnd() * spec.pool.length)]];
    const a = i * fArc + rnd() * fArc * 0.8;
    // Well outside the pad and inside the walkable radius, so every one of them
    // is a walk rather than a step, and none of them is out on the ridge where
    // the walker cannot reach it.
    const d = 5.5 + rnd() * (SURFACE_RADIUS - 8);
    const tone = 0.9 + rnd() * 0.24;
    return {
      ...template,
      id: `feature${i}`,
      at: [Math.sin(a) * d, Math.cos(a) * d],
      facing: rnd() * Math.PI * 2,
      // Two radii, because a thing you walk up to has two sizes.
      //
      // `drawRadius` is how big it is. `radius` is how close collision lets you
      // get, and it is deliberately much larger: a console is a flat panel and
      // you stand at it, but a two-metre plant with a crown wider than your
      // shoulders is something you stand BACK from, and being held at its own
      // size put the away team's face in the leaves. On screen that was a flat
      // green wall filling a third of the frame with no top and no bottom, on a
      // world the captain had just beamed down to.
      //
      // Reach is measured to the surface, not the centre, so standing further
      // out does not put anything out of arm's reach.
      drawRadius: 0.9 + rnd() * 0.5,
      radius: 2.2 + rnd() * 0.7,
      // Free-standing: you walk around it to get at it, which is what makes it
      // a place rather than a button that happens to have a mesh.
      solid: true,
      crew: null,
      mounted: 'floor',
      color: template.kind === 'flora'
        ? [look.ground[0] * 0.7 + 0.10, look.ground[1] * 0.9 + 0.24, look.ground[2] * 0.7 + 0.08]
        : [look.rock[0] * tone, look.rock[1] * tone, look.rock[2] * tone],
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
    stations,
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
