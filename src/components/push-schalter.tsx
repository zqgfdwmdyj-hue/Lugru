"use client";

import { useEffect, useState } from "react";
import { abonnieren, pushMoeglich } from "@/lib/push/client";

// Push-Meldungen auf diesem Gerät ein-/ausschalten (installierte App bzw. Browser mit Service Worker).

export function PushSchalter({ text = "Push auf diesem Gerät", onAenderung }: { text?: string; onAenderung?: (an: boolean) => void }) {
  const [stand, setStand] = useState<"pruefen" | "geht_nicht" | "aus" | "an" | "blockiert">("pruefen");
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (!pushMoeglich()) return setStand("geht_nicht");
    if (Notification.permission === "denied") return setStand("blockiert");
    navigator.serviceWorker.ready
      .then((r) => r.pushManager.getSubscription())
      .then((s) => setStand(s ? "an" : "aus"))
      .catch(() => setStand("geht_nicht"));
  }, []);

  async function einschalten() {
    setFehler(null);
    try {
      await abonnieren();
      setStand("an");
      onAenderung?.(true);
    } catch (e) {
      if (Notification.permission === "denied") setStand("blockiert");
      setFehler(e instanceof Error ? e.message : String(e));
    }
  }

  async function ausschalten() {
    const reg = await navigator.serviceWorker.ready;
    const abo = await reg.pushManager.getSubscription();
    if (abo) {
      await fetch("/api/push/abo", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: abo.endpoint }) });
      await abo.unsubscribe();
    }
    setStand("aus");
    onAenderung?.(false);
  }

  if (stand === "pruefen") return null;
  return (
    <span className="small" data-testid="push-schalter" data-stand={stand}>
      {stand === "geht_nicht" && <span className="muted">{text}: hier nicht möglich (als App installieren bzw. iPhone ab iOS 16.4 über „Zum Home-Bildschirm“).</span>}
      {stand === "blockiert" && <span className="muted">{text}: im Browser blockiert – in den Website-Einstellungen erlauben.</span>}
      {stand === "aus" && (
        <button className="btn btn-sm" type="button" onClick={einschalten}>
          🔔 {text} einschalten
        </button>
      )}
      {stand === "an" && (
        <button className="btn btn-sm" type="button" onClick={ausschalten}>
          🔕 {text} ausschalten
        </button>
      )}
      {fehler && <span className="tag tag-critical" style={{ marginLeft: 6 }}>{fehler}</span>}
    </span>
  );
}
