"use client";

import { useEffect, useState } from "react";

/** Hinweis für iPhone/iPad in Safari: so wird das Tool als App auf den Home-Bildschirm gelegt. */
export function InstallHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
      setShow(ios && !installed && localStorage.getItem("install-hint") !== "aus");
    } catch {}
  }, []);
  if (!show) return null;
  return (
    <div className="notice notice-info" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span style={{ flex: 1 }}>
        <strong>Als App aufs iPhone:</strong> unten in Safari auf <strong>Teilen</strong> (Quadrat mit Pfeil) tippen, dann <strong>„Zum Home-Bildschirm“</strong>. Danach startet das Spenden-Tool wie eine App – ohne Browserleiste.
      </span>
      <button className="btn-link small" type="button" onClick={() => { try { localStorage.setItem("install-hint", "aus"); } catch {} setShow(false); }}>Ausblenden</button>
    </div>
  );
}
