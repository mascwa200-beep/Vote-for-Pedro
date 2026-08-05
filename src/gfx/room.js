// Rooms, as geometry.
//
// Turns the hand-authored rooms in world/interiors.data.js into meshes, using
// the same MeshBuilder primitives the ships are made of. No new renderer, no
// new shader, no assets — a corridor and a Constitution go through the same
// flat-shaded pipeline.
//
// TWO MESHES PER ROOM, NOT ONE.
//
// `emissive` is a per-DRAW uniform in gl.js, not a vertex attribute, so a
// single mesh is either entirely lit or entirely self-lit. TOS sets are flat
// colour plus glowing panels — that is the whole look — so every room builds a
// `solid` mesh that takes the light and a `glow` mesh that ignores it. This is
// structural rather than incidental: the console faces, the transporter pads,
// the warp core and the strip lighting are all in the second one.
//
// THE KEY LIGHT POINTS DOWN.
//
// `gl.js` fixes it at (0.55, 0.72, 0.42), so floors render bright and ceilings
// render dark, which is upside down for a room lit from its ceiling. That is
// compensated for in the PALETTE — dark floors, pale ceilings — rather than in
// the shader, because the shader is shared with the tactical view where the
// current arrangement is correct.
//
// Coordinates match walk.js: x to starboard, z forward, y up, origin at the
// centre of the room's floor.

import { vec3 } from './math.js';
import { MeshBuilder, box } from './mesh.js';
import { ROOMS } from '../world/interiors.data.js';

/**
 * The 1966 set palette.
 *
 * Sets built on a soundstage out of painted flats and coloured gel: mid greys,
 * warm off-whites, and saturated accents that only appear on the consoles. The
 * floor is darker than the ceiling to answer the downward key light — a floor
 * at the ceiling's value renders as a lightbox and the room loses its ceiling
 * entirely.
 */
export const PALETTE = {
  // docs/RESEARCH.md §8. The first build assumed a 1960s set was dark. It was
  // not — it was built for colour television at the moment colour television
  // arrived, and it is BRIGHT: very light neutral grey walls, grey carpet on
  // both levels, and international orange on the rail, the turbolift doors and
  // the helm housing. The orange is the colour of a traffic cone, and it is the
  // single strongest thing in the room.
  floor: [0.34, 0.33, 0.32],
  floorTrim: [0.42, 0.40, 0.38],
  wall: [0.80, 0.79, 0.77],
  wallLower: [0.66, 0.65, 0.63],
  ceiling: [0.86, 0.85, 0.83],
  orange: [0.92, 0.36, 0.05],        // international orange: rail, lift, helm
  console: [0.52, 0.52, 0.54],
  consoleTop: [0.40, 0.40, 0.43],
  trim: [0.72, 0.72, 0.74],
  chair: [0.80, 0.79, 0.78],         // the captain's chair is light grey
  crewChair: [0.55, 0.70, 0.86],     // the crew chairs are light blue
  bed: [0.80, 0.79, 0.76],
  door: [0.92, 0.36, 0.05],

  // The overhead display inserts: light greyish blue in a near-white border.
  insert: [0.62, 0.70, 0.80],
  insertBorder: [0.90, 0.92, 0.95],

  // Everything below is drawn into the glow mesh and ignores the light.
  panelGold: [0.98, 0.74, 0.12],
  panelTurquoise: [0.16, 0.86, 0.82],
  panelBlue: [0.24, 0.48, 0.96],
  panelRed: [0.94, 0.20, 0.14],
  panelGreen: [0.30, 0.86, 0.36],
  panelWhite: [0.96, 0.96, 0.90],
  strip: [0.94, 0.92, 0.82],
  core: [0.45, 0.72, 1.0],
  pad: [0.62, 0.86, 1.0],
};

/** The jelly-bean button colours, dealt out per station so no two adjoin. */
const PANEL_COLOURS = [
  PALETTE.panelGold, PALETTE.panelTurquoise, PALETTE.panelBlue,
  PALETTE.panelRed, PALETTE.panelGreen, PALETTE.panelWhite,
];

const WALL_HEIGHT = (room) => room.shape.height ?? 2.5;

/** A quad from four points, wound so its face points where `flip` says. */
function face(mb, a, b, c, d, colour, flip = false) {
  return flip ? mb.quad(d, c, b, a, colour) : mb.quad(a, b, c, d, colour);
}

// ------------------------------------------------------------------ shells

/**
 * The floor, walls and ceiling of a ring room.
 *
 * Built as a strip of quads rather than a cylinder primitive, because the wall
 * has to have HOLES in it — a doorway is a gap, and a room whose only exit is
 * painted on is a room you can see out of and not leave.
 */
function ringShell(solid, glow, room) {
  const R = room.shape.radius;
  const h = WALL_HEIGHT(room);
  const bays = room.shape.bays ?? 10;

  // TEN FLAT BAYS, not a cylinder. docs/RESEARCH.md §8: the set is ten wall
  // segments of 36 degrees, and each one is a station. A smooth wall is the
  // wrong room — the facets are what make it read as a built object, and they
  // are why ten departments is the right number rather than a coincidence.
  const corner = (i, y) => {
    const a = (i / bays) * Math.PI * 2 - Math.PI / bays;
    return vec3(Math.sin(a) * R, y, Math.cos(a) * R);
  };

  // Floor and ceiling as fans from the centre.
  //
  // The winding matters: back faces are culled, so a floor wound the wrong way
  // round is not a dark floor, it is NO floor — the first pass had both of
  // these inverted and the room had a black void above and below it.
  for (let i = 0; i < bays; i++) {
    const a0 = corner(i, 0);
    const a1 = corner(i + 1, 0);
    solid.tri(vec3(0, 0, 0), a0, a1, PALETTE.floor);
    solid.tri(vec3(0, h, 0), corner(i + 1, h), corner(i, h), PALETTE.ceiling);
  }

  for (let i = 0; i < bays; i++) {
    const p0 = corner(i, 0);
    const p1 = corner(i + 1, 0);
    const mx = (p0[0] + p1[0]) / 2;
    const mz = (p0[2] + p1[2]) / 2;
    const at = (t, y) => vec3(p0[0] + (p1[0] - p0[0]) * t, y, p0[2] + (p1[2] - p0[2]) * t);

    const door = (room.exits ?? []).find(
      (e) => Math.hypot(mx - e.at[0], mz - e.at[1]) < (e.width ?? 1.2),
    );
    const isViewer = room.viewscreen
      && Math.hypot(mx - room.viewscreen.at[0], mz - room.viewscreen.at[1]) < 1.6;

    if (door) {
      // A doorway in international orange, which is what the turbolift doors
      // were painted, with a lintel above so the gap reads as a door.
      face(solid, at(0, 2.15), at(1, 2.15), at(1, h), at(0, h), PALETTE.wall, true);
      face(solid, at(0, 0), at(0.08, 0), at(0.08, 2.15), at(0, 2.15), PALETTE.orange, true);
      face(solid, at(0.92, 0), at(1, 0), at(1, 2.15), at(0.92, 2.15), PALETTE.orange, true);
      face(glow, at(0.08, 2.10), at(0.92, 2.10), at(0.92, 2.15), at(0.08, 2.15), PALETTE.strip, true);
      continue;
    }

    if (isViewer) {
      // THE APERTURE. The main viewer is a hole in this bay, not a panel
      // painted on it: the exterior is rendered through the gap in a separate
      // pass, so a solid wall here would be a bridge with a picture of space
      // hung on the wall. The bay is drawn as a frame around the opening.
      const [u0, u1] = [0.10, 0.90];
      const [b, t] = [0.74, 2.30];
      face(solid, at(0, 0), at(1, 0), at(1, b), at(0, b), PALETTE.wallLower, true);
      face(solid, at(0, t), at(1, t), at(1, h), at(0, h), PALETTE.wall, true);
      face(solid, at(0, b), at(u0, b), at(u0, t), at(0, t), PALETTE.wall, true);
      face(solid, at(u1, b), at(1, b), at(1, t), at(u1, t), PALETTE.wall, true);
      // A lit surround, which is what makes the screen read as a screen.
      face(glow, at(u0 - 0.03, b - 0.05), at(u1 + 0.03, b - 0.05),
        at(u1 + 0.03, b), at(u0 - 0.03, b), PALETTE.panelGold, true);
      face(glow, at(u0 - 0.03, t), at(u1 + 0.03, t),
        at(u1 + 0.03, t + 0.05), at(u0 - 0.03, t + 0.05), PALETTE.panelGold, true);
      continue;
    }

    // Dado, upper wall, and the lit display insert above it — light greyish
    // blue in a near-white border, which is what the overhead panels were.
    face(solid, at(0, 0), at(1, 0), at(1, 0.62), at(0, 0.62), PALETTE.wallLower, true);
    face(solid, at(0, 0.62), at(1, 0.62), at(1, h), at(0, h), PALETTE.wall, true);
    face(solid, at(0.06, 1.62), at(0.94, 1.62), at(0.94, 2.26), at(0.06, 2.26),
      PALETTE.insertBorder, true);
    face(glow, at(0.12, 1.70), at(0.88, 1.70), at(0.88, 2.18), at(0.12, 2.18),
      PALETTE.insert, true);
  }

  // The ceiling light ring.
  for (let i = 0; i < bays * 2; i++) {
    const a0 = (i / (bays * 2)) * Math.PI * 2;
    const a1 = ((i + 1) / (bays * 2)) * Math.PI * 2;
    const r0 = R * 0.50;
    const r1 = R * 0.68;
    glow.quad(
      vec3(Math.sin(a0) * r0, h - 0.04, Math.cos(a0) * r0),
      vec3(Math.sin(a0) * r1, h - 0.04, Math.cos(a0) * r1),
      vec3(Math.sin(a1) * r1, h - 0.04, Math.cos(a1) * r1),
      vec3(Math.sin(a1) * r0, h - 0.04, Math.cos(a1) * r0),
      PALETTE.strip,
    );
  }

  // The command well, and the orange rail around it. The rail is the strongest
  // single object in the room and the reason the two levels read as two levels.
  if (room.well) {
    const wr = room.well.radius;
    const seg = bays * 3;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const s0 = vec3(Math.sin(a0) * wr, 0, Math.cos(a0) * wr);
      const s1 = vec3(Math.sin(a1) * wr, 0, Math.cos(a1) * wr);

      // The step down into the well.
      solid.quad(
        vec3(s0[0], 0, s0[2]), vec3(s1[0], 0, s1[2]),
        vec3(s1[0], room.well.drop, s1[2]), vec3(s0[0], room.well.drop, s0[2]),
        PALETTE.floorTrim,
      );

      // The rail: a bar at hand height on stanchions, in international orange.
      // Left open across the forward arc, because the captain has to be able to
      // see the viewer and walk to the helm.
      const mid = (a0 + a1) / 2;
      const forwardArc = Math.cos(mid) > 0.72;
      if (forwardArc) continue;
      const railY = 0.92;
      const rr = wr + 0.16;
      const r0 = vec3(Math.sin(a0) * rr, railY, Math.cos(a0) * rr);
      const r1 = vec3(Math.sin(a1) * rr, railY, Math.cos(a1) * rr);
      solid.quad(
        vec3(r0[0], railY - 0.06, r0[2]), vec3(r1[0], railY - 0.06, r1[2]),
        vec3(r1[0], railY + 0.06, r1[2]), vec3(r0[0], railY + 0.06, r0[2]),
        PALETTE.orange,
      );
      if (i % 3 === 0) {
        box(solid, {
          center: vec3(r0[0], railY / 2, r0[2]),
          size: vec3(0.07, railY, 0.07),
          color: PALETTE.orange,
        });
      }
    }
  }
}

/** The floor, walls and ceiling of a box room, with gaps where the doors are. */
function boxShell(solid, glow, room) {
  const hw = room.shape.width / 2;
  const hd = room.shape.depth / 2;
  const h = WALL_HEIGHT(room);

  solid.quad(vec3(-hw, 0, -hd), vec3(hw, 0, -hd), vec3(hw, 0, hd), vec3(-hw, 0, hd), PALETTE.floor);
  solid.quad(vec3(-hw, h, hd), vec3(hw, h, hd), vec3(hw, h, -hd), vec3(-hw, h, -hd), PALETTE.ceiling);

  // Each wall is cut into panels so a doorway can be left out of one of them.
  const walls = [
    { axis: 'z', at: hd, from: -hw, to: hw, flip: false },
    { axis: 'z', at: -hd, from: -hw, to: hw, flip: true },
    { axis: 'x', at: hw, from: -hd, to: hd, flip: true },
    { axis: 'x', at: -hw, from: -hd, to: hd, flip: false },
  ];

  for (const wall of walls) {
    const span = wall.to - wall.from;
    const panels = Math.max(3, Math.round(span / 0.9));
    for (let i = 0; i < panels; i++) {
      const u0 = wall.from + (span * i) / panels;
      const u1 = wall.from + (span * (i + 1)) / panels;
      const p = (u, y) => (wall.axis === 'z' ? vec3(u, y, wall.at) : vec3(wall.at, y, u));

      const mu = (u0 + u1) / 2;
      const mid = wall.axis === 'z' ? [mu, wall.at] : [wall.at, mu];
      const door = (room.exits ?? []).find(
        (e) => Math.hypot(mid[0] - e.at[0], mid[1] - e.at[1]) < (e.width ?? 1.2) * 0.6,
      );

      if (door) {
        face(solid, p(u0, 2.1), p(u1, 2.1), p(u1, h), p(u0, h), PALETTE.wall, wall.flip);
        face(glow, p(u0, 2.05), p(u1, 2.05), p(u1, 2.1), p(u0, 2.1), PALETTE.strip, wall.flip);
        continue;
      }

      face(solid, p(u0, 0), p(u1, 0), p(u1, 0.9), p(u0, 0.9), PALETTE.wallLower, wall.flip);
      face(solid, p(u0, 0.9), p(u1, 0.9), p(u1, h), p(u0, h), PALETTE.wall, wall.flip);
    }
  }

  // A lighting strip down the middle of the ceiling.
  glow.quad(
    vec3(-0.35, h - 0.03, -hd * 0.85), vec3(0.35, h - 0.03, -hd * 0.85),
    vec3(0.35, h - 0.03, hd * 0.85), vec3(-0.35, h - 0.03, hd * 0.85),
    PALETTE.strip,
  );
}

// ----------------------------------------------------------------- fittings

/**
 * A console: a wedge with a lit face.
 *
 * The wedge is the whole point. A vertical panel reads as a wall with lights on
 * it; a top surface angled toward the person standing at it reads as something
 * you operate, which is what every console on the set was.
 */
function console3d(solid, glow, station, index) {
  const [x, z] = station.at;
  // The helm/navigation housing is international orange, the same as the rail
  // and the turbolift doors — docs/RESEARCH.md §8. The wall consoles are grey.
  const housing = station.mounted === 'floor' ? PALETTE.orange : PALETTE.console;
  const yaw = station.facing ?? 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Local (right, forward) -> world, so a console faces the way the data says.
  const at = (r, up, f) => vec3(x + r * c + f * s, up, z - r * s + f * c);

  const hw = 0.52;
  const hd = 0.28;
  const bodyTop = 0.78;

  // The housing.
  solid.quad(at(-hw, 0, -hd), at(hw, 0, -hd), at(hw, bodyTop, -hd), at(-hw, bodyTop, -hd), housing);
  solid.quad(at(hw, 0, hd), at(-hw, 0, hd), at(-hw, bodyTop, hd), at(hw, bodyTop, hd), housing);
  solid.quad(at(-hw, 0, hd), at(-hw, 0, -hd), at(-hw, bodyTop, -hd), at(-hw, bodyTop, hd), housing);
  solid.quad(at(hw, 0, -hd), at(hw, 0, hd), at(hw, bodyTop, hd), at(hw, bodyTop, -hd), housing);

  // The angled working surface, rising away from whoever is standing at it.
  //
  // WOUND TO FACE THE OPERATOR. Going right-then-away puts the normal down and
  // forward, so the whole surface is culled as a back face: the console renders
  // as a box with an open top and the buttons on it vanish. That is what
  // happened, on every console in the game, and it took the chair's arm caps
  // failing the same way for anybody to notice — the jelly beans are the single
  // most recognisable thing about this set and none of them were ever drawn.
  const near = bodyTop;
  const far = bodyTop + 0.30;
  solid.quad(at(-hw, near, -hd), at(-hw, far, hd), at(hw, far, hd), at(hw, near, -hd),
    PALETTE.consoleTop);

  // And the buttons on it — the jelly beans, which is the glow.
  //
  // CIRCLES AND TRIANGLES, not rectangles. docs/RESEARCH.md §8 is explicit:
  // the controls were moulded resin caps in circles and triangles, and some of
  // them were literally jelly beans. A grid of coloured squares is a computer
  // keyboard; a scatter of round and triangular caps in five flat colours is
  // 1966, and it is most of what makes the console read as a period object
  // rather than as science fiction generally.
  //
  // The shapes are deterministic per station index, so a console looks the same
  // every time you walk up to it. A console that reshuffles its own controls
  // between visits is not a console.
  const colour = PANEL_COLOURS[index % PANEL_COLOURS.length];
  const rows = 3;
  const cols = 6;
  const lerp = (t) => [near + (far - near) * t + 0.008, -hd + (hd * 2) * t];

  // A tiny fixed hash, so the layout is stable and every console differs.
  let h = (index + 1) * 0x9e3779b9;
  const rnd = () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const pick = rnd();
      // Not every position carries a cap. A fully populated grid is the
      // giveaway that a machine laid it out.
      if (pick < 0.22) continue;

      const cu = -hw + 0.11 + ((col + 0.5) * (hw * 2 - 0.22)) / cols;
      const ct = (r + 0.5) / rows;
      const [cy, cf] = lerp(ct);
      const rad = 0.028 + rnd() * 0.014;
      // The cap sits ON the angled surface, so a step across it moves in y and
      // in f together — the same lerp the grid uses, one row-fraction wide.
      const [dy, df] = (() => {
        const [ay, af] = lerp(ct - 0.5 / rows);
        const [by, bf] = lerp(ct + 0.5 / rows);
        return [(by - ay) * 0.5, (bf - af) * 0.5];
      })();

      const shade = PANEL_COLOURS[Math.floor(rnd() * PANEL_COLOURS.length)]
        ?? colour;

      // A point on the cap's rim, `k` of the way round.
      const rim = (k, scale = 1) => {
        const a = k * Math.PI * 2;
        const su = Math.cos(a) * rad * scale;
        const sv = Math.sin(a) * scale;
        return at(cu + su, cy + dy * sv, cf + df * sv);
      };

      if (pick < 0.62) {
        // A circle, as an octagon. At phone size nobody counts the sides, and
        // eight is the point where a disc stops reading as a polygon.
        // Wound so the fan faces UP the slope. Walking the rim the other way
        // round points every one of these at the deck, and the winding check in
        // tests/gfx.test.js caught exactly that the first time this ran — which
        // is the whole reason that check exists.
        const centre = at(cu, cy, cf);
        for (let k = 0; k < 8; k++) {
          glow.tri(centre, rim((k + 1) / 8), rim(k / 8), shade);
        }
      } else {
        // A triangle, pointing up the slope — away from the operator, which is
        // how they sit on the prop.
        glow.tri(rim(0.25, 1.15), rim(0.9167, 1.15), rim(0.5833, 1.15), shade);
      }
    }
  }
}

/** Furniture, by kind. Deliberately blocky: the sets were, too. */
function prop3d(solid, glow, prop) {
  const [x, z] = prop.at;
  const r = prop.radius || 0.3;

  switch (prop.kind) {
    case 'chair': {
      // The command chair, built to be seen from IN it.
      //
      // The arm panels sit forward of the seat centre and at the height a
      // forearm rests, so they come into the bottom of frame from the seated
      // camera. Of every control on the real prop exactly three were ever given
      // a function on screen — yellow alert, red alert, jettison the pod — and
      // they are the three caps on the right arm.
      // Height and reach chosen against the seated camera, not against a
      // furniture catalogue: at eye height 1.18 with a 44-degree half-field,
      // the bottom of frame at half a metre ahead is y=0.63. Arm panels below
      // that are arm panels nobody in the chair ever sees.
      const armY = 0.80;
      const armF = r * 0.75;
      box(solid, { center: vec3(x, 0.26, z), size: vec3(r * 1.6, 0.52, r * 1.6), color: PALETTE.chair });
      box(solid, { center: vec3(x, 0.86, z - r * 0.72), size: vec3(r * 1.5, 0.70, 0.18), color: PALETTE.chair });
      // A padded headrest, which the prop had and which frames the view.
      box(solid, { center: vec3(x, 1.26, z - r * 0.72), size: vec3(r * 0.9, 0.22, 0.20), color: PALETTE.chair });

      for (const side of [-1, 1]) {
        box(solid, {
          center: vec3(x + side * r * 0.92, armY - 0.10, z + armF),
          size: vec3(0.26, 0.22, r * 1.3), color: PALETTE.chair,
        });
        box(solid, {
          center: vec3(x + side * r * 0.92, armY, z + armF),
          size: vec3(0.30, 0.07, r * 1.4), color: PALETTE.console,
        });
      }

      // The three that meant something, on the starboard arm.
      // A cap lying on an arm rest faces UP, and the winding is what says so.
      // Wound the other way round these were culled as back faces and the arms
      // were two blank grey slabs — the same mistake as the deck fans, one
      // prop further in.
      const cap = (cx, cf, colour) => glow.quad(
        vec3(cx - r * 0.12, armY + 0.032, z + cf - r * 0.16),
        vec3(cx - r * 0.12, armY + 0.032, z + cf + r * 0.16),
        vec3(cx + r * 0.12, armY + 0.032, z + cf + r * 0.16),
        vec3(cx + r * 0.12, armY + 0.032, z + cf - r * 0.16),
        colour,
      );

      const caps = [PALETTE.panelRed, PALETTE.panelGold, PALETTE.panelWhite];
      caps.forEach((colour, i) => cap(x + r * 0.92, armF + (i - 1) * r * 0.38, colour));
      // The port arm carries the viewer and intercom controls.
      for (let i = 0; i < 3; i++) {
        cap(x - r * 0.92, armF + (i - 1) * r * 0.38,
          i === 1 ? PALETTE.panelTurquoise : PALETTE.panelBlue);
      }
      break;
    }

    case 'bed':
      box(solid, { center: vec3(x, 0.32, z), size: vec3(r * 1.4, 0.64, r * 2.2), color: PALETTE.bed });
      glow.quad(
        vec3(x - r * 0.6, 0.645, z - r), vec3(x + r * 0.6, 0.645, z - r),
        vec3(x + r * 0.6, 0.645, z + r), vec3(x - r * 0.6, 0.645, z + r),
        PALETTE.panelTurquoise,
      );
      break;

    case 'table':
      box(solid, { center: vec3(x, 0.36, z), size: vec3(r * 2, 0.08, r * 1.4), color: PALETTE.bed });
      box(solid, { center: vec3(x, 0.18, z), size: vec3(r * 0.5, 0.36, r * 0.5), color: PALETTE.console });
      break;

    case 'core': {
      // The reactor: a lit column through the whole height of the room.
      const seg = 12;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        const A = vec3(x + Math.sin(a0) * r, 0, z + Math.cos(a0) * r);
        const B = vec3(x + Math.sin(a1) * r, 0, z + Math.cos(a1) * r);
        const C = vec3(x + Math.sin(a1) * r, 3.4, z + Math.cos(a1) * r);
        const D = vec3(x + Math.sin(a0) * r, 3.4, z + Math.cos(a0) * r);
        glow.quad(A, B, C, D, PALETTE.core);
      }
      break;
    }

    case 'conduit':
      box(solid, { center: vec3(x, 1.7, z), size: vec3(r * 2, 3.4, r * 2), color: PALETTE.trim });
      break;

    case 'pad':
      // A transporter pad: a lit disc in the deck.
      glow.quad(
        vec3(x - r, 0.02, z - r), vec3(x + r, 0.02, z - r),
        vec3(x + r, 0.02, z + r), vec3(x - r, 0.02, z + r),
        PALETTE.pad,
      );
      break;

    case 'locker':
      box(solid, { center: vec3(x, 0.9, z), size: vec3(r * 1.6, 1.4, 0.14), color: PALETTE.trim });
      break;

    case 'wallpanel':
      glow.quad(
        vec3(x - 0.02, 1.1, z - 0.4), vec3(x - 0.02, 1.1, z + 0.4),
        vec3(x - 0.02, 1.7, z + 0.4), vec3(x - 0.02, 1.7, z - 0.4),
        PALETTE.panelTurquoise,
      );
      break;

    default:
      if (prop.solid) {
        box(solid, { center: vec3(x, 0.4, z), size: vec3(r * 2, 0.8, r * 2), color: PALETTE.console });
      }
  }
}

/**
 * An officer at a post.
 *
 * Blocky on purpose — this renderer is flat-shaded with no textures and no
 * skinning, and a low-polygon figure in a uniform colour reads as a person at a
 * console far better than a detailed one would at phone size. What matters is
 * that the room is CREWED: a bridge with ten empty stations is a museum, and
 * the whole point of walking to a console is that somebody is usually already
 * working it.
 *
 * The uniform colour is the division, which is the one thing about a crewman
 * you are supposed to be able to read across a room.
 */
const DIVISION_COLOUR = {
  command: [0.86, 0.72, 0.18],       // gold
  helm: [0.86, 0.72, 0.18],
  comms: [0.68, 0.16, 0.16],         // red
  engineering: [0.68, 0.16, 0.16],
  security: [0.68, 0.16, 0.16],
  damagecontrol: [0.68, 0.16, 0.16],
  environmental: [0.68, 0.16, 0.16],
  ops: [0.68, 0.16, 0.16],
  science: [0.20, 0.42, 0.72],       // blue
  medical: [0.20, 0.42, 0.72],
  tactical: [0.86, 0.72, 0.18],
  transporter: [0.68, 0.16, 0.16],
};
const SKIN = [0.78, 0.62, 0.50];

function officer3d(solid, station) {
  const colour = DIVISION_COLOUR[station.crew] ?? [0.6, 0.6, 0.62];
  const yaw = station.facing ?? 0;
  // Standing at the console, on the near side of it — which is the side away
  // from the wall the console is set into.
  const back = station.mounted === 'wall' ? -0.72 : -0.74;
  const x = station.at[0] + Math.sin(yaw) * back;
  const z = station.at[1] + Math.cos(yaw) * back;

  // A seated officer at a floor console, standing at a wall one.
  const seated = station.mounted === 'floor';
  const hip = seated ? 0.46 : 0.50;
  const shoulder = seated ? 1.06 : 1.34;

  if (seated) {
    // The chair under them: light blue, which is what the crew chairs were.
    // The back stops below shoulder height — a tall back in front of the
    // command chair is a wall across the viewscreen.
    box(solid, {
      center: vec3(x, 0.22, z), size: vec3(0.40, 0.44, 0.40), color: PALETTE.crewChair,
    });
    box(solid, {
      center: vec3(x - Math.sin(yaw) * 0.21, 0.60, z - Math.cos(yaw) * 0.21),
      size: vec3(0.40, 0.32, 0.09), color: PALETTE.crewChair,
    });
  } else {
    box(solid, { center: vec3(x, hip / 2, z), size: vec3(0.24, hip, 0.20), color: [0.16, 0.16, 0.18] });
  }

  // Torso, arms, head.
  box(solid, {
    center: vec3(x, (hip + shoulder) / 2, z),
    size: vec3(0.40, shoulder - hip, 0.24), color: colour,
  });
  box(solid, {
    center: vec3(x + Math.cos(yaw) * 0.26, shoulder - 0.16, z - Math.sin(yaw) * 0.26),
    size: vec3(0.11, 0.34, 0.11), color: colour,
  });
  box(solid, {
    center: vec3(x - Math.cos(yaw) * 0.26, shoulder - 0.16, z + Math.sin(yaw) * 0.26),
    size: vec3(0.11, 0.34, 0.11), color: colour,
  });
  box(solid, {
    center: vec3(x, shoulder + 0.14, z), size: vec3(0.20, 0.24, 0.20), color: SKIN,
  });
}

/** The viewscreen: a dark rectangle in the forward wall with a lit surround. */
function viewscreen3d(solid, glow, vs) {
  const [x, z] = vs.at;
  const w = vs.width / 2;
  const h = vs.height / 2;
  const y = 1.55;
  const inset = 0.06;
  const scale = Math.hypot(x, z) || 1;
  const nx = -x / scale;
  const nz = -z / scale;
  const at = (u, v, d) => vec3(
    x + u * -nz + nx * d,
    y + v,
    z + u * nx + nz * d,
  );

  glow.quad(at(-w - 0.14, -h - 0.14, inset), at(w + 0.14, -h - 0.14, inset),
    at(w + 0.14, h + 0.14, inset), at(-w - 0.14, h + 0.14, inset), PALETTE.panelGold);
  solid.quad(at(-w, -h, inset + 0.01), at(w, -h, inset + 0.01),
    at(w, h, inset + 0.01), at(-w, h, inset + 0.01), [0.05, 0.06, 0.09]);
}

// ------------------------------------------------------------- occlusion

/**
 * Bake ambient occlusion into the vertex colours.
 *
 * The single largest perceptual gain available to this renderer, and it costs
 * nothing per frame: corners, floor lines and the undersides of consoles get
 * darker in the mesh itself, once, at build time.
 *
 * Why it matters more here than in the tactical view: a hull in space has one
 * hard light and a black background, so its shape reads from the shading alone.
 * A room lit almost flat — which is what a bridge with pale walls bouncing at
 * each other actually is — has no such cue, and without contact shadows every
 * surface floats. Consoles looked stuck onto the wall rather than set into it,
 * and the floor met the bulkhead in a hard line with no join.
 *
 * This is a distance field, not a ray cast. Proximity to the room's own
 * surfaces plus proximity to each solid object, which for boxes and circles is
 * exact and for everything else is close enough that nobody has ever looked at
 * a corner and thought about it.
 */
function bakeOcclusion(mb, room) {
  const h = WALL_HEIGHT(room);
  const isRing = room.shape.kind === 'ring';
  const hw = isRing ? 0 : room.shape.width / 2;
  const hd = isRing ? 0 : room.shape.depth / 2;
  const R = isRing ? room.shape.radius : 0;

  // Occluders: the solid furniture, as circles on the floor.
  const occluders = [
    ...(room.props ?? []).filter((p) => p.solid && p.radius > 0)
      .map((p) => ({ x: p.at[0], z: p.at[1], r: p.radius })),
    ...(room.stations ?? []).map((st) => ({ x: st.at[0], z: st.at[1], r: 0.55 })),
  ];

  const REACH = 0.85;        // how far a contact shadow spreads
  const FLOOR = 0.55;        // and how far up a wall the floor darkens it

  for (let i = 0; i < mb.positions.length; i += 3) {
    const x = mb.positions[i];
    const y = mb.positions[i + 1];
    const z = mb.positions[i + 2];

    let ao = 1;

    // WHICH SURFACE THIS IS, from its normal. A wall must not occlude itself:
    // every vertex of a flat wall sits at zero distance from the wall, so a
    // naive distance term dimmed entire bulkheads by a third and the bright
    // 1966 set went grey again. Horizontal surfaces are darkened by their
    // distance to a WALL; vertical ones by their distance to the FLOOR. Each
    // gets the shadow the other casts, and neither gets its own.
    const up = Math.abs(mb.normals[i + 1]);
    const horizontal = up > 0.7;

    if (!horizontal) {
      // A wall, a console face, a person: darkened where it meets the deck,
      // and slightly where it meets the deckhead.
      if (y < FLOOR) ao *= 0.66 + 0.34 * (y / FLOOR);
      if (y > h - 0.35) ao *= 0.90 + 0.10 * ((h - y) / 0.35);
    } else {
      // Deck or deckhead: darkened where the bulkhead meets it.
      const wall = isRing
        ? R - Math.hypot(x, z)
        : Math.min(hw - Math.abs(x), hd - Math.abs(z));
      if (wall < REACH) ao *= 0.62 + 0.38 * Math.max(0, wall / REACH);
    }

    // Furniture, which darkens the deck around its base and itself near it.
    for (const o of occluders) {
      const d = Math.hypot(x - o.x, z - o.z) - o.r;
      if (d < REACH && y < 1.3) {
        const t = Math.max(0, d) / REACH;
        // Strongest at the base and gone by console height, which is how a
        // contact shadow behaves and why it reads as contact.
        const height = 1 - Math.min(1, Math.max(0, y) / 1.3);
        ao *= 1 - (1 - (0.55 + 0.45 * t)) * height;
      }
    }

    ao = Math.max(0.42, ao);
    mb.colors[i] *= ao;
    mb.colors[i + 1] *= ao;
    mb.colors[i + 2] *= ao;
  }
  return mb;
}

// -------------------------------------------------------------------- build

const CACHE = new Map();

/**
 * Geometry for one room.
 *
 * @returns {{solid: object, glow: object, triangles: number}}
 *          two built meshes, ready for `Renderer.draw`
 */
export function roomMeshes(roomId) {
  const cached = CACHE.get(roomId);
  if (cached) return cached;

  const room = ROOMS[roomId];
  if (!room) return null;

  const solid = new MeshBuilder();
  const glow = new MeshBuilder();

  if (room.shape.kind === 'ring') ringShell(solid, glow, room);
  else boxShell(solid, glow, room);

  (room.stations ?? []).forEach((s, i) => {
    console3d(solid, glow, s, i);
    // Crewed, if the station belongs to a department. A bridge with ten empty
    // consoles is a museum.
    if (s.crew) officer3d(solid, s);
  });
  for (const p of room.props ?? []) prop3d(solid, glow, p);
  if (room.viewscreen) viewscreen3d(solid, glow, room.viewscreen);

  // Only the lit mesh. The glow mesh is self-lit by definition — a panel that
  // ignores the light must also ignore the shadow, or a console in a corner has
  // dim buttons for no reason anybody could point at.
  bakeOcclusion(solid, room);

  const built = {
    solid: solid.build(),
    glow: glow.build(),
    triangles: solid.triangleCount + glow.triangleCount,
  };
  CACHE.set(roomId, built);
  return built;
}

/** Every room's geometry, for the budget check. */
export function allRoomMeshes() {
  return Object.keys(ROOMS).map((id) => ({ id, ...roomMeshes(id) }));
}
