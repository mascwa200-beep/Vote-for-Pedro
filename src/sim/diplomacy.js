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
    // "Line of Credit — any bribeable captain will always hear an offer."
    // Ninety-five Bars of Latinum bought a green pill: the perk went into a
    // Set nothing read, and the option stayed hidden against every faction
    // whose data did not already say it took money. A line of credit with the
    // Ferengi is what gets an offer heard where it otherwise would not be —
    // heard, not accepted. `resolveHail` still rolls it, and a Klingon who
    // hears an offer of latinum is not obliged to like it.
    if (o.requires === 'bribeable' && !faction.bribeable && !context.alwaysBribe) return false;
    // And an offer you cannot cover is not an offer. `context.latinum` and
    // `context.bribePrice` come from the game; when neither is supplied — a
    // test, a tool, an older caller — the option behaves exactly as it always
    // has rather than silently vanishing.
    if (o.id === 'bribe' && context.bribePrice > 0
      && Number.isFinite(context.latinum) && context.latinum < context.bribePrice) return false;
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
  forced = false,
  // What this faction remembers the captain doing, from `Game.factionMemory`.
  // Already clamped by the caller; clamped again here because a pure function
  // that trusts its caller for its bounds is a pure function with a hole in it.
  memory = 0,
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
      // A forced parley gets a hearing even here — it does not guarantee
      // agreement, only that somebody answers.
      if (forced) { chance += 0.35; break; }
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

  // And so is everything else they remember.
  //
  // `firstStrike` has carried that comment since it was written and was the
  // only thing on the whole context that meant "they remember" — one boolean
  // about the last few minutes. Meanwhile the campaign ledger held fifty-seven
  // flags recording what the captain had actually done to these people across
  // five years, and nothing outside the mission book read a single one of them.
  // Measured at 120 seeds, a Klingon negotiation succeeded 40.0% of the time
  // whether Kang respected you or you had refused a surrender and killed
  // forty-two of them at Archanis.
  chance += Math.max(-0.4, Math.min(0.4, memory));
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

/**
 * How a hail that ends a fight is recorded as an ENDING.
 *
 * `resolveHail` names its results for what happened at the table — they
 * surrendered, we bought them off, they were deterred. `Engagement.end` takes
 * one of five endings, and none of these is one of them, so every single one of
 * them was silently coerced to `routed` — the ending that means "we drove them
 * off in a fight". Measured: bribing a Klingon captain to leave paid 790
 * experience and a `combat_victory` reputation on top of the 180 the bribe
 * itself pays, and the panel reported "They have broken off and gone to warp"
 * about a conversation.
 *
 * They all end the same way, because they are all the same thing: the fight
 * stopped because somebody talked. What each one is WORTH is already decided,
 * per option, by the `xp` and `standingDelta` on the result — this table exists
 * so that reward is the only one, rather than a bonus on top of a battle's.
 *
 * Keeping it here, beside the results it maps, is deliberate: a new hail
 * outcome added twenty lines above is not finished until it appears here, and
 * a test asserts exactly that rather than trusting anyone to remember.
 */
export const HAIL_ENDING = {
  surrendered: 'parley',
  bought_off: 'parley',
  stand_down: 'parley',
  deterred: 'parley',
  accepted_aid: 'parley',
  acknowledged: 'parley',
};

/**
 * What an act costs a captain in standing, in one place.
 *
 * The table is only worth having if the game reads it, and half of it was not
 * read at all — six of the eleven had no consumer, and three of those had
 * quietly come to contradict what the game actually does:
 *
 *   `violated_border` said -14. Crossing the Romulan Neutral Zone costs -20,
 *   written out as a number in `Game.crossTheZone`. Measured, not read.
 *
 *   `prime_directive_violation` said -6. Revealing the ship to a pre-warp
 *   culture costs -18. The -6 belongs to a different act entirely — being
 *   seen during a covert survey — which is the kind of thing a shared
 *   constant exists to stop happening.
 *
 *   `first_contact_peaceful` said +12 and the code said 12, agreeing by
 *   coincidence rather than by reference.
 *
 * Three more described nothing the game does and are gone rather than left
 * to look authoritative: a surrender's standing comes from the hail result's
 * own `standingDelta` twenty lines above (and was -4, the opposite sign to
 * the +5 this table claimed), nothing in the game refuses a surrender, and a
 * treaty's standing is written by the episode that signs it.
 *
 * A test in wiring.test.js now asserts every entry here is read by something,
 * the same way one already asserts every sound cue is either played or
 * reserved with a reason.
 */
export const STANDING_EFFECTS = {
  destroyed_their_ship: -12,
  destroyed_civilian: -20,
  answered_distress: +6,
  ignored_distress: -3,
  completed_escort: +8,
  first_contact_peaceful: +12,
  // Crossing a line somebody signed a treaty over. RESEARCH.md §23.
  violated_border: -20,
  // Being seen by a culture that has not invented warp — the act itself, not
  // the lesser one of being spotted while trying not to be.
  prime_directive_violation: -18,
  // And that lesser one, which the covert survey pays when it goes wrong.
  observed_during_survey: -6,
};
