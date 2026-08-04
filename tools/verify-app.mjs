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
  await page.click('.orderbar button.send');
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

  // ---- The ship has an inside ----
  //
  // Driven through the order line, because "type it and actually arrive" is
  // the check the whole subsystem exists for: it proves the geometry, the room
  // graph, the collision, the autopilot and the parser all agree at once.
  await dismissModals(page);
  await nav(page, 'Bridge');
  const aboard = await page.evaluate(() => ({
    room: globalThis.__app.game.walk.roomId,
    seated: globalThis.__app.game.walk.seated,
    panel: [...document.querySelectorAll('.panel h2')].some((h) => h.textContent.trim() === 'Aboard'),
  }));
  check('the captain starts in the chair on the bridge',
    aboard.room === 'bridge' && aboard.seated === true, JSON.stringify(aboard));
  check('the bridge says where you are', aboard.panel === true);

  await page.fill('.orderbar input', 'go to sickbay');
  await page.press('.orderbar input', 'Enter');
  await page.waitForTimeout(250);
  const setOff = await page.evaluate(() => ({
    walking: !!globalThis.__app.game.walkOrder,
    to: globalThis.__app.game.walkOrder?.toId ?? null,
    room: globalThis.__app.game.walk.roomId,
  }));
  check('"go to sickbay" sets off rather than teleporting',
    setOff.walking && setOff.to === 'sickbay' && setOff.room === 'bridge',
    JSON.stringify(setOff));

  // The walk runs on the real frame loop, so this waits in wall-clock time
  // rather than stepping the simulation by hand — which is the point: it is a
  // walk, and it takes as long as walking takes.
  const reachedSickbay = await page.evaluate(async () => {
    const g = globalThis.__app.game;
    const deadline = performance.now() + 30000;
    while (g.walk.roomId !== 'sickbay' && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 120));
    }
    return { room: g.walk.roomId, seated: g.walk.seated, order: !!g.walkOrder };
  });
  check('and the captain actually arrives in sickbay',
    reachedSickbay.room === 'sickbay', JSON.stringify(reachedSickbay));
  check('arriving ends the walk and leaves you on your feet',
    reachedSickbay.order === false && reachedSickbay.seated === false,
    JSON.stringify(reachedSickbay));

  await page.evaluate(() => globalThis.__app.render());
  await page.waitForTimeout(200);
  // The Aboard panel is well down the bridge; scroll it into frame so the
  // screenshot is of the thing this section is about.
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('.panel h2')].find((x) => x.textContent.trim() === 'Aboard');
    h?.closest('.panel')?.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SHOTS, '10-aboard.png') });

  // And back, by voice, to where the game normally sits.
  await page.fill('.orderbar input', 'back to the bridge');
  await page.press('.orderbar input', 'Enter');
  const home = await page.evaluate(async () => {
    const g = globalThis.__app.game;
    const deadline = performance.now() + 30000;
    while (g.walk.roomId !== 'bridge' && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 120));
    }
    return g.walk.roomId;
  });
  check('"back to the bridge" walks you home', home === 'bridge', home);

  await page.fill('.orderbar input', 'take the chair');
  await page.press('.orderbar input', 'Enter');
  await page.waitForTimeout(300);
  check('and you can take the chair again',
    await page.evaluate(() => globalThis.__app.game.walk.seated) === true);

  // ---- The manual, and the whole log ----
  //
  // Both existed and neither was reachable: `orderHelp()` was exported and
  // never imported, and `logScreen()` was wired into the router with nothing
  // ever calling go('log'). A feature nobody can navigate to has not shipped,
  // so what is checked here is arrival — from the key, from the log panel, and
  // from the order line.
  await dismissModals(page);
  await page.click('.orderbar button.manual');
  await page.waitForTimeout(300);
  const manual = await page.evaluate(() => ({
    screen: globalThis.__app.screen,
    groups: document.querySelectorAll('.panel').length,
    entries: document.querySelectorAll('.ref-entry').length,
    phrases: document.querySelectorAll('.ref-phrase').length,
  }));
  check('the ? key opens the command reference', manual.screen === 'reference', manual.screen);
  check('the reference lists every order', manual.entries >= 38, String(manual.entries));
  check('the reference shows the phrasings, which are the point',
    manual.phrases >= 100, String(manual.phrases));
  await page.screenshot({ path: join(SHOTS, '08-reference.png') });

  // And by voice, which is the discovery path that does not require finding a
  // button in the first place.
  await page.evaluate(() => globalThis.__app.go('bridge'));
  await page.waitForTimeout(200);
  await page.fill('.orderbar input', 'what can i say');
  await page.press('.orderbar input', 'Enter');
  await page.waitForTimeout(300);
  check('asking what you can say opens the manual',
    await page.evaluate(() => globalThis.__app.screen) === 'reference');

  await page.evaluate(() => globalThis.__app.go('bridge'));
  await page.waitForTimeout(250);
  const logReach = await page.evaluate(async () => {
    const b = [...document.querySelectorAll('.btn')]
      .find((x) => x.textContent.trim().startsWith('Full log'));
    if (!b) return { error: 'no way to the full log from the bridge' };
    b.click();
    await new Promise((r) => setTimeout(r, 250));
    return {
      screen: globalThis.__app.screen,
      lines: document.querySelectorAll('.logline').length,
      entries: globalThis.__app.game.log.length,
      filters: document.querySelectorAll('.chip-row .btn').length,
    };
  });
  check('the full log is reachable from the bridge',
    logReach.screen === 'log', JSON.stringify(logReach));
  // The whole log, not a tail of it. The bridge shows six lines; this screen
  // exists because a five-year commission is longer than that.
  check('the log screen shows every entry there is',
    logReach.lines === logReach.entries, `${logReach.lines} of ${logReach.entries}`);

  // The filter reads `source`, which is what pushLog writes. It read `station`
  // at first, which produced no chips and an empty list behind every one.
  const filtered = await page.evaluate(async () => {
    const chips = [...document.querySelectorAll('.chip-row .btn')];
    const pick = chips.find((c) => c.textContent.trim() !== 'All');
    if (!pick) return { error: 'no filter chips' };
    const label = pick.textContent.trim();
    pick.click();
    await new Promise((r) => setTimeout(r, 250));
    return {
      label,
      shown: document.querySelectorAll('.logline').length,
      expected: globalThis.__app.game.log.filter((l) => l.source === label).length,
    };
  });
  check('filtering the log by station shows that station and nothing else',
    filtered.shown > 0 && filtered.shown === filtered.expected, JSON.stringify(filtered));
  await page.evaluate(() => { globalThis.__app.logFilter = null; globalThis.__app.render(); });
  void logReach.filters;
  await page.screenshot({ path: join(SHOTS, '09-log.png') });
  await nav(page, 'Bridge');

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

    // Navigating away from Tactical used to null the view without disposing it.
    // The canvas lives in a persistent host, so returning built a second GL
    // program on the same canvas and inserted another overlay canvas — stale
    // overlays painting over the live one, their listeners pointed at a dead
    // view, and a leaked context every trip. Browsers cap live contexts, so
    // enough round trips eventually blacked the display out entirely.
    const roundTrip = await page.evaluate(async () => {
      const app = globalThis.__app;
      const before = app.tactical;
      for (const screen of ['bridge', 'tactical', 'crew', 'tactical', 'ship', 'tactical']) {
        app.go(screen);
        await new Promise((r) => setTimeout(r, 30));
      }
      return {
        overlays: document.querySelectorAll('canvas.tactical-labels').length,
        glCanvases: document.querySelectorAll('#tactical').length,
        same: app.tactical === before,
        lost: app.tactical?.renderer?.lost ?? null,
        drawCalls: app.tactical?.stats?.drawCalls ?? 0,
      };
    });
    check('returning to Tactical does not stack overlay canvases',
      roundTrip.overlays === 1, `${roundTrip.overlays} overlay canvas(es)`);
    check('returning to Tactical does not duplicate the GL canvas',
      roundTrip.glCanvases === 1, `${roundTrip.glCanvases}`);
    check('the tactical view is reused rather than rebuilt', roundTrip.same === true);
    check('the WebGL context survives six screen changes',
      roundTrip.lost === false, String(roundTrip.lost));
    check('the reused view is still drawing', roundTrip.drawCalls > 3, String(roundTrip.drawCalls));

    // ---- The main viewer ----
    //
    // Same renderer, same context, camera in a different place. Everything
    // worth checking here is a thing that cannot be checked in node: that the
    // camera really moves, that the picture is not black, that the budget
    // survives a second scene being drawn into the same frame, and above all
    // that opening the viewer does not mint a second WebGL context — which is
    // exactly the bug the round-trip checks above exist for.
    const viewer = await page.evaluate(async () => {
      const app = globalThis.__app;
      const before = app.tactical;
      const orbitEye = [...app.tactical.eye()];
      app.go('viewscreen');
      await new Promise((r) => setTimeout(r, 260));
      const v = app.tactical;
      const forwardEye = [...v.eye()];
      const dist = Math.hypot(
        orbitEye[0] - forwardEye[0], orbitEye[1] - forwardEye[1], orbitEye[2] - forwardEye[2]);
      return {
        same: v === before,
        mode: v.cameraMode,
        moved: dist,
        overlays: document.querySelectorAll('canvas.tactical-labels').length,
        glCanvases: document.querySelectorAll('#tactical').length,
        bezel: document.querySelectorAll('.viewscreen-bezel').length,
        drawCalls: v.stats.drawCalls,
        triangles: v.stats.triangles,
        lost: v.renderer?.lost ?? null,
      };
    });
    check('the viewer reuses the tactical renderer rather than making a second one',
      viewer.same === true);
    check('opening the viewer does not mint a second GL canvas',
      viewer.glCanvases === 1 && viewer.overlays === 1,
      `${viewer.glCanvases} canvas(es), ${viewer.overlays} overlay(s)`);
    check('the viewer puts the camera in forward mode', viewer.mode === 'forward', viewer.mode);
    check('the forward camera is somewhere else entirely', viewer.moved > 200,
      `${viewer.moved.toFixed(0)} units from the orbit camera`);
    check('the picture sits in a bezel', viewer.bezel === 1, String(viewer.bezel));
    check('the viewer is still drawing a real scene', viewer.drawCalls > 3, String(viewer.drawCalls));
    check('the viewer stays inside the triangle budget', viewer.triangles <= 8000,
      String(viewer.triangles));
    check('the viewer stays inside the draw-call budget', viewer.drawCalls <= 60,
      String(viewer.drawCalls));
    check('the WebGL context survives the camera change', viewer.lost === false, String(viewer.lost));

    const viewerShot = await page.screenshot({
      clip: await page.evaluate(() => {
        const r = document.getElementById('tactical').getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    });
    check('the viewer is not a black rectangle', viewerShot.length > 3000,
      `${viewerShot.length} bytes of PNG`);
    await page.screenshot({ path: join(SHOTS, '05b-viewscreen.png') });

    // Panning and magnifying are the two things the screen itself does, and
    // both are reachable by voice — "on screen", "magnify". Driving them
    // through the order line proves the parser, the dispatch and the camera
    // all agree, which three separate assertions would not.
    const panned = await page.evaluate(async () => {
      const app = globalThis.__app;
      const v = app.tactical;
      const yaw0 = v.look.targetYaw;
      v.panLook(0.4, 0.1);
      const yaw1 = v.look.targetYaw;
      v.centreLook();
      await new Promise((r) => setTimeout(r, 200));
      return { yaw0, yaw1, centred: Math.abs(v.look.targetYaw) < 0.05, mag: v.magnification };
    });
    check('the screen pans', Math.abs(panned.yaw1 - panned.yaw0) > 0.2,
      `${panned.yaw0.toFixed(2)} -> ${panned.yaw1.toFixed(2)}`);
    check('steady as she goes puts the screen back on the bow', panned.centred === true);

    const say = async (text) => {
      await page.fill('.orderbar input', text);
      await page.press('.orderbar input', 'Enter');
      await page.waitForTimeout(180);
      return page.evaluate(() => ({
        mag: globalThis.__app.tactical.magnification,
        screen: globalThis.__app.screen,
        mode: globalThis.__app.tactical.cameraMode,
      }));
    };
    const step = await say('magnify');
    const exact = await say('magnification factor five');
    const magnified = { after: step.mag, exact: exact.mag, screen: exact.screen };
    check('"magnify" zooms the viewer', magnified.after > 1.05, String(magnified.after));
    check('a spoken magnification factor is obeyed exactly',
      Math.abs(magnified.exact - 5) < 0.01, String(magnified.exact));

    // Back out, and the plot must be a plot again — a camera left in forward
    // mode on the tactical screen is a display with no overview at all.
    const backToPlot = await page.evaluate(async () => {
      globalThis.__app.go('tactical');
      await new Promise((r) => setTimeout(r, 200));
      const v = globalThis.__app.tactical;
      return { mode: v.cameraMode, mag: v.magnification, drawCalls: v.stats.drawCalls };
    });
    check('leaving the viewer returns the camera to the orbit plot',
      backToPlot.mode === 'orbit', backToPlot.mode);
    check('the plot is not left magnified', Math.abs(backToPlot.mag - 1) < 0.01,
      String(backToPlot.mag));
    check('the plot is still drawing after the round trip', backToPlot.drawCalls > 3,
      String(backToPlot.drawCalls));
  }
  await page.screenshot({ path: join(SHOTS, '05-combat.png') });

  // ---- The helm's eight warp switches ----
  //
  // Driven through the DOM rather than the model, because the point of the
  // switches is that they are a control on the bridge. A standing factor that
  // only a test can set is the same inert feature this replaces. That the
  // factor then reaches the course is asserted in tests/sim.test.js, where it
  // can be done without a live engagement in the way.
  await dismissModals(page);
  await nav(page, 'Bridge');
  const switches = await page.$$('.warp-switch');
  check('the console has eight warp switches', switches.length === 8, String(switches.length));
  if (switches.length === 8) {
    await page.click('.warp-switch:nth-child(3)');
    await page.waitForTimeout(150);
    const thrown = await page.evaluate(() => ({
      factor: globalThis.__app.game.warpFactor,
      lit: document.querySelectorAll('.warp-switch.on').length,
      litIndex: [...document.querySelectorAll('.warp-switch')]
        .findIndex((b) => b.classList.contains('on')),
    }));
    check('throwing a switch sets the standing warp factor', thrown.factor === 3,
      String(thrown.factor));
    check('exactly one switch is up at a time', thrown.lit === 1, String(thrown.lit));
    check('the switch that is up is the one that was thrown', thrown.litIndex === 2,
      String(thrown.litIndex));
  }
  // Scroll the chair into frame so the screenshot is of the switches rather
  // than of whatever happens to be at the top of the screen.
  await page.evaluate(() => document.querySelector('.chair-warp')
    ?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SHOTS, '02b-warp-switches.png') });
  // Put the run back where it was: everything after this expects the plot.
  await nav(page, 'Combat');

  // ---- Audio survives being backgrounded ----
  //
  // The actual bug behind "the sound effects are too quiet": a phone suspends
  // the AudioContext when the app goes to the background, `audio.unlock()` is
  // the only thing that resumes it, and the gesture listener that called it
  // removed itself after the first tap. So the game went permanently silent
  // the first time you looked at something else, with no way back but a
  // reload. Driven here rather than asserted, because the chain is
  // visibilitychange -> unlock -> ctx.resume and any link could be missing.
  await dismissModals(page);
  const resumed = await page.evaluate(async () => {
    const a = globalThis.__audio;
    if (!a?.ctx) return { error: 'audio never unlocked' };

    // Suspend it the way backgrounding does, then come back.
    await a.ctx.suspend();
    const suspended = a.ctx.state;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 250));
    return { suspended, after: a.ctx.state };
  });
  check('the audio context can be suspended and comes back',
    !resumed.error && resumed.suspended === 'suspended' && resumed.after === 'running',
    JSON.stringify(resumed));

  const stillPlays = await page.evaluate(async () => {
    const a = globalThis.__audio;
    const played = [];
    const real = a.play.bind(a);
    a.play = (n, o) => { played.push(n); return real(n, o); };
    a.play('red_alert');
    a.play = real;
    return { played, state: a.ctx?.state, enabled: a.enabled, ready: a.ready };
  });
  check('and cues still fire after coming back',
    stillPlays.played.includes('red_alert') && stillPlays.state === 'running' && stillPlays.ready,
    JSON.stringify(stillPlays));

  // The mixer must not ship quieter than its own ceiling.
  const mixer = await page.evaluate(() => {
    const a = globalThis.__audio;
    return { master: a.master?.gain?.value ?? null, makeup: a.makeup?.gain?.value ?? null };
  });
  check('the master runs at unity or better', mixer.master >= 1, JSON.stringify(mixer));
  check('the compressor has makeup gain', mixer.makeup > 1, JSON.stringify(mixer));

  // ---- The warp core breach is audible ----
  //
  // The most dramatic thing that can happen to the ship, and it happened in
  // silence: `core_breach_warning` was synthesised in sfx.js and played from
  // nowhere. Driven here rather than asserted, because the chain is
  // beginBreach -> emit -> listener -> audio, and any link could be missing.
  await dismissModals(page);
  const breach = await page.evaluate(async () => {
    const app = globalThis.__app;
    const played = [];
    // Record what the audio engine is asked for, without making noise.
    const audioMod = globalThis.__audio;
    const before = audioMod ? audioMod.play : null;
    if (audioMod) audioMod.play = (name, opts) => { played.push(name); };

    const ship = app.game.ship;
    ship.breaching = false;
    ship.coreEjected = false;
    ship.beginBreach(20);
    await new Promise((r) => setTimeout(r, 80));

    const observed = {
      breaching: ship.breaching,
      timer: ship.breachTimer,
      played,
      logged: app.game.log.slice(-3).map((l) => l.text ?? ''),
      audioReachable: !!audioMod,
    };

    // Put her back. A breach left running destroys the ship twenty seconds
    // later and ends the commission, which would take every check after this
    // one down with it.
    if (audioMod && before) audioMod.play = before;
    ship.breaching = false;
    ship.breachTimer = 0;
    return observed;
  });
  check('a warp core breach starts a real countdown',
    breach.breaching === true && breach.timer > 0, JSON.stringify({ b: breach.breaching, t: breach.timer }));
  check('the breach tells the crew what to do',
    breach.logged.some((l) => /eject the core/i.test(l)), JSON.stringify(breach.logged));
  if (breach.audioReachable) {
    check('the breach sounds the warning tone',
      breach.played.includes('core_breach_warning'), JSON.stringify(breach.played));
  } else {
    notes.push('  SKIP  audio module not exposed for the breach-cue check');
  }

  // ---- The third axis ----
  //
  // The 3D rewrite's headline feature had no player control of any kind:
  // `setPitch` existed in the Engagement API and was called from nowhere in the
  // UI or the command layer, while the enemy AI used elevation tactically
  // against you. Both routes are checked here — the button and the typed order —
  // because either one alone would leave the axis half-reachable.
  await dismissModals(page);
  const climbed = await page.evaluate(async () => {
    const app = globalThis.__app;
    const before = app.game.ship.desiredPitch;
    const btn = [...document.querySelectorAll('.btn')]
      .find((b) => /^climb$/i.test(b.textContent.trim()));
    if (!btn) return { error: 'no Climb control on the tactical screen' };
    btn.click();
    await new Promise((r) => setTimeout(r, 60));
    return { before, after: app.game.ship.desiredPitch };
  });
  check('the tactical screen can order a climb',
    !climbed.error && climbed.after > climbed.before, JSON.stringify(climbed));

  const levelled = await page.evaluate(async () => {
    const app = globalThis.__app;
    const btn = [...document.querySelectorAll('.btn')]
      .find((b) => /^level$/i.test(b.textContent.trim()));
    if (!btn) return { error: 'no Level control' };
    btn.click();
    await new Promise((r) => setTimeout(r, 60));
    return { pitch: app.game.ship.desiredPitch };
  });
  check('levelling off is a control too', levelled.pitch === 0, JSON.stringify(levelled));

  // ---- Typed orders, through the real input box ----
  //
  // Everything below this point in the file drives the app object directly.
  // This block does not: it types into the order line and presses the button,
  // because the whole claim of the command layer is that what you type becomes
  // what the ship does, and that claim is only tested end to end.
  const typeOrder = async (text) => {
    await dismissModals(page);
    await page.fill('.orderbar input', text);
    await page.click('.orderbar button.send');
    await page.waitForTimeout(120);
  };

  await typeOrder('helm, take us down');
  const dived = await page.evaluate(() => globalThis.__app.game.ship.desiredPitch);
  check('a typed elevation order reaches the helm', dived < 0, `desiredPitch ${dived}`);

  await typeOrder('level off');
  const levelledByOrder = await page.evaluate(() => globalThis.__app.game.ship.desiredPitch);
  check('and levelling off is a typed order as well', levelledByOrder === 0, String(levelledByOrder));

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

  // ------------------------------------------------ the machine shop
  await nav(page, 'Ship');
  const shop = await page.evaluate(async () => {
    const g = globalThis.__app.game;
    g.ship.hull = g.ship.maxHull * 0.5;
    g.stores.duranium = 99;
    globalThis.__app.render();
    await new Promise((r) => setTimeout(r, 60));
    const before = g.stores.duranium;
    const btn = [...document.querySelectorAll('.btn')].find((b) => b.textContent.includes('Hull patch'));
    btn?.click();
    await new Promise((r) => setTimeout(r, 80));
    return {
      rendered: !!btn,
      started: !!g.fabricationStatus,
      spent: g.stores.duranium < before,
    };
  });
  check('the machine shop offers work the ship can actually do', shop.rendered,
    JSON.stringify(shop));
  check('starting a job spends the materials', shop.started && shop.spent, JSON.stringify(shop));

  // A trap has no combat option and every way out actually works.
  const trapped = await page.evaluate(async () => {
    const { TRAPS } = await import('./src/world/encounters.js');
    const g = globalThis.__app.game;
    g.encounter = { kind: 'trapped', trap: TRAPS[0], title: TRAPS[0].title, text: TRAPS[0].text };
    g.mode = 'encounter';
    globalThis.__app.go('encounter');
    await new Promise((r) => setTimeout(r, 120));
    const labels = [...document.querySelectorAll('.btn')].map((b) => b.textContent);
    const out = [...document.querySelectorAll('.btn')].find((b) => b.textContent.includes('Ride it out'));
    out?.click();
    await new Promise((r) => setTimeout(r, 120));
    return {
      offeredNoFight: !labels.some((l) => /^Engage/.test(l)),
      hadAWayOut: !!out,
      escaped: g.encounter === null,
    };
  });
  check('a trap offers no way to shoot out of it', trapped.offeredNoFight, JSON.stringify(trapped));
  check('riding out a trap actually gets you out', trapped.hadAWayOut && trapped.escaped,
    JSON.stringify(trapped));
  await dismissModals(page);

  // ------------------------------------------------ the Kobayashi Maru
  await nav(page, 'Record');
  const km = await page.evaluate(async () => {
    const g = globalThis.__app.game;
    const locked = g.gambit;
    // A green captain must be refused, and told both reasons.
    const refused = g.forceChannel();

    // Now give them the career the technique actually costs.
    g.reputation.tracks.klingon.tier = 5;
    for (let i = 0; i < 4; i++) g.ledger.record('ship_destroyed_hostile');
    for (let i = 0; i < 3; i++) g.ledger.record('ship_spared');
    const allowed = g.forceChannel();

    // With the channel open, the order line is not an order line.
    const outcome = g.makeAppeal(
      'This is Captain Okafor. You know my record. I spared three of your '
      + 'crews. There are civilians aboard. Withdraw and we take them off together.');

    return {
      startsLocked: locked.unlocked === false,
      reasonsGiven: locked.reasons.length,
      refused: refused.ok === false,
      allowed: allowed.ok === true,
      won: outcome.success,
      recorded: (g.ledger.counters.kobayashi_maru_solved ?? 0) === 1,
    };
  });
  check('the Kobayashi Maru technique starts locked', km.startsLocked);
  check('and says both of the reasons why', km.reasonsGiven === 2, String(km.reasonsGiven));
  check('a green captain cannot force the channel', km.refused);
  check('an earned reputation can', km.allowed);
  check('what you type is judged against your record', km.won && km.recorded,
    JSON.stringify(km));
  await dismissModals(page);

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
    if (!raw) return { ok: false };
    // Records are written as { sum, body } so a half-written save can be
    // detected rather than handed to the game as if it were sound.
    const outer = JSON.parse(raw);
    const hasChecksum = typeof outer.sum === 'string' && typeof outer.body === 'string';
    const data = hasChecksum ? JSON.parse(outer.body) : outer;
    return {
      ok: !!(data.seed && data.ship && data.ledger),
      hasChecksum,
      hasCommission: !!data.campaign,
    };
  });
  check('the command record saves to storage', savedOk.ok);
  check('the command record is checksummed', savedOk.hasChecksum);
  check('the commission clock is saved with it', savedOk.hasCommission);

  // A five-year commission must survive a corrupted autosave.
  const recovered = await page.evaluate(async () => {
    const { loadSave } = await import('./src/core/save.js');
    // Force a backup to exist, then corrupt the primary record.
    globalThis.__app.save();
    globalThis.__app.save();
    localStorage.setItem('sfc:save:auto', '{"sum":"deadbeef","body":"{\"seed\":\"1\"}"}');
    const r = loadSave('auto');
    return { got: !!r, fromBackup: r?.recoveredFromBackup ?? null, seed: r?.seed ?? null };
  });
  check('a corrupted record falls back to a backup rather than a blank bridge',
    recovered.got && recovered.fromBackup !== null, JSON.stringify(recovered));

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
