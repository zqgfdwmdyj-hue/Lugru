import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { openPii, sealPii } from "@/lib/pii";
import { ABVERKAUF_STANDARD, CHARGE_MAX, RECHTSGRUNDLAGE_BRIEF, ZWECK, anschreibenVorlage, chargeErfolg, codeAus, datenschutzHinweis, istAbmeldung, istKandidat, kiAuftrag, leadSchluessel, leadsAusTabelle, mailErlaubt, mailSchluessel, preisPosition, tagesRest, type Absender, type AbverkaufEinstellungen } from "./logic";

// B34.3 B2B-Abverkauf von Ladenhütern. Nichts wird automatisch verschickt: Entwürfe → Freigabe (einzeln oder Charge
// bis 20, Tageslimit) → Brief als PDF zum Drucken bzw. E-Mail nur, wenn erlaubt. Das Seller-System scrapt nicht –
// Leads kommen per CSV. Keine Rechtsberatung: vor Massenversand rechtlich prüfen lassen.

const P = schema.abverkaufPreislisten;
const L = schema.abverkaufLeads;
const SP = schema.abverkaufSperrliste;
const C = schema.abverkaufChargen;
const A = schema.abverkaufAnschreiben;
export class AbverkaufFehler extends Error {}

const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
const plusTage = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function einstellungen(tenantId: string): Promise<AbverkaufEinstellungen> {
  const [t] = await db.select({ s: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  const roh = ((t?.s ?? {}) as { abverkauf?: Partial<AbverkaufEinstellungen> }).abverkauf ?? {};
  return { ...ABVERKAUF_STANDARD, ...roh, kriterien: { ...ABVERKAUF_STANDARD.kriterien, ...(roh.kriterien ?? {}) }, staffeln: roh.staffeln ?? ABVERKAUF_STANDARD.staffeln };
}

export async function einstellungenSpeichern(s: Session, patch: Partial<AbverkaufEinstellungen>) {
  if (s.role !== "owner" || s.readOnly) throw new AbverkaufFehler("Nur der Inhaber ändert die Abverkauf-Einstellungen.");
  const neu = { ...(await einstellungen(s.tenantId)), ...patch };
  await db
    .update(schema.tenants)
    .set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('abverkauf', ${JSON.stringify(neu)}::jsonb)` })
    .where(eq(schema.tenants.id, s.tenantId));
  return neu;
}

async function absender(tenantId: string): Promise<Absender> {
  const { getSettings } = await import("@/lib/settings");
  const f = (await getSettings(tenantId)).b2b.firma;
  return { name: f.handelsname || f.name || "", strasse: f.strasse, plz: f.plz, ort: f.ort, email: f.email, telefon: f.telefon };
}

// ---- 1. Preisliste ---------------------------------------------------------------------------------------------

/** Ladenhüter laut Kapital-Ampel: Reichweite > 90 T oder Lagerdauer > 60 T bei Kapital > 300 € (einstellbar). */
export async function kandidaten(tenantId: string) {
  const { kapitalAmpel } = await import("@/lib/money/kapital-service");
  const cfg = await einstellungen(tenantId);
  const { zeilen } = await kapitalAmpel(tenantId, heute());
  return zeilen
    .map((z) => ({ sku: z.sku, asin: z.asin, titel: z.name ?? z.sku, stueck: z.stueck, kapital: z.kapital, reichweite: z.reichweite, aeltesteTage: z.aeltesteTage, breakEven: z.breakEven, ampel: z.ampel, ...istKandidat(z, cfg.kriterien) }))
    .filter((z) => z.ja && z.breakEven !== null && z.breakEven > 0 && z.stueck > 0)
    .sort((a, b) => (b.kapital ?? 0) - (a.kapital ?? 0));
}

export async function preislisteErzeugen(s: Session, o: { skus: string[]; aufschlagProzent: number; mengen: Record<string, number> }): Promise<string> {
  if (s.readOnly) throw new AbverkaufFehler("Nur ansehen – nichts geändert.");
  const cfg = await einstellungen(s.tenantId);
  const liste = (await kandidaten(s.tenantId)).filter((k) => o.skus.includes(k.sku));
  if (!liste.length) throw new AbverkaufFehler("Bitte mindestens einen Ladenhüter auswählen.");
  const aufschlag = Number.isFinite(o.aufschlagProzent) ? Math.min(200, Math.max(0, o.aufschlagProzent)) : cfg.aufschlagProzent;
  const positionen = liste.map((k) => {
    const p = preisPosition(k.breakEven!, aufschlag, cfg.staffeln);
    const menge = Math.min(k.stueck, Math.max(1, Math.round(o.mengen[k.sku] ?? k.stueck)));
    return { sku: k.sku, asin: k.asin, titel: k.titel, menge, preis: p.preis, staffel: p.staffel.filter((st) => st.ab <= menge) };
  });
  const [r] = await db.insert(P).values({ tenantId: s.tenantId, aufschlagProzent: aufschlag, staffeln: cfg.staffeln, positionen, erstelltVon: s.userId }).returning({ id: P.id });
  return r.id;
}

export async function preislisteLesen(tenantId: string, id: string) {
  const [p] = await db.select().from(P).where(and(eq(P.tenantId, tenantId), eq(P.id, id)));
  return p ?? null;
}

export async function letztePreislisten(tenantId: string, n = 5) {
  return db.select().from(P).where(eq(P.tenantId, tenantId)).orderBy(desc(P.createdAt)).limit(n);
}

/** Datei für Händler: PDF bzw. Excel – nur Artikel, Menge, Preis, Staffel (kein EK, kein Break-even). */
export async function preislisteDatei(tenantId: string, id: string, format: "pdf" | "xlsx"): Promise<{ name: string; bytes: Uint8Array; typ: string } | null> {
  const p = await preislisteLesen(tenantId, id);
  if (!p) return null;
  const tag = p.createdAt.toISOString().slice(0, 10);
  if (format === "pdf") {
    const { preislistePdf } = await import("./pdf");
    return { name: `Restposten-Preisliste_${tag}.pdf`, bytes: await preislistePdf({ absender: await absender(tenantId), positionen: p.positionen, stand: p.createdAt }), typ: "application/pdf" };
  }
  const zeilen = [["Artikel", "ASIN", "Menge", "Preis netto je Stück (EUR)", "Staffelpreise"], ...p.positionen.map((x) => [x.titel, x.asin ?? "", x.menge, x.preis, x.staffel.map((s) => `ab ${s.ab}: ${s.preis.toFixed(2)}`).join("; ")])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(zeilen), "Restposten");
  const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
  return { name: `Restposten-Preisliste_${tag}.xlsx`, bytes, typ: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}

// ---- 2. Leads --------------------------------------------------------------------------------------------------

export async function leadsImportieren(s: Session, o: { name: string; bytes: Uint8Array; quelle: string; quelleDatum: string }) {
  if (s.readOnly) throw new AbverkaufFehler("Nur ansehen – nichts geändert.");
  if (!o.quelle.trim()) throw new AbverkaufFehler("Bitte die Quelle angeben (z. B. „Apify Google Maps, Suche Spielwaren München“).");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.quelleDatum)) throw new AbverkaufFehler("Bitte das Datum der Quelle angeben.");
  const { readTable } = await import("@/lib/tabular");
  const t = readTable(o.bytes);
  const r = leadsAusTabelle(t.headers, t.rows);
  const cfg = await einstellungen(s.tenantId);
  const gesperrt = new Set((await db.select({ k: SP.schluessel }).from(SP).where(eq(SP.tenantId, s.tenantId))).map((x) => x.k));
  let neu = 0;
  let doppelt = 0;
  let sperre = 0;
  const loeschenAm = plusTage(heute(), cfg.loeschfristTage);
  for (const l of r.leads) {
    const key = leadSchluessel(l.firma, l.plz);
    if (gesperrt.has(key) || (l.email && gesperrt.has(mailSchluessel(l.email)))) {
      sperre++;
      continue;
    }
    const ins = await db
      .insert(L)
      .values({ tenantId: s.tenantId, firma: l.firma, strasse: l.strasse ? sealPii(l.strasse) : null, plz: l.plz, ort: l.ort, land: l.land, kategorie: l.kategorie, email: l.email ? sealPii(l.email) : null, emailQuelle: l.emailQuelle, website: l.website, quelle: o.quelle.trim().slice(0, 200), quelleDatum: o.quelleDatum, kontaktweg: "brief", rechtsgrundlage: RECHTSGRUNDLAGE_BRIEF, zweck: ZWECK, loeschenAm, schluessel: key, importName: o.name.slice(0, 200) })
      .onConflictDoNothing()
      .returning({ id: L.id });
    if (ins.length) neu++;
    else doppelt++;
  }
  return { neu, doppelt, gesperrt: sperre, verworfen: r.verworfen, ohneMail: r.ohneMail };
}

export type LeadZeile = Omit<typeof L.$inferSelect, "strasse" | "email"> & { strasse: string | null; email: string | null };
const offen = (l: typeof L.$inferSelect): LeadZeile => ({ ...l, strasse: l.strasse ? openPii(l.strasse) : null, email: l.email ? openPii(l.email) : null });

export async function leadsListe(tenantId: string, limit = 300): Promise<LeadZeile[]> {
  return (await db.select().from(L).where(eq(L.tenantId, tenantId)).orderBy(desc(L.createdAt)).limit(limit)).map(offen);
}

export async function leadAendern(s: Session, id: string, o: { kontaktweg?: "brief" | "email"; einwilligung?: string | null; bestandskunde?: boolean; status?: (typeof L.$inferSelect)["status"] }) {
  if (s.readOnly) throw new AbverkaufFehler("Nur ansehen – nichts geändert.");
  await db.update(L).set({ ...(o.kontaktweg ? { kontaktweg: o.kontaktweg } : {}), ...(o.einwilligung !== undefined ? { einwilligung: o.einwilligung?.trim().slice(0, 300) || null } : {}), ...(o.bestandskunde !== undefined ? { bestandskunde: o.bestandskunde } : {}), ...(o.status ? { status: o.status } : {}) }).where(and(eq(L.tenantId, s.tenantId), eq(L.id, id)));
}

/** Sperren (Widerspruch/Abmeldung): Lead gesperrt, offene Entwürfe gestoppt, Prüfsummen auf die Sperrliste. */
export async function leadSperren(tenantId: string, id: string, grund: string) {
  const [l] = await db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.id, id)));
  if (!l) return false;
  const keys = [l.schluessel, ...(l.email ? [mailSchluessel(openPii(l.email))] : [])];
  for (const k of keys) await db.insert(SP).values({ tenantId, schluessel: k, grund: grund.slice(0, 200) }).onConflictDoNothing();
  await db.update(L).set({ status: "gesperrt" }).where(eq(L.id, l.id));
  await db.update(A).set({ status: "gesperrt", fehler: "Lead gesperrt (Widerspruch)" }).where(and(eq(A.tenantId, tenantId), eq(A.leadId, l.id), inArray(A.status, ["entwurf", "freigegeben"])));
  return true;
}

/** Leads mit abgelaufener Löschfrist (Löschen nur von Hand – bleiben als Prüfsumme auf der Sperrliste, wenn gesperrt). */
export async function loeschfaellig(tenantId: string) {
  return (await db.select().from(L).where(and(eq(L.tenantId, tenantId), lt(L.loeschenAm, heute())))).map(offen);
}

export async function leadLoeschen(s: Session, id: string) {
  if (s.role !== "owner" || s.readOnly) throw new AbverkaufFehler("Nur der Inhaber löscht Leads.");
  await db.delete(A).where(and(eq(A.tenantId, s.tenantId), eq(A.leadId, id), inArray(A.status, ["entwurf", "gesperrt"])));
  await db.delete(L).where(and(eq(L.tenantId, s.tenantId), eq(L.id, id)));
}

// ---- 3. Anschreiben ----------------------------------------------------------------------------------------------

const neuerCode = () => `AV-${randomBytes(4).toString("hex").toUpperCase().slice(0, 6)}`;

/** KI-Entwurf je Händler (ohne KI: Vorlage). Nie automatischer Versand – erst Freigabe. Höchstens 20 auf einmal. */
export async function entwuerfeErstellen(s: Session, leadIds: string[], preislisteId: string | null): Promise<{ neu: number; text: string }> {
  if (s.readOnly) throw new AbverkaufFehler("Nur ansehen – nichts geändert.");
  const ids = [...new Set(leadIds)].slice(0, CHARGE_MAX);
  const leads = ids.length ? await db.select().from(L).where(and(eq(L.tenantId, s.tenantId), inArray(L.id, ids))) : [];
  const liste = preislisteId ? await preislisteLesen(s.tenantId, preislisteId) : (await letztePreislisten(s.tenantId, 1))[0] ?? null;
  const positionen = (liste?.positionen ?? []).map((p) => ({ titel: p.titel, menge: p.menge, preis: p.preis }));
  const abs = await absender(s.tenantId);
  const { getIntegration } = await import("@/lib/integrations/store");
  const ai = await getIntegration(s.tenantId, "anthropic");
  let neu = 0;
  for (const l of leads) {
    if (l.status === "gesperrt") continue;
    const [schon] = await db.select({ id: A.id }).from(A).where(and(eq(A.tenantId, s.tenantId), eq(A.leadId, l.id), eq(A.status, "entwurf"))).limit(1);
    if (schon) continue;
    const code = neuerCode();
    const v = anschreibenVorlage({ firma: l.firma, kategorie: l.kategorie, absender: abs, positionen, code });
    let text = v.text;
    let ki = false;
    if (ai?.apiKey) {
      try {
        const { askClaude, modelFor } = await import("@/lib/ai/claude");
        const r = await askClaude(ai.apiKey, kiAuftrag({ firma: l.firma, kategorie: l.kategorie, positionen, absender: abs.name }), { model: modelFor(ai, "simple"), task: "simple", maxTokens: 600, timeoutMs: 60_000 });
        const t = r.text.trim();
        if (t.length > 40) {
          text = `${t}\n\nMit freundlichen Grüßen\n${abs.name}\n${[abs.telefon, abs.email].filter(Boolean).join(" · ")}`;
          ki = true;
        }
      } catch {
        // Vorlage bleibt
      }
    }
    await db.insert(A).values({ tenantId: s.tenantId, leadId: l.id, preislisteId: liste?.id ?? null, kanal: l.kontaktweg, code, betreff: v.betreff, text: text.slice(0, 6000), ki });
    neu++;
  }
  return { neu, text: `${neu} Entwurf${neu === 1 ? "" : "e"} angelegt${leadIds.length > CHARGE_MAX ? ` (höchstens ${CHARGE_MAX} auf einmal)` : ""} – nichts verschickt, erst nach Freigabe.` };
}

export async function anschreibenListe(tenantId: string, limit = 200) {
  return db
    .select({ a: A, firma: L.firma, ort: L.ort, kontaktweg: L.kontaktweg })
    .from(A)
    .innerJoin(L, eq(L.id, A.leadId))
    .where(eq(A.tenantId, tenantId))
    .orderBy(desc(A.createdAt))
    .limit(limit);
}

export async function anschreibenAendern(s: Session, id: string, o: { betreff?: string; text?: string; umsatz?: number | null; marge?: number | null }) {
  if (s.readOnly) throw new AbverkaufFehler("Nur ansehen – nichts geändert.");
  await db.update(A).set({ ...(o.betreff ? { betreff: o.betreff.slice(0, 200) } : {}), ...(o.text ? { text: o.text.slice(0, 6000) } : {}), ...(o.umsatz !== undefined ? { umsatz: o.umsatz } : {}), ...(o.marge !== undefined ? { marge: o.marge } : {}) }).where(and(eq(A.tenantId, s.tenantId), eq(A.id, id)));
}

/**
 * Freigabe (einzeln oder Charge bis 20, Tageslimit): Briefe → „freigegeben“ (Serienbrief-PDF zum Drucken, danach
 * „verschickt“ markieren); E-Mails → nur wenn erlaubt (Bestandskunde bzw. „Rechtlich geprüft“ + Einwilligung),
 * dann Versand über das eigene Postfach; sonst bleibt der Entwurf mit Grund stehen.
 */
export async function freigeben(s: Session, ids: string[]): Promise<{ chargeId: string | null; freigegeben: number; versendet: number; gesperrt: string[]; text: string }> {
  if (s.readOnly) throw new AbverkaufFehler("Nur ansehen – nichts geändert.");
  if (s.role !== "owner") throw new AbverkaufFehler("Nur der Inhaber gibt Anschreiben frei.");
  const cfg = await einstellungen(s.tenantId);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(A).where(and(eq(A.tenantId, s.tenantId), gte(A.freigegebenAm, new Date(`${heute()}T00:00:00+01:00`))));
  const rest = tagesRest(n, cfg.tageslimit);
  if (!rest) throw new AbverkaufFehler(`Tageslimit erreicht (${cfg.tageslimit} je Tag) – morgen weiter.`);
  const wahl = [...new Set(ids)].slice(0, Math.min(CHARGE_MAX, rest));
  const zeilen = wahl.length ? await db.select({ a: A, l: L }).from(A).innerJoin(L, eq(L.id, A.leadId)).where(and(eq(A.tenantId, s.tenantId), inArray(A.id, wahl), eq(A.status, "entwurf"))) : [];
  if (!zeilen.length) throw new AbverkaufFehler("Keine offenen Entwürfe ausgewählt.");
  const gesperrt: string[] = [];
  const ok: typeof zeilen = [];
  for (const z of zeilen) {
    if (z.l.status === "gesperrt") {
      gesperrt.push(`${z.l.firma}: gesperrt`);
      continue;
    }
    if (z.a.kanal === "email") {
      const m = mailErlaubt({ bestandskunde: z.l.bestandskunde, einwilligung: z.l.einwilligung, email: z.l.email ? openPii(z.l.email) : null }, cfg.rechtlichGeprueft);
      if (!m.erlaubt) {
        gesperrt.push(`${z.l.firma}: ${m.grund}`);
        await db.update(A).set({ fehler: m.grund }).where(eq(A.id, z.a.id));
        continue;
      }
    }
    ok.push(z);
  }
  if (!ok.length) return { chargeId: null, freigegeben: 0, versendet: 0, gesperrt, text: `Nichts freigegeben: ${gesperrt.join(" · ")}` };
  const kanal = ok.every((z) => z.a.kanal === "email") ? "email" : "brief";
  const [{ nr }] = await db.select({ nr: sql<number>`coalesce(max(${C.nr}), 0)::int + 1` }).from(C).where(eq(C.tenantId, s.tenantId));
  const [charge] = await db.insert(C).values({ tenantId: s.tenantId, nr, kanal, preislisteId: ok[0].a.preislisteId, freigegebenVon: s.userId }).returning({ id: C.id });
  let versendet = 0;
  const abs = await absender(s.tenantId);
  for (const z of ok) {
    await db.update(A).set({ chargeId: charge.id, status: "freigegeben", freigegebenAm: new Date(), fehler: null }).where(eq(A.id, z.a.id));
    await db.update(L).set({ status: z.l.status === "neu" ? "angeschrieben" : z.l.status }).where(eq(L.id, z.l.id));
    if (z.a.kanal === "email" && z.l.email) {
      try {
        const { sendMail } = await import("@/lib/mail/accounts");
        const ds = datenschutzHinweis(abs, { quelle: z.l.quelle, quelleDatum: z.l.quelleDatum, loeschenAm: z.l.loeschenAm });
        await sendMail(s.tenantId, { to: openPii(z.l.email), subject: z.a.betreff, text: `${z.a.text}\n\n---\n${ds}` }, { fromName: abs.name || undefined });
        await db.update(A).set({ status: "versendet", versendetAm: new Date() }).where(eq(A.id, z.a.id));
        versendet++;
      } catch (e) {
        await db.update(A).set({ fehler: `Versand fehlgeschlagen: ${e instanceof Error ? e.message.slice(0, 200) : "?"}` }).where(eq(A.id, z.a.id));
      }
    }
  }
  return { chargeId: charge.id, freigegeben: ok.length, versendet, gesperrt, text: `Charge ${nr}: ${ok.length} freigegeben${versendet ? `, ${versendet} E-Mails verschickt` : ""}${kanal === "brief" ? " – Serienbrief-PDF drucken, dann „verschickt“ markieren" : ""}${gesperrt.length ? ` · gesperrt: ${gesperrt.join(" · ")}` : ""}` };
}

/** Briefe der Charge als verschickt markieren (nach dem Druck). */
export async function chargeVerschickt(s: Session, chargeId: string) {
  if (s.readOnly) throw new AbverkaufFehler("Nur ansehen – nichts geändert.");
  await db.update(A).set({ status: "versendet", versendetAm: new Date() }).where(and(eq(A.tenantId, s.tenantId), eq(A.chargeId, chargeId), eq(A.status, "freigegeben"), eq(A.kanal, "brief")));
  await db.update(C).set({ versendetAm: new Date() }).where(and(eq(C.tenantId, s.tenantId), eq(C.id, chargeId)));
}

/** Serienbrief der Charge: je Händler eine Seite mit Anschrift, Text, Datenschutzhinweis (Art. 14 DSGVO). */
export async function serienbrief(tenantId: string, chargeId: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  const [c] = await db.select().from(C).where(and(eq(C.tenantId, tenantId), eq(C.id, chargeId)));
  if (!c) return null;
  const zeilen = await db.select({ a: A, l: L }).from(A).innerJoin(L, eq(L.id, A.leadId)).where(and(eq(A.tenantId, tenantId), eq(A.chargeId, chargeId), eq(A.kanal, "brief"), inArray(A.status, ["freigegeben", "versendet", "beantwortet"])));
  const abs = await absender(tenantId);
  const { serienbriefPdf } = await import("./pdf");
  const bytes = await serienbriefPdf({
    absender: abs,
    datum: new Date(),
    briefe: zeilen.map((z) => ({ anschrift: [z.l.firma, z.l.strasse ? openPii(z.l.strasse) : "", [z.l.plz, z.l.ort].filter(Boolean).join(" "), z.l.land !== "DE" ? z.l.land : ""].filter(Boolean), betreff: z.a.betreff, text: z.a.text, datenschutz: datenschutzHinweis(abs, { quelle: z.l.quelle, quelleDatum: z.l.quelleDatum, loeschenAm: z.l.loeschenAm }), code: z.a.code })),
  });
  return { name: `Serienbrief_Charge-${c.nr}.pdf`, bytes };
}

// ---- 4. Antworten und Erfolg ---------------------------------------------------------------------------------------

/**
 * Antwort im Posteingang (Bezug „AV-…“ oder Absender = Lead-E-Mail): Anschreiben „beantwortet“, Aufgabe anlegen;
 * Abmeldung/Widerspruch → Sperrliste. Die Mail bleibt im Posteingang.
 */
export async function antwortAusMail(tenantId: string, m: { messageKey: string; fromAddress: string; subject: string; text: string }): Promise<boolean> {
  const code = codeAus(`${m.subject} ${m.text.slice(0, 4000)}`);
  let treffer: { a: typeof A.$inferSelect; l: typeof L.$inferSelect } | undefined;
  if (code) [treffer] = await db.select({ a: A, l: L }).from(A).innerJoin(L, eq(L.id, A.leadId)).where(and(eq(A.tenantId, tenantId), eq(A.code, code))).limit(1);
  if (!treffer) {
    const offeneLeads = await db.select().from(L).where(and(eq(L.tenantId, tenantId), inArray(L.status, ["angeschrieben", "geantwortet"]), sql`${L.email} is not null`)).limit(2000);
    const l = offeneLeads.find((x) => openPii(x.email!).toLowerCase() === m.fromAddress.trim().toLowerCase());
    if (l) [treffer] = await db.select({ a: A, l: L }).from(A).innerJoin(L, eq(L.id, A.leadId)).where(and(eq(A.tenantId, tenantId), eq(A.leadId, l.id))).orderBy(desc(A.createdAt)).limit(1);
  }
  if (!treffer) return false;
  const abmeldung = istAbmeldung(`${m.subject}\n${m.text.slice(0, 3000)}`);
  await db.update(A).set({ status: "beantwortet", antwortAm: new Date() }).where(eq(A.id, treffer.a.id));
  if (abmeldung) await leadSperren(tenantId, treffer.l.id, "Abmeldung per Antwort");
  else await db.update(L).set({ status: "geantwortet" }).where(eq(L.id, treffer.l.id));
  await db
    .insert(schema.tasks)
    .values({ tenantId, title: abmeldung ? `Abmeldung: ${treffer.l.firma} (Restposten) – auf Sperrliste` : `Antwort auf Restposten-Angebot: ${treffer.l.firma}`, notes: `Bezug ${treffer.a.code}. Mail im Posteingang: „${m.subject.slice(0, 120)}“.`, dueDate: heute(), priority: "normal", category: "einkauf", systemKey: `abverkauf-antwort:${m.messageKey}`.slice(0, 200), link: "/b2b/abverkauf#anschreiben" })
    .onConflictDoNothing();
  return true;
}

export async function erfolgJeCharge(tenantId: string) {
  const ch = await db.select().from(C).where(eq(C.tenantId, tenantId)).orderBy(desc(C.nr)).limit(50);
  const an = ch.length ? await db.select({ chargeId: A.chargeId, status: A.status, umsatz: A.umsatz, marge: A.marge }).from(A).where(and(eq(A.tenantId, tenantId), inArray(A.chargeId, ch.map((c) => c.id)))) : [];
  return ch.map((c) => ({ ...c, ...chargeErfolg(an.filter((x) => x.chargeId === c.id)), anzahl: an.filter((x) => x.chargeId === c.id).length }));
}
