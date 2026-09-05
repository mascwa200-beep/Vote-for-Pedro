// Episode 25: the one that happens aboard.
//
// The census in RESEARCH §69 counted every scene in the book against the
// seventeen compartments a captain can walk to. Seven stages of a hundred and
// nineteen named a room, and TEN ROOMS had never hosted a scene at all: the
// captain's own quarters, crew quarters, the rec deck, cargo, the hangar,
// auxiliary control, the turbolift and all three corridors.
//
// That is not a defect in those rooms. It is what happens when every episode is
// written as a thing the ship arrives at. Twenty-four of them are about a
// system, a border, a hearing or a hull, and the bridge is where you deal with
// all of those — so the bridge is where they all are.
//
// This one is about the ship. Every stage after the first is `system: null`,
// which the engine has always supported and nothing has ever used: the ship can
// be anywhere, and it will be, because the answer takes six weeks and the
// captain is walking his own decks to find it. Seven compartments, five of them
// used for the first time.
//
// The walking IS the episode, and the summary says so, because a player who
// takes this expecting a bridge scene has been misled by every other entry in
// the book.
//
// Two details are lifted straight out of the simulation rather than invented:
//
//   auxiliary control is dark and empty at normal alert — `sim/occupancy.js`
//   says so in its own comment, "dark and empty while the bridge is answering,
//   and manned the moment it might not be"
//
//   the rec deck holds six people at every alert, more than any other
//   compartment aboard, which is why it is where the ship's own opinion lives
//
// Nobody is a saboteur and nobody is a spy. The whole of it is a rating who
// wanted to reach a hospital on Earth and a captain who has to write down what
// he did about it.

/** Routing that reads what the captain did. See frontier.js for the pattern. */
const onVar = (key, ifSet, ifNot) => {
  const route = (m) => (m.vars[key] ? ifSet : ifNot);
  route.targets = [ifSet, ifNot];
  route.reads = key;
  return route;
};

/** Whether the captain went down to look or had it brought to him. */
const afterTheDraw = onVar('went_below', 'dark_room', 'the_summary');

export const LONG_WATCH_EPISODES = [
  // -------------------------------------------------------------------------
  {
    id: 'long_watch', title: 'The Long Watch', system: 'deep_1',
    act: 4, minRank: 7,
    summary: 'An intermittent draw on auxiliary that nobody ordered. The answer is not on the bridge, and it is not in a scan.',
    stages: {
      start: {
        // The only stage anchored to a star system. Everything after it is
        // `system: null` — the ship goes on with its transit while the captain
        // works out what is happening inside it.
        text: 'Six weeks out from the last relay, on a heading that will not raise another for five more. Engineering reports an intermittent draw on auxiliary — eleven minutes at a time, twice a week, always on the middle watch. It is not enough to matter and it is not a fault anybody can find, and your chief engineer has stopped calling it a fault.',
        speaker: 'Engineering',
        choices: [
          { id: 'go', label: 'Go down and look at it yourself', next: 'the_draw',
            effects: { xp: 400, setVar: { went_below: true } } },
          { id: 'report', label: 'Have it traced and reported to the bridge',
            next: 'the_draw', effects: { xp: 300 } },
          { id: 'ignore', label: 'It is eleven minutes. Let it alone',
            outcome: 'let_alone', effects: { xp: 200 } },
        ],
      },

      the_draw: {
        where: 'engineering', system: null,
        text: 'The chief has the trace up and will not sit down. It is not a leak — a leak wanders. This is a LOAD. Something aboard is asking for that power, politely, on a schedule, and the request is not coming from this console. She has narrowed it to two places it could be entered from, and she does not like either of them.',
        speaker: 'Chief engineer',
        choices: [
          { id: 'trace', label: 'Ask her which two', next: afterTheDraw,
            effects: { xp: 600 } },
          { id: 'stores', label: 'Start with what the ship is short of', next: 'manifest',
            effects: { xp: 500 } },
          { id: 'fault', label: 'Log it as an intermittent fault and let her rebuild the run',
            outcome: 'a_fault_in_the_grid', effects: { xp: 400 } },
        ],
      },

      the_summary: {
        // For a captain who had it brought to him. He gets the same two names
        // and has to go anyway; the difference is that the ship watched him
        // decide to.
        where: 'anywhere', system: null,
        text: 'The summary reaches the bridge on a padd: auxiliary control on deck eight, or the cargo transporter on deck seven. Both are compartments with nobody in them at 0300, and both are two decks and a turbolift away from anybody who could ask what you were doing there.',
        speaker: 'Chief engineer',
        choices: [
          { id: 'deck8', label: 'Deck eight, then', next: 'dark_room', effects: { xp: 500 } },
          { id: 'stores', label: 'Deck seven, and the manifest', next: 'manifest',
            effects: { xp: 500 } },
        ],
      },

      dark_room: {
        where: 'auxcontrol', system: null,
        text: 'Auxiliary control is dark, because auxiliary control is dark whenever the bridge is answering — that is the entire reason deck eight has a second bridge in it. Somebody has been working down here on the middle watch and putting the board back afterwards. Putting a board back takes longer than using it, and nobody does it unless they mean to come again.',
        speaker: 'Auxiliary control',
        choices: [
          { id: 'stores', label: 'Find out what they have been drawing from stores',
            next: 'manifest', effects: { xp: 700 } },
          { id: 'wait', label: 'Sit down in the dark and wait for the middle watch',
            next: 'middle_watch', effects: { xp: 900, setVar: { sat_in_the_dark: true } } },
        ],
      },

      manifest: {
        where: 'cargo', system: null,
        text: 'The manifest is short by two subspace emitter couplings and a power cell, signed out against a repair order that was never opened. The signature is a rating\'s — communications, three years aboard, no marks against her either way. She signed her own name in her own hand on a form nobody reads.',
        speaker: 'Cargo manifest',
        choices: [
          { id: 'bunk', label: 'Go and look at her quarters', next: 'the_bunk',
            effects: { xp: 700 } },
          { id: 'deck', label: 'Go where the ship talks to itself', next: 'the_deck',
            effects: { xp: 700 } },
          { id: 'wait', label: 'Skip all of it and be in auxiliary control at 0300',
            next: 'middle_watch', effects: { xp: 800, setVar: { sat_in_the_dark: true } } },
        ],
      },

      the_bunk: {
        where: 'crewquarters', system: null,
        text: 'Deck three, and three people live in this compartment. Nothing is hidden, because she did not expect anybody to come and would not have known how to hide it if she had. There is a padd on the bunk with a letter on it, six weeks old and not finished, addressed to a hospital in Sydney. It has been opened and added to and closed again more times than it has words in it.',
        speaker: 'Crew quarters',
        choices: [
          { id: 'read', label: 'Read it', next: 'the_deck',
            effects: { xp: 900, setVar: { read_the_letter: true } } },
          { id: 'leave', label: 'Put it back exactly as you found it', next: 'the_deck',
            effects: { xp: 700 } },
        ],
      },

      the_deck: {
        where: 'rec', system: null,
        text: 'The rec deck holds more of your people at once than any other compartment aboard, and every one of them stops talking when you come in, which is its own answer. They have known for a month. Two of them have been standing her watches so she could be somewhere else. Nobody will say her name and nobody has to.',
        speaker: 'Recreation deck',
        choices: [
          { id: 'ask', label: 'Ask them, and let them decide whether to answer',
            next: 'middle_watch', effects: { xp: 900 } },
          { id: 'order', label: 'Make it an order', next: 'middle_watch',
            effects: { xp: 500, standing: { federation: -2 } } },
          { id: 'leave', label: 'Say nothing, and be in auxiliary control at 0300',
            next: 'middle_watch', effects: { xp: 1000, setVar: { sat_in_the_dark: true } } },
        ],
      },

      middle_watch: {
        where: 'auxcontrol', system: null,
        // Trimmed after rendering it at 412 px. The first draft ran 461
        // characters — the longest stage text in the book by fifty-five, above
        // a median of 223 — and on a phone it filled the screen and pushed
        // every choice below the fold. The climax earns some length; it does
        // not earn being an outlier.
        text: 'At 0300 she comes in with a case and stops dead in the doorway. In it are two emitter couplings, a power cell and eleven minutes of subspace carrier, aimed back along the track at a relay six weeks behind us. It works. It has worked twice. It also puts an eleven-minute fix on this ship\'s position across a great deal of empty space. She knows that. She has done it anyway, and she says nothing in her own defence.',
        speaker: 'Petty Officer Ile Marchetti',
        choices: [
          { id: 'charge', label: 'Take the case. Charge her', next: 'the_cell',
            effects: { xp: 800 } },
          { id: 'stop', label: 'Take the case. No charge, and no more of it',
            next: 'the_write_up', effects: { xp: 1000 } },
          { id: 'finish', label: 'Tell her to finish the transmission while you stand there',
            next: 'the_write_up',
            effects: { xp: 1400, flag: 'let_the_signal_go' } },
          // Only a captain who was already sitting there when she came in.
          // He sees the part nobody else could: that she brings the sensor
          // picture up first, every time, and will not key the carrier while
          // there is a contact anywhere on it. She has been managing the risk
          // she is being accused of taking, and there is no way to learn that
          // except by being in the room before she was.
          { id: 'watched', label: 'Say nothing, and watch what she does before she keys it',
            next: 'the_write_up', requires: { var: { sat_in_the_dark: true } },
            effects: { xp: 1700, flag: 'let_the_signal_go' } },
          // Only a captain who read the letter knows what it says, and that is
          // the whole difference between a rule broken and a person breaking
          // it. He does not have to have gone looking — but he did.
          { id: 'sit', label: 'Sit down and ask her about her mother',
            next: 'the_write_up', requires: { var: { read_the_letter: true } },
            effects: { xp: 1600, flag: 'let_the_signal_go' } },
        ],
      },

      the_cell: {
        where: 'brig', system: null,
        text: 'The cells have been empty since you sailed and now they are not. She sits down without being told where and asks only whether the ship is going to be told what she did, or whether it will be a rating removed from the watch bill with no reason given — because the second one, she says, will be worse for everybody still standing those watches.',
        speaker: 'Petty Officer Ile Marchetti',
        choices: [
          { id: 'hold', label: 'She stays here until Starbase', next: 'the_write_up',
            effects: { xp: 800, standing: { federation: 4 } } },
          { id: 'release', label: 'Release her to quarters and confine her there',
            next: 'the_write_up', effects: { xp: 1000 } },
        ],
      },

      the_write_up: {
        where: 'quarters', system: null,
        text: 'Your own quarters, at an hour when nothing is happening anywhere on this ship, and the desk with the log recorder on it. Whatever happened on deck eight is now a thing that happened, and what it becomes is entirely a question of which words go into that recorder tonight.',
        speaker: "Captain's quarters",
        choices: [
          { id: 'truth', label: 'Log it exactly as it happened, name and all',
            outcome: 'on_the_record',
            effects: { xp: 1500, standing: { federation: 8 }, flag: 'logged_the_watch' } },
          // Only a captain who let the carrier go. There is a version of this
          // entry in which the breach is his, because the last eleven minutes
          // of it happened with him standing there — and that version costs
          // him rather than her.
          { id: 'mine', label: 'Log that the transmission went out on your authority',
            outcome: 'on_the_record', requires: { flag: 'let_the_signal_go' },
            effects: { xp: 2000, standing: { federation: -6 },
              record: { commendation: 1 },
              flag: ['logged_the_watch', 'the_watch_stood'] } },
          { id: 'fault', label: 'Log an intermittent fault in the auxiliary run',
            outcome: 'a_fault_in_the_grid',
            effects: { xp: 900, flag: 'logged_a_fault' } },
          { id: 'both', label: 'Log the breach, and log what the crew did about it',
            outcome: 'on_the_record',
            effects: { xp: 1800, standing: { federation: 12 },
              record: { commendation: 1 },
              flag: ['logged_the_watch', 'the_watch_stood'] } },
        ],
      },
    },
    start: 'start',
    endings: {
      on_the_record: {
        label: 'On the record',
        text: 'It goes in as it happened, which means it will be read by people who were not there and who will have a view. That is what a record is for. Six weeks later a relay picks up a Starfleet signal it has no traffic order for, logs it, and forwards it to Sydney anyway, because the rating on that end has a mother too.',
      },
      a_fault_in_the_grid: {
        label: 'A fault in the grid',
        text: 'An intermittent fault in the auxiliary run, traced and cleared. It is four lines long and every one of them is a lie of the sort nobody will ever check. The draw stops. The ship goes on. You are the only person aboard who does not know what happened, because you are the only one who decided not to.',
      },
      let_alone: {
        label: 'Eleven minutes',
        text: 'Eleven minutes, twice a week, and a chief engineer who stops raising it because you stopped wanting to hear it. It goes on for the rest of the transit and then it stops on its own, which is the part that should have worried somebody.',
      },
    },
  },
];
