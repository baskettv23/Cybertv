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
    if (m.length === 1 && !el.dataset.pick) { closeInfo(); play(m[0].url, m[0].name); return; }
    // Mejor calidad primero
    const sorted = m.slice().sort((a, b) => qualityOf(b.name) - qualityOf(a.name));
    const QL = ['', 'SD', 'HD 720p', 'Full HD 1080p', '4K'];
    const listOf = (c) => { const l = state.lists.find((x) => x.channels.includes(c)); return l ? l.name : ''; };
    const tags = (n) => [/\b(hdr10?\+?|hdr|dolby ?vision|dv)\b/i.test(n) ? 'HDR' : '', /\b(lat(ino)?|dual)\b/i.test(n) ? 'Latino' : '', /\bsub(s|titulad[oa])?\b/i.test(n) ? 'Subtitulada' : '', /\b(esp|castellano)\b/i.test(n) ? 'Español' : '', /\b(ing|eng)\b/i.test(n) ? 'Inglés' : ''].filter(Boolean).join(' · ');
    const rows = sorted.slice(0, 20).map((c, i) => {
      const q = qualityOf(c.name);
      return `<div class="opt" data-act="play" data-url="${esc(c.url)}" data-name="${esc(c.name)}"><span class="radio"></span><div><b>${i === 0 && q >= 2 ? '⭐ ' : ''}${q ? QL[q] : 'Calidad sin indicar'}${tags(c.name) ? ' · ' + esc(tags(c.name)) : ''}</b><small>${esc(c.name)} — ${esc(listOf(c) || c.group)}</small></div></div>`;
    }).join('');
    setInfo(`<h2 class="center">${esc(name)}</h2><p class="muted center">${sorted.length} ${sorted.length === 1 ? 'versión' : 'versiones'} en tus listas, de mejor a menor calidad. Elige:</p>${rows}
      <p class="muted center">¿Quieres más calidad? Prueba ⚡ para ver si ya la tienes en tu Real-Debrid o TorBox.</p>
      <div class="row" style="justify-content:center"><button class="btn yellow small" data-act="deb-find" data-name="${esc(name)}">⚡ En mis cuentas Debrid</button><button class="btn red small" data-act="close-info">✕ Cerrar</button></div>`);
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-act="tmdb-play"]');
    if (el) go(el);
  });
  // En la ficha de TMDB: botón para elegir la calidad
  const _info = infoHtml;
  infoHtml = function (type, d) {
    const h = _info(type, d);
    const t = d.title || d.name || '', o = d.original_title || d.original_name || '';
    const btn = `<button class="btn green small" data-act="tmdb-play" data-pick="1" data-type="${esc(type)}" data-name="${esc(t)}" data-orig="${esc(o)}">🎞️ Ver / elegir calidad</button>`;
    return h.replace('<div class="info-actions">', '<div class="info-actions">' + btn);
  };
  window.__watch = { find };
})();
