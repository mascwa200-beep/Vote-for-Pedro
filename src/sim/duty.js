// The rest of the crew, and what you send them to do.
//
// A Constitution carries 430 people: 43 officers and 387 enlisted (docs/
// RESEARCH.md §18). About ten of them stand at bridge stations and have names,
// opinions and abilities. The other four hundred and twenty were a single
// integer that went down when the hull was breached — the ship carried a crew
// and the game had no idea who any of them were.
//
// This names a handful of the forty-three. Not all of them: a captain knows the
// specialists who matter to them, and a row per crewman would be a spreadsheet
// rather than a ship. The enlisted stay the number they have always been, which
// is what the casualty count has always counted.
//
// The specialities are the ones the show named, sorted into the three divisions
// Starfleet actually used in the 2260s — so a specialist is a job somebody had
// rather than one invented to fill a grid. The trap §18 records is communications:
// Uhura wears operations red, not command gold, and a table built from bridge
// stations alone puts her and the yeoman in the wrong division.

import { HAZARD_LEVEL } from './away.js';
import { emit } from '../core/events.js';
import { generateOfficer } from '../world/crews.data.js';

/**
 * What a specialist is trained for.
 *
 * `division` is the 2260s Starfleet division, `station` is the bridge post the
 * speciality lends a hand to when the specialist is aboard, and `label` is what
 * the crew call them. Several specialities share a station on purpose — a
 * cartographer and a xenobiologist both help the science officer, differently.
 */
export const SPECIALITIES = {
  // --- Command (gold) ---
  navigator: { id: 'navigator', division: 'command', station: 'navigation', label: 'Navigator' },
  flight_controller: { id: 'flight_controller', division: 'command', station: 'helm', label: 'Flight Controller' },
  adjutant: { id: 'adjutant', division: 'command', station: 'helm', label: 'Adjutant' },

  // --- Operations (red) ---
  engineer: { id: 'engineer', division: 'operations', station: 'engineering', label: 'Engineer' },
  damage_controlman: { id: 'damage_controlman', division: 'operations', station: 'damagecontrol', label: 'Damage Controlman' },
  security_officer: { id: 'security_officer', division: 'operations', station: 'security', label: 'Security Officer' },
  // Operations, not command — see §18. This is the one everybody gets wrong.
  communications_officer: { id: 'communications_officer', division: 'operations', station: 'comms', label: 'Communications Officer' },
  yeoman: { id: 'yeoman', division: 'operations', station: 'comms', label: 'Yeoman' },
  quartermaster: { id: 'quartermaster', division: 'operations', station: 'gravity', label: 'Quartermaster' },

  // --- Sciences (blue) ---
  sensor_analyst: { id: 'sensor_analyst', division: 'sciences', station: 'science', label: 'Sensor Analyst' },
  xenobiologist: { id: 'xenobiologist', division: 'sciences', station: 'science', label: 'Xenobiologist' },
  cartographer: { id: 'cartographer', division: 'sciences', station: 'science', label: 'Cartographer' },
  surgeon: { id: 'surgeon', division: 'sciences', station: 'environmental', label: 'Surgeon' },
  medical_technician: { id: 'medical_technician', division: 'sciences', station: 'environmental', label: 'Medical Technician' },
};

export const SPECIALITY_LIST = Object.values(SPECIALITIES);

/** The three divisions, in the order the uniform colours are usually listed. */
export const DIVISIONS = ['command', 'operations', 'sciences'];

/** Specialities belonging to a division. */
export function specialitiesIn(division) {
  return SPECIALITY_LIST.filter((s) => s.division === division);
}

/**
 * How many of the forty-three are worth naming, for a hull of this size.
 *
 * Scaled from the complement rather than a constant: a runabout does not carry
 * a xenobiologist and a cartographer and a yeoman. Sol's flagship gets a dozen;
 * the smallest hulls in the game get two or three.
 */
export function rosterSizeFor(maxCrew) {
  const crew = Number.isFinite(maxCrew) && maxCrew > 0 ? maxCrew : 0;
  // 430 crew -> 12. Square root rather than linear, so a battleship with four
  // times the complement does not get four times the roster.
  return Math.max(2, Math.min(14, Math.round(Math.sqrt(crew) * 0.58)));
}

/**
 * A specialist.
 *
 * Deliberately a lighter record than `Officer` and NOT a subclass of it: a duty
 * officer has no station, no abilities, no cooldowns and no opinion of you.
 * Sharing the name, species and two of the four scores is enough, and it means
 * the name tables in `crews.data.js` are the only name tables in the game.
 */
export class DutyOfficer {
  constructor(data) {
    Object.assign(this, {
      id: 'duty', name: 'Crewman', species: 'Human', speciesId: null,
      speciality: 'engineer', expertise: 80, discipline: 78,
      // aboard | assigned | recovering | lost
      state: 'aboard',
    }, data);
  }

  get spec() { return SPECIALITIES[this.speciality] ?? SPECIALITIES.engineer; }
  get division() { return this.spec.division; }
  get station() { return this.spec.station; }
  get label() { return this.spec.label; }

  /** Available to be sent somewhere. */
  get available() { return this.state === 'aboard'; }

  /** Aboard in any sense — counts toward what the ship can do, unlike the dead. */
  get alive() { return this.state !== 'lost'; }

  save() {
    return {
      id: this.id, name: this.name, species: this.species, speciesId: this.speciesId,
      speciality: this.speciality, expertise: this.expertise,
      discipline: this.discipline, state: this.state,
    };
  }
}

/**
 * Build a ship's duty roster.
 *
 * Deterministic from the game's RNG, like everything else here: the same seed
 * has to produce the same people on every device, forever, because they are
 * saved and a save has to load into the same ship it was written from.
 *
 * Names and species come from `generateOfficer`, which already does exactly
 * this work for the bridge crew. It wants a station, so it is handed the one
 * the speciality lends a hand to, and its rank and station are then discarded —
 * a duty officer has neither.
 */
export function buildDutyRoster(rng, maxCrew) {
  const want = rosterSizeFor(maxCrew);
  const roster = [];
  const used = new Set();

  for (let i = 0; i < want; i++) {
    // Round-robin the divisions so a roster is never all one colour, then pick
    // a speciality inside that division that is not already filled if one is
    // free. Two engineers is fine; twelve is a department, not a roster.
    const division = DIVISIONS[i % DIVISIONS.length];
    const pool = specialitiesIn(division);
    const fresh = pool.filter((s) => !used.has(s.id));
    const spec = rng.pick(fresh.length ? fresh : pool);
    used.add(spec.id);

    const person = generateOfficer(rng, spec.station);
    roster.push(new DutyOfficer({
      id: `duty_${i}`,
      name: person.name,
      species: person.species,
      speciesId: person.speciesId,
      speciality: spec.id,
      expertise: person.expertise,
      discipline: person.discipline,
    }));
  }
  return roster;
}

/**
 * The details a captain can send out.
 *
 * `hours` is campaign time, the same clock fabrication runs on. `wants` is the
 * speciality that does the work well; anybody can be sent, and sending the
 * wrong people is a real choice rather than a refusal. `hazard` indexes
 * `HAZARD_LEVEL` from the away-team rules, so the chance of losing somebody is
 * the same model the landing parties use rather than a second one.
 *
 * `grant` speaks the vocabulary the reputation projects already speak.
 */
export const ASSIGNMENTS = {
  survey_detail: {
    id: 'survey_detail', name: 'Survey detail', hours: 18,
    wants: 'cartographer', hazard: 'routine', team: 2,
    grant: { xp: 140 },
    text: 'A party to chart what the main sensors only glanced at.',
  },
  specimen_collection: {
    id: 'specimen_collection', name: 'Specimen collection', hours: 26,
    wants: 'xenobiologist', hazard: 'elevated', team: 2,
    grant: { xp: 180, materials: { isolinear: 8 } },
    text: 'Samples worth the trip down, and the risk of going.',
  },
  sensor_recalibration: {
    id: 'sensor_recalibration', name: 'Sensor recalibration', hours: 12,
    wants: 'sensor_analyst', hazard: 'routine', team: 1,
    grant: { materials: { isolinear: 12 } },
    text: 'Strip the sensor pallets down and put them back better.',
  },
  hull_working_party: {
    id: 'hull_working_party', name: 'Hull working party', hours: 20,
    wants: 'damage_controlman', hazard: 'elevated', team: 3,
    grant: { materials: { duranium: 14 } },
    text: 'Plating, in vacuum, by hand.',
  },
  engine_overhaul: {
    id: 'engine_overhaul', name: 'Engine overhaul', hours: 34,
    wants: 'engineer', hazard: 'elevated', team: 3,
    grant: { materials: { duranium: 10, deuterium: 20 } },
    text: 'Take the intermix down and rebuild it while nobody is shooting.',
  },
  torpedo_workup: {
    id: 'torpedo_workup', name: 'Torpedo workup', hours: 16,
    wants: 'quartermaster', hazard: 'routine', team: 2,
    grant: { torpedoes: 12 },
    text: 'Assemble warheads from stores and rack them.',
  },
  sickbay_rotation: {
    id: 'sickbay_rotation', name: 'Sickbay rotation', hours: 22,
    wants: 'surgeon', hazard: 'routine', team: 2,
    grant: { heal: true, xp: 90 },
    text: 'Get the injured back on their feet sooner.',
  },
  diplomatic_attache: {
    id: 'diplomatic_attache', name: 'Diplomatic attaché', hours: 40,
    wants: 'communications_officer', hazard: 'routine', team: 1,
    grant: { xp: 220, standing: 6 },
    text: 'Somebody at the table when you are not.',
  },
  boarding_drill: {
    id: 'boarding_drill', name: 'Boarding drill', hours: 14,
    wants: 'security_officer', hazard: 'elevated', team: 3,
    grant: { xp: 160 },
    text: 'Rehearse repelling people who are already aboard.',
  },
  salvage_party: {
    id: 'salvage_party', name: 'Salvage party', hours: 24,
    wants: 'engineer', hazard: 'dangerous', team: 3,
    grant: { materials: { salvage: 18, duranium: 8 } },
    text: 'Board the hulk and strip what is left of it.',
    // Only worth offering when there is something out there to board.
    requires: (game) => !!game.wreckHere,
  },
};

export const ASSIGNMENT_LIST = Object.values(ASSIGNMENTS);

/** Assignments this ship could actually start right now. */
export function availableAssignments(game) {
  if (!game) return [];
  return ASSIGNMENT_LIST.filter((a) => !a.requires || a.requires(game));
}

/**
 * How well a team is suited to the work.
 *
 * Returns a modifier, not a verdict. A matched speciality is worth a great deal
 * and a good officer is worth some; sending nobody suitable is allowed and is
 * simply worse, which is what makes choosing who to send a decision.
 */
export function teamFitness(assignment, team) {
  if (!assignment || !team?.length) return 0;
  let best = 0;
  for (const person of team) {
    const matched = person.speciality === assignment.wants;
    const sameDivision = person.division === SPECIALITIES[assignment.wants]?.division;
    const skill = ((person.expertise ?? 0) + (person.discipline ?? 0)) / 2;
    // The speciality is the big term; the person's own quality is the small one.
    const fit = (matched ? 40 : sameDivision ? 14 : 0) + (skill - 70) * 0.5;
    if (fit > best) best = fit;
  }
  // Hands help, up to a point: the fourth person on a two-person job is stood
  // around watching.
  const hands = Math.min(team.length, assignment.team ?? 1);
  return best + hands * 4;
}

/**
 * Send a detail out.
 *
 * Unlike fabrication, several of these run at once — and that difference is
 * deliberate. There is one machine shop and one chief engineer, so being made
 * to choose between two builds is the whole interest of that mechanic. There
 * are four hundred people, so the limit here is not the shop, it is how many
 * hands the ship can spare: `slots`, which falls as the roster is hurt.
 */
export function beginAssignment(game, assignmentId, officerIds = []) {
  const assignment = ASSIGNMENTS[assignmentId];
  if (!assignment) return { ok: false, reason: 'No such detail, Captain.' };
  if (assignment.requires && !assignment.requires(game)) {
    return { ok: false, reason: 'There is nothing out there for them to do.' };
  }
  // Not while people are shooting. Sending a working party out in a firefight
  // is the same class of order as docking mid-battle, and refused for the same
  // reason.
  if (game.engagement && !game.engagement.over) {
    return { ok: false, reason: 'Not while we are under fire, Captain.' };
  }

  game.assignments = game.assignments ?? [];
  if (game.assignments.some((a) => a.assignmentId === assignmentId)) {
    return { ok: false, reason: `${assignment.name} is already under way.` };
  }
  if (game.assignments.length >= dutySlots(game)) {
    return { ok: false, reason: 'We have no one else to spare, Captain.' };
  }

  const roster = game.dutyRoster ?? [];
  const team = officerIds
    .map((id) => roster.find((p) => p.id === id))
    .filter((p) => p && p.available);
  if (!team.length) return { ok: false, reason: 'Nobody was named for it.' };

  for (const person of team) person.state = 'assigned';
  game.assignments.push({
    assignmentId,
    team: team.map((p) => p.id),
    hoursRemaining: assignment.hours,
    hoursTotal: assignment.hours,
  });

  const names = team.map((p) => p.name).join(', ');
  game.officerSays('comms', `${assignment.name}: ${names} are on it, Captain.`, 'report');
  emit('assignment:begin', { assignment, team });
  return { ok: true, assignment, team };
}

/** How many details this ship can have out at once. */
export function dutySlots(game) {
  const able = (game?.dutyRoster ?? []).filter((p) => p.alive).length;
  // One detail per three people who can still be sent, and never more than
  // four: past that the ship is a staffing agency rather than a starship.
  return Math.max(1, Math.min(4, Math.floor(able / 3)));
}

/**
 * Advance every running detail by campaign hours.
 *
 * Called from the same place fabrication is advanced, so work continues while
 * the app is closed — which is the whole point of a job measured in days.
 */
export function advanceAssignments(game, hours, rng = game?.rng) {
  if (!game?.assignments?.length || hours <= 0) return [];

  const done = [];
  const still = [];
  for (const job of game.assignments) {
    job.hoursRemaining -= hours;
    if (job.hoursRemaining > 0) still.push(job);
    else done.push(job);
  }
  game.assignments = still;

  return done.map((job) => resolveAssignment(game, job, rng)).filter(Boolean);
}

/**
 * What a detail came back with, and who did not come back.
 *
 * The hazard model is the away teams', not a second one: `HAZARD_LEVEL` gives
 * the chance of a death and of an injury, and a well-suited team shortens both
 * because people who know the work get hurt less doing it.
 */
export function resolveAssignment(game, job, rng = game?.rng) {
  const assignment = ASSIGNMENTS[job.assignmentId];
  if (!assignment) return null;

  const roster = game.dutyRoster ?? [];
  const team = job.team.map((id) => roster.find((p) => p.id === id)).filter(Boolean);
  const fitness = teamFitness(assignment, team);
  const hazard = HAZARD_LEVEL[assignment.hazard] ?? HAZARD_LEVEL.routine;

  // Competence is protection. A matched speciality roughly halves the risk;
  // sending people with no idea what they are doing does not raise it above
  // what the hazard already says it is.
  const shield = Math.max(0.45, 1 - Math.max(0, fitness) / 90);
  const lost = [];
  const hurt = [];
  for (const person of team) {
    if (rng?.chance?.(hazard.death * shield)) {
      person.state = 'lost';
      lost.push(person);
    } else if (rng?.chance?.(hazard.injury * shield)) {
      person.state = 'recovering';
      hurt.push(person);
    } else {
      person.state = 'aboard';
    }
  }

  // A well-suited team brings back more of what it went for.
  const share = Math.max(0.4, Math.min(1.6, 1 + fitness / 120));
  const paid = payAssignment(game, assignment, share);

  for (const person of lost) {
    game.ledger?.record?.('lives_lost', {
      count: 1,
      text: `${person.name}, ${person.label}, lost on ${assignment.name.toLowerCase()}`,
      system: game.locationId,
    });
    // One of the four hundred and twenty, and now a name.
    game.ship.crew = Math.max(0, game.ship.crew - 1);
  }

  const said = lost.length
    ? `${assignment.name} is back. We lost ${lost.map((p) => p.name).join(' and ')}.`
    : hurt.length
      ? `${assignment.name} is back. ${hurt.map((p) => p.name).join(' and ')} are in sickbay.`
      : `${assignment.name} is back, Captain. ${paid}`;
  game.officerSays(lost.length ? 'comms' : 'engineering', said, 'report');

  emit('assignment:complete', { assignment, team, lost, hurt, text: paid });
  return { assignment, team, lost, hurt, text: paid };
}

/** Hand over what a detail earned, in the vocabulary the projects already use. */
function payAssignment(game, assignment, share) {
  const grant = assignment.grant ?? {};
  const parts = [];

  if (grant.materials) {
    game.stores = game.stores ?? {};
    for (const [material, amount] of Object.entries(grant.materials)) {
      const got = Math.max(1, Math.round(amount * share));
      game.stores[material] = (game.stores[material] ?? 0) + got;
      parts.push(`${got} ${material}`);
    }
  }
  if (grant.torpedoes) {
    const got = Math.max(1, Math.round(grant.torpedoes * share));
    game.ship.torpedoes = Math.min(game.ship.maxTorpedoes ?? Infinity,
      (game.ship.torpedoes ?? 0) + got);
    parts.push(`${got} torpedoes`);
  }
  if (grant.xp) {
    const got = Math.round(grant.xp * share);
    game.awardXP?.(got, { silent: true });
    parts.push(`${got} experience out of it`);
  }
  if (grant.standing) {
    game.earnReputation?.('mission_complete');
    parts.push('and we look better for it');
  }
  if (grant.heal) {
    for (const officer of game.crew?.officers ?? []) {
      if (officer.injured) officer.heal?.(0.5);
    }
    for (const person of game.dutyRoster ?? []) {
      if (person.state === 'recovering') person.state = 'aboard';
    }
    parts.push('the injured are back on their feet');
  }

  return parts.length ? parts.join(', ') + '.' : 'Nothing to report.';
}

/**
 * What having the right specialist aboard is worth at a bridge station.
 *
 * A cartographer does not fire the phasers, but a science officer with a
 * sensor analyst and a xenobiologist backing them up gets more out of an
 * order than one working alone. Expressed as a multiplier on how long a
 * station's abilities hold, because duration is the one term a player can
 * actually watch, and because it does not touch the balance of damage.
 *
 * Only people who are ABOARD count. Somebody out on a detail, in sickbay, or
 * dead is not at the back of the bridge helping — which is the whole reason
 * losing one matters.
 */
export function specialistBonusFor(game, station) {
  if (!game || !station) return 1;
  const helping = (game.dutyRoster ?? []).filter(
    (p) => p.state === 'aboard' && p.station === station,
  ).length;
  // A quarter more per specialist, and never more than half again: a station
  // with three of them is well supported, not twice the ship.
  return 1 + Math.min(0.5, helping * 0.25);
}
