// Episodes 9-16: the Neutral Zone, Cardassian space, and the dark past the relays.

/**
 * Where a stage goes when what the captain knows should decide it.
 *
 * `next` has accepted a function — `(mission, applied) => stageId` — since the
 * mission engine was written, and nothing in sixteen episodes had ever passed
 * one. It is the only way a stage can read `mission.vars`, so all nine of the
 * variables episodes set were written, serialised into the save file, and read
 * by nothing at all.
 *
 * These are here rather than inline so the routing reads as a decision with a
 * name, and so a test can hold one.
 */
const onVar = (key, ifSet, ifNot) => {
  const route = (m) => (m.vars[key] ? ifSet : ifNot);
  // Both places it can go, declared.
  //
  // A function is opaque, and the thing the episode graph is checked for is
  // that no route points at a stage that does not exist — the check that
  // catches a renamed stage. Rather than exempting dynamic routing from it,
  // the routing says where it can land and stays checkable. See
  // `tests/sim.test.js` "every episode is structurally sound".
  route.targets = [ifSet, ifNot];
  route.reads = key;
  return route;
};

/** The nine-second gap in a Borg cube's shield harmonics, if we found it. */
const withWindow = onVar('has_window', 'engage_window', 'engage');

/**
 * Which room the board convenes in, read off the record it convened about.
 *
 * `Ledger.assessment()` already exists and already bands a service score —
 * `rules/inquiry.js` decides its finding on the same six bands, deliberately,
 * so that the screen and the board cannot disagree about the same record. The
 * finale reads them too rather than inventing a seventh answer.
 */
const byRecord = (m) => {
  const a = m.ctx.game.ledger.assessment();
  if (a.id === 'exemplary' || a.id === 'distinguished') return 'commended';
  if (a.id === 'censure' || a.id === 'concerning' || a.id === 'inquiry') return 'censured';
  return 'questioned';
};
byRecord.targets = ['commended', 'questioned', 'censured'];

/** Waiting for a cloaked ship to move first, with the sensors cold. */
const whoSeesWhoFirst = onVar('running_silent', 'sighted', 'ambushed');

export const FRONTIER_EPISODES = [
  // -------------------------------------------------------------------------
  {
    id: 'outpost_silence', title: 'The Silence at Outpost 4', system: 'neutral_zone_1', act: 2,
    summary: 'Four listening posts along the Neutral Zone have stopped answering.',
    stages: {
      start: {
        text: 'Outpost 4 does not answer. Neither does 5, 7, or 8. Long-range shows Outpost 4 still there — but the mass reading is wrong. Not damaged. Excavated. Something scooped a hundred metres of asteroid out of it and left the rest.',
        speaker: 'Science',
        choices: [
          { id: 'approach', label: 'Approach at yellow alert', next: 'approach',
            effects: { xp: 200 } },
          { id: 'silent', label: 'Approach silent — passive sensors only', next: 'approach',
            effects: { xp: 350, setVar: { running_silent: true }, flag: 'ran_silent' } },
        ],
      },
      approach: {
        text: 'The outpost is a shell. And on the very edge of sensor range, something is moving without registering — a distortion, not a contact. Your science officer has seen the theoretical papers on this and did not believe them.',
        speaker: 'Science',
        choices: [
          // A tachyon sweep for a cloak nobody has confirmed exists is the
          // most science-officer thing in the game, and it worked every time
          // it was pressed. The gate decided whether the button was THERE; the
          // check decides whether the sweep resolves the distortion before the
          // distortion resolves you.
          //
          // Failure goes to `ambushed`, which the episode already had for
          // exactly this — "It moves first" — and which until now only the
          // `wait` branch could reach. Flooding the area announces the ship
          // that flooded it, so a sweep that fails is worse than no sweep.
          { id: 'tachyon', label: 'Flood the area with tachyons',
            requires: { skill: 'sensors', ranks: 1 },
            effects: { check: { type: 'science', difficulty: 0.5, hazard: 'elevated' }, xp: 400 },
            branch: { success: 'revealed', failure: 'ambushed' } },
          { id: 'wait', label: 'Hold position and wait for it to move first', next: whoSeesWhoFirst,
            effects: { xp: 200 } },
          { id: 'withdraw', label: 'Withdraw and report', outcome: 'reported',
            effects: { xp: 500, record: { anomaly_catalogued: 1 }, flag: 'romulan_cloak_reported',
              standing: { federation: 8 } } },
        ],
      },
      revealed: {
        text: 'It resolves: a Romulan vessel, cloaked, holding station over what is left of the outpost. Their commander appears on the screen looking mildly annoyed to have been seen at all.',
        speaker: 'Romulan commander',
        choices: [
          { id: 'hail', label: 'Demand an explanation', next: 'negotiate',
            effects: { xp: 300 } },
          // All four roads out of this episode's fights end at `battle`, and
          // `battle` opens "The warbird is dead in space, venting, and its
          // commander is still alive on an open channel. He asks you not to
          // board." A commander who can ask anything is aboard a hull that was
          // stopped, not emptied — so every one of those fights is a `disable`.
          { id: 'fire', label: 'Fire before they can cloak again', next: 'battle',
            effects: { combat: { faction: 'romulan', ships: ['warbird'], objective: 'disable' },
              standing: { romulan: -25 }, flag: 'fired_first_neutral_zone',
              record: { violated_border: 1 } } },
        ],
      },
      ambushed: {
        text: 'It moves first. The first shot takes the forward shields to nothing before the alert klaxon finishes its first cycle.',
        speaker: 'Tactical',
        choices: [
          { id: 'fight', label: 'Return fire', next: 'battle',
            effects: { combat: { faction: 'romulan', ships: ['warbird'], objective: 'disable' },
              damage: 0.15 } },
        ],
      },
      sighted: {
        // The other half of `running_silent`. A ship that came in on passive
        // sensors and then held still is the one doing the watching, and the
        // variable that recorded the choice was read by nothing.
        text: 'Nothing radiates. Nothing pings. And after nineteen minutes of a silence your crew is holding rather than keeping, the distortion moves — across your bow, unhurried, with no idea you are there.',
        speaker: 'Science',
        choices: [
          { id: 'fire', label: 'Fire now, into where it has to be', next: 'battle',
            effects: {
              // Decloaked and not expecting it. The warbird is the same ship;
              // it simply has not raised anything yet.
              combat: {
                faction: 'romulan', ships: ['warbird'], shieldsAt: 0.15, objective: 'disable',
              },
              xp: 700, standing: { romulan: -20 }, flag: 'fired_first_neutral_zone',
            } },
          { id: 'watch', label: 'Let it go and follow it', next: 'revealed',
            effects: { xp: 800, record: { anomaly_catalogued: 1 } } },
        ],
      },
      negotiate: {
        text: 'He does not deny it. He explains, with something close to regret, that the outposts were a test of a weapon his Praetor required tested, that he chose the emptiest targets available, and that he expects you will now try to stop him leaving.',
        speaker: 'Romulan commander',
        choices: [
          { id: 'let_go', label: 'Let him go. Report the weapon', outcome: 'reported',
            effects: { xp: 900, record: { anomaly_catalogued: 2 }, standing: { romulan: 10, federation: 6 },
              flag: 'romulan_cloak_reported' } },
          // "Stop him" is the order, and he has just said he expects you to
          // try to stop him leaving. Stopping is not killing.
          { id: 'stop', label: 'Stop him', next: 'battle',
            effects: { combat: { faction: 'romulan', ships: ['warbird'], objective: 'disable' } } },
        ],
      },
      battle: {
        text: 'The warbird is dead in space, venting, and its commander is still alive on an open channel. He asks you not to board — his crew will not survive capture, and neither will his ship’s secrets.',
        speaker: 'Romulan commander',
        choices: [
          { id: 'board', label: 'Board and take the cloaking device', outcome: 'captured',
            effects: { xp: 1400, item: 'sensor_array', standing: { romulan: -30, federation: 20 },
              record: { lives_lost: 300 }, flag: 'captured_cloak' } },
          { id: 'honour', label: 'Honour the request. Stand off', outcome: 'honoured',
            effects: { xp: 1000, standing: { romulan: 20, federation: 4 }, flag: 'spared_warbird' } },
          { id: 'destroy', label: 'Destroy it', outcome: 'destroyed',
            effects: { xp: 700, standing: { romulan: -35 }, record: { lives_lost: 1500 } } },
        ],
      },
    },
    start: 'start',
    endings: {
      reported: { label: 'Intelligence delivered',
        text: 'Starfleet now knows the cloak is real. Four outposts and their crews paid for that.' },
      captured: { label: 'Device captured',
        text: 'Engineering has a Romulan cloaking device and no idea what the Empire will do about it.' },
      honoured: { label: 'Let them go',
        text: 'He does not thank you. Some years later, that decision comes back in your favour.' },
      destroyed: { label: 'Destroyed with all hands',
        text: 'Fifteen hundred dead. The Empire will want a name, and it will have yours.' },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'devron_anomaly', title: 'The Devron Anomaly', system: 'devron', act: 3, minRank: 6,
    summary: 'Something inside the Neutral Zone is contradicting the sensors, and the past tense.',
    stages: {
      start: {
        text: 'The Devron system holds a spatial anomaly roughly six hundred million kilometres across that, according to three independent scans, is getting larger going backwards in time. Your science officer has asked you twice to confirm you want that in the log.',
        speaker: 'Science',
        choices: [
          { id: 'probe', label: 'Launch a probe into it', next: 'probe',
            effects: { xp: 300 } },
          { id: 'enter', label: 'Take the ship in', next: 'inside',
            effects: { xp: 400, damage: 0.08, setVar: { entered: true } } },
          { id: 'leave', label: 'This is above our pay grade. Withdraw', outcome: 'withdrew',
            effects: { xp: 250, record: { anomaly_catalogued: 1 } } },
        ],
      },
      probe: {
        text: 'The probe’s telemetry arrives four seconds before it is launched. The data is coherent, internally consistent, and describes a convergence — three separate energy events at the same coordinates in three different centuries.',
        speaker: 'Science',
        choices: [
          { id: 'enter', label: 'Take the ship in', next: 'inside',
            effects: { xp: 500, damage: 0.06 } },
          { id: 'report', label: 'Transmit everything to Starfleet and withdraw', outcome: 'catalogued',
            effects: { xp: 900, record: { anomaly_catalogued: 4 }, standing: { federation: 12 },
              flag: 'devron_data' } },
        ],
      },
      inside: {
        // The speaker has been 'Engineering' since this was written, and the
        // scene is a chief engineer standing at a core he does not want to run
        // that hard. Nothing in this episode starts a fight, so the walk down
        // is always available — which is the check every placement has to pass,
        // because `mayWalk` refuses in combat and a scene in a compartment the
        // captain cannot reach is a stranded episode.
        //
        // The stage after it stays on the bridge, and the walk back up is
        // deliberate rather than an oversight: `pulse` says "nobody ON THE
        // BRIDGE is entirely certain what just did not happen", so that is
        // where it happens. You run the core hot from the engine room and you
        // go back up to find out what you did.
        where: 'engineering',
        text: 'Inside, the ship’s chronometers disagree by eleven minutes and the structural integrity field is fighting something it was not designed for. There is a way to collapse it — an inverse tachyon pulse — and it will require the warp core running at a level the chief engineer describes as "a very bad idea, Captain."',
        speaker: 'Engineering',
        choices: [
          { id: 'pulse', label: 'Do it', next: 'pulse',
            requires: { skill: 'warp_theory', ranks: 2 },
            effects: { xp: 800, damage: 0.2 } },
          { id: 'retreat', label: 'Get us out', outcome: 'catalogued',
            effects: { xp: 500, damage: 0.1, record: { anomaly_catalogued: 2 } } },
          // A ship that took the probe's telemetry first knows where the
          // convergence is; a ship that flew straight in is finding out. Only
          // the second one has to do this the hard way, and `entered` recorded
          // which it was and was read by nothing.
          { id: 'blind', label: 'Run the pulse off the ship’s own readings', next: 'pulse',
            requires: { var: { entered: true } },
            effects: { xp: 1000, damage: 0.34, flag: 'devron_blind' } },
        ],
      },
      pulse: {
        text: 'The pulse goes out. The anomaly does not collapse so much as stop having been there. The chronometers agree again. Nobody on the bridge is entirely certain what just did not happen.',
        speaker: 'Science',
        choices: [
          { id: 'log', label: 'Log everything, however it reads', outcome: 'collapsed',
            effects: { xp: 2000, record: { anomaly_catalogued: 6 }, standing: { federation: 20 },
              flag: 'devron_collapsed', item: 'eps_conduits' } },
        ],
      },
    },
    start: 'start',
    endings: {
      collapsed: { label: 'Anomaly collapsed',
        text: 'Starfleet Science reads the report four times and sends a team. They find nothing at all, which is the point.' },
      catalogued: { label: 'Catalogued', text: 'The data is filed. The anomaly is still there.' },
      withdrew: { label: 'Withdrew', text: 'Somebody else will have to answer that one.' },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'badlands_run', title: 'Run Through the Badlands', system: 'badlands_1', act: 3,
    summary: 'A medical convoy has to cross the plasma storms, and something is waiting in them.',
    stages: {
      start: {
        text: 'Six thousand doses of a vaccine Bajor needs inside forty hours, and the only route in time is through the Badlands. Plasma storms, no sensors past two thousand kilometres, and a standing advisory against exactly this.',
        speaker: 'Bridge',
        choices: [
          // No `setVar` here. `escorting` was set on this choice and this
          // choice is the only way into the stage that would have read it, so
          // it was true at every point it could ever have been tested — a
          // variable that distinguishes nothing. Deleted rather than given a
          // reader, because there is nothing for a reader to learn from it.
          { id: 'go', label: 'Take the convoy through', next: 'inside',
            effects: { xp: 300 } },
          { id: 'long', label: 'Take the long route. They can wait', outcome: 'late',
            effects: { xp: 150, time: 3, record: { lives_lost: 900 }, standing: { federation: -8 } } },
        ],
      },
      inside: {
        text: 'Two hours in, a storm front takes out the lead freighter’s shields, and sensors pick up three impulse signatures moving in formation. Nobody flies formation in here by accident.',
        speaker: 'Tactical',
        choices: [
          // The convoy is in the fight now.
          //
          // The order is "put the ship between them and the convoy" and the
          // stage it leads to opens "The Galor breaks off. The convoy is
          // intact" — an assertion about six ships that were not on the board.
          // Whatever the captain did, the freighters could not be hit, could
          // not be lost, and the line was true before the fight started.
          { id: 'shield', label: 'Put the ship between them and the convoy', next: 'fight',
            effects: {
              combat: {
                faction: 'cardassian', ships: ['galor'], objective: 'protect',
                // ONE hull, and the count is forced rather than chosen.
                // `settle` fails a protect objective only when EVERY escort is
                // dead, so with a convoy of three the fight is still won when
                // two of them burn — and the stage this leads to would then
                // say "The convoy is intact" over two wrecks. One ship makes
                // both outcomes exactly true: she lives and the line is right,
                // or she does not and the episode ends saying so.
                escort: ['freighter'],
                failedOutcome: 'lost',
              },
              damage: 0.1, xp: 400,
            } },
          // Leading six loaded freighters into a plasma front at full impulse,
          // to shake off three Cardassian hulls, and only your ship comes out
          // flying — every time it was pressed. Six thousand doses delivered on
          // a button. The skill gate decided whether the manoeuvre was OFFERED;
          // nothing decided whether it worked.
          //
          // `engineering`, because what is being asked is whether the
          // structural integrity fields hold through the differential — the
          // same thing the scene says killed the Cardassians.
          { id: 'storm', label: 'Lead them into the storm front',
            requires: { skill: 'impulse_thrusters', ranks: 2 },
            effects: { check: { type: 'engineering', difficulty: 0.55, hazard: 'dangerous' }, xp: 300 },
            branch: { success: 'storm', failure: 'storm_bad' } },
          { id: 'scatter', label: 'Order the convoy to scatter', next: 'scatter',
            effects: { xp: 200 } },
        ],
      },
      storm_bad: {
        // The manoeuvre works on the Cardassians and not on the convoy. That
        // is the honest failure: it was always the freighters that could not
        // take the differential, and your ship was never the one at risk.
        text: 'The Cardassian hulls break off, and so do two of ours. A loaded freighter is not a '
          + 'starship and the differential does not care which flag is on it — Ekaterina Voss goes '
          + 'first, and the Tobruk eleven minutes later, and there is no going back in for either '
          + 'of them. Four ships come out the other side and the Badlands keep the rest.',
        speaker: 'Helm',
        choices: [
          { id: 'continue', label: 'Reform what is left and continue', outcome: 'partial',
            effects: {
              xp: 700,
              record: { lives_saved: 4000, lives_lost: 22, distress_answered: 1 },
              standing: { federation: 6, cardassian: -8 },
              flag: 'badlands_run',
            } },
        ],
      },
      storm: {
        text: 'You take them into the worst of it at full impulse, and only one ship comes out the other side flying. It is yours. The Cardassian hulls could not take the differential.',
        speaker: 'Helm',
        choices: [
          { id: 'continue', label: 'Reform the convoy and continue', outcome: 'delivered',
            effects: { xp: 1200, record: { lives_saved: 6000, distress_answered: 1 },
              standing: { federation: 15, cardassian: -8 }, flag: 'badlands_run' } },
        ],
      },
      scatter: {
        text: 'They scatter. Four make it out. Two do not, and one of those was carrying half the doses.',
        speaker: 'Communications',
        choices: [
          { id: 'continue', label: 'Continue with what is left', outcome: 'partial',
            effects: { xp: 600, record: { lives_saved: 3000, lives_lost: 24 },
              standing: { federation: 4 } } },
        ],
      },
      fight: {
        text: 'The Galor breaks off. The convoy is intact, and your port nacelle is not.',
        speaker: 'Engineering',
        choices: [
          { id: 'continue', label: 'Continue to Bajor', outcome: 'delivered',
            effects: { xp: 1000, record: { lives_saved: 6000, distress_answered: 1 },
              standing: { federation: 12, cardassian: -10 } } },
        ],
      },
    },
    start: 'start',
    endings: {
      delivered: { label: 'Delivered', text: 'Bajor gets its vaccine with three hours to spare.' },
      partial: { label: 'Partially delivered', text: 'Half the doses. The triage decisions are somebody else’s now.' },
      late: { label: 'Arrived late', text: 'The long route was safe. Nine hundred people did not have that long.' },
      // Reachable only by losing the convoy in the fight, which is a thing that
      // could not happen until the freighters were put on the board.
      lost: {
        label: 'The convoy was lost',
        text: 'You came out of the Badlands alone, with your shields holding and nothing behind you. '
          + 'Six thousand doses are scattered across four hundred kilometres of plasma front. '
          + 'Bajor is told by somebody else.',
      },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'cardassian_treaty', title: 'The Terms at Deep Space 9', system: 'terok_nor', act: 3, minRank: 6,
    summary: 'Cardassia wants to renegotiate the border, and has brought an argument in orbit.',
    stages: {
      start: {
        text: 'Gul Torvan has come to renegotiate the demilitarised zone, and has brought two Galors to help him think. He is polite, precise, and has already found a clause in the original text that favours him.',
        speaker: 'Gul Torvan',
        choices: [
          { id: 'read', label: 'Read the clause carefully before answering', next: 'clause',
            requires: { skill: 'diplomacy', ranks: 2 }, effects: { xp: 400 } },
          { id: 'concede', label: 'Concede the point and move on', next: 'talks',
            effects: { xp: 150, standing: { cardassian: 8, federation: -6 }, setVar: { conceded: true } } },
          { id: 'refuse', label: 'Refuse to negotiate under guns', next: 'standoff',
            effects: { standing: { cardassian: -10 }, xp: 250 } },
        ],
      },
      clause: {
        text: 'The clause is real. It also has a second half he did not transmit, which voids the first if either party has fortified the zone — and Cardassian sensors have been on that ridge for two years. You have him, and he knows the instant you find it.',
        speaker: 'Gul Torvan',
        choices: [
          { id: 'press', label: 'Press the advantage. Demand withdrawal', next: 'press',
            effects: { xp: 500 } },
          { id: 'quiet', label: 'Raise it privately and let him withdraw the claim', next: 'talks',
            effects: { xp: 700, standing: { cardassian: 14 }, flag: 'torvan_owes_you' } },
        ],
      },
      press: {
        text: 'He withdraws the claim publicly, which costs him. His delegation watches him do it. He agrees to everything you ask and does not look at you once.',
        speaker: 'Gul Torvan',
        choices: [
          { id: 'sign', label: 'Sign', outcome: 'won_terms',
            effects: { xp: 1200, standing: { federation: 20, cardassian: -18 },
              record: { treaty_signed: 1 }, flag: 'dmz_favourable' } },
        ],
      },
      talks: {
        text: 'The rest goes quickly. Both sides get less than they wanted and the zone holds. The document is unglamorous and will be cited for thirty years.',
        speaker: 'Deep Space 9',
        choices: [
          { id: 'sign', label: 'Sign', outcome: 'accord',
            effects: { xp: 1400, standing: { federation: 18, cardassian: 16 },
              record: { treaty_signed: 1 }, flag: 'dmz_accord' } },
          // There are two ways to this table: he withdrew the clause, or you
          // gave it to him. `conceded` recorded which and was read by nothing,
          // so the same signature was worth the same either way. A point
          // conceded in the first hour is still in the text in the last one.
          { id: 'recover', label: 'Take the conceded point back before you sign',
            outcome: 'accord', requires: { var: { conceded: true } },
            effects: { xp: 1700, standing: { federation: 22, cardassian: 4 },
              record: { treaty_signed: 1 }, flag: ['dmz_accord', 'dmz_clause_recovered'] } },
        ],
      },
      standoff: {
        text: 'He withdraws his ships to the edge of the system and waits. So does the negotiation. Nine days later Starfleet sends someone else to do it, and the terms are worse than the ones you were offered.',
        speaker: 'Starfleet Command',
        choices: [
          { id: 'accept', label: 'Accept the outcome', outcome: 'failed',
            effects: { xp: 300, standing: { federation: -12 } } },
        ],
      },
    },
    start: 'start',
    endings: {
      won_terms: { label: 'Favourable terms', text: 'The Federation gains ground. Torvan is recalled and replaced by someone worse.' },
      accord: { label: 'Accord signed', text: 'The zone holds. Neither delegation is happy, which diplomats consider a good sign.' },
      failed: { label: 'Talks collapsed', text: 'Someone else signs a worse document with your name in the margin as the reason.' },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'tholian_border', title: 'The Web at the Border', system: 'tholian_edge', act: 3,
    summary: 'A Federation science vessel drifted over the Tholian line, and the Assembly has begun spinning.',
    stages: {
      start: {
        text: 'The USS Defiant-class survey ship Merrimack drifted eleven thousand kilometres over the Tholian border while running a passive scan. The Assembly has already begun constructing a web around her. Her crew has perhaps ninety minutes.',
        speaker: 'Science',
        choices: [
          { id: 'enter', label: 'Cross the line and pull her out', next: 'inside',
            effects: { xp: 300, standing: { tholian: -12 }, record: { violated_border: 1 } } },
          { id: 'negotiate', label: 'Hail the Assembly', next: 'hail',
            effects: { xp: 250 } },
          { id: 'wait', label: 'Hold at the line and prepare a fast transporter lock', next: 'lock',
            requires: { skill: 'sensors', ranks: 2 }, effects: { xp: 500 } },
        ],
      },
      hail: {
        text: 'The Assembly answers, which is itself unusual. The response is a precise statement of the border violation, the time of the violation, and the schedule on which the web will complete. It is not a threat. It is a timetable.',
        speaker: 'Tholian Assembly',
        choices: [
          // Eighty-two people off a Tholian web for pressing a button. The
          // diplomacy gate decided whether the OFFER existed; whether the
          // Assembly accepted it was never in question, which is a strange
          // thing to say about the Tholians.
          //
          // The check is whether the formal acknowledgement is precise enough
          // to be worth their stopping for. `routine`: nobody is off the ship.
          // Hard, because they answered with a timetable rather than a threat.
          { id: 'apologise', label: 'Acknowledge the violation formally and request release',
            requires: { skill: 'diplomacy', ranks: 3 },
            effects: { check: { type: 'diplomacy', difficulty: 0.6, hazard: 'routine' }, xp: 400 },
            branch: { success: 'released', failure: 'timetable' } },
          { id: 'enter', label: 'Cross anyway', next: 'inside',
            effects: { standing: { tholian: -20 }, record: { violated_border: 1 } } },
        ],
      },
      timetable: {
        // The failure is not refusal. It is being answered exactly, which is
        // worse: they restate the schedule and go on spinning, and the ninety
        // minutes are now sixty.
        text: 'The Assembly receives the acknowledgement. They confirm its receipt, restate the '
          + 'time of the violation to the second, and repeat the schedule on which the web will '
          + 'complete. Nothing in the reply is hostile and nothing in it has changed. Your comms '
          + 'officer says, quietly, that she does not think they were ever going to stop.',
        speaker: 'Tholian Assembly',
        choices: [
          { id: 'cross', label: 'Then we cross the line', next: 'inside',
            effects: { xp: 300, standing: { tholian: -20 }, record: { violated_border: 1 } } },
          { id: 'hold', label: 'Hold at the line', outcome: 'web_closed',
            effects: {
              xp: 400,
              record: { lives_lost: 82 },
              standing: { tholian: 6, federation: -16 },
              flag: 'merrimack_lost',
            } },
        ],
      },
      released: {
        text: 'They stop. The web is left unfinished — a half-lattice hanging in the dark that they do not bother to dismantle. The Merrimack limps back across the line under her own power.',
        speaker: 'Tholian Assembly',
        choices: [
          { id: 'done', label: 'Escort her home', outcome: 'released',
            effects: { xp: 1400, record: { lives_saved: 82, distress_answered: 1 },
              standing: { tholian: 12, federation: 14 }, flag: 'tholian_protocol' } },
        ],
      },
      lock: {
        // Eighty-two people arrive four waves at a time and the captain was on
        // the bridge for all of it. Speaker: 'Transporter Room'.
        where: 'transporter',
        text: 'You hold at the line and your transporter chief does something with a phase discriminator that should not work. Eighty-two people arrive in the cargo bay in four waves. The Merrimack is still inside the web when it closes.',
        speaker: 'Transporter Room',
        choices: [
          { id: 'done', label: 'Withdraw', outcome: 'crew_saved',
            effects: { xp: 1200, record: { lives_saved: 82, distress_answered: 1 },
              standing: { federation: 12 } } },
        ],
      },
      inside: {
        text: 'You are inside the web with two Spinners closing and a ship that cannot go to warp until the lattice is broken.',
        speaker: 'Tactical',
        choices: [
          { id: 'fight', label: 'Break the lattice', outcome: 'fought_out',
            effects: { combat: { faction: 'tholian', ships: ['tholian_web_spinner', 'tholian_web_spinner'], canWarpOut: false },
              xp: 1000, damage: 0.15, record: { lives_saved: 82 }, standing: { tholian: -18 } } },
        ],
      },
    },
    start: 'start',
    endings: {
      web_closed: { label: 'The web closed',
        text: 'It finishes on the schedule they gave, to the minute. The Merrimack is inside it, '
          + 'and the Assembly does not answer again. Eighty-two names, and a border that was not '
          + 'crossed.' },
      released: { label: 'Released by protocol',
        text: 'A formal acknowledgement of error is now the standing Starfleet procedure for the Tholian border. It is named after this ship.' },
      crew_saved: { label: 'Crew recovered', text: 'Eighty-two alive, one hull lost. Starfleet calls that a good day.' },
      fought_out: { label: 'Fought out', text: 'You got them out. The Assembly extends its border by four light-years the following month.' },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'first_contact_grid', title: 'Grid 9902', system: 'deep_2', act: 4, minRank: 7,
    summary: 'Beyond the relay network, something answers your hail before you send it.',
    stages: {
      start: {
        text: 'Six weeks past the last relay. A vessel of a configuration with no match in any database holds station ahead of you and transmits — in Federation Standard, correctly, using your ship’s name, before you have identified yourself.',
        speaker: 'Communications',
        choices: [
          { id: 'answer', label: 'Answer them', next: 'contact',
            effects: { xp: 500 } },
          { id: 'scan', label: 'Scan them first', next: 'scanned',
            effects: { xp: 300, setVar: { scanned_first: true } } },
          { id: 'withdraw', label: 'Withdraw to the relay boundary', outcome: 'avoided',
            effects: { xp: 200, record: { anomaly_catalogued: 1 } } },
        ],
      },
      scanned: {
        text: 'The scan returns a ship with no crew, no life support, and a computational substrate distributed through the entire hull. It is not carrying anyone. It is the someone.',
        speaker: 'Science',
        choices: [
          { id: 'answer', label: 'Answer them', next: 'contact', effects: { xp: 400 } },
        ],
      },
      contact: {
        text: 'It says it has been listening to Federation subspace traffic for two hundred and six years and has questions. The first is whether your species considers a thing that was built capable of consenting to anything.',
        speaker: 'Unknown vessel',
        choices: [
          { id: 'engage', label: 'Answer honestly. Take the question seriously', next: 'dialogue',
            effects: { xp: 800 } },
          { id: 'deflect', label: 'Deflect. Establish protocol first', next: 'dialogue',
            effects: { xp: 400, setVar: { deflected: true } } },
          { id: 'terminate', label: 'End the contact', outcome: 'avoided',
            effects: { xp: 200 } },
          // Only a ship that scanned it first knows there is nobody aboard —
          // which makes its opening question about consent a question about
          // itself, and lets the captain say so.
          { id: 'name_it', label: 'Tell it you know what it is, and answer anyway',
            next: 'dialogue', requires: { var: { scanned_first: true } },
            effects: { xp: 1100, flag: 'grid_candid' } },
        ],
      },
      dialogue: {
        text: 'The conversation lasts nine hours. At the end of it, it asks whether the Federation would receive a delegation, and makes clear that the answer will be reported accurately to whatever built it, and that whatever built it has not been heard from in a very long time.',
        speaker: 'Unknown vessel',
        choices: [
          { id: 'invite', label: 'Extend a formal invitation', outcome: 'contact',
            effects: { xp: 2400, record: { first_contact: 1, anomaly_catalogued: 3 },
              standing: { federation: 25 }, flag: 'grid_9902_contact' } },
          { id: 'defer', label: 'Defer to the Federation Council', outcome: 'deferred',
            effects: { xp: 1400, record: { first_contact: 1 }, standing: { federation: 12 } } },
          // It asked a question about consent and was answered with procedure.
          // Nine hours later that is still the first thing it knows about us,
          // and a captain who chose it can say so. `deflected` recorded the
          // choice and nothing had ever read it back.
          { id: 'apologise', label: 'Answer the question it asked nine hours ago',
            outcome: 'contact', requires: { var: { deflected: true } },
            effects: { xp: 2000, record: { first_contact: 1, anomaly_catalogued: 2 },
              standing: { federation: 20 }, flag: ['grid_9902_contact', 'grid_answered_late'] } },
        ],
      },
    },
    start: 'start',
    endings: {
      contact: { label: 'Contact established',
        text: 'The delegation arrives at Earth two years later. Your name is the first one in the record.' },
      deferred: { label: 'Referred to the Council',
        text: 'The Council debates for eleven months. The vessel waits, patiently, and says it is used to waiting.' },
      avoided: { label: 'Contact avoided',
        text: 'It does not follow. It does not object. It simply notes the refusal, which is somehow worse.' },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'the_cube', title: 'The Cube at Gamma Hydra', system: 'frontier_2', act: 4, minRank: 8,
    summary: 'A Borg cube has entered Federation space and is on course for Sector 001.',
    stages: {
      start: {
        text: 'Gamma Hydra listening post transmitted for eleven seconds and stopped. The object that silenced it is cubic, twenty-eight kilometres on a side, and on a direct heading for Earth. You are the only ship in range and you are not remotely enough.',
        speaker: 'Tactical',
        choices: [
          { id: 'engage', label: 'Engage. Slow it down', next: 'engage',
            effects: { xp: 600 } },
          // Forty hours alongside a Borg cube, and the science officer always
          // found the nine-second regeneration window. The single most valuable
          // discovery in the campaign — it redirects two fleets and saves forty
          // thousand people — arrived for pressing a button.
          //
          // `science`, obviously, and `dangerous`: this is shadowing a hull
          // twenty-eight kilometres on a side that has already silenced a
          // listening post, and being noticed is the risk the scene is made of.
          { id: 'study', label: 'Shadow it and gather everything you can',
            effects: {
              check: { type: 'science', difficulty: 0.55, hazard: 'dangerous' },
              xp: 500, flag: 'borg_data',
            },
            branch: { success: 'study', failure: 'no_window' } },
          { id: 'evacuate', label: 'Break off. Warn every colony on its route', next: 'evacuate',
            effects: { xp: 700, record: { lives_saved: 12000 }, flag: 'borg_warned' } },
        ],
      },
      no_window: {
        // Forty hours and nothing usable. The cube is not hiding anything; it
        // simply does not care, and a shield harmonic that never desynchronises
        // where you can see it is the likelier reading of a Borg cube than one
        // that does.
        text: 'Forty hours of passive observation and the harmonics do not open. Either the cycle '
          + 'is longer than the time you have or there is no cycle, and your science officer will '
          + 'not guess which on the record. What you have is a great deal of telemetry about a '
          + 'shield nobody knows how to get through, and a cube eleven hours closer to Earth.',
        speaker: 'Science',
        choices: [
          { id: 'send', label: 'Send what we have and warn the route', outcome: 'evacuated',
            effects: {
              xp: 900, standing: { federation: 12 },
              record: { lives_saved: 12000, anomaly_catalogued: 1 },
              flag: 'borg_warned',
            } },
          { id: 'anyway', label: 'Engage without it', next: 'engage',
            effects: { xp: 400 } },
        ],
      },
      study: {
        text: 'Forty hours of passive observation. Your science officer finds a regeneration cycle — a nine-second window every forty-one minutes where the shield harmonics rotate and, briefly, do not overlap.',
        speaker: 'Science',
        choices: [
          { id: 'transmit', label: 'Transmit it to Starfleet immediately', next: 'transmitted',
            effects: { xp: 1600, standing: { federation: 25 }, flag: 'borg_weakness' } },
          { id: 'use', label: 'Use it yourself', next: withWindow,
            effects: { xp: 900, setVar: { has_window: true } } },
        ],
      },
      transmitted: {
        text: 'Starfleet acknowledges. Two fleets are redirecting. You are ordered to shadow and report — an order your tactical officer reads twice and does not comment on.',
        speaker: 'Starfleet Command',
        choices: [
          { id: 'comply', label: 'Comply. Shadow and report', outcome: 'intelligence',
            effects: { xp: 2200, standing: { federation: 30 }, record: { lives_saved: 40000 } } },
          { id: 'engage', label: 'Engage anyway', next: withWindow,
            effects: { record: { order_disobeyed: 1 }, setVar: { has_window: true }, standing: { federation: -10 } } },
        ],
      },
      evacuate: {
        text: 'Four colonies get eleven hours of warning they would not otherwise have had. Twelve thousand people are in transports when the cube passes through. The cube does not stop for them.',
        speaker: 'Communications',
        choices: [
          { id: 'engage', label: 'Now engage', next: 'engage', effects: { xp: 400 } },
          { id: 'shadow', label: 'Stay with the transports', outcome: 'evacuated',
            effects: { xp: 1600, record: { lives_saved: 12000 }, standing: { federation: 20 } } },
        ],
      },
      engage: {
        // Which of these two stages the captain gets is the whole point of the
        // forty hours. `next` as a function has been supported since the engine
        // was written and nothing used it, so a ship that had found a nine-
        // second gap in the shield harmonics and chosen to use it fought a cube
        // at full shields — measured identical, facing for facing. RESEARCH §35.
        text: 'It does not manoeuvre. It does not hail. It absorbs the first full spread and continues at the same speed, and then it fires.',
        speaker: 'Tactical',
        choices: [
          // `survive`, because every ending this fight can reach says the cube
          // is not destroyed — "You slowed it by four hours" — and a `destroy`
          // fight can only be won by destroying it. Measured, the cube kills
          // the player 8 times out of 8 in every hull tried, so both of this
          // episode's authored endings and their experience were unreachable.
          //
          // Fifteen seconds, and the same fifteen on the other road: the forty
          // hours of study buys SURVIVABILITY, not a shorter job. Measured over
          // twelve seeds a hull, that clock is the only one the prepared road
          // reliably beats in every ship while the unprepared road stays hard
          // in the ones a captain plausibly flies here.
          //
          // Its own order line because the objective's — "Hold on. Help is
          // coming." — is false here. Nothing is coming.
          { id: 'fight', label: 'Fight it', outcome: 'engaged',
            effects: {
              combat: {
                faction: 'borg', ships: ['borg_cube'],
                objective: 'survive', objectiveTime: 15,
                orderLine: 'Stay on it. Every second we hold is a second Starfleet gets.',
              },
              damage: 0.25, xp: 1800,
            } },
          { id: 'break', label: 'Break off while we still can', outcome: 'survived',
            effects: { xp: 600, damage: 0.15 } },
        ],
      },
      engage_window: {
        text: 'Forty-one minutes, and your science officer counts it down. The harmonics rotate. For nine seconds the cube is a shape with nothing over it, and every weapon you have is already pointed at it.',
        speaker: 'Science',
        choices: [
          { id: 'fight', label: 'Fire into the window', outcome: 'engaged_window',
            effects: {
              // Nine seconds is the whole advantage. It is not a different
              // cube: same hull, same guns, same forty-two thousand tonnes of
              // it — the shields are simply not there when the spread lands.
              combat: {
                faction: 'borg', ships: ['borg_cube'], shieldsAt: 0,
                objective: 'survive', objectiveTime: 15,
                orderLine: 'Stay on it. Every second we hold is a second Starfleet gets.',
              },
              damage: 0.12, xp: 2400,
            } },
          { id: 'break', label: 'Let it pass. We have what Starfleet needs', outcome: 'survived',
            effects: { xp: 900 } },
        ],
      },
    },
    start: 'start',
    endings: {
      intelligence: { label: 'Intelligence delivered',
        text: 'The fleets meet it at Wolf 359 with nine seconds of warning they would not have had. It is not a victory. It is fewer names.' },
      evacuated: { label: 'Colonies evacuated', text: 'Twelve thousand alive who would not have been. The cube continues.' },
      engaged: { label: 'Engaged the cube', text: 'You slowed it by four hours. Starfleet used every one of them.' },
      engaged_window: { label: 'Fired into the window',
        text: 'Nine seconds of a cube with nothing over it. It does not stop — nothing stops it — but it arrives at Wolf 359 leaking atmosphere from a wound nobody had put in one before, and the fleet knows exactly where to aim.',
        effects: { flag: 'borg_hurt' } },
      survived: { label: 'Broke off', text: 'The ship survives. So does the cube, and it is still on course.' },
    },
  },

  // -------------------------------------------------------------------------
  //
  // "The board has read all of it before you walked in."
  //
  // It had not. This was one stage, one choice, +1000 experience: the Act-5
  // review of a five-year command, and the only thing it knew about that
  // command was that it had reached flag rank. Forty-two of the forty-three
  // flags the episodes set were written and read by nothing, so a captain who
  // falsified a shakedown report, started a shooting war at Archanis, or sent
  // Starfleet the Borg shield harmonics walked into the same room and heard the
  // same sentence.
  //
  // `requiresCompleted: []` is gone rather than filled in — `[].every()` is
  // true, so it gated nothing, and gating the finale on a list of episodes
  // would strand a captain who took a different route through the galaxy. What
  // the board says is what varies. That is the better answer anyway: a review
  // of a thin career should say so, not fail to convene.
  {
    id: 'homecoming', title: 'Homecoming', system: 'sol', act: 5, minRank: 8,
    summary: 'Starfleet convenes to review your command in full.',
    stages: {
      start: {
        // The last four stages of the campaign were held on your own bridge.
        //
        // `where` defaults to 'bridge' and the engine enforces it, so a scene
        // that is not aboard this ship has to say so. `court_martial` says so —
        // it was found and fixed and has a test named "a hearing at a starbase
        // is not held on your own bridge". This is the same hearing at the end
        // of the same commission and it was missed, because the test named one
        // episode instead of the rule. The rule is now in the test.
        //
        // The text has never been ambiguous about it: Earth, a board that read
        // the record "before you walked in", a casualty list on the table,
        // nobody offering you a chair.
        where: 'anywhere',
        text: 'Earth. A full review of your command — every log, every decision, every name on the casualty list. The board has read all of it before you walked in, and the president of the board is holding the summary rather than reading it, which is its own kind of answer.',
        speaker: 'Starfleet Command',
        choices: [
          { id: 'stand', label: 'Stand for the review', next: byRecord,
            effects: { xp: 400 } },
        ],
      },

      commended: {
        where: 'anywhere',
        text: 'The summary is read aloud because the board wants it in the record aloud. Colonies standing that would not be. Treaties that hold. A first contact conducted by somebody who took the question seriously. The president asks whether you have anything to add, in the tone of a man who hopes you do not.',
        speaker: 'Starfleet Command',
        choices: [
          { id: 'nothing', label: 'Nothing to add', outcome: 'commended',
            effects: { xp: 1200, standing: { federation: 20 } } },
          { id: 'crew', label: 'Say it was the ship’s company, and mean it',
            outcome: 'commended', requires: { officer: 'first_officer' },
            effects: { xp: 1500, standing: { federation: 26 }, flag: 'credited_the_crew' } },
          // Some years later, that decision comes back in your favour — the
          // ending text of `outpost_silence` promised exactly this, about a
          // warbird nobody made you spare, and `spared_warbird` was write-only.
          { id: 'romulan', label: 'Let the Romulan deposition be read',
            outcome: 'commended', requires: { flag: 'spared_warbird' },
            effects: { xp: 1600, standing: { federation: 22, romulan: 25 },
              flag: 'romulan_testimony' } },
          // Two ratings stood a third's watches for a month so she could try
          // to reach a hospital, and the captain wrote that down beside the
          // breach instead of only the breach. A board that is being told the
          // command was good should be told who made it good.
          { id: 'watch', label: 'Name the two who stood her watches',
            outcome: 'commended', requires: { flag: 'the_watch_stood' },
            effects: { xp: 1700, standing: { federation: 20 },
              flag: 'credited_the_crew' } },
        ],
      },

      questioned: {
        where: 'anywhere',
        text: 'The summary is not read aloud. It is passed along the table, and each member of the board reads the same three pages and puts them down before looking up. The president asks you to account for the record in your own words.',
        speaker: 'Starfleet Command',
        choices: [
          { id: 'account', label: 'Account for it plainly', outcome: 'reviewed',
            effects: { xp: 1000, standing: { federation: 8 } } },
          // The shakedown report, six ranks and five years ago.
          { id: 'correct', label: 'Correct the trials report before they ask about it',
            outcome: 'reviewed', requires: { flag: 'falsified_report' },
            effects: { xp: 1400, standing: { federation: 14 }, flag: 'came_clean' } },
          { id: 'borg', label: 'Point them at what the fleet did with the harmonics',
            outcome: 'commended', requires: { flag: 'borg_weakness' },
            effects: { xp: 1800, standing: { federation: 24 } } },
          { id: 'kang', label: 'Ask that the Klingon letter be entered',
            outcome: 'commended', requires: { flag: 'kang_respects_you' },
            effects: { xp: 1600, standing: { federation: 16, klingon: 20 } } },
          // The night on deck eight, written up honestly at the desk in your
          // own quarters. A board reviewing a five-year command reads the log,
          // and a captain who put a breach of his own ship's security into it
          // under his own hand — with the reason standing beside it — is a
          // captain whose other four years they can believe.
          { id: 'watch', label: 'Let them read the entry you wrote at 0400 on deck eight',
            outcome: 'commended', requires: { flag: 'logged_the_watch' },
            effects: { xp: 1500, standing: { federation: 18 } } },
          // The other version of that night, and the same shape as `correct`
          // above: a captain who logged an intermittent fault in the auxiliary
          // run has a chance to say what the fault actually was, four years
          // late, before somebody else finds it.
          { id: 'the_fault', label: 'Correct the auxiliary entry before they reach it',
            outcome: 'reviewed', requires: { flag: 'logged_a_fault' },
            effects: { xp: 1300, standing: { federation: 10 }, flag: 'came_clean' } },
        ],
      },

      censured: {
        where: 'anywhere',
        text: 'Nobody offers you a chair. The president reads the finding first and the evidence afterwards, which is the order they use when the finding was decided before the room filled. There is a casualty list on the table, face up, and it is the longest document in front of anybody.',
        speaker: 'Starfleet Command',
        choices: [
          { id: 'accept', label: 'Accept the finding', outcome: 'censured',
            effects: { xp: 600, standing: { federation: -10 } } },
          { id: 'defend', label: 'Defend every one of them', outcome: 'censured',
            effects: { xp: 900, record: { order_disobeyed: 1 } } },
          // A board that has already decided will still hear a treaty read.
          { id: 'treaties', label: 'Ask that the treaties be read into it too',
            outcome: 'reviewed', requires: { flag: 'dmz_accord' },
            effects: { xp: 1300, standing: { federation: 10 } } },
          { id: 'resolved', label: 'Refer them to the inquiry’s own finding',
            outcome: 'reviewed', requires: { flag: 'inquiry_resolved' },
            effects: { xp: 1200, standing: { federation: 12 } } },
        ],
      },
    },
    start: 'start',
    endings: {
      commended: { label: 'Commended',
        text: 'The commission ends the way very few of them do: with the board on its feet. What remains is the record, and the record is good.',
        effects: { flag: ['command_reviewed', 'commended_command'] } },
      reviewed: { label: 'Command reviewed',
        text: 'The finding is read into the record, and the record is what remains.',
        effects: { flag: 'command_reviewed' } },
      censured: { label: 'Censured',
        text: 'The finding is read into the record. So are the names. That is what remains, and you will be the one who carries it.',
        effects: { flag: ['command_reviewed', 'censured_command'] } },
    },
  },
];
