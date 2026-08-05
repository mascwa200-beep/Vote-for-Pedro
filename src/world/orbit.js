// Standard orbit: where the ship is when it is at a planet rather than near one.
//
// RESEARCH §10 has the sourcing. The short version is that "standard orbit" is
// a band — roughly 1,000 to 7,000 miles up — and not a figure, and that the low
// end of that band is the interesting one, because it is the altitude at which
// the world stops being an object in the window and becomes the ground.
//
// This file is pure arithmetic with no renderer in it, for the same reason
// `gfx/vista.js` is: the view that uses it cannot be imported outside a browser,
// and a camera you cannot test is a camera you find out about in a screenshot.
//
// Two things it deliberately does not do:
//
//   It never touches `Game.rng`. The orbital plane is hashed from the body's
//   id, so entering orbit is observationally free and a save file cannot be
//   desynchronised by looking out of the window.
//
//   It invents no physics. The period below is Kepler's third law with an
//   assumed density, and the altitude is the bottom of the documented band.

import { vec3 } from '../gfx/math.js';
import { hashSeed } from '../core/rng.js';

/**
 * Orbital altitude as a fraction of the world's radius.
 *
 * The documented band runs from about 1,600 km up to about 11,300 km, and this
 * is the top of it: 11,300 km over an Earth-sized world is 1.77 radii. A
 * fraction rather than a distance, because the game's worlds are not all
 * Earth-sized and a fixed altitude would put the ship inside a moon.
 *
 * The top of the band is chosen for what it does to the picture, and the
 * reasoning is in `gfx/scene.js` next to the mesh. Low down, the world is wider
 * than the window and there is no planet in frame at all — only ground. Up here
 * the whole disc subtends 42° against a 74° viewer, which is a world in the
 * screen with a terminator across it.
 */
export const ORBIT_ALTITUDE = 1.77;

/**
 * Seconds of orbit per second of watching.
 *
 * A real circuit takes hours, so at 1:1 nothing appears to move and the view is
 * a photograph. This is a stated compression and not invented physics — the
 * game already runs a twelve-day transit in twenty-two seconds, which is nearly
 * fifty thousand to one. Sixty to one is gentle by comparison and puts a full
 * orbit at about six minutes.
 */
export const ORBIT_TIME_SCALE = 60;

const G = 6.674e-11;

/**
 * Bulk density in kg/m³, by world type. Solar-system figures.
 *
 * These are here because of a pleasant consequence of Kepler's third law: for a
 * body of uniform density, the period of a circular orbit at a fixed MULTIPLE
 * of the radius does not depend on the radius at all. μ = (4/3)πGρR³ and a =
 * (1+h)R, so R cancels completely and the period falls out of the density
 * alone. A gas giant is orbited slowly and a moon quickly, whatever their size,
 * and nothing had to be made up to get there.
 */
const DENSITY = {
  planet: 5514,   // Earth
  desert: 5514,   // Mars is lighter, but a desert world here is a rocky one
  moon: 3340,     // Luna
  ice: 1600,      // Europa and its neighbours
  gas: 1326,      // Jupiter
  star: 1408,     // the Sun, for completeness — nothing orbits one this close
};

/**
 * How long one circuit takes, in seconds.
 *
 * T = 2π √(a³/μ) with a = (1 + ORBIT_ALTITUDE)R and μ = (4/3)πGρR³.
 * Works out to about six and a half hours over a rocky world and thirteen over
 * a gas giant, which is the far end of the documented band and correct for it.
 */
export function orbitPeriod(kind = 'planet') {
  const rho = DENSITY[kind] ?? DENSITY.planet;
  const a = 1 + ORBIT_ALTITUDE;
  return 2 * Math.PI * Math.sqrt((a * a * a) / ((4 / 3) * Math.PI * G * rho));
}

/**
 * How long the world takes to turn once on its own axis, in seconds.
 *
 * Solar-system figures again, and they are more characterful than the orbital
 * period: a gas giant goes round in ten hours and a moon is tide-locked and
 * barely turns at all. Watching from orbit, that difference is visible.
 */
const DAY = {
  planet: 86400,      // Earth
  desert: 88775,      // Mars
  moon: 2360591,      // Luna, locked to its primary — 27 days
  ice: 306822,        // Europa, likewise locked, 3.5 days
  gas: 35730,         // Jupiter, under ten hours
  star: 2160000,      // the Sun at its equator
};

export function rotationPeriod(kind = 'planet') {
  return DAY[kind] ?? DAY.planet;
}

/** Unit vector, in place. Returns the zero-safe result. */
function unit(x, y, z, out) {
  const L = Math.hypot(x, y, z) || 1;
  out[0] = x / L; out[1] = y / L; out[2] = z / L;
  return out;
}

/**
 * The orbital plane's normal, hashed from the body's id.
 *
 * Every world gets its own inclination and it never changes, which is the same
 * rule the vista follows and for the same reason: a plane that is different on
 * each visit makes the place a screensaver.
 */
export function orbitAxis(bodyId, out = vec3()) {
  const h = hashSeed(`orbit:${bodyId}`);
  const a = Number(h & 0xffffn) / 65536 * Math.PI * 2;
  // Inclinations stay within about 35° of the system's plane. Polar orbits are
  // legal and look wrong here — the vista lays its worlds out around a disc,
  // and a ship crossing it at right angles reads as an error rather than a
  // choice.
  const tilt = (Number((h >> 16n) & 0xffffn) / 65536 - 0.5) * 1.2;
  return unit(Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a), out);
}

/**
 * Where the ship is, and which way it is pointing, at this point in the orbit.
 *
 * @param {object} body   a vista body: {id, x, y, z, radius}
 * @param {number} phase  radians around the orbit
 * @returns {{position: Float64Array, up: Float64Array, forward: Float64Array, radius: number}}
 *          `up` points from the world's centre at the ship — so the surface is
 *          straight down `-up` — and `forward` is the direction of travel.
 */
export function orbitFrame(body, phase = 0) {
  const axis = orbitAxis(body.id);
  // Any vector not parallel to the axis will do for the first basis direction;
  // the cross product fixes the rest. Picking the world axis furthest from the
  // orbital normal is what keeps that "not parallel" true near the poles.
  const ax = Math.abs(axis[0]); const ay = Math.abs(axis[1]); const az = Math.abs(axis[2]);
  const seedVec = ay <= ax && ay <= az ? vec3(0, 1, 0)
    : ax <= az ? vec3(1, 0, 0) : vec3(0, 0, 1);
  const e1 = unit(
    axis[1] * seedVec[2] - axis[2] * seedVec[1],
    axis[2] * seedVec[0] - axis[0] * seedVec[2],
    axis[0] * seedVec[1] - axis[1] * seedVec[0],
    vec3(),
  );
  const e2 = unit(
    axis[1] * e1[2] - axis[2] * e1[1],
    axis[2] * e1[0] - axis[0] * e1[2],
    axis[0] * e1[1] - axis[1] * e1[0],
    vec3(),
  );

  const c = Math.cos(phase); const s = Math.sin(phase);
  const up = unit(e1[0] * c + e2[0] * s, e1[1] * c + e2[1] * s, e1[2] * c + e2[2] * s, vec3());
  const r = body.radius * (1 + ORBIT_ALTITUDE);
  const position = vec3(
    body.x + up[0] * r,
    body.y + up[1] * r,
    body.z + up[2] * r,
  );
  // Travel is along the orbit, which is the axis crossed into the radius.
  const forward = unit(
    axis[1] * up[2] - axis[2] * up[1],
    axis[2] * up[0] - axis[0] * up[2],
    axis[0] * up[1] - axis[1] * up[0],
    vec3(),
  );
  return { position, up, forward, axis, radius: r };
}

/**
 * How wide the world looks from orbit: the angular RADIUS of the disc, in
 * radians.
 *
 * asin(R / (R + h)) — 21° at the standard altitude, so a 42° disc against a
 * viewer that is 74° across. That is the number the framing is built on, and
 * the reason the camera has to look down rather than along the track: the world
 * is directly beneath the ship, not ahead of it.
 */
export function angularRadius(altitude = ORBIT_ALTITUDE) {
  return Math.asin(1 / (1 + altitude));
}
