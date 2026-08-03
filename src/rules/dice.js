// The d20 layer.
//
// Every uncertain action in the game — an away team forcing a door, a
// negotiation, a science analysis, a saving throw against a plasma burst —
// resolves through this module. It is deliberately conventional: ability
// scores, a proficiency bonus, a target number, advantage, and criticals.
// If you have played a tabletop RPG you already know how this works.
//
// All randomness comes from the seeded 64-bit RNG, so a roll is reproducible
// and the whole session can be replayed from its seed.

/** Standard polyhedral roll. `n` dice of `sides`, plus a flat modifier. */
export function roll(rng, n, sides, modifier = 0) {
  const dice = [];
  for (let i = 0; i < n; i++) dice.push(rng.int(1, sides));
  return { dice, total: dice.reduce((a, b) => a + b, 0) + modifier, modifier };
}

export const d = (rng, sides) => rng.int(1, sides);

/** 5e-style ability modifier: (score - 10) / 2, rounded down. */
export function abilityMod(score) {
  return Math.floor((score - 10) / 2);
}

/** Proficiency scales with character level, 2 at level 1 up to 6 at 17+. */
export function proficiencyBonus(level) {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

export const DC = {
  trivial: 5,
  easy: 10,
  moderate: 12,
  hard: 15,
  very_hard: 18,
  formidable: 20,
  legendary: 25,
  impossible: 30,
};

export const DC_LABEL = {
  5: 'Trivial', 10: 'Easy', 12: 'Moderate', 15: 'Hard',
  18: 'Very Hard', 20: 'Formidable', 25: 'Legendary', 30: 'Near Impossible',
};

export function describeDC(dc) {
  const keys = Object.keys(DC_LABEL).map(Number).sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) if (dc >= k) best = k;
  return DC_LABEL[best];
}

/**
 * The core resolution.
 *
 * @param {RNG} rng
 * @param {object} opts
 *   modifier      total bonus (ability mod + proficiency + situational)
 *   dc            target number
 *   advantage     roll twice, keep the higher
 *   disadvantage  roll twice, keep the lower (cancels advantage)
 *   luck          extra rerolls of a natural 1 (Story difficulty grants these)
 *   critRange     natural roll at or above this is a critical success (default 20)
 * @returns {object} full, inspectable result — the UI shows the arithmetic
 */
export function check(rng, {
  modifier = 0, dc = 12, advantage = false, disadvantage = false,
  luck = 0, critRange = 20, label = '',
} = {}) {
  // Advantage and disadvantage cancel exactly, as in the tabletop rules.
  const adv = advantage && !disadvantage;
  const dis = disadvantage && !advantage;

  const rolls = [d(rng, 20)];
  if (adv || dis) rolls.push(d(rng, 20));

  let natural = adv ? Math.max(...rolls) : dis ? Math.min(...rolls) : rolls[0];

  // Luck lets a fumble be re-rolled a limited number of times.
  let lucked = 0;
  while (natural === 1 && lucked < luck) {
    natural = d(rng, 20);
    rolls.push(natural);
    lucked++;
  }

  const total = natural + modifier;
  const criticalSuccess = natural >= critRange;
  const criticalFailure = natural === 1;

  // A natural 20 always succeeds; a natural 1 always fails. That is the
  // whole point of having dice.
  const success = criticalSuccess ? true : criticalFailure ? false : total >= dc;

  return {
    label, natural, rolls, modifier, total, dc,
    success, criticalSuccess, criticalFailure,
    margin: total - dc,
    advantage: adv, disadvantage: dis, lucked,
    // How comfortably it went, for prose and for partial successes.
    degree: criticalFailure ? -2
      : !success && total >= dc - 4 ? -1     // near miss
      : !success ? -2
      : criticalSuccess ? 2
      : total >= dc + 5 ? 1
      : 0,
  };
}

/** Two parties roll against each other; ties go to the defender. */
export function contest(rng, attacker, defender) {
  const a = check(rng, { ...attacker, dc: 0 });
  const b = check(rng, { ...defender, dc: 0 });
  return {
    attacker: a, defender: b,
    attackerWins: a.total > b.total,
    margin: a.total - b.total,
  };
}

/** A saving throw is a check against an externally-set DC. */
export function save(rng, opts) {
  return check(rng, { ...opts, label: opts.label || 'saving throw' });
}

/** Format a roll for the log, showing the arithmetic so it can be trusted. */
export function formatCheck(result, skillName = '') {
  const sign = result.modifier >= 0 ? '+' : '−';
  const mod = Math.abs(result.modifier);
  const dice = result.rolls.length > 1 ? `[${result.rolls.join(', ')}]` : `${result.natural}`;
  const advNote = result.advantage ? ' adv' : result.disadvantage ? ' dis' : '';
  const head = skillName ? `${skillName}: ` : '';
  const verdict = result.criticalSuccess ? 'CRITICAL SUCCESS'
    : result.criticalFailure ? 'CRITICAL FAILURE'
    : result.success ? 'success' : 'failure';
  return `${head}d20 ${dice}${advNote} ${sign} ${mod} = ${result.total} vs DC ${result.dc} — ${verdict}`;
}

/** Damage expression roller, e.g. "2d6+3". Used by away-team combat. */
export function rollDamage(rng, expression) {
  const m = /^(\d+)d(\d+)\s*([+-]\s*\d+)?$/.exec(String(expression).replace(/\s/g, ''));
  if (!m) return { total: 0, dice: [] };
  const n = parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  const mod = m[3] ? parseInt(m[3].replace(/\s/g, ''), 10) : 0;
  return roll(rng, n, sides, mod);
}
