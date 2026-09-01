// Federation silhouettes that the shared `starfleet` form cannot express.
//
// Twelve classes were built by one function: a round saucer, a tapering
// secondary hull, and two cylindrical nacelles on swept pylons. The parameters
// differed and the shape did not, so an Intrepid and a Sovereign were the same
// object at two sizes — and once the sizes became true, being the same object
// was the only thing left that was wrong.
//
// Four of these cannot be reached from `starfleet` at ANY parameter setting,
// which is why they are separate builders rather than more knobs:
//
//   A Miranda has no secondary hull. `starfleet` always builds one.
//   An Oberth has two hulls, and mounts its nacelles on the lower one.
//   A Constellation has four nacelles.
//   A Defiant and a runabout have no saucer at all.
//
// See docs/RESEARCH.md §14 for what identifies each class and why topology
// rather than proportion is what does it.
//
// Coordinate convention, matching mesh.js and the simulation: +x is the bow,
// +y is dorsal, +z is starboard. `mirrored` builds the starboard half and
// reflects it, so everything below is written for one side only.

import { vec3 } from './math.js';
import { saucer, tube, box, sphere, mirrored } from './mesh.js';

/**
 * One nacelle and its glowing cap, at a point. Every form here ends with a
 * pair of these and they were four copies of the same eight lines.
 */
function nacelle(m, p, { x, y, z, length: len, radius: r }) {
  tube(m, {
    origin: vec3(x, y, z), length: len, r0: r, r1: r * 0.84,
    segments: 10, color: p.hull,
  });
  // The bussard cap: the one emissive detail on a Federation hull.
  sphere(m, {
    origin: vec3(x + len, y, z), radius: r * 1.05,
    segments: 8, rings: 5, color: p.glow,
  });
}

export const FEDERATION_FORMS = {
  /**
   * No secondary hull at all — the Miranda.
   *
   * The class's identity is what is missing. The nacelles hang directly beneath
   * a broad saucer with nothing between them, and a rollbar carries the weapon
   * pod above it.
   */
  rollbar(mb, p, b) {
    const sr = b.saucerRadius ?? 0.52;
    const sx = b.saucerX ?? 0.1;
    saucer(mb, {
      origin: vec3(sx, 0, 0),
      radius: sr,
      thickness: b.saucerThickness ?? 0.11,
      domeRatio: b.domeRatio ?? 0.3,
      domeHeight: b.domeHeight ?? 0.04,
      stretch: b.saucerStretch ?? 1,
      segments: b.segments ?? 22,
      color: p.hull,
      rimColor: p.trim,
    });

    if (b.rollbar !== false) {
      const ry = b.rollbarY ?? 0.24;
      box(mb, { center: vec3(sx, ry, 0), size: vec3(0.16, 0.05, sr * 1.5), color: p.trim });
      mirrored(mb, (m) => {
        box(m, { center: vec3(sx, ry / 2, sr * 0.72), size: vec3(0.1, ry, 0.06), color: p.trim });
      });
      tube(mb, {
        origin: vec3(sx - 0.16, ry, 0), length: 0.32,
        r0: 0.05, r1: 0.05, segments: 8, color: p.hull,
      });
    }

    const ny = b.nacelleY ?? -0.16;
    const nz = b.nacelleZ ?? 0.34;
    const nx = b.nacelleX ?? -0.32;
    const nl = b.nacelleLength ?? 0.66;
    mirrored(mb, (m) => {
      box(m, {
        center: vec3(nx + nl * 0.4, ny / 2, nz * 0.7),
        size: vec3(0.1, Math.abs(ny), nz * 0.7),
        color: p.trim,
      });
      nacelle(m, p, { x: nx, y: ny, z: nz, length: nl, radius: b.nacelleRadius ?? 0.07 });
    });
  },

  /**
   * Two hulls, one slung under the other — the Oberth.
   *
   * A saucer above and a wholly separate lower hull below it on two struts,
   * with the nacelles on the LOWER hull. Nothing else in Starfleet is built
   * this way.
   */
  twinhull(mb, p, b) {
    const sr = b.saucerRadius ?? 0.38;
    const sx = b.saucerX ?? 0.16;
    const sy = b.saucerY ?? 0.2;
    saucer(mb, {
      origin: vec3(sx, sy, 0),
      radius: sr,
      thickness: b.saucerThickness ?? 0.1,
      domeRatio: 0.3, domeHeight: 0.05,
      segments: b.segments ?? 20,
      color: p.hull, rimColor: p.trim,
    });

    const ly = b.lowerY ?? -0.26;
    tube(mb, {
      origin: vec3(-0.44, ly, 0),
      length: b.hullLength ?? 0.78,
      r0: b.hullR0 ?? 0.1, r1: b.hullR1 ?? 0.12,
      segments: 12, color: p.hull,
    });
    mirrored(mb, (m) => {
      box(m, {
        center: vec3(sx, (sy + ly) / 2, sr * 0.4),
        size: vec3(0.14, sy - ly, 0.07),
        color: p.trim,
      });
    });

    const nz = b.nacelleZ ?? 0.3;
    const nl = b.nacelleLength ?? 0.6;
    mirrored(mb, (m) => {
      box(m, { center: vec3(-0.14, ly, nz * 0.6), size: vec3(0.34, 0.06, nz * 0.8), color: p.trim });
      nacelle(m, p, { x: -0.36, y: ly, z: nz, length: nl, radius: b.nacelleRadius ?? 0.065 });
    });
  },

  /**
   * Four nacelles, in two stacked pairs — the Constellation.
   *
   * The count is the whole silhouette: at any distance where you cannot read a
   * registry, a Constellation is the ship with four glowing caps in a square.
   */
  quadnacelle(mb, p, b) {
    const sr = b.saucerRadius ?? 0.42;
    const sx = b.saucerX ?? 0.3;
    const hy = b.hullY ?? -0.17;
    saucer(mb, {
      origin: vec3(sx, 0.02, 0),
      radius: sr,
      thickness: b.saucerThickness ?? 0.1,
      domeRatio: 0.32, domeHeight: 0.05,
      segments: b.segments ?? 20,
      color: p.hull, rimColor: p.trim,
    });
    box(mb, { center: vec3(sx - sr * 0.55, -0.1, 0), size: vec3(sr * 0.5, 0.22, 0.09), color: p.trim });
    tube(mb, {
      origin: vec3(-0.46, hy, 0),
      length: b.hullLength ?? 0.74, r0: 0.1, r1: 0.13,
      segments: 12, color: p.hull,
    });

    // `mirrored` gives port and starboard; the loop gives the stack.
    const nl = b.nacelleLength ?? 0.72;
    const nx = b.nacelleX ?? -0.42;
    const nz = b.nacelleZ ?? 0.38;
    const high = b.nacelleY ?? 0.2;
    for (const ny of [high, high - (b.nacelleStack ?? 0.34)]) {
      mirrored(mb, (m) => {
        box(m, {
          center: vec3(nx + nl * 0.3, (ny + hy) / 2, nz * 0.55),
          size: vec3(0.09, 0.3, nz * 0.85),
          sweep: b.pylonSweep ?? 0.08,
          color: p.trim,
        });
        nacelle(m, p, { x: nx, y: ny, z: nz, length: nl, radius: b.nacelleRadius ?? 0.06 });
      });
    }
  },

  /**
   * A saucer with a pod where the nacelles would sweep — the Nebula.
   *
   * The same primary hull as a Galaxy and a completely different profile,
   * because the mission pod sits on a dorsal spine above the saucer. From the
   * side the two are unmistakable.
   */
  podded(mb, p, b) {
    const sr = b.saucerRadius ?? 0.58;
    const sx = b.saucerX ?? 0.2;
    const hy = b.hullY ?? -0.16;
    saucer(mb, {
      origin: vec3(sx, 0.02, 0),
      radius: sr,
      thickness: b.saucerThickness ?? 0.12,
      domeRatio: 0.3, domeHeight: 0.05,
      stretch: b.saucerStretch ?? 1.1,
      segments: b.segments ?? 22,
      color: p.hull, rimColor: p.trim,
    });
    tube(mb, {
      origin: vec3(-0.4, hy, 0),
      length: b.hullLength ?? 0.6, r0: 0.11, r1: 0.14,
      segments: 12, color: p.hull,
    });

    const spine = sx - sr * 0.5;
    box(mb, { center: vec3(spine, 0.2, 0), size: vec3(0.12, 0.3, 0.1), color: p.trim });
    box(mb, {
      center: vec3(spine, b.podY ?? 0.38, 0),
      size: vec3(b.podLength ?? 0.5, 0.12, b.podWidth ?? 0.42),
      sweep: 0.06, color: p.hull,
    });

    const ny = b.nacelleY ?? -0.02;
    const nz = b.nacelleZ ?? 0.42;
    const nx = b.nacelleX ?? -0.36;
    const nl = b.nacelleLength ?? 0.7;
    mirrored(mb, (m) => {
      box(m, {
        center: vec3(nx + nl * 0.3, (ny + hy) / 2, nz * 0.6),
        size: vec3(0.1, 0.24, nz * 0.8),
        sweep: 0.1, color: p.trim,
      });
      nacelle(m, p, { x: nx, y: ny, z: nz, length: nl, radius: b.nacelleRadius ?? 0.075 });
    });
  },

  /**
   * No saucer at all — the Defiant and the Danube runabout.
   *
   * One body with the nacelles buried in it rather than hung off pylons. The
   * Defiant is a warship built as a single wedge; a runabout is a box with two
   * engines on it.
   */
  compact(mb, p, b) {
    const bl = b.bodyLength ?? 1.0;
    const bh = b.bodyHeight ?? 0.2;
    const bw = b.bodyWidth ?? 0.44;
    box(mb, {
      center: vec3(0.05, 0, 0),
      size: vec3(bl, bh, bw),
      sweep: b.bodySweep ?? 0.16,
      color: p.hull,
    });
    box(mb, {
      center: vec3(0.05 + bl * 0.18, bh * 0.6, 0),
      size: vec3(bl * 0.3, 0.1, bw * 0.42),
      color: p.trim,
    });
    sphere(mb, {
      origin: vec3(0.05 + bl * 0.5, -0.02, 0),
      radius: 0.07, segments: 8, rings: 5,
      color: p.dish ?? p.glow,
    });

    mirrored(mb, (m) => {
      nacelle(m, p, {
        x: b.nacelleX ?? -0.34,
        y: b.nacelleY ?? 0.02,
        z: b.nacelleZ ?? 0.26,
        length: b.nacelleLength ?? 0.52,
        radius: b.nacelleRadius ?? 0.07,
      });
    });
  },
};
