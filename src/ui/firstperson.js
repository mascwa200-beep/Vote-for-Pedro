// The bridge, from where you are standing in it.
//
// This is the view the game is supposed to be played from: you are on the
// bridge, the main viewer is in front of you, and everything tactical happens
// on that screen rather than on a tab. Consoles are objects in the room you
// walk to and operate, not buttons in a list.
//
// It shares the renderer with the tactical view. One WebGL context, one shader,
// one canvas — a second Renderer on the same element is a bug this project has
// already fixed once, and browsers cap live contexts, so the constructor takes
// the renderer rather than making one.
//
// HOW THE VIEWSCREEN WORKS, AND WHY IT IS NOT A TEXTURE
//
// A live view of space inside the room needs the exterior scene rendered into a
// rectangle of the interior one. This renderer has no framebuffer objects and
// no render-to-texture; it is one program writing to one buffer. So the frame
// is two passes over the same context:
//
//   1. Scissor to the screen's rectangle, push the depth range to the far end,
//      and draw space — stars, the system's worlds, any hostile out there.
//   2. Release the scissor, restore the depth range, and draw the room. The
//      bridge geometry covers the whole frame EXCEPT the aperture, where there
//      is no geometry, and space shows through.
//
// The order matters and so does the depth range: clearing depth between passes
// instead would let the forward bulkhead paint over the screen.

import {
  vec3, mat4, quat, multiply, perspective, lookAt, compose, normalMatrix, project,
} from '../gfx/math.js';
import { roomMeshes, PALETTE } from '../gfx/room.js';
import { starfield, bodyMesh, VOLUME } from '../gfx/scene.js';
import { hullMesh, hullScale } from '../gfx/blueprint.js';
import { vista, fovFor, noseOf } from '../gfx/vista.js';
import { ROOMS } from '../world/interiors.data.js';
import { fitCanvas } from './touch.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Eye height. A person standing, not a camera on a tripod. */
export const EYE_HEIGHT = 1.62;

/** Seated in the command chair, which is lower and a step down into the well. */
export const SEATED_HEIGHT = 1.18;

/** How far the head can tilt. Enough to read a console, not enough to spin. */
export const PITCH_LIMIT = 1.05;

export class FirstPersonView {
  /**
   * @param {HTMLCanvasElement} canvas the shared GL canvas
   * @param {Renderer} renderer the shared renderer — NOT created here
   */
  constructor(canvas, renderer) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.pitch = 0;
    this.onUse = null;
    this.onLook = null;

    this.overlay = document.createElement('canvas');
    this.overlay.className = 'tactical-labels';
    canvas.parentNode?.insertBefore(this.overlay, canvas.nextSibling);

    this.stats = { drawCalls: 0, triangles: 0, frames: 0, lastMs: 0, screenRect: null };

    // Reused, so the draw path allocates nothing.
    this._proj = mat4();
    this._view = mat4();
    this._viewProj = mat4();
    this._model = mat4();
    this._eye = vec3();
    this._at = vec3();
    this._pos = vec3();
    this._quat = quat();
    this._nose = vec3();
    this._screenVP = mat4();

    this.attachGestures();
  }

  // -------------------------------------------------------------- gestures

  attachGestures() {
    const c = this.overlay;
    const pointers = new Map();
    let moved = 0;
    let downAt = 0;

    const onDown = (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
      moved = 0;
      downAt = (typeof performance !== 'undefined' ? performance.now() : 0);
      c.setPointerCapture?.(e.pointerId);
    };

    const onMove = (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { ...prev, x: e.clientX, y: e.clientY });
      moved += Math.abs(dx) + Math.abs(dy);
      // Drag to look. The picture follows the finger, same as the viewscreen
      // and the tactical plot, so the gesture is the same everywhere.
      this.onLook?.(-dx * 0.005, dy * 0.004);
    };

    const onUp = (e) => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      const held = (typeof performance !== 'undefined' ? performance.now() : 0) - downAt;
      // A tap, not a drag: use whatever is in front of you.
      if (p && moved < 12 && held < 600) this.onUse?.();
    };

    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);

    this._detach = () => {
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointercancel', onUp);
    };
  }

  look(dYaw, dPitch) {
    this.pitch = clamp(this.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
    return dYaw;
  }

  // ---------------------------------------------------------------- camera

  /** Where the eyes are: the walker's feet plus a person's height. */
  eyeOf(walker, out = this._eye) {
    out[0] = walker.x;
    out[1] = walker.seated ? SEATED_HEIGHT : EYE_HEIGHT;
    out[2] = walker.z;
    return out;
  }

  /** What the eyes are pointed at, a metre ahead. */
  lookAtOf(walker, out = this._at) {
    const eye = this.eyeOf(walker, this._eye);
    const c = Math.cos(this.pitch);
    out[0] = eye[0] + Math.sin(walker.yaw) * c;
    out[1] = eye[1] + Math.sin(this.pitch);
    out[2] = eye[2] + Math.cos(walker.yaw) * c;
    return out;
  }

  // ------------------------------------------------------------------ draw

  render(game, dt = 1 / 60) {
    void dt;
    const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
    const rect = this.canvas.getBoundingClientRect();
    const dpr = globalThis.devicePixelRatio ?? 1;
    const { aspect, width, height } = this.renderer.resize(
      rect.width || 320, rect.height || 320, dpr,
    );
    if (!this.renderer.beginFrame()) return;

    const walker = game?.walk;
    const room = walker?.room;
    if (!room) return;

    // Interior camera. A wider lens than the tactical plot, because a room at
    // arm's length through a 52-degree window is a keyhole.
    perspective(fovFor(aspect, 88), aspect, 0.06, 400, this._proj);
    lookAt(this.eyeOf(walker), this.lookAtOf(walker), vec3(0, 1, 0), this._view);
    multiply(this._proj, this._view, this._viewProj);

    // A room, not a vacuum. The ceiling ring is the light source, so the key
    // comes straight down — but a bridge with pale grey walls bouncing at each
    // other has almost no true shadow in it, which is what the high ambient
    // says. At the vacuum defaults this room rendered as a black box.
    this.renderer.setLighting({
      key: [0.15, 1.0, 0.1], fill: [-0.3, 0.25, -0.9],
      ambient: 0.62, keyPower: 0.44,
    });

    // Pass one: space, inside the screen.
    const screen = room.viewscreen ? this.screenRect(room, width, height) : null;
    this.stats.screenRect = screen;
    if (screen) this.drawThroughScreen(game, screen, aspect);

    // Pass two: the room, over the top of it.
    this.renderer.clearScissor();
    this.renderer.setDepthRange(0, 1);
    this.renderer.setLighting({
      key: [0.15, 1.0, 0.1], fill: [-0.3, 0.25, -0.9],
      ambient: 0.62, keyPower: 0.44,
    });
    this.renderer.setCamera(this._viewProj);
    this.drawRoom(room);

    this.stats.drawCalls = this.renderer.drawCalls;
    this.stats.triangles = this.renderer.triangles;
    this.stats.frames++;
    this.stats.lastMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;

    this.drawOverlay(game, rect);
  }

  /**
   * The viewscreen's rectangle on the canvas, in device pixels.
   *
   * The four corners of the panel are projected and their bounding box taken.
   * A bounding box rather than the quad itself, because a scissor rectangle is
   * axis-aligned — which is why the exterior is drawn FIRST and the room over
   * it: the bulkhead covers the difference between the box and the trapezoid.
   */
  screenRect(room, width, height) {
    const vs = room.viewscreen;
    const [x, z] = vs.at;
    const len = Math.hypot(x, z) || 1;
    const nx = -x / len;
    const nz = -z / len;
    const hw = vs.width / 2;
    // Centre of the aperture cut in the bay (0.74 to 2.30 above the deck).
    const y = 1.52;

    let minX = Infinity; let minY = Infinity;
    let maxX = -Infinity; let maxY = -Infinity;
    let anyInFront = false;

    for (const [u, v] of [[-hw, -vs.height / 2], [hw, -vs.height / 2], [hw, vs.height / 2], [-hw, vs.height / 2]]) {
      this._pos[0] = x + u * -nz;
      this._pos[1] = y + v;
      this._pos[2] = z + u * nx;
      const p = project(this._pos, this._viewProj);
      if (!p) continue;
      anyInFront = true;
      const sx = (p.x * 0.5 + 0.5) * width;
      const sy = (1 - (p.y * 0.5 + 0.5)) * height;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }

    if (!anyInFront || maxX <= 0 || maxY <= 0 || minX >= width || minY >= height) return null;
    return {
      x: Math.max(0, minX), y: Math.max(0, minY),
      w: Math.min(width, maxX) - Math.max(0, minX),
      h: Math.min(height, maxY) - Math.max(0, minY),
    };
  }

  /**
   * Space, drawn into the screen's rectangle.
   *
   * A viewscreen is a display, not a window: the picture is the bow view
   * whatever angle you are standing at, which is also what makes it legible
   * from the chair. So this camera is the SHIP's, not the captain's.
   */
  drawThroughScreen(game, screen, aspect) {
    const r = this.renderer;
    r.setScissor(screen.x, screen.y, screen.w, screen.h);
    // Back to vacuum inside the screen: one hard sun, deep shadow, which is
    // what a hull a thousand kilometres away actually looks like.
    r.setLighting({ key: [0.55, 0.72, 0.42], fill: [-0.6, -0.2, -0.5], ambient: 0.20, keyPower: 0.9 });
    // The far slice of the depth buffer, so the room drawn afterwards covers
    // everything except the aperture.
    r.setDepthRange(0.9990, 1.0);

    const eng = game.engagement;
    const ship = eng?.player;
    const nose = noseOf(ship, this._nose);
    const origin = ship ? [ship.x, ship.z ?? 0, ship.y] : [0, 0, 0];

    const eye = vec3(
      origin[0] + nose[0] * 140,
      origin[1] + nose[1] * 140 + 12,
      origin[2] + nose[2] * 140,
    );
    const at = vec3(
      eye[0] + nose[0] * 8000,
      eye[1] + nose[1] * 8000,
      eye[2] + nose[2] * 8000,
    );
    perspective(fovFor(aspect, 74), aspect, 2, 40000, this._proj);
    lookAt(eye, at, vec3(0, 1, 0), this._view);
    multiply(this._proj, this._view, this._screenVP);
    r.setCamera(this._screenVP);

    // Stars ride with the camera so they never come into reach.
    compose(eye, quat(), 1, this._model);
    r.draw('stars', starfield(), {
      model: this._model,
      normalMatrix: normalMatrix(this._model),
      emissive: 1,
      tint: [1, 1, 1],
      fogFar: 1e9,
    });

    // The system's worlds, culled to what is actually ahead.
    const sys = game.location;
    if (sys) {
      const v = vista(sys.id, sys.type);
      let drawn = 0;
      for (const b of v.bodies) {
        if (drawn >= 3) break;
        const dx = b.x - eye[0]; const dy = b.y - eye[1]; const dz = b.z - eye[2];
        const d = Math.hypot(dx, dy, dz) || 1;
        const slack = Math.min(0.75, b.radius / d);
        if ((dx * nose[0] + dy * nose[1] + dz * nose[2]) / d < 0.2 - slack) continue;
        this._pos[0] = b.x; this._pos[1] = b.y; this._pos[2] = b.z;
        compose(this._pos, quat(), b.radius, this._model);
        r.draw(`body:${b.kind}`, bodyMesh(b.kind, 0), {
          model: this._model,
          normalMatrix: normalMatrix(this._model),
          emissive: b.emissive,
          tint: b.tint,
          fogFar: 90000,
        });
        drawn++;
      }
    }

    // And anybody out there. This is the whole reason the tactical display no
    // longer needs to be a separate screen: the enemy is ON the viewer.
    if (eng) {
      for (const s of [...eng.hostiles, ...eng.allies]) {
        if (!s || s.destroyed) continue;
        this._pos[0] = s.x; this._pos[1] = s.z ?? 0; this._pos[2] = s.y;
        compose(this._pos, quat(), hullScale(s.classId), this._model);
        r.draw(`hull:${s.classId}:${s.faction}`, hullMesh(s.classId, s.faction), {
          model: this._model,
          normalMatrix: normalMatrix(this._model),
          alpha: s.cloaked ? 0.22 : 1,
          fogFar: VOLUME * 6,
        });
      }
    }
  }

  /** The room itself: one lit mesh and one self-lit one. */
  drawRoom(room) {
    const m = roomMeshes(room.id);
    if (!m) return;
    compose(vec3(0, 0, 0), quat(), 1, this._model);
    const nm = normalMatrix(this._model);
    // Rooms are 10 metres across, not 3,000 — the tactical falloff would fog a
    // bulkhead you are standing next to.
    this.renderer.draw(`room:${room.id}`, m.solid, {
      model: this._model, normalMatrix: nm, fogFar: 1e6,
    });
    this.renderer.draw(`room:${room.id}:glow`, m.glow, {
      model: this._model, normalMatrix: nm, emissive: 1, fogFar: 1e6,
    });
  }

  // -------------------------------------------------------------- overlay

  /**
   * What is in front of you, and nothing else.
   *
   * Deliberately almost empty. The room IS the interface — a heads-up display
   * of everything the ship knows would put the tabs back on the screen in a
   * different shape.
   */
  drawOverlay(game, rect) {
    this.overlay.style.width = `${rect.width}px`;
    this.overlay.style.height = `${rect.height}px`;
    const { ctx, width, height } = fitCanvas(this.overlay);
    ctx.clearRect(0, 0, width, height);

    const walker = game.walk;
    const target = walker.looking;

    // A reticle, so you know where "use this" is pointed.
    ctx.strokeStyle = target ? 'rgba(235, 92, 13, 0.95)' : 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    const cx = width / 2;
    const cy = height / 2;
    const r = target ? 9 : 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    if (target) {
      ctx.fillStyle = 'rgba(20,20,22,0.72)';
      ctx.font = '600 13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      const label = (target.label ?? ROOMS[target.to]?.name ?? '').toUpperCase();
      const w = ctx.measureText(label).width + 20;
      ctx.fillRect(cx - w / 2, cy + 22, w, 24);
      ctx.fillStyle = 'rgba(250, 190, 90, 0.95)';
      ctx.fillText(label, cx, cy + 39);
    }
  }

  dispose() {
    this._detach?.();
    this.overlay.remove();
  }
}
