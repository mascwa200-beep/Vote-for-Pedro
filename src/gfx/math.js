// Vector and matrix maths for the 3D renderer.
//
// Float64 throughout, matching the rest of the simulation. The extra precision
// is not needed for a projection matrix, but it is needed for ship positions —
// a tactical volume is 3,000 units across and the sim runs for hours, and
// mixing float32 state into a float64 simulation is how determinism quietly
// stops holding.
//
// Matrices are column-major 16-element arrays, the layout WebGL expects, so
// they go to the GPU without transposing. Every function that returns a matrix
// takes an optional output array, because the render loop should not allocate.

import { clamp } from '../core/num.js';

// No `DEG` here, deliberately.
//
// It was exported from this file and imported by nothing, while
// `src/ui/tactical3d.js`, `src/gfx/vista.js` and `src/sim/ship.js` each
// declared the identical `Math.PI / 180` locally. The third of those is the
// reason not to republish it for them to share: `src/sim/` reaching into
// `src/gfx/` for a constant couples the simulation to the renderer, and the
// simulation has to keep running when nothing is drawing at all. One line of
// arithmetic repeated three times is the cheaper of the two.

// ---------------------------------------------------------------- vectors

export const vec3 = (x = 0, y = 0, z = 0) => new Float64Array([x, y, z]);

export function add(a, b, out = vec3()) {
  out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2];
  return out;
}

export function sub(a, b, out = vec3()) {
  out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2];
  return out;
}

export function scale(a, s, out = vec3()) {
  out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s;
  return out;
}

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function cross(a, b, out = vec3()) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

export const length = (a) => Math.hypot(a[0], a[1], a[2]);

export function normalize(a, out = vec3()) {
  const len = length(a);
  if (len === 0) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
  out[0] = a[0] / len; out[1] = a[1] / len; out[2] = a[2] / len;
  return out;
}

export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Rotate a vector by a quaternion. */
export function transformQuat(v, q, out = vec3()) {
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;
  // t = 2 * cross(q.xyz, v); out = v + qw * t + cross(q.xyz, t)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + qy * tz - qz * ty;
  out[1] = y + qw * ty + qz * tx - qx * tz;
  out[2] = z + qw * tz + qx * ty - qy * tx;
  return out;
}

// ------------------------------------------------------------ quaternions

export const quat = (x = 0, y = 0, z = 0, w = 1) => new Float64Array([x, y, z, w]);

// `quatIdentity` and `quatNormalize` are used by the rotations below and by
// nothing outside this file, so they are not exported. They are not dead —
// grepping for them outside `math.js` makes them look it, which is why the
// guard in tests/wiring.test.js counts importers rather than mentions.
function quatIdentity(out = quat()) {
  out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1;
  return out;
}

/** Rotation of `rad` about an arbitrary axis. */
export function quatAxisAngle(axis, rad, out = quat()) {
  const n = normalize(axis);
  const h = rad / 2;
  const s = Math.sin(h);
  out[0] = n[0] * s; out[1] = n[1] * s; out[2] = n[2] * s; out[3] = Math.cos(h);
  return out;
}

export function quatMultiply(a, b, out = quat()) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

function quatNormalize(q, out = quat()) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len === 0) return quatIdentity(out);
  out[0] = q[0] / len; out[1] = q[1] / len; out[2] = q[2] / len; out[3] = q[3] / len;
  return out;
}

/**
 * Shortest-arc rotation that takes `from` to `to`.
 * Used to point a hull along its velocity without accumulating drift.
 */
export function quatFromTo(from, to, out = quat()) {
  const a = normalize(from);
  const b = normalize(to);
  const d = dot(a, b);
  if (d >= 0.999999) return quatIdentity(out);
  if (d <= -0.999999) {
    // Opposed: any perpendicular axis will do, so pick a stable one.
    let axis = cross(vec3(1, 0, 0), a);
    if (length(axis) < 1e-6) axis = cross(vec3(0, 1, 0), a);
    return quatAxisAngle(axis, Math.PI, out);
  }
  const c = cross(a, b);
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = 1 + d;
  return quatNormalize(out, out);
}

/** Spherical interpolation, for a camera that does not snap. */
export function quatSlerp(a, b, t, out = quat()) {
  let [bx, by, bz, bw] = b;
  let cosom = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cosom < 0) { cosom = -cosom; bx = -bx; by = -by; bz = -bz; bw = -bw; }

  let s0 = 1 - t;
  let s1 = t;
  if (1 - cosom > 1e-6) {
    const omega = Math.acos(cosom);
    const sinom = Math.sin(omega);
    s0 = Math.sin((1 - t) * omega) / sinom;
    s1 = Math.sin(t * omega) / sinom;
  }
  out[0] = s0 * a[0] + s1 * bx;
  out[1] = s0 * a[1] + s1 * by;
  out[2] = s0 * a[2] + s1 * bz;
  out[3] = s0 * a[3] + s1 * bw;
  return out;
}

/** Pitch, yaw and roll (radians) applied in that order, as a quaternion. */
export function quatFromEuler(pitch, yaw, roll, out = quat()) {
  const cp = Math.cos(pitch / 2); const sp = Math.sin(pitch / 2);
  const cy = Math.cos(yaw / 2); const sy = Math.sin(yaw / 2);
  const cr = Math.cos(roll / 2); const sr = Math.sin(roll / 2);
  out[0] = sp * cy * cr - cp * sy * sr;
  out[1] = cp * sy * cr + sp * cy * sr;
  out[2] = cp * cy * sr - sp * sy * cr;
  out[3] = cp * cy * cr + sp * sy * sr;
  return out;
}

// --------------------------------------------------------------- matrices

export const mat4 = () => new Float64Array(16);

export function identity(out = mat4()) {
  out.fill(0);
  out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
  return out;
}

export function multiply(a, b, out = mat4()) {
  const o = out === a || out === b ? mat4() : out;
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4]; const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2]; const b3 = b[c * 4 + 3];
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
    }
  }
  if (o !== out) out.set(o);
  return out;
}

/** Right-handed perspective, depth in [-1, 1] as WebGL 1 expects. */
export function perspective(fovyRad, aspect, near, far, out = mat4()) {
  // Guarded because the failure is silent. A zero aspect, a zero field of view
  // or a near plane equal to the far one all produce a matrix full of NaN and
  // Infinity, and the result is a black viewport with nothing logged anywhere.
  //
  // The callers do guard — tactical3d.js falls back to 320px and gl.js divides
  // by `Math.max(1, h)` — so this is not reachable today. It is here because a
  // canvas measured before layout is a very ordinary way to get a zero.
  const fov = clamp(fovyRad, 1e-3, Math.PI - 1e-3);
  const ratio = clamp(aspect, 1e-3, 1e3);
  const n = clamp(near, 1e-4, 1e9);
  const fPlane = Math.max(n + 1e-4, clamp(far, 1e-4, 1e12));

  const f = 1 / Math.tan(fov / 2);
  out.fill(0);
  out[0] = f / ratio;
  out[5] = f;
  out[10] = (fPlane + n) / (n - fPlane);
  out[11] = -1;
  out[14] = (2 * fPlane * n) / (n - fPlane);
  return out;
}

/** Right-handed look-at. `up` need not be perpendicular to the view direction. */
export function lookAt(eye, target, up, out = mat4()) {
  const z = normalize(sub(eye, target));
  let x = cross(up, z);
  if (length(x) < 1e-6) {
    // Looking straight along `up`; nudge so the basis stays well-formed.
    x = cross(vec3(up[1], up[2], up[0]), z);
  }
  normalize(x, x);
  const y = cross(z, x);

  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
  out[12] = -dot(x, eye); out[13] = -dot(y, eye); out[14] = -dot(z, eye); out[15] = 1;
  return out;
}

/** Model matrix from position, orientation quaternion and uniform scale. */
export function compose(position, orientation, s = 1, out = mat4()) {
  const [x, y, z, w] = orientation;
  const x2 = x + x; const y2 = y + y; const z2 = z + z;
  const xx = x * x2; const xy = x * y2; const xz = x * z2;
  const yy = y * y2; const yz = y * z2; const zz = z * z2;
  const wx = w * x2; const wy = w * y2; const wz = w * z2;

  out[0] = (1 - (yy + zz)) * s;
  out[1] = (xy + wz) * s;
  out[2] = (xz - wy) * s;
  out[3] = 0;
  out[4] = (xy - wz) * s;
  out[5] = (1 - (xx + zz)) * s;
  out[6] = (yz + wx) * s;
  out[7] = 0;
  out[8] = (xz + wy) * s;
  out[9] = (yz - wx) * s;
  out[10] = (1 - (xx + yy)) * s;
  out[11] = 0;
  out[12] = position[0]; out[13] = position[1]; out[14] = position[2];
  out[15] = 1;
  return out;
}

/**
 * Inverse-transpose of the upper 3×3, for transforming normals.
 * With uniform scale the rotation alone would do, but ships get scaled
 * non-uniformly when a hull is stretched, and lighting must not shear with it.
 */
export function normalMatrix(m, out = new Float64Array(9)) {
  const a00 = m[0]; const a01 = m[1]; const a02 = m[2];
  const a10 = m[4]; const a11 = m[5]; const a12 = m[6];
  const a20 = m[8]; const a21 = m[9]; const a22 = m[10];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;

  let det = a00 * b01 + a01 * b11 + a02 * b21;
  if (!det) { out.fill(0); out[0] = 1; out[4] = 1; out[8] = 1; return out; }
  det = 1 / det;

  // The inverse, written out TRANSPOSED. That transpose is the whole point of
  // a normal matrix and it was missing: the terms below were previously stored
  // in reading order, which yields inverse(M3) rather than its transpose.
  //
  // For a rotation the two differ exactly by the direction of the turn — a
  // rotation's inverse-transpose is the rotation itself, so the correct matrix
  // at unit scale is the model's own rotation, and what came out was its
  // inverse. Every hull was therefore lit by a normal turned the wrong way by
  // its own orientation. An unrotated ship looks identical (the identity is
  // its own transpose), which is why it survived: the browser harness checks
  // that pixels are drawn, not that the light lands on the right side.
  out[0] = b01 * det;
  out[3] = (-a22 * a01 + a02 * a21) * det;
  out[6] = (a12 * a01 - a02 * a11) * det;
  out[1] = b11 * det;
  out[4] = (a22 * a00 - a02 * a20) * det;
  out[7] = (-a12 * a00 + a02 * a10) * det;
  out[2] = b21 * det;
  out[5] = (-a21 * a00 + a01 * a20) * det;
  out[8] = (a11 * a00 - a01 * a10) * det;
  return out;
}

/** Project a world point to normalised device coordinates. Returns null if behind the camera. */
export function project(point, viewProj) {
  const [x, y, z] = point;
  const w = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
  if (w <= 1e-6) return null;
  return {
    x: (viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12]) / w,
    y: (viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13]) / w,
    z: (viewProj[2] * x + viewProj[6] * y + viewProj[10] * z + viewProj[14]) / w,
  };
}
