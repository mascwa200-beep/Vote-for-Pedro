// Ship classes — player-commandable and otherwise.
//
// Every number here feeds the simulation directly. `tier` gates availability by
// rank; `slots` are the loadout hardpoints (see sim/loadout.js).

/** Weapon mounts. arc is degrees of firing coverage centred on `facing`. */
const arc = (facing, degrees) => ({ facing, degrees });

export const SHIP_CLASSES = {
  // ---------- Player-commandable ----------
  constitution: {
    id: 'constitution', name: 'Constitution class', faction: 'federation',
    tier: 3, role: 'cruiser',
    hull: 4200, shields: 3400, shieldRegen: 42,
    crew: 430, decks: 23, mass: 1.0,
    impulse: 0.72, turnRate: 9.0, maxWarp: 8.0, warpEfficiency: 1.0,
    powerCap: 200,
    weapons: [
      { id: 'phaser_bank_fwd', type: 'beam', name: 'Forward Phaser Banks', damage: 168, cycle: 3.2, ...arc(0, 250) },
      { id: 'phaser_bank_aft', type: 'beam', name: 'Aft Phaser Banks', damage: 120, cycle: 3.2, ...arc(180, 200) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Forward Photon Tubes', damage: 420, cycle: 7.5, ...arc(0, 90) },
    ],
    slots: { tactical: 3, engineering: 3, science: 2, device: 2 },
    boffSeats: [
      { dept: 'tactical', rank: 3 }, { dept: 'engineering', rank: 3 },
      { dept: 'science', rank: 2 }, { dept: 'universal', rank: 2 },
    ],
    description: 'Heavy cruiser. Twelve ships in the fleet, five-year missions, no support within a month at warp.',
  },
  constitution_refit: {
    id: 'constitution_refit', name: 'Constitution class (Refit)', faction: 'federation',
    tier: 4, role: 'cruiser', refitOf: 'constitution',
    hull: 5100, shields: 4400, shieldRegen: 55,
    crew: 430, decks: 23, mass: 1.05,
    impulse: 0.78, turnRate: 9.5, maxWarp: 9.0, warpEfficiency: 1.15,
    powerCap: 220,
    weapons: [
      { id: 'phaser_bank_fwd', type: 'beam', name: 'Forward Phaser Banks', damage: 196, cycle: 3.0, ...arc(0, 250) },
      { id: 'phaser_bank_aft', type: 'beam', name: 'Aft Phaser Banks', damage: 140, cycle: 3.0, ...arc(180, 200) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Photon Torpedo Bay', damage: 430, cycle: 6.8, ...arc(0, 90) },
      { id: 'torpedo_aft', type: 'torpedo', name: 'Aft Photon Tube', damage: 340, cycle: 8.0, ...arc(180, 90) },
    ],
    slots: { tactical: 4, engineering: 3, science: 3, device: 2 },
    boffSeats: [
      { dept: 'tactical', rank: 3 }, { dept: 'engineering', rank: 3 },
      { dept: 'science', rank: 3 }, { dept: 'universal', rank: 2 },
    ],
    description: 'The full rebuild. New warp geometry, new phasers drawing straight off the engines.',
  },
  miranda: {
    id: 'miranda', name: 'Miranda class', faction: 'federation',
    tier: 2, role: 'light cruiser',
    hull: 3100, shields: 2600, shieldRegen: 38,
    crew: 220, decks: 12, mass: 0.8,
    impulse: 0.8, turnRate: 12.0, maxWarp: 8.0, warpEfficiency: 1.1,
    powerCap: 180,
    weapons: [
      { id: 'phaser_bank_fwd', type: 'beam', name: 'Phaser Banks', damage: 132, cycle: 3.2, ...arc(0, 250) },
      { id: 'torpedo_roll', type: 'torpedo', name: 'Rollbar Torpedo Pod', damage: 320, cycle: 7.0, ...arc(0, 180) },
    ],
    slots: { tactical: 2, engineering: 2, science: 2, device: 1 },
    boffSeats: [
      { dept: 'tactical', rank: 2 }, { dept: 'engineering', rank: 2 }, { dept: 'science', rank: 2 },
    ],
    description: 'Workhorse. Survey, escort, courier — whatever the sector needs that week.',
  },
  oberth: {
    id: 'oberth', name: 'Oberth class', faction: 'federation',
    tier: 2, role: 'science vessel',
    hull: 2400, shields: 2900, shieldRegen: 62,
    crew: 80, decks: 8, mass: 0.6,
    impulse: 0.68, turnRate: 14.0, maxWarp: 7.5, warpEfficiency: 1.3,
    powerCap: 190, auxBonus: 25,
    weapons: [
      { id: 'phaser_light', type: 'beam', name: 'Light Phaser Emitters', damage: 90, cycle: 3.5, ...arc(0, 300) },
    ],
    slots: { tactical: 1, engineering: 2, science: 4, device: 2 },
    boffSeats: [
      { dept: 'science', rank: 3 }, { dept: 'science', rank: 2 }, { dept: 'engineering', rank: 2 },
    ],
    description: 'A laboratory with a warp drive. Sensors that see everything, guns that deter nothing.',
  },
  excelsior: {
    id: 'excelsior', name: 'Excelsior class', faction: 'federation',
    tier: 5, role: 'heavy cruiser',
    hull: 6400, shields: 5200, shieldRegen: 60,
    crew: 750, decks: 34, mass: 1.35,
    impulse: 0.75, turnRate: 7.5, maxWarp: 9.2, warpEfficiency: 1.25,
    powerCap: 240,
    weapons: [
      { id: 'phaser_fwd', type: 'beam', name: 'Forward Phaser Arrays', damage: 244, cycle: 3.0, ...arc(0, 250) },
      { id: 'phaser_aft', type: 'beam', name: 'Aft Phaser Arrays', damage: 168, cycle: 3.0, ...arc(180, 250) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Forward Torpedo Bay', damage: 545, cycle: 6.5, ...arc(0, 90) },
      { id: 'torpedo_aft', type: 'torpedo', name: 'Aft Torpedo Bay', damage: 400, cycle: 7.2, ...arc(180, 90) },
    ],
    slots: { tactical: 4, engineering: 4, science: 3, device: 3 },
    boffSeats: [
      { dept: 'tactical', rank: 3 }, { dept: 'engineering', rank: 4 },
      { dept: 'science', rank: 3 }, { dept: 'universal', rank: 3 },
    ],
    description: 'The transwarp experiment failed; the spaceframe did not. Still the fleet backbone.',
  },
  constellation: {
    id: 'constellation', name: 'Constellation class', faction: 'federation',
    tier: 3, role: 'explorer',
    hull: 3800, shields: 3200, shieldRegen: 44,
    crew: 535, decks: 14, mass: 1.0,
    impulse: 0.7, turnRate: 8.0, maxWarp: 8.5, warpEfficiency: 1.35,
    powerCap: 200,
    weapons: [
      { id: 'phaser_fwd', type: 'beam', name: 'Phaser Banks', damage: 152, cycle: 3.2, ...arc(0, 270) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Photon Tubes', damage: 360, cycle: 7.2, ...arc(0, 120) },
    ],
    slots: { tactical: 2, engineering: 3, science: 3, device: 3 },
    boffSeats: [
      { dept: 'engineering', rank: 3 }, { dept: 'science', rank: 3 },
      { dept: 'tactical', rank: 2 }, { dept: 'universal', rank: 2 },
    ],
    description: 'Four nacelles for range. Built to be away from resupply longer than anything else in the fleet.',
  },

  // ---------- Klingon ----------
  bird_of_prey: {
    id: 'bird_of_prey', name: 'B’rel-class Bird-of-Prey', faction: 'klingon',
    tier: 3, role: 'raider',
    hull: 2600, shields: 2000, shieldRegen: 34,
    crew: 36, decks: 3, mass: 0.55,
    impulse: 0.95, turnRate: 18.0, maxWarp: 8.5, warpEfficiency: 1.0,
    powerCap: 190, cloak: true,
    weapons: [
      { id: 'disruptor_fwd', type: 'cannon', name: 'Forward Disruptor Cannons', damage: 138, cycle: 2.4, ...arc(0, 45) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Photon Torpedo', damage: 330, cycle: 8.0, ...arc(0, 45) },
    ],
    description: 'Fast, cloaked, and fragile. It must decloak to fire, and it knows exactly when to.',
  },
  d7: {
    id: 'd7', name: 'D7-class Battlecruiser', faction: 'klingon',
    tier: 4, role: 'battlecruiser',
    hull: 4600, shields: 3600, shieldRegen: 40,
    crew: 400, decks: 18, mass: 1.1,
    impulse: 0.7, turnRate: 8.0, maxWarp: 8.5, warpEfficiency: 0.95,
    powerCap: 210,
    weapons: [
      { id: 'disruptor_fwd', type: 'beam', name: 'Forward Disruptors', damage: 136, cycle: 3.0, ...arc(0, 200) },
      { id: 'disruptor_aft', type: 'beam', name: 'Aft Disruptors', damage: 104, cycle: 3.2, ...arc(180, 160) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Photon Tubes', damage: 420, cycle: 7.5, ...arc(0, 90) },
    ],
    description: 'The Empire’s line ship. Built to trade damage until one side stops.',
  },

  // ---------- Romulan ----------
  warbird: {
    id: 'warbird', name: 'D’deridex-class Warbird', faction: 'romulan',
    tier: 6, role: 'warbird',
    hull: 7800, shields: 6200, shieldRegen: 58,
    crew: 1500, decks: 60, mass: 1.8,
    impulse: 0.62, turnRate: 5.5, maxWarp: 9.0, warpEfficiency: 1.0,
    powerCap: 250, cloak: true,
    weapons: [
      { id: 'disruptor_fwd', type: 'beam', name: 'Forward Disruptor Array', damage: 190, cycle: 3.2, ...arc(0, 220) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Plasma Torpedo', damage: 640, cycle: 9.0, ...arc(0, 90) },
    ],
    description: 'Twice your mass and in no hurry. It decloaks when the geometry already favours it.',
  },
  scoutship: {
    id: 'scoutship', name: 'Romulan Scout', faction: 'romulan',
    tier: 2, role: 'scout',
    hull: 1800, shields: 1600, shieldRegen: 44,
    crew: 24, decks: 3, mass: 0.5,
    impulse: 1.0, turnRate: 20.0, maxWarp: 8.0, warpEfficiency: 1.2,
    powerCap: 170, cloak: true,
    weapons: [
      { id: 'disruptor', type: 'cannon', name: 'Disruptor Cannon', damage: 84, cycle: 2.6, ...arc(0, 60) },
    ],
    description: 'Sent to look, not to fight. It will run the moment looking becomes expensive.',
  },

  // ---------- Cardassian ----------
  galor: {
    id: 'galor', name: 'Galor-class Cruiser', faction: 'cardassian',
    tier: 4, role: 'cruiser',
    hull: 4400, shields: 3800, shieldRegen: 48,
    crew: 300, decks: 16, mass: 1.05,
    impulse: 0.74, turnRate: 9.0, maxWarp: 9.0, warpEfficiency: 1.05,
    powerCap: 205,
    weapons: [
      { id: 'spiral_fwd', type: 'beam', name: 'Spiral-Wave Disruptors', damage: 144, cycle: 2.9, ...arc(0, 240) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Torpedo Launcher', damage: 380, cycle: 7.0, ...arc(0, 120) },
    ],
    description: 'Disciplined, well-drilled, and patient. It will wear your shields down by the numbers.',
  },

  // ---------- Others ----------
  marauder: {
    id: 'marauder', name: 'D’Kora-class Marauder', faction: 'ferengi',
    tier: 3, role: 'marauder',
    hull: 3400, shields: 3000, shieldRegen: 46,
    crew: 450, decks: 20, mass: 1.0,
    impulse: 0.78, turnRate: 10.0, maxWarp: 9.2, warpEfficiency: 1.2,
    powerCap: 195,
    weapons: [
      { id: 'plasma_fwd', type: 'beam', name: 'Plasma Emitters', damage: 112, cycle: 3.4, ...arc(0, 260) },
    ],
    description: 'Armed enough to intimidate freighters, and entirely willing to be bought off.',
  },
  orion_raider: {
    id: 'orion_raider', name: 'Orion Raider', faction: 'orion',
    tier: 2, role: 'raider',
    hull: 1900, shields: 1500, shieldRegen: 32,
    crew: 60, decks: 5, mass: 0.6,
    impulse: 0.92, turnRate: 16.0, maxWarp: 8.0, warpEfficiency: 1.0,
    powerCap: 170,
    weapons: [
      { id: 'disruptor', type: 'cannon', name: 'Salvaged Disruptors', damage: 76, cycle: 2.5, ...arc(0, 70) },
    ],
    description: 'Whatever they could bolt to a hull. Dangerous in threes, worthless alone.',
  },
  tholian_web_spinner: {
    id: 'tholian_web_spinner', name: 'Tholian Web Spinner', faction: 'tholian',
    tier: 4, role: 'interceptor',
    hull: 2200, shields: 4200, shieldRegen: 70,
    crew: 12, decks: 4, mass: 0.5,
    impulse: 1.05, turnRate: 22.0, maxWarp: 8.0, warpEfficiency: 1.0,
    powerCap: 200, websAfter: 45,
    weapons: [
      { id: 'lance', type: 'cannon', name: 'Thermionic Lance', damage: 130, cycle: 2.8, ...arc(0, 90) },
    ],
    description: 'It is not trying to destroy you. It is trying to finish the web before you leave.',
  },
  jem_hadar_attack: {
    id: 'jem_hadar_attack', name: 'Jem’Hadar Attack Ship', faction: 'dominion',
    tier: 5, role: 'attack ship',
    hull: 3000, shields: 2400, shieldRegen: 40,
    crew: 50, decks: 3, mass: 0.7,
    impulse: 1.1, turnRate: 19.0, maxWarp: 9.0, warpEfficiency: 1.0,
    powerCap: 220, ramsWhenDoomed: true,
    weapons: [
      { id: 'polaron_fwd', type: 'cannon', name: 'Polaron Cannons', damage: 176, cycle: 2.2, ...arc(0, 60) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Torpedo Launcher', damage: 420, cycle: 7.0, ...arc(0, 60) },
    ],
    description: 'Crewed by soldiers who were never told retreat exists. Below 20% hull, it will ram.',
  },
  borg_cube: {
    id: 'borg_cube', name: 'Borg Cube', faction: 'borg',
    tier: 10, role: 'cube',
    hull: 42000, shields: 30000, shieldRegen: 260,
    crew: 64000, decks: 0, mass: 12.0,
    impulse: 0.55, turnRate: 3.0, maxWarp: 9.6, warpEfficiency: 2.0,
    powerCap: 400, adapts: true, regenerates: 180,
    weapons: [
      { id: 'cutting_beam', type: 'beam', name: 'Cutting Beam', damage: 520, cycle: 3.0, ...arc(0, 360) },
      { id: 'torpedo', type: 'torpedo', name: 'Plasma Projector', damage: 1100, cycle: 8.0, ...arc(0, 360) },
    ],
    description: 'It has no front. It adapts to your weapon frequencies. You are not expected to win this.',
  },

  // ---------- Player-commandable, later eras ----------
  ambassador: {
    id: 'ambassador', name: 'Ambassador class', faction: 'federation',
    tier: 5, role: 'explorer',
    hull: 6800, shields: 5600, shieldRegen: 62,
    crew: 700, decks: 36, mass: 1.4,
    impulse: 0.72, turnRate: 7.0, maxWarp: 9.2, warpEfficiency: 1.3,
    powerCap: 240,
    weapons: [
      { id: 'phaser_fwd', type: 'beam', name: 'Forward Phaser Arrays', damage: 252, cycle: 3.0, ...arc(0, 270) },
      { id: 'phaser_aft', type: 'beam', name: 'Aft Phaser Arrays', damage: 138, cycle: 3.0, ...arc(180, 240) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Forward Torpedo Bay', damage: 560, cycle: 6.4, ...arc(0, 120) },
    ],
    slots: { tactical: 3, engineering: 4, science: 4, device: 3 },
    boffSeats: [
      { dept: 'command', rank: 3 }, { dept: 'engineering', rank: 4 },
      { dept: 'science', rank: 3 }, { dept: 'tactical', rank: 3 },
    ],
    description: 'The bridge between eras. Diplomatic suites forward, and enough hull to survive the diplomacy failing.',
  },
  galaxy: {
    id: 'galaxy', name: 'Galaxy class', faction: 'federation',
    tier: 6, role: 'explorer',
    hull: 9200, shields: 7600, shieldRegen: 78,
    crew: 1014, decks: 42, mass: 2.0,
    impulse: 0.68, turnRate: 5.5, maxWarp: 9.6, warpEfficiency: 1.5,
    powerCap: 265, saucerSeparation: true,
    weapons: [
      { id: 'phaser_dorsal', type: 'beam', name: 'Dorsal Phaser Array', damage: 330, cycle: 2.8, ...arc(0, 300) },
      { id: 'phaser_ventral', type: 'beam', name: 'Ventral Phaser Array', damage: 168, cycle: 2.8, ...arc(180, 300) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Forward Torpedo Bay', damage: 720, cycle: 6.0, ...arc(0, 120) },
      { id: 'torpedo_aft', type: 'torpedo', name: 'Aft Torpedo Bay', damage: 480, cycle: 7.0, ...arc(180, 120) },
    ],
    slots: { tactical: 4, engineering: 5, science: 4, device: 4 },
    boffSeats: [
      { dept: 'command', rank: 4 }, { dept: 'engineering', rank: 4 },
      { dept: 'science', rank: 4 }, { dept: 'tactical', rank: 3 },
    ],
    description: 'A city that goes to warp. Families aboard, which changes every decision you make with it.',
  },
  nebula: {
    id: 'nebula', name: 'Nebula class', faction: 'federation',
    tier: 6, role: 'science cruiser',
    hull: 7800, shields: 7200, shieldRegen: 96,
    crew: 750, decks: 30, mass: 1.7,
    impulse: 0.7, turnRate: 6.5, maxWarp: 9.5, warpEfficiency: 1.45,
    powerCap: 270, auxBonus: 35,
    weapons: [
      { id: 'phaser_fwd', type: 'beam', name: 'Phaser Arrays', damage: 262, cycle: 2.9, ...arc(0, 300) },
      { id: 'torpedo_pod', type: 'torpedo', name: 'Sensor Pod Launcher', damage: 600, cycle: 6.5, ...arc(0, 180) },
    ],
    slots: { tactical: 3, engineering: 4, science: 6, device: 3 },
    boffSeats: [
      { dept: 'science', rank: 4 }, { dept: 'science', rank: 3 },
      { dept: 'engineering', rank: 4 }, { dept: 'tactical', rank: 3 },
    ],
    description: 'The Galaxy spaceframe with the mission pod that matters. Sees things nothing else in the fleet can.',
  },
  intrepid: {
    id: 'intrepid', name: 'Intrepid class', faction: 'federation',
    tier: 5, role: 'science vessel',
    hull: 5400, shields: 5800, shieldRegen: 104,
    crew: 150, decks: 15, mass: 0.9,
    impulse: 0.92, turnRate: 13.0, maxWarp: 9.975, warpEfficiency: 1.7,
    powerCap: 250, auxBonus: 30,
    weapons: [
      { id: 'phaser_fwd', type: 'beam', name: 'Phaser Arrays', damage: 222, cycle: 2.9, ...arc(0, 300) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Forward Torpedo Tubes', damage: 530, cycle: 6.2, ...arc(0, 120) },
    ],
    slots: { tactical: 3, engineering: 3, science: 5, device: 3 },
    boffSeats: [
      { dept: 'science', rank: 4 }, { dept: 'engineering', rank: 3 },
      { dept: 'tactical', rank: 3 }, { dept: 'universal', rank: 3 },
    ],
    description: 'Fast, small, and built to be a long way from home. Variable geometry nacelles and a bio-neural computer.',
  },
  defiant: {
    id: 'defiant', name: 'Defiant class', faction: 'federation',
    tier: 5, role: 'escort',
    hull: 4400, shields: 4600, shieldRegen: 58,
    crew: 50, decks: 4, mass: 0.6,
    impulse: 1.05, turnRate: 20.0, maxWarp: 9.5, warpEfficiency: 1.0,
    powerCap: 245, ablative: true,
    weapons: [
      { id: 'pulse_fwd', type: 'cannon', name: 'Pulse Phaser Cannons', damage: 248, cycle: 2.0, ...arc(0, 45) },
      { id: 'phaser_fwd', type: 'beam', name: 'Phaser Arrays', damage: 108, cycle: 3.0, ...arc(0, 200) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Quantum Torpedoes', damage: 700, cycle: 7.0, ...arc(0, 60) },
    ],
    slots: { tactical: 5, engineering: 3, science: 2, device: 3 },
    boffSeats: [
      { dept: 'tactical', rank: 4 }, { dept: 'tactical', rank: 3 },
      { dept: 'engineering', rank: 3 }, { dept: 'science', rank: 2 },
    ],
    description: 'A warship, and the fleet stopped pretending otherwise. Overpowered, overgunned, and nearly tore itself apart in trials.',
  },
  sovereign: {
    id: 'sovereign', name: 'Sovereign class', faction: 'federation',
    tier: 6, role: 'heavy explorer',
    hull: 9800, shields: 8200, shieldRegen: 88,
    crew: 855, decks: 24, mass: 1.9,
    impulse: 0.82, turnRate: 8.0, maxWarp: 9.9, warpEfficiency: 1.6,
    powerCap: 285,
    weapons: [
      { id: 'phaser_dorsal', type: 'beam', name: 'Type-XII Phaser Arrays', damage: 330, cycle: 2.7, ...arc(0, 300) },
      { id: 'phaser_aft', type: 'beam', name: 'Aft Phaser Arrays', damage: 184, cycle: 2.7, ...arc(180, 260) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Quantum Torpedo Bay', damage: 820, cycle: 5.8, ...arc(0, 120) },
      { id: 'torpedo_aft', type: 'torpedo', name: 'Aft Torpedo Bay', damage: 580, cycle: 6.8, ...arc(180, 120) },
    ],
    slots: { tactical: 5, engineering: 5, science: 4, device: 4 },
    boffSeats: [
      { dept: 'command', rank: 4 }, { dept: 'tactical', rank: 4 },
      { dept: 'engineering', rank: 4 }, { dept: 'science', rank: 4 },
    ],
    description: 'The best hull Starfleet has. If you are flying one, the situation is already serious.',
  },
  runabout: {
    id: 'runabout', name: 'Danube-class Runabout', faction: 'federation',
    tier: 1, role: 'runabout',
    hull: 1200, shields: 1100, shieldRegen: 30,
    crew: 4, decks: 1, mass: 0.25,
    impulse: 1.0, turnRate: 24.0, maxWarp: 5.0, warpEfficiency: 0.9,
    powerCap: 140,
    weapons: [
      { id: 'phaser', type: 'beam', name: 'Phaser Emitters', damage: 58, cycle: 3.0, ...arc(0, 240) },
      { id: 'micro_torp', type: 'torpedo', name: 'Micro-Torpedoes', damage: 180, cycle: 8.0, ...arc(0, 90) },
    ],
    slots: { tactical: 1, engineering: 1, science: 1, device: 1 },
    boffSeats: [{ dept: 'universal', rank: 1 }],
    description: 'Four bunks and a warp drive. You are not fighting anything in this; you are getting somewhere.',
  },

  // ---------- Later hostiles ----------
  vorcha: {
    id: 'vorcha', name: 'Vor’cha-class Attack Cruiser', faction: 'klingon',
    tier: 5, role: 'attack cruiser',
    hull: 6200, shields: 5000, shieldRegen: 52,
    crew: 1900, decks: 28, mass: 1.5,
    impulse: 0.76, turnRate: 7.5, maxWarp: 9.6, warpEfficiency: 1.1,
    powerCap: 245, cloak: true,
    weapons: [
      { id: 'disruptor_cannon', type: 'cannon', name: 'Forward Disruptor Cannon', damage: 240, cycle: 2.6, ...arc(0, 60) },
      { id: 'disruptor_fwd', type: 'beam', name: 'Disruptor Arrays', damage: 158, cycle: 3.0, ...arc(0, 240) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Photon Tubes', damage: 520, cycle: 6.8, ...arc(0, 120) },
    ],
    description: 'The Empire’s line ship of the modern fleet. Cloaks, closes, and does not negotiate afterwards.',
  },
  neghvar: {
    id: 'neghvar', name: 'Negh’Var-class Warship', faction: 'klingon',
    tier: 7, role: 'flagship',
    hull: 11000, shields: 8400, shieldRegen: 72,
    crew: 2500, decks: 35, mass: 2.4,
    impulse: 0.64, turnRate: 4.5, maxWarp: 9.6, warpEfficiency: 1.0,
    powerCap: 300, cloak: true,
    weapons: [
      { id: 'disruptor_heavy', type: 'beam', name: 'Heavy Disruptor Arrays', damage: 250, cycle: 2.9, ...arc(0, 280) },
      { id: 'disruptor_aft', type: 'beam', name: 'Aft Disruptors', damage: 190, cycle: 3.1, ...arc(180, 220) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Heavy Torpedo Bay', damage: 820, cycle: 7.2, ...arc(0, 120) },
    ],
    description: 'The Chancellor’s flagship class. Fighting one alone is a decision, not an accident.',
  },
  ktinga: {
    id: 'ktinga', name: 'K’t’inga-class Battlecruiser', faction: 'klingon',
    tier: 4, role: 'battlecruiser',
    hull: 5000, shields: 3900, shieldRegen: 42,
    crew: 440, decks: 18, mass: 1.15,
    impulse: 0.72, turnRate: 8.0, maxWarp: 9.0, warpEfficiency: 1.0,
    powerCap: 215,
    weapons: [
      { id: 'disruptor_fwd', type: 'beam', name: 'Forward Disruptors', damage: 148, cycle: 2.9, ...arc(0, 220) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Photon Tubes', damage: 460, cycle: 7.2, ...arc(0, 90) },
    ],
    description: 'The D7 rebuilt and kept in service for a century, because it works.',
  },
  keldon: {
    id: 'keldon', name: 'Keldon-class Cruiser', faction: 'cardassian',
    tier: 5, role: 'heavy cruiser',
    hull: 5800, shields: 4800, shieldRegen: 56,
    crew: 400, decks: 18, mass: 1.3,
    impulse: 0.76, turnRate: 8.0, maxWarp: 9.2, warpEfficiency: 1.05,
    powerCap: 235,
    weapons: [
      { id: 'spiral_fwd', type: 'beam', name: 'Spiral-Wave Disruptors', damage: 178, cycle: 2.8, ...arc(0, 250) },
      { id: 'spiral_aft', type: 'beam', name: 'Aft Emitters', damage: 130, cycle: 3.0, ...arc(180, 200) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Torpedo Launcher', damage: 480, cycle: 6.8, ...arc(0, 120) },
    ],
    description: 'The Galor with everything the Order wanted added. Drilled, patient, and very hard to surprise.',
  },
  jem_hadar_battleship: {
    id: 'jem_hadar_battleship', name: 'Jem’Hadar Battleship', faction: 'dominion',
    tier: 8, role: 'battleship',
    hull: 16000, shields: 12000, shieldRegen: 120,
    crew: 900, decks: 40, mass: 3.2,
    impulse: 0.62, turnRate: 4.0, maxWarp: 9.4, warpEfficiency: 1.1,
    powerCap: 330, ramsWhenDoomed: true,
    weapons: [
      { id: 'polaron_heavy', type: 'beam', name: 'Heavy Polaron Beams', damage: 300, cycle: 2.8, ...arc(0, 300) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Torpedo Batteries', damage: 900, cycle: 6.5, ...arc(0, 180) },
    ],
    description: 'The Dominion does not build escorts for prestige. This is what they send when the escorts failed.',
  },
  bioship: {
    id: 'bioship', name: 'Bioship', faction: 'borg',
    tier: 9, role: 'bioship',
    hull: 20000, shields: 14000, shieldRegen: 200,
    crew: 1, decks: 0, mass: 2.6,
    impulse: 1.2, turnRate: 14.0, maxWarp: 9.9, warpEfficiency: 2.0,
    powerCap: 360, adapts: true, regenerates: 120,
    weapons: [
      { id: 'bio_beam', type: 'beam', name: 'Bioplasmic Discharge', damage: 460, cycle: 3.2, ...arc(0, 360) },
    ],
    description: 'Organic, fast, and outside every doctrine Starfleet has written. Weapons adapt within seconds.',
  },
  transport: {
    id: 'transport', name: 'Colony Transport', faction: 'independent',
    tier: 1, role: 'transport',
    hull: 2200, shields: 1200, shieldRegen: 20,
    crew: 1400, decks: 6, mass: 1.6,
    impulse: 0.45, turnRate: 4.0, maxWarp: 6.0, warpEfficiency: 1.0,
    powerCap: 130, civilian: true,
    weapons: [],
    description: 'Fourteen hundred colonists and no weapons at all. Whatever happens to it happens because of you.',
  },
  freighter: {
    id: 'freighter', name: 'Civilian Freighter', faction: 'independent',
    tier: 1, role: 'freighter',
    hull: 1600, shields: 900, shieldRegen: 18,
    crew: 14, decks: 10, mass: 1.2,
    impulse: 0.5, turnRate: 5.0, maxWarp: 6.5, warpEfficiency: 1.0,
    powerCap: 120, civilian: true,
    weapons: [],
    description: 'Unarmed, overloaded, and a long way from anyone who could help.',
  },
};

export const SHIP_LIST = Object.values(SHIP_CLASSES);

export function getShipClass(id) {
  return SHIP_CLASSES[id];
}

/** Ships the player may command at a given rank tier. */
export function commandableAt(tier) {
  return SHIP_LIST.filter((s) => s.faction === 'federation' && s.boffSeats && s.tier <= tier);
}

/** Registry numbers for generated Federation ships. */
export const FEDERATION_REGISTRIES = [
  'NCC-1701', 'NCC-1017', 'NCC-1371', 'NCC-1672', 'NCC-1764', 'NCC-2000',
  'NCC-1831', 'NCC-1864', 'NCC-638', 'NCC-1685',
];
