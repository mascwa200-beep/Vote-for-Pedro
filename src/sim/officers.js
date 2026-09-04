// Bridge officers: abilities on cooldowns, and opinions about your orders.
//
// The officer layer is where a crew stops being a stat block. An officer with
// low discipline and high candor will tell you an order is wrong, and a
// sufficiently bad order can be refused outright.

import { emit } from '../core/events.js';
import { STATIONS } from '../world/crews.data.js';

/**
 * Abilities are STO bridge officer powers in miniature: activated, on a
 * cooldown, with a duration and a set of modifiers.
 */
export const ABILITIES = {
  // --- Tactical ---
  attack_pattern_alpha: {
    id: 'attack_pattern_alpha', dept: 'tactical', rank: 2, name: 'Attack Pattern Alpha',
    order: 'Attack pattern alpha', cooldown: 45, duration: 20,
    mods: { damage: 1.35, critChance: 0.1, critSeverity: 0.25 },
    say: 'Attack pattern alpha, aye.',
  },
  fire_at_will: {
    id: 'fire_at_will', dept: 'tactical', rank: 1, name: 'Fire at Will',
    order: 'Fire at will', cooldown: 30, duration: 15,
    mods: { damage: 0.8 }, special: 'multitarget',
    say: 'Firing at will.',
  },
  torpedo_spread: {
    id: 'torpedo_spread', dept: 'tactical', rank: 2, name: 'Torpedo Spread',
    order: 'Full spread', cooldown: 30, duration: 0, special: 'spread',
    say: 'Full spread, ready.',
  },
  high_yield: {
    id: 'high_yield', dept: 'tactical', rank: 3, name: 'High Yield Torpedoes',
    order: 'High yield', cooldown: 40, duration: 12,
    mods: { torpedoDamage: 2.0 },
    say: 'High yield loaded.',
  },
  target_subsystems: {
    id: 'target_subsystems', dept: 'tactical', rank: 1, name: 'Target Subsystems',
    order: 'Target their subsystems', cooldown: 20, duration: 0, special: 'subsystem',
    say: 'Targeting scanners locked on their systems.',
  },

  // --- Engineering ---
  emergency_power_shields: {
    id: 'emergency_power_shields', dept: 'engineering', rank: 1, name: 'Emergency Power to Shields',
    order: 'Emergency power to shields', cooldown: 45, duration: 20,
    mods: { shieldRegen: 3.0, damageResist: 0.15 },
    say: 'Rerouting everything I can to the shields!',
  },
  emergency_power_weapons: {
    id: 'emergency_power_weapons', dept: 'engineering', rank: 1, name: 'Emergency Power to Weapons',
    order: 'Emergency power to weapons', cooldown: 45, duration: 20,
    mods: { damage: 1.3 },
    say: 'Weapons are drawing straight off the core.',
  },
  damage_control: {
    id: 'damage_control', dept: 'engineering', rank: 2, name: 'Damage Control Teams',
    order: 'Damage control teams', cooldown: 50, duration: 18,
    mods: { repairRate: 4.0 }, special: 'extinguish',
    say: 'Damage control parties away.',
  },
  eject_core: {
    id: 'eject_core', dept: 'engineering', rank: 3, name: 'Eject Warp Core',
    order: 'Eject the core', cooldown: 0, duration: 0, special: 'eject',
    // What the bridge thinks of the order. `risk` and `ethicalWeight` are the
    // two numbers `Officer.reactTo` has always read, and until now the only
    // one supplied was a `a.id === 'eject_core' ? 0.9 : 0.2` written at the
    // call site — so this was the single order in the game anybody could have
    // an opinion about, and even that opinion was thrown away unspoken.
    risk: 0.9,
    say: 'Ejecting the core!',
  },

  // --- Science ---
  scan_target: {
    id: 'scan_target', dept: 'science', rank: 1, name: 'Full Sensor Sweep',
    order: 'Scan them', cooldown: 15, duration: 0, special: 'scan',
    say: 'Running a full sweep.',
  },
  tachyon_sweep: {
    id: 'tachyon_sweep', dept: 'science', rank: 2, name: 'Tachyon Sweep',
    order: 'Tachyon sweep', cooldown: 40, duration: 0, special: 'detect_cloak',
    say: 'Flooding the area with tachyons.',
  },
  shield_harmonics: {
    id: 'shield_harmonics', dept: 'science', rank: 2, name: 'Rotate Shield Harmonics',
    order: 'Rotate shield harmonics', cooldown: 45, duration: 25,
    mods: { damageResist: 0.22 }, special: 'reset_adaptation',
    say: 'Rotating harmonics — that should confuse them.',
  },
  jam_sensors: {
    id: 'jam_sensors', dept: 'science', rank: 3, name: 'Jam Targeting Sensors',
    order: 'Jam their sensors', cooldown: 50, duration: 14, special: 'jam',
    say: 'Jamming their targeting scanners.',
  },
  polarize_hull: {
    id: 'polarize_hull', dept: 'science', rank: 1, name: 'Polarize Hull Plating',
    order: 'Polarize the hull', cooldown: 40, duration: 16,
    mods: { damageResist: 0.3 },
    say: 'Polarising hull plating.',
  },

  // --- Command / helm ---
  evasive_maneuvers: {
    id: 'evasive_maneuvers', dept: 'command', rank: 1, name: 'Evasive Manoeuvres',
    order: 'Evasive manoeuvres', cooldown: 30, duration: 15,
    mods: { defense: 1.8, turn: 1.4 }, special: 'evasive',
    say: 'Evasive, aye.',
  },
  brace_for_impact: {
    id: 'brace_for_impact', dept: 'command', rank: 1, name: 'Brace for Impact',
    order: 'All hands brace for impact', cooldown: 40, duration: 12,
    // No `special`. It carried one — 'brace' — that nothing anywhere read, and
    // the ability was fine without it: the damage resistance applies through
    // the generic mods path. A tag that means nothing is how `multitarget`
    // went unnoticed on Fire at Will, where the missing handler cost the
    // captain 20% of his gunnery for nothing. `tests/wiring.test.js` now fails
    // if any declared special has no handler, and this had to go for that to
    // be true.
    mods: { damageResist: 0.25 },
    say: 'All hands, brace for impact!',
  },
  rally_crew: {
    id: 'rally_crew', dept: 'command', rank: 2, name: 'Rally the Crew',
    order: 'Rally the crew', cooldown: 90, duration: 30,
    mods: { damage: 1.15, repairRate: 1.5, accuracy: 1.1 },
    say: 'You heard the captain!',
  },
  hold_formation: {
    // The only power in the game that speaks to an ally. Allies arrive on a
    // distress call and there has never been anything to say to them.
    id: 'hold_formation', dept: 'command', rank: 2, name: 'Hold Formation',
    order: 'Hold formation', cooldown: 50, duration: 20,
    mods: { defense: 1.15, accuracy: 1.1 }, special: 'formation',
    say: 'Signalling them to hold station on us.',
  },

  // --- Medical ---
  //
  // The first abilities in the game whose payoff is crew and casualties rather
  // than hull and shields, which is the test of whether the department was
  // worth having. See docs/RESEARCH.md §17.
  casualty_teams: {
    id: 'casualty_teams', dept: 'medical', rank: 1, name: 'Casualty Teams',
    order: 'Casualty teams to the decks', cooldown: 45, duration: 30,
    mods: { crewProtect: 0.35 },
    say: 'Casualty teams to every deck.',
  },
  stimulants: {
    id: 'stimulants', dept: 'medical', rank: 2, name: 'Stimulants',
    order: 'Break out the stimulants', cooldown: 60, duration: 20,
    // A doctor is being asked to put the crew on drugs to get another hour out
    // of them. A candid one says so first and then does it.
    ethicalWeight: 0.35,
    mods: { repairRate: 1.4, accuracy: 1.08 },
    say: 'They will feel this tomorrow. Not today.',
  },
  back_to_duty: {
    id: 'back_to_duty', dept: 'medical', rank: 2, name: 'Back to Duty',
    order: 'Clear someone for duty', cooldown: 90, duration: 0,
    // Signing an injured officer back onto a post they are not fit for.
    //
    // Deliberately UNDER 0.5, which is the line `reactTo` draws between an
    // objection and a refusal. A chief medical officer refusing this is the
    // most in-character thing in the franchise and it was tried at 0.55 — and
    // the TOS doctor has the discipline and the candor for it, so a canon crew
    // lost the use of a rank-two ability outright, every time, for the whole
    // campaign. A doctor who says it is a bad idea and then does it is the
    // right answer; a game feature one crew can never use is not.
    ethicalWeight: 0.4,
    special: 'return_officer',
    say: 'I can give you one of them back. One.',
  },
  surgical_bay: {
    id: 'surgical_bay', dept: 'medical', rank: 3, name: 'Surgical Bay',
    order: 'Open the surgical bay', cooldown: 120, duration: 40,
    mods: { crewProtect: 0.5 }, special: 'treat_wounded',
    say: 'Surgical bay open. Send them down.',
  },

  // --- Operations: the helm and communications ---
  attack_pattern_delta: {
    id: 'attack_pattern_delta', dept: 'operations', rank: 1, name: 'Attack Pattern Delta',
    order: 'Attack pattern delta', cooldown: 35, duration: 15,
    mods: { defense: 1.4, turn: 1.2 },
    say: 'Pattern delta, aye.',
  },
  traffic_analysis: {
    id: 'traffic_analysis', dept: 'operations', rank: 2, name: 'Traffic Analysis',
    order: 'Read their signal traffic', cooldown: 50, duration: 0,
    special: 'read_intent',
    say: 'Reading their signal traffic now.',
  },
  false_signal: {
    id: 'false_signal', dept: 'operations', rank: 2, name: 'False Signal',
    order: 'Put a false signal out', cooldown: 55, duration: 12,
    // Deception under a Federation transponder. Legal, and not everybody at
    // operations is comfortable with it.
    ethicalWeight: 0.35,
    special: 'false_signal',
    say: 'Broadcasting a ship that is not there.',
  },
  ramming_speed: {
    // Moved here from engineering. When it is ordered, it is ordered to the
    // helm — it sat in the engineering table because that is where the power
    // it draws comes from, which is not the same thing as who flies it.
    id: 'ramming_speed', dept: 'operations', rank: 3, name: 'Overload Impulse',
    order: 'All available power to engines', cooldown: 60, duration: 15,
    mods: { impulse: 1.6, turn: 1.3 },
    say: 'She’ll take it — for fifteen seconds.',
  },
};

export const ABILITY_LIST = Object.values(ABILITIES);

/**
 * Abilities an officer at a station could ever learn.
 *
 * This used to remap `operations` and `medical` onto `command`, because
 * neither department had a single ability of its own — so the doctor and the
 * helmsman called attack patterns, and four of the seven officers on a bridge
 * held an identical tray. Every department has its own table now.
 */
export function abilityPool(dept) {
  return ABILITY_LIST.filter((a) => a.dept === dept);
}

export class Officer {
  constructor(data) {
    Object.assign(this, {
      station: 'tactical', name: 'Officer', species: 'Human', rank: 'Lieutenant',
      discipline: 80, daring: 70, candor: 70, expertise: 80,
      canon: false,
      // What the captain calls them when there is no time for a surname.
      // Read by src/sim/address.js; saved, because a name somebody answers to
      // that stops working after a reload is worse than never having it.
      aliases: [],
    }, data);

    this.alive = true;
    this.injured = false;
    this.injurySeverity = 0;
    this.xp = 0;
    this.level = 1;
    this.abilities = [];
    this.cooldowns = {};
    this.relationship = 0;    // -100..100, how they feel about serving under you
    this.learnStartingAbilities();
  }

  get dept() {
    return STATIONS.find((s) => s.id === this.station)?.dept ?? 'command';
  }

  get available() {
    return this.alive && !this.injured;
  }

  /**
   * What an officer comes aboard already knowing.
   *
   * A rule, not a truncation. This used to take `pool.slice(0, 3)` — the first
   * three entries of the department table, in whatever order they happened to
   * be written in — which made every officer of a department identical to every
   * other and left six of the abilities in the game held by nobody at all.
   *
   * Ranks one and two are the working repertoire of the station; rank three is
   * what training opens up, and the captain's own rank is what gates that. A
   * green officer arrives with the rank-one set only, which is the difference
   * between an experienced bridge and a fresh one.
   */
  learnStartingAbilities() {
    const gate = this.expertise >= 70 ? 2 : 1;
    this.abilities = abilityPool(this.dept)
      .filter((a) => a.rank <= gate)
      .map((a) => a.id);
  }

  learn(abilityId) {
    if (this.abilities.includes(abilityId)) return false;
    const ability = ABILITIES[abilityId];
    if (!ability) return false;
    if (ability.dept !== this.dept) return false;
    this.abilities.push(abilityId);
    return true;
  }

  ready(abilityId) {
    return this.available && this.abilities.includes(abilityId) && (this.cooldowns[abilityId] ?? 0) <= 0;
  }

  /**
   * @param {string} abilityId
   * @param {number} haste  fraction FASTER the station recovers, not fraction
   *   off the clock: 0.4 is "recover 40% faster", which is the same wait
   *   divided by 1.4 rather than multiplied by 0.6. The difference matters at
   *   the top end, where the two readings diverge sharply and only one of them
   *   can ever reach zero.
   */
  startCooldown(abilityId, haste = 0) {
    const ability = ABILITIES[abilityId];
    if (!ability) return;
    // Expertise shaves cooldowns; a captain the bridge would follow anywhere
    // shaves them further.
    this.cooldowns[abilityId] = ability.cooldown
      * (1 - (this.expertise - 50) * 0.003) / (1 + Math.max(0, haste));
  }

  update(dt) {
    for (const k of Object.keys(this.cooldowns)) {
      if (this.cooldowns[k] > 0) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    }
    // One recovery rule, not two.
    //
    // This used to heal at `dt * 0.02`, which is a full recovery in fifty
    // seconds of sitting on the bridge — while `recover(hours)` says the same
    // injury takes 120 hours. The campaign-time sickbay could therefore never
    // have an effect, because the injury was always gone before the app was
    // closed, and an officer hurt in a battle was back at their post before the
    // wreck had finished burning. A casualty that heals itself in under a
    // minute is not a casualty.
    //
    // Simulation seconds are converted to ship hours and handed to the one
    // rule that owns this. Getting hurt now costs you that officer until time
    // passes or the ship docks.
    this.recover(dt / 3600);
  }

  /**
   * Recovery over campaign time rather than simulation seconds.
   *
   * Sickbay works while the app is closed. A bad injury takes the better part
   * of a week to clear, which is slow enough that losing an officer to the
   * infirmary is a real cost and fast enough that it is not a death sentence.
   */
  recover(hours) {
    if (!this.injured || !this.alive) return;
    this.injurySeverity = Math.max(0, this.injurySeverity - hours / 120);
    if (this.injurySeverity <= 0) this.injured = false;
  }

  /**
   * How this officer responds to an order they consider questionable.
   * @returns {'comply'|'object'|'refuse'}
   */
  reactTo(order) {
    const risk = order.risk ?? 0;             // 0..1
    const ethics = order.ethicalWeight ?? 0;  // 0..1, e.g. Prime Directive
    if (ethics > 0.5 && this.discipline < 70 && this.candor > 75) return 'refuse';
    if (risk > 0.7 && this.daring < 45) return 'object';
    if (ethics > 0.3 && this.candor > 70) return 'object';
    if (risk > 0.5 && this.candor > 80) return 'object';
    return 'comply';
  }

  /** A line in this officer's voice. Generated from traits, not quoted. */
  acknowledge(kind = 'order') {
    const formal = this.discipline > 88;
    const blunt = this.candor > 85;
    const bold = this.daring > 85;
    if (kind === 'object') {
      if (blunt) return `Captain, I have to tell you that is a mistake.`;
      if (formal) return `Acknowledged, though I am obliged to log my reservation.`;
      return `Sir, are you certain about that?`;
    }
    if (kind === 'refuse') {
      return `Captain, I will not carry out that order. Log it however you must.`;
    }
    if (kind === 'risky') {
      if (bold) return `Finally. Aye, Captain.`;
      return `Aye — plotting it now.`;
    }
    if (formal) return `Acknowledged, Captain.`;
    if (bold) return `Aye, sir!`;
    return `Aye, Captain.`;
  }

  injure(severity = 0.5) {
    this.injured = true;
    this.injurySeverity = Math.max(this.injurySeverity, severity);
    emit('officer:injured', this);
  }

  kill(cause = 'killed in action') {
    if (!this.alive) return;
    this.alive = false;
    // Being dead is not a kind of being hurt.
    //
    // `injured` survived death, so an officer wounded on one away mission and
    // killed on the next was dead AND on the sick list — which is what
    // `officer.dead-and-injured` in the invariant file says must never happen,
    // and what every roster panel then reported. Found by the order monkey.
    this.injured = false;
    this.injurySeverity = 0;
    this.cause = cause;
    emit('officer:killed', { officer: this, cause });
  }

  /** Back on duty. Nothing brings the dead back. */
  heal() {
    if (!this.alive) return false;
    this.injured = false;
    this.injurySeverity = 0;
    return true;
  }

  save() {
    return {
      station: this.station, name: this.name, species: this.species, rank: this.rank,
      discipline: this.discipline, daring: this.daring, candor: this.candor,
      expertise: this.expertise, canon: this.canon, aliases: this.aliases,
      alive: this.alive, injured: this.injured, injurySeverity: this.injurySeverity,
      xp: this.xp, level: this.level, abilities: this.abilities, relationship: this.relationship,
    };
  }

  static load(data) {
    const o = new Officer(data);
    o.alive = data.alive ?? true;
    o.injured = data.injured ?? false;
    o.injurySeverity = data.injurySeverity ?? 0;
    o.abilities = data.abilities ?? o.abilities;
    o.xp = data.xp ?? 0;
    o.level = data.level ?? 1;
    o.relationship = data.relationship ?? 0;
    return o;
  }
}

/** The senior staff as a unit. */
export class Crew {
  constructor(officers = []) {
    this.officers = officers.map((o) => (o instanceof Officer ? o : new Officer(o)));
  }

  at(station) {
    return this.officers.find((o) => o.station === station && o.alive);
  }

  get living() {
    return this.officers.filter((o) => o.alive);
  }

  get available() {
    return this.officers.filter((o) => o.available);
  }

  update(dt) {
    for (const o of this.officers) o.update(dt);
  }

  /** Every ability the standing crew can currently use. */
  readyAbilities() {
    const out = [];
    for (const o of this.available) {
      for (const id of o.abilities) {
        if (o.ready(id)) out.push({ officer: o, ability: ABILITIES[id] });
      }
    }
    return out;
  }

  /** Find who would execute a named ability. */
  officerFor(abilityId) {
    return this.available.find((o) => o.abilities.includes(abilityId));
  }

  save() {
    return this.officers.map((o) => o.save());
  }

  static load(data) {
    return new Crew((data ?? []).map((d) => Officer.load(d)));
  }
}
