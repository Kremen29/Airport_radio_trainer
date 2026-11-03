/* Caches the page shell and the airport diagram. Scoring and transcription stay on the network. */
const CACHE = "lkpr-trainer-v2";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/static/css/app.css",
  "/static/js/app.js",
  "/static/js/map.js",
  "/static/js/radio.js",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
  "/static/icons/icon-512-maskable.png",
  "/static/icons/apple-touch-icon.png",
  "/static/icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

function cacheable(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname === "/" ||
      url.pathname === "/manifest.webmanifest" ||
      url.pathname === "/api/airport" ||
      url.pathname.startsWith("/static/"))
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!cacheable(url)) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Promise.reject(new Error("offline"))))
  );
});
