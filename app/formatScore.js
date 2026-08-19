// Rounds a score for display: whole numbers show as-is; anything with a
// .5 (from an anchor-based proximity reply, worth half a point) shows
// one decimal place.
export function formatScore(score) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}
