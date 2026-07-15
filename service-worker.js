const CACHE_VERSION = "facescore-saas-lux-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Keep installation lightweight. The 10+ MB MediaPipe runtime is cached only
// when the user actually starts the camera, preventing duplicate first-load
// downloads and mobile memory pressure.
const SHELL_FILES = [
  "./",
  "./index.html",
  "./app.html",
  "./pricing.html",
  "./privacy.html",
  "./terms.html",
  "./refund.html",
  "./success.html",
  "./404.html",
  "./styles.css",
  "./config.js",
  "./shared.js",
  "./bndr-report.js",
  "./landing.js",
  "./legal.js",
  "./sw-register.js",
  "./vision-runtime.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./vendor/face_mesh.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("facescore-saas-") &&
                !key.includes(CACHE_VERSION),
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isDocumentRequest(request) {
  return request.mode === "navigate" || request.destination === "document";
}

function isRuntimeAsset(url) {
  return (
    url.pathname.includes("/vendor/") && !url.pathname.endsWith("face_mesh.js")
  );
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (isDocumentRequest(request)) {
      return (await cache.match("./index.html")) || Response.error();
    }
    return Response.error();
  }
}

async function cacheRuntimeOnDemand(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isRuntimeAsset(url)) {
    event.respondWith(cacheRuntimeOnDemand(event.request));
    return;
  }

  // Network-first prevents a previous service worker from pinning stale app
  // logic after a production repair. Offline fallback remains available.
  event.respondWith(networkFirst(event.request));
});
