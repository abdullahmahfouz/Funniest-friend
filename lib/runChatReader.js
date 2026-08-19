// This file's only job is starting scripts/read_imessage_db.py (the
// Python script that reads chat.db) and handing back whatever it prints.
//
// We need a separate program because decoding some of the message text
// requires a Python-only library called pytypedstream (see the comment
// at the top of scripts/read_imessage_db.py for why). Everything else in
// this project is JavaScript, with no equivalent library. So we shell
// out to Python as a child process using Node's built-in child_process
// module, and parse whatever it prints as JSON.

import { execFileSync } from "child_process";
import path from "path";

// Points at the interpreter inside this project's virtual environment
// (.venv), not just "python3", so this always uses the copy of Python
// that has pytypedstream installed, regardless of other Python versions
// on this Mac. See requirements.txt for how to set that up.
const PROJECT_ROOT = process.cwd();
const PYTHON_PATH = path.join(PROJECT_ROOT, ".venv", "bin", "python");
const SCRIPT_PATH = path.join(PROJECT_ROOT, "scripts", "read_imessage_db.py");

// Runs the Python script with the given command-line flags (for example
// ["--list"] or ["--chat-id", "660"]), waits for it to finish, and parses
// whatever it printed as JSON. Throws a clear error if Python isn't set
// up yet, or if the script itself failed (for example, missing Full Disk
// Access).
function runPythonReader(args) {
  let output;
  try {
    output = execFileSync(PYTHON_PATH, [SCRIPT_PATH, ...args], {
      // Output can be several megabytes for a big group chat -- Node's
      // default 1MB buffer limit isn't enough.
      maxBuffer: 200 * 1024 * 1024,
      encoding: "utf-8",
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        "Could not find the Python virtual environment at .venv. Run this once to set it up: " +
          "python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
      );
    }
    // If the script raised an error on purpose (for example, no Full
    // Disk Access), it printed a clear message to stderr before exiting
    // -- pass that through instead of a vague "process failed" error.
    const pythonErrorMessage = error.stderr ? error.stderr.toString().trim() : error.message;
    throw new Error(pythonErrorMessage);
  }

  return JSON.parse(output);
}

// Returns every group chat on this Mac, so the person running this app
// can see which chatId belongs to which chat.
export function listGroupChats() {
  return runPythonReader(["--list"]);
}

// Returns one chat's name and every raw message in it, ready to be scored
// by lib/scoreMessages.js.
export function readChat(chatId) {
  return runPythonReader(["--chat-id", String(chatId)]);
}
