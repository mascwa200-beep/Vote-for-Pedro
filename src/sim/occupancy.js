// Who is in the room, and why they are in that one.
//
// The ship has seventeen rooms and thirty-six stations, and twenty-eight of
// those stations have somebody standing at them. The other eight are in the
// captain's quarters, the briefing room, the recreation room, the crew
// quarters and the turbolift — which is to say that the two rooms that exist
// for no reason except to be where four hundred and thirty people LIVE were
// the two rooms with nobody in them.
//
// And nothing about the interior ever changed. A crew figure is drawn from a
// station's `crew` field, which is static data, so sickbay had exactly one
// medical officer in it whether nobody aboard was hurt or the ship had just
// come out of a battle with forty casualties; the mess was equally deserted at
// green alert and at red; and a boarding party could be cutting its way
// through deck seven while the corridor outside stood empty.
//
// This is the layer that fixes that. It answers one question — who is standing
// in this room right now — from state the game already keeps: the alert, the
// complement, the fires, the injured, and the intruders.
//
// DETERMINISTIC AND FREE OF THE GAME'S RNG. Positions come from a hash of the
// room and the index, so the same ship in the same state puts the same people
// in the same places, and walking in and out of a room does not reshuffle it.
// Drawing from `game.rng` would make the scenery move the simulation.

import { ROOMS } from '../world/interiors.data.js';

/** How many people a room will hold before it stops looking like a room. */
const CAP = 8;

/**
 * A small deterministic hash, for placing people.
 *
 * Not `RNG`: this must not consume a draw from anything the save depends on,
 * and it must give the same answer every frame for the same inputs — the
 * alternative is a mess whose occupants teleport thirty times a second.
 */
function spot(roomId, i, salt) {
  let h = 2166136261;
  const s = `${roomId}:${i}:${salt}`;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 8) & 0xffff) / 0xffff;
}

/**
 * Somewhere in the room that is not inside the furniture or a bulkhead.
 *
 * Rejection against the room's own solid props and its stations, with a hard
 * cap on tries — a placement loop that keeps going until it succeeds is a hang
 * the first time a room is too full, and a person who cannot be placed simply
 * is not there.
 */
function place(room, roomId, i, salt) {
  const w = (room.shape?.width ?? 8) / 2 - 0.8;
  const d = (room.shape?.depth ?? 8) / 2 - 0.8;
  for (let attempt = 0; attempt < 12; attempt++) {
    const x = (spot(roomId, i, `${salt}x${attempt}`) * 2 - 1) * w;
    const z = (spot(roomId, i, `${salt}z${attempt}`) * 2 - 1) * d;
    // Clear of the furniture, but not standing off from it: a recreation room
    // is three tables in a nine-metre box, and half a metre of clearance
    // around each of them left nowhere to put anybody — five people were
    // asked for and three were placed, silently, which is the placement cap
    // doing its job for the wrong reason.
    const clash = (room.props ?? []).some((p) => p.solid !== false
      && Math.hypot(x - p.at[0], z - p.at[1]) < (p.radius ?? 0.6) * 0.8 + 0.34)
      || (room.stations ?? []).some((st) => Math.hypot(x - st.at[0], z - st.at[1]) < 0.9);
    if (!clash) return [x, z];
  }
  return null;
}

/**
 * The alert, in the four values `Game.setAlert` actually uses.
 *
 * `normal`, `yellow`, `red` and `blue` — there is no 'green'. Half of the
 * first version of the security-corridor rule tested for one, which did
 * nothing and looked like it did something.
 *
 * Blue is a maintenance condition, not a combat one: docked, hatches open,
 * cargo moving. It is the busiest the working parts of the ship ever get and
 * the only condition under which the hangar has more people in it than the
 * mess.
 */
const at = (g, { normal = 0, yellow = null, red = null, blue = null }) => {
  const a = g?.alert ?? 'normal';
  if (a === 'red') return red ?? normal;
  if (a === 'yellow') return yellow ?? normal;
  if (a === 'blue') return blue ?? normal;
  return normal;
};

/**
 * What each room does with the people it has.
 *
 * `count` is measured in PEOPLE and reads the ship, not the room: that is the
 * whole point. Each returns a number and the division they belong to, and the
 * comment on each says what a captain walking in would be seeing.
 */
const RULES = {
  // The mess. Full when the ship is quiet, and empty the moment it is not —
  // this is the single most legible rule in the file, because a captain who
  // walks into a deserted recreation room at red alert has been told
  // something true about his ship without a word being printed.
  rec: (g) => ({
    crew: 'ops',
    count: at(g, { normal: Math.round(6 * complement(g)), yellow: 2, red: 0, blue: 4 }),
  }),
  // Off watch, and the same rule: at red alert everybody is at a post.
  crewquarters: (g) => ({
    crew: 'ops',
    count: at(g, { normal: Math.round(3 * complement(g)), yellow: 2, red: 0, blue: 3 }),
  }),
  // One per hurt officer, plus the anonymous casualties a battle produces.
  // A sickbay that fills up after a fight is the ship keeping its own books.
  sickbay: (g) => ({
    crew: 'medical',
    count: (g.crew?.officers ?? []).filter((o) => o.alive && o.injured).length
      + Math.min(4, Math.round(casualties(g) / 12)),
  }),
  // Damage control parties, who are there because something is wrong — and a
  // full watch at blue, which is what a maintenance condition IS.
  engineering: (g) => ({
    crew: 'engineering',
    count: Math.min(4, (g.ship?.fires ?? 0) + (hurt(g) ? 2 : 0) + at(g, { blue: 3 })),
  }),
  // Corridors are where a ship's people actually are. Busiest at red alert,
  // because that is when four hundred people are all going somewhere at once.
  corridor_a: (g) => ({ crew: 'ops', count: at(g, { normal: 1, yellow: 2, red: 3, blue: 2 }) }),
  // Deck three is the mess deck: busy when the mess is, empty when it is not.
  corridor_rec: (g) => ({
    crew: 'ops',
    count: at(g, { normal: 3, yellow: 2, red: 1, blue: 3 }),
  }),
  // Security's own deck. Armed and standing about at anything above normal.
  corridor_sec: (g) => ({
    crew: 'security',
    count: at(g, { normal: 1, yellow: 2, red: 3, blue: 1 }),
  }),
  // The armoury issues weapons when there is something to issue them for.
  armoury: (g) => ({ crew: 'security', count: at(g, { normal: 0, yellow: 1, red: 2 }) }),
  // Loading and unloading, which stops when the ship is fighting and is the
  // entire business of the ship when she is docked.
  cargo: (g) => ({ crew: 'ops', count: at(g, { normal: 2, yellow: 1, red: 0, blue: 4 }) }),
  hangar: (g) => ({
    crew: 'engineering',
    count: at(g, { normal: 2, yellow: 1, red: 0, blue: 4 }),
  }),
};

/** How much of her complement the ship still has. */
const complement = (g) => {
  const max = g?.ship?.maxCrew ?? g?.ship?.crew ?? 1;
  return max > 0 ? Math.max(0, Math.min(1, (g?.ship?.crew ?? 0) / max)) : 0;
};

/** How many people the ship has lost. */
const casualties = (g) => Math.max(0, (g?.ship?.maxCrew ?? 0) - (g?.ship?.crew ?? 0));

/** Is anything actually wrong with her? */
const hurt = (g) => (g?.ship?.hullPct ?? 1) < 0.85
  || Object.values(g?.ship?.subsystems ?? {}).some((v) => v < 0.8);

/**
 * Everyone standing in this room right now.
 *
 * Returned in the shape `firstperson.js` already draws — a `crew` division for
 * the uniform, a position, a facing and a `mounted` of 'wall', which is the
 * standing pose. Intruders come last and are marked, because a boarding party
 * is not part of the complement and must never be counted as one.
 *
 * @returns {Array<{crew,at,facing,mounted,intruder}>}
 */
export function occupantsOf(game, roomId) {
  const room = ROOMS[roomId];
  if (!room || !game) return [];
  const out = [];

  const rule = RULES[roomId]?.(game);
  const wanted = Math.max(0, Math.min(CAP, Math.round(rule?.count ?? 0)));
  for (let i = 0; i < wanted; i++) {
    const at = place(room, roomId, i, 'crew');
    if (!at) continue;
    out.push({
      crew: rule.crew ?? 'ops',
      at,
      // Looking somewhere, rather than all facing the same way like a chorus.
      facing: spot(roomId, i, 'face') * Math.PI * 2,
      mounted: 'wall',
      intruder: false,
    });
  }

  // ---- and whoever should not be aboard ----
  //
  // `ship.boarders` has existed since a hostile could send a party across, and
  // the defence against them is written in full in `Ship.update` — defenders
  // drawn from the crew, losses on both sides, a subsystem wrecked every
  // second or so. None of it was ever VISIBLE. A captain could walk the length
  // of deck seven during a boarding action and meet nobody at all.
  //
  // They are in the corridors and the rooms worth taking, not everywhere: a
  // boarding party is heading for engineering, the armoury and the bridge, and
  // scattering them uniformly through seventeen rooms would make a raid look
  // like a crowd.
  const boarders = game.ship?.boarders ?? 0;
  if (boarders > 0 && boardedRooms(boarders).includes(roomId)) {
    const here = Math.max(1, Math.min(3, Math.round(boarders / 12)));
    for (let i = 0; i < here; i++) {
      const at = place(room, roomId, i, 'intruder');
      if (!at) continue;
      out.push({
        crew: 'intruder',
        at,
        facing: spot(roomId, i, 'iface') * Math.PI * 2,
        mounted: 'wall',
        intruder: true,
      });
    }
  }
  return out;
}

/**
 * Where a boarding party has got to, in the order it gets there.
 *
 * They beam into a corridor and work toward what is worth taking. A party is
 * NOT in every one of these at once — that was the first version, and it made
 * the security board on the bridge useless: thirty intruders reported contacts
 * on all six locations, which tells a captain nothing and leaves nowhere on
 * the ship that is clear. How far down the list they have got is how many of
 * them there are.
 */
const BOARDING_PRIORITY = [
  'corridor_sec', 'corridor_a', 'engineering', 'armoury', 'corridor_rec', 'bridge',
];

/** The rooms a party of this size has reached. */
export function boardedRooms(boarders) {
  if (!(boarders > 0)) return [];
  const reach = Math.max(1, Math.min(BOARDING_PRIORITY.length, Math.round(boarders / 8)));
  return BOARDING_PRIORITY.slice(0, reach);
}

/**
 * How many people are aboard this room, for a caption.
 *
 * Separate from the list because the panel wants a number and the renderer
 * wants positions, and computing one from the other at the call site is how
 * two counts come to disagree.
 */
export function headcountOf(game, roomId) {
  const all = occupantsOf(game, roomId);
  const stationed = (ROOMS[roomId]?.stations ?? []).filter((s) => s.crew).length;
  return {
    crew: stationed + all.filter((o) => !o.intruder).length,
    intruders: all.filter((o) => o.intruder).length,
  };
}
