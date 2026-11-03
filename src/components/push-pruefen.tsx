"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { abonnieren, aboStand, aktuellesAbo, alsApp, pushMoeglich } from "@/lib/push/client";

// Beim Öffnen der App: Push-Abo prüfen. Erlaubnis da, aber Abo fehlt/abgelaufen → still neu anfordern (geht das nicht,
// Hinweis mit Knopf). Als App am iPhone geöffnet und noch nie gefragt → Hinweis „Push erlauben“ (iOS fragt nur nach
// einem Tipp). „Später“ merkt sich das Gerät 7 Tage.

const SPAETER = "push-hinweis-spaeter";

export function PushPruefen() {
  const [hinweis, setHinweis] = useState<null | "erlauben" | "neu">(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (!pushMoeglich()) return;
    let spaeter = 0;
    try {
      spaeter = Number(localStorage.getItem(SPAETER) ?? 0);
    } catch {
      /* ohne Speicher: jedes Mal fragen */
    }
    const zeigen = (h: "erlauben" | "neu") => Date.now() - spaeter > 7 * 86_400_000 && setHinweis(h);
    (async () => {
      if (Notification.permission === "denied") return;
      if (Notification.permission === "default") return alsApp() ? zeigen("erlauben") : undefined;
      const abo = await aktuellesAbo();
      const stand = abo ? await aboStand(abo.endpoint) : "unbekannt";
      if (stand === "ok") return;
      try {
        await abonnieren({ neu: stand === "abgelaufen" });
      } catch {
        zeigen("neu");
      }
    })().catch(() => undefined);
  }, []);

  if (!hinweis) return null;
  async function los() {
    setFehler(null);
    try {
      await abonnieren({ neu: hinweis === "neu" });
      setHinweis(null);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    }
  }
  function spaeter() {
    try {
      localStorage.setItem(SPAETER, String(Date.now()));
    } catch {
      /* egal */
    }
    setHinweis(null);
  }
  return (
    <div className="notice notice-info" data-testid="push-hinweis" data-art={hinweis} style={{ margin: "8px 0", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <span className="small" style={{ flex: 1, minWidth: 200 }}>
        {hinweis === "erlauben" ? "🔔 Wichtige Meldungen (Deals, Amazon kritisch, Fristen) direkt aufs Handy – auch ohne Discord." : "🔔 Push auf diesem Gerät ist abgelaufen – bitte neu einrichten."}{" "}
        <Link href="/einstellungen/benachrichtigungen">Einstellungen</Link>
      </span>
      <button className="btn btn-sm btn-primary" type="button" onClick={los} data-testid="push-hinweis-los">
        {hinweis === "erlauben" ? "Push erlauben" : "Neu einrichten"}
      </button>
      <button className="btn btn-sm" type="button" onClick={spaeter}>
        Später
      </button>
      {fehler && <span className="tag tag-critical">{fehler}</span>}
    </div>
  );
}
