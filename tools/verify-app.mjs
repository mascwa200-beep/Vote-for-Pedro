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
import { mkdirSync, existsSync } from 'node:fs';
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

  // New-captain screen (no prior save in a fresh context).
  await page.waitForSelector('text=Starfleet Personnel File', { timeout: 5000 });
  check('captain creation is shown', true);
  await page.screenshot({ path: join(SHOTS, '01-new-captain.png') });

  // Choose an original crew to exercise the generator, and pin the world seed
  // so every run of this harness plays out identically.
  await page.click('text=Original crew');
  await page.fill('.field input[placeholder*="blank"]', 'verification-1701');
  await page.click('text=Assume command');
  await page.waitForTimeout(600);

  // Dismiss the opening briefing modal.
  const ack = page.locator('.modal .btn').first();
  if (await ack.count()) await ack.click();
  await page.waitForTimeout(400);

  check('game state exists', await page.evaluate(() => !!globalThis.__app?.game));
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
    await page.click('.nav button:has-text("Map")');
    await page.waitForTimeout(400);
    check('the map is reachable with a contact pending',
      await page.locator('#galaxy').isVisible());
    await page.click('.nav button:has-text("Bridge")');
    await page.waitForTimeout(300);
    check('the bridge returns to the pending contact',
      await page.evaluate(() => !!document.querySelector('.panel')));
    await page.evaluate(() => { globalThis.__app.game.endEncounter(); globalThis.__app.render(); });
    await page.waitForTimeout(400);
  }
  const stray = page.locator('.modal .btn').first();
  if (await stray.count()) { await stray.click(); await page.waitForTimeout(300); }

  // ------------------------------------------------ galaxy map
  await page.click('.nav button:has-text("Map")');
  await page.waitForTimeout(600);
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

  const tacticalDrawn = await page.evaluate(() => {
    const c = document.getElementById('tactical');
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 8) lit++;
    return lit;
  });
  check('the tactical view actually draws pixels', tacticalDrawn > 50, `lit samples: ${tacticalDrawn}`);
  await page.screenshot({ path: join(SHOTS, '05-combat.png') });

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
  const stray2 = page.locator('.modal .btn').first();
  if (await stray2.count()) { await stray2.click(); await page.waitForTimeout(300); }

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
  for (const [nav, shot] of [['Ship', '06-ship'], ['Crew', '07-crew'], ['Record', '08-record']]) {
    const modalBtn = page.locator('.modal .btn').first();
    if (await modalBtn.count()) await modalBtn.click();
    await page.click(`.nav button:has-text("${nav}")`);
    await page.waitForTimeout(500);
    check(`${nav} screen renders`, (await page.locator('.panel').count()) > 0);
    await page.screenshot({ path: join(SHOTS, `${shot}.png`) });
  }

  // Spend a skill point through the real UI.
  await page.click('.nav button:has-text("Record")');
  await page.waitForTimeout(300);
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
    const page2 = await context.newPage();
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
      const seedField = document.querySelector('.field input[placeholder*="blank"]');
      if (seedField) {
        seedField.value = 'bundle-check';
        seedField.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const start = [...document.querySelectorAll('.btn')]
        .find((b) => b.textContent.includes('Assume command'));
      if (!start) return { error: 'no start button' };
      start.click();
      if (!app.game) return { error: 'no game after start' };
      app.executeOrder({ action: 'alert', level: 'red' }, 'red alert');
      const r = app.game.setCourse('vulcan', 8);
      return {
        alert: app.game.alert,
        courseOk: r.ok,
        crew: app.game.crew.living.length,
        systems: app.game.galaxy.systems.length,
        episodes: app.game.missions.episodes.length,
      };
    });
    check('the single-file build is fully playable',
      bundlePlayable.alert === 'red' && bundlePlayable.courseOk
        && bundlePlayable.crew >= 6 && bundlePlayable.systems > 20,
      JSON.stringify(bundlePlayable));
    check('no errors in the single-file build', errs2.length === 0, errs2.slice(0, 3).join(' | '));
    await page2.screenshot({ path: join(SHOTS, '11-single-file.png') });
    await page2.close();
  } else {
    notes.push('  SKIP  single-file build not present (run: npm run build)');
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
