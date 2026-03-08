const CACHE_VERSION = "bookjournal-v2";
const STATIC_CACHE = `static-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

async function refreshAppShellCache() {
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(
    APP_SHELL.map(async (path) => {
      const request = new Request(path, { cache: "no-store" });
      const response = await fetch(request);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${path}`);
      }
      await cache.put(path, response.clone());
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(refreshAppShellCache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put("./index.html", clone);
          });
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put(event.request, clone);
          });
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data && event.data.type === "REFRESH_APP_SHELL") {
    const port = event.ports && event.ports[0];
    event.waitUntil(
      refreshAppShellCache()
        .then(() => {
          if (port) {
            port.postMessage({ ok: true });
          }
        })
        .catch((error) => {
          if (port) {
            port.postMessage({ ok: false, message: String(error) });
          }
        })
    );
  }
});
