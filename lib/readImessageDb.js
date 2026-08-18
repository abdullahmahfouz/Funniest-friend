// This file knows how to read your iMessage database (chat.db) and turn it
// into a simple list of messages with reaction counts attached.
//
// This is the function Gemini "calls" during analysis, in
// lib/analyzeWithGemini.js. Gemini never touches chat.db directly -- it
// just asks us to run getMessagesFromChat(), and we hand back whatever
// this file returns.
//
// Safety rule: we NEVER open the real chat.db file directly. We always
// copy it to a temporary folder first and read the copy. This matches
// export_stats.py (the original Python version of this project) and
// avoids ever locking or corrupting your real Messages database.

import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

const REAL_CHAT_DB_PATH = path.join(os.homedir(), "Library", "Messages", "chat.db");

// The six tapback ("reaction") types iMessage supports, and the numeric
// code Apple stores in the database for each one. When someone reacts to a
// message, a new row appears in the `message` table with
// associated_message_type set to one of these numbers. A code 1000 higher
// (3000-3005) means the same reaction was later removed.
const REACTION_TYPES = {
  2000: "loved",
  2001: "liked",
  2002: "disliked",
  2003: "laughed",
  2004: "emphasized",
  2005: "questioned",
};
const REACTION_TYPE_CODES = Object.keys(REACTION_TYPES).map(Number);

// Copies chat.db (plus its "-wal" and "-shm" sidecar files, if present)
// into a temporary folder, folds any pending changes into the copy, and
// returns the path to that safe copy. We read from this copy, never from
// the original file.
function copySafeChatDb() {
  if (!fs.existsSync(REAL_CHAT_DB_PATH)) {
    throw new Error(
      `No iMessage database found at ${REAL_CHAT_DB_PATH}. If you have never used Messages on this Mac, there is nothing to read.`
    );
  }

  const tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), "funniest-friend-"));
  const copyPath = path.join(tempFolder, "chat.db");

  try {
    fs.copyFileSync(REAL_CHAT_DB_PATH, copyPath);
    // Recent messages sometimes live only in the "-wal" file (a scratchpad
    // SQLite keeps for changes it hasn't fully saved into chat.db yet).
    // We copy that too, if it exists, so we don't miss the newest messages.
    for (const suffix of ["-wal", "-shm"]) {
      const sidecarPath = REAL_CHAT_DB_PATH + suffix;
      if (fs.existsSync(sidecarPath)) {
        fs.copyFileSync(sidecarPath, copyPath + suffix);
      }
    }
  } catch (error) {
    throw new Error(
      "Could not read chat.db (Operation not permitted). This almost always means the app " +
        "running this code needs Full Disk Access: open System Settings > Privacy & Security > " +
        "Full Disk Access, add your terminal app (or VS Code), then fully quit and reopen it. " +
        `Original error: ${error.message}`
    );
  }

  // Opening the copy normally (not read-only) and running this command
  // forces anything still sitting in the "-wal" scratchpad file to be
  // written into chat.db itself. We do this once, right after copying, so
  // every query after this point can just open the file read-only.
  const setupDb = new Database(copyPath);
  setupDb.pragma("wal_checkpoint(TRUNCATE)");
  setupDb.close();

  return copyPath;
}

// iMessage sometimes stores a reaction's target message ID with an extra
// prefix, like "p:0/SOME-GUID" or "bp:SOME-GUID", instead of a plain GUID.
// This strips that prefix off so we can match a reaction back to the
// message it belongs to.
function cleanMessageGuid(rawGuid) {
  if (!rawGuid) return null;
  const uuidPattern = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/;
  const uuidMatch = rawGuid.match(uuidPattern);
  if (uuidMatch) return uuidMatch[0].toUpperCase();
  const afterSlash = rawGuid.split("/").pop();
  const afterColon = afterSlash.split(":").pop();
  return afterColon.toUpperCase();
}

// Lists every group chat in the database, with a rough message count for
// each, so you can figure out which chatId to pass to getMessagesFromChat()
// below. Note: unlike export_stats.py, this does NOT merge chats that
// switched between iMessage and SMS into one entry -- if the same chat name
// shows up twice, pick the row with more messages.
export function listGroupChats() {
  const dbPath = copySafeChatDb();
  const db = new Database(dbPath, { readonly: true });

  try {
    return db
      .prepare(
        `
        SELECT c.ROWID as chatId,
               COALESCE(NULLIF(TRIM(c.display_name), ''), c.chat_identifier) as name,
               COUNT(cmj.message_id) as messageCount,
               COUNT(DISTINCT chj.handle_id) as participantCount
        FROM chat c
        JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
        LEFT JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
        GROUP BY c.ROWID
        HAVING participantCount > 1
        ORDER BY messageCount DESC
        `
      )
      .all();
  } finally {
    db.close();
  }
}

// The main function. Given a chatId (from listGroupChats() above), returns
// every message in that chat as a simple array of objects, for example:
//   { sender: "Alex", text: "lol", reactions: { laughed: 2, loved: 1, ... } }
export function getMessagesFromChat(chatId) {
  const dbPath = copySafeChatDb();
  const db = new Database(dbPath, { readonly: true });

  try {
    const rows = db
      .prepare(
        `
        SELECT m.guid,
               m.is_from_me,
               h.id as handle,
               m.text,
               m.associated_message_type,
               m.associated_message_guid
        FROM message m
        JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        LEFT JOIN handle h ON h.ROWID = m.handle_id
        WHERE cmj.chat_id = ?
        ORDER BY m.date
        `
      )
      .all(chatId);

    // First pass: collect every plain message (skip tapback rows for now),
    // and remember which sender sent each one. We keep a lookup from
    // "cleaned guid" to the message object so the second pass below can
    // attach reactions to the right message.
    const messagesByGuid = new Map();
    const orderedMessages = [];

    for (const row of rows) {
      const isReaction = REACTION_TYPE_CODES.includes(row.associated_message_type);
      const isReactionRemoval = REACTION_TYPE_CODES.includes(row.associated_message_type - 1000);

      // We're keeping this simple and ignoring reaction removals entirely
      // -- if someone taps a reaction and then removes it, we'll slightly
      // overcount that one reaction. That's an acceptable trade-off for a
      // fun friend-group ranking (the original Python script handles this
      // more precisely, if exact counts ever matter).
      if (isReaction || isReactionRemoval) continue;

      const sender = row.is_from_me ? "Me" : row.handle || "Unknown";
      const message = {
        guid: row.guid,
        sender,
        text: row.text || "",
        reactions: { loved: 0, liked: 0, disliked: 0, laughed: 0, emphasized: 0, questioned: 0 },
      };
      messagesByGuid.set(cleanMessageGuid(row.guid), message);
      orderedMessages.push(message);
    }

    // Second pass: for every tapback row, find the message it targets and
    // add one to that reaction's count.
    for (const row of rows) {
      const reactionName = REACTION_TYPES[row.associated_message_type];
      if (!reactionName) continue;

      const targetGuid = cleanMessageGuid(row.associated_message_guid);
      const targetMessage = messagesByGuid.get(targetGuid);
      if (targetMessage) {
        targetMessage.reactions[reactionName] += 1;
      }
    }

    // Drop the internal `guid` field before returning it -- Gemini doesn't
    // need it, it was only there so we could match reactions to messages.
    return orderedMessages.map(({ guid, ...messageWithoutGuid }) => messageWithoutGuid);
  } finally {
    db.close();
  }
}
