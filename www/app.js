'use strict';

/* ================= Estado ================= */
const KEY = 'm3u-colorida-v1';
let state = { lists: [], favs: [] };

/* Almacenamiento en IndexedDB (localStorage se llena con ~5 MB) */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('m3u-colorida-db', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function loadState() {
  try {
    const db = await idb();
    const data = await new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(KEY);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    if (data) {
      state = Object.assign(state, data);
    } else {
      // Migrar datos viejos de localStorage, si existen
      try {
        const old = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (old) { state = Object.assign(state, old); await persist(); localStorage.removeItem(KEY); }
      } catch (e) {}
    }
  } catch (e) {
    toast('No se pudo abrir el almacenamiento: ' + (e.message || e), true);
  }
}

async function persist() {
  const db = await idb();
  await new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(state, KEY);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

let saveChain = Promise.resolve();
function save() {
  saveChain = saveChain.then(persist).catch((e) => toast('No se pudo guardar: ' + (e.message || e), true));
  return saveChain;
}

const ui = { view: 'home', addTab: 'url', listId: 'all', q: '', group: 'all', limit: 120, series: null, dtab: 'rd', dinput: '', dfilter: '', gq: '', gkind: 'all', tmdbRes: [], tmdbFor: '' };
let hls = null;

const NAV = [
  ['home', '🏠 Inicio', '#ff4d6d'],
  ['search', '🔎 Buscar', '#00f5d4'],
  ['add', '➕ Agregar lista', '#ffb703'],
  ['lists', '📚 Mis listas', '#06d6a0'],
  ['channels', '📺 Canales', '#4cc9f0'],
  ['movies', '🎬 Películas', '#ff9e00'],
  ['series', '🍿 Series', '#8338ec'],
  ['debrid', '⚡ Debrid', '#ffd60a'],
  ['favs', '⭐ Favoritos', '#f72585'],
  ['settings', '⚙️ Ajustes', '#b5179e']
];

/* ================= Utilidades ================= */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), 2800);
}

/* ================= Parser M3U ================= */
function parseM3U(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const channels = [];
  let cur = null;
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      cur = { name: '', logo: '', group: '', tvgId: '', url: '' };
      const re = /([\w-]+)="([^"]*)"/g;
      let m;
      while ((m = re.exec(line))) {
        const k = m[1].toLowerCase();
        if (k === 'tvg-logo') cur.logo = m[2];
        else if (k === 'group-title') cur.group = m[2];
        else if (k === 'tvg-id') cur.tvgId = m[2];
        else if (k === 'tvg-name' && !cur.name) cur.name = m[2];
      }
      const i = line.lastIndexOf(',');
      if (i >= 0 && line.slice(i + 1).trim()) cur.name = line.slice(i + 1).trim();
    } else if (line.startsWith('#EXTGRP:') && cur) {
      if (!cur.group) cur.group = line.slice(8).trim();
    } else if (!line.startsWith('#')) {
      if (!cur) cur = { name: line, logo: '', group: '', tvgId: '', url: '' };
      cur.url = line;
      if (!cur.name) cur.name = line;
      channels.push(cur);
      cur = null;
    }
  }
  return channels;
}

async function fetchText(url) {
  if (window.electronAPI) return window.electronAPI.fetchText(url);
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

function addList(name, url, text) {
  const channels = parseM3U(text);
  if (!channels.length) { toast('No se encontraron canales en esa lista', true); return false; }
  state.lists.push({ id: uid(), name: name || 'Lista ' + (state.lists.length + 1), url: url || '', addedAt: Date.now(), channels });
  save();
  toast('✅ Lista agregada: ' + channels.length + ' canales');
  return true;
}

/* ================= Render ================= */
function renderNav() {
  $('#nav').innerHTML = '<div class="brand">📡 M3U Colorida</div>' + NAV.map(([id, label, c]) =>
    `<button class="nav-item ${ui.view === id ? 'active' : ''}" style="--c:${c}" data-act="nav" data-id="${id}">${label}</button>`).join('');
}

/* ================= Control parental ================= */
const ADULT_WORDS = /\b(xxx|porn\w*|erotic\w*|er[oó]tic\w*|hentai|playboy|hustler|brazzers|penthouse|onlyfans|nsfw|para adultos|adults? only|solo adultos|contenido adulto)\b/i;
const ADULT_PLUS = /\+\s?18|18\s?\+/;
const ADULT_GROUP = /\b(adult[oa]?s?|sex\w*)\b/i; // solo se aplica al nombre del grupo, no al título
const adultCache = new WeakMap();
function isAdult(c) {
  let v = adultCache.get(c);
  if (v === undefined) {
    const g = c.group || '', n = c.name || '';
    v = !/adult swim/i.test(g + ' ' + n) &&
      (ADULT_WORDS.test(g) || ADULT_WORDS.test(n) || ADULT_PLUS.test(g) || ADULT_PLUS.test(n) || ADULT_GROUP.test(g));
    adultCache.set(c, v);
  }
  return v;
}
const parentalOn = () => !!(state.parental && state.parental.on);
const vis = (c) => !parentalOn() || ui.unlocked || !isAdult(c);
function hiddenCount() { let n = 0; for (const l of state.lists) for (const c of l.channels) if (isAdult(c)) n++; return n; }

async function pinHash(pin, salt) {
  const data = new TextEncoder().encode(salt + ':' + pin);
  if (window.crypto && crypto.subtle) {
    const b = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; for (const x of data) h = ((h << 5) + h + x) >>> 0; // respaldo si no hay crypto.subtle
  return 'f' + h.toString(16);
}
let pcFails = 0, pcLock = 0;
async function pinOk(pin) {
  if (Date.now() < pcLock) throw new Error('Demasiados intentos. Espera ' + Math.ceil((pcLock - Date.now()) / 1000) + ' s');
  const p = state.parental;
  const ok = !!p && (await pinHash(String(pin || ''), p.salt)) === p.hash;
  if (ok) { pcFails = 0; return true; }
  if (++pcFails >= 5) { pcFails = 0; pcLock = Date.now() + 60000; }
  return false;
}
document.addEventListener('visibilitychange', () => { if (document.hidden && ui.unlocked) { ui.unlocked = false; render(); } });

function allChannels() {
  const lists = ui.listId === 'all' ? state.lists : state.lists.filter((l) => l.id === ui.listId);
  return lists.flatMap((l) => l.channels).filter(vis);
}

// Clasifica cada entrada: live (canales), movie (películas) o series
function kindOf(c) {
  if (c.k) return c.k;
  const u = c.url || '';
  c.k = /\/series\//i.test(u) ? 'series'
    : /\/movie\//i.test(u) || /\.(mkv|mp4|avi|mov)(\?|$)/i.test(u) ? 'movie'
    : 'live';
  return c.k;
}
// "Mi Serie S01 E03" -> "Mi Serie"
function seriesTitle(name) {
  const t = String(name).replace(/[\s\-–|:]*[SsTt]\d{1,3}\s*[-. ]?\s*[EeCc]\d{1,4}.*$/, '').trim();
  return t || String(name);
}
const ICON = { live: '📺', movie: '🎬', series: '🍿' };

function chCard(c) {
  const fav = state.favs.includes(c.url);
  const k = kindOf(c), ico = ICON[k];
  const logo = c.logo ? `<img src="${esc(c.logo)}" loading="lazy" onerror="this.outerHTML='<div class=ph>${ico}</div>'">` : `<div class="ph">${ico}</div>`;
  return `<div class="ch ${k === 'live' ? '' : 'poster'}">${logo}<div class="n">${esc(c.name)}</div><div class="g">${esc(c.group)}</div>
    <div class="row">
      <button class="btn green small" data-act="play" data-url="${esc(c.url)}" data-name="${esc(c.name)}">▶</button>
      <button class="btn ${fav ? 'yellow' : 'pink'} small" data-act="fav" data-url="${esc(c.url)}">${fav ? '★' : '☆'}</button>
      ${k !== 'live' ? `<button class="btn yellow small" title="Buscar en Real-Debrid / TorBox" data-act="deb-find" data-name="${esc(c.name)}">⚡</button>
      <button class="btn pink small" title="Información (TMDB)" data-act="info" data-name="${esc(c.name)}" data-kind="${k}">ℹ️</button>` : ''}
    </div></div>`;
}

function seriesCard(s) {
  const logo = s.logo ? `<img src="${esc(s.logo)}" loading="lazy" onerror="this.outerHTML='<div class=ph>🍿</div>'">` : '<div class="ph">🍿</div>';
  return `<div class="ch poster">${logo}<div class="n">${esc(s.t)}</div><div class="g">${s.n} episodios</div>
    <div class="row"><button class="btn green small" data-act="open-series" data-key="${esc(s.t)}">Ver</button>
    <button class="btn yellow small" title="Buscar en Real-Debrid / TorBox" data-act="deb-find" data-name="${esc(s.t)}">⚡</button>
    <button class="btn pink small" title="Información (TMDB)" data-act="info" data-name="${esc(s.t)}" data-kind="series">ℹ️</button></div></div>`;
}

function browse(kind, favOnly) {
  const titles = { live: '📺 Canales', movie: '🎬 Películas', series: '🍿 Series' };
  const base = favOnly
    ? state.lists.flatMap((l) => l.channels).filter((c) => state.favs.includes(c.url) && vis(c))
    : allChannels().filter((c) => kindOf(c) === kind);
  const more = (n) => (n > ui.limit ? '<button class="btn yellow" data-act="more">Mostrar más</button>' : '');

  // Detalle de una serie: sus episodios
  if (kind === 'series' && !favOnly && ui.series) {
    const eps = base.filter((c) => seriesTitle(c.name) === ui.series)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return `<button class="btn pink small" data-act="back-series">← Series</button><h1>🍿 ${esc(ui.series)}</h1>
      <p class="muted">${eps.length} episodios</p><div class="grid posters">${eps.slice(0, ui.limit).map(chCard).join('')}</div>${more(eps.length)}`;
  }

  const groups = [...new Set(base.map((c) => c.group).filter(Boolean))].sort();
  let chs = base;
  if (ui.group !== 'all') chs = chs.filter((c) => c.group === ui.group);
  if (ui.q) { const q = ui.q.toLowerCase(); chs = chs.filter((c) => c.name.toLowerCase().includes(q)); }

  let cards, total;
  if (kind === 'series' && !favOnly) {
    const map = new Map();
    for (const c of chs) {
      const t = seriesTitle(c.name);
      const s = map.get(t) || { t, logo: c.logo, n: 0 };
      s.n++; if (!s.logo) s.logo = c.logo;
      map.set(t, s);
    }
    const items = [...map.values()].sort((a, b) => a.t.localeCompare(b.t));
    total = items.length;
    cards = items.slice(0, ui.limit).map(seriesCard).join('');
  } else {
    total = chs.length;
    cards = chs.slice(0, ui.limit).map(chCard).join('');
  }

  const filters = favOnly ? '' : `<div class="filters">
    <select data-act="sel-list">${'<option value="all">Todas las listas</option>' + state.lists.map((l) => `<option value="${l.id}" ${ui.listId === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
    <select data-act="sel-group"><option value="all">Todos los grupos</option>${groups.map((g) => `<option ${ui.group === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
    <input id="search" data-act="search" placeholder="🔍 Buscar..." value="${esc(ui.q)}"></div>`;
  const posters = favOnly || kind !== 'live';
  return `<h1>${favOnly ? '⭐ Favoritos' : titles[kind]}</h1><p class="muted">${total} ${kind === 'series' && !favOnly ? 'series' : 'resultados'}</p>${filters}
    <div class="grid${posters ? ' posters' : ''}">${cards || '<p class="muted">Nada por aquí todavía.</p>'}</div>${more(total)}`;
}

/* ================= Reproductores externos (Android) ================= */
const isAndroid = () => !!(window.Capacitor && Capacitor.getPlatform && Capacitor.getPlatform() === 'android');
const PLAYERS = [
  ['auto', 'Automático', 'Elige solo el mejor para cada canal o película.', null],
  ['exo', 'ExoPlayer', 'Rápido y ligero.', null],
  ['builtin', 'Integrado', 'El reproductor de la app. Rápido y ligero.', null],
  ['vlc', 'VLC', 'Abre casi cualquier formato.', 'org.videolan.vlc'],
  ['mpv', 'mpv', 'Máxima calidad de imagen.', 'is.xyz.mpv'],
  ['mx', 'MX Player', 'Muy bueno con películas y subtítulos.', 'com.mxtech.videoplayer.ad'],
  ['system', 'Sistema', 'El reproductor del propio aparato.', '']
];
function extPlugin() {
  const C = window.Capacitor;
  if (!C) return null;
  return (C.Plugins && C.Plugins.ExternalPlayer) || (C.registerPlugin && C.registerPlugin('ExternalPlayer')) || null;
}
async function playExo(url, name) {
  const P = extPlugin();
  if (!P || !P.playExo) { toast('ExoPlayer no está disponible en esta versión. Actualiza el APK.', true); return false; }
  try { await P.playExo({ urls: candidates(url), title: name || '' }); return true; }
  catch (e) { toast('No se pudo abrir ExoPlayer: ' + (e.message || e), true); return false; }
}
async function playExternal(url, name, pkg) {
  const P = extPlugin();
  if (!P) { toast('Reproductor externo no disponible', true); return false; }
  try { await P.play({ url, title: name || '', pkg: pkg || '', fallback: true }); return true; }
  catch (e) { toast('No se pudo abrir: ' + (e.message || e), true); return false; }
}
let lastPlay = null;

/* ================= TMDB ================= */
const TMDB = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';
const tmdbCache = new Map();
async function tmdb(path, params = {}) {
  const key = (state.tmdb || '').trim();
  if (!key) throw new Error('Agrega tu clave de TMDB en Ajustes');
  const p = new URLSearchParams({ language: 'es-MX', ...params });
  const opt = { headers: {} };
  if (/^[a-f0-9]{32}$/i.test(key)) p.set('api_key', key); else opt.headers.Authorization = 'Bearer ' + key;
  const r = await fetch(`${TMDB}${path}?${p}`, opt);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error((d && d.status_message) || 'TMDB HTTP ' + r.status);
  return d;
}
const guessYear = (n) => { const m = String(n).match(/\b(19\d{2}|20\d{2})\b/); return m ? m[1] : ''; };
async function tmdbFind(name, kind) {
  const type = kind === 'series' ? 'tv' : 'movie';
  const title = cleanTitle(kind === 'series' ? seriesTitle(name) : name) || name;
  const yp = type === 'tv' ? 'first_air_date_year' : 'year';
  const year = guessYear(name);
  const params = { query: title };
  if (year) params[yp] = year;
  let d = await tmdb('/search/' + type, params);
  if (!d.results.length && year) { delete params[yp]; d = await tmdb('/search/' + type, params); }
  return d.results[0] ? { id: d.results[0].id, type } : null;
}
function setInfo(html) { const el = $('#info'); el.innerHTML = '<div class="info-box">' + html + '</div>'; el.classList.remove('hidden'); }
function closeInfo() { $('#info').classList.add('hidden'); }
function infoHtml(type, d) {
  const title = d.title || d.name || '';
  const year = (d.release_date || d.first_air_date || '').slice(0, 4);
  const rt = type === 'movie' ? (d.runtime ? d.runtime + ' min' : '') : (d.number_of_seasons ? d.number_of_seasons + ' temporadas' : '');
  const meta = [year, rt, (d.genres || []).map((g) => g.name).join(' · ')].filter(Boolean).join(' · ');
  const cast = ((d.credits && d.credits.cast) || []).slice(0, 6).map((x) => x.name).join(', ');
  const poster = d.poster_path ? `<img class="info-poster" src="${IMG}w342${esc(d.poster_path)}">` : '<div class="info-poster ph">🎬</div>';
  return `<div class="info-top">${poster}<div><h1>${esc(title)}</h1>
      <p class="muted">${esc(meta)}</p>
      ${d.vote_average ? `<p class="rate">⭐ ${d.vote_average.toFixed(1)} <span class="muted">(${d.vote_count} votos)</span></p>` : ''}
      ${d.tagline ? `<p><i>${esc(d.tagline)}</i></p>` : ''}</div></div>
    <p class="overview">${esc(d.overview || 'Sin sinopsis en español.')}</p>
    ${cast ? `<p class="muted"><b>Reparto:</b> ${esc(cast)}</p>` : ''}
    <div class="info-actions">
      <button class="btn green small" data-act="info-search" data-title="${esc(title)}">🔎 Buscar en mis listas</button>
      <button class="btn yellow small" data-act="deb-find" data-name="${esc(title)}">⚡ En mis cuentas Debrid</button>
      <button class="btn red small" data-act="close-info">✕ Cerrar</button></div>
    <p class="muted tmdb-credit">Datos de TMDB.</p>`;
}
async function showTmdb(type, id) {
  const k = type + ':' + id;
  setInfo('<p class="muted">Cargando…</p><button class="btn red small" data-act="close-info">✕ Cerrar</button>');
  try {
    if (!tmdbCache.has(k)) tmdbCache.set(k, await tmdb(`/${type}/${id}`, { append_to_response: 'credits' }));
    setInfo(infoHtml(type, tmdbCache.get(k)));
  } catch (e) {
    setInfo(`<p>⚠️ ${esc(e.message)}</p><button class="btn red small" data-act="close-info">✕ Cerrar</button>`);
  }
}
async function showInfo(name, kind) {
  setInfo('<p class="muted">Buscando en TMDB…</p><button class="btn red small" data-act="close-info">✕ Cerrar</button>');
  try {
    const f = await tmdbFind(name, kind);
    if (!f) return setInfo(`<h2>${esc(name)}</h2><p class="muted">No se encontró en TMDB.</p><button class="btn red small" data-act="close-info">✕ Cerrar</button>`);
    await showTmdb(f.type, f.id);
  } catch (e) {
    setInfo(`<p>⚠️ ${esc(e.message)}</p><button class="btn red small" data-act="close-info">✕ Cerrar</button>`);
  }
}
function tmdbCard(r) {
  const t = r.title || r.name || '';
  const y = (r.release_date || r.first_air_date || '').slice(0, 4);
  const img = r.poster_path ? `<img src="${IMG}w185${esc(r.poster_path)}" loading="lazy">` : '<div class="ph">🎬</div>';
  return `<div class="ch poster">${img}<div class="n">${esc(t)}</div><div class="g">${r.media_type === 'tv' ? 'Serie' : 'Película'}${y ? ' · ' + y : ''}</div>
    <div class="row"><button class="btn pink small" data-act="tmdb-open" data-type="${r.media_type}" data-id="${r.id}">ℹ️ Ver</button></div></div>`;
}

/* ================= Buscador general ================= */
const normCache = new WeakMap();
const normName = (c) => { let n = normCache.get(c); if (n === undefined) { n = nrm(c.name); normCache.set(c, n); } return n; };

function parentalCard() {
  const num = 'type="password" inputmode="numeric" autocomplete="off" maxlength="8"';
  if (!parentalOn()) {
    return `<p class="muted">Oculta los canales, películas y series para adultos (XXX, +18, Adultos…) detrás de un PIN. Se oculta en Canales, Películas, Series, Favoritos y el buscador.</p>
      <input id="pc-pin" ${num} placeholder="Crea un PIN (4 a 8 números)">
      <input id="pc-pin2" ${num} placeholder="Repite el PIN">
      <button class="btn green" data-act="pc-enable">🔒 Activar</button>`;
  }
  return `<p class="muted">${ui.unlocked ? '🔓 Desbloqueado temporalmente (se bloquea al salir de la app).' : '🔒 Activado'} · ${hiddenCount()} elementos adultos en tus listas.</p>
    <input id="pc-cur" ${num} placeholder="PIN actual">
    ${ui.unlocked ? '<button class="btn yellow" data-act="pc-lock">🔒 Bloquear ahora</button>' : '<button class="btn green" data-act="pc-unlock">🔓 Desbloquear</button>'}
    <button class="btn pink" data-act="pc-disable">Desactivar</button>
    <details style="margin-top:12px"><summary class="muted">Cambiar PIN</summary>
      <input id="pc-pin" ${num} placeholder="PIN nuevo (4 a 8 números)">
      <input id="pc-pin2" ${num} placeholder="Repite el PIN nuevo">
      <button class="btn yellow" data-act="pc-change">Guardar PIN nuevo</button></details>`;
}

const views = {
  home() {
    const cnt = { live: 0, movie: 0, series: 0 };
    const seriesSet = new Set();
    const pics = { live: [], movie: [], series: [] };
    const favPics = [];
    let favN = 0;
    state.lists.forEach((l) => l.channels.forEach((c) => {
      if (!vis(c)) return;
      const k = kindOf(c);
      if (state.favs.includes(c.url)) favN++;
      if (k === 'series') seriesSet.add(seriesTitle(c.name)); else cnt[k]++;
      if (c.logo) { pics[k].push(c.logo); if (state.favs.includes(c.url)) favPics.push(c.logo); }
    }));
    cnt.series = seriesSet.size;
    // Muestra repartida a lo largo de la lista (cambia cada vez que entras a Inicio)
    const pick = (arr, n) => {
      const m = Math.min(n, arr.length), out = [];
      for (let i = 0; i < m; i++) out.push(arr[Math.floor(((i + Math.random()) * arr.length) / m)]);
      return out;
    };
    const tile = (c1, c2, num, label, imgs, ico, go) => `<div class="stat" style="--c1:${c1};--c2:${c2}" data-act="nav" data-id="${go}">
      <div class="mosaic">${imgs.map((u) => `<img src="${esc(u)}" loading="lazy" onerror="this.remove()">`).join('')}</div>
      <div class="shade"></div><span class="bg-ico">${ico}</span><b>${num}</b><span class="lbl">${label}</span></div>`;
    return `<h1>¡Bienvenido! 🎉</h1><p class="muted">Agrega tus listas M3U y míralas en un solo lugar.</p>
    <div class="grid">
      ${tile('#ff4d6d', '#f72585', state.lists.length, 'Listas', [...pick(pics.movie, 2), ...pick(pics.series, 2)], '📚', 'lists')}
      ${tile('#06d6a0', '#4cc9f0', cnt.live, 'Canales', pick(pics.live, 4), '📺', 'channels')}
      ${tile('#ff9e00', '#ff4d6d', cnt.movie, 'Películas', pick(pics.movie, 4), '🎬', 'movies')}
      ${tile('#8338ec', '#f72585', cnt.series, 'Series', pick(pics.series, 4), '🍿', 'series')}
      ${tile('#ffb703', '#fb8500', favN, 'Favoritos', pick(favPics, 4), '⭐', 'favs')}
    </div>
    <button class="btn pink" data-act="nav" data-id="add">➕ Agregar mi primera lista</button>
    <button class="btn green" data-act="nav" data-id="channels">📺 Ver canales</button>`;
  },

  add() {
    const tab = (id, l) => `<button class="tab ${ui.addTab === id ? 'active' : ''}" data-act="addtab" data-id="${id}">${l}</button>`;
    let body = '';
    if (ui.addTab === 'url') body = `<label>URL de la lista (.m3u / .m3u8)</label><input id="f-url" placeholder="http://servidor.com/lista.m3u" inputmode="url">
      <button class="btn green" data-act="add-url">⬇️ Descargar y agregar</button>`;
    if (ui.addTab === 'file') body = `<label>Archivo desde tu dispositivo</label><input id="f-file" type="file" accept=".m3u,.m3u8,.txt,audio/x-mpegurl">
      <button class="btn green" data-act="add-file">📂 Importar archivo</button>`;
    if (ui.addTab === 'text') body = `<label>Pega el contenido de la lista</label><textarea id="f-text" placeholder="#EXTM3U&#10;#EXTINF:-1 group-title=&quot;Noticias&quot;,Canal 1&#10;http://..."></textarea>
      <button class="btn green" data-act="add-text">📋 Agregar</button>`;
    return `<h1>➕ Agregar lista</h1><p class="muted">Elige cómo quieres añadir tu lista.</p>
    <div class="card"><div class="tabs">${tab('url', '🌐 URL')}${tab('file', '📂 Archivo')}${tab('text', '📋 Pegar')}</div>
    <label style="display:block;margin-top:16px">Nombre de la lista</label><input id="f-name" placeholder="Mi lista">${body}</div>`;
  },

  lists() {
    const rows = state.lists.map((l) => `<div class="list-row"><div><div class="t">${esc(l.name)}</div>
      <div class="muted">${l.channels.length} canales · ${new Date(l.addedAt).toLocaleDateString()}</div></div>
      <div><button class="btn green small" data-act="open-list" data-id="${l.id}">📺 Ver</button>
      ${l.url ? `<button class="btn yellow small" data-act="refresh" data-id="${l.id}">🔄</button>` : ''}
      <button class="btn pink small" data-act="del-list" data-id="${l.id}">🗑️</button></div></div>`).join('');
    return `<h1>📚 Mis listas</h1>${rows || '<p class="muted card">Aún no hay listas. Ve a “Agregar lista”.</p>'}`;
  },

  channels() { return browse('live'); },
  movies() { return browse('movie'); },
  series() { return browse('series'); },
  favs() { return browse(null, true); },

  debrid() {
    const svc = ui.dtab, t = deb()[svc], d = dd[svc];
    const tabs = ['rd', 'tb'].map((k) => `<button class="tab ${svc === k ? 'active' : ''}" data-act="dtab" data-id="${k}">${DN[k]}${deb()[k] ? ' ✓' : ''}</button>`).join('');
    const hint = svc === 'rd' ? 'Tu token está en real-debrid.com/apitoken' : 'Tu API token está en torbox.app → Settings';
    let body;
    if (!t) {
      body = `<div class="card"><h2>Conectar ${DN[svc]}</h2><p class="muted">${hint}. Se guarda solo en este dispositivo.</p>
        <input id="d-token" type="password" placeholder="Pega tu token aquí" autocomplete="off">
        <button class="btn green" data-act="d-connect">🔌 Conectar</button></div>`;
    } else {
      const u = d.user || {};
      const exp = u.expiration || u.premium_expires_at;
      const acct = d.err ? `<span style="color:#ff8fa3">⚠️ ${esc(d.err)}</span>`
        : d.loading ? 'Cargando…'
        : `${esc(u.username || u.email || 'Cuenta conectada')}${u.type ? ' · ' + esc(u.type) : ''}${exp ? ' · vence ' + new Date(exp).toLocaleDateString() : ''}`;
      const rows = d.items.filter((x) => !ui.dfilter || dMatch(normItem(svc, x).name, ui.dfilter)).map((x) => {
        const it = normItem(svc, x);
        const files = d.files[it.key];
        const fl = !files ? '' : files.loading ? '<p class="muted">Cargando archivos…</p>'
          : `<div class="card" style="margin-top:6px">${files.list.map((f, i) => `<div class="list-row"><div><div class="t">${esc(f.name)}</div><div class="muted">${fmtSize(f.size)}</div></div><div>
              ${isVideo(f.name) ? `<button class="btn green small" data-act="d-play" data-key="${esc(it.key)}" data-i="${i}">▶</button>` : ''}
              <button class="btn yellow small" data-act="d-copy" data-key="${esc(it.key)}" data-i="${i}">🔗 Copiar</button></div></div>`).join('') || '<p class="muted">Sin archivos.</p>'}</div>`;
        return `<div class="list-row"><div><div class="t">${esc(it.name)}</div>
          <div class="muted">${esc(it.st || '')}${it.ready ? '' : ' · ' + it.pct + '%'} ${fmtSize(it.size)}</div></div>
          <div>${it.ready ? `<button class="btn green small" data-act="d-open" data-key="${esc(it.key)}">📂 Archivos</button>` : '<span class="muted">En proceso…</span>'}</div></div>${fl}`;
      }).join('');
      body = `<div class="card"><div class="muted">${acct}</div>
        <button class="btn yellow small" data-act="d-refresh">🔄 Actualizar</button>
        <button class="btn pink small" data-act="d-disconnect">Desconectar</button></div>
        <div class="card"><h2>Agregar magnet o enlace</h2>
        <input id="d-in" data-act="dinput" placeholder="magnet:?xt=... o https://..." value="${esc(ui.dinput)}">
        <button class="btn green" data-act="d-add">➕ Agregar</button></div>
        <h2>Mis descargas</h2>${rows || `<p class="muted card">${ui.dfilter ? 'No hay coincidencias en tu cuenta de ' + DN[svc] + '. Solo busco entre lo que ya tienes en ella.' : 'No hay descargas todavía.'}</p>`}`;
    }
    const banner = ui.dfilter ? `<div class="card">🔎 Buscando: <b>${esc(ui.dfilter)}</b>
      <div class="muted">Real-Debrid: ${deb().rd ? dCount('rd') : 'no conectado'} · TorBox: ${deb().tb ? dCount('tb') : 'no conectado'}</div>
      <button class="btn pink small" data-act="d-clear">✕ Quitar filtro</button></div>` : '';
    return `<h1>⚡ Debrid</h1><p class="muted">Conecta tu cuenta de Real-Debrid o TorBox.</p>${banner}<div class="tabs" style="margin-top:12px">${tabs}</div>${body}`;
  },

  search() {
    const q = nrm(ui.gq), words = q.split(' ').filter(Boolean);
    const found = { live: [], movie: [], series: [] };
    if (q.length >= 2) {
      for (const l of state.lists) for (const c of l.channels) {
        if (!vis(c)) continue;
        const n = normName(c);
        if (words.every((w) => n.includes(w))) found[kindOf(c)].push(c);
      }
    }
    const sMap = new Map();
    found.series.forEach((c) => {
      const t = seriesTitle(c.name);
      const x = sMap.get(t) || { t, logo: '', n: 0 };
      x.n++; if (!x.logo) x.logo = c.logo;
      sMap.set(t, x);
    });
    const seriesItems = [...sMap.values()].sort((a, b) => a.t.localeCompare(b.t));
    const cnt = { live: found.live.length, movie: found.movie.length, series: seriesItems.length };
    const total = cnt.live + cnt.movie + cnt.series;
    const chip = (id, label) => `<button class="tab ${ui.gkind === id ? 'active' : ''}" data-act="gkind" data-id="${id}">${label}</button>`;
    const sec = (title, kind, items, fn, posters) => {
      if (!items.length || (ui.gkind !== 'all' && ui.gkind !== kind)) return '';
      const all = ui.gkind === 'all', show = all ? 24 : ui.limit;
      return `<h2>${title} <span class="muted">${items.length}</span></h2>
        <div class="grid${posters ? ' posters' : ''}">${items.slice(0, show).map(fn).join('')}</div>
        ${items.length > show ? (all ? `<button class="btn yellow small" data-act="gkind" data-id="${kind}">Ver todo (${items.length})</button>` : '<button class="btn yellow" data-act="more">Mostrar más</button>') : ''}`;
    };
    const tm = ui.tmdbFor === ui.gq && ui.tmdbRes.length
      ? `<h2>🎞️ Resultados de TMDB</h2><div class="grid posters">${ui.tmdbRes.map(tmdbCard).join('')}</div>` : '';
    return `<h1>🔎 Buscar</h1><p class="muted">Busca en todas tus listas: canales, películas y series.</p>
      <input id="search" data-act="gsearch" placeholder="Escribe un título o canal…" value="${esc(ui.gq)}" autocomplete="off">
      <div class="tabs" style="margin-top:12px">${chip('all', 'Todo (' + total + ')')}${chip('live', '📺 ' + cnt.live)}${chip('movie', '🎬 ' + cnt.movie)}${chip('series', '🍿 ' + cnt.series)}</div>
      ${q.length >= 2 ? '<button class="btn pink small" data-act="tmdb-search">🎞️ Buscar también en TMDB</button>' : ''}
      ${q.length < 2 ? '<p class="muted card">Escribe al menos 2 letras.</p>' : total === 0 && !tm ? '<p class="muted card">Sin resultados en tus listas.</p>' : ''}
      ${sec('📺 Canales', 'live', found.live, chCard, false)}
      ${sec('🎬 Películas', 'movie', found.movie, chCard, true)}
      ${sec('🍿 Series', 'series', seriesItems, seriesCard, true)}
      ${tm}`;
  },

  settings() {
    const android = isAndroid(), cur = state.player || 'auto';
    const opts = PLAYERS.filter((x) => android || x[0] === 'auto' || x[0] === 'builtin').map((x) =>
      `<div class="opt ${cur === x[0] ? 'sel' : ''}" data-act="set-player" data-id="${x[0]}"><span class="radio"></span><div><b>${x[1]}</b><small>${x[2]}</small></div></div>`).join('');
    return `<h1>⚙️ Configuración</h1>
      <div class="card"><h2 class="center">Avanzado</h2><p class="muted center">Reproductor de canales y películas.</p>
        <h2 class="center">Reproductor</h2>${opts}
        <p class="muted" style="margin-top:12px">${android
          ? 'VLC, mpv y MX Player se abren como apps aparte: instálalos desde Play Store. Si no está instalado, se abre el selector del sistema.'
          : 'En la app de Android también puedes elegir VLC, mpv o MX Player.'}</p></div>
      <div class="card"><h2>🔒 Control parental</h2>${parentalCard()}</div>
      <div class="card"><h2>🎞️ TMDB (información de películas y series)</h2>
        <p class="muted">Clave gratis en themoviedb.org → Ajustes → API. Acepta la clave v3 o el token v4. Se guarda solo en este dispositivo.</p>
        <input id="tmdb-key" type="password" placeholder="Pega tu clave de TMDB" autocomplete="off" value="${esc(state.tmdb || '')}">
        <button class="btn green" data-act="tmdb-save">💾 Guardar y probar</button></div>
      <div class="card"><h2>Copia de seguridad</h2>
        <button class="btn green" data-act="export">💾 Exportar todo (JSON)</button>
        <label style="display:block;margin-top:16px">Importar copia</label><input id="f-backup" type="file" accept=".json">
        <button class="btn yellow" data-act="import">📥 Importar</button></div>
      <div class="card"><h2>Zona peligrosa</h2><button class="btn pink" data-act="wipe">🗑️ Borrar todo</button></div>
      <p class="muted" style="margin-top:20px">M3U Colorida v1.1 · Solo gestiona y reproduce listas que tú agregas.<br>Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.</p>`;
  }
};

function render() {
  renderNav();
  const keepSearch = document.activeElement && document.activeElement.id === 'search';
  $('#view').innerHTML = views[ui.view]();
  if (keepSearch) { const s = $('#search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}

/* ================= Reproductor ================= */
let playToken = 0;
let playTimer = null;

// Canales en vivo estilo Xtream (host/usuario/clave/ID[.ts]) -> probar también la versión HLS (.m3u8)
function candidates(url) {
  const list = [];
  const m = url.match(/^(https?:\/\/[^/]+)\/(?:live\/)?([^/?#]+)\/([^/?#]+)\/(\d+)(?:\.(?:ts|m3u8))?(\?.*)?$/i);
  if (m && !/\/(movie|series)\//i.test(url)) {
    list.push(`${m[1]}/live/${m[2]}/${m[3]}/${m[4]}.m3u8`);
    list.push(`${m[1]}/${m[2]}/${m[3]}/${m[4]}.m3u8`);
  }
  list.push(url);
  return [...new Set(list)];
}

function play(url, name) {
  lastPlay = { url, name };
  const mode = state.player || 'auto';
  if (isAndroid() && mode === 'exo') { playExo(url, name); return; }
  if (isAndroid() && mode !== 'builtin') {
    const pkg = (PLAYERS.find((x) => x[0] === mode) || [])[3];
    if (pkg !== null && pkg !== undefined) { playExternal(url, name, pkg); return; }
    // Automático: contenedores que el WebView no abre -> VLC (o selector del sistema)
    if (/\.(mkv|avi|wmv|flv|mov)(\?|$)/i.test(url)) { playExternal(url, name, 'org.videolan.vlc'); return; }
  }
  $('#player').classList.remove('hidden');
  $('#player-title').textContent = name;
  $('#player-msg').textContent = 'Cargando…';
  stop();
  const token = ++playToken;
  const list = candidates(url);
  let i = 0;
  const next = () => {
    if (token !== playToken) return;
    if (i >= list.length) {
      $('#player-msg').innerHTML = '⚠️ No se pudo reproducir aquí (puede estar caído o requerir otro formato).' +
        (isAndroid() ? ' <button class="btn yellow small" data-act="play-ext">📲 Abrir en otro reproductor</button>' : '');
      return;
    }
    startOne(list[i++], token, next);
  };
  next();
}

function startOne(u, token, onFail) {
  const v = $('#video');
  clearTimeout(playTimer);
  if (hls) { hls.destroy(); hls = null; }
  v.pause(); v.removeAttribute('src'); v.load();

  const fail = () => { if (token === playToken) { clearTimeout(playTimer); onFail(); } };
  v.onerror = fail;
  v.onplaying = () => { clearTimeout(playTimer); $('#player-msg').textContent = ''; };
  playTimer = setTimeout(fail, 12000); // si no arranca en 12 s, probar el siguiente formato

  const isHls = /\.m3u8(\?|$)/i.test(u);
  // Android (WebView) reproduce HLS de forma nativa; en Mac/escritorio se usa hls.js
  const nativeHls = !!window.Capacitor || !!v.canPlayType('application/vnd.apple.mpegurl');
  if (isHls && !nativeHls && window.Hls && Hls.isSupported()) {
    hls = new Hls();
    hls.loadSource(u);
    hls.attachMedia(v);
    hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) fail(); });
  } else {
    v.src = u;
  }
  v.play().catch(() => {});
}

function stop() {
  playToken++;
  clearTimeout(playTimer);
  const v = $('#video');
  v.onerror = null; v.onplaying = null;
  if (hls) { hls.destroy(); hls = null; }
  v.pause(); v.removeAttribute('src'); v.load();
}

/* ================= Debrid (Real-Debrid / TorBox) ================= */
const deb = () => (state.debrid = state.debrid || { rd: '', tb: '' });
const DN = { rd: 'Real-Debrid', tb: 'TorBox' };
const RDAPI = 'https://api.real-debrid.com/rest/1.0';
const TBAPI = 'https://api.torbox.app/v1/api';
const dd = { rd: { user: null, items: [], files: {} }, tb: { user: null, items: [], files: {} } };
const fmtSize = (b) => (!b ? '' : b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(0) + ' MB');
const isVideo = (n) => /\.(mp4|mkv|avi|mov|m4v|webm|ts)$/i.test(n || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dReq(method, url, token, params) {
  const opt = { method, headers: { Authorization: 'Bearer ' + token } };
  if (params) {
    opt.body = new URLSearchParams(params).toString();
    opt.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(url, opt);
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
  if (!r.ok || (data && data.success === false)) {
    throw new Error((data && (data.error_description || data.error || data.detail || data.message)) || 'HTTP ' + r.status);
  }
  return data;
}

function normItem(svc, x) {
  return svc === 'rd'
    ? { key: String(x.id), name: x.filename, ready: x.status === 'downloaded', pct: Math.round(x.progress || 0), st: x.status, size: x.bytes }
    : { key: x._src + '-' + x.id, name: x.name, ready: !!(x.download_finished || x.download_present), pct: Math.round((x.progress || 0) * 100), st: x.download_state, size: x.size };
}

// Búsqueda dentro de las descargas que YA están en la cuenta del usuario
const nrm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const cleanTitle = (n) => String(n)
  .replace(/[\(\[].*?[\)\]]/g, ' ')
  .replace(/\b(19|20)\d{2}\b/g, ' ')
  .replace(/\b(4k|uhd|fhd|hd|sd|1080p?|720p?|2160p?|web-?dl|webrip|bluray|brrip|dual|lat(ino)?|esp|castellano|sub(s|titulado)?|hdr)\b/gi, ' ')
  .replace(/\s+/g, ' ').trim();
function dMatch(name, q) {
  const n = ' ' + nrm(name) + ' ';
  const w = nrm(q).split(' ').filter((x) => x.length > 1 || /\d/.test(x));
  return w.length > 0 && w.every((x) => n.includes(' ' + x));
}
const dCount = (svc) => dd[svc].items.filter((x) => dMatch(normItem(svc, x).name, ui.dfilter)).length;

async function debridLoad(svc) {
  const t = deb()[svc];
  if (!t) return;
  const d = dd[svc];
  d.loading = true; d.err = ''; render();
  try {
    if (svc === 'rd') {
      d.user = await dReq('GET', RDAPI + '/user', t);
      d.items = (await dReq('GET', RDAPI + '/torrents?limit=50', t)) || [];
    } else {
      d.user = ((await dReq('GET', TBAPI + '/user/me', t)) || {}).data || {};
      const [a, b] = await Promise.all([
        dReq('GET', TBAPI + '/torrents/mylist', t),
        dReq('GET', TBAPI + '/webdl/mylist', t).catch(() => ({ data: [] }))
      ]);
      d.items = [...((a && a.data) || []).map((x) => ({ ...x, _src: 'torrents' })), ...((b && b.data) || []).map((x) => ({ ...x, _src: 'webdl' }))];
    }
  } catch (e) { d.err = e.message; d.user = null; }
  d.loading = false; render();
}

async function debridOpen(svc, key) {
  const d = dd[svc], t = deb()[svc];
  if (d.files[key]) { delete d.files[key]; return render(); }
  d.files[key] = { loading: true }; render();
  try {
    let list = [];
    if (svc === 'rd') {
      const info = await dReq('GET', RDAPI + '/torrents/info/' + key, t);
      const sel = (info.files || []).filter((f) => f.selected === 1);
      const links = info.links || [];
      list = links.map((l, i) => ({
        link: l,
        name: sel.length === links.length ? String(sel[i].path).replace(/^\//, '') : 'Archivo ' + (i + 1),
        size: sel.length === links.length ? sel[i].bytes : 0
      }));
    } else {
      const it = d.items.find((x) => x._src + '-' + x.id === key);
      list = ((it && it.files) || []).slice(0, 200).map((f) => ({ id: f.id, name: f.short_name || f.name, size: f.size, src: it._src, parent: it.id }));
    }
    d.files[key] = { list };
  } catch (e) { delete d.files[key]; toast('Error: ' + e.message, true); }
  render();
}

async function debridUrl(svc, key, i) {
  const f = dd[svc].files[key].list[i], t = deb()[svc];
  if (svc === 'rd') return (await dReq('POST', RDAPI + '/unrestrict/link', t, { link: f.link })).download;
  const idp = f.src === 'torrents' ? 'torrent_id' : 'web_id';
  const r = await dReq('GET', `${TBAPI}/${f.src}/requestdl?token=${encodeURIComponent(t)}&${idp}=${f.parent}&file_id=${f.id}`, t);
  return r.data;
}

async function debridAdd(svc, text) {
  const t = deb()[svc];
  text = (text || '').trim();
  if (!text) return toast('Pega un magnet o un enlace', true);
  const magnet = /^magnet:/i.test(text);
  if (svc === 'rd') {
    if (magnet) {
      const r = await dReq('POST', RDAPI + '/torrents/addMagnet', t, { magnet: text });
      for (let i = 0; i < 10; i++) { // esperar a que Real-Debrid lea el magnet
        const info = await dReq('GET', RDAPI + '/torrents/info/' + r.id, t);
        if (info.status !== 'magnet_conversion') {
          if (info.status === 'waiting_files_selection') await dReq('POST', RDAPI + '/torrents/selectFiles/' + r.id, t, { files: 'all' });
          break;
        }
        await sleep(1000);
      }
    } else {
      const u = await dReq('POST', RDAPI + '/unrestrict/link', t, { link: text });
      play(u.download, u.filename);
      return;
    }
  } else if (magnet) {
    await dReq('POST', TBAPI + '/torrents/createtorrent', t, { magnet: text });
  } else {
    await dReq('POST', TBAPI + '/webdl/createwebdownload', t, { link: text });
  }
  toast('✅ Agregado a ' + DN[svc]);
  ui.dinput = '';
  await debridLoad(svc);
}

/* ================= Eventos ================= */
document.addEventListener('click', async (e) => {
  if (e.target.id === 'info') return closeInfo();
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  const a = el.dataset.act, id = el.dataset.id;
  const name = () => ($('#f-name') ? $('#f-name').value.trim() : '');

  try {
    if (a === 'nav') { ui.view = id; ui.q = ''; ui.group = 'all'; ui.limit = 120; ui.series = null; ui.dfilter = ''; render(); if (id === 'search') { const f = $('#search'); if (f) f.focus(); } if (id === 'debrid' && deb()[ui.dtab] && !dd[ui.dtab].user) debridLoad(ui.dtab); }
    else if (a === 'dtab') { ui.dtab = id; render(); if (deb()[id] && !dd[id].user) debridLoad(id); }
    else if (a === 'd-connect') {
      const v = ($('#d-token').value || '').trim();
      if (!v) return toast('Pega tu token', true);
      deb()[ui.dtab] = v; save(); debridLoad(ui.dtab);
    }
    else if (a === 'd-disconnect') {
      if (confirm('¿Desconectar ' + DN[ui.dtab] + '?')) { deb()[ui.dtab] = ''; dd[ui.dtab] = { user: null, items: [], files: {} }; save(); render(); }
    }
    else if (a === 'd-refresh') debridLoad(ui.dtab);
    else if (a === 'd-clear') { ui.dfilter = ''; render(); }
    else if (a === 'deb-find') {
      closeInfo(); ui.dfilter = cleanTitle(seriesTitle(el.dataset.name)); ui.view = 'debrid'; render();
      const conn = ['rd', 'tb'].filter((k) => deb()[k]);
      if (!conn.length) return toast('Primero conecta Real-Debrid o TorBox', true);
      toast('Buscando en tus cuentas…');
      await Promise.all(conn.map((k) => debridLoad(k)));
      ui.dtab = conn.find((k) => dCount(k) > 0) || conn[0];
      render();
    }
    else if (a === 'd-add') { toast('Agregando…'); await debridAdd(ui.dtab, $('#d-in').value); }
    else if (a === 'd-open') debridOpen(ui.dtab, el.dataset.key);
    else if (a === 'd-play' || a === 'd-copy') {
      const key = el.dataset.key, i = +el.dataset.i;
      toast('Obteniendo enlace…');
      const url = await debridUrl(ui.dtab, key, i);
      if (!url) throw new Error('No se obtuvo el enlace');
      if (a === 'd-play') play(url, dd[ui.dtab].files[key].list[i].name);
      else { await navigator.clipboard.writeText(url); toast('🔗 Enlace copiado'); }
    }
    else if (a === 'gkind') { ui.gkind = id; ui.limit = 120; render(); }
    else if (a === 'info') showInfo(el.dataset.name, el.dataset.kind);
    else if (a === 'tmdb-open') showTmdb(el.dataset.type, el.dataset.id);
    else if (a === 'close-info') closeInfo();
    else if (a === 'info-search') { closeInfo(); ui.gq = el.dataset.title; ui.gkind = 'all'; ui.limit = 120; ui.view = 'search'; render(); }
    else if (a === 'tmdb-search') {
      toast('Buscando en TMDB…');
      const d = await tmdb('/search/multi', { query: ui.gq });
      ui.tmdbRes = (d.results || []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 12);
      ui.tmdbFor = ui.gq;
      if (!ui.tmdbRes.length) toast('Sin resultados en TMDB', true);
      render();
    }
    else if (a === 'tmdb-save') {
      state.tmdb = ($('#tmdb-key').value || '').trim(); save();
      if (!state.tmdb) { toast('Clave borrada'); return render(); }
      tmdbCache.clear();
      await tmdb('/configuration');
      toast('✅ TMDB conectado');
    }
    else if (a === 'set-player') { state.player = id; save(); render(); }
    else if (a === 'play-ext') {
      if (!lastPlay) return;
      const pkg = (PLAYERS.find((x) => x[0] === (state.player || 'auto')) || [])[3];
      stop(); $('#player').classList.add('hidden');
      playExternal(lastPlay.url, lastPlay.name, pkg || 'org.videolan.vlc');
    }
    else if (a === 'pc-enable' || a === 'pc-change') {
      if (a === 'pc-change' && !(await pinOk($('#pc-cur').value.trim()))) return toast('PIN actual incorrecto', true);
      const p1 = $('#pc-pin').value.trim(), p2 = $('#pc-pin2').value.trim();
      if (!/^\d{4,8}$/.test(p1)) return toast('El PIN debe tener de 4 a 8 números', true);
      if (p1 !== p2) return toast('Los PIN no coinciden', true);
      const salt = uid();
      state.parental = { on: true, salt, hash: await pinHash(p1, salt) };
      ui.unlocked = false; save(); toast('🔒 PIN guardado'); render();
    }
    else if (a === 'pc-unlock') {
      if (!(await pinOk($('#pc-cur').value.trim()))) return toast('PIN incorrecto', true);
      ui.unlocked = true; toast('🔓 Desbloqueado'); render();
    }
    else if (a === 'pc-lock') { ui.unlocked = false; toast('🔒 Bloqueado'); render(); }
    else if (a === 'pc-disable') {
      if (!(await pinOk($('#pc-cur').value.trim()))) return toast('PIN incorrecto', true);
      state.parental = null; ui.unlocked = false; save(); toast('Control parental desactivado'); render();
    }
    else if (a === 'open-series') { ui.series = el.dataset.key; ui.view = 'series'; ui.q = ''; ui.group = 'all'; ui.limit = 120; render(); }
    else if (a === 'back-series') { ui.series = null; ui.limit = 120; render(); }
    else if (a === 'addtab') { ui.addTab = id; render(); }
    else if (a === 'add-url') {
      const url = $('#f-url').value.trim();
      if (!url) return toast('Escribe la URL', true);
      toast('Descargando…');
      const text = await fetchText(url);
      if (addList(name() || new URL(url).hostname, url, text)) { ui.view = 'lists'; render(); }
    }
    else if (a === 'add-file') {
      const f = $('#f-file').files[0];
      if (!f) return toast('Elige un archivo', true);
      if (addList(name() || f.name.replace(/\.\w+$/, ''), '', await f.text())) { ui.view = 'lists'; render(); }
    }
    else if (a === 'add-text') {
      const t = $('#f-text').value;
      if (!t.trim()) return toast('Pega el contenido', true);
      if (addList(name(), '', t)) { ui.view = 'lists'; render(); }
    }
    else if (a === 'open-list') { ui.listId = id; ui.view = 'channels'; render(); }
    else if (a === 'del-list') {
      if (confirm('¿Eliminar esta lista?')) { state.lists = state.lists.filter((l) => l.id !== id); save(); render(); }
    }
    else if (a === 'refresh') {
      const l = state.lists.find((x) => x.id === id);
      toast('Actualizando…');
      l.channels = parseM3U(await fetchText(l.url));
      save(); toast('🔄 Lista actualizada'); render();
    }
    else if (a === 'play') play(el.dataset.url, el.dataset.name);
    else if (a === 'close-player') { stop(); $('#player').classList.add('hidden'); }
    else if (a === 'fav') {
      const u = el.dataset.url;
      state.favs = state.favs.includes(u) ? state.favs.filter((x) => x !== u) : [...state.favs, u];
      save(); render();
    }
    else if (a === 'more') { ui.limit += 120; render(); }
    else if (a === 'export') {
      const b = new Blob([JSON.stringify({ lists: state.lists, favs: state.favs })], { type: 'application/json' });
      const l = document.createElement('a');
      l.href = URL.createObjectURL(b); l.download = 'm3u-colorida-backup.json'; l.click();
    }
    else if (a === 'import') {
      const f = $('#f-backup').files[0];
      if (!f) return toast('Elige un archivo .json', true);
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.lists)) throw new Error('Archivo inválido');
      state = { lists: d.lists, favs: d.favs || [], debrid: deb(), player: state.player, tmdb: state.tmdb, parental: state.parental }; save(); toast('Importado ✅'); render();
    }
    else if (a === 'wipe') {
      if (parentalOn() && !ui.unlocked) return toast('Desbloquea el control parental primero', true);
      if (confirm('¿Borrar TODAS las listas y favoritos?')) { state = { lists: [], favs: [], debrid: { rd: '', tb: '' }, player: state.player, parental: state.parental }; dd.rd = { user: null, items: [], files: {} }; dd.tb = { user: null, items: [], files: {} }; save(); render(); }
    }
  } catch (err) {
    toast('Error: ' + (err.message || err), true);
  }
});

document.addEventListener('change', (e) => {
  const a = e.target.dataset.act;
  if (a === 'sel-list') { ui.listId = e.target.value; ui.group = 'all'; render(); }
  if (a === 'sel-group') { ui.group = e.target.value; render(); }
});
const input = {};
document.addEventListener('input', (e) => {
  if (e.target.dataset.act === 'dinput') ui.dinput = e.target.value;
  if (e.target.dataset.act === 'gsearch') { ui.gq = e.target.value; ui.limit = 120; clearTimeout(input.t); input.t = setTimeout(render, 250); }
  if (e.target.dataset.act === 'search') { ui.q = e.target.value; ui.limit = 120; render(); }
});

loadState().then(render);
