"use client";

import { useEffect } from "react";

/** Service Worker anmelden (nur über https bzw. localhost) – macht das System installierbar. */
export function PwaRegister() {
  useEffect(() => {
    // Öffentliche Kunden-Links und die Claude-Freigabe (Login mit „weiter“) nicht als App installieren –
    // unter der öffentlichen Claude-Adresse ist /sw.js ohnehin nicht freigegeben.
    if (location.pathname.startsWith("/sendung/") || location.pathname.startsWith("/oauth/")) return;
    if (location.pathname === "/login" && new URLSearchParams(location.search).has("weiter")) return;
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return null;
}
