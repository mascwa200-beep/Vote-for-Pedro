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

## Attribution

Star Trek and all associated marks are the property of Paramount. This dossier
records publicly documented facts and measurements, restated in my own words,
with links to the sources consulted. No text, artwork, audio or other creative
material from any source listed here is reproduced in this repository.
