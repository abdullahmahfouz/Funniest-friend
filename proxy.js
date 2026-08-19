// Next.js calls this feature "Proxy" -- it runs before every page and
// route in this app, and can block a request before it ever reaches
// app/page.js or an API route. Used here to put a password on the whole
// site: without it, anyone who finds the URL (not just your friends)
// could see everyone's real names and messages.
//
// Uses HTTP Basic Auth, which is built into every web browser, so
// there's no login page to build. When the browser gets a response with
// a "WWW-Authenticate" header (sent below), it automatically pops up its
// own built-in username/password box. Whatever someone types comes back
// on the next request inside an "Authorization" header, which this file
// checks.

// Shown in the browser's password prompt. It doesn't need to be secret --
// the actual password (SITE_PASSWORD) is the only thing that matters, and
// that lives in .env.local, never in this file.
const SITE_USERNAME = "friend";

function requestHasCorrectPassword(request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return false;
  }

  // The browser sends "Basic <base64 of username:password>"; atob()
  // decodes that back into a normal string.
  const base64Credentials = authHeader.replace("Basic ", "");
  const [username, password] = atob(base64Credentials).split(":");

  return username === SITE_USERNAME && password === process.env.SITE_PASSWORD;
}

export function proxy(request) {
  if (!process.env.SITE_PASSWORD) {
    // No password set up yet -- let requests through instead of silently
    // locking everyone out. See .env.local for how to set SITE_PASSWORD,
    // and add it in Vercel's project settings too, so the live site is
    // protected and not just the local dev server.
    return;
  }

  if (requestHasCorrectPassword(request)) {
    return; // returning nothing here lets the request continue as normal
  }

  // Sending exactly this response and header is what makes the browser
  // pop up its built-in username/password box.
  return new Response("Password required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Funniest Friend"' },
  });
}

// Runs the password check on every page and route EXCEPT Next.js's own
// internal files and static assets (like favicon.ico) -- there's nothing
// private in those, and skipping them keeps the site feeling fast.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
