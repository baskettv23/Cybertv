/* ================= Películas y series por plataforma =================
   Clasifica por el nombre del grupo (y etiquetas tipo [Netflix] en el título) de TUS listas. */
(function () {
  const PLATS = [
    ['netflix', '🔴 Netflix', /netflix|\bnflx\b/i],
    ['disney', '🏰 Disney+', /disney|pixar|\bd\+/i],
    ['prime', '🔵 Prime Video', /prime|amazon/i],
    ['hbo', '🟣 HBO Max', /\bhbo\b|\bmax\b|warner/i],
    ['apple', '⚪ Apple TV+', /apple/i],
    ['paramount', '⛰️ Paramount+', /paramount/i],
    ['hulu', '🟢 Hulu', /\bhulu\b/i],
    ['star', '⭐ Star+', /star\s?\+|\bstarplus\b/i],
    ['peacock', '🦚 Peacock', /peacock/i],
    ['crunchy', '🍥 Crunchyroll', /crunchyroll/i]
  ];
  const TAG = /[\[(]\s*(netflix|nf|disney\+?|prime|amazon|hbo(?: max)?|max|apple(?: tv\+?)?|paramount\+?|hulu|star\+?|peacock|crunchyroll)\s*[\])]/i;
  const TAGMAP = { nf: 'netflix', amazon: 'prime', max: 'hbo' };

  function platOf(c) {
    if (c._pl !== undefined) return c._pl;
    let r = '';
    const g = c.group || '';
    for (const p of PLATS) if (p[2].test(g)) { r = p[0]; break; }
    if (!r) {
      const m = TAG.exec(c.name || '');
      if (m) {
        let k = m[1].toLowerCase().replace(/[+ ].*$/, '');
        k = TAGMAP[k] || k;
        r = (PLATS.find((p) => p[0] === k || p[0].startsWith(k)) || [''])[0];
      }
    }
    try { Object.defineProperty(c, '_pl', { value: r, enumerable: false, writable: true }); } catch (e) {}
    return r;
  }

  const _browse = browse;
  browse = function (kind, favOnly) {
    if (favOnly || kind === 'live' || (kind === 'series' && ui.series)) return _browse(kind, favOnly);
    const plat = ui.plat || 'all';
    const all = allChannels().filter((c) => kindOf(c) === kind);
    const counts = {};
    for (const c of all) { const p = platOf(c); if (p) counts[p] = (counts[p] || 0) + 1; }
    const have = PLATS.filter((p) => counts[p[0]]);
    let h;
    if (plat === 'all') h = _browse(kind, favOnly);
    else {
      const _a = allChannels;
      allChannels = () => _a().filter((c) => platOf(c) === plat);
      try { h = _browse(kind, favOnly); } finally { allChannels = _a; }
    }
    if (!have.length) return h;
    const chip = (id, label, n) => `<button class="sp-chip ${plat === id ? 'on' : ''}" data-act="plat" data-id="${id}">${label}${n != null ? ` <span>${n}</span>` : ''}</button>`;
    const bar = `<div class="sp-chips">${chip('all', '🎞️ Todas', all.length)}${have.map((p) => chip(p[0], p[1], counts[p[0]])).join('')}</div>`;
    const i = h.indexOf('</h1>');
    return i < 0 ? bar + h : h.slice(0, i + 5) + bar + h.slice(i + 5);
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-act="plat"]');
    if (!el) return;
    ui.plat = el.dataset.id; ui.group = 'all'; ui.series = null;
    render();
  });
  window.__plat = { platOf };
})();
