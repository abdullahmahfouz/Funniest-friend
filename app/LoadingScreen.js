"use client";

import { useEffect, useState } from "react";

// One-time intro shown on load: each person's Pokemon pops in, then the
// overlay fades out to reveal the real leaderboard. Purely for delight --
// the data is already loaded when this mounts, nothing is actually being
// waited on. Has to be a Client Component (timers, state) even though the
// rest of app/page.js stays a plain Server Component.
const REVEAL_STEP_MS = 220; // how long between each Pokemon popping in
const HOLD_MS = 500; // how long the full roster stays on screen before fading
const FADE_MS = 450; // how long the fade-out itself takes

export default function LoadingScreen({ roster }) {
  const [revealedCount, setRevealedCount] = useState(0);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    // Respect "reduce motion": skip the whole sequence and show the real
    // page immediately instead of animating anything.
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion || roster.length === 0) {
      setIsDone(true);
      return;
    }

    const revealTimers = roster.map((_, index) =>
      setTimeout(() => setRevealedCount(index + 1), index * REVEAL_STEP_MS)
    );
    const totalRevealTime = roster.length * REVEAL_STEP_MS;
    const fadeStartTimer = setTimeout(() => setIsFadingOut(true), totalRevealTime + HOLD_MS);
    const doneTimer = setTimeout(() => setIsDone(true), totalRevealTime + HOLD_MS + FADE_MS);

    return () => {
      revealTimers.forEach(clearTimeout);
      clearTimeout(fadeStartTimer);
      clearTimeout(doneTimer);
    };
  }, [roster]);

  if (isDone) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 px-6 transition-opacity"
      style={{
        backgroundColor: "var(--bg)",
        opacity: isFadingOut ? 0 : 1,
        transitionDuration: `${FADE_MS}ms`,
      }}
      aria-hidden="true"
    >
      <div className="flex flex-wrap items-end justify-center gap-5">
        {roster.map((person, index) => (
          <div
            key={person.name}
            className="flex flex-col items-center gap-2 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
            style={{
              opacity: index < revealedCount ? 1 : 0,
              transform: index < revealedCount ? "translateY(0) scale(1)" : "translateY(14px) scale(0.82)",
            }}
          >
            {person.pokemonImageUrl && (
              <div
                className="flex h-[70px] w-[70px] items-center justify-center rounded-full"
                style={{ border: "1px solid var(--border-gold)", background: "var(--glass)" }}
              >
                <img
                  src={person.pokemonImageUrl}
                  alt=""
                  width={64}
                  height={64}
                  className="h-16 w-16 rounded-full object-cover"
                  style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
                />
              </div>
            )}
            <span className="font-mono text-xs" style={{ color: "var(--ink-secondary)" }}>
              {person.name}
            </span>
          </div>
        ))}
      </div>
      <p className="font-display text-lg font-semibold" style={{ color: "var(--ink)" }}>
        Rounding up the group chat
      </p>
    </div>
  );
}
