// Away teams.
//
// You pick who beams down. They can be hurt, and they can die, and the ones
// who die are the ones you sent. The captain may go personally, which is
// better for the roll and considerably worse if it goes wrong.

import { emit } from '../core/events.js';

export const HAZARD_LEVEL = {
  routine: { id: 'routine', label: 'Routine', injury: 0.04, death: 0.004 },
  elevated: { id: 'elevated', label: 'Elevated', injury: 0.14, death: 0.02 },
  dangerous: { id: 'dangerous', label: 'Dangerous', injury: 0.28, death: 0.06 },
  extreme: { id: 'extreme', label: 'Extreme', injury: 0.45, death: 0.14 },
};

/** Which trait a check leans on. */
export const CHECK_TYPES = {
  science: { label: 'Science', stations: ['science'], trait: 'expertise' },
  medical: { label: 'Medical', stations: ['medical'], trait: 'expertise' },
  engineering: { label: 'Engineering', stations: ['engineering'], trait: 'expertise' },
  combat: { label: 'Security', stations: ['tactical'], trait: 'daring' },
  diplomacy: { label: 'Diplomacy', stations: ['first_officer', 'comms'], trait: 'candor' },
  stealth: { label: 'Stealth', stations: ['tactical', 'helm'], trait: 'daring' },
};

export class AwayTeam {
  /**
   * @param {Officer[]} members
   * @param {boolean} captainLeads
   */
  constructor(members, captainLeads = false) {
    this.members = members.filter((o) => o.available);
    this.captainLeads = captainLeads;
    this.security = 4; // redshirts; they die first, and it matters
    this.casualties = [];
  }

  get size() { return this.members.length + this.security; }

  /** Best relevant officer for a check type. */
  bestFor(checkType) {
    const spec = CHECK_TYPES[checkType];
    if (!spec) return this.members[0];
    const onSpec = this.members.filter((o) => spec.stations.includes(o.station));
    const pool = onSpec.length ? onSpec : this.members;
    return pool.reduce((best, o) =>
      (o[spec.trait] > (best?.[spec.trait] ?? -1) ? o : best), null);
  }

  /**
   * Resolve a skill check.
   * @param {RNG} rng
   * @param {string} checkType
   * @param {object} opts { difficulty 0..1, hazard, captainBonus }
   * @returns {object} { success, margin, officer, injured, killed, text }
   */
  check(rng, checkType, { difficulty = 0.5, hazard = 'elevated', captainBonus = 0 } = {}) {
    const spec = CHECK_TYPES[checkType] ?? CHECK_TYPES.science;
    const officer = this.bestFor(checkType);
    const skill = officer ? officer[spec.trait] / 100 : 0.4;

    // Captain's presence helps, and exposes them.
    const bonus = captainBonus + (this.captainLeads ? 0.1 : 0);
    const roll = rng.float();
    const target = Math.max(0.05, Math.min(0.95, skill + bonus - difficulty + 0.35));
    const success = roll < target;
    const margin = target - roll;

    const level = HAZARD_LEVEL[hazard] ?? HAZARD_LEVEL.elevated;
    // Failure is more dangerous than success, but success is not free.
    const dangerScale = success ? 0.4 : 1.6;

    const result = { success, margin, officer, injured: null, killed: null, securityLost: 0 };

    // Security personnel absorb the first casualties.
    if (rng.chance(level.death * dangerScale) && this.security > 0) {
      this.security--;
      result.securityLost = 1;
      this.casualties.push({ name: 'Security crewman', killed: true });
      emit('away:security-lost', { checkType });
    } else if (officer) {
      if (rng.chance(level.death * dangerScale * 0.5)) {
        officer.kill(`killed on an away mission (${spec.label.toLowerCase()})`);
        result.killed = officer;
        this.casualties.push({ name: officer.name, killed: true });
        this.members = this.members.filter((o) => o.alive);
      } else if (rng.chance(level.injury * dangerScale)) {
        officer.injure(rng.range(0.3, 0.9));
        result.injured = officer;
        this.casualties.push({ name: officer.name, injured: true });
      }
    }

    // The captain is not exempt.
    if (this.captainLeads && rng.chance(level.death * dangerScale * 0.35)) {
      result.captainWounded = true;
    }

    result.text = buildCheckText(spec, result, success);
    emit('away:check', result);
    return result;
  }

  save() {
    return {
      members: this.members.map((o) => o.name),
      captainLeads: this.captainLeads,
      security: this.security,
      casualties: this.casualties,
    };
  }
}

function buildCheckText(spec, result, success) {
  const who = result.officer ? result.officer.name : 'The team';
  if (result.killed) {
    return `${who} is down. ${success ? 'The work is done, but' : 'It failed, and'} we are bringing a body back.`;
  }
  if (result.injured) {
    return `${who} is hurt — ${success ? 'they finished the job first' : 'and we got nothing for it'}.`;
  }
  if (result.securityLost) {
    return `We lost a crewman. ${success ? 'The objective is secure.' : 'And we still failed.'}`;
  }
  return success
    ? `${who} handled it. ${spec.label} objective complete.`
    : `${who} could not make it work. We are coming back empty.`;
}

/** Standard away mission templates used by episodes and encounters. */
export const AWAY_TEMPLATES = {
  derelict_search: {
    id: 'derelict_search', title: 'Board the derelict', hazard: 'dangerous',
    steps: [
      { check: 'engineering', difficulty: 0.45, text: 'Restore enough power to read the logs.' },
      { check: 'science', difficulty: 0.5, text: 'Determine what killed the crew.' },
      { check: 'combat', difficulty: 0.55, text: 'Whatever it was is still aboard.' },
    ],
  },
  colony_rescue: {
    id: 'colony_rescue', title: 'Evacuate the colony', hazard: 'elevated',
    steps: [
      { check: 'medical', difficulty: 0.4, text: 'Triage the wounded before transport.' },
      { check: 'engineering', difficulty: 0.5, text: 'Get the shelter’s shield generator running.' },
    ],
  },
  diplomatic_landing: {
    id: 'diplomatic_landing', title: 'Beam down to the capital', hazard: 'routine',
    steps: [
      { check: 'diplomacy', difficulty: 0.5, text: 'Open the discussion without insulting anyone.' },
      { check: 'science', difficulty: 0.45, text: 'Verify their claims about the resource survey.' },
    ],
  },
  covert_landing: {
    id: 'covert_landing', title: 'Covert survey', hazard: 'dangerous',
    steps: [
      { check: 'stealth', difficulty: 0.55, text: 'Reach the site without being observed.' },
      { check: 'science', difficulty: 0.5, text: 'Take the readings.' },
      { check: 'stealth', difficulty: 0.6, text: 'Get back to the beam-out point.' },
    ],
  },
};
