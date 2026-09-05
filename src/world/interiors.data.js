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
  2: 'Deck 2 — Briefing room',
  3: 'Deck 3 — Recreation and crew quarters',
  5: 'Deck 5 — Sickbay',
  7: 'Deck 7 — Transporters, armoury and cargo',
  8: 'Deck 8 — Auxiliary control',
  11: 'Deck 11 — Engineering',
  19: 'Deck 19 — Hangar deck',
};

/** The deck numbers this plan uses, low to high. */
export const PLAN_DECKS = Object.keys(DECKS).map(Number).sort((a, b) => a - b);

/**
 * The same deck plan, renumbered for a hull that is not a Constitution.
 *
 * This plan is a Constitution's: eight decks between 1 and 19, on a ship with
 * twenty-three. Every hull in the game wore it unaltered, because nothing read
 * the published deck count — `DIMENSIONS.decks`, thirty-one records, written
 * and never read. An Oberth has EIGHT decks and its captain walked to "Deck 11
 * — Engineering" and "Deck 19 — Hangar deck"; the shipyard sells a runabout at
 * tier one, twenty-three metres and a single deck, whose captain could ride a
 * turbolift to fifteen rooms below a keel that is not there.
 *
 * Renumbering, not removal. A Defiant has an engine room, a transporter and an
 * armoury — it simply does not have them on decks 11, 7 and 19. What was wrong
 * was the NUMBER, and the number is the part the captain reads. Which
 * facilities a small hull carries at all is a content question with a much
 * wider blast radius (episode `where` gates, occupancy, the station panels,
 * lift connectivity) and is deliberately not answered here.
 *
 * Order and grouping are preserved: the bridge is deck 1 on every ship, rooms
 * that share a deck on a Constitution share one on every hull, and the order
 * from top to bottom never changes. A hull with fewer decks than the plan has
 * levels simply stacks them — which is what a small ship is.
 *
 * @param {number} hullDecks  the hull's published deck count
 * @returns {Map<number, number>} plan deck -> deck on this hull
 */
export function deckPlanFor(hullDecks) {
  const plan = PLAN_DECKS;
  const out = new Map();
  const n = Math.max(1, Math.floor(hullDecks || 0));
  // A hull with room for the plan as written keeps it. Only a hull that cannot
  // reach deck 19 gets renumbered, so a Constitution, an Excelsior and a Galaxy
  // are untouched and the numbers a player already knows do not move.
  if (n >= plan[plan.length - 1]) {
    for (const d of plan) out.set(d, d);
    return out;
  }
  // Scaled by DEPTH, not by index. Spreading the eight levels evenly put a
  // Miranda's engineering, a Constellation's and an Intrepid's all on deck 7 —
  // three different hulls of twelve, fourteen and fifteen decks with an
  // identical deck plan, which is the flatness this is meant to fix. Deck 11 of
  // 19 is two thirds of the way down whatever the hull is, so that is what gets
  // preserved: the hangar is on the keel, the bridge is on top, and everything
  // else keeps its position between them.
  const deepest = plan[plan.length - 1];
  for (const d of plan) {
    const depth = (d - 1) / (deepest - 1);
    out.set(d, Math.min(n, 1 + Math.round(depth * (n - 1))));
  }
  return out;
}

/** The label for a deck once it has been renumbered onto a hull. */
export function deckLabelFor(planDeck, hullDecks) {
  const actual = deckPlanFor(hullDecks).get(planDeck) ?? planDeck;
  const name = (DECKS[planDeck] ?? `Deck ${planDeck}`).split('—')[1]?.trim();
  return name ? `Deck ${actual} — ${name}` : `Deck ${actual}`;
}

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

const BRIDGE_RADIUS = 4.55;   // 9.1 m across, per the set plans

/**
 * The bridge is ten bays of 36 degrees, and that is not a stylisation.
 *
 * docs/RESEARCH.md §8: the set is a ring of ten flat wall segments at 36° each,
 * with the bay carrying the main viewer widened to 40.5°. Ten bays is why ten
 * departments is the right granularity and not a coincidence — each bay IS a
 * station.
 *
 * Bay 0 is the viewer, dead ahead. Bays are numbered clockwise from there
 * looking down, so bay 5 is dead astern. The turbolift is NOT dead astern: it
 * sits behind the chair and over to port, 36° off the centreline, which is one
 * whole bay round.
 */
export const BAY_COUNT = 10;
export const BAY_ANGLE = (Math.PI * 2) / BAY_COUNT;      // 36 degrees
export const VIEWER_BAY_ANGLE = 40.5 * Math.PI / 180;
/** Bay 6: one segment to port of dead astern. */
export const LIFT_BAY = 6;

/** The centre bearing of a bay, in radians, 0 = forward and increasing to starboard. */
export function bayBearing(index) {
  return index * BAY_ANGLE;
}

/**
 * Fill the bays with the eight stations that ring the room.
 *
 * Helm and navigation are NOT on the ring — they sit side by side in the middle
 * of the floor, forward of the chair and facing the viewer, which is the one
 * detail everybody remembers and the one a naive "space them evenly" gets
 * wrong. So bay 0 is the viewer, bay 6 is the turbolift, and the other eight
 * bays take one station each, which is exactly how many are left.
 */
function ringStations(radius) {
  const outer = BRIDGE_STATIONS.slice(2);
  const bays = [];
  for (let i = 1; i < BAY_COUNT; i++) if (i !== LIFT_BAY) bays.push(i);

  return outer.map((s, i) => {
    const a = bayBearing(bays[i]);
    return {
      ...s,
      bay: bays[i],
      // Set into the bay wall, standing a little proud of it.
      at: [Math.sin(a) * (radius - 0.55), Math.cos(a) * (radius - 0.55)],
      // An officer at a console faces the wall, which is outward from centre.
      facing: a,
    };
  });
}

export const ROOMS = {
  bridge: {
    id: 'bridge',
    name: 'Main Bridge',
    deck: 1,
    // A ring around a central well. `inner` is the rail around the lower
    // command level, which you step down into rather than through.
    shape: { kind: 'ring', radius: BRIDGE_RADIUS, inner: 0, height: 2.6, bays: BAY_COUNT },
    // The well floor sits below the outer ring. Purely visual — you can walk
    // the whole floor — but it is why the chair reads as being *in* something.
    well: { radius: 2.1, drop: 0.36 },
    stations: [
      // The two that are not on the ring.
      // Side by side in the middle of the floor, forward of the chair, both
      // looking at the viewer.
      { ...BRIDGE_STATIONS[0], at: [0.62, 1.62], facing: 0, bay: null },
      { ...BRIDGE_STATIONS[1], at: [-0.62, 1.62], facing: 0, bay: null },
      ...ringStations(BRIDGE_RADIUS),
    ],
    props: [
      // A clear two metres behind the helm officers' seats, which is what the
      // set had — close enough to speak to them without raising your voice and
      // far enough to see the viewer over their heads.
      { id: 'chair', kind: 'chair', label: 'The command chair', at: [0, -1.05], facing: 0, radius: 0.55, solid: true },
      { id: 'rail', kind: 'rail', label: 'The bridge rail', at: [0, 0], facing: 0, radius: 0, solid: false },
    ],
    // Forward, and the whole reason the room is pointed the way it is.
    // Bay 0, widened to 40.5 degrees. Two chords of that arc give its width.
    viewscreen: {
      at: [0, BRIDGE_RADIUS - 0.08],
      width: 2 * BRIDGE_RADIUS * Math.sin(VIEWER_BAY_ANGLE / 2) * 0.86,
      height: 1.50,
      bay: 0,
    },
    exits: [
      // Behind the chair and over to port, not dead astern. This is the single
      // most-noticed fact about the room's plan and the first build had it
      // straight back.
      {
        to: 'turbolift',
        at: [
          Math.sin(bayBearing(LIFT_BAY)) * (BRIDGE_RADIUS - 0.2),
          Math.cos(bayBearing(LIFT_BAY)) * (BRIDGE_RADIUS - 0.2),
        ],
        width: 1.3,
        label: 'Turbolift',
      },
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
      // docs/RESEARCH.md §11: the brig adjoins the briefing room. It is the one
      // interior adjacency the show states outright, and an adjacency is worth
      // more to this game than a deck number — a deck number is a label on a
      // lift button, a door is somewhere you can walk.
      { to: 'brig', at: [2.9, 0.6], width: 1.1, label: 'Brig' },
    ],
  },

  // ---------------------------------------------------------------- deck 3

  corridor_rec: {
    id: 'corridor_rec',
    name: 'Deck 3 Corridor',
    deck: 3,
    shape: { kind: 'box', width: 2.6, depth: 12.0, height: 2.5 },
    stations: [],
    props: [
      { id: 'rec_panel', kind: 'wallpanel', label: 'A wall panel', at: [1.15, 2.2], facing: -Math.PI / 2, radius: 0, solid: false },
      { id: 'rec_locker', kind: 'locker', label: 'An emergency locker', at: [-1.15, -3.0], facing: Math.PI / 2, radius: 0.3, solid: false },
    ],
    exits: [
      { to: 'turbolift', at: [0, -5.8], width: 1.2, label: 'Turbolift' },
      { to: 'rec', at: [1.25, 1.0], width: 1.3, label: 'Recreation Room' },
      { to: 'crewquarters', at: [-1.25, 3.2], width: 1.2, label: 'Crew Quarters' },
    ],
  },

  rec: {
    id: 'rec',
    name: 'Recreation Room',
    deck: 3,
    // The one room aboard that is not for working in. Wide and low, with the
    // furniture spread rather than ranked, because that is what makes a space
    // read as somewhere people choose to be.
    shape: { kind: 'box', width: 9.0, depth: 7.0, height: 2.6 },
    stations: [
      { id: 'rec_terminal', label: 'The wall terminal', crew: null, panel: 'crew', at: [0, 3.3], facing: 0, mounted: 'wall' },
      { id: 'rec_food', label: 'The food synthesiser', crew: null, panel: 'shop', at: [-4.1, 0.6], facing: -Math.PI / 2, mounted: 'wall' },
    ],
    props: [
      { id: 'rec_table_a', kind: 'table', label: 'A table', at: [-1.6, -0.4], facing: 0, radius: 0.85, solid: true },
      { id: 'rec_table_b', kind: 'table', label: 'A table', at: [2.2, 1.2], facing: 0, radius: 0.85, solid: true },
      { id: 'rec_table_c', kind: 'table', label: 'A table', at: [2.6, -2.0], facing: 0, radius: 0.75, solid: true },
      { id: 'rec_chair_a', kind: 'chair', label: 'A chair', at: [-3.0, -1.8], facing: Math.PI / 2, radius: 0.34, solid: true },
      { id: 'rec_chair_b', kind: 'chair', label: 'A chair', at: [0.4, 2.2], facing: Math.PI, radius: 0.34, solid: true },
    ],
    exits: [
      { to: 'corridor_rec', at: [-4.4, -2.6], width: 1.3, label: 'Corridor' },
    ],
  },

  crewquarters: {
    id: 'crewquarters',
    name: 'Crew Quarters',
    deck: 3,
    // Bigger than a bunkroom needs to be, and the reason is the walker rather
    // than the furniture. A solid prop needs its own radius plus a walker's
    // width of clearance from every wall, or there is a spot where the wall
    // pushes you into the bunk, the bunk pushes you into the wall, and neither
    // constraint can be met. Bunks shoved against a bulkhead failed exactly
    // that, so the compartment grew until they are genuinely free-standing.
    shape: { kind: 'box', width: 6.4, depth: 6.0, height: 2.4 },
    stations: [
      { id: 'crew_terminal', label: 'A desk terminal', crew: null, panel: 'log', at: [3.0, 0.4], facing: Math.PI / 2, mounted: 'wall' },
    ],
    props: [
      { id: 'bunk_a', kind: 'bed', label: 'A bunk', at: [-1.9, 1.2], facing: 0, radius: 0.7, solid: true },
      { id: 'bunk_b', kind: 'bed', label: 'A bunk', at: [-1.9, -1.2], facing: 0, radius: 0.7, solid: true },
      { id: 'crew_locker', kind: 'locker', label: 'A locker', at: [0.4, 2.8], facing: 0, radius: 0.3, solid: false },
    ],
    exits: [
      { to: 'corridor_rec', at: [3.1, -2.2], width: 1.2, label: 'Corridor' },
    ],
  },

  // ---------------------------------------------------------------- deck 7

  corridor_sec: {
    id: 'corridor_sec',
    name: 'Deck 7 Corridor',
    deck: 7,
    shape: { kind: 'box', width: 2.6, depth: 13.0, height: 2.5 },
    stations: [],
    props: [
      { id: 'sec_panel', kind: 'wallpanel', label: 'A wall panel', at: [1.15, -1.6], facing: -Math.PI / 2, radius: 0, solid: false },
      { id: 'sec_locker', kind: 'locker', label: 'An emergency locker', at: [-1.15, 3.4], facing: Math.PI / 2, radius: 0.3, solid: false },
    ],
    exits: [
      { to: 'turbolift', at: [0, -6.3], width: 1.2, label: 'Turbolift' },
      { to: 'armoury', at: [1.25, 1.4], width: 1.2, label: 'Armoury' },
      { to: 'transporter', at: [-1.25, -3.2], width: 1.2, label: 'Transporter Room' },
      { to: 'cargo', at: [0, 6.3], width: 1.4, label: 'Cargo Hold' },
    ],
  },

  armoury: {
    id: 'armoury',
    name: 'Armoury',
    deck: 7,
    shape: { kind: 'box', width: 5.0, depth: 4.4, height: 2.4 },
    stations: [
      { id: 'weapons_locker', label: 'The weapons locker', crew: 'security', panel: 'tactical', at: [0, 2.0], facing: 0, mounted: 'wall' },
      { id: 'issue_desk', label: 'The issue log', crew: 'security', panel: 'shop', at: [-2.3, -0.4], facing: -Math.PI / 2, mounted: 'wall' },
    ],
    props: [
      { id: 'rack_a', kind: 'locker', label: 'A phaser rack', at: [2.3, 0.8], facing: Math.PI / 2, radius: 0.3, solid: false },
      { id: 'rack_b', kind: 'locker', label: 'A phaser rack', at: [2.3, -0.8], facing: Math.PI / 2, radius: 0.3, solid: false },
    ],
    exits: [
      { to: 'corridor_sec', at: [-2.4, -1.6], width: 1.2, label: 'Corridor' },
    ],
  },

  brig: {
    id: 'brig',
    name: 'Brig',
    deck: 7,
    shape: { kind: 'box', width: 5.6, depth: 5.2, height: 2.4 },
    stations: [
      { id: 'brig_control', label: 'The detention console', crew: 'security', panel: 'damage', at: [0, -2.3], facing: Math.PI, mounted: 'wall' },
    ],
    props: [
      // Three cells along the far bulkhead. The force fields are drawn as
      // wall panels: a brig with nothing between you and the occupant is a
      // room with a bed in it.
      { id: 'cell_a', kind: 'wallpanel', label: 'A detention field', at: [-1.5, 2.4], facing: 0, radius: 0, solid: false },
      { id: 'cell_b', kind: 'wallpanel', label: 'A detention field', at: [0, 2.4], facing: 0, radius: 0, solid: false },
      { id: 'cell_c', kind: 'wallpanel', label: 'A detention field', at: [1.5, 2.4], facing: 0, radius: 0, solid: false },
      { id: 'brig_bunk', kind: 'bed', label: 'A cell bunk', at: [-1.5, 1.0], facing: 0, radius: 0.6, solid: true },
    ],
    exits: [
      { to: 'briefing', at: [-2.6, -1.3], width: 1.1, label: 'Briefing Room' },
    ],
  },

  cargo: {
    id: 'cargo',
    name: 'Cargo Hold',
    deck: 7,
    // The biggest space aboard that is not the hangar, and the ceiling is what
    // says so: three and a half metres against two and a half everywhere else.
    shape: { kind: 'box', width: 10.0, depth: 8.0, height: 3.6 },
    stations: [
      { id: 'manifest', label: 'The cargo manifest', crew: 'ops', panel: 'shop', at: [-4.6, 1.0], facing: -Math.PI / 2, mounted: 'wall' },
      { id: 'cargo_transporter', label: 'The cargo transporter', crew: 'transporter', panel: 'transport', at: [4.6, -1.0], facing: Math.PI / 2, mounted: 'wall' },
    ],
    props: [
      { id: 'crate_a', kind: 'locker', label: 'A cargo container', at: [-1.4, 2.2], facing: 0, radius: 0.8, solid: true },
      { id: 'crate_b', kind: 'locker', label: 'A cargo container', at: [1.2, 2.4], facing: 0, radius: 0.8, solid: true },
      { id: 'crate_c', kind: 'locker', label: 'A cargo container', at: [2.6, -0.6], facing: 0, radius: 0.9, solid: true },
      { id: 'crate_d', kind: 'locker', label: 'A cargo container', at: [-2.8, -1.8], facing: 0, radius: 0.7, solid: true },
    ],
    exits: [
      { to: 'corridor_sec', at: [0, -3.8], width: 1.4, label: 'Corridor' },
      { to: 'hangar', at: [0, 3.8], width: 1.6, label: 'Hangar Deck' },
    ],
  },

  // ------------------------------------------------- secondary hull, aft

  hangar: {
    id: 'hangar',
    name: 'Hangar Deck',
    // §11: the show gives the hangar no deck number, only that it is aft in the
    // secondary hull and that the hull is sixteen decks tall. So it gets a
    // number that is honest about being low and aft rather than a false
    // precision — and the turbolift reads this to sort its stops.
    deck: 19,
    shape: { kind: 'box', width: 16.0, depth: 20.0, height: 6.5 },
    stations: [
      { id: 'flight_control', label: 'Flight control', crew: 'shuttlebay', panel: 'galaxy', at: [-7.6, 4.0], facing: -Math.PI / 2, mounted: 'wall' },
      { id: 'bay_doors', label: 'The bay door control', crew: 'shuttlebay', panel: 'damage', at: [7.6, 4.0], facing: Math.PI / 2, mounted: 'wall' },
    ],
    props: [
      // Two shuttlecraft on the deck, parked square to the doors. Boxes rather
      // than hulls: a shuttle at this scale is a shape you walk around, and the
      // blueprint mesh is built for a viewscreen four thousand units away.
      { id: 'shuttle_a', kind: 'table', label: 'A shuttlecraft', at: [-4.0, -3.0], facing: 0, radius: 2.4, solid: true },
      { id: 'shuttle_b', kind: 'table', label: 'A shuttlecraft', at: [4.0, -3.0], facing: 0, radius: 2.4, solid: true },
      { id: 'tug', kind: 'locker', label: 'A deck tractor', at: [0, 6.0], facing: 0, radius: 0.9, solid: true },
    ],
    exits: [
      { to: 'cargo', at: [0, -9.6], width: 1.6, label: 'Cargo Hold' },
      // Its own lift, and it has to have one. Without it deck 19 hangs off the
      // cargo hold on deck 7, which means every trip to the hangar is a walk
      // the length of the secondary hull — and a ship where a whole deck is
      // reachable only through another compartment is not a ship, it is a
      // corridor with rooms bolted to the end.
      { to: 'turbolift', at: [-7.6, -9.6], width: 1.2, label: 'Turbolift' },
    ],
  },

  // --------------------------------------------------------------- deck 8

  auxcontrol: {
    id: 'auxcontrol',
    name: 'Auxiliary Control',
    deck: 8,
    // The bridge in miniature: the room the ship is fought from when the bridge
    // is gone. Same stations, half the size, no viewer.
    shape: { kind: 'box', width: 6.2, depth: 5.0, height: 2.5 },
    stations: [
      { id: 'aux_helm', label: 'The auxiliary helm', crew: 'helm', panel: 'helm', at: [-1.4, 2.1], facing: 0, mounted: 'wall' },
      { id: 'aux_weapons', label: 'The auxiliary weapons board', crew: 'tactical', panel: 'weapons', at: [1.4, 2.1], facing: 0, mounted: 'wall' },
      { id: 'aux_power', label: 'The auxiliary power board', crew: 'engineering', panel: 'power', at: [-3.0, -0.6], facing: -Math.PI / 2, mounted: 'wall' },
      { id: 'aux_damage', label: 'The damage board', crew: 'damagecontrol', panel: 'damage', at: [3.0, -0.6], facing: Math.PI / 2, mounted: 'wall' },
    ],
    props: [],
    exits: [
      { to: 'turbolift', at: [0, -2.4], width: 1.2, label: 'Turbolift' },
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

  // Deck 3.
  'recreation room': 'rec', recreation: 'rec', 'rec room': 'rec',
  'the rec room': 'rec', 'mess hall': 'rec', mess: 'rec', lounge: 'rec',
  'crew quarters': 'crewquarters', 'the crew quarters': 'crewquarters',
  bunkroom: 'crewquarters', 'crew berthing': 'crewquarters',
  'deck 3 corridor': 'corridor_rec',

  // Deck 7.
  armoury: 'armoury', armory: 'armoury', 'the armoury': 'armoury',
  'the armory': 'armoury', 'weapons locker': 'armoury',
  brig: 'brig', 'the brig': 'brig', detention: 'brig',
  'detention cells': 'brig', jail: 'brig',
  'cargo hold': 'cargo', cargo: 'cargo', 'the cargo hold': 'cargo',
  'cargo bay': 'cargo', hold: 'cargo',
  'deck 7 corridor': 'corridor_sec',

  // Deck 8 and the secondary hull.
  'auxiliary control': 'auxcontrol', 'aux control': 'auxcontrol',
  'the auxiliary control room': 'auxcontrol', 'secondary bridge': 'auxcontrol',
  'hangar deck': 'hangar', hangar: 'hangar', 'the hangar': 'hangar',
  'shuttle bay': 'hangar', shuttlebay: 'hangar', 'the shuttlebay': 'hangar',
  'flight deck': 'hangar',
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

// There was a `ROOM_WORDS` export here — `Object.keys(ROOM_ALIASES)`, with a
// docstring saying it was "for the parser's gazetteer." Nothing ever imported
// it, and it should not be wired now: the gazetteer's business is fuzzy and
// phonetic matching of star system names, and the note above says room
// matching is deliberately NOT fuzzy. Handing it `bridge`, `brig` and `cargo`
// as place words is how "set course for the bridge" starts resolving to a
// star. Room names reach the parser the way they always have, through
// `findRoom`'s own exact longest-first scan, called from the `go_to_room`
// intent.
