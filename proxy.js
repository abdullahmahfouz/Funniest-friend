// Next.js calls this feature "Proxy" -- it runs before every page and
// route in this app, and can block a request before it ever reaches
// app/page.js or an API route. Used here to put a password on the whole
// site: without it, anyone who finds the URL (not just your friends)
// could see everyone's real names and messages.
//
// Anyone without a valid session cookie gets sent to /login, which is a
// normal page with a normal form (see app/login/page.js). Submitting it
// hits app/api/login/route.js, which checks the password and sets the
// cookie this file looks for. See lib/sitePassword.js for why it's a form
// and a cookie rather than the browser's built-in Basic Auth box.

import { NextResponse } from "next/server";
import { COOKIE_NAME, sessionToken } from "./lib/sitePassword";

// Paths the gate deliberately doesn't cover:
//
// /login and /api/login are how someone gets past the gate, so gating
// them would leave no way in -- a locked door with the key inside.
//
// /api/analyze isn't a page anyone browses to; it's the pipeline you
// trigger from your own terminal, and it already has its own password in
// ANALYZE_SECRET. Leaving it out means the documented curl commands in
// the README work as written, without also having to carry a cookie.
const UNGATED_PATHS = ["/login", "/api/login", "/api/analyze"];

export async function proxy(request) {
  if (!process.env.SITE_PASSWORD) {
    // No password set up yet -- let requests through instead of silently
    // locking everyone out. See .env.local for how to set SITE_PASSWORD,
    // and add it in Vercel's project settings too, so the live site is
    // protected and not just the local dev server.
    return;
  }

  const { pathname } = request.nextUrl;

  if (UNGATED_PATHS.includes(pathname)) {
    return; // returning nothing here lets the request continue as normal
  }

  const session = request.cookies.get(COOKIE_NAME);
  if (session && session.value === (await sessionToken())) {
    return;
  }

  // Remember where they were headed so the login form can send them back
  // there afterwards, instead of always dumping everyone on the homepage.
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);

  return NextResponse.redirect(loginUrl);
}

// Runs the password check on every page and route EXCEPT Next.js's own
// internal files and static assets (like favicon.ico) -- there's nothing
// private in those, and skipping them keeps the site feeling fast.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
