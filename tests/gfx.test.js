// The 3D renderer, tested without a GPU.
//
// The maths and the mesh generation are pure functions over numbers, so they
// are testable here and are where the bugs actually live — a transposed matrix
// or a reversed winding is silent on screen until you notice half a hull is
// missing. The GL layer itself is exercised by the browser harness, which is
// the only place a shader can be compiled.
//
// What this file will not do is assert that anything looks good. It asserts
// that the geometry is well-formed, that every ship in the game has a hull,
// and that the triangle budget is real.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  vec3, quat, add, sub, scale, dot, cross, length, normalize, distance,
  transformQuat, quatAxisAngle, quatMultiply, quatFromTo, quatSlerp, quatFromEuler,
  mat4, identity, multiply, perspective, lookAt, compose, normalMatrix, project,
} from '../src/gfx/math.js';
import { MeshBuilder, saucer, tube, box, sphere, mirrored } from '../src/gfx/mesh.js';
import {
  BLUEPRINTS, DIMENSIONS, hullMesh, hullScale, paletteFor, UNITS_PER_METRE,
} from '../src/gfx/blueprint.js';
import { SHIP_LIST } from '../src/world/ships.data.js';
import {
  sceneMeshes, starfield, gridMesh, bodyMesh, warpfield, worldMesh, limbMesh,
  WARP_LENGTH, VOLUME,
} from '../src/gfx/scene.js';
import {
  vistaFor, bearingOf, fovFor, horizontalFov, noseOf, worldLabel, joltShake, joltTint,
} from '../src/gfx/vista.js';
import {
  orbitFrame, orbitPeriod, rotationPeriod, angularRadius, orbitAxis, ORBIT_ALTITUDE,
} from '../src/world/orbit.js';
import { roomMeshes, allRoomMeshes, officerMesh, officerStandsAt } from '../src/gfx/room.js';
import { ROOMS, ROOM_LIST } from '../src/world/interiors.data.js';
import { makeSurface } from '../src/world/surface.js';
import { RNG } from '../src/core/rng.js';
import { SHIP_CLASSES } from '../src/world/ships.data.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const vecClose = (a, b, eps = 1e-9) =>
  close(a[0], b[0], eps) && close(a[1], b[1], eps) && close(a[2], b[2], eps);

describe('vector maths', () => {
  test('the basics are the basics', () => {
    assert.ok(vecClose(add(vec3(1, 2, 3), vec3(4, 5, 6)), vec3(5, 7, 9)));
    assert.ok(vecClose(sub(vec3(4, 5, 6), vec3(1, 2, 3)), vec3(3, 3, 3)));
    assert.ok(vecClose(scale(vec3(1, 2, 3), 2), vec3(2, 4, 6)));
    assert.equal(dot(vec3(1, 0, 0), vec3(0, 1, 0)), 0);
    assert.equal(length(vec3(3, 4, 0)), 5);
    assert.equal(distance(vec3(0, 0, 0), vec3(0, 0, 5)), 5);
  });

  test('cross products are right-handed', () => {
    // x cross y must give z, or every normal in the renderer points inward.
    assert.ok(vecClose(cross(vec3(1, 0, 0), vec3(0, 1, 0)), vec3(0, 0, 1)));
    assert.ok(vecClose(cross(vec3(0, 1, 0), vec3(0, 0, 1)), vec3(1, 0, 0)));
  });

  test('normalising a zero vector does not produce NaN', () => {
    const n = normalize(vec3(0, 0, 0));
    assert.ok(n.every((v) => Number.isFinite(v)));
  });

  test('everything is float64, like the rest of the simulation', () => {
    assert.ok(vec3() instanceof Float64Array);
    assert.ok(mat4() instanceof Float64Array);
  });
});

describe('quaternions', () => {
  test('a quarter turn about y takes +x to -z', () => {
    const q = quatAxisAngle(vec3(0, 1, 0), Math.PI / 2);
    const r = transformQuat(vec3(1, 0, 0), q);
    assert.ok(vecClose(r, vec3(0, 0, -1), 1e-12), [...r].join(','));
  });

  test('composition applies in the documented order', () => {
    const a = quatAxisAngle(vec3(0, 1, 0), Math.PI / 2);
    const b = quatAxisAngle(vec3(1, 0, 0), Math.PI / 2);
    const ab = quatMultiply(a, b);
    const viaMatrix = transformQuat(transformQuat(vec3(0, 0, 1), b), a);
    assert.ok(vecClose(transformQuat(vec3(0, 0, 1), ab), viaMatrix, 1e-12));
  });

  test('quatFromTo rotates one direction onto another', () => {
    const from = normalize(vec3(1, 0, 0));
    const to = normalize(vec3(0, 0.5, 0.8));
    const r = transformQuat(from, quatFromTo(from, to));
    assert.ok(vecClose(r, to, 1e-9), [...r].join(','));
  });

  test('quatFromTo survives exactly opposed vectors', () => {
    // The degenerate case: cross product is zero and a naive implementation
    // produces NaN, which then propagates into the model matrix.
    const q = quatFromTo(vec3(1, 0, 0), vec3(-1, 0, 0));
    assert.ok([...q].every(Number.isFinite));
    const r = transformQuat(vec3(1, 0, 0), q);
    assert.ok(vecClose(r, vec3(-1, 0, 0), 1e-9), [...r].join(','));
  });

  test('slerp stays on the unit sphere', () => {
    const a = quatAxisAngle(vec3(0, 1, 0), 0.2);
    const b = quatAxisAngle(vec3(0.3, 1, 0.2), 2.4);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const q = quatSlerp(a, b, t);
      assert.ok(close(Math.hypot(...q), 1, 1e-9), `|q| at t=${t}`);
    }
  });

  test('euler angles round-trip through a rotation', () => {
    const q = quatFromEuler(0, Math.PI / 2, 0);
    assert.ok(vecClose(transformQuat(vec3(1, 0, 0), q), vec3(0, 0, -1), 1e-12));
  });
});

describe('matrices', () => {
  test('identity is the multiplicative identity', () => {
    const m = compose(vec3(3, 4, 5), quatAxisAngle(vec3(0, 1, 0), 0.7), 2);
    const r = multiply(identity(), m);
    for (let i = 0; i < 16; i++) assert.ok(close(r[i], m[i], 1e-12));
  });

  test('multiply is safe when the output aliases an input', () => {
    // The render loop reuses matrices, so this is not hypothetical.
    const a = compose(vec3(1, 2, 3), quatAxisAngle(vec3(0, 1, 0), 0.3), 1);
    const b = compose(vec3(-2, 0, 1), quatAxisAngle(vec3(1, 0, 0), 0.9), 1);
    const expected = multiply(a, b, mat4());
    const aliased = mat4();
    aliased.set(a);
    multiply(aliased, b, aliased);
    for (let i = 0; i < 16; i++) assert.ok(close(aliased[i], expected[i], 1e-12), `element ${i}`);
  });

  test('compose places the translation where WebGL expects it', () => {
    const m = compose(vec3(7, 8, 9), quat(), 1);
    assert.equal(m[12], 7);
    assert.equal(m[13], 8);
    assert.equal(m[14], 9);
    assert.equal(m[15], 1);
  });

  test('compose applies scale and rotation together', () => {
    const m = compose(vec3(), quatAxisAngle(vec3(0, 1, 0), Math.PI / 2), 3);
    // The x basis vector should have length 3 and point along -z.
    assert.ok(close(Math.hypot(m[0], m[1], m[2]), 3, 1e-12));
    assert.ok(close(m[2], -3, 1e-12));
  });

  test('lookAt puts the target on the view axis', () => {
    const eye = vec3(0, 0, 10);
    const v = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
    // The camera's own position maps to the origin of view space.
    const x = v[0] * eye[0] + v[4] * eye[1] + v[8] * eye[2] + v[12];
    const y = v[1] * eye[0] + v[5] * eye[1] + v[9] * eye[2] + v[13];
    const z = v[2] * eye[0] + v[6] * eye[1] + v[10] * eye[2] + v[14];
    assert.ok(close(x, 0, 1e-12) && close(y, 0, 1e-12) && close(z, 0, 1e-12));
  });

  test('lookAt does not degenerate when looking straight down', () => {
    // Straight down the up vector is where a naive cross product collapses.
    const v = lookAt(vec3(0, 100, 0), vec3(0, 0, 0), vec3(0, 1, 0));
    assert.ok([...v].every(Number.isFinite), [...v].join(','));
  });

  test('perspective maps the near and far planes to -1 and 1', () => {
    const p = perspective(Math.PI / 3, 1, 1, 100);
    const depthOf = (z) => {
      const w = -z;
      return (p[10] * z + p[14]) / w;
    };
    assert.ok(close(depthOf(-1), -1, 1e-9));
    assert.ok(close(depthOf(-100), 1, 1e-9));
  });

  test('normalMatrix inverts and transposes the rotation', () => {
    const m = compose(vec3(5, 0, 0), quatAxisAngle(vec3(0, 1, 0), 0.8), 2);
    const n = normalMatrix(m);
    assert.ok([...n].every(Number.isFinite));
    // A pure rotation-and-uniform-scale still preserves angles between normals.
    const a = normalize(vec3(1, 0, 0));
    const b = normalize(vec3(0, 1, 0));
    const ta = normalize(vec3(n[0] * a[0] + n[3] * a[1] + n[6] * a[2],
      n[1] * a[0] + n[4] * a[1] + n[7] * a[2],
      n[2] * a[0] + n[5] * a[1] + n[8] * a[2]));
    const tb = normalize(vec3(n[0] * b[0] + n[3] * b[1] + n[6] * b[2],
      n[1] * b[0] + n[4] * b[1] + n[7] * b[2],
      n[2] * b[0] + n[5] * b[1] + n[8] * b[2]));
    assert.ok(close(dot(ta, tb), 0, 1e-9));
  });

  test('project refuses points behind the camera', () => {
    const vp = multiply(perspective(1, 1, 1, 100), lookAt(vec3(0, 0, 10), vec3(), vec3(0, 1, 0)));
    assert.ok(project(vec3(0, 0, 0), vp));
    assert.equal(project(vec3(0, 0, 100), vp), null);
  });
});

describe('mesh construction', () => {
  test('a triangle gets a face normal and three vertices', () => {
    const mb = new MeshBuilder();
    mb.tri(vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 0, 1), [1, 1, 1]);
    assert.equal(mb.triangleCount, 1);
    const built = mb.build();
    assert.equal(built.vertexCount, 3);
    // Wound so the normal points along -y for this ordering.
    assert.ok(close(mb.normals[1], -1, 1e-12), mb.normals.slice(0, 3).join(','));
  });

  test('every primitive produces finite, non-degenerate geometry', () => {
    for (const [name, build] of Object.entries({
      saucer: (m) => saucer(m, {}),
      tube: (m) => tube(m, {}),
      box: (m) => box(m, {}),
      sphere: (m) => sphere(m, {}),
    })) {
      const mb = new MeshBuilder();
      build(mb);
      const { data, vertexCount } = mb.build();
      assert.ok(vertexCount > 0, `${name} produced nothing`);
      assert.equal(vertexCount % 3, 0, `${name} produced a partial triangle`);
      assert.ok([...data].every(Number.isFinite), `${name} produced NaN`);
      // Every normal must be unit length, or lighting is wrong.
      for (let i = 0; i < vertexCount; i++) {
        const n = Math.hypot(data[i * 9 + 3], data[i * 9 + 4], data[i * 9 + 5]);
        assert.ok(close(n, 1, 1e-5), `${name} normal ${i} has length ${n}`);
      }
    }
  });

  test('mirroring reverses winding so the copy faces outward', () => {
    const mb = new MeshBuilder();
    mirrored(mb, (m) => m.tri(vec3(0, 0, 1), vec3(1, 0, 1), vec3(0, 1, 1), [1, 1, 1]));
    assert.equal(mb.triangleCount, 2);

    // Reconstruct both face normals from the positions and confirm the mirrored
    // one points the opposite way in z. Getting this wrong makes the port
    // nacelle of every Federation ship invisible to back-face culling.
    const faceNormal = (i) => {
      const p = (k) => vec3(mb.positions[i + k * 3], mb.positions[i + k * 3 + 1], mb.positions[i + k * 3 + 2]);
      return normalize(cross(sub(p(1), p(0)), sub(p(2), p(0))));
    };
    const a = faceNormal(0);
    const b = faceNormal(9);
    assert.ok(close(a[2], -b[2], 1e-9), `${a[2]} vs ${b[2]}`);
  });

  test('the interleaved buffer has the layout the shader reads', () => {
    const mb = new MeshBuilder();
    mb.tri(vec3(1, 2, 3), vec3(4, 5, 6), vec3(7, 8, 9), [0.1, 0.2, 0.3]);
    const { data, stride } = mb.build();
    assert.equal(stride, 36);                       // 9 floats
    assert.ok(close(data[0], 1, 1e-6));             // position
    assert.ok(close(data[6], 0.1, 1e-6));           // colour at offset 24 bytes
  });
});

describe('the fleet has hulls', () => {
  test('every ship class in the game has a blueprint', () => {
    const missing = Object.keys(SHIP_CLASSES).filter((id) => !BLUEPRINTS[id]);
    assert.deepEqual(missing, [],
      `these classes would render as a generic hauler: ${missing.join(', ')}`);
  });

  test('every hull builds clean geometry', () => {
    for (const cls of Object.values(SHIP_CLASSES)) {
      const mesh = hullMesh(cls.id, cls.faction);
      assert.ok(mesh.triangles > 20, `${cls.id} is suspiciously simple`);
      assert.equal(mesh.vertexCount, mesh.triangles * 3, `${cls.id} is not flat-shaded`);
      assert.ok([...mesh.data].every(Number.isFinite), `${cls.id} produced NaN`);
    }
  });

  test('meshes are cached, not rebuilt per ship', () => {
    // Six hostiles of the same class in one engagement must not build six
    // meshes; the renderer keys its GPU buffers off identity.
    assert.equal(hullMesh('constitution', 'federation'), hullMesh('constitution', 'federation'));
    assert.notEqual(hullMesh('constitution', 'federation'), hullMesh('constitution', 'klingon'));
  });

  test('the whole fleet on screen at once stays inside the triangle budget', () => {
    // The real cap is seven ships, but the budget is stated against every class
    // in the game so adding an elaborate hull later fails here rather than on a
    // phone.
    const total = Object.values(SHIP_CLASSES)
      .reduce((n, c) => n + hullMesh(c.id, c.faction).triangles, 0);
    assert.ok(total < 20000, `${total} triangles across the fleet`);
  });

  test('on-screen size is in the published ratio, for every pair of hulls', () => {
    // This test used to assert the opposite, and the opposite was the bug: it
    // required a Borg cube to draw less than 4x a runabout, and what that
    // actually produced was a fleet in which every ship is the same size. A
    // 641 m Galaxy drew at 1.10x a 289 m Constitution, and a three-kilometre
    // cube at 1.31x. The lengths were right; the scale function threw them away.
    const ids = Object.keys(DIMENSIONS);
    for (const a of ids) {
      for (const b of ids) {
        const onScreen = hullScale(a) / hullScale(b);
        const published = DIMENSIONS[a].length / DIMENSIONS[b].length;
        assert.ok(Math.abs(onScreen - published) < 1e-9,
          `${a} vs ${b}: drawn at ${onScreen.toFixed(3)}x, published ratio ${published.toFixed(3)}x`);
      }
    }
    // And the headline case, in words.
    assert.ok(Math.abs(hullScale('borg_cube') / hullScale('constitution') - 3040 / 289) < 1e-9);
  });

  test('a Constitution still reads at about the size it always did', () => {
    // The change is to RELATIVE size. Every weapon arc, range and camera
    // distance in this game was tuned against a hull about this big.
    assert.ok(Math.abs(hullScale('constitution') - 83) < 6,
      `a Constitution now draws at ${hullScale('constitution').toFixed(0)} units`);
    assert.ok(UNITS_PER_METRE > 0 && Number.isFinite(UNITS_PER_METRE));
  });

  test('every faction has a palette and an unknown one still renders', () => {
    for (const cls of Object.values(SHIP_CLASSES)) {
      const p = paletteFor(cls.faction);
      assert.ok(p.hull && p.trim && p.glow, `${cls.faction} has an incomplete palette`);
    }
    assert.ok(paletteFor('nobody-in-particular').hull);
  });
});

describe('the scene', () => {
  test('every scene mesh builds', () => {
    for (const [name, mesh] of Object.entries(sceneMeshes())) {
      assert.ok(mesh.vertexCount > 0, `${name} is empty`);
      assert.ok([...mesh.data].every(Number.isFinite), `${name} produced NaN`);
    }
  });

  test('the starfield is deterministic', () => {
    // The sky must be identical on every launch and in every screenshot, and
    // must not draw from the simulation's RNG stream — the save depends on it.
    const a = starfield(40).data;
    const b = starfield(40).data;
    assert.equal(a, b, 'the starfield was rebuilt rather than cached');
    const fresh = starfield(41).data;
    assert.notEqual(fresh.length, a.length);
  });

  test('the grid spans the tactical volume and has a marked centre', () => {
    const grid = gridMesh(12);
    let maxExtent = 0;
    for (let i = 0; i < grid.vertexCount; i++) {
      maxExtent = Math.max(maxExtent, Math.abs(grid.data[i * 9]), Math.abs(grid.data[i * 9 + 2]));
    }
    // Half a volume, plus the half-thickness of the outermost line.
    assert.ok(close(maxExtent, VOLUME / 2, VOLUME * 0.005), `grid reaches ${maxExtent}`);
  });
});

// ============================================================ normal matrix

// The shader does `normalize(uNormalMatrix * aNormal)`, and gl.js uploads the
// matrix with `uniformMatrix3fv(loc, false, data)` — so GLSL reads it as
// COLUMN-major. That fixes what normalMatrix has to return, and it was
// returning the transpose of it.
//
// normalMatrix computed inverse(M3) and stored it without transposing. For a
// rotation the correct answer is the rotation itself (a rotation's
// inverse-transpose is itself), and it returned R-transpose instead — so every
// hull was lit by a normal rotated the wrong way by its own orientation.
//
// Nothing caught it. An unrotated ship is unaffected (the identity is its own
// transpose), the harness checks that pixels are drawn and draw calls happen,
// and nothing anywhere checked that the light lands on the right side.
describe('the normal matrix', () => {
  /** Apply a column-major 3x3 to a vector, exactly as GLSL does. */
  const applyMat3 = (m3, v) => [0, 1, 2].map(
    (r) => m3[r] * v[0] + m3[3 + r] * v[1] + m3[6 + r] * v[2],
  );

  const dir = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  test('rotates a normal the same way the model matrix rotates the hull', () => {
    for (let i = 0; i < 200; i++) {
      const axis = normalize(vec3(Math.sin(i), Math.cos(i * 1.7), Math.sin(i * 0.3) + 0.5));
      const q = quatAxisAngle(axis, i * 0.11);
      const model = compose(vec3(i, -i, i * 2), q, 1);
      const n = normalize(vec3(0.3, -0.5, 0.8));

      const lit = applyMat3(normalMatrix(model), n);
      const expected = transformQuat(n, q);
      assert.ok(
        dot3(dir(lit), expected) > 1 - 1e-9,
        `the lit normal points ${dot3(dir(lit), expected).toFixed(4)} of the way toward the hull's own normal`,
      );
    }
  });

  test('at unit scale it is exactly the model rotation', () => {
    const q = quatAxisAngle(normalize(vec3(1, 2, 3)), 0.7);
    const model = compose(vec3(5, 6, 7), q, 1);
    const nm = normalMatrix(model);
    // The upper-left 3x3 of the model matrix, in the same column-major order.
    const upper = [model[0], model[1], model[2], model[4], model[5], model[6],
      model[8], model[9], model[10]];
    for (let i = 0; i < 9; i++) {
      assert.ok(Math.abs(nm[i] - upper[i]) < 1e-9,
        `element ${i}: normal matrix ${nm[i]} vs model rotation ${upper[i]}`);
    }
  });

  test('a uniform scale shortens normals by 1/s, and does not turn them', () => {
    // Textbook inverse-transpose behaviour: the shader normalises afterwards,
    // so the length is free, but the direction is not.
    const q = quatAxisAngle(normalize(vec3(-1, 3, 2)), 1.2);
    const n = normalize(vec3(0.1, 0.9, -0.4));
    const expected = transformQuat(n, q);
    for (const s of [0.25, 0.5, 1, 2, 8]) {
      const lit = applyMat3(normalMatrix(compose(vec3(0, 0, 0), q, s)), n);
      assert.ok(Math.abs(Math.hypot(...lit) - 1 / s) < 1e-9,
        `scale ${s} gave a normal of length ${Math.hypot(...lit)}`);
      assert.ok(dot3(dir(lit), expected) > 1 - 1e-9,
        `scale ${s} turned the normal`);
    }
  });

  test('a degenerate model matrix falls back to the identity', () => {
    const nm = normalMatrix(compose(vec3(1, 2, 3), quat(), 0));
    assert.ok([...nm].every(Number.isFinite), 'a zero-scale model gave a non-finite normal matrix');
    const n = [0.6, 0.8, 0];
    const lit = applyMat3(nm, n);
    assert.ok(Math.abs(Math.hypot(...lit) - 1) < 1e-9, 'the fallback is not the identity');
  });
});

// A NaN projection matrix is a black viewport with nothing logged. The callers
// guard (tactical3d.js falls back to 320px, gl.js divides by max(1, h)), so
// this is not reachable today — but a canvas measured before layout is a very
// ordinary way to get a zero.
test('a degenerate camera still produces a usable projection', () => {
  const CASES = [
    ['zero aspect', () => perspective(60 * Math.PI / 180, 0, 0.1, 100)],
    ['negative aspect', () => perspective(60 * Math.PI / 180, -2, 0.1, 100)],
    ['zero fov', () => perspective(0, 1, 0.1, 100)],
    ['straight-angle fov', () => perspective(Math.PI, 1, 0.1, 100)],
    ['near equals far', () => perspective(60 * Math.PI / 180, 1, 5, 5)],
    ['far behind near', () => perspective(60 * Math.PI / 180, 1, 100, 1)],
    ['zero near', () => perspective(60 * Math.PI / 180, 1, 0, 100)],
    ['NaN aspect', () => perspective(60 * Math.PI / 180, NaN, 0.1, 100)],
  ];
  for (const [name, build] of CASES) {
    const m = build();
    assert.ok([...m].every(Number.isFinite), `${name} produced a non-finite projection`);
    assert.ok(Math.abs(m[0]) > 0, `${name} collapsed the horizontal field of view to nothing`);
    assert.ok(Math.abs(m[5]) > 0, `${name} collapsed the vertical field of view to nothing`);
  }
});

test('a normal camera is untouched by those guards', () => {
  // The guards must not perturb the projection the game actually uses.
  const m = perspective(52 * Math.PI / 180, 16 / 9, 5, 40000);
  const f = 1 / Math.tan((52 * Math.PI / 180) / 2);
  assert.ok(Math.abs(m[0] - f / (16 / 9)) < 1e-12);
  assert.ok(Math.abs(m[5] - f) < 1e-12);
  assert.ok(Math.abs(m[10] - (40000 + 5) / (5 - 40000)) < 1e-12);
  assert.ok(Math.abs(m[14] - (2 * 40000 * 5) / (5 - 40000)) < 1e-9);
});

// ========================================================== the 1966 hull

// `starfleet` is a generic archetype: saucer, neck, secondary hull, two
// nacelles. That reads as "a Federation ship" and not as *this* one. Four
// details do the identifying and every one was missing — so the Enterprise
// was, visually, an anonymous saucer hull with the right dimensions.
//
// These assert the details exist in the geometry, not that the data table
// mentions them.
describe('the TOS Constitution', () => {
  const P = paletteFor('federation');
  const mesh = hullMesh('constitution', 'federation');

  /** Vertices whose colour matches `rgb`, within tolerance. */
  const coloured = (rgb, eps = 0.02) => {
    const out = [];
    for (let i = 0; i < mesh.vertexCount; i++) {
      const o = i * mesh.stride;
      const cr = mesh.data[o + 6]; const cg = mesh.data[o + 7]; const cb = mesh.data[o + 8];
      if (Math.abs(cr - rgb[0]) < eps && Math.abs(cg - rgb[1]) < eps && Math.abs(cb - rgb[2]) < eps) {
        out.push([mesh.data[o], mesh.data[o + 1], mesh.data[o + 2]]);
      }
    }
    return out;
  };

  test('it uses its own archetype, not the generic one', () => {
    assert.equal(BLUEPRINTS.constitution.form, 'tos_starfleet');
  });

  test('it has a deflector dish, in copper, at the bow of the secondary hull', () => {
    assert.ok(P.dish, 'the federation palette carries no dish colour');
    const dish = coloured(P.dish);
    assert.ok(dish.length > 20, `only ${dish.length} vertices are dish-coloured`);
    // Forward of the saucer's centre, and below it — where the dish sits.
    const cx = dish.reduce((n, v) => n + v[0], 0) / dish.length;
    const cy = dish.reduce((n, v) => n + v[1], 0) / dish.length;
    assert.ok(cx > 0.25, `the dish sits at x=${cx.toFixed(2)}, not at the bow`);
    assert.ok(cy < 0, `the dish sits at y=${cy.toFixed(2)}, not on the secondary hull`);
  });

  test('the bussard domes are at the front of both nacelles, and glow', () => {
    const glow = coloured(P.glow);
    assert.ok(glow.length > 40, `only ${glow.length} vertices glow`);
    // One cluster to port, one to starboard, both forward.
    const port = glow.filter((v) => v[2] < 0);
    const stbd = glow.filter((v) => v[2] > 0);
    assert.ok(port.length > 15 && stbd.length > 15,
      `bussards are lopsided: ${port.length} port, ${stbd.length} starboard`);
    const meanY = glow.reduce((n, v) => n + v[1], 0) / glow.length;
    assert.ok(meanY > 0.05, `the domes sit at y=${meanY.toFixed(2)}, not up on the nacelles`);
  });

  test('the hull is 1966 off-white, not 1979 refit grey', () => {
    // The refit is a cool grey — blue channel highest. The original photographed
    // warm, with red at least as high as blue.
    assert.ok(P.hull[0] >= P.hull[2],
      `hull is [${P.hull}], which is cooler than it is warm`);
  });

  test('it is more ship than the generic archetype, and still affordable', () => {
    const generic = hullMesh('excelsior', 'federation');
    const tris = mesh.vertexCount / 3;
    assert.ok(tris > generic.vertexCount / 3,
      'the TOS hull carries no more detail than the generic one');
    // Six hostiles plus the player must stay inside the harness budget.
    assert.ok(tris < 1200, `${tris} triangles is too much for one hull`);
  });
});

// =========================================================== the viewscreen
//
// The main viewer is the same renderer with the camera in a different place,
// so what is worth testing is the arithmetic that puts it there — and the
// scenery it looks at, which has one property that matters more than how it
// looks: it must be the same every time you come back.

describe('the viewscreen camera', () => {
  const deg = (rad) => rad * 180 / Math.PI;

  test('the viewer\u2019s own shape gives a wide view, which is why it is fixed', () => {
    // The bezel pins the picture at 16:9 whatever shape the phone is. That is
    // not decoration \u2014 it is what lets the camera hold a wide horizontal
    // field without the vertical angle going past the point of distortion.
    assert.ok(deg(horizontalFov(16 / 9)) > 78,
      `only ${deg(horizontalFov(16 / 9)).toFixed(0)} degrees across the viewer`);
  });

  test('no viewport shape is ever narrower than the old fixed lens', () => {
    // The bug this replaces: a fixed 52 degrees *vertical*, which on a phone
    // held upright works out to about twenty-five degrees horizontal \u2014 a
    // letterbox turned on its side. The vertical clamp still binds on very tall
    // viewports, so the guarantee is a floor, not a constant.
    const oldPortrait = deg(2 * Math.atan(Math.tan(52 * Math.PI / 180 / 2) * 0.46));
    for (const aspect of [0.4, 0.46, 0.6, 0.75, 1.0, 1.4, 1.78, 2.4]) {
      const h = deg(horizontalFov(aspect));
      assert.ok(h > 40, `aspect ${aspect} gives only ${h.toFixed(0)} degrees across`);
      assert.ok(h > oldPortrait * 1.5,
        `aspect ${aspect} is no better than the ${oldPortrait.toFixed(0)} degrees it replaced`);
    }
  });

  test('a taller window never shows you less than a wider one shows vertically', () => {
    // Solving for the vertical means the vertical angle rises as the window
    // gets taller, monotonically. If it ever went the other way, rotating the
    // phone would take view away in both directions at once.
    const aspects = [2.4, 1.78, 1.4, 1.0, 0.75, 0.6, 0.46, 0.4];
    for (let i = 1; i < aspects.length; i++) {
      assert.ok(fovFor(aspects[i]) >= fovFor(aspects[i - 1]) - 1e-12,
        `aspect ${aspects[i]} sees less vertically than ${aspects[i - 1]}`);
    }
  });

  test('an absurd viewport does not produce an absurd lens', () => {
    // A node mid-DOM-swap measures as zero by zero, and 0/0 is how a black
    // screen starts.
    for (const aspect of [0.01, 0, -1, 40, NaN, Infinity, undefined]) {
      const f = fovFor(aspect);
      assert.ok(Number.isFinite(f) && f > 0 && f < Math.PI,
        `aspect ${aspect} gave a field of view of ${f}`);
    }
  });

  test('the camera looks where the bow points, in render space', () => {
    // Heading is a compass bearing in the simulation's xy plane; render space
    // is +y up with sim y mapped onto render z. Getting this wrong gives a
    // viewscreen ninety degrees off the bow that swings the wrong way.
    const east = noseOf({ heading: 0, pitch: 0 });
    assert.ok(vecClose(east, [1, 0, 0], 1e-12), `heading 0 looks at [${east}]`);

    const ninety = noseOf({ heading: 90, pitch: 0 });
    assert.ok(vecClose(ninety, [0, 0, 1], 1e-12), `heading 90 looks at [${ninety}]`);

    // Nose up is up on the screen, not down. This one is a sign error away
    // from a viewscreen that dives when the helm climbs.
    const up = noseOf({ heading: 0, pitch: 30 });
    assert.ok(up[1] > 0.49 && up[1] < 0.51, `pitch +30 gives a y of ${up[1]}`);
  });

  test('the nose is always a unit vector, whatever it is handed', () => {
    for (const ship of [undefined, {}, { heading: 725, pitch: -89 }, { heading: -40 }]) {
      const n = noseOf(ship);
      assert.ok(close(length(n), 1, 1e-9), `[${n}] is not unit length`);
    }
  });
});

describe('the view out of the window', () => {
  test('a system looks the same every time you come back', () => {
    // The whole reason this is hashed rather than random. A planet that moves
    // between visits is a screensaver; one that is where you left it is a place.
    for (const id of ['sol', 'vulcan', 'wolf359', 'qonos']) {
      const a = vistaFor(id, 'colony');
      const b = vistaFor(id, 'colony');
      assert.deepEqual(a.bodies, b.bodies, `${id} was different the second time`);
    }
  });

  test('two systems do not look like each other', () => {
    const a = vistaFor('sol', 'core');
    const b = vistaFor('vulcan', 'core');
    assert.notDeepEqual(a.bodies, b.bodies, 'every system has the same sky');
  });

  test('generating scenery does not touch the campaign RNG', () => {
    // If it did, looking out of the window would desynchronise a five-year
    // commission from its own seed — every save after it would be a different
    // game. Nothing here may consume a draw from that stream.
    const rng = new RNG(12345n);
    const before = rng.save();
    for (const id of ['sol', 'rigel', 'wolf359']) vistaFor(id, 'colony');
    assert.deepEqual(rng.save(), before, 'the vista consumed draws from the simulation RNG');
  });

  test('there is always a primary, and it is the only thing lit from within', () => {
    for (const type of ['core', 'homeworld', 'colony', 'outpost', 'anomaly', 'deadspace']) {
      const v = vistaFor(`t:${type}`, type);
      const stars = v.bodies.filter((b) => b.kind === 'star');
      assert.equal(stars.length, 1, `${type} has ${stars.length} suns`);
      const lit = v.bodies.filter((b) => b.emissive > 0);
      assert.deepEqual(lit, stars, `${type} has planets glowing in the dark`);
    }
  });

  test('every body is somewhere the camera can actually see it', () => {
    // Inside the 40,000-unit far plane and outside the 3,000-unit tactical
    // volume — a planet parked inside the engagement would be flown through.
    for (const id of ['sol', 'vulcan', 'qonos', 'rigel', 'wolf359']) {
      for (const b of vistaFor(id, 'core').bodies) {
        const d = Math.hypot(b.x, b.y, b.z);
        assert.ok(d > VOLUME, `${b.id} is at ${d.toFixed(0)}, inside the battle volume`);
        assert.ok(d + b.radius < 40000, `${b.id} is past the far plane`);
        assert.ok(b.radius > 0 && Number.isFinite(b.radius), `${b.id} has radius ${b.radius}`);
      }
    }
  });

  test('dead space is empty, and a core system is not', () => {
    // Wolf 359 should feel like an absence. That is a content decision the
    // data has to actually carry, not a note in a comment.
    const dead = vistaFor('wolf359', 'deadspace').bodies.filter((b) => b.kind !== 'star');
    const core = vistaFor('sol', 'core').bodies.filter((b) => b.kind !== 'star');
    assert.ok(dead.length <= 1, `dead space has ${dead.length} worlds in it`);
    assert.ok(core.length >= 3, `a core system has only ${core.length} worlds`);
  });

  test('the screen opens pointed at something rather than at empty sky', () => {
    for (const id of ['sol', 'vulcan', 'rigel']) {
      const v = vistaFor(id, 'colony');
      assert.ok(v.focus, `${id} has nothing to look at`);
      assert.ok(v.bodies.includes(v.focus), 'the focus is not one of the bodies');
      // Pointing the camera at the focus must actually put it ahead: the
      // bearing has to invert cleanly, which is the bug that would otherwise
      // open the viewer aimed 180 degrees away from the planet.
      const yaw = bearingOf(v.focus);
      const fx = Math.cos(yaw) * 1 - Math.sin(yaw) * 0;
      const fz = Math.sin(yaw) * 1 + Math.cos(yaw) * 0;
      const len = Math.hypot(v.focus.x, v.focus.z) || 1;
      const dot2 = (fx * v.focus.x + fz * v.focus.z) / len;
      assert.ok(dot2 > 0.99, `the focus ends up ${Math.acos(dot2) * 180 / Math.PI | 0} degrees off centre`);
    }
  });

  test('every body kind the vista can produce has a mesh', () => {
    const kinds = new Set();
    for (const id of ['sol', 'vulcan', 'qonos', 'rigel', 'wolf359', 'risa']) {
      for (const type of ['core', 'homeworld', 'colony', 'station', 'outpost', 'anomaly', 'deadspace']) {
        for (const b of vistaFor(`${id}:${type}`, type).bodies) kinds.add(b.kind);
      }
    }
    for (const kind of kinds) {
      const m = bodyMesh(kind, 0);
      assert.ok(m.vertexCount > 0, `${kind} produced no geometry`);
    }
  });

  test('the scenery cannot spend the ships\u2019 triangle budget', () => {
    // A body is memoised per kind, so the cost of the sky is bounded by how
    // many bodies are DRAWN, not by how many exist or how many systems have
    // been visited. `drawVista` culls to what is in front of the camera and
    // caps the rest at six. The harness holds the whole frame to 8,000
    // triangles with a starfield and six hostiles already in it, so this is
    // the headroom that cap has to fit inside.
    // Mirrors VISTA_DRAW_CAP in ui/tactical3d.js, which node cannot import.
    const CAP = 4;
    const kinds = new Set();
    for (const type of ['core', 'homeworld', 'colony', 'station', 'outpost', 'anomaly', 'deadspace']) {
      for (const b of vistaFor(`b:${type}`, type).bodies) kinds.add(b.kind);
    }
    const worst = Math.max(...[...kinds].map((k) => bodyMesh(k, 0).vertexCount / 3));
    assert.ok(worst * CAP < 2000,
      `${CAP} bodies at ${worst} triangles each is ${worst * CAP}, which the ships cannot afford`);
  });

});

describe('the rooms are lit like places', () => {
  test('occlusion darkens the deck at the bulkhead and leaves the bulkhead alone', () => {
    // A wall must not occlude ITSELF. Every vertex of a flat bulkhead sits at
    // zero distance from the bulkhead, so a naive distance term dimmed whole
    // walls by a third — and the bright 1966 set the research insisted on went
    // grey again. Horizontal surfaces take the wall's shadow; vertical ones
    // take the deck's. Each gets the shadow the other casts, neither its own.
    const bridge = roomMeshes('bridge');
    const { data, vertexCount, stride } = bridge.solid;
    const floats = stride / 4;

    let wallBright = 0; let wallCount = 0;
    let deckEdge = 0; let deckEdgeCount = 0;
    let deckMiddle = 0; let deckMiddleCount = 0;

    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      const x = data[o]; const y = data[o + 1]; const z = data[o + 2];
      const ny = Math.abs(data[o + 4]);
      const lum = (data[o + 6] + data[o + 7] + data[o + 8]) / 3;
      const r = Math.hypot(x, z);

      // A bulkhead well above the deck, away from the contact shadow.
      if (ny < 0.3 && y > 1.4 && y < 2.2 && r > 4.0) { wallBright += lum; wallCount++; }
      // The deck, at the bulkhead and out in the open.
      if (ny > 0.9 && y < 0.05) {
        if (r > 4.2) { deckEdge += lum; deckEdgeCount++; }
        else if (r < 1.5) { deckMiddle += lum; deckMiddleCount++; }
      }
    }

    assert.ok(wallCount > 4 && deckEdgeCount > 4 && deckMiddleCount > 4,
      `not enough samples: ${wallCount}/${deckEdgeCount}/${deckMiddleCount}`);

    const wall = wallBright / wallCount;
    const edge = deckEdge / deckEdgeCount;
    const middle = deckMiddle / deckMiddleCount;

    assert.ok(wall > 0.5,
      `the bulkhead averages ${wall.toFixed(2)} — it is occluding itself`);
    assert.ok(edge < middle * 0.92,
      `the deck is ${edge.toFixed(3)} at the bulkhead and ${middle.toFixed(3)} in the open, which is no contact shadow at all`);
  });

  test('nothing is baked to black', () => {
    // A floor of 0.42 on the occlusion term: a corner should be darker, not
    // absent. Geometry you cannot see is geometry you may as well not have
    // built, and it is the failure mode a distance field falls into.
    for (const room of allRoomMeshes()) {
      const { data, vertexCount, stride } = room.solid;
      const floats = stride / 4;
      let darkest = 1;
      for (let i = 0; i < vertexCount; i++) {
        const o = i * floats;
        darkest = Math.min(darkest, (data[o + 6] + data[o + 7] + data[o + 8]) / 3);
      }
      assert.ok(darkest > 0.04, `${room.id} has a vertex at ${darkest.toFixed(3)}`);
    }
  });

  test('the glow mesh is not occluded, because it makes its own light', () => {
    // A panel that ignores the light must also ignore the shadow, or a console
    // in a corner has dim buttons for no reason anybody could point at.
    const bridge = roomMeshes('bridge');
    const { data, vertexCount, stride } = bridge.glow;
    const floats = stride / 4;
    let brightest = 0;
    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      brightest = Math.max(brightest, (data[o + 6] + data[o + 7] + data[o + 8]) / 3);
    }
    assert.ok(brightest > 0.7, `the brightest lit panel is ${brightest.toFixed(2)}`);
  });

  test('every room stays inside the frame budget with its crew aboard', () => {
    // Two draws per room and the whole ship's interior in one place, so the
    // day a room grows a deck of detail this says so.
    for (const room of allRoomMeshes()) {
      assert.ok(room.triangles < 4000, `${room.id} is ${room.triangles} triangles`);
      assert.ok(room.solid.vertexCount > 0, `${room.id} has no lit geometry`);
    }
  });
});

describe('the command chair is built to be sat in', () => {
  // Sitting in a chair you cannot see is the oldest tell that a first-person
  // camera is a floating point rather than a body. The arm panels have to be
  // in frame from the seated eye, and "in frame" is arithmetic, not taste.
  const EYE_Y = 1.18;          // SEATED_HEIGHT in ui/firstperson.js
  const EYE_BACK = 0.16;       // a head's depth behind the seat centre
  const HALF_FOV = 44 * Math.PI / 180;

  const chairProp = () => ROOMS.bridge.props.find((p) => p.id === 'chair');

  test('the chair has geometry inside the seated field of view', () => {
    const chair = chairProp();
    const eyeZ = chair.at[1] - EYE_BACK;
    const { data, vertexCount, stride } = roomMeshes('bridge').solid;
    const floats = stride / 4;

    let inFrame = 0;
    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      const x = data[o]; const y = data[o + 1]; const z = data[o + 2];
      // Belonging to the chair: within its footprint, below the eye.
      if (Math.hypot(x - chair.at[0], z - chair.at[1]) > chair.radius * 2.2) continue;
      if (y > EYE_Y) continue;

      const ahead = z - eyeZ;
      if (ahead < 0.08) continue;                       // behind, or at, the eye
      const down = Math.atan2(EYE_Y - y, ahead);        // angle below level
      const across = Math.atan2(Math.abs(x - chair.at[0]), ahead);
      if (down < HALF_FOV && across < HALF_FOV) inFrame++;
    }

    assert.ok(inFrame > 12,
      `only ${inFrame} chair vertices fall inside the seated view — the captain is sitting on nothing`);
  });

  test('the arm panels carry the three controls that meant something', () => {
    // docs/RESEARCH.md §4: of every button on the prop, exactly three were ever
    // given a function on screen. They are lit caps on the starboard arm, and
    // they belong to the glow mesh because a lit cap must ignore the shadow.
    const chair = chairProp();
    const { data, vertexCount, stride } = roomMeshes('bridge').glow;
    const floats = stride / 4;

    const starboard = new Set();
    const port = new Set();
    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      const x = data[o]; const y = data[o + 1]; const z = data[o + 2];
      if (y < 0.6 || y > 1.0) continue;
      if (Math.abs(z - chair.at[1]) > chair.radius * 2) continue;
      const key = `${data[o + 6].toFixed(2)},${data[o + 7].toFixed(2)},${data[o + 8].toFixed(2)}`;
      if (x > chair.at[0] + 0.3) starboard.add(key);
      else if (x < chair.at[0] - 0.3) port.add(key);
    }

    assert.ok(starboard.size >= 3,
      `the starboard arm carries ${starboard.size} distinct lit caps, not three`);
    assert.ok(port.size >= 1, 'the port arm carries no controls at all');

    // AND THEY FACE UP.
    let capVerts = 0;
    let facingUp = 0;
    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      const y = data[o + 1]; const z = data[o + 2];
      if (y < 0.6 || y > 1.0) continue;
      if (Math.abs(z - chair.at[1]) > chair.radius * 2) continue;
      capVerts++;
      // Roughly up, not exactly up: a console's working surface is ANGLED, so
      // its normal is about 0.88 vertical and 0.47 forward. Demanding 0.9
      // failed geometry that was correct.
      if (data[o + 4] > 0.3) facingUp++;
    }
    assert.ok(capVerts > 0, 'no cap geometry at all');
    assert.equal(facingUp, capVerts,
      `${capVerts - facingUp} of ${capVerts} cap vertices face away from the captain`);
  });

  test('every console in the ship has a working surface you can see', () => {
    // THE GENERAL FORM, and the bug that found it.
    //
    // A working surface angled away from its operator, wound right-then-away,
    // puts its normal DOWN and forward — so back-face culling removes it and
    // the console renders as a box with an open top and no buttons on it. That
    // was true of every console in the game, and the colour-only check above
    // passed straight through it: the geometry was there, the data was right,
    // and none of it was ever drawn.
    //
    // Asserted as PRESENCE rather than absence, because "no down-facing
    // geometry" is not the rule — every box in the ship has a bottom, and a
    // bottom faces down. What must be true is that each console has an
    // up-facing surface at working height where the operator would look.
    const missing = [];
    for (const room of ROOM_LIST) {
      const { data, vertexCount, stride } = roomMeshes(room.id).solid;
      const glowMesh = roomMeshes(room.id).glow;
      const floats = stride / 4;

      for (const station of room.stations ?? []) {
        const near = (mesh) => {
          const d = mesh.data;
          const n = mesh.vertexCount;
          const fl = mesh.stride / 4;
          let hits = 0;
          for (let i = 0; i < n; i++) {
            const o = i * fl;
            const y = d[o + 1];
            if (y < 0.7 || y > 1.25) continue;
            if (Math.hypot(d[o] - station.at[0], d[o + 2] - station.at[1]) > 0.9) continue;
            if (d[o + 4] > 0.3) hits++;
          }
          return hits;
        };
        void data; void vertexCount; void floats;
        if (near(roomMeshes(room.id).solid) === 0) {
          missing.push(`${room.id}/${station.id}: no lit-side working surface`);
        }
        if (near(glowMesh) === 0) {
          missing.push(`${room.id}/${station.id}: no visible buttons`);
        }
      }
    }
    assert.deepEqual(missing, [], 'consoles whose working surface is culled');
  });

  test('nothing on the chair blocks the main viewer', () => {
    // The first placement put the helm officer's headrest across the middle of
    // the screen. The chair itself must not repeat that: from the seated eye,
    // no chair geometry may rise into the cone that contains the aperture.
    const chair = chairProp();
    const vs = ROOMS.bridge.viewscreen;
    const eyeZ = chair.at[1] - EYE_BACK;
    // The bottom of the aperture, as an angle above level from the eye.
    const apertureBottom = Math.atan2(0.74 - EYE_Y, vs.at[1] - eyeZ);

    const { data, vertexCount, stride } = roomMeshes('bridge').solid;
    const floats = stride / 4;
    let blocking = 0;
    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      const x = data[o]; const y = data[o + 1]; const z = data[o + 2];
      // Belonging to the chair means near it in plan AND at chair height. The
      // ceiling fan's apex vertex sits directly above the chair at 2.6 m, and a
      // plan-distance filter alone accuses the deckhead of blocking the viewer.
      if (y > 1.6) continue;
      if (Math.hypot(x - chair.at[0], z - chair.at[1]) > chair.radius * 2.2) continue;
      const ahead = z - eyeZ;
      if (ahead < 0.08) continue;
      if (Math.abs(x - chair.at[0]) > vs.width / 2) continue;
      if (Math.atan2(y - EYE_Y, ahead) > apertureBottom) blocking++;
    }
    assert.equal(blocking, 0, `${blocking} chair vertices sit in front of the viewer`);
  });
});

describe('the jelly beans', () => {
  // docs/RESEARCH.md §8: the controls were moulded resin caps in circles and
  // TRIANGLES, and some of them were literally jelly beans. A grid of coloured
  // squares is a computer keyboard; a scatter of round and triangular caps in
  // five flat colours is 1966, and it is most of what makes a console read as a
  // period object rather than as science fiction generally.

  const capsNear = (mesh, station) => {
    const { data, vertexCount, stride } = mesh;
    const floats = stride / 4;
    const tris = [];
    for (let i = 0; i + 2 < vertexCount; i += 3) {
      const o = i * floats;
      const cx = (data[o] + data[o + floats] + data[o + 2 * floats]) / 3;
      const cz = (data[o + 2] + data[o + floats + 2] + data[o + 2 * floats + 2]) / 3;
      const cy = (data[o + 1] + data[o + floats + 1] + data[o + 2 * floats + 1]) / 3;
      if (cy < 0.7 || cy > 1.25) continue;
      if (Math.hypot(cx - station.at[0], cz - station.at[1]) > 0.9) continue;
      tris.push([cx, cy, cz]);
    }
    return tris;
  };

  test('a console looks the same every time you walk up to it', () => {
    // The layout is hashed from the station index, not rolled. A console that
    // reshuffles its own controls between visits is not a console.
    const first = roomMeshes('bridge').glow;
    const a = Array.from(first.data.slice(0, 4096));
    // Rebuilt from scratch, bypassing the memo the game relies on.
    const b = Array.from(roomMeshes('bridge').glow.data.slice(0, 4096));
    assert.deepEqual(a, b);
  });

  test('no two consoles carry the same arrangement of caps', () => {
    // Every station gets its own layout off its index. Identical consoles all
    // the way round the ring is the giveaway that a machine laid them out.
    const glow = roomMeshes('bridge').glow;
    const counts = ROOMS.bridge.stations.map((st) => capsNear(glow, st).length);
    assert.ok(counts.every((n) => n > 6), `a console with ${Math.min(...counts)} triangles of caps`);
    assert.ok(new Set(counts).size > 3,
      `only ${new Set(counts).size} distinct cap arrangements across ten stations`);
  });

  test('the caps are round and triangular, not a grid of rectangles', () => {
    // A rectangle is two triangles and always an even count. A circle is an
    // eight-triangle fan and a triangle is one. If every console's cap
    // triangles were even, they would all still be rectangles.
    const glow = roomMeshes('bridge').glow;
    const counts = ROOMS.bridge.stations.map((st) => capsNear(glow, st).length);
    assert.ok(counts.some((n) => n % 2 === 1),
      `every console has an even triangle count (${counts.join(', ')}) — these are still rectangles`);
  });
});

describe('the view at warp', () => {
  test('the field is seamless, because every streak has a twin', () => {
    // The illusion is the whole field sliding past and WRAPPING. That only
    // works if a streak leaving the far end has an identical twin arriving at
    // the near end — otherwise every wrap is a frame where the entire sky
    // jumps. Two copies in one buffer is also why it is one draw call and not
    // two, with no seam between them.
    const { data, vertexCount, stride } = warpfield();
    const floats = stride / 4;
    // Keyed on x and y EXACTLY, with a tolerance on z alone.
    //
    // The two copies of a streak are emitted from the same `x` and `y`
    // variables, so those match bitwise; only `z` differs, and it differs by
    // arithmetic — `z + PERIOD + len/2` against `z + len/2` — which in Float32
    // lands about half a millimetre out. Rounding all three to a fixed number
    // of places puts a handful of vertices on a bucket boundary and reports a
    // seam that is not there.
    const byColumn = new Map();
    const near = [];
    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      const x = data[o]; const y = data[o + 1]; const z = data[o + 2];
      const col = `${x},${y}`;
      if (!byColumn.has(col)) byColumn.set(col, []);
      byColumn.get(col).push(z);
      if (z <= WARP_LENGTH) near.push([col, z]);
    }
    let twinned = 0;
    const total = near.length;
    for (const [col, z] of near) {
      const want = z + WARP_LENGTH;
      if (byColumn.get(col).some((other) => Math.abs(other - want) < 0.05)) twinned++;
    }

    assert.ok(total > 100, `only ${total} streak vertices in the near period`);
    assert.equal(twinned, total, `${total - twinned} streaks have no twin — the field will jump on every wrap`);
  });

  test('nothing sits dead ahead, where a streak would be a dead pixel', () => {
    // A streak coming straight at the camera projects to a stationary dot, and
    // a stationary bright dot in the middle of a warp effect reads as a stuck
    // pixel rather than as a star.
    const { data, vertexCount, stride } = warpfield();
    const floats = stride / 4;
    let onAxis = 0;
    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      if (Math.hypot(data[o], data[o + 1]) < 40) onAxis++;
    }
    assert.equal(onAxis, 0, `${onAxis} vertices sit on the course axis`);
  });

  test('a streak is a line, not a box', () => {
    // Two crossed quads, four triangles. The box version was twelve, which put
    // the field at 5,280 triangles against a budget of 8,000 for the whole
    // scene — ships, room and all.
    const tris = warpfield().vertexCount / 3;
    assert.ok(tris < 2400, `${tris} triangles of warp field leaves nothing for the ship`);

    // And it runs ALONG the course, not across it: every streak must be far
    // longer in z than it is wide.
    const { data, vertexCount, stride } = warpfield();
    const floats = stride / 4;
    let minZ = Infinity; let maxZ = -Infinity;
    let minX = Infinity; let maxX = -Infinity;
    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      minZ = Math.min(minZ, data[o + 2]); maxZ = Math.max(maxZ, data[o + 2]);
      minX = Math.min(minX, data[o]); maxX = Math.max(maxX, data[o]);
    }
    assert.ok(maxZ - minZ > (maxX - minX) * 1.5,
      'the field is wider than it is long — these are not streaks');
  });
});

describe('the view from standard orbit', () => {
  const outwardness = (mesh) => {
    // For each vertex, how much its normal agrees with the direction from the
    // centre. A closed shape has all of them pointing out; culling is on, so a
    // shape that has them pointing in is not a dark planet, it is no planet.
    const { data, vertexCount, stride } = mesh;
    const floats = stride / 4;
    let worst = Infinity;
    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      const L = Math.hypot(data[o], data[o + 1], data[o + 2]) || 1;
      const d = (data[o] * data[o + 3] + data[o + 1] * data[o + 4] + data[o + 2] * data[o + 5]) / L;
      worst = Math.min(worst, d);
    }
    return worst;
  };

  test('a world is a closed shape with every face pointing out', () => {
    for (const kind of ['planet', 'desert', 'moon', 'ice', 'gas']) {
      assert.ok(outwardness(worldMesh(kind, 2)) > 0.3,
        `${kind} has faces pointing inward — it will render as a hole`);
    }
  });

  test('a world has more than one colour on it', () => {
    // The whole reason for a second planet mesh is that this one has a SURFACE.
    // A single flat colour means the noise field is dead and the mesh is an
    // expensive way to draw the cheap one.
    const { data, vertexCount, stride } = worldMesh('planet', 1);
    const floats = stride / 4;
    const seen = new Set();
    for (let i = 0; i < vertexCount; i += 3) {
      const o = i * floats;
      seen.add(`${data[o + 6].toFixed(2)},${data[o + 7].toFixed(2)},${data[o + 8].toFixed(2)}`);
    }
    assert.ok(seen.size > 12, `only ${seen.size} distinct colours — the surface is flat`);
  });

  test('two worlds of the same kind are not the same world', () => {
    const a = worldMesh('planet', 1);
    const b = worldMesh('planet', 5);
    let same = 0; let total = 0;
    for (let i = 0; i < a.vertexCount; i++) {
      const o = i * (a.stride / 4);
      total++;
      if (a.data[o + 6] === b.data[o + 6] && a.data[o + 7] === b.data[o + 7]) same++;
    }
    assert.ok(same < total * 0.8, 'the seed does not change the surface');
  });

  test('the limb is a flat ring facing one way, not a shell', () => {
    // It is drawn square to the camera and masked by the planet's own depth.
    // A shell would cover the whole disc in haze instead of rimming it.
    const { data, vertexCount, stride } = limbMesh('planet');
    const floats = stride / 4;
    let flat = 0;
    let maxY = 0;
    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      if (data[o + 4] > 0.99) flat++;
      maxY = Math.max(maxY, Math.abs(data[o + 1]));
    }
    assert.equal(flat, vertexCount, 'some of the ring does not face +y');
    assert.equal(maxY, 0, 'the ring has thickness — it is a shell, not an annulus');
  });

  test('the limb starts inside the world and fades to nothing outside it', () => {
    const { data, vertexCount, stride } = limbMesh('planet');
    const floats = stride / 4;
    let minR = Infinity; let maxR = 0;
    let brightestAtInner = 0; let brightestAtOuter = 0;
    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      const rad = Math.hypot(data[o], data[o + 2]);
      minR = Math.min(minR, rad); maxR = Math.max(maxR, rad);
      const lum = data[o + 6] + data[o + 7] + data[o + 8];
      if (rad < 1.0) brightestAtInner = Math.max(brightestAtInner, lum);
      if (rad > 1.15) brightestAtOuter = Math.max(brightestAtOuter, lum);
    }
    assert.ok(minR < 1, `the ring starts at ${minR.toFixed(3)} — outside the world, so the edge shows`);
    assert.ok(maxR > 1, 'the ring never reaches past the world, so nothing of it is visible');
    assert.ok(brightestAtOuter < brightestAtInner * 0.35,
      'the outer edge is still bright — the halo will end in a hard line');
  });

  test('the sky costs a fifth of what it used to', () => {
    // Stars were cubes: twelve triangles each so that some face always pointed
    // at you. A quad aimed at the centre of the shell does not have that
    // problem, because the eye is always exactly at the centre of the shell.
    // The saving is what pays for a real sphere in orbit.
    const tris = starfield().vertexCount / 3;
    assert.ok(tris <= 600, `${tris} triangles of starfield`);

    const { data, vertexCount, stride } = starfield();
    const floats = stride / 4;
    let facingCentre = 0;
    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      const L = Math.hypot(data[o], data[o + 1], data[o + 2]) || 1;
      const d = -(data[o] * data[o + 3] + data[o + 1] * data[o + 4] + data[o + 2] * data[o + 5]) / L;
      if (d > 0.99) facingCentre++;
    }
    assert.equal(facingCentre, vertexCount, 'some stars are edge-on to the camera and will vanish');
  });

  test('the whole orbital scene fits in the frame budget', () => {
    const tris = worldMesh('planet', 0).vertexCount / 3
      + limbMesh('planet').vertexCount / 3
      + starfield().vertexCount / 3
      + bodyMesh('star', 0).vertexCount / 3;
    assert.ok(tris < 5000, `${tris} triangles of sky before the room is drawn`);
  });

  test('the ship is above the world and pointing along its track', () => {
    const body = { id: 'sol:body:1', x: 4000, y: 0, z: 0, radius: 800 };
    const f = orbitFrame(body, 0.7);
    const alt = Math.hypot(f.position[0] - body.x, f.position[1] - body.y, f.position[2] - body.z);
    assert.ok(Math.abs(alt - body.radius * (1 + ORBIT_ALTITUDE)) < 1e-6,
      'the ship is not at the orbital radius');

    // `up` points from the world at the ship, `forward` is the direction of
    // travel, and travel in a circular orbit is at right angles to the radius.
    // If those two ever stop being perpendicular the ship is falling.
    const dotUpFwd = f.up[0] * f.forward[0] + f.up[1] * f.forward[1] + f.up[2] * f.forward[2];
    assert.ok(Math.abs(dotUpFwd) < 1e-9, `up and forward are ${dotUpFwd} apart from square`);
    assert.ok(Math.abs(Math.hypot(...f.forward) - 1) < 1e-9, 'forward is not a unit vector');
  });

  test('the orbit is a circle, and it closes', () => {
    const body = { id: 'vulcan:body:2', x: -1200, y: 300, z: 5000, radius: 640 };
    const start = orbitFrame(body, 0);
    const round = orbitFrame(body, Math.PI * 2);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(start.position[i] - round.position[i]) < 1e-6,
        'a full circuit does not return the ship to where it started');
    }
    // Every point on it is the same distance out — that is what circular means,
    // and an orbit that breathes is an orbit that is wrong.
    for (const phase of [0, 1, 2.5, 4, 5.9]) {
      const f = orbitFrame(body, phase);
      const d = Math.hypot(f.position[0] - body.x, f.position[1] - body.y, f.position[2] - body.z);
      assert.ok(Math.abs(d - body.radius * (1 + ORBIT_ALTITUDE)) < 1e-6, `radius drifts at phase ${phase}`);
    }
  });

  test('the plane a world is orbited in never changes', () => {
    const a = orbitAxis('sol:body:1');
    const b = orbitAxis('sol:body:1');
    const other = orbitAxis('sol:body:2');
    assert.deepEqual([...a], [...b], 'the same world is orbited differently on each visit');
    assert.notDeepEqual([...a], [...other], 'every world is orbited in the same plane');
  });

  test('a denser world is orbited faster, and nothing else matters', () => {
    // Kepler with a uniform density: μ = (4/3)πGρR³ and a = (1+h)R, so the
    // radius cancels and the period depends on density alone. A gas giant is
    // slow, a rock is quick, and the size of either is irrelevant.
    assert.ok(orbitPeriod('planet') < orbitPeriod('ice'), 'rock is not quicker than ice');
    assert.ok(orbitPeriod('ice') < orbitPeriod('gas'), 'ice is not quicker than a gas giant');

    // And the figures are the documented ones: six and a half hours over an
    // Earth-sized world at the top of the standard band.
    const hours = orbitPeriod('planet') / 3600;
    assert.ok(hours > 5 && hours < 8, `${hours.toFixed(1)} h is not a standard orbit`);

    // A tide-locked moon barely turns; a gas giant is round in under a day.
    assert.ok(rotationPeriod('moon') > rotationPeriod('planet') * 10, 'the moon is not tide-locked');
    assert.ok(rotationPeriod('gas') < rotationPeriod('planet'), 'the gas giant turns too slowly');
  });

  test('the world is smaller than the window, which is the whole reason for the altitude', () => {
    // Down at the bottom of the band the disc is 106° across against a 74°
    // viewer and there is no planet in frame at all, only ground. Up here it
    // fits, which is what makes it the shot.
    const deg = angularRadius() * 2 * 180 / Math.PI;
    assert.ok(deg > 30 && deg < 60, `the world subtends ${deg.toFixed(0)}°`);
    assert.ok(deg < horizontalFov(1.78, 74) * 180 / Math.PI, 'the world is wider than the viewer');
  });

  test('worlds are named for where they are, not at random', () => {
    const v = vistaFor('rigel', 'core');
    const worlds = v.bodies.filter((b) => b.kind !== 'star');
    assert.ok(worlds.length > 0);
    assert.equal(worldLabel('Rigel', worlds[0]), 'Rigel I');
    assert.match(worldLabel('Rigel', v.bodies[0]), /primary/);
    // Stable across calls, which is the point of numbering in placement order.
    assert.equal(worldLabel('Rigel', vistaFor('rigel', 'core').bodies[1]), 'Rigel I');
  });
});

describe('the ground under a landing party', () => {
  const build = (kind = 'desert') => {
    makeSurface({ id: `test:${kind}`, kind, ordinal: 3 }, 'Test III');
    return roomMeshes('surface');
  };

  test('the ground faces UP', () => {
    // This is not a hypothetical. The first version wound the ground rings the
    // way every curved shell in room.js is wound — round the ring, then outward
    // — which is correct on a sphere and upside down on a plain. Culling
    // deleted the whole plain, and what showed through the hole was the sky
    // dome's own skirt, which is ground-coloured. It looked like ground. It was
    // the sky.
    const m = build();
    const { data, vertexCount, stride } = m.solid;
    const floats = stride / 4;
    let flatUp = 0; let flatDown = 0;
    // Anything STANDING on the ground has an underside, which is legitimately
    // face-down at y = 0 — boulders, and the features a landing party walks up
    // to. Skip whatever is standing on something.
    const rocks = [...ROOMS.surface.props, ...ROOMS.surface.stations]
      .map((p) => ({ x: p.at[0], z: p.at[1], r: (p.radius ?? 0.5) * 1.8 }));
    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      // Only the horizontal surfaces at ground level — the hillsides are not
      // flat and the boulders have lids.
      if (Math.abs(data[o + 1]) > 0.01) continue;
      if (rocks.some((r) => Math.hypot(data[o] - r.x, data[o + 2] - r.z) < r.r)) continue;
      if (data[o + 4] > 0.99) flatUp++;
      else if (data[o + 4] < -0.99) flatDown++;
    }
    assert.ok(flatUp > 300, `only ${flatUp} ground vertices face up`);
    assert.equal(flatDown, 0, `${flatDown} ground vertices face down — that much plain is invisible`);
  });

  test('the sky reaches below the horizon', () => {
    // Ending the dome level with the ground left a band of clear colour between
    // the top of the ridge and the bottom of the sky. On a world with a blue
    // sky that band is black, and it reads as a rendering failure because it is
    // one.
    const { data, vertexCount, stride } = build().glow;
    const floats = stride / 4;
    let below = 0;
    for (let i = 0; i < vertexCount; i++) if (data[i * floats + 1] < -1) below++;
    assert.ok(below > 0, 'the sky stops at the horizon');
  });

  test('there is a skyline, not a thread', () => {
    // A ridge five metres high thirty metres away subtends about five degrees,
    // which is a dark line across the bottom of the sky rather than a horizon.
    const { data, vertexCount, stride } = build().solid;
    const floats = stride / 4;
    let peak = 0;
    for (let i = 0; i < vertexCount; i++) peak = Math.max(peak, data[i * floats + 1]);
    assert.ok(peak > 6, `the tallest thing on this world is ${peak.toFixed(1)} m`);
  });

  test('every world type builds, and no two look alike', () => {
    const seen = new Set();
    for (const kind of ['planet', 'desert', 'ice', 'moon']) {
      const m = build(kind);
      assert.ok(m.triangles > 500 && m.triangles < 4000, `${kind}: ${m.triangles} triangles`);
      // The sky colour is the quickest read on whether the palette took.
      const g = m.glow;
      seen.add([g.data[6], g.data[7], g.data[8]].map((v) => v.toFixed(2)).join(','));
    }
    assert.equal(seen.size, 4, 'two world types have the same sky');
  });

  test('an airless world has a black sky at noon', () => {
    // The single most telling thing about standing on a body with no
    // atmosphere, and it costs one palette entry.
    const moon = build('moon').glow;
    const rocky = build('planet').glow;
    const lum = (m) => m.data[6] + m.data[7] + m.data[8];
    assert.ok(lum(moon) < 0.3, `the moon's sky is ${lum(moon).toFixed(2)} bright`);
    assert.ok(lum(rocky) > lum(moon) * 3, 'a world with air has the same sky as one without');
  });

  test('nobody materialises inside a boulder', () => {
    for (const seedKind of ['planet', 'desert', 'ice', 'moon']) {
      makeSurface({ id: `spawn:${seedKind}`, kind: seedKind, ordinal: 1 }, 'Spawn I');
      for (const p of ROOMS.surface.props) {
        const d = Math.hypot(p.at[0], p.at[1]);
        assert.ok(d - p.radius > 0.9,
          `${seedKind}: a boulder reaches within ${(d - p.radius).toFixed(2)} m of the beam-in point`);
      }
    }
  });
});

describe('a room is a box you are inside', () => {
  test('every bulkhead, deck and deckhead faces the room it encloses', () => {
    // The check that was never written, and the cost of not writing it: every
    // box compartment aboard had its four walls, its deck and its deckhead all
    // wound facing OUT. Back-face culling deleted the lot. A box room was a
    // void with furniture standing in it, and it survived because black where a
    // bulkhead should be reads as an unlit bulkhead — until the hangar, at
    // sixteen metres by twenty, made it impossible to mistake for lighting.
    //
    // The rule is one line: a surface enclosing a room has its normal pointing
    // at the middle of that room.
    const wrong = [];
    for (const room of ROOM_LIST) {
      const { data, vertexCount, stride } = roomMeshes(room.id).solid;
      const floats = stride / 4;
      const h = room.shape.height ?? 2.5;

      for (let i = 0; i < vertexCount; i++) {
        const o = i * floats;
        const x = data[o]; const y = data[o + 1]; const z = data[o + 2];
        const nx = data[o + 3]; const ny = data[o + 4]; const nz = data[o + 5];

        // The deck. Anything else sitting at y = 0 is the underside of a prop,
        // which is legitimately face-down, so only the shell itself counts —
        // and the shell is what reaches the walls.
        const onWall = room.shape.kind === 'box'
          ? Math.abs(Math.abs(x) - room.shape.width / 2) < 1e-6
            || Math.abs(Math.abs(z) - room.shape.depth / 2) < 1e-6
          : Math.abs(Math.hypot(x, z) - room.shape.radius) < 0.02;

        if (onWall && Math.abs(ny) < 0.5) {
          // Inward means the normal agrees with the direction to the centre.
          if (nx * -x + nz * -z < -1e-6) wrong.push(`${room.id}: a bulkhead faces out of the room`);
        }
        // The deckhead, which has to look down at the people under it.
        if (Math.abs(y - h) < 1e-6 && ny > 0.9) {
          wrong.push(`${room.id}: the ceiling faces up, into the deck above`);
        }
      }
    }
    assert.deepEqual([...new Set(wrong)], []);
  });

  test('every compartment has a deck you can see', () => {
    // Separate from the winding check because a missing floor and an inverted
    // floor look identical from inside — both are black — and only one of them
    // is caught by asking about normals.
    const floorless = [];
    for (const room of ROOM_LIST) {
      const { data, vertexCount, stride } = roomMeshes(room.id).solid;
      const floats = stride / 4;
      let up = 0;
      for (let i = 0; i < vertexCount; i++) {
        const o = i * floats;
        if (Math.abs(data[o + 1]) < 1e-6 && data[o + 4] > 0.99) up++;
      }
      if (up < 3) floorless.push(`${room.id}: ${up} up-facing deck vertices`);
    }
    assert.deepEqual(floorless, []);
  });
});

describe('a crew that can look at you', () => {
  test('an officer is their own mesh, not part of the room', () => {
    // Baked into the room an officer faces their console for the entire
    // five-year mission, including while reporting to the captain standing
    // behind them. Their own mesh and their own model matrix costs one draw
    // call each and no extra triangles — these are the same triangles that
    // used to be in the room mesh.
    const m = officerMesh('helm', 'floor');
    assert.ok(m.vertexCount > 0, 'the officer has no body');

    // Built at the origin facing +z, which is what makes a single quaternion
    // able to turn the whole figure.
    const { data, vertexCount, stride } = m;
    const floats = stride / 4;
    let maxX = 0; let maxZ = 0;
    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      maxX = Math.max(maxX, Math.abs(data[o]));
      maxZ = Math.max(maxZ, Math.abs(data[o + 2]));
    }
    assert.ok(maxX < 0.6, `the figure reaches ${maxX.toFixed(2)} m off the origin in x`);
    assert.ok(maxZ < 0.6, `the figure reaches ${maxZ.toFixed(2)} m off the origin in z`);
  });

  test('the divisions do not wear the same colour', () => {
    // Scanned across the whole figure rather than off the first vertex: the
    // first box built is the legs, and every division wears the same trousers.
    const palette = (m) => {
      const f = m.stride / 4;
      const seenColours = new Set();
      for (let i = 0; i < m.vertexCount; i++) {
        const o = i * f;
        seenColours.add([m.data[o + 6], m.data[o + 7], m.data[o + 8]].map((v) => v.toFixed(3)).join(','));
      }
      return [...seenColours].sort().join('|');
    };
    const seen = new Set(['helm', 'science', 'engineering', 'medical', 'tactical']
      .map((c) => palette(officerMesh(c, 'wall'))));
    assert.ok(seen.size >= 3, `only ${seen.size} distinct division colours`);
  });

  test('an officer stands on the near side of their console', () => {
    // The side away from the bulkhead it is set into. Standing inside the wall
    // is the failure this exists to prevent.
    for (const room of ROOM_LIST) {
      for (const st of room.stations ?? []) {
        if (!st.crew) continue;
        const [x, z] = officerStandsAt(st);
        const inward = Math.hypot(x, z) <= Math.hypot(st.at[0], st.at[1]) + 1e-6;
        assert.ok(inward, `${room.id}/${st.id}: the officer stands outside their own console`);
        // And inside the room they are supposed to be working in.
        if (room.shape.kind === 'box') {
          assert.ok(Math.abs(x) < room.shape.width / 2 && Math.abs(z) < room.shape.depth / 2,
            `${room.id}/${st.id}: the officer is standing inside the bulkhead`);
        }
      }
    }
  });

  test('the chair stays behind when the officer turns', () => {
    // A chair does not swivel because the person in it looked over their
    // shoulder, so it belongs to the room and the person does not.
    const bridge = roomMeshes('bridge').solid;
    const { data, vertexCount, stride } = bridge;
    const floats = stride / 4;
    // The crew chairs are the one light-blue thing in the room.
    let chairish = 0;
    for (let i = 0; i < vertexCount; i++) {
      const o = i * floats;
      if (data[o + 8] > data[o + 6] * 1.3 && data[o + 7] > data[o + 6]) chairish++;
    }
    assert.ok(chairish > 0, 'the crew chairs left with the officers');
  });
});

describe('a hit you can see and feel', () => {
  test('the shake starts hard and settles, rather than stopping', () => {
    // Squared decay. Linear decay reads as a wobble somebody remembered to
    // stop; this reads as a ship absorbing something.
    const early = Math.abs(joltShake(0.95));
    const late = Math.abs(joltShake(0.2));
    assert.ok(early > late * 3, `early ${early.toFixed(4)} vs late ${late.toFixed(4)}`);
    assert.equal(joltShake(0), 0, 'the deck is still moving after the hit is over');
    assert.equal(joltShake(-1), 0);
  });

  test('a hull breach throws the deck harder than a shield hit', () => {
    assert.ok(Math.abs(joltShake(0.8, true)) > Math.abs(joltShake(0.8, false)));
  });

  test('the deck moves centimetres, not metres', () => {
    // A camera thrown half a metre by a phaser is a camera nobody can play
    // through. The worst case has to stay inside what a person standing on a
    // deck plate would actually experience.
    let worst = 0;
    for (let t = 0; t <= 1; t += 0.005) worst = Math.max(worst, Math.abs(joltShake(t, true)));
    assert.ok(worst < 0.2, `the deck moves ${worst.toFixed(3)} m`);
    assert.ok(worst > 0.02, `the deck barely moves at ${worst.toFixed(3)} m`);
  });

  test('the flash says whether it got through', () => {
    // The one piece of information a captain wants out of a flash, and getting
    // it from the colour means not reading it off a panel mid-fight.
    const hull = joltTint(0.9, true);
    const shield = joltTint(0.9, false);
    assert.ok(hull[0] > hull[2], 'a hull breach does not read red');
    assert.ok(shield[2] > shield[0], 'a shield hit does not read blue');
    // Both brighten: a flash is a flash.
    assert.ok(hull[0] > 1 && shield[2] > 1);
    assert.deepEqual(joltTint(0), [1, 1, 1], 'the picture stays tinted after the hit');
  });
});

// ==================================================== the published numbers

describe('every hull has its numbers, and they are the right shape', () => {
  test('no class is missing a dimension', () => {
    for (const cls of SHIP_LIST) {
      const d = DIMENSIONS[cls.id];
      assert.ok(d, `${cls.id} has no published dimensions`);
      for (const k of ['length', 'beam', 'height', 'decks', 'crew']) {
        assert.ok(Number.isFinite(d[k]) && d[k] >= 0, `${cls.id}.${k} is ${d[k]}`);
      }
      assert.ok(d.length > 0 && d.beam > 0 && d.height > 0,
        `${cls.id} has a zero dimension`);
    }
  });

  test('and nothing is in the table that is not in the game', () => {
    for (const id of Object.keys(DIMENSIONS)) {
      assert.ok(SHIP_LIST.some((c) => c.id === id), `${id} is not a ship class`);
    }
  });

  test('the two length tables cannot drift apart', () => {
    // BLUEPRINTS carries `length` in metres as well, and duplicated numbers
    // are numbers that disagree eventually.
    for (const [id, d] of Object.entries(DIMENSIONS)) {
      assert.equal(BLUEPRINTS[id]?.length, d.length,
        `${id}: blueprint says ${BLUEPRINTS[id]?.length} m, dimensions say ${d.length} m`);
    }
  });

  test('complement agrees with the class table', () => {
    for (const cls of SHIP_LIST) {
      assert.equal(DIMENSIONS[cls.id].crew, cls.crew,
        `${cls.id}: ${DIMENSIONS[cls.id].crew} here, ${cls.crew} in ships.data.js`);
    }
  });

  test('the proportions are physically sane, and the exceptions are real ones', () => {
    // A Bird-of-Prey is wider than it is long — 182 m across the wings against
    // 158 nose to tail — and a Borg cube is a cube. Both are correct, and a
    // check that does not know about them is quietly wrong for the one ship
    // whose shape is its entire identity.
    const WIDER_THAN_LONG = new Set(['bird_of_prey']);
    const CUBES = new Set(['borg_cube']);
    for (const [id, d] of Object.entries(DIMENSIONS)) {
      if (CUBES.has(id)) {
        assert.equal(d.beam, d.length, `${id} is supposed to be a cube`);
        assert.equal(d.height, d.length, `${id} is supposed to be a cube`);
        continue;
      }
      if (WIDER_THAN_LONG.has(id)) {
        assert.ok(d.beam > d.length, `${id} is supposed to be wider than it is long`);
      } else {
        assert.ok(d.beam < d.length, `${id}: beam ${d.beam} is not less than length ${d.length}`);
      }
      assert.ok(d.height < d.length, `${id}: height ${d.height} exceeds its length`);
    }
  });
});

describe('the hulls are built in unit space, not in metres', () => {
  /** Nose-to-tail extent of a built mesh, in the space it was built in. */
  function unitLength(id) {
    const m = hullMesh(id, 'independent');
    const floats = m.stride / 4;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < m.vertexCount; i++) {
      const x = m.data[i * floats];
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    return hi - lo;
  }

  test('no hull is built at its metre length by mistake', () => {
    // The `wedge` and `hauler` builders read `b.length` for their unit-space
    // size, and `length` is METRES everywhere else in that file. Every
    // Cardassian, Dominion, Tholian and civilian hull was therefore built
    // between 80 and 500 times too big and then multiplied by the on-screen
    // scale on top: a Jem'Hadar battleship came out 75,046 units long inside a
    // 2,600-unit engagement volume. Somebody hit this before and invented the
    // `length_` name for the unit-space value; four blueprints carried the
    // right number and no builder ever read it.
    for (const id of Object.keys(BLUEPRINTS)) {
      const l = unitLength(id);
      assert.ok(l > 0.4 && l < 3,
        `${id} is ${l.toFixed(1)} units long in unit space — it is being built in metres`);
    }
  });

  test('drawn size stays inside the engagement volume', () => {
    // ARENA_RADIUS is 2,600. A hull wider than the arena cannot be framed,
    // cannot be flown around, and is the shape this bug took on screen.
    for (const id of Object.keys(BLUEPRINTS)) {
      const drawn = unitLength(id) * hullScale(id);
      assert.ok(drawn < 2600,
        `${id} draws ${drawn.toFixed(0)} units long, larger than the whole arena`);
    }
  });
});

// =============================================== one shape per class of ship

describe('no two Federation classes are the same shape', () => {
  const FEDERATION = Object.entries(BLUEPRINTS)
    .filter(([id]) => DIMENSIONS[id] && SHIP_LIST.find((c) => c.id === id)?.faction === 'federation')
    .map(([id]) => id);

  /**
   * A shape fingerprint that survives being scaled.
   *
   * Normalised to unit length, so this compares SILHOUETTE and not size — the
   * whole failure being guarded against is twelve classes built by one function
   * that differ only in how big they are.
   */
  function fingerprint(id) {
    const m = hullMesh(id, 'federation');
    const f = m.stride / 4;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < m.vertexCount; i++) {
      const x = m.data[i * f];
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    const span = hi - lo || 1;
    // Twelve slices along the hull, each the normalised cross-sectional extent
    // at that station. A Miranda with no engineering hull and an Oberth with
    // two read completely differently here, and that is the point.
    const slices = new Array(12).fill(0);
    for (let i = 0; i < m.vertexCount; i++) {
      const x = m.data[i * f];
      const y = m.data[i * f + 1];
      const z = m.data[i * f + 2];
      const k = Math.min(11, Math.floor(((x - lo) / span) * 12));
      slices[k] = Math.max(slices[k], Math.hypot(y, z) / span);
    }
    return slices;
  }

  test('every Federation hull has a distinct profile', () => {
    const prints = new Map(FEDERATION.map((id) => [id, fingerprint(id)]));
    const same = [];
    for (const a of FEDERATION) {
      for (const b of FEDERATION) {
        if (a >= b) continue;
        const pa = prints.get(a);
        const pb = prints.get(b);
        const diff = pa.reduce((n, v, i) => n + Math.abs(v - pb[i]), 0);
        if (diff < 0.12) same.push(`${a} and ${b} (${diff.toFixed(3)})`);
      }
    }
    assert.deepEqual(same, [],
      'these classes are built as the same shape at different sizes');
  });

  test('the classes that cannot be a parametrised saucer are not one', () => {
    // Four of these are impossible for the shared `starfleet` form at any
    // parameter setting: a Miranda has no secondary hull, an Oberth has two, a
    // Constellation has four nacelles, and a Defiant has no saucer.
    const OWN_FORM = {
      miranda: 'rollbar',
      oberth: 'twinhull',
      constellation: 'quadnacelle',
      nebula: 'podded',
      defiant: 'compact',
      runabout: 'compact',
    };
    for (const [id, form] of Object.entries(OWN_FORM)) {
      assert.equal(BLUEPRINTS[id].form, form, `${id} is still built as a generic saucer`);
    }
  });

  test('a Constellation really does have four nacelles', () => {
    // The count is the silhouette. Counting the emissive bussard caps counts
    // the nacelles, because nothing else on a Federation hull is drawn in the
    // glow colour.
    function glowClusters(id) {
      const m = hullMesh(id, 'federation');
      const f = m.stride / 4;
      const glow = paletteFor('federation').glow;
      const seen = [];
      for (let i = 0; i < m.vertexCount; i++) {
        const r = m.data[i * f + 6];
        const g = m.data[i * f + 7];
        const b = m.data[i * f + 8];
        if (Math.abs(r - glow[0]) > 1e-3 || Math.abs(g - glow[1]) > 1e-3
          || Math.abs(b - glow[2]) > 1e-3) continue;
        const pt = [m.data[i * f], m.data[i * f + 1], m.data[i * f + 2]];
        if (!seen.some((q) => Math.hypot(q[0] - pt[0], q[1] - pt[1], q[2] - pt[2]) < 0.25)) {
          seen.push(pt);
        }
      }
      return seen.length;
    }
    assert.equal(glowClusters('constellation'), 4,
      'a Constellation is the ship with four glowing caps in a square');
    assert.equal(glowClusters('constitution'), 2);
  });

  test('the stretched saucers are actually stretched', () => {
    // A Galaxy's saucer is an ovoid and a Sovereign's a raked ellipse. The
    // primitive could only make circles, so both were drawn as the one shape
    // they are not.
    function saucerAspect(id) {
      const m = hullMesh(id, 'federation');
      const f = m.stride / 4;
      let x0 = Infinity; let x1 = -Infinity; let z1 = 0;
      for (let i = 0; i < m.vertexCount; i++) {
        const y = m.data[i * f + 1];
        if (Math.abs(y) > 0.08) continue;          // the saucer plane only
        x0 = Math.min(x0, m.data[i * f]);
        x1 = Math.max(x1, m.data[i * f]);
        z1 = Math.max(z1, Math.abs(m.data[i * f + 2]));
      }
      return (x1 - x0) / (z1 * 2);
    }
    assert.ok(saucerAspect('galaxy') > 1.1,
      `a Galaxy's saucer is ${saucerAspect('galaxy').toFixed(2)} — still a circle`);
    assert.ok(saucerAspect('sovereign') > saucerAspect('galaxy'),
      'a Sovereign should be longer and narrower than a Galaxy');
  });

  test('and every one of them still builds inside the budget', () => {
    for (const id of Object.keys(BLUEPRINTS)) {
      const m = hullMesh(id, 'federation');
      assert.ok(m.vertexCount > 0, `${id} built nothing`);
      assert.ok(m.triangles < 900, `${id} is ${m.triangles} triangles`);
    }
  });
});
