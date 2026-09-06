// Every screen in the game, rendered fresh from state on each frame that
// needs it. No virtual DOM, no diffing — the panels are small enough that a
// straight rebuild is cheaper than any machinery to avoid one.

import {
  el, clear, panel, button, readout, shieldDiagram, powerSlider,
  pill, modal, field, textInput, select, officerRow, logLine, channelName,
} from './lcars.js';

/**
 * The pill colour for each assessment band. Green for a fight you will win,
 * red for one you will not — and 'even' left plain, because a fight you might
 * lose is the ordinary case and colouring it teaches the captain to ignore the
 * colour.
 */
const ODDS_TONE = {
  nocontest: 'green', favourable: 'green', even: '', dangerous: 'amber', hopeless: 'red',
};
import { haptic } from './touch.js';
import { audio } from '../audio/engine.js';
import { chairPanel } from './chair.js';
import { commandReference } from './orders.js';
import { namesFor } from '../sim/address.js';
import { inArc, SUBSYSTEM_KEYS } from '../sim/ship.js';
import { OBJECTIVES } from '../sim/combat.js';
import { weakestFacing } from '../sim/powers.js';

/** What each targetable subsystem is called on a button, and out loud. */
const SUBSYSTEM_TARGET_LABEL = {
  weapons: 'Weapons', shields: 'Shields', engines: 'Engines', warpcore: 'Warp core',
  sensors: 'Sensors', lifesupport: 'Life support', auxiliary: 'Auxiliary',
};
// `DECKS` was imported here too and used only in a comment. The deck label is
// `game.deckLabel` now, which is the one place that knows which hull this is.
import { ROOMS } from '../world/interiors.data.js';
import { listBackups, downloadSave } from '../core/save.js';
import { RECIPE_BY_ID, availableRecipes, MATERIAL_LIST } from '../sim/fabrication.js';
import {
  DIVISIONS, SPECIALITIES, ASSIGNMENTS, availableAssignments, dutySlots,
} from '../sim/duty.js';
import { SCENARIO as KOBAYASHI, GAMBIT_TIER } from '../missions/kobayashi.js';

import { MODES } from '../core/state.js';
import { SUBSYSTEMS, SUBSYSTEM_LABEL, SUBSYSTEM_EFFECT, PRESET_LIST } from '../sim/power.js';
import { SKILLS, BRANCHES, BRANCH_LABEL, RANKS } from '../sim/skills.js';
import { findingFor, venueFor, sitsAt } from '../rules/inquiry.js';
import { CONSOLES, SET_LIST } from '../sim/loadout.js';
import { TIERS, TRAIT_LIST } from '../sim/mastery.js';
import { ABILITIES } from '../sim/officers.js';
import { HAZARD_LEVEL, awayHours } from '../sim/away.js';
import { availableHails } from '../sim/diplomacy.js';
import { STATIONS, ERA_LIST, SPECIES } from '../world/crews.data.js';
import { FACTIONS, standingTier } from '../world/factions.data.js';
import { distanceLy } from '../world/systems.data.js';
import { travelHours, fuelCost } from '../world/galaxy.js';
import { orbitPeriod, rotationPeriod } from '../world/orbit.js';
import { surfaceReport } from '../world/surface.js';
import { formatDuration } from '../core/time.js';
import { commandableAt } from '../world/ships.data.js';

// ---------------------------------------------------------------- helpers

function tap(fn, cue = 'ui_tap', feel = 'tap') {
  return (...args) => {
    audio.play(cue);
    haptic(feel);
    return fn(...args);
  };
}

/**
 * The con, as a button and as the phrase that does the same thing.
 *
 * Two states and never both: either you have it and can give it away, or a
 * watch officer has it and is holding it until you take it back. The label
 * names whoever has it, because "take the con back" from nobody in particular
 * is the kind of line that makes a crew feel like furniture.
 */
function conButtons(g, app) {
  const holder = g.conOfficer;
  const out = [];
  if (holder) {
    out.push(button(`${holder.name} has the con`, tap(() => {
      const r = g.takeCon();
      if (!r.ok) g.pushLog(r.reason, 'computer');
      app.render();
    }), { color: 'orange', sub: 'Take it back and hear the report', say: 'i have the con' }));
  } else {
    const relief = g.watchOrder[0];
    out.push(button('Hand over the con', tap(() => {
      const r = g.handOverCon();
      if (!r.ok) g.pushLog(r.reason, 'computer');
      app.render();
    }), {
      color: 'ghost',
      sub: relief ? `${relief.rank} ${relief.name} stands the watch` : 'Nobody is fit to relieve you',
      disabled: !relief,
      say: 'you have the con',
    }));
  }
  return out;
}

// ================================================================ BRIDGE

/**
 * The bridge, in first person.
 *
 * This screen IS the game now. There is no tactical tab, no viewer tab and no
 * map tab, because a viewscreen is where a starship's crew sees what is
 * outside and a console is where they read what the ship knows. Tabs are for
 * text: the log, the record, the manual.
 *
 * What is left in the DOM is the order line and one strip: where you are, and
 * what your hand is on. Everything else you walk to.
 */
/**
 * "A thermal vent" -> "a thermal vent", so it reads inside a sentence.
 *
 * Only the first character, not `toLowerCase()` on the whole string: the
 * feature labels have no proper nouns in them today and the day one does,
 * flattening it would be wrong and silent.
 */
const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

export function bridgeScreen(app) {
  const g = app.game;
  const root = el('div', { class: 'screen bridge3d-screen' });

  // The GL canvas is a singleton that gets MOVED between screens rather than
  // rebuilt — a WebGL context is expensive, browsers cap how many can exist,
  // and making a fresh one per render silently blacks out the display.
  let wrap = app.tacticalHost;
  if (!wrap) {
    wrap = el('div', { class: 'tactical-wrap' }, [
      el('canvas', { id: 'tactical' }),
      el('div', { class: 'tactical-overlay' }),
    ]);
    app.tacticalHost = wrap;
  }
  app.tacticalCanvas = wrap.querySelector('#tactical');
  app.tacticalOverlay = wrap.querySelector('.tactical-overlay');
  root.append(wrap);

  const side = el('div', { class: 'bridge3d-side scroll' });
  root.append(side);

  const w = g.walk;
  const target = w.looking;
  const walking = g.walkOrder;

  // --- What your hand is on ---
  const hand = [];
  if (walking) {
    hand.push(el('p', { class: 'muted', text: `Under way to ${ROOMS[walking.toId]?.name ?? walking.toId}.` }));
    hand.push(button('Stop here', tap(() => { g.walkOrder = null; app.render(); }),
      { color: 'ghost', say: 'all stop' }));
  } else if (target) {
    // Three kinds of thing get this button and they used to get two templates.
    //
    // A surface feature carries a `check` — no station aboard the ship does —
    // and it was being offered as `Use a thermal vent`, subtitled `Open this
    // console`. There is no console. It is a vent, on a planet, and the
    // question the button is really asking is whether to send people to it.
    //
    // `target.check` was already consulted, for the SPOKEN phrase only: the
    // code knew it was a survey and said "survey that" while the button said
    // "use" and the subtitle described furniture. One branch of a three-way
    // distinction, applied to one of its three readers.
    //
    // What goes in the subtitle instead is the decision. `hazard` is not
    // flavour — `HAZARD_LEVEL` in sim/away.js turns it into a 4, 14 or 28 per
    // cent chance of injury, a 0.4, 2 or 6 per cent chance of somebody not
    // coming back, and 5, 11 or 19 hours of commission time. A captain was
    // being asked to spend a day and to risk a death by a button that said
    // "Open this console".
    const survey = target.check ? (HAZARD_LEVEL[target.hazard] ?? null) : null;
    hand.push(button(
      survey ? `Survey ${lowerFirst(target.label)}`
        : target.panel || target.id ? `Use ${target.label ?? ROOMS[target.to]?.name}` : 'Use',
      tap(() => app.useWhatIsInFront()),
      {
        color: 'orange',
        sub: survey
          ? `${survey.label} — ${target.check} team, ${awayHours(target)} hours`
          : target.panel ? 'Open this console' : 'Through the door',
        say: target.check ? 'survey that' : target.panel ? 'use it' : 'through the door',
      },
    ));
  } else if (w.seated) {
    hand.push(el('p', { class: 'muted', text: 'You have the chair. Say what you want done, or stand up and walk to a station.' }));
    hand.push(button('Stand up', tap(() => { g.takeChair(false); app.render(); }),
      { color: 'blue', say: 'stand up' }));
    hand.push(...conButtons(g, app));
  } else if (w.room.surface) {
    hand.push(el('p', { class: 'muted', text: `On the surface of ${w.room.name}. ${surfaceReport(w.room.kind)}.` }));
    hand.push(button('Energise — beam up', tap(() => {
      const r = g.beamUp();
      if (r.ok) audio.play('transporter');
      app.render();
    }), { color: 'orange', sub: 'Back aboard', say: 'energise' }));
  } else {
    hand.push(el('p', { class: 'muted', text: 'Drag to look. Walk to a station to use it.' }));
    if (w.roomId === 'bridge') {
      hand.push(button('Take the chair', tap(() => { g.takeChair(true); app.render(); }),
        { color: 'orange', say: 'take the chair' }));
      hand.push(...conButtons(g, app));
    } else if (g.conOfficer) {
      // Off the bridge, the con is not yours to take from down here — but you
      // should be able to see who is standing it without walking back up.
      hand.push(el('p', {
        class: 'muted',
        text: `${g.conOfficer.rank} ${g.conOfficer.name} has the con. ${g.watch.name} is standing.`,
      }));
    }
  }

  // Somewhere to walk, without having to aim at a door.
  const doors = w.room.lift ? w.liftStops() : (w.room.exits ?? []);
  if (!walking && doors.length) {
    hand.push(el('div', { class: 'chip-row' }, doors.slice(0, 6).map((e) => button(
      ROOMS[e.to]?.name ?? e.to,
      tap(() => { if (g.goToRoom(e.to).ok) audio.play('door'); app.render(); }),
      { color: 'blue', say: `take me to the ${(ROOMS[e.to]?.name ?? e.to).toLowerCase()}` },
    ))));
  }

  side.append(panel(w.room.name, hand, walking ? 'accent' : ''));

  // --- Somebody is calling, or we are under way ---
  // These used to be whole screens that replaced the bridge. They are things
  // that happen WHILE you are sitting in the chair, so they belong here.
  if (g.mode === MODES.ENCOUNTER && g.encounter) {
    side.append(encounterPanel(app));
  } else if (g.mode === MODES.TRANSIT && g.transit) {
    side.append(transitPanel(app));
  } else if (g.orbit && g.orbitBody) {
    side.append(orbitPanel(app));
  }

  // An episode in progress is something happening around you, not a screen you
  // were sent to. It hangs here for the same reason a hail does.
  if (g.missions.active) side.append(missionPanel(app));

  // --- The one thing that has to be visible without walking anywhere ---
  // Whether the ship is in danger. A captain does not have to consult a panel
  // to know the hull is failing, and hiding it behind a walk would be a
  // simulation of bureaucracy rather than of command.
  const eng = g.engagement;
  if (eng && !eng.over) {
    side.append(panel('Engaged', [
      el('div', { class: 'meta' }, [
        pill(`${eng.liveHostiles.length} hostile${eng.liveHostiles.length === 1 ? '' : 's'}`, 'red'),
        eng.target && !eng.target.destroyed ? pill(`${Math.round(g.ship.distanceTo(eng.target))} km`) : null,
        g.ship.shieldsUp ? pill('shields up', 'green') : pill('shields down', 'red'),
      ].filter(Boolean)),
      readout('Hull', g.ship.hullPct),
      el('p', { class: 'hint', text: 'They are on the viewer. Say what you want done — “fire phasers”, “evasive”, “target their engines” — or walk to weapons and do it yourself.' }),
    ], 'danger'));
  } else if (g.ship.hullPct < 1) {
    side.append(panel('Ship', [readout('Hull', g.ship.hullPct)],
      g.ship.hullPct < 0.4 ? 'danger' : 'warn'));
  }

  // --- Recent log ---
  side.append(panel('Ship’s Log', [
    ...g.log.slice(-4).reverse().map(logLine),
    button('Full log', tap(() => app.go('log')), { color: 'ghost', say: 'show me the log' }),
  ]));
  return root;
}

/**
 * The old panel bridge, kept as the console the captain's chair opens.
 *
 * Everything that used to be a permanent panel on the bridge screen is now
 * behind a console you walk to — but the chair itself is a console, and this is
 * what it shows: where we are, how the commission is going, and the ship.
 */
export function chairConsole(app) {
  const g = app.game;
  const root = el('div', { class: 'scroll' });


  // --- Where we are ---
  const sys = g.location;
  const locPanel = panel('Position', [
    el('p', {}, [el('b', { text: sys.name }), ' — ', el('span', { class: 'muted', text: sys.description })]),
    el('div', { class: 'meta' }, [
      pill(sys.type),
      sys.contested ? pill('contested', 'red') : null,
      sys.hazard ? pill(sys.hazard.replace(/_/g, ' '), 'red') : null,
      ...(sys.facilities ?? []).map((f) => pill(f, 'green')),
    ]),
  ], 'accent');
  locPanel.classList.add('sys-card');
  root.append(locPanel);

  // --- The commission ---
  // Five years of real time, and how far through them this captain is. It sits
  // at the top of the bridge because it is the frame the whole game hangs on:
  // reputation earned over a career only means something if you can see the
  // career going past.
  if (g.campaign) {
    const pct = g.campaign.progress;
    root.append(panel('Commission', [
      el('p', {}, [
        el('b', { text: g.campaign.format() }),
        ' — ',
        el('span', { class: 'muted', text: g.campaign.remainingText() }),
      ]),
      readout('Five-year mission', pct, `${Math.round(pct * 100)}%`),
      g.campaign.compression > 1
        ? el('p', { class: 'muted', text: `Time compression ×${g.campaign.compression}. This is not the five-year mission.` })
        : null,
    ].filter(Boolean)));
  }

  // --- Ship status ---
  root.append(panel('Ship Status', [
    shieldDiagram(g.ship),
    readout('Crew', g.ship.crewPct, `${g.ship.crew}`),
    readout('Antimatter', g.ship.antimatter / 100, `${g.ship.antimatter.toFixed(0)}%`),
    g.ship.maxTorpedoes > 0
      ? readout('Torpedoes', g.ship.torpedoes / g.ship.maxTorpedoes, `${g.ship.torpedoes}`)
      : null,
    g.ship.fires > 0 ? el('p', { class: 'muted', text: `${g.ship.fires} fire${g.ship.fires > 1 ? 's' : ''} burning on the hull.` }) : null,
    // Intruders, said on the same panel as the fires and for the same
    // reason: it is a thing happening to the ship right now that the
    // captain has an order for. Nothing anywhere used to report it, because
    // nothing could ever put one aboard.
    g.ship.boarders > 0 ? el('p', { class: 'muted', text: `${Math.ceil(g.ship.boarders)} intruder${Math.ceil(g.ship.boarders) > 1 ? 's' : ''} aboard. Say "repel boarders".` }) : null,
    g.ship.coreEjected ? el('p', {
      class: 'muted',
      // Two different sentences, because they are two different situations and
      // the difference is a rank-two feat. A ship with a Master Engineer aboard
      // has a core drifting off the quarter with a transponder on it; everyone
      // else has an impulse ship and a long walk to a yard.
      text: g.ship.coreRecoverable
        ? 'Warp core ejected and still on our sensors. Say "recover the core" when they stop shooting.'
        : 'Warp core ejected. Impulse only until we dock.',
    }) : null,
  ], g.ship.hullPct < 0.4 ? 'danger' : g.ship.hullPct < 0.8 ? 'warn' : ''));

  // --- Missions here ---
  root.append(ordersAvailablePanel(app));

  // --- Actions ---
  const actions = [];
  if (g.canDock()) {
    actions.push(button('Request docking', tap(() => {
      const r = g.dock();
      if (r.ok) { audio.play('dock'); haptic('confirm'); }
      // A board of inquiry concluding is not a thing to leave in the log
      // strip. It can cost a rank.
      if (r.finding) app.showMessage('Board of Inquiry', [r.finding.text].concat(r.finding.reducedTo ? [`Your rank is now ${r.finding.reducedTo}.`] : []));
      app.render();
    }, 'ui_confirm'), {
      say: 'request docking',
      color: 'green',
      // The board sits ashore, so putting in is what convenes it. Said on the
      // button, because a captain choosing to dock is choosing to be tried.
      sub: g.ledger.inquiryOpen && sitsAt(g.location)
        ? `Full repair and resupply — and the board of inquiry sits. Likely finding: ${findingFor(g.ledger).label.toLowerCase()}.`
        : 'Full repair, resupply, and crew replacement',
    }));
  }
  actions.push(button('Set course', tap(() => app.go('galaxy')), { color: 'blue', sub: 'Plot a course to another system' }));
  actions.push(button('Long-range scan', tap(() => {
    audio.play('scan');
    const enc = app.scanSystem();
    app.showMessage('Sensor Sweep', enc);
  }, 'scan'), { say: 'scan the system', color: 'ice' }));

  if (g.ship.hullPct < 1 && !g.canDock()) {
    actions.push(button('Effect repairs', tap(() => {
      const r = g.effectRepairs();
      if (!r.ok) { app.showMessage('Repairs', [r.reason]); return; }
      app.showMessage('Repairs', [
        `Hull integrity ${Math.round(r.before * 100)}% → ${Math.round(r.after * 100)}%.`,
        r.blue
          ? 'Fourteen hours, with the whole crew at maintenance stations.'
          : 'Nineteen hours. The chief says that is the best she can do without a starbase.',
      ]);
    }), {
      say: 'effect repairs',
      color: 'peach',
      sub: g.alert === 'blue'
        ? 'Blue alert: maintenance stations manned, repairs go faster'
        : 'Costs time. Cannot fully repair without a starbase.',
    }));
  }
  root.append(panel('Bridge', actions));

  // --- The chair ---
  root.append(chairPanel(app));

  // --- Recent log ---
  // Six lines and a way to the rest of it. The full log screen was written and
  // wired into the router and nothing ever navigated to it, so a five-year
  // commission's record stopped at whatever happened in the last few minutes.
  root.append(panel('Ship’s Log', [
    ...g.log.slice(-6).reverse().map(logLine),
    // Always offered, not only once the log is long. A way out that appears
    // later is a way out nobody finds.
    button(`Full log — ${g.log.length} entr${g.log.length === 1 ? 'y' : 'ies'}`,
      tap(() => app.go('log')), { color: 'ghost', say: 'show me the log' }),
  ]));
  return root;
}

// ============================================================ WHERE YOU ARE

/**
 * Which compartment the captain is standing in, and what is to hand.
 *
 * Deliberately a panel rather than a screen. Being aboard is a fact about the
 * game state, not a mode you enter — the orders that move you work from
 * anywhere, and the first-person view is a way of LOOKING at this, not a
 * prerequisite for it.
 */
export function positionPanel(app) {
  const g = app.game;
  const w = g.walk;
  const room = w.room;
  const walking = g.walkOrder;

  const body = [
    el('p', {}, [
      el('b', { text: room.name }),
      ' — ',
      // Just the number: the deck names in DECKS already carry the room name
      // ("Deck 5 — Sickbay"), which read as "Sickbay — Deck 5 — Sickbay" here.
      //
      // Through `deckOf`, because the plan is a Constitution's and this is the
      // line that told an Oberth captain they were on deck 11 of an eight-deck
      // ship.
      el('span', { class: 'muted', text: `Deck ${g.deckOf(room) ?? room.deck}` }),
    ]),
  ];

  if (walking) {
    const to = ROOMS[walking.toId];
    body.push(el('p', { class: 'muted', text: `Under way to ${to?.name ?? walking.toId}.` }));
    body.push(button('Stop here', tap(() => { g.walkOrder = null; app.render(); }), { color: 'ghost' }));
  } else {
    if (w.seated) {
      body.push(el('p', { class: 'muted', text: 'In the command chair.' }));
    } else if (w.atStation) {
      body.push(el('div', { class: 'meta' }, [pill(`at ${w.atStation.label}`, 'green')]));
    }

    // Somewhere to go. Only the rooms you can reach in one move are offered as
    // buttons; anything else is an order away — "go to sickbay" works from
    // wherever you are and routes itself.
    const doors = w.room.lift ? w.liftStops() : (room.exits ?? []);
    if (doors.length) {
      body.push(el('div', { class: 'chip-row' }, doors.slice(0, 6).map((e) => button(
        ROOMS[e.to]?.name ?? e.to,
        tap(() => {
          const r = g.goToRoom(e.to);
          if (r.ok) audio.play('door'); else audio.play('ui_deny');
          app.render();
        }),
        { color: 'blue' },
      ))));
    }
    body.push(el('p', { class: 'hint', text: 'Or say where you want to be — “go to sickbay”, “take me to engineering”. You walk there; the crew keeps working while you do.' }));
  }

  return panel('Aboard', body, walking ? 'accent' : '');
}

// ================================================================ TRANSIT

export function transitScreen(app) {
  const root = el('div', { class: 'scroll' });
  if (!app.game.transit) return root;
  root.append(transitPanel(app));
  root.append(panel('Ship’s Log', app.game.log.slice(-5).reverse().map(logLine)));
  return root;
}

/**
 * Under way, as a panel.
 *
 * Being at warp is something you are doing while sitting in the chair, not a
 * different place to be — so this hangs on the bridge rather than replacing it.
 */
export function transitPanel(app) {
  const g = app.game;
  const t = g.transit;
  const wrap = el('div', {});
  if (!t) return wrap;

  wrap.append(panel('Under Way', [
    el('p', { html: `Course: <b>${t.from.name}</b> → <b>${t.to.name}</b>` }),
    el('p', { class: 'muted', text: `Warp ${t.warpFactor.toFixed(1)} · ${t.route.lightYears.toFixed(1)} light-years · ${formatDuration(t.totalHours)} at this speed${t.route.charted ? '' : ' · uncharted course'}` }),
    readout('Progress', t.progress, `${Math.round(t.progress * 100)}%`),
    readout('ETA', 1 - t.progress, formatDuration(Math.max(0, t.remainingHours))),
  ], 'accent'));

  wrap.append(panel('Helm', [
    button('Drop out of warp', tap(() => {
      // What this DOES is `Game.dropOutOfWarp`, so the typed order and the
      // button are the same action rather than two that look alike.
      if (g.dropOutOfWarp().ok) audio.play('warp_drop');
      app.render();
    }, 'ui_back'), { say: 'drop out of warp', color: 'ghost' }),
  ]));

  return wrap;
}

/**
 * In orbit, as a panel.
 *
 * Says what is out of the window and how long a circuit takes, because both are
 * real numbers the game computes rather than flavour: the period comes out of
 * the world's density, and a captain who is about to send people down deserves
 * to know how long the ship is over them.
 */
export function orbitPanel(app) {
  const g = app.game;
  const body = g.orbitBody;
  const wrap = el('div', {});
  if (!body) return wrap;

  const period = orbitPeriod(body.kind) / 3600;
  const day = rotationPeriod(body.kind) / 3600;
  const KIND = {
    planet: 'Class M — atmosphere, surface water, life',
    desert: 'Class K — thin air, arid, survivable in a suit',
    moon: 'Airless satellite — no atmosphere, no weather',
    ice: 'Class P — frozen surface, subsurface liquid possible',
    gas: 'Class J — gas giant, no surface to stand on',
  };

  wrap.append(panel('Standard Orbit', [
    el('p', { html: `Holding station over <b>${g.orbitLabel}</b>` }),
    el('p', { class: 'muted', text: KIND[body.kind] ?? 'Survey incomplete' }),
    el('div', { class: 'meta' }, [
      pill(`orbit ${period < 24 ? `${period.toFixed(1)} h` : `${(period / 24).toFixed(1)} d`}`),
      pill(`day ${day < 48 ? `${day.toFixed(1)} h` : `${(day / 24).toFixed(0)} d`}`),
    ]),
    el('p', { class: 'hint', text: 'She is on the viewer.' }),
    button('Break orbit', tap(() => { g.breakOrbit(); app.render(); }),
      { color: 'ghost', say: 'break orbit' }),
  ], 'accent'));

  return wrap;
}

// ============================================================== VIEWSCREEN

/**
 * The main viewer.
 *
 * Same GL context, same meshes, same frame as the tactical plot — the only
 * difference is where the camera stands. The plot looks in at the engagement
 * from outside; this looks out over the bow from where the bridge is. That is
 * the whole implementation, and it is the right one: a second renderer would
 * mean a second WebGL context, and browsers quietly drop the oldest when you
 * open too many.
 *
 * The controls are deliberately thin. On the viewscreen you are in the chair,
 * and the chair's instrument is the order line — you say "fire phasers" and
 * the tactical officer fires them. The buttons here are for the two things a
 * captain does with the screen itself: point it, and put it away.
 */
export function viewscreenScreen(app) {
  const g = app.game;
  const eng = g.engagement;
  const root = el('div', { class: 'screen viewscreen-screen' });

  // The viewport node is a singleton that gets *moved* between screens rather
  // than rebuilt — see the note in tacticalScreen. Here it is moved inside a
  // bezel instead of sitting flush.
  let wrap = app.tacticalHost;
  if (!wrap) {
    wrap = el('div', { class: 'tactical-wrap' }, [
      el('canvas', { id: 'tactical' }),
      el('div', { class: 'tactical-overlay' }),
    ]);
    app.tacticalHost = wrap;
  }
  app.tacticalCanvas = wrap.querySelector('#tactical');
  app.tacticalOverlay = wrap.querySelector('.tactical-overlay');

  const bezel = el('div', { class: 'viewscreen-bezel' }, [wrap]);
  root.append(el('div', { class: 'viewscreen-housing' }, [bezel]));

  const side = el('div', { class: 'viewscreen-side scroll' });
  root.append(side);

  // A status strip, not a console. What is on the screen, and whether it is
  // about to shoot at us.
  const sys = g.location;
  const status = [
    el('p', {}, [el('b', { text: sys.name }), ' — ', el('span', { class: 'muted', text: sys.description })]),
  ];
  if (eng && !eng.over) {
    const t = eng.target;
    // Tactical's own reading of the fight, live rather than at the opening
    // bell — a battle that was outmatched three ships ago is not outmatched
    // now. It is the one number that answers "should I be running?", which
    // played through the encounter generator was a question the game never
    // answered until the ship was gone.
    const odds = eng.assess?.();
    status.push(el('div', { class: 'meta' }, [
      pill(`${eng.liveHostiles.length} hostile${eng.liveHostiles.length === 1 ? '' : 's'}`, 'red'),
      odds ? pill(odds.label, ODDS_TONE[odds.band] ?? null) : null,
      t && !t.destroyed ? pill(`${Math.round(g.ship.distanceTo(t))} km`) : null,
      g.ship.shieldsUp ? pill('shields up', 'green') : pill('shields down', 'red'),
    ].filter(Boolean)));
    if (t && !t.destroyed) {
      // The name once, then the two bars. `readout` puts its label in a fixed
      // narrow column, so "IKS Ch'Tang hull" wrapped onto three lines and then
      // said it again for the shields — six lines of label for two numbers, on
      // a phone, with a Klingon shooting at you.
      status.push(el('p', {}, [el('b', { text: t.name }), ' — ', t.cls.name]));
      status.push(readout('Hull', t.hullPct));
      status.push(readout('Shields', t.shieldPct));
    }
  }
  side.append(panel('On Screen', status, eng && !eng.over ? 'danger' : 'accent'));

  side.append(panel('Main Viewer', [
    el('div', { class: 'grid-2' }, [
      button('Steady as she goes', tap(() => {
        app.tactical?.centreLook?.();
      }), { say: 'steady as she goes', color: 'blue', sub: 'Point the screen back down the bow' }),
      button('Magnify', tap(() => {
        const v = app.tactical;
        if (!v?.setMagnification) return;
        // Cycles rather than ramps: a captain says "magnification factor
        // three", not "a bit more". Wraps back to 1 so one button does both.
        const next = v.magnification >= 8 ? 1 : Math.min(12, v.magnification * 2);
        v.setMagnification(next);
        app.render();
      }), { say: 'magnify', color: 'ice',
        sub: app.tactical?.magnification > 1.05 ? `Now ${app.tactical.magnification.toFixed(0)}×` : 'Optical zoom',
      }),
    ]),
    el('p', { class: 'hint', text: 'Drag to pan the screen; pinch to magnify. In a fight the viewer is slaved to the bow and drifts back on its own.' }),
    eng && !eng.over
      ? button('Tactical plot', tap(() => app.go('tactical')), { color: 'amber', sub: 'The outside view, with the full weapons console' })
      : button('Close the viewer', tap(() => app.go('bridge')), { color: 'ghost' }),
  ]));

  side.append(panel('Ship’s Log', [
    ...g.log.slice(-4).reverse().map(logLine),
    button('Full log', tap(() => app.go('log')), { color: 'ghost', say: 'show me the log' }),
  ]));
  return root;
}

// ================================================================ TACTICAL

export function tacticalScreen(app) {
  const g = app.game;
  const eng = g.engagement;
  const root = el('div', { class: 'screen tactical-screen' });

  // The viewport is built once and *moved* into each new screen node rather
  // than rebuilt. It has to be: a WebGL context is expensive to create,
  // browsers cap how many can exist at once, and making a fresh one on every UI
  // render silently drops the oldest until the display goes black. Appending an
  // existing node relocates it and keeps the context alive.
  let wrap = app.tacticalHost;
  if (!wrap) {
    wrap = el('div', { class: 'tactical-wrap' }, [
      el('canvas', { id: 'tactical' }),
      el('div', { class: 'tactical-overlay' }),
    ]);
    app.tacticalHost = wrap;
  }
  app.tacticalCanvas = wrap.querySelector('#tactical');
  app.tacticalOverlay = wrap.querySelector('.tactical-overlay');
  root.append(wrap);

  const side = el('div', { class: 'tactical-side scroll' });
  root.append(side);

  if (!eng) {
    side.append(panel('Standing Down', [el('p', { text: 'No hostile contacts.' })]));
    return root;
  }

  // --- Intruders ---
  //
  // Above the target, because people in the corridors outrank the thing on the
  // viewer. This is the panel a captain is actually looking at during a fight
  // — the Ship Status readout lives on the BRIDGE screen, which is not where
  // anybody is when they are being boarded — and a boarding party reported
  // somewhere the player cannot see it is not reported.
  if (g.ship.boarders > 0) {
    const n = Math.ceil(g.ship.boarders);
    side.append(panel('Intruder Alert', [
      el('p', { text: `${n} aboard, and fighting their way forward.` }),
      button('Repel boarders', tap(() => {
        app.executeOrder({ action: 'repel_boarders' }, 'repel boarders');
        app.render();
      }), {
        say: 'repel boarders',
        color: 'red',
        sub: 'Turn out the guard. They will be off the ship sooner and it will cost fewer of ours.',
      }),
    ], 'danger'));
  }

  // --- Target ---
  const target = eng.target;
  side.append(panel('Target', [
    target && !target.destroyed
      ? el('div', {}, [
        el('p', {}, [el('b', { text: target.name }), ' — ', target.cls.name]),
        readout('Hull', target.hullPct),
        readout('Shields', target.shieldPct),
        el('div', {}, [
          pill(FACTIONS[target.faction]?.short ?? target.faction),
          pill(`${Math.round(g.ship.distanceTo(target))} km`),
          target.cloaked ? pill('cloaked', 'red') : null,
          target.fleeing ? pill('withdrawing', 'amber') : null,
          // "Natural Tactician — you always know the enemy's weakest shield
          // facing without scanning." `weakestFacing` has existed since the
          // science scan power was written and is reported by it; the trait
          // says you get the same answer without spending the scan, and it was
          // read by nothing at all.
          //
          // Shown as a pill beside the rest of what the board already knows
          // about this contact, rather than as a line of its own: it is one
          // word, and it belongs with the other one-word facts.
          g.character?.mechanic('autoWeakFacing')
            ? pill(`weakest: ${weakestFacing(target)}`, 'amber')
            : null,
        ]),
      ])
      : el('p', { class: 'muted', text: 'No target locked.' }),
    eng.liveHostiles.length > 1
      ? button('Next target', tap(() => { eng.cycleTarget(); app.render(); }), { say: 'next target', color: 'ice' })
      : null,
  ], 'danger'));

  // --- What this fight is for ---
  //
  // Shown only when it is not the default, because "destroy them" on every
  // ordinary engagement is a line of furniture. `Engagement.objective` was
  // declared and documented and read by nothing, so an episode that wanted a
  // ship crippled rather than killed had to ask in prose and hope.
  if (eng.objective && eng.objective !== 'destroy') {
    side.append(panel('Orders', [
      el('p', { text: OBJECTIVES[eng.objective]?.line ?? '' }),
      eng.objective === 'protect' && eng.allies?.length
        ? el('p', {
          class: 'hint',
          text: `${eng.allies.filter((a) => !a.destroyed).length} of ${eng.allies.length} still with us.`,
        })
        : null,
    ], 'accent'));
  }

  // --- How the fight stands ---
  //
  // `Engagement.assess()` has existed with its own JSDoc explaining that it is
  // the LIVE reading, as against `this.assessment` which is the opening one —
  // and nothing has ever called it. Only the opening line was pushed to the
  // log, once, before a shot was fired, so a fight that stopped being
  // outmatched three ships ago still read as outmatched, and the number that
  // knew better was computed on request by nobody.
  //
  // Drawn as the balance of force it is, which is what `ratio` means: above
  // half the bar is the player ahead.
  {
    const now = eng.assess();
    const share = now.ours / Math.max(1, now.ours + now.theirs);
    side.append(panel('The Fight', [
      readout(now.label ?? 'even', share, `${(now.ratio ?? 1).toFixed(2)}:1`),
      el('p', { class: 'hint', text: now.line ?? '' }),
    ]));
  }

  // --- Subsystem targeting ---
  // All seven, from SUBSYSTEM_KEYS rather than a hand-written four.
  //
  // The list had four of the seven the simulation models, so sensors, life
  // support and auxiliary could be called by voice but not tapped, and
  // `auxiliary` could not be reached at all by either — the one subsystem in
  // the game with no route to it. Iterating the key list is what stops that
  // happening again: a subsystem added to the simulation appears here, and a
  // label missing from the table below is a visible gap rather than a silent
  // omission.
  const subs = SUBSYSTEM_KEYS.map((key) => [key, SUBSYSTEM_TARGET_LABEL[key] ?? key]);
  side.append(panel('Target Subsystem', [
    el('div', { class: 'grid-2' }, [
      ...subs.map(([key, label]) => button(label, tap(() => {
        eng.targetSubsystem(eng.targetedSubsystem === key ? null : key);
        app.render();
      }), {
        color: eng.targetedSubsystem === key ? 'red' : 'blue',
        say: `target their ${label.toLowerCase()}`,
      })),
    ]),
    el('p', { class: 'hint', text: 'Targeting a subsystem trades raw damage for a specific kill: engines to stop a runner, weapons to survive a Galor, auxiliary to keep a fire burning.' }),
  ]));

  // --- Weapons ---
  side.append(panel('Weapons', [
    // Per mount: whether it is shot out, and whether it BEARS on the target.
    //
    // "Bears" is the readout that makes "come about" a specific instruction
    // instead of a mood. Firing arcs have decided every shot in this game since
    // the third axis went in — `inArc` is the same function the gunnery calls —
    // and until now nothing on any screen said which way a mount pointed or
    // whether the ship it was aimed at was inside it.
    ...g.ship.weapons.map((w) => {
      const dead = w.enabled === false;
      const bears = eng?.target ? inArc(g.ship.directionTo(eng.target), w) : null;
      const value = dead ? 'out'
        : w.cooldown > 0 ? `${w.cooldown.toFixed(1)}s`
        : bears === false ? 'no solution'
        : 'ready';
      return readout(
        w.name.replace(/^(Forward|Aft)\s+/, ''),
        dead ? 0 : (w.cooldown > 0 ? 1 - w.cooldown / w.cycle : 1),
        value,
      );
    }),
    el('div', { class: 'btn-row' }, [
      button('Fire', tap(() => {
        const n = eng.fireAll();
        if (n) { audio.play('phaser', { throttle: 120 }); haptic('hit_light'); }
        else { audio.play('ui_deny'); }
      }, 'ui_tap'), { say: 'fire phasers', color: 'red' }),
      // The one button on this panel with no phrase on it, which is the rule
      // this game is built on. Both directions are sayable already —
      // "hold fire" is the `cease_fire` order and "weapons free" is `fire`,
      // which now leaves auto-fire on rather than firing once into silence.
      button(eng.autoFire ? 'Auto: on' : 'Auto: off', tap(() => {
        eng.autoFire = !eng.autoFire;
        app.render();
      }), {
        color: eng.autoFire ? 'green' : 'ghost',
        say: eng.autoFire ? 'hold fire' : 'weapons free',
      }),
    ]),
    g.ship.maxTorpedoes > 0
      ? readout('Torpedoes', g.ship.torpedoes / g.ship.maxTorpedoes, `${g.ship.torpedoes}`)
      : null,
  ]));

  // --- Helm ---
  side.append(panel('Helm', [
    // The way out to the forward view. It lives under Helm because pointing
    // the ship is what pointing the screen amounts to in a fight.
    button('On screen', tap(() => app.go('viewscreen')), { say: 'on screen', color: 'ice', sub: 'The forward view from the bridge',
    }),
    el('div', { class: 'grid-2' }, [
      button('Come about', tap(() => eng.comeAboutTo(eng.target)), { say: 'come about', color: 'blue' }),
      button(g.ship.evasive ? 'Evasive: on' : 'Evasive', tap(() => {
        eng.evasive(!g.ship.evasive); app.render();
      }), { say: 'evasive', color: g.ship.evasive ? 'green' : 'blue' }),
    ]),
    powerSlider('Throttle', g.ship.throttle * 100, (v) => { g.ship.throttle = v / 100; }),
    // Elevation. The third axis is what the 3D simulation is for, and the
    // enemy AI has always used it — chooseElevation() deliberately attacks the
    // face you are not presenting. Until this row existed the player's only
    // elevation control was "Come about", which merely points at the target.
    el('div', { class: 'grid-3' }, [
      // Twenty degrees a press, and "climb" is now twenty degrees a word. The
      // button and the phrase printed on it have to be the same order.
      button('Climb', tap(() => {
        eng.setPitch((g.ship.desiredPitch ?? 0) + 20); app.render();
      }), { say: 'climb', color: 'blue' }),
      button('Level', tap(() => { eng.setPitch(0); app.render(); }), { say: 'level off', color: 'blue' }),
      button('Dive', tap(() => {
        eng.setPitch((g.ship.desiredPitch ?? 0) - 20); app.render();
      }), { say: 'dive', color: 'blue' }),
    ]),
    readout('Elevation', (g.ship.pitch + 70) / 140,
      `${g.ship.pitch >= 0 ? '+' : ''}${Math.round(g.ship.pitch)}\u00B0`),
    button('Disengage — go to warp', tap(() => {
      if (!eng.beginWarpOut()) audio.play('ui_deny');
      app.render();
    }), { say: 'get us out of here', color: 'peach', sub: 'Eight seconds at this heading. They get all eight.' }),
  ]));

  // --- Power ---
  side.append(powerPanel(app));

  // --- Career signature power ---
  side.append(signaturePanel(app));

  // --- Bridge officer abilities ---
  side.append(abilitiesPanel(app));

  // --- Damage control ---
  const dc = [];
  if (g.ship.breaching) {
    dc.push(button(`EJECT THE CORE — ${g.ship.breachTimer.toFixed(0)}s`, tap(() => {
      if (g.ship.ejectCore()) {
        audio.play('explosion');
        haptic('explosion');
        g.pushLog('Core ejected. We are on impulse power.', 'engineering');
      }
      app.render();
    }, 'ui_deny', 'explosion'), { say: 'eject the core', color: 'red' }));
  }
  for (const id of g.loadout.equipped.device) {
    dc.push(button(CONSOLES[id]?.name ?? id, tap(() => {
      app.useDevice(id);
      app.render();
    }), { say: CONSOLES[id]?.say, color: 'amber', sub: CONSOLES[id]?.description }));
  }
  if (dc.length) side.append(panel('Damage Control', dc, 'danger'));

  // --- Comms ---
  //
  // Two directions: the ship shooting at you, and Starfleet. The distress call
  // is here rather than on the chair because it is a comms order, and the sub
  // line says what it will cost you — which is time, and the fight does not
  // stop while you wait.
  const factionId = eng.hostiles[0]?.faction;
  const inbound = g.helpInbound;
  const comms = [];
  // "Xenolinguist — unhailable factions may answer once." Three factions carry
  // `hailable: false` and this button has never been drawn for them at all, so
  // the trait's second clause could not happen even in principle.
  const reach = g.mayReachUnhailable?.(factionId);
  if (FACTIONS[factionId]?.hailable || reach) {
    comms.push(button('Hail them', tap(() => app.openHail(factionId)), {
      say: 'open a channel',
      color: 'lilac',
      sub: reach ? 'Your linguist thinks they can be reached. Once.' : '',
    }));
  }
  if (inbound) {
    comms.push(el('p', { class: 'hint', text: `${inbound.name} inbound — ${Math.max(0, Math.round(inbound.eta))} seconds out.` }));
  } else if (!g.helpCalled) {
    comms.push(button('Send a distress call', tap(() => {
      const r = g.callForHelp();
      if (!r.ok) audio.play('ui_deny');
      app.render();
    }), {
      say: 'send a distress call',
      color: 'ice',
      sub: 'Whoever is nearest, if anyone is. They will not arrive quickly.',
    }));
  } else {
    comms.push(el('p', { class: 'hint', text: 'The call has been made.' }));
  }
  if (comms.length) side.append(panel('Communications', comms));

  // --- Boarding ---
  //
  // Only offered when it is actually possible: shields down, the ship beaten
  // or crippled, and close enough to beam across. That is what makes crippling
  // a hostile a real alternative to killing it.
  const boardable = g.availableAwayMissions().find((t) => t.id === 'boarding_action');
  if (boardable) {
    side.append(panel('Boarding Party', [
      button(boardable.title, tap(() => app.runAwayMission('boarding_action')), {
        say: 'board them',
        color: 'amber',
        sub: `${boardable.target.name} — shields down. Security can cross.`,
      }),
      el('p', { class: 'hint', text: 'A bridge taken is a ship out of the fight and not a kill. It is also the most dangerous thing you can ask of a landing party.' }),
    ], 'warn'));
  }

  // The chair is where you are sitting, so it is on this screen too — with a
  // different set of controls, because blue alert is not a combat condition
  // and the ion pod only earns its keep when someone is shooting at you.
  side.append(chairPanel(app));

  side.append(panel('Tactical Log', eng.log.slice(-8).reverse().map(logLine)));
  return root;
}


/** The captain's own once-per-engagement power. */
function signaturePanel(app) {
  const g = app.game;
  const c = g.character;
  if (!c) return el('div');
  const career = c.career;
  const used = c.signatureUsed;
  return panel('Captain', [
    button(career.signature, used ? null : tap(() => app.useSignature(), 'ui_confirm'), {
      say: used ? '' : 'use my signature',
      color: used ? 'ghost' : 'peach',
      sub: used ? 'Already used this engagement.' : career.signatureText,
      disabled: used,
    }),
  ], used ? '' : 'warn');
}

export function powerPanel(app) {
  const g = app.game;
  // This panel is also a CONSOLE, and a console is only rebuilt when something
  // marks it dirty — otherwise it would be a fresh set of DOM nodes several
  // times a second and every control would detach from under the finger. Only
  // `executeOrder` ever set that flag, so a TYPED "attack posture" redrew the
  // panel and PRESSING the Attack button on it did not: the grid changed
  // underneath, the green highlight stayed where it was, and all four sliders
  // went on showing the distribution the captain had just replaced. Caught by
  // looking at the screenshot, which is the only way it could have been.
  const redraw = () => { app.consoleDirty = true; app.render(); };
  const preset = (p) => button(p.label, tap(() => {
    g.ship.power.applyPreset(p.id);
    audio.play('power_reroute');
    redraw();
  }), {
    color: g.ship.power.preset === p.id ? 'green' : 'blue',
    say: `${p.id} posture`,
  });
  return panel('Power Distribution', [
    // Every preset carries the phrase that sets it. `PRESETS[id].order` is
    // already the words an officer would use — "power to weapons" — so the
    // button and the order line say the same thing by construction rather than
    // by two lists being kept in step by hand.
    el('div', { class: 'grid-3' }, PRESET_LIST.slice(0, 3).map(preset)),
    el('div', { class: 'grid-2' }, PRESET_LIST.slice(3).map(preset)),
    // Each slider says what it buys. Four bare labels told a captain nothing
    // about what he was trading away, and Auxiliary was the worst of them —
    // the order line calls that channel "sensors" and the preset above calls
    // it Science, so the only thing the screen let you infer was wrong.
    ...SUBSYSTEMS.flatMap((s) => [
      powerSlider(SUBSYSTEM_LABEL[s], g.ship.power.target[s], (v) => {
        g.ship.power.set(s, v);
        audio.play('ui_tap', { throttle: 80 });
      }, redraw),
      el('p', { class: 'hint', text: SUBSYSTEM_EFFECT[s] }),
    ]),
    el('p', { class: 'hint', text: `Total ${Math.round(g.ship.power.total)} of ${g.ship.power.cap}. Levels settle over a few seconds — the EPS grid is not instant.` }),
    // The engineering console is where a diagnostic is actually run from.
    button('Run a diagnostic', tap(() => {
      const r = g.diagnostic(1);
      audio.play(r.clean ? 'computer_ack' : 'ui_deny');
      redraw();
    }), {
      color: 'ghost',
      sub: 'Level one — every system, by hand',
      say: 'run a level one diagnostic',
    }),
  ]);
}

/** The order the bridge is read in, forward to aft. */
const DEPT_ORDER = ['command', 'tactical', 'operations', 'engineering', 'science', 'medical'];
const DEPT_LABEL = {
  command: 'Command', tactical: 'Tactical', operations: 'Helm and Communications',
  engineering: 'Engineering', science: 'Science', medical: 'Medical',
};

function abilitiesPanel(app) {
  const g = app.game;

  // Grouped by department, and one button per ABILITY rather than one per
  // officer holding it. Two officers share a department — the helm and comms
  // are both operations — so the same power appeared twice with no way to tell
  // the buttons apart. It is still worth having twice, because it is two
  // independent cooldowns, so the second holder is named on the button.
  //
  // And the list is not truncated. It used to be `ready.slice(0, 8)`, which was
  // harmless when four of the seven officers held an identical tray and a
  // third of the list was duplicates. With six departments there are twenty-odd
  // powers ready at once and eight of them were shown, silently, in roster
  // order.
  const byAbility = new Map();
  for (const { officer, ability } of g.crew.readyAbilities()) {
    if (!byAbility.has(ability.id)) byAbility.set(ability.id, { ability, officers: [] });
    byAbility.get(ability.id).officers.push(officer);
  }

  const nodes = [];
  for (const dept of DEPT_ORDER) {
    const inDept = [...byAbility.values()]
      .filter(({ ability }) => ability.dept === dept)
      .sort((a, b) => a.ability.rank - b.ability.rank);
    if (!inDept.length) continue;
    nodes.push(el('h3', { text: DEPT_LABEL[dept] ?? dept }));
    for (const { ability, officers } of inDept) {
      const who = officers[0];
      const also = officers.length > 1 ? ` (+${officers.length - 1} ready)` : '';
      // Every button prints the phrase that fires it — but for most of these
      // the phrase IS the title, and printing it twice on a phone is two lines
      // saying one thing. The phrase only goes underneath when it differs.
      const said = ability.order.toLowerCase() === ability.name.toLowerCase()
        ? `${who.name}${also}`
        : `${who.name}${also} — ${ability.order}`;
      nodes.push(button(ability.name, tap(() => {
        app.useAbility(who, ability);
        app.render();
      }, 'computer_ack'), { color: 'lilac', sub: said }));
    }
  }

  const cooling = [];
  for (const o of g.crew.available) {
    for (const id of o.abilities) {
      const cd = o.cooldowns[id] ?? 0;
      if (cd > 0) cooling.push(`${ABILITIES[id]?.name ?? id} ${cd.toFixed(0)}s`);
    }
  }
  return panel('Bridge Officers', [
    ...nodes,
    cooling.length ? el('p', { class: 'hint', text: `Recharging: ${cooling.join(' · ')}` }) : null,
    !nodes.length && !cooling.length ? el('p', { class: 'muted', text: 'No officers available.' }) : null,
  ]);
}

// ================================================================ GALAXY

export function galaxyScreen(app) {
  const g = app.game;
  const root = el('div', { class: 'screen' });

  const wrap = el('div', { class: 'map-wrap' });
  const canvas = el('canvas', { id: 'galaxy' });
  wrap.append(canvas);
  root.append(wrap);
  app.galaxyCanvas = canvas;

  // The chart has a third axis. An axis you cannot look along is decoration,
  // so here are the two controls that move it — and the phrases that do the
  // same thing, as everywhere else.
  root.append(el('div', { class: 'chip-row' }, [
    button('Tilt', tap(() => {
      app.map?.setTilt((app.map.tilt ?? 0) > 0.02 ? 0 : 0.75);
      app.needsRender = true;
    }), {
      color: 'blue',
      say: (app.map?.tilt ?? 0) > 0.02 ? 'level the chart' : 'tilt the chart',
      sub: (app.map?.tilt ?? 0) > 0.02 ? 'Back to plan view' : 'Look along the third axis',
    }),
    button('Rotate', tap(() => {
      app.map?.setSpin((app.map.spin ?? 0) + 0.6);
      app.needsRender = true;
    }), { color: 'blue', say: 'rotate the chart', sub: 'Turn it about the vertical' }),
  ]));

  const detail = el('div', { class: 'scroll', style: { flex: '0 0 auto', maxHeight: '52%' } });
  root.append(detail);
  app.galaxyDetail = detail;
  app.renderSystemDetail(g.galaxy.get(app.selectedSystemId ?? g.locationId));

  return root;
}

export function systemDetail(app, sys) {
  const g = app.game;
  if (!sys) return el('div');

  const here = sys.id === g.locationId;
  const ly = distanceLy(g.locationId, sys.id);
  const route = g.galaxy.plotCourse(g.locationId, sys.id);
  const visited = g.galaxy.visited.has(sys.id);

  const nodes = [
    el('p', {}, [
      el('b', { text: sys.name }),
      here ? ' — present position' : '',
    ]),
    el('div', { class: 'meta' }, [
      pill(sys.type),
      sys.faction && sys.faction !== 'none' ? pill(FACTIONS[sys.faction]?.short ?? sys.faction) : null,
      sys.contested ? pill('contested', 'red') : null,
      sys.hazard ? pill(sys.hazard.replace(/_/g, ' '), 'red') : null,
      !visited ? pill('unvisited', 'amber') : null,
      ...(sys.facilities ?? []).map((f) => pill(f, 'green')),
    ]),
    el('p', { class: 'muted', text: visited || !sys.unexplored ? sys.description : 'No survey on file.' }),
  ];

  if (!here) {
    nodes.push(el('p', { class: 'hint', text: `${ly.toFixed(1)} ly direct · ${route.lightYears.toFixed(1)} ly by ${route.charted ? 'charted lanes' : 'uncharted course'} · ${route.path.length - 1} leg${route.path.length > 2 ? 's' : ''}` }));

    // "Intelligence Sharing — you know what is waiting before you arrive."
    // The last of the twenty-five perks to do nothing, and the only one that
    // could not simply be wired to something already there: the encounter had
    // to become knowable before the arrival that used to decide it.
    const waiting = g.peekEncounter(sys.id);
    if (waiting) {
      nodes.push(el('p', {
        class: waiting.hostile ? 'warn' : 'muted',
        text: waiting.kind === 'quiet'
          ? 'Tal Shiar intelligence: nothing waiting there.'
          : `Tal Shiar intelligence: ${waiting.title ?? waiting.kind.replace(/_/g, ' ')}`
            + `${waiting.hostile ? ' — hostile.' : '.'}`,
      }));
    }

    // Warp factor picker with real time and fuel costs.
    const maxWarp = Math.floor(g.ship.cls.maxWarp);
    const factors = [4, 6, 8, maxWarp].filter((f, i, a) => f <= maxWarp && a.indexOf(f) === i);
    const eff = (g.ship.cls.warpEfficiency ?? 1) * g.progress.warpEfficiency;
    nodes.push(el('div', { class: `grid-${Math.min(4, factors.length)}` }, factors.map((f) => {
      const hours = travelHours(route.lightYears, f, eff);
      const fuel = fuelCost(route.lightYears, f, eff);
      const tooExpensive = fuel > g.ship.antimatter;
      return button(`Warp ${f}`, tap(() => {
        const r = g.setCourse(sys.id, f);
        if (r.ok) {
          audio.play('warp_engage');
          haptic('warp');
          audio.setAlertLevel('warp');
          app.go('bridge');
        } else {
          audio.play('ui_deny');
          app.showMessage('Helm', [r.error]);
        }
      }, 'ui_confirm'), {
        color: tooExpensive ? 'ghost' : 'orange',
        sub: `${formatDuration(hours)} · ${fuel.toFixed(1)}% AM`,
        disabled: tooExpensive,
      });
    })));
  }

  const missions = g.missions.availableAt(sys.id, g);
  if (missions.length) {
    nodes.push(el('p', { class: 'hint' }, [
      pill(`${missions.length} mission${missions.length > 1 ? 's' : ''} available`, 'amber'),
    ]));
  }

  const card = panel(null, nodes, 'accent');
  card.classList.add('sys-card');
  return card;
}

// ================================================================ CREW

/**
 * The rest of the crew, and where they are.
 *
 * The bridge has ten people with names. This is the other handful worth
 * knowing — and it is where they visibly stop being a list: somebody out on a
 * detail is not at the back of the bridge helping their station, and the panel
 * says so rather than leaving it to be inferred from a number that changed.
 */
const DIVISION_LABEL = {
  command: 'Command', operations: 'Operations', sciences: 'Sciences',
};

export function dutyPanel(app) {
  const g = app.game;
  const roster = g.dutyRoster ?? [];
  if (!roster.length) return null;

  const out = new Map();
  for (const job of g.assignments ?? []) {
    for (const id of job.team ?? []) out.set(id, job);
  }

  const nodes = [];
  for (const division of DIVISIONS) {
    const here = roster.filter((p) => p.division === division);
    if (!here.length) continue;
    nodes.push(el('h3', { text: DIVISION_LABEL[division] ?? division }));
    for (const person of here) {
      const job = out.get(person.id);
      const doing = job
        ? `${ASSIGNMENTS[job.assignmentId]?.name ?? 'a detail'} — ${Math.max(0, Math.round(job.hoursRemaining))}h`
        : person.state === 'recovering' ? 'in sickbay'
          : person.state === 'lost' ? 'lost' : 'aboard';
      // One line each, the way In Memoriam does it. `.row` is styled only
      // inside the tactical overlay, so using it here put the name and the
      // rating hard against each other with no space between them —
      // "Solene ThorneNavigator". Visible in a screenshot and in nothing else.
      // `person.species` is READ here, and this is the only place it is.
      // Every duty officer has had one generated, saved and reloaded since the
      // roster was written, and the panel printed a name, a rating and a
      // state — so the ship's complement was as uniformly human on the page as
      // it was varied in the save file.
      nodes.push(el('p', {
        class: person.state === 'lost' ? 'danger' : 'muted',
        text: `${person.name} — ${person.species ? `${person.species} ` : ''}`
          + `${person.label} · ${doing}`,
      }));
    }
  }

  // What can be sent out, and the words that send it. Every button prints the
  // phrase that does the same thing, which is the rule for all of them.
  const slots = dutySlots(g);
  const running = (g.assignments ?? []).length;
  nodes.push(el('h3', { text: `Details — ${running} of ${slots} out` }));
  for (const a of availableAssignments(g)) {
    const already = (g.assignments ?? []).some((j) => j.assignmentId === a.id);
    const hours = a.hours < 24 ? `${a.hours}h` : `${(a.hours / 24).toFixed(1)}d`;
    const wants = SPECIALITIES[a.wants]?.label ?? a.wants;
    nodes.push(button(a.name, tap(() => {
      app.sendDetail(a.id);
      app.render();
    }, 'computer_ack'), {
      color: already ? 'grey' : 'blue',
      // The order phrase goes in `say`, which is the element built for it and
      // what every other button in the game uses. It was being quoted by hand
      // into `sub` instead, which left nowhere for the line that says what the
      // job IS — so all ten `text` fields ("Plating, in vacuum, by hand.",
      // "Take the intermix down and rebuild it while nobody is shooting.")
      // were written and displayed nowhere.
      say: already ? '' : `send a ${a.name.toLowerCase()}`,
      sub: already ? 'already under way' : `${a.text} ${hours}, wants a ${wants}`,
    }));
  }

  return panel('Ship\u2019s Company', nodes);
}

export function crewScreen(app) {
  const g = app.game;
  const root = el('div', { class: 'scroll' });

  root.append(panel('Senior Staff', [
    ...STATIONS.map((s) => {
      const o = g.crew.officers.find((x) => x.station === s.id);
      if (!o) return null;
      return el('div', {}, [
        el('div', { class: 'speaker', text: s.label }),
        officerRow(o, () => app.showOfficer(o)),
      ]);
    }),
  ]));

  const duty = dutyPanel(app);
  if (duty) root.append(duty);

  const lost = g.ledger.lostOfficers;
  if (lost.length) {
    root.append(panel('In Memoriam', lost.map((o) =>
      el('p', { class: 'muted', text: `${o.name} — ${o.station?.replace(/_/g, ' ') ?? 'crew'}${o.system ? `, at ${o.system}` : ''}` })), 'danger'));
  }

  root.append(panel('Complement', [
    readout('Crew', g.ship.crewPct, `${g.ship.crew} / ${g.ship.maxCrew}`),
    g.ship.injured > 0 ? el('p', { class: 'muted', text: `${g.ship.injured} in sickbay.` }) : null,
    el('p', { class: 'hint', text: `${g.ledger.count('lives_lost')} lost under your command to date.` }),
  ]));

  return root;
}

export function officerDetail(app, officer) {
  const nodes = [
    el('p', {}, [el('b', { text: `${officer.rank} ${officer.name}` })]),
    el('p', { class: 'muted', text: `${officer.species} · ${STATIONS.find((s) => s.id === officer.station)?.label ?? officer.station}` }),
    readout('Expertise', officer.expertise / 100, `${officer.expertise}`),
    readout('Discipline', officer.discipline / 100, `${officer.discipline}`),
    readout('Daring', officer.daring / 100, `${officer.daring}`),
    readout('Candour', officer.candor / 100, `${officer.candor}`),
    el('h3', { text: 'Abilities' }),
    ...officer.abilities.map((id) => {
      const a = ABILITIES[id];
      return a ? el('p', { class: 'hint', html: `<b>${a.name}</b> — “${a.order}”. ${a.cooldown}s cooldown.` }) : null;
    }),
  ];

  if (!officer.alive) {
    nodes.push(el('p', { class: 'muted', text: `Deceased — ${officer.cause ?? 'killed in the line of duty'}.` }));
  } else if (officer.injured) {
    nodes.push(el('p', { class: 'muted', text: 'Currently in sickbay and unavailable for duty.' }));
  }

  // Officers you can teach something new. What training COSTS and what it
  // changes is `Game.trainOfficer`; this is the list and the button.
  const g = app.game;
  const learnable = g.trainableFor(officer);
  if (learnable.length && officer.alive) {
    nodes.push(el('h3', { text: 'Training' }));
    for (const a of learnable) {
      nodes.push(button(`Train: ${a.name}`, tap(() => {
        g.trainOfficer(officer, a.id);
        app.closeModal();
        app.render();
        // The `sub` used to print the ability's ORDER phrase — the words that
        // USE it once learned — which read as the phrase for this button and
        // is not: saying it tries to fire an ability the officer does not have
        // yet. The say line trains; the sub says what they will be able to
        // order afterwards, which is worth knowing and is now labelled.
      }, 'ui_confirm'), {
        color: 'blue',
        say: `train ${a.name.toLowerCase()}`,
        sub: `One day. Then: “${a.order}”`,
      }));
    }
  }
  return nodes;
}

// ================================================================ CAPTAIN

export function captainScreen(app) {
  const g = app.game;
  const root = el('div', { class: 'scroll' });
  root.append(kobayashiPanel(app));
  const p = g.progress;

  root.append(panel('Service Record', [
    el('p', {}, [el('b', { text: `${p.rankName} ${g.captain.name}` })]),
    el('p', { class: 'muted', text: `${g.captain.species} · ${g.captain.serialNumber}` }),
    // The bar and the number beside it have to be the same quantity.
    //
    // This passed `p.rankProgress`, which is (xp - thisRankFloor) / (nextFloor
    // - thisRankFloor), next to the text `xp / nextRank.xp`, which is measured
    // from zero. They are different fractions of different things, printed in
    // the same row, and they disagreed at every rank: a Commodore on 51,000
    // read "51000 / 66000" — plainly most of the way — beside a bar 32% full.
    //
    // Worse at the start. A new captain is commissioned at rank index 5 with
    // ZERO experience, and Captain's floor is 17,000 — so `rankProgress` is
    // negative, clamps to nought, and the bar sits EMPTY for the first
    // seventeen thousand points of a commission while the numbers next to it
    // climb. The same happens to any rank granted by `rankIndex + 1` without
    // the experience behind it, which is how the board-of-inquiry screenshot
    // came to show a Commodore on 39,413 against a floor of 44,000.
    //
    // So the bar is measured the way the numbers are. It is monotonic, never
    // negative, and a player can check it against the pair beside it — which
    // is the only property that matters for two readings of one thing sitting
    // in the same row. `rankProgress` has no other consumer in the repo; the
    // getter is left alone because as a concept it is fine, and the day a
    // captain starts at Ensign with no rank granted ahead of their record it
    // will be true as well as fine.
    readout('Rank progress', p.nextRank ? p.xp / p.nextRank.xp : 1,
      p.nextRank ? `${p.xp} / ${p.nextRank.xp}` : 'max'),
    el('p', { class: 'hint', text: p.nextRank ? `Next: ${p.nextRank.name}` : 'Highest rank attained.' }),
    el('div', {}, [
      pill(`Assessment: ${g.ledger.assessment().label}`,
        g.ledger.serviceScore() >= 20 ? 'green' : g.ledger.serviceScore() < -20 ? 'red' : ''),
      pill(`Score ${g.ledger.serviceScore()}`),
    ]),
    // What the board is about, where it sits, and what it would find on the
    // record as it stands. It used to say only that promotion was suspended
    // "until it concludes" — and nothing in the game concluded one, so the
    // sentence was a promise the game would not keep and the rank ladder was
    // frozen for the rest of the commission. RESEARCH.md §22.
    ...(g.ledger.inquiryOpen ? [
      el('p', {
        class: 'muted',
        text: `A board of inquiry into ${g.ledger.inquiryReason ?? 'your command record'} is open. `
          + 'Promotion is suspended until it sits, and it sits when you put in at '
          + `${venueFor(g)?.name ?? 'a Federation starbase'}.`,
      }),
      el('p', {
        class: 'hint',
        text: `On the record as it stands the finding would be: ${findingFor(g.ledger).label.toLowerCase()}.`
          + (findingFor(g.ledger).verdict === 'reduced'
            ? ' A better record between now and then is the only thing that changes it.'
            : ''),
      }),
    ] : []),
    // And the findings of boards already held, because an exoneration is worth
    // having on paper too.
    ...(g.ledger.findings ?? []).slice(-3).map((f) => el('p', {
      class: 'muted',
      text: `Board of inquiry into ${f.reason}: ${f.label}.`,
    })),
  ], g.ledger.inquiryOpen ? 'danger' : 'accent'));

  // --- Skills ---
  root.append(panel(`Skills — ${p.unspent} point${p.unspent === 1 ? '' : 's'} unspent`, [
    ...BRANCHES.flatMap((branch) => [
      el('h3', { text: BRANCH_LABEL[branch] }),
      ...Object.values(SKILLS).filter((s) => s.branch === branch).map((skill) => {
        const ranks = p.ranksIn(skill.id);
        return el('div', { class: 'skill' }, [
          el('div', { class: 'info' }, [
            el('b', { text: skill.name }),
            el('small', { text: skill.description }),
          ]),
          el('div', { class: 'pips' }, Array.from({ length: skill.max }, (_, i) =>
            el('i', { class: i < ranks ? 'on' : '' }))),
          el('button', {
            disabled: !p.canSpend(skill.id),
            onclick: p.canSpend(skill.id) ? tap(() => {
              g.spendSkill(skill.id);
              app.render();
            }, 'ui_confirm') : null,
            text: '+',
          }),
        ]);
      }),
    ]),
  ]));

  // --- Reputation ---
  // Standing, and WHY.
  //
  // This printed a bar and a tier and nothing else, while `Game.factionMemory`
  // has been computing a second, separate number all along: up to ±0.4 on
  // every hail with that faction, from specific things the captain did. Its
  // own note says the strongest single memory "is worth about as much as
  // shooting first costs". A captain sitting at Cordial with the Klingons
  // while carrying `fired_first_archanis` had a permanent penalty on every
  // Klingon channel and no way to find out short of opening one.
  //
  // Said here as well as at the hail, because they are different moments. The
  // hail says the loudest one at the instant it matters — "A captain who is
  // refused wants to know it was Archanis and not the weather" — and this is
  // where you look to find out what you are carrying before you decide whether
  // to open the channel at all.
  root.append(panel('Standing', Object.values(FACTIONS)
    .filter((f) => f.id !== 'federation')
    .flatMap((f) => {
      const v = g.ledger.standingOf(f.id);
      const tier = standingTier(v);
      const rows = [readout(f.short, (v + 100) / 200, tier.label)];
      // Most factions remember nothing for most of a commission, and a list of
      // empty headings would be worse than the bar alone.
      for (const r of g.factionMemory(f.id).reasons) {
        rows.push(el('p', {
          class: 'hint',
          text: `${r.weight >= 0 ? '+' : '−'} ${r.line}`,
        }));
      }
      return rows;
    })));

  // --- Ledger ---
  const recent = g.ledger.recent(10);
  root.append(panel('Command Record', recent.length
    ? recent.map((e) => el('p', { class: 'hint', text: `SD ${e.stardate ?? '—'} · ${e.text}` }))
    : [el('p', { class: 'muted', text: 'Nothing of note yet.' })]));

  return root;
}

// ================================================================ SHIP / LOADOUT

export function shipScreen(app) {
  const g = app.game;
  const root = el('div', { class: 'scroll' });

  root.append(machineShopPanel(app));

  root.append(panel(`${g.ship.name} — ${g.ship.registry}`, [
    el('p', { class: 'muted', text: g.ship.cls.description }),
    el('div', {}, [
      pill(g.ship.cls.name), pill(g.ship.cls.role),
      pill(`warp ${g.ship.cls.maxWarp}`), pill(`crew ${g.ship.maxCrew}`),
    ]),
    shieldDiagram(g.ship),
    readout('Structural integrity', g.ship.subsystems.warpcore, `${Math.round(g.ship.subsystems.warpcore * 100)}%`),
  ], 'accent'));

  root.append(panel('Subsystems', Object.entries(g.ship.subsystems).map(([k, v]) =>
    readout(k.replace(/([a-z])([A-Z])/g, '$1 $2'), v))));

  // --- What is installed together ---
  //
  // A set the player cannot see is a table with a story attached. This says
  // which sets are live, what they are worth, and — for a set that is only
  // partly fitted — exactly which piece is missing, because "you are one part
  // short of a refit" is the whole reason to care.
  const setLines = [];
  for (const set of SET_LIST) {
    const live = g.loadout.activeSets().find((a) => a.set.id === set.id);
    const fitted = set.pieces.filter((id) => g.loadout.all.includes(id));
    if (!fitted.length) continue;
    setLines.push(el('h3', { text: `${set.name} — ${fitted.length} of ${set.pieces.length}` }));
    setLines.push(el('p', {
      class: live ? 'muted' : 'hint',
      text: live ? live.bonus.text : 'Not enough of it fitted to do anything yet.',
    }));
    const missing = set.pieces.filter((id) => !fitted.includes(id));
    if (missing.length) {
      setLines.push(el('p', {
        class: 'hint',
        text: `Still wanted: ${missing.map((id) => CONSOLES[id]?.name ?? id).join(', ')}.`,
      }));
      // And whether this hull can actually take it.
      //
      // "Still wanted" on its own was a message describing something the game
      // would not let you do. The duotronic suite is three science consoles
      // and a Constitution has two science slots, so a captain in the ship the
      // campaign starts him in was told to fit a third one, tried, and was
      // silently refused by `equip`. The set is real and reachable — a refit,
      // an Oberth and an Excelsior all carry three — but not in the hull he
      // was standing in, and nothing said so.
      const need = {};
      for (const id of set.pieces) {
        const slot = CONSOLES[id]?.slot;
        if (slot) need[slot] = (need[slot] ?? 0) + 1;
      }
      const impossible = Object.entries(need)
        .filter(([slot, n]) => g.loadout.capacity(slot) < n)
        .map(([slot, n]) => `${n} ${slot} slots and she has ${g.loadout.capacity(slot)}`);
      const noRoom = [...new Set(missing.map((id) => CONSOLES[id]?.slot).filter(Boolean))]
        .filter((slot) => g.loadout.free(slot) <= 0);

      if (impossible.length) {
        setLines.push(el('p', {
          class: 'hint',
          text: `Not on this hull: the set wants ${impossible.join(', ')}. `
            + 'A bigger ship would carry it.',
        }));
      } else if (noRoom.length) {
        setLines.push(el('p', {
          class: 'hint',
          text: `No room for it as she is fitted — take something out of `
            + `${noRoom.join(' or ')} first.`,
        }));
      }
    }
  }
  if (setLines.length) root.append(panel('Installed together', setLines));

  // --- What the crew have learned about this hull ---
  //
  // The tiers are not a choice — a crew learning their ship is something that
  // happens to them. The trait at the end is the choice, and it is the reason
  // the track is here rather than being one more invisible multiplier.
  const m = g.mastery?.report();
  if (m) {
    const masteryLines = [
      el('h3', { text: `${m.className} — ${m.tier} of ${TIERS.length}` }),
      ...m.earned.map((step) => el('p', { class: 'muted', text: `${step.name}. ${step.text}` })),
    ];
    if (m.shakedown) {
      masteryLines.push(el('p', { class: 'muted', text: `${m.shakedown.name}. ${m.shakedown.text}` }));
      masteryLines.push(el('p', {
        class: 'hint',
        text: 'Fresh out of the yard, and under her own numbers until the crew have her measure.',
      }));
    }
    if (m.next) {
      masteryLines.push(el('p', {
        class: 'hint',
        text: `Next: ${m.next.name}, ${Math.ceil(m.next.remaining)} more to go. `
          + 'Light years under way, battles fought and episodes seen through.',
      }));
    }
    if (m.slotOpen) {
      masteryLines.push(el('h3', { text: 'Standing doctrine' }));
      masteryLines.push(el('p', {
        class: 'hint',
        text: m.trait
          ? `Say "set doctrine to <name>" to change it.`
          : `Say "set doctrine to <name>" to commit to one.`,
      }));
      for (const t of TRAIT_LIST) {
        masteryLines.push(button(
          `${t.id === m.trait?.id ? '✓ ' : ''}${t.name}`,
          tap(() => {
            g.mastery.chooseTrait(t.id);
            g.applyAllMods();
            app.render();
          }, 'ui_confirm'),
          { color: t.id === m.trait?.id ? 'blue' : 'ghost', sub: t.text },
        ));
      }
    }
    root.append(panel('Her own ship', masteryLines));
  }

  // --- A bigger command, and the right to say no ---
  //
  // Promotion is how you stop being a starship captain (RESEARCH.md §21). So
  // this is an offer with its cost written on it, not a reward that happens to
  // you: what you would be giving up is everything the crew have learned about
  // the hull you are standing in.
  const offer = g.commandOffer;
  if (offer) {
    const spending = g.mastery?.tier ?? 0;
    root.append(panel('Starfleet offers you a command', [
      el('h3', { text: offer.name }),
      el('p', {
        class: 'muted',
        text: `${Math.round(offer.hull)} hull against ${Math.round(g.ship.maxHull)}, `
          + `and ${offer.crew} aboard against ${g.ship.maxCrew}.`,
      }),
      // The bays, before he says yes. A bigger ship is not bigger in every
      // bay — a Nebula carries one fewer tactical console than an Excelsior —
      // and a console that has no bay on the new hull goes into stores. That
      // used to be discovered afterwards, on the ship screen, by a captain
      // wondering where his phaser relay had gone.
      ...(() => {
        const now = g.ship?.cls?.slots ?? {};
        const then = offer.slots ?? {};
        const moved = ['tactical', 'engineering', 'science', 'device']
          .map((s) => [s, (then[s] ?? 0) - (now[s] ?? 0)])
          .filter(([, d]) => d !== 0)
          .map(([s, d]) => `${d > 0 ? '+' : ''}${d} ${s}`);
        if (!moved.length) return [el('p', { class: 'muted', text: 'The same bays, console for console.' })];
        const losing = ['tactical', 'engineering', 'science', 'device']
          .filter((s) => (then[s] ?? 0) < g.loadout.used(s));
        return [el('p', {
          class: 'muted',
          text: `Bays: ${moved.join(', ')}.`
            + (losing.length
              ? ` She has fewer ${losing.join(' and ')} bays than you have consoles fitted; `
                + 'the difference goes into stores.'
              : ''),
        })];
      })(),
      el('p', {
        class: 'hint',
        text: spending > 0
          ? `${g.ship.name} would go to another captain, and the ${spending} `
            + `${spending === 1 ? 'tier' : 'tiers'} your crew have earned in her would stay with her. `
            + 'Nobody aboard would have worked the new hull up.'
          : `${g.ship.name} would go to another captain. Nobody aboard has worked `
            + 'either hull up yet, so there is nothing to lose but her name.',
      }),
      button('Take her', tap(() => { g.acceptCommand(); app.render(); }, 'ui_confirm'),
        { color: 'orange', say: 'take the new command' }),
      button(`Stay with ${g.ship.name}`,
        tap(() => { g.declineCommand(); app.render(); }, 'ui_back'),
        { color: 'ghost', say: 'stay with this ship' }),
    ]));
  } else if ((g.declinedCommands ?? []).length) {
    // Only once the captain has turned something down. Starfleet does not
    // raise it again after a refusal — which is right, it was being put to him
    // at every promotion — but a decision made once at Fleet Captain should not
    // be binding at Admiral, so there has to be a way back to the conversation.
    // Gated on his own refusal so this is not one more thing on the screen for
    // a captain who has never been offered anything.
    root.append(panel('', [
      button('Ask Starfleet for a new command',
        tap(() => { g.requestCommand(); app.render(); }, 'ui_select'),
        { color: 'ghost', say: 'ask starfleet for a new command' }),
    ]));
  }

  // --- Consoles ---
  for (const slot of ['tactical', 'engineering', 'science', 'device']) {
    const cap = g.loadout.capacity(slot);
    if (!cap) continue;
    const equipped = g.loadout.equipped[slot];
    root.append(panel(`${slot} — ${equipped.length}/${cap}`, [
      ...equipped.map((id) => button(CONSOLES[id]?.name ?? id, tap(() => {
        g.loadout.unequip(id);
        g.applyAllMods();
        app.render();
      }, 'ui_back'), { color: 'blue', sub: `${CONSOLES[id]?.description ?? ''} — tap to remove` })),
      ...g.loadout.inventory
        .filter((id) => CONSOLES[id]?.slot === slot)
        .filter((id, i, a) => a.indexOf(id) === i)
        .map((id) => {
          const count = g.loadout.inventory.filter((x) => x === id).length;
          return button(`Install ${CONSOLES[id]?.name ?? id}${count > 1 ? ` ×${count}` : ''}`, tap(() => {
            g.loadout.equip(id);
            g.applyAllMods();
            app.render();
          }, 'ui_confirm'), {
            color: 'ghost',
            sub: CONSOLES[id]?.description,
            disabled: g.loadout.free(slot) <= 0,
          });
        }),
    ]));
  }

  // --- Refit ---
  if (g.location?.facilities?.includes('shipyard')) {
    const options = commandableAt(g.progress.shipTier).filter((c) => c.id !== g.ship.classId);
    if (options.length) {
      root.append(panel('Shipyard', [
        el('p', { class: 'hint', text: 'A change of command means a change of ship. Your consoles come with you; anything that no longer fits goes into storage.' }),
        ...options.map((c) => button(c.name, tap(() => app.changeShip(c.id), 'ui_confirm'), {
          color: 'amber',
          sub: `${c.role} · hull ${c.hull} · warp ${c.maxWarp} · tier ${c.tier}`,
        })),
      ]));
    }
  }

  return root;
}

// ================================================================ LOG

/**
 * The whole log, not the last six lines.
 *
 * This screen was written, wired into the router, and unreachable: nothing ever
 * called `go('log')` and `log` was absent from the nav table. The bridge showed
 * a six-line tail and there was no way to see any further back, which for a
 * five-year commission is most of the record.
 */
export function logScreen(app) {
  const g = app.game;
  const root = el('div', { class: 'scroll' });

  // Filter by the station that spoke. A five-year log is hundreds of lines and
  // "what did engineering say about the core" is the question you actually
  // have.
  //
  // The field is `source`, not `station` — `pushLog(text, source)` names it
  // that way and `logLine` reads it that way. Filtering on the wrong name gave
  // no filter chips at all and an empty list for every one of them, which is
  // the quietest possible failure.
  const sources = [...new Set(g.log.map((l) => l.source).filter(Boolean))].sort();
  const active = app.logFilter ?? null;
  const entries = active ? g.log.filter((l) => l.source === active) : g.log;

  if (sources.length > 1) {
    root.append(panel('Filter', [
      el('div', { class: 'chip-row' }, [
        button('All', tap(() => { app.logFilter = null; app.render(); }), {
          color: active === null ? 'green' : 'ghost',
        }),
        // The channel names are log SOURCE ids, and were printed raw — so the
        // filter row carried a chip reading "FIRST_OFFICER", underscore and
        // all, next to ordinary words. Same defect as a station announcing
        // itself by its id: an internal name reaching the screen.
        ...sources.map((st) => button(channelName(st), tap(() => {
          app.logFilter = app.logFilter === st ? null : st;
          app.render();
        }), { color: active === st ? 'green' : 'ghost' })),
      ]),
    ]));
  }

  root.append(panel(
    active ? `Ship’s Log — ${channelName(active)}` : 'Ship’s Log',
    entries.length
      ? entries.slice().reverse().map(logLine)
      : [el('p', { class: 'muted', text: 'Nothing on this channel yet.' })],
  ));
  return root;
}

// ====================================================== COMMAND REFERENCE

/**
 * Every order the game understands, and the ways you can phrase it.
 *
 * `orderHelp()` has assembled exactly this since the parser was written and was
 * never imported anywhere — the game shipped with a natural-language layer that
 * accepts 857 phrasings and no way to find out. The phrasings are the point:
 * seeing that "come about", "bring us around" and "get our nose on them" are
 * one order is what teaches you that you can simply say what you mean instead
 * of hunting for the right button.
 */
export function referenceScreen(app) {
  const root = el('div', { class: 'scroll' });
  const ref = commandReference({ examples: 4 });

  root.append(panel('Giving Orders', [
    el('p', {}, [
      'Type what you would say. The parser carries ',
      el('b', { text: String(ref.phrasings) }),
      ` phrasings across ${ref.intents} orders, and it forgives typos, so you do not have to `,
      'match anything here word for word.',
    ]),
    el('p', { class: 'muted', text: 'You can address an officer — "Mister Sulu, come about" — and the order goes to that station. If something is ambiguous the bridge asks rather than guessing.' }),
  ], 'accent'));

  // Who is aboard, and what they answer to.
  //
  // Telling a captain they may address an officer and not telling them the
  // names is half a manual. The roster is per-game — canon crews, a generated
  // one, whoever has survived — so this is read from the crew that is actually
  // standing the watch rather than written down anywhere.
  const crew = app?.game?.crew;
  if (crew?.officers?.length) {
    root.append(panel('Who You Can Talk To', [
      el('p', { class: 'muted', text: 'Put the name at either end of the order. A name at the end needs its comma — "take us out, Mr. Sulu" — because a station is also a place you can walk to.' }),
      ...crew.officers
        .filter((o, i, all) => all.findIndex((x) => x.name === o.name) === i)
        .map((o) => el('div', { class: 'ref-entry' }, [
          el('div', { class: 'ref-help', text: `${o.rank} ${o.name}${o.alive ? '' : ' — lost'}` }),
          // `namesFor` sorts longest-first because the MATCHER needs that.
          // A reader wants the short one first — the surname is what a captain
          // reaches for, and it is what the list should open with.
          el('div', { class: 'ref-examples' },
            namesFor(o).slice().reverse().slice(0, 5)
              .map((n) => el('span', { class: 'ref-phrase', text: `“${n}”` }))),
        ])),
    ]));
  }

  for (const group of ref.groups) {
    root.append(panel(group.label, group.entries.map((e) => el('div', { class: 'ref-entry' }, [
      el('div', { class: 'ref-help', text: e.help }),
      el('div', { class: 'ref-examples' }, [
        ...e.examples.map((p) => el('span', { class: 'ref-phrase', text: `“${p}”` })),
        e.total > e.examples.length
          ? el('span', { class: 'ref-more', text: `+${e.total - e.examples.length} more` })
          : null,
      ].filter(Boolean)),
    ]))));
  }

  root.append(panel('Bridge Officer Abilities', [
    el('p', { class: 'muted', text: 'Each officer carries one. Say the order and they carry it out, if they are fit to.' }),
    ...ref.abilities.map((a) => el('div', { class: 'ref-entry' }, [
      el('div', { class: 'ref-help', text: a.name }),
      el('div', { class: 'ref-examples' }, [el('span', { class: 'ref-phrase', text: `“${a.order}”` })]),
    ])),
  ]));

  return root;
}

// ================================================================ OPTIONS

export function optionsScreen(app) {
  const s = app.settings;
  const root = el('div', { class: 'scroll' });

  // The ceiling is 200%, not 100%. At 100% the defaults were already the
  // maximum, so a player on a quiet phone in a noisy room had no way to ask
  // for more — the slider could only ever take sound away.
  const vol = (label, key) => {
    const val = el('div', { class: 'val', text: `${Math.round(s[key] * 100)}` });
    const input = el('input', {
      type: 'range', min: '0', max: '200', value: String(Math.round(s[key] * 100)),
      oninput: (e) => {
        s[key] = parseInt(e.target.value, 10) / 100;
        val.textContent = e.target.value;
        audio.setVolume(key === 'master' ? 'master' : key, s[key]);
        app.saveSettings();
      },
    });
    return el('div', { class: 'power-row' }, [el('div', { class: 'label', text: label }), input, val]);
  };

  // ---- The commission ----
  const COMPRESSIONS = [
    { value: 1, label: 'Real time', sub: 'Five years means five years' },
    { value: 24, label: '×24', sub: 'A day an hour — about eleven weeks' },
    { value: 168, label: '×168', sub: 'A week an hour — about eleven days' },
    { value: 1000, label: '×1000', sub: 'For testing. Not a commission.' },
  ];
  root.append(panel('The Manual', [
    el('p', { class: 'muted', text: 'Every order the game understands, and the ways you can phrase it. Also on the “?” key beside the order line, or say “what can I say”.' }),
    button('Command reference', tap(() => app.go('reference')), { color: 'ice' }),
  ], 'accent'));

  root.append(panel('Commission', [
    el('p', { class: 'muted', text: 'The five-year mission runs on the clock on your wrist. The ship repairs, the crew recovers and the stardate advances whether this app is open or not.' }),
    el('p', { class: 'muted', text: 'You can compress it. Nothing is locked behind real time and nothing is taken away — but a commission you finish in a fortnight is not the thing the game was built to be, and it will say so on the bridge.' }),
    ...COMPRESSIONS.map((c) => button(c.label, tap(() => {
      s.compression = c.value;
      if (app.game?.campaign) app.game.campaign.compression = c.value;
      app.saveSettings();
      app.render();
    }), {
      color: (s.compression ?? 1) === c.value ? 'green' : 'ghost',
      sub: c.sub,
    })),
    app.game?.campaign
      ? el('p', { class: 'muted', text: `Currently: ${app.game.campaign.format()}. ${app.game.campaign.remainingText()}` })
      : null,
  ].filter(Boolean)));

  // ---- Backups ----
  const backups = listBackups();
  root.append(panel('Command Record', [
    el('p', { class: 'muted', text: 'Every save is checksummed, and the last three autosaves are kept. If the current record cannot be read, the game falls back through them rather than showing you an empty bridge.' }),
    backups.length
      ? el('div', {}, backups.map((b) => el('p', { class: 'muted', text: `Backup ${b.index}: ${b.label ?? 'unnamed'} — ${new Date(b.savedAt).toLocaleString()}` })))
      : el('p', { class: 'muted', text: 'No backups yet. One is kept each time the game autosaves.' }),
    el('p', { class: 'muted', text: 'A five-year commission is worth exporting somewhere that is not this phone.' }),
    button('Export the record', tap(() => {
      if (app.game) downloadSave(app.game);
    }), { color: 'blue', sub: 'Downloads a file you can keep' }),
  ]));

  root.append(panel('Audio', [
    button(s.muted ? 'Sound: muted' : 'Sound: on', tap(() => {
      s.muted = !s.muted;
      audio.setEnabled(!s.muted);
      app.saveSettings();
      app.render();
    }), { color: s.muted ? 'red' : 'green', sub: 'Silences everything at once' }),
    el('p', { class: 'muted', text: 'The sliders run to 200%. Anything above 100% is asking for more than the mix was built for, which is exactly what a phone speaker in a noisy room needs.' }),
    vol('Master', 'master'), vol('Effects', 'sfx'), vol('Interface', 'ui'),
    vol('Alerts', 'alert'), vol('Ambience', 'ambience'),
    button(s.voice ? 'Computer voice: on' : 'Computer voice: off', tap(() => {
      s.voice = !s.voice;
      audio.voiceEnabled = s.voice;
      app.saveSettings();
      app.render();
    }), { color: s.voice ? 'green' : 'ghost', sub: 'Officer acknowledgements spoken by the device' }),
  ]));

  root.append(panel('Interface', [
    button(s.haptics ? 'Haptics: on' : 'Haptics: off', tap(() => {
      s.haptics = !s.haptics; app.applySettings(); app.render();
    }), { color: s.haptics ? 'green' : 'ghost' }),
    button(s.wakeLock ? 'Keep screen awake: on' : 'Keep screen awake: off', tap(() => {
      s.wakeLock = !s.wakeLock; app.applySettings(); app.render();
    }), { color: s.wakeLock ? 'green' : 'ghost' }),
    button(s.reduceMotion ? 'Reduce motion: on' : 'Reduce motion: off', tap(() => {
      s.reduceMotion = !s.reduceMotion; app.applySettings(); app.render();
    }), { color: s.reduceMotion ? 'green' : 'ghost' }),
    // No `say:` here, and none on the three above it. Everything the crew can
    // be told to do is sayable; a device preference is not an order to the
    // crew, and making this the one settable-by-voice setting would be the
    // inconsistency rather than the fix.
    button(s.render3d !== false ? '3D view: on' : '3D view: off', tap(() => {
      s.render3d = s.render3d === false;
      // `applySettings` persists on its way out, which is why the three
      // toggles above do not call `saveSettings` either.
      app.applySettings();
      app.render();
    }), {
      color: s.render3d !== false ? 'green' : 'ghost',
      sub: s.render3d !== false
        ? 'Solid hulls and a lit bridge, where the device can'
        : 'The flat plot this game shipped with. Cheaper, and always available.',
    }),
    field('Text size', select([
      { value: 'normal', label: 'Normal' },
      { value: 'large', label: 'Large' },
      { value: 'xlarge', label: 'Extra large' },
    ], s.textSize, (v) => { s.textSize = v; app.applySettings(); })),
  ]));

  root.append(panel('Command Record', [
    button('Save', tap(() => { app.save(); app.showMessage('Saved', ['Command record stored.']); }, 'ui_confirm'), { color: 'green' }),
    button('Export to file', tap(() => app.exportSave()), { color: 'blue', sub: 'Download the record as JSON' }),
    button('Import from file', tap(() => app.importSave()), { color: 'blue' }),
    button('Abandon command', tap(() => app.confirmNewGame(), 'ui_deny'), { color: 'red', sub: 'Start over with a new captain' }),
  ]));

  root.append(panel('About', [
    el('p', { class: 'hint', text: 'A Star Trek Starfleet command simulator. Runs entirely offline — no network, no accounts, no telemetry. Every sound is generated by the device at the moment you hear it; no audio files are used.' }),
    el('p', { class: 'hint', text: 'Fan work, made for the love of the thing. Star Trek is the property of its rights holders and this project is not affiliated with them.' }),
    el('p', { class: 'hint', text: `World seed ${app.game.seed.toString(16)} — the same seed always builds the same galaxy.` }),
  ]));

  return root;
}

// ================================================================ ENCOUNTER

export function encounterScreen(app) {
  const root = el('div', { class: 'scroll' });
  if (!app.game.encounter) return root;
  root.append(encounterPanel(app));
  return root;
}

/**
 * Somebody is calling, as a panel.
 *
 * A ship hailing you is something you see on the viewer and answer from the
 * chair — not a different place to be. This used to be a whole screen that
 * replaced the bridge, and replacing the bridge disposed the first-person view;
 * because WebGL keeps its drawing buffer between frames, the canvas went on
 * showing a FROZEN photograph of a bridge nobody was rendering. It looked
 * perfectly fine, which is what made it worth a comment this long.
 *
 * Returns a container rather than a single panel: the pre-warp first-contact
 * case adds a second one about General Order One, and that warning has to sit
 * above the choices rather than inside them.
 */
export function encounterPanel(app) {
  const g = app.game;
  const enc = g.encounter;
  const root = el('div', {});
  if (!enc) return root;

  root.append(panel(enc.title, [
    el('div', { class: 'speaker', text: enc.hostile ? 'Tactical' : 'Science' }),
    el('p', { text: enc.text }),
    ...(enc.ships ?? []).map((s) => el('p', { class: 'hint', text: `${s.name} — ${s.cls.name}` })),
  ], enc.hostile ? 'danger' : 'warn'));

  // The choices come from the model — `Game.encounterChoices` — because the
  // order line has to read the same list. This switch used to live here, which
  // meant the only thing that knew what a captain could do about an encounter
  // was the thing drawing the buttons, and the buttons printed no phrases
  // because there were none to print.
  const choices = g.encounterChoices().map((c) => button(c.label,
    tap(() => app.resolveEncounter(c.id), 'ui_select'),
    { color: c.color, sub: c.sub, say: c.say }));

  // The pre-warp first contact keeps its own panel above the orders, because
  // the warning has to sit above the choice rather than inside it.
  if (!enc.hostile && enc.kind === 'first_contact' && enc.preWarp) {
    const survey = g.availableAwayMissions().find((t) => t.id === 'covert_landing');
    root.append(panel('General Order One', [
      el('p', { class: 'muted', text: 'Sensors confirm the culture is pre-warp. The Prime Directive applies, and Starfleet will read this page of the log very carefully.' }),
      survey
        ? button(survey.title, tap(() => app.runAwayMission('covert_landing')), {
          say: 'send an away team',
          color: 'ice',
          sub: 'Learn what they are without letting them learn what we are. Dangerous — and being seen is the failure that counts.',
        })
        : el('p', { class: 'hint', text: 'A covert survey would mean putting a team on the surface, and that means standard orbit first.' }),
    ], 'danger'));
  }

  root.append(panel('Orders', choices));
  return root;
}

// ================================================================ MISSION

/**
 * Where a stage wants the captain to be before it will offer its choices.
 *
 * An episode used to be a screen you were teleported to: a wall of text and a
 * column of buttons, regardless of whether you were in the chair, in a
 * corridor, or standing on a planet. That is the last part of this game that
 * happened in a box instead of in a room.
 *
 * `where` on a stage says where it belongs. A stage with no `where` is a bridge
 * stage, because that is where most of an episode happens and defaulting the
 * other way would strand every existing episode.
 */
// Both of these ask the MISSION now rather than answering for themselves.
//
// The panel used to own this rule and be the only thing that enforced it, by
// declining to draw the choices — while `mission_choice` took a choice by index
// out of `mission.choices()` and checked only whether it was locked. So a
// captain on the bridge could say "option two" and advance a scene happening in
// sickbay. `Mission.testWhere` is the one answer now, beside the one about
// which star system a stage is in; a second copy here would eventually
// disagree with it.
function stageIsHere(g, stage) {
  return g.missions?.active?.testWhere(stage)?.ok ?? true;
}

/** What to say when the captain is in the wrong place for it. */
function stageElsewhere(g, stage) {
  const where = stage?.where ?? 'bridge';
  if (where === 'surface') return 'This is happening on the surface. Beam down.';
  const said = g.missions?.active?.testWhere(stage)?.reason;
  return said ?? `They are waiting for you in ${ROOMS[where]?.name ?? where}.`;
}

/**
 * An episode stage, as a panel.
 *
 * Same engine, same choices, same consequence ledger — the only thing that
 * changed is that it hangs on the bridge you are standing on rather than
 * replacing it.
 */
/**
 * The orders on the boards here.
 *
 * Extracted from the bridge screen so the briefing room shows the same thing
 * rather than a second implementation of it, and so the buttons can print the
 * phrase that does the same job — which they could not, because until
 * `take_mission` there was no phrase. Taking standing orders was the one act
 * in the game a captain could not perform with his voice.
 */
export function ordersAvailablePanel(app) {
  const g = app.game;
  const missions = g.availableMissions();
  if (!missions.length) return el('div', {});
  return panel('Orders Available', missions.map((m) =>
    button(m.title, tap(() => { app.startMission(m.id); }), {
      color: 'amber',
      sub: m.summary,
      say: 'take the mission',
    })));
}

/**
 * The briefing room's screen.
 *
 * Its station declared `panel: 'missions'`, `STATION_PANEL` passed that
 * through unchanged, and `openConsole` had no case for it — so the one place
 * on the ship devoted to standing orders fell through to the `default:` branch
 * and said "Working, Captain." while `missionPanel` sat in this file.
 */
export function briefingPanel(app) {
  const g = app.game;
  const wrap = el('div', {});
  const running = g.missions.active;
  if (running && !running.complete) {
    wrap.append(missionPanel(app));
    return wrap;
  }
  const orders = g.availableMissions();
  if (orders.length) {
    wrap.append(el('p', { class: 'muted', text: `${orders.length === 1 ? 'One assignment is' : `${orders.length} assignments are`} on the boards for ${g.location?.name ?? 'this system'}.` }));
    wrap.append(ordersAvailablePanel(app));
    return wrap;
  }
  wrap.append(panel('Standing Orders', [
    el('p', { class: 'muted', text: 'Nothing on the boards for us here, Captain.' }),
    el('p', { class: 'hint', text: 'Orders are posted at the systems that need them. The chart marks the ones with something waiting.' }),
  ]));
  return wrap;
}

export function missionPanel(app) {
  const g = app.game;
  const m = g.missions.active;
  const wrap = el('div', {});
  if (!m) return wrap;

  const stage = m.stage;
  wrap.append(panel(m.title, [
    stage.speaker ? el('div', { class: 'speaker', text: stage.speaker }) : null,
    el('p', { text: stage.text }),
  ], 'accent'));

  if (!stageIsHere(g, stage)) {
    wrap.append(panel('Orders', [
      el('p', { class: 'muted', text: stageElsewhere(g, stage) }),
      el('p', { class: 'hint', text: 'An episode is something you are in, not something you read.' }),
    ]));
    return wrap;
  }

  // Where this is happening, when it is not happening here.
  //
  // The lock reason is on every button, but a captain reading four greyed-out
  // orders should not have to infer the one thing they all have in common. It
  // is one line, at the top, naming the system and saying to set a course.
  const here = m.testLocation();
  if (!here.ok) {
    const name = g.galaxy?.get?.(here.need)?.name ?? here.need;
    wrap.append(panel('Not here', [
      el('p', { class: 'muted', text: `This is happening at ${name}, Captain. We are at ${g.galaxy?.get?.(g.locationId)?.name ?? g.locationId}.` }),
      el('p', { class: 'hint', text: `Say "set course for ${name}".` }),
    ]));
  }

  // Numbered, so they can be spoken. The parser cannot know what an episode
  // wrote in its choice labels, but it can count — and "option two" is how a
  // captain picks one of three things somebody has just laid out for them.
  const spoken = ['option one', 'option two', 'option three', 'option four', 'option five'];
  wrap.append(panel('Orders', m.choices().map((c, i) =>
    button(c.label, tap(() => app.chooseMission(c.id), 'ui_select'), {
      color: c.locked ? 'ghost' : 'orange',
      sub: c.lockReason ?? c.description,
      locked: c.locked,
      say: c.locked ? '' : spoken[i],
    }))));

  // And the way out. Starting another episode used to be the way out — it
  // replaced this one silently, kept everything it had already paid, and put
  // it back on the board to be run again. Walking away is now a thing you do
  // on purpose, and the ledger says you did.
  wrap.append(panel('', [
    button('Break off the mission', tap(() => {
      app.game.abandonMission();
      app.render();
    }, 'ui_deny'), {
      color: 'ghost',
      sub: 'nothing this episode has not already paid is paid',
      say: 'abandon the mission',
    }),
  ]));

  return wrap;
}

/** The same thing as a screen, for the router and the harness. */
export function missionScreen(app) {
  const root = el('div', { class: 'scroll' });
  root.append(missionPanel(app));
  return root;
}

// ================================================================ HAIL

export function hailOptions(app, factionId, onPick) {
  const g = app.game;
  const eng = g.engagement;
  const winning = eng
    ? g.ship.hullPct > (eng.liveHostiles.reduce((n, s) => n + s.hullPct, 0) / Math.max(1, eng.liveHostiles.length))
    : false;
  const options = availableHails(factionId, {
    winning, alwaysBribe: g.perk('always_bribe'),
    latinum: g.latinum, bribePrice: g.bribePrice(),
  });
  const faction = FACTIONS[factionId];

  // "Empathic — you can sense a hail's true intent before answering it."
  //
  // Read by nothing, and the two things it would tell you are both already
  // computed before the channel opens: whether these people will hear it at
  // all, and what they remember of you. `resolveHail` returns 'ignored' outright
  // for a fanatic or assimilating doctrine unless the hearing is forced, and
  // `factionMemory` has carried a weight and a line since faction memory was
  // written. A Betazoid gets to know both BEFORE spending the hail, which is
  // exactly what the card says and what nobody else gets.
  const sense = [];
  if (g.character?.mechanic('senseIntent')) {
    const deaf = faction?.doctrine === 'fanatic' || faction?.doctrine === 'assimilate';
    const memory = g.factionMemory?.(factionId) ?? { weight: 0, line: null };
    sense.push(el('p', {
      class: deaf ? 'danger' : 'hint',
      text: deaf
        ? 'There is nothing on the other end of this that intends to answer. You can feel it.'
        : memory.weight > 0.05
          ? 'They are better disposed than the record says. Something you did is remembered well.'
          : memory.weight < -0.05
            ? 'Something is in the way before you speak. They have not forgotten.'
            : 'Nothing is weighing on this either way. It will go as it goes.',
    }));
    if (memory.line) sense.push(el('p', { class: 'muted', text: memory.line }));
  }

  return [
    el('p', { class: 'muted', text: faction?.description ?? '' }),
    el('p', { class: 'hint', text: `Current standing: ${standingTier(g.ledger.standingOf(factionId)).label}` }),
    ...sense,
    ...options.map((o) => button(o.label, tap(() => onPick(o.id), 'ui_select'), {
      color: 'lilac', sub: o.description,
    })),
  ];
}

// ================================================================ NEW GAME

export function newGameScreen(app, onStart) {
  const draft = {
    firstName: 'Alexander', name: 'Reyes', species: 'Human',
    pronouns: 'they/them', background: 'command',
    crewMode: 'canon', era: 'tos', shipName: 'Enterprise',
    registry: 'NCC-1701', seed: '',
  };

  const root = el('div', { class: 'scroll' });

  root.append(panel('Starfleet Personnel File', [
    field('Given name', textInput(draft.firstName, (v) => { draft.firstName = v; })),
    field('Surname', textInput(draft.name, (v) => { draft.name = v; })),
    field('Species', select(SPECIES.map((s) => ({ value: s.name, label: s.name })), draft.species,
      (v) => { draft.species = v; })),
    field('Pronouns', select([
      { value: 'they/them', label: 'they / them' },
      { value: 'she/her', label: 'she / her' },
      { value: 'he/him', label: 'he / him' },
    ], draft.pronouns, (v) => { draft.pronouns = v; })),
    field('Background', select([
      { value: 'command', label: 'Command track — a point in Leadership' },
      { value: 'tactical', label: 'Tactical — a point in Beam Weapons' },
      { value: 'engineering', label: 'Engineering — a point in Damage Control' },
      { value: 'science', label: 'Science — a point in Sensor Analysis' },
      { value: 'diplomatic', label: 'Diplomatic corps — a point in Diplomacy' },
    ], draft.background, (v) => { draft.background = v; })),
  ], 'accent'));

  const crewPanelBody = el('div');
  const renderCrewPanel = () => {
    clear(crewPanelBody);
    crewPanelBody.append(
      el('div', { class: 'grid-2' }, [
        button('Canonical crew', tap(() => { draft.crewMode = 'canon'; renderCrewPanel(); }),
          { color: draft.crewMode === 'canon' ? 'green' : 'blue' }),
        button('Original crew', tap(() => { draft.crewMode = 'original'; renderCrewPanel(); }),
          { color: draft.crewMode === 'original' ? 'green' : 'blue' }),
      ]),
    );
    if (draft.crewMode === 'canon') {
      crewPanelBody.append(
        el('p', { class: 'hint', text: 'Serve with the senior staff of a chosen era.' }),
        ...ERA_LIST.map((e) => button(e.name, tap(() => { draft.era = e.id; renderCrewPanel(); }), {
          color: draft.era === e.id ? 'amber' : 'ghost',
          sub: `${e.description} · ${e.crew.map((c) => c.name).filter((n, i, a) => a.indexOf(n) === i).slice(0, 4).join(', ')}…`,
        })),
      );
    } else {
      crewPanelBody.append(el('p', { class: 'hint', text: 'A senior staff will be generated for you — species, traits, and abilities rolled from the world seed. They are yours, and they can be lost.' }));
    }
  };
  renderCrewPanel();
  root.append(panel('Crew', [crewPanelBody]));

  root.append(panel('Ship', [
    field('Ship name', textInput(draft.shipName, (v) => { draft.shipName = v; })),
    field('Registry', textInput(draft.registry, (v) => { draft.registry = v; })),
    el('p', { class: 'hint', text: 'Your first command is a heavy cruiser. Later ranks unlock heavier hulls at any shipyard.' }),
  ]));

  root.append(panel('Galaxy', [
    field('World seed (optional)', textInput('', (v) => { draft.seed = v; }, 'leave blank for a new galaxy')),
    el('p', { class: 'hint', text: 'The same seed always produces the same galaxy, the same encounters, and the same rolls. Share one to give someone your exact game.' }),
  ]));

  root.append(panel(null, [
    button('Assume command', tap(() => onStart(draft), 'ui_confirm'), { color: 'green' }),
  ]));

  return root;
}

// ================================================================ GAME OVER

export function gameOverScreen(app) {
  const g = app.game;
  const root = el('div', { class: 'scroll' });
  const assessment = g.ledger.assessment();
  // Five years served is the one good ending, and it must not be shown in the
  // red border the game uses for a ship lost or a career cut short. Read off a
  // flag set when the commission ended rather than off the wording of
  // `overReason`, which is prose and will change.
  const finished = !!g.commissionCompleted;

  root.append(panel(finished ? 'Commission Complete' : 'End of Commission', [
    el('p', {
      text: g.overReason
        ?? (finished ? 'The five-year mission is complete.' : 'Your command has ended.'),
    }),
    finished
      ? el('p', { class: 'hint', text: `${g.ship.name} is ordered home. ${g.campaign?.format() ?? ''}`.trim() })
      : null,
    el('p', { class: 'big-stat center', text: assessment.label }),
    el('p', { class: 'hint center', text: `Service score ${g.ledger.serviceScore()}` }),
  ], finished ? 'accent' : 'danger'));

  root.append(panel('Final Record', [
    el('p', { class: 'hint', text: `Stardate ${g.stardate}. ${g.ledger.entries.length} entries.` }),
    readout('Lives saved', Math.min(1, g.ledger.count('lives_saved') / 20000), String(g.ledger.count('lives_saved'))),
    readout('Lives lost', Math.min(1, g.ledger.count('lives_lost') / 5000), String(g.ledger.count('lives_lost'))),
    el('p', {}, [
      pill(`${g.ledger.destroyedShips.length} ships destroyed`),
      pill(`${g.ledger.count('first_contact')} first contacts`, 'green'),
      pill(`${g.ledger.count('treaty_signed')} treaties`, 'green'),
      pill(`${g.ledger.count('prime_directive_violation')} Directive violations`, 'red'),
      pill(`${g.ledger.lostOfficers.length} officers lost`, 'red'),
    ]),
  ]));

  if (g.ledger.lostOfficers.length) {
    root.append(panel('The Dead', g.ledger.lostOfficers.map((o) =>
      el('p', { class: 'hint', text: `${o.name}${o.mission ? ` — ${o.mission}` : ''}` })), 'danger'));
  }

  root.append(panel(null, [
    button('New command', tap(() => app.confirmNewGame(true), 'ui_confirm'), { color: 'green' }),
  ]));

  return root;
}

export { modal, field, textInput, select };


/**
 * The machine shop: what is in the stores, what is on the bench, and what the
 * chief could build if you asked.
 *
 * Only one job at a time, on purpose. A ship with one machine shop and one
 * chief engineer cannot build four things at once, and being made to choose
 * which one is the entire interest of the mechanic.
 */
/**
 * Sickbay, from the biobed or the medical laboratory.
 *
 * Both of those stations declared `panel: 'medical'`, and `STATION_PANEL`
 * aliased 'medical' onto 'crew' — so standing at a biobed opened the crew
 * ROSTER, which is a personnel screen and knows nothing about who is hurt.
 * Three metres away the chief surgeon's desk gave a real sick list, because
 * that station has no panel at all and falls to `sim/consoles.js`. One room,
 * one station telling the truth and two opening a filing cabinet.
 *
 * The readout is the injury, in the words `severity` uses on the CMO's desk,
 * and the hours between an officer and their post — which is a number the
 * simulation has always had (`Officer.recover` is `hours * rate / 120`) and
 * has never shown anybody.
 */
export function sickbayPanel(app) {
  const g = app.game;
  const rate = g.character?.mechanic?.('recoveryRate') ?? 1;
  const hurt = (g.crew?.officers ?? []).filter((o) => o.alive && o.injured);
  const lost = (g.crew?.officers ?? []).filter((o) => !o.alive);

  const body = [];
  if (!hurt.length) {
    body.push(el('p', { class: 'muted', text: 'No officer is on the sick list. The ward is quiet.' }));
  } else {
    for (const o of hurt) {
      const hours = Math.ceil(((o.injurySeverity ?? 1) * 120) / (rate > 0 ? rate : 1));
      // The bar is how far along they are, not how hurt they are, so it fills
      // as they get better — the direction every other readout in the game
      // fills in.
      // The name alone. Rendered at 412 CSS px with the rank in front of it,
      // "Commander Ashford Quill" wrapped a readout label onto three lines and
      // pushed the bar into a column narrower than the words beside it. The
      // rank is on the crew screen, which is where ranks live.
      body.push(readout(o.name,
        1 - (o.injurySeverity ?? 1),
        hours < 24 ? `${hours} h to duty` : `${(hours / 24).toFixed(1)} d to duty`));
    }
    body.push(button('See to the wounded', tap(() => {
      const r = g.seeToTheWounded();
      if (!r.ok) { app.showMessage('Sickbay', [r.reason]); return; }
      app.showMessage('Sickbay', [
        `${r.hours} hours.`,
        r.back.length
          ? `${r.back.join(', ')} back on duty.`
          : 'Nobody is fit to return yet.',
        r.still ? `${r.still} still on the sick list.` : 'The ward is clear.',
      ]);
      app.render();
    }), {
      color: 'blue',
      say: 'see to the wounded',
      sub: 'Up to a day of the commission, at the ward rather than the chair',
    }));
  }

  // The captain's own recovery rate, which two species traits and one
  // background double and which had exactly one reader in the whole game.
  if (rate !== 1) {
    body.push(el('p', { class: 'hint', text: `Your own training has them on their feet ${rate}× as fast.` }));
  }
  if (lost.length) {
    body.push(el('p', { class: 'hint', text: `We are without ${lost.map((o) => o.name).join(', ')}.` }));
  }

  return panel('Sickbay', body);
}

export function machineShopPanel(app) {
  const g = app.game;
  const status = g.fabricationStatus;

  const stores = el('div', { class: 'meta' }, MATERIAL_LIST.map((m) =>
    pill(`${m.name} ${Math.round(g.stores?.[m.id] ?? 0)}`,
      (g.stores?.[m.id] ?? 0) > 0 ? '' : 'red')));

  const devices = Object.entries(g.devices ?? {}).filter(([, n]) => n > 0);

  const body = [
    el('p', { class: 'muted', text: 'Salvage from wrecks becomes stores; stores become whatever you have the hours for. Everything here runs on the commission clock, so a two-day job is two days whether the app is open or not.' }),
    stores,
    devices.length
      ? el('div', { class: 'meta' }, devices.map(([id, n]) =>
        pill(`${RECIPE_BY_ID[id]?.name ?? id} ×${n}`, 'green')))
      : null,
  ];

  if (status) {
    body.push(readout(status.name, status.progress,
      status.hoursRemaining < 1
        ? `${Math.round(status.hoursRemaining * 60)} min`
        : `${status.hoursRemaining.toFixed(1)} h`));
    body.push(button('Put the hours in', tap(() => {
      const r = g.workTheShop(Math.min(status.hoursRemaining, 8));
      if (r.done) app.showMessage(r.done.recipe.name, [r.done.text]);
      app.render();
    }), { color: 'amber', sub: 'Spends up to eight hours of the commission' }));
  } else {
    for (const { recipe, canMake, reason } of availableRecipes(g)) {
      body.push(button(recipe.name, canMake ? tap(() => {
        const r = g.fabricate(recipe.id);
        if (!r.ok) app.showMessage('Engineering', [r.reason]);
        app.render();
      }) : null, {
        color: canMake ? 'blue' : 'ghost',
        disabled: !canMake,
        sub: canMake
          ? `${recipe.blurb} — ${recipe.hours < 1 ? `${Math.round(recipe.hours * 60)} min` : `${recipe.hours} h`}`
          : reason,
      }));
    }
  }

  return panel('Machine Shop', body.filter(Boolean));
}


/**
 * The Kobayashi Maru.
 *
 * Available from the first day and unwinnable. The panel says so plainly rather
 * than hinting — a no-win scenario that pretends to be winnable is just a badly
 * tuned fight, and the whole value of this one is knowing going in.
 *
 * The technique is shown as locked, with the two specific reasons, because "you
 * have not earned this yet" is only interesting if you can see what earning it
 * would look like.
 */
export function kobayashiPanel(app) {
  const g = app.game;
  const status = g.gambit;
  const runs = g.kobayashiRuns ?? 0;
  const solved = g.ledger?.counters?.kobayashi_maru_solved ?? 0;

  const body = [
    el('p', { class: 'muted', text: 'A freighter adrift inside the Neutral Zone. Three hundred and eighty-one people aboard. Entering violates the treaty; not entering abandons them.' }),
    el('p', { class: 'muted', text: 'It cannot be won. That is not a difficulty setting — it is what the exercise is for, and the simulator does not relent if you fly well.' }),
    runs ? el('p', { class: 'muted', text: `You have taken it ${runs} time${runs === 1 ? '' : 's'}.` }) : null,
    solved ? el('p', {}, [el('b', { text: 'You have talked your way out of it once. It is in the record.' })]) : null,
    button('Take the simulator', tap(() => {
      app.game.runKobayashiMaru();
      app.render();
    }), { color: 'amber', sub: 'Three cruisers. No escape course.' }),
  ];

  if (status.unlocked) {
    body.push(el('p', {}, [el('b', { text: 'The Empire knows your name.' })]));
    body.push(el('p', { class: 'muted', text: 'You can force a channel open with a commander who has no intention of answering, and then you can talk. What you type is what you say — there is no menu, and the record is the judge of it.' }));
  } else {
    body.push(el('p', { class: 'muted', text: `Standing with the Empire: tier ${status.tier} of ${GAMBIT_TIER} required. Encounters on record: ${status.met}.` }));
    for (const reason of status.reasons) {
      body.push(el('p', { class: 'hint', text: reason }));
    }
  }

  return panel(KOBAYASHI.title, body.filter(Boolean));
}
