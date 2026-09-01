// Service worker: makes the game work with the radio off, permanently.
//
// The whole app is code and markup — no audio files, no textures, no fonts to
// fetch. Precaching it is a few tens of kilobytes, so the install is instant
// and every later launch is served from disk without touching the network.
//
// The list below must name every module the app imports. A missing entry does
// not fail loudly: the game keeps working online, and only stops working with
// the radio off — which is the one thing this project promises. `tests/
// offline.test.js` therefore walks src/ and fails if anything here is missing,
// because a hand-maintained list of forty-odd paths will otherwise drift, and
// drifted silently the first time a directory was added.

const VERSION = 'sfc-v9';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './src/main.js',
  './src/styles/lcars.css',
  './src/core/num.js',
  './src/core/rng.js',
  './src/core/events.js',
  './src/core/time.js',
  './src/core/ledger.js',
  './src/core/state.js',
  './src/core/save.js',
  './src/sim/power.js',
  './src/sim/ship.js',
  './src/sim/combat.js',
  './src/sim/ai.js',
  './src/sim/officers.js',
  './src/sim/skills.js',
  './src/sim/loadout.js',
  './src/sim/away.js',
  './src/sim/diplomacy.js',
  './src/world/factions.data.js',
  './src/world/systems.data.js',
  './src/world/ships.data.js',
  './src/world/crews.data.js',
  './src/world/galaxy.js',
  './src/world/orbit.js',
  './src/world/surface.js',
  './src/world/encounters.js',
  './src/missions/engine.js',
  './src/missions/episodes/index.js',
  './src/missions/episodes/core.js',
  './src/missions/episodes/frontier.js',
  './src/audio/synth.js',
  './src/audio/sfx.js',
  './src/audio/engine.js',
  './src/ui/lcars.js',
  './src/ui/touch.js',
  './src/ui/tactical.js',
  './src/ui/galaxymap.js',
  './src/ui/screens.js',
  './src/ui/orders.js',
  './src/ui/charscreens.js',
  './src/rules/dice.js',
  './src/rules/character.js',
  './src/rules/reputation.js',
  './src/rules/difficulty.js',
  './src/rules/resolve.js',
  './src/campaign/clock.js',
  './src/sim/fabrication.js',
  './src/missions/kobayashi.js',
  './src/lang/normalize.js',
  './src/lang/phonetic.js',
  './src/lang/fuzzy.js',
  './src/lang/gazetteer.js',
  './src/lang/lexicon.js',
  './src/lang/parse.js',
  './src/ui/chair.js',
  './src/ui/tactical3d.js',
  './src/gfx/math.js',
  './src/gfx/mesh.js',
  './src/gfx/gl.js',
  './src/gfx/blueprint.js',
  './src/gfx/forms.federation.js',
  './src/gfx/scene.js',
  './src/gfx/vista.js',
  './src/gfx/room.js',
  './src/ui/firstperson.js',
  './src/sim/invariants.js',
  './src/sim/walk.js',
  './src/sim/watch.js',
  './src/sim/address.js',
  './src/world/interiors.data.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Add individually so one bad path cannot fail the whole install.
    await Promise.all(PRECACHE.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) {
      // Refresh in the background so an update lands on the next launch,
      // but never make the user wait on the network to play.
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) (await caches.open(VERSION)).put(request, fresh.clone());
        } catch { /* offline: the cached copy is the point */ }
      })());
      return cached;
    }

    try {
      const response = await fetch(request);
      if (response.ok) (await caches.open(VERSION)).put(request, response.clone());
      return response;
    } catch {
      // Navigation requests fall back to the app shell so a deep link still
      // opens the game rather than a browser error page.
      if (request.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
