"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { sendMail } from "@/lib/mail/accounts";
import { zerlegeUstId, EU } from "@/lib/b2b/logic";
import { viesPruefen } from "@/lib/b2b/vies";
import { einladungErstellen, zugangSperren } from "@/lib/b2b/portal-auth";

const K = schema.b2bKunden;
const uuid = z.string().uuid();
const t = (fd: FormData, k: string, max = 200) => {
  const v = String(fd.get(k) ?? "").trim().slice(0, max);
  return v === "" ? null : v;
};
const meldung = (s: string) => `meldung=${encodeURIComponent(s)}`;

function kundeAus(fd: FormData) {
  const land = (t(fd, "land", 2) ?? "DE").toUpperCase();
  const ust = t(fd, "ustId", 20)?.toUpperCase().replace(/[\s.-]/g, "") ?? null;
  const abo = fd.get("abo_alle") === "on" ? { alle: true } : { alle: false, marken: (t(fd, "abo_marken", 500) ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 50), kategorien: (t(fd, "abo_kategorien", 500) ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 50) };
  return {
    firma: t(fd, "firma", 160),
    ansprechpartner: t(fd, "ansprechpartner", 120),
    email: t(fd, "email", 200)?.toLowerCase() ?? null,
    strasse: t(fd, "strasse", 160),
    plz: t(fd, "plz", 12),
    ort: t(fd, "ort", 120),
    land: /^[A-Z]{2}$/.test(land) ? land : "DE",
    ustId: ust,
    amazonName: t(fd, "amazonName", 120),
    zahlungsart: fd.get("zahlungsart") === "rechnung" ? ("rechnung" as const) : ("vorkasse" as const),
    notiz: t(fd, "notiz", 2000),
    abo,
  };
}

export async function kundeAnlegenAction(fd: FormData) {
  const session = await requireArea("b2b");
  const k = kundeAus(fd);
  if (!k.firma) redirect(`/b2b/kunden?${meldung("Firma fehlt.")}`);
  if (k.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(k.email)) redirect(`/b2b/kunden?${meldung("E-Mail-Adresse ungültig.")}`);
  const [dupe] = await db.select({ id: K.id }).from(K).where(and(eq(K.tenantId, session.tenantId), eq(K.firma, k.firma!)));
  if (dupe) redirect(`/b2b/kunden/${dupe.id}?${meldung("Diese Firma gibt es schon.")}`);
  const [row] = await db.insert(K).values({ tenantId: session.tenantId, ...k, firma: k.firma! }).returning({ id: K.id });
  revalidatePath("/b2b/kunden");
  redirect(`/b2b/kunden/${row.id}?meldung=angelegt`);
}

export async function kundeSpeichernAction(fd: FormData) {
  const session = await requireArea("b2b");
  const id = uuid.parse(fd.get("id"));
  const k = kundeAus(fd);
  if (!k.firma) redirect(`/b2b/kunden/${id}?${meldung("Firma fehlt.")}`);
  if (k.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(k.email)) redirect(`/b2b/kunden/${id}?${meldung("E-Mail-Adresse ungültig.")}`);
  const [alt] = await db.select({ ustId: K.ustId, land: K.land }).from(K).where(and(eq(K.tenantId, session.tenantId), eq(K.id, id)));
  if (!alt) redirect("/b2b/kunden");
  // Neue USt-IdNr. oder neues Land → Prüfung verfällt (Reverse Charge erst nach neuer Prüfung).
  const neuPruefen = alt!.ustId !== k.ustId || alt!.land !== k.land;
  await db
    .update(K)
    .set({ ...k, firma: k.firma!, aktiv: fd.get("aktiv") === "on", ...(neuPruefen ? { ustGueltig: null, ustGeprueftAm: null, ustPruefName: null, ustPruefKennung: null } : {}), updatedAt: new Date() })
    .where(and(eq(K.tenantId, session.tenantId), eq(K.id, id)));
  if (fd.get("aktiv") !== "on") await zugangSperren(session.tenantId, id, true);
  revalidatePath(`/b2b/kunden/${id}`);
  redirect(`/b2b/kunden/${id}?meldung=gespeichert`);
}

/** USt-IdNr. bei VIES prüfen und das Ergebnis mit Kennung speichern. */
export async function ustPruefenAction(fd: FormData) {
  const session = await requireArea("b2b");
  const id = uuid.parse(fd.get("id"));
  const [k] = await db.select({ ustId: K.ustId, land: K.land }).from(K).where(and(eq(K.tenantId, session.tenantId), eq(K.id, id)));
  if (!k?.ustId) redirect(`/b2b/kunden/${id}?${meldung("Keine USt-IdNr. eingetragen.")}`);
  const z = zerlegeUstId(k!.ustId);
  if (!z || !EU.has(z.land)) redirect(`/b2b/kunden/${id}?${meldung("USt-IdNr. muss mit dem EU-Länderkürzel beginnen (z. B. FR…).")}`);
  const s = await getSettings(session.tenantId);
  const r = await viesPruefen(k!.ustId!, s.b2b.firma.ustId || null);
  if (r.gueltig === null) redirect(`/b2b/kunden/${id}?${meldung(r.fehler ?? "Prüfung nicht möglich.")}`);
  await db
    .update(K)
    .set({ ustGueltig: r.gueltig, ustGeprueftAm: new Date(), ustPruefName: r.name ? [r.name, r.adresse].filter(Boolean).join(", ").slice(0, 500) : null, ustPruefKennung: r.kennung, updatedAt: new Date() })
    .where(and(eq(K.tenantId, session.tenantId), eq(K.id, id)));
  revalidatePath(`/b2b/kunden/${id}`);
  redirect(`/b2b/kunden/${id}?${meldung(r.gueltig ? `USt-IdNr. gültig${r.kennung ? ` (Kennung ${r.kennung})` : ""}.` : "USt-IdNr. laut VIES ungültig – Rechnungen mit Umsatzsteuer.")}`);
}

export type EinladungStand = { ok: boolean; text: string; link?: string } | null;

/** Einladungs-Link erzeugen – wird nur hier einmal angezeigt; per Mail nur mit Haken. */
export async function einladenAction(_prev: EinladungStand, fd: FormData): Promise<EinladungStand> {
  const session = await requireArea("b2b");
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { ok: false, text: "Ungültig." };
  const r = await einladungErstellen(session.tenantId, id.data);
  if (!r.ok) return { ok: false, text: r.fehler };
  revalidatePath(`/b2b/kunden/${id.data}`);
  if (fd.get("senden") !== "on") return { ok: true, text: `Einladung erstellt (gültig bis ${r.bis.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}). Link einmalig hier – bitte selbst weitergeben:`, link: r.link };
  const s = await getSettings(session.tenantId);
  const absender = s.b2b.firma.handelsname || s.b2b.firma.name || undefined;
  try {
    await sendMail(
      session.tenantId,
      {
        to: r.email,
        subject: `Zugang zum Kundenportal${absender ? ` – ${absender}` : ""}`,
        text: `Hallo,\n\nfür Sie wurde ein Zugang zu unserem Kundenportal für Großhandels-Deals angelegt. Bitte über diesen Link ein Passwort festlegen (gültig 7 Tage):\n\n${r.link}\n\nIm Portal sehen Sie aktuelle Deals mit Prognose und können reservieren.${absender ? `\n\n${absender}` : ""}`,
      },
      { fromName: absender },
    );
  } catch (e) {
    return { ok: false, text: `Einladung erstellt, aber Mail nicht gesendet (${e instanceof Error ? e.message : String(e)}). Link:`, link: r.link };
  }
  return { ok: true, text: `Einladung an ${r.email} gesendet.` };
}

export async function sperrenAction(fd: FormData) {
  const session = await requireArea("b2b");
  const id = uuid.parse(fd.get("id"));
  const gesperrt = fd.get("gesperrt") === "1";
  await zugangSperren(session.tenantId, id, gesperrt);
  revalidatePath(`/b2b/kunden/${id}`);
  redirect(`/b2b/kunden/${id}?${meldung(gesperrt ? "Portal-Zugang gesperrt – alle Sitzungen beendet." : "Portal-Zugang wieder freigegeben.")}`);
}
