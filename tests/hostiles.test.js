// The hulls the player actually fights.
//
// Thirteen Federation classes carry between 716 and 2,142 triangles, a band of
// lit ports round the rim, two more rows on the plate, ports down each flank of
// the secondary hull, a copper deflector, an impulse deck and glowing bussard
// domes. Every Klingon class carried 241 triangles, no ports at all, and it was
// the SAME 241: a Bird-of-Prey is a 158-metre raider with three decks and
// thirty-six aboard and a Negh'Var is a 682-metre battleship with thirty-five
// decks and two and a half thousand, and they were one mesh at two sizes.
//
// The game already had a test that would have caught it — `no two Federation
// classes are the same shape` — and it was scoped to one faction. Held to that
// same bar, a D7 and a K't'inga measured 0.085 apart against the 0.2 every
// Federation pair has to clear.
//
// These tests are the same bar, applied to everybody, plus the two shape
// failures that writing the new hulls exposed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  hullMesh, BLUEPRINTS, DIMENSIONS, paletteFor, proportionError,
} from '../src/gfx/blueprint.js';
import { SHIP_LIST } from '../src/world/ships.data.js';
import { MeshBuilder, box, prow, greebles, PORT_LIGHT } from '../src/gfx/mesh.js';
import { vec3 } from '../src/gfx/math.js';

const FACTION = Object.fromEntries(SHIP_LIST.map((s) => [s.id, s.faction]));
const mesh = (id) => hullMesh(id, FACTION[id] ?? 'independent');
const classesOf = (faction) => SHIP_LIST
  .filter((s) => s.faction === faction && BLUEPRINTS[s.id] && DIMENSIONS[s.id])
  .map((s) => s.id);

/**
 * The colour mesh.js gives a lit port — imported, not copied.
 *
 * A written-out copy is a second source of truth for the one value every
 * assertion in this file keys off, and a form that drifted a hundredth away
 * from it would leave every port on the ship invisible to these tests while
 * looking perfectly correct on screen.
 */
const WINDOW = PORT_LIGHT;
const near = (a, b, eps = 2e-3) => a.every((v, i) => Math.abs(v - b[i]) < eps);

const vertex = (m, i) => {
  const f = m.stride / 4;
  return {
    at: [m.data[i * f], m.data[i * f + 1], m.data[i * f + 2]],
    color: [m.data[i * f + 6], m.data[i * f + 7], m.data[i * f + 8]],
    glow: m.data[i * f + 9],
  };
};

const isPort = (v) => near(v.color, WINDOW) && v.glow > 0.5;

/** The forms that build a hull somebody shoots at, and the classes on them. */
const HOSTILE_FORMS = [
  'raptor', 'kdf_cruiser', 'wedge', 'dominion', 'tholian', 'warbird', 'marauder',
];
const HOSTILE = Object.entries(BLUEPRINTS)
  .filter(([, b]) => HOSTILE_FORMS.includes(b.form))
  .map(([id]) => id);

// ======================================================= one shape per class

describe('no two classes of a faction are the same shape', () => {
  /**
   * The fingerprint from tests/gfx.test.js, moved out of the Federation-only
   * suite it was written in and applied to everybody.
   *
   * Normalised to unit length, so this compares SILHOUETTE and not size, and
   * hull only — lit geometry is decoration applied by the same rules to every
   * class, so counting it measures what the classes have in COMMON.
   */
  function fingerprint(id) {
    const m = mesh(id);
    const f = m.stride / 4;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < m.vertexCount; i++) {
      lo = Math.min(lo, m.data[i * f]);
      hi = Math.max(hi, m.data[i * f]);
    }
    const span = hi - lo || 1;
    const slices = new Array(12).fill(0);
    for (let i = 0; i < m.vertexCount; i++) {
      if (m.data[i * f + 9] > 0) continue;
      const x = m.data[i * f];
      const k = Math.min(11, Math.floor(((x - lo) / span) * 12));
      slices[k] = Math.max(slices[k],
        Math.hypot(m.data[i * f + 1], m.data[i * f + 2]) / span);
    }
    return slices;
  }

  test('every faction with more than one class has more than one shape', () => {
    // The bar is 0.2, the same number the Federation suite uses and for the
    // same reason: building every hull to its published beam and height pulls
    // the fingerprints together, so the margin has to come from real
    // structural difference.
    //
    // Held to it before this change, the Klingon fleet failed on d7/ktinga at
    // 0.085 — two classes with identical published dimensions to the metre
    // (152 by 60 on 228 and 235), so nothing about proportion could ever have
    // separated them and the refit's ribbed hull had to be built.
    const factions = [...new Set(SHIP_LIST.map((s) => s.faction))];
    const same = [];
    let pairs = 0;
    for (const faction of factions) {
      const ids = classesOf(faction);
      if (ids.length < 2) continue;
      const prints = new Map(ids.map((id) => [id, fingerprint(id)]));
      for (const a of ids) {
        for (const b of ids) {
          if (a >= b) continue;
          pairs++;
          const pa = prints.get(a);
          const pb = prints.get(b);
          const diff = pa.reduce((n, v, i) => n + Math.abs(v - pb[i]), 0);
          if (diff < 0.2) same.push(`${a} and ${b} (${diff.toFixed(3)})`);
        }
      }
    }
    // The denominator, so a fingerprint that silently stopped producing pairs
    // cannot pass this by measuring nothing.
    assert.ok(pairs > 80, `only ${pairs} pairs of classes were compared`);
    assert.deepEqual(same, [],
      'these classes are built as the same shape at different sizes');
  });

  test('the Klingon cruisers are cruisers and the raiders are raptors', () => {
    // Topology, not proportion. Four cruisers on one form and three raiders on
    // the other; the four were on the raider form, which is why no setting of
    // its parameters could give a D7 the long neck and boom it is known for.
    const FORM = {
      bird_of_prey: 'raptor', scoutship: 'raptor', orion_raider: 'raptor',
      d7: 'kdf_cruiser', ktinga: 'kdf_cruiser',
      vorcha: 'kdf_cruiser', neghvar: 'kdf_cruiser',
    };
    for (const [id, form] of Object.entries(FORM)) {
      assert.equal(BLUEPRINTS[id].form, form, `${id} is built by the wrong form`);
    }
  });

  test('the refit is a refit: the K’tinga carries what the D7 does not', () => {
    // The one difference that has to be BUILT, since the published figures are
    // the same. A control on the pair above: it would pass on any two shapes
    // that differ, including two that differ by accident.
    assert.equal(BLUEPRINTS.d7.spine ?? false, false, 'the D7 has grown a ribbed spine');
    for (const id of ['ktinga', 'vorcha', 'neghvar']) {
      assert.ok(BLUEPRINTS[id].spine, `${id} has lost its spine`);
    }
    assert.ok(BLUEPRINTS.vorcha.prow && BLUEPRINTS.neghvar.prow,
      'the two later cruisers have lost their forward wings');
    assert.ok(!BLUEPRINTS.d7.prow && !BLUEPRINTS.ktinga.prow,
      'a D7 has grown forward wings it does not have');
  });
});

// ============================================================ lights on board

describe('a ship with a crew has lights on', () => {
  test('every hull the new forms build has lit ports', () => {
    for (const id of HOSTILE) {
      const m = mesh(id);
      let ports = 0;
      for (let i = 0; i < m.vertexCount; i++) if (isPort(vertex(m, i))) ports++;
      assert.ok(ports >= 12, `${id} has ${ports} port vertices — nobody is aboard`);
    }
    assert.ok(HOSTILE.length >= 14,
      `only ${HOSTILE.length} classes were checked`);
  });

  test('and the hulls that still have none are named, not forgotten', () => {
    // The omission, asserted. Two forms still build a ship with nobody
    // aboard, and both have an argument: `compact` is a Defiant and a runabout,
    // a warship with almost no habitable hull and a four-berth shuttle, and
    // `cube` is the Borg, who do not fit windows. When either gains ports this
    // list shrinks and this test says so, which is the point of writing it
    // down. `hauler`, which is not on this list, is a civilian freighter and
    // has had them all along.
    const dark = [];
    for (const id of Object.keys(BLUEPRINTS)) {
      const m = mesh(id);
      let ports = 0;
      for (let i = 0; i < m.vertexCount; i++) if (isPort(vertex(m, i))) ports++;
      if (ports === 0) dark.push(BLUEPRINTS[id].form);
    }
    assert.deepEqual([...new Set(dark)].sort(),
      ['compact', 'cube'],
      'the set of forms that build a ship with nobody aboard has changed');
  });

  test('a hull is lit with trim, not upholstered in light', () => {
    // Area-weighted, because a port is a tiny quad and a hull face is a large
    // one, and counting VERTICES rates a Constitution as 51% lit. Measured
    // across the fleet the true figure is 3.8% to 10%.
    for (const id of Object.keys(BLUEPRINTS)) {
      const m = mesh(id);
      const f = m.stride / 4;
      let total = 0;
      let lit = 0;
      for (let t = 0; t < m.vertexCount; t += 3) {
        const p = (k) => [0, 1, 2].map((j) => m.data[(t + k) * f + j]);
        const [a, b, c] = [p(0), p(1), p(2)];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const area = Math.hypot(
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ) / 2;
        total += area;
        if (m.data[t * f + 9] > 0.5) lit += area;
      }
      assert.ok(total > 0, `${id} has no surface at all`);
      const pct = (lit / total) * 100;
      assert.ok(pct < 15, `${id} is ${pct.toFixed(1)}% self-lit — that is a sign, not a ship`);
      assert.ok(pct > 1, `${id} is ${pct.toFixed(1)}% self-lit — it is drifting, not sailing`);
    }
  });

  test('the ports are proud of the hull they are set in', () => {
    // #134's failure, which this change could repeat in a new place: geometry
    // placed INSIDE the shape it decorates, paid for and invisible from every
    // angle. Measured by SLICING, for the reason that test gives — a tube has
    // vertices only at its two ends, so asking whether any hull vertex sits
    // near a port answers "none" for a buried port and a proud one alike.
    //
    // A port has to be outermost in ONE direction, not in all four. A row of
    // lights on the top of a wing is behind that wing measured sideways and in
    // plain view from above, and an earlier version of this test only looked
    // sideways — which would have forced every port in the fleet onto a flank
    // whether or not that is where a light can be seen from.
    let checked = 0;
    for (const id of HOSTILE) {
      const m = mesh(id);
      const f = m.stride / 4;
      const tri = (t) => [0, 1, 2].map((k) =>
        [0, 1, 2].map((j) => m.data[(t + k) * f + j]));

      /**
       * How far a chosen surface reaches along `axis` on the plane x = X,
       * within a band of the other cross-axis.
       */
      const reach = (X, axis, sign, lo, hi, pick) => {
        const other = axis === 1 ? 2 : 1;
        let best = -Infinity;
        for (let t = 0; t < m.vertexCount; t += 3) {
          if (!pick(vertex(m, t))) continue;
          const v = tri(t);
          for (let k = 0; k < 3; k++) {
            const a = v[k];
            const b = v[(k + 1) % 3];
            if ((a[0] - X) * (b[0] - X) > 0 || a[0] === b[0]) continue;
            const u = (X - a[0]) / (b[0] - a[0]);
            const p1 = a[axis] + u * (b[axis] - a[axis]);
            const p2 = a[other] + u * (b[other] - a[other]);
            if (p2 >= lo && p2 <= hi) best = Math.max(best, p1 * sign);
          }
        }
        return best;
      };

      // The hull's own centre in y and z, so "outermost to starboard" is only
      // asked of a port that is ON the starboard side. Without it a port at
      // z = +0.166 was compared against the hull's reach to PORT, found less
      // negative, and reported as buried — a comparison with no meaning that
      // happened to be the only one that ran.
      let midY = 0;
      let midZ = 0;
      {
        let loY = Infinity; let hiY = -Infinity;
        let loZ = Infinity; let hiZ = -Infinity;
        for (let i = 0; i < m.vertexCount; i++) {
          loY = Math.min(loY, m.data[i * f + 1]); hiY = Math.max(hiY, m.data[i * f + 1]);
          loZ = Math.min(loZ, m.data[i * f + 2]); hiZ = Math.max(hiZ, m.data[i * f + 2]);
        }
        midY = (loY + hiY) / 2;
        midZ = (loZ + hiZ) / 2;
      }
      const mid = [0, midY, midZ];

      let ports = 0;
      let here = 0;
      let against = 0;
      for (let t = 0; t < m.vertexCount; t += 3) {
        if (!isPort(vertex(m, t))) continue;
        const v = tri(t);
        ports++;
        const X = (v[0][0] + v[1][0] + v[2][0]) / 3;
        const band = (axis) => {
          const lo = Math.min(...v.map((q) => q[axis])) - 0.004;
          const hi = Math.max(...v.map((q) => q[axis])) + 0.004;
          return [lo, hi];
        };
        let compared = false;
        let outside = false;
        const why = [];
        for (const [axis, sign] of [[2, 1], [2, -1], [1, 1], [1, -1]]) {
          const own = v.reduce((n, q) => n + q[axis], 0) / 3;
          if (sign * (own - mid[axis]) <= 0) continue;
          const [lo, hi] = band(axis === 1 ? 2 : 1);
          const port = reach(X, axis, sign, lo, hi, isPort);
          const hull = reach(X, axis, sign, lo, hi, (q) => !isPort(q) && q.glow < 0.5);
          why.push(`${axis === 1 ? 'y' : 'z'}${sign > 0 ? '+' : '-'} `
            + `port ${port.toFixed(4)} hull ${hull.toFixed(4)}`);
          if (!Number.isFinite(port)) continue;
          compared = true;
          // No hull beyond the port in a direction it faces is the clearest
          // possible pass: there is nothing there to hide behind. Treating it
          // as "nothing to compare" instead — which the first version did —
          // threw away exactly the ports that are most obviously visible.
          if (!Number.isFinite(hull)) { outside = true; break; }
          against++;
          if (port >= hull - 1e-4) { outside = true; break; }
        }
        if (!compared) continue;
        here++;
        checked++;
        // The REASON, not just the refusal: which directions were tried, how
        // far the port reached in each, and how far the hull reached past it.
        assert.ok(outside,
          `${id}'s port at x=${X.toFixed(3)} is inside the hull from every `
          + `direction — ${why.join('; ')}`);
      }
      assert.ok(ports >= 6, `${id} has ${ports} port faces`);
      // The denominator, PER CLASS. Without it a filter that had quietly
      // stopped matching would pass this by making no comparison at all —
      // which is the failure the original grille measurement shipped with —
      // and a single fleet-wide count would let one class contribute nothing
      // while the others carried it.
      assert.ok(here >= 4,
        `${id} had ${here} of its ${ports} ports over any hull at all`);
      // And at least some of them were held against real hull rather than
      // passing on an empty sky, or the class contributes nothing.
      assert.ok(against >= 2,
        `${id} never once compared a port against the hull it is set in`);
    }
    assert.ok(checked > 100, `only ${checked} ports were actually compared`);
  });
});

// ==================================================== a ship is one object

describe('a hull is one object, not several near each other', () => {
  /**
   * Whether the hull has a horizontal slice with nothing in it.
   *
   * Sampled along triangle EDGES rather than at vertices: a tall face spanning
   * a band has no vertex inside it, and counting vertices alone reports a hole
   * through the middle of every box in the fleet.
   */
  function bandsOf(m, n = 20) {
    const f = m.stride / 4;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < m.vertexCount; i++) {
      lo = Math.min(lo, m.data[i * f + 1]);
      hi = Math.max(hi, m.data[i * f + 1]);
    }
    const bands = new Array(n).fill(0);
    for (let t = 0; t < m.vertexCount; t += 3) {
      const y = (k) => m.data[(t + k) * f + 1];
      for (let k = 0; k < 3; k++) {
        const a = y(k);
        const b = y((k + 1) % 3);
        for (let s = 0; s <= 48; s++) {
          const v = a + ((b - a) * s) / 48;
          bands[Math.min(n - 1, Math.floor(((v - lo) / (hi - lo)) * n))]++;
        }
      }
    }
    return bands.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  }

  const emptyBands = (id, n = 20) => bandsOf(mesh(id), n);

  test('no hull anywhere in the fleet has one', () => {
    // The `wedge` classes used to. It hung a lit sensor sphere at x = 0.55 on
    // a hull whose forward face is at 0.5 of its own `length_`, so four of the
    // five had a ball floating in clear space ahead of the ship — a hole
    // through the hull that this measurement reported and nothing else would
    // have. `raptor` had one too: `wingDroop` was an offset applied to the
    // wing, the nacelle and the cannon each by a different fraction, so a
    // Bird-of-Prey was four objects in a diagonal line.
    const gapped = Object.keys(BLUEPRINTS).filter((id) => emptyBands(id).length > 0);
    assert.deepEqual(gapped, [], 'these hulls have a horizontal slice with no ship in it');
  });

  test('and the measurement can see one that does', () => {
    // The control, built rather than borrowed: with the fleet clean there is
    // nothing left in it to prove this can fail, and an assertion with nothing
    // that fails it is an assertion that measures nothing.
    const apart = new MeshBuilder();
    box(apart, { center: vec3(0, 0, 0), size: vec3(1, 0.2, 0.4) });
    box(apart, { center: vec3(0, 1, 0), size: vec3(0.2, 0.2, 0.2) });
    assert.ok(bandsOf(apart.build()).length > 0,
      'a ball floating a whole hull-length above the ship reads as one object');

    // And the same two boxes touching do not.
    const joined = new MeshBuilder();
    box(joined, { center: vec3(0, 0, 0), size: vec3(1, 0.2, 0.4) });
    box(joined, { center: vec3(0, 0.15, 0), size: vec3(0.2, 0.2, 0.2) });
    assert.deepEqual(bandsOf(joined.build()), [],
      'two boxes that touch are reported as two objects');
  });
});

// ================================================ a ship has two of everything


describe('every hull is the same ship on both sides of its own centreline', () => {
  /**
   * The largest disagreement between port and starboard reach, as a fraction
   * of the hull's own length.
   *
   * Sliced along x, because that is where the failure lives: `sweep` displaces
   * a box's +z corners aft and leaves its -z corners where they are. Inside
   * `mirrored` that is a swept wing and correct. On a CENTRELINE box it is a
   * parallelogram — one bow corner forward, the other raked back.
   */
  function lopsided(id, n = 24) {
    const m = mesh(id);
    const f = m.stride / 4;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < m.vertexCount; i++) {
      lo = Math.min(lo, m.data[i * f]);
      hi = Math.max(hi, m.data[i * f]);
    }
    const port = new Array(n).fill(0);
    const star = new Array(n).fill(0);
    for (let i = 0; i < m.vertexCount; i++) {
      const x = m.data[i * f];
      const z = m.data[i * f + 2];
      const k = Math.min(n - 1, Math.floor(((x - lo) / (hi - lo)) * n));
      if (z > 0) star[k] = Math.max(star[k], z);
      else port[k] = Math.max(port[k], -z);
    }
    let worst = 0;
    for (let k = 0; k < n; k++) worst = Math.max(worst, Math.abs(star[k] - port[k]) / (hi - lo));
    return worst;
  }

  test('nothing built by a shipyard is lopsided', () => {
    // Eleven classes were, across six different forms, the worst of them by
    // sixteen percent of its own length — and on a Galor that put the hull's
    // nose, at the centreline, a fifth of the ship behind the sensor dome
    // mounted on it.
    const bad = [];
    for (const id of Object.keys(BLUEPRINTS)) {
      if (BLUEPRINTS[id].form === 'cube') continue;
      const off = lopsided(id);
      if (off > 0.02) bad.push(`${id} ${(off * 100).toFixed(1)}% (${BLUEPRINTS[id].form})`);
    }
    assert.deepEqual(bad, [], 'these hulls are not the same ship on both sides');
  });

  test('except the Borg, who did not build theirs in one', () => {
    // The exception, asserted rather than skipped. `cube` scatters surface
    // clutter round a trigonometric walk with no mirror, which is the one
    // place in the fleet where an irregular hull is the right answer: a Borg
    // vessel is accreted, not laid down. Holding it to the rule above would
    // mean making the Borg tidy.
    for (const id of ['borg_cube', 'bioship']) {
      assert.ok(lopsided(id) > 0.1,
        `${id} has become symmetrical, so the exception above is now dead code`);
    }
  });

  test('and the measurement can tell the two apart', () => {
    // A control the fleet cannot supply now that it is clean: a swept box on
    // the centreline against the same box built through `prow`.
    const skew = new MeshBuilder();
    box(skew, { center: vec3(), size: vec3(1, 0.1, 0.6), sweep: 0.3 });
    const even = new MeshBuilder();
    prow(even, { center: vec3(), size: vec3(1, 0.1, 0.6), sweep: 0.3 });
    const reach = (mb) => {
      let s = 0;
      let p2 = 0;
      for (let i = 0; i < mb.positions.length; i += 3) {
        const x = mb.positions[i];
        const z = mb.positions[i + 2];
        // A vertex ON the centreline is on neither side, and counting it as
        // one made `prow` look lopsided by exactly its own sweep.
        if (z > 1e-9) s = Math.max(s, x);
        else if (z < -1e-9) p2 = Math.max(p2, x);
      }
      return Math.abs(s - p2);
    };
    assert.ok(reach(skew) > 0.25, `a swept box reaches the same on both sides (${reach(skew)})`);
    assert.ok(reach(even) < 1e-9, `prow is still lopsided by ${reach(even)}`);
    // And it is still a point rather than a blunt end: the axis reaches
    // further forward than the outboard corners do.
    let axis = -Infinity;
    let tip = -Infinity;
    for (let i = 0; i < even.positions.length; i += 3) {
      const x = even.positions[i];
      if (Math.abs(even.positions[i + 2]) < 1e-9) axis = Math.max(axis, x);
      else tip = Math.max(tip, x);
    }
    assert.ok(axis > tip + 0.1, `the prow is blunt: axis ${axis}, corner ${tip}`);
  });
});

// ======================================================== the new primitives

describe('the shears and the machinery', () => {
  const built = (opts) => {
    const mb = new MeshBuilder();
    box(mb, opts);
    return mb;
  };
  const yAt = (mb, sign) => {
    // The mean y of every vertex on the +z or -z side.
    let sum = 0;
    let n = 0;
    for (let i = 0; i < mb.positions.length; i += 3) {
      if (Math.sign(mb.positions[i + 2]) !== sign) continue;
      sum += mb.positions[i + 1];
      n++;
    }
    return n ? sum / n : NaN;
  };

  test('dip drops the outboard end and leaves the inboard one alone', () => {
    const flat = built({ center: vec3(), size: vec3(1, 0.1, 1) });
    const wing = built({ center: vec3(), size: vec3(1, 0.1, 1), dip: 0.4 });
    assert.ok(Math.abs(yAt(flat, 1) - yAt(flat, -1)) < 1e-9,
      'a box with no dip is not level');
    assert.ok(Math.abs(yAt(wing, -1) - yAt(flat, -1)) < 1e-9,
      'dip moved the inboard end as well');
    assert.ok(yAt(wing, 1) < yAt(flat, 1) - 0.3,
      `the outboard end went from ${yAt(flat, 1)} to ${yAt(wing, 1)}`);
    // And it does not change the count of anything: a shear is not a
    // subdivision.
    assert.equal(wing.triangleCount, flat.triangleCount);
  });

  test('greebles put down what they were asked for, and light some of it', () => {
    const plain = new MeshBuilder();
    greebles(plain, { from: vec3(0, 0, 0), to: vec3(1, 0, 0), count: 6 });
    assert.equal(plain.triangleCount, 6 * 12, 'six boxes is not six boxes');
    assert.equal(plain.glows.filter((g) => g > 0).length, 0,
      'nothing was asked to be lit and something is');

    const lamps = new MeshBuilder();
    greebles(lamps, { from: vec3(0, 0, 0), to: vec3(1, 0, 0), count: 8, litEvery: 4 });
    const on = lamps.glows.filter((g) => g > 0).length / 36;
    assert.equal(on, 2, `every fourth of eight is two, not ${on}`);
  });

  test('the same greebles are the same greebles', () => {
    // Called from a form that is built once and cached forever, so this is
    // less about frames than about a hull being the hull it was — and about
    // nothing here reaching for a random draw, which would make the scenery
    // move the simulation.
    const a = new MeshBuilder();
    const b = new MeshBuilder();
    for (const mb of [a, b]) {
      greebles(mb, { from: vec3(0, 0.2, 0), to: vec3(1, 0.1, 0.3), count: 7, vary: 0.5 });
    }
    assert.deepEqual([...a.positions], [...b.positions]);
    // And `vary` actually varies: without it this is a row of identical boxes
    // and the whole point of the primitive is gone.
    const flat = new MeshBuilder();
    greebles(flat, { from: vec3(0, 0, 0), to: vec3(1, 0, 0), count: 7, vary: 0 });
    const spread = (mb) => new Set(mb.positions.map((v) => v.toFixed(4))).size;
    assert.ok(spread(a) > spread(flat),
      'vary is set and every box is still the same size');
  });
});

// ============================================================== and the cost

describe('the new hulls are ships, and still affordable', () => {
  test('every Klingon class is more ship than the wedge it was', () => {
    // 241 triangles each, for all six, before this change.
    for (const id of HOSTILE) {
      const m = mesh(id);
      // 241 was the number every one of them carried, whatever it was.
      // The floor is above it by a clear margin rather than by a hair: the
      // lightest hull in the fleet now is the 130-metre Tholian web spinner,
      // which is a crystal and is meant to be the simplest thing here.
      assert.ok(m.triangles > 300, `${id} is ${m.triangles} triangles`);
      assert.ok(m.triangles < 2400, `${id} is ${m.triangles} triangles — too much for one hull`);
    }
  });

  test('and the forms are right before the normaliser touches them', () => {
    // The same 1.25 the whole fleet is held to. Both new forms failed it while
    // being written, and one of the two failures was a units bug worth
    // remembering: `nacelleY` defaulted to a share of the ship's HEIGHT and was
    // overridden with a raw number, so a Negh'Var's nacelles were slung 0.44 of
    // its LENGTH below the centreline — two and a half times the height of the
    // whole ship.
    for (const id of HOSTILE) {
      const e = proportionError(id);
      const off = Math.max(e.beam, 1 / e.beam, e.height, 1 / e.height);
      assert.ok(off < 1.25,
        `${id} leans on the normaliser by ${off.toFixed(2)}x`);
    }
  });

  test('a Klingon hull is drawn in Klingon colours', () => {
    // The palette is per faction and the forms take it as a parameter, so a
    // form that reached for a literal would draw a Federation-coloured Klingon.
    const p = paletteFor('klingon');
    const fed = paletteFor('federation');
    for (const id of ['d7', 'bird_of_prey', 'neghvar']) {
      const m = mesh(id);
      let hull = 0;
      let wrong = 0;
      for (let i = 0; i < m.vertexCount; i++) {
        const c = vertex(m, i).color;
        if (near(c, p.hull) || near(c, p.trim)) hull++;
        if (near(c, fed.hull) || near(c, fed.dish)) wrong++;
      }
      assert.ok(hull > m.vertexCount * 0.3, `${id} is only ${hull} vertices of Klingon plating`);
      assert.equal(wrong, 0, `${id} has ${wrong} vertices of Starfleet hull on it`);
    }
  });
});
