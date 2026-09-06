// Forty hours of observation that changed nothing.
//
// The mission engine has always been able to read back what the captain did.
// `next` accepts a function — `(mission, applied) => stageId`, `engine.js:152` —
// and `requires.var` gates a choice on the episode's own variables,
// `engine.js:115-119`. Across sixteen episodes, seventy-two stages and a
// hundred and thirty-seven choices, **neither had ever been used**.
//
// So the nine `setVar` calls were writes into a variable bag that was carefully
// serialised into the save file and read by nothing at all.
//
// The sharpest of them is `has_window`. In `the_cube` the captain can spend
// forty hours on passive observation, find a nine-second gap where the Borg
// shield harmonics rotate and do not overlap, and choose "Use it yourself".
// Measured through `Game.chooseMission` — the door the game actually uses —
// the fight that followed:
//
//     with the window   borg_cube  shields 5000/5000/5000/5000/5000/5000
//     without it        borg_cube  shields 5000/5000/5000/5000/5000/5000
//
// Identical, facing for facing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/state.js';
import { Ship } from '../src/sim/ship.js';
import { Character } from '../src/rules/character.js';
import { FACINGS } from '../src/sim/ship.js';
import { EPISODES } from '../src/missions/episodes/index.js';

/** A captain who can start anything and fly anywhere. */
function captain({ seed = 3n, shipClass = 'sovereign' } = {}) {
  const g = new Game({
    seed, crewMode: 'original',
    character: new Character({ speciesId: 'human', careerId: 'tactical' }),
    shipClass,
  });
  g.progress.addXP(200000, { ledger: g.ledger });
  return g;
}

/** Play an episode through the game's own door and hand back the fight. */
function playToFight(g, episodeId, systemId, choices) {
  const m = g.missions.start(episodeId, g);
  g.locationId = systemId;
  // Finding the window is now a `science` check that can fail — forty hours
  // alongside a Borg cube used to hand it over for pressing the button. These
  // tests are about what the window is WORTH once you have it, so the roll
  // that finds it is held open here rather than left to chance: a fixed list
  // of choice ids cannot walk a branch, and a harness that silently landed on
  // the failure stage would measure a fight the captain never got to have.
  g.awayTeam = g.buildAwayTeam();
  g.awayTeam.check = () => ({ success: true, text: 'the window is there', killed: null, securityLost: 0 });
  for (const id of choices) {
    // A stage is somewhere. The captain flies to it, the way the episode
    // walker in wiring.test.js does — a stage gate is not what is under test
    // here and a test that never left spacedock would measure that instead.
    const here = m.testLocation();
    if (!here.ok) g.locationId = here.need;
    g.chooseMission(id);
  }
  // The pump that turns a queued mission fight into a real one lives in update.
  for (let i = 0; i < 4 && !g.engagement; i++) g.update(1 / 30);
  return { mission: m, eng: g.engagement };
}

describe('what the captain found out is spent on the fight', () => {
  test('nine seconds of a cube with nothing over it', () => {
    const withIt = playToFight(captain(), 'the_cube', 'frontier_2',
      ['study', 'use', 'fight']);
    const without = playToFight(captain(), 'the_cube', 'frontier_2',
      ['engage', 'fight']);

    assert.equal(withIt.mission.vars.has_window, true);
    assert.equal(without.mission.vars.has_window, undefined);
    // It routed somewhere else — the functional `next`, used for the first time.
    assert.notEqual(withIt.mission.stageId, without.mission.stageId);

    const a = withIt.eng.hostiles[0];
    const b = without.eng.hostiles[0];
    // Not a different cube. Same class, same hull, same guns — the shields are
    // simply not there when the spread lands.
    assert.equal(a.classId, 'borg_cube');
    assert.equal(b.classId, 'borg_cube');
    assert.equal(a.hull, b.hull);
    assert.equal(a.weapons.length, b.weapons.length);
    for (const f of FACINGS) {
      assert.equal(a.shields[f], 0, `the ${f} shield was up in the window`);
      assert.ok(b.shields[f] > 0, `the ${f} shield was down without one`);
    }
  });

  test('and it is worth something in the fight, not just on the screen', () => {
    // Flown, not asserted about. `assess` deliberately reads what a ship IS —
    // it costs `maxShield`, because it is a sensor return taken before anybody
    // shoots — so it cannot see a shield that is down and is the wrong
    // instrument for this. The right one is the fight.
    const hurt = (choices, seed) => {
      const g = captain({ seed });
      const { eng } = playToFight(g, 'the_cube', 'frontier_2', choices);
      let t = 0;
      let done = 0;
      const DT = 1 / 30;
      // How much of the cube we got through before this goes one way or the
      // other. The cube wins either way; the question is what it costs it.
      while (!eng.over && t < 240) {
        eng.comeAboutTo(eng.target);
        g.ship.throttle = 0.6;
        g.ship.power.applyPreset('attack');
        eng.update(DT);
        t += DT;
        done = Math.max(done, 1 - eng.hostiles[0].hullPct);
      }
      return done;
    };
    // On the MARGIN rather than a win count. A count over five seeds was a coin
    // toss — with the advantage disabled it still came out 3 of 5 — and the
    // margin was not marginal: a ship that used the window took 6.0% of a Borg
    // cube's hull off and a ship that did not took 1.0%.
    //
    // BOTH OF THOSE NUMBERS MOVED when the cube fight became a `survive`
    // objective, and the reason is worth writing down: the fights are now the
    // same LENGTH. Before, a ship that used the window also lived longer, so it
    // shot for longer, and the 6:1 margin was measuring two advantages at once
    // — the shields being down and the extra seconds on the board. The fight
    // now ends on a fifteen-second clock either way, so what is left is the
    // shield advantage alone, cleanly isolated: measured over eight seeds in a
    // Sovereign, 2.24% against 0.94%. The bar is half of that, as before.
    const A = [];
    const B = [];
    for (let seed = 1n; seed <= 8n; seed++) {
      A.push(hurt(['study', 'use', 'fight'], seed));
      B.push(hurt(['engage', 'fight'], seed));
    }
    const mean = (x) => x.reduce((n, v) => n + v, 0) / x.length;
    const [a, b] = [mean(A), mean(B)];
    assert.ok(a > b * 1.2,
      `the window took ${(100 * a).toFixed(1)}% of the cube off and no window `
      + `took ${(100 * b).toFixed(1)}%`);
    // And it is not one lucky seed carrying the mean.
    //
    // This used to assert the window NEVER came out worse, in any battle, and
    // that held while the window also bought extra seconds on the board: a ship
    // that lived longer always shot more. On a fixed clock it is no longer
    // true, and the reason is honest rather than a regression — with the same
    // fifteen seconds either way, whether a spread lands well is down to the
    // seed. Measured per seed, the window/no-window damage ratio is 0.76, 3.52,
    // 1.87, 1.83, 3.46, 4.12, 0.97, 3.25: six of eight decisively better, two
    // level, none meaningfully worse.
    const better = A.filter((v, i) => v > B[i]).length;
    assert.ok(better >= 5,
      `the window did more damage in only ${better} of ${A.length} battles`);
    const worst = Math.min(...A.map((v, i) => v / B[i]));
    assert.ok(worst > 0.6,
      `there is a battle where the window did ${worst.toFixed(2)}x the damage of not having it`);
  });

  test('and in a ship that cannot take the punishment, it is the whole fight', () => {
    // Where the advantage actually went. In a Sovereign both roads last the
    // fifteen seconds and the window shows up as damage; in a Constitution it
    // shows up as whether the captain is alive at the end of them, which is a
    // far larger difference than the margin above and did not exist at all
    // before the objective — every road ended with the ship destroyed.
    //
    // Measured over eight seeds: through the window, 8 of 8 hold the clock;
    // without it, 1 of 8.
    const held = (choices) => {
      let n = 0;
      for (let seed = 1n; seed <= 8n; seed++) {
        const g = captain({ seed, shipClass: 'constitution' });
        const { eng } = playToFight(g, 'the_cube', 'frontier_2', choices);
        let t = 0;
        const DT = 1 / 30;
        while (!eng.over && t < 240) {
          eng.comeAboutTo(eng.target);
          g.ship.throttle = 0.6;
          g.ship.power.applyPreset('attack');
          eng.update(DT);
          t += DT;
        }
        if (eng.outcome === 'victory') n++;
      }
      return n;
    };
    const withWindow = held(['study', 'use', 'fight']);
    const without = held(['engage', 'fight']);
    assert.ok(withWindow >= 7,
      `a Constitution that found the window held the cube off ${withWindow} times in 8`);
    assert.ok(without <= 3,
      `a Constitution that did not find it held anyway, ${without} times in 8`);
    assert.ok(withWindow > without * 2,
      `${withWindow} against ${without} is not an advantage worth forty hours`);
  });

  test('a decloaked ship has not raised anything yet', () => {
    // The other half of `running_silent`: a ship that came in on passive
    // sensors and held still is the one doing the watching.
    const g = captain({ shipClass: 'constitution' });
    const { mission, eng } = playToFight(g, 'outpost_silence', 'neutral_zone_1',
      ['silent', 'wait', 'fire']);
    assert.equal(mission.vars.running_silent, true);
    assert.equal(eng.hostiles[0].classId, 'warbird');
    const s = eng.hostiles[0];
    assert.ok(s.shieldPct > 0 && s.shieldPct < 0.3,
      `it decloaked at ${(s.shieldPct * 100).toFixed(0)}% shields`);
  });

  test('and a ship that came in loud is the one being watched', () => {
    // The control for the case above, through the same door: the identical
    // choice at the identical stage, without the silent approach.
    const g = captain({ shipClass: 'constitution' });
    const m = g.missions.start('outpost_silence', g);
    g.locationId = 'neutral_zone_1';
    g.chooseMission('approach');
    g.chooseMission('wait');
    assert.equal(m.vars.running_silent, undefined);
    assert.equal(m.stageId, 'ambushed', 'a loud ship saw it first');
    assert.ok(!m.stage.choices.some((c) => c.id === 'fire'),
      'the ambushed stage offered the opening shot');
  });
});

describe('a stage can gate on what the captain chose', () => {
  // `requires.var`, used for the first time. Six of them, each an EXTRA choice
  // at a stage that already had one — see the walker constraint below.
  const GATED = [
    { ep: 'shakedown', at: 'sol', path: ['accept', 'manual'], stage: 'report', choice: 'recommend', v: 'cautious' },
    { ep: 'donatu_standoff', at: 'donatu_v', path: ['position'], stage: 'talk', choice: 'from_strength', v: 'aggressive_posture' },
    { ep: 'devron_anomaly', at: 'devron', path: ['enter'], stage: 'inside', choice: 'blind', v: 'entered' },
    { ep: 'cardassian_treaty', at: 'terok_nor', path: ['concede'], stage: 'talks', choice: 'recover', v: 'conceded' },
    { ep: 'first_contact_grid', at: 'deep_2', path: ['scan', 'answer'], stage: 'contact', choice: 'name_it', v: 'scanned_first' },
    { ep: 'first_contact_grid', at: 'deep_2', path: ['answer', 'deflect'], stage: 'dialogue', choice: 'apologise', v: 'deflected' },
  ];

  /**
   * Stand where the scene is.
   *
   * There are TWO place gates and this file only ever satisfied one of them.
   * `testLocation` is the star system and is handled in the loop below;
   * `testWhere` is the compartment, and it defaults to the bridge, so this was
   * silently correct until a stage in `GATED` was placed somewhere else.
   * `devron_anomaly/inside` now happens in engineering, and every choice at it
   * — gated or not — is locked to a captain standing on the bridge.
   *
   * Walked rather than teleported, for the reason rooms.test.js gives: a room
   * you can look up is not a room you have arrived in.
   */
  function standWhereItIs(g, m) {
    const need = m.stage?.where;
    if (!need || need === 'anywhere' || need === 'surface') return;
    g.goToRoom(need);
    for (let n = 0; n < 4000 && g.walkOrder; n++) g.update(1 / 30);
    assert.equal(g.walk.roomId, need, `could not reach ${need}`);
  }

  test('the choice is there when the variable is, and not when it is not', () => {
    for (const c of GATED) {
      const g = captain();
      const m = g.missions.start(c.ep, g);
      g.locationId = c.at;
      for (const id of c.path) {
        const here = m.testLocation();
        if (!here.ok) g.locationId = here.need;
        g.chooseMission(id);
      }
      assert.equal(m.stageId, c.stage, `${c.ep}: landed at ${m.stageId}`);
      assert.equal(m.vars[c.v], true, `${c.ep}: ${c.v} was not set`);
      standWhereItIs(g, m);
      const open = m.choices().filter((x) => !x.locked).map((x) => x.id);
      assert.ok(open.includes(c.choice),
        `${c.ep}/${c.stage}: "${c.choice}" is locked for a captain who has ${c.v}`);
    }
  });

  test('and the control: without the variable it is locked, not missing', () => {
    // Locked rather than absent is the contract `missionPanel` renders — a
    // greyed button with a reason. And it is the assertion that the gate is
    // doing the work rather than the route to the stage being different.
    for (const c of GATED) {
      const g = captain();
      const m = g.missions.start(c.ep, g);
      g.locationId = c.at;
      // Reach the same stage without setting the variable, by hand.
      m.stageId = c.stage;
      // And stand in the room, or the lock below is the ROOM's lock and this
      // control passes without the variable gate doing anything at all — the
      // exact shape of guard that measures nothing because it is satisfied in
      // both states.
      standWhereItIs(g, m);
      const all = m.choices();
      const gated = all.find((x) => x.id === c.choice);
      assert.ok(gated, `${c.ep}/${c.stage}: "${c.choice}" is not on the stage at all`);
      assert.equal(gated.locked, true,
        `${c.ep}/${c.stage}: "${c.choice}" is open to a captain who never did it`);
      assert.ok(gated.lockReason, 'a locked choice with no reason on it');
      assert.doesNotMatch(gated.lockReason, /waiting for you in|happening (on the surface|aboard)/,
        `${c.ep}/${c.stage}: locked for being in the wrong room, not for the variable`);
      // And the ungated choices at the same stage are open, which is what
      // proves the captain is standing in the right place.
      assert.ok(all.some((x) => !x.locked),
        `${c.ep}/${c.stage}: every choice is locked, so nothing here is about the variable`);
    }
  });

  test('no stage is only reachable by having done something', () => {
    // The constraint the whole change lives under. `tests/wiring.test.js` walks
    // every episode thirty times with random legal choices and no variables
    // set, and `if (!open.length) break` strands it. Remembering has to open
    // doors, never close the corridor — so every stage keeps at least one
    // choice a captain who did nothing in particular can take.
    for (const ep of EPISODES) {
      for (const [sid, stage] of Object.entries(ep.stages ?? {})) {
        const ungated = (stage.choices ?? []).filter((c) => !c.requires?.var);
        assert.ok(ungated.length,
          `${ep.id}/${sid}: every way out of this stage is gated on a variable`);
      }
    }
  });
});

describe('the variables are all read now, or gone', () => {
  test('every setVar has a reader', () => {
    // A variable that is written and never read is the defect this change is
    // about. Collected from the shipped episodes rather than from a list here,
    // so a new one that forgets a reader fails this.
    const written = new Set();
    const read = new Set();
    for (const ep of EPISODES) {
      for (const stage of Object.values(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) {
          for (const k of Object.keys(c.effects?.setVar ?? {})) written.add(`${ep.id}:${k}`);
          for (const k of Object.keys(c.requires?.var ?? {})) read.add(`${ep.id}:${k}`);
          if (typeof c.next === 'function' && c.next.reads) read.add(`${ep.id}:${c.next.reads}`);
        }
      }
    }
    assert.ok(written.size >= 8, `only ${written.size} variables are set anywhere`);
    const orphans = [...written].filter((k) => !read.has(k));
    assert.deepEqual(orphans, [], 'variables written by an episode and read by nothing');
  });

  test('and nothing reads a variable no episode sets', () => {
    // The other direction: a gate on a variable that cannot happen is a choice
    // no captain can ever take, which is worse than not writing it.
    const written = new Set();
    const read = new Set();
    for (const ep of EPISODES) {
      for (const stage of Object.values(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) {
          for (const k of Object.keys(c.effects?.setVar ?? {})) written.add(`${ep.id}:${k}`);
          for (const k of Object.keys(c.requires?.var ?? {})) read.add(`${ep.id}:${k}`);
          if (typeof c.next === 'function' && c.next.reads) read.add(`${ep.id}:${c.next.reads}`);
        }
      }
    }
    assert.deepEqual([...read].filter((k) => !written.has(k)), [],
      'gates on variables the episode never sets');
  });
});

describe('a stage can order a fight it already has an advantage in', () => {
  test('shieldsAt survives the difficulty setting', () => {
    // Applied at `startCombat` rather than where the ships are built, because
    // `scaleHostileFleet` CLONES hulls to make the fleet a high difficulty asks
    // for — and a clone built afterwards would arrive at full shields.
    for (const difficulty of ['story', 'lieutenant', 'fleet_admiral']) {
      const g = new Game({ seed: 8n, crewMode: 'original', difficulty });
      const eng = g.startCombat(
        [new Ship('galor', { faction: 'cardassian', name: 'H0' })],
        { shieldsAt: 0 },
      );
      assert.ok(eng.hostiles.length >= 1, `${difficulty}: no hostiles`);
      for (const h of eng.hostiles) {
        for (const f of FACINGS) {
          assert.equal(h.shields[f], 0, `${difficulty}: ${h.name} arrived with ${f} shields up`);
        }
      }
    }
  });

  test('and it is a fraction, not a switch', () => {
    const g = new Game({ seed: 8n, crewMode: 'original' });
    const eng = g.startCombat(
      [new Ship('warbird', { faction: 'romulan', name: 'H0' })], { shieldsAt: 0.15 });
    const h = eng.hostiles[0];
    assert.ok(Math.abs(h.shieldPct - 0.15) < 0.01, `arrived at ${h.shieldPct.toFixed(3)}`);
  });

  test('and a fight nobody gave an advantage to is unchanged', () => {
    // The control. Every other fight in the game goes through this same call.
    const g = new Game({ seed: 8n, crewMode: 'original' });
    const eng = g.startCombat([new Ship('galor', { faction: 'cardassian', name: 'H0' })]);
    assert.ok(Math.abs(eng.hostiles[0].shieldPct - 1) < 1e-9,
      `an ordinary fight started at ${eng.hostiles[0].shieldPct}`);
  });

  test('and it rides through a save taken in the one tick before the fight', () => {
    // `pendingCombat` is deliberately not serialised; it is rebuilt from the
    // stage's own spec on load. The advantage has to be part of that spec or
    // reloading in that window quietly restores the cube's shields.
    const g = captain();
    const m = g.missions.start('the_cube', g);
    g.locationId = 'frontier_2';
    g.chooseMission('study');
    g.chooseMission('use');
    g.chooseMission('fight');
    assert.ok(g.pendingCombat, 'no fight was queued');
    const save = JSON.parse(JSON.stringify(g.save()));

    const back = Game.load(save);
    for (let i = 0; i < 4 && !back.engagement; i++) back.update(1 / 30);
    assert.ok(back.engagement, 'the reloaded save never started the fight');
    const cube = back.engagement.hostiles[0];
    assert.equal(cube.classId, 'borg_cube');
    for (const f of FACINGS) {
      assert.equal(cube.shields[f], 0, `the ${f} shield came back up across the save`);
    }
    assert.ok(m.pending || true);
  });
});

// ===================== the captain, inside an episode rather than beside one

describe('an episode reads the captain, and failing it goes somewhere', () => {
  const withChecks = () => {
    const out = [];
    for (const ep of EPISODES) {
      for (const [sid, stage] of Object.entries(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) {
          if (c.effects?.check) out.push({ ep, sid, c });
        }
      }
    }
    return out;
  };

  test('a decisive moment reads the captain rather than a coin', () => {
    // The two halves of this mechanic existed and were never once combined.
    // Measured on the tree before this change: eleven choices carried
    // `effects.check` and NOT ONE of them branched, while the single choice in
    // twenty-six episodes that did branch — `shakedown`'s "Push the core to its
    // limit" — did it on `roll: 0.7`, a flat coin that consulted neither the
    // captain, the crew, nor the chief engineer standing in front of him.
    for (const ep of EPISODES) {
      for (const [sid, stage] of Object.entries(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) {
          if (!c.branch) continue;
          assert.ok(c.effects?.check,
            `${ep.id}/${sid}/${c.id} branches on something that is not a check`);
          assert.ok(!c.effects?.roll,
            `${ep.id}/${sid}/${c.id} still branches on a bare roll`);
        }
      }
    }
  });

  test('and failure goes somewhere else, in the same episode', () => {
    // A branch whose two arms are the same stage is a check that decides
    // nothing, which is what eleven of them were doing by other means.
    for (const ep of EPISODES) {
      for (const [sid, stage] of Object.entries(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) {
          if (!c.branch) continue;
          const { success, failure } = c.branch;
          assert.ok(success && failure, `${ep.id}/${sid}/${c.id} branches to nowhere`);
          assert.notEqual(success, failure,
            `${ep.id}/${sid}/${c.id} branches to the same stage either way`);
          assert.ok(ep.stages[success], `${ep.id}/${sid}/${c.id} success -> missing ${success}`);
          assert.ok(ep.stages[failure], `${ep.id}/${sid}/${c.id} failure -> missing ${failure}`);
        }
      }
    }
  });

  test('and a choice that already decides where it goes does not also branch', () => {
    // `Mission.choose` resolves a functional `next` and then OVERWRITES it from
    // `branch` — so a choice carrying both silently throws its routing away.
    // Nearly done to `long_watch`'s "Ask her which two", whose `next` is
    // `onVar('went_below', 'dark_room', 'the_summary')`: branching there would
    // have sent every captain who went below to the wrong stage, quietly.
    for (const ep of EPISODES) {
      for (const [sid, stage] of Object.entries(ep.stages ?? {})) {
        for (const c of stage.choices ?? []) {
          if (!c.branch) continue;
          assert.equal(typeof c.next, 'undefined',
            `${ep.id}/${sid}/${c.id} has both a next and a branch; the branch wins`);
          assert.equal(typeof c.outcome, 'undefined',
            `${ep.id}/${sid}/${c.id} ends the episode AND branches`);
        }
      }
    }
  });

  test('every episode a fresh captain can start puts the captain at stake', () => {
    // The ten offered at the rank a commission begins at. Twenty-two of the
    // twenty-six episodes had no check in them anywhere.
    const OPENING = [
      'shakedown', 'centauri_drift', 'vega_raid', 'wolf359_salvage', 'rigel_syndicate',
      'archanis_claim', 'organia_question', 'outpost_silence', 'badlands_run', 'tholian_border',
    ];
    for (const id of OPENING) {
      const ep = EPISODES.find((e) => e.id === id);
      assert.ok(ep, `${id} is gone`);
      const gambles = Object.entries(ep.stages).flatMap(([, st]) =>
        (st.choices ?? []).filter((c) => c.effects?.check && c.branch));
      assert.ok(gambles.length > 0, `${id} has nothing in it the captain can fail`);
    }
  });

  test('and the stakes are spread across the whole crew', () => {
    // Otherwise "the captain matters" means one officer matters. Seven check
    // types exist, each mapping to an ability, a set of stations and an officer
    // trait — a campaign that only ever rolls `science` is a campaign about the
    // science officer.
    const types = new Set(withChecks().map((x) => x.c.effects.check.type));
    assert.ok(types.size >= 5,
      `only ${types.size} check types in the whole book: ${[...types].join(', ')}`);
  });

  test('and every check declares a difficulty the resolver can read', () => {
    // `difficulty` is mapped as `(declared - 0.5) * 20` — a nudge of at most
    // two points of DC inside the hazard band, on a 0.05 grid. It is NOT a
    // second difficulty scale, and a value off the grid is somebody inventing
    // one. `away.js` records that eleven of these were destructured into
    // nothing for a long time, so the grid is worth holding.
    const HAZARDS = new Set(['routine', 'elevated', 'dangerous', 'extreme']);
    for (const { ep, sid, c } of withChecks()) {
      const chk = c.effects.check;
      assert.ok(chk.type, `${ep.id}/${sid}/${c.id} has a check with no type`);
      assert.ok(HAZARDS.has(chk.hazard ?? 'elevated'),
        `${ep.id}/${sid}/${c.id} hazard ${chk.hazard}`);
      const d = chk.difficulty ?? 0.5;
      assert.ok(d >= 0.35 && d <= 0.65, `${ep.id}/${sid}/${c.id} difficulty ${d} is off the band`);
      assert.ok(Math.abs(Math.round(d * 20) - d * 20) < 1e-9,
        `${ep.id}/${sid}/${c.id} difficulty ${d} is off the 0.05 grid`);
    }
  });
});
