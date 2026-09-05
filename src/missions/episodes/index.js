import { CORE_EPISODES } from './core.js';
import { FRONTIER_EPISODES } from './frontier.js';
import { CAPITAL_EPISODES } from './capitals.js';
import { ACCORD_EPISODES } from './accords.js';
import { CONSEQUENCE_EPISODES } from './consequences.js';
import { ECHO_EPISODES } from './echoes.js';
import { LONG_WATCH_EPISODES } from './longwatch.js';

export const EPISODES = [
  ...CORE_EPISODES, ...FRONTIER_EPISODES, ...CAPITAL_EPISODES, ...ACCORD_EPISODES,
  ...CONSEQUENCE_EPISODES, ...ECHO_EPISODES, ...LONG_WATCH_EPISODES,
];

export const EPISODE_BY_ID = Object.fromEntries(EPISODES.map((e) => [e.id, e]));

/** Episodes attached to each system, for the map's mission markers. */
export const EPISODES_BY_SYSTEM = EPISODES.reduce((acc, e) => {
  if (!e.system) return acc;
  (acc[e.system] ??= []).push(e);
  return acc;
}, {});
