// The stations that had nothing behind them.
//
// Thirty-six stations aboard, and four of them opened no panel at all:
// environmental control, gravity control and the security board on the bridge,
// and the chief medical officer's desk in sickbay. A captain could cross the
// bridge, stand at a console, operate it, and be told "That station is not
// mine to work, Captain" — by the officer standing at it, which is the one
// person it certainly IS.
//
// They do not need panels. Three of them are not places you give orders from,
// they are places you ASK something, and the answer is a page of readings the
// ship already has. This file is those readings: what each station knows,
// computed from live state.
//
// Same division of labour as src/sim/powers.js, and for the same reason —
// "what is here is everything a power DOES; what stays in main.js is what a
// power SOUNDS like". A report is data. The modal that shows it is not.

import { occupantsOf, boardedRooms } from './occupancy.js';

/** A percentage, said the way a bridge officer says one. */
const pc = (v) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;

/** "nominal" / "degraded" / "failing", from a subsystem's health. */
const condition = (v) => (v > 0.85 ? 'nominal' : v > 0.55 ? 'degraded' : v > 0.2 ? 'impaired' : 'failing');

/**
 * What each station reports.
 *
 * Keyed by the station id in world/interiors.data.js, so a station that gains
 * a panel later simply stops being listed here and the two can never both
 * claim it — `stationReport` returns null for anything absent.
 */
const REPORTS = {
  /**
   * Life support. The one system aboard whose failure kills everybody slowly
   * rather than quickly, and the only reading in the game that is about the
   * air rather than the ship.
   */
  environmental: (g) => {
    const s = g.ship;
    const air = s.subsystems?.lifesupport ?? 1;
    const lines = [
      `Atmosphere and scrubbers: ${condition(air)}, ${pc(air)} of rated capacity.`,
      `Complement aboard: ${s.crew} of ${s.maxCrew}.`,
    ];
    if (s.fires > 0) {
      lines.push(`${s.fires} fire${s.fires === 1 ? '' : 's'} burning. `
        + 'Those compartments are being vented as they are reached.');
    }
    // The number that matters, and only when it does: at full health the
    // margin is meaningless and printing it every time teaches the captain to
    // stop reading the panel.
    if (air < 0.85) {
      const hours = Math.round(96 * air * (s.maxCrew / Math.max(1, s.crew)));
      lines.push(`At this capacity we have about ${hours} hours of breathable `
        + 'air for the complement aboard.');
    } else {
      lines.push('No compartment is showing a loss. We are comfortable.');
    }
    return { title: 'Environmental Control', lines };
  },

  /**
   * Gravity plating and structural integrity. Not a system with its own
   * subsystem entry — it hangs off auxiliary power, which is exactly the sort
   * of thing standing at the console is for finding out.
   */
  gravity: (g) => {
    const s = g.ship;
    const aux = s.subsystems?.auxiliary ?? 1;
    const power = s.power?.factor?.('auxiliary') ?? 1;
    const held = Math.max(0, Math.min(1, aux * power));
    const lines = [
      `Deck plating: ${condition(held)} at ${pc(held)}.`,
      `Structural integrity field is drawing from auxiliary, currently ${pc(power)} of nominal.`,
    ];
    lines.push(held > 0.85
      ? 'One gravity throughout. Nobody has noticed a thing.'
      : held > 0.4
        ? 'There is a flutter on the lower decks. Engineering knows.'
        : 'Plating is failing on several decks. Anyone moving about should be told.');
    return { title: 'Gravity Control', lines };
  },

  /**
   * The internal security board: who is aboard who should not be, where the
   * security detail is, and what the brig holds.
   *
   * `ship.boarders` has been in the simulation since a hostile could send a
   * party across and there has never been a console that showed it.
   */
  security: (g) => {
    const s = g.ship;
    const lines = [`Condition ${g.alert ?? 'normal'}. Internal sensors are sweeping.`];
    if ((s.boarders ?? 0) > 0) {
      lines.push(`INTRUDER ALERT. Approximately ${s.boarders} hostile personnel aboard.`);
      // Where, from the same layer that draws them — one answer, so the board
      // and the corridor cannot disagree about where the fight is.
      const where = boardedRooms(s.boarders)
        .filter((id) => occupantsOf(g, id).some((o) => o.intruder));
      if (where.length) {
        lines.push(`Contacts on: ${where.map((id) => LOCATION_NAME[id] ?? id).join(', ')}.`);
      }
      lines.push('Security teams are engaging. Recommend the captain stay off those decks.');
    } else {
      lines.push('No unauthorised personnel aboard.');
    }
    const detail = occupantsOf(g, 'corridor_sec').filter((o) => !o.intruder).length;
    lines.push(`${detail} of the security detail on watch on deck seven.`);
    lines.push(g.alert === 'red'
      ? 'The armoury is issuing sidearms.'
      : 'The armoury is secured.');
    return { title: 'Security', lines };
  },

  /**
   * The chief medical officer's desk. Who is in sickbay, by name, and what
   * the commission has cost so far.
   */
  cmo_desk: (g) => {
    const s = g.ship;
    const officers = g.crew?.officers ?? [];
    const hurt = officers.filter((o) => o.alive && o.injured);
    const lost = officers.filter((o) => !o.alive);
    const lines = [];
    if (hurt.length) {
      for (const o of hurt) {
        lines.push(`${o.name} — ${severity(o.injurySeverity)}, off duty.`);
      }
    } else {
      lines.push('No officer is on the sick list.');
    }
    const dead = Math.max(0, (s.maxCrew ?? 0) - (s.crew ?? 0));
    lines.push(dead > 0
      ? `${dead} of the complement lost since we sailed. `
        + `${s.crew} aboard, ${occupantsOf(g, 'sickbay').length} of them in here.`
      : `${s.crew} aboard and none of them lost. Long may it last.`);
    if (lost.length) {
      lines.push(`We are without ${lost.map((o) => o.name).join(', ')}.`);
    }
    return { title: "Chief Medical Officer's Desk", lines };
  },
};

/** What a first-person room is called, for the security board. */
const LOCATION_NAME = {
  corridor_a: 'deck five', corridor_rec: 'deck three', corridor_sec: 'deck seven',
  engineering: 'main engineering', armoury: 'the armoury', bridge: 'the bridge',
};

/** How bad an injury is, in words a doctor would use. */
const severity = (v) => (v >= 0.66 ? 'serious' : v >= 0.33 ? 'stable but not fit' : 'light injuries');

/**
 * The readings at this station, or null if it is not one of these.
 *
 * Null rather than an empty report, so the caller can tell "this station has
 * nothing behind it" from "this station has nothing to say", which are
 * different things and used to be the same one.
 */
export function stationReport(game, stationId) {
  if (!game?.ship || !stationId) return null;
  const build = REPORTS[stationId];
  if (!build) return null;
  const r = build(game);
  return r?.lines?.length ? r : null;
}

/** Which stations answer. Exported so a test can hold the data to it. */
export const REPORTING_STATIONS = Object.keys(REPORTS);
