const express = require('express');
const crypto = require('crypto');
const path = require('path');
const config = require('./src/config');
const jsonfile = require('./src/jsonfile');
const engine = require('./src/engine');

const app = express();
app.set('trust proxy', config.trustProxy);
app.use(express.json({ limit: '20kb' }));

// ---------- Signing in: one password (APP_PASSWORD), sessions last 90 days ----------
const DAY = 24 * 3600 * 1000;
const sessions = jsonfile.open('sessions.json', { list: {} });
const sha = (text) => crypto.createHash('sha256').update(String(text)).digest();
const tokenOf = (req) => (/(?:^|;\s*)nw_s=([a-f0-9]{64})/.exec(req.headers.cookie || '') || [])[1];
const signedIn = (req) => {
  if (config.noLogin) return true;
  const s = sessions.data.list[tokenOf(req)];
  return Boolean(s && s.until > Date.now());
};
const wrong = [];

app.get('/healthz', (req, res) => res.send('ok'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
for (const file of ['css/login.css', 'img/icon.svg']) app.get(`/${file}`, (req, res) => res.sendFile(path.join(__dirname, 'public', file)));

app.post('/api/login', (req, res) => {
  const now = Date.now();
  while (wrong.length && now - wrong[0] > 15 * 60 * 1000) wrong.shift();
  if (wrong.length >= 15) return res.status(429).json({ error: 'Too many wrong passwords. Wait 15 minutes.' });
  if (!config.password) return res.status(503).json({ error: 'No APP_PASSWORD is set in the .env file on the NAS yet.' });
  if (!crypto.timingSafeEqual(sha(req.body.password || ''), sha(config.password))) { wrong.push(now); return res.status(401).json({ error: 'Wrong password.' }); }
  for (const [t, s] of Object.entries(sessions.data.list)) if (s.until < now) delete sessions.data.list[t];
  const token = crypto.randomBytes(32).toString('hex');
  sessions.data.list[token] = { until: now + 90 * DAY };
  sessions.save();
  res.setHeader('Set-Cookie', `nw_s=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${90 * 24 * 3600}${config.cookieSecure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.post('/logout', (req, res) => {
  delete sessions.data.list[tokenOf(req)];
  sessions.save();
  res.setHeader('Set-Cookie', 'nw_s=; Path=/; HttpOnly; Max-Age=0');
  res.redirect('/login');
});

app.use((req, res, next) => {
  if (signedIn(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sign in first.' });
  res.redirect('/login');
});

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

// ---------- The app ----------
const version = { id: process.env.APP_VERSION || 'dev', title: process.env.APP_VERSION_TITLE || '', date: process.env.APP_VERSION_DATE || '' };
const fail = (res, err) => { console.error(err); res.status(err.status === 401 ? 502 : 500).json({ error: err.status === 401 ? 'TMDB refused the key. Check TMDB_API_KEY.' : err.message }); };

app.get('/api/home', (req, res) => {
  const type = ['movie', 'tv', 'anime'].includes(req.query.type) ? req.query.type : 'all';
  const genre = String(req.query.genre || '');
  const lib = require('./src/library').summary();
  const library = { scannedAt: lib.scannedAt, problems: lib.problems, movies: lib.movie.total, shows: lib.tv.total };
  res.json({ ...engine.home({ type, genre }), imageBase: config.imageBase, genres: engine.genreList(), info: engine.info(), library, login: !config.noLogin, version });
});

app.get('/api/title/:type/:id', async (req, res) => {
  try {
    const t = await engine.title(req.params.type, req.params.id);
    if (!t) return res.status(404).json({ error: 'TMDB does not know this title.' });
    res.json({ ...t, imageBase: config.imageBase });
  } catch (err) { fail(res, err); }
});

app.get('/api/search', async (req, res) => {
  try { res.json(await engine.search(String(req.query.q || '').slice(0, 100))); } catch (err) { fail(res, err); }
});

app.post('/api/mark', (req, res) => {
  if (!engine.mark(String(req.body.key || ''), String(req.body.list || ''), Boolean(req.body.on))) return res.status(400).json({ error: 'Unknown title or list.' });
  res.json({ ok: true });
});

app.get('/api/status', (req, res) => {
  const library = require('./src/library').summary();
  res.json({ ...engine.info(), library, version, login: !config.noLogin });
});

app.get('/api/progress', (req, res) => {
  const i = engine.info();
  res.json({ build: i.build, builtAt: i.builtAt });
});

app.post('/api/tmdb-key', async (req, res) => {
  const problem = await require('./src/tmdb').saveKey(req.body.key);
  if (problem) return res.status(400).json({ error: problem });
  engine.build();
  res.json({ ok: true });
});

app.post('/api/rebuild', (req, res) => {
  engine.build();
  res.status(202).json({ running: true });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

const server = app.listen(config.port, () => {
  console.log(`Jaegger's Movie & TV Show recommendations is running on http://localhost:${config.port}`);
  if (!config.password && !config.noLogin) console.log('No APP_PASSWORD set: nobody can sign in until it is filled in.');
});

// Build right after starting, then every few hours (the NAS folders are read again each time).
setTimeout(() => engine.build(), 3000);
setInterval(() => engine.build(), config.refreshEveryHours * 3600 * 1000);

function stop() { jsonfile.flushAll(); server.close(); process.exit(0); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
