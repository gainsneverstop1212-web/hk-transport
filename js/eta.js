// 港途 · 實時到站
import {S, T, L, FERRY, nextDepartures, now, syncClock} from './core.js';

let active = 0; const queue = [];
export function J(url, opt){
  return new Promise((res, rej) => {
    const run = () => {
      active++;
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
      fetch(url, {cache: 'no-store', signal: ctl.signal, ...opt})
        .then(r => { if (!r.ok) throw new Error(r.status); S.online = true; S.lastOk = Date.now(); return r.json(); })
        .then(res, e => { if (!navigator.onLine) S.online = false; rej(e); })
        .finally(() => { clearTimeout(to); active--; if (queue.length) queue.shift()(); });
    };
    active < 8 ? run() : queue.push(run);
  });
}
export const cycle = () => new Map();
const once = (memo, k, f) => { if (!memo.has(k)) memo.set(k, f().catch(e => ({__err: e}))); return memo.get(k); };
const isSched = s => /原定|預定|預計|scheduled/i.test(s || '');
const rmkOf = (zh, en) => (S.set.lang === 'en' ? en : zh) || zh || '';

const kmbStop = (m, id) => once(m, 'kmb' + id, () => J(`https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/${id}`));
const gmbStop = (m, id) => once(m, 'gmb' + id, () => J(`https://data.etagmb.gov.hk/eta/stop/${id}`));
const mtrSta = (m, line, id) => once(m, `mtr${line}${id}`, () => J(`https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${line}&sta=${id}&lang=${S.set.lang === 'en' ? 'EN' : 'TC'}`));
const lrtSta = (m, id) => once(m, 'lrt' + id, () => J(`https://rt.data.gov.hk/v1/transport/mtr/lrt/getSchedule?station_id=${parseInt(String(id).slice(2), 10)}`));
const mtrBus = (m, route) => once(m, 'mb' + route, () => J('https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({language: S.set.lang === 'en' ? 'en' : 'zh', routeName: route})}));

// 一條路線喺一個站嘅到站時間 → {list:[{t,rmk,sched,plat}], note, err}
export async function etaFor(memo, co, r, stopId, seq){
  const out = {list: [], note: '', err: false}, bound = r.bound?.[co] || '';
  const add = (t, rmk = '', x = {}) => { if (t != null) out.list.push({t, rmk, sched: x.sched ?? isSched(rmk), ...x}); else if (rmk && !out.note) out.note = rmk; };
  try {
    if (co === 'kmb') {
      const d = await kmbStop(memo, stopId); if (d.__err) throw d.__err; if (d.generated_timestamp) syncClock(d.generated_timestamp);
      for (const e of d.data || []) if (e.route === r.route && bound.includes(e.dir) && String(e.service_type) === String(r.serviceType)) add(T(e.eta), rmkOf(e.rmk_tc, e.rmk_en));
    } else if (co === 'ctb') {
      const d = await once(memo, `ctb${stopId}/${r.route}`, () => J(`https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/${stopId}/${encodeURIComponent(r.route)}`)); if (d.__err) throw d.__err;
      for (const e of d.data || []) if (bound.includes(e.dir)) add(T(e.eta), rmkOf(e.rmk_tc, e.rmk_en));
    } else if (co === 'gmb') {
      const d = await gmbStop(memo, stopId); if (d.__err) throw d.__err;
      const rs = bound === 'I' ? 2 : 1;
      for (const e of d.data || []) if (String(e.route_id) === String(r.gtfsId) && e.route_seq === rs && e.stop_seq === seq + 1) {
        if (!e.enabled) { out.note = rmkOf(e.description_tc, e.description_en) || L('暫停服務', 'Suspended'); continue; }
        for (const x of e.eta || []) add(T(x.timestamp), rmkOf(x.remarks_tc, x.remarks_en));
      }
    } else if (co === 'nlb') {
      const d = await once(memo, `nlb${r.nlbId}/${stopId}`, () => J(`https://rt.data.gov.hk/v2/transport/nlb/stop.php?action=estimatedArrivals&routeId=${r.nlbId}&stopId=${stopId}&language=${S.set.lang === 'en' ? 'en' : 'zh'}`)); if (d.__err) throw d.__err;
      for (const e of d.estimatedArrivals || []) add(T(e.estimatedArrivalTime), e.departed === '1' ? L('已開出', 'Departed') : '', {sched: e.noGPS === '1'});
      if (!out.list.length && d.message) out.note = d.message;
    } else if (co === 'lrtfeeder') {
      const d = await mtrBus(memo, r.route); if (d.__err) throw d.__err;
      const b = (d.busStop || []).find(x => x.busStopId === stopId);
      for (const x of (b && b.bus) || []) {
        const sec = Number(x.arrivalTimeInSecond) > 0 ? Number(x.arrivalTimeInSecond) : Number(x.departureTimeInSecond);
        if (isFinite(sec)) add(now() + sec * 1000, x.busRemark || '', {sched: String(x.isScheduled) === '1'});
      }
      if (!b && d.routeStatusRemarkTitle) out.note = d.routeStatusRemarkTitle;
    } else if (co === 'mtr') {
      const d = await mtrSta(memo, r.route, stopId); if (d.__err) throw d.__err;
      const v = d.data?.[`${r.route}-${stopId}`] || {}, after = new Set((r.stops.mtr || []).slice(seq + 1));
      for (const e of v[bound.startsWith('U') ? 'UP' : 'DOWN'] || []) if (after.has(e.dest)) add(T(e.time), '', {plat: e.plat, dest: e.dest, sched: false});
      if (!out.list.length && d.isdelay === 'Y') out.note = L('列車服務延誤', 'Train service delayed');
    } else if (co === 'lightRail') {
      const d = await lrtSta(memo, stopId); if (d.__err) throw d.__err;
      for (const p of d.platform_list || []) for (const e of p.route_list || []) {
        if (e.stop && e.stop !== 0) continue;
        if (e.route_no !== r.route || !(e.dest_ch === r.dest.zh || /circular/i.test(e.dest_en || ''))) continue;
        const te = String(e.time_en || ''), m = /arriv|depart|^-$/i.test(te) ? 0 : parseInt(te, 10);
        if (isFinite(m)) add(now() + m * 60000, '', {plat: p.platform_id, sched: false});
      }
    } else if (FERRY.has(co)) {
      for (const t of nextDepartures(r, co, seq)) add(t, L('時間表', 'Timetable'), {sched: true});
      if (!out.list.length) out.note = L('今日冇班次', 'No more sailings today');
    }
  } catch (e) { out.err = true; }
  out.list.sort((a, b) => a.t - b.t);
  out.list = out.list.filter((e, i, a) => !i || e.t - a[i - 1].t > 45000);
  return out;
}

// 港鐵站：按實際目的地分組（附近頁用）
export async function mtrBoard(memo, stopId, lines){
  const rows = [];
  for (const ln of lines) {
    const d = await mtrSta(memo, ln, stopId);
    if (d.__err || !d.data) { rows.push({kind: 'mtr', key: `mtr:${ln}:${stopId}`, line: ln, sta: stopId, dest: null, etas: [], err: true}); continue; }
    const v = d.data[`${ln}-${stopId}`] || {}; let any = false;
    for (const dir of ['UP', 'DOWN']) {
      const by = new Map();
      for (const e of v[dir] || []) {
        if (!by.has(e.dest)) by.set(e.dest, {kind: 'mtr', key: `mtr:${ln}:${stopId}:${dir}:${e.dest}`, line: ln, sta: stopId, dir, dest: e.dest, plat: e.plat, etas: []});
        by.get(e.dest).etas.push({t: T(e.time), rmk: '', sched: false});
      }
      for (const x of by.values()) { rows.push(x); any = true; }
    }
    if (!any) rows.push({kind: 'mtr', key: `mtr:${ln}:${stopId}`, line: ln, sta: stopId, dest: null, etas: [], note: d.isdelay === 'Y' ? L('列車服務延誤', 'Delayed') : L('暫無班次', 'No trains')});
  }
  return rows;
}
// 輕鐵站：按路線 + 目的地分組
export async function lrtBoard(memo, stopId){
  const d = await lrtSta(memo, stopId);
  if (d.__err) return [{kind: 'lrt', key: 'lrt:' + stopId, route: '', dest: null, etas: [], err: true}];
  const pl = d.platform_list || [];
  if (!pl.length || pl.every(p => p.end_service_status)) return [{kind: 'lrt', key: 'lrt:' + stopId, route: '', dest: null, etas: [], note: L('今日服務已結束', 'Service ended for today')}];
  const m = new Map();
  for (const p of pl) for (const e of p.route_list || []) {
    if (e.stop && e.stop !== 0) continue;
    const k = `lrt:${stopId}:${e.route_no}:${e.dest_ch}`;
    if (!m.has(k)) m.set(k, {kind: 'lrt', key: k, route: e.route_no, dest: {zh: e.dest_ch, en: e.dest_en}, plat: p.platform_id, etas: []});
    const te = String(e.time_en || ''), mm = /arriv|depart|^-$/i.test(te) ? 0 : parseInt(te, 10);
    if (isFinite(mm)) m.get(k).etas.push({t: now() + mm * 60000, rmk: e.train_length ? L(`${e.train_length} 卡`, `${e.train_length}-car`) : '', sched: false});
  }
  return [...m.values()];
}
