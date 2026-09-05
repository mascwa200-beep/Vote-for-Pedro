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

## 10. Standard orbit, and what it looks like out of the window

"Standard orbit, Mr. Sulu" is the most-given order in the show after "engage",
and it is the one that turns a system from a dot on a chart into a place you are
actually at. It is also the order everything else at a planet hangs off: it is
the position from which orbital scans are run, from which the surface is hailed,
and — the part that matters most for this game — from which a landing party can
be put down and taken back.

**The altitude is a band, not a number.** Standard orbit runs roughly one to
seven thousand miles up: **2,600 to 11,300 km**. That is a range because it is
supposed to be — the altitude is chosen for the world, the scan and the
transporter, and a starship holds it rather than being fixed at one figure.

### What that band means, arithmetically

The show does not have to answer this and the renderer does. For an Earth-sized
world (R = 6,371 km, μ = 3.986 × 10¹⁴ m³/s²), the two ends of the band are two
completely different pictures:

| | bottom of the band | top of the band |
|---|---|---|
| Altitude | 1,600 km = **0.25 R** | 11,300 km = **1.77 R** |
| Period | ≈ 2 hours | ≈ **6½ hours** |
| Angular radius of the disc | asin(1/1.25) = **53°** | asin(1/2.77) = **21°** |
| Disc across | **106°** | **42°** |

**Low down, the world is wider than the window.** At 106° across against a 74°
viewer there is no planet in frame at all — only ground, a horizon 37° below
local level, and space above it. **From the top of the band the whole world
fits**, with room around it, which is the shot everyone pictures: a disc across
the lower half of the screen with a terminator on it.

**Either way the camera has to look down.** The world is directly beneath the
ship and not ahead of it, so a viewscreen pointed along the orbital track sees
nothing but stars. The axis has to be tipped to within a few degrees of straight
down before there is anything on the screen at all.

**A pleasant consequence of Kepler.** For a body of uniform density the period
of a circular orbit at a fixed *multiple* of the radius does not depend on the
radius: μ = (4/3)πGρR³ and a = (1+h)R, so R cancels and the period falls out of
the **density alone**. A gas giant is orbited slowly and a rock quickly whatever
their sizes, and nothing had to be invented to get there.

**What the build takes from this.** Orbit becomes a real state the ship is in
and not a label: an order to enter it, an order to break it, the top of the
documented band for its altitude, an orbital position advancing in real time on
a period computed from the world's density, and the world turning on its own
axis at the rate its type actually turns — ten hours for a gas giant, twenty-seven
days for a tide-locked moon. The terminator is not drawn: the key light is
pointed from the world at the system's own primary, and the terminator is
wherever that puts it.

Sources: [Memory Alpha — Standard orbit](https://memory-alpha.fandom.com/wiki/Standard_orbit),
[Memory Alpha — Orbit](https://memory-alpha.fandom.com/wiki/Orbit),
[The Physics of Science Fiction — Star Trek: Orbits](https://physicsofscifi.blogspot.com/2012/07/star-trek-orbits.html)

---

## 11. Where things are on the ship

The game has eight compartments, which is a menu rather than a vessel. Before
adding more, the question is where they actually go — and the honest answer is
that the show never settled it. Deck numbers were assigned line by line across
three seasons by people who were not keeping a plan, so several rooms have two
or three canonical decks. What follows is what is documented, with the
contradictions left visible rather than smoothed over.

| Compartment | Deck | Note |
|---|---|---|
| Bridge | **1** | Never in dispute. |
| Recreation room | **3** | "Recreation room 3", deck 3. |
| Sickbay | **6** | Also placed on 5 and 7 elsewhere in the show. |
| Briefing room | **7** | |
| Main brig | **7** | **Adjoining the briefing room** — the one adjacency the show is explicit about. |
| Armoury | **7** | Same deck as the brig. |
| Hangar deck | secondary hull, aft | No deck number given. The secondary hull is stated as sixteen decks tall. |

**The one fact worth building around** is that the brig adjoins the briefing
room. It is the only interior adjacency the show states outright, and an
adjacency is worth more to this game than a deck number: a deck number is a
label on a turbolift button, while an adjacency is a door you can walk through.

**What the build takes from this.** Deck numbers are used where documented and
the ship's existing assignments are left alone where the show contradicts
itself — moving sickbay between 5, 6 and 7 to chase an inconsistency the source
material never resolved buys nothing. What is built is the *connectivity*: a
corridor per populated deck, junctions where corridors meet, and the brig
opening onto the briefing room because that is what the record says.

Sources: [Memory Alpha — Constitution class decks](https://memory-alpha.fandom.com/wiki/Constitution_class_decks),
[Memory Alpha — Constitution class](https://memory-alpha.fandom.com/wiki/Constitution_class),
[Cygnus-X1 — Star Trek Blueprints: Constitution Class general plans](https://www.cygnus-x1.net/links/lcars/star-trek-blueprints.php)

---

## 12. The sector map has a third axis, and the real one is not flat

The galaxy map in this game is drawn flat, and flat is the wrong shape.

**The local neighbourhood is not a disc.** Within about 20 light years of Sol
there are roughly a hundred stars, and they are spread through that volume in
every direction. The galactic disc near Sol is on the order of a thousand light
years thick, so at twenty light years there is no flattening to speak of: the
nearest stars really do sit above and below as often as beside. Alpha Centauri
is nearly sixty-one degrees *below* the celestial equator; 61 Cygni is
thirty-nine degrees above it. A map that puts them both on a tabletop is not a
simplification of the real arrangement, it is a different arrangement.

**Trek's own maps are flat for a different reason.** The quadrant charts are
drawn as a disc because at that scale the galaxy really is one: about a hundred
thousand light years across and about a thousand thick, which is a ratio of a
hundred to one. Flat is honest for a quadrant and dishonest for a sector.

**Which of these places are real stars.** Several are, and the identifications
are published rather than invented:

| In the game | Real star | Distance | Declination |
|---|---|---|---|
| Vulcan | 40 Eridani A | 16.3 ly | −7° 39′ |
| Alpha Centauri | Alpha Centauri | 4.37 ly | −60° 50′ |
| Wolf 359 | Wolf 359 | 7.86 ly | +7° 01′ |
| Tellar Prime | 61 Cygni | 11.4 ly | +38° 45′ |
| Andoria | Epsilon Indi | 11.9 ly | −56° 47′ |
| Vega Colony | Vega | 25.0 ly | +38° 47′ |
| Beta Reticuli | Zeta Reticuli | 39 ly | −62° 30′ |

The Vulcan identification is the strongest of them: Roddenberry co-signed a
letter to *Sky & Telescope* in July 1991, with three astronomers, naming 40
Eridani A as Vulcan's sun. The rest come from Geoffrey Mandel's *Star Trek Star
Charts*, which is the closest thing the franchise has to a published atlas.

**What the build takes from this, and what it does not.** It does not take the
coordinates. The game's `x` and `y` are an authored layout — they were chosen so
the sectors read clearly and so the travel times between neighbours are the ones
the campaign is balanced around, and Rigel is 22 units away in this game against
860 light years in the sky. Replacing them with astrometry would move every
system, change every warp transit, and rebalance the whole campaign to buy
accuracy nobody can see.

What it takes is the **shape**: the map is given a third axis with a spread
comparable to the other two, because that is what the real neighbourhood looks
like, and because a sector map you can only look at from above is the one thing
Star Trek Online's does that this one could not. Depth is assigned per sector
rather than per star, so the political blocs sit at different heights and the
map reads as a volume with structure in it instead of a scatter. Where a system
has a real counterpart in the table above, the SIGN of its depth follows the
real declination — Alpha Centauri below the plane, 61 Cygni above it — so the
one thing that is free to be true is true.

Sources: [Sky & Telescope — the 1991 letter identifying 40 Eridani A](https://skyandtelescope.org/astronomy-news/vulcan-40-eridani/),
[Memory Beta — Star Trek Star Charts](https://memory-beta.fandom.com/wiki/Star_Trek:_Star_Charts),
[SIMBAD astronomical database](https://simbad.u-strasbg.fr/simbad/),
[NASA — the Milky Way's structure](https://science.nasa.gov/resource/the-milky-way-galaxy/)

---

## 13. Every hull, to its published numbers

The ships in this game are all the same size. That is not a figure of speech.

`hullScale` compresses length logarithmically before anything is drawn:

```js
108 * (0.5 + 0.5 * Math.log10(metres / 20) / Math.log10(150))
```

Measured against a Constitution, this is what the renderer actually produces:

| class | real length | true ratio | drawn at |
|---|---|---|---|
| Danube runabout | 23 m | 0.08× | **0.67×** |
| Defiant | 171 m | 0.59× | **0.93×** |
| Constitution | 289 m | 1.00× | 1.00× |
| Excelsior | 467 m | 1.62× | **1.06×** |
| Galaxy | 641 m | 2.22× | **1.10×** |
| D'deridex | 1042 m | 3.60× | **1.17×** |
| Borg cube | 3040 m | 10.52× | **1.31×** |

A three-kilometre cube draws a third larger than a heavy cruiser. A
twenty-three-metre runabout draws two-thirds its size. The lengths were already
right; the function consuming them threw the information away.

### The table

Length × beam × height in metres, then decks and complement. **Bold** figures
are well attested across the published technical material. Figures in brackets
are the game's own, kept where the source material gives no number — they are
proportions read off the screen, and they are marked so nobody mistakes them for
measurements.

| Class | Length | Beam | Height | Decks | Crew |
|---|---|---|---|---|---|
| Constitution | **289** | **132** | **73** | **23** | **430** |
| Constitution (refit) | **305** | **132** | **71** | **23** | 500 |
| Miranda | **278** | **141** | **62** | (12) | 220 |
| Oberth | **120** | **66** | **35** | (8) | 80 |
| Excelsior | **467** | **186** | **78** | **34** | 750 |
| Constellation | **260** | **160** | **60** | (14) | 535 |
| Ambassador | **526** | **326** | **130** | **36** | 700 |
| Galaxy | **641** | **464** | **195** | **42** | **1012** |
| Nebula | **442** | **318** | **130** | (30) | 750 |
| Intrepid | **345** | **132** | **66** | **15** | **141** |
| Defiant | **171** | **134** | **30** | **4** | **50** |
| Sovereign | **685** | **251** | **88** | **24** | **855** |
| Danube runabout | **23** | **14** | **5** | **1** | **4** |
| B'rel bird-of-prey | **158** | **182** | **98** | (3) | 12 |
| D7 battlecruiser | **228** | **152** | **60** | (18) | 400 |
| K't'inga | **235** | **152** | **60** | (18) | 440 |
| Vor'cha | **481** | **342** | **107** | (28) | 1900 |
| Negh'Var | **682** | **470** | **137** | (35) | 2500 |
| D'deridex warbird | **1042** | **774** | **307** | (60) | 1500 |
| Romulan scout | (68) | (44) | (18) | (3) | 24 |
| Galor | **372** | **192** | **59** | (16) | 300 |
| Keldon | (400) | (208) | (64) | (18) | 400 |
| D'Kora marauder | **367** | **234** | **103** | (20) | 450 |
| Orion raider | (110) | (64) | (30) | (5) | 60 |
| Tholian web spinner | (130) | (96) | (26) | (4) | 12 |
| Jem'Hadar attack ship | **179** | **130** | **26** | (3) | 50 |
| Jem'Hadar battleship | (800) | (420) | (150) | (40) | 900 |
| Borg cube | **3040** | **3040** | **3040** | — | 64000 |
| Bioship | (600) | (420) | (200) | — | 1 |
| Transport | (120) | (58) | (34) | (6) | 1400 |
| Freighter | (220) | (92) | (58) | (10) | 14 |

### Three of these break the obvious rules, and they are supposed to

**A Bird-of-Prey is wider than it is long.** 182 metres across the wings against
158 nose to tail. It is the only hull in the table like that, it is why the
`wings` primitive exists in the mesh builder, and any check that asserts "beam
is less than length" has to know about it or it will be quietly wrong for the
one ship whose shape is its whole identity.

**A Borg cube is a cube.** Length, beam and height are all 3,040 metres. It has
no decks in any sense the word applies to, and no beam-versus-length relation to
test.

**The contradictions are left in.** The Miranda is given as 243 m in some
published material and 277.6 m in others; K't'inga figures range from 228 m to
349 m. Where sources disagree the game's existing figure is kept, because
changing it would move a hull that the balance was tuned against to buy nothing
except a different disputed number.

### What the build takes from this

The compression goes. `hullScale` becomes length in metres times one constant,
chosen so a Constitution keeps roughly the size it draws at today — which makes
this a change to *relative* size only and leaves every existing weapon arc,
range and camera distance meaningful.

Beam, height and decks are recorded now and used later. Turning them into
geometry means giving each class its own silhouette instead of the one shared
`starfleet` form, and that is its own piece of work. Recording them first means
the numbers are sitting there, checkable, when it starts.

Sources: [Memory Alpha — Constitution class](https://memory-alpha.fandom.com/wiki/Constitution_class),
[Memory Alpha — Galaxy class](https://memory-alpha.fandom.com/wiki/Galaxy_class),
[Memory Alpha — Defiant class](https://memory-alpha.fandom.com/wiki/Defiant_class),
[Memory Alpha — B'rel class](https://memory-alpha.fandom.com/wiki/B%27rel_class),
[Memory Alpha — D'deridex class](https://memory-alpha.fandom.com/wiki/D%27deridex_class),
[Memory Beta — Star Trek: Star Charts](https://memory-beta.fandom.com/wiki/Star_Trek:_Star_Charts)

---

## 14. Twelve ships, one silhouette

Every Federation hull in this game is the same shape.

`BLUEPRINTS` gives twelve classes `form: 'starfleet'` — the refit, Miranda,
Oberth, Excelsior, Constellation, Ambassador, Galaxy, Nebula, Intrepid,
Defiant, Sovereign and the runabout. That form builds one topology: a round
saucer, a tapering secondary hull, and two cylindrical nacelles on swept box
pylons. The parameters differ; the shape does not. An Intrepid and a Sovereign
are the same object at different sizes, and now that the sizes are true, being
the same object is the only thing left that is wrong.

### What actually tells them apart

Not proportions. **Topology.** These are the structural facts that make each
class recognisable from a distance, which is the only distance that matters on
a tactical plot:

| Class | The thing that identifies it |
|---|---|
| Constitution (refit) | Flat-topped saucer, thin nacelles on flat swept pylons |
| Miranda | **No secondary hull at all** — nacelles hang directly beneath the saucer, and a rollbar carries the weapon pod above it |
| Oberth | Saucer above, a **separate lower hull** slung under it on two struts, nacelles on the lower hull |
| Excelsior | Elongated saucer, long dorsal neck, **tall vertical pylons** |
| Constellation | **Four nacelles**, in two stacked pairs |
| Ambassador | Wide saucer, low profile, nacelles close in — the transitional shape |
| Galaxy | **Ovoid saucer**, thick neck, nacelles swept up and back |
| Nebula | Galaxy saucer with a **dorsal pod** where the swept nacelle arrangement would be |
| Intrepid | Narrow secondary hull, nacelles raised on **hinged pylons** |
| Defiant | **No saucer** — one wedge body with the nacelles buried in it |
| Sovereign | Raked elliptical saucer, nacelles low and swept back |
| Danube runabout | A box with two nacelles and no saucer at all |

Four of those cannot be expressed by the current form at any parameter setting:
a Miranda has no secondary hull, an Oberth has two hulls, a Constellation has
four nacelles, and a Defiant and a runabout have no saucer. Those are not knobs;
they are different builders.

### What the primitives can already do, and the one gap

`saucer`, `tube`, `box` (with `sweep`, which shears one end backwards and is how
a slab becomes a swept pylon), `sphere` and `mirrored` cover almost all of it.
Four nacelles is `mirrored` called twice at different heights. A rollbar is two
boxes and a tube. A second hull is a second `tube`.

The gap is that **`saucer` is circular**. It steps around a full turn at a fixed
radius, so it cannot make the ovoid the Galaxy has, the ellipse the Sovereign
has, or the elongated disc on an Excelsior. That is one parameter — a stretch
along the long axis — and it unlocks three of the twelve.

### What the build takes from this

A builder per silhouette rather than per class, because several classes share a
silhouette family and the differences between those really are proportions. The
families are: the classic two-nacelle cruiser, the no-secondary-hull Miranda,
the twin-hull Oberth, the four-nacelle Constellation, the pod-carrying Nebula,
the saucerless wedge, and the box-with-nacelles runabout.

Beam and height from §13 drive them. A Galaxy is 641 m long and 464 m wide, a
ratio of 0.72; an Intrepid is 345 by 132, a ratio of 0.38. Those two numbers
alone make one hull broad and the other narrow without a single value being
guessed, which is the entire reason §13 recorded beam in the first place.

Sources: [Memory Alpha — Miranda class](https://memory-alpha.fandom.com/wiki/Miranda_class),
[Memory Alpha — Oberth class](https://memory-alpha.fandom.com/wiki/Oberth_class),
[Memory Alpha — Constellation class](https://memory-alpha.fandom.com/wiki/Constellation_class),
[Memory Alpha — Nebula class](https://memory-alpha.fandom.com/wiki/Nebula_class),
[Cygnus-X1 — Star Trek Blueprints](https://www.cygnus-x1.net/links/lcars/star-trek-blueprints.php)

---

## 15. The other two axes: what the beam and height figures were actually worth

§13 recorded length, beam and height for all thirty-one classes, and Phase B
used exactly one of the three. Length set the on-screen size; beam and height
sat in the table and nothing read them. This is what the models were doing
instead, measured by building each hull and taking its bounding box:

| class | drawn beam ÷ length | published | drawn height ÷ length | published |
|---|---|---|---|---|
| Constitution | 0.647 | 0.457 | 0.488 | 0.253 |
| Excelsior | 0.600 | 0.398 | 0.454 | 0.167 |
| Oberth | 0.776 | 0.550 | 0.694 | 0.292 |
| Miranda | 0.990 | 0.507 | 0.369 | 0.223 |
| Sovereign | 0.529 | 0.366 | 0.261 | 0.128 |
| Bird-of-Prey | 0.899 | 1.152 | 0.244 | 0.620 |

Every Federation hull was between 1.2× and 2.0× too wide and between 1.1× and
2.7× too tall. An Excelsior stood at 2.7 times its own height. The alien forms
were much closer — the wedges and haulers came in at 0.9–1.3 — because those
builders were written against a length-and-width table and the Starfleet ones
were shaped by eye.

The single largest error was the saucer. A `starfleet` hull drew a primary hull
0.72 of the ship's length across; a Constitution's is 0.44, and on every
two-nacelle Starfleet cruiser **the published beam IS the saucer diameter**,
because the nacelles sit inboard of the rim on all of them. That one identity
fixes the saucer on eight classes without a value being chosen.

Three classes break it, and they break it the same way: on a Miranda, a
Constellation and a Danube runabout the widest point is the NACELLES, not the
primary hull. Those forms take the saucer as a fraction of the beam instead.

A Bird-of-Prey is the mirror-image error. Its published height is 0.62 of its
length — the tallest figure in the whole table — because the figure is taken
with the wings DOWN, and the model drooped them barely at all.

### What the build takes from this

Two ratios, `beam ÷ length` and `height ÷ length`, handed to every builder
against a hull that spans one unit fore and aft. Saucer radius, hull radius,
nacelle height, nacelle radius, pylon height and rollbar span all derive from
them, so a blueprint entry carries only what is genuinely per-ship: how raked
the saucer is, how far the pylons sweep, how long the nacelles run.

Two tests hold it. The first measures the built mesh and requires drawn
beam-over-length and height-over-length to equal the published figures within
2%. The second is the one that matters: the normalising step at the end of
`hullMesh` would satisfy the first test whatever shape the builder produced, so
`proportionError` measures how much squashing that step has to do, and it must
stay under 1.25 — which forces the FORMS to be right and leaves the normaliser
only the last few percent. A nacelle built round and then squashed 2:1 is an
ellipse, and no test that only checks the final bounding box would ever say so.

Sources: the same figures recorded in §13, re-read as three numbers rather than
one. [Memory Alpha — Constitution class](https://memory-alpha.fandom.com/wiki/Constitution_class),
[Memory Alpha — Bird-of-Prey](https://memory-alpha.fandom.com/wiki/Klingon_Bird-of-Prey),
[DITL — ship specifications](https://www.ditl.org/)

---

## 16. The gap under the nacelles

The thing that makes a Starfleet ship read as a Starfleet ship, once the saucer
is right, is empty space. The nacelles are carried well clear of the hull on
struts, and you can see sky between them and the engineering hull from almost
every angle. That gap is most of the silhouette.

The models had no gap. Each pylon was an axis-aligned box sized to span the
whole distance from hull to nacelle in *both* the vertical and the transverse
direction — which is not a strut, it is a solid block filling the corner. On a
Galaxy each of the two blocks measured 0.07 × 0.24 × 0.25 of the ship's length:
a slab a quarter of the ship across and nearly a quarter of it tall, and the
first thing the eye landed on.

What the published drawings actually show, measured off the orthographic views:

| class | pylon chord ÷ length | thickness ÷ length | notes |
|---|---|---|---|
| Constitution (1966) | ~0.14 | ~0.01 | slender, raked aft, near-constant chord |
| Constitution refit | ~0.17 | ~0.03 | thicker and swept forward |
| Excelsior | ~0.15 | ~0.02 | nearly vertical, tall |
| Galaxy | ~0.14 | ~0.03 | heavily swept, tapering outboard |
| Intrepid | ~0.13 | ~0.02 | variable-geometry, measured stowed |

Chord — the fore-and-aft measurement, the one you see from the side — is
between an eighth and a sixth of the ship's length on every one of them.
Thickness is one to three per cent. So a pylon is a wing: broad in profile,
almost invisible head-on. The blocks had it exactly backwards, being thin in
the one direction that should be broad.

The fix is a shear rather than a shape. A box whose top face is displaced
outboard by the width of the gap is a leaning blade with the same eight
corners, so the primitive stays a box and the pylon becomes a strut. The
measurable effect, and the one the tests assert: how much of a hull's surface
area faces fore-and-aft against how much faces up and down. A ship is
streamlined and that ratio is small; two corner blocks are a wall and it is
not. Across the thirteen Federation classes it fell from 0.19–0.38 to
0.06–0.27.

The same measurement found a second thing worth recording. The secondary hull
sat at 0.24 of the ship's height below the saucer, which on most classes put
the two masses in contact — no daylight, no visible neck, one lump. The
published side views put it at roughly 0.4–0.45 of the height down, and the
overall height figure is preserved regardless because the mesh is rescaled onto
the published ratio afterwards. Moving it down costs nothing and buys the
profile.

Sources: orthographic views and dimension figures as recorded in §13 and §15,
re-read for the strut geometry rather than the envelope.
[Memory Alpha — Constitution class](https://memory-alpha.fandom.com/wiki/Constitution_class),
[Memory Alpha — Galaxy class](https://memory-alpha.fandom.com/wiki/Galaxy_class),
[DITL — ship specifications](https://www.ditl.org/)

---

## 17. What the other four stations do while the shooting is going on

The bridge officer powers were written for the three departments that fire
things: tactical, engineering, science. Medical and operations got no table of
their own and were quietly pointed at Command's, so the doctor and the helmsman
called attack patterns. That is not a modelling shortcut, it is a gap in what
the game thinks a bridge is for — so this is what the other stations are shown
doing under fire, and what each of the new abilities is modelled on.

**The doctor.** The medical officer's war is casualties, and it is fought in
three ways. Triage — sorting the wounded so the ones who can be saved are
treated first — is the standing procedure and is what makes the difference
between casualties and deaths. Stimulants and pressure hypos put people back on
their feet for the duration of an emergency, explicitly at a cost paid
afterwards. And a single officer pulled out of sickbay and returned to a post
can matter more than a dozen crew, because a bridge station standing empty is a
capability the ship has lost. So: casualty reduction over a window, a wounded
officer back on duty, and the crew pushed past what they have left.

**The helm.** Evasive action is the helmsman's, not the captain's — the captain
orders it and the helm flies it, and the named patterns are the helm's own
repertoire. Full or emergency impulse for a short burst is repeatedly shown as
something the engines will tolerate briefly and object to afterwards. And
ramming speed, when it is ordered, is ordered to the helm; it sits in the
engineering table in this game only because that is where somebody put it. It
belongs at the conn.

**Communications.** Three distinct jobs beyond hailing. Jamming an opponent's
targeting or comms is a comms function as often as a science one. Traffic
analysis — reading who is signalling whom, and inferring intent before the
shooting starts — is the one that has no combat equivalent in the game yet and
is the most worth having. And the false signal: a fake transponder, a decoy
distress call, a ship that appears to be somewhere it is not. The game already
has decoys as a tactical device; this is the same idea coming from the comms
station and aimed at what the enemy *believes* rather than what it shoots at.

**Command.** Battle stations is a real state change, not an announcement: it is
the ship going from cruising to fighting, with everything that entails. Holding
formation is what a command officer does with an ally present — and the game
has allies now, arriving on a distress call, with nothing to say to them.

None of this needs a number from a technical manual, because none of it is a
dimension. What it needs is that each ability does something the department is
actually for, and that it is not a reskin of a power another department already
has. The three medical abilities are the first in the game whose payoff is
`crew` and `injured` rather than hull and shields, which is the test of whether
the department was worth adding at all.

Sources: the depiction of bridge duty stations across the series, as summarised
in the reference material rather than quoted from it.
[Memory Alpha — bridge](https://memory-alpha.fandom.com/wiki/Main_bridge),
[Memory Alpha — conn](https://memory-alpha.fandom.com/wiki/Conn),
[Memory Alpha — evasive manoeuvres](https://memory-alpha.fandom.com/wiki/Evasive_maneuvers),
[Memory Alpha — triage](https://memory-alpha.fandom.com/wiki/Triage)

---

## 18. The other four hundred and twenty people

§1 records the Constitution's complement as 430 and the build uses it. What that
number is made of is published too, and it is more useful than the total.

**Forty-three officers and three hundred and eighty-seven enlisted.** The split
comes from a display graphic seen on screen, and it is the figure to build on:
the bridge has about ten people at stations, so roughly thirty more officers are
aboard doing something, and the enlisted are the ship's body. A duty roster
should be drawn from the officers, because those are the people a captain would
know by name, and it should be well short of thirty — a captain knows the ones
who matter to them.

The 203 figure from the original pitch and the 430 from Roddenberry's 1967
revision of *The Star Trek Guide* are already reconciled in §1 in favour of 430;
nothing here changes that.

**Three divisions, and the game is already wearing their colours.** In the
2260s Starfleet organised into command, operations and sciences, and the bridge
this game draws already puts officers in the right shirts:

| Division | Colour | What it covers |
|---|---|---|
| Command | Gold | Captains, executive officers, adjutants, and the pilots — helmsmen and navigators |
| Operations | Red | Security, engineering, maintenance, communications, yeomen, staff officers |
| Sciences | Blue | Sensors, research, theoretical and physical laboratory work, biological studies, technicians, medics, surgeons |

**The one that catches people out is communications.** Uhura wears operations
red, not command gold — communications is an operations speciality. So does
Scott, and so does Yeoman Rand. The division a job belongs to is not always the
one its bridge station suggests, and a speciality table built from the stations
alone would get comms and the yeoman wrong.

**What the build takes from this.** The three divisions and the specialities
named inside them become the duty-officer speciality table, so a specialist is a
job the show actually named rather than one invented to fill a grid. The 43/387
split sets the size of the roster: a handful of named specialists out of the
forty-three, scaled to the hull, and not one row per crewman — the other three
hundred and eighty-seven stay the number they have always been, which is what
the casualty count has always counted.

What it does not take is a rank structure for them. `Officer` already carries
rank, station and four scores, and a duty officer is a lighter record of the
same shape; inventing a parallel hierarchy would be a second system that means
the same thing.

Sources: [Memory Alpha — USS Enterprise (NCC-1701)](https://memory-alpha.fandom.com/wiki/USS_Enterprise_(NCC-1701)),
[Memory Alpha — Command division](https://memory-alpha.fandom.com/wiki/Command_division),
[Memory Alpha — Operations division](https://memory-alpha.fandom.com/wiki/Operations_division),
[Memory Alpha — Sciences division](https://memory-alpha.fandom.com/wiki/Sciences_division),
[Memory Alpha — USS Enterprise (NCC-1701) personnel](https://memory-alpha.fandom.com/wiki/USS_Enterprise_(NCC-1701)_personnel)

---

## 19. Things that were installed together

The consoles in this game are a flat list: fourteen of them, each with its own
modifier, and no reason to prefer any combination over any other. Star Trek
Online's answer to that is the equipment set — pieces that are worth more
together than apart — and the reason it works there is the reason it works
here: real refits came as packages.

**The 2270s refit is a documented package, not a list of separate upgrades.**
When the Constitution went in for the work that produced what is now called the
Constitution II, the changes were tied to each other:

- The phasers were **run off the main reactor**. Power came directly from the
  engines, which is why they cut out automatically on an antimatter imbalance —
  a weapon that draws from the warp plant cannot fire while the plant is sick.
- New **nacelles and pylons**, the most visible change of the refit.
- A **twin photon torpedo and probe launcher** on top of the secondary hull.
- The phaser banks moved to the main strut, from under the saucer.

The coupling is the interesting part. The phaser upgrade is not independent of
the engine upgrade; it is a consequence of it. That is a set bonus described in
prose forty years before the mechanic existed.

**The deflector and the sensors were one system.** On a Constitution the
navigational deflector was a combined installation with the ship's main
duotronic sensors, and the ship carried two sensor arrays, one on top of the
primary hull and one beneath. The deflector dish at the front of the secondary
hull emitted low-power shields against dust and heavier beams against anything
larger. So the shield emitter, the sensor array and the deflector are not three
independent boxes a quartermaster picked off a shelf: they are one suite, and
fitting part of it is fitting part of a system.

**What the build takes from this.** Two sets, each grounded in a package that
was really installed as a package rather than assembled to fill a grid:

| Set | Pieces | Why they belong together |
|---|---|---|
| Refit weapons package | Prefire chamber, EPS regulator, phaser relay | The phasers run off the main reactor |
| Duotronic suite | Field emitter, multispectral sensors, shield capacitor | The deflector and the sensors are one installation |

Two pieces give a modest bonus and three give a larger one, which is STO's
shape. What it does NOT take is STO's rarity ladder or its upgrade economy:
those are a free-to-play game's retention mechanics, and this game has no
retention to buy.

Sources: [Memory Alpha — Constitution II class](https://memory-alpha.fandom.com/wiki/Constitution_II_class),
[Memory Alpha — phaser bank](https://memory-alpha.fandom.com/wiki/Phaser_bank),
[Memory Alpha — navigational deflector](https://memory-alpha.fandom.com/wiki/Navigational_deflector),
[Memory Alpha — sensor array](https://memory-alpha.fandom.com/wiki/Sensor_array),
[Memory Alpha — duotronics](https://memory-alpha.fandom.com/wiki/Duotronics)

---

## 20. Working her up

Star Trek Online's starship mastery is a bar that fills as you fly a hull and
pays out passive bonuses on the way, ending in a trait you keep. The reason to
take it is not that other games have bars. It is that the thing the bar
represents is stated out loud in Star Trek, twice, in the same film, from both
directions.

**Familiarity with a hull is a named, specific advantage — and it is
class-bound.** Decker's whole argument against Kirk taking the Enterprise in
*The Motion Picture* is not seniority or temperament. It is that the ship has
been refit, and Kirk's familiarity with her is therefore worth nothing. That is
a mechanic: an officer accumulates something real by flying a particular
vessel, it is measured against that vessel, and changing the vessel spends it.
The film treats it as an argument serious enough to take command over.

**A ship that has not been worked up performs worse than the same ship
later.** The other direction is the same film's first act. The refit took
eighteen months; Scott told Kirk it could not be finished in twelve hours and
that the ship still needed a proper shakedown; Kirk sailed anyway. The
unbalanced warp drive then opened a wormhole that nearly took the ship, and —
the detail that matters here — the phasers cut out automatically, because the
refit runs them through the main engines and the engines were sick. Every one
of those failures is the ship being at less than her own specification because
nobody had yet worked her up.

So the two halves of a mastery track are both canon: the ship gets better as
her crew learns her, and what is learned belongs to that class of ship.

**What the game can and cannot take from this.** The player is given one
command at the start of the commission and never gets another — `Game` builds
`this.ship` once and nothing anywhere replaces it. So the per-class half of
STO's system has nothing to bite on here: there is exactly one class to master,
and a second command is a campaign feature that does not exist. Mastery is
therefore tracked per class, because that is what it is, but in practice it
describes one crew learning one ship over five years.

**What the build takes from this.** A mastery track on the hull, fed by the
things that actually teach a crew a ship — time under way, battles fought,
missions completed — with five tiers. The first four give small passive
improvements to the ship: she holds together better, she turns better, the
guns are quicker. The fifth opens a slot and a choice of three starship traits,
which is where the decision is.

It DOES take the penalty below the class baseline for a fresh hull, which is
the half of this that STO has no version of. A ship straight out of the yard
runs under her own numbers: the drive will not quite make her speed, the
batteries are still walking their shot in, and damage control have never run a
casualty on this hull. Every one of those is something the film shows going
wrong on a ship that sailed without a shakedown.

That was a deliberate decision, taken after the first version shipped
additive-only. The argument against it is real — it makes the opening weeks
worse for a player who has just started — and the argument for it is that the
arc is the point of a five-year commission. A ship that is merely less good
than she will become is not the same thing as a ship that is worse than she
should be, and only the second gives the first tier anything to be.

It is cleared entirely by the first tier, which is why that tier is called
Shakedown complete. Measured against a Bird-of-Prey over forty seeds: 87.2% of
the hull left on a fresh ship, 87.7% once the shakedown is done, 88.9% at the
top of the track. Against a D7, which a lone Constitution with no skills
invested cannot beat at all early on, the top of the track is what first wins
five of forty. The shakedown is felt and it is not a wall.

What it does NOT take is modelling the phasers cutting out altogether. A
discrete failure at a random moment is a different and much crueller mechanic
than a ship that is simply not yet at her best, and the second is what a
shakedown actually feels like.

Sources: [Memory Alpha — Star Trek: The Motion Picture](https://memory-alpha.fandom.com/wiki/Star_Trek:_The_Motion_Picture),
[Memory Alpha — Will Decker](https://memory-alpha.fandom.com/wiki/Will_Decker),
[Memory Alpha — wormhole effect](https://memory-alpha.fandom.com/wiki/Wormhole_effect),
[Ex Astris Scientia — The Enterprise Refit of 2271](https://www.ex-astris-scientia.org/articles/constitution-refit.htm)

---

## 21. Losing her, and being taken off her

The campaign gives a captain one command and never a second: `Game` builds
`this.ship` once and nothing anywhere replaces it. That makes half of the
mastery system inert — familiarity is tracked per class, and there is only ever
one class — and it makes the single most dramatic thing that can happen to a
starship captain either a game over or nothing at all.

Star Trek has both halves of the answer, and the useful thing about both is
that **neither is free**.

**Losing a ship costs you, and the replacement comes afterwards.** Kirk
destroyed the Enterprise himself at the Genesis planet rather than let her be
taken. He and his officers were then tried by the Federation Council — for
taking the ship, for destroying her, and for going to Genesis. The heroics
around the probe got almost all of it dropped; the charge that stuck was
disobeying a superior officer, he pled guilty, and he was **reduced in rank**.
Only then was he given the Enterprise-A. So the shape is: a hull is lost, there
is a reckoning, the reckoning costs something real, and a ship follows the
reckoning rather than replacing it.

The other useful detail is that he got exactly **one** replacement. A career is
not an unlimited supply of starships.

**Promotion takes you off the ship, and it reads as a loss.** This is the
inversion that makes the mechanic interesting. Kirk was promoted to Admiral and
Chief of Starfleet Operations, and the price was the Enterprise — by the time
of the refit she belonged to Decker, and Kirk had to take her back by pulling
rank on a captain who knew her better. The demotion at the end of the whale
business is what *returned* him to a ship, and the film plays it as a reward.

In Star Trek, moving up the ladder is how you stop being a starship captain.

**What the build takes from this.** Two things that both hurt.

A ship lost is a ship lost: a board of inquiry, a mark on the record, standing
spent, and another hull assigned. Not a better one — Kirk got a Constitution
for a Constitution. And not indefinitely: a second loss ends the commission,
because Starfleet gave Kirk one Enterprise-A and no more.

A promotion past a certain rank comes with the offer of a bigger command, and
the offer can be **declined**. Taking it means starting again on a hull nobody
aboard has worked up — the shakedown penalty from §20 applies to the new class,
and the five years of familiarity built in the old one stay with the old one.
That is Decker's argument from §20 turned around and handed to the player as a
decision: is a bigger ship you do not know worth more than a smaller one you
do? Mastery is already keyed by class, so a captain who takes the new hull and
later returns to the old one finds his crew still know her.

Sources: [Memory Alpha — Star Trek IV: The Voyage Home](https://memory-alpha.fandom.com/wiki/Star_Trek_IV:_The_Voyage_Home),
[Memory Alpha — USS Enterprise (NCC-1701-A)](https://memory-alpha.fandom.com/wiki/USS_Enterprise_(NCC-1701-A)),
[Memory Alpha — court martial](https://memory-alpha.fandom.com/wiki/Court_martial),
[Memory Alpha — Star Trek: The Motion Picture](https://memory-alpha.fandom.com/wiki/Star_Trek:_The_Motion_Picture)

---

## 22. What a board of inquiry actually is

§21 established that losing a ship costs something. This is about the shape of
the costing, because the game already prints the words "there will be a board
of inquiry" and then holds no board.

Starfleet's disciplinary procedure, as the series shows it, has three features
worth building on.

**It convenes at a starbase, not in the field.** When Kirk is accused over the
death of his records officer in *Court Martial*, the proceedings are held at
Starbase 11 — the ship puts in, the officers are ashore, and the board sits in
a room. The same pattern recurs: a hearing needs a facility and a panel of
senior officers, and neither exists aboard a ship on patrol. So a board opened
in deep space is a thing hanging over a captain until he next makes port,
which is exactly the interval the campaign needs it to be.

**The ship's own record is the evidence.** The central device of *Court
Martial* is that the computer log is treated as incontrovertible, and Kirk's
defence is that the log has been falsified. The finding turns on the record,
not on the personalities in the room. The game already keeps a service record
with a weighted score, and that number currently does nothing but print itself
on a screen — so reading the verdict off it is not a mechanic invented for the
occasion; it is the mechanic the record was always for.

**The worst finding costs a rank, and the career continues.** Kirk's
court-martial after the Genesis affair (§21) ends in a guilty plea to
disobeying a superior officer and a reduction in rank from Admiral to Captain
— and the reduction is what puts him back on a ship. So the ceiling on a bad
verdict is a demotion rather than an ending, and a demotion is not a defeat
state: he goes on to command for years afterwards. A board that could end a
career at the first bad week would be a harsher service than the one depicted.

The corollary matters for the game's floor. A reduction that took a captain
below Captain would take away the starship, which the campaign is entirely
about; Kirk is reduced *to* Captain and no further, and that is where the
mechanic should stop too.

Sources: [Memory Alpha — Court Martial (episode)](https://memory-alpha.fandom.com/wiki/Court_Martial_(episode)),
[Memory Alpha — Starbase 11](https://memory-alpha.fandom.com/wiki/Starbase_11),
[Memory Alpha — court martial](https://memory-alpha.fandom.com/wiki/Court_martial),
[Memory Alpha — James T. Kirk](https://memory-alpha.fandom.com/wiki/James_T._Kirk)

---

## 23. A line on the chart that is an act of war

The game draws the Romulan Neutral Zone, says twice in its own text that
crossing it is a treaty violation, and does not make it one. Two listening
posts sit on the Federation side — "Treaty says nobody crosses. Treaty is
old." — and the Kobayashi Maru briefing turns on the same fact: entering
violates the treaty, not entering abandons three hundred and eighty-one
people. A ship can presently fly straight through and nothing happens.

The canon is unusually specific about why that matters.

**The Zone was drawn by the treaty that ended the Earth-Romulan War, and
entry by either side is an act of war.** "Balance of Terror" states this
outright, and the episode is built on it: a Romulan ship crosses, destroys the
outposts watching the border — Outpost 4 among them — and Kirk's problem
throughout is that pursuing it means crossing too. The line is not a
territorial nicety; it is the thing holding a war shut.

**Crossing it deliberately requires a cover story.** In "The Enterprise
Incident" Kirk takes the Enterprise into the Zone and the Federation's public
position is that he has had a breakdown — the mission is deniable precisely
because an admitted crossing would be an act of war. So the shape of a
sanctioned crossing is not permission openly given; it is an arrangement
nobody writes down, which is what the Romulan track's own project already
says: "Officially, this never happened."

The Treaty of Algeron is a **different** treaty and is about cloaking devices,
not about the Zone. The game already cites it correctly when refusing a
Federation captain a cloak, and the two should not be conflated.

There is no Cardassian demilitarised zone anywhere in this galaxy's data — no
sector, no systems, no border. That is a real absence rather than an oversight
to paper over, and it is why the Cardassian "Standing Treaty Rider" is still
unwired: giving a perk something to do by inventing the place it acts on is
building the world backwards.

Sources: [Memory Alpha — Romulan Neutral Zone](https://memory-alpha.fandom.com/wiki/Romulan_Neutral_Zone),
[Memory Alpha — Balance of Terror](https://memory-alpha.fandom.com/wiki/Balance_of_Terror_(episode)),
[Memory Alpha — The Enterprise Incident](https://memory-alpha.fandom.com/wiki/The_Enterprise_Incident_(episode)),
[Memory Alpha — Treaty of Algeron](https://memory-alpha.fandom.com/wiki/Treaty_of_Algeron)

## 24. What the four power channels are for

The game has had a four-channel power grid since the beginning, with the four
names Star Trek Online uses — weapons, shields, engines, auxiliary — and a
one-tap preset for each. Three of the four did what their names say. The fourth
did not, and this is what it should have been doing.

**Auxiliary is the science channel.** In Star Trek Online, the auxiliary
subsystem is the one that drives science: the strength of science bridge-officer
abilities scales off it, and so does how well the ship sees — stealth detection
and sensor performance both improve as auxiliary power rises. It is also the
channel that feeds the ship's own repair and hull-healing abilities. The reason
players run an "aux-heavy" build is precisely that it buys sensing and support
rather than damage. Its opposite is equally established: dropping auxiliary is
the standard cost paid for an attack or speed configuration, and the ship gets
worse at seeing and mending in exchange.

That is a mechanic, not a piece of dialogue, so it is reproducible in my own
terms: **the channel a ship calls auxiliary is the one that powers the sensors
and the repair parties, and spending it elsewhere costs her both.** The game's
own parser already agreed — it maps "sensors", "science", "computer" and
"transporter" onto auxiliary — and the preset already said "Science" on the
button. Only the effect was missing.

**Damage control is what the crew can spare.** Firefighting aboard a warship is
not a fixed rate. During an action the parties are whoever can be spared while
the ship is manoeuvring and taking hits; once the shooting stops, the whole
watch turns to. Naval damage-control practice is organised exactly this way —
repair parties are stationed for battle and then reinforced from the rest of
the crew once the immediate threat has passed. That is the difference the game
now models: the fire is not weaker after the battle, the response to it is very
much stronger.

Both of these are about the same idea, which is why they are one entry: a
starship is a set of finite resources a captain allocates, and the allocation
has to be visible in what she can do. A slider that changes nothing a player
can observe is not a decision.

Sources: [Star Trek Online Wiki — Power levels](https://stowiki.net/wiki/Power_level),
[Star Trek Online Wiki — Auxiliary power](https://stowiki.net/wiki/Auxiliary_power),
[Memory Alpha — Damage control](https://memory-alpha.fandom.com/wiki/Damage_control)

## 25. The other line on the chart, and why it is a different kind of line

§23 established the Romulan Neutral Zone and noted, at the end, that there is
no Cardassian demilitarised zone anywhere in this galaxy's data — and that
inventing the place a perk acts on, so the perk has something to do, is
building the world backwards. This is the place, so that it can be built the
right way round.

**The zone came out of a treaty that ended a war, and it was drawn badly on
purpose.** The Federation and the Cardassian Union fought a long border war
and settled it; the border settlement that followed established a
demilitarised zone along the new line. The line did not follow where people
actually lived. Federation colonies ended up on the Cardassian side of it and
Cardassian colonies on the Federation side, and the treaty's answer was that
the colonists could relocate or stay and live under the other government. Some
of them refused to do either, and the ones who stayed and armed themselves
became the Maquis. That is a border drawn by negotiators over the heads of the
people standing on it, which is a more interesting place than a wall.

**What makes it mechanically different from the Neutral Zone is one clause.**
The Romulan Neutral Zone is a place neither side may ENTER: "Balance of Terror"
turns on the fact that crossing it at all is an act of war. The Cardassian
zone is a place both sides may enter and neither may MILITARISE — that is what
demilitarised means, and it is the term the treaty is named for. People live
there. Freighters cross it. What does not belong there is a warship.

So the two lines want two different mechanics, and copying the first onto the
second would be wrong:

  Crossing the Neutral Zone is the violation, and it is charged once, on the
  crossing.

  Being in the demilitarised zone is not a violation. Being in it in a heavy
  cruiser is a thing the other side will come and ask you about.

That second shape is a challenge rather than a penalty, which is also what
makes the Cardassian reputation track's own tier-4 project fit it exactly:
"Standing Treaty Rider — free movement through the demilitarised zone." A
rider is an amendment to a treaty. It does not forgive a violation; it is the
paper that makes your presence lawful, which is a thing you produce when
somebody asks.

**Setlik III and the Badlands are already on this chart and are already the
right furniture.** Setlik III carries a massacre in its description and a
garrison that never stood down — the Federation-Cardassian war is what that
is about. The Badlands are a plasma-storm region on the same frontier and are
where the Maquis hid from both governments, because a region no navigator
wants to enter is exactly where an insurgency goes. The zone belongs in the
gap between them, and needed nothing invented to justify its position.

Sources: [Memory Alpha — Demilitarized Zone](https://memory-alpha.fandom.com/wiki/Demilitarized_Zone),
[Memory Alpha — Federation-Cardassian Treaty of 2370](https://memory-alpha.fandom.com/wiki/Federation-Cardassian_Treaty_of_2370),
[Memory Alpha — Maquis](https://memory-alpha.fandom.com/wiki/Maquis),
[Memory Alpha — Badlands](https://memory-alpha.fandom.com/wiki/Badlands),
[Memory Alpha — Setlik III massacre](https://memory-alpha.fandom.com/wiki/Setlik_III_massacre)

---

## 26. The words that answer a question

This game asks the captain questions. When the parser reads something it is
only half-sure of, it stops and says "I read that as *X* — confirm?", and that
is the honest half of "type anything and it works": the table cannot cover
every sentence in English, so instead of guessing it asks.

Which raises the thing this dossier is for: **what does a captain actually say
to answer?** Not what a menu offers — what the words are.

**"Make it so" is the affirmative, and it is not an invention of the
franchise.** It is a naval formula. A captain, satisfied with a report or a
proposal put to him, replies "make it so" — meaning *carry on and do the thing
you have just described to me*. It turns up in descriptions of Royal Navy
practice well before television: a 1902 account of life in the King's fleet has
a captain answering a report with "Thank you, make it so." The franchise took
it from there rather than coining it; it was first spoken in the pilot of *The
Next Generation* in 1987 and became the line the character is quoted for.

What matters mechanically is the grammar of it. "Make it so" is not a synonym
for a specific order — it is an answer to something already on the table. It
has no object. That is exactly the shape of a reply to "did you mean X?", and
it is why this game had it wrong: with no pending question to attach to, the
parser had nowhere to put it and read the verb literally, sending "make it so"
to the **replicator** to be told there is no specification for "it so".

**"Belay that" is the negative, and it is older still.** In the age of sail a
line was *belayed* by taking a figure-eight turn around a belaying pin, which
stopped the rope dead. The physical act became the verbal one: belay means
stop, cancel, disregard. "Belay my last" is *withdraw what I just said*. Note
what it does NOT mean — it is not "cease fire". It cancels an ORDER, not an
action, which is why the natural place for it is answering a question about an
order that has not been given yet.

**"Aye aye" is not on this list, and that is the finding worth writing down.**
It is easy to reach for as an affirmative and it is the wrong direction: "aye
aye" is what a subordinate says *back* to an officer, meaning "I understand the
order and will carry it out." A captain does not say it to their own computer.
The captain's affirmatives are "make it so", "engage", "proceed", "carry on",
"very well" and plain "yes"; "aye aye" belongs to the officer answering. Since
the whole point of the order line is that the captain is the one talking, it
stays out.

### What the build takes from this

A pending question gets its own small vocabulary, checked before the order
parser runs — the same shape the game already uses when a forced channel turns
the order line into literal speech. Affirmatives execute the reading; "belay
that", "belay", "cancel", "negative", "as you were" dismiss it. Both phrases go
ON the buttons, because a button that does not print what says it teaches
nothing.

And it is checked *before* the parser rather than added to it, so that the
seventy-odd existing intents keep their meanings: "belay that" with no question
pending still stops the guns, which is what it means when somebody is shooting
at you.

Sources: [Memory Alpha — Make It So](https://memory-alpha.fandom.com/wiki/Make_It_So),
[US Dictionary — "Belay my last"](https://usdictionary.com/idioms/belay-my-last/),
[Naval Society of PAs — Navy jargon](https://navypa.com/manuals/misc-navy-jargon),
[HOME.org — Cancelling orders: the naval history of belay](https://h-o-m-e.org/belay-that-order/)

---

## 27. Seven ships, one wedge — the other half of §14

§14 was about twelve Federation classes built by one function. Everything it
says applies with more force to the hulls on the other side of a battle, and
nobody had looked.

Measured on the built meshes: thirteen Federation classes carry between 716 and
2,142 triangles, a band of lit ports around the rim, two more rows on the plate,
ports down each flank of the secondary hull, a copper deflector, an impulse deck
and glowing bussard domes. Every Klingon class carried **241 triangles and no
lit ports at all** — and it was the same 241 for all five, plus the Romulan
scout and the Orion raider on the same form. A Bird-of-Prey is a 158-metre
raider with three decks and thirty-six aboard; a Negh'Var is a 682-metre
battleship with thirty-five decks and two and a half thousand.

The asymmetry is backwards. A captain sees their own ship in the shipyard and on
the status board. They see these *across a battle, for the length of a battle*,
which is most of what the game is.

### What tells the Klingon classes apart

Two silhouettes, not one, and no setting of either produces the other:

| Class | The thing that identifies it |
|---|---|
| B'rel Bird-of-Prey | **Wider than it is long** with the wings down; forward head on a raked neck, wings carrying both the guns and the engines |
| D7 battlecruiser | Bulbous command section at the end of a **long thin neck**, broad boom astern with the nacelles at its tips |
| K't'inga | A D7 refit: **ribbed dorsal spine** and armoured flank plating on the neck, heavier boom |
| Vor'cha attack cruiser | The boom widened into a delta, with **forward wings off the neck** and a heavy disruptor at each tip |
| Negh'Var | The Vor'cha proportions at battleship scale, nacelles slung low, five engine ports |

The D7 and the K't'inga are the interesting pair. Their published figures are
identical to the metre — 152 m of beam and 60 m of height, on lengths of 228 and
235 — so **nothing about proportion can ever separate them**, and the refit's
plating has to be built. Held to the same shape fingerprint the Federation
classes must clear (0.2), the two measured 0.085 apart.

### What the primitives were missing

Two gaps, both found by building against them rather than by reasoning:

- **A wing has no dihedral.** `box` could shear fore-and-aft two ways (`sweep`,
  `rake`) and outboard one way (`flare`), but it could not drop its outboard end
  in y. So a drooping wing had to be a plate *lowered whole*, and a
  Bird-of-Prey's wing root sat 0.29 units below the body it grows out of, with
  its nacelle another 0.29 below that. From the side it was four objects in a
  diagonal line. `dip` is `flare` transposed and fixes it in one term.
- **A tapered tube is a tapered tube at every distance.** Flat shading with no
  textures leaves a surface exactly one cue that it is made of anything — its
  silhouette against the next surface. The Federation hulls escaped that by
  accident, because a saucer, a neck, a secondary hull, two pylons and two
  nacelles already put seven silhouettes against each other; a Klingon cruiser
  has three. A run of small raised housings along a spine or a deck is the
  cheapest fix, and every third or fourth one drawn at full glow is a row of
  running lights for no extra geometry at all.

### What the build takes from this

Two forms — `raptor` and `kdf_cruiser` — with `spine`, `plates` and `prow` as
the switches that separate four cruisers whose proportions cannot. Ports on
every one of them, placed against the surface they sit on rather than at a
fraction of it: a belt at 0.8 of a head's half-width is a row of lights *inside
the head*, which is the same failure the intercooler grille shipped with, and
the cure is to measure by slicing the hull at the port's own station rather than
by looking at it.

Sources: [Memory Alpha — B'rel-class](https://memory-alpha.fandom.com/wiki/B%27rel-class),
[Memory Alpha — D7-class](https://memory-alpha.fandom.com/wiki/D7-class),
[Memory Alpha — K't'inga-class](https://memory-alpha.fandom.com/wiki/K%27t%27inga-class),
[Memory Alpha — Vor'cha-class](https://memory-alpha.fandom.com/wiki/Vor%27cha-class),
[Memory Alpha — Negh'Var-class](https://memory-alpha.fandom.com/wiki/Negh%27Var-class)

---

## 28. The other nine, and a fleet that was lopsided

§27 rebuilt the Klingon hulls and left an explicit list behind: four more forms
building eleven classes with no lit port on any of them. Two of those forms were
worse than under-detailed. They were the wrong species.

**Five classes shared `wedge`.** A Galor, a Keldon, a Jem'Hadar attack ship, a
Jem'Hadar battleship and a Tholian web spinner were one armoured slab with a
coloured ball floating off the nose, drawn five times in five colours. The
Dominion did not build Cardassian hulls; it conquered the people who did. And a
Tholian vessel is a mineral — the one design in the fleet where "faceted" is the
correct answer rather than a compromise.

**Two shared `warbird`.** A D'deridex is 1,041 metres of warship built around an
artificial quantum singularity; a Ferengi D'Kora is a 366-metre merchant hull
with guns bolted on. They shared a builder and nothing else.

### Three defects the rebuild exposed, all measurable

**The sensor ball floated.** `wedge` put a lit sphere at x = 0.55 on a hull whose
own forward face is at 0.5 of its `length_`. Sliced into twenty horizontal
bands, four of the five classes had a band with *nothing in it* — a hole through
the ship, with the ball on the far side of it. `raptor` had the same defect
before §27 for a different reason, and the same measurement finds both.

**Eleven classes were not symmetrical.** `sweep` displaces a box's +z corners
aft and leaves its -z corners where they are. Inside `mirrored` that is a swept
wing and correct; on a **centreline** box it is a parallelogram seen from above,
one bow corner reaching forward and the other raked back. Measured as the
largest port/starboard disagreement in reach as a fraction of hull length:

| class | form | lopsided by |
|---|---|---|
| galor, keldon | wedge | 15.7%, 15.9% |
| tholian_web_spinner | wedge | 27.7% |
| bird_of_prey | raptor | 10.9% |
| orion_raider | raptor | 9.7% |
| nebula | podded | 17.9% |
| ktinga | kdf_cruiser | 9.3% |
| scoutship | raptor | 6.2% |
| constitution | tos_starfleet | 3.8% |

The Borg are the exception and stay one: a cube's surface clutter walks a
trigonometric path with no mirror, and a Borg vessel is accreted rather than
laid down. Everything else goes through a `prow` helper that builds the
starboard half and mirrors it, so a swept centreline section comes out as an
arrowhead with the point on the axis.

**A port is only a port if it can be seen.** §27 measured that sideways, which
is right for a belt on a tube and wrong for a light on the top of a wing. The
general form: a port must reach at least as far as the hull in **one** of the
four directions it faces, and the comparison is only asked in a direction the
port is actually on the outer side of. That found four more buried rows — the
Cardassian head's rake carried its outboard face forty percent of the ship's
length aft, over the spine's own shoulder; a Keldon's dorsal pods sat exactly
where the row below them wanted to be; and a D'deridex encloses its own spine
and command head from every direction at once, so the only surface on it a light
can be seen from is the outer face of an arm — which a ring about the x axis
cannot lie on at all.

### What the build takes from this

Five forms in `src/gfx/forms.hostile.js`, each reading the published beam and
height rather than carrying its own copy in unit space (the copies were wrong: a
Galor came out 28% too wide and 32% too tall). `prow` for any swept section on
the centreline. `portRow` for a light on a surface a belt cannot reach. And an
ellipsoid rather than a tube wherever a hull is broad and shallow, because a
tube is round in y and z together and a Jem'Hadar attack ship built from one
measured 4.2× its own published height.

Sources: [Memory Alpha — Galor-class](https://memory-alpha.fandom.com/wiki/Galor-class),
[Memory Alpha — Keldon-class](https://memory-alpha.fandom.com/wiki/Keldon-class),
[Memory Alpha — Jem'Hadar attack ship](https://memory-alpha.fandom.com/wiki/Jem%27Hadar_attack_ship),
[Memory Alpha — Jem'Hadar battleship](https://memory-alpha.fandom.com/wiki/Jem%27Hadar_battleship),
[Memory Alpha — Tholian web spinner](https://memory-alpha.fandom.com/wiki/Tholian_starship),
[Memory Alpha — D'deridex-class](https://memory-alpha.fandom.com/wiki/D%27deridex-class),
[Memory Alpha — D'Kora-class](https://memory-alpha.fandom.com/wiki/D%27Kora-class)

---

## 29. The last two, and the one that was the wrong creature entirely

§28 ended with a list of two: `compact` and `cube`, the only forms left building
a ship with no lit port on it. One of them was hiding something much worse than
a missing window.

**The bioship was a Borg cube.** Normalised to its own bounding box and
rasterised into an occupancy grid, `bioship` and `borg_cube` measured **0.000
apart** — the same object, squashed to 600 × 420 × 200 instead of three
kilometres cubed. Everything the class data says about it says it is not a Borg
ship at all: a crew of **one**, no decks, a hull that regenerates 120 a second,
weapons that adapt within seconds, and a bioplasmic discharge for a beam. It is
an organic vessel and it was drawn as the most industrial object in the game.

It gets its own form: an ellipsoid body with a ridged spine, three prongs
curving forward — a mirrored pair plus one on the dorsal line — and a core
burning inside the body that shows through the gaps between them. Two box
segments per prong, because a single box cannot curve and the curve is the
silhouette.

No lit ports on it, and that is not an omission. A vessel with one occupant and
no decks has nowhere to put a window; the core does the same job, which is to
say that the thing is alive and under way.

**A Borg cube's structures were inside the Borg cube.** Fourteen boxes placed by
a trigonometric walk at 0.36 of the half-extent in x and y — which is inside a
cube whose faces are at 0.5 — so ten of the fourteen were paid for and could not
be seen from anywhere. Measured on the built mesh, **22% of the hull's faces**
were sealed inside it. A cube has no silhouette to read and no lighting to model
it, so the surface is the whole of the design: it now carries a lattice on each
of the six faces with conduits running between them.

That is measured **per piece, not per face**. A box bolted to a hull has a back
face against it that is hidden and is meant to be; asking every triangle to
reach the surface fails on ninety-six of those. The pieces are the mesh's
connected components, found by union-find over quantised vertex positions, and
every box is one because nothing here shares vertices with anything else.

**A Defiant and a runabout got their ports.** The last form with none, and the
one that needs them least and most at once: a Defiant is famously a warship with
almost no habitable hull, and it is also the ship a captain most often flies.
The body is a swept wedge with a flat upper surface, so a ring about the x axis
cannot lie on it and `portRow` does the work instead.

That change broke a test, correctly, and the break is the interesting part. The
suite's rim-band control was `portsOf('defiant').length === 0` — a true
statement about a hull that had no ports at all, and one that stopped being a
control the moment it got some. What the control is *for* is that a rim band
runs round the widest part of a hull, which a wedge does not have. Restated as a
ratio of the ports' own beam to the hull's:

| class | ports' beam / hull beam |
|---|---|
| seven saucer cruisers | 0.99–1.00 |
| Miranda (the saucer IS the ship) | 0.84 |
| Constellation | 0.76 |
| **Defiant, runabout** | **0.32, 0.33** |

### What the build takes from this

Every crewed hull in the game now carries lit ports, and the two forms that do
not are the two that should not: the Borg do not fit windows, and a bioship has
nobody to look out of one.

Sources: [Memory Alpha — Species 8472 bioship](https://memory-alpha.fandom.com/wiki/Bioship),
[Memory Alpha — Borg cube](https://memory-alpha.fandom.com/wiki/Borg_cube),
[Memory Alpha — Defiant-class](https://memory-alpha.fandom.com/wiki/Defiant-class),
[Memory Alpha — Danube-class runabout](https://memory-alpha.fandom.com/wiki/Danube-class)

---

## 30. Cover that nobody took

§136's work put rocks in the engagement volume and gave them a consequence
sharper than a to-hit modifier: **a shot with a rock in the way is not fired at
all.** Getting one between you and somebody stops the incoming fire rather than
making it miss, which is what makes cover cover.

It was available to every ship in the fight and taken by none of them, because
the manoeuvre layer in `ai.js` had never looked at the arena. Measured over a
hundred and sixty fights in a debris field, through the real fight loop with the
same simple pilot the balance suite flies:

| | main | with the terrain layer |
|---|---|---|
| hostile-ticks behind cover | 19.3% | 21.6% |
| **hostile-ticks behind cover WHEN HURT** | **14.0%** | **23.4%** |
| blocked without meaning to be | 19.3% | 18.6% |
| ticks spent running for or holding cover | 0% | 10.4% |
| player destroyed | 52/160 | 53/160 |
| median fight | 59 s | 59 s |

A hostile below half hull was **less** likely to be behind a rock than a healthy
one. Not because it was doing something else clever: a hurt ship stops circling
and holds station to present its strongest shield, which is the one behaviour
guaranteed to leave it in the open.

The outcome columns are the point of the change as much as the cover column. A
captain who uses the terrain is not a captain who wins more — the rock that
stops their shot stops yours — and the battle is the same length with the same
result. What changed is that something happens in it.

### Four things the measurements said that reasoning did not

**A sphere casts a shadow, and all of it is cover.** The obvious hiding place is
the far pole of the rock, and aiming there means flying all the way round even
when already three quarters of the way there. Ships committed to hiding were
actually behind something only 33% of the time; the rest was transit. Clamping
the ship's own position into the shadow instead — nearest point, not far pole —
took it to 38%.

**Holding cover means following it.** The player orbits, so a rock's shadow
sweeps around it. A ship that reached cover and then turned to present its best
shield had to come a hundred and eighty degrees round when the shadow moved:
traced on one episode, five seconds behind the rock and then *fourteen seconds
flying steadily away from it at full throttle* while a Galor's turn rate brought
the nose back. Station-keeping on the moving spot instead took the share from
38% to 44%, and the median shield recovered per hiding episode from 0.26 to
0.34.

**Offsetting the destination does not clear the obstacle.** To go around a rock
the obvious move is to nudge the aim point sideways by the rock's radius. The
line's closest approach is that offset scaled by how far along the run the rock
sits, so a rock 300 units into a 700-unit run was still missed by 124 of the 200
needed. The waypoint has to be *abreast* of the rock, not past it.

**And the mean of six shield facings is still the trap.** Written with
`shieldPct` as the come-out-again condition, the exit fired on the same decision
tick as the entry on nearly every attempt: over forty-eight fights the hostiles
ran for cover 371 times and came back out 357, spending 2.0% of their ticks
hidden. A ship at 45% hull routinely has a mean shield above 0.55 and one facing
at nothing — which is exactly the ship that should be behind a rock.

### And no weather manoeuvre, which is a measurement rather than an oversight

`resolveHit` takes the worse sensor noise at either end of a shot, so gas spoils
a firing solution and a losing ship "should" run into a cloud. The share of
hostile-ticks already spent inside one, with nobody trying:

| arena | in the gas |
|---|---|
| nebula | 96.0% |
| metreon (Briar Patch) | 77.7% |
| plasma storm (Badlands) | 65.4% |

The clouds are large and the fight collapses into the middle of them, so a ship
steering for the murk would be steering for where it already is. Rock is
different — small, sixteen pieces, and being behind one is a decision. That is
the line between a manoeuvre and a condition, and it is why cover is in the AI
and weather is in the arena.

---

## 31. The order no enemy captain had ever given

The player has been able to call a shot at a named system since the order line
existed. `fireWeapon` read `this.targetedSubsystem` for the player and passed
`null` for everybody else, so a Klingon captain who had been fighting for two
minutes had never once tried for the engines.

It is worth about three times the subsystem damage of untargeted fire —
`takeDamage` applies 3.2× the hull fraction to a named system, against 1.8× on a
roll it usually loses. Measured across a hundred and twenty fights against five
factions, the lowest any of the player's systems fell to *during* the battle:

| opponent | before | after |
|---|---|---|
| Klingon | lifesupport 0.873 | **shields 0.000** |
| Cardassian | weapons 0.887 | **weapons 0.002** |
| Romulan | weapons 0.911 | **engines 0.424** |

Before, the worst-hit system was whatever the random draw picked, and it barely
moved. After, each faction reliably wrecks the one thing its own doctrine
depends on: a Romulan strikes and leaves, so he wants you unable to follow; a
pirate wants the hull intact and you unable to leave with it; the Borg want the
shields flat because that is the door a boarding party comes through; the
Dominion do not weigh what it costs, so they shoot at the warp core.

*(Read after the fight instead of during it, every number is 1.000 for every
opponent including the ones that killed the player twenty-four times out of
twenty-four — ending an engagement runs `resolveCombat` and the ship that comes
back is repaired.)*

### And the manual was right about something the code was not doing

> *"Targeting a subsystem trades total damage for a specific outcome."*

It did not. Naming a system was **strictly better** than not naming one: the
hull took exactly as much and the system took three times as much. A choice with
no cost is not a choice, and it stayed one only because nothing but the player
could make it. Once every enemy captain could too, the free upgrade showed:

| share of hull damage a called shot keeps | player destroyed | median battle |
|---|---|---|
| 1.00 (free, as it was) | 53 / 120 | 40 s |
| 0.85 | 48 | 45 s |
| **0.70** | **48** | **50 s** |
| 0.55 | 37 | 65 s |
| 0.40 | 15 | 80 s |
| *(nobody but the player calls one)* | *38* | *46 s* |

0.55 restores the old death rate and stretches the battle by forty percent,
because the **player's** called shots get weaker along with everybody else's.
0.70 keeps the battle the length it was and the player dies more — which is the
right trade. A longer fight is a worse fight, and the extra deaths come from the
enemy doing something the player has always been able to do, announced in the
log, with a whole repair-and-power system to answer it.

### What the build takes from this

One system per doctrine, chosen by what that doctrine's method needs rather than
by damage; a single log line per ship when it starts, because the threshold is a
shield facing and a shield facing is crossed over and over; and the cost applied
in `takeDamage`, where it lands on both sides at once.

Two things worth remembering about measuring it. The subsystem has to be read at
its **low-water mark during the fight**, not afterwards. And `fireWeapon` names
the subsystem in two places — once when it queues a torpedo and once when a beam
resolves immediately — so disabling one of them left every assertion passing,
because a D7 carries torpedoes and they were enough on their own.

---

## 32. The shield facing that had never once been attacked

A ship carries six shield facings. The AI chose its elevation like this:

```js
const dorsalWeak = target.shieldPctOf('dorsal') < target.shieldPctOf('ventral');
const bias = dorsalWeak ? 1 : -1;
```

With both poles at full, `<` is false. So the bias was **-1 on the opening tick
of every engagement ever fought**; the ship went below, shot the ventral shield,
and made `dorsal < ventral` false for the rest of the battle. Self-reinforcing,
and never revisited.

Measured over 133,804 ticks with two or more hostiles alive, the facing of the
player's ship that a shot would have landed on:

| | fore | aft | starboard | port | ventral | dorsal |
|---|---|---|---|---|---|---|
| before | 37% | 25% | 16% | 11% | 15% | **0.0%** |
| after | 36% | 23% | 17% | 10% | 11% | **9%** |

Every hostile in the game attacked from below, always. One sixth of the
defensive geometry the ship carries was decoration.

### And the line under the comment was not doing what the comment said

```js
// Hold the elevation that keeps the target's weaker face toward us.
ship.desiredPitch = ship.elevationTo(target);
```

`elevationTo(target)` points **at** the target. So a ship in the pocket levelled
off — and the pocket is where a ship spends most of a battle. `chooseElevation`
was only ever consulted while closing or backing off, which is why a fixed
220-unit offset had so little effect that scaling it looked necessary.

### Two things measured and thrown away

**Scaling the offset to the current distance.** To reach the dorsal facing you
have to be more above the ship than beside it, so the offset "ought" to scale
with the range. It diverges: the further out you are the further above you want
to be, which puts you further out. The median battle in a debris field went from
59 seconds to **189**, and fights stopped resolving.

**Scaling it to the attacker's own preferred range.** Stable, but it moved the
dorsal share not at all — 6% either way — while costing thirteen seconds a
battle, because a ship that climbs to its own engagement range arrives late and
by a longer route. The share of shots that land dorsally does not come from
where the attacker holds station; it comes from the player manoeuvring
underneath somebody who has chosen the high side.

What is left is one line for the tie-break and one for the pocket. The split
offset was then measured rather than picked:

| split | dorsal shots | open-space median | debris median |
|---|---|---|---|
| 220 | 10% | 67 s | 70 s |
| 150 | 10% | 67 s | 61 s |
| **110** | **9%** | **63 s** | **67 s** |
| 70 | 5% | 63 s | 65 s |
| *(before)* | *0%* | *60 s* | *59 s* |

The first version of that table was measured before the pocket held its
elevation at all, and said 110 bought 3% and 220 bought 6% at thirteen seconds a
battle. Fixing the pocket moved every row: **a tuning table is only true for the
code it was measured on.**

### A guard that the code had quietly walked up to

The cover work's stall guard asserted a median under 150 seconds over five
seeds. Measured properly, thirty seeds of one matchup — a Constitution against
two Galors in a debris field:

| | median | worst | player deaths |
|---|---|---|---|
| §30 (cover) | 109 s | 176 s | 6 / 30 |
| §31 (called shots) | 148 s | 227 s | 13 / 30 |
| this change | 134 s | 314 s | 17 / 30 |

Nine seeds of that distribution have a median anywhere between 60 and 190, so a
150 bar is a coin toss dressed as an assertion — and §31 walked the code most of
the way to it without anything noticing. What the guard is actually for is a
fight that never ends because both sides are behind rocks, so it now asserts
that no battle runs to the harness limit, with the distribution written down
beside it.

### And a balance observation for later

Setting up the doctrine test meant asking how often each class can get *any*
facing of the player's ship below the threshold at all, over thirty battles:

| matchup | ever reached it |
|---|---|
| Constitution vs Galor | 30 / 30 |
| Constitution vs Jem'Hadar attack ship | 28 / 30 |
| Miranda vs Marauder | 26 / 30 |
| Constitution vs Marauder | 7 / 30 |
| **Constitution vs Orion raider** | **0 / 30** |
| **Constitution vs Romulan scout** | **0 / 30** |
| **Galaxy vs Jem'Hadar attack ship** | **0 / 30** |

A raider and a scout never once took any facing of a Constitution below 0.74 in
thirty battles, and a Jem'Hadar attack ship cannot reach past a Galaxy at all.
Small hulls are not a threat to a heavy cruiser in any sense the simulation
models.

---

## 33. A fight is either nothing or it is fatal

Played through the encounter generator rather than a hand-picked matchup — a
Constitution, thirty-three hostile encounters out of four hundred rolls, flown
by the balance suite's own pilot — the distribution of outcomes was not a curve.
It was two piles:

| opponent | encounters | ship lost | mean lowest hull |
|---|---|---|---|
| Cardassian patrol | 10 | **10** | 0% |
| Borg | 5 | **5** | 0% |
| Klingon patrol | 7 | 4 | 31% |
| Dominion | 3 | 1 | 42% |
| Romulan patrol | 2 | 0 | 54% |
| Ferengi | 4 | 0 | 94% |
| Orion, independent | 2 | 0 | 99% |

And the shape is a cliff rather than a slope. Against a Constitution:

| | 1× | 2× | 3× | 4× |
|---|---|---|---|---|
| Orion raider | hull 100% | 94% | 85% | 78% |
| Romulan scout | 100% | 99% | 98% | 95% |
| Bird-of-Prey | 96% | 95% | 86% | 30% |
| Galor | 70% | **lost 12/12** | 12/12 | 12/12 |
| D7 | 63% | **lost 12/12** | 12/12 | 12/12 |

One heavy cruiser is a bruising win. Two is certain death. And a Romulan scout —
which is two thirds of what a Romulan patrol is made of — cannot take a
Constitution below 95% of its hull four at a time.

**The game already intends this.** `beginWarpOut` exists, the balance suite
asserts that breaking off works at the top of the ladder, and the difficulty
ladder's principal lever is enemy *count* rather than enemy hull. Outnumbered is
meant to be a fight you leave. What was missing is that nothing ever told the
captain which fights those were: you found out by having one.

### Weighing it

Lanchester's square law for aimed fire, which is the shape the measurements
already have: two identical ships are not twice one ship but four times it,
because they do twice the damage for twice as long. A side's power is what it
can shoot with times what it can take —

```
power = (Σ damage per second) × (Σ hull + 4.8 × shield facing)
```

— and the ratio between the two sides lands the bands. Twenty-four matchups, ten
battles each:

| ratio | matchup | lost | lowest hull |
|---|---|---|---|
| 11.9 | Constitution v Orion raider | 0/10 | 100% |
| 2.7 | Constitution v Bird-of-Prey | 0/10 | 98% |
| 1.45 | Constitution v Galor | 0/10 | 83% |
| 1.12 | Constitution v D7 | 0/10 | 74% |
| 0.74 | Galaxy v three K't'ingas | 0/10 | 47% |
| 0.67 | Constitution v D'deridex | 0/10 | 57% |
| **0.37** | **Sovereign v Borg cube** | **10/10** | **0%** |
| **0.36** | **Constitution v two Galors** | **10/10** | **0%** |
| **0.28** | **Constitution v two D7s** | **10/10** | **0%** |

Every fight that was always lost sits below 0.4 and every fight that was never
lost sits above it — on both sides of a boundary nothing was tuned to. Grouped
by band, over the same runs:

| band | ship lost | mean lowest hull |
|---|---|---|
| no contest | 0% | 100% |
| favourable | 0% | 98% |
| even | 0% | 81% |
| dangerous | 0% | 67% |
| **outmatched** | **100%** | **0%** |

A linear model cannot produce that cliff: it rates two Galors 'dangerous', which
is a word for a fight you can have.

### What the build takes from this

`src/sim/assess.js` reads the ships and says what the bridge would say. Tactical
announces the opening reading once, before anybody shoots, and the tactical
display carries a live one — a battle that was outmatched three ships ago is not
outmatched now, and the pill is the number a captain reads to decide whether to
run. Nothing about a battle changes; the fight the captain chooses does.

## 34. A patrol was a number of hulls, not an amount of force

`buildHostiles(rng, factionId, strength, pool)` has had that third argument
named `strength`, and documented as strength, since combat was written. It was
used as a count. The encounter generator asked for `rng.int(1, 2)` of them and
drew each one uniformly from a pool spanning a scout to a battleship.

Measured through `rollEncounter` — **one** encounter kind, in **one** system,
four hundred rolls of each, weighed against a Constitution with the assessment
from §33:

| where | what it says | fighting power | spread |
| --- | --- | --- | --- |
| Qo'noS | "A Klingon patrol" | 0.05 – 2.44 | **45×** |
| Archanis | "A Klingon patrol" | 0.05 – 2.44 | **45×** |
| Rigel | "An Orion patrol" | 1.32 – 10.72 | 8× |

At Qo'noS the worst roll is two Negh'Vars, which kills a Constitution every
time, and the best is one Bird-of-Prey, which is free. **Identical text.** 47% of
Klingon patrols were funerals and the captain could not tell which until it was
too late to leave.

At Rigel the failure runs the other way: an Orion patrol was never a fight at
all. The Orion Raider's own description in `ships.data.js` reads *"Dangerous in
threes, worthless alone"* and the generator had never once fielded three.

### What a hull is worth

Costing every class by the §33 arithmetic, in Constitutions:

| class | tier | power | | class | tier | power |
| --- | --- | --- | --- | --- | --- | --- |
| Orion Raider | 2 | 0.09 | | Galor | 4 | 0.77 |
| Romulan Scout | 2 | 0.10 | | K't'inga | 4 | 0.93 |
| Marauder | 3 | 0.19 | | D7 | 4 | 1.00 |
| Tholian Spinner | 4 | 0.26 | | Warbird | 6 | 1.67 |
| Bird-of-Prey | 3 | 0.41 | | Vor'cha | 5 | 2.26 |
| Jem'Hadar attack | 5 | 0.69 | | Negh'Var | 7 | 4.63 |
| | | | | Borg cube | 10 | 20.52 |

A Negh'Var is fifty-one Orion raiders' worth of ship, and both were "one to two
hulls in a patrol."

### The square law does the work

`n` identical hulls are worth n² of one — that is §33's whole finding — so
asking for a **strength** and solving for the count gives packs of light hulls
and lone capitals without either being written down anywhere:

| strength | Klingon | Orion |
| --- | --- | --- |
| 0.6 | a Bird-of-Prey | three raiders |
| 1.0 | two Birds-of-Prey, or a D7 | three raiders |
| 1.6 | a D7, or a Vor'cha | four raiders |
| 2.5 | a Vor'cha, or two K't'ingas | five raiders |
| 4.0 | a Vor'cha and a Bird-of-Prey, or a Negh'Var alone | six raiders |

Escorts fall out of the same arithmetic: after the lead ship, add hulls lighter
than it for as long as adding one brings the force *closer* to the target. A
Warbird arrives with two scouts; a Keldon arrives with a Galor; two Negh'Vars
never arrive together, because that is not a patrol, it is a war.

### Where the strength comes from

`SECTOR_PRESENCE` has said this since the map was written — Klingons are a 1 at
Andor and a 9 at Qo'noS — and the number only ever decided **who** you met,
never how much of them. It decides both now.

That alone left the top of the game empty. Presence caps at nine, so the
heaviest patrol in the galaxy was worth 2.0 Constitutions and a Sovereign is
worth 6.8 of one. Share of hostile encounters by band, four thousand rolls,
split by where the ship actually is:

| ship | home | near frontier | deep space |
| --- | --- | --- | --- |
| Miranda | 76% even | 57% dangerous | 69% outmatched |
| Constitution | 76% favourable | 54% even | 39% outmatched |
| Excelsior | 100% no contest | 54% no contest | 26% dangerous |
| Galaxy | 100% no contest | 56% no contest | **1% dangerous, 0% worse** |
| Sovereign | 100% no contest | 54% no contest | **1% dangerous, 0% worse** |

A ship the game lets you earn had nothing left to be afraid of. So a garrison
answers what it can see coming — not the enemy scaling to the player, but a
defence force sizing its response to a warship in its space, and scaled by
presence so it is a real answer at Qo'noS and a shrug at Andor. The coefficient
was swept, not chosen; share of encounters rating dangerous or worse:

| coefficient | Constitution, near | Excelsior, deep | Sovereign, deep |
| --- | --- | --- | --- |
| 0.42 | 29% | 27% | 1% |
| 0.60 | 39% | 37% | 7% |
| **0.80** | **41%** | **47%** | **11%** |
| 1.00 | 42% | 57% | 27% |

At 1.00 the Excelsior's favourable band collapses from 26% to 1% — a ship that
has stopped having good days. 0.80 it is. A Miranda over Qo'noS is in exactly as
much trouble as before: 0.36 of a response added to a 2.0 garrison changes
nothing about a 0.45 ship.

### Two things this broke, and what they cost

**The Borg cube stopped existing.** The Borg pool is two capitals and the
deep-space garrison is worth a fraction of a Constitution, so costing every
force to the situation fielded a bioship every time — deleting the game's whole
illustration of a fight you break off rather than win. One force in twelve is
now drawn without regard to what the situation warranted. That is also what puts
a Negh'Var in front of a lone cruiser, and it is the pairing that makes §33 earn
its keep: the encounter is genuinely out of scale, and the bridge weighs it and
says so before a shot is fired.

**Two ships got the same name.** `hostileName` wrapped the faction's name list
round to the start, and the Orion list is three names long. It had never come up
while a force was one or two hulls; three raiders is now the commonest Orion
encounter there is, and the tactical display was offering the captain two
identical targets. The existing invariant asserted *both* the wrap and that a
fleet has distinct names, which cannot both be true past the length of the list.
It wraps onto `II` now, and `stripSuffix` — which already matched `I{1,3}|IV|V|VI`
for the difficulty setting's reinforcements — was already ready for it.

## 35. Forty hours of observation that changed nothing

The mission engine has always been able to read back what the captain did.
`next` accepts a function — `(mission, applied) => stageId`, `engine.js:152` —
and `requires.var` gates a choice on the episode's own variables,
`engine.js:115-119`.

Across **16 episodes, 72 stages and 137 choices, neither had ever been used.**
So the nine `setVar` calls were writes into a bag that is carefully serialised
into the save file and read by nothing at all.

The sharpest is `has_window`. In *The Cube at Gamma Hydra* the captain can spend
forty hours on passive observation, find a nine-second gap where the Borg shield
harmonics rotate and briefly do not overlap, and choose **"Use it yourself"**.
Measured through `Game.chooseMission`, the door the game actually uses:

| | class | hull | fore | aft | port | stbd | dorsal | ventral |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| used the window | borg_cube | 42000 | 5000 | 5000 | 5000 | 5000 | 5000 | 5000 |
| never looked | borg_cube | 42000 | 5000 | 5000 | 5000 | 5000 | 5000 | 5000 |

Identical, facing for facing.

### What a stage can now say about a fight

`effects.combat` gains **`shieldsAt`** — the fraction of their shields the
hostiles start with. It is the one thing a stage can say about the *shape* of a
fight rather than who is in it, and it is the only new engine capability here;
everything else was already implemented and unused.

Applied at `startCombat`, next to the `first_strike` perk and for the same
reason: `scaleHostileFleet` **clones** hulls to build the fleet a high
difficulty asks for, and a clone built after the fact would arrive at full
shields. After `enemyMods`, too — `recomputeDerived` scales the current shield
with the maximum, so a value set beforehand would be scaled by the difficulty.

It is not a different cube. Same hull, same guns, same forty-two thousand
tonnes; the shields are not there when the spread lands. Flown over twenty
seeds, a Sovereign that used the window:

| | mean share of the cube's hull taken off |
| --- | --- |
| used the window | **6.0%** |
| never looked | 1.0% |

Twenty of twenty. The cube still wins — nothing stops a cube — but it arrives at
Wolf 359 with a wound nobody had put in one before.

### The other eight

| variable | episode | what it records | what it now opens |
| --- | --- | --- | --- |
| `running_silent` | Outpost 4 | came in on passive sensors | you see the cloaked warbird first; it decloaks at 15% shields instead of ambushing you |
| `cautious` | Shakedown | declined to push the core | you can recommend the yard's profile for the class |
| `aggressive_posture` | Donatu | moved to firing position before answering | you can offer the withdrawal from where you are standing |
| `entered` | Devron | flew in without a probe first | you can run the pulse off the ship's own readings |
| `conceded` | Deep Space 9 | gave Torvan the clause | you can take the point back before signing |
| `scanned_first` | Grid 9902 | knew it was a machine before speaking | you can tell it you know what it is |
| `deflected` | Grid 9902 | answered a question about consent with procedure | you can answer the question nine hours late |
| `escorting` | Badlands | — | **deleted.** It was set on the only choice that reaches the stage that would have read it, so it was true at every point it could ever be tested. A variable that distinguishes nothing gets removed, not a reader. |

### The constraint

`tests/wiring.test.js` walks every episode 30× with random legal choices and
**no variables set**; `if (!open.length) break` strands it. So every gated
choice is an *extra* route at a stage that already had one — remembering opens
doors, it never closes the corridor. A test asserts it directly, over the
shipped episodes rather than a list, so a new episode that forgets fails.

### Keeping a dynamic route checkable

A function is opaque, and the thing the episode graph is checked for is that no
route points at a stage nobody wrote — the check that catches a rename. Rather
than exempting dynamic routing from it, a route **declares** the stages it can
reach (`route.targets`) and the graph tests walk them. `wiring.test.js` had
`typeof c.next === 'string' ? c.next : null`, which would have dropped a
dynamic route on the floor and passed in silence; it walks the targets now.

### Two records of things that did not happen

`record: { lives_lost: 0 }` (Shakedown, after a conduit failure whose own text
says "two injured, nothing worse") and `record: { treaty_broken: 0 }` (Deep
Space 9, after talks that merely collapsed). `Ledger.record` pushes an entry
unconditionally and adds `count ?? 1`, so both wrote a permanent line into the
service record for an event that never occurred. The score is computed from the
counters and so was never wrong; the Final Record's entry count was.

## 36. "The board has read all of it before you walked in"

It had not. `homecoming` is the Act-5 review of a five-year command and it was
**one stage, one choice**, +1000 experience. The only thing it knew about that
command was that it had reached flag rank.

Counted across the sixteen shipped episodes: **43 flags are set and 42 are read
by nothing at all.** The one exception, `inquiry_summoned`, is not set by an
episode either — `main.js` raises it from the ledger's own inquiry event. So
`requires.flag` (`engine.js:105`), `requires.notFlag` (`:108`) and
`requires.officer` (`:111`) had zero uses across seventy-two stages.

A captain who falsified a shakedown report, started a shooting war at Archanis,
or handed Starfleet the Borg shield harmonics walked into the same room and
heard the same sentence.

The clearest of them is in *Outpost 4*. Spare the crippled warbird rather than
board it, and the ending reads:

> He does not thank you. **Some years later, that decision comes back in your
> favour.**

It never did. `spared_warbird` was written into the ledger and read by nothing
for the rest of the commission.

### What the board reads now

| it reads | and | source |
| --- | --- | --- |
| the service assessment | sits in one of three rooms | `Ledger.assessment()` |
| `spared_warbird` | a Romulan deposition is entered | Outpost 4 |
| `falsified_report` | you can correct the trials report before they ask | Shakedown |
| `borg_weakness` | what the fleet did with the harmonics | The Cube |
| `kang_respects_you` | a Klingon letter, at a Starfleet board | Archanis |
| `dmz_accord`, `inquiry_resolved` | read into a finding already decided | DS9, the inquiry |
| a living first officer | somebody who served the whole commission speaks | `requires.officer` |

The three rooms are the ledger's own six bands, not a seventh set of numbers:
`rules/inquiry.js` already decides its finding on them, deliberately, so that
the screen and the board cannot disagree about one record.

| record | room | how it opens |
| --- | --- | --- |
| exemplary, distinguished | commended | the summary is read aloud because the board wants it aloud |
| satisfactory, unremarkable | questioned | passed along the table; nobody looks up |
| concerning, censure, under inquiry | censured | nobody offers you a chair; the finding comes before the evidence |

### `requiresCompleted: []`

Removed rather than filled in. `[].every()` is `true`, so it gated nothing — an
unfinished thought rather than a rule. Gating the finale on a list of episodes
would strand a captain who took a different route through the galaxy, and a
review of a thin career should **say so**, not fail to convene.

### The constraint, again

Every gated choice is an extra one in a room that already had an ungated way
out. `tests/wiring.test.js` plays every episode thirty times with random legal
choices and no flags at all, and strands on a stage where nothing is open.

### One thing found on the way

`CaptainProgress.addXP` promotes **at most one rank per call** — `rankIndex++`,
once, however large the award. So `addXP(200000)` on a fresh captain yields a
Fleet Captain, not an Admiral. That reads as deliberate (a promotion is an
event, not an arithmetic result) and is left alone; it is recorded because a
test that wants a flag officer has to promote them one step at a time, and the
first one written did not.

## 37. Seventeen rooms, and every scene on the bridge

`stage.where` names the compartment a scene happens in — `'bridge'` by default,
`'anywhere'`, `'surface'`, or any `ROOMS` key. The ship has **17 walkable
rooms** with stations, props, corridors and a walk system: sickbay, the brig,
the armoury, the briefing room, the transporter room, main engineering, the
hangar deck, crew quarters. Across sixteen episodes and seventy-two stages,
**no stage had ever set one.**

So the survivor of Wolf 359 wakes up in a stage whose speaker is literally
`'Sickbay'`, whose text reads *"Nobody in the room wants to answer"* — and the
captain was on the bridge for it. Eighty-two people arrive four waves at a time
in a stage whose speaker is `'Transporter Room'`, and the captain was on the
bridge for that too.

### Drawing is not enforcing

The room was read in exactly one place: `stageIsHere` in the mission panel,
which declines to **draw** the choices. But `mission_choice` takes a choice by
index out of `mission.choices()` and checks only whether it is `locked` — and
`choices()` gated on the star system and not on the room. Measured before any
stage set a `where` at all:

```
the captain is standing in : bridge
the scene is happening in  : sickbay
choices the engine offers  : accept, question
gave the order anyway      : start -> trials
```

A captain on the bridge could say "option two" and advance a scene two decks
down. It was invisible only because no shipped stage had ever set one — the
same shape as every other defect the order monkey in `tools/verify-app.mjs`
has found. So `Mission.testWhere` enforces it beside `testLocation`, and the
panel asks the mission rather than answering for itself: one answer, not two
that can drift.

`Game.ashore` turned out to be `walk.roomId === 'surface'` — so there is one
place value, not two, and `testWhere` reads only that. The first draft asked
for both and threw inside the `ashore` getter whenever there was no walker.

### Which scenes ask you to get up

Only where being in the room **is** the point, and only where the episode had
already said so in its own speaker line:

| episode / stage | room | its speaker, all along |
| --- | --- | --- |
| Wolf 359 / `revived` | sickbay | `'Sickbay'` |
| The Web at the Border / `lock` | transporter | `'Transporter Room'` |
| Board of Inquiry (4 stages) | `anywhere` | conference room four, Starbase 11 |

The inquiry is the other direction: the default is `'bridge'` and it is
enforced now, so a scene that is **not** aboard this ship has to say so.

### The one that was reverted

`shakedown/report` has had the speaker `'Ready Room'` since it was written, and
`where: 'quarters'` is the obvious reading. It is deliberately **not** set.

That stage is the fifth screen of the first episode in the game. With the room
enforced, putting it in the captain's quarters makes "walk to a compartment"
something a new captain has to work out before they can finish the tutorial —
and the measurement was blunt about the cost: it stalled the full-commission
driver in `tests/commission.test.js` outright ("seed 77002 ran only 8046
ticks", zero episode battles flown).

### Every driver was a captain who never stood up

The episode walker flies the ship to where a stage happens; it had no idea a
stage could also be in a room. Both drivers now walk, through `goToRoom` — the
same order the player gives:

- `tests/wiring.test.js`, which plays all 16 episodes 30× each;
- `tests/commission.test.js`, which plays a whole five-year commission.

A driver that stays on the bridge reports a survivor waking in sickbay as a
stranded episode, which is not a broken graph — it is a captain who did not
get up.

### And one hazard worth writing down

`Mission.stage` hands back the **shipped definition object**. A test that writes
`m.stage.where = 'sickbay'` changes that episode for every test after it in the
same file. The first draft of `tests/rooms.test.js` did exactly that and then
failed three tests later, claiming the tutorial sends a new captain to the
planet surface. Probes copy the stage now.

## 38. The capitals, and the first episode that follows from another

Ten of the map's twenty sectors hosted **no episode at all**, and among them was
every great power's home space:

| sector | systems | with an episode |
| --- | --- | --- |
| Qo'noS, Romulus, Cardassia, Gamma, Ferenginar, the DMZ, Vulcan, Andor, Risa, Betazed | 14 | **0** |
| everywhere else | 29 | 15 |

Fifteen of forty-three systems had anything authored in them. And the endgame
was thinnest of all — **Act 4 had two episodes and Act 5 had one**, against six
in Act 3.

**Nothing chained.** Sixteen episodes, forty-three flags, and the only
cross-content dependency in the whole book was `court_martial` waiting on
`inquiry_summoned` — a flag the *ledger* raises, not an episode.

### The chain was already latent in the map

`systems.data.js` refuses a berth at Qo'noS below Klingon standing 10, and at
Romulus below Romulan 25. And:

- *The Archanis Claim* pays **25 Klingon standing** and sets
  `kang_respects_you` for taking Kang's hand over the mining claim;
- *The Silence at Outpost 4* pays **20 Romulan standing** and sets
  `spared_warbird` for letting a crippled warbird go — and its ending text
  already promised *"Some years later, that decision comes back in your
  favour."*

So the ship that can dock at either capital is, in practice, the ship that
earned it years earlier. Nothing on either world knew that.

| episode | act | follows | opens where |
| --- | --- | --- | --- |
| *The Second Rite* | 4 | `kang_respects_you` (Archanis, act 2) | Qo'noS |
| *The Debt at Romulus* | 4 | `spared_warbird` (Outpost 4, act 2) | Romulus |

Both use `requiresFlag`, which `MissionBook.availableAt` has always checked and
which one episode had ever set. A test asserts the flag a capital waits on is
paid by an episode from an **earlier act** — a chain, not a lock.

### What they read back

| flag | was | now |
| --- | --- | --- |
| `archanis_massacre` | write-only | you can read the rest of the casualty list yourself, from memory |
| `captured_cloak` | write-only | you can tell Telek the device is aboard your ship |
| a living tactical officer | `requires.officer`, unused | somebody stands second for you at the rite |

The Second Rite also sends the captain to the **armoury** — a compartment that
has existed since the interiors were written and that no episode had ever used.

### Counts

| | before | after |
| --- | --- | --- |
| episodes | 16 | **18** |
| act 4 | 2 | **4** |
| sectors with an episode | 10 | **12** |
| episodes that follow from another episode | 0 | **2** |

`README.md` carries the episode count and `tests/docs.test.js` asserts it
against `EPISODES.length`, so the number in the prose moved with the content.

## 39. An ambush was a patrol with different words

`buildAmbush` has set `surprise: true` on every ambush since encounters were
written, and **nothing had ever read it**. So *"Sensors read nothing — then
everything. Ships decloaking off both bows"* opened exactly like a routine
patrol. Measured through `resolveEncounter('engage')`, the door the encounter
panel uses:

| kind | `surprise` | my guns ready | their guns ready |
| --- | --- | --- | --- |
| patrol | false | yes | yes |
| ambush | **true** | yes | yes |

An ambush is now what the word means: the ship that was jumped opens a cycle
behind. That is the exact mirror of the `first_strike` perk — *"Battle Doctrine
Exchange, you always fire first"* — which has always put the **enemy** a cycle
behind, in the same place and by the same arithmetic.

### Two species sold a defence against a thing that did not exist

| species | trait | mechanic | read anywhere? |
| --- | --- | --- | --- |
| Caitian | *"Predator's Instinct — You always act first in an engagement, and can never be surprised."* | `alwaysFirst`, `surpriseImmune` | **no** |
| Saurian | *"Wide Spectrum Vision — … Advantage against ambushes."* | `cloakDetect`, `ambushAdvantage` | **no** |

Now:

| | cycles behind on an ambush |
| --- | --- |
| Human, Vulcan, everyone else | 1.0 |
| Saurian — sees it coming | 0.5 |
| Caitian — never surprised | 0.0 |

Seeing it coming is deliberately not the same as having been ready.

### The wider version of the same finding

Counting every `mechanic:` declared across the species, background and career
tables: **61 keys, of which 12 are read and 49 are read by nothing.** Before
this section's three, it was 9 and 52.

```
READ (12):  advantageOn, alwaysFirst, ambushAdvantage, casualtyReduction,
            critBonus, extraProficiencies, extraProficiency, repGain,
            rerollPerMission, startingRankBonus, startingReprimand,
            surpriseImmune
```

**A note on how that was counted, because the first attempt got it wrong.**
Grepping for `mechanic('key')` call sites finds four, and four was the number
first written down here. It is not the number: five more are read inside
`character.js` by its own helpers — `advantageOn` through `hasAdvantageOn`,
`critBonus` through `shipMods`, `rerollPerMission` through `refresh`, and
`extraProficiency`/`extraProficiencies` through the proficiency and feat paths.
A second pass grepping the key NAMES across `src/` overcorrected the other way:
`critRange` is a parameter of `resolve()` in `dice.js`, and `xpRate` and
`autoSave` belong to the difficulty table, none of which reads a character.

The only reliable count is the list of actual consumers, which is short enough
to enumerate: the seven `mechanic()` call sites outside this file, and the five
helper reads inside it. Everything else is decoration.

Forty-nine is far too large for one change and is recorded here as the seam it
is. This section spends three of them.

### The freighter that was not in the fight

`buildDistress` constructs `victims: [new Ship('freighter', {name: 'SS
Kobayashi'})]` for *"A civilian freighter is under attack and losing
containment"* — and it was never passed to the battle. `Engagement` has
accepted `opts.allies` all along. It is on the board now.

**It is not yet a ship that can be lost, and that is worth saying plainly.**
Measured over twenty battles with three raiders and a Miranda, the freighter
was destroyed 0 times, damaged 0 times, untouched 20 times. The cause is in
`ai.js`, where the code and its own comment disagree:

```js
const candidates = [engagement.player, ...engagement.allies].filter(stillEngaged);
// Prefer whoever is hurting them most, otherwise the player.
ship.aiTarget = candidates.includes(engagement.player) ? engagement.player : candidates[0];
```

It never looks at who is hurting them. The player is the target while the
player is alive, so allies — the freighter, and the escorts three reputation
perks buy — are only ever shot at once the player is gone. Making the comment
true needs damage attribution, which `Ship.takeDamage` does not currently
carry; that is its own change and is not attempted here.

### An encounter with one button is a notification

Measured over twenty thousand encounters: **109 offered a single choice**
reading "Continue" — every non-hostile patrol from the Dominion, the Tholians
or the Borg, none of whom answer hails.

And `subtype` has carried a real errand since the errand table was written — a
tender servicing navigation buoys, a destroyer screening something you cannot
see, a squadron quartering the system for something it will not name — and
nothing had ever read it back. Watching them is a choice now, and what you see
depends on what they are doing. A test reads the errands the generator actually
produces rather than a list, so an errand added with no answer fails it.

### And one the order monkey found on the way past

Adding four phrasings to the lexicon moved the order monkey's random walk onto
a path nothing had taken, and it landed on this, in the intercom:

```js
helm: () => (this.transit
  ? `Underway for ${this.transit.to.name}, warp ${this.transit.factor.toFixed(1)}.`
  : ...
```

`Transit` has never had a `factor`. The constructor takes `warpFactor` and
stores it under that name, so **"helm report" threw on every ship that was
actually going somewhere**, for the whole life of the intercom. Confirmed
pre-existing on `origin/main` and untouched by this change.

The existing test called all seven stations — on a ship in spacedock, which
takes the other branch, so it could never see it. There is now a second test
that asks the same seven questions with a course laid in.

That is the second defect of this exact shape this run: a field read under one
name and written under another, invisible until something took the one path
that reads it. `tools/verify-app.mjs` gives every phrasing the parser knows to a
running game at whatever moment it happens to be in, and it is the only thing
in the project that would ever have asked.

## 40. Three traits that were words on the character sheet

§39 counted 49 species, background and career mechanics that nothing reads.
This spends three of them, and — more usefully — finds out **why** the rest are
unread, which is not one reason.

A check resolves through `AwayTeam.check`, and it asked exactly one question
about the captain: `hasAdvantageOn(ability)`, which reads `advantageOn` and
nothing else. Measured through `Game.buildAwayTeam` and that same check, 300
runs at DC 14:

| species | healthy | ship below half hull | what the card promises |
| --- | --- | --- | --- |
| human | 61.0% | 61.0% | *"Once per away mission, reroll a failed check."* |
| bajoran | 56.0% | 56.0% | *"Advantage on checks made while your ship is below half hull."* |
| half_vulcan | 61.0% | 61.0% | *"Choose Logic or Instinct before any check: advantage on Science, or on Command."* |
| **vulcan** | **85.3%** | **85.3%** | `advantageOn` — read since it was written |

The Vulcan row is the control: advantage is worth about 24 points here, so the
measurement can plainly see one. The other three promised it and never got it.

### What each needed

- **Bajoran.** The away team had no reference to the ship at all, so the one
  fact the trait depends on was not in the room. `Game.buildAwayTeam` is the
  only caller that knows it, and passes `hullPct` now. **56.0% → 80.3%** with
  the ship under half.
- **Half-Vulcan.** Nothing stored a choice, so neither discipline was ever
  live. It is a real choice now, on the character, and it survives a save —
  a setting that cannot be set is the same defect one level down. Unchosen
  falls to the first, so a captain who never picks still has one, and it is
  strictly **one at a time**: granting both would make it better than the
  Vulcan's, which grants one.
- **Human**, the species most captains are. `AwayTeam.canReroll()` has existed
  since the away team did and was **called from nowhere**; `rerollsRemaining`
  was set by `Character.refresh`, which `startCombat` calls and the away system
  does not, and was decremented by nothing. It refreshes per mission now, which
  is what the card says, and is spent on the first failed check — an away
  mission resolves as one batch, so there is no moment at which the game could
  stop and ask.

### Why the others are unread, which is the useful part

Not all forty-nine are the same kind of gap:

| kind | example | what it would take |
| --- | --- | --- |
| the fact was not in the room | `desperateAdvantage` | pass it in — done here |
| the effect exists but is unreachable | `rerollPerMission` | give it a caller — done here |
| **it modifies a mechanic that does not exist** | `saveDisadvantage` | `dice.js` exports `save()` and **nothing calls it** |
| | `noUntrainedPenalty` | there is no untrained penalty; being unproficient costs nothing |
| | `ignorePressure` | there is no pressure penalty |
| | `ignoreOutnumbered`, `outnumberedAdvantage` | a check has no notion of being outnumbered at all |

The third row is the important one. Those traits are not unread because someone
forgot to wire them up — they are unread because **the thing they modify was
never built**. Making them true is a design change, not a fix, and each needs
its own decision about what "a saving throw" or "being outnumbered" should mean
here. That is why they are written down rather than guessed at.

### The commission driver was flying on one lucky seed

Adding a reroll draws from the world stream — correctly, because a reroll is an
outcome and not a cosmetic like an arena rock or a ship's name — and every
seeded result downstream moved. Two coverage assertions in
`tests/commission.test.js` then failed.

They were fragile, not wrong. Measured on the code before this change,
`derelict_search` was reached by **exactly one of the three** commissions
(seed 77001), and `escaped` was a single commission's only sighting of that
outcome. A wreck worth boarding needs a fight that ends a particular way and
then a captain with no engagement running — a thin path, and any change that
moves the stream at all could take it away. One did.

The bar is unchanged; the evidence is wider. Five commissions instead of three,
which costs 10.5 seconds and asks the same question of more play.

## 41. "Prefer whoever is hurting them most, otherwise the player"

That comment sat above this, in `src/sim/ai.js`:

```js
const candidates = [engagement.player, ...engagement.allies].filter(stillEngaged);
// Prefer whoever is hurting them most, otherwise the player.
ship.aiTarget = candidates.includes(engagement.player) ? engagement.player : candidates[0];
```

It never looked at who was hurting them, because **nothing anywhere recorded who
was hurting whom**. `Ship.takeDamage` took a bearing, a type and a piercing
value, and no attacker.

And there was a second half to it, found only when the first was fixed: the pick
sat inside `if (!stillEngaged(ship.aiTarget))`, so a target was chosen **once**
and kept until it died or ran. Even a rule that could read the damage would only
have run on the opening tick, before anybody had fired.

### What it cost

| | destroyed | damaged | untouched |
| --- | --- | --- | --- |
| the SS Kobayashi, 20 battles vs three raiders | 0 | 0 | **20** |
| a Galaxy-class escort firing alongside a Miranda, 20 battles vs two D7s | 0 | 3 | **17** |

Every ally in the game was unshootable while the player lived — including the
escorts that **three separate reputation perks** are sold to buy, and the
freighter in *"A civilian freighter is under attack and losing containment"*,
which #154 had put on the board and could not make shootable.

### The three rules

1. **Whoever has hurt us most lately.** `Ship.threat` records it, keyed by the
   ship that dealt it, and halves it every eight seconds — so this means still
   hurting us, not ever did. Hazards, collisions and boarding pass no attacker
   and record nothing.
2. **Failing that, anything here that cannot shoot back.** The raiders were
   already shooting the freighter when the captain arrived; they go on shooting
   it until somebody gives them a reason not to. This is what makes rule 1 mean
   something — the reason is that you started shooting.
3. **Failing that, the player.**

Plus a re-pick on the decision tick, with wide hysteresis: it takes being hurt
**half again** as much to be worth breaking a firing solution for, or two ships
trading fire flip targets every few seconds.

### After

| | destroyed | damaged | untouched |
| --- | --- | --- | --- |
| the SS Kobayashi | **10** | 10 | 0 |
| the Galaxy escort | 0 | **20** | 0 |
| a Miranda escort beside a Constitution | 0 | 19 | 1 |

The distress call is a thing you can now fail: median 19% hull left on the
freighter you came to save.

### And it changes nothing about a fight nobody else is in

The control that matters most, because a change to how a target is chosen must
not touch the balance of a duel. Four matchups, 25 seeds each, no allies:

| | ship lost | median lowest hull |
| --- | --- | --- |
| before | 71 of 100 | 0% |
| after | **71 of 100** | 0% |

Identical. With one candidate there is nothing to choose between.

### What it did move, and what that says

The commission driver's *"fights ended in more than one way"* lost `destroyed`:
allies now absorb fire, so a captain with an escort is harder to kill, which is
what an escort is for. Widening from five commissions to seven did **not** bring
it back, so this is systematic rather than noise, and widening further would be
chasing a seed.

So the bar there is now what that driver can honestly deliver — two — and the
claim it used to carry is asserted where it can be: over fights flown to the
finish across five matchups, measured **routed 38, victory 10, destroyed 12 of
60**. All three reachable, none needing luck. That is a better test than the one
it replaces, which inferred the game's variety from twenty-three fights a
cautious scripted captain happened to have.

### Two mistakes worth keeping

A first draft hit an Orion raider for 1200 to make it reconsider — which is most
of a 1900-hull ship, so it broke off, and **a fleeing ship never reaches target
selection at all**. The test measured nothing and said so as a failure.

A second wrote `g.ship.repairAll?.() ?? g.ship.fullRepair?.()`, neither of which
exists, and then cleared the map by hand as a fallback. It passed while proving
nothing. The method is `restore()`.

## 42. Six of the twelve feats did nothing at all

A feat costs a promotion. There are twelve of them in `src/rules/character.js`,
each one a sentence on a card and a `mechanic` object under it. Measured on
`origin/main` at `a3f2de8`, through the game's own entry points:

| feat | mechanic | what it did |
| --- | --- | --- |
| Field Commission | — | raises scores; works |
| Xenobiologist | `advantageOn` | works |
| Polymath | `extraProficiencies` | works |
| Tactical Genius | `critRange`, `critSeverity` | half — severity hard-coded beside the table, `critRange` dead |
| Master Engineer | `coreRecovery`, `instantPower` | half — power wired by a `hasFeat` check, recovery dead |
| Living Legend | `repGain`, `enemyHesitation` | half |
| Diplomatic Immunity | `universalPassage` | **nothing** |
| Fleet Tactician | `allyCommand` | **nothing** |
| Inspiring Presence | `officerCooldown`, `noObjection` | **nothing** |
| Survivor | `deathSave` | **nothing** |
| Unshakeable | `autoSave` | **nothing** |
| Improviser | `noUntrainedPenalty` | **nothing** |

The measurement that says it plainly: a Diplomatic Immunity captain — "you may
enter any faction's home system regardless of standing" — standing in each of
the four systems in the galaxy that ask for standing. `canDock()` returned
false, false, false, false, and the helm still read out the warning that they
would not open a berth. Master Engineer and Inspiring Presence produced
byte-identical results with and without them.

### Counting it honestly

The **strict** count, which is the one to trust: a mechanic is READ when its
VALUE is consumed somewhere outside the declaration tables — named to
`mechanic()`, or read off a `mechanic` object by a method. On `origin/main`
that is **14 of 61**. After this work it is **22 of 61**.

A looser name-grep gives 24 and is wrong in both directions. It counts
`autoSave` and `xpRate` as read because the *difficulty ladder* has fields by
those names, which have nothing to do with the feats that declare them; and it
misses `instantPower`, which is genuinely wired by a `hasFeat` check in
`state.js`. This is the third time a count of these has been published and the
first two were both wrong — §39 corrected "57 of 61 unread" to 12/49, and a
later note said 15/46. **Say what the counting rule is, or do not publish the
number.**

### What each of the six now does

**Diplomatic Immunity.** `mayBerthDespiteStanding(faction)` — one question,
asked in the two places that ask it. `canDock`, which turns you away at the
door, and `crossingWarningFor`, which warns you before you lay the course that
you are going to be. They had drifted into the same expression written out
twice, which is how a captain ends up warned off a berth and then given it.
Qo'noS, Romulus and Cardassia Prime open. The Founders' Homeworld stays shut,
because it has no dock in its facilities at all and the feat says *regardless
of standing* — it lifts the standing gate and nothing else. The Neutral Zone
and the DMZ stay shut for the same reason: those are treaty lines, and they
close on a captain in perfect standing exactly as hard.

**Tactical Genius.** "Critical hits on a natural 19 or 20." The twenty-sided
die is gone from gameplay — the header of `rules/resolve.js` says why —
but the thing that sentence is *about* is alive and is called `critChance`,
which every ship starts with at **0.05**: one twentieth, which is a natural 20.
A crit range of 19 is two twentieths. So the feat's own declared number sets the
bump, `critRange` stops being decoration, and `critSeverity` is read off the
table instead of being written out a second time beside it.

**Master Engineer.** `Ship.recoverCore()`. An ejected core does not evaporate;
it is drifting off the quarter with its own transponder on it. Getting a
tractor beam on a live antimatter assembly and walking it back into the housing
is the part almost nobody can do. It comes back **cold** — the warp core
subsystem at 0.35 — and not in a fight, because a ship doing that manoeuvre is
station-keeping. That is the cost of the feat as much as the flavour of it:
eject to live, then win the fight before you can go back for it.

**Fleet Tactician.** `Character.allyMods()` — the same two terms Tactics
contributes to your own ship, and no others, applied to every ally: the
freighter in a distress call, the Miranda a reputation bought, the Galor that
came along to watch us, and the ship that answers mid-fight. It is worth
exactly as much as allies are, which since #156 made them shootable is a great
deal.

**Survivor.** "Once per commission, survive what would destroy the ship at 1%
hull." Put in `Ship.destroy` rather than at the likeliest call site, because a
ship is destroyed by weapons fire, by a breach it ran out of time on, by losing
its whole crew and by a hull that fails while the core is clear — a feat that
answered one of those is a feat that works when the game happens to kill you
the expected way. Not spent with the crew gone: over sixty battles a Miranda
could not win, the ship was lost **58 times to catastrophic hull failure and
twice to total crew loss**, and a save spent on the second buys one tick before
`update` finds the crew at zero again. The allowance is *computed* from the
sheet minus what has been spent, because `applyAllMods` runs again every time
anything touches the ship's modifiers and a save refunded by changing a console
is not once per commission.

**Inspiring Presence.** Cooldowns divided by 1.4 — "recover 40% faster" is the
same wait divided by 1.4, not multiplied by 0.6, and only one of those readings
can reach zero. And officers never object.

### The defect underneath the last one

`noObjection` could not mean anything until this was fixed. Every ability
computed the officer's reaction:

    const reaction = officer.reactTo({ risk: a.id === 'eject_core' ? 0.9 : 0.2 });

and then spoke it:

    const spoken = a.say ?? officer.acknowledge(reaction === 'comply' ? 'order' : reaction);

All **twenty-six** abilities carry a `say`. The right-hand side of that `??`
had never once evaluated. An officer's objection was computed, stored on the
result object, and then delivered as the cheerful canned line — and a *refusal*,
the third answer `reactTo` has documented since it was written, executed the
order anyway.

Three fixes. The `say` is what compliance sounds like; anything else is said in
the officer's own voice. A refusal is refused before the cooldown starts and
before any effect lands, because an order that was not carried out must not
cost the station its clock. And the weights come off the ability rather than
from `a.id === 'eject_core' ? 0.9 : 0.2` — `ethicalWeight`, which is the input
`reactTo` needs to refuse at all, had never been supplied by anybody.

Four abilities now carry weights: Eject the Core (`risk: 0.9`), Stimulants and
False Signal (`ethicalWeight: 0.35`), Back to Duty (`0.4`).

**Back to Duty was tried at 0.55** — over the refusal line — because a chief
medical officer who will not clear an unfit officer for duty is the most
in-character refusal in the franchise. The TOS doctor has the discipline and
the candor for it, so a canon crew lost the use of a rank-two ability outright,
for the whole campaign, in every seed. It sits at 0.4 and draws an objection
instead. A doctor who says it is a bad idea and then does it is the right
answer; a game feature one crew can never use is not.

### The two left alone, and why

`autoSave` (Unshakeable) and `noUntrainedPenalty` (Improviser) are phrased
against machinery the game does not have. `dice.js` exports `save()` and
nothing calls it; there is no untrained *penalty* anywhere — an untrained
ability simply lacks the proficiency bonus, so there is no disadvantage for the
feat to remove. Both need a design decision about what the underlying mechanic
means before any code, and guessing is how a project comes to do something
other than what its cards say. Same shelf as `ignorePressure`,
`ignoreOutnumbered` and `outnumberedAdvantage` in §40.


## 43. A captain fought the same battle from the chair and from his own brig

Twenty-four battles against two Galors, the same captain, the same seeds, moved
from compartment to compartment before the shooting started:

| standing in | accuracy | repair | won | hull left |
| --- | --- | --- | --- | --- |
| the bridge | 1.0450 | 1.116 | 3 / 24 | 4.7% |
| his quarters | 1.0450 | 1.116 | 3 / 24 | 4.7% |
| **the brig** | 1.0450 | 1.116 | 3 / 24 | 4.7% |
| main engineering | 1.0450 | 1.116 | 3 / 24 | 4.7% |

Byte for byte the same fight from the captain's chair and from a cell. The ship
has seventeen hand-authored rooms, a walker with collision and routing, a
turbolift serving nine decks, ambient occupancy and a first-person view, and
the only mechanical question any of it could answer was whether the chair was
within arm's reach.

### The con was the missing wire

Walking off the bridge already handed the con over. There is a line of
succession (`watch.js`), a watch bill, hours kept, and a handback report read
out when the captain takes it back — *"the ship kept going without you, which is
the whole reason the con exists rather than the bridge simply pausing."*

`conStation` was read by two display sites, one invariant, and the save file.
**Nothing about the ship changed hands with it.**

So the ship is now commanded by whoever holds the con. The captain's ability
modifiers reach the ship while the captain is conning her; a watch officer
contributes the same shape scaled off `expertise`, which is the one number an
officer has where a captain has a character sheet.

The rule cuts both ways, and that is the test of whether it is a rule about
command rather than a penalty for walking: **a captain with no ability
modifiers at all is measurably better off with a good first officer conning the
ship.** That was true of real ships and was not sayable in this one before.

Auxiliary control is the second place the ship can be commanded from. It was
one of six rooms nothing outside the deck plan referenced — a compartment with
a door, a light and no reason to walk to it.

And the room buys what an intercom cannot: main engineering scales `repairRate`
off the captain's Engineering, sickbay scales `crewProtect` off Medicine, and
both are paid for with the con. The room is a choice with two sides now.

### Two doors off a deck, one rule

`goToRoom` refused to move the captain under fire. The other way off a deck —
walk up to the door, press Use — went from the screen into `Walker.useExit`
with no mode check anywhere on the path. Measured on the same tick:

    goToRoom('engineering') -> {ok: false, reason: "Not while we are under fire, Captain."}
    useExit()               -> {ok: true, room: turbolift}   ... and the lift serves nine decks

Going round the game also skipped `updateCon`, so a captain who left the bridge
by hand was still holding the con from the cargo bay while his first officer
stood on the bridge with nothing to do.

`Game.useExitAhead` is the verb, `Game.mayWalk` is the rule, and a wiring test
now asserts that **only `state.js` and `walk.js` call `useExit` at all** —
because "one rule in one place" is a claim about the whole tree, not about the
two lines that were fixed. Same shape as §42's `mayBerthDespiteStanding`.

### The sampler that quietly shipped a smaller crew

Five compartments had no occupancy rule: auxiliary control, the captain's
quarters, the briefing room, the brig and the transporter room. At yellow alert
seven of seventeen returned nobody at all.

Writing the rules found something older. `place()` threw twelve uniform darts at
the room and gave up, and the briefing room is six metres by four and a half
with a conference table in the middle of it — a clear ring about a metre wide.
Asked for three, it stood **one** of them up and dropped the other two without a
word. The ship had fewer people in it than its own table said and nothing
anywhere complained.

The note already on `place` records exactly this happening in the recreation
room and fixing it by moving a threshold, which fixed that room and not the
sampler. So the darts now fall back to a deterministic walk round the
perimeter — sixteen bearings at two radii, offset by the person's index. The
briefing room seats its briefing, and **the recreation room got back a sixth
person it had been asking for and losing all along.**

A test now walks every room at every alert condition and fails if anybody is
standing inside the furniture, so no future rule can quietly ask for more than a
compartment holds.

### Read it or delete it

`angleDelta` (`walk.js`) was exported and not called even inside the file that
declared it — `stepToward` snaps its facing with a raw `atan2`. Deleted.

`ROOM_WORDS` (`interiors.data.js`) was exported, imported nowhere, and
documented as being "for the parser's gazetteer." Deleted rather than wired: the
gazetteer's business is fuzzy and phonetic matching of star system names, the
note directly above `findRoom` says room matching is **deliberately not fuzzy**,
and handing it `bridge`, `brig` and `cargo` as place words is how "set course
for the bridge" starts resolving to a star.

Three other things a survey called dead were not, and were checked before being
touched: `Game.get watchOrder` is used at `screens.js:77`, and `RECIPE_BY_ID`
and `resolveIn` are both used in `state.js`. Only `beginAssignment` and
`dutySlots` were genuinely unused imports. **Verify a standing figure before
building on it** — §42, and the third time this run.


## 44. Every officer came out of the commission exactly as they went in

`Officer.xp` and `Officer.level` were declared on the class, defaulted, saved,
loaded, and guarded by an invariant in `sim/invariants.js` that checks they are
not negative. The only writes anywhere in `src/` were those two defaults.
Measured over twelve battles, twelve landings, thirty-six days and forty-eight
thousand experience, while the captain went from his first command to Captain:

    AT COMMISSIONING     Spock  xp=0 lvl=1 rel=0 exp=94
    AFTER ALL OF THAT    Spock  xp=0 lvl=1 rel=0 exp=94

Byte-identical, every officer aboard.

`Officer.relationship` was worse: it carried the comment *"-100..100, how they
feel about serving under you"* and appeared on three lines in the whole of
`src/` — the declaration, `save()` and `load()`. Nothing incremented it, nothing
decremented it, nothing branched on it.

### What a level buys, and what it deliberately does not

`expertise`. It is the one number an officer has where a captain has a
character sheet, and it is read in five places that matter: how fast their
station comes off cooldown, how well they conn the ship when the captain is off
the bridge (§43), how a detail they lead turns out, and who gets picked for one.

**Not new abilities.** `Game.trainOfficer` is the route to those and it is gated
on the CAPTAIN's rank, with a comment saying that is deliberate — *"what a crew
is allowed to train for is a function of the ship's standing orders."* Growing
into them here would quietly undercut a decision the game has already made.

An earlier note in this dossier's planning called five rank-3 abilities ones
"nobody can ever hold." That was wrong and was checked before anything was
built on it: they are unheld **by default** and reachable by training, which is
wired to the officer panel and to a spoken order. Unheld is not unreachable.

The method is `serve`, not `addXP`. `CaptainProgress.addXP` carries a promotion,
a feat and skill points, and `tests/rules.test.js` nets the whole tree so that
nothing calls `.addXP` outside `Game.awardXP` — ten call sites once dropped the
promotion on the floor. Two unrelated things sharing a name is how that net
comes to be loosened to let one of them through.

### The measurement that nearly fooled me

The first tuning pass had a crew finishing a twelve-battle run at **-50**, and I
read that as a mistuned penalty and started moving thresholds. It was not.
Instrumenting the regard by reason showed the run's real shape:

    combat outcomes: { victory: 2, null: 2, destroyed: 8 }
    regard by reason: { 'a fight won': +4, casualties: -1,
                        "a butcher's bill": -27, 'the ship lost': -48 }

**That captain lost the ship eight times in twelve.** A crew that has been blown
up eight times ought to think poorly of him. The scenario was wrong, not the
numbers — and "retune until the number looks nice" would have quietly destroyed
a mechanic that was already correct. Both directions are now measured:

| | outcomes | exec's regard |
| --- | --- | --- |
| a winning captain | 14 victories | **+28** |
| a losing captain | 14 ships lost | **-100** |

One real retune survived that: a single D7 battle costs a median **26%** of the
ship's complement, so docking regard above 8% fired in 27 of 30 fights. That is
not "casualties cost something", it is "fighting costs something", and it
drowned every other term. A quarter is the cost of a hard fight; nearly half is
a butcher's bill.

### Read where the officer layer said it would be

`relationship` shifts the two scores `reactTo` already weighs, twenty points
across the full range, rather than adding a fourth rule — so a captain the crew
would follow anywhere reads as officers who are simply less argumentative.
Measured over forty crews and three ethically-weighted orders:

| the bridge's regard | objects |
| --- | --- |
| -80 | **79.2%** |
| 0 | 48.3% |
| +80 | **19.2%** |
| 0, Tellarite captain | 65.0% |

That last row is `officerFriction: 0.2` — the Tellarite's *"Argumentative:
officers object more"* — declared on the species and read by nothing until now.

A bar measured against the canon TOS crew reads **66.7% at every level of
regard** and says nothing: that crew has one medical officer with one candor
score, twenty points of trust does not carry him across his own threshold, and
the third order is gated on daring, which regard does not touch. A rule about
officers has to be measured against a population of officers.

### The redshirts were the safest people on the ship

Found by a test that refused to pass without the case it was about. The first
draft of "a redshirt is not a grievance" asserted that nobody's regard had
changed — after doing nothing at all. Rewritten to fly landings until it found a
security-only casualty, it reported: **sixty landings, nine casualties, every
one a named officer, and not one of the four security crewmen on every single
team was so much as scratched.**

The cause: the casualty branch absorbs a **death** into the security detail, and
nothing absorbed an **injury** — and injuries are the common case (`routine`
hazard is 4% injury against 0.4% death). The detail that exists to stand between
the officers and the danger only ever absorbed the rarest outcome.

Letting it absorb every injury measured just as wrong the other way: all nine
casualties became security crewmen, no named officer was ever hurt again, and
sickbay, `back_to_duty` and the whole injury system went quiet — four crewmen
against two or three checks a mission is a detail that never runs out. So
bringing security **halves** the chance the casualty is one of your officers.
Nine casualties, four of them security. A number a captain can act on, with the
risk that makes the choice matter left in.

### Read it or delete it

`DutyOfficer.species` — generated, saved and reloaded for every one of the 2-14
duty officers since the roster was written, and the panel printed a name, a
rating and a state. **Read**: the roster shows it, so the ship's complement is
as varied on the page as it always was in the save file.

`Officer.canon` — defaulted on the class, set true for the canonical roster,
saved, reloaded, read by nothing ever. What the screens actually ask is
`game.crewMode === 'canon'`, which is the game-level fact. **Deleted**: a
per-officer copy of it is a second source of truth that can only drift away from
the first.


## 45. Fifty-seven things the ship wrote down and never read again

The campaign ledger records what the captain did, as flags: `archanis_massacre`,
`torvan_owes_you`, `paid_orions`, `kang_respects_you`. **The episode book writes
57 of them and reads 8**, all eight through `requiresFlag` and
`requires: { flag }` inside other episodes. Nothing outside
`src/missions/episodes/` reads a single mission flag — and that includes the one
system in the game whose entire job is what the other side thinks of you.

Measured at 120 seeds, a Klingon negotiation through `Game.hail`:

| what they remember | they agree |
| --- | --- |
| nothing | 40.0% |
| Kang has spoken for you, and you kept your word at the council | 40.0% |
| you refused their surrender and killed forty-two of them | 40.0% |

`resolveHail` did have one thing it called memory: `firstStrike`, carrying the
comment *"you shot first; they remember"* — a single boolean about the last few
minutes, sitting next to a five-year record nobody ever opened.

After:

| what they remember | they agree |
| --- | --- |
| nothing | 40.0% |
| Kang has spoken for you | **70.0%** |
| Archanis | **1.7%** |

### The sign comes off the choice, not off the name

Every entry's sign was read from the label of the choice that sets the flag, and
a table built from the names would have got at least two of them backwards:

- `kang_left_alone` sounds merciful. It is *"let it end here and return to the
  ship"* and costs sixteen points of Klingon standing on the spot. **Negative.**
- `paid_orions` sounds like a shakedown you lost. It is *"pay him"* and buys
  eight points of Orion standing. **Positive**, with them.
- `archanis_massacre` is *"finish them"*, `surrender_refused`, forty-two lives.
  The heaviest entry in the table at -0.30, against -0.25 for shooting first.

### What was deliberately left out

Twelve flags with a defensible sign beats fifty-seven with a guessed one.

`romulan_cloak_reported` is *"let him go. Report the weapon"* — you spared their
commander and told Starfleet about their cloak. That is a favour and a betrayal
in the same choice and a sign cannot honestly be put on it. `dmz_favourable` is
a treaty favourable to us, which is not obviously a thing the other side is
pleased about. Both are out.

The **Borg** are out for a different and stricter reason: their doctrine is
`assimilate`, and `resolveHail` returns before the memory term is reached
because nothing answers. An entry for them would read as a feature and never be
consulted once — which is precisely the defect this section is about, so a test
asserts the table contains no faction whose doctrine refuses the channel.

**8 of 57 read before; 16 after.** Counted programmatically, both times, by the
rule stated here: a flag is read when something outside the file that writes it
consults its value. (`inquiry_summoned` is also read, and is set by `main.js`
rather than by any episode, which is why the raw ledger count is 9 and 17.)

### The meta-test that accused the code, and was wrong

The table is guarded by a test asserting that **every flag it names is one an
episode actually writes** — because a memory table naming a typo would read as a
feature and be exactly as dead as the thing it replaced.

It failed on `romulan_favour`, and the first instinct was that the table had
invented it. It had not. The flag is set by `romulus_debt`'s **ending**, in
`endings.acquitted.effects.flag`, which is precisely where a flag about how
Romulus feels afterwards belongs — and the inventory walked `stages[].choices[]`
only. Seven of the fifty-seven are set by endings and nothing else:
`inquiry_resolved`, `borg_hurt`, `command_reviewed`, `commended_command`,
`censured_command`, `archanis_ratified`, `romulan_favour`.

**An inventory that misses a whole shape of write is worse than no inventory,
because it accuses the code.** Check the scanner before believing what it says
about the thing being scanned.


## 46. Two worlds that had a description and no episode

Twenty-six of forty-three systems hosted nothing, and Act 5 held one episode,
which was the finale. Among the empty ones were two places the map had already
written an episode's worth of description for:

| | |
| --- | --- |
| **Cardassia Prime** | *"Central Command, the Obsidian Order, and a customs process designed as an interrogation."* |
| **Khitomer** | *"Neutral ground, chosen because both empires could reach it and neither could hold it."* |

Both new episodes follow from earlier ones, the way the capitals do. *The Debt
at Cardassia* is Act 4 and needs `torvan_owes_you` from the Terok Nor treaty
(Act 3) — the choice *"raise it privately and let him withdraw the claim"*. *The
Second Accord* is Act 5 and needs `qonos_upheld` from the Great Hall (Act 4).

**Act 5 now has two episodes in it. Nineteen of forty-three systems host
something, up from seventeen.**

Each has one scene in a compartment that had never been used for anything: the
**briefing room** and the **brig**. Both were among the six rooms with no
functional reference outside the deck plan before §43 gave them occupancy
rules; now the captain has to physically walk to them, because `stage.where` is
enforced.

### The rule for new content

**New content may not write a flag nothing reads.** Forty-one of the book's
fifty-seven are still write-only and that is a known debt (§45); adding to it in
the same run as a PR about it would be indefensible.

The first draft of these two episodes set **six** flags nothing anywhere read —
`quoted_the_clause`, `named_the_source`, `torvan_owes_you_nothing`,
`named_the_house`, `read_the_ninth` and `khitomer_source`. Exactly the defect
just written up. Three were deleted, and three became things the game consults:

- `torvan_clear`, `khitomer_signed` and `kang_owes_you` went into §45's faction
  memory table. Standing up for a Cardassian officer in a Cardassian courtroom
  is worth **+0.22** the next time a Cardassian answers a channel.
- `read_the_ninth` and `khitomer_source` gate the endgame. **You cannot speak to
  a page you did not read, or name a house nobody told you about** — a captain
  who handed the prisoner to the Klingons and stayed at the table has exactly
  one of the four closing choices available, and signs eight pages instead of
  nine. That is the cost of not going down to the brig, and it is a gate made
  out of two flags that would otherwise have been decoration.

A test asserts the rule by name and fails with the offending flag printed.

### Playing it found what the walk did not

`tests/wiring.test.js` walks every episode thirty times with random legal
choices, and both of these passed it on the first run. Playing them by hand
through `availableAt` → `start` → `choices` → `choose` did not:

    [anywhere ] tribunal -> Name the officer who sold the recording
    [anywhere ] tribunal -> Name the officer who sold the recording
    ... eighteen more times, xp 1,033,200

The terminal choice applied its effects over and over and the mission never
ended. **That was the probe, not the episodes.** `Mission` sets `complete` and
`outcome`; the harness had guessed `over` and `ending`, found `undefined`, and
looped. The million experience should have been the tell and was not.

Same class as `Game.load` being static, `PLAYER_SPECIES` not `SPECIES`, and
`eng.allShips` not `eng.combatants` — the fourth time this run a probe has
invented an API and then reported about the code instead of about itself.
**Check the harness before believing what it says about the thing being
harnessed** — §45 said the same about a scanner two sections ago.

Played correctly, both run clean: five stages to *The debt discharged* by way of
the briefing room, five to *Kang's accord* by way of the brig, and three to
*Eight pages* for the captain who never went down there.


## 47. Latinum had one way in and no way out

The hail option is called **"Offer them latinum."** `resolveHail` has returned
`cost: 'latinum'` on a successful bribe since it was written. `Game.hail` never
read that field. Measured over two hundred attempts against an Orion raider:

    bribes accepted 165/200 | latinum actually changed hands 0 times

It was worse than a free option, because there was nothing else to spend it on
either. Latinum had exactly **one** income in the whole game — escort contracts,
`state.js:2538` — and **no expenditure anywhere**. A number that started at 500,
only rose, and was guarded by an invariant that it stay non-negative, which it
could not fail to do.

### What a bribe costs

Stated before any code was written, per §40. The price is **what you would
otherwise have to fight**, and the game already has a measure of exactly that:
`forcePower`, in Constitutions, with Lanchester's square law already inside it.
Two hundred times that, with a floor of fifty because nobody takes a derisory
offer:

| buying off | costs |
| --- | --- |
| one Orion raider | 50 |
| two raiders | 75 |
| a D7 | 198 |
| two Galors | 612 |
| three D7s | **1,784** |

A lone raider is pocket change, a battlecruiser is most of a starting purse, and
a squadron is out of reach until you have earned it. **An offer you cannot cover
is not offered** — `availableHails` hides it — and a caller that says nothing
about money gets the option exactly as it always was, so the fuzzer, the
invariant checker and the order monkey are unchanged.

165 of 200 accepted, and 165 of 165 paid.

### Six mechanics about what a ship costs to keep

Every one declared on a species, an origin or a trait, and read by nothing:

| mechanic | carried by | before | after |
| --- | --- | --- | --- |
| `fieldRepair` 1.3 | frontier_colony | 40.0% → 53.6% | 40.0% → **57.7%** |
| `repairTime` 0.5 | tinkerer | 2.500 days | **1.250 days** |
| `recoveryRate` 2 | denobulan, beloved | severity 0.500 | **0.100** |
| `salvageBonus` 1 | tinkerer | 16 / 7 / 16 | **33 / 13 / 33** |
| `rescueXP` 1.6 | refugee | +400 | **+640** |
| `tradeBonus` 0.25 | civilian_transport | +400 | **+500** |

Two placements are decisions rather than lookups. **`fieldRepair` is not on
`ship.mod('repairRate')`**, which is the in-combat damage-control path in
`Ship.update`; it is on `passTime`'s underway repair, which is the only thing
that mends a hull outside a yard. Being better at keeping her going between
starbases is a different claim from being better at patching her while she is
being shot at, and the card makes the first one. And **`tradeBonus` sits beside
`better_prices`** — the one reputation perk of twenty-four that was ever read —
because "prices improve by a quarter, everywhere" and `0.25` are the same
sentence in the same units; they stack, because one was bought and the other is
where you grew up.

### The carriers are not the ones you would guess

A draft of the test file measured `fieldRepair` on a Tellarite and
`salvageBonus` on a Ferengi. **Neither has ever declared either.** They are an
*origin* and a *trait* — `frontier_colony` and `tinkerer` — and the measurement
would have compared two identical captains and reported the feature dead after
it was wired.

A test now asserts the carrier list by name, so the bar can never again be set
on the wrong captain. Same lesson as §45's scanner and §46's probe: **check what
the harness is pointed at before believing what it says.** That is three
sections running, and the count of times a probe has invented an API or a
carrier this run is now five.


## 48. A console slot, four skill points, and a science officer, all spent on nothing

The plan finished at §47, so this is the continuous item: hunt defects at lower
yield. The method that found this one was a sweep rather than a hunch — take
every modifier the ship stores, and check that something, somewhere, asks for
it.

Eighteen stored. Seventeen read. The one that was not:

| writes `stealthDetect` | |
| --- | --- |
| `ship.js:314` | the baseline, 1 |
| `skills.js:58` | "Sensor Analysis — cloak detection and scan quality", a science node, +0.15 a rank to four |
| `loadout.js:37` | "Multispectral Sensor Array — see cloaked ships sooner", tier two, **two slot value**, +0.4 |
| `character.js:547` | the captain's Science ability, +6% a point |
| `state.js:1539` | a watch officer's expertise, up to +10% |

Nothing anywhere called `mod('stealthDetect')`. Measured over forty
sixty-second runs against a Bird of Prey held cloaked throughout:

| | before | after |
| --- | --- | --- |
| stealthDetect **1.150** | 1714 | 2172 |
| stealthDetect **2.912** | 1714 | **2596** |

Exactly 1714 both ways. **Two of the five contributors are things the player
pays for with a limited resource**, and one of them costs two slot value on a
ship that has few.

I put the fifth of those five there myself, in §43, wiring the con — I copied
the shape of the captain's contribution wholesale without checking that
anything read it. The same defect as the write-only flags, committed while
writing the PRs about them.

### Where it goes

`combat.js` had the seam already:

    const evade = target.defenseRating + (target.cloaked ? 0.5 : 0) + decoy;

A flat half, no matter how good the sensors are — which is exactly what "cloak
detection" is about. The half is now divided by the attacker's `stealthDetect`,
**floored at 1** so nothing can ever make a cloak worth *more* than the number
that was tuned when nothing read it. This is a discount on the enemy's
advantage, not a new axis.

### The balance question, settled by measuring

A captain who has bought nothing still carries about 1.12 from Science alone,
so this could not be assumed to be a no-op. Against the heavy cloaking classes
— warbird, vorcha, neghvar, which is where a cloak decides anything:

    24 of 90 won before the change, 24 of 90 after

Birds of Prey were tried first and are useless for this: 90 of 90 either way,
which cannot tell the two apart. A captain with a little Science does land
about a quarter more onto a cloaked hull, and it does not change who wins.

### The console's other half was dead too

`sensor_array` also declares `special: 'scan'`. Scan quality was
`progress.scanBonus` — which comes from the **skill tree** — plus
`sensorQuality`, which is the subsystem times its power. **A fitted array
reached neither.** Both of the console's effects did nothing at all.

There is now one `Game.scanQuality` that says what scan quality is made of, at
the same 0.12 a rank the skill uses, against the console's own `value` — so a
two-value console is worth two ranks of the node, in the same units, rather
than two scales that happen to be added together. A test asserts that ratio.

### The sixth invented API

The first draft of the test harness fitted the console with
`loadout.fit('science', 'sensor_array')`. There is no such method. The call was
optional-chained, returned `undefined`, and the console was never aboard — so
the "bought everything" captain measured 2.080 instead of 2.912, skills and
Science only. The API is `equip`.

That is the sixth time this run a probe has invented an API or a carrier —
after `Game.load`, `PLAYER_SPECIES`, `eng.allShips`, `Mission.over`, and the
Tellarite who never had `fieldRepair`. This one would have **understated the
very defect the file was written to report**, which is the first time the error
ran in that direction. The rule stands and is now cheap to state: *an
optional-chained call that returns undefined is not a measurement.*

### Cleared as negatives

Two leads checked and found clean, recorded so they are not re-hunted: all 25
reputation perks are read (`flag_authority` at `command.js:77`; the escort and
passage perks through the `ESCORTS` and `PASSAGE_PERKS` tables), and no `mods:`
block anywhere declares a key the ship does not have — 18 declared, 18 carried,
no orphans. The note at `state.js:417` saying "exactly ONE was ever read"
describes the state that was fixed, not the present one.


## 49. Five audits and one line

What a lower-yield pass is supposed to look like: mostly clean, with the
negatives written down as tests so nobody hunts them again.

| audited | result |
| --- | --- |
| ship modifiers | `stealthDetect` written by five, read by none — §48 |
| the Multispectral Sensor Array | `special: 'scan'` reached nothing — §48 |
| reputation perks | **all 25 read** |
| station panels | **all 36 resolve** to a console or a report |
| mastery starship traits | applied in `shipMods`, choosable from both the screen and a spoken order |
| order actions | **all 69** the parser can build have a handler |
| duty details | the picker and the payout disagreed — one line |

### The one line, described as small

`teamFitness` decides how a detail turns out and weighs a person as
`(expertise + discipline) / 2`. The screen's own picker sorted by `expertise`
alone. Measured over six hundred assignments across sixty rosters, the
auto-picked team was not the best available **31 times — 5.2%** — losing a mean
of 2.97 fitness and at worst 10.50, on a scale where a matched speciality is
worth 40.

That is close to noise, and it is fixed anyway because it is the same shape as
§43's two doors and §42's two berth checks: **the game had two answers to one
question, and graded the captain against the other one.** `personFitness` is now
the shared term and `bestTeamFor` the single picker. 31 of 600 became 0 of 600,
against an exhaustive search of every combination the roster allows.

### Two probes that would have libelled the code

Both in the same pass, both reporting working code as broken.

The station audit read `REPORTING_STATIONS` — which is an **array of ids** — with
`Object.keys`, getting `0,1,2,3`. Corrected, it still failed: the "no panel"
branch ran *before* the report check, and the four reporting stations carry no
`panel` on purpose. Two drafts, same four false positives.

The order audit imported `ORDERS` from `ui/orders.js`. It is declared there at
line 105 and **is not exported**. The import produced `undefined`, `?? []`
swallowed it, and the probe printed *"order rules: 0 … actions with no case: 0"*
— a clean bill of health from a scan of nothing. It was caught only because
`0` rules was obviously wrong; had the number been plausible it would have been
published.

Rewritten through `parseOrder`, which *is* exported, on every phrase the game's
own help text lists: **861 phrases, 69 distinct actions, all 69 handled.**

That is the seventh invented or unavailable binding this run, after `Game.load`,
`PLAYER_SPECIES`, `eng.allShips`, `Mission.over`, the Tellarite with no
`fieldRepair`, and `loadout.fit`. The rule has earned a name:

> **A probe that reports a clean result without demonstrating it saw a positive
> case has reported nothing.**

Every audit in `tests/audit.test.js` therefore asserts its own denominator
first — `phrases.length > 200`, `actions.size > 40`, `evaluated > 300`,
`granted.size >= 20`, `n >= 30`. A future edit that quietly empties one of them
fails on the count before it can pass on the emptiness.


## Attribution

Star Trek and all associated marks are the property of Paramount. This dossier
records publicly documented facts and measurements, restated in my own words,
with links to the sources consulted. No text, artwork, audio or other creative
material from any source listed here is reproduced in this repository.
