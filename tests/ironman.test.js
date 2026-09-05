// Three promises about the top of the ladder, and the one that was not kept.
//
// The difficulty card shows permadeath and ship loss BOTH WAYS — "permadeath"
// or "no permanent loss", "ship can be lost" or "ship cannot be lost" — and
// both are enforced: `away.js` for the first, `loseTheShip` for the second.
//
// The third rule was shown NEITHER way and enforced nowhere.
//
//   allowReload   false on the top five rungs. A getter on the class, and
//                 across the whole of src/ not one caller. "Saves cannot be
//                 reloaded" was a policy the table stated and the game did
//                 not implement.
//
//   ironman       true on Fleet Admiral alone, read by exactly one line — a
//                 red pill on the difficulty card. Fleet Admiral's actual
//                 save-and-death rules are IDENTICAL to the four rungs below
//                 it: permadeath, shipLoss, allowReload false, all three. So
//                 the top card claimed a distinction the table does not make.
//
// `difficulty.js`'s own header had left `allowReload` "declared and exposed so
// the next sweep finds the promise rather than quietly losing it". This is that
// sweep, and these are the two halves of what it found.
//
// The manual was wrong about it too: "Fleet Admiral — ironman. If the ship is
// lost, the commission is over." `loseTheShip` gives you a replacement on the
// first loss at EVERY rung, on the Kirk precedent recorded in RESEARCH §21, and
// ends the career on the second. Fleet Admiral was never different.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { Game } from '../src/core/state.js';
import { Character } from '../src/rules/character.js';
import { DIFFICULTIES, DifficultySettings, isIronman } from '../src/rules/difficulty.js';
import { reloadRefusal } from '../src/core/save.js';

const captain = (difficulty, seed = 5n) => new Game({
  seed, crewMode: 'original', difficulty,
  character: new Character({ speciesId: 'human', careerId: 'command' }),
  shipClass: 'constitution',
});

/** Every .js file under src/, as one string. */
function sourceText() {
  let out = '';
  const walk = (d) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      if (n.isDirectory()) walk(`${d}/${n.name}`);
      else if (n.name.endsWith('.js')) out += readFileSync(`${d}/${n.name}`, 'utf8');
    }
  };
  walk('src');
  return out;
}

describe('ironman is the name for a combination, not a field', () => {
  test('it is derived, and no rung declares it any more', () => {
    for (const d of DIFFICULTIES) {
      assert.equal('ironman' in d, false,
        `${d.id} declares ironman again; it duplicates permadeath + shipLoss + no reload`);
    }
  });

  test('and it is true exactly where all three rules are', () => {
    for (const d of DIFFICULTIES) {
      const all = !!d.permadeath && !!d.shipLoss && d.allowReload === false;
      assert.equal(isIronman(d), all, `${d.id}`);
      assert.equal(new DifficultySettings(d.id).ironman, all, `${d.id} getter`);
    }
  });

  test('and that is the top five rungs, not the top one', () => {
    // The correction. Fleet Admiral used to wear the pill alone while four
    // rungs below it had exactly the same save-and-death rules.
    const on = DIFFICULTIES.filter(isIronman).map((d) => d.id);
    assert.deepEqual(on,
      ['commodore', 'rear_admiral', 'vice_admiral', 'admiral', 'fleet_admiral']);
    // And it is the same set that declares no reloading, which is the point:
    // if those ever diverge, one of the two is lying.
    assert.deepEqual(on, DIFFICULTIES.filter((d) => d.allowReload === false).map((d) => d.id));
  });

  test('and the card shows the reload rule both ways, like the other two', () => {
    // Permadeath and ship loss were always shown in both directions. The one
    // rule shown in neither was the one that was not enforced.
    const card = readFileSync('src/ui/charscreens.js', 'utf8');
    assert.match(card, /no reloading/);
    assert.match(card, /reloading allowed/);
    assert.match(card, /isIronman\(d\)/, 'the pill is declared rather than derived');
  });
});

describe('allowReload is read by something now', () => {
  test('the sweep that called it dead finds a reader outside its own file', () => {
    const outside = sourceText().replace(readFileSync('src/rules/difficulty.js', 'utf8'), '');
    assert.match(outside, /allowReload/,
      'nothing outside difficulty.js reads it, so the promise is unkept again');
  });

  test('and the refusal is a real function, not a comment', () => {
    assert.equal(typeof reloadRefusal, 'function');
  });
});

describe('what taking the commission back is refused for', () => {
  /** A record from earlier in the same commission. */
  const earlier = (g, by = 60 * 60 * 1000) => {
    const rec = JSON.parse(JSON.stringify(g.save()));
    rec.campaign.highWater = (g.campaign?.highWater ?? Date.now()) - by;
    rec.stardate = Number((g.stardate - 4).toFixed(1));
    return rec;
  };

  test('the same commission, further back, on a rung that promised it would be', () => {
    const g = captain('fleet_admiral');
    const no = reloadRefusal(g, earlier(g));
    assert.ok(no, 'a top-rung commission was taken back');
    assert.match(no, /stardate/i, no);
    assert.match(no, /Fleet Admiral/, no);
  });

  test('and every one of the five rungs refuses it', () => {
    for (const d of DIFFICULTIES.filter((x) => x.allowReload === false)) {
      const g = captain(d.id);
      assert.ok(reloadRefusal(g, earlier(g)), `${d.id} allowed a rewind`);
    }
  });

  test('and none of the seven below does', () => {
    // The control, and the reason this is not simply "rewinding is refused":
    // every rung below must be unchanged, or this became a change to the whole
    // game rather than a property of the top five.
    for (const d of DIFFICULTIES.filter((x) => x.allowReload !== false)) {
      const g = captain(d.id);
      assert.equal(reloadRefusal(g, earlier(g)), null, `${d.id} refused a rewind`);
    }
  });
});

describe('and what is still allowed, because it is not a rewind', () => {
  const earlier = (g) => {
    const rec = JSON.parse(JSON.stringify(g.save()));
    rec.campaign.highWater = (g.campaign?.highWater ?? Date.now()) - 3600000;
    return rec;
  };

  test('restoring onto a device with no commission in progress', () => {
    // The legitimate case, and the one the Options screen actively encourages:
    // "a five-year commission is worth exporting somewhere that is not this
    // phone." Blocking this would make the backup advice a trap.
    const g = captain('fleet_admiral');
    assert.equal(reloadRefusal(null, earlier(g)), null);
  });

  test('and importing a different captain’s record', () => {
    // A different seed is a different commission, not this one taken back.
    const mine = captain('fleet_admiral', 5n);
    const theirs = captain('fleet_admiral', 99n);
    const rec = JSON.parse(JSON.stringify(theirs.save()));
    rec.campaign.highWater = (mine.campaign?.highWater ?? Date.now()) - 3600000;
    assert.equal(reloadRefusal(mine, rec), null);
  });

  test('and a record that is not behind the one in progress', () => {
    // Same commission, same point or later — that is a resume, not an undo.
    const g = captain('fleet_admiral');
    const same = JSON.parse(JSON.stringify(g.save()));
    assert.equal(reloadRefusal(g, same), null);
    const ahead = JSON.parse(JSON.stringify(g.save()));
    ahead.campaign.highWater = (g.campaign?.highWater ?? Date.now()) + 3600000;
    assert.equal(reloadRefusal(g, ahead), null);
  });

  test('and nothing at all is refused when the record is unreadable', () => {
    const g = captain('fleet_admiral');
    assert.equal(reloadRefusal(g, null), null);
    assert.equal(reloadRefusal(g, {}), null);
  });
});

describe('the manual said something the game does not do', () => {
  test('losing the ship once is not the end of a commission, at any rung', () => {
    // "Fleet Admiral — ironman. If the ship is lost, the commission is over."
    // `loseTheShip` hands you a replacement on the first loss at every rung —
    // Kirk destroyed the Enterprise and was given the Enterprise-A — and ends
    // the career on the second, because Starfleet does not offer a third hull.
    const g = captain('fleet_admiral');
    g.loseTheShip();
    assert.equal(g.over, false, 'the first loss ended the commission');
    assert.equal(g.shipsLost, 1);
    g.loseTheShip();
    assert.equal(g.over, true, 'the second loss did not end it');
  });

  test('and the manual now says that', () => {
    const manual = readFileSync('docs/MANUAL.md', 'utf8');
    const line = manual.split('\n').find((l) => /Fleet Admiral/.test(l) && /ironman/i.test(l));
    assert.ok(line, 'the manual no longer describes the top rung');
    assert.doesNotMatch(line, /If the ship is lost, the commission is over/,
      'the manual still promises something the game does not do');
  });
});
