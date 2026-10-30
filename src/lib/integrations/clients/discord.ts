import "server-only";
import { getIntegration } from "../store";
import { registerTester } from "../test";

// Meldungen an einen Discord-Kanal über einen Webhook (z. B. Kanal „todo“).

export async function postDiscord(webhookUrl: string, content: string) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Discord erlaubt höchstens 2000 Zeichen je Nachricht.
    body: JSON.stringify({ content: content.slice(0, 1990), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Discord hat abgelehnt (${res.status}) – Webhook-Adresse prüfen.`);
}

/** Meldung senden, wenn ein Discord-Webhook eingerichtet ist; Fehler nur protokollieren. */
export async function notifyDiscord(tenantId: string, content: string): Promise<boolean> {
  const cfg = await getIntegration(tenantId, "discord");
  if (!cfg?.webhookUrl) return false;
  try {
    await postDiscord(cfg.webhookUrl, content);
    return true;
  } catch (e) {
    console.error("[Discord]", e instanceof Error ? e.message : e);
    return false;
  }
}

registerTester("discord", async (v) => {
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(v.webhookUrl ?? "")) throw new Error("Bitte die Webhook-URL aus Discord einfügen (https://discord.com/api/webhooks/…).");
  await postDiscord(v.webhookUrl, "✅ Seller-System ist verbunden – hier erscheinen neue Amazon-ToDos mit hoher Priorität.");
  return "Testnachricht gesendet – bitte im Discord-Kanal nachsehen.";
});

registerTester("discord_calls", async (v) => {
  if (!v.botToken || !/^\d{15,25}$/.test(v.kanalId ?? "")) throw new Error("Bot-Token und Kanal-ID (nur Ziffern) eintragen.");
  const base = (process.env.DISCORD_API_BASE_URL || "https://discord.com/api/v10").replace(/\/$/, "");
  const r = await fetch(`${base}/channels/${v.kanalId}`, { headers: { Authorization: `Bot ${v.botToken}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Discord hat abgelehnt (${r.status}) – Token oder Kanal-ID prüfen, Bot muss im Server sein.`);
  const k = (await r.json()) as { name?: string };
  return `Verbunden – Kanal „${k.name ?? v.kanalId}“ ist lesbar.`;
});

registerTester("discord_va", async (v, tenantId) => {
  if (!v.botToken || !/^\d{15,25}$/.test(v.kanalId ?? "") || !/^\d{15,25}$/.test(v.vaDiscordId ?? "")) throw new Error("Bot-Token, VA-Kanal-ID und Discord-Nutzer-ID der VA (nur Ziffern) eintragen.");
  const base = (process.env.DISCORD_API_BASE_URL || "https://discord.com/api/v10").replace(/\/$/, "");
  const r = await fetch(`${base}/channels/${v.kanalId}`, { headers: { Authorization: `Bot ${v.botToken}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Discord hat abgelehnt (${r.status}) – Token oder Kanal-ID prüfen, Bot muss im Server sein.`);
  const k = (await r.json()) as { name?: string; guild_id?: string };
  if (v.serverId && k.guild_id && k.guild_id !== v.serverId) throw new Error("Der Kanal gehört zu einem anderen Server als der eingetragenen Server-ID.");
  let konto = "";
  if (v.vaEmail) {
    const { vaSession } = await import("@/lib/va/service");
    const s = await vaSession(tenantId, { botToken: v.botToken, kanalId: v.kanalId, vaDiscordId: v.vaDiscordId, vaEmail: v.vaEmail });
    if (!s) throw new Error(`Kein Konto „${v.vaEmail}“ in diesem Seller-System – erst unter Einstellungen → Team anlegen.`);
    konto = ` Konto der VA: ${s.name || s.email}.`;
  }
  return `Verbunden – Kanal „${k.name ?? v.kanalId}“ ist lesbar.${konto}`;
});
