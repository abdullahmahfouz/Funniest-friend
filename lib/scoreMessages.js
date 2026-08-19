// Takes the raw messages from scripts/read_imessage_db.py (via
// lib/runChatReader.js) and turns them into a "who made people laugh"
// score for each person, using plain, deterministic math. No AI here on
// purpose: the counting and scoring rules need to give the exact same
// answer every time, and an AI re-reading thousands of rows itself would
// be slower, pricier, and could count differently each run. Gemini's
// turn comes later, in lib/analyzeWithGemini.js, after this file has
// already done the counting.

import { containsBlockedTerm } from "./contentFilter";

// A "tapback" is what Apple calls the reaction bubble you get from
// long-pressing a message and picking a heart, thumbs up, laugh, etc.
// When someone taps one, it shows up in chat.db as its own row, separate
// from the message it's reacting to, with associated_message_type set to
// one of the codes below and associated_message_guid pointing at the
// message it's reacting to. A code exactly 1000 higher (for example 3003
// instead of 2003) means that same reaction was later removed -- we
// ignore removals everywhere in this file, so a tapped-then-untapped
// reaction gets slightly overcounted. Acceptable trade-off for a fun
// friend-group ranking.
const CLASSIC_TAPBACK_TYPES = {
  2000: "loved",
  2001: "liked",
  2002: "disliked",
  2003: "laughed",
  2004: "emphasized",
  2005: "questioned",
};
const CLASSIC_LAUGH_TAPBACK_TYPE = 2003;

// Newer iPhones also let you tapback with ANY emoji, not just the six
// classic ones above. Those rows use type 2006, with the actual emoji
// character stored in the associated_message_emoji column instead of
// being baked into the type number.
const CUSTOM_EMOJI_TAPBACK_TYPE = 2006;

// The "removed" version of each tapback type above is exactly 1000 higher
// (for example, 3003 means "someone took back their Laughed tapback").
// Listed here explicitly, instead of computed with math, so it's obvious
// at a glance what these numbers mean.
const CLASSIC_TAPBACK_REMOVAL_TYPES = [3000, 3001, 3002, 3003, 3004, 3005];
const CUSTOM_EMOJI_TAPBACK_REMOVAL_TYPE = 3006;

// The emoji this friend group's scoring rules care about. Some only
// count when used as a tapback, never from someone typing the emoji into
// a reply; others count both ways. See scoreChatMessages() below for
// exactly how each one is used.
const LAUGH_TAPBACK_ONLY_EMOJI = ["😂", "🤣"];
const LAUGH_TAPBACK_AND_TEXT_EMOJI = ["💀", "😭"];

// Matches a typed reply that's basically just laughing in words: "haha",
// "hahaha", "hahahaha", and so on (case-insensitive). Requires the
// entire message to be nothing but repeated "ha" (with an optional
// trailing "h"), so a real sentence that happens to contain "haha" in
// the middle (like "hahaha that's actually crazy") won't match -- only
// short, laugh-only replies do. Kept as its own constant so it's easy to
// add more patterns later, like "lol" or "lmao".
const HAHA_PATTERN = /^(ha){2,}h?$/i;

// How many points each kind of signal is worth. Pulled out as constants
// so they're easy to find and tune later without hunting through the
// scoring logic.
const SCORE_WEIGHTS = {
  classicLaughTapback: 1, // someone tapped the classic 😂 "Laughed" tapback on this message
  customEmojiTapback: 1, // someone tapped a custom 😂🤣💀😭 emoji tapback on this message
  threadedReply: 1, // someone used iMessage's native "reply to this exact message" feature
  anchorProximityReply: 0.5, // someone typed a short 💀😭/haha reply shortly after this message
};

// A typed reply only counts as "reacting to the anchor" if it comes within
// this many seconds of the anchor message itself. 3 minutes, written in
// seconds because that's what our timestamps are in.
const ANCHOR_WINDOW_SECONDS = 3 * 60;

// Only messages with real text can become a person's topMessage (their
// funniest highlight) -- an attachment with no caption can still earn
// points for whoever sent it, but we can't show it as a joke on the
// dashboard. This is how many of a person's best-scoring text messages
// we keep around as candidates, so lib/analyzeWithGemini.js has a few
// options to pick a genuinely funny (and appropriate) one from, not just
// whatever scored highest. Kept a bit larger than the bare minimum so
// there's still real choice left after containsBlockedTerm below removes
// anything with a slur in it.
const TOP_CANDIDATE_MESSAGES_PER_PERSON = 5;

// associated_message_guid (and thread_originator_guid) sometimes come with
// an extra prefix attached, like "p:0/SOME-GUID" or "bp:SOME-GUID",
// instead of being a plain GUID. This pulls the real GUID out and makes it
// uppercase, so it matches however we stored that same message's guid.
function cleanGuid(rawGuid) {
  if (!rawGuid) return null;
  const uuidPattern = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/;
  const uuidMatch = rawGuid.match(uuidPattern);
  if (uuidMatch) return uuidMatch[0].toUpperCase();
  const afterSlash = rawGuid.split("/").pop();
  const afterColon = afterSlash.split(":").pop();
  return afterColon.toUpperCase();
}

function emptyReactionCounts() {
  return { loved: 0, liked: 0, disliked: 0, laughed: 0, emphasized: 0, questioned: 0 };
}

// Decides whether a typed message "looks like" a laugh reaction rather
// than a real sentence: either it matches the haha pattern, or it's
// short (6 characters or fewer once you strip whitespace) and every
// non-whitespace character is 💀 or 😭. A message like "Bruh 💀" does not
// count here (it has real words in it, not just the emoji) -- it's
// treated as its own new anchor instead of a reaction to whatever came
// before it.
function looksLikeAReaction(text) {
  const stripped = text.trim();
  if (stripped === "") return false;

  if (HAHA_PATTERN.test(stripped)) return true;

  // Array.from splits into individual visible characters (including
  // emoji), safer than using .length or [i] directly -- some emoji take
  // up more than one code unit internally.
  const characters = Array.from(stripped);
  if (characters.length > 6) return false;

  return characters.every((character) => LAUGH_TAPBACK_AND_TEXT_EMOJI.includes(character));
}

function totalReactions(reactions) {
  return Object.values(reactions).reduce((sum, count) => sum + count, 0);
}

// Takes the raw messages array from scripts/read_imessage_db.py (already
// read for one chat, in chronological order) and returns a plain-data
// summary: for every person, how many messages they sent, their exact
// combined laugh score, their raw classic-tapback breakdown, and a few
// of their best text messages as topMessage candidates.
export function scoreChatMessages(rawMessages) {
  // Step 1: split the raw rows into two groups. "Real" messages
  // (associatedMessageType === 0) are actual content someone sent.
  // Everything else with a known tapback type is a reaction to some
  // other message, not a message of its own. Anything with an
  // unrecognized type number is treated as a real message too -- we
  // only special-case the type numbers we actually understand.
  const realMessages = [];
  const tapbackRows = [];

  for (const message of rawMessages) {
    const type = message.associatedMessageType;

    const isRemovedReaction =
      CLASSIC_TAPBACK_REMOVAL_TYPES.includes(type) || type === CUSTOM_EMOJI_TAPBACK_REMOVAL_TYPE;
    if (isRemovedReaction) {
      continue; // ignore removed reactions entirely, see comment above CLASSIC_TAPBACK_TYPES
    }

    const isClassicTapback = type in CLASSIC_TAPBACK_TYPES;
    const isCustomEmojiTapback = type === CUSTOM_EMOJI_TAPBACK_TYPE;

    if (isClassicTapback || isCustomEmojiTapback) {
      tapbackRows.push(message);
    } else {
      realMessages.push({ ...message, score: 0, reactions: emptyReactionCounts() });
    }
  }

  // A lookup from a message's cleaned guid to the message object itself,
  // so we can quickly find the message a tapback or reply points at.
  // Only real messages can be a target -- you can't tapback a tapback.
  const realMessagesByGuid = new Map();
  for (const message of realMessages) {
    realMessagesByGuid.set(cleanGuid(message.guid), message);
  }

  // Step 2: attribute every tapback row to the message (and therefore the
  // person) it's reacting to.
  for (const tapback of tapbackRows) {
    const target = realMessagesByGuid.get(cleanGuid(tapback.associatedMessageGuid));
    if (!target) continue; // the message it's reacting to isn't in this chat's data, skip it

    const type = tapback.associatedMessageType;

    if (type in CLASSIC_TAPBACK_TYPES) {
      // One of the six classic tapback types. Always counts toward the
      // raw reactions breakdown (Step 4's "reactions" field), and also
      // toward the combined score if it's specifically the Laughed
      // tapback.
      const reactionName = CLASSIC_TAPBACK_TYPES[type];
      target.reactions[reactionName] += 1;
      if (type === CLASSIC_LAUGH_TAPBACK_TYPE) {
        target.score += SCORE_WEIGHTS.classicLaughTapback;
      }
    } else if (type === CUSTOM_EMOJI_TAPBACK_TYPE) {
      // A custom emoji tapback. Only counts toward the score if it's one
      // of our two laugh-signal emoji groups -- a 💙 or 🇦🇫 tapback (people
      // really do use flag emoji as tapbacks) says nothing about whether
      // the message was funny, so we ignore those.
      const emoji = tapback.associatedMessageEmoji;
      if (LAUGH_TAPBACK_ONLY_EMOJI.includes(emoji) || LAUGH_TAPBACK_AND_TEXT_EMOJI.includes(emoji)) {
        target.score += SCORE_WEIGHTS.customEmojiTapback;
      }
    }
  }

  // Step 3: walk every real message in chronological order and apply
  // the "anchor" logic for typed replies (tapbacks were already handled
  // in Step 2). We track one current anchor message at a time. A native
  // threaded reply always credits its exact target and never touches
  // the anchor. Otherwise, if a message is short and reaction-shaped
  // (💀/😭 or "haha") and arrived within 3 minutes of the current
  // anchor, it credits the anchor instead of becoming a new one.
  // Anything else becomes the new anchor -- this stops a chain of three
  // people replying 💀 to the same joke from crediting each other
  // instead of the original joke.
  let anchor = null;

  for (const message of realMessages) {
    const threadTarget = realMessagesByGuid.get(cleanGuid(message.threadOriginatorGuid));

    if (threadTarget) {
      threadTarget.score += SCORE_WEIGHTS.threadedReply;
      continue; // native replies never move the anchor
    }

    const withinAnchorWindow =
      anchor !== null && message.timestamp - anchor.timestamp <= ANCHOR_WINDOW_SECONDS;

    if (looksLikeAReaction(message.text) && anchor !== null && withinAnchorWindow) {
      anchor.score += SCORE_WEIGHTS.anchorProximityReply;
      // anchor stays the same on purpose -- see Step 3 comment above
    } else {
      anchor = message;
    }
  }

  // Step 4: group the now-scored messages by sender and build the final
  // per-person summary.
  const peopleByName = new Map();
  for (const message of realMessages) {
    if (!peopleByName.has(message.sender)) {
      peopleByName.set(message.sender, {
        name: message.sender,
        messagesSent: 0,
        combinedScore: 0,
        reactions: emptyReactionCounts(),
        textMessages: [],
      });
    }

    const person = peopleByName.get(message.sender);
    person.messagesSent += 1;
    person.combinedScore += message.score;
    for (const reactionName of Object.keys(person.reactions)) {
      person.reactions[reactionName] += message.reactions[reactionName];
    }
    if (message.text.trim() !== "") {
      person.textMessages.push(message);
    }
  }

  const people = [...peopleByName.values()].map((person) => {
    const topCandidates = person.textMessages
      // Drop anything with a slur before we even rank by score -- a
      // message like this should never become someone's public
      // highlight, no matter how many reactions it got.
      .filter((message) => !containsBlockedTerm(message.text))
      .slice()
      .sort((a, b) => b.score - a.score || a.timestamp - b.timestamp)
      .slice(0, TOP_CANDIDATE_MESSAGES_PER_PERSON)
      .map((message) => ({ text: message.text, score: message.score }));

    return {
      name: person.name,
      messagesSent: person.messagesSent,
      laughs: person.combinedScore,
      reactions: person.reactions,
      topCandidates,
    };
  });

  return { totalMessages: realMessages.length, people };
}
