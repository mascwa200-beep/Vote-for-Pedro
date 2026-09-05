// Episodes 21-22: the two that read what the earlier ones wrote down.
//
// The mission book records sixty-three flags and reads five of them. A sweep
// with the denominator asserted first, over every episode stage, choice and
// ending, and then over every other line in `src/`:
//
//     flags WRITTEN by episodes                       63
//       of those, gated on by an episode or stage     13
//       named anywhere else in src/ at all            30
//       WRITTEN AND READ BY NOTHING                   33
//
// Thirty-three decisions the game asked the captain to make, wrote down, and
// never mentioned again. Four of them are excusable — `came_clean`,
// `credited_the_crew`, `commended_command` and `censured_command` are all set
// by `homecoming`, which is the finale, so there is nothing after them to do
// the reading. The rest are not.
//
// And `MissionBook.availableAt` (engine.js:434) already implements FIVE gates.
// Two are used and three had never been used by anything:
//
//     minRank            12 of 20 episodes
//     requiresFlag        5 of 20 episodes
//     blockedByFlag       ZERO
//     requiresCompleted   ZERO
//     minStanding         ZERO
//
// So this file is not mainly about two more places to visit, though Utopia
// Planitia and Vulcan were both among the twenty-three systems hosting
// nothing. It is about the difference between a game that remembers and a game
// that records.
//
//   Clean Hands      needs `court_martial` COMPLETED, and is BLOCKED BY
//                    `deflected_blame`. The fleet yard wants a captain's word
//                    on a hull. They ask you because your word survived your
//                    own inquiry. A captain who put it on somebody else is
//                    never asked, and never finds out they were not asked —
//                    which is the first content in this game a player can
//                    lose rather than fail.
//
//   The Long Peace   needs `khitomer_accord` COMPLETED and Klingon standing of
//                    at least ten. Vulcan hosts what Khitomer started. You are
//                    in the room only if the Empire will sit in it with you.
//
// Both reach back past the act they are in. Clean Hands turns on `core_tuned`
// and `trials_by_the_book`, which are set in the SHAKEDOWN — the first episode
// in the game, eight ranks earlier, when nobody knew your name. That is the
// payoff the thirty-three were missing: not a bigger number, but somebody
// bringing up what you did when it did not seem to matter.

/** Routing that reads what the captain did. See accords.js for the pattern. */
const onVar = (key, ifSet, ifNot) => {
  const route = (m) => (m.vars[key] ? ifSet : ifNot);
  route.targets = [ifSet, ifNot];
  route.reads = key;
  return route;
};

/** Whether you told the yard what the hull is actually like. */
const afterTheSurvey = onVar('said_it_plainly', 'the_memo', 'the_signature');

/** Whether you let the Vulcans run the room their way. */
const afterTheProtocol = onVar('let_them_chair', 'their_order', 'our_order');

export const CONSEQUENCE_EPISODES = [
  // -------------------------------------------------------------------------
  {
    id: 'utopia_certification', title: 'Clean Hands', system: 'utopia',
    act: 5, minRank: 8,
    // The first use of either gate in this game.
    //
    // `court_martial` is act 3 and its two outcomes are `inquiry_resolved` and
    // `deflected_blame`. Requiring the episode and blocking on the flag is the
    // pair that says "you were there, and it matters which way you went" —
    // requiring the flag would have been the ordinary shape and would have
    // rewarded the wrong answer.
    requiresCompleted: ['court_martial'],
    blockedByFlag: 'deflected_blame',
    summary: 'The fleet yard wants a captain to sign for a hull. They asked you because of what you said at your own inquiry.',
    stages: {
      start: {
        text: 'Mars orbit, and the yard is louder than any battle you have been in. Vice Admiral Sostrova has a hull in frame two months from launch and a problem she will not put in writing: the class is being certified on a survey the yard wrote about itself. She wants an outside captain to fly the trials and sign, or not sign. She says she asked for you by name and that the name came up because of Starbase 11.',
        speaker: 'Vice Admiral Sostrova',
        where: 'anywhere',
        choices: [
          { id: 'accept', label: 'Take the trials', next: 'trials', effects: { xp: 600 } },
          { id: 'why', label: 'Ask what she heard about Starbase 11', next: 'starbase',
            effects: { xp: 700 } },
          { id: 'decline', label: 'Say the yard should certify its own work',
            outcome: 'declined', effects: { xp: 400, standing: { federation: -4 } } },
        ],
      },

      starbase: {
        text: 'She heard that a captain stood up at their own board of inquiry and gave an account that cost them something. She says the fleet has no shortage of officers who are right and a considerable shortage of officers whose reports can be believed without a second source. Then she says the hull is in frame either way and asks again.',
        speaker: 'Vice Admiral Sostrova',
        where: 'anywhere',
        choices: [
          { id: 'take', label: 'Take the trials', next: 'trials', effects: { xp: 700 } },
          { id: 'decline', label: 'Decline anyway', outcome: 'declined',
            effects: { xp: 400, standing: { federation: -4 } } },
        ],
      },

      trials: {
        text: 'Four days of it. The hull is good. The hull is genuinely good, and that is the difficulty: everything the yard survey claims is true, and the survey does not mention that the warp core runs eleven per cent hot above factor seven and that the fix is a tuning pass nobody has budgeted for. It is not a fault. It is the kind of thing that is not a fault until somebody is running for their life.',
        speaker: 'Engineering',
        where: 'engineering',
        choices: [
          { id: 'sign', label: 'Sign. It is not a fault.', next: 'the_signature',
            effects: { xp: 800 } },
          { id: 'plain', label: 'Sign, and say plainly what you found',
            next: afterTheSurvey,
            effects: { xp: 1100, setVar: { said_it_plainly: true } } },
          // Your own first command, before anybody had heard of you.
          { id: 'tuned', label: 'Show them the pass you ran on your own core',
            next: 'the_memo', requires: { flag: 'core_tuned' },
            effects: { xp: 1400, setVar: { said_it_plainly: true } } },
        ],
      },

      the_signature: {
        text: 'Your signature goes on the certificate and the class is cleared. Sostrova thanks you. On the way out the yard\'s own chief engineer, who has said nothing for four days, tells you the eleven per cent is in her notes too and that she has been told twice that notes are not findings.',
        speaker: 'Yard chief engineer',
        where: 'anywhere',
        choices: [
          { id: 'nothing', label: 'Let it stand', outcome: 'certified',
            effects: { xp: 700, standing: { federation: 4 } } },
          { id: 'back', label: 'Go back in and add the finding', next: 'the_memo',
            effects: { xp: 1000 } },
        ],
      },

      // No flag on either ending here, deliberately. A first draft set
      // `utopia_finding` and `tests/consequences.test.js` caught it: nothing
      // reads it, which is the exact defect this whole file is about, and
      // writing one more inert flag while complaining about thirty-three of
      // them would have been remarkable. The durable consequence is the
      // `commendation` on the service record, which the Starfleet review
      // really does read. The Klingon flag below has a reader; this had none,
      // so it does not exist.
      the_memo: {
        text: 'The finding goes on the certificate, in eleven lines, with the tuning pass attached. It delays the class by five weeks and it makes an enemy of a yard manager who was two months late already. Sostrova reads it twice and says that this is what she asked for and that asking for it was easy.',
        speaker: 'Vice Admiral Sostrova',
        where: 'anywhere',
        choices: [
          { id: 'stand', label: 'Stand by it', outcome: 'certified_honestly',
            effects: { xp: 1600, standing: { federation: 12 },
              record: { commendation: 1 } } },
          // What you did on your very first cruise, cited eight ranks later.
          { id: 'trials', label: 'Offer to fly the re-trials yourself, by the book',
            outcome: 'certified_honestly', requires: { flag: 'trials_by_the_book' },
            effects: { xp: 1900, standing: { federation: 16 },
              record: { commendation: 1 } } },
        ],
      },
    },
    start: 'start',
    endings: {
      certified_honestly: {
        label: 'Signed, with the finding attached',
        text: 'The class launches five weeks late with a tuning pass in its build order. Nobody outside the yard ever hears about it. Three years on, a ship of that class runs above factor seven for nine hours getting a colony off a burning world, and her core holds, and her captain never learns why.',
      },
      certified: {
        label: 'Signed',
        text: 'The class launches on schedule and the certificate has your name on it. The yard\'s chief engineer keeps her notes. They remain notes.',
      },
      declined: {
        label: 'Not your yard',
        text: 'The yard certifies its own work, as yards have always done. You are back in the black inside a week and the hull is somebody else\'s to sign for.',
      },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'vulcan_long_peace', title: 'The Long Peace', system: 'vulcan',
    act: 5, minRank: 8,
    // The first use of either of these, too. `khitomer_accord` is itself
    // gated on `qonos_upheld` from act 4, so this is a chain three deep — and
    // the standing gate means the last link is not a flag you were handed but
    // a relationship you kept.
    requiresCompleted: ['khitomer_accord'],
    minStanding: { klingon: 10 },
    summary: 'Vulcan hosts what Khitomer began. You are in the room because the Empire will sit in it with you.',
    stages: {
      start: {
        text: 'The Science Academy has given over its oldest hall, which is a courtesy and also a statement: it is the room where Vulcan argued itself out of its own wars, and everybody present has been told so. Ambassador T\'Pral notes that you were at Khitomer and that the Klingon delegation raised no objection to your presence, which she says is the single most surprising fact in her briefing.',
        speaker: 'Ambassador T\'Pral',
        where: 'anywhere',
        choices: [
          { id: 'listen', label: 'Ask what the delegation wants said out loud',
            next: 'chamber', effects: { xp: 700 } },
          { id: 'protocol', label: 'Let the Vulcans set the order of business',
            next: afterTheProtocol,
            effects: { xp: 600, setVar: { let_them_chair: true } } },
        ],
      },

      chamber: {
        text: 'What the Empire wants said out loud is that it kept its word. Not that the treaty is good, not that peace is wise — that a Klingon signature meant something for a full year and that a Federation officer will say so in front of Vulcans. It is a small thing to ask and it is the whole thing they came for.',
        speaker: 'Klingon delegation',
        where: 'anywhere',
        choices: [
          { id: 'say', label: 'Say it, in the hall, on the record',
            next: 'our_order', effects: { xp: 1200, standing: { klingon: 14 } } },
          // Standing at Qo'noS, in act 4, when it was expensive.
          { id: 'stood', label: 'Say it, and say where you were standing when you learned it',
            next: 'our_order', requires: { flag: 'second_stood' },
            effects: { xp: 1500, standing: { klingon: 20, federation: 6 } } },
          { id: 'wait', label: 'Wait and see what is offered for it',
            next: afterTheProtocol, effects: { xp: 500, standing: { klingon: -6 } } },
        ],
      },

      their_order: {
        text: 'The Vulcans take the business in the order logic recommends, which puts the boundary survey first and the question of who kept faith last. By the time it is reached the Klingon delegation has been sitting for six hours being reasoned at, and the thing they came to hear said is now an item on a schedule.',
        speaker: 'Ambassador T\'Pral',
        where: 'anywhere',
        choices: [
          { id: 'interrupt', label: 'Take the item out of order and say it now',
            next: 'our_order', effects: { xp: 1100, standing: { klingon: 12, federation: -4 } } },
          { id: 'schedule', label: 'Let the schedule run', outcome: 'signed_thinly',
            effects: { xp: 600, standing: { klingon: -10 } } },
        ],
      },

      our_order: {
        text: 'The hall gets it in the wrong order and the right one. A Klingon general says, without being asked, that the Federation held a line at Archanis that cost it something. T\'Pral observes that this proceeding has become emotional and does not adjourn it, which from a Vulcan is applause.',
        speaker: 'Ambassador T\'Pral',
        where: 'anywhere',
        choices: [
          { id: 'sign', label: 'Sign the widened accord', outcome: 'long_peace',
            effects: { xp: 1800, standing: { klingon: 12, federation: 12 },
              record: { treaty_signed: 1 }, flag: 'long_peace_signed' } },
          // The Organians, in act 2, when you had no idea what you were seeing.
          { id: 'organia', label: 'Enter what you saw at Organia into the record first',
            outcome: 'long_peace', requires: { flag: 'observed_organia' },
            effects: { xp: 2100, standing: { klingon: 14, federation: 16 },
              record: { treaty_signed: 1 }, flag: 'long_peace_signed' } },
        ],
      },
    },
    start: 'start',
    endings: {
      long_peace: {
        label: 'The long peace',
        text: 'The accord is widened and it holds, not because the document is better than the last one but because two delegations watched each other agree to something neither had to. T\'Pral tells you, on the steps, that Vulcans do not thank people. Then she stands there a while longer than logic requires.',
      },
      signed_thinly: {
        label: 'Signed, and thin',
        text: 'Everything on the schedule is dealt with in the order recommended, and the accord is signed by people who did not look up. It will hold for a while. Nobody in the hall could tell you why.',
      },
    },
  },
];
