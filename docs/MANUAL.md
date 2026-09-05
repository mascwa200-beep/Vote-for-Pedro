# Captain's Manual

Everything on this page is a real control that changes real numbers in the
simulation. Nothing here is decoration.

---

## Giving orders

There are two ways to do anything, and they are equivalent. Tap the LCARS
panels, or type an order into the bar at the bottom of the screen.

The parser is forgiving on purpose, and forgiving in specific ways. It expands
contractions and slang, folds British spelling and naval shorthand into one
form, throws away politeness, works out which station you addressed, and then
matches what is left three ways at once: by phrase, by keyword, and — for the
words you got wrong — by how they sound and by how many letters away they are
from the right one.

All of these work, and none of them is a special case:

```
Helm, set course for Vulcan, warp eight     the textbook form
warp 8 vulcan                               shorthand
Mister Sulu, all stop                       addressed to an officer by name
could you please aim for their nacels       polite, misspelled, still targeting
hale them                                   spelled the way it sounds
give them everything                        no keyword in common with "fire"
ds9                                         a place name is an order to go there
how bad is it                               a question is a damage report
```

### When it is not sure

Three outcomes, because pretending to be certain is worse than asking.

**Confident** — the order executes and the officer acknowledges.

**Fairly sure** — a prompt: *"You said X. I read that as: target their engines."*
Execute it, pick one of the three nearest readings, or belay it. Nothing happens
until you say so.

**Lost** — the computer says so plainly and offers the closest orders it knows.
It never guesses in a fight.

There is also a fourth case that is not uncertainty: an order it understood but
which is missing something it needs. `"set a course"` gets *"Which system,
Captain?"* rather than a guess at a destination.

### What this is, and what it is not

It is not a language model. It cannot be — the game has to work with the radio
off, forever, in a bundle small enough to precache onto a phone. It is a
lexicon: 530 phrasings and 138 weighted keywords across 30 intents, plus every
star system, faction, subsystem and shield facing in the game, indexed from the
game's own data rather than restated.

The honest measure of it is `tests/corpus/orders.txt` — 545 orders written the
way people actually type, including the typos — which CI runs on every commit
and fails below 95%. It currently passes all 545. That number will never be the
whole of English, which is exactly why the confirm prompt exists.

Officers acknowledge in their own register. A blunt officer will tell you an
order is a mistake; a disciplined one will log a reservation and carry it out
anyway. That is driven by their trait values, not a script.

## The captain's chair

You are sitting in it, so it is on the bridge screen and in an engagement.

Of every button on the real prop, exactly three were ever assigned a function on
screen: yellow alert, red alert, and jettison the ion pod. Those three are here
and do what they say. The rest of the panel is filled from the documented shape
of the chair — flip switches and viewscreen, shuttle and hailing controls on one
arm, the intercom and the tape recorder on the other — with nothing added that
the simulation cannot actually carry out.

**Alert conditions.** Red, yellow, and stand down. Plus **blue**, which the game
did not have before: the docking and maintenance condition. Call blue alert
before you effect repairs and the crew is at maintenance stations rather than
battle stations — half again as much hull recovered, in less time. It is refused
while anyone is shooting at you, for the obvious reason.

**Hailing frequencies** and the **viewscreen**, which switches between the
bridge and the tactical picture.

**The intercom**, to any of seven departments. Each answers with real numbers
off the live ship: engineering names your worst subsystem and its exact
percentage, sickbay counts your dead and which of the senior staff are hurt,
tactical counts the torpedoes actually left in the magazine.

**The log recorder.** Type a captain's log entry and it goes into the ship's log
alongside everything the crew said, under your name.

**The ion pod.** In a fight, jettisoning it puts a hot, ship-shaped object in
the water: for about a minute everything shooting at you is measurably more
likely to miss. Outside a fight there is nothing to gain and a pod to lose, so
the answer is no. You carry one.

Every one of these controls emits the same order object the parser produces from
typed text — so `engineering report` and tapping **Engineering** are the same
code path, and anything that breaks, breaks in both places at once, where a test
can see it.

Note the missing comma, which is not a typo. `engineering, report` reads the
comma as an address and the rest as a request for a damage report, so it is a
`status` order and not an intercom call. The chair used to log exactly that as
the captain's line — six of the seven stations quoted him asking for something
he had not asked for — and this page documented it. `tests/docs.test.js` now
parses every phrase printed here and checks it reaches the order it is filed
under, so the manual cannot drift away from the parser again.

### Navigation

| Order | Effect |
|---|---|
| `set course for <system>, warp <n>` | Plots and engages. Costs stardate time and antimatter. |
| `take us to <system>` / `head for <system>` | Same thing. |
| `all stop` | Throttle to zero. |
| `ahead full` / `ahead one third` / `ahead 40 percent` | Impulse throttle. |
| `come about` | Turn to face the current target. |
| `come to bearing 090` | Turn to an absolute bearing. |
| `come to bearing 090 mark 15` | Bearing and elevation together. |
| `hard to port` / `come right` | A relative turn from where the bow is now. |
| `steady as she goes` | Hold the current heading. |
| `take us up` / `dive` / `climb 30 degrees` | The third axis. Also on the Helm panel. |
| `level off` | Nose back to the horizontal. |
| `evasive manoeuvres` | Defence up, turn rate up, accuracy down. |
| `belay that` | Stop what you just ordered. In a fight, that means the guns. |
| `cloak` | Refused, with a reason. No Federation hull in this game has one. |
| `get us out of here` | Begin an eight-second warp-out. They get those eight seconds. |
| `request docking` | Full repair and resupply, where facilities exist. |

### Alert and shields

| Order | Effect |
|---|---|
| `red alert` / `yellow alert` / `stand down` | Alert state, ambience, and haptics. |
| `shields up` / `lower shields` | Shields cannot regenerate while down. |
| `reinforce forward shields` | Draws from the other five facings — but only as much as the reinforced facing can actually hold. |

### Power

Four subsystems draw from a fixed pool. 50 is nominal; 100 is roughly +50%
output; below 25 things start failing noticeably. **Rebalancing is not
instant** — the EPS grid takes a few seconds, so you commit before you
benefit.

| Order | Effect |
|---|---|
| `divert power to shields` | +25 to that subsystem, drawn from the others. |
| `all power to weapons` | Maximum, everything else starved. |
| `attack power` / `defensive posture` / `speed configuration` | Presets. |

### Weapons

| Order | Effect |
|---|---|
| `fire` / `open fire` | Fires everything that bears. |
| `fire torpedoes` | Torpedoes only. |
| `target their engines` | Subsystem targeting — see below. |
| `next target` | Cycle hostiles. |
| `hold fire` | Disables auto-fire. |

### Comms, sensors, damage control

| Order | Effect |
|---|---|
| `open a channel` / `hail them` | Opens the negotiation panel. |
| `damage report` | Full status readout. |
| `scan them` | Detailed reading on the target, including its weakest facing. |
| `eject the core` | The only way to survive a warp core breach. |
| `assemble an away team` | Prepares a landing party. |

---

## Combat

### Shields have six facings

Fore, aft, port, starboard, **dorsal and ventral** are tracked independently.
Damage lands on the facing it arrives on. A shot that comes in over the bow does
nothing to your aft shield, and once a facing is down, everything on that side
reaches the hull directly.

The two vertical facings are what the third dimension costs and what it buys.
An attacker who climbs above you is hitting your dorsal shield, not your bow —
and hostile captains know it. An aggressive commander will deliberately work
their way above or below you to reach whichever of the two you have let run
down, because getting at a weak facing that way does not require out-turning
you.

This is why **turning matters**, and why **pitching** now matters too. When one
**Use the third axis.** The enemy does. Klingon and Cardassian captains
deliberately come at you from above or below whichever face you are presenting,
because a ship that is climbing is a ship whose dorsal shield is toward you.
`Take us up`, `dive`, and `level off` are orders, the Helm panel has Climb /
Level / Dive, and `bearing 210 mark 15` gives both axes in one breath.

facing is stripped, present a fresh one. `Come about` brings the target into
your forward arc in both axes at once. Climbing is slower than turning on every
hull in the game, so using the vertical is a real trade rather than a free extra
direction to run in.

Firing arcs are cones, not angles: a forward phaser bank does not bear on
something directly above the saucer merely because it is ahead in plan view.

Even a healthy shield bleeds about 8% of every hit through to the hull.
Torpedoes pierce a further 25% on top of that, which is their entire purpose:
they are how you hurt something whose shields you cannot break.

### Subsystem targeting

Targeting a subsystem trades total damage for a specific outcome. A called shot
does **70% of the hull damage** it would have done aimed at the ship generally,
and roughly three times the damage to the system you named.

- **Engines** — stop something from running or manoeuvring. Use it on
  Birds-of-Prey before they can disengage.
- **Weapons** — the way to survive a Galor or a D7 you cannot out-damage.
- **Shields** — collapses their regeneration.
- **Warp core** — starts a breach. It is the fastest kill and the least
  survivable for them.

**They do it to you.** Each faction goes for the system its own way of fighting
depends on, and the log says so once — *"IKS Amar is firing on our shields."*
Klingons want your shields down so they can finish it; Cardassians take your
guns away first; Romulans go for your engines so you cannot follow them home;
the Dominion shoot at your warp core because they do not weigh what it costs;
the Borg want your shields flat because that is the door a boarding party comes
through. Reroute power, order repairs, or turn a fresh facing to them.

### Range and weapon types

| Type | Range | Behaviour |
|---|---|---|
| Beam | 900 | Gentle falloff. Works at any range you can reach. |
| Cannon | 620 | Punishing up close, useless past its range. |
| Torpedo | 1200 | Tracks; no falloff; pierces shields; limited ammunition. |

Range rings are drawn around your ship on the tactical display.

### Warp core breach

A destroyed warp core starts a countdown, shown in the overlay. **Eject the
core** stops it. The cost is your warp drive and most of your power budget
until you dock. Take it — the alternative is the countdown finishing.

### Fires and crew

Hard hits start fires. Fires burn hull and kill crew every second until
damage control reaches them, and damage control runs on auxiliary power. If
you have stripped auxiliary to feed the guns, your fires burn longer.

Crew losses are permanent for that voyage and are written to your record.
Docking replaces the complement; it does not undo the names.

---

## Bridge officers

Each officer has four traits that do real work:

- **Expertise** — skill in their department; shortens their cooldowns.
- **Discipline** — how exactly they execute an order they disagree with.
- **Daring** — willingness to attempt something with poor odds.
- **Candour** — how bluntly they tell you the order is wrong.

An officer with high candour and low discipline can **refuse an order**
outright if it is ethically serious enough. That is a feature.

Officers hold abilities on cooldowns — Attack Pattern Alpha, Emergency Power
to Shields, Damage Control Teams, Tachyon Sweep, Jam Sensors, and others.
Each is available as a tap and as a spoken order (`attack pattern alpha`).
Officers can be trained in new abilities from the Crew screen; it costs a day.

Officers can be injured on away missions, and they can be killed. Dead is
dead — they do not come back, and their station stays empty.

---

## Away teams

You choose who beams down. Skill checks lean on the relevant officer's traits
and can injure or kill them. Security personnel absorb the first casualties,
which is exactly as grim as it sounds. The captain may lead personally: it
improves the roll and puts you in the casualty pool.

---

## Exploration

The galaxy is a real graph with real distances in light-years. Charted lanes
are faster; going direct off the lanes costs a 15% navigational penalty.

Travel consumes **stardate time** and **antimatter**. Higher warp is
superlinearly thirstier — warp 8 across the Federation is expensive, and
running dry a long way from a dock is a genuine problem.

Some systems are hazardous to sit in. The Badlands will tear plasma across
your hull while you loiter; Wolf 359 still has debris in a slow orbit.

---

## The machine shop

Wrecks give up **stores** — duranium, isolinear circuitry, deuterium, salvage.
Stores become things, if you have the hours.

| | |
|---|---|
| **Hull patch** | 5 hours. Ugly, and it holds. |
| **Torpedo casings** | 9 hours. Beats an empty magazine. |
| **Sensor pallet** | 2 days. You can see again. |
| **EPS bypass** | 20 minutes and a lot of swearing. |
| **Graviton charge** | 6 hours. Moves something that does not want to move. |
| **Sensor decoy** | 14 hours. A replacement ion pod. |
| **Rotating harmonics** | 3 hours. Does not last, and works. |
| **Coolant purge** | 1 hour. Puts fires out, costs you the coolant. |

One bench and one chief engineer, so one job at a time. Those hours run on the
commission clock — a two-day job is two days whether the app is open or not,
and you can order the shop to put the hours in rather than wait for them.

`"Build a hull patch"`, `"can you rig an EPS bypass"`, `"make torpedoes"`,
`"strip the wreck"`, `"how much longer"` — all of it works typed.

## When there is nothing to shoot

Some encounters are traps rather than fights. **Engage is not on the menu and
withdrawing does not work.** There are exactly three ways out:

- **A device you built in advance.** The clean exit — if you thought of it
  before you needed it. This is the reason to spend six hours on a graviton
  charge while nothing is wrong.
- **Everything to one channel.** Dump the grid into engines or auxiliary.
  Costs antimatter and unbalances the ship.
- **Ride it out.** Costs hours, and sometimes hull.

That is the whole design: the interesting decision is the one you made an hour
earlier, when there was no emergency and building something seemed like a waste
of six hours.

## The Kobayashi Maru

It is in your record screen from the first day, and **it cannot be won by
fighting.** Three cruisers, no escape course, three hundred and eighty-one
people on a freighter you should not be near. That is not a difficulty value
to be tuned around — it is what the exercise is for.

Which is why **the difficulty setting does not reach inside it.** The simulator
runs the same program for a cadet and a fleet admiral: the same three ships,
the same hulls, and your own ship flying as designed rather than with whatever
the ladder normally hands you. Nobody in it breaks off, either. It is an
exercise, and an exercise you can turn down is not one.

There is a way out. You do not have it yet.

**What it costs.** Tier 5 standing with the Klingon Empire, and a ledger that
shows they have actually met you — six encounters, of any kind. Sparing a crew
and destroying one both count; only indifference does not. That is most of a
five-year commission.

**How it works.** Force a channel open with a commander who has no intention of
answering. Then the order line stops parsing orders, and **whatever you type is
what you say.** No menu. No options list.

What you say is scored against your record:

| Saying | Worth | Only if |
|---|---|---|
| Naming yourself | +3 | Your standing is tier 5 |
| Invoking your record | +2 | You have four encounters on file |
| The crews you spared | +2.5 | You have spared at least two |
| The people aboard | +1.5 | Always — they are really there |
| Offering terms | +2 | You have kept a treaty, or stand at tier 3 |
| Threatening them | **−3** | Always. Do not. |

A claim the record cannot back is not merely worth nothing — it costs, and the
commander says why. *"The commander checks. There is no file. You have done
nothing to us, and nothing for us."*

You need four points. There is more than one way to get them, and none of them
is available to a captain who has not earned it.

## Consequences

The consequence ledger is the spine of the game. It is never rolled back.

- **Crew and officers who die stay dead.**
- **Ships you destroy stay destroyed**, and their faction remembers.
- **Colonies saved or lost** change which missions exist later.
- **Prime Directive violations accumulate.** Three of them convene a board of
  inquiry, and promotion is suspended until it reports.
- **Reputation gates the map** — who fires on sight, who lets you dock, which
  episodes open.
- **Damage persists** until you reach a starbase.

Your service record is scored continuously and read aloud at the end.

### How a commission ends

There are three ways off the bridge, and only one of them is good.

- **You serve the five years.** On day 1,826 the ship is ordered home and
  command passes to relief. This is a *completion*, and the screen says so —
  the record closes and is assessed on the same bands a promotion board uses.
  Finishing is not worth service points of its own: what the five years were
  worth is already in the record.
- **You lose the ship twice.** The first loss costs standing and brings a board
  of inquiry and a replacement hull. Starfleet does not hand out a third.
- **You strand her.** Dry tanks, no berth, and nothing affordable next door is
  the end of the commission, for the same reason losing the hull is.

Reaching the last day with empty tanks is a completion, not a stranding. You
served the time; getting the ship home is the fleet's problem.

---

## Talking instead of shooting

Hailing is a real alternative, and different factions respond to different
things:

- **Klingons** respect firmness and are insulted by pleading. Fighting well
  while losing raises their opinion of you.
- **Ferengi and Orions** have a price and no embarrassment about it.
- **Romulans** are hard to reach and react badly to threats.
- **Cardassians** will negotiate at length and honour the terms precisely.
- **The Borg and the Jem'Hadar do not answer.** Do not waste the seconds.

Shooting first is remembered and makes every subsequent hail harder.

---

## How outcomes are decided

Your captain is a role-playing character sheet — ability scores, proficiency,
feats, levels, the lot. But nothing in play rolls a twenty-sided die.

Every uncertain action — an away team forcing a door, a negotiation, a science
analysis — produces a **margin**: your capability against the difficulty, plus
a bounded random swing.

```
Science analysis: +6.2 — success
Science +4  ·  Proficiency +3  ·  T'Pren +5  ·  Hazardous −4
```

The arithmetic is always shown, and always itemised: which ability, which
proficiency, which officer, which circumstance. Nothing is hidden. What you get
back is not just whether it worked but *how comfortably*, and everything
downstream reads that margin.

**Why not a die.** A d20 is flat: every face is equally likely, which means a
brilliant officer fumbles routine work one time in twenty forever, and no amount
of expertise ever changes that. It also throws away information — a failure by
one point and a failure by fifteen are the same failure. The margin fixes both.

- **Being better makes you reliably better.** A capable captain is not 30%
  more likely to succeed at a hard task than an incompetent one; they are
  several times more likely.
- **Training makes you consistent, not merely strong.** A veteran's outcomes
  cluster tightly around what they are capable of. This is the thing a flat die
  cannot express at all.
- **Nothing is ever certain.** The swing is bounded but never zero. Hopeless
  work occasionally comes off; trivial work is occasionally fumbled.
- **Advantage** takes the better of two swings, **disadvantage** the worse.
  They cancel each other exactly.
- **The size of the margin drives the consequences.** A comfortable success is
  nearly free. A disastrous failure gets people killed.

### Your six abilities

| Ability | Governs |
|---|---|
| **Command** | Officer cooldowns, crew morale, rally effects, contested wills |
| **Tactics** | Weapon accuracy, critical chance, boarding actions |
| **Engineering** | Repair speed, power routing, warp efficiency, jury-rigging |
| **Science** | Scans, anomalies, cloak detection, technical solutions |
| **Medicine** | Casualty rates, officer recovery, away-team survival |
| **Diplomacy** | Hails, negotiations, first contact, reputation gains |

Scores run 1–20. The modifier is `(score − 10) ÷ 2`, rounded down — so 14 is
+2, 8 is −1. **Proficiency** adds a further +2 to +6 depending on your level,
on the two abilities your career trained you in.

Ability scores are not only for away missions: Tactics feeds your ship's
accuracy and critical chance, Engineering feeds repair rate and shield
regeneration, Science feeds cloak detection.

---

## Building a captain

Nine steps, none of them cosmetic.

**Difficulty** — see below.

**Species** — shifts ability scores and grants a permanent trait. Vulcans get
advantage on every Science check and are immune to fear. Andorians get
advantage on Tactics and harder criticals. Trill start with an extra
proficiency. Denobulans cut casualties by a quarter.

**Origin** — where you were raised. Smaller bonuses, one lasting perk. Frontier
Colony makes field repairs 30% better; Occupied World gives advantage while
outnumbered; Starfleet Family starts you a rank higher with the scrutiny to match.

**Career** — grants proficiency in two abilities and a **signature power** usable
once per engagement. Engineering's *Miracle Worker* restores 30% hull instantly.
Science's *Insight* reveals every enemy weakness and grants advantage for 20
seconds. Intelligence's *Prior Knowledge* lets you act before the enemy does.

**Abilities** — 27-point buy, 8 to 15, before species and origin. The standard
array is one tap if you would rather not do arithmetic.

**Traits** — up to two, and each is a real trade rather than a bonus:

- *Maverick*: advantage on anything the regulations forbid — Prime Directive violations cost double.
- *Reckless*: your ship shoots straighter — and your landing parties pay for it.
  A flat accuracy bonus in a fight, and disadvantage on any away-team check made
  against a **dangerous** or **extreme** hazard. Routine and elevated work is
  unaffected: a saving throw is a reaction to danger, not every skilled action.
- *Haunted*: disadvantage on Command below 25% hull — and +3 on everything else.
- *Idealist*: double reputation from peace, double standing loss from kills.
- *Notorious*: enemies break off sooner out of fear; every Diplomacy check is at disadvantage.

**Feats** — chosen on promotion, on the Captain screen. *Tactical Genius* crits
on 19–20. *Master Engineer* lets you recover an ejected core. *Survivor* lets
you live through what would destroy the ship, once per commission.

### Signature powers

Your career grants one large effect, usable **once per engagement**. It is on
the Tactical screen under *Captain*, and it recharges when the next fight
starts.

| Career | Power | Effect |
|---|---|---|
| Command | Take the Conn | Every bridge officer cooldown clears at once |
| Tactical | Called Shot | The next hit that lands is a guaranteed critical on a subsystem |
| Engineering | Miracle Worker | Restores 30% hull and puts every fire out |
| Science | Insight | Reveals the target's weakest facing; accuracy and criticals up for 20s |
| Medical | Triage | A wounded officer returns to duty; casualties halved for 30s |
| Diplomatic Corps | Parley | Forces a hearing from a faction whose doctrine refuses the channel — including the Jem'Hadar |
| Intelligence | Prior Knowledge | Every hostile loses six seconds of weapon cycle; you gain accuracy and defence |

Parley is the only way to get the Dominion to answer at all. It buys a
conversation, not agreement.

---

## Difficulty

Twelve rungs, named up the real commissioned-officer ladder. This is the
difficulty of the game, not your character's rank — you command a starship
either way.

**Story · Cadet · Ensign · Lieutenant · Lieutenant Commander · Commander ·
Captain · Commodore · Rear Admiral · Vice Admiral · Admiral · Fleet Admiral**

What actually changes:

- **Story** — nothing is permanently lost, the ship cannot be destroyed, and
  failed rolls of 1 are re-rolled twice. The episodes without the arithmetic.
  Losing the ship is not free, though: salvage crews bring her back under tow
  at 30% hull, no shields and a quarter magazine, and the loss goes into the
  record. You keep your commission, not your paintwork.
- **Cadet** — officers can be wounded but not killed.
- **Ensign** — permadeath and ship loss switch on.
- **Lieutenant** — the intended experience. No thumb on the scale either way.
- **Commodore and above** — ironman. Permadeath, the ship can be lost, and
  the record cannot be taken back: importing an earlier export of the
  commission you are flying is refused. Restoring onto a device with no
  commission on it, or importing a different captain's record, still works —
  that is a backup, not an undo.
- **Fleet Admiral** — the same ironman rules as Commodore up, with every number
  at its worst: the widest target-number shift, the thirstiest engines, the
  least out of a wreck, and nobody breaking off a fight.

Target numbers shift with difficulty too: −3 on Story, +8 at Fleet Admiral.

The difficulty curve leans on **being outnumbered** rather than on enemies
becoming damage sponges. A single same-tier opponent stays beatable at every
rung — that is a tested guarantee, not a claim. What changes at the top is that
patrols stop arriving one at a time: a lone raider stays lone until Vice
Admiral, but a three-ship patrol becomes six by Fleet Admiral.

Two same-tier ships is roughly a four-to-one disadvantage, not two-to-one —
they concentrate fire while you divide yours. That fight is one to **break
off**, not win. `get us out of here` starts an eight-second warp-out, and it
works: disengaging is a real outcome, not a failure state.

### What turns up, and how much of it

A patrol is an amount of force, not a number of hulls, and the amount comes
from how much of that faction is where you are. Klingons are a token presence
at Andor and the whole navy at Qo'noS, so an encounter with the same name means
a very different fight in each place.

The hulls follow from the same arithmetic. Light ships arrive in packs because
that is the only way they matter — three Orion raiders are nine times one, not
three — and capital ships arrive alone or with escorts lighter than themselves.
You will meet two Birds-of-Prey where you would meet one D7, and four raiders
where you would meet one Galor.

Fly something heavier and the answer gets heavier, in proportion to how much
attention the locals were paying in the first place. A dreadnought over the
Klingon homeworld draws a fleet; the same ship at Andor draws the same bored
scout a shuttle would.

And roughly one encounter in twelve is drawn without regard to any of that.
That is where the Borg cube lives, and the Negh'Var that has no business being
on a border. Read the odds on the tactical display before you commit — that
line exists for exactly these.

---

## Reputation

Two separate things, deliberately not merged:

**Standing** is how a faction feels about you *right now*. It moves both ways,
fast, and decides who fires on sight. It is on the Record screen.

**Reputation** is what you have *earned* over a career. It only ever rises, it
advances through six tiers — Unknown, Recognised, Acknowledged, Trusted,
Honoured, Exemplar — and it accrues a currency you spend on **projects**.

You can be deeply respected by the Klingon Defence Force and still be shot at
this week for a border violation. That distinction is the point: fighting well
while losing *earns Klingon reputation* even as destroying their ships costs
you Klingon standing.

Each power has its own track, its own currency, and its own shop:

| Power | Currency | Earned by |
|---|---|---|
| Starfleet Command | Commendations | Missions, first contact, treaties, saved colonies |
| Klingon Defence Force | Marks of Honour | Fighting well, especially while losing |
| Romulan Star Empire | Tokens of Regard | Respecting borders, honourable releases |
| Cardassian Union | Writs of Accord | Agreements honoured precisely |
| Ferengi Alliance | Bars of Latinum | Trade, escorts, and paying up |
| Unaligned Worlds | Letters of Thanks | Distress calls nobody made you answer |

Projects grant real things: consoles, torpedo resupply, a **loaned Romulan
cloaking device** at Trusted, free passage through Klingon space, a Federation
escort that joins your engagements, and titles that follow your name.

---

## Progression

Ensign through Admiral. Experience comes from combat, exploration,
diplomacy, and completed episodes. Each promotion grants skill points and
unlocks heavier hulls at any shipyard.

Skill points buy real modifiers — a rank in Beam Weapons is +6% phaser damage
in the actual damage formula. Consoles do the same job and can be swapped at
a starbase without spending points.

You can respec at a starbase.

---

## The seed

Every galaxy is generated from a single 64-bit seed, stored in your save. The
same seed always produces the same galaxy, the same encounters, and the same
dice. Enter one at captain creation to play someone else's exact game, or
leave it blank for a new one. It is shown in **Setup → About**.
