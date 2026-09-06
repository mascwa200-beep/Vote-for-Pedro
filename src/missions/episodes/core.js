// Episodes 1-8: the Federation interior and the Klingon border.

export const CORE_EPISODES = [
  // -------------------------------------------------------------------------
  {
    id: 'shakedown', title: 'Shakedown', system: 'sol', act: 1,
    summary: 'Utopia Planitia has finished with your ship. Starfleet wants her tested.',
    stages: {
      start: {
        text: 'Admiral Nakamura’s orders are on the screen. Take the ship out to Alpha Centauri, run her hard, and file an honest report. "Honest," he says twice.',
        speaker: 'Starfleet Command',
        choices: [
          { id: 'accept', label: 'Acknowledge the orders', next: 'trials',
            effects: { xp: 100 } },
          { id: 'question', label: 'Ask why the hurry', next: 'trials',
            effects: { flag: 'asked_about_hurry', xp: 60 } },
        ],
      },
      trials: {
        // The orders say Alpha Centauri, so the trials happen at Alpha
        // Centauri. A stage inherits its episode's system unless it says
        // otherwise, and this one has to say otherwise or the fiction and the
        // gate disagree with each other.
        system: 'alpha_centauri',
        text: 'Engineering reports the core is holding at ninety-four percent efficiency. Your chief engineer wants to push it. Your first officer would prefer the manual’s numbers.',
        speaker: 'Bridge',
        choices: [
          // The first gamble a captain takes in the game, and for a long time
          // the ONLY one: `branch` appeared exactly once in twenty-six
          // episodes, here, on a flat `roll: 0.7` that did not consult the
          // captain, the crew or the chief engineer standing in front of you.
          // A coin taught the mechanic and then nothing used it.
          //
          // `engineering`, because it is the intermix, and the check reaches
          // the chief through `buildAwayTeam` the way every other one does.
          // `routine`, because the failure this branches to says "two injured,
          // nothing worse" — that is a 4% injury band, not a 28% one, and the
          // hazard has to mean what the scene says.
          { id: 'push', label: 'Push the core to its limit',
            effects: {
              check: { type: 'engineering', difficulty: 0.45, hazard: 'routine' },
              xp: 200,
            },
            branch: { success: 'push_good', failure: 'push_bad' } },
          { id: 'manual', label: 'Run the standard profile', next: 'report',
            effects: { xp: 120, setVar: { cautious: true } } },
        ],
      },
      push_good: {
        system: 'alpha_centauri',
        text: 'She holds. Better than holds — the chief is grinning at a readout and says the intermix is cleaner than the yard predicted.',
        speaker: 'Engineering',
        choices: [{ id: 'ok', label: 'Log it', next: 'report', effects: { xp: 150, flag: 'core_tuned' } }],
      },
      push_bad: {
        system: 'alpha_centauri',
        text: 'A plasma conduit lets go on deck eleven. Two injured, nothing worse, and a lecture from your chief engineer that you have earned.',
        speaker: 'Engineering',
        choices: [{ id: 'ok', label: 'Log it honestly', next: 'report',
          effects: { damage: 0.06, xp: 80 } }],
      },
      report: {
        // A report is written wherever the ship is. `system: null` is a stage
        // that happens on board rather than at a place.
        //
        // NOT `where: 'quarters'`, though the speaker has been 'Ready Room' all
        // along. This is the fifth screen of the first episode in the game, and
        // the room gate is enforced now — so putting it in the captain's
        // quarters makes "walk to a compartment" a thing a new captain has to
        // work out before they can finish the tutorial. The scenes that ask you
        // to get up are ones where being in the room is the point: a survivor
        // waking in sickbay, eighty-two people arriving in the transporter room.
        system: null,
        text: 'The trials are done. What goes in the report?',
        speaker: 'Ready Room',
        choices: [
          { id: 'honest', label: 'File it exactly as it happened', outcome: 'honest',
            effects: { xp: 250, standing: { federation: 4 } } },
          { id: 'flatter', label: 'Round the numbers in the yard’s favour', outcome: 'flattered',
            effects: { xp: 120, flag: 'falsified_report' } },
          // `requires.var` has been in the engine since it was written and no
          // episode had ever used it, so `cautious` — set two stages ago by a
          // captain who declined to push the core — was written into the save
          // file and read by nothing. A recommendation about a class profile is
          // worth something only from somebody who flew the profile.
          { id: 'recommend', label: 'Recommend the yard’s profile for the whole class',
            outcome: 'honest', requires: { var: { cautious: true } },
            effects: { xp: 320, standing: { federation: 7 }, flag: 'trials_by_the_book' } },
        ],
      },
    },
    start: 'start',
    endings: {
      honest: { label: 'Reported honestly',
        text: 'Nakamura reads it, grunts, and assigns you a patrol. That is as close to approval as he gets.' },
      flattered: { label: 'Report massaged',
        text: 'The yard is pleased. Your first officer says nothing at all, which is worse.',
        effects: { record: { order_disobeyed: 1 } } },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'vega_raid', title: 'The Raid on Vega', system: 'vega', act: 1,
    summary: 'Vega Colony is being raided and their defence grid is down.',
    stages: {
      start: {
        text: 'Vega Colony is transmitting on all frequencies. Two raiders in low orbit, shuttles on the ground, and the colony’s grid offline. Eleven thousand people down there.',
        speaker: 'Communications',
        choices: [
          { id: 'engage', label: 'Red alert. Engage the raiders', next: 'after_combat',
            effects: { combat: { faction: 'orion', ships: ['orion_raider', 'orion_raider'] } } },
          { id: 'hail_first', label: 'Hail them first', next: 'hail',
            effects: { xp: 80 } },
          // The check was here and decided nothing: it rolled, printed a line,
          // and went to `ground` either way — where the grid always came up and
          // four hundred people were always saved. A `dangerous` hazard that
          // cannot fail is a hazard in name.
          { id: 'ground_first', label: 'Beam a team to the surface grid',
            effects: { check: { type: 'engineering', difficulty: 0.5, hazard: 'dangerous' } },
            branch: { success: 'ground', failure: 'ground_hard' } },
        ],
      },
      ground_hard: {
        text: 'The housing is not the problem. Somebody has been through the primary junction with '
          + 'a cutting torch and taken the couplings with them, and there is no getting the grid up '
          + 'from down here inside an hour. There are shuttles on the ground four streets away and '
          + 'our people are standing in the open with a toolkit.',
        speaker: 'Away Team',
        choices: [
          { id: 'cover', label: 'Get them out and take the raiders from orbit', next: 'after_combat',
            effects: {
              combat: { faction: 'orion', ships: ['orion_raider', 'orion_raider'] },
              xp: 120,
              // Some of them, and not the four hundred the grid would have
              // covered. That difference IS the check.
              record: { lives_saved: 90 },
            } },
        ],
      },
      hail: {
        text: 'The Orion captain is amused. He offers to leave for a price, and to keep whatever his people already have aboard.',
        speaker: 'Orion captain',
        choices: [
          { id: 'pay', label: 'Pay him', next: 'paid',
            effects: { standing: { orion: 8, federation: -6 }, xp: 120, flag: 'paid_orions' } },
          { id: 'refuse', label: 'Refuse and open fire', next: 'after_combat',
            effects: { combat: { faction: 'orion', ships: ['orion_raider', 'orion_raider'] } } },
        ],
      },
      ground: {
        text: 'The team is on the surface with the generator housing open.',
        speaker: 'Away Team',
        choices: [
          { id: 'continue', label: 'Get the grid up', next: 'after_combat',
            effects: { combat: { faction: 'orion', ships: ['orion_raider'] }, xp: 200,
              flag: 'vega_grid_restored', record: { lives_saved: 400 } } },
        ],
      },
      paid: {
        text: 'They leave, with four hundred colonists aboard as cargo. The colony administrator will not look at the screen.',
        speaker: 'Vega Colony',
        choices: [
          { id: 'pursue', label: 'Pursue them anyway', next: 'after_combat',
            effects: { combat: { faction: 'orion', ships: ['orion_raider', 'orion_raider'] },
              standing: { orion: -14 } } },
          { id: 'let_go', label: 'Let them go', outcome: 'bought_off',
            effects: { record: { lives_lost: 400 }, standing: { federation: -12 } } },
        ],
      },
      after_combat: {
        text: 'The raiders are dealt with. The colony is counting.',
        speaker: 'Vega Colony',
        choices: [
          { id: 'aid', label: 'Send medical and repair teams down', outcome: 'saved',
            effects: { xp: 500, record: { colony_saved: 1, distress_answered: 1, lives_saved: 900 },
              standing: { federation: 10 }, time: 1.2, flag: 'vega_saved' } },
          { id: 'depart', label: 'Report and move on', outcome: 'defended',
            effects: { xp: 300, record: { distress_answered: 1 }, standing: { federation: 4 } } },
        ],
      },
    },
    start: 'start',
    endings: {
      saved: { label: 'Colony saved', text: 'Vega will remember this. So will Starfleet.' },
      defended: { label: 'Raiders driven off', text: 'The colony survives. The rebuilding is theirs to do.' },
      bought_off: { label: 'Colonists taken',
        text: 'Four hundred people are in an Orion hold and you watched them go.' },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'archanis_claim', title: 'The Archanis Claim', system: 'archanis', act: 2, minRank: 5,
    summary: 'A Klingon battlecruiser is in orbit of a Federation colony, and its captain says the world is his.',
    stages: {
      start: {
        text: 'A D7 holds station over Archanis IV. Captain Kang states that the colony sits on Klingon soil ceded in error, that he has orders, and that he would rather not fire on farmers.',
        speaker: 'Captain Kang',
        choices: [
          { id: 'stand', label: '"This colony is Federation territory. Withdraw."', next: 'standoff',
            effects: { standing: { klingon: -4 }, xp: 150 } },
          { id: 'talk', label: 'Ask to see his orders', next: 'orders',
            requires: { skill: 'diplomacy', ranks: 1 }, effects: { xp: 200 } },
          // `disable`, because the button says so and the stage it leads to
          // says so twice. `battle` opens "The D7 is crippled and drifting.
          // Kang's ship has forty-two survivors and no life support in the
          // forward sections", and then offers to finish them — none of which
          // is true of a hull the fight required you to remove from the board.
          { id: 'attack', label: 'Arm weapons and target his engines', next: 'battle',
            effects: { combat: { faction: 'klingon', ships: ['d7'], objective: 'disable' },
              standing: { klingon: -20 }, flag: 'fired_first_archanis' } },
        ],
      },
      orders: {
        text: 'He transmits them. They are genuine, and they are two years out of date — signed before a treaty amendment his command never forwarded. He reads it as you do, and his jaw sets.',
        speaker: 'Captain Kang',
        choices: [
          // Handing a Klingon captain a ladder is the whole episode, and it
          // could not fail: the diplomacy gate decided whether the BUTTON was
          // there, and pressing it always worked. A gate on the offer and a
          // check on whether he takes it are different questions.
          //
          // `command` rather than `diplomacy`. The skill gate above is already
          // diplomacy — this is not the same roll twice — and what Kang is
          // weighing is not how well the sentence was phrased but whether the
          // officer saying it is somebody he can withdraw in front of.
          // `routine`: nobody is off the ship, and the risk here is not to a
          // body.
          { id: 'offer_out', label: 'Offer him a way to withdraw with honour',
            requires: { skill: 'diplomacy', ranks: 2 },
            effects: { check: { type: 'command', difficulty: 0.55, hazard: 'routine' }, xp: 400 },
            branch: { success: 'honour', failure: 'refused_ladder' } },
          { id: 'humiliate', label: 'Tell him to explain himself to his High Council', next: 'standoff',
            effects: { standing: { klingon: -12 } } },
        ],
      },
      refused_ladder: {
        text: 'He hears it out. Then he says that a Klingon who withdraws on a Starfleet officer’s '
          + 'word has not withdrawn, he has been sent away, and that there is a difference his '
          + 'House would find in about a day. The orders are still two years dead and he is still '
          + 'in orbit of your colony, and now both of you know he cannot simply leave.',
        speaker: 'Captain Kang',
        choices: [
          { id: 'hold', label: 'Hold position and let him decide', next: 'standoff',
            effects: { xp: 250, standing: { klingon: 4 }, flag: 'kang_left_room' } },
        ],
      },
      honour: {
        text: 'You propose a joint survey: the Empire verifies the boundary itself, and withdraws on its own finding rather than yours. Kang is quiet for a long moment. Then he laughs.',
        speaker: 'Captain Kang',
        choices: [
          { id: 'seal', label: 'Seal it', outcome: 'treaty',
            effects: { xp: 900, standing: { klingon: 22, federation: 12 },
              record: { treaty_signed: 1, colony_saved: 1 }, flag: 'kang_respects_you' } },
        ],
      },
      standoff: {
        text: 'He does not move. Neither do you. Ninety seconds pass, and then his disruptors come online.',
        speaker: 'Tactical',
        choices: [
          // The other road into `battle`, and it has to arrive in the same
          // state the stage describes.
          { id: 'fight', label: 'Fight', next: 'battle',
            effects: { combat: { faction: 'klingon', ships: ['d7'], objective: 'disable' } } },
          { id: 'withdraw', label: 'Withdraw and let the diplomats have it', outcome: 'ceded',
            effects: { standing: { federation: -14, klingon: 6 }, record: { colony_lost: 1 }, xp: 200 } },
        ],
      },
      battle: {
        text: 'The D7 is crippled and drifting. Kang’s ship has forty-two survivors and no life support in the forward sections.',
        speaker: 'Tactical',
        choices: [
          { id: 'rescue', label: 'Beam them aboard', outcome: 'won_honourably',
            effects: { xp: 800, standing: { klingon: 14, federation: 8 },
              record: { lives_saved: 42, colony_saved: 1 }, flag: 'kang_respects_you' } },
          { id: 'leave', label: 'Leave them to their own fleet', outcome: 'won',
            effects: { xp: 500, standing: { klingon: -10 }, record: { colony_saved: 1 } } },
          { id: 'finish', label: 'Finish them', outcome: 'butchery',
            effects: { xp: 300, standing: { klingon: -30, federation: -20 },
              record: { surrender_refused: 1, lives_lost: 42 }, flag: 'archanis_massacre' } },
        ],
      },
    },
    start: 'start',
    endings: {
      treaty: { label: 'Boundary settled',
        text: 'The Empire withdraws on its own authority. Archanis stays Federation, and nobody died over a filing error.' },
      won_honourably: { label: 'Won, and honoured',
        text: 'Kang lives, and tells the story his way. That turns out to matter later.' },
      won: { label: 'Won', text: 'The colony is safe. The Empire files a protest.' },
      ceded: { label: 'Colony ceded',
        text: 'Eight hundred colonists are relocated by treaty within the year. They are not consulted.' },
      butchery: { label: 'No survivors',
        text: 'Starfleet opens a file. The Empire opens a longer one.' },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'organia_question', title: 'The Organian Question', system: 'organia', act: 2, minRank: 5,
    summary: 'A pre-industrial world sits exactly between two empires, and both want it.',
    stages: {
      start: {
        text: 'Organia is agrarian, peaceful, and entirely without defences. A Klingon occupation force is eleven hours out. The Organians have been told, and appear untroubled — which your science officer finds more alarming than the fleet.',
        speaker: 'Science',
        choices: [
          // Getting a hearing at all is the check, and it used to be scenery:
          // the roll happened and the council received you either way.
          { id: 'warn', label: 'Beam down and warn the council',
            effects: { check: { type: 'diplomacy', difficulty: 0.4, hazard: 'routine' }, xp: 200 },
            branch: { success: 'council', failure: 'council_cool' } },
          { id: 'defend', label: 'Hold orbit and defend the planet', next: 'defend',
            effects: { xp: 150 } },
          { id: 'observe', label: 'Observe from range. Do not interfere', next: 'observe',
            effects: { xp: 300, flag: 'observed_organia', record: { anomaly_catalogued: 1 } } },
        ],
      },
      council_cool: {
        // The failure is not a closed door. It is being handled — which on
        // Organia is worse, because it costs you the tricorder readings that
        // are the whole thread out of this episode.
        text: 'You are received in an ante-room by two of them, and they are courteous for exactly '
          + 'as long as it takes to walk you back out. The word "occupation" is met the way one '
          + 'meets a remark about the weather. Nobody offers a chamber, nobody offers a reading, '
          + 'and your science officer’s tricorder spends eleven minutes recording a room.',
        speaker: 'Away Team',
        choices: [
          { id: 'back', label: 'Return to the ship and hold orbit', next: 'defend',
            effects: { xp: 120, flag: 'organia_rebuffed' } },
        ],
      },
      council: {
        text: 'The council thanks you for your concern the way one thanks a child for a drawing. They decline evacuation, decline weapons, and decline to be worried. Your tricorder readings from the chamber are, in your science officer’s words, "impossible."',
        speaker: 'Away Team',
        choices: [
          { id: 'press', label: 'Press them on the readings', next: 'reveal',
            requires: { skill: 'sensors', ranks: 1 }, effects: { xp: 400 } },
          { id: 'accept', label: 'Accept their answer and return to the ship', next: 'defend',
            effects: { xp: 200 } },
        ],
      },
      reveal: {
        text: 'They stop pretending. What is in that chamber is not a council and never was. They tell you, kindly, that neither fleet will be permitted to fight here, and that your concern was noted and appreciated.',
        speaker: 'Organian Council',
        choices: [
          { id: 'report', label: 'Report it to Starfleet', outcome: 'contact',
            effects: { xp: 1200, record: { first_contact: 1, anomaly_catalogued: 3 },
              standing: { federation: 15 }, flag: 'organia_revealed' } },
          { id: 'bury', label: 'Keep it out of the log', outcome: 'buried',
            effects: { xp: 500, flag: 'organia_secret' } },
        ],
      },
      defend: {
        text: 'The Klingon force arrives: two Birds-of-Prey and a battlecruiser. They order you out of orbit.',
        speaker: 'Tactical',
        choices: [
          { id: 'fight', label: 'Hold position', outcome: 'defended',
            effects: { combat: { faction: 'klingon', ships: ['bird_of_prey', 'bird_of_prey'] },
              xp: 700, standing: { klingon: -16, federation: 10 }, record: { colony_saved: 1 } } },
          { id: 'yield', label: 'Withdraw', outcome: 'withdrew',
            effects: { xp: 200, standing: { federation: -8 }, record: { colony_lost: 1 } } },
        ],
      },
      observe: {
        text: 'You watch. The Klingon fleet arrives, and eleven hours later it leaves, without having fired, without explanation, and with its commander refusing to discuss it on an open channel.',
        speaker: 'Science',
        choices: [
          { id: 'investigate', label: 'Investigate what happened', outcome: 'contact',
            effects: { xp: 900, record: { first_contact: 1, anomaly_catalogued: 2 }, flag: 'organia_revealed' } },
          { id: 'log', label: 'File it and move on', outcome: 'unexplained',
            effects: { xp: 400, record: { anomaly_catalogued: 1 } } },
        ],
      },
    },
    start: 'start',
    endings: {
      contact: { label: 'Contact established',
        text: 'Starfleet reclassifies Organia and quietly stops filing patrol routes through the system.' },
      buried: { label: 'Kept off the record',
        text: 'You know. Nobody else does. Your first officer suspects, and does not ask.' },
      defended: { label: 'Orbit held',
        text: 'You fought a battle over a world that, it later emerges, was never in any danger.' },
      withdrew: { label: 'Withdrew', text: 'The occupation proceeds. It lasts nine days and ends without explanation.' },
      unexplained: { label: 'Filed unexplained', text: 'The report goes into a drawer at Starfleet Intelligence.' },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'wolf359_salvage', title: 'What Was Left at Wolf 359', system: 'wolf359', act: 2,
    summary: 'A survey of the battle site turns up something still transmitting.',
    stages: {
      start: {
        text: 'Thirty-nine hulls, catalogued and left where they fell. Command wants a debris survey. Halfway through, your science officer finds a signal — low power, repeating, from inside a section of saucer hull that should be cold.',
        speaker: 'Science',
        choices: [
          { id: 'board', label: 'Board the wreck', next: 'aboard',
            effects: { check: { type: 'engineering', difficulty: 0.5, hazard: 'dangerous' }, xp: 250 } },
          { id: 'scan', label: 'Scan it thoroughly from here first', next: 'scanned',
            effects: { xp: 180, flag: 'wolf_scanned' } },
          { id: 'ignore', label: 'Complete the survey and leave', outcome: 'left',
            effects: { xp: 200, record: { anomaly_catalogued: 1 } } },
        ],
      },
      scanned: {
        text: 'The signal is a distress beacon on an eight-year-old Starfleet cipher, running off a dying cell. There is one life sign. It has been there the entire time, in stasis, in a medical pod that never got the order to stop.',
        speaker: 'Science',
        choices: [
          { id: 'board', label: 'Board immediately', next: 'aboard',
            effects: { check: { type: 'medical', difficulty: 0.4, hazard: 'elevated' }, xp: 300 } },
        ],
      },
      aboard: {
        text: 'The pod is intact. The occupant is alive, and has been alone in a dead ship for eight years without knowing it. Your CMO says the revival is survivable. Barely.',
        speaker: 'Away Team',
        choices: [
          // "The revival is survivable. Barely." Both of these rolled and both
          // went to the same waking either way, so the CMO's warning was
          // decoration and the careful option bought nothing: `transport` is
          // slower, easier and safer, and against an outcome that could not
          // fail it was strictly worse than `revive`. Now the two checks are
          // the decision.
          { id: 'revive', label: 'Revive them here',
            effects: { check: { type: 'medical', difficulty: 0.6, hazard: 'elevated' }, xp: 400 },
            branch: { success: 'revived', failure: 'lost_her' } },
          { id: 'transport', label: 'Move the pod intact to sickbay',
            effects: { check: { type: 'engineering', difficulty: 0.4, hazard: 'routine' }, xp: 350, time: 0.4 },
            branch: { success: 'revived', failure: 'lost_her' } },
        ],
      },
      lost_her: {
        // Eight years in a pod and she does not come out of it. This is what
        // the CMO meant by "barely", and until now nothing in the episode could
        // ever reach it.
        where: 'sickbay',
        text: 'The pod comes up through its stages and stops at the last one. Your CMO works for '
          + 'forty minutes and then stands back, and the room is quiet the way a room is when '
          + 'everybody in it has stopped being busy. Lieutenant Commander Aris Vell, tactical '
          + 'officer, USS Kyushu. She was on the casualty list for eight years and she was not on '
          + 'it, and now she is.',
        speaker: 'Sickbay',
        choices: [
          { id: 'log', label: 'Enter her name in the log yourself', outcome: 'too_late',
            effects: {
              xp: 500,
              record: { lives_lost: 1 },
              standing: { federation: 4 },
              flag: 'vell_lost',
            } },
        ],
      },
      revived: {
        // The speaker has said 'Sickbay' since this was written, and the text
        // says "nobody in the room wants to answer" — about a room the captain
        // was never in. `where` names the compartment a scene happens in; it
        // was read by the mission panel and set by no stage in the game.
        where: 'sickbay',
        text: 'She wakes. Lieutenant Commander Aris Vell, tactical officer, USS Kyushu. She asks whether the fleet held. Nobody in the room wants to answer.',
        speaker: 'Sickbay',
        choices: [
          { id: 'truth', label: 'Tell her the truth', outcome: 'rescued',
            effects: { xp: 900, record: { lives_saved: 1 }, standing: { federation: 12 },
              flag: 'rescued_vell', item: 'targeting_scanners' } },
          { id: 'later', label: 'Let the doctor handle it', outcome: 'rescued',
            effects: { xp: 700, record: { lives_saved: 1 }, standing: { federation: 8 }, flag: 'rescued_vell' } },
        ],
      },
    },
    start: 'start',
    endings: {
      rescued: { label: 'Survivor recovered',
        text: 'One name comes off the Wolf 359 casualty list, eight years late.' },
      left: { label: 'Survey filed',
        text: 'The signal is in your survey data. Someone will read it eventually.' },
      too_late: { label: 'Eight years too late',
        text: 'One name comes off the Wolf 359 missing list and goes onto the other one. '
          + 'The record shows she was found, which is not nothing, and is not what anybody wanted.' },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'rigel_syndicate', title: 'Business on Rigel', system: 'rigel', act: 2,
    summary: 'A Federation citizen is being held on Rigel VII, and the local authority is not interested.',
    stages: {
      start: {
        text: 'Doctor Elen Marru, xenobiologist, Federation citizen, has been held for six weeks by a Syndicate broker who calls it "a contract dispute." Rigel’s authority says it is a civil matter and closes the channel.',
        speaker: 'Communications',
        choices: [
          { id: 'legal', label: 'Work through the consulate', next: 'legal',
            effects: { xp: 150, time: 2 } },
          { id: 'covert', label: 'Send a covert team down', next: 'covert',
            effects: { check: { type: 'stealth', difficulty: 0.55, hazard: 'dangerous' } } },
          { id: 'force', label: 'Beam down armed and take her back', next: 'force',
            effects: { check: { type: 'combat', difficulty: 0.5, hazard: 'extreme' },
              standing: { orion: -18, independent: -10 } } },
        ],
      },
      legal: {
        text: 'The consul is apologetic and useless. But the broker’s name appears on a Ferengi trade filing, and Ferengi filings are public, and the filing lists an asset he is not supposed to have.',
        speaker: 'Consulate',
        choices: [
          { id: 'leverage', label: 'Use it as leverage', outcome: 'negotiated',
            requires: { skill: 'diplomacy', ranks: 2 },
            effects: { xp: 800, record: { lives_saved: 1 }, standing: { orion: -4, federation: 10 } } },
          { id: 'covert2', label: 'Send a team instead', next: 'covert',
            effects: { check: { type: 'stealth', difficulty: 0.45, hazard: 'dangerous' } } },
        ],
      },
      covert: {
        text: 'The team is inside. Marru is in a holding suite two levels down, and there are more guards than the intelligence suggested.',
        speaker: 'Away Team',
        choices: [
          // Both of these rolled and both banked `lives_saved: 1` and ended
          // `extracted` whatever came up — an EXTREME-hazard extraction, on a
          // Syndicate world, with more guards than the intelligence suggested,
          // that could not go wrong. The roll is the episode; it had no way to
          // say so.
          { id: 'quiet', label: 'Take her out quietly',
            effects: { check: { type: 'stealth', difficulty: 0.6, hazard: 'dangerous' }, xp: 400 },
            branch: { success: 'got_her', failure: 'blown' } },
          { id: 'loud', label: 'Go loud',
            effects: { check: { type: 'combat', difficulty: 0.45, hazard: 'extreme' },
              xp: 350, standing: { orion: -14 } },
            branch: { success: 'got_her', failure: 'blown' } },
        ],
      },
      got_her: {
        text: 'Two levels down, through a service corridor that is on no plan anybody sold us, and '
          + 'back out the way we came. Doctor Marru walks the last hundred metres herself and asks, '
          + 'on the pad, whether anybody thought to bring her notes.',
        speaker: 'Away Team',
        choices: [
          { id: 'up', label: 'Energise', outcome: 'extracted',
            effects: { xp: 400, record: { lives_saved: 1 } } },
        ],
      },
      blown: {
        // Failure that is a decision rather than a wall. She is still down
        // there; the question is what a captain does about it now.
        text: 'A guard rotation nobody briefed walks into the corridor behind the team. They are out '
          + 'and they are counted, and they are out without her — and the broker now knows exactly '
          + 'what the ship in orbit is willing to do. Marru is being moved within the hour.',
        speaker: 'Away Team',
        choices: [
          { id: 'again', label: 'Go back in, and not quietly this time', next: 'force',
            effects: { xp: 300, standing: { orion: -18, independent: -10 } } },
          { id: 'withdraw', label: 'Break orbit and file it', outcome: 'left_her',
            effects: {
              xp: 250, standing: { federation: -8 },
              record: { order_disobeyed: 0 },
              flag: 'marru_left',
            } },
        ],
      },
      force: {
        text: 'You have her. You also have a firefight on a neutral world, two dead Syndicate guards, and a formal complaint being filed before you reach orbit.',
        speaker: 'Away Team',
        choices: [
          { id: 'go', label: 'Beam up and leave', outcome: 'forced',
            effects: { xp: 500, record: { lives_saved: 1, lives_lost: 2 },
              standing: { federation: -10, independent: -12 } } },
        ],
      },
    },
    start: 'start',
    endings: {
      negotiated: { label: 'Negotiated release', text: 'She walks out. Nothing is on fire. The consul takes the credit.' },
      extracted: { label: 'Extracted', text: 'Marru is aboard. Rigel will complain, and will be ignored.' },
      forced: { label: 'Taken by force',
        text: 'Starfleet Judge Advocate requests a written account within the week.' },
      left_her: { label: 'Left on Rigel',
        text: 'The file stays open. Doctor Marru is a Federation citizen being held by a broker on '
          + 'a neutral world, and the last entry in the record is a starship breaking orbit.' },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'donatu_standoff', title: 'The Donatu Line', system: 'donatu_v', act: 3, minRank: 6,
    summary: 'Both fleets are at Donatu V again, and someone is going to fire first.',
    stages: {
      start: {
        text: 'Three Klingon ships, two of yours, and a disputed rock between them. Neither side has authority to withdraw and both have authority to respond. Your opposite number opens a channel before you do.',
        speaker: 'Tactical',
        choices: [
          { id: 'talk', label: 'Answer the hail', next: 'talk',
            effects: { xp: 200 } },
          { id: 'position', label: 'Move to a firing position first', next: 'talk',
            effects: { standing: { klingon: -6 }, setVar: { aggressive_posture: true }, xp: 150 } },
        ],
      },
      talk: {
        text: 'Their commander wants the same thing you do: not to be the one who starts a war over a mining claim. Neither of you can be seen to withdraw. He asks, obliquely, whether you have any suggestions.',
        speaker: 'Klingon commander',
        choices: [
          { id: 'joint', label: 'Propose a joint patrol schedule', next: 'joint',
            requires: { skill: 'diplomacy', ranks: 3 }, effects: { xp: 600 } },
          // Two fleets going to warp on a shared count, written as a near-miss
          // -- "It holds. Barely -- one of his birds-of-prey lags eleven
          // seconds" -- and it could not miss. `command`, because what is
          // being asked is whether both sides hold a count nobody trusts, and
          // `routine`, because the risk is to the peace and not to a body.
          { id: 'coin', label: 'Propose both fleets withdraw simultaneously',
            effects: {
              check: { type: 'command', difficulty: 0.5, hazard: 'routine' },
              xp: 400,
            },
            branch: { success: 'simul', failure: 'simul_ragged' } },
          { id: 'refuse', label: 'Tell him the Federation does not negotiate under guns', next: 'battle',
            effects: { standing: { klingon: -14 } } },
          // The other half of moving to a firing position before answering the
          // hail. He can see exactly where your ships are; an offer made from
          // there is a different offer, and both commands will read it that way.
          { id: 'from_strength', label: 'Offer the withdrawal from where you are standing',
            requires: { var: { aggressive_posture: true } },
            effects: {
              // Harder than the plain proposal, and the episode already says
              // why: he can see where your ships are, and an offer made from
              // there is a different offer that both commands will read as one.
              check: { type: 'command', difficulty: 0.6, hazard: 'routine' },
              xp: 500, standing: { klingon: -8, federation: 10 },
              flag: 'donatu_pressed',
            },
            branch: { success: 'simul', failure: 'simul_ragged' } },
        ],
      },
      joint: {
        text: 'A rotating patrol, alternating weeks, both flags logged. It is bureaucratic, undignified, and it works. His tactical officer looks appalled. He signs anyway.',
        speaker: 'Klingon commander',
        choices: [
          { id: 'done', label: 'Transmit it to both commands', outcome: 'accord',
            effects: { xp: 1400, standing: { klingon: 25, federation: 18 },
              record: { treaty_signed: 1 }, flag: 'donatu_accord' } },
        ],
      },
      simul: {
        text: 'Both fleets go to warp on a shared count. It holds. Barely — one of his birds-of-prey lags eleven seconds and your tactical officer’s hand does not leave the console.',
        speaker: 'Bridge',
        choices: [
          { id: 'done', label: 'Log it', outcome: 'defused',
            effects: { xp: 800, standing: { klingon: 12, federation: 10 } } },
        ],
      },
      simul_ragged: {
        // The count does not hold, and the episode does NOT decide what happens
        // next. A check that failed straight into a war would be a coin flip
        // for a shooting match; what it produces instead is the moment, and the
        // captain still chooses. Both ways out are here.
        text: 'The count runs and one of his birds-of-prey does not break with it. She sits where '
          + 'she was with her disruptors hot and the rest of both fleets already at warp, and for '
          + 'nine seconds the only two ships in the Donatu system are yours and hers. Your tactical '
          + 'officer has a firing solution and is waiting to be told.',
        speaker: 'Tactical',
        choices: [
          { id: 'hold', label: 'Hold. Nobody fires today', outcome: 'defused',
            effects: {
              xp: 900, standing: { klingon: 16, federation: 4 },
            } },
          { id: 'fire', label: 'She is the only one still here. Fire', next: 'battle',
            effects: { standing: { klingon: -20 } } },
        ],
      },
      battle: {
        text: 'He closes the channel. Both fleets are moving.',
        speaker: 'Tactical',
        choices: [
          { id: 'fight', label: 'Engage', outcome: 'battle',
            effects: { combat: { faction: 'klingon', ships: ['d7', 'bird_of_prey'] },
              xp: 900, standing: { klingon: -25 }, flag: 'donatu_battle' } },
        ],
      },
    },
    start: 'start',
    endings: {
      accord: { label: 'Donatu Accord',
        text: 'Two admiralties are furious and neither can argue with a document both fleets already signed.' },
      defused: { label: 'Defused', text: 'Nobody fired. The claim is still disputed. That is the job.' },
      battle: { label: 'Second Battle of Donatu',
        text: 'The historians will name it. The families will not care what it is called.' },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'court_martial', title: 'Board of Inquiry', system: 'starbase_11', act: 3,
    requiresFlag: 'inquiry_summoned',
    summary: 'Starfleet has questions about your command, and this time they are formal.',
    stages: {
      start: {
        // Conference room four, Starbase 11. Not a compartment of this ship, so
        // the room gate does not apply — but the DEFAULT is 'bridge', and the
        // engine enforces it now, so a scene that is not aboard has to say so.
        where: 'anywhere',
        text: 'Starbase 11, conference room four. Three flag officers, a JAG advocate, and your own service record on the table between you. The advocate begins reading it aloud.',
        speaker: 'Judge Advocate',
        choices: [
          { id: 'defend', label: 'Defend every decision', next: 'defence',
            effects: { xp: 200 } },
          { id: 'accept', label: 'Accept responsibility without qualification', next: 'accept',
            effects: { xp: 300, standing: { federation: 6 } } },
          { id: 'blame', label: 'Cite your orders and the conditions', next: 'defence',
            effects: { xp: 150, flag: 'deflected_blame' } },
        ],
      },
      defence: {
        where: 'anywhere',
        text: 'You argue it through. The board listens. Your first officer is called and asked, under oath, whether they ever considered relieving you.',
        speaker: 'Judge Advocate',
        choices: [
          { id: 'let_speak', label: 'Let them answer honestly', next: 'verdict',
            effects: { xp: 400 } },
          { id: 'object', label: 'Object to the question', next: 'verdict',
            effects: { xp: 100, standing: { federation: -6 } } },
        ],
      },
      accept: {
        where: 'anywhere',
        text: 'The advocate stops reading. One of the admirals leans back. "That is the first useful thing anyone has said in this room today."',
        speaker: 'Admiral',
        choices: [
          { id: 'continue', label: 'Wait for the verdict', next: 'verdict', effects: { xp: 300 } },
        ],
      },
      verdict: {
        where: 'anywhere',
        text: 'The board withdraws for four hours and returns.',
        speaker: 'Board of Inquiry',
        choices: [
          { id: 'hear', label: 'Stand for the finding', outcome: 'verdict',
            effects: { xp: 600 } },
        ],
      },
    },
    start: 'start',
    endings: {
      verdict: { label: 'Finding delivered',
        text: 'The finding is entered into your record, where it stays.',
        effects: { flag: 'inquiry_resolved' } },
    },
  },

  // -------------------------------------------------------------------------
  // Act 1 had two episodes and act 3 had seven, and act 1 is the one every
  // captain plays. It is also the only act that can grow: `echoes.test.js`
  // holds the spread across acts to five and it sits at exactly five, so an
  // episode anywhere else fails that guard and one here loosens it.
  //
  // Set where `shakedown` already sends you. The trials happen at Alpha
  // Centauri, so this is what is waiting when the ship arrives — a decision
  // three weeks into a commission, taken by somebody with no record yet, that
  // the Klingons are still referring to in year five.
  {
    id: 'centauri_drift', title: 'The Drift at Alpha Centauri', system: 'alpha_centauri', act: 1,
    summary: 'A Klingon scout is adrift inside Federation space, and has not asked for help.',
    stages: {
      start: {
        text: 'A hull on the long-range sensors, eleven million kilometres out and not under power. '
          + 'The configuration is a Klingon scout — a small one, the kind that carries eleven or twelve '
          + 'people. It is inside Federation space by three light-years and it is not transmitting.',
        speaker: 'Communications',
        choices: [
          { id: 'scan', label: 'Take a close look before anything else', next: 'scanned',
            effects: { xp: 80 } },
          { id: 'hail', label: 'Open a channel', next: 'hailed',
            effects: { xp: 60 } },
          { id: 'report', label: 'Signal Starfleet and hold station', next: 'orders',
            effects: { xp: 40, flag: 'centauri_reported' } },
        ],
      },
      scanned: {
        text: 'Their reactor is failing — not failed, failing, which is a slower and worse thing. '
          + 'Eleven life signs, all forward of the breach. Weapons are cold and have been for hours. '
          + 'Science puts the reactor somewhere under nine hours from the end of its argument.',
        speaker: 'Science',
        choices: [
          { id: 'hail_now', label: 'Open a channel', next: 'hailed',
            effects: { xp: 100, record: { anomaly_catalogued: 1 } } },
          { id: 'stand_off', label: 'Hold at this range and keep watching', next: 'orders',
            effects: { xp: 60, flag: 'centauri_reported' } },
        ],
      },
      hailed: {
        text: 'The channel opens on the fourth attempt. The officer who answers is a lieutenant, '
          + 'because everybody senior to her is dead or holding the bulkhead shut. She says the ship '
          + 'is under control, that they require nothing, and that we are to note in our log that they '
          + 'require nothing. Behind her somebody is shouting numbers.',
        speaker: 'Klingon lieutenant',
        choices: [
          { id: 'press', label: 'Tell her what our sensors say', next: 'orders',
            effects: { xp: 140, setVar: { refused: false } } },
          { id: 'accept', label: 'Note it in the log, as asked', next: 'orders',
            effects: { xp: 80, setVar: { refused: true } } },
        ],
      },
      orders: {
        text: 'Starfleet Command acknowledges at four hours and eleven minutes. The reply is that '
          + 'a foreign warship inside Federation space is a matter for Starfleet Command, that '
          + 'Starfleet Command is considering it, and that the ship on station is best placed to '
          + 'judge. Your first officer reads it twice and says that it means nothing at all.',
        speaker: 'Starfleet Command',
        choices: [
          {
            id: 'proceed',
            label: 'Decide it here',
            next: Object.assign((m) => (m.vars.refused ? 'decision_refused' : 'decision'), {
              targets: ['decision', 'decision_refused'],
              reads: 'refused',
            }),
            effects: { xp: 120 },
          },
          { id: 'defer', label: 'Wait for a real answer', outcome: 'handed_over',
            effects: { xp: 200, record: { order_disobeyed: 0 } } },
        ],
      },
      decision: {
        text: 'Six hours left on the reactor, by our numbers and now by theirs too. The transporter '
          + 'room can reach them. Engineering thinks two people and a bypass could hold the '
          + 'containment long enough to get the ship home. Neither is a thing anybody has to do.',
        speaker: 'First Officer',
        choices: [
          { id: 'beam', label: 'Take them off', outcome: 'towed',
            effects: {
              xp: 900, time: 0.4,
              record: { lives_saved: 11, distress_answered: 1 },
              standing: { klingon: 14 },
              flag: 'centauri_aid',
            } },
          // Two of your people, onto a Klingon reactor that is nine hours from
          // the end of its argument. This was the best-paying choice on the
          // board and it could not fail — 1,100 experience and eighteen points
          // of Klingon standing for pressing a button.
          //
          // `dangerous` is a 6% chance somebody does not come back, and it is
          // the right band: the scene is a containment breach in progress and
          // the reward is the largest in the episode. The check decides whether
          // the bypass holds, and the two endings are different ships.
          { id: 'repair', label: 'Send two people across with a bypass',
            effects: {
              check: { type: 'engineering', difficulty: 0.55, hazard: 'dangerous' },
              xp: 300, time: 0.6,
            },
            branch: { success: 'bypass_held', failure: 'bypass_failed' } },
          { id: 'watch', label: 'Hold station and watch', outcome: 'watched',
            effects: { xp: 300, standing: { klingon: -10 }, flag: 'centauri_watched' } },
        ],
      },
      bypass_held: {
        text: 'The bypass takes. Containment steadies at a number nobody aboard either ship would '
          + 'call comfortable and both would call holding, and the shouting behind the lieutenant '
          + 'stops. Her chief engineer and ours argue about the method for six minutes, which is '
          + 'how engineers say thank you.',
        speaker: 'Engineering',
        choices: [
          { id: 'ok', label: 'Take her under tow', outcome: 'towed',
            effects: {
              xp: 800, damage: 0.04,
              record: { lives_saved: 11, distress_answered: 1 },
              standing: { klingon: 18 },
              flag: 'centauri_aid',
            } },
        ],
      },
      bypass_failed: {
        text: 'The bypass does not take. The containment field steps down through three settings in '
          + 'ninety seconds and our people come off that ship with the Klingons rather than ahead of '
          + 'them. Eleven aboard and two of ours hurt getting them, and the scout goes up eight '
          + 'minutes after the last pad cycles.',
        speaker: 'Engineering',
        choices: [
          { id: 'ok', label: 'Log it as it happened', outcome: 'towed',
            effects: {
              xp: 500, damage: 0.04,
              // The people still live. The SHIP does not, which is what the
              // Klingons will remember and why this pays less standing than the
              // bypass that held.
              record: { lives_saved: 11, distress_answered: 1 },
              standing: { klingon: 8 },
              flag: 'centauri_aid',
            } },
        ],
      },
      decision_refused: {
        text: 'She said they required nothing and we wrote it down. Six hours left on their reactor. '
          + 'The log will show that they refused, which is true, and that we believed them, which is '
          + 'a different kind of true.',
        speaker: 'First Officer',
        choices: [
          { id: 'anyway', label: 'Take them off anyway', outcome: 'towed',
            effects: {
              xp: 1000, time: 0.4,
              record: { lives_saved: 11, distress_answered: 1 },
              standing: { klingon: 10 },
              flag: 'centauri_aid',
            } },
          { id: 'stand', label: 'Stand by the log', outcome: 'watched',
            effects: { xp: 400, standing: { klingon: -6 }, flag: 'centauri_watched' } },
        ],
      },
    },
    start: 'start',
    endings: {
      towed: {
        label: 'Eleven aboard',
        text: 'They come across in threes, and the lieutenant comes last, which is correct. She does '
          + 'not thank anybody and does not have to. The scout is under tow to the nearest yard '
          + 'before the reactor finishes what it started.',
      },
      watched: {
        label: 'We watched',
        text: 'The reactor goes at seven hours and forty minutes. It is very bright and very quick '
          + 'and then there is nothing on the sensors at all. The log is accurate in every particular.',
      },
      handed_over: {
        label: 'Referred to Command',
        text: 'A cruiser arrives in eleven hours with orders and a tractor beam. Whatever happened '
          + 'aboard that scout in the meantime happened without us, and is somebody else\u2019s report.',
      },
    },
  },
];
