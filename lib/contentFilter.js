// Safety backstop for the "topMessage" highlight shown on the dashboard.
// Someone's message might score highest by reactions, but it should
// never reach Gemini as a candidate -- let alone show up on the site --
// if it contains a racial slur or similar severe hate speech.
//
// Intentionally a short, narrow list of unambiguous, severe terms, not a
// general profanity filter -- normal swearing, roasting, and "gets a bit
// much" jokes are exactly what this app is for. This only catches the
// handful of terms that are never okay to surface as a public highlight,
// no matter how many laugh reactions they got.
//
// Not the only safeguard: a racist "joke" can easily avoid every word on
// this list (stereotypes, coded language) while still being hateful.
// That's why lib/analyzeWithGemini.js separately instructs Gemini to
// skip anything racist or discriminatory when it picks a topMessage.
// Two independent layers -- this one is a hard guarantee for the worst,
// most obvious cases; that one is a judgment call for everything
// subtler.
//
// \b is a word boundary, so each pattern matches the word on its own
// ("word" or "Word!") but not inside an unrelated longer word; "i" makes
// it case-insensitive.
const BLOCKED_TERM_PATTERNS = [
  /\bn[i1]gg?(?:er|a)s?\b/i,
  /\bch[i1]nks?\b/i,
  /\bsp[i1]cs?\b/i,
  /\bk[i1]kes?\b/i,
  /\bf[a4]ggots?\b/i,
  /\bretards?\b/i,
  /\btrann(?:y|ies)\b/i,
  /\bwetbacks?\b/i,
];

// True if the given text contains any of the blocked terms above.
export function containsBlockedTerm(text) {
  return BLOCKED_TERM_PATTERNS.some((pattern) => pattern.test(text));
}
