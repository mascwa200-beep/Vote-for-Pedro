// The tactical display: a top-down vector view of the engagement.
//
// Everything is drawn from the live simulation state — ship positions, shield
// facings, firing arcs, torpedo tracks. Nothing here is decorative; if it is
// on the screen it is in the sim.

import { fitCanvas, attachPanZoom } from './touch.js';
import { FACTIONS } from '../world/factions.data.js';

const HULL_SHAPES = {
  // Simple silhouettes, drawn nose-up in local space and rotated to heading.
  federation: [[16, 0], [4, -7], [-8, -9], [-12, -4], [-12, 4], [-8, 9], [4, 7]],
  klingon: [[18, 0], [-2, -4], [-6, -14], [-12, -12], [-8, -3], [-14, 0], [-8, 3], [-12, 12], [-6, 14], [-2, 4]],
  romulan: [[14, 0], [0, -12], [-14, -16], [-10, -3], [-16, 0], [-10, 3], [-14, 16], [0, 12]],
  cardassian: [[18, 0], [2, -6], [-10, -10], [-14, 0], [-10, 10], [2, 6]],
  borg: [[13, 13], [13, -13], [-13, -13], [-13, 13]],
  default: [[14, 0], [-4, -8], [-12, -6], [-12, 6], [-4, 8]],
};

export class TacticalView {
  constructor(canvas) {
    this.canvas = canvas;
    this.view = { x: 0, y: 0, scale: 0.32 };
    this.onSelect = null;
    this.lastShips = [];
    attachPanZoom(canvas, this.view, {
      minScale: 0.08, maxScale: 1.6,
      onTap: (px, py) => this.handleTap(px, py),
    });
  }

  /**
   * Let go of the canvas.
   *
   * `main.js` has always called `this.tactical?.dispose?.()` when it swaps
   * views; this class simply had no such method, so the optional call did
   * nothing and the pointer handlers accumulated on a canvas that is reused
   * for the life of the session.
   */
  dispose() {
    this.view.detach?.();
    this.onSelect = null;
    this.lastShips = [];
  }

  handleTap(px, py) {
    if (!this.onSelect) return;
    const { width, height } = this.canvas.getBoundingClientRect();
    const world = this.toWorld(px, py, width, height);
    let best = null;
    let bestD = 70 / this.view.scale;
    for (const s of this.lastShips) {
      if (s.destroyed || s.isPlayer) continue;
      const d = Math.hypot(s.x - world.x, s.y - world.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) this.onSelect(best);
  }

  toWorld(px, py, width, height) {
    return {
      x: (px - width / 2) / this.view.scale - this.view.x,
      y: (py - height / 2) / this.view.scale - this.view.y,
    };
  }

  /** Keep the player and the current target both on screen. */
  autoFrame(engagement) {
    const ships = [engagement.player, ...engagement.liveHostiles, ...engagement.allies]
      .filter((s) => !s.destroyed);
    if (!ships.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of ships) {
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    // Ease toward the centroid so the view never snaps.
    this.view.x += (-cx - this.view.x) * 0.08;
    this.view.y += (-cy - this.view.y) * 0.08;

    const rect = this.canvas.getBoundingClientRect();
    const span = Math.max(maxX - minX, maxY - minY, 400) * 1.35;
    const want = Math.min(rect.width, rect.height) / span;
    this.view.scale += (Math.max(0.08, Math.min(0.9, want)) - this.view.scale) * 0.06;
  }

  render(engagement, alpha = 0) {
    const { ctx, width, height } = fitCanvas(this.canvas);
    ctx.clearRect(0, 0, width, height);
    if (!engagement) return;

    this.lastShips = [engagement.player, ...engagement.hostiles, ...engagement.allies];
    this.autoFrame(engagement);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(this.view.scale, this.view.scale);
    ctx.translate(this.view.x, this.view.y);

    this.drawGrid(ctx, width, height);
    this.drawTerrain(ctx, engagement.arena);
    this.drawRangeRings(ctx, engagement.player);

    for (const e of engagement.effects) this.drawEffect(ctx, e);
    for (const p of engagement.projectiles) this.drawProjectile(ctx, p);

    for (const s of engagement.allies) if (!s.destroyed) this.drawShip(ctx, s, '#66ccff', false);
    for (const s of engagement.hostiles) {
      if (s.destroyed) continue;
      const color = FACTIONS[s.faction]?.color ?? '#ff6666';
      this.drawShip(ctx, s, color, s === engagement.target);
    }
    if (!engagement.player.destroyed) {
      this.drawShip(ctx, engagement.player, '#ffcc66', false, true);
    }

    ctx.restore();
    void alpha;
  }

  drawGrid(ctx, width, height) {
    const step = 250;
    const halfW = width / this.view.scale / 2 + step;
    const halfH = height / this.view.scale / 2 + step;
    const originX = -this.view.x;
    const originY = -this.view.y;
    const startX = Math.floor((originX - halfW) / step) * step;
    const startY = Math.floor((originY - halfH) / step) * step;

    ctx.strokeStyle = 'rgba(90,110,170,0.16)';
    ctx.lineWidth = 1 / this.view.scale;
    ctx.beginPath();
    for (let x = startX; x < originX + halfW; x += step) {
      ctx.moveTo(x, originY - halfH); ctx.lineTo(x, originY + halfH);
    }
    for (let y = startY; y < originY + halfH; y += step) {
      ctx.moveTo(originX - halfW, y); ctx.lineTo(originX + halfW, y);
    }
    ctx.stroke();
  }

  /**
   * The terrain, in plan.
   *
   * The flat plot is the fallback when WebGL is unavailable, and it is a
   * complete view of the fight rather than a decorative one — so it has to
   * show the rocks. Without them a shot stops in empty space and the display
   * is lying about why.
   *
   * Drawn at full radius rather than at the cross-section through z = 0. A
   * plan view already flattens altitude — that is what the drop lines in the
   * 3D view exist to put back — and a rock that shrinks and vanishes as it
   * rises out of the plane is a rock the player stops believing in while it is
   * still blocking their guns.
   */
  drawTerrain(ctx, arena) {
    if (!arena?.features?.length) return;
    const tint = arena.tint
      ? `${Math.round(arena.tint[0] * 255)},${Math.round(arena.tint[1] * 255)},${Math.round(arena.tint[2] * 255)}`
      : '200,180,255';
    for (const f of arena.features) {
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      if (f.type === 'solid') {
        ctx.fillStyle = 'rgba(96,92,86,0.55)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(150,144,134,0.7)';
        ctx.lineWidth = 1.5 / this.view.scale;
        ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(${tint},0.10)`;
        ctx.fill();
      }
    }
  }

  /** Weapon range rings around the player — the reason to close or hold. */
  drawRangeRings(ctx, player) {
    const rings = [
      { r: 620, color: 'rgba(255,153,102,0.18)' },   // cannon
      { r: 900, color: 'rgba(255,204,102,0.14)' },   // beam
    ];
    ctx.lineWidth = 1.5 / this.view.scale;
    for (const ring of rings) {
      ctx.strokeStyle = ring.color;
      ctx.beginPath();
      ctx.arc(player.x, player.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawShip(ctx, ship, color, isTarget, isPlayer = false) {
    const scale = 1 + Math.log10(Math.max(1, ship.cls.mass)) * 1.6;
    ctx.save();
    ctx.translate(ship.x, ship.y);

    // Weapon arcs, for the player's own narrow mounts, beneath the shields.
    //
    // The flat plot is the real WebGL-failure fallback, so it must not be the
    // view where a feature is quietly missing — a captain whose phone dropped
    // the 3D context should still be able to see which way the tubes point.
    //
    // The honest caveat, in the same voice this file uses about drawing rocks
    // at full radius rather than at their z=0 cross-section: A PLAN VIEW
    // FLATTENS THE CONE'S ELEVATION. `inArc` tests a real three-dimensional
    // cone, so a target well above or below the plane can sit inside the wedge
    // drawn here and outside the arc the gunnery actually checks.
    //
    // Only mounts of 180 degrees or less, for the reason the 3D view gives:
    // a 250-degree bank overlapping a 200-degree one is a ring, and a ring is
    // not information.
    if (isPlayer) {
      const r = 26 * scale;
      for (const w of ship.weapons ?? []) {
        const deg = w.degrees ?? 360;
        if (deg > 180) continue;
        const half = deg / 2;
        const dead = w.enabled === false;
        ctx.fillStyle = dead ? 'rgba(190,70,60,0.10)' : 'rgba(110,170,255,0.13)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r,
          (ship.heading + (w.facing ?? 0) - half) * Math.PI / 180,
          (ship.heading + (w.facing ?? 0) + half) * Math.PI / 180);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Shield arcs, drawn only where there is shield left to draw.
    if (ship.shieldsUp && !ship.cloaked) {
      const radius = 30 * scale;
      // Four arcs, and the loop reads THIS table rather than `FACINGS`.
      //
      // Shields have six facings; a plan view has room for four. Dorsal and
      // ventral are "over the top of us" and "under us", which a top-down plot
      // cannot point at — the six-facing readout lives on the tactical panel,
      // where it has a middle column to put them in.
      //
      // This loop used to iterate `FACINGS` and index into these four, so the
      // moment shields gained a third axis it destructured `undefined` and
      // threw on the first ship with its shields up. Nothing caught it because
      // nothing could reach this view: `settings.render3d` was never written,
      // so the flat plot was unreachable except on a real WebGL failure. It has
      // been throwing ever since, behind a door with no handle.
      //
      // Iterating the table is what stops that happening again: a facing this
      // projection cannot draw is simply not in it, and there is no second list
      // to keep in step.
      const arcs = {
        fore: [-45, 45], starboard: [45, 135], aft: [135, 225], port: [225, 315],
      };
      ctx.lineWidth = 5 / this.view.scale + 1.5;
      for (const [f, [a0, a1]] of Object.entries(arcs)) {
        const pct = ship.shieldPctOf(f);
        if (pct <= 0.02) continue;
        ctx.strokeStyle = `rgba(120,180,255,${0.18 + pct * 0.5})`;
        ctx.beginPath();
        ctx.arc(0, 0, radius,
          (ship.heading + a0) * Math.PI / 180,
          (ship.heading + a1) * Math.PI / 180);
        ctx.stroke();
      }
    }

    ctx.rotate(ship.heading * Math.PI / 180);
    ctx.scale(scale, scale);

    const shape = HULL_SHAPES[ship.faction] ?? HULL_SHAPES.default;
    ctx.globalAlpha = ship.cloaked ? 0.16 : 1;
    ctx.beginPath();
    shape.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = ship.destroyed ? '#333' : color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#000';
    ctx.stroke();

    // Fires burning on the hull.
    if (ship.fires > 0) {
      ctx.fillStyle = 'rgba(255,120,40,0.85)';
      for (let i = 0; i < Math.min(4, ship.fires); i++) {
        ctx.beginPath();
        ctx.arc(-4 + i * 4, (i % 2 ? 4 : -4), 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Target bracket.
    if (isTarget) {
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.strokeStyle = '#ff5555';
      ctx.lineWidth = 2 / this.view.scale;
      const r = 42 * scale;
      for (let i = 0; i < 4; i++) {
        const a = (i * 90 + 45) * Math.PI / 180;
        ctx.beginPath();
        ctx.arc(0, 0, r, a - 0.28, a + 0.28);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Player heading indicator.
    if (isPlayer) {
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.rotate(ship.desiredHeading * Math.PI / 180);
      ctx.strokeStyle = 'rgba(255,204,102,0.4)';
      ctx.lineWidth = 1.5 / this.view.scale;
      ctx.setLineDash([8 / this.view.scale, 8 / this.view.scale]);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(220, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Name and hull bar.
    ctx.save();
    ctx.translate(ship.x, ship.y);
    const fontSize = Math.max(9, 11 / this.view.scale);
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = ship.cloaked ? 'rgba(200,200,220,0.35)' : 'rgba(230,230,255,0.85)';
    const labelY = 46 * scale + fontSize;
    ctx.fillText(ship.name, 0, labelY);

    const barW = 54 * scale;
    const barY = labelY + 5;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(-barW / 2, barY, barW, 4 / this.view.scale + 1);
    ctx.fillStyle = ship.hullPct > 0.5 ? '#66cc66' : ship.hullPct > 0.25 ? '#ffcc66' : '#cc4444';
    ctx.fillRect(-barW / 2, barY, barW * ship.hullPct, 4 / this.view.scale + 1);
    ctx.restore();
  }

  drawProjectile(ctx, p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 14);
    grad.addColorStop(0, 'rgba(255,240,180,1)');
    grad.addColorStop(0.4, 'rgba(255,140,60,0.85)');
    grad.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawEffect(ctx, e) {
    switch (e.kind) {
      case 'beam':
      case 'cannon': {
        const alpha = Math.max(0, e.life / 0.35);
        ctx.strokeStyle = e.faction === 'federation'
          ? `rgba(255,180,80,${alpha})`
          : `rgba(120,255,120,${alpha})`;
        ctx.lineWidth = (e.kind === 'cannon' ? 5 : 3) / this.view.scale;
        ctx.beginPath();
        ctx.moveTo(e.from.x, e.from.y);
        ctx.lineTo(e.to.x, e.to.y);
        ctx.stroke();
        break;
      }
      case 'impact': {
        const t = 1 - e.life / 0.4;
        const r = 12 + t * 34;
        ctx.strokeStyle = e.penetrated
          ? `rgba(255,120,80,${1 - t})`
          : `rgba(140,190,255,${1 - t})`;
        ctx.lineWidth = (e.crit ? 4 : 2) / this.view.scale;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'explosion': {
        const t = 1 - e.life / 1.6;
        const r = 20 + t * 190;
        const grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
        grad.addColorStop(0, `rgba(255,255,220,${(1 - t) * 0.9})`);
        grad.addColorStop(0.35, `rgba(255,160,60,${(1 - t) * 0.7})`);
        grad.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'cloak':
      case 'decloak': {
        const t = 1 - e.life;
        ctx.strokeStyle = `rgba(160,255,180,${1 - t})`;
        ctx.lineWidth = 3 / this.view.scale;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 30 + t * 60, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      default:
        break;
    }
  }
}
