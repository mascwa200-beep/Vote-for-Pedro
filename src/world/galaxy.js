// The galaxy: routing, warp transit, and what is waiting when you arrive.
//
// Travel is not a menu jump. A course is plotted through charted lanes, it
// takes stardate time and antimatter, and it can be interrupted en route.

import { SYSTEMS, SYSTEM_BY_ID, distanceLy } from './systems.data.js';
import { emit } from '../core/events.js';

/** Warp factor -> multiples of c (the TOS cube law). */
export function warpSpeed(factor) {
  return Math.pow(Math.max(1, factor), 3);
}

/** Hours of travel for a distance at a warp factor. */
export function travelHours(lightYears, factor, efficiency = 1) {
  const c = warpSpeed(factor);
  return (lightYears * 8766) / (c * efficiency); // 8766 hours in a light-year-at-c
}

/** Antimatter burned. Higher warp is superlinearly expensive. */
export function fuelCost(lightYears, factor, efficiency = 1) {
  return (lightYears * Math.pow(factor / 6, 2.4) * 0.55) / efficiency;
}

export class Galaxy {
  constructor(rng) {
    this.rng = rng;
    this.systems = SYSTEMS.map((s) => ({ ...s }));
    this.byId = Object.fromEntries(this.systems.map((s) => [s.id, s]));
    this.adjacency = this.buildAdjacency();
    this.visited = new Set();
    this.surveyed = new Set();
    this.notes = {};       // systemId -> discovered facts
  }

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
    return { visited: [...this.visited], surveyed: [...this.surveyed], notes: this.notes };
  }

  load(data) {
    if (!data) return;
    this.visited = new Set(data.visited ?? []);
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

  /** Current position along the route, for the map. */
  positionIn(galaxy) {
    const path = this.route.path;
    const t = this.progress * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(t));
    const frac = t - i;
    const a = galaxy.get(path[i]);
    const b = galaxy.get(path[i + 1]) ?? a;
    return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
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
