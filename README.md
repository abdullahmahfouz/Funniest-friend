# Funniest Friend

Who's actually the funniest person in your group chat? Not by vibes  by counting every ❤️😂👍 tapback, threaded reply, and reaction-y "💀" text your friends have actually sent, straight from your Mac's iMessage history.

Funniest Friend reads your local `chat.db`, deterministically scores every sender on a laugh score, then asks Gemini to pick each person's single funniest message and write a one-line roast to go with it. The result is a leaderboard dashboard you can share with the group.

## Features

- Deterministic laugh scoring from real tapback reactions (❤️👍👎😂‼️❓ + any custom emoji), threaded replies, and reaction-y typed replies like "💀" or "haha" — no AI involved in the ranking itself
- Gemini picks each person's single funniest quoted message and writes a short, personalized reason
- Leaderboard dashboard with Pokémon avatars, tapback badges, and per-person stats
- Reads chats straight from your Mac's local iMessage database — no exporting, no third-party access to your messages
- Deployable as a shareable, password-protected static site while your real chat data and Gemini key never leave your laptop

## How it works

1. **Read** — a Python helper (`scripts/read_imessage_db.py`) copies your Mac's `~/Library/Messages/chat.db` and pulls out every message, tapback, and reply in a chat.
2. **Score** — `lib/scoreMessages.js` turns that raw data into an exact, deterministic "laugh score" per person from tapbacks (❤️👍👎😂‼️❓ + custom emoji), threaded replies, and short reaction-y typed replies. No AI involved — same input always gives the same score.
3. **Narrate** — `lib/analyzeWithGemini.js` sends the scored data to Gemini, which picks each person's funniest quoted message and writes a short reason. Gemini never touches the ranking itself.
4. **Display** — the dashboard (`app/page.js`) reads the saved result and renders a leaderboard with Pokémon avatars, tapback badges, and each person's top line.

Only you can run the analysis, and only from your own laptop: the `/api/analyze` route reads a file that only exists on your Mac, so it silently fails on the deployed site by design. Anyone visiting the live URL only ever sees the static result you generated locally — see [Privacy & deployment](#privacy--deployment).

## Installation

Requirements:

- Node.js and npm
- Python 3 (for decoding iMessage's binary message format)
- A Mac with Messages set up in iMessage, and a [Google Gemini API key](https://ai.google.dev/)
- Full Disk Access granted to your terminal app (System Settings → Privacy & Security → Full Disk Access) — required to read `chat.db`

```bash
# 1. Install JS dependencies
npm install

# 2. Set up the Python environment (decodes iMessage's binary message format)
#    --copies matters here -- see requirements.txt for why (avoids a Turbopack
#    build crash on a symlink that escapes the project directory)
python3 -m venv --copies .venv
.venv/bin/pip install -r requirements.txt

# 3. Add your friends' names and avatars (never committed — see .gitignore)
cp lib/contactNames.example.js lib/contactNames.js
# then edit lib/contactNames.js with real names/Pokémon per sender

# 4. Add your secrets — create .env.local with the three variables
#    described in Configuration below (GEMINI_API_KEY, ANALYZE_SECRET, SITE_PASSWORD)

# 5. Run the app
npm run dev
```

## Quickstart

With the dev server running:

```bash
# List your group chats and find the one you want (copy its chatId)
curl "http://localhost:3000/api/analyze?secret=YOUR_ANALYZE_SECRET"

# Run the full pipeline for that chat — writes public/stats.json
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"chatId": 660, "secret": "YOUR_ANALYZE_SECRET"}'
```

Open [http://localhost:3000](http://localhost:3000) to see the leaderboard. Until you run the analysis, the dashboard shows sample data with a banner explaining how to generate your own.

## Configuration

Set these in `.env.local` (never committed — see `.gitignore`):

| Variable | Used for |
| --- | --- |
| `GEMINI_API_KEY` | Calls to Gemini for picking top messages and writing reasons |
| `ANALYZE_SECRET` | A password you make up, required to hit `/api/analyze` so nobody else can trigger it or spend your Gemini credit |
| `SITE_PASSWORD` | The password protecting the whole deployed site, since it shows real names and messages. Visitors enter it once on `/login` ([proxy.js](proxy.js)) |

`lib/contactNames.js` (copied from `lib/contactNames.example.js`) maps raw iMessage sender identifiers (phone numbers, emails, `"Me"`) to a friendly display name and a Pokémon avatar from `lib/pokemonAvatars.js`. Anyone not listed still shows up, just with their raw phone number/email and no avatar.

## Privacy & deployment

Real message data never touches git:

- `public/stats.json` (the analysis output) and `lib/contactNames.js` (real names) are both gitignored.
- `public/stats.json` **is** deployed to Vercel directly from your laptop via `vercel deploy` (see `.vercelignore`), since that's the one file the live dashboard needs — it just never goes through git.
- The live site is behind a password (`SITE_PASSWORD`) so only people you share it with can view it. Anyone without a valid session cookie gets sent to `/login`, and the cookie lasts 30 days. It's a normal form rather than the browser's built-in Basic Auth prompt because in-app browsers -- a link tapped inside Messages or Instagram -- often never show that prompt, leaving friends stuck on a blank page.
- `/api/analyze` reads a file that only exists on your machine, so running it against the deployed URL always fails — the deployed app can only ever serve the static snapshot you generated locally.

## Development

```bash
npm run dev    # start the dev server
npm run build  # production build
npm run start  # run the production build
```

Re-run the analyze pipeline (steps 5 above) any time you want to refresh the leaderboard with newer messages.

## Contributing

This is a personal project built for one friend group's chat, not a general-purpose tool — there's no public contribution workflow. If you fork it for your own group chat, the pieces you'll likely want to adjust are `lib/scoreMessages.js` (scoring rules) and `lib/pokemonAvatars.js` (avatar options).

## License

ISC
