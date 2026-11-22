/* ===== Fondo de pósters que van cambiando (de las películas de TUS listas) ===== */
(function () {
  const COLS = 8, EVERY = [7000, 13000];
  let box = null, pool = [], poolAt = 0, timers = [], running = false;
  const on = () => state.bgPosters !== false;

  function buildPool() {
    let all = [];
    try { all = allChannels().filter((c) => c.logo && kindOf(c) === 'movie'); } catch (e) {}
    const n = Math.min(all.length, 160), out = [], seen = new Set();
    for (let i = 0; i < n * 3 && out.length < n; i++) {
      const c = all[Math.floor(Math.random() * all.length)];
      if (c && !seen.has(c.logo)) { seen.add(c.logo); out.push(c.logo); }
    }
    pool = out; poolAt = Date.now();
  }
  const pick = () => {
    if (!pool.length || Date.now() - poolAt > 300000) buildPool();
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
  };
  function swap(tile) {
    if (!running || document.hidden) return;
    const url = pick();
    if (!url) return;
    const im = new Image();
    im.onload = () => {
      const back = tile.querySelector('.cur');
      const nx = document.createElement('div');
      nx.className = 'bgp-img';
      nx.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
      tile.appendChild(nx);
      requestAnimationFrame(() => requestAnimationFrame(() => { nx.classList.add('show'); }));
      setTimeout(() => { if (back) back.remove(); nx.classList.add('cur'); }, 1600);
    };
    im.onerror = () => {};
    im.referrerPolicy = 'no-referrer';
    im.src = url;
  }
  function schedule(tile) {
    const t = setTimeout(() => { swap(tile); schedule(tile); }, EVERY[0] + Math.random() * (EVERY[1] - EVERY[0]));
    timers.push(t);
  }
  function start() {
    if (running || !on() || !document.body) return;
    running = true;
    box = document.createElement('div');
    box.id = 'bgposters';
    for (let i = 0; i < COLS; i++) { const t = document.createElement('div'); t.className = 'bgp-tile'; box.appendChild(t); }
    document.body.insertBefore(box, document.body.firstChild);
    [...box.children].forEach((t, i) => { setTimeout(() => swap(t), 300 + i * 450); schedule(t); });
  }
  function stop() {
    running = false;
    timers.forEach(clearTimeout); timers = [];
    if (box) { box.remove(); box = null; }
  }
  window.bgApply = function () { if (on()) start(); else stop(); };

  const _set = views.settings;
  views.settings = function () {
    const h = _set(), marker = '<div class="card"><h2>Copia de seguridad</h2>';
    const b = (v, t) => `<button class="tab ${(on() ? 'on' : 'off') === v ? 'active' : ''}" data-act="set-bg" data-id="${v}">${t}</button>`;
    const card = `<div class="card"><h2>🖼️ Fondo de pósters</h2><p class="muted">Pósters de las películas de tus listas que cambian solos detrás de la app.</p><div class="tabs">${b('on', 'Activado')}${b('off', 'Apagado')}</div></div>`;
    return h.includes(marker) ? h.replace(marker, card + marker) : h + card;
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-act="set-bg"]');
    if (!el) return;
    state.bgPosters = el.dataset.id === 'on'; saveMeta(); bgApply(); render();
  });
  document.addEventListener('DOMContentLoaded', () => setTimeout(bgApply, 2500));
  setTimeout(() => { if (document.readyState !== 'loading') bgApply(); }, 3500);
})();
