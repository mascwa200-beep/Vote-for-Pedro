// Losing her, and being taken off her.
//
// The grounding is docs/RESEARCH.md §21. Both halves of this are canon and the
// useful thing about both is that neither is free.
//
// Kirk destroyed the Enterprise himself rather than let her be taken, was tried
// for it, was reduced in rank, and was THEN given the Enterprise-A — a hull is
// lost, there is a reckoning, the reckoning costs something real, and a ship
// follows it rather than replacing it. He got exactly one replacement.
//
// And promotion is how you stop being a starship captain. Kirk made Admiral and
// the price was the Enterprise; the demotion at the end of the whale business is
// what gave her back, and the film plays that as the reward. So a bigger command
// is an OFFER, and it can be refused.

import { Ship } from './ship.js';
import { getShipClass } from '../world/ships.data.js';
import { hostileName, HOSTILE_NAMES } from './combat.js';
import { emit } from '../core/events.js';

/**
 * The hulls Starfleet will give a captain, smallest first.
 *
 * `tier` is the rank tier at which one becomes available, matching
 * `CaptainProgress.shipTier`. Every entry is a Federation class already in
 * ships.data.js with its published numbers — no hull exists for this ladder
 * that did not exist before it.
 */
export const COMMAND_LADDER = [
  { id: 'oberth', tier: 1 },
  { id: 'miranda', tier: 1 },
  { id: 'constellation', tier: 2 },
  { id: 'constitution', tier: 3 },
  { id: 'constitution_refit', tier: 4 },
  { id: 'excelsior', tier: 5 },
  { id: 'ambassador', tier: 5 },
  { id: 'nebula', tier: 6 },
  { id: 'galaxy', tier: 6 },
];

/** Where a class sits on the ladder, or -1 for one that is not on it. */
export function rungOf(classId) {
  return COMMAND_LADDER.findIndex((r) => r.id === classId);
}

/**
 * The next command Starfleet would offer, or null.
 *
 * One rung at a time, and never above the captain's rank. A lieutenant does not
 * get a Galaxy because a Galaxy exists.
 */
export function nextCommandFor(game) {
  const here = rungOf(game.ship?.classId);
  const tier = game.progress?.shipTier ?? 1;
  for (let i = here + 1; i < COMMAND_LADDER.length; i++) {
    if (COMMAND_LADDER[i].tier <= tier) return COMMAND_LADDER[i];
  }
  return null;
}

/**
 * What Starfleet gives a captain who has lost one.
 *
 * Not better than what was lost. Kirk got a Constitution for a Constitution,
 * and a captain who has just lost a ship is not the obvious person to hand a
 * bigger one. One rung down where there is a rung to go down to.
 */
export function replacementFor(game) {
  const here = rungOf(game.ship?.classId);
  if (here < 0) return COMMAND_LADDER[0];
  return COMMAND_LADDER[Math.max(0, here - 1)];
}

/** A Starfleet name that is not the one you just lost. */
function nameFor(game, avoid) {
  const names = HOSTILE_NAMES.federation ?? [];
  for (let i = 0; i < 12; i++) {
    const n = hostileName('federation', Math.floor(game.rng.float() * names.length));
    if (n !== avoid) return n;
  }
  return avoid ? `${avoid} II` : 'Endeavour';
}

/**
 * Put the captain aboard a different hull.
 *
 * The crew come too — they followed Kirk from ship to ship and it would be a
 * strange campaign that took your first officer away because Starfleet changed
 * your hull. So does the loadout: the consoles are the captain's stores, and
 * losing them as well would be punishing the same event twice.
 *
 * What does NOT come is what the old crew knew about the old ship. Mastery is
 * keyed by class and stays keyed by class, so the new hull starts at nothing —
 * with the shakedown penalty from §20 — and the old one still remembers, for a
 * captain who ever gets her back.
 *
 * @returns {{ok: boolean, ship?: Ship, previous?: string, reason?: string}}
 */
export function takeCommandOf(game, classId, { name = null } = {}) {
  const cls = getShipClass(classId);
  if (!cls) return { ok: false, reason: 'There is no such class in the registry.' };
  const previous = game.ship?.classId ?? null;
  const previousName = game.ship?.name ?? null;

  game.ship = new Ship(classId, {
    name: name ?? nameFor(game, previousName),
    faction: 'federation',
    isPlayer: true,
  });
  // The track follows the captain, not the hull: the points already earned in
  // other classes stay in the map and are waiting if he ever flies one again.
  if (game.mastery) game.mastery.classId = classId;
  game.applyAllMods();

  emit('command:changed', { ship: game.ship, previous, classId });
  return { ok: true, ship: game.ship, previous };
}

/**
 * A standing offer of a bigger command, or null.
 *
 * Held on the game rather than computed on the fly at the moment it is read,
 * because it is a thing Starfleet said to you once — it should still be there
 * tomorrow, and it should be refusable.
 */
export function offerCommand(game) {
  const next = nextCommandFor(game);
  if (!next) return null;
  const cls = getShipClass(next.id);
  game.commandOffer = {
    classId: next.id,
    name: cls?.name ?? next.id,
    hull: cls?.hull ?? 0,
    crew: cls?.crew ?? 0,
    // The cost, said out loud at the moment of the offer rather than discovered
    // afterwards. This is the whole decision.
    cost: game.mastery?.tier ?? 0,
  };
  emit('command:offered', game.commandOffer);
  return game.commandOffer;
}

/** @returns {{ok: boolean, reason?: string, ship?: Ship, spent?: number}} */
export function acceptCommandOffer(game) {
  const offer = game.commandOffer;
  if (!offer) return { ok: false, reason: 'Nobody has offered us another ship, Captain.' };
  const spent = game.mastery?.tier ?? 0;
  const took = takeCommandOf(game, offer.classId);
  if (!took.ok) return took;
  game.commandOffer = null;
  game.ledger?.record('command_accepted', {
    text: `Took command of ${game.ship.name}, a ${offer.name}`,
  });
  return { ok: true, ship: game.ship, spent };
}

/** @returns {{ok: boolean, reason?: string, kept?: string}} */
export function declineCommandOffer(game) {
  const offer = game.commandOffer;
  if (!offer) return { ok: false, reason: 'There is nothing to turn down, Captain.' };
  game.commandOffer = null;
  game.ledger?.record('command_declined', {
    text: `Turned down a ${offer.name} to stay with ${game.ship.name}`,
  });
  emit('command:declined', { offer, ship: game.ship });
  return { ok: true, kept: game.ship.name };
}
