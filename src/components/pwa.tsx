"use client";

import { useEffect } from "react";

/** Service Worker anmelden (nur über https bzw. localhost) – macht das System installierbar. */
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return null;
}
