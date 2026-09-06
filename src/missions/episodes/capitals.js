// Episodes 17-18: the capitals, and what you did to be let into them.
//
// Ten of the map's twenty sectors hosted no episode at all, and among them were
// every great power's home space — Qo'noS, Romulus, Cardassia Prime, the Gamma
// Quadrant. Fifteen of forty-three systems had anything authored in them. The
// endgame was thinnest of all: Act 4 had two episodes and Act 5 had one.
//
// These are the first two of the capitals, and they are the first episodes in
// the game that FOLLOW from another one. Nothing chained before: sixteen
// episodes, forty-three flags, and the only cross-content dependency in the
// whole book was `court_martial` waiting on a flag the ledger raises rather
// than an episode.
//
// The chain was already latent in the map. Qo'noS refuses a berth below Klingon
// standing 10 and Romulus below Romulan 25 (`requiresStanding`, in
// systems.data.js). Archanis pays 25 Klingon standing for taking Kang's hand
// over the mining claim, and Outpost 4 pays 20 Romulan for letting a crippled
// warbird go. So the two ships that get to these two worlds are, in practice,
// the ones that earned it years earlier — and until now nothing on either
// world knew that.

/** Routing that reads what the captain did. See frontier.js for the pattern. */
const onVar = (key, ifSet, ifNot) => {
  const route = (m) => (m.vars[key] ? ifSet : ifNot);
  route.targets = [ifSet, ifNot];
  route.reads = key;
  return route;
};

/** Whether the Council heard the charge before it heard you. */
const afterTheCharge = onVar('let_it_stand', 'alone', 'seconded');

/** Whether you walked into the Senate chamber armed, having been told not to. */
const armedOrNot = onVar('kept_the_blade', 'searched', 'chamber');

export const CAPITAL_EPISODES = [
  // -------------------------------------------------------------------------
  {
    id: 'qonos_council', title: 'The Second Rite', system: 'qonos', act: 4, minRank: 7,
    // The first episode in the game gated on another episode's flag. Archanis
    // sets `kang_respects_you` in two of its endings, and Archanis is an Act-2
    // episode most captains meet long before they could berth at Qo'noS.
    requiresFlag: 'kang_respects_you',
    summary: 'Kang has put his name on you in front of the High Council, and somebody intends to make him regret it.',
    stages: {
      start: {
        text: 'The Great Hall is colder than you expected and louder than anywhere on your ship. Kang is on the floor of it, and he has just finished telling the High Council that a Federation captain kept an agreement when breaking it would have cost nothing. Councillor Duras is on his feet before Kang has sat down.',
        speaker: 'Great Hall',
        where: 'anywhere',
        choices: [
          { id: 'stand', label: 'Stand when Kang names you', next: 'charge',
            effects: { xp: 500, standing: { klingon: 6 } } },
          { id: 'wait', label: 'Stay seated. Let him finish', next: 'charge',
            effects: { xp: 400 } },
        ],
      },

      charge: {
        text: 'Duras does not accuse you of anything. He accuses Kang — of vouching for an outsider, which is a thing a Klingon may do once and survive. Then he reads a casualty list from the Archanis system into the record and asks the Council whose ships those were.',
        speaker: 'Councillor Duras',
        where: 'anywhere',
        choices: [
          { id: 'answer', label: 'Answer the list yourself', next: 'seconded',
            effects: { xp: 700, standing: { klingon: 10 } } },
          { id: 'silent', label: 'Say nothing. It was addressed to Kang',
            next: afterTheCharge, effects: { xp: 300, setVar: { let_it_stand: true } } },
          // Only a captain who actually did it — and one who can be standing
          // here at all, which the first version of this gate could not be.
          //
          // It asked for `archanis_massacre`, which is `archanis_claim`'s
          // `battle/finish`. This episode's own gate is `kang_respects_you`,
          // which is `honour/seal` and `battle/rescue`. All three are TERMINAL
          // choices of one episode, a playthrough takes exactly one, and
          // `availableAt` never offers a completed episode again — so no
          // captain could ever hold both, and every captain who reached this
          // stage was shown a greyed button promising something the game could
          // not deliver. The reasoning in the old comment was about the
          // fiction and was right; nobody asked whether the two flags could
          // be held at once.
          //
          // `fired_first_archanis` is `start/attack` — mid-route, not terminal
          // — and `battle/rescue` lies downstream of it. That is a real
          // captain: you opened fire on Kang, and then took his people off a
          // dead hull. He has the list, and he has standing to read it.
          { id: 'own_it', label: 'Read the rest of the list. You have it memorised',
            next: 'seconded', requires: { flag: 'fired_first_archanis' },
            effects: { xp: 900, standing: { klingon: 14 }, flag: 'owned_archanis' } },
          // Duras accuses Kang of vouching for an outsider. At Archanis, Kang
          // said to your face that a Klingon who withdraws on a Starfleet
          // officer's word "has not withdrawn, he has been sent away, and
          // there is a difference his House would find in about a day" — and
          // then refused the exit and fought. His own words answer the charge.
          //
          // Not free: saying it tells the Great Hall that a Federation officer
          // once offered Kang a way out, which is a thing Duras can use, and
          // which Starfleet would rather have been told first.
          { id: 'sent_away', label: '"He told me himself. A Klingon sent away has not withdrawn"',
            next: 'seconded', requires: { flag: 'kang_left_room' },
            effects: { xp: 800, standing: { klingon: 10, federation: -4 } } },
        ],
      },

      seconded: {
        text: 'Someone seconds Kang. Then someone else. It is not agreement — it is the Council deciding that Duras has overreached, which is a different thing and worth exactly as much. Duras invokes the rite of challenge and names a champion, and the champion is not Kang.',
        speaker: 'Great Hall',
        where: 'anywhere',
        choices: [
          { id: 'accept', label: 'Accept the challenge yourself', next: 'blade',
            effects: { xp: 800 } },
          { id: 'decline', label: 'Decline. This is a Klingon matter', outcome: 'declined',
            effects: { xp: 500, standing: { klingon: -12, federation: 8 } } },
          { id: 'kang', label: 'Ask that Kang answer it, as is his right', next: 'kang_fights',
            effects: { xp: 600, standing: { klingon: 4 } } },
          // Written one stage earlier, at `charge/own_it`. `charge` is the only
          // way into this stage, so the write is always upstream of the read —
          // an episode remembering something the captain did inside it, which
          // is the shortest reach in the book and the only kind that cannot
          // depend on which episodes he happened to play.
          { id: 'my_dead', label: '"Those were my dead too. I will answer for them"',
            next: 'blade', requires: { flag: 'owned_archanis' },
            effects: { xp: 1000, standing: { klingon: 18 } } },
        ],
      },

      alone: {
        text: 'Kang answers the list alone, and answers it well, and the Council is not looking at him while he does it. When he finishes there is the particular silence of a room that has decided something without voting. He does not look at you either.',
        speaker: 'Great Hall',
        where: 'anywhere',
        choices: [
          { id: 'late', label: 'Speak now, late', next: 'seconded',
            effects: { xp: 400, standing: { klingon: -4 } } },
          { id: 'leave', label: 'Let it end here and return to the ship', outcome: 'declined',
            effects: { xp: 300, standing: { klingon: -16 }, flag: 'kang_left_alone' } },
        ],
      },

      blade: {
        // The one scene aboard ship, and the reason it is aboard: you have to
        // go and get something. The armoury has existed and no episode had
        // ever sent anybody to it.
        where: 'armoury',
        text: 'You have until the hall reconvenes. Your armoury has two ceremonial blades, both Federation-issue, both wrong. Your tactical officer has a third that is not Federation-issue at all and does not explain where it came from.',
        speaker: 'Armoury',
        choices: [
          { id: 'take', label: 'Take the one that is not ours', next: 'duel',
            effects: { xp: 600, flag: 'borrowed_blade' } },
          { id: 'ours', label: 'Take a Starfleet blade and let them see it', next: 'duel',
            effects: { xp: 500, standing: { federation: 6 } } },
          // Somebody has to hand it to you.
          { id: 'ask', label: 'Ask your tactical officer to stand second',
            next: 'duel', requires: { officer: 'tactical' },
            effects: { xp: 800, standing: { klingon: 8 }, flag: 'second_stood' } },
        ],
      },

      duel: {
        text: 'The champion is younger than you and slower than he thinks. It lasts under a minute and neither of you dies, which is permitted and which Duras did not want. The Council notes the outcome. Kang says nothing at all, which from him is a considerable amount.',
        speaker: 'Great Hall',
        where: 'anywhere',
        choices: [
          { id: 'finish', label: 'Stop at first blood and say so', outcome: 'upheld',
            effects: { xp: 1600, standing: { klingon: 26, federation: 10 },
              record: { treaty_signed: 1 }, flag: 'qonos_upheld' } },
          { id: 'yield', label: 'Yield, and let him have the hall', outcome: 'yielded',
            effects: { xp: 900, standing: { klingon: 6 } } },
        ],
      },

      kang_fights: {
        text: 'Kang answers it. He is old and it shows for the first thirty seconds and then it does not show at all. Afterwards he sits down heavily beside you and observes that the Council will now debate the mining rights, which was the only thing any of this was ever about.',
        speaker: 'Captain Kang',
        where: 'anywhere',
        choices: [
          { id: 'rights', label: 'Put the Federation position while the room is quiet',
            outcome: 'upheld',
            effects: { xp: 1400, standing: { klingon: 18, federation: 14 },
              record: { treaty_signed: 1 }, flag: 'qonos_upheld' } },
          { id: 'nothing', label: 'Let the Council have its debate', outcome: 'yielded',
            effects: { xp: 800, standing: { klingon: 10 } } },
        ],
      },
    },
    start: 'start',
    endings: {
      upheld: { label: 'The claim held',
        text: 'The Archanis agreement stands, in writing, with two names on it. Duras will be back. Kang says that is what makes it worth having.',
        effects: { flag: 'archanis_ratified' } },
      yielded: { label: 'The hall kept its own',
        text: 'The matter closes without you in it. The agreement holds because Kang holds it, which is a thinner thing than it was this morning.' },
      declined: { label: 'A Klingon matter',
        text: 'You are escorted to your ship with every courtesy and no warmth at all. Kang does not come to see you off.' },
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'romulus_debt', title: 'The Debt at Romulus', system: 'romulus', act: 4, minRank: 7,
    // Outpost 4's `honoured` ending reads: "He does not thank you. Some years
    // later, that decision comes back in your favour." This is the some years
    // later. It also pays the 20 Romulan standing that makes Romulus — which
    // requires 25 — reachable at all.
    requiresFlag: 'spared_warbird',
    summary: 'The commander you did not board has asked for you by name, and he is not in a position to ask for much.',
    stages: {
      start: {
        text: 'A Romulan transit authority grants your ship a berth it has no obligation to grant, on the authority of a Senate aide named Telek — who, the last time you saw him, was standing in a venting warbird asking you not to board it. He is under house arrest. He has requested you as a witness.',
        speaker: 'Communications',
        where: 'anywhere',
        choices: [
          { id: 'go', label: 'Go. He asked', next: 'told',
            effects: { xp: 600 } },
          { id: 'terms', label: 'Ask what a Federation witness is worth here first',
            next: 'told', effects: { xp: 450, standing: { romulan: -4 } } },
          { id: 'refuse', label: 'This is a Romulan proceeding. Decline', outcome: 'declined',
            effects: { xp: 400, standing: { romulan: -14 } } },
        ],
      },

      told: {
        text: 'Telek is charged with concealing the loss of a cloaking device. He did not conceal it — he reported it, in full, eight years ago, and the report was buried by the man now prosecuting him. He wants you to say what you saw. He is very clear that this will cost you something and does not say what.',
        speaker: 'Telek',
        where: 'anywhere',
        choices: [
          { id: 'agree', label: 'Agree to testify', next: 'summons',
            effects: { xp: 800, standing: { romulan: 8 } } },
          { id: 'press', label: 'Ask him what it costs before agreeing', next: 'summons',
            effects: { xp: 700 } },
          // There used to be a choice here for a captain who took the device:
          // "Tell him you have the device aboard your ship", gated on
          // `captured_cloak`. It could never open. `captured_cloak` is
          // `outpost_silence/battle/board` and this episode's own gate,
          // `spared_warbird`, is `battle/honour` — the SIBLING choice at the
          // same stage. Boarding and standing off are one fork, and the
          // episode was asking for both arms of it.
          //
          // It is gone rather than re-gated, because no other flag makes that
          // sentence true: the device is aboard your ship precisely when you
          // boarded, and boarding is the thing this episode is premised on your
          // not having done.
          //
          // What a captain CAN carry into this room is having fired first
          // inside the Zone and then let the commander go home anyway — six
          // routes reach both. The Romulans logged the first part
          // (`FACTION_MEMORY`, state.js), and Telek is about to stake his life
          // on a Federation officer's record.
          { id: 'came_first', label: 'Tell him what your record says before he stakes his life on it',
            next: 'summons', requires: { flag: 'fired_first_neutral_zone' },
            effects: { xp: 900, standing: { romulan: -4 }, flag: 'told_telek_first' } },
        ],
      },

      summons: {
        text: 'The summons arrives within the hour and it is not to a court. It is to the Senate chamber, in session, and the covering note observes that visitors are disarmed at the door and that Starfleet officers are known to consider a sidearm part of the uniform.',
        speaker: 'Senate Protocol',
        where: 'anywhere',
        choices: [
          { id: 'disarm', label: 'Go unarmed, obviously', next: 'chamber',
            effects: { xp: 500, standing: { romulan: 6 } } },
          { id: 'keep', label: 'Wear it. Let them take it at the door',
            next: armedOrNot, effects: { xp: 400, setVar: { kept_the_blade: true } } },
        ],
      },

      searched: {
        text: 'They take it at the door, exactly as advertised, and the taking is photographed. By the time you reach the floor of the chamber, the prosecutor has already used it: a Federation officer who came armed to a Senate in session, and what does that suggest about the testimony of such a man.',
        speaker: 'Senate Chamber',
        where: 'anywhere',
        choices: [
          { id: 'ignore', label: 'Ignore it and give the testimony', next: 'testify',
            effects: { xp: 600, standing: { romulan: -6 } } },
          { id: 'answer', label: 'Answer the insinuation first', next: 'testify',
            effects: { xp: 900, standing: { romulan: 4 } } },
        ],
      },

      chamber: {
        text: 'The chamber is smaller than the recordings suggest and the acoustics are designed so that whoever is speaking is the only person who can be heard. Telek is seated where a defendant sits. The prosecutor is a praetor-in-waiting and is enjoying himself.',
        speaker: 'Senate Chamber',
        where: 'anywhere',
        choices: [
          { id: 'testify', label: 'Give the testimony as you saw it', next: 'testify',
            effects: { xp: 700 } },
          { id: 'careful', label: 'Give it, and give it carefully', next: 'testify',
            requires: { skill: 'diplomacy', ranks: 2 },
            effects: { xp: 1000, standing: { romulan: 8 } } },
        ],
      },

      testify: {
        text: 'You describe a crippled ship, a commander who asked for his crew rather than for himself, and a Federation captain who agreed. The chamber is very quiet. The prosecutor asks one question: whether you would have boarded, had he not asked.',
        speaker: 'Prosecutor',
        where: 'anywhere',
        choices: [
          { id: 'honest', label: '"Yes. I would have."', outcome: 'acquitted',
            effects: { xp: 2000, standing: { romulan: 22, federation: 12 },
              record: { treaty_signed: 1 }, flag: ['telek_acquitted', 'romulus_witness'] } },
          { id: 'no', label: '"No. I would not have."', outcome: 'acquitted',
            effects: { xp: 1200, standing: { romulan: 10 }, flag: 'telek_acquitted' } },
          { id: 'refuse_q', label: 'Decline to answer a hypothetical', outcome: 'unresolved',
            effects: { xp: 900, standing: { romulan: -8 } } },
          // Written at `told/came_first`, three stages back and on the only
          // route into this one. The prosecutor's question is whether you
          // would have boarded; a captain who told Telek about the Zone before
          // any of this started can answer it with the harder, better thing —
          // that Telek asked for him knowing exactly what he was.
          { id: 'he_knew', label: '"He knew what I was before he asked for me."',
            outcome: 'acquitted', requires: { flag: 'told_telek_first' },
            effects: { xp: 2200, standing: { romulan: 18, federation: 10 },
              record: { treaty_signed: 1 }, flag: ['telek_acquitted', 'romulus_witness'] } },
        ],
      },
    },
    start: 'start',
    endings: {
      acquitted: { label: 'The record corrected',
        text: 'Telek is released into a career that will go nowhere, which he seems to regard as a considerable win. The buried report is entered eight years late. Somebody in that chamber will remember your face for a long time, and you will not know which one.',
        effects: { flag: 'romulan_favour' } },
      unresolved: { label: 'Nothing decided',
        text: 'The proceeding is adjourned without a finding, which on Romulus is how a thing is refused without anyone having refused it.' },
      declined: { label: 'Declined to appear',
        text: 'Your berth is revoked with the same courtesy it was granted. Whatever happened to Telek, it happened without a witness.' },
    },
  },
];
