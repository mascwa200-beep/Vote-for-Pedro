// Episodes 9-16: the Neutral Zone, Cardassian space, and the dark past the relays.

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
          { id: 'tachyon', label: 'Flood the area with tachyons', next: 'revealed',
            requires: { skill: 'sensors', ranks: 1 }, effects: { xp: 400 } },
          { id: 'wait', label: 'Hold position and wait for it to move first', next: 'ambushed',
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
          { id: 'fire', label: 'Fire before they can cloak again', next: 'battle',
            effects: { combat: { faction: 'romulan', ships: ['warbird'] },
              standing: { romulan: -25 }, flag: 'fired_first_neutral_zone',
              record: { violated_border: 1 } } },
        ],
      },
      ambushed: {
        text: 'It moves first. The first shot takes the forward shields to nothing before the alert klaxon finishes its first cycle.',
        speaker: 'Tactical',
        choices: [
          { id: 'fight', label: 'Return fire', next: 'battle',
            effects: { combat: { faction: 'romulan', ships: ['warbird'] }, damage: 0.15 } },
        ],
      },
      negotiate: {
        text: 'He does not deny it. He explains, with something close to regret, that the outposts were a test of a weapon his Praetor required tested, that he chose the emptiest targets available, and that he expects you will now try to stop him leaving.',
        speaker: 'Romulan commander',
        choices: [
          { id: 'let_go', label: 'Let him go. Report the weapon', outcome: 'reported',
            effects: { xp: 900, record: { anomaly_catalogued: 2 }, standing: { romulan: 10, federation: 6 },
              flag: 'romulan_cloak_reported' } },
          { id: 'stop', label: 'Stop him', next: 'battle',
            effects: { combat: { faction: 'romulan', ships: ['warbird'] } } },
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
        text: 'Inside, the ship’s chronometers disagree by eleven minutes and the structural integrity field is fighting something it was not designed for. There is a way to collapse it — an inverse tachyon pulse — and it will require the warp core running at a level the chief engineer describes as "a very bad idea, Captain."',
        speaker: 'Engineering',
        choices: [
          { id: 'pulse', label: 'Do it', next: 'pulse',
            requires: { skill: 'warp_theory', ranks: 2 },
            effects: { xp: 800, damage: 0.2 } },
          { id: 'retreat', label: 'Get us out', outcome: 'catalogued',
            effects: { xp: 500, damage: 0.1, record: { anomaly_catalogued: 2 } } },
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
          { id: 'go', label: 'Take the convoy through', next: 'inside',
            effects: { xp: 300, setVar: { escorting: true } } },
          { id: 'long', label: 'Take the long route. They can wait', outcome: 'late',
            effects: { xp: 150, time: 3, record: { lives_lost: 900 }, standing: { federation: -8 } } },
        ],
      },
      inside: {
        text: 'Two hours in, a storm front takes out the lead freighter’s shields, and sensors pick up three impulse signatures moving in formation. Nobody flies formation in here by accident.',
        speaker: 'Tactical',
        choices: [
          { id: 'shield', label: 'Put the ship between them and the convoy', next: 'fight',
            effects: { combat: { faction: 'cardassian', ships: ['galor'] }, damage: 0.1, xp: 400 } },
          { id: 'storm', label: 'Lead them into the storm front', next: 'storm',
            requires: { skill: 'impulse_thrusters', ranks: 2 }, effects: { xp: 600 } },
          { id: 'scatter', label: 'Order the convoy to scatter', next: 'scatter',
            effects: { xp: 200 } },
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
        ],
      },
      standoff: {
        text: 'He withdraws his ships to the edge of the system and waits. So does the negotiation. Nine days later Starfleet sends someone else to do it, and the terms are worse than the ones you were offered.',
        speaker: 'Starfleet Command',
        choices: [
          { id: 'accept', label: 'Accept the outcome', outcome: 'failed',
            effects: { xp: 300, standing: { federation: -12 }, record: { treaty_broken: 0 } } },
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
          { id: 'apologise', label: 'Acknowledge the violation formally and request release', next: 'released',
            requires: { skill: 'diplomacy', ranks: 3 }, effects: { xp: 900 } },
          { id: 'enter', label: 'Cross anyway', next: 'inside',
            effects: { standing: { tholian: -20 }, record: { violated_border: 1 } } },
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
          { id: 'study', label: 'Shadow it and gather everything you can', next: 'study',
            effects: { xp: 800, flag: 'borg_data' } },
          { id: 'evacuate', label: 'Break off. Warn every colony on its route', next: 'evacuate',
            effects: { xp: 700, record: { lives_saved: 12000 }, flag: 'borg_warned' } },
        ],
      },
      study: {
        text: 'Forty hours of passive observation. Your science officer finds a regeneration cycle — a nine-second window every forty-one minutes where the shield harmonics rotate and, briefly, do not overlap.',
        speaker: 'Science',
        choices: [
          { id: 'transmit', label: 'Transmit it to Starfleet immediately', next: 'transmitted',
            effects: { xp: 1600, standing: { federation: 25 }, flag: 'borg_weakness' } },
          { id: 'use', label: 'Use it yourself', next: 'engage',
            effects: { xp: 900, setVar: { has_window: true } } },
        ],
      },
      transmitted: {
        text: 'Starfleet acknowledges. Two fleets are redirecting. You are ordered to shadow and report — an order your tactical officer reads twice and does not comment on.',
        speaker: 'Starfleet Command',
        choices: [
          { id: 'comply', label: 'Comply. Shadow and report', outcome: 'intelligence',
            effects: { xp: 2200, standing: { federation: 30 }, record: { lives_saved: 40000 } } },
          { id: 'engage', label: 'Engage anyway', next: 'engage',
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
        text: 'It does not manoeuvre. It does not hail. It absorbs the first full spread and continues at the same speed, and then it fires.',
        speaker: 'Tactical',
        choices: [
          { id: 'fight', label: 'Fight it', outcome: 'engaged',
            effects: { combat: { faction: 'borg', ships: ['borg_cube'] }, damage: 0.25, xp: 1800 } },
          { id: 'break', label: 'Break off while we still can', outcome: 'survived',
            effects: { xp: 600, damage: 0.15 } },
        ],
      },
    },
    start: 'start',
    endings: {
      intelligence: { label: 'Intelligence delivered',
        text: 'The fleets meet it at Wolf 359 with nine seconds of warning they would not have had. It is not a victory. It is fewer names.' },
      evacuated: { label: 'Colonies evacuated', text: 'Twelve thousand alive who would not have been. The cube continues.' },
      engaged: { label: 'Engaged the cube', text: 'You slowed it by four hours. Starfleet used every one of them.' },
      survived: { label: 'Broke off', text: 'The ship survives. So does the cube, and it is still on course.' },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'homecoming', title: 'Homecoming', system: 'sol', act: 5, minRank: 8,
    requiresCompleted: [],
    summary: 'Starfleet convenes to review your command in full.',
    stages: {
      start: {
        text: 'Earth. A full review of your command — every log, every decision, every name on the casualty list. The board has read all of it before you walked in.',
        speaker: 'Starfleet Command',
        choices: [
          { id: 'stand', label: 'Stand for the review', outcome: 'review',
            effects: { xp: 1000 } },
        ],
      },
    },
    start: 'start',
    endings: {
      review: { label: 'Command reviewed',
        text: 'The finding is read into the record, and the record is what remains.',
        effects: { flag: 'command_reviewed' } },
    },
  },
];
