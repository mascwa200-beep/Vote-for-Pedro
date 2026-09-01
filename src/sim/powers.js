// The things a captain spends rather than orders: bridge officer abilities,
// the career signature, and the devices in the loadout.
//
// All three of these lived in src/main.js, which is the screen. That meant
// seventeen bridge officer powers, seven career signatures and four devices
// only existed when a browser was attached: headless they could not be used,
// the soak could not fire them, the invariant checker never saw a buffed ship,
// and the API fuzzer's `g.character?.useSignature?.(g)` was an optional-chain
// into nothing that had quietly passed for as long as it had been written.
//
// This is the same shape of bug as `finishCombat` being called from one event
// listener in main.js — the most complicated part of combat, reachable only
// through a UI. What is here is everything a power DOES. What stays in main.js
// is what a power SOUNDS like: the beeps, the haptics, the spoken line and the
// dialog. The result object carries what the screen needs to draw.

import { FACINGS } from './ship.js';
import { ABILITIES } from './officers.js';

/** The weakest facing on a ship, for a scan report. */
export function weakestFacing(ship) {
  return FACINGS.reduce((w, f) => (ship.shieldPctOf(f) < ship.shieldPctOf(w) ? f : w), 'fore');
}

/**
 * Fire one bridge officer ability.
 *
 * @returns {{ok: boolean, reason?: string, ability?: object, officer?: object,
 *            reaction?: string, line?: string, report?: object}}
 */
export function applyAbility(game, officer, ability) {
  const a = typeof ability === 'string' ? ABILITIES[ability] : ability;
  if (!game || !officer || !a) return { ok: false, reason: 'no such ability' };
  if (!officer.ready(a.id)) return { ok: false, reason: 'on cooldown', ability: a, officer };

  const eng = game.engagement && !game.engagement.over ? game.engagement : null;

  // The officer gets a say, and it is taken BEFORE the cooldown starts so the
  // reaction is to the order rather than to its aftermath.
  const reaction = officer.reactTo({ risk: a.id === 'eject_core' ? 0.9 : 0.2 });
  officer.startCooldown(a.id);

  if (a.mods) {
    game.ship.addBuff({
      id: a.id, label: a.name, until: a.duration || 12, mods: a.mods,
    });
  }

  let report = null;
  switch (a.special) {
    case 'evasive':
      eng?.evasive(true);
      break;
    case 'extinguish':
      game.ship.fires = 0;
      break;
    case 'eject':
      game.ship.ejectCore();
      break;
    case 'reset_adaptation':
      for (const s of eng?.hostiles ?? []) s.adaptation = {};
      break;
    case 'detect_cloak':
      for (const s of eng?.liveHostiles ?? []) if (s.cloaked) s.decloak();
      break;
    case 'jam':
      for (const s of eng?.liveHostiles ?? []) {
        s.addBuff({
          id: 'jammed', label: 'Sensors jammed', until: a.duration, mods: { accuracy: 0.55 },
        });
      }
      break;
    case 'subsystem':
      eng?.targetSubsystem('weapons');
      break;
    case 'scan': {
      const t = eng?.target;
      if (t) {
        report = {
          kind: 'scan',
          title: `Scan — ${t.name}`,
          lines: [
            `${t.cls.name}. ${t.cls.description}`,
            `Hull ${Math.round(t.hullPct * 100)}%, shields ${Math.round(t.shieldPct * 100)}%.`,
            `Weakest facing: ${weakestFacing(t)}.`,
          ],
        };
      }
      break;
    }
    case 'spread': {
      // Every torpedo tube at once, arcs ignored for this volley.
      const target = eng?.target;
      if (target) {
        for (const w of game.ship.weapons.filter((x) => x.type === 'torpedo')) {
          w.cooldown = 0;
          eng.fireWeapon(game.ship, w, target);
        }
      }
      break;
    }
    default:
      break;
  }

  const spoken = a.say ?? officer.acknowledge(reaction === 'comply' ? 'order' : reaction);
  game.pushLog(`${officer.name}: ${spoken}`, officer.station);
  return { ok: true, ability: a, officer, reaction, line: spoken, report };
}

/**
 * The career signature: one large effect, once per engagement.
 *
 * Each reuses machinery that already exists — buffs, repair, cooldowns —
 * rather than inventing a parallel system.
 *
 * @returns {{ok: boolean, reason?: string, career?: object, line?: string,
 *            openHail?: string|null}}
 */
export function applySignature(game) {
  const c = game?.character;
  if (!c) return { ok: false, reason: 'no captain' };
  if (c.signatureUsed) return { ok: false, reason: 'already used this engagement' };
  const career = c.career;
  if (!career) return { ok: false, reason: 'no career' };

  const eng = game.engagement && !game.engagement.over ? game.engagement : null;
  let line = '';
  let openHail = null;

  switch (c.careerId) {
    case 'command':
      // Take the Conn — every bridge officer is ready again.
      for (const o of game.crew.officers) o.cooldowns = {};
      line = 'Every station reports ready.';
      break;

    case 'tactical': {
      // Called Shot — the next hit that lands is a guaranteed critical.
      if (!eng) return { ok: false, reason: 'nothing to shoot at' };
      eng.guaranteedCrits += 1;
      if (!eng.targetedSubsystem) eng.targetSubsystem('weapons');
      line = `Called shot on their ${eng.targetedSubsystem}. Standing by.`;
      break;
    }

    case 'engineering': {
      const before = game.ship.hullPct;
      game.ship.repair(game.ship.maxHull * 0.3);
      game.ship.fires = 0;
      line = `Hull integrity ${Math.round(before * 100)}% to ${Math.round(game.ship.hullPct * 100)}%. Fires are out.`;
      break;
    }

    case 'science': {
      // Insight — see everything, and roll better for twenty seconds.
      game.ship.addBuff({
        id: 'insight', label: 'Insight', until: 20,
        mods: { accuracy: 1.25, critChance: 0.15 },
      });
      c.insightUntil = 20;
      const t = eng?.target;
      line = t
        ? `${t.name}: weakest facing is ${weakestFacing(t)}, hull at ${Math.round(t.hullPct * 100)}%.`
        : 'Full spectrum analysis running.';
      break;
    }

    case 'medical': {
      // Triage — one officer back on their feet, and fewer losses after.
      const wounded = game.crew.officers.find((o) => o.alive && o.injured);
      if (wounded) wounded.heal();
      game.ship.addBuff({
        id: 'triage', label: 'Triage', until: 30, mods: { crewProtect: 0.5 },
      });
      line = wounded
        ? `${wounded.name} is back on duty. Sickbay is holding.`
        : 'Sickbay is prepped. Casualties will be lighter.';
      break;
    }

    case 'diplomatic':
      // Parley — they will hear you out whatever their doctrine says.
      if (!eng) return { ok: false, reason: 'nobody to talk to' };
      game.parleyForced = true;
      line = 'Channel forced open. They are listening whether they meant to or not.';
      openHail = eng.hostiles[0]?.faction ?? null;
      break;

    case 'intelligence':
      // Prior Knowledge — you move first, and they lose a beat.
      for (const s of eng?.liveHostiles ?? []) {
        for (const w of s.weapons) w.cooldown = Math.max(w.cooldown, 6);
        if (s.cloaked) s.decloak();
      }
      game.ship.addBuff({
        id: 'prior_knowledge', label: 'Prior Knowledge', until: 15,
        mods: { accuracy: 1.2, defense: 1.4 },
      });
      line = 'We know what they are about to do. Six seconds of it.';
      break;

    default:
      return { ok: false, reason: `no signature for ${c.careerId}` };
  }

  c.signatureUsed = true;
  game.pushLog(`${career.signature}: ${line}`, 'captain');
  return { ok: true, career, line, openHail };
}

/**
 * Spend one device out of the loadout.
 *
 * @returns {{ok: boolean, reason?: string, id?: string, line?: string}}
 */
export function applyDevice(game, id) {
  if (!game?.loadout?.useDevice(id)) return { ok: false, reason: 'none left', id };

  let line = '';
  switch (id) {
    case 'shield_battery':
      for (const f of FACINGS) {
        game.ship.shields[f] = Math.min(
          game.ship.maxShield, game.ship.shields[f] + game.ship.maxShield * 0.4,
        );
      }
      line = 'Shield battery discharged. Facings reinforced.';
      break;
    case 'weapons_battery':
      game.ship.addBuff({
        id: 'weapons_battery', label: 'Weapons battery', until: 20, mods: { damage: 1.4 },
      });
      line = 'Weapons battery online.';
      break;
    case 'engine_battery':
      game.ship.addBuff({
        id: 'engine_battery', label: 'Engine battery', until: 20,
        mods: { impulse: 1.5, turn: 1.3 },
      });
      line = 'Engine battery online.';
      break;
    case 'hull_patch':
      game.ship.repair(game.ship.maxHull * 0.2);
      game.ship.fires = 0;
      line = 'Emergency hull patch applied. Fires out.';
      break;
    default:
      // The device was spent above, so an unknown id is a data bug rather than
      // a free action. Say so in the log rather than silently doing nothing.
      line = `${id} discharged.`;
      break;
  }

  game.pushLog(line, 'engineering');
  return { ok: true, id, line };
}
