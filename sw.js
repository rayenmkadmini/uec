// UEC21 service worker: makes the site installable and gives a minimal offline fallback.
// Network first for every same-origin GET (so a deploy is always picked up); the cache is
// only used when the network fails. Supabase and other origins are never touched.
const CACHE = "uec21-v2";
const SHELL = ["index.html", "css/style.css", "js/splash.js", "js/install.js", "assets/uec-logo-192.webp", "assets/app-icon-192.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request)
    .then(response => {
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => caches.match(request).then(hit => hit || (request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
