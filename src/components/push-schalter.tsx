"use client";

import { useEffect, useState } from "react";

// Push-Meldungen auf diesem Gerät ein-/ausschalten (installierte App bzw. Browser mit Service Worker).

const zuBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export function PushSchalter({ text = "Push auf diesem Gerät" }: { text?: string }) {
  const [stand, setStand] = useState<"pruefen" | "geht_nicht" | "aus" | "an" | "blockiert">("pruefen");
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setStand("geht_nicht");
    if (Notification.permission === "denied") return setStand("blockiert");
    navigator.serviceWorker.ready
      .then((r) => r.pushManager.getSubscription())
      .then((s) => setStand(s ? "an" : "aus"))
      .catch(() => setStand("geht_nicht"));
  }, []);

  async function einschalten() {
    setFehler(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") return setStand("blockiert");
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = (await (await fetch("/api/push/abo")).json()) as { publicKey: string };
      const abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: zuBytes(publicKey) });
      const r = await fetch("/api/push/abo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: abo.endpoint, geraet: navigator.userAgent.slice(0, 120) }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Speichern fehlgeschlagen");
      setStand("an");
    } catch (e) {
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
