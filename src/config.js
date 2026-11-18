// All settings in one place. Everything can be changed with an environment variable (in nas/.env on the NAS).
const path = require('path');

const env = process.env;
const num = (value, fallback) => (value === undefined || value === '' || Number.isNaN(Number(value)) ? fallback : Number(value));
// A value still saying FILL-IN in .env counts as not filled in.
const text = (value) => { const v = String(value || '').trim(); return /^FILL-?IN/i.test(v) ? '' : v; };

module.exports = {
  port: num(env.PORT, 3000),
  password: text(env.APP_PASSWORD),
  noLogin: env.NO_LOGIN === '1', // only for GitHub Codespaces, where GitHub already asks who you are
  cookieSecure: env.COOKIE_SECURE === 'true',
  trustProxy: num(env.TRUST_PROXY, 1),
  dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'),

  // The NAS folders, mounted read-only into the container by nas/docker-compose.yml.
  moviesDir: env.MOVIES_DIR || '/library/movies',
  tvDir: env.TV_DIR || '/library/tv',

  tmdbKey: text(env.TMDB_API_KEY),
  tmdbBase: env.TMDB_BASE || 'https://api.themoviedb.org/3',
  imageBase: env.TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p/',
  tmdbLanguage: env.TMDB_LANGUAGE || 'en-US',
  // Content ratings (TV-14, R, ...) are taken from these countries, first one that has one.
  ratingCountries: (env.RATING_COUNTRIES || 'US,BE,GB').split(',').map((c) => c.trim().toUpperCase()),
  imdbRatingsUrl: env.IMDB_RATINGS_URL || 'https://datasets.imdbws.com/title.ratings.tsv.gz',

  // Your rules.
  minYear: num(env.MIN_YEAR, 1970), // nothing released before this year
  minImdb: num(env.MIN_IMDB, 6), // nothing rated lower on IMDb ... unless it is horror
  minVotes: num(env.MIN_VOTES, 500), // an IMDb rating only counts with at least this many votes

  // How much is looked up. Higher = more choice, longer first build.
  maxDetails: { movie: num(env.MAX_MOVIES, 2500), tv: num(env.MAX_SHOWS, 1500) },
  refreshEveryHours: num(env.REFRESH_EVERY_HOURS, 6),
};
