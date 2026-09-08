/**
 * Glare: the halo around a bright thing, drawn on the 2D overlay.
 *
 * WHY THIS IS NOT IN THE SHADER.
 *
 * The game is heavily emissive — 39% of every vertex in it sits at glow = 1 —
 * and none of it glowed. The usual answer is a bloom pass, and this renderer
 * cannot have one: WebGL 1 with no float target, no framebuffer object worth
 * the name, and `antialias` on, which makes the default framebuffer
 * multisampled while a WebGL 1 FBO cannot be. `gl.js` already says so at the
 * point where it gave up, and says where the glow belongs instead — "in the
 * overlay glare pass, where it can be a halo AROUND the aperture rather than a
 * brighter aperture". This is that pass.
 *
 * Driving emissive surfaces above white does not work and is worth stating
 * once: the ramp clips at 1.0, so a brighter aperture is the same aperture with
 * its highlights flattened. Glow has to be drawn OUTSIDE the bright thing, over
 * the top of the scene, which is exactly what a 2D canvas layered over the GL
 * canvas is for.
 *
 * WHAT IS PURE HERE AND WHY IT MATTERS.
 *
 * Neither view module can be imported under Node — both touch `document` when
 * they load — so anything written inside them is testable only as source text.
 * The arithmetic in a glare pass is the part that can be wrong in ways nobody
 * sees (an emitter behind the camera projected to a plausible-looking point, a
 * radius that grows without bound as something approaches the near plane), so
 * it lives here as plain functions over plain numbers and is tested as such.
 * Only `paintGlare` touches a canvas.
 */

import { clamp } from '../core/num.js';

/** Never more sprites in one frame than this. A frame is not a light show. */
export const GLARE_BUDGET = 24;

/** Widest a single halo may be drawn, as a fraction of the viewport's width. */
const MAX_SPAN = 0.42;

/**
 * Everything in an engagement bright enough to throw a halo, in world space.
 *
 * Returns `{x, y, z, size, colour, alpha}` where `size` is a world-space radius
 * and `alpha` is how far through its life the emitter is. Sorted brightest
 * first so that trimming to the budget drops the dimmest rather than an
 * arbitrary tail.
 *
 * The effect kinds come from `DRAWN_EFFECTS` in `effects.js` rather than being
 * restated here — a second copy of that list is the thing `wiring.test.js`
 * exists to refuse, and it is right to: the explosion span already drifted once
 * between the simulation and the renderer holding separate copies of it.
 */
export function glareEmitters(engagement, kinds) {
  const out = [];
  if (!engagement) return out;

  // A torpedo in flight. The best glare candidate in the game: a point source,
  // already emissive, and the thing the eye is following during a fight.
  for (const p of engagement.projectiles ?? []) {
    out.push({ x: p.x, y: p.y, z: p.z ?? 0, size: 26, colour: TORPEDO, alpha: 0.95 });
  }

  for (const e of engagement.effects ?? []) {
    if (!kinds.includes(e.kind)) continue;
    if (e.kind === 'explosion') {
      // Same age law the GL pass uses, against the effect's OWN span. Reading
      // the span off the effect rather than assuming one is not pedantry here:
      // three callers push explosions at 0.4, 0.8 and 1.6, and a renderer that
      // assumed 1.6 drew a point-defence kill already three-quarters faded.
      const age = clamp(1 - e.life / (e.span || 1.6), 0, 1);
      out.push({
        x: e.x, y: e.y, z: e.z ?? 0,
        size: (30 + age * 130) * 1.6, colour: BLAST, alpha: 1 - age,
      });
    } else if (e.kind === 'impact') {
      const age = clamp(1 - e.life / (e.span || 0.4), 0, 1);
      out.push({
        x: e.x, y: e.y, z: e.z ?? 0,
        size: 70 * (1 - age * 0.4), colour: e.penetrated ? BLAST : SHIELD, alpha: 1 - age,
      });
    } else if (e.kind === 'beam' || e.kind === 'cannon') {
      // The muzzle and the landing point, not the length of the beam. A halo
      // stretched along a line is a second beam; two halos at the ends are what
      // a beam actually does to a camera.
      const a = clamp(e.life * 2.4, 0, 0.9);
      for (const at of [e.from, e.to]) {
        if (at) out.push({ x: at.x, y: at.y, z: at.z ?? 0, size: 34, colour: BEAM, alpha: a });
      }
    }
  }

  out.sort((p, q) => q.alpha * q.size - p.alpha * p.size);
  return out.length > GLARE_BUDGET ? out.slice(0, GLARE_BUDGET) : out;
}

/**
 * One world emitter as a screen-space sprite, or null if it should not be drawn.
 *
 * `project` is the view's own world-to-NDC, which returns null behind the
 * camera; `view` is the pixel rectangle the scene was rendered into, which is
 * NOT the whole canvas in first person — the exterior is drawn through the
 * viewscreen aperture and an emitter out in space belongs inside that hole.
 *
 * Two things this refuses to do, both of which look fine until they do not:
 * it drops anything at or behind the near plane rather than letting a
 * near-zero w produce an enormous halo in the middle of the screen, and it
 * caps the radius, because an explosion the camera is sitting inside otherwise
 * asks for a sprite thousands of pixels across and the cost of a radial
 * gradient is its area.
 */
export function glareSprite(emitter, project, view) {
  const p = project([emitter.x, emitter.z ?? 0, emitter.y]);
  if (!p || p.z > 1) return null;
  const x = view.x + (p.x * 0.5 + 0.5) * view.w;
  const y = view.y + (1 - (p.y * 0.5 + 0.5)) * view.h;

  // Perspective size, without this module knowing the field of view.
  //
  // The radius is read off how far the projection moves a point one world
  // radius away from the emitter — which works for any FOV, but only if the
  // offset has some component ACROSS the view. Offsetting along a single fixed
  // world axis does not: point the camera down that axis and the offset lies
  // along the line of sight, the projected displacement collapses to nothing,
  // and every halo in the frame silently disappears. On the tactical plot the
  // camera orbits freely, so that is a view angle away, not a corner case.
  //
  // So all three axes are tried and the largest displacement wins. For any
  // orientation at least one of three orthogonal directions is substantially
  // across the view: the worst case is the camera on the (1,1,1) diagonal,
  // where each axis still returns 0.816 of the true radius.
  const R = emitter.size;
  let best = 0;
  for (const d of [[R, 0, 0], [0, R, 0], [0, 0, R]]) {
    const q = project([emitter.x + d[0], (emitter.z ?? 0) + d[1], emitter.y + d[2]]);
    if (!q) continue;
    const dx = (q.x - p.x) * 0.5 * view.w;
    const dy = (q.y - p.y) * 0.5 * view.h;
    best = Math.max(best, Math.hypot(dx, dy));
  }
  const r = best;
  if (!(r > 0.5)) return null;
  const cap = view.w * MAX_SPAN;
  return {
    x, y,
    r: Math.min(r, cap),
    colour: emitter.colour,
    alpha: clamp(emitter.alpha, 0, 1),
  };
}

/** Warm white through orange: a torpedo. */
const TORPEDO = [255, 240, 180];
/** A detonation. */
const BLAST = [255, 150, 60];
/** A shot the shields held. */
const SHIELD = [120, 190, 255];
/** Phaser and disruptor fire. */
const BEAM = [255, 190, 120];

/**
 * Sprite cache.
 *
 * A radial gradient costs its area to rasterise and this file would otherwise
 * build one per emitter per frame — `tactical.js` does exactly that and gets
 * away with it because the 2D plot draws a handful of effects at a time. The
 * convention everywhere else in this renderer is that the draw path allocates
 * nothing, so the sprites are drawn once onto small offscreen canvases and
 * blitted after that.
 *
 * The radius is QUANTISED before it becomes a key. Keying on an exact float
 * gives one cached sprite per pixel size, which is a cache that only ever
 * misses and a leak besides — the same mistake `firstperson.js` documents at
 * length about room mesh keys.
 */
const SPRITES = new Map();

function sprite(colour, r) {
  const q = Math.max(4, Math.round(r / 4) * 4);
  const key = `${colour[0]},${colour[1]},${colour[2]}:${q}`;
  const hit = SPRITES.get(key);
  if (hit) return hit;
  // Not appended to the document. Three assertions in the harness require
  // exactly one `canvas.tactical-labels` in the tree, and a sprite sheet that
  // joined the DOM would be a second canvas nobody asked for.
  const c = globalThis.document?.createElement?.('canvas');
  if (!c) return null;
  c.width = q * 2;
  c.height = q * 2;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(q, q, 0, q, q, q);
  const [cr, cg, cb] = colour;
  grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.85)`);
  grad.addColorStop(0.35, `rgba(${cr},${cg},${cb},0.30)`);
  grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, q * 2, q * 2);
  if (SPRITES.size > 96) SPRITES.clear();
  SPRITES.set(key, c);
  return c;
}

/**
 * Blit the sprites, additively.
 *
 * `globalCompositeOperation` is used nowhere else in `src/`, and neither
 * `drawOverlay` wraps itself in save/restore — so this saves and restores
 * around its own work rather than trusting the caller. A composite mode left
 * set here would not fail, it would quietly tint every label drawn after it,
 * on a canvas that is never rebuilt.
 */
export function paintGlare(ctx, sprites, clip) {
  if (!sprites.length) return;
  ctx.save();
  if (clip && clip.length >= 3) {
    ctx.beginPath();
    ctx.moveTo(clip[0][0], clip[0][1]);
    for (let i = 1; i < clip.length; i++) ctx.lineTo(clip[i][0], clip[i][1]);
    ctx.closePath();
    ctx.clip();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const s of sprites) {
    const img = sprite(s.colour, s.r);
    if (!img) continue;
    ctx.globalAlpha = s.alpha;
    ctx.drawImage(img, s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
  }
  ctx.restore();
}
