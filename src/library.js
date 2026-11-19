// Reads the movie and TV folders on the NAS and works out which TMDB title each folder is.
// Only looks; never changes anything in the folders (they are mounted read-only anyway).
const fs = require('fs');
const path = require('path');
const config = require('./config');
const tmdb = require('./tmdb');
const jsonfile = require('./jsonfile');

const VIDEO = /\.(mkv|mp4|avi|m4v|mov|wmv|ts|m2ts|mpe?g|iso|webm|flv|divx|vob|rmvb)$/i;
const SKIP = /^(\.|@|#)|^(extras?|featurettes?|behind the scenes|deleted scenes|trailers?|samples?|subs?|subtitles|specials|interviews|shorts|other|lost\+found|\$recycle\.bin|system volume information)$/i;
const JUNK = /\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr10?|dv|dolby ?vision|bluray|blu-ray|bdrip|brrip|bdremux|remux|webrip|web-?dl|web|hdtv|dvdrip|dvdscr|hdrip|xvid|divx|x264|x265|h ?264|h ?265|hevc|avc|aac|ac3|dts|ddp?5 ?1|atmos|truehd|10bit|proper|repack|extended|unrated|directors cut|remastered|imax|multi|dual|subbed|dubbed|complete|internal|limited)\b/i;

// Edition words after a title, outside brackets: "Aliens DC (1986)", "Blade Runner Final Cut".
const EDITION = /\s+(dc|director['’]?s? cut|extended( edition| cut| version)?|unrated( cut| edition)?|uncut|theatrical( cut| version| edition)?|final cut|ultimate( cut| edition)?|special edition|collectors edition|anniversary edition|\d+(th)? anniversary( edition)?|remastered|restored|imax( edition)?|redux|criterion( collection)?|open matte|coda cut|black and white edition|chrome edition|noir edition|complete series)$/i;
// Raise this when the way names are read changes: every folder is then matched again.
const PARSER_VERSION = 2;

const store = jsonfile.open('library.json', { movie: {}, tv: {}, scannedAt: null, problems: [], libraries: [] });

/** Plain text used to compare titles: lower case, no accents or punctuation. */
function norm(title) {
  return String(title || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/^(the|a|an) /, '').trim();
}

/** "The.Dark.Knight.2008.1080p.BluRay.mkv" or "The Dark Knight (2008) {tmdb-155}" -> title, year and ids. */
function parseName(raw, type) {
  let s = String(raw).replace(VIDEO, '');
  const ids = {};
  const tm = /(?:\{tmdb-|\[tmdbid[-=]|tmdbid[-=]|\{tmdbid-)(\d+)/i.exec(s); if (tm) ids.tmdb = Number(tm[1]);
  const im = /(tt\d{7,9})/i.exec(s); if (im) ids.imdb = im[1].toLowerCase();
  s = s.replace(/\{[^}]*\}|\[[^\]]*\]/g, ' ');
  if (type === 'tv') s = s.replace(/[\s._-]+(s\d{1,2}(e\d{1,3})?|season[\s._-]*\d+)\b.*$/i, '');
  if (!/\s/.test(s.trim()) && /[._]/.test(s)) s = s.replace(/[._]/g, ' '); // release style: dots instead of spaces
  s = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  let year = null;
  let title = s;
  const paren = [...s.matchAll(/\((19\d{2}|20\d{2})\)/g)].pop();
  if (paren) {
    year = Number(paren[1]); title = s.slice(0, paren.index);
  } else {
    // The last year-like word that is not the very first word ("1917 2019 1080p" -> 1917, 2019).
    const words = [...s.matchAll(/(?:^|[\s(.-])((?:19|20)\d{2})(?=$|[\s).-])/g)].filter((m) => m.index > 0);
    const junk = JUNK.exec(s);
    const before = words.filter((m) => !junk || m.index < junk.index);
    const pick = before.pop();
    if (pick) { year = Number(pick[1]); title = s.slice(0, pick.index); } else if (junk) title = s.slice(0, junk.index);
  }
  title = title.replace(JUNK, ' ').replace(/[\s\-–:,(]+$/g, '').replace(/^[\s\-–]+/, '').replace(/\s+/g, ' ').trim();
  // Strip edition words, unless nothing real would be left ("The Final Cut" stays "The Final Cut").
  for (let i = 0; i < 3 && EDITION.test(title); i += 1) {
    const rest = title.replace(EDITION, '').replace(/[\s\-–:,]+$/, '').trim();
    if (['', 'the', 'a', 'an'].includes(rest.toLowerCase())) break;
    title = rest;
  }
  if (year && (year < 1900 || year > new Date().getFullYear() + 2)) year = null;
  return { title: title || s, year, ids };
}

async function readdir(dir) {
  try { return await fs.promises.readdir(dir, { withFileTypes: true }); } catch (err) { return { error: err.message }; }
}
async function mtimeOf(full) {
  try { return (await fs.promises.stat(full)).mtimeMs; } catch { return 0; }
}
const isVideoDir = (entries) => entries.some((e) => (e.isFile() && VIDEO.test(e.name)) || /^(VIDEO_TS|BDMV)$/i.test(e.name));

/** Every movie in the folder: one per sub-folder, or per loose video file. Collection folders are opened one level. */
async function listMovies(dir, problems) {
  const out = [];
  const top = await readdir(dir);
  if (top.error) { problems.push(`Movies folder ${dir}: ${top.error}`); return null; }
  for (const e of top) {
    if (SKIP.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isFile()) {
      if (VIDEO.test(e.name) && !/\bsample\b/i.test(e.name)) out.push({ name: e.name, mtime: await mtimeOf(full) });
    } else if (e.isDirectory()) {
      const inside = await readdir(full);
      if (inside.error) continue;
      if (isVideoDir(inside) || !inside.some((x) => x.isDirectory() && !SKIP.test(x.name))) {
        out.push({ name: e.name, mtime: await mtimeOf(full) });
      } else {
        for (const sub of inside) {
          if (!sub.isDirectory() || SKIP.test(sub.name)) continue;
          out.push({ name: sub.name, mtime: await mtimeOf(path.join(full, sub.name)), folder: e.name });
        }
      }
    }
  }
  return out;
}

const seasonOfFile = (name) => { const m = /\bs(\d{1,2})\s?e\d{1,3}\b/i.exec(name) || /\b(\d{1,2})x\d{2}\b/.exec(name); return m ? Number(m[1]) : null; };

/** Which seasons of a show are on the NAS: from "Season 02" / "S02" folders, or from S02E05 in file names. Null when it can't tell. */
async function localSeasons(dir) {
  const inside = await readdir(dir);
  if (inside.error) return null;
  const found = new Set();
  for (const x of inside) {
    if (x.isDirectory()) {
      const m = /^(?:season|series|saison|seizoen|staffel|s)[\s._-]*(\d{1,3})\b/i.exec(x.name) || /[\s._-]s(\d{1,2})(?:[\s._-]|$)/i.exec(x.name);
      if (m) { found.add(Number(m[1])); continue; }
    } else if (x.isFile() && VIDEO.test(x.name)) {
      const n = seasonOfFile(x.name);
      if (n !== null) found.add(n);
    }
  }
  found.delete(0); // specials
  return found.size ? [...found].sort((a, b) => a - b) : null;
}

/** Every show in the TV folder: one per sub-folder (loose episode files are grouped by show name). */
async function listShows(dir, problems) {
  const out = [];
  const top = await readdir(dir);
  if (top.error) { problems.push(`TV folder ${dir}: ${top.error}`); return null; }
  const loose = new Map();
  for (const e of top) {
    if (SKIP.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push({ name: e.name, mtime: await mtimeOf(full), seasons: await localSeasons(full) });
    else if (e.isFile() && VIDEO.test(e.name)) {
      const show = parseName(e.name, 'tv').title;
      if (!loose.has(show)) loose.set(show, { name: show, mtime: await mtimeOf(full), seasons: [] });
      const n = seasonOfFile(e.name);
      if (n && !loose.get(show).seasons.includes(n)) loose.get(show).seasons.push(n);
    }
  }
  for (const l of loose.values()) l.seasons = l.seasons.length ? l.seasons.sort((a, b) => a - b) : null;
  return out.concat([...loose.values()]);
}

const EPISODE = /\bs\d{1,2}\s?e\d{1,3}\b|\b\d{1,2}x\d{2}\b|\bepisode\b|\bep\s?\d+|\s-\s(?!(19|20)\d{2}\b)\d{2,4}\b/i;
const SEASON_DIR = /^(season|series|saison|seizoen|staffel|s)\s*\d+|^specials$/i;

/** A library that mixes movies and shows (anime, Korean, biographies...): a folder with seasons or episodes is a show. */
async function listMixed(dir, lib, depth = 0) {
  const out = [];
  const top = await readdir(dir);
  if (top.error) return out;
  for (const e of top) {
    if (SKIP.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isFile()) {
      if (!VIDEO.test(e.name) || /\bsample\b/i.test(e.name)) continue;
      if (EPISODE.test(e.name)) out.push({ type: 'tv', name: parseName(e.name, 'tv').title, mtime: await mtimeOf(full), lib, loose: true, seasons: seasonOfFile(e.name) ? [seasonOfFile(e.name)] : null });
      else out.push({ type: 'movie', name: e.name, mtime: await mtimeOf(full), lib });
      continue;
    }
    if (!e.isDirectory()) continue;
    const inside = await readdir(full);
    if (inside.error) continue;
    const videos = inside.filter((x) => x.isFile() && VIDEO.test(x.name) && !/\bsample\b/i.test(x.name));
    const isShow = inside.some((x) => x.isDirectory() && SEASON_DIR.test(x.name)) || videos.filter((x) => EPISODE.test(x.name)).length >= 2 || videos.length >= 4;
    if (isShow) out.push({ type: 'tv', name: e.name, mtime: await mtimeOf(full), lib, seasons: await localSeasons(full) });
    else if (isVideoDir(inside)) out.push({ type: 'movie', name: e.name, mtime: await mtimeOf(full), lib });
    else if (depth === 0) out.push(...(await listMixed(full, `${lib}/${e.name}`, 1))); // a collection folder
  }
  // Loose episode files of the same show count once.
  const seen = new Set();
  const merged = new Map();
  return out.filter((x) => {
    if (!x.loose) return true;
    const k = `${x.lib}|${x.name}`;
    if (seen.has(k)) { const first = merged.get(k); for (const n of x.seasons || []) if (!(first.seasons || []).includes(n)) first.seasons = [...(first.seasons || []), n].sort((a, b) => a - b); return false; }
    seen.add(k); merged.set(k, x); return true;
  });
}

/** The other libraries next to the movies and TV folders (only when the whole libraries folder is shared with the app). */
async function listOtherLibraries() {
  const root = config.libraryRoot;
  const top = await readdir(root);
  if (top.error) return [];
  const main = new Set([path.resolve(config.moviesDir), path.resolve(config.tvDir)]);
  const out = [];
  for (const e of top) {
    if (!e.isDirectory() || SKIP.test(e.name) || config.ignoreLibraries.test(e.name)) continue;
    const full = path.join(root, e.name);
    if (main.has(path.resolve(full))) continue;
    out.push({ lib: e.name, items: await listMixed(full, e.name) });
  }
  return out;
}

function bestMatch(results, wanted, type) {
  if (!results || !results.length) return null;
  const want = norm(wanted.title);
  const yearOf = (r) => Number(String(type === 'tv' ? r.first_air_date : r.release_date).slice(0, 4)) || null;
  const scored = results.slice(0, 10).map((r, i) => {
    const names = [r.title, r.name, r.original_title, r.original_name].filter(Boolean).map(norm);
    let score = 10 - i;
    if (names.includes(want)) score += 30;
    else if (names.some((n) => n.startsWith(want) || want.startsWith(n))) score += 10;
    const y = yearOf(r);
    if (wanted.year && y) score += Math.abs(y - wanted.year) === 0 ? 25 : Math.abs(y - wanted.year) === 1 ? 15 : -10;
    score += Math.min(10, Math.log10((r.vote_count || 0) + 1) * 3);
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].score >= 20 ? scored[0].r : null;
}

async function matchOne(type, entry) {
  const p = parseName(entry.name, type);
  entry.title = p.title; entry.year = p.year;
  let found = null;
  if (p.ids.tmdb) found = await tmdb.get(`/${type}/${p.ids.tmdb}`);
  if (!found && p.ids.imdb) {
    const r = await tmdb.get(`/find/${p.ids.imdb}`, { external_source: 'imdb_id' });
    found = r && (type === 'tv' ? r.tv_results : r.movie_results)[0];
  }
  if (!found && p.title) {
    const yearKey = type === 'tv' ? 'first_air_date_year' : 'primary_release_year';
    let r = await tmdb.get(`/search/${type}`, { query: p.title, [yearKey]: p.year || undefined, include_adult: false });
    found = bestMatch(r && r.results, p, type);
    if (!found && p.year) {
      r = await tmdb.get(`/search/${type}`, { query: p.title, include_adult: false });
      found = bestMatch(r && r.results, p, type);
    }
    // Last try: drop the last word, but only accept an exact title from the same year.
    const words = p.title.split(' ');
    if (!found && p.year && words.length >= 2) {
      const shorter = { ...p, title: words.slice(0, -1).join(' ') };
      r = await tmdb.get(`/search/${type}`, { query: shorter.title, [yearKey]: p.year, include_adult: false });
      const hit = bestMatch(r && r.results, shorter, type);
      const year = hit && Number(String(hit.release_date || hit.first_air_date || '').slice(0, 4));
      if (hit && [hit.title, hit.name].filter(Boolean).map(norm).includes(norm(shorter.title)) && Math.abs(year - p.year) <= 1) found = hit;
    }
  }
  entry.tried = Date.now();
  if (found) {
    entry.tmdb = found.id;
    entry.matched = found.title || found.name;
    entry.matchedYear = Number(String(found.release_date || found.first_air_date || '').slice(0, 4)) || null;
    entry.poster = found.poster_path || null;
  } else entry.tmdb = null;
}

let progress = null;
const getProgress = () => progress;

/** Reads both folders and matches every new folder name to TMDB. */
async function scan(match = true) {
  const problems = [];
  const lists = { movie: await listMovies(config.moviesDir, problems), tv: await listShows(config.tvDir, problems) };
  const others = await listOtherLibraries();
  const s = store.data;
  if (s.parserVersion !== PARSER_VERSION) {
    for (const type of ['movie', 'tv']) for (const e of Object.values(s[type])) { delete e.tmdb; delete e.tried; delete e.matched; delete e.matchedYear; delete e.poster; }
    s.parserVersion = PARSER_VERSION;
  }
  const libs = [{ name: path.basename(config.moviesDir), movie: (lists.movie || []).length, tv: 0 }, { name: path.basename(config.tvDir), movie: 0, tv: (lists.tv || []).length }];
  for (const type of ['movie', 'tv']) {
    if (!lists[type]) continue; // folder unreachable: keep what we knew
    const next = {};
    for (const e of lists[type]) {
      const key = e.folder ? `${e.folder}/${e.name}` : e.name;
      next[key] = { ...(s[type][key] || {}), name: e.name, mtime: e.mtime, seasons: e.seasons || null };
    }
    for (const { lib, items } of others) {
      for (const e of items.filter((x) => x.type === type)) {
        const key = `${e.lib}/${e.name}`;
        next[key] = { ...(s[type][key] || {}), name: e.name, mtime: e.mtime, lib, seasons: e.seasons || null };
      }
    }
    s[type] = next;
  }
  for (const { lib, items } of others) libs.push({ name: lib, movie: items.filter((x) => x.type === 'movie').length, tv: items.filter((x) => x.type === 'tv').length });
  s.libraries = libs;
  s.scannedAt = new Date().toISOString();
  s.problems = problems;
  store.saveSoon(100);

  if (!match || !tmdb.configured()) return;
  const WEEK = 7 * 24 * 3600 * 1000;
  const todo = [];
  for (const type of ['movie', 'tv']) {
    for (const entry of Object.values(s[type])) {
      if (entry.tmdb) continue;
      if (entry.tried && Date.now() - entry.tried < WEEK && entry.tmdb === null) continue; // not found last week: try again later
      todo.push([type, entry]);
    }
  }
  progress = { done: 0, total: todo.length };
  await Promise.all(todo.map(async ([type, entry]) => {
    try { await matchOne(type, entry); } catch (err) { entry.error = err.message; }
    progress.done += 1;
    if (progress.done % 50 === 0) store.saveSoon(1000);
  }));
  progress = null;
  store.save();
}

function entries(type) { return Object.values(store.data[type] || {}); }

/** What you already have: TMDB ids, plus title+year of folders that could not be matched. */
/** "Kill Bill: Vol. 1" -> "kill bill", "The Godfather Part III" -> "godfather": the name of the series a movie belongs to. */
function seriesName(title) {
  return norm(String(title || '').split(/[:–—(]|\s-\s/)[0])
    .replace(/\s+(vol|volume|part|chapter|episode|book)\s*[\divxlc]+$/, '').replace(/\s+([\d]+|[ivx]+)$/, '').trim();
}

function owned() {
  const ids = { movie: new Set(), tv: new Set() };
  const titles = new Set();
  const series = new Set();
  for (const type of ['movie', 'tv']) {
    for (const e of entries(type)) {
      if (e.tmdb) ids[type].add(e.tmdb);
      const p = parseName(e.name, type);
      titles.add(`${type}:${norm(p.title)}:${p.year || ''}`);
      if (e.matched) titles.add(`${type}:${norm(e.matched)}:${e.matchedYear || ''}`);
      if (type === 'movie') for (const t of [p.title, e.matched]) { const n = seriesName(t); if (n.length >= 3) series.add(n); }
    }
  }
  const has = (type, title, year) => {
    const k = `${type}:${norm(title)}:`;
    return titles.has(k) || (year && (titles.has(k + year) || titles.has(k + (year - 1)) || titles.has(k + (year + 1))));
  };
  return { ids, has, series };
}

/** Seasons on the NAS of a show you have (null when unknown or not yours). */
function seasonsOf(id) {
  const e = entries('tv').find((x) => x.tmdb === Number(id));
  return e ? e.seasons || null : null;
}

const isAnimeLibrary = (lib) => /anime|manga/i.test(lib || '');

function summary() {
  const s = store.data;
  const count = (type) => {
    const list = entries(type);
    return { total: list.length, matched: list.filter((e) => e.tmdb).length, unmatched: list.filter((e) => !e.tmdb).map((e) => (e.lib ? `${e.lib}: ${e.name}` : e.name)).sort() };
  };
  return { scannedAt: s.scannedAt, problems: s.problems, movie: count('movie'), tv: count('tv'), dirs: { movie: config.moviesDir, tv: config.tvDir }, libraries: s.libraries || [] };
}

module.exports = { scan, entries, owned, summary, parseName, norm, seriesName, listMixed, localSeasons, seasonsOf, isAnimeLibrary, getProgress };
