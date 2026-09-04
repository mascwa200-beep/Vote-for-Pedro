// Enemy and allied captains.
//
// Each faction flies differently, and the differences are mechanical, not
// cosmetic: a Bird-of-Prey really does cloak, close, and alpha-strike; a Galor
// really does hold at beam range and grind; Jem'Hadar really do ram.

import { FACTIONS } from '../world/factions.data.js';
import { WEAPON_RANGE, stillEngaged } from './combat.js';
import { facingForDirection } from './ship.js';
import { chooseTactic, tickTactics } from './tactics.js';
import { inCover, coverPoint, steerAround } from './cover.js';

const DECISION_INTERVAL = 0.5; // seconds between re-evaluations

/**
 * Doctrines that take a ship rather than only sink one.
 *
 * The Borg assimilate, which is boarding by definition. Klingons take a
 * bridge — the same act the player's own `boarding_action` models from the
 * other side. Pirates want the hull intact, so an opportunist would far
 * rather board than destroy. The Dominion does not weigh what it costs.
 *
 * Romulans are deliberately absent: their doctrine is to strike from cloak
 * and leave, and a ship that decloaks alongside to send people across has
 * given up the only advantage it was flying for. Tholians and the defensive
 * factions do not board at all.
 */
const BOARDING_DOCTRINES = new Set(['assimilate', 'aggressive', 'opportunist', 'fanatic']);

/**
 * And how readily each of them takes the chance when it comes.
 *
 * A boarding party is a commitment: a fifth of the complement, off the ship,
 * in somebody else's corridors. Not every captain who CAN will. Without this
 * the window opens in most engagements where the player drops under a third
 * of his hull, and something that happens every time is weather rather than
 * an event.
 *
 * The Borg do not weigh it. Pirates want the hull more than the kill, so an
 * opportunist takes it more often than a Klingon does — and the Dominion,
 * which is perfectly willing to die shooting, is the least interested in
 * taking anything alive.
 */
const BOARDING_RESOLVE = {
  assimilate: 1, opportunist: 0.6, aggressive: 0.5, fanatic: 0.35,
};

/**
 * Beaming range for a boarding party, and the state that allows it.
 *
 * The mirror of what the game already asks of the PLAYER before offering
 * `boarding_action` (`Game.availableAwayMissions`): shields flat, the ship
 * beaten or lamed, and close enough to beam across. Symmetric on purpose —
 * the rule a captain learns by boarding somebody is the rule that gets used
 * on him, and a rule you can learn is the difference between a mechanic and
 * an ambush.
 */
export const BOARDING_RANGE = 900;
const BOARDING_SHIELD_MAX = 0.05;
const BOARDING_HULL_MAX = 0.35;
const BOARDING_ENGINES_MAX = 0.15;

/** How much of her complement a ship will put aboard somebody else's. */
const BOARDING_PARTY_SHARE = 0.18;

/** Below this she has nobody to spare. */
const BOARDING_MIN_CREW = 30;

/**
 * And she has to be winning.
 *
 * A captain sends his security detail onto somebody else's ship when he can
 * afford to be without them, not when he is himself about to die. Without
 * this the condition is met in essentially every engagement — the player's
 * hull dips under a third at some point in almost all of them and a facing is
 * almost always flat — and a boarding party that comes every time is weather
 * rather than an event.
 */
const BOARDING_ATTACKER_HEALTH = 0.5;

/**
 * Is `ship` in a state `from` could board her?
 *
 * The shield test is on the facing TOWARD the boarder, not on the average of
 * all six — and that distinction is the whole of it. `shieldPct` is the mean
 * across the facings, and combat never drives that mean to five per cent
 * because fire lands on one facing while the other five regenerate: across
 * forty ordinary engagements the lowest mean a hostile ever reached was 0.497,
 * ten times what the condition asked for. So `boarding_action` — three steps,
 * extreme hazard, the alternative to killing a ship that the game is built
 * around — was never once offered in a fight. Every test that exercised it
 * zeroed all six facings by hand, which is a state the simulation does not
 * produce.
 *
 * The facing toward the boarder is also simply what beaming through somebody's
 * shields means. You go through the gap. On the same numbers it comes up in
 * eleven fights in forty.
 */
export function boardableState(ship, from) {
  const facing = facingForDirection(ship.directionFrom(from));
  return ship.shieldPctOf(facing) <= BOARDING_SHIELD_MAX
    && (ship.hullPct <= BOARDING_HULL_MAX || ship.subsystems.engines <= BOARDING_ENGINES_MAX);
}

/** Preferred engagement distance for a ship's best weapon. */
function preferredRange(ship) {
  if (!ship.weapons.length) return 900;
  const types = ship.weapons.map((w) => w.type);
  if (types.includes('cannon')) return 300;
  if (types.includes('beam')) return 620;
  return 800;
}

/** Steer toward a point, in both axes. */
function steerTo(ship, x, y, z = null) {
  ship.desiredHeading = Math.atan2(y - ship.y, x - ship.x) * 180 / Math.PI;
  if (z !== null) {
    const flat = Math.hypot(x - ship.x, y - ship.y);
    ship.desiredPitch = Math.atan2(z - (ship.z ?? 0), flat) * 180 / Math.PI;
  }
}

/**
 * Steer toward a point, going AROUND anything solid on the way.
 *
 * Every manoeuvre in this file used to aim straight through the terrain.
 * `Combat.keepOutOfRocks` catches the result and shoves the ship back onto the
 * rock's skin, every tick, which is a floor and not a helmsman: a hostile that
 * decided to cross a two-hundred-unit rock spent the crossing being teleported.
 *
 * One deflection step, recomputed each decision tick, which is what a helmsman
 * does. A path plan would be a lie about how much this AI knows.
 */
function flyTo(ship, arena, x, y, z = null, ignore = null) {
  const aim = steerAround(arena, ship, { x, y, z: z ?? (ship.z ?? 0) }, { ignore });
  steerTo(ship, aim.x, aim.y, z === null ? null : aim.z);
}

/**
 * How badly hurt a ship has to be before it goes looking for a rock.
 *
 * Hull, not `shieldPct`: the mean of six facings is the trap this codebase has
 * already fallen into once, and combat does not drive it low — over ninety-six
 * fights the mean sat above 0.4 for most of the time a ship was visibly losing.
 * Hull is what a captain actually watches.
 */
const COVER_DOCTRINE = {
  // Never. The Borg do not take cover and neither do the Jem'Hadar.
  assimilate: 0, fanatic: 0,
  // Only when it is nearly over.
  aggressive: 0.25,
  // Readily: these are the captains whose whole method is not being hit.
  ambush: 0.6, opportunist: 0.65, defensive: 0.6, attrition: 0.5,
  territorial: 0.5, balanced: 0.45,
};

/**
 * Shields back to here and they come out again — measured on the WEAKEST
 * facing, not the mean of six.
 *
 * The mean is the trap this codebase has fallen into before. Written against
 * `shipPct` the exit fired on the same decision tick as the entry on almost
 * every attempt: over forty-eight fights the hostiles ran for cover 371 times
 * and came back out 357, spending 2.0% of their ticks hidden. A ship at 45% hull
 * routinely has a mean shield above 0.55 and one facing at nothing, which is
 * exactly the ship that should be behind a rock.
 */
const COVER_LEAVE_SHIELDS = 0.6;
const weakestShield = (ship) => Math.min(
  ...['fore', 'aft', 'port', 'starboard', 'dorsal', 'ventral'].map((f) => ship.shieldPctOf(f)),
);

/** Time actually behind the rock before coming out is even considered. */
const COVER_MIN_SHELTER = 3;

/**
 * And how long before the same captain will do it again.
 *
 * Hull does not regenerate, so a ship that hides on a hull threshold will meet
 * that threshold again the moment it leaves. Without a cooldown that is a
 * stutter at the decision-tick rate; with one it is a peek cycle, which is what
 * fighting from cover looks like.
 */
const COVER_COOLDOWN = 14;

/**
 * And a hard ceiling on how long anybody may sit behind a rock.
 *
 * Cover is symmetric — the rock that stops their shot stops yours — so a ship
 * that hides indefinitely has left the battle, and a battle where both sides
 * have left is one the player watches. Twenty-two seconds is long enough to
 * get a facing back and short enough that a fight never stalls on it.
 */
const COVER_MAX = 22;

/**
 * Decide whether this captain is behind a rock, running for one, or fighting.
 *
 * Returns true when the ship's manoeuvre for this tick is settled and the
 * caller should not fly it anywhere else.
 */
function useTerrain(ship, target, engagement, doctrine, decide) {
  const arena = engagement.arena;
  const threshold = COVER_DOCTRINE[doctrine] ?? 0.45;
  if (!arena?.features?.length || threshold <= 0) {
    // Clear rather than leave: an engagement can lose its terrain the moment
    // reinforcements rebuild the arena, and a stale flag is a ship that never
    // fights again.
    ship.hiding = false;
    return false;
  }

  if (ship.coverCooldown > 0 && decide) ship.coverCooldown -= DECISION_INTERVAL;

  if (ship.hiding) {
    if (decide) ship.hidingFor = (ship.hidingFor ?? 0) + DECISION_INTERVAL;
    const sheltered = (ship.sheltered ?? 0) >= COVER_MIN_SHELTER;
    const recovered = sheltered && weakestShield(ship) >= COVER_LEAVE_SHIELDS;
    if (recovered || ship.hidingFor > COVER_MAX) {
      ship.hiding = false;
      ship.hidingFor = 0;
      ship.sheltered = 0;
      ship.coverCooldown = COVER_COOLDOWN;
      // A captain who has got his shields back says so, once. Without it the
      // ship simply reappears and the player has no idea anything happened.
      if (recovered) {
        engagement.pushLog(`${ship.name} is coming back out.`, 'tactical');
      }
      return false;
    }
  } else if (decide && ship.hullPct < threshold && !ship.cloaked
    && !(ship.coverCooldown > 0)) {
    const spot = coverPoint(arena, ship, target);
    if (!spot) return false;
    ship.hiding = true;
    ship.hidingFor = 0;
    ship.coverSpot = spot;
    engagement.pushLog(`${ship.name} is running for cover.`, 'tactical');
  }
  if (!ship.hiding) return false;

  // Already behind it: hold station on the shadow, and put everything into
  // the shields.
  //
  // Station-keeping on the SPOT, not turning to present a shield. The shadow
  // sweeps round the rock as the player orbits, so holding cover means
  // following it — and a ship that spent the shelter pointing its best facing
  // at the enemy then had to turn a hundred and eighty degrees to chase the
  // shadow when it moved. Traced on one episode: five seconds behind the rock,
  // then fourteen seconds flying steadily AWAY from cover at full throttle
  // while a Galor's turn rate brought the nose round.
  if (inCover(arena, ship, target)) {
    ship.sheltered = (ship.sheltered ?? 0) + (decide ? DECISION_INTERVAL : 0);
    ship.coverSpot = coverPoint(arena, ship, target) ?? ship.coverSpot;
    if (ship.coverSpot) {
      flyTo(ship, arena, ship.coverSpot.x, ship.coverSpot.y, ship.coverSpot.z, ship.coverSpot.rock);
    }
    ship.throttle = 0.35;
    ship.power.applyPreset('defense');
    return true;
  }

  // Still running, and re-aimed EVERY FRAME rather than every decision tick.
  //
  // Cover is not a place, it is a place relative to somebody who is moving: the
  // player orbits, so a rock's shadow sweeps round it, and a hostile that
  // re-aims twice a second is chasing a shadow that has already gone. Measured,
  // re-aiming on the decision tick left a ship that had committed to hiding
  // actually behind something only 38% of the time.
  //
  // It costs one pass over the rocks per hostile per frame, which is sixteen
  // distance tests for a ship that has already decided it is hiding.
  ship.coverSpot = coverPoint(arena, ship, target) ?? ship.coverSpot;
  const spot = ship.coverSpot;
  if (!spot) { ship.hiding = false; return false; }
  flyTo(ship, arena, spot.x, spot.y, spot.z, spot.rock);
  ship.throttle = 1;
  ship.power.applyPreset('defense');
  return true;
}

/**
 * Present the healthiest shield facing toward the threat.
 *
 * Only the four lateral facings are candidates. Dorsal and ventral exist and
 * take fire, but rolling a starship onto its back to put its belly toward an
 * attacker is not a manoeuvre any captain here would order, and an AI that did
 * it would look broken rather than clever.
 */
function presentStrongestShield(ship, threat) {
  const strongest = ['fore', 'starboard', 'aft', 'port']
    .reduce((best, f) => (ship.shieldPctOf(f) > ship.shieldPctOf(best) ? f : best), 'fore');
  const toThreat = Math.atan2(threat.y - ship.y, threat.x - ship.x) * 180 / Math.PI;
  const offset = { fore: 0, starboard: -90, aft: 180, port: 90 }[strongest];
  ship.desiredHeading = toThreat + offset;
  ship.desiredPitch = 0;
}

/**
 * Climb or dive to come at the target from a facing it is not presenting.
 *
 * The whole point of a third axis is that it is a way to get at a weak shield
 * without having to out-turn anybody. An aggressive captain uses it; a
 * defensive one levels off, because a ship that is climbing is a ship that is
 * not shooting straight.
 */
function chooseElevation(ship, target, doctrine, rng) {
  const dorsalWeak = target.shieldPctOf('dorsal') < target.shieldPctOf('ventral');
  const bias = dorsalWeak ? 1 : -1;
  const commitment = doctrine === 'aggressive' ? 1 : doctrine === 'ambush' ? 0.8 : 0.45;
  const spread = ship.orbitDir ?? (ship.orbitDir = rng.chance(0.5) ? 1 : -1);
  // Aim to sit above or below the target rather than level with it.
  const wantOffset = bias * commitment * 220 * (0.7 + 0.3 * spread);
  return (target.z ?? 0) + wantOffset;
}

/**
 * What this captain shoots at when he has a choice.
 *
 * The player has been able to call a shot at a named system since the order
 * line existed, and it is worth about three times the subsystem damage of
 * untargeted fire — `takeDamage` applies 3.2x the hull fraction to a named
 * system against 1.8x, and then only on a roll it usually loses. No hostile has
 * ever done it: `fireWeapon` reads `this.targetedSubsystem` for the player and
 * passes null for everybody else, so a Klingon captain who has been fighting
 * for two minutes has never once tried for the engines.
 *
 * One system per doctrine, and each is the one that doctrine's whole method
 * depends on:
 *
 *   A Romulan strikes and leaves, so he wants you unable to follow.
 *   A pirate wants the hull intact and you unable to leave with it.
 *   The Borg want the shields down, which is the boarding precondition their
 *     own `boardableState` names.
 *   The Dominion do not weigh what it costs, so they shoot at the warp core.
 *   Cardassians grind, which means taking the guns away first.
 *   Starfleet disables rather than destroys — the one allied entry, and the
 *     reason allies get a doctrine at all.
 */
const CALLED_SHOT = {
  ambush: 'engines',
  opportunist: 'engines',
  territorial: 'engines',
  assimilate: 'shields',
  fanatic: 'warpcore',
  attrition: 'weapons',
  aggressive: 'shields',
  defensive: 'weapons',
  balanced: 'weapons',
};

/**
 * And they only start calling shots once there is something to call one at.
 *
 * Subsystem damage needs a hit that reached the hull, so aiming at a system
 * through a full shield is not wrong, it is simply nothing — which makes the
 * threshold a matter of what the player is told rather than of arithmetic. A
 * captain announcing "they are firing on our engines" while the shields are at
 * full is announcing weather.
 */
const CALLED_SHOT_SHIELDS = 0.45;

export function chooseAction(ship, engagement, dt, opts = {}) {
  // Every frame, not only on a decision tick: a cooldown that only ran down
  // twice a second would run at two thirds speed at 30fps.
  tickTactics(ship, dt);
  if (ship.destroyed) return;

  ship.aiTimer = (ship.aiTimer ?? 0) - dt;
  const decide = ship.aiTimer <= 0;
  if (decide) ship.aiTimer = DECISION_INTERVAL;

  const doctrine = FACTIONS[ship.faction]?.doctrine ?? 'balanced';
  const rng = engagement.rng;

  // Pick a target — anything that is no longer in the fight is not one.
  if (!stillEngaged(ship.aiTarget)) {
    if (opts.allyOf) {
      ship.aiTarget = engagement.liveHostiles[0] ?? null;
    } else {
      const candidates = [engagement.player, ...engagement.allies].filter(stillEngaged);
      // Prefer whoever is hurting them most, otherwise the player.
      ship.aiTarget = candidates.includes(engagement.player) ? engagement.player : candidates[0];
    }
  }
  const target = ship.aiTarget;
  if (!stillEngaged(target)) return;

  const distance = ship.distanceTo(target);
  const want = preferredRange(ship);
  const hullPct = ship.hullPct;

  // ---- Fleeing ----
  if (!opts.allyOf && !ship.fleeing && !engagement.relentless) {
    const breakPoint = doctrine === 'fanatic' ? 0.0
      : doctrine === 'aggressive' ? 0.12
      : doctrine === 'opportunist' ? 0.45
      : doctrine === 'assimilate' ? 0.0
      : 0.2;
    if (hullPct < breakPoint && ship.crew > 0) {
      ship.fleeing = true;
      engagement.pushLog(`${ship.name} is breaking off.`, 'tactical');
    }
  }
  if (ship.fleeing) {
    // Whatever it was doing behind a rock, it is running now. Left set, the
    // flag outlives the behaviour: `useTerrain` is never reached from here, so
    // a ship that started hiding and then broke off stayed "hiding" for the
    // rest of the battle — measured at fifty-nine seconds against a
    // twenty-two-second ceiling that was working perfectly.
    ship.hiding = false;
    ship.hidingFor = 0;
    ship.sheltered = 0;
    // Behind a rock on the way out, when there is one. A ship running in a
    // straight line away from somebody is a ship being shot in the back for as
    // long as the run lasts, and the terrain has been there the whole time.
    const bolthole = coverPoint(engagement.arena, ship, target, { maxRun: 900 });
    if (bolthole && !inCover(engagement.arena, ship, target)) {
      flyTo(ship, engagement.arena, bolthole.x, bolthole.y, bolthole.z, bolthole.rock);
    } else {
      flyTo(ship, engagement.arena, ship.x + (ship.x - target.x), ship.y + (ship.y - target.y));
    }
    ship.throttle = 1;
    if (ship.cloakCapable && !ship.cloaked && ship.cloakCooldown <= 0) ship.cloak();
    return;
  }

  // ---- Jem'Hadar ram ----
  if (ship.cls.ramsWhenDoomed && hullPct < 0.2) {
    // In three dimensions, because `distance` is measured in three. Steering
    // in the plane at a target twenty degrees above you closes the horizontal
    // gap and nothing else, so the 40-unit contact test was never satisfied: a
    // doomed attack ship flew past, under, and out of the fight instead of
    // doing the one thing its whole doctrine exists to do.
    // Straight at them, terrain and all: a ship that has decided to ram is
    // not steering round anything, and `flyTo` here would have it swerve
    // politely past the rock and the target both.
    steerTo(ship, target.x, target.y, target.z ?? 0);
    ship.throttle = 1;
    if (distance < 40) {
      target.takeDamage(ship.maxHull * 0.35, { direction: target.directionFrom(ship), type: 'kinetic', rng });
      ship.destroy('deliberate collision');
      engagement.onDestroyed(ship, ship);
      engagement.pushLog(`${ship.name} rammed us.`, 'tactical');
    }
    return;
  }

  // ---- Boarding ----
  //
  // `ship.boarders` was a counter the whole game could only decrement: the
  // defence in `Ship.update` was written in full — defenders drawn from the
  // crew, losses on both sides, a subsystem wrecked every second or so — and
  // nothing anywhere had ever put a single intruder aboard anything. The
  // `intruder_alert` cue was synthesised and reserved, and the `boarding_drill`
  // duty detail rehearsed repelling people who could not arrive.
  //
  // Once per ship: a captain who has sent his security detail across has sent
  // it, and cannot send it again.
  if (decide && !opts.allyOf && !ship.boardingDecided && !ship.cloaked
    && BOARDING_DOCTRINES.has(doctrine)
    && ship.crew > BOARDING_MIN_CREW
    && ship.hullPct > BOARDING_ATTACKER_HEALTH
    && distance < BOARDING_RANGE
    && boardableState(target, ship)) {
    // Decided the first time the window opens and not revisited: a captain
    // who let the moment go has let it go, and one who took it has his people
    // on somebody else's ship and cannot send them twice.
    ship.boardingDecided = true;
    if (rng.chance(BOARDING_RESOLVE[doctrine] ?? 0)) {
      const party = Math.round(ship.crew * BOARDING_PARTY_SHARE);
      if (target.receiveBoarders(party, ship) > 0) {
        engagement.pushLog(
          `${ship.name} has beamed a boarding party aboard. Intruder alert.`,
          'tactical',
        );
        return;
      }
    }
  }

  // ---- Cloak-and-strike ----
  if (doctrine === 'ambush' && ship.cloakCapable) {
    if (ship.cloaked) {
      flyTo(ship, engagement.arena, target.x, target.y, chooseElevation(ship, target, doctrine, rng));
      ship.throttle = 0.9;
      // Decloak inside knife range with everything charged.
      if (distance < want * 0.8) {
        ship.decloak();
        engagement.pushLog(`${ship.name} is decloaking!`, 'tactical');
        // `z` and `classId` for the same reason the impact flare carries them:
        // the renderer places the effect in three dimensions and sizes it to
        // the hull it belongs to. Without them the shell sat on the ecliptic
        // at a stock size while the ship it was veiling was somewhere else.
        engagement.effects.push({
          kind: 'decloak', x: ship.x, y: ship.y, z: ship.z ?? 0,
          classId: ship.classId, life: 1.0,
        });
      }
      return;
    }
    // Re-cloak to reset the engagement once shields are thin.
    if (decide && ship.shieldPct < 0.35 && ship.cloakCooldown <= 0 && distance > 350) {
      ship.cloak();
      engagement.effects.push({
        kind: 'cloak', x: ship.x, y: ship.y, z: ship.z ?? 0,
        classId: ship.classId, life: 1.0,
      });
      return;
    }
  }

  // ---- The other captain's own orders ----
  //
  // Before the manoeuvre, because a captain decides what to do about his
  // shields and then flies accordingly, not the other way round. Allies get
  // them too: a ship detached to stand with you is crewed by people who went
  // to the same academy.
  if (decide) chooseTactic(ship, target, engagement, doctrine);

  // ---- Called shots ----
  //
  // Decided here rather than at the trigger so it survives every branch below:
  // a ship holding station behind a rock is still shooting at the same system
  // it was shooting at before it went there.
  if (decide) {
    const want = CALLED_SHOT[doctrine] ?? null;
    // The facing THEY are shooting at, which is the one their shots have to
    // get through — not the mean of six, and not the target's own bow.
    const facing = facingForDirection(target.directionFrom(ship));
    const through = target.shieldPctOf(facing) <= CALLED_SHOT_SHIELDS;
    ship.calledShot = want && through ? want : null;
    // Said once per ship, not on every change. The threshold is a shield
    // facing and a shield facing crosses it repeatedly, so announcing each
    // crossing is a line every few seconds from every hostile on the board.
    if (ship.calledShot && !ship.calledShotSaid && !opts.allyOf) {
      ship.calledShotSaid = true;
      engagement.pushLog(`${ship.name} is firing on our ${ship.calledShot}.`, 'tactical');
    }
  }

  // ---- Terrain ----
  //
  // Before the manoeuvre and after the tactic, because a captain who has
  // decided to break off behind a rock still wants his evasive pattern
  // running while he does it.
  if (useTerrain(ship, target, engagement, doctrine, decide)) {
    for (const w of ship.weapons) {
      if (distance <= (WEAPON_RANGE[w.type] ?? 900)) engagement.fireWeapon(ship, w, target);
    }
    return;
  }

  // ---- Manoeuvre ----
  if (decide) {
    if (distance > want * 1.15) {
      flyTo(ship, engagement.arena, target.x, target.y, chooseElevation(ship, target, doctrine, rng));
      ship.throttle = doctrine === 'aggressive' ? 1 : 0.8;
    } else if (distance < want * 0.55) {
      // Too close for a cruiser's arcs — open the range.
      if (doctrine === 'attrition' || doctrine === 'territorial') {
        flyTo(ship, engagement.arena,
          ship.x - (target.x - ship.x),
          ship.y - (target.y - ship.y),
          (ship.z ?? 0) - ((target.z ?? 0) - (ship.z ?? 0)));
        ship.throttle = 0.7;
      } else {
        flyTo(ship, engagement.arena, target.x, target.y, chooseElevation(ship, target, doctrine, rng));
        ship.throttle = 0.5;
      }
    } else {
      // In the pocket: orbit, and turn a good shield to the enemy if hurt.
      if (ship.shieldPct < 0.4) {
        presentStrongestShield(ship, target);
      } else {
        const toTarget = Math.atan2(target.y - ship.y, target.x - ship.x) * 180 / Math.PI;
        const lead = doctrine === 'aggressive' ? 0 : 25;
        ship.desiredHeading = toTarget + (ship.orbitDir ?? (ship.orbitDir = rng.chance(0.5) ? 1 : -1)) * lead;
        // Hold the elevation that keeps the target's weaker face toward us.
        ship.desiredPitch = ship.elevationTo(target);
      }
      ship.throttle = 0.55;
    }

    // Power doctrine.
    if (ship.shieldPct < 0.3) ship.power.applyPreset('defense');
    else if (hullPct > 0.6 && distance < want * 1.2) ship.power.applyPreset('attack');
    else ship.power.applyPreset('balanced');
  }

  // ---- Tholian web ----
  // A web does not outlive the ship spinning it. Without this the engagement
  // stays un-leaveable after the spinner is dead, which combined with a hostile
  // that has run out of reach is a soft-lock with no way out at all.
  if (engagement.webbed
    && !engagement.liveHostiles.some((s) => s.cls.websAfter)) {
    engagement.webbed = false;
    // Back to what the PLACE allows, not unconditionally true.
    //
    // A flat `= true` here means a Tholian web collapsing inside the Briar
    // Patch hands back a warp drive that metreon gas will not let form — one
    // temporary reason to be pinned expiring and cancelling a permanent one.
    engagement.canWarpOut = !engagement.arena?.noWarp;
    engagement.pushLog(engagement.canWarpOut
      ? 'The web is collapsing. Warp drive is ours again.'
      : 'The web is collapsing — though the gas will still not let a field form.',
    'science');
  }

  if (ship.cls.websAfter) {
    ship.webProgress = (ship.webProgress ?? 0) + dt;
    if (ship.webProgress > ship.cls.websAfter && !engagement.webbed) {
      engagement.webbed = true;
      engagement.canWarpOut = false;
      engagement.pushLog('The web has closed. We cannot go to warp.', 'science');
    }
  }

  // ---- Borg regeneration ----
  if (ship.cls.regenerates) {
    ship.hull = Math.min(ship.maxHull, ship.hull + ship.cls.regenerates * dt);
  }

  // ---- Fire ----
  for (const w of ship.weapons) {
    if (distance <= (WEAPON_RANGE[w.type] ?? 900)) {
      engagement.fireWeapon(ship, w, target);
    }
  }
}
