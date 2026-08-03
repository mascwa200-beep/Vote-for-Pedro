// Persistence. localStorage for autosave and slots, plus export/import so a
// captain's record can be moved off the phone.

const KEY_PREFIX = 'sfc:save:';
const AUTOSAVE_KEY = `${KEY_PREFIX}auto`;
const SETTINGS_KEY = 'sfc:settings';
const SLOTS = 3;

function storage() {
  try {
    const s = globalThis.localStorage;
    // Probe: private modes throw only on write.
    s?.setItem('sfc:probe', '1');
    s?.removeItem('sfc:probe');
    return s;
  } catch {
    return null;
  }
}

export function saveGame(game, slot = 'auto') {
  const store = storage();
  if (!store) return false;
  try {
    const payload = {
      ...game.save(),
      savedAt: new Date().toISOString(),
      label: `${game.captain.name} — ${game.ship.name} — Stardate ${game.stardate}`,
    };
    store.setItem(slot === 'auto' ? AUTOSAVE_KEY : `${KEY_PREFIX}${slot}`, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.warn('[save] failed', err);
    return false;
  }
}

export function loadSave(slot = 'auto') {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(slot === 'auto' ? AUTOSAVE_KEY : `${KEY_PREFIX}${slot}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function hasSave(slot = 'auto') {
  return loadSave(slot) !== null;
}

export function deleteSave(slot = 'auto') {
  const store = storage();
  if (!store) return;
  store.removeItem(slot === 'auto' ? AUTOSAVE_KEY : `${KEY_PREFIX}${slot}`);
}

export function listSaves() {
  const out = [];
  const auto = loadSave('auto');
  if (auto) out.push({ slot: 'auto', label: auto.label, savedAt: auto.savedAt });
  for (let i = 1; i <= SLOTS; i++) {
    const s = loadSave(i);
    if (s) out.push({ slot: i, label: s.label, savedAt: s.savedAt });
  }
  return out;
}

// ---------------- export / import ----------------

export function exportSave(game) {
  return JSON.stringify(game.save(), null, 2);
}

export function downloadSave(game) {
  const blob = new Blob([exportSave(game)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `starfleet-${game.captain.name.toLowerCase()}-sd${game.stardate}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function importSave(text) {
  const data = JSON.parse(text);
  if (!data.version || !data.seed) throw new Error('Not a valid command record.');
  return data;
}

// ---------------- settings ----------------

const DEFAULT_SETTINGS = {
  master: 0.8, sfx: 1.0, ui: 0.9, ambience: 0.7, alert: 0.9,
  voice: true, haptics: true, autoFire: true, wakeLock: true,
  textSize: 'normal', reduceMotion: false, orders: 'both',
};

export function loadSettings() {
  const store = storage();
  if (!store) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(store.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* full or blocked; settings are not worth failing over */ }
}

export { DEFAULT_SETTINGS };
