// Talks to The Movie Database (TMDB): posters, descriptions, seasons, cast and "people who liked X also liked Y".
// A few requests at a time, with retries; TMDB allows about 40 per second.
const config = require('./config');
const jsonfile = require('./jsonfile');

// The key comes from TMDB_API_KEY in .env, or else from what was pasted on the app's Status page.
const settings = jsonfile.open('settings.json', {});
const key = () => config.tmdbKey || settings.data.tmdbKey || '';

const MAX_PARALLEL = 8;
let running = 0;
const waiting = [];
const stats = { calls: 0, errors: 0, lastError: null };

function slot() {
  if (running < MAX_PARALLEL) { running += 1; return Promise.resolve(); }
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else running -= 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const configured = () => Boolean(key());

async function get(pathname, params = {}, useKey = key()) {
  if (!useKey) throw new Error('No TMDB key');
  const url = new URL(config.tmdbBase + pathname);
  const bearer = useKey.startsWith('eyJ');
  if (!bearer) url.searchParams.set('api_key', useKey);
  if (!('language' in params)) url.searchParams.set('language', config.tmdbLanguage);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const headers = { accept: 'application/json' };
  if (bearer) headers.authorization = `Bearer ${useKey}`;

  await slot();
  try {
    for (let attempt = 1; ; attempt += 1) {
      stats.calls += 1;
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
        if (res.status === 404) return null;
        if (res.status === 429 || res.status >= 500) {
          if (attempt >= 4) throw new Error(`TMDB answered ${res.status}`);
          await sleep((Number(res.headers.get('retry-after')) || attempt) * 1000);
          continue;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw Object.assign(new Error(`TMDB answered ${res.status}: ${body.slice(0, 200)}`), { status: res.status });
        }
        return await res.json();
      } catch (err) {
        if (err.status || attempt >= 4) { stats.errors += 1; stats.lastError = `${new Date().toISOString()} ${pathname}: ${err.message}`; throw err; }
        await sleep(attempt * 1000);
      }
    }
  } finally { release(); }
}

/** Checks the key. Returns null when it works, or the reason it doesn't. */
async function check(useKey = key()) {
  if (!useKey) return 'No TMDB key filled in yet.';
  try { await get('/configuration', { language: '' }, useKey); return null; } catch (err) { return err.status === 401 ? 'TMDB does not accept this key.' : err.message; }
}

/** Saves a key pasted on the Status page, after checking that TMDB accepts it. Returns the problem, or null. */
async function saveKey(newKey) {
  const k = String(newKey || '').trim().replace(/^Bearer\s+/i, '');
  if (!/^[A-Za-z0-9._-]{20,1000}$/.test(k)) return 'That does not look like a TMDB key.';
  const problem = await check(k);
  if (problem) return problem;
  settings.data.tmdbKey = k;
  settings.save();
  return null;
}

const keySource = () => (config.tmdbKey ? 'env' : settings.data.tmdbKey ? 'app' : null);

module.exports = { get, check, configured, saveKey, keySource, stats };
