// The API route that actually runs the analysis:
//   POST /api/analyze   with a JSON body of { chatId, secret }
//
// IMPORTANT -- only works when run locally (`npm run dev`), never on the
// live Vercel site. It reads ~/Library/Messages/chat.db, a file on your
// laptop that Vercel's servers have no access to, so hitting this route
// on the live URL always fails at the "read chat.db" step. That's the
// real protection: friends browsing the live site only ever see the
// static public/stats.json that's already there -- there's nothing for
// them to trigger.
//
// The `secret` check below is a second layer, for when this runs locally
// and the dev server happens to be reachable by someone else on the
// network -- but the real protection is that the Gemini API key and
// chat.db only exist on this machine, and that key never goes into
// Vercel's settings.
//
// The pipeline this route runs, step by step:
//   1. lib/runChatReader.js reads the raw messages out of chat.db
//      (via a Python helper script -- see that file for why).
//   2. lib/scoreMessages.js turns those raw messages into a
//      deterministic score for each person. No AI involved.
//   3. lib/analyzeWithGemini.js asks Gemini to pick each person's
//      funniest message and write a short comment about them.
//   4. The combined result gets saved to public/stats.json, which the
//      dashboard (app/page.js) reads and displays.

import fs from "fs";
import path from "path";
import { listGroupChats, readChat } from "../../../lib/runChatReader";
import { scoreChatMessages } from "../../../lib/scoreMessages";
import { synthesizeWithGemini } from "../../../lib/analyzeWithGemini";

// Forces this route onto the normal Node.js runtime, not Next.js's
// lightweight Edge runtime -- starting the Python script below needs
// Node's child_process module, which Edge doesn't have.
export const runtime = "nodejs";

// GET /api/analyze?secret=YOUR_SECRET
// Lists your group chats and their chatId, so you know which chatId to
// pass to POST below. Run this first.
export async function GET(request) {
  const secret = new URL(request.url).searchParams.get("secret");

  if (!process.env.ANALYZE_SECRET || secret !== process.env.ANALYZE_SECRET) {
    return Response.json({ error: "Invalid or missing secret." }, { status: 401 });
  }

  try {
    return Response.json({ chats: listGroupChats() });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/analyze   body: { "chatId": 123, "secret": "YOUR_SECRET" }
// Runs the full pipeline described above and overwrites public/stats.json
// with the result.
export async function POST(request) {
  const body = await request.json();
  const { chatId, secret } = body;

  // Reject unless the secret matches ANALYZE_SECRET in .env.local --
  // stops anyone else who finds this route from running an analysis (and
  // burning Gemini credit) while the dev server is up.
  if (!process.env.ANALYZE_SECRET || secret !== process.env.ANALYZE_SECRET) {
    return Response.json({ error: "Invalid or missing secret." }, { status: 401 });
  }

  if (typeof chatId !== "number") {
    return Response.json({ error: "Missing or invalid chatId (expected a number)." }, { status: 400 });
  }

  let result;
  try {
    const rawChat = readChat(chatId); // Step 1: read chat.db
    const scoredChat = scoreChatMessages(rawChat.messages); // Step 2: deterministic scoring
    result = await synthesizeWithGemini(rawChat.chatName, scoredChat); // Step 3: Gemini picks highlights + writes comments
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Save the result where the dashboard page reads it from.
  const statsFilePath = path.join(process.cwd(), "public", "stats.json");
  fs.writeFileSync(statsFilePath, JSON.stringify(result, null, 2));

  return Response.json({
    message: `Analysis complete. Ranked ${result.people.length} people, wrote public/stats.json.`,
  });
}
