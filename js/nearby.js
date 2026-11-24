// 港途 · 附近車站
import {S, $, esc, store, L, nm, dist, stopsWithin, walkMin, mins, hhmm, flaps, routeTiles, lineTiles, lineName, lineColor, coTag, coName,
  stopLoc, stopName, bearing, compass, icon, FERRY, toast} from './core.js';
import {cycle, etaFor, mtrBoard, lrtBoard} from './eta.js';
import {on, setHere, startGps, stopGps, gpsOn, attachPicker, starBtn, toggleFav, isFav, openSheet, closeSheet} from './ui.js';
import {makeMap, pin, youIcon} from './map.js';
import {openRoute} from './route.js';
import {startTrip} from './trip.js';

const RADII = ['auto', 30, 100, 300, 500];
const MAX_GROUPS = 14;
const PRESETS = [['HUH', '紅磡', 'Hung Hom'], ['MOK', '旺角', 'Mong Kok'], ['CEN', '中環', 'Central'], ['CAB', '銅鑼灣', 'Causeway Bay'], ['SHT', '沙田', 'Sha Tin'], ['TUM', '屯門', 'Tuen Mun'], ['TUC', '東涌', 'Tung Chung']];
let groups = [], effR = 30, note = '', lastFetch = 0, cyc = 0, mode = store.get('nearMode', 'list'), map = null, rowsById = new Map();

export function initNearby(){
  const v = $('v-near');
  v.innerHTML = `
  <section class="where"><div class="wrap">
    <div class="loc">
      <div class="loc-txt"><div class="lbl">${L('你而家喺', 'You are at')}</div><p class="loc-name" id="locName">${L('未定位', 'No location')}</p><p class="loc-sub" id="locSub">${L('撳「定位」用你嘅位置，或者揀一個地點', 'Tap Locate, or pick a place')}</p></div>
      <button class="btn-y" id="gpsBtn" type="button">${icon.gps}<span>${L('定位', 'Locate')}</span></button>
    </div>
    <div class="search">${icon.search}<input id="nq" type="search" placeholder="${L('搜尋車站或地方，例如：理工大學', 'Search a stop or place')}" autocomplete="off" enterkeyhint="search" aria-label="${L('搜尋', 'Search')}"><div class="results" id="nres" role="listbox"></div></div>
    <div class="chips" id="chips"></div>
    <div class="ctrl-row">
      <div class="seg" id="seg" role="group" aria-label="${L('範圍', 'Radius')}"></div>
      <div class="seg" id="modeSeg" role="group" aria-label="${L('顯示方式', 'View')}">
        <button type="button" data-m="list">${L('列表', 'List')}</button><button type="button" data-m="map">${L('地圖', 'Map')}</button>
      </div>
    </div>
  </div></section>
  <div class="wrap"><div id="nstatus"></div><div id="nmap" class="bigmap" hidden></div><div id="board" class="board"></div></div>`;

  $('gpsBtn').onclick = startGps;
  attachPicker($('nq'), $('nres'), p => { stopGps(); setHere({...p, mode: 'manual'}); }, {places: true, saved: true});
  $('chips').innerHTML = PRESETS.filter(([c]) => S.DB.stopList[c]).map(([c, zh, en]) => `<button class="chip" type="button" data-c="${c}">${L(zh, en)}</button>`).join('');
  $('chips').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; const s = stopLoc(b.dataset.c); stopGps(); setHere({lat: s.lat, lng: s.lng, label: b.textContent + L('站', ' Stn'), mode: 'manual'}); };
  $('seg').innerHTML = RADII.map(r => `<button type="button" data-r="${r}">${r === 'auto' ? L('自動', 'Auto') : r + L(' 米', 'm')}</button>`).join('');
  $('seg').onclick = e => { const b = e.target.closest('[data-r]'); if (!b) return; S.set.radius = b.dataset.r === 'auto' ? 'auto' : +b.dataset.r; store.set('settings', S.set); paintCtrl(); makeGroups(); };
  $('modeSeg').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m; store.set('nearMode', mode); paintCtrl(); render(); };
  $('board').addEventListener('click', onBoardClick);
  paintCtrl();

  on('here', p => { paintLoc(); makeGroups(); });
  on('acc', paintLoc);
  on('gps', st => {
    $('gpsBtn').toggleAttribute('aria-busy', st === 'busy');
    if (st === 'outside') { $('locName').textContent = L('你而家唔喺香港', 'You are outside Hong Kong'); $('locSub').textContent = L('可以搜尋或者揀一個地點試用', 'Search or pick a place to try'); }
    if (st === 'denied') toast(L('你冇俾定位權限，可以用搜尋或者揀地點。', 'Location permission denied — search or pick a place.'));
    if (st === 'error') toast(L('暫時攞唔到位置', 'Could not get location'));
  });
  on('favs', () => render());
  on('tab', t => { if (t === 'near') { refresh(); if (mode === 'map') render(); } });
  setInterval(() => { if (!$('v-near').hidden) refresh(); }, 5000);
  setInterval(() => { if (!$('v-near').hidden && groups.length && !document.hidden) render(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  paintLoc(); render();
}

function paintCtrl(){
  for (const b of $('seg').children) b.setAttribute('aria-pressed', String(String(S.set.radius) === b.dataset.r));
  for (const b of $('modeSeg').children) b.setAttribute('aria-pressed', String(mode === b.dataset.m));
}
function paintLoc(){
  const h = S.here;
  if (!h) return;
  $('locName').textContent = h.label;
  $('locSub').textContent = h.mode === 'gps' ? L(`你嘅位置 · 誤差約 ±${Math.round(h.acc || 0)} 米`, `GPS · ±${Math.round(h.acc || 0)} m`) : L('手動揀選 · 撳「定位」改用你嘅位置', 'Picked manually · tap Locate for GPS');
  for (const b of $('chips').children) b.setAttribute('aria-pressed', String(h.mode === 'manual' && h.label === b.textContent + L('站', ' Stn')));
}

/* ---------- 分組 ---------- */
function makeGroups(){
  if (!S.here) return;
  const want = S.set.radius;
  let near = [], ladder = want === 'auto' ? [30, 100, 300] : RADII.filter(r => r !== 'auto' && r >= want);
  note = '';
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
    let g = gs.find(x => x.name.zh === st.name.zh && dist(x.loc, st.location) < 30);
    if (!g) { if (gs.length >= MAX_GROUPS && !rail) continue; g = {name: st.name, loc: st.location, d: s.d, stops: [], rows: new Map(), dyn: [], loaded: false, rail: false}; gs.push(g); }
    g.stops.push(s.id); if (rail) g.rail = true;
  }
  for (const g of gs) {
    g.walk = walkMin(g.d); g.cos = new Set(); g.heading = null;
    for (const id of g.stops) for (const e of S.IDX.get(id) || []) {
      const r = S.DB.routeList[e.key], st = r.stops[e.co];
      g.cos.add(e.co);
      if (e.co === 'mtr' || e.co === 'lightRail') continue;
      if (e.seq === st.length - 1) continue;
      if (g.heading == null) { const a = stopLoc(id), b = stopLoc(st[e.seq + 1]); if (a && b && dist(a, b) > 30) g.heading = bearing(a, b); }
      let row = g.rows.get(e.key);
      if (!row) { row = {kind: 'bus', key: e.key, co: e.co, cos: new Set(), route: r.route, dest: r.dest, etas: [], note: '', srcs: []}; g.rows.set(e.key, row); }
      row.cos.add(e.co);
      if (!row.srcs.some(x => x.co === e.co && x.stop === id)) row.srcs.push({co: e.co, stop: id, seq: e.seq});
    }
  }
  groups = gs; lastFetch = 0;
  render(); refresh(true);
}

async function loadGroup(g, memo){
  const jobs = [];
  for (const row of g.rows.values()) jobs.push(Promise.all(row.srcs.map(s => etaFor(memo, s.co, S.DB.routeList[row.key], s.stop, s.seq))).then(res => {
    const ok = res.filter(x => !x.err);
    if (!ok.length && row.etas.length) { row.stale = true; return; }      // 離線：保留上次資料
    row.stale = false; row.err = !ok.length;
    row.etas = ok.flatMap(x => x.list).sort((a, b) => a.t - b.t).filter((e, i, a) => !i || e.t - a[i - 1].t > 45000);
    row.note = ok.map(x => x.note).find(Boolean) || '';
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
  if (list[0].sched) small = L('時間表班次', 'Scheduled');
  else if (m >= 60) small = L('下一班', 'Next');
  else if (nx.length) small = L('之後 ', 'then ') + nx.map(e => mins(e.t) >= 60 ? hhmm(e.t) : mins(e.t) <= 0 ? L('即將', 'now') : mins(e.t)).join(' · ') + (mins(nx[nx.length - 1].t) < 60 ? L(' 分', ' min') : '');
  return big + (small ? `<small>${esc(small)}</small>` : '');
}
function advice(row, walk){
  const list = live(row);
  if (!list.length || mins(list[0].t) >= 60) return '';
  const ok = list.find(e => mins(e.t) >= walk);
  if (!ok) return `<span class="adv late">${L(`步行 ${walk} 分鐘，趕唔切`, `${walk} min walk — can't make it`)}</span>`;
  const left = mins(ok.t) - walk;
  const txt = left <= 0 ? L('而家出發', 'Leave now') : L(`${left} 分鐘後出發`, `Leave in ${left} min`);
  return `<span class="adv go">${ok !== list[0] ? L('下一班：', 'Next: ') : ''}${txt}</span>`;
}
function rowHtml(g, row){
  let rt, sub, fid, label;
  if (row.kind === 'mtr') {
    rt = lineTiles(row.line);
    sub = `<span class="co"><i style="--c:${lineColor(row.line)}"></i>${esc(lineName(row.line))}</span>${row.plat ? ' · ' + L(`${esc(row.plat)} 號月台`, `Platform ${esc(row.plat)}`) : ''}`;
    fid = row.key; label = lineName(row.line);
  } else if (row.kind === 'lrt') {
    rt = routeTiles(row.route || L('輕鐵', 'LR'), 'r' + g.name.zh + row.key);
    sub = coTag('lightRail') + (row.plat ? ' · ' + L(`${esc(row.plat)} 號月台`, `Platform ${esc(row.plat)}`) : '');
    fid = row.key; label = row.route;
  } else {
    rt = routeTiles(row.route, 'r' + g.name.zh + row.key);
    sub = [...row.cos].map(coTag).join(' + ');
    fid = row.key + '@' + row.srcs[0].stop; label = row.route;
  }
  rowsById.set(fid, {g, row});
  const dest = row.kind === 'mtr' ? (row.dest ? stopName(row.dest) : lineName(row.line)) : nm(row.dest) || L('輕鐵', 'Light Rail');
  return `<div class="row${isFav(fid) ? ' fav' : ''}${row.stale ? ' stale' : ''}" data-row="${esc(fid)}" tabindex="0" role="button" aria-label="${esc(label + ' ' + L('往', 'to') + ' ' + dest)}">
    ${rt}<div class="dst"><b>${L('往', 'To')} ${esc(dest)}</b><small>${sub}</small>${advice(row, g.walk)}</div>
    <div class="eta">${etaCell(row, 'e' + fid)}</div>${starBtn(fid, label + ' ' + dest)}</div>`;
}
function groupHtml(g, i){
  const all = [...g.rows.values(), ...g.dyn];
  const has = r => live(r).length > 0;
  const fid = r => r.kind === 'bus' ? r.key + '@' + r.srcs[0].stop : r.key;
  const next = r => live(r)[0]?.t ?? Infinity;
  all.sort((a, b) => (isFav(fid(b)) - isFav(fid(a))) || (next(a) - next(b)) || String(a.route || a.line).localeCompare(String(b.route || b.line), 'zh-HK', {numeric: true}));
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
  const open = new Set([...bd.querySelectorAll('details[open]')].map(d => d.closest('[aria-label]')?.getAttribute('aria-label') + (d.classList.contains('compact') ? '#c' : '')));
  rowsById = new Map();
  const n = groups.length;
  let h = `<div class="status"><b>${n ? L(`${effR} 米內有 ${n} 個車站`, `${n} stops within ${effR} m`) : L(`${effR} 米內搵唔到車站`, `No stops within ${effR} m`)}</b><span>${lastFetch ? (S.online ? L('更新於 ', 'Updated ') + hhmm(lastFetch) + ' · ' + L('每 30 秒自動更新', 'auto every 30 s') : L('離線 · 顯示 ', 'Offline · showing ') + (S.lastOk ? hhmm(S.lastOk) : '') + L(' 嘅資料', ' data')) : ''}</span></div>`;
  if (note) h += `<p class="notice">${esc(note)}</p>`;
  if (S.here.mode === 'gps' && S.here.acc > 50) h += `<p class="notice">${L(`GPS 誤差約 ±${Math.round(S.here.acc)} 米，附近車站可能唔準。`, `GPS accuracy ±${Math.round(S.here.acc)} m — nearby stops may be off.`)}</p>`;
  st.innerHTML = h;
  $('nmap').hidden = mode !== 'map';
  if (mode === 'map') drawMap();
  bd.innerHTML = n ? groups.map(groupHtml).join('') : `<div class="hero"><h1>${L('附近冇車站', 'No stops nearby')}</h1><p>${L('試下揀大啲嘅範圍，或者搜尋另一個地方。', 'Try a larger radius or another place.')}</p></div>`;
  for (const d of bd.querySelectorAll('details')) if (open.has(d.closest('[aria-label]')?.getAttribute('aria-label') + (d.classList.contains('compact') ? '#c' : ''))) d.open = true;
}

async function drawMap(){
  const el = $('nmap');
  try {
    if (!map || !el._map) map = await makeMap(el, S.here, effR > 100 ? 16 : 17);
    const Lf = window.L;
    map.eachLayer(l => { if (l._hk) map.removeLayer(l); });
    const add = l => { l._hk = 1; l.addTo(map); return l; };
    add(Lf.circle([S.here.lat, S.here.lng], {radius: effR, color: '#ffc917', weight: 1.5, fillOpacity: .06}));
    add(Lf.marker([S.here.lat, S.here.lng], {icon: youIcon(), interactive: false}));
    groups.forEach((g, i) => add(Lf.marker([g.loc.lat, g.loc.lng], {icon: pin(String(i + 1), g.rail ? 'rail' : '')}).on('click', () => {
      mode = 'list'; store.set('nearMode', mode); paintCtrl(); render();
      setTimeout(() => document.getElementById('g' + i)?.scrollIntoView({behavior: 'smooth', block: 'start'}), 50);
    })));
    map.setView([S.here.lat, S.here.lng], map.getZoom());
  } catch { el.innerHTML = `<p class="loading">${L('地圖載入唔到（可能冇網絡）', 'Map unavailable (offline?)')}</p>`; }
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
  if (!x || x.row.kind !== 'bus') { if (x) toast(L('港鐵同輕鐵請用「規劃」頁計路線', 'Use the Plan tab for MTR / Light Rail trips')); return; }
  rowSheet(x.g, x.row);
}
function rowSheet(g, row){
  const s = row.srcs[0], r = S.DB.routeList[row.key], st = r.stops[s.co];
  const opts = st.slice(s.seq + 1).map((id, k) => `<option value="${s.seq + 1 + k}">${esc(stopName(id))}</option>`).join('');
  const list = live(row);
  openSheet(`<div class="sh-head">${routeTiles(row.route)}<div><b>${L('往', 'To')} ${esc(nm(r.dest))}</b><small>${esc(nm(g.name))} · ${[...row.cos].map(coName).join(' + ')}</small></div></div>
    <div class="sh-etas">${list.length ? list.slice(0, 3).map(e => `<span class="${e.sched ? 'sched' : ''}"><b>${mins(e.t) <= 0 ? L('即將', 'now') : mins(e.t) >= 60 ? hhmm(e.t) : mins(e.t) + L(' 分', ' min')}</b><small>${hhmm(e.t)}</small></span>`).join('') : `<span class="none">${esc(row.note || L('暫無班次', 'No service'))}</span>`}</div>
    <label class="fld"><span>${L('喺邊個站落車？（可以唔揀）', 'Get off at (optional)')}</span><select id="alight"><option value="">${L('未決定', 'Not sure yet')}</option>${opts}</select></label>
    <div class="sh-btns"><button class="btn-y big" id="goTrip" type="button">${icon.door}<span>${L('出門倒數', 'Leave countdown')}</span></button>
    <button class="btn-d big" id="seeRoute" type="button">${icon.bus}<span>${L('睇成條路線', 'Whole route')}</span></button></div>`, card => {
    card.querySelector('#seeRoute').onclick = () => { closeSheet(); setTimeout(() => openRoute(row.key, s.stop), 30); };
    card.querySelector('#goTrip').onclick = () => {
      const a = card.querySelector('#alight').value;
      closeSheet();
      startTrip({from: S.here ? {lat: S.here.lat, lng: S.here.lng, label: S.here.label} : null, walk0: g.walk,
        legs: [{key: row.key, co: s.co, board: s.stop, bseq: s.seq, alight: a ? st[+a] : null, aseq: a ? +a : null}], walkEnd: 0,
        to: a ? {label: stopName(st[+a]), ...stopLoc(st[+a])} : null});
    };
  });
}
