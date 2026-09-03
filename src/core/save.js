// Persistence. localStorage for autosave and slots, plus export/import so a
// captain's record can be moved off the phone.
//
// This file matters more than it used to. A commission now runs five years of
// real time, and a save that survives a weekend is not the same thing as a save
// that survives five years of browser updates, storage pressure, a phone
// running out of space mid-write, and whatever else happens in that span.
//
// So: a checksum on every write, a rolling ring of the last few autosaves, and
// a load path that falls back through the ring rather than presenting a blank
// bridge. None of it is clever. All of it is the difference between losing an
// afternoon and losing a year.

const KEY_PREFIX = 'sfc:save:';
const AUTOSAVE_KEY = `${KEY_PREFIX}auto`;
const BACKUP_PREFIX = `${KEY_PREFIX}backup:`;
const SETTINGS_KEY = 'sfc:settings';
const SLOTS = 3;

/** How many previous autosaves to keep. Small — this is a phone. */
export const BACKUP_DEPTH = 3;

/**
 * A cheap, stable checksum over the serialised record.
 *
 * FNV-1a: not cryptographic and not trying to be. Its job is to notice a
 * truncated or half-written record — the thing that actually happens when
 * storage fills up mid-write — before that record is handed to the game as if
 * it were sound.
 */
export function checksum(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

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
  const key = slot === 'auto' ? AUTOSAVE_KEY : `${KEY_PREFIX}${slot}`;
  try {
    const payload = {
      ...game.save(),
      savedAt: new Date().toISOString(),
      label: `${game.captain.name} — ${game.ship.name} — Stardate ${game.stardate}`,
    };
    const body = JSON.stringify(payload);
    const record = JSON.stringify({ sum: checksum(body), body });

    // Rotate the previous autosave into the backup ring before overwriting it.
    // The write that destroys a five-year commission is the one that happens
    // while the storage quota is exhausted, and by then the old record is
    // already gone.
    if (slot === 'auto') rotateBackups(store, store.getItem(key));

    store.setItem(key, record);
    return true;
  } catch (err) {
    console.warn('[save] failed', err);
    return false;
  }
}

/** Push the current autosave down the ring, dropping the oldest. */
function rotateBackups(store, current) {
  if (!current) return;
  try {
    for (let i = BACKUP_DEPTH - 1; i >= 1; i--) {
      const older = store.getItem(`${BACKUP_PREFIX}${i}`);
      if (older) store.setItem(`${BACKUP_PREFIX}${i + 1}`, older);
    }
    store.setItem(`${BACKUP_PREFIX}1`, current);
  } catch {
    // A full quota is exactly when this fails, and exactly when the new write
    // matters more than the old backup. Losing a backup is survivable.
  }
}

/**
 * Read one stored record, verifying its checksum.
 * @returns {object|null} null when absent, unparseable, or corrupt
 */
function readRecord(store, key) {
  const raw = store.getItem(key);
  if (!raw) return null;
  try {
    const outer = JSON.parse(raw);
    // Records written before checksums existed are plain payloads, and are
    // still perfectly good. Trust them; there is nothing to check against.
    //
    // But "is not shaped like a checksummed record" is not the same as "is a
    // save", and treating it as such defeated the entire backup ring: an
    // autosave corrupted into any valid JSON — `{"hello":"world"}`, `[]`, a
    // bare number — sailed through here, so loadSave returned the junk instead
    // of walking back through the backups. main.js catches the Game.load
    // failure that follows and offers a new commission, with three good
    // backups sitting unused. That is precisely the blank bridge this file
    // exists to prevent.
    if (typeof outer?.body !== 'string') {
      return looksLikeSave(outer) ? outer : null;
    }
    if (checksum(outer.body) !== outer.sum) {
      console.warn('[save] checksum mismatch — record is corrupt');
      return null;
    }
    const payload = JSON.parse(outer.body);
    return looksLikeSave(payload) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Is this actually a command record?
 *
 * Deliberately the weakest test that is still worth anything: a seed, which is
 * the very first thing Game.load reads and the one field no save of any version
 * has ever been without. Anything stricter would reject old saves this file has
 * always promised to keep loading.
 */
function looksLikeSave(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  return payload.seed !== undefined && payload.seed !== null;
}

export function loadSave(slot = 'auto') {
  const store = storage();
  if (!store) return null;
  const key = slot === 'auto' ? AUTOSAVE_KEY : `${KEY_PREFIX}${slot}`;
  const primary = readRecord(store, key);
  if (primary) return primary;

  // The autosave is unreadable. Walk back through the ring rather than
  // presenting a blank bridge to somebody four years into a commission.
  if (slot !== 'auto') return null;
  for (let i = 1; i <= BACKUP_DEPTH; i++) {
    const backup = readRecord(store, `${BACKUP_PREFIX}${i}`);
    if (backup) {
      console.warn(`[save] recovered from backup ${i}`);
      backup.recoveredFromBackup = i;
      return backup;
    }
  }
  return null;
}

/** What is in the backup ring, for the Options screen. */
export function listBackups() {
  const store = storage();
  if (!store) return [];
  const out = [];
  for (let i = 1; i <= BACKUP_DEPTH; i++) {
    const b = readRecord(store, `${BACKUP_PREFIX}${i}`);
    if (b) out.push({ index: i, label: b.label, savedAt: b.savedAt });
  }
  return out;
}

export function hasSave(slot = 'auto') {
  return loadSave(slot) !== null;
}

export function deleteSave(slot = 'auto') {
  const store = storage();
  if (!store) return;
  store.removeItem(slot === 'auto' ? AUTOSAVE_KEY : `${KEY_PREFIX}${slot}`);
  if (slot === 'auto') {
    for (let i = 1; i <= BACKUP_DEPTH; i++) store.removeItem(`${BACKUP_PREFIX}${i}`);
  }
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
  // Unity across the board. These used to default below 1.0 against a slider
  // that stopped at 1.0, so the shipped mix was quieter than its own ceiling
  // and no amount of dragging could recover it.
  master: 1.0, sfx: 1.0, ui: 1.0, ambience: 0.8, alert: 1.0,
  muted: false,
  voice: true, haptics: true, autoFire: true, wakeLock: true,
  textSize: 'normal', reduceMotion: false, orders: 'both',
  // Three dimensions, when the device can.
  //
  // This existed as a read in main.js and nothing else: not a default, not a
  // control, never written. `undefined === false` is false, so the 3D path was
  // always taken and the 2D view — the display this game shipped with — was
  // reachable only by a real WebGL failure, which meant it was also never
  // exercised by anything. A seam nobody can move is not a seam.
  render3d: true,
  // The commission runs in real time. This is the escape hatch, and it is
  // labelled honestly in Options for what it forfeits.
  compression: 1,
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
