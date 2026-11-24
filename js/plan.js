// 港途 · 點對點規劃：逐輪搜尋（最多搭 4 程車，即轉 3 次），再用實時到站計準時間
import {S, $, esc, store, L, nm, dist, stopsWithin, walkMin, rideMin, cumTimes, avgWait, runningNow, fareAt, money, stopLoc, stopName,
  hhmm, mins, now, toast, nextDepAfter, isMtrStation, tilesFor, routeLabel, routeTiles, lineTiles, coName, lineName, icon} from './core.js';
import {cycle, etaFor} from './eta.js';
import {attachPicker, go, on} from './ui.js';
import {startTrip} from './trip.js';

const R_END = 600, R_XFER = 320, MAX_RIDES = 4;
const xferCache = new Map();
const xferStops = id => { if (!xferCache.has(id)) { const p = stopLoc(id); xferCache.set(id, p ? stopsWithin(p, R_XFER).filter(x => S.IDX.has(x.id)).slice(0, 16) : []); } return xferCache.get(id); };
const rt = key => S.DB.routeList[key];
// 步行時間：入出港鐵站要多行幾分鐘（大堂、扶手電梯、出口）
const endWalk = (id, d) => walkMin(d) + (isMtrStation(id) ? 2 : 0);
const xferWalk = (a, b, d) => { const ma = isMtrStation(a), mb = isMtrStation(b); return walkMin(d) + (ma && mb ? 2 : ma || mb ? 3 : 0); };
const sigOf = legs => legs.map(l => rt(l.key).route).join('>');

/* ---------- 逐輪搜尋（RAPTOR 式） ---------- */
function raptor(O, dMap, ban){
  const best = [new Map()], star = new Map();
  for (const {id, d} of O) { const t = endWalk(id, d); best[0].set(id, {t, p: {type: 'origin', w: t}}); star.set(id, t); }
  let marked = new Set(best[0].keys()), bestDest = Infinity;
  for (let k = 1; k <= MAX_RIDES && marked.size; k++) {
    const prev = best[k - 1], cur = new Map(); best[k] = cur;
    const Q = new Map();
    for (const s of marked) for (const e of S.IDX.get(s) || []) {
      if (ban && ban.has(e.key)) continue;
      if (e.seq >= rt(e.key).stops[e.co].length - 1) continue;
      const qk = e.key + '|' + e.co, q = Q.get(qk);
      if (q == null || e.seq < q) Q.set(qk, e.seq);
    }
    const newly = new Set();
    for (const [qk, s0] of Q) {
      const i0 = qk.lastIndexOf('|'), key = qk.slice(0, i0), co = qk.slice(i0 + 1), r = rt(key), st = r.stops[co], c = cumTimes(r, co);
      const w = avgWait(r, co) + (k > 1 ? 2 : 0);
      let board = null;
      for (let i = s0; i < st.length; i++) {
        const sid = st[i];
        if (board) {
          const ta = board.t + (c[i] - c[board.seq]);
          if (ta < Math.min(star.get(sid) ?? Infinity, bestDest)) {
            cur.set(sid, {t: ta, p: {type: 'ride', key, co, bstop: st[board.seq], bseq: board.seq, aseq: i}});
            star.set(sid, ta); newly.add(sid);
            if (dMap.has(sid)) bestDest = Math.min(bestDest, ta + endWalk(sid, dMap.get(sid)) + 10);
          }
        }
        const pv = prev.get(sid);
        if (pv && i < st.length - 1) { const tb = pv.t + w; if (!board || tb < board.t + (c[i] - c[board.seq])) board = {seq: i, t: tb}; }
      }
    }
    for (const s of [...newly]) {
      const base = cur.get(s);
      for (const y of xferStops(s)) {
        if (y.id === s) continue;
        const w = xferWalk(s, y.id, y.d), tw = base.t + w;
        if (tw < (star.get(y.id) ?? Infinity)) { cur.set(y.id, {t: tw, p: {type: 'walk', from: s, w}}); star.set(y.id, tw); newly.add(y.id); }
      }
    }
    marked = newly;
  }
  return best;
}
function rebuild(best, k, sid, dEnd){
  const legs = []; let s = sid, kk = k, walkEnd = endWalk(sid, dEnd), guard = 0;
  while (kk > 0 && guard++ < 40) {
    const lab = best[kk].get(s); if (!lab) return null;
    const p = lab.p;
    if (p.type === 'walk') { if (legs.length) legs[0].walk = (legs[0].walk || 0) + p.w; else walkEnd += p.w; s = p.from; continue; }
    if (p.type !== 'ride') return null;
    const r = rt(p.key);
    legs.unshift({key: p.key, co: p.co, board: p.bstop, bseq: p.bseq, alight: r.stops[p.co][p.aseq], aseq: p.aseq, walk: 0});
    s = p.bstop; kk--;
  }
  const o = best[0].get(s); if (!o) return null;
  return {legs, walk0: o.p.w, walkEnd};
}
const estOf = o => { let t = o.walk0 + o.walkEnd + (o.legs.length - 1) * 2; for (const l of o.legs) { const r = rt(l.key); t += (l.walk || 0) + avgWait(r, l.co) + rideMin(r, l.co, l.bseq, l.aseq); } return t; };

export function staticPlan(from, to){
  const O = stopsWithin(from, R_END).filter(x => S.IDX.has(x.id));
  const D = stopsWithin(to, R_END).filter(x => S.IDX.has(x.id));
  const out = new Map();
  const add = o => { if (!o || !o.legs.length) return; const sg = sigOf(o.legs); o.est = estOf(o); const x = out.get(sg); if (!x || o.est < x.est) out.set(sg, o); };
  if (O.length && D.length) {
    const dMap = new Map(D.map(x => [x.id, x.d]));
    // 1) 所有直達：每條路線喺最近嘅上車站上車
    const seen = new Set();
    for (const {id, d} of O) for (const e of S.IDX.get(id)) {
      const k = e.key + e.co; if (seen.has(k)) continue;
      const r = rt(e.key), st = r.stops[e.co];
      let bestJ = -1, bestW = Infinity;
      for (let j = e.seq + 1; j < st.length; j++) if (dMap.has(st[j])) { const w = endWalk(st[j], dMap.get(st[j])) + rideMin(r, e.co, e.seq, j); if (w < bestW) { bestW = w; bestJ = j; } }
      if (bestJ < 0) continue;
      seen.add(k);
      add({legs: [{key: e.key, co: e.co, board: id, bseq: e.seq, alight: st[bestJ], aseq: bestJ, walk: 0}], walk0: endWalk(id, d), walkEnd: endWalk(st[bestJ], dMap.get(st[bestJ]))});
    }
    // 2) 轉車：逐輪搜尋，再禁用最好方案嘅頭兩程搵後備方案
    const harvest = best => {
      const c = [];
      for (let k = 2; k < best.length; k++) for (const [sid, dd] of dMap) { const lab = best[k].get(sid); if (lab) c.push({k, sid, t: lab.t + endWalk(sid, dd), dd}); }
      c.sort((a, b) => a.t - b.t);
      const got = [];
      for (const x of c.slice(0, 30)) { const o = rebuild(best, x.k, x.sid, x.dd); if (o && o.legs.length > 1) { add(o); got.push(o); } }
      return got;
    };
    const first = harvest(raptor(O, dMap, null));
    const top = first.sort((a, b) => estOf(a) - estOf(b))[0];
    if (top) for (const l of top.legs.slice(0, 2)) harvest(raptor(O, dMap, new Set([l.key])));
  }
  const res = [...out.values()];
  const d = dist(from, to);
  if (d < 1500) res.push({legs: [], walk0: walkMin(d), walkEnd: 0, est: walkMin(d), walkOnly: true});
  return res.sort((a, b) => a.est - b.est);
}

async function refine(o, memo, at){
  const t0 = at || now(), future = at && at - now() > 45 * 60000;   // 揀咗遲啲出發：實時到站用唔到，改用時間表
  let t = t0 + o.walk0 * 60000; o.times = []; o.unsure = false; o.dead = false; o.timetable = !!future;
  for (let i = 0; i < o.legs.length; i++) {
    const l = o.legs[i], r = rt(l.key);
    if (i > 0) t += (l.walk || 0) * 60000;
    const res = future ? {list: [], note: '', err: false} : await etaFor(memo, l.co, r, l.board, l.bseq);
    const c = res.list.find(e => e.t >= t - 30000);
    let boardT, live = false;
    if (c) { boardT = c.t; live = !c.sched; }
    else {
      // 冇實時班次：用時間表搵下一班（例如凌晨就用首班車），搵唔到先當冇車
      const tt = nextDepAfter(r, l.co, l.bseq, t - 30000);
      if (tt && tt - t < 4 * 3600e3) boardT = tt;
      else if (future && !(r.freq && Object.keys(r.freq).length)) boardT = t + avgWait(r, l.co) * 60000;
      else if (runningNow(r) && !(res.note && !res.err && !res.list.length)) boardT = t + avgWait(r, l.co) * 60000;
      else { o.dead = true; boardT = t + avgWait(r, l.co) * 60000; }
      o.unsure = true;
    }
    const ride = rideMin(r, l.co, l.bseq, l.aseq) * 60000;
    o.times.push({boardT, live, alightT: boardT + ride});
    t = boardT + ride;
  }
  o.arriveT = t + o.walkEnd * 60000;
  o.leaveT = o.legs.length ? o.times[0].boardT - o.walk0 * 60000 : t0;
  let fare = 0, mtr = false;
  for (const l of o.legs) { const f = fareAt(rt(l.key), l.bseq); if (l.co === 'mtr') mtr = true; else if (f != null) fare += f; }
  o.fare = fare; o.mtrFare = mtr;
  o.walkSum = o.walk0 + o.walkEnd + o.legs.reduce((a, l) => a + (l.walk || 0), 0);
  return o;
}

const SORTS = {
  fast: (a, b) => a.arriveT - b.arriveT || a.legs.length - b.legs.length || (a.unsure - b.unsure),
  cheap: (a, b) => (a.mtrFare - b.mtrFare) || (a.fare - b.fare) || a.arriveT - b.arriveT,
  walk: (a, b) => a.walkSum - b.walkSum || a.arriveT - b.arriveT,
  xfer: (a, b) => a.legs.length - b.legs.length || a.arriveT - b.arriveT
};
export async function planTrip(from, to, limit = 6, opt = {}){
  const cands = staticPlan(from, to);
  const pick = [], perFirst = new Map();
  for (const c of cands) {                                    // 唔好全部都係同一條頭程
    const k = c.legs[0] ? rt(c.legs[0].key).route : 'walk';
    const n = perFirst.get(k) || 0; if (n >= 2) continue;
    perFirst.set(k, n + 1); pick.push(c);
    if (pick.length >= 24) break;
  }
  const memo = cycle();
  const t0 = opt.at || now();
  await Promise.all(pick.map(o => o.walkOnly ? Object.assign(o, {times: [], arriveT: t0 + o.walk0 * 60000, leaveT: t0, fare: 0, walkSum: o.walk0, mtrFare: false}) : refine(o, memo, opt.at)));
  const ok = pick.filter(o => !o.dead);
  ok.sort(SORTS[opt.sort] || SORTS.fast);
  return ok.slice(0, limit);
}
export const toTrip = (o, from, to) => ({from, to, walk0: o.walk0, walkEnd: o.walkEnd, legs: o.legs.map(l => ({key: l.key, co: l.co, board: l.board, bseq: l.bseq, alight: l.alight, aseq: l.aseq, walk: l.walk || 0}))});

/* ---------- 規劃頁 ---------- */
let from = null, to = null, results = null, token = 0, open = 0, at = null, sort = store.get('planSort', 'fast'), lastRun = 0;
const hereLabel = () => L('你嘅位置', 'Your location');
const saveFT = () => store.set('planFT', {from, to, t: Date.now()});
const SORT_UI = [['fast', '最快', 'Fastest'], ['cheap', '最平', 'Cheapest'], ['walk', '最少步行', 'Least walking'], ['xfer', '最少轉車', 'Fewest changes']];
const localDT = t => { const d = new Date(t + 288e5); return d.toISOString().slice(0, 16); };
const fromLocalDT = v => Date.parse(v + ':00+08:00');
export function initPlan(){
  const v = $('v-plan');
  v.innerHTML = `<div class="wrap">
    <h1 class="vh">${L('去邊度？', 'Where to?')}</h1>
    <div class="od">
      <div class="od-f"><span class="od-dot o" aria-hidden="true"></span><div class="search"><input id="pFrom" type="search" autocomplete="off" placeholder="${L('起點', 'From')}" aria-label="${L('起點', 'From')}"><div class="results" id="pFromR"></div></div></div>
      <div class="od-f"><span class="od-dot d" aria-hidden="true"></span><div class="search"><input id="pTo" type="search" autocomplete="off" placeholder="${L('目的地：地方、大廈或者車站', 'To: place, building or stop')}" aria-label="${L('目的地', 'To')}"><div class="results" id="pToR"></div></div></div>
      <button class="icon-btn swap" id="pSwap" type="button" aria-label="${L('對調', 'Swap')}">${icon.swap}</button>
    </div>
    <div class="pctl">
      <div class="seg" id="pWhen" role="group" aria-label="${L('出發時間', 'Departure time')}"><button type="button" data-w="now">${L('而家出發', 'Leave now')}</button><button type="button" data-w="later">${L('揀時間', 'Pick time')}</button></div>
      <input type="datetime-local" id="pAt" aria-label="${L('出發日期同時間', 'Departure date and time')}" hidden>
    </div>
    <div class="chips" id="pSort" role="group" aria-label="${L('排序', 'Sort')}">${SORT_UI.map(([k, zh, en]) => `<button class="chip" type="button" data-s="${k}">${L(zh, en)}</button>`).join('')}</div>
    <p class="hint">${L('巴士、小巴、港鐵、輕鐵，最多轉三次車；「而家出發」用實時到站計，遲啲出發就按時間表估。', 'Bus, minibus, MTR and Light Rail, up to three changes. Leaving now uses live arrivals; later trips use timetables.')}</p>
    <div id="pRes"></div></div>`;
  const fi = $('pFrom'), ti = $('pTo');
  const setFrom = p => { from = p.kind === 'here' ? {lat: p.lat, lng: p.lng, label: hereLabel(), here: true} : {lat: p.lat, lng: p.lng, label: p.label}; fi.value = from.label; saveFT(); run(); };
  const setTo = p => { to = {lat: p.lat, lng: p.lng, label: p.kind === 'here' ? hereLabel() : p.label}; ti.value = to.label; saveFT(); run(); };
  attachPicker(fi, $('pFromR'), setFrom, {places: true, saved: true, here: true, keep: true});
  attachPicker(ti, $('pToR'), setTo, {places: true, saved: true, here: true, keep: true});
  $('pSwap').onclick = () => { [from, to] = [to, from]; fi.value = from?.label || ''; ti.value = to?.label || ''; saveFT(); run(); };
  $('pRes').addEventListener('click', onRes);
  const paintCtl = () => {
    for (const b of $('pWhen').children) b.setAttribute('aria-pressed', String((b.dataset.w === 'later') === !!at));
    $('pAt').hidden = !at; if (at) $('pAt').value = localDT(at);
    for (const b of $('pSort').children) b.setAttribute('aria-pressed', String(b.dataset.s === sort));
  };
  $('pWhen').onclick = e => { const b = e.target.closest('[data-w]'); if (!b) return; at = b.dataset.w === 'later' ? (at || Math.ceil((now() + 3600e3) / 900e3) * 900e3) : null; paintCtl(); run(); };
  $('pAt').onchange = e => { const v = fromLocalDT(e.target.value); if (!isNaN(v)) { at = v; run(); } };
  $('pSort').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; sort = b.dataset.s; store.set('planSort', sort); paintCtl(); if (results) { results.sort(SORTS[sort]); open = 0; drawRes(); } };
  paintCtl();
  // 起點終點只記 30 分鐘；之後再開就由「你嘅位置」開始，唔會用咗舊起點
  const saved = store.get('planFT', null);
  if (saved && Date.now() - (saved.t || 0) < 1800e3) { from = saved.from; to = saved.to; }
  on('here', p => { if (!from || from.here) { from = {lat: p.lat, lng: p.lng, label: hereLabel(), here: true}; fi.value = from.label; } });
  if ((!from || from.here) && S.here) from = {lat: S.here.lat, lng: S.here.lng, label: hereLabel(), here: true};
  fi.value = from?.label || ''; ti.value = to?.label || '';
  // 「而家出發」嘅結果每分鐘用最新實時到站重新計；過咗出門時間嘅方案會自動換走
  setInterval(() => { if (!$('v-plan').hidden && results && !document.hidden) { if (!at && Date.now() - lastRun > 60000) run(true); else drawRes(); } }, 20000);
}
export function planTo(dest, origin){
  go('plan');
  if (origin) from = origin;
  else if ((!from || from.here) && S.here) from = {lat: S.here.lat, lng: S.here.lng, label: hereLabel(), here: true};
  to = dest; saveFT();
  $('pFrom').value = from?.label || ''; $('pTo').value = to?.label || '';
  run();
}
async function run(silent){
  if (!from || !to) return;
  const my = ++token; lastRun = Date.now();
  if (!silent) {
    open = 0;
    $('pRes').innerHTML = `<div class="loading big"><div class="bigflap" aria-hidden="true">${[...L('計路線', 'PLAN')].map(c => `<span class="f">${c}</span>`).join('')}</div><p>${L('計緊路線…', 'Planning…')}</p></div>`;
    await new Promise(r => setTimeout(r, 30));               // 等畫面先顯示「計緊」
  }
  let res = [];
  try { res = await planTrip(from, to, 6, {at, sort}); } catch (e) { console.error(e); }
  if (my !== token) return;                                  // 用家已經改咗起點／目的地，舊結果唔要
  if (silent && results && results[open]) { const sig = legsSig(results[open]); const k = res.findIndex(o => legsSig(o) === sig); open = k; }
  results = res; drawRes();
}
const legsSig = o => o.legs.map(l => l.key + l.board).join('>');

export function legChips(o){
  if (o.walkOnly) return `<span class="lc walk">${icon.walk}${o.walk0}′</span>`;
  const parts = [`<span class="lc walk">${icon.walk}${o.walk0}′</span>`];
  o.legs.forEach((l, i) => {
    const r = rt(l.key);
    if (i > 0 && l.walk) parts.push(`<span class="lc walk">${icon.walk}${l.walk}′</span>`);
    parts.push(`<span class="lc">${tilesFor(r)}</span>`);
  });
  if (o.walkEnd) parts.push(`<span class="lc walk">${icon.walk}${o.walkEnd}′</span>`);
  return parts.join('<span class="lc-sep" aria-hidden="true">›</span>');
}
export function steps(o){
  if (o.walkOnly) return `<li><b>${hhmm(o.leaveT)}</b> ${L(`直接行過去，約 ${o.walk0} 分鐘`, `Walk there, about ${o.walk0} min`)}</li>`;
  const out = [];
  o.legs.forEach((l, i) => {
    const r = rt(l.key), tm = o.times[i], nStops = l.aseq - l.bseq, ride = Math.round(rideMin(r, l.co, l.bseq, l.aseq));
    const name = routeLabel(r);
    if (i === 0) out.push(`<li><b>${hhmm(o.leaveT)}</b> ${L(`出門，行 ${o.walk0} 分鐘去 ${esc(stopName(l.board))}`, `Leave, walk ${o.walk0} min to ${esc(stopName(l.board))}`)}</li>`);
    else out.push(`<li><b>${hhmm(o.times[i - 1].alightT)}</b> ${l.walk ? L(`行 ${l.walk} 分鐘去 ${esc(stopName(l.board))} 轉車`, `Walk ${l.walk} min to ${esc(stopName(l.board))}`) : L(`喺 ${esc(stopName(l.board))} 轉車`, `Change at ${esc(stopName(l.board))}`)}</li>`);
    out.push(`<li class="ride"><b class="${tm.live ? 'live' : ''}">${hhmm(tm.boardT)}</b> ${L(`搭 ${esc(name)} 往 ${esc(nm(r.dest))}`, `Take ${esc(name)} towards ${esc(nm(r.dest))}`)}<small>${coName(l.co)} · ${L(`坐 ${nStops} 個站，約 ${ride} 分鐘`, `${nStops} stops, ~${ride} min`)}${tm.live ? '' : ' · ' + L('估計班次', 'estimated')}</small></li>`);
    out.push(`<li><b>${hhmm(tm.alightT)}</b> ${L(`喺 ${esc(stopName(l.alight))} 落車`, `Get off at ${esc(stopName(l.alight))}`)}</li>`);
  });
  out.push(`<li class="end"><b>${hhmm(o.arriveT)}</b> ${o.walkEnd ? L(`行 ${o.walkEnd} 分鐘到目的地`, `Walk ${o.walkEnd} min to destination`) : L('到達', 'Arrive')}</li>`);
  return out.join('');
}
function drawRes(){
  const el = $('pRes');
  if (!results) return;
  if (!results.length) { el.innerHTML = `<div class="hero"><h1>${L('搵唔到路線', 'No routes found')}</h1><p>${L('起點或者目的地 600 米內冇車站，或者而家冇車行。', 'No stops within 600 m of either end, or nothing is running now.')}</p></div>`; return; }
  const sl = SORT_UI.find(x => x[0] === sort) || SORT_UI[0];
  el.innerHTML = `<p class="lbl pad">${L(`${results.length} 個方案 · 按${sl[1]}排`, `${results.length} options · ${sl[2].toLowerCase()} first`)}${at ? ' · ' + L(`${localDT(at).replace('T', ' ')} 出發（按時間表估）`, `leaving ${localDT(at).replace('T', ' ')} (timetable)`) : ' · ' + L('每分鐘自動更新', 'auto-updates every minute')}</p>` + results.map((o, i) => {
    const tot = Math.max(1, Math.round((o.arriveT - Math.max(at || now(), o.leaveT)) / 60000)), lv = mins(o.leaveT);
    const xf = Math.max(0, o.legs.length - 1);
    return `<article class="opt${i === open ? ' open' : ''}" data-i="${i}">
      <button class="opt-h" type="button" aria-expanded="${i === open}">
        <span class="opt-arr"><small>${L('約', 'Arrive')}</small>${hhmm(o.arriveT)}<small>${L('到', '')}</small></span>
        <span class="opt-m"><span class="legs">${legChips(o)}</span>
        <small>${at ? `<b class="go">${L(`${hhmm(o.leaveT)} 出門`, `Leave ${hhmm(o.leaveT)}`)}</b>` : lv < -1 ? `<b class="late">${L('已過出門時間', 'Leave time passed')}</b>` : lv <= 0 ? `<b class="go">${L('而家出門', 'Leave now')}</b>` : `<b class="go">${L(`${hhmm(o.leaveT)} 出門`, `Leave ${hhmm(o.leaveT)}`)}</b> · ${L(`${lv} 分鐘後`, `in ${lv} min`)}`} · ${L(`全程 ${tot} 分鐘`, `${tot} min`)}${o.legs.length ? ' · ' + (xf ? L(`轉 ${xf} 次車`, `${xf} change${xf > 1 ? 's' : ''}`) : L('直達', 'direct')) : ''}${(() => { const f = [o.fare ? money(o.fare) : '', o.mtrFare ? L('港鐵車費', 'MTR fare') : ''].filter(Boolean).join(' + '); return f ? ' · ' + f : ''; })()}${o.walkSum ? ' · ' + L(`行 ${o.walkSum} 分鐘`, `${o.walkSum} min walk`) : ''}${o.unsure && !at ? ' · ' + L('部分估計', 'partly estimated') : ''}</small></span></button>
      ${i === open ? `<div class="opt-x"><ol class="steps">${steps(o)}</ol>${o.legs.length ? `<button class="btn-y big" data-go type="button">${icon.door}<span>${L('開始出門倒數', 'Start leave countdown')}</span></button>` : ''}</div>` : ''}
    </article>`;
  }).join('');
}
function onRes(e){
  const art = e.target.closest('.opt'); if (!art) return;
  const i = +art.dataset.i;
  if (e.target.closest('[data-go]')) {
    if (at && at - now() > 45 * 60000) { toast(L('出門倒數只可以用喺而家出發，請揀「而家出發」', 'Countdown works for trips leaving now — switch to Leave now')); return; }
    startTrip({...toTrip(results[i], from, to), alts: {from, to}}); return;
  }
  if (e.target.closest('.opt-h')) { open = open === i ? -1 : i; drawRes(); }
}
