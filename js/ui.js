// 港途 · 介面共用：位置、收藏、彈出面板、頁面、地點搜尋
import {S, $, esc, store, L, nm, inHK, dist, coTag, icon, toast} from './core.js';

/* ---------- 事件 ---------- */
export const bus = new EventTarget();
export const emit = (n, d) => bus.dispatchEvent(new CustomEvent(n, {detail: d}));
export const on = (n, f) => bus.addEventListener(n, e => f(e.detail));

/* ---------- 位置 ---------- */
let watchId = null;
export function setHere(p){
  S.here = p;
  if (p.mode === 'manual') store.set('place', {lat: p.lat, lng: p.lng, label: p.label});
  emit('here', p);
}
export function stopGps(){ if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } emit('gps', 'off'); }
export function gpsOn(){ return watchId != null; }
export function startGps(){
  if (!('geolocation' in navigator)) { toast(L('呢部機唔支援定位', 'Location not supported')); return; }
  stopGps(); emit('gps', 'busy');
  let first = true;
  watchId = navigator.geolocation.watchPosition(pos => {
    const p = {lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, label: L('你嘅位置', 'Your location'), mode: 'gps'};
    S.gpsFix = p; emit('fix', p);
    if (!inHK(p)) { stopGps(); emit('gps', 'outside'); return; }
    emit('gps', 'on');
    if (first || !S.here || S.here.mode !== 'gps' || dist(S.here, p) > 15) { first = false; setHere(p); }
    else { S.here.acc = p.acc; emit('acc', p); }
  }, err => { stopGps(); emit('gps', err.code === 1 ? 'denied' : 'error'); },
  {enableHighAccuracy: true, maximumAge: 10000, timeout: 20000});
}

/* ---------- 收藏 ---------- */
export const favs = new Map(store.get('favs2', []));
export const isFav = id => favs.has(id);
export function toggleFav(id, desc){
  favs.has(id) ? favs.delete(id) : favs.set(id, {...desc, at: Date.now()});
  store.set('favs2', [...favs]);
  emit('favs');
  return favs.has(id);
}
export const starBtn = (id, label) => `<button class="star" type="button" data-fav="${esc(id)}" aria-pressed="${isFav(id)}" aria-label="${esc((isFav(id) ? L('取消常用：', 'Unpin: ') : L('加入常用：', 'Pin: ')) + label)}">${icon.star(isFav(id))}</button>`;

/* ---------- 常用地點 ---------- */
export const places = Object.assign({home: null, work: null, custom: []}, store.get('places', {}));
export const savePlaces = () => { store.set('places', places); emit('places'); };

/* ---------- 返回鍵堆疊（Android 返回鍵 / 瀏覽器返回都會關閉最上層） ---------- */
const stack = [];
function pushLayer(close){ stack.push(close); history.pushState({hkgo: stack.length}, ''); }
window.addEventListener('popstate', () => {
  const depth = history.state?.hkgo || 0;
  while (stack.length > depth) stack.pop()();
});
export const back = () => { if (stack.length) history.back(); };

/* ---------- 彈出面板 ---------- */
function hideSheet(){ const sh = $('sheet'); sh.classList.remove('on'); sh.hidden = true; sh.innerHTML = ''; }
export function openSheet(html, mount){
  const sh = $('sheet'), wasOpen = !sh.hidden;
  sh.innerHTML = `<div class="sheet-bg" data-close></div><div class="sheet-card" role="dialog" aria-modal="true"><div class="grab" aria-hidden="true"></div>${html}</div>`;
  sh.hidden = false;
  requestAnimationFrame(() => sh.classList.add('on'));
  sh.onclick = e => { if (e.target.closest('[data-close]')) closeSheet(); };
  if (!wasOpen) pushLayer(hideSheet);
  mount?.(sh.querySelector('.sheet-card'));
}
export function closeSheet(){ if (!$('sheet').hidden) back(); }

/* ---------- 全頁（路線詳情等） ---------- */
export function openPage(cls = ''){
  const pg = document.createElement('section');
  pg.className = 'page ' + cls;
  document.body.appendChild(pg);
  requestAnimationFrame(() => pg.classList.add('on'));
  document.body.classList.add('paged');
  pushLayer(() => {
    pg.dispatchEvent(new Event('close'));
    pg.remove();
    if (!document.querySelector('.page')) document.body.classList.remove('paged');
  });
  pg.close = back;
  return pg;
}
export function closeAll(){ if (stack.length) history.go(-stack.length); }

/* ---------- 分頁 ---------- */
export function go(tab){
  closeAll();
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== 'v-' + tab;
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false');
  store.set('tab', tab);
  emit('tab', tab);
  window.scrollTo(0, 0);
}

/* ---------- 地點搜尋 ---------- */
export function searchStops(q, limit = 8){
  q = q.trim().toLowerCase();
  if (!q || /^[\x00-\x7f]$/.test(q)) return [];
  const seen = new Map();
  for (const [id, s] of Object.entries(S.DB.stopList)) {
    if (!S.IDX.has(id)) continue;
    const zh = s.name.zh || '', en = (s.name.en || '').toLowerCase();
    if (!zh.toLowerCase().includes(q) && !en.includes(q)) continue;
    if (!seen.has(zh)) seen.set(zh, {kind: 'stop', name: s.name, lat: s.location.lat, lng: s.location.lng, cos: new Set(), score: zh.startsWith(q) || en.startsWith(q) ? 0 : 1});
    for (const e of S.IDX.get(id)) seen.get(zh).cos.add(e.co);
    if (seen.size > 300) break;
  }
  return [...seen.values()].sort((a, b) => a.score - b.score || a.name.zh.length - b.name.zh.length).slice(0, limit);
}
export async function searchPlaces(q){
  q = q.trim(); if (q.length < 2) return [];
  try {
    const r = await fetch('https://www.als.gov.hk/lookup?q=' + encodeURIComponent(q) + '&n=6', {headers: {Accept: 'application/json'}});
    const j = await r.json(), out = [], seen = new Set();
    for (const s of j.SuggestedAddress || []) {
      const p = s.Address?.PremisesAddress || {}, c = p.ChiPremisesAddress || {}, e = p.EngPremisesAddress || {}, g = p.GeospatialInformation || {};
      const zh = c.BuildingName || c.ChiEstate?.EstateName || [c.ChiStreet?.StreetName, c.ChiStreet?.BuildingNoFrom && c.ChiStreet.BuildingNoFrom + '號'].filter(Boolean).join('');
      const en = e.BuildingName || e.EngEstate?.EstateName || [e.EngStreet?.BuildingNoFrom, e.EngStreet?.StreetName].filter(Boolean).join(' ');
      const sub = [c.ChiStreet?.StreetName && (c.ChiStreet.StreetName + (c.ChiStreet.BuildingNoFrom ? c.ChiStreet.BuildingNoFrom + '號' : '')), c.ChiDistrict?.DcDistrict].filter(Boolean).join(' · ');
      const subEn = [e.EngStreet?.BuildingNoFrom, e.EngStreet?.StreetName, e.EngDistrict?.DcDistrict].filter(Boolean).join(' ');
      if (!g.Latitude || !zh || seen.has(zh)) continue;
      seen.add(zh);
      out.push({kind: 'place', name: {zh, en: en || zh}, sub: {zh: sub, en: subEn}, lat: +g.Latitude, lng: +g.Longitude});
    }
    return out;
  } catch { return []; }
}
// 搜尋框 + 建議清單；onPick({lat,lng,label})
export function attachPicker(input, box, onPick, opt = {}){
  let tq, seq = 0, list = [];
  const draw = (stops, plc, loading) => {
    const extra = [];
    if (opt.here && S.here) extra.push({kind: 'here', name: {zh: '你嘅位置', en: 'Your location'}, lat: S.here.lat, lng: S.here.lng});
    if (opt.saved) {
      if (places.home) extra.push({kind: 'saved', name: {zh: '屋企', en: 'Home'}, ...places.home});
      if (places.work) extra.push({kind: 'saved', name: {zh: '學校／公司', en: 'School / Work'}, ...places.work});
      for (const c of places.custom || []) extra.push({kind: 'saved', name: {zh: c.label, en: c.label}, ...c});
    }
    const q = input.value.trim();
    list = [...(q ? [] : extra), ...plc, ...stops];
    if (!list.length && !loading) { box.innerHTML = q ? `<div class="empty">${L('搵唔到', 'No results')}</div>` : ''; box.classList.toggle('on', !!q); return; }
    box.innerHTML = list.map((x, i) => `<button type="button" role="option" data-i="${i}">
      <span class="k k-${x.kind}">${x.kind === 'place' ? icon.pin : x.kind === 'here' ? icon.gps : x.kind === 'saved' ? icon.star(true) : icon.bus}</span>
      <span class="nm">${esc(nm(x.name))}${x.sub ? `<small>${esc(nm(x.sub))}</small>` : ''}</span>
      ${x.cos ? [...x.cos].slice(0, 2).map(coTag).join(' ') : ''}</button>`).join('') + (loading ? `<div class="empty">${L('搵緊地方…', 'Searching places…')}</div>` : '');
    box.classList.add('on');
  };
  input.addEventListener('input', () => {
    clearTimeout(tq);
    const q = input.value, my = ++seq;
    const stops = searchStops(q, opt.places ? 5 : 10);
    draw(stops, [], !!opt.places && q.trim().length >= 2);
    if (opt.places && q.trim().length >= 2) tq = setTimeout(async () => { const p = await searchPlaces(q); if (my === seq) draw(stops, p, false); }, 350);
  });
  input.addEventListener('focus', () => { if (!input.value) draw([], [], false); });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') box.classList.remove('on'); if (e.key === 'Enter') box.querySelector('button')?.click(); });
  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const x = list[+b.dataset.i];
    box.classList.remove('on'); input.value = opt.keep ? nm(x.name) : ''; input.blur();
    onPick({lat: x.lat, lng: x.lng, label: nm(x.name), kind: x.kind});
  });
  document.addEventListener('click', e => { if (!box.contains(e.target) && e.target !== input) box.classList.remove('on'); });
}
