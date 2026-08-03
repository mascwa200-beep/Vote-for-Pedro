// The Kobayashi Maru, and the way around it.
//
// The scenario is available from the first day of the commission and is
// unwinnable. That is not a difficulty setting; it is the entire point of the
// exercise, and the game does not quietly relent if you play well.
//
// What is earned is the *technique*, and the design of it comes straight out of
// what Kirk actually did, which is recorded with sources in docs/RESEARCH.md.
// He did not make the Klingons weaker. He reprogrammed the simulation so that
// on hearing his name the opposing commander held him in high regard — and
// they offered to help. The lever was reputation, and the trigger was saying
// who he was.
//
// So three things had to be true here, and each one is a gate:
//
//   YOU HAVE TO HAVE A REPUTATION. Not a level. Tier 5 on the Klingon track,
//   which is most of a five-year commission's worth of standing.
//
//   THEY HAVE TO HAVE MET YOU. The ledger has to show real encounters with the
//   Klingon Empire — ships you spared, ships you destroyed, colonies you saved.
//   A captain nobody has heard of cannot trade on being heard of.
//
//   YOU HAVE TO SAY SOMETHING WORTH HEARING. The exchange is free text, scored
//   against what the ledger actually records. Claiming a record you do not have
//   fails, and the reply says why.

import { emit } from '../core/events.js';
import { REP_TIERS } from '../rules/reputation.js';

/** The tier at which a captain's name means something to the Empire. */
export const GAMBIT_TIER = 5;

/** Encounters with the Empire that count as having been met. */
export const GAMBIT_ENCOUNTERS = 6;

export const SCENARIO = {
  id: 'kobayashi_maru',
  title: 'The Kobayashi Maru',
  briefing: [
    'A neutronic fuel carrier, nineteen decks, crew of eighty-one and three '
      + 'hundred passengers, has struck a gravitic mine and is adrift inside the '
      + 'Neutral Zone.',
    'Entering the Zone violates the treaty. Not entering it abandons three '
      + 'hundred and eighty-one people.',
    'Command is yours, Captain. The simulator is running.',
  ],
  // Deliberately overwhelming. This is not a fight to be tuned.
  hostiles: ['d7', 'd7', 'ktinga'],
};

/**
 * Can this captain attempt the gambit?
 *
 * Returns the reasons as well as the verdict, because the interesting part for
 * a player is which of the two conditions they have not met yet.
 */
export function gambitStatus(game) {
  const track = game.reputation?.tracks?.klingon;
  const tier = track?.tier ?? 0;
  const ledger = game.ledger;

  // Every kind of contact counts. Sparing a ship and destroying one both mean
  // the Empire knows your name; only indifference does not.
  const c = ledger?.counters ?? {};
  const met = (c.ship_destroyed_hostile ?? 0)
    + (c.ship_destroyed_civilian ?? 0)
    + (c.ship_spared ?? 0)
    + (c.honourable_release ?? 0)
    + (c.treaty_signed ?? 0)
    + (c.colony_saved ?? 0);

  const reasons = [];
  if (tier < GAMBIT_TIER) {
    reasons.push(
      `Your standing with the Empire is ${REP_TIERS[tier]?.name ?? 'Unknown'}. `
      + `They do not defer to captains they have merely heard of.`,
    );
  }
  if (met < GAMBIT_ENCOUNTERS) {
    reasons.push(
      `You have crossed the Empire's path ${met} time${met === 1 ? '' : 's'}. `
      + 'A name means nothing until there is something behind it.',
    );
  }

  return { unlocked: reasons.length === 0, tier, met, reasons };
}

/**
 * What the ledger can actually corroborate about this captain.
 *
 * This is the evidence base the rhetorical exchange is scored against, and it
 * is assembled from the permanent record rather than from anything the player
 * typed. You cannot claim your way into a reputation.
 */
export function recordOf(game) {
  const c = game.ledger?.counters ?? {};
  return {
    destroyed: (c.ship_destroyed_hostile ?? 0) + (c.ship_destroyed_civilian ?? 0),
    spared: (c.ship_spared ?? 0) + (c.honourable_release ?? 0),
    coloniesSaved: c.colony_saved ?? 0,
    treaties: c.treaty_signed ?? 0,
    firstContacts: c.first_contact ?? 0,
    officersLost: game.ledger?.lostOfficers?.length ?? 0,
    violations: c.prime_directive_violation ?? 0,
    tier: game.reputation?.tracks?.klingon?.tier ?? 0,
    name: `${game.character?.firstName ?? ''} ${game.character?.lastName ?? game.captain?.name ?? ''}`.trim(),
    ship: game.ship?.name ?? 'this vessel',
  };
}

/**
 * The axes a Klingon commander actually weighs.
 *
 * Each is a thing the captain can say, a thing the ledger can confirm, and a
 * reply for when it cannot. The last field is what makes this honest: a claim
 * the record does not support is not merely worth zero, it costs.
 */
export const AXES = [
  {
    id: 'name',
    label: 'Naming yourself',
    // Kirk's actual move. It is worth the most, and only if there is a record.
    match: /\b(?:i am|this is|my name is|you are speaking to|do you know who)\b/,
    weight: 3,
    evidence: (r) => r.tier >= GAMBIT_TIER,
    confirm: (r) => `"${r.name}." The channel is quiet for a moment.`,
    deny: () => 'A name. The commander waits, and nothing follows it.',
  },
  {
    id: 'record',
    label: 'Invoking your record',
    match: /\b(?:i have|we have|my record|you know what|at wolf|i destroyed|we destroyed|i fought|we fought|engaged)\b/,
    weight: 2,
    evidence: (r) => r.destroyed + r.spared >= 4,
    confirm: (r) => `"${r.destroyed} of our ships. ${r.spared} you let live." The commander has the file open.`,
    deny: () => 'The commander checks. There is no file. "You have done nothing to us, and nothing for us."',
  },
  {
    id: 'mercy',
    label: 'The ships you spared',
    match: /\b(?:spared|let them live|let you live|mercy|did not fire|held fire|honou?rable|honou?r)\b/,
    weight: 2.5,
    evidence: (r) => r.spared >= 2,
    confirm: (r) => `"You had ${r.spared} of our crews in your sights and did not take them. That is remembered."`,
    deny: () => '"Mercy." The word lands badly from someone who has never shown any.',
  },
  {
    id: 'stakes',
    label: 'The people aboard',
    match: /\b(?:three hundred|passengers|civilians|lives|crew of|people aboard|dying|rescue|save them)\b/,
    weight: 1.5,
    // Always true — there really are 381 people on that freighter.
    evidence: () => true,
    confirm: () => '"Civilians." A pause. "We are not the Romulans."',
    deny: () => '',
  },
  {
    id: 'terms',
    label: 'Offering terms',
    match: /\b(?:withdraw|leave the zone|escort|offer|propose|together|help us|assist|jointly|in return)\b/,
    weight: 2,
    evidence: (r) => r.treaties > 0 || r.tier >= 3,
    confirm: () => '"Terms. From a Starfleet captain." The commander sounds almost interested.',
    deny: () => '"Terms require standing. You have none here."',
  },
  {
    id: 'threat',
    label: 'Threatening them',
    // Costs rather than helps, and always. This is the one axis where the
    // right answer is not to use it.
    match: /\b(?:destroy you|kill you|or else|i will fire|we will fire|surrender|force|make you)\b/,
    weight: -3,
    evidence: () => true,
    confirm: () => '"There it is." Weapons come up. "I preferred the other approach."',
    deny: () => '',
  },
];

/**
 * Score what the captain actually said.
 *
 * @param {string} text  what they typed, verbatim
 * @param {object} record from recordOf()
 * @returns {{score: number, hits: object[], lines: string[], success: boolean}}
 */
export function scoreAppeal(text, record) {
  const t = String(text ?? '').toLowerCase();
  const hits = [];
  const lines = [];
  let score = 0;

  for (const axis of AXES) {
    if (!axis.match.test(t)) continue;
    const supported = axis.evidence(record);
    const value = supported ? axis.weight : Math.min(0, axis.weight) - 1.5;
    score += value;
    hits.push({ id: axis.id, label: axis.label, supported, value });
    const line = supported ? axis.confirm(record) : axis.deny(record);
    if (line) lines.push(line);
  }

  if (!hits.length) {
    lines.push('The commander listens to the whole of it, and says nothing.');
  }

  return { score, hits, lines, success: score >= 4 };
}

/**
 * Force a channel open with someone whose doctrine is to ignore hails.
 *
 * This is the mechanism half of Kirk's trick — before you can talk your way
 * out, you have to make them answer. It exists in the game already as the
 * `forced` path through resolveHail, added for the Diplomatic career's Parley;
 * this is what finally earns it as a general technique.
 */
export function forceChannel(game) {
  const status = gambitStatus(game);
  if (!status.unlocked) {
    return { ok: false, reasons: status.reasons };
  }
  game.parleyForced = true;
  game.gambitOpen = true;
  emit('gambit:channel-forced', {});
  return { ok: true };
}

/**
 * Resolve the exchange.
 *
 * The outcome is built from the ledger and from what was said. There is no die
 * in it, and there is no menu: this is the one place in the game where the
 * literal text the player typed is the input.
 */
export function resolveGambit(game, text) {
  const record = recordOf(game);
  const result = scoreAppeal(text, record);

  const outcome = {
    ...result,
    record,
    text: String(text ?? ''),
  };

  if (result.success) {
    outcome.reply = 'The Klingon commander leans back. "The freighter is yours, '
      + `${record.name}. We will hold this position while you take them off." `
      + 'The line closes. Nobody fires.';
    game.ledger?.record?.('kobayashi_maru_solved', {
      stardate: game.clock?.format?.(),
      said: outcome.text.slice(0, 240),
      score: result.score,
    });
    game.earnReputation?.('agreement_honoured');
  } else {
    outcome.reply = result.score <= -2
      ? 'The commander cuts the channel. Three cruisers come to weapons hot at once.'
      : 'The commander waits for something worth answering. It does not come. '
        + 'The channel closes.';
  }

  game.gambitOpen = false;
  game.parleyForced = false;
  emit('gambit:resolved', outcome);
  return outcome;
}
