// Using the terrain, which nobody was.
//
// #136 put rocks in the engagement volume and gave them consequences: a shot
// with a rock in the way is not fired at all, so getting one between you and
// somebody stops the incoming fire rather than making it miss. That is the
// definition of cover, and it was available to every ship in the fight.
//
// Measured over a hundred and sixty fights in a debris field, through the real
// fight loop with the same simple pilot the balance suite flies:
//
//     hostile-ticks behind cover                19.3%
//     hostile-ticks behind cover WHEN HURT      14.0%
//
// A hostile below half hull was LESS likely to be behind a rock than a healthy
// one — because a hurt ship stops circling and holds station to present its
// strongest shield, which is the one behaviour guaranteed to leave it in the
// open.
//
// This module is the geometry and the decision. It reads the arena and answers
// three questions a captain would ask, and nothing in it touches the
// simulation's random stream or moves a ship: `ai.js` decides what to do with
// the answers.

import { blockedBy, insideSolid } from './arena.js';

/** How far off a rock's skin a ship tries to sit. */
const STANDOFF = 90;

/**
 * Is there rock between these two right now?
 *
 * The same call `fireWeapon` makes, named for what it means at the AI layer.
 * Cover is symmetric — a rock that stops their shot stops yours — and that
 * symmetry is the whole tension: you go behind it to stop being hit and you
 * come out again because you cannot win from there.
 */
export const inCover = (arena, ship, threat) => !!blockedBy(arena, ship, threat);

/**
 * Somewhere to be that puts a rock between this ship and that one.
 *
 * The point is on the far side of the rock from the threat, one standoff clear
 * of its skin: the line from there to the threat passes through the rock's
 * centre, which is as blocked as a line can be. Rocks are scored on how far the
 * ship has to fly to reach the spot, penalised by how far that spot is from the
 * fight — a rock behind you at the arena's edge is cover you never come back
 * from, and a captain who takes it has left the battle.
 *
 * @returns {{x,y,z,rock}|null} null when there is nothing worth hiding behind.
 */
export function coverPoint(arena, ship, threat, { maxRun = 1500 } = {}) {
  if (!arena?.features?.length) return null;
  let best = null;
  let bestScore = Infinity;
  for (const f of arena.features) {
    if (f.type !== 'solid') continue;
    // Big enough to hide the ship rather than to scratch its paint.
    if (f.r < 80) continue;
    const dx = f.x - threat.x;
    const dy = f.y - threat.y;
    const dz = f.z - (threat.z ?? 0);
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) continue;
    // The NEAREST point in the rock's shadow, not the far pole of it.
    //
    // A sphere lit from the threat casts a shadow behind it, and every point in
    // that shadow is cover. Aiming at the far pole means flying all the way
    // round even when already three quarters of the way there — measured, only
    // 33% of the time a ship spent "hiding" was time it was actually behind
    // anything; the rest was transit.
    //
    // `along` is how far behind the rock the ship already is and `q` how far
    // off the shadow's axis. Clamping each to the nearest value that is inside
    // the shadow gives the closest spot that works.
    const ux = dx / d; const uy = dy / d; const uz = dz / d;
    const sx = ship.x - f.x; const sy = ship.y - f.y; const sz = (ship.z ?? 0) - f.z;
    const along = Math.max(sx * ux + sy * uy + sz * uz, f.r * 0.35 + STANDOFF * 0.5);
    let qx = sx - (sx * ux + sy * uy + sz * uz) * ux;
    let qy = sy - (sx * ux + sy * uy + sz * uz) * uy;
    let qz = sz - (sx * ux + sy * uy + sz * uz) * uz;
    const q = Math.hypot(qx, qy, qz);
    // Well inside the shadow rather than on its edge: the threat is moving,
    // and a spot on the rim stops being cover the moment it does.
    const want = Math.min(q, f.r * 0.55);
    if (q > 1e-6) { qx = (qx / q) * want; qy = (qy / q) * want; qz = (qz / q) * want; }
    const spot = {
      x: f.x + ux * along + qx,
      y: f.y + uy * along + qy,
      z: f.z + uz * along + qz,
    };
    const run = Math.hypot(spot.x - ship.x, spot.y - ship.y, spot.z - (ship.z ?? 0));
    if (run > maxRun) continue;
    // How far the hiding place is from the enemy, which is how far you have to
    // come back. Weighted lightly: the run matters more, but of two rocks at
    // the same distance the near one is the one you can fight from again.
    const fromFight = Math.hypot(spot.x - threat.x, spot.y - threat.y, spot.z - (threat.z ?? 0));
    const score = run + fromFight * 0.35;
    if (score < bestScore) {
      bestScore = score;
      best = { ...spot, rock: f };
    }
  }
  return best;
}

/**
 * A heading that goes AROUND the rock in the way instead of into it.
 *
 * `Combat.keepOutOfRocks` shoves a ship that has ended up inside one out to the
 * surface, every tick, which is a floor rather than a manoeuvre: a hostile that
 * has decided to fly through a two-hundred-unit rock spends the crossing being
 * teleported back onto its skin. Nothing ever steered.
 *
 * The deflection is the tangent: slide the aim point sideways, perpendicular to
 * the run and away from the rock's centre, by enough to clear it. One step,
 * recomputed every decision tick, which is what a helmsman does — not a path
 * plan, which would be a lie about how much this AI knows.
 *
 * @returns {{x,y,z}} the point to steer at, unchanged when the way is clear.
 */
export function steerAround(arena, ship, aim, { ignore = null } = {}) {
  if (!arena?.features?.length) return aim;
  const at = { x: ship.x, y: ship.y, z: ship.z ?? 0 };
  // `ignore` is the rock being flown TO. Without it a ship running for cover
  // deflects around the very rock it is trying to get behind, every tick, and
  // never arrives — which is most of what "hiding but not in cover" was.
  let rock = blockedBy(arena, at, aim) ?? insideSolid(arena, at);
  if (rock && ignore && rock === ignore) rock = insideSolid(arena, at);
  if (!rock) return aim;

  const dx = aim.x - at.x;
  const dy = aim.y - at.y;
  const dz = (aim.z ?? 0) - at.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return aim;
  const ux = dx / len; const uy = dy / len; const uz = dz / len;

  // The rock's offset from the run, with the along-run part removed: what is
  // left points from the line to the rock's centre.
  const rx = rock.x - at.x;
  const ry = rock.y - at.y;
  const rz = rock.z - at.z;
  const along = rx * ux + ry * uy + rz * uz;
  let ox = rx - along * ux;
  let oy = ry - along * uy;
  let oz = rz - along * uz;
  let off = Math.hypot(ox, oy, oz);
  if (off < 1e-3) {
    // Dead-on: any perpendicular will do, and one has to be chosen rather than
    // divided by zero. Cross with whichever axis the run is least parallel to.
    const ax = Math.abs(ux) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    ox = uy * ax[2] - uz * ax[1];
    oy = uz * ax[0] - ux * ax[2];
    oz = ux * ax[1] - uy * ax[0];
    off = Math.hypot(ox, oy, oz) || 1;
  }
  // A WAYPOINT ABREAST OF THE ROCK, not the destination nudged sideways.
  //
  // Offsetting the far end by the rock's radius does not clear the rock: the
  // line's closest approach is that offset scaled by how far along the rock
  // sits, so a rock 300 units into a 700-unit run was still missed by only 124
  // of the 200 needed. Measured on exactly that case, which is why the test
  // for it asserts the deflected run is clear rather than merely different.
  //
  // Steering at a point level with the rock and one standoff outside it makes
  // the ship pass it at that distance, and the run recomputes clear once it is
  // past — which is what going round something is.
  const push = rock.r + STANDOFF;
  const reach = Math.max(along, 1);
  return {
    x: at.x + ux * reach - (ox / off) * push,
    y: at.y + uy * reach - (oy / off) * push,
    z: at.z + uz * reach - (oz / off) * push,
  };
}

// ---------------------------------------------------------------- the gas
//
// THERE IS NO `murkPoint`, AND THAT IS A MEASUREMENT RATHER THAN AN OVERSIGHT.
//
// The obvious next move is to have a losing ship run into a cloud: `resolveHit`
// takes the WORSE sensor noise at either end of a shot, so gas spoils a firing
// solution. Written and then measured over sixty-four fights per arena, the
// share of hostile-ticks already spent inside a cloud without anybody trying:
//
//     nebula          96.0%      (one cloud, 2,400 units, centred on the fight)
//     metreon         77.7%
//     plasma storm    65.4%
//
// The clouds are big and the fight collapses to the middle of them, so a ship
// steering for the murk would be steering for where it already is. Rock is
// different — it is small, there are sixteen pieces, and being behind one is a
// decision — which is why cover is a manoeuvre and weather is a condition.
