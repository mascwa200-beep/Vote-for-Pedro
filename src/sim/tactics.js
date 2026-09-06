// What the other captain does about it.
//
// The player has twenty-six bridge officer abilities. Every hostile in the game
// had none — an enemy captain flew a course, chose a range, and shot, and that
// was the whole of his repertoire from the first fight to the last. Whatever
// happened to his ship, nothing about how he fought it ever changed.
//
// THE SAME VOCABULARY, DELIBERATELY.
//
// These are the player's own abilities out of `officers.js`, with the player's
// own cooldowns and durations, applied through the player's own `addBuff`. Not
// a parallel set of enemy-only powers: `ai.js` already says of boarding that
// "the rule a captain learns by boarding somebody is the rule that gets used on
// him, and a rule you can learn is the difference between a mechanic and an
// ambush", and that is exactly as true of Attack Pattern Alpha. A player who
// has felt what Emergency Power to Shields does from the inside knows what has
// just happened when a Galor's shields stop falling, and knows that waiting it
// out is a real option because he knows how long it lasts.
//
// AND ANNOUNCED. Every one of these puts a line in the log naming the ship and
// saying what she did. A buff the player cannot see is difficulty, not depth.
//
// The doctrines are the ones in factions.data.js, which `ai.js` already flies
// by — so a faction's tactics and its flying are decided by one field and
// cannot drift apart.

import { ABILITIES } from './officers.js';
import { FACINGS } from './ship.js';

/**
 * How thin the thinnest facing is.
 *
 * NOT `shieldPct`, which is the mean across all six — and `ai.js` already
 * records what that costs, in the note on `boardableState`: "combat never
 * drives that mean to five per cent because fire lands on one facing while the
 * other five regenerate: across forty ordinary engagements the lowest mean a
 * hostile ever reached was 0.497". Written against the mean, "shields nearly
 * gone" fired in one battle in four against a lone D7 — the same trap, in a
 * new file, three hundred lines from the comment warning about it.
 *
 * The thinnest facing is also simply what the order is FOR. A captain reroutes
 * power because the side being hit is failing, not because the average of six
 * numbers has moved.
 */
const weakestShield = (ship) => Math.min(...FACINGS.map((f) => ship.shieldPctOf(f)));

/**
 * Which orders each doctrine's captains actually give, in priority order.
 *
 * Weighted toward the DEFENSIVE and the reactive on purpose. An enemy that
 * simply hits harder is a difficulty slider with extra steps; an enemy whose
 * shields come back up when you have nearly broken them is a fight that asks
 * you a question. Only the two aggressive doctrines get an offensive pattern,
 * and only in the window where they are finishing somebody off.
 *
 * Romulans take `evasive_maneuvers` rather than a second attack pattern
 * because their whole doctrine is to leave once the strike is spent — see the
 * note on BOARDING_DOCTRINES in ai.js for why they do not board either.
 */
export const DOCTRINE_TACTICS = {
  aggressive: ['emergency_power_shields', 'attack_pattern_alpha'],
  ambush: ['attack_pattern_alpha', 'evasive_maneuvers'],
  attrition: ['emergency_power_shields', 'brace_for_impact'],
  territorial: ['emergency_power_shields', 'brace_for_impact'],
  fanatic: ['attack_pattern_alpha', 'brace_for_impact'],
  // Narrower order first, and that ordering is forced rather than chosen. Once
  // `polarize_hull` learned to read the shields, its trigger (a facing under
  // 0.5) strictly CONTAINED `emergency_power_shields`'s (a facing under 0.3
  // with hull left) — so listed above it, the fix for one dead order would
  // have put the order below it into the same shadow that killed
  // `brace_for_impact` on the opportunist. Reversed, the two split the range:
  // shields nearly gone gets the power, shields merely failing gets the
  // plating. Measured either way at 2 and 14 firings, so this costs nothing
  // and stops the list from being a trap for the next person to widen a
  // trigger.
  assimilate: ['emergency_power_shields', 'polarize_hull'],
  // `brace_for_impact` was the second order here and could never be given:
  // zero times in 32 fights across four difficulties.
  //
  // Not because the state was unreachable — a marauder is driven to 0.197 hull
  // still taking orders, well under the 0.45 the brace wants. Because the order
  // ABOVE it swallows it. `evasive_maneuvers` fires at `hullPct < 0.5`, which
  // strictly contains `brace_for_impact`'s `hullPct < 0.45`, and this list is
  // first-match-wins: every state that wanted the brace had already asked for
  // the evasion, so the brace could only ever land inside the evasion's
  // cooldown shadow, and in 32 fights that shadow never opened while the hull
  // was still in range.
  //
  // `emergency_power_shields` overlaps it but is not contained by it — a ship
  // at 0.29 shields and 0.9 hull wants the power and does not want to jink —
  // so the two split the work instead of one eating the other. Measured after
  // the change: 27 firings each.
  opportunist: ['evasive_maneuvers', 'emergency_power_shields'],
  defensive: ['brace_for_impact', 'emergency_power_shields'],
  // Starfleet, which in a fight means the escorts a reputation buys — the only
  // ships in the game flying this doctrine are on the player's side. No kill
  // press: a ship detached to stand with you is there to stand, and a captain
  // who breaks formation to finish somebody off has stopped escorting.
  balanced: ['emergency_power_shields', 'brace_for_impact'],
};

/**
 * When each order is worth giving.
 *
 * Keyed by ability rather than by doctrine, so a tactic means the same thing
 * whoever gives it — a Cardassian bracing for impact and a Jem'Hadar bracing
 * for impact are both a captain who has taken enough.
 *
 * `self` is the ship considering it, `foe` whoever she is fighting.
 *
 * Exported so a guard can ask the real predicates two questions no test could
 * ask while they were private: whether any state a ship actually reaches
 * triggers an order at all, and whether every state that wants an order has
 * already asked for one listed above it. Two orders failed one or the other
 * for years, and both read perfectly well in the source.
 */
export const WHEN = {
  // Shields nearly gone and still in the fight. This is the one that changes
  // a battle most: it is the moment the player thought he had won.
  emergency_power_shields: (self) => weakestShield(self) < 0.3 && self.hullPct > 0.25,
  // Badly hurt. Not a comeback — a way to survive the next thirty seconds.
  brace_for_impact: (self) => self.hullPct < 0.45,
  // The Borg's signature order, and for a long time the one thing the
  // `assimilate` doctrine could never do. Keyed on hull alone it needed
  // `hullPct < 0.55`, and Borg hulls do not go there: measured over six seeds
  // apiece at Captain, the worst a cube ever reached was 0.995 against a
  // Constitution and 0.976 against a Sovereign, and a bioship 0.755. Zero
  // firings, ever, of the first order in the list.
  //
  // Their SHIELDS are a different story — stripped to 0.000 in three of those
  // four matchups. Which is also the truer trigger: polarising the hull
  // plating is what you do when the shields have stopped holding, not when the
  // hull is already open. A cube a Constitution can barely scratch still never
  // bothers, which is the correct answer for that fight.
  polarize_hull: (self) => weakestShield(self) < 0.5 || self.hullPct < 0.55,
  // Going for the kill: they are hurt, we are not, and we are in range.
  attack_pattern_alpha: (self, foe) => foe.hullPct < 0.32 && self.hullPct > 0.4,
  // Hurt and quick. A raider that starts jinking is a raider about to leave.
  evasive_maneuvers: (self) => weakestShield(self) < 0.28 || self.hullPct < 0.5,
};

/**
 * The same orders, given less well.
 *
 * A hostile captain gets the base ability; the player gets it multiplied by
 * `specialistBonusFor` — the sensor analyst and the xenobiologist at the back
 * of the bridge, who are modelled and who a raider does not have. So the
 * asymmetry is the game's own and not a handicap invented here.
 *
 * The numbers are measured, not chosen. Across 192 simulated battles with a
 * pilot that never disengages and never uses an ability of his own, the ship
 * is lost:
 *
 *     no tactics at all                          31 times
 *     1.0 cooldown / 1.0 duration                59
 *     1.4 / 0.75                                 52
 *     1.8 / 0.6                                  47
 *     2.4 / 0.5                                  41
 *
 * At parity the enemy captain is simply better than the player, which is a
 * difficulty change wearing a feature's clothes: a 45-second cooldown holding
 * a 20-second buff is 44% uptime, and something that is true nearly half the
 * time is not a moment. 2.4 and 0.5 put it on a 108-second cycle lasting 10 —
 * about 9% of a battle, which is a captain reacting.
 *
 * WHAT DID NOT SET THESE NUMBERS, though it was used to for an hour:
 * tests/commission.test.js. It plays three whole five-year commissions and
 * asserts at most one ends early, and at 1.8 and 0.6 all three ended with the
 * captain's second ship lost — so it looked like the binding constraint. It is
 * not, and the giveaway is that it is NOT MONOTONE: 1.0/1.0 passes, 1.8/0.6
 * fails, 2.4/0.5 passes. Three seeded campaigns are a chain of events five
 * years long, and a small change in any battle pushes the chain onto a
 * different branch. It is a contract worth holding and it is not a dial. The
 * dial is the 192-fight table above.
 *
 * The remaining increase over no tactics at all is real, and that table is an
 * upper bound on it: the pilot in it never disengages, never uses one of the
 * player's own twenty-six abilities, never targets a subsystem and carries no
 * devices. One that merely breaks off at 35% hull loses the ship 3 times in 96
 * instead of 38.
 */
const COOLDOWN_SCALE = 2.4;
const DURATION_SCALE = 0.5;

/** What the tactical officer says when he sees it happen. */
const SEEN = {
  emergency_power_shields: 'is rerouting power to her shields.',
  brace_for_impact: 'is buttoning up — she is bracing for it.',
  polarize_hull: 'is polarising her hull plating.',
  attack_pattern_alpha: 'is coming in hard. She thinks we are finished.',
  evasive_maneuvers: 'has gone evasive.',
};

/**
 * Give one order, if any is worth giving.
 *
 * Called only on a decision tick, like everything else in `chooseAction`, so a
 * captain re-thinks twice a second rather than every frame.
 *
 * @returns {string|null} the ability given, or null
 */
export function chooseTactic(ship, foe, engagement, doctrine) {
  const list = DOCTRINE_TACTICS[doctrine];
  if (!list || !foe || ship.destroyed || ship.fleeing) return null;
  // Cloaked ships give no orders that would light them up, and a cloak drops
  // the shields anyway, so the shield tactics would be nonsense.
  if (ship.cloaked) return null;

  ship.tacticCooldowns ??= {};
  for (const id of list) {
    if ((ship.tacticCooldowns[id] ?? 0) > 0) continue;
    const a = ABILITIES[id];
    if (!a || !WHEN[id]?.(ship, foe)) continue;

    ship.tacticCooldowns[id] = a.cooldown * COOLDOWN_SCALE;
    ship.addBuff({
      id, label: a.name, until: (a.duration ?? 12) * DURATION_SCALE, mods: a.mods ?? {},
    });
    // `evasive` is a flag on the ship as well as a set of mods, and the
    // player's version of this order sets both. An enemy whose defence
    // multiplier went up while `evasive` stayed false would be getting two
    // thirds of the order.
    if (a.special === 'evasive') ship.evasive = true;
    engagement?.pushLog(`${ship.name} ${SEEN[id] ?? 'is changing her tactics.'}`, 'tactical');
    return id;
  }
  return null;
}

/**
 * Tick the cooldowns, and take back the flag `evasive` sets.
 *
 * The buff expires on its own — `Ship.update` ages those — but `ship.evasive`
 * is a plain boolean nothing would ever clear, so a raider that went evasive
 * once would have flown evasive for the rest of the engagement on a fifteen
 * second order.
 */
export function tickTactics(ship, dt) {
  if (!ship.tacticCooldowns) return;
  for (const id of Object.keys(ship.tacticCooldowns)) {
    ship.tacticCooldowns[id] = Math.max(0, ship.tacticCooldowns[id] - dt);
  }
  if (ship.evasive && !ship.buffs?.some?.((b) => b.id === 'evasive_maneuvers')) {
    ship.evasive = false;
  }
}
