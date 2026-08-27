// Service Worker — ALANE
// Push notifications + cache strategy
/* global clients */

const CACHE_NAME = "alane-v4";
const STATIC_ASSETS = [
  "/manifest.json",
  "/favicon.svg",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

// ── Install : pré-cache les assets statiques critiques ────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate : nettoie les anciens caches ─────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch : stale-while-revalidate pour assets Vite, network-first pour API ───
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ne rien intercepter hors de notre origine : les extensions de navigateur
  // émettent des requêtes chrome-extension:// et cross-origin que Cache.put
  // refuse, ce qui polluait la console d'erreurs sans rapport avec l'app.
  if (url.origin !== self.location.origin || !url.protocol.startsWith("http")) {
    return;
  }

  // Ne pas intercepter les requêtes API Supabase/Stripe/Resend, ni le fichier
  // d'estampille : c'est lui qui dit si une nouvelle version est déployée. Servi
  // depuis le cache, il répondrait éternellement l'ancienne valeur et la
  // détection de mise à jour ne se déclencherait jamais.
  if (
    url.pathname === "/version.json" ||
    url.pathname.startsWith("/api/") ||
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("stripe.com") ||
    url.hostname.includes("resend.com") ||
    request.method !== "GET"
  ) {
    return; // Laisser le navigateur gérer nativement
  }

  // Assets Vite (hashed) → cache-first (immutables)
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
      )
    );
    return;
  }

  // Shell HTML → network-first pour toujours servir la dernière version Vite
  // (stale-while-revalidate causait des crashs : vieux index.html + nouveaux hashes JS absents)
  if (url.pathname === "/" || url.pathname.endsWith(".html")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Autres assets statiques (manifest, icons) → stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    )
  );
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || "ALANE", {
      body: data.body || "",
      icon: "/icon-512.png",
      badge: "/favicon.svg",
      tag: data.tag || "alane-notif",
      renotify: true,
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const url = event.notification.data?.url || "/";
      for (const client of list) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.postMessage({ type: "NOTIFICATION_CLICK", url });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
