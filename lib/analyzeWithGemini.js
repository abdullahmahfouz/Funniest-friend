// This file runs the actual "AI figures out who's funniest" analysis.
//
// The pattern here is the same one used in HomeAgent: instead of us
// fetching data ourselves and handing Gemini a finished answer, we give
// Gemini a *function* it can call (getMessagesFromChat, from
// lib/readImessageDb.js) and let it decide when to call it and what to do
// with the result. In HomeAgent, that function called an MLS real-estate
// API. Here, it reads your local iMessage database instead. Gemini doesn't
// know or care where the data comes from -- it just sees a function it's
// allowed to call, and a description of what that function does.

import { GoogleGenAI } from "@google/genai";
import { getMessagesFromChat } from "./readImessageDb";

// Which Gemini model to use. Gemini 2.5 Flash is fast and cheap, which is
// plenty for reading a group chat and ranking a handful of people. If you
// used a different model in HomeAgent and want to match it, this is the
// only line you need to change.
const GEMINI_MODEL = "gemini-2.5-flash";

// This describes our function to Gemini: its name, what it does, and what
// arguments it takes. Gemini reads this description to decide when calling
// the function would help it answer the prompt -- it does NOT see our
// actual JavaScript code, only this description.
const getMessagesFunctionDeclaration = {
  name: "getMessagesFromChat",
  description:
    "Returns every message in a group chat, including who sent it, the message text, and how many " +
    "of each tapback reaction (loved, liked, disliked, laughed, emphasized, questioned) it received.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      chatId: {
        type: "number",
        description: "The numeric ID of the group chat to read messages from.",
      },
    },
    required: ["chatId"],
  },
};

// The instructions we give Gemini before it starts working. This is where
// we explain the goal and how to think about "funniest" -- Gemini has no
// built-in idea of what your friend group finds funny, so we spell it out.
function buildInitialPrompt(chatId) {
  return `You are analyzing an iMessage group chat to figure out who is the funniest person in the group.

The chat you're analyzing has chatId = ${chatId}. Call the getMessagesFromChat function to get its messages.

Once you have the messages, reason about who is funniest using all of this, not just one number:
- How many "laughed" tapback reactions each person's messages received. This is the strongest signal.
- Whether the message text itself actually reads as funny. A boring message that happened to get one
  laugh reaction is weaker evidence than a genuinely funny line that got several.
- How many messages someone sent overall. Someone who sends 300 messages and gets 20 laughs is
  different from someone who sends 20 messages and gets 15 laughs.

Rank every person who sent at least one message, from funniest to least funny. For each person, give a
humorScore from 0 to 100 and a short 1-2 sentence reason for their score, written casually like a friend
teasing friends, not like a formal report.

Once you're done reasoning, respond with ONLY valid JSON, no markdown fences and no extra text, in
exactly this shape:
{
  "chatName": "the chat's name if you can tell, otherwise \\"Chat ${chatId}\\"",
  "people": [
    {
      "name": "...",
      "messagesSent": 0,
      "laughs": 0,
      "humorScore": 0,
      "reason": "...",
      "reactions": { "loved": 0, "liked": 0, "disliked": 0, "laughed": 0, "emphasized": 0, "questioned": 0 }
    }
  ]
}`;
}

// Runs whichever function Gemini asked for. Right now there's only one
// possible function, but writing it as a lookup like this makes it obvious
// how you'd add a second tool later (an `if` per function name).
function runRequestedFunction(functionName, args) {
  if (functionName === "getMessagesFromChat") {
    return getMessagesFromChat(args.chatId);
  }
  throw new Error(`Gemini asked for a function we don't have: ${functionName}`);
}

// Gemini's final answer comes back as a plain text string (because we
// asked it to respond with JSON in the prompt above). This turns that text
// into a real JavaScript object, and gives a clear error if Gemini didn't
// follow the instructions.
function parseGeminiJsonResponse(text) {
  try {
    return JSON.parse(text.trim());
  } catch (error) {
    throw new Error(`Gemini's final answer was not valid JSON. Raw response:\n${text}`);
  }
}

// The main export. Give it a chatId, and it runs the whole "ask Gemini,
// Gemini calls our function, we run it, Gemini reasons over the result"
// loop, and returns the final ranking in the shape stats.json expects.
export async function analyzeMessages(chatId) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Add it to .env.local and restart the dev server.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const tools = [{ functionDeclarations: [getMessagesFunctionDeclaration] }];

  // `contents` is the running back-and-forth conversation we send to
  // Gemini. Gemini has no memory of its own between API calls -- this
  // array IS the memory. Every time Gemini says something, or we send it a
  // function result, we add another entry here and send the whole thing
  // again.
  const contents = [{ role: "user", parts: [{ text: buildInitialPrompt(chatId) }] }];

  // We loop because Gemini might want to call the function, look at the
  // result, and ask a follow-up before giving a final answer. In practice
  // this project's prompt is simple enough that it should only take one
  // function call, but we allow a few extra turns just in case.
  const MAX_TURNS = 4;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: { tools },
    });

    const functionCalls = response.functionCalls;

    if (!functionCalls || functionCalls.length === 0) {
      // No more function calls means Gemini is done and has given us its
      // final answer as text. Parse it and shape it for stats.json.
      const geminiAnswer = parseGeminiJsonResponse(response.text);
      const totalMessages = geminiAnswer.people.reduce((sum, person) => sum + person.messagesSent, 0);

      return {
        chatName: geminiAnswer.chatName,
        totalMessages,
        generatedAt: new Date().toISOString(),
        people: geminiAnswer.people,
      };
    }

    // Gemini wants to call our function. First, record that request in the
    // conversation history...
    contents.push({
      role: "model",
      parts: functionCalls.map((call) => ({ functionCall: call })),
    });

    // ...then actually run the function it asked for...
    const functionResultParts = functionCalls.map((call) => ({
      functionResponse: {
        name: call.name,
        response: { result: runRequestedFunction(call.name, call.args) },
      },
    }));

    // ...and send the result back so Gemini can keep reasoning with it.
    contents.push({ role: "user", parts: functionResultParts });
  }

  throw new Error("Gemini did not produce a final answer after several turns. Try again.");
}
