// The password screen. proxy.js redirects here whenever someone without a
// valid session cookie asks for any page on the site.
//
// Deliberately a Server Component with a plain <form> and no client
// JavaScript: this page's entire job is to be the thing that still works
// in the barest in-app browser, since that's where friends will open the
// link from. It posts to app/api/login/route.js, which sets the cookie.

import { Lock } from "lucide-react";

export const metadata = {
  title: "Funniest Friend · Password",
};

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  // Set by app/api/login/route.js when a submitted password didn't match.
  const hasError = params.error === "1";
  // The page they were originally after, handed back to the route handler
  // so it can drop them there instead of on the homepage. It gets
  // re-validated there -- never trust a value that round-tripped through
  // the browser.
  const next = typeof params.next === "string" ? params.next : "/";

  return (
    <main className="relative mx-auto flex min-h-screen max-w-md items-center px-4 py-16 sm:px-6">
      <div className="glass-shell w-full">
        <div className="glass-core px-6 py-8 sm:px-8 sm:py-10">
          <div
            className="mb-6 flex h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--accent-soft)", color: "var(--accent)" }}
          >
            <Lock size={18} strokeWidth={1.5} />
          </div>

          <h1 className="font-display text-2xl leading-tight font-extrabold sm:text-3xl">
            This one&rsquo;s private.
          </h1>
          <p className="mt-3 text-sm" style={{ color: "var(--ink-secondary)" }}>
            The leaderboard quotes real messages, so it&rsquo;s behind a password. Ask whoever
            sent you the link.
          </p>

          <form method="POST" action="/api/login" className="mt-7">
            <input type="hidden" name="next" value={next} />

            <label
              htmlFor="password"
              className="mb-2 block text-[10px] tracking-widest uppercase"
              style={{ color: "var(--ink-muted)" }}
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              // iOS Safari zooms the whole page in on focus for any input
              // under 16px, and never zooms back out. text-base is 16px.
              className="w-full rounded-xl px-4 py-3 text-base outline-none"
              style={{
                backgroundColor: "rgba(0, 0, 0, 0.25)",
                border: "1px solid var(--glass-border)",
                color: "var(--ink)",
              }}
            />

            {hasError && (
              <p className="mt-3 text-sm" style={{ color: "var(--gold)" }}>
                That&rsquo;s not it. Try again.
              </p>
            )}

            <button
              type="submit"
              className="mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--accent)", color: "#0b0714" }}
            >
              See the rankings
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
