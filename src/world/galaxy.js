// The galaxy: routing, warp transit, and what is waiting when you arrive.
//
// Travel is not a menu jump. A course is plotted through charted lanes, it
// takes stardate time and antimatter, and it can be interrupted en route.

import { SYSTEMS, SYSTEM_BY_ID, distanceLy, systemDepth } from './systems.data.js';
import { emit } from '../core/events.js';
import { clamp } from '../core/num.js';

// These three feed the stardate and the antimatter reserve, which are both
// saved. A NaN in either is the same unrecoverable class as a NaN position: it
// is written to disk, and every later arithmetic on it stays NaN.
//
// Nothing in normal play reaches the guards below — plotTransit derives its
// distance from system coordinates and the parser clamps warp factors to
// 1..9.9, and 4,680 plotted routes across all forty systems produced no bad
// value. They are here for the same reason the helm orders have them: a
// distance is never negative, a duration is never negative, and neither is
// ever NaN, whatever a caller hands in.

/** The slowest a warp factor can be treated as, so nothing divides by zero. */
const MIN_WARP = 1;

/**
 * A ceiling on distance, well past the far side of the charted galaxy.
 *
 * A floor alone is not enough: 1e308 light years is finite, and multiplying it
 * by the 8766 hours in a light-year-at-c overflows to Infinity before any
 * division can bring it back.
 */
const MAX_DISTANCE_LY = 1e6;

/** Warp factor -> multiples of c (the TOS cube law). */
export function warpSpeed(factor) {
  return Math.pow(clamp(factor, MIN_WARP, 10), 3);
}

/** Hours of travel for a distance at a warp factor. */
export function travelHours(lightYears, factor, efficiency = 1) {
  const c = warpSpeed(factor);
  // A ship cannot travel a negative distance, and a broken efficiency figure
  // must not make the voyage free or endless.
  const ly = clamp(lightYears, 0, MAX_DISTANCE_LY);
  const eff = clamp(efficiency, 0.05, 20);
  return (ly * 8766) / (c * eff); // 8766 hours in a light-year-at-c
}

/** Antimatter burned. Higher warp is superlinearly expensive. */
export function fuelCost(lightYears, factor, efficiency = 1) {
  const ly = clamp(lightYears, 0, MAX_DISTANCE_LY);
  const f = clamp(factor, MIN_WARP, 10);
  const eff = clamp(efficiency, 0.05, 20);
  return (ly * Math.pow(f / 6, 2.4) * 0.55) / eff;
}

export class Galaxy {
  constructor(rng) {
    this.rng = rng;
    this.systems = SYSTEMS.map((s) => ({ ...s }));
    this.byId = Object.fromEntries(this.systems.map((s) => [s.id, s]));
    this.adjacency = this.buildAdjacency();
    this.visited = new Set();
    // How many times the ship has arrived at each system.
    //
    // `visited` is a Set and answers "has she ever been there". What is
    // waiting when she arrives is now a function of the system and the number
    // of the visit, so that it can be KNOWN before arriving — see
    // Game.encounterStream. A boolean cannot say which visit this is.
    this.visits = new Map();
    this.surveyed = new Set();
    this.notes = {};       // systemId -> discovered facts
  }

  /** How many times the ship has arrived here. */
  visitCount(id) { return this.visits.get(id) ?? 0; }

  /** Undirected lane graph — `links` in the data are declared one way. */
  buildAdjacency() {
    const adj = Object.fromEntries(this.systems.map((s) => [s.id, new Set()]));
    for (const s of this.systems) {
      for (const other of s.links ?? []) {
        if (!adj[other]) continue;
        adj[s.id].add(other);
        adj[other].add(s.id);
      }
    }
    return Object.fromEntries(Object.entries(adj).map(([k, v]) => [k, [...v]]));
  }

  get(id) { return this.byId[id]; }

  neighbors(id) { return (this.adjacency[id] ?? []).map((n) => this.byId[n]); }

  /**
   * Dijkstra over charted lanes, weighted by distance.
   * Returns null when there is no charted route — you can still go direct,
   * at a navigational penalty, via `directRoute`.
   */
  route(fromId, toId) {
    if (fromId === toId) return { path: [fromId], lightYears: 0, charted: true };
    const dist = { [fromId]: 0 };
    const prev = {};
    const unvisited = new Set(this.systems.map((s) => s.id));

    while (unvisited.size) {
      let current = null;
      let best = Infinity;
      for (const id of unvisited) {
        const d = dist[id] ?? Infinity;
        if (d < best) { best = d; current = id; }
      }
      if (current === null || best === Infinity) break;
      if (current === toId) break;
      unvisited.delete(current);

      for (const nb of this.adjacency[current] ?? []) {
        if (!unvisited.has(nb)) continue;
        const alt = best + distanceLy(current, nb);
        if (alt < (dist[nb] ?? Infinity)) { dist[nb] = alt; prev[nb] = current; }
      }
    }

    if (dist[toId] === undefined) return null;
    const path = [toId];
    let cur = toId;
    while (prev[cur]) { cur = prev[cur]; path.unshift(cur); }
    return { path, lightYears: dist[toId], charted: true };
  }

  /** Straight-line course off the lanes. Slower per light-year, and riskier. */
  directRoute(fromId, toId) {
    return {
      path: [fromId, toId],
      lightYears: distanceLy(fromId, toId) * 1.15,
      charted: false,
    };
  }

  /** Best available course, charted if one exists. */
  plotCourse(fromId, toId) {
    return this.route(fromId, toId) ?? this.directRoute(fromId, toId);
  }

  markVisited(id) {
    const isNew = !this.visited.has(id);
    this.visited.add(id);
    this.visits.set(id, this.visitCount(id) + 1);
    if (isNew) emit('galaxy:first-visit', this.byId[id]);
    return isNew;
  }

  markSurveyed(id, note) {
    this.surveyed.add(id);
    if (note) this.notes[id] = note;
  }

  /** Systems reachable at all — everything, but sorted by distance from here. */
  destinationsFrom(id) {
    return this.systems
      .filter((s) => s.id !== id)
      .map((s) => ({ system: s, lightYears: distanceLy(id, s.id) }))
      .sort((a, b) => a.lightYears - b.lightYears);
  }

  save() {
    return {
      visited: [...this.visited],
      visits: [...this.visits],
      surveyed: [...this.surveyed],
      notes: this.notes,
    };
  }

  load(data) {
    if (!data) return;
    this.visited = new Set(data.visited ?? []);
    // A save from before the counter existed knows only that a system was
    // visited. One visit is the honest reading of that, and it keeps the
    // encounter stream stable across the upgrade for everywhere she has been.
    this.visits = new Map(data.visits ?? [...this.visited].map((id) => [id, 1]));
    this.surveyed = new Set(data.surveyed ?? []);
    this.notes = data.notes ?? {};
  }
}

/**
 * An in-progress warp transit. Ticks down in real time; can be interrupted.
 */
export class Transit {
  constructor({ route, warpFactor, hours, fuel, from, to }) {
    this.route = route;
    this.warpFactor = warpFactor;
    this.totalHours = hours;
    this.remainingHours = hours;
    this.fuel = fuel;
    this.from = from;
    this.to = to;
    this.interrupted = false;
    this.legIndex = 0;
    // Real seconds the transit takes to play out. Long hauls compress, but
    // never to zero — distance has to be felt.
    this.realSeconds = Math.max(4, Math.min(26, Math.log10(hours + 10) * 9));
    this.elapsedReal = 0;
  }

  get progress() {
    return Math.max(0, Math.min(1, this.elapsedReal / this.realSeconds));
  }

  /**
   * A voyage, written down.
   *
   * The whole transit was missing from the save. Close the app twenty-three per
   * cent of the way to Vulcan and you woke at Sol with the antimatter for the
   * trip already spent, no days elapsed, and no course — the fuel was charged
   * and the journey was not. Escapes made it worse, because those transits are
   * not chosen.
   *
   * The route is stored as its system ids and rebuilt on load, so a save is not
   * a snapshot of the galaxy's objects.
   */
  save() {
    return {
      path: this.route?.path ?? [],
      lightYears: this.route?.lightYears ?? 0,
      charted: this.route?.charted ?? true,
      warpFactor: this.warpFactor,
      hours: this.totalHours,
      fuel: this.fuel,
      fromId: this.from?.id ?? null,
      toId: this.to?.id ?? null,
      elapsedReal: this.elapsedReal,
      interrupted: this.interrupted,
    };
  }

  /** @returns {Transit|null} — null for anything that is not a saved voyage. */
  static load(data, galaxy) {
    if (!data?.toId || !galaxy) return null;
    const to = galaxy.get(data.toId);
    const from = galaxy.get(data.fromId);
    if (!to) return null;
    const t = new Transit({
      route: {
        path: Array.isArray(data.path) && data.path.length ? data.path : [data.fromId, data.toId],
        lightYears: Number(data.lightYears) || 0,
        charted: data.charted !== false,
      },
      warpFactor: Number(data.warpFactor) || 1,
      hours: Number(data.hours) || 0,
      fuel: Number(data.fuel) || 0,
      from: from ?? to,
      to,
    });
    // How far along it was. Clamped, because a hand-edited save should drop the
    // ship out at the far end rather than into a transit that never completes.
    t.elapsedReal = Math.max(0, Math.min(t.realSeconds, Number(data.elapsedReal) || 0));
    t.remainingHours = t.totalHours * (1 - t.progress);
    t.interrupted = data.interrupted === true;
    return t;
  }

  /**
   * Current position along the route, for the map.
   *
   * The third axis is interpolated with the other two. It has to be: the chart
   * lifts every star off the plane by `systemDepth`, and this returned only x
   * and y — so the map, which projects `pos.z ?? 0`, drew the ship travelling
   * along the flat while the two stars it was travelling between sat above and
   * below it. Lay the chart over and the marker leaves its own lane.
   *
   * This is presentation only. `distanceLy` stays planar on purpose — folding
   * depth into it would change every lane length, every transit time and the
   * balance of the whole campaign to buy an accuracy nobody can see. There is a
   * test that guards exactly that.
   */
  positionIn(galaxy) {
    const path = this.route.path;
    const t = this.progress * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(t));
    const frac = t - i;
    const a = galaxy.get(path[i]);
    const b = galaxy.get(path[i + 1]) ?? a;
    const az = systemDepth(a);
    const bz = systemDepth(b);
    return {
      x: a.x + (b.x - a.x) * frac,
      y: a.y + (b.y - a.y) * frac,
      z: az + (bz - az) * frac,
    };
  }

  /** @returns {'travelling'|'arrived'} */
  update(dt) {
    if (this.interrupted) return 'travelling';
    this.elapsedReal += dt;
    this.remainingHours = this.totalHours * (1 - this.progress);
    return this.progress >= 1 ? 'arrived' : 'travelling';
  }

  interrupt(reason) {
    this.interrupted = true;
    this.interruptReason = reason;
    emit('transit:interrupt', { transit: this, reason });
  }

  resume() {
    this.interrupted = false;
  }

  /** Where the ship drops out if interrupted mid-leg. */
  nearestSystem(galaxy) {
    const pos = this.positionIn(galaxy);
    let best = null; let bestD = Infinity;
    for (const id of this.route.path) {
      const s = galaxy.get(id);
      const d = Math.hypot(s.x - pos.x, s.y - pos.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }
}

/** Build a Transit from an order, or an explanation of why it cannot be flown. */
export function plotTransit(galaxy, fromId, toId, warpFactor, ship, efficiency = 1) {
  const from = galaxy.get(fromId);
  const to = galaxy.get(toId);
  if (!to) return { error: 'No such system in the charts.' };
  if (fromId === toId) return { error: 'We are already there, Captain.' };

  const maxWarp = ship.cls.maxWarp * (ship.coreEjected ? 0 : 1)
    * (ship.subsystems.warpcore > 0.5 ? 1 : 0.6);
  if (maxWarp < 1) return { error: 'Warp drive is offline. We are on impulse only.' };

  const factor = Math.max(1, Math.min(warpFactor, maxWarp));
  const route = galaxy.plotCourse(fromId, toId);
  const eff = (ship.cls.warpEfficiency ?? 1) * efficiency;
  const hours = travelHours(route.lightYears, factor, eff);
  const fuel = fuelCost(route.lightYears, factor, eff);

  if (fuel > ship.antimatter) {
    return {
      error: `Insufficient antimatter. That course needs ${fuel.toFixed(1)}% and we have ${ship.antimatter.toFixed(1)}%.`,
      fuel, hours, route,
    };
  }

  return { transit: new Transit({ route, warpFactor: factor, hours, fuel, from, to }), fuel, hours, route, factor };
}
