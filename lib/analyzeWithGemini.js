// Asks Gemini to do the one part of this project that needs a
// human-like judgment call: reading someone's funniest messages and
// writing a short, casual comment about them.
//
// Everything else -- message counts, who got laughed at, the exact score
// that decides the ranking -- is already computed by lib/scoreMessages.js
// with deterministic math before this file runs. On purpose: the ranking
// needs to be accurate and repeatable, and an AI re-counting thousands of
// reactions itself would be slower, pricier, and inconsistent run to
// run. Gemini only ever sees the small, already-scored summary below,
// never the raw message history.
//
// GEMINI_API_KEY lives in .env.local, not in this file, so it never ends
// up committed to git or shipped to a browser.

import { GoogleGenAI } from "@google/genai";
import { getDisplayName, getPokemonName } from "./contactNames";
import { getPokemonImageUrl } from "./pokemonAvatars";

// Gemini 2.5 Flash -- fast and cheap, plenty for writing a short comment
// about a handful of people.
const GEMINI_MODEL = "gemini-2.5-flash";

// Builds the prompt we send to Gemini: plain-English instructions
// followed by the scored summary as JSON text embedded in the prompt.
function buildPrompt(chatSummary) {
  const summaryAsText = JSON.stringify(chatSummary.people, null, 2);

  return `You are looking at a scored summary of a friend group's iMessage group chat. The scoring (the
"laughs" number for each person) was already calculated with exact, deterministic math -- do not change it,
recalculate it, or second-guess it. Your only two jobs are below.

Here is the summary, one entry per person:
${summaryAsText}

Each person has a topCandidates list: their best-scoring text messages, with the score each one earned.
These are the ONLY messages you're allowed to choose from -- don't invent a message that isn't in the list.

Job 1: For each person, pick whichever message in their topCandidates list actually reads like a genuine
joke or funny line, not just a message that happened to get reactions for some other reason. Usually that's
the highest-scoring one, but if a higher-scoring message doesn't actually read as funny and a lower-scoring
one does, pick the funnier one instead.

IMPORTANT: never pick a message that's racist, or that makes a joke out of someone's race, ethnicity,
nationality, religion, gender, sexual orientation, or disability -- even if it's the highest-scoring
candidate, even if it's "just how the group jokes around", and even if it doesn't use any explicit slurs (a
joke built on a racial or ethnic stereotype still counts as racist here, slur or no slur). Skip it and pick
the next best candidate that doesn't have that problem instead. If every single candidate for someone has
that problem, set topMessage to an empty string "" for that person rather than choosing one anyway.

Copy the chosen message's text out EXACTLY, character for character, as "topMessage". If someone's
topCandidates list is empty (or every candidate got skipped for the reason above), set topMessage to an
empty string "".

Job 2: Write a short, 1-2 sentence "reason" for each person that reads like a text a friend would actually
send about them, not a written bit. Build the joke entirely out of the CONTENT of their topMessage -- what
it says, the situation it implies, the persona it suggests -- not out of their stats.

Do not mention or allude to their score, laugh count, or message count anywhere in "reason". Those numbers
are already shown elsewhere on the dashboard; restating them ("with X messages...", "you racked up X
laughs...") is filler, not a joke, and is banned here.

Also banned: "You did X, but/yet Y -- are you A or B?" or any setup-contrast-rhetorical-question shape.
If you catch yourself writing a rhetorical question as the punchline, rewrite it as a flat, confident
statement instead.

Each reason should commit to a specific comedic angle on that one message -- e.g. take their line
completely literally and run with it, invent a mock backstory for why they'd say that, address them
directly like you're clowning them in the chat right now, or give them an exaggerated title/persona based
on it. Every person's reason should open differently and use a different angle than the others in this
batch -- if two could have their names swapped and still make sense, rewrite one. Keep it short, sharp, and
actually funny, not observational.

Respond with ONLY valid JSON, no markdown fences and no extra text, and no fields other than name,
topMessage, and reason -- we already have messagesSent, laughs, reactions, and topCandidates ourselves, no
need to repeat them back. Use exactly this shape:
{
  "people": [
    { "name": "...", "topMessage": "...", "reason": "..." }
  ]
}`;
}

// Turns Gemini's text response into a real object, and throws a clear
// error if it didn't follow the JSON instructions.
function parseGeminiJsonResponse(text) {
  // Gemini sometimes wraps its answer in a ```json fence anyway, despite
  // being told not to. Strip that off before parsing.
  const withoutCodeFences = text.trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();

  try {
    return JSON.parse(withoutCodeFences);
  } catch (error) {
    throw new Error(`Gemini's answer was not valid JSON. Raw response:\n${text}`);
  }
}

// Figures out the final topMessage for one person. topCandidates is
// already sorted best-first by lib/scoreMessages.js; geminiEntry is
// whatever Gemini returned for them, or undefined if it skipped them.
//
// Two cases look similar but aren't: Gemini leaving someone out of its
// answer entirely (likely just a slip -- fall back to their top
// candidate) versus Gemini explicitly setting topMessage to "" for
// someone it did answer for (a deliberate "nothing here is appropriate
// to highlight" signal, per buildPrompt above -- must not be overridden
// by picking a candidate anyway).
function pickTopMessage(geminiEntry, topCandidates) {
  if (!geminiEntry) {
    return topCandidates.length > 0 ? topCandidates[0].text : "";
  }

  if (geminiEntry.topMessage === "") {
    return ""; // Gemini deliberately chose not to highlight anyone -- respect that
  }

  const exactMatch = topCandidates.find((candidate) => candidate.text === geminiEntry.topMessage);
  if (exactMatch) return exactMatch.text;

  // No exact match -- Gemini likely paraphrased instead of copying
  // exactly. That's a formatting slip, not a safety signal; fall back to
  // the highest-scoring candidate.
  return topCandidates.length > 0 ? topCandidates[0].text : "";
}

// Takes the chatName and the already-scored summary from
// lib/scoreMessages.js, asks Gemini to pick each person's highlight
// message and write a short comment, and returns data ready to be saved
// as public/stats.json.
export async function synthesizeWithGemini(chatName, chatSummary) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Add it to .env.local and restart the dev server.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: buildPrompt(chatSummary) }] }],
  });

  const geminiAnswer = parseGeminiJsonResponse(response.text);
  const geminiAnswerByName = new Map(geminiAnswer.people.map((entry) => [entry.name, entry]));

  // Merge Gemini's topMessage and reason onto our own deterministic
  // counts (messagesSent, laughs, reactions), never the other way around
  // -- so even if Gemini's JSON is missing someone or gets a name
  // slightly wrong, the numbers on the dashboard are always exactly what
  // lib/scoreMessages.js calculated.
  const people = chatSummary.people.map((person) => {
    const geminiEntry = geminiAnswerByName.get(person.name);
    const geminiReason = geminiEntry ? geminiEntry.reason : "";

    // getPokemonName looks up the Pokemon lib/contactNames.js assigned
    // this person (by raw phone number, before getDisplayName below
    // swaps in a friendly name); getPokemonImageUrl turns that Pokemon's
    // name into an actual picture. Both fall back to null if no Pokemon
    // is assigned yet.
    const pokemonName = getPokemonName(person.name);
    const pokemonImageUrl = pokemonName ? getPokemonImageUrl(pokemonName) : null;

    return {
      // Swaps a raw phone number/email (or "Me") for a friendly name from
      // lib/contactNames.js, if we have one on file.
      name: getDisplayName(person.name),
      messagesSent: person.messagesSent,
      laughs: person.laughs,
      reactions: person.reactions,
      topMessage: pickTopMessage(geminiEntry, person.topCandidates),
      // Gemini occasionally skips someone or leaves reason blank -- not
      // perfectly consistent run to run. Falls back to a plain sentence
      // built from our own numbers instead of showing nothing.
      reason: geminiReason || `Sent ${person.messagesSent} messages and earned a laugh score of ${person.laughs}.`,
      pokemonName,
      pokemonImageUrl,
    };
  });

  // Sort funniest to least funny using our own laughs score -- the
  // deterministic ranking the whole project is built around. Gemini
  // never gets a say in the actual order.
  people.sort((a, b) => b.laughs - a.laughs);

  return {
    chatName,
    totalMessages: chatSummary.totalMessages,
    generatedAt: new Date().toISOString(),
    people,
  };
}
