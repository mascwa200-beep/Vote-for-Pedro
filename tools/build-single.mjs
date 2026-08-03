// Bundles the whole game into one self-contained HTML file.
//
// The multi-file PWA is the primary artefact; this exists so the game can also
// be copied to a phone's Downloads folder and opened straight from Files, with
// no server and no install. Because there are no assets, "bundling" is just
// concatenating modules in dependency order and rewriting the imports.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'src', 'main.js');
const OUT_DIR = join(ROOT, 'dist');
const OUT = join(OUT_DIR, 'starfleet-command.html');

// ---------------------------------------------------------------- module graph

const modules = new Map();   // absolute path -> { source, deps, order }
const order = [];

// Import/export statements are matched across newlines: the codebase wraps
// long binding lists, and a line-anchored pattern silently skips those.
const IMPORT_RE = /\bimport\s+(?:([\s\S]+?)\s+from\s+)?['"](\.[^'"]+)['"]\s*;?/g;
const EXPORT_FROM_RE = /\bexport\s+\{([\s\S]*?)\}\s+from\s+['"](\.[^'"]+)['"]\s*;?/g;
const EXPORT_NAMED_RE = /\bexport\s+\{([\s\S]*?)\}\s*;?/g;

async function collect(path) {
  const abs = resolve(path);
  if (modules.has(abs)) return;
  modules.set(abs, null); // placeholder guards against import cycles

  const source = await readFile(abs, 'utf8');
  const deps = [];
  for (const re of [IMPORT_RE, EXPORT_FROM_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      deps.push(resolve(dirname(abs), m[2]));
    }
  }

  for (const dep of deps) await collect(dep);

  modules.set(abs, { source, deps });
  order.push(abs);
}

await collect(ENTRY);

// ---------------------------------------------------------------- rewrite

/**
 * Each module becomes an IIFE registered in a tiny registry, and its
 * import/export statements are rewritten into registry calls. This keeps
 * module scoping intact — no name collisions between forty files.
 */
function moduleId(abs) {
  return relative(ROOT, abs).replace(/\\/g, '/');
}

function transform(abs, source) {
  let out = source;

  // `export { a, b } from './x.js'`  ->  re-export
  out = out.replace(EXPORT_FROM_RE, (_m, names, spec) => {
    const dep = moduleId(resolve(dirname(abs), spec));
    const list = names.split(',').map((s) => s.trim()).filter(Boolean);
    const lines = list.map((entry) => {
      const [orig, alias = orig] = entry.split(/\s+as\s+/).map((s) => s.trim());
      return `__exports.${alias} = __require(${JSON.stringify(dep)}).${orig};`;
    });
    return lines.join('\n');
  });

  // `import ... from './x.js'`
  out = out.replace(IMPORT_RE, (_m, clause, spec) => {
    const dep = moduleId(resolve(dirname(abs), spec));
    const req = `__require(${JSON.stringify(dep)})`;
    if (!clause) return `${req};`;

    const parts = [];
    const trimmed = clause.trim();

    // Namespace: `* as ns`
    const ns = trimmed.match(/^\*\s+as\s+(\w+)$/);
    if (ns) return `const ${ns[1]} = ${req};`;

    // Split default and named portions.
    const braceStart = trimmed.indexOf('{');
    const defaultPart = (braceStart === -1 ? trimmed : trimmed.slice(0, braceStart))
      .replace(/,\s*$/, '').trim();
    if (defaultPart) parts.push(`const ${defaultPart} = ${req}.default;`);

    if (braceStart !== -1) {
      const named = trimmed.slice(braceStart + 1, trimmed.lastIndexOf('}'));
      const bindings = named.split(',').map((s) => s.trim()).filter(Boolean)
        .map((entry) => {
          const [orig, alias = orig] = entry.split(/\s+as\s+/).map((s) => s.trim());
          return orig === alias ? orig : `${orig}: ${alias}`;
        });
      if (bindings.length) parts.push(`const { ${bindings.join(', ')} } = ${req};`);
    }
    return parts.join('\n');
  });

  // `export const/function/class/let/var X`
  out = out.replace(/^\s*export\s+(const|let|var|function\*?|class|async function\*?)\s+([A-Za-z_$][\w$]*)/gm,
    (_m, kind, name) => `${kind} ${name}`);

  // `export default X`
  out = out.replace(/^\s*export\s+default\s+/gm, '__exports.default = ');

  // Collect the names that were exported so they can be attached at the end.
  const exported = new Set();
  for (const m of source.matchAll(/^\s*export\s+(?:const|let|var|function\*?|class|async function\*?)\s+([A-Za-z_$][\w$]*)/gm)) {
    exported.add(m[1]);
  }

  // `export { a, b as c }` (the from-form was already rewritten above)
  EXPORT_NAMED_RE.lastIndex = 0;
  out = out.replace(EXPORT_NAMED_RE, (_m, names) => {
    const lines = [];
    for (const entry of names.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [orig, alias = orig] = entry.split(/\s+as\s+/).map((s) => s.trim());
      lines.push(`__exports.${alias} = ${orig};`);
    }
    return lines.join('\n');
  });

  const tail = [...exported].map((n) => `__exports.${n} = ${n};`).join('\n');
  return `${out}\n${tail}\n`;
}

const bundled = order.map((abs) => {
  const { source } = modules.get(abs);
  return `__define(${JSON.stringify(moduleId(abs))}, function (__exports, __require) {\n${transform(abs, source)}\n});`;
}).join('\n\n');

const RUNTIME = `
(function () {
  'use strict';
  var __registry = {};
  var __cache = {};
  function __define(id, fn) { __registry[id] = fn; }
  function __require(id) {
    if (__cache[id]) return __cache[id];
    var fn = __registry[id];
    if (!fn) throw new Error('Module not found in bundle: ' + id);
    var exports = {};
    __cache[id] = exports;      // set before running, so cycles resolve
    fn(exports, __require);
    return exports;
  }
`;

const css = await readFile(join(ROOT, 'src', 'styles', 'lcars.css'), 'utf8');
const icon = await readFile(join(ROOT, 'assets', 'icons', 'icon.svg'), 'utf8');
const iconData = `data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#000000">
<meta name="color-scheme" content="dark">
<meta name="description" content="An offline Starfleet command simulator. Command a starship, give real orders, and live with the consequences.">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Starfleet Command">
<title>Starfleet Command</title>
<link rel="icon" href="${iconData}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${iconData}">
<style>
${css}
</style>
</head>
<body>
<div id="app"></div>
<noscript>
  <p style="color:#ffcc99;padding:24px;font-family:system-ui,sans-serif">
    This simulator runs entirely in your browser and needs JavaScript enabled.
  </p>
</noscript>
<script>
${RUNTIME}
${bundled}

  __require(${JSON.stringify(moduleId(ENTRY))});
})();
</script>
</body>
</html>
`;

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT, html);

const kb = (html.length / 1024).toFixed(1);
console.log(`Bundled ${order.length} modules -> ${relative(ROOT, OUT)} (${kb} KB, no external requests)`);
