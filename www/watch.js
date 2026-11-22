/* ===== ▶ Ver desde las tarjetas de TMDB: busca el título en TUS listas ===== */
(function () {
  const _card = tmdbCard;
  tmdbCard = function (r) {
    const h = _card(r);
    const t = r.title || r.name || '', o = r.original_title || r.original_name || '';
    const btn = `<button class="btn green small" data-act="tmdb-play" data-type="${esc(r.media_type)}" data-name="${esc(t)}" data-orig="${esc(o)}">▶ Ver</button>`;
    return h.replace('<div class="row">', '<div class="row">' + btn);
  };
  const stripCat = (s) => nrm(s);
  function find(type, names) {
    const keys = names.map(stripCat).filter((k) => k.length >= 2);
    if (!keys.length) return [];
    const kind = type === 'tv' ? 'series' : 'movie';
    const pool = allChannels().filter((c) => kindOf(c) === kind);
    const title = (c) => stripCat(kind === 'series' ? seriesTitle(c.name) : cleanTitle(c.name));
    let m = pool.filter((c) => keys.includes(title(c)));
    if (!m.length) m = pool.filter((c) => { const t = title(c); return keys.some((k) => k.length >= 5 && (t.startsWith(k + ' ') || t === k)); });
    return m;
  }
  function go(el) {
    const type = el.dataset.type, name = el.dataset.name;
    const m = find(type, [name, el.dataset.orig]);
    if (!m.length) {
      setInfo(`<h2 class="center">${esc(name)}</h2><p class="center">😕 No está en tus listas.</p>
        <p class="muted center">Puedes buscarlo en tus cuentas de Real-Debrid / TorBox con el botón ⚡ de la película.</p>
        <div class="row" style="justify-content:center"><button class="btn yellow" data-act="deb-find" data-name="${esc(name)}">⚡ Buscar en mi Debrid</button>
        <button class="btn red small" data-act="close-info">✕ Cerrar</button></div>`);
      return;
    }
    if (type === 'tv') {
      const st = seriesTitle(m[0].name);
      closeInfo(); ui.view = 'series'; ui.series = st; ui.group = 'all'; ui.q = ''; ui.plat = 'all';
      render(); return;
    }
    if (m.length === 1) { closeInfo(); play(m[0].url, m[0].name); return; }
    const rows = m.slice(0, 15).map((c) => `<div class="opt" data-act="play" data-url="${esc(c.url)}" data-name="${esc(c.name)}"><span class="radio"></span><div><b>${esc(c.name)}</b><small>${esc(c.group)}</small></div></div>`).join('');
    setInfo(`<h2 class="center">${esc(name)}</h2><p class="muted center">Está en tus listas ${m.length} veces. Elige cuál:</p>${rows}<button class="btn red small" data-act="close-info">✕ Cerrar</button>`);
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-act="tmdb-play"]');
    if (el) go(el);
  });
  window.__watch = { find };
})();
