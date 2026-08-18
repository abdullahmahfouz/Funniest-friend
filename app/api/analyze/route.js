// This is the API route that actually runs the analysis:
//   POST /api/analyze   with a JSON body of { chatId, secret }
//
// IMPORTANT -- this route only works when YOU run it locally on your own
// Mac (via `npm run dev`), never on the live Vercel site. Here's why: this
// route reads ~/Library/Messages/chat.db, which is a file on your laptop.
// Vercel's servers are not your laptop -- they have no access to that
// file, no matter what. So even after this project is deployed, hitting
// this route on the live URL will always fail at the "read chat.db" step.
// That's not a bug to fix, it's exactly what keeps this safe: your friends
// browsing the live site can only ever see the static public/stats.json
// file that already exists. There is nothing for them to trigger.
//
// The `secret` check below is a second layer of protection for when you
// run this locally (in case your dev server is ever reachable by someone
// else on the same network) -- but the real protection is that your
// Gemini API key and your chat.db only exist on your own computer, and we
// never add that key to Vercel's settings.

import fs from "fs";
import path from "path";
import { analyzeMessages } from "../../../lib/analyzeWithGemini";
import { listGroupChats } from "../../../lib/readImessageDb";

// Forces this route to run in a normal Node.js environment (not Next.js's
// lightweight "Edge" environment). We need this because better-sqlite3,
// used deep inside analyzeMessages(), needs regular Node.js to work.
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
// Runs the real analysis and overwrites public/stats.json with the result.
export async function POST(request) {
  const body = await request.json();
  const { chatId, secret } = body;

  // Reject the request unless the secret matches the one only you know,
  // stored in .env.local as ANALYZE_SECRET. This stops anyone else who
  // finds this route from running an analysis (and spending your Gemini
  // credit) even while your dev server is running.
  if (!process.env.ANALYZE_SECRET || secret !== process.env.ANALYZE_SECRET) {
    return Response.json({ error: "Invalid or missing secret." }, { status: 401 });
  }

  if (typeof chatId !== "number") {
    return Response.json({ error: "Missing or invalid chatId (expected a number)." }, { status: 400 });
  }

  let result;
  try {
    result = await analyzeMessages(chatId);
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
