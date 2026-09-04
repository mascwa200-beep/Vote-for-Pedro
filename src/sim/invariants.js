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

import { FACINGS, SHIELD_OVERCHARGE } from './ship.js';
import { getShipClass } from '../world/ships.data.js';

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

/**
 * The modes the game is allowed to be in.
 *
 * Spelled out here rather than imported from `core/state.js`, because that
 * module imports this one and a cycle between the simulation and the thing that
 * checks the simulation is a bad trade for five strings. A test asserts this
 * set and `MODES` are the same set, so they cannot drift apart quietly.
 */
export const LEGAL_MODES = new Set(['bridge', 'transit', 'combat', 'mission', 'encounter']);

/** The states a member of the duty roster can be in. Mirrors `DutyOfficer`. */
export const DUTY_STATES = new Set(['aboard', 'assigned', 'recovering', 'lost']);

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
    // The ceiling is the OVERCHARGE ceiling, not the normal one.
    // `reinforceShield` deliberately pushes one facing past `maxShield` — that
    // is the entire point of the order — and the excess bleeds off over about
    // twenty seconds. This rule read the normal maximum, so an ordinary
    // tactical order put an anomaly in the ship's log every time it was given.
    // Found by the order monkey in tools/verify-app.mjs on its first run.
    const ceiling = num(s.maxShield) * SHIELD_OVERCHARGE;
    r.must(num(v) <= ceiling + 1e-6, 'ship.shield.overmax', 'error',
      `${who}: shields.${f} is ${v}, above the ${ceiling} ceiling`, who);
  }

  for (const [k, v] of Object.entries(s.subsystems ?? {})) {
    r.must(ok(v), 'ship.subsystem.finite', 'fatal', `${who}: subsystem ${k} is ${v}`, who);
    r.must(num(v) >= -1e-9 && num(v) <= 1 + 1e-9, 'ship.subsystem.range', 'error',
      `${who}: subsystem ${k} is ${v}, outside 0..1`, who);
  }

  // The grid never draws more than it has. `normalize` exists to guarantee
  // this and had two ways to fail: a protected subsystem was exempt from the
  // cap rather than only from being drained, and rounding four numbers up
  // could put the total back over it.
  if (s.power?.target) {
    let draw = 0;
    for (const v of Object.values(s.power.target)) {
      r.must(ok(v) && v >= 0, 'power.level', 'error', `${who}: a power level is ${v}`, who);
      draw += num(v);
    }
    r.must(draw <= num(s.power.cap) + 1e-6, 'power.overcap', 'error',
      `${who}: drawing ${Math.round(draw)} against a cap of ${s.power.cap}`, who);
  }

  r.must(ok(s.crew) && num(s.crew) >= 0, 'ship.crew', 'error',
    `${who}: crew is ${s.crew}`, who);
  r.must(num(s.crew) <= num(s.maxCrew) + 1e-6, 'ship.crew.overmax', 'error',
    `${who}: crew ${s.crew} exceeds complement ${s.maxCrew}`, who);
  r.must(ok(s.fires) && num(s.fires) >= 0, 'ship.fires', 'error',
    `${who}: fires is ${s.fires}`, who);
  r.must(ok(s.boarders) && num(s.boarders) >= 0, 'ship.boarders', 'error',
    `${who}: boarders is ${s.boarders}`, who);
  // Crew are people, and a fraction of a person is not one. Everything that
  // kills crew floors it except the repel loop, which subtracted a continuous
  // quantity — and since nothing had ever put a boarding party aboard, the
  // tactical overlay had never had the chance to print `Crew 426.1326943672293`
  // at a captain in the middle of a fight.
  r.must(Number.isInteger(num(s.crew)), 'ship.crew.fractional', 'error',
    `${who}: crew is ${s.crew}`, who);
  r.must(ok(s.torpedoes) && num(s.torpedoes) >= 0, 'ship.torpedoes', 'error',
    `${who}: torpedoes is ${s.torpedoes}`, who);

  // The one number that decides whether the ship can go anywhere, and the
  // sweep was not looking at it.
  //
  // Hull, shields, crew, torpedoes, fires, subsystems, power and position were
  // all checked here; the antimatter reserve was not, although it is saved to
  // disk and read by `plotTransit` on every course. A NaN in it is silent and
  // permanent: `fuel > NaN` is false, so every course at every warp factor is
  // approved; the subtraction that follows leaves NaN behind; and the next save
  // writes it out again. The load path now refuses a bad figure, and this is
  // the rule that says so out loud if one ever appears another way.
  r.must(ok(s.antimatter), 'ship.antimatter.finite', 'fatal',
    `${who}: antimatter is ${s.antimatter}`, who);
  r.must(num(s.antimatter) >= 0 && num(s.antimatter) <= 100 + 1e-6,
    'ship.antimatter.range', 'error',
    `${who}: antimatter is ${s.antimatter}, outside 0..100`, who);

  // ---- the breach, and the one way out of it ----
  // Slack, for the same reason the subsystem range has it. The countdown is
  // decremented by dt and then tested, so on the tick it expires it is a
  // fraction below zero before `destroy` fires — the fuzzer measured
  // -1.5e-13 — and nothing resets it afterwards. A millionth of a second is
  // far outside anything six hundred subtractions can accumulate and far
  // inside anything that would matter.
  r.must(ok(s.breachTimer) && num(s.breachTimer) >= -1e-6, 'ship.breachTimer', 'error',
    `${who}: breachTimer is ${s.breachTimer}`, who);
  // Ejecting the core IS how a breach ends. A ship doing both at once is
  // counting down to an explosion it has already prevented, and `ejectCore`
  // refuses to help because the core is not there to throw.
  r.must(!(s.breaching && s.coreEjected), 'ship.breach.ejected', 'error',
    `${who} is breaching with its core already ejected`, who);
  // Cloaking is a property of the hull, not a state anything can grant. A ship
  // that cannot cloak but is flagged cloaked collects the evade bonus in
  // `resolveHit` for free and cannot be decloaked by any order in the game.
  r.must(!(s.cloaked && s.cloakCapable === false), 'ship.cloak.incapable', 'error',
    `${who} is cloaked and has no cloaking device`, who);

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

    // The same rule for everyone else's lock, which nothing was checking.
    //
    // The player's lock was re-acquired every tick and cleared on withdrawal;
    // an AI captain's was neither. An ally whose target broke off went on
    // chasing a ship that is no longer simulated and stopped fighting for the
    // rest of the battle, with a live hostile alongside it. Nothing in the
    // game could see that had happened.
    for (const s of ships) {
      if (!s?.aiTarget) continue;
      r.must(seen.has(s.aiTarget), 'eng.aitarget.absent', 'error',
        `${s.name ?? 'a ship'} is locked on ${s.aiTarget.name ?? '?'}, which has left the fight`,
        s.name);
    }

    // ---- the terrain ----
    //
    // An arena is built once and never written to again, so everything here is
    // about a fight that has quietly become unfightable rather than about
    // drift. The one that matters is the last: a ship INSIDE a solid feature
    // cannot be shot from any direction, because every line to it crosses the
    // rock it is standing in. That is a hostile that cannot be killed, an end
    // condition that never fires, and the soft-lock shape this file exists for.
    const arena = eng.arena;
    r.must(!!arena, 'eng.arena.missing', 'error', 'the engagement has no arena');
    for (const f of arena?.features ?? []) {
      const tag = `${f?.kind ?? '?'} feature`;
      r.must(ok(f.x) && ok(f.y) && ok(f.z), 'arena.feature.finite', 'fatal',
        `${tag} is at ${f.x},${f.y},${f.z}`, tag);
      r.must(num(f.r) > 0, 'arena.feature.radius', 'error',
        `${tag} has radius ${f.r}`, tag);
      r.must(f.type === 'solid' || f.type === 'cloud', 'arena.feature.type', 'error',
        `${tag} has type ${f.type}`, tag);
      if (ok(f.x) && ok(f.y) && ok(f.z) && ok(f.r)) {
        const d = Math.hypot(num(f.x), num(f.y), num(f.z)) + num(f.r);
        r.must(d <= arenaRadius + ARENA_SLACK, 'arena.feature.outside', 'error',
          `${tag} reaches ${Math.round(d)} units, outside the ${arenaRadius}-unit arena`, tag);
      }
      if (f.type !== 'solid') continue;
      for (const s2 of ships) {
        if (!s2 || s2.destroyed || s2.withdrawn) continue;
        if (!ok(s2.x) || !ok(s2.y)) continue;
        const inside = Math.hypot(num(s2.x) - num(f.x), num(s2.y) - num(f.y),
          num(s2.z) - num(f.z)) < num(f.r);
        r.must(!inside, 'eng.ship.inside-rock', 'error',
          `${s2.name ?? 'a ship'} is inside a ${f.kind} — nothing can shoot it and nothing can be shot`,
          s2.name);
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

    // Help that is on its way to a fight that is over.
    //
    // `helpInbound` is a countdown with a ship at the end of it. Left set past
    // the battle it was called for, the next engagement gets a free ally
    // dropping out of warp for a call the captain never made.
    if (game.helpInbound) {
      r.must(fighting, 'game.help.orphan', 'error',
        'a ship is inbound to a battle that is not running');
      r.must(num(game.helpInbound.eta) < 1e4, 'game.help.eta', 'error',
        `the relief is ${game.helpInbound.eta} seconds out`);
    }

    // The con is a bridge thing, and a fight is the moment it matters most.
    if (game.conStation) {
      r.must(!!game.crew?.at?.(game.conStation), 'game.con.ghost', 'error',
        `the con is held by ${game.conStation}, and nobody alive is at that post`);
    }

    // The mode itself.
    //
    // Every rule above asks whether the mode is the RIGHT one and none of them
    // ever asked whether it is a mode at all. A garbage value out of an old or
    // hand-edited save routes to no screen: the game boots to a blank panel
    // that takes no orders, and nothing anywhere says why.
    r.must(LEGAL_MODES.has(game.mode), 'game.mode.unknown', 'fatal',
      `the game is in "${game.mode}" mode, which is not a mode`);

    // The hulk left after a battle.
    //
    // A wreck is the one thing a finished fight leaves lying in the world, and
    // nothing has ever checked it. It is read back by `stripWreck`, which
    // compares its system to where the ship is now, and by the machine shop,
    // which multiplies its tier into a materials yield — so a wreck naming a
    // system that does not exist is salvage you can never reach, and a
    // non-finite tier is a hold full of NaN duranium.
    if (game.wreck) {
      r.must(ok(game.wreck.hulls) && game.wreck.hulls >= 1, 'game.wreck.hulls', 'error',
        `a hulk of ${game.wreck.hulls} ships is adrift`);
      r.must(ok(game.wreck.tier) && game.wreck.tier >= 0, 'game.wreck.tier', 'error',
        `the hulk's tier is ${game.wreck.tier}`);
      r.must(!!game.wreck.systemId, 'game.wreck.nowhere', 'error',
        'a hulk is adrift in no system at all');
    }

    // The after-action record.
    //
    // `lastCombat` outlives the engagement it describes and is what the panel
    // after a fight reads — the panel used to do its own arithmetic and got the
    // casualty count wrong for the life of the game, reporting every death the
    // commission had ever suffered after every quiet battle. Now that it reads
    // this instead, this is worth guarding: a count larger than the crew is not
    // a number anybody should be shown.
    if (game.lastCombat) {
      const lost = game.lastCombat.crewLost;
      // Against the complement the battle was FOUGHT with, not the ship the
      // captain is on now — those are different ships after a loss or a command
      // offer, and comparing across them reported a Galaxy's casualties against
      // a Nebula's crew. Falls back to the current ship for a record written
      // before the complement was carried.
      const aboard = game.lastCombat.complement ?? game.ship?.maxCrew ?? Infinity;
      r.must(ok(lost) && lost >= 0 && lost <= aboard,
        'game.lastCombat.crew', 'error',
        `the last battle is recorded as costing ${lost} of a crew of ${aboard}`);
    }

    // An encounter that belongs somewhere else.
    //
    // The same orphan shape as `helpInbound` above, and the same cause: a
    // branch that started a fight and returned without clearing what it was
    // holding. A distress call that turned out to be a trap survived the
    // battle, and `hail` reads the encounter's faction before the
    // engagement's — so hailing anywhere afterwards opened a channel to the
    // ambushers, in a system they were never in. Invisible, because the
    // encounter panel only draws in ENCOUNTER mode.
    if (game.encounter?.system?.id) {
      r.must(game.encounter.system.id === game.locationId, 'game.encounter.elsewhere', 'error',
        `an encounter at ${game.encounter.system.id} is live while the ship is at ${game.locationId}`);
    }

    // An episode waiting for a fight that is not coming.
    //
    // A mission choice that orders a battle now holds its reward until the
    // battle is decided, and stays on its stage until then. That is right, and
    // it introduces a soft-lock: if the engagement is never started or is
    // dropped, the episode waits on a stage it can never leave and the captain
    // has no way to know why. The episode-graph walker found this the moment
    // the hold was written, which is exactly what it is for.
    const pendingMission = game.missions?.active?.pending;
    if (pendingMission) {
      const fightComing = (!!eng && !eng.over) || !!game.pendingCombat;
      r.must(fightComing, 'mission.awaiting-ghost', 'error',
        'an episode is waiting on a battle that is neither running nor queued');
    }

    // "You shot first" is something about a fight, and a fight is running or
    // it is not.
    //
    // `firstStrike` is set by opening fire on an encounter that was not
    // hostile, and cleared by `finishCombat` on the line after the engagement
    // itself. Between those two moments a fight is always running — so this
    // flag standing on its own means it has outlived the thing it describes,
    // and `resolveHail` will go on taking a quarter off the chance of being
    // heard for a shot fired at somebody who is no longer there. Nothing else
    // in the game clears it.
    r.must(!game.firstStrike || (!!eng && !eng.over), 'game.firstStrike.orphan', 'error',
      'the captain is recorded as having fired first in a battle that is not running');

    // What the crew have learned about the hull.
    //
    // The track is saved, and everything downstream of it is arithmetic on the
    // ship's modifiers — so a bad figure here is the antimatter problem again:
    // silent, permanent, and written back out on the next save.
    if (game.mastery) {
      r.must(ok(game.mastery.current) && num(game.mastery.current) >= 0,
        'mastery.points', 'error',
        `mastery on this hull is ${game.mastery.current}`);
      // A doctrine can only be committed to by a crew that has earned the
      // slot. One held below the fifth tier would be modifiers the ship has
      // not paid for, and `shipMods` reads the slot rather than the record.
      r.must(!game.mastery.traits?.[game.mastery.classId] || game.mastery.tier >= 5,
        'mastery.trait.unearned', 'error',
        'a standing doctrine is set on a hull the crew do not know well enough');
    }

    // A career is a finite number of starships.
    //
    // Losing one costs the hull and Starfleet assigns another; losing a second
    // ends the commission, because Kirk was given exactly one Enterprise-A
    // (RESEARCH.md §21). A game still running past that has lost count, and a
    // negative or fractional count is arithmetic that has gone wrong.
    r.must(ok(game.shipsLost) && num(game.shipsLost) >= 0
      && Number.isInteger(num(game.shipsLost)),
      'game.shipsLost', 'error', `ships lost is ${game.shipsLost}`);
    r.must(num(game.shipsLost) <= 1 || game.over === true, 'game.shipsLost.overrun', 'error',
      `${game.shipsLost} ships lost and the commission is still running`);

    // An offer of a hull that does not exist cannot be accepted, and would sit
    // on the screen forever as a button that refuses itself.
    if (game.commandOffer) {
      r.must(!!getShipClass(game.commandOffer.classId), 'game.commandOffer.ghost', 'error',
        `Starfleet is offering a ${game.commandOffer.classId}, which is not a class`);
      r.must(game.commandOffer.classId !== game.ship?.classId, 'game.commandOffer.same', 'error',
        'Starfleet is offering the ship the captain is already flying');
    }

    // The duty roster, and the details that are out on it.
    //
    // These are people, and a fight can hurt them: somebody counted as both
    // lost and out on an assignment is a casualty who is still working, and a
    // detail naming somebody who is not on the roster pays out to nobody.
    const roster = game.dutyRoster ?? [];
    for (const person of roster) {
      r.must(DUTY_STATES.has(person.state), 'duty.state', 'error',
        `${person.name} is "${person.state}", which is not a state`, person.name);
      r.must(ok(person.expertise) && ok(person.discipline), 'duty.scores', 'error',
        `${person.name} has scores of ${person.expertise}/${person.discipline}`, person.name);
    }
    const assigned = new Set();
    for (const job of game.assignments ?? []) {
      r.must(ok(job.hoursRemaining), 'duty.assignment.hours', 'error',
        `a detail has ${job.hoursRemaining} hours left on it`);
      for (const id of job.team ?? []) {
        const person = roster.find((p) => p.id === id);
        r.must(!!person, 'duty.assignment.ghost', 'error',
          `a detail names ${id}, who is not aboard`);
        r.must(person?.state !== 'lost', 'duty.assignment.dead', 'error',
          `${person?.name ?? id} is out on a detail and also dead`, person?.name);
        r.must(!assigned.has(id), 'duty.assignment.twice', 'error',
          `${person?.name ?? id} is out on two details at once`, person?.name);
        assigned.add(id);
      }
    }
    // Somebody marked as out who is not on any detail is a person the roster
    // will never offer again — the state leaks and the slot never comes back.
    for (const person of roster) {
      if (person.state !== 'assigned') continue;
      r.must(assigned.has(person.id), 'duty.stranded', 'error',
        `${person.name} is marked as out and is on no detail`, person.name);
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
