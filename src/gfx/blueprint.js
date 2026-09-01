// Ship geometry, as data.
//
// Thirty-one classes, thirty-one short records. Nobody modelled a hull here;
// each entry is a set of proportions that the primitives in mesh.js turn into a
// mesh, which is the only way one person builds a fleet without an art team.
//
// The proportions come from docs/RESEARCH.md, and the numbers there produced
// two decisions that shape this whole file:
//
//   Beam-to-length ratio is the species signature. Federation saucer ships run
//   0.35–0.73. A Klingon Bird-of-Prey is *wider than it is long* with its wings
//   down, which is why `wings` exists as a primitive and Federation hulls have
//   no use for it.
//
//   Height is 0.1–0.25 of length on every class in the table. Ships are discs
//   and wedges. Nothing here is as tall as it is wide, and a blueprint that
//   tries to be will look wrong before you can say why.
//
// Lengths below are in metres and are used for relative scale only; the
// renderer normalises so the largest live hull frames sensibly.

import { vec3 } from './math.js';
import { MeshBuilder, saucer, tube, box, sphere, mirrored } from './mesh.js';
import { FEDERATION_FORMS } from './forms.federation.js';

/** Hull plating by faction. Flat shading means these are the whole look. */
export const PALETTE = {
  // Warm off-white, not refit grey. The 1966 miniature photographed as a
  // cream-white hull with darker grey detailing; [0.74, 0.77, 0.82] is the
  // cool grey of the 1979 film refit, which is a different ship.
  federation: {
    hull: [0.82, 0.81, 0.77], trim: [0.56, 0.57, 0.60], glow: [0.45, 0.72, 1.0],
    dish: [0.85, 0.55, 0.25],   // the copper deflector
  },
  klingon: { hull: [0.42, 0.48, 0.44], trim: [0.28, 0.33, 0.30], glow: [0.95, 0.35, 0.25] },
  romulan: { hull: [0.44, 0.50, 0.44], trim: [0.30, 0.40, 0.32], glow: [0.55, 0.95, 0.60] },
  cardassian: { hull: [0.68, 0.62, 0.44], trim: [0.48, 0.43, 0.30], glow: [0.95, 0.75, 0.35] },
  ferengi: { hull: [0.66, 0.48, 0.26], trim: [0.45, 0.32, 0.18], glow: [0.98, 0.66, 0.24] },
  orion: { hull: [0.40, 0.52, 0.36], trim: [0.26, 0.36, 0.24], glow: [0.60, 0.95, 0.40] },
  tholian: { hull: [0.78, 0.42, 0.58], trim: [0.55, 0.28, 0.42], glow: [1.0, 0.45, 0.70] },
  dominion: { hull: [0.48, 0.44, 0.52], trim: [0.32, 0.30, 0.38], glow: [0.72, 0.60, 1.0] },
  borg: { hull: [0.32, 0.34, 0.33], trim: [0.20, 0.22, 0.21], glow: [0.40, 1.0, 0.45] },
  independent: { hull: [0.60, 0.58, 0.55], trim: [0.40, 0.39, 0.37], glow: [0.85, 0.85, 0.80] },
};

export const paletteFor = (faction) => PALETTE[faction] ?? PALETTE.independent;

/**
 * Hull archetypes. `build` receives a MeshBuilder, the palette, and the
 * blueprint's own parameters.
 */
const FORMS = {
  // The Federation silhouettes that this file's own `starfleet` cannot make —
  // no secondary hull, two hulls, four nacelles, no saucer. See
  // src/gfx/forms.federation.js and docs/RESEARCH.md §14.
  ...FEDERATION_FORMS,

  /**
   * Saucer, secondary hull, and two nacelles on pylons. The Federation
   * silhouette, and the reason the saucer primitive gets the most segments.
   */
  starfleet(mb, p, b) {
    // Proportions come from the published beam and height, not from taste.
    //
    // Every number below used to be a hand-tuned constant, and measured
    // against the figures in DIMENSIONS they were not close: this form drew a
    // saucer 0.72 of the hull's length across when a Constitution's is 0.44,
    // and stood the ship twice as tall as it is. `wide` and `high` are the
    // published beam and height as fractions of length, and the hull is built
    // to span one unit fore-and-aft, so they are directly usable as sizes.
    const wide = b.ratioBeam ?? 0.45;
    const high = b.ratioHeight ?? 0.25;
    // For a two-nacelle Starfleet cruiser the beam IS the saucer: the nacelles
    // sit inboard of the rim on every one of them.
    const sr = b.saucerRadius ?? wide / 2;
    const stretch = b.saucerStretch ?? 1;
    const sx = b.saucerX ?? 0.5 - sr * stretch;
    saucer(mb, {
      origin: vec3(sx, b.saucerY ?? 0, 0),
      radius: sr,
      thickness: b.saucerThickness ?? high * 0.2,
      domeRatio: b.domeRatio ?? 0.34,
      // `domeFlat` is how tall the dome is as a share of the ship's height, so
      // the refit's famously flat-topped saucer stays flat at any size.
      domeHeight: b.domeHeight ?? high * (b.domeFlat ?? 0.16),
      // A Constitution's saucer is a circle. A Galaxy's is an ovoid, a
      // Sovereign's a raked ellipse, an Excelsior's an elongated disc — and
      // this primitive could only make circles, so all three were drawn as the
      // one shape they are not.
      stretch,
      segments: b.segments ?? 22,
      color: p.hull,
      rimColor: p.trim,
    });

    const hy = b.hullY ?? -high * 0.42;
    if (b.neck !== false) {
      box(mb, {
        center: vec3(sx - sr * 0.5, hy / 2, 0),
        size: vec3(sr * 0.5, Math.abs(hy) + high * 0.2, high * 0.36),
        color: p.trim,
      });
    }

    // The secondary hull, tapering aft. `hullThick` is how heavy it is for the
    // ship's height — an Intrepid's is famously slight, a Galaxy's is most of
    // the vessel — and `hullReach` how far forward it runs under the saucer.
    const thick = b.hullThick ?? 1;
    tube(mb, {
      origin: vec3(-0.5, hy, 0),
      length: b.hullLength ?? 0.5 + sx * (b.hullReach ?? 0.85),
      r0: b.hullR0 ?? high * 0.17 * thick,
      r1: b.hullR1 ?? high * 0.23 * thick,
      segments: 12,
      color: p.hull,
    });

    // Nacelles, one built and one mirrored.
    // Deviations are multipliers of the published figures, not absolutes: an
    // Excelsior's pylons are tall FOR AN EXCELSIOR, and an absolute value
    // written here would mean something different on every hull.
    const nz = b.nacelleZ ?? sr * (b.nacelleWide ?? 0.78);
    const ny = b.nacelleY ?? high * (b.nacelleHigh ?? 0.38);
    const nx = b.nacelleX ?? -0.48;
    // Long enough to reach the saucer's trailing edge and no further: the
    // bussards used to run forward to the saucer's midpoint, which is a
    // shape no Starfleet cruiser has.
    const nl = b.nacelleLength ?? 0.44 + sx * 0.6;
    const nr = b.nacelleRadius ?? high * 0.12;
    // Where the blade leaves the hull, and how thick and how deep it is.
    // A pylon is a wing: a chord you can see from the side and a thickness you
    // can barely see from the front.
    const zRoot = nz * (b.pylonRoot ?? 0.16);
    mirrored(mb, (m) => {
      // The pylon reaches from the hull to the nacelle, measured rather than
      // guessed at a fixed 0.34 — which was right for a Constitution and left
      // every ship with higher nacelles connected to nothing.
      //
      // It is a leaning blade, not a block. Spanning the gap in z as a box
      // size — which is what this did — fills the entire corner between hull
      // and nacelle with solid geometry: on a Galaxy that was a slab 0.25 of
      // the ship's length across and nearly as tall, and it is the first thing
      // you saw when you looked at one. `flare` carries the top of a thin
      // blade outboard to meet the nacelle instead.
      box(m, {
        center: vec3(nx + nl * 0.3, (ny + hy) / 2, zRoot),
        size: vec3(
          b.pylonChord ?? high * 0.62,
          Math.abs(ny - hy) + high * 0.16,
          b.pylonThick ?? high * 0.1,
        ),
        sweep: b.pylonSweep ?? 0.06,
        rake: b.pylonRake ?? Math.max(0, ny - hy) * 0.7,
        flare: nz - zRoot,
        color: p.trim,
      });
      tube(m, {
        origin: vec3(nx, ny, nz),
        length: nl,
        r0: nr,
        r1: nr * 0.82,
        segments: 10,
        color: p.hull,
      });
      // The bussard cap: the one emissive detail on the whole hull.
      sphere(m, {
        origin: vec3(nx + nl, ny, nz),
        radius: nr * 1.05,
        segments: 8,
        rings: 5,
        color: p.glow,
      });
    });
  },

  /**
   * The 1966 Constitution, which is a different ship from a generic saucer hull.
   *
   * `starfleet` gets the four masses right and stops there, which reads as
   * "Federation ship" and not as *this* one. Four details do the identifying,
   * and every one of them was missing:
   *
   *   THE DEFLECTOR DISH. The copper dish recessed in the bow of the secondary
   *     hull. Probably the single most recognisable feature after the saucer,
   *     and there was just a capped tube.
   *   THE BUSSARD DOMES. Amber caps on the front of each nacelle — domes set
   *     into a collar, not the bare spheres the generic form uses.
   *   THIN SWEPT PYLONS. The 1966 struts are slender and raked back. Box slabs
   *     read as the 1979 refit, which is a different ship.
   *   THE HANGAR. A flat transom at the stern with the bay doors on it.
   *
   * Colour matters too: `[0.74, 0.77, 0.82]` is refit grey. The 1966 miniature
   * was a warm off-white.
   */
  tos_starfleet(mb, p, b) {
    // Same rule as `starfleet`: the published beam and height as fractions of
    // length, and a hull built to span one unit fore-and-aft. A Constitution
    // is 289 m by 127 by 72.6, which is a saucer 0.44 of the ship's length
    // across on a hull a quarter of its length tall — a much flatter, smaller-
    // saucered object than the hand-tuned numbers here ever drew.
    const wide = b.ratioBeam ?? 0.44;
    const high = b.ratioHeight ?? 0.25;
    const sr = b.saucerRadius ?? wide / 2;
    const sx = b.saucerX ?? 0.5 - sr;
    const hullY = b.hullY ?? -high * 0.44;

    saucer(mb, {
      origin: vec3(sx, b.saucerY ?? 0, 0),
      radius: sr,
      thickness: b.saucerThickness ?? high * 0.19,
      domeRatio: b.domeRatio ?? 0.3,
      domeHeight: b.domeHeight ?? high * 0.2,
      segments: b.segments ?? 24,
      color: p.hull,
      rimColor: p.trim,
    });

    // The dorsal neck, raked rather than vertical.
    box(mb, {
      center: vec3(sx - sr * 0.6, hullY / 2, 0),
      size: vec3(sr * 0.42, Math.abs(hullY) + high * 0.24, high * 0.3),
      sweep: 0.08,
      color: p.hull,
    });

    // Secondary hull. Blunter at the bow than the generic taper, because the
    // dish has to sit in something.
    const hr = high * 0.2;
    const hl = b.hullLength ?? 0.46 + sx * 0.72;
    tube(mb, {
      origin: vec3(-0.48, hullY, 0),
      length: hl,
      r0: hr * 0.85,
      r1: hr,
      segments: 14,
      color: p.hull,
      capAft: true,
    });

    // The deflector dish, recessed in a collar at the bow.
    const dishX = -0.48 + hl;
    tube(mb, {
      origin: vec3(dishX - hr * 0.2, hullY, 0),
      length: hr * 0.34,
      r0: hr,
      r1: hr * 0.86,
      segments: 14,
      color: p.trim,
    });
    sphere(mb, {
      origin: vec3(dishX + hr * 0.24, hullY, 0),
      radius: hr * 0.74,
      segments: 12,
      rings: 6,
      color: p.dish ?? p.glow,
    });

    // The hangar: a flat transom closing the stern.
    box(mb, {
      center: vec3(-0.49, hullY, 0),
      size: vec3(hr * 0.34, hr * 1.2, hr * 1.05),
      color: p.trim,
    });

    // Nacelles on slender raked pylons.
    //
    // Height matters more than any other number here. The nacelles used to sit
    // at 0.155 — a saucer's thickness above the saucer — and the ship read as
    // a plate with two logs beside it. On the real thing they are carried well
    // clear of the primary hull, and it is the empty space under them that
    // makes the silhouette.
    const nz = b.nacelleZ ?? sr * (b.nacelleWide ?? 0.76);
    const ny = b.nacelleY ?? high * (b.nacelleHigh ?? 0.38);
    const nx = b.nacelleX ?? -0.46;
    const nl = b.nacelleLength ?? 0.44 + sx * 0.6;
    const nr = b.nacelleRadius ?? high * 0.115;
    const zRoot = nz * (b.pylonRoot ?? 0.14);
    mirrored(mb, (m) => {
      // Thin, swept harder than the generic slab, and leaning aft as it rises.
      //
      // "Thin" was a comment rather than a shape: the box was slim fore-and-aft
      // and then a full nacelle-span wide, so the 1966 struts — which are the
      // slenderest thing on the ship, and the reason there is daylight under
      // the nacelles at all — were drawn as two filled corners.
      box(m, {
        center: vec3(nx + nl * 0.34, (ny + hullY) / 2, zRoot),
        size: vec3(
          b.pylonChord ?? high * 0.56,
          Math.abs(ny - hullY) + high * 0.12,
          b.pylonThick ?? high * 0.08,
        ),
        sweep: b.pylonSweep ?? 0.05,
        rake: b.pylonRake ?? Math.max(0, ny - hullY) * 0.8,
        flare: nz - zRoot,
        color: p.trim,
      });
      tube(m, {
        origin: vec3(nx, ny, nz),
        length: nl,
        r0: nr,
        r1: nr * 0.9,
        segments: 12,
        color: p.hull,
        capAft: true,
      });
      // The bussard collar, then the dome set into it.
      tube(m, {
        origin: vec3(nx + nl - nr * 0.3, ny, nz),
        length: nr * 0.6,
        r0: nr * 0.95,
        r1: nr * 1.1,
        segments: 12,
        color: p.trim,
      });
      sphere(m, {
        origin: vec3(nx + nl + nr * 0.45, ny, nz),
        radius: nr * 1.08,
        segments: 10,
        rings: 6,
        color: p.glow,
      });
      // The blue intercooler grille along the outboard face.
      box(m, {
        center: vec3(nx + nl * 0.45, ny - nr * 0.55, nz),
        size: vec3(nl * 0.42, nr * 0.17, nr * 0.5),
        color: p.trim,
      });
    });
  },

  /**
   * A wide, low predator: forward command pod on a neck, swept wings.
   * Wider than long with the wings down, per the research.
   */
  raptor(mb, p, b) {
    tube(mb, {
      origin: vec3(-0.35, 0, 0),
      length: b.bodyLength ?? 0.6,
      r0: b.bodyR0 ?? 0.2,
      r1: b.bodyR1 ?? 0.12,
      segments: 10,
      color: p.hull,
    });
    // Neck forward to the command head.
    box(mb, {
      center: vec3(0.4, -0.02, 0),
      size: vec3(0.5, 0.08, 0.11),
      color: p.trim,
    });
    box(mb, {
      center: vec3(0.72, -0.02, 0),
      size: vec3(0.22, 0.14, 0.24),
      color: p.hull,
    });

    const span = b.wingSpan ?? 0.72;
    const droop = b.wingDroop ?? -0.16;
    mirrored(mb, (m) => {
      box(m, {
        center: vec3(-0.18, droop * 0.5, span * 0.5),
        size: vec3(0.62, 0.05, span),
        sweep: b.wingSweep ?? 0.42,
        color: p.hull,
      });
      // Wing-tip disruptor housing.
      box(m, {
        center: vec3(-0.02, droop, span),
        size: vec3(0.3, 0.07, 0.08),
        color: p.glow,
      });
    });
  },

  /** Two great curved arms meeting fore and aft around an open centre. */
  warbird(mb, p, b) {
    const span = b.wingSpan ?? 0.58;
    tube(mb, {
      origin: vec3(-0.15, 0, 0),
      length: 0.42,
      r0: 0.13,
      r1: 0.1,
      segments: 10,
      color: p.trim,
    });
    mirrored(mb, (m) => {
      // Upper and lower arms, sweeping out and back in.
      box(m, {
        center: vec3(0.22, 0.16, span * 0.55),
        size: vec3(0.9, 0.09, span * 0.5),
        sweep: 0.3,
        color: p.hull,
      });
      box(m, {
        center: vec3(-0.32, -0.16, span * 0.55),
        size: vec3(0.9, 0.09, span * 0.5),
        sweep: -0.3,
        color: p.hull,
      });
      box(m, {
        center: vec3(0.5, 0, span * 0.86),
        size: vec3(0.34, 0.4, 0.1),
        color: p.trim,
      });
    });
    sphere(mb, { origin: vec3(0.62, 0, 0), radius: 0.11, segments: 10, rings: 6, color: p.glow });
  },

  /**
   * A blunt armoured wedge — Cardassian and Dominion hulls.
   *
   * `length_`, not `length`. `length` is METRES and is read by `hullScale`;
   * this is the hull's proportion in unit space, where everything else in this
   * file lives between about 0.8 and 1.9. Reading the wrong one built a Galor
   * 372 units long instead of 1.25, and then multiplied it by the on-screen
   * scale on top: 31,836 units of Cardassian cruiser inside a 2,600-unit
   * engagement volume. Somebody hit this before and invented the `length_`
   * name for it — four blueprints have carried the correct value ever since,
   * and no builder has ever read it.
   */
  wedge(mb, p, b) {
    box(mb, {
      center: vec3(0, 0, 0),
      size: vec3(b.length_ ?? 1.3, b.height ?? 0.16, b.width ?? 0.34),
      sweep: b.sweep ?? 0.3,
      color: p.hull,
    });
    box(mb, {
      center: vec3(-0.28, 0.1, 0),
      size: vec3(0.5, 0.16, 0.5),
      sweep: 0.24,
      color: p.trim,
    });
    mirrored(mb, (m) => {
      box(m, {
        center: vec3(-0.1, -0.02, (b.width ?? 0.34) * 0.9),
        size: vec3(0.7, 0.07, 0.24),
        sweep: 0.34,
        color: p.hull,
      });
    });
    sphere(mb, { origin: vec3(0.55, 0.02, 0), radius: 0.1, segments: 8, rings: 5, color: p.glow });
  },

  /** Literally a cube. There is nothing else to say about it. */
  cube(mb, p, b) {
    // A Borg cube is a cube because it IS one — its published figures are equal
    // on all three axes, so the ratios below give it back exactly that. Anything
    // else built by this form (the bioship) is not a cube, and drawing it as one
    // made it three times as tall as its own dimensions say.
    const s = b.size ?? 1.1;
    const sy = s * ((b.ratioHeight ?? 1) / 1);
    const sz = s * ((b.ratioBeam ?? 1) / 1);
    box(mb, { center: vec3(), size: vec3(s, sy, sz), color: p.hull });
    // Surface clutter, so it does not read as a flat-shaded box at a distance.
    for (let i = 0; i < 14; i++) {
      const t = i / 14;
      const a = t * Math.PI * 2 * 3.7;
      box(mb, {
        center: vec3(Math.cos(a) * s * 0.36, Math.sin(a * 1.7) * sy * 0.36, Math.sin(a) * sz * 0.5),
        size: vec3(s * 0.2, sy * 0.18, sz * 0.12),
        color: i % 4 === 0 ? p.glow : p.trim,
      });
    }
  },

  /** A working hull: cylinder, bridge block, cargo spine. `length_` — see wedge. */
  hauler(mb, p, b) {
    tube(mb, {
      origin: vec3(-0.5, 0, 0),
      length: b.length_ ?? 1.0,
      r0: b.r0 ?? 0.16,
      r1: b.r1 ?? 0.13,
      segments: 10,
      color: p.hull,
    });
    box(mb, { center: vec3(0.42, 0.14, 0), size: vec3(0.24, 0.14, 0.2), color: p.trim });
    mirrored(mb, (m) => {
      box(m, { center: vec3(-0.18, 0, 0.2), size: vec3(0.5, 0.12, 0.12), color: p.trim });
    });
  },
};

/**
 * Every hull, to its published numbers. Metres, then decks, then complement.
 *
 * See docs/RESEARCH.md §13, which records where each figure comes from and
 * marks the ones the source material never gave — those are the game's own,
 * read off the screen, and are flagged there rather than passed off as
 * measurements.
 *
 * `length` is the only field the renderer reads today; beam, height and decks
 * are recorded so that giving each class its own silhouette has real numbers to
 * work from instead of hand-tuned ratios.
 *
 * Two entries break rules that look universal, and both are correct:
 *
 *   A Bird-of-Prey is WIDER THAN IT IS LONG — 182 metres across the wings
 *   against 158 nose to tail. It is the reason the `wings` primitive exists.
 *
 *   A Borg cube is a cube. Length, beam and height are the same number and it
 *   has no decks in any sense the word applies to.
 */
export const DIMENSIONS = {
  // ---- Starfleet ----
  constitution: { length: 289, beam: 132, height: 73, decks: 23, crew: 430 },
  constitution_refit: { length: 305, beam: 132, height: 71, decks: 23, crew: 430 },
  miranda: { length: 278, beam: 141, height: 62, decks: 12, crew: 220 },
  oberth: { length: 120, beam: 66, height: 35, decks: 8, crew: 80 },
  excelsior: { length: 467, beam: 186, height: 78, decks: 34, crew: 750 },
  constellation: { length: 260, beam: 160, height: 60, decks: 14, crew: 535 },
  ambassador: { length: 526, beam: 326, height: 130, decks: 36, crew: 700 },
  galaxy: { length: 641, beam: 464, height: 195, decks: 42, crew: 1014 },
  nebula: { length: 442, beam: 318, height: 130, decks: 30, crew: 750 },
  intrepid: { length: 345, beam: 132, height: 66, decks: 15, crew: 150 },
  defiant: { length: 171, beam: 134, height: 30, decks: 4, crew: 50 },
  sovereign: { length: 685, beam: 251, height: 88, decks: 24, crew: 855 },
  runabout: { length: 23, beam: 14, height: 5, decks: 1, crew: 4 },

  // ---- Klingon ----
  bird_of_prey: { length: 158, beam: 182, height: 98, decks: 3, crew: 36 },
  d7: { length: 228, beam: 152, height: 60, decks: 18, crew: 400 },
  ktinga: { length: 235, beam: 152, height: 60, decks: 18, crew: 440 },
  vorcha: { length: 481, beam: 342, height: 107, decks: 28, crew: 1900 },
  neghvar: { length: 682, beam: 470, height: 137, decks: 35, crew: 2500 },

  // ---- Romulan ----
  warbird: { length: 1041, beam: 774, height: 307, decks: 60, crew: 1500 },
  scoutship: { length: 68, beam: 44, height: 18, decks: 3, crew: 24 },

  // ---- Cardassian ----
  galor: { length: 372, beam: 192, height: 59, decks: 16, crew: 300 },
  keldon: { length: 400, beam: 208, height: 64, decks: 18, crew: 400 },

  // ---- Everyone else ----
  marauder: { length: 366, beam: 234, height: 103, decks: 20, crew: 450 },
  orion_raider: { length: 110, beam: 64, height: 30, decks: 5, crew: 60 },
  tholian_web_spinner: { length: 130, beam: 96, height: 26, decks: 4, crew: 12 },
  jem_hadar_attack: { length: 178, beam: 130, height: 26, decks: 3, crew: 50 },
  jem_hadar_battleship: { length: 800, beam: 420, height: 150, decks: 40, crew: 900 },
  borg_cube: { length: 3040, beam: 3040, height: 3040, decks: 0, crew: 64000 },
  bioship: { length: 600, beam: 420, height: 200, decks: 0, crew: 1 },
  transport: { length: 120, beam: 58, height: 34, decks: 6, crew: 1400 },
  freighter: { length: 220, beam: 92, height: 58, decks: 10, crew: 14 },
};

/**
 * The fleet. `form` picks an archetype; everything else tunes it.
 *
 * `length` here is METRES and duplicates DIMENSIONS — a test holds the two
 * together so they cannot drift. `length_` is the hull's proportion in UNIT
 * space, which is a different thing entirely and is what the builders read.
 */
export const BLUEPRINTS = {
  // ---- Starfleet ----
  // Federation entries carry SHAPE and nothing else.
  //
  // Every saucer radius, hull radius, nacelle height and nacelle offset that
  // used to sit here was a hand-tuned proportion, and the DIMENSIONS table
  // above already holds the published figure for each of them. The forms read
  // those figures now, so what is left below is only what makes one ship
  // different from another at the same proportions: how raked the saucer is,
  // how far the pylons sweep, how long the nacelles run. Everything that would
  // duplicate a number in DIMENSIONS is gone, because two copies of a figure
  // is one copy too many and the second one always goes stale.
  constitution: { form: 'tos_starfleet', length: 289 },
  constitution_refit: { form: 'starfleet', length: 305, domeRatio: 0.52, domeFlat: 0.22, nacelleHigh: 0.3, pylonSweep: 0.08 },
  miranda: { form: 'rollbar', length: 278, neck: false },
  oberth: { form: 'twinhull', length: 120, lowerY: -0.06 },
  excelsior: { form: 'starfleet', length: 467, saucerStretch: 1.08, hullReach: 1.15, nacelleHigh: 0.46, nacelleWide: 0.68, pylonSweep: 0.02 },
  constellation: { form: 'quadnacelle', length: 260 },
  ambassador: { form: 'starfleet', length: 526, nacelleHigh: 0.3, pylonSweep: 0.08 },
  galaxy: { form: 'starfleet', length: 641, saucerStretch: 0.95, nacelleHigh: 0.4, nacelleWide: 0.86, pylonSweep: 0.14 },
  nebula: { form: 'podded', length: 442, saucerStretch: 0.95 },
  intrepid: { form: 'starfleet', length: 345, saucerStretch: 1.12, hullThick: 0.62, hullReach: 0.5, nacelleHigh: 0.52, nacelleWide: 0.66, nacelleLength: 0.44, pylonSweep: 0.12 },
  defiant: { form: 'compact', length: 171 },
  sovereign: { form: 'starfleet', length: 685, saucerStretch: 1.34, domeRatio: 0.26, domeFlat: 0.08, neck: false, hullThick: 1.25, hullReach: 1.1, nacelleHigh: 0.4, nacelleWide: 0.92, nacelleLength: 0.62, pylonSweep: 0.3 },
  runabout: { form: 'compact', length: 23, segments: 12 },

  // ---- Klingon ----
  bird_of_prey: { form: 'raptor', length: 158, wingSpan: 0.98, wingSweep: 0.46, wingDroop: -0.8 },
  d7: { form: 'raptor', length: 228, wingSpan: 0.52, wingSweep: 0.3, wingDroop: -0.1, bodyLength: 0.7 },
  ktinga: { form: 'raptor', length: 235, wingSpan: 0.52, wingSweep: 0.32, wingDroop: -0.1, bodyLength: 0.72 },
  vorcha: { form: 'raptor', length: 481, wingSpan: 0.62, wingSweep: 0.5, wingDroop: -0.16, bodyLength: 0.9, bodyR0: 0.16 },
  neghvar: { form: 'raptor', length: 682, wingSpan: 0.62, wingSweep: 0.54, wingDroop: 0.02, bodyLength: 1.0, bodyR0: 0.19 },

  // ---- Romulan ----
  warbird: { form: 'warbird', length: 1041, wingSpan: 0.62 },
  scoutship: { form: 'raptor', length: 68, wingSpan: 0.48, wingSweep: 0.2, wingDroop: -0.18, bodyLength: 0.42, bodyR0: 0.14 },

  // ---- Cardassian ----
  galor: { form: 'wedge', length: 372, length_: 1.25, width: 0.36, sweep: 0.34 },
  keldon: { form: 'wedge', length: 400, length_: 1.3, width: 0.4, height: 0.18, sweep: 0.36 },

  // ---- Everyone else ----
  marauder: { form: 'warbird', length: 366, wingSpan: 0.5 },
  orion_raider: { form: 'raptor', length: 110, wingSpan: 0.44, wingSweep: 0.24, bodyLength: 0.5 },
  tholian_web_spinner: { form: 'wedge', length: 130, length_: 0.8, width: 0.44, height: 0.1, sweep: 0.1 },
  jem_hadar_attack: { form: 'wedge', length: 178, length_: 0.9, width: 0.46, height: 0.1, sweep: 0.4 },
  jem_hadar_battleship: { form: 'wedge', length: 800, length_: 1.4, width: 0.44, height: 0.24, sweep: 0.44 },
  borg_cube: { form: 'cube', length: 3040, size: 1.15 },
  bioship: { form: 'cube', length: 600, size: 0.85 },
  transport: { form: 'hauler', length: 120, length_: 1.0, r0: 0.13, r1: 0.11 },
  freighter: { form: 'hauler', length: 220, length_: 1.2, r0: 0.155, r1: 0.13 },
};

/** Meshes are built once per class and reused by every ship of that class. */
const cache = new Map();

/**
 * The blueprint a form actually receives: its own parameters, plus the two
 * ratios that ought to decide most of them.
 *
 * A form has no idea which class it is building, which is why every
 * proportion in this file was a constant. Handing it beam-over-length and
 * height-over-length lets it derive the saucer, the hull radius and the
 * nacelle height from the published figures, and leaves the blueprint entries
 * to say only what is genuinely per-ship — how raked a Sovereign's saucer is,
 * how far a Galaxy's pylons sweep.
 */
function withRatios(classId, bp) {
  const d = DIMENSIONS[classId];
  if (!d?.length || !d.beam || !d.height) return bp;
  return { ...bp, ratioBeam: d.beam / d.length, ratioHeight: d.height / d.length };
}

/**
 * Squash a built hull onto its published beam and height.
 *
 * Phase B made every ship the right LENGTH and stopped there, and the other
 * two axes were hand-tuned unit-space guesses that nothing could check. They
 * were not close. Measured against the published figures, every Federation
 * hull in the game was drawn between 1.2x and 2.0x too wide and between 1.1x
 * and 2.7x too tall: an Excelsior stood 2.7 times its own height, an Oberth
 * 2.4, a Miranda was twice the beam it has. Federation ships are FLAT, and
 * none of these were.
 *
 * Length is the reference axis because `hullScale` already sets it, so this
 * only ever moves y and z. It runs once per class, at build time, on a mesh
 * that is then cached forever — it costs nothing per frame.
 *
 * Normals get the inverse scale and a re-normalise, which is what a
 * non-uniform transform does to a surface normal; skipping that lights a
 * squashed hull as though it were still the shape it was built as.
 */
function toPublishedProportions(mb, classId) {
  const d = DIMENSIONS[classId];
  if (!d?.length || !d.beam || !d.height) return mb;

  const P = mb.positions;
  const N = mb.normals;
  if (!P.length) return mb;

  let loX = Infinity; let hiX = -Infinity;
  let loY = Infinity; let hiY = -Infinity;
  let loZ = Infinity; let hiZ = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    if (P[i] < loX) loX = P[i]; if (P[i] > hiX) hiX = P[i];
    if (P[i + 1] < loY) loY = P[i + 1]; if (P[i + 1] > hiY) hiY = P[i + 1];
    if (P[i + 2] < loZ) loZ = P[i + 2]; if (P[i + 2] > hiZ) hiZ = P[i + 2];
  }
  const ex = hiX - loX; const ey = hiY - loY; const ez = hiZ - loZ;
  if (!(ex > 1e-6) || !(ey > 1e-6) || !(ez > 1e-6)) return mb;

  const sy = (ex * (d.height / d.length)) / ey;
  const sz = (ex * (d.beam / d.length)) / ez;
  // The squash is about the hull's own centre in y and its centreline in z, so
  // a ship does not slide off the origin its weapons and shields are drawn at.
  const midY = (loY + hiY) / 2;
  for (let i = 0; i < P.length; i += 3) {
    P[i + 1] = midY + (P[i + 1] - midY) * sy;
    P[i + 2] *= sz;
  }
  for (let i = 0; i < N.length; i += 3) {
    const nx = N[i]; const ny = N[i + 1] / sy; const nz = N[i + 2] / sz;
    const len = Math.hypot(nx, ny, nz) || 1;
    N[i] = nx / len; N[i + 1] = ny / len; N[i + 2] = nz / len;
  }
  return mb;
}

/**
 * How far a form has to be squashed to reach its published proportions.
 *
 * Exported because it is the number that keeps the forms honest. Normalising
 * makes every hull dimensionally true whatever shape it was built as, which
 * would let a form drift arbitrarily far from the ship it draws and still pass
 * — and a nacelle built round and then squashed 2:1 is an ellipse. A test
 * holds this near 1, so the forms have to be roughly right before the
 * normaliser is allowed to finish the job.
 */
export function proportionError(classId) {
  const d = DIMENSIONS[classId];
  const bp = BLUEPRINTS[classId];
  if (!d || !bp) return { beam: 1, height: 1 };
  const mb = new MeshBuilder();
  (FORMS[bp.form] ?? FORMS.hauler)(mb, paletteFor('independent'), withRatios(classId, bp));
  const P = mb.positions;
  let loX = Infinity; let hiX = -Infinity;
  let loY = Infinity; let hiY = -Infinity;
  let loZ = Infinity; let hiZ = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    if (P[i] < loX) loX = P[i]; if (P[i] > hiX) hiX = P[i];
    if (P[i + 1] < loY) loY = P[i + 1]; if (P[i + 1] > hiY) hiY = P[i + 1];
    if (P[i + 2] < loZ) loZ = P[i + 2]; if (P[i + 2] > hiZ) hiZ = P[i + 2];
  }
  const ex = hiX - loX;
  return {
    beam: ((hiZ - loZ) / ex) / (d.beam / d.length),
    height: ((hiY - loY) / ex) / (d.height / d.length),
  };
}

/**
 * Build (or fetch) the mesh for a ship class.
 * @param {string} classId
 * @param {string} faction  chooses the palette
 */
export function hullMesh(classId, faction = 'independent') {
  const key = `${classId}|${faction}`;
  if (cache.has(key)) return cache.get(key);

  const bp = BLUEPRINTS[classId] ?? BLUEPRINTS.transport;
  const form = FORMS[bp.form] ?? FORMS.hauler;
  const mb = new MeshBuilder();
  form(mb, paletteFor(faction), withRatios(classId, bp));
  toPublishedProportions(mb, classId);

  const built = mb.build();
  built.triangles = mb.triangleCount;
  built.blueprint = bp;
  cache.set(key, built);
  return built;
}

/**
 * World units per metre of hull.
 *
 * Hulls are drawn far larger than scale against the distances between them,
 * and that compression is deliberate: engagements run at 300–1,200 units and a
 * truthfully scaled Constitution would be a speck you could not target, let
 * alone identify. This number is chosen so a Constitution reads at about the
 * size it always has, which makes the change below one of RELATIVE size only —
 * every weapon arc, range and camera distance in the game stays meaningful.
 */
export const UNITS_PER_METRE = 0.286;

/**
 * On-screen size for a hull, in world units. Length in metres, times one
 * constant, and nothing else.
 *
 * This used to compress the range logarithmically as well, on the reasoning
 * that a runabout beside a Borg cube would be a single pixel. What it actually
 * produced was a fleet in which every ship is the same size: measured against
 * a Constitution, a 641-metre Galaxy drew at 1.10x, a 1,042-metre warbird at
 * 1.17x, and a three-kilometre Borg cube at 1.31x — while a twenty-three-metre
 * runabout drew at 0.67x, two-thirds the size of a heavy cruiser. The lengths
 * were right the whole time; this function threw them away.
 *
 * A runabout beside a Borg cube IS a speck. That is what those two things are.
 */
export function hullScale(classId) {
  return (DIMENSIONS[classId]?.length ?? 200) * UNITS_PER_METRE;
}

export { FORMS };
