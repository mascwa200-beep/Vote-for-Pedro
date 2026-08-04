// The inside of the ship, as hand-written rooms.
//
// The scope here is the iconic sets, not a generated starship. A Constitution
// has twenty-three decks and four hundred and thirty people on it, and a
// procedural corridor maze would be twenty-two decks of nothing between the
// eight rooms anybody wants to stand in. So these are authored: the bridge, the
// turbolift that reaches everything, and the six rooms the show actually used.
//
// Every room is a `ring` or a `box`. That is not a simplification for its own
// sake — it makes collision ANALYTIC. A circle test or an axis-aligned box
// test, plus a short list of solid props as circles, and there is no physics
// engine, no broadphase, no tunnelling at high speed and nothing to tune. The
// sets were built on soundstages out of curved walls and straight ones; the
// geometry that describes them is the geometry that was there.
//
// Coordinates are metres in the room's own frame, x to starboard and z forward,
// with the origin at the centre of the room. Facings are radians, 0 looking
// down +z. `docs/RESEARCH.md` §3 is the authority for the bridge.

/**
 * Deck numbers, for the turbolift and for the log.
 * Deck 1 is the bridge on a Constitution, and the number goes up going down.
 */
export const DECKS = {
  1: 'Deck 1 — Bridge',
  2: 'Deck 2 — Briefing and quarters',
  5: 'Deck 5 — Sickbay',
  7: 'Deck 7 — Transporters',
  11: 'Deck 11 — Engineering',
};

/**
 * The ten stations documented on a Constitution bridge, in the order they ring
 * the room from the viewscreen round to port.
 *
 * `panel` names an existing UI component where one fits — walking to a console
 * and opening the panel that is already written is most of what makes a station
 * worth walking to. A station with no panel is still a place to stand, and
 * still somebody's post.
 *
 * `mounted` is a collision fact, not decoration. A console set INTO a wall is
 * part of that wall: you stand in front of it, and the bulkhead behind it is
 * what stops you. A console standing on the floor — helm and navigation, in the
 * middle of the bridge — is furniture you can walk all the way around.
 *
 * Modelling both as free-standing circles is what put an unreachable
 * quarter-metre gap behind every wall console on the ship, into which a walker
 * could be squeezed by the push-out and then trapped between two constraints
 * that cannot both be satisfied.
 */
const BRIDGE_STATIONS = [
  { id: 'helm', label: 'Helm', crew: 'helm', panel: 'helm', mounted: 'floor' },
  { id: 'navigation', label: 'Navigation', crew: 'helm', panel: 'navigation', mounted: 'floor' },
  { id: 'comms', label: 'Communications', crew: 'comms', panel: 'comms' , mounted: 'wall' },
  { id: 'engineering', label: 'Engineering', crew: 'engineering', panel: 'power' , mounted: 'wall' },
  { id: 'weapons', label: 'Weapons Control', crew: 'tactical', panel: 'weapons' , mounted: 'wall' },
  { id: 'science', label: 'Science', crew: 'science', panel: 'science' , mounted: 'wall' },
  { id: 'gravity', label: 'Gravity Control', crew: 'ops', panel: null , mounted: 'wall' },
  { id: 'damagecontrol', label: 'Damage Control', crew: 'damagecontrol', panel: 'damage' , mounted: 'wall' },
  { id: 'environmental', label: 'Environmental', crew: 'environmental', panel: null , mounted: 'wall' },
  { id: 'security', label: 'Internal Security', crew: 'security', panel: null , mounted: 'wall' },
];

/**
 * Place the outer stations around the ring.
 *
 * Helm and navigation are NOT on the ring — they sit side by side in the middle
 * of the room, forward of the chair and facing the viewscreen, which is the one
 * detail everybody remembers and the one a naive "space them evenly" would get
 * wrong. So the ring carries the other eight, spread across the arc that is not
 * the viewscreen and not the turbolift.
 */
function ringStations(radius) {
  const outer = BRIDGE_STATIONS.slice(2);
  // From just past the viewscreen (which is forward, +z) round to just short of
  // the turbolift (aft, -z), on both sides.
  const arcStart = 0.42;
  const arcEnd = Math.PI * 2 - 0.42;
  const step = (arcEnd - arcStart) / outer.length;
  return outer.map((s, i) => {
    const a = arcStart + step * (i + 0.5);
    return {
      ...s,
      // The consoles are set into the wall, so they stand a little inside it.
      at: [Math.sin(a) * (radius - 0.55), Math.cos(a) * (radius - 0.55)],
      // An officer at a console faces the wall, which is outward from centre.
      facing: a,
    };
  });
}

const BRIDGE_RADIUS = 5.2;

export const ROOMS = {
  bridge: {
    id: 'bridge',
    name: 'Main Bridge',
    deck: 1,
    // A ring around a central well. `inner` is the rail around the lower
    // command level, which you step down into rather than through.
    shape: { kind: 'ring', radius: BRIDGE_RADIUS, inner: 0, height: 2.6 },
    // The well floor sits below the outer ring. Purely visual — you can walk
    // the whole floor — but it is why the chair reads as being *in* something.
    well: { radius: 2.4, drop: 0.36 },
    stations: [
      // The two that are not on the ring.
      {
        ...BRIDGE_STATIONS[0], at: [0.62, 2.05], facing: 0,
      },
      {
        ...BRIDGE_STATIONS[1], at: [-0.62, 2.05], facing: 0,
      },
      ...ringStations(BRIDGE_RADIUS),
    ],
    props: [
      { id: 'chair', kind: 'chair', label: 'The command chair', at: [0, -0.2], facing: 0, radius: 0.55, solid: true },
      { id: 'rail', kind: 'rail', label: 'The bridge rail', at: [0, 0], facing: 0, radius: 0, solid: false },
    ],
    // Forward, and the whole reason the room is pointed the way it is.
    viewscreen: { at: [0, BRIDGE_RADIUS - 0.1], width: 3.4, height: 1.8 },
    exits: [
      { to: 'turbolift', at: [0, -(BRIDGE_RADIUS - 0.2)], width: 1.2, label: 'Turbolift' },
    ],
  },

  turbolift: {
    id: 'turbolift',
    name: 'Turbolift',
    deck: 1,
    // The one room that is not on a deck, because it is how you change decks.
    shape: { kind: 'box', width: 2.2, depth: 2.2, height: 2.6 },
    lift: true,
    stations: [
      { id: 'lift_control', label: 'Turbolift control', crew: null, panel: 'turbolift', at: [0.85, 0], facing: Math.PI / 2, mounted: 'wall' },
    ],
    props: [],
    // A lift reaches everywhere; the exits are generated from the deck list
    // rather than written out, because a lift that only goes where somebody
    // remembered to type is the classic way a ship stops being connected.
    exits: [],
  },

  corridor_a: {
    id: 'corridor_a',
    name: 'Deck 5 Corridor',
    deck: 5,
    shape: { kind: 'box', width: 2.6, depth: 14.0, height: 2.5 },
    stations: [],
    props: [
      { id: 'panel_a', kind: 'wallpanel', label: 'A wall panel', at: [1.15, 3.0], facing: -Math.PI / 2, radius: 0, solid: false },
      // Recessed into the bulkhead, so the wall is what stops you. A solid
      // circle here would sit mostly outside the corridor and pinch the
      // walkable width to nothing.
      { id: 'extinguisher', kind: 'locker', label: 'An emergency locker', at: [-1.15, -2.4], facing: Math.PI / 2, radius: 0.3, solid: false },
    ],
    exits: [
      { to: 'turbolift', at: [0, -6.8], width: 1.2, label: 'Turbolift' },
      { to: 'sickbay', at: [1.25, 2.0], width: 1.2, label: 'Sickbay' },
      { to: 'quarters', at: [-1.25, -1.0], width: 1.2, label: 'Captain’s quarters' },
    ],
  },

  sickbay: {
    id: 'sickbay',
    name: 'Sickbay',
    deck: 5,
    shape: { kind: 'box', width: 8.0, depth: 6.4, height: 2.5 },
    stations: [
      { id: 'biobed', label: 'The biobed', crew: 'medical', panel: 'medical', at: [-2.0, 1.4], facing: Math.PI / 2, mounted: 'wall' },
      { id: 'medlab', label: 'Medical laboratory', crew: 'medical', panel: 'medical', at: [2.6, 1.8], facing: Math.PI, mounted: 'wall' },
      { id: 'cmo_desk', label: 'The chief surgeon’s desk', crew: 'medical', panel: null, at: [2.6, -1.9], facing: Math.PI, mounted: 'wall' },
    ],
    props: [
      { id: 'bed2', kind: 'bed', label: 'A second biobed', at: [-2.0, -0.6], facing: Math.PI / 2, radius: 0.7, solid: true },
      { id: 'surgery', kind: 'table', label: 'The surgical bay', at: [0, 1.9], facing: 0, radius: 0.6, solid: true },
    ],
    exits: [
      { to: 'corridor_a', at: [3.9, -2.4], width: 1.2, label: 'Corridor' },
    ],
  },

  quarters: {
    id: 'quarters',
    name: 'Captain’s Quarters',
    deck: 5,
    shape: { kind: 'box', width: 5.6, depth: 6.2, height: 2.5 },
    stations: [
      { id: 'desk', label: 'The captain’s desk', crew: null, panel: 'log', at: [-1.4, 1.6], facing: 0, mounted: 'wall' },
      { id: 'wall_computer', label: 'The desk viewer', crew: null, panel: 'record', at: [1.6, 1.9], facing: 0, mounted: 'wall' },
    ],
    props: [
      { id: 'bunk', kind: 'bed', label: 'The bunk', at: [1.4, -1.4], facing: Math.PI, radius: 0.7, solid: true },
      { id: 'chess', kind: 'table', label: 'A three-dimensional chess set', at: [-1.5, -1.4], facing: 0, radius: 0.4, solid: true },
    ],
    exits: [
      { to: 'corridor_a', at: [0, -2.6], width: 1.2, label: 'Corridor' },
    ],
  },

  transporter: {
    id: 'transporter',
    name: 'Transporter Room',
    deck: 7,
    shape: { kind: 'box', width: 6.4, depth: 5.6, height: 2.5 },
    stations: [
      { id: 'transporter_console', label: 'The transporter console', crew: 'transporter', panel: 'transport', at: [0, -1.9], facing: 0, mounted: 'wall' },
    ],
    props: [
      // Six pads in a circle, which is what the set had and what makes the
      // room read at a glance.
      ...Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return {
          id: `pad${i}`, kind: 'pad', label: 'A transporter pad',
          at: [Math.sin(a) * 0.95, 1.5 + Math.cos(a) * 0.95], facing: 0,
          radius: 0.34, solid: false,
        };
      }),
    ],
    // Where an away team stands, and where you stand to beam down.
    padCentre: [0, 1.5],
    exits: [
      { to: 'turbolift', at: [-3.1, -1.6], width: 1.2, label: 'Turbolift' },
    ],
  },

  engineering: {
    id: 'engineering',
    name: 'Main Engineering',
    deck: 11,
    shape: { kind: 'box', width: 9.0, depth: 8.0, height: 3.6 },
    stations: [
      { id: 'main_console', label: 'The engineering console', crew: 'engineering', panel: 'power', at: [-3.1, 0.4], facing: -Math.PI / 2, mounted: 'wall' },
      { id: 'core_monitor', label: 'The intermix monitor', crew: 'engineering', panel: 'damage', at: [3.1, 0.4], facing: Math.PI / 2, mounted: 'wall' },
      { id: 'machine_shop', label: 'The machine shop', crew: 'engineering', panel: 'fabrication', at: [0, -3.1], facing: Math.PI, mounted: 'wall' },
    ],
    props: [
      { id: 'core', kind: 'core', label: 'The matter/antimatter reactor', at: [0, 1.9], facing: 0, radius: 1.1, solid: true },
      { id: 'conduit_a', kind: 'conduit', label: 'A plasma conduit', at: [-3.6, 3.0], facing: 0, radius: 0.35, solid: true },
      { id: 'conduit_b', kind: 'conduit', label: 'A plasma conduit', at: [3.6, 3.0], facing: 0, radius: 0.35, solid: true },
    ],
    exits: [
      { to: 'turbolift', at: [0, -3.9], width: 1.4, label: 'Turbolift' },
    ],
  },

  briefing: {
    id: 'briefing',
    name: 'Briefing Room',
    deck: 2,
    shape: { kind: 'box', width: 6.0, depth: 4.6, height: 2.5 },
    stations: [
      { id: 'briefing_screen', label: 'The briefing screen', crew: null, panel: 'missions', at: [0, 2.1], facing: 0, mounted: 'wall' },
      { id: 'briefing_terminal', label: 'The table terminal', crew: null, panel: 'crew', at: [1.9, -0.2], facing: Math.PI / 2, mounted: 'wall' },
    ],
    props: [
      { id: 'table', kind: 'table', label: 'The briefing table', at: [0, -0.2], facing: 0, radius: 1.2, solid: true },
    ],
    exits: [
      { to: 'turbolift', at: [-2.9, -1.6], width: 1.2, label: 'Turbolift' },
    ],
  },
};

/**
 * Rooms the turbolift serves.
 *
 * The RECIPROCAL of the rooms that have a lift door, generated rather than
 * written out. A lift that only goes where somebody remembered to type is how a
 * ship quietly stops being connected, and the reachability test would then be
 * asserting the typing rather than the ship.
 *
 * Reciprocal, not "everywhere", because a lift that opens directly into sickbay
 * makes the corridor outside it pointless — and a ship where every room is one
 * hop from every other is a menu with walls painted on.
 */
export const LIFT_STOPS = Object.values(ROOMS)
  .filter((r) => !r.lift && (r.exits ?? []).some((e) => e.to === 'turbolift'))
  .map((r) => ({ to: r.id, deck: r.deck, label: r.name }));

ROOMS.turbolift.exits = LIFT_STOPS.map((s) => ({ ...s, at: [0, 1.0], width: 1.2 }));

export const ROOM_LIST = Object.values(ROOMS);

/** Where a new commission starts: in the chair. */
export const START_ROOM = 'bridge';

/**
 * Find a room by name or id, tolerantly.
 *
 * Deliberately NOT fuzzy. `findPlace` in the gazetteer resolves star systems
 * from typed orders, and "go to sickbay" becoming a course for a system is the
 * obvious way this breaks — a fuzzy room matcher would make it likelier, not
 * less. Exact ids, exact names, and a short list of the ways people say these
 * eight rooms. Everything else is not a room.
 */
const ROOM_ALIASES = {
  bridge: 'bridge', 'main bridge': 'bridge', 'the bridge': 'bridge',
  turbolift: 'turbolift', lift: 'turbolift', elevator: 'turbolift',
  sickbay: 'sickbay', 'sick bay': 'sickbay', medbay: 'sickbay',
  infirmary: 'sickbay', 'medical bay': 'sickbay',
  engineering: 'engineering', 'main engineering': 'engineering',
  'engine room': 'engineering', 'the engine room': 'engineering',
  'transporter room': 'transporter', transporter: 'transporter',
  'transporter bay': 'transporter', 'the transporter room': 'transporter',
  'briefing room': 'briefing', briefing: 'briefing',
  'conference room': 'briefing', 'the briefing room': 'briefing',
  quarters: 'quarters', 'my quarters': 'quarters', 'captains quarters': 'quarters',
  'captain quarters': 'quarters', 'the captains quarters': 'quarters',
  corridor: 'corridor_a', 'the corridor': 'corridor_a', hallway: 'corridor_a',
};

export function findRoom(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  if (ROOMS[t]) return ROOMS[t];
  const id = ROOM_ALIASES[t];
  if (id) return ROOMS[id];
  // A longest-first scan, so "take me to the transporter room" beats the bare
  // word "transporter" inside it.
  const keys = Object.keys(ROOM_ALIASES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (new RegExp(`\\b${k}\\b`).test(t)) return ROOMS[ROOM_ALIASES[k]];
  }
  return null;
}

/** Every phrasing that names a room, for the parser's gazetteer. */
export const ROOM_WORDS = Object.keys(ROOM_ALIASES);
