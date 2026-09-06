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
 * How far a standing person keeps off the bulkhead.
 *
 * It was 0.8, written inline, and 0.8 is a sensible number for a nine-metre
 * box: it keeps people off the walls so they read as being IN the room rather
 * than pressed against it. Subtracted flat from the half-extent, it is a
 * disaster in a narrow one.
 *
 * The recreation corridor is 2.6 metres across. Half of that is 1.3, less 0.8
 * leaves 0.5 — so every person in a 2.6-metre corridor was placed in its
 * middle METRE, all three of them, in single file down the centreline. Which
 * is the one metre the captain has to walk along, because a corridor's two
 * doors are at its two ends.
 *
 * 0.4 is a person's own footprint plus a little air. In a nine-metre room it
 * moves people from ±3.2 to ±3.6 and nobody will ever notice; in a corridor it
 * gives them the width to stand ALONG the wall, which is where people stand in
 * corridors.
 */
const WALL_CLEARANCE = 0.4;

/**
 * How far a standing person keeps out of the walking lane.
 *
 * The captain's radius (`WALKER_RADIUS`, 0.26) plus a person's own, which is
 * about the same — so at 0.62 metres the two of you cannot both be there.
 *
 * A "lane" is the straight line between two of the room's doors, because that
 * is precisely what the autopilot walks: `enter()` puts you just inside the
 * door you came through and `stepToward` aims you at the next one and presses
 * forward, with no idea what is between. Measured over all 252 room-to-room
 * routes before this rule existed, the camera came within 0.35 m of a crew
 * member — inside their body — on 30 of them, and the worst pass was 0.03 m:
 * the captain walked clean through an ensign in the recreation corridor.
 *
 * Rejecting the lane at placement time is the layer that can fix it. Pushing
 * people aside as the captain approaches cannot: `place` is called fresh every
 * frame and is deliberately a pure function of the room and the ship's state,
 * so anything that depended on where the captain is standing would make the
 * crowd teleport thirty times a second — the exact failure the hash above
 * exists to prevent.
 */
const LANE_CLEARANCE = 0.62;

/** Distance from a point to a line segment. */
function distToSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const len = vx * vx + vz * vz;
  // A door pair at the same point is a point, not a lane.
  if (len < 1e-9) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * vx + (pz - az) * vz) / len;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

/**
 * Where you are standing a moment after coming through this door.
 *
 * `Walker.enter` puts you a metre inside it along the line toward the room's
 * centre — arriving in the doorway itself would leave you half in the frame,
 * and arriving at the origin would drop you on top of whatever is in the
 * middle. Mirrored here rather than imported because `walk.js` imports this
 * module's neighbours and the number is one line; if it moves, the test in
 * `tests/occupancy.test.js` that walks a real route will notice.
 */
function stand(exit) {
  const [dx, dz] = exit.at;
  const len = Math.hypot(dx, dz) || 1;
  return [dx - (dx / len) * 1.0, dz - (dz / len) * 1.0];
}

/**
 * Is this spot in the middle of the way through?
 *
 * Every ORDERED pair of the room's doors — from where you stand on arriving
 * through one, to the next one you are aiming at. So a room with one exit has
 * no lane and the security corridor, with four, has twelve.
 *
 * Ordered and starting a metre in, rather than simply door-to-door, because
 * door-to-door is not the path. Measured: an ensign in the recreation corridor
 * sat 0.84 m off the door-to-door line and the captain still passed within
 * 0.28 m of them, because the walk begins a metre inside the door and the two
 * lines diverge by about half a metre at that end.
 *
 * Nothing is done about a room whose lanes cover all of it — the caller falls
 * back to the bulkhead and, failing that, returns `null`.
 */
function inLane(room, x, z) {
  const exits = room.exits ?? [];
  for (const from of exits) {
    const [ax, az] = stand(from);
    for (const to of exits) {
      if (to === from) continue;
      if (distToSegment(x, z, ax, az, to.at[0], to.at[1]) < LANE_CLEARANCE) return true;
    }
  }
  return false;
}

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
 * Is this spot taken?
 *
 * Clear of the furniture, but not standing off from it: a recreation room is
 * three tables in a nine-metre box, and half a metre of clearance around each
 * of them left nowhere to put anybody — five people were asked for and three
 * were placed, silently, which is the placement cap doing its job for the
 * wrong reason.
 *
 * `respectLane` is off for the last resort only. See `place`.
 */
function blocked(room, x, z, respectLane) {
  if ((room.props ?? []).some((p) => p.solid !== false
    && Math.hypot(x - p.at[0], z - p.at[1]) < (p.radius ?? 0.6) * 0.8 + 0.34)) return true;
  if ((room.stations ?? []).some((st) => Math.hypot(x - st.at[0], z - st.at[1]) < 0.9)) return true;
  return respectLane && inLane(room, x, z);
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
  const w = (room.shape?.width ?? 8) / 2 - WALL_CLEARANCE;
  const d = (room.shape?.depth ?? 8) / 2 - WALL_CLEARANCE;
  for (let attempt = 0; attempt < 12; attempt++) {
    const x = (spot(roomId, i, `${salt}x${attempt}`) * 2 - 1) * w;
    const z = (spot(roomId, i, `${salt}z${attempt}`) * 2 - 1) * d;
    if (!blocked(room, x, z, true)) return [x, z];
  }

  // Twelve throws of a dart, and then a look round the edge of the room.
  //
  // Rejection sampling alone is fine in an empty box and hopeless in a narrow
  // band: the briefing room is six metres by four and a half with a conference
  // table in the middle, which leaves a ring about a metre wide, and twelve
  // uniform samples found a spot for one person in three. The other two were
  // dropped silently — the ship simply had fewer people in it than its own
  // rule said, and nothing anywhere complained. That is the same failure the
  // note above records happening in the recreation room, fixed there by moving
  // a threshold, which fixed that room and not the sampler.
  //
  // So when the darts miss, walk the perimeter deterministically. Sixteen
  // bearings at two radii, offset by the person's index so two people do not
  // stand in the same corner, and every one of them is a real position rather
  // than a smaller crew.
  for (let ring = 0; ring < 2; ring++) {
    const scale = 1 - ring * 0.22;
    for (let k = 0; k < 16; k++) {
      const theta = ((k + i * 5) % 16) / 16 * Math.PI * 2;
      const x = Math.cos(theta) * w * scale;
      const z = Math.sin(theta) * d * scale;
      if (!blocked(room, x, z, true)) return [x, z];
    }
  }

  // And then, flat against the bulkhead.
  //
  // This is what keeps the lane rule from emptying a room. The security
  // corridor is 2.6 metres across with FOUR doors on it, which is six lanes
  // over a width that holds one and a half — so every spot in it is somebody's
  // way through, and requiring the lane took it from three people at red alert
  // to one. A corridor that empties the moment it gets interesting is the
  // exact failure this whole module exists to undo.
  //
  // So the lane is a PREFERENCE, honoured wherever the room has room for it
  // and given up at the wall — which is where you put yourself when a corridor
  // is busy.
  //
  // The rectangle's side walls rather than the ellipse above, and that is not
  // a tidy-up: an ellipse inscribed in a 0.9-by-6.1 corridor spends almost all
  // of its perimeter along the LONG axis, where x is near zero. Falling back
  // to it put the security corridor's crew back down the centreline — the
  // thing this change is about — and measured worse than having no lane rule
  // at all. The wall is the only place in a corridor that is out of the way.
  for (let k = 0; k < 24; k++) {
    const j = (k + i * 7) % 24;
    const x = (j % 2 ? 1 : -1) * w;
    const z = ((Math.floor(j / 2) + 0.5) / 12 * 2 - 1) * d;
    if (!blocked(room, x, z, false)) return [x, z];
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

  // The five rooms this table forgot.
  //
  // The header above says the two rooms that exist to be where people LIVE
  // were the two rooms with nobody in them, and names the captain's quarters
  // and the briefing room in the same sentence as the mess and the crew
  // quarters. Only the second two got a rule. Measured at yellow alert, seven
  // of seventeen compartments still returned nobody at all — including the
  // room the ship is fought from when the bridge is gone.

  // Auxiliary control. Dark and empty while the bridge is answering, and
  // manned the moment it might not be: that is the entire reason deck eight
  // has a second bridge in it. Blue is a maintenance watch, which is a
  // different two people doing a different job.
  auxcontrol: (g) => ({ crew: 'engineering', count: at(g, { normal: 0, yellow: 1, red: 2, blue: 2 }) }),

  // The captain's own quarters. A yeoman with something to sign, and nobody
  // at all once the klaxon goes — a captain who walks in at red alert and
  // finds it empty has been told where his ship's people are.
  quarters: (g) => ({ crew: 'ops', count: at(g, { normal: 1, yellow: 0, red: 0, blue: 1 }) }),

  // The briefing room fills up when there is something to brief. At yellow
  // that is the senior staff; docked, it is whoever is being handed orders.
  //
  // This is the room that found the silent drop in `place`: asked for three, it
  // stood one up and lost the other two without a word. The count is what a
  // senior staff briefing looks like; making the sampler able to find the
  // positions was the fix, not shrinking the number to suit it.
  briefing: (g) => ({ crew: 'command', count: at(g, { normal: 0, yellow: 3, red: 0, blue: 2 }) }),

  // The brig is a guard post whether or not there is anybody in the cell, and
  // it doubles at red alert because that is when there might be.
  brig: (g) => ({ crew: 'security', count: at(g, { normal: 1, yellow: 1, red: 2, blue: 1 }) }),

  // The transporter chief is always at the pad. A second operator while there
  // is a party on the surface to bring back — `ashore` is the game's own word
  // for it — and two more at blue, when cargo comes through here rather than
  // round the hull.
  transporter: (g) => ({
    crew: 'engineering',
    count: 1 + (g?.ashore ? 1 : 0) + at(g, { blue: 2 }),
  }),

  // Not the turbolift. A lift car is two and a bit metres square and the
  // captain is standing in it; putting a second person in there is not a
  // busier ship, it is a worse one.
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
 *
 * Which is exactly what happened, because for a long time nothing in `src/`
 * called this. Every board in `sim/consoles.js` recomputed the number from
 * `occupantsOf` alone and dropped the `stations` term, so every compartment
 * with a manned console under-reported itself by the number of consoles in it.
 * `ui/firstperson.js` draws a figure for every station with `crew` on it, so
 * the people were standing there while the board said they were not: at red
 * alert the shuttlebay reported "the deck is clear" to a captain looking at
 * two of the flight deck crew, one of them at the very board printing it.
 *
 * The doc comment above was right about the failure mode and did not prevent
 * it, because a function nothing calls prevents nothing.
 */
export function headcountOf(game, roomId) {
  const all = occupantsOf(game, roomId);
  const stationed = (ROOMS[roomId]?.stations ?? []).filter((s) => s.crew).length;
  return {
    crew: stationed + all.filter((o) => !o.intruder).length,
    intruders: all.filter((o) => o.intruder).length,
  };
}
