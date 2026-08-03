// Hails, negotiation, and what talking actually gets you.
//
// A hail is a real alternative to shooting: it can end an engagement, buy a
// withdrawal, or make things considerably worse. Outcomes depend on the
// captain's Diplomacy skill, current standing, and faction doctrine.

import { FACTIONS, standingTier } from '../world/factions.data.js';

export const HAIL_OPTIONS = [
  {
    id: 'identify', label: 'Identify ourselves',
    order: 'Open a channel — this is the Enterprise',
    tone: 'neutral', risk: 0,
    description: 'State who we are and why we are here.',
  },
  {
    id: 'warn', label: 'Warn them off',
    order: 'Tell them to withdraw',
    tone: 'firm', risk: 0.2,
    description: 'Make clear we are prepared to defend ourselves.',
  },
  {
    id: 'demand_surrender', label: 'Demand their surrender',
    order: 'Demand their surrender',
    tone: 'aggressive', risk: 0.5,
    description: 'Only credible if we are visibly winning.',
  },
  {
    id: 'offer_aid', label: 'Offer assistance',
    order: 'Offer them assistance',
    tone: 'warm', risk: 0.1,
    description: 'Costs us time and materiel. Buys goodwill.',
  },
  {
    id: 'negotiate', label: 'Negotiate a withdrawal',
    order: 'Negotiate',
    tone: 'neutral', risk: 0.15,
    description: 'Both sides back off. Nobody gets what they came for.',
  },
  {
    id: 'bribe', label: 'Offer payment',
    order: 'Offer them latinum',
    tone: 'transactional', risk: 0.05,
    requires: 'bribeable',
    description: 'Some captains have a price and no shame about it.',
  },
  {
    id: 'threaten', label: 'Threaten them',
    order: 'Threaten them',
    tone: 'aggressive', risk: 0.6,
    description: 'Works on cowards. Insults the brave.',
  },
];

/** Options that make sense against this faction in this situation. */
export function availableHails(factionId, context = {}) {
  const faction = FACTIONS[factionId];
  if (!faction?.hailable) return [];
  return HAIL_OPTIONS.filter((o) => {
    if (o.requires === 'bribeable' && !faction.bribeable) return false;
    if (o.id === 'demand_surrender' && !context.winning) return false;
    return true;
  });
}

/**
 * Resolve a hail.
 * @returns {object} { outcome, text, standingDelta, endsCombat, xp }
 */
export function resolveHail(rng, optionId, {
  factionId, standing = 0, diplomacyBonus = 0,
  winning = false, playerHullPct = 1, enemyHullPct = 1, firstStrike = false,
} = {}) {
  const faction = FACTIONS[factionId];
  const option = HAIL_OPTIONS.find((o) => o.id === optionId);
  if (!faction || !option) return { outcome: 'no_response', text: 'No response.', standingDelta: 0 };

  const tier = standingTier(standing);
  // Base receptiveness: how they already feel, plus how the fight is going.
  let chance = 0.45 + diplomacyBonus + (standing / 260);

  // Doctrine reshapes what works.
  switch (faction.doctrine) {
    case 'aggressive':
      // Klingons respect strength and are insulted by pleading.
      if (option.tone === 'firm' || option.tone === 'aggressive') chance += 0.2;
      if (option.tone === 'warm') chance -= 0.25;
      if (faction.respectsValor && playerHullPct < 0.4) chance += 0.15;
      break;
    case 'opportunist':
      if (option.id === 'bribe') chance += 0.45;
      if (enemyHullPct < 0.6) chance += 0.2;
      break;
    case 'ambush':
      chance -= 0.15;
      if (option.tone === 'aggressive') chance -= 0.2;
      break;
    case 'attrition':
      if (option.id === 'negotiate') chance += 0.12;
      if (option.tone === 'aggressive') chance -= 0.15;
      break;
    case 'fanatic':
    case 'assimilate':
      return {
        outcome: 'ignored',
        text: faction.doctrine === 'assimilate'
          ? 'The channel is open. Nothing answers. They do not slow down.'
          : 'They acknowledge the channel and close it again. They are still closing.',
        standingDelta: 0, endsCombat: false,
      };
    default:
      break;
  }

  if (winning) chance += 0.18;
  if (firstStrike) chance -= 0.25;      // you shot first; they remember
  if (enemyHullPct < 0.35) chance += 0.22;
  if (option.id === 'demand_surrender') chance -= 0.2;

  const roll = rng.float();
  const success = roll < chance;
  const disaster = roll > chance + 0.45 && option.risk > 0.3;

  if (disaster) {
    return {
      outcome: 'insulted',
      text: `${faction.adjective} response: the channel closes mid-sentence. They are coming about hard.`,
      standingDelta: -8, endsCombat: false, enraged: true,
    };
  }

  if (!success) {
    return {
      outcome: 'rejected',
      text: rng.pick([
        'They acknowledge and refuse.',
        'The reply is short and not encouraging.',
        'They are still on course. No change.',
      ]),
      standingDelta: -1, endsCombat: false,
    };
  }

  // Success, shaped by what was asked for.
  switch (option.id) {
    case 'demand_surrender':
      return {
        outcome: 'surrendered',
        text: 'They are powering down weapons and standing by to be boarded.',
        standingDelta: -4, endsCombat: true, xp: 400, surrender: true,
      };
    case 'bribe':
      return {
        outcome: 'bought_off',
        text: 'Terms accepted. They are breaking orbit — quickly, before we reconsider.',
        standingDelta: +4, endsCombat: true, xp: 180, cost: 'latinum',
      };
    case 'negotiate':
      return {
        outcome: 'stand_down',
        text: 'Both sides withdraw. Nothing is settled, but nobody else dies today.',
        standingDelta: +6, endsCombat: true, xp: 300,
      };
    case 'warn':
    case 'threaten':
      return {
        outcome: 'deterred',
        text: 'They are coming about and leaving the system. Slowly, to make a point.',
        standingDelta: faction.doctrine === 'aggressive' ? +3 : -2,
        endsCombat: true, xp: 220,
      };
    case 'offer_aid':
      return {
        outcome: 'accepted_aid',
        text: 'They accept. Their captain sounds surprised, and says so.',
        standingDelta: +10, endsCombat: true, xp: 350,
      };
    case 'identify':
    default:
      return {
        outcome: 'acknowledged',
        text: `${faction.adjective} vessel acknowledges. They are holding position.`,
        standingDelta: +2, endsCombat: !tier.hostile, xp: 120,
      };
  }
}

/** Standing change from an action, before the ledger applies it. */
export const STANDING_EFFECTS = {
  destroyed_their_ship: -12,
  destroyed_civilian: -20,
  accepted_surrender: +5,
  refused_surrender: -10,
  answered_distress: +6,
  ignored_distress: -3,
  completed_escort: +8,
  violated_border: -14,
  treaty_signed: +25,
  first_contact_peaceful: +12,
  prime_directive_violation: -6,
};
