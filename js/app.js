// 港住走 · 開機
import {S, $, esc, store, L, loadDb, buildIndex, flaps, saveSettings, now, syncClockNow, applyTextSize} from './core.js';
import {go, setHere, startGps, on} from './ui.js';
import {initNearby} from './nearby.js';
import {initRoute} from './route.js';
import {initPlan} from './plan.js';
import {initSaved} from './saved.js';
import {initNews} from './news.js';
import {initTrip} from './trip.js';
import {initWx} from './wx.js';
import {initAlerts} from './alerts.js';
import {dueCommute} from './habit.js';
import {initAccount} from './account.js';

const TABS = [
  ['near', '附近', 'Nearby', '<path d="M12 2 4 21l8-4 8 4z" fill="currentColor"/>'],
  ['route', '路線', 'Routes', '<rect x="4" y="3" width="16" height="15" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 11h16M7 21v-3M17 21v-3" stroke="currentColor" stroke-width="2"/>'],
  ['plan', '規劃', 'Plan', '<circle cx="6" cy="18" r="2.5" fill="currentColor"/><circle cx="18" cy="6" r="2.5" fill="currentColor"/><path d="M8 18h5a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h5" stroke="currentColor" stroke-width="2" fill="none"/>'],
  ['saved', '常用', 'Saved', '<path d="M12 2.8l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 17l-5.8 3.3 1.4-6.4-4.9-4.4 6.5-.7z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>'],
  ['news', '通告', 'News', '<path d="M4 5h12v14H6a2 2 0 0 1-2-2zM16 9h4v8a2 2 0 0 1-4 0M7 9h6M7 13h6" stroke="currentColor" stroke-width="2" fill="none"/>']
];

function shell(){
  applyTextSize();
  document.documentElement.lang = S.set.lang === 'en' ? 'en' : 'zh-HK';
  document.title = L('港住走 · 香港巴士港鐵出門倒數', 'Rushing HK · When to leave for your bus & MTR');
  $('foot').innerHTML = L('到站時間來自運輸署 DATA.GOV.HK 及各營辦商開放數據，只供參考。路線整合：<a href="https://github.com/hkbus/hk-bus-crawling" target="_blank" rel="noopener">HK Bus Crawling@2021</a>；地圖及地址：地政總署、政府地址查詢服務；商店及地標搜尋：© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> 貢獻者（Photon）。電車同紅色小巴暫時冇開放實時數據。',
    'Arrival times from the Transport Department (DATA.GOV.HK) and operators’ open data, for reference only. Route data: <a href="https://github.com/hkbus/hk-bus-crawling" target="_blank" rel="noopener">HK Bus Crawling@2021</a>; maps and addresses: Lands Department and the Address Lookup Service; shop and landmark search: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (Photon). Trams and red minibuses have no open real-time data.');
  $('tabs').setAttribute('aria-label', L('主選單', 'Main menu'));
  $('trip').setAttribute('aria-label', L('出門倒數', 'Leave countdown'));
  $('alertBar').setAttribute('aria-label', L('你嘅路線消息', 'Alerts for your routes'));
  if ($('bootH')) { $('bootH').textContent = L('正在準備全港路線資料', 'Preparing Hong Kong route data'); $('loadTxt').textContent = L('第一次開要下載約 8 MB；之後即開，路線資料會喺背景每日更新。', 'First launch downloads about 8 MB; after that it opens instantly and refreshes in the background daily.'); }
  $('langBtn').textContent = S.set.lang === 'en' ? '中' : 'EN';
  $('langBtn').setAttribute('aria-label', L('Switch to English', '轉做中文'));
  $('tabs').innerHTML = TABS.map(([k, zh, en, svg]) => `<button type="button" data-tab="${k}"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">${svg}</svg><span>${L(zh, en)}</span></button>`).join('');
  $('tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); };
  $('langBtn').onclick = () => { S.set.lang = S.set.lang === 'en' ? 'zh' : 'en'; saveSettings(); location.reload(); };
}
let lastHm = '';
function tick(){
  const hm = new Date(now()).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Hong_Kong'});
  if (hm === lastHm) return;                       // 每秒檢查，但只喺分鐘轉咗先重畫（時鐘唔會遲過 1 秒）
  lastHm = hm;
  $('clock').innerHTML = flaps(hm);
  $('clock').setAttribute('aria-label', L('現在時間 ', 'Time now ') + hm);
}
async function boot(){
  shell(); tick(); setInterval(tick, 1000);
  syncClockNow().then(tick);
  const ld = $('loadTxt');
  // 第一次開喺弱網（月台、𨋢大堂）：20 秒後講清楚發生咩事，俾用家揀繼續等定重試
  const slow = setTimeout(() => { const b = $('boot'); if (!b) return; const p = document.createElement('p'); p.className = 'hint'; p.innerHTML = `${L('網絡好慢，第一次要下載全港路線資料（之後唔使）。可以繼續等，或者轉用 Wi-Fi 再試。', 'Slow connection — the first launch downloads all route data (only once). Keep waiting or try again on Wi-Fi.')} <button class="btn-d sm" type="button" onclick="location.reload()">${L('重試', 'Retry')}</button>`; b.querySelector('.hero, div')?.appendChild(p) || b.appendChild(p); }, 20000);
  try {
    S.DB = await loadDb(n => { ld.textContent = L(`下載緊路線資料… ${(n / 1048576).toFixed(1)} MB`, `Downloading route data… ${(n / 1048576).toFixed(1)} MB`); });
  } catch (e) {
    clearTimeout(slow);
    $('boot').innerHTML = `<div class="hero"><h1>${L('載入唔到路線資料', 'Could not load route data')}</h1><p>${L('請檢查網絡再重新整理。', 'Check your connection and reload.')} (${esc(e.message)})</p></div>`;
    return;
  }
  clearTimeout(slow);
  ld.textContent = L('整理緊車站…', 'Indexing stops…');
  await new Promise(r => setTimeout(r, 20));
  buildIndex();
  $('boot').remove();
  initWx(); initAccount();
  // 請瀏覽器唔好喺空間唔夠時清走 app 資料（常用地點、設定）；iPhone 加咗去主畫面效果最好
  try { navigator.storage?.persist?.(); } catch {}
  initNearby(); initRoute(); initPlan(); initSaved(); initNews(); initTrip(); initAlerts();
  // 而家係你平時出門前後：直接開常用頁（出門倒數），唔使自己揀
  const saved = store.get('place', null);
  if (saved) setHere({...saved, mode: 'manual'});
  go(dueCommute() ? 'saved' : store.get('tab', 'near'));
  // 舊版 iPhone Safari 答唔到「有冇定位權限」：之前用過 GPS 就照開，唔好停留喺上次手動揀嘅地點
  const autoGps = () => { if (store.get('gpsUsed', false)) startGps(); };
  if (navigator.permissions?.query) navigator.permissions.query({name: 'geolocation'}).then(p => { if (p.state === 'granted') startGps(); else if (p.state !== 'denied' && p.state !== 'prompt') autoGps(); }).catch(autoGps);
  else autoGps();
  window.addEventListener('online', () => { S.online = true; });
  window.addEventListener('offline', () => { S.online = false; });
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
