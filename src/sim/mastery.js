// Working her up: what a crew learns about one particular ship.
//
// The grounding is in docs/RESEARCH.md §20. Decker's argument for keeping the
// Enterprise away from Kirk in The Motion Picture is not seniority — it is that
// the ship has been refit, so Kirk's familiarity with her is worth nothing.
// That is a mechanic stated out loud: an officer accumulates something real by
// flying a particular vessel, it is measured against that vessel, and changing
// the vessel spends it.
//
// The other direction is the same film's first act. Scott asked for a proper
// shakedown, Kirk sailed in twelve hours anyway, and the ship gave him an
// unbalanced warp drive, a wormhole, and phasers that cut out on their own. A
// ship that has not been worked up is not the same ship as one that has.
//
// Tier zero is therefore NOT the ship as her specification says: a hull whose
// crew have not worked her up runs under her own numbers, and the first tier is
// called Shakedown complete because clearing it is what a shakedown is for.
// This was decided deliberately after the first version shipped additive-only.
// A ship that is merely less good than she will become is not the same thing as
// a ship that is worse than she should be, and the second is the arc.

import { ADDITIVE_MODS } from './ship.js';
import { getShipClass } from '../world/ships.data.js';

/**
 * What a hull costs you before her crew have worked her up.
 *
 * Every one of these is something the film shows going wrong on a ship that
 * sailed without a proper shakedown: the drive is out of balance so she does
 * not make her speed, the phasers run through the engines so the gunnery is
 * unreliable, and a crew who have never run a casualty on this hull are slow
 * at it. Cleared entirely by the first tier — this is the opening of a
 * commission, not a handicap carried through it.
 *
 * Deliberately NOT modelled as the phasers cutting out altogether. A discrete
 * failure at a random moment is a different and much crueller mechanic than a
 * ship that is simply not yet at her best, and the second is what a shakedown
 * actually feels like.
 */
export const SHAKEDOWN = {
  name: 'Not yet worked up',
  mods: { impulse: -0.06, accuracy: -0.05, repairRate: -0.1, shieldRegen: -0.08 },
  text: 'She is straight out of the yard and nobody aboard has her measure yet. '
    + 'The drive will not quite make her numbers, the batteries are walking their '
    + 'shot in, and damage control have never run a casualty on this hull.',
};

/**
 * The five tiers, and what each one is the crew having learned.
 *
 * Thresholds are in mastery points against the 1826-day commission: a captain
 * who flies the whole five years and fights reaches the last tier with time to
 * use it, and one who spends the commission docked does not.
 */
export const TIERS = [
  {
    tier: 1, at: 120, name: 'Shakedown complete',
    mods: { hullMax: 0.04 },
    text: 'The yard work is settled and the seams have stopped talking. The hull takes a hit better.',
  },
  {
    tier: 2, at: 340, name: 'Engine room knows her',
    mods: { impulse: 0.05, repairRate: 0.08 },
    text: 'Damage control has run the same casualty on this hull enough times to be quick about it.',
  },
  {
    tier: 3, at: 700, name: 'She answers the helm',
    mods: { turn: 0.07, defense: 0.04 },
    text: 'The helm has learned where she is slow and stops fighting her.',
  },
  {
    tier: 4, at: 1150, name: 'Gunnery has the range',
    mods: { accuracy: 0.05, critChance: 0.03 },
    text: 'The batteries know their own fall of shot on this ship and do not need to walk it in.',
  },
  {
    tier: 5, at: 1700, name: 'Her own ship',
    mods: { damageResist: 0.04 },
    text: 'Five years in one hull. The crew fly her the way an engineer would, and a starship trait is yours to choose.',
  },
];

/** The highest tier reached at a given number of points. */
export function tierAt(points) {
  let t = 0;
  for (const step of TIERS) if (points >= step.at) t = step.tier;
  return t;
}

/** Points still wanted for the next tier, or null at the top. */
export function nextTierAt(points) {
  for (const step of TIERS) if (points < step.at) return step;
  return null;
}

/**
 * Starship traits, unlocked at the fifth tier.
 *
 * One is slotted at a time. This is where the decision lives: the four tiers
 * below are the crew learning the ship, which is not a choice anybody makes,
 * and a track with no choice in it is a bar.
 *
 * Each is a doctrine a crew that knows one hull perfectly could actually
 * commit to, not a grab-bag: what you gain, you gain by giving something up.
 */
export const TRAITS = {
  running_start: {
    id: 'running_start', name: 'Running Start',
    mods: { impulse: 0.12, turn: 0.1, hullMax: -0.04 },
    text: 'Weight out of her and the plates run light: faster and handier, and she takes a hit worse.',
  },
  layered_screens: {
    id: 'layered_screens', name: 'Layered Screens',
    mods: { shieldRegen: 0.22, shieldMax: 0.08, impulse: -0.06 },
    text: 'The grid is tuned to the shields at the expense of the drive: the screens come back fast and she is slower for it.',
  },
  point_blank_doctrine: {
    id: 'point_blank_doctrine', name: 'Point-Blank Doctrine',
    mods: { critSeverity: 0.2, beamDamage: 0.08, defense: -0.05 },
    text: 'Close and hold: the gunnery hurts far more, and a ship that will not break off is easier to hit.',
  },
};

export const TRAIT_LIST = Object.values(TRAITS);

/**
 * What each thing that happens is worth, in points.
 *
 * These are the things that actually teach a crew a ship: distance under way,
 * fights, and missions seen through. Sitting at a starbase teaches nobody
 * anything, which is why docked time is not on this list.
 *
 * A voyage is measured in LIGHT YEARS and not in hours, which is the second
 * version of this. Crediting hours meant the slower you flew the more your
 * crew learned, because `travelHours` goes as the inverse cube of the warp
 * factor: the same journey at warp 4 takes eight times as long as at warp 8
 * and paid eight times as much. Measured over all 1,560 courses in the charts,
 * a mean voyage was worth 335 points at warp 4 and 40 at warp 8 — so the way
 * to master your ship was to crawl. What a crew learns from a voyage is the
 * voyage, not how long the captain dawdled over it.
 *
 * The rates are set so a mean voyage of 48.9 light years, with a battle and an
 * episode every third one, puts the shakedown behind you in about eight
 * voyages and the top of the track at around a hundred and ten. Before this
 * the whole track — five tiers, "five years in one hull", and the starship
 * trait that is the entire decision in it — was reachable in FIFTEEN.
 */
export const EARNINGS = {
  /** Per light year under way. Warp-independent, unlike the hours. */
  lightYear: 0.16,
  /** Per battle fought, whatever the outcome — losing teaches too. */
  battle: 8,
  /** Per episode finished. */
  mission: 15,
};

export class ShipMastery {
  constructor(classId) {
    this.classId = classId ?? null;
    /** classId -> points. A map because mastery is a property of the class. */
    this.points = {};
    /** classId -> the trait chosen for that hull, once the fifth tier is up. */
    this.traits = {};
  }

  get current() { return this.points[this.classId] ?? 0; }

  /**
   * `refitOf` is declared on the Constitution Refit, pointing at the
   * Constitution, and is read by nothing. It was wired here — half the parent
   * hull's mastery, on the argument that a refit is the same ship in the ways
   * that matter to the people who fly her — and the wiring was WRONG, twice
   * over.
   *
   * The game had already answered this question and answered it deliberately.
   * `tests/wiring.test.js` asserts that taking a new command starts at tier 0
   * with the shakedown penalty applied, under the heading "no shakedown on a
   * hull nobody has flown". And the promotion from a Constitution offers
   * exactly the Constitution Refit, so the two collide head-on rather than at
   * some edge.
   *
   * The fiction agrees with the test and not with the wiring: the one famous
   * refit in the franchise is the case where a veteran crew had to learn their
   * own ship again from the beginning, which is most of what that story is
   * about.
   *
   * So `refitOf` stays unread, on purpose, and this note is here so the next
   * sweep finds the reason instead of the field. A cosmetic use — naming the
   * parent hull in the yard report — would be honest and is not worth a
   * mechanic.
   */

  get tier() { return tierAt(this.current); }

  /** The tiers actually earned, worst-first. */
  get earned() { return TIERS.filter((t) => this.current >= t.at); }

  /** What is next, and how far off it is. */
  get next() {
    const step = nextTierAt(this.current);
    if (!step) return null;
    return { ...step, remaining: step.at - this.current };
  }

  /** The trait in the slot, or null — including when the slot is not open. */
  get trait() {
    if (this.tier < 5) return null;
    return TRAITS[this.traits[this.classId]] ?? null;
  }

  /** Whether a trait can be chosen at all yet. */
  get slotOpen() { return this.tier >= 5; }

  /**
   * Choose the trait for this hull.
   *
   * @returns {{ok: boolean, reason?: string, trait?: object}}
   */
  chooseTrait(id) {
    if (!this.slotOpen) {
      return { ok: false, reason: 'The crew do not know her well enough yet, Captain.' };
    }
    const trait = TRAITS[id];
    if (!trait) return { ok: false, reason: 'No such doctrine in the book.' };
    this.traits[this.classId] = trait.id;
    return { ok: true, trait };
  }

  /**
   * Credit something the crew learned from.
   *
   * @param {'lightYear'|'battle'|'mission'} kind
   * @param {number} count how many of them
   * @returns {{gained: number, tierUp: object|null}} the tier crossed, if any
   */
  award(kind, count = 1) {
    const rate = EARNINGS[kind];
    // A caller with a bad key, or a NaN count from a clock that has gone wrong,
    // must not turn the whole track into NaN — it is saved, and a NaN written
    // to disk never comes back.
    if (!rate || !Number.isFinite(count) || count <= 0) return { gained: 0, tierUp: null };
    const before = this.tier;
    const gained = rate * count;
    this.points[this.classId] = this.current + gained;
    const after = this.tier;
    return {
      gained,
      tierUp: after > before ? (TIERS.find((t) => t.tier === after) ?? null) : null,
    };
  }

  /** Combined modifiers for Ship.applyMods — tiers earned, plus the trait. */
  shipMods() {
    const mods = {};
    const add = (k, v) => {
      if (ADDITIVE_MODS.has(k)) mods[k] = (mods[k] ?? 0) + v;
      else mods[k] = (mods[k] ?? 1) * (1 + v);
    };
    // Below the first tier the ship is under her own specification. This is
    // the only place in the game that subtracts from a hull's own numbers, and
    // it is cleared the moment the shakedown is complete.
    if (this.tier < 1) {
      for (const [k, v] of Object.entries(SHAKEDOWN.mods)) add(k, v);
    }
    for (const step of this.earned) {
      for (const [k, v] of Object.entries(step.mods)) add(k, v);
    }
    // The trait folds in here rather than at the call site, for the reason the
    // loadout's set bonuses do: shipMods is the one place the ship is asked
    // what it is carrying, and a second answer would drift from this one.
    const trait = this.trait;
    if (trait) for (const [k, v] of Object.entries(trait.mods)) add(k, v);
    return mods;
  }

  /** What the crew would say about the hull, for the panel and the con. */
  report() {
    const cls = getShipClass(this.classId);
    return {
      classId: this.classId,
      className: cls?.name ?? this.classId,
      points: this.current,
      tier: this.tier,
      earned: this.earned,
      next: this.next,
      slotOpen: this.slotOpen,
      trait: this.trait,
      shakedown: this.tier < 1 ? SHAKEDOWN : null,
    };
  }

  save() { return { classId: this.classId, points: this.points, traits: this.traits }; }

  static load(data, classId) {
    const m = new ShipMastery(classId ?? data?.classId ?? null);
    if (!data) return m;
    // Same guard as `award`: a bad figure in the record is refused rather than
    // carried, because everything downstream of it is arithmetic.
    for (const [k, v] of Object.entries(data.points ?? {})) {
      if (Number.isFinite(v) && v >= 0) m.points[k] = v;
    }
    for (const [k, v] of Object.entries(data.traits ?? {})) {
      if (TRAITS[v]) m.traits[k] = v;
    }
    return m;
  }
}
