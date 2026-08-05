// Everything in the tactical volume that is not a ship.
//
// The starfield, the local star and planets, the LCARS reference grid, weapon
// traces, torpedoes, impacts and shield shells. All of it is generated
// geometry, all of it is flat-shaded, and all of it is built once and reused —
// there is nothing to load here either.
//
// The grid deserves a note. Nothing in space tells you where anything is
// relative to anything else, and a 3D tactical display without a reference
// plane is unreadable: two ships at the same screen position may be a hundred
// units apart or three thousand. The grid, and the vertical drop lines from
// each hull down to it, are what make the third axis legible rather than
// decorative.

import { vec3 } from './math.js';
import { MeshBuilder, sphere, box, tube } from './mesh.js';

/** The tactical volume is a cube this many units on a side. */
export const VOLUME = 3000;

const cache = new Map();
const memo = (key, build) => {
  if (!cache.has(key)) cache.set(key, build().build());
  return cache.get(key);
};

/**
 * The starfield: a shell of small quads far enough out to read as fixed.
 *
 * Deterministic from a fixed integer hash rather than Math.random, so the sky
 * is the same on every launch and in every screenshot. The simulation's own RNG
 * is not used — the stars are cosmetic and must not consume draws from the
 * stream the save file depends on.
 */
export function starfield(count = 260) {
  return memo(`stars:${count}`, () => {
    const mb = new MeshBuilder();
    let h = 0x9e3779b9;
    const rnd = () => {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h |= 0;
      return (h >>> 0) / 4294967296;
    };
    const R = VOLUME * 4;
    for (let i = 0; i < count; i++) {
      // Even-ish distribution on a sphere.
      const u = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const c = vec3(Math.cos(a) * r * R, u * R, Math.sin(a) * r * R);
      const size = R * (0.0016 + rnd() * 0.0032);
      const warm = rnd();
      const col = [0.7 + warm * 0.3, 0.72 + warm * 0.2, 0.9 - warm * 0.25];

      // ONE QUAD, facing the centre of the shell — which is a perfect billboard
      // without any billboarding, because the shell is drawn centred on the eye
      // and the eye is therefore always exactly at the middle of it. The camera
      // turns; it never leaves the centre.
      //
      // This used to be a cube: twelve triangles apiece so that some face was
      // always presented, which is a problem a quad aimed at the viewer does not
      // have. 260 stars went from 3,120 triangles to 520, and it is that saving
      // that pays for a world in orbit being a real sphere.
      const n = vec3(-c[0] / R, -c[1] / R, -c[2] / R);
      // Any direction not parallel to the normal seeds the basis; the cross
      // products do the rest. |n·y| is at most 1, so the fallback is only for
      // the two stars that happen to sit at the poles.
      const t = Math.abs(n[1]) > 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0);
      const ux = t[1] * n[2] - t[2] * n[1];
      const uy = t[2] * n[0] - t[0] * n[2];
      const uz = t[0] * n[1] - t[1] * n[0];
      const ul = Math.hypot(ux, uy, uz) || 1;
      const u1 = vec3(ux / ul * size, uy / ul * size, uz / ul * size);
      // v = n × u, which makes u × v = n: the face looks at the centre.
      const v1 = vec3(
        (n[1] * u1[2] - n[2] * u1[1]),
        (n[2] * u1[0] - n[0] * u1[2]),
        (n[0] * u1[1] - n[1] * u1[0]),
      );
      mb.quad(
        vec3(c[0] - u1[0] - v1[0], c[1] - u1[1] - v1[1], c[2] - u1[2] - v1[2]),
        vec3(c[0] + u1[0] - v1[0], c[1] + u1[1] - v1[1], c[2] + u1[2] - v1[2]),
        vec3(c[0] + u1[0] + v1[0], c[1] + u1[1] + v1[1], c[2] + u1[2] + v1[2]),
        vec3(c[0] - u1[0] + v1[0], c[1] - u1[1] + v1[1], c[2] - u1[2] + v1[2]),
        col,
      );
    }
    return mb;
  });
}

/**
 * The view at warp: stars drawn out into streaks.
 *
 * The single most recognisable thing a viewscreen ever showed, and it is not a
 * particle system — it is the SAME stars, elongated along the direction of
 * travel. So the geometry is a tube of long thin boxes lying parallel to the
 * ship's course, spread through a cylinder around it, and the illusion of speed
 * comes from sliding the whole thing past the camera and wrapping it.
 *
 * Built in a local frame where the course runs along +z and the camera sits at
 * the origin looking down it. The caller orients and cycles it.
 *
 * `LENGTH` is the wrap period: translate by anything and take it modulo this,
 * and the field is seamless because every streak has an identical twin one
 * period away. That is why the count is doubled below rather than the mesh
 * being drawn twice — one buffer, one draw call, no seam.
 */
export const WARP_LENGTH = 2400;

export function warpfield(count = 230) {
  return memo(`warp:${count}`, () => {
    const mb = new MeshBuilder();
    let h = 0x2545f491;
    const rnd = () => {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h |= 0;
      return (h >>> 0) / 4294967296;
    };

    for (let i = 0; i < count; i++) {
      // Spread across an annulus: nothing dead ahead, because a streak coming
      // straight at the camera is a dot and reads as a dead pixel.
      const a = rnd() * Math.PI * 2;
      const r = 90 + rnd() * 900;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * 0.72;   // flattened, so it reads as a course
      const z = rnd() * WARP_LENGTH;

      // Longer and brighter nearer the axis, which is what perspective does to
      // a real streak and what makes the middle of the screen feel fast.
      const near = 1 - Math.min(1, r / 1000);
      const len = 130 + near * 560 + rnd() * 160;
      const w = 1.8 + near * 3.0;
      const warm = rnd();
      const c = [0.80 + warm * 0.20, 0.84 + warm * 0.14, 1.0 - warm * 0.18];

      // TWO CROSSED QUADS, not a box. A streak is a glowing line: there is no
      // side of it you are ever meant to see shaded, so the eight faces of a
      // box are six wasted. Four triangles instead of twelve, which is the
      // difference between fitting in the frame budget and not — the box
      // version came to 5,280 triangles against a budget of 8,000 for the whole
      // scene, ships included.
      for (const dz of [0, WARP_LENGTH]) {
        const z0 = z + dz;
        const z1 = z0 + len;
        // Vertical blade.
        mb.quad(
          vec3(x, y - w, z0), vec3(x, y - w, z1), vec3(x, y + w, z1), vec3(x, y + w, z0), c,
        );
        // Horizontal blade, so it holds up from any angle without billboarding.
        mb.quad(
          vec3(x - w, y, z0), vec3(x + w, y, z0), vec3(x + w, y, z1), vec3(x - w, y, z1), c,
        );
      }
    }
    return mb;
  });
}

/** A star or planet. `kind` picks the palette; `seed` varies the banding. */
export function bodyMesh(kind = 'planet', seed = 0) {
  return memo(`body:${kind}:${seed & 7}`, () => {
    const mb = new MeshBuilder();
    const palettes = {
      star: [1.0, 0.86, 0.5],
      planet: [0.34, 0.48, 0.66],
      desert: [0.7, 0.56, 0.36],
      ice: [0.74, 0.84, 0.92],
      gas: [0.66, 0.56, 0.42],
      moon: [0.5, 0.5, 0.52],
    };
    sphere(mb, {
      radius: 1,
      segments: 20,
      rings: 12,
      color: palettes[kind] ?? palettes.planet,
      banding: kind === 'star' ? 0 : 0.35,
    });
    return mb;
  });
}

// ------------------------------------------------------------------ orbit
//
// A world seen from standard orbit is a different object from a world seen on
// approach, and it needs a different mesh: `bodyMesh` above is a 20-segment ball
// that reads fine as a marble four thousand units away and reads as a polyhedron
// from orbit. This is the same shape at the resolution the near view needs, with
// a surface on it.
//
// The altitude decides everything about the mesh, and RESEARCH §10 has the
// arithmetic. Standard orbit is a band, and the two ends of it are different
// pictures. Down at 1,600 km the disc subtends 106° — wider than the viewer, so
// there is no planet in frame, only ground and a horizon. Up at 11,300 km it
// subtends 42°, which is the shot: a whole world across the lower half of the
// screen with the terminator on it and stars above.
//
// The build takes the top of the band, for a reason that is not aesthetic. From
// low orbit the only geometry worth drawing is the near cap — everything past
// the horizon is invisible — and a cap has to be locked to the ship to stay
// under it, which means the ground under you never changes as you travel. From
// the top of the band the whole globe is in frame, so it can be locked to the
// PLANET and turn on the planet's own axis, and the world moves because it is
// actually moving.

/**
 * Deterministic 3D value noise. Lattice hash, trilinear blend.
 *
 * Not a texture. A texture is a file, and this project has none — but the
 * reason to generate rather than load goes past that: the field is evaluated on
 * a sphere, in three dimensions, where a flat image has a seam at the
 * antimeridian and a pinch at each pole. There is nothing to wrap here.
 */
function latticeHash(x, y, z, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x85ebca6b)
    ^ Math.imul(z | 0, 0xc2b2ae35) ^ (seed | 0);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function valueNoise(x, y, z, seed) {
  const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
  const xf = x - xi; const yf = y - yi; const zf = z - zi;
  // Smoothstep on each axis, so the field has no lattice-aligned creases.
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => latticeHash(xi + dx, yi + dy, zi + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

/** Four octaves, halving amplitude. Enough for coastlines that are not circles. */
function terrain(x, y, z, seed, freq = 2.4) {
  let sum = 0; let amp = 1; let norm = 0; let f = freq;
  for (let o = 0; o < 4; o++) {
    sum += valueNoise(x * f, y * f, z * f, seed + o * 7919) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.07;   // not exactly 2, so octaves never line up on the lattice
  }
  return sum / norm;
}

// Ocean, lowland, highland, peak — sampled by elevation. Every kind gets four
// so the same lookup serves all of them, and a world is never one flat colour.
const SURFACE = {
  planet: [[0.09, 0.20, 0.42], [0.13, 0.31, 0.55], [0.26, 0.42, 0.24], [0.55, 0.52, 0.44]],
  desert: [[0.46, 0.31, 0.18], [0.66, 0.48, 0.26], [0.80, 0.64, 0.38], [0.88, 0.78, 0.58]],
  ice: [[0.42, 0.56, 0.68], [0.66, 0.78, 0.88], [0.84, 0.90, 0.95], [0.95, 0.97, 1.00]],
  moon: [[0.24, 0.24, 0.26], [0.38, 0.37, 0.38], [0.52, 0.51, 0.50], [0.66, 0.65, 0.63]],
  gas: [[0.42, 0.33, 0.24], [0.62, 0.50, 0.34], [0.78, 0.68, 0.50], [0.88, 0.83, 0.72]],
  star: [[1.0, 0.72, 0.30], [1.0, 0.82, 0.42], [1.0, 0.90, 0.58], [1.0, 0.96, 0.78]],
};

/** Ice at the poles, cloud on top, banding on a gas giant. */
function surfaceColor(kind, nx, ny, nz, seed) {
  const bands = SURFACE[kind] ?? SURFACE.planet;
  // A gas giant has no surface to have relief: its colour is latitude, pushed
  // sideways by turbulence, which is what makes the bands wander instead of
  // being stripes.
  const e = kind === 'gas'
    ? (Math.sin(ny * 11 + terrain(nx, ny, nz, seed, 1.6) * 3.4) * 0.5 + 0.5)
    : terrain(nx, ny, nz, seed);

  const i = e < 0.46 ? 0 : e < 0.54 ? 1 : e < 0.72 ? 2 : 3;
  const c = bands[i];
  let r = c[0]; let g = c[1]; let b = c[2];

  // Ice toward the poles, and the edge of the cap is ragged rather than a
  // circle drawn on the globe.
  if (kind !== 'gas' && kind !== 'star') {
    const lat = Math.abs(ny);
    const edge = 0.68 + terrain(nx, ny, nz, seed + 4001, 5.5) * 0.22;
    if (lat > edge) {
      const t = Math.min(1, (lat - edge) / 0.2);
      r += (0.94 - r) * t; g += (0.96 - g) * t; b += (0.99 - b) * t;
    }
  }

  // Weather. A separate, coarser field at a different seed, thresholded high so
  // it is broken cloud and not overcast — an unbroken white world reads as an
  // ice world, which is a different thing the palette above already does.
  if (kind === 'planet' || kind === 'gas') {
    const cloud = terrain(nx, ny, nz, seed + 9173, 3.1);
    if (cloud > 0.56) {
      const t = Math.min(1, (cloud - 0.56) / 0.26) * 0.85;
      r += (0.92 - r) * t; g += (0.94 - g) * t; b += (0.96 - b) * t;
    }
  }
  return [r, g, b];
}

/**
 * A world at the resolution orbit needs, with a surface on it.
 *
 * Unit radius, centred at the origin, +y is the pole — so the caller puts it at
 * the body's position, scales it by the body's radius, and spins it about its
 * own axis for the time of day. Colour is per quad from the noise field above.
 *
 * Nothing is displaced. Real relief is about a thousandth of a planetary radius
 * — Everest against the Earth — and would be a fraction of a pixel from orbit.
 * Mountains you could see from up here would be forty kilometres tall, which is
 * inventing physics to decorate a picture.
 */
export function worldMesh(kind = 'planet', seed = 0) {
  return memo(`world:${kind}:${seed & 7}`, () => {
    const mb = new MeshBuilder();
    // 56 around and 28 down puts a facet at about 6.4°, which at the 21° disc
    // this is seen as works out to roughly two degrees of frame per edge — the
    // point where the silhouette stops reading as a polygon.
    const SEG = 56;
    const RINGS = 28;
    const s = (seed & 7) * 1013 + 17;

    for (let ring = 0; ring < RINGS; ring++) {
      const a0 = (ring / RINGS) * Math.PI;
      const a1 = ((ring + 1) / RINGS) * Math.PI;
      const r0 = Math.sin(a0); const y0 = Math.cos(a0);
      const r1 = Math.sin(a1); const y1 = Math.cos(a1);
      for (let i = 0; i < SEG; i++) {
        const t0 = (i / SEG) * Math.PI * 2;
        const t1 = ((i + 1) / SEG) * Math.PI * 2;
        const c0 = Math.cos(t0); const s0 = Math.sin(t0);
        const c1 = Math.cos(t1); const s1 = Math.sin(t1);
        const inner0 = vec3(c0 * r0, y0, s0 * r0);
        const inner1 = vec3(c1 * r0, y0, s1 * r0);
        const outer1 = vec3(c1 * r1, y1, s1 * r1);
        const outer0 = vec3(c0 * r1, y1, s0 * r1);
        // Centroid of the patch, normalised, is where the field is sampled.
        const mx = (inner0[0] + outer1[0]) * 0.5;
        const my = (inner0[1] + outer1[1]) * 0.5;
        const mz = (inner0[2] + outer1[2]) * 0.5;
        const len = Math.hypot(mx, my, mz) || 1;
        const color = surfaceColor(kind, mx / len, my / len, mz / len, s);
        // Wound so the face points AWAY from the centre — round the ring first
        // and outward second. Culling is on: get this backwards and the planet
        // is not dark, it is absent.
        if (ring === 0) {
          mb.tri(vec3(0, 1, 0), outer1, outer0, color);
        } else if (ring === RINGS - 1) {
          mb.tri(vec3(0, -1, 0), inner0, inner1, color);
        } else {
          mb.quad(inner0, inner1, outer1, outer0, color);
        }
      }
    }
    return mb;
  });
}

/**
 * The limb: the bright rim of atmosphere around a world's edge.
 *
 * An atmosphere is only ever SEEN from orbit at the edge of the disc, because
 * that is the one line of sight that runs lengthwise through hundreds of
 * kilometres of it rather than straight down through ten. Overhead there is
 * nothing to see; at the limb it is a bright band. So this is a rim and not a
 * shell over the world.
 *
 * It is a flat annulus in the plane through the planet's centre, square to the
 * camera — the caller turns it. Which makes the inner edge take care of itself:
 * an annulus in that plane is exactly as far away as the centre of the world,
 * the near surface is closer, and the depth buffer therefore hides every part of
 * the ring that falls inside the silhouette. Nothing has to work out where the
 * silhouette is, at any distance or angle. The sphere masks its own halo.
 *
 * Built in the xz plane facing +y, which is the convention `quatFromTo` wants.
 */
export function limbMesh(kind = 'planet') {
  return memo(`limb:${kind}`, () => {
    const mb = new MeshBuilder();
    const SEG = 56;
    const BANDS = 3;
    // Blue for a world with air. A moon has none, so it gets a dim grey line
    // and nothing that glows — the absence is the point.
    const air = kind === 'moon' ? [0.34, 0.34, 0.36]
      : kind === 'ice' ? [0.66, 0.80, 0.92]
        : kind === 'desert' ? [0.86, 0.70, 0.50]
          : kind === 'gas' ? [0.80, 0.72, 0.56] : [0.40, 0.62, 1.00];
    // Starts inside the silhouette, so the visible band begins already bright
    // rather than fading up from the edge of the world.
    const INNER = 0.93;
    const OUTER = 1.19;

    for (let band = 0; band < BANDS; band++) {
      const f0 = band / BANDS;
      const f1 = (band + 1) / BANDS;
      const r0 = INNER + (OUTER - INNER) * f0;
      const r1 = INNER + (OUTER - INNER) * f1;
      // Squared falloff outward: air thins with height and the glow has to go
      // to nothing before the outer edge, or the ring ends in a visible line.
      const fade = (1 - (f0 + f1) * 0.5) ** 2;
      const c = [air[0] * fade, air[1] * fade, air[2] * fade];
      for (let i = 0; i < SEG; i++) {
        const t0 = (i / SEG) * Math.PI * 2;
        const t1 = ((i + 1) / SEG) * Math.PI * 2;
        // Round the ring, then outward — which is what puts the face on +y.
        mb.quad(
          vec3(Math.cos(t0) * r0, 0, Math.sin(t0) * r0),
          vec3(Math.cos(t1) * r0, 0, Math.sin(t1) * r0),
          vec3(Math.cos(t1) * r1, 0, Math.sin(t1) * r1),
          vec3(Math.cos(t0) * r1, 0, Math.sin(t0) * r1),
          c,
        );
      }
    }
    return mb;
  });
}

/**
 * The reference grid: a plane of lines at y = 0, drawn as very thin boxes so it
 * goes through the same shader as everything else.
 */
export function gridMesh(divisions = 12) {
  return memo(`grid:${divisions}`, () => {
    const mb = new MeshBuilder();
    const half = VOLUME / 2;
    const step = VOLUME / divisions;
    const thin = VOLUME * 0.0012;
    for (let i = 0; i <= divisions; i++) {
      const p = -half + i * step;
      const axis = i === divisions / 2;
      const color = axis ? [0.36, 0.52, 0.72] : [0.16, 0.22, 0.34];
      box(mb, { center: vec3(p, 0, 0), size: vec3(thin, thin, VOLUME), color });
      box(mb, { center: vec3(0, 0, p), size: vec3(VOLUME, thin, thin), color });
    }
    return mb;
  });
}

/**
 * A unit-length beam along +x, scaled and oriented per shot.
 * One mesh serves every phaser in the game.
 */
export function beamMesh() {
  return memo('beam', () => {
    const mb = new MeshBuilder();
    tube(mb, {
      origin: vec3(0, 0, 0),
      length: 1,
      r0: 0.5,
      r1: 0.5,
      segments: 5,
      color: [1, 1, 1],
      capFore: false,
      capAft: false,
    });
    return mb;
  });
}

/** A torpedo: a small glowing lozenge. */
export function torpedoMesh() {
  return memo('torpedo', () => {
    const mb = new MeshBuilder();
    sphere(mb, { radius: 1, segments: 8, rings: 5, color: [1, 0.85, 0.55] });
    return mb;
  });
}

/**
 * The shield shell: a sphere drawn slightly larger than the hull, additively,
 * when a facing takes a hit. Faceted on purpose — a smooth shell reads as a
 * bubble, a faceted one reads as a field made of overlapping emitters.
 */
export function shieldMesh() {
  return memo('shield', () => {
    const mb = new MeshBuilder();
    sphere(mb, { radius: 1, segments: 14, rings: 9, color: [0.5, 0.78, 1] });
    return mb;
  });
}

/** An expanding debris burst. */
export function explosionMesh() {
  return memo('explosion', () => {
    const mb = new MeshBuilder();
    let h = 0x85ebca6b;
    const rnd = () => {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h |= 0;
      return (h >>> 0) / 4294967296;
    };
    for (let i = 0; i < 18; i++) {
      const u = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const d = 0.4 + rnd() * 0.6;
      box(mb, {
        center: vec3(Math.cos(a) * r * d, u * d, Math.sin(a) * r * d),
        size: vec3(0.16, 0.16, 0.16),
        color: i % 3 === 0 ? [1, 0.9, 0.6] : [1, 0.55, 0.2],
      });
    }
    return mb;
  });
}

/** A vertical line from a hull down to the grid plane, so altitude is readable. */
export function dropLineMesh() {
  return memo('dropline', () => {
    const mb = new MeshBuilder();
    box(mb, {
      center: vec3(0, 0.5, 0),
      size: vec3(0.02, 1, 0.02),
      color: [0.35, 0.5, 0.7],
    });
    return mb;
  });
}

/** Every mesh the scene can draw, for the harness and the triangle budget. */
export function sceneMeshes() {
  return {
    starfield: starfield(),
    grid: gridMesh(),
    beam: beamMesh(),
    torpedo: torpedoMesh(),
    shield: shieldMesh(),
    explosion: explosionMesh(),
    dropLine: dropLineMesh(),
    planet: bodyMesh('planet'),
    star: bodyMesh('star'),
  };
}
