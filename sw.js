// 港途 service worker：快取 app 外殼（網絡優先），實時到站一律唔快取
const SHELL = 'hkgo-shell-v7';
const FILES = ['./', './index.html', './css/app.css', './js/app.js', './js/core.js', './js/eta.js', './js/ui.js', './js/map.js',
  './js/nearby.js', './js/route.js', './js/plan.js', './js/trip.js', './js/saved.js', './js/news.js',
  './manifest.json', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('hkgo-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const leaflet = u.hostname === 'cdnjs.cloudflare.com' && u.pathname.includes('/leaflet/');
  if (u.origin !== location.origin && !leaflet) return;
  const req = e.request.mode === 'navigate' ? fetch(e.request.url, {cache: 'no-cache'}) : fetch(e.request, {cache: 'no-cache'});
  e.respondWith(req.then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: 'window'}).then(cs => cs[0] ? cs[0].focus() : self.clients.openWindow('./')));
});
