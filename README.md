# Starfleet Command Simulator

An offline starship command simulator that runs in a browser and installs to a
phone's home screen. You are the captain. You give orders, and the ship, the
crew, and the galaxy respond — and remember.

Built mobile-first for a Pixel 10 Pro XL, and playable in airplane mode
forever once installed.

**No dependencies. No build step. No network. No accounts. No telemetry.**

---

## Install

Three ways, all fully offline once installed:

- **`dist/starfleet-command.apk`** — a real Android package. One permission,
  `VIBRATE`. **No `INTERNET` permission at all**, so it physically cannot
  reach the network. ~210 KB, minSdk 26.
- **PWA** — open the page once and tap **Add to Home screen**.
- **`dist/starfleet-command.html`** — the whole game as one self-contained
  file. Drop it on the phone and open it from Files. No server, no install.

Full instructions, including the HTTPS caveat that decides whether offline
support actually engages: **[docs/INSTALL.md](docs/INSTALL.md)**

## Play

The captain's manual — every order, how combat works, and what the
consequences actually do: **[docs/MANUAL.md](docs/MANUAL.md)**

The reference dossier the design is built on — hull dimensions, bridge station
layout, the documented captain's-chair controls, alert conditions, and what
Kirk actually did to the Kobayashi Maru — with sources:
**[docs/RESEARCH.md](docs/RESEARCH.md)**

---

## What it is

A tactical and narrative command simulator with the systems depth of *Star
Trek Online*'s Starfleet career, presented as an LCARS bridge console rather
than a 3D MMO.

**Your captain is a character sheet.** Six ability scores on a 27-point buy,
twelve playable species with real mechanical traits, seven origins, seven
career tracks each with a signature power usable once per engagement, and
personal traits that are
genuine trades rather than bonuses — *Reckless* gives advantage on every
attack and disadvantage on every saving throw. Feats are chosen on promotion.

**The character sheet is D&D. The gameplay is not.** Ability scores,
proficiency, feats, levels and advantage all still exist and still matter — but
nothing in play resolves on a twenty-sided die. Outcomes are a *margin*:
capability against difficulty, plus a bounded random swing, giving not just
whether you succeeded but how comfortably. A flat die means a brilliant officer
fumbles routine work one time in twenty forever; a bounded swing means being
better makes you reliably better, and training makes you *consistent* as well
as capable — something a d20 cannot express at all.

The arithmetic is still shown and still itemised: which ability, which officer,
which circumstance. What changed is the shape of the uncertainty, not how
auditable it is.

**Twelve difficulties, named up the command ladder** — Story, Cadet, Ensign,
Lieutenant, Lieutenant Commander, Commander, Captain, Commodore, Rear Admiral,
Vice Admiral, Admiral, Fleet Admiral. They change what the game is willing to
do to you: whether officers die permanently, whether the ship can be lost,
how hard the target numbers are, and — the main lever at the top — how many
hostiles arrive at once. A single same-tier opponent stays beatable at every
rung (tested); what changes is that patrols stop arriving one at a time, and
that some fights are meant to be broken off rather than won. Fleet Admiral is
ironman.

**Two-axis reputation.** *Standing* is how a faction feels this week and
decides who fires on sight. *Reputation* is what you have earned over a
career: it only rises, advances through six tiers, and accrues a currency you
spend on projects that grant consoles, resupply, passage rights, allied
escorts, a loaned Romulan cloaking device, and titles. You can be honoured by
the Klingon Defence Force and shot at by them in the same week — fighting well
while losing earns their respect even as it costs you their goodwill.

**Command.** Anything you type is an order. Not a menu of phrasings — a
layered parser that folds contractions, slang, British spelling and naval
shorthand, strips politeness, works out who you addressed, and matches what is
left phonetically and by edit distance. `"could you please aim for their
nacels"` targets their engines. `"hale them"` opens a channel. `"ds9"` sets a
course. When it is confident it acts; when it is only fairly sure it says *"I
read that as X — confirm?"*; when it is lost it says so and offers the nearest
readings, rather than doing something you did not ask for.

It is not a language model and it does not understand English — it recognises
orders, from a lexicon of 1499 phrasings and 312 weighted keywords across
69 intents. The honest
measure is `tests/corpus/orders.txt`: 610 hand-written paraphrases, deliberately
hostile — typos, phonetic spelling, panic, politeness — with CI failing below
95%. It currently sits at 100%, and the fallback exists for the sentences the
corpus has not thought of yet.

Officers acknowledge in their own voice, argue when they disagree, and can
refuse an order outright if it is bad enough.

**The captain's chair.** The alert conditions, hailing frequencies, the
viewscreen, the log recorder, an intercom to every department that answers with
real numbers off the live ship, and the ion pod — which is a genuine sensor
decoy that makes the people shooting at you miss. Built from what the chair
actually had; of all the buttons on the prop, exactly three were ever assigned a
function on screen. Every control emits the same order object the parser
produces, so there is one execution path and not two.

**Three dimensions.** The tactical display is a hand-written WebGL renderer —
no engine, no model files, no textures. Every hull is generated from a
parametric blueprint: thirty-one classes are thirty-one short records of
proportions taken from the reference dossier, turned into flat-shaded geometry
by five primitives. A Constitution's saucer and nacelles, a Bird-of-Prey's
swept wings and a Borg cube all come out of the same 400 lines.

A reference grid and a drop line from every hull to it are what make the third
axis readable rather than decorative — without them, two ships overlapping on
screen tell you nothing about which is above the other. One finger orbits, two
pinch, a tap targets.

If WebGL is unavailable the 2D display this game shipped with takes over,
complete and unchanged. "No WebGL" means a different picture, not a broken
game.

**Combat.** Six independent shield facings — fore, aft, port, starboard, and
now dorsal and ventral, because a ship in three dimensions can be shot at from
above and below and pretending otherwise means climbing hits armour that
geometrically is not there. Firing arcs are cones rather than angles, so a
forward bank does not bear on something directly over the saucer merely because
it is ahead in plan view. Hostile captains climb and dive to reach the facing
you are not presenting. Subsystem targeting. STO-style
power distribution across weapons, shields, engines, and auxiliary, with an
EPS grid that takes real seconds to rebalance. Firing arcs, range falloff,
shield bleedthrough, torpedo piercing, cloaks, boarding parties, hull fires,
and warp core breaches you survive only by ejecting the core.

**A five-year mission, in real time.** A commission runs 1,826 days of
wall-clock time. The ship repairs, fires burn out, injured officers recover and
the stardate advances whether the app is open or not — you come back to a
ship's log of what happened while you were away, not to a paused game.

Three things it has to survive, and they are the whole design. **Setting the
clock forward cannot buy progress** — a monotonic high-water mark, so the
commission only ever moves in one direction. **Setting it backward cannot
destroy one** — time zones, daylight saving, a dead battery; elapsed time
clamps at zero and re-anchors rather than rolling your career backwards. And
**a month away does not hand back a pristine ship**: a single absence credits
at most 72 hours, and the log says so plainly rather than leaving you to work
it out from a repair bill that does not add up.

Real time is the default and the point. There is a compression factor in
Options — ×24, ×168, or ×1000 for testing — and it is labelled honestly for
what it costs: the bridge says *"this is not the five-year mission"* while it
is on. Nothing is locked behind real time. It is just that a commission you
finish in a fortnight is not the thing the game was built to be.

**And on day 1,826 you are relieved.** Serving the five years out is the one
ending that is not a failure: the ship is ordered home, the record closes, and
Starfleet assesses it on the same bands it uses at every promotion board. It is
shown as a commission completed rather than a command lost, which is a
distinction the end-of-commission screen draws on purpose.

**A save you can trust for five years.** Every write is checksummed, so a
record truncated by a phone running out of space is *detected* rather than
handed to the game as though it were sound. The last three autosaves are kept
in a ring, and a load that fails falls back through them rather than presenting
a blank bridge to somebody four years into a commission. The browser
verification deliberately corrupts the autosave and proves the recovery works.

**Making things, and making do.** The engineering solution is half of what a
starship captain does. Salvage stripped from wrecks becomes stores; stores
become hull patches, torpedo casings, sensor pallets, jury-rigged EPS bypasses
and improvised graviton charges. Every recipe has a real effect — a test walks
the book and fails on any that changes nothing — and everything takes the hours
it takes, on the commission clock, so a two-day job runs whether the app is
open or not. One bench, one chief engineer, one job at a time: being made to
choose is the point.

**Situations you cannot shoot.** Some encounters have no combat option and
withdrawing does not work. A gravimetric shear has the ship by the keel;
something is running silent and matching your course; the containment field is
building toward a cascade. What gets you out is a device you built in advance,
everything you have diverted into one channel at once, or the patience to sit
there while it costs you hours and hull. The browser verification checks that a
trap never offers a way to shoot out of it.

**A galaxy.** Sol, Vulcan, Andoria, Bajor, Deep Space 9, Wolf 359, the
Romulan Neutral Zone, the Badlands, Qo'noS, and uncharted grids past the
relay network — as a real graph with real light-year distances. Warp travel
costs stardate time and antimatter, and can be interrupted en route.

**A crew.** Serve with the canonical senior staff of the TOS, TNG, DS9, or
Voyager era, or with an original crew generated from your world seed. Either
way they have traits that drive both their abilities and their opinions, and
either way they can die.

**The Kobayashi Maru.** The scenario is available from your first day and it
is unwinnable — not hard, unwinnable, and the game does not quietly relent if
you fly well. A test flies it eight times on the easiest difficulty in the game
and asserts you lose every one.

What is earned is the *technique*, and it is modelled on what Kirk actually did
rather than on the idea of it. He did not make the Klingons weaker; he made the
commander hold him in high regard, said his name, and they offered to help. So
the lever here is reputation and the trigger is saying who you are — with three
gates, each of which has to be true:

- **You have to have a reputation.** Tier 5 with the Empire. Most of a
  commission's worth of standing.
- **They have to have met you.** The ledger has to show real encounters —
  ships you destroyed, ships you spared, treaties you kept. A captain nobody
  has heard of cannot trade on being heard of.
- **You have to say something worth hearing.** With the channel forced open,
  the order line stops being an order line: whatever you type is what you say,
  verbatim, and it is scored against what the ledger can actually corroborate.
  Claim a record you do not have and the commander checks, finds nothing, and
  says so. Threaten them and it costs you.

**Consequences.** A persistent ledger that is never rolled back. Officers who
die stay dead. Ships you destroy stay destroyed and their faction remembers.
Colonies saved or lost rewrite which missions exist. Three Prime Directive
violations convene a board of inquiry and freeze your promotion. Damage
persists until you dock.

**Episodes.** Sixteen authored multi-act missions, each solvable through
tactical, scientific, or diplomatic routes, with away teams whose skill checks
can get named officers killed.

**Progression.** Ensign to Admiral, a spendable skill tree whose ranks are
real terms in the damage formula, bridge officer training, ship tiers and
refits, and console loadouts.

---

## Two things stated plainly

**The sound is synthesized, not sampled.** Every klaxon, phaser, torpedo,
transporter cycle, LCARS chirp, and hull impact is generated by the Web Audio
API at the moment you hear it. No recordings from the shows are used or
redistributed — they are not mine to ship. A side effect is that the game
contains no audio files at all, which is a large part of why there is nothing
to load.

**"No loading screens" is structural, not cosmetic.** There is nothing to
load. The galaxy is generated from its seed at boot, audio is built on the
first tap, and all art is vector and canvas. Screen changes are synchronous.

---

## Technical notes

Plain ES modules, no framework, no runtime dependencies, no bundler required.
The service worker precaches the app — a few tens of kilobytes, because it is
all code — so every launch after the first is served from disk.

**64-bit determinism.** The simulation runs on a xoshiro256\*\* PRNG with
64-bit BigInt state, seeded by splitmix64, with float64 throughout the
physics. The seed and draw counter are stored in the save, so a restored game
continues the identical number stream and any galaxy is exactly reproducible
from its seed. Combat is replayable.

The sim advances in fixed 1/30s steps independent of frame rate, so an
engagement resolves identically on a 60 Hz and a 120 Hz panel.

```
src/campaign/ the commission clock: real time, offline progress, absences
src/core/     rng, clock, event bus, consequence ledger, game state, saves
src/gfx/      vector maths, WebGL, procedural meshes, hull blueprints, scene
src/lang/     normalisation, phonetics, edit distance, gazetteer, intent lexicon
src/rules/    outcome resolution, character sheet, reputation, difficulty ladder
src/sim/      ship, power, combat, AI, officers, skills, loadout, away teams, diplomacy
src/world/    galaxy graph, encounters, and the systems/ships/crews/factions data
src/missions/ mission state machine and the episode definitions
src/audio/    synthesis primitives, named cues, mixer
src/ui/       LCARS kit, screens, tactical and map renderers, order parser
android/      WebView shell, manifest, resources for the APK
```

**Content:** 43 star systems, 31 ship classes, 24 authored episodes, 12
species, 12 difficulties, 6 reputation tracks, 38 synthesized sound cues, and
a command lexicon of 1499 phrasings tested against a 610-order corpus,
and 31 procedurally generated hulls averaging 1058 triangles each.

## Development

```sh
npm start      # serve at http://localhost:8099
npm test       # 1000+ tests — RNG determinism, combat maths, dice, saves, balance
npm run build  # regenerate dist/starfleet-command.html

ANDROID_HOME=/path/to/android-sdk ./tools/build-apk.sh   # build the APK
```

The APK build uses the SDK tools directly — aapt2, javac, d8, zipalign,
apksigner — with no Gradle and no network at build time.

The test suite includes **balance regression tests** that simulate hundreds of
engagements. They exist because a plausible-looking set of difficulty
multipliers once made a Constitution lose 20 out of 20 to a single light
raider, and the paper numbers hid it — they double-counted fore and aft
batteries that a ship facing its target can never fire together.

Browser verification drives the real UI at Pixel viewport — including typing
orders into the actual order line rather than calling the app object, because
"what you type is what the ship does" is only tested end to end — captain creation
through warp, combat, the ledger, save/restore — and **proves the offline
claim** by cutting the network after the service worker registers and
reloading. It also extracts `assets/game.html` from the signed APK and runs
that, which is exactly what the phone's WebView does. Playwright is
deliberately not a project dependency:

```sh
npm i playwright --prefix /tmp/pw
NODE_PATH=/tmp/pw/node_modules node tools/verify-app.mjs
```

---

## Licence and attribution

Fan work, made for the love of the thing, and not affiliated with or endorsed
by the rights holders. Star Trek and all associated marks are the property of
Paramount. Canonical character names appear as names, ranks, species, and
stations only — no dialogue, scripts, artwork, audio, or other creative
material is reproduced. Every line an officer speaks in this game was written
for this game.

The code is provided for personal, non-commercial use.
