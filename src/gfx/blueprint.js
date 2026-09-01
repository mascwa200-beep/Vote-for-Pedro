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
  /**
   * Saucer, secondary hull, and two nacelles on pylons. The Federation
   * silhouette, and the reason the saucer primitive gets the most segments.
   */
  starfleet(mb, p, b) {
    const sr = b.saucerRadius ?? 0.44;
    const sx = b.saucerX ?? 0.34;
    saucer(mb, {
      origin: vec3(sx, b.saucerY ?? 0.02, 0),
      radius: sr,
      thickness: b.saucerThickness ?? 0.1,
      domeRatio: b.domeRatio ?? 0.34,
      domeHeight: b.domeHeight ?? 0.05,
      segments: b.segments ?? 22,
      color: p.hull,
      rimColor: p.trim,
    });

    if (b.neck !== false) {
      box(mb, {
        center: vec3(sx - sr * 0.55, -0.1, 0),
        size: vec3(sr * 0.5, 0.22, 0.09),
        color: p.trim,
      });
    }

    // The secondary hull, tapering aft.
    tube(mb, {
      origin: vec3(-0.5, b.hullY ?? -0.17, 0),
      length: b.hullLength ?? 0.82,
      r0: b.hullR0 ?? 0.1,
      r1: b.hullR1 ?? 0.14,
      segments: 12,
      color: p.hull,
    });

    // Nacelles, one built and one mirrored.
    const nz = b.nacelleZ ?? 0.36;
    const ny = b.nacelleY ?? 0.14;
    const nx = b.nacelleX ?? -0.46;
    const nl = b.nacelleLength ?? 0.86;
    const nr = b.nacelleRadius ?? 0.075;
    mirrored(mb, (m) => {
      box(m, {
        center: vec3(nx + nl * 0.28, (ny + (b.hullY ?? -0.17)) / 2, nz * 0.55),
        size: vec3(0.1, 0.34, nz * 0.9),
        sweep: b.pylonSweep ?? 0.14,
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
    const sr = b.saucerRadius ?? 0.46;
    const sx = b.saucerX ?? 0.34;
    const hullY = b.hullY ?? -0.17;

    saucer(mb, {
      origin: vec3(sx, b.saucerY ?? 0.02, 0),
      radius: sr,
      thickness: b.saucerThickness ?? 0.09,
      domeRatio: b.domeRatio ?? 0.3,
      domeHeight: b.domeHeight ?? 0.055,
      segments: b.segments ?? 24,
      color: p.hull,
      rimColor: p.trim,
    });

    // The dorsal neck, raked rather than vertical.
    box(mb, {
      center: vec3(sx - sr * 0.6, hullY / 2 - 0.02, 0),
      size: vec3(sr * 0.42, 0.26, 0.075),
      sweep: 0.08,
      color: p.hull,
    });

    // Secondary hull. Blunter at the bow than the generic taper, because the
    // dish has to sit in something.
    const hl = b.hullLength ?? 0.8;
    tube(mb, {
      origin: vec3(-0.46, hullY, 0),
      length: hl,
      r0: 0.105,
      r1: 0.145,
      segments: 14,
      color: p.hull,
      capAft: true,
    });

    // The deflector dish, recessed in a collar at the bow.
    const dishX = -0.46 + hl;
    tube(mb, {
      origin: vec3(dishX - 0.03, hullY, 0),
      length: 0.05,
      r0: 0.145,
      r1: 0.125,
      segments: 14,
      color: p.trim,
    });
    sphere(mb, {
      origin: vec3(dishX + 0.035, hullY, 0),
      radius: 0.108,
      segments: 12,
      rings: 6,
      color: p.dish ?? p.glow,
    });

    // The hangar: a flat transom closing the stern.
    box(mb, {
      center: vec3(-0.47, hullY, 0),
      size: vec3(0.05, 0.17, 0.15),
      color: p.trim,
    });

    // Nacelles on slender raked pylons.
    const nz = b.nacelleZ ?? 0.35;
    const ny = b.nacelleY ?? 0.155;
    const nx = b.nacelleX ?? -0.44;
    const nl = b.nacelleLength ?? 0.9;
    const nr = b.nacelleRadius ?? 0.072;
    mirrored(mb, (m) => {
      // Thin, and swept harder than the generic slab.
      box(m, {
        center: vec3(nx + nl * 0.3, (ny + hullY) / 2, nz * 0.55),
        size: vec3(0.055, 0.35, nz * 0.92),
        sweep: b.pylonSweep ?? 0.26,
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
        origin: vec3(nx + nl - 0.02, ny, nz),
        length: 0.045,
        r0: nr * 0.95,
        r1: nr * 1.1,
        segments: 12,
        color: p.trim,
      });
      sphere(m, {
        origin: vec3(nx + nl + 0.035, ny, nz),
        radius: nr * 1.08,
        segments: 10,
        rings: 6,
        color: p.glow,
      });
      // The blue intercooler grille along the outboard face.
      box(m, {
        center: vec3(nx + nl * 0.45, ny - nr * 0.55, nz),
        size: vec3(nl * 0.42, 0.012, nr * 0.5),
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
    const s = b.size ?? 1.1;
    box(mb, { center: vec3(), size: vec3(s, s, s), color: p.hull });
    // Surface clutter, so it does not read as a flat-shaded box at a distance.
    for (let i = 0; i < 14; i++) {
      const t = i / 14;
      const a = t * Math.PI * 2 * 3.7;
      box(mb, {
        center: vec3(Math.cos(a) * s * 0.36, Math.sin(a * 1.7) * s * 0.36, Math.sin(a) * s * 0.5),
        size: vec3(s * 0.2, s * 0.18, s * 0.12),
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
  constitution: { form: 'tos_starfleet', length: 289, saucerRadius: 0.46, nacelleLength: 0.9 },
  constitution_refit: { form: 'starfleet', length: 305, saucerRadius: 0.45, nacelleRadius: 0.085, pylonSweep: 0.1 },
  miranda: { form: 'starfleet', length: 278, saucerRadius: 0.52, neck: false, hullLength: 0.5, nacelleX: -0.34, nacelleY: -0.02, nacelleLength: 0.62 },
  oberth: { form: 'starfleet', length: 120, saucerRadius: 0.38, hullY: -0.36, hullLength: 0.66, nacelleY: -0.3, nacelleLength: 0.6 },
  excelsior: { form: 'starfleet', length: 467, saucerRadius: 0.47, hullLength: 1.0, nacelleLength: 1.0, nacelleZ: 0.4 },
  constellation: { form: 'starfleet', length: 260, saucerRadius: 0.42, nacelleLength: 0.72, nacelleZ: 0.44, pylonSweep: 0.04 },
  ambassador: { form: 'starfleet', length: 526, saucerRadius: 0.5, nacelleLength: 0.86 },
  galaxy: { form: 'starfleet', length: 641, saucerRadius: 0.62, saucerThickness: 0.13, hullLength: 0.9, nacelleZ: 0.44, nacelleLength: 0.88 },
  nebula: { form: 'starfleet', length: 442, saucerRadius: 0.58, hullLength: 0.6, nacelleX: -0.3, nacelleZ: 0.42, nacelleLength: 0.7 },
  intrepid: { form: 'starfleet', length: 345, saucerRadius: 0.44, saucerThickness: 0.09, hullLength: 0.6, nacelleLength: 0.66, pylonSweep: 0.2 },
  defiant: { form: 'starfleet', length: 171, saucerRadius: 0.4, saucerThickness: 0.14, domeRatio: 0.6, neck: false, hullLength: 0.4, hullY: -0.08, nacelleX: -0.2, nacelleY: 0, nacelleZ: 0.3, nacelleLength: 0.5, pylonSweep: 0.02 },
  sovereign: { form: 'starfleet', length: 685, saucerRadius: 0.54, saucerThickness: 0.1, hullLength: 1.0, nacelleLength: 0.94, pylonSweep: 0.24 },
  runabout: { form: 'starfleet', length: 23, saucerRadius: 0.3, saucerThickness: 0.16, domeRatio: 0.55, neck: false, hullLength: 0.34, hullY: -0.04, nacelleX: -0.12, nacelleY: 0.02, nacelleZ: 0.24, nacelleLength: 0.36, segments: 12 },

  // ---- Klingon ----
  bird_of_prey: { form: 'raptor', length: 158, wingSpan: 0.76, wingSweep: 0.46, wingDroop: -0.2 },
  d7: { form: 'raptor', length: 228, wingSpan: 0.66, wingSweep: 0.3, wingDroop: -0.04, bodyLength: 0.7 },
  ktinga: { form: 'raptor', length: 235, wingSpan: 0.68, wingSweep: 0.32, wingDroop: -0.05, bodyLength: 0.72 },
  vorcha: { form: 'raptor', length: 481, wingSpan: 0.62, wingSweep: 0.5, wingDroop: -0.02, bodyLength: 0.9, bodyR0: 0.16 },
  neghvar: { form: 'raptor', length: 682, wingSpan: 0.7, wingSweep: 0.54, wingDroop: 0.02, bodyLength: 1.0, bodyR0: 0.22 },

  // ---- Romulan ----
  warbird: { form: 'warbird', length: 1041, wingSpan: 0.62 },
  scoutship: { form: 'raptor', length: 68, wingSpan: 0.68, wingSweep: 0.2, wingDroop: -0.06, bodyLength: 0.42, bodyR0: 0.14 },

  // ---- Cardassian ----
  galor: { form: 'wedge', length: 372, length_: 1.25, width: 0.36, sweep: 0.34 },
  keldon: { form: 'wedge', length: 400, length_: 1.3, width: 0.4, height: 0.18, sweep: 0.36 },

  // ---- Everyone else ----
  marauder: { form: 'warbird', length: 366, wingSpan: 0.5 },
  orion_raider: { form: 'raptor', length: 110, wingSpan: 0.54, wingSweep: 0.24, bodyLength: 0.5 },
  tholian_web_spinner: { form: 'wedge', length: 130, length_: 0.8, width: 0.44, height: 0.1, sweep: 0.1 },
  jem_hadar_attack: { form: 'wedge', length: 178, length_: 0.9, width: 0.42, height: 0.12, sweep: 0.4 },
  jem_hadar_battleship: { form: 'wedge', length: 800, length_: 1.4, width: 0.5, height: 0.2, sweep: 0.44 },
  borg_cube: { form: 'cube', length: 3040, size: 1.15 },
  bioship: { form: 'cube', length: 600, size: 0.85 },
  transport: { form: 'hauler', length: 120, length_: 1.0 },
  freighter: { form: 'hauler', length: 220, length_: 1.2, r0: 0.2 },
};

/** Meshes are built once per class and reused by every ship of that class. */
const cache = new Map();

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
  form(mb, paletteFor(faction), bp);

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
