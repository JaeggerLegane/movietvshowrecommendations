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
  { id: 'documentary', name: 'Documentary', movie: [99], tv: [99] },
  { id: 'romance', name: 'Romance', movie: [10749], tv: [] },
  { id: 'music', name: 'Music', movie: [10402], tv: [] },
];
const byId = new Map(GENRES.map((g) => [g.id, g]));

/** Anime: Japanese animation (or tagged "anime" on TMDB). Shown only in the Anime tab. */
const isAnime = (tmdbGenreIds = [], language = '', keywordNames = []) => tmdbGenreIds.includes(16) && (language === 'ja' || keywordNames.includes('anime'));

// TV genres that are never recommended: News, Reality, Soap, Talk, Kids.
const SKIP_TV_GENRES = new Set([10763, 10764, 10766, 10767, 10762]);
const TV_SCIFI_FANTASY = 10765;

// Keywords (TMDB keyword names, lower case) that put a title in a genre or theme.
const has = (keywords, words) => keywords.some((k) => words.some((w) => (w instanceof RegExp ? w.test(k) : k === w)));
// Strong words count on their own; weak words only when there are two of them (a single "gore" or "drugs" says little).
const HORROR = { strong: [/horror/, 'slasher', 'haunted house', 'demonic possession', 'exorcism', 'creature feature', 'splatter'], weak: ['zombie', 'zombie apocalypse', 'paranormal', 'ghost', 'haunting', 'gore', 'demon', 'possession', 'occult', 'witchcraft', 'cannibal', 'vampire', 'werewolf', 'curse', 'evil spirit'] };
const MAFIA = { strong: [/mafia/, /mobster/, /gangster/, 'organized crime', /yakuza/, /\btriad/, /cartel/, /drug (dealer|dealing|lord|trafficking|smuggling|trade|kingpin|war|empire|mule)/, /narco/, /cocaine/, /heroin/, /crime (family|boss|lord|syndicate)/, /camorra/, /ndrangheta/, /cosa nostra/, 'mob boss', 'methamphetamine', 'meth lab', 'irish mob', 'russian mob', 'gang war'], weak: ['drugs', 'drug addiction', 'drug abuse', 'gang', 'money laundering', 'smuggling', 'heist', 'police corruption', 'crime lord'] };
const DETECTIVE = { strong: [/detective/, 'whodunit', 'police procedural', 'murder investigation', 'private investigator', /sleuth/, 'murder mystery', 'cold case', 'homicide investigation', 'crime investigation'], weak: ['investigation', 'serial killer', 'fbi', 'fbi agent', 'profiler', 'missing person', 'homicide', 'police', 'murder', 'forensic', 'interrogation', 'police officer', 'criminal investigation'] };
const SCIFI_WORDS = ['science fiction', /sci-?fi/, 'space', 'outer space', 'spaceship', 'space travel', 'alien', 'alien invasion', 'extraterrestrial', 'dystopia', 'post-apocalyptic future', 'time travel', 'artificial intelligence', 'cyberpunk', 'robot', 'android', 'cyborg', 'futuristic', 'parallel world', 'virtual reality', 'clone', 'genetic engineering', 'mars', 'space colony'];
const hits = (keywords, words) => keywords.filter((k) => words.some((w) => (w instanceof RegExp ? w.test(k) : k === w))).length;
const matches = (keywords, set) => hits(keywords, set.strong) >= 1 || hits(keywords, set.weak) >= 2;

/** The app's genre ids for a title, from its TMDB genres and keyword names. */
function genresOf(type, tmdbGenreIds = [], keywordNames = []) {
  const ids = new Set();
  const kw = keywordNames.map((k) => String(k).toLowerCase());
  for (const g of GENRES) if (!g.theme && (g[type] || []).some((x) => tmdbGenreIds.includes(x))) ids.add(g.id);
  if (type === 'tv') {
    if (tmdbGenreIds.includes(TV_SCIFI_FANTASY)) ids.add(has(kw, SCIFI_WORDS) || !kw.length ? 'scifi' : 'fantasy');
    if (matches(kw, HORROR)) ids.add('horror');
    if (tmdbGenreIds.includes(80) || tmdbGenreIds.includes(9648)) ids.add('thriller');
  } else if (tmdbGenreIds.includes(53) && hits(kw, [/horror/])) ids.add('horror');
  const crimeLike = ids.has('crime') || ids.has('thriller');
  if (crimeLike && matches(kw, MAFIA)) ids.add('mafia');
  if ((ids.has('crime') || ids.has('mystery')) && (matches(kw, DETECTIVE) || (ids.has('mystery') && ids.has('crime') && hits(kw, DETECTIVE.weak) >= 1))) ids.add('detective');
  return [...ids];
}

/** Keyword names to look up on TMDB to find more of your favourite themes. */
const DISCOVER_KEYWORDS = {
  mafia: ['mafia', 'organized crime', 'drug cartel', 'drug trafficking', 'gangster', 'drug lord', 'mobster'],
  detective: ['detective', 'police procedural', 'serial killer', 'murder investigation', 'whodunit', 'private investigator'],
  horror: ['horror', 'supernatural horror', 'slasher', 'haunted house', 'folk horror', 'psychological horror'],
};

module.exports = { GENRES, byId, genresOf, isAnime, SKIP_TV_GENRES, DISCOVER_KEYWORDS };
