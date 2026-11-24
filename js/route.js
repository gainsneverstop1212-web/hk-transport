// 港途 · 路線搜尋 + 路線詳情
import {S, $, esc, store, L, nm, mins, hhmm, flaps, routeTiles, lineTiles, tilesFor, LINES, coTag, coName, lineName, lineColor, stopLoc, stopName,
  dist, walkMin, serviceInfo, rideMin, fareAt, money, FERRY, icon, toast} from './core.js';
import {cycle, etaFor} from './eta.js';
import {openPage, starBtn, toggleFav, isFav, on} from './ui.js';
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
    <div class="rq" id="rq"><div class="rq-disp" id="rqDisp" aria-live="polite"></div><button class="btn-d sm" id="rqClr" type="button">${L('清除', 'Clear')}</button></div>
    <div id="rList" class="rlist"></div></div>
    <div class="keypad" id="keypad" aria-label="${L('路線鍵盤', 'Route keypad')}"><div class="kp-num"></div><div class="kp-let"></div></div>`;
  $('rFilt').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; filt = b.dataset.f; draw(); window.scrollTo(0, 0); };
  $('rqClr').onclick = () => { q = ''; draw(); };
  $('keypad').onclick = e => {
    const b = e.target.closest('button[data-k]'); if (!b || b.disabled) return;
    const k = b.dataset.k;
    q = k === 'del' ? q.slice(0, -1) : (q + k).slice(0, 6);
    draw();
  };
  $('rList').onclick = e => {
    const j = e.target.closest('[data-jump]');
    if (j) { filt = j.dataset.jump; draw(); setTimeout(() => document.getElementById('ln-' + j.dataset.line)?.scrollIntoView({block: 'start', behavior: 'smooth'}), 40); return; }
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
function mtrPicker(){
  return Object.keys(LINES).map(c => {
    const dirs = directions(entriesOf(r => r.co[0] === 'mtr' && r.route === c));
    if (!dirs.length) return '';
    return `<section class="linecard" id="ln-${c}" style="--c:${lineColor(c)}"><header><span class="lc-bar"></span><h3>${esc(lineName(c))}</h3></header><div class="dirs">${dirs.map(dirBtn).join('')}</div></section>`;
  }).join('');
}
function lrtPicker(){
  const by = new Map();
  for (const e of entriesOf(r => r.co[0] === 'lightRail')) { const n = e[1].route.replace('*', ''); if (!by.has(n)) by.set(n, []); by.get(n).push(e); }
  return [...by.keys()].sort(natural).map(n => `<section class="linecard lrt" id="ln-${esc(n)}"><header>${routeTiles(n.replace('*', ''))}<h3>${L(`輕鐵 ${esc(n.replace('*', ''))} 綫`, `Light Rail ${esc(n.replace('*', ''))}`)}</h3></header><div class="dirs">${directions(by.get(n)).map(dirBtn).join('')}</div></section>`).join('');
}
function ferryPicker(){
  const by = new Map();
  for (const e of entriesOf(r => FERRY.has(r.co[0]))) { const co = e[1].co[0]; if (!by.has(co)) by.set(co, []); by.get(co).push(e); }
  return [...by].map(([co, list]) => `<section class="linecard ferry"><header><span class="lc-bar" style="--c:${'#4aa3df'}"></span><h3>${esc(coName(co))}</h3></header><div class="dirs">${directions(list).map(dirBtn).join('')}</div></section>`).join('');
}
function railShortcuts(){
  const lrtN = [...new Set(entriesOf(r => r.co[0] === 'lightRail').map(([, r]) => r.route.replace('*', '')))].sort(natural);
  return `<p class="lbl pad">${L('港鐵', 'MTR')}</p><div class="linegrid">${Object.keys(LINES).filter(c => S.NUMS.has(c)).map(c => `<button type="button" class="lineb" data-jump="mtr" data-line="${c}" style="--c:${lineColor(c)}">${esc(lineName(c))}</button>`).join('')}</div>
    <p class="lbl pad">${L('輕鐵', 'Light Rail')}</p><div class="linegrid lrt">${lrtN.map(n => `<button type="button" class="lineb lr" data-jump="lrt" data-line="${esc(n)}">${esc(n.replace('*', ''))}</button>`).join('')}</div>`;
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
  $('keypad').querySelector('.kp-let').innerHTML = lets.map(c => `<button type="button" data-k="${esc(c)}">${esc(c)}</button>`).join('');
  if (!q) {
    const rec = store.get('recentRoutes', []).filter(k => S.DB.routeList[k]);
    list.innerHTML = (filt === 'all' ? railShortcuts() : '') + (rec.length ? `<p class="lbl pad">${L('最近睇過', 'Recent')}</p>` + rec.map(itemHtml).join('') : `<p class="hint">${L('用下面嘅鍵盤輸入巴士或者小巴號碼。只會亮起有路線嘅數字同字母。', 'Type a bus or minibus number below. Only keys that lead to a real route light up.')}</p>`);
    return;
  }
  keys.sort((a, b) => { const A = S.DB.routeList[a], B = S.DB.routeList[b]; return natural(A.route, B.route) || A.co[0].localeCompare(B.co[0]) || String(A.serviceType).localeCompare(String(B.serviceType)); });
  list.innerHTML = keys.slice(0, 80).map(itemHtml).join('') || `<p class="hint">${L('冇呢條路線', 'No such route')}</p>`;
}
function itemHtml(k){
  const r = S.DB.routeList[k];
  const special = String(r.serviceType) !== '1' ? `<em>${L('特別班', 'Special')}</em>` : '';
  return `<button class="ritem" type="button" data-key="${esc(k)}">${tilesFor(r)}
    <span class="ri-t"><b>${L('往', 'To')} ${esc(nm(r.dest))}</b><small>${L('由 ', 'From ')}${esc(nm(r.orig))}</small></span>
    <span class="ri-c">${r.co.map(coTag).join(' ')}${special}</span></button>`;
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
  let board = sel >= 0 ? sel : null, alight = null, etas = null, timer = null, map = null, line = null;
  const si = serviceInfo(r), mtr = co === 'mtr';
  const opp = findOpposite(key, r, co);
  const pg = openPage('route-page');
  pg.innerHTML = `<header class="pg-h"><button class="icon-btn" data-back type="button" aria-label="${L('返回', 'Back')}">${icon.back}</button>
      ${tilesFor(r)}<div class="pg-t"><b>${L('往', 'To')} ${esc(nm(r.dest))}</b><small>${L('由 ', 'From ')}${esc(nm(r.orig))} · ${r.co.map(coName).join(' + ')}</small></div></header>
    <div class="wrap">
      <div class="facts">
        ${opp ? `<button class="chip" type="button" data-opp="${esc(opp[0])}">⇄ ${L('對頭線', 'Reverse')}</button>` : ''}
        ${si ? `<span class="fact">${L('今日 ', 'Today ')}${si.first}–${si.overnight ? L('翌日 ', 'next day ') : ''}${si.last}</span>` : ''}
        ${si?.hw ? `<span class="fact">${L(`而家約 ${si.hw} 分鐘一班`, `Every ~${si.hw} min now`)}</span>` : ''}
        ${r.jt ? `<span class="fact">${L(`全程約 ${r.jt} 分鐘`, `~${r.jt} min end to end`)}</span>` : ''}
        ${String(r.serviceType) !== '1' ? `<span class="fact warn">${L('特別班次', 'Special service')}</span>` : ''}
      </div>
      <div class="rmap" id="rmap"></div>
      <p class="lbl pad">${L('撳一個站睇到站時間，揀上車同落車站就可以開始出門倒數', 'Tap a stop for arrivals; pick where you get on and off to start a countdown')}</p>
      <ol class="stops" id="stops"></ol>
    </div>
    <div class="tripbar" id="tripbar" hidden></div>`;
  pg.querySelector('[data-back]').onclick = () => pg.close();
  pg.querySelector('[data-opp]')?.addEventListener('click', e => { const k = e.currentTarget.dataset.opp; pg.close(); setTimeout(() => openRoute(k), 60); });
  pg.addEventListener('close', () => clearInterval(timer));

  const list = pg.querySelector('#stops');
  const cum = i => board != null && i > board ? Math.round(rideMin(r, co, board, i)) : null;
  function paint(){
    list.innerHTML = stops.map((id, i) => {
      const f = fareAt(r, i), c = cum(i), isSel = i === sel;
      const fid = key + '@' + id;
      return `<li class="${isSel ? 'open' : ''}${i === board ? ' board' : ''}${i === alight ? ' alight' : ''}" data-i="${i}">
        <button class="st-btn" type="button" aria-expanded="${isSel}"><span class="st-n">${i + 1}</span><span class="st-name">${esc(stopName(id))}</span>
        <span class="st-m">${i === board ? `<em class="tag y">${L('上車', 'Board')}</em>` : i === alight ? `<em class="tag w">${L('落車', 'Alight')}</em>` : c != null ? `+${c}′` : ''}${f != null && i < stops.length - 1 ? `<small>${money(f)}</small>` : ''}</span></button>
        ${isSel ? `<div class="st-x"><div class="st-etas">${etas == null ? `<span class="none">${L('載入中…', 'Loading…')}</span>` : etas.list.filter(e => mins(e.t) >= 0).slice(0, 3).map(e => `<span class="${e.sched ? 'sched' : ''}"><b>${mins(e.t) <= 0 ? L('即將', 'now') : mins(e.t) >= 60 ? hhmm(e.t) : mins(e.t) + L(' 分', ' min')}</b><small>${hhmm(e.t)}${e.sched ? ' · ' + L('時間表', 'sched.') : ''}</small></span>`).join('') || `<span class="none">${esc(etas.note || (etas.err ? L('暫時攞唔到資料', 'Unavailable') : L('暫無班次', 'No service')))}</span>`}</div>
          <div class="st-acts">${i < stops.length - 1 ? `<button class="btn-y sm" data-board type="button">${L('喺度上車', 'Board here')}</button>` : ''}${board != null && i > board ? `<button class="btn-d sm" data-alight type="button">${L('喺度落車', 'Alight here')}</button>` : ''}${starBtn(fid, r.route + ' ' + stopName(id))}</div></div>` : ''}
      </li>`;
    }).join('');
    const tb = pg.querySelector('#tripbar');
    if (board != null) {
      const walk = S.here ? walkMin(dist(S.here, stopLoc(stops[board]))) : 0;
      const ride = alight != null ? Math.round(rideMin(r, co, board, alight)) : null, fare = fareAt(r, board);
      tb.hidden = false;
      tb.innerHTML = `<div class="tb-t"><b>${esc(stopName(stops[board]))}${alight != null ? ' → ' + esc(stopName(stops[alight])) : ''}</b><small>${[S.here ? L(`步行 ${walk} 分鐘`, `${walk} min walk`) : '', ride != null ? L(`坐約 ${ride} 分鐘`, `~${ride} min ride`) : L('未揀落車站', 'No alight stop yet'), fare != null ? money(fare) : ''].filter(Boolean).join(' · ')}</small></div>
        <button class="btn-y" id="tbGo" type="button">${icon.door}<span>${L('出門倒數', 'Countdown')}</span></button>`;
      tb.querySelector('#tbGo').onclick = () => startTrip({from: S.here ? {lat: S.here.lat, lng: S.here.lng, label: S.here.label} : null, walk0: walk,
        legs: [{key, co, board: stops[board], bseq: board, alight: alight != null ? stops[alight] : null, aseq: alight}], walkEnd: 0,
        to: alight != null ? {label: stopName(stops[alight]), ...stopLoc(stops[alight])} : null});
    } else tb.hidden = true;
    if (map && line) drawMarks();
  }
  async function loadEta(){
    if (sel < 0) return;
    const memo = cycle();
    const res = await Promise.all(r.co.filter(c => r.stops[c]?.[sel]).map(c => etaFor(memo, c, r, r.stops[c][sel], sel)));
    etas = {list: res.flatMap(x => x.list).sort((a, b) => a.t - b.t).filter((e, i, a) => !i || e.t - a[i - 1].t > 45000), note: res.map(x => x.note).find(Boolean), err: res.every(x => x.err)};
    paint();
  }
  list.onclick = e => {
    const fb = e.target.closest('[data-fav]');
    if (fb) { const id = fb.dataset.fav, i = +fb.closest('li').dataset.i; toggleFav(id, {kind: 'bus', key, co, stop: stops[i], seq: i}); paint(); return; }
    const li = e.target.closest('li'); if (!li) return;
    const i = +li.dataset.i;
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
  (async () => {
    try {
      const pts = stops.map(stopLoc).filter(Boolean);
      map = await makeMap(pg.querySelector('#rmap'), pts[Math.max(0, sel)] || pts[0], 15);
      line = window.L.polyline(pts.map(p => [p.lat, p.lng]), {color: mtr ? lineColor(r.route) : '#ffc917', weight: 5, opacity: .9}).addTo(map);
      if (S.here) window.L.marker([S.here.lat, S.here.lng], {icon: youIcon(), interactive: false}).addTo(map);
      if (sel < 0) map.fitBounds(line.getBounds(), {padding: [20, 20]});
      drawMarks();
    } catch { pg.querySelector('#rmap').innerHTML = `<p class="loading">${L('地圖載入唔到', 'Map unavailable')}</p>`; }
  })();
  paint(); loadEta();
  timer = setInterval(() => { if (!document.hidden) loadEta(); }, 30000);
  setTimeout(() => pg.querySelector('li.open')?.scrollIntoView({block: 'center'}), 120);
}
