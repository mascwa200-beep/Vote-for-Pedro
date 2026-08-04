# Reference dossier

Working notes gathered from free, publicly available reference material, kept
here so the design decisions in this repository can be traced to something
other than my memory of the shows.

**How to read this file.** Everything below is *facts and measurements*, written
in my own words, with a link to where I found each group of them. Memory Alpha
and the other fandom wikis are CC BY-NC — their prose is not reproduced here and
must not be. Where two sources disagree I record both numbers rather than
picking one, because the disagreement is usually the interesting part.

**What this is for.** Three concrete jobs:

1. Hull proportions that can drive parametric 3D meshes (`src/gfx/blueprint.js`).
2. The real control layout of a bridge and a command chair, so
   `src/ui/chair.js` is modelled on something rather than invented.
3. Procedure, terminology and scenario detail that the free-text command layer
   (`src/lang/`) has to recognise, and that missions can be built from.

---

## 1. Constitution class — the ship you command

Two independent sources, and they do not fully agree. Both are recorded.

| Figure | Memory Alpha lineage | DITL |
|---|---|---|
| Length | 288.6 m | 289 m |
| Beam | 127.1 m | 127.1 m |
| Height | 72.6 m | 72.6 m |
| Decks | 23 | 21 |
| Crew | 430 (later config), 203 (original) | 433 |
| Mass | — | 600,000 t |

Armament and defence, per DITL: six Type-VI phaser emitters arranged in three
banks, ~4,000 TW aggregate output; two photon torpedo tubes with a magazine of
120 rounds; shield capacity ~594,000 TJ.

Speed, on the TOS warp scale: normal cruise warp 5, maximum cruise warp 6,
maximum rated warp 9 sustainable for about four hours.

**What the build takes from this.** The 288–289 m length and the 127 m beam give
a saucer-to-length ratio of roughly 0.44, and the 72.6 m height sets the
nacelle-pylon spread. Those three ratios are what `blueprint.js` needs; the
absolute metres only matter for the range and scale readouts. The deck-count
disagreement (21 vs 23) is resolved in favour of **23**, because internal
compartment damage is more interesting with more decks to name, and because the
higher figure is the one the show's own dialogue supports. The 430-crew figure
is the one already used in `src/world/ships.data.js`, and it stays.

Sources: [Memory Alpha — Constitution class](https://memory-alpha.fandom.com/wiki/Constitution_class),
[DITL — Constitution class specs](https://www.ditl.org/ship-page.php?ClassID=fedconstitution&ShipID=6014&ListID=Ships)

---

## 2. Hull proportions for the rest of the roster

Enough anchors to derive the rest by silhouette. All figures are length × beam ×
height in metres unless noted.

| Class | Length | Beam | Height | Decks | Crew |
|---|---|---|---|---|---|
| Constitution | 288.6 | 127.1 | 72.6 | 23 | 430 |
| Miranda | 277.8 | 174.0 | 65.2 | — | — |
| Excelsior | 466.6 | — | — | — | — |
| Galaxy | 641 | 470 | 145 | 42 | 1,012 |
| Intrepid | 344.5 | 132.1 | 64.4 | 15 | — |
| Defiant | 170.7 | 134.1 | 30.1 | — | 50 (150 max) |
| Romulan D'deridex | ~1,200 | — | — | — | — |
| Klingon Bird-of-Prey | — | ~350 | — | — | — |

Three things fall out of this table that matter more than any individual number:

- **Beam-to-length ratio is the species signature.** Federation saucer ships run
  0.35–0.73 (Miranda is unusually wide at 0.63, Galaxy widest at 0.73). The
  Klingon Bird-of-Prey is *wider than it is long* once its wings are down —
  which is why it reads as a predator rather than a liner, and why the mesh
  generator needs a wing-sweep parameter that Federation hulls do not have.
- **Height is consistently the smallest axis**, 0.1–0.25 of length across every
  class. Ships are discs and wedges, not spheres. This is the single most
  important fact for the 3D camera: a top-down default view loses almost nothing,
  which is why the existing 2D display has worked at all, and it means the new
  third axis should be *used* deliberately — attacks from above and below — or it
  will read as decoration.
- **Scale range is enormous**, 170 m to 1,200 m. A single fixed camera distance
  cannot frame both a Defiant duel and a D'deridex. The renderer needs
  auto-framing off the largest live hull, which `TacticalView.autoFrame` already
  does in 2D and which must survive the port to 3D.

Sources: [DITL ship database](https://www.ditl.org/ship-page.php?ClassID=fedgalaxy&ListID=Ships),
[Memory Alpha — Miranda class](https://memory-alpha.fandom.com/wiki/Miranda_class),
[Memory Alpha — Excelsior class](https://memory-alpha.fandom.com/wiki/Excelsior_class),
[Ex Astris Scientia — Bird-of-Prey size](https://www.ex-astris-scientia.org/articles/bop-size.htm),
[Wikipedia — Defiant-class patrol vessel](https://en.wikipedia.org/wiki/Defiant-class_patrol_vessel)

---

## 3. The bridge, and who sits where

The layout is a ring around a central well. The helm and navigation consoles sit
side by side in the middle of the room, forward of the command chair and facing
the viewscreen; helmsman and navigator sit at their own consoles. Around the
outer elevation of the ring sit the remaining stations.

Stations documented as present on a Constitution-class bridge:

- Helm (manoeuvring thrusters, impulse engines, weapons fire)
- Navigation (course plotting, the astrogator)
- Communications
- Engineering
- Weapons control
- Science / library-computer
- Gravity control
- Damage control
- Environmental engineering
- Internal security

The helm console specifically: a compartment on the left that opens
automatically to present the targeting scanner; the main panel controlling
thrusters, impulse and weapons; a row of **eight flip switches** below it that
set warp factor; and a central section carrying sensor monitor lights, the alert
indicator, and the astrogator for long-range plotting.

**What the build takes from this.** Ten stations is the correct granularity for
department intercom channels, and the eight warp flip-switches are a real
control the chair panel should reproduce rather than a slider. "Gravity
control", "damage control" and "environmental engineering" are stations the
current game has no concept of — each is a plausible order target for the
free-text layer and a plausible thing to lose in combat.

Sources: [Memory Alpha — Bridge](https://memory-alpha.fandom.com/wiki/Bridge),
[Memory Alpha — Constitution class sets](https://memory-alpha.fandom.com/wiki/Constitution_class_sets)

---

## 4. The captain's chair

This is the part the design leans on hardest, and it comes with an honest
caveat: **most of the chair's buttons were never assigned a function.** Only
three were ever labelled on the physical prop, for the episode "Court Martial":

- Yellow alert
- Red alert
- Jettison the ion pod

Beyond those three, the documented breakdown of the armrests is:

- **Left arm** — shuttlecraft operation, viewscreen activation, hailing
  frequencies. Physically, a row of flip switches.
- **Right arm** — red alert, yellow alert, pod jettison, micro-tape player,
  intercom controls. Physically, a data-card slot.
- **Upper console** — the blue communication panel that replaced the earlier
  gooseneck viewer, plus additional buttons above each armrest.

The layout changed across production: "The Cage" had a gooseneck viewer and no
communication panel; the series version replaced it with the blue panel; season
three added carpeting to the base without changing controls. The arrangement was
also modified episode to episode as scripts demanded, and full-backrest variants
were used to distinguish other ships.

**What the build takes from this.** The chair panel in `src/ui/chair.js` is built
from the *documented* controls — alert conditions, hailing frequencies,
viewscreen, shuttle bay, intercom by department, log recorder, jettison — and
the gaps are filled with controls the simulation genuinely needs rather than
invented set dressing. The fact that the real prop's function set shifted per
episode is licence to make the panel contextual: what the chair offers changes
with alert condition. And "the layout was modified as the script required" is a
fair description of how a game UI should behave too.

Sources: [Memory Alpha — Captain's chair](https://memory-alpha.fandom.com/wiki/Captain%27s_chair),
[Ex Astris Scientia — Evolution of the TOS captain's chair](https://www.ex-astris-scientia.org/database/captains_chair.htm),
[Memory Alpha — Command console](https://memory-alpha.fandom.com/wiki/Command_console)

---

## 5. Alert conditions and standing orders

**Alert conditions**, highest first:

- **Red alert** — the highest status; called on entering combat or on critical
  systems failure.
- **Yellow alert** — one stage below; a ship-wide state of increased readiness
  for a possible crisis.
- **Blue alert** — an exceptional-circumstances condition covering environmental
  hazards to the crew, main power failure, docking and separation manoeuvres, and
  landing.

Blue alert is the one this game does not currently model, and it is the most
useful of the three to add: it gives docking, separation and atmospheric
operations a distinct state instead of overloading yellow.

**General Order 24** is an order to destroy all life on a planet. It has been
invoked twice on screen — by Captain Garth at Antos IV and by Kirk at Eminiar VII
— and on neither occasion was it carried out. Both times it was a bluff.

That is the interesting fact, and it generalises: the most famous applications of
Starfleet's most extreme standing order were both *threats made with no intention
of execution*. A game that only models orders as things that happen misses how
this fiction actually works. The command layer therefore needs bluffing as a
first-class action — an order given for its effect on the listener — with the
ledger recording that you threatened it, and the consequence of being called on
it if your reputation cannot carry the bluff.

Sources: [Memory Alpha — General Orders and Regulations](https://memory-alpha.fandom.com/wiki/General_Orders_and_Regulations),
[Memory Alpha — Red alert](https://memory-alpha.fandom.com/wiki/Red_alert),
[Memory Alpha — Blue alert](https://memory-alpha.fandom.com/wiki/Blue_alert),
[Memory Alpha — Alert signal](https://memory-alpha.fandom.com/wiki/Alert_signal)

---

## 6. The Kobayashi Maru, and how it was actually beaten

The scenario is a no-win test: a stranded freighter inside the Neutral Zone,
where attempting rescue brings on an unwinnable engagement and declining it
abandons the crew.

The novel-length account is Julia Ecklar's *The Kobayashi Maru* (1989). The
method it describes is precise, and it is not "he made the enemy weaker":

- He reprogrammed the simulation so that the simulated Klingons **held him in
  high regard as a famous starship captain** — a reputation he did not have,
  being a cadet at the time.
- The trigger was **identifying himself**. On hearing the name, the opposing
  commander responded with deference rather than fire.
- The outcome was not that the Klingons were defeated. They **offered
  assistance**, escorting him in to recover the freighter.

Three design consequences follow directly, and the plan is built on them:

1. **The lever is reputation, not firepower.** So the in-game technique must be
   gated on reputation actually earned over the campaign, and the game must be
   able to tell the difference between a captain the Klingon Defence Force has
   heard of and one it has not. `src/core/ledger.js` already records ships
   destroyed, ships spared and colonies saved per faction — that ledger is the
   evidence base.
2. **The mechanism is forcing a channel open with someone who does not answer
   hails.** `src/sim/diplomacy.js` already carries a `forced` path through
   `resolveHail`, added for the Diplomatic career's Parley. The gambit is what
   finally justifies it.
3. **He said his name and it mattered.** Which means the exchange has to be
   free text, scored on what you actually claim, and claiming a record you do
   not have has to fail — visibly, with the reason given.

The scenario ships early and is genuinely unwinnable. That is the point of it.

Sources: [Memory Alpha — Kobayashi Maru scenario](https://memory-alpha.fandom.com/wiki/Kobayashi_Maru_scenario),
[Wikipedia — The Kobayashi Maru (novel)](https://en.wikipedia.org/wiki/The_Kobayashi_Maru_(Star_Trek_novel)),
[Memory Beta — Kobayashi Maru scenario](https://memory-beta.fandom.com/wiki/Kobayashi_Maru_scenario)

---

## 7. Terminology the command parser must recognise

Collected from the above and from the existing data files, this is the raw
vocabulary the free-text layer has to cover. It is recorded here so the lexicon
has a source rather than being improvised.

**Stations to address:** helm, conn, navigation, tactical, weapons control,
communications, comms, engineering, science, library computer, sickbay, medical,
security, transporter room, shuttle bay, damage control, environmental,
gravity control.

**Alert states:** red alert, yellow alert, blue alert, condition green, general
quarters, battle stations, stand down.

**Helm vocabulary:** warp factor one through nine (the eight flip switches),
ahead full, ahead one third, two thirds, dead slow, all stop, station keeping,
come about, bearing, mark, evasive, break off, plot a course, lay in a course,
engage.

**Tactical vocabulary:** lock phasers, arm photon torpedoes, full spread,
targeting scanner, target their engines / nacelles / warp core / shields /
weapons / sensors, fire at will, weapons free, hold fire, cease fire.

**Command vocabulary that is not an instruction to a console:** hailing
frequencies open, on screen, put them on, identify yourself, this is the captain
speaking, all hands, brace for impact, abandon ship, self-destruct, prefix code,
General Order 24, bluff, demand surrender, offer terms.

The last group is the one the current regex parser handles worst and the one the
game most needs, because it is where the fiction lives.

---

## 8. The bridge as a piece of construction

§3 records who sits where. This is how the room is actually BUILT, which is a
different question and the one the geometry needs answering.

**The ring is ten wall segments of 36 degrees.** Not a smooth circle and not an
arbitrary spread of stations: ten flat bays, each one a station, which is why
ten is the right number of departments and not a coincidence. The bay carrying
the main viewer is wider — 40.5 degrees — because the screen needed the width.

| | |
|---|---|
| Overall diameter | 9.1 m |
| Clear floor between console edges | 7.9 m |
| Wall segments | 10, at 36° each |
| Main viewer segment | 40.5° |
| Turbolift | single door, **port side, 36° off the centreline** |

**The turbolift is not dead aft.** It sits behind the command chair and over to
the left. Both explanations offered for this — that the whole bridge is rotated
36° to port, or that the lift car sidesteps before its doors open — agree on
what is actually seen, which is the only thing the geometry has to reproduce.

### The paint

This is the part the first build got most wrong, by assuming a 1960s set was
dark. It was not. It was built for colour television at the moment colour
television arrived, and it is BRIGHT:

| Element | Colour |
|---|---|
| Walls, captain's chair | very light neutral grey |
| Carpet, both levels | grey, the same shade on each |
| Turbolift doors, the railing, the helm/navigation console | **international orange** — the colour of a traffic cone |
| Crew chairs | light blue |
| Overhead display inserts | light greyish blue, bordered in a lighter near-white |
| Console buttons | saturated primaries — the "jelly beans" |

The console buttons were coloured resin in circles and triangles, and some of
them were literally jelly beans. That is the detail that makes the set read as
1966 rather than as science fiction generally: the controls are not glowing
glass, they are moulded plastic caps in five or six flat colours.

**What the build takes from this.** The interior palette is rebuilt around a
light grey room with an orange rail and orange helm housing, not the charcoal
console the first pass assumed. The bridge shell is ten 36° bays with a 40.5°
viewer bay, the turbolift door goes 36° to port of aft, and each bay carries one
station — which the ten documented departments fill exactly.

Sources: [Ex Astris Scientia — Design Issues of the Original Enterprise](https://www.ex-astris-scientia.org/articles/enterprise-issues.htm),
[Collecting Trek — Is the Enterprise bridge rotated 36 degrees?](https://collectingtrek.ca/2024/05/02/bridge-rotated/),
[Star Trek Prop Authority — TOS Enterprise Bridge Blueprints](http://www.startrekpropauthority.com/2010/05/star-trek-original-series-uss.html),
[Hobbytalk — TOS bridge colours](https://www.hobbytalk.com/threads/tos-bridge-colours.406748/),
[Memory Alpha — Constitution class sets](https://memory-alpha.fandom.com/wiki/Constitution_class_sets)

---

## 9. How the sounds were actually made

The 1966 effects were built by Douglas Grindstaff, Jack Finlay and Joseph
Sorokin out of recorded objects and tape manipulation, on a Moviola, with fades
cut into magnetic stock using a razor blade. Every documented technique is a
recipe rather than a recording, which is exactly what a synthesiser can follow.

| Effect | How it was made |
|---|---|
| Transporter | musical tones layered over electric-generator noise; the motor of a 3M tape recorder is named as one ingredient, along with less dignified sources |
| Communicator | an owl chirp, sped up, then cut |
| Bridge ambience | continuous panel bleeps and chirps over a bed — every set had its own sonic identity |
| Transporter room | a throb of power, distinct from the bridge |
| Engineering | the same idea an octave down: heavy generators |

**What the build takes from this.** Three things, and they are the difference
between "a beep" and the sound you recognise:

1. **Layering over a noise bed, not a clean tone.** The transporter is musical
   partials *on top of* generator noise. `sfx.js` builds it from eleven beating
   partials over a filtered wash for that reason.
2. **Speed manipulation of a natural recording.** An owl chirp sped up is a fast
   rising glide with formant structure — which is a frequency sweep with a
   resonant filter tracking it, not a sine bleep.
3. **Every room has its own ambience.** The bridge is chirps over a hum;
   engineering is the same bed pitched down and louder. That is a per-room
   property, not one global drone.

Sources: [CineMontage — Douglas Grindstaff's sound effects for the original Star Trek](https://cinemontage.org/sound-effects-original-star-trek/),
[Memory Alpha — Douglas H. Grindstaff](https://memory-alpha.fandom.com/wiki/Douglas_H._Grindstaff),
[Audible — Behind Star Trek's iconic sounds](https://www.audible.com/blog/kittens-kisses-and-razorblades-behind-star-treks-iconic-sounds)

---

## Attribution

Star Trek and all associated marks are the property of Paramount. This dossier
records publicly documented facts and measurements, restated in my own words,
with links to the sources consulted. No text, artwork, audio or other creative
material from any source listed here is reproduced in this repository.
