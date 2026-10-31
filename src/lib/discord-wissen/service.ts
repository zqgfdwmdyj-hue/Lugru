import "server-only";
import { and, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { anonym, dublette, fruehwarnungen, istDeal, kanaeleAus, nachrichtLink, zusammenfassungFaellig, zusammenfassungLesen, zusammenfassungsAuftrag, type ChatZusammenfassung, type Kanal } from "./logic";

// Wissen aus Discord-Kanälen der Deal-Gruppe (B14 Teil B). Nur LESEN mit einem Bot, den der Server-Admin einlädt
// (nie Nutzer-Token). Der Bot schreibt nie. Rohnachrichten (verschlüsselt) höchstens `rohTage`, danach bleiben nur
// Zusammenfassungen (Call-Archiv, Quelle „Chat“) und Wissens-Einträge (Insider – nicht weitergeben).

const C = schema.discordChat;
const S = schema.discordChatStand;
const K = schema.knowledgeEntries;
const DISCORD = () => (process.env.DISCORD_API_BASE_URL || "https://discord.com/api/v10").replace(/\/$/, "");
type DiscordMsg = { id: string; content?: string; timestamp?: string; author?: { id?: string; username?: string; global_name?: string | null; bot?: boolean } };

async function konfig(tenantId: string): Promise<{ token: string; serverId: string | null; kanaele: Kanal[] } | null> {
  const w = await getIntegration(tenantId, "discord_wissen");
  if (!w) return null;
  const kanaele = kanaeleAus(String(w.kanaele ?? ""));
  if (!kanaele.length) return null;
  // Eigener Bot – sonst derselbe Bot wie beim VA- bzw. Call-Kanal (vom Server-Admin eingeladen).
  const token = String(w.botToken || (await getIntegration(tenantId, "discord_va"))?.botToken || (await getIntegration(tenantId, "discord_calls"))?.botToken || "");
  if (!token) return null;
  return { token, serverId: w.serverId ? String(w.serverId) : null, kanaele };
}

/** Neue Nachrichten eines Kanals (nach der zuletzt gelesenen), höchstens 500 je Lauf. */
async function lesen(token: string, kanalId: string, nach: string | null): Promise<DiscordMsg[]> {
  const out: DiscordMsg[] = [];
  let ab = nach;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${DISCORD()}/channels/${encodeURIComponent(kanalId)}/messages?limit=100${ab ? `&after=${ab}` : ""}`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 403 || r.status === 404) throw new Error(`Kanal ${kanalId} nicht lesbar (${r.status}) – ist der Bot dort freigegeben?`);
    if (!r.ok) throw new Error(`Discord ${r.status}`);
    const seite = ((await r.json()) as DiscordMsg[]).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    out.push(...seite);
    if (seite.length < 100) break;
    ab = seite[seite.length - 1].id;
  }
  return out;
}

const KATEGORIE = (kanal: string) => (/ebay/i.test(kanal) ? "eBay" : /temu|tiktok/i.test(kanal) ? "TikTok Shop & Temu" : /versand|dhl|post/i.test(kanal) ? "DHL & Versand" : "Aus Calls");

function zusammenfassungText(z: ChatZusammenfassung): string {
  const teil = (t: string, l: string[]) => (l.length ? `\n\n${t}:\n${l.map((x) => `- ${x}`).join("\n")}` : "");
  return `${z.ueberblick}${z.themen.map((t) => `\n\n${t.name}:\n${t.punkte.map((p) => `- ${p}`).join("\n")}`).join("")}${teil("Tipps", z.tipps)}${teil("Warnungen", z.warnungen)}${teil("Offene Fragen", z.fragen)}${teil("Erwähnte Tools/Lieferanten", z.tools)}`;
}

/** Zusammenfassung eines Kanals für den Zeitraum seit der letzten (KI) → Call-Archiv (Quelle „Chat“) + Wissen. */
async function zusammenfassen(tenantId: string, k: Kanal, serverId: string | null, seit: Date, jetzt: Date): Promise<{ wissen: number } | null> {
  const msgs = await db.select().from(C).where(and(eq(C.tenantId, tenantId), eq(C.kanalId, k.id), gte(C.gesendetAm, seit), lt(C.gesendetAm, jetzt))).orderBy(C.gesendetAm);
  if (!msgs.length) return null;
  const ai = await getIntegration(tenantId, "anthropic");
  if (!ai?.apiKey) return null;
  const { askClaude, modelFor } = await import("@/lib/ai/claude");
  const von = todayIso(seit);
  const bis = todayIso(jetzt);
  const r = await askClaude(ai.apiKey, zusammenfassungsAuftrag(k.name, von, bis, anonym(msgs)), { model: modelFor(ai, "simple"), task: "simple", maxTokens: 3000, timeoutMs: 120_000 });
  const z = zusammenfassungLesen(r.text);
  if (!z) throw new Error("KI-Antwort ohne Zusammenfassung");
  const titel = `Chat ${k.name} ${von === bis ? bis.split("-").reverse().join(".") : `${von.split("-").reverse().join(".")}–${bis.split("-").reverse().join(".")}`}`;
  const extra = [
    ...(z.tipps.length ? [{ name: "Tipps", punkte: z.tipps }] : []),
    ...(z.warnungen.length ? [{ name: "Warnungen", punkte: z.warnungen }] : []),
    ...(z.fragen.length ? [{ name: "Offene Fragen", punkte: z.fragen }] : []),
    ...(z.tools.length ? [{ name: "Tools/Lieferanten", punkte: z.tools }] : []),
  ];
  const [call] = await db
    .insert(schema.calls)
    .values({ tenantId, titel, datum: bis, quelle: "chat", art: "gruppe", quelleRef: `chat:${k.id}:${bis}`, transkript: zusammenfassungText(z), zusammenfassung: { ueberblick: z.ueberblick, themen: [...z.themen, ...extra], teilnehmer: [] }, auswertung: "fertig", wissenAm: jetzt })
    .onConflictDoUpdate({ target: [schema.calls.tenantId, schema.calls.quelleRef], set: { titel, transkript: zusammenfassungText(z), zusammenfassung: { ueberblick: z.ueberblick, themen: [...z.themen, ...extra], teilnehmer: [] }, wissenAm: jetzt } })
    .returning({ id: schema.calls.id });
  // Wissens-Einträge: Insider, mit Kanal, Datum und Link; Dubletten werden ergänzt statt neu angelegt.
  const vorhanden = await db.select({ id: K.id, title: K.title, body: K.body }).from(K).where(and(eq(K.tenantId, tenantId), inArray(K.origin, ["call", "chat"]))).limit(2000);
  const link = nachrichtLink(serverId, k.id, msgs[msgs.length - 1].nachrichtId);
  let n = 0;
  for (const e of z.erkenntnisse) {
    const quelle = `Quelle: Gruppen-Chat „${k.name}“, ${bis.split("-").reverse().join(".")}${link ? ` – ${link}` : ""}`;
    const doppelt = dublette(e.titel, vorhanden.map((v) => v.title));
    if (doppelt) {
      const v = vorhanden.find((x) => x.title === doppelt)!;
      if (!v.body.includes(`„${k.name}“, ${bis.split("-").reverse().join(".")}`)) await db.update(K).set({ body: `${v.body}\n\nErgänzt aus dem Chat: ${e.text}\n${quelle}`.slice(0, 20_000), quelleDatum: bis, updatedAt: jetzt }).where(eq(K.id, v.id));
      continue;
    }
    await db.insert(K).values({ tenantId, kind: "article", category: KATEGORIE(k.name), title: e.titel, body: `${e.text}\n\n${quelle}`, tags: ["Deal-Gruppe", "Chat", k.name].slice(0, 10), origin: "chat", insider: true, callId: call.id, quelleDatum: bis, quelleWer: `Gruppe · ${k.name}`, erkenntnis: e.art });
    vorhanden.push({ id: "", title: e.titel, body: e.text });
    n++;
  }
  return { wissen: n };
}

/** Eigene Daten zum Warn-Thema (z. B. „bei dir 2 Amazon-ToDos zu Batterie offen“). */
async function eigenerAbgleich(tenantId: string, key: string): Promise<string> {
  const muster: Record<string, string[]> = {
    batterie: ["%batter%", "%EPR%", "%Registrierungsnummer%"],
    gpsr: ["%GPSR%", "%Produktsicherheit%", "%product safety%"],
    deaktivierung: ["%deaktiviert%", "%deactivated%", "%suppressed%", "%entfernt%"],
    sperrwelle: ["%gesperrt%", "%suspended%", "%deaktiviert%"],
    gebuehr: ["%Gebühr%", "%fee%"],
  };
  const m = muster[key] ?? [];
  if (!m.length) return "";
  const A = schema.amazonTodos;
  const E = schema.emails;
  const seit = new Date(Date.now() - 14 * 86_400_000);
  const [[t], [e]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.status, "open"), or(...m.flatMap((x) => [ilike(A.subject, x), ilike(A.summary, x)])))),
    db.select({ n: sql<number>`count(*)::int` }).from(E).where(and(eq(E.tenantId, tenantId), gte(E.receivedAt, seit), or(...m.map((x) => ilike(E.subject, x))))),
  ]);
  if (!t.n && !e.n) return "Bei dir: nichts Passendes in Amazon-ToDos und Mails der letzten 14 Tage.";
  return `Bei dir: ${t.n} offene Amazon-ToDo${t.n === 1 ? "" : "s"} und ${e.n} Mail${e.n === 1 ? "" : "s"} (14 Tage) zum Thema.`;
}

/**
 * Lauf (Hintergrund): je freigegebenem Kanal neue Nachrichten lesen und verschlüsselt ablegen, Deals in den
 * Deal-Eingang, Frühwarnung (≥ 3 Nutzer/48 h), fällige Zusammenfassungen, alte Rohtexte löschen.
 */
export async function discordWissenLauf(tenantId: string, jetzt = new Date()): Promise<{ gelesen: number; zusammenfassungen: number; wissen: number; warnungen: number; deals: number; geloescht: number; fehler: string[] } | null> {
  const cfg = await konfig(tenantId);
  const sum = { gelesen: 0, zusammenfassungen: 0, wissen: 0, warnungen: 0, deals: 0, geloescht: 0, fehler: [] as string[] };
  if (cfg) {
    for (const k of cfg.kanaele) {
      if (k.rhythmus === "aus") continue;
      try {
        const [st] = await db.select().from(S).where(and(eq(S.tenantId, tenantId), eq(S.kanalId, k.id))).limit(1);
        const neu = (await lesen(cfg.token, k.id, st?.letzteId ?? null)).filter((m) => !m.author?.bot && (m.content ?? "").trim());
        for (const m of neu) {
          const r = await db
            .insert(C)
            .values({ tenantId, kanalId: k.id, nachrichtId: m.id, autor: (m.author?.global_name || m.author?.username || "").slice(0, 80) || null, autorId: m.author?.id ?? null, text: (m.content ?? "").slice(0, 4000), gesendetAm: m.timestamp ? new Date(m.timestamp) : jetzt })
            .onConflictDoNothing()
            .returning({ id: C.id });
          if (!r.length) continue;
          sum.gelesen++;
          if (istDeal(m.content ?? "")) {
            const { eingangAnlegen } = await import("@/lib/deal-eingang/service");
            const { eingangPruefen } = await import("@/lib/deal-eingang/service");
            const e = await eingangAnlegen(tenantId, null, { weg: "gruppe", text: m.content ?? "", quelle: `Gruppe · ${k.name}`, quelleRef: `discord:${m.id}` }).catch(() => null);
            if (e?.neu) {
              sum.deals++;
              await eingangPruefen(tenantId, e.id).catch(() => null);
              await import("@/lib/deal-eingang/ablauf").then((x) => x.benachrichtigen(tenantId, e.id)).catch(() => null);
            }
          }
        }
        const letzte = neu.length ? neu[neu.length - 1].id : (st?.letzteId ?? null);
        // Frühwarnung: alle Kanäle der letzten 48 h zusammen, je Thema höchstens einmal in 48 h.
        let gewarnt: Record<string, string> = {};
        try {
          gewarnt = JSON.parse(st?.gewarnt ?? "{}") as Record<string, string>;
        } catch {
          gewarnt = {};
        }
        if (neu.length) {
          const fenster = await db.select({ autorId: C.autorId, text: C.text, gesendetAm: C.gesendetAm }).from(C).where(and(eq(C.tenantId, tenantId), gte(C.gesendetAm, new Date(jetzt.getTime() - 48 * 3_600_000))));
          for (const w of fruehwarnungen(fenster, jetzt)) {
            if (gewarnt[w.key] && jetzt.getTime() - Date.parse(gewarnt[w.key]) < 48 * 3_600_000) continue;
            const alleStaende = await db.select({ gewarnt: S.gewarnt }).from(S).where(eq(S.tenantId, tenantId));
            const schon = alleStaende.some((x) => {
              try {
                const g = JSON.parse(x.gewarnt ?? "{}") as Record<string, string>;
                return g[w.key] && jetzt.getTime() - Date.parse(g[w.key]) < 48 * 3_600_000;
              } catch {
                return false;
              }
            });
            gewarnt[w.key] = jetzt.toISOString();
            if (schon) continue;
            const eigen = await eigenerAbgleich(tenantId, w.key);
            const { melden } = await import("@/lib/push/service");
            const [owner] = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.role, "owner"))).limit(1);
            if (owner) await melden(tenantId, [owner.userId], { titel: `Frühwarnung: ${w.name}`, text: `${w.nutzer} Leute in der Gruppe melden in 48 Std. dasselbe Problem (${w.name}). ${eigen}`, link: "/wissen?herkunft=chat" }, { ohneDiscord: true }).catch(() => null);
            await db.insert(schema.tasks).values({ tenantId, title: `Frühwarnung aus der Gruppe: ${w.name}`, notes: `${w.nutzer} Nutzer in 48 Std.\n${eigen}\n\nBeispiele (gekürzt, ohne Namen):\n${w.beispiele.map((b) => `- ${b}`).join("\n")}`, dueDate: todayIso(jetzt), priority: "critical", category: "amazon", systemKey: `chat-warnung:${w.key}:${todayIso(jetzt)}`, link: "/wissen?herkunft=chat" }).onConflictDoNothing();
            sum.warnungen++;
          }
        }
        // Zusammenfassung fällig (täglich/wöchentlich)?
        let letzteZ = st?.letzteZusammenfassung ?? null;
        if (zusammenfassungFaellig(k.rhythmus, letzteZ, jetzt)) {
          const seit = letzteZ ?? new Date(jetzt.getTime() - (k.rhythmus === "taeglich" ? 1 : 7) * 86_400_000);
          const z = await zusammenfassen(tenantId, k, cfg.serverId, seit, jetzt).catch((e) => {
            sum.fehler.push(`${k.name}: Zusammenfassung – ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
            return undefined;
          });
          if (z !== undefined) letzteZ = jetzt;
          if (z) {
            sum.zusammenfassungen++;
            sum.wissen += z.wissen;
          }
        }
        await db
          .insert(S)
          .values({ tenantId, kanalId: k.id, name: k.name, rhythmus: k.rhythmus, letzteId: letzte, letzteZusammenfassung: letzteZ, gewarnt: JSON.stringify(gewarnt) })
          .onConflictDoUpdate({ target: [S.tenantId, S.kanalId], set: { name: k.name, rhythmus: k.rhythmus, letzteId: letzte, letzteZusammenfassung: letzteZ, gewarnt: JSON.stringify(gewarnt), updatedAt: jetzt } });
      } catch (e) {
        sum.fehler.push(`${k.name}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
      }
    }
  }
  sum.geloescht = await rohtexteLoeschen(tenantId, jetzt);
  return cfg || sum.geloescht ? sum : null;
}

/** Datensparsam: Rohnachrichten älter als `rohTage` löschen (Zusammenfassungen und Wissen bleiben). */
export async function rohtexteLoeschen(tenantId: string, jetzt = new Date()): Promise<number> {
  const tage = Math.max(1, (await getSettings(tenantId)).discordWissen.rohTage || 30);
  const grenze = new Date(`${addDaysIso(todayIso(jetzt), -tage)}T00:00:00Z`);
  const r = await db.delete(C).where(and(eq(C.tenantId, tenantId), lt(C.gesendetAm, grenze))).returning({ id: C.id });
  return r.length;
}

/** Stand je Kanal (für die Wissen-Seite/Anbindung). */
export async function kanalStaende(tenantId: string) {
  const [staende, [roh]] = await Promise.all([
    db.select().from(S).where(eq(S.tenantId, tenantId)).orderBy(S.name),
    db.select({ n: sql<number>`count(*)::int` }).from(C).where(eq(C.tenantId, tenantId)),
  ]);
  return { staende, rohNachrichten: roh.n };
}
