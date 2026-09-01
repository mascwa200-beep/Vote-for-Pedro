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
  quatFromTo, quatAxisAngle, quatFromEuler,
} from '../gfx/math.js';
import { roomMeshes, officerMesh, officerStandsAt, officerFaces, PALETTE } from '../gfx/room.js';
import {
  starfield, bodyMesh, warpfield, worldMesh, limbMesh, WARP_LENGTH, VOLUME,
} from '../gfx/scene.js';
import {
  orbitFrame, orbitPeriod, rotationPeriod, angularRadius, ORBIT_TIME_SCALE,
} from '../world/orbit.js';
import { hullMesh, hullScale } from '../gfx/blueprint.js';
import { vista, fovFor, noseOf, joltShake, joltTint } from '../gfx/vista.js';
import { ROOMS } from '../world/interiors.data.js';
import { fitCanvas } from './touch.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Eye height. A person standing, not a camera on a tripod. */
export const EYE_HEIGHT = 1.62;

/** Seated in the command chair, which is lower and a step down into the well. */
export const SEATED_HEIGHT = 1.18;

/**
 * How long a hit stays on the screen and in the deck plates.
 *
 * Half a second. A phaser strike is an event, not a weather condition — hold it
 * for two and a running fight becomes a strobe with a bridge behind it.
 */
export const JOLT_SECONDS = 0.55;

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
    // Scratch for the normal matrix. `normalMatrix` allocates a fresh
    // Float64Array when it is not given somewhere to write, and it is called
    // once per draw call — so the one part of this renderer documented as
    // allocation-free was producing nine doubles of garbage per hull, per
    // frame. The uniform is uploaded synchronously, so one buffer is safe.
    this._normal = new Float64Array(9);
    this._nose = vec3();
    this._screenVP = mat4();
    // How far the warp field has streamed past. Wraps every WARP_LENGTH, which
    // is why the mesh carries a twin of every streak one period away.
    this.warpPhase = 0;
    // Where the ship is around the world it is orbiting, in radians, and how
    // far that world has turned on its own axis. Both advance in real time and
    // neither is saved: the ship is somewhere on a circle it has been going
    // round for hours, and which point of that circle is not a fact worth
    // keeping. The ORBIT they are about is saved, in `Game.orbit`.
    this.orbitPhase = 0;
    this.worldSpin = 0;
    // Who is mid-report, and how much of the turn is left. Keyed by station id
    // and decayed every frame, so an order acknowledged three decks away has
    // worn off by the time the captain walks back in.
    this.speaking = new Map();
    this.lastRoom = null;
    this.lastWalker = null;
    // The last hit, decaying. `level` runs 1 -> 0 over JOLT_SECONDS; `hull`
    // says whether it got through the shields, which decides the colour.
    // `shake` is honoured separately so a player who has asked for less motion
    // still SEES the hit and simply is not thrown about by it.
    this.jolt = { level: 0, hull: false };
    this.shake = true;
    this._up = vec3();
    this._look = vec3();

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

  /**
   * Where the eyes are: the walker's feet plus a person's height.
   *
   * Seated, the eye sits BACK from the walker's position by a head's depth.
   * That is not a fudge — a person in a chair has their eyes behind the seat
   * centre, and the practical effect is that the chair's own arm panels come
   * into the bottom of frame. Sitting in a chair you cannot see is the oldest
   * tell that a first-person camera is a floating point rather than a body.
   */
  eyeOf(walker, out = this._eye) {
    if (walker.seated) {
      out[0] = walker.x - Math.sin(walker.yaw) * 0.16;
      out[1] = SEATED_HEIGHT;
      out[2] = walker.z - Math.cos(walker.yaw) * 0.16;
      return out;
    }
    out[0] = walker.x;
    out[1] = EYE_HEIGHT;
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
    // Kept because the warp field streams in real time and needs to know how
    // much of it has passed since the last frame.
    this.lastDt = Math.min(0.1, Math.max(0, dt));
    // A hit is over in half a second. Long enough to register, short enough
    // that a running fight is not a strobe.
    if (this.jolt.level > 0) {
      this.jolt.level = Math.max(0, this.jolt.level - this.lastDt / JOLT_SECONDS);
    }
    this.stats.jolt = this.jolt.level;

    // A glance over the shoulder lasts about three seconds, which is roughly
    // how long it takes to say "aye, Captain" and go back to work.
    if (this.speaking.size) {
      for (const [id, t] of this.speaking) {
        const next = t - this.lastDt / 3.0;
        if (next <= 0) this.speaking.delete(id);
        else this.speaking.set(id, next);
      }
    }
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
    this.lastRoom = room;
    this.lastWalker = walker;

    // Interior camera. A wider lens than the tactical plot, because a room at
    // arm's length through a 52-degree window is a keyhole.
    perspective(fovFor(aspect, 88), aspect, 0.06, 400, this._proj);
    // The deck moves when the ship is hit. Applied to the eye and the target
    // together, so the room lurches under a steady gaze rather than the head
    // whipping round — the camera is a person standing on a floor that just
    // shifted, not a person looking away.
    const kick = this.joltOffset();
    const eye = this.eyeOf(walker);
    const at = this.lookAtOf(walker);
    if (kick !== 0) {
      eye[1] += kick;
      at[1] += kick;
      eye[0] += kick * 0.4;
      at[0] += kick * 0.4;
    }
    lookAt(eye, at, vec3(0, 1, 0), this._view);
    multiply(this._proj, this._view, this._viewProj);

    // A room, not a vacuum. The ceiling ring is the light source, so the key
    // comes straight down — but a bridge with pale grey walls bouncing at each
    // other has almost no true shadow in it, which is what the high ambient
    // says. At the vacuum defaults this room rendered as a black box.
    this.renderer.setLighting({
      key: [0.15, 1.0, 0.1], fill: [-0.3, 0.25, -0.9],
      ambient: 0.62, keyPower: 0.44,
      eye: this.eyeOf(walker), gloss: 0.22,
    });

    // Pass one: space, inside the screen.
    const screen = room.viewscreen ? this.screenRect(room, width, height) : null;
    this.stats.screenRect = screen;
    if (screen) this.drawThroughScreen(game, screen, aspect, height);

    // Pass two: the room, over the top of it.
    //
    // The depth buffer is reset inside the aperture first, while the scissor
    // is still set — so the room is in front of the exterior by construction
    // rather than by arithmetic. It used to be by arithmetic: the exterior was
    // squeezed into the far 0.1% of the depth range, which needs the buffer to
    // have enough bits to tell 0.99999 from 1.0. On a 16-bit depth buffer it
    // does not, every fragment of space landed on exactly the cleared value,
    // and the depth test threw all of it away. The starfield, the warp
    // streaks, the world in orbit with its terminator, the hostiles in a
    // fight: rendered every frame, discarded every frame.
    if (screen) this.renderer.clearDepth();
    this.renderer.clearScissor();
    this.renderer.resetViewport();
    this.renderer.setDepthRange(0, 1);
    this.renderer.setLighting({
      key: [0.15, 1.0, 0.1], fill: [-0.3, 0.25, -0.9],
      ambient: 0.62, keyPower: 0.44,
      eye: this.eyeOf(walker), gloss: 0.22,
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
  /**
   * The world the ship is orbiting, and where it has got to around it.
   *
   * Both phases advance here rather than in `render`, because this is the only
   * place that knows whether the orbit is being drawn at all — and a phase that
   * kept advancing behind an engagement would jump when the fight ended.
   */
  orbitWorld(game) {
    const body = game.orbitBody;
    if (!body) return null;
    const dt = this.lastDt * ORBIT_TIME_SCALE;
    const TAU = Math.PI * 2;
    this.orbitPhase = (this.orbitPhase + TAU * dt / orbitPeriod(body.kind)) % TAU;
    this.worldSpin = (this.worldSpin + TAU * dt / rotationPeriod(body.kind)) % TAU;
    return { body, frame: orbitFrame(body, this.orbitPhase) };
  }

  /**
   * Where the ship is and what the screen is pointed at, in orbit.
   *
   * The world is DIRECTLY BELOW, not ahead: a camera looking along the orbital
   * track sees nothing but stars. So the axis is tipped down to near straight
   * down, and by a fraction of the world's own angular radius rather than by a
   * fixed number of degrees — which keeps the composition identical whatever
   * the lens is doing. Half a radius puts the top of the limb a quarter of the
   * way up the frame and runs the world off the bottom of it.
   */
  orbitCamera(world, eye, at, tilt) {
    const { frame, body } = world;
    const phi = tilt;
    const cs = Math.cos(phi); const sn = Math.sin(phi);
    for (let i = 0; i < 3; i++) {
      eye[i] = frame.position[i];
      // Down is -up; tipped toward the direction of travel by phi.
      this._look[i] = -frame.up[i] * cs + frame.forward[i] * sn;
      // Camera up is the same rotation applied a quarter turn round: always
      // perpendicular to the view axis, so the picture never gimbals when the
      // ship passes over a pole. `lookAt` with a fixed world up does exactly
      // that, and this camera spends its whole time pointing at the ground.
      this._up[i] = frame.up[i] * sn + frame.forward[i] * cs;
    }
    const reach = body.radius * 8;
    at[0] = eye[0] + this._look[0] * reach;
    at[1] = eye[1] + this._look[1] * reach;
    at[2] = eye[2] + this._look[2] * reach;
  }

  drawThroughScreen(game, screen, aspect, height = 0) {
    const r = this.renderer;
    r.setScissor(screen.x, screen.y, screen.w, screen.h);
    // The aperture gets its own viewport, so the camera below is built FOR the
    // screen rather than for the canvas and then cropped. Cropping is what it
    // used to do, and it is why the main viewer showed nothing: a 74° cone
    // across the whole canvas, scissored to three per cent of it, is a
    // fourteen-degree window — and a window that narrow onto a sphere of 260
    // stars contains, on average, less than one of them.
    r.setViewport(screen.x, screen.y, screen.w, screen.h);
    const lens = screen.h > 0 ? screen.w / screen.h : aspect;
    // Back to vacuum inside the screen: one hard sun, deep shadow, which is
    // what a hull a thousand kilometres away actually looks like.
    r.setLighting({
      key: [0.55, 0.72, 0.42], fill: [-0.6, -0.2, -0.5],
      ambient: 0.20, keyPower: 0.9, gloss: 0,
    });
    // The whole depth range, so the exterior sorts against itself properly —
    // a planet behind a ship stays behind it. What keeps the ROOM in front of
    // all of it is the depth clear after this pass, not a reserved slice.
    r.setDepthRange(0, 1);

    // A hit costs the picture its sync.
    //
    // Not a new renderer surface: `tint` and `emissive` are already per-draw
    // uniforms, so the whole screen can be pushed toward a colour and toward
    // self-lit for a moment without a framebuffer, a shader change or a second
    // pass. Red-white when something came through the hull, blue-white when the
    // shields took it — which is the one piece of information a captain wants
    // out of a flash and would otherwise have to read off a panel.
    const flash = this.jolt.level > 0 ? this.jolt.level * this.jolt.level : 0;
    const burn = flash > 0 ? joltTint(this.jolt.level, this.jolt.hull) : null;
    const tintOf = (base) => (burn
      ? [base[0] * burn[0], base[1] * burn[1], base[2] * burn[2]]
      : base);
    const emisOf = (base) => (burn ? Math.min(1, base + flash * 0.65) : base);

    const eng = game.engagement;
    const ship = eng?.player;
    const nose = noseOf(ship, this._nose);
    const origin = ship ? [ship.x, ship.z ?? 0, ship.y] : [0, 0, 0];

    // In orbit, and only when nobody is shooting. During an engagement the
    // camera belongs to the fight — hostiles are placed around the origin, and
    // moving the eye ten thousand units out to a planet would take them off the
    // screen at the moment they matter most.
    const world = eng ? null : this.orbitWorld(game);

    // How wide the lens is. Now that the aperture has its own viewport this is
    // the field of view of the SCREEN, which is what a viewscreen's field of
    // view means, rather than a fraction of the canvas's.
    //
    // In orbit it is solved rather than chosen. The world's angular radius is
    // fixed by the altitude at 21°, and the picture wants that disc to come
    // out about three quarters of the height of the aperture — so the lens is
    // whatever puts it there. That is the ship widening its field to look at a
    // world, and not the ship parking somewhere the show never put it.
    let fovy = fovFor(lens, 74);
    let tilt = 0;
    if (world) {
      const theta = angularRadius();
      fovy = Math.min(2.9, 2 * Math.atan(Math.tan(theta) / 0.78));
      tilt = theta * 0.34;
    }
    void height;

    const eye = vec3();
    const at = vec3();
    if (world) {
      this.orbitCamera(world, eye, at, tilt);
    } else {
      eye[0] = origin[0] + nose[0] * 140;
      eye[1] = origin[1] + nose[1] * 140 + 12;
      eye[2] = origin[2] + nose[2] * 140;
      at[0] = eye[0] + nose[0] * 8000;
      at[1] = eye[1] + nose[1] * 8000;
      at[2] = eye[2] + nose[2] * 8000;
      this._up[0] = 0; this._up[1] = 1; this._up[2] = 0;
    }
    perspective(fovy, lens, 2, 40000, this._proj);
    lookAt(eye, at, this._up, this._view);
    multiply(this._proj, this._view, this._screenVP);
    r.setCamera(this._screenVP);

    // The key light is the system's own primary, not a studio lamp. Which is
    // the whole terminator: the line between day and night on the world below
    // is not drawn, it is where pointing the light at the actual star puts it.
    const sun = game.location ? vista(game.location.id, game.location.type).bodies[0] : null;
    if (sun && world) {
      const dx = sun.x - world.body.x;
      const dy = sun.y - world.body.y;
      const dz = sun.z - world.body.z;
      const L = Math.hypot(dx, dy, dz) || 1;
      r.setLighting({
        key: [dx / L, dy / L, dz / L], fill: [-dx / L, -dy / L, -dz / L],
        // Night is dark, and this is the one place in the game where that is
        // the point rather than a problem. 0.06 leaves the unlit half readable
        // as a shape against the stars without lighting it.
        ambient: 0.06, keyPower: 1.0, gloss: 0,
      });
    }

    // AT WARP, the stars are streaks — the same stars, drawn out along the
    // course. This is the most recognisable thing a viewscreen ever showed, and
    // it replaces the starfield rather than joining it: both at once is 4,400
    // triangles of sky before a single ship is drawn.
    const warp = game.transit?.warpFactor ?? 0;
    if (warp > 0) {
      // Speed rises with the factor, and the field wraps rather than resetting
      // so there is never a frame where every streak jumps.
      this.warpPhase = (this.warpPhase + warp * warp * 26 * this.lastDt) % WARP_LENGTH;
      // Laid along the ship's course, starting behind the camera so streaks
      // arrive from ahead and pass you rather than appearing out of nothing.
      const along = quatFromTo(vec3(0, 0, 1), nose, this._quat);
      this._pos[0] = eye[0] - nose[0] * this.warpPhase;
      this._pos[1] = eye[1] - nose[1] * this.warpPhase;
      this._pos[2] = eye[2] - nose[2] * this.warpPhase;
      compose(this._pos, along, 1, this._model);
      r.draw('warp', warpfield(), {
        model: this._model,
        normalMatrix: normalMatrix(this._model, this._normal),
        emissive: 1,
        tint: tintOf([1, 1, 1]),
        fogFar: 1e9,
      });
    } else {
      // Stars ride with the camera so they never come into reach.
      compose(eye, quat(), 1, this._model);
      r.draw('stars', starfield(), {
        model: this._model,
        normalMatrix: normalMatrix(this._model, this._normal),
        emissive: 1,
        tint: tintOf([1, 1, 1]),
        fogFar: 1e9,
      });
    }

    // The world underneath, at the resolution being this close to it needs.
    // Spun about its own axis for the time of day, which is what carries the
    // terminator across the ground while the ship watches.
    if (world) {
      const { body, frame } = world;
      this._pos[0] = body.x; this._pos[1] = body.y; this._pos[2] = body.z;
      quatAxisAngle(frame.axis, this.worldSpin, this._quat);
      compose(this._pos, this._quat, body.radius, this._model);
      r.draw(`world:${body.kind}`, worldMesh(body.kind, body.ordinal ?? 0), {
        model: this._model,
        normalMatrix: normalMatrix(this._model, this._normal),
        emissive: emisOf(0),
        tint: tintOf([1, 1, 1]),
        fogFar: 1e9,
      });
      // The halo, square to the camera. `frame.up` IS the direction from the
      // world to the ship, so it is the direction the ring has to face.
      quatFromTo(vec3(0, 1, 0), frame.up, this._quat);
      compose(this._pos, this._quat, body.radius, this._model);
      r.draw(`limb:${body.kind}`, limbMesh(body.kind), {
        model: this._model,
        normalMatrix: normalMatrix(this._model, this._normal),
        emissive: 1,
        tint: tintOf([1, 1, 1]),
        alpha: 0.8,
        fogFar: 1e9,
      });
    }

    // The rest of the system's worlds, culled to what is actually ahead —
    // which in orbit is where the camera is pointed and not where the bow is.
    const sys = game.location;
    if (sys) {
      const v = vista(sys.id, sys.type);
      const ahead = world ? this._look : nose;
      let drawn = 0;
      for (const b of v.bodies) {
        if (drawn >= 3) break;
        if (world && b.id === world.body.id) continue;
        const dx = b.x - eye[0]; const dy = b.y - eye[1]; const dz = b.z - eye[2];
        const d = Math.hypot(dx, dy, dz) || 1;
        const slack = Math.min(0.75, b.radius / d);
        if ((dx * ahead[0] + dy * ahead[1] + dz * ahead[2]) / d < 0.2 - slack) continue;
        this._pos[0] = b.x; this._pos[1] = b.y; this._pos[2] = b.z;
        compose(this._pos, quat(), b.radius, this._model);
        r.draw(`body:${b.kind}`, bodyMesh(b.kind, 0), {
          model: this._model,
          normalMatrix: normalMatrix(this._model, this._normal),
          emissive: emisOf(b.emissive),
          tint: tintOf(b.tint),
          fogFar: 90000,
        });
        drawn++;
      }
    }

    // And anybody out there. This is the whole reason the tactical display no
    // longer needs to be a separate screen: the enemy is ON the viewer.
    if (eng) {
      for (const s of [...eng.hostiles, ...eng.allies]) {
        // A ship that has gone to warp is not out there any more.
        if (!s || s.destroyed || s.withdrawn) continue;
        this._pos[0] = s.x; this._pos[1] = s.z ?? 0; this._pos[2] = s.y;
        // Pointed where it is actually going.
        //
        // This passed a bare `quat()` — the identity — so every hostile and
        // ally on the main viewer faced the same fixed direction no matter what
        // it was doing. A Bird-of-Prey could make a firing run straight across
        // the screen without ever appearing to turn, which is the single most
        // obvious thing wrong with looking out of the window during a fight.
        // The tactical plot has always oriented its hulls correctly; the
        // viewscreen simply never did.
        quatFromEuler(
          -(s.pitch ?? 0) * Math.PI / 180,
          -(s.heading ?? 0) * Math.PI / 180,
          (s.roll ?? 0) * Math.PI / 180,
          this._quat,
        );
        compose(this._pos, this._quat, hullScale(s.classId), this._model);
        r.draw(`hull:${s.classId}:${s.faction}`, hullMesh(s.classId, s.faction), {
          model: this._model,
          normalMatrix: normalMatrix(this._model, this._normal),
          tint: tintOf([1, 1, 1]),
          emissive: emisOf(0),
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
    const nm = normalMatrix(this._model, this._normal);
    // Rooms are 10 metres across, not 3,000 — the tactical falloff would fog a
    // bulkhead you are standing next to.
    this.renderer.draw(`room:${room.id}`, m.solid, {
      model: this._model, normalMatrix: nm, fogFar: 1e6,
    });
    this.renderer.draw(`room:${room.id}:glow`, m.glow, {
      model: this._model, normalMatrix: nm, emissive: 1, fogFar: 1e6,
    });

    this.drawCrew(room);
  }

  /**
   * The people, drawn one at a time so they can look at you.
   *
   * They used to be part of the room's mesh, which meant an officer faced their
   * console for the entire five-year mission — including while reporting to the
   * captain standing behind them. One draw call each and no extra triangles
   * buys a bridge crew that turns round when it has something to say.
   */
  drawCrew(room) {
    const walker = room === this.lastRoom ? this.lastWalker : null;
    for (const st of room.stations ?? []) {
      if (!st.crew) continue;
      const [x, z] = officerStandsAt(st);
      const base = officerFaces(st);

      let yaw = base;
      const turning = this.speaking.get(st.id);
      if (turning > 0 && walker) {
        // Toward whoever is being spoken to, which is the captain, which is
        // wherever the camera is — not toward a hardcoded chair. An officer in
        // engineering reporting to you in engineering turns to face you there.
        const want = Math.atan2(walker.x - x, walker.z - z);
        // Shortest way round, so nobody spins the long way to look over their
        // shoulder.
        let delta = (want - base + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        // Eased, and capped: a person glances over their shoulder, they do not
        // swivel their whole body through 180 degrees to answer a question.
        delta = Math.max(-2.2, Math.min(2.2, delta));
        yaw = base + delta * (turning * turning * (3 - 2 * turning));
      }

      quatAxisAngle(vec3(0, 1, 0), yaw, this._quat);
      this._pos[0] = x; this._pos[1] = 0; this._pos[2] = z;
      compose(this._pos, this._quat, 1, this._model);
      this.renderer.draw(`crew:${st.crew}:${st.mounted}`, officerMesh(st.crew, st.mounted), {
        model: this._model,
        normalMatrix: normalMatrix(this._model, this._normal),
        fogFar: 1e6,
      });
    }
  }

  /**
   * Somebody at this station just said something. Turn them round.
   *
   * Decays in `render`, so a report that arrives while the captain is on
   * another deck has worn off by the time they walk back in.
   */
  speak(stationId) {
    if (!stationId) return;
    this.speaking.set(stationId, 1);
  }

  /**
   * The ship just took one.
   *
   * A hit was audible and invisible: the viewer is the whole interface now, so
   * something arriving on the hull has to be something you SEE. It shows up
   * twice, because the two are different facts about the same event — the
   * picture loses sync because the sensors did, and the deck moves because the
   * ship did.
   *
   * The worse of two overlapping hits wins rather than the later one. A volley
   * that lands a graze after a hull breach should not step the effect DOWN.
   */
  hit(severity = 0.5, penetrated = false) {
    const level = Math.max(0.25, Math.min(1, severity));
    if (level >= this.jolt.level) this.jolt = { level, hull: !!penetrated };
  }

  /**
   * How far the deck has been thrown, in metres, at this instant.
   *
   * Decaying, and oscillating fast enough to read as an impact rather than as a
   * sway. Returns zero flat when the player has asked for reduced motion, which
   * leaves the flash on the viewer doing the work — the hit is still visible,
   * it just does not move the camera.
   */
  joltOffset() {
    if (!this.shake) return 0;
    return joltShake(this.jolt.level, this.jolt.hull);
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
