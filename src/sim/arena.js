// The place a fight happens in.
//
// Every engagement in this game was fought in the same empty box. The world
// data has said otherwise for as long as it has existed: six systems declare a
// `hazard` — a debris field at Wolf 359, a nebula at Mutara, a plasma storm in
// the Badlands, metreon gas in the Briar Patch, a Tholian web, a temporal
// anomaly at Devron — the map draws each of them as a red pill, and combat read
// none of them. Fighting inside the Mutara Nebula was identical to fighting in
// orbit of Earth.
//
// This is the terrain. It does two things and only two, because a fight that
// cannot be reasoned about is not deeper than one that can:
//
//   SOLID features block line of fire. A shot whose path crosses one does not
//   arrive. That makes position mean something beyond range and facing: there
//   is somewhere to be that they cannot shoot you from.
//
//   CLOUD features blind. Inside one, sensors are noise and shields will not
//   hold a charge — and a cloaking device is useless, because the thing that
//   makes a nebula terrible for gunnery makes it terrible for hiding too. It
//   is the Mutara Nebula, and it turns a duel into two ships groping for each
//   other at knife range.
//
// Deterministic and STATELESS ONCE BUILT. Nothing here moves, nothing here has
// a hit point, nothing here is written to during a fight. That is deliberate:
// a fight is not resumed from a save (`Game.load` says so and means it), so an
// arena that never changes needs no serialisation and can never come back
// wrong.

import { clamp } from '../core/num.js';

/**
 * What each declared hazard is, as terrain.
 *
 * Keyed by the `hazard` field on a system in world/systems.data.js, so the
 * table cannot drift from the data: a system whose hazard has no entry here
 * fights in the open, which is what happened everywhere before.
 *
 * `solid` features are rock and hull fragments. `cloud` features are gas.
 * A kind may have both; none does yet.
 */
export const ARENA_KINDS = {
  /**
   * Wolf 359. A graveyard with coordinates.
   *
   * Big, slow-tumbling pieces of ship, far enough apart to fly between and
   * large enough to hide a Constitution behind. The count and the sizes are
   * what make it cover rather than confetti: forty small rocks are a texture,
   * twelve large ones are a decision.
   *
   * `spread` was chosen by measurement, twenty fights a setting, a
   * Constitution against two D7s, counting BLOCKED SHOTS OUT OF SHOTS FIRED
   * through the `combat:fire` event rather than by sampling random lines:
   *
   *     spread   blocked   median fight   (open space: 0%, 51 s)
   *     0.42      5.1%       59 s
   *     0.36      9.4%       64 s
   *     0.30     14.1%       79 s
   *
   * A random-line probe over the same field said 56% and was measuring
   * something else entirely: real fights collapse to short range near the
   * origin within seconds, and long lines drawn across the whole volume cross
   * everything. 0.36 is cover you notice without gunnery that feels broken,
   * and 0.30 costs half again as long a battle for it.
   */
  debris: {
    id: 'debris',
    name: 'debris field',
    solid: { count: 16, radius: [110, 260], spread: 0.36 },
    // Nothing to see through — a rock is not weather.
    sensorNoise: 0,
  },

  /**
   * Mutara. "The nebula will scramble our shields and sensors."
   *
   * The whole volume, not patches of it: a nebula you can steer out of is a
   * hazard, and the one this is named after is a condition of the battle.
   */
  nebula: {
    id: 'nebula',
    name: 'nebula',
    cloud: { count: 1, radius: [2400, 2400], centred: true },
    sensorNoise: 0.35,
    shieldSuppression: 1,
    breaksCloak: true,
    tint: [0.85, 0.55, 0.95],
  },

  /**
   * The Badlands. Plasma fronts and a lot of very hot nothing.
   *
   * Patchy rather than total — the Badlands are navigable by someone who knows
   * them, which is the entire reason anyone runs to them. Smaller clouds,
   * several of them, with gaps you can fight in.
   */
  plasma_storm: {
    id: 'plasma_storm',
    name: 'plasma storm',
    cloud: { count: 5, radius: [420, 780], spread: 0.34 },
    sensorNoise: 0.3,
    shieldSuppression: 0.5,
    tint: [1.0, 0.6, 0.3],
  },

  /**
   * The Briar Patch. Metreon gas, and no warp field will form in it.
   *
   * The signature of the place is that you cannot leave at speed, which the
   * engagement already models — `canWarpOut` has existed since fights could be
   * fled from and nothing has ever set it false outside the Kobayashi Maru.
   */
  metreon: {
    id: 'metreon',
    name: 'metreon gas',
    cloud: { count: 4, radius: [500, 900], spread: 0.34 },
    sensorNoise: 0.18,
    noWarp: true,
    tint: [0.95, 0.85, 0.45],
  },
};

/** The hazards that do nothing to a fight, and why, so nobody adds them twice. */
export const OPEN_HAZARDS = {
  // A Tholian web is a weapon somebody deploys during a fight, not scenery
  // that is there when it starts. It has its own encounter.
  tholian_web: 'the web is deployed, not terrain',
  // Devron's anomaly is a story, not a gunnery problem.
  temporal: 'nothing about it changes how a shot flies',
};

/**
 * Nothing in the way and nothing in the air. The default, and most fights.
 *
 * DEEP frozen, and the array is the point. `Object.freeze` on the object alone
 * freezes the property that HOLDS the list, not the list — so a single stray
 * `arena.features.push(...)` anywhere would give every open-space fight for the
 * life of the process the same permanent terrain, and there is exactly one of
 * these objects shared by every battle that has no weather. Found by a test
 * that asserted the push would throw and watched it succeed, and then watched
 * the invariant checker report a hundred and fifty malformed features in a
 * battle at Sol.
 */
export const OPEN_ARENA = Object.freeze({
  kind: null, name: 'open space', features: Object.freeze([]),
});

/**
 * Build the terrain for one fight.
 *
 * @param {RNG} rng a DERIVED stream — see the note in Game.startCombat. Drawing
 *   arena rolls from the fight's own stream would move every seeded outcome in
 *   the game the moment terrain existed.
 * @param {string|null} hazard the `hazard` field of the system, or null.
 * @param {object} opts { radius, clear } — `clear` is a list of {x,y,z} that no
 *   solid feature may sit on top of, which is where the combatants start.
 */
export function buildArena(rng, hazard, { radius = 2600, clear = [] } = {}) {
  const kind = ARENA_KINDS[hazard];
  if (!kind || !rng) return OPEN_ARENA;

  const features = [];
  const place = (spec, type) => {
    for (let i = 0; i < spec.count; i++) {
      const r = rng.range(spec.radius[0], spec.radius[1]);
      if (spec.centred) {
        features.push({ type, kind: kind.id, x: 0, y: 0, z: 0, r });
        continue;
      }
      // Rejection sampling with a hard cap.
      //
      // The cap matters more than the sampling: a placement loop that keeps
      // trying until it succeeds is a hang whenever the constraints cannot be
      // met, and "cannot be met" here is one bad `clear` list away. Twenty
      // tries and then this rock simply does not exist.
      for (let attempt = 0; attempt < 20; attempt++) {
        // WITHIN REACH OF THE FIGHT, not spread through the whole arena.
        //
        // The first version scattered features across the full 2,600-unit
        // volume, and measured over ninety-six battles not one shot was ever
        // blocked and no ship ever entered a cloud: a fight collapses to
        // inside a thousand units in the first few seconds and stays there,
        // so terrain out at two thousand is scenery for a camera that never
        // looks at it. `spread` is the share of the arena the features
        // actually occupy — a debris field is a graveyard in one place, not a
        // uniform haze filling a sphere twenty kilometres across.
        const reach = radius * (spec.spread ?? 1);
        const u = 0.3 + 0.7 * rng.float();
        const theta = rng.float() * Math.PI * 2;
        const phi = (rng.float() - 0.5) * 0.7;
        const d = u * Math.max(r * 1.2, reach - r);
        const x = Math.cos(theta) * Math.cos(phi) * d;
        const y = Math.sin(theta) * Math.cos(phi) * d;
        const z = Math.sin(phi) * d;
        // Constraints apply to ROCK ONLY, and getting that wrong silently
        // deleted the weather.
        //
        // "Never on top of a combatant" is a rule about solid objects: a ship
        // that starts inside a rock cannot be shot from anywhere. Applied to
        // gas it says the opposite of what is wanted — a cloud is meant to
        // have ships in it — and since a plasma cloud is 780 units across and
        // everybody starts within a thousand units of the origin, every one of
        // the twenty placement attempts failed and the Badlands and the Briar
        // Patch came out as open space. Two of the four weather systems in the
        // game, built, measured as having no features, and reported by the
        // probe rather than by anything that looked right.
        //
        // Overlap is the same: two rocks in the same place are one lumpy rock
        // tested twice, but two overlapping clouds are just thicker gas.
        if (type === 'solid') {
          const tooClose = clear.some((c) => Math.hypot(x - c.x, y - c.y, z - (c.z ?? 0)) < r + 220)
            || features.some((f) => f.type === 'solid'
              && Math.hypot(x - f.x, y - f.y, z - f.z) < r + f.r);
          if (tooClose) continue;
        }
        features.push({ type, kind: kind.id, x, y, z, r });
        break;
      }
    }
  };

  if (kind.solid) place(kind.solid, 'solid');
  if (kind.cloud) place(kind.cloud, 'cloud');

  return {
    kind: kind.id,
    name: kind.name,
    features,
    sensorNoise: kind.sensorNoise ?? 0,
    shieldSuppression: kind.shieldSuppression ?? 0,
    breaksCloak: kind.breaksCloak === true,
    noWarp: kind.noWarp === true,
    tint: kind.tint ?? null,
  };
}

/**
 * Does a straight line from `a` to `b` pass through something solid?
 *
 * Standard segment-versus-sphere: project the sphere's centre onto the
 * segment, clamp the projection to the segment's ends, and measure. The clamp
 * is the part that is easy to leave out and it is what stops a rock BEHIND the
 * shooter from blocking a shot fired the other way.
 *
 * @returns {object|null} the feature in the way, or null.
 */
export function blockedBy(arena, a, b) {
  if (!arena?.features?.length) return null;
  const ax = a.x; const ay = a.y; const az = a.z ?? 0;
  const dx = b.x - ax; const dy = b.y - ay; const dz = (b.z ?? 0) - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 <= 0) return null;

  for (const f of arena.features) {
    if (f.type !== 'solid') continue;
    const t = clamp(((f.x - ax) * dx + (f.y - ay) * dy + (f.z - az) * dz) / len2, 0, 1);
    const px = ax + dx * t; const py = ay + dy * t; const pz = az + dz * t;
    if (Math.hypot(f.x - px, f.y - py, f.z - pz) < f.r) return f;
  }
  return null;
}

/** Is this point inside a rock? Used to keep ships from flying through one. */
export function insideSolid(arena, p) {
  if (!arena?.features?.length) return null;
  for (const f of arena.features) {
    if (f.type !== 'solid') continue;
    if (Math.hypot(f.x - p.x, f.y - p.y, f.z - (p.z ?? 0)) < f.r) return f;
  }
  return null;
}

/**
 * How thoroughly this point is inside the gas: 0 outside, 1 at the core.
 *
 * A gradient rather than a boundary, because a hard edge means a ship sitting
 * exactly on one has its shields flicker on and off every tick — and because
 * the edge of a nebula is the interesting place to be, half-blind and able to
 * get out.
 */
export function cloudAt(arena, p) {
  if (!arena?.features?.length) return 0;
  let worst = 0;
  for (const f of arena.features) {
    if (f.type !== 'cloud') continue;
    const d = Math.hypot(f.x - p.x, f.y - p.y, f.z - (p.z ?? 0));
    if (d >= f.r) continue;
    // Full strength through the inner two thirds, falling to nothing at the
    // skin.
    worst = Math.max(worst, clamp((1 - d / f.r) / 0.34, 0, 1));
  }
  return worst;
}

/**
 * What the gas does to a ship standing in it.
 *
 * One function so the three consumers — accuracy, shields and cloaking —
 * cannot disagree about how deep in it something is.
 */
export function conditionsAt(arena, p) {
  const depth = cloudAt(arena, p);
  if (depth <= 0) return { depth: 0, sensorNoise: 0, shieldSuppression: 0, breaksCloak: false };
  return {
    depth,
    sensorNoise: (arena.sensorNoise ?? 0) * depth,
    shieldSuppression: (arena.shieldSuppression ?? 0) * depth,
    // Half-way in is enough. A cloak is not a dimmer switch.
    breaksCloak: arena.breaksCloak === true && depth > 0.5,
  };
}
