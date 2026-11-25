// 港住走 · 地圖（Leaflet + 地政總署底圖）
import {S} from './core.js';

let loading = null;
export function mapLib(){
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;
  // App 版（scripts/build-app.sh 打包）用內置嘅 Leaflet，冇網都開到地圖；網頁版用 CDN
  const base = window.HKGO_BUNDLED ? 'vendor/leaflet/' : 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  loading = new Promise((res, rej) => {
    // 等埋 CSS 載入先畫地圖：Leaflet 嘅 CSS 未到，手機一隻手指拖會變咗碌成個頁面
    const css = document.createElement('link');
    const cssReady = new Promise(ok => { css.onload = ok; css.onerror = ok; setTimeout(ok, 4000); });
    css.rel = 'stylesheet'; css.href = base + 'leaflet.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = base + 'leaflet.min.js';
    s.onload = () => window.L ? cssReady.then(() => res(window.L)) : rej(new Error('leaflet'));
    s.onerror = () => { loading = null; rej(new Error('leaflet')); };
    document.head.appendChild(s);
  });
  return loading;
}

// preview：細地圖做預覽，手指上下掃係碌頁面；撳一下先開全螢幕可以拖
export async function makeMap(el, center, zoom = 17, opt = {}){
  const L = await mapLib();
  if (el._map) { el._map.remove(); el._map = null; }
  // 一隻手指拖動、兩隻手指縮放（明確開啟，唔靠預設）
  const m = L.map(el, {zoomControl: false, minZoom: 10, maxZoom: 19, maxBounds: [[22.05, 113.75], [22.65, 114.55]], attributionControl: true,
    dragging: !opt.preview, touchZoom: !opt.preview, doubleClickZoom: !opt.preview, scrollWheelZoom: !opt.preview, boxZoom: !opt.preview, keyboard: !opt.preview, inertia: true, bounceAtZoomLimits: false})
    .setView([center.lat, center.lng], zoom);
  m.attributionControl.setPrefix(false);
  L.tileLayer('https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '<a href="https://api.portal.hkmapservice.gov.hk/disclaimer" target="_blank" rel="noopener">© 地政總署</a>'
  }).addTo(m);
  L.tileLayer(`https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/${S.set.lang === 'en' ? 'en' : 'tc'}/WGS84/{z}/{x}/{y}.png`, {maxZoom: 19, className: 'lbl'}).addTo(m);
  L.control.zoom({position: 'bottomright'}).addTo(m);
  el._map = m;
  setTimeout(() => m.invalidateSize(), 60);
  return m;
}
export const pin = (html, cls = '', size = 28) => window.L.divIcon({className: 'pin ' + cls, html, iconSize: [size, size], iconAnchor: [size / 2, size / 2]});
export const youIcon = () => window.L.divIcon({className: 'you', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9]});
