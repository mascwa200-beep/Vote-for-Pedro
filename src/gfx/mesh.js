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
    this.glows = [];
  }

  /**
   * One triangle, wound counter-clockwise when seen from outside.
   *
   * `glow` is how much this face ignores the lighting: 0 is hull that takes
   * the key and the fill, 1 is a surface that renders at its own colour no
   * matter which way it faces. It is PER VERTEX rather than per draw, which is
   * the whole reason a window exists — see the note on `windowRing` below.
   */
  tri(a, b, c, color, glow = 0) {
    const n = normalize(cross(sub(b, a), sub(c, a)));
    for (const v of [a, b, c]) {
      this.positions.push(v[0], v[1], v[2]);
      this.normals.push(n[0], n[1], n[2]);
      this.colors.push(color[0], color[1], color[2]);
      this.glows.push(glow);
    }
    return this;
  }

  /** A quad, as two triangles. */
  quad(a, b, c, d, color, glow = 0) {
    return this.tri(a, b, c, color, glow).tri(a, c, d, color, glow);
  }

  get triangleCount() { return this.positions.length / 9; }

  /**
   * Interleaved position/normal/colour/glow, ready for one buffer and one draw
   * call. Ten floats a vertex; the tenth is what makes a window a window.
   */
  build() {
    const count = this.positions.length / 3;
    const data = new Float32Array(count * 10);
    for (let i = 0; i < count; i++) {
      data[i * 10 + 0] = this.positions[i * 3 + 0];
      data[i * 10 + 1] = this.positions[i * 3 + 1];
      data[i * 10 + 2] = this.positions[i * 3 + 2];
      data[i * 10 + 3] = this.normals[i * 3 + 0];
      data[i * 10 + 4] = this.normals[i * 3 + 1];
      data[i * 10 + 5] = this.normals[i * 3 + 2];
      data[i * 10 + 6] = this.colors[i * 3 + 0];
      data[i * 10 + 7] = this.colors[i * 3 + 1];
      data[i * 10 + 8] = this.colors[i * 3 + 2];
      data[i * 10 + 9] = this.glows[i] ?? 0;
    }
    return { data, vertexCount: count, stride: 10 * 4 };
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
 * averages about 830 triangles a ship and the heaviest is 2,142 — a rounding
 * error for any GPU made this decade, and the difference between a silhouette
 * that reads as a starship and one that reads as a wireframe. Six hulls at
 * 1800x1800 measure under a millisecond a frame either way; the run-to-run
 * spread on one unchanged scene is wider than the difference detail makes,
 * which says the cost here is draw calls and fill, not geometry.
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
  rimColor = [0.5, 0.55, 0.62], stretch = 1, glow = 0,
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
    mb.quad(rimA, rimB, domB, domA, color, glow);
    mb.tri(domA, domB, top, color, glow);
    mb.tri(rimB, rimA, bottom, rimColor, glow);
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
  color = [0.66, 0.7, 0.76], capFore = true, capAft = true, glow = 0,
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

    mb.quad(aftA, aftB, forB, forA, color, glow);
    if (capFore) mb.tri(forA, forB, foreC, color, glow);
    if (capAft) mb.tri(aftB, aftA, origin, color, glow);
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
  dip = 0, color = [0.6, 0.64, 0.7], glow = 0,
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
  //
  // `dip` is the fourth, and it is `flare` transposed: it drops the outboard
  // (+z) end in y. A Bird-of-Prey's wings are DIHEDRAL — they leave the hull at
  // the centreline and end far below it — and without a shear that says so the
  // only way to draw one is to lower the whole plate, which is what this form
  // did. Measured on the built mesh, a Bird-of-Prey's wing root sat 0.29 units
  // below the body it is attached to: from the side the wing was a plate
  // floating under the ship with a gap of clear space between them.
  const p = (sx, sy, sz) => vec3(
    cx + sx * hx - (sz > 0 ? sweep : 0) - (sy > 0 ? rake : 0),
    cy + sy * hy - (sz > 0 ? dip : 0),
    cz + sz * hz + (sy > 0 ? flare : 0),
  );

  const v000 = p(-1, -1, -1); const v100 = p(1, -1, -1);
  const v110 = p(1, 1, -1); const v010 = p(-1, 1, -1);
  const v001 = p(-1, -1, 1); const v101 = p(1, -1, 1);
  const v111 = p(1, 1, 1); const v011 = p(-1, 1, 1);

  mb.quad(v001, v101, v111, v011, color, glow);   // +z
  mb.quad(v100, v000, v010, v110, color, glow);   // -z
  mb.quad(v010, v011, v111, v110, color, glow);   // +y
  mb.quad(v000, v100, v101, v001, color, glow);   // -y
  mb.quad(v101, v100, v110, v111, color, glow);   // +x
  mb.quad(v000, v001, v011, v010, color, glow);   // -x
  return mb;
}

/**
 * A box on the centreline whose plan-form is a symmetric point.
 *
 * `sweep` displaces a box's +z corners aft and leaves its -z corners alone,
 * which is correct for a wing — it is called from inside `mirrored`, so the
 * port wing gets the same treatment reflected. On a CENTRELINE box there is no
 * reflection, and the result is a hull that is a parallelogram seen from above:
 * one bow corner reaching forward and the other swept back.
 *
 * Measured across the fleet, eleven classes were lopsided this way, the worst
 * of them by sixteen percent of its own length — and on a Galor it put the
 * hull's nose, at the centreline, a fifth of the ship behind where the sensor
 * dome was mounted, so the dome floated in clear space ahead of the ship.
 *
 * This builds the starboard half and mirrors it, so a swept centreline section
 * comes out as an arrowhead: both sides raked, the point on the axis.
 */
export function prow(mb, { center = vec3(), size = vec3(1, 0.1, 0.4), ...rest } = {}) {
  const half = size[2] / 2;
  return mirrored(mb, (m) => box(m, {
    ...rest,
    center: vec3(center[0], center[1], center[2] + half / 2),
    size: vec3(size[0], size[1], half),
  }));
}

/** A low-poly sphere, for planets, sensor pods and command modules. */
/**
 * `scale` makes it an ellipsoid, which is most of what a sphere is used for.
 *
 * A ship is never a ball. Every hull in the fleet is between a tenth and a
 * third as tall as it is long, so a sphere built round and then squashed by the
 * normaliser is squashed along with everything else on the hull — and a form
 * whose one round part forces the whole ship through a 2.6x squash is a form
 * that is not built right. Flat shading takes the face normal from the vertices
 * it is given, so a non-uniform scale here needs no normal correction.
 */
export function sphere(mb, {
  origin = vec3(), radius = 1, segments = 16, rings = 10, scale = null,
  color = [0.6, 0.6, 0.7], banding = 0, glow = 0,
} = {}) {
  const kx = scale ? scale[0] : 1;
  const ky = scale ? scale[1] : 1;
  const kz = scale ? scale[2] : 1;
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
      const A = at(origin, Math.cos(a0) * rad0 * kx, y0 * ky, Math.sin(a0) * rad0 * kz);
      const B = at(origin, Math.cos(a1) * rad0 * kx, y0 * ky, Math.sin(a1) * rad0 * kz);
      const C = at(origin, Math.cos(a1) * rad1 * kx, y1 * ky, Math.sin(a1) * rad1 * kz);
      const D = at(origin, Math.cos(a0) * rad1 * kx, y1 * ky, Math.sin(a0) * rad1 * kz);
      if (r === 0) mb.tri(A, C, D, c, glow);
      else if (r === rings - 1) mb.tri(A, B, C, c, glow);
      else mb.quad(A, B, C, D, c, glow);
    }
  }
  return mb;
}

/**
 * The colour of a lit window: warm interior light, not hull.
 *
 * Exported so a form that cannot use a belt can still lay a port that is the
 * SAME port — a D'deridex's habitable volume is inside two arms that enclose
 * the hull from every direction, so the only surface a light can be seen from
 * is the outboard face of an arm, and a ring around the x axis cannot lie on
 * one. Nothing should be picking a different colour; this is here so that the
 * one thing everything else keys off stays one thing.
 */
export const PORT_LIGHT = [1.0, 0.93, 0.72];
const WINDOW = PORT_LIGHT;

/**
 * Port red and starboard green: the two lights every vessel at sea or in space
 * carries, and the ones no Federation hull in this game had.
 *
 * Measured across the fleet, every faction already ran them off `greebles`
 * with `litEvery` — Klingon 204 to 264 triangles of them, Romulan up to 316,
 * even an independent freighter 69. All thirteen Federation classes had zero,
 * including the Constitution the player is flying.
 *
 * Their own colours rather than the faction accent, for two reasons. A
 * Starfleet hull's accent is the blue of a warp grille and a blue running light
 * reads as more grille; and red-and-green is the one lighting convention a
 * viewer already knows without being told, which is worth more at phone scale
 * than any amount of detail.
 *
 * -z is port and +z is starboard, which is the convention this whole file is
 * written in. Twenty-four triangles a ship.
 */
export const NAV_PORT = [1.0, 0.26, 0.20];
export const NAV_STBD = [0.26, 1.0, 0.42];

export function navLights(mb, {
  origin = vec3(), radius = 1, y = 0, size = 0.05, out = 1.012,
} = {}) {
  // Sized against the window band it sits in rather than by eye. A rim port
  // is one `windowRing` quad — an arc of (2pi/24)*0.45 by 2*0.008 of the
  // radius, about 0.0019 r^2 of outward-facing face. The first draft of this
  // helper was 1.5s by 0.85s at s = 0.03r, which is 0.0011 r^2: SIXTY PER CENT
  // of a window, and rendered it looked exactly like that — a light dimmer
  // than the windows either side of it, which is backwards. These proportions
  // put it at about twice a port's face, and long rather than tall, so it
  // reads as a lamp on the rim and not a lump standing off it.
  const s = radius * size;
  for (const [z, color] of [[-1, NAV_PORT], [1, NAV_STBD]]) {
    box(mb, {
      center: at(origin, 0, y, z * radius * out),
      size: vec3(s * 2.2, s * 0.7, s),
      color,
      glow: 1,
    });
  }
  return mb;
}

/**
 * A band of lit windows around a horizontal circle — a saucer rim.
 *
 * WHY THIS IS GEOMETRY AND NOT A BRIGHTER COLOUR.
 *
 * A window is not a pale patch of hull. It is a hole with a lit room behind
 * it, and the thing that says so is that it stays lit on the side of the ship
 * the key light does not reach. Before the glow channel existed the only way
 * to say that was `uEmissive`, which is per DRAW — so a hull with windows had
 * to be two draw calls, and the measurement in #134 says this renderer is
 * draw-call bound and not geometry bound. Per-vertex glow puts the windows in
 * the same buffer as the hull they are set into, for the cost of one float a
 * vertex.
 *
 * Discrete windows rather than a continuous lit stripe, because that is what a
 * hull has: at tactical range the gaps blur into a dashed line, which is the
 * read, and up close in the vista and first-person views they are windows.
 *
 * `fill` is the share of each window's pitch that is glass, so 0.5 is a window
 * and a gap of equal width. `out` lifts the band clear of the hull it sits on
 * — without it the band and the rim are coplanar and z-fighting decides which
 * one you see, per pixel, per frame.
 */
export function windowRing(mb, {
  origin = vec3(), radius = 1, y = 0, count = 24, fill = 0.45, height = 0.008,
  stretch = 1, color = WINDOW, glow = 1, out = 1.006, phase = 0,
} = {}) {
  const pitch = (Math.PI * 2) / count;
  const half = (pitch * fill) / 2;
  const R = radius * out;
  for (let i = 0; i < count; i++) {
    const mid = phase + i * pitch;
    const a0 = mid - half; const a1 = mid + half;
    const c0 = Math.cos(a0) * stretch; const s0 = Math.sin(a0);
    const c1 = Math.cos(a1) * stretch; const s1 = Math.sin(a1);
    const A = at(origin, c0 * R, y - height, s0 * R);
    const B = at(origin, c1 * R, y - height, s1 * R);
    const C = at(origin, c1 * R, y + height, s1 * R);
    const D = at(origin, c0 * R, y + height, s0 * R);
    // Wound A-D-C-B so the face normal points radially outward. The obvious
    // A-B-C-D order points it back into the hull and back-face culling eats
    // the entire band.
    mb.quad(A, D, C, B, color, glow);
  }
  return mb;
}

/**
 * Lit ports lying FLAT on a saucer's upper plate, in a concentric ring.
 *
 * `windowRing` puts them on the rim, where they face outward — and the
 * tactical camera looks DOWN, so from the angle the game is actually played
 * at, a rim band is edge-on and contributes almost nothing. A Constitution
 * photographed from above is a grey plate with rows of lit rectangles on it,
 * and that is the view this exists for.
 *
 * `y` is the plate's own height at this radius, passed in rather than guessed:
 * the plate slopes, and a flat ring at a constant height either floats above
 * it or sinks into it depending which side of the slope you are on.
 */
export function windowDeck(mb, {
  origin = vec3(), radius = 1, y = 0, count = 24, fill = 0.4, depth = 0.012,
  stretch = 1, color = WINDOW, glow = 1, phase = 0,
} = {}) {
  const pitch = (Math.PI * 2) / count;
  const half = (pitch * fill) / 2;
  const rIn = radius - depth; const rOut = radius + depth;
  for (let i = 0; i < count; i++) {
    const mid = phase + i * pitch;
    const a0 = mid - half; const a1 = mid + half;
    const c0 = Math.cos(a0) * stretch; const s0 = Math.sin(a0);
    const c1 = Math.cos(a1) * stretch; const s1 = Math.sin(a1);
    const A = at(origin, c0 * rIn, y, s0 * rIn);
    const B = at(origin, c1 * rIn, y, s1 * rIn);
    const C = at(origin, c1 * rOut, y, s1 * rOut);
    const D = at(origin, c0 * rOut, y, s0 * rOut);
    // A-B-C-D: A and B are the same radius a slice apart, C and D the outer
    // pair. Winding it A-D-C-B instead — pairing each point with its RADIAL
    // neighbour rather than its angular one — points the normal down into the
    // plate, and back-face culling then makes the whole deck invisible from
    // exactly the angle it exists for.
    mb.quad(A, B, C, D, color, glow);
  }
  return mb;
}

/**
 * The same thing around a tube's circumference: a row of ports down the flank
 * of a secondary hull, running fore-and-aft along +x.
 *
 * `arc` and `phase` exist because most of a hull's circumference is not where
 * windows go — a habitable deck is a band along the side, not a sleeve.
 */
export function windowBelt(mb, {
  origin = vec3(), radius = 0.2, r0 = radius, r1 = radius, x = 0,
  count = 8, fill = 0.45, length = 0.02,
  color = WINDOW, glow = 1, out = 1.01, arc = Math.PI * 2, phase = 0,
} = {}) {
  const pitch = arc / count;
  const half = (pitch * fill) / 2;
  // `r0` and `r1` follow the taper of the tube this sits on.
  //
  // A single radius on a tapering hull has to be the widest station's or the
  // narrow end swallows the ports — which is exactly the failure the
  // intercooler grille shipped with in #134: geometry placed inside the shape
  // it was decorating, invisible from every angle and paid for anyway. Taking
  // both radii means a belt lies ON the hull for its whole run instead.
  const R0 = r0 * out; const R1 = r1 * out;
  for (let i = 0; i < count; i++) {
    const mid = phase + (i + 0.5) * pitch;
    const a0 = mid - half; const a1 = mid + half;
    const c0 = Math.cos(a0); const s0 = Math.sin(a0);
    const c1 = Math.cos(a1); const s1 = Math.sin(a1);
    const aftA = at(origin, x, c0 * R0, s0 * R0);
    const aftB = at(origin, x, c1 * R0, s1 * R0);
    const forA = at(origin, x + length, c0 * R1, s0 * R1);
    const forB = at(origin, x + length, c1 * R1, s1 * R1);
    mb.quad(aftA, aftB, forB, forA, color, glow);
  }
  return mb;
}

/**
 * A run of small raised boxes along a line: machinery, plating, deck housings.
 *
 * WHY A HULL NEEDS THIS.
 *
 * Flat shading with no textures means a surface has exactly one cue that it is
 * made of anything — its silhouette against the next surface. A tapered tube is
 * therefore a tapered tube at every distance, and a hostile hull built out of
 * four of them reads as a shape rather than as a ship. The Federation hulls
 * escaped that by accident: a saucer, a neck, a secondary hull, two pylons and
 * two nacelles already put seven silhouettes against each other. A Klingon
 * cruiser has three.
 *
 * `litEvery` is the other half. Every third or fourth box drawn at full glow is
 * a row of running lights along a spine, which costs no extra geometry at all
 * and is the single cheapest thing that says a hull is CREWED.
 *
 * Sizes vary deterministically — a hash of the index, not a random draw, so a
 * hull is the same hull every time it is built and nothing here can move the
 * simulation's stream.
 */
export function greebles(mb, {
  from = vec3(), to = vec3(1, 0, 0), count = 6, size = vec3(0.06, 0.03, 0.06),
  vary = 0.4, color = [0.5, 0.52, 0.5], glow = 0, lit = null, litEvery = 0,
} = {}) {
  for (let i = 0; i < count; i++) {
    // Centres of `count` equal spans, so nothing sits on the end caps.
    const t = (i + 0.5) / count;
    // FNV-ish, off the index alone: two boxes at the same index are the same
    // box, and a hull rebuilt is the hull it was.
    const h = ((i * 2654435761) >>> 0) / 4294967296;
    const k = 1 + (h * 2 - 1) * vary;
    const on = litEvery > 0 && i % litEvery === 0;
    box(mb, {
      center: vec3(
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ),
      size: vec3(size[0] * k, size[1] * (2 - k), size[2] * k),
      color: on ? (lit ?? color) : color,
      glow: on ? 1 : glow,
    });
  }
  return mb;
}

/**
 * A straight run of lit ports along a line, as small solid boxes.
 *
 * `windowBelt` lays ports on a circle about the x axis, which is right for a
 * tube and impossible for a flat panel that is neither horizontal nor vertical
 * — a swept, drooping wing, say. A box is closed, so it is visible from every
 * side and cannot be culled by facing the wrong way, which is the failure both
 * of the belt helpers were written to avoid.
 */
export function portRow(mb, {
  from = vec3(), to = vec3(1, 0, 0), count = 4, size = 0.02, color = WINDOW, glow = 1,
} = {}) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : (i + 0.5) / count;
    box(mb, {
      center: vec3(
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ),
      size: vec3(size * 1.6, size, size),
      color,
      glow,
    });
  }
  return mb;
}

/**
 * Scale the colour of everything `fn` adds, per vertex, by a field of position.
 *
 * The room has done this since `bakeOcclusion`: a gradient inside a single
 * triangle costs no vertices, no triangles, no draw calls and no shader lines,
 * because the colour channel is already per vertex and the rasteriser already
 * interpolates it. Measured, the interiors are 78.3% colour-varying and the
 * fleet was 0 of 33,898 — the technique shipped a year ago and no hull had ever
 * used it.
 *
 * It matters most exactly where there is nothing else left. A face with
 * `glow: 1` has its entire lighting result discarded by the shader —
 * `mix(lit, vColor * uTint, vGlow)` — so on an emissive surface the albedo is
 * the ONLY channel that can carry shape. Half the fleet's vertices are in that
 * state, and every one of them was a flat disc of colour.
 *
 * Colour only, deliberately. The glow channel is what says a face is self-lit
 * at all; ramping it would turn the rim of a dome back into a lit surface that
 * takes the key light, which is a different change needing a different
 * argument.
 *
 * Call this INSIDE a `mirrored` callback, never around one. `mirrored` copies
 * colours that are already written, so shading from outside would apply one
 * dome-centred field to both domes and mis-shade the far one — the same bug the
 * glow comment below records being bitten by.
 */
export function shaded(mb, fn, shade) {
  const start = mb.positions.length;
  fn(mb);
  for (let i = start; i < mb.positions.length; i += 3) {
    const s = shade(mb.positions[i], mb.positions[i + 1], mb.positions[i + 2]);
    mb.colors[i] *= s;
    mb.colors[i + 1] *= s;
    mb.colors[i + 2] *= s;
  }
  return mb;
}

/**
 * A field for `shaded`: hottest on the +x axis of a point, falling off toward
 * the rim of whatever surrounds it. What a collector or an intake looks like.
 *
 * `peak` is deliberately above 1. Ramping DOWN from the palette colour would
 * take emitted light away and read as a dimmer dome rather than a shaped one;
 * overshooting instead keeps the average where it was. `gl_FragColor` clamps at
 * write, so the core saturates to a hot, slightly desaturated centre — while
 * the value stored in the mesh stays a pure scalar multiple of the palette
 * colour, which is what lets a test still recognise the colour it is drawn in.
 *
 * `rim` is a floor, not zero, for the same reason `bakeOcclusion` clamps at
 * 0.42: nothing on a hull should bake to black.
 */
export const hotCore = (cx, cy, cz, { peak = 1.15, rim = 0.55 } = {}) => (px, py, pz) => {
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  const len = Math.hypot(dx, dy, dz) || 1;
  return rim + (peak - rim) * Math.max(0, dx / len);
};

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
      // The glow channel is one float a vertex, not three, so it indexes by
      // vertex rather than by float. Forgetting this is how a mirrored nacelle
      // gets a dark bussard dome while its twin glows.
      mb.glows.push(mb.glows[(i + b) / 3]);
      void a;
    }
  }
  return mb;
}
