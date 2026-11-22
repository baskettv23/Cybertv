/* ================= Zona Deportes =================
   Marcadores en vivo (feed público de ESPN) + tus canales de deportes agrupados por tipo.
   "Toca para ver" busca el partido entre los canales de TUS listas. */
(function () {
  const LEAGUES = [
    ['football/nfl', 'NFL', 'americano'], ['football/college-football', 'NCAAF', 'americano'],
    ['basketball/nba', 'NBA', 'basquet'], ['baseball/mlb', 'MLB', 'beisbol'],
    ['soccer/mex.1', 'Liga MX', 'futbol'], ['soccer/usa.1', 'MLS', 'futbol'],
    ['soccer/uefa.champions', 'Champions', 'futbol'], ['soccer/esp.1', 'LaLiga', 'futbol'],
    ['soccer/eng.1', 'Premier', 'futbol'], ['hockey/nhl', 'NHL', 'otros']
  ];
  const CATS = [
    ['all', 'Todos', null],
    ['usa', 'Sports USA', /\busa\b|\bus\b|espn|fox sports|nbc sports|cbs sports|nfl|nba|mlb|nhl|tnt sports|golf channel/i],
    ['mx', 'Sports MX', /\bmx\b|m[eé]xico|tudn|azteca dep|izzi|claro sports/i],
    ['ppv', 'PPV', /\bppv\b|pay.?per.?view|ufc|wwe|boxeo|box\b|fight/i],
    ['futbol', 'Fútbol', /f[uú]tbol|soccer|liga|premier|champions|uefa|copa|mls|bein|tudn|laliga|libertadores/i],
    ['americano', 'Americano', /nfl|americano|ncaa|college football/i],
    ['basquet', 'Básquetbol', /nba|b[aá]squet|basket|wnba|ncaab/i],
    ['beisbol', 'Béisbol', /mlb|b[eé]isbol|baseball/i]
  ];
  const SPORT_RE = /sport|deport|espn|tudn|dazn|bein|nfl|nba|mlb|nhl|ufc|wwe|fight|f[uú]tbol|soccer|liga|premier|champions|\bppv\b|golf|tennis|motogp|\bf1\b|arena|win sports|eleven|nbc sports|cbs sports|tnt/i;
  const ICON = { all: '🏆', usa: '🇺🇸', mx: '🇲🇽', ppv: '🥊', futbol: '⚽', americano: '🏈', basquet: '🏀', beisbol: '⚾' };

  const txt = (c) => (c.name || '') + ' ' + (c.group || '');
  function sportChannels() {
    return allChannels().filter((c) => kindOf(c) === 'live' && SPORT_RE.test(txt(c)));
  }
  function inCat(c, cat) {
    if (cat === 'all') return true;
    const re = CATS.find((x) => x[0] === cat)[2];
    if (!re.test(txt(c))) return false;
    if (cat === 'usa' && /\bmx\b|m[eé]xico/i.test(txt(c))) return false;
    return true;
  }

  /* ---------- Marcadores ---------- */
  const sp = (ui.sp = ui.sp || { t: 0, games: [], busy: false, err: '' });
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/';
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo agotado')), ms))]);

  function parseGames(json, lg) {
    const out = [];
    for (const ev of (json && json.events) || []) {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors) continue;
      const side = (ha) => {
        const c = comp.competitors.find((x) => x.homeAway === ha);
        if (!c || !c.team) return null;
        return { name: c.team.displayName || '', short: c.team.shortDisplayName || c.team.displayName || '',
          logo: c.team.logo || '', score: c.score != null ? String(c.score) : '', rec: (c.records && c.records[0] && c.records[0].summary) || '' };
      };
      const home = side('home'), away = side('away');
      if (!home || !away) continue;
      const st = (ev.status && ev.status.type) || {};
      out.push({ id: lg[0] + ':' + ev.id, lg: lg[1], cat: lg[2], state: st.state || 'pre',
        detail: st.shortDetail || '', clock: ev.status && ev.status.displayClock || '', period: ev.status && ev.status.period || 0,
        date: ev.date || '', home, away });
    }
    return out;
  }
  async function loadScores(force) {
    if (sp.busy || (!force && Date.now() - sp.t < 55000)) return;
    sp.busy = true;
    try {
      const res = await Promise.all(LEAGUES.map(async (lg) => {
        try {
          const r = await withTimeout(fetch(ESPN + lg[0] + '/scoreboard'), 9000);
          if (!r.ok) return [];
          return parseGames(await r.json(), lg);
        } catch (e) { return []; }
      }));
      const all = [].concat(...res);
      const rank = { in: 0, pre: 1, post: 2 };
      all.sort((a, b) => rank[a.state] - rank[b.state] || String(a.date).localeCompare(String(b.date)));
      sp.games = all; sp.t = Date.now(); sp.err = all.length ? '' : 'No hay partidos o no se pudo conectar con el servicio de marcadores.';
    } catch (e) { sp.err = 'No se pudieron cargar los marcadores.'; }
    sp.busy = false;
    if (ui.view === 'sports') render();
  }

  /* ---------- Vistas ---------- */
  const timeOf = (g) => { try { const d = new Date(g.date); return isNaN(d) ? g.detail : d.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' }); } catch (e) { return g.detail; } };
  function mid(g) {
    if (g.state === 'pre') return `<div class="sp-sc">${esc(timeOf(g))}</div><div class="sp-sub">Próximo</div>`;
    return `<div class="sp-sc">${esc(g.away.score)} – ${esc(g.home.score)}</div>` +
      (g.state === 'in' ? `<div class="sp-sub live">${esc(g.detail)}</div>` : `<div class="sp-sub">Final</div>`);
  }
  const badge = (g) => g.state === 'in' ? '<span class="sp-live">● EN VIVO</span>' : g.state === 'pre' ? '<span class="sp-pre">Próximo</span>' : '<span class="sp-pre">Final</span>';
  const logo = (t) => t.logo ? `<img src="${esc(t.logo)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : '<span class="sp-ph">🏟️</span>';
  function bigCard(g) {
    return `<div class="sp-big" data-act="sp-watch" data-id="${esc(g.id)}" tabindex="0">
      <div class="sp-top"><span class="sp-lg">${esc(g.lg)}</span>${badge(g)}</div>
      <div class="sp-teams"><div class="sp-t">${logo(g.away)}<b>${esc(g.away.name)}</b><small>${esc(g.away.rec)}</small></div>
        <div class="sp-m">${mid(g)}</div>
        <div class="sp-t">${logo(g.home)}<b>${esc(g.home.name)}</b><small>${esc(g.home.rec)}</small></div></div>
      <div class="sp-go">▶ Toca para ver</div></div>`;
  }
  function rowCard(g) {
    return `<div class="sp-row" data-act="sp-watch" data-id="${esc(g.id)}" tabindex="0">
      <div class="sp-top"><span class="sp-lg">${esc(g.lg)}</span>${badge(g)}</div>
      <div class="sp-line"><div class="sp-rt">${logo(g.away)}<div><b>${esc(g.away.short)}</b><small>${esc(g.away.rec)}</small></div></div>
        <div class="sp-m">${mid(g)}</div>
        <div class="sp-rt right"><div><b>${esc(g.home.short)}</b><small>${esc(g.home.rec)}</small></div>${logo(g.home)}</div></div></div>`;
  }

  views.sports = function () {
    loadScores(false);
    const cat = ui.spCat || 'all';
    const chans = sportChannels();
    const chips = CATS.map((c) => {
      const n = chans.filter((x) => inCat(x, c[0])).length;
      return `<button class="sp-chip ${cat === c[0] ? 'on' : ''}" data-act="sp-cat" data-id="${c[0]}">${ICON[c[0]]} ${c[1]} <span>${n}</span></button>`;
    }).join('');
    const games = sp.games.filter((g) => cat === 'all' || cat === 'usa' || cat === 'mx' || cat === 'ppv' || g.cat === cat);
    const featured = games.filter((g) => g.state === 'in');
    const feat = (featured.length ? featured : games.filter((g) => g.state === 'pre')).slice(0, 6);
    const shown = games.slice(0, 40);
    const list = chans.filter((x) => inCat(x, cat));
    const lim = ui.spMore || 60;
    return `<h1>🏆 Zona Deportes</h1>
      <p class="muted">Marcadores de ESPN · tus canales de deportes ${sp.busy ? '· actualizando…' : ''}
        <button class="btn pink small" data-act="sp-refresh">🔄</button></p>
      ${feat.length ? `<div class="sp-car">${feat.map(bigCard).join('')}</div><div class="sp-dots">${feat.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : `<p class="muted">${sp.busy ? 'Cargando marcadores…' : esc(sp.err || 'No hay partidos en vivo ahora.')}</p>`}
      <div class="sp-list">${shown.map(rowCard).join('')}</div>
      <div class="sp-chips">${chips}</div>
      <h2 style="margin-top:14px">📺 Canales (${list.length})</h2>
      ${chans.length ? '' : '<p class="muted">No encontré canales de deportes en tus listas. Se buscan nombres como ESPN, Fox Sports, TUDN, NFL, NBA, PPV…</p>'}
      <div class="grid">${list.slice(0, lim).map((c) => chCard(c)).join('')}</div>
      ${list.length > lim ? '<button class="btn pink" data-act="sp-more">Ver más</button>' : ''}`;
  };
  NAV.splice(NAV.findIndex((n) => n[0] === 'series') + 1, 0, ['sports', '🏆 Deportes', '#00b4d8']);

  /* ---------- Buscar el partido en tus canales ---------- */
  function words(t) { return (t || '').toLowerCase().split(/\s+/).filter((w) => w.length > 3); }
  function watch(id) {
    const g = sp.games.find((x) => x.id === id);
    if (!g) return;
    const chans = sportChannels();
    const names = [g.home.short, g.away.short, g.home.name, g.away.name].map((s) => s.toLowerCase());
    const exact = chans.filter((c) => { const t = txt(c).toLowerCase(); return names.some((n) => n && t.includes(n)); });
    const catRe = (CATS.find((x) => x[0] === g.cat) || [])[2];
    const related = chans.filter((c) => !exact.includes(c) && catRe && catRe.test(txt(c)));
    const rest = chans.filter((c) => !exact.includes(c) && !related.includes(c));
    const pick = [...exact, ...related, ...rest].slice(0, 18);
    const rows = pick.map((c) => `<div class="opt" data-act="play" data-url="${esc(c.url)}" data-name="${esc(c.name)}"><span class="radio"></span><div><b>${esc(c.name)}</b><small>${esc(c.group)}</small></div></div>`).join('');
    setInfo(`<h2 class="center">${esc(g.away.name)} vs ${esc(g.home.name)}</h2>
      <p class="muted center">${esc(g.lg)} · ${g.state === 'in' ? 'En vivo ' + esc(g.detail) : g.state === 'pre' ? 'Empieza ' + esc(timeOf(g)) : 'Terminado'}</p>
      <p class="muted center">Canales de tus listas donde podría estar:</p>
      ${rows || '<p class="muted center">No hay canales de deportes en tus listas.</p>'}
      <button class="btn red small" data-act="close-info">✕ Cerrar</button>`);
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-act]');
    if (!el) return;
    const a = el.dataset.act, id = el.dataset.id;
    if (a === 'sp-watch') watch(id);
    else if (a === 'sp-cat') { ui.spCat = id; ui.spMore = 60; render(); }
    else if (a === 'sp-refresh') { loadScores(true); render(); }
    else if (a === 'sp-more') { ui.spMore = (ui.spMore || 60) + 60; render(); }
    else if (a === 'play' && el.closest('#info')) closeInfo();
  });
  // puntitos del carrusel
  document.addEventListener('scroll', (e) => {
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('sp-car')) return;
    const i = Math.round(t.scrollLeft / Math.max(1, t.clientWidth));
    const dots = t.nextElementSibling && t.nextElementSibling.children;
    if (dots) for (let k = 0; k < dots.length; k++) dots[k].className = k === i ? 'on' : '';
  }, true);
  setInterval(() => { if (ui.view === 'sports' && !document.hidden) loadScores(true); }, 60000);
  window.__sports = { parseGames, inCat, CATS };
})();
