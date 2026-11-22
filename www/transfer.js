/* ===== 📡 Pasar listas de un aparato a otro (misma red Wi‑Fi), sin escribir las URLs ===== */
(function () {
  const xf = (ui.xfer = ui.xfer || { mode: 'idle', pin: '', ip: '', devices: [], sel: '', msg: '', busy: false });
  let recvTimer = null, hooked = false;
  const P = () => (typeof extPlugin === 'function' ? extPlugin() : null);
  const can = () => isAndroid() && P() && P().startReceiver;
  const redraw = () => { if (ui.view === 'settings') render(); };

  function payload(withKeys) {
    const withUrl = state.lists.filter((l) => l.url);
    const out = { v: 1, lists: withUrl.map((l) => ({ name: l.name, url: l.url, epg: l.epg || '' })), skipped: state.lists.length - withUrl.length };
    if (withKeys) out.keys = { tmdb: state.tmdb || '', omdb: state.omdb || '', debrid: state.debrid || null };
    return out;
  }

  async function apply(raw) {
    let d;
    try { d = JSON.parse(raw); } catch (e) { xf.msg = '⚠️ Llegaron datos dañados.'; redraw(); return; }
    const lists = Array.isArray(d.lists) ? d.lists : [];
    let added = 0, had = 0, failed = 0;
    for (let i = 0; i < lists.length; i++) {
      const l = lists[i];
      if (!l || !/^https?:\/\//i.test(l.url || '')) { failed++; continue; }
      if (state.lists.some((x) => x.url === l.url)) { had++; continue; }
      xf.msg = `⏳ Descargando lista ${i + 1} de ${lists.length}: ${l.name || ''}…`; redraw();
      try {
        const text = await fetchText(l.url);
        if (addList(l.name, l.url, text)) added++; else failed++;
      } catch (e) { failed++; }
    }
    if (d.keys) {
      if (d.keys.tmdb) state.tmdb = d.keys.tmdb;
      if (d.keys.omdb) state.omdb = d.keys.omdb;
      if (d.keys.debrid && (d.keys.debrid.rd || d.keys.debrid.tb)) state.debrid = d.keys.debrid;
      saveMeta();
    }
    xf.msg = `✅ Listo: ${added} lista(s) nuevas` + (had ? `, ${had} ya estaban` : '') + (failed ? `, ${failed} no se pudieron descargar` : '') + (d.keys ? '. Claves recibidas.' : '.');
    toast(xf.msg);
    stopRecv(true);
    redraw();
  }

  async function startRecv() {
    const p = P();
    if (!hooked && p.addListener) { hooked = true; p.addListener('received', (ev) => apply(ev && ev.data)); }
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    try {
      const r = await p.startReceiver({ pin });
      Object.assign(xf, { mode: 'recv', pin, ip: r.ip || '', msg: r.ip ? '' : '⚠️ No veo la red Wi‑Fi. Conecta este aparato al Wi‑Fi.' });
      clearTimeout(recvTimer); recvTimer = setTimeout(() => stopRecv(false), 10 * 60 * 1000);
    } catch (e) { xf.msg = '⚠️ ' + (e.message || e); }
    redraw();
  }
  async function stopRecv(keepMsg) {
    clearTimeout(recvTimer);
    try { const p = P(); if (p && p.stopReceiver) await p.stopReceiver(); } catch (e) {}
    xf.mode = 'idle'; xf.pin = ''; if (!keepMsg) xf.msg = '';
    redraw();
  }
  async function scan() {
    xf.mode = 'scan'; xf.devices = []; xf.msg = '🔎 Buscando aparatos en tu Wi‑Fi… (unos segundos)'; xf.busy = true; redraw();
    try {
      const r = await P().scanReceivers();
      xf.devices = r.devices || [];
      xf.msg = r.noWifi ? '⚠️ Conecta este aparato al Wi‑Fi.' : xf.devices.length ? '' : 'No encontré ninguno. En la otra pantalla abre Ajustes → Pasar listas → "Recibir", o escribe su dirección abajo.';
    } catch (e) { xf.msg = '⚠️ ' + (e.message || e); }
    xf.busy = false; redraw();
  }
  async function send() {
    const ip = (xf.sel || ($('#xf-ip') && $('#xf-ip').value) || '').trim();
    const pin = ($('#xf-pin') && $('#xf-pin').value || '').trim();
    if (!ip) { toast('Elige el aparato o escribe su dirección', true); return; }
    if (!/^\d{4}$/.test(pin)) { toast('Escribe el PIN de 4 números que muestra la otra pantalla', true); return; }
    const withKeys = !!($('#xf-keys') && $('#xf-keys').checked);
    const body = payload(withKeys);
    if (!body.lists.length) { toast('No hay listas con enlace para enviar (las de archivo no se pueden pasar)', true); return; }
    xf.msg = '📤 Enviando…'; redraw();
    try {
      await P().sendToReceiver({ ip, pin, data: JSON.stringify(body) });
      xf.msg = `✅ Enviadas ${body.lists.length} lista(s).` + (body.skipped ? ` (${body.skipped} de archivo no se envían.)` : '') + ' La otra pantalla las está descargando.';
      toast('✅ Enviado');
    } catch (e) { xf.msg = '⚠️ ' + (e.message || e); toast(xf.msg, true); }
    redraw();
  }

  function card() {
    let h = '<div class="card"><h2>📡 Pasar listas a otro aparato</h2>';
    if (!isAndroid()) return h + '<p class="muted">Esta función está en la app de Android (tablet, celular o TV).</p></div>';
    if (!can()) return h + '<p class="muted">Actualiza la app para usar esta función.</p></div>';
    h += '<p class="muted">Sin escribir nada a mano. Los dos aparatos deben estar en el mismo Wi‑Fi.<br><b>1.</b> En la TV: toca “Recibir”. <b>2.</b> En la tablet: toca “Enviar” y elige la TV.</p>';
    if (xf.mode === 'recv') {
      h += `<div class="xf-big">PIN: <b>${esc(xf.pin)}</b></div><p class="muted">Dirección: ${esc(xf.ip || '—')} · Esperando que la otra pantalla envíe las listas…</p>
        <button class="btn red" data-act="xf-stop">✕ Dejar de recibir</button>`;
    } else if (xf.mode === 'scan') {
      h += xf.devices.map((d) => `<div class="opt ${xf.sel === d.ip ? 'sel' : ''}" data-act="xf-pick" data-id="${esc(d.ip)}"><span class="radio"></span><div><b>${esc(d.name || 'DANNYTV')}</b><small>${esc(d.ip)}</small></div></div>`).join('');
      h += `<input id="xf-ip" placeholder="o escribe la dirección (ej. 192.168.1.20)" value="${esc(xf.sel || '')}" inputmode="decimal">
        <input id="xf-pin" placeholder="PIN de 4 números (lo muestra la TV)" inputmode="numeric" maxlength="4" autocomplete="off" value="${esc(xf.pinIn || '')}">
        <label class="muted" style="display:block;margin:8px 0"><input id="xf-keys" type="checkbox" checked style="width:auto"> Enviar también mis claves (TMDB, OMDb, Real‑Debrid, TorBox)</label>
        <button class="btn green" data-act="xf-send">📤 Enviar</button>
        <button class="btn pink" data-act="xf-scan">🔄 Buscar otra vez</button>
        <button class="btn red small" data-act="xf-stop">Cancelar</button>`;
    } else {
      h += `<button class="btn green" data-act="xf-recv">📺 Recibir en este aparato</button>
        <button class="btn yellow" data-act="xf-scan">📤 Enviar a otro aparato</button>`;
    }
    if (xf.msg) h += `<p style="margin-top:10px">${esc(xf.msg)}</p>`;
    return h + '<p class="muted" style="margin-top:8px">Se envían solo los enlaces de tus listas (la TV las descarga). Va por tu red local, sin internet.</p></div>';
  }

  const _set = views.settings;
  views.settings = function () {
    const h = _set(), marker = '<div class="card"><h2>🔒 Control parental</h2>';
    return h.includes(marker) ? h.replace(marker, card() + marker) : h + card();
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-act^="xf-"]');
    if (!el) return;
    const a = el.dataset.act;
    if (a === 'xf-recv') startRecv();
    else if (a === 'xf-scan') scan();
    else if (a === 'xf-stop') { xf.mode = 'idle'; xf.msg = ''; stopRecv(false); }
    else if (a === 'xf-pick') { const pi = $('#xf-pin'); xf.pinIn = pi ? pi.value : ''; xf.sel = el.dataset.id; redraw(); }
    else if (a === 'xf-send') { const pi = $('#xf-pin'); xf.pinIn = pi ? pi.value : ''; send(); }
  });
  window.__xfer = { payload, apply, card };
})();
