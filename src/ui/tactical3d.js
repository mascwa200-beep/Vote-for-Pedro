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
  normalMatrix, quatFromEuler, quatAxisAngle, quatMultiply,
  project, sub, length as vlength, normalize, cross,
} from '../gfx/math.js';
import { Renderer, VACUUM_LIGHT } from '../gfx/gl.js';
import { hullMesh, hullScale, paletteFor, HULL_GLOSS, HULL_SHINE, HULL_RIM } from '../gfx/blueprint.js';
import {
  starfield, gridMesh, shieldMesh, dropLineMesh, bodyMesh, rockMesh, cloudMesh, arcMesh, VOLUME,
} from '../gfx/scene.js';
import { vista, bearingOf, fovFor, noseOf, VISTA_DRAW_CAP } from '../gfx/vista.js';
import { inArc } from '../sim/ship.js';
import { WEAPON_RANGE } from '../sim/combat.js';
import { drawCombatEffects } from '../gfx/effects.js';
import { fitCanvas } from './touch.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const DEG = Math.PI / 180;

// Defined in gfx/vista.js and re-exported here, where it is enforced, so that
// node — which cannot import this file — can assert the budget against the one
// definition instead of a copy of the number.
export { VISTA_DRAW_CAP };

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
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Renderer} [shared] a renderer the caller already owns
   * @returns {TacticalView3D|null} null when WebGL is unavailable.
   *
   * The renderer is INJECTED when the caller has one. There is exactly one GL
   * context in this application and several views that draw through it; a view
   * that makes its own is how you end up with two contexts on one canvas, which
   * browsers cap and then silently drop the oldest of. `ownsRenderer` records
   * which case this is, so `dispose` only tears down what it made.
   */
  static create(canvas, shared = null) {
    const renderer = shared ?? Renderer.create(canvas);
    if (!renderer) return null;
    const view = new TacticalView3D(canvas, renderer);
    view.ownsRenderer = !shared;
    return view;
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

    // 'orbit' is the tactical plot, looking in at the engagement from outside.
    // 'forward' is the viewscreen: the camera sits at the bridge and looks out
    // over the bow. Same renderer, same meshes, same frame — one camera.
    this.cameraMode = 'orbit';
    this.showArcs = true;
    this._arcQuat = quat();

    // Where the screen is pointed relative to the bow, and how tight the
    // magnification is. In a fight the pan is limited and springs back to
    // centre, because the screen is slaved to the ship. Parked, it is free:
    // the helm can point the ship anywhere and there is nothing else to do.
    this.look = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 };
    this.magnification = 1;
    // Set by a pinch or a wheel, cleared by a new engagement — see frame().
    this.userZoom = false;
    this.framedEngagement = null;
    this.vistaSpin = 0;
    this.vistaSource = null;

    this.stats = { drawCalls: 0, triangles: 0, frames: 0, lastMs: 0 };

    // Reused matrices — the draw path allocates nothing.
    this._proj = mat4();
    this._view = mat4();
    this._viewProj = mat4();
    this._model = mat4();
    this._pos = vec3();
    this._quat = quat();
    // Scratch for the normal matrix; see the note in firstperson.js.
    this._normal = new Float64Array(9);
    this._nose = vec3();
    this._eyeTmp = vec3();
    this._look = vec3();
    this._camEye = vec3();

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
        if (this.cameraMode === 'forward') {
          // On the viewscreen a drag pans the screen rather than orbiting the
          // scene — you are turning your head, not walking around the outside.
          // The picture follows the finger: drag right and the sky moves
          // right, which means the camera swings left. Same convention as the
          // orbit gesture on this exact canvas, so nothing has to be relearned.
          this.panLook(-dx * 0.004, dy * 0.003);
        } else {
          // One finger orbits. Pitch is clamped well short of the poles so the
          // grid never degenerates into a line and the up vector stays valid.
          this.cam.yaw -= dx * 0.006;
          this.cam.pitch = clamp(this.cam.pitch + dy * 0.005, 0.08, 1.45);
        }
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch) {
          if (this.cameraMode === 'forward') {
            // Pinching a viewscreen magnifies. There is no dolly — the camera
            // is bolted to the ship, which is the entire premise.
            this.setMagnification(this.magnification * (d / lastPinch));
          } else {
            this.cam.wantDistance = clamp(this.cam.wantDistance * (lastPinch / d), 320, VOLUME * 1.6);
            this.userZoom = true;
          }
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
      if (this.cameraMode === 'forward') {
        this.setMagnification(this.magnification * (1 - Math.sign(e.deltaY) * 0.12));
        return;
      }
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

    // A new fight is framed afresh.
    //
    // Pinching the plot sets `userZoom`, which switches the framing camera off
    // so it cannot fight the player's fingers. Nothing ever switched it back
    // on, so one pinch — in the first skirmish of a five-year commission —
    // disabled auto-framing permanently, and every later battle was drawn at
    // whatever distance that pinch had left behind. The Borg cube that the
    // camera is supposed to pull back for arrived and it did not move.
    if (this.framedEngagement !== engagement) {
      this.framedEngagement = engagement;
      this.userZoom = false;
    }

    let cx = 0; let cy = 0; let cz = 0;
    // The floor on how far back the camera will go used to be a flat 400 units,
    // which was a reasonable number when every hull in the game drew about a
    // hundred units across. At true scale it is the wrong KIND of number: it
    // frames a Constitution well, holds a Danube runabout — six units of ship —
    // at seventy times its own length, and is irrelevant next to a Borg cube.
    //
    // A camera distance is only ever meaningful in hull lengths, so the floor
    // is one now. A duel between two runabouts closes right in; a fight with a
    // cube in it still pulls all the way back, because the same rule says so.
    let biggest = 0;
    for (const s of ships) biggest = Math.max(biggest, hullScale(s.classId));
    let span = Math.max(biggest * 3.2, 60);
    for (const s of ships) {
      cx += s.x; cy += (s.z ?? 0); cz += s.y;
    }
    cx /= ships.length; cy /= ships.length; cz /= ships.length;
    for (const s of ships) {
      // The hull's own extent counts, not only where its centre is. Framing on
      // positions alone was fine when every ship was about a hundred units
      // across; at true scale a Borg cube is 869 units of solid object and a
      // camera framed on its centre point has most of it off the screen.
      const reach = Math.hypot(s.x - cx, (s.z ?? 0) - cy, s.y - cz)
        + hullScale(s.classId) * 0.6;
      span = Math.max(span, reach * 2.4);
    }

    this.cam.focus[0] += (cx - this.cam.focus[0]) * 0.06;
    this.cam.focus[1] += (cy - this.cam.focus[1]) * 0.06;
    this.cam.focus[2] += (cz - this.cam.focus[2]) * 0.06;

    if (!this.userZoom) {
      // The lower bound keeps the near plane (5 units) clear of the nearest
      // hull; the upper one keeps the whole fight inside the arena.
      this.cam.wantDistance = clamp(span * 1.15, biggest * 2 + 40, VOLUME * 1.2);
    }
    this.cam.distance += (this.cam.wantDistance - this.cam.distance) * 0.07;
  }

  // Both callers consume the result immediately, so a shared scratch keeps the
  // per-frame allocation count at zero where the rest of the draw path is.
  eye(out = this._camEye) {
    if (this.cameraMode === 'forward') return this.forwardEye(out);
    const { focus, yaw, pitch, distance } = this.cam;
    const cp = Math.cos(pitch);
    out[0] = focus[0] + Math.cos(yaw) * cp * distance;
    out[1] = focus[1] + Math.sin(pitch) * distance;
    out[2] = focus[2] + Math.sin(yaw) * cp * distance;
    return out;
  }

  // ----------------------------------------------------------- viewscreen

  /** 'orbit' | 'forward'. Unknown values are ignored rather than obeyed. */
  setCameraMode(mode) {
    if (mode !== 'orbit' && mode !== 'forward') return this.cameraMode;
    if (mode === this.cameraMode) return mode;
    this.cameraMode = mode;
    // A mode change resets the pan and the magnification. Coming back to the
    // screen half-turned and zoomed in on nothing is disorienting, and the
    // player has no obvious way to discover why the bow is not ahead.
    this.look.yaw = 0; this.look.pitch = 0;
    this.look.targetYaw = 0; this.look.targetPitch = 0;
    this.magnification = 1;
    return mode;
  }

  toggleCameraMode() {
    return this.setCameraMode(this.cameraMode === 'forward' ? 'orbit' : 'forward');
  }

  /** 1× to 12×, which is about the useful range before a planet is a wall. */
  setMagnification(m) {
    this.magnification = clamp(m, 1, 12);
    return this.magnification;
  }

  /**
   * How far off the bow the screen may be pointed.
   *
   * Slaved in a fight and free when parked. The distinction is not decoration:
   * a screen that can spin freely while somebody is shooting at you loses the
   * one thing the viewscreen is *for*, which is seeing what you are aimed at.
   * Parked, there is no bow-relative anything to lose, and being able to look
   * around is the whole reason to open the screen at all.
   */
  get panLimit() {
    return this.freeLook ? Math.PI : 0.62;
  }

  panLook(dYaw, dPitch) {
    const lim = this.panLimit;
    this.look.targetYaw = this.freeLook
      ? this.look.targetYaw + dYaw
      : clamp(this.look.targetYaw + dYaw, -lim, lim);
    this.look.targetPitch = clamp(this.look.targetPitch + dPitch, -0.5, 0.5);
  }

  /** Point the screen back down the bow — the "steady as she goes" reset. */
  centreLook() {
    this.look.targetYaw = 0;
    this.look.targetPitch = 0;
  }

  /**
   * The camera position for the viewscreen: forward of the bow, slightly high.
   *
   * Ahead of the hull rather than inside it, because the player's own ship is
   * not drawn in this mode and a camera sitting at the centre of an invisible
   * saucer would put the near plane through geometry that is about to be drawn
   * — the nacelles, in particular, which stick out behind.
   */
  forwardEye(out = vec3()) {
    const ship = this.playerShip;
    const nose = noseOf(ship, this._nose);
    // A floor as well as a fraction. At true scale the fleet spans 130:1 — a
    // seven-unit runabout to an 869-unit Borg cube — and a lead that is purely
    // proportional puts the camera inside a small ship's own hull.
    const lead = Math.max(46, (this.hullReach ?? 90) * 1.35);
    out[0] = (ship?.x ?? 0) + nose[0] * lead;
    out[1] = (ship?.z ?? 0) + nose[1] * lead + 12;
    out[2] = (ship?.y ?? 0) + nose[2] * lead;
    return out;
  }

  /** Where the viewscreen is looking: the bow, rotated by the pan. */
  forwardTarget(out = vec3()) {
    const eye = this.forwardEye(this._eyeTmp);
    const nose = noseOf(this.playerShip, this._nose);

    // Yaw about world up, then pitch in the plane that contains it. Doing the
    // yaw in world space rather than ship space is what keeps a rolling hull
    // from rolling the screen with it — the viewscreen is gyro-stabilised, and
    // a picture that tilts every time the helm banks is unwatchable.
    const cy = Math.cos(this.look.yaw);
    const sy = Math.sin(this.look.yaw);
    const fx = nose[0] * cy - nose[2] * sy;
    const fz = nose[0] * sy + nose[2] * cy;
    const flat = Math.hypot(fx, fz) || 1;
    const fy = nose[1] + Math.tan(clamp(this.look.pitch, -1.2, 1.2)) * flat;

    const reach = 8000;
    out[0] = eye[0] + fx * reach;
    out[1] = eye[1] + fy * reach;
    out[2] = eye[2] + fz * reach;
    return out;
  }

  /** Ease the pan toward where the finger put it, and spring back when slaved. */
  settleLook(dt = 1 / 60) {
    if (!this.freeLook) {
      // A slaved screen drifts back to the bow on its own. This is why you can
      // glance sideways during a fight without having to remember to look back.
      const spring = Math.min(1, dt * 0.8);
      this.look.targetYaw += (0 - this.look.targetYaw) * spring;
      this.look.targetPitch += (0 - this.look.targetPitch) * spring;
    }
    const k = Math.min(1, dt * 9);
    this.look.yaw += (this.look.targetYaw - this.look.yaw) * k;
    this.look.pitch += (this.look.targetPitch - this.look.pitch) * k;
  }

  // ---------------------------------------------------------------- draw

  render(engagement, alpha = 0, dt = 1 / 60) {
    void alpha;
    const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
    const rect = this.canvas.getBoundingClientRect();
    const dpr = globalThis.devicePixelRatio ?? 1;
    const { aspect } = this.renderer.resize(rect.width || 320, rect.height || 320, dpr);

    if (!this.renderer.beginFrame()) return;
    if (!engagement) {
      // The labels, the hull bars and the target reticle live on a separate 2D
      // canvas that keeps whatever was last drawn on it. `beginFrame` clears
      // the GL side and this returned before ever reaching `drawOverlay`, so
      // the final frame of a battle — the dead fleet's names and health, and a
      // reticle locked to a ship that no longer exists — stayed painted over
      // an empty plot until something else happened to redraw it.
      this.clearOverlay(rect);
      return;
    }

    this.playerShip = engagement.player;
    this.hullReach = hullScale(engagement.player?.classId) * 1.1;
    this.freeLook = false;
    this.frame(engagement);
    this.lastShips = [engagement.player, ...engagement.hostiles, ...engagement.allies]
      .filter(Boolean);

    this.setupCamera(aspect, dt);

    this.drawEnvironment();
    if (this.vistaSource) this.drawVista(dt);
    // Rock before ships, gas after: solid geometry wants the depth buffer
    // filled behind it, and a translucent shell wants everything it is meant
    // to be in front of already drawn.
    this.drawTerrain(engagement.arena, 'solid');
    for (const ship of this.lastShips) {
      // Your own hull is not on your own viewscreen. The camera is standing
      // where the bridge is; there is nothing in front of it but space.
      if (ship.destroyed) continue;
      if (this.cameraMode === 'forward' && ship === engagement.player) continue;
      this.drawShip(ship, ship === engagement.target);
    }
    // After the hulls, so a wedge lies over the grid and under nothing that
    // matters, and once — for the player only.
    if (engagement.player && !engagement.player.destroyed) {
      this.drawArcs(engagement.player, engagement);
    }
    this.drawEffects(engagement);
    this.drawTerrain(engagement.arena, 'cloud');

    this.stats.drawCalls = this.renderer.drawCalls;
    this.stats.triangles = this.renderer.triangles;
    this.stats.frames++;
    this.stats.lastMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;

    this.drawOverlay(engagement, rect);
  }

  /**
   * The viewscreen with nobody shooting: a parked ship, a system, and a sky.
   *
   * Separate entry point rather than a branch inside `render` because the two
   * take different arguments and nothing else about them is shared. The 2D
   * fallback view has no equivalent and does not need one — it is a tactical
   * plot, and there is no tactical situation to plot.
   */
  renderVista(game, dt = 1 / 60) {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
    const rect = this.canvas.getBoundingClientRect();
    const dpr = globalThis.devicePixelRatio ?? 1;
    const { aspect } = this.renderer.resize(rect.width || 320, rect.height || 320, dpr);
    if (!this.renderer.beginFrame()) return;

    const sys = game?.location;
    if (!sys) return;

    this.setVista(sys.id, sys.type);
    this.lastShips = [];
    this.freeLook = true;
    this.hullReach = hullScale(game.ship?.classId) * 1.1;

    // Parked, the camera is at the origin looking wherever the player has
    // turned it — the ship's combat coordinates are meaningless out of a fight
    // and would put the viewscreen somewhere arbitrary in the vista.
    this.playerShip = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 };
    this.setupCamera(aspect, dt);

    this.drawEnvironment(false);
    this.drawVista(dt);

    this.stats.drawCalls = this.renderer.drawCalls;
    this.stats.triangles = this.renderer.triangles;
    this.stats.frames++;
    this.stats.lastMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;

    this.drawVistaOverlay(game, rect);
  }

  /** Build the projection and view matrices for whichever camera is active. */
  setupCamera(aspect, dt) {
    let eye;
    if (this.cameraMode === 'forward') {
      this.settleLook(dt);
      // Magnification is a narrower lens, not a nearer camera. Dividing the
      // field of view is what a real optical zoom does and it keeps the
      // parallax honest — a dolly would slide the ship through its own hull.
      perspective(fovFor(aspect) / this.magnification, aspect, 2, 40000, this._proj);
      eye = this.forwardEye(this._eyeTmp);
      lookAt(eye, this.forwardTarget(this._look), vec3(0, 1, 0), this._view);
    } else {
      perspective(52 * DEG, aspect, 5, 40000, this._proj);
      eye = this.eye();
      lookAt(eye, this.cam.focus, vec3(0, 1, 0), this._view);
    }
    multiply(this._proj, this._view, this._viewProj);
    this.renderer.setCamera(this._viewProj);
    // Where the camera is, which this view had never told the renderer.
    //
    // `uEye` is set in exactly one place — `setLighting` — and this class did
    // not call it at all, so the tactical plot ran on `beginFrame`'s defaults
    // and the specular half-vector had no eye to work from. Nothing showed,
    // because nothing here asked for a highlight either; enabling one without
    // this line would have computed it against the origin and looked subtly
    // wrong rather than failing loudly.
    //
    // Everything else is left at the frame default deliberately: `key` and
    // `fill` are omitted so they keep `beginFrame`'s vacuum directions, and
    // `gloss` stays 0 for the scene as a whole. A hull asks for its own.
    this.renderer.setLighting({ eye });
  }

  /** Remember which system's scenery to draw. Cheap; safe to call per frame. */
  setVista(systemId, type) {
    if (!systemId) { this.vistaSource = null; return null; }
    if (this.vistaSource?.systemId !== systemId) {
      this.vistaSource = vista(systemId, type);
      // Open the screen pointed at something worth seeing rather than at an
      // arbitrary patch of empty sky.
      const f = this.vistaSource.focus;
      // Only when the screen is free to look.
      //
      // A bearing is anywhere in the full circle, and this wrote it straight
      // into the pan — past the `panLimit` clamp the rest of this class
      // enforces, and without asking whether a fight was on. Opening the main
      // viewer during a battle therefore snapped the screen up to 171 degrees
      // off the bow toward whichever planet happened to be nearest, and the
      // slaved spring took about five seconds to bring it back, with the enemy
      // showing only as an arrow on the bezel for all of it. That is precisely
      // what the pan limit exists to prevent.
      if (f && this.freeLook) {
        // The pan rotates the bow by +yaw about world up, and at rest the bow
        // is +x — so the yaw that lands on a body IS its bearing. It was
        // negated here at first, which opened the viewer aimed at the exact
        // opposite patch of empty sky from the planet it had chosen.
        const want = bearingOf(f);
        const limit = this.panLimit ?? Math.PI;
        this.look.targetYaw = Math.max(-limit, Math.min(limit, want));
        this.look.yaw = this.look.targetYaw;
      }
    }
    return this.vistaSource;
  }

  /**
   * The scenery: a primary and its worlds, drawn once each — if they are in
   * front of the camera.
   *
   * The cull is not an optimisation, it is a budget. A body sphere is 440
   * triangles, the bodies are spread over the full circle so most of them are
   * behind you at any moment, and the harness holds the whole frame to 8,000
   * triangles with a 3,120-triangle starfield and six hostiles already in it.
   * Drawing all of them would spend the ships' budget on scenery nobody can
   * see. The hard cap of four never actually bites — the placement spreads
   * bodies across the full circle and the lens is 82 degrees wide — but the
   * frame budget must hold in the worst case, not the typical one.
   */
  drawVista(dt) {
    const v = this.vistaSource;
    if (!v) return;
    this.vistaSpin += dt;

    // Camera forward, from the two points the view matrix was built from —
    // whichever camera built it.
    const eye = this.eye(this._eyeTmp);
    const at = this.cameraMode === 'forward' ? this.forwardTarget(this._look) : this.cam.focus;
    let fx = at[0] - eye[0]; let fy = at[1] - eye[1]; let fz = at[2] - eye[2];
    const flen = Math.hypot(fx, fy, fz) || 1;
    fx /= flen; fy /= flen; fz /= flen;

    // The primary. Everything else in the sky is lit by it.
    const star = v.bodies.find((x) => x.kind === 'star') ?? null;

    let drawn = 0;
    for (const b of v.bodies) {
      if (drawn >= VISTA_DRAW_CAP) break;
      let dx = b.x - eye[0]; let dy = b.y - eye[1]; let dz = b.z - eye[2];
      const d = Math.hypot(dx, dy, dz) || 1;
      // Half-angle to the edge of the body, so a world that is mostly off to
      // the side still draws the sliver of it that is on screen.
      const slack = Math.min(0.75, b.radius / d);
      if ((dx * fx + dy * fy + dz * fz) / d < 0.16 - slack) continue;

      quatFromEuler(0, b.spin * this.vistaSpin, 0, this._quat);
      this._pos[0] = b.x; this._pos[1] = b.y; this._pos[2] = b.z;
      compose(this._pos, this._quat, b.radius, this._model);
      // Lit by the system's own primary, so the terminator on a world out there
      // is not drawn — it is where pointing the light at the actual star puts
      // it. Same argument the orbit pass in firstperson.js already makes, and
      // the reason the [1.5, 1.5, 1.5] lift in vista.js could go: that existed
      // to rescue a mid-tone palette from a key aimed at nothing in particular,
      // by multiplying every channel past 1.0 and clipping the bright half.
      //
      // Per body, because each one is somewhere different relative to the star.
      // Four of them at most — VISTA_DRAW_CAP — so this is at worst four sets
      // of uniform writes and not one extra draw call.
      if (star && b !== star) {
        this.renderer.setLighting({
          key: [star.x - b.x, star.y - b.y, star.z - b.z],
          fill: [b.x - star.x, b.y - star.y, b.z - star.z],
          ambient: VACUUM_LIGHT.ambient,
          keyPower: VACUUM_LIGHT.keyPower,
          eye,
        });
      }
      this.renderer.draw(`body:${b.kind}:${b.seed ?? 0}`, bodyMesh(b.kind, b.seed ?? 0), {
        model: this._model,
        normalMatrix: normalMatrix(this._model, this._normal),
        emissive: b.emissive,
        tint: b.tint,
        // Scenery is meant to be far away. Fogging it against a falloff tuned
        // for a 3,000-unit knife fight is what made the first planet render as
        // a black disc with a rim.
        fogFar: 90000,
      });
      drawn++;
    }
    // Back to vacuum, and this is load-bearing rather than tidy: `drawVista`
    // runs BEFORE the hulls in `render`, so without it every ship in the fight
    // would be lit by whichever planet happened to be drawn last.
    if (star && drawn) this.renderer.setLighting({ ...VACUUM_LIGHT, eye });
    this.stats.bodiesDrawn = drawn;
  }

  drawEnvironment(withGrid = true) {
    // The starfield rides with the camera so it never comes into reach.
    const stars = starfield();
    compose(this.eye(), quat(), 1, this._model);
    this.renderer.draw('stars', stars, {
      model: this._model,
      normalMatrix: normalMatrix(this._model, this._normal),
      emissive: 1,
      tint: [1, 1, 1],
      // The sky is not a distant object in the scene, it is the backdrop. It
      // sits at four times the engagement volume, so the old fixed falloff had
      // it permanently crushed to a third of its brightness.
      fogFar: 1e9,
    });

    // The reference grid is a tactical aid, not a thing in space. On the
    // viewscreen it would be a glowing floor stretching to the horizon, which
    // is a lie about what is out there.
    if (!withGrid || this.cameraMode === 'forward') return;

    identity(this._model);
    this.renderer.draw('grid', gridMesh(), {
      model: this._model,
      normalMatrix: normalMatrix(this._model, this._normal),
      emissive: 1,
      alpha: 0.55,
      tint: [1, 1, 1],
    });
  }

  /**
   * The terrain of the engagement, as geometry.
   *
   * One draw per feature, which is the same budget a ship costs — sixteen
   * rocks is sixteen draws, and the measurement in the hull budget says this
   * renderer is bound by draw calls. That is the ceiling on how much terrain
   * a fight can have, and it is why `ARENA_KINDS` counts features in the
   * teens rather than the hundreds.
   *
   * Rock and gas are drawn in separate passes because they want opposite
   * things from the depth buffer — see the call sites.
   */
  drawTerrain(arena, pass) {
    if (!arena?.features?.length) return;
    for (let i = 0; i < arena.features.length; i++) {
      const f = arena.features[i];
      if (f.type !== pass) continue;
      this._pos[0] = f.x; this._pos[1] = f.z; this._pos[2] = f.y;
      if (f.type === 'solid') {
        // A fixed tumble per rock rather than an animated one: a debris field
        // that spins is a debris field whose collision spheres are lying, and
        // the spheres are what the simulation actually tests against.
        quatFromEuler(i * 0.7, i * 1.3, i * 2.1, this._quat);
        compose(this._pos, this._quat, f.r, this._model);
        this.renderer.draw(`rock:${i & 7}`, rockMesh(i), {
          model: this._model,
          normalMatrix: normalMatrix(this._model, this._normal),
          tint: [1, 1, 1],
          fogFar: VOLUME * 4,
        });
        continue;
      }
      compose(this._pos, quat(), f.r, this._model);
      this.renderer.draw('cloud', cloudMesh(), {
        model: this._model,
        normalMatrix: normalMatrix(this._model, this._normal),
        emissive: 1,
        // Fainter the bigger it is, and DOUBLED by the two-sided shell.
        //
        // A Mutara-sized cloud is 2,400 units across with the entire battle
        // inside it, so anything you could call a colour at that size is a
        // wall between the player and the fight; a 500-unit plasma patch is a
        // place on the board and has to look like one. The first version of
        // this was `28 / (r / 40)`, which is above the ceiling for every
        // radius in ARENA_KINDS — it clamped to 0.16 for the 2,400-unit
        // nebula and the 420-unit patch alike, which is to say it was a
        // constant wearing an expression.
        //
        // `cloudMesh` draws both windings so a cloud you are standing in does
        // not vanish, so whatever is set here arrives on screen twice.
        alpha: clamp(0.14 - f.r / 22000, 0.030, 0.080),
        tint: arena.tint ?? [0.8, 0.7, 1.0],
        fogFar: 1e9,
      });
    }
  }

  /**
   * The wedges a captain's own guns cover.
   *
   * Firing arcs have been simulated in three dimensions since the third axis
   * went in — `inArc` tests a real cone, per mount, and it decides every shot
   * in the game — and they have never once been drawn. The single most
   * important tactical fact in the simulation was invisible, which is why
   * "come about" was vague advice rather than an instruction with a picture
   * behind it.
   *
   * The player's mounts only. Arcs on every hostile is not information, it is
   * a floor covered in cones.
   *
   * State is carried by brightness, so the same picture says three things at
   * once: bright where the guns are ready and the target is in them, dim while
   * they recharge, and a bare outline where a bank has been shot out.
   */
  drawArcs(ship, engagement) {
    if (!this.showArcs || this.cameraMode === 'forward') return;
    const target = engagement?.target ?? null;
    const dir = target ? ship.directionTo(target) : null;
    for (const w of ship.weapons ?? []) {
      const deg = w.degrees ?? 360;
      // Only arcs that are actually a RESTRICTION get drawn.
      //
      // A Constitution's phaser banks cover 250 and 200 degrees; drawn
      // together they overlap into a near-complete ring round the hull, which
      // fills the frame and tells a captain nothing they could act on. What is
      // worth seeing is the narrow mount — the 90-degree torpedo tube, a
      // Defiant's cannons — because that is the one that makes "come about" an
      // instruction rather than a mood. Half the sky is the cut-off.
      if (deg > 180) continue;
      // A fixed radius near the hull, NOT the mount's real range.
      //
      // Drawn at range, the band sat 88 to 100 per cent of 620 units out — far
      // outside the frame at any zoom a captain actually fights at, so the
      // first two attempts drew nothing anyone could see. What an arc has to
      // answer is WHICH WAY the guns point and whether the target is inside
      // them; the range readout on the target panel already answers how far.
      // So this is a compass rose on the hull, sized to the hull.
      const range = Math.max(90, this.hullReach * 15);
      // The wedge is built centred on the hull's own +x, so it has to be
      // turned to the mount's bearing before the ship's orientation is
      // applied. Up in world space is +y, which is the simulation's z.
      quatAxisAngle([0, 1, 0], -(w.facing ?? 0) * Math.PI / 180, this._arcQuat);
      quatMultiply(orientationOf(ship, this._quat), this._arcQuat, this._arcQuat);
      compose(worldOf(ship, this._pos), this._arcQuat, range, this._model);
      const bears = dir ? inArc(dir, w) : false;
      const dead = w.enabled === false;
      const ready = !dead && (w.cooldown ?? 0) <= 0;
      this.renderer.draw(`arc:${deg}`, arcMesh(deg), {
        model: this._model,
        normalMatrix: normalMatrix(this._model, this._normal),
        emissive: 1,
        alpha: dead ? 0.12 : (ready && bears ? 0.50 : ready ? 0.28 : 0.16),
        tint: dead ? [0.7, 0.25, 0.2] : (bears ? [0.6, 0.85, 1.0] : [0.4, 0.55, 0.7]),
      });
    }
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
      normalMatrix: normalMatrix(this._model, this._normal),
      tint,
      alpha: ship.cloaked ? 0.22 : 1,
      gloss: HULL_GLOSS,
      shine: HULL_SHINE,
      rim: HULL_RIM,
    });

    // Drop line to the grid: this is what makes altitude legible.
    const alt = ship.z ?? 0;
    if (Math.abs(alt) > 1) {
      this._pos[1] = Math.min(0, alt);
      compose(this._pos, quat(), 1, this._model);
      this._model[5] = Math.abs(alt);      // stretch the unit line to the drop
      this.renderer.draw('dropline', dropLineMesh(), {
        model: this._model,
        normalMatrix: normalMatrix(this._model, this._normal),
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
        normalMatrix: normalMatrix(this._model, this._normal),
        emissive: 1,
        alpha: 0.04 + 0.07 * (ship.shieldPct ?? 0),
        tint: p.glow,
      });
    }
  }

  /**
   * Beams, torpedoes, impacts and explosions.
   *
   * The drawing itself is `src/gfx/effects.js`, because the main viewer needs
   * exactly the same picture against a different camera and two copies of it
   * would mean fixing a beam in one of two places.
   */
  drawEffects(engagement) {
    return drawCombatEffects(this.renderer, engagement);
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

  /** Wipe the 2D chrome. Used when there is nothing left to label. */
  clearOverlay(rect) {
    this.overlay.style.width = `${rect.width}px`;
    this.overlay.style.height = `${rect.height}px`;
    const { ctx, width, height } = fitCanvas(this.overlay);
    ctx.clearRect(0, 0, width, height);
  }

  /** LCARS chrome: names, hull bars, the target reticle. Plain 2D, on top. */
  drawOverlay(engagement, rect) {
    this.overlay.style.width = `${rect.width}px`;
    this.overlay.style.height = `${rect.height}px`;
    const { ctx, width, height } = fitCanvas(this.overlay);
    ctx.clearRect(0, 0, width, height);

    const forward = this.cameraMode === 'forward';

    // Where a name has already been written this frame.
    //
    // The plot draws hulls about 260 times oversized against the distances
    // between them, and it has to — at true scale a 289-metre ship 600 km away
    // is a fraction of a pixel. The bill comes due at close quarters, and the
    // worst of it is not the hulls: two contacts fifty kilometres apart project
    // to nearly the same point, and their two names were written on the SAME
    // PIXEL, one over the other, both illegible. Measured over twelve seeded
    // duels per matchup, ships pass close enough for that on 3% (Constitution
    // against a D7) to 11% (Excelsior against a Negh'Var) of combat ticks.
    //
    // Moving a label is not moving a ship. It sits 32 pixels above the hull
    // already, so it is an annotation with an implied leader, and nothing about
    // where either contact IS changes — which is the whole reason the fix is
    // here and not in the geometry. See RESEARCH §60 for the three fixes to
    // the hulls themselves that were built, measured and thrown away.
    const taken = [];

    for (const ship of this.lastShips) {
      if (ship.destroyed) continue;
      if (forward && ship.isPlayer) continue;
      const p = project(worldOf(ship, this._pos), this._viewProj);

      // On the viewscreen a contact that is not on screen still matters, and
      // "there is nothing to see" is the most dangerous thing a screen can
      // imply while a bird-of-prey comes up behind you. An off-screen contact
      // gets an arrow on the bezel pointing at where it actually is.
      if (forward && (!p || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1)) {
        this.drawEdgeMarker(ctx, ship, engagement, width, height);
        continue;
      }
      if (!p || p.z > 1) continue;
      const sx = (p.x * 0.5 + 0.5) * width;
      const sy = (1 - (p.y * 0.5 + 0.5)) * height;
      if (sx < -80 || sx > width + 80 || sy < -60 || sy > height + 60) continue;

      const isTarget = ship === engagement.target;
      const isPlayer = ship.isPlayer;
      // A ship on your side is not drawn in the colour of a ship shooting at
      // you. Nothing in the game made an ally until the distress call did, so
      // the only two cases this ever had were "me" and "them", and the relief
      // arrived labelled as a hostile.
      const isFriend = isPlayer || engagement.allies?.includes(ship);
      const accent = isFriend ? '#9cf' : isTarget ? '#ff9a3c' : '#e5533d';

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

      // Lifted clear of any name already written near this spot. Upward, so a
      // label never ends up between its own hull and the grid, and capped —
      // eight contacts stacked on one pixel is a picture no amount of nudging
      // rescues, and a runaway loop is worse than an overlap.
      let ly = sy - 32;
      for (let i = 0; i < 8; i++) {
        if (!taken.some((t) => Math.abs(t.x - sx) < 46 && Math.abs(t.y - ly) < 15)) break;
        ly -= 15;
      }
      // `anchor` is where the name WOULD have gone. Kept because it is the
      // only way to tell "these two labels do not collide" from "these two
      // labels were never near each other" — which is the difference between
      // a test and a test that passes for the wrong reason. Read by
      // tools/verify-app.mjs.
      taken.push({ name: ship.name, x: sx, y: ly, anchor: sy - 32 });

      ctx.fillStyle = accent;
      ctx.font = '600 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(ship.name, sx, ly);

      // Hull bar, which travels with the name it belongs to.
      const w = 34;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(sx - w / 2, ly + 4, w, 3);
      ctx.fillStyle = ship.hullPct > 0.5 ? '#7ed957' : ship.hullPct > 0.25 ? '#d9a441' : '#e5533d';
      ctx.fillRect(sx - w / 2, ly + 4, w * clamp(ship.hullPct, 0, 1), 3);
    }

    this.lastLabels = taken;
  }

  /**
   * An arrow on the edge of the screen for a contact that is not on it.
   *
   * Screen-space projection is useless here: a point behind the camera projects
   * to a mirrored position in front of it, which puts the arrow for a ship
   * astern on the wrong side of the screen. So the direction is computed in
   * *view* space instead, where "behind" is unambiguous and the sign of the
   * horizontal component still says which way to turn.
   */
  drawEdgeMarker(ctx, ship, engagement, width, height) {
    const w = worldOf(ship, this._pos);
    const eye = this.forwardEye(this._eyeTmp);
    const dx = w[0] - eye[0];
    const dy = w[1] - eye[1];
    const dz = w[2] - eye[2];

    const m = this._view;
    // View-space direction. Column-major mat4, so a row of the rotation block.
    const vx = m[0] * dx + m[4] * dy + m[8] * dz;
    const vy = m[1] * dx + m[5] * dy + m[9] * dz;
    const vz = m[2] * dx + m[6] * dy + m[10] * dz;   // negative is in front

    // Angle around the screen: +x right, +y up, and a point directly behind
    // resolves to straight down rather than to a division by zero.
    const ang = (Math.abs(vx) < 1e-6 && Math.abs(vy) < 1e-6 && vz > 0)
      ? Math.PI / 2
      : Math.atan2(-vy, vx);

    const inset = 18;
    const rx = Math.max(10, width / 2 - inset);
    const ry = Math.max(10, height / 2 - inset);
    // Project the angle onto the rectangle rather than a circle, so the arrow
    // rides the actual edge of a wide screen instead of an inscribed ellipse.
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const scale = 1 / Math.max(Math.abs(c) / rx, Math.abs(s) / ry);
    const sx = width / 2 + c * scale;
    const sy = height / 2 + s * scale;

    const isTarget = ship === engagement?.target;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    ctx.fillStyle = isTarget ? '#ff9a3c' : ship.faction === 'federation' ? '#9cf' : '#e5533d';
    ctx.globalAlpha = vz > 0 ? 0.55 : 0.9;   // dimmer when it is behind you
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * The viewscreen with no engagement: where we are, and where we are looking.
   *
   * A bearing readout rather than a compass rose, because there is no north in
   * space and pretending otherwise is worse than saying nothing. The number is
   * relative to the ship's own bow, which is the only reference that exists.
   */
  drawVistaOverlay(game, rect) {
    this.overlay.style.width = `${rect.width}px`;
    this.overlay.style.height = `${rect.height}px`;
    const { ctx, width, height } = fitCanvas(this.overlay);
    ctx.clearRect(0, 0, width, height);
    if (this.cameraMode !== 'forward') return;

    const sys = game?.location;
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(232, 163, 23, 0.85)';
    ctx.fillText(String(sys?.name ?? '').toUpperCase(), 12, 20);

    const deg = ((-this.look.yaw * 180 / Math.PI) % 360 + 360) % 360;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(42, 168, 168, 0.85)';
    const mag = this.magnification > 1.05 ? ` · MAG ${this.magnification.toFixed(1)}×` : '';
    ctx.fillText(`BEARING ${deg.toFixed(0).padStart(3, '0')}${mag}`, width - 12, 20);

    // A faint centre tick. Without it there is no way to tell a slow pan from a
    // still image of empty space.
    ctx.strokeStyle = 'rgba(230, 230, 223, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 9, height / 2);
    ctx.lineTo(width / 2 - 3, height / 2);
    ctx.moveTo(width / 2 + 3, height / 2);
    ctx.lineTo(width / 2 + 9, height / 2);
    ctx.stroke();
  }

  dispose() {
    this._detach?.();
    // Only if this view made it. A shared renderer outlives every view that
    // draws through it and is torn down by whoever owns the canvas.
    if (this.ownsRenderer !== false) this.renderer.dispose();
    this.overlay.remove();
  }
}
