// Renders the six tapback counts (loved/liked/disliked/laughed/emphasized/
// questioned) as icon+number chips. Zero-count reactions are dimmed, not
// hidden, so the row's shape stays consistent -- easier to compare two
// people at a glance when "no dislikes" is a dim icon in the same spot
// instead of a gap.
//
// "laughed" is the reaction this whole app is about, so it's the only one
// with the gold accent; everything else stays neutral ink-secondary.
// Color marks the signal here, not the reaction type, so it doesn't need
// a six-color categorical palette.
import { REACTION_ICONS } from "./reactionIcons";

export default function ReactionChips({ reactions, size = "sm" }) {
  const iconSize = size === "lg" ? 16 : 13;
  const textSize = size === "lg" ? "text-sm" : "text-xs";

  return (
    <div className={`flex flex-wrap items-center gap-2 font-mono ${textSize}`}>
      {REACTION_ICONS.map(({ key, label, Icon }) => {
        const count = reactions[key] || 0;
        const isLaughed = key === "laughed";
        return (
          <span
            key={key}
            title={`${label}: ${count}`}
            className="flex items-center gap-1 rounded-full border px-2 py-1 transition-colors duration-300"
            style={{
              borderColor: isLaughed && count > 0 ? "var(--border-gold)" : "var(--glass-border)",
              backgroundColor: isLaughed && count > 0 ? "var(--gold-soft)" : "transparent",
              color: count === 0 ? "var(--ink-muted)" : isLaughed ? "var(--gold)" : "var(--ink-secondary)",
              opacity: count === 0 ? 0.45 : 1,
            }}
          >
            <Icon size={iconSize} strokeWidth={1.5} />
            {count}
          </span>
        );
      })}
    </div>
  );
}
