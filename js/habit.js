// 港住走 · 自動學識通勤習慣
// 每次用出門倒數撳「出咗門」就記低：幾點、由邊度去邊度、搭咩車。
// 同一個起點去同一個目的地、平日（或週末）大約同一個鐘數出現 3 日或以上，就當係你嘅通勤習慣。
// 之後喺嗰個鐘數前後，常用頁頂會自動出「X 分鐘後出門」，App 版仲會每日預約系統通知。
// 全部紀錄只存喺呢部機（localStorage），唔會上傳。
import {S, store, L, now, dist, dayIdx, lineName} from './core.js';

const KEY = 'habitLog', MAX = 80, NEAR = 350, MIN_DAYS = 3, SPREAD = 40;
const hkMin = t => { const d = new Date(t + 288e5); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hkDay = t => new Date(t + 288e5).toISOString().slice(0, 10);
const isWk = () => { const d = dayIdx(); return d >= 1 && d <= 5; };   // 公眾假期當星期日
const pt = p => p && {lat: +(+p.lat).toFixed(5), lng: +(+p.lng).toFixed(5), label: p.label || ''};

export const habitLog = () => store.get(KEY, []);
// 出門嗰刻記低一程（同一日同一個目的地只記一次）
export function logTrip(trip, t = now()){
  if (S.set.learn === 'off' || !trip?.from || !trip?.to || !trip.legs?.length) return;
  const log = habitLog(), day = hkDay(t), to = pt(trip.to);
  if (log.some(e => e.day === day && dist(e.to, to) < NEAR)) return;
  const lines = [...new Set(trip.legs.map(l => { const r = S.DB.routeList[l.key]; return r ? (l.co === 'mtr' ? 'mtr:' + r.route : String(r.route).toUpperCase()) : null; }).filter(Boolean))];
  log.push({t, day, m: hkMin(t), wk: isWk(), from: pt(trip.from), to, lines, first: trip.legs[0] && {key: trip.legs[0].key, board: trip.legs[0].board}});
  store.set(KEY, log.slice(-MAX));
}
export const clearHabits = () => store.del(KEY);

// 將紀錄分組：起點、目的地都喺 350 米內、同樣係平日／週末、出門時間相差 40 分鐘內
export function learned(log = habitLog()){
  const groups = [];
  for (const e of log) {
    let g = groups.find(g => g.wk === e.wk && dist(g.from, e.from) < NEAR && dist(g.to, e.to) < NEAR && Math.abs(g.m - e.m) <= SPREAD);
    if (!g) groups.push(g = {wk: e.wk, from: e.from, to: e.to, m: e.m, items: []});
    g.items.push(e);
    const ms = g.items.map(x => x.m).sort((a, b) => a - b);
    g.m = ms[Math.floor(ms.length / 2)];               // 中位數：偶然一日遲出門唔會拉歪
  }
  return groups.map(g => {
    const days = new Set(g.items.map(x => x.day)).size;
    const last = g.items[g.items.length - 1];
    const cnt = new Map(); for (const x of g.items) for (const ln of x.lines || []) cnt.set(ln, (cnt.get(ln) || 0) + 1);
    return {wk: g.wk, from: last.from, to: last.to, m: g.m, days, lines: [...cnt.keys()].filter(k => cnt.get(k) * 2 >= g.items.length), label: last.to.label || L('常去地方', 'Usual place'), first: last.first};
  }).filter(g => g.days >= MIN_DAYS).sort((a, b) => a.m - b.m);
}
export const fmtMin = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

// 而家應該提你嘅通勤：今日類型啱（平日／週末）、而家喺平時出門前 60 分鐘至後 20 分鐘之內、
// 而且你唔係已經喺目的地附近
export function dueCommute(t = now()){
  if (S.set.learn === 'off') return null;
  const m = hkMin(t), wk = isWk();
  const near = p => S.here && dist(S.here, p) < 400;
  const c = learned().filter(g => g.wk === wk && m >= g.m - 60 && m <= g.m + 20 && !near(g.to))
    .sort((a, b) => (S.here ? dist(S.here, a.from) - dist(S.here, b.from) : 0) || Math.abs(a.m - m) - Math.abs(b.m - m));
  return c[0] || null;
}
// 所有通勤會用到嘅路線（俾路線出事通知用）
export const habitLines = () => [...new Set(learned().flatMap(g => g.lines))];

/* ---------- App Store 版：每日喺平時出門前 10 分鐘彈系統通知（連 app 都唔使開） ---------- */
const LN = () => window.Capacitor?.Plugins?.LocalNotifications;
const HIDS = Array.from({length: 20}, (_, i) => 7200 + i);
export async function scheduleHabitNotifs(){
  const ln = LN(); if (!ln) return;
  const list = S.set.learn === 'off' ? [] : learned().slice(0, 4);
  const sig = list.map(g => g.wk + ':' + g.m + ':' + g.label).join('|');
  if (sig === store.get('habitSig', null)) return;
  store.set('habitSig', sig);
  try {
    await ln.cancel({notifications: HIDS.map(id => ({id}))});
    const out = []; let k = 0;
    for (const g of list) {
      const at = Math.max(0, g.m - 10), days = g.wk ? [2, 3, 4, 5, 6] : [1, 7];   // Capacitor：1 = 星期日
      for (const wd of days) {
        if (k >= HIDS.length) break;
        out.push({id: HIDS[k++], title: L(`${fmtMin(g.m)} 出門去${g.label}`, `Leave ${fmtMin(g.m)} for ${g.label}`),
          body: L('撳入睇最新班次同出門倒數', 'Tap for live departures and your leave countdown'),
          schedule: {on: {weekday: wd, hour: Math.floor(at / 60), minute: at % 60}, allowWhileIdle: true}, extra: {habit: true}});
      }
    }
    if (out.length) await ln.schedule({notifications: out});
  } catch {}
}
// 描述一個習慣（設定頁用）
export const describe = g => L(`${g.wk ? '平日' : '週末'} ${fmtMin(g.m)} 出門去 ${g.label}（${g.days} 日）`, `${g.wk ? 'Weekdays' : 'Weekends'} ${fmtMin(g.m)} to ${g.label} (${g.days} days)`)
  + (g.lines.length ? ' · ' + g.lines.map(x => x.startsWith('mtr:') ? lineName(x.slice(4)) : x).join('、') : '');
