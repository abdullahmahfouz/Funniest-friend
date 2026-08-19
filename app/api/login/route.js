// Handles the login form's submission. proxy.js sends anyone without a
// valid cookie to /login; this is where that page's form posts to.
//
// It's a plain form POST rather than a fetch() from the browser, because
// the whole point of moving off Basic Auth was to work in the stripped-
// down in-app browsers people tap links from. A form post needs no
// JavaScript at all, so there's nothing left to fail.

import { NextResponse } from "next/server";
import { COOKIE_NAME, COOKIE_MAX_AGE, sessionToken } from "../../../lib/sitePassword";

/**
 * Where to send someone once they're through the gate.
 *
 * proxy.js puts the page they originally wanted in ?next=, and that value
 * arrives back here having passed through the user's browser -- so it's
 * treated as untrusted. Only same-site paths are allowed through: without
 * this check, someone could mail out a /login?next=https://evil.example
 * link and use this app's domain to bounce people somewhere hostile.
 */
function safeRedirectPath(next) {
  if (typeof next !== "string") return "/";
  // Must be a path on this site: starts with a single "/". A value
  // starting with "//" is protocol-relative, which browsers read as a
  // different domain entirely.
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export async function POST(request) {
  const form = await request.formData();
  const password = form.get("password");
  const next = safeRedirectPath(form.get("next"));

  if (!process.env.SITE_PASSWORD || password !== process.env.SITE_PASSWORD) {
    // Back to the form with ?error, keeping ?next so a wrong first guess
    // doesn't cost them the page they were trying to reach.
    const retryUrl = new URL("/login", request.url);
    retryUrl.searchParams.set("error", "1");
    retryUrl.searchParams.set("next", next);
    return NextResponse.redirect(retryUrl, 303);
  }

  // 303 specifically: it tells the browser to follow the redirect with a
  // fresh GET. The default redirect status would preserve the method and
  // re-POST this form to the homepage.
  const response = NextResponse.redirect(new URL(next, request.url), 303);

  response.cookies.set(COOKIE_NAME, await sessionToken(), {
    // Not readable by page JavaScript -- it's only ever checked on the
    // server, in proxy.js, so scripts have no reason to touch it.
    httpOnly: true,
    // HTTPS only in production. Left off locally, where dev runs on plain
    // http and a secure cookie would simply never be stored.
    secure: process.env.NODE_ENV === "production",
    // Still sent when someone arrives by tapping the link in a chat app,
    // which "strict" would block -- they'd land back on the login form
    // despite already having signed in.
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

  return response;
}
