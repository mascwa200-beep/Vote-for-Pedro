# Captain's Manual

Everything on this page is a real control that changes real numbers in the
simulation. Nothing here is decoration.

---

## Giving orders

There are two ways to do anything, and they are equivalent. Tap the LCARS
panels, or type an order into the bar at the bottom of the screen.

The parser is forgiving. It strips forms of address, accepts number words or
digits, and only needs the verb plus whatever that verb requires:

```
Helm, set course for Vulcan, warp eight
warp 8 vulcan
Mister Sulu, all stop
target their warp core
divert power to shields
red alert
```

Officers acknowledge in their own register. A blunt officer will tell you an
order is a mistake; a disciplined one will log a reservation and carry it out
anyway. That is driven by their trait values, not a script.

### Navigation

| Order | Effect |
|---|---|
| `set course for <system>, warp <n>` | Plots and engages. Costs stardate time and antimatter. |
| `take us to <system>` / `head for <system>` | Same thing. |
| `all stop` | Throttle to zero. |
| `ahead full` / `ahead one third` / `ahead 40 percent` | Impulse throttle. |
| `come about` | Turn to face the current target. |
| `come to bearing 090` | Turn to an absolute bearing. |
| `evasive manoeuvres` | Defence up, turn rate up, accuracy down. |
| `get us out of here` | Begin an eight-second warp-out. They get those eight seconds. |
| `request docking` | Full repair and resupply, where facilities exist. |

### Alert and shields

| Order | Effect |
|---|---|
| `red alert` / `yellow alert` / `stand down` | Alert state, ambience, and haptics. |
| `shields up` / `lower shields` | Shields cannot regenerate while down. |
| `reinforce forward shields` | Drains the other three facings into that one. |

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

### Shields have four facings

Fore, aft, port, and starboard are tracked independently. Damage lands on the
facing it arrives on. A shot that comes in over the bow does nothing to your
aft shield, and once a facing is down, everything on that side reaches the
hull directly.

This is why **turning matters**. When one facing is stripped, present a fresh
one. The AI does this too — a damaged cruiser will deliberately show you its
strongest side.

Even a healthy shield bleeds about 8% of every hit through to the hull.
Torpedoes pierce a further 25% on top of that, which is their entire purpose:
they are how you hurt something whose shields you cannot break.

### Subsystem targeting

Targeting a subsystem trades total damage for a specific outcome:

- **Engines** — stop something from running or manoeuvring. Use it on
  Birds-of-Prey before they can disengage.
- **Weapons** — the way to survive a Galor or a D7 you cannot out-damage.
- **Shields** — collapses their regeneration.
- **Warp core** — starts a breach. It is the fastest kill and the least
  survivable for them.

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
