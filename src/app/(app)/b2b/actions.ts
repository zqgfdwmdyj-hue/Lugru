"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { parseAmount, parseDate } from "@/lib/numbers";
import { DealEingabe, leseStaffel } from "@/lib/b2b/eingabe";
import { dealAnlegen, discordMelden, freischalten, ladeDeal, preisSetzen, prognoseAktualisieren, schliessen, setzeStatus } from "@/lib/b2b/service";

const uuid = z.string().uuid();
const D = schema.deals;
const KP = schema.dealKundenpreise;

const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
};
const zahl = (fd: FormData, k: string) => parseAmount(fd.get(k));
const ganz = (fd: FormData, k: string) => {
  const v = parseAmount(fd.get(k));
  return v === null ? null : Math.round(v);
};
const zurueck = (id: string, q: string): never => redirect(`/b2b/${id}?${q}`);
const meldung = (s: string) => `meldung=${encodeURIComponent(s)}`;

function eingabeAus(fd: FormData) {
  return DealEingabe.safeParse({
    asin: text(fd, "asin") ?? "",
    ean: text(fd, "ean"),
    titel: text(fd, "titel"),
    bildUrl: text(fd, "bildUrl"),
    marke: text(fd, "marke"),
    kategorie: text(fd, "kategorie"),
    supplierId: text(fd, "supplierId"),
    angebotId: text(fd, "angebotId"),
    ekNetto: zahl(fd, "ekNetto") ?? 0,
    staffel: leseStaffel(text(fd, "staffel")),
    moqLieferant: ganz(fd, "moqLieferant") ?? 1,
    lieferzeitTage: ganz(fd, "lieferzeitTage"),
    angebotGueltigBis: parseDate(fd.get("angebotGueltigBis")),
    frist: parseDate(fd.get("frist")),
    kundenpreisNetto: zahl(fd, "kundenpreisNetto"),
    mindestmengeKunde: ganz(fd, "mindestmengeKunde") ?? 1,
    maxGesamt: ganz(fd, "maxGesamt"),
    maxProKunde: ganz(fd, "maxProKunde"),
    maxKunden: ganz(fd, "maxKunden"),
    nurRestmenge: fd.get("nurRestmenge") === "on",
    versandAnteil: zahl(fd, "versandAnteil"),
    prepGebuehr: zahl(fd, "prepGebuehr"),
    hinweis: text(fd, "hinweis"),
  });
}

const fehlerText = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ");

export async function dealAnlegenAction(fd: FormData) {
  const session = await requireArea("b2b");
  const e = eingabeAus(fd);
  if (!e.success) redirect(`/b2b/neu?${meldung(fehlerText(e.error))}`);
  const { id } = await dealAnlegen(session.tenantId, session.userId, e.data!);
  // Prognose (Keepa/Amazon je Land) läuft nach der Antwort weiter – die Seite zeigt „wird berechnet“.
  after(() => prognoseAktualisieren(session.tenantId, id).catch((err) => console.error("B2B-Prognose", err instanceof Error ? err.message : err)));
  revalidatePath("/b2b");
  redirect(`/b2b/${id}?meldung=angelegt`);
}

/** Stammdaten und Grenzen ändern (Entwurf oder offen). Kundenpreis separat (preisAction). */
export async function dealSpeichernAction(fd: FormData) {
  const session = await requireArea("b2b");
  const id = uuid.parse(fd.get("id"));
  const d = await ladeDeal(session.tenantId, id);
  if (!d) redirect("/b2b");
  if (!["entwurf", "aktiv"].includes(d!.status)) zurueck(id, meldung("Geschlossene Deals sind nicht mehr änderbar."));
  const e = eingabeAus(fd);
  if (!e.success) zurueck(id, meldung(fehlerText(e.error)));
  const x = e.data!;
  // Nach dem Freischalten keine Änderung an ASIN/EK (Kunden haben auf dieser Grundlage reserviert).
  const fest = d!.status === "aktiv";
  await db
    .update(D)
    .set({
      ...(fest ? {} : { asin: x.asin, ean: x.ean ?? null, ekNetto: x.ekNetto, staffel: x.staffel, moqLieferant: x.moqLieferant, supplierId: x.supplierId ?? null }),
      titel: x.titel || d!.titel,
      bildUrl: x.bildUrl ?? null,
      marke: x.marke ?? null,
      kategorie: x.kategorie ?? null,
      lieferzeitTage: x.lieferzeitTage ?? null,
      angebotGueltigBis: x.angebotGueltigBis ?? null,
      frist: x.frist ?? null,
      mindestmengeKunde: x.mindestmengeKunde,
      maxGesamt: x.maxGesamt ?? null,
      maxProKunde: x.maxProKunde ?? null,
      maxKunden: x.maxKunden ?? null,
      nurRestmenge: x.nurRestmenge,
      versandAnteil: x.versandAnteil ?? null,
      prepGebuehr: x.prepGebuehr ?? null,
      hinweis: x.hinweis ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(D.tenantId, session.tenantId), eq(D.id, id)));
  // Prep-Gebühr fließt in die Kundenrechnung – mit gespeicherten Marktdaten neu rechnen.
  if (d!.kundenpreisNetto !== null && (x.prepGebuehr ?? null) !== d!.prepGebuehr) await preisSetzen(session.tenantId, id, d!.kundenpreisNetto, { trotzReservierungen: true });
  revalidatePath(`/b2b/${id}`);
  zurueck(id, "meldung=gespeichert");
}

export async function preisAction(fd: FormData) {
  const session = await requireArea("b2b");
  const id = uuid.parse(fd.get("id"));
  const preis = zahl(fd, "kundenpreisNetto");
  if (preis === null || preis <= 0) zurueck(id, meldung("Bitte einen Kundenpreis eingeben."));
  const r = await preisSetzen(session.tenantId, id, preis!, { trotzReservierungen: fd.get("trotz") === "on" });
  revalidatePath(`/b2b/${id}`);
  zurueck(id, r.ok ? "meldung=preis" : meldung(r.fehler));
}

/** Vorschlag „max. gesamt“ übernehmen (Verkäufe/Monat × Faktor − eigener Bestand). */
export async function maxGesamtAction(fd: FormData) {
  const session = await requireArea("b2b");
  const id = uuid.parse(fd.get("id"));
  const n = ganz(fd, "maxGesamt");
  if (n === null || n < 1) zurueck(id, meldung("Ungültige Menge."));
  await db.update(D).set({ maxGesamt: n, updatedAt: new Date() }).where(and(eq(D.tenantId, session.tenantId), eq(D.id, id), sql`${D.status} in ('entwurf','aktiv')`));
  revalidatePath(`/b2b/${id}`);
  zurueck(id, "meldung=gespeichert");
}

export async function kundenpreisAction(fd: FormData) {
  const session = await requireArea("b2b");
  const id = uuid.parse(fd.get("id"));
  const kundeId = uuid.parse(fd.get("kundeId"));
  const [k] = await db.select({ id: schema.b2bKunden.id }).from(schema.b2bKunden).where(and(eq(schema.b2bKunden.tenantId, session.tenantId), eq(schema.b2bKunden.id, kundeId)));
  if (!k || !(await ladeDeal(session.tenantId, id))) zurueck(id, meldung("Kunde oder Deal nicht gefunden."));
  if (fd.get("entfernen") === "1") {
    await db.delete(KP).where(and(eq(KP.tenantId, session.tenantId), eq(KP.dealId, id), eq(KP.kundeId, kundeId)));
  } else {
    const preis = zahl(fd, "preisNetto");
    if (preis === null || preis <= 0) zurueck(id, meldung("Bitte einen Preis eingeben."));
    await db.insert(KP).values({ tenantId: session.tenantId, dealId: id, kundeId, preisNetto: preis! }).onConflictDoUpdate({ target: [KP.dealId, KP.kundeId], set: { preisNetto: preis! } });
  }
  revalidatePath(`/b2b/${id}`);
  zurueck(id, "meldung=kundenpreis");
}

export async function prognoseAction(fd: FormData) {
  const session = await requireArea("b2b");
  const id = uuid.parse(fd.get("id"));
  const r = await prognoseAktualisieren(session.tenantId, id);
  revalidatePath(`/b2b/${id}`);
  zurueck(id, r.hinweise.length ? meldung(`Prognose aktualisiert. ${r.hinweise.join(" ")}`) : "meldung=prognose");
}

export async function freischaltenAction(fd: FormData) {
  const session = await requireArea("b2b");
  const id = uuid.parse(fd.get("id"));
  const r = await freischalten(session.tenantId, id, session.userId, { mails: fd.get("mails") === "on" });
  revalidatePath("/b2b");
  revalidatePath(`/b2b/${id}`);
  zurueck(id, r.ok ? meldung(`Freigeschaltet – im Kundenportal sichtbar.${r.discord ? " Discord gemeldet." : ""}${r.mails ? ` ${r.mails} Abo-Mail(s) verschickt.` : ""}`) : meldung(r.fehler));
}

export async function schliessenAction(fd: FormData) {
  const session = await requireArea("b2b");
  const id = uuid.parse(fd.get("id"));
  await schliessen(session.tenantId, id);
  revalidatePath(`/b2b/${id}`);
  zurueck(id, "meldung=geschlossen");
}

/** Entwurf verwerfen (bleibt als „verfallen“ sichtbar – nichts wird gelöscht). */
export async function verwerfenAction(fd: FormData) {
  const session = await requireArea("b2b");
  const id = uuid.parse(fd.get("id"));
  const d = await ladeDeal(session.tenantId, id);
  if (d?.status === "entwurf") await setzeStatus(session.tenantId, id, "verfallen");
  revalidatePath("/b2b");
  zurueck(id, "meldung=verworfen");
}

export async function discordNochmalAction(fd: FormData) {
  const session = await requireArea("b2b");
  const id = uuid.parse(fd.get("id"));
  const art = z.enum(["neu", "fastWeg", "geschlossen"]).parse(fd.get("art"));
  const r = await discordMelden(session.tenantId, id, art).catch((e) => ({ gesendet: false, grund: e instanceof Error ? e.message : String(e) }));
  zurueck(id, meldung(r.gesendet ? "An Discord gesendet." : `Nicht gesendet: ${r.grund}.`));
}
