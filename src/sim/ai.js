// Enemy and allied captains.
//
// Each faction flies differently, and the differences are mechanical, not
// cosmetic: a Bird-of-Prey really does cloak, close, and alpha-strike; a Galor
// really does hold at beam range and grind; Jem'Hadar really do ram.

import { FACTIONS } from '../world/factions.data.js';
import { WEAPON_RANGE } from './combat.js';

const DECISION_INTERVAL = 0.5; // seconds between re-evaluations

/** Preferred engagement distance for a ship's best weapon. */
function preferredRange(ship) {
  if (!ship.weapons.length) return 900;
  const types = ship.weapons.map((w) => w.type);
  if (types.includes('cannon')) return 300;
  if (types.includes('beam')) return 620;
  return 800;
}

/** Steer toward an absolute bearing. */
function steerTo(ship, x, y) {
  ship.desiredHeading = Math.atan2(y - ship.y, x - ship.x) * 180 / Math.PI;
}

/** Present the healthiest shield facing toward the threat. */
function presentStrongestShield(ship, threat) {
  const strongest = ['fore', 'starboard', 'aft', 'port']
    .reduce((best, f) => (ship.shieldPctOf(f) > ship.shieldPctOf(best) ? f : best), 'fore');
  const toThreat = Math.atan2(threat.y - ship.y, threat.x - ship.x) * 180 / Math.PI;
  const offset = { fore: 0, starboard: -90, aft: 180, port: 90 }[strongest];
  ship.desiredHeading = toThreat + offset;
}

export function chooseAction(ship, engagement, dt, opts = {}) {
  if (ship.destroyed) return;

  ship.aiTimer = (ship.aiTimer ?? 0) - dt;
  const decide = ship.aiTimer <= 0;
  if (decide) ship.aiTimer = DECISION_INTERVAL;

  const doctrine = FACTIONS[ship.faction]?.doctrine ?? 'balanced';
  const rng = engagement.rng;

  // Pick a target.
  if (!ship.aiTarget || ship.aiTarget.destroyed) {
    if (opts.allyOf) {
      ship.aiTarget = engagement.liveHostiles[0] ?? null;
    } else {
      const candidates = [engagement.player, ...engagement.allies].filter((s) => !s.destroyed);
      // Prefer whoever is hurting them most, otherwise the player.
      ship.aiTarget = candidates.includes(engagement.player) ? engagement.player : candidates[0];
    }
  }
  const target = ship.aiTarget;
  if (!target || target.destroyed) return;

  const distance = ship.distanceTo(target);
  const want = preferredRange(ship);
  const hullPct = ship.hullPct;

  // ---- Fleeing ----
  if (!opts.allyOf && !ship.fleeing) {
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
    steerTo(ship, ship.x + (ship.x - target.x), ship.y + (ship.y - target.y));
    ship.throttle = 1;
    if (ship.cloakCapable && !ship.cloaked && ship.cloakCooldown <= 0) ship.cloak();
    return;
  }

  // ---- Jem'Hadar ram ----
  if (ship.cls.ramsWhenDoomed && hullPct < 0.2) {
    steerTo(ship, target.x, target.y);
    ship.throttle = 1;
    if (distance < 40) {
      target.takeDamage(ship.maxHull * 0.35, { bearing: target.bearingFrom(ship), type: 'kinetic', rng });
      ship.destroy('deliberate collision');
      engagement.onDestroyed(ship, ship);
      engagement.pushLog(`${ship.name} rammed us.`, 'tactical');
    }
    return;
  }

  // ---- Cloak-and-strike ----
  if (doctrine === 'ambush' && ship.cloakCapable) {
    if (ship.cloaked) {
      steerTo(ship, target.x, target.y);
      ship.throttle = 0.9;
      // Decloak inside knife range with everything charged.
      if (distance < want * 0.8) {
        ship.decloak();
        engagement.pushLog(`${ship.name} is decloaking!`, 'tactical');
        engagement.effects.push({ kind: 'decloak', x: ship.x, y: ship.y, life: 1.0 });
      }
      return;
    }
    // Re-cloak to reset the engagement once shields are thin.
    if (decide && ship.shieldPct < 0.35 && ship.cloakCooldown <= 0 && distance > 350) {
      ship.cloak();
      engagement.effects.push({ kind: 'cloak', x: ship.x, y: ship.y, life: 1.0 });
      return;
    }
  }

  // ---- Manoeuvre ----
  if (decide) {
    if (distance > want * 1.15) {
      steerTo(ship, target.x, target.y);
      ship.throttle = doctrine === 'aggressive' ? 1 : 0.8;
    } else if (distance < want * 0.55) {
      // Too close for a cruiser's arcs — open the range.
      if (doctrine === 'attrition' || doctrine === 'territorial') {
        steerTo(ship, ship.x - (target.x - ship.x), ship.y - (target.y - ship.y));
        ship.throttle = 0.7;
      } else {
        steerTo(ship, target.x, target.y);
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
      }
      ship.throttle = 0.55;
    }

    // Power doctrine.
    if (ship.shieldPct < 0.3) ship.power.applyPreset('defense');
    else if (hullPct > 0.6 && distance < want * 1.2) ship.power.applyPreset('attack');
    else ship.power.applyPreset('balanced');
  }

  // ---- Tholian web ----
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
