// 港途 · 地圖（Leaflet + 地政總署底圖）
import {S} from './core.js';

let loading = null;
export function mapLib(){
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;
  loading = new Promise((res, rej) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    s.onload = () => window.L ? res(window.L) : rej(new Error('leaflet'));
    s.onerror = () => { loading = null; rej(new Error('leaflet')); };
    document.head.appendChild(s);
  });
  return loading;
}

export async function makeMap(el, center, zoom = 17){
  const L = await mapLib();
  if (el._map) { el._map.remove(); el._map = null; }
  const m = L.map(el, {zoomControl: false, minZoom: 10, maxZoom: 19, maxBounds: [[22.05, 113.75], [22.65, 114.55]], attributionControl: true})
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
