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
