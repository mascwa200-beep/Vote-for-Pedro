// Episodes 19-20: two treaties being tested, and the rooms they are tested in.
//
// Twenty-six of forty-three systems hosted nothing. Among them were Cardassia
// Prime — a homeworld with a dock, a standing gate and a description that reads
// "Central Command, the Obsidian Order, and a customs process designed as an
// interrogation" — and Khitomer, which the map describes as "neutral ground,
// chosen because both empires could reach it and neither could hold it". Two
// places built entirely for episodes, with no episodes in them.
//
// Both of these follow from earlier ones, the way the capitals do:
//
//   The Debt at Cardassia   act 4, needs `torvan_owes_you` from the Terok Nor
//                           treaty (act 3). You let a gul withdraw a claim
//                           privately instead of breaking him with it in
//                           public. The Obsidian Order has the transcript.
//   The Second Accord       act 5, needs `qonos_upheld` from the Great Hall
//                           (act 4). The agreement you held together in front
//                           of the High Council is being widened, and the
//                           people who lost that argument have not stopped.
//
// Act 5 had exactly one episode in it, which was the finale. It now has two.
//
// And each has one scene in a compartment that had never been used for
// anything: the briefing room and the brig. Both were among the six rooms with
// no functional reference outside the deck plan, and both are places the crew
// now actually stands in.

/** Routing that reads what the captain did. See frontier.js for the pattern. */
const onVar = (key, ifSet, ifNot) => {
  const route = (m) => (m.vars[key] ? ifSet : ifNot);
  route.targets = [ifSet, ifNot];
  route.reads = key;
  return route;
};

/** Whether you let the Order keep its own version of the meeting. */
const afterTheTranscript = onVar('let_them_read', 'their_record', 'our_record');

/** Whether the man in your brig was offered anything. */
const afterTheCell = onVar('offered_terms', 'bargained', 'stonewalled');

export const ACCORD_EPISODES = [
  // -------------------------------------------------------------------------
  {
    id: 'cardassia_debt', title: 'The Debt at Cardassia', system: 'cardassia_prime',
    act: 4, minRank: 7,
    // Terok Nor is Act 3, and "raise it privately and let him withdraw the
    // claim" is the choice that sets this. A captain who broke Torvan in the
    // room instead never gets asked to Cardassia at all.
    requiresFlag: 'torvan_owes_you',
    summary: 'Gul Torvan withdrew a claim because you let him do it quietly. Somebody kept the recording.',
    stages: {
      start: {
        text: 'Cardassian customs takes four hours and is not about your cargo. The officer asks the same six questions in a different order each time and writes down which order you answer them in. On the fourth pass he mentions, without looking up, that Gul Torvan is under review by the Obsidian Order and that you are named in the file.',
        speaker: 'Cardassia Prime, customs',
        where: 'anywhere',
        choices: [
          { id: 'answer', label: 'Answer the six questions a fifth time', next: 'order',
            effects: { xp: 400 } },
          { id: 'treaty', label: 'Cite the Terok Nor accord and ask to be berthed',
            next: 'order', effects: { xp: 500, standing: { cardassian: 4 } } },
          // This was gated on `dmz_accord` and read "Only a captain who
          // actually signed it. Two of the treaty's endings set this and one
          // does not." Both sentences are true about the treaty and neither is
          // true here.
          //
          // The episode requires `torvan_owes_you`, which is written at
          // `cardassian_treaty/clause/quiet` — and `quiet` goes to `talks`,
          // where BOTH remaining choices sign. The captain who did not sign
          // went through `clause/press` instead and never got the flag that
          // brings him to Cardassia at all. So every captain who can reach this
          // stage holds `dmz_accord`, and the gate stood open for all of them:
          // a locked-looking choice nobody was ever locked out of, which is the
          // §111 defect with its sign reversed.
          //
          // Nothing in the treaty discriminates among the captains who arrive
          // here — after `quiet` the road is forced. So the credential cannot
          // be a deed, and pretending otherwise is what went wrong the first
          // time. Quoting a treaty clause from memory, four hours into a
          // customs interview two acts later, is a diplomat's trick and is
          // gated as one: a rank above the check that let him read the room at
          // Terok Nor in the first place.
          { id: 'clause', label: 'Quote the clause about naval visits, from memory',
            next: 'order', requires: { skill: 'diplomacy', ranks: 3 },
            effects: { xp: 700, standing: { cardassian: 8 } } },
        ],
      },

      order: {
        text: 'Glinn Marrek of the Obsidian Order is courteous in the way a closed door is courteous. He has a recording of a private conversation aboard Deep Space 9 in which a Cardassian officer withdrew a legitimate claim after a Starfleet captain spoke to him alone. He would like to know what was said. He already knows what was said.',
        speaker: 'Glinn Marrek',
        where: 'anywhere',
        choices: [
          { id: 'account', label: 'Give him your account of it, complete',
            next: 'our_record', effects: { xp: 700, standing: { cardassian: 6 } } },
          { id: 'stand', label: 'Say nothing and let his recording stand',
            next: afterTheTranscript,
            effects: { xp: 400, setVar: { let_them_read: true } } },
          { id: 'refuse', label: 'Refuse the interview and invite him to charge you',
            next: 'our_record', effects: { xp: 600, standing: { cardassian: -8 } } },
          // The Badlands, act 3: a medical convoy for Bajor that has to cross
          // the plasma storms, and Cardassian hulls in it. `badlands_run` is
          // "continue" out of either storm stage — the second of which is a
          // freighter breaking up because a loaded hull is not a starship and
          // the differential does not care whose flag is on it. Ekaterina Voss
          // goes first and the Tobruk eleven minutes later, and there is no
          // going back in for either of them.
          //
          // Marrek's file says this captain is a Starfleet officer who suborns
          // Cardassian officers in private. The convoy is the other document,
          // and it is his to produce: he took Cardassian crews into a plasma
          // front under his own orders and buried them there, in the open, with
          // both governments' names on the manifest.
          //
          // It is deliberately the same SHAPE as the Centauri log at the
          // court-martial in §120 and the opposite act. There he hid behind a
          // filed procedure to avoid a question about his judgement. Here he
          // puts his own dead on a Cardassian interrogator's table to make a
          // question about a private conversation look as small as it is. The
          // Order takes the file, which is the cost — those names belong to it
          // now, and Marrek is not a man who is handed a thing and does not use
          // it.
          { id: 'convoy', label: 'Tell him what the Badlands cost, and let him file that instead',
            next: 'our_record', requires: { flag: 'badlands_run' },
            effects: { xp: 900, standing: { cardassian: 12, federation: -4 } } },
        ],
      },

      their_record: {
        text: 'The Order\'s version is read into the file. In it you are a Federation officer who suborned a Cardassian gul, and Torvan is a man who let you. Neither half is true and both halves are supportable, which on Cardassia is the same as being proven. Marrek thanks you for your time.',
        speaker: 'Glinn Marrek',
        where: 'anywhere',
        choices: [
          { id: 'correct', label: 'Correct the record now, late', next: 'briefing',
            effects: { xp: 500, standing: { cardassian: -4 } } },
          { id: 'leave', label: 'Take the berth, take on stores, and go',
            outcome: 'left_him', effects: { xp: 400, standing: { cardassian: 4, federation: -6 } } },
        ],
      },

      our_record: {
        text: 'Your account goes into the file beside his. Marrek reads it twice and observes that a Starfleet captain who tells the truth in this building is either very confident or very badly briefed. Then he tells you the hearing is tomorrow, that Torvan has asked for you, and that asking was itself an admission.',
        speaker: 'Glinn Marrek',
        where: 'anywhere',
        choices: [
          { id: 'aboard', label: 'Go back aboard and think about it', next: 'briefing',
            effects: { xp: 500 } },
        ],
      },

      briefing: {
        // The briefing room, which until now had no functional reference
        // outside the deck plan and nobody standing in it. It is three people
        // and a table, which is exactly what it was built to be.
        where: 'briefing',
        text: 'Your senior staff have read the file. Your first officer points out that Torvan is being destroyed for an act of restraint, and that the act of restraint was yours. Your science officer points out, more quietly, that the recording exists because somebody aboard Deep Space 9 sold it, and that whoever that was is still there.',
        speaker: 'Briefing room',
        choices: [
          { id: 'testify', label: 'Testify for him tomorrow', next: 'tribunal',
            effects: { xp: 800 } },
          { id: 'source', label: 'Spend the night finding out who sold the recording',
            next: 'tribunal', effects: { xp: 900, flag: 'found_the_source' } },
          { id: 'sail', label: 'Break orbit tonight', outcome: 'left_him',
            effects: { xp: 400, standing: { cardassian: -10, federation: -8 } } },
        ],
      },

      tribunal: {
        text: 'A Cardassian proceeding announces its verdict before it hears anything, and then spends the day explaining the verdict to the accused so that he may agree with it. Torvan has already agreed with it twice. When you are called he does not look at you, which you understand to be a kindness.',
        speaker: 'Central Command',
        where: 'anywhere',
        choices: [
          { id: 'debt', label: 'Say plainly that the restraint was his and the debt is yours',
            outcome: 'debt_paid',
            effects: { xp: 1600, standing: { cardassian: 20, federation: 8 },
              record: { treaty_signed: 1 }, flag: 'torvan_clear' } },
          // Only if you spent the night on it.
          { id: 'name', label: 'Name the officer who sold the recording',
            outcome: 'debt_paid', requires: { flag: 'found_the_source' },
            effects: { xp: 1900, standing: { cardassian: 26 },
              record: { treaty_signed: 1 }, flag: 'torvan_clear' } },
          { id: 'legal', label: 'Answer only the questions put to you', outcome: 'convicted',
            effects: { xp: 900, standing: { cardassian: -6 } } },
        ],
      },
    },
    start: 'start',
    endings: {
      debt_paid: { label: 'The debt discharged',
        text: 'Torvan is reduced two grades and keeps his life, which on Cardassia is an acquittal. He sends no message. Eleven months later a Cardassian patrol declines to stop you at a border where it certainly should have, and its commander does not give his name.' },
      convicted: { label: 'Correct in every particular',
        text: 'You answered what you were asked and nothing you said was untrue. Torvan is stripped of rank and posted somewhere with no ships in it. The file records your full cooperation.' },
      left_him: { label: 'Broke orbit',
        text: 'You are outside Cardassian space before the hearing opens. Nothing follows you. Nothing ever does, from Cardassia; that is not how they do it.' },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'khitomer_accord', title: 'The Second Accord', system: 'khitomer',
    act: 5, minRank: 8,
    // Act 5 had one episode in it and it was the finale. The Great Hall is Act
    // 4 and `qonos_upheld` is what holding the Archanis agreement together in
    // front of the High Council earns.
    requiresFlag: 'qonos_upheld',
    summary: 'The agreement you held together at Qo\'noS is being widened, and the people who lost that argument have had a year to think about it.',
    stages: {
      start: {
        text: 'Khitomer was chosen because both empires can reach it and neither can hold it, which is a description of the whole proceeding. There are Klingon ships in orbit and Federation ships in orbit and a great deal of careful distance between them. Kang is here and has aged. He tells you the widened accord will be signed in four days and that two of the four days are for the funeral of whoever tries to stop it.',
        speaker: 'Captain Kang',
        where: 'anywhere',
        choices: [
          { id: 'ask', label: 'Ask him who is expected to try', next: 'table',
            effects: { xp: 600 } },
          { id: 'work', label: 'Say nothing and go and read the draft', next: 'table',
            effects: { xp: 500, standing: { federation: 4 } } },
          // Organia, in act 2, and the longest thing anybody at this table
          // knows. He went down, pressed the council, found out what they
          // actually are, and reported it to Starfleet.
          //
          // Kang has just said that two of the four days are for the funeral of
          // whoever tries to stop the accord. Every other captain hears a
          // threat. This one has filed a report on the last power that stopped
          // a Federation-Klingon war, which did it without asking either empire
          // and without anybody's funeral, and the useful part is not the
          // warning — it is that he can tell Kang, who has aged, that the two of
          // them have been overruled before and neither of them enjoyed it.
          //
          // `federation` rather than `klingon`: this is a captain volunteering
          // a piece of classified assessment to a Klingon in orbit over a
          // treaty, and Starfleet's view of that depends entirely on the accord
          // being signed four days later.
          { id: 'organia', label: 'Tell him what you filed about Organia, and who stopped it last time',
            next: 'table', requires: { flag: 'organia_revealed' },
            effects: { xp: 900, standing: { klingon: 10, federation: 6 } } },
        ],
      },

      table: {
        text: 'The draft is nine pages and eight of them are agreed. The ninth is Archanis, which is where all of this started and which both sides have quietly assumed the other would concede. On the second morning a Klingon technician is taken off the outpost\'s environmental deck with a Cardassian-made charge in a satchel, and because your people took him he is in your brig.',
        speaker: 'Khitomer outpost',
        where: 'anywhere',
        choices: [
          { id: 'hand', label: 'Hand him to the Klingons and stay at the table',
            next: 'ninth', effects: { xp: 600, standing: { klingon: 8 } } },
          { id: 'see', label: 'Go down and see him yourself', next: 'brig',
            effects: { xp: 700 } },
          // Donatu V, in act 3. Two fleets were a minute from firing and you
          // transmitted one text to both commands at once, so that neither
          // learned anything from the other and neither could claim it had.
          //
          // This is the same move on a smaller board. A prisoner is leverage
          // only while one delegation knows about him and the other does not;
          // told to both rooms in the same breath, on the second morning, he
          // stops being a card either side can play and goes back to being a
          // nineteen-year-old with a satchel. It costs the captain the private
          // conversation in the brig — and the ninth page is still there in the
          // afternoon, which is what the week was actually about.
          { id: 'both_rooms', label: 'Tell both delegations at once, the way you told Donatu',
            next: 'ninth', requires: { flag: 'donatu_accord' },
            effects: { xp: 1000, standing: { klingon: 12, federation: 10 } } },
          // The same battle, the other captain.
          //
          // `donatu_accord` above is the one who got two fleets to accept one
          // text a minute before they fired. `donatu_battle` is "Engage", and
          // its ending is four sentences long: the historians will name it, and
          // the families will not care what it is called. Measured rather than
          // assumed — the two flags co-occur in none of the book's playthroughs,
          // because they are alternative endings of one episode — so these two
          // roads to the ninth page are mutually exclusive by construction and
          // no captain is ever offered both.
          //
          // What he has that nobody else at the table has is the alternative,
          // concretely. Everyone in the room is arguing about a page. He is the
          // only one who has already seen what the page is instead of, and can
          // say so without it being rhetoric, because the Klingons across the
          // table were there too and some of them were shooting at him.
          //
          // It costs. Naming your own dead to move a document is using them,
          // and he knows it while he does it — so this is the road that gains
          // most with the Klingons, who respect it exactly, and least with
          // Starfleet, who will read the transcript and see a captain trading
          // on casualties at a peace conference.
          { id: 'the_battle', label: 'Say what the ninth page is the alternative to. You were there.',
            next: 'ninth', requires: { flag: 'donatu_battle' },
            effects: { xp: 1000, standing: { klingon: 16, federation: 4 } } },
        ],
      },

      brig: {
        // The brig. One of the six compartments nothing outside the deck plan
        // referenced, and the first scene ever set in it.
        where: 'brig',
        text: 'He is nineteen and he is not frightened, which is worse. He tells you the charge is Cardassian because the money is Cardassian, and that he does not care whose money it is because Archanis is his family\'s and the ninth page gives it away. He asks whether you have read the ninth page. He is right about what it says.',
        speaker: 'The prisoner',
        choices: [
          { id: 'listen', label: 'Let him talk until he runs out', next: afterTheCell,
            effects: { xp: 700 } },
          { id: 'terms', label: 'Offer him something for the name of the paymaster',
            next: 'bargained',
            effects: { xp: 800, setVar: { offered_terms: true }, flag: 'khitomer_source' } },
          // A captain the Empire trusts can promise something a captain it does
          // not trust cannot.
          { id: 'kang', label: 'Promise him Kang will hear it from you, not from the Order',
            next: 'bargained', requires: { flag: 'kang_respects_you' },
            effects: { xp: 1000, standing: { klingon: 6 },
              setVar: { offered_terms: true }, flag: 'khitomer_source' } },
        ],
      },

      stonewalled: {
        text: 'He runs out after two hours and tells you nothing you can use and one thing you cannot forget, which is the name of the moon his grandmother is buried on. It is in the Archanis system and the ninth page does not mention it anywhere.',
        speaker: 'The prisoner',
        // The same cell, two hours later. `brig` sends the captain down to
        // hear him and both of its outcomes were then marked 'anywhere', so a
        // captain could walk back up to the bridge halfway through the
        // interrogation and finish it from there. The speaker is still the
        // prisoner; the prisoner is still in the brig. Leaving is what the
        // choices below are FOR.
        where: 'brig',
        choices: [
          { id: 'ninth', label: 'Take the ninth page back to the table', next: 'ninth',
            effects: { xp: 800, flag: 'read_the_ninth' } },
          { id: 'hand', label: 'Hand him over and let the table alone', next: 'ninth',
            effects: { xp: 500, standing: { klingon: 6 } } },
        ],
      },

      bargained: {
        text: 'The paymaster is not Cardassian. The money is, and it came through three houses to reach him, and the last of the three is one that stood against you in the Great Hall a year ago. He gives you the name and then asks you not to tell anyone he gave it, which is the first frightened thing he has said.',
        speaker: 'The prisoner',
        // As above: still in the cell, and "asks you not to tell anyone he
        // gave it" is a thing said to somebody standing in front of him.
        where: 'brig',
        choices: [
          { id: 'ninth', label: 'Take the name and the ninth page to the table',
            next: 'ninth', effects: { xp: 1000, flag: 'read_the_ninth' } },
          { id: 'quiet', label: 'Keep the name and fix the ninth page quietly',
            next: 'ninth', effects: { xp: 900, flag: 'read_the_ninth' } },
          // Terok Nor, in act 3: "Take the conceded point back before you sign."
          // A captain who has once reopened a concession at the table, with the
          // pen already in his hand, knows the ninth page does not need a name
          // attached to it to be fought over.
          //
          // Both roads above spend the prisoner — one at the table, one quietly
          // — and he has just asked, in the first frightened thing he has said,
          // that nobody be told he gave it. This is the road that does not spend
          // him: the concession is reopened on its own merits, which is a harder
          // argument and the one that leaves a nineteen-year-old out of it.
          //
          // `read_the_ninth` as well, like both of its siblings: the stage it
          // leads to gates on having actually read the page, and arriving there
          // without it would strand the captain among locked choices.
          { id: 'reopen', label: 'Reopen the concession itself, and leave him out of it',
            next: 'ninth', requires: { flag: 'dmz_clause_recovered' },
            effects: { xp: 1200, standing: { cardassian: 6, federation: 8 },
              flag: 'read_the_ninth' } },
        ],
      },

      ninth: {
        text: 'The ninth page is read out on the third morning. Somebody has to say what is on the moon in the Archanis system and somebody has to say who paid a nineteen-year-old to make the question moot, and the two things cannot be said by the same person without one of them sounding like an excuse for the other.',
        speaker: 'Khitomer outpost',
        where: 'anywhere',
        choices: [
          // You cannot speak to a page you did not read, and you cannot name a
          // house you were never told about. A captain who handed the prisoner
          // straight to the Klingons and stayed at the table has exactly one
          // of these available, which is the cost of not going down there.
          { id: 'moon', label: 'Speak to the ninth page and let the money alone',
            outcome: 'signed', requires: { flag: 'read_the_ninth' },
            effects: { xp: 1800, standing: { klingon: 20, federation: 16 },
              record: { treaty_signed: 1 }, flag: 'khitomer_signed' } },
          { id: 'money', label: 'Name the house that paid, and let the page stand',
            outcome: 'signed', requires: { flag: 'khitomer_source' },
            effects: { xp: 1600, standing: { klingon: 24, federation: 8 },
              record: { treaty_signed: 1 }, flag: 'khitomer_signed' } },
          { id: 'kang', label: 'Give both to Kang and let him choose which to say',
            outcome: 'kangs_accord', requires: { flag: 'khitomer_source' },
            effects: { xp: 2000, standing: { klingon: 28, federation: 12 },
              record: { treaty_signed: 1 }, flag: 'khitomer_signed' } },
          { id: 'neither', label: 'Say neither. Sign the eight pages that are agreed',
            outcome: 'eight_pages',
            effects: { xp: 1000, standing: { federation: 6 } } },
        ],
      },
    },
    start: 'start',
    endings: {
      signed: { label: 'Nine pages',
        text: 'It is signed on the fourth morning and the moon in the Archanis system is named in it, in both languages, which took most of the third night. Nobody is buried during the proceeding. Kang observes that this makes it the least Klingon treaty he has ever put his name to and that he intends to say so publicly.' },
      kangs_accord: { label: 'Kang\'s accord',
        text: 'He chose the moon. He said the other thing eleven days later at Qo\'noS, in front of the Council, having waited until the ink was dry and the house in question had signed it too. You are told afterwards that this is what he had been waiting a year to do and that he needed somebody to hand it to him.',
        effects: { flag: 'kang_owes_you' } },
      eight_pages: { label: 'Eight pages',
        text: 'The agreed eight are signed and the ninth is deferred to a commission, which is a way of saying it is deferred. The nineteen-year-old is released into the custody of his house. Somebody will come back to Archanis, and it will not be at a table.' },
    },
  },
];
