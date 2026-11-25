// 港住走 · 路線搜尋 + 路線詳情
import {S, $, esc, store, L, nm, doorMin, mins, hhmm, flaps, routeTiles, lineTiles, lrtTiles, lrtColor, tilesFor, LINES, coTag, coName, lineName, lineColor, darkText, stopLoc, stopName,
  dist, walkMin, serviceInfo, rideMin, cumTimes, fareAt, legFare, money, FERRY, icon, toast, stopsWithin} from './core.js';
import {cycle, etaFor, mtrBoard, lrtBoard} from './eta.js';
import {openPage, starBtn, toggleFav, isFav, on, openSheet, closeSheet, addLayer, back} from './ui.js';
import {makeMap, pin, youIcon} from './map.js';
import {startTrip} from './trip.js';

const FILTERS = [['all', '全部', 'All', null], ['bus', '巴士', 'Bus', ['kmb', 'ctb', 'nlb', 'lrtfeeder']], ['gmb', '小巴', 'Minibus', ['gmb']],
  ['mtr', '港鐵', 'MTR', ['mtr']], ['lrt', '輕鐵', 'Light Rail', ['lightRail']], ['ferry', '渡輪', 'Ferry', [...FERRY]]];
const PICK = new Set(['mtr', 'lrt', 'ferry']);              // 呢幾類直接揀路線，唔使打字
const TYPED = co => co !== 'mtr' && !FERRY.has(co);          // 鍵盤只搜尋巴士、小巴、輕鐵號碼
let q = '', filt = 'all';
const natural = (a, b) => a.localeCompare(b, 'en', {numeric: true});

export function initRoute(){
  const v = $('v-route');
  v.innerHTML = `<div class="wrap">
    <div class="chips" id="rFilt">${FILTERS.map(([k, zh, en]) => `<button class="chip" type="button" data-f="${k}">${L(zh, en)}</button>`).join('')}</div>
    <div class="rq" id="rq"><div class="rq-disp" id="rqDisp" aria-live="polite"></div><button class="btn-d sm rq-show" id="rqKb" type="button">${L('鍵盤', 'Keypad')}</button><button class="btn-d sm" id="rqClr" type="button">${L('清除', 'Clear')}</button></div>
    <div id="rList" class="rlist"></div></div>
    <div class="keypad" id="keypad" aria-label="${L('路線鍵盤', 'Route keypad')}"><div class="kp-num"></div><div class="kp-let"></div></div>`;
  $('rFilt').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; filt = b.dataset.f; draw(); window.scrollTo(0, 0); };
  $('rqClr').onclick = () => { q = ''; showKp(); draw(); };
  // 鍵盤收埋／再出現：碌落去睇長清單時唔好遮住一半畫面
  const showKp = () => v.classList.remove('kp-hide');
  $('rqKb').onclick = showKp; $('rqDisp').onclick = showKp;
  let lastY = 0;
  window.addEventListener('scroll', () => {
    if (v.hidden) return;
    const y = window.scrollY;
    if (y > 40 && y > lastY + 4) v.classList.add('kp-hide');
    else if (y < 12) showKp();
    lastY = y;
  }, {passive: true});
  $('keypad').onclick = e => {
    const b = e.target.closest('button[data-k]'); if (!b || b.disabled) return;
    const k = b.dataset.k;
    q = k === 'del' ? q.slice(0, -1) : (q + k).slice(0, 6);
    draw();
  };
  $('rList').onclick = e => {
    const j = e.target.closest('[data-jump]');
    if (j) { filt = j.dataset.jump; draw(); setTimeout(() => document.getElementById('ln-' + j.dataset.line)?.scrollIntoView({block: 'start', behavior: 'smooth'}), 40); return; }
    const ns = e.target.closest('[data-sta]');
    if (ns) { stationSheet(ns.dataset.sta, ns.dataset.co); return; }
    const b = e.target.closest('[data-key]'); if (b) openRoute(b.dataset.key);
  };
  draw();
}
const allowed = co => { const f = FILTERS.find(x => x[0] === filt)[3]; return !f || f.includes(co); };
const entriesOf = test => Object.entries(S.DB.routeList).filter(([, r]) => test(r));
// 同一條綫／路線嘅每個方向（相同起點終點只留一個，正常班次排先）
function directions(list){
  const m = new Map();
  for (const [k, r] of list.sort((a, b) => String(a[1].serviceType).localeCompare(String(b[1].serviceType)))) {
    const sig = r.orig.zh + '>' + r.dest.zh;
    if (!m.has(sig)) m.set(sig, [k, r]);
  }
  return [...m.values()];
}
const dirBtn = ([k, r]) => `<button class="dirb" type="button" data-key="${esc(k)}"><b>${L('往', 'To')} ${esc(nm(r.dest))}</b><small>${L('由 ', 'From ')}${esc(nm(r.orig))}${String(r.serviceType) !== '1' ? ' · ' + L('特別班', 'Special') : ''}</small></button>`;
/* ---------- 港鐵、輕鐵：彩色綫路卡 ---------- */
const mtrLinesAt = id => [...new Set((S.IDX.get(id) || []).filter(e => e.co === 'mtr').map(e => S.DB.routeList[e.key].route))];
const nearCo = (id, co, r = 260) => { const p = stopLoc(id); return p ? stopsWithin(p, r).filter(x => x.id !== id && (S.IDX.get(x.id) || []).some(e => e.co === co)) : []; };
// 轉乘標記：其他港鐵綫（同站）＋ 附近嘅輕鐵／港鐵站
function xferBadges(id, co, self){
  const out = [];
  if (co === 'mtr') {
    for (const c of mtrLinesAt(id)) if (c !== self) out.push(`<span class="xb" style="--c:${lineColor(c)}"${darkText(c) ? ' data-dark' : ''}>${esc(lineName(c).replace(/綫$/, ''))}</span>`);
    if (nearCo(id, 'lightRail').length) out.push(`<span class="xb lrb">${L('輕鐵', 'LR')}</span>`);
  } else if (co === 'lightRail') {
    const m = nearCo(id, 'mtr')[0];
    if (m) for (const c of mtrLinesAt(m.id)) out.push(`<span class="xb" style="--c:${lineColor(c)}"${darkText(c) ? ' data-dark' : ''}>${L('港鐵', 'MTR')} ${esc(lineName(c).replace(/綫$/, ''))}</span>`);
  }
  return out.join('');
}
const longest = list => list.reduce((a, b) => (b[1].stops[b[1].co[0]]?.length || 0) > (a[1].stops[a[1].co[0]]?.length || 0) ? b : a);
// 綫路縮圖：每個站一粒點，轉乘站用白圈
function strip(r, co){
  const st = r.stops[co] || [];
  const dots = st.map(id => { const x = co === 'mtr' ? mtrLinesAt(id).length > 1 || nearCo(id, 'lightRail').length : nearCo(id, 'mtr').length; return `<i class="${x ? 'x' : ''}" title="${esc(stopName(id))}"></i>`; }).join('');
  return `<div class="strip" aria-hidden="true"><div class="strip-d">${dots}</div><div class="strip-t"><span>${esc(stopName(st[0]))}</span><span>${esc(stopName(st[st.length - 1]))}</span></div></div>`;
}
const endMin = (r, co) => { const c = cumTimes(r, co); return Math.round(c[c.length - 1] || 0); };
// 同一個終點有幾個方向（例如東鐵由羅湖／落馬洲往金鐘）：加註起點
const dupDest = dirs => { const c = new Map(); for (const [, r] of dirs) c.set(nm(r.dest), (c.get(nm(r.dest)) || 0) + 1); return r => c.get(nm(r.dest)) > 1; };
const dirPill = (dup) => ([k, r]) => `<button class="dirp" type="button" data-key="${esc(k)}"><span class="dp-a" aria-hidden="true">→</span><span><b>${L('往', 'To')} ${esc(nm(r.dest))}</b>${dup(r) ? `<small class="from">${L('由 ', 'from ')}${esc(nm(r.orig))}</small>` : ''}${String(r.serviceType) !== '1' ? `<small>${L('特別班', 'Special')}</small>` : ''}</span></button>`;
function nearestRail(co){
  if (!S.here) return null;
  const n = stopsWithin(S.here, 3000).find(x => (S.IDX.get(x.id) || []).some(e => e.co === co));
  return n ? {...n, walk: walkMin(n.d)} : null;
}
function railHero(co){
  const n = nearestRail(co), lines = co === 'mtr' ? mtrLinesAt(n?.id) : [];
  const title = co === 'mtr' ? L(`港鐵 · ${Object.keys(LINES).filter(c => S.NUMS.has(c)).length} 條綫`, 'MTR lines') : L('輕鐵 · 屯門 · 元朗 · 天水圍', 'Light Rail · Tuen Mun · Yuen Long · Tin Shui Wai');
  return `<div class="rail-hero ${co === 'mtr' ? 'm' : 'l'}"><p class="rh-k">${co === 'mtr' ? 'MTR' : 'LIGHT RAIL'}</p><h2>${title}</h2>
    ${n ? `<button class="near-sta" type="button" data-sta="${esc(n.id)}" data-co="${co}">${icon.pin}<span><b>${L('最近你：', 'Nearest: ')}${esc(stopName(n.id))}${co === 'mtr' ? L('站', '') : ''}</b><small>${Math.round(n.d)} ${L('米 · 步行約', 'm · ~')}${n.walk}${L(' 分鐘', ' min walk')}</small></span><span class="ns-l">${lines.map(c => `<i style="--c:${lineColor(c)}"></i>`).join('')}</span></button>` : `<p class="rh-s">${L('撳一條綫，再揀方向', 'Pick a line, then a direction')}</p>`}</div>`;
}
function mtrPicker(){
  return railHero('mtr') + `<div class="lgrid">` + Object.keys(LINES).map(c => {
    const all = entriesOf(r => r.co[0] === 'mtr' && r.route === c), dirs = directions(all);
    if (!dirs.length) return '';
    const main = longest(dirs)[1], n = main.stops.mtr.length;
    const ends = [...new Set(dirs.map(([, r]) => nm(r.dest)))];
    return `<section class="lcard${darkText(c) ? ' dark' : ''}" id="ln-${c}" style="--c:${lineColor(c)}">
      <header><span class="lc-code">${esc(S.set.lang === 'en' ? c : LINES[c][0].replace(/綫$/, ''))}</span><div class="lc-t"><h3>${esc(lineName(c))}</h3><p>${ends.map(esc).join(' ⇄ ')}</p></div><span class="lc-n"><b>${n}</b>${L('站', ' stns')}<small>${L('全程約 ', '~')}${endMin(main, 'mtr')}${L(' 分鐘', ' min')}</small></span></header>
      ${strip(main, 'mtr')}
      <div class="lc-dirs">${dirs.map(dirPill(dupDest(dirs))).join('')}</div></section>`;
  }).join('') + `</div>`;
}
function lrtPicker(){
  const by = new Map();
  for (const e of entriesOf(r => r.co[0] === 'lightRail')) { const n = e[1].route.replace('*', ''); if (!by.has(n)) by.set(n, []); by.get(n).push(e); }
  return railHero('lightRail') + `<div class="lgrid two">` + [...by.keys()].sort(natural).map(n => {
    const dirs = directions(by.get(n)), main = longest(dirs)[1], st = main.stops.lightRail;
    const circ = dirs.length === 1 && dist(stopLoc(st[0]) || {lat: 0, lng: 0}, stopLoc(st[st.length - 1]) || {lat: 1, lng: 1}) < 400;
    return `<section class="lcard lr" id="ln-${esc(n)}" style="--c:${lrtColor(n)}">
      <header>${lrtTiles(n)}<div class="lc-t"><h3>${esc(nm(main.orig))} ${circ ? '↻' : '⇄'} ${esc(nm(circ ? main.stops && {zh: stopName(st[Math.floor(st.length / 2)]), en: stopName(st[Math.floor(st.length / 2)])} : main.dest))}</h3><p>${st.length} ${L('個站 · 約 ', 'stops · ~')}${endMin(main, 'lightRail')}${L(' 分鐘', ' min')}${circ ? L(' · 循環綫', ' · circular') : ''}</p></div></header>
      ${strip(main, 'lightRail')}
      <div class="lc-dirs">${dirs.map(dirPill(dupDest(dirs))).join('')}</div></section>`;
  }).join('') + `</div>`;
}
function ferryPicker(){
  const by = new Map();
  for (const e of entriesOf(r => FERRY.has(r.co[0]))) { const co = e[1].co[0]; if (!by.has(co)) by.set(co, []); by.get(co).push(e); }
  return [...by].map(([co, list]) => `<section class="linecard ferry"><header><span class="lc-bar" style="--c:${'#4aa3df'}"></span><h3>${esc(coName(co))}</h3></header><div class="dirs">${directions(list).map(dirBtn).join('')}</div></section>`).join('');
}
function railShortcuts(){
  const lrtN = [...new Set(entriesOf(r => r.co[0] === 'lightRail').map(([, r]) => r.route.replace('*', '')))].sort(natural);
  return `<p class="lbl pad">${L('港鐵', 'MTR')}</p><div class="linegrid">${Object.keys(LINES).filter(c => S.NUMS.has(c)).map(c => `<button type="button" class="lineb" data-jump="mtr" data-line="${c}" style="--c:${lineColor(c)}"><b>${esc(lineName(c))}</b></button>`).join('')}</div>
    <p class="lbl pad">${L('輕鐵', 'Light Rail')}</p><div class="linegrid lrt">${lrtN.map(n => `<button type="button" class="lineb lr" data-jump="lrt" data-line="${esc(n)}" style="--c:${lrtColor(n)}">${esc(n.replace('*', ''))}</button>`).join('')}</div>`;
}
function draw(){
  for (const b of $('rFilt').children) b.setAttribute('aria-pressed', String(b.dataset.f === filt));
  const picking = PICK.has(filt);
  $('v-route').classList.toggle('picking', picking);
  const list = $('rList');
  if (picking) {
    list.innerHTML = filt === 'mtr' ? mtrPicker() : filt === 'lrt' ? lrtPicker() : ferryPicker();
    return;
  }
  $('rqDisp').innerHTML = q ? flaps(q.padEnd(4, ' ')) : `<span class="ph">${L('輸入路線號碼', 'Type a route')}</span>`;
  const nexts = new Set(), keys = [];
  for (const [num, ks] of S.NUMS) {
    if (!num.toUpperCase().startsWith(q)) continue;
    const okKeys = ks.filter(k => S.DB.routeList[k].co.some(c => allowed(c) && TYPED(c)));
    if (!okKeys.length) continue;
    if (num.length > q.length) nexts.add(num[q.length].toUpperCase());
    if (q) keys.push(...okKeys);
  }
  const nums = '123456789'.split('');
  $('keypad').querySelector('.kp-num').innerHTML = [...nums, 'del', '0', 'go'].map(k => k === 'go' ? `<span></span>`
    : `<button type="button" data-k="${k}" ${k !== 'del' && !nexts.has(k) ? 'disabled' : ''} aria-label="${k === 'del' ? L('刪除', 'Delete') : k}">${k === 'del' ? '⌫' : k}</button>`).join('');
  const lets = [...nexts].filter(c => !/[0-9]/.test(c)).sort();
  const kl = $('keypad').querySelector('.kp-let');
  kl.innerHTML = lets.map(c => `<button type="button" data-k="${esc(c)}">${esc(c)}</button>`).join('');
  // 字母多過 4 行：每粒掣矮少少，全部字母同數字鍵一樣高、唔使喺鍵盤入面再碌先搵到（例如「X」）
  const rows = Math.ceil(lets.length / 3);
  kl.style.setProperty('--kh', rows > 4 ? Math.max(34, Math.floor((224 - (rows - 1) * 6) / rows)) + 'px' : '50px');
  if (!q) {
    const rec = store.get('recentRoutes', []).filter(k => S.DB.routeList[k]);
    list.innerHTML = (filt === 'all' ? railShortcuts() : '') + (rec.length ? `<p class="lbl pad">${L('最近睇過', 'Recent')}</p>` + rec.map(itemHtml).join('') : `<p class="hint">${L('用下面嘅鍵盤輸入巴士或者小巴號碼。只會亮起有路線嘅數字同字母。', 'Type a bus or minibus number below. Only keys that lead to a real route light up.')}</p>`);
    return;
  }
  // 次序：號碼完全一樣排先 → 號碼 → 專營巴士（九巴、城巴）先過小巴 → 正常班先過特別班
  const RANK = {kmb: 0, ctb: 0, nlb: 1, lrtfeeder: 1, gmb: 2}, rk = r => RANK[r.co[0]] ?? 3, ex = r => r.route.toUpperCase() === q ? 0 : 1;
  keys.sort((a, b) => { const A = S.DB.routeList[a], B = S.DB.routeList[b]; return ex(A) - ex(B) || natural(A.route, B.route) || rk(A) - rk(B) || String(A.serviceType).localeCompare(String(B.serviceType)); });
  list.innerHTML = keys.slice(0, 80).map(itemHtml).join('') || `<p class="hint">${L('冇呢條路線', 'No such route')}</p>`;
}
function itemHtml(k){
  const r = S.DB.routeList[k];
  const special = String(r.serviceType) !== '1' ? `<em>${L('特別班', 'Special')}</em>` : '';
  return `<button class="ritem" type="button" data-key="${esc(k)}">${tilesFor(r)}
    <span class="ri-t"><b>${L('往', 'To')} ${esc(nm(r.dest))}</b><small>${L('由 ', 'From ')}${esc(nm(r.orig))}</small></span>
    <span class="ri-c">${r.co.map(coTag).join(' ')}${special}</span></button>`;
}

/* ---------- 車站到站板（港鐵／輕鐵） ---------- */
function railKeyFor(id, co, row){
  for (const e of S.IDX.get(id) || []) {
    if (e.co !== co) continue;
    const r = S.DB.routeList[e.key], st = r.stops[co];
    if (e.seq >= st.length - 1) continue;
    if (co === 'mtr') { if (r.route !== row.line) continue; if (row.dir && !(r.bound.mtr || '').startsWith(row.dir === 'UP' ? 'U' : 'D')) continue; if (row.dest && !st.slice(e.seq + 1).includes(row.dest)) continue; }
    else { if (r.route.replace('*', '') !== String(row.route).replace('*', '')) continue; if (row.dest && r.dest.zh !== row.dest.zh && !st.slice(e.seq + 1).some(x => S.DB.stopList[x]?.name.zh === row.dest.zh)) continue; }
    return e.key;
  }
  return null;
}
export function stationSheet(id, co){
  const lines = co === 'mtr' ? mtrLinesAt(id) : [];
  openSheet(`<div class="sh-head sta"><span class="sta-dots">${co === 'mtr' ? lines.map(c => `<i style="--c:${lineColor(c)}"></i>`).join('') : `<i style="--c:${lrtColor('')}"></i>`}</span><div><b>${esc(stopName(id))}${co === 'mtr' ? L('站', ' Station') : ''}</b><small>${co === 'mtr' ? lines.map(lineName).map(esc).join(' · ') : L('輕鐵站', 'Light Rail stop')}</small></div></div>
    <div id="stBoard" class="sta-board"><div class="skel"></div><div class="skel"></div></div>`, async card => {
    const memo = cycle();
    const rows = co === 'mtr' ? await mtrBoard(memo, id, lines) : await lrtBoard(memo, id);
    const box = card.querySelector('#stBoard'); if (!box) return;
    box.innerHTML = rows.map((row, i) => {
      const l = row.etas.filter(e => mins(e.t) >= 0);
      const dest = co === 'mtr' ? (row.dest ? stopName(row.dest) : lineName(row.line)) : nm(row.dest);
      return `<button class="sta-row" type="button" data-i="${i}">${co === 'mtr' ? lineTiles(row.line) : row.route ? lrtTiles(row.route) : ''}
        <span class="sr-t"><b>${L('往', 'To')} ${esc(dest || '')}</b><small>${row.plat ? L(`${esc(row.plat)} 號月台`, `Platform ${esc(row.plat)}`) : esc(row.note || '')}</small></span>
        <span class="sr-e">${l.length ? l.slice(0, 3).map((e, k) => `<b class="${k ? 'n' : ''}">${mins(e.t) <= 0 ? L('即將', 'now') : mins(e.t)}</b>`).join('') + `<small>${L('分鐘', 'min')}</small>` : `<span class="none">${esc(row.note || (row.err ? L('暫時攞唔到', 'Unavailable') : L('暫無班次', 'No trains')))}</span>`}</span></button>`;
    }).join('') || `<p class="hint">${L('暫無資料', 'No data')}</p>`;
    box.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; const k = railKeyFor(id, co, rows[+b.dataset.i]); if (!k) { toast(L('搵唔到呢個方向嘅路線', 'Direction not found')); return; } closeSheet(() => openRoute(k, id)); };
  });
}

/* ---------- 對頭線：名稱寬鬆比較，唔啱就用頭尾站位置配對 ---------- */
const norm = s => String(s || '').replace(/[\s()（）,，.\-]/g, '').toLowerCase();
function findOpposite(key, r, co){
  const st = r.stops[co] || [], a0 = stopLoc(st[0]), a1 = stopLoc(st[st.length - 1]);
  let best = null, bestScore = Infinity;
  for (const [k, x] of Object.entries(S.DB.routeList)) {
    if (k === key || x.route !== r.route || x.co[0] !== r.co[0]) continue;
    const xs = x.stops[x.co[0]] || [];
    let score = String(x.serviceType) === String(r.serviceType) ? 0 : 50;
    if (norm(x.orig.zh) === norm(r.dest.zh) && norm(x.dest.zh) === norm(r.orig.zh)) score += 0;
    else {
      const b0 = stopLoc(xs[0]), b1 = stopLoc(xs[xs.length - 1]);
      if (!a0 || !a1 || !b0 || !b1) continue;
      const d = dist(b0, a1) + dist(b1, a0);
      if (d > 1200 || (dist(a0, a1) < 300 && dist(b0, b1) < 300)) continue;    // 循環線冇對頭
      if (r.bound[co] && x.bound[x.co[0]] === r.bound[co]) continue;
      score += 10 + d / 100;
    }
    if (score < bestScore) { bestScore = score; best = [k, x]; }
  }
  return best;
}

/* ---------- 路線詳情 ---------- */
export function openRoute(key, focusStop){
  const r = S.DB.routeList[key]; if (!r) return;
  const rec = store.get('recentRoutes', []).filter(x => x !== key); rec.unshift(key); store.set('recentRoutes', rec.slice(0, 12));
  const co = r.co.find(c => r.stops[c]?.length) || r.co[0], stops = r.stops[co];
  let sel = focusStop ? stops.indexOf(focusStop) : -1;
  if (sel < 0 && focusStop) for (const c of r.co) { const i = (r.stops[c] || []).indexOf(focusStop); if (i >= 0) sel = i; }
  if (sel < 0 && S.here) { let best = 1500; stops.forEach((id, i) => { const d = dist(S.here, stopLoc(id) || S.here); if (d < best && i < stops.length - 1) { best = d; sel = i; } }); }
  const nearest = sel;                         // 只係標示最近嘅站，唔會自動當上車站
  let board = null, alight = null, etas = null, timer = null, map = null, line = null;
  const si = serviceInfo(r), mtr = co === 'mtr', rail = mtr || co === 'lightRail';
  const col = mtr ? lineColor(r.route) : co === 'lightRail' ? lrtColor(r.route) : null, dark = mtr ? darkText(r.route) : co === 'lightRail' && ['615', '705', '614P', '614'].includes(r.route.replace('*', ''));
  const opp = findOpposite(key, r, co);
  // 港鐵／輕鐵：同一條綫嘅所有方向（支綫都計埋），做成方向切換
  const sibs = rail ? directions(entriesOf(x => x.co[0] === co && x.route.replace('*', '') === r.route.replace('*', ''))) : [];
  const nearestChip = sel >= 0 && S.here ? `<button class="chip" type="button" data-near>${icon.pin} ${L('最近你：', 'Nearest: ')}${esc(stopName(stops[sel]))}</button>` : '';
  const pg = openPage('route-page' + (rail ? ' railpg' : ''));
  if (col) pg.style.setProperty('--c', col);
  const title = rail ? (mtr ? lineName(r.route) : L(`輕鐵 ${r.route.replace('*', '')} 綫`, `Light Rail ${r.route.replace('*', '')}`)) : '';
  pg.innerHTML = `<header class="pg-h${rail ? ' rail' + (dark ? ' dark' : '') : ''}"><button class="icon-btn" data-back type="button" aria-label="${L('返回', 'Back')}">${icon.back}</button>
      ${tilesFor(r)}<div class="pg-t"><b>${rail ? esc(title) : `${L('往', 'To')} ${esc(nm(r.dest))}`}</b><small>${rail ? `${L('往', 'To')} ${esc(nm(r.dest))} · ${stops.length} ${L('個站', 'stops')}` : `${L('由 ', 'From ')}${esc(nm(r.orig))} · ${r.co.map(coName).join(' + ')}`}</small></div></header>
    ${rail ? `<div class="rail-band"><div class="wrap">
      <div class="rb-dirs" role="group" aria-label="${L('方向', 'Direction')}">${(() => { const dup = dupDest(sibs); return sibs.map(([k, x]) => `<button type="button" data-dir="${esc(k)}" aria-pressed="${k === key}"><small>${dup(x) ? L(`由 ${esc(nm(x.orig))} 往`, `From ${esc(nm(x.orig))} to`) : L('往', 'To')}</small>${esc(nm(x.dest))}</button>`).join(''); })()}</div>
      <div class="rb-facts"><span><b>${stops.length}</b>${L(' 個站', ' stops')}</span><span><b>${endMin(r, co)}</b>${L(' 分鐘全程', ' min end to end')}</span>${si ? `<span><b>${si.first}</b>${L(' 首班', ' first')}</span><span><b>${si.last}</b>${L(' 尾班', ' last')}</span>` : ''}${si?.hw ? `<span><b>${si.hw}</b>${L(' 分鐘一班', ' min apart')}</span>` : ''}</div>
    </div></div>` : ''}
    <div class="wrap">
      <div class="facts">
        ${!rail && opp ? `<button class="chip" type="button" data-opp="${esc(opp[0])}">⇄ ${L('對頭線', 'Reverse')}</button>` : ''}
        ${!rail && si ? `<span class="fact">${L('今日 ', 'Today ')}${si.first}–${si.overnight ? L('翌日 ', 'next day ') : ''}${si.last}</span>` : ''}
        ${!rail && si?.hw ? `<span class="fact">${L(`而家約 ${si.hw} 分鐘一班`, `Every ~${si.hw} min now`)}</span>` : ''}
        ${!rail && r.jt ? `<span class="fact">${L(`全程約 ${r.jt} 分鐘`, `~${r.jt} min end to end`)}</span>` : ''}
        ${String(r.serviceType) !== '1' ? `<span class="fact warn">${L('特別班次', 'Special service')}</span>` : ''}
        ${nearestChip}
        ${rail ? `<button class="chip" type="button" data-map aria-expanded="false">${L('地圖', 'Map')}</button>` : ''}
      </div>
      <div class="rmap" id="rmap" ${rail ? 'hidden' : ''}></div>
      <p class="lbl pad">${rail ? L('撳一個站睇下班車同車費；揀上車同落車站可以開始出門倒數', 'Tap a station for trains and fares; pick on and off to start a countdown') : L('撳一個站睇到站時間，揀上車同落車站就可以開始出門倒數', 'Tap a stop for arrivals; pick where you get on and off to start a countdown')}</p>
      <ol class="stops${rail ? ' rail' : ''}" id="stops"></ol>
    </div>
    <div class="tripbar" id="tripbar" hidden></div>`;
  pg.querySelector('[data-back]').onclick = () => pg.close();
  pg.querySelector('[data-opp]')?.addEventListener('click', e => { const k = e.currentTarget.dataset.opp; pg.close(); setTimeout(() => openRoute(k), 60); });
  pg.querySelector('.rb-dirs')?.addEventListener('click', e => {
    const b = e.target.closest('[data-dir]'); if (!b || b.dataset.dir === key) return;
    const id = sel >= 0 ? stops[sel] : null, nx = S.DB.routeList[b.dataset.dir], keep = id && nx.stops[co].includes(id) ? id : null;
    pg.close(); setTimeout(() => openRoute(b.dataset.dir, keep), 60);
  });
  pg.addEventListener('close', () => clearInterval(timer));
  pg.querySelector('[data-near]')?.addEventListener('click', () => pg.querySelector(`li[data-i="${nearest}"]`)?.scrollIntoView({block: 'center', behavior: 'smooth'}));
  pg.querySelector('[data-map]')?.addEventListener('click', e => { const m = pg.querySelector('#rmap'), b = e.currentTarget; m.hidden = !m.hidden; b.setAttribute('aria-pressed', String(!m.hidden)); b.setAttribute('aria-expanded', String(!m.hidden)); if (!m.hidden) initMap(); });

  const list = pg.querySelector('#stops');
  const cum = i => board != null && i > board ? Math.round(rideMin(r, co, board, i)) : null;
  // 港鐵／輕鐵車費：由上車站（未揀就用撳開咗嘅站）計去每個站
  const railFare = i => { const b = board ?? (sel >= 0 ? sel : null); return b != null && i > b ? legFare(r, co, b, i) : null; };
  const badges = new Map(); if (rail) stops.forEach(id => badges.set(id, xferBadges(id, co, r.route)));
  const other = id => { const n = S.DB.stopList[id]?.name; return n ? (S.set.lang === 'en' ? n.zh : (n.en ? n.en.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : '')) : ''; };
  function etaHtml(){
    if (etas == null) return `<span class="none">${L('載入中…', 'Loading…')}</span>`;
    const l = etas.list.filter(e => mins(e.t) >= 0).slice(0, rail ? 4 : 3);
    return l.map(e => `<span class="${e.sched ? 'sched' : ''}"><b>${mins(e.t) <= 0 ? L('即將', 'now') : mins(e.t) >= 60 ? hhmm(e.t) : mins(e.t) + L(' 分', ' min')}</b><small>${hhmm(e.t)}${e.plat ? ' · ' + L(`${esc(e.plat)}號月台`, `Plat ${esc(e.plat)}`) : ''}${e.sched ? ' · ' + L('時間表', 'sched.') : ''}</small></span>`).join('')
      || `<span class="none">${esc(etas.note || (etas.err ? L('暫時攞唔到資料', 'Unavailable') : L('暫無班次', 'No service')))}</span>`;
  }
  function paint(){
    list.innerHTML = stops.map((id, i) => {
      const f = rail ? railFare(i) : fareAt(r, i), c = cum(i), isSel = i === sel;
      const fid = key + '@' + id, bd = rail ? badges.get(id) : '';
      return `<li class="${isSel ? 'open' : ''}${i === board ? ' board' : ''}${i === alight ? ' alight' : ''}${bd ? ' xfer' : ''}${i === nearest && S.here ? ' near' : ''}" data-i="${i}">
        <button class="st-btn" type="button" aria-expanded="${isSel}"><span class="st-n">${rail ? '' : i + 1}</span><span class="st-name">${esc(stopName(id))}${rail && other(id) ? `<small class="st-en">${esc(other(id))}</small>` : ''}${bd ? `<span class="xbs">${bd}</span>` : ''}</span>
        <span class="st-m">${i === board ? `<em class="tag y">${L('上車', 'Board')}</em>` : i === alight ? `<em class="tag w">${L('落車', 'Alight')}</em>` : c != null ? `+${c}′` : i === nearest && S.here && rail ? `<em class="tag n">${L('最近', 'Near')}</em>` : ''}${f != null && (rail || i < stops.length - 1) ? `<small>${money(f)}</small>` : ''}</span></button>
        ${isSel ? `<div class="st-x"><div class="st-etas">${etaHtml()}</div>
          <div class="st-acts">${i < stops.length - 1 && i !== board ? `<button class="btn-y sm" data-board type="button">${L('喺度上車', 'Board here')}</button>` : ''}${board != null && i > board ? `<button class="btn-d sm" data-alight type="button">${L('喺度落車', 'Alight here')}</button>` : ''}${rail ? `<button class="btn-d sm" data-sta type="button">${L('全站班次', 'All trains here')}</button>` : ''}${starBtn(fid, r.route + ' ' + stopName(id))}</div></div>` : ''}
      </li>`;
    }).join('');
    const tb = pg.querySelector('#tripbar');
    if (board != null) {
      const walk = S.here ? walkMin(dist(S.here, stopLoc(stops[board]))) : 0, door = S.here ? doorMin(S.here) : 0;   // 落樓＋等𨋢，同附近頁、規劃頁一致
      const ride = alight != null ? Math.round(rideMin(r, co, board, alight)) : null, fare = legFare(r, co, board, alight);
      tb.hidden = false;
      tb.innerHTML = `<div class="tb-t"><b>${esc(stopName(stops[board]))}${alight != null ? ' → ' + esc(stopName(stops[alight])) : ''}</b><small>${[S.here ? (door ? L(`落樓 ${door} + 行 ${walk} 分鐘`, `${door} min lift + ${walk} min walk`) : L(`步行 ${walk} 分鐘`, `${walk} min walk`)) : '', ride != null ? L(`坐約 ${ride} 分鐘`, `~${ride} min ride`) : L('未揀落車站', 'No alight stop yet'), fare != null ? money(fare) : ''].filter(Boolean).join(' · ')}</small></div>
        <button class="btn-y" id="tbGo" type="button">${icon.door}<span>${L('出門倒數', 'Countdown')}</span></button>`;
      tb.querySelector('#tbGo').onclick = () => startTrip({from: S.here ? {lat: S.here.lat, lng: S.here.lng, label: S.here.label} : null, walk0: walk + door, door,
        legs: [{key, co, board: stops[board], bseq: board, alight: alight != null ? stops[alight] : null, aseq: alight}], walkEnd: 0,
        to: alight != null ? {label: stopName(stops[alight]), ...stopLoc(stops[alight])} : null});
    } else tb.hidden = true;
    if (map && line) drawMarks();
    // 頁頂「最近你」嗰粒掣順便顯示下一班幾時到：唔使碌落去搵
    const nc = pg.querySelector('[data-near]');
    if (nc && sel === nearest && etas) { const n0 = etas.list.find(e => mins(e.t) >= 0); nc.innerHTML = `${icon.pin} ${L('最近你：', 'Nearest: ')}${esc(stopName(stops[nearest]))}${n0 ? ' · ' + (mins(n0.t) <= 0 ? L('即將到', 'due now') : mins(n0.t) >= 60 ? hhmm(n0.t) : mins(n0.t) + L(' 分鐘', ' min')) : ''}`; }
  }
  async function loadEta(){
    if (sel < 0) return;
    const memo = cycle(), at = sel;
    const res = await Promise.all(r.co.filter(c => r.stops[c]?.[sel]).map(c => etaFor(memo, c, r, r.stops[c][sel], sel)));
    if (at !== sel) return;
    etas = {list: res.flatMap(x => x.list).sort((a, b) => a.t - b.t).filter((e, i, a) => !i || e.t - a[i - 1].t > 45000), note: res.map(x => x.note).find(Boolean), err: res.every(x => x.err)};
    paint();
  }
  list.onclick = e => {
    const fb = e.target.closest('[data-fav]');
    if (fb) { const id = fb.dataset.fav, i = +fb.closest('li').dataset.i; toggleFav(id, {kind: 'bus', key, co, stop: stops[i], seq: i}); paint(); return; }
    const li = e.target.closest('li'); if (!li) return;
    const i = +li.dataset.i;
    if (e.target.closest('[data-sta]')) { stationSheet(stops[i], co); return; }
    if (e.target.closest('[data-board]')) { board = i; if (alight != null && alight <= i) alight = null; paint(); return; }
    if (e.target.closest('[data-alight]')) { alight = i; paint(); toast(L('已揀落車站', 'Alight stop set')); return; }
    if (e.target.closest('.st-btn')) { sel = sel === i ? -1 : i; etas = null; paint(); loadEta(); if (map) map.panTo([stopLoc(stops[i]).lat, stopLoc(stops[i]).lng]); }
  };
  let marks = [];
  function drawMarks(){
    marks.forEach(m => m.remove()); marks = [];
    stops.forEach((id, i) => {
      const p = stopLoc(id); if (!p) return;
      const cls = i === board ? 'board' : i === alight ? 'alight' : i === sel ? 'sel' : 'dot';
      marks.push(window.L.marker([p.lat, p.lng], {icon: pin(cls === 'dot' ? '' : String(i + 1), cls, cls === 'dot' ? 12 : 26), zIndexOffset: cls === 'dot' ? 0 : 500})
        .on('click', () => { sel = i; etas = null; paint(); loadEta(); pg.querySelector(`li[data-i="${i}"]`)?.scrollIntoView({block: 'center', behavior: 'smooth'}); }).addTo(map));
    });
  }
  async function initMap(){
    if (map) { map.invalidateSize(); return; }
    try {
      const pts = stops.map(stopLoc).filter(Boolean);
      const box = pg.querySelector('#rmap');
      map = await makeMap(box, pts[Math.max(0, sel)] || pts[0], 15, {preview: true});
      // 預覽：上下掃碌頁面；撳地圖（唔係撳站）就開全螢幕，一隻手指拖動
      const hint = document.createElement('button'); hint.type = 'button'; hint.className = 'map-hint'; hint.textContent = L('撳一下放大地圖', 'Tap to expand map'); box.appendChild(hint);
      const setFull = on => {
        box.classList.toggle('full', on); document.body.classList.toggle('mapfull', on);
        for (const h of ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom']) on ? map[h].enable() : map[h].disable();
        hint.textContent = on ? L('✕ 收細地圖', '✕ Close map') : L('撳一下放大地圖', 'Tap to expand map');
        setTimeout(() => { map.invalidateSize(); if (!on && line) map.fitBounds(line.getBounds(), {padding: [20, 20]}); }, 60);
      };
      let full = false;
      const open = () => { if (full) return; full = true; setFull(true); addLayer(() => { full = false; setFull(false); }); };
      hint.onclick = e => { e.stopPropagation(); if (full) back(); else open(); };
      map.on('click', () => { if (!full) open(); });
      line = window.L.polyline(pts.map(p => [p.lat, p.lng]), {color: col || '#ffc917', weight: 5, opacity: .9}).addTo(map);
      if (S.here) window.L.marker([S.here.lat, S.here.lng], {icon: youIcon(), interactive: false}).addTo(map);
      map.fitBounds(line.getBounds(), {padding: [20, 20]});           // 先睇晒成條路線；撳站先移過去
      drawMarks();
    } catch { pg.querySelector('#rmap').innerHTML = `<p class="loading">${L('地圖載入唔到', 'Map unavailable')}</p>`; }
  }
  if (!rail) initMap();
  paint(); loadEta();
  if (rail && sel >= 0) setTimeout(() => pg.querySelector(`li[data-i="${sel}"]`)?.scrollIntoView({block: 'center'}), 260);
  timer = setInterval(() => { if (!document.hidden) loadEta(); }, rail ? 20000 : 30000);
}
