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


## 50. Five fields on the ship classes, and only two should be wired

The §48 sweep pointed at the world data, denominator asserted first:

| | records | fields | orphans |
| --- | --- | --- | --- |
| `SYSTEMS` | 43 | 16 | **0** |
| `SHIP_CLASSES` | 31 | 29 | **5** |

The five appear nowhere else in `src/` at all: `boffSeats` (13 classes),
`auxBonus` (3), `saucerSeparation` (1), `ablative` (1), `refitOf` (1).

**Two are wired. Three are deliberately left**, and the reasons are the point —
a sweep whose only output is "wire everything you find" will eventually break
something.

### auxBonus

Three hulls declare it — 25, 35, 30 — and all three are science ships. An
Oberth ran her sensors, her damage control and her fire suppression off exactly
the auxiliary a freighter had.

It goes into `PowerGrid.factor`, **not** into `cap`: a bigger cap is power the
captain could put into the weapons, which is not what a science package is.
Auxiliary effectiveness at the same setting, before and after:

    miranda   auxBonus  0    0.940  ->  0.940
    oberth    auxBonus 25    0.940  ->  1.230
    nebula    auxBonus 35    0.940  ->  1.350
    intrepid  auxBonus 30    0.940  ->  1.300

### ablative

One hull. Taken straight off the class the way `cls.adapts` is, because it is a
property of the plating rather than a modifier anybody fitted — read through
`mods` it would be erased every time `applyAllMods` reset the stack, which
happens on a refit, a promotion or a console change. A Defiant now takes **880**
of a 1,000-point hit where an Intrepid takes 1,000, and the 0.85 total-resistance
ceiling still holds.

### boffSeats — measured, and left

This looked like the richest of the five: a bridge-officer seat layout on 13
hulls that nothing read. Then the naive wiring was measured:

    galaxy   seats {command:4, engineering:4, science:4, tactical:3}
             would block 8: medical:casualty_teams(r1), medical:stimulants(r2),
                            medical:back_to_duty(r2), medical:surgical_bay(r3)...
    miranda  would block 15: ... command:evasive_maneuvers(r1) ...

The seat lists name **three or four** departments. This game's bridge has
**six**. A Galaxy with 1,014 crew and a full sickbay would lose every medical
ability; a Miranda would lose `evasive_maneuvers`, which is rank one. The data
is an STO tactical/engineering/science/universal station layout and does not map
onto a six-department bridge, and inventing a mapping is the guessing §40
forbids.

### refitOf — wired, and the wiring was wrong

This one is worth recording in full because the mistake was mine and the game
caught it.

It was wired as half the parent hull's mastery, on the argument that a refit is
the same ship in the ways that matter to the people who fly her. Two things
disagreed. `tests/wiring.test.js` asserts that taking a new command starts at
tier 0 with the shakedown penalty applied, under the heading *"no shakedown on a
hull nobody has flown"* — a deliberate design decision, already made. And the
promotion from a Constitution offers **exactly the Constitution Refit**, so the
two collided head-on rather than at some edge.

The fiction agrees with the test: the one famous refit in the franchise is the
case where a veteran crew had to learn their own ship again from the beginning.
The 50% was a guess dressed as a reading. Reverted, and the reason left in
`mastery.js` where the field is, so the next sweep finds the argument instead of
the gap.

### Static imports fail loudly; dynamic ones fail silently

The eighth invented binding this run was `SYSTEMS_UNUSED`, imported into the new
test file and never used. It threw at module load, named itself, and cost
nothing.

That is the contrast worth keeping. §49's `ORDERS` was the *same* mistake — a
binding the module does not export — and it produced `undefined`, was swallowed
by `?? []`, and printed a clean bill of health from a scan of nothing. The
difference is that probes use `await import()` and destructure a namespace
object, which yields `undefined`, while test files use static
`import { X } from ...`, which is a link-time error.

**The probes have been the things going wrong all run, and this is why.** Where
a scratch probe must destructure a dynamic import, assert the binding is not
`undefined` before using it.


## 51. Three sounds nobody could hear, and a guard that agreed with itself

`src/audio/sfx.js` synthesises **38 cues** — the figure README publishes and
`tests/docs.test.js` scrapes. Everything the game makes noise with is built from
oscillators and noise at load time; there is not an audio file in the
repository, and there cannot be, because CI fails on asset files.

Counted through `.play(` in the UI sources, three of the 38 were reached by
nothing:

| cue | what it is for | what actually played |
| --- | --- | --- |
| `cloak` | the ship going quiet | `power_reroute` |
| `decloak` | the ship coming back | nothing |
| `tractor_beam` | a beam holding something | nothing |

The `cloak` line is the one that matters. A cloaking device costs **130 Tokens
of Regard** on the Romulan reputation track — the most expensive thing on it —
and the order that fires it played the generic power hum, the same three notes
a captain hears every time they shift power to the shields. The single
most-earned item in the game sounded like moving a slider.

Two corrections to the count before it was believed, both in the direction of
accusing working code:

- `panel_chirp` looked orphaned and is played at `engine.js:346`. The first
  sweep read only `src/ui/`.
- `phaser_heavy` and `ui_back` looked orphaned because the matcher wanted
  `.play('name')` and both are played through a ternary —
  `audio.play(heavy ? 'phaser_heavy' : 'phaser')`.

### The guard that was already there

`tests/wiring.test.js` has asserted "every sound cue is reachable" for a long
time, with a `RESERVED` map for cues held for a mechanic that does not exist
yet. It passed on `cloak` and `decloak` throughout. Its matcher was
`['"\`]name['"\`]` — *any quoted occurrence* anywhere in the UI sources — and
`src/ui/tactical.js:365-366` reads:

```js
      case 'cloak':
      case 'decloak': {
```

Two `switch` labels in the order dispatcher. **Both cues passed the guard for
four hundred lines of the wrong reason.** A test that asks "does this string
appear in these files" is not asking the question its name claims.

The matcher now harvests only the argument list of a `.play(` call, so a
ternary is seen and a `case` label is not:

```js
for (const m of UI_SRC.matchAll(/\.play\(([^;]{0,160})/g))
  for (const lit of m[1].matchAll(/['"`]([a-z_]+)['"`]/g)) out.add(lit[1]);
```

and both directions of the guard assert `played.size > 30` first, because a
matcher that harvests nothing reports every cue as unreachable and a matcher
that harvests everything reports none — §49's denominator rule, applied to the
harness rather than the code.

`tractor_beam`'s reservation had gone **stale rather than wrong**: it was
reserved with the reason "there is no tractor beam mechanic", which was true
when it was written and stopped being true when core recovery shipped — a
mechanic whose own log line is *"tractor beam holds"*. The companion test,
"nothing is reserved that is actually reachable", is what caught it. A
reservation is a dated claim about the rest of the codebase and needs the guard
pointing back at it.

### What is wired

`Ship.cloak()` and `decloak()` now emit `ship:cloak` / `ship:decloak`, and
`main.js` plays the cue off the event with `{ throttle: 200 }`. Off the event
rather than in the order handler, which is the part worth recording: **the AI
cloaks constantly** — Birds of Prey and warbirds break off, vanish, and come
back on a bearing — and none of it made a sound before. Wiring the order would
have fixed the captain's own cloak and left the tactically important half
silent. `tractor_beam` plays at `salvage` and `recover_core`, the two places the
code's own text calls a tractor beam.

The shape is §45's and §48's again, in the one department that had a guard
written for it: **something declared, and nothing reading it.** The lesson here
is narrower and worse — the guard existed, was specific, ran on every commit,
and was satisfied by a substring.


## 52. Every ship in the game wore a Constitution's deck plan

The interior is one plan: seventeen rooms across eight decks numbered 1 to 19,
built to the Constitution described in §3 and §11. It did not vary by class, and
nothing read the published deck count — `DIMENSIONS.decks`, thirty-one records
with a source in §13, **written and read by nothing**, the same shape as §45's
flags and §48's `stealthDetect`.

So the deck number a captain read was the Constitution's, whatever they were
flying:

| hull | decks | rooms below its keel |
| --- | --- | --- |
| Oberth | 8 | engineering (deck 11), hangar (deck 19) |
| Defiant | 4 | eleven |
| runabout | 1 | fifteen, including a hangar deck and a brig |

The Oberth is not a corner case. It is the **bottom rung of `COMMAND_LADDER`** —
the ship a career starts on — so the ordinary opening hours of the game had a
captain walking to "Deck 11 — Engineering" on an eight-deck ship. The runabout
is worse: `commandableAt` puts it on sale at **tier one**, so a captain can walk
into any of the six shipyards on their first day, take a twenty-three-metre ship
with a crew of four, and ride a turbolift to deck nineteen.

### Renumbering, not removal

A Defiant has an engine room, a transporter and an armoury. It does not have
them on decks 11, 7 and 19. **What was wrong was the number**, and the number is
the part the captain reads.

Which facilities a small hull carries *at all* is a different question with a
much wider blast radius — episode `where` gates, `occupancy.js`'s rules, the
station panels, lift connectivity — and §50's rule applies: a sweep whose only
output is "wire everything you find" is a sweep that will eventually break
something. Naive gating would have left a Defiant captain with no transporter
room and no engineering, which are load-bearing for beam-down and for repair.
Stated, and not taken.

`deckPlanFor(hullDecks)` compresses the plan, preserving what has to hold:

- the bridge is deck 1 on every ship;
- rooms sharing a deck on a Constitution share one on every hull (deck 7 is
  transporters, armoury, brig and cargo — one space on a small ship, but never
  scattered);
- the order down the ship never changes;
- **a hull with room for the plan as written keeps it unaltered**, so a
  Constitution, an Excelsior and a Galaxy do not move and the numbers a player
  already knows stay put.

The first draft spread the eight levels by **index**, which put a Miranda's
engineering, a Constellation's and an Intrepid's all on deck 7 — three hulls of
twelve, fourteen and fifteen decks with an identical plan, which is the exact
flatness the change exists to remove. Scaling by **depth** against the plan's own
range fixes it: deck 11 of 19 is two thirds of the way down whatever the hull
is, so the hangar lands on the keel and the bridge stays on top.

### The second guard satisfied by a `case` label

`lift_control` is the only station in the turbolift and the reason the
compartment has a console. Its case in `openConsole` sat immediately above
`default:` and shared its branch:

```js
      case 'turbolift':
      default:
        body.push(el('p', { class: 'muted', text: 'Working, Captain.' }));
```

`tests/audit.test.js` asserts that every station aboard "opens a console or
answers with a report", and it passed this one — because that guard harvests
`case '<id>':` labels out of the switch, and a case label is not a panel.

**That is the same failure as §51's**, found one PR later in a different guard:
the sound-cue check was satisfied by `case 'cloak':` in the order dispatcher.
Two independent guards, both written specifically to catch dead ends, both
matching the *shape of the source* rather than what it does. Where a check
harvests identifiers out of source text, it has to harvest them from the
construct that does the work — a `.play(` argument list, a case body — never
from the label.

### A correction to §50

§50 recorded five orphan fields on the ship classes and said all five "appear
nowhere else in `src/` at all". **That is wrong for `boffSeats`**, which is read
at `ships.data.js:499`:

```js
  return SHIP_LIST.filter((s) => s.faction === 'federation' && s.boffSeats && s.tier <= tier);
```

`commandableAt` uses it as a truthiness flag meaning "a hull the player may
command" — which is why thirteen classes carry it and eighteen do not, and why
the runabout is on sale at tier one. It was missed because it lives in the file
that *declares* the field and the sweep looked everywhere else. The §50 decision
still stands: reading the seat *contents* would leave a Galaxy unable to use any
medical ability, and that test remains. But the field is load-bearing, and
deleting it as an orphan would have emptied every shipyard in the game.

Two sweeps, two misses, both mine, both in the same direction: **a search that
excludes the declaring file will call a field unread when its only reader is the
line below it.**


## 53. The sweep for guards that agree with themselves

§51 and §52 each found a check that passed for the wrong reason, and they were
the same failure: **a guard satisfied by the shape of the source rather than by
what it does.** The sound-cue check matched any quoted occurrence in the UI
sources and was contented by `case 'cloak':`; the station-panel check harvested
`case '<id>':` labels and was contented by `case 'turbolift':` sharing the
`default` branch. Two independent guards, both written specifically to catch
dead ends. That is a pattern, not a coincidence, so it got a sweep of its own.

This one is mostly negatives, which is what a low-yield pass is supposed to look
like.

| swept | result |
| --- | --- |
| case labels sharing `default:` | 76 bodyless labels, 4 share `default`, **all 4 legitimate** |
| the reputation-perk guard | **loose; its answer held**; tightened |
| encounter kinds | 10 kinds, 1,309 choices resolved, **0 failures** |
| `ASSIGNMENTS` fields | 11 fields, **one unread** — found |
| `absenceReport` options | 6 of 6 supplied by the caller |

### The four that share `default:` are all correct

`case 'withdraw': default:` — withdrawing is what happens when nothing else
does. `case 'bridge': default:` — the bridge is the default screen. `case
'identify': default:` — identifying yourself is the neutral hail. `case
'anomaly': default:` — `buildAnomaly` is the fallback build. In each the
labelled value genuinely *is* the default behaviour, which is the difference
between this idiom and §52's turbolift, where it was not. The check is now
standing, with the four reasons recorded and a second test that fails if one of
the four stops being true — the `tractor_beam` lesson, that a recorded reason is
a dated claim about the rest of the codebase.

### A guard that was loose and right

`tests/audit.test.js` counted a perk as read if its name appeared as a word
anywhere in seven files — `\b<perk>\b` — **including inside a comment**. That
guard is what "all 25 reputation perks read" in §49 rests on.

Re-measured with comments stripped, the declaring file excluded, and only
constructs that do work counted, the **answer held**: 25 of 25 genuinely read,
none passing on a comment, none missing. Eighteen through `perk('id')` calls,
two through `perk?.('id')` — optional-chained, which a first strict pass missed,
the same blind spot as the ternary in §51 — and five through `Game.ESCORTS` and
`Game.PASSAGE_PERKS`, both confirmed consumed so a dead table cannot launder a
perk into looking alive.

Worth stating plainly: **the finding was right and the guard was still wrong.** A
loose check that happens to agree with reality is not a check; it is a coin that
has been landing the same way. The control now demonstrates the difference —
breaking one `perk()` call while leaving the name present in a comment at the
same spot fails the new guard and would have passed the old one.

### One thing written and never read

Every one of the ten duty assignments carries a `text` — the line saying what
the job is. *"Plating, in vacuum, by hand."* *"Take the intermix down and rebuild
it while nobody is shooting."* *"Somebody at the table when you are not."* The
duty screen showed the name, the hours and the wanted speciality, and never the
description.

It hid better than the others because `duty.js` also emits `text:` on the
**result** of a completed detail, so the name is used twice for two unrelated
things and any loose search finds the other one. My own first field sweep
cleared it for exactly that reason.

The fix was already sitting in the button helper. `button(label, onClick, {say,
sub})` has `say` for the order phrase — the repo's rule that every button prints
the words that do the same thing — and this one was quoting the phrase by hand
into `sub`, which left nowhere for the description. Moving the phrase to the
element built for it puts the line back and makes this button behave like every
other one.

### And a guard of mine that failed for the wrong reason, immediately

The new test sliced a fixed 900 characters after the loop header to look for
`a.text`. Adding the explanatory comment above that line pushed it past the
window, and the guard failed — for a reason with nothing to do with the code it
guards. It slices to the end of the loop now. Written down because it is the
same family as everything else in §51–§53: **a check anchored to a position in a
file rather than to a construct is measuring the file, not the code.**


## 54. The only defence against an ambush was a species

An earlier pass found `surprise: true` set on every ambush and read by nothing,
and gave it teeth: being jumped now costs a free volley, every gun a cycle
behind. Two species sell a defence — the Caitian's Predator's Instinct cancels
it, the Saurian's Wide Spectrum Vision halves it.

And that was the whole of it. **Nothing a captain DID mattered.** Four ranks of
Sensor Analysis and a fitted Multispectral Sensor Array — sold in those words as
*"cloak detection"* and *"see cloaked ships sooner"* — bought exactly nothing in
the one situation that is, definitionally, ships which were hiding. Ten of the
twelve species had no answer at all.

Alert level cannot be the answer, and this is worth writing down because it
looks like the obvious one: `beginEncounter` sets red alert on **every** hostile
encounter, two lines before anything else happens, so the alert is always red by
the time the captain chooses. There is no posture to reward.

### What was added

A detection roll against `stealthDetect` when a `surprise` encounter begins, on
a **derived** stream keyed by seed, system and visit — not `this.rng`, for the
reason `encounterStream` records: drawing from the main stream shifts every
seeded outcome downstream of it, and the balance suites depend on those. The
full suite passed unchanged afterwards, which is the evidence that it did.

| | `stealthDetect` | ambushes seen |
| --- | --- | --- |
| bought nothing | 1.150 | **4%** |
| four ranks and the array | 2.912 | **66%** |

A detected ambush costs no free volley, and offers a fourth choice — *"Take them
first"* — which turns the volley round, symmetrical with the Klingon
`first_strike` perk. Every hostile encounter had offered the same three buttons
and returned early, so an ambush read exactly like an unfriendly patrol; this is
the first thing that makes one read differently.

Measured over 200 seeds, ambushed by a D7 and a Bird of Prey, with detection
**forced** so the only thing varying is the mechanic:

| | mean hull | outcome | lost |
| --- | --- | --- | --- |
| blind, surprise stands | 63.0% | 173 routed / 26 won | 1 |
| seen it, engage | 65.8% | 175 / 25 | 0 |
| seen it, spring it | 80.8% | 181 / 19 | 0 |

The fight is still won either way. **What being ready buys is the damage** — and
an ambush still costs real hull even when you spring it, so it remains a thing
worth avoiding rather than a thing worth farming.

### Two errors, both caught by things already written down

**`game.firstStrike` is not what its name says.** The obvious way to give the
player the free volley is `this.firstStrike = true`, and a comment two hundred
lines below says exactly why not: *"NOT `game.firstStrike`, which is a different
thing wearing the same name — that flag means the captain shot at somebody
peaceful and costs 25% off every diplomacy roll."* Setting it would have
**penalised** a captain for springing an ambush they were clever enough to see.
§50's rule, paying off again: check whether the repo has already answered the
question.

**The phrase on the button did not parse.** `say: 'take them first'` resolved to
`mission_choice`, so the words printed on the button routed to a different
handler entirely — which is the precise failure the `encounter_choice` lexicon
entry was written to fix, arriving again with a new choice. Added to the
vocabulary; `fire first` and `hit them first` deliberately **not**, because the
first already parses as `fire` and taking it would break a combat order to serve
one encounter choice. A `say` nobody can parse is a lie printed in quotation
marks, and there is now a test that reads the phrase off the choice and puts it
through the parser.

### A measurement that was wrong three times first

Worth recording, because every version was plausible:

1. **Two different captains.** Comparing an invested captain against an
   uninvested one reported the sensor package making a captain *worse* in a
   fight — true, and nothing to do with ambushes: the invested one spent twenty
   points on science instead of gunnery. Fixed by forcing `detected` on **one**
   captain.
2. **Counting the wrong thing.** Win rates came out at 4–6% for a Constitution
   against a single D7, which the same fight wins 60 times in 60 elsewhere.
   Without `relentless`, hostiles break off and the outcome is `routed`, not
   `victory` — the harness was counting a fraction of the wins as all of them.
3. **A fight too lopsided to read.** Even corrected, win/loss barely moved,
   because the outcome is nearly always `routed`. The metric that carries the
   signal is **surviving hull**, and it is the honest one anyway: what a free
   volley buys is not whether you win but what it costs you.

The through-line with §51–§53 is the same: **assert what the measurement can
see before believing what it says.**


## 55. Guns you can lose, and arcs you can see

`subsystems.weapons` has always been **one number for the whole battery**. It
scales every mount's damage and recharge together and gates firing at 0.05, so a
called shot at the weapons took the guns down as a group and there was no such
thing as losing your forward tubes.

Meanwhile `weapon.enabled` was written `true` at construction and read in exactly
two places — `combat.js` before firing, `ai.js` when deciding whether a hull is
still a threat — and **nothing anywhere ever set it `false`**. A constant wearing
the shape of per-mount state, for the whole life of the file. §45's shape again,
in the middle of the combat loop.

And the firing arcs, which decide every shot in the game and have been simulated
as real three-dimensional cones since the third axis went in, **had never once
been drawn**. The single most important tactical fact in the simulation was
invisible, which is why "come about" was a mood rather than an instruction.

These two are worth far more together than apart: an arc that never changes state
is a decorative diagram, and a knocked-out gun the player cannot see is silent
difficulty.

### The property that made it safe to do first

**It adds no RNG draw.** The hook sits inside the `if (hullDamage > 0)` block
that already exists, in both branches that already compute their fraction, and
which mount takes the hit is a *pure function of the bearing* — not a roll.

Proved rather than asserted: seventy-five fights across three matchups were
fingerprinted by outcome, tick count, hull and all six shield facings to six
decimal places, against the **pre-change tree** recovered with `git stash`, and
came back **identical**. Against a determinism-critical codebase where the
balance suites depend on seeded outcomes, that is the difference between a change
that can be reasoned about and one that cannot.

### Three measurements that each corrected the one before

**1. The first version was inert.** Reusing the subsystem's own fractions
unchanged — on the argument that it added no tuning knob — produced a mechanic
that never fired: over 120 fights the lowest integrity any mount reached anywhere
was **0.777**, against a threshold of 0.2, and not one bank went out on either
side. The arithmetic is why: the array accumulates every hit that rolls it, while
a given mount accumulates only when the roll picks the weapons *and* that mount
is bearing. Sharing the array's number spreads it thinner the more guns a hull
has, which is backwards. Concentration is the whole idea, and it needed a named
constant with a measured table.

Note what the determinism result meant at that moment: byte-identical fights
proved only that **nothing had changed at all**. A clean result is not evidence
until you have shown the instrument can see a positive case.

**2. The first *rule* looked broken and wasn't.** Narrowest-arc-wins meant a
90° torpedo tube beat a 250° phaser bank wherever both bore, and the histogram
said 24 of 38 hull-and-mount pairs never went out. That reading was wrong in this
repo's most familiar way: **it counted mounts that were never shot at alongside
mounts that were shot at and held.** Separated:

| rule | went out | hit but held | never touched |
| --- | --- | --- | --- |
| narrowest first | 14 | 7 | 17 |
| soundest first | 16 | 8 | 14 |

So the honest gap was three more mounts taking damage, not ten immune ones. The
rule changed anyway — soundest-first spreads a battering across the guns sharing
a facing, which is what being shot in the nose does — but on its own merits, not
because the first was broken. **The denominator lesson, applied to my own
conclusion rather than to the code's.**

**3. The tests passed with the mechanic switched off.** Nineteen of them, all
green against a control with the concentration at zero — because every one
reached for `damageMount` directly and so proved the machinery worked while
proving nothing about whether it was *connected*. Two more were added that play
real fights; those fail against the control, for their own reasons.

### What it costs and what it buys

Balance, 60 seeds per matchup, mechanic on against off: **win rates identical
across all six matchups, mean surviving hull within one point, median fight
length within one second.** Exposure is real — hostiles lose a bank in 13 to 15
fights of 60 in the winnable matchups.

What changed is that a tactical choice now pays. Calling your shots at the guns,
measured over 60 seeds:

| | surviving hull | median fight |
| --- | --- | --- |
| aim anywhere, vs Galor | 71% | 66 s |
| **call the guns**, vs Galor | **79%** | 103 s |
| aim anywhere, vs D7 | 77% | 63 s |
| **call the guns**, vs D7 | **84%** | 97 s |

Disarm them and take less damage, but take much longer doing it. That trade did
not exist before, because there was nothing per-mount to disarm.

### The last gun, and a bug my own invariant caught

Six hulls carry exactly one mount — `oberth`, `scoutship`, `marauder`,
`orion_raider`, `tholian_web_spinner` and `bioship`, the last a tier-nine Borg
boss. **A hull's last enabled mount cannot be knocked out**: per-mount knockout
is about *which* guns, and a ship with one gun has no "which"; total disarmament
is what the array-wide gate is already for.

That guard is a **state** rule, not an event one, and the difference was a real
bug found within a minute of the invariant being written: the guard spared a
wrecked tube because it was the only gun standing, a sibling then repaired past
the restore threshold so it was no longer the last, and nothing re-examined it.
The checker found the Enterprise firing a torpedo tube at **0.029 integrity**.
It is settled after damage *and* after repair now.

### Drawing it took four attempts, and three were invisible

Worth recording because each failed differently and only the screenshot showed
it:

1. **A filled pie slice at low alpha.** A Constitution's 250° and 200° banks
   overlapped into a faint disc round the hull — it read as fog, not as arcs.
2. **A band at the range limit.** 88–100% of 620 units is far outside the frame
   at any zoom a captain fights at. Nothing on screen.
3. **Correct geometry, single winding.** `gl.js` enables `CULL_FACE`, and a flat
   wedge lying in the ship's plane has exactly one visible side — so the wrong
   winding drew nothing from any camera position. Both faces are emitted now,
   which is also right because a captain can orbit under their own ship.
4. **Only the arcs that constrain.** A 250° bank overlapping a 200° one is a
   ring, and a ring is not information. Mounts of 180° or less — the torpedo
   tube, a Defiant's cannons — are the ones that make "come about" specific.

The general lesson, and it is not a rendering one: **a visual feature is not
done when the code runs.** Three of those four passed every test and all 356
browser checks while displaying nothing whatsoever. The only instrument that
could tell was looking at the picture.

Two orphans are consumed on the way: `FACING_LABEL`, whose declaration in
`ship.js` was the only occurrence of its own name in `src/` or `tests/`, gets its
first reader in the line that names a lost bank by the arc it covered; and
`weapon.id`, whose only reader was one assertion in `sim.test.js`, becomes how
saved mount damage is reconciled against a hull — **by id, never by index**, so a
save that predates a refit cannot resurrect a mount the ship no longer carries.


## 56. A Bird-of-Prey and a Negh'Var flew exactly the same way

The AI takes its doctrine from `FACTIONS[ship.faction].doctrine` and nothing
else. Every threshold in `ai.js` — when to break off, what range to hold, how
hard to commit to an elevation — was therefore identical for both, because both
are Klingon:

| | turn | mass | hull + shields |
| --- | --- | --- | --- |
| Bird-of-Prey | 18 | 0.55 | 4,600 |
| Negh'Var | 4.5 | 2.4 | 19,400 |

The same held for a Romulan scoutship against a warbird, and a runabout against
a Galaxy. Nine factions, eight doctrines, and inside each one every hull flown
the same.

### Derived, not declared — and the `role` trap

The obvious field to reach for is `cls.role`, and it is a trap this dossier
should record because a future sweep will find it and see this repo's signature
defect: a field on all 31 classes, read only by two display pills.

It is **23 distinct free-text values over 31 hulls, 17 of them singletons** —
"heavy explorer", "attack cruiser", "marauder", "cube", "runabout" — and it
predicts nothing mechanical. Three hulls are `explorer`, spanning tier 3 to tier
6 and two to four mounts. There is no partition of it that carves the fleet at a
joint the numbers recognise. And everything it would grant is already hand-tuned
per hull: the Defiant already turns at 15.0 and carries ablative plating, the
Oberth already has `auxBonus: 25`. Wiring it would either double-count or
require regenerating all 31 records from archetype multipliers — moving every
number the balance suite measures, at once.

**`role` is a caption, correctly used as a caption.** The same decision as
`boffSeats` in §50, for the same reason, and it is now recorded in
`tests/classfields.test.js` so the next sweep finds the reason rather than the
field.

`archetypeOf(cls)` computes instead, from two axes the data actually has — how
fast a hull comes about for its size, and how much punishment it holds:

| | count | examples |
| --- | --- | --- |
| skirmisher | 8 | Bird-of-Prey, scoutship, Defiant, Oberth |
| line | 12 | Constitution, D7, Galor, Miranda |
| capital | 11 | Negh'Var, warbird, Galaxy, Borg cube |

**`line` is the identity case**, and that is the design, not an accident: twelve
classes resolve to it and keep exactly the behaviour they have today. A taxonomy
that changed every ship at once would be a rebalance of the whole game wearing
the clothes of a feature.

### What it changes, measured

Break-off hull fraction, forty non-relentless fights per hull:

| hull | archetype | before | after | |
| --- | --- | --- | --- | --- |
| Bird-of-Prey | skirmisher | 8% | **14%** | runs sooner |
| D7 | line | 8% | 8% | untouched |
| Galor | line | 15% | 15% | untouched |
| Negh'Var | capital | 9% | **6%** | stands longer |
| warbird | capital | 17% | **8%** | stands much longer |
| Jem'Hadar attack | *fanatic* | never | never | preserved |

The nerve figure is **multiplied, not replaced**, which is what keeps `fanatic`
and `assimilate` at zero: a Borg cube and a Jem'Hadar attack ship do not acquire
a survival instinct by being large or small. Zero times anything is zero, and
that is the whole meaning of those two doctrines.

The full balance suite passes unchanged.

### Two levers built and removed, both for the same reason

Neither survived measurement, and both failed in the same direction — they made
the *capital* ships worse, which is the opposite of the point.

**Elevation commitment.** The reasoning was that a hull taking twenty seconds to
come about should hedge on a dorsal or ventral attack, because being wrong costs
it more. But commitment in this AI is *how decisively a ship goes for the weaker
facing*, so lowering it models indecision rather than inertia. Removed.

**Capitals closing the range.** ×0.85 on preferred range, on the reasoning that
a battleship closes. Measured: it moved ninety fights against warbirds, a
Vor'cha and a Negh'Var from 66 player deaths to 60, and mean surviving hull from
12.7% to 15.0% — **the capitals got worse.** Closing from 620 to 527 puts them
inside the band the player's auto-fire is best in. Removed; capitals hold their
range at 1.0 and only the skirmisher standoff (×1.18) remains.

Isolating that took switching each lever off separately: nerve-only reproduced
the baseline *exactly* (66 deaths, 12.7%), because `relentless: true` disables
fleeing and every balance harness in the suite sets it. **A measurement taken
inside `relentless` cannot see a break-off change at all** — which is why the
figures above are from non-relentless fights, and why the first three probes
said nothing was happening.

### And a note on the two abandoned mechanics

This is the second of the four planned combat PRs to survive; PR 2, per-shot
weapon power drain, was built, measured and reverted — see the plan file. Both
of the removed levers here and the whole of PR 2 failed the same test: **does it
create a decision, and does it cost the right side?** A symmetric reduction in
output slows a fight, and slowing a fight favours whoever was going to win it.
That is worth stating as a general property of this simulation rather than
rediscovering it a third time.


## 57. A guard defeated by the comment explaining the thing it guards

`tests/wiring.test.js` carries a check called *"every ability special has
something that reads it"*. Its own comment says it is **"the guard that would
have caught Fire at Will years earlier"** — the rank-one tactical order that
declared `special: 'multitarget'`, had no implementation anywhere, and so
charged the captain its 20% damage penalty for a benefit that never arrived.

The guard has been passing on `multitarget` ever since it was written.

It works by asking whether the string appears anywhere in `src/` outside the
file that declares it. And it does appear — at `combat.js:868`, inside the
JSDoc paragraph **explaining that `multitarget` is inert**:

```js
   * spreading fire, and `special: 'multitarget'`, which nothing anywhere
   * implemented. So the cost landed and the benefit did not: measured over 40
```

So the check written specifically to catch a dead tag was satisfied by the
prose documenting that the tag was dead. Comments are stripped before the
search now, and with that one change the guard immediately named `multitarget`
— which was then removed, because what Fire at Will actually does is point
defence and `combat.js` reaches for that by the **buff id**, not by the tag.

This is the third time this pattern has appeared — §51's sound cues matched a
`case` label, §52's station panels matched another, §53's reputation perks
matched a word in prose — and the first where **the comment doing the
satisfying was written by the same hand as the guard**. The general form is
worth stating once more, plainly: *a check that greps for a name will be
satisfied by anything that says the name, including the note recording that the
name means nothing.*

### The other small lies, all verified before fixing

| | |
| --- | --- |
| `auxiliary` | one of seven subsystems, targetable by **neither** button nor voice |
| the buttons | covered **four** of seven; sensors and life support were sayable but not tappable |
| `opts.escapeAt` | named in `Engagement`'s JSDoc; no such option exists |
| the ion pod | runs **14 seconds**; two separate lines promised "about a minute" |
| auto-fire | `cease_fire` set it false and **nothing** ever set it true again |
| `Engagement.assess()` | documented as the LIVE reading, called by nothing |

`auxiliary` is the one that mattered most in play: it powers damage control,
fire suppression and sensor quality, which makes it the natural called shot
against a burning ship, and it was the single subsystem in the game with no
route to it at all. The button list is built by mapping `SUBSYSTEM_KEYS` over a
label table now, so a subsystem added to the simulation appears on the panel
instead of being quietly absent — and the test that checks those phrases asserts
**seven**, not "at least four", which is the difference between a denominator
and a floor.

Auto-fire is the same shape as the deck numbers in §52: a captain who said
"hold fire" and then "weapons free" got one volley and then silence, with no way
back except finding a toggle. "Open fire" leaves the guns working now, and the
toggle carries a phrase in both directions, which it never had — the one button
on the weapons panel that printed no words at all.

And the live assessment is §45's shape once more. `assess()` exists with a
JSDoc explaining it is the live reading *as against* the opening one, and only
the opening line was ever pushed to the log — once, before a shot was fired. A
fight that stopped being outmatched three ships ago still read as outmatched,
while the number that knew better was computed on request by nobody. It is a
panel now: **THE FIGHT — FAVOURABLE, 2.66:1**.

### On splitting the capstone

This was to have been one PR with objectives — `Engagement.objective`, also
documented and read by nothing, wired to destroy / disable / protect / survive.
Reading the blast radius stopped that: the outcome vocabulary is load-bearing
(`won = victory || routed`, `lost = destroyed` in `state.js`, and three test
files iterate `OUTCOMES`), so a *failed protect* needs a third category and
touches `endCombat`, the ledger, the after-action report and the mission engine.
That is a PR, not a sweep, and bundling it with six one-line fixes would have
made both harder to review and to revert.


## 58. Every battle was won by emptying the board

`Engagement.objective` has been declared since the class was written, named in
the constructor's own JSDoc, and **read by nothing**. So there was no way to
express *"cripple her, do not kill her"* or *"whatever else happens, the
freighter lives"*. The mission book has wanted both for a long time and had to
settle for saying so in prose while the fight underneath resolved the only way
it could.

| | |
| --- | --- |
| `destroy` | the default; nothing changes |
| `disable` | won when every hostile is destroyed **or disarmed** |
| `protect` | an escortee in `allies`; losing it fails the fight |
| `survive` | won by lasting, not by killing |

**Two of the four are only possible because of what landed first.** `disable`
needs per-mount knockout (§55), so that "no working guns" is a state a hostile
can be *put into* short of killing it — before that it was unreachable. And
`protect` needs hull archetypes that differ (§56), so that some hostiles
genuinely go for the escortee rather than every ship in the fleet flying at the
player. Sequencing these three was not bookkeeping; the last one does not exist
without the first two.

### A third kind of ending

`failed` is the first outcome in this game that is neither a win nor a loss.
`state.js` computes `won = victory || routed` and `lost = destroyed`; a captain
who came through the fight and lost the ship they were escorting is **neither**,
and there was previously no way to say it.

Adding it looked expensive and was not, for a reason worth recording: **every
existing consumer tests a specific outcome for equality**, so a new value falls
through all of them and earns exactly what it should — no experience, no
reputation, and not the ship-loss path. And the three test files that iterate
`OUTCOMES` are written *generically* — they end a fight with each value and
assert the invariants hold and `lastCombat.outcome` round-trips — so the new
member flowed through with no per-outcome handling at all. The suite went from
1,680 to 1,686 tests without a line being written for it.

That is what a well-shaped vocabulary buys, and it is the opposite of the
`OUTCOMES` blast radius I had feared when splitting this out of §57. Reading it
before building was right; the conclusion was simply the good one.

### Two things the tests got wrong first, both instructive

**Flipping `enabled` does not disarm a ship.** The first draft disarmed a
hostile with `for (const w of ship.weapons) w.enabled = false` and the fight
refused to end. The cause is the passive repair pass working correctly:
integrity was still 1, so the bank was re-enabled on the very next tick.
`enabled` is *derived* state and `integrity` is the authoritative one — which is
exactly how §55 designed it, demonstrated here by a test that forgot.

**`queueMissionCombat` does not exist.** The real name is
`orderTheStagesFight`, and the optional chain `g.queueMissionCombat?.({...})`
swallowed the mistake in silence. Caught only because the assertion below it
stated its own denominator — *"no fight was queued, so this proves nothing"* —
rather than trusting that the call had done something. Eleventh time this run
that an invented binding has cost a wrong answer, and the first time the
denominator rule caught one on the first attempt.

### What is deliberately not here

`disable` ends the fight when every hostile is disarmed; it does **not** stop
the player continuing to shoot a helpless ship, and there is no penalty for
destroying what you were asked to cripple. That is a real gap and it is left
open on purpose: a penalty needs a mission that asks for one and an author to
decide what it costs, and inventing that in the same PR that builds the
mechanism would be guessing at content in a systems change.


## 59. The captain walked through the crew

The first deliberate play pass through the screenshots the harness takes, read
as a playthrough record rather than as check output. Two things came out of it,
one of which was not what I thought I was looking at.

### What I thought I saw, and why it was wrong

`10-aboard.png` is sickbay, and a medical officer fills the bottom-right of the
frame — torso and the underside of a chin. I read that as the camera clipping
into a solid, wrote a fix in the renderer that skipped any figure within 0.62 m
of the viewpoint, and documented it as "entering sickbay put the viewpoint
INSIDE a medical officer".

Then I measured it, and the officer was **1.10 m away**. A person standing a
metre in front of a first-person camera at eye height fills the bottom of the
frame. That is what a metre looks like. There was nothing wrong with the
picture at all, and the fix was written against a defect that did not exist.

Two habits saved it from shipping. The first is that the fix had not been
proven to fire — re-rendering showed the figure still there, and rather than
raising the number until it disappeared I went to measure why. The second is
that the first measurement was itself broken: the probe called `goToRoom`,
which only sets a walk *order* for the autopilot to work through over the next
several seconds, and then read positions immediately — so it measured distances
from the bridge and reported them as sickbay's. It printed `room bridge` in its
own output, which is the only reason it was caught.

### What was actually there

Walking the ship properly found something else. Every room-to-room route the
ship has — 252 of them — walked with the game's own autopilot, sampling the
distance from the camera to every figure on every tick:

| | before |
| --- | --- |
| routes passing within 0.35 m of a person | **30 of 252** |
| closest pass anywhere on the ship | **0.03 m** |
| share of walking frames inside 0.35 m | **1.4%** |

0.35 m is the figure's own radius — `officerMesh` builds a torso 0.40 m across
with arms out to ±0.315 — so a camera closer than that is inside the person.
0.03 m is not a near miss. The captain walked clean through an ensign in the
recreation corridor, and did it on every route that used that corridor.

### The cause was one number, in the last place I looked

Not the collision code. `resolve()` in `walk.js` runs `confine` then
`avoidProps`, and people are neither walls nor props — but adding them there
would have been fixing the symptom.

The cause is in `occupancy.js`, in the line that decides where people can
stand:

```js
const w = (room.shape?.width ?? 8) / 2 - 0.8;
```

0.8 m is a sensible standoff from a bulkhead in a nine-metre room: it keeps
people looking like they are *in* the room rather than pressed against its
walls. Subtracted flat from the half-extent, it is a catastrophe in a corridor.
The recreation corridor is **2.6 m across**. Half of that is 1.3. Less 0.8
leaves **0.5** — so every person in a 2.6-metre corridor was placed in its
middle metre, in single file down the centreline. Which is the metre the
captain has to walk down, because a corridor's doors are at its two ends.

A margin tuned for a room, applied unchanged to a corridor, put the crew in the
one place the captain cannot avoid.

### Three fixes, and why the other two were refused

**Push people aside as the captain approaches.** Refused. `place()` is called
fresh every frame and is deliberately a pure function of the room and the
ship's state — the deterministic hash at the top of the file exists precisely
so the crowd does not reshuffle thirty times a second. Anything reading the
captain's position would undo that.

**Hide a figure the camera is inside.** Refused, and this was my own first
attempt. It leaves the captain still walking through people; it just stops them
seeing it. In a 2.6-metre corridor a person popping out of the world is not
subtle, and there is nowhere for the eye to miss it.

**Do not put people in the way.** Taken. Three parts:

1. The wall standoff drops from 0.8 to **0.4** — a person's own footprint plus
   air. A nine-metre room moves people from ±3.2 to ±3.6, which nobody will
   ever notice; a corridor gains the width to stand *along* it.
2. A spot is rejected if it lies within **0.62 m** (the captain's radius plus a
   person's) of a **walking lane** — the line from where you stand on arriving
   through one door to the next door you are aiming at. That is the path the
   autopilot actually takes: `stepToward` aims at a door and presses forward
   with no idea what is between.
3. When every spot in a room is somebody's way through, people stand **flat
   against the bulkhead** instead of not existing.

### The lane has to start a metre inside the door

Door-to-door was the obvious segment and it was not enough. `Walker.enter` puts
you a metre inside the door along the line toward the room's centre — arriving
in the doorway would leave you half in the frame — so the walk and the
door-to-door line diverge by about half a metre at that end. Measured: an
ensign 0.84 m off the door-to-door line, and the captain still passed within
**0.28 m** of them. Running each lane from the arrival point to the next door,
over ordered pairs, closed it.

### The third part is the one that had to be measured

Requiring the lane alone emptied the security corridor. It is 2.6 m across with
**four** doors on it — twelve lanes over a width that holds one and a half — so
every spot in it is somebody's way through, and it went from three people at
red alert to one. Silently, because a person who cannot be placed simply is not
there. A corridor that empties the moment it gets interesting is the exact
failure the occupancy module was written to undo, so the rule became a
*preference*, given up at the wall.

And the first bulkhead fallback measured **worse than having no rule at all**.
It reused the existing perimeter walk, which is an ellipse inscribed in the
room — and an ellipse in a 0.9-by-6.1 corridor spends almost all its perimeter
along the long axis, where x is near zero. It put the crew straight back on the
centreline. The fallback had to be the rectangle's side walls, because in a
corridor the wall is the only place that is out of the way.

### The result

| | before | after |
| --- | --- | --- |
| routes passing within 0.35 m | 30 of 252 | **0** |
| closest pass anywhere | 0.03 m | **0.53 m** |
| walking frames inside 0.35 m | 1.4% | **0.0%** |
| people in each room, at each alert | — | **unchanged, every room** |

The last row is the one that matters most: the whole rule is worthless if it
buys clear corridors by quietly having fewer people in them.

The remaining 0.53 m is engineering's machine shop, where an officer stands
half a metre from where you arrive on the deck. That one is not a defect — it
is a person at their post, close enough to speak to and not close enough to be
standing in — and it is used as the **positive control** for the sweep, because
a test that walks the whole ship and finds nobody anywhere would pass the clean
assertion by measuring nothing at all.

### And a guard that a box defeated

The other half of the pass was the figure itself: one box spanned both legs, so
the silhouette had no gap in it. Two leg boxes, a two-part tapered torso and a
neck took it from 60 triangles to 96, against a thousand for a starship hull.

The obvious test — *is there geometry on the centreline below the hip?* —
**passes against the old figure too**. A box has no vertex at its own centre:
the single leg block spanned -0.12 to 0.12 and put vertices only at those two
values, so scanning vertex positions for x near zero finds nothing either way.
The measurement that works is counting *distinct* x values below the hip. One
leg is two. Two legs are four.

Same lesson as §57, arriving from the opposite direction: there, a check was
satisfied by the comment saying the name it grepped for; here, a check was
satisfied by the geometry of the very thing it was meant to catch.



## 60. Ships flew through each other, and the fix for it did not work

Second pass over the harness screenshots. `20-bridge-officers.png` shows a D7
and the Enterprise drawn on top of one another, and the question that started
this was whether that is a close-quarters fight or two models clipping.

### The measurement

Twelve seeded duels per matchup, sampling every combat tick, against the
centre-to-centre distance at which the two drawn hulls meet:

| matchup | hulls meet below | closest pass | ticks overlapping |
| --- | --- | --- | --- |
| constitution v d7 | 74 km | 22 km | **3.0%** |
| defiant v bird_of_prey | 47 km | 6 km | **3.0%** |
| excelsior v neghvar | 164 km | 21 km | **11.0%** |
| galaxy v warbird | 241 km | 51 km | **8.4%** |

And the picture at the bottom of that: staged at 53 km, a Galaxy is drawn
**entirely inside** a D'deridex. The player's own ship is not visible at all,
and the two name labels are written on the same pixel.

### Why it happens, and why the simulation is not at fault

`UNITS_PER_METRE` is 0.286 and positions are in kilometres, so a 289-metre
Constitution is drawn **82.7 units long in a space where the enemy is 600 units
away** — about 260 times oversized against the distances between hulls. That is
deliberate and it is right: at true scale a 289-metre ship 600 km away is a
fraction of a pixel, and a display whose job is telling you what you are looking
at cannot show you nothing. `hullScale`'s own note is about being honest between
hulls; it is silent about hulls against range.

So the first thing to settle was which layer is lying. At 22 km a 289-metre ship
and a 228-metre ship are 22 kilometres apart — nowhere near touching. **The
simulation is correct.** Giving ships physical separation would have changed
every seeded outcome in the game to fix an artifact of the drawing, and it was
refused on that basis alone.

### The fix that was built, measured, and thrown away

A single shrink factor, **common to every hull** and taken from the closest
pair, so relative size — the one thing `hullScale` exists to tell the truth
about — is exactly preserved and only the scale of the whole plot changes. Built
in full: `hullShrink()` in blueprint.js, eased into over frames the way the
camera focus is, applied to the hull, the shield shell, the impact and cloak
effects, the firing-arc rose and the framing camera.

The floor was swept rather than chosen, reading back the enemy hull's **angular**
size — drawn size over camera distance, which is what the player actually sees:

| floor | factor reached | angular size | against 0.267 unshrunk |
| --- | --- | --- | --- |
| 0.30 | 0.301 (clamped) | 0.238 | 89% |
| 0.20 | 0.213 | 0.242 | **91%** |
| 0.15 | 0.214 | 0.232 | 87% |

That looked like a win: the framing camera closes in by the same amount the
hulls shrank, so the ships are the same size on screen as before. **Then I
rendered it and looked**, which is the rule this project has paid for several
times over, and it fails on three counts:

1. **It does not fix the thing.** The sweep was taken at 50 km separation, where
   0.207 is enough. The probe's own worst case drifted to 35 km, which asks for
   0.145 — the floor binds and the hulls still intersect. Going low enough to
   cover the real closest ranges puts a Defiant at four units, a speck.
2. **The camera lurches.** Following the shrink swings the plot from 1,114 units
   to 270 during a single pass. Preserving apparent hull size costs a four-times
   zoom, and everything else in the fight leaves the frame with it.
3. **It wrecks the firing arcs.** The arc rose is sized to the hull, so it shrinks
   too — but the camera came in four times, so relative to the frame the wedges
   grow until they are dark bands across the whole plot. The arcs were measured
   into place two changes ago (§55) specifically to be readable, and this makes
   them unreadable at exactly the range they matter most.

Three independent costs against a cosmetic gain, one of which damages a feature
that was itself measured into place. Reverted.

**Displacement** — drawing the ships further apart than they are, the usual
cartographic answer when map symbols collide — was refused without building.
The plot now draws firing arcs, and a player reading *am I inside their arc* off
a plot whose bearings have been nudged is being lied to about the one thing the
arcs were added to tell them.

### What actually shipped

The worst of the artifact was never the hulls. It was that two contacts project
to nearly the same point and their **names** were written on the same pixel, one
over the other, both illegible — and a label is not a ship. It already sits 32
pixels above the hull, so it is an annotation with an implied leader. Moving it
lies about nothing, touches no geometry, and changes no bearing.

Overlapping labels are now lifted clear, upward, capped at eight steps. The
guard for it carries its own positive control in the same measurement: each
label records the `anchor` it would have been written at, so the test can tell
*"these two do not collide"* from *"these two were never near each other"* —
with the lift switched off, the two anchors are **4.96 pixels apart at the same
x**, and the guard fails.

### The lesson worth keeping

Ask which layer is lying before fixing anything. Three candidate fixes here sat
in three different layers — the simulation, the projection, the annotation — and
only the outermost one could be changed without breaking something that was
already right. The simulation was correct, the exaggeration was a deliberate and
necessary choice, and the only thing genuinely wrong was two pieces of text on
top of each other.

This is the third time in this sequence that measurement killed the main change
and a smaller adjacent one survived it — §55's two removed levers, PR 2's
abandoned weapon drain, and now this. The pattern is not that the ideas were
bad. It is that the cost only becomes visible after it is built, which is an
argument for building it and looking, not for planning harder.



## 61. A game that records, and a game that remembers

The combat plan finished, so the next stretch went to content. The check-in
that carried the leads forward listed three; the first thing done with them was
to check them, and one was already wrong.

### The lead that was stale

*"The seven patrol errands are pure prose over one identical outcome."* False.
`Game.PATROL_WATCH` has a distinct result for every one of the seven plus a
default, and has for some time. Recorded here because the lead had been carried
forward across three check-ins unchallenged, and would have been built on.

### The two that held, and the one underneath them

**23 of 43 systems host no episode** — Vulcan, Andoria, Tellar, Bajor,
Ferenginar, Risa, Betazed, the whole Gamma quadrant, all three DMZ systems.

**`MissionBook.availableAt` implements five gates and three had never been used
by anything:**

| gate | episodes using it |
| --- | --- |
| `minRank` | 12 |
| `requiresFlag` | 5 |
| `blockedByFlag` | **0** |
| `requiresCompleted` | **0** |
| `minStanding` | **0** |

But the number that decided what to build came from a third sweep, over every
episode stage, choice and ending, and then over every other line in `src/`:

| | |
| --- | --- |
| flags **written** by episodes | **63** |
| of those, gated on by an episode or a stage | 13 |
| named anywhere else in `src/` at all | 30 |
| **written and read by nothing** | **33** |

Thirty-three decisions the game asked the captain to make, wrote into the
ledger, and never mentioned again. Four are excusable — `came_clean`,
`credited_the_crew`, `commended_command` and `censured_command` are all set by
`homecoming`, the finale, so there is nothing after them to do the reading. The
other twenty-nine are a game that records rather than a game that remembers.

That is a better thing to fix than an empty map. More episodes in more systems
is more content; content that knows what you did in act one is a different
game.

### What was built

Two episodes, in two of the empty systems, using all three unused gates.

**Clean Hands**, Utopia Planitia, act 5. `requiresCompleted: ['court_martial']`
and `blockedByFlag: 'deflected_blame'`. A fleet yard wants an outside captain
to certify a hull, and asks you because your account at your own board of
inquiry held up. **A captain who put it on somebody else is never asked, and
never finds out they were not asked** — the first content in this game that a
player can *lose* rather than fail.

Requiring the episode and blocking on the flag is deliberate, and is not the
same as requiring the opposite flag: `court_martial` sets `inquiry_resolved` on
one branch and `deflected_blame` on the other, and gating on
`inquiry_resolved` would have been the ordinary shape. Blocking says *you were
there and it matters which way you went*, and it costs the player something
real for having gone the other way.

**The Long Peace**, Vulcan, act 5. `requiresCompleted: ['khitomer_accord']` and
`minStanding: { klingon: 10 }`. Khitomer is itself gated on `qonos_upheld` from
act 4, so the chain is three deep — and the last link is not a flag handed over
but a relationship kept. Ten is `cordial`; the Klingons open at **-10**, so it
is twenty points of work, which the episodes on the way there pay in lots of
twelve to twenty.

Between them the two read five flags that gated nothing before —
`deflected_blame`, `second_stood`, `observed_organia`, and from the SHAKEDOWN,
the very first episode in the game, `core_tuned` and `trials_by_the_book`. Eight
ranks earlier, when nobody knew the captain's name. That is the payoff the
thirty-three were missing: not a bigger number, but somebody bringing up what
you did when it did not seem to matter.

Written-and-gated decisions: **13 → 18**.

### Three things the tests caught in my own work

**I wrote two new inert flags.** `utopia_finding` and `long_peace_signed` were
set by the new endings and read by nothing — the exact defect the file was
written to complain about, committed in the file complaining about it, and
caught only because the test asserts the rule against itself first.
`long_peace_signed` got a real reader in `FACTION_MEMORY.klingon`, so Klingon
hails now cite the accord. `utopia_finding` got no honest reader and was
**deleted**; its consequence is the `commendation` on the service record, which
the Starfleet review actually reads.

**`adjustStanding` is a delta and nobody starts at zero.** The test helper
handed the Klingons 15 and the gate at 10 still refused, because the Klingons
open at -10 and 15 lands on 5. The gate was right; the harness was wrong. Worth
recording because the failure looked exactly like a broken gate.

**Two numbers that are not the same number.** The first draft asserted "19 of
64 recorded decisions gate anything, it was 14 before". Nineteen flags *are*
gated on — but one of them, `inquiry_summoned`, is set by the game rather than
by any episode, so the count of *written* decisions that gate something is 18,
up from 13. Both quantities are real and the draft conflated them, which is the
same error as publishing a table before running the measurement, at one
remove.

### And the check that came first

Before any of it: is the lead true? One of the three was not, and it had
survived three check-ins by being repeated. A lead carried forward is not
evidence; it is a note about something somebody once saw.



## 62. The longest reach in the book, and two more things nobody reads

Second instalment of §61. That one took written-and-gated decisions from 13 to
18; this one goes after the two largest seams left.

| flag | set by | act | read by |
| --- | --- | --- | --- |
| `vega_saved`, `vega_grid_restored` | `vega_raid` | **1** | nothing |
| `borg_warned`, `borg_data`, `borg_hurt` | `the_cube` | **4** | nothing |

`vega_raid` is the **second episode in the game** and has no rank gate at all.
Whether the colonists got medical teams and whether the defence grid came back
up were recorded in the first hour of a five-year commission and never
mentioned again.

### The correction to the last instalment

§61 put both of its episodes in act 5. That was right for what they were and it
left the book bottom-heavy — act 1 had two episodes and act 5 had four. **A
consequence does not have to wait for the end of the commission; it only has to
come after the thing it reads.**

So *The Vega Line* is **act 3**, at Starbase 1, and a captain meets it while the
raid is still recent. Acts now run 2 / 5 / 7 / 5 / 5, and a test asserts the
spread rather than leaving it to taste.

*What the Cube Left* is act 5, at Beta Reticuli — a system whose catalogue entry
is four lines filed by a survey ship that never came back to correct anything,
which is a description that had been sitting there waiting for an episode.

### The chain

The two are linked to each other, which is new: *The Vega Line* writes
`grid_doctrine` — the standing order for colony defence that you either put your
name to or let a committee write clean — and *What the Cube Left* reads it, four
acts later, at the far end of the frontier. A captain who wrote the order can
leave a Borg scout filing its survey and put a grid on the colony instead.

A flag written by new content and read by new content is the shape the whole
exercise is for, so the test does not merely assert the two ends exist: it
builds a captain without the flag, checks the choice is not offered, sets the
flag, and checks it appears. A `requires` the engine ignored would leave the
choice on screen for everybody and every other assertion would still pass.

**Written-and-gated decisions: 18 → 24.**

### And the repo caught me again, one layer down

`tests/episodevars.test.js` failed on `beta_reticuli:knew_the_signature` — a
mission variable set by a choice and routed on by nothing. Exactly the defect
§61 is about, one layer beneath flags, in the second instalment of the work
complaining about it.

That is twice in two instalments: `utopia_finding` in §61, `knew_the_signature`
here. Both deleted rather than given an invented reader, and both caught by a
test rather than by me reading my own draft. The pattern is worth naming:
**writing a value down feels like doing something, and is not**. The instinct
that produced thirty-three orphan flags in the first place is the same instinct
that produced two more while removing them, and the only reliable defence is a
test that asserts the rule against the file that states it.

### The probe that started lying

One more, because it is §57 again in my own instrument. The sweep for orphan
flags counts "named more than once anywhere in `src/`" — and `consequences.js`
**names four `homecoming` flags in its header comment** while explaining that
they are the excusable ones. So the probe reported 24 orphans where the truth
was 28: it had been satisfied by the comment saying the name means nothing.

The same trap, in the same shape, one section after documenting it.



## 63. "Use a thermal vent. Open this console."

Third play pass over the harness screenshots. `03d-surface.png` is an away team
standing on Vulcan IV in front of a plant, and the button offered is:

    USE SOMETHING GROWING
    "survey that"
    OPEN THIS CONSOLE

Three lines, and the middle one is right.

### What the button was doing

`bridgeScreen` builds one button for three different things a captain can be
standing in front of — a console, a door, and a feature on a planet — from two
templates:

```js
target.panel || target.id ? `Use ${target.label}` : 'Use',
sub: target.panel ? 'Open this console' : 'Through the door',
say: target.check ? 'survey that' : target.panel ? 'use it' : 'through the door',
```

The third line already knows. **`target.check` is a discriminator for surface
features and nothing else** — no station aboard the ship carries one — and it
was consulted for the spoken phrase and ignored by the label and the subtitle.
One branch of a three-way distinction, applied to one of its three readers.

All five surface features have `panel: 'survey'`, so all five got the console
subtitle:

| offered | what it is |
| --- | --- |
| Use a mineral outcrop / Open this console | a rock |
| Use a standing ruin / Open this console | a ruin |
| Use a crashed hull / Open this console | a wreck |
| Use a thermal vent / Open this console | a vent |
| Use something growing / Open this console | a plant |

### Why it is not a text nit

`hazard` is not flavour. `HAZARD_LEVEL` in `sim/away.js` turns it into numbers:

| hazard | injury | death | hours away |
| --- | --- | --- | --- |
| routine | 4% | 0.4% | 5 |
| elevated | 14% | 2% | 11 |
| dangerous | 28% | **6%** | 19 |

A thermal vent is `dangerous`. So a captain was being asked to spend nineteen
hours of commission time and accept a **six per cent chance that somebody does
not come back**, by a button that said *Open this console*. The risk was in the
data, used by the resolution, and shown nowhere.

### What it says now

    SURVEY SOMETHING GROWING
    "survey that"
    ROUTINE — MEDICAL TEAM, 5 HOURS

The label is `Survey ${lowerFirst(label)}` — only the first character, not
`toLowerCase()` on the whole string, because the feature labels have no proper
nouns in them *today* and flattening one the day they do would be wrong and
silent. The subtitle is the decision: the game's own hazard word, the
department whose officer takes the check, and the hours it costs.

### The guard

Three checks in `verify-app`, read off the rendered button in the real page.
Confirmed against a control with the discriminator forced off, which reproduces
the original string exactly:

    Use Something growing"survey that"Open this console

— and fails all three, each for its own reason: it does not begin with
"Survey", it says "console", and it names neither a hazard level nor a number
of hours.

### The shape of this one

Same shape as §59 and §61, which is now three for three: **the code already
knew.** `occupancy.js` had a wall-standoff number that was right for a room and
wrong for a corridor; the mission book had five gates and used two; this button
had a discriminator and used it once. None of the three needed new information.
They needed the information already present to reach all of the places that
should have been reading it.



## 64. "We lost 1."

Same play pass, next screenshot. `19-boarding.png` is the card a captain reads
after sending a party onto a Klingon bridge:

    BOARD THE HOSTILE
    ✓ Beam through their shields.  — Ayla Marchetti
    ✗ Take the bridge.             — Amara Novak
    ✗ Persuade the survivors.      — Ravel Barrow
    1 of 3 objectives. We lost 1.

Three officers named for three objectives, and the person who died rendered as
the digit **1**.

### The code already knew

`report.casualties` has been on the object the whole time. `away.js` pushes
`{ name, killed: true }` or `{ name, injured: true }` for every person the
party loses or brings back hurt, using `officer.name` for a bridge officer and
the literal `'Security crewman'` for the rest. `awayMission` copies the whole
array onto the report:

```js
const report = { ..., casualties: team.casualties.slice(), lost };
```

And the ship's **log** already names them, three lines away in the same file:

```js
if (r.killed) this.pushLog(`We lost ${r.killed.name}.`, 'medical');
else if (r.injured) this.pushLog(`${r.injured.name} is hurt.`, 'medical');
```

So the names existed, reached the report, and were printed in the log — and the
one surface the player actually reads and dismisses summed them to a count.

**And the injured were not mentioned at all.** `lost` is
`casualties.filter((c) => c.killed).length`, so an officer who came back hurt —
who goes to sickbay, and whose regard for the captain drops by five — appeared
nowhere on the card.

### What it says now

    1 of 3 objectives.
    We lost Ravel Barrow.
    Amara Novak is hurt.
    We lost a security crewman.

The injured line is muted, the losses are not. An unnamed casualty gets an
article — "a security crewman" — because `away.js` stores a label, not a name,
and a label needs one to sit in a sentence. At most three steps in any
template, so at most a handful of lines; no cap is needed and one would only
hide a name.

### The guard, and why it is staged

A casualty is a dice roll. A check that waits for one is a check that reports
clean by not running, so this one hands `runAwayMission` a report with a killed
officer, an injured officer and an unnamed crewman in it, and reads the three
sentences off the rendered card. Confirmed against a control that reproduces
the original string exactly — `1 of 3 objectives. We lost 1.` — and fails all
three.

The staging displaced the real boarding modal and broke two later checks that
needed it, so the block moved to after them. Same lesson as the close-pass
staging in §60: **the harness keeps playing this captain for another two
hundred checks**, and anything staged has to be put back or placed where it
cannot displace anything.

### Four for four

§59, §61, §63 and now this. Every one was a value already present in the data,
read by fewer places than should have read it:

| | already knew | did not use it |
| --- | --- | --- |
| §59 | a wall standoff tuned for a room | in a 2.6 m corridor |
| §61 | five mission gates | three of them |
| §63 | a surface-feature discriminator | the label and the subtitle |
| §64 | every casualty by name | the card the captain reads |

None of the four needed new information. Four times running, the defect was a
fact the program had and did not carry all the way to the person playing it —
which is a more productive thing to go looking for than a missing feature.



## 65. A bar and the numbers beside it, disagreeing

`12b-board-of-inquiry.png`. The service record prints a rank-progress bar with
its numbers to the right of it, and the two are not the same quantity.

```js
readout('Rank progress', p.rankProgress,
  p.nextRank ? `${p.xp} / ${p.nextRank.xp}` : 'max'),
```

`rankProgress` is `(xp - thisRankFloor) / (nextFloor - thisRankFloor)`. The text
is measured from zero. Printed in the same row, they disagree at every rank:

| rank | xp | bar | the numbers beside it |
| --- | --- | --- | --- |
| Captain | 15,000 | **0%** | 15000 / 28000 — reads 54% |
| Commodore | 51,000 | 32% | 51000 / 66000 — reads 77% |
| Vice Admiral | 99,000 | 10% | 99000 / 135000 — reads 73% |

### And at the start it does not move at all

A captain is commissioned at **rank index 5 — Captain — with zero experience**,
and Captain's floor is 17,000. So `rankProgress` is negative, clamps to nought,
and **the bar sits empty for the first seventeen thousand points of a
commission** while the numbers beside it climb from nothing to fifteen thousand.
The same happens to any rank granted by `rankIndex + 1` without the experience
behind it, which is how the screenshot came to show a Commodore on 39,413
against a floor of 44,000.

`rankProgress` has exactly one consumer in the repo, so the blast radius is that
one line. The getter is left alone — as a concept it is right, and the day a
captain starts at Ensign with no rank granted ahead of their record it will be
true as well as right. The bar is now measured the way the numbers are:
monotonic, never negative, and checkable by eye against the pair beside it,
which is the only property that matters for two readings of one thing in one
row.

### The column was too narrow for a pair

`.readout .val` was `flex: 0 0 48px`, which is exactly right for `100%` and
wrong for `39413 / 66000`. Measured: the pair wrapped onto **three lines**
beside a one-line bar, and even a fresh captain's `0 / 28000` took two. Now
`flex: 0 0 auto` with a 48px floor and `nowrap` — every short value still
right-aligns to **the same pixel, 425**, across all eight subsystem rows and
all ten faction standings, and the bar gives up the width instead.

### Two mistakes of mine, and the rule they change

**I read the post-fix screenshot as still broken. Twice.** The fill was there —
154 device pixels of amber out of 258 — and at the scale a full 1344-pixel phone
screenshot is viewed, I could not resolve it against the trough and twice
concluded the bar was empty. What settled it was cropping: a screenshot of the
`.readout` element alone, where a 60% amber bar is unmistakable.

**And my first guard asserted the wrong property.** It read `style.width` off
the fill, which would have passed while the bar was a few pixels wide, or
`display: none`, or transparent. The check now reads
`getBoundingClientRect().width` — the rendered box — and the line count of the
value beside it.

So §59's rule gains a clause. *A visual feature is not done when the code runs;
render it and look* — **and if the thing is small at phone scale, crop it, and
assert the rendered box rather than the property you set.** A style attribute
being present is not a thing being visible, and my own eyes on a downscaled
screenshot are not a measurement.

### Five for five

The pattern from §64 holds again: the code already knew. Both the XP and the
threshold were on the object and printed on the screen; what was wrong was that
the bar beside them was computing something else and nobody had put the two
numbers together.



## 66. Seven departments, one blue disc

`07b-ships-company.png`. The crew roster draws each officer's initials on a
coloured disc, and every disc is the same blue — first officer, tactical, chief
engineer, science, medical, helm, communications. Seven departments, one colour.

Meanwhile, in `gfx/room.js`:

```js
const DIVISION_COLOUR = {
  command: [0.86, 0.72, 0.18],       // gold
  helm: [0.86, 0.72, 0.18],
  comms: [0.68, 0.16, 0.16],         // red
  engineering: [0.68, 0.16, 0.16],
  science: [0.20, 0.42, 0.72],       // blue
  medical: [0.20, 0.42, 0.72],
  tactical: [0.86, 0.72, 0.18],
};
```

— which has been painting the person standing at each of those consoles in the
first-person view all along, and which `tests/gfx.test.js` already asserts are
not all the same colour. The note above that table says the uniform is *"the one
thing about a crewman you are supposed to be able to read across a room"*, and
the screen whose entire job is listing the crew was throwing it away.

### The wrong source of truth was the obvious one

`STATIONS` in `crews.data.js` carries a `dept` on every post and looks like
exactly what this needs. It is not:

| post | `STATIONS[].dept` | `DIVISION_COLOUR` |
| --- | --- | --- |
| helm | `operations` | **gold** |
| comms | `operations` | **red** |

`dept` files helm and communications together, and in the 1966 palette a
helmsman wears command gold while communications wears operations red. `dept` is
right for what it is for — which department's officers are competent at a check
— and colouring from it would have put the helmsman in the wrong shirt while
looking perfectly reasonable in the diff.

So the colour comes from the table that already paints the figure, through a
six-pass-through, one-entry map (`first_officer` → `command`). The roster disc
and the person at that console cannot drift apart, because there is one table.

### And the ink

`.pip` had `color: #000` fixed. Black on gold reads; black on the operations red
does not, and black on the old mid-blue was not good either. `divisionInk`
returns the background and an ink chosen by luminance.

The dead and the injured keep their own colours — grey and amber, from the
stylesheet — because those states are more urgent than which shirt somebody
wears, and an inline style would have beaten the class rules carrying them.

### Two guards, and one of them had to be rewritten

The first version asserted *the ink is black or white*. The old uniform-blue
disc with its fixed black text satisfies that too — **a guard that passes in
both states measures nothing**, which is the rule this project keeps paying for.
It now asserts the RELATION: that the ink is the readable choice for the
background under it, whatever those two colours are. Against the control it
fails with all seven officers listed as `rgb(0, 0, 0) on rgb(46, 109, 180)`.

The other counts DISTINCT disc colours rather than checking for a specific rgb.
Hardcoding the expected gold would only prove the harness agrees with a
constant; the property that matters is that the discs differ from one another
the way the uniforms do. Against the control: *"1 colours over 7 officers"*.

### Six for six

The pattern from §64 again, and this is the clearest instance of it yet. Nothing
was missing. The colour existed, was correct, was already applied to the 3D
figures, and was already protected by a test — and the roster, the one screen
built to tell you who your officers are, painted them all the same.



## 67. Standing, without the reason

The Record screen's Standing panel prints a bar and a tier for each power, and
nothing else. Meanwhile `Game.factionMemory` computes a second, entirely
separate number:

```js
return {
  weight: Math.max(-0.4, Math.min(0.4, weight)),
  line: loudest.line,
  reasons: held.map((e) => e.flag),     // read by nothing
};
```

`weight` moves **every hail** with that faction by up to ±0.4, and the method's
own note says the strongest single memory "is worth about as much as shooting
first costs". A captain sitting at Cordial with the Klingons while carrying
`fired_first_archanis` had a permanent penalty on every Klingon channel and no
way to find out short of opening one.

`factionMemory` has exactly one caller — `hail` — and `reasons` had none at all,
which is what you would expect of a field returning bare flag ids that nobody
could do anything with.

### What was already right, and stays

The **loudest** memory is already said at the moment of a hail, and the comment
beside it is the reason not to move it:

> Said before the reply, because it is the reason for the reply. A captain who
> is refused wants to know it was Archanis and not the weather.

That is correct and untouched. The standing panel is a different moment: it is
where you look to find out what you are carrying **before** deciding whether to
open the channel at all. So `reasons` now carries the words as well as the flag,
and each memory appears under its faction's bar with the sign it cuts in.

Factions remember nothing for most of a commission, and a list of empty headings
would be worse than the bar alone — so a power with no memories still shows just
the bar.

### The check had to be staged, and pointed at the right screen

A fresh harness captain remembers nothing with anybody, so reading the panel as
it stands would pass whether or not this works. The check sets
`fired_first_archanis` and `kang_respects_you`, renders, reads the two lines
back, and puts the ledger the way it found it — with a third check asserting the
restore rather than trusting it.

And the first draft navigated to the **Rep** tab, which is the wrong screen and
reported the panel missing. The Rep tab is the reputation TRACKS, a separate
progression, and it says so itself:

> Standing — whether they are shooting at you this week — is tracked separately
> on the Record screen.

Two things named alike, doing different jobs, both correct. Worth recording
because the mistake looked exactly like a bug in the change.

### Seven for seven

Same shape. Nothing was missing: the weight was computed, the words were
written, the mechanic was live on every hail — and the screen that exists to
tell you how a power feels about you printed one number and not the other.



## 68. Seven knobs the difficulty table declared and the game did not read

A sweep for the marker that found §67 — a field written into an object literal
and read by nothing — pointed at `src/rules/difficulty.js`. Twelve rungs, each
declaring twenty-odd mechanical knobs.

### The instrument lied first, exactly as in §62

The first sweep excluded the declaring file from the "reads" corpus and reported
**eight dead knobs**, including `enemyDamage` and `playerDamage` — which would
have meant a difficulty setting that does not change damage.

It is wrong. `difficulty.js` contains its own accessors:

```js
enemyMods() {
  return {
    damage: this.scale('enemyDamage'),
    hullMax: this.scale('enemyHull'),
    accuracy: this.scale('enemyAccuracy'),
  };
}
```

Four of the eight are read there and called from outside. **The file that
declares a thing is often the file that reads it**, and a sweep that skips it to
avoid counting the declaration also skips the reader. Corrected: **seven**, not
eight, and none of them combat damage.

A second false positive in the same sweep: `enemyHull` appeared to have three
readers elsewhere, all of which were a local variable of that name in the hail
code.

### The seven

| knob | spread | what it was |
| --- | --- | --- |
| `fuelUse` | 0.6 → 2.2 | unwired → **wired** |
| `resourceRate` | 1.5 → 0.35 | unwired → **wired** |
| `enemyRelentless` | top three rungs | unwired → **wired** |
| `hazardScale` | 0.4 → 2.7 | **duplicate** → deleted |
| `autoSave` | `true` on all twelve | **constant** → deleted |
| `advantageOnFirstFail` | Story alone | **subsumed** → deleted |
| `allowReload` | false from Commodore | unenforced → **kept, unread, on purpose** |

### The deletions matter more than the wirings

`hazardScale` is the one that would have done damage. It spans 0.4 to 2.7 and
looks exactly like an away-mission risk multiplier waiting to be plugged in.
`crewLossScale` spans 0.3 to 2.7 and is **already** multiplied into both the
death chance and the injury chance in `away.js`, at precisely the line
`hazardScale` would have attached to. Wiring both would have multiplied
casualties by **7.3** at Fleet Admiral, out of two numbers that each look
reasonable.

`autoSave` is `true` on every rung — a constant dressed as a setting.
`advantageOnFirstFail` is true only on Story, which already carries `luck: 2`:
two rerolls, wired, and strictly more generous than one free retry.

`allowReload` is kept precisely because it is a real promise the game does not
keep: false from Commodore up, with a getter on the class and no caller.
Enforcing "saves cannot be reloaded at the top five rungs" means changing what
the load screen offers — a change about the save system, not about this table.
Left declared and exposed so the next sweep finds the promise rather than
quietly losing it.

### The wirings, measured

| rung | fuel per leg | legs per tank | survey haul |
| --- | --- | --- | --- |
| Story | 5.6 | 17.8 | 21 |
| Lieutenant | 9.4 | 10.7 | 14 |
| Fleet Admiral | 20.6 | **4.9** | **5** |

`fuelUse` is threaded into `plotTransit` as **its own parameter**, not folded
into `efficiency`. Efficiency divides `travelHours` as well as `fuelCost`, so
the obvious one-word change would have made the top rungs slower as well as
thirstier, which is not what the knob says — and a test asserts the hours are
unchanged. It is applied *before* the affordability check, so a course the
difficulty has made unaffordable is refused at the helm rather than stranding
the ship halfway.

`enemyRelentless` was the quietest of the seven and is the biggest change:
`Engagement.relentless` has existed all along, disables breaking off, and was
set by exactly one thing — the Kobayashi Maru. At Vice Admiral and above nobody
runs now. The caller still wins where it asks explicitly, so the simulator keeps
its own answer, and a test asserts every rung below is untouched: this is a
property of three rungs, not a rebalance of the game.

### And the harness caught the change, correctly

`verify-app` went red on *"a successful survey puts something in the hold, and
only once"*. The check asserted the hold gained **at least** the feature's
declared yield — which was the rule before `resourceRate` was wired, and the
harness runs at Commander, where the rate is 0.8. A 14-unit outcrop now pays 11.

The check was stating the old rule, so it was updated to the new one and
**pinned to the exact expected number** rather than loosened. `>=` would pass a
yield that was too generous; `> 0` would pass one unit of anything. Weakening an
assertion to accommodate a change is how a change stops being tested.

### The rule this adds

A sweep whose only output is "wire everything you find" is a sweep that will
eventually break something. Three of these seven should not be wired, each for a
different reason, and one of the three would have been actively harmful. The
useful question is not *is this read?* but *is this read, and if not, is that
because something else already does its job?*



## 69. Seventeen rooms, and what is actually in them

The standing question, asked in the user's own words: *how many rooms can you
actually DO something in, versus walk through?*

### The lead that was false, and why it is here

The measurement started from a strong-looking finding: six `panel` keys are
declared on stations aboard — `damage`, `weapons`, `medical`, `fabrication`,
`navigation`, `record` — and `openConsole` in `main.js` has a `case` for none of
them, so eleven stations across seven rooms fall through to
`default: 'Working, Captain.'`

**It is false.** `STATION_PANEL` (`src/main.js`) aliases all six, and
`tests/wiring.test.js` already asserts that no alias resolves to a missing
console. The four stations that carry `panel: null` are likewise already
answered, by `src/sim/consoles.js`.

The lead had been carried forward across a context boundary and was never
re-checked against the file. It is recorded because the correction is the
recurring one in this dossier: **roughly one carried-forward lead in three is
stale, and checking costs a single grep.** §62 and §68 are the same mistake in
the instrument; this is the same mistake in the premise.

### What was true instead

`stage.where` names the compartment a scene happens in. `Mission.testWhere`
enforces it — one gate, in one place, with the panel asking the engine rather
than answering for itself. It defaults to `bridge`.

| `stage.where` | stages |
| --- | --- |
| absent → defaults to `bridge` | 71 |
| `anywhere` | 41 |
| a named compartment | **7** |

Seven of a hundred and nineteen stages, across twenty-four episodes. Ten of the
seventeen walkable rooms had never hosted a scene.

The finale was among the defaults. `homecoming` is a board of review at Earth —
a casualty list on the table, nobody offering you a chair — and all four of its
stages were therefore gated to the bridge of your own ship. `court_martial` had
exactly this defect, was fixed, and was given a test called *"a hearing at a
starbase is not held on your own bridge"*. **That test names one episode instead
of the rule**, which is why the finale kept the bug. A guard written about an
instance does not cover the class.

### The room census

Every room, what it has, and what its stations open:

| room | scenes | stations that open something room-specific |
| --- | --- | --- |
| bridge | 0 | 10 — the ship's whole interface |
| sickbay | 1 | 3 (was 1) |
| engineering | 2 | 1 of 3 |
| brig | 3 | 1 (was 0) |
| briefing | 2 | 2 |
| armoury | 1 | 0 of 2 |
| transporter | 1 | 1 |
| hangar | 0 | 1 of 2 (was 0) |
| quarters, crewquarters, rec, cargo, auxcontrol, turbolift | 0 | 0 |
| corridor_a, corridor_rec, corridor_sec | 0 | **no stations at all** |

### The defect the census actually found

Not "no console", but **the wrong console**. Four stations opened a general
screen that is wrong for the room they stand in:

| station | room | declared | opened |
| --- | --- | --- | --- |
| `biobed` | sickbay | `medical` → `crew` | the personnel roster |
| `medlab` | sickbay | `medical` → `crew` | the personnel roster |
| `brig_control` | brig | `damage` → `ship` | the whole-ship screen |
| `bay_doors` | hangar | `damage` → `ship` | the whole-ship screen |

Sickbay was the sharpest: `cmo_desk`, three metres away, gave a real sick list
because it carries no panel at all and falls through to the report layer. One
station in the ward told the truth and two opened a filing cabinet.

`damage → ship` is *correct* for the other three stations that declare it — the
bridge damage-control board, the intermix monitor, the auxiliary damage board. A
key that is right three times out of five is exactly the kind of thing a sweep
records as fine.

### Two different repairs, and the reason they differ

- **Sickbay got a console**, because there is something to DO there. The board
  shows the hours between an injured officer and their post — a number
  `Officer.recover` has computed since the campaign-time sickbay was written and
  which nothing ever printed — and carries the first order in the game that must
  be given from a particular compartment.
- **The brig and the shuttlebay got reports**, because there is nothing to do
  there. The simulation has no prisoners and no shuttles, and both boards say so
  plainly. Setting `panel: null` and adding them to `REPORTS` kept every
  existing invariant untouched: a station either opens a panel or reports, never
  both.

Inventing prisoner state to justify a console would have been the same error as
wiring `hazardScale` in §68 — doing something because the shape of the code
invited it rather than because the game needed it.

### The corridors, left as corridors

`corridor_a`, `corridor_rec` and `corridor_sec` have no stations, only
`wallpanel` and `locker` props. They are left that way deliberately. A ship
whose every compartment is a menu is a menu with a corridor drawn on it; the
walk between the rooms is what makes the rooms places. The occupancy layer
already puts people in all three, which is what a corridor is for.

### The other half: an episode that happens aboard

Giving a room a board is only half an answer. The other half is that something
has to HAPPEN there, and no relabelling of existing stages could do it: those
episodes were written as things the ship arrives at, and the bridge is where a
captain deals with a system, a border, a hearing or a hull. Moving one of them
below decks would have been inventing a reason.

`long_watch` is written the other way round. Its first stage is anchored to a
star system and **every stage after it sets `system: null`** — a form
`Mission.stageLocation` has supported since it was written and which no shipped
stage had ever used. The ship goes on with its transit; the captain walks his
own decks for six weeks.

| | |
| --- | --- |
| compartments used | 7 — engineering, auxiliary control, cargo, crew quarters, the rec deck, the brig, the captain's quarters |
| of those, never used before | **5** |
| rooms hosting a scene, book-wide | 6 → **11 of 17** |
| walking, measured end to end | 27.3 s of simulated transit over six decks |

The route passes through all three corridors and the turbolift, which is the
census's own answer about what corridors are for.

Two details are read out of the simulation rather than invented: auxiliary
control is dark and empty at normal alert because `sim/occupancy.js` says so in
its own comment, and the rec deck holds more people at once than any other
compartment aboard, which is why it is where the ship's own opinion lives.

**And the same defect turned up while writing it.** The first draft set
`sat_in_the_dark` from three routes and read it from none — an unread variable,
in the episode written to stop things going unread. `tests/episodevars.test.js`
caught it within a minute of the file being wired in. Then the test file for the
episode made §69's other recurring mistake: it read `m.choices()` without
walking to the stage's room first, so "the gated choice is absent" came off a
list that was empty because every choice was locked by the room. Both are
recorded here because the lesson is not that either was hard to see — it is that
neither was visible without an instrument pointed at it.


## 70. The character sheet, and a pill that multiplied nothing

§69 ended a run of four defects with the same shape — a field present and
correct in the data, read by fewer places than should read it. This is the same
sweep pointed at the game's headline feature, and it found something bigger than
expected, plus a hole in the instrument §68 built to find exactly this.

### The measurement

Every `mechanic` object declared by a species, origin, career, trait or feat,
swept by name across the whole of `src/`:

| | |
| --- | --- |
| mechanic keys declared | **61** |
| read by something | 29 |
| **read by nothing** | **32** |

The instrument counts BOTH consumption paths, which matters: the ordinary one is
`character.mechanic('key')` by string literal, but `shipMods` also does
`species.mechanic?.critBonus` and `hasAdvantageOn` iterates `m.advantageOn`. A
literal-only sweep calls those dead. It is controlled six ways positive and once
negative before the number is believed — the rule this dossier keeps paying for.

### They are not all the same thing

A sweep whose only output is "wire everything you find" is a sweep that will
eventually break something (§68). At least two kinds are in the 32:

**Leftovers.** `reckless` declares `attackAdvantage` and `saveDisadvantage`, and
the README quotes that trait as its example of a *genuine mechanical trade*:
"advantage on every attack and disadvantage on every saving throw." Gameplay no
longer rolls a d20. `rules/resolve.js` replaced the die with a margin, and
`rules/dice.js`'s `save()` has no caller outside its own file. There is no attack
roll and no saving throw to attach to. That is not an unwired feature — it is
card text describing a design the game deliberately moved away from, and the
honest fix is words, not code.

**Real gaps.** `xpRate` and `inquiryImmune`, below.

### The pill that multiplied nothing

`xpRate` spans 1.25 at Story to 2.6 at Fleet Admiral and is printed on the
difficulty card as `XP ×2.6`. Measured:

```
rung            card says   awardXP(1000) actually granted
story             ×1.25       1000
lieutenant        ×1          1000
admiral           ×2.2        1000
fleet_admiral     ×2.6        1000
```

**Experience was identical at every one of the twelve rungs.**

### Why §68's sweep passed it

§68 swept the difficulty table for knobs nothing reads and reported seven. It
did not report this one, and the reason is a hole worth recording:

> the sweep asks whether a key is READ, and `charscreens.js` does `d.xpRate` to
> print the pill.

**A display read counted as a reader.** §67 had already named that exact failure
in another file — "standing, without the reason", a field read only to be shown
— and it then hid inside the instrument built two sections later to find its
siblings. The lesson is not "check for display reads"; it is that *is this read?*
is the wrong question, and *does this change what happens?* is the right one. The
fix here was measured by awarding experience and comparing, not by grepping.

### What was wired, and why those two

`Game.awardXP` is the one door — one `progress.addXP` call in the whole of
`src/`, and `officers.js` says why — so the rung's rate and the character's
multiply there. A test now pins that there is still exactly one door, because a
second caller would silently bypass both.

`inquiryImmune` had to go with it. `insubordinate` reads "start with a reprimand
on file and slower promotion — but immune to a board of inquiry", and declares
three mechanics of which only `startingReprimand` was read. So the trait
delivered both penalties and no compensation, and **wiring its `xpRate: 0.9`
alone would have made a pure-downside trait worse.** Two halves of one promise
are one change.

### The ladder afterwards

Awards of 1000 experience needed to reach the top rank:

| rung | awards | against Lieutenant |
| --- | --- | --- |
| Story | 108 | 0.80× |
| Lieutenant | 135 | **1.00×** |
| Captain | 100 | 0.74× |
| Fleet Admiral | 52 | 0.39× |

Lieutenant lands exactly on 1.00, which is what the table means by "the intended
experience, no thumb on the scale either way". The commission is measured in real
time rather than in experience, so ranking faster does not shorten the game — it
brings the later acts within reach of a captain playing a much harder one, which
is what the card was offering all along.

### The rest stay counted

`tests/mechanics.test.js` holds the 32 as a **ratchet**: it may go down, by
wiring or by honest deletion, and it may not go up. A new trait that declares a
mechanic and forgets to wire it now fails a test rather than shipping as a card
that promises something.

### Second pass: 32 to 26, and two of them were duplicates

Before wiring anything else, each remaining key was checked for whether the
CONCEPT exists — and that probe was wrong twice before it was right, which is
worth as much as the result. A `grep -E` with `\|` for alternation matches a
literal pipe, so every multi-alternative pattern returned nothing and the first
run concluded the game has no Prime Directive, in a codebase whose ledger opens
a board of inquiry for "a pattern of Prime Directive violations". A negative
control — a string that cannot exist — now runs beside it.

With a working probe, most of the remaining keys have a live system to attach
to. Four were wired, and two of those were **duplicates rather than gaps**:

| key | card | what it was |
| --- | --- | --- |
| `noRefusal` | "officers never refuse your orders" | a second name for `noObjection`, which `powers.js` already reads. **Deleted**; the trait now declares the working key |
| `peaceGain` | "double reputation from peaceful outcomes" | duplicated as a hardcoded `hasTrait('idealist') ? 2 : 1` in `earnReputation` — the same 2, written twice, so editing the card would change the promise and not the game |
| `killPenalty` | "destroying a ship costs double standing" | the other half of that trait, unwired. Applied at the one place ships are destroyed, not inside `adjustStanding`: it is about killing, and crossing the Neutral Zone should not cost an idealist more than anybody else |
| `federationGain` | "+2 to Federation standing gains" | unwired. On gains only, through `adjustStanding` — the one door all fourteen callers use |

The `peaceGain` duplication is the third instance in this dossier of the same
shape: a number on a card, written out again at the site that uses it.
`shipMods` records the first (`critSeverity`), §68 the second (`hazardScale`).
**A constant that appears in two files is a promise that can drift.**

And the measurement of each was wrong before it was right, both times for the
same reason: Federation standing starts at **100**, so a gain clamps and reads
as "no effect", and reputation tracks store `xp` rather than `points`. A probe
that returns zero is not evidence of zero.

### Third pass: the trait the README quotes

`reckless` is the example the README uses for "genuine trades rather than
bonuses": *"advantage on every attack and disadvantage on every saving throw."*
Both of its keys were in the 32. There is no attack roll and no saving throw —
`resolve.js` replaced the die with a margin — so this is the **leftover** kind,
and the fix is to keep the promise in the currency the game has.

Shooting is the ship's `accuracy`, which `shipMods` already contributes to from
the captain, beside `critRange` and `critSeverity`. The saving throw is the away
team: the one thing in the game that resolves a check, and the one place a
captain is personally at risk.

**And `resolve()` has taken a `disadvantage` argument since it was written with
no caller anywhere in the game.** The entire downside half of the resolution
system was unreachable code. This is its first user.

Measured, and the first number changed the design:

| hazard | plain | reckless, first draft | reckless, shipped |
| --- | --- | --- | --- |
| routine | 86.5% | 86.5% | 86.5% |
| elevated | 68.3% | 49.5% | 68.3% |
| dangerous | 50.2% | — | 28.0% |
| extreme | 26.0% | — | 10.5% |

The first draft applied disadvantage to every check and took away-team success
from 68.3% to 49.5% overall, with casualties from 4.5% to 7.2% — too much for a
*complication* a player takes alongside a single advantage. Narrowed to
`dangerous` and `extreme`, it is untouched on ordinary work and severe where the
ship is actually in danger, which is what a saving throw is. The other half pays
+8 percentage points of survival in a Constitution-against-D7 duel over 40
seeds.

**A trait quoted in the README as the example of a real trade should be the last
one to be a promise nobody kept.** The ratchet moves 26 → 24, and both the
README and the manual now describe what the game does.

### Fourth pass: two more traits that did nothing, and a dead method

`Haunted` reads *"disadvantage on Command checks below 25% hull — but +3 to all
others"*, and both halves were absent. The penalty was a `mechanic` nothing read.
The compensation was worse: `Character.checkModifier` applied
`hasTrait('haunted') ? +3` — **the same 3 the trait declares**, hardcoded, and
the fourth instance of that shape after `critSeverity`, `hazardScale` and
`peaceGain`.

And `checkModifier` **has no caller anywhere in `src/`**. `AwayTeam.modifierFor`
is what the game uses and it builds the modifier itself, so the +3 was dead code
inside a dead method. Measured: an away-team modifier of 6 with the trait and 6
without.

**A trait declared `positive: false` that cost nothing and gave nothing.** The
mechanic sweep could not see this half at all — `hasTrait('haunted')` is not a
`mechanic` key, so `compensation` showed as dead while a line that looked to a
human like its reader sat two files away doing nothing.

Wired at the live path, and measured:

| | plain | haunted |
| --- | --- | --- |
| Science modifier | 6 | **9** |
| Command modifier | 7 | 7 |
| Command check, full hull | 85.3% | 85.3% |
| Command check, 20% hull | 85.3% | **74.0%** |
| Science check, 20% hull | 67.3% | **87.7%** |

The compensation is on everything that is *not* Command, because the penalty is
on Command: a trait that paid on the same check it charged would net to nothing
where it matters and to a free bonus everywhere else.

`Notorious` — *"every Diplomacy check is at disadvantage"* — went with it, since
the machinery was now there: 74.3% to 61.7% on diplomacy, and science untouched.

The ratchet moves **24 → 21**, and `resolve()`'s disadvantage argument, which had
no caller at all two passes ago, now has three.

### Fifth pass: the other half of Notorious, and a duplicate folded into it

*"Hostiles break off sooner out of fear"* — `fearFactor: 0.15`, unwired. The
Living Legend feat said *"enemies hesitate"* through `enemyHesitation`, which is
**the same thing under another name**, so the feat now declares `fearFactor` at
0.08 and the duplicate is gone. Third deletion of that shape after `hazardScale`
and `noRefusal`.

Handed to the engagement the way `relentless` already is, because `ai.js` decides
who runs and does not know whose ship it is fighting.

**Added where the base is above zero, not multiplied into it.** Multiplying would
have been the lazier way to keep `fanatic` and `assimilate` at nought — a Borg
cube and a Jem'Hadar attack ship never run, whatever they are facing — and would
also have scaled fear by nerve, so a raider would fear you more than a
battleship does, for no reason.

**And the first instrument was too coarse to see it.** A duel reported 30%
survival against 33%, which looks like noise, because a fleeing D7 is nearly dead
either way. Measured at the moment the flag flips instead:

| | mean hull when the D7 broke off |
| --- | --- |
| plain | 9.7% |
| Living Legend (0.08) | 17.2% |
| Notorious (0.15) | **24.0%** |
| Borg cube, any fear | never breaks off |

The player-facing effect is that the fight ends sooner — 80.3 s to 73.1 s over 40
seeds — rather than that it is won more often. **An outcome measurement can be
too blunt for a mechanic that changes when something happens rather than
whether.**

The test then made the harness mistake in miniature: it used the Constitution the
rest of the file uses, against which the player is destroyed before the D7 ever
decides to run, and reported "too few break-offs to compare". The harness, not the
mechanic. Ratchet **21 → 19**.

### Sixth pass: a second channel with no caller

`AwayTeam.check` and `modifierFor` have taken a `situational` argument since both
were written, plumbed all the way to an itemised **"circumstance"** line in the
breakdown a captain can read — and **no caller anywhere ever supplied one.** The
same shape as `resolve()`'s `disadvantage` three passes earlier: a documented
parameter, fully wired, with nothing at the other end.

Which is why *"Cool Under Fire — no penalty from a breaching core, hull fires, or
being outnumbered"* removed a penalty that **did not exist**. Three traits are
about circumstance and none of them had one to work on.

The away team already knows the ship's state — `desperate()` needed `hullPct`, and
`buildAwayTeam` is the one caller that knows it — so fires and a breaching core
travel the same road. Measured on an elevated Science check over 400 runs each:

| the ship they came off | plain | Cool Under Fire |
| --- | --- | --- |
| quiet | 68.3% | 68.3% |
| two fires | 56.0% | 68.3% |
| four fires (capped at three) | 50.7% | 68.3% |
| a breaching core | 56.0% | 68.3% |
| three fires and a breach | **35.3%** | 68.3% |

The trait is worth **nothing** on a ship with nothing wrong, which is right, and
it is worth a great deal on one coming apart. And because fires burn out over
hours and `effectRepairs` exists, a captain who puts them out before beaming down
is unaffected — the penalty creates a decision rather than a tax.

### And two that were deliberately left

`ignoreOutnumbered` and `outnumberedAdvantage` both name a circumstance a landing
party **cannot be in**: away missions are refused in combat — *"Not while we are
under fire, Captain"* — so nobody is ever outnumbered while working. Wiring them
would mean inventing somewhere for them to happen, which is the thing §68 exists
to prevent.

They stay in the ratchet with that as the recorded reason. What did change is
that Cool Under Fire no longer *promises* relief from it: **a card should not
offer protection against something that cannot arise.** Ratchet **19 → 18**.

### Seventh pass: a sixth writer, and the price of an advantage

`combat.js` carries a note about `stealthDetect` being *"written by five things
and read by none"* — the ship baseline, a science skill node, a console, the
captain's Science ability, a watch officer's expertise — and that was fixed.

The Saurian's *"cloaked ships are detected at longer range"* was a **sixth
writer**, `cloakDetect: 0.4`, and it was not converted with the others. So the
species went on promising the thing the mod had started doing for everybody
else.

**The sign was the risk, and it is why this was measured rather than written.**
`stealthDetect` is multiplicative, and `loadout.shipMods` turns a console's
declared `0.4` into **×1.4**. Passing the raw 0.4 straight through would have
multiplied detection by four tenths — making a Saurian *worse* at the one thing
their card names. A test now fails on exactly that mistake.

| | `stealthDetect` |
| --- | --- |
| human, command | 1.120 |
| Saurian, command | **1.568** |

`directivePenalty` went with it. *"Maverick — advantage on any check the
regulations forbid. Prime Directive violations cost double."* The second sentence
is what pays for the first, and it was read by nothing: −18 became −36, and being
seen by a pre-warp culture −6 became −12.

**Charged at both places the Directive charges you.** The recorded violation, and
the covert landing whose own log line reads *"that will be in the report to the
Prime Directive board"*. A trait that doubled one of the two would be doubling
the bookkeeping rather than the rule. Both go through one helper, for the reason
`peaceGain` and `critSeverity` already record: a number written out in two places
is a promise that can drift.

Ratchet **18 → 16**.

### Eighth pass: a clause that could not have happened

*"Xenolinguist — first contact never fails outright, and unhailable factions may
answer once."* Both halves read by nothing, and the second could not have
happened **even in principle**: three factions carry `hailable: false` — Tholian,
Borg, Dominion — and the tactical screen never drew the Hail button for them at
all. There was no path to the promise.

The hearing is **forced**, through the flag the Diplomatic Corps signature power
already uses: a doctrine that refuses the channel is exactly what has to be got
round. It is spent on **speaking**, not on opening the channel, because a captain
who opens a channel and closes it again without saying anything has not used
anything up. And it survives a save, or a reload would hand it back.

`contactFloor` went with it — half a trait is the thing this dossier keeps
refusing to ship.

| first contact, 120 encounters | made |
| --- | --- |
| plain | 51.2% |
| xenolinguist | **100%** |

**Not a free success.** The failure branch becomes a *guarded* contact: the
species is recorded, and it pays **6 standing against a clean contact's 12**, with
400 experience against 900. A trait that turned the failure into the success
would have removed the roll rather than softened it.

And the measurement was wrong twice before it was right, both times for reasons
already written down in this section. The probe called `resolveEncounter` with
the encounter's KIND when the switch is on the CHOICE id, and read 0% for both
arms. Then the standing comparison read 0 for both — the clamp at 100 again,
three passes after it was first recorded here. **Knowing a trap is written down
is not the same as remembering it at the moment you build the instrument.**

Ratchet **16 → 14**.

### Ninth pass: two traits about seeing, and neither of them saw anything

Both of the remaining "you just know" traits were unread, and both of them ask
for something the game had **already computed** and was not showing.

*"Natural Tactician — you always know the enemy's weakest shield facing without
scanning."* `weakestFacing()` has been in `powers.js` since the science scan was
written, and the scan reports it. The trait says you get the same answer without
spending the scan. It is now an amber pill on the Target panel, beside distance,
cloak and withdrawing — one word, sitting with the other one-word facts, rather
than a line of its own.

*"Empathic — you can sense a hail's true intent before answering it."* The two
things a hail can be are both decided before the channel opens: `resolveHail`
returns `'ignored'` outright for a `fanatic` or `assimilate` doctrine unless the
hearing has been forced, and `factionMemory` has carried a weight and a line
since faction memory was written. A Betazoid reads both **before spending the
hail**, which is the whole of what the card promises and what nobody else gets:

| what the empath is told | when |
| --- | --- |
| *nothing on the other end intends to answer* | doctrine refuses the channel |
| *better disposed than the record says* | memory weight above +0.05 |
| *something is in the way before you speak* | memory weight below −0.05 |
| *nothing is weighing on this either way* | otherwise |

Neither trait declares a number of its own, and a unit test now asserts that:
they are both **windows onto arithmetic that already existed**, so there is no
second constant to drift away from a first. That is the shape this section keeps
preferring — §70's third pass folded a duplicate away for the same reason.

**And the instrument lied again, in the quietest way yet.** The verify-app check
for the empath built its "with the trait" arm by giving the captain a trait id
`betazoid_sense_probe`. There is no such trait. `Character` ignored it, so both
arms were the same captain, the two renders were identical, the comparison was
satisfied, and the check **passed while measuring nothing**. A check that passes
in both states is the failure mode this dossier has now written down four times;
this one is worse than the others because the difference it thought it was
setting was never applied at all. Replaced with a stub over
`g.character.mechanic`, and confirmed by unwiring each trait in turn — the
tactician check fires, and the empath fires two.

Ratchet **14 → 12**.


## 71. The skill tree, and two numbers the away check was given and never read

§70 swept the character sheet, which a captain fills in once. This is the other
sheet — the one filled in **over and over, with a resource the whole game is
built to award and no way to get a point back**. Seventeen skills, four
branches, a hard cap per skill. If a point buys nothing, the game has taken
something from the player that it cannot give back.

Twelve of the seventeen buy a ship modifier through `mods`, and all twelve work.
The other five buy a **`special`** — a named effect some other system is meant to
ask for. Three of those five were asked for by nobody.

| skill | branch | ranks | sold as | actually |
| --- | --- | --- | --- | --- |
| **Exobiology** | science | 3 | *away team science and medical outcomes* | `mods: {}`, and its one reader handed it to a parameter that does not exist |
| **Inspiration** | command | 3 | *crew survive hits better; officers object less* | `mods: {}`, no reader at all |
| **Fleet Tactics** | command | 3 | *your damage, and any allied ships'* | the 4% damage works; allies get nothing |

Exobiology and Inspiration have **empty `mods` as well**, so they are the two
skills in the tree that a captain can max out and buy literally nothing with.

### The parameter that never existed

`AwayTeam.check` takes `{dc, hazard, situational, label}`. The mission engine
called it like this, and had since the engine was written:

```js
team.check(g.rng, effects.check.type, {
  difficulty: effects.check.difficulty ?? 0.5,
  hazard:     effects.check.hazard ?? 'elevated',
  captainBonus: g.progress.awayScienceBonus,
});
```

**Neither `difficulty` nor `captainBonus` is a parameter of `check`.** Both were
destructured into nothing on every episode check in the game.

`captainBonus` is Exobiology's only appearance anywhere in `src/`. And
`difficulty` is worse than a dead skill, because eleven episode choices declare
one — 0.4, 0.45, 0.5, 0.55, 0.6 — and every one of them ran at its hazard's
default DC instead. Two `dangerous` scenes as different as talking a saboteur
down and holding a breaching core against a deadline were **exactly the same
roll**.

The declared values sit on a **0.05 grid around a neutral 0.5**, which is the
whole reading: 0.05 is one point of DC and the range spans ±2 — a nudge inside a
hazard band, not a second hazard scale competing with the first. The author was
writing in single DC points without knowing it.

| declared | 0.40 | 0.45 | 0.50 | 0.55 | 0.60 |
| --- | --- | --- | --- | --- | --- |
| success, 800 checks | 94.9% | 92.0% | 88.4% | 85.5% | 77.3% |

Exobiology moved to where the rest of the captain's contribution lives — the
`AwayTeam` constructor, beside `locals` and `hullPct` — rather than the options
bag, **because two callers run checks and only one of them was passing it**. Now
the away-mission board gets it too. It is itemised in `parts` like everything
else, so a captain can see the three points and where they came from.

| exobiology ranks | 0 | 1 | 2 | 3 |
| --- | --- | --- | --- | --- |
| science | 69.4% | 79.6% | 83.9% | 89.6% |
| medicine | 38.4% | 51.0% | 53.1% | 60.5% |
| **combat (control)** | **55.3%** | **55.3%** | **55.3%** | **55.3%** |

"Away team science and medical outcomes" — so science and medicine, and not the
two checks about shooting and not being seen.

### A control that drifted, and a sweep that went blind

Two instrument failures, and the second is the worst one this dossier has
recorded.

The combat control first read 51.1% → 55.6% → 54.1% → 53.1% across the four
ranks, which looks like a small real effect and is 2.5σ of noise. **The seed
varied with the rank**, so the four cells were not the same rolls with one thing
changed; they were four different sets of rolls. Pairing the seed made the
control exact to the decimal, and an exact control is worth more than a
plausible one.

Then the sweep that *finds* dead specials — the ratchet this section leaves
behind — was blind. Unwiring Exobiology completely left it reporting a healthy
tree, because the comment in `state.js` **explaining that `awayScienceBonus`
used to have no reader** is itself a match for `awayScienceBonus`.

Prose about dead code reads exactly like live code to a regular expression. That
has now happened four times in this repo, and three of those were caught by the
guard failing loudly. This is the first time it **hid a real unwiring** — the
check passed, and it passed because the thing it was looking for was a sentence
about the thing it was looking for. Comments are stripped before matching now.

### What is left, on a ratchet

`allyBonus` and `moraleBonus` are still read by nothing: **3 → 2**, and the test
that counts them refuses to let the number go back up. `crewProtect` is already
a live additive ship mod read by the casualty model, and the objection system in
`powers.js` already has a `noObjection` gate — so both remaining promises have
somewhere real to land, and neither needs a new number invented for it.


## 72. Two view-dependent terms, and the eye that neither of them had

The sweep moved from the character sheet and the skill tree into the renderer,
and found the same shape of defect there: **a channel fully built, argued for at
length in its own comment, and connected to nothing.**

`gl.js` has implemented a Blinn-Phong specular since the interior was written,
and the comment above it makes the case:

> a flat-shaded bulkhead with no highlight is a coloured polygon, and the same
> bulkhead with a soft sheen sliding across it as you turn your head is a wall

Rooms asked for it at 0.22. **No hull in the game ever did.** `beginFrame`
defaults it to zero, the two viewscreen passes named `gloss: 0` explicitly, and
the tactical plot — the main combat view — **never called `setLighting` at all.**

That last one is worse than a matte hull, because `setLighting` is the only
thing in the renderer that writes `uEye`. With no caller, the specular's
half-vector had no viewer to point at. Unwiring it again as a control shows what
was actually in the uniform: `[0, 1.18, -1.21]` — **the walker's eye position,
in metres, inside a room**, left over from the first-person pass and still there
while the plot drew hulls seventeen hundred units away.

### Wiring it was not enough, and the measurement said so immediately

With the term on and the eye correct, the brightest pixel on a hull gained
**four levels out of 255.** Raising the strength to four times its clipping
ceiling did not make it visible either. Two frames of the same fight, one matte
and one glossy, were indistinguishable side by side.

The reason is geometric and it is worth writing down, because it applies to
every view-dependent effect this renderer will ever have:

> A specular highlight needs the facet normal to line up with the **half-vector**.
> Across a bulkhead two metres away and filling the frame, the view vector
> changes a great deal from one fragment to the next, so the half-vector sweeps
> the whole lobe and the highlight slides across the wall — exactly what the
> comment describes, on the surface it was written for. A hull a hundred pixels
> across is the opposite case: the view vector is very nearly constant over all
> of it, the half-vector is effectively **one direction**, and a flat-shaded hull
> samples the lobe at its facet normals and nowhere else. With an exponent of
> 24 the lobe is narrower than the gap between facets, so it is simply missed.

Measured against the model: the closest any facet came to the half-vector was a
dot of **0.918**, and 0.918²⁴ = 0.135. Predicted gain 4.0 of 255; observed 4.0.
The exponent became per-draw — 24 for a near bulkhead, 8 for a distant hull —
and the same facet then keeps half its highlight instead of an eighth.

### The rim term the header had been promising

The file's own header said *"two lights and a rim term, all constant"*. There
was no rim term. The sentence states the problem — *a hull lit from exactly one
direction loses half its faces to solid black* — and then nothing solved it.

A rim needs the normal to be **perpendicular to the view**, which every closed
shape guarantees all the way round its own outline, on every frame, at every
angle. Nothing is left to luck. That is why the header's complaint is answered
by this and not by a highlight: it puts light exactly where there is none, along
the edge that separates the ship from the starfield.

| on the same frame, same camera, hulls only | mean | brightest pixel |
| --- | --- | --- |
| specular alone | +0.23 | +13.1 |
| rim alone | +0.14 | **+30.1** |
| both, as shipped | +0.38 | +30.1 |

**The rim reaches more than twice as far for less average lift** — concentrated
where it belongs instead of spread thin. That relation, not either number, is
what the guard asserts, because the numbers are camera-dependent and the
geometry is not.

It is applied in the surface's **own colour**, not white: white hangs a halo
round the hull and greys out the faction palette, whereas multiplying the albedo
can only lift a surface toward more of what it already is, so a Klingon hull
rims green and a Starfleet one rims white without either being told to. Cubed,
so it stays on the facets that are genuinely edge-on.

### What made all of this measurable

Both terms are **per-draw**, not per-frame, which is what makes them materials
rather than lighting. A painted hull and the asteroid it is flying past are lit
by the same sun and are not the same substance; one frame-wide sheen either puts
a highlight on the rock or takes it off the ship.

And **nothing was needed to keep the highlight off a window.** The shader mixes
the glow channel in *after* the specular, so an emissive face already replaces
it — the term is multiplied by (1 − vGlow) for free. Checked on the built fleet
rather than assumed: every painted surface carries glow 0 and every self-lit one
carries glow above 0.45. The per-material problem was solved before it was asked.

### The instrument, which was wrong first

The first version of the comparison rendered the same fight twice and diffed it.
Two matte frames differed by **205 levels** on their worst pixel — the camera
eases toward the fleet on every render, the vista spins, and the look springs
back to centre, so three renders in a row are three different pictures. The
"highlight" it first reported was the scene moving.

The fix is a third arm: **render the control twice and require the two to be
bit-identical** before believing anything about the third. That check is now
permanent, and it is the one that would catch this class of error again.

Two other things this section paid for:

- **A frame budget is not a quality budget.** The measurement recorded in
  `mesh.js` — the renderer is draw-call and fill bound, not geometry bound —
  is why every change here adds **zero triangles**, and why "make the models
  better" correctly meant shading rather than polygons.
- **A backtick in a GLSL comment ends the shader.** The source is a JS template
  literal; a comment mentioning a variable in backticks terminated the string
  and took the whole application down to a blank page. Prose about code, again.

### Left alone deliberately

Two leads were checked and killed before anything was built, which is the rule
that has now paid for itself in three consecutive sections.

**Smooth normals.** `mesh.js` argues flat shading in its own header — faceted
hulls "read as solid geometry at phone size in a way smooth shading does not".
Settled, and not reopened.

**Ambient occlusion on hulls.** `bakeOcclusion` exists and is rooms-only, and
its header says why: *"a hull in space has one hard light and a black
background, so its shape reads from the shading alone."* Its distance field is
keyed to a floor, walls and furniture circles — structurally a room's, and
inapplicable to a convex exterior seen from outside. The codebase had already
answered the question; the sweep only had to read the answer.


## 73. The worlds in the sky, and a field that was already here

§72 found a shading channel built and connected to nothing. This is the other
half of the same stretch and a different shape of defect: **two things that do
the same job, one of them good, and the good one wired to only one caller.**

`worldMesh` — the planet you are in orbit around — is built from a four-octave
value-noise field with coastlines, ragged ice caps and broken cloud, sampled per
quad from the facet's own normal. `bodyMesh` — every world in the sky, in every
system — was `sphere(..., banding: 0.35)`, and `banding` is a **single per-ring
hash multiplier**: twelve horizontal stripes of flat colour. Its own comment
conceded it was standing in for "a texture, which this renderer has no way to
load".

It did not need one. `surfaceColor` is a **pure function of a unit normal**, so
it can be sampled at any resolution for nothing. The two are one builder now,
called at 56×28 and at 20×12, and the sky body's **triangle count is unchanged
at 440** — which is what keeps four of them inside the scenery budget.

### Detail finer than a facet is not detail

The orbital frequencies are tuned for a 6.4° facet. A sky body's facets are
nearly three times the area, and running the same field over them puts more than
one feature inside a single flat-shaded quad. Counting how often two laterally
adjacent facets land in different elevation bands:

| | adjacent facets in different bands |
| --- | --- |
| orbital globe 56×28, freq 2.4, 4 octaves | **26.4%** ← the look to match |
| sky body 20×12, same frequencies | 53.3% |
| sky body 20×12, scaled by 0.42, 2 octaves | **24.6%** |

So the coarsening factor is not a taste constant: it is what makes a world
across the system as coherent as the one overhead. The test asserts the two
meshes **against each other** rather than against either number.

### Three things wrong in one place

**The lift.** Every sky body carried `tint: [1.5, 1.5, 1.5]` — a mid-tone
palette multiplied past 1.0 on all three channels. For an ice world that is an
albedo of **1.38 before any light fell on it**, so the lit half was pinned to
white and the terminator, the one cue that a disc is a sphere, could not be seen.
It is gone, and the bodies are lit from the system's own primary instead — the
terminator is not drawn, it is where aiming the light at the actual star puts it.

**The seed.** `bodyMesh` memoizes on `seed & 7`, so eight worlds of each kind
were available. Both draw sites passed `0`. Every planet in the galaxy was the
same planet. It is hashed per system and per index now, and **deliberately not
drawn from the vista's own stream** — a new draw there would shift every
subsequent placement and move every body in every system. This consumes nothing,
so the sky is exactly where it was and only its surfaces changed.

**And the trap that would have made the seed do nothing.** Both call sites drew
under the key `body:<kind>`, and `Renderer.upload` returns the cached GPU buffer
**by key alone, ignoring the mesh it is handed**. Passing a real seed without
putting it in the draw key would have uploaded the first planet of each kind and
silently reused that buffer for all the others — correct-looking source, correct
meshes, identical planets. Caught by reading `upload` before writing the change
rather than after.

### The instrument saturated before it discriminated

The first coherence measurement counted how often two adjacent facets had
*different colours at all*. It reported **68.5% for the sky body and 69.4% for
the orbital globe** — nearly identical, and nearly saturated. That number cannot
tell a coastline from confetti, because the continuous ice-cap and cloud blends
give almost every facet its own exact colour whatever the frequency.

What discriminates is the **size of the step** between neighbours, not whether
there is one. On that measure the sky body sits at 1.12–1.34× the orbital
globe's step despite facets three times the area, which is the claim worth
making and the relation the guard asserts.

**And the control is the mesh this replaced, built inside the test rather than
described**: `banding` gives every facet in a ring the same shade, so its
within-ring step is *exactly zero*. That is the definition of a stripe, and it is
the number the new mesh has to not have.

### What "do not make it worse" cost, and what it was worth

The new palette runs from ocean to icecap, so its **mean** albedo is 0.62–0.68×
the flat mid-tone it replaces. That is a real risk on a phone in daylight and it
was measured rather than assumed: the same frozen frame rendered on both builds
came out at **31.11 against 32.09** mean luminance — slightly *brighter*, not
darker, because a proper terminator puts light where the flat version had a
uniform wash and the peak bands reach further than the old mid-tone ever did.

Nothing clips at either end now, where the ice world used to clip before it was
lit.

### And a preset that existed twice

`beginFrame` set the vacuum lighting inline, and any pass that lights something
differently has to put it back afterwards — which `drawVista` now does, because
it runs **before** the hulls and without the restore every ship in the fight
would be lit by whichever planet was drawn last. Two copies of four numbers is
two places for the vacuum to drift apart from itself, so it is one exported
object used by both.


## 74. A commendation worth a log entry

`serviceScore()` is one line:

```js
score += (RECORD_WEIGHTS[kind] ?? 0) * n;
```

That `?? 0` is the whole defect. A record kind with no entry in the table
contributes **exactly zero and says nothing about it**, so from inside the game
"deliberately worth nothing" and "forgotten" are the same value.

And the score is not decoration. `findingFor` turns it into **exonerated,
reprimanded, or reduced in rank** at a Board of Inquiry, and it is on the
character sheet twice.

### The one that says out loud what it was supposed to do

`consequences.js` — a file whose entire subject is flags that nothing reads —
explains in its own comment why one ending writes a record rather than a flag:

> No flag on either ending here, deliberately. A first draft set
> `utopia_finding` and the test caught it: nothing reads it, which is the exact
> defect this whole file is about… The durable consequence is the
> `commendation` on the service record, **which the Starfleet review really does
> read.**

It did not. Six episode endings award a `commendation` and every one of them
weighed nothing. The author avoided writing an inert flag by writing an inert
record instead, in the file about inert flags.

**And there is a second half to it.** `record()` collects
`colony_saved`, `first_contact` and `treaty_signed` into `this.commendations` —
the things Starfleet commends you *for*. The kind literally named
`commendation`, the citation itself, was **the one record in the game named
after that list that never reached it.**

### And its sibling

`violated_border` is written by three endings, each alongside a standing hit —
so crossing the Romulan Neutral Zone and firing first cost you with the Romulans
and then left **no mark at all on the record Starfleet reads at the hearing**,
while `prime_directive_violation` weighed −14.

| | weight |
| --- | --- |
| `commendation` | 8, the same as a first contact and less than a treaty at 15 |
| `violated_border` | −6, the same as ignoring a distress call, above −14 for a whole culture |

Five citations now carry a board that a lost colony and a disobeyed order would
otherwise have reprimanded — asserted on the **finding**, both arms, so it
cannot pass by the base record happening to be clear already.

### The durable half, and the practice that was already here

The fix that matters is not the two numbers. `endOfCommission` had already got
this right for the one case it knew about, in a comment on its own call:

> Recorded, and deliberately weightless: `RECORD_WEIGHTS` has no entry for this,
> so `serviceScore()` counts it as zero… a captain does not get to be Exemplary
> for having merely lasted.

That practice is a **table** now — `WEIGHTLESS_RECORDS`, thirteen kinds each
with a one-line reason — and a sweep holds every record kind written anywhere in
`src/` to being in exactly one of the two. A new kind can no longer score zero
by omission. Thirteen were left weightless *on purpose and in writing* rather
than wired, which is the §68 discipline: a sweep whose only output is "weight
everything you find" would have made the review a count of missions flown.

`record()`'s own doc comment said `kind` may be "a `RECORD_WEIGHTS` key **or any
custom tag**". That sentence is how this happened, and it is gone.

### The instrument, wrong in a new way

The sweep first reported `label` and `text` as unweighted record kinds. Neither
is a record kind. The pattern was `record:\s*\{\s*([a-z_]+)`, and three episode
stages are called **`their_record`, `our_record` and `on_the_record`** — so it
matched the tail of a *stage id* and then took that stage's own next key.

A regular expression over source matching the thing next to the thing. The same
family as the four comment-prose failures already recorded here, and the fix is
the same shape: anchor it, with a negative lookbehind, so `record:` has to be a
whole word. Comments are stripped too — this dossier and `ledger.js` both
discuss these kinds in prose.


## 75. Eight buttons that taught a language the game does not speak

Every encounter button prints the phrase for saying the same thing out loud.
`lcars.js` says why:

> `say` is how this game teaches its own language. Everything worth doing is
> supposed to be doable by telling somebody to do it, and a player who never
> discovers that plays a game of buttons with an ignored text box at the bottom.

**For every signal encounter in the game, the language it taught was not one the
game speaks.** All eight `SIGNALS` entries carry their own phrasing — *"realign
it"*, *"grant it"*, *"put the doctor on"* — and not one of the eight was in the
lexicon. Saying what the button says did nothing at all.

And the trap power button printed a phrase that named a **different system from
its own label**. The label was built from `trap.powerChannel`; the phrase was
the literal string `'everything to auxiliary'`. So a ship held by a gravimetric
eddy showed:

> **Everything to engines**
> *"everything to auxiliary"*

Saying the words on the button returns `unknown`, and the parser's suggestion is
*"Target their engines / weapons / warp core"* — a combat suggestion, offered to
a ship that is held. Saying `all power to engines` parses as a **power order**:
it sets the channel and leaves you trapped, and `trapped` deliberately offers no
withdraw. The only phrase that worked named the wrong system.

### The guard that exists for exactly this, and could not see either of them

`tests/lang.test.js` already checked that every encounter choice's printed
phrase parses, and reaches that choice and no other. It was written after five
buttons were found routing to the wrong handler. It ran against this:

```js
/** Every encounter the game can put in front of a captain. */
const SHAPES = [ ...eight hand-written shapes... ];
```

**`signal` was not among them.** And the `trapped` case below it hardcoded
`powerChannel: 'auxiliary'` — the one channel whose phrase happened to match —
so the trap that asks for `engines` was never tried.

A hand-written list of what the world can produce drifts from the world. The
shapes are derived now: one per `SIGNALS` row, one per channel `TRAPS` actually
uses, and the fixed shapes for everything whose choices do not vary with
content. Add a signal and it is covered without anyone remembering to.

### And the declaration that was not the truth

`ENCOUNTER_KINDS` claims to be the kinds the game can roll. `buildTrap` has
produced `trapped` since traps were written and the array never listed it — and
**two separate guards enumerate that array to decide what they cover**, including
"every encounter kind the game can roll has a policy". A kind missing from the
list is a kind neither guard checks.

### My own guard had the same defect, and the control caught it

The first version asserted that every entry in `ENCOUNTER_KINDS` was covered by
a shape. Deleting `trapped` from the array made that guard **check less and
pass** — the control ran clean.

**A list cannot be the authority on its own completeness.** The guard now rolls
four thousand encounters and asserts that every kind actually *produced* is
declared, and separately that every declared kind is one the world produces, so
neither direction can drift. That is the only version whose control fails.

### What was fixed

| | |
| --- | --- |
| eight signal phrases | now in the lexicon, with a test that derives the list from `SIGNALS` so a new signal cannot arrive without one |
| the trap power phrase | built from `trap.powerChannel`, so the label and the words under it name one channel |
| `everything to engines` | taught to the parser; `build` already routed any *everything to* to `trap_power`, and only the recognition list was short |
| `ENCOUNTER_KINDS` | gains `trapped` |
| the phrase guard | derived from `SIGNALS` and `TRAPS` instead of remembered |

### Four leads killed before any of this

The sweep that found it also cleared four things that looked like defects and
were not, which is the rule that keeps earning its place:

- **`effects.repair`** is implemented and used by no episode — but no episode
  text promises a repair it does not perform. Latent capability, not a broken
  promise.
- **`choice.hidden`, `requires.standing` / `notFlag` / `torpedoes`, `def.vars`,
  `stage.label`, `where: 'surface'`** are all engine options no content uses. A
  player never sees that an engine supports `notFlag`; wiring them artificially
  would be inventing content, and removing them would be churn.
- **Every one of the seven `PATROL_ERRANDS` has an `observe` payoff** in
  `PATROL_WATCH`, with no orphans in either direction. Checked, clean.
- And the first grep for all of this reported `hidden`, `repair` and `vars` as
  *used* by episodes. All three were prose — the word "hidden" in a stage's
  narration, "repair teams" in a choice label, `m.vars[key]` in a routing
  helper. **Reading the matches rather than the counts is what turned a false
  all-clear into the real finding.**


## 76. The sentence you read twenty-one times

`tests/content.test.js` opens with a measurement and the work it caused:

> anomalies were 52% of every live encounter in the game. A player's default
> experience of a starship command simulator was a sentence about a gravitic
> eddy.

That fixed how **often** you meet one. It did not fix how many different things
one says, and those are two problems. The anomaly table had seven entries and
**one sentence between them**:

```js
text: `Sensors are reading a ${a.name.toLowerCase()}. Science requests permission to investigate.`
```

A commission meets about twenty-two anomalies. So the default experience was
still a sentence about a gravitic eddy — the same sentence, with seven nouns
rotating through the gap.

### Measured before anything was written

Encounters per commission against distinct opening text, which is what a player
actually experiences:

| kind | met/commission | openings before | after | rereads before → after |
| --- | --- | --- | --- | --- |
| **anomaly** | 21.6 | 1 template | 24 | **3.1 → 0.9** |
| **signal** | 19.6 | 8 | 16 | **2.5 → 1.2** |
| **trapped** | 6.5 | 3 | 6 | **2.2 → 1.1** |
| **first contact** | 2.1 | 1 | 8 | **2.1 → 0.3** |

Shares of live encounters are **unchanged** — anomaly stays at 26.8% against a
28% bar the file deliberately sits close to — and the anomaly pool's mean hazard
moved 0.393 → 0.392 and mean value 3.00 → 3.08. This is prose, not a rebalance.
Distinct opening texts across the game: **168**, against a ratchet of 100.

### A screen that contradicted itself

`buildFirstContact` printed one line for both of the entirely different things
that phrase means — *"An unknown vessel of unfamiliar configuration. No match in
the database. They are transmitting."* — and 35% of the time it sat above these:

> **Withdraw without revealing ourselves** — The Directive exists for a reason.
> **Make contact anyway** — This cannot be undone.

A pre-warp culture is not transmitting from a vessel. It does not know anybody
is out here, which is the entire reason General Order One applies and the reason
`contact_prewarp` records a Prime Directive violation. **The description and the
choices under it were about different events, and the consequence agreed with
the choices.** Both branches say what they are now.

### The guard from §75 catching content written after it

Three new traps use `shields` and `weapons` — real power channels the table had
never asked for. The phrase guard added one PR earlier failed immediately,
naming the trap and the words on its button, because the lexicon did not know
`everything to shields`. Same again for eight new signal phrases.

That is the guard working exactly as intended, on content that did not exist
when it was written, before any of it shipped.

### A coverage assertion that was a lottery ticket

Adding anomalies and traps shifts which encounters a seed meets, and
`tests/commission.test.js` failed: *"away templates no commission ever reached:
derelict_search"*.

Nothing about the game had broken. Measured across the sample: four of the five
away templates are reached by **every commission flown**, and `derelict_search`
was reached by **exactly one of five** — so a content change re-rolled a die
that had been landing the right way up. At eight commissions it is still 1 of 8.

Why it is rare is the interesting part, and the failure is what made anybody
look: **`game.wreck` is set by winning a fight that leaves hulls adrift, not by
meeting a `derelict` encounter at all** — that kind resolves through
`resolveEncounter('board')`, a different path with a different outcome. The
template needs a victory with wreckage *and* a captain who then sends a party
into it.

So the rare one is **proven** now rather than hoped for: win a fight, assert a
wreck exists, assert it is what puts the template on the board, run it.

### Two controls that did not fire, and what each was missing

**The first directed test set `game.wreck` by hand.** Stubbing out wreck
creation left it passing — it proved that a wreck offers the template and
nothing about whether a fight ever leaves one, and nothing else in the suite
covered that either. It stages a real fight now, and the control fails.

**The first control for the prose ratchet reverted the text picker only.** It
did not fire, because the shared template interpolates the anomaly's *name* and
the table had grown from seven entries to twelve — twelve names in one sentence
is twelve distinct texts, which passes. The real before-state is seven entries
AND the shared sentence, and against that the guard fails as it should.

Both are the same lesson in different clothes: **a control has to reproduce the
condition it claims to reproduce**, and "I reverted something" is not the same
as "I reverted to the state that was broken".

### What is left

`distress` is now the thinnest at 4 openings for 6.3 meetings — 1.6 rereads,
under the bar and the next one worth writing. The ratchet asserts a **relation**
between two measured quantities rather than a bar somebody picked: a kind must
carry enough prose that its opening is not read more than twice a commission.
Anomalies at one sentence scored 21.6 and would fail it by a factor of ten.


## 77. "At any difficulty", over seven rungs of twelve

§75 found a guard whose coverage was a hand-written list under a comment
claiming it was everything, and §76 found a coverage assertion that was a
lottery ticket. That is twice in two changes, so the next thing to do was look
for the **class** rather than the instance: every test in the suite that
hand-writes a list of the things it says it covers.

Two of them make universal claims in their own titles.

| test | claims | covers |
| --- | --- | --- |
| `invariants.test.js` | *"no rule is ever broken, in any fight, **at any difficulty**"* | 7 rungs of 12, 17 hostile hulls of 18 |
| `sim.test.js` | *"**every fight** ends, and nothing leaves the arena"* | 4 rungs of 12, 11 hulls of 18 |

The five rungs the invariant checker never visited are `ensign`, `lt_commander`,
`commodore`, `rear_admiral` and `vice_admiral` — and **three of those are rungs
where the ship can be lost for good and the record cannot be taken back**. A
rule broken only under permadeath had nowhere to show. The one hull it never
fought was `bioship`.

### Widened, and nothing was broken

Both matrices now derive from the source of truth — `DIFFICULTIES` for the
ladder, and `SHIP_LIST` filtered on the `faction` field the ship table already
carries — at 216 fights each, and **the game came through the whole matrix
clean**.

That is the honest result and it is worth stating plainly: this found no defect.
What it found was a guard that had been claiming more than it did, and the next
change to combat now gets checked against the twelve rungs and eighteen hulls
the title always implied rather than the subset somebody typed once.

The derivation is itself guarded, because a derivation that silently narrows is
the same defect arriving more quietly: the rung count is asserted against
`DIFFICULTIES.length`, the hull count against a floor, the player's own hull is
asserted **not** to be in the enemy list, and the 216 iterations are asserted to
divide by both list lengths so the modulo rotation actually walks each one whole.

### Two controls, one of which was measuring nothing

Removing a rung from the ladder must fail the guard. The first attempt at that
control used a regular expression that assumed `{ id: 'commodore'` on one line;
the file puts the brace and the id on separate lines, so **it matched nothing,
changed nothing, and the guard passed** — which for a moment looked like the
guard being weak.

It was the control that was weak. Written properly, by finding the entry and
cutting from its opening brace, the ladder drops to eleven rungs and the guard
fails with `only 11 rungs`.

That is the third control in three sections to fail for a reason that had
nothing to do with the thing under test — §76 had two of them. The lesson has
stopped being about any particular bug: **a control is an experiment, and an
experiment that does not perturb what it claims to perturb is not evidence of
anything.** Check that the arm you meant to break is broken, before reading what
the guard did about it.


## 78. The act every captain plays, and the two episodes in it

The book is twenty-five episodes. Where they sit:

| act | episodes |
| --- | --- |
| **1** | **2** — `shakedown`, `vega_raid` |
| 2 | 5 |
| 3 | **7** |
| 4 | 6 |
| 5 | 5 |

**Act one is the thinnest act and the one every single captain plays.** It is the
first hours of a five-year commission — the part that decides whether anybody
has a sixth hour — and it had a tutorial and a fight in it.

It is also **the only act that can grow**. `echoes.test.js` holds the spread
across acts to five, and 7 − 2 is exactly five: an episode added to any other
act fails that guard, and one added here loosens it to four. The constraint and
the need pointed at the same place, which is the most comfortable a content
decision ever gets.

### Where it goes, and why there

`shakedown` sends a new ship to Alpha Centauri for her trials — it says so, and
one of its stages carries `system: 'alpha_centauri'` so the fiction and the gate
agree. No episode is *set* there. So this is what is waiting when the ship
arrives, at the star a new captain is already being sent to.

**A Klingon scout, adrift inside Federation space, that has not asked for help
and will not.** A failing reactor, eleven people, weapons cold for hours. Command
acknowledges after four hours to say that it is a matter for Command, that
Command is considering it, and that the ship on station is best placed to judge.

Three endings: take them off, stand by the log, or hand it to the cruiser that
arrives eleven hours later.

### The reason for an act-one episode rather than a sixth act-three one

Both outcomes write a flag that `Game.FACTION_MEMORY` reads, so **how Klingons
open a channel with you for the rest of the commission depends on something
decided in week three by a captain with no record yet**:

| | weight | what the bridge says before you speak |
| --- | --- | --- |
| `centauri_aid` | +0.14 | *We took eleven of theirs off a dying ship at Centauri, Captain.* |
| `centauri_watched` | −0.14 | *They remember that we watched at Centauri, Captain.* |

That is the whole argument for filling act one first. A decision in act three has
two acts left to echo in; this one has four.

### What the structural guards demanded, and gave back

An episode is not free-form — the suite holds a new one to a long list, and
every item on it is a thing that would otherwise be discovered by a player:

- every `next`, `branch` arm and functional-`next` target names a real stage;
- a functional `next` must expose `.targets` and `.reads`, so the walker can
  follow it and the var guard can see what it consumes;
- every `setVar` must have a reader and every var read must be written by the
  same episode — `refused` is written at the hail and routes the decision;
- every stage keeps at least one choice with no `requires.var`, so nothing is
  reachable only by having done something;
- every `outcome` has an ending and every ending is reachable from an outcome;
- **every flag set must be read by a gate or by `FACTION_MEMORY`** — which is
  what turned a decision into a consequence rather than a variable;
- 30 random walks must reach `complete` in under 120 steps;
- and the record kinds it writes must be weighted or explicitly weightless,
  which is §74's guard doing its job on content written after it.

Walked by hand as well as by the validators, because a graph that satisfies a
walker is not the same as a scene that reads: three paths, three endings, and
the var routing proven by the fact that `repair` exists only on one decision
stage and `stand` only on the other.

Act spread **5 → 4**. Episodes **25 → 26**.


## Attribution

Star Trek and all associated marks are the property of Paramount. This dossier
records publicly documented facts and measurements, restated in my own words,
with links to the sources consulted. No text, artwork, audio or other creative
material from any source listed here is reproduced in this repository.
