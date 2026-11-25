// 港途 · 常用：智能主頁、常用地點、收藏路線、設定
import {S, $, esc, store, L, nm, mins, hhmm, flaps, dayIdx, tilesFor, routeTiles, lineTiles, lrtTiles, lineName, stopName, dist, coTag, icon, saveSettings, clearData, refreshDb, onCellular, toast, applyTextSize} from './core.js';
import {cycle, etaFor, mtrBoard, lrtBoard} from './eta.js';
import {on, places, savePlaces, favs, toggleFav, openSheet, closeSheet, attachPicker} from './ui.js';
import {planTrip, toTrip, legChips, planTo} from './plan.js';
import {openRoute} from './route.js';
import {startTrip} from './trip.js';

let confirmCell = false, smart = null, smartAt = 0, smartBusy = false, favEta = new Map(), favAt = 0;
export function initSaved(){
  $('v-saved').innerHTML = `<div class="wrap"><div id="smart"></div>
    <h2 class="sec">${L('常用地點', 'Places')}</h2><div id="plc" class="plc"></div>
    <h2 class="sec">${L('常用路線', 'Pinned routes')}</h2><div id="favl"></div>
    <h2 class="sec">${L('設定', 'Settings')}</h2><div id="setl" class="setl"></div></div>`;
  $('v-saved').addEventListener('click', onClick);
  on('tab', t => { if (t === 'saved') draw(true); });
  on('places', () => { smartAt = 0; draw(true); });
  on('favs', () => { favAt = 0; if (!$('v-saved').hidden) draw(true); });
  setInterval(() => { if (!$('v-saved').hidden && !document.hidden) draw(); }, 20000);
}
function target(){
  const h = new Date(Date.now() + 288e5).getUTCHours(), wd = dayIdx();   // 公眾假期當星期日
  const near = p => S.here && p && dist(S.here, p) < 400;
  let t = null;
  if (places.work && wd >= 1 && wd <= 5 && h >= 5 && h < 12 && !near(places.work)) t = {...places.work, label: L('學校／公司', 'School / Work'), icon: 'work'};
  else if (places.home && !near(places.home)) t = {...places.home, label: L('屋企', 'Home'), icon: 'home'};
  else if (places.work && !near(places.work)) t = {...places.work, label: L('學校／公司', 'School / Work'), icon: 'work'};
  return t;
}
async function draw(force){
  drawPlaces(); drawSettings();
  const t = target(), sm = $('smart');
  if (!t) sm.innerHTML = `<div class="smart empty"><p class="lbl">${L('智能主頁', 'Smart home')}</p><h2>${L('設定屋企同學校／公司', 'Set Home and School / Work')}</h2><p>${L('設定之後，呢度會按時間自動話你知幾時出門：朝早去學校／返工，夜晚返屋企。', 'Then this card tells you when to leave — to work in the morning, home in the evening.')}</p></div>`;
  else if (!S.here) sm.innerHTML = `<div class="smart empty"><p class="lbl">${L('去', 'To')} ${esc(t.label)}</p><h2>${L('需要你嘅位置', 'Needs your location')}</h2><p>${L('喺「附近」頁撳定位，或者揀一個地點。', 'Locate yourself on the Nearby tab first.')}</p></div>`;
  else if (!smartBusy && (!smart || Date.now() - smartAt > 180000 || smart.t.label !== t.label || (force && Date.now() - smartAt > 30000))) {
    if (!smart || smart.t.label !== t.label) sm.innerHTML = `<div class="smart"><p class="lbl">${L('去', 'To')} ${esc(t.label)}</p><p class="loading">${L('計緊最快路線…', 'Finding the fastest trip…')}</p></div>`;
    smartAt = Date.now(); smartBusy = true;
    const from = {lat: S.here.lat, lng: S.here.lng, label: S.here.label};
    const opts = await planTrip(from, t, 3).catch(() => []);
    smartBusy = false;
    smart = {t, o: opts.find(o => o.legs.length) || opts[0], from};
  }
  if (smart && t && S.here && smart.t.label === t.label) {
    const o = smart.o;
    if (!o) sm.innerHTML = `<div class="smart"><p class="lbl">${L('去', 'To')} ${esc(t.label)}</p><h2>${L('搵唔到路線', 'No trip found')}</h2></div>`;
    else {
      const lv = mins(o.leaveT);
      sm.innerHTML = `<div class="smart"><p class="lbl">${L('去', 'To')} ${esc(t.label)}</p>
        <p class="sm-lbl">${lv > 0 ? L('距離出門仲有', 'Leave in') : L('而家出門', 'Leave now')}</p>
        <div class="sm-big">${flaps(lv > 0 ? String(lv).padStart(2, '0') : '00', 'smart')}<span>${L('分', 'min')}</span></div>
        <p class="sm-l">${L(`${hhmm(o.leaveT)} 出門 · 約 ${hhmm(o.arriveT)} 到`, `Leave ${hhmm(o.leaveT)} · arrive ~${hhmm(o.arriveT)}`)}</p>
        <div class="legs">${legChips(o)}</div>
        <div class="sh-btns"><button class="btn-y big" data-a="smartGo" type="button">${icon.door}<span>${L('出門倒數', 'Countdown')}</span></button>
        <button class="btn-d big" data-a="smartMore" type="button">${icon.list}<span>${L('其他方案', 'Other options')}</span></button></div></div>`;
    }
  }
  await drawFavs();
}
function drawPlaces(){
  const row = (k, lab, p) => `<div class="plc-r"><span class="plc-i">${k === 'home' ? '⌂' : k === 'work' ? '▤' : '★'}</span><span class="plc-t"><b>${esc(lab)}</b><small>${p ? esc(p.label) : L('未設定', 'Not set')}</small></span>
    ${p ? `<button class="btn-d sm" data-a="go" data-k="${k}" type="button">${L('去呢度', 'Go')}</button>` : ''}<button class="btn-d sm" data-a="set" data-k="${k}" type="button">${p ? L('更改', 'Change') : L('設定', 'Set')}</button></div>`;
  $('plc').innerHTML = row('home', L('屋企', 'Home'), places.home) + row('work', L('學校／公司', 'School / Work'), places.work)
    + (places.custom || []).map((c, i) => row('c' + i, c.label, c)).join('')
    + `<button class="btn-d sm addp" data-a="add" type="button">＋ ${L('加地點', 'Add place')}</button>`;
}
function drawSettings(){
  const sp = [[60, '慢', 'Slow'], [75, '正常', 'Normal'], [90, '快', 'Fast']];
  $('setl').innerHTML = `
    <div class="set-r"><span>${L('語言', 'Language')}</span><div class="seg">${[['zh', '中文'], ['en', 'English']].map(([k, t]) => `<button type="button" data-a="lang" data-v="${k}" aria-pressed="${S.set.lang === k}">${t}</button>`).join('')}</div></div>
    <div class="set-r"><span>${L('字體大小', 'Text size')}<small class="set-s">${L('長者或者睇唔清可以揀大字', 'Larger text for easier reading')}</small></span><div class="seg">${[['normal', '標準', 'Normal'], ['large', '大', 'Large'], ['xl', '特大', 'X-Large']].map(([v, zh, en]) => `<button type="button" data-a="text" data-v="${v}" aria-pressed="${S.set.text === v}">${L(zh, en)}</button>`).join('')}</div></div>
    <div class="set-r"><span>${L('步速（計出門時間用）', 'Walking pace')}</span><div class="seg">${sp.map(([v, zh, en]) => `<button type="button" data-a="walk" data-v="${v}" aria-pressed="${S.set.walk === v}">${L(zh, en)}</button>`).join('')}</div></div>
    <div class="set-r"><span>${L('出門同落車通知', 'Leave & alight alerts')}</span><button class="btn-d sm" data-a="notif" type="button">${'Notification' in window ? (Notification.permission === 'granted' ? L('已開啟', 'On') : L('開啟', 'Turn on')) : L('唔支援', 'Unsupported')}</button></div>
    <div class="set-r"><span>${L('螢幕常亮（出門倒數時）', 'Keep screen on (countdown)')}<small class="set-s">${L('等車同搭車先開，電量低過 20% 自動停', 'Only while waiting or riding; pauses under 20% battery')}</small></span><div class="seg">${[['auto', '自動', 'Auto'], ['off', '關', 'Off']].map(([v, zh, en]) => `<button type="button" data-a="awake" data-v="${v}" aria-pressed="${S.set.awake === v}">${L(zh, en)}</button>`).join('')}</div></div>
    <div class="set-r"><span>${L('自動更新路線資料（約 8 MB）', 'Auto-update route data (~8 MB)')}<small class="set-s">${L('上次更新：', 'Last updated: ')}${store.get('dbTime', 0) ? new Date(store.get('dbTime', 0)).toLocaleDateString('zh-HK', {timeZone: 'Asia/Hong_Kong'}) + ' ' + hhmm(store.get('dbTime', 0)) : '—'}${S.set.data === 'wifi' && !('connection' in navigator) ? L(' · 呢部機分唔到 Wi-Fi，會照常更新', ' · this device can’t tell Wi-Fi apart') : ''}</small></span><div class="seg">${[['auto', '每日', 'Daily'], ['wifi', '只限 Wi-Fi', 'Wi-Fi only'], ['manual', '手動', 'Manual']].map(([v, zh, en]) => `<button type="button" data-a="data" data-v="${v}" aria-pressed="${S.set.data === v}">${L(zh, en)}</button>`).join('')}</div></div>
    <div class="set-r"><span>${L('路線資料', 'Route data')}</span><div class="sh-inline"><button class="btn-d sm" data-a="upd" type="button">${L('而家更新', 'Update now')}</button><button class="btn-d sm" data-a="clear" type="button">${L('清除重下載', 'Reset')}</button></div></div>
    <p class="hint">${L('裝喺主畫面用效果最好：iPhone 用 Safari 撳「分享」→「加至主畫面」。通知、落車提示同螢幕常亮，只喺 app 開住嗰陣有效。', 'Best installed: in Safari tap Share → Add to Home Screen. Alerts and keep-awake work while the app is open.')} ${L('iPhone 鎖咗機唔會響提示，可以喺倒數畫面撳「加入行事曆提醒」。', 'iPhone won’t alert while locked — use “Add calendar alarms” on the countdown.')}</p>`;
}
async function drawFavs(){
  const el = $('favl');
  if (!favs.size) { el.innerHTML = `<p class="hint">${L('喺「附近」或者路線頁撳 ☆，常用路線就會喺度出現，唔使喺附近都睇到到站時間。', 'Tap ☆ on Nearby or a route page to pin it here.')}</p>`; return; }
  if (Date.now() - favAt > 25000) {
    favAt = Date.now();
    const memo = cycle();
    await Promise.all([...favs].map(async ([id, d]) => {
      try {
        if (d.kind === 'bus') { const r = S.DB.routeList[d.key]; if (r) favEta.set(id, (await etaFor(memo, d.co, r, d.stop, d.seq)).list); }
        else if (d.kind === 'mtr') { const rows = await mtrBoard(memo, d.sta, [d.line]); favEta.set(id, rows.find(x => x.dir === d.dir && x.dest === d.dest)?.etas || []); }
        else if (d.kind === 'lrt') { const rows = await lrtBoard(memo, d.stop); favEta.set(id, rows.find(x => x.route === d.route && x.dest?.zh === d.dest?.zh)?.etas || []); }
      } catch {}
    }));
  }
  el.innerHTML = [...favs].sort((a, b) => b[1].at - a[1].at).map(([id, d]) => {
    const r = d.kind === 'bus' ? S.DB.routeList[d.key] : null;
    const tiles = d.kind === 'mtr' ? lineTiles(d.line) : d.kind === 'lrt' ? lrtTiles(d.route) : tilesFor(r);
    const title = d.kind === 'mtr' ? L('往 ', 'To ') + stopName(d.dest) : L('往 ', 'To ') + nm(d.kind === 'lrt' ? d.dest : r?.dest);
    const sub = d.kind === 'mtr' ? lineName(d.line) + ' · ' + stopName(d.sta) : stopName(d.kind === 'lrt' ? d.stop : d.stop);
    const l = (favEta.get(id) || []).filter(e => mins(e.t) >= 0);
    return `<div class="row fav-row" data-fid="${esc(id)}" role="button" tabindex="0">${tiles}<div class="dst"><b>${esc(title)}</b><small>${esc(sub)}</small></div>
      <div class="eta">${l.length ? `<div class="big${l[0].sched ? ' sched' : ''}">${flaps(mins(l[0].t) <= 0 ? L('即將', 'Now') : mins(l[0].t) >= 60 ? hhmm(l[0].t) : String(mins(l[0].t)).padStart(2, '0'), 'fv' + id)}${mins(l[0].t) > 0 && mins(l[0].t) < 60 ? `<span class="u">${L('分', 'min')}</span>` : ''}</div>${l[1] ? `<small>${L('之後 ', 'then ')}${mins(l[1].t) >= 60 ? hhmm(l[1].t) : mins(l[1].t) + L(' 分', ' min')}</small>` : ''}` : `<span class="none">${L('暫無班次', 'No service')}</span>`}</div>
      <button class="star" type="button" data-unfav="${esc(id)}" aria-pressed="true" aria-label="${L('取消常用', 'Unpin')}">${icon.star(true)}</button></div>`;
  }).join('');
}
function pickPlace(title, done){
  openSheet(`<h2 class="sh-title">${esc(title)}</h2><div class="search">${icon.search}<input id="pp" type="search" autocomplete="off" placeholder="${L('搜尋地方、大廈或者車站', 'Search a place, building or stop')}"><div class="results" id="ppR"></div></div>
    ${S.here ? `<button class="btn-d big" id="ppHere" type="button">${icon.gps}<span>${L('用而家嘅位置', 'Use current location')}</span></button>` : ''}`, card => {
    attachPicker(card.querySelector('#pp'), card.querySelector('#ppR'), p => { closeSheet(); done(p); }, {places: true});
    card.querySelector('#ppHere')?.addEventListener('click', () => { closeSheet(); done({lat: S.here.lat, lng: S.here.lng, label: S.here.mode === 'gps' ? L('我嘅位置', 'My location') : S.here.label}); });
    setTimeout(() => card.querySelector('#pp').focus(), 80);
  });
}
function onClick(e){
  const b = e.target.closest('[data-a],[data-unfav],[data-fid]'); if (!b) return;
  if (b.dataset.unfav) { e.stopPropagation(); toggleFav(b.dataset.unfav); return; }
  if (b.dataset.fid && !b.dataset.a) { const d = favs.get(b.dataset.fid); if (d?.kind === 'bus') openRoute(d.key, d.stop); return; }
  const a = b.dataset.a, k = b.dataset.k;
  const get = k => k === 'home' ? places.home : k === 'work' ? places.work : places.custom[+k.slice(1)];
  if (a === 'set') pickPlace(L('設定地點', 'Set place'), p => { const v = {lat: p.lat, lng: p.lng, label: p.label}; if (k === 'home') places.home = v; else if (k === 'work') places.work = v; else places.custom[+k.slice(1)] = v; savePlaces(); });
  else if (a === 'add') pickPlace(L('加常用地點', 'Add a place'), p => { places.custom = [...(places.custom || []), {lat: p.lat, lng: p.lng, label: p.label}]; savePlaces(); });
  else if (a === 'go') { const p = get(k); if (p) planTo({...p}); }
  else if (a === 'smartGo' && smart?.o) startTrip({...toTrip(smart.o, smart.from, smart.t), alts: {from: smart.from, to: smart.t}});
  else if (a === 'smartMore' && smart) planTo({...smart.t}, smart.from);
  else if (a === 'lang') { S.set.lang = b.dataset.v; saveSettings(); location.reload(); }
  else if (a === 'walk') { S.set.walk = +b.dataset.v; saveSettings(); drawSettings(); toast(L('已更新步速', 'Pace updated')); }
  else if (a === 'notif') { if ('Notification' in window) Notification.requestPermission().then(() => drawSettings()); }
  else if (a === 'clear') { clearData().then(() => location.reload()); }
  else if (a === 'awake') { S.set.awake = b.dataset.v; saveSettings(); drawSettings(); }
  else if (a === 'text') { S.set.text = b.dataset.v; saveSettings(); applyTextSize(); drawSettings(); }
  else if (a === 'data') { S.set.data = b.dataset.v; saveSettings(); drawSettings(); }
  else if (a === 'upd') {
    if (onCellular() && !confirmCell) { confirmCell = true; toast(L('你似乎用緊流動數據，要用約 8 MB；再撳一次確認', 'You seem to be on mobile data (~8 MB) — tap again to confirm'), 4500); return; }
    b.disabled = true; b.textContent = L('更新緊…', 'Updating…');
    refreshDb(true).then(r => { toast(r === 'same' ? L('已經係最新', 'Already up to date') : L('已更新，下次開 app 生效', 'Updated — takes effect next launch')); drawSettings(); }).catch(() => { toast(L('更新失敗，請檢查網絡', 'Update failed — check connection')); drawSettings(); });
  }
}
