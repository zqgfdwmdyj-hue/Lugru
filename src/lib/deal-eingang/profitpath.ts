import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getIntegration } from "@/lib/integrations/store";
import { discord } from "@/lib/va/discord";
import { modulAus, profitPathAngebot, type PpNachricht } from "./profitpath-logic";
import { eingangAnlegen, eingangPruefen } from "./service";

// ProfitPath über Discord: Der Bot des Seller-Systems liest die ProfitPath-Kanäle (je Modul/Alarmgruppe ein Kanal),
// jede Meldung wird gegengeprüft (echte Gebühren je Land, eigener Bestand, Kapital-Ampel, Amazon-Anteil, Liquidität).
// Push nur bei Grün/Gelb; gleiche ASIN innerhalb von 24 Std. wird zusammengefasst, ein neuer EK gilt als Update.

const E = schema.dealEingaenge;
const K = schema.dealEingangKanaele;

type PpCfg = { botToken?: string; kanalIds?: string; serverId?: string; ppBotId?: string };

export async function profitPathKonfig(tenantId: string): Promise<{ token: string; kanaele: string[]; botId: string | null } | null> {
  const c = (await getIntegration(tenantId, "discord_profitpath")) as PpCfg | null;
  if (!c) return null;
  const token = c.botToken || ((await getIntegration(tenantId, "discord_va")) as { botToken?: string } | null)?.botToken;
  const kanaele = (c.kanalIds ?? "").split(/[\s,;]+/).filter((x) => /^\d{15,25}$/.test(x));
  if (!token || !kanaele.length) return null;
  return { token, kanaele: [...new Set(kanaele)].slice(0, 20), botId: /^\d{15,25}$/.test(c.ppBotId ?? "") ? c.ppBotId! : null };
}

let laeuft = new Set<string>();

/** Neue ProfitPath-Meldungen aller Kanäle verarbeiten. Erster Lauf je Kanal: nur merken, wo er steht. */
export async function profitPathAbgleich(tenantId: string, jetzt = new Date()): Promise<{ neu: number; updates: number; uebersprungen: number } | null> {
  if (laeuft.has(tenantId)) return null;
  const cfg = await profitPathKonfig(tenantId);
  if (!cfg) return null;
  laeuft.add(tenantId);
  const z = { neu: 0, updates: 0, uebersprungen: 0 };
  try {
    const dc = discord(cfg.token);
    for (const kanalId of cfg.kanaele) {
      let [k] = await db.select().from(K).where(and(eq(K.tenantId, tenantId), eq(K.kanalId, kanalId)));
      if (!k) {
        const info = await dc.kanal(kanalId).catch(() => null);
        const letzte = await dc.neue(kanalId, null).catch(() => []);
        const cursor = letzte.reduce((mx, m) => (BigInt(m.id) > BigInt(mx) ? m.id : mx), "0");
        [k] = await db.insert(K).values({ tenantId, kanalId, name: info?.name ?? kanalId, cursor }).onConflictDoNothing().returning();
        // Meldungen der letzten Stunde gleich mitnehmen (Anbindung frisch eingerichtet).
        for (const m of letzte.filter((x) => vomProfitPath(x, cfg.botId) && x.timestamp && jetzt.getTime() - Date.parse(x.timestamp) < 3600_000).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))) await meldung(tenantId, k?.name ?? kanalId, m, z, jetzt);
        continue;
      }
      const neu = await dc.neue(kanalId, k.cursor ?? "0");
      let cursor = k.cursor;
      for (const m of neu) {
        cursor = m.id;
        // Nur Meldungen des ProfitPath-Bots (bzw. ohne Bot-ID: von Bots); verpasste höchstens 24 Std. nachholen.
        if (!vomProfitPath(m, cfg.botId) || (m.timestamp && jetzt.getTime() - Date.parse(m.timestamp) > 24 * 3600_000)) {
          z.uebersprungen++;
          continue;
        }
        await meldung(tenantId, k.name ?? kanalId, m, z, jetzt).catch((e) => console.error("[ProfitPath]", e instanceof Error ? e.message : e));
      }
      if (cursor !== k.cursor) await db.update(K).set({ cursor }).where(eq(K.id, k.id));
    }
    return z;
  } finally {
    laeuft.delete(tenantId);
  }
}

/** Nachricht vom ProfitPath-Bot? Mit Bot-ID genau dieser Absender, sonst irgendein Bot (nie Menschen). */
export const vomProfitPath = (m: { author?: { id: string; bot?: boolean } }, botId: string | null) => (botId ? m.author?.id === botId : Boolean(m.author?.bot));

/** Test unter Anbindungen: letzte ProfitPath-Nachricht je Kanal lesen und zeigen, was erkannt wird. */
export async function letzteProfitPathNachricht(token: string, kanalId: string, botId: string | null): Promise<string> {
  const dc = discord(token);
  const k = await dc.kanal(kanalId);
  const r = await fetch(`${(process.env.DISCORD_API_BASE_URL || "https://discord.com/api/v10").replace(/\/$/, "")}/channels/${kanalId}/messages?limit=20`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`#${k.name ?? kanalId}: Verlauf nicht lesbar (${r.status}) – Recht „Read Message History“ prüfen.`);
  const liste = (await r.json()) as (PpNachricht & { author?: { id: string; bot?: boolean } })[];
  const m = liste.find((x) => vomProfitPath(x, botId));
  if (!m) return `#${k.name ?? kanalId}: noch keine Nachricht ${botId ? "des ProfitPath-Bots" : "eines Bots"} unter den letzten 20.`;
  const a = profitPathAngebot({ id: m.id, content: m.content, embeds: m.embeds });
  if (!a) return `#${k.name ?? kanalId}: letzte Nachricht gelesen, aber weder ASIN noch Einkaufspreis erkannt – ist „Message Content Intent“ eingeschaltet?`;
  return `#${k.name ?? kanalId}: ${a.angebot.name ?? "ohne Titel"} · ASIN ${a.angebot.asin ?? "unsicher"} · EK ${a.angebot.ek ?? "–"} € · VK ${a.vk ?? "–"} · ROI ${a.roi ?? "–"} %`;
}

export function _ppZuruecksetzen() {
  laeuft = new Set();
}

async function meldung(tenantId: string, kanalName: string, m: { id: string; content?: string; embeds?: Parameters<typeof profitPathAngebot>[0]["embeds"]; author?: { bot?: boolean } }, z: { neu: number; updates: number; uebersprungen: number }, jetzt: Date) {
  const pp = profitPathAngebot({ id: m.id, content: m.content, embeds: m.embeds });
  if (!pp) {
    z.uebersprungen++;
    return;
  }
  const quelle = `ProfitPath · ${modulAus(kanalName)}`.slice(0, 80);
  const kopf = [`ProfitPath (${kanalName})${pp.shop ? ` · Shop: ${pp.shop}` : ""}`, pp.vk !== null || pp.roi !== null ? `Laut ProfitPath: VK ${pp.vk ?? "–"} · Gewinn ${pp.gewinn ?? "–"} · ROI ${pp.roi ?? "–"} %${pp.marge !== null ? ` · Marge ${pp.marge} %` : ""}` : null, pp.unsicher ? "ASIN unsicher – über Titel und Preis zugeordnet." : null].filter(Boolean).join("\n");
  // Gleiche ASIN innerhalb von 24 Stunden: zusammenfassen; neuer EK = Update.
  if (pp.angebot.asin) {
    const [alt] = await db
      .select({ id: E.id, angebote: E.angebote, rohtext: E.rohtext })
      .from(E)
      .where(and(eq(E.tenantId, tenantId), eq(E.weg, "profitpath"), gte(E.createdAt, new Date(jetzt.getTime() - 24 * 3600_000)), sql`${E.angebote} -> 0 ->> 'asin' = ${pp.angebot.asin}`))
      .limit(1);
    if (alt) {
      const ekAlt = alt.angebote?.[0]?.ek ?? null;
      if (ekAlt === pp.angebot.ek) {
        z.uebersprungen++;
        return;
      }
      await db
        .update(E)
        .set({ angebote: [pp.angebot], rohtext: `${alt.rohtext}\n\n— Update ${jetzt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}: EK ${ekAlt ?? "–"} → ${pp.angebot.ek ?? "–"}\n${pp.text}`.slice(0, 50_000), pruefung: "offen" })
        .where(eq(E.id, alt.id));
      await eingangPruefen(tenantId, alt.id, { update: true });
      z.updates++;
      return;
    }
  }
  const r = await eingangAnlegen(tenantId, null, { weg: "profitpath", text: `${kopf}\n\n${pp.text}`, quelle, quelleRef: `pp:${m.id}`, angebote: [pp.angebot] });
  if (!r.neu) {
    z.uebersprungen++;
    return;
  }
  await eingangPruefen(tenantId, r.id);
  z.neu++;
}

/** Mandanten mit ProfitPath-Anbindung (für den Discord-Takt). */
export async function profitPathMandanten(): Promise<string[]> {
  const rows = await db.select({ t: schema.integrations.tenantId }).from(schema.integrations).where(eq(schema.integrations.provider, "discord_profitpath"));
  return [...new Set(rows.map((r) => r.t))];
}
