// Service worker minimale: network-first con fallback sulla cache (l'app si apre anche offline)
const C = 'hub-finanza-v1';
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c => c.addAll(['./', 'index.html', 'manifest.webmanifest']).catch(() => {})));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).hostname.includes('supabase')) return; // mai in cache le API
  e.respondWith(
    fetch(r).then(res => { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)).catch(() => {}); return res; })
      .catch(() => caches.match(r))
  );
});
