import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { ANBIETER_NAME, briefAnbieter, type BriefAnbieterName } from "@/lib/integrations/clients/briefversand";
import { getIntegration } from "@/lib/integrations/store";
import { briefeBauen, type BriefZeile } from "./briefe";
import { adressePruefen, anschriftSchluessel, briefKosten, kostenVorschau, limitPruefen } from "./kampagne-logic";
import { CHARGE_MAX } from "./logic";
import { absender, AbverkaufFehler, einstellungen } from "./service";

// B34.3a Briefversand über einen Anbieter: PDF je Lead → Vorschau (Adressprüfung, Seiten) → Kostenvorschau →
// Freigabe der Charge (höchstens 20, Kostensumme bestätigt) → Übergabe an den Anbieter. Testbrief zuerst an die eigene
// Adresse. Live nur mit AV-Vertrag und nach einem Testbrief; Tageslimit und Gesamtbudget. Nie automatisch.

const A = schema.abverkaufAnschreiben;
const L = schema.abverkaufLeads;
const B = schema.abverkaufBriefe;
const SP = schema.abverkaufSperrliste;

const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
const tagesbeginn = () => new Date(`${heute()}T00:00:00+01:00`);

export type VorschauZeile = { anschreibenId: string; firma: string; ort: string; seiten: number; kosten: number | null; ok: boolean; fehler: string[]; hinweis: string | null; uebergeben: string | null };
export type VersandVorschau = {
  anbieter: BriefAnbieterName;
  anbieterName: string;
  zugang: boolean;
  modus: "test" | "live";
  avVertrag: boolean;
  testbrief: { am: Date; status: string } | null;
  zeilen: VorschauZeile[];
  summe: number | null;
  preisFehlt: boolean;
  limit: { ok: boolean; grund: string | null; heute: number; tageslimit: number; bisherKosten: number; budget: number | null };
  sperre: string | null;
};

async function zeilenDerCharge(tenantId: string, chargeId: string): Promise<BriefZeile[]> {
  return db.select({ a: A, l: L }).from(A).innerJoin(L, eq(L.id, A.leadId)).where(and(eq(A.tenantId, tenantId), eq(A.chargeId, chargeId), eq(A.kanal, "brief"), inArray(A.status, ["freigegeben", "versendet", "beantwortet"]))).orderBy(A.createdAt);
}

async function liveStand(tenantId: string) {
  const [h] = await db.select({ n: sql<number>`count(*)::int` }).from(B).where(and(eq(B.tenantId, tenantId), eq(B.modus, "live"), eq(B.testbrief, false), gte(B.createdAt, tagesbeginn())));
  const [k] = await db.select({ s: sql<number>`coalesce(sum(${B.kostenNetto}), 0)::float` }).from(B).where(and(eq(B.tenantId, tenantId), eq(B.modus, "live"), sql`${B.status} <> 'storniert'`));
  return { heute: h.n, bisherKosten: Math.round(k.s * 100) / 100 };
}

async function letzterTestbrief(tenantId: string, anbieter: BriefAnbieterName, modus: "test" | "live") {
  const [t] = await db.select().from(B).where(and(eq(B.tenantId, tenantId), eq(B.anbieter, anbieter), eq(B.modus, modus), eq(B.testbrief, true), sql`${B.status} not in ('fehler', 'storniert')`)).orderBy(desc(B.createdAt)).limit(1);
  return t ?? null;
}

export async function versandVorschau(tenantId: string, chargeId: string): Promise<VersandVorschau> {
  const cfg = await einstellungen(tenantId);
  const bv = cfg.briefversand;
  const modus = bv.live ? "live" : "test";
  const zeilen = await zeilenDerCharge(tenantId, chargeId);
  const gebaut = await briefeBauen(tenantId, zeilen, cfg, await absender(tenantId));
  const gesperrt = new Set((await db.select({ k: SP.schluessel }).from(SP).where(eq(SP.tenantId, tenantId))).map((x) => x.k));
  const schon = zeilen.length ? await db.select({ id: B.anschreibenId, status: B.status, modus: B.modus }).from(B).where(and(eq(B.tenantId, tenantId), inArray(B.anschreibenId, zeilen.map((z) => z.a.id)), eq(B.testbrief, false), sql`${B.status} not in ('fehler', 'storniert')`)) : [];
  const gesehen = new Set<string>();
  const preis = bv.preise[bv.anbieter];
  const out: VorschauZeile[] = zeilen.map((z, i) => {
    const g = gebaut[i];
    const seiten = 1 + (g.brief.beilage ? 1 : 0);
    const key = anschriftSchluessel({ firma: z.l.firma, strasse: g.adresse.strasse, plz: z.l.plz });
    const pr = adressePruefen({ firma: z.l.firma, strasse: g.adresse.strasse, plz: z.l.plz, ort: z.l.ort, land: z.l.land, status: z.l.status, rechtsgrundlage: z.l.rechtsgrundlage }, { gesperrt: gesperrt.has(z.l.schluessel), dublette: gesehen.has(key) });
    gesehen.add(key);
    const u = schon.find((x) => x.id === z.a.id && (x.modus === modus || x.modus === "live"));
    return { anschreibenId: z.a.id, firma: z.l.firma, ort: [z.l.plz, z.l.ort].filter(Boolean).join(" "), seiten, kosten: briefKosten(seiten, preis), ok: pr.ok && !u, fehler: pr.fehler, hinweis: g.hinweis, uebergeben: u ? `${u.modus === "test" ? "Testmodus" : "live"}: ${u.status}` : null };
  });
  const offen = out.filter((z) => z.ok);
  const kv = kostenVorschau(offen.map((z) => z.seiten), preis);
  const stand = await liveStand(tenantId);
  const limit = modus === "live" ? limitPruefen({ heute: stand.heute, tageslimit: bv.tageslimit, bisherKosten: stand.bisherKosten, budget: bv.budget, neu: offen.length, neuKosten: kv.summe ?? 0 }) : { ok: true, grund: null };
  const zugang = !!briefAnbieter(bv.anbieter, await getIntegration(tenantId, bv.anbieter));
  const tb = await letzterTestbrief(tenantId, bv.anbieter, modus);
  const sperre = !zugang
    ? `Zugangsdaten für ${ANBIETER_NAME[bv.anbieter]} fehlen (Anbindungen).`
    : kv.summe === null && offen.length
      ? `Preis je Brief für ${ANBIETER_NAME[bv.anbieter]} fehlt – unter Einstellungen eintragen.`
      : modus === "live" && !bv.avVertrag
        ? "Ohne bestätigten AV-Vertrag kein Live-Versand – Haken unter Einstellungen setzen oder im Testmodus bleiben."
        : !tb
          ? "Zuerst einen Testbrief an die eigene Adresse schicken."
          : !limit.ok
            ? limit.grund
            : !offen.length
              ? "Keine versandfähigen Briefe in dieser Charge."
              : null;
  return { anbieter: bv.anbieter, anbieterName: ANBIETER_NAME[bv.anbieter], zugang, modus, avVertrag: bv.avVertrag, testbrief: tb ? { am: tb.createdAt, status: tb.status } : null, zeilen: out, summe: kv.summe, preisFehlt: kv.summe === null && offen.length > 0, limit: { ...limit, ...stand, tageslimit: bv.tageslimit, budget: bv.budget }, sperre };
}

function pruefeRolle(s: Session) {
  if (s.readOnly) throw new AbverkaufFehler("Nur ansehen – nichts verschickt.");
  if (s.role !== "owner") throw new AbverkaufFehler("Nur der Inhaber gibt den Briefversand frei.");
}

async function anbieterFuer(tenantId: string) {
  const cfg = await einstellungen(tenantId);
  const bv = cfg.briefversand;
  const a = briefAnbieter(bv.anbieter, await getIntegration(tenantId, bv.anbieter));
  if (!a) throw new AbverkaufFehler(`Zugangsdaten für ${ANBIETER_NAME[bv.anbieter]} fehlen (Anbindungen).`);
  const modus: "test" | "live" = bv.live ? "live" : "test";
  if (modus === "live" && !bv.avVertrag) throw new AbverkaufFehler("Ohne bestätigten AV-Vertrag kein Live-Versand.");
  return { cfg, bv, a, modus };
}

/** Testbrief: der erste Brief der Charge an die eigene Absender-Adresse – zeigt Druckbild, Kosten und Statusrückmeldung. */
export async function testbriefSenden(s: Session, chargeId: string): Promise<string> {
  pruefeRolle(s);
  const { cfg, bv, a, modus } = await anbieterFuer(s.tenantId);
  const eigen = await absender(s.tenantId);
  if (!eigen.name || !eigen.strasse || !eigen.plz || !eigen.ort) throw new AbverkaufFehler("Eigene Absender-Adresse fehlt (Einstellungen → B2B-Deals → Firma).");
  const zeilen = (await zeilenDerCharge(s.tenantId, chargeId)).slice(0, 1);
  if (!zeilen.length) throw new AbverkaufFehler("Keine Briefe in dieser Charge.");
  const [g] = await briefeBauen(s.tenantId, zeilen, cfg, eigen);
  const brief = { ...g.brief, anschrift: [eigen.name, "Testbrief", eigen.strasse, [eigen.plz, eigen.ort].join(" ")], betreff: `TESTBRIEF – ${g.brief.betreff}` };
  const { serienbriefPdf } = await import("./pdf");
  const pdf = await serienbriefPdf({ absender: eigen, datum: new Date(), briefe: [brief] });
  const seiten = 1 + (brief.beilage ? 1 : 0);
  const r = await a.senden(pdf, { name: eigen.name, strasse: eigen.strasse, plz: eigen.plz, ort: eigen.ort, land: "DE" }, { modus, farbe: bv.farbe, duplex: bv.duplex, dateiname: `Testbrief_Charge.pdf`, seiten });
  await db.insert(B).values({ tenantId: s.tenantId, chargeId, anbieter: bv.anbieter, modus, testbrief: true, externeId: r.id, status: r.status, statusText: r.text, seiten, kostenNetto: r.kostenNetto ?? briefKosten(seiten, bv.preise[bv.anbieter]), freigegebenVon: s.userId, statusAm: new Date() });
  return `Testbrief an ${eigen.name} an ${ANBIETER_NAME[bv.anbieter]} übergeben (${modus === "test" ? "Testmodus – nichts gedruckt" : "live"}), Auftrag ${r.id}${r.kostenNetto !== null ? `, ${r.kostenNetto.toFixed(2).replace(".", ",")} € netto` : ""}.`;
}

/**
 * Freigabe der Charge: nur die geprüften Briefe, höchstens 20, die angezeigte Kostensumme muss bestätigt sein (sonst
 * hat sich etwas geändert). Jeder Brief einzeln als PDF an den Anbieter.
 */
export async function chargeVersenden(s: Session, chargeId: string, bestaetigteSumme: number): Promise<string> {
  pruefeRolle(s);
  const v = await versandVorschau(s.tenantId, chargeId);
  if (v.sperre) throw new AbverkaufFehler(v.sperre);
  if (v.summe === null || Math.abs(v.summe - bestaetigteSumme) > 0.004) throw new AbverkaufFehler(`Kostenvorschau hat sich geändert (jetzt ${v.summe === null ? "?" : v.summe.toFixed(2).replace(".", ",")} €) – bitte neu prüfen und bestätigen.`);
  const { cfg, bv, a, modus } = await anbieterFuer(s.tenantId);
  const ids = v.zeilen.filter((z) => z.ok).map((z) => z.anschreibenId).slice(0, CHARGE_MAX);
  const zeilen = (await zeilenDerCharge(s.tenantId, chargeId)).filter((z) => ids.includes(z.a.id));
  const gebaut = await briefeBauen(s.tenantId, zeilen, cfg, await absender(s.tenantId));
  const { serienbriefPdf } = await import("./pdf");
  const eigen = await absender(s.tenantId);
  let ok = 0;
  let summe = 0;
  const fehler: string[] = [];
  for (const g of gebaut) {
    const seiten = 1 + (g.brief.beilage ? 1 : 0);
    try {
      const pdf = await serienbriefPdf({ absender: eigen, datum: new Date(), briefe: [g.brief] });
      const r = await a.senden(pdf, g.adresse, { modus, farbe: bv.farbe, duplex: bv.duplex, dateiname: `${g.brief.code}.pdf`, seiten });
      const kosten = r.kostenNetto ?? briefKosten(seiten, bv.preise[bv.anbieter]);
      await db.insert(B).values({ tenantId: s.tenantId, anschreibenId: g.anschreibenId, chargeId, anbieter: bv.anbieter, modus, externeId: r.id, status: r.status, statusText: r.text, seiten, kostenNetto: kosten, freigegebenVon: s.userId, statusAm: new Date() });
      if (modus === "live") await db.update(A).set({ status: "versendet", versendetAm: new Date() }).where(and(eq(A.id, g.anschreibenId), eq(A.status, "freigegeben")));
      ok++;
      summe += kosten ?? 0;
    } catch (e) {
      fehler.push(`${g.adresse.name}: ${(e as Error).message.slice(0, 120)}`);
      await db.insert(B).values({ tenantId: s.tenantId, anschreibenId: g.anschreibenId, chargeId, anbieter: bv.anbieter, modus, status: "fehler", statusText: (e as Error).message.slice(0, 300), seiten, freigegebenVon: s.userId, statusAm: new Date() });
    }
  }
  if (modus === "live" && ok) await db.update(schema.abverkaufChargen).set({ versendetAm: new Date() }).where(and(eq(schema.abverkaufChargen.tenantId, s.tenantId), eq(schema.abverkaufChargen.id, chargeId)));
  return `${ok} Brief${ok === 1 ? "" : "e"} an ${ANBIETER_NAME[bv.anbieter]} übergeben (${modus === "test" ? "Testmodus – nichts gedruckt" : "live"}), ${summe.toFixed(2).replace(".", ",")} € netto${fehler.length ? ` · Fehler: ${fehler.join("; ")}` : ""}.`;
}

/** Status beim Anbieter abfragen (Knopf bzw. stündlich): angenommen → gedruckt → zugestellt / Fehler. */
export async function briefStatusAbrufen(tenantId: string): Promise<number> {
  const offen = await db.select().from(B).where(and(eq(B.tenantId, tenantId), inArray(B.status, ["uebergeben", "angenommen", "gedruckt"]), isNotNull(B.externeId))).limit(200);
  let n = 0;
  for (const b of offen) {
    const a = briefAnbieter(b.anbieter, await getIntegration(tenantId, b.anbieter));
    if (!a) continue;
    try {
      const st = await a.status(b.externeId!, b.modus);
      if (st.status !== b.status || st.text !== b.statusText) {
        await db.update(B).set({ status: st.status, statusText: st.text.slice(0, 300), statusAm: new Date(), ...(st.kostenNetto != null ? { kostenNetto: st.kostenNetto } : {}) }).where(eq(B.id, b.id));
        n++;
      }
    } catch (e) {
      await db.update(B).set({ statusText: `Status nicht abrufbar: ${(e as Error).message.slice(0, 200)}`, statusAm: new Date() }).where(eq(B.id, b.id));
    }
  }
  return n;
}

export async function briefStornieren(s: Session, id: string): Promise<string> {
  pruefeRolle(s);
  const [b] = await db.select().from(B).where(and(eq(B.tenantId, s.tenantId), eq(B.id, id)));
  if (!b?.externeId) throw new AbverkaufFehler("Brief nicht gefunden.");
  const a = briefAnbieter(b.anbieter, await getIntegration(s.tenantId, b.anbieter));
  if (!a) throw new AbverkaufFehler("Zugangsdaten fehlen.");
  await a.stornieren(b.externeId, b.modus);
  await db.update(B).set({ status: "storniert", statusText: "storniert", statusAm: new Date() }).where(eq(B.id, b.id));
  return "Brief storniert.";
}

export async function briefeDerCharge(tenantId: string, chargeId: string) {
  return db.select({ b: B, firma: L.firma }).from(B).leftJoin(A, eq(A.id, B.anschreibenId)).leftJoin(L, eq(L.id, A.leadId)).where(and(eq(B.tenantId, tenantId), eq(B.chargeId, chargeId))).orderBy(B.createdAt);
}

/** Kosten je Charge (nur live, ohne Stornos und Testbriefe) für die Erfolgskontrolle. */
export async function kostenJeCharge(tenantId: string): Promise<Map<string, number>> {
  const r = await db.select({ c: B.chargeId, s: sql<number>`coalesce(sum(${B.kostenNetto}), 0)::float` }).from(B).where(and(eq(B.tenantId, tenantId), eq(B.modus, "live"), eq(B.testbrief, false), sql`${B.status} <> 'storniert'`)).groupBy(B.chargeId);
  return new Map(r.filter((x) => x.c).map((x) => [x.c!, Math.round(x.s * 100) / 100]));
}
