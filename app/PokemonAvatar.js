// Circular Pokemon portrait next to a person's name. Plain <img>, not
// next/image -- these come from an external host and there are only ever
// a handful on the whole page, so the remote-image config isn't worth it.
//
// Double-ring bezel: a padded outer ring (like a watch case) around the
// portrait, so the avatar reads as a small object rather than a flat
// circle glued onto the background.
export default function PokemonAvatar({ imageUrl, pokemonName, size = 48 }) {
  if (!imageUrl) return null;

  const ringSize = size + 6;

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: ringSize,
        height: ringSize,
        border: "1px solid var(--glass-border-strong)",
        background: "var(--glass)",
      }}
    >
      <img
        src={imageUrl}
        alt={pokemonName ? `${pokemonName} avatar` : ""}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{
          width: size,
          height: size,
          backgroundColor: "rgba(0,0,0,0.3)",
          boxShadow: "inset 0 1px 1px rgba(255,255,255,0.15)",
        }}
      />
    </div>
  );
}
