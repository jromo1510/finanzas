/* =========================================================================
 * FINANZAS - app (PWA). Misma logica que la Intranet Financiera, adaptada a
 * teléfono, con cuentas creadas por el usuario (Corriente / Ahorro) y metas.
 * Habla con Codigo.gs (Apps Script) por fetch; ver api().
 * ========================================================================= */
'use strict';

const CFG = Object.assign({ CURRENCY: 'S/', LOCALE: 'es-PE', SYNC_INTERVAL_MS: 15000, APP_NAME: 'Finanzas', APP_VERSION: '1.0.0' }, window.APP_CONFIG || {});
const CAT_TRANSF = 'TRANSF. CUENTAS';
const CAT_SALDO_INI = 'SALDO INICIAL';
const CAT_PROTEGIDAS = [CAT_SALDO_INI, CAT_TRANSF];
const COLORES = ['#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#64d2ff', '#ffd60a', '#ac8e68', '#5e5ce6', '#8e8e93'];
const ICONOS_META = ['🎯', '🏖️', '✈️', '🏠', '🚗', '🎓', '💍', '👶', '🐶', '💻', '📱', '🎁', '🏥', '🛟', '💰', '🎉'];

/* ============================ ESTADO ============================ */
const S = {
  token: null, user: null,
  movs: [], cuentas: [], metas: [], cats: [], locked: [], fijosAplicados: [], saldos: {}, fijos: null,
  serverToday: null, version: -1,
  month: firstOfMonth(new Date()),
  filter: '',
  sel: new Set(), selMode: false,
  tab: 'inicio',
  lastSync: 0, pending: 0, loaded: false,
  sumTab: 'total',
  calView: 'month', week: null, deficits: [],
  idx: { cta: new Map(), enlace: new Map(), meta: new Map() }
};

/* ============================ UTILIDADES ============================ */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const pad = n => ('0' + n).slice(-2);
function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function dstr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function pd(s) { const p = String(s).split('-'); return new Date(+p[0], (+p[1]) - 1, +(p[2] || 1)); }
function addDays(s, n) { const d = pd(s); d.setDate(d.getDate() + n); return dstr(d); }
function satOf(s) { const d = pd(s); d.setDate(d.getDate() + (6 - d.getDay())); return dstr(d); }
function today() { const local = dstr(new Date()); return (S.serverToday && S.serverToday > local) ? S.serverToday : local; }
function monthKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
function monthLabel(d) { const s = d.toLocaleDateString(CFG.LOCALE, { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); }
function dayLabel(s, opts) { return pd(s).toLocaleDateString(CFG.LOCALE, opts || { weekday: 'long', day: 'numeric', month: 'long' }); }
function shortDate(s) { return pd(s).toLocaleDateString(CFG.LOCALE, { day: 'numeric', month: 'short' }); }
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmt(n) { return Number(n || 0).toLocaleString(CFG.LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmt0(n) { return Math.round(Number(n || 0)).toLocaleString(CFG.LOCALE, { maximumFractionDigits: 0 }); }
function money(n) { return (n < 0 ? '-' : '') + CFG.CURRENCY + ' ' + fmt(Math.abs(n)); }
function moneyPlus(n) { return (n > 0 ? '+' : n < 0 ? '-' : '') + CFG.CURRENCY + ' ' + fmt(Math.abs(n)); }
function compact(n) {
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a >= 1e6) return sign + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e5) return sign + Math.round(a / 1000) + 'k';
  return sign + fmt0(a);
}
function parseAmount(v) { const n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(/,/g, '.')); return isNaN(n) ? 0 : Math.round(n * 100) / 100; }
function sum(arr, f) { let t = 0; arr.forEach(x => { t += f ? f(x) : x; }); return t; }
function haptic() { try { navigator.vibrate && navigator.vibrate(8); } catch (e) {} }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const store = {
  get(k, def) { try { const v = localStorage.getItem('fin.' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem('fin.' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('fin.' + k); } catch (e) {} }
};

/* ============================ API ============================ */
class ApiError extends Error { constructor(msg, auth) { super(msg); this.auth = !!auth; } }

// URL del servidor: la de js/config.js si esta configurada; si no, la que se pego en la pantalla
// de ingreso (queda guardada en el telefono). Asi, subir un config.js sin URL no deja la app inutil.
const API_URL_RE = /^https:\/\/script\.google(usercontent)?\.com\/.+/;
function apiUrl() {
  if (CFG.API_URL && API_URL_RE.test(CFG.API_URL)) return CFG.API_URL;
  const saved = store.get('apiUrl', '');
  return API_URL_RE.test(saved) ? saved : '';
}

async function api(action, ...args) {
  const body = JSON.stringify({ a: action, t: S.token, p: args });
  let res;
  if (window.LOCAL_SERVER) {                       // dev.html: Codigo.gs corre en el navegador
    await sleep(action === 'getVersion' ? 30 : 220);
    res = JSON.parse(window.LOCAL_SERVER(body));
  } else {
    const url = apiUrl();
    if (!url) throw new ApiError('Falta la URL del servidor. Pegala en la pantalla de ingreso.');
    let r;
    try {
      r = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', cache: 'no-store' });
    } catch (e) {
      throw new ApiError(navigator.onLine === false ? 'Sin conexión a internet. Revisa tu señal e intenta de nuevo.' : 'No se pudo conectar con el servidor.');
    }
    const text = await r.text();
    try { res = JSON.parse(text); } catch (e) { throw new ApiError('Respuesta inesperada del servidor. Revisa que la implementación esté publicada para "Cualquier usuario".'); }
  }
  if (!res.ok) {
    if (res.auth) { onSessionExpired(res.e); }
    throw new ApiError(res.e || 'Error desconocido', res.auth);
  }
  return res.r;
}

// Envuelve una escritura: bloquea el sync mientras vuela, aplica el parche y avisa errores.
async function write(action, args, opts) {
  opts = opts || {};
  S.pending++;
  setBusy(true);
  try {
    const res = await api(action, ...args);
    if (res && (res.patches || res.meta)) applyPatch(res);
    if (!opts.noRefresh) refreshUI();
    if (opts.ok) toast(opts.ok, 'ok');
    return res;
  } catch (e) {
    if (opts.onError) opts.onError(e);
    if (!e.auth) toast(e.message, 'error');
    throw e;
  } finally {
    S.pending = Math.max(0, S.pending - 1);
    setBusy(S.pending > 0);
  }
}
function quiet(p) { p.catch(() => {}); }

/* ============================ DATOS / INDICES ============================ */
function applyMeta(m) {
  if (!m) return;
  if (m.cuentas) S.cuentas = m.cuentas;
  if (m.metas) S.metas = m.metas;
  if (m.categorias && m.categorias.length) S.cats = m.categorias;
  if (m.lockedWeeks) S.locked = m.lockedWeeks;
  if (m.fijosAplicados) S.fijosAplicados = m.fijosAplicados;
  if (m.saldos) S.saldos = m.saldos;
  if (m.serverToday) S.serverToday = m.serverToday;
  if (typeof m.version === 'number') S.version = m.version;
  if (m.user) { S.user = Object.assign({}, S.user, m.user); store.set('user', S.user); }
}
function upsertMov(p) {
  if (!p || !p.id) return;
  const i = S.movs.findIndex(x => x.id === p.id);
  if (i === -1) { if (typeof p.monto === 'number') S.movs.push(Object.assign({}, p)); return; }
  Object.assign(S.movs[i], p);
}
function removeMov(id) { const i = S.movs.findIndex(x => x.id === id); if (i !== -1) S.movs.splice(i, 1); }
function applyPatch(res) {
  (res.patches || []).forEach(upsertMov);
  (res.deletedIds || []).forEach(id => { removeMov(id); S.sel.delete(id); });
  applyMeta(res.meta);
}
function reindex() {
  S.idx.cta = new Map(S.cuentas.map(c => [c.id, c]));
  S.idx.meta = new Map(S.metas.map(m => [m.id, m]));
  const en = new Map();
  S.movs.forEach(m => { if (m.enlace) { if (!en.has(m.enlace)) en.set(m.enlace, []); en.get(m.enlace).push(m); } });
  S.idx.enlace = en;
}
function saveCache() {
  store.set('cache', { movs: S.movs, cuentas: S.cuentas, metas: S.metas, cats: S.cats, locked: S.locked, fijosAplicados: S.fijosAplicados, saldos: S.saldos, serverToday: S.serverToday, version: S.version, ts: Date.now() });
}
function loadCache() {
  const c = store.get('cache', null);
  if (!c) return false;
  S.movs = c.movs || []; S.cuentas = c.cuentas || []; S.metas = c.metas || []; S.cats = c.cats || [];
  S.locked = c.locked || []; S.fijosAplicados = c.fijosAplicados || []; S.saldos = c.saldos || {}; S.serverToday = c.serverToday;
  S.version = -1; // forzar recarga real al conectar
  S.lastSync = c.ts || 0;
  return true;
}

const cta = id => S.idx.cta.get(id);
const ctaName = id => (cta(id) || {}).nombre || 'Cuenta';
const ctaColor = id => (cta(id) || {}).color || '#8e8e93';
const isAhorro = id => ((cta(id) || {}).tipo === 'Ahorro');
const isCorr = id => !isAhorro(id);
const activeCuentas = tipo => S.cuentas.filter(c => c.activa && (!tipo || c.tipo === tipo));
const getMov = id => S.movs.find(m => m.id === id);
function partnerOf(m) { if (!m || !m.enlace) return null; return (S.idx.enlace.get(m.enlace) || []).find(x => x.id !== m.id) || null; }
function withPartners(ids) {
  const out = new Map();
  ids.forEach(id => { const m = getMov(id); if (!m) return; out.set(m.id, m); const p = partnerOf(m); if (p) out.set(p.id, p); });
  return Array.from(out.values());
}
function isLockedDate(s) { return S.locked.includes(satOf(s)); }
function lockExempt(m) { return m.categoria === CAT_SALDO_INI || isAhorro(m.cuentaId); }
function isMovLocked(m) {
  if (!lockExempt(m) && isLockedDate(m.fecha)) return true;
  const p = partnerOf(m);
  return !!(p && !lockExempt(p) && isLockedDate(p.fecha));
}

// "Flujo" = cuentas corrientes (como IBK/BCP en la intranet); el filtro del calendario lo acota a una.
function inFlow(m) { return isCorr(m.cuentaId) && (!S.filter || m.cuentaId === S.filter); }
function balanceUpTo(dateStr, realOnly, pred) {
  pred = pred || inFlow;
  let b = 0;
  for (const m of S.movs) if (m.fecha <= dateStr && (!realOnly || m.estado === 'Real') && pred(m)) b += m.monto;
  return b;
}
function ctaBalance(id, realOnly, upTo) {
  let b = 0;
  for (const m of S.movs) if (m.cuentaId === id && (!realOnly || m.estado === 'Real') && (!upTo || m.fecha <= upTo)) b += m.monto;
  return b;
}
function movClass(m) {
  if (m.estado === 'Real') return m.monto >= 0 ? 'real' : 'real out';
  return m.fecha < today() ? 'venc' : 'proy';
}
function sortByOrden(a, b) { return (a.orden || 0) - (b.orden || 0); }
function vencidos() {
  const t = today();
  return S.movs.filter(m => m.estado === 'Proyectado' && m.fecha < t && !(m.enlace && m.tipo === 'Ingreso' && partnerOf(m)))
    .sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : sortByOrden(a, b));
}
function metaStats(meta) {
  let real = 0, proy = 0;
  for (const m of S.movs) if (m.metaId === meta.id) { proy += m.monto; if (m.estado === 'Real') real += m.monto; }
  const obj = meta.objetivo || 0;
  const st = { real, proy, obj, pct: obj > 0 ? Math.max(0, Math.min(1, real / obj)) : 0, pctProy: obj > 0 ? Math.max(0, Math.min(1, proy / obj)) : 0, falta: Math.max(0, obj - real), done: obj > 0 && real >= obj - 0.005 };
  if (meta.fechaLimite) {
    const t = pd(today()), f = pd(meta.fechaLimite);
    const days = Math.round((f - t) / 86400000);
    st.vencida = days < 0;
    st.meses = Math.max(1, Math.ceil(days / 30.44));
    st.porMes = st.falta / st.meses;
    if (meta.creado && meta.creado < meta.fechaLimite) {
      const total = (f - pd(meta.creado)) / 86400000, elapsed = Math.max(0, (t - pd(meta.creado)) / 86400000);
      st.esperado = obj * Math.min(1, elapsed / total);
      st.ritmo = real - st.esperado;
    }
  }
  return st;
}

/* ============================ UI BASICA ============================ */
function setBusy(on) { document.body.classList.toggle('busy', !!on); }

function toast(msg, type, action) {
  const wrap = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + (type || 'info');
  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);
  let timer;
  const kill = () => { clearTimeout(timer); el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { kill(); action.fn(); };
    el.appendChild(b);
  }
  el.addEventListener('click', e => { if (e.target === el || e.target === span) kill(); });
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  timer = setTimeout(kill, action ? 7000 : (type === 'error' ? 6000 : 2600));
}
function toastUndo(msg, fn) { toast(msg, 'info', { label: 'Deshacer', fn }); }

/* ---------- Hojas (bottom sheets) apiladas, con soporte del botón "atras" de Android ---------- */
const sheets = [];
let ignorePops = 0;

function openSheet(o) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = '<div class="sheet-backdrop" data-act="closeSheet"></div>' +
    '<div class="sheet' + (o.tall ? ' tall' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="sheet-head"><div class="grab"></div>' +
        '<button class="sh-btn" data-act="closeSheet">' + (o.closeLabel || 'Cerrar') + '</button>' +
        '<h3 class="sh-title"></h3><span class="sh-right"></span></div>' +
      '<div class="sheet-body"></div></div>';
  document.body.appendChild(wrap);
  const sh = { o, wrap, el: $('.sheet', wrap), body: $('.sheet-body', wrap), state: o.state || {} };
  sh.render = () => {
    $('.sh-title', wrap).textContent = typeof o.title === 'function' ? o.title(sh) : (o.title || '');
    $('.sh-right', wrap).innerHTML = o.right ? o.right(sh) : '';
    const scroll = sh.body.scrollTop;
    sh.body.innerHTML = o.render(sh);
    sh.body.scrollTop = scroll;
    if (o.mount) o.mount(sh);
  };
  sheets.push(sh);
  sh.render();
  enableSheetDrag(sh);
  requestAnimationFrame(() => wrap.classList.add('open'));
  document.body.classList.add('sheet-open');
  try { history.pushState({ sheet: sheets.length }, ''); } catch (e) {}
  if (o.focus) setTimeout(() => { const f = $(o.focus, sh.body); if (f) f.focus(); }, 320);
  return sh;
}
function removeSheet(sh) {
  const i = sheets.indexOf(sh);
  if (i === -1) return;
  sheets.splice(i, 1);
  sh.wrap.classList.remove('open');
  setTimeout(() => sh.wrap.remove(), 280);
  if (!sheets.length) document.body.classList.remove('sheet-open');
  if (sh.o.onClose) sh.o.onClose(sh);
}
function closeSheet(sh) {
  sh = sh || sheets[sheets.length - 1];
  if (!sh || sheets.indexOf(sh) === -1) return;
  removeSheet(sh);
  ignorePops++;
  try { history.back(); } catch (e) { ignorePops--; }
}
function closeAllSheets() { while (sheets.length) closeSheet(sheets[sheets.length - 1]); }
function topSheet() { return sheets[sheets.length - 1]; }
function findSheet(kind) { return sheets.find(s => s.o.kind === kind); }
window.addEventListener('popstate', () => {
  if (ignorePops > 0) { ignorePops--; return; }
  if (dialogOpen) { dialogOpen.cancel(); return; }
  const sh = topSheet();
  if (sh) removeSheet(sh);
});
function enableSheetDrag(sh) {
  const head = $('.sheet-head', sh.wrap);
  let y0 = null, dy = 0;
  head.addEventListener('touchstart', e => { if (e.target.closest('button')) return; y0 = e.touches[0].clientY; dy = 0; sh.el.style.transition = 'none'; }, { passive: true });
  head.addEventListener('touchmove', e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); sh.el.style.transform = 'translateY(' + dy + 'px)'; }, { passive: true });
  head.addEventListener('touchend', () => {
    if (y0 == null) return;
    sh.el.style.transition = ''; sh.el.style.transform = '';
    if (dy > 110) closeSheet(sh);
    y0 = null;
  });
}

/* ---------- Dialogos (confirmar / texto / fecha / elegir) ---------- */
let dialogOpen = null;
function dialog(html, setup) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'dlg-wrap';
    wrap.innerHTML = '<div class="dlg">' + html + '</div>';
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    const done = v => { if (!dialogOpen) return; dialogOpen = null; wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 200); resolve(v); };
    dialogOpen = { cancel: () => done(null) };
    wrap.addEventListener('click', e => {
      if (e.target === wrap) return done(null);
      const b = e.target.closest('[data-v]');
      if (b) done(b.dataset.v === '__input' ? $('input,select', wrap).value : b.dataset.v);
    });
    const inp = $('input,select', wrap);
    if (inp) {
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(inp.value); } });
      setTimeout(() => { inp.focus(); if (inp.select) inp.select(); }, 60);
    }
    if (setup) setup(wrap, done);
  });
}
function ask(title, msg, okLabel, danger) {
  return dialog('<h4>' + esc(title) + '</h4>' + (msg ? '<p>' + esc(msg) + '</p>' : '') +
    '<div class="dlg-btns"><button data-v="0">Cancelar</button><button data-v="1" class="' + (danger ? 'danger' : 'primary') + '">' + esc(okLabel || 'Aceptar') + '</button></div>').then(v => v === '1');
}
function askText(title, value, placeholder) {
  return dialog('<h4>' + esc(title) + '</h4><input class="inp" type="text" value="' + esc(value || '') + '" placeholder="' + esc(placeholder || '') + '" autocapitalize="characters">' +
    '<div class="dlg-btns"><button data-v="">Cancelar</button><button data-v="__input" class="primary">Aceptar</button></div>').then(v => (v == null ? null : String(v).trim()) || null);
}
function askDate(title, value) {
  return dialog('<h4>' + esc(title) + '</h4><input class="inp" type="date" value="' + esc(value || today()) + '">' +
    '<div class="dlg-btns"><button data-v="">Cancelar</button><button data-v="__input" class="primary">Mover</button></div>').then(v => v || null);
}
function pick(title, options) {
  return dialog('<h4>' + esc(title) + '</h4><div class="dlg-list">' +
    options.map(o => '<button data-v="' + esc(o.value) + '">' + esc(o.label) + '</button>').join('') +
    '</div><div class="dlg-btns"><button data-v="">Cancelar</button></div>').then(v => v || null);
}

/* ============================ ICONOS ============================ */
const IC = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>',
  piggy: '<svg viewBox="0 0 24 24"><path d="M5 11a7 6 0 0 1 7-6h1a7 6 0 0 1 6.3 3.5L21 9v4l-1.8.6A7 6 0 0 1 17 16.5V20h-3v-2.2a8 8 0 0 1-3 0V20H8v-3.2A6 6 0 0 1 5 12.5H3v-3h2.2"/><circle cx="15.5" cy="10" r=".9" fill="currentColor"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>',
  chevL: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
  chevR: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16m0 4v-4h-4"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>'
};

/* ============================ LOGIN ============================ */
function renderLogin(msg) {
  document.body.classList.remove('logged');
  $('#app').innerHTML =
    '<div class="login">' +
      '<div class="login-card">' +
        '<img src="icons/icon-192.png" alt="" class="login-logo">' +
        '<h1>' + esc(CFG.APP_NAME) + '</h1>' +
        '<p class="muted">Solo para ustedes dos. Ingresa con tu usuario.</p>' +
        '<form data-form="login" autocomplete="on">' +
          (window.LOCAL_SERVER || apiUrl() ? '' : '<label class="fld"><span>URL del servidor (Apps Script)</span><input name="apiurl" type="url" inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="https://script.google.com/macros/s/.../exec" required>' +
            '<small class="muted">Se pide una sola vez. Está en Apps Script → Implementar → Administrar implementaciones.</small></label>') +
          '<label class="fld"><span>Usuario</span><input name="usuario" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>' +
          '<label class="fld"><span>Contraseña</span><input name="clave" type="password" autocomplete="current-password" required></label>' +
          (msg ? '<div class="login-err">' + esc(msg) + '</div>' : '') +
          '<button class="btn primary big" type="submit">Entrar</button>' +
        '</form>' +
      '</div>' +
      '<p class="login-foot muted">v' + esc(CFG.APP_VERSION) +
        (store.get('apiUrl', '') && !API_URL_RE.test(CFG.API_URL || '') ? ' · <button class="link small" data-act="resetUrl">Cambiar URL del servidor</button>' : '') + '</p>' +
    '</div>';
  const u = store.get('lastUser', '');
  if (u) { $('[name=usuario]').value = u; $('[name=clave]').focus(); }
}
async function doLogin(form) {
  const btn = $('button[type=submit]', form);
  const usuario = form.usuario.value.trim(), clave = form.clave.value;
  if (form.apiurl) {
    const u = form.apiurl.value.trim();
    if (!API_URL_RE.test(u) || !/\/exec$/.test(u)) { renderLogin('Esa URL no parece la del servidor: debe empezar con https://script.google.com/ y terminar en /exec.'); return; }
    store.set('apiUrl', u);
  }
  btn.disabled = true; btn.textContent = 'Entrando...';
  try {
    const dev = (navigator.userAgent.match(/\(([^)]+)\)/) || [, ''])[1].slice(0, 60);
    const r = await api('login', usuario, clave, dev);
    S.token = r.token; S.user = { usuario: r.usuario, nombre: r.nombre };
    store.set('token', S.token); store.set('user', S.user); store.set('lastUser', r.usuario);
    startApp();
  } catch (e) {
    renderLogin(e.message);
    $('[name=usuario]').value = usuario;
  }
}
function onSessionExpired(msg) {
  S.token = null;
  store.del('token');
  closeAllSheets();
  renderLogin(msg || 'Tu sesión expiró.');
}
async function logout() {
  if (!(await ask('Cerrar sesión', 'Tendrás que volver a ingresar tu usuario y contraseña en este dispositivo.', 'Cerrar sesión', true))) return;
  quiet(api('logout'));
  S.token = null; store.del('token'); store.del('cache');
  S.movs = []; S.cuentas = []; S.loaded = false;
  closeAllSheets();
  renderLogin();
}

/* ============================ SHELL / NAVEGACION ============================ */
function renderShell() {
  document.body.classList.add('logged');
  $('#app').innerHTML =
    '<main id="view"></main>' +
    '<div id="selbar" class="selbar" hidden></div>' +
    '<nav class="tabbar">' +
      tabBtn('inicio', IC.home, 'Inicio') + tabBtn('calendario', IC.cal, 'Calendario') +
      '<button class="tab-add" data-act="newMov" aria-label="Nuevo movimiento">' + IC.plus + '</button>' +
      tabBtn('ahorro', IC.piggy, 'Ahorro') + tabBtn('mas', IC.more, 'Más') +
    '</nav>';
}
function tabBtn(id, icon, label) { return '<button class="tab" data-act="tab" data-tab="' + id + '">' + icon + '<span>' + label + '</span></button>'; }
function goTab(t) {
  if (!['inicio', 'calendario', 'ahorro', 'mas'].includes(t)) t = 'inicio';
  const changed = S.tab !== t;
  S.tab = t;
  store.set('tab', t);
  try { history.replaceState(history.state, '', location.pathname + location.search + '#' + t); } catch (e) {}
  renderView();
  if (changed) window.scrollTo(0, 0);
}
function renderView() {
  const v = $('#view');
  if (!v) return;
  $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  v.className = 'view-' + S.tab;
  v.innerHTML = ({ inicio: viewInicio, calendario: viewCalendario, ahorro: viewAhorro, mas: viewMas })[S.tab]();
}
function refreshUI() {
  reindex();
  saveCache();
  renderView();
  refreshSheets();
  renderSelbar();
}
function refreshSheets() { sheets.forEach(sh => { if (sh.o.live) (sh.o.update ? sh.o.update(sh) : sh.render()); }); }
function syncLabel() {
  if (!S.lastSync) return '';
  const s = Math.round((Date.now() - S.lastSync) / 1000);
  return s < 20 ? 'Al día' : s < 60 ? 'hace ' + s + ' s' : s < 3600 ? 'hace ' + Math.round(s / 60) + ' min' : 'hace ' + Math.round(s / 3600) + ' h';
}
function topbar(title, right, sub) {
  return '<header class="top"><div class="top-row"><h1>' + title + '</h1><div class="top-right">' + (right || '') + '</div></div>' + (sub ? '<div class="top-sub">' + sub + '</div>' : '') + '</header>';
}
function syncChip() {
  const stale = S.lastSync && Date.now() - S.lastSync > 90000;
  return '<button class="sync-chip' + (stale ? ' stale' : '') + '" data-act="forceSync" title="Sincronizar">' + IC.sync + '<span id="syncLbl">' + esc(syncLabel()) + '</span></button>';
}

/* ============================ INICIO ============================ */
function viewInicio() {
  const nombre = (S.user && S.user.nombre) ? S.user.nombre.split(' ')[0] : '';
  let h = topbar('Hola' + (nombre ? ', ' + esc(nombre) : ''), syncChip());
  if (!S.loaded && !S.movs.length && !S.cuentas.length) return h + '<div class="empty"><div class="spinner"></div><p>Cargando tus datos...</p></div>';
  if (!S.cuentas.length) {
    return h + '<section class="card onboard"><div class="onb-emoji">👋</div><h2>Empecemos</h2>' +
      '<p>Crea tus cuentas. Las <b>corrientes</b> (sueldo, gastos del día a día) forman tu flujo disponible; las de <b>ahorro</b> van aparte y pueden tener metas.</p>' +
      '<button class="btn primary big" data-act="newCuenta" data-tipo="Corriente">Crear cuenta corriente</button>' +
      '<button class="btn big" data-act="newCuenta" data-tipo="Ahorro">Crear cuenta de ahorro</button></section>';
  }
  const t = today();
  const corr = activeCuentas('Corriente'), aho = activeCuentas('Ahorro');
  const pred = m => isCorr(m.cuentaId);
  const disp = sum(S.movs.filter(m => m.estado === 'Real' && pred(m)), m => m.monto);
  const finMes = dstr(new Date(pd(t).getFullYear(), pd(t).getMonth() + 1, 0));
  const proyFin = balanceUpTo(finMes, false, pred);
  const ahorro = sum(S.movs.filter(m => m.estado === 'Real' && isAhorro(m.cuentaId)), m => m.monto);

  h += '<section class="hero"><div class="hero-lbl">Disponible en cuentas corrientes</div>' +
    '<div class="hero-amt' + (disp < 0 ? ' neg' : '') + '">' + money(disp) + '</div>' +
    '<div class="hero-row"><span>Fin de mes (con proyectados)</span><b class="' + (proyFin < 0 ? 'neg' : '') + '">' + money(proyFin) + '</b></div>' +
    (aho.length ? '<div class="hero-row"><span>Ahorrado</span><b>' + money(ahorro) + '</b></div>' : '') + '</section>';

  h += '<div class="acc-scroll">' + corr.concat(aho).map(c => {
    const b = ctaBalance(c.id, true);
    return '<button class="acc" data-act="' + (c.tipo === 'Ahorro' ? 'openCuentaHist' : 'openCuentaHist') + '" data-id="' + c.id + '" style="--c:' + c.color + '">' +
      '<span class="acc-tipo">' + (c.tipo === 'Ahorro' ? 'Ahorro' : 'Corriente') + '</span><span class="acc-name">' + esc(c.nombre) + '</span>' +
      '<span class="acc-bal' + (b < 0 ? ' neg' : '') + '">' + money(b) + '</span></button>';
  }).join('') + '<button class="acc add" data-act="newCuenta">' + IC.plus + '<span>Cuenta</span></button></div>';

  // Alertas: proyectados vencidos + ruptura de caja del mes actual
  const venc = vencidos();
  if (venc.length) {
    h += '<button class="alert warn" data-act="openVencidos"><span class="al-ico">⏰</span><span><b>' + venc.length + ' proyectado(s) vencido(s)</b><br><small>Fecha pasada y aún sin ejecutar. Toca para revisar.</small></span></button>';
  }
  const deficit = deficitDays(firstOfMonth(pd(t)), m => isCorr(m.cuentaId)).filter(d => d.fecha >= t);
  if (deficit.length) {
    h += '<button class="alert danger" data-act="goCal"><span class="al-ico">🚨</span><span><b>Ruptura de caja el ' + esc(dayLabel(deficit[0].fecha, { day: 'numeric', month: 'long' })) + '</b><br><small>El saldo proyectado llegaría a ' + money(deficit[0].saldo) + '. Revisa el calendario.</small></span></button>';
  }

  // Cuadre con el banco
  if (corr.length) {
    const r = cuadre();
    h += '<section class="card"><div class="card-head"><h2>Cuadre con el banco</h2><button class="link" data-act="openCuadre">Actualizar</button></div>';
    if (!r.hayDatos) h += '<p class="muted small">Anota el saldo que ves en la app de tu banco y compara con lo registrado aquí.</p>';
    else h += '<div class="kv"><span>Suma en bancos</span><b>' + money(r.banco) + '</b></div><div class="kv"><span>Según la app (semana actual, real)</span><b>' + money(r.app) + '</b></div>' +
      '<div class="kv big"><span>Diferencia</span><b class="' + (Math.abs(r.dif) < 0.01 ? 'pos' : r.dif > 0 ? 'blue' : 'neg') + '">' + (Math.abs(r.dif) < 0.01 ? 'Cuadrado ✓' : moneyPlus(r.dif)) + '</b></div>';
    h += '</section>';
  }

  // Este mes
  const ms = monthStats(firstOfMonth(pd(t)), m => isCorr(m.cuentaId));
  h += '<section class="card"><div class="card-head"><h2>Este mes</h2><button class="link" data-act="goCalSum">Ver detalle</button></div>' +
    '<div class="trio"><div><span>Ingresos</span><b class="pos">' + money(ms.total.sumIng) + '</b></div><div><span>Gastos</span><b class="neg">' + money(ms.total.sumEgr) + '</b></div>' +
    '<div><span>Neto</span><b class="' + (ms.total.sumIng - ms.total.sumEgr >= 0 ? 'pos' : 'neg') + '">' + moneyPlus(ms.total.sumIng - ms.total.sumEgr) + '</b></div></div>' +
    topCats(ms.total.egr, ms.total.sumEgr) + '</section>';

  // Metas
  const metas = S.metas.filter(m => m.estado !== 'Archivada' && cta(m.cuentaId));
  if (metas.length) {
    h += '<section class="card"><div class="card-head"><h2>Metas de ahorro</h2><button class="link" data-act="tab" data-tab="ahorro">Ver todas</button></div>' +
      metas.slice(0, 3).map(metaMini).join('') + '</section>';
  }

  // Próximos 7 días
  const lim = addDays(t, 7);
  const prox = S.movs.filter(m => m.estado === 'Proyectado' && m.fecha >= t && m.fecha <= lim && !(m.enlace && m.tipo === 'Ingreso' && partnerOf(m)))
    .sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : sortByOrden(a, b));
  h += '<section class="card"><div class="card-head"><h2>Próximos 7 días</h2></div>' +
    (prox.length ? '<div class="list">' + prox.slice(0, 12).map(m => movRow(m, { date: true })).join('') + '</div>' : '<p class="muted small">No hay movimientos proyectados para esta semana.</p>') + '</section>';
  return h;
}
function topCats(egr, total) {
  const rows = Object.keys(egr).map(k => [k, egr[k]]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!rows.length) return '';
  return '<div class="bars">' + rows.map(r => '<div class="barrow"><span class="bl">' + esc(r[0]) + '</span><span class="bt"><i style="width:' + Math.max(3, (r[1] / (total || 1)) * 100).toFixed(1) + '%"></i></span><span class="bv">' + money(r[1]) + '</span></div>').join('') + '</div>';
}
function cuadre() {
  const sat = satOf(today());
  let banco = 0, app = 0, hayDatos = false;
  const det = activeCuentas('Corriente').map(c => {
    const s = S.saldos[c.id];
    const a = ctaBalance(c.id, true, sat);
    if (s) { hayDatos = true; banco += s.saldo; }
    app += a;
    return { c, saldo: s, app: a };
  });
  return { banco, app, dif: banco - app, hayDatos, det };
}

/* ============================ CALENDARIO ============================ */
function deficitDays(monthDate, pred) {
  const y = monthDate.getFullYear(), mo = monthDate.getMonth();
  const first = dstr(new Date(y, mo, 1)), last = dstr(new Date(y, mo + 1, 0));
  let bal = balanceUpTo(addDays(first, -1), false, pred);
  const byDay = {};
  S.movs.forEach(m => { if (m.fecha >= first && m.fecha <= last && pred(m)) byDay[m.fecha] = (byDay[m.fecha] || 0) + m.monto; });
  const out = [];
  for (let d = first; d <= last; d = addDays(d, 1)) { bal += byDay[d] || 0; if (bal < 0) out.push({ fecha: d, saldo: bal }); }
  return out;
}
function monthStats(monthDate, pred) {
  const mk = monthKey(monthDate), t = today();
  const bucket = () => ({ ing: {}, egr: {}, sumIng: 0, sumEgr: 0, ini: {}, sumIni: 0 });
  const st = { total: bucket(), real: bucket(), proy: bucket(), leg: { rp: 0, rn: 0, pp: 0, pn: 0, v: 0 } };
  S.movs.forEach(m => {
    if (!m.fecha.startsWith(mk) || !pred(m)) return;
    // Los saldos iniciales no son ingresos del mes, pero si cambian el saldo: van en su propia fila
    // para que Saldo inicial + Saldos iniciales de cuentas + Flujo neto = Saldo final.
    if (m.categoria === CAT_SALDO_INI) {
      const nom = ctaName(m.cuentaId);
      [st.total, st[m.estado === 'Real' ? 'real' : 'proy']].forEach(o => { o.ini[nom] = (o.ini[nom] || 0) + m.monto; o.sumIni += m.monto; });
      return;
    }
    const real = m.estado === 'Real';
    if (real) { if (m.monto >= 0) st.leg.rp += m.monto; else st.leg.rn -= m.monto; }
    else if (m.fecha < t) st.leg.v += m.monto;
    else { if (m.monto >= 0) st.leg.pp += m.monto; else st.leg.pn -= m.monto; }
    if (m.enlace && isInternalFor(m, pred)) return; // transferencia entre dos cuentas del flujo: no es ingreso ni gasto
    const k = real ? 'real' : 'proy';
    [st.total, st[k]].forEach(o => {
      if (m.monto >= 0) { o.ing[m.categoria] = (o.ing[m.categoria] || 0) + m.monto; o.sumIng += m.monto; }
      else { o.egr[m.categoria] = (o.egr[m.categoria] || 0) - m.monto; o.sumEgr -= m.monto; }
    });
  });
  return st;
}
function isInternalFor(m, pred) { const p = partnerOf(m); return !!(p && pred(p) && pred(m)); }

// Semanas del calendario con su saldo corriente: saldo inicial de la semana + neto diario
// (misma logica que la intranet). La usan la vista de mes y la de semana.
function buildWeeks(startStr, endStr, mo) {
  const t = today();
  const byDay = {};
  S.movs.forEach(m => { if (inFlow(m) && m.fecha >= startStr && m.fecha <= endStr) (byDay[m.fecha] = byDay[m.fecha] || []).push(m); });
  Object.keys(byDay).forEach(k => byDay[k].sort(sortByOrden));
  const weeks = [], deficits = [];
  let run = balanceUpTo(addDays(startStr, -1), false);
  for (let cur = startStr; cur <= endStr; cur = addDays(cur, 7)) {
    const sat = addDays(cur, 6);
    const wk = { start: cur, sat, locked: S.locked.includes(sat), ini: run, days: [] };
    for (let i = 0; i < 7; i++) {
      const d = addDays(cur, i), dd = pd(d);
      const moves = byDay[d] || [];
      const net = sum(moves, m => m.monto);
      run += net;
      const other = mo != null && dd.getMonth() !== mo;
      const neg = run < -0.004 && !other;
      if (neg) deficits.push({ fecha: d, saldo: run });
      wk.days.push({ d, dd, i, moves, net, bal: run, other, neg, today: d === t });
    }
    wk.fin = run;
    weeks.push(wk);
  }
  return { weeks, deficits };
}
function sundayOf(s) { const d = pd(s); d.setDate(d.getDate() - d.getDay()); return dstr(d); }
function weekLabel(start) {
  const a = pd(start), b = pd(addDays(start, 6));
  const mes = x => x.toLocaleDateString(CFG.LOCALE, { month: 'short' }).replace('.', '');
  return a.getDate() + (a.getMonth() !== b.getMonth() ? ' ' + mes(a) : '') + ' – ' + b.getDate() + ' ' + mes(b) + ' ' + b.getFullYear();
}
function wkBar(wk) {
  return '<div class="wk-bar">' +
    '<button class="wk-ini" data-act="saldoIni" data-d="' + addDays(wk.start, -1) + '" title="Saldo inicial de la semana">Inicial <b class="' + (wk.ini < 0 ? 'neg' : '') + '">' + money(wk.ini) + '</b></button>' +
    '<span class="wk-fin">Final <b class="' + (wk.fin < 0 ? 'neg' : '') + '">' + money(wk.fin) + '</b></span>' +
    '<button class="wk-lock" data-act="lockWeek" data-sat="' + wk.sat + '" data-lock="' + (wk.locked ? '0' : '1') + '">' + (wk.locked ? IC.lock + 'Cerrada' : IC.unlock + 'Abierta') + '</button></div>';
}

function viewCalendario() {
  const semana = S.calView === 'week';
  if (semana) { S.week = S.week || sundayOf(today()); S.month = firstOfMonth(pd(addDays(S.week, 3))); }
  const md = S.month, y = md.getFullYear(), mo = md.getMonth();
  const mk = monthKey(md);
  const corr = activeCuentas('Corriente');
  if (S.filter && !corr.some(c => c.id === S.filter)) S.filter = '';
  const fijosOk = S.fijosAplicados.some(a => a.mes === mk);

  let model;
  if (semana) model = buildWeeks(S.week, addDays(S.week, 6), null);
  else {
    const first = new Date(y, mo, 1), last = new Date(y, mo + 1, 0);
    const start = new Date(first); start.setDate(start.getDate() - start.getDay());
    const end = new Date(last); end.setDate(end.getDate() + (6 - end.getDay()));
    model = buildWeeks(dstr(start), dstr(end), mo);
  }
  S.deficits = model.deficits;

  // ---- Parte fija: mes, acciones, filtro de cuentas, alertas y (en vista mes) los nombres de los dias
  let h = '<div class="cal-sticky"><header class="top cal-top"><div class="month-nav">' +
    '<button class="icon-btn" data-act="month" data-d="-1" data-mdrop="-1" aria-label="Anterior">' + IC.chevL + '</button>' +
    '<h1 class="month-title' + (semana ? ' wk-title' : '') + '">' + esc(semana ? weekLabel(S.week) : monthLabel(md)) + '</h1>' +
    '<button class="icon-btn" data-act="month" data-d="1" data-mdrop="1" aria-label="Siguiente">' + IC.chevR + '</button></div>' +
    '<div class="cal-actions">' +
    '<button class="pill" data-act="thisMonth">Hoy</button>' +
    '<div class="seg sm view-seg"><button class="' + (semana ? '' : 'on') + '" data-act="calView" data-v="month">Mes</button><button class="' + (semana ? 'on' : '') + '" data-act="calView" data-v="week">Semana</button></div>' +
    '<button class="pill ' + (fijosOk ? 'done' : 'accent') + '" data-act="openFijos">' + (fijosOk ? 'Fijos ✓' : 'Fijos') + '</button>' +
    '<button class="icon-btn" data-act="openResumen" aria-label="Resumen del mes">' + IC.chart + '</button>' +
    '<button class="icon-btn" data-act="openSearch" aria-label="Buscar">' + IC.search + '</button></div></header>';
  if (corr.length > 1) {
    h += '<div class="chips-row"><button class="fchip' + (!S.filter ? ' on' : '') + '" data-act="filter" data-id="">Todas</button>' +
      corr.map(c => '<button class="fchip' + (S.filter === c.id ? ' on' : '') + '" data-act="filter" data-id="' + c.id + '" style="--c:' + c.color + '"><i></i>' + esc(c.nombre) + '</button>').join('') + '</div>';
  }
  const venc = vencidos();
  if (venc.length || model.deficits.length) {
    h += '<div class="alert-row">' +
      (venc.length ? '<button class="apill warn" data-act="openVencidos">⏰ ' + venc.length + ' vencido(s)</button>' : '') +
      (model.deficits.length ? '<button class="apill danger" data-act="showDeficit">🚨 Ruptura de caja: ' + model.deficits.slice(0, 4).map(d => pd(d.fecha).getDate()).join(', ') + (model.deficits.length > 4 ? '…' : '') + '</button>' : '') +
      '</div>';
  }
  if (!semana) h += '<div class="cal-dow"><span>Dom</span><span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span></div>';
  h += '</div>';

  // ---- Contenido
  if (semana) {
    const wk = model.weeks[0];
    const dn = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    h += '<div class="zoomable wk-view' + (wk.locked ? ' locked' : '') + '"><div class="card wk-card">' + wkBar(wk) + '</div>' +
      wk.days.map(x => '<section class="card wday' + (x.today ? ' today' : '') + (x.neg ? ' neg' : '') + '">' +
        '<button class="wday-head" data-act="day" data-d="' + x.d + '"><span class="wd-n"><b>' + x.dd.getDate() + '</b> ' + dn[x.i] + '</span>' +
        (x.moves.length ? '<span class="wd-net ' + (x.net >= 0 ? 'pos' : 'neg') + '">' + moneyPlus(x.net) + '</span>' : '') +
        '<span class="wd-bal' + (x.bal < 0 ? ' neg' : '') + '">' + money(x.bal) + '</span></button>' +
        (x.moves.length ? '<div class="list">' + x.moves.map(m => movRow(m)).join('') + '</div>'
          : (wk.locked ? '' : '<button class="wd-add" data-act="newMov" data-d="' + x.d + '">+ Agregar</button>')) +
        '</section>').join('') + '</div>';
  } else {
    let g = '<div class="cal zoomable">';
    model.weeks.forEach(wk => {
      let cells = '';
      wk.days.forEach(x => {
        let cls = 'day';
        if (x.other) cls += ' other';
        if (x.today) cls += ' today';
        if (x.neg) cls += ' neg';
        if (x.i === 0 || x.i === 6) cls += ' wkend';
        const dots = x.moves.slice(0, 6).map(m => '<i class="' + movClass(m) + '"></i>').join('') + (x.moves.length > 6 ? '<em>+' + (x.moves.length - 6) + '</em>' : '');
        cells += '<div class="' + cls + '" data-act="day" data-d="' + x.d + '"' + (wk.locked ? '' : ' data-drop="' + x.d + '"') + '>' +
          '<span class="dn">' + x.dd.getDate() + '</span>' +
          '<div class="dots">' + dots + '</div><div class="chips">' + x.moves.map(m => chipHtml(m, wk.locked)).join('') + '</div>' +
          (x.moves.length ? '<div class="dnet ' + (x.net >= 0 ? 'pos' : 'neg') + '">' + (x.net > 0 ? '+' : '') + compact(x.net) + '</div>' +
            '<div class="dbal' + (x.bal < 0 ? ' neg' : '') + '" title="Saldo al cierre del día">' + compact(x.bal) + '</div>' : '') + '</div>';
      });
      g += '<div class="wk' + (wk.locked ? ' locked' : '') + '" data-wk="' + wk.start + '">' + wkBar(wk) + '<div class="wk-days">' + cells + '</div></div>';
    });
    h += g + '</div>';
    h += '<p class="pinch-hint muted small center">Pellizca hacia afuera sobre una semana para verla en detalle.</p>';
  }

  // ---- Al fondo: resumen y leyenda
  const ms = monthStats(md, inFlow);
  h += '<button class="btn wide sum-btn" data-act="openResumen">' + IC.chart + ' Resumen de ' + esc(monthLabel(md)) + '</button>';
  h += '<div class="legend">' +
    '<span><i class="lg real"></i>Real + <b class="pos">' + compact(ms.leg.rp) + '</b></span>' +
    '<span><i class="lg realneg"></i>Real − <b class="neg">' + compact(ms.leg.rn) + '</b></span>' +
    '<span><i class="lg proy"></i>Proy + <b>' + compact(ms.leg.pp) + '</b></span>' +
    '<span><i class="lg proy dim"></i>Proy − <b>' + compact(ms.leg.pn) + '</b></span>' +
    '<span><i class="lg venc"></i>Vencido <b class="' + (ms.leg.v >= 0 ? 'pos' : 'neg') + '">' + compact(ms.leg.v) + '</b></span></div>';
  return h;
}
function chipHtml(m, locked) {
  const sel = S.sel.has(m.id) ? ' sel' : '';
  const canEdit = !locked && !isMovLocked(m);
  return '<div class="chip ' + movClass(m) + sel + '" data-act="chip" data-id="' + m.id + '"' + (canEdit ? ' draggable="true" data-chip="' + m.id + '"' : '') +
    ' title="' + esc(m.categoria + (m.detalle ? ' - ' + m.detalle : '') + ' · ' + ctaName(m.cuentaId)) + '">' +
    (canEdit ? '<button class="chip-x" data-act="quickDel" data-id="' + m.id + '" aria-label="Eliminar">' + IC.x + '</button>' : '') +
    '<span class="chip-cat">' + esc(m.detalle && m.categoria === CAT_TRANSF ? m.detalle : m.categoria) + '</span>' +
    '<span class="chip-amt">' + compact(m.monto) + '</span>' +
    (m.estado === 'Proyectado' && canEdit ? '<button class="chip-ok" data-act="exec" data-id="' + m.id + '" aria-label="Ejecutar">' + IC.check + '</button>' : '') +
    '</div>';
}
// Resumen por categoria del mes del calendario: ahora es una ventana (hoja) aparte.
function openResumen() {
  openSheet({
    kind: 'resumen', live: true, tall: true,
    title: () => 'Resumen · ' + monthLabel(S.month),
    render: () => summaryBody(S.month)
  });
}
function summaryBody(md) {
  const y = md.getFullYear(), mo = md.getMonth();
  const ms = monthStats(md, inFlow);
  const dAntes = dstr(new Date(y, mo, 0)), dFin = dstr(new Date(y, mo + 1, 0));
  const tabs = [['total', 'Total'], ['real', 'Solo real'], ['proy', 'Solo proyectado']];
  const o = ms[S.sumTab];
  const ini = S.sumTab === 'total' ? balanceUpTo(dAntes, false) : S.sumTab === 'real' ? balanceUpTo(dAntes, true) : null;
  const fin = S.sumTab === 'total' ? balanceUpTo(dFin, false) : S.sumTab === 'real' ? balanceUpTo(dFin, true) : null;
  const list = (obj, cls) => {
    const ks = Object.keys(obj).sort((a, b) => obj[b] - obj[a]);
    return ks.length ? ks.map(k => '<div class="kv"><span>' + esc(k) + '</span><b class="' + cls + '">' + money(obj[k]) + '</b></div>').join('') : '<p class="muted small">Sin movimientos</p>';
  };
  let h = '';
  if (S.filter) h += '<div class="banner warn">🔎 <span>Mostrando solo <b>' + esc(ctaName(S.filter)) + '</b>. <button class="link" data-act="filter" data-id="">Ver todas las cuentas</button></span></div>';
  // Aviso: gastos/ingresos hechos directamente en cuentas de ahorro no entran en este resumen.
  const mk = monthKey(md);
  const fuera = S.movs.filter(m => m.fecha.startsWith(mk) && isAhorro(m.cuentaId) && !m.enlace && m.categoria !== CAT_SALDO_INI);
  if (fuera.length) {
    const ctas = Array.from(new Set(fuera.map(m => ctaName(m.cuentaId))));
    h += '<div class="banner info">ℹ️ <span>' + fuera.length + ' movimiento(s) de este mes (' + moneyPlus(sum(fuera, m => m.monto)) + ') están en cuentas de <b>ahorro</b> (' + esc(ctas.join(', ')) +
      ') y no se incluyen aquí. Si son cuentas del día a día, cámbialas a <b>Corriente</b> en Más → Cuentas.</span></div>';
  }
  h += '<div class="seg">' + tabs.map(tb => '<button class="' + (S.sumTab === tb[0] ? 'on' : '') + '" data-act="sumTab" data-t="' + tb[0] + '">' + tb[1] + '</button>').join('') + '</div>';
  h += '<div class="summary"><div class="sum-grid"><div><h4 class="pos">Ingresos</h4>' + list(o.ing, 'pos') + '</div><div><h4 class="neg">Egresos</h4>' + list(o.egr, 'neg') + '</div>' +
    '<div class="sum-box">' + (ini != null ? '<div class="kv"><span>Saldo inicial del mes</span><b class="' + (ini < 0 ? 'neg' : '') + '">' + money(ini) + '</b></div>' : '') +
    (o.sumIni ? '<div class="kv"><span>Saldos iniciales de cuentas</span><b class="blue">' + moneyPlus(o.sumIni) + '</b></div>' +
      Object.keys(o.ini).map(k => '<div class="kv sub"><span>' + esc(k) + '</span><span>' + moneyPlus(o.ini[k]) + '</span></div>').join('') : '') +
    '<div class="kv"><span>Total ingresos</span><b class="pos">' + money(o.sumIng) + '</b></div><div class="kv"><span>Total egresos</span><b class="neg">' + money(o.sumEgr) + '</b></div>' +
    '<div class="kv big"><span>Flujo neto</span><b class="' + (o.sumIng - o.sumEgr >= 0 ? 'pos' : 'neg') + '">' + moneyPlus(o.sumIng - o.sumEgr) + '</b></div>' +
    (fin != null ? '<div class="kv big"><span>Saldo final del mes</span><b class="' + (fin < 0 ? 'neg' : '') + '">' + money(fin) + '</b></div>' : '') + '</div></div></div>';
  return h;
}

/* ---------- Fila de movimiento (listas) ---------- */
function movRow(m, o) {
  o = o || {};
  const locked = isMovLocked(m);
  const sel = S.sel.has(m.id);
  const est = m.estado === 'Real' ? 'Real' : (m.fecha < today() ? 'Vencido' : 'Proyectado');
  const p = partnerOf(m);
  const title = m.categoria === CAT_TRANSF && p ? (m.monto < 0 ? 'A ' + ctaName(p.cuentaId) : 'Desde ' + ctaName(p.cuentaId)) : m.categoria;
  const meta = m.metaId ? S.idx.meta.get(m.metaId) : null;
  let acts = '';
  if (S.selMode) acts = '<span class="ck' + (sel ? ' on' : '') + '">' + IC.check + '</span>';
  else if (o.order) acts = '<button class="mini" data-act="orderUp" data-id="' + m.id + '">' + IC.up + '</button><button class="mini" data-act="orderDown" data-id="' + m.id + '">' + IC.down + '</button>';
  else if (!locked && !o.noActs) acts = (m.estado === 'Proyectado' ? '<button class="mini ok" data-act="exec" data-id="' + m.id + '" aria-label="Ejecutar">' + IC.check + '</button>' : '') +
    '<button class="mini del" data-act="quickDel" data-id="' + m.id + '" aria-label="Eliminar">' + IC.x + '</button>';
  return '<div class="mv ' + movClass(m) + (sel ? ' sel' : '') + '" data-act="' + (S.selMode ? 'toggleSel' : 'editMov') + '" data-id="' + m.id + '" data-lp="' + m.id + '">' +
    '<span class="mv-bar"></span>' +
    '<div class="mv-main"><div class="mv-t">' + esc(title) + (locked ? ' <span class="tag">🔒</span>' : '') + '</div>' +
      '<div class="mv-s">' + (o.date ? esc(shortDate(m.fecha)) + ' · ' : '') + '<span class="dot" style="--c:' + ctaColor(m.cuentaId) + '"></span>' + esc(ctaName(m.cuentaId)) +
      (meta ? ' · ' + esc((meta.icono || '🎯') + ' ' + meta.nombre) : '') + (m.detalle && m.categoria !== CAT_TRANSF ? ' · ' + esc(m.detalle) : '') + '</div></div>' +
    '<div class="mv-r"><div class="mv-amt ' + (m.monto >= 0 ? 'pos' : 'neg') + '">' + moneyPlus(m.monto) + '</div><div class="mv-est">' + est + (o.bal != null ? ' · ' + money(o.bal) : '') + '</div></div>' +
    (acts ? '<div class="mv-acts">' + acts + '</div>' : '') + '</div>';
}

/* ============================ AHORRO ============================ */
function viewAhorro() {
  const aho = S.cuentas.filter(c => c.tipo === 'Ahorro' && c.activa);
  let h = topbar('Ahorro', aho.length ? '<button class="pill accent" data-act="newMeta">+ Meta</button>' : '');
  if (!aho.length) {
    return h + '<section class="card onboard"><div class="onb-emoji">🐷</div><h2>Tus ahorros, aparte</h2>' +
      '<p>Crea una cuenta de ahorro. Su dinero no se mezcla con tu flujo del día a día y puedes repartirlo en varias metas (viaje, emergencias, etc.).</p>' +
      '<button class="btn primary big" data-act="newCuenta" data-tipo="Ahorro">Crear cuenta de ahorro</button></section>';
  }
  const total = sum(S.movs.filter(m => m.estado === 'Real' && isAhorro(m.cuentaId)), m => m.monto);
  const totalP = sum(S.movs.filter(m => isAhorro(m.cuentaId)), m => m.monto);
  h += '<section class="hero savings"><div class="hero-lbl">Total ahorrado</div><div class="hero-amt">' + money(total) + '</div>' +
    (Math.abs(totalP - total) > 0.004 ? '<div class="hero-row"><span>Con aportes proyectados</span><b>' + money(totalP) + '</b></div>' : '') + '</section>';
  aho.forEach(c => {
    const bal = ctaBalance(c.id, true);
    const sinAsig = sum(S.movs.filter(m => m.cuentaId === c.id && m.estado === 'Real' && !m.metaId), m => m.monto);
    const metas = S.metas.filter(m => m.cuentaId === c.id);
    const act = metas.filter(m => m.estado !== 'Archivada'), arch = metas.filter(m => m.estado === 'Archivada');
    h += '<section class="card acct" style="--c:' + c.color + '"><div class="acct-head"><div><div class="acct-name">' + esc(c.nombre) + '</div><div class="muted small">Sin asignar a metas: ' + money(sinAsig) + '</div></div>' +
      '<div class="acct-bal">' + money(bal) + '</div></div>' +
      '<div class="btn-row"><button class="btn sm" data-act="deposit" data-id="' + c.id + '">Depositar</button><button class="btn sm" data-act="withdraw" data-id="' + c.id + '">Retirar</button>' +
      '<button class="btn sm ghost" data-act="openCuentaHist" data-id="' + c.id + '">Historial</button></div>' +
      (act.length ? act.map(metaCard).join('') : '<p class="muted small center">Esta cuenta no tiene metas todavía.</p>') +
      (arch.length ? '<details class="arch"><summary>' + arch.length + ' meta(s) archivada(s)</summary>' + arch.map(metaCard).join('') + '</details>' : '') +
      '<button class="btn sm ghost wide" data-act="newMeta" data-id="' + c.id + '">+ Nueva meta en ' + esc(c.nombre) + '</button></section>';
  });
  return h;
}
function progressBar(st, color) {
  return '<div class="prog" style="--c:' + (color || 'var(--green)') + '"><i class="p-proy" style="width:' + (st.pctProy * 100).toFixed(1) + '%"></i><i class="p-real" style="width:' + (st.pct * 100).toFixed(1) + '%"></i></div>';
}
function metaMini(meta) {
  const st = metaStats(meta);
  return '<button class="meta-mini" data-act="openMeta" data-id="' + meta.id + '"><span class="mm-ico">' + esc(meta.icono || '🎯') + '</span><span class="mm-body"><span class="mm-t">' + esc(meta.nombre) +
    '<b>' + Math.round(st.pct * 100) + '%</b></span>' + progressBar(st, ctaColor(meta.cuentaId)) + '</span></button>';
}
function metaCard(meta) {
  const st = metaStats(meta);
  let sub;
  if (st.done) sub = '<span class="pos"><b>¡Meta cumplida!</b> 🎉</span>';
  else if (meta.fechaLimite && st.vencida) sub = '<span class="neg">Fecha límite vencida · faltan ' + money(st.falta) + '</span>';
  else if (meta.fechaLimite) sub = 'Faltan ' + money(st.falta) + ' · <b>' + money(st.porMes) + '/mes</b> por ' + st.meses + ' mes' + (st.meses > 1 ? 'es' : '');
  else sub = 'Faltan ' + money(st.falta);
  const ritmo = (!st.done && st.ritmo != null && !st.vencida) ? (st.ritmo >= -0.5 ? '<span class="tag ok">Vas al día</span>' : '<span class="tag warn">Atrasada ' + money(-st.ritmo) + '</span>') : '';
  return '<button class="meta' + (meta.estado === 'Archivada' ? ' archived' : '') + '" data-act="openMeta" data-id="' + meta.id + '">' +
    '<div class="meta-top"><span class="meta-ico">' + esc(meta.icono || '🎯') + '</span><span class="meta-name">' + esc(meta.nombre) + '</span>' +
    '<span class="meta-amt"><b>' + money(st.real) + '</b> / ' + money(st.obj) + '</span></div>' + progressBar(st, ctaColor(meta.cuentaId)) +
    '<div class="meta-sub"><span>' + Math.round(st.pct * 100) + '% · ' + sub + '</span>' + ritmo + '</div>' +
    (meta.fechaLimite ? '<div class="meta-date muted small">Límite: ' + esc(dayLabel(meta.fechaLimite, { day: 'numeric', month: 'long', year: 'numeric' })) + '</div>' : '') + '</button>';
}

/* ============================ MAS ============================ */
function viewMas() {
  const venc = vencidos().length;
  const item = (act, ico, label, sub, badge) => '<button class="menu-item" data-act="' + act + '"><span class="mi-ico">' + ico + '</span><span class="mi-body"><span>' + label + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</span>' + (badge ? '<span class="badge">' + badge + '</span>' : '') + '<span class="mi-chev">' + IC.chevR + '</span></button>';
  return topbar('Más', syncChip()) +
    '<div class="menu">' +
      item('openCuentas', '🏦', 'Cuentas', S.cuentas.length + ' cuenta(s)') +
      item('openCats', '🏷️', 'Categorías', S.cats.length + ' categoría(s)') +
      item('openFijos', '📌', 'Gastos fijos', 'Plantilla mensual') +
      item('openCuadre', '⚖️', 'Cuadre con el banco', 'Compara con el saldo real') +
      item('openVencidos', '⏰', 'Proyectados vencidos', '', venc || '') +
      item('openSearch', '🔍', 'Buscar movimientos', '') +
    '</div><div class="menu">' +
      item('openPassword', '🔑', 'Cambiar contraseña', S.user ? esc(S.user.usuario) : '') +
      item('forceSync', '🔄', 'Sincronizar ahora', esc(syncLabel())) +
      item('installHelp', '📲', 'Instalar en el teléfono', '') +
    '</div><div class="menu">' + item('logout', '🚪', 'Cerrar sesión', '') + '</div>' +
    '<p class="muted small center">' + esc(CFG.APP_NAME) + ' v' + esc(CFG.APP_VERSION) + (window.LOCAL_SERVER ? ' · MODO PRUEBA (datos locales)' : '') + '</p>';
}

/* ============================ SHEETS ============================ */
function openDay(d) {
  S.selMode = false;
  openSheet({
    kind: 'day', live: true, tall: true,
    title: () => dayLabel(d),
    right: () => isLockedDate(d) ? '' : '<button class="sh-btn strong" data-act="newMov" data-d="' + d + '">+ Agregar</button>',
    state: { q: '', est: '', order: false },
    onClose: () => { if (S.selMode) { S.selMode = false; S.sel.clear(); renderSelbar(); } },
    // El filtro de texto queda fijo; update() redibuja solo lo de abajo (no cierra el teclado).
    render: sh => {
      const st = sh.state;
      const n = S.movs.filter(m => m.fecha === d).length;
      return '<div class="dyn-top"></div>' + (n > 3 ? '<div class="filter-row"><input class="inp sm" type="search" placeholder="Filtrar..." value="' + esc(st.q) + '" data-input="dayQ">' +
        '<div class="seg sm">' + [['', 'Todos'], ['Real', 'Real'], ['Proyectado', 'Proy']].map(x => '<button class="' + (st.est === x[0] ? 'on' : '') + '" data-act="dayEst" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div></div>' : '') +
        '<div class="dyn"></div>';
    },
    mount: sh => sh.o.update(sh),
    update: sh => {
      const st = sh.state;
      const all = S.movs.filter(m => m.fecha === d).sort(sortByOrden);
      const net = sum(all.filter(m => isCorr(m.cuentaId)), m => m.monto); // como el flujo del calendario: solo cuentas corrientes
      const bal = balanceUpTo(d, false, m => isCorr(m.cuentaId));
      const cats = {};
      all.forEach(m => { const k = (m.monto >= 0 ? 'Ingresos · ' : 'Salidas · ') + m.categoria; cats[k] = (cats[k] || 0) + m.monto; });
      const q = st.q.toLowerCase();
      const list = all.filter(m => (!st.est || m.estado === st.est) && (!q || (m.categoria + ' ' + m.detalle + ' ' + Math.abs(m.monto) + ' ' + ctaName(m.cuentaId)).toLowerCase().includes(q)));
      let top = '';
      if (isLockedDate(d)) top += '<div class="banner lock">' + IC.lock + ' Semana cerrada: solo lectura (las cuentas de ahorro siguen editables).</div>';
      top += '<div class="stat2"><div><span>Flujo neto del día</span><b class="' + (net >= 0 ? 'pos' : 'neg') + '">' + moneyPlus(net) + '</b></div>' +
        '<div><span>Saldo corriente al cierre</span><b class="' + (bal < 0 ? 'neg' : '') + '">' + money(bal) + '</b></div></div>';
      const openCats = !!$('details.cats[open]', sh.body);
      if (Object.keys(cats).length) top += '<details class="cats"' + (openCats ? ' open' : '') + '><summary>Sumas por categoría</summary>' + Object.keys(cats).map(k => '<div class="kv"><span>' + esc(k) + '</span><b class="' + (cats[k] >= 0 ? 'pos' : 'neg') + '">' + moneyPlus(cats[k]) + '</b></div>').join('') + '</details>';
      let h = '';
      if (q || st.est) h += '<p class="muted small">Mostrando ' + list.length + ' de ' + all.length + ' · Subtotal ' + moneyPlus(sum(list, m => m.monto)) + '</p>';
      h += list.length ? '<div class="list">' + list.map(m => movRow(m, { order: st.order })).join('') + '</div>'
        : '<div class="empty small"><p>' + (all.length ? 'Ningún movimiento coincide.' : 'Sin movimientos este día.') + '</p></div>';
      if (all.length) {
        h += '<div class="btn-row">' +
          '<button class="btn sm ' + (S.selMode ? 'primary' : 'ghost') + '" data-act="selMode">' + (S.selMode ? 'Listo' : 'Seleccionar') + '</button>' +
          (all.length > 1 && !isLockedDate(d) ? '<button class="btn sm ' + (st.order ? 'primary' : 'ghost') + '" data-act="orderMode">' + (st.order ? 'Listo' : 'Ordenar') + '</button>' : '') + '</div>';
      }
      if (!isLockedDate(d)) h += '<button class="btn primary wide" data-act="newMov" data-d="' + d + '">+ Agregar movimiento</button>';
      $('.dyn-top', sh.body).innerHTML = top;
      $('.dyn', sh.body).innerHTML = h;
    }
  });
}

/* ---------- Formulario de movimiento (nuevo / editar / transferencia) ---------- */
function openMovForm(p) {
  p = p || {};
  const m = p.id ? getMov(p.id) : null;
  if (p.id && !m) return toast('Ese movimiento ya no existe.', 'error');
  const corr = activeCuentas('Corriente');
  const firstCorr = (corr[0] || activeCuentas()[0] || {}).id || '';
  const partner = m ? partnerOf(m) : null;
  const F = m ? {
    modo: m.enlace ? 'transfer' : (m.tipo === 'Salida' ? 'gasto' : 'ingreso'),
    fecha: m.fecha, monto: Math.abs(m.monto).toFixed(2), cuentaId: m.cuentaId, categoria: m.categoria, detalle: m.detalle, estado: m.estado, metaId: m.metaId,
    desdeId: m.enlace ? (m.monto < 0 ? m.cuentaId : (partner || {}).cuentaId) : '', haciaId: m.enlace ? (m.monto < 0 ? (partner || {}).cuentaId : m.cuentaId) : '',
    metaDesdeId: m.enlace ? (m.monto < 0 ? m.metaId : (partner || {}).metaId) : '', metaHaciaId: m.enlace ? (m.monto < 0 ? (partner || {}).metaId : m.metaId) : ''
  } : {
    modo: p.modo || (p.categoria === CAT_SALDO_INI ? 'ingreso' : 'gasto'),
    fecha: p.fecha || today(), monto: '', cuentaId: p.cuentaId || (S.filter || firstCorr), categoria: p.categoria || '', detalle: '', estado: '', metaId: p.metaId || '',
    desdeId: p.desdeId || firstCorr, haciaId: p.haciaId || '', metaDesdeId: p.metaDesdeId || '', metaHaciaId: p.metaHaciaId || ''
  };
  if (!F.haciaId && F.modo === 'transfer') F.haciaId = (activeCuentas().find(c => c.id !== F.desdeId) || {}).id || '';
  if (!F.estado) F.estado = F.fecha > today() ? 'Proyectado' : 'Real';
  if (!m && !activeCuentas().length) { toast('Primero crea una cuenta.', 'error'); return openCuentaForm({ tipo: 'Corriente' }); }
  const locked = m ? isMovLocked(m) : false;
  const saldoIni = !m && p.categoria === CAT_SALDO_INI;

  openSheet({
    kind: 'movform', closeLabel: 'Cancelar',
    title: m ? (m.enlace ? 'Transferencia' : 'Editar movimiento') : (saldoIni ? 'Saldo inicial' : 'Nuevo movimiento'),
    state: { F, estadoTocado: !!m },
    render: sh => {
      const f = sh.state.F;
      let h = '<form data-form="mov" class="movform" data-modo="' + f.modo + '">';
      if (locked) h += '<div class="banner lock">' + IC.lock + ' Semana cerrada: este movimiento es de solo lectura.</div>';
      if (!m) {
        h += '<div class="seg big">' + [['gasto', 'Gasto'], ['ingreso', 'Ingreso'], ['transfer', 'Transferencia']].map(x => '<button type="button" class="' + (f.modo === x[0] ? 'on ' + x[0] : '') + '" data-act="movModo" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
      } else if (!m.enlace) {
        h += '<div class="seg big">' + [['gasto', 'Gasto'], ['ingreso', 'Ingreso']].map(x => '<button type="button" class="' + (f.modo === x[0] ? 'on ' + x[0] : '') + '" data-act="movModo" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
      }
      h += '<label class="amount ' + f.modo + '"><span>' + esc(CFG.CURRENCY) + '</span><input name="monto" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + esc(f.monto) + '" required></label>';
      if (f.modo === 'transfer') {
        h += '<div class="xfer"><label class="fld"><span>Desde</span><select name="desdeId" data-change="movCta">' + cuentaOpts(f.desdeId, m ? 'all' : 'active') + '</select></label>' +
          '<span class="xfer-arrow">' + IC.arrow + '</span>' +
          '<label class="fld"><span>Hacia</span><select name="haciaId" data-change="movCta">' + cuentaOpts(f.haciaId, m ? 'all' : 'active') + '</select></label></div>';
        if (isAhorro(f.desdeId) && metasDe(f.desdeId).length) h += '<label class="fld"><span>Retirar de la meta</span><select name="metaDesdeId">' + metaOpts(f.desdeId, f.metaDesdeId) + '</select></label>';
        if (isAhorro(f.haciaId) && metasDe(f.haciaId).length) h += '<label class="fld"><span>Asignar a la meta</span><select name="metaHaciaId">' + metaOpts(f.haciaId, f.metaHaciaId) + '</select></label>';
      } else {
        h += '<label class="fld"><span>Cuenta</span><select name="cuentaId" data-change="movCta">' + cuentaOpts(f.cuentaId, m ? 'all' : 'active') + '</select></label>';
        if (isAhorro(f.cuentaId) && metasDe(f.cuentaId).length) h += '<label class="fld"><span>Meta</span><select name="metaId">' + metaOpts(f.cuentaId, f.metaId) + '</select></label>';
        h += '<label class="fld"><span>Categoría</span><select name="categoria">' + catOpts(f.categoria || defaultCat(f.modo)) + '</select></label>';
      }
      h += '<div class="row2"><label class="fld"><span>Fecha</span><input type="date" name="fecha" value="' + esc(f.fecha) + '" data-change="movFecha" required></label>' +
        '<div class="fld"><span>Estado</span><div class="seg">' + [['Real', 'Real'], ['Proyectado', 'Proyectado']].map(x => '<button type="button" class="' + (f.estado === x[0] ? 'on' : '') + '" data-act="movEstado" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div></div></div>';
      h += '<label class="fld"><span>Detalle</span><input name="detalle" value="' + esc(f.detalle) + '" placeholder="Opcional" autocomplete="off"></label>';
      if (m && m.por) h += '<p class="muted small">Última modificación: ' + esc(m.por) + (m.en ? ' · ' + esc(String(m.en).slice(0, 16)) : '') + '</p>';
      if (!locked) {
        h += '<button class="btn primary big" type="submit">' + (m ? 'Guardar cambios' : 'Registrar') + '</button>';
        if (m) h += '<div class="btn-row">' + (m.estado === 'Proyectado' ? '<button type="button" class="btn ghost" data-act="execFromForm" data-id="' + m.id + '">Marcar como real</button>' : '') +
          '<button type="button" class="btn ghost" data-act="dupMov" data-id="' + m.id + '">Duplicar</button>' +
          '<button type="button" class="btn danger-ghost" data-act="delMov" data-id="' + m.id + '">Eliminar</button></div>';
      }
      h += '</form>';
      return h;
    },
    mount: sh => {
      $$('input,select', sh.body).forEach(el => { if (locked) el.disabled = true; });
      if (!m) { const a = $('[name=monto]', sh.body); setTimeout(() => a && a.focus(), 320); }
    }
  }).state.edit = m;
}
function readMovForm(sh) {
  const form = $('form', sh.body), f = sh.state.F;
  ['monto', 'fecha', 'detalle', 'cuentaId', 'categoria', 'metaId', 'desdeId', 'haciaId', 'metaDesdeId', 'metaHaciaId'].forEach(k => { if (form[k]) f[k] = form[k].value; });
  if (form.metaId == null) f.metaId = ''; // la cuenta elegida no tiene metas
  if (form.metaDesdeId == null) f.metaDesdeId = '';
  if (form.metaHaciaId == null) f.metaHaciaId = '';
  return f;
}
function cuentaOpts(sel, mode) {
  const list = S.cuentas.filter(c => mode === 'all' ? (c.activa || c.id === sel) : c.activa);
  const grp = t => list.filter(c => c.tipo === t).map(c => '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(c.nombre) + (c.activa ? '' : ' (archivada)') + '</option>').join('');
  const a = grp('Corriente'), b = grp('Ahorro');
  return (a ? '<optgroup label="Corrientes">' + a + '</optgroup>' : '') + (b ? '<optgroup label="Ahorro">' + b + '</optgroup>' : '');
}
function metasDe(cuentaId) { return S.metas.filter(x => x.cuentaId === cuentaId && x.estado !== 'Archivada'); }
function metaOpts(cuentaId, sel) {
  return '<option value="">Sin asignar</option>' + S.metas.filter(x => x.cuentaId === cuentaId && (x.estado !== 'Archivada' || x.id === sel))
    .map(x => '<option value="' + x.id + '"' + (x.id === sel ? ' selected' : '') + '>' + esc((x.icono || '🎯') + ' ' + x.nombre) + '</option>').join('');
}
const CATS_INGRESO = ['SUELDO', 'OTROS INGRESOS', 'INTERESES', CAT_SALDO_INI];
function defaultCat(modo) {
  if (modo === 'ingreso') return S.cats.includes('SUELDO') ? 'SUELDO' : (S.cats[0] || '');
  return S.cats.find(c => !CATS_INGRESO.includes(c) && c !== CAT_TRANSF) || S.cats[0] || '';
}
function catOpts(sel) {
  const list = S.cats.filter(c => c !== CAT_TRANSF);
  if (sel && !list.includes(sel)) list.push(sel);
  return list.map(c => '<option' + (c === sel ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
}
async function submitMov(sh) {
  const f = readMovForm(sh);
  const m = sh.state.edit;
  const monto = parseAmount(f.monto);
  if (!(monto > 0)) return toast('Ingresa un monto mayor a 0.', 'error');
  const btn = $('button[type=submit]', sh.body);
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  try {
    if (m) {
      await write('updateMovement', [{ id: m.id, fecha: f.fecha, tipo: f.modo === 'gasto' ? 'Salida' : 'Ingreso', cuentaId: f.modo === 'transfer' ? m.cuentaId : f.cuentaId,
        categoria: f.categoria, monto, detalle: f.detalle, estado: f.estado, metaId: f.modo === 'transfer' ? (m.monto < 0 ? f.metaDesdeId : f.metaHaciaId) : f.metaId }], { ok: 'Cambios guardados.' });
      // En transferencias, las cuentas y la meta del otro lado se editan en su propio movimiento.
      if (m.enlace) {
        const p = partnerOf(getMov(m.id) || m);
        const newOwn = m.monto < 0 ? f.desdeId : f.haciaId, newOther = m.monto < 0 ? f.haciaId : f.desdeId;
        const otherMeta = m.monto < 0 ? f.metaHaciaId : f.metaDesdeId;
        if (newOwn === newOther) throw new Error('Elige dos cuentas distintas.');
        if (p && (p.cuentaId !== newOther || (p.metaId || '') !== (otherMeta || ''))) {
          await write('updateMovement', [{ id: p.id, fecha: f.fecha, cuentaId: newOther, monto, detalle: p.detalle, estado: f.estado, metaId: otherMeta }]);
        }
        if (newOwn !== m.cuentaId) await write('updateMovement', [{ id: m.id, fecha: f.fecha, cuentaId: newOwn, monto, detalle: f.detalle, estado: f.estado, metaId: m.monto < 0 ? f.metaDesdeId : f.metaHaciaId }]);
      }
    } else if (f.modo === 'transfer') {
      if (!f.desdeId || !f.haciaId || f.desdeId === f.haciaId) throw new Error('Elige dos cuentas distintas.');
      await write('addTransfer', [{ desdeId: f.desdeId, haciaId: f.haciaId, monto, fecha: f.fecha, estado: f.estado, detalle: f.detalle, metaDesdeId: f.metaDesdeId, metaHaciaId: f.metaHaciaId }], { ok: 'Transferencia registrada.' });
    } else {
      await write('addMovement', [{ fecha: f.fecha, tipo: f.modo === 'gasto' ? 'Salida' : 'Ingreso', cuentaId: f.cuentaId, categoria: f.categoria, monto, detalle: f.detalle, estado: f.estado, metaId: f.metaId }], { ok: 'Movimiento registrado.' });
    }
    closeSheet(sh);
  } catch (e) {
    if (!(e instanceof ApiError)) toast(e.message, 'error');
    btn.disabled = false;
    btn.textContent = label;
  }
}

/* ---------- Vencidos ---------- */
function openVencidos() {
  openSheet({
    kind: 'venc', live: true, tall: true, title: 'Proyectados vencidos',
    render: () => {
      const v = vencidos();
      if (!v.length) return '<div class="empty"><div class="onb-emoji">✅</div><p>No hay proyectados vencidos.</p></div>';
      return '<p class="muted small">Movimientos proyectados con fecha pasada que aún no se ejecutan. Márcalos como reales, muévelos a hoy o edítalos.</p>' +
        '<div class="list">' + v.map(m => '<div class="venc-row">' + movRow(m, { date: true, noActs: true }) +
          '<div class="btn-row tight"><button class="btn sm" data-act="exec" data-id="' + m.id + '">Real</button><button class="btn sm ghost" data-act="toToday" data-id="' + m.id + '">A hoy</button></div></div>').join('') + '</div>' +
        '<button class="btn primary wide" data-act="execAllVenc">Ejecutar todos (' + v.length + ')</button>';
    }
  });
}

/* ---------- Buscar ---------- */
function openSearch() {
  openSheet({
    kind: 'search', live: true, tall: true, title: 'Buscar', state: { q: '' }, focus: 'input',
    render: sh => '<input class="inp" type="search" placeholder="Categoría, detalle, monto o cuenta" value="' + esc(sh.state.q) + '" data-input="searchQ" enterkeyhint="search"><div class="dyn"></div>',
    mount: sh => sh.o.update(sh),
    // Solo se redibujan los resultados: reemplazar el <input> cerraria el teclado en iPhone.
    update: sh => {
      const q = sh.state.q.toLowerCase().trim();
      let h;
      if (q.length < 2) h = '<p class="muted small center">Escribe al menos 2 caracteres.</p>';
      else {
        const res = S.movs.filter(m => (m.categoria + ' ' + m.detalle + ' ' + Math.abs(m.monto).toFixed(2) + ' ' + ctaName(m.cuentaId) + ' ' + m.fecha).toLowerCase().includes(q))
          .sort((a, b) => a.fecha < b.fecha ? 1 : -1);
        h = '<p class="muted small">' + res.length + ' resultado(s) · Neto ' + moneyPlus(sum(res, m => m.monto)) + '</p>' +
          '<div class="list">' + res.slice(0, 100).map(m => movRow(m, { date: true })).join('') + '</div>' +
          (res.length > 100 ? '<p class="muted small center">y ' + (res.length - 100) + ' más...</p>' : '');
      }
      $('.dyn', sh.body).innerHTML = h;
    }
  });
}

/* ---------- Categorias ---------- */
function openCats() {
  openSheet({
    kind: 'cats', live: true, tall: true, title: 'Categorías',
    right: () => '<button class="sh-btn strong" data-act="catAdd">+ Nueva</button>',
    render: () => {
      const uso = {};
      S.movs.forEach(m => { uso[m.categoria] = (uso[m.categoria] || 0) + 1; });
      return '<div class="list">' + S.cats.map((c, i) => {
        const prot = CAT_PROTEGIDAS.includes(c);
        return '<div class="li"><div class="li-main"><b>' + esc(c) + '</b><small>' + (uso[c] || 0) + ' movimiento(s)</small></div>' +
          (prot ? '<span class="tag">del sistema</span>' : '<button class="mini" data-act="catRename" data-i="' + i + '">✎</button><button class="mini del" data-act="catDel" data-i="' + i + '">' + IC.x + '</button>') + '</div>';
      }).join('') + '</div><p class="muted small">Renombrar actualiza también los movimientos y gastos fijos. No se puede eliminar una categoría en uso.</p>';
    }
  });
}

/* ---------- Cuentas ---------- */
function openCuentas() {
  openSheet({
    kind: 'cuentas', live: true, tall: true, title: 'Cuentas',
    right: () => '<button class="sh-btn strong" data-act="newCuenta">+ Nueva</button>',
    render: () => {
      if (!S.cuentas.length) return '<div class="empty"><p>Todavía no tienes cuentas.</p><button class="btn primary" data-act="newCuenta">Crear cuenta</button></div>';
      const grp = (t, title, help) => {
        const l = S.cuentas.filter(c => c.tipo === t);
        return '<h4 class="sec">' + title + '</h4><p class="muted small">' + help + '</p>' + (l.length ? '<div class="list">' + l.map(c =>
          '<button class="li" data-act="editCuenta" data-id="' + c.id + '"><span class="swatch" style="--c:' + c.color + '"></span><div class="li-main"><b>' + esc(c.nombre) + '</b><small>' + (c.activa ? 'Activa' : 'Archivada') + '</small></div>' +
          '<b class="' + (ctaBalance(c.id, true) < 0 ? 'neg' : '') + '">' + money(ctaBalance(c.id, true)) + '</b></button>').join('') + '</div>' : '<p class="muted small center">Ninguna.</p>');
      };
      return grp('Corriente', 'Corrientes', 'Forman el flujo del calendario y el saldo disponible.') + grp('Ahorro', 'Ahorro', 'Van aparte del flujo y pueden tener metas.');
    }
  });
}
function openCuentaForm(p) {
  p = p || {};
  const c = p.id ? cta(p.id) : null;
  const F = c ? Object.assign({}, c) : { nombre: '', tipo: p.tipo || 'Corriente', color: COLORES[S.cuentas.length % COLORES.length], activa: true, saldoInicial: '', fechaSaldo: today() };
  openSheet({
    kind: 'ctaform', closeLabel: 'Cancelar', title: c ? 'Editar cuenta' : 'Nueva cuenta', state: { F },
    render: sh => {
      const f = sh.state.F;
      let h = '<form data-form="cuenta">' +
        '<label class="fld"><span>Nombre</span><input name="nombre" value="' + esc(f.nombre) + '" placeholder="Ej. BCP Sueldo, Interbank, Ahorro BBVA" required autocomplete="off"></label>' +
        '<div class="fld"><span>Tipo</span><div class="seg">' + ['Corriente', 'Ahorro'].map(t => '<button type="button" class="' + (f.tipo === t ? 'on' : '') + '" data-act="ctaTipo" data-v="' + t + '">' + t + '</button>').join('') + '</div>' +
        '<small class="muted">' + (f.tipo === 'Ahorro' ? 'No suma al disponible del día a día. Puedes crear metas y repartir su dinero entre ellas.' : 'Suma a tu flujo disponible y aparece en el calendario.') + '</small></div>' +
        '<div class="fld"><span>Color</span><div class="swatches">' + COLORES.map(col => '<button type="button" class="sw' + (f.color === col ? ' on' : '') + '" style="--c:' + col + '" data-act="ctaColor" data-v="' + col + '" aria-label="' + col + '"></button>').join('') + '</div></div>';
      if (!c) h += '<div class="row2"><label class="fld"><span>Saldo actual (opcional)</span><input name="saldoInicial" inputmode="decimal" placeholder="0.00" value="' + esc(f.saldoInicial) + '"></label>' +
        '<label class="fld"><span>Al día</span><input type="date" name="fechaSaldo" value="' + esc(f.fechaSaldo) + '"></label></div><p class="muted small">Se registra como "SALDO INICIAL" (real) en esa fecha.</p>';
      h += '<button class="btn primary big" type="submit">' + (c ? 'Guardar' : 'Crear cuenta') + '</button>';
      if (c) h += '<div class="btn-row"><button type="button" class="btn ghost" data-act="ctaArchive" data-id="' + c.id + '">' + (c.activa ? 'Archivar' : 'Reactivar') + '</button>' +
        '<button type="button" class="btn danger-ghost" data-act="ctaDelete" data-id="' + c.id + '">Eliminar</button></div>' +
        '<p class="muted small">Archivar la oculta de los formularios pero conserva su historial y saldo. Solo se puede eliminar una cuenta sin movimientos.</p>';
      return h + '</form>';
    }
  }).state.edit = c;
}
function readCuentaForm(sh) {
  const form = $('form', sh.body), f = sh.state.F;
  f.nombre = form.nombre.value;
  if (form.saldoInicial) { f.saldoInicial = form.saldoInicial.value; f.fechaSaldo = form.fechaSaldo.value; }
  return f;
}

function openCuentaHist(id) {
  openSheet({
    kind: 'hist', live: true, tall: true, title: () => ctaName(id),
    right: () => '<button class="sh-btn strong" data-act="newMov" data-cta="' + id + '">+ Mov.</button>',
    render: () => {
      const c = cta(id);
      if (!c) return '<p class="muted">La cuenta ya no existe.</p>';
      const list = S.movs.filter(m => m.cuentaId === id).sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : sortByOrden(a, b));
      let run = 0;
      const withBal = list.map(m => { run += m.monto; return { m, bal: run }; }).reverse();
      const real = ctaBalance(id, true), proy = ctaBalance(id, false);
      let h = '<div class="stat2"><div><span>Saldo real</span><b class="' + (real < 0 ? 'neg' : '') + '">' + money(real) + '</b></div><div><span>Con proyectados</span><b>' + money(proy) + '</b></div></div>';
      if (c.tipo === 'Ahorro') h += '<div class="btn-row"><button class="btn sm" data-act="deposit" data-id="' + id + '">Depositar</button><button class="btn sm" data-act="withdraw" data-id="' + id + '">Retirar</button></div>';
      h += withBal.length ? '<div class="list">' + withBal.slice(0, 300).map(x => movRow(x.m, { date: true, bal: x.bal })).join('') + '</div>' : '<div class="empty small"><p>Sin movimientos.</p></div>';
      return h;
    }
  });
}

/* ---------- Metas ---------- */
function openMetaForm(p) {
  p = p || {};
  const meta = p.id ? S.idx.meta.get(p.id) : null;
  const aho = S.cuentas.filter(c => c.tipo === 'Ahorro' && (c.activa || (meta && c.id === meta.cuentaId)));
  if (!aho.length) { toast('Primero crea una cuenta de ahorro.', 'error'); return openCuentaForm({ tipo: 'Ahorro' }); }
  const F = meta ? Object.assign({}, meta) : { cuentaId: p.cuentaId || aho[0].id, nombre: '', objetivo: '', fechaLímite: '', icono: '🎯', estado: 'Activa' };
  openSheet({
    kind: 'metaform', closeLabel: 'Cancelar', title: meta ? 'Editar meta' : 'Nueva meta', state: { F },
    render: sh => {
      const f = sh.state.F;
      let h = '<form data-form="meta"><div class="fld"><span>Ícono</span><div class="emojis">' + ICONOS_META.map(e => '<button type="button" class="em' + (f.icono === e ? ' on' : '') + '" data-act="metaIcono" data-v="' + e + '">' + e + '</button>').join('') + '</div></div>' +
        '<label class="fld"><span>Nombre</span><input name="nombre" value="' + esc(f.nombre) + '" placeholder="Ej. Viaje a Cusco, Fondo de emergencia" required autocomplete="off"></label>' +
        '<label class="fld"><span>Monto objetivo (' + esc(CFG.CURRENCY) + ')</span><input name="objetivo" inputmode="decimal" value="' + esc(f.objetivo) + '" placeholder="0.00" required></label>' +
        '<label class="fld"><span>Fecha límite (opcional)</span><input type="date" name="fechaLimite" value="' + esc(f.fechaLimite) + '"></label>' +
        '<label class="fld"><span>Cuenta de ahorro</span><select name="cuentaId">' + aho.map(c => '<option value="' + c.id + '"' + (c.id === f.cuentaId ? ' selected' : '') + '>' + esc(c.nombre) + '</option>').join('') + '</select></label>';
      if (meta) h += '<p class="muted small">Si cambias la cuenta, los aportes hechos en la cuenta anterior quedan "sin asignar".</p>';
      h += '<button class="btn primary big" type="submit">' + (meta ? 'Guardar' : 'Crear meta') + '</button>';
      if (meta) h += '<div class="btn-row"><button type="button" class="btn ghost" data-act="metaArchive" data-id="' + meta.id + '">' + (meta.estado === 'Archivada' ? 'Reactivar' : 'Archivar') + '</button>' +
        '<button type="button" class="btn danger-ghost" data-act="metaDelete" data-id="' + meta.id + '">Eliminar</button></div><p class="muted small">Eliminar una meta no borra dinero: sus aportes quedan en la cuenta como "sin asignar".</p>';
      return h + '</form>';
    }
  }).state.edit = meta;
}
function openMeta(id) {
  openSheet({
    kind: 'meta', live: true, tall: true,
    title: () => { const mt = S.idx.meta.get(id); return mt ? (mt.icono || '🎯') + ' ' + mt.nombre : 'Meta'; },
    right: () => '<button class="sh-btn strong" data-act="editMeta" data-id="' + id + '">Editar</button>',
    render: () => {
      const meta = S.idx.meta.get(id);
      if (!meta) return '<p class="muted">La meta ya no existe.</p>';
      const st = metaStats(meta);
      const aportes = S.movs.filter(m => m.metaId === id).sort((a, b) => a.fecha < b.fecha ? 1 : -1);
      let h = '<div class="meta-hero"><div class="ring" style="--p:' + (st.pct * 360).toFixed(1) + 'deg;--c:' + ctaColor(meta.cuentaId) + '"><span>' + Math.round(st.pct * 100) + '%</span></div>' +
        '<div><div class="hero-amt sm">' + money(st.real) + '</div><div class="muted">de ' + money(st.obj) + ' · en ' + esc(ctaName(meta.cuentaId)) + '</div></div></div>';
      h += progressBar(st, ctaColor(meta.cuentaId));
      h += '<div class="kv"><span>Falta</span><b>' + money(st.falta) + '</b></div>';
      if (Math.abs(st.proy - st.real) > 0.004) h += '<div class="kv"><span>Con aportes proyectados</span><b>' + money(st.proy) + '</b></div>';
      if (meta.fechaLimite) {
        h += '<div class="kv"><span>Fecha límite</span><b>' + esc(dayLabel(meta.fechaLimite, { day: 'numeric', month: 'long', year: 'numeric' })) + '</b></div>';
        if (!st.done) h += st.vencida ? '<div class="banner warn">La fecha límite ya paso. Edita la meta para ponerle una nueva fecha.</div>'
          : '<div class="kv big"><span>Para llegar a tiempo</span><b>' + money(st.porMes) + ' / mes</b></div>' +
            (st.ritmo != null ? '<div class="kv"><span>Ritmo</span><b class="' + (st.ritmo >= -0.5 ? 'pos' : 'neg') + '">' + (st.ritmo >= -0.5 ? 'Vas al día (+' + money(st.ritmo) + ')' : 'Atrasada ' + money(-st.ritmo)) + '</b></div>' : '');
      }
      if (st.done) h += '<div class="banner ok">🎉 ¡Meta cumplida! Puedes archivarla desde Editar.</div>';
      h += '<div class="btn-row"><button class="btn primary" data-act="metaAportar" data-id="' + id + '">Aportar</button><button class="btn" data-act="metaRetirar" data-id="' + id + '">Retirar</button></div>';
      h += '<h4 class="sec">Aportes (' + aportes.length + ')</h4>' + (aportes.length ? '<div class="list">' + aportes.map(m => movRow(m, { date: true })).join('') + '</div>' : '<p class="muted small">Aún no hay aportes. Usa "Aportar" para transferir desde una cuenta corriente.</p>');
      return h;
    }
  });
}

/* ---------- Gastos fijos ---------- */
async function loadFijos() {
  try { const r = await api('getGastosFijos'); S.fijos = r.fijos; S.fijosAplicados = r.aplicados; } catch (e) { if (!e.auth) toast(e.message, 'error'); }
  const sh = findSheet('fijos'); if (sh) sh.render();
}
function openFijos() {
  const mk = monthKey(S.month);
  openSheet({
    kind: 'fijos', live: true, tall: true, title: 'Gastos fijos',
    right: () => '<button class="sh-btn strong" data-act="newFijo">+ Nuevo</button>',
    render: () => {
      const ap = S.fijosAplicados.find(a => a.mes === mk);
      let h = '<div class="banner ' + (ap ? 'ok' : 'info') + '">' + (ap
        ? 'Ya cargados en <b>' + esc(monthLabel(S.month)) + '</b> (' + esc(String(ap.en).slice(0, 16)) + (ap.por ? ' por ' + esc(ap.por) : '') + ').'
        : 'Aún no se cargan en <b>' + esc(monthLabel(S.month)) + '</b>.') + '</div>';
      if (S.fijos == null) return h + '<div class="empty small"><div class="spinner"></div></div>';
      h += S.fijos.length ? '<div class="list">' + S.fijos.map(f => '<button class="li" data-act="editFijo" data-id="' + f.id + '"><span class="daybox">' + f.dia + '</span><div class="li-main"><b>' + esc(f.categoria) + '</b><small>' +
        '<span class="dot" style="--c:' + ctaColor(f.cuentaId) + '"></span>' + esc(ctaName(f.cuentaId)) + (f.detalle ? ' · ' + esc(f.detalle) : '') + '</small></div><b class="' + (f.tipo === 'Ingreso' ? 'pos' : 'neg') + '">' + (f.tipo === 'Ingreso' ? '+' : '-') + money(f.monto) + '</b></button>').join('') + '</div>'
        : '<div class="empty small"><p>La plantilla está vacía. Agrega tus pagos de cada mes (alquiler, servicios, sueldo...).</p></div>';
      if (S.fijos.length) {
        const neto = sum(S.fijos, f => f.tipo === 'Ingreso' ? f.monto : -f.monto);
        h += '<p class="muted small">Neto de la plantilla: ' + moneyPlus(neto) + ' al mes. Se cargan como <b>proyectados</b>.</p>';
        h += ap ? '<button class="btn wide" data-act="applyFijos" data-force="1">Volver a cargar en ' + esc(monthLabel(S.month)) + '</button><p class="muted small">Reemplaza los fijos ya cargados de ese mes (no toca lo que registraste a mano).</p>'
          : '<button class="btn primary wide" data-act="applyFijos" data-force="0">Cargar en ' + esc(monthLabel(S.month)) + '</button>';
      }
      const hist = S.fijosAplicados.slice().sort((a, b) => a.mes < b.mes ? 1 : -1).slice(0, 12);
      if (hist.length) h += '<h4 class="sec">Meses ya cargados</h4>' + hist.map(a => '<div class="kv"><span>' + esc(monthLabel(pd(a.mes + '-01'))) + '</span><small class="muted">' + esc(String(a.en).slice(0, 10)) + (a.por ? ' · ' + esc(a.por) : '') + '</small></div>').join('');
      return h;
    }
  });
  loadFijos();
}
function openFijoForm(id) {
  const f0 = id ? (S.fijos || []).find(x => x.id === id) : null;
  const F = f0 ? Object.assign({}, f0) : { dia: 1, tipo: 'Salida', cuentaId: (activeCuentas('Corriente')[0] || activeCuentas()[0] || {}).id, categoria: '', monto: '', detalle: '' };
  openSheet({
    kind: 'fijoform', closeLabel: 'Cancelar', title: f0 ? 'Editar gasto fijo' : 'Nuevo gasto fijo', state: { F },
    render: sh => {
      const f = sh.state.F;
      return '<form data-form="fijo"><div class="seg big">' + [['Salida', 'Gasto'], ['Ingreso', 'Ingreso']].map(x => '<button type="button" class="' + (f.tipo === x[0] ? 'on ' + (x[0] === 'Salida' ? 'gasto' : 'ingreso') : '') + '" data-act="fijoTipo" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>' +
        '<label class="amount ' + (f.tipo === 'Salida' ? 'gasto' : 'ingreso') + '"><span>' + esc(CFG.CURRENCY) + '</span><input name="monto" inputmode="decimal" placeholder="0.00" value="' + esc(f.monto) + '" required></label>' +
        '<div class="row2"><label class="fld"><span>Día del mes</span><input name="dia" type="number" min="1" max="31" inputmode="numeric" value="' + esc(f.dia) + '" required></label>' +
        '<label class="fld"><span>Cuenta</span><select name="cuentaId">' + cuentaOpts(f.cuentaId, 'all') + '</select></label></div>' +
        '<label class="fld"><span>Categoría</span><select name="categoria">' + catOpts(f.categoria || defaultCat(f.tipo === 'Ingreso' ? 'ingreso' : 'gasto')) + '</select></label>' +
        '<label class="fld"><span>Detalle</span><input name="detalle" value="' + esc(f.detalle) + '" placeholder="Opcional"></label>' +
        '<p class="muted small">Si el mes tiene menos días (ej. 31 en febrero), se usa el último día del mes.</p>' +
        '<button class="btn primary big" type="submit">' + (f0 ? 'Guardar' : 'Agregar') + '</button>' +
        (f0 ? '<button type="button" class="btn danger-ghost wide" data-act="delFijo" data-id="' + f0.id + '">Eliminar de la plantilla</button>' : '') + '</form>';
    }
  }).state.edit = f0;
}

/* ---------- Cuadre con el banco ---------- */
function openCuadre() {
  openSheet({
    kind: 'cuadre', closeLabel: 'Cancelar', title: 'Cuadre con el banco',
    render: () => {
      const r = cuadre();
      if (!r.det.length) return '<p class="muted">Crea primero una cuenta corriente.</p>';
      return '<form data-form="cuadre"><p class="muted small">Anota el saldo que ves hoy en la app de cada banco. Se compara con el saldo <b>real</b> registrado aquí hasta el sábado de esta semana.</p>' +
        r.det.map(x => '<div class="cuadre-row"><div class="li-main"><b><span class="dot" style="--c:' + x.c.color + '"></span>' + esc(x.c.nombre) + '</b><small>Según la app: ' + money(x.app) + (x.saldo ? ' · último registro ' + esc(shortDate(x.saldo.fecha)) : '') + '</small></div>' +
          '<input class="inp num" name="s_' + x.c.id + '" inputmode="decimal" value="' + (x.saldo ? x.saldo.saldo.toFixed(2) : '') + '" placeholder="0.00" data-input="cuadreCalc"></div>').join('') +
        '<div class="kv big"><span>Diferencia</span><b id="cuadreDif">—</b></div>' +
        '<button class="btn primary big" type="submit">Guardar saldos</button></form>';
    },
    mount: sh => calcCuadre(sh)
  });
}
function calcCuadre(sh) {
  const r = cuadre();
  let banco = 0, alguno = false;
  r.det.forEach(x => { const i = $('[name="s_' + x.c.id + '"]', sh.body); if (i && i.value.trim() !== '') alguno = true; banco += parseAmount(i && i.value); });
  const dif = banco - r.app, el = $('#cuadreDif', sh.body);
  if (!el) return;
  if (!alguno) { el.textContent = '—'; el.className = 'muted'; return; }
  el.textContent = Math.abs(dif) < 0.01 ? 'Cuadrado ✓' : moneyPlus(dif);
  el.className = Math.abs(dif) < 0.01 ? 'pos' : dif > 0 ? 'blue' : 'neg';
}

/* ---------- Contraseña / instalar ---------- */
function openPassword() {
  openSheet({
    kind: 'pwd', closeLabel: 'Cancelar', title: 'Cambiar contraseña',
    render: () => '<form data-form="pwd"><label class="fld"><span>Contraseña actual</span><input type="password" name="actual" autocomplete="current-password" required></label>' +
      '<label class="fld"><span>Nueva contraseña</span><input type="password" name="nueva" autocomplete="new-password" minlength="6" required></label>' +
      '<label class="fld"><span>Repite la nueva</span><input type="password" name="nueva2" autocomplete="new-password" minlength="6" required></label>' +
      '<p class="muted small">Al cambiarla se cierra tu sesión en los demás dispositivos.</p><button class="btn primary big" type="submit">Cambiar</button></form>'
  });
}
function openInstallHelp() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  openSheet({
    kind: 'install', title: 'Instalar la app',
    render: () => (standalone ? '<div class="banner ok">Ya estás usando la app instalada. ✓</div>' : '') +
      '<h4 class="sec">iPhone / iPad (Safari)</h4><ol class="steps"><li>Abre esta página en <b>Safari</b>.</li><li>Toca el botón <b>Compartir</b> (cuadro con flecha hacia arriba).</li><li>Elige <b>"Agregar a pantalla de inicio"</b> y confirma.</li><li>Abre la app desde el nuevo ícono (no desde Safari).</li></ol>' +
      '<h4 class="sec">Android (Chrome)</h4><ol class="steps"><li>Abre esta página en <b>Chrome</b>.</li><li>Toca el menú <b>⋮</b> y elige <b>"Instalar aplicación"</b> (o "Agregar a pantalla principal").</li></ol>' +
      (deferredInstall ? '<button class="btn primary wide" data-act="installNow">Instalar ahora</button>' : '')
  });
}

/* ---------- Barra de seleccion multiple ---------- */
function renderSelbar() {
  const bar = $('#selbar');
  if (!bar) return;
  const ids = Array.from(S.sel).filter(id => getMov(id));
  if (!ids.length) { bar.hidden = true; document.body.classList.remove('has-sel'); return; }
  const tot = sum(ids.map(getMov), m => m.monto);
  bar.hidden = false;
  document.body.classList.add('has-sel');
  bar.innerHTML = '<div class="sb-top"><b>' + ids.length + ' seleccionado(s)</b><span class="' + (tot >= 0 ? 'pos' : 'neg') + '">' + moneyPlus(tot) + '</span><button class="mini" data-act="clearSel" aria-label="Quitar seleccion">' + IC.x + '</button></div>' +
    '<div class="sb-acts"><button data-act="bulkEstado" data-v="Real">Real</button><button data-act="bulkEstado" data-v="Proyectado">Proy</button>' +
    '<button data-act="bulkCat">Categoría</button><button data-act="bulkMove">Mover</button><button class="danger" data-act="bulkDel">Eliminar</button></div>';
}
function toggleSel(id) {
  if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
  haptic();
  if (!S.sel.size) S.selMode = false;
  renderView(); refreshSheets(); renderSelbar();
}
function clearSel() { S.sel.clear(); S.selMode = false; renderView(); refreshSheets(); renderSelbar(); }

/* ============================ ACCIONES ============================ */
async function ejecutar(id) {
  const m = getMov(id);
  if (!m) return;
  if (isMovLocked(m)) return toast('Semana cerrada.', 'error');
  const affected = withPartners([id]);
  affected.forEach(x => { x.estado = 'Real'; });
  refreshUI();
  try {
    await write('setEstadoMovement', [id, 'Real'], { onError: () => { affected.forEach(x => { x.estado = 'Proyectado'; }); refreshUI(); } });
    haptic();
    toastUndo('"' + m.categoria + '" ejecutado', () => quiet(write('setEstadoMovement', [id, 'Proyectado'])));
  } catch (e) {}
}
async function eliminarRapido(id) {
  const m = getMov(id);
  if (!m) return;
  if (isMovLocked(m)) return toast('Semana cerrada.', 'error');
  const recs = withPartners([id]).map(x => Object.assign({}, x));
  recs.forEach(r => removeMov(r.id));
  refreshUI();
  try {
    await write('deleteMovement', [id], { onError: () => { recs.forEach(upsertMov); refreshUI(); } });
    toastUndo('"' + m.categoria + '" eliminado', () => quiet(write('restoreMultiple', [recs])));
  } catch (e) {}
}
async function eliminarConfirm(id) {
  const m = getMov(id);
  if (!m) return;
  const msg = m.enlace ? 'Es una transferencia: se eliminarán los dos movimientos (salida y entrada).' : '';
  if (!(await ask('Eliminar movimiento', msg, 'Eliminar', true))) return;
  const sh = findSheet('movform'); if (sh) closeSheet(sh);
  eliminarRapido(id);
}
async function moverFecha(ids, fecha) {
  const movs = ids.map(getMov).filter(m => m && m.fecha !== fecha);
  if (!movs.length) return;
  const destLocked = movs.some(m => !lockExempt(m) && isLockedDate(fecha));
  if (destLocked) return toast('La semana de destino está cerrada.', 'error');
  const bad = movs.find(isMovLocked);
  if (bad) return toast('"' + bad.categoria + '" pertenece a una semana cerrada.', 'error');
  const all = withPartners(movs.map(m => m.id));
  const prev = {};
  all.forEach(m => { prev[m.id] = m.fecha; m.fecha = fecha; });
  refreshUI();
  const undo = () => {
    const groups = {};
    all.forEach(m => { (groups[prev[m.id]] = groups[prev[m.id]] || []).push(m.id); });
    Object.keys(groups).forEach(d => quiet(write('updateMultipleMovementDates', [groups[d], d])));
  };
  try {
    await write('updateMultipleMovementDates', [movs.map(m => m.id), fecha], { onError: () => { all.forEach(m => { m.fecha = prev[m.id]; }); refreshUI(); } });
    toastUndo(movs.length + ' movimiento(s) movido(s) al ' + shortDate(fecha), undo);
  } catch (e) {}
}
async function reordenar(id, dir) {
  const m = getMov(id);
  if (!m) return;
  if (isMovLocked(m)) return toast('Semana cerrada.', 'error');
  const day = S.movs.filter(x => x.fecha === m.fecha).sort(sortByOrden);
  const i = day.findIndex(x => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= day.length) return;
  const rest = day.filter(x => x.id !== id);
  // posicion destino dentro de "rest": insertar en j
  const lo = j > 0 ? (rest[j - 1].orden || 0) : (rest[0] ? (rest[0].orden || 0) - 1000 : 0);
  const hi = j < rest.length ? (rest[j].orden || 0) : ((rest[rest.length - 1] || {}).orden || 0) + 1000;
  const nuevo = (lo + hi) / 2;
  const prevO = m.orden;
  m.orden = nuevo;
  refreshUI();
  quiet(write('reorderMovement', [id, nuevo], { noRefresh: true, onError: () => { m.orden = prevO; refreshUI(); } }));
}
async function reordenarDrop(dragId, targetId, before) {
  const dm = getMov(dragId), tm = getMov(targetId);
  if (!dm || !tm || dm.fecha !== tm.fecha) return false;
  if (isMovLocked(dm)) { toast('Semana cerrada.', 'error'); return true; }
  const day = S.movs.filter(x => x.fecha === tm.fecha && x.id !== dragId && inFlow(x)).sort(sortByOrden);
  const idx = day.findIndex(x => x.id === targetId);
  const lo = before ? (idx > 0 ? day[idx - 1].orden : tm.orden - 1000) : tm.orden;
  const hi = before ? tm.orden : (idx < day.length - 1 ? day[idx + 1].orden : tm.orden + 1000);
  const nuevo = (lo + hi) / 2;
  if (Math.abs(nuevo - dm.orden) < 1e-9) return true;
  const prevO = dm.orden;
  dm.orden = nuevo;
  refreshUI();
  quiet(write('reorderMovement', [dragId, nuevo], { noRefresh: true, onError: () => { dm.orden = prevO; refreshUI(); } }));
  return true;
}
async function toggleWeek(sat, lock) {
  if (!(await ask(lock ? 'Cerrar semana' : 'Reabrir semana', lock ? 'No se podrán editar ni mover sus movimientos de cuentas corrientes.' : 'Se podrán volver a editar sus movimientos.', lock ? 'Cerrar semana' : 'Reabrir'))) return;
  quiet(write('toggleLockWeek', [sat, lock], { ok: lock ? 'Semana cerrada.' : 'Semana reabierta.' }));
}

/* ============================ EVENTOS (delegacion) ============================ */
const ACT = {
  tab: el => goTab(el.dataset.tab),
  goCal: () => { S.month = firstOfMonth(pd(today())); goTab('calendario'); },
  goCalSum: () => { S.month = firstOfMonth(pd(today())); S.calView = 'month'; goTab('calendario'); openResumen(); },
  openResumen: () => openResumen(),
  showDeficit: () => dialog('<h4>ð¨ Ruptura de caja</h4><p>El saldo proyectado de tus cuentas corrientes no alcanza en:</p><div class="dlg-list">' +
    S.deficits.map(d => '<button data-v="' + d.fecha + '"><b>' + esc(dayLabel(d.fecha, { weekday: 'short', day: 'numeric', month: 'short' })) + '</b> Â· <span class="neg">' + money(d.saldo) + '</span></button>').join('') +
    '</div><div class="dlg-btns"><button data-v="">Cerrar</button></div>').then(d => { if (d) openDay(d); }),
  calView: el => setCalView(el.dataset.v),
  closeSheet: () => closeSheet(),
  newMov: el => openMovForm({ fecha: el.dataset.d, cuentaId: el.dataset.cta }),
  editMov: el => openMovForm({ id: el.dataset.id }),
  chip: (el, e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || S.sel.size) return toggleSel(el.dataset.id);
    openMovForm({ id: el.dataset.id });
  },
  day: el => {
    const d = el.dataset.d, dd = pd(d);
    if (S.sel.size && !S.selMode) return clearSel();
    if (dd.getMonth() !== S.month.getMonth()) { S.month = firstOfMonth(dd); return renderView(); }
    openDay(d);
  },
  exec: el => ejecutar(el.dataset.id),
  execFromForm: el => { const sh = findSheet('movform'); if (sh) closeSheet(sh); ejecutar(el.dataset.id); },
  quickDel: el => eliminarRapido(el.dataset.id),
  delMov: el => eliminarConfirm(el.dataset.id),
  dupMov: el => {
    const m = getMov(el.dataset.id); if (!m) return;
    const sh = findSheet('movform'); if (sh) closeSheet(sh);
    if (m.enlace) {
      const p = partnerOf(m);
      const out = m.monto < 0 ? m : p, inn = m.monto < 0 ? p : m;
      return openMovForm({ modo: 'transfer', fecha: m.fecha, desdeId: out && out.cuentaId, haciaId: inn && inn.cuentaId, metaDesdeId: out && out.metaId, metaHaciaId: inn && inn.metaId });
    }
    setTimeout(() => {
      const s2 = openMovForm({ modo: m.monto < 0 ? 'gasto' : 'ingreso', fecha: m.fecha, cuentaId: m.cuentaId, categoria: m.categoria, metaId: m.metaId });
      const t = topSheet(); if (t && t.state.F) { Object.assign(t.state.F, { monto: Math.abs(m.monto).toFixed(2), detalle: m.detalle, estado: m.estado }); t.render(); }
      return s2;
    }, 0);
  },
  toToday: el => moverFecha([el.dataset.id], today()),
  execAllVenc: async () => {
    const ids = vencidos().map(m => m.id);
    if (!ids.length) return;
    if (!(await ask('Ejecutar todos', '¿Marcar como reales los ' + ids.length + ' proyectados vencidos?', 'Ejecutar'))) return;
    quiet(write('setEstadoMultiple', [ids, 'Real'], { ok: ids.length + ' ejecutados.' }));
  },
  month: el => {
    if (S.calView === 'week') S.week = addDays(S.week || sundayOf(today()), 7 * (+el.dataset.d));
    else S.month = new Date(S.month.getFullYear(), S.month.getMonth() + (+el.dataset.d), 1);
    renderView();
  },
  thisMonth: () => { S.month = firstOfMonth(pd(today())); S.week = sundayOf(today()); renderView(); },
  filter: el => { S.filter = el.dataset.id; store.set('filter', S.filter); renderView(); refreshSheets(); },
  saldoIni: el => openMovForm({ fecha: el.dataset.d, categoria: CAT_SALDO_INI, modo: 'ingreso' }),
  lockWeek: el => toggleWeek(el.dataset.sat, el.dataset.lock === '1'),
  sumTab: el => { S.sumTab = el.dataset.t; const sh = findSheet('resumen'); if (sh) sh.render(); },
  openVencidos, openSearch, openCats, openCuentas, openFijos, openCuadre, openPassword,
  installHelp: openInstallHelp,
  installNow: async () => { if (!deferredInstall) return; deferredInstall.prompt(); deferredInstall = null; closeSheet(); },
  logout,
  resetUrl: () => { store.del('apiUrl'); renderLogin(); },
  forceSync: () => { loadData(true); },
  openCuentaHist: el => openCuentaHist(el.dataset.id),
  newCuenta: el => openCuentaForm({ tipo: el.dataset.tipo }),
  editCuenta: el => openCuentaForm({ id: el.dataset.id }),
  ctaTipo: el => { const sh = topSheet(); readCuentaForm(sh); sh.state.F.tipo = el.dataset.v; sh.render(); },
  ctaColor: el => { const sh = topSheet(); readCuentaForm(sh); sh.state.F.color = el.dataset.v; sh.render(); },
  ctaArchive: async el => {
    const c = cta(el.dataset.id); if (!c) return;
    await write('updateCuenta', [c.id, { activa: !c.activa }], { ok: c.activa ? 'Cuenta archivada.' : 'Cuenta reactivada.' }).catch(() => {});
    closeSheet(findSheet('ctaform'));
  },
  ctaDelete: async el => {
    const c = cta(el.dataset.id); if (!c) return;
    if (!(await ask('Eliminar cuenta', 'Se eliminará "' + c.nombre + '" y sus metas. Solo es posible si no tiene movimientos.', 'Eliminar', true))) return;
    try { await write('deleteCuenta', [c.id], { ok: 'Cuenta eliminada.' }); closeSheet(findSheet('ctaform')); } catch (e) {}
  },
  deposit: el => openMovForm({ modo: 'transfer', haciaId: el.dataset.id, desdeId: (activeCuentas('Corriente')[0] || {}).id }),
  withdraw: el => openMovForm({ modo: 'transfer', desdeId: el.dataset.id, haciaId: (activeCuentas('Corriente')[0] || {}).id }),
  newMeta: el => openMetaForm({ cuentaId: el.dataset.id }),
  editMeta: el => openMetaForm({ id: el.dataset.id }),
  openMeta: el => openMeta(el.dataset.id),
  metaIcono: el => { const sh = topSheet(); const form = $('form', sh.body); ['nombre', 'objetivo', 'fechaLimite', 'cuentaId'].forEach(k => { sh.state.F[k] = form[k].value; }); sh.state.F.icono = el.dataset.v; sh.render(); },
  metaAportar: el => { const mt = S.idx.meta.get(el.dataset.id); if (mt) openMovForm({ modo: 'transfer', haciaId: mt.cuentaId, metaHaciaId: mt.id, desdeId: (activeCuentas('Corriente')[0] || {}).id }); },
  metaRetirar: el => { const mt = S.idx.meta.get(el.dataset.id); if (mt) openMovForm({ modo: 'transfer', desdeId: mt.cuentaId, metaDesdeId: mt.id, haciaId: (activeCuentas('Corriente')[0] || {}).id }); },
  metaArchive: async el => {
    const mt = S.idx.meta.get(el.dataset.id); if (!mt) return;
    await write('updateMeta', [mt.id, { estado: mt.estado === 'Archivada' ? 'Activa' : 'Archivada' }], { ok: mt.estado === 'Archivada' ? 'Meta reactivada.' : 'Meta archivada.' }).catch(() => {});
    closeSheet(findSheet('metaform'));
  },
  metaDelete: async el => {
    const mt = S.idx.meta.get(el.dataset.id); if (!mt) return;
    if (!(await ask('Eliminar meta', 'El dinero no se borra: sus aportes quedan en la cuenta como "sin asignar".', 'Eliminar', true))) return;
    try { await write('deleteMeta', [mt.id], { ok: 'Meta eliminada.' }); closeSheet(findSheet('metaform')); const d = findSheet('meta'); if (d) closeSheet(d); } catch (e) {}
  },
  movModo: el => { const sh = topSheet(); readMovForm(sh); const f = sh.state.F; f.modo = el.dataset.v;
    if (f.modo === 'transfer') { if (!f.desdeId) f.desdeId = f.cuentaId; if (!f.haciaId || f.haciaId === f.desdeId) f.haciaId = (activeCuentas().find(c => c.id !== f.desdeId) || {}).id || ''; }
    if (!f.categoria || f.categoria === defaultCat(f.modo === 'ingreso' ? 'gasto' : 'ingreso')) f.categoria = defaultCat(f.modo);
    sh.render(); },
  movEstado: el => { const sh = topSheet(); readMovForm(sh); sh.state.F.estado = el.dataset.v; sh.state.estadoTocado = true; sh.render(); },
  fijoTipo: el => { const sh = topSheet(); const form = $('form', sh.body); ['monto', 'dia', 'cuentaId', 'categoria', 'detalle'].forEach(k => { sh.state.F[k] = form[k].value; }); sh.state.F.tipo = el.dataset.v; sh.render(); },
  newFijo: () => openFijoForm(null),
  editFijo: el => openFijoForm(el.dataset.id),
  delFijo: async el => {
    if (!(await ask('Eliminar gasto fijo', 'Se quita de la plantilla. Los meses ya cargados no cambian.', 'Eliminar', true))) return;
    try { const r = await api('deleteGastoFijo', el.dataset.id); S.fijos = r.fijos; S.fijosAplicados = r.aplicados; closeSheet(findSheet('fijoform')); refreshUI(); toast('Eliminado.', 'ok'); } catch (e) { if (!e.auth) toast(e.message, 'error'); }
  },
  applyFijos: async el => {
    const force = el.dataset.force === '1', mk = monthKey(S.month);
    if (force && !(await ask('Volver a cargar', 'Se reemplazan los gastos fijos de ' + monthLabel(S.month) + ' con la plantilla actual.', 'Volver a cargar', true))) return;
    quiet(write('applyGastosFijos', [mk, force], { ok: 'Gastos fijos cargados en ' + monthLabel(S.month) + '.' }));
  },
  catAdd: async () => { const v = await askText('Nueva categoría', '', 'Ej. GIMNASIO'); if (v) quiet(write('addCategoria', [v], { ok: 'Categoría agregada.' })); },
  catRename: async el => {
    const old = S.cats[+el.dataset.i]; if (!old) return;
    const v = await askText('Renombrar "' + old + '"', old);
    if (v && v !== old) quiet(write('renameCategoria', [old, v], { ok: 'Categoría renombrada.' }));
  },
  catDel: async el => {
    const c = S.cats[+el.dataset.i]; if (!c) return;
    if (await ask('Eliminar categoría', '"' + c + '"', 'Eliminar', true)) quiet(write('deleteCategoria', [c], { ok: 'Categoría eliminada.' }));
  },
  dayEst: el => { const sh = findSheet('day'); sh.state.est = el.dataset.v; $$('[data-act=dayEst]', sh.body).forEach(b => b.classList.toggle('on', b === el)); sh.o.update(sh); },
  selMode: () => { S.selMode = !S.selMode; if (!S.selMode) S.sel.clear(); refreshSheets(); renderSelbar(); },
  orderMode: () => { const sh = findSheet('day'); if (sh) { sh.state.order = !sh.state.order; sh.o.update(sh); } },
  orderUp: el => reordenar(el.dataset.id, -1),
  orderDown: el => reordenar(el.dataset.id, 1),
  toggleSel: el => toggleSel(el.dataset.id),
  clearSel: () => clearSel(),
  bulkEstado: el => { const ids = Array.from(S.sel); clearSel(); quiet(write('setEstadoMultiple', [ids, el.dataset.v], { ok: ids.length + ' marcado(s) como ' + el.dataset.v + '.' })); },
  bulkCat: async () => {
    const c = await pick('Cambiar categoría', S.cats.filter(x => x !== CAT_TRANSF).map(x => ({ value: x, label: x })));
    if (!c) return;
    const ids = Array.from(S.sel); clearSel();
    quiet(write('setCategoriaMultiple', [ids, c], { ok: 'Recategorizado(s) a ' + c + '.' }));
  },
  bulkMove: async () => { const d = await askDate('Mover a la fecha'); if (!d) return; const ids = Array.from(S.sel); clearSel(); moverFecha(ids, d); },
  bulkDel: async () => {
    const ids = Array.from(S.sel);
    if (!(await ask('Eliminar ' + ids.length + ' movimiento(s)', 'Las transferencias se eliminan con su otro lado.', 'Eliminar', true))) return;
    const recs = withPartners(ids).map(x => Object.assign({}, x));
    clearSel();
    try { await write('deleteMultiple', [ids]); toastUndo(recs.length + ' movimiento(s) eliminado(s)', () => quiet(write('restoreMultiple', [recs]))); } catch (e) {}
  }
};

const FORMS = {
  login: form => doLogin(form),
  mov: (form, sh) => submitMov(sh),
  cuenta: async (form, sh) => {
    const f = readCuentaForm(sh), c = sh.state.edit;
    if (!f.nombre.trim()) return toast('Ponle un nombre.', 'error');
    try {
      if (c) await write('updateCuenta', [c.id, { nombre: f.nombre, tipo: f.tipo, color: f.color }], { ok: 'Cuenta actualizada.' });
      else await write('addCuenta', [{ nombre: f.nombre, tipo: f.tipo, color: f.color, saldoInicial: f.saldoInicial, fechaSaldo: f.fechaSaldo }], { ok: 'Cuenta creada.' });
      closeSheet(sh);
    } catch (e) {}
  },
  meta: async (form, sh) => {
    const mt = sh.state.edit;
    const f = { nombre: form.nombre.value, objetivo: parseAmount(form.objetivo.value), fechaLímite: form.fechaLimite.value, cuentaId: form.cuentaId.value, icono: sh.state.F.icono };
    if (!(f.objetivo > 0)) return toast('El objetivo debe ser mayor a 0.', 'error');
    try {
      if (mt) await write('updateMeta', [mt.id, f], { ok: 'Meta actualizada.' });
      else await write('addMeta', [f], { ok: 'Meta creada. ¡A ahorrar!' });
      closeSheet(sh);
    } catch (e) {}
  },
  fijo: async (form, sh) => {
    const f0 = sh.state.edit;
    const f = { dia: form.dia.value, tipo: sh.state.F.tipo, cuentaId: form.cuentaId.value, categoria: form.categoria.value, monto: parseAmount(form.monto.value), detalle: form.detalle.value };
    if (!(f.monto > 0)) return toast('Ingresa un monto mayor a 0.', 'error');
    try {
      const r = f0 ? await api('updateGastoFijo', f0.id, f) : await api('addGastoFijo', f);
      S.fijos = r.fijos; S.fijosAplicados = r.aplicados;
      closeSheet(sh); refreshUI(); toast(f0 ? 'Gasto fijo actualizado.' : 'Agregado a la plantilla.', 'ok');
    } catch (e) { if (!e.auth) toast(e.message, 'error'); }
  },
  cuadre: async (form, sh) => {
    const items = cuadre().det.map(x => ({ cuentaId: x.c.id, saldo: form['s_' + x.c.id].value })).filter(x => String(x.saldo).trim() !== '');
    try { await write('updateSaldos', [items], { ok: 'Saldos guardados.' }); closeSheet(sh); } catch (e) {}
  },
  pwd: async (form, sh) => {
    if (form.nueva.value !== form.nueva2.value) return toast('Las contraseñas nuevas no coinciden.', 'error');
    try { await api('changePassword', form.actual.value, form.nueva.value); closeSheet(sh); toast('Contraseña cambiada.', 'ok'); } catch (e) { if (!e.auth) toast(e.message, 'error'); }
  }
};

const INPUTS = {
  dayQ: (el, sh) => { sh.state.q = el.value; sh.o.update(sh); },
  searchQ: (el, sh) => { sh.state.q = el.value; clearTimeout(sh.t); sh.t = setTimeout(() => sh.o.update(sh), 150); },
  cuadreCalc: (el, sh) => calcCuadre(sh)
};
const CHANGES = {
  movCta: (el, sh) => { readMovForm(sh); sh.render(); },
  movFecha: (el, sh) => { readMovForm(sh); if (!sh.state.estadoTocado && !sh.state.edit) { sh.state.F.estado = sh.state.F.fecha > today() ? 'Proyectado' : 'Real'; sh.render(); } }
};
const sheetOf = el => sheets.find(s => s.wrap.contains(el));

let suppressClick = false;
document.addEventListener('click', e => {
  if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'BUTTON' && el.type !== 'submit') e.preventDefault();
  fn(el, e);
});
document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const fn = FORMS[form.dataset.form];
  if (fn) fn(form, sheetOf(form));
});
document.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.input; if (k && INPUTS[k]) INPUTS[k](e.target, sheetOf(e.target)); });
document.addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.change; if (k && CHANGES[k]) CHANGES[k](e.target, sheetOf(e.target)); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (dialogOpen) return dialogOpen.cancel(); if (sheets.length) return closeSheet(); if (S.sel.size) return clearSel(); }
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'select', 'textarea'].includes(tag) || sheets.length || !S.token) return;
  if (e.key === 'n' || e.key === 'N') openMovForm({});
  else if (e.key === '/') { e.preventDefault(); openSearch(); }
  else if (S.tab === 'calendario' && e.key === 'ArrowLeft') ACT.month({ dataset: { d: -1 } });
  else if (S.tab === 'calendario' && e.key === 'ArrowRight') ACT.month({ dataset: { d: 1 } });
});

// Mantener presionado un movimiento = seleccionarlo (seleccion multiple en el teléfono).
(function longPress() {
  let timer = null, x0 = 0, y0 = 0;
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest('[data-lp]');
    if (!el || e.target.closest('button') || e.pointerType === 'mouse') return;
    x0 = e.clientX; y0 = e.clientY;
    timer = setTimeout(() => { timer = null; suppressClick = true; S.selMode = true; toggleSel(el.dataset.lp); }, 480);
  });
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  document.addEventListener('pointermove', e => { if (timer && (Math.abs(e.clientX - x0) > 8 || Math.abs(e.clientY - y0) > 8)) cancel(); });
  // Si tras mantener presionado el navegador no genera el "click", no hay que tragarse el siguiente toque.
  document.addEventListener('pointerup', () => { cancel(); if (suppressClick) setTimeout(() => { suppressClick = false; }, 400); });
  document.addEventListener('pointercancel', cancel);
  document.addEventListener('contextmenu', e => { if (e.target.closest('[data-lp]')) e.preventDefault(); });
})();

// Arrastrar y soltar en el calendario (pantallas grandes / iPad): mover de dia, reordenar, cambiar de mes.
(function dnd() {
  let monthTimer = null;
  document.addEventListener('dragstart', e => {
    const chip = e.target.closest('[data-chip]');
    if (!chip) return;
    const id = chip.dataset.chip;
    const ids = S.sel.has(id) ? Array.from(S.sel) : [id];
    e.dataTransfer.setData('text/plain', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragend', () => { document.body.classList.remove('dragging'); $$('.drag-over').forEach(x => x.classList.remove('drag-over')); });
  document.addEventListener('dragover', e => {
    if (!document.body.classList.contains('dragging')) return;
    const t = e.target.closest('[data-drop],[data-mdrop]');
    if (t) e.preventDefault();
    if (e.clientY < 120) window.scrollBy(0, -20); else if (window.innerHeight - e.clientY < 120) window.scrollBy(0, 20);
  });
  document.addEventListener('dragenter', e => {
    const t = e.target.closest('[data-drop],[data-mdrop]');
    $$('.drag-over').forEach(x => { if (x !== t) x.classList.remove('drag-over'); });
    if (!t) return;
    t.classList.add('drag-over');
    if (t.dataset.mdrop && !monthTimer) monthTimer = setTimeout(() => { monthTimer = null; ACT.month({ dataset: { d: t.dataset.mdrop } }); }, 650);
  });
  document.addEventListener('dragleave', e => { const t = e.target.closest('[data-mdrop]'); if (t && monthTimer) { clearTimeout(monthTimer); monthTimer = null; } });
  document.addEventListener('drop', async e => {
    const t = e.target.closest('[data-drop]');
    document.body.classList.remove('dragging');
    $$('.drag-over').forEach(x => x.classList.remove('drag-over'));
    if (!t) return;
    e.preventDefault();
    let ids = [];
    try { ids = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
    const chip = e.target.closest('[data-chip]');
    if (chip && ids.length === 1 && chip.dataset.chip !== ids[0]) {
      const r = chip.getBoundingClientRect();
      if (await reordenarDrop(ids[0], chip.dataset.chip, (e.clientY - r.top) < r.height / 2)) return;
    }
    S.sel.clear();
    moverFecha(ids, t.dataset.drop);
  });
})();

/* ============================ VISTAS DEL CALENDARIO Y GESTOS ============================ */
function setCalView(v, weekStart) {
  if (v === 'week') {
    S.week = weekStart || (monthKey(pd(today())) === monthKey(S.month) ? sundayOf(today()) : sundayOf(dstr(S.month)));
  }
  const volverA = S.calView === 'week' && v === 'month' ? S.week : null;
  S.calView = v;
  store.set('calView', v);
  renderView();
  if (volverA) {
    // Al alejar, deja a la vista la semana que se estaba mirando.
    const w = $('.wk[data-wk="' + volverA + '"]'), st = $('.cal-sticky');
    if (w) window.scrollTo(0, Math.max(0, w.getBoundingClientRect().top + window.scrollY - (st ? st.offsetHeight : 0) - 6));
  } else window.scrollTo(0, 0);
}

// Deslizar de lado = cambiar de pestaña. Pellizcar en el calendario = mes <-> semana.
(function gestures() {
  const TABS = ['inicio', 'calendario', 'ahorro', 'mas'];
  let sw = null, pinch = null;
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const blocked = el => el.closest('.chips-row, .acc-scroll, input, select, textarea, [draggable="true"]');
  const view = () => $('#view');
  const resetView = anim => {
    const v = view(); if (!v) return;
    v.style.transition = anim ? 'transform .2s ease-out, opacity .2s' : 'none';
    v.style.transform = ''; v.style.opacity = '';
  };

  document.addEventListener('touchstart', e => {
    const v = view();
    if (!S.token || sheets.length || dialogOpen || !v || !v.contains(e.target)) { sw = null; return; }
    if (e.touches.length === 2) {
      if (sw && sw.axis === 'x') resetView(true);
      sw = null;
      if (S.tab !== 'calendario') return;
      const a = e.touches[0], b = e.touches[1], z = $('.zoomable');
      pinch = { d0: dist(a, b) || 1, mx: (a.clientX + b.clientX) / 2, my: (a.clientY + b.clientY) / 2, z, s: 1 };
      if (z) { const r = z.getBoundingClientRect(); z.style.transition = 'none'; z.style.transformOrigin = (pinch.mx - r.left) + 'px ' + (pinch.my - r.top) + 'px'; }
      return;
    }
    if (e.touches.length !== 1 || blocked(e.target)) { sw = null; return; }
    sw = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, t0: Date.now(), dx: 0, axis: null };
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (pinch) {
      if (e.touches.length < 2) return;
      e.preventDefault();
      pinch.s = Math.max(0.6, Math.min(1.8, dist(e.touches[0], e.touches[1]) / pinch.d0));
      if (pinch.z) pinch.z.style.transform = 'scale(' + pinch.s + ')';
      return;
    }
    if (!sw) return;
    const t = e.touches[0], dx = t.clientX - sw.x0, dy = t.clientY - sw.y0;
    if (!sw.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      sw.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y';
    }
    if (sw.axis !== 'x') return;
    e.preventDefault();
    const i = TABS.indexOf(S.tab);
    const borde = (dx > 0 && i === 0) || (dx < 0 && i === TABS.length - 1);
    sw.dx = borde ? dx * 0.25 : dx;
    const v = view();
    v.style.transition = 'none';
    v.style.transform = 'translateX(' + sw.dx + 'px)';
    v.style.opacity = String(1 - Math.min(0.35, Math.abs(sw.dx) / 900));
  }, { passive: false });

  function endPinch(p) {
    if (p.z) { p.z.style.transition = 'transform .18s ease-out'; p.z.style.transform = ''; }
    if (p.s > 1.2 && S.calView !== 'week') {
      const hit = document.elementFromPoint(p.mx, p.my);
      const wk = hit && hit.closest('.wk');
      haptic();
      setCalView('week', wk ? wk.dataset.wk : null);
    } else if (p.s < 0.85 && S.calView === 'week') {
      haptic();
      setCalView('month');
    }
  }

  function end(e) {
    if (pinch) { if (e.touches && e.touches.length) return; const p = pinch; pinch = null; endPinch(p); return; }
    if (!sw) return;
    const s = sw; sw = null;
    if (s.axis !== 'x') return;
    const i = TABS.indexOf(S.tab), next = s.dx < 0 ? i + 1 : i - 1;
    const rapido = Math.abs(s.dx) / Math.max(1, Date.now() - s.t0) > 0.5;
    if (e.type === 'touchend' && (Math.abs(s.dx) > 70 || (rapido && Math.abs(s.dx) > 30)) && next >= 0 && next < TABS.length) {
      const v = view(), dir = s.dx < 0 ? -1 : 1;
      v.style.transition = 'transform .16s ease-in, opacity .16s';
      v.style.transform = 'translateX(' + (dir * window.innerWidth) + 'px)';
      v.style.opacity = '0';
      setTimeout(() => {
        v.style.transition = 'none';
        v.style.transform = 'translateX(' + (-dir * window.innerWidth * 0.35) + 'px)';
        goTab(TABS[next]);
        requestAnimationFrame(() => requestAnimationFrame(() => resetView(true)));
      }, 160);
    } else resetView(true);
  }
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
  // Safari: evita el zoom de la pagina completa (el pellizco lo maneja el calendario).
  ['gesturestart', 'gesturechange'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));
})();

/* ============================ CARGA / SINCRONIZACION ============================ */
async function loadData(manual) {
  if (manual) setBusy(true);
  try {
    const d = await api('getData');
    S.movs = d.movements || [];
    applyMeta(d);
    S.loaded = true;
    S.lastSync = Date.now();
    refreshUI();
    if (manual) toast('Datos actualizados.', 'ok');
  } catch (e) {
    if (!e.auth) toast(e.message, 'error');
  } finally { if (manual) setBusy(S.pending > 0); }
}
let syncing = false;
async function backgroundSync() {
  if (!S.token || syncing || S.pending > 0 || document.hidden || document.body.classList.contains('dragging')) return;
  syncing = true;
  try {
    const v = await api('getVersion');
    S.lastSync = Date.now();
    if (typeof v === 'number' && v !== S.version && S.pending === 0) {
      const d = await api('getData');
      if (S.pending === 0) { S.movs = d.movements || []; applyMeta(d); S.loaded = true; refreshUI(); }
    } else {
      const lbl = $('#syncLbl'); if (lbl) lbl.textContent = syncLabel();
    }
  } catch (e) { /* sin conexión: se reintenta en el siguiente ciclo */ }
  finally { syncing = false; }
}

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });

function startApp() {
  renderShell();
  if (loadCache()) { reindex(); S.loaded = true; }
  S.filter = store.get('filter', '');
  S.calView = store.get('calView', 'month');
  const hash = (location.hash || '').replace('#', '');
  goTab(hash || store.get('tab', 'inicio'));
  renderSelbar();
  loadData();
}

function boot() {
  S.token = store.get('token', null);
  S.user = store.get('user', null);
  if (S.token && !window.LOCAL_SERVER && !apiUrl()) renderLogin('Falta la URL del servidor. Pégala abajo y vuelve a ingresar.');
  else if (S.token) startApp(); else renderLogin();
  setInterval(backgroundSync, CFG.SYNC_INTERVAL_MS);
  setInterval(() => { const l = $('#syncLbl'); if (l) l.textContent = syncLabel(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) backgroundSync(); });
  window.addEventListener('online', () => backgroundSync());

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Hay una nueva versión de la app.', 'info', { label: 'Actualizar', fn: () => location.reload() });
        });
      });
    }).catch(() => {});
  }
}
document.addEventListener('DOMContentLoaded', boot);
