// A pretend TMDB + IMDb for trying the app without internet or a TMDB key.
//   node test/mock-tmdb.js          -> serves on http://localhost:4010 and fills test/library with fake folders
// Then start the app with:
//   TMDB_API_KEY=mock TMDB_BASE=http://localhost:4010/3 TMDB_IMAGE_BASE=http://localhost:4010/img/ \
//   IMDB_RATINGS_URL=http://localhost:4010/imdb/title.ratings.tsv.gz MOVIES_DIR=test/library/movies TV_DIR=test/library/tv \
//   NO_LOGIN=1 DATA_DIR=test/data npm start
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = Number(process.env.MOCK_PORT || 4010);
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const A = ['Dark', 'Silent', 'Broken', 'Last', 'Hidden', 'Red', 'Cold', 'Black', 'Lost', 'Iron', 'Hollow', 'Burning', 'Frozen', 'Crimson', 'Savage', 'Midnight', 'Pale', 'Wicked', 'Deep', 'Final'];
const B = ['Harbor', 'Signal', 'Empire', 'Witness', 'Orbit', 'Cartel', 'Shadow', 'Frontier', 'Ritual', 'Precinct', 'Station', 'Legacy', 'Hunt', 'Protocol', 'House', 'River', 'Code', 'Front', 'Veil', 'Dynasty'];
const MOVIE_G = [27, 53, 80, 9648, 878, 10752, 28, 18, 14, 12, 35, 36, 16, 99, 10749, 10751, 37, 10402];
const TV_G = [80, 9648, 10765, 10768, 10759, 18, 35, 16, 99, 10751, 37, 10764, 10767];
const KW = ['detective', 'serial killer', 'mafia', 'drug cartel', 'organized crime', 'haunted house', 'supernatural horror', 'space', 'alien', 'time travel', 'world war ii', 'soldier', 'police procedural', 'revenge', 'small town', 'family', 'friendship', 'heist', 'dystopia', 'zombie'];
const COLORS = ['#7a1f1f', '#1f3d7a', '#2f5d3a', '#5d2f6b', '#7a5a1f', '#1f6b6b', '#3a3a3a', '#6b1f4a'];

const items = { movie: new Map(), tv: new Map() };
const used = new Set();
function makeTitle() { for (;;) { const t = `The ${pick(A)} ${pick(B)}${rnd() < 0.3 ? ` ${Math.floor(rnd() * 3) + 2}` : ''}`; if (!used.has(t)) { used.add(t); return t; } } }
for (let i = 1; i <= 1400; i += 1) {
  const type = i % 3 === 0 ? 'tv' : 'movie';
  const id = 1000 + i;
  const year = Math.floor(1955 + rnd() * 72);
  const date = `${Math.min(year, 2026)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-15`;
  const gpool = type === 'movie' ? MOVIE_G : TV_G;
  const genres = [...new Set([pick(gpool), pick(gpool), ...(rnd() < 0.4 ? [pick(gpool)] : [])])];
  const v = Math.round((3.5 + rnd() * 5.5) * 10) / 10;
  items[type].set(id, {
    id, type, title: makeTitle(), date, genres, v, n: Math.floor(20 + rnd() * 20000), pop: rnd() * 100,
    keywords: [...new Set([pick(KW), pick(KW), pick(KW)])], imdb: `tt${String(9000000 + id)}`, imdbRating: Math.max(1, Math.min(9.6, Math.round((v + (rnd() - 0.5)) * 10) / 10)),
    imdbVotes: Math.floor(rnd() < 0.15 ? rnd() * 400 : 500 + rnd() * 400000), seasons: 1 + Math.floor(rnd() * 6), color: pick(COLORS),
  });
}
const all = (type) => [...items[type].values()];
const listItem = (x) => ({ id: x.id, [x.type === 'tv' ? 'name' : 'title']: x.title, [x.type === 'tv' ? 'first_air_date' : 'release_date']: x.date, genre_ids: x.genres, poster_path: `/p${x.id}.svg`, backdrop_path: `/b${x.id}.svg`, vote_average: x.v, vote_count: x.n, popularity: x.pop, overview: 'x', adult: false, media_type: x.type });
const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^(the|a|an) /, '').trim();

// The fake NAS: about 60 movies and 20 shows, named in the different ways people name folders.
function makeLibrary() {
  const root = path.join(__dirname, 'library');
  fs.rmSync(root, { recursive: true, force: true });
  const movies = all('movie').filter((x) => x.date.slice(0, 4) >= '1980').slice(0, 60);
  movies.forEach((x, i) => {
    const y = x.date.slice(0, 4);
    const style = i % 5;
    let rel;
    if (style === 0) rel = `${x.title} (${y})`;
    else if (style === 1) rel = `${x.title.replace(/ /g, '.')}.${y}.1080p.BluRay.x264-GRP`;
    else if (style === 2) rel = `${x.title} (${y}) {tmdb-${x.id}}`;
    else if (style === 3) rel = `Some Collection/${x.title} (${y})`;
    else rel = null; // loose file
    if (rel) { fs.mkdirSync(path.join(root, 'movies', rel), { recursive: true }); fs.writeFileSync(path.join(root, 'movies', rel, 'movie.mkv'), ''); } else { fs.mkdirSync(path.join(root, 'movies'), { recursive: true }); fs.writeFileSync(path.join(root, 'movies', `${x.title.replace(/ /g, '.')}.${y}.720p.WEB-DL.mkv`), ''); }
  });
  fs.mkdirSync(path.join(root, 'movies', '@eaDir'), { recursive: true });
  fs.mkdirSync(path.join(root, 'movies', 'Totally Unknown Film (1999)'), { recursive: true });
  fs.writeFileSync(path.join(root, 'movies', 'Totally Unknown Film (1999)', 'a.mkv'), '');
  all('tv').slice(0, 20).forEach((x, i) => {
    const name = i % 2 ? `${x.title} (${x.date.slice(0, 4)})` : x.title;
    fs.mkdirSync(path.join(root, 'tv', name, 'Season 01'), { recursive: true });
  });
  console.log(`Fake library in ${root}`);
}

function svg(file, size) {
  const id = Number((/\d+/.exec(file) || ['0'])[0]);
  const x = items.movie.get(id) || items.tv.get(id) || { title: 'Person', color: '#444' };
  const wide = file.startsWith('b');
  const [w, h] = wide ? [1280, 720] : [342, 513];
  const words = x.title.split(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${x.color}"/><stop offset="1" stop-color="#0b0b0b"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${wide ? '' : words.map((wd, i) => `<text x="24" y="${300 + i * 46}" font-family="Georgia" font-size="40" font-weight="700" fill="#fff" opacity=".92">${wd.toUpperCase()}</text>`).join('')}</svg>`;
}

function imdbFile() {
  const lines = ['tconst\taverageRating\tnumVotes'];
  for (const t of ['movie', 'tv']) for (const x of all(t)) lines.push(`${x.imdb}\t${x.imdbRating}\t${x.imdbVotes}`);
  return zlib.gzipSync(lines.join('\n'));
}

function details(x, params) {
  const out = { ...listItem(x), genres: x.genres.map((id) => ({ id, name: `G${id}` })), overview: `A gripping story about ${x.keywords.join(', ')}. ${x.title} follows a reluctant hero through a dangerous world where nothing is what it seems.`, tagline: 'Nothing stays buried.' };
  out.runtime = 85 + (x.id % 70);
  out.imdb_id = x.imdb;
  out.credits = { cast: Array.from({ length: 10 }, (_, i) => ({ name: `Actor ${x.id}-${i}`, character: `Role ${i}`, profile_path: null })), crew: [{ name: `Director ${x.id}`, job: 'Director', profile_path: null }] };
  out.videos = { results: [{ site: 'YouTube', type: 'Trailer', official: true, key: 'dQw4w9WgXcQ' }] };
  if (x.type === 'movie') {
    out.keywords = { keywords: x.keywords.map((name, i) => ({ id: i, name })) };
    out.release_dates = { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'R' }] }] };
  } else {
    out.keywords = { results: x.keywords.map((name, i) => ({ id: i, name })) };
    out.content_ratings = { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] };
    out.external_ids = { imdb_id: x.imdb };
    delete out.imdb_id;
    out.number_of_seasons = x.seasons; out.number_of_episodes = x.seasons * 10; out.status = 'Ended'; out.networks = [{ name: 'HBO' }];
    out.created_by = [{ name: `Creator ${x.id}`, profile_path: null }];
    out.seasons = Array.from({ length: x.seasons }, (_, i) => ({ season_number: i + 1, name: `Season ${i + 1}`, episode_count: 10, poster_path: `/p${x.id}.svg`, air_date: x.date }));
  }
  if (!String(params.get('append_to_response') || '').includes('credits')) delete out.credits;
  return out;
}

function page(arr, p) { const n = Number(p) || 1; return { page: n, results: arr.slice((n - 1) * 20, n * 20).map(listItem), total_pages: Math.ceil(arr.length / 20) }; }

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
  const auth = req.headers.authorization || u.searchParams.get('api_key');
  if (u.pathname.startsWith('/img/')) return send(200, svg(path.basename(u.pathname), u.pathname.split('/')[2]), 'image/svg+xml');
  if (u.pathname === '/imdb/title.ratings.tsv.gz') { res.writeHead(200, { 'content-type': 'application/gzip' }); return res.end(imdbFile()); }
  if (!auth) return send(401, { status_message: 'Invalid API key' });
  if (String(auth).includes('bad')) return send(401, { status_message: 'Invalid API key' });
  let m;
  const p = u.pathname.replace(/^\/3/, '');
  if (p === '/configuration') return send(200, { images: {} });
  if (p === '/search/keyword') return send(200, { results: [{ id: norm(u.searchParams.get('query')).length * 100 + 7, name: u.searchParams.get('query') }] });
  if ((m = /^\/discover\/(movie|tv)$/.exec(p))) {
    const g = String(u.searchParams.get('with_genres') || '').split(/[|,]/).filter(Boolean).map(Number);
    const kw = u.searchParams.get('with_keywords');
    let arr = all(m[1]).filter((x) => (!g.length || x.genres.some((y) => g.includes(y))) && (!kw || x.keywords.some((k) => /detective|serial|mafia|cartel|organized|haunted|horror/.test(k))));
    arr = u.searchParams.get('sort_by') === 'vote_average.desc' ? arr.sort((a, b) => b.v - a.v) : arr.sort((a, b) => b.pop - a.pop);
    return send(200, page(arr, u.searchParams.get('page')));
  }
  if ((m = /^\/trending\/(movie|tv)\/week$/.exec(p))) return send(200, page(all(m[1]).sort((a, b) => b.n - a.n), u.searchParams.get('page')));
  if ((m = /^\/(movie|tv)\/(\d+)\/recommendations$/.exec(p))) {
    const id = Number(m[2]);
    const arr = all(m[1]).filter((x) => x.id !== id && ((x.id * 31 + id * 17) % 23) < 2).slice(0, 20);
    return send(200, { page: 1, results: arr.map(listItem) });
  }
  if ((m = /^\/(movie|tv)\/(\d+)$/.exec(p))) {
    const x = items[m[1]].get(Number(m[2]));
    return x ? send(200, details(x, u.searchParams)) : send(404, { status_message: 'not found' });
  }
  if ((m = /^\/search\/(movie|tv|multi)$/.exec(p))) {
    const q = norm(u.searchParams.get('query'));
    const year = u.searchParams.get('primary_release_year') || u.searchParams.get('first_air_date_year');
    const types = m[1] === 'multi' ? ['movie', 'tv'] : [m[1]];
    const arr = types.flatMap(all).filter((x) => norm(x.title).includes(q) && (!year || x.date.startsWith(year)));
    return send(200, { page: 1, results: arr.slice(0, 20).map(listItem) });
  }
  if ((m = /^\/find\/(tt\d+)$/.exec(p))) {
    const x = [...all('movie'), ...all('tv')].find((y) => y.imdb === m[1]);
    return send(200, { movie_results: x && x.type === 'movie' ? [listItem(x)] : [], tv_results: x && x.type === 'tv' ? [listItem(x)] : [] });
  }
  return send(404, { status_message: `mock has no ${p}` });
});

if (require.main === module) {
  makeLibrary();
  server.listen(PORT, () => console.log(`Mock TMDB on http://localhost:${PORT}/3`));
}
module.exports = { server, makeLibrary, items };
