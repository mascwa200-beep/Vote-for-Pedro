// The sector map: real coordinates, real lanes, real distances.

import { fitCanvas, attachPanZoom } from './touch.js';
import { SECTORS } from '../world/systems.data.js';
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

export class GalaxyMap {
  constructor(canvas) {
    this.canvas = canvas;
    // Opens wide enough to see the Federation core and both borders at once.
    this.view = { x: -10, y: -6, scale: 3.6 };
    this.onSelect = null;
    this.selectedId = null;
    this.game = null;
    attachPanZoom(canvas, this.view, {
      minScale: 1.6, maxScale: 26,
      onTap: (px, py) => this.handleTap(px, py),
    });
  }

  handleTap(px, py) {
    if (!this.game) return;
    const rect = this.canvas.getBoundingClientRect();
    const wx = (px - rect.width / 2) / this.view.scale - this.view.x;
    const wy = (py - rect.height / 2) / this.view.scale - this.view.y;
    let best = null;
    let bestD = 26 / this.view.scale;
    for (const s of this.game.galaxy.systems) {
      const d = Math.hypot(s.x - wx, s.y - wy);
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
    this.view.x = -s.x;
    this.view.y = -s.y;
  }

  render(game) {
    this.game = game;
    const { ctx, width, height } = fitCanvas(this.canvas);
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(this.view.scale, this.view.scale);
    ctx.translate(this.view.x, this.view.y);

    const g = game.galaxy;
    const px = 1 / this.view.scale;

    // Charted lanes.
    ctx.strokeStyle = 'rgba(110,130,190,0.28)';
    ctx.lineWidth = px;
    ctx.beginPath();
    for (const s of g.systems) {
      for (const nb of g.adjacency[s.id] ?? []) {
        if (nb < s.id) continue; // draw each edge once
        const o = g.get(nb);
        ctx.moveTo(s.x, s.y); ctx.lineTo(o.x, o.y);
      }
    }
    ctx.stroke();

    // Plotted course, if we are under way.
    if (game.transit) {
      const path = game.transit.route.path;
      ctx.strokeStyle = 'rgba(255,156,0,0.85)';
      ctx.lineWidth = 2.5 * px;
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.beginPath();
      path.forEach((id, i) => {
        const s = g.get(id);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // The ship itself, somewhere along the line.
      const pos = game.transit.positionIn(g);
      ctx.fillStyle = '#ffcc66';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 3.2 * px * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,204,102,0.5)';
      ctx.lineWidth = px;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 7 * px * 1.4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Systems.
    for (const s of g.systems) {
      const style = TYPE_STYLE[s.type] ?? { r: 5, color: '#aaa' };
      const visited = g.visited.has(s.id);
      const here = s.id === game.locationId;
      const r = style.r * px * 1.5;

      // Sector tint behind border and contested systems.
      if (s.contested || s.border) {
        ctx.fillStyle = 'rgba(204,68,68,0.1)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 3.4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = visited ? 1 : 0.5;
      ctx.fillStyle = style.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();

      if (style.ring) {
        ctx.strokeStyle = style.color;
        ctx.lineWidth = px;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 1.9, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Mission marker.
      const hasMission = (EPISODES_BY_SYSTEM[s.id] ?? [])
        .some((e) => !game.missions.completed.has(e.id));
      if (hasMission) {
        ctx.fillStyle = '#ff9c00';
        ctx.beginPath();
        const my = s.y - r * 3;
        ctx.moveTo(s.x, my - 3.4 * px * 1.5);
        ctx.lineTo(s.x + 3 * px * 1.5, my + 2.4 * px * 1.5);
        ctx.lineTo(s.x - 3 * px * 1.5, my + 2.4 * px * 1.5);
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
          ctx.arc(s.x, s.y, r * 3, a - 0.3, a + 0.3);
          ctx.stroke();
        }
      }

      // Selection.
      if (s.id === this.selectedId) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 2.4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Labels appear once you are zoomed in enough to read them.
      // Font size is expressed in world units so that, once the canvas
      // transform is applied, it lands at a fixed size on screen.
      if (this.view.scale > 2.4) {
        const fs = 11 / this.view.scale;
        ctx.font = `${fs}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = visited ? 'rgba(255,220,180,0.9)' : 'rgba(180,180,200,0.55)';
        ctx.fillText(visited || s.type !== 'anomaly' ? s.name : 'Unsurveyed', s.x, s.y + r * 2 + fs);
      }
    }

    // Sector names are a zoomed-out overview only; at close range they would
    // sit on top of the system labels that matter.
    if (this.view.scale < 2.4) {
      const seen = new Set();
      ctx.font = `${13 / this.view.scale}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      for (const s of g.systems) {
        if (seen.has(s.sector)) continue;
        seen.add(s.sector);
        const sector = SECTORS[s.sector];
        if (!sector) continue;
        const members = g.systems.filter((o) => o.sector === s.sector);
        const cx = members.reduce((n, o) => n + o.x, 0) / members.length;
        const cy = members.reduce((n, o) => n + o.y, 0) / members.length;
        ctx.fillStyle = `${sector.color}55`;
        ctx.fillText(sector.name.toUpperCase(), cx, cy - 8 / this.view.scale);
      }
    }

    ctx.restore();
  }
}
