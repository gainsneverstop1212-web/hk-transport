// 港住走 · 介面共用：位置、收藏、彈出面板、頁面、地點搜尋
import {S, $, esc, store, L, nm, inHK, dist, coTag, icon, toast} from './core.js';

/* ---------- 事件 ---------- */
export const bus = new EventTarget();
export const emit = (n, d) => bus.dispatchEvent(new CustomEvent(n, {detail: d}));
export const on = (n, f) => bus.addEventListener(n, e => f(e.detail));

/* ---------- 位置 ---------- */
let watchId = null, roughT = null, retryT = null;
export function setHere(p){
  S.here = p;
  if (p.mode === 'manual') store.set('place', {lat: p.lat, lng: p.lng, label: p.label});
  emit('here', p);
}
export function stopGps(){
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  clearTimeout(roughT); clearTimeout(retryT); roughT = retryT = null;
  emit('gps', 'off');
}
export function gpsOn(){ return watchId != null; }
// 定位策略（解決「開咗定位都唔準」）：
// · 手機頭一兩秒通常只係用 Wi-Fi／電話網絡估個大概（誤差幾百米）：太粗略嘅位置先等幾秒，等 GPS 收到衛星
// · 新位置要準過而家嗰個，或者真係行咗一段路，先會取代；唔會俾一個 Wi-Fi 估算蓋過準確嘅 GPS 位置
// · 室內、港鐵站 GPS 慢：timeout 唔會停定位，會繼續等
// · 唔用舊位置（maximumAge: 0）
const ROUGH = 150, WAIT_ROUGH = 6000;
export function startGps(){
  if (!('geolocation' in navigator)) { toast(L('呢部機唔支援定位', 'Location not supported')); return; }
  stopGps(); emit('gps', 'busy');
  let pending = null, lastFix = 0;
  const use = p => { clearTimeout(roughT); roughT = null; pending = null; setHere(p); store.set('gpsUsed', true); };
  const onPos = pos => {
    const c = pos.coords;
    const p = {lat: c.latitude, lng: c.longitude, acc: c.accuracy, at: pos.timestamp || Date.now(), label: L('你嘅位置', 'Your location'), mode: 'gps'};
    lastFix = Date.now();
    S.gpsFix = p; emit('fix', p);
    if (!inHK(p)) { stopGps(); emit('gps', 'outside'); return; }
    const cur = S.here?.mode === 'gps' ? S.here : null;
    // 未有 GPS 位置：粗略嘅先等一陣，期間有準啲嘅就即刻用
    if (!cur) {
      if (p.acc <= ROUGH) { emit('gps', 'on'); use(p); return; }
      if (!pending || p.acc < pending.acc) pending = p;
      emit('gps', 'rough');
      if (!roughT) roughT = setTimeout(() => { roughT = null; if (pending && S.here?.mode !== 'gps') { emit('gps', 'on'); use(pending); } }, WAIT_ROUGH);
      return;
    }
    emit('gps', p.acc > ROUGH ? 'rough' : 'on');
    const moved = dist(cur, p), age = Date.now() - (cur.at || 0);
    const better = p.acc <= cur.acc * 0.85 + 3;                       // 準咗
    const walked = moved > Math.max(25, (cur.acc + p.acc) * 0.8);     // 真係郁咗，唔係誤差跳動
    const stale = age > 45000 && p.acc <= Math.max(cur.acc * 1.6, 60);   // 舊位置太耐冇更新
    if (!(better || walked || stale)) return;
    if (moved > 15) setHere(p);
    else { Object.assign(S.here, {acc: p.acc, at: p.at, lat: better ? p.lat : S.here.lat, lng: better ? p.lng : S.here.lng}); emit('acc', p); }
  };
  const onErr = err => {
    if (err.code === 1) { store.del('gpsUsed'); stopGps(); emit('gps', 'denied'); return; }   // 拒絕咗就唔好下次開 app 再自動問
    // timeout／暫時攞唔到：唔停，繼續等；太耐冇位置就重新開一次（部分 iPhone timeout 之後唔會再報位置）
    if (S.here?.mode !== 'gps') emit('gps', 'busy');
    clearTimeout(retryT);
    retryT = setTimeout(() => {
      if (watchId == null || Date.now() - lastFix < 25000) return;
      navigator.geolocation.clearWatch(watchId);
      watchId = navigator.geolocation.watchPosition(onPos, onErr, OPTS);
    }, 3000);
  };
  const OPTS = {enableHighAccuracy: true, maximumAge: 0, timeout: 30000};
  watchId = navigator.geolocation.watchPosition(onPos, onErr, OPTS);
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
S.places = places;                                 // 出門預留（落樓等𨋢）要用屋企／公司嘅樓層
export const savePlaces = () => { store.set('places', places); emit('places'); };

/* ---------- 返回鍵堆疊（Android 返回鍵 / 瀏覽器返回都會關閉最上層） ---------- */
const stack = [];
function pushLayer(close){ stack.push(close); history.pushState({hkgo: stack.length}, ''); }
let afterPop = [];
window.addEventListener('popstate', () => {
  const depth = history.state?.hkgo || 0;
  while (stack.length > depth) stack.pop()();
  const fns = afterPop; afterPop = [];
  fns.forEach(f => f());
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
// then：等面板真係關咗（返回鍵記錄退完）先做，例如開出門倒數；
// 唔等嘅話新加嘅倒數層會俾遲嚟嘅「返回」即刻收細
export function closeSheet(then){
  if ($('sheet').hidden || !stack.length) { then?.(); return; }
  if (then) afterPop.push(then);
  back();
}

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
  const qStn = /(站| station)$/.test(q) ? q.replace(/(站| station)$/, '') : '';
  const seen = new Map();
  for (const [id, s] of Object.entries(S.DB.stopList)) {
    if (!S.IDX.has(id)) continue;
    const zh = s.name.zh || '', en = (s.name.en || '').toLowerCase();
    // 「香港站」都要搵到港鐵「香港」站（車站資料入面冇「站」字）
    if (!zh.toLowerCase().includes(q) && !en.includes(q) && !(qStn && (zh === qStn || en === qStn))) continue;
    // 同名車站如果相距超過 1 公里，當係唔同地方（例如全港有幾個「新圍村」）
    const key = [...seen.keys()].find(k => k.startsWith(zh + '|') && dist(seen.get(k), s.location) < 1000) || zh + '|' + seen.size;
    if (!seen.has(key)) seen.set(key, {kind: 'stop', name: s.name, lat: s.location.lat, lng: s.location.lng, cos: new Set(), routes: new Set(), rail: false,
      score: zh === q || zh === q + '站' || zh + '站' === q || en === q || en + ' station' === q ? 0 : zh.startsWith(q) || en.startsWith(q) ? 1 : 2});
    const x = seen.get(key);
    for (const e of S.IDX.get(id)) { x.cos.add(e.co); if (e.co === 'mtr' || e.co === 'lightRail') x.rail = true; if (x.routes.size < 4 && e.co !== 'mtr') x.routes.add(S.DB.routeList[e.key].route.replace('*', '')); }
    if (seen.size > 300) break;
  }
  const vals = [...seen.values()], cnt = new Map();
  for (const v of vals) cnt.set(v.name.zh, (cnt.get(v.name.zh) || 0) + 1);
  // 每個車站都寫埋途經路線：同名或者唔熟嘅站都認得出係邊個
  for (const v of vals) if (v.routes.size) v.sub = {zh: '途經 ' + [...v.routes].join('、'), en: 'Routes ' + [...v.routes].join(', ')};
  return vals.sort((a, b) => (a.score - (a.rail ? 1.5 : 0)) - (b.score - (b.rail ? 1.5 : 0)) || a.name.zh.length - b.name.zh.length).slice(0, limit);
}
/* ---------- 地點搜尋：政府地址（大廈、屋苑、門牌）+ OpenStreetMap（商店、餐廳、廟宇、醫院、地標） ---------- */
// 兩個來源一齊搵，再按「名同你打嘅字有幾吻合」排次序；唔吻合嘅（例如打「麥當勞 旺角」出咗「豪華閣」）排到最後或者唔要
const CN = {零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9};
const cnNum = t => { if (t === '十') return 10; const m = /^([一二兩三四五六七八九])?十([一二三四五六七八九])?$/.exec(t); if (m) return (m[1] ? CN[m[1]] : 1) * 10 + (m[2] ? CN[m[2]] : 0); return t.length === 1 && t in CN ? CN[t] : null; };
// 正規化：全形轉半形（Ｆ座 = F座）、「第五期」=「第5期」=「5期」、去走空格標點
const norm = s => String(s || '').normalize('NFKC').toLowerCase()
  .replace(/[零一二兩三四五六七八九十]+(?=[期座樓區街號])/g, t => { const n = cnNum(t); return n == null ? t : String(n); })
  .replace(/第(?=\d)/g, '').replace(/[\s·・,，.。()（）\-–—'’"]/g, '');
const zhPart = s => { const m = /^([^A-Za-z]*[^\x00-\x7f][^A-Za-z]*?)\s+([A-Za-z0-9].*)$/.exec(String(s || '').trim()); return m ? [m[1].trim(), m[2].trim()] : [String(s || '').trim(), String(s || '').trim()]; };
// OpenStreetMap 類別 → 中文（顯示喺地點名下面，一眼分到係餐廳定醫院）
const CAT = {restaurant: ['餐廳', 'Restaurant'], fast_food: ['快餐店', 'Fast food'], cafe: ['咖啡店', 'Café'], hospital: ['醫院', 'Hospital'], clinic: ['診所', 'Clinic'],
  place_of_worship: ['廟宇／教堂', 'Place of worship'], park: ['公園', 'Park'], school: ['學校', 'School'], university: ['大學', 'University'], college: ['大專', 'College'],
  mall: ['商場', 'Mall'], supermarket: ['超級市場', 'Supermarket'], marketplace: ['街市', 'Market'], hotel: ['酒店', 'Hotel'], museum: ['博物館', 'Museum'], arts_centre: ['藝術中心', 'Arts centre'],
  library: ['圖書館', 'Library'], sports_centre: ['體育館', 'Sports centre'], stadium: ['運動場', 'Stadium'], cinema: ['戲院', 'Cinema'], bank: ['銀行', 'Bank'], post_office: ['郵政局', 'Post office'],
  police: ['警署', 'Police'], townhall: ['政府大樓', 'Government'], community_centre: ['社區中心', 'Community centre'], attraction: ['景點', 'Attraction'], viewpoint: ['觀景點', 'Viewpoint'],
  beach: ['泳灘', 'Beach'], ferry_terminal: ['碼頭', 'Ferry pier'], pier: ['碼頭', 'Pier'], train_station: ['車站', 'Station'], station: ['車站', 'Station'], residential: ['住宅', 'Residential'],
  apartments: ['住宅', 'Residential'], office: ['寫字樓', 'Office'], commercial: ['商業大廈', 'Commercial'], primary: ['街道', 'Road'], secondary: ['街道', 'Road'], tertiary: ['街道', 'Road']};
const SKIP = new Set(['bus_stop', 'platform', 'stop_position', 'train_station', 'station', 'halt', 'subway_entrance', 'tram_stop', 'footway', 'steps', 'path', 'service', 'track', 'cycleway', 'pedestrian', 'elevator', 'entrance', 'bench', 'waste_basket', 'toilets']);
const HK_BOX = '113.82,22.13,114.45,22.58';
function timed(url, opt = {}, ms = 6000){
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, {...opt, signal: ctl.signal}).finally(() => clearTimeout(t));
}
async function alsSearch(q){
  const r = await timed('https://www.als.gov.hk/lookup?q=' + encodeURIComponent(q) + '&n=10', {headers: {Accept: 'application/json'}}, 10000);
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json(), out = [];
  for (const s of j.SuggestedAddress || []) {
    const p = s.Address?.PremisesAddress || {}, c = p.ChiPremisesAddress || {}, e = p.EngPremisesAddress || {}, g = p.GeospatialInformation || {};
    const st = c.ChiStreet || {}, se = e.EngStreet || {};
    const no = st.BuildingNoFrom ? st.BuildingNoFrom + (st.BuildingNoTo ? '-' + st.BuildingNoTo : '') : '';
    const noEn = se.BuildingNoFrom ? se.BuildingNoFrom + (se.BuildingNoTo ? '-' + se.BuildingNoTo : '') : '';
    // 中文：屋苑 + 期數 + 座數／大廈名（例如「沙田第一城 33座」「美孚新邨第五期」「創紀之城 渣打中心」）
    const blk = c.ChiBlock?.BlockNo ? c.ChiBlock.BlockNo + (c.ChiBlock.BlockDescriptor || '座') : '';
    const est = (c.ChiEstate?.EstateName || '') + (c.ChiEstate?.ChiPhase?.PhaseName || '');
    const bld = c.BuildingName || blk;
    // 大廈名本身已經包含屋苑名（例如「康怡花園Ｆ座」）就唔好重複
    const zh = est && bld ? (norm(bld).includes(norm(c.ChiEstate?.EstateName)) ? bld : `${est} ${bld}`) : est || bld || [st.StreetName, no && no + '號'].filter(Boolean).join('');
    const blkEn = e.EngBlock?.BlockNo ? (e.EngBlock.BlockDescriptorPrecedenceIndicator === 'Y' ? `${e.EngBlock.BlockDescriptor || 'Block'} ${e.EngBlock.BlockNo}` : `${e.EngBlock.BlockNo} ${e.EngBlock.BlockDescriptor || ''}`) : '';
    const estEn = [e.EngEstate?.EstateName, e.EngEstate?.EngPhase?.PhaseName].filter(Boolean).join(' ');
    const bldEn = e.BuildingName || blkEn;
    const en = estEn && bldEn ? `${bldEn}, ${estEn}` : estEn || bldEn || [noEn, se.StreetName].filter(Boolean).join(' ');
    const sub = [st.StreetName && st.StreetName + (no ? no + '號' : ''), c.ChiDistrict?.DcDistrict].filter(Boolean).join(' · ');
    const subEn = [[noEn, se.StreetName].filter(Boolean).join(' '), e.EngDistrict?.DcDistrict].filter(Boolean).join(', ');
    if (!g.Latitude || !zh) continue;
    out.push({kind: 'place', src: 'als', name: {zh, en: en || zh}, sub: {zh: sub, en: subEn}, lat: +g.Latitude, lng: +g.Longitude, no: st.BuildingNoFrom, noTo: st.BuildingNoTo});
  }
  return out;
}
async function osmSearch(q){
  // 唔會傳送用家位置：附近優先嘅排序喺部機自己計
  const r = await timed(`https://photon.komoot.io/api/?limit=12&bbox=${HK_BOX}&q=${encodeURIComponent(q)}`);
  const j = await r.json(), out = [];
  for (const f of j.features || []) {
    const pr = f.properties || {}, [lng, lat] = f.geometry?.coordinates || [];
    if (!pr.name || lat == null || SKIP.has(pr.osm_value) || !inHK({lat, lng})) continue;
    const [zh, en] = zhPart(pr.name), [dzh, den] = zhPart(pr.district || pr.city || '');
    const cat = CAT[pr.osm_value];
    const street = pr.street ? zhPart(pr.street) : null;
    const subZh = [cat?.[0], street && (street[0] + (pr.housenumber ? pr.housenumber + '號' : '')), dzh].filter(Boolean).join(' · ');
    const subEn = [cat?.[1], street && [pr.housenumber, street[1]].filter(Boolean).join(' '), den].filter(Boolean).join(' · ');
    out.push({kind: 'place', src: 'osm', outdoor: /^(park|beach|viewpoint|pier|ferry_terminal|garden|playground|pitch|stadium|attraction)$/.test(pr.osm_value) || pr.osm_key === 'highway', name: {zh, en}, sub: {zh: subZh, en: subEn}, lat, lng, road: /^(primary|secondary|tertiary|residential|unclassified|living_street)$/.test(pr.osm_value) && pr.osm_key === 'highway'});
  }
  return out;
}
// 吻合程度：0 完全一樣、1 開頭一樣、2 包含成句、3 每個字詞都喺名或者地址度、4 部分吻合、9 唔吻合
// 名同地址都比較：打街道門牌（例如「觀塘道388號」）時，地址完全吻合嘅大廈（渣打中心）要排先
function matchScore(x, q){
  const byName = nameScore(x, q);
  const a = norm(x.sub?.zh) + '|' + norm(x.sub?.en), nq = norm(q);
  const bySub = a && nq.length >= 3 && (a.startsWith(nq) || a.includes(nq)) ? 1 : 9;
  return Math.min(byName, bySub);
}
function nameScore(x, q){
  const nq = norm(q), name = norm(x.name.zh) + '|' + norm(x.name.en), all = name + '|' + norm(x.sub?.zh) + '|' + norm(x.sub?.en);
  const toks = q.trim().toLowerCase().split(/\s+/).map(norm).filter(Boolean);
  if (norm(x.name.zh) === nq || norm(x.name.en) === nq) return 0;
  if (norm(x.name.zh).startsWith(nq) || norm(x.name.en).startsWith(nq)) return 1;
  if (name.includes(nq)) return 2;
  if (toks.length > 1 && toks.every(t => all.includes(t))) return 3;
  if (toks.some(t => t.length >= 2 && name.includes(t))) return 4;
  // 中文：最少有兩個連住嘅字吻合
  for (let i = 0; i + 2 <= nq.length; i++) if (/[^\x00-\x7f]/.test(nq[i]) && name.includes(nq.slice(i, i + 2))) return 5;
  return 9;
}
// 村屋地址：大家慣咗講「一區」，政府地址庫用「第一區」
const normAddr = q => q.replace(/([村圍])([一二三四五六七八九十]+區)/g, (m, a, b) => a + '第' + b);
// 合併、排次序（每個來源返嚟就可以即刻用，唔使等齊兩個）
function rankPlaces(q, osm, als){
  const addrLike = /\d|號|街|道|路|里|徑/.test(q);
  const raw = [...osm, ...als].map(x => ({...x, ms: matchScore(x, q) + (x.road ? 1.5 : 0) + (x.src === (addrLike ? 'osm' : 'als') ? 0.3 : 0)}));
  // 有門牌號碼：號碼完全一樣排先，號碼唔同嘅標明「最接近」
  const nq = norm(q), m = /(\d+[a-z]?|[a-z])(號|座|期|樓)?$/.exec(nq);
  if (m && /\d|座|期|樓/.test(m[0])) {
    const num = m[1], unit = m[2] || (/\d/.test(num) ? '號' : '座');
    const inRange = x => unit === '號' && x.no && x.noTo && +num >= +x.no && +num <= +x.noTo;
    for (const x of raw) {
      const txt = norm(x.name.zh) + '|' + norm(x.sub?.zh) + '|' + norm(x.name.en);
      const hit = new RegExp(`(^|[^0-9a-z])${num}${unit}`).test(txt) || inRange(x) || (unit === '號' && x.no === num);
      if (hit) x.ms -= 2; else if (x.whole) x.ms += 1; else if (x.src === 'als') x.near = true;
    }
  }
  const ranked = raw.filter(x => x.ms < 9).sort((x, y) => x.ms - y.ms || (S.here ? dist(S.here, x) - dist(S.here, y) : 0));
  const out = [];
  for (const x of ranked) if (!out.some(y => norm(y.name.zh) === norm(x.name.zh) && dist(x, y) < 400)) out.push(x);   // 醫院、體育園呢類大地方，兩個來源嘅點可以相距幾百米
  for (const x of out) if (x.near) x.sub = {zh: '最接近嘅地址 · ' + (x.sub?.zh || ''), en: 'Closest address · ' + (x.sub?.en || '')};
  return out.slice(0, 8);
}
// onPart：任何一個來源返嚟就即刻顯示（手機網絡慢都唔會一直「搵緊」）
export async function searchPlaces(q, onPart){
  q = q.trim(); if (q.length < 2) return {list: [], failed: false};
  const qa = normAddr(q);
  let osm = [], als = [], fails = 0;
  const stat = {als: '…', osm: '…'};
  const why = e => e?.name === 'AbortError' ? L('逾時', 'timeout') : e?.message && /^\d+$/.test(e.message) ? 'HTTP ' + e.message : L('連唔到', 'unreachable');
  // 地址搵唔到完全吻合：再搵條村／條街本身，起碼可以揀到附近（例如「掃管笏村」）
  const base = /\d/.test(qa) ? qa.replace(/第?[一二三四五六七八九十]*區?\s*\d+[A-Za-z]?\s*號?\s*$/, '').replace(/\d+[A-Za-z]?\s*號?\s*$/, '').trim() : '';
  const alsAll = async () => {
    const main = await alsSearch(qa);
    if (base && base.length >= 2 && base !== qa) { try { const b = (await alsSearch(base)).slice(0, 1).map(x => ({...x, whole: true, name: {zh: base, en: x.name.en}, sub: {zh: L('成條村／成條街（大概位置）', 'Whole village / street (approx.)'), en: 'Whole village / street (approx.)'}})); main.push(...b); } catch {} }
    return main;
  };
  const step = () => onPart?.(rankPlaces(q, osm, als));
  await Promise.all([
    alsAll().then(r => { als = r; stat.als = r.length; step(); }, e => { fails++; stat.als = why(e); }),
    osmSearch(q).then(r => { osm = r; stat.osm = r.length; step(); }, e => { fails++; stat.osm = why(e); })
  ]);
  return {list: rankPlaces(q, osm, als), failed: fails === 2, stat};
}
// 鍵盤彈出時嘅可見範圍：俾彈出面板、建議清單跟住縮細，唔會俾鍵盤遮住
if (window.visualViewport) {
  const vvSet = () => { const v = window.visualViewport, st = document.documentElement.style; st.setProperty('--vvh', v.height + 'px'); st.setProperty('--vvt', v.offsetTop + 'px'); };
  visualViewport.addEventListener('resize', vvSet); visualViewport.addEventListener('scroll', vvSet); vvSet();
}
// 一個全域監聽：撳出面就收埋所有建議清單（唔會每個搜尋框加一個）
document.addEventListener('click', e => {
  for (const b of document.querySelectorAll('.results.on')) if (!b.parentElement.contains(e.target)) b.classList.remove('on');
});
// 搜尋框 + 建議清單；onPick({lat,lng,label,kind})
export function attachPicker(input, box, onPick, opt = {}){
  let tq, seq = 0, list = [], placesFailed = false, pickWhenReady = false, composing = false, lastStat = null, loadingPlaces = false;
  const draw = (alias, stops, plc, loading) => {
    const extra = [];
    if (opt.here && S.here) extra.push({kind: 'here', name: S.here.mode === 'manual' ? {zh: `目前地點：${S.here.label}`, en: `Current: ${S.here.label}`} : {zh: '你嘅位置（GPS）', en: 'Your location (GPS)'}, lat: S.here.lat, lng: S.here.lng});
    if (opt.saved) {
      if (places.home) extra.push({kind: 'saved', name: {zh: '屋企', en: 'Home'}, ...places.home});
      if (places.work) extra.push({kind: 'saved', name: {zh: '學校／公司', en: 'School / Work'}, ...places.work});
      for (const c of places.custom || []) extra.push({kind: 'saved', name: {zh: c.label, en: c.label}, ...c});
    }
    const q = input.value.trim();
    const savedHit = q ? extra.filter(x => x.kind === 'saved' && nm(x.name).toLowerCase().includes(q.toLowerCase())) : extra;
    // 次序：常用叫法 → 港鐵／輕鐵站同名稱完全啱嘅車站 → 常用地點 → 地方（大廈）→ 其他車站
    const top = stops.filter(x => x.rail || x.score === 0), rest = stops.filter(x => !(x.rail || x.score === 0));
    // 地點吻合程度好（名完全一樣或者開頭一樣）就排喺車站前面，例如打「黃大仙祠」先出個廟，唔係出巴士站
    // 港鐵／輕鐵站名完全一樣永遠排先（可以直接規劃），之後先到吻合嘅地點、巴士站
    const strong = plc.filter(x => x.ms <= 1), weak = plc.filter(x => x.ms > 1);
    const rail = top.filter(x => x.rail && x.score === 0), top2 = top.filter(x => !rail.includes(x));
    list = [...alias, ...rail, ...strong, ...top2, ...savedHit, ...weak, ...rest].slice(0, 14);
    // 搜尋狀態（地址庫／地標各搵到幾多）：搵唔到地點或者有來源出錯先顯示
    const statLine = !loading && lastStat && opt.places && (!plc.length || typeof lastStat.als !== 'number' || typeof lastStat.osm !== 'number')
      ? `<div class="stat">${L('地址庫', 'Addresses')}：${esc(String(lastStat.als))} · ${L('地標', 'Landmarks')}：${esc(String(lastStat.osm))}</div>` : '';
    if (!list.length && !loading) {
      box.innerHTML = q ? `<div class="empty"><b>${L(`搵唔到「${esc(q)}」`, `No results for “${esc(q)}”`)}</b><small>${placesFailed ? L('連唔到地點搜尋，請檢查網絡再試。', 'Place search is unreachable — check your connection.') : L('試下：大廈或屋苑名、街道同門牌（例如「彌敦道 700號」）、商場或者港鐵站名。', 'Try a building or estate name, a street and number, a mall or an MTR station.')}</small></div>${statLine}` : '';
      box.classList.toggle('on', !!q); return;
    }
    box.innerHTML = list.map((x, i) => `<button type="button" role="option" data-i="${i}">
      <span class="k k-${x.kind}">${x.kind === 'place' ? icon.pin : x.kind === 'here' ? icon.gps : x.kind === 'saved' ? icon.star(true) : x.kind === 'alias' ? (x.station ? icon.rail : icon.landmark) : icon.bus}</span>
      <span class="nm">${esc(nm(x.name))}${x.sub ? `<small>${esc(nm(x.sub))}</small>` : ''}</span>
      ${x.cos ? [...x.cos].slice(0, 2).map(coTag).join(' ') : ''}</button>`).join('') + (loading ? `<div class="empty">${L('搵緊地方…', 'Searching places…')}</div>` : statLine);
    box.classList.add('on');
  };
  // 中文輸入法（倉頡、速成、拼音、手寫）揀緊字時唔好搜尋半成品，揀完先搜
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; run(); });
  input.addEventListener('input', e => { if (e.isComposing || composing) return; run(); });
  function run(){
    clearTimeout(tq); pickWhenReady = false; lastStat = null;
    const q = input.value, my = ++seq, al = aliasOf(q);
    const alias = al?.code && S.DB.stopList[al.code] ? [{kind: 'alias', station: true, name: {zh: al.zh, en: al.en}, sub: {zh: '港鐵站', en: 'MTR station'}, ...S.DB.stopList[al.code].location}]
      : al?.pt ? [{kind: 'alias', name: {zh: al.zh, en: al.en}, sub: {zh: '地標', en: 'Landmark'}, lat: al.pt[0], lng: al.pt[1]}] : [];
    const stops = searchStops(al?.q || q, 10);
    const wantPlaces = opt.places && (al?.q || q).trim().length >= 2;
    loadingPlaces = wantPlaces;
    draw(alias, stops, [], wantPlaces);
    placesFailed = false;
    if (wantPlaces) tq = setTimeout(async () => {
      const p = await searchPlaces(al?.q || q, part => { if (my === seq && part.length) draw(alias, stops, part, true); });
      if (my !== seq) return; placesFailed = p.failed; lastStat = p.stat; loadingPlaces = false; draw(alias, stops, p.list, false);
      if (pickWhenReady) { pickWhenReady = false; const b = [...box.querySelectorAll('button[data-i]')].find(b => list[+b.dataset.i]?.kind === 'place') || box.querySelector('button[data-i]'); b?.click(); }
    }, 300);
  }
  let picked = false;
  input.addEventListener('focus', () => {
    picked = false; if (!input.value) draw([], [], [], false); else input.select?.();
    // 手機：鍵盤彈出後將搜尋框推上去，下面有位顯示結果
    setTimeout(() => { const vv = window.visualViewport; if (vv && vv.height < innerHeight * 0.8 && !input.closest('.sheet')) input.scrollIntoView({block: 'start', behavior: 'smooth'}); }, 350);
  });
  // 打咗字但冇揀建議就離開：還原返而家用緊嘅地點名，免得畫面顯示 A、實際計緊 B
  if (opt.current) input.addEventListener('blur', () => setTimeout(() => {
    if (picked || document.activeElement === input) return;
    const cur = opt.current() || '', typed = input.value.trim();
    if (typed !== cur) { input.value = cur; if (typed) toast(L('請喺建議清單揀一個地點', 'Pick a place from the suggestions')); }
    box.classList.remove('on');
  }, 300));
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') box.classList.remove('on');
    if (e.key !== 'Enter' || e.isComposing) return;              // 中文輸入法揀字嗰下唔當確認
    e.preventDefault();
    // 撳鍵盤「搜尋」時地點仲搵緊：等結果返嚟先揀第一個地點，唔好即刻揀咗個唔相關嘅巴士站（iPhone 用家好慣撳呢個掣）
    if (composing) return;
    if (loadingPlaces) { pickWhenReady = true; return; }
    box.querySelector('button[data-i]')?.click();
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const x = list[+b.dataset.i];
    picked = true;
    box.classList.remove('on'); input.value = opt.keep ? nm(x.name) : ''; input.blur();
    // 車站（包括「港大」呢類港鐵站叫法）唔使計落樓等𨋢
    onPick({lat: x.lat, lng: x.lng, label: nm(x.name), name: x.name, kind: x.kind, noDoor: x.kind === 'stop' || !!x.station || !!x.outdoor});
  });
}
