// Seller-System als App: keine Daten zwischenspeichern (immer aktuell, nichts Vertrauliches im Cache) –
// nur ein Hinweis, wenn keine Verbindung besteht.
const OFFLINE = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f3ef;color:#1d2125;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center;padding:24px}
button{margin-top:16px;padding:10px 18px;border-radius:8px;border:0;background:#0e6b5f;color:#fff;font-size:15px}</style></head>
<body><div><div style="margin:0 auto 16px;width:56px"><svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 512 512"><defs><linearGradient id="of-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#17a085"/><stop offset="1" stop-color="#0a4a42"/></linearGradient><linearGradient id="of-ar" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#ffc24a"/><stop offset="1" stop-color="#ff8a1f"/></linearGradient></defs><rect width="512" height="512" rx="116" fill="url(#of-bg)"/><circle cx="110" cy="80" r="200" fill="#ffffff" opacity="0.07"/><g transform="translate(0.0 0.0) scale(1)"><polygon points="256,206 386,280 256,354 126,280" fill="#ffffff"/><polygon points="126,280 256,354 256,484 126,410" fill="#dff1ec"/><polygon points="256,354 386,280 386,410 256,484" fill="#b2dbd1"/><polygon points="178,250 308,324 334,309 204,235" fill="#0e6b5f" opacity="0.22"/><polygon points="308,324 334,309 334,380 308,395" fill="#0e6b5f" opacity="0.30"/><polyline points="112,196 200,126 262,170 362,84" fill="none" stroke="#06352f" stroke-opacity="0.30" stroke-width="42" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 10)"/><polyline points="112,196 200,126 262,170 362,84" fill="none" stroke="url(#of-ar)" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"/><polygon points="414,36 400,146 302,78" fill="url(#of-ar)" stroke="url(#of-ar)" stroke-width="12" stroke-linejoin="round"/></g></svg></div><h1 style="font-size:20px">Keine Verbindung</h1><p>Das Seller-System braucht Internet. Bitte Verbindung prüfen.</p><button onclick="location.reload()">Erneut versuchen</button></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});

// Push ohne Inhalt: Meldung beim Seller-System abholen (mit Anmeldung) und anzeigen; Klick öffnet den Link.
self.addEventListener("push", (e) => {
  e.waitUntil(
    fetch("/api/push/neueste", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .catch(() => ({ titel: "Seller-System", text: "Neue Meldung – bitte öffnen.", link: "/" }))
      .then((m) => {
        // Knöpfe (z. B. „Zum Angebot“, „Gekauft …“) – je Knopf ein eigener Link.
        const aktionen = Array.isArray(m.aktionen) ? m.aktionen.slice(0, 2) : [];
        const links = {};
        for (const a of aktionen) links[a.aktion] = a.link;
        return self.registration.showNotification(m.titel || "Seller-System", { body: m.text || "", tag: m.id || "meldung", data: { link: m.link || "/", links }, actions: aktionen.map((a) => ({ action: a.aktion, title: a.titel })), icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" });
      }),
  );
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const link = (e.action && d.links && d.links[e.action]) || d.link || "/";
  // Externe Links (Shop) im neuen Fenster, eigene Seiten im offenen Seller-System.
  if (/^https?:\/\//.test(link) && !link.startsWith(self.location.origin)) {
    e.waitUntil(self.clients.openWindow(link));
    return;
  }
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      for (const c of cs) if ("focus" in c) return c.navigate(link).then((w) => (w || c).focus());
      return self.clients.openWindow(link);
    }),
  );
});
