// Seller-System als App: keine Daten zwischenspeichern (immer aktuell, nichts Vertrauliches im Cache) –
// nur ein Hinweis, wenn keine Verbindung besteht.
const OFFLINE = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f3ef;color:#1d2125;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center;padding:24px}
.b{width:56px;height:56px;border-radius:14px;background:#0e6b5f;color:#fff;font:700 30px Arial;display:flex;align-items:center;justify-content:center;margin:0 auto 16px}button{margin-top:16px;padding:10px 18px;border-radius:8px;border:0;background:#0e6b5f;color:#fff;font-size:15px}</style></head>
<body><div><div class="b">S</div><h1 style="font-size:20px">Keine Verbindung</h1><p>Das Seller-System braucht Internet. Bitte Verbindung prüfen.</p><button onclick="location.reload()">Erneut versuchen</button></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
