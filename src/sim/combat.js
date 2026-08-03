// Combat resolution.
//
// A tactical engagement is a fixed-step simulation in three dimensions. The
// player gives orders; helm and tactical execute them over time. Nothing
// resolves instantly, which is what makes power routing and facing decisions
// matter.
//
// Nothing here rolls a die. Accuracy, damage and evasion are continuous
// quantities built from the situation and the ship — the d20 belongs to the
// character sheet, not to whether a phaser connects.

import { emit } from '../core/events.js';
import { Ship, FACINGS, inArc, facingForBearing, facingForDirection } from './ship.js';
import { chooseAction } from './ai.js';

export const WEAPON_RANGE = {
  beam: 900,
  cannon: 620,
  torpedo: 1200,
};

/** Damage falls off with range; cannons fall off hardest. */
export function rangeFactor(type, distance) {
  const max = WEAPON_RANGE[type] ?? 900;
  if (distance > max) return 0;
  const t = distance / max;
  if (type === 'cannon') return Math.max(0.15, 1 - t * t * 1.15);
  if (type === 'torpedo') return 1;               // torpedoes track; no falloff
  return Math.max(0.3, 1 - t * 0.7);              // beams
}

export class Engagement {
  /**
   * @param {Ship} player
   * @param {Ship[]} hostiles
   * @param {RNG} rng
   * @param {object} opts { allies, objective, escapeAt, name }
   */
  constructor(player, hostiles, rng, opts = {}) {
    this.player = player;
    this.hostiles = hostiles;
    this.allies = opts.allies ?? [];
    this.rng = rng;
    this.name = opts.name ?? 'Engagement';
    this.objective = opts.objective ?? 'destroy';
    this.time = 0;
    this.over = false;
    this.outcome = null;
    this.projectiles = [];
    this.effects = [];
    this.log = [];
    this.target = hostiles[0] ?? null;
    this.targetedSubsystem = null;
    this.autoFire = true;
    this.warpOutTimer = 0;
    // Consumed by the Tactical career's Called Shot.
    this.guaranteedCrits = 0;
    // Seconds of ion-pod decoy still confusing hostile targeting.
    this.decoyTimer = 0;
    this.canWarpOut = opts.canWarpOut !== false;

    this.placeCombatants();
  }

  get allShips() {
    return [this.player, ...this.allies, ...this.hostiles];
  }

  get liveHostiles() {
    return this.hostiles.filter((s) => !s.destroyed);
  }

  /**
   * Hostiles arrive spread across a shell rather than a fan.
   *
   * The elevations are deliberately modest — a few degrees, not a sphere's
   * worth. A patrol that opens from directly overhead is disorienting rather
   * than tactical, and the point of the third axis is that climbing is a
   * decision made during the fight, not the state it starts in.
   */
  placeCombatants() {
    this.player.x = 0; this.player.y = 0; this.player.z = 0;
    this.player.heading = 0; this.player.desiredHeading = 0;
    this.player.pitch = 0; this.player.desiredPitch = 0;

    this.hostiles.forEach((s, i) => {
      const angle = (-50 + i * 40) * Math.PI / 180;
      const dist = 700 + i * 90;
      // Alternate above and below, widening with each additional hull.
      const elevation = (i % 2 === 0 ? 1 : -1) * Math.min(18, 6 + i * 4) * Math.PI / 180;
      s.x = Math.cos(angle) * Math.cos(elevation) * dist;
      s.y = Math.sin(angle) * Math.cos(elevation) * dist;
      s.z = Math.sin(elevation) * dist;
      s.heading = (angle * 180 / Math.PI) + 180;
      s.desiredHeading = s.heading;
      s.pitch = 0;
      s.desiredPitch = 0;
      s.throttle = 0.5;
    });

    this.allies.forEach((s, i) => {
      s.x = -320 - i * 120;
      s.y = (i % 2 === 0 ? 1 : -1) * (140 + i * 60);
      s.z = (i % 2 === 0 ? -1 : 1) * (40 + i * 20);
      s.heading = 0; s.desiredHeading = 0;
      s.pitch = 0; s.desiredPitch = 0;
      s.throttle = 0.4;
    });
  }

  // ---------------- orders ----------------

  setTarget(ship) {
    if (ship && !ship.destroyed) {
      this.target = ship;
      this.pushLog(`Target locked: ${ship.name}.`, 'tactical');
      emit('combat:target', ship);
    }
  }

  cycleTarget() {
    const live = this.liveHostiles;
    if (!live.length) return;
    const idx = live.indexOf(this.target);
    this.setTarget(live[(idx + 1) % live.length]);
  }

  targetSubsystem(key) {
    this.targetedSubsystem = key;
    this.pushLog(key ? `Targeting ${key}.` : 'Targeting hull.', 'tactical');
  }

  setThrottle(v) { this.player.throttle = Math.max(0, Math.min(1, v)); }
  setHeading(deg) { this.player.desiredHeading = ((deg % 360) + 360) % 360; }

  setPitch(deg) { this.player.desiredPitch = Math.max(-70, Math.min(70, deg)); }

  /** Steer to bring the target into the forward arc, in both axes. */
  comeAboutTo(ship) {
    if (!ship) return;
    const abs = Math.atan2(ship.y - this.player.y, ship.x - this.player.x) * 180 / Math.PI;
    this.setHeading(abs);
    this.setPitch(this.player.elevationTo(ship));
  }

  evasive(on) {
    this.player.evasive = on;
    this.pushLog(on ? 'Evasive manoeuvres.' : 'Resuming standard flight.', 'helm');
  }

  /**
   * A hot, ship-shaped object in the water. For `seconds`, everything shooting
   * at us has to decide which return is the real one, and gets it wrong often
   * enough to matter.
   */
  deployDecoy(seconds) {
    this.decoyTimer = Math.max(this.decoyTimer, seconds);
    this.effects.push({ kind: 'explosion', x: this.player.x, y: this.player.y, z: this.player.z ?? 0, life: 0.8 });
    this.pushLog('Decoy away — their targeting solutions just got harder.', 'tactical');
  }

  /** Attempt to break off. Takes time, and the enemy gets those seconds. */
  beginWarpOut() {
    if (!this.canWarpOut) { this.pushLog('Cannot disengage — we are pinned.', 'helm'); return false; }
    if (this.player.subsystems.warpcore < 0.2 || this.player.coreEjected) {
      this.pushLog('Warp drive is offline. We cannot outrun them.', 'engineering');
      return false;
    }
    if (this.warpOutTimer > 0) return false;
    this.warpOutTimer = 8;
    this.pushLog('Helm plotting an escape course. Eight seconds to warp.', 'helm');
    emit('combat:warpout-begin');
    return true;
  }

  // ---------------- firing ----------------

  /** Fire everything that bears on the current target. */
  fireAll() {
    if (!this.target || this.target.destroyed) return 0;
    let fired = 0;
    for (const w of this.player.weapons) {
      if (this.fireWeapon(this.player, w, this.target)) fired++;
    }
    if (!fired) this.pushLog('No weapons bear on the target.', 'tactical');
    return fired;
  }

  fireWeapon(attacker, weapon, target) {
    if (!target || target.destroyed || attacker.destroyed) return false;
    if (weapon.cooldown > 0 || !weapon.enabled) return false;
    if (attacker.cloaked) return false;
    if (weapon.type === 'torpedo' && attacker.torpedoes <= 0) return false;
    if (attacker.subsystems.weapons <= 0.05) return false;

    // A cone in the attacker's own frame, so an arc restricts elevation as
    // well as bearing: a forward bank does not bear on something directly above
    // the saucer merely because it is ahead in plan view.
    if (!inArc(attacker.directionTo(target), weapon)) return false;

    const distance = attacker.distanceTo(target);
    if (distance > (WEAPON_RANGE[weapon.type] ?? 900)) return false;

    weapon.cooldown = weapon.cycle;

    if (weapon.type === 'torpedo') {
      attacker.torpedoes = Math.max(0, attacker.torpedoes - 1);
      this.projectiles.push({
        kind: 'torpedo', attacker, target, weapon,
        x: attacker.x, y: attacker.y, z: attacker.z ?? 0,
        speed: 420, life: 6,
        subsystem: attacker === this.player ? this.targetedSubsystem : null,
      });
      emit('combat:fire', { attacker, weapon, type: 'torpedo' });
      return true;
    }

    // Beams and cannons resolve immediately, with a visible trace.
    const result = this.resolveHit(attacker, target, weapon, distance,
      attacker === this.player ? this.targetedSubsystem : null);
    this.effects.push({
      kind: weapon.type,
      from: { x: attacker.x, y: attacker.y, z: attacker.z ?? 0 },
      to: { x: target.x, y: target.y, z: target.z ?? 0 },
      life: 0.35, hit: result.hit, faction: attacker.faction,
    });
    emit('combat:fire', { attacker, weapon, type: weapon.type, result });
    return true;
  }

  /** Roll accuracy, apply damage, emit the consequences. */
  resolveHit(attacker, target, weapon, distance, subsystem = null) {
    const falloff = rangeFactor(weapon.type, distance);
    if (falloff <= 0) return { hit: false, reason: 'out of range' };

    const accuracy = 0.92 * attacker.mod('accuracy')
      * (0.7 + 0.3 * attacker.subsystems.sensors);
    // A decoy in the water only troubles the people shooting at us.
    const decoy = (target === this.player && this.decoyTimer > 0) ? 0.22 : 0;
    const evade = target.defenseRating + (target.cloaked ? 0.5 : 0) + decoy;
    if (!this.rng.chance(Math.max(0.08, accuracy - evade))) {
      return { hit: false, reason: 'miss' };
    }

    const typeMod = weapon.type === 'torpedo' ? attacker.mod('torpedoDamage')
      : weapon.type === 'cannon' ? attacker.mod('cannonDamage')
      : attacker.mod('beamDamage');

    let damage = weapon.damage * falloff * typeMod * attacker.mod('damage')
      * attacker.power.factor('weapons') * attacker.subsystems.weapons
      * this.rng.range(0.9, 1.1);

    // A Called Shot spends itself on the next hit that lands, guaranteeing
    // the critical rather than merely improving the odds.
    let crit = this.rng.chance(attacker.mod('critChance'));
    if (attacker === this.player && this.guaranteedCrits > 0) {
      crit = true;
      this.guaranteedCrits--;
      this.pushLog('Called shot — direct hit.', 'tactical');
    }
    if (crit) damage *= 1 + attacker.mod('critSeverity');

    const direction = target.directionFrom(attacker);
    const dmgType = weapon.type === 'torpedo' ? 'kinetic' : 'energy';
    // Torpedoes largely ignore shields; that's their whole role.
    const piercing = weapon.type === 'torpedo' ? 0.25 : 0;

    const result = target.takeDamage(damage, {
      direction, type: dmgType, shieldPiercing: piercing, rng: this.rng, subsystem,
    });

    this.effects.push({
      kind: 'impact', x: target.x, y: target.y, z: target.z ?? 0, life: 0.4,
      facing: result.facing, penetrated: result.penetrated, crit,
    });

    emit('combat:hit', {
      attacker, target, weapon, damage, crit, ...result,
      isPlayerTarget: target === this.player,
    });

    if (target === this.player) {
      const severity = Math.min(1, result.hullDamage / (this.player.maxHull * 0.05));
      emit('combat:player-hit', { severity, ...result });
      if (result.crewKilled > 0) {
        this.pushLog(`Casualties on ${result.facing === 'fore' ? 'decks four through six' : 'the lower decks'} — ${result.crewKilled} dead.`, 'medical');
      }
    }

    if (target.destroyed) this.onDestroyed(target, attacker);
    return { hit: true, damage, crit, ...result };
  }

  onDestroyed(ship, killer) {
    this.effects.push({ kind: 'explosion', x: ship.x, y: ship.y, z: ship.z ?? 0, life: 1.6 });
    emit('combat:destroyed', { ship, killer, byPlayer: killer === this.player });
    this.pushLog(`${ship.name} destroyed.`, 'tactical');
  }

  // ---------------- step ----------------

  update(dt) {
    if (this.over) return;
    this.time += dt;

    for (const s of this.allShips) s.update(dt, this.rng);

    // Hostile and allied captains act.
    for (const s of this.liveHostiles) {
      chooseAction(s, this, dt);
    }
    for (const s of this.allies.filter((a) => !a.destroyed)) {
      chooseAction(s, this, dt, { allyOf: this.player });
    }

    // Player auto-fire keeps the guns working while you handle everything else.
    if (this.autoFire && this.target && !this.target.destroyed && !this.player.destroyed) {
      for (const w of this.player.weapons) this.fireWeapon(this.player, w, this.target);
    }

    if (this.decoyTimer > 0) this.decoyTimer = Math.max(0, this.decoyTimer - dt);

    this.updateProjectiles(dt);
    this.updateEffects(dt);

    // Disengagement.
    if (this.warpOutTimer > 0) {
      this.warpOutTimer -= dt;
      if (this.warpOutTimer <= 0) return this.end('escaped');
    }

    // Resolution.
    if (this.player.destroyed) return this.end('destroyed');
    if (!this.liveHostiles.length) return this.end('victory');
    if (this.liveHostiles.every((s) => s.fleeing)) return this.end('routed');
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      p.life -= dt;
      if (p.target.destroyed || p.life <= 0) { p.dead = true; continue; }
      const dx = p.target.x - p.x;
      const dy = p.target.y - p.y;
      const dz = (p.target.z ?? 0) - (p.z ?? 0);
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 26) {
        const result = this.resolveHit(p.attacker, p.target, p.weapon,
          p.attacker.distanceTo(p.target), p.subsystem);
  emit('combat:torpedo-impact', { ...result, x: p.x, y: p.y, z: p.z ?? 0 });
        p.dead = true;
        continue;
      }
      p.x += (dx / dist) * p.speed * dt;
      p.y += (dy / dist) * p.speed * dt;
      p.z = (p.z ?? 0) + (dz / dist) * p.speed * dt;
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  updateEffects(dt) {
    for (const e of this.effects) e.life -= dt;
    this.effects = this.effects.filter((e) => e.life > 0);
  }

  end(outcome) {
    if (this.over) return;
    this.over = true;
    this.outcome = outcome;
    emit('combat:end', { outcome, engagement: this });
  }

  pushLog(text, source = 'bridge') {
    const entry = { text, source, time: this.time };
    this.log.push(entry);
    if (this.log.length > 60) this.log.shift();
    emit('combat:log', entry);
  }

  /** Status summary an officer would read aloud. */
  statusReport() {
    const p = this.player;
    const shieldLines = FACINGS
      .map((f) => `${f} ${Math.round(p.shieldPctOf(f) * 100)}%`)
      .join(', ');
    return {
      hull: Math.round(p.hullPct * 100),
      shields: shieldLines,
      crew: p.crew,
      casualties: p.maxCrew - p.crew,
      hostiles: this.liveHostiles.length,
      condition: p.condition,
    };
  }
}

/** Build a hostile group appropriate to a faction and difficulty. */
export function buildHostiles(rng, factionId, strength = 1, classPool = []) {
  const names = {
    klingon: ['IKS Vor’cha', 'IKS Ch’Tang', 'IKS Bortas', 'IKS Rotarran', 'IKS Ning’tao'],
    romulan: ['IRW Terix', 'IRW Belak', 'IRW Valdore', 'IRW Khazara', 'IRW Devoras'],
    cardassian: ['CDS Prakesh', 'CDS Aldara', 'CDS Vetar', 'CDS Groumall'],
    ferengi: ['Kreechta', 'Krayton', 'Quark’s Fortune'],
    orion: ['Syndicate Raider', 'Green Wind', 'Profit Margin'],
    tholian: ['Assembly Spinner', 'Lattice Warden'],
    dominion: ['Jem’Hadar 4-7', 'Jem’Hadar 9-1', 'Jem’Hadar 2-2'],
    borg: ['Borg Cube'],
    independent: ['SS Vico', 'SS Odin', 'SS Norkova'],
  };
  const count = Math.max(1, Math.round(strength));
  const nameList = names[factionId] ?? ['Unknown Vessel'];
  const out = [];
  for (let i = 0; i < count; i++) {
    const cls = rng.pick(classPool);
    if (!cls) break;
    out.push(new Ship(cls, { name: nameList[i % nameList.length], faction: factionId }));
  }
  return out;
}

export { FACINGS, facingForBearing };
