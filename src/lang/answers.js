// Answering a question the game asked.
//
// The order line normally parses a command out of a sentence. But when the
// computer has stopped to ask something — "I read that as X, confirm?" — the
// captain is not giving an order, they are answering one question with a yes
// or a no, and those words have no object to parse.
//
// See docs/RESEARCH.md §26. The short version: "make it so" is a naval
// affirmative meaning *carry on with what you have just put to me*, which is a
// reply and not an instruction, and the parser had nowhere to put it — it read
// the verb literally and sent it to the REPLICATOR, to be told there is no
// specification for "it so". "Belay that" is the naval negative and means
// cancel the last thing said, which is not the same as "cease fire".
//
// This deliberately lives outside the lexicon and is checked BEFORE it. The
// seventy-odd intents keep their meanings: with no question pending, "belay
// that" still stops the guns, which is what it means when somebody is shooting
// at you. Only while a question is actually on the screen do these words take
// priority, because then there is only one thing they can sensibly mean.
//
// "Aye aye" is deliberately absent. It is what an officer says BACK to the
// captain — "I understand and will carry out the order" — and the captain is
// the one talking here.

/** Said to agree to what has just been put to you. */
const AFFIRM = [
  'make it so',
  'make it happen',
  'do it',
  'engage',
  'proceed',
  'carry on',
  'very well',
  'execute',
  'confirm',
  'confirmed',
  'acknowledged',
  'acknowledge',
  'understood',
  'affirmative',
  'yes',
  'yep',
  'yeah',
  'aye',
  'go ahead',
  'that is correct',
  'correct',
  'right',
];

/** Said to take it back. */
const BELAY = [
  'belay that',
  'belay that order',
  'belay my last',
  'belay',
  'cancel that',
  'cancel',
  'negative',
  'no',
  'nope',
  'as you were',
  'never mind',
  'nevermind',
  'disregard',
  'forget it',
  'stand down',
  'that is not what i said',
  'wrong',
];

/** The phrases printed on the two buttons, so the screen teaches the words. */
export const AFFIRM_PHRASE = 'make it so';
export const BELAY_PHRASE = 'belay that';

function tidy(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    // "computer, make it so" and "number one, belay that" are the same answer.
    .replace(/^\s*(computer|number one|mister|mr|ms|miss|missus|mrs)\b[\s,]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read a line as an answer to a pending question.
 *
 * @returns {'affirm'|'belay'|null} null when the line is not an answer at all,
 *          in which case the caller should parse it as an ordinary order — a
 *          captain who says "fire phasers" while being asked something has
 *          changed the subject, and is entitled to.
 */
export function readAnswer(raw) {
  const text = tidy(raw);
  if (!text) return null;
  if (AFFIRM.includes(text)) return 'affirm';
  if (BELAY.includes(text)) return 'belay';
  return null;
}

/** Every phrase this module answers to, for the tests and the help screen. */
export function answerPhrases() {
  return { affirm: [...AFFIRM], belay: [...BELAY] };
}
