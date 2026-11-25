// 港途 · 準時度紀錄：定時記低到站預報（俾 GitHub Actions 排程行，亦可以喺自己部機行）
// 用法：node tools/punctuality/collect.mjs <輸出資料夾>
//   DURATION_SEC（預設 540）：行幾耐；INTERVAL_SEC（預設 30）：幾耐記一次
// 輸出：<資料夾>/YYYY-MM-DD.ndjson（香港日期），每行 {"t":秒,"w":第幾個 watch,"e":[到站時間（秒）...],"s":[1=原定班次 0=實時...]}
import {readFileSync, appendFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(here, 'raw');
const DURATION = +(process.env.DURATION_SEC || 540) * 1000, INTERVAL = +(process.env.INTERVAL_SEC || 30) * 1000;
const {watch} = JSON.parse(readFileSync(join(here, 'watch.json'), 'utf8'));
mkdirSync(OUT, {recursive: true});

const sec = iso => { const t = Date.parse(iso); return isNaN(t) ? null : Math.round(t / 1000); };
const sched = rmk => /原定|預定|scheduled/i.test(rmk || '') ? 1 : 0;
const hkDate = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
async function getJson(url){
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 10000);
  try { const r = await fetch(url, {signal: ctl.signal, headers: {'User-Agent': 'hkgo-punctuality/1.0'}}); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(to); }
}
// 九巴一個站一次過攞晒所有路線：同一個站嘅 watch 共用一個請求
async function sample(){
  const t = Math.round(Date.now() / 1000), cache = new Map(), rows = [];
  await Promise.all(watch.map(async (w, i) => {
    try {
      let list = [];
      if (w.co === 'kmb') {
        const key = 'kmb' + w.stop;
        if (!cache.has(key)) cache.set(key, getJson(`https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/${w.stop}`));
        const d = await cache.get(key);
        list = (d.data || []).filter(e => e.route === w.route && e.dir === w.dir && String(e.service_type) === String(w.st || 1));
      } else if (w.co === 'ctb') {
        const d = await getJson(`https://rt.data.gov.hk/v2/transport/citybus/eta/CTB/${w.stop}/${encodeURIComponent(w.route)}`);
        list = (d.data || []).filter(e => e.dir === w.dir);
      }
      const ok = list.map(e => ({t: sec(e.eta), s: sched(e.rmk_tc || e.rmk_en)})).filter(e => e.t).sort((a, b) => a.t - b.t);
      rows.push({t, w: i, e: ok.map(x => x.t), s: ok.map(x => x.s)});
    } catch (err) { rows.push({t, w: i, err: String(err.message || err).slice(0, 60)}); }
  }));
  appendFileSync(join(OUT, hkDate(t * 1000) + '.ndjson'), rows.sort((a, b) => a.w - b.w).map(r => JSON.stringify(r)).join('\n') + '\n');
  return rows;
}
const end = Date.now() + DURATION;
let n = 0;
for (;;) {
  const t0 = Date.now();
  const rows = await sample(); n++;
  if (n === 1) console.log(`第一次記錄：${rows.filter(r => !r.err).length}/${rows.length} 個 watch 成功`);
  if (Date.now() + INTERVAL > end) break;
  await new Promise(r => setTimeout(r, Math.max(0, INTERVAL - (Date.now() - t0))));
}
console.log(`完成：記錄咗 ${n} 次`);
