// Procedural mesh construction.
//
// Everything visible in the tactical view is generated here from a handful of
// parameters. There are no model files, for the same reason there are no audio
// files: this project ships no art it did not make, and a mesh that is a few
// numbers in a table costs nothing to precache.
//
// Flat shading throughout. Each triangle gets its own three vertices and the
// face normal, which triples the vertex count and is worth it — faceted hulls
// read as solid geometry at phone size in a way smooth shading does not, and it
// removes any need for normal averaging, smoothing groups or UVs.
//
// Coordinate convention, matching the simulation: +x is the bow, +y is dorsal,
// +z is starboard.

import { vec3, sub, cross, normalize } from './math.js';

/** Accumulates triangles and hands back typed arrays. */
export class MeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
  }

  /** One triangle, wound counter-clockwise when seen from outside. */
  tri(a, b, c, color) {
    const n = normalize(cross(sub(b, a), sub(c, a)));
    for (const v of [a, b, c]) {
      this.positions.push(v[0], v[1], v[2]);
      this.normals.push(n[0], n[1], n[2]);
      this.colors.push(color[0], color[1], color[2]);
    }
    return this;
  }

  /** A quad, as two triangles. */
  quad(a, b, c, d, color) {
    return this.tri(a, b, c, color).tri(a, c, d, color);
  }

  get triangleCount() { return this.positions.length / 9; }

  /** Interleaved position/normal/colour, ready for one buffer and one draw call. */
  build() {
    const count = this.positions.length / 3;
    const data = new Float32Array(count * 9);
    for (let i = 0; i < count; i++) {
      data[i * 9 + 0] = this.positions[i * 3 + 0];
      data[i * 9 + 1] = this.positions[i * 3 + 1];
      data[i * 9 + 2] = this.positions[i * 3 + 2];
      data[i * 9 + 3] = this.normals[i * 3 + 0];
      data[i * 9 + 4] = this.normals[i * 3 + 1];
      data[i * 9 + 5] = this.normals[i * 3 + 2];
      data[i * 9 + 6] = this.colors[i * 3 + 0];
      data[i * 9 + 7] = this.colors[i * 3 + 1];
      data[i * 9 + 8] = this.colors[i * 3 + 2];
    }
    return { data, vertexCount: count, stride: 9 * 4 };
  }
}

/**
 * How round a curved hull is allowed to be.
 *
 * Every segment count in this file used to be a hand-picked literal — 24 for a
 * saucer, 12 for a nacelle, 8 for a pylon — chosen when the target was a phone
 * that had to draw them in software. Measured against what the fleet actually
 * costs, those numbers were an order of magnitude too careful: thirty-one
 * classes averaged 249 triangles and a Galaxy-class was 380, which is why a
 * saucer read as a polygon and a nacelle as a prism.
 *
 * A whole engagement is at most a handful of hulls. At this factor the fleet
 * averages about 620 triangles a ship and the heaviest is under 2,000 — a
 * rounding error for any GPU made this decade, and the difference between a
 * silhouette that reads as a starship and one that reads as a wireframe.
 *
 * One number, because seventeen scattered literals is seventeen places to
 * forget. `seg` floors at 3 so no amount of scaling down can produce a face
 * with two sides.
 */
export const DETAIL = 2.5;

/** A segment count, scaled by DETAIL and never below a triangle. */
export const seg = (n) => Math.max(3, Math.round(n * DETAIL));

const at = (o, x, y, z) => vec3(o[0] + x, o[1] + y, o[2] + z);

/**
 * A saucer: two shallow cones meeting at a rim.
 *
 * This is the primitive that makes a ship read as Federation, so it gets the
 * most segments. `domeRatio` is how much of the radius the raised centre covers
 * — a Constitution's bridge dome is a small cap on a broad plate, which is what
 * separates its silhouette from a Miranda's flatter one.
 */
export function saucer(mb, {
  origin = vec3(), radius = 1, thickness = 0.18, segments = 24,
  domeRatio = 0.35, domeHeight = 0.12, color = [0.72, 0.76, 0.82],
  rimColor = [0.5, 0.55, 0.62], stretch = 1,
} = {}) {
  const half = thickness / 2;
  const domeR = radius * domeRatio;
  const top = at(origin, 0, half + domeHeight, 0);
  const bottom = at(origin, 0, -half - domeHeight * 0.4, 0);
  // How much longer the disc is fore-and-aft than it is across.
  //
  // A saucer was a circle, and three Federation classes do not have one: the
  // Galaxy's is an ovoid, the Sovereign's a raked ellipse, the Excelsior's an
  // elongated disc. One parameter, and the published beam-to-length ratio in
  // DIMENSIONS is what sets it — a Galaxy is 641 m by 464, an Intrepid 345 by
  // 132, and those two numbers alone make one hull broad and the other narrow
  // without anything being guessed.
  const sx = stretch;

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0) * sx; const s0 = Math.sin(a0);
    const c1 = Math.cos(a1) * sx; const s1 = Math.sin(a1);

    const rimA = at(origin, c0 * radius, 0, s0 * radius);
    const rimB = at(origin, c1 * radius, 0, s1 * radius);
    const domA = at(origin, c0 * domeR, half, s0 * domeR);
    const domB = at(origin, c1 * domeR, half, s1 * domeR);

    // Upper plate, dome cap, and the underside.
    mb.quad(rimA, rimB, domB, domA, color);
    mb.tri(domA, domB, top, color);
    mb.tri(rimB, rimA, bottom, rimColor);
  }
  return mb;
}

/**
 * A tapered cylinder along +x: engineering hulls, nacelles, pylun spars.
 * `r0` is the aft radius and `r1` the fore radius, so a nacelle tapers forward
 * and a secondary hull tapers aft.
 */
export function tube(mb, {
  origin = vec3(), length: len = 1, r0 = 0.2, r1 = 0.2, segments = 12,
  color = [0.66, 0.7, 0.76], capFore = true, capAft = true,
} = {}) {
  const foreC = at(origin, len, 0, 0);
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0); const s0 = Math.sin(a0);
    const c1 = Math.cos(a1); const s1 = Math.sin(a1);

    const aftA = at(origin, 0, c0 * r0, s0 * r0);
    const aftB = at(origin, 0, c1 * r0, s1 * r0);
    const forA = at(origin, len, c0 * r1, s0 * r1);
    const forB = at(origin, len, c1 * r1, s1 * r1);

    mb.quad(aftA, aftB, forB, forA, color);
    if (capFore) mb.tri(forA, forB, foreC, color);
    if (capAft) mb.tri(aftB, aftA, origin, color);
  }
  return mb;
}

/**
 * A box, given its centre and half-extents. Pylons, wings and hull plating.
 *
 * Two shears, because a Starfleet pylon leans in two planes and a box that can
 * only lean in one is why every warp pylon in this game read as a rectangular
 * slab from the side. `sweep` displaces the outboard (+z) end aft, which is
 * the rake you see from ABOVE — a swept wing. `rake` displaces the top (+y)
 * end aft, which is the lean you see from the SIDE, and is the whole reason a
 * Constitution's nacelles look like they are being carried rather than
 * balanced. Both are in world units at the far face and taper to nothing at
 * the near one.
 */
export function box(mb, {
  center = vec3(), size = vec3(1, 0.1, 0.4), sweep = 0, rake = 0, flare = 0,
  color = [0.6, 0.64, 0.7],
} = {}) {
  const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const [cx, cy, cz] = center;
  // Eight corners. The +z corners carry the sweep and the +y corners the rake,
  // both of which shear the box fore-and-aft.
  //
  // `flare` is the third one, and its absence is why every warp pylon in the
  // game was a brick. A pylon runs from a hull on the centreline to a nacelle
  // that is both above it and outboard of it — a leaning blade. With only
  // fore-aft shears the only box that touches both ends is one that spans the
  // whole gap in y AND the whole gap in z: a solid block filling the corner,
  // which is what a Galaxy was carrying, a quarter of the ship's length across.
  // Shearing z by height makes the same box a strut.
  const p = (sx, sy, sz) => vec3(
    cx + sx * hx - (sz > 0 ? sweep : 0) - (sy > 0 ? rake : 0),
    cy + sy * hy,
    cz + sz * hz + (sy > 0 ? flare : 0),
  );

  const v000 = p(-1, -1, -1); const v100 = p(1, -1, -1);
  const v110 = p(1, 1, -1); const v010 = p(-1, 1, -1);
  const v001 = p(-1, -1, 1); const v101 = p(1, -1, 1);
  const v111 = p(1, 1, 1); const v011 = p(-1, 1, 1);

  mb.quad(v001, v101, v111, v011, color);   // +z
  mb.quad(v100, v000, v010, v110, color);   // -z
  mb.quad(v010, v011, v111, v110, color);   // +y
  mb.quad(v000, v100, v101, v001, color);   // -y
  mb.quad(v101, v100, v110, v111, color);   // +x
  mb.quad(v000, v001, v011, v010, color);   // -x
  return mb;
}

/** A low-poly sphere, for planets, sensor pods and command modules. */
export function sphere(mb, {
  origin = vec3(), radius = 1, segments = 16, rings = 10,
  color = [0.6, 0.6, 0.7], banding = 0,
} = {}) {
  for (let r = 0; r < rings; r++) {
    const t0 = (r / rings) * Math.PI;
    const t1 = ((r + 1) / rings) * Math.PI;
    const y0 = Math.cos(t0) * radius; const rad0 = Math.sin(t0) * radius;
    const y1 = Math.cos(t1) * radius; const rad1 = Math.sin(t1) * radius;

    // A little per-ring variation reads as terrain or cloud banding without a
    // texture, which this renderer has no way to load.
    const shade = banding
      ? 1 - banding * 0.5 + banding * ((r * 2654435761 % 97) / 97)
      : 1;
    const c = [color[0] * shade, color[1] * shade, color[2] * shade];

    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const A = at(origin, Math.cos(a0) * rad0, y0, Math.sin(a0) * rad0);
      const B = at(origin, Math.cos(a1) * rad0, y0, Math.sin(a1) * rad0);
      const C = at(origin, Math.cos(a1) * rad1, y1, Math.sin(a1) * rad1);
      const D = at(origin, Math.cos(a0) * rad1, y1, Math.sin(a0) * rad1);
      if (r === 0) mb.tri(A, C, D, c);
      else if (r === rings - 1) mb.tri(A, B, C, c);
      else mb.quad(A, B, C, D, c);
    }
  }
  return mb;
}

/** Mirror everything added by `fn` across the z axis, for port/starboard pairs. */
export function mirrored(mb, fn) {
  const start = mb.positions.length;
  fn(mb);
  const end = mb.positions.length;

  // Mirroring flips handedness, so each triangle's winding is reversed as it is
  // copied — otherwise every mirrored face points inwards and back-face culling
  // makes the port nacelle invisible.
  for (let i = start; i < end; i += 9) {
    for (const [a, b] of [[0, 6], [3, 3], [6, 0]]) {
      mb.positions.push(mb.positions[i + b], mb.positions[i + b + 1], -mb.positions[i + b + 2]);
      mb.normals.push(mb.normals[i + b], mb.normals[i + b + 1], -mb.normals[i + b + 2]);
      mb.colors.push(mb.colors[i + b], mb.colors[i + b + 1], mb.colors[i + b + 2]);
      void a;
    }
  }
  return mb;
}
