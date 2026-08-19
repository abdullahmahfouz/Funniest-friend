"""
Reads the iMessage database (chat.db) and turns it into raw, structured
data: every message in a chat, who sent it, what it says, when it was
sent, and the columns needed later to figure out tapback reactions and
threaded replies.

Does NOT decide who is funniest -- that scoring logic lives in
lib/scoreMessages.js. This script's only job is reading and decoding the
raw iMessage data as accurately as possible, then printing it as JSON.

RUNNING THIS FILE DIRECTLY (useful for testing, outside the web app):

    List every group chat you're in, so you can find the one you want:
        .venv/bin/python scripts/read_imessage_db.py --list

    Pull every message from one specific chat (replace 660 with your chatId):
        .venv/bin/python scripts/read_imessage_db.py --chat-id 660

    Run it with no flags at all for an interactive picker: it prints every
    chat with a number next to it, asks you to type a number, then reads
    that chat:
        .venv/bin/python scripts/read_imessage_db.py

The Next.js backend (lib/runChatReader.js) calls this same script as a
subprocess, with --list or --chat-id. We need a second program at all
here because decoding some of the message text below requires a
Python-only library (pytypedstream) -- the rest of this project is
JavaScript, and there's no equivalent library there.
"""

import sys
import os
import json
import shutil
import sqlite3
import tempfile
import atexit

import typedstream


# ---------------------------------------------------------------------------
# Part 1: safely copying chat.db before we read anything from it
# ---------------------------------------------------------------------------

# Apple stores your iMessage history at this exact path on every Mac.
REAL_CHAT_DB_PATH = os.path.join(os.path.expanduser("~"), "Library", "Messages", "chat.db")

# Copies chat.db into a temp folder once per run of this script, and
# remembers the copy's path here so a single run never copies the same
# (possibly several-hundred-megabyte) file more than once, even across
# multiple queries.
_cached_safe_copy_path = None


def copy_chat_db_to_temp_folder():
    """
    Copies chat.db, plus its "-wal" and "-shm" sidecar files, into a
    fresh temporary folder, and returns the path to the copy.

    We never read the real file directly: chat.db is actively being
    written to by the Messages app while it's open, and reading the live
    file risks locking it (can freeze Messages) or reading it mid-write
    (corrupted data). Copying it first gives us a safe, frozen snapshot
    instead.

    "-wal" is a scratchpad SQLite keeps for very recent changes not yet
    saved into chat.db -- skipping it could miss the newest messages.
    "-shm" is a small helper file SQLite keeps alongside it, copied for
    the same reason.
    """
    if not os.path.exists(REAL_CHAT_DB_PATH):
        raise RuntimeError(
            f"No iMessage database found at {REAL_CHAT_DB_PATH}. "
            "If you have never used Messages on this Mac, there is nothing to read."
        )

    temp_folder = tempfile.mkdtemp(prefix="funniest-friend-")

    # chat.db can run around 400MB on a well-used Mac, and every run of
    # this script makes a fresh copy of it. Without this line, that copy
    # would sit in the temp folder forever after this script exits -- run
    # this a few times and it can quietly fill up the whole disk.
    # atexit.register runs this cleanup right before the program closes,
    # whether it finishes normally or crashes, so the copy always gets
    # deleted.
    atexit.register(shutil.rmtree, temp_folder, ignore_errors=True)

    copy_path = os.path.join(temp_folder, "chat.db")

    try:
        shutil.copyfile(REAL_CHAT_DB_PATH, copy_path)
        for suffix in ("-wal", "-shm"):
            sidecar_path = REAL_CHAT_DB_PATH + suffix
            if os.path.exists(sidecar_path):
                shutil.copyfile(sidecar_path, copy_path + suffix)
    except PermissionError as error:
        raise RuntimeError(
            "Could not read chat.db (permission denied). This almost always means the "
            "process running this script needs Full Disk Access: open System Settings > "
            "Privacy & Security > Full Disk Access, add your terminal app (whatever app you "
            "ran this script from), then fully quit and reopen that app. "
            f"Original error: {error}"
        ) from error

    # Opening the copy normally (not read-only) and running this command
    # forces anything still sitting in the "-wal" scratchpad file to be
    # written into chat.db itself. Done once, right after copying, so
    # every query after this point can just open the file read-only.
    setup_connection = sqlite3.connect(copy_path)
    setup_connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    setup_connection.close()

    return copy_path


def get_safe_copy_path():
    """Returns the path to our safe copy of chat.db, copying it the first time this is called."""
    global _cached_safe_copy_path
    if _cached_safe_copy_path is None:
        _cached_safe_copy_path = copy_chat_db_to_temp_folder()
    return _cached_safe_copy_path


def open_safe_connection():
    """Opens a read-only database connection to our safe copy of chat.db."""
    copy_path = get_safe_copy_path()
    # "file:...?mode=ro" opens the file read-only, an extra safety net on
    # top of only ever touching the copy.
    return sqlite3.connect(f"file:{copy_path}?mode=ro", uri=True)


# ---------------------------------------------------------------------------
# Part 2: decoding message text, including the binary attributedBody column
# ---------------------------------------------------------------------------

def decode_attributed_body(blob):
    """
    Recovers the plain text hidden inside the attributedBody column.

    On modern macOS, the message.text column is very often NULL. When
    that happens, the real text lives inside attributedBody instead -- a
    column full of raw binary data (not human-readable) written in
    Apple's old "typedstream" format, originally meant for storing rich
    text (fonts, colors) alongside a message.

    This matters a lot for this project specifically: short emoji-only
    replies (like a lone "\U0001F480") are exactly the kind of message
    that tends to land in attributedBody instead of the text column, and
    those short reactions are central to how we score people in
    lib/scoreMessages.js.

    Uses the pytypedstream library to decode this format properly,
    instead of hand-parsing the binary bytes ourselves, which would be
    fragile and likely to break on the next macOS update.

    Returns the decoded text as a plain string, or None if there's
    nothing readable inside (for example, a message that's only a photo
    with no caption).
    """
    if blob is None:
        return None

    try:
        archived_object = typedstream.unarchive_from_data(blob)
    except Exception:
        # A handful of rows are damaged, or shaped in a way this library
        # doesn't expect. We skip just that one message instead of
        # crashing the whole read.
        return None

    contents = getattr(archived_object, "contents", None)
    if not contents:
        return None

    # The first item inside an attributedBody archive is always the
    # actual string content (an NSString or NSMutableString object,
    # Apple's version of a text string). Everything after it is
    # formatting information (fonts, colors) we don't need.
    first_item = contents[0]
    string_object = getattr(first_item, "value", None)
    text_value = getattr(string_object, "value", None)

    if isinstance(text_value, str):
        return text_value
    return None


def get_message_text(text_column, attributed_body_column):
    """
    Figures out a message's real text: uses the plain text column if it
    has something in it, otherwise falls back to decoding attributedBody.
    Returns an empty string if neither has any text (for example, a
    photo-only message with no caption).
    """
    if text_column is not None and text_column.strip() != "":
        return text_column
    decoded = decode_attributed_body(attributed_body_column)
    return decoded if decoded is not None else ""


# ---------------------------------------------------------------------------
# Part 3: timestamps
# ---------------------------------------------------------------------------

# Apple stores message timestamps as nanoseconds since January 1st, 2001,
# not the more common "seconds since January 1st, 1970" (Unix time) that
# almost every other system uses. This constant is the number of seconds
# between those two dates, so we can convert between them.
APPLE_EPOCH_OFFSET_SECONDS = 978307200


def apple_timestamp_to_unix_seconds(apple_date):
    """Converts a chat.db `date` value (Apple time, nanoseconds) into ordinary Unix seconds."""
    if apple_date is None:
        return None
    return (apple_date / 1_000_000_000) + APPLE_EPOCH_OFFSET_SECONDS


# ---------------------------------------------------------------------------
# Part 4: the actual database queries
# ---------------------------------------------------------------------------

def list_group_chats():
    """
    Returns every group chat (a chat with more than one other participant)
    in the database, with a rough message count for each, so you can
    figure out which chatId to read messages from.
    """
    connection = open_safe_connection()
    try:
        rows = connection.execute(
            """
            SELECT c.ROWID as chat_id,
                   COALESCE(NULLIF(TRIM(c.display_name), ''), c.chat_identifier) as name,
                   COUNT(cmj.message_id) as message_count,
                   COUNT(DISTINCT chj.handle_id) as participant_count
            FROM chat c
            JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
            LEFT JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
            GROUP BY c.ROWID
            HAVING participant_count > 1
            ORDER BY message_count DESC
            """
        ).fetchall()
    finally:
        connection.close()

    chats = []
    for chat_id, name, message_count, participant_count in rows:
        chats.append(
            {
                "chatId": chat_id,
                "name": name,
                "messageCount": message_count,
                "participantCount": participant_count,
            }
        )
    return chats


def get_chat_name(chat_id):
    """Looks up one chat's display name directly, by its chatId."""
    connection = open_safe_connection()
    try:
        row = connection.execute(
            "SELECT COALESCE(NULLIF(TRIM(display_name), ''), chat_identifier) FROM chat WHERE ROWID = ?",
            (chat_id,),
        ).fetchone()
    finally:
        connection.close()
    return row[0] if row else f"Chat {chat_id}"


def read_raw_messages(chat_id):
    """
    Reads every message in one chat, in the order they were sent, and
    returns them as a list of plain dictionaries.

    Includes both normal messages and tapback/reaction rows -- a tapback
    (someone reacting to a message) shows up as its own row in this
    table, not as part of the message it's reacting to. Telling the two
    apart, and applying the actual scoring rules, is
    lib/scoreMessages.js's job, not this script's.
    """
    connection = open_safe_connection()
    try:
        rows = connection.execute(
            """
            SELECT m.guid,
                   m.is_from_me,
                   h.id as handle,
                   m.text,
                   m.attributedBody,
                   m.date,
                   m.associated_message_guid,
                   m.associated_message_type,
                   m.associated_message_emoji,
                   m.thread_originator_guid
            FROM message m
            JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
            LEFT JOIN handle h ON h.ROWID = m.handle_id
            WHERE cmj.chat_id = ?
            ORDER BY m.date
            """,
            (chat_id,),
        ).fetchall()
    finally:
        connection.close()

    messages = []
    for row in rows:
        (
            guid,
            is_from_me,
            handle,
            text_column,
            attributed_body_column,
            date,
            associated_message_guid,
            associated_message_type,
            associated_message_emoji,
            thread_originator_guid,
        ) = row

        sender = "Me" if is_from_me else (handle or "Unknown")

        messages.append(
            {
                "guid": guid,
                "sender": sender,
                "text": get_message_text(text_column, attributed_body_column),
                "timestamp": apple_timestamp_to_unix_seconds(date),
                "associatedMessageGuid": associated_message_guid,
                "associatedMessageType": associated_message_type,
                "associatedMessageEmoji": associated_message_emoji,
                "threadOriginatorGuid": thread_originator_guid,
            }
        )

    return messages


# ---------------------------------------------------------------------------
# Part 5: command line entry point
# ---------------------------------------------------------------------------

def print_json(data):
    """Prints data as JSON on its own line. This is the format lib/runChatReader.js reads back."""
    print(json.dumps(data))


def read_and_print_chat(chat_id):
    """Reads one chat's name and messages, and prints them together as one JSON object."""
    result = {
        "chatId": chat_id,
        "chatName": get_chat_name(chat_id),
        "messages": read_raw_messages(chat_id),
    }
    print_json(result)


def run_interactive_picker():
    """
    Prints every group chat with a number next to it, asks you to type a
    number, and then reads that chat.

    Only used when you run this file directly with no flags. The web app
    never uses this: it already knows which chatId it wants, so it
    always calls this script with --chat-id instead of typing into a
    prompt.
    """
    chats = list_group_chats()
    for index, chat in enumerate(chats, start=1):
        # Printed to stderr, not stdout, on purpose: stdout is reserved
        # for the final JSON result, so anything else has to go
        # elsewhere, or a program reading our output later would get
        # confused by extra text mixed into the JSON.
        print(f"{index}. {chat['name']} (chatId {chat['chatId']}, {chat['messageCount']} messages)", file=sys.stderr)

    choice = input("Type a number and press enter: ")
    chosen_chat = chats[int(choice) - 1]
    read_and_print_chat(chosen_chat["chatId"])


def main():
    args = sys.argv[1:]

    if "--list" in args:
        print_json(list_group_chats())
        return

    if "--chat-id" in args:
        chat_id = int(args[args.index("--chat-id") + 1])
        read_and_print_chat(chat_id)
        return

    run_interactive_picker()


if __name__ == "__main__":
    main()
