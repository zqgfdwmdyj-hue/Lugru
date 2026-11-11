import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { openPii, sealPii } from "@/lib/pii";
import { chargeSperre, domainAus, dublettenGruppen, dublettenSchluessel, leadBewerten, leadsMorgenZeile, plusMonateIso, rechtsformAus, registerAus, registerText, ustNorm, ZIEL_TEXT, ZIEL_ZIELGRUPPE, type BestandEintrag, type BewertungKontext, type LeadZiel } from "./lead-maschine-logic";
import { leadSchluessel, mailSchluessel, quelleSperre, RECHTSGRUNDLAGE_BRIEF, ZWECK, type LeadEingabe, type LeadQuelleTyp } from "./logic";

// B35 Lead-Maschine (Stufe 1): Leads speichern (Dubletten zusammenführen, Sperrliste, Quelle/Datum/Rechtsgrundlage/
// Löschdatum), Bestandsabgleich und Bewertung, Charge vorbereiten (nur Entwürfe – Versand nur nach Freigabe),
// Auskunft und Löschen je Lead, Morgenbericht. Werbe-E-Mails an Leads gibt es nicht (`mailErlaubt`).

const L = schema.abverkaufLeads;
const SP = schema.abverkaufSperrliste;
const A = schema.abverkaufAnschreiben;
const R = schema.abverkaufLeadLaeufe;
export class LeadMaschineFehler extends Error {}

const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
const plusTage = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const eintrag = (was: string) => ({ am: new Date().toISOString(), was: was.slice(0, 300) });
const VERLAUF_MAX = 60;

// ---- Bestand und Bewertung --------------------------------------------------------------------------------------

/** Bestandsdaten für den Abgleich: eigene Lieferanten, Kunden (B2B, Rechnung), Palettenkunden, eigene Sperrnamen. */
export async function bestandLaden(tenantId: string, sperrNamen: string[]): Promise<BestandEintrag[]> {
  const S = schema.suppliers;
  const SL = schema.supplierLeads;
  const [lief, kontakte, b2b, palette, kunden] = await Promise.all([
    db.select({ name: S.name, code: S.code }).from(S).where(and(eq(S.tenantId, tenantId), eq(S.skuKuerzel, false))),
    db.select({ name: SL.companyName, ust: SL.vatId, web: SL.website }).from(SL).where(and(eq(SL.tenantId, tenantId), sql`(${SL.supplierId} is not null or ${SL.status} in ('antwort','preisliste','abgeschlossen'))`)),
    db.select({ name: schema.b2bKunden.firma, ust: schema.b2bKunden.ustId }).from(schema.b2bKunden).where(eq(schema.b2bKunden.tenantId, tenantId)),
    db.select({ name: schema.palletCustomers.name }).from(schema.palletCustomers).where(eq(schema.palletCustomers.tenantId, tenantId)),
    db.select({ name: schema.customers.name, ust: schema.customers.vatId }).from(schema.customers).where(eq(schema.customers.tenantId, tenantId)),
  ]);
  return [
    ...lief.filter((x) => (x.name ?? "").trim().length >= 3).map((x) => ({ art: "lieferant" as const, name: x.name! })),
    ...kontakte.map((x) => ({ art: "lieferant" as const, name: x.name, ustId: x.ust, domain: x.web })),
    ...b2b.map((x) => ({ art: "b2b_kunde" as const, name: x.name, ustId: x.ust })),
    ...palette.map((x) => ({ art: "palettenkunde" as const, name: x.name })),
    ...kunden.map((x) => ({ art: "kunde" as const, name: x.name, ustId: x.ust })),
    ...sperrNamen.filter((n) => n.trim().length >= 3).map((n) => ({ art: "sperrname" as const, name: n.trim() })),
  ];
}

export async function bewertungsKontext(tenantId: string): Promise<BewertungKontext> {
  const { einstellungen, kandidaten } = await import("./service");
  const cfg = await einstellungen(tenantId);
  const q = cfg.leadQuellen;
  const [ladenhueter, bestand] = await Promise.all([kandidaten(tenantId).catch(() => []), bestandLaden(tenantId, q.sperrNamen)]);
  return {
    heute: heute(),
    lager: cfg.lager.lat !== null && cfg.lager.lng !== null ? { lat: cfg.lager.lat, lng: cfg.lager.lng } : null,
    ladenhueter: ladenhueter.map((k) => ({ titel: k.titel, kapital: k.kapital })),
    bestand,
    adelprepAbStueck: q.adelprepAbStueck,
    konfliktbranchen: q.konfliktbranchen,
    grossmarken: q.grossmarken,
    lagerbedingungen: q.lagerbedingungen,
    umkreisLokalKm: q.umkreisLokalKm,
    umkreisLagerKm: q.umkreisLagerKm,
  };
}

/** Leads (alle oder eine Auswahl) neu bewerten und speichern. Ausschluss wird im Verlauf vermerkt. */
export async function leadsBewerten(tenantId: string, ids?: string[]): Promise<{ bewertet: number; ausgeschlossen: number }> {
  const ctx = await bewertungsKontext(tenantId);
  const zeilen = await db.select().from(L).where(ids ? and(eq(L.tenantId, tenantId), inArray(L.id, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])) : eq(L.tenantId, tenantId)).limit(5000);
  let ausgeschlossen = 0;
  for (const l of zeilen) {
    const b = leadBewerten({ ...l, strasse: l.strasse ? openPii(l.strasse) : null }, ctx);
    if (b.ausschluss) ausgeschlossen++;
    const neuAusschluss = b.ausschluss && b.ausschluss !== l.ausschluss;
    await db
      .update(L)
      .set({ punkte: b.punkte, prioritaet: b.prioritaet, empfZiel: b.empfZiel, empfBeilage: b.empfBeilage, markierungen: b.markierungen, ausschluss: b.ausschluss, rechtsform: l.rechtsform ?? b.rechtsform, bewertetAm: new Date(), ...(neuAusschluss ? { verlauf: [...l.verlauf, eintrag(`Ausgeschlossen: ${b.ausschluss}`)].slice(-VERLAUF_MAX) } : {}) })
      .where(eq(L.id, l.id));
  }
  return { bewertet: zeilen.length, ausgeschlossen };
}

// ---- Speichern (Import aus Datei, Apify, Places, Lieferantensuche) --------------------------------------------------

export type SpeichernErgebnis = { neu: number; doppelt: number; zusammengefuehrt: number; gesperrt: number; ids: string[] };

/**
 * Leads speichern: Dubletten in der Lieferung zusammenführen (Name+PLZ, Website, USt-IdNr., Handelsregister), dann
 * gegen vorhandene Leads abgleichen (leere Felder ergänzen statt doppelt anlegen), Sperrliste prüfen, Quelle,
 * Abrufdatum, Rechtsgrundlage und Löschdatum je Datensatz eintragen, danach bewerten.
 */
export async function leadsSpeichern(tenantId: string, eingang: LeadEingabe[], o: { quelle: string; quelleDatum: string; quelleTyp: LeadQuelleTyp | "places" | "lieferantensuche"; importName?: string | null }): Promise<SpeichernErgebnis> {
  const { einstellungen } = await import("./service");
  const cfg = await einstellungen(tenantId);
  // 1. Dubletten in der Lieferung
  const gruppen = dublettenGruppen(eingang);
  let zusammengefuehrt = 0;
  const leads: LeadEingabe[] = gruppen.map((g) => {
    let basis = { ...eingang[g[0]] };
    for (const i of g.slice(1)) {
      zusammengefuehrt++;
      for (const [k, v] of Object.entries(eingang[i])) if ((basis as Record<string, unknown>)[k] === null || (basis as Record<string, unknown>)[k] === "" || (basis as Record<string, unknown>)[k] === undefined) basis = { ...basis, [k]: v };
    }
    return basis;
  });
  // 2. Vorhandene Leads (Schlüssel) und Sperrliste
  const vorhanden = await db.select({ id: L.id, firma: L.firma, plz: L.plz, website: L.website, ustId: L.ustId, registerNr: L.registerNr }).from(L).where(eq(L.tenantId, tenantId));
  const schluesselZuId = new Map<string, string>();
  for (const v of vorhanden) for (const k of dublettenSchluessel(v)) if (!schluesselZuId.has(k)) schluesselZuId.set(k, v.id);
  const gesperrt = new Set((await db.select({ k: SP.schluessel }).from(SP).where(eq(SP.tenantId, tenantId))).map((x) => x.k));
  const loeschenAm = plusTage(o.quelleDatum <= heute() ? heute() : o.quelleDatum, cfg.loeschfristTage);
  let neu = 0;
  let doppelt = 0;
  let sperre = 0;
  const ids: string[] = [];
  for (const l of leads) {
    const key = leadSchluessel(l.firma, l.plz);
    if (gesperrt.has(key) || (l.email && gesperrt.has(mailSchluessel(l.email)))) {
      sperre++;
      continue;
    }
    const reg = registerAus(l.registerNr);
    const felder = {
      strasse: l.strasse ? sealPii(l.strasse) : null,
      plz: l.plz,
      ort: l.ort,
      kategorie: l.kategorie,
      email: l.email ? sealPii(l.email) : null,
      emailQuelle: l.emailQuelle,
      website: l.website,
      lat: l.lat,
      lng: l.lng,
      groesse: l.groesse,
      stueckJeArtikel: l.stueckJeArtikel,
      rechtsform: rechtsformAus(l.firma),
      domain: domainAus(l.website),
      ustId: ustNorm(l.ustId),
      registerNr: reg ? registerText(reg) : (l.registerNr?.trim() || null),
      marken: l.marken,
      mitarbeiter: l.mitarbeiter,
      anzahlAsins: l.anzahlAsins,
      letzteAktivitaet: l.letzteAktivitaet,
      impressumUrl: l.impressumUrl,
    };
    const treffer = dublettenSchluessel({ ...l, ustId: felder.ustId }).map((k) => schluesselZuId.get(k)).find(Boolean);
    if (treffer) {
      // Vorhandenen Datensatz ergänzen (nichts überschreiben) – Quelle im Verlauf
      const [alt] = await db.select().from(L).where(eq(L.id, treffer));
      const ergaenzt: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(felder)) if (v !== null && v !== undefined && v !== "" && ((alt as Record<string, unknown>)[k] === null || (alt as Record<string, unknown>)[k] === "")) ergaenzt[k] = v;
      if (l.adelprep && !alt.adelprep) ergaenzt.adelprep = true;
      await db.update(L).set({ ...ergaenzt, verlauf: [...alt.verlauf, eintrag(`Zusammengeführt mit ${o.quelle}${Object.keys(ergaenzt).length ? ` (ergänzt: ${Object.keys(ergaenzt).join(", ")})` : ""}`)].slice(-VERLAUF_MAX) }).where(eq(L.id, treffer));
      doppelt++;
      ids.push(treffer);
      continue;
    }
    const [ins] = await db
      .insert(L)
      .values({ tenantId, firma: l.firma, land: l.land, quelle: o.quelle.slice(0, 200), quelleDatum: o.quelleDatum, quelleTyp: o.quelleTyp, kontaktweg: "brief", rechtsgrundlage: RECHTSGRUNDLAGE_BRIEF, zweck: ZWECK, loeschenAm, schluessel: key, importName: o.importName?.slice(0, 200) ?? null, adelprep: l.adelprep, ...felder, verlauf: [eintrag(`Gefunden: ${o.quelle} (Stand ${o.quelleDatum.split("-").reverse().join(".")})${l.impressumUrl ? ` · Impressum ${l.impressumUrl}` : ""}`)] })
      .onConflictDoNothing()
      .returning({ id: L.id });
    if (ins) {
      neu++;
      ids.push(ins.id);
      for (const k of dublettenSchluessel({ ...l, ustId: felder.ustId })) if (!schluesselZuId.has(k)) schluesselZuId.set(k, ins.id);
    } else doppelt++;
  }
  if (ids.length) await leadsBewerten(tenantId, [...new Set(ids)]);
  return { neu, doppelt, zusammengefuehrt, gesperrt: sperre, ids };
}

export async function laufProtokoll(tenantId: string, o: { quelle: (typeof R.$inferInsert)["quelle"]; status: (typeof R.$inferInsert)["status"]; neu?: number; zusammengefuehrt?: number; verworfen?: number; kosten?: number; waehrung?: string; budget?: number | null; meldung?: string }) {
  const [r] = await db
    .insert(R)
    .values({ tenantId, quelle: o.quelle, status: o.status, neu: o.neu ?? 0, zusammengefuehrt: o.zusammengefuehrt ?? 0, verworfen: o.verworfen ?? 0, kosten: o.kosten ?? 0, waehrung: o.waehrung ?? "EUR", budget: o.budget ?? null, meldung: o.meldung?.slice(0, 1000) ?? null, beendetAm: o.status === "laeuft" ? null : new Date() })
    .returning({ id: R.id });
  return r.id;
}

export async function laeufe(tenantId: string, limit = 30) {
  return db.select().from(R).where(eq(R.tenantId, tenantId)).orderBy(desc(R.gestartetAm)).limit(limit);
}

/** Kosten der Quellen im laufenden Monat (je Quelle und Währung). */
export async function monatsKosten(tenantId: string, quelle?: string): Promise<number> {
  const monat = `${heute().slice(0, 7)}-01`;
  const [r] = await db
    .select({ s: sql<number>`coalesce(sum(${R.kosten}), 0)::float` })
    .from(R)
    .where(and(eq(R.tenantId, tenantId), sql`${R.gestartetAm} >= ${monat}::date`, quelle ? eq(R.quelle, quelle as (typeof R.$inferSelect)["quelle"]) : sql`true`));
  return r.s;
}

// ---- Lieferantensuche übernehmen (vorhandene Firmensuche: LUCID, Amazon/eBay, GPSR, Web) ------------------------------

/** Firmen aus „Lieferanten finden“ als Leads übernehmen – ohne bereits kontaktierte/verknüpfte Lieferanten. */
export async function ausLieferantensuche(s: Session): Promise<SpeichernErgebnis & { gefunden: number }> {
  if (s.readOnly) throw new LeadMaschineFehler("Nur ansehen – nichts geändert.");
  const SL = schema.supplierLeads;
  const rows = await db
    .select()
    .from(SL)
    .where(and(eq(SL.tenantId, s.tenantId), sql`${SL.supplierId} is null`, sql`${SL.status} not in ('antwort','preisliste','abgeschlossen','kein_interesse','ausgeschlossen')`, sql`${SL.kind} not in ('privat','marktplatz')`))
    .limit(2000);
  const eingang: LeadEingabe[] = rows
    .filter((r) => (r.zip && r.city) || r.website)
    .map((r) => ({
      firma: r.companyName,
      strasse: r.street,
      plz: r.zip,
      ort: r.city,
      land: (r.country && /^[A-Za-z]{2}$/.test(r.country) ? r.country : "DE").toUpperCase(),
      kategorie: { grosshandel: "Großhandel", haendler: "Händler", hersteller: "Hersteller", salon: "Salon", marktplatz: "Marktplatz", privat: "", unklar: "" }[r.kind] || null,
      email: r.email,
      emailQuelle: r.email ? "Website/Impressum (Lieferantensuche)" : null,
      website: r.website,
      adelprep: false,
      lat: null,
      lng: null,
      groesse: null,
      stueckJeArtikel: null,
      ustId: r.vatId,
      registerNr: null,
      marken: (r.brands ?? r.searchBrands).slice(0, 20).join(", ") || null,
      mitarbeiter: null,
      anzahlAsins: null,
      letzteAktivitaet: null,
      impressumUrl: r.contactUrl,
    }));
  const nurLucid = new Set(rows.filter((r) => r.findings.length > 0 && r.findings.every((f) => f.source === "lucid")).map((r) => r.companyName));
  const lucid = eingang.filter((e) => nurLucid.has(e.firma));
  const andere = eingang.filter((e) => !nurLucid.has(e.firma));
  const quelleDatum = heute();
  const a = await leadsSpeichern(s.tenantId, andere, { quelle: "Lieferantensuche (Amazon/eBay/GPSR/Web)", quelleDatum, quelleTyp: "lieferantensuche" });
  const b = await leadsSpeichern(s.tenantId, lucid, { quelle: "Lieferantensuche (LUCID-Register)", quelleDatum, quelleTyp: "lucid" });
  const erg = { neu: a.neu + b.neu, doppelt: a.doppelt + b.doppelt, zusammengefuehrt: a.zusammengefuehrt + b.zusammengefuehrt, gesperrt: a.gesperrt + b.gesperrt, ids: [...a.ids, ...b.ids], gefunden: eingang.length };
  await laufProtokoll(s.tenantId, { quelle: "lieferantensuche", status: "fertig", neu: erg.neu, zusammengefuehrt: erg.doppelt + erg.zusammengefuehrt, meldung: `${eingang.length} Firmen aus der Lieferantensuche geprüft` });
  return erg;
}

// ---- Charge vorbereiten (nur Entwürfe – Freigabe nötig) ---------------------------------------------------------------

/** Letzter Brief je Lead (aus dem Feld und aus versendeten Anschreiben). */
async function letzteBriefe(tenantId: string): Promise<Map<string, string>> {
  const rows = await db.select({ lead: A.leadId, am: sql<string>`max((${A.versendetAm} at time zone 'Europe/Berlin')::date)::text` }).from(A).where(and(eq(A.tenantId, tenantId), inArray(A.status, ["versendet", "beantwortet"]), sql`${A.versendetAm} is not null`)).groupBy(A.leadId);
  return new Map(rows.map((r) => [r.lead, r.am]));
}

export type ChargeKandidat = { id: string; firma: string; ort: string; prioritaet: number; empfZiel: LeadZiel | null; adelprep: boolean; sperre: string | null };

/** Kandidaten für die nächste Charge (beste zuerst) mit Sperrgrund je Lead. */
export async function chargeKandidaten(tenantId: string): Promise<ChargeKandidat[]> {
  const { einstellungen } = await import("./service");
  const cfg = await einstellungen(tenantId);
  const [rows, briefe, offen] = await Promise.all([
    db.select().from(L).where(eq(L.tenantId, tenantId)).orderBy(desc(L.prioritaet), L.firma).limit(3000),
    letzteBriefe(tenantId),
    db.select({ lead: A.leadId }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.status, "entwurf"))),
  ]);
  const offeneLeads = new Set(offen.map((x) => x.lead));
  const h = heute();
  return rows.map((l) => {
    const strasse = l.strasse ? openPii(l.strasse) : null;
    const letzter = [l.letzterBriefAm, briefe.get(l.id) ?? null].filter(Boolean).sort().pop() ?? null;
    const sperre = chargeSperre({ status: l.status, rechtsgrundlage: l.rechtsgrundlage, ausschluss: l.ausschluss, markierungen: l.markierungen, erreichbar: !!(strasse?.trim() && l.plz?.trim() && l.ort?.trim()), letzterBriefAm: letzter, prioritaet: l.prioritaet, quelleGesperrt: quelleSperre(l, cfg.leadQuellen), offenerEntwurf: offeneLeads.has(l.id) }, { heute: h, mindestabstandMonate: cfg.leadQuellen.mindestabstandMonate, standard: true });
    return { id: l.id, firma: l.firma, ort: [l.plz, l.ort].filter(Boolean).join(" "), prioritaet: l.prioritaet, empfZiel: (l.empfZiel as LeadZiel | null) ?? null, adelprep: l.adelprep, sperre };
  });
}

/**
 * Charge vorbereiten: die besten N Leads ohne Sperre, gruppiert nach empfohlener Kampagne. Erstellt nur Entwürfe
 * (Brief mit passender Kampagne bzw. Preisliste, AdelPrep-Beilage nur bei „Zielgruppe AdelPrep“). Freigabe und
 * Versand bleiben beim Inhaber.
 */
export async function chargeVorbereiten(s: Session, anzahl: number): Promise<{ entwuerfe: number; text: string }> {
  if (s.readOnly) throw new LeadMaschineFehler("Nur ansehen – nichts geändert.");
  const { CHARGE_MAX } = await import("./logic");
  const n = Math.max(1, Math.min(CHARGE_MAX, Math.round(anzahl) || CHARGE_MAX));
  await leadsBewerten(s.tenantId);
  const kandidaten = (await chargeKandidaten(s.tenantId)).filter((k) => !k.sperre && k.empfZiel).slice(0, n);
  if (!kandidaten.length) throw new LeadMaschineFehler("Keine passenden Leads ohne Sperre – erst Leads importieren bzw. Kampagnen anlegen.");
  const { kampagnenListe, kampagneEntwuerfe } = await import("./kampagnen");
  const { entwuerfeErstellen, letztePreislisten } = await import("./service");
  const kampagnen = (await kampagnenListe(s.tenantId)).filter((k) => k.aktiv);
  const start = new Date(Date.now() - 1000);
  const hinweise: string[] = [];
  const gruppen = new Map<LeadZiel, ChargeKandidat[]>();
  for (const k of kandidaten) gruppen.set(k.empfZiel!, [...(gruppen.get(k.empfZiel!) ?? []), k]);
  for (const [ziel, liste] of gruppen) {
    const zg = ZIEL_ZIELGRUPPE[ziel];
    const kamp = kampagnen.find((k) => k.zielgruppe === zg);
    try {
      if (kamp) await kampagneEntwuerfe(s, kamp.id, liste.map((x) => x.id));
      else if (zg === "amazon_haendler") {
        const [pl] = await letztePreislisten(s.tenantId, 1);
        if (!pl) {
          hinweise.push(`${ZIEL_TEXT[ziel]}: keine Preisliste – ${liste.length} Lead(s) ohne Entwurf`);
          continue;
        }
        await entwuerfeErstellen(s, liste.map((x) => x.id), pl.id);
      } else hinweise.push(`${ZIEL_TEXT[ziel]}: keine aktive Kampagne – ${liste.length} Lead(s) ohne Entwurf (Kampagne anlegen)`);
    } catch (e) {
      hinweise.push(`${ZIEL_TEXT[ziel]}: ${e instanceof Error ? e.message : "Fehler"}`);
    }
  }
  // Beilage nur bei „Zielgruppe AdelPrep“ (je Brief abwählbar), Verlauf je Lead
  const neue = await db.select({ id: A.id, lead: A.leadId, kampagneId: A.kampagneId }).from(A).where(and(eq(A.tenantId, s.tenantId), eq(A.status, "entwurf"), gte(A.createdAt, start), inArray(A.leadId, kandidaten.map((k) => k.id))));
  const logistik = new Set(kampagnen.filter((k) => k.zielgruppe === "adelprep_lager").map((k) => k.id));
  for (const a of neue) {
    const k = kandidaten.find((x) => x.id === a.lead)!;
    await db.update(A).set({ adelprepBeilage: k.adelprep && !(a.kampagneId && logistik.has(a.kampagneId)) }).where(eq(A.id, a.id));
    await db.update(L).set({ verlauf: sql`(${L.verlauf} || ${JSON.stringify([eintrag(`Entwurf vorbereitet (Charge, ${ZIEL_TEXT[k.empfZiel!]})`)])}::jsonb)` }).where(eq(L.id, a.lead));
  }
  await laufProtokoll(s.tenantId, { quelle: "charge", status: "fertig", neu: neue.length, meldung: `Charge vorbereitet: ${neue.length} Entwürfe${hinweise.length ? ` · ${hinweise.join(" · ")}` : ""}` });
  return { entwuerfe: neue.length, text: `${neue.length} Entwürfe für die nächste Charge vorbereitet – nichts verschickt, Freigabe nötig.${hinweise.length ? ` ${hinweise.join(" · ")}` : ""}` };
}

// ---- Kontakt merken (Löschfrist, Mindestabstand), Auskunft, Löschen -------------------------------------------------

/** Brief versendet oder Antwort erhalten: Datum merken (Mindestabstand), Löschfrist neu ab heute, Verlauf. */
export async function kontaktMerken(tenantId: string, leadIds: string[], was: string, brief: boolean) {
  if (!leadIds.length) return;
  const { einstellungen } = await import("./service");
  const cfg = await einstellungen(tenantId);
  const h = heute();
  await db
    .update(L)
    .set({ ...(brief ? { letzterBriefAm: h } : {}), loeschenAm: plusTage(h, cfg.loeschfristTage), verlauf: sql`(${L.verlauf} || ${JSON.stringify([eintrag(was)])}::jsonb)` })
    .where(and(eq(L.tenantId, tenantId), inArray(L.id, [...new Set(leadIds)])));
}

/** Auskunft (Art. 15 DSGVO): alle zu einem Lead gespeicherten Daten als JSON. */
export async function leadAuskunft(tenantId: string, id: string) {
  const [l] = await db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.id, id)));
  if (!l) return null;
  const anschreiben = await db.select({ code: A.code, betreff: A.betreff, kanal: A.kanal, status: A.status, erstellt: A.createdAt, versendetAm: A.versendetAm }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.leadId, id)));
  const briefe = await db.select({ status: schema.abverkaufBriefe.status, anbieter: schema.abverkaufBriefe.anbieter, am: schema.abverkaufBriefe.createdAt }).from(schema.abverkaufBriefe).innerJoin(A, eq(A.id, schema.abverkaufBriefe.anschreibenId)).where(and(eq(A.tenantId, tenantId), eq(A.leadId, id)));
  return {
    erstellt: new Date().toISOString(),
    hinweis: "Auskunft nach Art. 15 DSGVO – gespeicherte Daten zu diesem Unternehmen/dieser Person.",
    stammdaten: { firma: l.firma, rechtsform: l.rechtsform, strasse: l.strasse ? openPii(l.strasse) : null, plz: l.plz, ort: l.ort, land: l.land, kategorie: l.kategorie, website: l.website, email: l.email ? openPii(l.email) : null, emailQuelle: l.emailQuelle, ustId: l.ustId, registerNr: l.registerNr, impressumUrl: l.impressumUrl },
    herkunft: { quelle: l.quelle, abrufdatum: l.quelleDatum, rechtsgrundlage: l.rechtsgrundlage, zweck: l.zweck, loeschenAm: l.loeschenAm },
    bewertung: { prioritaet: l.prioritaet, empfohleneKampagne: l.empfZiel, punkte: l.punkte, markierungen: l.markierungen, ausschluss: l.ausschluss },
    status: l.status,
    verlauf: l.verlauf,
    anschreiben,
    briefe,
  };
}

/**
 * Löschen mit einem Klick (Inhaber): Lead, offene Entwürfe und Briefe; Texte versendeter Anschreiben werden geleert
 * (Kosten/Umsatz bleiben anonym). War der Lead gesperrt (Widerspruch), bleibt nur die Prüfsumme auf der Sperrliste.
 */
export async function leadLoeschenKomplett(s: Session, id: string) {
  if (s.role !== "owner" || s.readOnly) throw new LeadMaschineFehler("Nur der Inhaber löscht Leads.");
  const [l] = await db.select().from(L).where(and(eq(L.tenantId, s.tenantId), eq(L.id, id)));
  if (!l) throw new LeadMaschineFehler("Lead nicht gefunden.");
  const alle = await db.select({ id: A.id, status: A.status }).from(A).where(and(eq(A.tenantId, s.tenantId), eq(A.leadId, id)));
  const offen = alle.filter((a) => ["entwurf", "gesperrt", "freigegeben"].includes(a.status)).map((a) => a.id);
  const erledigt = alle.filter((a) => !offen.includes(a.id)).map((a) => a.id);
  if (offen.length) {
    await db.delete(schema.abverkaufBriefe).where(and(eq(schema.abverkaufBriefe.tenantId, s.tenantId), inArray(schema.abverkaufBriefe.anschreibenId, offen)));
    await db.delete(A).where(and(eq(A.tenantId, s.tenantId), inArray(A.id, offen)));
  }
  if (erledigt.length) await db.update(A).set({ betreff: "[gelöscht]", text: "[gelöscht]" }).where(and(eq(A.tenantId, s.tenantId), inArray(A.id, erledigt)));
  await db.delete(L).where(and(eq(L.tenantId, s.tenantId), eq(L.id, id)));
  return { firma: l.firma, gesperrt: l.status === "gesperrt" };
}

// ---- Berichte -------------------------------------------------------------------------------------------------

export async function leadsWoche(tenantId: string) {
  const seit = new Date(Date.now() - 7 * 86_400_000);
  const AN = schema.abverkaufAnfragen;
  const [[neu], [entw], [rueck], [anfr], kosten, briefKosten] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(L).where(and(eq(L.tenantId, tenantId), gte(L.createdAt, seit))),
    db.select({ n: sql<number>`count(*)::int` }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.status, "entwurf"))),
    db.select({ n: sql<number>`count(*)::int` }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.status, "beantwortet"), sql`${A.antwortAm} >= ${seit.toISOString()}::timestamptz`)),
    db.select({ n: sql<number>`count(*)::int` }).from(AN).where(and(eq(AN.tenantId, tenantId), gte(AN.createdAt, seit))),
    monatsKosten(tenantId),
    db.select({ s: sql<number>`coalesce(sum(${schema.abverkaufBriefe.kostenNetto}), 0)::float` }).from(schema.abverkaufBriefe).where(and(eq(schema.abverkaufBriefe.tenantId, tenantId), eq(schema.abverkaufBriefe.modus, "live"), sql`${schema.abverkaufBriefe.status} <> 'storniert'`, sql`${schema.abverkaufBriefe.createdAt} >= date_trunc('month', now())`)),
  ]);
  return { neu7: neu.n, entwuerfe: entw.n, ruecklauf7: rueck.n, anfragen7: anfr.n, kostenQuellenMonat: kosten, kostenBriefeMonat: briefKosten[0].s };
}

export async function leadsMorgen(tenantId: string): Promise<string | null> {
  const w = await leadsWoche(tenantId);
  return leadsMorgenZeile({ neu7: w.neu7, entwuerfe: w.entwuerfe, kostenMonat: w.kostenQuellenMonat + w.kostenBriefeMonat, anfragen7: w.anfragen7, ruecklauf7: w.ruecklauf7 });
}

/** Kennzahlen: Kosten je Lead (Quellen), Kosten je Rücklauf (Briefe), Umsatz je Kampagne. */
export async function leadKennzahlen(tenantId: string) {
  const K = schema.abverkaufKampagnen;
  const [[quellen], [leadsAnz], [briefe], [antworten], umsatz] = await Promise.all([
    db.select({ s: sql<number>`coalesce(sum(${R.kosten}), 0)::float` }).from(R).where(eq(R.tenantId, tenantId)),
    db.select({ n: sql<number>`count(*)::int` }).from(L).where(eq(L.tenantId, tenantId)),
    db.select({ s: sql<number>`coalesce(sum(${schema.abverkaufBriefe.kostenNetto}), 0)::float` }).from(schema.abverkaufBriefe).where(and(eq(schema.abverkaufBriefe.tenantId, tenantId), eq(schema.abverkaufBriefe.modus, "live"), sql`${schema.abverkaufBriefe.status} <> 'storniert'`, eq(schema.abverkaufBriefe.testbrief, false))),
    db.select({ n: sql<number>`count(*)::int` }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.status, "beantwortet"))),
    db.select({ kampagne: sql<string>`coalesce(${K.name}, 'Abverkauf (Preisliste)')`, umsatz: sql<number>`coalesce(sum(${A.umsatz}), 0)::float`, briefe: sql<number>`count(*)::int`, antworten: sql<number>`count(*) filter (where ${A.status} = 'beantwortet')::int` }).from(A).leftJoin(K, eq(K.id, A.kampagneId)).where(and(eq(A.tenantId, tenantId), inArray(A.status, ["versendet", "beantwortet"]))).groupBy(sql`coalesce(${K.name}, 'Abverkauf (Preisliste)')`),
  ]);
  return {
    kostenJeLead: leadsAnz.n ? quellen.s / leadsAnz.n : null,
    kostenJeRuecklauf: antworten.n ? briefe.s / antworten.n : null,
    quellenKosten: quellen.s,
    briefKosten: briefe.s,
    umsatzJeKampagne: umsatz,
  };
}

// ---- Seite „Leads“ ----------------------------------------------------------------------------------------------

export type LeadFilterSeite = { ziel?: string; quelle?: string; status?: string; prio?: number | null; umkreisKm?: number | null; nurSperre?: boolean; suche?: string };
export type LeadZeile = ChargeKandidat & { plz: string | null; quelle: string; quelleTyp: string | null; quelleDatum: string; status: string; markierungen: string[]; ausschluss: string | null; km: number | null; lat: number | null; lng: number | null; letzterBriefAm: string | null; loeschenAm: string };

/** Leads mit Bewertung, Sperrgrund und Entfernung zum Lager – gefiltert für die Seite „Leads“. */
export async function leadsSeite(tenantId: string, f: LeadFilterSeite): Promise<{ zeilen: LeadZeile[]; gesamt: number; lager: { lat: number; lng: number } | null }> {
  const { einstellungen } = await import("./service");
  const { entfernungKm } = await import("./kampagne-logic");
  const cfg = await einstellungen(tenantId);
  const lager = cfg.lager.lat !== null && cfg.lager.lng !== null ? { lat: cfg.lager.lat, lng: cfg.lager.lng } : null;
  const [kand, rows] = await Promise.all([chargeKandidaten(tenantId), db.select({ id: L.id, plz: L.plz, quelle: L.quelle, quelleTyp: L.quelleTyp, quelleDatum: L.quelleDatum, status: L.status, markierungen: L.markierungen, ausschluss: L.ausschluss, lat: L.lat, lng: L.lng, letzterBriefAm: L.letzterBriefAm, loeschenAm: L.loeschenAm, kategorie: L.kategorie }).from(L).where(eq(L.tenantId, tenantId)).limit(3000)]);
  const by = new Map(rows.map((r) => [r.id, r]));
  const suche = f.suche?.trim().toLowerCase() ?? "";
  const zeilen: LeadZeile[] = [];
  for (const k of kand) {
    const r = by.get(k.id);
    if (!r) continue;
    const km = lager && r.lat !== null && r.lng !== null ? Math.round(entfernungKm(lager, { lat: r.lat, lng: r.lng })) : null;
    const z: LeadZeile = { ...k, plz: r.plz, quelle: r.quelle, quelleTyp: r.quelleTyp, quelleDatum: r.quelleDatum, status: r.status, markierungen: r.markierungen ?? [], ausschluss: r.ausschluss, km, lat: r.lat, lng: r.lng, letzterBriefAm: r.letzterBriefAm, loeschenAm: r.loeschenAm };
    if (f.ziel && (f.ziel === "-" ? z.empfZiel !== null : z.empfZiel !== f.ziel)) continue;
    if (f.quelle && (r.quelleTyp ?? "csv") !== f.quelle) continue;
    if (f.status && r.status !== f.status) continue;
    if (f.prio !== null && f.prio !== undefined && z.prioritaet < f.prio) continue;
    if (f.umkreisKm && (km === null || km > f.umkreisKm)) continue;
    if (f.nurSperre && !z.sperre) continue;
    if (suche && !`${z.firma} ${z.ort} ${r.kategorie ?? ""}`.toLowerCase().includes(suche)) continue;
    zeilen.push(z);
  }
  return { zeilen, gesamt: kand.length, lager };
}

/** Einzelansicht: Stammdaten, Bewertung, Herkunft, Verlauf, Anschreiben. */
export async function leadDetail(tenantId: string, id: string) {
  const [l] = await db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.id, id)));
  if (!l) return null;
  const sperre = (await chargeKandidaten(tenantId)).find((k) => k.id === id)?.sperre ?? null;
  const anschreiben = await db.select({ id: A.id, code: A.code, betreff: A.betreff, kanal: A.kanal, status: A.status, erstellt: A.createdAt, versendetAm: A.versendetAm, beilage: A.adelprepBeilage }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.leadId, id))).orderBy(desc(A.createdAt));
  return { l: { ...l, strasse: l.strasse ? openPii(l.strasse) : null, email: l.email ? openPii(l.email) : null }, sperre, anschreiben };
}

/** Konfliktbranche ausnahmsweise freigeben bzw. zurücknehmen (nur Inhaber) – mit Verlaufseintrag, danach neu bewerten. */
export async function konfliktFreigeben(s: Session, id: string, an: boolean) {
  if (s.role !== "owner" || s.readOnly) throw new LeadMaschineFehler("Nur der Inhaber gibt Konfliktbranchen frei.");
  await db.update(L).set({ konfliktFreigabe: an, verlauf: sql`(${L.verlauf} || ${JSON.stringify([eintrag(an ? "Konfliktbranche ausnahmsweise freigegeben" : "Freigabe Konfliktbranche zurückgenommen")])}::jsonb)` }).where(and(eq(L.tenantId, s.tenantId), eq(L.id, id)));
  await leadsBewerten(s.tenantId, [id]);
}

export const datumDe = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "–");
export { plusMonateIso };
