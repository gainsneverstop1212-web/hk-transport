// 港住走 · 附近車站
import {S, $, esc, destHtml, store, L, nm, dist, stopsWithin, walkMin, doorMin, mins, hhmm, flaps, routeTiles, lineTiles, lrtTiles, tilesFor, routeLabel, lineName, lineColor, coTag, coName,
  stopLoc, stopName, bearing, compass, icon, FERRY, toast, now, nextDepAfter} from './core.js';
import {cycle, etaFor, mtrBoard, lrtBoard} from './eta.js';
import {on, setHere, startGps, stopGps, gpsOn, attachPicker, starBtn, toggleFav, isFav, openSheet, closeSheet} from './ui.js';
import {makeMap, pin, youIcon} from './map.js';
import {openRoute} from './route.js';
import {startTrip} from './trip.js';

const RADII = ['auto', 30, 100, 300, 500];
let maxGroups = 14;
const PRESETS = [['HUH', '紅磡', 'Hung Hom'], ['MOK', '旺角', 'Mong Kok'], ['CEN', '中環', 'Central'], ['CAB', '銅鑼灣', 'Causeway Bay'], ['SHT', '沙田', 'Sha Tin'], ['TUM', '屯門', 'Tuen Mun'], ['TUC', '東涌', 'Tung Chung']];
let hiddenN = 0, lastView = '', groups = [], effR = 30, note = '', lastFetch = 0, cyc = 0, mode = store.get('nearMode', 'list'), map = null, rowsById = new Map(), panned = false, viewAt = null, viewR = null;

export function initNearby(){
  const v = $('v-near');
  v.innerHTML = `
  <section class="where"><div class="wrap">
    <div class="loc">
      <div class="loc-txt"><div class="lbl">${L('你而家喺', 'You are at')}</div><p class="loc-name" id="locName">${L('未定位', 'No location')}</p><p class="loc-sub" id="locSub">${L('撳「定位」用你嘅位置，或者揀一個地點', 'Tap Locate, or pick a place')}</p></div>
      <button class="btn-y" id="gpsBtn" type="button" aria-label="${L('定位', 'Locate')}">${icon.gps}<span>${L('定位', 'Locate')}</span></button>
    </div>
    <div class="srow">
      <div class="search">${icon.search}<input id="nq" type="search" placeholder="${L('搜尋車站或地方', 'Search a stop or place')}" autocomplete="off" enterkeyhint="search" aria-label="${L('搜尋車站或地方，例如：理工大學', 'Search a stop or place')}"><div class="results" id="nres" role="listbox"></div></div>
      <div class="seg icons" id="modeSeg" role="group" aria-label="${L('顯示方式', 'View')}">
        <button type="button" data-m="list" aria-label="${L('列表', 'List')}"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13" stroke="currentColor" stroke-width="2.4"/><circle cx="4" cy="6" r="1.7" fill="currentColor"/><circle cx="4" cy="12" r="1.7" fill="currentColor"/><circle cx="4" cy="18" r="1.7" fill="currentColor"/></svg></button><button type="button" data-m="map" aria-label="${L('地圖', 'Map')}"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/></svg></button>
      </div>
    </div>
    <div class="chips" id="chips"></div>
  </div></section>
  <div class="wrap"><div id="nstatus"></div><div id="nmap" class="bigmap" hidden></div><div id="board" class="board"></div></div>`;

  $('gpsBtn').onclick = startGps;
  attachPicker($('nq'), $('nres'), p => { stopGps(); setHere({...p, mode: 'manual'}); }, {places: true, saved: true});
  $('chips').innerHTML = PRESETS.filter(([c]) => S.DB.stopList[c]).map(([c, zh, en]) => `<button class="chip" type="button" data-c="${c}">${L(zh, en)}</button>`).join('');
  $('chips').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; const s = stopLoc(b.dataset.c); stopGps(); setHere({lat: s.lat, lng: s.lng, label: b.textContent + L('站', ' Stn'), mode: 'manual'}); };
  // 範圍揀選放咗入狀態列（省位）；用事件委派，因為狀態列會重畫
  $('nstatus').addEventListener('change', e => { if (e.target.id !== 'rad') return; S.set.radius = e.target.value === 'auto' ? 'auto' : +e.target.value; store.set('settings', S.set); makeGroups(); });
  $('nstatus').addEventListener('click', e => {
    const b = e.target.closest('[data-fix]'); if (!b) return;
    if (b.dataset.fix === 'map') { mode = 'map'; store.set('nearMode', mode); paintCtrl(); render(); toast(L('喺地圖撳一下你所在嘅位置', 'Tap where you are on the map')); }
    else { $('nq').focus(); }
  });
  $('modeSeg').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m; store.set('nearMode', mode); paintCtrl(); render(); };
  $('board').addEventListener('click', e => { if (e.target.closest('#moreStops')) { maxGroups += 14; makeGroups(); return; } onBoardClick(e); });
  $('board').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-row]')) { e.preventDefault(); onBoardClick(e); } });
  paintCtrl();

  on('here', p => { maxGroups = 14; paintLoc(); makeGroups(); });
  on('acc', paintLoc);
  on('gps', st => {
    $('gpsBtn').toggleAttribute('aria-busy', st === 'busy' || (st === 'rough' && S.here?.mode !== 'gps'));
    if (st === 'outside') { $('locName').textContent = L('你而家唔喺香港', 'You are outside Hong Kong'); $('locSub').textContent = L('可以搜尋或者揀一個地點試用', 'Search or pick a place to try'); }
    if (st === 'denied') toast(L('你冇俾定位權限，可以用搜尋或者揀地點。', 'Location permission denied — search or pick a place.'));
    if (st === 'error') toast(L('暫時攞唔到位置', 'Could not get location'));
    if ((st === 'rough' || st === 'busy') && S.here?.mode !== 'gps') { $('locSub').textContent = st === 'rough' ? L('定位緊，等 GPS 收到衛星（行近窗口會快啲）…', 'Locating — waiting for GPS (near a window helps)…') : L('定位緊…', 'Locating…'); }
  });
  on('favs', () => render());
  on('tab', t => { if (t === 'near') { refresh(); if (mode === 'map') render(); } else document.body.classList.remove('mapmode'); });
  setInterval(() => { if (!$('v-near').hidden) refresh(); }, 5000);
  setInterval(() => { if (!$('v-near').hidden && groups.length && !document.hidden) render(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  paintLoc(); render();
}

function paintCtrl(){
  for (const b of $('modeSeg').children) b.setAttribute('aria-pressed', String(mode === b.dataset.m));
}
function paintLoc(){
  const h = S.here;
  $('chips').hidden = !!h;                       // 定咗位就收埋預設地點，畫面騰出位畀到站板
  $('v-near').classList.toggle('located', !!h);
  if (!h) return;
  $('locName').textContent = h.label;
  $('locSub').textContent = h.mode === 'gps' ? L(`GPS 定位 · 誤差約 ±${Math.round(h.acc || 0)} 米`, `GPS · ±${Math.round(h.acc || 0)} m`) : L('手動揀選 · 撳「定位」改用你嘅位置', 'Picked manually · tap Locate for GPS');
  for (const b of $('chips').children) b.setAttribute('aria-pressed', String(h.mode === 'manual' && h.label === b.textContent + L('站', ' Stn')));
}

/* ---------- 分組 ---------- */
// 車站行車方向：用之後兩三個站嘅位置計（轉彎位都比較準）
const headCache = new Map();
function stopHeading(id){
  if (headCache.has(id)) return headCache.get(id);
  const a = stopLoc(id); let h = null;
  for (const e of S.IDX.get(id) || []) {
    if (e.co === 'mtr' || e.co === 'lightRail') continue;
    const st = S.DB.routeList[e.key].stops[e.co];
    for (let k = e.seq + 1; k < Math.min(st.length, e.seq + 4); k++) { const b = stopLoc(st[k]); if (a && b && dist(a, b) > 120) { h = bearing(a, b); break; } }
    if (h == null && e.seq + 1 < st.length) { const b = stopLoc(st[e.seq + 1]); if (a && b && dist(a, b) > 20) h = bearing(a, b); }
    if (h != null) break;
  }
  headCache.set(id, h); return h;
}
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
function makeGroups(){
  if (!S.here) return;
  const want = S.set.radius;
  let near = [], ladder = want === 'auto' ? [30, 100, 300] : RADII.filter(r => r !== 'auto' && r >= want);
  note = ''; hiddenN = 0;
  for (const r of ladder) {
    near = stopsWithin(S.here, r); effR = r;
    const named = new Set(near.map(s => S.DB.stopList[s.id].name.zh));
    if (want === 'auto' ? named.size >= 3 : near.length) break;
  }
  if (want === 'auto' && effR > 30) note = L(`30 米內唔夠車站，已擴大到 ${effR} 米`, `Few stops within 30 m — widened to ${effR} m`);
  if (want !== 'auto' && effR > want && near.length) note = L(`${want} 米內冇車站，已擴大到 ${effR} 米`, `No stops within ${want} m — widened to ${effR} m`);
  const gs = [];
  for (const s of near) {
    const st = S.DB.stopList[s.id], ents = S.IDX.get(s.id) || [];
    const rail = ents.some(e => e.co === 'mtr' || e.co === 'lightRail');
    const h = rail ? null : stopHeading(s.id);
    // 同名車站：30 米內，或者 100 米內而且同一個行車方向，先當係同一個站（對面馬路會分開）
    let g = gs.find(x => x.name.zh === st.name.zh && (dist(x.loc, st.location) < 30 && (h == null || x.h0 == null || angDiff(h, x.h0) < 100) || dist(x.loc, st.location) < 100 && h != null && x.h0 != null && angDiff(h, x.h0) < 45));
    if (!g) { if (gs.length >= maxGroups && !rail) { hiddenN++; continue; } g = {name: st.name, loc: st.location, d: s.d, stops: [], rows: new Map(), dyn: [], loaded: false, rail: false, h0: h}; gs.push(g); }
    g.stops.push(s.id); if (rail) g.rail = true;
  }
  for (const g of gs) {
    g.walk = walkMin(g.d); g.cos = new Set(); g.heading = g.h0;
    for (const id of g.stops) for (const e of S.IDX.get(id) || []) {
      const r = S.DB.routeList[e.key], st = r.stops[e.co];
      g.cos.add(e.co);
      if (e.co === 'mtr' || e.co === 'lightRail') continue;
      if (e.seq === st.length - 1) continue;
      // 同一條路線、同一個目的地合併成一行：資料入面城巴每個班次變化（+1、+2…）同大細楷唔同都係獨立 key，
      // 但到站時間一樣，唔合併就會見到兩行一模一樣；特別班嘅班次會一齊顯示
      const rk = r.route + '|' + (r.dest?.zh || '').replace(/\s+/g, '');
      let row = g.rows.get(rk);
      if (!row) { row = {kind: 'bus', key: e.key, co: e.co, cos: new Set(), route: r.route, dest: r.dest, etas: [], note: '', srcs: []}; g.rows.set(rk, row); }
      row.cos.add(e.co);
      if (!row.srcs.some(x => x.co === e.co && x.stop === id)) row.srcs.push({co: e.co, stop: id, seq: e.seq, key: e.key});
    }
  }
  groups = gs; lastFetch = 0;
  render(); refresh(true);
}

async function loadGroup(g, memo){
  const jobs = [];
  for (const row of g.rows.values()) jobs.push(Promise.all(row.srcs.map(s => etaFor(memo, s.co, S.DB.routeList[s.key || row.key], s.stop, s.seq))).then(res => {
    const ok = res.filter(x => !x.err);
    if (!ok.length && row.etas.length) { row.stale = true; return; }      // 離線：保留上次資料
    row.stale = false; row.err = !ok.length;
    row.etas = ok.flatMap(x => x.list).sort((a, b) => a.t - b.t).filter((e, i, a) => !i || e.t - a[i - 1].t > 45000);
    row.note = ok.map(x => x.note).find(Boolean) || '';
    // 冇實時班次（例如半夜）：按時間表講下一班幾點，清楚標明係時間表
    if (!row.etas.length && ok.length) {
      const r = S.DB.routeList[row.key], s0 = row.srcs[0], t = nextDepAfter(r, s0.co, s0.seq, now());
      if (t && t - now() < 90 * 60000) row.etas = [{t, sched: true, tt: true}];
      else if (t && t - now() < 16 * 3600e3) row.note = L(`下一班 ${hhmm(t)}（時間表）`, `Next ${hhmm(t)} (timetable)`);
    }
  }));
  const dyn = [];
  for (const id of g.stops) {
    const ents = S.IDX.get(id) || [];
    const lines = [...new Set(ents.filter(e => e.co === 'mtr').map(e => S.DB.routeList[e.key].route))];
    if (lines.length) jobs.push(mtrBoard(memo, id, lines).then(r => dyn.push(...r)));
    if (ents.some(e => e.co === 'lightRail')) jobs.push(lrtBoard(memo, id).then(r => dyn.push(...r)));
  }
  await Promise.allSettled(jobs);
  if (!(dyn.every(x => x.err) && g.dyn.length)) g.dyn = dyn;
  g.loaded = true;
}
async function refresh(force){
  if (!groups.length || document.hidden || $('v-near').hidden) return;
  if (!force && Date.now() - lastFetch < 29000) return;
  lastFetch = Date.now();
  const my = ++cyc, memo = cycle();
  await Promise.all(groups.map(g => loadGroup(g, memo).then(() => { if (my === cyc) render(); })));
}

/* ---------- 顯示 ---------- */
const live = r => r.etas.filter(e => mins(e.t) >= 0);
function etaCell(row, key){
  const list = live(row);
  if (!list.length) return `<span class="none">${esc(row.err ? L('暫時攞唔到資料', 'Unavailable') : row.note || L('暫無班次', 'No service'))}</span>`;
  const m = mins(list[0].t), sch = list[0].sched ? ' sched' : '';
  const big = m <= 0 ? `<div class="big now${sch}">${flaps(L('即將', 'Now'), key)}</div>`
    : m >= 60 ? `<div class="big far${sch}">${flaps(hhmm(list[0].t), key)}</div>`
    : `<div class="big${sch}">${flaps(String(m).padStart(2, '0'), key)}<span class="u">${L('分', 'min')}</span></div>`;
  const nx = list.slice(1, 3);
  let small = '';
  if (list[0].tt) small = L('按時間表估計', 'Timetable estimate');
  else if (list[0].sched) small = L('時間表班次', 'Scheduled');
  else if (m >= 60) small = L('下一班', 'Next');
  else if (nx.length) small = L('之後 ', 'then ') + nx.map(e => mins(e.t) >= 60 ? hhmm(e.t) : mins(e.t) <= 0 ? L('即將', 'now') : mins(e.t)).join(' · ') + (mins(nx[nx.length - 1].t) < 60 ? L(' 分', ' min') : '');
  return big + (small ? `<small>${esc(small)}</small>` : '');
}
function advice(row, walk){
  walk += doorMin(S.here);                       // 落樓 + 等𨋢
  const list = live(row);
  if (!list.length || mins(list[0].t) >= 60) return '';
  const ok = list.find(e => mins(e.t) >= walk);
  if (!ok) return `<span class="adv late">${L(`出門要 ${walk} 分鐘，趕唔切`, `${walk} min to get there — can't make it`)}</span>`;
  const left = mins(ok.t) - walk;
  const txt = left <= 0 ? L('而家出門', 'Leave now') : L(`${left} 分鐘後出門`, `leave in ${left} min`);
  return `<span class="adv go">${ok !== list[0] ? L('呢班趕唔切，搭下一班：', 'Missed this one · next: ') : ''}${txt}</span>`;
}
function rowHtml(g, row){
  let rt, sub, fid, label;
  if (row.kind === 'mtr') {
    rt = lineTiles(row.line);
    sub = `<span class="co"><i style="--c:${lineColor(row.line)}"></i>${esc(lineName(row.line))}</span>${row.plat ? ' · ' + L(`${esc(row.plat)} 號月台`, `Platform ${esc(row.plat)}`) : ''}`;
    fid = row.key; label = lineName(row.line);
  } else if (row.kind === 'lrt') {
    rt = row.route ? lrtTiles(row.route) : routeTiles(L('輕鐵', 'LR'), 'r' + g.name.zh + row.key);
    sub = coTag('lightRail') + (row.plat ? ' · ' + L(`${esc(row.plat)} 號月台`, `Platform ${esc(row.plat)}`) : '');
    fid = row.key; label = row.route;
  } else {
    rt = tilesFor(S.DB.routeList[row.key], 'r' + g.name.zh + row.key);
    sub = [...row.cos].map(coTag).join(' + ');
    fid = row.key + '@' + row.srcs[0].stop; label = routeLabel(S.DB.routeList[row.key]);
  }
  rowsById.set(fid, {g, row});
  const dest = row.kind === 'mtr' ? (row.dest ? stopName(row.dest) : lineName(row.line)) : nm(row.dest) || L('輕鐵', 'Light Rail');
  const l0 = live(row)[0], m0 = l0 ? mins(l0.t) : null;
  const etaTxt = l0 ? (m0 <= 0 ? L('即將到站', 'arriving now') : m0 >= 60 ? L(`${hhmm(l0.t)} 到`, `due ${hhmm(l0.t)}`) : L(`${m0} 分鐘後到`, `in ${m0} minutes`)) : (row.note || L('暫無班次', 'no service'));
  return `<div class="row${isFav(fid) ? ' fav' : ''}${row.stale ? ' stale' : ''}" data-row="${esc(fid)}" tabindex="0" role="button" aria-label="${esc(label + ' ' + L('往', 'to') + ' ' + dest + '，' + etaTxt)}">
    ${rt}<div class="dst"><b>${L('往', 'To')} ${destHtml(dest)}</b><small>${sub}</small>${advice(row, g.walk)}</div>
    <div class="eta">${etaCell(row, 'e' + fid)}</div>${starBtn(fid, label + ' ' + dest)}</div>`;
}
function groupHtml(g, i){
  const all = [...g.rows.values(), ...g.dyn];
  const has = r => live(r).length > 0;
  const fid = r => r.kind === 'bus' ? r.key + '@' + r.srcs[0].stop : r.key;
  const next = r => live(r)[0]?.t ?? Infinity;
  // 固定次序（唔再按到站時間排）：每次更新唔會跳位，撳緊都唔會撳錯
  const kindOrd = r => r.kind === 'mtr' ? 0 : r.kind === 'lrt' ? 1 : 2;
  const destOf = r => r.kind === 'mtr' ? (r.dest || '') : nm(r.dest) || '';
  all.sort((a, b) => (isFav(fid(b)) - isFav(fid(a))) || (kindOrd(a) - kindOrd(b)) || String(a.route || a.line || '').localeCompare(String(b.route || b.line || ''), 'en', {numeric: true}) || destOf(a).localeCompare(destOf(b), 'zh-HK'));
  const lv = all.filter(r => has(r) || isFav(fid(r))), idle = all.filter(r => !has(r) && !isFav(fid(r)));
  const dm = Math.round(g.d);
  const head = `<div class="stop-h"><span class="num">${i + 1}</span><div class="stop-t"><h2>${esc(nm(g.name))}</h2><p>${[...g.cos].map(coTag).join(' ')}${g.heading != null ? ` <span class="dir">${icon.arrow(g.heading)}${L(`往${compass(g.heading)}行`, `heading ${compass(g.heading)}`)}</span>` : ''}</p></div>
    <div class="dist"><strong>${dm}<span>${L(' 米', ' m')}</span></strong><span>${L(`步行約 ${g.walk} 分鐘`, `${g.walk} min walk`)}</span></div></div>`;
  if (g.loaded && !lv.length) {
    return `<details class="stop compact"><summary>${head}<p class="idle-line">${L(`暫時冇班次 · ${all.length} 條路線`, `No departures now · ${all.length} routes`)} ▾</p></summary>${idle.map(r => rowHtml(g, r)).join('')}</details>`;
  }
  const body = !g.loaded ? '<div class="skel"></div><div class="skel"></div>'
    : lv.map(r => rowHtml(g, r)).join('') + (idle.length ? `<details class="more"><summary>${L(`另外 ${idle.length} 條路線暫無班次`, `${idle.length} more routes with no departures`)}</summary>${idle.map(r => rowHtml(g, r)).join('')}</details>` : '');
  return `<section class="stop" id="g${i}" aria-label="${esc(nm(g.name))}">${head}<div class="cols" aria-hidden="true"><span>${L('路線', 'Route')}</span><span>${L('目的地', 'Destination')}</span><span>${L('到站', 'Due')}</span><span></span></div>${body}</section>`;
}
export function render(){
  const st = $('nstatus'), bd = $('board');
  if (!st) return;
  if (!S.here) {
    st.innerHTML = '';
    bd.innerHTML = `<div class="hero"><div class="bigflap" aria-hidden="true">${flaps(L('揀地點', 'PICK'))}</div><h1>${L('附近有咩車，幾耐到？', 'What’s nearby, and when?')}</h1><p>${L('撳「定位」用你而家嘅位置，或者搜尋車站、地方，或者揀一個常用地點。', 'Tap Locate, search a stop or place, or pick a preset.')}</p></div>`;
    return;
  }
  const ae = document.activeElement, focusKey = bd.contains(ae) ? (ae.dataset.fav ? 'f:' + ae.dataset.fav : ae.dataset.row ? 'r:' + ae.dataset.row : '') : '';
  const open = new Set([...bd.querySelectorAll('details[open]')].map(d => d.closest('[aria-label]')?.getAttribute('aria-label') + (d.classList.contains('compact') ? '#c' : '')));
  rowsById = new Map();
  const n = groups.length;
  const radSel = `<label class="rad"><span class="sr">${L('範圍', 'Radius')}</span><select id="rad">${RADII.map(r => `<option value="${r}"${String(S.set.radius) === String(r) ? ' selected' : ''}>${r === 'auto' ? L('自動範圍', 'Auto') : r + L(' 米', ' m')}</option>`).join('')}</select></label>`;
  let h = `<div class="status"><div class="st-l"><b>${n ? L(`${effR} 米內 ${n} 個站`, `${n} stops · ${effR} m`) : L(`${effR} 米內冇車站`, `No stops within ${effR} m`)}</b><span>${lastFetch ? (S.online ? L('更新 ', 'Updated ') + hhmm(lastFetch) + L(' · 每 30 秒', ' · every 30 s') : L('離線 · 顯示 ', 'Offline · ') + (S.lastOk ? hhmm(S.lastOk) : '') + L(' 嘅資料', ' data')) : ''}</span></div>${radSel}</div>`;
  if (note) h = h.replace('<span>', `<span class="wide">${esc(note)}</span><span>`);
  if (S.here.mode === 'gps' && S.here.acc > 50) h += `<div class="notice gpsn"><p>${L(`定位誤差 ±${Math.round(S.here.acc)} 米，車站可能唔準`, `Accuracy ±${Math.round(S.here.acc)} m — stops may be off`)}${S.here.acc > 800 ? `<br><small>${L('誤差咁大，多數係手機冇開「精確位置」：iPhone 去 設定 → 私隱與保安 → 定位服務 → Safari 網站 → 開「精確位置」；Android 去 設定 → 位置 → 開「Google 定位準確度」。', 'This usually means Precise Location is off: iPhone Settings → Privacy & Security → Location Services → Safari Websites → Precise Location.')}</small>` : ''}</p><div><button class="btn-d sm" data-fix="map" type="button">${L('地圖揀位置', 'Pick on map')}</button><button class="btn-d sm" data-fix="search" type="button">${L('搜尋', 'Search')}</button></div></div>`;
  if (groups.some(g => [...g.rows.values()].some(r => live(r)[0]?.sched))) h += `<p class="legend"><span class="lg-s">05</span>${L('灰色數字 = 時間表班次，唔係實時位置', 'Grey digits = timetable, not live')}</p>`;
  if (document.activeElement?.id !== 'rad') st.innerHTML = h;     // 用家揀緊範圍就唔好重畫
  $('nmap').hidden = mode !== 'map';
  // 地圖模式：收埋下面嘅車站列表（撳圖釘先跳去列表），地圖填滿畫面，唔使喺地圖上面碌頁面
  bd.hidden = mode === 'map'; document.body.classList.toggle('mapmode', mode === 'map');
  if (mode === 'map') drawMap();
  bd.innerHTML = n ? groups.map(groupHtml).join('') + (hiddenN ? `<button class="btn-d big" id="moreStops" type="button">${L(`仲有 ${hiddenN} 個車站，顯示更多`, `${hiddenN} more stops — show more`)}</button>` : '') : `<div class="hero"><h1>${L('附近冇車站', 'No stops nearby')}</h1><p>${L('試下揀大啲嘅範圍，或者搜尋另一個地方。', 'Try a larger radius or another place.')}</p></div>`;
  if (focusKey) { const el = focusKey.startsWith('f:') ? bd.querySelector(`[data-fav="${CSS.escape(focusKey.slice(2))}"]`) : bd.querySelector(`[data-row="${CSS.escape(focusKey.slice(2))}"]`); el?.focus({preventScroll: true}); }
  for (const d of bd.querySelectorAll('details')) if (open.has(d.closest('[aria-label]')?.getAttribute('aria-label') + (d.classList.contains('compact') ? '#c' : ''))) d.open = true;
}

// 同一時間只畫一次：之前兩次重畫撞埋，第二次會刪咗第一個地圖，第一次再加掣就出錯，成個地圖變「載入唔到」
let mapBusy = false, mapAgain = false;
async function drawMap(){
  if (mapBusy) { mapAgain = true; return; }
  mapBusy = true;
  try { await drawMapOnce(); } finally { mapBusy = false; if (mapAgain) { mapAgain = false; drawMap(); } }
}
async function drawMapOnce(){
  const el = $('nmap');
  // 地圖高度 = 畫面剩低嘅位（扣除上面嘅控制同底部選單）
  const absTop = el.getBoundingClientRect().top + scrollY, tabsH = $('tabs').offsetHeight || 64;
  el.style.height = Math.max(300, Math.round((window.visualViewport?.height || innerHeight) - absTop - tabsH - 12)) + 'px';
  try {
    if (!map || !el._map) {
      map = await makeMap(el, S.here, 17); lastView = ''; panned = false;
      map.on('dragstart zoomstart', e => { if (!map._auto) panned = true; });
      // 「回到我嘅位置」掣
      const Back = window.L.Control.extend({options: {position: 'bottomright'}, onAdd(){
        const b = window.L.DomUtil.create('button', 'map-me');
        b.type = 'button'; b.setAttribute('aria-label', L('回到我嘅位置', 'Back to my location')); b.innerHTML = icon.gps;
        window.L.DomEvent.disableClickPropagation(b);
        b.onclick = () => { panned = false; lastView = ''; drawMap(); };
        return b; }});
      new Back().addTo(map);
    }
    map.invalidateSize();
    // 用家自己拖過或者縮放過地圖：位置有少少跳動唔好扯返轉頭（以前一隻手指拖兩下就俾佢彈返）
    const vk = S.here.lat.toFixed(5) + S.here.lng.toFixed(5) + effR;
    const far = viewAt && dist(viewAt, S.here) > 300;
    if (vk !== lastView && (!panned || far || viewR !== effR)) {
      lastView = vk; viewAt = {lat: S.here.lat, lng: S.here.lng}; viewR = effR; panned = false;
      map._auto = true; map.setView([S.here.lat, S.here.lng], effR <= 100 ? 18 : effR <= 300 ? 17 : 16); map._auto = false;
    }
    const Lf = window.L;
    map.eachLayer(l => { if (l._hk) map.removeLayer(l); });
    const add = l => { l._hk = 1; l.addTo(map); return l; };
    add(Lf.circle([S.here.lat, S.here.lng], {radius: effR, color: '#ffc917', weight: 1.5, fillOpacity: .06}));
    if (S.here.mode === 'gps' && S.here.acc > 15) add(Lf.circle([S.here.lat, S.here.lng], {radius: S.here.acc, color: '#3aa0ff', weight: 1, dashArray: '4 4', fillOpacity: .05, interactive: false}));
    if (!map._tapSet) {
      map._tapSet = true;
      // 撳地圖：彈出「設為我嘅位置」，唔會一撳就改，免得拖地圖時誤觸
      map.on('click', ev => {
        const pp = Lf.popup({closeButton: false, className: 'setpop'}).setLatLng(ev.latlng)
          .setContent(`<button type="button" class="btn-y sm">${L('設為我嘅位置', 'I’m here')}</button>`).openOn(map);
        pp.getElement()?.querySelector('button')?.addEventListener('click', () => { map.closePopup(); stopGps(); setHere({lat: ev.latlng.lat, lng: ev.latlng.lng, label: L('地圖上揀嘅位置', 'Point on map'), mode: 'manual'}); });
      });
    }
    add(Lf.marker([S.here.lat, S.here.lng], {icon: youIcon(), interactive: false}));
    groups.forEach((g, i) => add(Lf.marker([g.loc.lat, g.loc.lng], {icon: pin(String(i + 1), g.rail ? 'rail' : '')}).on('click', () => {
      mode = 'list'; store.set('nearMode', mode); paintCtrl(); render();
      setTimeout(() => document.getElementById('g' + i)?.scrollIntoView({behavior: 'smooth', block: 'start'}), 50);
    })));
  } catch (e) { console.error('drawMap', e); el.innerHTML = `<p class="loading">${L('地圖載入唔到（可能冇網絡）', 'Map unavailable (offline?)')}</p>`; }
}

/* ---------- 撳一行 ---------- */
function onBoardClick(e){
  const fb = e.target.closest('[data-fav]');
  if (fb) {
    e.stopPropagation();
    const id = fb.dataset.fav, x = rowsById.get(id);
    if (!x) return;
    const {row} = x;
    const desc = row.kind === 'bus' ? {kind: 'bus', key: row.key, co: row.srcs[0].co, stop: row.srcs[0].stop, seq: row.srcs[0].seq}
      : row.kind === 'mtr' ? {kind: 'mtr', line: row.line, sta: row.sta, dir: row.dir, dest: row.dest} : {kind: 'lrt', stop: x.g.stops[0], route: row.route, dest: row.dest};
    toggleFav(id, desc);
    return;
  }
  const r = e.target.closest('[data-row]');
  if (!r) return;
  const x = rowsById.get(r.dataset.row);
  if (!x) return;
  if (x.row.kind === 'bus') { rowSheet(x.g, x.row.key, x.row.srcs[0], [...x.row.cos], live(x.row), x.row.note); return; }
  const src = railEntry(x.g, x.row);
  if (!src) { toast(L('暫時搵唔到呢班車嘅路線資料', 'Route details unavailable')); return; }
  rowSheet(x.g, src.key, src, [src.co], live(x.row), x.row.note);
}
// 港鐵／輕鐵行：搵返對應嘅路線（綫、方向、目的地）
function railEntry(g, row){
  for (const id of g.stops) for (const e of S.IDX.get(id) || []) {
    const r = S.DB.routeList[e.key], st = r.stops[e.co];
    if (row.kind === 'mtr' && e.co === 'mtr' && r.route === row.line && e.seq < st.length - 1) {
      if (row.dir && !(r.bound.mtr || '').startsWith(row.dir === 'UP' ? 'U' : 'D')) continue;
      if (row.dest && !st.slice(e.seq + 1).includes(row.dest)) continue;
      return {key: e.key, co: 'mtr', stop: id, seq: e.seq};
    }
    if (row.kind === 'lrt' && e.co === 'lightRail' && r.route === row.route && e.seq < st.length - 1 && (!row.dest || r.dest.zh === row.dest.zh)) return {key: e.key, co: 'lightRail', stop: id, seq: e.seq};
  }
  return null;
}
function rowSheet(g, key, s, cos, list, note){
  const r = S.DB.routeList[key], st = r.stops[s.co], row = {route: r.route, key};
  const opts = st.slice(s.seq + 1).map((id, k) => `<option value="${s.seq + 1 + k}">${esc(stopName(id))}</option>`).join('');
  openSheet(`<div class="sh-head">${tilesFor(r)}<div><b>${L('往', 'To')} ${esc(nm(r.dest))}</b><small>${esc(nm(g.name))} · ${cos.map(coName).join(' + ')}</small></div></div>
    <div class="sh-etas">${list.length ? list.slice(0, 3).map(e => `<span class="${e.sched ? 'sched' : ''}"><b>${mins(e.t) <= 0 ? L('即將', 'now') : mins(e.t) >= 60 ? hhmm(e.t) : mins(e.t) + L(' 分', ' min')}</b><small>${hhmm(e.t)}</small></span>`).join('') : `<span class="none">${esc(note || L('暫無班次', 'No service'))}</span>`}</div>
    <label class="fld"><span>${L('喺邊個站落車？（可以唔揀）', 'Get off at (optional)')}</span><select id="alight"><option value="">${L('未決定', 'Not sure yet')}</option>${opts}</select></label>
    <div class="sh-btns"><button class="btn-y big" id="goTrip" type="button">${icon.door}<span>${L('出門倒數', 'Leave countdown')}</span></button>
    <button class="btn-d big" id="seeRoute" type="button">${icon.bus}<span>${L('睇成條路線', 'Whole route')}</span></button></div>`, card => {
    card.querySelector('#seeRoute').onclick = () => closeSheet(() => openRoute(key, s.stop));
    card.querySelector('#goTrip').onclick = () => {
      const a = card.querySelector('#alight').value;
      closeSheet(() => startTrip({from: S.here ? {lat: S.here.lat, lng: S.here.lng, label: S.here.label} : null, walk0: g.walk + doorMin(S.here), door: doorMin(S.here),
        legs: [{key, co: s.co, board: s.stop, bseq: s.seq, alight: a ? st[+a] : null, aseq: a ? +a : null}], walkEnd: 0,
        to: a ? {label: stopName(st[+a]), ...stopLoc(st[+a])} : null}));
    };
  });
}
