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

  test('the four that face an unknown roll for it', () => {
    // #217 gave twelve episodes a decisive check. Fourteen still had none, and
    // reading them, ten are deliberately checkless — see the guard below. These
    // four are not: each had a gated, dramatic, UNCONDITIONAL success, which is
    // the same shape #217 was about. The warp-theory gate decided whether the
    // pulse button was there; nothing decided whether the core held it.
    const FACING_AN_UNKNOWN = [
      'devron_anomaly', 'first_contact_grid', 'beta_reticuli', 'donatu_standoff',
    ];
    for (const id of FACING_AN_UNKNOWN) {
      const ep = EPISODES.find((e) => e.id === id);
      assert.ok(ep, `${id} is gone`);
      const gambles = Object.values(ep.stages).flatMap((st) =>
        (st.choices ?? []).filter((c) => c.effects?.check && c.branch));
      assert.ok(gambles.length > 0, `${id} has nothing in it the captain can fail`);
    }
  });

  test('and the ones that are meant to be talked through stay that way', () => {
    // Recorded rather than remembered. These ten are boards of inquiry,
    // councils, treaties, testimony and consequence — their drama is what the
    // captain SAYS and what they did earlier, and a die roll in a court-martial
    // would be wrong for the same reason a die roll at Marchetti's doorway was
    // wrong. A later sweep looking for episodes "still missing" a check would
    // put dice in all ten; this is here so it cannot.
    const TALKED_THROUGH = [
      'court_martial', 'cardassian_treaty', 'homecoming', 'qonos_council',
      'romulus_debt', 'cardassia_debt', 'khitomer_accord', 'utopia_certification',
      'vulcan_long_peace', 'vega_line',
    ];
    for (const id of TALKED_THROUGH) {
      const ep = EPISODES.find((e) => e.id === id);
      assert.ok(ep, `${id} is gone`);
      const rolls = Object.values(ep.stages).flatMap((st) =>
        (st.choices ?? []).filter((c) => c.effects?.check));
      assert.equal(rolls.length, 0,
        `${id} is a scene about what is said, and something put a die roll in it`);
    }
    // And the two lists together are every episode without a check, so neither
    // can drift out of date silently.
    const checkless = EPISODES.filter((e) => !Object.values(e.stages ?? {}).some((st) =>
      (st.choices ?? []).some((c) => c.effects?.check))).map((e) => e.id).sort();
    assert.deepEqual(checkless, [...TALKED_THROUGH].sort(),
      'the set of episodes with no skill check has changed');
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

// The same argument one level up: what the captain did in an EARLIER EPISODE.
//
// `requires.flag` has always worked and 36 choices in the book use it. But
// `the_cube` — act 4, fifteen choices, a Borg cube on course for Earth — read
// nothing a captain had done in the four acts behind it, which is what
// RESEARCH §107 found once the discredited "wide but shallow" claim was
// measured properly. Thirty flags were being written down and read by nothing.
//
// Two of the thirty are unmistakably Borg and both are act 2:
//
//   ran_silent    Outpost 4. "Not damaged. Excavated." You went in on passive
//                 sensors only, and it did not notice you.
//   wolf_scanned  Wolf 359. Thirty-nine hulls and a signal from inside a
//                 section of saucer that should have been cold — and you
//                 scanned it thoroughly from range instead of boarding it.
//
// Which is why they went first.
describe('the cube at Gamma Hydra reads what you did two acts ago', () => {
  const cube = EPISODES.find((e) => e.id === 'the_cube');

  /** The choices on offer at a stage, for a captain who has done `flags`. */
  function offered(flags, stageId = null) {
    const g = captain();
    g.locationId = 'frontier_2';
    for (const f of flags) g.ledger.setFlag(f);
    const m = g.missions.start('the_cube', g);
    if (stageId) m.stageId = stageId;
    return m.choices();
  }
  const find = (list, id) => list.find((c) => c.id === id);

  test('a captain who crept up on Outpost 4 may creep up on this', () => {
    const without = find(offered([]), 'study_silent');
    assert.ok(without, 'the episode no longer offers the silent approach at all');
    assert.equal(without.locked, true, 'the silent approach was offered to a captain who never ran silent');

    const withIt = find(offered(['ran_silent']), 'study_silent');
    assert.equal(withIt.locked, false, 'the captain ran silent at Outpost 4 and the cube did not care');
  });

  test('and it is a better road, which is the entire point of having earned it', () => {
    // The payoff is the roll. Asserted on the episode data rather than on a
    // sampled success rate because the difficulty IS the content here — this is
    // the artifact under test, not a source-read standing in for behaviour —
    // and because `difficulty` is on a documented 0.05 grid the test above
    // already holds every check in the book to.
    const stage = cube.stages.start.choices;
    const plain = stage.find((c) => c.id === 'study').effects.check;
    const silent = stage.find((c) => c.id === 'study_silent').effects.check;
    assert.equal(silent.type, plain.type, 'the two approaches roll different skills');
    assert.equal(silent.hazard, plain.hazard, 'creeping up on a Borg cube got safer');
    assert.ok(silent.difficulty < plain.difficulty,
      `the earned approach is difficulty ${silent.difficulty} against the plain ${plain.difficulty}`);
  });

  test('a captain who scanned Wolf 359 gets a second look when the first fails', () => {
    // `no_window` is where forty hours of observation come to nothing. It had
    // two ways out: send what you have, or go in blind.
    const without = find(offered([], 'no_window'), 'compare');
    assert.ok(without, 'the comparison is no longer offered');
    assert.equal(without.locked, true, 'a captain who never scanned Wolf 359 was offered the comparison');

    const withIt = find(offered(['wolf_scanned'], 'no_window'), 'compare');
    assert.equal(withIt.locked, false, 'the Wolf 359 scan bought nothing');
  });

  test('and the second look reaches the fight the window buys', () => {
    // The thing that has to be true for any of it to matter: the road that
    // opens leads to the cube with its shields down. `engage_window` is the
    // stage `has_window` selects, and the fight it stages sets `shieldsAt: 0` —
    // which is what the top of this file measured as the whole worth of the
    // forty hours.
    const g = captain();
    g.locationId = 'frontier_2';
    g.ledger.setFlag('wolf_scanned');
    const m = g.missions.start('the_cube', g);
    m.stageId = 'no_window';
    g.chooseMission('compare');
    assert.equal(m.stageId, 'engage_window',
      `the comparison led to ${m.stageId} rather than to the window`);
    assert.equal(m.vars.has_window, true, 'it reached the window stage without the window set');

    const fight = cube.stages.engage_window.choices.find((c) => c.id === 'fight');
    assert.equal(fight.effects.combat.shieldsAt, 0,
      'the window stage no longer drops the cube shields, so none of this is worth anything');
  });

  test('a locked choice does not promise a road that closed two acts ago', () => {
    // "Not yet available" is a promise, and 29 of the book's 36 flag gates
    // cannot keep it: they ask for a deed done in an earlier episode. Only 7
    // gate on a flag the episode a captain is standing in could still set.
    const closed = find(offered([]), 'study_silent');
    assert.match(closed.lockReason, /record/i,
      `a road that closed at Outpost 4 says "${closed.lockReason}"`);

    // And the seven that ARE still reachable must still say so, or the fix has
    // simply moved the lie.
    let checked = 0;
    for (const ep of EPISODES) {
      const writes = new Set();
      for (const s of Object.values(ep.stages ?? {})) {
        for (const c of s.choices ?? []) for (const f of [].concat(c.effects?.flag ?? [])) writes.add(f);
      }
      const g = captain();
      g.locationId = ep.system;
      const m = g.missions.start(ep.id, g);
      for (const [sid, s] of Object.entries(ep.stages ?? {})) {
        for (const c of s.choices ?? []) {
          if (!c.requires?.flag || !writes.has(c.requires.flag)) continue;
          m.stageId = sid;
          const got = find(m.choices(), c.id);
          if (!got?.locked || !/available/i.test(got.lockReason ?? '')) continue;
          checked++;
          assert.match(got.lockReason, /not yet/i,
            `${ep.id}/${sid}/${c.id} gates on ${c.requires.flag}, which this episode can still set`);
        }
      }
    }
    assert.ok(checked > 0, 'no within-episode flag gate was reached, so this asserted nothing');
  });
});

// §113. The Tholian border, read past the relay network.
//
// `tholian_border` ends, when the Merrimack comes home, with this: "A formal
// acknowledgement of error is now the standing Starfleet procedure for the
// Tholian border. It is named after this ship."
//
// So the captain carrying `tholian_protocol` did not merely survive an alien
// power whose reasoning nobody shares — he wrote down how, and the document has
// his ship's name on it. `first_contact_grid` is six weeks past the last relay
// with something that has been listening for two hundred and six years and has
// just asked whether a thing that was built can consent.
describe('the procedure named after this ship is one he can actually run', () => {
  const ep = EPISODES.find((e) => e.id === 'first_contact_grid');
  const stage = ep.stages.contact;

  const open = (flags) => {
    const g = captain();
    for (const f of flags) g.ledger.setFlag(f);
    return stage.choices
      .filter((c) => !c.requires?.flag || g.ledger.has(c.requires.flag))
      .map((c) => c.id);
  };

  test('and only he can run it', () => {
    const gated = stage.choices.find((c) => c.id === 'protocol');
    assert.ok(gated, 'the acknowledgement of error is gone');
    assert.deepEqual(gated.requires, { flag: 'tholian_protocol' });
    assert.equal(open([]).includes('protocol'), false,
      'offered to a captain who never brought the Merrimack home');
    assert.ok(open(['tholian_protocol']).includes('protocol'), 'the Tholian border bought nothing');
  });

  test('it is a better roll than improvising one, which is the whole of the payoff', () => {
    // The scene already has "Deflect. Establish protocol first" — a captain
    // inventing one on the spot to buy time. This is the earned version, and it
    // has to be measurably better or it is the same choice with a nicer label.
    const earned = stage.choices.find((c) => c.id === 'protocol').effects.check;
    const honest = stage.choices.find((c) => c.id === 'engage').effects.check;
    assert.equal(earned.type, honest.type, 'the two answers roll different skills');
    assert.equal(earned.hazard, honest.hazard);
    assert.ok(earned.difficulty < honest.difficulty,
      `the earned answer is difficulty ${earned.difficulty} against ${honest.difficulty}`);
    // And it lands in the same two places, so it is a road through the scene
    // rather than a shortcut around it.
    assert.deepEqual(
      stage.choices.find((c) => c.id === 'protocol').branch,
      stage.choices.find((c) => c.id === 'engage').branch);
  });

  test('and the flag it reads is one an earlier act really pays', () => {
    // Act 3 against this episode's act 4 — the ordering guard in wiring.test.js
    // holds the general rule; this pins the specific pair the scene rests on.
    const src = EPISODES.filter((e) => Object.values(e.stages ?? {}).some((s) =>
      (s.choices ?? []).some((c) => [].concat(c.effects?.flag ?? []).includes('tholian_protocol'))));
    assert.equal(src.length, 1, 'tholian_protocol is written in more than one place');
    assert.ok(src[0].act < ep.act,
      `${src[0].id} is act ${src[0].act} and ${ep.id} is act ${ep.act}`);
  });
});

// §115. Vega, read on Rigel.
//
// At Vega the Orion captain "offers to leave for a price, and to keep whatever
// his people already have aboard", and a captain can pay. They leave — "with
// four hundred colonists aboard as cargo".
//
// Six weeks into Doctor Marru's detention on Rigel VII, a Syndicate broker is
// running the same business, and this captain is on the list of people it works
// on.
describe('the captain who paid the Orions once is known to pay', () => {
  const ep = EPISODES.find((e) => e.id === 'rigel_syndicate');
  const stage = ep.stages.legal;

  const open = (flags) => {
    const g = captain();
    for (const f of flags) g.ledger.setFlag(f);
    return stage.choices
      .filter((c) => !c.requires?.flag || g.ledger.has(c.requires.flag))
      .map((c) => c.id);
  };

  test('buying her back is offered only to him', () => {
    const gated = stage.choices.find((c) => c.id === 'buy');
    assert.ok(gated, 'the bought road is gone');
    assert.deepEqual(gated.requires, { flag: 'paid_orions' });
    assert.equal(open([]).includes('buy'), false, 'offered to a captain who never paid anybody');
    assert.ok(open(['paid_orions']).includes('buy'), 'Vega bought nothing');
  });

  test('and it is the one road in the episode that cannot fail', () => {
    // That is the whole shape of it. Every other way to Doctor Marru is a roll
    // or a firefight; this one is a price. The deed it reads was a captain
    // buying his way out of a fight, and the consequence is that buying things
    // works for him now.
    const buy = stage.choices.find((c) => c.id === 'buy');
    assert.ok(buy.outcome, 'the bought road no longer resolves the episode');
    assert.equal(buy.effects.check, undefined, 'the bought road rolls for something');
    assert.equal(buy.effects.combat, undefined, 'the bought road ends in a fight');

    const rolls = [];
    for (const [sid, s] of Object.entries(ep.stages)) {
      for (const c of s.choices ?? []) {
        if (c.effects?.check || c.effects?.combat) rolls.push(`${sid}/${c.id}`);
      }
    }
    assert.ok(rolls.length >= 3, `only ${rolls.length} roads in this episode risk anything`);
  });

  test('and it costs him, in the place that would notice', () => {
    // `independent` is "Unaligned Worlds" — the people who watch which Starfleet
    // captains the Syndicate can do business with. It has to be the worst
    // standing hit in the episode, or the road is simply the best one.
    const buy = stage.choices.find((c) => c.id === 'buy');
    assert.ok(buy.effects.standing.independent < 0);
    assert.ok(buy.effects.standing.federation < 0, 'Starfleet does not mind at all');

    const others = [];
    for (const s of Object.values(ep.stages)) {
      for (const c of s.choices ?? []) {
        const v = c.effects?.standing?.independent;
        if (typeof v === 'number' && c.id !== 'buy') others.push(v);
      }
    }
    assert.ok(others.length, 'nothing else in the episode moves that track');
    assert.ok(buy.effects.standing.independent < Math.min(...others),
      `buying her back costs ${buy.effects.standing.independent} against a worst of ${Math.min(...others)}`);
  });

  test('and it has an ending of its own, not the clean one', () => {
    // `negotiated` is leverage found in a public Ferengi filing and a consul who
    // takes the credit. Dressing the bought road in that text would be the same
    // four words for two different things.
    const buy = stage.choices.find((c) => c.id === 'buy');
    assert.notEqual(buy.outcome, 'negotiated');
    assert.ok(ep.endings[buy.outcome], `no ending is written for "${buy.outcome}"`);
    assert.notEqual(ep.endings[buy.outcome].text, ep.endings.negotiated.text);
  });
});

// ----------------------------------------------------------- two deeds about waiting
//
// Kept in one block because they are one idea. Both flags are written by a
// captain who chose to defer — signal Command and hold station at Alpha
// Centauri, return to the ship and hold orbit at Organia — and both are read by
// a later scene where waiting is exactly what is on offer and exactly the wrong
// move. §120.
describe('the captain who waited, twice, and what it is worth later', () => {
  const ep = (id) => EPISODES.find((e) => e.id === id);

  /** The choices at a stage a captain holding `flags` is actually offered. */
  const openAt = (episodeId, stageId, flags) => {
    const g = captain();
    for (const f of flags) g.ledger.setFlag(f);
    return (ep(episodeId).stages[stageId].choices ?? [])
      .filter((c) => !c.requires?.flag || g.ledger.has(c.requires.flag))
      .map((c) => c.id);
  };

  test('the Centauri log is a defence only the captain who filed it can offer', () => {
    const gated = ep('court_martial').stages.defence.choices.find((c) => c.id === 'centauri');
    assert.ok(gated, 'the road that enters the Centauri log is gone');
    assert.deepEqual(gated.requires, { flag: 'centauri_reported' });
    assert.equal(openAt('court_martial', 'defence', []).includes('centauri'), false,
      'offered to a captain who never signalled anybody');
    assert.ok(openAt('court_martial', 'defence', ['centauri_reported']).includes('centauri'),
      'four hours and eleven minutes on station bought nothing');
  });

  test('and it buys the board more than letting the exec speak, and the captain less', () => {
    // The trade that makes it honest rather than free. He answers a question
    // about his own judgement with a document, over the head of the officer
    // sitting there under oath — so the finding goes better and he learns less.
    const at = (id) => ep('court_martial').stages.defence.choices.find((c) => c.id === id);
    const speak = at('let_speak');
    const doc = at('centauri');
    const fed = (c) => c.effects?.standing?.federation ?? 0;
    assert.ok(fed(doc) > fed(speak),
      `the board thinks no better of the document (${fed(doc)}) than of the honest answer (${fed(speak)})`);
    assert.ok(doc.effects.xp < speak.effects.xp,
      `the document teaches him as much (${doc.effects.xp}) as hearing his exec out (${speak.effects.xp})`);
  });

  test('and the flag it reads is the signal, not the eleven people', () => {
    // The line says he deferred. It must not imply he watched them die, and
    // whether it does is a fact about the graph rather than about the name:
    // both stages that write `centauri_reported` lead to `orders`, and `orders`
    // still has a road onward to the rescue. If that ever stops being true the
    // comment on the choice is a lie and this should say so.
    const drift = ep('centauri_drift');
    const writes = Object.entries(drift.stages).flatMap(([sid, s]) =>
      (s.choices ?? []).filter((c) =>
        [].concat(c.effects?.flag ?? []).includes('centauri_reported')).map((c) => ({ sid, c })));
    assert.ok(writes.length >= 2, 'centauri_reported is written in fewer places than it was');
    for (const w of writes) {
      assert.equal(w.c.next, 'orders', `${w.sid}/${w.c.id} no longer goes to the orders stage`);
    }
    // And from there the rescue is still reachable, so holding the flag does
    // not settle what happened to them.
    const onward = drift.stages.orders.choices.find((c) => typeof c.next === 'function');
    assert.ok(onward, 'the orders stage no longer branches onward');
    assert.ok((onward.next.targets ?? []).length >= 2,
      'the road out of the orders stage no longer forks');
  });

  test('the vessel that stopped asking can be asked, by the captain Organia dismissed', () => {
    const gated = ep('first_contact_grid').stages.misread.choices.find((c) => c.id === 'ask_back');
    assert.ok(gated, 'the road that asks it back is gone');
    assert.deepEqual(gated.requires, { flag: 'organia_rebuffed' });
    assert.equal(openAt('first_contact_grid', 'misread', []).includes('ask_back'), false,
      'offered to a captain nobody has ever walked out of a room');
    assert.ok(openAt('first_contact_grid', 'misread', ['organia_rebuffed']).includes('ask_back'),
      'being dismissed by the Organians bought nothing');
  });

  test('and it does not recover the contact — it reaches an ending of its own', () => {
    const grid = ep('first_contact_grid');
    const gated = grid.stages.misread.choices.find((c) => c.id === 'ask_back');
    assert.ok(gated.outcome, 'the road that asks back does not end the episode');
    assert.notEqual(gated.outcome, 'deferred',
      'the asked road wears the ending where the Council debates for eleven months');
    assert.notEqual(gated.outcome, 'contact',
      'asking what happened to the other three now gets a delegation, which it must not');
    assert.ok(grid.endings[gated.outcome], `${gated.outcome} has no ending written for it`);
  });

  test('and the one dead end in the episode is no longer one', () => {
    // `misread` had a single choice and a single destination: refer it upward
    // and hold station. It was the only stage in the episode shaped that way,
    // which is what made it worth the deed rather than the deed worth a stage.
    const grid = ep('first_contact_grid');
    const forced = Object.entries(grid.stages)
      .filter(([, s]) => (s.choices ?? []).length === 1 && (s.choices[0].outcome))
      .map(([id]) => id);
    assert.deepEqual(forced, [],
      `${forced.join(', ')} still ends the episode without offering a choice`);
    assert.ok((grid.stages.misread.choices ?? []).length >= 2,
      'the misread stage is back to a single road');
  });
});
