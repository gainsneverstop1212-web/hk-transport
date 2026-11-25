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
export const addLayer = close => pushLayer(close);

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
const scrollPos = {};
let curTab = null;
export function go(tab){
  if (curTab) scrollPos[curTab] = window.scrollY;
  closeAll();
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== 'v-' + tab;
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false');
  store.set('tab', tab);
  emit('tab', tab);
  const y = curTab === tab ? 0 : (scrollPos[tab] || 0);
  curTab = tab;
  requestAnimationFrame(() => window.scrollTo(0, y));
}

/* ---------- 地點搜尋 ---------- */
// 香港人常用叫法：code = 港鐵站；q = 用嚟查地址嘅全名
// pt = 地標本身嘅位置（大學、商場）：搜尋時排第一，唔使喺一堆大樓名入面揀
const ALIAS = [
  [['理大', 'polyu', '理工大學', '香港理工大學'], {q: '香港理工大學', pt: [22.3045, 114.1797], zh: '香港理工大學（理大）', en: 'PolyU'}], [['港大', 'hku'], {code: 'HKU', zh: '香港大學站（港大）', en: 'HKU Station'}],
  [['中大', 'cuhk'], {code: 'UNI', zh: '大學站（中大）', en: 'University Station (CUHK)'}], [['科大', 'hkust', 'ust', '科技大學'], {q: '香港科技大學', pt: [22.3363, 114.2634], zh: '香港科技大學（科大）', en: 'HKUST'}],
  [['城大', 'cityu', '城市大學'], {q: '香港城市大學', pt: [22.3366, 114.1724], zh: '香港城市大學（城大）', en: 'CityU'}], [['浸大', 'hkbu', '浸會大學'], {q: '香港浸會大學', pt: [22.3398, 114.1820], zh: '香港浸會大學（浸大）', en: 'HKBU'}],
  [['教大', 'eduhk', '教育大學'], {q: '香港教育大學', pt: [22.4688, 114.1944], zh: '香港教育大學（教大）', en: 'EdUHK'}],
  [['嶺大', 'lingnan', '嶺南大學'], {q: '嶺南大學', pt: [22.4100, 113.9785], zh: '嶺南大學（嶺大）', en: 'Lingnan University'}], [['都大', 'hkmu', '都會大學'], {q: '香港都會大學', pt: [22.3165, 114.1806], zh: '香港都會大學（都大）', en: 'HKMU'}],
  [['朗豪坊', 'langham place'], {q: '朗豪坊', pt: [22.3179, 114.1685], zh: '朗豪坊', en: 'Langham Place'}], [['又一城', 'festival walk'], {q: '又一城', pt: [22.3373, 114.1748], zh: '又一城', en: 'Festival Walk'}],
  [['新城市廣場', '新城市', 'new town plaza'], {q: '新城市廣場', pt: [22.3820, 114.1890], zh: '新城市廣場', en: 'New Town Plaza'}], [['apm'], {q: 'APM', pt: [22.3121, 114.2253], zh: 'APM（觀塘）', en: 'APM'}],
  [['太古廣場', 'pacific place'], {q: '太古廣場', pt: [22.2776, 114.1652], zh: '太古廣場', en: 'Pacific Place'}], [['圓方', 'elements'], {q: '圓方', pt: [22.3045, 114.1612], zh: '圓方', en: 'Elements'}],
  [['山頂', 'the peak', 'peak'], {q: '山頂', pt: [22.2711, 114.1497], zh: '山頂（凌霄閣）', en: 'The Peak'}], [['天星碼頭', 'star ferry'], {q: '天星碼頭', pt: [22.2936, 114.1686], zh: '尖沙咀天星碼頭', en: 'Star Ferry (Tsim Sha Tsui)'}],
  [['高鐵站', '西九龍站', 'west kowloon station'], {q: '香港西九龍站', pt: [22.3043, 114.1660], zh: '香港西九龍站（高鐵）', en: 'Hong Kong West Kowloon Station'}],
  [['機場', '赤鱲角', 'airport'], {code: 'AIR', zh: '機場（客運大樓）', en: 'Airport (Terminal)'}],
  [['迪士尼', 'disney'], {code: 'DIS', zh: '迪士尼（港鐵站）', en: 'Disneyland Resort'}], [['海洋公園', 'ocean park'], {code: 'OCP', zh: '海洋公園站', en: 'Ocean Park Station'}],
  [['會展', 'hkcec'], {code: 'EXC', zh: '會展站', en: 'Exhibition Centre Station'}], [['啟德', 'kai tak'], {code: 'KAT', zh: '啟德站', en: 'Kai Tak Station'}],
  [['ifc', '國金'], {q: '國際金融中心', pt: [22.2856, 114.1589], zh: '國際金融中心（IFC）', en: 'IFC'}], [['時代廣場', 'times square'], {q: '時代廣場', pt: [22.2783, 114.1822], zh: '時代廣場', en: 'Times Square'}], [['海港城', 'harbour city'], {q: '海港城', pt: [22.2976, 114.1686], zh: '海港城', en: 'Harbour City'}]
];
const aliasOf = q => { const k = q.trim().toLowerCase(); const a = ALIAS.find(([ks]) => ks.includes(k)); return a ? a[1] : null; };
export function searchStops(q, limit = 8){
  q = q.trim().toLowerCase();
  if (!q || /^[\x00-\x7f]$/.test(q)) return [];
  const seen = new Map();
  for (const [id, s] of Object.entries(S.DB.stopList)) {
    if (!S.IDX.has(id)) continue;
    const zh = s.name.zh || '', en = (s.name.en || '').toLowerCase();
    if (!zh.toLowerCase().includes(q) && !en.includes(q)) continue;
    // 同名車站如果相距超過 1 公里，當係唔同地方（例如全港有幾個「新圍村」）
    const key = [...seen.keys()].find(k => k.startsWith(zh + '|') && dist(seen.get(k), s.location) < 1000) || zh + '|' + seen.size;
    if (!seen.has(key)) seen.set(key, {kind: 'stop', name: s.name, lat: s.location.lat, lng: s.location.lng, cos: new Set(), routes: new Set(), rail: false,
      score: zh === q || zh === q + '站' || en === q ? 0 : zh.startsWith(q) || en.startsWith(q) ? 1 : 2});
    const x = seen.get(key);
    for (const e of S.IDX.get(id)) { x.cos.add(e.co); if (e.co === 'mtr' || e.co === 'lightRail') x.rail = true; if (x.routes.size < 4 && e.co !== 'mtr') x.routes.add(S.DB.routeList[e.key].route.replace('*', '')); }
    if (seen.size > 300) break;
  }
  const vals = [...seen.values()], cnt = new Map();
  for (const v of vals) cnt.set(v.name.zh, (cnt.get(v.name.zh) || 0) + 1);
  for (const v of vals) if (cnt.get(v.name.zh) > 1 && v.routes.size) v.sub = {zh: '途經 ' + [...v.routes].join('、'), en: 'Routes ' + [...v.routes].join(', ')};
  return vals.sort((a, b) => (a.score - (a.rail ? 1.5 : 0)) - (b.score - (b.rail ? 1.5 : 0)) || a.name.zh.length - b.name.zh.length).slice(0, limit);
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
// 一個全域監聽：撳出面就收埋所有建議清單（唔會每個搜尋框加一個）
document.addEventListener('click', e => {
  for (const b of document.querySelectorAll('.results.on')) if (!b.parentElement.contains(e.target)) b.classList.remove('on');
});
// 搜尋框 + 建議清單；onPick({lat,lng,label,kind})
export function attachPicker(input, box, onPick, opt = {}){
  let tq, seq = 0, list = [];
  const draw = (alias, stops, plc, loading) => {
    const extra = [];
    if (opt.here && S.here) extra.push({kind: 'here', name: {zh: '你嘅位置', en: 'Your location'}, lat: S.here.lat, lng: S.here.lng});
    if (opt.saved) {
      if (places.home) extra.push({kind: 'saved', name: {zh: '屋企', en: 'Home'}, ...places.home});
      if (places.work) extra.push({kind: 'saved', name: {zh: '學校／公司', en: 'School / Work'}, ...places.work});
      for (const c of places.custom || []) extra.push({kind: 'saved', name: {zh: c.label, en: c.label}, ...c});
    }
    const q = input.value.trim();
    const savedHit = q ? extra.filter(x => x.kind === 'saved' && nm(x.name).toLowerCase().includes(q.toLowerCase())) : extra;
    // 次序：常用叫法 → 港鐵／輕鐵站同名稱完全啱嘅車站 → 常用地點 → 地方（大廈）→ 其他車站
    const top = stops.filter(x => x.rail || x.score === 0), rest = stops.filter(x => !(x.rail || x.score === 0));
    list = [...alias, ...top, ...savedHit, ...plc.slice(0, opt.places ? 5 : 0), ...rest];
    if (!list.length && !loading) { box.innerHTML = q ? `<div class="empty">${L('搵唔到', 'No results')}</div>` : ''; box.classList.toggle('on', !!q); return; }
    box.innerHTML = list.map((x, i) => `<button type="button" role="option" data-i="${i}">
      <span class="k k-${x.kind}">${x.kind === 'place' ? icon.pin : x.kind === 'here' ? icon.gps : x.kind === 'saved' || x.kind === 'alias' ? icon.star(true) : icon.bus}</span>
      <span class="nm">${esc(nm(x.name))}${x.sub ? `<small>${esc(nm(x.sub))}</small>` : ''}</span>
      ${x.cos ? [...x.cos].slice(0, 2).map(coTag).join(' ') : ''}</button>`).join('') + (loading ? `<div class="empty">${L('搵緊地方…', 'Searching places…')}</div>` : '');
    box.classList.add('on');
  };
  input.addEventListener('input', () => {
    clearTimeout(tq);
    const q = input.value, my = ++seq, al = aliasOf(q);
    const alias = al?.code && S.DB.stopList[al.code] ? [{kind: 'alias', name: {zh: al.zh, en: al.en}, ...S.DB.stopList[al.code].location}]
      : al?.pt ? [{kind: 'alias', name: {zh: al.zh, en: al.en}, lat: al.pt[0], lng: al.pt[1]}] : [];
    const stops = searchStops(al?.q || q, 10);
    const wantPlaces = opt.places && (al?.q || q).trim().length >= 2;
    draw(alias, stops, [], wantPlaces);
    if (wantPlaces) tq = setTimeout(async () => { const p = await searchPlaces(al?.q || q); if (my === seq) draw(alias, stops, p, false); }, 350);
  });
  let picked = false;
  input.addEventListener('focus', () => { picked = false; if (!input.value) draw([], [], [], false); else input.select?.(); });
  // 打咗字但冇揀建議就離開：還原返而家用緊嘅地點名，免得畫面顯示 A、實際計緊 B
  if (opt.current) input.addEventListener('blur', () => setTimeout(() => {
    if (picked || document.activeElement === input) return;
    const cur = opt.current() || '', typed = input.value.trim();
    if (typed !== cur) { input.value = cur; if (typed) toast(L('請喺建議清單揀一個地點', 'Pick a place from the suggestions')); }
    box.classList.remove('on');
  }, 300));
  input.addEventListener('keydown', e => { if (e.key === 'Escape') box.classList.remove('on'); if (e.key === 'Enter') box.querySelector('button')?.click(); });
  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const x = list[+b.dataset.i];
    picked = true;
    box.classList.remove('on'); input.value = opt.keep ? nm(x.name) : ''; input.blur();
    onPick({lat: x.lat, lng: x.lng, label: nm(x.name), name: x.name, kind: x.kind});
  });
}
