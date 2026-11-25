// 港住走 · 出門倒數模式（由出門、等車、搭車到落車提示）
import {S, $, esc, store, L, nm, hhmm, mins, now, flaps, tilesFor, routeLabel, routeTiles, lineTiles, lineName, stopName, stopLoc, dist, rideMin, avgWait,
  speak, notify, toast, icon, saveSettings} from './core.js';
import {cycle, etaFor} from './eta.js';
import {openSheet, closeSheet, addLayer, back} from './ui.js';
import {planTrip, toTrip, legChips} from './plan.js';
import {logTrip} from './habit.js';
import {wxLine} from './wx.js';
import {shareTrip} from './share.js';

let layer = false, trip = null, lists = [], tick = null, poll = null, wake = null, gpsW = null, pos = null, lastSay = '', shown = false, lastSig = '', lowBatt = false, wantWake = false;
// iPhone：網頁 app 鎖咗機或者轉咗去第二個 app 就唔會再跑，提示會遲到
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
navigator.getBattery?.().then(b => { const f = () => { lowBatt = b.level < 0.2 && !b.charging; }; f(); b.addEventListener('levelchange', f); b.addEventListener('chargingchange', f); }).catch(() => {});

export function initTrip(){
  const saved = store.get('trip', null);
  if (saved && now() - saved.startedAt < 3 * 3600e3 && saved.stage !== 'done') { trip = saved; start(false); }
  // 返嚟 app：即刻重新計，錯過咗嘅提示會即時補發（paint 會檢查邊個提示未響過）
  document.addEventListener('visibilitychange', () => { if (!document.hidden && trip) { wake = null; load(); paint(true); } });
}
export function startTrip(t){
  if (!t.legs?.length) return;
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  LN()?.requestPermissions?.().catch?.(() => {});
  trip = {...t, stage: 'prep', li: 0, pick: t.legs.map(() => null), boardedAt: [], leftAt: null, startedAt: now(), alerted: {}, buf: store.get('tripBuf', 0), wxF: S.wx?.factor || 1};
  save(); start(true);
}
const save = () => store.set('trip', trip);
// 班次時間有變（實時到站提早或者延誤 2 分鐘以上）：提示用家，出門時間已經跟住改
let lastBoard = null, shiftMsg = '', shiftUntil = 0;
function checkShift(cur, i){
  if (!cur || trip.stage === 'ride') { lastBoard = null; return; }
  if (cur.est) return;                              // 未有到站資料前嘅估計唔算：只比較真實到站時間
  const key = i + ':' + trip.stage;
  if (lastBoard && lastBoard.key === key && Math.abs(cur.boardT - lastBoard.t) >= 120000) {
    const later = cur.boardT > lastBoard.t;
    shiftMsg = L(`班次時間有變：${hhmm(lastBoard.t)} → ${hhmm(cur.boardT)}（${later ? '延誤' : '提早'}），出門時間已經跟住改`, `Bus time changed: ${hhmm(lastBoard.t)} → ${hhmm(cur.boardT)} (${later ? 'delayed' : 'earlier'}) — leave time updated`);
    shiftUntil = now() + 90000;
    if (trip.stage === 'prep') { toast(shiftMsg, 5000); speak(later ? L('班次延誤，出門時間延後', 'Bus delayed, leave later') : L('班次提早，請早啲出門', 'Bus earlier, leave sooner')); }
  }
  lastBoard = {key, t: cur.boardT};
}
function start(show){
  lists = trip.legs.map(() => null); lastBoard = null; shiftMsg = ''; shiftUntil = 0;
  clearInterval(tick); clearInterval(poll);
  tick = setInterval(paint, 1000);
  poll = setInterval(() => { if (!document.hidden) load(); }, 20000);
  load();
  show ? open() : pill();
}
function stop(){
  if (layer) { layer = false; back(); }          // 一齊清走返回鍵記錄
  clearInterval(tick); clearInterval(poll); tick = poll = null;
  if (gpsW != null) { navigator.geolocation.clearWatch(gpsW); gpsW = null; }
  release(); cancelNative(); trip = null; store.del('trip');
  $('trip').hidden = true; $('trip').innerHTML = ''; $('tripPill').hidden = true; shown = false;
  document.body.classList.remove('tripping');
}
// 倒數畫面加入返回鍵記錄：Android 撳返回會收細倒數，唔會關咗後面嘅頁或者離開 app
function open(){ if (!layer) { layer = true; addLayer(() => { layer = false; pill(); }); } lastSig = ''; shown = true; $('trip').hidden = false; $('tripPill').hidden = true; document.body.classList.add('tripping'); paint(true); }
function pill(){ if (!trip) return; shown = false; $('trip').hidden = true; document.body.classList.remove('tripping'); release(); $('tripPill').hidden = false; paint(); }

let waking = false;
async function lockScreen(){
  if (waking || wake || document.hidden || !('wakeLock' in navigator)) return;
  waking = true;
  try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } catch {} finally { waking = false; }
}
// 螢幕常亮：等車、搭車先開；出門前仲有 10 分鐘以上唔開；低電量（<20%）自動唔開；用家可以喺倒數畫面關
function wakeFor(stage, rem){
  const want = shown && S.set.awake !== 'off' && !lowBatt && (stage === 'go' || stage === 'ride' || (stage === 'prep' && rem < 600000));
  wantWake = want;
  if (want) lockScreen(); else if (wake) release();
}
function release(){ try { wake?.release(); } catch {} wake = null; }
function watchGps(){
  if (gpsW != null || !('geolocation' in navigator)) return;
  gpsW = navigator.geolocation.watchPosition(p => { const a = p.coords.accuracy; if (pos && a > 150 && a > pos.acc * 2 && Date.now() - pos.at < 60000) return; pos = {lat: p.coords.latitude, lng: p.coords.longitude, acc: a, at: Date.now()}; }, () => {}, {enableHighAccuracy: true, maximumAge: 0, timeout: 30000});
}

async function load(){
  if (!trip) return;
  const memo = cycle();
  await Promise.all(trip.legs.map(async (l, i) => {
    if (i < trip.li) return;
    const r = S.DB.routeList[l.key];
    const res = await etaFor(memo, l.co, r, l.board, l.bseq);
    if (!res.err || !lists[i]) lists[i] = res;
  }));
  paint();
  scheduleNative();
}

/* ---------- App Store 版：用系統通知預約提醒（鎖機、轉咗 app 都會準時響） ---------- */
// 網頁版冇呢個功能（Capacitor 嘅 LocalNotifications 插件唔存在就乜都唔做）
const LN = () => window.Capacitor?.Plugins?.LocalNotifications;
const NIDS = [7101, 7102, 7103, 7104, 7105];
let nativeSig = '';
async function scheduleNative(){
  const ln = LN(); if (!ln || !trip) return;
  const c = chain(), ev = [];
  if (trip.stage === 'prep' && c.legs[0]) { const l = trip.legs[0], lv = c.legs[0].boardT - walkOf(0) * 60000; ev.push([lv - 2 * 60000, L('兩分鐘後出門', 'Leave in 2 minutes'), L(`${hhmm(lv)} 出門去 ${stopName(l.board)} 搭 ${rname(l)}`, `Leave ${hhmm(lv)} for ${rname(l)} at ${stopName(l.board)}`)], [lv, L('夠鐘出門！', 'Time to leave!'), L(`行去 ${stopName(l.board)} 搭 ${rname(l)}`, `Walk to ${stopName(l.board)} for the ${rname(l)}`)]); }
  trip.legs.forEach((l, k) => { if (k >= trip.li && c.legs[k] && l.aseq != null) ev.push([c.legs[k].alightT - 3 * 60000, L('準備落車', 'Get ready to get off'), L(`就快到 ${stopName(l.alight)}`, `Almost at ${stopName(l.alight)}`)]); });
  const list = ev.filter(([t]) => t > now() + 15000).slice(0, NIDS.length);
  const sig = list.map(([t]) => Math.round(t / 60000)).join(',');
  if (sig === nativeSig) return;                     // 時間冇變（以分鐘計）就唔使重新預約
  nativeSig = sig;
  try {
    await ln.cancel({notifications: NIDS.map(id => ({id}))});
    if (list.length) await ln.schedule({notifications: list.map(([t, title, body], k) => ({id: NIDS[k], title, body, schedule: {at: new Date(t - S.skew), allowWhileIdle: true}}))});
  } catch {}
}
function cancelNative(){ nativeSig = ''; try { LN()?.cancel({notifications: NIDS.map(id => ({id}))}); } catch {} }

/* ---------- 計時間 ---------- */
// 第一程步行時間 + 用家自訂預留（天橋、紅綠燈、等電梯）：直線距離計唔到呢啲
// 開始倒數之後天氣變咗（例如轉咗黃雨）：按比例調整第一程步行時間
const wxAdj = m => Math.ceil(m * (S.wx?.factor || 1) / (trip.wxF || 1));
// 第一程 = 落樓等𨋢（唔受天氣影響）+ 行路（天氣調整）+ 自訂預留
const walkOf = i => i === 0 ? (trip.door || 0) + wxAdj(trip.walk0 - (trip.door || 0)) + (trip.buf || 0) : (trip.legs[i].walk || 0);
const BUFS = [0, 3, 5];
function chain(){
  // 由目前狀態推算每程嘅上車、落車時間
  const T0 = now(), out = [];
  let t = T0;
  for (let i = 0; i < trip.legs.length; i++) {
    const l = trip.legs[i], r = S.DB.routeList[l.key];
    const ride = l.aseq != null ? rideMin(r, l.co, l.bseq, l.aseq) * 60000 : 0;
    if (i < trip.li) { out.push(null); continue; }
    if (i === trip.li && trip.stage === 'ride') { const b = trip.boardedAt[i] || T0; out.push({boardT: b, alightT: b + ride, live: true, boarded: true}); t = b + ride; continue; }
    let earliest;
    if (i === trip.li) earliest = trip.stage === 'prep' ? T0 + walkOf(i) * 60000 : Math.max(T0, (trip.leftAt || T0) + walkOf(i) * 60000 - 60000);
    else earliest = t + walkOf(i) * 60000;
    const list = (lists[i]?.list || []).filter(e => e.t >= T0 - 30000);
    let pickE = null;
    if (trip.pick[i]) pickE = list.find(e => Math.abs(e.t - trip.pick[i]) < 150000) || null;
    const e = pickE || list.find(x => x.t >= earliest - 30000);
    // 冇實時／時間表資料：第一次估計嘅班次時間要「釘住」，唔可以每秒用「而家 + 平均等候」重新估，
    // 否則倒數會永遠停喺同一個數甚至越倒越多（估計時間跟住時鐘一齊行）
    let boardT;
    if (e) boardT = e.t;
    else {
      trip.est = trip.est || [];
      const prev = trip.est[i];
      boardT = prev && prev >= earliest - 30000 ? prev : earliest + avgWait(r, l.co) * 60000;
      if (prev !== boardT) { trip.est[i] = boardT; save(); }
    }
    out.push({boardT, alightT: boardT + ride, live: !!e && !e.sched, sched: !!e?.sched, est: !e, list});
    t = boardT + ride;
  }
  return {legs: out, arriveT: t + (trip.walkEnd || 0) * 60000};
}
const clock = ms => {
  const neg = ms < 0, s = Math.floor(Math.abs(ms) / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  return (neg ? '-' : '') + (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(ss).padStart(2, '0');
};
const rname = l => routeLabel(S.DB.routeList[l.key]);
const tiles = l => tilesFor(S.DB.routeList[l.key]);
const Y = t => `<em>${hhmm(t)}</em>`;

function stopsLeft(l){
  if (!pos || l.aseq == null) return null;
  const st = S.DB.routeList[l.key].stops[l.co];
  let bi = l.bseq, bd = Infinity;
  for (let k = l.bseq; k <= l.aseq; k++) { const p = stopLoc(st[k]); if (!p) continue; const d = dist(pos, p); if (d < bd) { bd = d; bi = k; } }
  return {left: l.aseq - bi, dAlight: dist(pos, stopLoc(l.alight))};
}

/* ---------- 畫面 ---------- */
function paint(force){
  if (!trip) return;
  const c = chain(), T0 = now(), i = trip.li, l = trip.legs[i], cur = c.legs[i];
  let label, big, lines = [], btns, say = '', alert = '', note = '';
  checkShift(cur, i);
  if (trip.stage === 'prep') {
    const leaveT = cur.boardT - walkOf(0) * 60000, rem = leaveT - T0;
    if (trip.pick[0] && rem < -90000) { trip.pick[0] = null; save(); toast(L('嗰班趕唔切，已改搭下一班', 'Missed it — switched to the next one')); }
    label = rem > 0 ? L('距離出門仲有', 'Leave in') : L('夠鐘出門！', 'Time to go!');
    big = clock(Math.max(0, rem));
    const bufTxt = trip.buf ? L(` + 預留 ${trip.buf} 分鐘`, ` + ${trip.buf} min spare`) : '';
    const dTxt = trip.door ? L(`落樓等𨋢 ${trip.door} 分鐘 + `, `${trip.door} min lift + `) : '', wk = wxAdj(trip.walk0 - (trip.door || 0));
    lines.push(L(`${Y(leaveT)} 出門 · ${dTxt}行 ${wk} 分鐘${bufTxt}去 ${esc(stopName(l.board))}`, `Leave ${Y(leaveT)} · ${dTxt}walk ${wk} min${bufTxt} to ${esc(stopName(l.board))}`));
    lines.push(L(`趕 ${Y(cur.boardT)} 嗰班 ${esc(rname(l))}`, `Catch the ${Y(cur.boardT)} ${esc(rname(l))}`) + (cur.est ? `<small>${L('（估計，暫無實時資料）', ' (estimated)')}</small>` : cur.sched ? `<small>${L('（時間表班次）', ' (scheduled)')}</small>` : ''));
    if (trip.to) lines.push(L(`約 ${Y(c.arriveT)} 到 ${esc(trip.to.label)}`, `Arrive ~${Y(c.arriveT)} at ${esc(trip.to.label)}`));
    btns = [['left', 'y', icon.door, L('出咗門', 'I’ve left')], ['other', 'd', icon.list, L('揀第二班', 'Another bus')], ['cancel', 'd', icon.x, L('取消', 'Cancel')]];
    say = rem > 0 ? L(`仲有 ${Math.ceil(rem / 60000)} 分鐘就要出門，${hhmm(leaveT)} 出門，搭 ${hhmm(cur.boardT)} 嗰班 ${rname(l)}`, `Leave in ${Math.ceil(rem / 60000)} minutes to catch the ${hhmm(cur.boardT)} ${rname(l)}`) : L('夠鐘出門', 'Time to leave');
    if (rem <= 120000 && rem > 0 && !trip.alerted.pre) { trip.alerted.pre = 1; save(); speak(L('仲有兩分鐘就要出門', 'Two minutes until you leave')); }
    if (rem <= 0 && !trip.alerted.leave) { trip.alerted.leave = 1; save(); notify(L('夠鐘出門！', 'Time to leave!'), L(`行去 ${stopName(l.board)} 搭 ${rname(l)}`, `Walk to ${stopName(l.board)} for the ${rname(l)}`)); speak(L(`夠鐘出門，去${stopName(l.board)}搭${rname(l)}`, `Time to leave for the ${rname(l)}`)); }
  } else if (trip.stage === 'go') {
    const rem = cur.boardT - T0;
    label = L(`${rname(l)} 仲有`, `${rname(l)} due in`);
    big = clock(Math.max(0, rem));
    const toStop = pos ? Math.round(dist(pos, stopLoc(l.board))) : null;
    lines.push(i > 0 ? L(`喺 ${esc(stopName(trip.legs[i - 1].alight))} 行 ${walkOf(i)} 分鐘去 ${esc(stopName(l.board))} 轉車`, `Walk ${walkOf(i)} min to ${esc(stopName(l.board))} to change`) : L(`行去 ${esc(stopName(l.board))}`, `Walk to ${esc(stopName(l.board))}`) + (toStop != null ? L(` · 仲有 <b class="dyn-m">${toStop}</b> 米`, ` · <b class="dyn-m">${toStop}</b> m to go`) : ''));
    lines.push(L(`${esc(rname(l))} 往 ${esc(nm(S.DB.routeList[l.key].dest))} · ${Y(cur.boardT)} 到站`, `${esc(rname(l))} to ${esc(nm(S.DB.routeList[l.key].dest))} · due ${Y(cur.boardT)}`));
    if (trip.to) lines.push(L(`約 ${Y(c.arriveT)} 到 ${esc(trip.to.label)}`, `Arrive ~${Y(c.arriveT)} at ${esc(trip.to.label)}`));
    note = L('保持呢個畫面開住，先收到到站提示', 'Keep this screen open for alerts');
    btns = [['board', 'y', icon.bus, L('上咗車', 'I’m on board')], ['other', 'd', icon.list, L('揀第二班', 'Another bus')], ['cancel', 'd', icon.x, L('取消', 'Cancel')]];
    say = L(`${rname(l)} 仲有 ${Math.max(0, Math.round(rem / 60000))} 分鐘到`, `${rname(l)} arrives in ${Math.max(0, Math.round(rem / 60000))} minutes`);
  } else if (trip.stage === 'ride') {
    if (l.aseq == null) {
      label = L('已經上車', 'On board'); big = L('一路順風', 'BON VOYAGE');
      lines.push(L(`${esc(rname(l))} 往 ${esc(nm(S.DB.routeList[l.key].dest))}`, `${esc(rname(l))} to ${esc(nm(S.DB.routeList[l.key].dest))}`));
      btns = [['finish', 'y', icon.door, L('完成', 'Done')]];
    } else {
      const rem = cur.alightT - T0, sl = stopsLeft(l);
      label = L('落車仲有', 'Get off in');
      big = clock(Math.max(0, rem));
      lines.push(L(`喺 ${esc(stopName(l.alight))} 落車`, `Get off at ${esc(stopName(l.alight))}`) + (sl ? L(` · 仲有 ${sl.left} 個站`, ` · ${sl.left} stops to go`) : ''));
      note = L('保持呢個畫面開住，先收到落車提示', 'Keep this screen open to get the alight alert');
      const nx = trip.legs[i + 1];
      if (nx) lines.push(xferLine(c, i));
      else if (trip.to) lines.push(L(`約 ${Y(c.arriveT)} 到 ${esc(trip.to.label)}`, `Arrive ~${Y(c.arriveT)} at ${esc(trip.to.label)}`));
      // 兩階段提示：快將到站（仲有 2 個站／約 3 分鐘）→ 下一站落車（仲有 1 個站／300 多米）
      const near = sl ? (sl.left <= 1 || sl.dAlight < 350) : rem < 90000;
      const soon = !near && (sl ? sl.left <= 2 : rem < 210000);
      const nx2 = trip.legs[i + 1];
      if (near) {
        alert = nx2 ? L(`下一站落車，轉 ${rname(nx2)}！`, `Next stop — change to ${rname(nx2)}!`) : L('下一站落車！', 'Next stop — get off!');
        if (!trip.alerted['a' + i]) { trip.alerted['a' + i] = 1; save(); notify(alert, stopName(l.alight)); speak(L(`下一站${stopName(l.alight)}，準備落車`, `Next stop ${stopName(l.alight)}, get ready to get off`)); }
      } else if (soon) {
        alert = L('快將到站，準備落車', 'Almost there — get ready');
        if (!trip.alerted['p' + i]) { trip.alerted['p' + i] = 1; save(); notify(alert, L(`${stopName(l.alight)} 落車`, `Get off at ${stopName(l.alight)}`)); speak(L(`仲有兩個站就到${stopName(l.alight)}`, `Two stops to ${stopName(l.alight)}`)); }
      }
      btns = [['alight', 'y', icon.door, L('落咗車', 'I’ve got off')], ['cancel', 'd', icon.x, L('取消', 'Cancel')]];
      say = L(`仲有大約 ${Math.max(0, Math.round(rem / 60000))} 分鐘，喺${stopName(l.alight)}落車`, `About ${Math.max(0, Math.round(rem / 60000))} minutes to ${stopName(l.alight)}`);
    }
  } else {
    label = L('到咗！', 'Arrived'); big = hhmm(T0);
    lines.push(trip.to ? esc(trip.to.label) : '');
    btns = [['finish', 'y', icon.door, L('完成', 'Done')]];
    say = L('到咗目的地', 'You have arrived');
  }
  if (shiftMsg && now() < shiftUntil) lines.unshift(`<span class="shift">${esc(shiftMsg)}</span>`);
  if (trip.stage === 'prep' || trip.stage === 'go') { const w = wxLine(); if (w) lines.push(w.replace(/^<p /, '<span ').replace(/<\/p>$/, '</span>')); }
  lastSay = say;
  wakeFor(trip.stage, trip.stage === 'prep' ? cur.boardT - walkOf(0) * 60000 - T0 : 0);
  if (shown && IOS && (trip.stage === 'go' || trip.stage === 'ride') && !note) note = L('保持呢個畫面開住，先收到提示', 'Keep this screen open for alerts');
  const pl = $('tripPill');
  if (!shown) {
    if (!pl.hidden) pl.innerHTML = `<span class="tp-t">${flaps(big.length > 8 ? '--:--' : big)}</span><span class="tp-l">${esc(label.replace(/<[^>]+>/g, ''))}<small>${esc(rname(l))}</small></span>`;
    return;
  }
  const prog = progress(c);
  const srText = `${label.replace(/<[^>]+>/g, '')} ${Math.max(0, Math.round(((trip.stage === 'prep' ? c.legs[i].boardT - walkOf(0) * 60000 : trip.stage === 'go' ? c.legs[i].boardT : (c.legs[i]?.alightT || T0)) - T0) / 60000))} ${L('分鐘', 'min')}`;
  const sig = [label, lines.join('|').replace(/<b class="dyn-m">\d+<\/b>/g, ''), btns.map(b => b[0]).join(','), alert, note, prog, wantWake, lowBatt, S.set.awake].join('§');
  const box = $('trip');
  // 只喺內容真係變咗先成塊重畫；平時每秒淨係換倒數數字，掣唔會被重建（唔會食咗撳掣，讀屏焦點唔會走）
  if (force || sig !== lastSig || !box.querySelector('.trip-big')) {
    lastSig = sig;
    box.innerHTML = `<div class="trip-in">
    <header class="trip-h"><span class="trip-sign">→ ${L('出門倒數', 'LEAVE BOARD')}</span>
      <button class="icon-btn" data-a="awake" type="button" aria-pressed="${S.set.awake !== 'off'}" aria-label="${S.set.awake !== 'off' ? L('螢幕常亮：開（撳一下關）', 'Keep awake: on') : L('螢幕常亮：關（撳一下開）', 'Keep awake: off')}">${S.set.awake !== 'off' ? icon.sun : icon.moon}</button>
      <button class="icon-btn" data-a="say" type="button" aria-label="${L('讀出', 'Read aloud')}">${icon.speak}</button>
      <button class="icon-btn" data-a="min" type="button" aria-label="${L('收細', 'Minimise')}">${icon.back}</button></header>
    <div class="trip-main">
      ${alert ? `<div class="trip-alert" role="alert">${esc(alert)}</div>` : ''}
      <p class="trip-lbl">${label}</p>
      <div class="trip-big" aria-hidden="true">${flaps(big, 'trip')}</div>
      <p class="sr" aria-live="polite">${esc(srText)}</p>
      <div class="trip-lines">${lines.filter(Boolean).map(x => `<p>${x}</p>`).join('')}</div>
      <div class="trip-btns">${btns.map(([a, k, ic, t]) => `<button class="tb ${k}" data-a="${a}" type="button">${ic}<span>${t}</span></button>`).join('')}</div>
      ${note ? `<p class="trip-note">${esc(note)}${IOS ? L('。iPhone 鎖咗機就唔會響。', '. iPhone won’t alert while locked.') : ''}</p>` : ''}
      ${trip.stage === 'prep' ? `<button class="trip-cal" data-a="buf" type="button">${icon.walk}<span>${L(`額外預留 +${trip.buf || 0} 分鐘（天橋、紅綠燈）· 撳一下改`, `Extra time +${trip.buf || 0} min (footbridges, lights) · tap to change`)}</span></button>` : ''}
      ${trip.stage !== 'done' && trip.to ? `<button class="trip-cal" data-a="share" type="button">${icon.share}<span>${L('分享行程俾屋企人／朋友（WhatsApp）', 'Share my trip (WhatsApp)')}</span></button>` : ''}
      ${trip.stage !== 'done' ? `<button class="trip-cal" data-a="cal" type="button">${icon.bell}<span>${IOS ? L('加入行事曆提醒（鎖機都會響）', 'Add calendar alarms (work when locked)') : L('加入行事曆提醒', 'Add calendar alarms')}</span></button>` : ''}
      ${wantWake ? `<p class="trip-note dim">${L('螢幕會保持常亮', 'Screen stays on')}${lowBatt ? '' : ''}</p>` : lowBatt && S.set.awake !== 'off' ? `<p class="trip-note dim">${L('電量低過 20%，已停用螢幕常亮', 'Battery below 20% — keep-awake paused')}</p>` : ''}
    </div>
    <div class="trip-prog" aria-label="${L('行程', 'Journey')}">${prog}</div></div>`;
  } else {
    box.querySelector('.trip-big').innerHTML = flaps(big, 'trip');
    const sr = box.querySelector('.sr'); if (sr.textContent !== srText) sr.textContent = srText;
    const m = lines.join('').match(/<b class="dyn-m">(\d+)<\/b>/), dm = box.querySelector('.dyn-m');
    if (m && dm && dm.textContent !== m[1]) dm.textContent = m[1];
  }
}
// 轉車實時判斷：落車後行去轉車站，邊班趕得切、邊班趕唔切
function xferLine(c, i){
  const nx = trip.legs[i + 1], w = walkOf(i + 1), arr = c.legs[i].alightT + w * 60000, T0 = now();
  const list = (lists[i + 1]?.list || []).filter(e => e.t >= T0);
  const miss = list.filter(e => e.t < arr - 30000 && e.t >= c.legs[i].alightT - 60000).pop();
  const nxt = c.legs[i + 1], inM = t => Math.max(0, Math.round((t - T0) / 60000));
  let s = w ? L(`落車後行 ${w} 分鐘轉 ${esc(rname(nx))}`, `Then walk ${w} min to the ${esc(rname(nx))}`) : L(`落車後同站轉 ${esc(rname(nx))}`, `Then change to the ${esc(rname(nx))} here`);
  if (miss) s += L(`：${Y(miss.t)} 嗰班（${inM(miss.t)} 分鐘後）<b class="late">趕唔切</b>，搭 ${Y(nxt.boardT)} 嗰班（${inM(nxt.boardT)} 分鐘後）`,
    `: the ${Y(miss.t)} (in ${inM(miss.t)} min) is <b class="late">too soon</b>, take the ${Y(nxt.boardT)} (in ${inM(nxt.boardT)} min)`);
  else s += L(`：<b class="go">趕得切</b> ${Y(nxt.boardT)} 嗰班（${inM(nxt.boardT)} 分鐘後${nxt.est ? '，估計' : ''}）`, `: <b class="go">you’ll make</b> the ${Y(nxt.boardT)} (in ${inM(nxt.boardT)} min${nxt.est ? ', est.' : ''})`);
  return s;
}
function progress(c){
  const parts = [], i = trip.li, st = trip.stage;
  parts.push(`<span class="pg-s ${i === 0 && st === 'prep' ? 'now' : 'done'}">${icon.walk}<small>${trip.walk0}′</small></span>`);
  trip.legs.forEach((l, k) => {
    if (k > 0) parts.push(`<span class="pg-s ${k === i && st === 'go' ? 'now' : k < i || (k === i && st === 'ride') ? 'done' : ''}">${icon.walk}<small>${l.walk || 0}′</small></span>`);
    parts.push(`<span class="pg-s ${k === i && (st === 'go' || st === 'ride') ? 'now' : k < i || st === 'done' ? 'done' : ''}">${tiles(l)}<small>${c.legs[k] ? hhmm(c.legs[k].boardT) : ''}</small></span>`);
  });
  parts.push(`<span class="pg-s ${st === 'done' ? 'now' : ''}">${icon.pin}<small>${trip.to ? hhmm(c.arriveT) : ''}</small></span>`);
  return parts.join('<i class="pg-line" aria-hidden="true"></i>');
}

/* ---------- 撳掣 ---------- */
document.addEventListener('click', e => {
  const pl = e.target.closest('#tripPill');
  if (pl && trip) { open(); return; }
  const b = e.target.closest('#trip [data-a]'); if (!b || !trip) return;
  const a = b.dataset.a;
  if (a === 'min') { if (layer) back(); else pill(); }
  else if (a === 'say') speak(lastSay);
  else if (a === 'awake') { S.set.awake = S.set.awake === 'off' ? 'auto' : 'off'; saveSettings(); toast(S.set.awake === 'off' ? L('已關閉螢幕常亮', 'Keep-awake off') : L('已開啟螢幕常亮', 'Keep-awake on')); paint(true); }
  else if (a === 'cal') calendar();
  else if (a === 'share') { const c = chain(); shareTrip(trip, c, c.legs[0] ? c.legs[0].boardT - walkOf(0) * 60000 : null); }
  else if (a === 'buf') { trip.buf = BUFS[(BUFS.indexOf(trip.buf || 0) + 1) % BUFS.length]; store.set('tripBuf', trip.buf); trip.est = []; save(); paint(true); }
  else if (a === 'cancel') { stop(); toast(L('已取消', 'Cancelled')); }
  else if (a === 'finish') stop();
  else if (a === 'left') { logTrip(trip); trip.stage = 'go'; trip.leftAt = now(); trip.pick[0] = chain().legs[0].boardT; save(); watchGps(); paint(); }
  else if (a === 'board') { trip.stage = 'ride'; trip.boardedAt[trip.li] = now(); save(); watchGps(); paint(); }
  else if (a === 'alight') {
    if (trip.li < trip.legs.length - 1) { trip.li++; trip.stage = 'go'; trip.leftAt = now(); }
    else trip.stage = 'done';
    save(); load(); paint();
  } else if (a === 'other') other();
});

function other(){
  const c = chain(), i = trip.li, l = trip.legs[i], list = (lists[i]?.list || []).filter(e => mins(e.t) >= 0);
  const w = trip.stage === 'prep' ? walkOf(0) : 0;
  const rows = list.slice(0, 5).map(e => {
    const late = mins(e.t) < w;
    return `<button class="pick${late ? ' late' : ''}" type="button" data-t="${e.t}" ${late ? 'disabled' : ''}>
      <span class="pk-t">${hhmm(e.t)}</span><span class="pk-m"><b>${esc(rname(l))}</b><small>${late ? L('趕唔切', 'Too soon') : trip.stage === 'prep' ? L(`${hhmm(e.t - w * 60000)} 出門`, `leave ${hhmm(e.t - w * 60000)}`) : L(`${mins(e.t)} 分鐘後到`, `in ${mins(e.t)} min`)}${e.sched ? ' · ' + L('時間表', 'scheduled') : ''}</small></span></button>`;
  }).join('');
  openSheet(`<h2 class="sh-title">${L('揀第二班', 'Pick another departure')}</h2>
    <div class="picks">${rows || `<p class="hint">${L('暫時冇其他班次資料', 'No other departures available')}</p>`}</div>
    ${trip.alts && trip.stage === 'prep' ? `<button class="btn-d big" id="altPlans" type="button">${icon.list}<span>${L('睇其他路線方案', 'Other route options')}</span></button><div id="altList"></div>` : ''}`, card => {
    card.querySelector('.picks').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; trip.pick[i] = +b.dataset.t; save(); closeSheet(); paint(); };
    card.querySelector('#altPlans')?.addEventListener('click', async ev => {
      ev.currentTarget.disabled = true;
      const box = card.querySelector('#altList'); box.innerHTML = `<p class="loading">${L('計緊…', 'Planning…')}</p>`;
      const opts = await planTrip(trip.alts.from, trip.alts.to, 5);
      box.innerHTML = opts.filter(o => o.legs.length).map((o, k) => `<button class="pick" type="button" data-k="${k}"><span class="pk-t">${hhmm(o.arriveT)}</span><span class="pk-m"><span class="legs">${legChips(o)}</span><small>${L(`${hhmm(o.leaveT)} 出門`, `leave ${hhmm(o.leaveT)}`)}</small></span></button>`).join('');
      box.onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; const o = opts[+b.dataset.k]; closeSheet(() => startTrip({...toTrip(o, trip.alts.from, trip.alts.to), alts: trip.alts})); };
    });
  });
}

/* ---------- 行事曆提醒：iPhone 鎖咗機網頁 app 唔會響，行事曆鬧鐘一定會響 ---------- */
function calendar(){
  const c = chain(), stamp = t => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = [], uid = Date.now();
  const add = (k, start, end, title, desc) => ev.push(['BEGIN:VEVENT', `UID:hkgo-${uid}-${k}@hkgo`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(Math.max(end, start + 60000))}`,
    `SUMMARY:${title.replace(/[,;\n]/g, ' ')}`, `DESCRIPTION:${desc.replace(/[,;\n]/g, ' ')}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${title.replace(/[,;\n]/g, ' ')}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT'].join('\r\n'));
  const i0 = trip.li;
  if (trip.stage === 'prep') { const l = trip.legs[0], lv = c.legs[0].boardT - walkOf(0) * 60000; add('leave', lv, c.legs[0].boardT, L(`港住走：出門搭 ${rname(l)}`, `Rushing HK: leave for ${rname(l)}`), L(`${hhmm(lv)} 出門 · 行去 ${stopName(l.board)} · ${hhmm(c.legs[0].boardT)} 班車`, `Leave ${hhmm(lv)} for ${stopName(l.board)}`)); }
  trip.legs.forEach((l, k) => {
    if (k < i0 || !c.legs[k] || l.aseq == null) return;
    const a = c.legs[k].alightT, nx = trip.legs[k + 1];
    add('off' + k, a - 3 * 60000, a, L(`港住走：準備喺 ${stopName(l.alight)} 落車`, `Rushing HK: get off at ${stopName(l.alight)}`), nx ? L(`落車後轉 ${rname(nx)}`, `Then change to ${rname(nx)}`) : L('就快到目的地', 'Almost there'));
  });
  if (!ev.length) { toast(L('揀咗落車站先可以加提醒', 'Pick an alight stop first')); return; }
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HKGO//Trip//ZH', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], {type: 'text/calendar;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = 'hkgo-trip.ics'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast(L('打開檔案就可以加入行事曆；時間有變要再加過', 'Open the file to add it; re-add if times change'), 5000);
}
