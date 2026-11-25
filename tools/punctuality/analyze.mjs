// 港住走 · 準時度分析：由 collect.mjs 記低嘅到站預報，推算每班車實際幾時到、預報準唔準、幾多「幽靈巴士」
// 用法：node tools/punctuality/analyze.mjs <raw 資料夾> <輸出 summary.json>
// 方法（只靠預報本身，唔使 GPS）：
//   · 一班車嘅預報一路倒數，到咗就喺下一次記錄消失 → 最後一次預報 ≈ 實際到站時間
//   · 「遲咗幾多」= 實際到站 −（大約 10 分鐘前嗰陣嘅預報）；正數 = 比預報遲
//   · 幽靈巴士 = 預報仲有 3 分鐘以上就到，下一次記錄就無啦啦唔見咗，而且附近冇另一班補上
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RAW = process.argv[2] || join(here, 'raw'), OUT = process.argv[3] || join(here, 'summary.json');
const {watch} = JSON.parse(readFileSync(join(here, 'watch.json'), 'utf8'));
const MAX_GAP = 150, MATCH = 120, GHOST_LEAD = 180, LOOK = 600;

export function analyseSeries(samples){
  // samples：同一個 watch、按時間排好嘅 [{t, e:[...], s:[...]}]
  const arrivals = [], ghosts = [];
  for (let k = 1; k < samples.length; k++) {
    const a = samples[k - 1], b = samples[k];
    if (b.t - a.t > MAX_GAP) continue;                       // 中間斷咗（排程冇行）就唔判斷
    const live = a.e.map((t, i) => ({t, s: a.s?.[i]})).filter(x => !x.s);
    for (const p of live) {
      if (p.t - a.t > LOOK) continue;                        // 只睇就快到嗰啲
      if (b.e.some(t => Math.abs(t - p.t) <= MATCH)) continue;   // 仲喺度（可能微調咗）
      const lead = p.t - b.t;
      if (lead >= GHOST_LEAD && !b.e.some(t => Math.abs(t - p.t) <= 180)) ghosts.push({t: b.t, predicted: p.t});
      else arrivals.push({actual: p.t});
    }
  }
  // 每班到咗嘅車，搵佢大約 10 分鐘前（8–12 分鐘）嘅預報
  const late = [];
  for (const ar of arrivals) {
    // 揀最接近「到站前 10 分鐘」嗰次記錄，再喺入面揀對應呢班車嘅預報
    const x = samples.filter(x => ar.actual - x.t >= 480 && ar.actual - x.t <= 720).sort((p, q) => Math.abs(ar.actual - 600 - p.t) - Math.abs(ar.actual - 600 - q.t))[0];
    let best = null;
    if (x) for (let i = 0; i < x.e.length; i++) { if (x.s?.[i]) continue; const d = ar.actual - x.e[i]; if (Math.abs(d) <= 480 && (best == null || Math.abs(d) < Math.abs(best))) best = d; }
    if (best != null) late.push(best / 60);
  }
  return {arrivals: arrivals.length, ghosts: ghosts.length, late};
}
const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const r1 = v => v == null ? null : Math.round(v * 10) / 10;

function main(){
  let files = [];
  try { files = readdirSync(RAW).filter(f => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)).sort(); } catch {}
  const per = watch.map(() => ({days: new Set(), arrivals: 0, ghosts: 0, late: [], samples: 0, sched: 0, slots: 0}));
  for (const f of files) {
    const byW = new Map();
    for (const line of readFileSync(join(RAW, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (r.err || !per[r.w]) continue;
      if (!byW.has(r.w)) byW.set(r.w, []);
      byW.get(r.w).push(r);
    }
    for (const [w, arr] of byW) {
      arr.sort((a, b) => a.t - b.t);
      const x = analyseSeries(arr), p = per[w];
      p.days.add(f.slice(0, 10)); p.arrivals += x.arrivals; p.ghosts += x.ghosts; p.late.push(...x.late); p.samples += arr.length;
      for (const s of arr) { p.slots += s.s?.length || 0; p.sched += (s.s || []).filter(Boolean).length; }
    }
  }
  const out = {generated: new Date().toISOString(), note: '遲 = 實際到站減 10 分鐘前嘅預報（分鐘，正數係比預報遲）；幽靈 = 預報 3 分鐘以上就到但突然消失',
    watch: watch.map((w, i) => { const p = per[i]; const n = p.arrivals + p.ghosts; return {
      co: w.co, route: w.route, dir: w.dir, stop: w.stop, name: w.name, days: p.days.size, samples: p.samples,
      arrivals: p.arrivals, ghosts: p.ghosts, ghostRate: n ? r1(p.ghosts / n * 100) : null,
      lateAvg: p.late.length ? r1(p.late.reduce((a, b) => a + b, 0) / p.late.length) : null, lateP90: r1(pct(p.late, 0.9)), lateN: p.late.length,
      schedShare: p.slots ? r1(p.sched / p.slots * 100) : null}; })};
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  for (const w of out.watch) console.log(`${w.name}: ${w.days} 日 · ${w.arrivals} 班到站 · 平均比 10 分鐘前預報遲 ${w.lateAvg ?? '—'} 分鐘（90% ≤ ${w.lateP90 ?? '—'}）· 幽靈 ${w.ghosts}（${w.ghostRate ?? '—'}%）`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
