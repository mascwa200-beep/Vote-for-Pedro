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

import { fold, readNumber } from './normalize.js';

/** Departments an order can be aimed at, used to break ties. */
export const STATION_AFFINITY = {
  helm: ['set_course', 'warp_factor', 'throttle', 'come_about', 'heading',
    'evasive', 'warp_out', 'dock', 'all_stop', 'pitch', 'turn',
    'enter_orbit', 'break_orbit'],
  tactical: ['fire', 'cease_fire', 'target_nearest', 'cycle_target',
    'target_subsystem', 'shields', 'reinforce', 'alert', 'cloak'],
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
    // A compartment is not a star system. This intent owns the phrases "go to"
    // and "take me to", so without standing aside it won "go to sickbay" and
    // then asked which system — which is the exact failure the room matcher was
    // written to avoid, arriving from the other direction.
    vetoSlots: ['room'],
    requires: ['place'],
    build: (c) => ({
      action: 'course',
      system: c.place.id,
      warp: c.warp ?? 6,
    }),
  },
  {
    id: 'enter_orbit',
    help: 'Standard orbit / take us into orbit of <world>',
    phrases: [
      'standard orbit', 'assume standard orbit', 'take us into orbit',
      'take us into standard orbit', 'enter orbit', 'enter standard orbit',
      'establish orbit', 'establish standard orbit', 'make orbit',
      'assume orbit', 'put us in orbit', 'get us into orbit', 'go into orbit',
      'take up orbit', 'move into orbit', 'orbit the planet', 'orbit that world',
      'bring us into orbit', 'settle into orbit', 'hold orbit',
      'maintain standard orbit', 'close to orbital distance',
    ],
    keywords: { orbit: 3, orbital: 2 },
    // "Break orbit" is the opposite order and shares every other word in the
    // sentence, so the two are separated on the one word that differs.
    veto: ['break', 'leave', 'out'],
    build: () => ({ action: 'orbit' }),
  },
  {
    id: 'break_orbit',
    help: 'Break orbit',
    phrases: [
      'break orbit', 'break out of orbit', 'leave orbit', 'leave the orbit',
      'out of orbit', 'take us out of orbit', 'get us out of orbit',
      'depart orbit', 'abandon orbit', 'climb out of orbit',
      'stop orbiting', 'end the orbit', 'break us out of orbit',
    ],
    keywords: { orbit: 2, break: 2, leave: 1 },
    build: () => ({ action: 'break_orbit' }),
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
    // "Hold orbit" is holding something specific, not holding still.
    veto: ['fire', 'firing', 'orbit'],
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
    id: 'pitch',
    help: 'Take us up / dive / level off / climb 30 degrees',
    // The third axis, as an order. The enemy AI has always used elevation
    // tactically — chooseElevation() comes at you from above or below whichever
    // face you are not presenting — and there was no way for the captain to say
    // it. `setPitch` existed and nothing in the game called it.
    phrases: [
      'take us up', 'take us down', 'bring us up', 'bring us down',
      'get us above them', 'get us under them', 'get above them', 'get below them',
      'climb', 'dive', 'ascend', 'descend', 'nose up', 'nose down',
      'pitch up', 'pitch down', 'pull up', 'push her down',
      'gain altitude', 'lose altitude', 'go high', 'go low',
      'come at them from above', 'come at them from below',
      'take us over them', 'take us under them', 'drop below them',
      'bring us above them', 'get on top of them', 'go over the top',
      'level off', 'level out', 'level the ship', 'even keel', 'straighten us out',
    ],
    keywords: {
      climb: 3, dive: 3, ascend: 3, descend: 3, altitude: 2.5,
      elevation: 2.5, above: 1.5, below: 1.5, level: 1.5, pitch: 2,
      // "up" and "down" are everywhere — "shields up", "power down" — and are
      // only safe as keywords because mustHave has already ruled this intent
      // out for any sentence the elevation extractor did not recognise. They
      // are what gets a doubly-typo'd "tkae us up" over the scorer's floor,
      // which it has to clear before an entity slot can corroborate anything.
      up: 0.9, down: 0.9,
    },
    // Without this, "speed up" and "slow down" read as elevation changes.
    veto: ['speed', 'impulse', 'throttle', 'warp'],
    // Hard precondition: without an actual elevation in the text these words
    // are not an elevation order at all. It is corroborating evidence as well
    // as a gate — a typo'd "tkae us up" matches no phrase and no keyword, and
    // the extracted elevation is the only thing that identifies it.
    mustHave: ['elevation'],
    requires: ['elevation'],
    build: (c) => ({
      action: 'pitch',
      value: c.elevation ?? 0,
      // A named angle is an attitude to come to. A bare "climb" is a step from
      // wherever the nose is now, which is what the button does and what makes
      // saying it twice mean twice as much.
      relative: (c.elevation ?? 0) !== 0 && !/\d/.test(c.text),
    }),
  },
  {
    id: 'turn',
    help: 'Hard to port / come right / steady as she goes',
    // Relative helm, as opposed to `come_about` (absolute bearing) and
    // `pitch` (elevation). This is how a bridge actually talks, and it was the
    // one register the parser had no answer for at all.
    phrases: [
      'hard to port', 'hard to starboard', 'hard aport', 'hard astarboard',
      'hard a port', 'hard a starboard', 'come left', 'come right',
      'turn to port', 'turn to starboard', 'bear left', 'bear right',
      'left rudder', 'right rudder', 'ease to port', 'ease to starboard',
      'steady as she goes', 'steady on', 'steady as you go',
      'hold this heading', 'maintain heading', 'maintain this heading',
      'hold our heading', 'keep her steady', 'stay on this heading',
    ],
    keywords: { rudder: 3, aport: 3, astarboard: 3, steady: 2.5, hard: 1.2 },
    // "hard to port" is a turn; "reinforce the port shield" is not.
    veto: ['shield', 'reinforce', 'facing'],
    build: (c) => {
      const t = c.text;
      if (/\b(?:steady|maintain|hold|keep|stay)\b/.test(t)) return { action: 'turn', value: 0 };
      const hard = /\bhard\b/.test(t);
      const left = /\b(?:port|aport|a port|left)\b/.test(t);
      return { action: 'turn', value: (left ? -1 : 1) * (hard ? 90 : 45) };
    },
  },
  {
    id: 'cloak',
    help: 'Cloak / drop the cloak',
    // No Federation hull in the game carries a cloaking device, so on the
    // Enterprise this order is always refused — but it is refused *in world*,
    // by an officer who says why. "I do not understand" to an order every
    // captain in this setting knows the words to is the wrong failure.
    phrases: [
      'cloak', 'cloak the ship', 'cloak us', 'engage the cloak',
      'engage the cloaking device', 'activate the cloak', 'go cloaked',
      'raise the cloak', 'cloaking device on',
      'decloak', 'uncloak', 'drop the cloak', 'drop cloak', 'disengage the cloak',
      'deactivate the cloak', 'cloaking device off', 'come out of cloak',
      'take us out of cloak',
    ],
    keywords: { cloak: 3, cloaked: 3, cloaking: 3, uncloak: 3, decloak: 3 },
    // A cloak *detection* order is a sensor order, not this.
    veto: ['detect', 'find', 'scan', 'tachyon'],
    build: (c) => ({
      action: 'cloak',
      on: !/\b(?:de ?cloak|uncloak|drop|disengage|deactivate|off|out of)\b/.test(c.text),
    }),
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
    // "Get us out of orbit" is a helm order about altitude and this intent runs
    // from the system entirely. They share "get us out" and nothing else.
    veto: ['orbit'],
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
      'shore up the shield', 'double up the shield', 'thicken the shield',
      'brace the shield', 'all power to the forward shield',
      'reinforce forward', 'reinforce aft', 'harden the shield',
      'boost the shield', 'shore up', 'double up', 'thicken',
      'more shield on the', 'extra shield',
      // "transfer power to the shield" and "more power to the shield" used to
      // be listed here and always lost to `power`, which is the correct
      // reading: with no facing named, that IS a grid order. What makes it a
      // reinforce order is the facing, and `power` now stands aside whenever
      // one is present.
      'more power to the forward shield', 'transfer power to the aft shield',
      'power to the port shield',
    ],
    keywords: {
      reinforce: 3, strengthen: 3, bolster: 3, harden: 2.5, boost: 1.5,
      shore: 2.5, thicken: 2.5, double: 2, brace: 2,
      // Safe to score on, because `power` vetoes itself when a facing is named
      // and this intent requires one. Without it "more power to the forward
      // shields" fell between the two and reached neither.
      power: 1.5,
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
    // A power channel has no facing. "More power to the forward shields" is a
    // reinforce order about one shield face; "more power to shields" is a
    // routing order about the grid. Without this the word `power` carried
    // every one of them to the grid and the word `forward` — the entire point
    // of the sentence — was discarded. Three of `reinforce`'s own listed
    // phrasings lost to this intent.
    vetoSlots: ['facing'],
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
      // The FULL line, not the normalised one. Science and engineering are
      // station names, so "science configuration" had the one word that picks
      // the preset stripped off the front as an address and arrived here as
      // "configuration" — which fell through to balanced. The same order given
      // as "Science, attack posture" still reads as attack, because attack is
      // tested first and an addressee never changes what was ordered.
      const t = c.full ?? c.text;
      const preset = /\battack\b|\bcombat\b|\boffensive\b|\bbattle\b/.test(t) ? 'attack'
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
      // "Belay that" with nothing else in the sentence is the bridge's way of
      // saying stop what you are doing, and in a fight what you are doing is
      // shooting. "Belay the evasive manoeuvres" is not this — it is the
      // evasive intent, negated — so anything that names another order vetoes
      // this one and the negation handling takes it instead.
      'belay that', 'belay that order', 'belay my last', 'belay',
      'cancel that', 'cancel that order', 'cancel my last', 'disregard that',
    ],
    keywords: { cease: 3.5, hold: 1.5, check: 1.5, belay: 2.5 },
    veto: ['evasive', 'evading', 'course', 'warp', 'shield', 'shields',
      'power', 'cloak', 'alert', 'scan', 'hail', 'dock', 'climb', 'dive'],
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
  // ------------------------------------------------------------------
  // Where the captain physically is. The ship has an inside now, and
  // "go to sickbay" walks you there rather than opening a menu.
  // ------------------------------------------------------------------
  {
    id: 'go_to_room',
    help: 'Go to sickbay / take me to engineering',
    // Movement idioms only, with NO room name in them.
    //
    // Two compartments are also station names — sickbay, engineering — and the
    // normaliser pulls an addressee off the line before any of this is scored.
    // So "go to sickbay" reached the scorer as the bare phrase "go to" and a
    // phrase list full of room names matched none of it.
    //
    // The room is an ENTITY, found on the unstripped line, and it is what
    // separates this intent from `set_course`: naming a compartment vetoes the
    // course order, and this one requires one. The two share their phrasings
    // and split on the noun, which is what the sentence actually means.
    phrases: [
      'go to', 'take me to', 'get me to', 'down to', 'walk to',
      'head down to', 'report to', 'meet me in', 'take me down to',
      'i want to be in', 'over to', 'back to', 'return to',
    ],
    keywords: { quarters: 2.5, briefing: 2.5, turbolift: 2.5, deck: 1.5 },
    // A compartment is not a star system, and this is the one intent that could
    // be mistaken for `set_course`. Naming a place rules it out outright.
    vetoSlots: ['place'],
    requires: ['room'],
    build: (c) => ({ action: 'go_to_room', room: c.room.id }),
  },
  {
    id: 'mission_choice',
    help: 'Option one / take the second one',
    phrases: [
      'option one', 'option two', 'option three', 'option four', 'option five',
      'the first one', 'the second one', 'the third one', 'the fourth one',
      'take the first', 'take the second', 'take the third',
      'first option', 'second option', 'third option', 'fourth option',
      'number one', 'number two', 'number three',
      'go with the first', 'go with the second', 'go with the third',
    ],
    keywords: { option: 2.6, first: 1.4, second: 1.6, third: 1.6, fourth: 1.6 },
    // A stage's choices are written by an episode and the parser cannot know
    // what they say. It can count, though — and "option two" is how a captain
    // picks one of three things somebody has just laid out for them.
    veto: ['course', 'warp', 'fire', 'shields'],
    build: (c) => {
      const t = c.text;
      const words = ['one', 'two', 'three', 'four', 'five'];
      const ordinals = ['first', 'second', 'third', 'fourth', 'fifth'];
      // ORDINALS FIRST, and it matters: "the second one" contains the word
      // "one", so a single pass that checks the cardinals in order reads it as
      // option one and picks the wrong thing in the middle of an episode.
      for (let i = 0; i < ordinals.length; i++) {
        if (new RegExp(`\\b${ordinals[i]}\\b`).test(t)) return { action: 'mission_choice', index: i };
      }
      for (let i = 0; i < words.length; i++) {
        if (new RegExp(`\\b(?:${words[i]}|${i + 1})\\b`).test(t)) {
          return { action: 'mission_choice', index: i };
        }
      }
      return { action: 'mission_choice', index: 0 };
    },
  },
  {
    id: 'use_console',
    help: 'Use it / open that console',
    phrases: [
      'use it', 'use that', 'use this', 'use the console', 'use that console',
      'open that console', 'open the console', 'open this console',
      'work that console', 'work the console', 'work that panel',
      'operate it', 'operate that', 'operate the console',
      'bring it up', 'bring that up', 'have a look at that console',
      'read it', 'read that', 'check that panel', 'what does that say',
      'go through the door', 'through the door', 'open the door',
    ],
    keywords: { console: 2.4, panel: 2, operate: 2.4, use: 1.6 },
    // "Open a channel" is the comms order and shares the verb. So does hailing
    // frequencies. The whole point of this intent is the thing you are standing
    // in front of, so anything naming a destination stands it aside too.
    veto: ['channel', 'frequencies', 'hail', 'hailing'],
    vetoSlots: ['place', 'room'],
    build: () => ({ action: 'use' }),
  },
  {
    id: 'survey',
    help: 'Survey that / take a reading',
    phrases: [
      'survey it', 'survey that', 'survey this', 'survey the site',
      'take a reading', 'take readings', 'get a reading',
      'run a tricorder over it', 'tricorder reading', 'analyse it',
      'analyse that', 'examine it', 'examine that', 'have a look at it',
      'take a sample', 'collect a sample', 'work the site',
      'see what it is', 'find out what it is', 'dig it out',
    ],
    keywords: { survey: 3, tricorder: 3, sample: 2.4, reading: 2, analyse: 2, examine: 1.8 },
    // `scan` is the ship's sensors sweeping a system from orbit. This is a
    // landing party crouched over one thing with a tricorder, and the two mean
    // genuinely different actions in genuinely different places.
    veto: ['system', 'sector', 'ship', 'vessel', 'sensors'],
    build: () => ({ action: 'survey_here' }),
  },
  {
    id: 'stand_up',
    help: 'Stand up / take the chair',
    phrases: [
      'stand up', 'get up', 'on my feet', 'leave the chair',
      'out of the chair', 'take the chair', 'sit down', 'be seated',
      'i will take the chair', 'have a seat', 'back in the chair',
      'resume the chair', 'take my seat',
    ],
    keywords: { chair: 2.5, seat: 2, stand: 2, sit: 2 },
    veto: ['battle', 'station', 'red', 'yellow'],
    build: (c) => ({
      action: 'chair',
      // One intent, both directions — the words are the same family and the
      // verb decides. "Take the chair" and "stand up" are opposites said the
      // same way round.
      sit: !/\b(?:stand|get up|leave|out of|on my feet)\b/.test(c.text),
    }),
  },
  {
    // Handing the con over is the single most-repeated piece of business on
    // the bridge, and the three orders here are separated from each other by
    // one pronoun. "You have the con", "I have the con" and "who has the con"
    // share every other word in the sentence, so the pronoun does all the work
    // and each intent vetoes the other two on it.
    id: 'hand_over_con',
    help: 'You have the con / Mr. Spock, take the con',
    phrases: [
      'you have the con', 'you have the conn', 'take the con', 'take the conn',
      'the con is yours', 'you have the bridge', 'take the bridge',
      'you have the watch', 'take the watch', 'stand the watch',
      'hand over the con', 'the bridge is yours', 'relieve me',
      'mind the store', 'she has the con', 'he has the con',
      // Addressing an officer by rank strips the pronoun with it: "Number One,
      // you have the con" normalises down to "have the con", and without these
      // the most natural way to say the order is the one that does not work.
      'have the con', 'have the conn', 'have the bridge', 'have the watch',
    ],
    keywords: { con: 3, conn: 3, watch: 2, bridge: 1.4, relieve: 2.2 },
    // "me" is deliberately absent: "relieve me" is this order, and it is the
    // way a tired captain actually says it.
    veto: ['i', 'my', 'mine', 'who', 'which', 'give'],
    // The whole line, so the officer named in it can be found against the
    // actual roster — the lexicon does not know who is aboard.
    // The line as it was actually typed, not the normalised one — normalising
    // strips the address, and the address is the name of the officer being
    // handed the ship.
    build: (c) => ({ action: 'hand_over_con', said: c.full ?? c.text }),
  },
  {
    id: 'take_con',
    help: 'I have the con',
    phrases: [
      'i have the con', 'i have the conn', 'i have the bridge',
      'i will take the con', 'i am taking the con', 'i have the watch',
      'give me the con', 'the con is mine', 'i am taking the bridge',
      'i will take the watch', 'i am back', 'i am relieving you',
    ],
    keywords: { con: 3, conn: 3, relieve: 2.2, watch: 1.6 },
    veto: ['you', 'your', 'yours', 'she', 'he', 'they', 'who', 'which'],
    build: () => ({ action: 'take_con' }),
  },
  {
    // The one order that reads the simulation's own conscience out loud. A
    // level one diagnostic is a real thing in this franchise and it is exactly
    // an invariant sweep — every system checked by hand against what it is
    // supposed to be — so it is wired to the checker the game actually runs.
    id: 'diagnostic',
    help: 'Run a level one diagnostic',
    phrases: [
      'run a diagnostic', 'run a level one diagnostic', 'run a level two diagnostic',
      'run a level three diagnostic', 'run a level five diagnostic',
      'run a full diagnostic', 'run diagnostics', 'begin a diagnostic',
      'start a diagnostic', 'diagnostic', 'run a system check',
      'check the systems', 'run a self test', 'systems check',
      'i want a diagnostic', 'give me a diagnostic', 'full systems diagnostic',
      'run every check', 'check everything',
    ],
    keywords: { diagnostic: 3, diagnostics: 3, selftest: 2 },
    // "Damage report" is a summary an officer gives from what they already
    // know. A diagnostic is work the crew goes off and does.
    veto: ['damage', 'sensor', 'scan'],
    build: (c) => {
      const m = /\blevel\s+(one|two|three|four|five|[1-5])\b/.exec(c.text);
      const word = { one: 1, two: 2, three: 3, four: 4, five: 5 };
      const deep = /\b(?:full|complete|thorough|everything|every check)\b/.test(c.text);
      return {
        action: 'diagnostic',
        level: m ? (word[m[1]] ?? Number(m[1])) : (deep ? 1 : 5),
      };
    },
  },
  {
    id: 'watch_bill',
    help: 'Who has the con? / read me the watch bill',
    phrases: [
      'who has the con', 'who has the conn', 'who has the bridge',
      'who is standing watch', 'who has the watch', 'what is the watch',
      'read me the watch bill', 'the watch bill', 'watch bill',
      'what watch is it', 'which watch is standing', 'duty roster',
      'read the duty roster', 'who is on duty', 'watch rotation',
    ],
    keywords: { watch: 2.6, bill: 2.4, roster: 2.4, duty: 2, who: 1.6 },
    build: () => ({ action: 'watch_bill' }),
  },
  {
    // The one order that is about the game rather than the ship. It exists
    // because the parser accepts hundreds of phrasings and a player who has
    // only seen the buttons has no way to discover that.
    id: 'help',
    help: 'What can I say? — the command reference',
    phrases: [
      'what can i say', 'what can i do', 'what are my orders', 'list orders',
      'show me the orders', 'command reference', 'show the manual',
      'what commands are there', 'how do i give orders', 'i need help',
      'show help', 'the manual',
    ],
    keywords: { help: 2.5, manual: 2.5, command: 2, order: 1.2 },
    // "Send help to the colony" is a rescue order, not a request for the
    // manual. The distinction is grammatical — help as an object rather than
    // as a request — and these are the words that mark it.
    veto: [
      'medical', 'sickbay', 'distress', 'assist', 'aid', 'rescue', 'engineering',
      'send', 'render', 'colony', 'survivor', 'wounded', 'injured', 'evacuate',
      'them', 'their', 'they', 'ship', 'vessel', 'freighter', 'outpost',
    ],
    build: () => ({ action: 'help' }),
  },
  {
    id: 'viewscreen',
    help: 'On screen / main viewer',
    phrases: [
      'on screen', 'on the screen', 'main viewer', 'tactical display',
      'show me the tactical', 'put it on the viewscreen', 'switch the viewscreen',
      'viewscreen', 'show me what is out there', 'let me see',
      'screen off', 'close the viewer',
    ],
    keywords: { viewscreen: 3, display: 2, viewer: 2.5, see: 1.5, screen: 2.5 },
    veto: ['hail', 'channel', 'them'],
    build: () => ({ action: 'viewscreen' }),
  },
  {
    // The most quotable order on the bridge, and until now it did nothing at
    // all — there was no screen to magnify. It opens the viewer if it is shut,
    // because "magnify" while looking at a crew roster means "show me".
    id: 'magnify',
    help: 'Magnify — optical zoom on the main viewer',
    phrases: [
      'magnify', 'magnification', 'zoom in', 'closer look', 'enhance',
      'magnify that', 'increase magnification', 'zoom in on that',
      'magnify the image', 'give me a closer look', 'closer view',
      'increase magnification factor', 'magnification factor', 'zoom the viewer',
    ],
    keywords: { magnify: 3, magnification: 3, zoom: 2.5, enhance: 2 },
    veto: ['scan', 'sensor'],
    build: (c) => ({
      // "magnification factor three" — a number in the order is the factor.
      // No number means one more step, which is what a bare "magnify" means.
      action: 'magnify',
      factor: readNumber(c.text, null),
    }),
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
    id: 'beam_down',
    help: 'Beam down / two to beam down',
    phrases: [
      'beam down', 'beam me down', 'beam us down', 'beam me to the surface',
      'two to beam down', 'three to beam down', 'four to beam down',
      'send down a landing party', 'send a landing party down',
      'form a landing party', 'put me on the surface',
      'down to the surface', 'transport me to the surface', 'energize for the surface',
      'lets go down', 'i am going down', 'beam down to the planet',
    ],
    keywords: { beam: 2.5, down: 1.6, surface: 2, landing: 2 },
    // The other half of the pair. "Beam up" and "beam down" differ by one word
    // and mean opposite things, so each vetoes the other's.
    veto: ['up', 'aboard', 'back'],
    // "Take me down to sickbay" is a walk down a deck, not a transport to a
    // planet. Naming a compartment stands this intent aside, the same way it
    // stands `set_course` aside — a room is never a destination off the ship.
    vetoSlots: ['room'],
    build: () => ({ action: 'beam_down' }),
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
    room: { id: 'sickbay' }, recipe: null, elevation: null,
  };
  return [...new Set(INTENTS.map((i) => i.build(ctx).action))];
}

/** Everything the parser understands, for the manual and the help sheet. */
export function intentHelp() {
  return INTENTS.map((i) => ({ id: i.id, help: i.help, phrases: i.phrases.length }));
}

/**
 * Every word the lexicon itself uses, folded, four letters or longer.
 *
 * This exists to stop the gazetteer's fuzzy passes from "correcting" a word
 * that was not misspelled. `similarity('power', 'lower')` is 0.83, so every
 * order containing the word `power` silently carried a ventral facing; `fire`,
 * `core` and `more` all became fore, `stop` became dorsal, and `head` became
 * ahead. Eighteen ordinary order words in this file resolved to a facing
 * nobody typed.
 *
 * A threshold cannot separate those from real typos — they ARE single edits.
 * What separates them is that they are correctly spelled words this game
 * already uses, and the fuzzy pass exists for "forwrad", not for "power".
 *
 * Deriving it from the phrases rather than listing it by hand means a new
 * phrasing protects its own words, with no second table to drift.
 */
export const ORDER_VOCABULARY = (() => {
  const words = new Set();
  for (const intent of INTENTS) {
    for (const phrase of intent.phrases) {
      for (const w of phrase.split(/\s+/)) if (w.length >= 4) words.add(w);
    }
    for (const k of Object.keys(intent.keywords)) if (k.length >= 4) words.add(k);
  }
  return words;
})();

/** Total number of distinct phrasings carried, for the size budget in CI. */
export function phraseCount() {
  return INTENTS.reduce((n, i) => n + i.phrases.length + Object.keys(i.keywords).length, 0);
}
