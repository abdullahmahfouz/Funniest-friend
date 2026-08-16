#!/usr/bin/env python3
"""
Export tapback reaction stats from a macOS iMessage group chat.

Reads the local iMessage database, tallies which participant received the most
reactions (especially "Haha" laughs), and writes stats.json.

The live database is never touched. Everything runs against a copy in a temp
directory, with the write-ahead log checkpointed into that copy first.

Requires Full Disk Access for whichever app launches this script.
"""

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timedelta

CHAT_DB = os.path.expanduser("~/Library/Messages/chat.db")

# associated_message_type values for tapbacks, in the order they appear in the
# iMessage tapback picker. Adding a reaction writes 2000-2005; removing the
# same reaction later writes the matching 3000-3005 row.
REACTION_TYPES = {
    2000: "loved",
    2001: "liked",
    2002: "disliked",
    2003: "laughed",
    2004: "emphasized",
    2005: "questioned",
}
REMOVAL_OFFSET = 1000

# Apple stores timestamps as seconds (older) or nanoseconds (newer) since
# 2001-01-01 UTC.
APPLE_EPOCH = datetime(2001, 1, 1)

UUID_RE = re.compile(
    r"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}"
)


def fail(msg, hint=None):
    print("\nError: %s" % msg, file=sys.stderr)
    if hint:
        print("\n%s" % hint, file=sys.stderr)
    sys.exit(1)


FDA_HINT = """Full Disk Access is required to read the iMessage database.

  1. Open System Settings > Privacy & Security > Full Disk Access
  2. Click + and add the app that is running this script:
       - Terminal.app or iTerm if you ran it from a terminal
       - Visual Studio Code if you ran it from the VS Code integrated terminal
  3. Fully quit that app (Cmd-Q, not just closing the window)
  4. Reopen it and run this script again

macOS only re-checks this permission when a process launches, so the restart
is required."""


def check_access():
    """Verify chat.db exists and is actually readable before copying."""
    if not os.path.exists(CHAT_DB):
        fail(
            "no iMessage database at %s" % CHAT_DB,
            "If you have never used Messages on this Mac, there is nothing to export.",
        )
    try:
        with open(CHAT_DB, "rb") as fh:
            fh.read(16)
    except PermissionError:
        fail("cannot read %s (Operation not permitted)" % CHAT_DB, FDA_HINT)
    except OSError as exc:
        fail("cannot read %s (%s)" % (CHAT_DB, exc))


def copy_database(workdir):
    """Copy chat.db plus its WAL sidecars, then fold the WAL into the copy.

    Recent messages often live only in chat.db-wal. Copying the main file alone
    silently loses them, which shows up as a chat that looks frozen days ago.
    """
    dest = os.path.join(workdir, "chat.db")
    shutil.copyfile(CHAT_DB, dest)
    for suffix in ("-wal", "-shm"):
        side = CHAT_DB + suffix
        if os.path.exists(side):
            try:
                shutil.copyfile(side, dest + suffix)
            except OSError as exc:
                print("Warning: could not copy %s (%s)" % (side, exc), file=sys.stderr)

    # Opening read-write replays the WAL. TRUNCATE forces it fully into the
    # main file so later read-only queries see every message.
    conn = sqlite3.connect(dest)
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.commit()
    except sqlite3.Error as exc:
        print("Warning: WAL checkpoint failed (%s)" % exc, file=sys.stderr)
    finally:
        conn.close()
    return dest


def columns(conn, table):
    return {row[1] for row in conn.execute("PRAGMA table_info(%s)" % table)}


def apple_time(value):
    if not value:
        return None
    seconds = value / 1e9 if value > 1e11 else float(value)
    try:
        return APPLE_EPOCH + timedelta(seconds=seconds)
    except (OverflowError, ValueError):
        return None


def normalize_guid(raw):
    """Strip the part prefixes iMessage puts on associated_message_guid.

    Seen in the wild: a bare GUID, "p:0/GUID" pointing at one part of a
    multipart message, and "bp:GUID" for a bubble part. Without stripping
    these, tapbacks on any multipart message fail to match their target and
    the laugh counts come out far too low.
    """
    if not raw:
        return None
    text = raw.strip()
    match = UUID_RE.search(text)
    if match:
        return match.group(0).upper()
    if "/" in text:
        text = text.rsplit("/", 1)[-1]
    if ":" in text:
        text = text.rsplit(":", 1)[-1]
    return text.upper() or None


def load_chats(conn):
    """List group chats, merging rows that represent the same conversation.

    One logical group chat can span several chat rows when the thread moves
    between iMessage and SMS or the group guid changes. Merging by display
    name keeps those from showing up as separate half-populated chats.
    """
    chat_cols = columns(conn, "chat")
    has_style = "style" in chat_cols

    rows = conn.execute(
        """
        SELECT c.ROWID,
               COALESCE(NULLIF(TRIM(c.display_name), ''), '') AS display_name,
               c.chat_identifier,
               %s,
               COUNT(cmj.message_id) AS msg_count,
               MIN(m.date) AS first_date,
               MAX(m.date) AS last_date
        FROM chat c
        JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
        JOIN message m ON m.ROWID = cmj.message_id
        GROUP BY c.ROWID
        """
        % ("c.style" if has_style else "NULL")
    ).fetchall()

    merged = {}
    for rowid, display_name, identifier, style, count, first, last in rows:
        key = display_name.lower() if display_name else "id:%s" % identifier
        entry = merged.setdefault(
            key,
            {
                "rowids": [],
                "name": display_name or identifier,
                "identifier": identifier,
                "messages": 0,
                "first": None,
                "last": None,
                "is_group": False,
            },
        )
        entry["rowids"].append(rowid)
        entry["messages"] += count
        # style 43 is a group chat, 45 is one-to-one. Fall back to counting
        # participants when the column is missing on an older schema.
        if style == 43 or style is None:
            entry["is_group"] = True
        for field, value in (("first", first), ("last", last)):
            if value is None:
                continue
            if entry[field] is None:
                entry[field] = value
            else:
                entry[field] = min(entry[field], value) if field == "first" else max(entry[field], value)

    chats = list(merged.values())
    for chat in chats:
        placeholders = ",".join("?" * len(chat["rowids"]))
        chat["participants"] = conn.execute(
            "SELECT COUNT(DISTINCT handle_id) FROM chat_handle_join WHERE chat_id IN (%s)"
            % placeholders,
            chat["rowids"],
        ).fetchone()[0]
        if chat["participants"] > 1:
            chat["is_group"] = True

    chats.sort(key=lambda c: c["messages"], reverse=True)
    return chats


def format_chat_row(index, chat):
    first = apple_time(chat["first"])
    last = apple_time(chat["last"])
    span = "%s to %s" % (
        first.strftime("%Y-%m-%d") if first else "?",
        last.strftime("%Y-%m-%d") if last else "?",
    )
    return "%3d. %-42s %7d msgs  %2d people  %s" % (
        index,
        chat["name"][:42],
        chat["messages"],
        chat["participants"],
        span,
    )


def choose_chat(chats, name_filter):
    groups = [c for c in chats if c["is_group"]]
    if not groups:
        fail("no group chats found in the database")

    if name_filter:
        needle = name_filter.lower()
        matches = [c for c in groups if needle in c["name"].lower()]
        if len(matches) == 1:
            print("Matched chat: %s" % matches[0]["name"])
            return matches[0]
        if not matches:
            print("No group chat matched %r. Falling back to the full list.\n" % name_filter)
        else:
            print("Several chats matched %r:\n" % name_filter)
            groups = matches

    print("\nGroup chats:\n")
    for i, chat in enumerate(groups, 1):
        print(format_chat_row(i, chat))

    if not sys.stdin.isatty():
        fail(
            "cannot prompt for a chat because stdin is not a terminal",
            "Re-run with --chat \"part of the chat name\" to pick without prompting.",
        )

    while True:
        raw = input("\nPick a chat number (or q to quit): ").strip()
        if raw.lower() in ("q", "quit", "exit"):
            sys.exit(0)
        if raw.isdigit() and 1 <= int(raw) <= len(groups):
            return groups[int(raw) - 1]
        print("Enter a number between 1 and %d." % len(groups))


def audit_types(conn, rowids):
    """Print raw tapback type counts so the type mapping can be spot checked."""
    placeholders = ",".join("?" * len(rowids))
    rows = conn.execute(
        """
        SELECT m.associated_message_type, COUNT(*), MAX(m.text)
        FROM message m
        JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        WHERE cmj.chat_id IN (%s)
          AND m.associated_message_type IS NOT NULL
          AND m.associated_message_type != 0
        GROUP BY m.associated_message_type
        ORDER BY m.associated_message_type
        """
        % placeholders,
        rowids,
    ).fetchall()
    print("\nRaw associated_message_type breakdown:")
    print("  %-8s %-12s %8s  %s" % ("type", "label", "count", "sample text"))
    for type_id, count, sample in rows:
        if type_id in REACTION_TYPES:
            label = REACTION_TYPES[type_id]
        elif type_id - REMOVAL_OFFSET in REACTION_TYPES:
            label = "un-" + REACTION_TYPES[type_id - REMOVAL_OFFSET]
        else:
            label = "other"
        print("  %-8s %-12s %8d  %s" % (type_id, label, count, (sample or "")[:44]))


def compute_stats(conn, chat):
    rowids = chat["rowids"]
    placeholders = ",".join("?" * len(rowids))
    msg_cols = columns(conn, "message")

    if "associated_message_guid" not in msg_cols or "associated_message_type" not in msg_cols:
        fail(
            "this message table has no tapback columns, so reactions cannot be read",
            "The schema differs from what this script expects. Send me the output of "
            "PRAGMA table_info(message).",
        )

    rows = conn.execute(
        """
        SELECT m.guid,
               m.is_from_me,
               h.id AS handle,
               m.associated_message_type,
               m.associated_message_guid
        FROM message m
        JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        LEFT JOIN handle h ON h.ROWID = m.handle_id
        WHERE cmj.chat_id IN (%s)
        ORDER BY m.date
        """
        % placeholders,
        rowids,
    ).fetchall()

    sender_of = {}
    messages_sent = defaultdict(int)
    reactions = defaultdict(lambda: defaultdict(int))
    tapbacks = []
    total_messages = 0
    unmatched = 0
    other_types = 0

    for guid, is_from_me, handle, assoc_type, assoc_guid in rows:
        sender = "Me" if is_from_me else (handle or "Unknown")
        assoc_type = assoc_type or 0

        is_reaction = assoc_type in REACTION_TYPES
        is_removal = (assoc_type - REMOVAL_OFFSET) in REACTION_TYPES

        if not is_reaction and not is_removal:
            # A plain message. Anything with a nonzero type that is not a
            # tapback (replies, stickers, emoji reactions on Sonoma and later)
            # is counted as a message but noted separately.
            if assoc_type:
                other_types += 1
            if guid:
                sender_of[normalize_guid(guid)] = sender
            messages_sent[sender] += 1
            total_messages += 1
            continue

        target = normalize_guid(assoc_guid)
        if not target:
            unmatched += 1
            continue
        kind = REACTION_TYPES.get(assoc_type) or REACTION_TYPES[assoc_type - REMOVAL_OFFSET]
        tapbacks.append((target, sender, kind, is_removal))

    # Track each distinct (message, reactor, kind) rather than a running total.
    # A removal must cancel only that reactor's own tapback, and a person can
    # only hold one of a given kind on a message at a time.
    active = set()
    for target, reactor, kind, is_removal in tapbacks:
        recipient = sender_of.get(target)
        if recipient is None:
            # The reacted-to message is not in this chat, usually because it
            # predates the local history.
            unmatched += 1
            continue
        key = (target, reactor, kind)
        if is_removal:
            active.discard(key)
        else:
            active.add(key)

    for target, _, kind in active:
        reactions[sender_of[target]][kind] += 1

    names = set(messages_sent) | set(reactions)
    people = []
    for name in names:
        counts = {kind: reactions[name].get(kind, 0) for kind in REACTION_TYPES.values()}
        people.append(
            {
                "name": name,
                "messagesSent": messages_sent.get(name, 0),
                "laughs": counts["laughed"],
                "reactions": counts,
            }
        )
    people.sort(key=lambda p: (p["laughs"], p["messagesSent"]), reverse=True)

    stats = {
        "chatName": chat["name"],
        "totalMessages": total_messages,
        "people": people,
    }
    diagnostics = {
        "tapbacks_seen": len(tapbacks),
        "unmatched": unmatched,
        "other_types": other_types,
    }
    return stats, diagnostics


def print_summary(stats, diagnostics):
    print("\nChat: %s" % stats["chatName"])
    print("Messages (tapbacks excluded): %d" % stats["totalMessages"])
    print(
        "Tapbacks: %d matched to a message, %d unmatched"
        % (diagnostics["tapbacks_seen"] - diagnostics["unmatched"], diagnostics["unmatched"])
    )
    if diagnostics["other_types"]:
        print("Non-tapback special messages counted as messages: %d" % diagnostics["other_types"])

    header = "%-30s %8s %8s %7s %7s %7s %7s %7s" % (
        "person", "msgs", "haha", "loved", "liked", "!!", "?", "dislike",
    )
    print("\n" + header)
    print("-" * len(header))
    for person in stats["people"]:
        r = person["reactions"]
        print(
            "%-30s %8d %8d %7d %7d %7d %7d %7d"
            % (
                person["name"][:30],
                person["messagesSent"],
                r["laughed"],
                r["loved"],
                r["liked"],
                r["emphasized"],
                r["questioned"],
                r["disliked"],
            )
        )

    if diagnostics["unmatched"] > diagnostics["tapbacks_seen"] * 0.2 and diagnostics["tapbacks_seen"]:
        print(
            "\nWarning: over 20 percent of tapbacks did not match a message. "
            "Run again with --audit to inspect the raw types."
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chat", help="pick a chat by name substring instead of prompting")
    parser.add_argument("--out", default="stats.json", help="output path (default: stats.json)")
    parser.add_argument("--list", action="store_true", help="list group chats and exit")
    parser.add_argument("--audit", action="store_true", help="print raw tapback type counts")
    parser.add_argument("--keep-copy", action="store_true", help="do not delete the temp database copy")
    args = parser.parse_args()

    check_access()

    workdir = tempfile.mkdtemp(prefix="funniest-friend-", dir="/tmp")
    try:
        print("Copying database to %s ..." % workdir)
        copy_path = copy_database(workdir)

        conn = sqlite3.connect("file:%s?mode=ro" % copy_path, uri=True)
        conn.text_factory = lambda b: b.decode("utf-8", "replace")
        try:
            chats = load_chats(conn)

            if args.list:
                print("\nGroup chats:\n")
                for i, chat in enumerate([c for c in chats if c["is_group"]], 1):
                    print(format_chat_row(i, chat))
                return

            chat = choose_chat(chats, args.chat)
            if args.audit:
                audit_types(conn, chat["rowids"])

            stats, diagnostics = compute_stats(conn, chat)
        finally:
            conn.close()

        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(stats, fh, indent=2, ensure_ascii=False)

        print_summary(stats, diagnostics)
        print("\nWrote %s" % os.path.abspath(args.out))
    finally:
        if args.keep_copy:
            print("Left database copy at %s" % workdir)
        else:
            shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    main()
