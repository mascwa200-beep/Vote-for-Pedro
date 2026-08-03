// The intent lexicon.
//
// One entry per thing a captain can order. Each entry carries the phrasings
// that identify it, the individual words that hint at it, the words that rule it
// out, and a builder that turns the extracted entities into the command object
// the game executes.
//
// This is data, and it is deliberately verbose. The parser is only as good as
// the number of ways it has seen an order phrased, and every phrase in here is
// one the fallback prompt no longer has to handle.
//
// THE RULE THIS FILE LIVES UNDER: every intent must produce an action that the
// game observably executes. `tests/lang.test.js` walks this table and fails if
// any intent produces an action with no handler. Three features once shipped
// documented and inert in this repository; a lexicon is the easiest possible
// place for that to happen again, so it is checked mechanically.

import { fold } from './normalize.js';

/** Departments an order can be aimed at, used to break ties. */
export const STATION_AFFINITY = {
  helm: ['set_course', 'warp_factor', 'throttle', 'come_about', 'heading',
    'evasive', 'warp_out', 'dock', 'all_stop'],
  tactical: ['fire', 'cease_fire', 'target_nearest', 'cycle_target',
    'target_subsystem', 'shields', 'reinforce', 'alert'],
  engineering: ['power', 'preset', 'eject_core', 'reinforce'],
  science: ['scan'],
  comms: ['hail', 'demand_surrender'],
  medical: [],
  transporter: ['transport', 'away_team'],
  security: [],
  ops: [],
  shuttlebay: [],
  damagecontrol: [],
  environmental: [],
  computer: [],
};

// Calling a station on the intercom is the one intent that is *about* being
// addressed to a station, so every station favours it.
for (const list of Object.values(STATION_AFFINITY)) list.push('intercom');

/**
 * @typedef {object} Intent
 * @property {string} id
 * @property {string} help          one-line form shown in the manual
 * @property {string[]} phrases     multi-word forms; the strongest signal
 * @property {object} keywords      token -> weight
 * @property {string[]} [veto]      tokens that rule this intent out entirely
 * @property {string[]} [requires]  entity slots that must be filled
 * @property {Function} build       (ctx) -> command object
 */

/** @type {Intent[]} */
export const INTENTS = [
  // ------------------------------------------------------------------
  // Navigation
  // ------------------------------------------------------------------
  {
    id: 'set_course',
    help: 'Helm, set course for <system>, warp <n>',
    phrases: [
      'set course', 'set a course', 'lay in a course', 'lay in course',
      'plot a course', 'plot course', 'chart a course', 'course for',
      'course to', 'take us to', 'take us out to', 'get us to', 'head for',
      'head to', 'head over to', 'make for', 'proceed to', 'travel to',
      'fly to', 'go to', 'move to', 'warp to', 'set sail for', 'bring us to',
      'navigate to', 'destination', 'next stop', 'point us at', 'aim for',
      'i want to go to', 'lets go to', 'take me to', 'off to',
      'take us home', 'head home', 'go home', 'return to', 'back to',
      'set course home', 'bring us home', 'return us to', 'divert to',
    ],
    keywords: { course: 2, destination: 2, navigate: 1.5, plot: 1, lay: 0.8, travel: 1 },
    veto: ['bearing'],
    requires: ['place'],
    build: (c) => ({
      action: 'course',
      system: c.place.id,
      warp: c.warp ?? 6,
    }),
  },
  {
    id: 'warp_factor',
    help: 'Warp <n> / maximum warp',
    phrases: [
      'warp factor', 'go to warp', 'engage warp', 'jump to warp', 'maximum warp',
      'best speed', 'full warp', 'punch it', 'engage', 'warp speed',
      'increase speed to warp', 'take her to warp', 'light speed',
      'top speed', 'flank speed', 'all the speed she has', 'emergency warp',
      'warp drive engage', 'hit it', 'lets move',
    ],
    keywords: { warp: 2 },
    veto: ['course', 'destination', 'core', 'eject', 'jettison'],
    vetoSlots: ['place'],
    // Soft rather than required: "go to warp" needs no interrogation about
    // which factor. It means go fast, and the helm picks a sensible number.
    soft: ['warp'],
    build: (c) => ({
      action: 'warp_factor',
      warp: c.warp ?? (/\b(?:maximum|max|best|top|flank|full|emergency|punch|hit it)\b/.test(c.text) ? 9.9 : 6),
    }),
  },
  {
    id: 'all_stop',
    help: 'All stop / hold position',
    phrases: [
      'all stop', 'full stop', 'come to a stop', 'bring us to a stop',
      'hold position', 'holding position', 'station keeping', 'keep station',
      'hold here', 'stay put', 'stop the ship', 'halt', 'stop us',
      'cut the engines', 'kill the engines', 'stop moving', 'dead stop',
      'maintain position', 'hold us here', 'stand still',
    ],
    keywords: { stop: 2, halt: 2, hold: 1 },
    veto: ['fire', 'firing'],
    build: () => ({ action: 'throttle', value: 0 }),
  },
  {
    id: 'throttle',
    help: 'Ahead full / ahead one third / slow to half',
    phrases: [
      'ahead full', 'ahead one third', 'ahead two thirds', 'ahead half',
      'ahead slow', 'ahead standard', 'full impulse', 'half impulse',
      'quarter impulse', 'one quarter impulse', 'dead slow', 'slow down',
      'speed up', 'increase speed', 'reduce speed', 'throttle up',
      'throttle down', 'more speed', 'less speed', 'take it slow',
      'step on it', 'faster', 'slower', 'give her more', 'open her up',
      'impulse power', 'impulse speed', 'engine power',
    ],
    keywords: { impulse: 2, throttle: 2, ahead: 1.5, speed: 1, thruster: 1 },
    veto: ['warp', 'course'],
    build: (c) => {
      const t = c.text;
      let v = 1;
      if (/\b(?:one third|1\/3)\b/.test(t)) v = 1 / 3;
      else if (/\btwo thirds?\b|\b2\/3\b/.test(t)) v = 2 / 3;
      else if (/\b(?:half|1\/2)\b/.test(t)) v = 0.5;
      else if (/\b(?:quarter|1\/4)\b/.test(t)) v = 0.25;
      else if (/\b(?:dead slow|crawl)\b/.test(t)) v = 0.15;
      else if (/\b(?:slow|reduce|decrease|down|less|slower)\b/.test(t)) v = 0.35;
      else if (c.percent !== null) v = Math.min(1, c.percent / 100);
      return { action: 'throttle', value: v };
    },
  },
  {
    id: 'come_about',
    help: 'Come about / bring us around / bearing <n> mark <n>',
    phrases: [
      'come about', 'bring us around', 'bring us about', 'turn around',
      'turn us around', 'come around', 'face them', 'face him', 'turn into them',
      'turn to face', 'point us at them', 'bring the bow around',
      'get our nose on them', 'swing around', 'wheel about', 'about face',
      'present our bow', 'line up on them', 'come to bearing', 'steer to',
      'change heading', 'new heading', 'alter course to bearing',
    ],
    keywords: { bearing: 2, heading: 2, about: 1.2, turn: 1, face: 1, steer: 1.2 },
    build: (c) => (c.bearing
      ? { action: 'heading', value: c.bearing.bearing, mark: c.bearing.mark }
      : { action: 'come_about' }),
  },
  {
    id: 'evasive',
    help: 'Evasive maneuvers',
    phrases: [
      'evasive maneuver', 'evasive action', 'evasive pattern', 'take evasive',
      'start evading', 'stop evading', 'dodge', 'juke', 'shake them',
      'shake them off', 'lose them', 'jink', 'zigzag', 'serpentine',
      'do not fly straight', 'random course', 'unpredictable course',
    ],
    keywords: { evasive: 3, evade: 2, dodge: 2, jink: 2, maneuver: 1 },
    build: (c) => ({ action: 'evasive', value: !c.negated }),
  },
  {
    id: 'warp_out',
    help: 'Get us out of here / break off',
    phrases: [
      'get us out of here', 'get us out', 'get out of here', 'break off',
      'break off the attack', 'break off the engagement', 'disengage',
      'retreat', 'withdraw', 'pull back', 'pull out', 'fall back', 'run for it',
      'run away', 'flee', 'escape', 'we are leaving', 'time to go',
      'abandon the fight', 'we cannot win this', 'jump out', 'warp out',
      'get us clear', 'clear the area', 'leave now', 'bug out', 'get us gone',
      'i want out', 'lets get out of here', 'no more of this',
    ],
    keywords: { retreat: 3, withdraw: 3, flee: 3, escape: 2.5, disengage: 3, run: 1.5 },
    build: () => ({ action: 'warp_out' }),
  },
  {
    id: 'dock',
    help: 'Request docking / put in for repairs',
    phrases: [
      'request docking', 'docking clearance', 'permission to dock', 'dock with',
      'put in for repairs', 'put in for resupply', 'take on supplies',
      'resupply', 'refit', 'repair the ship', 'go to spacedock', 'dock us',
      'bring us alongside', 'moor', 'shore leave', 'restock', 'rearm',
      'take on torpedoes', 'reload torpedoes', 'refuel',
    ],
    keywords: { dock: 3, docking: 3, resupply: 3, repair: 1.5, refit: 3, spacedock: 3, rearm: 2 },
    build: () => ({ action: 'dock' }),
  },

  // ------------------------------------------------------------------
  // Alert and shields
  // ------------------------------------------------------------------
  {
    id: 'alert',
    help: 'Red alert / yellow alert / stand down',
    phrases: [
      'red alert', 'yellow alert', 'condition red', 'condition yellow',
      'condition green', 'battle stations', 'general quarters', 'go to red',
      'go to yellow', 'stand down', 'secure from alert', 'sound the alarm',
      'all hands to battle stations', 'action stations', 'stand down from alert',
      'cancel the alert', 'back to normal', 'alert status',
      // Blue alert: the maintenance and docking condition. Documented in
      // docs/RESEARCH.md and the one of the three the game did not have.
      'blue alert', 'condition blue', 'secure for docking',
      'secure for separation', 'maintenance stations', 'rig for docking',
    ],
    keywords: { alert: 3, condition: 1.5, quarters: 2, klaxon: 2, alarm: 2, battle: 1.5, station: 0.8 },
    veto: ['weapon', 'phaser', 'torpedo'],
    build: (c) => {
      const t = c.text;
      let level = 'yellow';
      if (/\b(?:blue|docking|maintenance|separation)\b/.test(t)) level = 'blue';
      else if (/\b(?:red|battle station|action station|general quarters|combat)/.test(t)) level = 'red';
      else if (/\b(?:green|stand down|secure|normal|cancel)\b/.test(t)) level = 'normal';
      else if (/\byellow\b/.test(t)) level = 'yellow';
      else if (c.negated) level = 'normal';
      return { action: 'alert', level };
    },
  },
  {
    id: 'shields',
    help: 'Shields up / shields down',
    phrases: [
      'shield up', 'shield down', 'raise shield', 'lower shield', 'drop shield',
      'put up the shield', 'take down the shield', 'bring up the shield',
      'shield to maximum', 'deflector up', 'screens up', 'screens down',
      'get the shield up', 'we need shield', 'kill the shield',
      'shield off', 'shield on', 'defenses up', 'defenses down',
    ],
    keywords: { shield: 2.5, deflector: 2, screen: 1.5, raise: 1.2, lower: 1.2 },
    veto: ['reinforce', 'bolster', 'strengthen', 'shore', 'thicken', 'harden',
      'double', 'brace', 'power', 'divert', 'target'],
    build: (c) => ({
      action: 'shields',
      up: !/\b(?:down|lower|drop|off|kill|take down)\b/.test(c.text),
    }),
  },
  {
    id: 'reinforce',
    help: 'Reinforce the forward shields',
    phrases: [
      'reinforce the shield', 'strengthen the shield', 'bolster the shield',
      'shore up the shield', 'transfer power to the shield', 'more power to the shield',
      'double up the shield', 'thicken the shield', 'brace the shield',
      'all power to the forward shield', 'reinforce forward', 'reinforce aft',
      'harden the shield', 'boost the shield', 'shore up', 'double up',
      'thicken', 'more shield on the', 'extra shield',
    ],
    keywords: {
      reinforce: 3, strengthen: 3, bolster: 3, harden: 2.5, boost: 1.5,
      shore: 2.5, thicken: 2.5, double: 2, brace: 2,
    },
    requires: ['facing'],
    build: (c) => ({ action: 'reinforce', facing: c.facing }),
  },

  // ------------------------------------------------------------------
  // Power
  // ------------------------------------------------------------------
  {
    id: 'power',
    help: 'Divert power to shields / weapons / engines',
    phrases: [
      'divert power', 'reroute power', 'transfer power', 'shift power',
      'shunt power', 'route power', 'redirect power', 'send power',
      'give me more power', 'more power to', 'all power to', 'power to',
      'emergency power to', 'take power from', 'reallocate power',
      'i need power in', 'juice up', 'feed the', 'channel power',
    ],
    keywords: { power: 2.5, divert: 3, reroute: 3, energy: 1.5, eps: 2 },
    veto: ['preset', 'posture', 'configuration'],
    requires: ['powerChannel'],
    build: (c) => ({
      action: 'power',
      subsystem: c.powerChannel,
      amount: /\b(?:all|maximum|everything|emergency|full)\b/.test(c.text) ? 100
        : (c.percent ?? 25),
    }),
  },
  {
    id: 'preset',
    help: 'Attack posture / defensive posture / balanced power',
    phrases: [
      'attack posture', 'attack pattern power', 'attack configuration',
      'defense posture', 'defense configuration', 'defensive stance',
      'speed configuration', 'science configuration', 'balanced power',
      'standard distribution', 'standard power', 'combat power', 'rig for battle',
      'rig for speed', 'rig for silent running', 'set condition for attack',
    ],
    keywords: { posture: 3, configuration: 2.5, preset: 3, distribution: 2, stance: 2.5 },
    build: (c) => {
      const t = c.text;
      const preset = /\battack\b|\bcombat\b|\boffensive\b/.test(t) ? 'attack'
        : /\bdefense\b|\bdefensive\b/.test(t) ? 'defense'
        : /\bspeed\b|\bfast\b|\brun\b/.test(t) ? 'speed'
        : /\bscience\b|\bscan\b|\bsensor\b/.test(t) ? 'science'
        : 'balanced';
      return { action: 'preset', preset };
    },
  },

  // ------------------------------------------------------------------
  // Weapons
  // ------------------------------------------------------------------
  {
    id: 'target_subsystem',
    help: 'Target their engines / weapons / warp core',
    phrases: [
      'target their', 'aim for their', 'go for their', 'hit their',
      'focus fire on their', 'concentrate fire on their', 'take out their',
      'knock out their', 'disable their', 'cripple their', 'shoot their',
      'lock onto their', 'put a torpedo into their', 'aim at their',
      'i want their', 'take down their',
    ],
    keywords: { target: 2, aim: 2, disable: 2.5, cripple: 2.5, 'knock': 1.5 },
    requires: ['targetSystem'],
    build: (c) => ({ action: 'target_subsystem', subsystem: c.targetSystem }),
  },
  {
    id: 'cycle_target',
    help: 'Next target / switch targets',
    phrases: [
      'next target', 'switch target', 'change target', 'cycle target',
      'new target', 'another target', 'different target', 'other ship',
      'switch to the other one', 'pick a new target', 'retarget',
    ],
    keywords: { next: 2, switch: 2, cycle: 2.5, retarget: 3 },
    build: () => ({ action: 'cycle_target' }),
  },
  {
    id: 'target_nearest',
    help: 'Target the lead ship',
    phrases: [
      'target the nearest', 'target the closest', 'target the lead',
      'lock weapons on', 'lock onto', 'lock on', 'acquire a target',
      'get a lock', 'target that ship', 'target them', 'target the biggest',
      'paint the target', 'designate target', 'that one',
    ],
    keywords: { target: 2, lock: 2.5, acquire: 2, designate: 2 },
    veto: ['engine', 'weapon', 'shield', 'core', 'sensor', 'nacelle'],
    build: () => ({ action: 'target_nearest' }),
  },
  {
    id: 'fire',
    help: 'Fire / fire phasers / fire torpedoes',
    phrases: [
      'open fire', 'fire at will', 'fire everything', 'fire all weapons',
      'weapons free', 'let them have it', 'give them everything',
      'shoot them', 'take the shot', 'fire when ready', 'fire phaser',
      'fire torpedo', 'fire a full spread', 'full spread', 'launch torpedo',
      'unload on them', 'hit them', 'attack', 'engage them', 'return fire',
      'blow them out of the sky', 'put them down', 'kill them', 'destroy them',
      'light them up', 'all batteries', 'commence firing', 'shoot',
    ],
    keywords: { fire: 3, shoot: 3, attack: 1.5, launch: 1.5, torpedo: 1.5, phaser: 1.5 },
    veto: ['cease', 'hold', 'stop', 'cancel', 'check', 'safe',
      'build', 'fabricate', 'replicate', 'improvise', 'machine', 'salvage'],
    build: (c) => ({
      action: 'fire',
      weaponType: /\b(?:torpedo|photon|spread|launch)\b/.test(c.text) ? 'torpedo'
        : /\b(?:phaser|beam|laser|battery|batteries)\b/.test(c.text) ? 'beam'
        : 'all',
    }),
  },
  {
    id: 'cease_fire',
    help: 'Cease fire / hold fire',
    phrases: [
      'cease fire', 'hold fire', 'stop firing', 'weapons hold', 'check fire',
      'do not fire', 'stop shooting', 'stand down weapons', 'guns cold',
      'no more shooting', 'stop the attack', 'hold your fire', 'weapons safe',
      'guns cold', 'belay that order to fire',
    ],
    keywords: { cease: 3.5, hold: 1.5, check: 1.5 },
    build: () => ({ action: 'cease_fire' }),
  },

  // ------------------------------------------------------------------
  // Communications
  // ------------------------------------------------------------------
  {
    id: 'hail',
    help: 'Open a channel / hail them',
    phrases: [
      'open a channel', 'open channel', 'hailing frequencies', 'hail them',
      'hail the ship', 'hail that vessel', 'contact them', 'call them',
      'get them on the line', 'put them on screen', 'on screen', 'onscreen',
      'let me talk to them', 'i want to speak to them', 'talk to them',
      'signal them', 'send a message', 'raise them', 'try to communicate',
      'establish contact', 'greetings', 'say hello', 'answer the hail',
      'speak to them', 'speak to', 'talk to', 'get them on',
      'respond to the hail', 'put them through',
    ],
    keywords: { hail: 3.5, channel: 2.5, contact: 2, communicate: 2.5, frequencies: 3 },
    build: () => ({ action: 'hail' }),
  },
  {
    id: 'demand_surrender',
    help: 'Demand their surrender',
    phrases: [
      'demand their surrender', 'demand surrender', 'tell them to surrender',
      'order them to surrender', 'tell them to stand down',
      'tell them to drop their shield', 'call on them to surrender',
      'give them a chance to surrender', 'surrender or be destroyed',
      'lay down your arms', 'yield',
    ],
    keywords: { surrender: 3.5, yield: 2.5, capitulate: 3 },
    build: () => ({ action: 'hail_option', option: 'demand_surrender' }),
  },

  // ------------------------------------------------------------------
  // Ship's systems
  // ------------------------------------------------------------------
  {
    id: 'scan',
    help: 'Scan them / full sensor sweep',
    phrases: [
      'scan them', 'scan the ship', 'scan the area', 'full scan',
      'sensor sweep', 'full sensor sweep', 'run a scan', 'analyze them',
      'what are we looking at', 'what is out there', 'read them',
      'give me readings', 'sensor readings', 'what do the sensors say',
      'look them over', 'probe them', 'survey', 'examine', 'study them',
      'what can you tell me about', 'identify them', 'who are they',
    ],
    keywords: { scan: 3, sensor: 2, sweep: 2, analyze: 2.5, readings: 2.5, probe: 2 },
    build: () => ({ action: 'scan' }),
  },
  {
    id: 'status',
    help: 'Damage report / status report',
    phrases: [
      'damage report', 'status report', 'report', 'sitrep', 'situation report',
      'how are we', 'how are we doing', 'how bad is it', 'what is our status',
      'give me a status', 'condition of the ship', 'how is the ship',
      'casualty report', 'what is our condition', 'talk to me', 'update me',
      'where do we stand', 'how much damage', 'are we still in one piece',
    ],
    keywords: { report: 2.5, status: 3, sitrep: 3, damage: 1.5, condition: 1.5, casualty: 2 },
    build: () => ({ action: 'status' }),
  },
  {
    id: 'eject_core',
    help: 'Eject the warp core',
    phrases: [
      'eject the warp core', 'eject the core', 'jettison the core',
      'dump the core', 'blow the core', 'get rid of the core',
      'eject warp core', 'punch out the core',
    ],
    keywords: { eject: 3, jettison: 3 },
    requires: [],
    veto: ['pod', 'cargo'],
    build: () => ({ action: 'eject_core' }),
  },
  // ------------------------------------------------------------------
  // The captain's chair. These are the controls the chair carries, and they
  // are here so that every one of them is equally an order you can say.
  // ------------------------------------------------------------------
  {
    id: 'intercom',
    help: 'Engineering, report / bridge to sickbay',
    phrases: [
      'bridge to', 'get me engineering', 'get me sickbay', 'get me the bridge',
      'call engineering', 'call sickbay', 'open the intercom', 'intercom',
      'engineering report', 'sickbay report', 'tactical report',
      'science report', 'helm report', 'security report',
      'what does engineering say', 'ask engineering', 'ask the doctor',
      'put me through to', 'raise engineering', 'get me', 'bridge to',
    ],
    keywords: {
      intercom: 3, report: 3, call: 1.5, ask: 1.5, raise: 1.2, get: 0.8,
      say: 1, through: 1,
    },
    // No department, no intercom call — "damage report" with nobody addressed
    // is the ordinary status readout and belongs to that intent instead.
    mustHave: ['station'],
    // ...unless the captain said the word outright, in which case the ship
    // knows perfectly well what is being asked for.
    mustHaveUnless: /\bintercom\b/,
    build: (c) => ({
      action: 'intercom',
      dept: /\b(?:engineering|engineer)\b/.test(c.text) ? 'engineering'
        : /\b(?:sickbay|medical|doctor|medbay)\b/.test(c.text) ? 'medical'
        : /\b(?:tactical|weapon)\b/.test(c.text) ? 'tactical'
        : /\b(?:science|sensor)\b/.test(c.text) ? 'science'
        : /\b(?:helm|navigation)\b/.test(c.text) ? 'helm'
        : /\b(?:comms|communications)\b/.test(c.text) ? 'comms'
        : c.station ?? 'security',
    }),
  },
  {
    id: 'log_entry',
    help: 'Captain’s log, supplemental: <text>',
    phrases: [
      'captains log', 'ships log', 'log entry', 'supplemental',
      'record a log entry', 'make a log entry', 'note in the log',
      'begin recording', 'for the record', 'log this',
    ],
    keywords: { log: 2, record: 1.5, supplemental: 3 },
    veto: ['damage', 'status'],
    build: (c) => ({
      action: 'log_entry',
      // Everything after the preamble is the entry itself.
      text: c.text.replace(/^.*?(?:supplemental|log entry|captains log|ships log|log this|for the record)\s*/, '').trim()
        || c.text,
    }),
  },
  {
    id: 'jettison_pod',
    help: 'Jettison the ion pod',
    phrases: [
      'jettison the pod', 'jettison the ion pod', 'eject the pod',
      'drop the pod', 'dump the pod', 'launch the decoy', 'deploy a decoy',
      'give them something else to shoot at', 'pod away',
    ],
    keywords: { pod: 3, decoy: 3 },
    veto: ['core', 'reactor'],
    build: () => ({ action: 'jettison_pod' }),
  },
  {
    id: 'viewscreen',
    help: 'On screen / main viewer',
    phrases: [
      'main viewer', 'tactical display', 'show me the tactical',
      'put it on the viewscreen', 'switch the viewscreen', 'viewscreen',
      'show me what is out there', 'let me see',
    ],
    keywords: { viewscreen: 3, display: 2, viewer: 2.5, see: 1.5 },
    veto: ['hail', 'channel', 'them'],
    build: () => ({ action: 'viewscreen' }),
  },
  // ------------------------------------------------------------------
  // The machine shop. Being trapped is a situation you build your way out
  // of, and these are the orders that do it.
  // ------------------------------------------------------------------
  {
    id: 'fabricate',
    help: 'Build a hull patch / make torpedoes / rig a bypass',
    phrases: [
      'can you build', 'can you make', 'can you rig', 'can we build', 'can we make',
      'build me', 'make me', 'fabricate', 'replicate', 'machine',
      'get to work on', 'start work on', 'put together', 'knock together',
      'rig up', 'jury rig', 'improvise', 'cobble together', 'run me off',
      'i want you to build', 'get the shop working on',
      'make torpedo', 'build torpedo', 'more torpedo', 'load more torpedo',
      'patch the hull', 'make a patch', 'new sensor', 'fix the sensor',
      'put out the fires', 'coolant purge',
    ],
    keywords: { build: 2.5, fabricate: 3, make: 1.2, rig: 2, improvise: 3, replicate: 3 },
    veto: ['course', 'destination'],
    // No specification, no work. "Make me a sandwich" is understood perfectly
    // well as a build order; what it lacks is something the shop can build,
    // and saying so is a better answer than pretending not to have heard.
    requires: ['recipe'],
    build: (c) => ({ action: 'fabricate', recipe: c.recipe }),
  },
  {
    id: 'work_shop',
    help: 'Get on with it / how long',
    phrases: [
      'get on with it', 'keep working', 'stay on it', 'work through the night',
      'how long', 'how much longer', 'where are we on', 'status of the work',
      'put the hours in', 'i will wait',
    ],
    keywords: { longer: 2 },
    veto: ['course', 'warp', 'fire'],
    build: () => ({ action: 'work_shop' }),
  },
  {
    id: 'salvage',
    help: 'Strip the wreck',
    phrases: [
      'strip the wreck', 'salvage the wreck', 'salvage what you can',
      'recover what you can', 'scavenge', 'take what we can use',
      'strip it for parts', 'salvage teams', 'board the hulk',
    ],
    keywords: { salvage: 3, scavenge: 3, wreck: 2, hulk: 2 },
    build: () => ({ action: 'salvage' }),
  },
  // ------------------------------------------------------------------
  // The gambit. Making someone answer who has no intention of answering.
  // ------------------------------------------------------------------
  {
    id: 'force_channel',
    help: 'All hailing frequencies — force the channel open',
    phrases: [
      'force the channel', 'force a channel', 'force them to answer',
      'make them answer', 'every frequency',
      'override their comms', 'they will answer', 'i do not care if they answer',
      'open the channel anyway', 'keep hailing', 'do not stop hailing',
      'broadcast on all frequencies', 'jam them into listening',
    ],
    keywords: { force: 2 },
    build: () => ({ action: 'force_channel' }),
  },
  {
    id: 'brace',
    help: 'All hands brace for impact',
    phrases: [
      'brace for impact', 'all hands brace', 'brace yourselves', 'hang on',
      'hold on to something', 'incoming', 'take cover', 'secure for impact',
      'prepare for impact', 'this is going to hurt',
    ],
    keywords: { brace: 3.5 },
    veto: ['shield', 'facing'],
    build: () => ({ action: 'ability', ability: 'brace_for_impact' }),
  },
  {
    id: 'away_team',
    help: 'Assemble an away team',
    phrases: [
      'away team', 'landing party', 'beam down', 'send a team down',
      'assemble an away team', 'put together a team', 'go down there',
      'send someone down', 'i am going down', 'i will lead the team',
      'transport down', 'take a team', 'shore party', 'boarding party',
    ],
    keywords: { away: 2, landing: 2.5, party: 1.5, team: 1.5 },
    build: (c) => ({
      action: 'away_team',
      captainLeads: /\b(?:i will lead|i am going|with me|i will go|myself|personally)\b/.test(c.text),
    }),
  },
  {
    id: 'transport',
    help: 'Energize',
    phrases: [
      'energize', 'beam them up', 'beam them aboard', 'beam him up',
      'beam her up', 'beam it up', 'bring them up', 'bring them aboard',
      'get them out of there', 'transport them', 'lock on and beam',
      'one to beam up', 'beam us back', 'get us back aboard', 'transporter room energize',
    ],
    keywords: { energize: 3.5, beam: 2.5, transport: 2 },
    veto: ['down', 'away'],
    build: () => ({ action: 'transport' }),
  },
];

// The phrases above are written the way a person writes them — plural nouns,
// British spelling, contractions. Normalisation folds all of that away before
// the parser ever sees an order, so the lexicon is folded once at load to meet
// it in the same dialect. Doing this by hand in the table instead would mean
// writing "fire all weapon", and the first person to type the plural would
// silently break the intent.
for (const intent of INTENTS) {
  intent.keywords = Object.fromEntries(
    Object.entries(intent.keywords).map(([w, weight]) => [fold(w), weight]),
  );
  intent.phrases = [...new Set(intent.phrases.map(fold))]
    // A single word that is already a keyword would otherwise be counted
    // twice, which is how "shoot their sensor array" came out as open fire
    // instead of a targeting order.
    .filter((p) => p.includes(' ') || !(p in intent.keywords))
    .sort((a, b) => b.length - a.length);
  if (intent.veto) intent.veto = intent.veto.map(fold);
}

/** Fast lookup by id. */
export const INTENT_BY_ID = Object.fromEntries(INTENTS.map((i) => [i.id, i]));

/** Every action id the lexicon can emit — checked against the executor. */
export function lexiconActions() {
  const ctx = {
    text: '', tokens: [], negated: false, percent: null, urgent: false,
    place: { id: 'sol' }, facing: 'fore', powerChannel: 'shields',
    targetSystem: 'engines', warp: 6, bearing: null, faction: null,
  };
  return [...new Set(INTENTS.map((i) => i.build(ctx).action))];
}

/** Everything the parser understands, for the manual and the help sheet. */
export function intentHelp() {
  return INTENTS.map((i) => ({ id: i.id, help: i.help, phrases: i.phrases.length }));
}

/** Total number of distinct phrasings carried, for the size budget in CI. */
export function phraseCount() {
  return INTENTS.reduce((n, i) => n + i.phrases.length + Object.keys(i.keywords).length, 0);
}
