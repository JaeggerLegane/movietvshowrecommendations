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

const store = jsonfile.open('library.json', { movie: {}, tv: {}, scannedAt: null, problems: [] });

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

/** Every show in the TV folder: one per sub-folder (loose episode files are grouped by show name). */
async function listShows(dir, problems) {
  const out = [];
  const top = await readdir(dir);
  if (top.error) { problems.push(`TV folder ${dir}: ${top.error}`); return null; }
  const loose = new Map();
  for (const e of top) {
    if (SKIP.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push({ name: e.name, mtime: await mtimeOf(full) });
    else if (e.isFile() && VIDEO.test(e.name)) {
      const show = parseName(e.name, 'tv').title;
      if (!loose.has(show)) loose.set(show, { name: show, mtime: await mtimeOf(full) });
    }
  }
  return out.concat([...loose.values()]);
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
  const s = store.data;
  for (const type of ['movie', 'tv']) {
    if (!lists[type]) continue; // folder unreachable: keep what we knew
    const next = {};
    for (const e of lists[type]) {
      const key = e.folder ? `${e.folder}/${e.name}` : e.name;
      next[key] = { ...(s[type][key] || {}), name: e.name, mtime: e.mtime };
    }
    s[type] = next;
  }
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
function owned() {
  const ids = { movie: new Set(), tv: new Set() };
  const titles = new Set();
  for (const type of ['movie', 'tv']) {
    for (const e of entries(type)) {
      if (e.tmdb) ids[type].add(e.tmdb);
      const p = parseName(e.name, type);
      titles.add(`${type}:${norm(p.title)}:${p.year || ''}`);
      if (e.matched) titles.add(`${type}:${norm(e.matched)}:${e.matchedYear || ''}`);
    }
  }
  const has = (type, title, year) => {
    const k = `${type}:${norm(title)}:`;
    return titles.has(k) || (year && (titles.has(k + year) || titles.has(k + (year - 1)) || titles.has(k + (year + 1))));
  };
  return { ids, has };
}

function summary() {
  const s = store.data;
  const count = (type) => {
    const list = entries(type);
    return { total: list.length, matched: list.filter((e) => e.tmdb).length, unmatched: list.filter((e) => !e.tmdb).map((e) => e.name).sort() };
  };
  return { scannedAt: s.scannedAt, problems: s.problems, movie: count('movie'), tv: count('tv'), dirs: { movie: config.moviesDir, tv: config.tvDir } };
}

module.exports = { scan, entries, owned, summary, parseName, norm, getProgress };
