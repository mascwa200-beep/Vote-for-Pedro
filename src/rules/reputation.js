// Reputation.
//
// Two separate axes, deliberately not merged:
//
//   Standing   — how a faction feels about you right now. Moves both ways,
//                fast, and decides who shoots on sight. Lives in the ledger.
//   Reputation — what you have *earned* with them over a career. Only ever
//                goes up, gated behind tiers, and spends like currency on
//                projects that grant real equipment and privileges.
//
// A captain can be deeply trusted by the Klingon Defence Force (high
// reputation) and still be shot at this week for a border violation (low
// standing). That distinction is the point.

import { clamp, finite } from '../core/num.js';

export const REP_TIERS = [
  { tier: 0, name: 'Unknown', xp: 0, marksToAdvance: 0 },
  { tier: 1, name: 'Recognised', xp: 500, marksToAdvance: 40 },
  { tier: 2, name: 'Acknowledged', xp: 1500, marksToAdvance: 80 },
  { tier: 3, name: 'Trusted', xp: 3500, marksToAdvance: 140 },
  { tier: 4, name: 'Honoured', xp: 7000, marksToAdvance: 220 },
  { tier: 5, name: 'Exemplar', xp: 12000, marksToAdvance: 320 },
];

export const MAX_TIER = REP_TIERS.length - 1;

/** Each faction's reputation track, its currency, and what it sells. */
export const REP_TRACKS = {
  federation: {
    id: 'federation', name: 'Starfleet Command', currency: 'Commendations',
    color: '#9cf',
    description: 'Your own service record, as the admiralty reads it.',
    projects: [
      { id: 'fed_t1_console', tier: 1, cost: 30, name: 'Requisition: Field Emitter Array',
        grant: { console: 'shield_emitters' }, text: 'A shield emitter set from fleet stores.' },
      { id: 'fed_t1_torpedoes', tier: 1, cost: 25, name: 'Priority Torpedo Resupply',
        grant: { torpedoes: 40 }, text: 'Forty photon torpedoes, no requisition forms.' },
      { id: 'fed_t2_armor', tier: 2, cost: 60, name: 'Requisition: Ablative Armour',
        grant: { console: 'ablative_armor' }, text: 'Experimental plating from the Corps of Engineers.' },
      { id: 'fed_t2_medical', tier: 2, cost: 55, name: 'Fleet Medical Detachment',
        grant: { perk: 'casualty_reduction' }, text: 'Permanent 15% reduction in crew casualties.' },
      { id: 'fed_t3_refit', tier: 3, cost: 110, name: 'Priority Yard Access',
        grant: { perk: 'free_refit' }, text: 'Refits and repairs at any starbase cost no time.' },
      { id: 'fed_t3_console', tier: 3, cost: 100, name: 'Requisition: Multispectral Sensors',
        grant: { console: 'sensor_array' }, text: 'The good sensor package, finally.' },
      { id: 'fed_t4_escort', tier: 4, cost: 180, name: 'Standing Escort Authorisation',
        grant: { perk: 'ally_escort' }, text: 'A Federation escort joins you in any engagement in Federation space.' },
      { id: 'fed_t5_command', tier: 5, cost: 300, name: 'Flag Officer Authority',
        grant: { perk: 'flag_authority', title: 'Fleet Captain' },
        text: 'You may requisition any hull in the fleet, and Starfleet stops second-guessing you.' },
    ],
  },
  klingon: {
    id: 'klingon', name: 'Klingon Defence Force', currency: 'Marks of Honour',
    color: '#e5533d',
    description: 'Earned by fighting well, and by not running when running was sensible.',
    description2: 'The Empire does not care whether you like them. It cares how you fight.',
    projects: [
      { id: 'kdf_t1_disruptor', tier: 1, cost: 30, name: 'Disruptor Calibration',
        grant: { console: 'prefire_chamber' }, text: 'Their gunners show yours a thing or two.' },
      { id: 'kdf_t2_boarding', tier: 2, cost: 60, name: 'Boarding Party Training',
        grant: { perk: 'boarding_master' }, text: 'Your boarding parties are twice as effective.' },
      { id: 'kdf_t3_bloodwine', tier: 3, cost: 100, name: 'Warrior\'s Standing',
        grant: { perk: 'klingon_passage' }, text: 'Free passage through Klingon space, and a seat at the table.' },
      { id: 'kdf_t4_cloak_detect', tier: 4, cost: 170, name: 'Battle Doctrine Exchange',
        grant: { perk: 'first_strike' }, text: 'You always fire first in an engagement.' },
      { id: 'kdf_t5_ally', tier: 5, cost: 290, name: 'Sworn Ally of the Empire',
        grant: { perk: 'kdf_ally', title: 'Friend of the Empire' },
        text: 'A Klingon battlecruiser answers your call once per voyage.' },
    ],
  },
  romulan: {
    id: 'romulan', name: 'Romulan Star Empire', currency: 'Tokens of Regard',
    color: '#7ed957',
    description: 'Earned slowly, by being predictable in the ways that matter and opaque in the rest.',
    projects: [
      { id: 'rom_t1_sensors', tier: 1, cost: 35, name: 'Tal Shiar Sensor Data',
        grant: { console: 'sensor_array' }, text: 'Nobody says where the data came from.' },
      { id: 'rom_t2_stealth', tier: 2, cost: 70, name: 'Signal Dampening',
        grant: { perk: 'reduced_detection' }, text: 'Encounters trigger less often in hostile space.' },
      { id: 'rom_t3_cloak', tier: 3, cost: 130, name: 'Cloaking Device (Loaned)',
        grant: { perk: 'cloak' }, text: 'A functioning cloak, on terms nobody has written down.' },
      { id: 'rom_t4_intel', tier: 4, cost: 200, name: 'Intelligence Sharing',
        grant: { perk: 'see_all_encounters' }, text: 'You know what is waiting before you arrive.' },
      { id: 'rom_t5_accord', tier: 5, cost: 320, name: 'Private Accord',
        grant: { perk: 'romulan_accord', title: 'Trusted Outsider' },
        text: 'The Neutral Zone opens to you. Officially, this never happened.' },
    ],
  },
  cardassian: {
    id: 'cardassian', name: 'Cardassian Union', currency: 'Writs of Accord',
    color: '#d9a441',
    description: 'Earned through precisely honoured agreements, and lost through a single missed clause.',
    projects: [
      { id: 'card_t1_console', tier: 1, cost: 30, name: 'Spiral-Wave Schematics',
        grant: { console: 'phaser_relay' }, text: 'Their beam theory, adapted to your emitters.' },
      { id: 'card_t2_repair', tier: 2, cost: 65, name: 'Union Shipyard Access',
        grant: { perk: 'cardassian_dock' }, text: 'Repair rights at Cardassian facilities.' },
      { id: 'card_t3_intel', tier: 3, cost: 120, name: 'Obsidian Order Courtesy',
        grant: { perk: 'border_warning' }, text: 'You are warned before you cross a line that matters.' },
      { id: 'card_t4_treaty', tier: 4, cost: 190, name: 'Standing Treaty Rider',
        grant: { perk: 'dmz_passage' }, text: 'Free movement through the demilitarised zone.' },
      { id: 'card_t5_alliance', tier: 5, cost: 310, name: 'Formal Alliance',
        grant: { perk: 'cardassian_ally', title: 'Signatory' },
        text: 'A Galor escorts you through Cardassian space, watching very carefully.' },
    ],
  },
  ferengi: {
    id: 'ferengi', name: 'Ferengi Alliance', currency: 'Bars of Latinum',
    color: '#e9913c',
    description: 'Earned exactly as you would expect.',
    projects: [
      { id: 'fer_t1_trade', tier: 1, cost: 25, name: 'Trade Licence',
        grant: { perk: 'better_prices' }, text: 'Prices improve by a quarter, everywhere.' },
      { id: 'fer_t2_salvage', tier: 2, cost: 55, name: 'Salvage Contacts',
        grant: { perk: 'salvage_bonus' }, text: 'Derelicts yield an additional console.' },
      { id: 'fer_t3_bribe', tier: 3, cost: 95, name: 'Line of Credit',
        grant: { perk: 'always_bribe' }, text: 'Any bribeable captain will always hear an offer.' },
      { id: 'fer_t4_ship', tier: 4, cost: 175, name: 'Marauder Contract',
        grant: { perk: 'mercenary_escort' }, text: 'A hired Marauder joins one engagement per voyage.' },
      { id: 'fer_t5_partner', tier: 5, cost: 280, name: 'Silent Partnership',
        grant: { perk: 'ferengi_partner', title: 'Business Associate' },
        text: 'Every mission reward is increased by half. They take their cut invisibly.' },
    ],
  },
  independent: {
    id: 'independent', name: 'Unaligned Worlds', currency: 'Letters of Thanks',
    color: '#cccccc',
    description: 'Earned by answering distress calls that nobody was required to answer.',
    projects: [
      { id: 'ind_t1_supply', tier: 1, cost: 20, name: 'Colonial Resupply',
        grant: { antimatter: 100 }, text: 'Any colony will refuel you, gratis.' },
      { id: 'ind_t2_crew', tier: 2, cost: 50, name: 'Volunteer Crew',
        grant: { perk: 'crew_replacement' }, text: 'Crew losses replenish at any inhabited world.' },
      { id: 'ind_t3_intel', tier: 3, cost: 90, name: 'Trader Network',
        grant: { perk: 'route_intel' }, text: 'Hostile encounters in charted space are halved.' },
      { id: 'ind_t4_haven', tier: 4, cost: 160, name: 'Safe Harbour',
        grant: { perk: 'universal_dock' }, text: 'Every inhabited system will dock and repair you.' },
      { id: 'ind_t5_legend', tier: 5, cost: 260, name: 'A Name They Know',
        grant: { perk: 'folk_hero', title: 'The One Who Came' },
        text: 'Distress calls reach you sooner, and civilians will risk themselves for you.' },
    ],
  },
};

export const TRACK_LIST = Object.values(REP_TRACKS);

/** How reputation is earned. Deliberately weighted toward what each side values. */
export const REP_AWARDS = {
  // event -> { faction: [xp, marks] }
  combat_victory: { klingon: [40, 4] },
  fought_while_losing: { klingon: [120, 12] },
  accepted_surrender: { federation: [60, 6], independent: [40, 4] },
  refused_surrender: { klingon: [30, 3] },
  distress_answered: { federation: [80, 8], independent: [140, 14] },
  colony_saved: { federation: [250, 25], independent: [400, 40] },
  first_contact: { federation: [400, 40] },
  treaty_signed: { federation: [350, 35], cardassian: [200, 20] },
  anomaly_catalogued: { federation: [60, 6] },
  mission_complete: { federation: [150, 15] },
  escort_completed: { ferengi: [90, 9], independent: [110, 11] },
  trade_completed: { ferengi: [140, 14] },
  bribe_paid: { ferengi: [60, 6] },
  honourable_release: { romulan: [220, 22], klingon: [90, 9] },
  agreement_honoured: { cardassian: [200, 20] },
  border_respected: { romulan: [120, 12], cardassian: [80, 8] },
  prisoner_returned: { klingon: [110, 11], romulan: [90, 9], cardassian: [90, 9] },
};

export class ReputationTrack {
  constructor(id) {
    this.id = id;
    this.xp = 0;
    this.marks = 0;
    this.tier = 0;
    this.completed = [];       // project ids
    this.titles = [];
  }

  get def() { return REP_TRACKS[this.id]; }
  get tierName() { return REP_TIERS[this.tier]?.name ?? 'Unknown'; }
  get nextTier() { return REP_TIERS[this.tier + 1] ?? null; }

  /** Progress toward the next tier, 0..1. */
  get progress() {
    const next = this.nextTier;
    if (!next) return 1;
    const floor = REP_TIERS[this.tier].xp;
    return Math.max(0, Math.min(1, (this.xp - floor) / (next.xp - floor)));
  }

  /**
   * Award reputation. Tiers advance on experience alone; marks are the
   * currency spent on projects.
   * @returns {object|null} tier-up info
   */
  award(xp, marks, multiplier = 1) {
    // Guarded, and the tier is capped. Marks are currency and both fields are
    // saved, so one bad multiplier would poison a track for the rest of the
    // commission — and a tier past the top of the table has no name, no
    // projects, and nothing to show on the reputation screen.
    // The multiplier needs a ceiling, not just a finiteness check: 1e308 is a
    // finite number that overflows to Infinity the moment it is multiplied.
    // Nothing in play exceeds 2 — a repGain trait times the Idealist doubling.
    const mult = clamp(multiplier, 0, 100);
    const cap = Number.MAX_SAFE_INTEGER;
    this.xp = Math.min(cap, Math.max(0, this.xp + Math.round(finite(xp, 0) * mult)));
    this.marks = Math.min(cap, Math.max(0, this.marks + Math.round(finite(marks, 0) * mult)));
    const next = this.nextTier;
    if (next && this.xp >= next.xp) {
      this.tier = Math.min(MAX_TIER, this.tier + 1);
      return { track: this.id, tier: this.tier, name: this.tierName };
    }
    return null;
  }

  availableProjects() {
    return (this.def?.projects ?? []).filter(
      (p) => p.tier <= this.tier && !this.completed.includes(p.id),
    );
  }

  lockedProjects() {
    return (this.def?.projects ?? []).filter(
      (p) => p.tier > this.tier && !this.completed.includes(p.id),
    );
  }

  canAfford(project) {
    return this.marks >= project.cost;
  }

  complete(projectId) {
    const project = (this.def?.projects ?? []).find((p) => p.id === projectId);
    if (!project) return null;
    if (this.completed.includes(projectId)) return null;
    if (!this.canAfford(project)) return null;
    if (project.tier > this.tier) return null;
    this.marks -= project.cost;
    this.completed.push(projectId);
    if (project.grant?.title) this.titles.push(project.grant.title);
    return project;
  }

  save() {
    return { id: this.id, xp: this.xp, marks: this.marks, tier: this.tier,
      completed: this.completed, titles: this.titles };
  }
}

/** All tracks together, plus the perk set they have unlocked. */
export class Reputation {
  constructor() {
    this.tracks = Object.fromEntries(
      Object.keys(REP_TRACKS).map((id) => [id, new ReputationTrack(id)]),
    );
    this.perks = new Set();
  }

  track(id) { return this.tracks[id]; }

  /**
   * Apply a named world event to every track that cares about it.
   * @returns {object[]} tier-ups that occurred
   */
  recordEvent(event, multiplier = 1) {
    const table = REP_AWARDS[event];
    if (!table) return [];
    const tierUps = [];
    for (const [factionId, [xp, marks]] of Object.entries(table)) {
      const t = this.tracks[factionId];
      if (!t) continue;
      const up = t.award(xp, marks, multiplier);
      if (up) tierUps.push(up);
    }
    return tierUps;
  }

  /** Spend marks on a project and record the perk it grants. */
  buy(factionId, projectId) {
    const track = this.tracks[factionId];
    if (!track) return null;
    const project = track.complete(projectId);
    if (project?.grant?.perk) this.perks.add(project.grant.perk);
    return project;
  }

  has(perk) { return this.perks.has(perk); }

  get allTitles() {
    return Object.values(this.tracks).flatMap((t) => t.titles);
  }

  /** Highest tier reached anywhere — used for the ending summary. */
  get peakTier() {
    return Math.max(0, ...Object.values(this.tracks).map((t) => t.tier));
  }

  save() {
    return {
      tracks: Object.fromEntries(
        Object.entries(this.tracks).map(([id, t]) => [id, t.save()]),
      ),
      perks: [...this.perks],
    };
  }

  static load(data) {
    const r = new Reputation();
    if (!data) return r;
    for (const [id, t] of Object.entries(data.tracks ?? {})) {
      if (!r.tracks[id]) continue;
      Object.assign(r.tracks[id], {
        xp: t.xp ?? 0, marks: t.marks ?? 0, tier: t.tier ?? 0,
        completed: t.completed ?? [], titles: t.titles ?? [],
      });
    }
    r.perks = new Set(data.perks ?? []);
    return r;
  }
}
