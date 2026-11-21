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

const ui = { view: 'home', addTab: 'url', listId: 'all', q: '', group: 'all', limit: 120 };
let hls = null;

const NAV = [
  ['home', '🏠 Inicio', '#ff4d6d'],
  ['add', '➕ Agregar lista', '#ffb703'],
  ['lists', '📚 Mis listas', '#06d6a0'],
  ['channels', '📺 Canales', '#4cc9f0'],
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

function chCard(c) {
  const fav = state.favs.includes(c.url);
  const logo = c.logo ? `<img src="${esc(c.logo)}" loading="lazy" onerror="this.outerHTML='<div class=ph>📺</div>'">` : '<div class="ph">📺</div>';
  return `<div class="ch">${logo}<div class="n">${esc(c.name)}</div><div class="g">${esc(c.group)}</div>
    <div class="row">
      <button class="btn green small" data-act="play" data-url="${esc(c.url)}" data-name="${esc(c.name)}">▶</button>
      <button class="btn ${fav ? 'yellow' : 'pink'} small" data-act="fav" data-url="${esc(c.url)}">${fav ? '★' : '☆'}</button>
    </div></div>`;
}

const views = {
  home() {
    const total = state.lists.reduce((a, l) => a + l.channels.length, 0);
    return `<h1>¡Bienvenido! 🎉</h1><p class="muted">Agrega tus listas M3U y míralas en un solo lugar.</p>
    <div class="grid">
      <div class="stat" style="--c1:#ff4d6d;--c2:#f72585"><b>${state.lists.length}</b>Listas</div>
      <div class="stat" style="--c1:#06d6a0;--c2:#4cc9f0"><b>${total}</b>Canales</div>
      <div class="stat" style="--c1:#ffb703;--c2:#fb8500"><b>${state.favs.length}</b>Favoritos</div>
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

  channels(favOnly) {
    let chs = allChannels();
    if (favOnly) chs = state.lists.flatMap((l) => l.channels).filter((c) => state.favs.includes(c.url));
    const groups = [...new Set(chs.map((c) => c.group).filter(Boolean))].sort();
    if (ui.group !== 'all') chs = chs.filter((c) => c.group === ui.group);
    if (ui.q) chs = chs.filter((c) => c.name.toLowerCase().includes(ui.q.toLowerCase()));
    const shown = chs.slice(0, ui.limit);
    const filters = favOnly ? '' : `<div class="filters">
      <select data-act="sel-list">${'<option value="all">Todas las listas</option>' + state.lists.map((l) => `<option value="${l.id}" ${ui.listId === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
      <select data-act="sel-group"><option value="all">Todos los grupos</option>${groups.map((g) => `<option ${ui.group === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
      <input id="search" data-act="search" placeholder="🔍 Buscar canal..." value="${esc(ui.q)}"></div>`;
    return `<h1>${favOnly ? '⭐ Favoritos' : '📺 Canales'}</h1><p class="muted">${chs.length} resultados</p>${filters}
      <div class="grid">${shown.map(chCard).join('') || '<p class="muted">Nada por aquí todavía.</p>'}</div>
      ${chs.length > shown.length ? '<button class="btn yellow" data-act="more">Mostrar más</button>' : ''}`;
  },

  favs() { return views.channels(true); },

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
function play(url, name) {
  $('#player').classList.remove('hidden');
  $('#player-title').textContent = name;
  $('#player-msg').textContent = '';
  const v = $('#video');
  stop();
  if (/\.m3u8(\?|$)/i.test(url) && window.Hls && Hls.isSupported()) {
    hls = new Hls();
    hls.loadSource(url);
    hls.attachMedia(v);
    hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) $('#player-msg').textContent = '⚠️ No se pudo reproducir este canal.'; });
  } else {
    v.src = url;
  }
  v.play().catch(() => {});
  v.onerror = () => { $('#player-msg').textContent = '⚠️ Formato o enlace no compatible.'; };
}
function stop() {
  const v = $('#video');
  if (hls) { hls.destroy(); hls = null; }
  v.pause(); v.removeAttribute('src'); v.load();
}

/* ================= Eventos ================= */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  const a = el.dataset.act, id = el.dataset.id;
  const name = () => ($('#f-name') ? $('#f-name').value.trim() : '');

  try {
    if (a === 'nav') { ui.view = id; ui.q = ''; ui.group = 'all'; ui.limit = 120; render(); }
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
      const b = new Blob([JSON.stringify(state)], { type: 'application/json' });
      const l = document.createElement('a');
      l.href = URL.createObjectURL(b); l.download = 'm3u-colorida-backup.json'; l.click();
    }
    else if (a === 'import') {
      const f = $('#f-backup').files[0];
      if (!f) return toast('Elige un archivo .json', true);
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.lists)) throw new Error('Archivo inválido');
      state = { lists: d.lists, favs: d.favs || [] }; save(); toast('Importado ✅'); render();
    }
    else if (a === 'wipe') {
      if (confirm('¿Borrar TODAS las listas y favoritos?')) { state = { lists: [], favs: [] }; save(); render(); }
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
  if (e.target.dataset.act === 'search') { ui.q = e.target.value; ui.limit = 120; render(); }
});

loadState().then(render);
