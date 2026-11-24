// 港途 · 點對點規劃（直達 + 一次轉車，用實時到站計時間）
import {S, $, esc, L, nm, dist, stopsWithin, walkMin, rideMin, avgWait, runningNow, fareAt, money, stopLoc, stopName, hhmm, mins,
  routeTiles, lineTiles, coName, lineName, icon, FERRY, store} from './core.js';
import {cycle, etaFor} from './eta.js';
import {attachPicker, go, on} from './ui.js';
import {startTrip} from './trip.js';

const R_END = 600, R_XFER = 180;
const xferCache = new Map();
const xferStops = id => { if (!xferCache.has(id)) { const p = stopLoc(id); xferCache.set(id, p ? stopsWithin(p, R_XFER).filter(x => S.IDX.has(x.id)).slice(0, 10) : []); } return xferCache.get(id); };

export function staticPlan(from, to){
  const O = stopsWithin(from, R_END).filter(x => S.IDX.has(x.id)).slice(0, 30);
  const D = stopsWithin(to, R_END).filter(x => S.IDX.has(x.id));
  const reach = new Map();
  for (const x of D) for (const e of S.IDX.get(x.id)) { if (!reach.has(e.key)) reach.set(e.key, []); reach.get(e.key).push({seq: e.seq, stop: x.id, d: x.d, co: e.co}); }
  const best = new Map(), doneE1 = new Set();
  const add = (legs, w0, wEnd) => {
    let est = w0 + wEnd + (legs.length - 1) * 3;
    for (const l of legs) { const r = S.DB.routeList[l.key]; l.ride = rideMin(r, l.co, l.bseq, l.aseq); est += (l.walk || 0) + avgWait(r, l.co) + l.ride; }
    const sig = legs.map(l => l.co + ':' + S.DB.routeList[l.key].route).join('>');
    const o = best.get(sig);
    if (!o || est < o.est) best.set(sig, {legs, walk0: w0, walkEnd: wEnd, est});
  };
  for (const {id: oid, d: od} of O) {
    const w0 = walkMin(od);
    for (const e1 of S.IDX.get(oid)) {
      if (doneE1.has(e1.key + e1.co)) continue;
      const r1 = S.DB.routeList[e1.key], st1 = r1.stops[e1.co];
      if (e1.seq >= st1.length - 1) continue;
      doneE1.add(e1.key + e1.co);
      const leg1 = (j, stop) => ({key: e1.key, co: e1.co, board: oid, bseq: e1.seq, alight: stop, aseq: j});
      for (const z of reach.get(e1.key) || []) if (z.co === e1.co && z.seq > e1.seq) add([leg1(z.seq, z.stop)], w0, walkMin(z.d));
      for (let j = e1.seq + 1; j < st1.length; j++) {
        if (rideMin(r1, e1.co, e1.seq, j) > 75) break;
        for (const y of xferStops(st1[j])) for (const e2 of S.IDX.get(y.id)) {
          if (e2.key === e1.key) continue;
          const r2 = S.DB.routeList[e2.key];
          if (r2.route === r1.route && e2.co === e1.co) continue;
          const rc = reach.get(e2.key); if (!rc) continue;
          for (const z of rc) if (z.co === e2.co && z.seq > e2.seq) {
            const xw = y.d < 5 ? (e1.co === 'mtr' && e2.co === 'mtr' ? 2 : 0) : walkMin(y.d);
            add([leg1(j, st1[j]), {key: e2.key, co: e2.co, board: y.id, bseq: e2.seq, alight: z.stop, aseq: z.seq, walk: xw}], w0, walkMin(z.d));
          }
        }
      }
    }
  }
  const out = [...best.values()].sort((a, b) => a.est - b.est);
  const d = dist(from, to);
  if (d < 1500) out.push({legs: [], walk0: walkMin(d), walkEnd: 0, est: walkMin(d), walkOnly: true});
  return out.sort((a, b) => a.est - b.est);
}

async function refine(o, memo){
  const now = Date.now();
  let t = now + o.walk0 * 60000; o.times = []; o.unsure = false;
  for (let i = 0; i < o.legs.length; i++) {
    const l = o.legs[i], r = S.DB.routeList[l.key];
    if (i > 0) t += (l.walk || 0) * 60000;
    const res = await etaFor(memo, l.co, r, l.board, l.bseq);
    const c = res.list.find(e => e.t >= t - 30000);
    let boardT, live = false;
    if (c) { boardT = c.t; live = !c.sched; }
    else {
      if (!res.list.length && (!runningNow(r) || res.note)) { o.dead = true; }
      boardT = t + avgWait(r, l.co) * 60000; o.unsure = true;
    }
    const ride = rideMin(r, l.co, l.bseq, l.aseq) * 60000;
    o.times.push({boardT, live, alightT: boardT + ride});
    t = boardT + ride;
  }
  o.arriveT = t + o.walkEnd * 60000;
  o.leaveT = o.legs.length ? o.times[0].boardT - o.walk0 * 60000 : now;
  let fare = 0, mtr = false;
  for (const l of o.legs) { const f = fareAt(S.DB.routeList[l.key], l.bseq); if (l.co === 'mtr') mtr = true; else if (f != null) fare += f; }
  o.fare = fare; o.mtrFare = mtr;
  return o;
}

export async function planTrip(from, to, limit = 6){
  const cands = staticPlan(from, to);
  const pick = [], seenFirst = new Map();
  for (const c of cands) {                                    // 唔好全部都係同一條頭程
    const k = c.legs[0] ? S.DB.routeList[c.legs[0].key].route : 'walk';
    const sig = c.legs.map(l => S.DB.routeList[l.key].route).join('>');
    if (pick.some(p => p.legs.map(l => S.DB.routeList[l.key].route).join('>') === sig && !c.walkOnly)) continue;
    const n = seenFirst.get(k) || 0; if (n >= 2) continue;
    seenFirst.set(k, n + 1); pick.push(c);
    if (pick.length >= 18) break;
  }
  const memo = cycle();
  await Promise.all(pick.map(o => o.walkOnly ? Object.assign(o, {times: [], arriveT: Date.now() + o.walk0 * 60000, leaveT: Date.now(), fare: 0}) : refine(o, memo)));
  const ok = pick.filter(o => !o.dead);
  ok.sort((a, b) => (a.arriveT + (a.unsure ? 600000 : 0)) - (b.arriveT + (b.unsure ? 600000 : 0)));
  return ok.slice(0, limit);
}
export const toTrip = (o, from, to) => ({from, to, walk0: o.walk0, walkEnd: o.walkEnd, legs: o.legs.map(l => ({key: l.key, co: l.co, board: l.board, bseq: l.bseq, alight: l.alight, aseq: l.aseq, walk: l.walk || 0}))});

/* ---------- 規劃頁 ---------- */
let from = null, to = null, results = null, busy = false, open = 0;
export function initPlan(){
  const v = $('v-plan');
  v.innerHTML = `<div class="wrap">
    <h1 class="vh">${L('去邊度？', 'Where to?')}</h1>
    <div class="od">
      <div class="od-f"><span class="od-dot o" aria-hidden="true"></span><div class="search"><input id="pFrom" type="search" autocomplete="off" placeholder="${L('起點', 'From')}" aria-label="${L('起點', 'From')}"><div class="results" id="pFromR"></div></div></div>
      <div class="od-f"><span class="od-dot d" aria-hidden="true"></span><div class="search"><input id="pTo" type="search" autocomplete="off" placeholder="${L('目的地：地方、大廈或者車站', 'To: place, building or stop')}" aria-label="${L('目的地', 'To')}"><div class="results" id="pToR"></div></div></div>
      <button class="icon-btn swap" id="pSwap" type="button" aria-label="${L('對調', 'Swap')}">${icon.swap}</button>
    </div>
    <p class="hint">${L('暫時支援直達同轉一次車（巴士、小巴、港鐵、輕鐵），第一程同轉車都用實時到站計時間。', 'Direct and one-transfer trips for bus, minibus, MTR and Light Rail, timed with live arrivals.')}</p>
    <div id="pRes"></div></div>`;
  const fi = $('pFrom'), ti = $('pTo');
  attachPicker(fi, $('pFromR'), p => { from = p; fi.value = p.label; run(); }, {places: true, saved: true, here: true, keep: true});
  attachPicker(ti, $('pToR'), p => { to = p; ti.value = p.label; run(); }, {places: true, saved: true, here: true, keep: true});
  $('pSwap').onclick = () => { [from, to] = [to, from]; fi.value = from?.label || ''; ti.value = to?.label || ''; run(); };
  $('pRes').addEventListener('click', onRes);
  on('here', p => { if (!from) { from = {lat: p.lat, lng: p.lng, label: L('你嘅位置', 'Your location')}; fi.value = from.label; } });
  if (S.here) { from = {lat: S.here.lat, lng: S.here.lng, label: L('你嘅位置', 'Your location')}; fi.value = from.label; }
  setInterval(() => { if (!$('v-plan').hidden && results && !document.hidden) drawRes(); }, 20000);
}
export function planTo(dest, origin){
  go('plan');
  if (origin) from = origin;
  else if (!from && S.here) from = {lat: S.here.lat, lng: S.here.lng, label: L('你嘅位置', 'Your location')};
  to = dest;
  $('pFrom').value = from?.label || ''; $('pTo').value = to?.label || '';
  run();
}
async function run(){
  if (!from || !to || busy) return;
  busy = true; open = 0;
  $('pRes').innerHTML = `<div class="loading big">${flapsLoading()}<p>${L('計緊路線…', 'Planning…')}</p></div>`;
  try { results = await planTrip(from, to); } catch (e) { results = []; }
  busy = false; drawRes();
}
const flapsLoading = () => `<div class="bigflap" aria-hidden="true">${[...L('計路線', 'PLAN')].map(c => `<span class="f">${c}</span>`).join('')}</div>`;

export function legChips(o){
  if (o.walkOnly) return `<span class="lc walk">${icon.walk}${o.walk0}′</span>`;
  const parts = [`<span class="lc walk">${icon.walk}${o.walk0}′</span>`];
  o.legs.forEach((l, i) => {
    const r = S.DB.routeList[l.key];
    if (i > 0 && l.walk) parts.push(`<span class="lc walk">${icon.walk}${l.walk}′</span>`);
    parts.push(`<span class="lc">${l.co === 'mtr' ? lineTiles(r.route) : routeTiles(r.route)}</span>`);
  });
  if (o.walkEnd) parts.push(`<span class="lc walk">${icon.walk}${o.walkEnd}′</span>`);
  return parts.join('<span class="lc-sep" aria-hidden="true">›</span>');
}
export function steps(o){
  if (o.walkOnly) return `<li><b>${hhmm(o.leaveT)}</b> ${L(`直接行過去，約 ${o.walk0} 分鐘`, `Walk there, about ${o.walk0} min`)}</li>`;
  const out = [];
  o.legs.forEach((l, i) => {
    const r = S.DB.routeList[l.key], tm = o.times[i], nStops = l.aseq - l.bseq;
    const name = l.co === 'mtr' ? lineName(r.route) : r.route;
    if (i === 0) out.push(`<li><b>${hhmm(o.leaveT)}</b> ${L(`出門，行 ${o.walk0} 分鐘去 ${esc(stopName(l.board))}`, `Leave, walk ${o.walk0} min to ${esc(stopName(l.board))}`)}</li>`);
    else out.push(`<li><b>${hhmm(o.times[i - 1].alightT)}</b> ${l.walk ? L(`行 ${l.walk} 分鐘去 ${esc(stopName(l.board))}`, `Walk ${l.walk} min to ${esc(stopName(l.board))}`) : L(`喺 ${esc(stopName(l.board))} 轉車`, `Change at ${esc(stopName(l.board))}`)}</li>`);
    out.push(`<li class="ride"><b class="${tm.live ? 'live' : ''}">${hhmm(tm.boardT)}</b> ${L(`搭 ${esc(name)} 往 ${esc(nm(r.dest))}`, `Take ${esc(name)} towards ${esc(nm(r.dest))}`)}<small>${coName(l.co)} · ${L(`坐 ${nStops} 個站，約 ${Math.round(rideMin(r, l.co, l.bseq, l.aseq))} 分鐘`, `${nStops} stops, ~${Math.round(rideMin(r, l.co, l.bseq, l.aseq))} min`)}${tm.live ? '' : ' · ' + L('估計班次', 'estimated')}</small></li>`);
    out.push(`<li><b>${hhmm(tm.alightT)}</b> ${L(`喺 ${esc(stopName(l.alight))} 落車`, `Get off at ${esc(stopName(l.alight))}`)}</li>`);
  });
  out.push(`<li class="end"><b>${hhmm(o.arriveT)}</b> ${o.walkEnd ? L(`行 ${o.walkEnd} 分鐘到目的地`, `Walk ${o.walkEnd} min to destination`) : L('到達', 'Arrive')}</li>`);
  return out.join('');
}
function drawRes(){
  const el = $('pRes');
  if (!results) return;
  if (!results.length) { el.innerHTML = `<div class="hero"><h1>${L('搵唔到路線', 'No routes found')}</h1><p>${L('起點或者目的地 600 米內冇車站，或者要轉多過一次車。', 'No stops within 600 m of either end, or more than one change is needed.')}</p></div>`; return; }
  el.innerHTML = `<p class="lbl pad">${L(`${results.length} 個方案 · 按到達時間排`, `${results.length} options · by arrival`)}</p>` + results.map((o, i) => {
    const tot = Math.max(1, Math.round((o.arriveT - Math.max(Date.now(), o.leaveT)) / 60000)), lv = mins(o.leaveT);
    return `<article class="opt${i === open ? ' open' : ''}" data-i="${i}">
      <button class="opt-h" type="button" aria-expanded="${i === open}">
        <span class="opt-arr"><small>${L('約', 'Arrive')}</small>${hhmm(o.arriveT)}<small>${L('到', '')}</small></span>
        <span class="opt-m"><span class="legs">${legChips(o)}</span>
        <small>${lv <= 0 ? `<b class="go">${L('而家出門', 'Leave now')}</b>` : `<b class="go">${L(`${hhmm(o.leaveT)} 出門`, `Leave ${hhmm(o.leaveT)}`)}</b> · ${L(`${lv} 分鐘後`, `in ${lv} min`)}`} · ${L(`全程 ${tot} 分鐘`, `${tot} min total`)}${o.legs.length ? ' · ' + (o.fare ? money(o.fare) : '') + (o.mtrFare ? (o.fare ? ' + ' : '') + L('港鐵車費', 'MTR fare') : '') : ''}${o.unsure ? ' · ' + L('部分估計', 'partly estimated') : ''}</small></span></button>
      ${i === open ? `<div class="opt-x"><ol class="steps">${steps(o)}</ol>${o.legs.length ? `<button class="btn-y big" data-go type="button">${icon.door}<span>${L('開始出門倒數', 'Start leave countdown')}</span></button>` : ''}</div>` : ''}
    </article>`;
  }).join('');
}
function onRes(e){
  const art = e.target.closest('.opt'); if (!art) return;
  const i = +art.dataset.i;
  if (e.target.closest('[data-go]')) { startTrip({...toTrip(results[i], from, to), alts: {from, to}}); return; }
  if (e.target.closest('.opt-h')) { open = open === i ? -1 : i; drawRes(); }
}
