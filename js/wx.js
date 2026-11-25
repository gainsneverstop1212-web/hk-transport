// 港途 · 天氣提示：落雨、暴雨警告、熱帶氣旋信號會令步行慢啲，自動加長步行時間（資料：香港天文台開放數據）
import {S, L, esc} from './core.js';
import {emit} from './ui.js';

const API = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=';
const RAIN_ICONS = new Set([62, 63, 64, 65]);   // 天文台天氣圖示：微雨、雨、大雨、雷暴
let at = 0;

// 由天文台資料計出 {factor, level, msg}；factor 會乘落每段步行時間
export function judge(warn, now){
  const rain = warn.WRAIN?.actionCode !== 'CANCEL' ? warn.WRAIN?.code : null;
  const tc = warn.WTCSGNL?.actionCode !== 'CANCEL' ? warn.WTCSGNL?.code || '' : '';
  const tcN = /^TC(\d+)/.exec(tc)?.[1] | 0;
  const icons = now?.icon || [];
  const wet = icons.some(i => RAIN_ICONS.has(+i)) || (now?.rainfall?.data || []).filter(d => +d.max >= 2).length >= 3;
  if (rain === 'WRAINB') return {factor: 1.5, level: 'black', msg: L('黑色暴雨警告：留喺安全地方，非必要唔好出門', 'Black Rainstorm: stay indoors unless essential')};
  if (tcN >= 8) return {factor: 1.3, level: 'tc8', msg: L(`${tcN} 號風球：大部分巴士小巴會停駛，港鐵露天段可能暫停`, `Signal No. ${tcN}: most buses suspended, MTR open sections may stop`)};
  if (rain === 'WRAINR') return {factor: 1.3, level: 'red', msg: L('紅色暴雨警告：步行時間已加長 30%，路面水浸要小心', 'Red Rainstorm: walking time +30%, watch for flooding')};
  if (rain === 'WRAINA') return {factor: 1.2, level: 'amber', msg: L('黃色暴雨警告：步行時間已加長 20%，記得帶遮', 'Amber Rainstorm: walking time +20%, bring an umbrella')};
  if (tcN === 3) return {factor: 1.1, level: 'tc3', msg: L('三號強風信號：步行時間已加長 10%，小心大風', 'Strong Wind Signal No. 3: walking time +10%')};
  if (wet) return {factor: 1.1, level: 'rain', msg: L('落緊雨：步行時間已加長 10%，記得帶遮', 'Raining: walking time +10%, bring an umbrella')};
  return {factor: 1, level: '', msg: ''};
}

export async function refreshWx(force){
  if (!force && Date.now() - at < 600000) return S.wx;
  at = Date.now();
  try {
    const lang = S.set.lang === 'en' ? 'en' : 'tc';
    const [warn, now] = await Promise.all([
      fetch(API + 'warnsum&lang=' + lang, {cache: 'no-store'}).then(r => r.json()),
      fetch(API + 'rhrread&lang=' + lang, {cache: 'no-store'}).then(r => r.json()).catch(() => null)
    ]);
    const prev = S.wx?.level;
    S.wx = {...judge(warn || {}, now), at: Date.now()};
    if (prev !== S.wx.level) emit('wx', S.wx);
  } catch { at = Date.now() - 480000; }          // 失敗：2 分鐘後再試
  return S.wx;
}
export function initWx(){
  refreshWx(true);
  setInterval(() => { if (!document.hidden) refreshWx(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshWx(); });
}
// 一行天氣提示（冇特別天氣就係空字串）
export const wxLine = () => S.wx?.msg ? `<p class="wx wx-${S.wx.level}" role="status">${wxIcon}<span>${esc(S.wx.msg)}</span></p>` : '';
const wxIcon = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 18 0zM12 12v7a2 2 0 0 1-4 0" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linejoin="round"/></svg>';
