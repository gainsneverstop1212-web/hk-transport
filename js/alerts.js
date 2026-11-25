// 港途 · 你嘅路線出事先通知你
// 每 5 分鐘（app 開住嗰陣）檢查：運輸署特別交通消息有冇提到你常用／通勤嘅巴士路線，港鐵有冇延誤。
// 有新消息就彈通知，頂部出橫額，並俾一個「第二條路線」掣（常用頁會自動避開受影響路線）。
import {S, $, esc, store, L, lineName, notify} from './core.js';
import {J} from './eta.js';
import {on, emit, favs, go} from './ui.js';
import {fetchNews, hitsRoute} from './news.js';
import {habitLines} from './habit.js';

let active = [], at = 0, busy = false;
const hidden = new Set();                         // 今次開 app 撳咗 ✕ 嘅橫額
// 一程車嘅路線代號：港鐵用「mtr:綫代號」，其他用大楷路線號碼
export const legLine = l => { const r = S.DB.routeList[l.key]; return !r ? '' : l.co === 'mtr' ? 'mtr:' + r.route : String(r.route).replace('*', '').toUpperCase(); };
export const lineText = k => k.startsWith('mtr:') ? lineName(k.slice(4)) : k;

// 你嘅路線：常用 ☆、學識咗嘅通勤、進行中嘅出門倒數
function mine(){
  const out = new Set(habitLines());
  for (const [, d] of favs) {
    if (d.kind === 'bus') { const r = S.DB.routeList[d.key]; if (r) out.add(r.co[0] === 'mtr' ? 'mtr:' + r.route : String(r.route).toUpperCase()); }
    else if (d.kind === 'mtr') out.add('mtr:' + d.line);
  }
  for (const l of store.get('trip', null)?.legs || []) { const k = legLine(l); if (k) out.add(k); }
  return [...out].filter(Boolean);
}
// 受影響嘅路線代號（常用頁計路線時避開）
export const badLines = () => new Set(active.flatMap(a => a.lines));

const firstMtrStop = line => { for (const r of Object.values(S.DB.routeList)) if (r.co[0] === 'mtr' && r.route === line && r.stops.mtr?.length) return r.stops.mtr[Math.floor(r.stops.mtr.length / 2)]; return null; };

export async function checkAlerts(force){
  if (busy || (!force && Date.now() - at < 300000)) return;
  busy = true; at = Date.now();
  try {
    const keys = mine(), out = [];
    if (keys.length) {
      const bus = keys.filter(k => !k.startsWith('mtr:')), mtr = keys.filter(k => k.startsWith('mtr:'));
      const news = await fetchNews().catch(() => []);
      for (const n of news) {
        const hit = [...bus.filter(k => hitsRoute(n.text, k)), ...mtr.filter(k => n.text.includes(lineName(k.slice(4))))];
        if (hit.length) out.push({id: 'td:' + n.id, kind: 'news', lines: hit, text: n.text.split(/\n+/)[0].trim()});
      }
      // 港鐵延誤：每條綫問一個站（isdelay = 'Y' 代表嗰條綫延誤）
      const day = new Date(Date.now() + 288e5).toISOString().slice(0, 10);
      await Promise.all(mtr.map(async k => {
        const line = k.slice(4), sta = firstMtrStop(line); if (!sta) return;
        try {
          const d = await J(`https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${line}&sta=${sta}&lang=${S.set.lang === 'en' ? 'EN' : 'TC'}`);
          if (d.isdelay === 'Y') out.push({id: `mtr:${line}:${day}`, kind: 'mtr', lines: [k], text: L(`${lineName(line)}列車服務延誤`, `${lineName(line)} train service delayed`)});
        } catch {}
      }));
    }
    // 新消息先通知（每則只通知一次，紀錄保留兩日）
    const seen = store.get('alertSeen', {}), t = Date.now();
    for (const [id, ts] of Object.entries(seen)) if (t - ts > 2 * 864e5) delete seen[id];
    for (const a of out) if (!seen[a.id]) {
      seen[a.id] = t;
      notify(L(`你常用嘅 ${a.lines.map(lineText).join('、')} 受影響`, `${a.lines.map(lineText).join(', ')} affected`), a.text, 'hkgo-alert');
    }
    store.set('alertSeen', seen);
    const changed = out.map(a => a.id).join() !== active.map(a => a.id).join();
    active = out;
    if (changed) { draw(); emit('alerts', active); }
  } finally { busy = false; }
}

function draw(){
  const el = $('alertBar'); if (!el) return;
  const list = active.filter(a => !hidden.has(a.id));
  el.hidden = !list.length;
  el.innerHTML = list.slice(0, 2).map(a => `<div class="alert-row" data-id="${esc(a.id)}">
    <span class="al-i" aria-hidden="true">!</span>
    <div class="al-t"><b>${esc(L(`你常用嘅 ${a.lines.map(lineText).join('、')} 受影響`, `${a.lines.map(lineText).join(', ')} affected`))}</b><small>${esc(a.text)}</small></div>
    <div class="al-b"><button class="btn-y sm" type="button" data-al="alt">${L('第二條路線', 'Other route')}</button>
    ${a.kind === 'news' ? `<button class="btn-d sm" type="button" data-al="news">${L('詳情', 'Details')}</button>` : ''}
    <button class="icon-btn al-x" type="button" data-al="x" aria-label="${L('收埋', 'Dismiss')}">✕</button></div></div>`).join('')
    + (list.length > 2 ? `<p class="al-more">${L(`仲有 ${list.length - 2} 則`, `${list.length - 2} more`)}</p>` : '');
}
export function initAlerts(){
  $('alertBar').addEventListener('click', e => {
    const b = e.target.closest('[data-al]'); if (!b) return;
    const id = b.closest('[data-id]')?.dataset.id;
    if (b.dataset.al === 'x') { hidden.add(id); draw(); }
    else if (b.dataset.al === 'news') go('news');
    else if (b.dataset.al === 'alt') go('saved');      // 常用頁會避開受影響路線重新計
  });
  setTimeout(() => checkAlerts(true), 4000);
  setInterval(() => { if (!document.hidden) checkAlerts(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkAlerts(); });
  on('favs', () => { at = 0; });
}
