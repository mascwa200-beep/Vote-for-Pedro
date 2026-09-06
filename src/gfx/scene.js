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

/**
 * A world in the sky. `kind` picks the palette; `seed` picks which world.
 *
 * The same globe the orbital view uses, sampled coarsely — see `globe` below.
 * It was twelve latitude stripes of flat colour until the field that was
 * already here was pointed at it; the triangle count is unchanged at 440, which
 * is what keeps four of them inside the scenery budget.
 *
 * `seed` was hardcoded to 0 at both call sites, so every planet of a kind was
 * the same planet in every system. It is real now — and note that the DRAW KEY
 * has to carry it too: `Renderer.upload` caches the GPU buffer by key alone and
 * ignores the mesh it is handed, so two seeds under one key would silently
 * share one buffer and draw as twins.
 */
export function bodyMesh(kind = 'planet', seed = 0) {
  return memo(`body:${kind}:${seed & 7}`, () => globe(kind, seed, 20, 12, true));
}

/**
 * A tumbling piece of rock or hull, for a debris field.
 *
 * A sphere is what the SIMULATION uses — `blockedBy` in sim/arena.js tests a
 * segment against a sphere, and it has to, because a per-triangle test on
 * sixteen rocks for every shot of every tick is not a phone budget. So the
 * drawn shape has to READ as the sphere it is: lumpy enough not to be a
 * billiard ball, and nowhere far enough off the sphere for a shot to look
 * like it should have got past.
 *
 * The displacement is on the RINGS, not per vertex. Flat shading means every
 * triangle already has its own three vertices, so moving them individually
 * tears the surface into confetti; moving whole latitude bands keeps it a
 * closed solid and still kills the silhouette of a ball.
 *
 * `seed` picks one of eight shapes, so a field is not sixteen copies of one
 * rock, and the memo means eight meshes are built for the life of the process.
 */
export function rockMesh(seed = 0) {
  return memo(`rock:${seed & 7}`, () => {
    const mb = new MeshBuilder();
    const rings = 9;
    const segs = 14;
    const n = (i) => 0.78 + 0.44 * ((Math.imul(i + 1, 0x9e3779b1) ^ (seed * 2654435761)) >>> 8 & 255) / 255;
    const at = (ring, seg) => {
      const t = (ring / rings) * Math.PI;
      const a = (seg / segs) * Math.PI * 2;
      // Two bands blended, so a rock is squashed on one axis as well as lumpy.
      const rad = n(ring) * (0.82 + 0.24 * n(seg % 5 + 40));
      return vec3(
        Math.sin(t) * Math.cos(a) * rad,
        Math.cos(t) * rad,
        Math.sin(t) * Math.sin(a) * rad,
      );
    };
    const base = [0.40, 0.38, 0.36];
    for (let ring = 0; ring < rings; ring++) {
      const shade = 0.82 + 0.3 * n(ring + 17);
      const c = [base[0] * shade, base[1] * shade, base[2] * shade];
      for (let seg = 0; seg < segs; seg++) {
        const A = at(ring, seg); const B = at(ring, seg + 1);
        const C = at(ring + 1, seg + 1); const D = at(ring + 1, seg);
        if (ring === 0) mb.tri(A, C, D, c);
        else if (ring === rings - 1) mb.tri(A, B, C, c);
        else mb.quad(A, B, C, D, c);
      }
    }
    return mb;
  });
}

/**
 * The shell of a gas cloud, drawn from the inside as well as the outside.
 *
 * A nebula in this game is a sphere two and a half thousand units across with
 * the whole battle inside it, so the one thing it must not be is a solid ball
 * hiding the fight. It is drawn at very low alpha with BOTH windings present —
 * the same shell twice, once facing out and once facing in — because back-face
 * culling would otherwise make a cloud you are standing in disappear
 * completely, which is the exact moment the player most needs to be told they
 * are in one.
 */
export function cloudMesh() {
  return memo('cloud', () => {
    const mb = new MeshBuilder();
    const rings = 10;
    const segs = 16;
    // A SMOOTH shell, deliberately.
    //
    // The first version wobbled the radius per face to keep the horizon from
    // being a perfect circle, and rendered as a heap of glass shards: every
    // face is the same emissive colour, so what the eye reads is how many
    // layers a view ray crosses, and an irregular shell makes that vary
    // face-to-face in hard-edged triangles. A round shell crossed twice at
    // every angle reads as a ball of gas — thicker at the rim, where the ray
    // travels further through it, which is what gas actually does.
    const at = (ring, seg) => {
      const t = (ring / rings) * Math.PI;
      const a = (seg / segs) * Math.PI * 2;
      return vec3(Math.sin(t) * Math.cos(a), Math.cos(t), Math.sin(t) * Math.sin(a));
    };
    for (let ring = 0; ring < rings; ring++) {
      for (let seg = 0; seg < segs; seg++) {
        const A = at(ring, seg); const B = at(ring, seg + 1);
        const C = at(ring + 1, seg + 1); const D = at(ring + 1, seg);
        mb.quad(A, B, C, D, [1, 1, 1], 1);
        mb.quad(A, D, C, B, [1, 1, 1], 1);   // and the inside face
      }
    }
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

/**
 * Four octaves, halving amplitude. Enough for coastlines that are not circles.
 *
 * The octave count is a parameter because the same field is now sampled at two
 * resolutions. Detail finer than one facet is not detail, it is noise — see
 * `COARSE` below.
 */
function terrain(x, y, z, seed, freq = 2.4, octaves = 4) {
  let sum = 0; let amp = 1; let norm = 0; let f = freq;
  for (let o = 0; o < octaves; o++) {
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

/**
 * How much to slow the field down when the facets are big.
 *
 * The frequencies below were chosen for a globe seen from orbit at 56 by 28,
 * where a facet is about 6.4°. A world in the sky is drawn at 20 by 12, where a
 * facet covers nearly three times as much of the sphere — and a feature smaller
 * than a facet is not a feature, it is a facet with an arbitrary colour.
 *
 * Measured, by counting how often two laterally adjacent facets land in
 * different elevation bands:
 *
 *   orbit globe 56x28, freq 2.4, 4 octaves    26.4%   <- the look to match
 *   sky body   20x12, freq 2.4, 4 octaves     53.3%   <- confetti
 *   sky body   20x12, scaled by 0.42, 2 oct   24.6%   <- coastlines again
 *
 * So this is not a taste constant: it is the factor that makes a distant world
 * as coherent as the one you are in orbit around, and the test asserts the two
 * against each other rather than against either number.
 */
const COARSE = 0.42;

/** Ice at the poles, cloud on top, banding on a gas giant. */
function surfaceColor(kind, nx, ny, nz, seed, coarse = false) {
  const bands = SURFACE[kind] ?? SURFACE.planet;
  // Every frequency scales together, so a coarse world is the same world seen
  // with less detail rather than a differently-shaped one.
  const k = coarse ? COARSE : 1;
  const oct = coarse ? 2 : 4;
  // A gas giant has no surface to have relief: its colour is latitude, pushed
  // sideways by turbulence, which is what makes the bands wander instead of
  // being stripes.
  const e = kind === 'gas'
    ? (Math.sin(ny * 11 + terrain(nx, ny, nz, seed, 1.6 * k, oct) * 3.4) * 0.5 + 0.5)
    : terrain(nx, ny, nz, seed, 2.4 * k, oct);

  const i = e < 0.46 ? 0 : e < 0.54 ? 1 : e < 0.72 ? 2 : 3;
  const c = bands[i];
  let r = c[0]; let g = c[1]; let b = c[2];

  // Ice toward the poles, and the edge of the cap is ragged rather than a
  // circle drawn on the globe.
  if (kind !== 'gas' && kind !== 'star') {
    const lat = Math.abs(ny);
    const edge = 0.68 + terrain(nx, ny, nz, seed + 4001, 5.5 * k, oct) * 0.22;
    if (lat > edge) {
      const t = Math.min(1, (lat - edge) / 0.2);
      r += (0.94 - r) * t; g += (0.96 - g) * t; b += (0.99 - b) * t;
    }
  }

  // Weather. A separate, coarser field at a different seed, thresholded high so
  // it is broken cloud and not overcast — an unbroken white world reads as an
  // ice world, which is a different thing the palette above already does.
  if (kind === 'planet' || kind === 'gas') {
    const cloud = terrain(nx, ny, nz, seed + 9173, 3.1 * k, oct);
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
  // 56 around and 28 down puts a facet at about 6.4°, which at the 21° disc
  // this is seen as works out to roughly two degrees of frame per edge — the
  // point where the silhouette stops reading as a polygon.
  return memo(`world:${kind}:${seed & 7}`, () => globe(kind, seed, 56, 28, false));
}

/**
 * One globe, at whichever resolution the distance deserves.
 *
 * This loop used to exist once, inside `worldMesh`, and served only the world
 * you are in orbit around. The worlds in the SKY were a different thing
 * entirely: `sphere(..., banding: 0.35)`, where `banding` is a single per-ring
 * hash multiplier — twelve horizontal stripes of flat colour, standing in for
 * "a texture, which this renderer has no way to load", as its own comment put
 * it. The renderer could not load one and did not need to: the field that makes
 * the orbital globe a world is a pure function of a unit normal and costs
 * nothing to sample at any resolution.
 *
 * So there is one builder now and two callers, and the only thing that differs
 * between a world overhead and a world across the system is how finely each is
 * sampled — which is what `coarse` is for. Same field, same palettes, same
 * winding, same triangle count as the stripes it replaces.
 */
function globe(kind, seed, SEG, RINGS, coarse) {
  {
    const mb = new MeshBuilder();
    const s = (seed & 7) * 1013 + 17;
    // A star has no surface to have a surface. It is drawn emissive, so a noise
    // field on it would be mottling on a light source rather than terrain, and
    // at this distance a primary is a featureless disc. Its palette's brightest
    // band, flat, is what it was before and what it stays.
    const flat = kind === 'star' ? SURFACE.star[3] : null;

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
        const color = flat ?? surfaceColor(kind, mx / len, my / len, mz / len, s, coarse);
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
  }
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

/**
 * The wedge a gun mount covers, in the ship's own plane.
 *
 * A FLAT wedge, not a solid cone, for the reason tactical3d.js already records
 * about the shield shell: a large bright volume dominates the frame and hides
 * the ship it belongs to. A 250-degree phaser bank drawn as a solid cone is
 * that failure several times over — it would swallow the hull, the target and
 * most of the arena. On the ground plane it says where the guns bear and
 * occludes nothing.
 *
 * Built out to unit radius so the caller scales it to the mount's real range,
 * and memoised on a ten-degree bucket so the thirty-one classes in the game
 * collapse to a handful of meshes rather than one per mount.
 *
 * The honest limit, stated because the plan view has the same one: a wedge in
 * the plane does not show the cone's ELEVATION restriction. A target far above
 * the plane can sit inside the drawn wedge and outside the real arc, which
 * `inArc` tests in three dimensions.
 */
export function arcMesh(degrees = 90) {
  const deg = Math.max(10, Math.min(360, Math.round(degrees / 10) * 10));
  return memo(`arc:${deg}`, () => {
    const mb = new MeshBuilder();
    const half = (deg / 2) * (Math.PI / 180);
    const steps = Math.max(3, Math.round(deg / 5));
    const color = [0.45, 0.72, 1.0];
    // A BAND at the range limit and two rays down its edges — not a filled
    // pie. The first cut was a filled slice at low alpha, and on a
    // Constitution, whose banks cover 250 and 200 degrees, the two of them
    // overlapped into a faint disc round the hull: it read as fog, not as
    // arcs, and said nothing about where the guns pointed. An outline is what
    // makes an arc an arc, and it leaves the middle of the board clear.
    const R0 = 0.88;
    const RAY = 0.012;
    // BOTH windings for every triangle. The renderer culls back faces
    // (gl.js enables CULL_FACE), and a flat wedge lying in the ship's plane
    // has exactly one visible side — so a single winding drew nothing at all
    // from half the camera positions, and nothing from ANY of them if the
    // winding was the wrong way round. It was the wrong way round, which is
    // why the first two attempts at this rendered an empty frame. A captain
    // can orbit under their own ship, so the arc has to exist from below too.
    const face = (a, b, c) => { mb.tri(a, b, c, color); mb.tri(c, b, a, color); };
    for (let i = 0; i < steps; i++) {
      const a0 = -half + (i / steps) * half * 2;
      const a1 = -half + ((i + 1) / steps) * half * 2;
      const p = (a, r) => vec3(Math.cos(a) * r, 0, Math.sin(a) * r);
      face(p(a0, R0), p(a1, 1), p(a0, 1));
      face(p(a0, R0), p(a1, R0), p(a1, 1));
    }
    // The two bounding rays, as slim quads from the hull to the range limit,
    // which is the line a captain actually steers to put a target inside.
    for (const edge of [-half, half]) {
      const n = edge + Math.PI / 2;
      const ox = Math.cos(n) * RAY;
      const oz = Math.sin(n) * RAY;
      const ex = Math.cos(edge);
      const ez = Math.sin(edge);
      face(vec3(-ox, 0, -oz), vec3(ex - ox, 0, ez - oz), vec3(ex + ox, 0, ez + oz));
      face(vec3(-ox, 0, -oz), vec3(ex + ox, 0, ez + oz), vec3(ox, 0, oz));
    }
    return mb;
  });
}

/** Every mesh the scene can draw, for the harness and the triangle budget. */
export function sceneMeshes() {
  return {
    // Two buckets stand in for the family: the narrowest arc any mount carries
    // and the widest. Missing from here, the triangle budget would be measured
    // against a scene that does not include the arcs at all.
    arcNarrow: arcMesh(90),
    arcWide: arcMesh(250),
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
