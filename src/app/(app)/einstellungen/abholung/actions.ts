"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import type { AbholOrt } from "@/db/schema";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { ortFehlt, ortSchluessel, zeitNorm } from "@/lib/abholung/logic";

// Einstellungen → Abholung: Abholorte (Stammdaten) und Vorschlag-Regel – nur der Inhaber (die VA bucht nur).

const ziel = (p: Record<string, string>) => `/einstellungen/abholung?${new URLSearchParams(p).toString()}`;

async function speichern(tenantId: string, abholung: { orte: AbholOrt[]; vorschlagAb: number; vorschlagAn: boolean }) {
  await db.update(schema.tenants).set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('abholung', ${JSON.stringify(abholung)}::jsonb)` }).where(eq(schema.tenants.id, tenantId));
  revalidatePath("/einstellungen/abholung");
  revalidatePath("/versand/abholung");
}

export async function abholOrtSpeichern(fd: FormData) {
  const s = await requireOwner();
  if (s.readOnly) redirect(ziel({ fehler: "Nur ansehen." }));
  const t = (k: string, n = 80) => String(fd.get(k) ?? "").trim().slice(0, n);
  const a = (await getSettings(s.tenantId)).abholung;
  const alt = t("key", 30);
  const ort: AbholOrt = {
    key: alt || ortSchluessel(t("name")),
    name: t("name"),
    name2: t("name2") || undefined,
    strasse: t("strasse"),
    hausnr: t("hausnr", 10),
    plz: t("plz", 5),
    ort: t("ort", 40),
    kontakt: t("kontakt", 50),
    telefon: t("telefon", 30),
    email: t("email", 120) || undefined,
    dhlKundennummer: t("dhlKundennummer", 10).replace(/\s/g, "") || undefined,
    dhlAbrechnungsnummer: t("dhlAbrechnungsnummer", 20).replace(/\s/g, "") || undefined,
    upsKonto: t("upsKonto", 10).toUpperCase() || undefined,
    von: zeitNorm(t("von", 5)) ?? undefined,
    bis: zeitNorm(t("bis", 5)) ?? undefined,
    hinweis: t("hinweis", 100) || undefined,
    standard: fd.get("standard") === "on" || a.orte.length === 0 || undefined,
  };
  const fehlt = ortFehlt(ort);
  if (fehlt.length) redirect(ziel({ fehler: `Bitte ergänzen: ${fehlt.join(", ")}.` }));
  if (ort.dhlKundennummer && !/^\d{10}$/.test(ort.dhlKundennummer)) redirect(ziel({ fehler: "DHL-Kundennummer (EKP): 10 Ziffern." }));
  if (ort.dhlAbrechnungsnummer && !/^\d{12}\w{2}$/.test(ort.dhlAbrechnungsnummer)) redirect(ziel({ fehler: "DHL-Abrechnungsnummer: 14 Zeichen (EKP + Verfahren + Teilnahme)." }));
  if (ort.upsKonto && !/^[A-Z0-9]{6}$/.test(ort.upsKonto)) redirect(ziel({ fehler: "UPS-Kontonummer: 6 Zeichen." }));
  // Neuer Ort: Schlüssel eindeutig machen.
  if (!alt) {
    let k = ort.key, i = 2;
    while (a.orte.some((o) => o.key === k)) k = `${ort.key}-${i++}`;
    ort.key = k;
  }
  let orte = alt ? a.orte.map((o) => (o.key === alt ? ort : o)) : [...a.orte, ort];
  if (ort.standard) orte = orte.map((o) => (o.key === ort.key ? o : { ...o, standard: undefined }));
  await speichern(s.tenantId, { orte, vorschlagAb: a.vorschlagAb, vorschlagAn: a.vorschlagAn });
  redirect(ziel({ meldung: `Abholort „${ort.name}“ gespeichert.` }));
}

export async function abholOrtLoeschen(fd: FormData) {
  const s = await requireOwner();
  if (s.readOnly) redirect(ziel({ fehler: "Nur ansehen." }));
  const key = String(fd.get("key") ?? "");
  const a = (await getSettings(s.tenantId)).abholung;
  const orte = a.orte.filter((o) => o.key !== key);
  if (orte.length && !orte.some((o) => o.standard)) orte[0] = { ...orte[0], standard: true };
  await speichern(s.tenantId, { orte, vorschlagAb: a.vorschlagAb, vorschlagAn: a.vorschlagAn });
  redirect(ziel({ meldung: "Abholort entfernt." }));
}

export async function abholVorschlagSpeichern(fd: FormData) {
  const s = await requireOwner();
  if (s.readOnly) redirect(ziel({ fehler: "Nur ansehen." }));
  const a = (await getSettings(s.tenantId)).abholung;
  const n = Number(fd.get("vorschlagAb"));
  await speichern(s.tenantId, { orte: a.orte, vorschlagAb: Number.isInteger(n) && n >= 0 && n <= 500 ? n : a.vorschlagAb, vorschlagAn: fd.get("vorschlagAn") === "on" });
  redirect(ziel({ meldung: "Vorschlag-Regel gespeichert." }));
}
