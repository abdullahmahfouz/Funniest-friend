// Shared pieces of the site password gate, used by both halves of it:
// proxy.js (which decides whether a request gets in) and
// app/api/login/route.js (which hands out the pass in the first place).
//
// The gate used to be HTTP Basic Auth, which had one fatal flaw for a link
// you paste into a group chat: the password box is drawn by the browser
// itself, and in-app browsers (a link tapped inside Messages or Instagram)
// often never draw it. Friends just saw a blank "Password required." page
// with nothing to type into. A normal HTML form and a cookie work
// everywhere, so that's what this is.

export const COOKIE_NAME = "ff_session";

// 30 days, in seconds. Long enough that nobody has to re-enter the
// password every time they reopen the link to argue about the rankings.
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

// Mixed into the hash below so the cookie value is specific to this app --
// if the same password gets reused somewhere else, the two sites still
// don't end up with an interchangeable cookie.
const TOKEN_SALT = "funniest-friend/site-password/v1";

/**
 * The value stored in the session cookie: a SHA-256 hash of SITE_PASSWORD.
 *
 * Hashing rather than storing the password itself means the cookie sitting
 * on someone's phone isn't a readable copy of the password, and a cookie
 * stops working the moment you change SITE_PASSWORD. It's derived rather
 * than random because that keeps the whole gate stateless -- there's no
 * session list to store anywhere, and proxy.js can validate a cookie by
 * just recomputing this and comparing.
 */
export async function sessionToken() {
  const source = new TextEncoder().encode(`${TOKEN_SALT}:${process.env.SITE_PASSWORD}`);
  const digest = await crypto.subtle.digest("SHA-256", source);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
