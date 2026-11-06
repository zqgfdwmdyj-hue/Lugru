"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { BELEG_ARTEN, type BelegFakten } from "@/lib/rechnungsstation/logic";
import { ausstehendeWeitergeben, belegPruefen, belegVerwerfen, ordnerPruefen, pdfStapelVerarbeiten, StationFehler } from "@/lib/rechnungsstation/service";

// Prüfliste der Rechnungsstation: VA, Buchhaltung und Geld dürfen prüfen und Stapel hochladen; die Einstellungen
// (Drive-Ordner, Scanner-Ordner an/aus) nur der Inhaber.

const ziel = (p: Record<string, string | null | undefined>) => `/rechnungsstation/pruefen?${new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => Boolean(e[1]))).toString()}`;
const zahl = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim().replace(/\s|€/g, "");
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const berechtigt = async () => {
  const s = await requireArea("service", "buchhaltung", "geld");
  if (s.readOnly) redirect(ziel({ fehler: "Nur ansehen – mit diesem Zugang wird nichts geändert." }));
  return { s, wer: { userId: s.userId, name: s.name || s.email } };
};

export async function belegPruefenAction(fd: FormData) {
  const { s, wer } = await berechtigt();
  const id = String(fd.get("id") ?? "");
  const stapel = String(fd.get("stapel") ?? "") || null;
  const art = String(fd.get("art") ?? "rechnung");
  const r = await belegPruefen(s.tenantId, wer, id, {
    lieferant: String(fd.get("lieferant") ?? ""),
    nummer: String(fd.get("nummer") ?? ""),
    datum: String(fd.get("datum") ?? ""),
    netto: zahl(fd.get("netto")),
    brutto: zahl(fd.get("brutto")),
    faelligAm: /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get("faellig") ?? "")) ? String(fd.get("faellig")) : null,
    art: ((BELEG_ARTEN as readonly string[]).includes(art) ? art : "rechnung") as BelegFakten["art"],
    keinDuplikat: fd.get("keinDuplikat") === "on",
  });
  revalidatePath("/rechnungsstation/pruefen");
  redirect(ziel(r.ok ? { stapel, meldung: r.text } : { stapel, fehler: r.text }));
}

export async function belegVerwerfenAction(fd: FormData) {
  const { s, wer } = await berechtigt();
  const stapel = String(fd.get("stapel") ?? "") || null;
  const r = await belegVerwerfen(s.tenantId, wer, String(fd.get("id") ?? ""));
  revalidatePath("/rechnungsstation/pruefen");
  redirect(ziel(r.ok ? { stapel, meldung: r.text } : { stapel, fehler: r.text }));
}

export async function pdfStapelHochladenAction(fd: FormData) {
  const { s, wer } = await berechtigt();
  const f = fd.get("datei");
  if (!(f instanceof File) || !f.size) redirect(ziel({ fehler: "Bitte eine PDF wählen." }));
  const datei = f as File;
  let res: { stapelId: string; belege: number; seiten: number };
  try {
    res = await pdfStapelVerarbeiten(s.tenantId, wer, Buffer.from(await datei.arrayBuffer()), datei.name || "Stapel.pdf", "upload");
  } catch (e) {
    redirect(ziel({ fehler: e instanceof StationFehler ? e.message : "Die PDF ließ sich nicht verarbeiten." }));
  }
  revalidatePath("/rechnungsstation/pruefen");
  redirect(ziel({ stapel: res!.stapelId, meldung: res!.belege ? `${res!.seiten} Seiten in ${res!.belege} Belege getrennt.` : "Diese PDF wurde schon verarbeitet." }));
}

export async function ordnerJetztAction() {
  const { s, wer } = await berechtigt();
  const r = await ordnerPruefen(s.tenantId, wer);
  revalidatePath("/rechnungsstation/pruefen");
  redirect(ziel(r.fehler.length ? { fehler: r.fehler.join(" · ") } : { meldung: r.dateien ? `${r.dateien} PDF${r.dateien === 1 ? "" : "s"} aus dem Scanner-Ordner: ${r.belege} Belege.` : "Keine neue PDF im Scanner-Ordner." }));
}

export async function weitergebenJetztAction(fd: FormData) {
  const { s } = await berechtigt();
  const r = await ausstehendeWeitergeben(s.tenantId, { sofort: true });
  revalidatePath("/rechnungsstation/pruefen");
  redirect(ziel({ stapel: String(fd.get("stapel") ?? "") || null, meldung: `An Stotax übertragen: ${r.stotax}${r.drive ? ` · in Drive abgelegt: ${r.drive}` : ""}.` }));
}

export async function stationEinstellungenAction(fd: FormData) {
  const s = await requireArea("service", "buchhaltung", "geld");
  if (s.role !== "owner" || s.readOnly) redirect(ziel({ fehler: "Nur der Inhaber ändert die Einstellungen." }));
  const drive = String(fd.get("driveOrdnerId") ?? "").trim().replace(/^.*\/folders\//, "").replace(/[?#].*$/, "").slice(0, 120);
  const wert = { ordnerAn: fd.get("ordnerAn") === "on", driveOrdnerId: /^[\w-]*$/.test(drive) ? drive : "" };
  await db.update(schema.tenants).set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('rechnungsstation', ${JSON.stringify(wert)}::jsonb)` }).where(eq(schema.tenants.id, s.tenantId));
  revalidatePath("/rechnungsstation/pruefen");
  redirect(ziel({ meldung: "Gespeichert." }));
}
