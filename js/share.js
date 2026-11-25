// 港途 · 分享行程：一撳就喺 WhatsApp 話俾屋企人／朋友知你搭緊咩車、幾時到
// 對方開條連結（share.html）就會見到嗰程車嘅實時到站同預計到達時間，唔使裝 app、唔使下載路線資料。
// 冇伺服器、冇追蹤你嘅位置：連結只係包含路線、落車站同預計時間。
import {S, esc, L, hhmm, stopName, routeLabel, icon, toast} from './core.js';
import {openSheet, closeSheet} from './ui.js';

const PUBLIC = 'https://gainsneverstop1212-web.github.io/hk-transport/';
const LIVE = new Set(['kmb', 'ctb', 'gmb', 'nlb', 'mtr', 'lrtfeeder']);   // 唔使路線資料都查到實時到站嘅營辦商

// 用最後一程（落車就到目的地嗰程）做實時追蹤
export function shareLink(trip, c){
  const k = trip.legs.length - 1, l = trip.legs[k], r = S.DB.routeList[l.key], lc = c.legs[k];
  const p = new URLSearchParams({
    co: l.co, r: r.route, s: l.alight ?? '', q: l.aseq ?? '', d: r.bound?.[l.co] || '', st: r.serviceType ?? '', g: r.gtfsId ?? '', n: r.nlbId ?? '',
    rl: routeLabel(r), sn: l.alight ? stopName(l.alight) : '', to: trip.to?.label || '',
    ea: lc ? Math.round(lc.alightT) : '', at: Math.round(c.arriveT), we: trip.walkEnd || 0, z: S.set.lang === 'en' ? 'en' : 'zh', ts: Date.now()
  });
  if (l.co === 'mtr' && l.aseq != null) p.set('dn', (r.stops.mtr || []).slice(l.aseq + 1).join(','));
  if (!LIVE.has(l.co) || l.aseq == null) p.set('nolive', '1');
  // App Store 版嘅網址係 capacitor://，對方開唔到：一律用公開網頁版
  const base = /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname) ? location.href : PUBLIC;
  return new URL('share.html', base).href.split('#')[0] + '#' + p.toString();
}
export function shareText(trip, c, lv){
  const l = trip.legs[trip.li] || trip.legs[0], rn = routeLabel(S.DB.routeList[l.key]), to = trip.to?.label || '', at = hhmm(c.arriveT);
  if (trip.stage === 'prep') { lv = lv ?? c.legs[0].boardT - (trip.walk0 + (trip.buf || 0)) * 60000; return L(`我 ${hhmm(lv)} 出門，搭 ${rn}，大約 ${at} 到${to}`, `Leaving at ${hhmm(lv)}, taking the ${rn}, should reach ${to} around ${at}`); }
  if (trip.stage === 'go') return L(`我出咗門，等緊 ${rn}，大約 ${at} 到${to}`, `On my way, waiting for the ${rn}, should reach ${to} around ${at}`);
  return L(`我搭緊 ${rn}，大約 ${at} 到${to}`, `I'm on the ${rn}, should reach ${to} around ${at}`);
}
export function shareTrip(trip, c, lv){
  const url = shareLink(trip, c), text = shareText(trip, c, lv), msg = `${text}\n${L('睇實時到站：', 'Live arrival: ')}${url}`;
  openSheet(`<h2 class="sh-title">${L('分享行程', 'Share trip')}</h2>
    <p class="share-prev">${esc(text)}</p>
    <div class="sh-btns">
      <a class="btn-y big" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" data-close>${icon.share}<span>WhatsApp</span></a>
      ${navigator.share ? `<button class="btn-d big" type="button" id="shOther">${icon.list}<span>${L('其他 app', 'Other apps')}</span></button>` : ''}
      <button class="btn-d big" type="button" id="shCopy">${icon.list}<span>${L('複製連結', 'Copy link')}</span></button></div>
    <p class="hint">${L('對方開連結就見到嗰程車嘅實時到站同預計到達時間，唔使裝 app。連結唔會包含你嘅位置；時間有大變可以再分享一次。', 'They see live arrival and ETA without installing anything. The link has no location; share again if times change a lot.')}</p>`, card => {
    card.querySelector('#shOther')?.addEventListener('click', () => { navigator.share({text, url}).then(() => closeSheet()).catch(() => {}); });
    card.querySelector('#shCopy').addEventListener('click', () => { navigator.clipboard?.writeText(msg).then(() => { toast(L('已複製', 'Copied')); closeSheet(); }, () => toast(L('複製唔到', 'Could not copy'))); });
  });
}
