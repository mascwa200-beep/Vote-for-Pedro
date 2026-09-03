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
export const DRAWN_EFFECTS = ['beam', 'cannon', 'explosion', 'impact', 'cloak', 'decloak'];

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

  // Cloaking, which this renderer ignored for as long as it has existed.
  //
  // The simulation has always pushed these — `src/sim/ai.js`, when a ship
  // cloaks or drops its cloak — and the only thing that ever drew them was the
  // 2D fallback, which no player could reach until the display setting became
  // real. So the signature move of an entire faction happened with nothing on
  // screen for it on the display everyone actually uses.
  //
  // The reading matches the flat plot's: an expanding shell that fades as it
  // grows, in the same green. `shieldMesh` is the faceted sphere already used
  // for the impact flare, so this costs a draw call and no new geometry.
  for (const e of engagement.effects ?? []) {
    if (e.kind !== 'cloak' && e.kind !== 'decloak') continue;
    const age = clamp(1 - e.life, 0, 1);
    // Sized to the hull, not to a stock radius.
    //
    // The flat plot's law is `30 + t * 60` units, which is right for a plan
    // view that draws every ship at roughly one size and wrong out here, where
    // hulls are drawn to scale. Five classes in this game can cloak, and their
    // half-lengths are 10, 23, 69, 98 and 149 units: a shell that never gets
    // past 90 is buried inside a Vor'cha, a Neg'Var and a D'deridex for its
    // whole life. Three of the five ships that cloak drew the effect somewhere
    // no one could see it.
    //
    // Measured off `hullScale`, the same way the impact flare is, it starts
    // just proud of the plating and swells to about two and a half times the
    // ship — the reading the flat plot gives, at each ship's own scale.
    const r = hullScale(e.classId) * 0.5;
    compose(toRender(e, _pos), quat(), r * (1.15 + age * 1.35), _model);
    draw('cloak', shieldMesh(), {
      model: _model,
      normalMatrix: normalMatrix(_model, _normal),
      emissive: 1,
      // The flat plot strokes a ring and this fills a sphere, so the same
      // alpha is not the same picture: at the flat view's opacity the first
      // frame put an opaque green ball over the hull it is supposed to be
      // veiling. Halved, so the ship stays visible through its own cloaking
      // field — which is what the effect is depicting.
      alpha: (1 - age) * 0.35,
      tint: [0.63, 1, 0.71],
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
