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

registerTester("discord_profitpath", async (v, tenantId) => {
  const ids = (v.kanalIds ?? "").split(/[\s,;]+/).filter((x) => /^\d{15,25}$/.test(x));
  if (!ids.length) throw new Error("Mindestens eine Kanal-ID (nur Ziffern) eintragen.");
  let token = v.botToken;
  if (!token) token = ((await getIntegration(tenantId, "discord_va")) as { botToken?: string } | null)?.botToken ?? "";
  if (!token) throw new Error("Bot-Token eintragen oder zuerst „Discord – VA-Kanal“ einrichten (derselbe Bot).");
  const base = (process.env.DISCORD_API_BASE_URL || "https://discord.com/api/v10").replace(/\/$/, "");
  const zeilen: string[] = [];
  const { letzteProfitPathNachricht } = await import("@/lib/deal-eingang/profitpath");
  const botId = /^\d{15,25}$/.test(v.ppBotId ?? "") ? v.ppBotId : null;
  for (const id of ids) {
    const r = await fetch(`${base}/channels/${id}`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Kanal ${id}: Discord hat abgelehnt (${r.status}) – ist der Bot im Server und darf den Kanal sehen („View Channel“)?`);
    zeilen.push(await letzteProfitPathNachricht(token, id, botId));
  }
  return `Verbunden – letzte ProfitPath-Nachricht je Kanal: ${zeilen.join(" | ")}`;
});

/**
 * Discord – Gruppen-Kanäle (Wissen): Bot-Token (eigener oder der VA-Bot), jeder eingetragene Kanal sichtbar
 * („View Channel“), Verlauf lesbar („Read Message History“), richtiger Server; leerer Nachrichtentext → Hinweis auf
 * „Message Content Intent“. Liest nur, schreibt nichts.
 */
registerTester("discord_wissen", async (v, tenantId) => {
  const { kanaeleAus } = await import("@/lib/discord-wissen/logic");
  const kanaele = kanaeleAus(String(v.kanaele ?? ""));
  if (!kanaele.length)
    throw new Error("Noch kein Kanal eingetragen – je Zeile „Kanal-ID | Name | täglich“ (Kanal-ID: in Discord Einstellungen → Erweitert → Entwicklermodus an, dann Rechtsklick auf den Kanal → „Kanal-ID kopieren“).");
  let token = v.botToken;
  if (!token) token = ((await getIntegration(tenantId, "discord_va")) as { botToken?: string } | null)?.botToken ?? "";
  if (!token) throw new Error("Kein Bot-Token: hier eintragen oder zuerst „Discord – VA-Kanal“ einrichten (derselbe Bot). Noch kein Bot? discord.com/developers → New Application → Bot → Token kopieren; dort „Message Content Intent“ einschalten.");
  const base = (process.env.DISCORD_API_BASE_URL || "https://discord.com/api/v10").replace(/\/$/, "");
  const h = { Authorization: `Bot ${token}` };
  const me = await fetch(`${base}/users/@me`, { headers: h, signal: AbortSignal.timeout(15_000) });
  if (me.status === 401) throw new Error("Discord kennt das Bot-Token nicht (401) – Token im Entwicklerportal neu kopieren.");
  const zeilen: string[] = [];
  const probleme: string[] = [];
  for (const k of kanaele.slice(0, 20)) {
    const r = await fetch(`${base}/channels/${k.id}`, { headers: h, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) {
      probleme.push(`${k.name}: ${r.status === 404 || r.status === 403 ? "nicht sichtbar – ist der Bot im Server und darf den Kanal sehen („View Channel“)? Kanal-ID prüfen." : `Discord meldet ${r.status}.`}`);
      continue;
    }
    const info = (await r.json()) as { name?: string; guild_id?: string };
    if (v.serverId && info.guild_id && info.guild_id !== v.serverId.trim()) {
      probleme.push(`${k.name}: gehört zu einem anderen Server als der eingetragenen Server-ID.`);
      continue;
    }
    const m = await fetch(`${base}/channels/${k.id}/messages?limit=5`, { headers: h, signal: AbortSignal.timeout(15_000) });
    if (!m.ok) {
      probleme.push(`#${info.name ?? k.name}: sichtbar, aber der Verlauf ist gesperrt – Recht „Read Message History“ fehlt.`);
      continue;
    }
    const liste = (await m.json()) as { content?: string; author?: { bot?: boolean }; attachments?: unknown[]; embeds?: unknown[] }[];
    const ohneText = liste.filter((x) => !x.author?.bot && !x.content && !(x.attachments?.length || x.embeds?.length)).length;
    zeilen.push(`#${info.name ?? k.name} lesbar (${liste.length ? `${liste.length} letzte Nachrichten` : "noch keine Nachrichten"})`);
    if (liste.length && ohneText === liste.filter((x) => !x.author?.bot).length && ohneText > 0) probleme.push(`#${info.name ?? k.name}: Nachrichten ohne Text – im Entwicklerportal beim Bot „Message Content Intent“ einschalten.`);
  }
  if (probleme.length && !zeilen.length) throw new Error(probleme.join(" · "));
  return `${zeilen.join(" · ")}${probleme.length ? ` – Achtung: ${probleme.join(" · ")}` : ""}`;
});
