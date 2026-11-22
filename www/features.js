'use strict';
/* =====================================================================
   Funciones extra: historial, Continuar viendo, filas de Inicio, guía (EPG),
   cambio de canal, siguiente episodio, perfiles, temas, calidad/duplicados,
   revisor de canales caídos y búsqueda por voz.
   Se carga después de app.js y comparte sus variables globales.
   ===================================================================== */

/* ---------- Temas ---------- */
const THEMES = [['neon', 'Neón', '#f72585'], ['ocean', 'Océano', '#4cc9f0'], ['sunset', 'Atardecer', '#ff9e00'], ['forest', 'Bosque', '#06d6a0'], ['amoled', 'AMOLED', '#ffffff']];
function applyTheme() {
  const de = document.documentElement;
  if (de && de.dataset) de.dataset.theme = state.theme || 'neon';
}
function themeCard() {
  return `<div class="card"><h2>🎨 Tema</h2><div class="tabs">${THEMES.map((t) =>
    `<button class="tab ${(state.theme || 'neon') === t[0] ? 'active' : ''}" data-act="set-theme" data-id="${t[0]}" style="border:2px solid ${t[2]}">${t[1]}</button>`).join('')}</div></div>`;
}

/* ---------- Búsqueda rápida de un elemento por su enlace ---------- */
let _mapKey = '', _map = new Map();
function itemMap() {
  const key = state.lists.map((l) => l.id + ':' + l.channels.length).join('|');
  if (key !== _mapKey) {
    _map = new Map();
    for (const l of state.lists) for (const c of l.channels) if (!_map.has(c.url)) _map.set(c.url, c);
    _mapKey = key;
  }
  return _map;
}
const findItem = (url) => itemMap().get(url) || null;

/* ---------- Historial y progreso ---------- */
const hist = () => (state.hist = state.hist || {});
const fmtT = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};
function recordHist(c, patch) {
  const H = hist();
  const h = H[c.url] || (H[c.url] = { url: c.url, name: c.name, kind: kindOf(c), logo: c.logo || '', group: c.group || '', pos: 0, dur: 0, done: false });
  Object.assign(h, patch, { t: Date.now() });
  const keys = Object.keys(H);
  if (keys.length > 400) keys.sort((a, b) => H[a].t - H[b].t).slice(0, keys.length - 400).forEach((k) => delete H[k]);
  saveMeta();
  return h;
}
const histItems = (kind) => Object.values(hist()).filter((h) => !kind || h.kind === kind).sort((a, b) => b.t - a.t);
function histVisible(h) { const c = findItem(h.url); return c ? vis(c) : !curKids(); }

/* ---------- Contexto de reproducción: cambiar de canal y siguiente episodio ---------- */
let curItem = null, ctx = null, resumeAt = 0, lastT = 0, lastD = 0, lastSave = 0, nextTimer = null;

function buildCtx(c) {
  ctx = null;
  const k = kindOf(c);
  if (k === 'live') {
    const inView = ui.view === 'channels';
    const q = inView ? nrm(ui.q || '') : '';
    const items = allChannels().filter((x) => kindOf(x) === 'live' &&
      (inView ? (ui.group === 'all' || x.group === ui.group) : x.group === c.group) && (!q || normName(x).includes(q)));
    const i = items.findIndex((x) => x.url === c.url);
    if (i >= 0) ctx = { kind: 'live', items, i };
  } else if (k === 'series') {
    const t = seriesTitle(c.name);
    const items = allChannels().filter((x) => kindOf(x) === 'series' && seriesTitle(x.name) === t)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const i = items.findIndex((x) => x.url === c.url);
    if (i >= 0) ctx = { kind: 'series', items, i };
  }
  updateZapUI();
}
function updateZapUI() {
  const z = $('#zap');
  if (!z) return;
  if (ctx && ctx.kind === 'live' && ctx.items.length > 1) { z.classList.remove('hidden'); $('#zap-n').textContent = (ctx.i + 1) + '/' + ctx.items.length; }
  else z.classList.add('hidden');
}
function zap(d) {
  if (!ctx || ctx.kind !== 'live' || ctx.items.length < 2) return;
  const n = ctx.items.length, c = ctx.items[(ctx.i + d + n) % n];
  play(c.url, c.name);
}
function startNext(nx) {
  clearInterval(nextTimer);
  let n = 8;
  const msg = $('#player-msg');
  const draw = () => { msg.innerHTML = `⏭️ Siguiente: <b>${esc(nx.name)}</b> en ${n} s <button class="btn green small" data-act="next-now">Ahora</button> <button class="btn red small" data-act="next-cancel">Cancelar</button>`; };
  draw();
  nextTimer = setInterval(() => { n--; if (n <= 0) { clearInterval(nextTimer); play(nx.url, nx.name); } else draw(); }, 1000);
}
let _nextItem = null;

function onPlayStart(url, name) {
  clearInterval(nextTimer);
  const c = findItem(url) || { name, url, logo: '', group: '' };
  curItem = c;
  const k = kindOf(c), h = hist()[url];
  resumeAt = (k !== 'live' && h && h.pos > 30 && !h.done) ? h.pos : 0;
  lastT = 0; lastD = 0;
  recordHist(c, { pos: h ? h.pos : 0, dur: h ? h.dur : 0 });
  buildCtx(c);
}

// Datos extra para ExoPlayer nativo: dónde seguir y los próximos episodios
function exoExtra(url) {
  const ex = { key: url };
  const h = hist()[url];
  if (curItem && kindOf(curItem) !== 'live' && h && h.pos > 30 && !h.done) ex.start = h.pos * 1000;
  if (ctx && ctx.kind === 'series') {
    const rest = ctx.items.slice(ctx.i + 1, ctx.i + 21);
    ex.queue = rest.map((x) => x.url); ex.queueTitles = rest.map((x) => x.name);
  }
  return ex;
}
// Al volver de ExoPlayer: leer dónde se quedó
async function applyNativeProgress() {
  const P = extPlugin();
  if (!P || !P.getLastProgress) return;
  try {
    const r = await P.getLastProgress();
    if (!r || !r.url) return;
    const c = findItem(r.url);
    if (c && r.dur > 0) recordHist(c, { pos: Math.floor(r.pos / 1000), dur: Math.floor(r.dur / 1000), done: r.pos / r.dur > 0.92 });
    (r.done || []).forEach((u) => { const x = findItem(u); if (x) recordHist(x, { done: true }); });
    if (ui.view === 'home' || ui.view === 'history') render();
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) applyNativeProgress(); });

// Reproductor integrado (WebView): guardar progreso, retomar y pasar al siguiente
(function () {
  const v = $('#video');
  if (!v || !v.addEventListener) return;
  const finish = (done) => {
    if (!curItem || kindOf(curItem) === 'live' || !lastD) return;
    recordHist(curItem, { pos: Math.floor(lastT), dur: Math.floor(lastD), done: done || lastT / lastD > 0.92 });
  };
  v.addEventListener('loadedmetadata', () => { if (resumeAt > 0 && v.duration > resumeAt) v.currentTime = resumeAt; resumeAt = 0; });
  v.addEventListener('timeupdate', () => {
    if (!curItem || kindOf(curItem) === 'live') return;
    lastT = v.currentTime; lastD = v.duration || 0;
    const now = Date.now();
    if (now - lastSave > 10000) { lastSave = now; finish(false); }
  });
  v.addEventListener('pause', () => finish(false));
  v.addEventListener('ended', () => {
    finish(true);
    if (ctx && ctx.kind === 'series' && ctx.i + 1 < ctx.items.length) startNext(ctx.items[ctx.i + 1]);
  });
  window.__finishPlay = finish;
})();

document.addEventListener('keydown', (e) => {
  const pl = $('#player');
  if (!pl || pl.classList.contains('hidden')) return;
  if (e.key === 'ArrowUp') zap(1); else if (e.key === 'ArrowDown') zap(-1);
});
(function () {
  const v = $('#video');
  if (!v || !v.addEventListener) return;
  let y0 = 0, x0 = 0;
  v.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; }, { passive: true });
  v.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0], dy = t.clientY - y0, dx = t.clientX - x0;
    if (Math.abs(dy) > 90 && Math.abs(dx) < 60) zap(dy < 0 ? 1 : -1);
  }, { passive: true });
})();

/* ---------- Calidad, duplicados y canales caídos ---------- */
const QN = { 4: '4K', 3: 'FHD', 2: 'HD', 1: 'SD' };
function qualityOf(n) {
  n = String(n);
  if (/\b(4k|uhd|2160p?)\b/i.test(n)) return 4;
  if (/\b(fhd|1080p?)\b/i.test(n)) return 3;
  if (/\b(hd|720p?)\b/i.test(n)) return 2;
  if (/\b(sd|480p?|360p?)\b/i.test(n)) return 1;
  return 0;
}
const dupKey = (n) => nrm(cleanTitle(n)) || nrm(n);
function dedupeList(a) {
  const best = new Map();
  for (const c of a) { const k = dupKey(c.name), cur = best.get(k); if (!cur || qualityOf(c.name) > qualityOf(cur.name)) best.set(k, c); }
  const seen = new Set(), out = [];
  for (const c of a) { const k = dupKey(c.name); if (!seen.has(k)) { seen.add(k); out.push(best.get(k)); } }
  return out;
}
const deadMap = () => (state.dead = state.dead || {});
const isDead = (c) => !!(deadMap()[c.url] && deadMap()[c.url].ok === false);

const _allChannels = allChannels;
allChannels = function () {
  let a = _allChannels();
  if (ui.view === 'channels') {
    if (ui.hideDead) a = a.filter((c) => !isDead(c));
    if (ui.dedupe) a = dedupeList(a);
    if (ui.byQuality) a = a.slice().sort((x, y) => qualityOf(y.name) - qualityOf(x.name));
  }
  return a;
};

async function probeVisible() {
  const P = extPlugin();
  if (!P || !P.probe) return toast('La revisión solo está en la app de Android (versión nueva)', true);
  const q = nrm(ui.q || '');
  const items = allChannels().filter((c) => kindOf(c) === 'live' && (ui.group === 'all' || c.group === ui.group) && (!q || normName(c).includes(q)))
    .filter((c) => !deadMap()[c.url] || Date.now() - deadMap()[c.url].t > 12 * 3600e3).slice(0, 40);
  if (!items.length) return toast('Nada nuevo que revisar aquí');
  let bad = 0;
  for (let i = 0; i < items.length; i += 5) {
    const batch = items.slice(i, i + 5);
    toast(`🩺 Revisando ${i + 1}-${i + batch.length} de ${items.length}…`);
    const r = await P.probe({ urls: batch.map((c) => c.url) });
    (r.results || []).forEach((x) => { deadMap()[x.url] = { ok: !!x.ok, t: Date.now() }; if (!x.ok) bad++; });
    saveMeta(); render();
  }
  toast(`🩺 Listo: ${bad} caídos de ${items.length}`);
}

/* ---------- Guía de programación (EPG / XMLTV) ---------- */
const epg = { map: new Map(), loaded: 0, loading: false };
function xmlText(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&').trim();
}
function xmlTime(s) {
  const m = String(s || '').match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-]\d{4})?/);
  if (!m) return 0;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (m[7]) t -= (m[7][0] === '-' ? -1 : 1) * (+m[7].slice(1, 3) * 60 + +m[7].slice(3, 5)) * 60000;
  return t;
}
function parseXmltv(text, wanted) {
  const out = new Map(), now = Date.now(), lo = now - 3600e3, hi = now + 24 * 3600e3;
  let pos = 0;
  for (;;) {
    const a = text.indexOf('<programme', pos);
    if (a < 0) break;
    const b = text.indexOf('</programme>', a);
    if (b < 0) break;
    pos = b + 12;
    const head = text.slice(a, text.indexOf('>', a));
    const ch = (head.match(/channel="([^"]*)"/) || [])[1];
    if (!ch) continue;
    const id = ch.toLowerCase();
    if (wanted && !wanted.has(id)) continue;
    const s = xmlTime((head.match(/start="([^"]*)"/) || [])[1]), e = xmlTime((head.match(/stop="([^"]*)"/) || [])[1]);
    if (e < lo || s > hi) continue;
    const tm = text.slice(a, b).match(/<title[^>]*>([\s\S]*?)<\/title>/);
    if (!out.has(id)) out.set(id, []);
    out.get(id).push({ s, e, t: tm ? xmlText(tm[1]) : '' });
  }
  out.forEach((arr) => arr.sort((x, y) => x.s - y.s));
  return out;
}
function epgNow(c) {
  const arr = epg.map.get((c.tvgId || '').toLowerCase());
  if (!arr) return null;
  const now = Date.now(), i = arr.findIndex((p) => p.e > now);
  if (i < 0) return null;
  return arr[i].s <= now ? { now: arr[i], next: arr[i + 1] } : { now: null, next: arr[i] };
}
async function loadEpg(silent) {
  if (epg.loading) return;
  epg.loading = true;
  try {
    let n = 0;
    for (const l of state.lists) {
      const u = l.epg || deriveXmltv(l.url);
      const wanted = new Set(l.channels.filter((c) => c.tvgId).map((c) => c.tvgId.toLowerCase()));
      if (!u || !wanted.size) continue;
      if (!silent) toast('📅 Descargando guía de ' + l.name + '…');
      const m = parseXmltv(await fetchText(u), wanted);
      m.forEach((v, k) => epg.map.set(k, v));
      n += m.size;
    }
    epg.loaded = Date.now(); state.epgAuto = true; saveMeta();
    if (!silent) toast(n ? `📅 Guía cargada: ${n} canales` : 'La guía no trae canales que coincidan con tu lista', !n);
  } catch (e) { if (!silent) toast('Guía: ' + (e.message || e), true); }
  epg.loading = false;
  render();
}

/* ---------- Tarjetas: insignias, guía y progreso ---------- */
const _chCard = chCard;
chCard = function (c) {
  let h = _chCard(c);
  const k = kindOf(c);
  if (k === 'live') {
    const q = qualityOf(c.name);
    if (isDead(c)) h = h.replace('<div class="n">', '<span class="q dead">Caído</span><div class="n">');
    else if (q) h = h.replace('<div class="n">', `<span class="q q${q}">${QN[q]}</span><div class="n">`);
    const e = epgNow(c);
    if (e && e.now) h = h.replace('<div class="row">', `<div class="epg">▶ ${esc(e.now.t)}</div><div class="row">`);
  } else {
    const x = hist()[c.url];
    if (x && x.done) h = h.replace('<div class="n">', '<div class="seen">✓ Visto</div><div class="n">');
    else if (x && x.dur && x.pos > 30) h = h.replace('<div class="n">', `<div class="bar"><i style="width:${Math.min(100, Math.round(x.pos / x.dur * 100))}%"></i></div><div class="n">`);
  }
  return h;
};
function contCard(h) {
  const ico = ICON[h.kind] || '🎬';
  const pct = h.dur ? Math.min(100, Math.round(h.pos / h.dur * 100)) : 0;
  const logo = h.logo ? `<img src="${esc(h.logo)}" loading="lazy" onerror="this.outerHTML='<div class=ph>${ico}</div>'">` : `<div class="ph">${ico}</div>`;
  return `<div class="ch poster">${logo}<div class="bar"><i style="width:${pct}%"></i></div><div class="n">${esc(h.name)}</div>
    <div class="g">${fmtT(h.pos)}${h.dur ? ' / ' + fmtT(h.dur) : ''}</div>
    <div class="row"><button class="btn green small" data-act="play" data-url="${esc(h.url)}" data-name="${esc(h.name)}">▶</button>
    <button class="btn pink small" data-act="hist-del" data-url="${esc(h.url)}">✕</button></div></div>`;
}

/* ---------- Inicio con filas ---------- */
const row = (title, cards) => (cards.length ? `<h2>${title}</h2><div class="hrow">${cards.join('')}</div>` : '');
async function loadTrend() {
  ui.trendLoading = true;
  try {
    const d = await tmdb('/trending/all/week');
    ui.trend = (d.results || []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 20);
    const recs = new Map();
    for (const h of histItems().filter((x) => x.kind !== 'live').slice(0, 3)) {
      try {
        const f = await tmdbFind(h.name, h.kind);
        if (!f) continue;
        const r = await tmdb(`/${f.type}/${f.id}/recommendations`);
        (r.results || []).slice(0, 8).forEach((x) => { x.media_type = x.media_type || f.type; recs.set(x.id, x); });
      } catch (e) {}
    }
    ui.recs = [...recs.values()].slice(0, 20);
  } catch (e) { ui.trend = []; ui.recs = []; }
  ui.trendLoading = false;
  if (ui.view === 'home') render();
}
function homeRows() {
  const cont = histItems().filter((h) => h.kind !== 'live' && h.pos > 30 && !h.done && histVisible(h)).slice(0, 20);
  let out = row('▶️ Continuar viendo', cont.map(contCard));
  const fresh = [];
  for (const l of state.lists) {
    for (let i = l.channels.length - 1; i >= 0 && fresh.length < 20; i--) { const c = l.channels[i]; if (kindOf(c) === 'movie' && vis(c)) fresh.push(c); }
  }
  out += row('🆕 Últimas películas de tu lista', fresh.map((c) => chCard(c)));
  if ((state.tmdb || '').trim()) {
    if (!ui.trend && !ui.trendLoading) loadTrend();
    out += row('🔥 Tendencias de la semana (TMDB)', (ui.trend || []).map(tmdbCard));
    out += row('🎯 Recomendado para ti', (ui.recs || []).map(tmdbCard));
  }
  return out;
}
const _home = views.home;
views.home = function () {
  const marker = '<button class="btn pink" data-act="nav" data-id="add">';
  const h = _home();
  const i = h.indexOf(marker);
  const rows = homeRows();
  return i < 0 ? h + rows : h.slice(0, i) + rows + h.slice(i);
};

/* ---------- Historial ---------- */
views.history = function () {
  const items = histItems().filter(histVisible).slice(0, 100);
  const rows = items.map((h) => `<div class="list-row"><div><div class="t">${ICON[h.kind] || ''} ${esc(h.name)}</div>
    <div class="muted">${new Date(h.t).toLocaleString()}${h.kind !== 'live' && h.dur ? ' · ' + fmtT(h.pos) + ' / ' + fmtT(h.dur) : ''}${h.done ? ' · ✓ visto' : ''}</div></div>
    <div><button class="btn green small" data-act="play" data-url="${esc(h.url)}" data-name="${esc(h.name)}">▶</button>
    <button class="btn pink small" data-act="hist-del" data-url="${esc(h.url)}">✕</button></div></div>`).join('');
  return `<h1>🕘 Historial</h1><p class="muted">${items.length} recientes</p>${rows || '<p class="muted card">Todavía no has visto nada.</p>'}
    ${items.length ? '<button class="btn pink" data-act="hist-clear">🗑️ Borrar historial</button>' : ''}`;
};
function statsCard() {
  const hs = Object.values(hist());
  const sec = hs.reduce((a, h) => a + (h.kind === 'live' ? 0 : (h.pos || 0)), 0);
  const cnt = (k) => hs.filter((h) => h.kind === k).length;
  const hideAdult = curKids() || (parentalOn() && !ui.unlocked);
  const g = {};
  hs.forEach((h) => { if (h.group && !(hideAdult && ADULT_WORDS.test(h.group))) g[h.group] = (g[h.group] || 0) + 1; });
  const top = Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0]).join(', ');
  return `<div class="card"><h2>📊 Tu resumen</h2><p>${(sec / 3600).toFixed(1)} h de películas y series · ${cnt('movie')} películas · ${cnt('series')} episodios · ${cnt('live')} canales distintos</p>
    ${top ? `<p class="muted">Lo que más ves: ${esc(top)}</p>` : ''}</div>`;
}
const _settings = views.settings;
views.settings = function () {
  const h = _settings(), marker = '<div class="card"><h2>🔄 Actualizaciones</h2>';
  return h.replace(marker, themeCard() + statsCard() + marker);
};

/* ---------- Perfiles ---------- */
views.profiles = function () {
  const cards = state.profiles.map((p) => `<div class="ch pcard ${p.id === state.cur ? 'cur' : ''}"><div class="ph">${p.kids ? '🧒' : '🙂'}</div>
    <div class="n">${esc(p.name)}</div><div class="g">${p.kids ? 'Infantil' : 'Normal'}${p.id === state.cur ? ' · activo' : ''}</div>
    <div class="row"><button class="btn green small" data-act="pf-switch" data-id="${p.id}">Usar</button>
    ${state.profiles.length > 1 && p.id !== state.cur ? `<button class="btn pink small" data-act="pf-del" data-id="${p.id}">🗑️</button>` : ''}</div></div>`).join('');
  return `<h1>👤 Perfiles</h1><p class="muted">Cada perfil tiene sus propios favoritos e historial.</p>
    ${parentalOn() ? '<input id="pf-pin" type="password" inputmode="numeric" maxlength="8" placeholder="PIN (para salir de un perfil infantil o borrar)">' : ''}
    <div class="grid">${cards}</div>
    <div class="card"><h2>➕ Nuevo perfil</h2><input id="pf-name" placeholder="Nombre">
      <label style="display:block;margin-top:10px"><input type="checkbox" id="pf-kids" style="width:auto"> Perfil infantil (sin contenido adulto ni ajustes)</label>
      <button class="btn green" data-act="pf-add">Crear</button></div>`;
};
async function pinGate() {
  if (!parentalOn()) return true;
  const el = $('#pf-pin');
  return !!(await pinOk(el ? el.value.trim() : ''));
}
function switchProfile(id) {
  syncProfile();
  state.cur = id;
  ensureProfiles();
  ui.unlocked = false; ui.view = 'home'; ui.trend = null; ui.recs = null; ui.dfilter = '';
  saveMeta(); render();
}
NAV.splice(NAV.findIndex((n) => n[0] === 'favs') + 1, 0, ['history', '🕘 Historial', '#4895ef'], ['profiles', '👤 Perfiles', '#52b788']);

/* ---------- Búsqueda por voz ---------- */
const _search = views.search;
views.search = function () { return _search().replace('autocomplete="off">', 'autocomplete="off"><button class="btn pink small" data-act="voice">🎤 Voz</button>'); };

/* ---------- Canales: barra de herramientas ---------- */
const _channels = views.channels;
views.channels = function () {
  const tools = `<div class="tabs tools"><button class="tab" data-act="epg-load">📅 ${epg.loaded ? 'Actualizar guía' : 'Cargar guía'}</button>
    <button class="tab" data-act="probe">🩺 Revisar caídos</button>
    <button class="tab ${ui.hideDead ? 'active' : ''}" data-act="tg-dead">Ocultar caídos</button>
    <button class="tab ${ui.dedupe ? 'active' : ''}" data-act="tg-dedupe">Sin duplicados</button>
    <button class="tab ${ui.byQuality ? 'active' : ''}" data-act="tg-quality">Mejor calidad primero</button></div>`;
  return _channels().replace('<div class="filters">', tools + '<div class="filters">');
};

/* ---------- Eventos ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest && e.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act, id = el.dataset.id;
  try {
    if (a === 'set-theme') { state.theme = id; applyTheme(); saveMeta(); render(); }
    else if (a === 'zap-prev') zap(-1);
    else if (a === 'zap-next') zap(1);
    else if (a === 'next-now') { clearInterval(nextTimer); if (ctx && ctx.kind === 'series' && ctx.i + 1 < ctx.items.length) { const n = ctx.items[ctx.i + 1]; play(n.url, n.name); } }
    else if (a === 'next-cancel') { clearInterval(nextTimer); $('#player-msg').textContent = ''; }
    else if (a === 'close-player') { clearInterval(nextTimer); if (window.__finishPlay) window.__finishPlay(false); }
    else if (a === 'hist-del') { delete hist()[el.dataset.url]; saveMeta(); render(); }
    else if (a === 'hist-clear') { if (confirm('¿Borrar el historial de este perfil?')) { state.hist = {}; saveMeta(); render(); } }
    else if (a === 'epg-load') await loadEpg(false);
    else if (a === 'probe') await probeVisible();
    else if (a === 'tg-dead') { ui.hideDead = !ui.hideDead; render(); }
    else if (a === 'tg-dedupe') { ui.dedupe = !ui.dedupe; render(); }
    else if (a === 'tg-quality') { ui.byQuality = !ui.byQuality; render(); }
    else if (a === 'tmdb-save') { ui.trend = null; ui.recs = null; }
    else if (a === 'trailer') window.open('https://www.youtube.com/watch?v=' + el.dataset.key);
    else if (a === 'voice') {
      const P = extPlugin();
      if (!P || !P.voice) return toast('La búsqueda por voz solo está en la app de Android (versión nueva)', true);
      const r = await P.voice();
      if (r && r.text) { ui.gq = r.text; ui.gkind = 'all'; render(); }
    }
    else if (a === 'pf-switch') {
      const p = state.profiles.find((x) => x.id === id);
      if (curKids() && !p.kids && !(await pinGate())) return toast('PIN incorrecto', true);
      switchProfile(id);
    }
    else if (a === 'pf-add') {
      const name = ($('#pf-name').value || '').trim(), kids = !!$('#pf-kids').checked;
      if (!name) return toast('Escribe un nombre', true);
      if (kids && !parentalOn()) return toast('Primero activa el control parental (PIN) en Ajustes', true);
      if (curKids() && !(await pinGate())) return toast('PIN incorrecto', true);
      state.profiles.push({ id: uid(), name, kids, favs: [], hist: {} });
      saveMeta(); toast('Perfil creado'); render();
    }
    else if (a === 'pf-del') {
      if (!(await pinGate())) return toast('PIN incorrecto', true);
      state.profiles = state.profiles.filter((x) => x.id !== id);
      saveMeta(); render();
    }
  } catch (err) { toast('Error: ' + (err.message || err), true); }
});

function afterBoot() {
  applyTheme();
  if ((state.profiles || []).length > 1) ui.view = 'profiles';
  if (state.epgAuto) setTimeout(() => loadEpg(true), 1500);
}
