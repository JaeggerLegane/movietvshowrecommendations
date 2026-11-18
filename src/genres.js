// One genre list for movies and TV. TMDB uses different genres for both (TV has no "Horror",
// and combines "Sci-Fi & Fantasy"), so the app maps both onto this list, helped by keywords.

// fav: how much you like it (your favourites: horror, detective, mafia/drugs, war, sci-fi).
const GENRES = [
  { id: 'horror', name: 'Horror', movie: [27], tv: [], fav: 1 },
  { id: 'detective', name: 'Detective', theme: true, fav: 0.9 },
  { id: 'mafia', name: 'Mafia & drugs', theme: true, fav: 1 },
  { id: 'war', name: 'War', movie: [10752], tv: [10768], fav: 0.9 },
  { id: 'scifi', name: 'Sci-Fi', movie: [878], tv: [], fav: 0.9 },
  { id: 'crime', name: 'Crime', movie: [80], tv: [80], fav: 0.35 },
  { id: 'thriller', name: 'Thriller', movie: [53], tv: [], fav: 0.3 },
  { id: 'mystery', name: 'Mystery', movie: [9648], tv: [9648], fav: 0.3 },
  { id: 'action', name: 'Action', movie: [28], tv: [10759] },
  { id: 'drama', name: 'Drama', movie: [18], tv: [18] },
  { id: 'fantasy', name: 'Fantasy', movie: [14], tv: [] },
  { id: 'adventure', name: 'Adventure', movie: [12], tv: [10759] },
  { id: 'comedy', name: 'Comedy', movie: [35], tv: [35] },
  { id: 'history', name: 'History', movie: [36], tv: [] },
  { id: 'animation', name: 'Animation', movie: [16], tv: [16] },
  { id: 'documentary', name: 'Documentary', movie: [99], tv: [99] },
  { id: 'romance', name: 'Romance', movie: [10749], tv: [] },
  { id: 'family', name: 'Family', movie: [10751], tv: [10751] },
  { id: 'western', name: 'Western', movie: [37], tv: [37] },
  { id: 'music', name: 'Music', movie: [10402], tv: [] },
];
const byId = new Map(GENRES.map((g) => [g.id, g]));

// TV genres that are never recommended: News, Reality, Soap, Talk, Kids.
const SKIP_TV_GENRES = new Set([10763, 10764, 10766, 10767, 10762]);
const TV_SCIFI_FANTASY = 10765;

// Keywords (TMDB keyword names, lower case) that put a title in a genre or theme.
const has = (keywords, words) => keywords.some((k) => words.some((w) => (w instanceof RegExp ? w.test(k) : k === w)));
const HORROR_WORDS = [/horror/, 'slasher', 'haunted house', 'zombie', 'zombie apocalypse', 'paranormal', 'demonic possession', 'exorcism', 'ghost', 'haunting', 'creature feature', 'gore', 'splatter'];
const MAFIA_WORDS = [/mafia/, /mob(ster)?$/, /gangster/, 'organized crime', /yakuza/, /triad/, /cartel/, /drug (dealer|dealing|lord|trafficking|smuggling|trade|kingpin|war|cartel|empire)/, /narco/, /cocaine/, /heroin/, /crime (family|boss|lord|syndicate)/, /camorra/, /ndrangheta/, /cosa nostra/, 'money laundering', 'methamphetamine', 'meth lab', 'drug addiction', 'drugs', 'gang', 'gang war'];
const DETECTIVE_WORDS = [/detective/, /investigat/, 'whodunit', 'police procedural', 'serial killer', 'murder mystery', 'cold case', 'private investigator', /sleuth/, /homicide/, 'fbi agent', 'fbi', 'profiler', 'criminal investigation', 'murder investigation', 'missing person'];
const SCIFI_WORDS = ['science fiction', /sci-?fi/, 'space', 'outer space', 'spaceship', 'space travel', 'alien', 'alien invasion', 'extraterrestrial', 'dystopia', 'post-apocalyptic future', 'time travel', 'artificial intelligence', 'cyberpunk', 'robot', 'android', 'cyborg', 'futuristic', 'parallel world', 'virtual reality', 'clone', 'genetic engineering', 'mars', 'space colony'];

/** The app's genre ids for a title, from its TMDB genres and keyword names. */
function genresOf(type, tmdbGenreIds = [], keywordNames = []) {
  const ids = new Set();
  const kw = keywordNames.map((k) => String(k).toLowerCase());
  for (const g of GENRES) if (!g.theme && (g[type] || []).some((x) => tmdbGenreIds.includes(x))) ids.add(g.id);
  if (type === 'tv') {
    if (tmdbGenreIds.includes(TV_SCIFI_FANTASY)) ids.add(has(kw, SCIFI_WORDS) || !kw.length ? 'scifi' : 'fantasy');
    if (has(kw, HORROR_WORDS)) ids.add('horror');
    if (tmdbGenreIds.includes(80) || tmdbGenreIds.includes(9648)) ids.add('thriller');
  } else if (tmdbGenreIds.includes(53) && has(kw, HORROR_WORDS) && has(kw, [/horror/])) ids.add('horror');
  const crimeLike = ids.has('crime') || ids.has('thriller');
  if (crimeLike && has(kw, MAFIA_WORDS)) ids.add('mafia');
  if (has(kw, DETECTIVE_WORDS) || (ids.has('mystery') && ids.has('crime'))) ids.add('detective');
  return [...ids];
}

/** Keyword names to look up on TMDB to find more of your favourite themes. */
const DISCOVER_KEYWORDS = {
  mafia: ['mafia', 'organized crime', 'drug cartel', 'drug trafficking', 'gangster', 'drug lord', 'mobster'],
  detective: ['detective', 'police procedural', 'serial killer', 'murder investigation', 'whodunit', 'private investigator'],
  horror: ['horror', 'supernatural horror', 'slasher', 'haunted house', 'folk horror', 'psychological horror'],
};

module.exports = { GENRES, byId, genresOf, SKIP_TV_GENRES, DISCOVER_KEYWORDS };
