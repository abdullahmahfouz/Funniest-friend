// One leaderboard row -- everyone except the #1 winner, who gets the
// bigger card in page.js. Doubles as its own bar chart: the meter's fill
// width is person.laughs relative to maxLaughs (the winner's score), so
// you can compare two people's bars by eye without a separate chart
// component.
import ReactionChips from "./ReactionChips";
import PokemonAvatar from "./PokemonAvatar";
import RevealOnScroll from "./RevealOnScroll";
import { formatScore } from "./formatScore";

export default function LeaderboardRow({ person, rank, maxLaughs }) {
  const meterWidthPercent = Math.min(100, (person.laughs / maxLaughs) * 100);

  return (
    <li>
      <RevealOnScroll delayMs={Math.min(rank * 40, 360)}>
        <div className="glass-shell group transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5">
          <div className="glass-core flex items-start gap-4 px-4 py-4 sm:px-5">
            <span
              className="font-mono pt-0.5 text-sm"
              style={{ color: "var(--ink-muted)" }}
              aria-hidden="true"
            >
              {String(rank).padStart(2, "0")}
            </span>

            <PokemonAvatar imageUrl={person.pokemonImageUrl} pokemonName={person.pokemonName} size={40} />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="truncate text-lg font-semibold">{person.name}</h3>
                <span className="font-mono text-sm" style={{ color: "var(--ink-secondary)" }}>
                  {person.messagesSent} sent
                </span>
              </div>

              {/* The score meter. Track is a fixed 100%-wide bar in a faint
                  glass tint; the fill is a violet-to-gold gradient sweep,
                  sized relative to the winner's score. */}
              <div className="mt-3 flex items-center gap-3">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full"
                  style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
                  role="meter"
                  aria-valuenow={person.laughs}
                  aria-valuemin={0}
                  aria-valuemax={maxLaughs}
                  aria-label={`${person.name}'s laugh score`}
                >
                  <div
                    className="meter-fill h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]"
                    style={{ width: `${meterWidthPercent}%` }}
                  />
                </div>
                <span className="font-mono w-14 shrink-0 text-right text-sm" style={{ color: "var(--ink)" }}>
                  {formatScore(person.laughs)}
                </span>
              </div>

              <div className="mt-3">
                <ReactionChips reactions={person.reactions} size="sm" />
              </div>
            </div>
          </div>
        </div>
      </RevealOnScroll>
    </li>
  );
}
