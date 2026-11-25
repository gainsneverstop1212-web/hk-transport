// 港住走 · 點對點規劃：逐輪搜尋（最多搭 4 程車，即轉 3 次），再用實時到站計準時間
import {S, $, esc, destHtml, store, L, nm, dist, stopsWithin, walkMin, doorInfo, rideMin, cumTimes, avgWait, runningAt, railOpenAt, railNextOpen, legFare, mtrFare, money, stopLoc, stopName,
  hhmm, mins, now, toast, nextDepAfter, isMtrStation, tilesFor, routeLabel, routeTiles, lineTiles, coName, lineName, lineColor, lrtColor, coColor, icon, FERRY} from './core.js';
import {cycle, etaFor} from './eta.js';
import {attachPicker, go, on, places, savePlaces, openSheet} from './ui.js';
import {makeMap, pin} from './map.js';
import {startTrip} from './trip.js';

const R_END = 600, R_END_WIDE = 850, R_XFER = 320, MAX_RIDES = 4, MIN_OPTS = 3;
const xferCache = new Map();
// 轉車可以行去嘅站：最近 16 個，另外範圍內所有港鐵／輕鐵站一定計（巴士總站附近站多，唔好擠走鐵路站）
const isRail = id => (S.IDX.get(id) || []).some(e => e.co === 'mtr' || e.co === 'lightRail');
const xferStops = id => {
  if (!xferCache.has(id)) {
    const p = stopLoc(id), all = p ? stopsWithin(p, R_XFER).filter(x => S.IDX.has(x.id)) : [];
    xferCache.set(id, [...all.slice(0, 16), ...all.slice(16).filter(x => isRail(x.id))]);
  }
  return xferCache.get(id);
};
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

const yieldUI = () => new Promise(r => setTimeout(r, 0));
const planCache = new Map();
const ckey = (a, b, t, r) => [a.lat, a.lng, b.lat, b.lng].map(x => x.toFixed(4)).join(',') + '@' + Math.floor(t / 1800e3) + '/' + r;
// 某個時間冇行嘅路線（例如凌晨嘅日間巴士、港鐵）：搜尋時唔考慮，免得叫人搭冇開嘅車
const banCache = new Map();
function bannedAt(t){
  const b = Math.floor(t / 900e3);
  if (!banCache.has(b)) {
    const out = new Set();
    for (const [key, r] of Object.entries(S.DB.routeList)) if (!runningAt(r, t) && !runningAt(r, t + 1800e3)) out.add(key);
    banCache.clear(); banCache.set(b, out);
  }
  return banCache.get(b);
}
let railKeyList = null;
const railKeys = () => railKeyList || (railKeyList = Object.entries(S.DB.routeList).filter(([, r]) => r.co[0] === 'mtr' || r.co[0] === 'lightRail').map(([k]) => k));
// 搜尋結果（未計實時）記 10 分鐘：每分鐘自動更新、揀第二班都唔使重新計一次
export async function staticPlan(from, to, onStep, t0 = now(), radius = R_END){
  const k = ckey(from, to, t0, radius), hit = planCache.get(k);
  if (hit && Date.now() - hit.t < 600000) return hit.res.map(o => ({...o, legs: o.legs.map(l => ({...l}))}));
  const ban = bannedAt(t0);
  const O = stopsWithin(from, radius).filter(x => S.IDX.has(x.id));
  const D = stopsWithin(to, radius).filter(x => S.IDX.has(x.id));
  const out = new Map();
  const add = o => { if (!o || !o.legs.length) return; const sg = sigOf(o.legs); o.est = estOf(o); const x = out.get(sg); if (!x || o.est < x.est) out.set(sg, o); };
  if (O.length && D.length) {
    const dMap = new Map(D.map(x => [x.id, x.d]));
    // 1) 所有直達：每條路線喺最近嘅上車站上車
    const seen = new Set();
    for (const {id, d} of O) for (const e of S.IDX.get(id)) {
      const k = e.key + e.co; if (seen.has(k) || ban.has(e.key)) continue;
      const r = rt(e.key), st = r.stops[e.co];
      let bestJ = -1, bestW = Infinity;
      for (let j = e.seq + 1; j < st.length; j++) if (dMap.has(st[j])) { const w = endWalk(st[j], dMap.get(st[j])) + rideMin(r, e.co, e.seq, j); if (w < bestW) { bestW = w; bestJ = j; } }
      if (bestJ < 0) continue;
      seen.add(k);
      add({legs: [{key: e.key, co: e.co, board: id, bseq: e.seq, alight: st[bestJ], aseq: bestJ, walk: 0}], walk0: endWalk(id, d), walkEnd: endWalk(st[bestJ], dMap.get(st[bestJ]))});
    }
    // 2) 轉車：逐輪搜尋，再禁用最好方案嘅頭兩程搵後備方案
    onStep?.(2); await yieldUI();
    const harvest = best => {
      const c = [];
      for (let k = 2; k < best.length; k++) for (const [sid, dd] of dMap) { const lab = best[k].get(sid); if (lab) c.push({k, sid, t: lab.t + endWalk(sid, dd), dd}); }
      c.sort((a, b) => a.t - b.t);
      const got = [];
      for (const x of c.slice(0, 30)) { const o = rebuild(best, x.k, x.sid, x.dd); if (o && o.legs.length > 1) { add(o); got.push(o); } }
      return got;
    };
    const first = harvest(raptor(O, dMap, ban));
    const top = first.sort((a, b) => estOf(a) - estOf(b))[0];
    if (top) for (const l of top.legs.slice(0, 2)) { await yieldUI(); harvest(raptor(O, dMap, new Set([...ban, l.key]))); }
    // 唔搭港鐵嘅後備方案：好多人寧願慢少少都要平啲、或者有位坐
    if (top && top.legs.some(l => l.co === 'mtr')) { await yieldUI(); harvest(raptor(O, dMap, new Set([...ban, ...railKeys()]))); }
  }
  let res = [...out.values()].filter(o => !pointless(o, from, to));
  // 方案太少（例如目的地附近冇直達站）：擴大起點、終點嘅搜尋範圍再搵一次
  if (res.length < MIN_OPTS && radius === R_END) {
    const more = await staticPlan(from, to, null, t0, R_END_WIDE);
    const sig = new Set(res.map(o => sigOf(o.legs)));
    res = res.concat(more.filter(o => !o.walkOnly && !sig.has(sigOf(o.legs))));
  }
  const d = dist(from, to);
  if (d < 1500 && radius === R_END) res.push({legs: [], walk0: walkMin(d), walkEnd: 0, est: walkMin(d), walkOnly: true});
  res.sort((a, b) => a.est - b.est);
  planCache.set(k, {t: Date.now(), res});
  if (planCache.size > 20) planCache.delete(planCache.keys().next().value);
  return res.map(o => ({...o, legs: o.legs.map(l => ({...l}))}));
}
// 頭程或者尾程只係坐一兩個站、行路差唔多快：呢啲「為搭而搭」嘅方案唔要
function pointless(o, from, to){
  if (o.legs.length < 2) return false;
  const first = o.legs[0], last = o.legs[o.legs.length - 1];
  const short = l => { const r = rt(l.key); return rideMin(r, l.co, l.bseq, l.aseq) < 5 && l.aseq - l.bseq <= 2; };
  if (short(last)) { const p = stopLoc(last.board); if (p && walkMin(dist(p, to)) <= (last.walk || 0) + avgWait(rt(last.key), last.co) + rideMin(rt(last.key), last.co, last.bseq, last.aseq) + o.walkEnd + 3) return true; }
  if (short(first)) { const nx = o.legs[1], p = stopLoc(nx.board); if (p && walkMin(dist(from, p)) <= o.walk0 + avgWait(rt(first.key), first.co) + rideMin(rt(first.key), first.co, first.bseq, first.aseq) + (nx.walk || 0) + 3) return true; }
  return false;
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
    const rail = l.co === 'mtr' || l.co === 'lightRail';
    if (c) { boardT = c.t; live = !c.sched; }
    else if (rail) {
      // 港鐵、輕鐵冇時間表：收咗車（大約 01:15–05:45）就等到頭班車；等超過 90 分鐘當冇車
      const open = railNextOpen(t);
      if (open - t > 90 * 60000) o.dead = true;
      boardT = Math.max(t, open) + avgWait(r, l.co) * 60000;
      o.unsure = true;
    } else {
      // 冇實時班次：用時間表搵下一班，等太耐（超過 2.5 小時）當冇車
      const tt = nextDepAfter(r, l.co, l.bseq, t - 30000);
      if (tt && tt - t < 2.5 * 3600e3) boardT = tt;
      else if (!(r.freq && Object.keys(r.freq).length) && !(res.note && !res.err && !res.list.length)) boardT = t + avgWait(r, l.co) * 60000;
      else if (runningAt(r, t) && !(res.note && !res.err && !res.list.length)) boardT = t + avgWait(r, l.co) * 60000;
      else { o.dead = true; boardT = t + avgWait(r, l.co) * 60000; }
      o.unsure = true;
    }
    const ride = rideMin(r, l.co, l.bseq, l.aseq) * 60000;
    o.times.push({boardT, live, alightT: boardT + ride, plat: c?.plat || null});
    t = boardT + ride;
  }
  o.arriveT = t + o.walkEnd * 60000;
  o.leaveT = o.legs.length ? o.times[0].boardT - o.walk0 * 60000 : t0;
  let fare = 0, unknown = false;
  for (const g of fareGroups(o.legs)) { if (g.f == null) unknown = true; else fare += g.f; }
  o.fare = fare; o.fareUnknown = unknown;
  o.walkSum = o.walk0 - (o.door || 0) + o.walkEnd + o.legs.reduce((a, l) => a + (l.walk || 0), 0);   // 落樓等𨋢唔計做行路
  return o;
}

// 車費分組：連續幾程港鐵（站內轉綫，唔使出閘）只收一次，由第一個站計到最後一個站
export function fareGroups(legs){
  const out = [];
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    if (l.co === 'mtr') {
      let j = i; while (j + 1 < legs.length && legs[j + 1].co === 'mtr' && legs[j + 1].board === legs[j].alight) j++;
      const a = rt(legs[i].key).stops.mtr[legs[i].bseq], b = rt(legs[j].key).stops.mtr[legs[j].aseq];
      out.push({from: i, to: j, f: mtrFare(a, b)}); i = j; continue;
    }
    out.push({from: i, to: i, f: legFare(rt(l.key), l.co, l.bseq, l.aseq)});
  }
  return out;
}
// 「最早到」：嚴格按到達時間排（顯示出嚟一定由早到遲）；同一分鐘到就有實時到站嘅排先。估算方案會用橙色標明
const SORTS = {
  fast: (a, b) => Math.floor(a.arriveT / 60000) - Math.floor(b.arriveT / 60000) || (!!a.unsure - !!b.unsure) || a.legs.length - b.legs.length,
  cheap: (a, b) => (a.fareUnknown - b.fareUnknown) || (a.fare - b.fare) || a.arriveT - b.arriveT,
  walk: (a, b) => a.walkSum - b.walkSum || a.arriveT - b.arriveT,
  xfer: (a, b) => a.legs.length - b.legs.length || a.arriveT - b.arriveT
};
export async function planTrip(from, to, limit = 6, opt = {}){
  const sort = opt.sort || 'fast';
  // 「幾點前到」：先用預計車程推算大約幾點出發，再逐個方案按時間表計
  const t0 = opt.arriveBy ? Math.max(now(), opt.arriveBy - 3 * 3600e3) : (opt.at || now());
  const cands = await staticPlan(from, to, opt.onStep, opt.arriveBy ? Math.max(now(), opt.arriveBy - 3600e3) : t0);
  opt.onStep?.(3);
  // 落樓 + 等𨋢：加入第一段步行（出門時間會早啲，唔會趕到氣咳）
  const di = doorInfo(from), door = di.min;
  for (const c of cands) { c.door = door; c.doorWhy = di.why; c.walk0 += door; c.est = (c.est || 0) + door; }
  const pick = [], perFirst = new Map();
  for (const c of cands) {                                    // 唔好全部都係同一條頭程
    const k = c.legs[0] ? rt(c.legs[0].key).route : 'walk';
    const n = perFirst.get(k) || 0; if (n >= 2) continue;
    perFirst.set(k, n + 1); pick.push(c);
    if (pick.length >= 24) break;
  }
  const memo = cycle();
  const atOf = o => opt.arriveBy ? Math.max(now(), opt.arriveBy - (o.est + 10) * 60000) : opt.at;
  await Promise.all(pick.map(o => { const a = atOf(o) || now(); return o.walkOnly ? Object.assign(o, {times: [], arriveT: a + o.walk0 * 60000, leaveT: a, fare: 0, walkSum: o.walk0 - (o.door || 0), fareUnknown: false, timetable: !!opt.at || !!opt.arriveBy}) : refine(o, memo, atOf(o)); }));
  let alive = pick.filter(o => !o.dead);
  if (opt.arriveBy) {
    alive = alive.filter(o => o.arriveT <= opt.arriveBy + 60000);
    // 準時到嘅方案入面，出門最遲嘅排先（可以喺屋企留耐啲）
    return tidy(alive, 'arrive').sort((a, b) => b.leaveT - a.leaveT || a.legs.length - b.legs.length).slice(0, limit);
  }
  let ok = tidy(alive, sort);
  // 起碼留 3 個方案俾用家揀：唔夠就由被執走嘅方案入面補返
  if (ok.length < MIN_OPTS) for (const o of [...alive].sort(SORTS[sort] || SORTS.fast)) { if (ok.length >= MIN_OPTS) break; if (!ok.includes(o)) ok.push(o); }
  ok.sort(SORTS[sort] || SORTS.fast);
  return ok.slice(0, limit);
}
// 執走重複同「明顯差啲」嘅方案
function tidy(list, sort = 'fast'){
  list = [...list];
  list.sort(SORTS.fast);
  // 1) 同一組上落車站、只係路線唔同（例如 69X 轉 102 / 69X 轉 118）：合併做一個，註明「或搭」
  const groups = new Map(), out = [];
  for (const o of list) {
    if (o.walkOnly) { out.push(o); continue; }
    const n = o.legs.length;
    const key = o.legs.map((l, i) => stopName(l.board) + '>' + (i === n - 1 ? '' : stopName(l.alight))).join('|');
    const g = groups.get(key);
    if (g && o.arriveT - g.arriveT <= 5 * 60000) {
      o.legs.forEach((l, i) => { if (l.key !== g.legs[i].key) { const lab = routeLabel(rt(l.key)); const a = g.legs[i].alt || (g.legs[i].alt = []); if (lab !== routeLabel(rt(g.legs[i].key)) && !a.includes(lab)) a.push(lab); } });
      continue;
    }
    if (!g) groups.set(key, o);
    out.push(o);
  }
  // 2) 比最快方案遲好多先到（多過 35 分鐘或者成程時間嘅 60%）：唔要
  if (!out.length) return out;
  const best = Math.min(...out.map(o => o.arriveT)), t0 = Math.min(...out.map(o => o.leaveT));
  // 「最平」「少行路」容許慢好多（呢啲用家就係肯慢啲換平啲／少行啲）；「最早到」「少轉車」先執走慢太多嘅
  const slack = sort === 'cheap' || sort === 'walk' || sort === 'arrive' ? Math.max(90 * 60000, (best - t0)) : Math.max(35 * 60000, (best - t0) * 0.6);
  const ok = out.filter(o => o.arriveT - best <= slack);
  // 3) 有另一個方案轉少啲車、行多唔夠 6 分鐘（「少行路」就唔可以行多）、遲唔夠 2 分鐘到：呢個方案冇意思
  const walkTol = sort === 'walk' ? 0 : 6;
  return ok.filter(b => !ok.some(a => a !== b && a.legs.length < b.legs.length && !a.walkOnly
    && a.arriveT <= b.arriveT + 2 * 60000 && a.walkSum <= b.walkSum + walkTol && (b.fareUnknown || a.fareUnknown || a.fare <= b.fare + (sort === 'cheap' ? 0 : 4))));
}
export const toTrip = (o, from, to) => ({from, to, walk0: o.walk0, door: o.door || 0, walkEnd: o.walkEnd, legs: o.legs.map(l => ({key: l.key, co: l.co, board: l.board, bseq: l.bseq, alight: l.alight, aseq: l.aseq, walk: l.walk || 0}))});

/* ---------- 規劃頁 ---------- */
// mode：now = 而家出發、later = 揀出發時間、arrive = 幾點前要到
let bgRefresh = false, from = null, to = null, results = null, token = 0, open = 0, at = null, mode = 'now', sort = store.get('planSort', 'fast'), lastRun = 0, failed = false, paintCtlRef = () => {};
// 「你嘅位置」只限 GPS；手動揀咗地點（例如「旺角」）就顯示嗰個地點名，唔好令人以為用緊 GPS
const hereLabel = () => S.here?.mode === 'manual' && S.here.label ? S.here.label : L('你嘅位置', 'Your location');
// 地點名：記低中英文，轉語言都顯示啱嘅名
const labelOf = p => !p ? '' : p.here ? hereLabel() : p.name ? nm(p.name) || p.label : p.label;
const saveFT = () => store.set('planFT', {from, to, t: Date.now()});
const SORT_UI = [['fast', '最早到', 'Earliest arrival', '最早到', 'Earliest'], ['cheap', '最平', 'Cheapest', '最平', 'Cheap'], ['walk', '最少步行', 'Least walking', '少行路', 'Walk'], ['xfer', '最少轉車', 'Fewest changes', '少轉車', 'Direct']];
const localDT = t => { const d = new Date(t + 288e5); return d.toISOString().slice(0, 16); };
const fromLocalDT = v => Date.parse(v + ':00+08:00');
// 人睇嘅日期時間：「今晚 22:30」「聽朝 08:00」「11月28日（六）09:15」
const dayN = t => Math.floor((t + 288e5) / 864e5);
function friendlyDT(t){
  const d = dayN(t) - dayN(now()), h = new Date(t + 288e5).getUTCHours(), tm = hhmm(t);
  if (S.set.lang === 'en') return (d === 0 ? 'today ' : d === 1 ? 'tomorrow ' : new Date(t + 288e5).toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'}) + ' ') + tm;
  const part = h < 5 ? '凌晨' : h < 12 ? '朝' : h < 18 ? '' : '晚';
  if (d === 0) return (h < 5 ? '今日凌晨 ' : h < 12 ? '今朝 ' : h < 18 ? '今日 ' : '今晚 ') + tm;
  if (d === 1) return (h < 5 ? '聽日凌晨 ' : h < 12 ? '聽朝 ' : h < 18 ? '聽日 ' : '聽晚 ') + tm;
  const x = new Date(t + 288e5);
  return `${x.getUTCMonth() + 1}月${x.getUTCDate()}日（${'日一二三四五六'[x.getUTCDay()]}）${part ? part + ' ' : ''}${tm}`;
}
const toPoint = (p, here) => ({lat: p.lat, lng: p.lng, label: p.label, name: p.name || null, kind: p.kind || null, noDoor: !!p.noDoor, ...(here ? {here: true, label: hereLabel(), kind: null, noDoor: false} : {})});
export function initPlan(){
  const v = $('v-plan');
  v.innerHTML = `<div class="wrap">
    <h1 class="vh">${L('去邊度？', 'Where to?')}</h1>
    <div class="od">
      <div class="od-f"><span class="od-dot o" aria-hidden="true"></span><div class="search"><input id="pFrom" type="search" autocomplete="off" placeholder="${L('起點', 'From')}" aria-label="${L('起點', 'From')}"><div class="results" id="pFromR"></div></div></div>
      <div class="od-f"><span class="od-dot d" aria-hidden="true"></span><div class="search"><input id="pTo" type="search" autocomplete="off" placeholder="${L('目的地：地方、大廈或者車站', 'To: place, building or stop')}" aria-label="${L('目的地', 'To')}"><div class="results" id="pToR"></div></div></div>
      <button class="icon-btn swap" id="pSwap" type="button" aria-label="${L('對調起點同目的地', 'Swap start and destination')}">${icon.swap}</button>
    </div>
    <div class="pctl">
      <div class="seg" id="pWhen" role="group" aria-label="${L('出發時間', 'Departure time')}"><button type="button" data-w="now">${L('而家出發', 'Leave now')}</button><button type="button" data-w="later">${L('幾點出發', 'Leave at')}</button><button type="button" data-w="arrive">${L('幾點前到', 'Arrive by')}</button></div>
      <input type="datetime-local" id="pAt" aria-label="${L('日期同時間', 'Date and time')}" hidden>
    </div>
    <div class="seg full" id="pSort" role="group" aria-label="${L('排序', 'Sort')}">${SORT_UI.map(([k, zh, en, sz, se]) => `<button type="button" data-s="${k}" aria-label="${L(zh, en)}">${L(sz, se)}</button>`).join('')}</div>
    <details class="pinfo"><summary>${L('最多轉 3 次車 · 點計？', 'Up to 3 changes · how it works')}</summary><p>${L('包括巴士、小巴、港鐵、輕鐵同渡輪。「而家出發」用實時到站計，每分鐘自動更新；「幾點出發」「幾點前到」按時間表估。港鐵、輕鐵大約凌晨 1 點至 6 點冇車，嗰段時間會改搵通宵巴士。車費係八達通成人價，未計轉乘優惠。', 'Covers bus, minibus, MTR, Light Rail and ferries. Leave now uses live arrivals and refreshes every minute; Leave at / Arrive by use timetables. MTR and Light Rail stop roughly 1am–6am, so overnight buses are used then. Fares are adult Octopus, before interchange discounts.')}</p></details>
    <div id="pRes"></div></div>`;
  const fi = $('pFrom'), ti = $('pTo');
  const setFrom = p => { from = toPoint(p, p.kind === 'here'); fi.value = labelOf(from); saveFT(); run(); };
  const setTo = p => { to = toPoint(p, p.kind === 'here'); ti.value = labelOf(to); saveFT(); run(); };
  // current：用家打咗字但冇揀建議就離開，格入面會還原返而家用緊嘅地點，唔會「顯示 A、計緊 B」
  attachPicker(fi, $('pFromR'), setFrom, {places: true, saved: true, here: true, keep: true, current: () => labelOf(from)});
  attachPicker(ti, $('pToR'), setTo, {places: true, saved: true, here: true, keep: true, current: () => labelOf(to)});
  $('pSwap').onclick = () => { [from, to] = [to, from]; fi.value = labelOf(from); ti.value = labelOf(to); saveFT(); run(); };
  $('pRes').addEventListener('click', onRes);
  const paintCtl = () => {
    for (const b of $('pWhen').children) b.setAttribute('aria-pressed', String(b.dataset.w === mode));
    $('pAt').hidden = mode === 'now'; if (mode !== 'now' && at) { $('pAt').value = localDT(at); $('pAt').min = localDT(now()); }
    for (const b of $('pSort').children) b.setAttribute('aria-pressed', String(b.dataset.s === sort));
    $('pSort').hidden = mode === 'arrive';                     // 「幾點前到」固定按出門最遲排
  };
  $('pWhen').onclick = e => {
    const b = e.target.closest('[data-w]'); if (!b) return;
    mode = b.dataset.w;
    at = mode === 'now' ? null : (at || Math.ceil((now() + 3600e3) / 900e3) * 900e3);
    paintCtl(); run();
  };
  $('pAt').onchange = e => {
    const v = fromLocalDT(e.target.value); if (isNaN(v)) return;
    // 唔准揀已經過咗嘅時間：自動改返「而家出發」
    if (v < now() - 60000) { at = null; mode = 'now'; paintCtl(); toast(L('嗰個時間已經過咗，已改為而家出發', 'That time has passed — switched to Leave now')); run(); return; }
    at = v; run();
  };
  paintCtlRef = paintCtl;
  // 轉排序要重新搜尋：唔同排序要搵嘅方案唔同（例如最平嘅巴士方案）
  $('pSort').onclick = e => { const b = e.target.closest('[data-s]'); if (!b || b.dataset.s === sort) return; sort = b.dataset.s; store.set('planSort', sort); paintCtl(); run(); };
  paintCtl();
  // 起點終點只記 30 分鐘；之後再開就由「你嘅位置」開始，唔會用咗舊起點
  const saved = store.get('planFT', null);
  if (saved && Date.now() - (saved.t || 0) < 1800e3) { from = saved.from; to = saved.to; }
  // 「你嘅位置」（起點或者目的地）跟住 GPS 更新
  on('here', p => {
    if (!from || from.here) { from = toPoint(p, true); fi.value = labelOf(from); }
    if (to?.here) { to = toPoint(p, true); ti.value = labelOf(to); }
    if (!to) drawEmpty();                           // 攞到位置之後收起「未有起點」提示
    else if (!results && from && !$('v-plan').hidden && !$('pRes').querySelector('.loading')) run();   // 計緊就唔好重新開始（GPS 幾秒更新一次）   // 揀咗目的地先有位置：位置一到就自動計，唔會停喺「揀起點」
  });
  if ((!from || from.here) && S.here) from = toPoint(S.here, true);
  fi.value = labelOf(from); ti.value = labelOf(to);
  // 重新開 app／轉語言：記得起點終點就即刻計，唔會淨係得兩個格、下面一片空白
  if (from && to) setTimeout(() => run(false, true), 0);
  else if (!to) drawEmpty();
  on('places', () => { if (!to) drawEmpty(); });
  // 「而家出發」嘅結果每分鐘用最新實時到站重新計；過咗出門時間嘅方案會自動換走
  setInterval(() => { if (!$('v-plan').hidden && results && !document.hidden) { if (mode === 'now' && Date.now() - lastRun > 60000) run(true); else drawRes(); } }, 20000);
}
export function planTo(dest, origin){
  go('plan');
  if (origin) from = origin;
  else if ((!from || from.here) && S.here) from = toPoint(S.here, true);
  to = dest; saveFT();
  $('pFrom').value = labelOf(from); $('pTo').value = labelOf(to);
  run();
}
const STEPS = [['搵附近車站', 'Nearby stops'], ['計轉車路線', 'Connections'], ['攞實時到站', 'Live arrivals']];
function progressUI(n){
  const el = $('pProg'); if (!el) return;
  el.innerHTML = STEPS.map(([zh, en], i) => `<li class="${i + 1 < n ? 'done' : i + 1 === n ? 'now' : ''}"><span>${i + 1 < n ? '✓' : i + 1}</span>${L(zh, en)}</li>`).join('');
}
const setRes = html => { const el = $('pRes'); el._html = html; el.innerHTML = html; };
async function run(silent, auto){
  if (!to) { drawEmpty(); return; }
  if (!from) { results = null; setRes(`<div class="hero"><h1>${L('揀起點', 'Pick a start')}</h1><p>${L('喺上面揀起點，或者喺「附近」頁撳「定位」。', 'Choose a start above, or tap Locate on the Nearby tab.')}</p></div>`); return; }
  // 揀咗嘅時間已經過咗（例如頁面開咗好耐）：改返而家出發
  if (at && at < now() - 60000) { at = null; mode = 'now'; paintCtlRef(); if (!silent) toast(L('揀咗嘅時間已經過咗，改為而家出發', 'Chosen time has passed — showing Leave now')); }
  const my = ++token; lastRun = Date.now();
  // 起點同目的地喺同一個位置：唔使搭車
  if (dist(from, to) < 150) {
    results = null;
    setRes(`<div class="hero"><h1>${L('你已經喺目的地附近', 'You’re already there')}</h1><p>${L('起點同目的地相距唔夠 150 米，行過去就得。想搵其他地方可以改目的地。', 'Start and destination are under 150 m apart — just walk. Change the destination to plan another trip.')}</p></div>`);
    return;
  }
  if (!silent) {
    // 清走舊結果：計緊新路線嗰陣，每 20 秒嘅自動更新唔可以將舊方案（用新模式嘅字眼）畫返出嚟，用家亦唔會撳中舊方案開倒數
    open = 0; results = null;
    setRes(`<div class="loading big"><div class="bigflap" aria-hidden="true">${[...L('計路線', 'PLAN')].map(c => `<span class="f">${c}</span>`).join('')}</div><ol class="psteps" id="pProg"></ol></div>`);
    progressUI(1);
    await new Promise(r => setTimeout(r, 30));               // 等畫面先顯示「計緊」
  }
  let res = [], err = false;
  const opt = {sort, onStep: n => { if (my === token && !silent) progressUI(n); }};
  if (mode === 'arrive') opt.arriveBy = at; else if (mode === 'later') opt.at = at;
  try { res = await planTrip(from, to, 6, opt); } catch (e) { console.error(e); err = true; }
  if (my !== token) return;                                  // 用家已經改咗起點／目的地，舊結果唔要
  // 網絡斷咗：自動更新失敗就保留舊結果；用家主動搜尋就講清楚係網絡問題
  if (err || (!res.length && !navigator.onLine)) { if (silent && results) return; failed = true; results = []; drawRes(); return; }
  failed = false;
  if (silent && results && results[open]) { const sig = legsSig(results[open]); const k = res.findIndex(o => legsSig(o) === sig); open = k; }
  results = res;
  if (!silent && !auto) { countDest(to); rememberDest(to); }              // 自動重算（重開 app）唔計入「常去」次數
  drawRes();
}
const legsSig = o => o.legs.map(l => l.key + l.board).join('>');

/* ---------- 未揀目的地：一撳就計（屋企、公司、常用地點、最近去過） ---------- */
let quick = [];
const recent = () => store.get('planRecent', []);
function rememberDest(p){
  if (!p || p.here || isSavedPlace(p)) return;      // 屋企、公司本身已經有掣，唔使再記
  const r = recent().filter(x => dist(x, p) > 150);
  r.unshift({lat: p.lat, lng: p.lng, label: labelOf(p), name: p.name || null, kind: p.kind || null, noDoor: !!p.noDoor});
  store.set('planRecent', r.slice(0, 6));
}
function drawEmpty(){
  results = null;
  const fav = [];
  if (places.home) fav.push({ic: '⌂', t: L('屋企', 'Home'), p: {...places.home, label: places.home.label}});
  if (places.work) fav.push({ic: '▤', t: L('學校／公司', 'School / Work'), p: {...places.work}});
  for (const c of places.custom || []) fav.push({ic: '★', t: c.label, p: {...c}});
  const rec = recent().filter(r => !fav.some(f => dist(f.p, r) < 150)).slice(0, 5).map(r => ({ic: '', t: r.label, p: r, rec: true}));
  quick = [...fav, ...rec];
  const btn = (q, i) => `<button class="qk${q.rec ? ' rec' : ''}" type="button" data-q="${i}">${q.rec ? icon.clock : `<span class="qk-i" aria-hidden="true">${q.ic}</span>`}<span class="qk-t"><b>${esc(q.t)}</b>${q.rec || q.t === q.p.label ? '' : `<small>${esc(q.p.label || '')}</small>`}</span></button>`;
  setRes(`${!from ? `<p class="hint">${L('未有起點：喺上面揀，或者喺「附近」頁撳「定位」。', 'No start yet — pick one above or tap Locate on Nearby.')}</p>` : ''}
    <h2 class="sec">${L('一撳就計', 'One tap')}</h2>
    ${fav.length ? `<div class="qk-grid">${fav.map((q, i) => btn(q, i)).join('')}</div>` : `<button class="btn-d big" type="button" data-setplaces>${icon.star(false)}<span>${L('設定屋企同學校／公司', 'Set Home and School / Work')}</span></button><p class="hint">${L('設定咗之後，呢度一撳就計到點去。', 'Then they are one tap away here.')}</p>`}
    ${rec.length ? `<h2 class="sec">${L('最近去過', 'Recent')}<button class="btn-d sm sec-x" type="button" data-clearrec>${L('清除', 'Clear')}</button></h2><div class="qk-list">${rec.map((q, k) => btn(q, fav.length + k)).join('')}</div>` : ''}`);
}

/* ---------- 常去地點建議：查咗同一個目的地 3 次，問用家使唔使設做常用地點 ---------- */
const dkey = p => p.lat.toFixed(3) + ',' + p.lng.toFixed(3);
const isSavedPlace = p => [places.home, places.work, ...(places.custom || [])].some(x => x && dist(x, p) < 250);
let lastCounted = '';
function countDest(p){
  if (!p || p.here || isSavedPlace(p)) return;
  const c = store.get('destCount', {}), k = dkey(p);
  if (k === lastCounted) return;                    // 轉排序、轉時間唔算多查一次
  lastCounted = k;
  c[k] = (c[k] || 0) + 1; store.set('destCount', c);
}
function suggestHtml(){
  if (!to || to.here || isSavedPlace(to)) return '';
  const k = dkey(to), c = store.get('destCount', {}), no = store.get('destNo', []);
  if ((c[k] || 0) < 3 || no.includes(k)) return '';
  return `<div class="notice sugg"><p>${L(`你已經查過 ${c[k]} 次去「${esc(labelOf(to))}」，設做常用地點？之後喺「常用」頁一撳就計到。`, `You’ve planned to “${esc(labelOf(to))}” ${c[k]} times — save it? It will be one tap away on Saved.`)}</p>
    <div>${!places.home ? `<button class="btn-d sm" data-save="home" type="button">${L('設為屋企', 'Home')}</button>` : ''}${!places.work ? `<button class="btn-d sm" data-save="work" type="button">${L('設為學校／公司', 'School / Work')}</button>` : ''}<button class="btn-d sm" data-save="custom" type="button">${L('加做常用地點', 'Add to places')}</button><button class="btn-d sm" data-save="no" type="button">${L('唔使', 'No thanks')}</button></div></div>`;
}

export function legChips(o){
  const dr = o.door ? `<span class="lc walk door" title="${esc(o.doorWhy || '')}" aria-label="${esc(L(`落樓等𨋢 ${o.door} 分鐘`, `${o.door} min lift/stairs`) + (o.doorWhy ? '（' + o.doorWhy + '）' : ''))}"><b>${L('落樓', 'Lift')}</b>${o.door}′</span>` : '';
  if (o.walkOnly) return `${dr}<span class="lc walk">${icon.walk}${o.walk0 - (o.door || 0)}′</span>`;
  const parts = [`${dr}<span class="lc walk" aria-label="${esc(L(`行 ${o.walk0 - (o.door || 0)} 分鐘`, `walk ${o.walk0 - (o.door || 0)} min`))}">${icon.walk}${o.walk0 - (o.door || 0)}′</span>`];
  o.legs.forEach((l, i) => {
    const r = rt(l.key);
    if (i > 0 && l.walk) parts.push(`<span class="lc walk">${icon.walk}${l.walk}′</span>`);
    parts.push(`<span class="lc">${tilesFor(r)}${l.alt?.length ? `<span class="lc-alt">/${esc(l.alt.slice(0, 2).join('/'))}${l.alt.length > 2 ? '…' : ''}</span>` : ''}</span>`);
  });
  if (o.walkEnd) parts.push(`<span class="lc walk">${icon.walk}${o.walkEnd}′</span>`);
  return parts.join('<span class="lc-sep" aria-hidden="true">›</span>');
}
export function steps(o){
  const why = o.doorWhy ? `<small class="why">（${esc(o.doorWhy)}）</small>` : '';
  const dTxt = o.door ? L(`落樓等𨋢 ${o.door} 分鐘${why}，再`, `${o.door} min down & lift${why}, then `) : '';
  if (o.walkOnly) return `<li><b>${hhmm(o.leaveT)}</b> ${L(`出門，${dTxt}直接行過去，約 ${o.walk0 - (o.door || 0)} 分鐘`, `Leave, ${dTxt}walk there, about ${o.walk0 - (o.door || 0)} min`)}</li>`;
  const out = [], fg = new Map();
  for (const g of fareGroups(o.legs)) for (let k = g.from; k <= g.to; k++) fg.set(k, k === g.from ? (g.f != null ? ' · ' + money(g.f) + (g.to > g.from ? L('（港鐵全程）', ' (whole MTR trip)') : '') : '') : ' · ' + L('站內轉綫，唔使再俾錢', 'in-station change, no extra fare'));
  o.legs.forEach((l, i) => {
    const r = rt(l.key), tm = o.times[i], nStops = l.aseq - l.bseq, ride = Math.round(rideMin(r, l.co, l.bseq, l.aseq));
    const name = routeLabel(r);
    const plat = tm.plat ? ' · ' + L(`${esc(tm.plat)} 號月台`, `Platform ${esc(tm.plat)}`) : '';
    if (i === 0) out.push(`<li><b>${hhmm(o.leaveT)}</b> ${L(`出門，${dTxt}行 ${o.walk0 - (o.door || 0)} 分鐘去 ${esc(stopName(l.board))}`, `Leave, ${dTxt}walk ${o.walk0 - (o.door || 0)} min to ${esc(stopName(l.board))}`)}</li>`);
    else out.push(`<li><b>${hhmm(o.times[i - 1].alightT)}</b> ${l.walk ? L(`行 ${l.walk} 分鐘去 ${esc(stopName(l.board))} 轉車`, `Walk ${l.walk} min to ${esc(stopName(l.board))}`) : L(`喺 ${esc(stopName(l.board))} 轉車`, `Change at ${esc(stopName(l.board))}`)}</li>`);
    out.push(`<li class="ride"><b class="${tm.live ? 'live' : ''}">${hhmm(tm.boardT)}</b> ${L(`搭 ${esc(name)} 往 ${destHtml(nm(r.dest))}`, `Take ${esc(name)} towards ${destHtml(nm(r.dest))}`)}<small>${coName(l.co)}${plat} · ${L(`坐 ${nStops} 個站，約 ${ride} 分鐘`, `${nStops} stops, ~${ride} min`)}${fg.get(i) || ''}${tm.live ? '' : ' · <span class="est">' + (l.co === 'mtr' || l.co === 'lightRail' ? L('暫時冇實時班次，按平均班距估算', 'no live times yet — estimated from usual frequency') : L('時間表估算，可能有變', 'timetable estimate, may change')) + '</span>'}${l.alt?.length ? '<br>' + L(`${esc(l.alt.join('、'))} 都得，邊班先到搭邊班`, `${esc(l.alt.join(', '))} also work — take whichever comes first`) : ''}</small></li>`);
    out.push(`<li><b>${hhmm(tm.alightT)}</b> ${L(`喺 ${esc(stopName(l.alight))} 落車`, `Get off at ${esc(stopName(l.alight))}`)}</li>`);
  });
  out.push(`<li class="end"><b>${hhmm(o.arriveT)}</b> ${o.walkEnd ? L(`行 ${o.walkEnd} 分鐘到目的地`, `Walk ${o.walkEnd} min to destination`) : L('到達', 'Arrive')}</li>`);
  return out.join('');
}
function drawRes(){
  const el = $('pRes');
  if (!results) return;
  // 「而家出發」：過咗出門時間（超過 1 分鐘）嘅方案即刻收起，唔會排喺頭位；全部都過咗就背景重新計
  if (mode === 'now' && !failed && results.length) {
    const keep = results.filter(o => o.walkOnly || o.leaveT >= now() - 60000);
    if (keep.length < results.length) {
      if (!bgRefresh) { bgRefresh = true; setTimeout(() => run(true).finally(() => { bgRefresh = false; }), 0); }
      if (keep.length) {
        const sig = results[open] && legsSig(results[open]);
        results = keep;
        // 打開咗嗰個方案冇咗：改為打開而家最好嗰個；用家本身收埋晒就保持收埋
        if (sig) { open = results.findIndex(o => legsSig(o) === sig); if (open < 0) open = 0; }
      }
    }
  }
  let html;
  if (failed) html = `<div class="hero"><h1>${L('連唔到網絡', 'Can’t connect')}</h1><p>${L('計唔到路線，唔係因為冇車。請檢查網絡再試。', 'Couldn’t plan the trip — this is a connection problem, not a lack of service.')}</p><button class="btn-y" data-retry type="button">${L('再試一次', 'Try again')}</button></div>`;
  else if (!results.length) html = `<div class="hero"><h1>${L('搵唔到路線', 'No routes found')}</h1><p>${mode === 'arrive' ? L('喺你揀嘅時間之前到唔切，試下揀遲啲嘅到達時間。', 'Nothing gets you there in time — try a later arrival time.') : L('起點或者目的地附近冇車站，或者嗰個時間冇車行。', 'No stops near either end, or nothing runs at that time.')}</p></div>`;
  else {
    const sl = SORT_UI.find(x => x[0] === sort) || SORT_UI[0];
    const head = mode === 'arrive' ? L(`${results.length} 個方案 · ${friendlyDT(at)} 前到 · 出門最遲排先（按時間表估）`, `${results.length} options · arrive by ${friendlyDT(at)} · latest departure first (timetable)`)
      : `${L(`${results.length} 個方案 · 按${sl[1]}排`, `${results.length} options · ${sl[2].toLowerCase()} first`)}${mode === 'later' ? ' · ' + L(`${friendlyDT(at)} 出發（按時間表估）`, `leaving ${friendlyDT(at)} (timetable)`) : ' · ' + L('每分鐘自動更新', 'auto-updates every minute')}`;
    const off = !navigator.onLine ? `<div class="notice"><p>${L('而家冇網絡：以下時間全部係時間表估算，未必準。', 'You’re offline — all times below are timetable estimates.')}</p></div>` : '';
    html = off + suggestHtml() + `<p class="lbl pad">${head}</p>` + results.map((o, i) => {
      const tot = Math.max(1, Math.round((o.arriveT - o.leaveT) / 60000)), lv = mins(o.leaveT);
      const xf = Math.max(0, o.legs.length - 1);
      const sched = mode !== 'now';
      return `<article class="opt${i === open ? ' open' : ''}" data-i="${i}">
      <button class="opt-h" type="button" aria-expanded="${i === open}">
        <span class="opt-arr"><small>${L('約', 'Arrive')}</small>${hhmm(o.arriveT)}<small>${L('到', '')}</small></span>
        <span class="opt-m"><span class="legs">${legChips(o)}</span>
        <small>${sched ? `<b class="go">${L(`${hhmm(o.leaveT)} 出門`, `Leave ${hhmm(o.leaveT)}`)}</b>` : lv < -1 ? `<b class="late">${L('已過出門時間', 'Leave time passed')}</b>` : lv <= 0 ? `<b class="go">${L('而家出門', 'Leave now')}</b>` : `<b class="go">${L(`${hhmm(o.leaveT)} 出門`, `Leave ${hhmm(o.leaveT)}`)}</b> · ${L(`${lv} 分鐘後`, `in ${lv} min`)}`} · ${L(`全程 ${tot} 分鐘`, `${tot} min door to door`)}${o.legs.length ? ' · ' + (xf ? L(`轉 ${xf} 次車`, `${xf} change${xf > 1 ? 's' : ''}`) : L('直達', 'direct')) : ''}${o.legs.length ? ' · ' + (o.fareUnknown ? (o.fare ? money(o.fare) + L(' + 部分車費未知', ' + some fares unknown') : L('車費未知', 'fare unknown')) : money(o.fare)) : ''}${o.walkSum ? ' · ' + L(`行 ${o.walkSum} 分鐘`, `${o.walkSum} min walk`) : ''}${o.unsure && !sched ? ' · <span class="est">' + L('部分時間係估算', 'partly estimated') + '</span>' : ''}</small></span></button>
      ${i === open ? `<div class="opt-x"><ol class="steps">${steps(o)}</ol>${actions(o)}</div>` : ''}
    </article>`;
    }).join('');
  }
  // 內容冇變就唔重畫（每 20 秒檢查一次），免得閃、免得跳位
  if (el._html === html) return;
  setRes(html);
}
// 方案地圖：每程車一種顏色，畫出上落車站同轉車位
// 每個方案嘅掣：
// · 出門倒數只可以用喺 45 分鐘內出發：太遲就直接講清楚幾點先開到，同時俾「加入行事曆提醒」
// · 淨係行路嘅方案：睇地圖 + 用手機地圖步行導航
const COUNT_MAX = 45 * 60000;
function actions(o){
  const mapBtn = `<button class="btn-d big" data-map type="button">${icon.pin}<span>${L('睇地圖', 'Map')}</span></button>`;
  if (o.walkOnly) return `<div class="sh-btns"><a class="btn-y big" href="${esc(walkNavUrl())}" target="_blank" rel="noopener">${icon.walk}<span>${L('步行導航', 'Walking directions')}</span></a>${mapBtn}</div>`;
  const lv = mode === 'now' ? now() : o.leaveT;
  if (lv - now() > COUNT_MAX) return `<div class="sh-btns"><button class="btn-y big" data-cal type="button">${icon.bell}<span>${L('加入行事曆提醒', 'Add calendar reminder')}</span></button>${mapBtn}</div>
    <p class="hint opt-note">${L(`出門倒數喺出門前 45 分鐘先開到（${hhmm(o.leaveT - COUNT_MAX)} 起）。可以先加行事曆提醒，到時再返嚟開倒數。`, `The countdown opens 45 min before leaving (from ${hhmm(o.leaveT - COUNT_MAX)}). Add a calendar reminder for now.`)}</p>`;
  return `<div class="sh-btns"><button class="btn-y big" data-go type="button">${icon.door}<span>${L('開始出門倒數', 'Start leave countdown')}</span></button>${mapBtn}</div>`;
}
const IOS_UA = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const walkNavUrl = () => IOS_UA ? `https://maps.apple.com/?saddr=${from.lat},${from.lng}&daddr=${to.lat},${to.lng}&dirflg=w`
  : `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=walking`;
// 遲啲先出發嘅方案：下載一個行事曆提醒（出門前 5 分鐘 + 出門時各響一次）
function calReminder(o){
  const stamp = t => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const first = o.legs[0], name = first ? routeLabel(rt(first.key)) : '';
  const title = L(`港住走：${hhmm(o.leaveT)} 出門${name ? '搭 ' + name : ''}`, `Rushing HK: leave ${hhmm(o.leaveT)}${name ? ' for ' + name : ''}`).replace(/[,;\n]/g, ' ');
  const desc = L(`去 ${labelOf(to)}，約 ${hhmm(o.arriveT)} 到。出門前返嚟港住走睇最新班次。`, `To ${labelOf(to)}, arrive ~${hhmm(o.arriveT)}. Check Rushing HK for live times before leaving.`).replace(/[,;\n]/g, ' ');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HKGO//Plan//ZH', 'BEGIN:VEVENT', `UID:hkgo-plan-${Date.now()}@hkgo`, `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(o.leaveT)}`, `DTEND:${stamp(o.arriveT)}`, `SUMMARY:${title}`, `DESCRIPTION:${desc}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'TRIGGER:-PT5M', 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], {type: 'text/calendar;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = 'hkgo-leave.ics'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast(L('打開檔案就加到行事曆；出門前 5 分鐘會提你', 'Open the file to add it — it alerts 5 min before'), 4500);
}
function planMap(o){
  openSheet(`<div class="sh-head"><div><b>${L('行程地圖', 'Trip map')}</b><small>${esc(labelOf(from))} → ${esc(labelOf(to))}</small></div></div><div class="pmap" id="pmap"></div>`, async card => {
    try {
      const el = card.querySelector('#pmap');
      const m = await makeMap(el, from, 14), Lf = window.L, all = [[from.lat, from.lng]];
      o.legs.forEach((l, i) => {
        const r = rt(l.key), st = r.stops[l.co].slice(l.bseq, l.aseq + 1).map(stopLoc).filter(Boolean).map(p => [p.lat, p.lng]);
        const c = l.co === 'mtr' ? lineColor(r.route) : l.co === 'lightRail' ? lrtColor(r.route) : FERRY.has(l.co) ? '#4aa3df' : coColor(l.co);
        if (st.length) { Lf.polyline(st, {color: c, weight: 6, opacity: .95}).addTo(m); all.push(...st);
          Lf.marker(st[0], {icon: pin(String(i + 1), 'board', 26)}).bindTooltip(stopName(l.board)).addTo(m);
          Lf.marker(st[st.length - 1], {icon: pin('', 'alight', 16)}).bindTooltip(stopName(l.alight)).addTo(m); }
      });
      all.push([to.lat, to.lng]);
      if (o.walkOnly) Lf.polyline([[from.lat, from.lng], [to.lat, to.lng]], {color: '#ffc917', weight: 4, dashArray: '6 8'}).addTo(m);
      Lf.marker([from.lat, from.lng], {icon: pin(L('起', 'A'), 'sel', 26)}).addTo(m);
      Lf.marker([to.lat, to.lng], {icon: pin(L('到', 'B'), 'sel', 26)}).addTo(m);
      m.fitBounds(Lf.latLngBounds(all), {padding: [24, 24]});
    } catch { card.querySelector('#pmap').innerHTML = `<p class="loading">${L('地圖載入唔到', 'Map unavailable')}</p>`; }
  });
}
function onRes(e){
  if (e.target.closest('[data-retry]')) { run(); return; }
  const q = e.target.closest('[data-q]');
  if (q) { const x = quick[+q.dataset.q]; if (x) { to = toPoint({...x.p, label: x.t === x.p.label || x.rec ? x.p.label : x.t}); $('pTo').value = labelOf(to); saveFT(); run(); } return; }
  if (e.target.closest('[data-setplaces]')) { go('saved'); return; }
  if (e.target.closest('[data-clearrec]')) { store.del('planRecent'); drawEmpty(); return; }
  const sv = e.target.closest('[data-save]');
  if (sv) {
    const k = sv.dataset.save, v = {lat: to.lat, lng: to.lng, label: labelOf(to)};
    if (k === 'no') { store.set('destNo', [...store.get('destNo', []), dkey(to)]); }
    else { if (k === 'home') places.home = v; else if (k === 'work') places.work = v; else places.custom = [...(places.custom || []), v]; savePlaces(); toast(L('已儲存', 'Saved')); }
    $('pRes')._html = ''; drawRes(); return;
  }
  const art = e.target.closest('.opt'); if (!art) return;
  const i = +art.dataset.i;
  if (e.target.closest('[data-map]')) { planMap(results[i]); return; }
  if (e.target.closest('[data-cal]')) { calReminder(results[i]); return; }
  if (e.target.closest('[data-go]')) {
    startTrip({...toTrip(results[i], from, to), alts: {from, to}}); return;
  }
  if (e.target.closest('.opt-h')) { open = open === i ? -1 : i; drawRes(); }
}
