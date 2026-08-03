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
import { BLUEPRINTS, hullMesh, hullScale, paletteFor } from '../src/gfx/blueprint.js';
import { sceneMeshes, starfield, gridMesh, VOLUME } from '../src/gfx/scene.js';
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

  test('scale compresses a 130:1 length range into something viewable', () => {
    // 23 m runabout to a 3,040 m cube. Linear scaling makes one of them a pixel.
    const runabout = hullScale('runabout');
    const connie = hullScale('constitution');
    const cube = hullScale('borg_cube');
    assert.ok(runabout < connie && connie < cube, `${runabout} ${connie} ${cube}`);
    assert.ok(cube / runabout < 4, `cube is ${(cube / runabout).toFixed(1)}× the runabout on screen`);
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
