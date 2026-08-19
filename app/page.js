// Dashboard page. Reads public/stats.json (written by POST /api/analyze)
// and ranks everyone by laughs, the combined score lib/scoreMessages.js
// computes from tapbacks, threaded replies, and reaction-y typed replies.
// Gemini never touches that score -- it only picks each person's
// topMessage (their funniest line) and writes the reason.

import { Crown, Sparkles } from "lucide-react";
import stats from "../public/stats.json";
import { formatScore } from "./formatScore";
import LeaderboardRow from "./LeaderboardRow";
import ReactionChips from "./ReactionChips";
import PokemonAvatar from "./PokemonAvatar";
import LoadingScreen from "./LoadingScreen";
import RevealOnScroll from "./RevealOnScroll";

export default function HomePage() {
  // laughs is the deterministic score from lib/scoreMessages.js -- Gemini
  // has no say in the ranking, only in topMessage and reason.
  const rankedPeople = [...stats.people].sort((a, b) => b.laughs - a.laughs);
  const [winner, ...rest] = rankedPeople;
  // Bars are sized relative to the winner's score, since laughs has no
  // fixed max the way a 0-100 score would.
  const maxLaughs = Math.max(winner ? winner.laughs : 0, 1);

  // The placeholder public/stats.json checked into this repo leaves
  // generatedAt null; a real analysis run always stamps it. Cheapest
  // reliable way to tell sample data from your actual group chat.
  const isSampleData = !stats.generatedAt;

  return (
    <>
      <LoadingScreen roster={stats.people} />
      <main className="relative mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
        {isSampleData && (
          <div className="glass-shell mb-10">
            <p
              className="glass-core px-4 py-3 text-sm"
              style={{ color: "var(--ink-secondary)" }}
            >
              You&rsquo;re looking at sample data. Run <code className="font-mono">npm run dev</code>, hit{" "}
              <code className="font-mono">GET /api/analyze?secret=...</code> to find your chatId, then{" "}
              <code className="font-mono">POST /api/analyze</code> with it to replace this with your real chat.
            </p>
          </div>
        )}

        <header className="mb-14">
          <span className="eyebrow mb-5">
            <Sparkles size={12} strokeWidth={1.5} />
            Group chat superlative
          </span>
          <h1 className="font-display max-w-xl text-4xl leading-[1.05] font-extrabold sm:text-6xl">
            Who&rsquo;s the funniest in the group chat?
          </h1>
          <p className="font-mono mt-5 text-sm" style={{ color: "var(--ink-secondary)" }}>
            {isSampleData ? "Sample data" : stats.chatName} &middot; {stats.totalMessages} messages analyzed
            {stats.generatedAt && ` · ranked ${new Date(stats.generatedAt).toLocaleDateString()}`}
          </p>
        </header>

        {winner && (
          <RevealOnScroll className="mb-10 block">
            <section className="glass-shell glass-shell--gold relative">
              <div className="glass-core relative overflow-hidden px-5 py-6 sm:px-7 sm:py-8">
                <div
                  className="tapback-badge absolute top-5 right-5 flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold"
                  style={{ backgroundColor: "var(--gold)", color: "#1a1200" }}
                >
                  😂 {winner.reactions.laughed}
                </div>

                {/* Identity block spans the wide column; the two stat
                    tiles stack beside it on sm+ and fall into normal
                    flow on mobile. */}
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-12 sm:items-start">
                  <div className="min-w-0 sm:col-span-8">
                    <div className="flex items-center gap-4">
                      <PokemonAvatar imageUrl={winner.pokemonImageUrl} pokemonName={winner.pokemonName} size={72} />
                      <div className="min-w-0">
                        <p className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--gold)" }}>
                          <Crown size={16} strokeWidth={1.5} />
                          #1 &middot; Funniest Friend
                        </p>
                        <h2 className="font-display max-w-full truncate text-3xl font-bold sm:text-4xl">{winner.name}</h2>
                      </div>
                    </div>

                    {winner.topMessage && (
                      <p className="mt-4 text-base italic" style={{ color: "var(--ink)" }}>
                        &ldquo;{winner.topMessage}&rdquo;
                      </p>
                    )}
                    {winner.reason && (
                      <p className="mt-2 text-sm" style={{ color: "var(--ink-secondary)" }}>
                        {winner.reason}
                      </p>
                    )}

                    <div className="mt-5">
                      <ReactionChips reactions={winner.reactions} size="lg" />
                    </div>
                  </div>

                  <div className="flex gap-3 sm:col-span-4 sm:flex-col">
                    <div className="stat-tile flex-1">
                      <p className="font-mono text-3xl font-semibold" style={{ color: "var(--ink)" }}>
                        {formatScore(winner.laughs)}
                      </p>
                      <p className="mt-1 text-[10px] tracking-widest uppercase" style={{ color: "var(--ink-muted)" }}>
                        Laugh score
                      </p>
                    </div>
                    <div className="stat-tile flex-1">
                      <p className="font-mono text-3xl font-semibold" style={{ color: "var(--ink)" }}>
                        {winner.messagesSent}
                      </p>
                      <p className="mt-1 text-[10px] tracking-widest uppercase" style={{ color: "var(--ink-muted)" }}>
                        Messages sent
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </RevealOnScroll>
        )}

        {rest.length > 0 && (
          <ol className="flex flex-col gap-4">
            {rest.map((person, index) => (
              <LeaderboardRow key={person.name} person={person} rank={index + 2} maxLaughs={maxLaughs} />
            ))}
          </ol>
        )}

        <p className="mt-16 text-center text-xs tracking-wide" style={{ color: "var(--ink-muted)" }}>
          Nobody&rsquo;s feelings were consulted.
        </p>
      </main>
    </>
  );
}
