// Walking around inside the ship.
//
// Position, facing, movement and collision, and nothing else. No rendering, no
// DOM, no GL — this file runs in node, which is the point: "you cannot walk
// through a wall" and "every room is reachable from every other" are properties
// you want a test to hold you to, not things you check by wandering around.
//
// The collision is analytic because the rooms are circles and boxes. A capsule
// against a circle is one distance and one clamp; against a box it is two.
// There is no broadphase, no solver, no timestep sensitivity, and nothing to
// tune — which matters more than it sounds, because the alternative on a phone
// at 30 Hz is tunnelling through a bulkhead at a sprint.
//
// The one rule that shapes everything: MOVEMENT IS RESOLVED, NOT REJECTED. A
// walker who stops dead on contact with a wall is unbearable to control on a
// touch screen, where you cannot steer precisely. Sliding along the wall is
// what makes a thumb-stick feel like walking rather than like bumping.

import { ROOMS, findRoom, START_ROOM } from '../world/interiors.data.js';
import { clamp, finite, wrapDegrees } from '../core/num.js';

/** How wide a person is, for collision. Half a metre across the shoulders. */
export const WALKER_RADIUS = 0.26;

/** Metres per second. A brisk walk; a red alert is a jog. */
export const WALK_SPEED = 2.1;
export const RUN_SPEED = 3.6;

/** How close a station has to be before you can operate it. */
export const REACH = 1.25;

/** How close to an exit before you go through it. */
export const EXIT_REACH = 0.9;

const TAU = Math.PI * 2;

/** Shortest signed angle from a to b, in radians. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * Push a point out of a solid circle, if it is inside one.
 *
 * Returns the corrected point. The push is along the line from the circle's
 * centre, which is the shortest way out and the direction that produces a
 * slide rather than a stop when the walker keeps pressing forward.
 */
function pushOutOfCircle(x, z, cx, cz, radius) {
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d >= radius) return [x, z];
  // Dead centre: no direction to push, so pick one rather than divide by zero.
  if (d < 1e-6) return [cx + radius, cz];
  const s = radius / d;
  return [cx + dx * s, cz + dz * s];
}

/**
 * Keep a point inside a room's walls.
 *
 * Exits are holes in the wall, so a walker standing in a doorway is not pushed
 * back in — otherwise you could never leave, and the doorway would read as a
 * decorated section of bulkhead.
 */
export function confine(room, x, z, radius = WALKER_RADIUS) {
  if (!room) return [x, z];

  if (nearAnyExit(room, x, z)) return [x, z];

  if (room.shape.kind === 'ring') {
    const r = Math.hypot(x, z);
    const limit = room.shape.radius - radius;
    if (r > limit) {
      if (r < 1e-6) return [x, z];
      const s = limit / r;
      return [x * s, z * s];
    }
    // An inner rail you cannot cross, when a room has one. The bridge's is 0,
    // because the command well is a step down and not a hole.
    const inner = room.shape.inner ?? 0;
    if (inner > 0 && r < inner + radius) {
      const s = (inner + radius) / Math.max(r, 1e-6);
      return [x * s, z * s];
    }
    return [x, z];
  }

  const hw = room.shape.width / 2 - radius;
  const hd = room.shape.depth / 2 - radius;
  return [clamp(x, -hw, hw), clamp(z, -hd, hd)];
}

/** Is this point in a doorway? Doorways are gaps, not walls. */
export function nearAnyExit(room, x, z) {
  for (const e of room.exits ?? []) {
    const [ex, ez] = e.at;
    // Generous along the door's width and tight across it, so the gap is a
    // gap and not a dent in the wall you can be pushed sideways through.
    if (Math.hypot(x - ex, z - ez) < (e.width ?? 1.2) * 0.55 + WALKER_RADIUS) return true;
  }
  return false;
}

/** Push out of every solid prop in the room, in order. */
export function avoidProps(room, x, z, radius = WALKER_RADIUS) {
  let px = x;
  let pz = z;
  for (const p of room.props ?? []) {
    if (!p.solid || !(p.radius > 0)) continue;
    [px, pz] = pushOutOfCircle(px, pz, p.at[0], p.at[1], p.radius + radius);
  }
  // A console standing on the floor is furniture: you stand at it, not in it.
  // A console set into a WALL is part of that wall, and the bulkhead is what
  // stops you — giving it its own circle carves an unreachable gap behind it
  // and creates a spot where the wall and the console each push you into the
  // other and neither constraint can be satisfied.
  for (const s of room.stations ?? []) {
    if (s.mounted === 'wall') continue;
    [px, pz] = pushOutOfCircle(px, pz, s.at[0], s.at[1], 0.42 + radius);
  }
  return [px, pz];
}

/**
 * Resolve a proposed move against the room.
 *
 * Walls first, then props, then walls again — the second wall pass is not
 * belt-and-braces, it is the case where a prop against the bulkhead pushes you
 * through it. Two passes is enough for the geometry this game has, and a
 * general solver would be a lot of machinery for one console in a corner.
 */
export function resolve(room, x, z, radius = WALKER_RADIUS) {
  let [px, pz] = confine(room, x, z, radius);
  [px, pz] = avoidProps(room, px, pz, radius);
  [px, pz] = confine(room, px, pz, radius);
  return [px, pz];
}

/**
 * Where you are, and which way you are looking.
 *
 * Persisted whole into the save, so every field here has to survive a
 * round-trip through JSON — no class instances, no functions, no undefined.
 */
export class Walker {
  constructor(state = {}) {
    this.roomId = ROOMS[state.roomId] ? state.roomId : START_ROOM;
    // Seated in the chair is a distinct state from standing next to it: it is
    // where the game starts, and "stand up" is what begins a walk.
    this.seated = state.seated !== false;

    // A new commission starts IN the chair, not near it. The default used to be
    // a fixed point a metre behind it, so the game began with the captain
    // standing in the well insisting he was sitting down — and every walk
    // measured a metre short because standing up started from the wrong place.
    const chair = this.seated && this.roomId === 'bridge'
      ? ROOMS.bridge.props.find((p) => p.id === 'chair')
      : null;
    this.x = finite(state.x, chair ? chair.at[0] : 0);
    this.z = finite(state.z, chair ? chair.at[1] : -1.4);
    this.yaw = finite(state.yaw, 0);
    // The station you are close enough to operate, recomputed each step.
    this.atStation = null;
    this.atExit = null;
  }

  get room() { return ROOMS[this.roomId]; }

  /** A unit vector along the way you are facing, in room coordinates. */
  forward() { return [Math.sin(this.yaw), Math.cos(this.yaw)]; }

  /**
   * One step of movement.
   *
   * @param {object} input  {move: [x, z] in [-1,1], turn: radians/sec, run: bool}
   * @param {number} dt     seconds
   */
  step(input = {}, dt = 1 / 30) {
    const room = this.room;
    if (!room) return this;

    const d = clamp(finite(dt, 0), 0, 0.1);
    this.yaw = (this.yaw + finite(input.turn, 0) * d) % TAU;

    if (!this.seated) {
      const mx = clamp(finite(input.move?.[0], 0), -1, 1);
      const mz = clamp(finite(input.move?.[1], 0), -1, 1);
      const mag = Math.hypot(mx, mz);
      if (mag > 1e-4) {
        // Normalise so diagonal is not faster, which is the oldest bug in
        // first-person movement and still the most common.
        const nx = mx / Math.max(1, mag);
        const nz = mz / Math.max(1, mag);
        const speed = (input.run ? RUN_SPEED : WALK_SPEED) * d;
        // The stick is relative to where you are looking, not to the room.
        const c = Math.cos(this.yaw);
        const s = Math.sin(this.yaw);
        const wx = this.x + (nx * c + nz * s) * speed;
        const wz = this.z + (-nx * s + nz * c) * speed;
        [this.x, this.z] = resolve(room, wx, wz);
      }
    }

    this.atStation = this.nearestStation();
    this.atExit = this.nearestExit();
    return this;
  }

  /** The station within reach, if any. Nearest wins. */
  nearestStation() {
    const room = this.room;
    let best = null;
    let bestD = REACH;
    for (const s of room.stations ?? []) {
      // Distance to the SURFACE of the thing, not to its centre. A console is
      // thin and set into a bulkhead, so the two are the same and nothing about
      // the ship changes. A boulder-sized outcrop on a planet is not: collision
      // holds you at its radius plus your own, which for the larger features is
      // further than reach — so the biggest thing on a world was the one thing
      // you could never touch.
      const d = Math.hypot(this.x - s.at[0], this.z - s.at[1]) - (s.radius ?? 0);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  nearestExit() {
    const room = this.room;
    if (!room) return null;
    // A lift is two metres across and its door is the only thing in it. You are
    // always at the door; what you are not always at is a decision about which
    // deck. Requiring the usual reach here meant stepping in from the bridge
    // landed you a hair outside it — a lift you could ride into and not out of.
    if (room.lift) return (room.exits ?? [])[0] ?? null;

    let best = null;
    let bestD = EXIT_REACH;
    for (const e of room.exits ?? []) {
      const d = Math.hypot(this.x - e.at[0], this.z - e.at[1]);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /** Anything worth naming that you are standing at. */
  get looking() { return this.atStation ?? this.atExit ?? null; }

  /**
   * Go through a door into another room.
   *
   * You arrive just inside the far room's matching door, facing into the room —
   * arriving at its origin would drop you on top of whatever is in the middle,
   * which on the bridge is the captain's chair.
   */
  enter(roomId) {
    const next = ROOMS[roomId];
    if (!next) return { ok: false, reason: `There is no ${roomId} aboard.` };

    this.roomId = roomId;
    this.seated = false;
    // What was within reach is not within reach any more — it is on another
    // deck, or on a ship a thousand kilometres up. These are only recomputed
    // when the walker takes a step, so leaving them set meant beaming down to a
    // planet and finding the helm console still under the reticle, labelled and
    // offering to open.
    this.atStation = null;
    this.atExit = null;

    // The door back the way we came, if there is one — that is where we appear.
    const back = (next.exits ?? []).find((e) => e.to === this.previousRoomId);
    const door = back ?? (next.exits ?? [])[0];
    if (door) {
      const [dx, dz] = door.at;
      const inward = Math.hypot(dx, dz) || 1;
      // A metre inside, along the line from the door toward the room's centre.
      this.x = dx - (dx / inward) * 1.0;
      this.z = dz - (dz / inward) * 1.0;
      this.yaw = Math.atan2(-dx, -dz);
    } else {
      this.x = 0;
      this.z = 0;
    }
    [this.x, this.z] = resolve(next, this.x, this.z);
    return { ok: true, room: next };
  }

  /**
   * Go through the door you are standing in.
   *
   * `toId` is optional everywhere except the turbolift, and the turbolift is
   * why this argument exists. A lift has ONE door, and every stop it serves is
   * behind that same door — so "walk through the nearest exit" is not a
   * question the lift can answer. You have to say which deck, which is exactly
   * what the control panel inside it is for.
   *
   * Without this the lift was a room you could enter and not leave: every
   * generated exit sat at the same point, `nearestExit` returned whichever came
   * first, and it was the same one every time.
   */
  useExit(toId = null) {
    const room = this.room;
    if (!this.atExit) return { ok: false, reason: 'There is no door within reach, Captain.' };

    let target = this.atExit;
    if (toId) {
      const named = (room.exits ?? []).find((e) => e.to === toId);
      if (!named) {
        return { ok: false, reason: `This deck has no door to the ${toId}, Captain.` };
      }
      target = named;
    } else if (room.lift) {
      return { ok: false, reason: 'Which deck, Captain?', needsDestination: true };
    }

    this.previousRoomId = this.roomId;
    return this.enter(target.to);
  }

  /** Where this lift can take you. Empty for a room that is not a lift. */
  liftStops() {
    return this.room?.lift ? (this.room.exits ?? []) : [];
  }

  /** Stand up from the chair, or sit back down in it. */
  sit(on = true) {
    if (this.roomId !== 'bridge') {
      return { ok: false, reason: 'The chair is on the bridge, Captain.' };
    }
    if (on) {
      const chair = ROOMS.bridge.props.find((p) => p.id === 'chair');
      this.x = chair.at[0];
      this.z = chair.at[1];
      this.yaw = 0;
      this.seated = true;
      return { ok: true, seated: true };
    }
    this.seated = false;
    // Step clear of the chair rather than standing inside it.
    [this.x, this.z] = resolve(ROOMS.bridge, this.x, this.z - 0.9);
    return { ok: true, seated: false };
  }

  save() {
    return {
      roomId: this.roomId,
      x: this.x, z: this.z, yaw: this.yaw,
      seated: this.seated,
      previousRoomId: this.previousRoomId ?? null,
    };
  }

  static load(data = {}) {
    const w = new Walker(data);
    w.previousRoomId = data.previousRoomId ?? null;
    // Positions in the save could be anything — a corrupted record, a room
    // whose geometry changed between versions. Resolve on load so a walker
    // never wakes up inside a bulkhead with no way out.
    [w.x, w.z] = resolve(w.room, w.x, w.z);
    return w;
  }
}

/**
 * Walk one step toward another room, on your own.
 *
 * This is the autopilot behind "go to sickbay", and it is deliberately a PLAYER
 * rather than a pathfinder: it aims at the next door and presses forward with
 * no idea what is between it and the doorway, and when it stops making progress
 * it sidesteps — which is what a thumb on a stick does. Anything cleverer would
 * navigate around the captain's chair so smoothly that nobody would ever notice
 * if the chair stopped being solid.
 *
 * `memory` is caller-owned scratch, so the caller decides when a walk restarts.
 *
 * @returns {{arrived: boolean, blocked: boolean, room: string}}
 */
export function stepToward(walker, toId, dt = 1 / 30, memory = {}) {
  if (walker.roomId === toId) return { arrived: true, blocked: false, room: walker.roomId };
  if (walker.seated) walker.sit(false);

  const path = route(walker.roomId, toId);
  if (!path || path.length < 2) return { arrived: false, blocked: true, room: walker.roomId };

  const door = (walker.room.exits ?? []).find((e) => e.to === path[1]);
  if (!door) return { arrived: false, blocked: true, room: walker.roomId };

  const dx = door.at[0] - walker.x;
  const dz = door.at[1] - walker.z;
  const d = Math.hypot(dx, dz);

  if (d > (memory.lastDistance ?? Infinity) - 0.005) memory.stuck = (memory.stuck ?? 0) + 1;
  else memory.stuck = 0;
  memory.lastDistance = d;
  if (memory.stuck > 12 && !(memory.sidestep > 0)) {
    memory.sidestep = 22;
    memory.side = -(memory.side ?? 1);
    memory.stuck = 0;
  }

  walker.yaw = Math.atan2(dx, dz);
  if (memory.sidestep > 0) {
    memory.sidestep--;
    walker.step({ move: [memory.side ?? 1, 0.35] }, dt);
  } else {
    walker.step({ move: [0, 1] }, dt);
  }

  if (walker.atExit) {
    const r = walker.useExit(path[1]);
    if (r.ok) {
      memory.lastDistance = Infinity;
      memory.stuck = 0;
      memory.sidestep = 0;
    }
  }

  return { arrived: walker.roomId === toId, blocked: false, room: walker.roomId };
}

/**
 * The shortest route between two rooms, as a list of room ids.
 *
 * Breadth-first over the exit graph. Used by "go to sickbay", which walks you
 * there rather than teleporting — the single most valuable check in this whole
 * subsystem is that typing that and running the simulation actually arrives,
 * because it proves the geometry, the graph, the collision and the parser all
 * agree at once.
 */
export function route(fromId, toId) {
  if (!ROOMS[fromId] || !ROOMS[toId]) return null;
  if (fromId === toId) return [fromId];

  const seen = new Set([fromId]);
  const queue = [[fromId]];
  while (queue.length) {
    const path = queue.shift();
    const here = ROOMS[path[path.length - 1]];
    for (const e of here.exits ?? []) {
      if (seen.has(e.to)) continue;
      const next = [...path, e.to];
      if (e.to === toId) return next;
      seen.add(e.to);
      queue.push(next);
    }
  }
  return null;
}

/** Is every room reachable from every other? A ship must be connected. */
export function connectivity() {
  const ids = Object.keys(ROOMS);
  const broken = [];
  for (const a of ids) {
    for (const b of ids) {
      if (a !== b && !route(a, b)) broken.push(`${a} -> ${b}`);
    }
  }
  return broken;
}

export { findRoom, ROOMS, wrapDegrees };
