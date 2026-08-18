#!/usr/bin/env python3
"""
Flask backend for Funniest Friend.

Serves tapback stats pulled from the local iMessage database (via
export_stats.py) and an optional AI-generated "funniest friend" writeup
built from those stats using the Claude API.

Runs entirely on localhost. The live chat.db is never touched -- see
export_stats.py for the read-only copy-and-checkpoint approach.
"""

import atexit
import json
import os
import shutil
import sqlite3
import tempfile

import anthropic
from flask import Flask, jsonify, request, send_from_directory

from export_stats import check_access, compute_stats, copy_database, load_chats

APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(APP_DIR, "static")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")

_state = {"workdir": None, "conn": None, "chats": None}
_stats_cache = {}


class ImessageAccessError(Exception):
    """The chat.db copy/read step failed; message is safe to show the user."""


def _cleanup():
    if _state["conn"] is not None:
        _state["conn"].close()
    if _state["workdir"] is not None:
        shutil.rmtree(_state["workdir"], ignore_errors=True)


atexit.register(_cleanup)


def _load(force=False):
    """Copy chat.db into a scratch dir once per process and load its chats.

    export_stats.check_access() calls sys.exit(1) on failure (it's written
    for a CLI). SystemExit is a BaseException, so it has to be caught
    explicitly here and turned into something Flask's normal error handling
    can route to a JSON response.
    """
    if _state["conn"] is not None and not force:
        return

    if force:
        _cleanup()
        _state["conn"] = None
        _stats_cache.clear()

    try:
        check_access()
        workdir = tempfile.mkdtemp(prefix="funniest-friend-web-", dir="/tmp")
        copy_path = copy_database(workdir)
        conn = sqlite3.connect("file:%s?mode=ro" % copy_path, uri=True)
        conn.text_factory = lambda b: b.decode("utf-8", "replace")
        chats = load_chats(conn)
    except SystemExit:
        raise ImessageAccessError(
            "Cannot read the iMessage database. Grant Full Disk Access to the app "
            "running this server (System Settings > Privacy & Security > Full Disk "
            "Access), then fully quit and relaunch it."
        )
    except Exception as exc:
        raise ImessageAccessError("Failed to read the iMessage database: %s" % exc)

    _state["workdir"] = workdir
    _state["conn"] = conn
    _state["chats"] = chats


def _find_chat(name):
    for chat in _state["chats"]:
        if chat["is_group"] and chat["name"] == name:
            return chat
    return None


def _stats_for(name):
    if name in _stats_cache:
        return _stats_cache[name]
    chat = _find_chat(name)
    if chat is None:
        return None
    result = compute_stats(_state["conn"], chat)
    _stats_cache[name] = result
    return result


@app.errorhandler(ImessageAccessError)
def _handle_access_error(exc):
    return jsonify({"error": str(exc)}), 500


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/api/chats")
def api_chats():
    _load()
    groups = [c for c in _state["chats"] if c["is_group"]]
    return jsonify(
        [
            {
                "name": c["name"],
                "messages": c["messages"],
                "participants": c["participants"],
            }
            for c in groups
        ]
    )


@app.post("/api/refresh")
def api_refresh():
    _load(force=True)
    return jsonify({"ok": True})


@app.get("/api/stats")
def api_stats():
    _load()
    name = request.args.get("chat")
    if not name:
        return jsonify({"error": "missing chat query param"}), 400
    result = _stats_for(name)
    if result is None:
        return jsonify({"error": "no such group chat"}), 404
    stats, diagnostics = result
    return jsonify({"stats": stats, "diagnostics": diagnostics})


ANALYSIS_PROMPT = """You are the resident comedian judging a group chat's tapback stats to crown \
the group's funniest member.

Chat: {chat_name}
Total messages (tapbacks excluded): {total_messages}

Each person below shows messages sent, and reactions RECEIVED on their messages, broken down by \
tapback type ("haha" is the laughing reaction -- treat it as the group's version of a \
laugh-crying/skull reaction).

{people_table}

Write a short, funny, warm superlative report for this friend group. Base the "Funniest Friend" \
title primarily on who received the most "haha" reactions, weighing that against how many \
messages they sent -- a high laugh rate matters more than just being chatty. Also call out 2-3 \
other fun superlatives using the other reaction types (e.g. Most Loved, Most Controversial for \
dislikes, Most Dramatic for "!!" emphasis, Most Confusing for "?"). Keep it specific and roast-y \
but affectionate -- like a friend teasing friends, not a corporate report. Use the exact names \
given and do not invent people.

Respond with ONLY valid JSON, no markdown fences, matching this shape:
{{
  "funniest": {{"name": "...", "blurb": "1-3 punchy sentences explaining why"}},
  "superlatives": [{{"title": "...", "name": "...", "blurb": "1-2 sentences"}}],
  "closing_line": "one short closing line for the whole group"
}}
"""


def _people_table(people):
    lines = []
    for p in people:
        r = p["reactions"]
        lines.append(
            "- %s: %d messages sent, %d haha, %d loved, %d liked, %d emphasized, "
            "%d questioned, %d disliked"
            % (
                p["name"],
                p["messagesSent"],
                r["laughed"],
                r["loved"],
                r["liked"],
                r["emphasized"],
                r["questioned"],
                r["disliked"],
            )
        )
    return "\n".join(lines)


@app.post("/api/analyze")
def api_analyze():
    _load()
    body = request.get_json(silent=True) or {}
    name = body.get("chat")
    if not name:
        return jsonify({"error": "missing chat"}), 400

    result = _stats_for(name)
    if result is None:
        return jsonify({"error": "no such group chat"}), 404
    stats, diagnostics = result

    people = [p for p in stats["people"] if p["name"] != "Me"] or stats["people"]
    if not people:
        return jsonify({"error": "no participants with messages or reactions found"}), 400

    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        return jsonify({"error": "Set ANTHROPIC_API_KEY in the server environment to enable AI analysis."}), 501

    client = anthropic.Anthropic()
    prompt = ANALYSIS_PROMPT.format(
        chat_name=stats["chatName"],
        total_messages=stats["totalMessages"],
        people_table=_people_table(people),
    )

    try:
        response = client.messages.create(
            model="claude-opus-5",
            max_tokens=2000,
            thinking={"type": "adaptive"},
            output_config={"effort": "medium"},
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.RateLimitError as exc:
        return jsonify({"error": "AI analysis rate-limited, try again shortly (%s)" % exc}), 502
    except anthropic.APIStatusError as exc:
        return jsonify({"error": "AI analysis failed (%s)" % exc}), 502
    except anthropic.APIConnectionError as exc:
        return jsonify({"error": "Could not reach the Claude API (%s)" % exc}), 502

    text = "".join(block.text for block in response.content if block.type == "text").strip()
    try:
        analysis = json.loads(text)
    except json.JSONDecodeError:
        analysis = {"raw": text}

    return jsonify({"stats": stats, "analysis": analysis})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=False, threaded=True)
