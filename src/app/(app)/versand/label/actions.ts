"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { KANAELE, VERSAND_PRODUKTE, type Erkannt } from "@/lib/versand-label/logic";
import { adressePruefen, adresseErkennen, labelErstellen, type LabelEingabe, type LabelErgebnis } from "@/lib/versand-label/service";

// Versand → Label erstellen: Inhaber und alle mit dem Bereich „Service“ (auch die VA). Einstellungen nur Inhaber.

const kurz = (n: number) => z.string().trim().max(n).optional().default("");
const Empf = z.object({
  name: z.string().trim().max(80),
  name2: kurz(80),
  strasse: z.string().trim().max(80),
  hausnummer: z.string().trim().max(20),
  plz: z.string().trim().max(10),
  ort: z.string().trim().max(60),
  land: z.string().trim().max(2).default("DE"),
  telefon: kurz(30),
  email: kurz(80),
  packstation: kurz(40),
  postnummer: kurz(12),
});
const zahl = z.coerce.number().finite().nonnegative();
const Eingabe = z.object({
  kanal: z.enum(KANAELE.map((k) => k.key) as [string, ...string[]]),
  absender: z.enum(["lugru", "zweiter"]),
  empfaenger: Empf,
  unsicher: z.array(z.string().max(20)).max(20).optional(),
  produkt: z.enum(VERSAND_PRODUKTE.map((p) => p.key) as [string, ...string[]]),
  gewichtKg: zahl.max(1000),
  masse: z.object({ l: zahl.max(400), b: zahl.max(400), h: zahl.max(400) }).nullable().optional(),
  wert: zahl.max(100000).nullable().optional(),
  services: z.object({ versicherung: zahl.max(100000).nullable().optional(), alterssicht: z.enum(["A16", "A18"]).nullable().optional() }),
  gefahrgut: z.object({ lq: z.boolean().optional(), un: kurz(10), klasse: kurz(10), mengeJePackstueck: kurz(60), lithium: z.enum(["UN3481", "UN3091"]).nullable().optional(), vollgefahrgut: z.boolean().optional() }).nullable().optional(),
  artikel: kurz(300),
  sku: kurz(80),
  menge: z.coerce.number().int().min(1).max(999),
  preis: zahl.max(1000000).nullable().optional(),
  zahlungsart: kurz(60),
  vorlageId: z.string().uuid().nullable().optional(),
});

const ohneLeere = (e: z.infer<typeof Eingabe>): LabelEingabe => ({
  ...(e as unknown as LabelEingabe),
  empfaenger: Object.fromEntries(Object.entries(e.empfaenger).filter(([, v]) => v !== "")) as unknown as LabelEingabe["empfaenger"],
});

/** Adresse aus Text oder Bild lesen (Bild höchstens 8 MB). */
export async function erkennenAction(fd: FormData): Promise<(Erkannt & { hinweis?: string }) | { fehler: string }> {
  const s = await requireArea("service");
  if (s.readOnly) return { fehler: "Nur ansehen." };
  const text = String(fd.get("text") ?? "");
  const datei = fd.get("bild");
  let bild: { bytes: Uint8Array; mime: string } | null = null;
  if (datei instanceof File && datei.size > 0) {
    if (datei.size > 8 * 1024 * 1024) return { fehler: "Bild zu groß (höchstens 8 MB)." };
    if (!/^image\/(png|jpe?g|webp|gif|heic|heif)$/i.test(datei.type)) return { fehler: "Bitte ein Bild (PNG/JPG) wählen." };
    bild = { bytes: new Uint8Array(await datei.arrayBuffer()), mime: /hei[cf]/i.test(datei.type) ? "image/jpeg" : datei.type };
  }
  return adresseErkennen(s.tenantId, { text, bild });
}

export async function pruefenAction(roh: unknown): Promise<{ ok: boolean; meldungen: string[]; dhl: boolean }> {
  const s = await requireArea("service");
  const p = Eingabe.safeParse(roh);
  if (!p.success) return { ok: false, meldungen: ["Eingaben unvollständig."], dhl: false };
  return adressePruefen(s.tenantId, ohneLeere(p.data));
}

export async function erstellenAction(roh: unknown): Promise<LabelErgebnis> {
  const s = await requireArea("service");
  if (s.readOnly) return { ok: false, fehler: "Nur ansehen – kein Label erstellt." };
  const p = Eingabe.safeParse(roh);
  if (!p.success) return { ok: false, fehler: `Eingaben unvollständig: ${p.error.issues.map((i) => i.path.join(".")).slice(0, 4).join(", ")}` };
  // B2B-Kanal nur mit B2B-Zugriff (die VA sieht keine B2B-Daten).
  if (p.data.kanal === "b2b" && s.role !== "owner" && !(s.areas ?? []).includes("b2b") && s.areas !== null) return { ok: false, fehler: "Kanal B2B nur mit Zugriff auf B2B." };
  const r = await labelErstellen(s.tenantId, s.userId, ohneLeere(p.data));
  revalidatePath("/versand/label");
  return r;
}

const ziel = (m: string) => `/versand/label?meldung=${encodeURIComponent(m)}#einstellungen`;

/** Inhaber: zweiter Absender und Preisliste (€ netto je Produkt) für das Protokoll. */
export async function labelEinstellungenAction(fd: FormData) {
  const s = await requireArea("service");
  if (s.role !== "owner" || s.readOnly) redirect(ziel("Nur der Inhaber ändert die Einstellungen."));
  const t = (k: string, n = 60) => String(fd.get(k) ?? "").trim().slice(0, n);
  const absender2 = t("a2_name") ? { name1: t("a2_name"), name2: t("a2_name2") || undefined, street: t("a2_street"), houseNo: t("a2_house", 10), zip: t("a2_zip", 10), city: t("a2_city"), country: t("a2_country", 3) || "DEU", email: t("a2_email", 80) || undefined, phone: t("a2_phone", 30) || undefined } : null;
  const preise: Record<string, number> = {};
  for (const k of [...VERSAND_PRODUKTE.map((p) => p.key), "versicherung", "alterssicht"]) {
    const v = Number(String(fd.get(`preis_${k}`) ?? "").replace(",", "."));
    if (String(fd.get(`preis_${k}`) ?? "").trim() !== "" && Number.isFinite(v) && v >= 0 && v < 1000) preise[k] = Math.round(v * 100) / 100;
  }
  await db.update(schema.tenants).set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('versandLabel', ${JSON.stringify({ absender2, preise })}::jsonb)` }).where(eq(schema.tenants.id, s.tenantId));
  revalidatePath("/versand/label");
  redirect(ziel("Gespeichert."));
}
