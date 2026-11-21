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

const ui = { view: 'home', addTab: 'url', listId: 'all', q: '', group: 'all', limit: 120, series: null, dtab: 'rd', dinput: '', dfilter: '' };
let hls = null;

const NAV = [
  ['home', '🏠 Inicio', '#ff4d6d'],
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

function allChannels() {
  const lists = ui.listId === 'all' ? state.lists : state.lists.filter((l) => l.id === ui.listId);
  return lists.flatMap((l) => l.channels);
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
      ${k !== 'live' ? `<button class="btn yellow small" title="Buscar en Real-Debrid / TorBox" data-act="deb-find" data-name="${esc(c.name)}">⚡</button>` : ''}
    </div></div>`;
}

function seriesCard(s) {
  const logo = s.logo ? `<img src="${esc(s.logo)}" loading="lazy" onerror="this.outerHTML='<div class=ph>🍿</div>'">` : '<div class="ph">🍿</div>';
  return `<div class="ch poster">${logo}<div class="n">${esc(s.t)}</div><div class="g">${s.n} episodios</div>
    <div class="row"><button class="btn green small" data-act="open-series" data-key="${esc(s.t)}">Ver</button>
    <button class="btn yellow small" title="Buscar en Real-Debrid / TorBox" data-act="deb-find" data-name="${esc(s.t)}">⚡</button></div></div>`;
}

function browse(kind, favOnly) {
  const titles = { live: '📺 Canales', movie: '🎬 Películas', series: '🍿 Series' };
  const base = favOnly
    ? state.lists.flatMap((l) => l.channels).filter((c) => state.favs.includes(c.url))
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

const views = {
  home() {
    const cnt = { live: 0, movie: 0, series: 0 };
    const seriesSet = new Set();
    const pics = { live: [], movie: [], series: [] };
    const favPics = [];
    state.lists.forEach((l) => l.channels.forEach((c) => {
      const k = kindOf(c);
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
      ${tile('#ffb703', '#fb8500', state.favs.length, 'Favoritos', pick(favPics, 4), '⭐', 'favs')}
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

  settings() {
    return `<h1>⚙️ Ajustes</h1><div class="card"><h2>Copia de seguridad</h2>
      <button class="btn green" data-act="export">💾 Exportar todo (JSON)</button>
      <label style="display:block;margin-top:16px">Importar copia</label><input id="f-backup" type="file" accept=".json">
      <button class="btn yellow" data-act="import">📥 Importar</button></div>
      <div class="card"><h2>Zona peligrosa</h2><button class="btn pink" data-act="wipe">🗑️ Borrar todo</button></div>
      <p class="muted" style="margin-top:20px">M3U Colorida v1.0 · Solo gestiona y reproduce listas que tú agregas.</p>`;
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
      $('#player-msg').textContent = '⚠️ No se pudo reproducir este canal (puede estar caído o requerir otro formato).';
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
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  const a = el.dataset.act, id = el.dataset.id;
  const name = () => ($('#f-name') ? $('#f-name').value.trim() : '');

  try {
    if (a === 'nav') { ui.view = id; ui.q = ''; ui.group = 'all'; ui.limit = 120; ui.series = null; ui.dfilter = ''; render(); if (id === 'debrid' && deb()[ui.dtab] && !dd[ui.dtab].user) debridLoad(ui.dtab); }
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
      ui.dfilter = cleanTitle(seriesTitle(el.dataset.name)); ui.view = 'debrid'; render();
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
    else if (a === 'open-series') { ui.series = el.dataset.key; ui.limit = 120; render(); }
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
      state = { lists: d.lists, favs: d.favs || [], debrid: deb() }; save(); toast('Importado ✅'); render();
    }
    else if (a === 'wipe') {
      if (confirm('¿Borrar TODAS las listas y favoritos?')) { state = { lists: [], favs: [], debrid: { rd: '', tb: '' } }; dd.rd = { user: null, items: [], files: {} }; dd.tb = { user: null, items: [], files: {} }; save(); render(); }
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
document.addEventListener('input', (e) => {
  if (e.target.dataset.act === 'dinput') ui.dinput = e.target.value;
  if (e.target.dataset.act === 'search') { ui.q = e.target.value; ui.limit = 120; render(); }
});

loadState().then(render);
