// The offline promise, checked without a browser.
//
// This file exists because of a specific failure. Seven modules were added in
// one commit and none of them was added to the service worker's precache list.
// Every unit test passed. The game worked perfectly in a browser. It only broke
// with the network off — which is the single thing this project promises — and
// it took a CI browser job several minutes in to notice.
//
// A hand-maintained list of fifty paths will drift. So it is checked here, in
// the fast job, against the actual contents of src/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every .js file under src/, as the './src/...' paths the worker uses. */
function sourceModules(dir = join(ROOT, 'src'), out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceModules(full, out);
    else if (name.endsWith('.js')) out.push(`./${relative(ROOT, full).split('\\').join('/')}`);
  }
  return out;
}

const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const precache = [...sw.matchAll(/'(\.\/[^']*)'/g)].map((m) => m[1]);

test('every source module is precached', () => {
  const missing = sourceModules().filter((m) => !precache.includes(m));
  assert.deepEqual(missing, [],
    `these modules would 503 with the network off — add them to PRECACHE in sw.js:\n  ${missing.join('\n  ')}`);
});

test('the precache list names nothing that does not exist', () => {
  const stale = precache
    .filter((p) => p.startsWith('./src/'))
    .filter((p) => {
      try { return !statSync(join(ROOT, p)).isFile(); } catch { return true; }
    });
  assert.deepEqual(stale, [], `precached paths that no longer exist: ${stale.join(', ')}`);
});

test('the stylesheet and entry point are precached', () => {
  for (const required of ['./index.html', './src/main.js', './src/styles/lcars.css', './']) {
    assert.ok(precache.includes(required), `${required} is not precached`);
  }
});

test('the cache version changes when the file list does', () => {
  // Not enforceable mechanically, but the version must at least exist and be
  // versioned — an unchanged VERSION means returning users keep the old cache
  // and never receive the modules that were just added.
  const version = sw.match(/const VERSION = '([^']+)'/)?.[1];
  assert.ok(version, 'the service worker has no cache version');
  assert.match(version, /v\d+$/, `cache version "${version}" is not numbered`);
});

test('the service worker itself makes no external requests', () => {
  const urls = [...sw.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0]);
  assert.deepEqual(urls, [], `the service worker references ${urls.join(', ')}`);
});
