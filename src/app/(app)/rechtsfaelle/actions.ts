"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireOwner, requireSession, type Session } from "@/lib/auth/session";
import { requirePrivate } from "@/lib/private/service";

// Rechtsfälle: geschäftliche nur für den Inhaber, private nur im Privatbereich (voller Privat-Zugang).

const F = schema.rechtsfaelle;
const basis = (bereich: "geschaeft" | "privat") => (bereich === "privat" ? "/privat/rechtsfaelle" : "/rechtsfaelle");
const mitMeldung = (pfad: string, m: string) => `${pfad}${pfad.includes("?") ? "&" : "?"}meldung=${encodeURIComponent(m)}`;

/** Fall laden und Zugriff prüfen (je Bereich). */
async function zugriff(id: string): Promise<{ session: Session; fall: typeof F.$inferSelect }> {
  const s = await requireSession();
  const [fall] = await db.select().from(F).where(and(eq(F.tenantId, s.tenantId), eq(F.id, id))).limit(1);
  if (!fall) redirect("/rechtsfaelle");
  const session = fall.bereich === "privat" ? await requirePrivate({ full: true }) : await requireOwner();
  return { session, fall };
}

export async function rechtEinstellungenAction(fd: FormData) {
  const session = await requireOwner();
  const liste = (v: FormDataEntryValue | null) => String(v ?? "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).slice(0, 30).map((x) => x.slice(0, 120));
  const zahl = (v: FormDataEntryValue | null, min: number, max: number, std: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : std;
  };
  const adresse = String(fd.get("anwaltAdresse") ?? "").trim();
  const neu = {
    anwaltDomains: liste(fd.get("anwaltDomains")).map((d) => d.toLowerCase().replace(/^.*@/, "")),
    anwaltAdresse: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adresse) ? adresse.slice(0, 200) : "",
    privatProjekte: liste(fd.get("privatProjekte")),
    vorlaufTage: zahl(fd.get("vorlaufTage"), 0, 30, 3),
    stillstandTage: zahl(fd.get("stillstandTage"), 0, 365, 21),
  };
  await db
    .update(schema.tenants)
    .set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('rechtsfaelle', ${JSON.stringify(neu)}::jsonb)` })
    .where(eq(schema.tenants.id, session.tenantId));
  revalidatePath("/rechtsfaelle");
  redirect(mitMeldung("/rechtsfaelle", "Einstellungen gespeichert."));
}

/** „Jetzt abgleichen“: Asana lesen + Stillstand prüfen (sonst alle 30 Min. im Hintergrund). */
export async function asanaJetztAction() {
  const session = await requireOwner();
  const { asanaAbgleich, stillstandPruefen } = await import("@/lib/recht/service");
  let m: string;
  try {
    const r = await asanaAbgleich(session.tenantId);
    const st = await stillstandPruefen(session.tenantId);
    m = r ? `Asana gelesen: ${r.faelle} Fälle (${r.neu} neu), ${r.kommentare} neue Kommentare, ${r.fristen} neue Fristen.${st ? ` ${st}× „beim Anwalt nachfragen“.` : ""}` : "Asana ist noch nicht eingerichtet (Anbindungen → Asana).";
  } catch (e) {
    m = `Asana-Abruf fehlgeschlagen: ${e instanceof Error ? e.message : "unbekannt"}`;
  }
  revalidatePath("/rechtsfaelle");
  redirect(mitMeldung("/rechtsfaelle", m));
}

export async function fallAnlegenAction(fd: FormData) {
  const bereich = fd.get("bereich") === "privat" ? "privat" : "geschaeft";
  const session = bereich === "privat" ? await requirePrivate({ full: true }) : await requireOwner();
  const titel = String(fd.get("titel") ?? "").trim().slice(0, 300);
  if (!titel) redirect(mitMeldung(basis(bereich), "Bitte einen Titel angeben."));
  const opt = (k: string, n: number) => String(fd.get(k) ?? "").trim().slice(0, n) || null;
  const { fallAnlegen } = await import("@/lib/recht/service");
  const id = await fallAnlegen(session.tenantId, { titel, aktenzeichen: opt("aktenzeichen", 60), gegenstand: opt("gegenstand", 2000), bereich, firma: opt("firma", 40) });
  redirect(`${basis(bereich)}/${id}`);
}

export async function entwurfAction(fd: FormData) {
  const { session, fall } = await zugriff(String(fd.get("id") ?? ""));
  const text = String(fd.get("text") ?? "").trim();
  if (text) {
    const { mailEntwurf } = await import("@/lib/recht/service");
    await mailEntwurf(session.tenantId, fall.id, text);
  }
  revalidatePath(`${basis(fall.bereich)}/${fall.id}`);
  redirect(mitMeldung(`${basis(fall.bereich)}/${fall.id}`, "Entwurf gespeichert – nichts gesendet."));
}

/** Bereich festlegen. Nach „geschäftlich“ nur der Inhaber mit Privat-Zugang (er sieht beide Seiten). */
export async function zuordnenAction(fd: FormData) {
  const { session, fall } = await zugriff(String(fd.get("id") ?? ""));
  const bereich = fd.get("bereich") === "geschaeft" ? "geschaeft" : "privat";
  if (bereich === "geschaeft" && session.role !== "owner") redirect(mitMeldung(`${basis(fall.bereich)}/${fall.id}`, "Nur der Inhaber kann einen Fall geschäftlich zuordnen."));
  if (bereich === "privat" && fall.bereich === "geschaeft") await requirePrivate({ full: true });
  const { fallZuordnen } = await import("@/lib/recht/service");
  await fallZuordnen(session.tenantId, fall.id, bereich, String(fd.get("firma") ?? "").trim().slice(0, 40) || null);
  revalidatePath(basis(bereich));
  redirect(mitMeldung(`${basis(bereich)}/${fall.id}`, "Zugeordnet."));
}

export async function erledigtAction(fd: FormData) {
  const { session, fall } = await zugriff(String(fd.get("id") ?? ""));
  if (fall.quelle !== "asana") await db.update(F).set({ abgeschlossen: new Date(), status: "abgeschlossen", updatedAt: new Date() }).where(and(eq(F.tenantId, session.tenantId), eq(F.id, fall.id)));
  revalidatePath(basis(fall.bereich));
  redirect(mitMeldung(basis(fall.bereich), "Fall abgeschlossen."));
}
