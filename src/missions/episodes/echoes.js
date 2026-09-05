// Episodes 23-24: the raid you flew before anyone knew your name, and the
// thing you learned about the Borg and were never asked about again.
//
// The second instalment of the work started in `consequences.js`. That one
// found sixty-three flags written and thirteen gated on; this one goes after
// two of the biggest seams left.
//
//   vega_saved / vega_grid_restored   `vega_raid`, ACT 1. The second episode
//                                     in the game. Whether the colonists got
//                                     medical teams and whether the defence
//                                     grid came back up — recorded, and read
//                                     by nothing for the rest of a five-year
//                                     commission.
//
//   borg_warned / borg_data /         `the_cube`, ACT 4. Whether you shadowed
//   borg_hurt                         a cube and took readings, whether you
//                                     broke off to warn the colonies on its
//                                     route, and whether you put a torpedo
//                                     through the window when it opened.
//                                     Three of the largest decisions in the
//                                     book, and nothing ever mentioned them.
//
// They are placed in DIFFERENT ACTS on purpose. `consequences.js` put both of
// its episodes in act 5, which was right for what they were and left the book
// bottom-heavy: act 1 has two episodes and act 5 had four. A consequence does
// not have to wait for the end of the commission — it only has to come after
// the thing it reads. Vega is act 1, so its payoff is act 3, and a captain
// meets it while the raid is still recent.
//
// And they chain to each other. `The Vega Line` writes the standing order for
// colony defence; `What the Cube Left` is where the frontier either has that
// order or does not. A flag written in act 3 and read in act 5, which is the
// shape the whole exercise is for.

/** Routing that reads what the captain did. See consequences.js. */
const onVar = (key, ifSet, ifNot) => {
  const route = (m) => (m.vars[key] ? ifSet : ifNot);
  route.targets = [ifSet, ifNot];
  route.reads = key;
  return route;
};

/** Whether you told the committee what the raid was actually like. */
const afterTheHearing = onVar('said_the_hard_part', 'the_draft', 'the_summary');

export const ECHO_EPISODES = [
  // -------------------------------------------------------------------------
  {
    id: 'vega_line', title: 'The Vega Line', system: 'starbase_1',
    act: 3, minRank: 6,
    // Act 1, read in act 3. `vega_raid` has no rank gate at all — it is the
    // second episode in the game — so this is the longest reach backwards in
    // the book and still lands while the raid is recent.
    requiresCompleted: ['vega_raid'],
    summary: 'Starfleet is writing the standing order for colony defence, and the archive has your Vega report.',
    stages: {
      start: {
        text: 'Starbase 1 is Earth orbit and paperwork. A drafting committee is writing the standing order for what a starship does when it arrives at a raided colony, and they have pulled every report of the last four years. Yours is on the table. Commodore Aluko says the committee has read it twice and cannot agree on what it proves.',
        speaker: 'Commodore Aluko',
        where: 'anywhere',
        choices: [
          { id: 'attend', label: 'Sit with the committee', next: 'hearing',
            effects: { xp: 500 } },
          { id: 'read', label: 'Ask to read your own report again first',
            next: 'archive', effects: { xp: 600 } },
          { id: 'decline', label: 'Say a standing order is the wrong instrument',
            outcome: 'no_order', effects: { xp: 400, standing: { federation: -4 } } },
        ],
      },

      archive: {
        text: 'The archive copy is shorter than you remember writing it. It records that the raiders were driven off and the colony held. It does not record the four hours between those two facts, or what the four hours were spent on, because there was no field in the form for it and you were a very new captain.',
        speaker: 'Fleet archive',
        where: 'anywhere',
        choices: [
          { id: 'sit', label: 'Take it to the committee as it stands',
            next: 'hearing', effects: { xp: 500 } },
          { id: 'amend', label: 'Amend it, four years late', next: 'hearing',
            effects: { xp: 800, standing: { federation: 4 } } },
        ],
      },

      hearing: {
        text: 'The committee wants a rule, and a rule needs a first move: does a ship that arrives at a raided colony fight, or does it get the grid up and the wounded off? Half the room has never been to one. The other half has and does not agree with itself.',
        speaker: 'Drafting committee',
        where: 'briefing',
        choices: [
          { id: 'fight', label: 'Say the ship engages first, every time',
            next: 'the_summary', effects: { xp: 700 } },
          { id: 'both', label: 'Say the question is wrong and explain why',
            next: afterTheHearing,
            effects: { xp: 900, setVar: { said_the_hard_part: true } } },
          // The grid at Vega, in act one, when it was your problem and nobody
          // was writing a rule about it.
          { id: 'grid', label: 'Describe getting the grid up under fire',
            next: 'the_draft', requires: { flag: 'vega_grid_restored' },
            effects: { xp: 1200, setVar: { said_the_hard_part: true } } },
          // And the teams you sent down afterwards.
          { id: 'teams', label: 'Describe what the medical teams found on the ground',
            next: 'the_draft', requires: { flag: 'vega_saved' },
            effects: { xp: 1200, setVar: { said_the_hard_part: true } } },
        ],
      },

      the_summary: {
        text: 'The order is drafted in a morning and it is clean: engage, then assist. It will be taught at the Academy in that order and it will be right most of the time. Aluko signs it and observes, to nobody, that most of the time is a strange standard for a document that exists for the other times.',
        speaker: 'Commodore Aluko',
        where: 'anywhere',
        choices: [
          { id: 'let', label: 'Let it stand', outcome: 'clean_order',
            effects: { xp: 700, standing: { federation: 6 } } },
          { id: 'reopen', label: 'Reopen it and take the afternoon',
            next: 'the_draft', effects: { xp: 900 } },
        ],
      },

      the_draft: {
        text: 'What goes in instead is longer and worse to teach: that the first move depends on whether the grid can be brought up inside the hour, that a captain must find that out before choosing, and that finding it out is itself the first move. Two admirals think it is unteachable. Aluko thinks that is the most honest objection anyone has raised all week.',
        speaker: 'Commodore Aluko',
        where: 'anywhere',
        choices: [
          { id: 'sign', label: 'Put your name to it', outcome: 'vega_line',
            effects: { xp: 1500, standing: { federation: 14 },
              record: { commendation: 1 }, flag: 'grid_doctrine' } },
        ],
      },
    },
    start: 'start',
    endings: {
      vega_line: {
        label: 'The Vega line',
        text: 'It is taught badly and it is taught. Somewhere out past the frontier a captain who has never heard of you spends fifty minutes on a colony grid instead of a firing solution, and the colony is still there afterwards, and nobody writes that down either.',
      },
      clean_order: {
        label: 'Engage, then assist',
        text: 'The order is clean, memorable and correct most of the time. It goes into the Academy syllabus that year. It is a good rule.',
      },
      no_order: {
        label: 'No standing order',
        text: 'The committee thanks you and drafts it without you. It says engage first. It was always going to say engage first; that is what committees say when the room has never been to one.',
      },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'beta_reticuli', title: 'What the Cube Left', system: 'frontier_1',
    act: 5, minRank: 8,
    // `the_cube` is act 4 and sets three flags that nothing read: whether you
    // shadowed it for readings, whether you broke off to warn the colonies on
    // its route, and whether you fired into the window when it opened. All
    // three change what a captain can do out here.
    requiresCompleted: ['the_cube'],
    summary: 'Beta Reticuli was charted once by a survey ship that never filed a second report. Now something out here is answering.',
    stages: {
      start: {
        text: 'Beta Reticuli has one entry in the catalogue and it is four lines long, filed by a survey ship that charted the system briefly and did not come back to correct anything. Long-range sensors have been picking up a repeating structure from the fourth planet for eleven days. It is not a distress call. It is a survey pattern, run methodically, by something that has been running it for a very long time.',
        speaker: 'Science officer',
        where: 'anywhere',
        choices: [
          { id: 'close', label: 'Close and look', next: 'the_wreck',
            effects: { xp: 700 } },
          // What you took off the cube at Gamma Hydra.
          //
          // No `setVar` here. A first draft set `knew_the_signature` and
          // `tests/episodevars.test.js` caught that nothing routes on it —
          // the same defect as an unread flag, one layer down, and the second
          // time in two instalments that a draft of mine wrote something
          // nobody reads. The `borg_data` gate is already the whole
          // differentiation: the choice does not exist for a captain who
          // never took the readings.
          { id: 'compare', label: 'Compare it against the readings you took off the cube',
            next: 'the_wreck', requires: { flag: 'borg_data' },
            effects: { xp: 1100 } },
          { id: 'report', label: 'Report it and hold at the system edge',
            outcome: 'reported', effects: { xp: 500 } },
        ],
      },

      the_wreck: {
        text: 'A Borg scout, down on the fourth planet, and down a long time — the hull is half buried and the local weather has been working on it for decades. It is not dead. Something in it is still surveying, patiently, on a schedule, and has been transmitting the results to nobody for longer than the Federation has had a starbase in this quadrant.',
        speaker: 'Science officer',
        where: 'anywhere',
        choices: [
          { id: 'study', label: 'Study it where it lies', next: 'the_choice',
            effects: { xp: 900 } },
          { id: 'destroy', label: 'Destroy it from orbit and log the position',
            outcome: 'buried', effects: { xp: 800, record: { first_contact: 1 } } },
          // Warning the colonies at Gamma Hydra is what makes this reflex.
          { id: 'colonies', label: 'Signal every colony in range before touching it',
            next: 'the_choice', requires: { flag: 'borg_warned' },
            effects: { xp: 1300, standing: { federation: 8 } } },
        ],
      },

      the_choice: {
        text: 'The survey it is running is of THIS system, over and over, and the transmission is a report on what is worth taking. It has been rewritten four times. The fourth revision is recent. Whatever it is reporting to has not answered in decades and it is still filing, which your science officer says is the single most frightening thing she has ever read.',
        speaker: 'Science officer',
        where: 'anywhere',
        choices: [
          { id: 'silence', label: 'Silence it and take the fourth revision with you',
            outcome: 'the_revision', effects: { xp: 1600, record: { first_contact: 1 } } },
          // You have done this before, to something very much larger.
          { id: 'window', label: 'Wait for the survey cycle to open and put one torpedo through it',
            outcome: 'the_revision', requires: { flag: 'borg_hurt' },
            effects: { xp: 1900, record: { first_contact: 1 } } },
          // The order you wrote at Starbase 1, being used at the far end of it.
          { id: 'grid', label: 'Leave it running and put a defence grid on the colony instead',
            outcome: 'the_grid', requires: { flag: 'grid_doctrine' },
            effects: { xp: 2000, standing: { federation: 12 },
              record: { commendation: 1 } } },
          { id: 'leave', label: 'Leave it exactly as found and mark the system',
            outcome: 'marked', effects: { xp: 900 } },
        ],
      },
    },
    start: 'start',
    endings: {
      the_revision: {
        label: 'The fourth revision',
        text: 'The scout stops filing. The fourth revision goes to Starfleet Intelligence, who confirm that it lists the system\'s population, its yield and its distance from three others, and who decline to say what they will do with it. Beta Reticuli gets a second entry in the catalogue, forty years late.',
      },
      the_grid: {
        label: 'A grid instead',
        text: 'You leave it filing and give the colony something worth filing about: a defence grid, up and crewed, built to the standing order you put your name to at Starbase 1. If the thing it reports to ever answers, the answer arrives at a system that is ready. That is the whole of the doctrine, and this is the far end of it.',
      },
      buried: {
        label: 'Buried',
        text: 'Orbital fire, and the fourth planet has a new crater. Whatever the scout had learned about this system goes with it. So does whatever anyone might have learned from what it had learned.',
      },
      marked: {
        label: 'Marked and left',
        text: 'The system gets a beacon and a warning and you leave what is down there exactly as you found it, which is filing. It is still filing. Somebody else will have to decide.',
      },
      reported: {
        label: 'Reported from the edge',
        text: 'You hold at the system edge and send the pattern to Starfleet, who thank you and dispatch a science vessel in nine weeks. Nine weeks is a long time to a thing that has been counting in decades, and it does not appear to mind.',
      },
    },
  },
];
