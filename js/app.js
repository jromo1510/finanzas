/* =========================================================================
 * FINANZAS - app (PWA). Misma logica que la Intranet Financiera, adaptada a
 * teléfono, con cuentas creadas por el usuario (Corriente / Ahorro) y metas.
 * Habla con Codigo.gs (Apps Script) por fetch; ver api().
 * ========================================================================= */
'use strict';

const CFG = Object.assign({ CURRENCY: 'S/', LOCALE: 'es-PE', SYNC_INTERVAL_MS: 15000, APP_NAME: 'Finanzas', APP_VERSION: '1.0.0' }, window.APP_CONFIG || {});
CFG.APP_VERSION = '2.0.0'; // la version la marca este archivo, no config.js
const CAT_TRANSF = 'TRANSF. CUENTAS';
const CAT_SALDO_INI = 'SALDO INICIAL';
const CAT_PROTEGIDAS = [CAT_SALDO_INI, CAT_TRANSF];
const COLORES = ['#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#64d2ff', '#ffd60a', '#ac8e68', '#5e5ce6', '#8e8e93'];
const SYM = { PEN: 'S/', USD: 'US$' };
// Iconos por defecto de las categorias de fabrica (cada una se puede cambiar en Mas > Categorias).
const CAT_ICON_DEF = { 'SUELDO': '💼', 'OTROS INGRESOS': '💵', 'SUPERMERCADO': '🛒', 'MERCADO': '🛒', 'COMIDA / RESTAURANTES': '🍽️', 'VIVIENDA': '🏠',
  'SERVICIOS': '💡', 'TRANSPORTE': '🚗', 'SALUD': '🩺', 'EDUCACION': '🎓', 'ENTRETENIMIENTO': '🎬', 'ROPA': '👕', 'TARJETA DE CREDITO': '💳',
  'SEGUROS': '🛡️', 'MASCOTAS': '🐾', 'REGALOS': '🎁', 'VIAJES': '✈️', 'G. BANCARIOS': '🏦', 'INTERESES': '📈', 'VARIOS': '🧩',
  'TRANSF. CUENTAS': '🔁', 'SALDO INICIAL': '🏁' };
const ICONOS_CAT = ['🛒', '🍽️', '☕', '🏠', '💡', '📱', '🌐', '🚗', '⛽', '🚕', '🚌', '🩺', '💊', '🎓', '📚', '🎬', '🎮', '🎵', '👕', '👟', '💇', '💳', '🛡️',
  '🐾', '👶', '🎁', '✈️', '🏖️', '🏦', '📈', '💼', '💵', '💰', '🧾', '🔧', '🧹', '🏋️', '⚽', '🍺', '🍕', '🎉', '⛪', '❤️', '🧩', '🏷️'];
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
  moneda: 'PEN', privacy: false, presup: {}, catIconos: {},
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
// Montos: la moneda por defecto es la elegida en el calendario (S.moneda); para una cuenta
// concreta se pasa la suya (ver curOf). Con "Ocultar montos" activo se muestran puntos.
const MASK = '•••••';
function sym(cur) { return SYM[cur || S.moneda] || CFG.CURRENCY; }
function money(n, cur) { return S.privacy ? sym(cur) + ' ' + MASK : (n < 0 ? '-' : '') + sym(cur) + ' ' + fmt(Math.abs(n)); }
function moneyPlus(n, cur) { return S.privacy ? sym(cur) + ' ' + MASK : (n > 0 ? '+' : n < 0 ? '-' : '') + sym(cur) + ' ' + fmt(Math.abs(n)); }
function compact(n) {
  if (S.privacy) return '•••';
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
  if (m.presupuestos) S.presup = m.presupuestos;
  if (m.catIconos) S.catIconos = m.catIconos;
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
  store.set('cache', { movs: S.movs, cuentas: S.cuentas, metas: S.metas, cats: S.cats, locked: S.locked, fijosAplicados: S.fijosAplicados, saldos: S.saldos, presup: S.presup, catIconos: S.catIconos, serverToday: S.serverToday, version: S.version, ts: Date.now() });
}
function loadCache() {
  const c = store.get('cache', null);
  if (!c) return false;
  S.movs = c.movs || []; S.cuentas = c.cuentas || []; S.metas = c.metas || []; S.cats = c.cats || [];
  S.locked = c.locked || []; S.fijosAplicados = c.fijosAplicados || []; S.saldos = c.saldos || {}; S.serverToday = c.serverToday;
  S.presup = c.presup || {}; S.catIconos = c.catIconos || {};
  S.version = -1; // forzar recarga real al conectar
  S.lastSync = c.ts || 0;
  return true;
}

const cta = id => S.idx.cta.get(id);
const ctaName = id => (cta(id) || {}).nombre || 'Cuenta';
const ctaColor = id => (cta(id) || {}).color || '#8e8e93';
const isAhorro = id => ((cta(id) || {}).tipo === 'Ahorro');
const curOf = id => ((cta(id) || {}).moneda === 'USD' ? 'USD' : 'PEN');
const hasUSD = () => S.cuentas.some(c => c.activa && c.moneda === 'USD');
function catIcon(c) { return S.catIconos[c] || CAT_ICON_DEF[c] || '🏷️'; }
// Solo cuentas corrientes en soles (lo que muestran Inicio y los presupuestos).
const corrPEN = m => isCorr(m.cuentaId) && curOf(m.cuentaId) === 'PEN';
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
function inFlow(m) { return isCorr(m.cuentaId) && curOf(m.cuentaId) === S.moneda && (!S.filter || m.cuentaId === S.filter); }
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
// Una sola entrada "guardia" en el historial mientras haya hojas abiertas: el boton/gesto
// "atras" cierra la hoja de arriba y nunca saca de la app. Cerrar por la interfaz no toca el
// historial (evita descuadres al cerrar una hoja y abrir otra en seguida).
let historyGuard = false;
function pushGuard() { if (!historyGuard) { try { history.pushState({ sheetGuard: true }, ''); historyGuard = true; } catch (e) {} } }

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
  pushGuard();
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
}
function closeAllSheets() { while (sheets.length) closeSheet(sheets[sheets.length - 1]); }
function topSheet() { return sheets[sheets.length - 1]; }
function findSheet(kind) { return sheets.find(s => s.o.kind === kind); }
window.addEventListener('popstate', () => {
  historyGuard = false;
  if (dialogOpen) { dialogOpen.cancel(); if (sheets.length) pushGuard(); return; }
  const sh = topSheet();
  if (sh) removeSheet(sh);
  if (sheets.length) pushGuard();
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
  chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  faceid: '<svg viewBox="0 0 24 24"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 9v1M15 9v1M12 9v4h-1M9 15.5a4 4 0 0 0 6 0"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M20 6H9l-6 6 6 6h11a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1zM12 10l4 4M16 10l-4 4"/></svg>'
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
    store.set('token', S.token); store.set('user', S.user); store.set('lastUser', r.usuario); store.set('lastActive', Date.now());
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
  S.token = null; store.del('token'); store.del('cache'); store.del('lock'); store.del('metasDone');
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
  animateCounts();
}
function refreshUI() {
  reindex();
  saveCache();
  renderView();
  refreshSheets();
  renderSelbar();
  checkMetasDone();
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
function saludo() { const h = new Date().getHours(); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; }
function eyeBtn() {
  return '<button class="icon-btn eye" data-act="togglePrivacy" aria-label="' + (S.privacy ? 'Mostrar montos' : 'Ocultar montos') + '">' + (S.privacy ? IC.eyeOff : IC.eye) + '</button>';
}
// Numero que se anima al cambiar (ver animateCounts). key identifica el numero entre renders.
function countNum(key, n, cur, cls) {
  return '<span class="' + (cls || '') + '" data-count="' + n + '" data-ck="' + key + '" data-cur="' + (cur || '') + '">' + money(n, cur) + '</span>';
}
function viewInicio() {
  const nombre = (S.user && S.user.nombre) ? S.user.nombre.split(' ')[0] : '';
  let h = topbar(saludo() + (nombre ? ', ' + esc(nombre) : ''), eyeBtn() + syncChip());
  if (!S.loaded && !S.movs.length && !S.cuentas.length) return h + '<div class="empty"><div class="spinner"></div><p>Cargando tus datos...</p></div>';
  if (!S.cuentas.length) {
    return h + '<section class="card onboard"><div class="onb-emoji">👋</div><h2>Empecemos</h2>' +
      '<p>Crea tus cuentas. Las <b>corrientes</b> (sueldo, gastos del día a día) forman tu flujo disponible; las de <b>ahorro</b> van aparte y pueden tener metas.</p>' +
      '<button class="btn primary big" data-act="newCuenta" data-tipo="Corriente">Crear cuenta corriente</button>' +
      '<button class="btn big" data-act="newCuenta" data-tipo="Ahorro">Crear cuenta de ahorro</button></section>';
  }
  const t = today();
  const corr = activeCuentas('Corriente'), aho = activeCuentas('Ahorro');
  const realDe = f => sum(S.movs.filter(m => m.estado === 'Real' && f(m)), m => m.monto);
  const disp = realDe(corrPEN);
  const finMes = dstr(new Date(pd(t).getFullYear(), pd(t).getMonth() + 1, 0));
  const proyFin = balanceUpTo(finMes, false, corrPEN);
  const ahorroPEN = realDe(m => isAhorro(m.cuentaId) && curOf(m.cuentaId) === 'PEN');

  h += '<section class="hero"><div class="hero-lbl">Disponible en cuentas corrientes</div>' +
    '<div class="hero-amt' + (disp < 0 ? ' neg' : '') + '">' + countNum('disp', disp, 'PEN') + '</div>' +
    '<div class="hero-row"><span>Fin de mes (con proyectados)</span><b class="' + (proyFin < 0 ? 'neg' : '') + '">' + countNum('fin', proyFin, 'PEN') + '</b></div>' +
    (aho.some(c => c.moneda !== 'USD') ? '<div class="hero-row"><span>Ahorrado</span><b>' + countNum('aho', ahorroPEN, 'PEN') + '</b></div>' : '');
  if (hasUSD()) {
    const dispU = realDe(m => isCorr(m.cuentaId) && curOf(m.cuentaId) === 'USD');
    const ahoU = realDe(m => isAhorro(m.cuentaId) && curOf(m.cuentaId) === 'USD');
    h += '<div class="hero-row usd"><span>En dólares</span><b>' + countNum('dispU', dispU, 'USD') + (Math.abs(ahoU) > 0.004 ? ' <small>+ ' + money(ahoU, 'USD') + ' ahorrado</small>' : '') + '</b></div>';
  }
  h += '</section>';

  h += '<div class="acc-scroll">' + corr.concat(aho).map(c => {
    const b = ctaBalance(c.id, true);
    return '<button class="acc" data-act="openCuentaHist" data-id="' + c.id + '" style="--c:' + c.color + '">' +
      '<span class="acc-tipo">' + (c.tipo === 'Ahorro' ? 'Ahorro' : 'Corriente') + (c.moneda === 'USD' ? ' · US$' : '') + '</span><span class="acc-name">' + esc(c.nombre) + '</span>' +
      '<span class="acc-bal' + (b < 0 ? ' neg' : '') + '">' + money(b, c.moneda) + '</span></button>';
  }).join('') + '<button class="acc add" data-act="newCuenta">' + IC.plus + '<span>Cuenta</span></button></div>';

  // Alertas: proyectados vencidos + ruptura de caja del mes actual (soles)
  const venc = vencidos();
  if (venc.length) {
    h += '<button class="alert warn" data-act="openVencidos"><span class="al-ico">⏰</span><span><b>' + venc.length + ' proyectado(s) vencido(s)</b><br><small>Fecha pasada y aún sin ejecutar. Toca para revisar.</small></span></button>';
  }
  const deficit = deficitDays(firstOfMonth(pd(t)), corrPEN).filter(d => d.fecha >= t);
  if (deficit.length) {
    h += '<button class="alert danger" data-act="goCal"><span class="al-ico">🚨</span><span><b>Ruptura de caja el ' + esc(dayLabel(deficit[0].fecha, { day: 'numeric', month: 'long' })) + '</b><br><small>El saldo proyectado llegaría a ' + money(deficit[0].saldo, 'PEN') + '. Revisa el calendario.</small></span></button>';
  }

  // Este mes (soles): el ahorro va aparte, no como gasto
  const ms = monthStats(firstOfMonth(pd(t)), corrPEN);
  const o = ms.total, neto = o.sumIng - o.sumEgr - o.aho - o.cam;
  h += '<section class="card"><div class="card-head"><h2>Este mes</h2><button class="link" data-act="goCalSum">Ver detalle</button></div>' +
    '<div class="quad"><div><span>Ingresos</span><b class="pos">' + money(o.sumIng, 'PEN') + '</b></div><div><span>Gastos</span><b class="neg">' + money(o.sumEgr, 'PEN') + '</b></div>' +
    '<div><span>Ahorrado 🐷</span><b class="blue">' + money(o.aho, 'PEN') + '</b></div>' +
    '<div><span>Neto</span><b class="' + (neto >= 0 ? 'pos' : 'neg') + '">' + moneyPlus(neto, 'PEN') + '</b></div></div>' +
    (Math.abs(o.cam) > 0.004 ? '<p class="muted small">💱 Incluye cambio de moneda: ' + moneyPlus(-o.cam, 'PEN') + '</p>' : '') +
    topCats(o.egr, o.sumEgr) + '</section>';

  // Presupuestos del mes
  h += presupCard(ms);

  // Cuadre con el banco
  if (corr.length) {
    h += '<section class="card"><div class="card-head"><h2>Cuadre con el banco</h2><button class="link" data-act="openCuadre">Actualizar</button></div>';
    const monedas = ['PEN'].concat(hasUSD() ? ['USD'] : []);
    let alguno = false;
    monedas.forEach(cur => {
      const r = cuadre(cur);
      if (!r.hayDatos) return;
      alguno = true;
      h += (monedas.length > 1 ? '<h4 class="sec">' + (cur === 'USD' ? 'Dólares' : 'Soles') + '</h4>' : '') +
        '<div class="kv"><span>Suma en bancos</span><b>' + money(r.banco, cur) + '</b></div><div class="kv"><span>Según la app (semana actual, real)</span><b>' + money(r.app, cur) + '</b></div>' +
        '<div class="kv big"><span>Diferencia</span><b class="' + (Math.abs(r.dif) < 0.01 ? 'pos' : r.dif > 0 ? 'blue' : 'neg') + '">' + (Math.abs(r.dif) < 0.01 ? 'Cuadrado ✓' : moneyPlus(r.dif, cur)) + '</b></div>';
    });
    if (!alguno) h += '<p class="muted small">Anota el saldo que ves en la app de tu banco y compara con lo registrado aquí.</p>';
    h += '</section>';
  }

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
  return '<div class="bars">' + rows.map(r => '<div class="barrow"><span class="bl">' + catIcon(r[0]) + ' ' + esc(r[0]) + '</span><span class="bt"><i style="width:' + Math.max(3, (r[1] / (total || 1)) * 100).toFixed(1) + '%"></i></span><span class="bv">' + money(r[1], 'PEN') + '</span></div>').join('') + '</div>';
}
// Presupuesto: gasto del mes (real + proyectado) contra el tope de cada categoria (soles).
function presupRows(ms) {
  return Object.keys(S.presup).map(cat => {
    const tope = S.presup[cat], real = ms.real.egr[cat] || 0, total = ms.total.egr[cat] || 0;
    const pct = tope > 0 ? total / tope : 0;
    return { cat, tope, real, total, pct, nivel: pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok' };
  }).sort((a, b) => b.pct - a.pct);
}
function presupBar(r) {
  const c = r.nivel === 'over' ? 'var(--red)' : r.nivel === 'warn' ? 'var(--orange)' : 'var(--green)';
  return '<div class="presup"><div class="pr-top"><span>' + catIcon(r.cat) + ' ' + esc(r.cat) + '</span><span><b class="' + (r.nivel === 'over' ? 'neg' : '') + '">' + money(r.total, 'PEN') + '</b> <small class="muted">de ' + money(r.tope, 'PEN') + '</small></span></div>' +
    '<div class="prog" style="--c:' + c + '"><i class="p-proy" style="width:' + Math.min(100, r.pct * 100).toFixed(1) + '%"></i><i class="p-real" style="width:' + Math.min(100, (r.tope ? r.real / r.tope : 0) * 100).toFixed(1) + '%"></i></div>' +
    '<div class="pr-sub small muted">' + (r.nivel === 'over' ? '<span class="neg">Te pasaste por ' + money(r.total - r.tope, 'PEN') + '</span>' : 'Quedan ' + money(r.tope - r.total, 'PEN')) + ' · ' + Math.round(r.pct * 100) + '%</div></div>';
}
function presupCard(ms) {
  const rows = presupRows(ms);
  if (!rows.length) return '<button class="card cta-card" data-act="openPresup"><span class="al-ico">🎯</span><span><b>Define presupuestos</b><br><small class="muted">Pon un tope mensual por categoría y te avisamos al llegar al 80%.</small></span></button>';
  return '<section class="card"><div class="card-head"><h2>Presupuestos del mes</h2><button class="link" data-act="openPresup">Editar</button></div>' + rows.map(presupBar).join('') + '</section>';
}
function cuadre(cur) {
  cur = cur || 'PEN';
  const sat = satOf(today());
  let banco = 0, app = 0, hayDatos = false;
  const det = activeCuentas('Corriente').filter(c => (c.moneda || 'PEN') === cur).map(c => {
    const s = S.saldos[c.id];
    const a = ctaBalance(c.id, true, sat);
    if (s) { hayDatos = true; banco += s.saldo; }
    app += a;
    return { c, saldo: s, app: a };
  });
  return { banco, app, dif: banco - app, hayDatos, det, cur };
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
  const bucket = () => ({ ing: {}, egr: {}, sumIng: 0, sumEgr: 0, ini: {}, sumIni: 0, aho: 0, cam: 0 });
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
    const k = real ? 'real' : 'proy';
    if (m.enlace) {
      const p = partnerOf(m);
      // Hacia/desde una cuenta de ahorro: es ahorro (o retiro de ahorro), no gasto ni ingreso.
      if (p && isAhorro(p.cuentaId)) { [st.total, st[k]].forEach(o => { o.aho -= m.monto; }); return; }
      // Hacia/desde una cuenta corriente de otra moneda: es un cambio de moneda, tampoco es gasto.
      if (p && curOf(p.cuentaId) !== curOf(m.cuentaId)) { [st.total, st[k]].forEach(o => { o.cam -= m.monto; }); return; }
      if (isInternalFor(m, pred)) return; // entre dos cuentas del flujo: no es ingreso ni gasto
    }
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
  if (S.moneda === 'USD' && !hasUSD()) S.moneda = 'PEN';
  if (S.filter && !corr.some(c => c.id === S.filter && (c.moneda || 'PEN') === S.moneda)) S.filter = '';
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
  const corrCur = corr.filter(c => (c.moneda || 'PEN') === S.moneda);
  if (corrCur.length > 1 || hasUSD()) {
    h += '<div class="chips-row">' + (hasUSD() ? '<div class="seg sm cur-seg"><button class="' + (S.moneda === 'PEN' ? 'on' : '') + '" data-act="moneda" data-v="PEN">S/</button><button class="' + (S.moneda === 'USD' ? 'on' : '') + '" data-act="moneda" data-v="USD">US$</button></div>' : '') +
      (corrCur.length > 1 ? '<button class="fchip' + (!S.filter ? ' on' : '') + '" data-act="filter" data-id="">Todas</button>' +
      corrCur.map(c => '<button class="fchip' + (S.filter === c.id ? ' on' : '') + '" data-act="filter" data-id="' + c.id + '" style="--c:' + c.color + '"><i></i>' + esc(c.nombre) + '</button>').join('') : '') + '</div>';
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
    '<span class="chip-cat">' + catIcon(m.categoria) + ' ' + esc(m.detalle && m.categoria === CAT_TRANSF ? m.detalle : m.categoria) + '</span>' +
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
  const list = (obj, cls, conTope) => {
    const ks = Object.keys(obj).sort((a, b) => obj[b] - obj[a]);
    return ks.length ? ks.map(k => {
      const tope = conTope && S.moneda === 'PEN' ? S.presup[k] : 0;
      return '<div class="kv"><span>' + catIcon(k) + ' ' + esc(k) + (tope ? ' <small class="' + (obj[k] > tope ? 'neg' : 'muted') + '">de ' + money(tope) + '</small>' : '') + '</span><b class="' + cls + '">' + money(obj[k]) + '</b></div>';
    }).join('') : '<p class="muted small">Sin movimientos</p>';
  };
  let h = hasUSD() ? '<div class="seg cur-seg wide">' + [['PEN', 'Soles (S/)'], ['USD', 'Dólares (US$)']].map(x => '<button class="' + (S.moneda === x[0] ? 'on' : '') + '" data-act="moneda" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>' : '';
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
  h += '<div class="summary"><div class="sum-grid"><div><h4 class="pos">Ingresos</h4>' + list(o.ing, 'pos') + '</div><div><h4 class="neg">Egresos</h4>' + list(o.egr, 'neg', true) + '</div>' +
    '<div class="sum-box">' + (ini != null ? '<div class="kv"><span>Saldo inicial del mes</span><b class="' + (ini < 0 ? 'neg' : '') + '">' + money(ini) + '</b></div>' : '') +
    (o.sumIni ? '<div class="kv"><span>Saldos iniciales de cuentas</span><b class="blue">' + moneyPlus(o.sumIni) + '</b></div>' +
      Object.keys(o.ini).map(k => '<div class="kv sub"><span>' + esc(k) + '</span><span>' + moneyPlus(o.ini[k]) + '</span></div>').join('') : '') +
    '<div class="kv"><span>Total ingresos</span><b class="pos">' + money(o.sumIng) + '</b></div><div class="kv"><span>Total egresos</span><b class="neg">' + money(o.sumEgr) + '</b></div>' +
    (Math.abs(o.aho) > 0.004 ? '<div class="kv"><span>' + (o.aho >= 0 ? '🐷 Enviado a ahorro' : '🐷 Retirado de ahorro') + '</span><b class="blue">' + moneyPlus(-o.aho) + '</b></div>' : '') +
    (Math.abs(o.cam) > 0.004 ? '<div class="kv"><span>💱 Cambio de moneda</span><b class="blue">' + moneyPlus(-o.cam) + '</b></div>' : '') +
    '<div class="kv big"><span>Flujo neto</span><b class="' + (o.sumIng - o.sumEgr - o.aho - o.cam >= 0 ? 'pos' : 'neg') + '">' + moneyPlus(o.sumIng - o.sumEgr - o.aho - o.cam) + '</b></div>' +
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
  // Deslizar: a la derecha = ejecutar (si es proyectado), a la izquierda = eliminar.
  const swipe = !locked && !S.selMode && !o.order && !o.noActs;
  const cur = curOf(m.cuentaId);
  return '<div class="mvw"' + (swipe ? ' data-swipe="' + m.id + '" data-exec="' + (m.estado === 'Proyectado' ? 1 : 0) + '"' : '') + '>' +
    (swipe ? '<div class="sw-bg"><span class="sw-ok">' + IC.check + ' Ejecutar</span><span class="sw-del">Eliminar ' + IC.x + '</span></div>' : '') +
    '<div class="mv ' + movClass(m) + (sel ? ' sel' : '') + '" data-act="' + (S.selMode ? 'toggleSel' : 'editMov') + '" data-id="' + m.id + '" data-lp="' + m.id + '">' +
    '<span class="mv-bar"></span><span class="mv-ico">' + catIcon(m.categoria) + '</span>' +
    '<div class="mv-main"><div class="mv-t">' + esc(title) + (locked ? ' <span class="tag">🔒</span>' : '') + '</div>' +
      '<div class="mv-s">' + (m.adjunto ? '📎 ' : '') + (o.date ? esc(shortDate(m.fecha)) + ' · ' : '') + '<span class="dot" style="--c:' + ctaColor(m.cuentaId) + '"></span>' + esc(ctaName(m.cuentaId)) +
      (meta ? ' · ' + esc((meta.icono || '🎯') + ' ' + meta.nombre) : '') + (m.detalle && m.categoria !== CAT_TRANSF ? ' · ' + esc(m.detalle) : '') + '</div></div>' +
    '<div class="mv-r"><div class="mv-amt ' + (m.monto >= 0 ? 'pos' : 'neg') + '">' + moneyPlus(m.monto, cur) + '</div><div class="mv-est">' + est + (o.bal != null ? ' · ' + money(o.bal, cur) : '') + '</div></div>' +
    (acts ? '<div class="mv-acts">' + acts + '</div>' : '') + '</div></div>';
}

/* ============================ AHORRO ============================ */
function viewAhorro() {
  const aho = S.cuentas.filter(c => c.tipo === 'Ahorro' && c.activa);
  let h = topbar('Ahorro', eyeBtn() + (aho.length ? '<button class="pill accent" data-act="newMeta">+ Meta</button>' : ''));
  if (!aho.length) {
    return h + '<section class="card onboard"><div class="onb-emoji">🐷</div><h2>Tus ahorros, aparte</h2>' +
      '<p>Crea una cuenta de ahorro. Su dinero no se mezcla con tu flujo del día a día y puedes repartirlo en varias metas (viaje, emergencias, etc.).</p>' +
      '<button class="btn primary big" data-act="newCuenta" data-tipo="Ahorro">Crear cuenta de ahorro</button></section>';
  }
  const tot = (cur, real) => sum(S.movs.filter(m => (!real || m.estado === 'Real') && isAhorro(m.cuentaId) && curOf(m.cuentaId) === cur), m => m.monto);
  const total = tot('PEN', true), totalP = tot('PEN', false);
  h += '<section class="hero savings"><div class="hero-lbl">Total ahorrado</div><div class="hero-amt">' + countNum('ahoT', total, 'PEN') + '</div>' +
    (Math.abs(totalP - total) > 0.004 ? '<div class="hero-row"><span>Con aportes proyectados</span><b>' + money(totalP, 'PEN') + '</b></div>' : '') +
    (aho.some(c => c.moneda === 'USD') ? '<div class="hero-row usd"><span>En dólares</span><b>' + countNum('ahoU', tot('USD', true), 'USD') + '</b></div>' : '') + '</section>';
  aho.forEach(c => {
    const bal = ctaBalance(c.id, true);
    const sinAsig = sum(S.movs.filter(m => m.cuentaId === c.id && m.estado === 'Real' && !m.metaId), m => m.monto);
    const metas = S.metas.filter(m => m.cuentaId === c.id);
    const act = metas.filter(m => m.estado !== 'Archivada'), arch = metas.filter(m => m.estado === 'Archivada');
    h += '<section class="card acct" style="--c:' + c.color + '"><div class="acct-head"><div><div class="acct-name">' + esc(c.nombre) + (c.moneda === 'USD' ? ' <span class="tag">US$</span>' : '') + '</div><div class="muted small">Sin asignar a metas: ' + money(sinAsig, c.moneda) + '</div></div>' +
      '<div class="acct-bal">' + money(bal, c.moneda) + '</div></div>' +
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
  const st = metaStats(meta), cur = curOf(meta.cuentaId);
  const money = n => window.money(n, cur);
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
  const nPres = Object.keys(S.presup).length;
  const lk = store.get('lock', null);
  return topbar('Más', eyeBtn() + syncChip()) +
    '<div class="menu">' +
      item('openCuentas', '🏦', 'Cuentas', S.cuentas.length + ' cuenta(s)') +
      item('openCats', '🏷️', 'Categorías', S.cats.length + ' categoría(s) · toca el ícono para cambiarlo') +
      item('openPresup', '🎯', 'Presupuestos', nPres ? nPres + ' categoría(s) con tope mensual' : 'Pon topes mensuales por categoría') +
      item('openFijos', '📌', 'Gastos fijos', 'Plantilla mensual') +
      item('openCuadre', '⚖️', 'Cuadre con el banco', 'Compara con el saldo real') +
      item('openVencidos', '⏰', 'Proyectados vencidos', '', venc || '') +
      item('openSearch', '🔍', 'Buscar movimientos', '') +
    '</div><div class="menu">' +
      item('openApariencia', '🎨', 'Apariencia', 'Color de acento y tema claro / oscuro') +
      item('openSeguridad', '🔒', 'Bloqueo con Face ID / PIN', lk && lk.pinHash ? (lk.credId ? 'Activo · Face ID + PIN' : 'Activo · PIN') : 'Desactivado') +
      item('togglePrivacy', S.privacy ? '🙈' : '👁️', S.privacy ? 'Mostrar montos' : 'Ocultar montos', 'También con el ojo de arriba') +
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
      const enFlujo = m => isCorr(m.cuentaId) && curOf(m.cuentaId) === S.moneda; // como el calendario: corrientes de la moneda elegida
      const net = sum(all.filter(enFlujo), m => m.monto);
      const bal = balanceUpTo(d, false, enFlujo);
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
    metaDesdeId: m.enlace ? (m.monto < 0 ? m.metaId : (partner || {}).metaId) : '', metaHaciaId: m.enlace ? (m.monto < 0 ? (partner || {}).metaId : m.metaId) : '',
    montoHacia: ''
  } : {
    modo: p.modo || (p.categoria === CAT_SALDO_INI ? 'ingreso' : 'gasto'),
    fecha: p.fecha || today(), monto: '', cuentaId: p.cuentaId || (S.filter || firstCorr), categoria: p.categoria || '', detalle: '', estado: '', metaId: p.metaId || '',
    desdeId: p.desdeId || firstCorr, haciaId: p.haciaId || '', metaDesdeId: p.metaDesdeId || '', metaHaciaId: p.metaHaciaId || '', montoHacia: ''
  };
  if (m && m.enlace && partner) {
    const out = m.monto < 0 ? m : partner, inn = m.monto < 0 ? partner : m;
    F.monto = Math.abs(out.monto).toFixed(2);
    F.montoHacia = Math.abs(inn.monto).toFixed(2);
  }
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
      const curMain = curOf(f.modo === 'transfer' ? f.desdeId : f.cuentaId);
      h += '<label class="amount ' + f.modo + '"><span>' + esc(sym(curMain)) + '</span><input name="monto" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + esc(f.monto) + '" required></label>';
      if (f.modo === 'transfer') {
        h += '<div class="xfer"><label class="fld"><span>Desde</span><select name="desdeId" data-change="movCta">' + cuentaOpts(f.desdeId, m ? 'all' : 'active') + '</select></label>' +
          '<span class="xfer-arrow">' + IC.arrow + '</span>' +
          '<label class="fld"><span>Hacia</span><select name="haciaId" data-change="movCta">' + cuentaOpts(f.haciaId, m ? 'all' : 'active') + '</select></label></div>';
        if (f.desdeId && f.haciaId && curOf(f.desdeId) !== curOf(f.haciaId)) {
          h += '<div class="fld"><span>Monto que llega a ' + esc(ctaName(f.haciaId)) + ' (cambio de moneda)</span><label class="amount sm transfer"><span>' + esc(sym(curOf(f.haciaId))) + '</span>' +
            '<input name="montoHacia" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + esc(f.montoHacia) + '" required data-change="movCta"></label>' +
            (parseAmount(f.monto) > 0 && parseAmount(f.montoHacia) > 0 ? '<small class="muted">Tipo de cambio: ' + (curOf(f.desdeId) === 'PEN' ? (parseAmount(f.monto) / parseAmount(f.montoHacia)) : (parseAmount(f.montoHacia) / parseAmount(f.monto))).toFixed(4) + '</small>' : '') + '</div>';
        }
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
      // Comprobante (foto)
      const foto = sh.state.foto;
      if (m && m.adjunto) {
        h += '<div class="attach-row"><button type="button" class="btn ghost" data-act="verAdjunto" data-id="' + m.id + '">📎 Ver comprobante</button>' +
          (locked ? '' : '<label class="btn ghost">Cambiar<input type="file" accept="image/*" data-change="movFoto" hidden></label><button type="button" class="btn danger-ghost" data-act="quitarAdjunto" data-id="' + m.id + '">Quitar</button>') + '</div>';
      } else if (!locked) {
        h += '<div class="attach-row">' + (foto ? '<img class="attach-thumb" src="' + foto.url + '" alt=""><span class="muted small">Foto lista, se guarda al registrar</span><button type="button" class="mini del" data-act="fotoQuitar" aria-label="Quitar foto">' + IC.x + '</button>'
          : '<label class="btn ghost wide-l">📎 Adjuntar comprobante (foto)<input type="file" accept="image/*" data-change="movFoto" hidden></label>') + '</div>';
      }
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
  ['monto', 'montoHacia', 'fecha', 'detalle', 'cuentaId', 'categoria', 'metaId', 'desdeId', 'haciaId', 'metaDesdeId', 'metaHaciaId'].forEach(k => { if (form[k]) f[k] = form[k].value; });
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
  // Transferencia entre monedas: "monto" sale de Desde y "montoHacia" llega a Hacia.
  const cross = f.modo === 'transfer' && curOf(f.desdeId) !== curOf(f.haciaId);
  const montoIn = cross ? parseAmount(f.montoHacia) : monto;
  if (cross && !(montoIn > 0)) return toast('Indica cuánto llega a ' + ctaName(f.haciaId) + '.', 'error');
  const btn = $('button[type=submit]', sh.body);
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  const antes = presupSnapshot();
  try {
    let nuevoId = null;
    if (m) {
      const ownOut = m.monto < 0;
      const ownMonto = m.enlace ? (ownOut ? monto : montoIn) : monto;
      const otherMonto = ownOut ? montoIn : monto;
      await write('updateMovement', [{ id: m.id, fecha: f.fecha, tipo: f.modo === 'gasto' ? 'Salida' : 'Ingreso', cuentaId: f.modo === 'transfer' ? m.cuentaId : f.cuentaId,
        categoria: f.categoria, monto: ownMonto, montoPartner: m.enlace ? otherMonto : null, detalle: f.detalle, estado: f.estado,
        metaId: f.modo === 'transfer' ? (ownOut ? f.metaDesdeId : f.metaHaciaId) : f.metaId }], { ok: 'Cambios guardados.' });
      // En transferencias, la cuenta y la meta del otro lado se guardan en su propio movimiento.
      if (m.enlace) {
        const p = partnerOf(getMov(m.id) || m);
        const newOwn = ownOut ? f.desdeId : f.haciaId, newOther = ownOut ? f.haciaId : f.desdeId;
        const otherMeta = ownOut ? f.metaHaciaId : f.metaDesdeId;
        if (newOwn === newOther) throw new Error('Elige dos cuentas distintas.');
        if (p && (p.cuentaId !== newOther || (p.metaId || '') !== (otherMeta || ''))) {
          await write('updateMovement', [{ id: p.id, fecha: f.fecha, cuentaId: newOther, monto: otherMonto, montoPartner: ownMonto, detalle: p.detalle, estado: f.estado, metaId: otherMeta }]);
        }
        if (newOwn !== m.cuentaId) await write('updateMovement', [{ id: m.id, fecha: f.fecha, cuentaId: newOwn, monto: ownMonto, montoPartner: otherMonto, detalle: f.detalle, estado: f.estado, metaId: ownOut ? f.metaDesdeId : f.metaHaciaId }]);
      }
    } else if (f.modo === 'transfer') {
      if (!f.desdeId || !f.haciaId || f.desdeId === f.haciaId) throw new Error('Elige dos cuentas distintas.');
      const r = await write('addTransfer', [{ desdeId: f.desdeId, haciaId: f.haciaId, monto, montoHacia: montoIn, fecha: f.fecha, estado: f.estado, detalle: f.detalle, metaDesdeId: f.metaDesdeId, metaHaciaId: f.metaHaciaId }], { ok: 'Transferencia registrada.' });
      nuevoId = r && r.patches && r.patches[0] && r.patches[0].id;
    } else {
      const r = await write('addMovement', [{ fecha: f.fecha, tipo: f.modo === 'gasto' ? 'Salida' : 'Ingreso', cuentaId: f.cuentaId, categoria: f.categoria, monto, detalle: f.detalle, estado: f.estado, metaId: f.metaId }], { ok: 'Movimiento registrado.' });
      nuevoId = r && r.patches && r.patches[0] && r.patches[0].id;
    }
    const foto = sh.state.foto;
    closeSheet(sh);
    avisarPresupuesto(antes);
    if (foto && nuevoId) subirFoto(nuevoId, foto);
  } catch (e) {
    if (!(e instanceof ApiError)) toast(e.message, 'error');
    btn.disabled = false;
    btn.textContent = label;
  }
}

/* ---------- Comprobantes (fotos) ---------- */
// Reduce la foto a ~1600 px en JPEG antes de enviarla (una foto de iPhone pasa de ~3 MB a ~250 KB).
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1600, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL('image/jpeg', 0.72);
      resolve({ url: dataUrl, b64: dataUrl.split(',')[1], mime: 'image/jpeg' });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}
async function subirFoto(id, foto) {
  toast('Subiendo comprobante...', 'info');
  try {
    await write('uploadAdjunto', [id, foto.b64, foto.mime], { ok: 'Comprobante guardado en tu Drive.' });
    S.adjCache = S.adjCache || {};
    S.adjCache[id] = foto.url;
  } catch (e) {}
}
function openAdjunto(id) {
  S.adjCache = S.adjCache || {};
  const sh = openSheet({
    kind: 'adjunto', tall: true, title: 'Comprobante',
    render: () => S.adjCache[id] ? '<img class="adj-img" src="' + S.adjCache[id] + '" alt="Comprobante">' : '<div class="empty"><div class="spinner"></div><p>Descargando de tu Drive...</p></div>'
  });
  if (!S.adjCache[id]) {
    api('getAdjunto', id).then(r => { S.adjCache[id] = 'data:' + r.mime + ';base64,' + r.b64; if (sheets.includes(sh)) sh.render(); })
      .catch(e => { if (!e.auth) toast(e.message, 'error'); closeSheet(sh); });
  }
}

/* ---------- Presupuestos: aviso al cruzar el 80% o el 100% ---------- */
function presupSnapshot() {
  const ms = monthStats(firstOfMonth(pd(today())), corrPEN);
  const out = {};
  Object.keys(S.presup).forEach(c => { out[c] = (ms.total.egr[c] || 0) / S.presup[c]; });
  return out;
}
function avisarPresupuesto(antes) {
  const ahora = presupSnapshot();
  Object.keys(ahora).forEach(c => {
    const a = antes[c] || 0, b = ahora[c];
    if (a < 1 && b >= 1) setTimeout(() => toast(catIcon(c) + ' Superaste el presupuesto de ' + c + ' (' + Math.round(b * 100) + '%).', 'error'), 700);
    else if (a < 0.8 && b >= 0.8) setTimeout(() => toast(catIcon(c) + ' Llevas el ' + Math.round(b * 100) + '% del presupuesto de ' + c + '.', 'warn'), 700);
  });
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
        return '<div class="li"><button class="cat-ico" data-act="catIcono" data-i="' + i + '" aria-label="Cambiar ícono">' + catIcon(c) + '</button><div class="li-main"><b>' + esc(c) + '</b><small>' + (uso[c] || 0) + ' movimiento(s)</small></div>' +
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
          '<b class="' + (ctaBalance(c.id, true) < 0 ? 'neg' : '') + '">' + money(ctaBalance(c.id, true), c.moneda) + '</b></button>').join('') + '</div>' : '<p class="muted small center">Ninguna.</p>');
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
        '<div class="fld"><span>Moneda</span><div class="seg">' + [['PEN', 'Soles (S/)'], ['USD', 'Dólares (US$)']].map(x => '<button type="button" class="' + ((f.moneda || 'PEN') === x[0] ? 'on' : '') + '" data-act="ctaMoneda" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>' +
        (c && (f.moneda || 'PEN') !== (c.moneda || 'PEN') ? '<small class="neg">Ojo: los montos ya registrados no se convierten, solo cambia la moneda en que se leen.</small>' : '') + '</div>' +
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
      let h = '<div class="stat2"><div><span>Saldo real</span><b class="' + (real < 0 ? 'neg' : '') + '">' + money(real, c.moneda) + '</b></div><div><span>Con proyectados</span><b>' + money(proy, c.moneda) + '</b></div></div>';
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
      const st = metaStats(meta), cur = curOf(meta.cuentaId);
      const money = n => window.money(n, cur);
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
      h += S.fijos.length ? '<div class="list">' + S.fijos.map(f => '<button class="li" data-act="editFijo" data-id="' + f.id + '"><span class="daybox">' + f.dia + '</span><div class="li-main"><b>' + catIcon(f.categoria) + ' ' + esc(f.categoria) + '</b><small>' +
        '<span class="dot" style="--c:' + ctaColor(f.cuentaId) + '"></span>' + esc(ctaName(f.cuentaId)) + (f.detalle ? ' · ' + esc(f.detalle) : '') + '</small></div><b class="' + (f.tipo === 'Ingreso' ? 'pos' : 'neg') + '">' + (f.tipo === 'Ingreso' ? '+' : '-') + money(f.monto, curOf(f.cuentaId)) + '</b></button>').join('') + '</div>'
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
      const grupos = ['PEN', 'USD'].map(c => cuadre(c)).filter(r => r.det.length);
      if (!grupos.length) return '<p class="muted">Crea primero una cuenta corriente.</p>';
      return '<form data-form="cuadre"><p class="muted small">Anota el saldo que ves hoy en la app de cada banco. Se compara con el saldo <b>real</b> registrado aquí hasta el sábado de esta semana.</p>' +
        grupos.map(r => (grupos.length > 1 ? '<h4 class="sec">' + (r.cur === 'USD' ? 'Dólares' : 'Soles') + '</h4>' : '') +
          r.det.map(x => '<div class="cuadre-row"><div class="li-main"><b><span class="dot" style="--c:' + x.c.color + '"></span>' + esc(x.c.nombre) + '</b><small>Según la app: ' + money(x.app, r.cur) + (x.saldo ? ' · último registro ' + esc(shortDate(x.saldo.fecha)) : '') + '</small></div>' +
            '<input class="inp num" name="s_' + x.c.id + '" inputmode="decimal" value="' + (x.saldo ? x.saldo.saldo.toFixed(2) : '') + '" placeholder="0.00" data-input="cuadreCalc"></div>').join('') +
          '<div class="kv big"><span>Diferencia' + (grupos.length > 1 ? ' (' + sym(r.cur) + ')' : '') + '</span><b class="cuadre-dif" data-cur="' + r.cur + '">—</b></div>').join('') +
        '<button class="btn primary big" type="submit">Guardar saldos</button></form>';
    },
    mount: sh => calcCuadre(sh)
  });
}
function calcCuadre(sh) {
  $$('.cuadre-dif', sh.body).forEach(el => {
    const r = cuadre(el.dataset.cur);
    let banco = 0, alguno = false;
    r.det.forEach(x => { const i = $('[name="s_' + x.c.id + '"]', sh.body); if (i && i.value.trim() !== '') alguno = true; banco += parseAmount(i && i.value); });
    const dif = banco - r.app;
    if (!alguno) { el.textContent = '—'; el.className = 'cuadre-dif muted'; return; }
    el.textContent = Math.abs(dif) < 0.01 ? 'Cuadrado ✓' : moneyPlus(dif, r.cur);
    el.className = 'cuadre-dif ' + (Math.abs(dif) < 0.01 ? 'pos' : dif > 0 ? 'blue' : 'neg');
  });
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
  tab: el => {
    // Doble toque en "Inicio" = sincronizar ahora.
    const now = Date.now();
    if (el.dataset.tab === 'inicio' && S.tab === 'inicio' && now - (ACT._lastInicio || 0) < 400) { ACT._lastInicio = 0; haptic(); loadData(true); return; }
    if (el.dataset.tab === 'inicio') ACT._lastInicio = now;
    goTab(el.dataset.tab);
  },
  goCal: () => { S.month = firstOfMonth(pd(today())); goTab('calendario'); },
  goCalSum: () => { S.month = firstOfMonth(pd(today())); S.calView = 'month'; goTab('calendario'); openResumen(); },
  openResumen: () => openResumen(),
  showDeficit: () => dialog('<h4>🚨 Ruptura de caja</h4><p>El saldo proyectado de tus cuentas corrientes no alcanza en:</p><div class="dlg-list">' +
    S.deficits.map(d => '<button data-v="' + d.fecha + '"><b>' + esc(dayLabel(d.fecha, { weekday: 'short', day: 'numeric', month: 'short' })) + '</b> · <span class="neg">' + money(d.saldo) + '</span></button>').join('') +
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
  ctaMoneda: el => { const sh = topSheet(); readCuentaForm(sh); sh.state.F.moneda = el.dataset.v; sh.render(); },
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
      if (c) await write('updateCuenta', [c.id, { nombre: f.nombre, tipo: f.tipo, color: f.color, moneda: f.moneda || 'PEN' }], { ok: 'Cuenta actualizada.' });
      else await write('addCuenta', [{ nombre: f.nombre, tipo: f.tipo, color: f.color, moneda: f.moneda || 'PEN', saldoInicial: f.saldoInicial, fechaSaldo: f.fechaSaldo }], { ok: 'Cuenta creada.' });
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
    const items = cuadre('PEN').det.concat(cuadre('USD').det).map(x => ({ cuentaId: x.c.id, saldo: form['s_' + x.c.id].value })).filter(x => String(x.saldo).trim() !== '');
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
  const blocked = el => el.closest('.chips-row, .acc-scroll, .alert-row, input, select, textarea, [draggable="true"], [data-swipe]');
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

/* ============================ PRESUPUESTOS ============================ */
function openPresup() {
  openSheet({
    kind: 'presup', live: true, tall: true, title: 'Presupuestos',
    render: () => {
      const ms = monthStats(firstOfMonth(pd(today())), corrPEN);
      const cats = S.cats.filter(c => !CATS_INGRESO.includes(c) && c !== CAT_TRANSF);
      let h = '<p class="muted small">Tope mensual por categoría, en soles, sobre tus cuentas corrientes. Se compara con lo gastado en el mes (real + proyectado) y la app te avisa al llegar al 80% y al pasarte. Deja en blanco para no poner tope.</p>';
      const rows = presupRows(ms);
      if (rows.length) h += '<h4 class="sec">Este mes</h4><div class="card flat">' + rows.map(presupBar).join('') + '</div>';
      h += '<h4 class="sec">Topes</h4><div class="list">' + cats.map(c => '<div class="li"><span class="cat-ico static">' + catIcon(c) + '</span><div class="li-main"><b>' + esc(c) + '</b><small>Este mes: ' + money(ms.total.egr[c] || 0, 'PEN') + '</small></div>' +
        '<input class="inp num" inputmode="decimal" placeholder="Sin tope" value="' + (S.presup[c] ? S.presup[c].toFixed(2) : '') + '" data-change="presupSet" data-cat="' + esc(c) + '"></div>').join('') + '</div>';
      return h;
    }
  });
}

/* ============================ APARIENCIA ============================ */
const ACENTOS = [['Azul', '#007aff', '#0a84ff'], ['Índigo', '#5856d6', '#5e5ce6'], ['Morado', '#a24bd6', '#bf5af2'], ['Rosado', '#e8305a', '#ff375f'],
  ['Naranja', '#e8710a', '#ff9f0a'], ['Menta', '#00968f', '#30d5c8'], ['Grafito', '#3a3a3c', '#d1d1d6']];
function apariencia() { return Object.assign({ accent: 0, theme: 'auto' }, store.get('apariencia', {})); }
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
function applyAppearance() {
  const a = apariencia(), root = document.documentElement;
  if (a.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = a.theme;
  const dark = a.theme === 'dark' || (a.theme === 'auto' && darkMQ.matches);
  const ac = ACENTOS[a.accent] || ACENTOS[0];
  root.style.setProperty('--blue', dark ? ac[2] : ac[1]);
  $$('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#000000' : '#f2f2f7'));
}
try { darkMQ.addEventListener('change', applyAppearance); } catch (e) {}
function openApariencia() {
  openSheet({
    kind: 'apariencia', live: true, title: 'Apariencia',
    render: () => {
      const a = apariencia();
      return '<h4 class="sec">Color de acento</h4><p class="muted small">Botones, enlaces, pestaña activa y el "+". Se guarda en este teléfono: cada uno puede tener el suyo. Verde (ingreso), rojo (gasto) y naranja (vencido) no cambian.</p>' +
        '<div class="accents">' + ACENTOS.map((x, i) => '<button class="acc-sw' + (a.accent === i ? ' on' : '') + '" data-act="setAccent" data-v="' + i + '" style="--c:' + x[1] + '"><i></i><span>' + x[0] + '</span></button>').join('') + '</div>' +
        '<h4 class="sec">Tema</h4><div class="seg">' + [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(x => '<button class="' + (a.theme === x[0] ? 'on' : '') + '" data-act="setTheme" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>' +
        '<p class="muted small">Automático sigue el modo claro/oscuro del teléfono.</p>' +
        '<div class="preview card flat"><button class="btn primary">Botón</button> <span class="link">Enlace</span> <span class="pill">Hoy</span></div>';
    }
  });
}

/* ============================ BLOQUEO: FACE ID + PIN ============================ */
const LOCK_AFTER_MS = 5 * 60 * 1000;
const b64u = {
  enc: buf => btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(buf)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
};
const rand = n => crypto.getRandomValues(new Uint8Array(n));
async function hashPin(pin, salt) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin + ':finanzas'));
  return b64u.enc(d);
}
const lockCfg = () => store.get('lock', null);
const lockOn = () => { const l = lockCfg(); return !!(l && l.pinHash); };
async function faceAvailable() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; }
}
// Face ID / huella via WebAuthn (llave del propio telefono). Es un cerrojo local sobre la sesion ya iniciada.
async function faceRegister() {
  const u = S.user || { usuario: 'usuario', nombre: 'Usuario' };
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: rand(32), rp: { name: CFG.APP_NAME || 'Finanzas', id: location.hostname },
    user: { id: rand(16), name: u.usuario, displayName: u.nombre || u.usuario },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    timeout: 60000, attestation: 'none'
  } });
  return b64u.enc(cred.rawId);
}
async function faceVerify(credId) {
  await navigator.credentials.get({ publicKey: {
    challenge: rand(32), rpId: location.hostname, userVerification: 'required', timeout: 60000,
    allowCredentials: [{ type: 'public-key', id: b64u.dec(credId), transports: ['internal'] }]
  } });
  return true;
}
function markActive() { if (S.token) store.set('lastActive', Date.now()); }

// Teclado de PIN a pantalla completa. onPin(pin) -> true (ok) | string (error) | Promise de eso.
function pinPad(o) {
  const wrap = document.createElement('div');
  wrap.className = 'lock-wrap' + (o.lock ? ' is-lock' : '');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', o.face ? 'face' : '', '0', 'del'];
  wrap.innerHTML = '<div class="lock-box"><img class="lock-logo" src="icons/icon-192.png" alt=""><h3 class="lock-title"></h3><p class="lock-sub"></p>' +
    '<div class="pin-dots"><i></i><i></i><i></i><i></i></div><div class="pin-err"></div><div class="pin-pad">' +
    keys.map(k => k === '' ? '<span></span>' : '<button class="pin-k' + (k === 'face' || k === 'del' ? ' fn' : '') + '" data-k="' + k + '">' + (k === 'face' ? IC.faceid : k === 'del' ? IC.del : k) + '</button>').join('') + '</div>' +
    (o.foot ? '<div class="lock-foot">' + o.foot + '</div>' : '') + '</div>';
  document.body.appendChild(wrap);
  $('.lock-title', wrap).textContent = o.title; $('.lock-sub', wrap).textContent = o.sub || '';
  requestAnimationFrame(() => wrap.classList.add('open'));
  let pin = '', busy = false;
  const dots = () => $$('.pin-dots i', wrap).forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const close = () => { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 250); };
  const err = msg => { $('.pin-err', wrap).textContent = msg; wrap.classList.add('shake'); haptic(); setTimeout(() => wrap.classList.remove('shake'), 400); pin = ''; dots(); };
  wrap.addEventListener('click', async e => {
    const b = e.target.closest('[data-k]'); const f = e.target.closest('[data-lk]');
    if (f && o.onFoot) { o.onFoot(f.dataset.lk, close); return; }
    if (!b || busy) return;
    const k = b.dataset.k;
    if (k === 'del') { pin = pin.slice(0, -1); dots(); return; }
    if (k === 'face') { if (o.onFace) o.onFace(close); return; }
    if (pin.length >= 4) return;
    pin += k; dots(); $('.pin-err', wrap).textContent = '';
    if (pin.length === 4) {
      busy = true;
      const r = await o.onPin(pin);
      busy = false;
      if (r === true) close(); else if (r && r.info) { pin = ""; dots(); $(".pin-err", wrap).textContent = r.info; } else err(typeof r === "string" ? r : "PIN incorrecto");
    }
  });
  return { wrap, close, setSub: t => { $('.lock-sub', wrap).textContent = t; } };
}
function askNewPin() {
  return new Promise(resolve => {
    let first = null;
    const p = pinPad({ title: 'Crea un PIN', sub: '4 dígitos para desbloquear la app', foot: '<button class="link" data-lk="cancel">Cancelar</button>',
      onFoot: (k, close) => { close(); resolve(null); },
      onPin: pin => {
        if (!first) { first = pin; $('.lock-title', p.wrap).textContent = 'Repite el PIN'; return { info: "Escríbelo otra vez para confirmar" }; }
        if (pin !== first) { first = null; $('.lock-title', p.wrap).textContent = 'Crea un PIN'; return 'No coinciden. Empecemos de nuevo.'; }
        resolve(pin); return true;
      } });
    $('.pin-err', p.wrap).classList.add('hint');
  });
}
function askCurrentPin(title) {
  const l = lockCfg();
  return new Promise(resolve => {
    pinPad({ title: title || 'Ingresa tu PIN', foot: '<button class="link" data-lk="cancel">Cancelar</button>',
      onFoot: (k, close) => { close(); resolve(false); },
      onPin: async pin => { if ((await hashPin(pin, l.salt)) === l.pinHash) { resolve(true); return true; } return 'PIN incorrecto'; } });
  });
}
let lockShown = false;
function showLock() {
  if (!lockOn() || lockShown || !S.token) return;
  lockShown = true;
  document.body.classList.add('locked');
  const l = lockCfg();
  const unlock = close => { store.set('lock', Object.assign(lockCfg() || {}, { fails: 0 })); lockShown = false; document.body.classList.remove('locked'); markActive(); close(); backgroundSync(); };
  const tryFace = close => faceVerify(l.credId).then(() => unlock(close)).catch(() => {});
  const p = pinPad({
    lock: true, face: !!l.credId, title: 'Finanzas bloqueada', sub: l.credId ? 'Usa Face ID o tu PIN' : 'Ingresa tu PIN',
    foot: '<button class="link" data-lk="forgot">¿Olvidaste tu PIN? Cerrar sesión</button>',
    onFace: close => tryFace(close),
    onFoot: async (k, close) => {
      if (!(await ask('Cerrar sesión', 'Tendrás que entrar con tu usuario y contraseña. El bloqueo se desactiva.', 'Cerrar sesión', true))) return;
      forceLogoutLocal(close, 'Ingresa con tu usuario y contraseña.');
    },
    onPin: async pin => {
      const cfg = lockCfg();
      if ((await hashPin(pin, cfg.salt)) === cfg.pinHash) { unlock(() => p.close()); return true; }
      const fails = (cfg.fails || 0) + 1;
      store.set('lock', Object.assign(cfg, { fails }));
      if (fails >= 5) { forceLogoutLocal(() => p.close(), 'Demasiados intentos de PIN. Por seguridad, ingresa con tu usuario y contraseña.'); return true; }
      return 'PIN incorrecto · quedan ' + (5 - fails) + ' intento(s)';
    }
  });
  if (l.credId) setTimeout(() => tryFace(() => p.close()), 450); // en algunos telefonos se abre solo; si no, toca el icono
}
function forceLogoutLocal(close, msg) {
  quiet(api('logout'));
  store.del('lock'); store.del('cache');
  lockShown = false; document.body.classList.remove('locked');
  if (close) close();
  S.movs = []; S.cuentas = []; S.loaded = false;
  onSessionExpired(msg);
}
function openSeguridad() {
  openSheet({
    kind: 'seguridad', live: true, title: 'Bloqueo',
    render: sh => {
      const l = lockCfg();
      if (!l || !l.pinHash) return '<p>Protege la app con un <b>PIN de 4 dígitos</b> y, si tu teléfono lo permite, con <b>Face ID</b> o huella.</p>' +
        '<p class="muted small">Se pide al abrir la app si estuvo más de 5 minutos cerrada o en segundo plano. Es por teléfono: tu esposa activa el suyo en su propio teléfono.</p>' +
        '<button class="btn primary big" data-act="lockSetup">Activar bloqueo</button>';
      return '<div class="banner ok">🔒 Bloqueo activo' + (l.credId ? ' con Face ID y PIN' : ' con PIN') + '. Se pide tras 5 minutos fuera de la app.</div>' +
        '<div class="menu flat">' +
          (l.credId ? '<button class="menu-item" data-act="faceOff"><span class="mi-ico">🙂</span><span class="mi-body"><span>Desactivar Face ID</span><small>Seguirá pidiendo el PIN</small></span></button>'
            : (sh.state.face ? '<button class="menu-item" data-act="faceOn"><span class="mi-ico">🙂</span><span class="mi-body"><span>Activar Face ID / huella</span><small>Más rápido que el PIN</small></span></button>' : '<div class="menu-item"><span class="mi-ico">🙂</span><span class="mi-body"><span>Face ID no disponible</span><small>Este teléfono o navegador no lo permite; se usa el PIN.</small></span></div>')) +
          '<button class="menu-item" data-act="pinChange"><span class="mi-ico">🔢</span><span class="mi-body"><span>Cambiar PIN</span></span></button>' +
          '<button class="menu-item" data-act="lockNow"><span class="mi-ico">🔐</span><span class="mi-body"><span>Bloquear ahora</span></span></button>' +
          '<button class="menu-item" data-act="lockOff"><span class="mi-ico">🔓</span><span class="mi-body"><span class="neg">Desactivar bloqueo</span></span></button>' +
        '</div>';
    },
    mount: sh => { if (sh.state.face == null) faceAvailable().then(v => { sh.state.face = v; if (sheets.includes(sh)) sh.render(); }); }
  });
}
async function lockSetup() {
  const pin = await askNewPin();
  if (!pin) return;
  const salt = b64u.enc(rand(16));
  store.set('lock', { pinHash: await hashPin(pin, salt), salt, credId: null, fails: 0 });
  markActive();
  toast('Bloqueo activado.', 'ok');
  if (await faceAvailable() && await ask('¿Usar Face ID?', 'Así desbloqueas con la cara (o huella) y el PIN queda de respaldo.', 'Activar Face ID')) await faceOn();
  refreshSheets(); renderView();
}
async function faceOn() {
  try {
    const id = await faceRegister();
    await faceVerify(id); // confirma que funciona antes de guardarlo
    store.set('lock', Object.assign(lockCfg(), { credId: id }));
    toast('Face ID activado.', 'ok');
  } catch (e) { toast('No se pudo activar Face ID' + (e && e.name === 'NotAllowedError' ? ' (cancelado).' : '.'), 'error'); }
  refreshSheets(); renderView();
}

/* ============================ CONFETI (meta cumplida) ============================ */
function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  const W = c.width = innerWidth * devicePixelRatio, H = c.height = innerHeight * devicePixelRatio;
  document.body.appendChild(c);
  const ctx = c.getContext('2d'), colors = ['#30d158', '#0a84ff', '#ff9f0a', '#ff375f', '#bf5af2', '#ffd60a', '#64d2ff'];
  const P = Array.from({ length: 160 }, () => ({ x: W / 2 + (Math.random() - .5) * W * .3, y: H * .35, vx: (Math.random() - .5) * 26 * devicePixelRatio, vy: (-Math.random() * 22 - 8) * devicePixelRatio,
    s: (6 + Math.random() * 8) * devicePixelRatio, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: colors[Math.floor(Math.random() * colors.length)] }));
  const t0 = performance.now();
  (function frame(t) {
    const el = t - t0;
    ctx.clearRect(0, 0, W, H);
    P.forEach(p => { p.vy += .55 * devicePixelRatio; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - el / 3200); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
    if (el < 3200) requestAnimationFrame(frame); else c.remove();
  })(t0);
}
function checkMetasDone() {
  if (!S.loaded) return;
  const done = S.metas.filter(m => m.estado !== 'Archivada' && metaStats(m).done).map(m => m.id);
  const prev = store.get('metasDone', null);
  store.set('metasDone', done);
  if (prev === null) return; // primera vez en este telefono: no celebrar metas que ya estaban cumplidas
  const nuevas = done.filter(id => !prev.includes(id));
  if (!nuevas.length) return;
  confetti(); haptic();
  const mt = S.idx.meta.get(nuevas[0]);
  if (mt) toast('🎉 ¡Cumplieron la meta "' + mt.nombre + '"!', 'ok');
}

/* ============================ NUMEROS ANIMADOS ============================ */
S.counts = {};
function animateCounts() {
  $$('[data-count]').forEach(el => {
    const key = el.dataset.ck, to = +el.dataset.count, cur = el.dataset.cur || undefined;
    const from = S.counts[key] == null ? 0 : S.counts[key];
    S.counts[key] = to;
    if (S.privacy || Math.abs(to - from) < 0.005 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t0 = performance.now(), dur = 700;
    (function step(t) {
      if (!el.isConnected) return;
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = money(from + (to - from) * e, cur);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  });
}

/* ============================ DESLIZAR UN MOVIMIENTO ============================ */
// Derecha = ejecutar (proyectados), izquierda = eliminar (con Deshacer), como en Mail del iPhone.
(function rowSwipe() {
  let st = null;
  document.addEventListener('touchstart', e => {
    st = null;
    if (e.touches.length !== 1 || S.selMode) return;
    const w = e.target.closest('[data-swipe]');
    if (!w || e.target.closest('button, input, select')) return;
    st = { w, row: $('.mv', w), x0: e.touches[0].clientX, y0: e.touches[0].clientY, dx: 0, axis: null, exec: w.dataset.exec === '1' };
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!st) return;
    const dx = e.touches[0].clientX - st.x0, dy = e.touches[0].clientY - st.y0;
    if (!st.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      st.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (st.axis === 'y') { st = null; return; }
    }
    e.preventDefault();
    st.dx = (dx > 0 && !st.exec) ? dx * 0.2 : dx;
    st.row.style.transition = 'none';
    st.row.style.transform = 'translateX(' + st.dx + 'px)';
    const armed = Math.abs(st.dx) > st.w.offsetWidth * 0.32;
    st.w.classList.toggle('sw-r', st.dx > 0); st.w.classList.toggle('sw-l', st.dx < 0);
    if (armed !== st.w.classList.contains('armed')) { st.w.classList.toggle('armed', armed); if (armed) haptic(); }
  }, { passive: false });
  const end = () => {
    if (!st) return;
    const { w, row, dx, exec } = st; st = null;
    if (Math.abs(dx) > 8) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 350); }
    const armed = Math.abs(dx) > w.offsetWidth * 0.32, id = w.dataset.swipe;
    row.style.transition = 'transform .22s ease-out';
    if (armed && dx < 0) { row.style.transform = 'translateX(-110%)'; setTimeout(() => eliminarRapido(id), 180); }
    else { row.style.transform = ''; if (armed && dx > 0 && exec) ejecutar(id); }
    setTimeout(() => w.classList.remove('sw-l', 'sw-r', 'armed'), 230);
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
})();

/* ============================ ACCIONES NUEVAS ============================ */
function pickEmoji(title, list) {
  return dialog('<h4>' + esc(title) + '</h4><div class="emoji-grid">' + list.map(e => '<button data-v="' + e + '">' + e + '</button>').join('') + '</div><div class="dlg-btns"><button data-v="">Cancelar</button></div>').then(v => v || null);
}
Object.assign(ACT, {
  togglePrivacy: () => { S.privacy = !S.privacy; store.set('privacy', S.privacy); haptic(); renderView(); refreshSheets(); renderSelbar(); },
  moneda: el => { S.moneda = el.dataset.v; store.set('moneda', S.moneda); S.filter = ''; renderView(); refreshSheets(); },
  openPresup: () => openPresup(),
  catIcono: async el => {
    const c = S.cats[+el.dataset.i]; if (!c) return;
    const v = await pickEmoji('Ícono de ' + c, ICONOS_CAT);
    if (v) quiet(write('setCategoriaIcono', [c, v], { ok: 'Ícono actualizado.' }));
  },
  verAdjunto: el => openAdjunto(el.dataset.id),
  quitarAdjunto: async el => {
    if (!(await ask('Quitar comprobante', 'La foto se envía a la papelera de tu Drive.', 'Quitar', true))) return;
    try {
      await write('deleteAdjunto', [el.dataset.id], { ok: 'Comprobante quitado.' });
      if (S.adjCache) delete S.adjCache[el.dataset.id];
      const sh = findSheet('movform'); if (sh) { readMovForm(sh); sh.render(); }
    } catch (e) {}
  },
  fotoQuitar: () => { const sh = findSheet('movform'); if (sh) { readMovForm(sh); sh.state.foto = null; sh.render(); } },
  openApariencia: () => openApariencia(),
  setAccent: el => { store.set('apariencia', Object.assign(apariencia(), { accent: +el.dataset.v })); applyAppearance(); refreshSheets(); },
  setTheme: el => { store.set('apariencia', Object.assign(apariencia(), { theme: el.dataset.v })); applyAppearance(); refreshSheets(); },
  openSeguridad: () => openSeguridad(),
  lockSetup: () => lockSetup(),
  faceOn: () => faceOn(),
  faceOff: () => { store.set('lock', Object.assign(lockCfg(), { credId: null })); toast('Face ID desactivado.', 'ok'); refreshSheets(); renderView(); },
  pinChange: async () => {
    if (!(await askCurrentPin('PIN actual'))) return;
    const pin = await askNewPin(); if (!pin) return;
    const salt = b64u.enc(rand(16));
    store.set('lock', Object.assign(lockCfg(), { pinHash: await hashPin(pin, salt), salt, fails: 0 }));
    toast('PIN cambiado.', 'ok');
  },
  lockOff: async () => {
    if (!(await askCurrentPin('Confirma con tu PIN'))) return;
    store.del('lock'); toast('Bloqueo desactivado.', 'ok'); refreshSheets(); renderView();
  },
  lockNow: () => { closeAllSheets(); showLock(); }
});
Object.assign(CHANGES, {
  presupSet: el => {
    const v = parseAmount(el.value);
    quiet(write('setPresupuesto', [el.dataset.cat, v], { ok: v > 0 ? 'Tope de ' + el.dataset.cat + ': ' + money(v, 'PEN') : 'Tope quitado.' }));
  },
  movFoto: async (el, sh) => {
    const file = el.files && el.files[0];
    if (!file || !sh) return;
    try {
      const foto = await compressImage(file);
      if (sh.state.edit) { await subirFoto(sh.state.edit.id, foto); if (sheets.includes(sh)) { readMovForm(sh); sh.render(); } }
      else { readMovForm(sh); sh.state.foto = foto; sh.render(); }
    } catch (e) { toast(e.message, 'error'); }
  }
});

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
  S.moneda = store.get('moneda', 'PEN');
  const hash = (location.hash || '').replace('#', '');
  goTab(hash || store.get('tab', 'inicio'));
  renderSelbar();
  loadData();
  // Bloqueo: si la app estuvo cerrada o en segundo plano mas de 5 minutos.
  if (lockOn() && Date.now() - store.get('lastActive', 0) > LOCK_AFTER_MS) showLock();
  markActive();
}

function boot() {
  applyAppearance();
  S.privacy = store.get('privacy', false);
  S.token = store.get('token', null);
  S.user = store.get('user', null);
  if (S.token && !window.LOCAL_SERVER && !apiUrl()) renderLogin('Falta la URL del servidor. Pégala abajo y vuelve a ingresar.');
  else if (S.token) startApp(); else renderLogin();
  // Casi en tiempo real: getVersion es liviano, se consulta cada 5 s mientras la app esta a la vista.
  setInterval(backgroundSync, Math.min(CFG.SYNC_INTERVAL_MS || 5000, 5000));
  setInterval(() => { const l = $('#syncLbl'); if (l) l.textContent = syncLabel(); if (!document.hidden && !lockShown) markActive(); }, 10000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (!lockShown) markActive(); return; }
    if (lockOn() && Date.now() - store.get('lastActive', 0) > LOCK_AFTER_MS) showLock();
    else markActive();
    backgroundSync();
  });
  window.addEventListener('pagehide', () => { if (!lockShown) markActive(); });
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
// Pantalla de entrada: se queda al menos ~0.8 s desde que se abrió la app y se difumina
// mientras el contenido entra desde abajo.
function hideSplash() {
  const sp = $('#splash');
  if (!sp) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = reduce ? 0 : Math.max(0, 800 - performance.now());
  setTimeout(() => {
    sp.classList.add('hide');
    document.body.classList.add('reveal');
    setTimeout(() => { sp.remove(); document.body.classList.remove('reveal'); }, 1000);
  }, wait);
}
document.addEventListener('DOMContentLoaded', () => { boot(); hideSplash(); });
