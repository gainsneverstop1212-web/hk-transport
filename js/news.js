// 港途 · 通告（運輸署特別交通消息）
import {S, $, esc, L, hhmm, lineName} from './core.js';
import {on, favs} from './ui.js';

let items = null, at = 0, q = '';
export function initNews(){
  $('v-news').innerHTML = `<div class="wrap"><h1 class="vh">${L('交通消息', 'Traffic news')}</h1>
    <div class="search">${'<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5" stroke="currentColor" stroke-width="2.4" fill="none"/><path d="m15 15 6 6" stroke="currentColor" stroke-width="2.4"/></svg>'}<input id="newsQ" type="search" placeholder="${L('篩選：路線號碼、地區、渡輪…', 'Filter: route, district, ferry…')}" aria-label="${L('篩選', 'Filter')}"></div>
    <div id="newsL"><p class="loading">${L('載入中…', 'Loading…')}</p></div>
    <p class="hint">${L('資料來源：運輸署特別交通消息。港鐵延誤會喺附近頁嘅港鐵站顯示。', 'Source: Transport Department special traffic news. MTR delays show on station rows.')}</p></div>`;
  $('newsQ').oninput = e => { q = e.target.value.trim().toLowerCase(); draw(); };
  on('tab', t => { if (t === 'news' && Date.now() - at > 120000) load(); });
}
async function load(){
  at = Date.now();
  try {
    const x = await fetch(`https://resource.data.one.gov.hk/td/${S.set.lang === 'en' ? 'en' : 'tc'}/specialtrafficnews.xml`, {cache: 'no-store'}).then(r => r.text());
    const d = new DOMParser().parseFromString(x, 'text/xml');
    const g = (m, t) => m.getElementsByTagName(t)[0]?.textContent?.trim() || '';
    items = [...d.getElementsByTagName('message')].map(m => ({id: g(m, 'msgID'), text: S.set.lang === 'en' ? g(m, 'EngText') : g(m, 'ChinText'), date: g(m, 'ReferenceDate')}))
      .filter(x => x.text);
  } catch { items = items || []; if (!items.length) $('newsL').innerHTML = `<p class="hint">${L('暫時載入唔到交通消息', 'Could not load traffic news')}</p><button class="btn-d sm" type="button" id="newsRetry">${L('再試', 'Retry')}</button>`; $('newsRetry')?.addEventListener('click', load); return; }
  draw();
}
// 你常用嘅路線（巴士號碼、港鐵綫名）：提到佢哋嘅消息排先
function mine(){
  const out = new Set();
  for (const [, d] of favs) {
    if (d.kind === 'bus') { const r = S.DB.routeList[d.key]; if (r) out.add(String(r.route).toUpperCase()); }
    else if (d.kind === 'mtr') { out.add(lineName(d.line)); }
  }
  return [...out];
}
const hits = (text, keys) => keys.some(k => /^[0-9A-Z]+$/.test(k) ? new RegExp(`(^|[^0-9A-Z])${k}([^0-9A-Z]|$)`, 'i').test(text) : text.includes(k));
function draw(){
  if (!items) return;
  const keys = mine();
  const list = items.filter(x => !q || x.text.toLowerCase().includes(q)).map(x => ({...x, mine: keys.length && hits(x.text, keys)}));
  list.sort((a, b) => b.mine - a.mine);
  // 運輸署每則消息嘅「參考日期」都一樣，唔可以當每則消息嘅時間：改為一句資料更新時間
  const upd = `<p class="lbl pad">${L('最後檢查 ', 'Checked ')}${hhmm(at)}${keys.length ? ' · ' + L('同你常用路線有關嘅排先', 'news about your pinned routes first') : ''}</p>`;
  $('newsL').innerHTML = list.length ? upd + list.map(x => {
    const lines = x.text.split(/\n+/).map(s => s.trim()).filter(Boolean);
    return `<article class="news${x.mine ? ' mine' : ''}">${x.mine ? `<p class="news-d">${L('同你常用路線有關', 'About your pinned routes')}</p>` : ''}<h3>${esc(lines[0] || '')}</h3>${lines.length > 1 ? `<details><summary>${L('詳情', 'Details')}</summary>${lines.slice(1).map(s => `<p>${esc(s)}</p>`).join('')}</details>` : ''}</article>`;
  }).join('') : `<p class="hint">${q ? L('冇相關消息', 'No matching news') : L('暫時冇特別交通消息', 'No special traffic news right now')}</p>`;
}
