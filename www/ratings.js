/* ===== 🍅 Calificaciones (Rotten Tomatoes, IMDb, Metacritic) vía OMDb =====
   Necesita una clave gratis de omdbapi.com (se guarda solo en este dispositivo). */
(function () {
  const cache = new Map();
  const _info = infoHtml;
  infoHtml = function (type, d) {
    return _info(type, d).replace('<p class="overview">', '<div id="rt-box" class="rt-box"></div><p class="overview">');
  };
  async function imdbId(type, id) {
    if (type === 'movie') {
      const d = await tmdb('/movie/' + id);
      return d.imdb_id || '';
    }
    const e = await tmdb('/tv/' + id + '/external_ids');
    return e.imdb_id || '';
  }
  async function ratings(type, id) {
    const key = (state.omdb || '').trim();
    const ck = type + ':' + id + ':' + key;
    if (cache.has(ck)) return cache.get(ck);
    const imdb = await imdbId(type, id);
    if (!imdb) throw new Error('Sin código IMDb para este título');
    const r = await fetch('https://www.omdbapi.com/?i=' + encodeURIComponent(imdb) + '&apikey=' + encodeURIComponent(key));
    const j = await r.json().catch(() => null);
    if (!j || j.Response === 'False') throw new Error((j && j.Error) || 'OMDb HTTP ' + r.status);
    const out = { imdb, rt: '', imdbR: j.imdbRating && j.imdbRating !== 'N/A' ? j.imdbRating : '', meta: '' };
    for (const x of j.Ratings || []) {
      if (x.Source === 'Rotten Tomatoes') out.rt = x.Value;
      else if (x.Source === 'Metacritic') out.meta = x.Value.split('/')[0];
    }
    if (j.Metascore && j.Metascore !== 'N/A') out.meta = out.meta || j.Metascore;
    cache.set(ck, out);
    return out;
  }
  function badges(o) {
    const n = parseInt(o.rt, 10);
    const tom = o.rt ? `<span class="rt-b ${n >= 60 ? 'fresh' : 'rotten'}">${n >= 60 ? '🍅' : '🤢'} ${esc(o.rt)}</span>` : '';
    const im = o.imdbR ? `<span class="rt-b">⭐ IMDb ${esc(o.imdbR)}</span>` : '';
    const mc = o.meta ? `<span class="rt-b">Ⓜ️ ${esc(o.meta)}</span>` : '';
    return tom + im + mc || '<span class="muted">Sin calificaciones disponibles.</span>';
  }
  async function fill(type, id) {
    const box = document.querySelector('#rt-box');
    if (!box) return;
    if (!(state.omdb || '').trim()) {
      box.innerHTML = '<span class="muted">🍅 Para ver Rotten Tomatoes agrega tu clave gratis de OMDb en Ajustes.</span>';
      return;
    }
    box.innerHTML = '<span class="muted">🍅 Buscando calificaciones…</span>';
    try {
      const o = await ratings(type, id);
      const b = document.querySelector('#rt-box'); if (b) b.innerHTML = badges(o);
    } catch (e) {
      const b = document.querySelector('#rt-box'); if (b) b.innerHTML = `<span class="muted">🍅 ${esc(e.message || e)}</span>`;
    }
  }
  const _show = showTmdb;
  showTmdb = async function (type, id) {
    await _show(type, id);
    fill(type, id);
  };

  const _set = views.settings;
  views.settings = function () {
    const h = _set(), marker = '<div class="card"><h2>Copia de seguridad</h2>';
    const card = `<div class="card"><h2>🍅 Calificaciones (Rotten Tomatoes)</h2>
      <p class="muted">Clave gratis en omdbapi.com → API Key. Se usa para mostrar Rotten Tomatoes, IMDb y Metacritic en la ficha de cada película o serie. Se guarda solo en este dispositivo.</p>
      <input id="omdb-key" type="password" placeholder="Pega tu clave de OMDb" autocomplete="off" value="${esc(state.omdb || '')}">
      <button class="btn green" data-act="omdb-save">💾 Guardar</button></div>`;
    return h.includes(marker) ? h.replace(marker, card + marker) : h + card;
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-act="omdb-save"]');
    if (!el) return;
    state.omdb = ($('#omdb-key').value || '').trim();
    saveMeta(); cache.clear();
    toast(state.omdb ? '✅ Clave de OMDb guardada' : 'Clave borrada');
  });
  window.__ratings = { ratings, badges };
})();
