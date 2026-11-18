// IMDb ratings from IMDb's own free download (datasets.imdbws.com, for personal use), refreshed once a day.
// The file has every rating on IMDb; the app only reads out the titles it needs.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const config = require('./config');

const FILE = path.join(config.dataDir, 'imdb', 'title.ratings.tsv.gz');
const DAY = 24 * 3600 * 1000;
const info = { downloadedAt: null, error: null };

function fileAge() {
  try { const st = fs.statSync(FILE); info.downloadedAt = st.mtime.toISOString(); return Date.now() - st.mtimeMs; } catch { return Infinity; }
}

/** Downloads the ratings file when it is missing or older than a day. Keeps the old file if that fails. */
async function refresh() {
  if (fileAge() < DAY) return;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const res = await fetch(config.imdbRatingsUrl, { signal: AbortSignal.timeout(5 * 60 * 1000) });
    if (!res.ok) throw new Error(`IMDb download answered ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(`${FILE}.tmp`));
    fs.renameSync(`${FILE}.tmp`, FILE);
    info.error = null;
    fileAge();
  } catch (err) {
    info.error = `${new Date().toISOString()} ${err.message}`;
    console.error('IMDb ratings download failed:', err.message);
  }
}

/** Ratings for the given IMDb ids: Map("tt0111161" -> { rating: 9.3, votes: 3000000 }). */
async function ratingsFor(ids) {
  const out = new Map();
  if (!ids.size || !fs.existsSync(FILE)) return out;
  const lines = readline.createInterface({ input: fs.createReadStream(FILE).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    const tab = line.indexOf('\t');
    const id = line.slice(0, tab);
    if (!ids.has(id)) continue;
    const [, rating, votes] = line.split('\t');
    out.set(id, { rating: Number(rating), votes: Number(votes) });
    if (out.size === ids.size) { lines.close(); break; }
  }
  return out;
}

module.exports = { refresh, ratingsFor, info, fileAge };
