"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { parseAmount } from "@/lib/numbers";

const LP = schema.lieferantenProfile;
const t = (fd: FormData, k: string, max = 500) => {
  const v = String(fd.get(k) ?? "").trim().slice(0, max);
  return v === "" ? null : v;
};
const janein = (fd: FormData, k: string) => (fd.get(k) === "ja" ? true : fd.get(k) === "nein" ? false : null);
const note = (fd: FormData, k: string) => {
  const v = parseAmount(fd.get(k));
  return v === null ? undefined : Math.min(5, Math.max(1, Math.round(v)));
};

export async function profilSpeichernAction(fd: FormData) {
  const session = await requireArea("b2b");
  const supplierId = z.string().uuid().parse(fd.get("supplierId"));
  const [s] = await db.select({ id: schema.suppliers.id }).from(schema.suppliers).where(and(eq(schema.suppliers.tenantId, session.tenantId), eq(schema.suppliers.id, supplierId)));
  if (!s) redirect("/b2b/lieferanten");
  const [alt] = await db.select().from(LP).where(and(eq(LP.tenantId, session.tenantId), eq(LP.supplierId, supplierId)));
  const wv = janein(fd, "wiederverkaufErlaubt");
  const mp = janein(fd, "marktplatzErlaubt");
  const vertriebGeaendert = !alt || alt.wiederverkaufErlaubt !== wv || alt.marktplatzErlaubt !== mp;
  const quelle = t(fd, "vertriebQuelle", 300);
  if ((wv === true || mp === true) && !quelle) redirect(`/b2b/lieferanten/${supplierId}?meldung=${encodeURIComponent("Bitte angeben, woher die Freigabe stammt (z. B. Mail vom … oder AGB §…).")}`);
  const zahl = (k: string) => {
    const v = parseAmount(fd.get(k));
    return v === null ? null : v;
  };
  const ganz = (k: string) => {
    const v = parseAmount(fd.get(k));
    return v === null ? null : Math.max(0, Math.round(v));
  };
  const werte = {
    email: t(fd, "email", 200),
    adresse: t(fd, "adresse", 300),
    telefon: (t(fd, "telefon", 40) ?? "").replace(/[^\d+ /()-]/g, "").trim() || null,
    mindestbestellwert: zahl("mindestbestellwert"),
    versandkosten: zahl("versandkosten"),
    zahlungszielTage: ganz("zahlungszielTage"),
    lieferzeitTage: ganz("lieferzeitTage"),
    marken: (t(fd, "marken", 2000) ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 200),
    bewertung: { antwortzeit: note(fd, "b_antwortzeit"), liefertreue: note(fd, "b_liefertreue"), fehlmengen: note(fd, "b_fehlmengen"), rechnungsqualitaet: note(fd, "b_rechnungsqualitaet") },
    wiederverkaufErlaubt: wv,
    marktplatzErlaubt: mp,
    vertriebNotiz: t(fd, "vertriebNotiz", 2000),
    vertriebQuelle: quelle,
    ...(vertriebGeaendert ? { vertriebGeprueftAm: new Date(), vertriebGeprueftVon: session.userId } : {}),
    notiz: t(fd, "notiz", 2000),
    updatedAt: new Date(),
  };
  await db.insert(LP).values({ tenantId: session.tenantId, supplierId, ...werte }).onConflictDoUpdate({ target: [LP.tenantId, LP.supplierId], set: werte });
  revalidatePath(`/b2b/lieferanten/${supplierId}`);
  redirect(`/b2b/lieferanten/${supplierId}?meldung=gespeichert`);
}

/**
 * B15.12: SKU-Kürzel einem echten Lieferanten zuordnen – oder doch als eigenen Lieferanten führen.
 * Nur auf Klick; nichts wird gelöscht.
 */
export async function kuerzelZuordnenAction(fd: FormData) {
  const session = await requireArea("b2b");
  const S = schema.suppliers;
  const id = z.string().uuid().parse(fd.get("kuerzelId"));
  const ziel = String(fd.get("gehoertZu") ?? "");
  if (fd.get("alsLieferant") === "1") {
    await db.update(S).set({ skuKuerzel: false, gehoertZu: null }).where(and(eq(S.tenantId, session.tenantId), eq(S.id, id)));
  } else {
    const zielId = ziel ? z.string().uuid().parse(ziel) : null;
    if (zielId) {
      const [ok] = await db.select({ id: S.id }).from(S).where(and(eq(S.tenantId, session.tenantId), eq(S.id, zielId), eq(S.skuKuerzel, false)));
      if (!ok) redirect("/b2b/lieferanten");
    }
    await db.update(S).set({ skuKuerzel: true, gehoertZu: zielId }).where(and(eq(S.tenantId, session.tenantId), eq(S.id, id)));
  }
  revalidatePath("/b2b/lieferanten");
  redirect("/b2b/lieferanten?meldung=Gespeichert#kuerzel");
}
