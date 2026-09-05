// Away teams.
//
// You pick who beams down. Outcomes come from capability against difficulty
// modifiers apply, officers contribute their own expertise, and the result is
// shown as arithmetic the player can audit. People can be hurt, and people can
// die, and the ones who die are the ones you sent.

import { emit } from '../core/events.js';
import { resolve, formatResolution, describeDifficulty, DIFFICULTY as DC } from '../rules/resolve.js';

/**
 * What a landing party costs, including the hours.
 *
 * `hours` is how long the party is down, and it is what a landing party cost
 * for the first time. Thirty-two diplomatic landings at Vulcan back to back
 * moved the stardate from 4523.3 to 4523.3 and paid 190 experience — the only
 * free action in a game where a repair costs most of a day, docking costs two,
 * and `surveyFeature` twenty lines away says in its own comment that each
 * feature resolves once.
 *
 * Scaled by hazard, because how dangerous a place is and how long you are
 * exposed to it are the same question asked twice. A routine landing is an
 * afternoon; an evacuation is a long day; boarding a derelict with something
 * still aboard is two watches.
 */
export const HAZARD_LEVEL = {
  routine: { id: 'routine', label: 'Routine', injury: 0.04, death: 0.004, dc: DC.easy, hours: 5 },
  elevated: { id: 'elevated', label: 'Elevated', injury: 0.14, death: 0.02, dc: DC.moderate, hours: 11 },
  dangerous: { id: 'dangerous', label: 'Dangerous', injury: 0.28, death: 0.06, dc: DC.hard, hours: 19 },
  extreme: { id: 'extreme', label: 'Extreme', injury: 0.45, death: 0.14, dc: DC.formidable, hours: 30 },
};

/**
 * How long a template's party is away, in commission hours.
 *
 * The hazard level decides it, except where the fiction will not have it. A
 * boarding action is `extreme` and happens inside a battle, at weapons range,
 * against a ship that is still under way — a day and a quarter cannot pass
 * while it does. It is minutes, and it says so here rather than quietly
 * inheriting a number that would put the enemy in another sector.
 */
export function awayHours(template) {
  if (template?.hours != null) return template.hours;
  return HAZARD_LEVEL[template?.hazard]?.hours ?? HAZARD_LEVEL.elevated.hours;
}

/**
 * Check types map to a captain ability and to the bridge stations whose
 * officers are competent at them.
 */
export const CHECK_TYPES = {
  science: { label: 'Science', ability: 'science', stations: ['science'], trait: 'expertise' },
  medical: { label: 'Medicine', ability: 'medicine', stations: ['medical'], trait: 'expertise' },
  engineering: { label: 'Engineering', ability: 'engineering', stations: ['engineering'], trait: 'expertise' },
  combat: { label: 'Security', ability: 'tactics', stations: ['tactical'], trait: 'daring' },
  diplomacy: { label: 'Diplomacy', ability: 'diplomacy', stations: ['first_officer', 'comms'], trait: 'candor' },
  stealth: { label: 'Stealth', ability: 'tactics', stations: ['tactical', 'helm'], trait: 'daring' },
  command: { label: 'Command', ability: 'command', stations: ['first_officer'], trait: 'discipline' },
};

export class AwayTeam {
  /**
   * @param {Officer[]} members
   * @param {object} opts { captainLeads, character, difficulty, security }
   */
  constructor(members, opts = {}) {
    this.members = members.filter((o) => o.available);
    this.captainLeads = !!opts.captainLeads;
    this.character = opts.character ?? null;
    this.difficulty = opts.difficulty ?? null;
    this.security = opts.security ?? 4;   // they die first, and it matters
    // "A Name They Know — civilians will risk themselves for you." People who
    // know the ship turn out to help, and a landing party with the locals
    // alongside is a different party. Set by the caller, which is the only
    // place that knows whether there are any locals to turn out.
    this.locals = opts.locals ?? 0;
    // What the ship behind them is doing, for the one trait that asks.
    this.hullPct = opts.hullPct ?? 1;
    /** Fires burning and a core breaching, for `pressure()`. */
    this.fires = opts.fires ?? 0;
    this.breaching = !!opts.breaching;
    this.casualties = [];
    this.rolls = [];                      // full audit trail for the UI
  }

  get size() { return this.members.length + this.security + (this.captainLeads ? 1 : 0); }

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
   * Build the full modifier for a check, itemised so the UI can show where
   * every point came from.
   */
  modifierFor(checkType, situational = 0) {
    const spec = CHECK_TYPES[checkType] ?? CHECK_TYPES.science;
    const officer = this.bestFor(checkType);
    const parts = [];

    let total = 0;
    if (this.character) {
      const abilityMod = this.character.mod(spec.ability);
      total += abilityMod;
      parts.push({ source: `${spec.label} ability`, value: abilityMod });
      if (this.character.isProficient(spec.ability)) {
        const prof = this.character.proficiencyBonus;
        total += prof;
        parts.push({ source: 'proficiency', value: prof });
      }
      if (this.captainLeads) {
        total += 2;
        parts.push({ source: 'captain leading', value: 2 });
      }
      // "Haunted — you have lost a ship before. +3 to all others." Itemised
      // like everything else in this list, because the whole point of `parts`
      // is that a captain can see which of his own history produced the number.
      const compensation = this.character.compensationOn?.(spec.ability) ?? 0;
      if (compensation) {
        total += compensation;
        parts.push({ source: 'a ship you lost before', value: compensation });
      }
    }

    if (officer) {
      // An expert officer is worth up to +5 on their own speciality.
      const officerBonus = Math.round((officer[spec.trait] - 50) / 12);
      total += officerBonus;
      parts.push({ source: officer.name, value: officerBonus });
      if (officer.injured) {
        total -= 2;
        parts.push({ source: 'wounded', value: -2 });
      }
    }

    if (this.locals) {
      total += this.locals;
      parts.push({ source: 'locals lending a hand', value: this.locals });
    }

    // A larger security detail helps with anything physical.
    if ((checkType === 'combat' || checkType === 'stealth') && this.security > 0) {
      const detail = Math.min(3, Math.floor(this.security / 2));
      total += detail;
      parts.push({ source: 'security detail', value: detail });
    }

    if (situational) {
      total += situational;
      parts.push({ source: 'circumstance', value: situational });
    }
    // The state of the ship they came off.
    //
    // `situational` has been a documented parameter of this method and of
    // `check` since both were written, plumbed all the way to that itemised
    // line above — and NO CALLER anywhere ever supplied one. The same shape as
    // `resolve()`'s `disadvantage` argument, which had no caller until two
    // changes ago.
    //
    // Three traits are about circumstance and none of them had one to work on:
    // "Cool Under Fire — no penalty from a breaching core, hull fires, or being
    // outnumbered" removed a penalty that did not exist. A landing party works
    // worse while the ship above it is burning, and the away team already knows
    // the ship's state because `desperate()` needed `hullPct`.
    const pressure = this.pressure();
    if (pressure) {
      total += pressure;
      parts.push({ source: 'the ship above you', value: pressure });
    }

    return { total, parts, officer, spec };
  }

  /**
   * Resolve one check.
   * @returns {object} the roll, the consequences, and readable prose
   */
  check(rng, checkType, { dc = null, hazard = 'elevated', situational = 0, label = '' } = {}) {
    const level = HAZARD_LEVEL[hazard] ?? HAZARD_LEVEL.elevated;
    const spec = CHECK_TYPES[checkType] ?? CHECK_TYPES.science;
    const { total: modifier, parts, officer } = this.modifierFor(checkType, situational);

    let targetDC = dc ?? level.dc;
    if (this.difficulty) targetDC = this.difficulty.dc(targetDC);

    // Three ways to have the better of a check, and only the first of them
    // had ever been asked. See RESEARCH.md §40.
    //
    //   advantageOn          Vulcan, Andorian, Tellarite, Betazoid — read
    //                        through `hasAdvantageOn` since it was written.
    //   desperateAdvantage   Bajoran, "Resistance Veteran — advantage on checks
    //                        made while your ship is below half hull". The team
    //                        had no idea what the ship's hull was.
    //   switchableAdvantage  Human/Vulcan, "Two Disciplines — choose Logic or
    //                        Instinct before any check". Nothing stored a
    //                        choice, so neither discipline was ever live.
    const advantage = (this.character?.hasAdvantageOn(spec.ability) ?? false)
      || this.desperate()
      || this.disciplineCovers(spec.ability);
    // And one way to have the worse of it, which had never been asked at all.
    //
    // `resolve()` has documented a `disadvantage` argument since it was
    // written and no caller anywhere in the game had ever passed one — the
    // whole downside half of the resolution system was unreachable. "Reckless —
    // your landing parties pay for it" is its first user: an away mission is
    // the one thing that resolves a check and the one place a captain is
    // personally at risk, which is this game's saving throw.
    // Only where the check IS a saving throw. A saving throw is a reaction to
    // something dangerous, not every skilled action, and applying it to routine
    // scans as well took away-team success from 68.3% to 49.5% and casualties
    // from 4.5% to 7.2% — measured over 400 checks, and too much for a
    // complication a player takes alongside one advantage. At `dangerous` and
    // `extreme` it is the same trade against the same odds it was written for.
    // Three ways to have the WORSE of a check, where until this file's last
    // change there were none at all.
    //
    //   hazardDisadvantage      Reckless, and only against a real hazard.
    //   panicBelowQuarter       Haunted, "disadvantage on Command checks below
    //                           25% hull" — the exact mirror of the Bajoran's
    //                           `desperateAdvantage` above, and the same
    //                           `hullPct` that one needed.
    //   diplomacyDisadvantage   Notorious. A captain hostiles are afraid of is
    //                           not one they negotiate comfortably with.
    const disadvantage = (!!this.character?.mechanic('hazardDisadvantage')
        && (hazard === 'dangerous' || hazard === 'extreme'))
      || this.panicking(spec.ability)
      || (spec.ability === 'diplomacy'
        && !!this.character?.mechanic('diplomacyDisadvantage'));
    // Training damps the swing rather than only shifting it. A veteran is not
    // merely better on average; they are more *consistent*, which is the thing
    // a flat die could never express and the reason this is not a d20 any more.
    const steady = this.character?.hasFeat('tactical_genius') ? 0.5
      : Math.min(0.45, Math.max(0, (modifier - 2) * 0.06));

    const roll = resolve(rng, {
      capability: modifier,
      difficulty: targetDC,
      advantage,
      disadvantage,
      steady,
      luck: this.difficulty?.luck ?? 0,
      label: label || spec.label,
    });

    const record = { ...roll, checkType, parts, officer: officer?.name ?? null };
    this.rolls.push(record);

    const result = {
      ...roll, checkType, spec, parts, officer,
      injured: null, killed: null, securityLost: 0,
      formatted: formatResolution(roll, spec.label),
      difficultyLabel: describeDifficulty(targetDC),
    };

    // Consequences scale with how badly it went, not merely whether it failed.
    // A critical failure is dangerous; a comfortable success is nearly free.
    const dangerScale = roll.criticalFailure ? 2.5
      : !roll.success ? 1.6
      : roll.criticalSuccess ? 0.1
      : roll.degree >= 1 ? 0.25
      : 0.5;

    let deathChance = level.death * dangerScale;
    let injuryChance = level.injury * dangerScale;

    // Medicine aboard, and anything that reduces casualties, applies here.
    const reduction = this.character?.mechanic('casualtyReduction') ?? 0;
    deathChance *= (1 - reduction);
    injuryChance *= (1 - reduction);
    if (this.difficulty) {
      const scale = this.difficulty.scale('crewLossScale');
      deathChance *= scale;
      injuryChance *= scale;
    }
    // Difficulties below Ensign do not kill named officers at all.
    const lethal = this.difficulty ? this.difficulty.permadeath : true;

    if (rng.chance(deathChance) && this.security > 0) {
      this.security--;
      result.securityLost = 1;
      this.casualties.push({ name: 'Security crewman', killed: true });
      emit('away:security-lost', { checkType });
    } else if (officer) {
      if (lethal && rng.chance(deathChance * 0.5)) {
        officer.kill(`killed on an away mission (${spec.label.toLowerCase()})`);
        result.killed = officer;
        this.casualties.push({ name: officer.name, killed: true });
        this.members = this.members.filter((o) => o.alive);
      } else if (rng.chance(injuryChance)) {
        // The detail is between the officers and whatever is down there, and
        // until now it was only ever between them and the rarest outcome.
        //
        // The branch above absorbs a DEATH into the security detail. Nothing
        // absorbed an injury, and injuries are the common case: measured over
        // sixty landings there were nine casualties, every one of them a named
        // officer, and not one of the four security crewmen on every single
        // team was so much as scratched. The senior staff were the safest
        // people on the away team's roster and the redshirts were the safest
        // people on the ship.
        //
        // Half, not all. Letting the detail absorb every injury it could
        // measured just as wrong in the other direction: all nine casualties
        // became security crewmen, no named officer was ever hurt again, and
        // sickbay, `back_to_duty` and the whole injury system went quiet. Four
        // crewmen and two or three checks a mission means a detail that always
        // interposes is a detail that never runs out.
        //
        // So bringing security halves the chance that the casualty is one of
        // your officers. That is a number a captain can act on, and it leaves
        // the risk that makes the choice matter.
        if (this.security > 0 && rng.chance(0.5)) {
          this.security--;
          result.securityHurt = 1;
          this.casualties.push({ name: 'Security crewman', injured: true });
          emit('away:security-hurt', { checkType });
        } else {
          officer.injure(rng.range(0.3, 0.9));
          result.injured = officer;
          this.casualties.push({ name: officer.name, injured: true });
        }
      }
    }

    if (this.captainLeads && lethal && rng.chance(deathChance * 0.35)) {
      result.captainWounded = true;
      // Recorded like any other casualty, and the +2 for a captain leading
      // stops here: they are being carried, not leading. This was set and read
      // by nothing — no casualty, no line, no consequence — so the risk half of
      // leading from the front cost exactly nothing.
      this.casualties.push({ name: this.character?.name ?? 'The captain', injured: true, captain: true });
      this.captainLeads = false;
    }

    result.text = buildCheckText(spec, result, roll);
    emit('away:check', result);
    return result;
  }

  /**
   * Is the ship in trouble behind us?
   *
   * "Resistance Veteran — Advantage on checks made while your ship is below
   * half hull." The away team is the only thing that resolves a check and it
   * had no reference to the ship at all, so the one fact the trait depends on
   * was not in the room. `hullPct` is passed by `Game.buildAwayTeam`, which is
   * the only caller that knows it.
   */
  desperate() {
    if (!this.character?.mechanic('desperateAdvantage')) return false;
    return (this.hullPct ?? 1) < 0.5;
  }

  /**
   * What the ship's condition costs a landing party, as a check modifier.
   *
   * Small and countable rather than a curve: a fire is a fire and the party can
   * hear about it. Capped, because at some point the ship is either coming back
   * for them or it is not, and past that the number stops meaning anything.
   *
   * "Cool Under Fire" zeroes it, which is the whole of that trait.
   *
   * NOT outnumbered, and that is deliberate. Away missions are refused in
   * combat — "Not while we are under fire, Captain" — so being outnumbered is
   * not a circumstance a landing party can be in, and wiring it would mean
   * inventing somewhere for it to happen. The two traits that name it stay in
   * the count with this as the reason. See RESEARCH §70.
   */
  pressure() {
    if (this.character?.mechanic('ignorePressure')) return 0;
    const fires = Math.min(3, this.fires ?? 0);
    return -(fires + ((this.breaching ?? false) ? 2 : 0));
  }

  /**
   * "Haunted — disadvantage on Command checks below 25% hull."
   *
   * The mirror of `desperate()` above and deliberately built the same way:
   * the away team is the only thing that resolves a check, and `hullPct` is
   * handed in by `Game.buildAwayTeam`, the only caller that knows it.
   */
  panicking(abilityId) {
    if (abilityId !== 'command') return false;
    if (!this.character?.mechanic('panicBelowQuarter')) return false;
    return (this.hullPct ?? 1) < 0.25;
  }

  /**
   * "Two Disciplines — choose Logic or Instinct before any check."
   *
   * The choice is a real one and it is stored on the character, so it survives
   * a save and can be changed between checks. It covers exactly one of the
   * abilities the mechanic lists; a captain who has not chosen gets the first.
   */
  disciplineCovers(abilityId) {
    const list = this.character?.mechanic('switchableAdvantage');
    if (!Array.isArray(list) || !list.length) return false;
    const chosen = list.includes(this.character.discipline)
      ? this.character.discipline : list[0];
    return chosen === abilityId;
  }

  /** Spend the species reroll, if the character has one left. */
  canReroll() {
    return (this.character?.rerollsRemaining ?? 0) > 0;
  }

  /**
   * "Once per away mission, reroll a failed check."
   *
   * `canReroll` has existed since the away team did and was called from
   * nowhere; `rerollsRemaining` was set by `Character.refresh` — which combat
   * calls, not the away system — and decremented by nothing. So the Human
   * trait, on the species most captains are, did nothing at all.
   *
   * Spent automatically, because an away mission resolves as one batch: there
   * is no moment between two checks at which the game could ask. The trait
   * says once per mission and takes the first failure, which is the only
   * reading available to code that cannot stop and ask.
   */
  rerollIfPossible(rng, checkType, opts, result) {
    if (result.success || !this.canReroll()) return result;
    this.character.rerollsRemaining -= 1;
    const again = this.check(rng, checkType, opts);
    again.rerolled = true;
    return again;
  }

  /** A new landing party. The trait says per MISSION, so it refreshes here. */
  beginMission() {
    if (this.character) {
      this.character.rerollsRemaining = this.character.mechanic('rerollPerMission') ?? 0;
    }
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

function buildCheckText(spec, result, roll) {
  const who = result.officer ? result.officer.name : 'The team';

  if (roll.criticalSuccess) {
    return `${who} does it perfectly — better than the plan called for.`;
  }
  if (roll.criticalFailure) {
    if (result.killed) return `It goes wrong at once. ${result.killed.name} does not come back.`;
    if (result.securityLost) return `It goes badly wrong. We are carrying someone out.`;
    return `${who} makes it worse. Whatever the plan was, it is gone.`;
  }
  if (result.killed) {
    return `${who} is down. ${roll.success ? 'The work is done, but' : 'It failed, and'} we are bringing a body back.`;
  }
  if (result.injured) {
    return `${who} is hurt — ${roll.success ? 'they finished the job first' : 'and we got nothing for it'}.`;
  }
  if (result.securityLost) {
    return `We lost a crewman. ${roll.success ? 'The objective is secure.' : 'And we still failed.'}`;
  }
  if (roll.success) {
    return roll.degree >= 1
      ? `${who} handles it cleanly. ${spec.label} objective complete.`
      : `${who} gets there, barely. ${spec.label} objective complete.`;
  }
  return roll.degree === -1
    ? `${who} very nearly has it, and then does not.`
    : `${who} could not make it work. We are coming back empty.`;
}

/** Standard away mission templates used by episodes and encounters. */
export const AWAY_TEMPLATES = {
  derelict_search: {
    id: 'derelict_search', title: 'Board the derelict', hazard: 'dangerous',
    steps: [
      { check: 'engineering', dc: DC.moderate, text: 'Restore enough power to read the logs.' },
      { check: 'science', dc: DC.hard, text: 'Determine what killed the crew.' },
      { check: 'combat', dc: DC.hard, text: 'Whatever it was is still aboard.' },
    ],
  },
  colony_rescue: {
    id: 'colony_rescue', title: 'Evacuate the colony', hazard: 'elevated',
    steps: [
      { check: 'medical', dc: DC.moderate, text: 'Triage the wounded before transport.' },
      { check: 'engineering', dc: DC.hard, text: 'Get the shelter’s shield generator running.' },
    ],
  },
  diplomatic_landing: {
    id: 'diplomatic_landing', title: 'Beam down to the capital', hazard: 'routine',
    steps: [
      { check: 'diplomacy', dc: DC.hard, text: 'Open the discussion without insulting anyone.' },
      { check: 'science', dc: DC.moderate, text: 'Verify their claims about the resource survey.' },
    ],
  },
  covert_landing: {
    id: 'covert_landing', title: 'Covert survey', hazard: 'dangerous',
    steps: [
      { check: 'stealth', dc: DC.hard, text: 'Reach the site without being observed.' },
      { check: 'science', dc: DC.moderate, text: 'Take the readings.' },
      { check: 'stealth', dc: DC.very_hard, text: 'Get back to the beam-out point.' },
    ],
  },
  boarding_action: {
    // Minutes, not the day and a quarter `extreme` would otherwise buy: this
    // one happens at weapons range in the middle of a fight.
    id: 'boarding_action', title: 'Board the hostile', hazard: 'extreme', hours: 0.6,
    steps: [
      { check: 'engineering', dc: DC.hard, text: 'Beam through their shields.' },
      { check: 'combat', dc: DC.very_hard, text: 'Take the bridge.' },
      { check: 'command', dc: DC.hard, text: 'Persuade the survivors to stand down.' },
    ],
  },
};
