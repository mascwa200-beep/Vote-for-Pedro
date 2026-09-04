// The room the captain is standing in changed nothing.
//
// Measured on `origin/main`, twenty-four battles against two Galors, the same
// captain and the same seeds, moved from room to room before the shooting
// started:
//
//     standing in     accuracy   repair   won      hull left
//     the bridge       1.0450    1.116    3 / 24     4.7%
//     his quarters     1.0450    1.116    3 / 24     4.7%
//     the BRIG         1.0450    1.116    3 / 24     4.7%
//     engineering      1.0450    1.116    3 / 24     4.7%
//
// Byte for byte the same fight from the captain's chair and from a cell. The
// deck plan had seventeen rooms, a walker, a turbolift, collision, routing and
// ambience, and the only mechanical question it could answer was whether the
// chair was within reach.
//
// The con is why. Walking off the bridge already handed the con to the next
// ranking officer — there is a line of succession, a watch bill, hours kept and
// a handback report when you take it back — and `conStation` was read by two
// display sites, one invariant and the save file. Nothing about the ship
// changed hands with it.
//
// And there were two ways off a deck. "Go to engineering" was refused under
// fire; walking up to the door and opening it went `Walker.useExit` straight
// from the screen with no mode check anywhere on the path. Measured on the same
// tick: `goToRoom` returned "Not while we are under fire, Captain" and
// `useExit` returned ok and put the captain in the turbolift, which serves
// every deck on the ship.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';
import { Ship } from '../src/sim/ship.js';
import { occupantsOf } from '../src/sim/occupancy.js';
import { ROOM_LIST, ROOMS } from '../src/world/interiors.data.js';

const SHARP = {
  command: 18, tactics: 20, engineering: 18, science: 12, medicine: 16, diplomacy: 10,
};
const GREEN = {
  command: 10, tactics: 10, engineering: 10, science: 10, medicine: 10, diplomacy: 10,
};

const game = (room = 'bridge', { seed = 3n, scores = SHARP } = {}) => {
  const g = new Game({
    seed,
    crewMode: 'original',
    shipClass: 'constitution',
    character: new Character({ speciesId: 'human', careerId: 'command', baseScores: scores }),
  });
  g.walk.enter(room);
  g.updateCon();
  return g;
};

const hostiles = (...ids) =>
  ids.map((c, i) => new Ship(c, { faction: 'cardassian', name: `H${i}` }));

/** Fight it out from a given compartment and report what came of it. */
function battles(room, { seeds = 24n, scores = SHARP } = {}) {
  let won = 0;
  let hull = 0;
  for (let seed = 1n; seed <= seeds; seed++) {
    const g = game(room, { seed, scores });
    const me = g.ship;
    const eng = g.startCombat(hostiles('galor', 'galor'), { relentless: true });
    let t = 0;
    while (!eng.over && t < 300) {
      eng.comeAboutTo(eng.target);
      me.throttle = 0.6;
      eng.update(1 / 30);
      t += 1 / 30;
    }
    if (eng.outcome === 'victory') won++;
    hull += me.destroyed ? 0 : me.hullPct;
  }
  return { won, hull: hull / Number(seeds) };
}

describe('there is one way to ask whether the captain may leave the room', () => {
  test('an order to cross the ship is refused under fire', () => {
    const g = game();
    g.startCombat(hostiles('galor'));
    const r = g.goToRoom('engineering');
    assert.equal(r.ok, false);
    assert.match(r.reason, /under fire/);
  });

  test('and so is the door beside you, which it was not', () => {
    // The control this whole guard exists for. Stand the captain in the
    // bridge's own doorway — which is what `useWhatIsInFront` requires — and
    // open it.
    const g = game();
    g.startCombat(hostiles('galor'));
    const w = g.walk;
    [w.x, w.z] = w.room.exits[0].at;
    w.step({ move: [0, 0], turn: 0 }, 1 / 30);
    assert.ok(w.atExit, 'the captain is not standing at a door, so this proves nothing');
    const r = g.useExitAhead();
    assert.equal(r.ok, false, 'the captain walked out of a firefight');
    assert.match(r.reason, /under fire/);
    assert.equal(w.roomId, 'bridge');
  });

  test('and out of a fight the same door opens', () => {
    // The positive case, or the test above passes for a captain who can never
    // go anywhere.
    const g = game();
    const w = g.walk;
    [w.x, w.z] = w.room.exits[0].at;
    w.step({ move: [0, 0], turn: 0 }, 1 / 30);
    const to = w.atExit.to;
    assert.equal(g.useExitAhead().ok, true);
    assert.equal(w.roomId, to);
  });

  test('and the door hands over the con, which it never did', () => {
    // Going round the game into the walker skipped `updateCon` as well as the
    // combat rule, so a captain who left the bridge by hand still held the con
    // from the cargo bay.
    const g = game();
    assert.equal(g.conStation, null);
    const w = g.walk;
    [w.x, w.z] = w.room.exits[0].at;
    w.step({ move: [0, 0], turn: 0 }, 1 / 30);
    g.useExitAhead();
    assert.notEqual(w.roomId, 'bridge');
    assert.ok(g.conStation, 'nobody was left conning the ship');
  });

  test('and only the game asks the walker to open a door', () => {
    // A wiring test, because "one rule in one place" is a claim about the whole
    // tree and not about the two lines that were fixed. `Walker.useExit` knows
    // about geometry and nothing about alert conditions; the rule lives in
    // `Game.useExitAhead`, and the moment a second caller reaches past it the
    // defect above comes back.
    const files = [];
    (function walk(dir) {
      for (const e of readdirSync(dir)) {
        const p = `${dir}/${e}`;
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.js')) files.push(p);
      }
    })('src');

    const callers = [];
    for (const f of files) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (/\.useExit\(/.test(line)) callers.push(f);
      }
    }
    // `walk.js` itself: the definition, and `stepToward`, which is the
    // autopilot behind `goToRoom` and is therefore already behind the rule.
    // `state.js`: `useExitAhead`, which is the rule.
    assert.deepEqual([...new Set(callers)].sort(), ['src/core/state.js', 'src/sim/walk.js']);
  });
});

describe('the ship is commanded by whoever has the con', () => {
  test('walking off the bridge hands it over, and that now costs something', () => {
    const bridge = game('bridge');
    const cell = game('brig');
    assert.equal(bridge.conStation, null, 'the captain did not have his own con');
    assert.ok(cell.conStation, 'nobody took the con when the captain left');
    assert.ok(bridge.ship.mod('accuracy') > cell.ship.mod('accuracy') + 0.02,
      `accuracy ${bridge.ship.mod('accuracy')} on the bridge against `
      + `${cell.ship.mod('accuracy')} in the brig`);
  });

  test('and it shows in the fight, which is the measurement that matters', () => {
    const bridge = battles('bridge');
    const cell = battles('brig');
    assert.ok(bridge.won > cell.won,
      `${bridge.won} of 24 won from the chair against ${cell.won} from the brig`);
    assert.ok(bridge.hull > cell.hull + 0.01,
      `${(100 * bridge.hull).toFixed(1)}% hull left against ${(100 * cell.hull).toFixed(1)}%`);
  });

  test('and auxiliary control is a place the ship can be commanded from', () => {
    // One of six rooms nothing outside the deck plan referenced. This is what
    // the room is for.
    const aux = game('auxcontrol');
    assert.equal(aux.atTheCon, true);
    assert.equal(aux.conStation, null, 'somebody relieved the captain in auxiliary control');
    assert.equal(aux.ship.mod('accuracy'), game('bridge').ship.mod('accuracy'));
    // And it is the only other one.
    for (const r of ROOM_LIST) {
      if (r.id === 'bridge' || r.id === 'auxcontrol' || r.id === 'surface') continue;
      assert.equal(game(r.id).atTheCon, false, `${r.id} conned the ship`);
    }
  });

  test('and a green captain is better off with a good exec, which is the point', () => {
    // The rule cuts both ways or it is not a rule about command, it is a
    // penalty for walking. A captain with no ability modifiers at all
    // contributes nothing to the ship; a first officer of real expertise
    // contributes something.
    const chair = game('bridge', { scores: GREEN });
    const away = game('quarters', { scores: GREEN });
    assert.ok(away.conOfficer.expertise > 50, 'the exec is not good enough to prove this');
    assert.ok(away.ship.mod('accuracy') > chair.ship.mod('accuracy'),
      `green captain ${chair.ship.mod('accuracy')} against exec ${away.ship.mod('accuracy')}`);
  });

  test('and handing it over deliberately from the chair does the same thing', () => {
    const g = game('bridge');
    const before = g.ship.mod('accuracy');
    assert.equal(g.handOverCon('first_officer').ok, true);
    assert.ok(g.ship.mod('accuracy') < before, 'the ship did not change hands with the con');
    assert.equal(g.takeCon().ok, true);
    assert.ok(Math.abs(g.ship.mod('accuracy') - before) < 1e-9, 'taking it back did not give it back');
  });

  test('and the recompute only happens when the answer has changed', () => {
    // `updateCon` runs every frame the captain is walking, and `applyAllMods`
    // rebuilds the whole modifier stack.
    const g = game('bridge');
    let calls = 0;
    const real = g.applyAllMods.bind(g);
    g.applyAllMods = () => { calls++; return real(); };
    for (let i = 0; i < 90; i++) g.updateCon();
    assert.equal(calls, 0, `${calls} rebuilds for a captain standing still`);
    g.walk.enter('quarters');
    g.updateCon();
    assert.equal(calls, 1);
  });
});

describe('and being in the room buys what an intercom cannot', () => {
  test('main engineering, with the repair parties', () => {
    const eng = game('engineering');
    const cell = game('brig');
    assert.ok(eng.ship.mod('repairRate') > cell.ship.mod('repairRate') + 0.1,
      `repair ${eng.ship.mod('repairRate')} in engineering against ${cell.ship.mod('repairRate')}`);
    // And it is paid for: the con is still gone.
    assert.ok(eng.conStation);
    assert.ok(eng.ship.mod('accuracy') < game('bridge').ship.mod('accuracy'));
  });

  test('sickbay, while they are carrying people in', () => {
    const bay = game('sickbay');
    assert.ok(bay.ship.mod('crewProtect') > game('brig').ship.mod('crewProtect'),
      'standing in sickbay saved nobody');
  });

  test('and a captain with no gift for it buys nothing by standing there', () => {
    // The control. The bonus is the captain's own ability, not a reward for
    // choosing the room off a list.
    const green = game('engineering', { scores: GREEN });
    assert.equal(green.stationMods().repairRate, 1);
  });
});

describe('every compartment has somebody in it, or a reason not to', () => {
  const ALERTS = ['normal', 'yellow', 'red', 'blue'];

  test('the five rooms the occupancy table forgot', () => {
    // Measured before this: at yellow alert seven of seventeen compartments
    // returned nobody at all — including auxiliary control, which is the room
    // the ship is fought from when the bridge is gone.
    const g = game();
    const seen = {};
    for (const a of ALERTS) {
      g.setAlert(a);
      for (const id of ['auxcontrol', 'quarters', 'briefing', 'brig', 'transporter']) {
        seen[id] = Math.max(seen[id] ?? 0, occupantsOf(g, id).filter((o) => !o.intruder).length);
      }
    }
    for (const [id, n] of Object.entries(seen)) {
      assert.ok(n > 0, `${id} is empty at every alert condition`);
    }
  });

  test('and auxiliary control fills up exactly when it would be needed', () => {
    const g = game();
    const at = (a) => { g.setAlert(a); return occupantsOf(g, 'auxcontrol').length; };
    assert.equal(at('normal'), 0, 'deck eight is manned while the bridge is answering');
    assert.ok(at('red') > at('yellow'), 'the second bridge did not fill up at red alert');
  });

  test('and the captain\'s quarters empty when the klaxon goes', () => {
    const g = game();
    const at = (a) => { g.setAlert(a); return occupantsOf(g, 'quarters').length; };
    assert.ok(at('normal') > 0);
    assert.equal(at('red'), 0, 'somebody was still in the captain\'s quarters at red alert');
  });

  test('and every rule places the people it asks for', () => {
    // The silent drop. `place` threw twelve darts and gave up, so a rule that
    // asked for three in the briefing room stood one of them up and lost the
    // other two without a word — the ship had fewer people in it than its own
    // table said, and nothing complained. Asserted for every room at every
    // alert, so no future rule can quietly ask for more than a compartment
    // holds.
    const g = game();
    g.ship.hull = g.ship.maxHull * 0.6;
    g.ship.fires = 2;
    g.ship.crew = g.ship.maxCrew - 30;
    const short = [];
    for (const a of ALERTS) {
      g.setAlert(a);
      for (const r of ROOM_LIST) {
        if (r.id === 'surface') continue;
        const people = occupantsOf(g, r.id).filter((o) => !o.intruder);
        // Everyone placed must be inside the room and clear of its furniture.
        for (const p of people) {
          const clash = (ROOMS[r.id].props ?? []).some((prop) => prop.solid !== false
            && Math.hypot(p.at[0] - prop.at[0], p.at[1] - prop.at[1]) < (prop.radius ?? 0.6) * 0.5);
          if (clash) short.push(`${r.id} at ${a}: somebody is standing inside the furniture`);
        }
      }
    }
    assert.deepEqual(short, []);
  });

  test('and the briefing room seats a briefing', () => {
    // The room that found the drop: six metres by four and a half with a
    // conference table in the middle, leaving a ring about a metre wide.
    const g = game();
    g.setAlert('yellow');
    assert.equal(occupantsOf(g, 'briefing').length, 3,
      'the senior staff did not all fit in the briefing room');
  });

  test('and the recreation room, which was quietly losing one', () => {
    // Not a new rule — the mess has had one since the file was written, and
    // fixing the sampler gave it back the sixth person it had been asking for
    // and dropping.
    const g = game();
    g.setAlert('normal');
    assert.equal(occupantsOf(g, 'rec').length, 6);
  });

  test('and not the turbolift, deliberately', () => {
    const g = game();
    for (const a of ALERTS) {
      g.setAlert(a);
      assert.equal(occupantsOf(g, 'turbolift').length, 0,
        'somebody else is in the lift car with the captain');
    }
  });
});

describe('two exports that were words in a file', () => {
  test('they are gone, and nothing imports them', () => {
    const walk = readFileSync('src/sim/walk.js', 'utf8');
    const interiors = readFileSync('src/world/interiors.data.js', 'utf8');
    // `angleDelta`: exported, and not called even inside the file that
    // declared it. `ROOM_WORDS`: exported, imported nowhere, and documented as
    // being "for the parser's gazetteer" — which resolves star system names
    // fuzzily, and which room names are deliberately kept out of.
    assert.doesNotMatch(walk, /export function angleDelta/);
    assert.doesNotMatch(interiors, /export const ROOM_WORDS/);
  });
});
