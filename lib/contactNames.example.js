// TEMPLATE FILE -- copy this to lib/contactNames.js and fill in your own
// friends' info there. lib/contactNames.js is gitignored so real phone
// numbers, emails, names, and Pokemon avatars never get committed to
// this repo -- same reason public/stats.json is gitignored too. This
// example file has no real data in it, so it's safe to commit.
//
//   cp lib/contactNames.example.js lib/contactNames.js
//
// Maps raw iMessage sender identifiers (phone numbers, emails, or "Me")
// to the friendly name and Pokemon avatar shown on the dashboard. Add a
// line here whenever someone new shows up in a chat you analyze --
// otherwise they show up as their raw phone number or email, with no
// avatar.
//
// "pokemon" must be one of the names in lib/pokemonAvatars.js, which
// turns a Pokemon name into an actual image.
const CONTACTS = {
  // "+15551234567": { name: "Alex", pokemon: "Pikachu" },
  // Me: { name: "Your Name", pokemon: "Charizard" },
};

// Looks up a friendly name for a raw sender identifier, falling back to
// the raw identifier itself if we don't have a name yet, so a new person
// in the chat still shows up instead of silently disappearing.
export function getDisplayName(rawSender) {
  const contact = CONTACTS[rawSender];
  return contact ? contact.name : rawSender;
}

// Looks up the Pokemon name assigned to a raw sender identifier, or null
// if we haven't picked one for them yet.
export function getPokemonName(rawSender) {
  const contact = CONTACTS[rawSender];
  return contact ? contact.pokemon : null;
}
