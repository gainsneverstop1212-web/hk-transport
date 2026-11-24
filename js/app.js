// 港途 · 開機
import {S, $, esc, store, L, loadDb, buildIndex, flaps, saveSettings} from './core.js';
import {go, setHere, startGps, on} from './ui.js';
import {initNearby} from './nearby.js';
import {initRoute} from './route.js';
import {initPlan} from './plan.js';
import {initSaved} from './saved.js';
import {initNews} from './news.js';
import {initTrip} from './trip.js';

const TABS = [
  ['near', '附近', 'Nearby', '<path d="M12 2 4 21l8-4 8 4z" fill="currentColor"/>'],
  ['route', '路線', 'Routes', '<rect x="4" y="3" width="16" height="15" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 11h16M7 21v-3M17 21v-3" stroke="currentColor" stroke-width="2"/>'],
  ['plan', '規劃', 'Plan', '<circle cx="6" cy="18" r="2.5" fill="currentColor"/><circle cx="18" cy="6" r="2.5" fill="currentColor"/><path d="M8 18h5a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h5" stroke="currentColor" stroke-width="2" fill="none"/>'],
  ['saved', '常用', 'Saved', '<path d="M12 2.8l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 17l-5.8 3.3 1.4-6.4-4.9-4.4 6.5-.7z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>'],
  ['news', '通告', 'News', '<path d="M4 5h12v14H6a2 2 0 0 1-2-2zM16 9h4v8a2 2 0 0 1-4 0M7 9h6M7 13h6" stroke="currentColor" stroke-width="2" fill="none"/>']
];

function shell(){
  document.documentElement.lang = S.set.lang === 'en' ? 'en' : 'zh-HK';
  document.title = L('港途 · 香港交通到站', 'HK GO · Hong Kong transit');
  $('brandSub').textContent = L('香港交通到站', 'HK transit');
  $('foot').innerHTML = L('到站時間來自運輸署 DATA.GOV.HK 及各營辦商開放數據，只供參考。路線整合：<a href="https://github.com/hkbus/hk-bus-crawling" target="_blank" rel="noopener">hkbus/hk-bus-crawling</a>；地圖及地址：地政總署、政府地址查詢服務。電車同紅色小巴暫時冇開放實時數據。',
    'Arrival times from the Transport Department (DATA.GOV.HK) and operators’ open data, for reference only. Route data: <a href="https://github.com/hkbus/hk-bus-crawling" target="_blank" rel="noopener">hkbus/hk-bus-crawling</a>; maps and addresses: Lands Department and the Address Lookup Service. Trams and red minibuses have no open real-time data.');
  $('tabs').setAttribute('aria-label', L('主選單', 'Main menu'));
  $('trip').setAttribute('aria-label', L('出門倒數', 'Leave countdown'));
  $('clock').setAttribute('aria-label', L('現在時間', 'Current time'));
  if ($('bootH')) { $('bootH').textContent = L('正在準備全港路線資料', 'Preparing Hong Kong route data'); $('loadTxt').textContent = L('第一次開要下載約 8 MB，之後每日自動更新一次。', 'First launch downloads about 8 MB; it refreshes once a day.'); }
  $('langBtn').textContent = S.set.lang === 'en' ? '中' : 'EN';
  $('langBtn').setAttribute('aria-label', L('Switch to English', '轉做中文'));
  $('tabs').innerHTML = TABS.map(([k, zh, en, svg]) => `<button type="button" data-tab="${k}"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">${svg}</svg><span>${L(zh, en)}</span></button>`).join('');
  $('tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); };
  $('langBtn').onclick = () => { S.set.lang = S.set.lang === 'en' ? 'zh' : 'en'; saveSettings(); location.reload(); };
}
function tick(){
  const hm = new Date().toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Hong_Kong'});
  $('clock').innerHTML = flaps(hm);
}
async function boot(){
  shell(); tick(); setInterval(tick, 10000);
  const ld = $('loadTxt');
  try {
    S.DB = await loadDb(n => { ld.textContent = L(`下載緊路線資料… ${(n / 1048576).toFixed(1)} MB`, `Downloading route data… ${(n / 1048576).toFixed(1)} MB`); });
  } catch (e) {
    $('boot').innerHTML = `<div class="hero"><h1>${L('載入唔到路線資料', 'Could not load route data')}</h1><p>${L('請檢查網絡再重新整理。', 'Check your connection and reload.')} (${esc(e.message)})</p></div>`;
    return;
  }
  ld.textContent = L('整理緊車站…', 'Indexing stops…');
  await new Promise(r => setTimeout(r, 20));
  buildIndex();
  $('boot').remove();
  initNearby(); initRoute(); initPlan(); initSaved(); initNews(); initTrip();
  go(store.get('tab', 'near'));
  const saved = store.get('place', null);
  if (saved) setHere({...saved, mode: 'manual'});
  if (navigator.permissions) navigator.permissions.query({name: 'geolocation'}).then(p => { if (p.state === 'granted') startGps(); }).catch(() => {});
  window.addEventListener('online', () => { S.online = true; });
  window.addEventListener('offline', () => { S.online = false; });
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
