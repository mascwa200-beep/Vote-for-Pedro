// The hulls the player actually fights.
//
// Thirteen Federation classes carry between 716 and 2,142 triangles, a band of
// lit ports round the rim, two more rows on the plate, ports down each flank of
// the secondary hull, a copper deflector, an impulse deck and glowing bussard
// domes. Every Klingon class in the game carried 241 triangles and no windows
// at all — and it was the SAME 241. A Bird-of-Prey is a 158-metre raider with
// three decks and thirty-six aboard; a Negh'Var is a 682-metre battleship with
// thirty-five decks and two and a half thousand. They were one mesh at two
// sizes, and by the game's own fingerprint a D7 and a K't'inga were 0.085
// apart, against the 0.2 that every Federation pair has to clear.
//
// That asymmetry is backwards. A captain sees their own ship in the shipyard
// and on the status board; they see these across a battle, for the length of a
// battle, which is most of what the game is.
//
// Two forms, because the Klingon fleet is genuinely two silhouettes and no
// setting of one produces the other:
//
//   The RAPTOR is a body with a forward neck, a flat head, and wings that carry
//   the guns. It is wider than it is long with the wings down, which is the one
//   ship in the game that is.
//
//   The CRUISER is a bulbous command section at the end of a long thin neck,
//   with a broad boom astern carrying the nacelles at its tips. Nothing about
//   it can be reached by drooping a raptor's wings.
//
// Coordinate convention, matching mesh.js and the simulation: +x is the bow,
// +y is dorsal, +z is starboard. `mirrored` builds the starboard half and
// reflects it, so everything below is written for one side only.

import { vec3 } from './math.js';
import { tube, box, sphere, mirrored, seg, greebles, windowBelt } from './mesh.js';

/**
 * A Klingon warp nacelle: a housing with a lit grille down its inboard face and
 * a glowing throat at the bow.
 *
 * Both forms end in a pair of these and they were the same nine lines twice.
 * The grille is on the INBOARD face because that is the one a ship being fought
 * from ahead can see between the wings, and a light nobody can see is the
 * mistake #134 shipped.
 */
function nacelle(m, p, { x, y, z, length: len, radius: r, inboard = -1 }) {
  tube(m, {
    origin: vec3(x, y, z), length: len, r0: r, r1: r * 0.9,
    segments: seg(9), color: p.hull,
  });
  // The throat, forward: a Klingon engine is lit at the front, which is what
  // separates one head-on from a Federation bussard's amber dome.
  tube(m, {
    origin: vec3(x + len, y, z), length: r * 0.35, r0: r * 0.9, r1: r * 0.62,
    color: p.glow, glow: 1, segments: seg(8), capAft: false,
  });
  // And a seam along the flank, proud of the housing rather than flush with it:
  // coplanar geometry is decided per pixel per frame by whichever z wins.
  box(m, {
    center: vec3(x + len * 0.5, y, z + inboard * r * 1.02),
    size: vec3(len * 0.72, r * 0.34, r * 0.1),
    color: p.glow,
    glow: 0.75,
  });
}

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

export const KLINGON_FORMS = {
  /**
   * A wide, low predator: forward command head on a neck, wings that carry the
   * guns and the engines both.
   *
   * The Bird-of-Prey, the Romulan scout and the Orion raider. Wider than long
   * with the wings down, per the research — the published beam is 182 metres
   * against a length of 158, which is the only hull in the fleet where that is
   * true and the reason this form exists rather than being another cruiser.
   *
   * What it had before: a tube, two flat plates, a box for a head, and two
   * orange bricks floating clear of the wings they were meant to be mounted on.
   * Nothing on it was lit that was attached to it.
   */
  raptor(mb, p, b) {
    const bodyLen = b.bodyLength ?? 0.6;
    const r0 = b.bodyR0 ?? 0.2;
    const r1 = b.bodyR1 ?? 0.12;
    const bodyX = -0.35;

    tube(mb, {
      origin: vec3(bodyX, 0, 0),
      length: bodyLen,
      r0,
      r1,
      segments: seg(10),
      color: p.hull,
    });

    // The dorsal spine. A tube is a tube at every distance; a tube with a ridge
    // of housings along it is a ship's back, and every fourth one lit is a row
    // of running lights for the price of nothing.
    greebles(mb, {
      from: vec3(bodyX + bodyLen * 0.16, r0 * 0.86, 0),
      to: vec3(bodyX + bodyLen * 0.92, r1 * 0.92, 0),
      count: b.spineCount ?? 6,
      size: vec3(bodyLen * 0.09, r0 * 0.3, r0 * 0.5),
      color: p.trim,
      lit: p.glow,
      litEvery: 3,
    });

    // The neck, raked down to the head rather than run out flat: a raptor's
    // head sits BELOW the line of its body, which is most of why the profile
    // reads as a bird of prey and not as a dart.
    const headX = 0.36 + bodyLen * 0.36;
    const headY = b.headY ?? -r0 * 0.34;
    box(mb, {
      center: vec3((bodyX + bodyLen + headX) / 2, headY * 0.5, 0),
      size: vec3(headX - bodyX - bodyLen + 0.1, r0 * 0.42, r0 * 0.5),
      rake: r0 * 0.3,
      color: p.trim,
    });

    // The head: a flat wide plate with a beak in front of it, not a cube. The
    // beak is the class's whole forward silhouette.
    const hw = (b.headWide ?? 1) * r0;
    box(mb, {
      center: vec3(headX, headY, 0),
      size: vec3(hw * 1.5, r0 * 0.52, hw * 1.7),
      sweep: hw * 0.5,
      color: p.hull,
    });
    box(mb, {
      center: vec3(headX + hw * 1.1, headY - r0 * 0.06, 0),
      size: vec3(hw * 0.9, r0 * 0.24, hw * 0.66),
      sweep: hw * 0.34,
      color: p.trim,
    });
    // The forward torpedo port, at the tip, lit. On a Bird-of-Prey this is the
    // one aperture anybody being shot at ever sees.
    box(mb, {
      center: vec3(headX + hw * 1.52, headY - r0 * 0.06, 0),
      size: vec3(hw * 0.12, r0 * 0.13, hw * 0.34),
      color: p.glow,
      glow: 1,
    });
    // Ports along the head's flanks, where the crew sit.
    //
    // The radius and the arc are both set against the HEAD BOX they sit on,
    // not chosen. `windowBelt` lays ports on a circle; a head is a flat wedge
    // 1.7 half-widths across, so a belt at 0.8 of that is a row of lights
    // inside the head — #134's failure, reproduced in a new place and caught
    // by the slice test rather than by looking. A narrow arc centred on ±z
    // keeps every port outside the widest face.
    if (b.windows !== false) {
      const arc = Math.PI * 0.18;
      for (const centre of [Math.PI * 0.5, Math.PI * 1.5]) {
        windowBelt(mb, {
          origin: vec3(0, headY, 0),
          x: headX - hw * 0.6,
          r0: hw * 0.95,
          r1: hw * 0.95,
          count: seg(2),
          arc,
          phase: centre - arc / 2,
          length: hw * 0.9,
          fill: 0.45,
        });
      }
    }
    // And down the body, where four hundred of them do not: a raider carries
    // thirty-six, so this is two ports a side and not a row.
    //
    // FORWARD of the wing root fairing and ABOVE the wing, which spans two
    // thirds of the body's length and reaches four times as far outboard as
    // the tube it is bolted to. Ports on the beam are ports behind a wing —
    // measured, on a scoutship, at a wing reaching z=0.237 over a port at
    // z=0.112.
    if (b.windows !== false) {
      const u = 0.88;
      const rAt = r0 + (r1 - r0) * u;
      const arc = Math.PI * 0.16;
      for (const centre of [Math.PI * 0.34, Math.PI * 1.66]) {
        windowBelt(mb, {
          origin: vec3(0, 0, 0),
          x: bodyX + bodyLen * u,
          r0: rAt * 1.02,
          r1: rAt * 1.0,
          count: seg(1),
          arc,
          phase: centre - arc / 2,
          length: bodyLen * 0.1,
          fill: 0.5,
        });
      }
    }

    // ---- the wings ----
    //
    // `wingDroop` is where the TIP sits, not where the whole plate sits.
    //
    // It used to be an offset applied to the wing, the nacelle and the cannon
    // separately, each by a different fraction — so a Bird-of-Prey, whose
    // droop is the largest in the fleet, had a wing root 0.29 units below the
    // body it grows out of, a nacelle another 0.29 below the wing, and a
    // cannon below that again. From the side it was four disconnected objects
    // in a diagonal line. `dip` shears the blade instead: the root is at the
    // hull and the tip is at `wingDroop`, and everything mounted on the wing
    // is placed at the height the wing actually has at that span.
    const span = b.wingSpan ?? 0.72;
    const droop = b.wingDroop ?? -0.16;
    const rootZ = span * 0.13;
    const wingY = (z) => droop * Math.max(0, (z - rootZ) / (span - rootZ));
    mirrored(mb, (m) => {
      // The root fairing, where the wing leaves the body. Without it a wing is
      // a plate intersecting a cylinder and the join is a hard edge that says
      // "two primitives" from any angle.
      box(m, {
        center: vec3(bodyX + bodyLen * 0.42, 0, span * 0.16),
        size: vec3(bodyLen * 0.72, r0 * 0.72, span * 0.3),
        sweep: (b.wingSweep ?? 0.42) * 0.3,
        dip: -wingY(span * 0.31) * 0.9,
        color: p.trim,
      });
      // The wing itself: root on the hull's centreline, tip at `droop`.
      box(m, {
        center: vec3(-0.18, 0, (rootZ + span) / 2),
        size: vec3(0.62, 0.05, span - rootZ),
        sweep: b.wingSweep ?? 0.42,
        dip: -droop,
        color: p.hull,
      });
      // The wing carries the warp engine, which is what a Bird-of-Prey's wings
      // ARE — the housing runs along the underside with a lit seam inboard.
      const nz = span * 0.72;
      nacelle(m, p, {
        x: -0.1,
        y: wingY(nz) - 0.045,
        z: nz,
        length: b.wingNacelle ?? 0.34,
        radius: (b.wingNacelleR ?? 0.055),
        inboard: -1,
      });
      // The wingtip cannon, mounted ON the tip rather than hanging beside it.
      // The muzzle is the lit part; the barrel is not.
      const tipZ = span * 0.96;
      tube(m, {
        origin: vec3(-0.02, wingY(tipZ), tipZ),
        length: 0.26,
        r0: 0.035,
        r1: 0.028,
        segments: seg(6),
        color: p.trim,
      });
      box(m, {
        center: vec3(0.26, wingY(tipZ), tipZ),
        size: vec3(0.05, 0.05, 0.05),
        color: p.glow,
        glow: 1,
      });
    });

    engineBank(mb, p, {
      x: bodyX - 0.02,
      spread: r0 * 0.52,
      size: r0 * 0.34,
      count: b.engines ?? 3,
    });
  },

  /**
   * A command section at the end of a long neck, with a broad boom astern
   * carrying the nacelles at its tips: the D7, the K't'inga, the Vor'cha and
   * the Negh'Var.
   *
   * All four were drawn as raptors with slightly different wings, which is why
   * the D7 and the K't'inga sat 0.085 apart on the game's own shape
   * fingerprint. They have the same published dimensions to the metre — 152 by
   * 60 on a length of 228 and 235 — so nothing about proportion can separate
   * them and the difference has to be built. It is the refit that does it: the
   * K't'inga is a D7 with its hull broken up into armoured plating, a heavier
   * boom and a ribbed neck, which is exactly what `spine` and `plates` are.
   *
   * `prow` is the other axis: a Vor'cha and a Negh'Var carry forward-swept
   * wings off the command section that neither older cruiser has.
   */
  kdf_cruiser(mb, p, b) {
    const high = b.ratioHeight ?? 0.26;
    const wide = b.ratioBeam ?? 0.67;
    const neckR = high * (b.neckThick ?? 0.34);
    const bulbX = b.bulbX ?? 0.40;
    const bulbR = high * (b.bulbSize ?? 0.62);
    const tipZ = wide * 0.5;

    // ---- the boom, astern ----
    //
    // The mass of the ship and the thing the nacelles hang off. Flat and wide,
    // because every one of these classes is: 60 metres of height on 152 of
    // beam is a plate, not a block.
    //
    // It is the AFT half of the hull and no more. A first pass ran the boom and
    // its nacelles the whole length of the ship, which from the side made one
    // long tube with a ball stuck on the front of it — the neck, which is the
    // class's most recognisable feature, was inside the nacelle.
    const boomX = b.boomX ?? -0.28;
    const boomLen = b.boomLength ?? 0.44;
    const boomZ = wide * (b.boomWide ?? 0.3);
    box(mb, {
      center: vec3(boomX, 0, 0),
      size: vec3(boomLen, high * 0.5, boomZ * 2),
      color: p.hull,
    });
    // A raised aft deckhouse, so the boom is not one slab from above.
    box(mb, {
      center: vec3(boomX - boomLen * 0.14, high * 0.34, 0),
      size: vec3(boomLen * 0.54, high * 0.24, boomZ * 0.9),
      sweep: 0.04,
      color: p.trim,
    });
    // Machinery across the boom's forward deck. From the tactical camera —
    // which looks DOWN — the boom is the largest single surface on the ship,
    // and without this it is one grey rectangle with a darker rectangle on it.
    mirrored(mb, (m) => {
      greebles(m, {
        from: vec3(boomX + boomLen * 0.34, high * 0.26, boomZ * 0.24),
        to: vec3(boomX - boomLen * 0.34, high * 0.26, boomZ * 0.78),
        count: 4,
        size: vec3(boomLen * 0.13, high * 0.14, boomZ * 0.3),
        vary: 0.3,
        color: p.hull,
        lit: p.glow,
        litEvery: 4,
      });
    });

    // ---- the neck ----
    const neckAft = boomX + boomLen * 0.42;
    const neckFore = bulbX - bulbR * 0.5;
    box(mb, {
      center: vec3((neckAft + neckFore) / 2, 0, 0),
      size: vec3(neckFore - neckAft, neckR * 1.5, neckR * 2),
      color: p.trim,
    });
    // The refit's ribbed spine. This is the one feature that separates a
    // K't'inga from a D7 at a glance, and neither had it.
    if (b.spine) {
      greebles(mb, {
        from: vec3(neckAft + 0.03, neckR * 1.1, 0),
        to: vec3(neckFore - 0.03, neckR * 1.2, 0),
        count: b.spineCount ?? 7,
        size: vec3((neckFore - neckAft) * 0.09, neckR * 0.5, neckR * 1.3),
        color: p.hull,
        lit: p.glow,
        litEvery: 4,
      });
    }
    // Armoured plating along the neck's flanks — the other half of the refit.
    if (b.plates) {
      mirrored(mb, (m) => {
        greebles(m, {
          from: vec3(neckAft + 0.05, -neckR * 0.2, neckR * 1.05),
          to: vec3(neckFore - 0.05, -neckR * 0.2, neckR * 1.05),
          count: 5,
          size: vec3((neckFore - neckAft) * 0.13, neckR * 1.1, neckR * 0.22),
          vary: 0.25,
          color: p.hull,
        });
      });
    }
    // Ports along the neck's upper shoulder, not its beam.
    //
    // Two reasons, both measured. The plating stands proud of the neck box by
    // a sixth of its radius, so a belt at 1.15 was behind the armour on every
    // refit hull; and on the two classes with prow wings the wing is swept far
    // enough aft that at the port's own station it reaches three times as far
    // outboard as the neck does — a light behind a wing, from every angle a
    // fight is watched from.
    if (b.windows !== false) {
      const arc = Math.PI * 0.2;
      for (const centre of [Math.PI * 0.34, Math.PI * 1.66]) {
        windowBelt(mb, {
          origin: vec3(0, 0, 0),
          x: neckAft + (neckFore - neckAft) * 0.3,
          r0: neckR * 1.25,
          r1: neckR * 1.25,
          count: seg(2),
          arc,
          phase: centre - arc / 2,
          length: (neckFore - neckAft) * 0.34,
          fill: 0.5,
        });
      }
    }

    // ---- the command section ----
    //
    // Bulbous and set forward on the neck. A sphere flattened by the
    // normaliser afterwards, which is what it should be: the published height
    // is a quarter of the length on every one of these.
    sphere(mb, {
      origin: vec3(bulbX, 0, 0),
      radius: bulbR,
      segments: seg(9),
      rings: 6,
      color: p.hull,
    });
    // The bridge blister on top and the forward torpedo tube below it.
    box(mb, {
      center: vec3(bulbX - bulbR * 0.1, bulbR * 0.86, 0),
      size: vec3(bulbR * 0.9, bulbR * 0.36, bulbR * 1.1),
      color: p.trim,
    });
    box(mb, {
      center: vec3(bulbX + bulbR * 0.98, -bulbR * 0.14, 0),
      size: vec3(bulbR * 0.3, bulbR * 0.2, bulbR * 0.34),
      color: p.glow,
      glow: 1,
    });
    // Ports round the command section's widest station, and nowhere else on
    // it. A belt is a straight strip and a sphere is not: run one from 0.4 of
    // the radius forward for 0.8 of it and the chord cuts back inside the
    // surface in the middle, which put the bridge crew's own windows inside
    // the bridge on all four cruisers.
    if (b.windows !== false) {
      const arc = Math.PI * 0.22;
      for (const centre of [Math.PI * 0.5, Math.PI * 1.5]) {
        windowBelt(mb, {
          origin: vec3(0, 0, 0),
          x: bulbX - bulbR * 0.16,
          r0: bulbR * 1.02,
          r1: bulbR * 1.02,
          count: seg(2),
          arc,
          phase: centre - arc / 2,
          length: bulbR * 0.32,
          fill: 0.5,
        });
      }
    }

    // ---- the wings ----
    const nacR = high * (b.nacelleR ?? 0.26);
    const nacZ = tipZ - nacR;
    mirrored(mb, (m) => {
      // The boom's outer panel, out to the nacelle and swept back. `sweep`
      // displaces the OUTBOARD end aft, so a positive value is a swept wing;
      // a first pass used a large one and the wingtips came out as forward
      // needles longer than the neck.
      box(m, {
        center: vec3(boomX + boomLen * 0.06, 0, (boomZ + nacZ) / 2),
        size: vec3(boomLen * 0.8, high * 0.2, nacZ - boomZ),
        sweep: b.wingSweep ?? 0.1,
        color: p.hull,
      });
      // Slung BELOW the line of the neck, not level with it. Level, and seen
      // from the side — which is half the angles a fight is watched from — the
      // nacelle covers the neck exactly, and the class's most recognisable
      // feature becomes a tube inside another tube.
      // `nacelleY` is a share of the ship's HEIGHT, like every other figure in
      // this form. Written as `b.nacelleY ?? -high * 0.34` the default was
      // scaled and the override was not, so a blueprint asking for -0.44 got
      // 0.44 of the ship's LENGTH below the centreline — which on a Negh'Var
      // put the nacelles two and a half times as far down as the whole hull is
      // tall, and left the normaliser squashing the ship to a third of its
      // height to compensate.
      nacelle(m, p, {
        x: boomX - boomLen * 0.5,
        y: high * (b.nacelleY ?? -0.34),
        z: nacZ,
        length: boomLen * (b.nacelleLength ?? 0.95),
        radius: nacR,
        inboard: -1,
      });
      // Forward-swept prow wings, which the two later classes have and the two
      // earlier ones do not. Off the NECK rather than the command bulb, and
      // ahead of the boom panels, so the two do not overlap into one shape.
      if (b.prow) {
        box(m, {
          center: vec3(neckFore - bulbR * 0.2, -high * 0.04, boomZ * 0.95),
          size: vec3(bulbR * 1.8, high * 0.16, boomZ * 1.5),
          sweep: b.prowSweep ?? 0.26,
          color: p.trim,
        });
        // A disruptor housing at each prow tip, lit at the muzzle.
        box(m, {
          center: vec3(neckFore - bulbR * 0.7, -high * 0.04, boomZ * 1.6),
          size: vec3(bulbR * 0.8, high * 0.12, boomZ * 0.2),
          color: p.glow,
          glow: 1,
        });
      }
    });

    engineBank(mb, p, {
      x: boomX - boomLen * 0.52,
      spread: boomZ * 0.6,
      size: high * 0.2,
      count: b.engines ?? 4,
    });
  },
};
