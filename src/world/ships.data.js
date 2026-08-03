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
    crew: 430, mass: 1.0,
    impulse: 0.72, turnRate: 9.0, maxWarp: 8.0, warpEfficiency: 1.0,
    powerCap: 200,
    weapons: [
      { id: 'phaser_bank_fwd', type: 'beam', name: 'Forward Phaser Banks', damage: 118, cycle: 3.2, ...arc(0, 250) },
      { id: 'phaser_bank_aft', type: 'beam', name: 'Aft Phaser Banks', damage: 96, cycle: 3.2, ...arc(180, 200) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Forward Photon Tubes', damage: 380, cycle: 7.5, ...arc(0, 90) },
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
    crew: 430, mass: 1.05,
    impulse: 0.78, turnRate: 9.5, maxWarp: 9.0, warpEfficiency: 1.15,
    powerCap: 220,
    weapons: [
      { id: 'phaser_bank_fwd', type: 'beam', name: 'Forward Phaser Banks', damage: 142, cycle: 3.0, ...arc(0, 250) },
      { id: 'phaser_bank_aft', type: 'beam', name: 'Aft Phaser Banks', damage: 118, cycle: 3.0, ...arc(180, 200) },
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
    crew: 220, mass: 0.8,
    impulse: 0.8, turnRate: 12.0, maxWarp: 8.0, warpEfficiency: 1.1,
    powerCap: 180,
    weapons: [
      { id: 'phaser_bank_fwd', type: 'beam', name: 'Phaser Banks', damage: 96, cycle: 3.2, ...arc(0, 250) },
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
    crew: 80, mass: 0.6,
    impulse: 0.68, turnRate: 14.0, maxWarp: 7.5, warpEfficiency: 1.3,
    powerCap: 190, auxBonus: 25,
    weapons: [
      { id: 'phaser_light', type: 'beam', name: 'Light Phaser Emitters', damage: 64, cycle: 3.5, ...arc(0, 300) },
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
    crew: 750, mass: 1.35,
    impulse: 0.75, turnRate: 7.5, maxWarp: 9.2, warpEfficiency: 1.25,
    powerCap: 240,
    weapons: [
      { id: 'phaser_fwd', type: 'beam', name: 'Forward Phaser Arrays', damage: 156, cycle: 3.0, ...arc(0, 250) },
      { id: 'phaser_aft', type: 'beam', name: 'Aft Phaser Arrays', damage: 140, cycle: 3.0, ...arc(180, 250) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Forward Torpedo Bay', damage: 470, cycle: 6.5, ...arc(0, 90) },
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
    crew: 535, mass: 1.0,
    impulse: 0.7, turnRate: 8.0, maxWarp: 8.5, warpEfficiency: 1.35,
    powerCap: 200,
    weapons: [
      { id: 'phaser_fwd', type: 'beam', name: 'Phaser Banks', damage: 108, cycle: 3.2, ...arc(0, 270) },
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
    crew: 36, mass: 0.55,
    impulse: 0.95, turnRate: 18.0, maxWarp: 8.5, warpEfficiency: 1.0,
    powerCap: 190, cloak: true,
    weapons: [
      { id: 'disruptor_fwd', type: 'cannon', name: 'Forward Disruptor Cannons', damage: 168, cycle: 2.4, ...arc(0, 45) },
      { id: 'torpedo_fwd', type: 'torpedo', name: 'Photon Torpedo', damage: 400, cycle: 8.0, ...arc(0, 45) },
    ],
    description: 'Fast, cloaked, and fragile. It must decloak to fire, and it knows exactly when to.',
  },
  d7: {
    id: 'd7', name: 'D7-class Battlecruiser', faction: 'klingon',
    tier: 4, role: 'battlecruiser',
    hull: 4600, shields: 3600, shieldRegen: 40,
    crew: 400, mass: 1.1,
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
    crew: 1500, mass: 1.8,
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
    crew: 24, mass: 0.5,
    impulse: 1.0, turnRate: 20.0, maxWarp: 8.0, warpEfficiency: 1.2,
    powerCap: 170, cloak: true,
    weapons: [
      { id: 'disruptor', type: 'cannon', name: 'Disruptor Cannon', damage: 96, cycle: 2.6, ...arc(0, 60) },
    ],
    description: 'Sent to look, not to fight. It will run the moment looking becomes expensive.',
  },

  // ---------- Cardassian ----------
  galor: {
    id: 'galor', name: 'Galor-class Cruiser', faction: 'cardassian',
    tier: 4, role: 'cruiser',
    hull: 4400, shields: 3800, shieldRegen: 48,
    crew: 300, mass: 1.05,
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
    crew: 450, mass: 1.0,
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
    crew: 60, mass: 0.6,
    impulse: 0.92, turnRate: 16.0, maxWarp: 8.0, warpEfficiency: 1.0,
    powerCap: 170,
    weapons: [
      { id: 'disruptor', type: 'cannon', name: 'Salvaged Disruptors', damage: 88, cycle: 2.5, ...arc(0, 70) },
    ],
    description: 'Whatever they could bolt to a hull. Dangerous in threes, worthless alone.',
  },
  tholian_web_spinner: {
    id: 'tholian_web_spinner', name: 'Tholian Web Spinner', faction: 'tholian',
    tier: 4, role: 'interceptor',
    hull: 2200, shields: 4200, shieldRegen: 70,
    crew: 12, mass: 0.5,
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
    crew: 50, mass: 0.7,
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
    crew: 64000, mass: 12.0,
    impulse: 0.55, turnRate: 3.0, maxWarp: 9.6, warpEfficiency: 2.0,
    powerCap: 400, adapts: true, regenerates: 180,
    weapons: [
      { id: 'cutting_beam', type: 'beam', name: 'Cutting Beam', damage: 520, cycle: 3.0, ...arc(0, 360) },
      { id: 'torpedo', type: 'torpedo', name: 'Plasma Projector', damage: 1100, cycle: 8.0, ...arc(0, 360) },
    ],
    description: 'It has no front. It adapts to your weapon frequencies. You are not expected to win this.',
  },
  freighter: {
    id: 'freighter', name: 'Civilian Freighter', faction: 'independent',
    tier: 1, role: 'freighter',
    hull: 1600, shields: 900, shieldRegen: 18,
    crew: 14, mass: 1.2,
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
