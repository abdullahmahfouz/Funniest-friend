// Next.js configuration. We don't need any special settings right now:
// better-sqlite3 (used by lib/readImessageDb.js) is already on Next.js's
// built-in list of packages it knows not to bundle, so no extra config is
// needed to make that work.
/** @type {import('next').NextConfig} */
const nextConfig = {};

module.exports = nextConfig;
