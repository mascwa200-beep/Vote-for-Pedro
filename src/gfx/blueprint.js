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
import {
  MeshBuilder, saucer, tube, box, prow, sphere, mirrored, seg,
  windowRing, windowBelt, windowDeck, navLights, greebles, portRow,
  shaded, hotCore,
} from './mesh.js';
import { FEDERATION_FORMS } from './forms.federation.js';
import { KLINGON_FORMS } from './forms.klingon.js';
import { HOSTILE_FORMS } from './forms.hostile.js';

/**
 * Hull plating by faction. Flat shading means these are the whole look.
 *
 * Not exported: `paletteFor` below is how the rest of the game asks, and it
 * falls back to `independent` for a faction with no entry. Handing out the
 * table itself invites `PALETTE[faction]` at the call site, which is the same
 * lookup without the fallback.
 */
const PALETTE = {
  // Warm off-white, not refit grey. The 1966 miniature photographed as a
  // cream-white hull with darker grey detailing; [0.74, 0.77, 0.82] is the
  // cool grey of the 1979 film refit, which is a different ship.
  federation: {
    hull: [0.82, 0.81, 0.77], trim: [0.56, 0.57, 0.60], glow: [0.45, 0.72, 1.0],
    dish: [0.85, 0.55, 0.25],   // the copper deflector
    // Three lights that are not the same light, and were all `glow` before.
    // `glow` is warp plasma and reads blue; a bussard collector is an amber
    // scoop and an impulse deck is a hot red-orange grid, and a Starfleet hull
    // with blue ones is instantly the wrong ship. Every other faction falls
    // back to its `glow` — one accent is the right budget for a silhouette
    // seen for thirty seconds, and three is the right budget for the one the
    // player is flying.
    bussard: [1.0, 0.46, 0.22],
    impulse: [1.0, 0.34, 0.14],
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
 * How much a hull shines.
 *
 * The renderer has had a Blinn-Phong term since the interior was written, and
 * its own note in `gl.js` argues the case: "a flat-shaded bulkhead with no
 * highlight is a coloured polygon, and the same bulkhead with a soft sheen
 * sliding across it as you turn your head is a wall." Rooms asked for it at
 * 0.22. No hull in the game ever did — the tactical plot never called
 * `setLighting` at all, and the two viewscreen passes named `gloss: 0`
 * explicitly, under a comment about one hard sun and deep shadow. That is an
 * argument about where the light comes FROM. A painted hull under a single hard
 * sun is exactly when a highlight is sharpest.
 *
 * Faces that carry their own light — windows, bussards, the deflector — are
 * untouched for free: the shader mixes the glow channel in AFTER the specular,
 * so a fully-lit face replaces it. Measured on the built fleet rather than
 * assumed: every painted surface carries glow 0, every self-lit one glow above
 * 0.45.
 *
 * The value is not a taste call, it is the clipping ceiling. A Starfleet hull
 * is the brightest paint in the game at 0.82, and its diffuse peak is already
 * 0.82 × (0.22 ambient + 0.85 key) = 0.877. With the shader's luminance weight
 * this lands the specular peak at exactly 1.000 — the brightest highlight that
 * is still a highlight rather than a blown white patch. 0.3 would put it at
 * 1.14 and flatten the one material it is most visible on. Klingon hulls, being
 * darker paint, sit well under the ceiling and get proportionally less sheen,
 * which is correct.
 *
 * It lives here, beside the palettes, because it is a property of the hull
 * rather than of the scene, and in ONE place because the two draw sites that
 * need it are in different files and a number written twice is a number that
 * drifts.
 */
export const HULL_GLOSS = 0.14;

/**
 * And how tight that highlight is.
 *
 * The exponent was 24 for everything, which is right for the surface it was
 * written against — a bulkhead two metres from the camera, filling the frame.
 * Across a face that large the view vector changes a lot from one fragment to
 * the next, so the half-vector sweeps the whole specular lobe and the highlight
 * slides across the wall, which is exactly what the shader's note describes.
 *
 * A hull seventeen hundred units away is the opposite case. The whole ship
 * subtends a few dozen pixels, so the view vector is very nearly constant over
 * all of it and the half-vector is effectively ONE direction. A flat-shaded hull
 * then samples the lobe at its facet normals and nowhere else — and with an
 * exponent of 24 the lobe is narrower than the gap between facets, so it is
 * almost always missed entirely.
 *
 * Measured rather than argued: with the term wired and nothing else changed,
 * the brightest pixel on the whole ship gained FOUR levels out of 255. The
 * closest any facet came to the half-vector was a dot of 0.918, and 0.918^24 is
 * 0.135 — the model and the pixels agree to the decimal. At 8 the same facet
 * keeps half the highlight and its neighbours get a graded share, which is a
 * sheen across a saucer rather than a glint that is never there.
 *
 * The ceiling is unchanged: the specular can never exceed `HULL_GLOSS`
 * whatever the exponent, so broadening the lobe cannot make it clip.
 */
export const HULL_SHINE = 8;

/** How much light a hull picks up along its own outline. See the note in gl.js. */
export const HULL_RIM = 0.35;

/**
 * Hull archetypes. `build` receives a MeshBuilder, the palette, and the
 * blueprint's own parameters.
 */
const FORMS = {
  // The Federation silhouettes that this file's own `starfleet` cannot make —
  // no secondary hull, two hulls, four nacelles, no saucer. See
  // src/gfx/forms.federation.js and docs/RESEARCH.md §14.
  ...FEDERATION_FORMS,

  // The hulls the player fights. They live in their own files for the same
  // reason the Federation ones moved out of this one: it was 1,144 lines
  // before any of them had a lit port on it at all.
  ...KLINGON_FORMS,
  ...HOSTILE_FORMS,

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
      segments: seg(b.segments ?? 22),
      color: p.hull,
      rimColor: p.trim,
    });

    // Windows.
    //
    // This is the first thing on the hull that is not hull. A saucer is a
    // smooth grey plate and reads as a model of a ship; a saucer with a band
    // of lit ports around its rim reads as a place with people in it, and it
    // reads that way from the far side of an engagement, where no other
    // detail survives. It is also what says the ship is UNDER WAY rather than
    // parked — the lights are on because someone is on watch.
    //
    // `windows: false` for a hull that has none to speak of; `windowCount`
    // scales with the class, because a runabout does not have a Galaxy's
    // number of them.
    const saucerY = b.saucerY ?? 0;
    const saucerHalf = (b.saucerThickness ?? high * 0.2) / 2;
    const domeR = sr * (b.domeRatio ?? 0.34);
    // The plate's own height at a given radius: it runs from y = 0 at the rim
    // up to y = half at the dome's edge, linearly.
    const plateY = (r) => saucerHalf * ((sr - r) / (sr - domeR));
    // Port and starboard, whether or not this class carries lit ports.
    navLights(mb, { origin: vec3(sx, saucerY, 0), radius: sr });
    if (b.windows !== false) {
      windowRing(mb, {
        origin: vec3(sx, saucerY, 0),
        radius: sr,
        stretch,
        count: seg(b.windowCount ?? 13),
        height: high * (b.windowHeight ?? 0.03),
      });
      // Two concentric rows on the plate itself, which is the view the
      // tactical camera actually has.
      for (const at of [0.82, 0.62]) {
        const r = sr * at;
        windowDeck(mb, {
          origin: vec3(sx, saucerY, 0),
          radius: r,
          stretch,
          // Clear of the plate, not flush with it. Coplanar geometry is
          // decided per pixel per frame by whichever z wins, and the result
          // is a window band that crawls as the camera moves.
          y: plateY(r) + saucerHalf * 0.25,
          count: seg(b.windowCount ?? 13),
          depth: sr * 0.02,
        });
      }
    }

    // The impulse deck, across the saucer's trailing edge.
    //
    // Every Starfleet saucer ends in one, and it is the only part of the ship
    // that tells you which way it is pointing when you are behind it.
    if (b.impulse !== false) {
      box(mb, {
        center: vec3(sx - sr * stretch * 0.96, (b.saucerY ?? 0) + high * 0.02, 0),
        size: vec3(sr * 0.1, high * 0.05, sr * (b.impulseWide ?? 0.5)),
        color: p.impulse ?? p.glow,
        glow: 1,
      });
    }

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
    const hullLen = b.hullLength ?? 0.5 + sx * (b.hullReach ?? 0.85);
    const hullR1 = b.hullR1 ?? high * 0.23 * thick;
    tube(mb, {
      origin: vec3(-0.5, hy, 0),
      length: hullLen,
      r0: b.hullR0 ?? high * 0.17 * thick,
      r1: hullR1,
      segments: seg(12),
      color: p.hull,
    });

    // The deflector dish, which this form did not have.
    //
    // `tos_starfleet` exists because the generic form "gets the four masses
    // right and stops there, which reads as Federation ship and not as THIS
    // one" — and the first of the four details it lists as missing is the dish,
    // "probably the single most recognisable feature after the saucer". The TOS
    // hull got one. The six classes that use this form — the refit, Excelsior,
    // Ambassador, Galaxy, Intrepid and Sovereign — kept the bare capped tube.
    //
    // Same construction as the TOS hull's, because it is the same feature and
    // two ways of drawing one thing is one way too many: a collar recessed into
    // the bow with the dish set in it. `deflector: false` turns it off for a
    // hull that genuinely has none rather than leaving it to be discovered.
    if (b.deflector !== false) {
      const dishX = -0.5 + hullLen;
      tube(mb, {
        origin: vec3(dishX - hullR1 * 0.2, hy, 0),
        length: hullR1 * 0.3,
        r0: hullR1,
        r1: hullR1 * 0.88,
        segments: seg(14),
        color: p.trim,
      });
      sphere(mb, {
        origin: vec3(dishX + hullR1 * 0.2, hy, 0),
        radius: hullR1 * (b.deflectorSize ?? 0.72),
        segments: seg(12),
        rings: 6,
        color: p.dish ?? p.glow,
        // Lit, but not fully: a deflector is a copper dish that is ALSO
        // running, so it keeps enough of the key light to stay a curved
        // object rather than becoming a flat orange disc.
        glow: 0.55,
      });
    }

    // A row of ports down each flank of the secondary hull, where the crew
    // decks are. A third of the circumference each side, centred on the beam,
    // so they run along the flanks rather than around the belly.
    if (b.windows !== false) {
      // Angle 0 in `windowBelt` is +y, so a belt centred on 0 runs along the
      // SPINE of the hull, not its flank. Centred on ±pi/2 instead — which is
      // ±z, which is where a habitable deck's ports actually are.
      const hullR0 = b.hullR0 ?? high * 0.17 * thick;
      const rAt = (u) => hullR0 + (hullR1 - hullR0) * u;
      // Short ports at three stations, not one long strip. A single belt as
      // long as a quarter of the hull is a stripe, and a stripe reads as
      // painted trim rather than as windows.
      for (const phase of [Math.PI * (0.5 - 0.14), Math.PI * (1.5 - 0.14)]) {
        for (const u of [0.28, 0.44, 0.6]) {
          windowBelt(mb, {
            origin: vec3(0, hy, 0),
            x: -0.5 + hullLen * u,
            r0: rAt(u),
            r1: rAt(u + 0.07),
            count: seg(b.hullWindowCount ?? 2),
            arc: Math.PI * 0.28,
            phase,
            length: hullLen * 0.07,
            fill: 0.5,
          });
        }
      }
    }

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
        segments: seg(10),
        color: p.hull,
        capAft: true,
      });
      // The bussard collar, then the dome set into it.
      //
      // Second of the four details `tos_starfleet` lists as the difference
      // between "Federation ship" and a named one: "domes set into a collar,
      // not the bare spheres the generic form uses". It was a bare sphere
      // stuck on the end of a tube, which reads as a ball bearing rather than
      // as the front of a warp nacelle.
      tube(m, {
        origin: vec3(nx + nl - nr * 0.3, ny, nz),
        length: nr * 0.6,
        r0: nr * 0.9,
        r1: nr * 1.06,
        segments: seg(12),
        color: p.trim,
      });
      // Shaded, not flat. An emissive face discards the lighting result
      // entirely, so this 300-triangle sphere was drawn as one disc of colour.
      // The ramp gives it a core and a rim for no triangles at all.
      const bx = nx + nl + nr * 0.4;
      shaded(m, (mm) => sphere(mm, {
        origin: vec3(bx, ny, nz),
        radius: nr * 1.04,
        segments: seg(10),
        rings: 6,
        color: p.bussard ?? p.glow,
        glow: 1,
      }), hotCore(bx, ny, nz));
      // The intercooler grille along the outboard face, which does more for
      // the read of a nacelle than its cost suggests: it is the one thing that
      // says which way is outboard.
      // On the OUTBOARD flank, and protruding.
      //
      // #134 placed this ventrally and 0.68 of a nacelle radius from the
      // axis — which is to say entirely INSIDE the tube it was decorating.
      // Twelve triangles a side that could not be seen from any angle, and
      // the comment above claiming the feature "says which way is outboard"
      // while the box sat symmetric in z. Measured rather than eyeballed, by
      // slicing the hull across the grille's station: its outer face has to
      // clear the nacelle's own surface at that station or there is nothing
      // there. It stands about a tenth of a nacelle radius proud of it — a
      // fin, not a wing.
      //
      // Part lit. A grille is a vent over something running hot, so it
      // carries the warp colour without becoming a light bulb.
      box(m, {
        center: vec3(nx + nl * 0.45, ny, nz + nr * 0.98),
        size: vec3(nl * 0.42, nr * 0.62, nr * 0.24),
        color: p.glow,
        glow: 0.45,
      });
    });

    // The hangar: a flat transom closing the stern.
    //
    // Fourth of the four. A secondary hull that tapers to a capped cylinder
    // has no stern — the shuttlebay is where a Federation ship ends, and
    // without it the hull just stops.
    if (b.hangar !== false) {
      box(mb, {
        center: vec3(-0.5, hy, 0),
        size: vec3(hullR1 * 0.3, hullR1 * 1.15, hullR1 * 1.0),
        color: p.trim,
      });
    }
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
      segments: seg(b.segments ?? 24),
      color: p.hull,
      rimColor: p.trim,
    });

    // Rim windows and the impulse deck, as on the generic form. Same reasons,
    // and the 1966 miniature is where both come from in the first place.
    const saucerHalf = (b.saucerThickness ?? high * 0.19) / 2;
    const domeR = sr * (b.domeRatio ?? 0.3);
    const plateY = (r) => saucerHalf * ((sr - r) / (sr - domeR));
    navLights(mb, { origin: vec3(sx, b.saucerY ?? 0, 0), radius: sr });
    if (b.windows !== false) {
      windowRing(mb, {
        origin: vec3(sx, b.saucerY ?? 0, 0),
        radius: sr,
        count: seg(b.windowCount ?? 13),
        height: high * (b.windowHeight ?? 0.03),
      });
      for (const at of [0.82, 0.62]) {
        const r = sr * at;
        windowDeck(mb, {
          origin: vec3(sx, b.saucerY ?? 0, 0),
          radius: r,
          // Clear of the plate, not flush with it. Coplanar geometry is
          // decided per pixel per frame by whichever z wins, and the result
          // is a window band that crawls as the camera moves.
          y: plateY(r) + saucerHalf * 0.25,
          count: seg(b.windowCount ?? 13),
          depth: sr * 0.02,
        });
      }
    }
    if (b.impulse !== false) {
      box(mb, {
        center: vec3(sx - sr * 0.96, (b.saucerY ?? 0) + high * 0.02, 0),
        size: vec3(sr * 0.1, high * 0.05, sr * 0.5),
        color: p.impulse ?? p.glow,
        glow: 1,
      });
    }

    // The dorsal neck, raked rather than vertical. `prow`, not `box`: `sweep`
    // displaces only the +z corners, so a swept centreline box is a
    // parallelogram seen from above rather than a rake.
    prow(mb, {
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
      segments: seg(14),
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
      segments: seg(14),
      color: p.trim,
    });
    sphere(mb, {
      origin: vec3(dishX + hr * 0.24, hullY, 0),
      radius: hr * 0.74,
      segments: seg(12),
      rings: 6,
      color: p.dish ?? p.glow,
      glow: 0.55,
    });

    // Ports down each flank of the secondary hull.
    if (b.windows !== false) {
      // Angle 0 in `windowBelt` is +y, so a belt centred on 0 runs along the
      // SPINE of the hull, not its flank. Centred on ±pi/2 instead — which is
      // ±z, which is where a habitable deck's ports actually are.
      for (const phase of [Math.PI * (0.5 - 0.14), Math.PI * (1.5 - 0.14)]) {
        for (const u of [0.28, 0.44, 0.6]) {
          windowBelt(mb, {
            origin: vec3(0, hullY, 0),
            x: -0.48 + hl * u,
            r0: hr * (0.85 + 0.15 * u),
            r1: hr * (0.85 + 0.15 * (u + 0.07)),
            count: seg(b.hullWindowCount ?? 2),
            arc: Math.PI * 0.28,
            phase,
            length: hl * 0.07,
            fill: 0.5,
          });
        }
      }
    }

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
        segments: seg(12),
        color: p.hull,
        capAft: true,
      });
      // The bussard collar, then the dome set into it.
      tube(m, {
        origin: vec3(nx + nl - nr * 0.3, ny, nz),
        length: nr * 0.6,
        r0: nr * 0.95,
        r1: nr * 1.1,
        segments: seg(12),
        color: p.trim,
      });
      const bx = nx + nl + nr * 0.45;
      shaded(m, (mm) => sphere(mm, {
        origin: vec3(bx, ny, nz),
        radius: nr * 1.08,
        segments: seg(10),
        rings: 6,
        // This form's own docstring says "AMBER caps on the front of each
        // nacelle" and the colour here was `glow`, which is warp blue. The
        // comment was right and the code was not.
        color: p.bussard ?? p.glow,
        glow: 1,
      }), hotCore(bx, ny, nz));
      // The blue intercooler grille along the outboard face.
      // On the OUTBOARD flank, and protruding.
      //
      // #134 placed this ventrally and 0.68 of a nacelle radius from the
      // axis — which is to say entirely INSIDE the tube it was decorating.
      // Twelve triangles a side that could not be seen from any angle, and
      // the comment above claiming the feature "says which way is outboard"
      // while the box sat symmetric in z. Measured rather than eyeballed, by
      // slicing the hull across the grille's station: its outer face has to
      // clear the nacelle's own surface at that station or there is nothing
      // there. It stands about a tenth of a nacelle radius proud of it — a
      // fin, not a wing.
      //
      // Part lit. A grille is a vent over something running hot, so it
      // carries the warp colour without becoming a light bulb.
      box(m, {
        center: vec3(nx + nl * 0.45, ny, nz + nr * 0.98),
        size: vec3(nl * 0.42, nr * 0.62, nr * 0.24),
        color: p.glow,
        glow: 0.45,
      });
    });
  },

  /** A working hull: cylinder, bridge block, cargo spine. `length_` — see wedge. */
  /**
   * The two civilian hulls, and the fallback for anything unrecognised.
   *
   * `transport` and `freighter` used to be this form with three numbers
   * changed — `length_`, `r0`, `r1` — and 285 triangles each, the crudest hulls
   * in the game. They are also among the most-seen: `independent` appears in
   * more sectors than any other faction, and one of these two is what turns up.
   *
   * Their own entries in `DIMENSIONS` had already told them apart and nothing
   * had read it. A transport is 120 metres and carries **1,400** people; a
   * freighter is 220 metres and carries **fourteen**. One is a liner and the
   * other is fourteen people and a warehouse, and they were the same ship.
   *
   * So the shapes come from the numbers: `pods` slings cargo containers on a
   * spine for the hauler that exists to carry them, and `habitat` puts a
   * deckhouse and a second row of ports on the one that exists to carry people.
   * Both default off, which keeps this safe as the fallback form for an unknown
   * class (see the `BLUEPRINTS[classId] ?? BLUEPRINTS.transport` below).
   */
  hauler(mb, p, b) {
    const L = b.length_ ?? 1.0;
    const hr0 = b.r0 ?? 0.16; const hr1 = b.r1 ?? 0.13;
    const rAt = (u) => hr0 + (hr1 - hr0) * u;

    tube(mb, {
      origin: vec3(-0.5, 0, 0),
      length: L,
      r0: hr0,
      r1: hr1,
      segments: seg(10),
      color: p.hull,
    });
    box(mb, { center: vec3(0.42, 0.14, 0), size: vec3(0.24, 0.14, 0.2), color: p.trim });
    mirrored(mb, (m) => {
      box(m, { center: vec3(-0.18, 0, 0.2), size: vec3(0.5, 0.12, 0.12), color: p.trim });
    });

    // Cargo. Containers slung outboard on the spars, in a row, with the
    // handling gear between them — which is what makes a freighter read as a
    // freighter from any angle rather than as a tube with a box on it.
    if (b.pods) {
      mirrored(mb, (m) => {
        for (let i = 0; i < b.pods; i++) {
          const u = 0.16 + (i + 0.5) * (0.62 / b.pods);
          box(m, {
            center: vec3(-0.5 + L * u, -0.03, 0.235),
            size: vec3(L * (0.5 / b.pods), 0.135, 0.115),
            color: i % 2 ? p.trim : p.hull,
          });
        }
        // The gear that holds them on.
        greebles(m, {
          from: vec3(-0.5 + L * 0.18, 0.05, 0.19),
          to: vec3(-0.5 + L * 0.78, 0.05, 0.19),
          count: 5, size: vec3(0.05, 0.035, 0.05), vary: 0.5, color: p.trim,
        });
      });
    }

    // Fourteen hundred people need somewhere to be. A deckhouse over the
    // forward third, which is the only part of a transport that is not tankage.
    if (b.habitat) {
      box(mb, {
        center: vec3(-0.5 + L * 0.62, hr0 * 0.72, 0),
        size: vec3(L * 0.34, 0.1, 0.28),
        rake: 0.06,
        color: p.trim,
      });
      portRow(mb, {
        from: vec3(-0.5 + L * 0.48, hr0 * 0.72, 0.14),
        to: vec3(-0.5 + L * 0.76, hr0 * 0.72, 0.14),
        count: seg(4), size: 0.019,
      });
      portRow(mb, {
        from: vec3(-0.5 + L * 0.48, hr0 * 0.72, -0.14),
        to: vec3(-0.5 + L * 0.76, hr0 * 0.72, -0.14),
        count: seg(4), size: 0.019,
      });
    }

    // A freighter is a working ship with people living on it for months, so it
    // gets the most windows in the fleet and no weapons to glow instead.
    // Short ports at four stations. Thirteen windows spanning seventy degrees
    // of arc and half the hull's length was not a row of ports, it was a woven
    // mat — the same mistake the secondary hulls started with.
    for (const phase of [Math.PI * (0.5 - 0.12), Math.PI * (1.5 - 0.12)]) {
      for (const u of [0.2, 0.36, 0.52, 0.68]) {
        windowBelt(mb, {
          origin: vec3(-0.5, 0, 0),
          x: L * u,
          r0: rAt(u),
          r1: rAt(u + 0.08),
          count: seg(2),
          arc: Math.PI * 0.24,
          phase,
          length: L * 0.08,
          fill: 0.5,
        });
      }
    }
    // Engine glow on the stern.
    tube(mb, {
      origin: vec3(-0.54, 0, 0),
      length: 0.05,
      r0: hr0 * 0.5,
      r1: hr0 * 0.58,
      segments: seg(9),
      color: p.glow,
      glow: 1,
      capFore: false,
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
  // No `neck: false` here: `neck` is read by the `starfleet` form, which the
  // Sovereign uses, and the `rollbar` form builds its own saucer and has never
  // looked at it. Carrying the key made the Miranda look like it was turning
  // something off.
  miranda: { form: 'rollbar', length: 278 },
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
  //
  // Four of these five were the same wedge. `kdf_cruiser` is the boom-and-neck
  // silhouette the cruisers actually have, and `spine`/`plates`/`prow` are what
  // separate the four classes built by it — the D7 and the K't'inga have the
  // same published dimensions to the metre, so nothing about proportion can
  // tell them apart and the refit's ribbed hull has to be built.
  bird_of_prey: { form: 'raptor', length: 158, wingSpan: 0.9, wingSweep: 0.3, wingDroop: -0.72, headWide: 1.0 },
  d7: { form: 'kdf_cruiser', length: 228, neckThick: 0.26, bulbSize: 0.58, bulbX: 0.42, boomWide: 0.26, boomLength: 0.42, nacelleLength: 1.1, nacelleR: 0.24, wingSweep: 0.06 },
  ktinga: { form: 'kdf_cruiser', length: 235, spine: true, plates: true, neckThick: 0.32, bulbSize: 0.64, bulbX: 0.40, boomWide: 0.32, boomLength: 0.46, nacelleLength: 1.0, nacelleR: 0.28, wingSweep: 0.12 },
  vorcha: { form: 'kdf_cruiser', length: 481, spine: true, prow: true, neckThick: 0.46, bulbSize: 0.56, bulbX: 0.40, boomWide: 0.4, boomLength: 0.54, nacelleLength: 0.92, nacelleR: 0.24, wingSweep: 0.2, prowSweep: 0.24 },
  neghvar: { form: 'kdf_cruiser', length: 682, spine: true, plates: true, prow: true, neckThick: 0.46, bulbSize: 0.5, bulbX: 0.5, boomX: -0.32, boomWide: 0.34, boomLength: 0.6, nacelleY: -0.45, nacelleLength: 0.9, nacelleR: 0.2, wingSweep: 0.26, prowSweep: 0.32, engines: 5 },

  // ---- Romulan ----
  warbird: { form: 'warbird', length: 1041, wingSpan: 0.54 },
  scoutship: { form: 'raptor', length: 68, wingSpan: 0.48, wingSweep: 0.2, wingDroop: -0.1, bodyLength: 0.42, bodyR0: 0.14, headWide: 0.8, spineCount: 4, engines: 2 },

  // ---- Cardassian ----
  galor: { form: 'wedge', length: 372, length_: 1.25, sweep: 0.34 },
  keldon: { form: 'wedge', length: 400, pods: true, nose: true, length_: 1.3, sweep: 0.36, engines: 4 },

  // ---- Everyone else ----
  marauder: { form: 'marauder', length: 366 },
  orion_raider: { form: 'raptor', length: 110, wingSpan: 0.44, wingSweep: 0.24, bodyLength: 0.5, headWide: 0.9, spineCount: 5, wingNacelle: 0.26 },
  tholian_web_spinner: { form: 'tholian', length: 130, length_: 0.95 },
  jem_hadar_attack: { form: 'dominion', length: 178, length_: 0.86, prongSweep: 0.12 },
  jem_hadar_battleship: { form: 'dominion', length: 800, heavy: true, length_: 1.1, prongSweep: 0.2, ridgeCount: 7, engines: 5 },
  borg_cube: { form: 'cube', length: 3040, size: 1.15 },
  bioship: { form: 'bioship', length: 600 },
  // 1,400 aboard a 120-metre hull: a liner, so a deckhouse and rows of ports.
  transport: { form: 'hauler', length: 120, length_: 1.0, r0: 0.13, r1: 0.11, habitat: true },
  // Fourteen aboard 220 metres: the rest of her is cargo, so show the cargo.
  freighter: { form: 'hauler', length: 220, length_: 1.2, r0: 0.155, r1: 0.13, pods: 4 },
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
