// Builds the recommendations:
// 1. read the NAS folders and work out what you already have,
// 2. collect candidates from TMDB: "people who liked <your title> also liked", plus your favourite genres,
// 3. look up details (poster, seasons, cast) and the IMDb rating of the best candidates,
// 4. keep only what passes your rules, and score it.
// The result is saved in data/recs.json, so the app shows it straight away after a restart.
const config = require('./config');
const tmdb = require('./tmdb');
const imdb = require('./imdb');
const library = require('./library');
const jsonfile = require('./jsonfile');
const { GENRES, byId, genresOf, SKIP_TV_GENRES, DISCOVER_KEYWORDS } = require('./genres');

const DAY = 24 * 3600 * 1000;
const TYPES = ['movie', 'tv'];
const FAVOURITES = ['horror', 'detective', 'mafia', 'war', 'scifi'];
const details = jsonfile.open('details.json', { items: {} });
const lists = jsonfile.open('lists.json', { items: {}, keywords: {} });
const recs = jsonfile.open('recs.json', { builtAt: null, pool: [], owned: [], ratings: {}, stats: {} });
const marks = jsonfile.open('marks.json', { hidden: [], watchlist: [] });

let poolMap = new Map(recs.data.pool.map((i) => [i.key, i]));
const status = { running: false, step: null, done: 0, total: 0, startedAt: null, finishedAt: null, error: null, tmdbProblem: null };

const today = () => new Date().toISOString().slice(0, 10);
const yearOf = (date) => Number(String(date || '').slice(0, 4)) || null;
const slim = (r) => ({ id: r.id, t: r.title || r.name, d: r.release_date || r.first_air_date || '', g: r.genre_ids || [], p: r.poster_path || null, b: r.backdrop_path || null, v: r.vote_average || 0, n: r.vote_count || 0, pop: r.popularity || 0, adult: Boolean(r.adult) });

async function cachedList(key, maxAgeDays, fetcher) {
  const c = lists.data.items[key];
  if (c && Date.now() - c.at < maxAgeDays * DAY) return c.results;
  try {
    const results = ((await fetcher()) || []).map(slim);
    lists.data.items[key] = { at: Date.now(), results };
    lists.saveSoon();
    return results;
  } catch (err) {
    if (err.status === 401) throw err;
    return c ? c.results : [];
  }
}

async function keywordIds(names) {
  const out = [];
  for (const name of names) {
    let id = lists.data.keywords[name];
    if (id === undefined) {
      const r = await tmdb.get('/search/keyword', { query: name, language: '' }).catch(() => null);
      if (!r) continue;
      const hit = (r.results || []).find((k) => k.name.toLowerCase() === name);
      id = hit ? hit.id : null;
      lists.data.keywords[name] = id;
    }
    if (id) out.push(id);
  }
  return out.join('|');
}

function discoverPlans(kw) {
  const from = `${config.minYear}-01-01`;
  const yearAgo = new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10);
  const m = (tag, params, pages) => ({ type: 'movie', tag, pages, params: { 'primary_release_date.gte': from, 'primary_release_date.lte': today(), include_adult: false, sort_by: 'popularity.desc', 'vote_count.gte': 100, ...params } });
  const t = (tag, params, pages) => ({ type: 'tv', tag, pages, params: { 'first_air_date.gte': from, 'first_air_date.lte': today(), sort_by: 'popularity.desc', 'vote_count.gte': 50, without_genres: [...SKIP_TV_GENRES].join(','), ...params } });
  const best = (minVotes) => ({ sort_by: 'vote_average.desc', 'vote_count.gte': minVotes });
  return [
    m('horror', { with_genres: 27 }, 8), m('horror', { with_genres: 27, ...best(500) }, 4),
    m('scifi', { with_genres: 878 }, 5), m('scifi', { with_genres: 878, ...best(1000) }, 3),
    m('war', { with_genres: 10752 }, 4), m('war', { with_genres: 10752, ...best(500) }, 2),
    m('crime', { with_genres: 80 }, 5), m('crime', { with_genres: 80, ...best(2000) }, 3),
    m('mafia', { with_keywords: kw.mafia }, 4), m('detective', { with_keywords: kw.detective }, 4),
    m('thriller', { with_genres: '53|9648' }, 3),
    m('top', best(5000), 6), m('new', { 'primary_release_date.gte': yearAgo, 'vote_count.gte': 50 }, 5), m('popular', {}, 4),
    t('horror', { with_keywords: kw.horror }, 4), t('scifi', { with_genres: 10765 }, 5), t('war', { with_genres: 10768 }, 3),
    t('crime', { with_genres: 80 }, 6), t('crime', { with_genres: 80, ...best(500) }, 3),
    t('mafia', { with_keywords: kw.mafia }, 3), t('detective', { with_keywords: kw.detective }, 4), t('mystery', { with_genres: 9648 }, 4),
    t('top', best(1500), 5), t('new', { 'first_air_date.gte': yearAgo, 'vote_count.gte': 20 }, 3), t('popular', {}, 4),
  ].filter((p) => !('with_keywords' in p.params) || p.params.with_keywords);
}

function certOf(type, r) {
  for (const country of config.ratingCountries) {
    if (type === 'movie') {
      const x = ((r.release_dates || {}).results || []).find((z) => z.iso_3166_1 === country);
      const cert = x && x.release_dates.map((d) => d.certification).find(Boolean);
      if (cert) return cert;
    } else {
      const x = ((r.content_ratings || {}).results || []).find((z) => z.iso_3166_1 === country);
      if (x && x.rating) return x.rating;
    }
  }
  return null;
}

function trim(type, r) {
  const kw = (type === 'movie' ? (r.keywords || {}).keywords : (r.keywords || {}).results) || [];
  const vids = ((r.videos || {}).results || []).filter((v) => v.site === 'YouTube');
  const trailer = vids.find((v) => v.type === 'Trailer' && v.official) || vids.find((v) => v.type === 'Trailer') || vids.find((v) => v.type === 'Teaser');
  const credits = r.credits || {};
  const crew = type === 'tv' ? (r.created_by || []).slice(0, 3).map((c) => ({ name: c.name, job: 'Creator', photo: c.profile_path || null })) : [];
  for (const c of credits.crew || []) {
    if (crew.length >= 5) break;
    if (['Director', 'Screenplay', 'Writer', 'Novel'].includes(c.job) && !crew.some((x) => x.name === c.name)) crew.push({ name: c.name, job: c.job, photo: c.profile_path || null });
  }
  return {
    at: Date.now(), type, id: r.id, title: r.title || r.name, original: r.original_title || r.original_name || '',
    date: (type === 'movie' ? r.release_date : r.first_air_date) || '', overview: r.overview || '', tagline: r.tagline || '',
    poster: r.poster_path || null, backdrop: r.backdrop_path || null,
    tmdbGenres: (r.genres || []).map((g) => g.id), keywords: kw.map((k) => k.name.toLowerCase()).slice(0, 40),
    runtime: r.runtime || (r.episode_run_time || [])[0] || null,
    seasons: type === 'tv' ? (r.seasons || []).filter((s) => s.season_number > 0).map((s) => ({ n: s.season_number, name: s.name, episodes: s.episode_count, poster: s.poster_path || null, date: s.air_date || '' })) : undefined,
    numSeasons: r.number_of_seasons || null, numEpisodes: r.number_of_episodes || null, status: r.status || '', lastAir: r.last_air_date || '',
    networks: (r.networks || []).map((n) => n.name).slice(0, 3), countries: r.origin_country || (r.production_countries || []).map((c) => c.iso_3166_1),
    language: r.original_language || '', cert: certOf(type, r), imdb: r.imdb_id || (r.external_ids || {}).imdb_id || null,
    tmdbRating: r.vote_average || 0, tmdbVotes: r.vote_count || 0, popularity: r.popularity || 0, adult: Boolean(r.adult),
    cast: (credits.cast || []).slice(0, 15).map((c) => ({ name: c.name, role: c.character || '', photo: c.profile_path || null })),
    crew, trailer: trailer ? trailer.key : null, collection: (r.belongs_to_collection || {}).name || null,
  };
}

async function getDetails(type, id, maxAgeDays = 14) {
  const key = `${type}:${id}`;
  const c = details.data.items[key];
  if (c && Date.now() - c.at < maxAgeDays * DAY) return c;
  const append = type === 'movie' ? 'credits,videos,release_dates,keywords' : 'credits,videos,content_ratings,keywords,external_ids';
  let raw = null;
  try { raw = await tmdb.get(`/${type}/${id}`, { append_to_response: append, include_video_language: 'en,null' }); } catch (err) { if (!c) throw err; }
  if (!raw) return c || null;
  const t = trim(type, raw);
  details.data.items[key] = t;
  details.saveSoon(10000);
  return t;
}

/** Why a title is (not) recommended. Returns { ok: true, ... } or { ok: false, reason }. */
function judge(d, rating, owned) {
  const year = yearOf(d.date);
  const genres = genresOf(d.type, d.tmdbGenres, d.keywords);
  const horror = genres.includes('horror');
  const base = { genres, horror, rating: rating ? rating.rating : null, votes: rating ? rating.votes : 0 };
  if (!year) return { ...base, ok: false, reason: 'No release date yet' };
  if (d.date > today()) return { ...base, ok: false, reason: `Not released yet (${d.date})` };
  if (year < config.minYear) return { ...base, ok: false, reason: `From ${year}, before ${config.minYear}` };
  if (owned.ids[d.type].has(d.id) || owned.has(d.type, d.title, year) || (d.original && owned.has(d.type, d.original, year))) return { ...base, ok: false, reason: 'Already on your NAS', owned: true };
  if (d.adult) return { ...base, ok: false, reason: 'Adult title' };
  if (d.type === 'tv' && d.tmdbGenres.some((g) => SKIP_TV_GENRES.has(g))) return { ...base, ok: false, reason: 'Reality, talk show, news, soap or kids show' };
  const counted = rating && rating.votes >= config.minVotes;
  const recent = Date.now() - Date.parse(d.date) < 180 * DAY;
  let score = null; let source = null;
  if (counted) { score = rating.rating; source = 'imdb'; } else if (recent && d.tmdbVotes >= 20) { score = d.tmdbRating; source = 'tmdb'; }
  if (horror) {
    if (!rating && (d.tmdbVotes || 0) < 30) return { ...base, ok: false, reason: 'Too few ratings to judge' };
    return { ...base, ok: true, score: score ?? (rating ? rating.rating : d.tmdbRating), source: source || (rating ? 'imdb' : 'tmdb') };
  }
  if (score === null) return { ...base, ok: false, reason: rating ? `Only ${rating.votes} IMDb votes (needs ${config.minVotes})` : 'No IMDb rating' };
  if (score < config.minImdb) return { ...base, ok: false, reason: `Rated ${score.toFixed(1)} on ${source === 'imdb' ? 'IMDb' : 'TMDB'}, below your ${config.minImdb}` };
  return { ...base, ok: true, score, source };
}

function scoreOf(item, d) {
  const favs = item.genres.map((g) => (byId.get(g) || {}).fav || 0).sort((a, b) => b - a);
  const fav = (favs[0] || 0) + (favs[1] || 0) * 0.35;
  const votes = item.votes || (d.tmdbVotes || 0) * 10;
  const ageYears = (Date.now() - Date.parse(d.date)) / (365 * DAY);
  return Math.round((item.quality * 10 + fav * 14 + Math.min(item.because.length, 5) * 3 + Math.min(6, Math.log10(votes + 1) * 1.2) + (ageYears < 1.5 ? 4 : 0)) * 10) / 10;
}

function setStep(step, total = 0) { status.step = step; status.done = 0; status.total = total; }

async function inParallel(items, fn) {
  status.done = 0; status.total = items.length;
  await Promise.all(items.map(async (x) => {
    try { await fn(x); } catch (err) { if (err.status === 401) throw err; }
    status.done += 1;
  }));
}

async function build() {
  if (status.running) return;
  Object.assign(status, { running: true, startedAt: new Date().toISOString(), error: null });
  const started = Date.now();
  try {
    setStep('Reading your NAS folders');
    status.tmdbProblem = await tmdb.check();
    await library.scan(!status.tmdbProblem);
    if (!tmdb.configured()) return; // nothing more to do until there is a TMDB key
    if (status.tmdbProblem) throw new Error(`TMDB: ${status.tmdbProblem}`);

    setStep('Downloading IMDb ratings');
    await imdb.refresh();

    const owned = library.owned();
    const ownedTitles = new Map();
    for (const type of TYPES) for (const e of library.entries(type)) if (e.tmdb) ownedTitles.set(`${type}:${e.tmdb}`, { key: `${type}:${e.tmdb}`, type, id: e.tmdb, title: e.matched || e.title || e.name, year: e.matchedYear || e.year || null, mtime: e.mtime || 0, poster: e.poster || null });

    // Candidates: key -> { type, r, tags, because }
    const cands = new Map();
    const add = (type, r, tag, because) => {
      const key = `${type}:${r.id}`;
      let c = cands.get(key);
      if (!c) { c = { type, r, tags: new Set(), because: new Set() }; cands.set(key, c); }
      if (tag) c.tags.add(tag);
      if (because) c.because.add(because);
    };

    setStep('Asking TMDB for your favourite genres');
    const kw = {};
    for (const [theme, names] of Object.entries(DISCOVER_KEYWORDS)) kw[theme] = await keywordIds(names);
    const pages = [];
    for (const plan of discoverPlans(kw)) for (let page = 1; page <= plan.pages; page += 1) pages.push({ plan, page });
    for (const type of TYPES) for (let page = 1; page <= 3; page += 1) pages.push({ trending: type, page });
    await inParallel(pages, async ({ plan, trending, page }) => {
      if (trending) {
        for (const r of await cachedList(`trending:${trending}:${page}`, 1, async () => (await tmdb.get(`/trending/${trending}/week`, { page })).results)) add(trending, r, 'trending');
        return;
      }
      const key = `discover:${plan.type}:${JSON.stringify(plan.params)}:${page}`;
      for (const r of await cachedList(key, 3, async () => (await tmdb.get(`/discover/${plan.type}`, { ...plan.params, page })).results)) add(plan.type, r, plan.tag);
    });

    setStep('Finding titles like the ones you have');
    await inParallel([...ownedTitles.values()], async (o) => {
      const results = await cachedList(`rec:${o.key}`, 21, async () => (await tmdb.get(`/${o.type}/${o.id}/recommendations`)).results);
      for (const r of results) add(o.type, r, 'because', o.key);
    });

    // Pre-selection on what the lists already tell (cheap), before looking up details (one request each).
    const pre = [];
    for (const [key, c] of cands) {
      const { r, type } = c;
      const year = yearOf(r.d);
      if (r.adult || !year || year < config.minYear || r.d > today() || r.n < 15) continue;
      if (owned.ids[type].has(r.id) || owned.has(type, r.t, year)) continue;
      if (type === 'tv' && r.g.some((g) => SKIP_TV_GENRES.has(g))) continue;
      const favs = genresOf(type, r.g, []).map((g) => (byId.get(g) || {}).fav || 0);
      const horror = type === 'movie' ? r.g.includes(27) : c.tags.has('horror');
      if (!horror && r.n > 200 && r.v < config.minImdb - 1) continue; // clearly too low, even allowing for TMDB vs IMDb differences
      const preScore = Math.min(c.because.size, 8) * 3 + Math.max(0, ...favs) * 5 + (horror ? 3 : 0) + r.v * 0.8 + Math.log10(r.n + 1) + c.tags.size * 0.5;
      pre.push({ key, c, preScore });
    }
    const chosen = [];
    for (const type of TYPES) chosen.push(...pre.filter((x) => x.c.type === type).sort((a, b) => b.preScore - a.preScore).slice(0, config.maxDetails[type]));

    setStep('Looking up posters, seasons and cast');
    const found = new Map();
    await inParallel(chosen, async ({ key, c }) => {
      const d = await getDetails(c.type, c.r.id);
      if (d) found.set(key, { d, c });
    });
    details.saveSoon(100);

    setStep('Reading IMDb ratings');
    const ids = new Set([...found.values()].map(({ d }) => d.imdb).filter(Boolean));
    const ratings = await imdb.ratingsFor(ids);

    setStep('Applying your rules');
    const pool = [];
    const rejected = {};
    for (const [key, { d, c }] of found) {
      const rating = d.imdb ? ratings.get(d.imdb) : null;
      const j = judge(d, rating, owned);
      if (!j.ok) { const why = j.reason.replace(/[\d.]+/g, '#'); rejected[why] = (rejected[why] || 0) + 1; continue; }
      const because = [...c.because].map((k) => ownedTitles.get(k)).filter(Boolean).sort((a, b) => b.mtime - a.mtime);
      const item = {
        key, type: d.type, id: d.id, title: d.title, year: yearOf(d.date), date: d.date, poster: d.poster, backdrop: d.backdrop,
        overview: d.overview.length > 420 ? `${d.overview.slice(0, 417).replace(/\s+\S*$/, '')}...` : d.overview,
        rating: j.rating, votes: j.votes, quality: j.score, source: j.source, tmdbRating: d.tmdbRating, genres: j.genres,
        cert: d.cert, runtime: d.runtime, seasons: d.numSeasons, because: because.map((o) => o.key), tags: [...c.tags],
      };
      item.score = scoreOf(item, d);
      pool.push(item);
    }
    pool.sort((a, b) => b.score - a.score);

    const ratingMap = {};
    for (const [id, r] of ratings) ratingMap[id] = [r.rating, r.votes];
    const ownedList = [...ownedTitles.values()].sort((a, b) => b.mtime - a.mtime);
    recs.replace({
      builtAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), pool, owned: ownedList, ratings: ratingMap,
      stats: { candidates: cands.size, preselected: pre.length, detailed: found.size, kept: pool.length, rejected },
    });
    recs.save();
    poolMap = new Map(pool.map((i) => [i.key, i]));
    lists.save();
  } catch (err) {
    status.error = `${new Date().toISOString()} ${err.message}`;
    console.error('Build failed:', err);
  } finally {
    status.running = false; status.step = null; status.finishedAt = new Date().toISOString();
  }
}

// ---------- What the pages ask for ----------

const card = (i) => ({ key: i.key, type: i.type, id: i.id, title: i.title, year: i.year, poster: i.poster, rating: i.rating, source: i.source, quality: i.quality, seasons: i.seasons, runtime: i.runtime, horror: i.genres.includes('horror') });
const ownedByKey = () => new Map((recs.data.owned || []).map((o) => [o.key, o]));
const dayNumber = () => Math.floor((Date.now() + 3600 * 1000) / DAY);
function rotate(arr, n) { if (!arr.length) return arr; const s = n % arr.length; return arr.slice(s).concat(arr.slice(0, s)); }

function home({ type = 'all', genre = '' } = {}) {
  const hidden = new Set(marks.data.hidden);
  const fits = (i) => !hidden.has(i.key) && (type === 'all' || i.type === type) && (!genre || i.genres.includes(genre));
  const pool = recs.data.pool.filter(fits); // already sorted by score
  const owned = ownedByKey();
  const rows = [];
  const used = new Set();
  const row = (id, title, items, min = 5) => { if (items.length >= min) rows.push({ id, title, items: items.slice(0, 40).map(card) }); };
  const genreName = genre && byId.get(genre) ? byId.get(genre).name : '';

  const watch = marks.data.watchlist.map((k) => poolMap.get(k)).filter((i) => i && fits(i));
  row('mylist', 'My list', watch, 1);
  row('top', genreName ? `Top ${genreName} picks for you` : 'Top picks for you', pool);

  // "Because you added X": the newest titles in your folders that have enough recommendations.
  const recCount = new Map();
  for (const i of pool) for (const k of i.because) recCount.set(k, (recCount.get(k) || 0) + 1);
  const ownedFits = (o) => (type === 'all' || o.type === type) && (recCount.get(o.key) || 0) >= 5;
  for (const o of (recs.data.owned || []).filter(ownedFits).slice(0, 3)) {
    used.add(o.key);
    row(`because-${o.key}`, `Because you recently added ${o.title}`, pool.filter((i) => i.because.includes(o.key)));
  }

  for (const id of FAVOURITES) if (id !== genre) row(id, byId.get(id).name, pool.filter((i) => i.genres.includes(id)));

  const yearAgo = new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10);
  row('new', 'New releases', pool.filter((i) => i.date >= yearAgo));
  row('imdb', 'Highest rated on IMDb', pool.filter((i) => i.source === 'imdb' && i.votes >= 25000).sort((a, b) => b.rating - a.rating));
  row('gems', 'Hidden gems', pool.filter((i) => i.source === 'imdb' && i.rating >= 7.3 && i.votes < 25000).sort((a, b) => b.rating - a.rating));

  // "Because you have X": a few other titles you own, different every day.
  const others = [...recCount.entries()].filter(([k, n]) => n >= 6 && !used.has(k) && owned.has(k)).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k]) => owned.get(k));
  for (const o of rotate(others, dayNumber() * 3).slice(0, 3)) row(`have-${o.key}`, `Because you have ${o.title}`, pool.filter((i) => i.because.includes(o.key)));

  const rest = GENRES.filter((g) => !FAVOURITES.includes(g.id) && g.id !== genre)
    .map((g) => ({ g, items: pool.filter((i) => i.genres.includes(g.id)) }))
    .filter((x) => x.items.length >= 8).sort((a, b) => b.items.length - a.items.length);
  for (const { g, items } of rest) row(g.id, g.name, items);

  const heroes = pool.filter((i) => i.backdrop && i.overview).slice(0, 10);
  const h = heroes.length ? heroes[dayNumber() % heroes.length] : null;
  const hero = h && { ...card(h), backdrop: h.backdrop, overview: h.overview, genres: h.genres.map((g) => byId.get(g).name), cert: h.cert, because: h.because.map((k) => (owned.get(k) || {}).title).filter(Boolean).slice(0, 2) };

  return { hero, rows, total: pool.length, builtAt: recs.data.builtAt };
}

async function title(type, id) {
  if (!TYPES.includes(type) || !/^\d+$/.test(String(id))) return null;
  const key = `${type}:${id}`;
  const d = await getDetails(type, Number(id));
  if (!d) return null;
  const item = poolMap.get(key);
  const owned = library.owned();
  let rating = null;
  if (d.imdb) {
    const r = recs.data.ratings[d.imdb];
    if (r) rating = { rating: r[0], votes: r[1] };
    else rating = (await imdb.ratingsFor(new Set([d.imdb]))).get(d.imdb) || null;
  }
  const j = judge(d, rating, owned);
  const ownedMap = ownedByKey();
  const because = (item ? item.because : []).map((k) => ownedMap.get(k)).filter(Boolean).slice(0, 6).map((o) => ({ title: o.title, year: o.year }));
  const more = (await cachedList(`rec:${key}`, 21, async () => (await tmdb.get(`/${type}/${id}/recommendations`)).results))
    .map((r) => poolMap.get(`${type}:${r.id}`)).filter((i) => i && !marks.data.hidden.includes(i.key)).map(card);
  return {
    ...d, key, genres: j.genres.map((g) => byId.get(g).name), rating: j.rating, votes: j.votes, quality: j.score ?? null, source: j.source || null,
    recommended: Boolean(item), reason: j.ok ? null : j.reason, owned: Boolean(j.owned), because, more,
    hidden: marks.data.hidden.includes(key), inList: marks.data.watchlist.includes(key),
  };
}

async function search(q) {
  const n = library.norm(q);
  if (n.length < 2) return { recommended: [], other: [] };
  const recommended = recs.data.pool.filter((i) => library.norm(i.title).includes(n)).slice(0, 40).map(card);
  let other = [];
  if (tmdb.configured()) {
    const r = await tmdb.get('/search/multi', { query: q, include_adult: false }).catch(() => null);
    const owned = library.owned();
    other = ((r && r.results) || []).filter((x) => TYPES.includes(x.media_type) && !poolMap.has(`${x.media_type}:${x.id}`)).slice(0, 20).map((x) => {
      const type = x.media_type;
      const year = yearOf(x.release_date || x.first_air_date);
      const isOwned = owned.ids[type].has(x.id) || owned.has(type, x.title || x.name, year);
      return { key: `${type}:${x.id}`, type, id: x.id, title: x.title || x.name, year, poster: x.poster_path || null, rating: null, owned: isOwned };
    });
  }
  return { recommended, other };
}

function mark(key, list, on) {
  if (!['hidden', 'watchlist'].includes(list) || !/^(movie|tv):\d+$/.test(key)) return false;
  marks.data[list] = marks.data[list].filter((k) => k !== key);
  if (on) marks.data[list].unshift(key);
  if (on && list === 'hidden') marks.data.watchlist = marks.data.watchlist.filter((k) => k !== key);
  marks.save();
  return true;
}

function hiddenList() {
  return marks.data.hidden.map((k) => {
    const i = poolMap.get(k) || details.data.items[k];
    return i ? { key: k, type: i.type, id: i.id, title: i.title, year: i.year || yearOf(i.date), poster: i.poster } : null;
  }).filter(Boolean);
}

function info() {
  const counts = { movie: 0, tv: 0 };
  for (const i of recs.data.pool) counts[i.type] += 1;
  return {
    build: { ...status, libraryProgress: library.getProgress() }, builtAt: recs.data.builtAt, seconds: recs.data.seconds, counts, stats: recs.data.stats,
    tmdb: { configured: tmdb.configured(), source: tmdb.keySource(), problem: status.tmdbProblem, calls: tmdb.stats.calls, errors: tmdb.stats.errors, lastError: tmdb.stats.lastError },
    imdb: { ...imdb.info }, cached: { details: Object.keys(details.data.items).length, lists: Object.keys(lists.data.items).length },
    rules: { minYear: config.minYear, minImdb: config.minImdb, minVotes: config.minVotes }, hidden: hiddenList(),
  };
}

const genreList = () => GENRES.map((g) => ({ id: g.id, name: g.name, fav: FAVOURITES.includes(g.id) }));

module.exports = { build, home, title, search, mark, info, genreList, status };
