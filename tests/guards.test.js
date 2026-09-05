// Guards that agree with themselves, and four things that are clean.
//
// Two PRs running turned up a check that passed for the wrong reason:
//
//   §51  "every sound cue is reachable" matched any quoted occurrence in the
//        UI sources, and `ui/tactical.js` has `case 'cloak':` / `case
//        'decloak':`. Both cues were synthesised, played by nothing, and
//        passed for four hundred lines.
//   §52  "every station opens a console or answers with a report" harvested
//        `case '<id>':` labels out of `openConsole`, and `case 'turbolift':`
//        sat above `default:` sharing its branch. The one station in the
//        turbolift answered "Working, Captain."
//
// Same failure twice: a check satisfied by the SHAPE OF THE SOURCE rather than
// by what it does. This file is the sweep that followed, and most of it is
// negatives — which is what a low-yield pass is supposed to look like.
//
//     case labels sharing `default:`   4 found, all 4 legitimate    clean
//     the reputation-perk guard        loose; answer held           tightened
//     encounter kinds                  10 kinds, 1,309 choices      clean
//     ASSIGNMENTS fields               11 of 11 read                clean
//     absenceReport fields             6 of 6 supplied              clean

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

import { Game } from '../src/core/state.js';
import { rollEncounter } from '../src/world/encounters.js';
import { SYSTEMS } from '../src/world/systems.data.js';
import { ASSIGNMENTS } from '../src/sim/duty.js';

/** Every .js file under src/. */
function sources() {
  const out = [];
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) out.push(p);
    }
  })('src');
  return out;
}

describe('a case label is not a handler', () => {
  test('nothing quietly shares the default branch except the four that should', () => {
    // The §52 defect, as a standing check. A label with no body of its own is
    // either grouped with the NEXT case — normal, and five do it — or grouped
    // with `default:`, which means a handler that looks present to every source
    // scrape and does nothing specific.
    //
    // Four are legitimate, and each is legitimate for the same reason: the
    // labelled value genuinely IS the default behaviour.
    const ALLOWED = new Map([
      ["src/core/state.js:'withdraw'", 'withdrawing is what happens when nothing else does'],
      ["src/main.js:'bridge'", 'the bridge is the default screen'],
      ["src/sim/diplomacy.js:'identify'", 'identifying yourself is the neutral hail'],
      ["src/world/encounters.js:'anomaly'", 'buildAnomaly is the fallback build'],
    ]);

    let labels = 0;
    let grouped = 0;
    const intoDefault = [];
    for (const f of sources()) {
      const lines = readFileSync(f, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^\s*case\s+(['"`][^'"`]*['"`]|[A-Za-z0-9_.]+)\s*:\s*$/);
        if (!m) continue;
        labels++;
        let j = i + 1;
        while (j < lines.length && (!lines[j].trim() || /^\s*(\/\/|\/\*|\*)/.test(lines[j]))) j++;
        const next = lines[j] ?? '';
        if (/^\s*case\s/.test(next)) { grouped++; continue; }
        if (/^\s*default\s*:/.test(next)) intoDefault.push(`${f}:${m[1]}`);
      }
    }

    // The denominator, first. A regex that harvests nothing would otherwise
    // report a clean sweep having examined no code at all — which is the
    // mistake this whole file is about.
    assert.ok(labels > 40, `only ${labels} bodyless case labels found`);
    assert.ok(grouped >= 3, `only ${grouped} labels grouped with another case`);

    const unexplained = intoDefault.filter((k) => !ALLOWED.has(k)).sort();
    assert.deepEqual(unexplained, [],
      'case labels sharing the default branch with no reason recorded');
  });

  test('and the reasons recorded are for labels that still exist', () => {
    // A reservation is a dated claim about the rest of the codebase — the same
    // way `tractor_beam` sat in RESERVED with a reason that had stopped being
    // true. If one of these four moves or is given a body, the note goes stale
    // and should be removed rather than carried.
    const files = new Map();
    for (const f of ['src/core/state.js', 'src/main.js', 'src/sim/diplomacy.js',
      'src/world/encounters.js']) files.set(f, readFileSync(f, 'utf8'));
    for (const [f, lit] of [['src/core/state.js', "'withdraw'"], ['src/main.js', "'bridge'"],
      ['src/sim/diplomacy.js', "'identify'"], ['src/world/encounters.js', "'anomaly'"]]) {
      assert.match(files.get(f), new RegExp(`case ${lit}:\\s*\\n\\s*default:`),
        `${f} no longer groups ${lit} with default — the note above is stale`);
    }
  });
});

describe('every encounter kind is reachable, and every choice resolves', () => {
  test('measured by generating them and taking the choices', () => {
    // Through `rollEncounter` and `resolveEncounter`, which is what the screen
    // uses. A first draft called `g.rollEncounter?.()` — no such method — and
    // the optional chain reported all ten kinds as NEVER GENERATED, which is
    // §50's rule about probes and dynamic imports arriving by another road.
    const declared = new Set([...readFileSync('src/world/encounters.js', 'utf8')
      .matchAll(/kind:\s*'([a-z_]+)'/g)].map((m) => m[1]));
    assert.ok(declared.size >= 8, `only ${declared.size} kinds declared`);

    const ids = SYSTEMS.map((s) => s.id);
    assert.ok(ids.length > 20, `${ids.length} systems`);

    const seen = new Map();
    const failures = [];
    let resolved = 0;
    for (let seed = 1n; seed <= 140n; seed++) {
      const g = new Game({ seed, crewMode: 'original', shipClass: 'constitution' });
      for (let n = 0; n < 8; n++) {
        const sysId = ids[(Number(seed) * 7 + n * 13) % ids.length];
        const enc = rollEncounter(g.encounterStream(sysId), sysId, {
          ledger: g.ledger, ...g.encounterPerks(sysId),
        });
        if (!enc) continue;
        seen.set(enc.kind, (seen.get(enc.kind) ?? 0) + 1);
        // `quiet` is the ABSENCE of an encounter. Nothing begins, and asking
        // for choices here handed back the previous encounter's — which is how
        // a first run credited `quiet` with `trap_device`.
        if (enc.kind === 'quiet') continue;
        g.beginEncounter(enc);

        const offered = g.encounterChoices() ?? [];
        if (!offered.length) { failures.push(`${enc.kind}: offers no choices`); continue; }
        const pick = offered[Number(seed) % offered.length];
        try {
          const out = g.resolveEncounter(pick.id);
          resolved++;
          // `hail` opens the hail dialogue rather than settling anything, and
          // `{hail:true}` is a real outcome.
          if (!out || (!out.messages?.length && !out.combat && !out.mission && !out.hail)) {
            failures.push(`${enc.kind}/${pick.id}: resolved to nothing`);
          }
        } catch (e) {
          failures.push(`${enc.kind}/${pick.id}: threw ${e.message}`);
        }
      }
    }

    assert.ok(resolved > 500, `only ${resolved} choices resolved`);
    const never = [...declared].filter((k) => !seen.has(k)).sort();
    assert.deepEqual(never, [], 'kinds the generator declares and never produces');
    assert.deepEqual([...new Set(failures)].slice(0, 10), []);
  });
});

describe('two more tables with nothing written and unread in them', () => {
  test('every field on an assignment is read by duty.js or by a screen', () => {
    const fields = new Set();
    for (const a of Object.values(ASSIGNMENTS)) for (const k of Object.keys(a)) fields.add(k);
    assert.ok(fields.size >= 10, `${fields.size} distinct fields`);
    assert.ok(Object.keys(ASSIGNMENTS).length >= 8, 'too few assignments to sweep');

    // Read INSIDE duty.js counts — a field consumed by its own module is read.
    // What matters is that something dereferences it, so the match is anchored
    // to a property access rather than to the name appearing somewhere.
    const duty = readFileSync('src/sim/duty.js', 'utf8');
    const screens = readFileSync('src/ui/screens.js', 'utf8');
    const both = `${duty}\n${screens}`;
    const unread = [...fields].filter((f) =>
      !new RegExp(`(assignment|a|job|detail|r)\\.${f}\\b`).test(both)
      && !new RegExp(`\\.${f}\\s*(\\?\\?|\\?\\.|\\)|,|;|<|>|===)`).test(both));
    assert.deepEqual(unread.sort(), [], 'fields declared on every assignment and never read');
  });

  test('and the line describing a detail reaches the button that sends it', () => {
    // `text` was the one that failed. Ten assignments carry a description —
    // "Plating, in vacuum, by hand.", "Take the intermix down and rebuild it
    // while nobody is shooting." — and the duty screen showed the name, the
    // hours and the wanted speciality, never the line saying what the job is.
    //
    // It hid because `duty.js` also emits `text:` on the RESULT of a detail, so
    // the name is used twice for two different things and a loose search finds
    // the other one.
    for (const a of Object.values(ASSIGNMENTS)) {
      assert.ok(typeof a.text === 'string' && a.text.length > 10,
        `${a.id} has no description, so this proves nothing`);
    }
    const screens = readFileSync('src/ui/screens.js', 'utf8');
    const i = screens.indexOf('for (const a of availableAssignments(g))');
    assert.ok(i > 0, 'the duty detail list has moved');
    // To the end of the loop, not a fixed window — a fixed 900 characters
    // stopped short of the line it was looking for the moment a comment was
    // added above it, which is a guard failing for a reason that has nothing
    // to do with the code it guards.
    const end = screens.indexOf('\n  }', i);
    assert.ok(end > i, 'cannot find the end of the detail loop');
    const block = screens.slice(i, end);
    assert.match(block, /a\.text/, 'the detail button does not show what the job is');
    // And the order phrase is in `say`, the element built for it, rather than
    // quoted by hand into `sub` — which is what left no room for the text.
    assert.match(block, /say:/, 'the detail button stopped teaching its own order phrase');
    assert.match(block, /send a \$\{a\.name\.toLowerCase\(\)\}/,
      'the phrase that sends a detail is gone');
  });

  test('every option absenceReport takes is supplied where it is called', () => {
    // The report a returning captain reads. A field it computes and the caller
    // never passes is a line that can never appear.
    const clock = readFileSync('src/campaign/clock.js', 'utf8');
    const sig = clock.slice(clock.indexOf('export function absenceReport'));
    const opts = sig.slice(sig.indexOf('{'), sig.indexOf('}'));
    const names = [...opts.matchAll(/(\w+)\s*=/g)].map((m) => m[1]);
    assert.ok(names.length >= 5, `only ${names.length} options parsed from the signature`);

    const state = readFileSync('src/core/state.js', 'utf8');
    const call = state.slice(state.indexOf('absenceReport(pending'), state.indexOf('absenceReport(pending') + 400);
    const missing = names.filter((n) => !new RegExp(`\\b${n}\\b`).test(call));
    assert.deepEqual(missing, [], 'options absenceReport computes that the caller never passes');
  });
});
