const CACHE = "etf-trend-live-v2-20260831";
const STATIC = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.pathname.endsWith("/data/signals.json") || url.pathname.endsWith("data/signals.json")) {
    event.respondWith(
      fetch(event.request, {cache:"no-store"})
        .then(res => {
          const copy=res.clone();
          caches.open(CACHE).then(c=>c.put(event.request,copy));
          return res;
        })
        .catch(()=>caches.match(event.request))
    );
    return;
  }
  event.respondWith(caches.match(event.request).then(r=>r||fetch(event.request)));
});
