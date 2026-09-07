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
import { readFileSync, readdirSync } from 'node:fs';

import { Game } from '../src/core/state.js';
import { on } from '../src/core/events.js';
import { Character } from '../src/rules/character.js';
import { Ship } from '../src/sim/ship.js';
import { Officer, ABILITIES, REGARD_BANDS } from '../src/sim/officers.js';
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

// -------------------------------------------- and the captain can see any of it
//
// §44 gave `relationship` its meaning and measured what it buys — 79.2% of
// ethically-weighted orders objected to at -80, 19.2% at +80. It never showed
// the captain the number. The crew screen printed Expertise, Discipline, Daring
// and Candour, which includes the two that regard moves, and not regard.
//
// Swept over the whole order space — risk and ethical weight each 0..1 in tenths
// across four temperaments, 484 shapes — the difference between a crew that
// despises you and one that would follow you anywhere changes the answer in
// **71%** of them. That is not a stat worth hiding.

describe('what the crew think of you is visible', () => {
  test('regard bands cover the whole range and are ordered', () => {
    assert.ok(REGARD_BANDS.length >= 4, `only ${REGARD_BANDS.length} bands`);
    for (let i = 1; i < REGARD_BANDS.length; i++) {
      assert.ok(REGARD_BANDS[i].min < REGARD_BANDS[i - 1].min,
        `bands are not in descending order at ${REGARD_BANDS[i].id}`);
    }
    // Every reachable value lands in exactly one band, including the ends.
    const o = Object.create(Officer.prototype);
    for (let rel = -100; rel <= 100; rel += 1) {
      o.relationship = rel;
      const band = o.regardBand;
      assert.ok(band && band.label, `regard ${rel} falls outside every band`);
      assert.ok(rel >= band.min, `regard ${rel} matched ${band.id}, whose floor is ${band.min}`);
    }
    // A fresh officer reads as the middle of the road, not as a friend.
    o.relationship = 0;
    assert.equal(o.regardBand.id, 'correct',
      'a crew that has served no time under you is not yet warm to you');
  });

  test('and the band actually moves over a commission', () => {
    // A band nobody can reach is a label, not a reading. This is the same
    // objection §44 raised against its own first draft: measure the thing
    // moving, not the code that would move it.
    const g = new Game({
      seed: 21n, crewMode: 'original', difficulty: 'captain', shipClass: 'constitution',
      character: new Character({ speciesId: 'human', careerId: 'command' }),
    });
    const bridge = g.crew.officers[0];
    assert.equal(bridge.regardBand.id, 'correct');

    // Sixteen, because the curve is measured and not guessed: a cleanly fought
    // fight is worth about two points to the bridge, so the crossing from
    // `correct` into `warm` at 25 lands around the thirteenth. Ten fights left
    // it at 20 and this test failed — which was the test being wrong about the
    // rate, not the bands being wrong about the crew. Thirty fights reach 60,
    // measured as the mean of eight seeds rather than read off one.
    const seen = new Set([bridge.regardBand.id]);
    for (let f = 0; f < 16 && !g.over; f++) {
      g.startCombat([new Ship('bird_of_prey', { faction: 'klingon', name: `K${f}` })]);
      for (let i = 0; i < 40000 && g.engagement && !g.engagement.over; i++) {
        if (i % 15 === 0 && g.engagement.target) {
          g.engagement.comeAboutTo(g.engagement.target);
          g.ship.throttle = 0.6;
          g.ship.power.applyPreset(g.ship.shieldPct < 0.35 ? 'defense' : 'attack');
        }
        g.update(1 / 30);
      }
      seen.add(bridge.regardBand.id);
      g.passTime?.(24 * 14);
    }
    assert.ok(seen.size > 1,
      `ten fights fought well and the bridge never left "${bridge.regardBand.id}" — `
      + `regard ended at ${bridge.relationship}`);
  });

  test('and the screen shows it beside the two scores it moves', () => {
    // The specific defect: Discipline and Candour were printed as though they
    // were the operative numbers, while `reactTo` weighed them shifted by up to
    // twenty points in a direction the captain could not see.
    const src = readFileSync(new URL('../src/ui/screens.js', import.meta.url), 'utf8');
    const card = src.slice(src.indexOf('export function officerDetail'));
    const body = card.slice(0, card.indexOf('\n}'));
    assert.match(body, /readout\('Regard'/,
      'the officer card no longer shows what that officer thinks of the captain');
    for (const shown of ['Discipline', 'Candour']) {
      assert.ok(body.includes(`readout('${shown}'`),
        `${shown} is gone from the card, so regard has nothing to sit beside`);
    }
    assert.match(body, /regardBand/,
      'regard is shown as a bare number rather than as what the officer would call it');
  });

  test('and a change of band reaches the log, but a change of a point does not', () => {
    // `officer:regard` fires on almost everything that happens — a watch stood,
    // a fight won, casualties, a landing. It had no listener at all. Wiring one
    // per CHANGE would be a log made of nothing else, so this is the
    // standing-tier rule: say it when it crosses a band.
    //
    // Measured on what the officer emits, not scraped from the source. The
    // first version of this asserted that the handler MENTIONED the band latch,
    // and a control that deleted the early return — making it log every single
    // point — passed it anyway, because the latch was still written a line
    // further down. A check satisfied by the shape of the source rather than by
    // what it does is the defect this repo keeps rediscovering, and it had just
    // been committed into a test about it.
    //
    // The rule lives on the officer for that reason. Written in `main.js` it
    // sat behind a DOM-bound class no test can construct, and the only check
    // available there was reading the file as text — which is how the first
    // version came to be wrong.
    const g = new Game({
      seed: 4n, crewMode: 'original', shipClass: 'constitution',
      character: new Character({ speciesId: 'human', careerId: 'command' }),
    });
    const o = g.crew.officers[0];
    const announced = [];
    const stop = on('officer:regard', (e) => { if (e.officer === o && e.crossed) announced.push(e.band.id); });
    try {
      // Twenty single points, all inside one band. Nothing to announce.
      o.relationship = 0;
      for (let i = 0; i < 20; i++) o.regard(1, 'a watch stood');
      assert.equal(o.regardBand.id, 'correct', 'the fixture walked out of the band it meant to stay inside');
      assert.deepEqual(announced, [],
        `twenty points inside one band announced themselves ${announced.length} times`);

      // And the point that crosses one is worth saying — including the first
      // crossing an officer ever makes, which an earlier draft swallowed
      // because it latched the band on the way past instead of comparing it.
      o.relationship = 24;
      o.regard(2, 'a fight won');
      assert.equal(o.regardBand.id, 'warm', 'the fixture no longer crosses a band');
      assert.deepEqual(announced, ['warm'],
        'the bridge changed how it feels about you and nobody said so');
    } finally { stop(); }
  });

  test('and something is actually listening for it', () => {
    // The defect this whole block exists to fix was not a wrong rule — it was
    // a right one nobody had subscribed to. `officer:regard` was emitted with a
    // reason on every change since §44 and had zero listeners in `src/`, so the
    // rule above could be perfect and still reach no one.
    //
    // Read as text, because `main.js` is DOM-bound and cannot be imported. That
    // is sound HERE and was not sound for the rule above, and the difference is
    // worth naming: text can establish that a subscription EXISTS, because
    // deleting the subscription deletes the token. It cannot establish that the
    // logic inside is right, because a control that breaks the logic leaves
    // every token standing — which is exactly how the first draft of the test
    // above passed a control that made it log every single point.
    const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const at = main.indexOf("on('officer:regard'");
    assert.ok(at > 0, 'officer:regard is emitted on every change and nothing subscribes to it again');
    assert.ok(main.slice(at, at + 400).includes('pushLog'),
      'the officer:regard listener no longer puts anything in front of the captain');

    // And the sweep that would have caught it in the first place: 56 of the 82
    // events emitted in `src/` have no listener there. Most are hooks rather
    // than defects and each needs its own measurement (§91), so this asserts
    // only that the count is not GROWING — a new emit with no reader is a new
    // hypothesis, and it should have to be an explicit one.
    //
    // The file list is read off disk rather than typed here, because a
    // hand-kept list of emitters silently stops counting the moment someone
    // adds a fourteenth. Counting my own first pass with a typed list is how I
    // got 55: it scored a COMMENT in `state.js` that quotes `on('combat:end')`
    // as a listener, and the real figure was 56 all along.
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(new URL(`${d.name}/`, dir)) : (d.name.endsWith('.js') ? [new URL(d.name, dir)] : []));
    const emitted = new Set(), heard = new Set();
    for (const url of walk(new URL('../src/', import.meta.url))) {
      const src = readFileSync(url, 'utf8');
      for (const m of src.matchAll(/\bemit\(\s*'([^']+)'/g)) emitted.add(m[1]);
      for (const m of src.matchAll(/^[^/*\n]*\b(?:on|once)\(\s*'([^']+)'/gm)) heard.add(m[1]);
    }
    const unheard = [...emitted].filter((e) => !heard.has(e));
    assert.ok(unheard.length <= 56,
      `${unheard.length} emitted events have no listener, up from the 56 measured here: `
      + `${unheard.slice(0, 8).join(', ')}`);
  });
});
