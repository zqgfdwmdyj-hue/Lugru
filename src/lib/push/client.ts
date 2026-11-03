"use client";

// Push im Browser/in der installierten App: Abo anlegen und beim Seller-System speichern (geteilt von Schalter,
// Abo-Prüfung beim Öffnen und Prüfseite).

const zuBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export const pushMoeglich = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Als App vom Home-Bildschirm geöffnet (iPhone: nur dort gibt es Web Push)? */
export const alsApp = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

/** Gerätename fürs Protokoll (kurz, ohne Versionsnummern-Wust). */
export function geraetName(): string {
  const ua = navigator.userAgent;
  const geraet = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Gerät";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) && !/Edg\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${geraet} · ${alsApp() ? "App" : browser}`;
}

export async function aktuellesAbo(): Promise<PushSubscription | null> {
  if (!pushMoeglich()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Abo anlegen (ggf. altes ersetzen) und speichern. Erlaubnis muss vorher erteilt sein (bzw. wird hier erfragt). */
export async function abonnieren(o: { neu?: boolean } = {}): Promise<PushSubscription> {
  if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") throw new Error("Benachrichtigungen nicht erlaubt.");
  const reg = await navigator.serviceWorker.ready;
  let abo = await reg.pushManager.getSubscription();
  if (abo && o.neu) {
    await abo.unsubscribe().catch(() => false);
    abo = null;
  }
  if (!abo) {
    const { publicKey } = (await (await fetch("/api/push/abo", { cache: "no-store" })).json()) as { publicKey: string };
    abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: zuBytes(publicKey) });
  }
  const r = await fetch("/api/push/abo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: abo.endpoint, geraet: geraetName() }) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Speichern fehlgeschlagen");
  return abo;
}

/** Stand des Abos dieses Geräts beim Seller-System. */
export async function aboStand(endpoint: string): Promise<"ok" | "abgelaufen" | "unbekannt"> {
  const r = await fetch(`/api/push/abo?endpoint=${encodeURIComponent(endpoint)}`, { cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as { stand?: "ok" | "abgelaufen" | "unbekannt" };
  return j.stand ?? "unbekannt";
}
