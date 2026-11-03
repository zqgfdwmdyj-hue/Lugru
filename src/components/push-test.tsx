"use client";

import { useState } from "react";
import { aktuellesAbo } from "@/lib/push/client";

// Prüfseite: „Test-Push an dieses Gerät“ – sendet nur an das Abo dieses Geräts und zeigt die Zustellzeit (= wann der
// Service Worker die Meldung abgeholt hat). Zum Prüfen bei geschlossener App: Knopf tippen, App schließen, warten.

export function PushTest() {
  const [stand, setStand] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function testen() {
    setLaeuft(true);
    setStand("Sende …");
    try {
      const abo = await aktuellesAbo();
      if (!abo) {
        setStand("Dieses Gerät hat noch kein Push – oben einschalten.");
        return;
      }
      const r = (await (await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: abo.endpoint }) })).json()) as { ok: boolean; id: string | null; fehler?: string };
      if (!r.ok || !r.id) {
        setStand(r.fehler ?? "Push fehlgeschlagen.");
        return;
      }
      setStand("Gesendet – warte auf Zustellung …");
      const t0 = Date.now();
      while (Date.now() - t0 < 120_000) {
        await new Promise((ok) => setTimeout(ok, 1500));
        const m = (await (await fetch(`/api/push/test?id=${r.id}`, { cache: "no-store" })).json()) as { zugestelltAm?: string | null; sekunden?: number | null };
        if (m.zugestelltAm) {
          const uhr = new Date(m.zugestelltAm).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          setStand(`✅ Zugestellt um ${uhr} (nach ${String(m.sekunden ?? 0).replace(".", ",")} s).`);
          return;
        }
      }
      setStand("Gesendet, aber nach 2 Minuten nicht abgeholt – Mitteilungen für die App in den iPhone-Einstellungen prüfen (Fokus/Nicht stören).");
    } catch (e) {
      setStand(e instanceof Error ? e.message : String(e));
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <button className="btn btn-primary" type="button" onClick={testen} disabled={laeuft} data-testid="push-test">
        Test-Push an dieses Gerät
      </button>
      {stand && (
        <span className="small" data-testid="push-test-stand">
          {stand}
        </span>
      )}
    </div>
  );
}
