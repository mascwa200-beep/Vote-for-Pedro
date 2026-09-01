// The sector map: real coordinates, real lanes, real distances — and a third
// axis you can tilt into.
//
// The chart was drawn flat, and flat is the wrong shape for a sector. Inside
// twenty light years the galactic disc is a thousand light years thick, so the
// nearest stars sit above and below Sol as readily as beside it: Alpha Centauri
// is sixty-one degrees below the celestial equator and 61 Cygni is thirty-nine
// above it. See docs/RESEARCH.md §12.
//
// The projection is axonometric rather than perspective. That is not a
// shortcut: a star chart is a chart, and parallel projection is what makes
// distances on it comparable by eye. It also keeps `1 / scale` an honest pixel,
// so line widths and label sizes go on working exactly as they did.
//
// At zero tilt the mapping is the identity and this draws precisely the map it
// always drew. The third axis costs nothing until you ask for it.

import { fitCanvas, attachPanZoom } from './touch.js';
import { SECTORS, systemDepth } from '../world/systems.data.js';
import { EPISODES_BY_SYSTEM } from '../missions/episodes/index.js';

const TYPE_STYLE = {
  core: { r: 9, color: '#9cf', ring: true },
  homeworld: { r: 8, color: '#9cf', ring: true },
  starbase: { r: 8, color: '#ffcc66', ring: true },
  station: { r: 7, color: '#ffcc66' },
  colony: { r: 6, color: '#99ffcc' },
  outpost: { r: 5, color: '#cc99cc' },
  anomaly: { r: 6, color: '#ff9cf0' },
  deadspace: { r: 5, color: '#888899' },
};

/** How far the chart can be laid over. Past this it is an edge-on line. */
export const MAX_TILT = 1.15;

/**
 * How much the third axis is exaggerated on the chart.
 *
 * The systems span some eighty light years across and about twelve top to
 * bottom, which is the right proportion and the wrong drawing: laid over, a
 * depth of two light years moves a star by less than the radius of its own dot
 * and the tilt shows nothing. Every three-dimensional star chart ever drawn
 * exaggerates the short axis for the same reason, and this one says so out
 * loud rather than pretending the galaxy is taller than it is.
 */
export const DEPTH_EXAGGERATION = 3.2;

export class GalaxyMap {
  constructor(canvas) {
    this.canvas = canvas;
    // Opens wide enough to see the Federation core and both borders at once.
    this.view = { x: -10, y: -6, scale: 3.6 };
    // Tilt and spin of the chart itself, in radians. Zero is the plan view the
    // map has always opened on.
    this.tilt = 0;
    this.spin = 0;
    this.onSelect = null;
    this.selectedId = null;
    this.game = null;
    // Until the player drives the chart themselves, it frames itself on what
    // is actually in it. The fixed opening view was chosen against one canvas
    // and wasted more than half of a tall phone's: the stars sat in a band
    // across the middle with black above and below.
    this.userView = false;
    this.fitKey = '';
    attachPanZoom(canvas, this.view, {
      minScale: 1.6, maxScale: 26,
      onTap: (px, py) => this.handleTap(px, py),
      onUserView: () => { this.userView = true; },
    });
  }

  /**
   * Frame the whole chart in the canvas it has.
   *
   * Laying the chart over or spinning it changes the extent of what is drawn,
   * so this reruns when the projection or the canvas does. `fitKey` is what
   * says whether anything moved, because refitting on every frame would fight
   * the pan handler for control of the view.
   */
  fitChart(width, height) {
    const systems = this.game?.galaxy?.systems;
    if (!systems?.length || !width || !height) return;

    const key = `${width}x${height}:${this.tilt.toFixed(3)}:${this.spin.toFixed(3)}:${systems.length}`;
    if (key === this.fitKey) return;
    this.fitKey = key;

    let lo = { u: Infinity, v: Infinity };
    let hi = { u: -Infinity, v: -Infinity };
    const p = { u: 0, v: 0, depth: 0 };
    for (const s of systems) {
      this.at(s, p);
      lo = { u: Math.min(lo.u, p.u), v: Math.min(lo.v, p.v) };
      hi = { u: Math.max(hi.u, p.u), v: Math.max(hi.v, p.v) };
    }
    const spanU = Math.max(1e-3, hi.u - lo.u);
    const spanV = Math.max(1e-3, hi.v - lo.v);

    // Margin for the things that hang off a system: the territory bubbles are
    // wider than the stars in them, and a name is drawn under its dot.
    const MARGIN = 1.3;
    const scale = Math.min(width / (spanU * MARGIN), height / (spanV * MARGIN));
    this.view.scale = Math.max(1.6, Math.min(26, scale));
    this.view.x = -(lo.u + hi.u) / 2;
    this.view.y = -(lo.v + hi.v) / 2;
  }

  /**
   * World (x, y, depth) to chart (u, v), plus how far away it is.
   *
   * Spin turns the chart about the vertical; tilt lays it over toward the
   * viewer. `depth` is the distance along the view direction and exists so the
   * far side of the galaxy can be drawn before the near side — without that,
   * tilting the chart draws the Klingon border on top of Sol.
   *
   * Writes into `out` so the render loop allocates nothing per system.
   */
  project(x, y, z, out = { u: 0, v: 0, depth: 0 }) {
    const cs = Math.cos(this.spin);
    const sn = Math.sin(this.spin);
    const rx = x * cs - y * sn;
    const ry = x * sn + y * cs;
    const ct = Math.cos(this.tilt);
    const st = Math.sin(this.tilt);
    const zz = z * DEPTH_EXAGGERATION;
    out.u = rx;
    out.v = ry * ct - zz * st;
    out.depth = ry * st + zz * ct;
    return out;
  }

  /** Where a system lands on the chart. */
  at(system, out) {
    return this.project(system.x, system.y, systemDepth(system), out);
  }

  /**
   * Tilt the chart, in radians. Clamped, because past about sixty-five degrees
   * it is a line with stars on it and nothing can be picked out of it.
   */
  setTilt(radians) {
    const v = Number(radians);
    if (!Number.isFinite(v)) return this.tilt;
    // Whatever was in the middle of the screen stays there. Laying the chart
    // over moves every star, so without this the map slid out from under the
    // reader every time it was tilted.
    const held = this.centred();
    this.tilt = Math.max(0, Math.min(MAX_TILT, v));
    this.recentre(held);
    return this.tilt;
  }

  /** The system nearest the middle of the screen right now. */
  centred() {
    if (!this.game) return null;
    let best = null;
    let bestD = Infinity;
    const p = { u: 0, v: 0, depth: 0 };
    for (const s of this.game.galaxy.systems) {
      this.at(s, p);
      const d = Math.hypot(p.u + this.view.x, p.v + this.view.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /** Put a system back in the middle after the projection has changed. */
  recentre(system) {
    if (!system) return;
    const p = this.at(system);
    this.view.x = -p.u;
    this.view.y = -p.v;
  }

  /** Spin the chart about the vertical. Wraps; there is no wrong way round. */
  setSpin(radians) {
    const v = Number(radians);
    if (!Number.isFinite(v)) return this.spin;
    const held = this.centred();
    this.spin = ((v % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    this.recentre(held);
    return this.spin;
  }

  handleTap(px, py) {
    if (!this.game) return;
    const rect = this.canvas.getBoundingClientRect();
    const wx = (px - rect.width / 2) / this.view.scale - this.view.x;
    const wy = (py - rect.height / 2) / this.view.scale - this.view.y;
    let best = null;
    let bestD = 26 / this.view.scale;
    // Picked in CHART space, not world space. With the chart laid over, a
    // system's world x/y is not where the finger is: it is somewhere above or
    // below it by however far off the plane the system sits.
    const p = { u: 0, v: 0, depth: 0 };
    for (const s of this.game.galaxy.systems) {
      this.at(s, p);
      const d = Math.hypot(p.u - wx, p.v - wy);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) {
      this.selectedId = best.id;
      this.onSelect?.(best);
    }
  }

  /** Centre on a system without changing zoom. */
  focus(systemId) {
    const s = this.game?.galaxy.get(systemId);
    if (!s) return;
    const p = this.at(s);
    this.view.x = -p.u;
    this.view.y = -p.v;
  }

  render(game) {
    this.game = game;
    const { ctx, width, height } = fitCanvas(this.canvas);
    ctx.clearRect(0, 0, width, height);
    if (!this.userView) this.fitChart(width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(this.view.scale, this.view.scale);
    ctx.translate(this.view.x, this.view.y);

    const g = game.galaxy;
    const px = 1 / this.view.scale;
    const tilted = this.tilt > 0.02;

    // Every system's place on the chart, once. The render below reads this
    // rather than projecting the same star five times.
    const chart = new Map();
    for (const s of g.systems) chart.set(s.id, this.at(s));
    const P = (id) => chart.get(id);

    // Boxes of names already on the chart, so the next one can stand aside.
    const labelled = [];

    // Charted lanes.
    ctx.strokeStyle = 'rgba(110,130,190,0.28)';
    ctx.lineWidth = px;
    ctx.beginPath();
    for (const s of g.systems) {
      const a = P(s.id);
      for (const nb of g.adjacency[s.id] ?? []) {
        if (nb < s.id) continue; // draw each edge once
        const b = P(nb);
        if (!b) continue;
        ctx.moveTo(a.u, a.v); ctx.lineTo(b.u, b.v);
      }
    }
    ctx.stroke();

    // Drop lines to the plane.
    //
    // The one thing that makes a tilted star chart readable. Without them a
    // star above the plane and a nearer star on it are the same dot in the same
    // place, and the depth the tilt exists to show is invisible.
    if (tilted) {
      ctx.strokeStyle = 'rgba(150,190,255,0.45)';
      ctx.lineWidth = px * 1.2;
      ctx.beginPath();
      const foot = { u: 0, v: 0, depth: 0 };
      for (const s of g.systems) {
        const a = P(s.id);
        this.project(s.x, s.y, 0, foot);
        ctx.moveTo(a.u, a.v); ctx.lineTo(foot.u, foot.v);
      }
      ctx.stroke();

      // And the plane itself, as a horizon line through the origin, so there
      // is something for the drop lines to land on.
      const o = this.project(0, 0, 0);
      ctx.strokeStyle = 'rgba(120,150,210,0.16)';
      ctx.beginPath();
      ctx.moveTo(o.u - 60, o.v); ctx.lineTo(o.u + 60, o.v);
      ctx.stroke();
    }

    // Plotted course, if we are under way.
    if (game.transit) {
      const path = game.transit.route.path;
      ctx.strokeStyle = 'rgba(255,156,0,0.85)';
      ctx.lineWidth = 2.5 * px;
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.beginPath();
      path.forEach((id, i) => {
        const p = P(id);
        if (!p) return;
        if (i === 0) ctx.moveTo(p.u, p.v); else ctx.lineTo(p.u, p.v);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // The ship itself, somewhere along the line. Its interpolated position
      // is in world coordinates and has to go through the same projection, or
      // it flies off the lane the moment the chart is laid over.
      const pos = game.transit.positionIn(g);
      const at = this.project(pos.x, pos.y, pos.z ?? 0);
      ctx.fillStyle = '#ffcc66';
      ctx.beginPath();
      ctx.arc(at.u, at.v, 3.2 * px * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,204,102,0.5)';
      ctx.lineWidth = px;
      ctx.beginPath();
      ctx.arc(at.u, at.v, 7 * px * 1.4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Systems, far side first. A painter's sort is the whole depth buffer a 2D
    // chart gets, and without it the near stars are drawn under the far ones.
    const order = g.systems.slice().sort((a, b) => P(b.id).depth - P(a.id).depth);

    // Aerial perspective, which is the oldest depth cue there is: the far side
    // of the chart is dimmer and slightly smaller than the near side. Sorting
    // alone puts the stars in the right order and still leaves every one of
    // them the same weight, so the eye has nothing to read distance from.
    let near = 0;
    let far = 0;
    if (tilted) {
      const ds = order.map((x) => P(x.id).depth);
      near = Math.min(...ds);
      far = Math.max(...ds);
    }
    const span = Math.max(1e-6, far - near);

    for (const s of order) {
      const { u, v, depth } = P(s.id);
      // 1 at the near edge, 0 at the far one.
      const nearness = tilted ? 1 - (depth - near) / span : 1;
      const dim = tilted ? 0.45 + 0.55 * nearness : 1;
      const grow = tilted ? 0.82 + 0.28 * nearness : 1;
      const style = TYPE_STYLE[s.type] ?? { r: 5, color: '#aaa' };
      const visited = g.visited.has(s.id);
      const here = s.id === game.locationId;
      const r = style.r * px * 1.5 * grow;

      // Sector tint behind border and contested systems.
      if (s.contested || s.border) {
        ctx.fillStyle = 'rgba(204,68,68,0.1)';
        ctx.beginPath();
        ctx.arc(u, v, r * 3.4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = (visited ? 1 : 0.5) * dim;
      ctx.fillStyle = style.color;
      ctx.beginPath();
      ctx.arc(u, v, r, 0, Math.PI * 2);
      ctx.fill();

      if (style.ring) {
        ctx.strokeStyle = style.color;
        ctx.lineWidth = px;
        ctx.beginPath();
        ctx.arc(u, v, r * 1.9, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Mission marker.
      const hasMission = (EPISODES_BY_SYSTEM[s.id] ?? [])
        .some((e) => !game.missions.completed.has(e.id));
      if (hasMission) {
        ctx.fillStyle = '#ff9c00';
        ctx.beginPath();
        const my = v - r * 3;
        ctx.moveTo(u, my - 3.4 * px * 1.5);
        ctx.lineTo(u + 3 * px * 1.5, my + 2.4 * px * 1.5);
        ctx.lineTo(u - 3 * px * 1.5, my + 2.4 * px * 1.5);
        ctx.closePath();
        ctx.fill();
      }

      // Current position marker.
      if (here) {
        ctx.strokeStyle = '#ffcc66';
        ctx.lineWidth = 2 * px;
        for (let i = 0; i < 4; i++) {
          const a = (i * 90 + 45) * Math.PI / 180;
          ctx.beginPath();
          ctx.arc(u, v, r * 3, a - 0.3, a + 0.3);
          ctx.stroke();
        }
      }

      // Selection.
      if (s.id === this.selectedId) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.arc(u, v, r * 2.4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Labels appear once you are zoomed in enough to read them.
      // Font size is expressed in world units so that, once the canvas
      // transform is applied, it lands at a fixed size on screen.
      // Labels appear once you are zoomed in enough to read them.
      //
      // A laid-over chart has less vertical room and the same number of names
      // in it, so tilting turned the map into a wall of overlapping text. When
      // it is tilted only the names that are load-bearing are drawn — where you
      // are, what you have selected, and anywhere with something to do — and
      // the rest of the chart is read by its shape, which is the thing the tilt
      // was for.
      const worthLabelling = !tilted || here || s.id === this.selectedId || hasMission;
      if (this.view.scale > 2.4 && worthLabelling) {
        const fs = 11 / this.view.scale;
        ctx.font = `${fs}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        const text = visited || s.type !== 'anomaly' ? s.name : 'Unsurveyed';
        const ly = v + r * 2 + fs;
        // A name that would land on one already drawn is not drawn. Twenty
        // systems in the Federation core all wanted the same forty pixels, and
        // the result was "Vega Colony" written through "Starbase 11" written
        // through "Rigel" — three names, none of them readable. The ones that
        // matter are claimed first, below.
        const half = ctx.measureText(text).width / 2;
        // Padded, because two names that merely touch are as unreadable as
        // two that overlap.
        const pad = fs * 0.25;
        const boxed = {
          x0: u - half - pad, x1: u + half + pad,
          y0: ly - fs - pad, y1: ly + fs * 0.3 + pad,
        };
        // Where you are, what you have selected and anywhere with something to
        // do are drawn whatever else is there — those three are the reason a
        // captain opened the chart.
        const mustShow = here || s.id === this.selectedId || hasMission;
        const clash = !mustShow && labelled.some((b) =>
          boxed.x0 < b.x1 && boxed.x1 > b.x0 && boxed.y0 < b.y1 && boxed.y1 > b.y0);
        if (!clash) {
          labelled.push(boxed);
          ctx.fillStyle = visited ? 'rgba(255,220,180,0.9)' : 'rgba(180,180,200,0.55)';
          ctx.fillText(text, u, ly);
        }
      }
    }

    // Sector names are a zoomed-out overview only; at close range they would
    // sit on top of the system labels that matter.
    if (this.view.scale < 2.4 && !tilted) {
      const seen = new Set();
      ctx.font = `${13 / this.view.scale}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      for (const s of g.systems) {
        if (seen.has(s.sector)) continue;
        seen.add(s.sector);
        const sector = SECTORS[s.sector];
        if (!sector) continue;
        const members = g.systems.filter((o) => o.sector === s.sector);
        // The centre of the sector on the CHART, so the name follows the
        // systems it belongs to when the chart is laid over.
        let cu = 0;
        let cv = 0;
        for (const o of members) { const p = P(o.id); cu += p.u; cv += p.v; }
        cu /= members.length;
        cv /= members.length;
        ctx.fillStyle = `${sector.color}55`;
        ctx.fillText(sector.name.toUpperCase(), cu, cv - 8 / this.view.scale);
      }
    }

    ctx.restore();
  }
}
