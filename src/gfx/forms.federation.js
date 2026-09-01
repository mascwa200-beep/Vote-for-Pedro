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
// Every size below is a share of the class's PUBLISHED beam and height, handed
// in as `ratioBeam` and `ratioHeight` against a hull built to span one unit
// fore and aft. Nothing here is a hand-tuned constant, because hand-tuned
// constants are what made every Federation hull in this game half again too
// wide and twice too tall.
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
   *
   * The published beam includes the nacelles, which sit at the saucer's rim
   * rather than inboard of it, so the saucer here is a fraction of the beam
   * instead of the whole of it — the one place a Starfleet hull's widest point
   * is not its primary hull.
   */
  rollbar(mb, p, b) {
    const wide = b.ratioBeam ?? 0.5;
    const high = b.ratioHeight ?? 0.22;
    const sr = b.saucerRadius ?? wide * 0.46;
    const sx = b.saucerX ?? 0.5 - sr * 1.06;
    saucer(mb, {
      origin: vec3(sx, 0, 0),
      radius: sr,
      thickness: b.saucerThickness ?? high * 0.34,
      domeRatio: b.domeRatio ?? 0.3,
      domeHeight: b.domeHeight ?? high * 0.16,
      // A Miranda's primary hull is wider across than it is deep fore-and-aft,
      // which is the opposite of every other saucer in the fleet.
      stretch: b.saucerStretch ?? 0.86,
      segments: b.segments ?? 22,
      color: p.hull,
      rimColor: p.trim,
    });

    if (b.rollbar !== false) {
      const ry = b.rollbarY ?? high * 0.42;
      box(mb, { center: vec3(sx, ry, 0), size: vec3(sr * 0.34, high * 0.12, wide * 0.82), color: p.trim });
      mirrored(mb, (m) => {
        box(m, {
          center: vec3(sx, ry / 2, wide * 0.4),
          size: vec3(sr * 0.22, ry, high * 0.13),
          color: p.trim,
        });
      });
      tube(mb, {
        origin: vec3(sx - sr * 0.34, ry, 0), length: sr * 0.68,
        r0: high * 0.11, r1: high * 0.11, segments: 8, color: p.hull,
      });
    }

    const ny = b.nacelleY ?? -high * 0.28;
    const nz = b.nacelleZ ?? wide * 0.44;
    // Short and fat, and they reach the stern: a Miranda's engines ARE its aft
    // half. Long thin rods read as a saucer with two spikes behind it.
    const nl = b.nacelleLength ?? 0.5 + sx * 0.5;
    const nx = b.nacelleX ?? -0.5;
    mirrored(mb, (m) => {
      box(m, {
        center: vec3(sx - sr * 0.3, ny / 2, nz * 0.72),
        size: vec3(sr * 0.7, Math.abs(ny) + high * 0.16, nz * 0.75),
        color: p.trim,
      });
      nacelle(m, p, { x: nx, y: ny, z: nz, length: nl, radius: b.nacelleRadius ?? high * 0.26 });
    });
  },

  /**
   * Two hulls, one slung under the other — the Oberth.
   *
   * A saucer above and a wholly separate lower hull below it on two struts,
   * with the nacelles on the LOWER hull. Nothing else in Starfleet is built
   * this way, and the gap between the two hulls is the whole silhouette —
   * which is also why an Oberth is proportionally the tallest ship in the
   * fleet for its length.
   */
  twinhull(mb, p, b) {
    const wide = b.ratioBeam ?? 0.55;
    const high = b.ratioHeight ?? 0.29;
    const sr = b.saucerRadius ?? wide / 2;
    const sx = b.saucerX ?? 0.5 - sr;
    const sy = b.saucerY ?? high * 0.28;
    saucer(mb, {
      origin: vec3(sx, sy, 0),
      radius: sr,
      thickness: b.saucerThickness ?? high * 0.26,
      domeRatio: 0.3, domeHeight: high * 0.14,
      stretch: b.saucerStretch ?? 0.94,
      segments: b.segments ?? 20,
      color: p.hull, rimColor: p.trim,
    });

    const ly = b.lowerY ?? -high * 0.28;
    tube(mb, {
      origin: vec3(-0.5, ly, 0),
      length: b.hullLength ?? 0.86,
      r0: high * 0.3, r1: high * 0.36,
      segments: 12, color: p.hull,
    });
    mirrored(mb, (m) => {
      box(m, {
        center: vec3(sx, (sy + ly) / 2, sr * 0.42),
        size: vec3(sr * 0.36, sy - ly, high * 0.2),
        color: p.trim,
      });
    });

    const nz = b.nacelleZ ?? wide * 0.42;
    const nl = b.nacelleLength ?? 0.56;
    mirrored(mb, (m) => {
      box(m, {
        center: vec3(-0.16, ly, nz * 0.6),
        size: vec3(0.34, high * 0.16, nz * 0.8), color: p.trim,
      });
      nacelle(m, p, { x: -0.42, y: ly, z: nz, length: nl, radius: b.nacelleRadius ?? high * 0.2 });
    });
  },

  /**
   * Four nacelles, in two stacked pairs — the Constellation.
   *
   * The count is the whole silhouette: at any distance where you cannot read a
   * registry, a Constellation is the ship with four glowing caps in a square.
   * The published beam is set by the nacelles at their widest, so the saucer
   * is smaller than the beam rather than equal to it.
   */
  quadnacelle(mb, p, b) {
    const wide = b.ratioBeam ?? 0.61;
    const high = b.ratioHeight ?? 0.23;
    const sr = b.saucerRadius ?? wide * 0.38;
    const sx = b.saucerX ?? 0.5 - sr;
    const hy = b.hullY ?? -high * 0.2;
    saucer(mb, {
      origin: vec3(sx, 0, 0),
      radius: sr,
      thickness: b.saucerThickness ?? high * 0.24,
      domeRatio: 0.32, domeHeight: high * 0.18,
      segments: b.segments ?? 20,
      color: p.hull, rimColor: p.trim,
    });
    box(mb, {
      center: vec3(sx - sr * 0.55, hy / 2, 0),
      size: vec3(sr * 0.5, Math.abs(hy) + high * 0.22, high * 0.34),
      color: p.trim,
    });
    tube(mb, {
      origin: vec3(-0.5, hy, 0),
      length: b.hullLength ?? 0.5 + sx * 0.8,
      r0: high * 0.22, r1: high * 0.28,
      segments: 12, color: p.hull,
    });

    // `mirrored` gives port and starboard; the loop gives the stack.
    const nl = b.nacelleLength ?? 0.66;
    const nx = b.nacelleX ?? -0.46;
    const nz = b.nacelleZ ?? wide * 0.46;
    const high2 = b.nacelleY ?? high * 0.32;
    const stack = b.nacelleStack ?? high * 0.62;
    for (const ny of [high2, high2 - stack]) {
      mirrored(mb, (m) => {
        box(m, {
          center: vec3(nx + nl * 0.3, (ny + hy) / 2, nz * 0.55),
          size: vec3(high * 0.2, Math.abs(ny - hy) + high * 0.14, nz * 0.85),
          sweep: b.pylonSweep ?? 0.04,
          rake: b.pylonRake ?? Math.max(0, ny - hy) * 0.5,
          color: p.trim,
        });
        nacelle(m, p, { x: nx, y: ny, z: nz, length: nl, radius: b.nacelleRadius ?? high * 0.11 });
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
    const wide = b.ratioBeam ?? 0.72;
    const high = b.ratioHeight ?? 0.29;
    const sr = b.saucerRadius ?? wide / 2;
    const sx = b.saucerX ?? 0.5 - sr;
    const hy = b.hullY ?? -high * 0.2;
    saucer(mb, {
      origin: vec3(sx, 0, 0),
      radius: sr,
      thickness: b.saucerThickness ?? high * 0.2,
      domeRatio: 0.3, domeHeight: high * 0.12,
      stretch: b.saucerStretch ?? 1.2,
      segments: b.segments ?? 22,
      color: p.hull, rimColor: p.trim,
    });
    tube(mb, {
      origin: vec3(-0.5, hy, 0),
      length: b.hullLength ?? 0.5 + sx * 0.8,
      r0: high * 0.2, r1: high * 0.26,
      segments: 12, color: p.hull,
    });

    const spine = sx - sr * 0.45;
    box(mb, { center: vec3(spine, high * 0.2, 0), size: vec3(sr * 0.3, high * 0.4, wide * 0.16), color: p.trim });
    box(mb, {
      center: vec3(spine, b.podY ?? high * 0.4, 0),
      size: vec3(b.podLength ?? sr * 0.95, high * 0.2, b.podWidth ?? wide * 0.5),
      sweep: 0.06, color: p.hull,
    });

    const ny = b.nacelleY ?? -high * 0.04;
    const nz = b.nacelleZ ?? wide * 0.44;
    const nx = b.nacelleX ?? -0.5;
    const nl = b.nacelleLength ?? 0.62;
    mirrored(mb, (m) => {
      box(m, {
        center: vec3(nx + nl * 0.3, (ny + hy) / 2, nz * 0.6),
        size: vec3(high * 0.2, Math.abs(ny - hy) + high * 0.18, nz * 0.8),
        sweep: 0.1, color: p.trim,
      });
      nacelle(m, p, { x: nx, y: ny, z: nz, length: nl, radius: b.nacelleRadius ?? high * 0.15 });
    });
  },

  /**
   * No saucer at all — the Defiant and the Danube runabout.
   *
   * One body with the nacelles buried in it rather than hung off pylons. The
   * Defiant is a warship built as a single wedge; a runabout is a box with two
   * engines on it. Both are proportionally squat, which is why they are the
   * two classes whose hand-tuned proportions were nearly right to begin with.
   */
  compact(mb, p, b) {
    const wide = b.ratioBeam ?? 0.7;
    const high = b.ratioHeight ?? 0.19;
    // The sweep adds its own displacement to the length, so the box is built
    // shorter than the ship: 0.78 plus a 0.23 rake is the one unit every
    // other hull here spans.
    const bl = b.bodyLength ?? 0.78;
    const bh = b.bodyHeight ?? high * 0.86;
    const bw = b.bodyWidth ?? wide;

    // Built as two mirrored halves rather than one box.
    //
    // `sweep` displaces only the +z face, so a full-width box with a sweep on
    // it is a RHOMBUS — the port side raked aft and the starboard side square,
    // which is what a Defiant looked like from above until somebody drew it in
    // plan. A half-width box mirrored is the symmetric wedge the ship is.
    mirrored(mb, (m) => {
      box(m, {
        center: vec3(0, 0, bw / 4),
        size: vec3(bl, bh, bw / 2),
        sweep: b.bodySweep ?? bl * 0.3,
        color: p.hull,
      });
    });
    box(mb, {
      center: vec3(bl * 0.1, bh * 0.72, 0),
      size: vec3(bl * 0.3, high * 0.26, bw * 0.38),
      color: p.trim,
    });
    sphere(mb, {
      origin: vec3(bl * 0.46, -high * 0.06, 0),
      radius: high * 0.24, segments: 8, rings: 5,
      color: p.dish ?? p.glow,
    });

    // Part of the body rather than hung off it, which is the whole point of
    // the class — but riding its upper surface, not buried inside it. Sunk
    // level with the hull they were invisible, and a Defiant with no visible
    // engines is a grey wedge.
    mirrored(mb, (m) => {
      nacelle(m, p, {
        x: b.nacelleX ?? -0.46,
        y: b.nacelleY ?? bh * 0.5,
        z: b.nacelleZ ?? bw * 0.3,
        length: b.nacelleLength ?? bl * 0.72,
        radius: b.nacelleRadius ?? bh * 0.44,
      });
    });
  },
};
