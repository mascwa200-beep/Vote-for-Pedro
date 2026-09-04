// Every officer aboard came out of a five-year commission exactly as they went
// in.
//
// `Officer.xp` and `Officer.level` were declared, defaulted, saved, loaded and
// guarded by an invariant in `sim/invariants.js`. The only writes anywhere in
// `src/` were those two defaults. Measured over twelve battles, twelve
// landings, thirty-six days and forty-eight thousand experience, while the
// captain went from his first command to Captain:
//
//     AT COMMISSIONING     Spock  xp=0 lvl=1 rel=0 exp=94
//     AFTER ALL OF THAT    Spock  xp=0 lvl=1 rel=0 exp=94
//
// Byte-identical, every one of them.
//
// `Officer.relationship` was worse. It carried the comment "-100..100, how they
// feel about serving under you" and appeared on three lines in the whole of
// `src/` — the declaration, `save()` and `load()`. Nothing incremented it,
// nothing decremented it, nothing read it.
//
// One measurement to watch out for, because it caught me: the first tuning
// pass had a crew finishing a twelve-battle run at -50 and I took that for a
// mistuned penalty. It was not. That captain LOST THE SHIP EIGHT TIMES IN
// TWELVE, and a crew that has been blown up eight times ought to think poorly
// of him. The scenario was wrong, not the numbers. Both directions are
// measured below for that reason.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Game } from '../src/core/state.js';
import { on } from '../src/core/events.js';
import { Character } from '../src/rules/character.js';
import { Ship } from '../src/sim/ship.js';
import { Officer, ABILITIES } from '../src/sim/officers.js';
import { applyAbility } from '../src/sim/powers.js';

const game = ({ seed = 5n, shipClass = 'constitution', speciesId = 'human' } = {}) => new Game({
  seed,
  crewMode: 'canon',
  crew: 'tos',
  shipClass,
  character: new Character({ speciesId, careerId: 'command' }),
});

/** Fly a run of fights and report what it did to the first officer. */
function commission({ shipClass, foe, n = 14 }) {
  const g = game({ shipClass });
  const outcomes = {};
  for (let i = 0; i < n; i++) {
    const eng = g.startCombat([new Ship(foe, { faction: 'klingon', name: `K${i}` })],
      { relentless: true });
    let t = 0;
    while (!eng.over && t < 240) {
      eng.comeAboutTo(eng.target);
      g.ship.throttle = 0.6;
      g.ship.power.applyPreset(g.ship.shieldPct < 0.35 ? 'defense' : 'attack');
      eng.update(1 / 30);
      t += 1 / 30;
    }
    outcomes[eng.outcome] = (outcomes[eng.outcome] ?? 0) + 1;
    g.ship.restore();
    g.passTime(72);
  }
  return { g, outcomes, xo: g.crew.at('first_officer') };
}

describe('service tells', () => {
  test('an officer who fights comes out of it knowing more than they went in with', () => {
    const before = game().crew.at('first_officer');
    const { xo } = commission({ shipClass: 'galaxy', foe: 'bird_of_prey' });
    assert.ok(xo.level > before.level, `level ${before.level} became ${xo.level}`);
    assert.ok(xo.expertise > before.expertise,
      `expertise ${before.expertise} became ${xo.expertise}`);
  });

  test('and it is capped, because a lieutenant is not a demigod', () => {
    const o = new Officer({ station: 'helm', name: 'Test', expertise: 97 });
    o.serve(1e6);
    assert.equal(o.expertise, 100);
  });

  test('and the dead do not learn', () => {
    const o = new Officer({ station: 'helm', name: 'Test' });
    o.kill('test');
    assert.equal(o.serve(1e6), null);
    assert.equal(o.level, 1);
  });

  test('and a level is worth having, because expertise is read', () => {
    // The payoff chain, through the two doors the game actually uses:
    // `startCooldown` shaves the wait by expertise, and `watchMods` is how well
    // this officer conns the ship when the captain is off the bridge.
    const green = new Officer({ station: 'helm', name: 'Green', expertise: 55 });
    const seasoned = new Officer({ station: 'helm', name: 'Seasoned', expertise: 55 });
    seasoned.serve(4000);
    assert.ok(seasoned.expertise > green.expertise);

    green.learn('evasive_maneuvers');
    seasoned.learn('evasive_maneuvers');
    green.startCooldown('evasive_maneuvers');
    seasoned.startCooldown('evasive_maneuvers');
    assert.ok(seasoned.cooldowns.evasive_maneuvers < green.cooldowns.evasive_maneuvers,
      'a seasoned officer works their station no faster');

    assert.ok(Game.watchMods(seasoned).accuracy > Game.watchMods(green).accuracy,
      'a seasoned officer conns the ship no better');
  });

  test('and it is not the captain\'s experience wearing a hat', () => {
    // `CaptainProgress.addXP` carries a promotion, a feat and skill points, and
    // `tests/rules.test.js` nets the whole tree to keep it going through
    // `Game.awardXP`. An officer's own service is a different currency with
    // none of that behind it, which is why the method has a different name.
    assert.equal(typeof new Officer({ station: 'helm', name: 'T' }).addXP, 'undefined');
    assert.equal(typeof new Officer({ station: 'helm', name: 'T' }).serve, 'function');
  });

  test('and a level survives a save', () => {
    const o = new Officer({ station: 'helm', name: 'Test', expertise: 60 });
    o.serve(1200);
    o.regard(-30, 'test');
    const back = Officer.load(JSON.parse(JSON.stringify(o.save())));
    assert.equal(back.level, o.level);
    assert.equal(back.xp, o.xp);
    assert.equal(back.expertise, o.expertise);
    assert.equal(back.relationship, o.relationship);
  });
});

describe('how they feel about serving under you', () => {
  test('a captain who wins is thought well of', () => {
    const { outcomes, xo } = commission({ shipClass: 'galaxy', foe: 'bird_of_prey' });
    assert.ok((outcomes.victory ?? 0) >= 12, `only ${outcomes.victory} of 14 won`);
    assert.ok(xo.relationship > 15, `fourteen victories left the exec at ${xo.relationship}`);
  });

  test('and a captain who keeps losing the ship is not', () => {
    // The other direction, and the control for the one above: if regard only
    // ever went up, "a captain who wins is thought well of" would be measuring
    // the passage of time.
    const { outcomes, xo } = commission({ shipClass: 'miranda', foe: 'neghvar' });
    assert.ok((outcomes.destroyed ?? 0) >= 12, `only ${outcomes.destroyed} of 14 lost`);
    assert.ok(xo.relationship < -40, `fourteen ships lost left the exec at ${xo.relationship}`);
  });

  test('and it stays inside the range it was declared with', () => {
    const o = new Officer({ station: 'helm', name: 'Test' });
    o.regard(1e6, 'test');
    assert.equal(o.relationship, 100);
    o.regard(-1e6, 'test');
    assert.equal(o.relationship, -100);
  });

  test('and a redshirt is not a grievance', () => {
    // `team.casualties` carries anonymous security losses alongside named
    // officers, and the game models those as the expected cost of a landing
    // party. Docking the senior staff every time one does not come back would
    // make every away mission a grievance.
    //
    // The first draft of this test asserted that 'Security crewman' is not a
    // named officer and that nobody's regard had changed — after doing nothing
    // at all. It passed and proved nothing. This one flies landings until it
    // finds the case it is about.
    let securityOnly = 0;
    let officerHurt = 0;
    const blamed = [];
    const off = on('officer:regard', (e) => {
      if (e.reason === 'an officer hurt on the surface') blamed.push(e.reason);
    });
    try {
      for (let s = 1n; s <= 200n && securityOnly < 3; s++) {
        const g = game({ seed: s });
        g.enterOrbit();
        const names = new Set(g.crew.officers.map((x) => x.name));
        for (const m of g.availableAwayMissions()) {
          blamed.length = 0;
          const r = g.awayMission(m.id);
          const cas = r.casualties ?? [];
          if (!cas.length) continue;
          if (cas.every((c) => !names.has(c.name))) {
            securityOnly++;
            assert.deepEqual(blamed, [],
              'the senior staff blamed the captain for a security crewman');
          } else {
            officerHurt++;
          }
        }
      }
    } finally { off?.(); }
    assert.ok(securityOnly >= 1,
      `no landing in two hundred lost only security, so this measured nothing `
      + `(${officerHurt} hurt an officer)`);
  });
});

describe('and it is read where the officer layer said it would be', () => {
  /**
   * How often the bridge argues, over forty crews and three weighted orders.
   *
   * `crewMode: 'original'`, so the forty seeds are forty different sets of
   * officers rather than the same doctor forty times. Measured against the
   * canon TOS crew this reads 66.7% at every level of regard and says nothing:
   * that crew has one medical officer with one candor score, twenty points of
   * trust does not carry him across his own threshold, and the third order —
   * ejecting the core — is gated on daring, which regard does not touch. A bar
   * set on one officer is not a measurement of a rule about officers.
   */
  function objections(rel, speciesId = 'human') {
    let objected = 0;
    let n = 0;
    for (let s = 1n; s <= 40n; s++) {
      const g = new Game({
        seed: s,
        crewMode: 'original',
        character: new Character({ speciesId, careerId: 'command' }),
      });
      for (const id of ['stimulants', 'back_to_duty', 'eject_core']) {
        const o = g.crew.officers.find((x) => x.dept === ABILITIES[id].dept);
        if (!o) continue;
        o.learn(id);
        o.relationship = rel;
        const r = applyAbility(g, o, id);
        n++;
        if (r.reaction !== 'comply') objected++;
      }
    }
    return objected / n;
  }

  test('a bridge that trusts you argues less, and one that does not argues more', () => {
    const resentful = objections(-80);
    const neutral = objections(0);
    const loyal = objections(80);
    assert.ok(resentful > neutral + 0.15,
      `${(100 * neutral).toFixed(1)}% at nothing owed against ${(100 * resentful).toFixed(1)}% resentful`);
    assert.ok(neutral > loyal + 0.15,
      `${(100 * neutral).toFixed(1)}% against ${(100 * loyal).toFixed(1)}% loyal`);
  });

  test('and the Tellarite\'s officers object more, which is what the card says', () => {
    // "Argumentative — advantage on Diplomacy checks made by disagreeing.
    // Officers object more." `officerFriction: 0.2`, declared on the species
    // and read by nothing until now.
    const plain = objections(0, 'human');
    const tellarite = objections(0, 'tellarite');
    assert.ok(tellarite > plain + 0.1,
      `human ${(100 * plain).toFixed(1)}% against tellarite ${(100 * tellarite).toFixed(1)}%`);
  });

  test('and an objection overruled costs something', () => {
    const g = game();
    const o = g.crew.officers.find((x) => x.dept === 'medical');
    o.learn('stimulants');
    o.candor = 95;
    o.discipline = 95;
    o.relationship = 0;
    const r = applyAbility(g, o, 'stimulants');
    assert.equal(r.reaction, 'object', 'nobody objected, so nothing was overruled');
    assert.ok(o.relationship < 0, 'being overruled cost the officer nothing');
  });

  test('and a watch stood and handed back properly is worth something', () => {
    // `conHours` was accumulated by the live ticker and by the offline
    // catch-up, and read by exactly one thing: the handback report itself. An
    // officer could stand the whole commission and be no different for it.
    const g = game();
    assert.equal(g.handOverCon('first_officer').ok, true);
    const o = g.crew.at('first_officer');
    const before = { rel: o.relationship, xp: o.xp, level: o.level };
    g.conHours = 12;
    assert.equal(g.takeCon().ok, true);
    assert.ok(o.relationship > before.rel, 'twelve hours on the bridge changed nothing');
    assert.ok(o.xp > before.xp || o.level > before.level, 'and taught them nothing');
  });

  test('and a watch of five minutes is not a watch', () => {
    const g = game();
    g.handOverCon('first_officer');
    const o = g.crew.at('first_officer');
    const before = o.relationship;
    g.conHours = 0.1;
    g.takeCon();
    assert.equal(o.relationship, before);
  });
});

describe('read it or delete it', () => {
  test('the duty roster shows the species it has been generating all along', () => {
    // Every duty officer has had one generated, saved and reloaded since the
    // roster was written, and the panel printed a name, a rating and a state.
    const g = game();
    assert.ok(g.dutyRoster.length > 0);
    assert.ok(g.dutyRoster.some((p) => p.species),
      'no duty officer has a species to show');
    assert.match(readFileSync('src/ui/screens.js', 'utf8'), /person\.species/);
  });

  test('and Officer.canon is gone', () => {
    // Defaulted on the class, set true for the canonical roster, saved,
    // reloaded, and read by nothing ever. What the screens actually ask is
    // `game.crewMode === 'canon'`; a per-officer copy of that is a second
    // source of truth that can only drift away from the first.
    const g = game();
    const saved = g.crew.at('first_officer').save();
    assert.equal('canon' in saved, false);
    assert.doesNotMatch(readFileSync('src/world/crews.data.js', 'utf8'), /canon: true/);
  });
});
