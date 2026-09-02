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
 * The BEST hull the captain's rank allows above the one being flown — not the
 * next one up the ladder. Taking the first match meant a rear admiral who had
 * once turned down a refit was offered the same refit again, rather than the
 * Galaxy his rank had since earned him: the offer never improved, however far
 * the career went.
 *
 * Never above the rank, though. A lieutenant does not get a Galaxy because a
 * Galaxy exists.
 *
 * Refusals are remembered, because a captain who has said no to a hull should
 * not be asked about that same hull at every promotion for the rest of his
 * career: it was put to him six times over the rank ladder before this.
 *
 * And nothing at or below a hull he has refused is offered either. Skipping
 * only the exact class meant that turning down an Ambassador produced an offer
 * of an Excelsior at the next promotion — four hundred tonnes SMALLER, as
 * though Starfleet were haggling. Saying no to the best available ship does not
 * make a worse one attractive; it means waiting until there is something better
 * than the one refused.
 */
export function nextCommandFor(game) {
  const here = rungOf(game.ship?.classId);
  const tier = game.progress?.shipTier ?? 1;
  const refusedAt = (game.declinedCommands ?? [])
    .reduce((hi, id) => Math.max(hi, rungOf(id)), -1);
  const floor = Math.max(here, refusedAt);
  let best = null;
  for (let i = floor + 1; i < COMMAND_LADDER.length; i++) {
    if (COMMAND_LADDER[i].tier <= tier) best = COMMAND_LADDER[i];
  }
  return best;
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
 * Nor do the bays. The consoles are the captain's, but the holes they go in
 * belong to the ship, and this used to leave the loadout describing the hull
 * he had just walked off. Every one of the seventy-two moves along the ladder
 * was wrong in one direction or the other: a Constitution captain given a
 * Constellation after a board of inquiry kept three tactical consoles firing
 * on a hull with two bays, and a Constitution captain promoted to an Excelsior
 * could never fill her third science bay, because the loadout still allowed
 * two. So the bays are resized here, and what it cost is returned rather than
 * discovered later on the ship screen.
 *
 * @returns {{ok: boolean, ship?: Ship, previous?: string, reason?: string,
 *            stowed?: string[], gained?: Record<string, number>}}
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
  // Before applyAllMods, which reads the loadout: a console in a bay the new
  // hull does not have must not still be modifying her.
  const refit = game.loadout?.refitTo(cls.slots) ?? { stowed: [], gained: {} };
  game.applyAllMods();

  emit('command:changed', { ship: game.ship, previous, classId, ...refit });
  return { ok: true, ship: game.ship, previous, ...refit };
}

/**
 * What the yard did to the loadout, in a sentence, or null if nothing changed.
 *
 * Shared by all three ways a captain ends up in a different hull — promotion,
 * a board of inquiry, and the change-of-command screen — because the three had
 * three different amounts to say about it, and two of them said nothing at all.
 *
 * @param {{stowed?: string[], gained?: Record<string, number>}} refit
 */
export function yardReport(refit, consoleNames = {}) {
  const stowed = refit?.stowed ?? [];
  const gained = Object.entries(refit?.gained ?? {}).filter(([, n]) => n > 0);
  const parts = [];
  if (stowed.length) {
    const names = stowed.map((id) => consoleNames[id]?.name ?? id);
    parts.push(`She has no bay for ${listOf(names)} — ${stowed.length === 1 ? 'it is' : 'they are'} in stores.`);
  }
  if (gained.length) {
    const bays = gained.map(([slot, n]) => `${n} ${slot}`);
    parts.push(`She carries ${listOf(bays)} ${gained.length === 1 && gained[0][1] === 1 ? 'bay' : 'bays'} more than the old ship.`);
  }
  return parts.length ? parts.join(' ') : null;
}

/** "a", "a and b", "a, b and c" — the ship's computer does not use commas before "and". */
function listOf(items) {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
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
    // And the other half of it. A bigger ship is not bigger in every bay —
    // an Excelsior carries one more of nearly everything than a Constitution,
    // but a Nebula carries one FEWER tactical than an Excelsior, and a captain
    // who has built his ship around a tactical console ought to know that
    // before he says yes rather than after the console is in a crate.
    slots: cls?.slots ?? null,
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
  return { ok: true, ship: game.ship, spent, stowed: took.stowed, gained: took.gained };
}

/** @returns {{ok: boolean, reason?: string, kept?: string}} */
export function declineCommandOffer(game) {
  const offer = game.commandOffer;
  if (!offer) return { ok: false, reason: 'There is nothing to turn down, Captain.' };
  game.commandOffer = null;
  // Remembered, so the same hull is not put to him again at every promotion.
  game.declinedCommands = [...new Set([...(game.declinedCommands ?? []), offer.classId])];
  game.ledger?.record('command_declined', {
    text: `Turned down a ${offer.name} to stay with ${game.ship.name}`,
  });
  emit('command:declined', { offer, ship: game.ship });
  return { ok: true, kept: game.ship.name };
}
