// End-to-end verification against a real browser at Pixel 10 Pro XL geometry.
//
// Drives the actual UI: new captain -> set course -> warp -> combat -> ledger,
// asserts there are no console errors, checks the audio graph builds, and
// proves the game still runs with the network switched off.
//
// Playwright is not a project dependency (the game has none). Install it
// anywhere and point NODE_PATH at it:
//   npm i playwright --prefix /tmp/pw
//   NODE_PATH=/tmp/pw/node_modules node tools/verify-app.mjs

import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, openSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOT_DIR ?? join(ROOT, 'screenshots');
const PORT = 8123;
const BASE = `http://localhost:${PORT}`;

// Pixel 10 Pro XL: 1344x2992 physical, ~3x DPR.
const VIEWPORT = { width: 448, height: 997 };
const DPR = 3;

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

mkdirSync(SHOTS, { recursive: true });

const failures = [];
const notes = [];
function check(label, condition, detail = '') {
  if (condition) { notes.push(`  PASS  ${label}`); }
  else { failures.push(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

/** Close any open modal so it cannot swallow the next click. */
async function dismissModals(page) {
  for (let i = 0; i < 6; i++) {
    const btn = page.locator('.modal .btn').first();
    if (!(await btn.count())) return;
    await btn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(150);
  }
}

/** Click a bottom-nav destination, clearing modals first. */
async function nav(page, label) {
  await dismissModals(page);
  await page.click(`.nav button:has-text("${label}")`, { timeout: 8000 });
  await page.waitForTimeout(400);
}

const server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(700);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? undefined,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: DPR,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
});

const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  // ------------------------------------------------ boot
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#app .screen', { timeout: 10000 });
  check('app boots', await page.locator('#app').isVisible());

  // Multi-step captain creation (no prior save in a fresh context).
  await page.waitForSelector('.steprail', { timeout: 5000 });
  check('captain creation is shown', true);
  await page.screenshot({ path: join(SHOTS, '01-difficulty.png') });

  // Step 1: difficulty. Pick something above the default so the effect is
  // observable later, and confirm the ladder is all present.
  const difficultyCount = await page.locator('.diffcard').count();
  check('the full difficulty ladder is offered', difficultyCount === 12, `${difficultyCount} rungs`);
  // "Commander" is a substring of "Lieutenant Commander", so match the
  // heading exactly rather than by containment.
  await page.locator('.diffcard', { has: page.locator('.diffhead b', { hasText: /^Commander$/ }) })
    .first().click();
  await page.click('text=Continue');
  await page.waitForTimeout(250);

  // Step 2: identity.
  await page.fill('.field input >> nth=0', 'Naomi');
  await page.fill('.field input >> nth=1', 'Okafor');
  await page.click('text=Continue');
  await page.waitForTimeout(250);

  // Step 3: species — pick Vulcan, whose bonuses are easy to assert.
  await page.click('.optcard:has-text("Vulcan") >> nth=0');
  await page.screenshot({ path: join(SHOTS, '01b-species.png') });
  await page.click('text=Continue');
  await page.waitForTimeout(250);

  // Step 4: origin.
  await page.click('.optcard:has-text("Frontier Colony") >> nth=0');
  await page.click('text=Continue');
  await page.waitForTimeout(250);

  // Step 5: career.
  await page.click('.optcard:has-text("Science") >> nth=0');
  await page.click('text=Continue');
  await page.waitForTimeout(250);

  // Step 6: abilities. Spend a point and confirm the budget responds.
  const budgetBefore = await page.textContent('.panel h2');
  const plusButtons = page.locator('.stepbtn:not([disabled])');
  if (await plusButtons.count()) await plusButtons.last().click();
  await page.waitForTimeout(200);
  const budgetAfter = await page.textContent('.panel h2');
  check('point buy spends from a visible budget', budgetBefore !== budgetAfter,
    `${budgetBefore} -> ${budgetAfter}`);
  await page.screenshot({ path: join(SHOTS, '01c-abilities.png') });
  await page.click('text=Continue');
  await page.waitForTimeout(250);

  // Step 7: traits — take one advantage and one complication.
  await page.click('.optcard:has-text("Tinkerer") >> nth=0');
  await page.click('.optcard:has-text("Reckless") >> nth=0');
  await page.click('text=Continue');
  await page.waitForTimeout(250);

  // Step 8: crew and ship. Original crew, pinned seed.
  await page.click('text=Original crew');
  await page.fill('.field input[placeholder*="blank"]', 'verification-1701');
  await page.click('text=Continue');
  await page.waitForTimeout(250);

  // Step 9: review.
  await page.screenshot({ path: join(SHOTS, '01d-review.png') });
  await page.click('text=Assume command');
  await page.waitForTimeout(700);

  // Dismiss the opening briefing modal.
  const ack = page.locator('.modal .btn').first();
  if (await ack.count()) await ack.click();
  await page.waitForTimeout(400);

  check('game state exists', await page.evaluate(() => !!globalThis.__app?.game));

  const built = await page.evaluate(() => {
    const g = globalThis.__app.game;
    return {
      name: g.character.name,
      species: g.character.speciesId,
      career: g.character.careerId,
      origin: g.character.originId,
      traits: g.character.traits,
      difficulty: g.difficulty.id,
      science: g.character.score('science'),
      proficientScience: g.character.isProficient('science'),
      hasRep: !!g.reputation,
    };
  });
  check('the created captain is the one that was built',
    built.name === 'Naomi Okafor' && built.species === 'vulcan'
      && built.career === 'science' && built.origin === 'frontier_colony',
    JSON.stringify(built));
  check('chosen traits carried through',
    built.traits.includes('tinkerer') && built.traits.includes('reckless'), JSON.stringify(built.traits));
  check('chosen difficulty carried through', built.difficulty === 'commander', built.difficulty);
  check('species and career shaped the sheet',
    built.science >= 14 && built.proficientScience,
    `science ${built.science}, proficient ${built.proficientScience}`);

  await page.screenshot({ path: join(SHOTS, '02-bridge.png') });

  // ------------------------------------------------ audio graph
  const audioState = await page.evaluate(() => {
    const a = globalThis.__app.audio ?? null;
    return a ? { ready: a.ready } : null;
  });
  const audioBuilt = await page.evaluate(async () => {
    // Import the singleton directly and force it awake, then fire every cue.
    const { audio } = await import('./src/audio/engine.js');
    const { CUES } = await import('./src/audio/sfx.js');
    audio.unlock();
    if (!audio.ready) return { ready: false, played: 0, errors: ['context refused'] };
    const errors = [];
    let played = 0;
    for (const name of Object.keys(CUES)) {
      try { audio.play(name); played++; } catch (e) { errors.push(`${name}: ${e}`); }
    }
    return { ready: audio.ready, played, total: Object.keys(CUES).length, errors };
  });
  check('audio context builds', audioBuilt.ready, JSON.stringify(audioBuilt.errors ?? []));
  check(`all ${audioBuilt.total} sound cues schedule without error`,
    audioBuilt.played === audioBuilt.total && (audioBuilt.errors ?? []).length === 0,
    JSON.stringify(audioBuilt.errors ?? []));
  void audioState;

  // ------------------------------------------------ typed order -> warp
  await page.fill('.orderbar input', 'helm, set course for Vulcan, warp eight');
  await page.click('.orderbar button');
  await page.waitForTimeout(800);

  const inTransit = await page.evaluate(() => globalThis.__app.game.mode);
  check('a typed natural order puts the ship at warp', inTransit === 'transit', `mode=${inTransit}`);
  await page.screenshot({ path: join(SHOTS, '03-transit.png') });

  // Let the transit run to arrival.
  await page.waitForFunction(() => globalThis.__app.game.mode !== 'transit', null, { timeout: 40000 });
  const arrived = await page.evaluate(() => ({
    location: globalThis.__app.game.locationId,
    stardate: globalThis.__app.game.clock.stardate,
  }));
  check('the ship arrives at the ordered destination', arrived.location === 'vulcan', arrived.location);
  check('stardate advanced with the distance travelled', arrived.stardate > 4523.3, String(arrived.stardate));

  // Arrival may have produced a contact. The map must stay reachable while one
  // is pending — check that, then clear it before continuing.
  if (await page.evaluate(() => globalThis.__app.game.mode === 'encounter')) {
    await page.screenshot({ path: join(SHOTS, '03b-encounter.png') });
    await nav(page, 'Map');
    check('the map is reachable with a contact pending',
      await page.locator('#galaxy').isVisible());
    await nav(page, 'Bridge');
    check('the bridge returns to the pending contact',
      await page.evaluate(() => !!document.querySelector('.panel')));
    await page.evaluate(() => { globalThis.__app.game.endEncounter(); globalThis.__app.render(); });
    await page.waitForTimeout(400);
  }
  await dismissModals(page);

  // ------------------------------------------------ galaxy map
  await nav(page, 'Map');
  check('galaxy map canvas renders', await page.locator('#galaxy').isVisible());
  const mapDrawn = await page.evaluate(() => {
    const c = document.getElementById('galaxy');
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 8) lit++;
    return lit;
  });
  check('the map actually draws pixels', mapDrawn > 50, `lit samples: ${mapDrawn}`);
  await page.screenshot({ path: join(SHOTS, '04-galaxy-map.png') });

  // ------------------------------------------------ combat
  await page.evaluate(() => {
    const app = globalThis.__app;
    return import('./src/sim/ship.js').then(({ Ship }) => {
      const enemy = new Ship('bird_of_prey', { faction: 'klingon', name: 'IKS Ch’Tang' });
      app.game.startCombat([enemy], { name: 'Verification engagement' });
      app.render();
    });
  });
  await page.waitForTimeout(1500);
  check('combat enters the tactical screen',
    await page.evaluate(() => globalThis.__app.game.mode === 'combat'));
  check('tactical canvas is present', await page.locator('#tactical').isVisible());

  // The tactical canvas is WebGL when the device can manage it and 2D when it
  // cannot, so "did it draw anything" has to be asked in a way that works for
  // both. Reading back GL pixels needs preserveDrawingBuffer, which costs
  // performance on every frame of a real session — so the GL path is sampled by
  // screenshotting the element instead, which is what a player actually sees.
  const renderMode = await page.evaluate(() => globalThis.__app.renderMode ?? '2d');
  check('a render mode is reported', renderMode === '3d' || renderMode === '2d', renderMode);

  const tacticalDrawn = await page.evaluate((mode) => {
    const c = document.getElementById('tactical');
    if (mode === '3d') return null;
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 8) lit++;
    return lit;
  }, renderMode);

  if (renderMode === '2d') {
    check('the tactical view actually draws pixels', tacticalDrawn > 50, `lit samples: ${tacticalDrawn}`);
  } else {
    // Clip by geometry rather than by element handle: the screen node is
    // rebuilt on every render, so a handle taken a moment ago is already
    // detached by the time the screenshot is taken.
    const boxRect = await page.evaluate(() => {
      const r = document.getElementById('tactical').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const shot = await page.screenshot({ clip: boxRect });
    // A cleared-but-empty GL canvas compresses to almost nothing; a scene with
    // a starfield, a grid and two hulls in it does not.
    check('the 3D tactical view actually draws a scene', shot.length > 3000,
      `${shot.length} bytes of PNG`);

    const gl = await page.evaluate(() => {
      const v = globalThis.__app.tactical;
      return v?.stats ? { ...v.stats, lost: v.renderer?.lost ?? null } : null;
    });
    check('the renderer reports real draw calls', gl && gl.drawCalls > 3, JSON.stringify(gl));
    check('the renderer stays inside the draw-call budget', gl && gl.drawCalls <= 60, String(gl?.drawCalls));
    check('the renderer stays inside the triangle budget', gl && gl.triangles <= 8000, String(gl?.triangles));
    check('the WebGL context is healthy', gl && gl.lost === false, String(gl?.lost));
  }
  await page.screenshot({ path: join(SHOTS, '05-combat.png') });

  // ---- Typed orders, through the real input box ----
  //
  // Everything below this point in the file drives the app object directly.
  // This block does not: it types into the order line and presses the button,
  // because the whole claim of the command layer is that what you type becomes
  // what the ship does, and that claim is only tested end to end.
  const typeOrder = async (text) => {
    await dismissModals(page);
    await page.fill('.orderbar input', text);
    await page.click('.orderbar button');
    await page.waitForTimeout(120);
  };

  await typeOrder('helm, take evasive action');
  const evadingTyped = await page.evaluate(() => globalThis.__app.game.ship.evasive);
  check('a typed order in plain English reaches the ship', evadingTyped === true);

  // Not in the regex table, misspelled, and politely phrased — three things at
  // once, which is the actual shape of what a person types under pressure.
  await typeOrder('could you please aim for their nacels');
  const targetedTyped = await page.evaluate(() => globalThis.__app.game.engagement?.targetedSubsystem);
  check('a misspelled, politely phrased order is still understood',
    targetedTyped === 'engines', String(targetedTyped));

  // ---- The captain's chair ----
  await typeOrder('jettison the ion pod');
  const decoy = await page.evaluate(() => globalThis.__app.game.engagement?.decoyTimer ?? 0);
  check('the chair’s ion pod deploys a real decoy', decoy > 0, String(decoy));

  const chairIntercom = await page.evaluate(async () => {
    const before = globalThis.__app.game.log.length;
    const btn = [...document.querySelectorAll('.chair-stations .btn')]
      .find((b) => b.textContent.includes('Engineering'));
    btn?.click();
    await new Promise((r) => setTimeout(r, 60));
    return { clicked: !!btn, grew: globalThis.__app.game.log.length > before };
  });
  check('the chair renders its intercom controls', chairIntercom.clicked);
  check('an intercom control produces a real report', chairIntercom.grew);
  await dismissModals(page);

  // Exercise real tactical controls.
  await page.evaluate(() => globalThis.__app.executeOrder(
    { action: 'target_subsystem', subsystem: 'engines' }, 'target their engines'));
  await page.evaluate(() => globalThis.__app.executeOrder({ action: 'preset', preset: 'attack' }, 'attack power'));
  await page.evaluate(() => globalThis.__app.executeOrder({ action: 'fire', weaponType: 'all' }, 'fire'));
  await page.waitForTimeout(1200);

  const combatWorking = await page.evaluate(() => {
    const g = globalThis.__app.game;
    const enemy = g.engagement?.hostiles[0];
    // Individual shots can miss by design, so give the guns a few cycles
    // before deciding whether they work at all.
    for (let i = 0; i < 400 && enemy && !enemy.destroyed; i++) g.update(1 / 30);
    return {
      preset: g.ship.power.preset,
      subsystem: g.engagement?.targetedSubsystem,
      enemyDamaged: enemy ? enemy.hullPct < 1 || enemy.shieldPct < 1 : false,
    };
  });
  check('power preset order took effect', combatWorking.preset === 'attack', combatWorking.preset);
  check('subsystem targeting order took effect', combatWorking.subsystem === 'engines', String(combatWorking.subsystem));
  check('weapons fire actually damages the target', combatWorking.enemyDamaged);

  // Run the fight to a conclusion.
  await page.evaluate(() => {
    const g = globalThis.__app.game;
    for (let i = 0; i < 12000 && g.engagement && !g.engagement.over; i++) g.update(1 / 30);
  });
  await page.waitForTimeout(900);
  const afterCombat = await page.evaluate(() => ({
    mode: globalThis.__app.game.mode,
    outcome: globalThis.__app.lastOutcome ?? null,
    entries: globalThis.__app.game.ledger.entries.length,
    xp: globalThis.__app.game.progress.xp,
  }));
  check('the engagement resolves', afterCombat.mode !== 'combat', afterCombat.mode);
  check('experience was awarded', afterCombat.xp > 0, String(afterCombat.xp));

  // A Klingon captain may withdraw rather than die, so run a second, decided
  // engagement to exercise the permanent-kill path through the real UI.
  await dismissModals(page);

  const killRecorded = await page.evaluate(async () => {
    const app = globalThis.__app;
    const { Ship } = await import('./src/sim/ship.js');
    const before = app.game.ledger.destroyedShips.length;
    const victim = new Ship('orion_raider', { faction: 'orion', name: 'Green Wind' });
    app.game.startCombat([victim], { name: 'Kill-path verification' });
    victim.destroy('verification');
    for (let i = 0; i < 200 && app.game.engagement && !app.game.engagement.over; i++) {
      app.game.update(1 / 30);
    }
    return {
      before,
      after: app.game.ledger.destroyedShips.length,
      standing: app.game.ledger.standingOf('orion'),
      named: app.game.ledger.destroyedShips.at(-1)?.name ?? null,
    };
  });
  await page.waitForTimeout(700);
  check('a destroyed ship is written to the consequence ledger permanently',
    killRecorded.after > killRecorded.before && killRecorded.named === 'Green Wind',
    JSON.stringify(killRecorded));
  check('destroying a ship costs standing with its faction',
    killRecorded.standing < 0, String(killRecorded.standing));

  // ------------------------------------------------ the rest of the screens
  for (const [navLabel, shot] of [['Ship', '06-ship'], ['Crew', '07-crew'], ['Record', '08-record']]) {
    await nav(page, navLabel);
    check(`${navLabel} screen renders`, (await page.locator('.panel').count()) > 0);
    await page.screenshot({ path: join(SHOTS, `${shot}.png`) });
  }

  // ------------------------------------------------ character & reputation UI
  await nav(page, 'Captain');
  const sheetAbilities = await page.locator('.abilityrow').count();
  check('the character sheet lists all six abilities', sheetAbilities === 6, `${sheetAbilities}`);
  await page.screenshot({ path: join(SHOTS, '12-character-sheet.png') });

  await nav(page, 'Rep');
  const repPanels = await page.locator('.panel').count();
  check('the reputation screen renders every track', repPanels >= 6, `${repPanels} panels`);
  await page.screenshot({ path: join(SHOTS, '13-reputation.png') });

  // Earn enough reputation to unlock and buy a project through the real UI.
  const repFlow = await page.evaluate(() => {
    const g = globalThis.__app.game;
    for (let i = 0; i < 12; i++) g.earnReputation('colony_saved');
    const fed = g.reputation.track('federation');
    return { tier: fed.tier, marks: fed.marks, available: fed.availableProjects().length };
  });
  check('reputation tiers advance from earned events',
    repFlow.tier >= 1 && repFlow.available > 0, JSON.stringify(repFlow));

  await nav(page, 'Bridge');
  await nav(page, 'Rep');
  const buyBtn = page.locator('.panel .btn:not([disabled])').first();
  if (await buyBtn.count()) { await buyBtn.click(); await page.waitForTimeout(500); }
  const afterBuy = await page.evaluate(() => {
    const g = globalThis.__app.game;
    const fed = g.reputation.track('federation');
    return { completed: fed.completed.length, marks: fed.marks };
  });
  check('a reputation project can be bought from the UI',
    afterBuy.completed >= 1, JSON.stringify(afterBuy));

  // ------------------------------------------------ signature power
  const signature = await page.evaluate(async () => {
    const app = globalThis.__app;
    const { Ship } = await import('./src/sim/ship.js');
    app.game.startCombat([new Ship('d7', { faction: 'klingon', name: 'IKS Sig' })]);
    app.render();
    const before = {
      used: app.game.character.signatureUsed,
      career: app.game.character.careerId,
      label: app.game.character.career.signature,
    };
    const btn = [...document.querySelectorAll('.btn')]
      .find((b) => b.textContent.trim().startsWith(before.label));
    if (!btn) return { ...before, error: 'no signature button on the tactical screen' };
    btn.click();
    return {
      ...before,
      after: app.game.character.signatureUsed,
      disabledNow: !![...document.querySelectorAll('.btn')]
        .find((b) => b.textContent.trim().startsWith(before.label) && b.disabled),
    };
  });
  check('the career signature power is usable from the tactical screen',
    !signature.error && signature.before !== true && signature.after === true,
    JSON.stringify(signature));
  await page.screenshot({ path: join(SHOTS, '15-signature.png') });

  // Difficulty must actually field more hulls, not just claim to.
  const outnumbered = await page.evaluate(async () => {
    const { Game } = await import('./src/core/state.js');
    const { Ship } = await import('./src/sim/ship.js');
    const count = (difficulty) => {
      const g = new Game({ seed: 1n, crewMode: 'original', difficulty });
      g.startCombat([new Ship('orion_raider', { faction: 'orion', name: 'R' })]);
      return g.engagement.hostiles.length;
    };
    return { lieutenant: count('lieutenant'), fleet: count('fleet_admiral') };
  });
  check('higher difficulty actually fields more hostiles',
    outnumbered.fleet > outnumbered.lieutenant, JSON.stringify(outnumbered));

  await page.evaluate(() => {
    const g = globalThis.__app.game;
    if (g.engagement) { g.engagement.end('escaped'); }
    globalThis.__app.render();
  });
  await page.waitForTimeout(600);
  await dismissModals(page);

  // ------------------------------------------------ outcome resolution
  //
  // Gameplay no longer rolls a die. These checks assert the mechanism
  // deterministically wherever they can, rather than sampling for both
  // outcomes — a lucky run is a real possibility and must not fail the build.
  const dice = await page.evaluate(async () => {
    const g = globalThis.__app.game;
    const team = g.buildAwayTeam(['science', 'medical', 'tactical'], true);
    const attempt = (dc) => team.check(g.rng, 'science', { dc, hazard: 'routine' });

    const sample = Array.from({ length: 30 }, () => attempt(12));
    const hopeless = Array.from({ length: 20 }, () => attempt(90));
    const trivial = Array.from({ length: 20 }, () => attempt(-40));

    return {
      captured: globalThis.__app.recentRolls.length,
      noDie: sample.every((r) => r.natural === undefined),
      marginDecides: sample.every((r) => r.success === (r.margin >= 0)),
      arithmeticShown: sample.every((r) => r.parts.length > 0),
      // The outcome actually varies rather than returning a constant.
      distinctMargins: new Set(sample.map((r) => Math.round(r.margin))).size,
      // The swing is bounded, so a wide enough gap is decided by capability.
      hopelessAllFail: hopeless.every((r) => !r.success),
      trivialAllPass: trivial.every((r) => r.success),
    };
  });
  check('gameplay does not roll a d20', dice.noDie);
  check('the margin decides the outcome', dice.marginDecides);
  check('every outcome itemises where its modifier came from', dice.arithmeticShown);
  check('the outcome actually varies', dice.distinctMargins >= 5,
    `${dice.distinctMargins} distinct margins in 30 attempts`);
  check('a wide enough capability gap decides it either way',
    dice.hopelessAllFail && dice.trivialAllPass,
    `hopeless ${dice.hopelessAllFail}, trivial ${dice.trivialAllPass}`);
  check('outcomes are captured for the audit log', dice.captured >= 30, `${dice.captured}`);

  // Difficulty must actually move the DCs.
  const dcShift = await page.evaluate(async () => {
    const { DifficultySettings } = await import('./src/rules/difficulty.js');
    return {
      story: new DifficultySettings('story').dc(15),
      lieutenant: new DifficultySettings('lieutenant').dc(15),
      fleet: new DifficultySettings('fleet_admiral').dc(15),
    };
  });
  check('difficulty shifts the target numbers',
    dcShift.story < dcShift.lieutenant && dcShift.lieutenant < dcShift.fleet,
    JSON.stringify(dcShift));

  // Spend a skill point through the real UI.
  await nav(page, 'Record');
  const before = await page.evaluate(() => globalThis.__app.game.progress.unspent);
  const plus = page.locator('.skill button:not([disabled])').first();
  if (await plus.count()) await plus.click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => globalThis.__app.game.progress.unspent);
  check('skill points can be spent from the UI', after === before - 1, `${before} -> ${after}`);

  // ------------------------------------------------ save / restore
  await page.evaluate(() => globalThis.__app.save());
  const savedOk = await page.evaluate(() => {
    const raw = localStorage.getItem('sfc:save:auto');
    if (!raw) return false;
    const data = JSON.parse(raw);
    return !!(data.seed && data.ship && data.ledger);
  });
  check('the command record saves to storage', savedOk);

  // ------------------------------------------------ THE OFFLINE PROOF
  const swReady = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  check('service worker is active', swReady);

  // Give the worker a moment to finish precaching, then cut the network
  // entirely and reload. This is the headline requirement.
  await page.waitForTimeout(2500);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(keys[0]);
    return (await cache.keys()).length;
  });
  check('app files are precached', cached > 20, `${cached} entries`);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const offlineBooted = await page.evaluate(() => {
    const app = globalThis.__app;
    return { hasApp: !!app, screens: document.querySelectorAll('#app .screen').length };
  });
  check('the game boots with the network OFF', offlineBooted.hasApp && offlineBooted.screens > 0,
    JSON.stringify(offlineBooted));

  // Resume the saved command and keep playing, still offline.
  const resume = page.locator('.modal .btn:has-text("Resume")');
  if (await resume.count()) await resume.click();
  await page.waitForTimeout(900);

  const offlinePlayable = await page.evaluate(() => {
    const app = globalThis.__app;
    if (!app?.game) return null;
    app.executeOrder({ action: 'alert', level: 'red' }, 'red alert');
    app.executeOrder({ action: 'preset', preset: 'defense' }, 'defensive posture');
    return {
      alert: app.game.alert,
      preset: app.game.ship.power.preset,
      location: app.game.locationId,
      xp: app.game.progress.xp,
    };
  });
  check('a restored game is playable offline',
    offlinePlayable?.alert === 'red' && offlinePlayable?.preset === 'defense',
    JSON.stringify(offlinePlayable));
  check('the saved record survived the offline reload',
    (offlinePlayable?.xp ?? 0) > 0, JSON.stringify(offlinePlayable));
  await page.screenshot({ path: join(SHOTS, '09-offline.png') });
  await context.setOffline(false);

  // ------------------------------------------------ landscape
  await page.setViewportSize({ width: 997, height: 448 });
  await page.waitForTimeout(600);
  check('landscape layout renders', (await page.locator('.panel').count()) > 0);
  await page.screenshot({ path: join(SHOTS, '10-landscape.png') });

  // ------------------------------------------------ no errors anywhere
  const ignorable = (t) => /favicon|Failed to load resource.*404/i.test(t);
  const realConsole = consoleErrors.filter((t) => !ignorable(t));
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  check('no console errors', realConsole.length === 0, realConsole.slice(0, 5).join(' | '));

  // ------------------------------------------------ the single-file build
  // Opened straight off the filesystem, the way it will be on the phone if
  // someone downloads the one-file version instead of installing the PWA.
  const singleFile = join(ROOT, 'dist', 'starfleet-command.html');
  if (existsSync(singleFile)) {
    // A fresh context, so this is genuinely a first launch: the main run
    // above already wrote a save, and a shared origin would show the
    // "Resume Command" prompt instead of captain creation.
    const freshCtx = await browser.newContext({
      viewport: VIEWPORT, deviceScaleFactor: DPR, isMobile: true, hasTouch: true,
    });
    const page2 = await freshCtx.newPage();
    const errs2 = [];
    page2.on('pageerror', (e) => errs2.push(String(e)));
    page2.on('console', (m) => { if (m.type() === 'error') errs2.push(m.text()); });

    await page2.goto(pathToFileURL(singleFile).href, { waitUntil: 'domcontentloaded' });
    await page2.waitForTimeout(1800);

    check('the single-file build boots from file:// with no server',
      await page2.evaluate(() => !!globalThis.__app), errs2.slice(0, 3).join(' | '));

    // Play it, to prove the bundle is functional and not merely parseable.
    const bundlePlayable = await page2.evaluate(() => {
      const app = globalThis.__app;
      const click = (text) => {
        const b = [...document.querySelectorAll('.btn')]
          .find((x) => x.textContent.trim().startsWith(text));
        if (b) b.click();
        return !!b;
      };
      // Creation is a nine-step flow; walk it to the end and commit.
      if (!click('Random captain')) return { error: 'no random captain button' };
      for (let i = 0; i < 12; i++) if (!click('Continue')) break;
      const seedField = document.querySelector('.field input[placeholder*="blank"]');
      if (seedField) {
        seedField.value = 'bundle-check';
        seedField.dispatchEvent(new Event('input', { bubbles: true }));
      }
      for (let i = 0; i < 12; i++) if (!click('Continue')) break;
      if (!click('Assume command')) return { error: 'never reached the final step' };
      if (!app.game) return { error: 'no game after start' };

      app.executeOrder({ action: 'alert', level: 'red' }, 'red alert');
      const r = app.game.setCourse('vulcan', 8);
      return {
        alert: app.game.alert,
        courseOk: r.ok,
        crew: app.game.crew.living.length,
        systems: app.game.galaxy.systems.length,
        episodes: app.game.missions.episodes.length,
        character: app.game.character.name,
        difficulty: app.game.difficulty.id,
      };
    });
    check('the single-file build is fully playable',
      bundlePlayable.alert === 'red' && bundlePlayable.courseOk
        && bundlePlayable.crew >= 6 && bundlePlayable.systems > 30
        && bundlePlayable.episodes >= 16 && !!bundlePlayable.character,
      JSON.stringify(bundlePlayable));
    check('no errors in the single-file build', errs2.length === 0, errs2.slice(0, 3).join(' | '));
    await page2.screenshot({ path: join(SHOTS, '11-single-file.png') });
    await page2.close();
    await freshCtx.close();
  } else {
    notes.push('  SKIP  single-file build not present (run: npm run build)');
  }

  // ------------------------------------------------ the APK payload
  // The Android app is a WebView pointed at assets/game.html. Extract that
  // asset from the signed APK and run it, which is exactly what the phone does.
  const apk = join(ROOT, 'dist', 'starfleet-command.apk');
  if (existsSync(apk)) {
    const extracted = join(ROOT, 'build', 'apk-asset-check.html');
    mkdirSync(dirname(extracted), { recursive: true });
    try {
      execFileSync('unzip', ['-p', apk, 'assets/game.html'], {
        stdio: ['ignore', openSync(extracted, 'w'), 'ignore'], maxBuffer: 64 * 1024 * 1024,
      });
    } catch { /* handled by the existsSync below */ }

    if (existsSync(extracted) && statSync(extracted).size > 1000) {
      const apkCtx = await browser.newContext({
        viewport: VIEWPORT, deviceScaleFactor: DPR, isMobile: true, hasTouch: true,
      });
      const page3 = await apkCtx.newPage();
      const errs3 = [];
      page3.on('pageerror', (e) => errs3.push(String(e)));
      page3.on('console', (m) => { if (m.type() === 'error') errs3.push(m.text()); });
      await page3.goto(pathToFileURL(extracted).href, { waitUntil: 'domcontentloaded' });
      await page3.waitForTimeout(1800);

      const apkPlayable = await page3.evaluate(() => {
        const app = globalThis.__app;
        if (!app) return { error: 'no app' };
        if (!app.creator) return { error: 'captain creation was not shown on first launch' };
        const click = (t) => {
          const b = [...document.querySelectorAll('.btn')]
            .find((x) => x.textContent.trim().startsWith(t));
          if (b) b.click();
          return !!b;
        };
        click('Random captain');
        for (let i = 0; i < 12; i++) if (!click('Continue')) break;
        if (!click('Assume command')) return { error: 'never reached the final step' };
        if (!app.game) return { error: 'no game after creation' };
        return {
          captain: app.game.character.name,
          difficulty: app.game.difficulty.id,
          systems: app.game.galaxy.systems.length,
          ships: Object.keys(app.game.ship.cls).length > 0,
          episodes: app.game.missions.episodes.length,
        };
      });
      check('the game inside the APK boots and creates a captain',
        !apkPlayable.error && apkPlayable.systems > 30, JSON.stringify(apkPlayable));
      check('no errors in the APK payload', errs3.length === 0, errs3.slice(0, 3).join(' | '));
      await page3.screenshot({ path: join(SHOTS, '14-apk-payload.png') });
      await page3.close();
      await apkCtx.close();
    } else {
      notes.push('  SKIP  could not extract assets/game.html from the APK');
    }
  } else {
    notes.push('  SKIP  APK not built (run: ANDROID_HOME=... ./tools/build-apk.sh)');
  }
} catch (err) {
  failures.push(`  FAIL  harness threw — ${err.message}`);
  try { await page.screenshot({ path: join(SHOTS, 'ERROR.png') }); } catch { /* ignore */ }
} finally {
  await browser.close();
  server.kill();
}

console.log('\n' + notes.join('\n'));
if (failures.length) {
  console.log('\n' + failures.join('\n'));
  console.log(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${notes.length} checks passed. Screenshots in ${SHOTS}`);
