// Everything in the tactical volume that is not a ship.
//
// The starfield, the local star and planets, the LCARS reference grid, weapon
// traces, torpedoes, impacts and shield shells. All of it is generated
// geometry, all of it is flat-shaded, and all of it is built once and reused —
// there is nothing to load here either.
//
// The grid deserves a note. Nothing in space tells you where anything is
// relative to anything else, and a 3D tactical display without a reference
// plane is unreadable: two ships at the same screen position may be a hundred
// units apart or three thousand. The grid, and the vertical drop lines from
// each hull down to it, are what make the third axis legible rather than
// decorative.

import { vec3 } from './math.js';
import { MeshBuilder, sphere, box, tube } from './mesh.js';

/** The tactical volume is a cube this many units on a side. */
export const VOLUME = 3000;

const cache = new Map();
const memo = (key, build) => {
  if (!cache.has(key)) cache.set(key, build().build());
  return cache.get(key);
};

/**
 * The starfield: a shell of small quads far enough out to read as fixed.
 *
 * Deterministic from a fixed integer hash rather than Math.random, so the sky
 * is the same on every launch and in every screenshot. The simulation's own RNG
 * is not used — the stars are cosmetic and must not consume draws from the
 * stream the save file depends on.
 */
export function starfield(count = 260) {
  return memo(`stars:${count}`, () => {
    const mb = new MeshBuilder();
    let h = 0x9e3779b9;
    const rnd = () => {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h |= 0;
      return (h >>> 0) / 4294967296;
    };
    const R = VOLUME * 4;
    for (let i = 0; i < count; i++) {
      // Even-ish distribution on a sphere.
      const u = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const c = vec3(Math.cos(a) * r * R, u * R, Math.sin(a) * r * R);
      const size = R * (0.0016 + rnd() * 0.0032);
      const warm = rnd();
      const col = [0.7 + warm * 0.3, 0.72 + warm * 0.2, 0.9 - warm * 0.25];
      box(mb, { center: c, size: vec3(size, size, size), color: col });
    }
    return mb;
  });
}

/** A star or planet. `kind` picks the palette; `seed` varies the banding. */
export function bodyMesh(kind = 'planet', seed = 0) {
  return memo(`body:${kind}:${seed & 7}`, () => {
    const mb = new MeshBuilder();
    const palettes = {
      star: [1.0, 0.86, 0.5],
      planet: [0.34, 0.48, 0.66],
      desert: [0.7, 0.56, 0.36],
      ice: [0.74, 0.84, 0.92],
      gas: [0.66, 0.56, 0.42],
      moon: [0.5, 0.5, 0.52],
    };
    sphere(mb, {
      radius: 1,
      segments: 20,
      rings: 12,
      color: palettes[kind] ?? palettes.planet,
      banding: kind === 'star' ? 0 : 0.35,
    });
    return mb;
  });
}

/**
 * The reference grid: a plane of lines at y = 0, drawn as very thin boxes so it
 * goes through the same shader as everything else.
 */
export function gridMesh(divisions = 12) {
  return memo(`grid:${divisions}`, () => {
    const mb = new MeshBuilder();
    const half = VOLUME / 2;
    const step = VOLUME / divisions;
    const thin = VOLUME * 0.0012;
    for (let i = 0; i <= divisions; i++) {
      const p = -half + i * step;
      const axis = i === divisions / 2;
      const color = axis ? [0.36, 0.52, 0.72] : [0.16, 0.22, 0.34];
      box(mb, { center: vec3(p, 0, 0), size: vec3(thin, thin, VOLUME), color });
      box(mb, { center: vec3(0, 0, p), size: vec3(VOLUME, thin, thin), color });
    }
    return mb;
  });
}

/**
 * A unit-length beam along +x, scaled and oriented per shot.
 * One mesh serves every phaser in the game.
 */
export function beamMesh() {
  return memo('beam', () => {
    const mb = new MeshBuilder();
    tube(mb, {
      origin: vec3(0, 0, 0),
      length: 1,
      r0: 0.5,
      r1: 0.5,
      segments: 5,
      color: [1, 1, 1],
      capFore: false,
      capAft: false,
    });
    return mb;
  });
}

/** A torpedo: a small glowing lozenge. */
export function torpedoMesh() {
  return memo('torpedo', () => {
    const mb = new MeshBuilder();
    sphere(mb, { radius: 1, segments: 8, rings: 5, color: [1, 0.85, 0.55] });
    return mb;
  });
}

/**
 * The shield shell: a sphere drawn slightly larger than the hull, additively,
 * when a facing takes a hit. Faceted on purpose — a smooth shell reads as a
 * bubble, a faceted one reads as a field made of overlapping emitters.
 */
export function shieldMesh() {
  return memo('shield', () => {
    const mb = new MeshBuilder();
    sphere(mb, { radius: 1, segments: 14, rings: 9, color: [0.5, 0.78, 1] });
    return mb;
  });
}

/** An expanding debris burst. */
export function explosionMesh() {
  return memo('explosion', () => {
    const mb = new MeshBuilder();
    let h = 0x85ebca6b;
    const rnd = () => {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h |= 0;
      return (h >>> 0) / 4294967296;
    };
    for (let i = 0; i < 18; i++) {
      const u = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const d = 0.4 + rnd() * 0.6;
      box(mb, {
        center: vec3(Math.cos(a) * r * d, u * d, Math.sin(a) * r * d),
        size: vec3(0.16, 0.16, 0.16),
        color: i % 3 === 0 ? [1, 0.9, 0.6] : [1, 0.55, 0.2],
      });
    }
    return mb;
  });
}

/** A vertical line from a hull down to the grid plane, so altitude is readable. */
export function dropLineMesh() {
  return memo('dropline', () => {
    const mb = new MeshBuilder();
    box(mb, {
      center: vec3(0, 0.5, 0),
      size: vec3(0.02, 1, 0.02),
      color: [0.35, 0.5, 0.7],
    });
    return mb;
  });
}

/** Every mesh the scene can draw, for the harness and the triangle budget. */
export function sceneMeshes() {
  return {
    starfield: starfield(),
    grid: gridMesh(),
    beam: beamMesh(),
    torpedo: torpedoMesh(),
    shield: shieldMesh(),
    explosion: explosionMesh(),
    dropLine: dropLineMesh(),
    planet: bodyMesh('planet'),
    star: bodyMesh('star'),
  };
}
