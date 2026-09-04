// A commission, played.
//
// Four long harnesses already watch this game, and between them they leave one
// hole:
//
//   the soak (invariants.test.js)      68 engagements, every class, every rung.
//                                      Combat only.
//   the tour of duty (invariants)      five commissions, eight fights each, with
//                                      real business between them. No encounters,
//                                      no episodes, no away missions, no surface.
//   the API fuzzer (invariants)        the whole call surface in random order.
//                                      Not a played arc.
//   the episode walker (wiring)        every episode to an ending — with the
//                                      combat stages STUBBED and the ship
//                                      teleported to each stage.
//
// So nothing drives
//
//   setCourse -> arrive -> encounterChoices -> resolveEncounter -> startCombat
//     -> finishCombat -> availableMissions -> startMission -> chooseMission
//     -> awayMission
//
// as one continuous seeded session with the checker running. The seams between
// those four — an arrival encounter feeding a fight, feeding an episode, feeding
// a landing party — are where nothing was watching, and playing them by hand
// turned up five defects in an afternoon (#113 through #116). This is that walk,
// kept.
//
// THREE RULES THIS FILE LIVES BY.
//
// `playCommission` returns a journal and asserts NOTHING. A driver that can
// quietly repair a state to keep going is a driver that hides the bug it exists
// to find, so every refusal is recorded rather than swallowed, and the
// assertions are made afterwards by tests that can print what happened.
//
// The captain and the world draw from different places. `game.rng` is the
// galaxy and this file never touches it; a local xorshift seeded per commission
// is the captain. Change the policy and the same seeds still roll the same
// encounters, which is the only reason a failure can be replayed after the
// policy is edited.
//
// The driver may only call what a player could order. No teleporting to a
// mission stage, no clearing a stray encounter, no topping up experience. The
// one place the episode walker breaks that rule — `g.locationId = need` — is
// exactly where #114's defect was hiding.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Game, MODES } from '../src/core/state.js';
import { checkAll, Watchdog, LEGAL_MODES } from '../src/sim/invariants.js';
import { ARENA_RADIUS, OUTCOMES } from '../src/sim/combat.js';
import { AWAY_TEMPLATES } from '../src/sim/away.js';
import { ENCOUNTER_KINDS } from '../src/world/encounters.js';
import { SUBSYSTEM_KEYS } from '../src/sim/ship.js';
import { SKILL_LIST } from '../src/sim/skills.js';

const STEP = 1 / 30;
const OPTS = { arenaRadius: ARENA_RADIUS };

/**
 * The commissions this file flies.
 *
 * One row per commission, and the only thing anyone edits to add coverage. The
 * ladder starts at lieutenant rather than at the top on purpose: a captain with
 * no repair discipline on a hard rung dies in the fourth fight, and a file about
 * what happens between engagements cannot be a study of losing.
 */
const COMMISSIONS = [
  { seed: 77001, difficulty: 'lieutenant', crewMode: 'canon', shipClass: 'constitution', legs: 26 },
  { seed: 77002, difficulty: 'commander', crewMode: 'original', shipClass: 'constitution_refit', legs: 26 },
  { seed: 77003, difficulty: 'captain', crewMode: 'original', shipClass: 'excelsior', legs: 26 },
];

/** The captain's own random source. Never `game.rng`. */
function captainsLuck(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

/**
 * What a scripted captain does about whatever is on the viewer.
 *
 * By choice ID, read from what the encounter actually offers — never by index.
 * A content change that renames a choice must fail loudly here rather than
 * quietly pick a different one, which is the mistake #109 and #111 both made in
 * their first form.
 */
const ENCOUNTER_POLICY = {
  ambush: ['engage', 'withdraw'],
  patrol: ['hail', 'withdraw'],
  distress: ['assist', 'engage', 'withdraw'],
  derelict: ['board', 'scan', 'withdraw'],
  anomaly: ['approach', 'scan', 'withdraw'],
  convoy: ['escort', 'withdraw'],
  first_contact: ['contact_peaceful', 'contact_prewarp', 'withdraw'],
  trapped: ['trap_device', 'trap_power', 'trap_wait'],
};

/**
 * Fly one commission and write down everything that happened.
 *
 * @returns {object} the journal — counts, sets, and a line per decision
 */
function playCommission(spec) {
  const { seed, difficulty, crewMode, shipClass, legs } = spec;
  const g = new Game({ seed: BigInt(seed), difficulty, crewMode, shipClass });
  const rand = captainsLuck(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const dog = new Watchdog();

  const j = {
    seed,
    legs: 0,
    ticks: 0,
    fights: 0,
    actions: [],
    refusals: [],
    systems: new Set(),
    encounterKinds: new Set(),
    encounterChoices: new Set(),
    awayTemplates: new Set(),
    outcomes: new Set(),
    modes: new Set(),
    episodesStarted: new Set(),
    episodesFinished: new Set(),
    episodeStages: new Set(),
    missionFights: 0,
    leftEncounterBehind: 0,
    hullRecoveries: 0,
    minHullPct: 1,
    resources: {},
    endedEarly: false,
    over: null,
    dog,
  };

  const say = (line) => { j.actions.push(`${j.legs}:${line}`); };
  const refused = (what, why) => { j.refusals.push(`${j.legs}:${what}: ${why}`); };

  /** One tick, watched. Everything the driver does goes through here. */
  const pump = (n = 1) => {
    for (let i = 0; i < n && !g.over; i++) {
      g.update(STEP);
      dog.tick(g, OPTS);
      j.ticks++;
      j.modes.add(g.mode);
      const pct = g.ship.hullPct;
      if (pct < j.minHullPct) j.minHullPct = pct;
      for (const k of ['antimatter', 'torpedoes']) {
        const v = g.ship[k];
        const r = (j.resources[k] ??= { min: v, max: v });
        r.min = Math.min(r.min, v); r.max = Math.max(r.max, v);
      }
      const lat = (j.resources.latinum ??= { min: g.latinum, max: g.latinum });
      lat.min = Math.min(lat.min, g.latinum); lat.max = Math.max(lat.max, g.latinum);
    }
  };

  /** Fly a fight the way the tour of duty flies one, plus what only exists here. */
  const flyTheFight = () => {
    j.fights++;
    const started = g.engagement;
    for (let t = 0; t < 30000 && g.engagement && !g.engagement.over && !g.over; t++) {
      const eng = g.engagement;
      if (!eng.target || eng.target.destroyed) eng.cycleTarget();
      const mark = eng.target ?? eng.liveHostiles[0];
      if (mark) eng.comeAboutTo(mark);
      eng.setThrottle(0.35 + rand() * 0.65);
      // A captain who is losing breaks off. Without this the commission is one
      // fight long on the harder rungs, and this file is about what comes after.
      if (g.ship.hullPct < 0.35 && eng.warpOutTimer <= 0) { eng.beginWarpOut(); eng.evasive(true); }
      const roll = rand();
      if (roll < 0.10) eng.targetSubsystem(pick(SUBSYSTEM_KEYS));
      else if (roll < 0.16) eng.evasive(rand() < 0.5);
      else if (roll < 0.20) eng.deployDecoy();
      else if (roll < 0.24) g.callForHelp();
      else if (roll < 0.28) { const a = g.readyAbilities?.() ?? []; if (a.length) g.useAbility(pick(a).who, pick(a).id); }
      // The only route to a boarding action: a crippled hostile inside range.
      // It is not reachable any other way, and every test that has exercised it
      // before flattened six shield facings by hand.
      else if (roll < 0.32) {
        const board = g.availableAwayMissions().find((t) => t.id === 'boarding_action');
        if (board) {
          const r = g.awayMission('boarding_action', { captainLeads: rand() < 0.3 });
          if (r?.ok) { j.awayTemplates.add('boarding_action'); say(`board:${r.outcome}`); }
        }
      }
      eng.fireAll(rand() < 0.15 ? 'torpedo' : 'all');
      pump(1);
    }
    assert.ok(g.engagement !== started || !g.engagement || g.engagement.over || g.over,
      `a fight ran 30,000 ticks without ending — seed ${seed}, leg ${j.legs}`);
    pump(40);
    if (g.lastCombat?.outcome) {
      j.outcomes.add(g.lastCombat.outcome);
      say(`fight->${g.lastCombat.outcome}`);
    }
    // An escape lays in a course of its own; ride it out rather than leaving
    // the ship mid-flight for the next leg to trip over.
    for (let i = 0; i < 30 * 3000 && g.transit && !g.over; i++) pump(1);
  };

  /** Take whatever the arrival turned up, by id, from what is actually offered. */
  const answerTheEncounter = () => {
    const enc = g.encounter;
    if (!enc) return;
    j.encounterKinds.add(enc.kind);
    const offered = g.encounterChoices() ?? [];
    if (!offered.length) { refused('encounter', `${enc.kind} offered nothing`); return; }
    const wanted = ENCOUNTER_POLICY[enc.kind] ?? [];
    const ids = offered.map((c) => c.id);
    const id = wanted.find((w) => ids.includes(w)) ?? ids[0];
    j.encounterChoices.add(id);
    say(`enc:${enc.kind}->${id}`);
    g.resolveEncounter(id);
    pump(4);
    if (g.engagement && !g.engagement.over) flyTheFight();
  };

  /** Walk the active episode as far as it will go from where the ship is. */
  const walkTheEpisode = () => {
    const m = g.missions.active;
    if (!m || m.complete) return;
    for (let step = 0; step < 30 && !m.complete && !g.over; step++) {
      const where = m.testLocation?.();
      if (where && !where.ok) return;              // the next leg goes there
      const open = m.choices().filter((c) => !c.locked);
      if (!open.length) return;
      const choice = pick(open);
      j.episodeStages.add(`${m.id}:${m.stageId}`);
      say(`ep:${m.id}:${m.stageId}->${choice.id}`);
      const before = g.pendingCombat;
      if (!g.chooseMission(choice.id)) { refused('mission', `${m.id} refused ${choice.id}`); return; }
      if (!before && g.pendingCombat) j.missionFights++;
      pump(6);
      // The episode's own fight, fought — not settled with a stub.
      if (g.engagement && !g.engagement.over) flyTheFight();
      pump(20);
    }
  };

  // ---------------------------------------------------------------- the legs
  for (let leg = 0; leg < legs && !g.over; leg++) {
    j.legs = leg + 1;
    j.systems.add(g.locationId);
    const hullBefore = g.ship.hullPct;

    // Where to. In priority order, first match wins.
    const m = g.missions.active;
    const need = m && !m.complete ? m.testLocation?.() : null;
    let dest = need && !need.ok ? need.need : null;
    if (!dest) {
      const offer = g.availableMissions?.() ?? [];
      if (!m && offer.length) dest = g.locationId;   // it is offered here
    }
    if (!dest && (g.ship.hullPct < 0.5 || g.ship.antimatter < g.ship.maxAntimatter * 0.25)) {
      const yard = g.galaxy.neighbors(g.locationId).find((n) => n.facilities?.includes('dock'));
      if (yard) dest = yard.id;
    }
    if (!dest) {
      const near = g.galaxy.neighbors(g.locationId);
      const fresh = near.filter((n) => !g.galaxy.visited.has(n.id));
      dest = (fresh.length ? pick(fresh) : pick(near))?.id ?? null;
    }

    if (dest && dest !== g.locationId) {
      // An encounter left on the viewer when a course is laid in — the case
      // #114 fixed. Counted so the fix stays proved from the outside.
      if (g.encounter) j.leftEncounterBehind++;
      let laid = false;
      for (let w = 8; w >= 1 && !laid; w--) {
        const r = g.setCourse(dest, w);
        if (r.ok) { laid = true; say(`course->${dest}@w${w}`); }
        else if (w === 1) refused('course', r.error ?? 'refused');
      }
      if (laid) {
        for (let i = 0; i < 30 * 24 * 60 && g.transit && !g.over; i++) pump(1);
        assert.ok(!g.transit || g.over,
          `a transit ran a simulated month without arriving — seed ${seed}, leg ${j.legs}`);
      }
    }

    answerTheEncounter();

    // Orbit, and whoever is down there.
    if (!g.engagement && !g.over) {
      const orbited = g.enterOrbit?.();
      const away = g.availableAwayMissions?.() ?? [];
      if (away.length) {
        const t = pick(away);
        const r = g.awayMission(t.id, { captainLeads: rand() < 0.3 });
        if (r?.ok) { j.awayTemplates.add(t.id); say(`away:${t.id}->${r.outcome}`); }
        else refused('away', r?.reason ?? 'refused');
      }
      if (orbited?.ok) g.breakOrbit?.();
    }

    // An episode, taken and walked.
    if (!g.missions.active && !g.over) {
      const offer = g.availableMissions?.() ?? [];
      if (offer.length) {
        const started = g.startMission(pick(offer).id);
        if (started?.ok !== false && g.missions.active) {
          j.episodesStarted.add(g.missions.active.id);
          say(`ep:start:${g.missions.active.id}`);
        }
      }
    }
    walkTheEpisode();
    if (g.missions.active?.complete) j.episodesFinished.add(g.missions.active.id);
    for (const id of g.missions.completed ?? []) j.episodesFinished.add(id);

    // Housekeeping — what a captain does between systems.
    if (!g.over) {
      g.effectRepairs?.();
      if (g.canDock?.()) g.dock?.();
      // Skill ids from the canonical list, never hand-written — 'warp_core'
      // against `warpcore` and 'sickbay' against `medical` have both silently
      // turned a probe in this project into one that measured nothing.
      //
      // And `.ok`, not truthiness: `spendSkill` returns `{ok: false, reason}`
      // when there are no points, which is an object, which is truthy. Reading
      // it as a boolean spun this loop forever the first time it ran — the
      // exact mistake this file's own header warns about, made in the file that
      // warns about it.
      for (let n = 0; n < 40 && (g.progress?.unspent ?? 0) > 0; n++) {
        const spent = g.spendSkill?.(pick(SKILL_LIST).id);
        if (!spent?.ok) { refused('skill', spent?.reason ?? 'refused'); break; }
      }
      if (g.commandOffer) (leg % 2 ? g.acceptCommand?.() : g.declineCommand?.());
      if (g.wreckHere) g.stripWreck?.();
      g.workTheShop?.(1);
      pump(60);
    }

    if (g.ship.hullPct > 0.9 && hullBefore < 0.6) j.hullRecoveries++;
  }

  j.over = g.over ? (g.overReason ?? 'over') : null;
  j.endedEarly = g.over && j.legs < legs;
  j.game = g;
  return j;
}

// ---------------------------------------------------------------- the flights
//
// Flown once, at module load, and asserted from several angles. Three
// commissions is about four seconds; the file has to stay well under the 19s
// that `invariants.test.js` already costs, because `node --test` runs files as
// parallel processes and only the longest one matters.
const FLOWN = COMMISSIONS.map(playCommission);
const ALL = (get) => FLOWN.flatMap((j) => [...get(j)]);

describe('a commission, played from the first order to the last', () => {
  test('the ships actually went somewhere and did something', () => {
    // The control for everything below. A driver that breaks out on leg two
    // would satisfy every other assertion in this file trivially.
    // Every bar in this file is set near half of what the three commissions
    // actually measured, so a real regression trips it and ordinary drift does
    // not. The measured figures are in the comment at the foot of the file.
    for (const j of FLOWN) {
      assert.ok(j.legs >= 20, `seed ${j.seed} only flew ${j.legs} legs`);
      assert.ok(j.systems.size >= 12,
        `seed ${j.seed} saw ${j.systems.size} systems in ${j.legs} legs`);
      assert.ok(j.ticks > 20000, `seed ${j.seed} ran only ${j.ticks} ticks`);
    }
    assert.ok(FLOWN.reduce((n, j) => n + j.fights, 0) >= 10,
      `only ${FLOWN.reduce((n, j) => n + j.fights, 0)} fights across three commissions`);
  });

  test('and nothing any of them did ever broke a rule', () => {
    // The floor. The watchdog ran on every tick of every commission.
    for (const j of FLOWN) {
      assert.deepEqual(j.dog.summary.map((v) => `${v.severity} ${v.code}: ${v.text}`), [],
        `seed ${j.seed}: ${j.dog.total} violations in ${j.ticks} ticks of ${j.legs} legs\n`
        + `  last: ${j.actions.slice(-12).join('\n        ')}`);
    }
  });

  test('and every refusal was a refusal, not a crash', () => {
    // The driver records what the game said no to rather than swallowing it.
    // A refusal is fine — a captain is told no all the time. What is not fine is
    // a driver that ignores one and carries on as though it worked.
    for (const j of FLOWN) {
      for (const r of j.refusals) {
        assert.ok(/: .+/.test(r), `a refusal with no reason: ${r}`);
      }
    }
  });

  test('and at most one of them ended early', () => {
    // Losing is allowed — it is a real outcome and the loss path deserves to be
    // walked. Three commissions ending early would mean the policy is not
    // playing, it is dying.
    const early = FLOWN.filter((j) => j.endedEarly);
    assert.ok(early.length <= 1,
      `${early.length} of ${FLOWN.length} commissions ended early: `
      + early.map((j) => `${j.seed} (${j.over})`).join(', '));
  });
});

describe('and what it met on the way', () => {
  test('encounters were answered, by a choice the encounter offered', () => {
    const kinds = new Set(ALL((j) => j.encounterKinds));
    assert.ok(kinds.size >= 5, `only met ${[...kinds].join(', ') || 'nothing'}`);
    const chosen = new Set(ALL((j) => j.encounterChoices));
    assert.ok(chosen.size >= 5, `only ever took ${[...chosen].join(', ') || 'nothing'}`);
    // Every choice taken must be one the policy names, or the driver picked a
    // fallback and nobody decided what it meant.
    const known = new Set(Object.values(ENCOUNTER_POLICY).flat());
    const unplanned = [...chosen].filter((c) => !known.has(c));
    assert.deepEqual(unplanned, [],
      'choices taken that no policy names — decide what the captain does about them');
  });

  test('and every encounter kind the game can roll has a policy', () => {
    // The friction that keeps this file honest: add a kind to the world and
    // this fails until the captain knows what to do about it.
    const needing = ENCOUNTER_KINDS.filter((k) => k !== 'quiet' && !ENCOUNTER_POLICY[k]);
    assert.deepEqual(needing, [], 'encounter kinds the scripted captain has no answer for');
  });

  test('and fights were fought, and ended in more than one way', () => {
    const outcomes = new Set(ALL((j) => j.outcomes));
    assert.ok(outcomes.size >= 3,
      `fights only ever ended ${outcomes.size} way(s): ${[...outcomes].join(', ') || 'none'}`);
    for (const o of outcomes) {
      assert.ok(OUTCOMES.includes(o), `a fight ended in "${o}", which is not an outcome`);
    }
  });

  test('and the ship was hurt, and got better', () => {
    // Both halves. Without the first, "it repairs" is vacuous; without the
    // second the commission is one long slide into a wreck.
    const worst = Math.min(...FLOWN.map((j) => j.minHullPct));
    assert.ok(worst < 0.25, `the worst any hull got was ${Math.round(worst * 100)}%`);
    const recoveries = FLOWN.reduce((n, j) => n + j.hullRecoveries, 0);
    assert.ok(recoveries >= 2,
      `hulls fell to ${Math.round(worst * 100)}% and never came back up`);
  });

  test('and resources moved in both directions', () => {
    // The assertion that would have caught "away missions cost nothing" without
    // anyone thinking to look for it: a resource that only ever climbs, or only
    // ever drains, is a mechanic with one half missing.
    for (const j of FLOWN) {
      const am = j.resources.antimatter;
      assert.ok(am && am.max > am.min,
        `seed ${j.seed}: antimatter never moved (${am?.min})`);
    }
  });

  test('and the ship was in every mode the game has, and stuck in none', () => {
    const modes = new Set(ALL((j) => j.modes));
    for (const m of modes) assert.ok(LEGAL_MODES.has(m), `the ship was in mode "${m}"`);
    assert.ok(modes.has(MODES.TRANSIT), 'nothing ever flew anywhere');
    assert.ok(modes.has(MODES.BRIDGE), 'nobody was ever on the bridge');
  });
});

describe('and the episodes it ran', () => {
  test('episodes were started, and walked past their first stage', () => {
    const started = new Set(ALL((j) => j.episodesStarted));
    assert.ok(started.size >= 1, 'no episode was ever started');
    const stages = new Set(ALL((j) => j.episodeStages));
    assert.ok(stages.size >= started.size * 2,
      `${started.size} episodes and ${stages.size} stages — barely past their openings`);
  });

  test('and an episode that ordered a fight had it fought, not stubbed', () => {
    // The difference from the episode walker in wiring.test.js, which settles
    // mission combat with `settleCombat('victory')` and never flies it.
    const fights = FLOWN.reduce((n, j) => n + j.missionFights, 0);
    assert.ok(fights >= 3,
      `only ${fights} episode stage(s) queued a battle that was actually flown`);
  });
});

describe('and the things this file exists to reach', () => {
  test('a course was laid in with something still on the viewer', () => {
    // The positive control for #114. If the captain never leaves an encounter
    // behind, the fix that made leaving one safe is not being exercised, and
    // the assertion that nothing broke a rule is quieter than it looks.
    const left = FLOWN.reduce((n, j) => n + j.leftEncounterBehind, 0);
    assert.ok(left >= 6,
      `only ${left} legs set course with an encounter live, so #114 is barely tested`);
  });

  test('and a landing party went down on every kind of ground there is', () => {
    // Asserted against the canonical export, not a hand-written list, so adding
    // a template to the game fails this until the captain can reach it. All
    // five are reachable — including `boarding_action`, which the design notes
    // had down as possibly unreachable until this file went and reached it.
    const templates = new Set(ALL((j) => j.awayTemplates));
    for (const t of templates) {
      assert.ok(AWAY_TEMPLATES[t], `ran "${t}", which is not a template`);
    }
    const never = Object.keys(AWAY_TEMPLATES).filter((t) => !templates.has(t));
    assert.deepEqual(never, [], 'away templates no commission ever reached');
  });

  test('and a save taken anywhere on the way loads clean', () => {
    // At the seams, not between fights — the tour already saves between fights.
    // Whatever state each commission ended in is a state nothing else has ever
    // written a record of.
    for (const j of FLOWN) {
      const record = JSON.parse(JSON.stringify(j.game.save()));
      const back = Game.load(record);
      assert.deepEqual(checkAll(back, OPTS), [],
        `seed ${j.seed}: the record it ended on loaded broken`);
      for (let i = 0; i < 200; i++) back.update(STEP);
      assert.deepEqual(checkAll(back, OPTS), [],
        `seed ${j.seed}: the record it ended on went wrong 200 ticks after loading`);
    }
  });
});

describe('and it plays the same way twice', () => {
  test('the same seed reaches the same place', () => {
    // The 64-bit determinism claim, asserted over the whole game rather than
    // over the RNG — and the standing proof that nothing in this driver reads a
    // wall clock or draws from `Math.random`.
    const fingerprint = (j) => [
      j.game.locationId, j.game.clock.stardate.toFixed(1), j.game.ship.classId,
      j.game.ship.hull.toFixed(2), j.game.ship.torpedoes, j.game.latinum,
      j.game.shipsLost, [...j.game.missions.completed].sort().join('+'),
      j.game.ledger.entries.length, j.legs, j.fights, j.ticks,
    ].join('|');
    const again = playCommission(COMMISSIONS[0]);
    assert.equal(fingerprint(again), fingerprint(FLOWN[0]),
      'the same seed played twice reached two different places');
  });
});

// What the three commissions actually measured when the bars above were set.
// Kept here so the next person can tell a bar that is doing work from a bar
// that has quietly become a formality, and so a large swing shows up as a
// difference from a written number rather than as nothing at all.
//
//   seed  legs ticks fights systems kinds choices away outcomes eps/stages
//   77001  26  22655   4      19      5      6      5     2       7/19
//   77002  26  22013   5      21      5      6      4     2       4/12
//   77003  26  29809   9      22      5      6      5     4       5/13
//
//   union: 6 encounter kinds, 6 choices, all 5 away templates,
//          4 outcomes (victory, routed, escaped, destroyed)
//   worst hull 0.00 | recoveries 3 | mission fights 6 | encounters left 18
//   ships lost 1 | commissions ended early 0 | refusals 4 (all with reasons)
