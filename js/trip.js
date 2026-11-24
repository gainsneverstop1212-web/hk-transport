// 港途 · 出門倒數模式（由出門、等車、搭車到落車提示）
import {S, $, esc, store, L, nm, hhmm, mins, now, flaps, routeTiles, lineTiles, lineName, stopName, stopLoc, dist, rideMin, avgWait,
  speak, notify, toast, icon} from './core.js';
import {cycle, etaFor} from './eta.js';
import {openSheet, closeSheet} from './ui.js';
import {planTrip, toTrip, legChips} from './plan.js';

let trip = null, lists = [], tick = null, poll = null, wake = null, gpsW = null, pos = null, lastSay = '', shown = false, lastSig = '';

export function initTrip(){
  const saved = store.get('trip', null);
  if (saved && now() - saved.startedAt < 3 * 3600e3 && saved.stage !== 'done') { trip = saved; start(false); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && trip) { if (shown) lockScreen(); load(); paint(true); } });
}
export function startTrip(t){
  if (!t.legs?.length) return;
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  trip = {...t, stage: 'prep', li: 0, pick: t.legs.map(() => null), boardedAt: [], leftAt: null, startedAt: now(), alerted: {}};
  save(); start(true);
}
const save = () => store.set('trip', trip);
function start(show){
  lists = trip.legs.map(() => null);
  clearInterval(tick); clearInterval(poll);
  tick = setInterval(paint, 1000);
  poll = setInterval(() => { if (!document.hidden) load(); }, 20000);
  load();
  show ? open() : pill();
}
function stop(){
  clearInterval(tick); clearInterval(poll); tick = poll = null;
  if (gpsW != null) { navigator.geolocation.clearWatch(gpsW); gpsW = null; }
  release(); trip = null; store.del('trip');
  $('trip').hidden = true; $('trip').innerHTML = ''; $('tripPill').hidden = true; shown = false;
  document.body.classList.remove('tripping');
}
function open(){ lastSig = ''; shown = true; $('trip').hidden = false; $('tripPill').hidden = true; document.body.classList.add('tripping'); lockScreen(); paint(true); }
function pill(){ shown = false; $('trip').hidden = true; document.body.classList.remove('tripping'); release(); $('tripPill').hidden = false; paint(); }

async function lockScreen(){ try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch {} }
function release(){ try { wake?.release(); } catch {} wake = null; }
function watchGps(){
  if (gpsW != null || !('geolocation' in navigator)) return;
  gpsW = navigator.geolocation.watchPosition(p => { pos = {lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy}; }, () => {}, {enableHighAccuracy: true, maximumAge: 5000});
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
}

/* ---------- 計時間 ---------- */
const walkOf = i => i === 0 ? trip.walk0 : (trip.legs[i].walk || 0);
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
    const boardT = e ? e.t : earliest + avgWait(r, l.co) * 60000;
    out.push({boardT, alightT: boardT + ride, live: !!e && !e.sched, sched: !!e?.sched, est: !e, list});
    t = boardT + ride;
  }
  return {legs: out, arriveT: t + (trip.walkEnd || 0) * 60000};
}
const clock = ms => {
  const neg = ms < 0, s = Math.floor(Math.abs(ms) / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  return (neg ? '-' : '') + (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(ss).padStart(2, '0');
};
const rname = l => { const r = S.DB.routeList[l.key]; return l.co === 'mtr' ? lineName(r.route) : r.route; };
const tiles = l => { const r = S.DB.routeList[l.key]; return l.co === 'mtr' ? lineTiles(r.route) : routeTiles(r.route); };
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
  if (trip.stage === 'prep') {
    const leaveT = cur.boardT - walkOf(0) * 60000, rem = leaveT - T0;
    if (trip.pick[0] && rem < -90000) { trip.pick[0] = null; save(); toast(L('嗰班趕唔切，已改搭下一班', 'Missed it — switched to the next one')); }
    label = rem > 0 ? L('距離出門仲有', 'Leave in') : L('夠鐘出門！', 'Time to go!');
    big = clock(Math.max(0, rem));
    lines.push(L(`${Y(leaveT)} 出門 · 行 ${walkOf(0)} 分鐘去 ${esc(stopName(l.board))}`, `Leave ${Y(leaveT)} · walk ${walkOf(0)} min to ${esc(stopName(l.board))}`));
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
      if (nx) lines.push(L(`落車後行 ${walkOf(i + 1)} 分鐘轉 ${esc(rname(nx))}（${Y(c.legs[i + 1].boardT)} 到）`, `Then walk ${walkOf(i + 1)} min to the ${esc(rname(nx))} (due ${Y(c.legs[i + 1].boardT)})`));
      else if (trip.to) lines.push(L(`約 ${Y(c.arriveT)} 到 ${esc(trip.to.label)}`, `Arrive ~${Y(c.arriveT)} at ${esc(trip.to.label)}`));
      const near = sl ? (sl.left <= 1 || sl.dAlight < 350) : rem < 90000;
      if (near) {
        alert = L('下一站落車！', 'Next stop — get off!');
        if (!trip.alerted['a' + i]) { trip.alerted['a' + i] = 1; save(); notify(alert, stopName(l.alight)); speak(L(`下一站${stopName(l.alight)}，準備落車`, `Next stop ${stopName(l.alight)}, get ready to get off`)); }
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
  lastSay = say;
  const pl = $('tripPill');
  if (!shown) {
    if (!pl.hidden) pl.innerHTML = `<span class="tp-t">${flaps(big.length > 8 ? '--:--' : big)}</span><span class="tp-l">${esc(label.replace(/<[^>]+>/g, ''))}<small>${esc(rname(l))}</small></span>`;
    return;
  }
  const prog = progress(c);
  const srText = `${label.replace(/<[^>]+>/g, '')} ${Math.max(0, Math.round(((trip.stage === 'prep' ? c.legs[i].boardT - walkOf(0) * 60000 : trip.stage === 'go' ? c.legs[i].boardT : (c.legs[i]?.alightT || T0)) - T0) / 60000))} ${L('分鐘', 'min')}`;
  const sig = [label, lines.join('|').replace(/<b class="dyn-m">\d+<\/b>/g, ''), btns.map(b => b[0]).join(','), alert, note, prog].join('§');
  const box = $('trip');
  // 只喺內容真係變咗先成塊重畫；平時每秒淨係換倒數數字，掣唔會被重建（唔會食咗撳掣，讀屏焦點唔會走）
  if (force || sig !== lastSig || !box.querySelector('.trip-big')) {
    lastSig = sig;
    box.innerHTML = `<div class="trip-in">
    <header class="trip-h"><span class="trip-sign">→ ${L('出門倒數', 'LEAVE BOARD')}</span>
      <button class="icon-btn" data-a="say" type="button" aria-label="${L('讀出', 'Read aloud')}">${icon.speak}</button>
      <button class="icon-btn" data-a="min" type="button" aria-label="${L('收細', 'Minimise')}">${icon.back}</button></header>
    <div class="trip-main">
      ${alert ? `<div class="trip-alert" role="alert">${esc(alert)}</div>` : ''}
      <p class="trip-lbl">${label}</p>
      <div class="trip-big" aria-hidden="true">${flaps(big, 'trip')}</div>
      <p class="sr" aria-live="polite">${esc(srText)}</p>
      <div class="trip-lines">${lines.filter(Boolean).map(x => `<p>${x}</p>`).join('')}</div>
      <div class="trip-btns">${btns.map(([a, k, ic, t]) => `<button class="tb ${k}" data-a="${a}" type="button">${ic}<span>${t}</span></button>`).join('')}</div>
      ${note ? `<p class="trip-note">${esc(note)}</p>` : ''}
    </div>
    <div class="trip-prog" aria-label="${L('行程', 'Journey')}">${prog}</div></div>`;
  } else {
    box.querySelector('.trip-big').innerHTML = flaps(big, 'trip');
    const sr = box.querySelector('.sr'); if (sr.textContent !== srText) sr.textContent = srText;
    const m = lines.join('').match(/<b class="dyn-m">(\d+)<\/b>/), dm = box.querySelector('.dyn-m');
    if (m && dm && dm.textContent !== m[1]) dm.textContent = m[1];
  }
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
  if (a === 'min') pill();
  else if (a === 'say') speak(lastSay);
  else if (a === 'cancel') { stop(); toast(L('已取消', 'Cancelled')); }
  else if (a === 'finish') stop();
  else if (a === 'left') { trip.stage = 'go'; trip.leftAt = now(); trip.pick[0] = chain().legs[0].boardT; save(); watchGps(); paint(); }
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
      box.onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; const o = opts[+b.dataset.k]; closeSheet(); startTrip({...toTrip(o, trip.alts.from, trip.alts.to), alts: trip.alts}); };
    });
  });
}
