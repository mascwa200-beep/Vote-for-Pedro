// The other nine hulls the player fights.
//
// The Klingon fleet's finding, repeated for everybody else. Five classes were
// built by `wedge` — a Galor, a Keldon, two Jem'Hadar ships and a Tholian web
// spinner — which is one armoured slab with a coloured ball floating off the
// nose, drawn five times in five colours. Two more were built by `warbird`: a
// D'deridex and a Ferengi D'Kora, which have nothing whatever in common.
//
// A Jem'Hadar attack ship drawn as a Cardassian cruiser is not a detail gap.
// It is the wrong species. The Dominion did not build Cardassian hulls; it
// conquered the people who did.
//
// Three things were wrong with all seven and are fixed here:
//
//   THE SENSOR BALL FLOATED. `wedge` put a lit sphere at x = 0.55 on a hull
//   whose own forward face is at 0.5 of `length_` — measured on the built
//   mesh, four of the five had a horizontal slice with nothing in it at all,
//   which is a hole through the ship. A bow sensor is set INTO the hull.
//
//   NOBODY WAS ABOARD. Not one lit port on any of the seven, against thirteen
//   Federation classes that all have them. A Galor carries three hundred.
//
//   THEY WERE FLAT. A slab has one silhouette. Ventral wings, a raised
//   deckhouse and a run of machinery along the spine give it five, which is
//   what the eye reads at tactical range where nothing else survives.
//
// Coordinate convention, matching mesh.js and the simulation: +x is the bow,
// +y is dorsal, +z is starboard. `mirrored` builds the starboard half and
// reflects it, so everything below is written for one side only.
//
// `length_`, not `length`. `length` is METRES and is read by `hullScale`; this
// is the hull's proportion in unit space. Reading the wrong one once built a
// Galor 372 units long inside a 2,600-unit engagement volume.

import { vec3 } from './math.js';
import { tube, box, prow, sphere, mirrored, seg, greebles, windowBelt, portRow } from './mesh.js';

/** A bank of lit ports across a stern. What says a ship is under power. */
function engineBank(mb, p, { x, y = 0, spread, size, count = 3 }) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    box(mb, {
      center: vec3(x, y, t * spread),
      size: vec3(size * 0.5, size, size * 1.1),
      color: p.glow,
      glow: 1,
    });
  }
  return mb;
}

/**
 * A row of lit ports down one flank, at a radius the caller has measured
 * against the thing they sit on.
 *
 * Every port placement that went wrong on the Klingon hulls went wrong the same
 * way — a belt at a fraction of the surface's half-width is a row of lights
 * inside it. `r` is the distance from the centreline the ports actually sit at
 * and the caller is expected to have taken it from the geometry, not guessed.
 */
function flankPorts(mb, { x, length: len, r, y = 0, count = 2, arc = Math.PI * 0.18 }) {
  for (const centre of [Math.PI * 0.5, Math.PI * 1.5]) {
    windowBelt(mb, {
      origin: vec3(0, y, 0),
      x,
      r0: r,
      r1: r,
      count: seg(count),
      arc,
      phase: centre - arc / 2,
      length: len,
      fill: 0.5,
    });
  }
  return mb;
}

export const HOSTILE_FORMS = {
  /**
   * A Cardassian cruiser: the Galor and the Keldon.
   *
   * Broad raked head forward, a narrower spine, ventral wings swept down and
   * back, and the engine across the stern. What made the old form read as a
   * doorstop was that all of it was in one plane — the wings were the same slab
   * as the hull, so from any angle there was one shape.
   */
  wedge(mb, p, b) {
    // The published beam and height, as fractions of a hull built to span one
    // unit fore and aft — the same convention as every other form in the game.
    // This form used to carry its own `width` and `height` in unit space,
    // duplicating figures DIMENSIONS already holds, and both copies were wrong:
    // a Galor came out 1.28x too wide and 1.32x too tall.
    const len = b.length_ ?? 1.3;
    const high = (b.ratioHeight ?? 0.16) * len;
    const wide = (b.ratioBeam ?? 0.52) * len * 0.5;

    // The spine: the long central mass, tapering aft.
    //
    // `prow`, not `box`. A swept centreline box is a parallelogram seen from
    // above — see the note on the primitive; a Galor measured sixteen percent
    // lopsided and its nose was a fifth of the ship behind its own sensor dome.
    prow(mb, {
      center: vec3(-len * 0.06, 0, 0),
      size: vec3(len * 0.78, high * 0.9, wide * 0.9),
      sweep: b.sweep ?? 0.3,
      color: p.hull,
    });
    // The head: broad, flat and raked, and the reason a Galor is recognisable
    // head-on. Wider than the spine, not narrower.
    // The rake is 0.9 of `sweep`, not 1.5. At 1.5 the head's outboard face was
    // carried forty percent of the ship's length aft, so it lay OVER the spine
    // amidships and any port on the spine's shoulder was a light behind the
    // bow section: measured, ports reaching z=0.171 under a head reaching
    // z=0.244 at the same station.
    prow(mb, {
      center: vec3(len * 0.36, -high * 0.06, 0),
      size: vec3(len * 0.3, high * 0.44, wide * 1.5),
      sweep: (b.sweep ?? 0.3) * 0.9,
      color: p.hull,
    });
    // The Keldon's forward hull extension: the class is a Galor with a longer
    // bow section and dorsal pods, and without it the two measured 0.183 apart
    // on the shape fingerprint against a bar of 0.2. Proportion cannot separate
    // them — 372 by 192 by 59 against 400 by 208 by 64 is the same ship eight
    // percent bigger — so the difference has to be built.
    if (b.nose) {
      prow(mb, {
        center: vec3(len * 0.56, -high * 0.1, 0),
        size: vec3(len * 0.22, high * 0.34, wide * 0.8),
        sweep: (b.sweep ?? 0.3) * 1.8,
        color: p.trim,
      });
      greebles(mb, {
        from: vec3(len * 0.46, high * 0.06, 0),
        to: vec3(len * 0.64, high * 0.02, 0),
        count: 3,
        size: vec3(len * 0.05, high * 0.16, wide * 0.24),
        color: p.hull,
        lit: p.glow,
        litEvery: 3,
      });
    }

    // The bow sensor, SET INTO the head rather than hung off the front of it.
    // At x = 0.55 on a hull whose forward face is at 0.5·length_ this was a ball
    // in clear space ahead of the ship, and the hull measured as two objects.
    const bowX = b.nose ? len * 0.67 : len * 0.51;
    sphere(mb, {
      origin: vec3(bowX - high * 0.45, -high * 0.06, 0),
      radius: high * 0.52,
      segments: seg(8),
      rings: 5,
      color: p.glow,
      glow: 1,
    });

    // The raised aft deckhouse and the machinery along it.
    prow(mb, {
      center: vec3(-len * 0.26, high * 0.48, 0),
      size: vec3(len * 0.34, high * 0.34, wide * 0.62),
      sweep: 0.04,
      color: p.trim,
    });
    greebles(mb, {
      from: vec3(-len * 0.42, high * 0.6, 0),
      to: vec3(len * 0.08, high * 0.4, 0),
      count: b.spineCount ?? 6,
      size: vec3(len * 0.07, high * 0.16, wide * 0.34),
      color: p.trim,
      lit: p.glow,
      litEvery: 3,
    });

    mirrored(mb, (m) => {
      // The ventral wings, hanging BELOW the hull rather than lying in it.
      box(m, {
        center: vec3(-len * 0.04, -high * 0.22, wide * 0.78),
        size: vec3(len * 0.62, high * 0.2, wide * 0.9),
        sweep: (b.sweep ?? 0.3) * 1.2,
        dip: high * 0.22,
        color: p.hull,
      });
      // A lit seam along the top of each wing, where it meets the hull. On the
      // OUTSIDE of the spine, so it is a light and not a light behind a wall.
      box(m, {
        center: vec3(len * 0.02, high * 0.06, wide * 0.47),
        size: vec3(len * 0.5, high * 0.14, wide * 0.03),
        sweep: (b.sweep ?? 0.3) * 0.4,
        color: p.glow,
        glow: 0.75,
      });
      // Dorsal pods: the one structural thing that separates a Keldon from a
      // Galor, which are otherwise the same ship eight percent apart.
      if (b.pods) {
        tube(m, {
          origin: vec3(-len * 0.4, high * 0.85, wide * 0.42),
          length: len * 0.56,
          r0: high * 0.26,
          r1: high * 0.2,
          segments: seg(8),
          color: p.trim,
        });
        box(m, {
          center: vec3(-len * 0.42, high * 0.85, wide * 0.42),
          size: vec3(len * 0.04, high * 0.26, high * 0.44),
          color: p.glow,
          glow: 1,
        });
      }
    });

    // Ports along the spine's shoulder, clear of the wings below them.
    if (b.windows !== false) {
      // Aft of the head's rake and above the wings: the one band on a
      // Cardassian hull with a clear line to the outside.
      flankPorts(mb, {
        x: -len * 0.36,
        length: len * 0.22,
        r: wide * 0.52,
        y: high * 0.32,
        count: 3,
        // A narrow arc, because the band a port can occupy on this hull is
        // narrow: the head's raked outboard face reaches up to 0.16 of the
        // height and the dorsal pods start at 0.59 of it, and a wider arc puts
        // the ends of the row behind one or the other.
        arc: Math.PI * 0.1,
      });
    }

    engineBank(mb, p, {
      x: -len * 0.46,
      spread: wide * 0.5,
      size: high * 0.34,
      count: b.engines ?? 3,
    });
  },

  /**
   * A Dominion warship: the Jem'Hadar attack ship and the battleship.
   *
   * Both were Cardassian slabs. They are beetles — a body broad and blunt
   * astern, tapering to a point forward, with two prongs reaching ahead of it
   * and nothing on them but the ship's own colour. The published beam is 0.73
   * of the length on the attack ship, which is the widest ratio outside a
   * Bird-of-Prey and is the whole silhouette.
   */
  dominion(mb, p, b) {
    const len = b.length_ ?? 1.0;
    const high = (b.ratioHeight ?? 0.15) * len;
    const wide = (b.ratioBeam ?? 0.7) * len * 0.5;

    // The carapace: widest and deepest astern, drawn to a point forward.
    //
    // An ellipsoid, not a tube. A tube is round in y and z together, so a
    // carapace wide enough to be a Jem'Hadar ship was also as tall as it was
    // wide — which measured 4.2x the published height and left the normaliser
    // flattening the whole hull, prongs and all, to a quarter of what it built.
    sphere(mb, {
      origin: vec3(-len * 0.06, 0, 0),
      // Unit radius with the three half-axes given outright, which is the
      // legible way to write an ellipsoid and the way that cannot be off by a
      // factor of the beam.
      radius: 1,
      segments: seg(9),
      rings: 6,
      scale: vec3(len * 0.46, high * 0.42, wide * 0.92),
      color: p.hull,
    });
    // A raised dorsal ridge along its back.
    greebles(mb, {
      from: vec3(-len * 0.3, high * 0.34, 0),
      to: vec3(len * 0.24, high * 0.22, 0),
      count: b.ridgeCount ?? 5,
      size: vec3(len * 0.1, high * 0.4, wide * 0.3),
      color: p.trim,
      lit: p.glow,
      litEvery: 3,
    });

    // Flank armour, and the head at the front of it.
    //
    // The carapace was one bare ellipsoid in one flat colour — a Jem'Hadar
    // attack ship is a beetle, and a beetle that is a single smooth shell reads
    // as a pebble. The plates run the length of the flank on both sides and
    // break the silhouette where the light falls off; the blister forward is
    // the crew's, and gives the eye somewhere to find the front of the ship.
    mirrored(mb, (m) => {
      greebles(m, {
        from: vec3(-len * 0.28, -high * 0.06, wide * 0.62),
        to: vec3(len * 0.26, -high * 0.02, wide * 0.5),
        count: b.ridgeCount ?? 5,
        size: vec3(len * 0.11, high * 0.26, wide * 0.18),
        vary: 0.5,
        color: p.trim,
      });
    });
    box(mb, {
      center: vec3(len * 0.3, high * 0.2, 0),
      size: vec3(len * 0.2, high * 0.3, wide * 0.44),
      sweep: 0.16,
      rake: -0.1,
      color: p.trim,
    });

    mirrored(mb, (m) => {
      // The prongs, reaching forward of the body and angled inward, which is
      // what a Jem'Hadar ship is: a pair of jaws with an engine behind them.
      box(m, {
        center: vec3(len * 0.34, -high * 0.05, wide * 1.0),
        size: vec3(len * 0.46, high * 0.5, wide * 0.32),
        sweep: -(b.prongSweep ?? 0.14),
        color: p.hull,
      });
      // The weapon at each prong tip.
      box(m, {
        center: vec3(len * 0.54, -high * 0.05, wide * 0.94),
        size: vec3(len * 0.06, high * 0.24, wide * 0.12),
        color: p.glow,
        glow: 1,
      });
      // A second, shorter pair on the battleship, and turrets along its back.
      if (b.heavy) {
        box(m, {
          center: vec3(len * 0.06, high * 0.28, wide * 1.16),
          size: vec3(len * 0.5, high * 0.34, wide * 0.24),
          sweep: -(b.prongSweep ?? 0.14) * 0.5,
          color: p.trim,
        });
      }
    });

    if (b.windows !== false) {
      // On the shoulder of the carapace, above the prongs. The prongs run
      // alongside the body at the same height for two thirds of its length,
      // and ports on the beam would be ports behind them.
      flankPorts(mb, {
        x: -len * 0.24,
        length: len * 0.28,
        r: wide * 0.96,
        count: 3,
        arc: Math.PI * 0.16,
      });
    }

    engineBank(mb, p, {
      x: -len * 0.44,
      spread: wide * 0.34,
      size: high * 0.26,
      count: b.engines ?? 3,
    });
  },

  /**
   * A Tholian vessel: a crystal, not a hull.
   *
   * The one design in the game where "faceted" is the correct answer rather
   * than a compromise — a Tholian ship is a mineral, and a low-poly sphere with
   * five segments and three rings IS a crystal. It was drawn as a Cardassian
   * cruiser in pink.
   */
  tholian(mb, p, b) {
    const len = b.length_ ?? 0.9;
    const high = (b.ratioHeight ?? 0.2) * len;
    const r = (b.ratioBeam ?? 0.74) * len * 0.5;

    // The body: deliberately under-tessellated, so the facets are the look,
    // and FLAT — a crystal built round forced the whole ship through a 2.6x
    // squash to reach its published 26 metres of height on 130 of length.
    sphere(mb, {
      origin: vec3(-len * 0.1, 0, 0),
      radius: 1,
      segments: 5,
      rings: 3,
      scale: vec3(len * 0.4, high * 0.4, r),
      color: p.hull,
      banding: 0.3,
    });
    // A forward point, so it has a bow.
    prow(mb, {
      center: vec3(len * 0.36, 0, 0),
      size: vec3(len * 0.42, high * 0.5, r * 0.9),
      sweep: r * 0.5,
      color: p.trim,
    });

    // Secondary facets, above and below the main body. A crystal is a cluster,
    // and one lozenge with four spars on it is a lozenge with four spars on it.
    for (const [dx, sy, k] of [[0, 1, 1], [0, -1, 1], [-0.26, 1, 0.7], [0.2, -1, 0.7]]) {
      sphere(mb, {
        origin: vec3(len * (dx - 0.02), sy * high * 0.3, 0),
        radius: 1,
        segments: 5,
        rings: 3,
        scale: vec3(len * 0.26 * k, high * 0.24, r * 0.56 * k),
        color: p.trim,
        banding: 0.25,
      });
    }
    greebles(mb, {
      from: vec3(-len * 0.3, high * 0.44, 0),
      to: vec3(len * 0.18, high * 0.34, 0),
      count: 4,
      size: vec3(len * 0.08, high * 0.2, r * 0.3),
      color: p.hull,
      lit: p.glow,
      litEvery: 4,
    });

    // The spinners: four arms carrying the emitters that make the web. Angled
    // out of the body's own plane, because a flat cross reads as a decal.
    mirrored(mb, (m) => {
      for (const sy of [1, -1]) {
        box(m, {
          center: vec3(-len * 0.24, sy * high * 0.24, r * 0.72),
          size: vec3(len * 0.4, high * 0.22, r * 0.18),
          sweep: r * 0.5,
          color: p.trim,
        });
        box(m, {
          center: vec3(-len * 0.42, sy * high * 0.34, r * 0.98),
          size: vec3(r * 0.16, high * 0.28, r * 0.2),
          color: p.glow,
          glow: 1,
        });
      }
    });

    // Lit seams along the crystal's own edges. A Tholian ship glows from
    // inside; that is the only light there is on it.
    if (b.windows !== false) {
      flankPorts(mb, {
        x: -len * 0.16,
        length: len * 0.2,
        r: r * 1.02,
        count: 3,
        arc: Math.PI * 0.22,
      });
    }
    engineBank(mb, p, {
      x: -len * 0.5,
      spread: r * 0.26,
      size: high * 0.36,
      count: b.engines ?? 2,
    });
  },

  /**
   * A D'deridex warbird: two great arms meeting fore and aft around an open
   * centre, with the command head slung between them.
   *
   * The shape was right and the execution was two flat slabs. An arm that
   * SWEEPS is three segments stepping outward and back, which is the difference
   * between a curve and a plank, and the open space between them is the whole
   * point of the class.
   */
  warbird(mb, p, b) {
    const span = b.wingSpan ?? 0.58;
    const high = b.ratioHeight ?? 0.3;

    // The central spine, between the arms.
    tube(mb, {
      origin: vec3(-0.18, 0, 0),
      length: 0.46,
      r0: high * 0.42,
      r1: high * 0.32,
      segments: seg(10),
      color: p.trim,
    });
    // The command head, forward and low, with a lit sensor set into its nose.
    box(mb, {
      center: vec3(0.42, -high * 0.12, 0),
      size: vec3(0.3, high * 0.5, span * 0.34),
      sweep: 0.1,
      color: p.hull,
    });
    sphere(mb, {
      origin: vec3(0.54, -high * 0.12, 0),
      radius: high * 0.3,
      segments: seg(9),
      rings: 5,
      color: p.glow,
      glow: 1,
    });

    // Where the arm's own surfaces are at a given fraction of the span, so
    // everything mounted on one is placed AGAINST it rather than guessed. The
    // arm runs from 0.22 of the span to 0.9 of it, and `dip` carries its
    // outboard end back toward the centreline as it goes — so its top is
    // twenty percent of the ship's height lower at the tip than at the root,
    // and a fitting at a constant y is on the surface at one end and inside it
    // at the other.
    const ARM_IN = 0.22;
    const ARM_OUT = 0.9;
    const drop = (u) => ((u - ARM_IN) / (ARM_OUT - ARM_IN)) * high * 0.34;
    const armTop = (u) => high * 0.625 - drop(u);
    const armBottom = (u) => high * 0.375 - drop(u);

    mirrored(mb, (m) => {
      for (const sy of [1, -1]) {
        // One arm each side, above and below, CONVERGING outboard: `dip`
        // brings the upper arm's tip down and the lower arm's tip up, which is
        // what closes the class's outline into a bird and is the thing a pair
        // of flat planks could never do.
        box(m, {
          center: vec3(0.0, sy * high * 0.5, span * 0.56),
          size: vec3(0.9, high * 0.25, span * 0.68),
          sweep: 0.26,
          dip: sy * high * 0.34,
          color: p.hull,
        });
        // The arm's leading edge, raked the other way, which is what gives the
        // class its wing shape from above.
        box(m, {
          center: vec3(0.34, sy * high * 0.5, span * 0.5),
          size: vec3(0.3, high * 0.22, span * 0.56),
          sweep: -0.24,
          dip: sy * high * 0.3,
          color: p.hull,
        });
        // Machinery ON the arm's outer surface, following it down.
        greebles(m, {
          from: vec3(-0.24, sy * (armTop(0.3) - high * 0.04), span * 0.3),
          to: vec3(0.28, sy * (armTop(0.44) - high * 0.04), span * 0.44),
          count: 4,
          size: vec3(0.1, high * 0.14, span * 0.1),
          color: p.trim,
          lit: p.glow,
          litEvery: 3,
        });
        // A lit seam just under the arm's INBOARD face, which is the surface a
        // ship being fought from ahead looks straight at through the gap.
        box(m, {
          center: vec3(0.0, sy * (armBottom(0.36) - high * 0.05), span * 0.36),
          size: vec3(0.9, high * 0.06, span * 0.03),
          color: p.glow,
          glow: 0.7,
        });
      }
      // The outboard edge where the two arms meet, closing the loop.
      box(m, {
        center: vec3(-0.02, 0, span * 0.94),
        size: vec3(0.62, high * 0.72, span * 0.14),
        color: p.trim,
      });
    });

    // Ports ON THE ARMS, and as boxes rather than a belt.
    //
    // The arms enclose the spine and the head from every direction — measured,
    // ports on the spine reached z=0.144 inside arms reaching z=0.393, and
    // moving them to the head only put them behind the arms' leading edge
    // instead. The one surface on a D'deridex a light can be seen from is the
    // outer face of an arm, and a ring about the x axis cannot lie on one.
    if (b.windows !== false) {
      mirrored(mb, (m) => {
        for (const sy of [1, -1]) {
          portRow(m, {
            from: vec3(-0.2, sy * (armTop(0.4) + high * 0.09), span * 0.4),
            to: vec3(0.24, sy * (armTop(0.75) + high * 0.09), span * 0.75),
            count: 4,
            size: high * 0.1,
          });
        }
      });
    }

    engineBank(mb, p, {
      x: -0.22,
      spread: span * 0.24,
      size: high * 0.26,
      count: b.engines ?? 3,
    });
  },

  /**
   * A Ferengi D'Kora: a flat crescent with two forward horns and the drive
   * astern.
   *
   * It was a D'deridex. The two share a faction slot in the encounter tables
   * and nothing else — a Marauder is 366 metres to a warbird's 1,041, and it is
   * a merchant hull with guns bolted on rather than a warship built round an
   * artificial quantum singularity.
   */
  marauder(mb, p, b) {
    const wide = b.ratioBeam ?? 0.64;
    const high = b.ratioHeight ?? 0.28;

    // The body: a broad flat disc-section, deepest amidships.
    tube(mb, {
      origin: vec3(-0.34, 0, 0),
      length: 0.6,
      r0: high * 0.5,
      r1: high * 0.7,
      segments: seg(10),
      color: p.hull,
    });
    // The bridge module on top, and the cargo bay under it — this is a trading
    // ship, and the hold is most of it.
    box(mb, {
      center: vec3(0.06, high * 0.58, 0),
      size: vec3(0.34, high * 0.3, wide * 0.3),
      color: p.trim,
    });
    box(mb, {
      center: vec3(-0.12, -high * 0.46, 0),
      size: vec3(0.5, high * 0.3, wide * 0.44),
      color: p.trim,
    });

    mirrored(mb, (m) => {
      // The horns: two great forward-swept arms that make the crescent.
      box(m, {
        center: vec3(0.18, 0, wide * 0.34),
        size: vec3(0.5, high * 0.44, wide * 0.4),
        sweep: -0.24,
        color: p.hull,
      });
      box(m, {
        center: vec3(0.44, 0, wide * 0.56),
        size: vec3(0.42, high * 0.36, wide * 0.22),
        sweep: -0.3,
        color: p.hull,
      });
      // The gun at each horn's tip, which is what the class is feared for.
      box(m, {
        center: vec3(0.68, 0, wide * 0.6),
        size: vec3(0.08, high * 0.2, wide * 0.12),
        color: p.glow,
        glow: 1,
      });
      // Machinery down the outboard face of the hull.
      greebles(m, {
        from: vec3(-0.28, high * 0.1, wide * 0.2),
        to: vec3(0.12, high * 0.1, wide * 0.26),
        count: 4,
        size: vec3(0.09, high * 0.22, wide * 0.1),
        color: p.trim,
        lit: p.glow,
        litEvery: 3,
      });
    });

    // Cargo modules along the spine. A D'Kora is a merchant hull first, and
    // the containers are most of what is on it.
    greebles(mb, {
      from: vec3(-0.3, high * 0.5, 0),
      to: vec3(0.2, high * 0.42, 0),
      count: 5,
      size: vec3(0.1, high * 0.26, wide * 0.22),
      color: p.hull,
      lit: p.glow,
      litEvery: 4,
    });
    mirrored(mb, (m) => {
      greebles(m, {
        from: vec3(-0.3, -high * 0.36, wide * 0.16),
        to: vec3(0.1, -high * 0.34, wide * 0.2),
        count: 3,
        size: vec3(0.11, high * 0.22, wide * 0.14),
        vary: 0.25,
        color: p.trim,
      });
    });

    if (b.windows !== false) {
      flankPorts(mb, {
        x: -0.02,
        length: 0.22,
        r: high * 0.78,
        count: 3,
        arc: Math.PI * 0.2,
      });
    }
    engineBank(mb, p, {
      x: -0.36,
      spread: wide * 0.2,
      size: high * 0.3,
      count: b.engines ?? 2,
    });
  },

  /**
   * A Borg cube.
   *
   * It stays a cube — its published figures are equal on all three axes, and
   * "literally a cube" was the right call. What was wrong was the clutter: a
   * trigonometric walk placed fourteen boxes at 0.36 of the half-extent in x
   * and y, which is INSIDE the cube, so ten of the fourteen were paid for and
   * could not be seen. Measured, 22% of the hull's faces were buried.
   *
   * Structures now sit ON the six faces, in a lattice, with conduits running
   * between them: a cube has no silhouette to read and no lighting to model
   * it, so the surface is the whole of the design.
   *
   * The asymmetry is deliberate and a test asserts it stays. A Borg vessel is
   * accreted rather than laid down, and it is the one hull in the fleet that
   * should not be the same on both sides.
   */
  cube(mb, p, b) {
    const s = b.size ?? 1.1;
    const h = s / 2;
    box(mb, { center: vec3(), size: vec3(s, s, s), color: p.hull });

    // Six faces, each with its own lattice. `axis` is the face normal and the
    // two others are the plane it is laid out in.
    const FACES = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
    let n = 0;
    for (const [axis, dir] of FACES) {
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          n++;
          // Deterministic, and deliberately not a grid: two of every nine
          // cells are left empty and the sizes vary, so the face reads as
          // machinery rather than as tiling.
          const k = ((n * 2654435761) >>> 0) / 4294967296;
          if (k < 0.22) continue;
          const centre = [0, 0, 0];
          centre[axis] = dir * h * 0.94;
          centre[u] = (i - 1) * s * 0.3;
          centre[v] = (j - 1) * s * 0.3;
          const size = [0, 0, 0];
          size[axis] = s * (0.06 + k * 0.1);
          size[u] = s * (0.1 + k * 0.14);
          size[v] = s * (0.1 + (1 - k) * 0.14);
          const lit = k > 0.92;
          box(mb, {
            center: vec3(centre[0], centre[1], centre[2]),
            size: vec3(size[0], size[1], size[2]),
            color: lit ? p.glow : p.trim,
            glow: lit ? 1 : 0,
          });
        }
      }
      // A conduit across the face, lit. The green is the only thing on a cube
      // that says it is powered.
      const bar = [0, 0, 0];
      bar[axis] = dir * h * 0.99;
      const bs = [0, 0, 0];
      bs[axis] = s * 0.025;
      bs[u] = s * 0.86;
      bs[v] = s * 0.028;
      box(mb, {
        center: vec3(bar[0], bar[1], bar[2]),
        size: vec3(bs[0], bs[1], bs[2]),
        color: p.glow,
        glow: 1,
      });
    }
  },

  /**
   * An organic vessel: three curved prongs reaching forward off a spined body,
   * with the drive burning inside it.
   *
   * It was a Borg cube. Normalised to its own bounding box, the two measured
   * ZERO apart on an occupancy grid — the same object, squashed to 600 by 420
   * by 200 instead of three kilometres cubed. Everything the class data says
   * about it says it is not a Borg ship: a crew of one, a hull that regenerates
   * a hundred and twenty a second, weapons that adapt within seconds, and a
   * bioplasmic discharge for a beam.
   *
   * No lit ports, and that is not an omission: a vessel with one occupant and
   * no decks has nowhere to put a window. What it has instead is a core that
   * shows through the gaps between the prongs, which is the same job — it says
   * the thing is alive and under way.
   */
  bioship(mb, p, b) {
    const high = b.ratioHeight ?? 0.33;
    const wide = b.ratioBeam ?? 0.7;

    // The body: an ellipsoid drawn out fore and aft, heaviest astern.
    sphere(mb, {
      origin: vec3(-0.12, 0, 0),
      radius: 1,
      segments: seg(9),
      rings: 6,
      scale: vec3(0.4, high * 0.62, wide * 0.6),
      color: p.hull,
      banding: 0.22,
    });
    // The core, burning inside it and visible between the prongs.
    sphere(mb, {
      origin: vec3(-0.04, 0, 0),
      radius: 1,
      segments: seg(7),
      rings: 4,
      scale: vec3(0.14, high * 0.2, wide * 0.24),
      color: p.glow,
      glow: 1,
    });
    // A ridged dorsal spine, which is what makes it read as grown rather than
    // built at all sizes.
    greebles(mb, {
      from: vec3(-0.4, high * 0.5, 0),
      to: vec3(0.14, high * 0.34, 0),
      count: b.spineCount ?? 6,
      size: vec3(0.09, high * 0.3, wide * 0.16),
      vary: 0.45,
      color: p.trim,
      lit: p.glow,
      litEvery: 4,
    });

    // Three prongs: a pair reaching forward and out, and one on the spine.
    // Each is two segments so it CURVES, which a single box cannot do and is
    // the whole silhouette of the class.
    mirrored(mb, (m) => {
      box(m, {
        center: vec3(0.24, -high * 0.06, wide * 0.42),
        size: vec3(0.44, high * 0.24, wide * 0.24),
        sweep: -0.1,
        dip: high * 0.12,
        color: p.hull,
      });
      box(m, {
        center: vec3(0.5, -high * 0.2, wide * 0.5),
        size: vec3(0.3, high * 0.18, wide * 0.18),
        sweep: 0.14,
        dip: high * 0.16,
        color: p.trim,
      });
      // The tip, lit: this is where a bioplasmic discharge comes from.
      box(m, {
        center: vec3(0.64, -high * 0.3, wide * 0.46),
        size: vec3(0.1, high * 0.12, wide * 0.12),
        color: p.glow,
        glow: 1,
      });
    });
    box(mb, {
      center: vec3(0.26, high * 0.44, 0),
      size: vec3(0.46, high * 0.22, wide * 0.2),
      rake: 0.12,
      color: p.hull,
    });
    box(mb, {
      center: vec3(0.52, high * 0.54, 0),
      size: vec3(0.26, high * 0.15, wide * 0.14),
      color: p.trim,
    });
    box(mb, {
      center: vec3(0.66, high * 0.58, 0),
      size: vec3(0.08, high * 0.1, wide * 0.07),
      color: p.glow,
      glow: 1,
    });
  },
};
