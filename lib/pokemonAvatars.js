// Turns a Pokemon name into a real picture of that Pokemon, pulled from
// PokeAPI's public sprite repository (official box artwork). Add a line
// here any time lib/contactNames.js assigns someone a new Pokemon.
const POKEDEX_ID = {
  Squirtle: 7,
  Charizard: 6,
  Snorlax: 143,
  Lucario: 448,
  Machamp: 68,
};

function officialArtworkUrl(pokedexId) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokedexId}.png`;
}

// Returns the artwork URL for a Pokemon name, or null if we don't have an
// ID on file for it yet.
export function getPokemonImageUrl(pokemonName) {
  const pokedexId = POKEDEX_ID[pokemonName];
  return pokedexId ? officialArtworkUrl(pokedexId) : null;
}
