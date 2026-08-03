// Making things, and making do.
//
// The engineering solution is half of what a starship captain does and none of
// what this game could previously express. If you were trapped, your options
// were to shoot your way out or to leave. This file is the third option: work
// out what you have, work out what it could be, and spend the hours building it.
//
// Two rules shape everything here.
//
// EVERY RECIPE HAS A REAL EFFECT. No item exists as a line in an inventory
// screen. `apply` mutates the game, and tests/wiring.test.js walks this table
// and fails on any recipe whose effect is not observable — the same rule that
// caught three inert features in this repository already.
//
// EVERYTHING TAKES THE TIME IT TAKES. A jury-rigged bypass is twenty minutes; a
// replacement sensor pallet is two days. Those hours run on the commission
// clock, which means they run whether the app is open or not, and a plan that
// needs two days is a plan you commit to rather than a button you press.

import { emit } from '../core/events.js';

/**
 * What a ship carries that can be turned into something else.
 *
 * Deliberately short. A long materials list is a spreadsheet; four categories
 * is enough to make "do we have what we need" a real question without making
 * it an accounting exercise.
 */
export const MATERIALS = {
  duranium: { id: 'duranium', name: 'Duranium', of: 'structural stock — plating, spars, hull patches' },
  isolinear: { id: 'isolinear', name: 'Isolinear circuitry', of: 'optical chips and control runs' },
  deuterium: { id: 'deuterium', name: 'Deuterium', of: 'reaction mass and raw power' },
  salvage: { id: 'salvage', name: 'Salvage', of: 'whatever the last wreck gave up' },
};

export const MATERIAL_LIST = Object.values(MATERIALS);

/** Stores a ship leaves a starbase with. */
export const STARTING_STORES = { duranium: 40, isolinear: 30, deuterium: 60, salvage: 0 };

/**
 * The recipe book.
 *
 * `hours` is campaign time. `needs` is materials. `requires` is an optional
 * predicate on the game — a state the ship must be in for the work to make
 * sense — and `apply` is what actually happens.
 */
export const RECIPES = [
  {
    id: 'hull_patch',
    name: 'Hull patch',
    blurb: 'Plate over a breach with structural stock. Ugly, and it holds.',
    needs: { duranium: 12 },
    hours: 5,
    requires: (g) => g.ship.hullPct < 0.95,
    apply: (g) => {
      const before = g.ship.hullPct;
      g.ship.repair(g.ship.maxHull * 0.15);
      return `Hull integrity ${Math.round(before * 100)} → ${Math.round(g.ship.hullPct * 100)} percent.`;
    },
  },
  {
    id: 'torpedo_casings',
    name: 'Torpedo casings',
    blurb: 'Machine new casings and load them. Slow work, and it beats an empty magazine.',
    needs: { duranium: 8, deuterium: 14 },
    hours: 9,
    requires: (g) => g.ship.maxTorpedoes > 0 && g.ship.torpedoes < g.ship.maxTorpedoes,
    apply: (g) => {
      const made = Math.min(10, g.ship.maxTorpedoes - g.ship.torpedoes);
      g.ship.torpedoes += made;
      return `${made} torpedoes in the magazine.`;
    },
  },
  {
    id: 'sensor_pallet',
    name: 'Replacement sensor pallet',
    blurb: 'Rebuild the forward array from spares. Two days, and you can see again.',
    needs: { isolinear: 22, duranium: 6 },
    hours: 48,
    requires: (g) => g.ship.subsystems.sensors < 0.9,
    apply: (g) => {
      g.ship.subsystems.sensors = Math.min(1, g.ship.subsystems.sensors + 0.5);
      return `Sensors restored to ${Math.round(g.ship.subsystems.sensors * 100)} percent.`;
    },
  },
  {
    id: 'eps_bypass',
    name: 'Jury-rigged EPS bypass',
    blurb: 'Route power around the damaged conduits. Twenty minutes and a lot of swearing.',
    needs: { isolinear: 6 },
    hours: 0.4,
    apply: (g) => {
      g.ship.power.transferRate = Math.max(g.ship.power.transferRate, 160);
      g.ship.addBuff({ id: 'eps_bypass', label: 'EPS bypass', until: 900, mods: { shieldRegen: 1.2 } });
      return 'Power routing is quicker while the bypass holds.';
    },
  },
  {
    id: 'graviton_charge',
    name: 'Improvised graviton charge',
    blurb: 'A deuterium charge with a graviton shell. It will move something that does not want to move.',
    needs: { deuterium: 20, isolinear: 8, salvage: 4 },
    hours: 6,
    apply: (g) => {
      g.devices = g.devices ?? {};
      g.devices.graviton_charge = (g.devices.graviton_charge ?? 0) + 1;
      return 'One graviton charge, secured in the shuttle bay.';
    },
  },
  {
    id: 'sensor_decoy',
    name: 'Sensor decoy',
    blurb: 'A second ion pod, more or less. Something else for them to shoot at.',
    needs: { duranium: 10, isolinear: 10, deuterium: 8 },
    hours: 14,
    requires: (g) => g.podJettisoned,
    apply: (g) => {
      g.podJettisoned = false;
      return 'A replacement pod is in the launcher.';
    },
  },
  {
    id: 'shield_harmonics',
    name: 'Rotating shield harmonics',
    blurb: 'Recalibrate the emitters to a shifting frequency. It does not last, and it works.',
    needs: { isolinear: 14, deuterium: 10 },
    hours: 3,
    apply: (g) => {
      g.ship.addBuff({
        id: 'shield_harmonics', label: 'Rotating harmonics', until: 600,
        mods: { shieldMax: 1.2, shieldRegen: 1.35 },
      });
      return 'Shields are running a rotating frequency. It will hold for a while.';
    },
  },
  {
    id: 'coolant_purge',
    name: 'Coolant purge rig',
    blurb: 'Vent the coolant lines into the affected sections. Puts fires out, and costs you the coolant.',
    needs: { deuterium: 12 },
    hours: 1,
    requires: (g) => g.ship.fires > 0,
    apply: (g) => {
      const put = g.ship.fires;
      g.ship.fires = 0;
      return `${put} fire${put > 1 ? 's' : ''} out. Decks are cold and breathable.`;
    },
  },
];

export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

/** Everything the fabricator can make right now, and why it cannot. */
export function availableRecipes(game) {
  return RECIPES.map((r) => {
    const short = Object.entries(r.needs)
      .filter(([m, n]) => (game.stores?.[m] ?? 0) < n)
      .map(([m]) => MATERIALS[m]?.name ?? m);
    const wrongState = r.requires ? !r.requires(game) : false;
    return {
      recipe: r,
      canMake: short.length === 0 && !wrongState,
      short,
      reason: short.length ? `Not enough ${short.join(' or ')}.`
        : wrongState ? 'Nothing aboard needs it.' : null,
    };
  });
}

/**
 * Begin fabricating. The materials are spent now; the thing arrives later.
 *
 * Only one job runs at a time, on purpose. A ship with one machine shop and one
 * chief engineer cannot build four things at once, and being made to choose is
 * the entire interest of the mechanic.
 */
export function beginFabrication(game, recipeId) {
  const recipe = RECIPE_BY_ID[recipeId];
  if (!recipe) return { ok: false, reason: 'No such specification on file.' };
  if (game.fabrication) {
    return { ok: false, reason: `The shop is already building ${RECIPE_BY_ID[game.fabrication.recipeId]?.name ?? 'something'}.` };
  }

  game.stores = game.stores ?? { ...STARTING_STORES };
  for (const [material, amount] of Object.entries(recipe.needs)) {
    if ((game.stores[material] ?? 0) < amount) {
      return { ok: false, reason: `Not enough ${MATERIALS[material]?.name ?? material}.` };
    }
  }
  if (recipe.requires && !recipe.requires(game)) {
    return { ok: false, reason: 'Nothing aboard needs it, Captain.' };
  }

  for (const [material, amount] of Object.entries(recipe.needs)) {
    game.stores[material] -= amount;
  }
  game.fabrication = { recipeId, hoursRemaining: recipe.hours, hoursTotal: recipe.hours };

  game.officerSays('engineering',
    recipe.hours < 1
      ? `${recipe.name} — give me ${Math.round(recipe.hours * 60)} minutes.`
      : `${recipe.name} — ${recipe.hours < 24 ? `${Math.round(recipe.hours)} hours` : `${(recipe.hours / 24).toFixed(1)} days`}, Captain.`,
    'report');
  emit('fabrication:begin', { recipe });
  return { ok: true, recipe };
}

/**
 * Advance the current job by campaign hours.
 * Called from the same place absences are credited, so work continues while the
 * app is closed — which is the whole point of a job measured in days.
 */
export function advanceFabrication(game, hours) {
  if (!game.fabrication || hours <= 0) return null;
  game.fabrication.hoursRemaining -= hours;
  if (game.fabrication.hoursRemaining > 0) return null;

  const recipe = RECIPE_BY_ID[game.fabrication.recipeId];
  game.fabrication = null;
  if (!recipe) return null;

  const text = recipe.apply(game) ?? `${recipe.name} complete.`;
  game.officerSays('engineering', `${recipe.name} is finished. ${text}`, 'report');
  emit('fabrication:complete', { recipe, text });
  return { recipe, text };
}

/**
 * Recover materials from a wreck.
 *
 * This is where salvage comes from, and it is the reason destroying something
 * is not always the same as winning: a hulk you leave intact is stores you do
 * not have.
 */
export function salvageWreck(game, rng, { tier = 3 } = {}) {
  game.stores = game.stores ?? { ...STARTING_STORES };
  const haul = {
    duranium: Math.round(rng.range(4, 10) * tier * 0.5),
    isolinear: Math.round(rng.range(2, 7) * tier * 0.4),
    salvage: Math.round(rng.range(3, 9) * tier * 0.5),
  };
  for (const [m, n] of Object.entries(haul)) game.stores[m] = (game.stores[m] ?? 0) + n;
  emit('salvage', haul);
  return haul;
}
