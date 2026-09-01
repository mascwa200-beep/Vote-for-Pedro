// What a fight looks like: beams, torpedoes, explosions, and the flare where
// a shot lands.
//
// This used to live inside `src/ui/tactical3d.js`, which is the plot — the
// console you walk to when you want to READ a fight. The place a fight is
// actually meant to happen is the bridge, with the enemy on the main viewer,
// and that view drew the hulls and nothing they were doing: a Bird-of-Prey
// crossed the screen, hit you, and all you saw was a shape drifting and the
// picture flashing. Two renderers need the same drawing, so it is in one place
// rather than two — the ship-name table went wrong twice before it was made
// one table, and this is the same shape of thing.
//
// The one piece that is new here is the impact flare. Every hit has always
// pushed `{kind: 'impact', facing, penetrated, crit}` onto the engagement's
// effects, and the only file that ever read it was the 2D fallback for devices
// with no WebGL. On every device that has WebGL it was recorded on every shot
// and drawn by nothing.

import { vec3, quat, compose, normalize, cross, sub, length as vlength, normalMatrix } from './math.js';
import { beamMesh, torpedoMesh, explosionMesh, shieldMesh } from './scene.js';
import { paletteFor, hullScale } from './blueprint.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// One set of scratch matrices for the module. Only one view draws at a time —
// the bridge aperture and the tactical plot are different screens — so this
// costs nothing and keeps the per-frame allocation at zero, which is the same
// reason every other renderer in this project holds its own.
const _model = new Float32Array(16);
const _normal = new Float32Array(9);
const _pos = vec3();
const _dir = vec3();

/**
 * Simulation space is (x, y) with an optional z; render space is (x, z, y)
 * with +y up. Every renderer in this project does this conversion and every
 * one of them used to do it inline.
 */
function toRender(p, out = vec3()) {
  out[0] = p.x;
  out[1] = p.z ?? 0;
  out[2] = p.y;
  return out;
}

/** Lay a unit +x mesh along `dir`, `thickness` wide, starting at `from`. */
function orientAlong(dir, from, len, thickness, m = _model) {
  const x = normalize(dir);
  let up = vec3(0, 1, 0);
  if (Math.abs(x[1]) > 0.98) up = vec3(1, 0, 0);
  const z = normalize(cross(x, up));
  const y = cross(z, x);

  m[0] = x[0] * len; m[1] = x[1] * len; m[2] = x[2] * len; m[3] = 0;
  m[4] = y[0] * thickness; m[5] = y[1] * thickness; m[6] = y[2] * thickness; m[7] = 0;
  m[8] = z[0] * thickness; m[9] = z[1] * thickness; m[10] = z[2] * thickness; m[11] = 0;
  m[12] = from[0]; m[13] = from[1]; m[14] = from[2]; m[15] = 1;
  return m;
}

/** Every `kind` on `engagement.effects` that this module knows how to draw. */
export const DRAWN_EFFECTS = ['beam', 'cannon', 'explosion', 'impact'];

/**
 * Draw everything happening in an engagement that is not a hull.
 *
 * @param {object} renderer  the shared GL renderer
 * @param {object} engagement
 * @param {object} opts  {fogFar, cap} — `cap` bounds the work in a large
 *   fight and REPORTS what it dropped rather than dropping it quietly.
 * @returns {{drawn: number, dropped: number}}
 */
export function drawCombatEffects(renderer, engagement, opts = {}) {
  const out = { drawn: 0, dropped: 0 };
  if (!renderer || !engagement) return out;

  const fogFar = opts.fogFar ?? 1e9;
  // A six-ship engagement all firing at once is the worst case, and the bridge
  // pass already carries a room, seven officers and a starfield inside a
  // sixty-draw budget. The cap is generous; what matters is that going over it
  // is reported.
  const cap = opts.cap ?? 40;

  const draw = (key, mesh, params) => {
    if (out.drawn >= cap) { out.dropped++; return; }
    renderer.draw(key, mesh, { ...params, fogFar });
    out.drawn++;
  };

  // Beams: a unit tube along +x, rotated onto the shot and stretched to it.
  for (const e of engagement.effects ?? []) {
    if (e.kind !== 'beam' && e.kind !== 'cannon') continue;
    const from = toRender(e.from, _pos);
    const to = toRender(e.to, _dir);
    const dir = sub(to, from);
    const len = vlength(dir);
    if (len < 1) continue;

    orientAlong(dir, from, len, e.kind === 'cannon' ? 5 : 3);
    draw('beam', beamMesh(), {
      model: _model,
      normalMatrix: normalMatrix(_model, _normal),
      emissive: 1,
      alpha: clamp(e.life * 2.4, 0, 0.9),
      tint: paletteFor(e.faction).glow,
    });
  }

  for (const p of engagement.projectiles ?? []) {
    compose(toRender(p, _pos), quat(), 9, _model);
    draw('torpedo', torpedoMesh(), {
      model: _model,
      normalMatrix: normalMatrix(_model, _normal),
      emissive: 1,
      tint: [1, 1, 1],
    });
  }

  // The flare where a shot lands.
  //
  // Placed on the struck facing rather than at the middle of the ship, which
  // is what makes it readable: a hit on the bow and a hit on the stern are
  // different pieces of information, and so is whether it stopped. A shot the
  // shields held flares in the shield's colour, off the hull; one that got
  // through burns white on the plating itself.
  for (const e of engagement.effects ?? []) {
    if (e.kind !== 'impact') continue;
    const age = clamp(1 - e.life / 0.4, 0, 1);
    const r = hullScale(e.classId) * 0.5;
    const at = toRender(e, _pos);
    // `from` is the unit vector toward whoever fired, recorded at the moment
    // of the hit — the effect outlives the tick and may outlive the ship, so
    // it carries what it needs rather than holding a reference to one.
    const off = e.from ? toRender(e.from, _dir) : vec3(0, 0, 0);
    const stand = e.penetrated ? r * 0.55 : r * 1.15;
    _pos[0] = at[0] + off[0] * stand;
    _pos[1] = at[1] + off[1] * stand;
    _pos[2] = at[2] + off[2] * stand;

    const size = r * (e.penetrated ? 0.45 : 0.7) * (e.crit ? 1.5 : 1) * (1 - age * 0.4);
    compose(_pos, quat(), Math.max(1, size), _model);
    draw('impact', shieldMesh(), {
      model: _model,
      normalMatrix: normalMatrix(_model, _normal),
      emissive: 1,
      alpha: (1 - age) * (e.penetrated ? 0.95 : 0.6),
      // White-hot through the hull; the shield's own colour when it holds.
      tint: e.penetrated ? [1, 0.92, 0.7] : [0.55, 0.8, 1],
    });
  }

  for (const e of engagement.effects ?? []) {
    if (e.kind !== 'explosion') continue;
    const age = clamp(1 - e.life / 1.6, 0, 1);
    compose(toRender(e, _pos), quat(), 30 + age * 130, _model);
    draw('explosion', explosionMesh(), {
      model: _model,
      normalMatrix: normalMatrix(_model, _normal),
      emissive: 1,
      alpha: 1 - age,
      tint: [1, 1, 1],
    });
  }

  return out;
}
