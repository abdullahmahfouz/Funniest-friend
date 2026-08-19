// chat.db reading happens in a separate Python process (see
// lib/runChatReader.js), which locates its interpreter via
// .venv/bin/python. .venv must be created with `python3 -m venv --copies`
// (not the default symlinked venv) -- a symlinked .venv/bin/python chains
// out to Homebrew's Cellar, and Turbopack's build-time module graph
// crashes trying to follow a symlink that escapes the project root
// (`next build` fails with "Symlink [project]/.venv/bin/python is
// invalid, it points out of the filesystem root").
//
// .venv is also local-only -- gitignored and vercelignored, since
// /api/analyze never runs on Vercel -- so it's excluded here from output
// file tracing too, to keep it out of any deployment bundle.
/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingExcludes: {
    "/api/analyze": ["./.venv/**/*"],
  },
};

module.exports = nextConfig;
