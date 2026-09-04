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
import { MeshBuilder, box, greebles } from '../src/gfx/mesh.js';
import { vec3 } from '../src/gfx/math.js';

const FACTION = Object.fromEntries(SHIP_LIST.map((s) => [s.id, s.faction]));
const mesh = (id) => hullMesh(id, FACTION[id] ?? 'independent');
const classesOf = (faction) => SHIP_LIST
  .filter((s) => s.faction === faction && BLUEPRINTS[s.id] && DIMENSIONS[s.id])
  .map((s) => s.id);

/** The colour mesh.js gives a lit port. Private there, so it is written out. */
const WINDOW = [1.0, 0.93, 0.72];
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

/** Every class built by one of the two new forms. */
const KLINGON_FORMED = Object.entries(BLUEPRINTS)
  .filter(([, b]) => b.form === 'raptor' || b.form === 'kdf_cruiser')
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
    for (const id of KLINGON_FORMED) {
      const m = mesh(id);
      let ports = 0;
      for (let i = 0; i < m.vertexCount; i++) if (isPort(vertex(m, i))) ports++;
      assert.ok(ports >= 12, `${id} has ${ports} port vertices — nobody is aboard`);
    }
    assert.ok(KLINGON_FORMED.length >= 7,
      `only ${KLINGON_FORMED.length} classes were checked`);
  });

  test('and the hulls that still have none are named, not forgotten', () => {
    // The omission, asserted. `wedge`, `warbird`, `cube` and `compact` build
    // eleven more classes and not one of them has a port on it either — the
    // same finding as the Klingon fleet's, left for its own change rather than
    // folded into this one. When those forms gain ports this list shrinks and
    // this test says so, which is the point of writing it down.
    //
    // `compact` is a Defiant and a runabout, and it is the one entry here with
    // an argument for staying: a Defiant is famously a warship with almost no
    // habitable hull. `hauler`, which is not on this list, is a civilian
    // freighter and already has them.
    const dark = [];
    for (const id of Object.keys(BLUEPRINTS)) {
      const m = mesh(id);
      let ports = 0;
      for (let i = 0; i < m.vertexCount; i++) if (isPort(vertex(m, i))) ports++;
      if (ports === 0) dark.push(BLUEPRINTS[id].form);
    }
    assert.deepEqual([...new Set(dark)].sort(),
      ['compact', 'cube', 'warbird', 'wedge'],
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

  test('the ports on a Klingon hull are proud of the hull they are set in', () => {
    // #134's failure, which this change could repeat in a new place: geometry
    // placed INSIDE the shape it decorates, paid for and invisible from every
    // angle. Measured by slicing, for the reason that test gives — a tube has
    // vertices only at its ends, so asking whether any hull vertex is near a
    // port answers "none" for a buried port and a proud one alike.
    let checked = 0;
    for (const id of KLINGON_FORMED) {
      const m = mesh(id);
      const f = m.stride / 4;
      const tri = (t) => [0, 1, 2].map((k) =>
        [0, 1, 2].map((j) => m.data[(t + k) * f + j]));

      /** How far to starboard a chosen surface reaches on the plane x = X. */
      const sliceMaxZ = (X, yLo, yHi, pick) => {
        let best = -Infinity;
        for (let t = 0; t < m.vertexCount; t += 3) {
          if (!pick(vertex(m, t))) continue;
          const v = tri(t);
          for (let k = 0; k < 3; k++) {
            const a = v[k];
            const b = v[(k + 1) % 3];
            if ((a[0] - X) * (b[0] - X) > 0 || a[0] === b[0]) continue;
            const u = (X - a[0]) / (b[0] - a[0]);
            const y = a[1] + u * (b[1] - a[1]);
            const z = a[2] + u * (b[2] - a[2]);
            if (z > 0 && y >= yLo && y <= yHi) best = Math.max(best, z);
          }
        }
        return best;
      };

      // Each port triangle against the hull at ITS OWN station and its own y
      // band. A first version sliced once, at the mean x of every starboard
      // port on the ship — and a Bird-of-Prey has ports on the head and on the
      // body, so the mean landed between the two groups where no port crosses
      // the plane at all and the comparison had nothing on one side of it.
      let ports = 0;
      let here = 0;
      for (let t = 0; t < m.vertexCount; t += 3) {
        if (!isPort(vertex(m, t))) continue;
        const v = tri(t);
        if (v.every((q) => q[2] <= 0)) continue;
        ports++;
        const X = (v[0][0] + v[1][0] + v[2][0]) / 3;
        const yLo = Math.min(...v.map((q) => q[1])) - 0.004;
        const yHi = Math.max(...v.map((q) => q[1])) + 0.004;
        const port = sliceMaxZ(X, yLo, yHi, isPort);
        const hull = sliceMaxZ(X, yLo, yHi, (q) => !isPort(q) && q.glow < 0.5);
        // A port over a station with no hull at all is not buried; skip it
        // rather than counting it, and let the tally below catch a filter that
        // has quietly stopped matching anything.
        if (!Number.isFinite(hull) || !Number.isFinite(port)) continue;
        checked++;
        here++;
        assert.ok(port >= hull - 1e-4,
          `${id}'s port at x=${X.toFixed(3)} reaches z=${port.toFixed(4)} `
          + `inside a hull that reaches ${hull.toFixed(4)}`);
      }
      assert.ok(ports >= 6, `${id} has ${ports} starboard port faces`);
      // The denominator, PER CLASS. Without it a filter that had quietly
      // stopped matching would pass this by making no comparison at all —
      // which is the failure the original grille measurement shipped with —
      // and a single fleet-wide count would let one class contribute nothing
      // while the others carried it.
      assert.ok(here >= 4,
        `${id} had ${here} of its ${ports} ports over any hull at all`);
    }
    assert.ok(checked > 40, `only ${checked} ports were actually compared`);
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
  function emptyBands(id, n = 20) {
    const m = mesh(id);
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
        for (let s = 0; s <= 8; s++) {
          const v = a + ((b - a) * s) / 8;
          bands[Math.min(n - 1, Math.floor(((v - lo) / (hi - lo)) * n))]++;
        }
      }
    }
    return bands.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  }

  test('a wing is attached to the ship it is on', () => {
    // The defect the `dip` shear was added for. `wingDroop` used to be an
    // offset applied to the wing, the nacelle and the wingtip cannon
    // separately, each by a different fraction of it — so a Bird-of-Prey,
    // which has the deepest droop in the fleet, had a wing root 0.29 units
    // BELOW the body it grows out of, a nacelle another 0.29 below the wing,
    // and a cannon below that. From the side it was four objects in a diagonal
    // line with clear space between them.
    for (const id of KLINGON_FORMED) {
      assert.deepEqual(emptyBands(id), [],
        `${id} has a horizontal slice with no ship in it`);
    }
  });

  test('and the measurement can see a hull that is not', () => {
    // The control, in the same test file: four of the `wedge` classes DO have
    // a gap, at the join between the slab and the superstructure above it.
    // Left for the change that rebuilds those forms — recorded here so the
    // measurement above is known to be able to fail.
    const gapped = Object.keys(BLUEPRINTS).filter((id) => emptyBands(id).length > 0);
    assert.ok(gapped.length > 0,
      'nothing in the fleet has a gap, so the measurement above proves nothing');
    for (const id of gapped) {
      assert.equal(BLUEPRINTS[id].form, 'wedge',
        `${id} has a gap and is not one of the known ones`);
    }
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
    for (const id of KLINGON_FORMED) {
      const m = mesh(id);
      assert.ok(m.triangles > 400, `${id} is ${m.triangles} triangles`);
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
    for (const id of KLINGON_FORMED) {
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
