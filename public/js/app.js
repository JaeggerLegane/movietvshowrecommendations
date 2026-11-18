'use strict';
// Next Watch: home with rows of posters, a page per title (like Plex), search and a status page.
// Pages: #/ (home)  #/movie/123  #/tv/123  #/search/text  #/status

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const saved = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* only for this visit */ } };
let IMG = saved('imageBase', 'https://image.tmdb.org/t/p/');
const setImageBase = (b) => { if (b && b !== IMG) { IMG = b; save('imageBase', b); } };

const state = { type: saved('type', 'all'), genre: saved('genre', ''), home: null, homeKey: null, homeScroll: 0, builtAt: null, polling: null, route: null };

async function api(path, options) {
  const res = await fetch(path, options);
  if (res.status === 401) { location.href = '/login'; throw new Error('Sign in first.'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Something went wrong (${res.status}).`);
  return body;
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

// ---------- Small helpers ----------
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const runtime = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);
const votes = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');
const langName = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code); } catch { return code; } };
const countryName = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code); } catch { return code; } };
const list = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

function badge(i) {
  if (i.rating != null) return `<span class="badge"><b>IMDb</b>${Number(i.rating).toFixed(1)}</span>`;
  if (i.quality != null) return `<span class="badge tmdb"><b>TMDB</b>${Number(i.quality).toFixed(1)}</span>`;
  return '';
}
function subline(i) {
  const parts = [i.year];
  if (i.type === 'tv') parts.push(i.seasons ? plural(i.seasons, 'season') : 'TV show');
  else if (i.runtime) parts.push(runtime(i.runtime));
  return parts.filter(Boolean).join(' · ');
}
function posterImg(path, size, alt) {
  return path ? `<img loading="lazy" src="${IMG}${size}${esc(path)}" alt="${esc(alt || '')}">` : `<div class="noimg">${esc(alt || '')}</div>`;
}
function cardHtml(i, extraTag) {
  const tag = extraTag || (i.owned ? '<span class="tag">On your NAS</span>' : '');
  return `<a class="card" href="#/${i.type}/${i.id}" title="${esc(i.title)}"><div class="poster">${posterImg(i.poster, 'w342', i.title)}${badge(i)}${tag}</div><div class="cap"><b>${esc(i.title)}</b><span>${esc(subline(i))}</span></div></a>`;
}
const track = (inner) => `<div class="track-wrap"><button class="arrow left" aria-label="Scroll left" disabled>‹</button><div class="track">${inner}</div><button class="arrow right" aria-label="Scroll right">›</button></div>`;
const rowHtml = (title, items) => `<section class="row"><h2>${esc(title)}</h2>${track(items.map((i) => cardHtml(i)).join(''))}</section>`;

function ratingHtml(rating, n, quality, source) {
  if (rating != null) return `<span class="imdb"><b>IMDb</b>${Number(rating).toFixed(1)}${n ? ` <small>${votes(n)} votes</small>` : ''}</span>`;
  if (quality != null && source === 'tmdb') return `<span class="imdb tmdb"><b>TMDB</b>${Number(quality).toFixed(1)}</span>`;
  return '';
}

// ---------- Rows: arrows and keeping their buttons right ----------
function syncArrows(t) {
  const wrap = t.parentElement;
  const [left, right] = [wrap.querySelector('.arrow.left'), wrap.querySelector('.arrow.right')];
  if (!left) return;
  left.disabled = t.scrollLeft < 8;
  right.disabled = t.scrollLeft + t.clientWidth >= t.scrollWidth - 8;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('.arrow');
  if (!a) return;
  const t = a.parentElement.querySelector('.track');
  t.scrollBy({ left: (a.classList.contains('left') ? -1 : 1) * t.clientWidth * 0.85, behavior: 'smooth' });
});
document.addEventListener('scroll', (e) => { if (e.target.classList && e.target.classList.contains('track')) syncArrows(e.target); }, true);
const syncAll = (root) => root.querySelectorAll('.track').forEach(syncArrows);
window.addEventListener('resize', () => syncAll(document));

// ---------- Top bar ----------
function renderTypes() {
  for (const b of $('types').children) b.setAttribute('aria-pressed', String(b.dataset.type === state.type));
}
$('types').addEventListener('click', (e) => {
  const type = e.target.dataset.type;
  if (!type || type === state.type) return;
  state.type = type; save('type', type); renderTypes();
  if (state.route !== 'home') location.hash = '#/'; else loadHome();
});

function renderChips(genres) {
  const chip = (id, name, fav) => `<button class="chip${fav ? ' fav' : ''}" data-genre="${esc(id)}" aria-pressed="${state.genre === id}">${esc(name)}</button>`;
  $('chips').innerHTML = chip('', 'All genres') + genres.filter((g) => g.fav).map((g) => chip(g.id, g.name, true)).join('') + genres.filter((g) => !g.fav).map((g) => chip(g.id, g.name)).join('');
}
$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  state.genre = b.dataset.genre === state.genre ? '' : b.dataset.genre;
  save('genre', state.genre);
  for (const c of $('chips').children) c.setAttribute('aria-pressed', String(c.dataset.genre === state.genre));
  if (state.route !== 'home') location.hash = '#/'; else { window.scrollTo(0, 0); loadHome(); }
});

let searchTimer = null;
$('q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = $('q').value.trim();
    if (q.length >= 2) location.hash = `#/search/${encodeURIComponent(q)}`;
    else if (!q && state.route === 'search') location.hash = '#/';
  }, 350);
});
$('searchForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('q').value.trim(); if (q) location.hash = `#/search/${encodeURIComponent(q)}`; });

function showVersion(v) { if (v) $('version').textContent = `Version ${v.id}${v.title ? ` · ${v.title}` : ''}${v.date ? ` · ${when(v.date)}` : ''}`; }

// ---------- Building progress ----------
function progressText(b) {
  if (!b || !b.running) return '';
  const lp = b.libraryProgress;
  if (lp && lp.total) return `Matching your folders with TMDB · ${lp.done} / ${lp.total}`;
  return `${b.step || 'Working'}${b.total ? ` · ${b.done} / ${b.total}` : ''}`;
}
function progressBar(b) {
  const lp = b && b.libraryProgress;
  const [done, total] = lp && lp.total ? [lp.done, lp.total] : [b ? b.done : 0, b ? b.total : 0];
  return `<div class="progress"><div style="width:${total ? Math.round((done / total) * 100) : 4}%"></div></div>`;
}
function setPill(b) {
  const text = progressText(b);
  $('buildPill').hidden = !text;
  $('buildPill').textContent = text ? `Updating · ${text}` : '';
}
function startPolling() {
  if (state.polling) return;
  state.polling = setInterval(async () => {
    try {
      const p = await api('/api/progress');
      setPill(p.build);
      const box = document.querySelector('[data-progress]');
      if (box) box.innerHTML = `<p>${esc(progressText(p.build) || 'Finishing...')}</p>${progressBar(p.build)}`;
      if (!p.build.running) {
        clearInterval(state.polling); state.polling = null;
        if (p.builtAt !== state.builtAt || box) { state.homeKey = null; if (state.route === 'home') loadHome(); }
        if (state.route === 'status') showStatus();
      }
    } catch { /* try again next time */ }
  }, 3000);
}

// ---------- Home ----------
function heroHtml(h) {
  const why = h.because && h.because.length ? `Because you have ${h.because[0]}` : 'Top pick for you';
  const inList = state.home && state.home.rows.some((r) => r.id === 'mylist' && r.items.some((i) => i.key === h.key));
  return `<section class="hero" style="background-image:url('${IMG}w1280${esc(h.backdrop)}')"><div class="hero-body">
    <p class="eyebrow">${esc(why)}</p>
    <h1>${esc(h.title)}</h1>
    <div class="meta">${h.cert ? `<span class="cert">${esc(h.cert)}</span>` : ''}<span>${esc(subline(h))}</span><span>${esc(h.genres.slice(0, 3).join(', '))}</span>${ratingHtml(h.rating, 0, h.quality, h.source)}</div>
    <p class="overview">${esc(h.overview)}</p>
    <div class="buttons"><a class="btn" href="#/${h.type}/${h.id}"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>More info</a>
    <button class="btn ghost" data-mark="watchlist" data-key="${esc(h.key)}" aria-pressed="${inList}">${inList ? '✓ In my list' : '+ My list'}</button></div>
  </div></section>`;
}

function setupHtml(d) {
  const lib = d.library || {};
  const found = lib.scannedAt ? `Next Watch found <b>${plural(lib.movies || 0, 'movie')}</b> and <b>${plural(lib.shows || 0, 'TV show')}</b> in your folders.` : 'Next Watch is reading your folders...';
  return `<div class="center"><div class="panel">
    <h2>Almost there: add a free TMDB key</h2>
    <p>${found}</p>
    ${(lib.problems || []).map((p) => `<p class="warn">${esc(p)}</p>`).join('')}
    <p>To find posters, descriptions and recommendations, the app uses The Movie Database (TMDB). Their key is free:</p>
    <ol>
      <li>Make an account on <a href="https://www.themoviedb.org/signup" target="_blank" rel="noopener"><u>themoviedb.org</u></a>.</li>
      <li>Go to <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener"><u>Settings → API</u></a> and request a key (type: <i>Developer</i>, personal use; any short description is fine).</li>
      <li>Copy the long <b>API Read Access Token</b> and paste it here.</li>
    </ol>
    <form id="keyForm"><input id="tmdbKey" class="keyinput" placeholder="eyJhbGciOi..." autocomplete="off" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #3a3a3a;background:#111;color:#fff;font:inherit">
    <p class="bad" id="keyMsg"></p><button class="btn">Save key and start</button></form>
  </div></div>`;
}

function buildingHtml(info) {
  return `<div class="center"><div class="panel"><h2>Finding your recommendations</h2>
    <p>The first time takes a few minutes: the app reads your folders, looks up every title on TMDB and downloads the IMDb ratings. After that it's quick.</p>
    <div data-progress><p>${esc(progressText(info.build) || 'Starting...')}</p>${progressBar(info.build)}</div></div></div>`;
}

async function loadHome() {
  const key = `${state.type}|${state.genre}`;
  if (state.home && state.homeKey === key) return;
  const box = $('home');
  if (!state.home) box.innerHTML = '<div class="center"><p class="empty">Loading...</p></div>';
  let d;
  try { d = await api(`/api/home?type=${state.type}&genre=${encodeURIComponent(state.genre)}`); } catch (err) { box.innerHTML = `<div class="center"><p class="bad">${esc(err.message)}</p></div>`; return; }
  state.home = d; state.homeKey = key; state.builtAt = d.builtAt; setImageBase(d.imageBase);
  renderChips(d.genres); showVersion(d.version); setPill(d.info.build);
  if (d.info.build.running) startPolling();
  $('chips').classList.toggle('off', !d.info.tmdb.configured);

  if (!d.info.tmdb.configured) { box.innerHTML = setupHtml(d); bindKeyForm(); return; }
  if (!d.rows.length) {
    if (d.info.build.running || !d.builtAt) { box.innerHTML = buildingHtml(d.info); startPolling(); return; }
    const problem = d.info.tmdb.problem || d.info.build.error;
    box.innerHTML = problem
      ? `<div class="center"><div class="panel"><h2>Something went wrong</h2><p class="bad">${esc(problem)}</p><p><a class="btn small" href="#/status">Open the status page</a></p></div></div>`
      : '<div class="center"><p class="empty">Nothing matches this filter yet. Try another genre, or All.</p></div>';
    return;
  }
  box.innerHTML = (d.hero ? heroHtml(d.hero) : '<div style="height:20px"></div>') + `<div class="rows">${d.rows.map((r) => rowHtml(r.title, r.items)).join('')}</div>`;
  syncAll(box);
}

function bindKeyForm() {
  const form = $('keyForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true; $('keyMsg').textContent = '';
    try {
      await post('/api/tmdb-key', { key: $('tmdbKey').value });
      state.homeKey = null; state.home = null;
      if (state.route === 'status') showStatus(); else loadHome();
      startPolling();
    } catch (err) { $('keyMsg').textContent = err.message; btn.disabled = false; }
  });
}

// "My list" and "Not interested" buttons, wherever they are.
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-mark]');
  if (!b) return;
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.disabled = true;
  try {
    await post('/api/mark', { key: b.dataset.key, list: b.dataset.mark, on });
    state.homeKey = null;
    if (b.dataset.mark === 'watchlist') { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '✓ In my list' : '+ My list'; }
    if (b.dataset.reload === 'status') showStatus();
    else if (b.dataset.mark === 'hidden') route();
  } catch (err) { alertText(err.message); }
  b.disabled = false;
});
function alertText(text) { const p = document.createElement('p'); p.className = 'pill'; p.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#300;color:#fbb;z-index:200'; p.textContent = text; document.body.append(p); setTimeout(() => p.remove(), 4000); }

// ---------- Title page ----------
async function showTitle(type, id) {
  const page = $('page');
  page.innerHTML = '<div class="center"><p class="empty">Loading...</p></div>';
  let t;
  try { t = await api(`/api/title/${type}/${id}`); } catch (err) { page.innerHTML = `<div class="center"><div class="panel"><p class="bad">${esc(err.message)}</p><button class="back" data-back>‹ Back</button></div></div>`; return; }
  if (state.route !== 'title') return;
  setImageBase(t.imageBase);
  document.title = `${t.title} · Next Watch`;
  const year = (t.date || '').slice(0, 4);
  const length = t.type === 'tv' ? [t.numSeasons ? plural(t.numSeasons, 'season') : '', t.numEpisodes ? plural(t.numEpisodes, 'episode') : ''].filter(Boolean).join(' · ') : t.runtime ? runtime(t.runtime) : '';
  const status = t.type === 'tv' && t.status ? ({ 'Returning Series': 'Still running', Ended: 'Ended', Canceled: 'Cancelled', 'In Production': 'In production' }[t.status] || t.status) : '';
  let why;
  if (t.owned) why = '<p class="why no">Already on your NAS</p>';
  else if (t.hidden) why = `<p class="why no">You marked this as not interested. <button class="btn small ghost" data-mark="hidden" data-key="${esc(t.key)}" aria-pressed="true">Show it again</button></p>`;
  else if (t.recommended) why = `<p class="why">${t.because.length ? `Because you have ${esc(list(t.because.slice(0, 3).map((b) => b.title)))}${t.because.length > 3 ? ` and ${t.because.length - 3} more` : ''}` : 'Picked for your favourite genres'}</p>`;
  else why = `<p class="why no">Not in your recommendations: ${esc(t.reason || 'not found by the last update')}</p>`;
  const directors = t.crew.filter((c) => c.job === 'Director').map((c) => c.name);
  const creators = t.crew.filter((c) => c.job === 'Creator').map((c) => c.name);
  const writers = t.crew.filter((c) => ['Screenplay', 'Writer', 'Novel'].includes(c.job)).map((c) => c.name);
  const credits = [
    directors.length && ['Directed by', list(directors)], creators.length && ['Created by', list(creators)], writers.length && ['Written by', list(writers.slice(0, 3))],
    t.cast.length && ['Starring', list(t.cast.slice(0, 4).map((c) => c.name))], t.networks.length && ['Network', t.networks.join(', ')],
    (t.countries || []).length && ['Country', t.countries.map(countryName).join(', ')], t.language && ['Language', langName(t.language)],
    t.collection && ['Part of', t.collection],
  ].filter(Boolean);

  const seasons = (t.seasons || []).map((s) => `<div class="season"><div class="poster">${posterImg(s.poster || t.poster, 'w342', s.name)}</div><div class="cap"><b>${esc(s.name)}</b><span>${esc([plural(s.episodes || 0, 'episode'), (s.date || '').slice(0, 4)].filter(Boolean).join(' · '))}</span></div></div>`).join('');
  const people = [...t.cast.map((c) => ({ ...c, sub: c.role })), ...t.crew.map((c) => ({ ...c, sub: c.job }))]
    .map((p) => `<div class="person"><div class="face">${p.photo ? `<img loading="lazy" src="${IMG}w185${esc(p.photo)}" alt="">` : esc(p.name.slice(0, 1))}</div><b>${esc(p.name)}</b><span>${esc(p.sub)}</span></div>`).join('');

  page.innerHTML = `<div class="title-page">
    ${t.backdrop ? `<div class="backdrop" style="background-image:url('${IMG}w1280${esc(t.backdrop)}')"></div>` : ''}
    <button class="back" data-back>‹ Back</button>
    <div class="title-grid">
      <div class="poster">${posterImg(t.poster, 'w500', t.title)}</div>
      <div class="title-info">
        <h1>${esc(t.title)}${t.original && t.original !== t.title ? ` <small>${esc(t.original)}</small>` : ''}</h1>
        ${t.tagline ? `<p class="tagline">${esc(t.tagline)}</p>` : ''}
        <div class="meta">${t.cert ? `<span class="cert">${esc(t.cert)}</span>` : ''}<span>${esc(year)}</span><span>${esc(t.genres.join(', '))}</span>${length ? `<span>${esc(length)}</span>` : ''}${status ? `<span>${esc(status)}</span>` : ''}<span>${t.type === 'tv' ? 'TV show' : 'Movie'}</span></div>
        <div class="ratings">${ratingHtml(t.rating, t.votes, t.quality, t.source)}${t.tmdbVotes ? `<span class="imdb tmdb"><b>TMDB</b>${Math.round(t.tmdbRating * 10)}%</span>` : ''}</div>
        <div class="buttons">
          ${t.trailer ? `<button class="btn" data-trailer="${esc(t.trailer)}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Trailer</button>` : ''}
          ${t.owned ? '' : `<button class="btn ghost" data-mark="watchlist" data-key="${esc(t.key)}" aria-pressed="${t.inList}">${t.inList ? '✓ In my list' : '+ My list'}</button>`}
          ${t.owned || t.hidden ? '' : `<button class="btn ghost" data-mark="hidden" data-key="${esc(t.key)}" aria-pressed="false">✕ Not interested</button>`}
        </div>
        ${why}
        <p class="overview">${esc(t.overview || 'No description yet.')}</p>
        <dl class="credits">${credits.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        <div class="links">${t.imdb ? `<a href="https://www.imdb.com/title/${esc(t.imdb)}/" target="_blank" rel="noopener">IMDb</a>` : ''}<a href="https://www.themoviedb.org/${t.type}/${t.id}" target="_blank" rel="noopener">TMDB</a></div>
      </div>
    </div>
    ${seasons ? `<div class="section row"><h2>Seasons</h2>${track(seasons)}</div>` : ''}
    ${people ? `<div class="section row"><h2>Cast &amp; Crew</h2>${track(people)}</div>` : ''}
    ${t.more.length ? `<div class="section row"><h2>More like this</h2>${track(t.more.map((i) => cardHtml(i)).join(''))}</div>` : ''}
  </div>`;
  syncAll(page);
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-back]')) { if (history.length > 1) history.back(); else location.hash = '#/'; }
  const tr = e.target.closest('[data-trailer]');
  if (tr) {
    $('modalBody').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(tr.dataset.trailer)}?autoplay=1&rel=0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen title="Trailer"></iframe>`;
    $('modal').hidden = false;
  }
});
const closeModal = () => { $('modal').hidden = true; $('modalBody').innerHTML = ''; };
$('modalClose').addEventListener('click', closeModal);
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });

// ---------- Search ----------
async function showSearch(q) {
  const page = $('page');
  if ($('q').value.trim() !== q) $('q').value = q;
  page.innerHTML = '<div class="center"><p class="empty">Searching...</p></div>';
  let r;
  try { r = await api(`/api/search?q=${encodeURIComponent(q)}`); } catch (err) { page.innerHTML = `<p class="empty bad">${esc(err.message)}</p>`; return; }
  if (state.route !== 'search') return;
  const parts = [];
  if (r.recommended.length) parts.push(rowHtml(`Recommended for you · "${q}"`, r.recommended));
  if (r.other.length) parts.push(rowHtml('Other titles (not in your recommendations: open one to see why)', r.other));
  page.innerHTML = `<div style="padding-top:10px">${parts.join('') || `<p class="empty">Nothing found for "${esc(q)}".</p>`}</div>`;
  syncAll(page);
}

// ---------- Status ----------
async function showStatus() {
  const page = $('page');
  let s;
  try { s = await api('/api/status'); } catch (err) { page.innerHTML = `<p class="empty bad">${esc(err.message)}</p>`; return; }
  if (state.route !== 'status') return;
  document.title = 'Status · Next Watch';
  showVersion(s.version); setPill(s.build);
  if (s.build.running) startPolling();
  const L = s.library;
  const unmatched = (type, label) => (L[type].unmatched.length ? `<details><summary>${plural(L[type].unmatched.length, `${label} folder`)} not recognised</summary><ul>${L[type].unmatched.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></details>` : '');
  const rejected = Object.entries((s.stats && s.stats.rejected) || {}).sort((a, b) => b[1] - a[1]);
  const keyPanel = s.tmdb.configured
    ? `<p class="${s.tmdb.problem ? 'bad' : 'good'}">${s.tmdb.problem ? esc(s.tmdb.problem) : 'The key works.'}</p><p>Key from: ${s.tmdb.source === 'env' ? 'the .env file on the NAS' : 'this app'}</p>`
    : '<p class="warn">No key yet.</p>';
  page.innerHTML = `<div class="panel-page"><button class="back" data-back>‹ Back</button><h1>Status</h1><div class="panels">
    <div class="panel"><h2>Your NAS</h2>
      <p><span class="big">${L.movie.total}</span> movies · <span class="big">${L.tv.total}</span> TV shows</p>
      <p>Recognised: ${L.movie.matched} movies, ${L.tv.matched} shows. Read ${esc(when(L.scannedAt))}.</p>
      ${(L.problems || []).map((p) => `<p class="bad">${esc(p)}</p>`).join('')}
      <p style="color:#888">${esc(L.dirs.movie)} · ${esc(L.dirs.tv)}</p>
      ${unmatched('movie', 'movie')}${unmatched('tv', 'TV')}
    </div>
    <div class="panel"><h2>Recommendations</h2>
      <p><span class="big">${s.counts.movie}</span> movies · <span class="big">${s.counts.tv}</span> TV shows</p>
      <p>Last update ${esc(when(s.builtAt))}${s.seconds ? ` (took ${Math.round(s.seconds / 60) || '<1'} min)` : ''}. Updates by itself every few hours.</p>
      ${s.build.running ? `<div data-progress><p>${esc(progressText(s.build))}</p>${progressBar(s.build)}</div>` : '<button class="btn small" id="rebuild">Update now</button>'}
      ${s.build.error ? `<p class="bad">${esc(s.build.error)}</p>` : ''}
      ${s.stats && s.stats.candidates ? `<p>${s.stats.candidates} titles found, ${s.stats.detailed} looked up, ${s.stats.kept} kept.</p>` : ''}
      ${rejected.length ? `<details><summary>Why titles were left out</summary><table>${rejected.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table></details>` : ''}
    </div>
    <div class="panel"><h2>Your rules</h2>
      <p>Released in ${s.rules.minYear} or later.</p>
      <p>IMDb ${s.rules.minImdb} or higher (with at least ${s.rules.minVotes} votes), except horror.</p>
      <p>Not already on your NAS. Favourites first: horror, detective, mafia &amp; drugs, war, sci-fi.</p>
    </div>
    <div class="panel"><h2>TMDB</h2>${keyPanel}
      <p>${s.tmdb.calls} requests since the app started${s.tmdb.errors ? `, ${s.tmdb.errors} failed` : ''}.</p>
      ${s.tmdb.lastError ? `<p class="bad" style="font-size:12px">${esc(s.tmdb.lastError)}</p>` : ''}
      ${s.tmdb.source === 'env' ? '' : `<details${s.tmdb.configured ? '' : ' open'}><summary>${s.tmdb.configured ? 'Change the key' : 'Add the key'}</summary><form id="keyForm"><input id="tmdbKey" placeholder="eyJhbGciOi..." autocomplete="off" style="width:100%;margin-top:8px;padding:8px 10px;border-radius:6px;border:1px solid #3a3a3a;background:#111;color:#fff"><p class="bad" id="keyMsg"></p><button class="btn small">Save key</button></form></details>`}
    </div>
    <div class="panel"><h2>IMDb ratings</h2>
      <p>Downloaded ${esc(when(s.imdb.downloadedAt))}. Refreshed once a day.</p>
      ${s.imdb.error ? `<p class="bad">${esc(s.imdb.error)}</p>` : ''}
      <p>Remembered: ${s.cached.details} title details, ${s.cached.lists} TMDB lists.</p>
    </div>
    <div class="panel"><h2>Not interested (${s.hidden.length})</h2>
      ${s.hidden.length ? `<div class="hiddenlist">${s.hidden.map((h) => `<div><a href="#/${h.type}/${h.id}">${esc(h.title)} ${h.year ? `(${h.year})` : ''}</a><button class="btn small ghost" data-mark="hidden" data-key="${esc(h.key)}" data-reload="status" aria-pressed="true">Show again</button></div>`).join('')}</div>` : '<p>Titles you mark as "Not interested" show up here, so you can bring them back.</p>'}
    </div>
    <div class="panel"><h2>App</h2>
      <p>Version ${esc(s.version.id)}${s.version.title ? ` · ${esc(s.version.title)}` : ''}</p>
      <p>${s.version.date ? `Published ${esc(when(s.version.date))}` : ''}</p>
      ${s.login ? '<form method="post" action="/logout"><button class="btn small ghost">Sign out</button></form>' : ''}
    </div>
  </div></div>`;
  const rb = $('rebuild');
  if (rb) rb.addEventListener('click', async () => { rb.disabled = true; await post('/api/rebuild'); setTimeout(showStatus, 600); startPolling(); });
  bindKeyForm();
}

// ---------- Pages ----------
function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const leavingHome = state.route === 'home';
  if (leavingHome) state.homeScroll = window.scrollY;
  const [name, a, b] = hash.split('/');
  const isTitle = (name === 'movie' || name === 'tv') && /^\d+$/.test(a || '');
  const next = isTitle ? 'title' : name === 'search' && a ? 'search' : name === 'status' ? 'status' : 'home';
  state.route = next;
  $('home').hidden = next !== 'home';
  $('page').hidden = next === 'home';
  document.title = 'Next Watch';
  if (next !== 'search' && $('q').value && next === 'home') $('q').value = '';
  if (next === 'home') {
    loadHome().then(() => { if (!leavingHome) window.scrollTo(0, state.homeScroll); });
    return;
  }
  window.scrollTo(0, 0);
  if (next === 'title') showTitle(name, a);
  else if (next === 'search') showSearch(decodeURIComponent(a + (b ? `/${b}` : '')));
  else showStatus();
}
window.addEventListener('hashchange', route);
renderTypes();
route();
