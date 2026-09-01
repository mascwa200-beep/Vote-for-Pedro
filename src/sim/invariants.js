// Everything that must be true, checked while it is running.
//
// Combat is the part of this game with the most moving state and the least
// forgiving failure mode. A ship whose position goes NaN never recovers, for
// the rest of the save. An engagement that satisfies no end condition is a
// permanent soft-lock when you are not allowed to warp out. Both of those have
// happened here, both were found by fuzzing, and both were fixed one at a time
// by a test that knew to look for that specific thing.
//
// This file is the other approach: state every rule the simulation must obey,
// once, and check all of them every tick. A rule written here is checked
// against every fight the fuzzer runs and every fight the player has with the
// debug flag on, including the fights nobody thought to write a test for.
//
// Three properties this file has to keep, or it is worse than nothing:
//
//   It never throws. A checker that crashes while checking for crashes turns a
//   cosmetic bug into a black screen. Everything below is defensive.
//
//   It never mutates. Reading `ship.hullPct` is fine; nothing here may write.
//
//   It is cheap enough to leave on. The whole sweep is O(ships + projectiles)
//   with no allocation per ship, so a 6-hull fight costs a few hundred
//   comparisons per tick against a budget of 33 milliseconds.
//
// Violations are data, not exceptions. The caller decides whether to throw
// (tests), log (the debug overlay), or count (the fuzzer).

import { FACINGS } from './ship.js';

/**
 * How far outside the arena a ship may be before it counts as escaped.
 *
 * `holdTheArena` clamps to exactly ARENA_RADIUS, and a ship moves before it is
 * clamped, so the true bound is the radius plus one tick of travel. A metre of
 * slack keeps floating point out of it.
 */
const ARENA_SLACK = 1.0;

/** Nothing legitimate produces this many at once; past it, something leaks. */
export const LIMITS = {
  projectiles: 400,
  effects: 300,
  logLines: 200,
  ships: 24,
  combatSeconds: 60 * 60,
};

const SEVERITY = { fatal: 0, error: 1, warn: 2 };

/** Sort worst-first. Exported so callers report the same order the fuzzer does. */
export function bySeverity(a, b) {
  return (SEVERITY[a.severity] ?? 9) - (SEVERITY[b.severity] ?? 9);
}

/**
 * A finite number, treating undefined `z` as 0 the way the rest of the sim does.
 * Explicitly NOT Number.isFinite alone: `null` is not finite but `0` is, and
 * several fields are legitimately absent until first written.
 */
const num = (v) => (v === undefined || v === null ? 0 : v);
const ok = (v) => Number.isFinite(num(v));

class Report {
  constructor() { this.violations = []; }

  /**
   * @param {boolean} condition what must be TRUE
   * @param {string} code stable identifier, so a fuzzer can group repeats
   * @param {string} severity fatal | error | warn
   * @param {string} text what went wrong, in words, with the actual value in it
   * @param {string} [subject] which ship or projectile
   */
  must(condition, code, severity, text, subject = null) {
    if (condition) return;
    this.violations.push({ code, severity, text, subject });
  }
}

/**
 * Check one ship.
 *
 * `arenaRadius` is passed rather than imported so this module does not depend
 * on combat.js — the ship rules also hold outside a fight, where there is no
 * arena at all.
 */
function checkShip(r, s, { arenaRadius = null, label = 'ship' } = {}) {
  if (!s || typeof s !== 'object') {
    r.must(false, 'ship.missing', 'fatal', `${label} is not a ship: ${String(s)}`);
    return;
  }
  const who = s.name ?? s.classId ?? label;

  // ---- position and attitude ----
  for (const k of ['x', 'y', 'z', 'heading', 'pitch', 'roll', 'throttle']) {
    r.must(ok(s[k]), `ship.${k}.finite`, 'fatal',
      `${who}: ${k} is ${s[k]}`, who);
  }
  for (const k of ['x', 'y', 'z']) {
    r.must(ok(s.velocity?.[k]), 'ship.velocity.finite', 'fatal',
      `${who}: velocity.${k} is ${s.velocity?.[k]}`, who);
  }
  r.must(num(s.throttle) >= 0 && num(s.throttle) <= 1, 'ship.throttle.range', 'error',
    `${who}: throttle is ${s.throttle}, outside 0..1`, who);
  r.must(Math.abs(num(s.pitch)) <= 90.001, 'ship.pitch.range', 'error',
    `${who}: pitch is ${s.pitch} degrees`, who);

  if (arenaRadius !== null && ok(s.x) && ok(s.y) && ok(s.z)) {
    const d = Math.hypot(s.x, s.y, num(s.z));
    r.must(d <= arenaRadius + ARENA_SLACK, 'ship.arena', 'fatal',
      `${who}: ${Math.round(d)} units from centre, outside the ${arenaRadius}-unit arena`, who);
  }

  // ---- damage model ----
  r.must(ok(s.hull), 'ship.hull.finite', 'fatal', `${who}: hull is ${s.hull}`, who);
  r.must(num(s.hull) >= 0, 'ship.hull.negative', 'error',
    `${who}: hull is ${s.hull}`, who);
  r.must(num(s.hull) <= num(s.maxHull) + 1e-6, 'ship.hull.overmax', 'error',
    `${who}: hull ${s.hull} exceeds max ${s.maxHull}`, who);
  r.must(num(s.maxHull) > 0, 'ship.maxHull', 'error',
    `${who}: maxHull is ${s.maxHull}`, who);

  for (const f of FACINGS) {
    const v = s.shields?.[f];
    r.must(ok(v), 'ship.shield.finite', 'fatal', `${who}: shields.${f} is ${v}`, who);
    r.must(num(v) >= 0, 'ship.shield.negative', 'error',
      `${who}: shields.${f} is ${v}`, who);
    r.must(num(v) <= num(s.maxShield) + 1e-6, 'ship.shield.overmax', 'error',
      `${who}: shields.${f} is ${v}, above max ${s.maxShield}`, who);
  }

  for (const [k, v] of Object.entries(s.subsystems ?? {})) {
    r.must(ok(v), 'ship.subsystem.finite', 'fatal', `${who}: subsystem ${k} is ${v}`, who);
    r.must(num(v) >= -1e-9 && num(v) <= 1 + 1e-9, 'ship.subsystem.range', 'error',
      `${who}: subsystem ${k} is ${v}, outside 0..1`, who);
  }

  r.must(ok(s.crew) && num(s.crew) >= 0, 'ship.crew', 'error',
    `${who}: crew is ${s.crew}`, who);
  r.must(num(s.crew) <= num(s.maxCrew) + 1e-6, 'ship.crew.overmax', 'error',
    `${who}: crew ${s.crew} exceeds complement ${s.maxCrew}`, who);
  r.must(ok(s.fires) && num(s.fires) >= 0, 'ship.fires', 'error',
    `${who}: fires is ${s.fires}`, who);
  r.must(ok(s.torpedoes) && num(s.torpedoes) >= 0, 'ship.torpedoes', 'error',
    `${who}: torpedoes is ${s.torpedoes}`, who);

  // ---- weapons ----
  for (const w of s.weapons ?? []) {
    r.must(ok(w.cooldown), 'weapon.cooldown.finite', 'fatal',
      `${who}: ${w.name ?? w.type} cooldown is ${w.cooldown}`, who);
    r.must(num(w.cooldown) >= -1e-9, 'weapon.cooldown.negative', 'error',
      `${who}: ${w.name ?? w.type} cooldown is ${w.cooldown}`, who);
  }

  // ---- the one rule that ties the model together ----
  //
  // A ship at zero hull that is not flagged destroyed keeps taking part in the
  // fight, and a ship flagged destroyed with hull left is a wreck the AI still
  // considers a threat. Either way the board disagrees with itself.
  if (s.destroyed) {
    r.must(num(s.hull) <= 1e-6, 'ship.destroyed.hull', 'error',
      `${who} is destroyed but has ${s.hull} hull`, who);
  } else {
    // Zero hull is legal for as long as the core is counting down. That is a
    // deliberate beat — the ship is finished and the explosion takes twenty
    // seconds, which is the only window in which ejecting the core saves you.
    // What must never happen is a hull at zero with no breach running: that
    // ship is dead, is not going to die, and sits on the board forever.
    r.must(num(s.hull) > 0 || s.breaching === true, 'ship.zerohull.adrift', 'error',
      `${who} has ${s.hull} hull, is not destroyed, and no breach is running`, who);
  }
}

/**
 * Check a live engagement.
 *
 * @param {object} eng the Engagement
 * @param {object} opts `arenaRadius` from combat.js, so this file imports nothing from it
 * @returns {Array<{code,severity,text,subject}>} empty when everything holds
 */
export function checkCombat(eng, { arenaRadius = 2600 } = {}) {
  const r = new Report();
  if (!eng) return r.violations;

  try {
    r.must(ok(eng.time) && eng.time >= 0, 'eng.time', 'fatal',
      `engagement time is ${eng.time}`);
    r.must(num(eng.time) < LIMITS.combatSeconds, 'eng.runaway', 'error',
      `engagement has run ${Math.round(num(eng.time))} simulated seconds`);

    const ships = eng.allShips ?? [];
    r.must(Array.isArray(ships), 'eng.ships.array', 'fatal', 'allShips is not an array');
    r.must(ships.length <= LIMITS.ships, 'eng.ships.count', 'warn',
      `${ships.length} ships in one engagement`);

    // The same hull appearing twice takes damage twice and is drawn twice.
    const seen = new Set();
    for (const s of ships) {
      r.must(!seen.has(s), 'eng.ships.duplicate', 'error',
        `${s?.name ?? 'a ship'} appears more than once in the engagement`, s?.name);
      seen.add(s);
      checkShip(r, s, { arenaRadius });
    }
    r.must(!!eng.player, 'eng.player', 'fatal', 'the engagement has no player ship');
    r.must(!eng.hostiles?.includes?.(eng.player), 'eng.player.hostile', 'fatal',
      'the player is in their own hostile list');

    // ---- the target ----
    //
    // A target reference held after the ship leaves the board is what makes the
    // camera chase a wreck and auto-fire shoot at nothing.
    if (eng.target) {
      r.must(seen.has(eng.target), 'eng.target.absent', 'error',
        `target ${eng.target.name ?? '?'} is not in this engagement`, eng.target.name);
      if (!eng.over) {
        r.must(!eng.target.withdrawn, 'eng.target.withdrawn', 'error',
          `target ${eng.target.name ?? '?'} has already left the fight`, eng.target.name);
      }
    }

    // ---- projectiles ----
    const shots = eng.projectiles ?? [];
    r.must(shots.length <= LIMITS.projectiles, 'eng.projectiles.leak', 'error',
      `${shots.length} projectiles in flight`);
    for (const p of shots) {
      const tag = `${p?.weapon?.name ?? 'torpedo'} from ${p?.attacker?.name ?? '?'}`;
      r.must(ok(p.x) && ok(p.y) && ok(p.z), 'projectile.finite', 'fatal',
        `${tag}: position is ${p.x},${p.y},${p.z}`, tag);
      r.must(ok(p.life), 'projectile.life.finite', 'fatal',
        `${tag}: life is ${p.life}`, tag);
      r.must(num(p.speed) > 0, 'projectile.speed', 'error',
        `${tag}: speed is ${p.speed}`, tag);
      r.must(!!p.target, 'projectile.target', 'error', `${tag}: has no target`, tag);
      r.must(!!p.attacker, 'projectile.attacker', 'error', `${tag}: has no attacker`, tag);
    }

    // ---- effects and log ----
    const fx = eng.effects ?? [];
    r.must(fx.length <= LIMITS.effects, 'eng.effects.leak', 'error',
      `${fx.length} visual effects alive at once`);
    for (const e of fx) {
      r.must(ok(e.life), 'effect.life.finite', 'fatal', `an effect has life ${e.life}`);
      r.must(ok(e.x) && ok(e.y) && ok(e.z), 'effect.finite', 'error',
        `an effect is at ${e.x},${e.y},${e.z}`);
    }
    r.must((eng.log?.length ?? 0) <= LIMITS.logLines, 'eng.log.leak', 'warn',
      `${eng.log?.length} combat log lines retained`);

    // ---- resolution ----
    //
    // The soft-lock rule. If the fight is not over, at least one of the things
    // that could end it must still be possible: somebody left to fight, or a
    // player who is done for.
    if (eng.over) {
      r.must(!!eng.outcome, 'eng.outcome', 'error',
        'the engagement is over with no outcome recorded');
    } else {
      const live = eng.liveHostiles ?? [];
      r.must(live.length > 0 || eng.player?.destroyed === true || num(eng.warpOutTimer) > 0,
        'eng.unresolved', 'fatal',
        'no live hostiles, the player is alive, and the engagement has not ended');
    }

    for (const k of ['warpOutTimer', 'separationTimer', 'decoyTimer']) {
      r.must(ok(eng[k]) && num(eng[k]) >= 0, `eng.${k}`, 'error',
        `${k} is ${eng[k]}`);
    }
  } catch (err) {
    // A checker that throws is worse than no checker. Report the failure as a
    // violation and let the caller decide.
    r.violations.push({
      code: 'checker.threw', severity: 'error',
      text: `the invariant checker itself failed: ${err?.message ?? err}`, subject: null,
    });
  }

  return r.violations.sort(bySeverity);
}

/**
 * Check the game around the fight — the state a fight leaves behind.
 *
 * The player's complaint was never only about the shooting. It was that "the
 * stuff that comes after it is also messed up": a mode that does not go back,
 * an engagement object left lying around for other code to trip over, a captain
 * who is somehow ashore during a battle.
 */
export function checkGame(game) {
  const r = new Report();
  if (!game) return r.violations;

  try {
    if (game.ship) checkShip(r, game.ship, { label: 'player' });

    const eng = game.engagement;
    const fighting = !!eng && !eng.over;

    if (fighting) {
      r.must(eng.player === game.ship, 'game.engagement.ship', 'fatal',
        'the engagement is fighting a different ship object than the game owns');
      r.must(game.walk?.roomId !== 'surface', 'game.combat.ashore', 'error',
        'a battle is running while the captain is standing on a planet');
      r.must(!game.transit, 'game.combat.transit', 'error',
        'a battle is running while the ship is at warp');
      r.must(!game.over, 'game.combat.after-end', 'error',
        'a battle is running after the game itself ended');
    }

    if (eng?.over) {
      r.must(game.mode !== 'combat' || game.over, 'game.mode.stuck', 'error',
        `the fight is over but the game is still in ${game.mode} mode`);
    }

    // The con is a bridge thing, and a fight is the moment it matters most.
    if (game.conStation) {
      r.must(!!game.crew?.at?.(game.conStation), 'game.con.ghost', 'error',
        `the con is held by ${game.conStation}, and nobody alive is at that post`);
    }

    r.must(ok(game.latinum) && game.latinum >= 0, 'game.latinum', 'error',
      `latinum is ${game.latinum}`);
    for (const [k, v] of Object.entries(game.stores ?? {})) {
      r.must(ok(v) && v >= 0, 'game.stores', 'error', `stores.${k} is ${v}`);
    }
    for (const o of game.crew?.officers ?? []) {
      r.must(ok(o.xp) && o.xp >= 0, 'officer.xp', 'error',
        `${o.name}: xp is ${o.xp}`, o.name);
      r.must(o.alive || !o.injured, 'officer.dead-and-injured', 'warn',
        `${o.name} is dead and also flagged injured`, o.name);
    }
  } catch (err) {
    r.violations.push({
      code: 'checker.threw', severity: 'error',
      text: `the game invariant checker itself failed: ${err?.message ?? err}`, subject: null,
    });
  }

  return r.violations.sort(bySeverity);
}

/**
 * Everything, in one call.
 *
 * @param {object} game
 * @param {object} opts arenaRadius, so this module stays free of combat.js
 */
export function checkAll(game, opts = {}) {
  return [...checkGame(game), ...checkCombat(game?.engagement, opts)].sort(bySeverity);
}

/**
 * A watchdog that remembers what it has already complained about.
 *
 * Running the checker every tick and logging every violation would produce
 * thirty identical lines a second for one broken number, which buries the
 * second bug under the first. Each distinct code is reported once per session
 * with a count kept behind it.
 */
export class Watchdog {
  /**
   * @param {object} opts
   *   `onViolation(v, count)` — called the first time each code is seen.
   *   `throwOn` — 'fatal' | 'error' | 'never'. Tests use 'error'.
   *   `every` — check one tick in N. 1 is every tick.
   */
  constructor({ onViolation = null, throwOn = 'never', every = 1 } = {}) {
    this.onViolation = onViolation;
    this.throwOn = throwOn;
    this.every = Math.max(1, Math.floor(every) || 1);
    this.counts = new Map();
    this.firsts = [];
    this.ticks = 0;
    this.checked = 0;
  }

  /** Total violations seen, counting repeats. */
  get total() {
    let n = 0;
    for (const c of this.counts.values()) n += c;
    return n;
  }

  /** The distinct problems, worst first — what a bug report should contain. */
  get summary() {
    return this.firsts
      .map((v) => ({ ...v, count: this.counts.get(v.code) ?? 0 }))
      .sort(bySeverity);
  }

  /**
   * Run one check. Cheap to call every tick.
   * @returns {Array} the violations found this tick
   */
  tick(game, opts = {}) {
    this.ticks++;
    if (this.ticks % this.every !== 0) return [];
    this.checked++;

    const found = checkAll(game, opts);
    for (const v of found) {
      const seen = this.counts.get(v.code) ?? 0;
      this.counts.set(v.code, seen + 1);
      if (seen === 0) {
        this.firsts.push(v);
        this.onViolation?.(v, 1);
      }
    }

    if (this.throwOn !== 'never') {
      const bar = SEVERITY[this.throwOn] ?? 0;
      const worst = found.find((v) => (SEVERITY[v.severity] ?? 9) <= bar);
      if (worst) {
        const e = new Error(`invariant violated [${worst.code}]: ${worst.text}`);
        e.violation = worst;
        e.all = found;
        throw e;
      }
    }
    return found;
  }

  reset() {
    this.counts.clear();
    this.firsts.length = 0;
    this.ticks = 0;
    this.checked = 0;
  }
}
