// 港途 · 共用工具、數據載入、索引
export const DATA_URL = 'https://data.hkbus.app/routeFareList.min.json';
export const HK = {s: 22.13, n: 22.58, w: 113.82, e: 114.45};
export const FERRY = new Set(['sunferry', 'fortuneferry', 'hkkf']);

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const store = {
  get(k, d){ try { const v = localStorage.getItem('hkgo:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v){ try { localStorage.setItem('hkgo:' + k, JSON.stringify(v)); } catch {} },
  del(k){ try { localStorage.removeItem('hkgo:' + k); } catch {} }
};

/* ---------- 全域狀態 ---------- */
export const S = {
  DB: null, IDX: new Map(), GRID: new Map(), NUMS: new Map(),
  here: null,
  set: Object.assign({lang: 'zh', walk: 75, radius: 'auto'}, store.get('settings', {})),
  online: true, lastOk: 0
};
export const saveSettings = () => store.set('settings', S.set);

/* ---------- 語言 ---------- */
export const L = (zh, en) => S.set.lang === 'en' ? en : zh;
const title = s => /[a-z]/.test(s) ? s : s.toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\bMtr\b/g, 'MTR').replace(/\(([a-z])/g, (m, c) => '(' + c.toUpperCase());
export const nm = o => { if (!o) return ''; if (S.set.lang === 'en') return o.en ? title(o.en) : (o.zh || ''); return o.zh || o.en || ''; };

export const CO = {
  kmb: ['九巴', 'KMB', '#e4002b'], ctb: ['城巴', 'Citybus', '#ffd400'], nlb: ['嶼巴', 'NLB', '#38b6c9'],
  gmb: ['專線小巴', 'Minibus', '#00a651'], lrtfeeder: ['港鐵巴士', 'MTR Bus', '#f0812d'], mtr: ['港鐵', 'MTR', '#e2231a'],
  lightRail: ['輕鐵', 'Light Rail', '#d3a809'], sunferry: ['新渡輪', 'Sun Ferry', '#4aa3df'],
  fortuneferry: ['富裕小輪', 'Fortune Ferry', '#4aa3df'], hkkf: ['港九小輪', 'HKKF', '#4aa3df']
};
export const coName = co => CO[co] ? L(CO[co][0], CO[co][1]) : co;
export const coColor = co => CO[co]?.[2] || '#888';
export const LINES = {
  AEL: ['機場快綫', 'Airport Express', '#00888a'], TCL: ['東涌綫', 'Tung Chung Line', '#f7943e'],
  TML: ['屯馬綫', 'Tuen Ma Line', '#923011'], TKL: ['將軍澳綫', 'Tseung Kwan O Line', '#7d499d'],
  EAL: ['東鐵綫', 'East Rail Line', '#53b7e8'], SIL: ['南港島綫', 'South Island Line', '#bac429'],
  TWL: ['荃灣綫', 'Tsuen Wan Line', '#e2231a'], ISL: ['港島綫', 'Island Line', '#0071ce'],
  KTL: ['觀塘綫', 'Kwun Tong Line', '#00ab4e'], DRL: ['迪士尼綫', 'Disneyland Resort Line', '#f173ac']
};
export const lineName = c => LINES[c] ? L(LINES[c][0], LINES[c][1]) : c;
export const lineShort = c => LINES[c] ? (S.set.lang === 'en' ? c : LINES[c][0].replace(/綫$/, '')) : c;
export const lineColor = c => LINES[c]?.[2] || '#e2231a';
export const darkText = c => c === 'SIL' || c === 'EAL';
export const coTag = co => `<span class="co"><i style="--c:${coColor(co)}"></i>${esc(coName(co))}</span>`;

/* ---------- 時間 ---------- */
export const mins = t => Math.round((t - Date.now()) / 60000);
export const hhmm = t => new Date(t).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Hong_Kong'});
export const hms = t => new Date(t).toLocaleTimeString('en-GB', {hour12: false, timeZone: 'Asia/Hong_Kong'});
export const T = s => { if (!s) return null; const v = Date.parse(/T/.test(s) ? s : String(s).replace(/\//g, '-').replace(' ', 'T') + '+08:00'); return isNaN(v) ? null : v; };
const hkMidnight = () => Math.floor((Date.now() + 288e5) / 864e5) * 864e5 - 288e5;
const hm2t = s => hkMidnight() + ((+s.slice(0, 2)) * 60 + (+s.slice(2, 4))) * 60000;

/* ---------- 翻牌字粒 ---------- */
const prevFlap = new Map();
export function flaps(text, key, cls = ''){
  const s = String(text);
  const changed = key && prevFlap.has(key) && prevFlap.get(key) !== s;
  if (key) prevFlap.set(key, s);
  return [...s].map(c => c === ':' ? '<span class="sep">:</span>' : `<span class="f${cls ? ' ' + cls : ''}${changed ? ' flip' : ''}">${esc(c)}</span>`).join('');
}
export const routeTiles = (route, key) => { const n = [...String(route)].length; return `<div class="rt${n >= 5 ? ' s5' : n === 4 ? ' s4' : ''}">${flaps(route, key)}</div>`; };
export const lineTiles = c => `<div class="rt ln${darkText(c) ? ' dark' : ''}" style="--c:${lineColor(c)}">${[...lineShort(c)].slice(0, 3).map(x => `<span class="f">${esc(x)}</span>`).join('')}</div>`;

/* ---------- 數據載入 ---------- */
async function download(cache, onProgress){
  const res = await fetch(DATA_URL, {cache: 'no-store'});
  if (!res.ok) throw new Error('HTTP ' + res.status);
  let text;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader(), chunks = []; let got = 0;
    for (;;) { const {done, value} = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress?.(got); }
    text = await new Blob(chunks).text();
  } else text = await res.text();
  if (cache) { try { await cache.put(DATA_URL, new Response(text, {headers: {'Content-Type': 'application/json'}})); store.set('dbTime', Date.now()); } catch {} }
  return JSON.parse(text);
}
export async function loadDb(onProgress){
  let cache = null, cached = null;
  try { cache = await caches.open('hkgo-data-v1'); cached = await cache.match(DATA_URL); } catch {}
  const fresh = Date.now() - store.get('dbTime', 0) < 864e5;
  if (cached) {
    try {
      const j = await cached.clone().json();
      if (!fresh) download(cache).catch(() => {});   // 背景更新，下次開就用新資料
      return j;
    } catch {}
  }
  return download(cache, onProgress);
}
export async function clearData(){ try { await caches.delete('hkgo-data-v1'); } catch {} store.del('dbTime'); }

const cell = (lat, lng) => Math.floor(lat / 0.002) + ':' + Math.floor(lng / 0.002);
export function buildIndex(){
  const {DB, IDX, GRID, NUMS} = S;
  for (const [key, r] of Object.entries(DB.routeList)) {
    if (!NUMS.has(r.route)) NUMS.set(r.route, []);
    NUMS.get(r.route).push(key);
    for (const co of r.co) (r.stops[co] || []).forEach((id, seq) => {
      if (!IDX.has(id)) IDX.set(id, []);
      IDX.get(id).push({key, co, seq});
    });
  }
  for (const [id, s] of Object.entries(DB.stopList)) {
    if (!IDX.has(id) || !s.location) continue;
    const k = cell(s.location.lat, s.location.lng);
    if (!GRID.has(k)) GRID.set(k, []);
    GRID.get(k).push(id);
  }
}

/* ---------- 地理 ---------- */
export function dist(a, b){
  const R = 6371000, r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * R;
}
export const walkMin = m => Math.max(1, Math.ceil(m * 1.35 / (S.set.walk || 75)));
export const inHK = p => p.lat > HK.s && p.lat < HK.n && p.lng > HK.w && p.lng < HK.e;
export const stopLoc = id => S.DB.stopList[id]?.location;
export const stopName = id => nm(S.DB.stopList[id]?.name);
export function stopsWithin(p, r){
  const out = [], span = Math.ceil(r / 200) + 1, cy = Math.floor(p.lat / 0.002), cx = Math.floor(p.lng / 0.002);
  for (let i = -span; i <= span; i++) for (let j = -span; j <= span; j++)
    for (const id of S.GRID.get((cy + i) + ':' + (cx + j)) || []) {
      const d = dist(p, S.DB.stopList[id].location);
      if (d <= r) out.push({id, d});
    }
  return out.sort((a, b) => a.d - b.d);
}
export function bearing(a, b){
  const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
export const compass = deg => {
  const i = Math.round(deg / 45) % 8;
  return L(['北', '東北', '東', '東南', '南', '西南', '西', '西北'][i], ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][i]);
};

/* ---------- 時間表 ---------- */
export function dayIdx(){
  const hk = new Date(Date.now() + 288e5);
  const ymd = hk.toISOString().slice(0, 10).replace(/-/g, '');
  return (S.DB.holidays || []).includes(ymd) ? 0 : hk.getUTCDay();
}
export function todayFreq(r){
  const di = dayIdx(), out = [];
  for (const [sd, v] of Object.entries(r.freq || {})) {
    if (String(S.DB.serviceDayMap?.[sd]?.[di]) !== '1') continue;
    for (const [st, x] of Object.entries(v)) out.push({start: st, end: x ? x[0] : null, hw: x ? +x[1] : null});
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
export function serviceInfo(r){
  const f = todayFreq(r);
  if (!f.length) return null;
  const first = f[0].start, last = f.reduce((m, x) => (x.end || x.start) > m ? (x.end || x.start) : m, '0000');
  const nowHM = new Date(Date.now() + 288e5).toISOString().slice(11, 16).replace(':', '');
  const cur = f.find(x => x.end && x.start <= nowHM && nowHM <= x.end);
  const fmt = s => s.slice(0, 2) + ':' + s.slice(2);
  return {first: fmt(first), last: fmt(last), hw: cur ? Math.round(cur.hw / 60) : null};
}
export function rideMin(r, co, i, j){
  if (j <= i) return 0;
  if (co === 'mtr') return (j - i) * 2.3 + 0.5;
  if (co === 'lightRail') return (j - i) * 1.6;
  const n = (r.stops[co] || []).length;
  if (r.jt && n > 1) return +r.jt * (j - i) / (n - 1);
  let m = 0; const st = r.stops[co];
  for (let k = i; k < j; k++) { const a = stopLoc(st[k]), b = stopLoc(st[k + 1]); if (a && b) m += dist(a, b); }
  return m * 1.3 / 270;
}
export function avgWait(r, co){
  if (co === 'mtr') return 2.5;
  if (co === 'lightRail') return 4;
  const si = serviceInfo(r);
  return si?.hw ? Math.min(20, si.hw / 2) : 8;
}
// 按時間表推算下幾班（渡輪用，或者冇實時資料時參考）
export function nextDepartures(r, co, seq, n = 3){
  const out = [], now = Date.now(), off = rideMin(r, co, 0, seq) * 60000;
  for (const f of todayFreq(r)) {
    if (!f.hw) { const t = hm2t(f.start) + off; if (t > now - 60000) out.push(t); continue; }
    for (let t = hm2t(f.start); t <= hm2t(f.end); t += f.hw * 1000) if (t + off > now - 60000) { out.push(t + off); if (out.length > n + 4) break; }
  }
  return out.sort((a, b) => a - b).slice(0, n);
}
export const fareAt = (r, seq) => { const f = r.fares?.[seq]; return f != null && f !== '' ? +f : null; };
export const money = v => v == null ? '' : '$' + (Math.round(v * 10) / 10).toFixed(1);

/* ---------- 雜項 ---------- */
export function toast(msg, ms = 3200){
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('on');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms);
}
export function speak(text){
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = S.set.lang === 'en' ? 'en-GB' : 'zh-HK';
    const v = speechSynthesis.getVoices().find(v => v.lang.replace('_', '-').toLowerCase() === u.lang.toLowerCase());
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch {}
}
export async function notify(title, body){
  try { navigator.vibrate?.([300, 120, 300]); } catch {}
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg) reg.showNotification(title, {body, icon: 'icon-192.png', tag: 'hkgo-trip', renotify: true});
    else new Notification(title, {body, icon: 'icon-192.png'});
  } catch {}
}
export const icon = {
  walk: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4" r="2" fill="currentColor"/><path d="M10 22l2-7 3 3v6M8 12l2-4 4 1 2 4 3 1M10 8l-2 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  star: on => `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 17l-5.8 3.3 1.4-6.4-4.9-4.4 6.5-.7z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  arrow: deg => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${Math.round(deg)}deg)"><path d="M12 3l6 9h-4v9h-4v-9H6z" fill="currentColor"/></svg>`,
  back: '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4l-8 8 8 8" stroke="currentColor" stroke-width="2.6" fill="none"/></svg>',
  door: '<svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V3h9v18M14 12h7m-3-3 3 3-3 3" stroke="currentColor" stroke-width="2.2" fill="none"/><circle cx="11" cy="12" r="1.3" fill="currentColor"/></svg>',
  list: '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13" stroke="currentColor" stroke-width="2.2"/><circle cx="4" cy="6" r="1.6" fill="currentColor"/><circle cx="4" cy="12" r="1.6" fill="currentColor"/><circle cx="4" cy="18" r="1.6" fill="currentColor"/></svg>',
  x: '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="2.4"/></svg>',
  speak: '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8a5 5 0 0 1 0 8M18.5 5.5a8.5 8.5 0 0 1 0 13" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  bus: '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="15" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 11h16M7 21v-3M17 21v-3" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="14.5" r="1.2" fill="currentColor"/><circle cx="16" cy="14.5" r="1.2" fill="currentColor"/></svg>',
  pin: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-7.2 7-12.5A7 7 0 0 0 5 9.5C5 14.8 12 22 12 22z" fill="currentColor"/><circle cx="12" cy="9.5" r="2.6" fill="#111"/></svg>',
  gps: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2.4" fill="none"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2.4"/></svg>',
  swap: '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16m0 0-4-4m4 4 4-4M17 20V4m0 0-4 4m4-4 4 4" stroke="currentColor" stroke-width="2.2" fill="none"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5" stroke="currentColor" stroke-width="2.4" fill="none"/><path d="m15 15 6 6" stroke="currentColor" stroke-width="2.4"/></svg>'
};
