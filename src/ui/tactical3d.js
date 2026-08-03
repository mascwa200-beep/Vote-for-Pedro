// The tactical display, in three dimensions.
//
// Drop-in for TacticalView: same constructor, same `render(engagement, alpha)`,
// same `onSelect` hook. If WebGL is unavailable — an old device, a headless
// runner, a driver that said no — `TacticalView3D.create` returns null and the
// caller keeps the 2D display, which is still a complete, playable view.
//
// Two things make a 3D tactical display readable rather than merely impressive:
//
//   A reference plane. Nothing in space tells you where things are relative to
//   each other. The grid at y=0 and a drop line from every hull to it are what
//   turn "those two ships overlap on screen" into "that one is above me".
//
//   A camera that stays behind and above your own ship rather than floating
//   free. You are commanding from a bridge, not directing a film.
//
// Labels, reticles and range rings stay in 2D on an overlay canvas. Text in a
// 3D scene needs a glyph atlas, which is an asset, and this project does not
// ship assets.

import {
  vec3, mat4, quat, identity, multiply, perspective, lookAt, compose,
  normalMatrix, quatFromEuler, project, sub, length as vlength, normalize, cross,
} from '../gfx/math.js';
import { Renderer } from '../gfx/gl.js';
import { hullMesh, hullScale, paletteFor } from '../gfx/blueprint.js';
import {
  starfield, gridMesh, beamMesh, torpedoMesh, shieldMesh, explosionMesh,
  dropLineMesh, VOLUME,
} from '../gfx/scene.js';
import { fitCanvas } from './touch.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Simulation space is currently a plane: ships carry x, y and a heading in
 * degrees. Render space is 3D with +y up. Mapping here rather than at every
 * call site means the day ships gain a real altitude, only `z` has to start
 * arriving and nothing else in this file changes.
 */
function worldOf(ship, out = vec3()) {
  out[0] = ship.x;
  out[1] = ship.z ?? 0;
  out[2] = ship.y;
  return out;
}

function orientationOf(ship, out = quat()) {
  // Heading is a compass bearing in the xz plane; pitch and roll are optional
  // and default to level, which is what a 2D engagement produces.
  return quatFromEuler(
    -(ship.pitch ?? 0) * Math.PI / 180,
    -(ship.heading ?? 0) * Math.PI / 180,
    (ship.roll ?? 0) * Math.PI / 180,
    out,
  );
}

export class TacticalView3D {
  /** @returns {TacticalView3D|null} null when WebGL is unavailable. */
  static create(canvas) {
    // The GL canvas sits behind an overlay canvas for LCARS text. The caller
    // gives us one element, so the second is created here and inserted beside
    // it, inheriting its box.
    const renderer = Renderer.create(canvas);
    if (!renderer) return null;
    return new TacticalView3D(canvas, renderer);
  }

  constructor(canvas, renderer) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.onSelect = null;
    this.lastShips = [];

    this.overlay = document.createElement('canvas');
    this.overlay.className = 'tactical-labels';
    canvas.parentNode?.insertBefore(this.overlay, canvas.nextSibling);

    // Camera: an orbit around a focus point that eases toward the fleet.
    this.cam = {
      focus: vec3(0, 0, 0),
      yaw: -0.6,
      pitch: 0.62,
      distance: 1700,
      wantDistance: 1700,
    };

    this.stats = { drawCalls: 0, triangles: 0, frames: 0, lastMs: 0 };

    // Reused matrices — the draw path allocates nothing.
    this._proj = mat4();
    this._view = mat4();
    this._viewProj = mat4();
    this._model = mat4();
    this._pos = vec3();
    this._quat = quat();

    this.attachGestures();
  }

  // ------------------------------------------------------------- gestures

  attachGestures() {
    const c = this.overlay;
    let pointers = new Map();
    let lastPinch = 0;
    let moved = 0;

    const onDown = (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      c.setPointerCapture?.(e.pointerId);
    };

    const onMove = (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved += Math.abs(dx) + Math.abs(dy);

      if (pointers.size === 1) {
        // One finger orbits. Pitch is clamped well short of the poles so the
        // grid never degenerates into a line and the up vector stays valid.
        this.cam.yaw -= dx * 0.006;
        this.cam.pitch = clamp(this.cam.pitch + dy * 0.005, 0.08, 1.45);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch) {
          this.cam.wantDistance = clamp(this.cam.wantDistance * (lastPinch / d), 320, VOLUME * 1.6);
          this.userZoom = true;
        }
        lastPinch = d;
      }
    };

    const onUp = (e) => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) lastPinch = 0;
      // A tap, not a drag, selects a target.
      if (p && moved < 10 && this.onSelect) this.pick(e.clientX, e.clientY);
    };

    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.wantDistance = clamp(this.cam.wantDistance * (1 + Math.sign(e.deltaY) * 0.12), 320, VOLUME * 1.6);
      this.userZoom = true;
    }, { passive: false });

    this._detach = () => {
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointercancel', onUp);
    };
  }

  /** Nearest hostile to the tap, in screen space. */
  pick(clientX, clientY) {
    const rect = this.overlay.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best = null;
    let bestD = 70;
    for (const s of this.lastShips) {
      if (s.destroyed || s.isPlayer) continue;
      const p = project(worldOf(s, this._pos), this._viewProj);
      if (!p) continue;
      const sx = (p.x * 0.5 + 0.5) * rect.width;
      const sy = (1 - (p.y * 0.5 + 0.5)) * rect.height;
      const d = Math.hypot(sx - px, sy - py);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) this.onSelect(best);
  }

  // --------------------------------------------------------------- camera

  /**
   * Ease the focus onto the fleet centroid and the distance onto whatever
   * frames every live hull. Never snaps — a camera that jumps when a ship
   * explodes is worse than one that is briefly badly framed.
   */
  frame(engagement) {
    const ships = [engagement.player, ...engagement.liveHostiles, ...engagement.allies]
      .filter((s) => s && !s.destroyed);
    if (!ships.length) return;

    let cx = 0; let cy = 0; let cz = 0;
    let span = 400;
    for (const s of ships) {
      cx += s.x; cy += (s.z ?? 0); cz += s.y;
    }
    cx /= ships.length; cy /= ships.length; cz /= ships.length;
    for (const s of ships) {
      span = Math.max(span, Math.hypot(s.x - cx, (s.z ?? 0) - cy, s.y - cz) * 2.4);
    }

    this.cam.focus[0] += (cx - this.cam.focus[0]) * 0.06;
    this.cam.focus[1] += (cy - this.cam.focus[1]) * 0.06;
    this.cam.focus[2] += (cz - this.cam.focus[2]) * 0.06;

    if (!this.userZoom) {
      this.cam.wantDistance = clamp(span * 1.15, 500, VOLUME * 1.2);
    }
    this.cam.distance += (this.cam.wantDistance - this.cam.distance) * 0.07;
  }

  eye(out = vec3()) {
    const { focus, yaw, pitch, distance } = this.cam;
    const cp = Math.cos(pitch);
    out[0] = focus[0] + Math.cos(yaw) * cp * distance;
    out[1] = focus[1] + Math.sin(pitch) * distance;
    out[2] = focus[2] + Math.sin(yaw) * cp * distance;
    return out;
  }

  // ---------------------------------------------------------------- draw

  render(engagement, alpha = 0) {
    void alpha;
    const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
    const rect = this.canvas.getBoundingClientRect();
    const dpr = globalThis.devicePixelRatio ?? 1;
    const { aspect } = this.renderer.resize(rect.width || 320, rect.height || 320, dpr);

    if (!this.renderer.beginFrame()) return;
    if (!engagement) return;

    this.frame(engagement);
    this.lastShips = [engagement.player, ...engagement.hostiles, ...engagement.allies]
      .filter(Boolean);

    perspective(52 * Math.PI / 180, aspect, 5, 40000, this._proj);
    lookAt(this.eye(), this.cam.focus, vec3(0, 1, 0), this._view);
    multiply(this._proj, this._view, this._viewProj);
    this.renderer.setCamera(this._viewProj);

    this.drawEnvironment();
    for (const ship of this.lastShips) {
      if (!ship.destroyed) this.drawShip(ship, ship === engagement.target);
    }
    this.drawEffects(engagement);

    this.stats.drawCalls = this.renderer.drawCalls;
    this.stats.triangles = this.renderer.triangles;
    this.stats.frames++;
    this.stats.lastMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;

    this.drawOverlay(engagement, rect);
  }

  drawEnvironment() {
    // The starfield rides with the camera so it never comes into reach.
    const stars = starfield();
    compose(this.eye(), quat(), 1, this._model);
    this.renderer.draw('stars', stars, {
      model: this._model,
      normalMatrix: normalMatrix(this._model),
      emissive: 1,
      tint: [1, 1, 1],
    });

    identity(this._model);
    this.renderer.draw('grid', gridMesh(), {
      model: this._model,
      normalMatrix: normalMatrix(this._model),
      emissive: 1,
      alpha: 0.55,
      tint: [1, 1, 1],
    });
  }

  drawShip(ship, isTarget) {
    const mesh = hullMesh(ship.classId, ship.faction);
    const scale = hullScale(ship.classId);
    compose(worldOf(ship, this._pos), orientationOf(ship, this._quat), scale, this._model);

    // Damage darkens the plating; the current target is lifted toward its
    // faction's own accent so it is obvious which hull the guns are on.
    const hurt = 0.55 + 0.45 * (ship.hullPct ?? 1);
    const tint = isTarget
      ? [hurt * 1.25, hurt * 1.1, hurt * 0.9]
      : [hurt, hurt, hurt];

    this.renderer.draw(`hull:${ship.classId}:${ship.faction}`, mesh, {
      model: this._model,
      normalMatrix: normalMatrix(this._model),
      tint,
      alpha: ship.cloaked ? 0.22 : 1,
    });

    // Drop line to the grid: this is what makes altitude legible.
    const alt = ship.z ?? 0;
    if (Math.abs(alt) > 1) {
      this._pos[1] = Math.min(0, alt);
      compose(this._pos, quat(), 1, this._model);
      this._model[5] = Math.abs(alt);      // stretch the unit line to the drop
      this.renderer.draw('dropline', dropLineMesh(), {
        model: this._model,
        normalMatrix: normalMatrix(this._model),
        emissive: 1,
        alpha: 0.4,
        tint: [1, 1, 1],
      });
    }

    // Shield shell, only while a facing is actually holding charge.
    if (ship.shieldsUp && (ship.shieldPct ?? 0) > 0.02) {
      // Close to the hull and very faint. A large bright bubble dominates the
      // frame and hides the ship it is protecting, which is the wrong way round
      // for a display whose job is telling you what you are looking at.
      compose(worldOf(ship, this._pos), quat(), scale * 1.25, this._model);
      const p = paletteFor(ship.faction);
      this.renderer.draw('shield', shieldMesh(), {
        model: this._model,
        normalMatrix: normalMatrix(this._model),
        emissive: 1,
        alpha: 0.04 + 0.07 * (ship.shieldPct ?? 0),
        tint: p.glow,
      });
    }
  }

  drawEffects(engagement) {
    // Beams: a unit tube along +x, rotated onto the shot and stretched to it.
    for (const e of engagement.effects) {
      if (e.kind !== 'beam' && e.kind !== 'cannon') continue;
      const from = vec3(e.from.x, e.from.z ?? 0, e.from.y);
      const to = vec3(e.to.x, e.to.z ?? 0, e.to.y);
      const dir = sub(to, from);
      const len = vlength(dir);
      if (len < 1) continue;

      this.orientAlong(dir, from, len, e.kind === 'cannon' ? 5 : 3);
      const p = paletteFor(e.faction);
      this.renderer.draw('beam', beamMesh(), {
        model: this._model,
        normalMatrix: normalMatrix(this._model),
        emissive: 1,
        alpha: clamp(e.life * 2.4, 0, 0.9),
        tint: p.glow,
      });
    }

    for (const p of engagement.projectiles) {
      compose(vec3(p.x, p.z ?? 0, p.y), quat(), 9, this._model);
      this.renderer.draw('torpedo', torpedoMesh(), {
        model: this._model,
        normalMatrix: normalMatrix(this._model),
        emissive: 1,
        tint: [1, 1, 1],
      });
    }

    for (const e of engagement.effects) {
      if (e.kind !== 'explosion') continue;
      const age = clamp(1 - e.life / 1.6, 0, 1);
      compose(vec3(e.x, e.z ?? 0, e.y), quat(), 30 + age * 130, this._model);
      this.renderer.draw('explosion', explosionMesh(), {
        model: this._model,
        normalMatrix: normalMatrix(this._model),
        emissive: 1,
        alpha: 1 - age,
        tint: [1, 1, 1],
      });
    }
  }

  /** Build a model matrix that lays a unit +x mesh along `dir`, `thickness` wide. */
  orientAlong(dir, from, len, thickness) {
    const x = normalize(dir);
    let up = vec3(0, 1, 0);
    if (Math.abs(x[1]) > 0.98) up = vec3(1, 0, 0);
    const z = normalize(cross(x, up));
    const y = cross(z, x);

    const m = this._model;
    m[0] = x[0] * len; m[1] = x[1] * len; m[2] = x[2] * len; m[3] = 0;
    m[4] = y[0] * thickness; m[5] = y[1] * thickness; m[6] = y[2] * thickness; m[7] = 0;
    m[8] = z[0] * thickness; m[9] = z[1] * thickness; m[10] = z[2] * thickness; m[11] = 0;
    m[12] = from[0]; m[13] = from[1]; m[14] = from[2]; m[15] = 1;
    return m;
  }

  // -------------------------------------------------------------- overlay

  /** LCARS chrome: names, hull bars, the target reticle. Plain 2D, on top. */
  drawOverlay(engagement, rect) {
    this.overlay.style.width = `${rect.width}px`;
    this.overlay.style.height = `${rect.height}px`;
    const { ctx, width, height } = fitCanvas(this.overlay);
    ctx.clearRect(0, 0, width, height);

    for (const ship of this.lastShips) {
      if (ship.destroyed) continue;
      const p = project(worldOf(ship, this._pos), this._viewProj);
      if (!p || p.z > 1) continue;
      const sx = (p.x * 0.5 + 0.5) * width;
      const sy = (1 - (p.y * 0.5 + 0.5)) * height;
      if (sx < -80 || sx > width + 80 || sy < -60 || sy > height + 60) continue;

      const isTarget = ship === engagement.target;
      const isPlayer = ship.isPlayer;
      const accent = isPlayer ? '#9cf' : isTarget ? '#ff9a3c' : '#e5533d';

      if (isTarget) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        const r = 26;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + Math.PI / 4;
          const cx = sx + Math.cos(a) * r;
          const cy = sy + Math.sin(a) * r;
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8);
        }
        ctx.stroke();
      }

      ctx.fillStyle = accent;
      ctx.font = '600 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(ship.name, sx, sy - 32);

      // Hull bar.
      const w = 34;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(sx - w / 2, sy - 28, w, 3);
      ctx.fillStyle = ship.hullPct > 0.5 ? '#7ed957' : ship.hullPct > 0.25 ? '#d9a441' : '#e5533d';
      ctx.fillRect(sx - w / 2, sy - 28, w * clamp(ship.hullPct, 0, 1), 3);
    }
  }

  dispose() {
    this._detach?.();
    this.renderer.dispose();
    this.overlay.remove();
  }
}
