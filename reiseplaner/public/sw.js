// Offline-Unterstützung (auf See ist das Netz oft schwach): App-Dateien und Leaflet werden
// zwischengespeichert, Kartenkacheln beim Ansehen. Daten (api/) gehen immer ans Netz –
// die App hält ungespeicherte Änderungen selbst im Browser.
const APP = "reiseplaner-app-v17";
const KACHELN = "reiseplaner-kacheln-v1";
const DATEIEN = ["/", "/index.html", "/app.js", "/kern.js", "/konto.js", "/hotels.js", "/erlebnisse.js", "/teilen.js", "/ki.js", "/rechnen.js", "/zusammenfuehren.js", "/reiseplan-text.js", "/weltkarte.js", "/vorbereitung.js", "/unterwegs.js", "/unterwegs-logik.js", "/zip.js", "/kinder.js", "/flug.js", "/kinderbasis.js", "/kinderextra.js", "/tiere.js", "/tierbilder.js", "/kinderdaten.js", "/reisebuch.js", "/style.css", "/icon.svg", "/manifest.webmanifest",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== APP && k !== KACHELN).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/teilen/") || url.pathname.startsWith("/tagebuch")) return;

  // Kartenkacheln (OpenStreetMap oder eigener Kartendienst): erst Zwischenspeicher, dann Netz
  const istKachel = url.hostname === "tile.openstreetmap.org" || url.hostname.endsWith(".tile.openstreetmap.org") || (url.origin !== location.origin && /\/\d+\/\d+\/\d+(@2x)?\.(png|jpe?g|webp)$/.test(url.pathname));
  if (istKachel) {
    e.respondWith(
      caches.open(KACHELN).then(async (c) => {
        const treffer = await c.match(e.request);
        if (treffer) return treffer;
        const antwort = await fetch(e.request);
        if (antwort.ok) {
          await c.put(e.request, antwort.clone());
          c.keys().then((k) => k.length > 6000 && Promise.all(k.slice(0, 500).map((x) => c.delete(x))));
        }
        return antwort;
      }),
    );
    return;
  }

  if (url.origin === location.origin || url.hostname === "unpkg.com") {
    // Erst Netz (damit Updates sofort da sind), sonst Zwischenspeicher.
    e.respondWith(
      fetch(e.request)
        .then((antwort) => {
          if (antwort.ok) {
            const kopie = antwort.clone();
            caches.open(APP).then((c) => c.put(e.request, kopie));
          }
          return antwort;
        })
        .catch(() => caches.match(e.request).then((t) => t ?? caches.match("/index.html"))),
    );
  }
});
