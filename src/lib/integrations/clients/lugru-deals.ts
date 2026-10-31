import "server-only";
import { registerTester } from "../test";
import { getIntegration } from "../store";
import { ebayAppTokenFuer } from "@/lib/lugru-deals/ebay-token";
import { MIN_SCHLUESSEL } from "@/lib/lugru-deals/schluessel";
import { lugruPostLesen } from "@/lib/lugru-deals/post-logic";

// Test der Anbindung „Lugru Deals“: Deal-Kanäle lesbar (letzter erkannter Deal je Kanal) und – falls ein
// Verbindungsschlüssel hinterlegt ist – das eBay-Token für Lugru Deals.
registerTester("lugru_deals", async (v, tenantId) => {
  const teile: string[] = [];
  const ids = (v.kanalIds ?? "").split(/[\s,;]+/).filter((x) => /^\d{15,25}$/.test(x));
  if (!ids.length && !v.schluessel) throw new Error("Die IDs der Deal-Kanäle eintragen (oder für das eBay-Token einen Verbindungsschlüssel).");
  if (ids.length) {
    const token = v.botToken || ((await getIntegration(tenantId, "discord_wissen")) as { botToken?: string } | null)?.botToken || ((await getIntegration(tenantId, "discord_va")) as { botToken?: string } | null)?.botToken;
    if (!token) throw new Error("Bot-Token eintragen oder zuerst „Discord-Kanäle der Deal-Gruppe“ bzw. „VA-Kanal“ einrichten (derselbe Bot).");
    const base = (process.env.DISCORD_API_BASE_URL || "https://discord.com/api/v10").replace(/\/$/, "");
    for (const id of ids) {
      const k = await fetch(`${base}/channels/${id}`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(15_000) });
      if (!k.ok) throw new Error(`Kanal ${id}: Discord hat abgelehnt (${k.status}) – ist der Bot im Server und darf den Kanal sehen („View Channel“)?`);
      const info = (await k.json()) as { name?: string };
      const r = await fetch(`${base}/channels/${id}/messages?limit=50`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`#${info.name ?? id}: Verlauf nicht lesbar (${r.status}) – Recht „Read Message History“ prüfen.`);
      const liste = (await r.json()) as { content?: string }[];
      const d = liste.map((m) => lugruPostLesen(m.content ?? "")).find((p) => p?.asin);
      if (!d) teile.push(liste.some((m) => m.content) ? `#${info.name ?? id}: kein Deal unter den letzten 50 Nachrichten erkannt` : `#${info.name ?? id}: Nachrichten ohne Text – ist „Message Content Intent“ eingeschaltet?`);
      else teile.push(`#${info.name ?? id}: ${d.titel.slice(0, 60)} · ASIN ${d.asin} · EK ${d.ekEur ?? "–"} € · Gewinn ${d.gewinnEur} €`);
    }
  }
  if (v.schluessel) {
    if (v.schluessel.length < MIN_SCHLUESSEL) throw new Error(`Der Verbindungsschlüssel braucht mindestens ${MIN_SCHLUESSEL} Zeichen.`);
    const eb = await ebayAppTokenFuer(tenantId).then((x) => `eBay-Token erhalten (${x.env === "production" ? "Produktion" : "Sandbox"})`).catch((e) => `eBay-Token nicht möglich: ${e instanceof Error ? e.message : String(e)}`);
    teile.push(eb);
  }
  return `Verbunden – ${teile.join(" | ")}`;
});
