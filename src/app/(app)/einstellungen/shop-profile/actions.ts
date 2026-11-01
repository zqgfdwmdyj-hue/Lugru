"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { LINK_ARTEN, type LinkArt } from "@/lib/deal-eingang/shop-logic";

// Einstellungen → Shop-Profile (Kaufen mit einem Tap): Link-Art, Link-Muster, Hinweis, Payback je Shop; Schalter
// „Payback eingerichtet“ (nur Anzeige – keine Payback-Nummer im System). Nur der Inhaber ändert.

const PFAD = "/einstellungen/shop-profile";
const ziel = (m: string) => `${PFAD}?meldung=${encodeURIComponent(m)}`;
const text = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max) || null;

async function inhaber() {
  const s = await requireArea("dealeingang");
  if (s.role !== "owner" || s.readOnly) redirect(ziel("Nur der Inhaber ändert Shop-Profile."));
  return s;
}

/** Link-Muster: nur https, nur bekannte Platzhalter, nach dem Füllen eine gültige Adresse. */
async function musterPruefen(m: string | null): Promise<string | null> {
  if (!m) return null;
  if (!/^https:\/\//i.test(m)) return "Das Link-Muster muss mit https:// beginnen.";
  const unbekannt = m.match(/\{(?!asin\}|menge\}|suche\}|url\}|variante\})[^}]*\}/i);
  if (unbekannt) return `Unbekannter Platzhalter ${unbekannt[0]} – erlaubt: {asin}, {menge}, {suche}, {url}, {variante}.`;
  try {
    new URL(m.replace(/\{[a-z]+\}/gi, "x"));
  } catch {
    return "Das Link-Muster ist keine gültige Adresse.";
  }
  return null;
}

export async function shopProfilSpeichern(fd: FormData) {
  const s = await inhaber();
  const kuerzel = String(fd.get("kuerzel") ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (kuerzel.length < 2) redirect(ziel("Bitte ein Kürzel (2–8 Zeichen, wie in der SKU) angeben."));
  const name = text(fd.get("name"), 80) ?? kuerzel;
  const domains = String(fd.get("domains") ?? "")
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
    .slice(0, 10);
  const linkArtRoh = String(fd.get("linkArt") ?? "produktseite");
  const linkArt: LinkArt = (LINK_ARTEN as readonly string[]).includes(linkArtRoh) ? (linkArtRoh as LinkArt) : "produktseite";
  const linkMuster = text(fd.get("linkMuster"), 500);
  const fehler = await musterPruefen(linkMuster);
  if (fehler) redirect(ziel(`${kuerzel}: ${fehler} Nicht gespeichert.`));
  if (linkArt !== "produktseite" && !linkMuster) redirect(ziel(`${kuerzel}: Für „${linkArt === "suche" ? "Suche" : "Warenkorb-Link"}“ braucht es ein Link-Muster. Nicht gespeichert.`));
  const werte = { name, domains, linkArt, linkMuster, hinweis: text(fd.get("hinweis"), 200), payback: text(fd.get("payback"), 200), aktiv: fd.get("aktiv") === "on", aktualisiertAm: new Date() };
  const SP = schema.shopProfile;
  await db.insert(SP).values({ tenantId: s.tenantId, kuerzel, ...werte }).onConflictDoUpdate({ target: [SP.tenantId, SP.kuerzel], set: werte });
  revalidatePath(PFAD);
  redirect(ziel(`${kuerzel} gespeichert.`));
}

/** Eigene Änderungen an einem Start-Profil verwerfen (zurück zum Standard) bzw. eigenes Profil entfernen. */
export async function shopProfilZuruecksetzen(fd: FormData) {
  const s = await inhaber();
  const kuerzel = String(fd.get("kuerzel") ?? "").trim().toUpperCase();
  await db.delete(schema.shopProfile).where(and(eq(schema.shopProfile.tenantId, s.tenantId), eq(schema.shopProfile.kuerzel, kuerzel)));
  revalidatePath(PFAD);
  redirect(ziel(`${kuerzel}: eigene Einstellung entfernt.`));
}

/** „Payback eingerichtet ✅“ – nur Anzeige; blendet den Payback-Hinweis im Push aus. */
export async function paybackSpeichern(fd: FormData) {
  const s = await inhaber();
  const an = fd.get("paybackEingerichtet") === "on";
  await db
    .update(schema.tenants)
    .set({ settings: sql`jsonb_set(coalesce(${schema.tenants.settings}, '{}'::jsonb), '{dealEingang}', coalesce(${schema.tenants.settings}->'dealEingang', '{}'::jsonb) || jsonb_build_object('paybackEingerichtet', ${an}::boolean))` })
    .where(eq(schema.tenants.id, s.tenantId));
  revalidatePath(PFAD);
  redirect(ziel(an ? "Payback als eingerichtet markiert – kein Hinweis mehr im Push." : "Payback-Hinweis im Push wieder an."));
}
