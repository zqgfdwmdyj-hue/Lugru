"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { parseDelimited, readTable, decodeText } from "@/lib/tabular";
import { parseDealList } from "@/lib/sas/logic";
import {
  addDocument,
  addItem,
  applyBrandSuggestion,
  createFahrplan,
  deleteDeals,
  deleteDocument,
  importBrands,
  importDeals,
  markPilotSubmitted,
  recomputeBrandFacts,
  saveProgram,
  selectBrand,
  setBrandStatus,
  setEvidenceVerdict,
  setDealStatus,
  updateItem,
} from "@/lib/sas/service";
import { SAS_BRAND_STATUS, SAS_DEAL_STATUS, SAS_MODULES, SAS_WAITING } from "@/db/tables/sas";

// Amazon SAS-Programm: alle Änderungen (Bereich „Amazon“).

const back = (tab: string, msg?: { ok?: string; fehler?: string }) => {
  const q = new URLSearchParams({ tab });
  if (msg?.ok) q.set("ok", msg.ok);
  if (msg?.fehler) q.set("fehler", msg.fehler);
  revalidatePath("/sas");
  revalidatePath("/");
  redirect(`/sas?${q.toString()}`);
};
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const dateOrNull = (v: FormDataEntryValue | null) => {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const fileOf = (v: FormDataEntryValue | null) => (v && typeof v === "object" && "arrayBuffer" in v && (v as File).size > 0 ? (v as File) : null);

export async function saveProgramAction(fd: FormData) {
  const s = await requireArea("amazon");
  const email = str(fd.get("consultantEmail"));
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) back("uebersicht", { fehler: "Die E-Mail-Adresse sieht nicht richtig aus." });
  await saveProgram(s.tenantId, {
    consultantName: str(fd.get("consultantName")) || null,
    consultantEmail: email || null,
    pstamName: str(fd.get("pstamName")) || null,
    nextMeeting: dateOrNull(fd.get("nextMeeting")),
    dealDeadline: dateOrNull(fd.get("dealDeadline")),
    notes: str(fd.get("notes")) || null,
  });
  back("uebersicht", { ok: "Gespeichert." });
}

export async function createFahrplanAction() {
  const s = await requireArea("amazon");
  const n = await createFahrplan(s.tenantId);
  back("aufgaben", { ok: n ? `${n} Schritte als Aufgaben angelegt – sie stehen auch auf der Startseite.` : "Der Fahrplan ist schon vollständig." });
}

export async function addItemAction(fd: FormData) {
  const s = await requireArea("amazon");
  const title = str(fd.get("title"));
  if (!title) back("aufgaben", { fehler: "Bitte einen Titel eintragen." });
  await addItem(s.tenantId, {
    title,
    notes: str(fd.get("notes")) || null,
    dueDate: dateOrNull(fd.get("dueDate")),
    module: z.enum(SAS_MODULES).catch("sonstiges").parse(fd.get("module")),
    waitingOn: z.enum(SAS_WAITING).catch("ich").parse(fd.get("waitingOn")),
  });
  back("aufgaben", { ok: "Aufgabe angelegt." });
}

export async function updateItemAction(fd: FormData) {
  const s = await requireArea("amazon");
  const id = z.string().uuid().parse(fd.get("taskId"));
  const done = fd.get("done");
  await updateItem(s.tenantId, id, {
    waitingOn: fd.get("waitingOn") ? z.enum(SAS_WAITING).parse(fd.get("waitingOn")) : undefined,
    module: fd.get("module") ? z.enum(SAS_MODULES).parse(fd.get("module")) : undefined,
    dueDate: fd.has("dueDate") ? dateOrNull(fd.get("dueDate")) : undefined,
    done: done === "1" ? true : done === "0" ? false : undefined,
  });
  back("aufgaben");
}

// ---- Marken

export async function importBrandsAction(fd: FormData) {
  const s = await requireArea("amazon");
  const file = fileOf(fd.get("file"));
  let values: string[] = [];
  if (file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const t = readTable(buf);
    values = [t.headers[0] ?? "", ...t.rows.map((r) => r[0] ?? "")];
    // Die Liste auch unter „Unterlagen“ ablegen.
    await addDocument(s.tenantId, file.name || "Markenliste", file.type || "application/octet-stream", Buffer.from(buf), "markenliste");
  } else values = str(fd.get("text")).split(/\r?\n|;|,/);
  if (!values.some((v) => v.trim())) back("marken", { fehler: "Keine Marken gefunden – Datei (XLSX/CSV, eine Spalte) oder je Zeile eine Marke." });
  const r = await importBrands(s.tenantId, values);
  back("marken", { ok: `${r.total} Marken gelesen, ${r.added} neu. Kennzahlen berechnet.` });
}

export async function recomputeBrandsAction() {
  const s = await requireArea("amazon");
  await recomputeBrandFacts(s.tenantId);
  back("marken", { ok: "Kennzahlen neu berechnet." });
}

export async function selectBrandAction(fd: FormData) {
  const s = await requireArea("amazon");
  const err = await selectBrand(s.tenantId, z.string().uuid().parse(fd.get("id")), fd.get("selected") === "1");
  back("marken", err ? { fehler: err } : undefined);
}

export async function suggestBrandsAction() {
  const s = await requireArea("amazon");
  const n = await applyBrandSuggestion(s.tenantId);
  back("marken", { ok: n ? `${n} Marken vorgeschlagen und ausgewählt – bitte prüfen.` : "Keine Marke mit Umsatz oder Belegen gefunden." });
}

export async function submitPilotAction() {
  const s = await requireArea("amazon");
  await markPilotSubmitted(s.tenantId);
  back("marken", { ok: "Als eingereicht markiert. Die Mail vom Appeal Team ist als Aufgabe in ca. 2 Wochen eingetragen." });
}

/** Zuordnung Marke ↔ Beleg: „stimmt“, „falsch“ (zählt dann nicht) oder zurücksetzen. Zurück in die Beleg-Liste. */
export async function evidenceVerdictAction(fd: FormData) {
  const s = await requireArea("amazon");
  const brandId = z.string().uuid().parse(fd.get("brandId"));
  const invoiceId = z.string().uuid().parse(fd.get("invoiceId"));
  const v = z.enum(["stimmt", "falsch", "zuruecksetzen"]).parse(fd.get("verdict"));
  await setEvidenceVerdict(s.tenantId, s.userId, brandId, invoiceId, v === "zuruecksetzen" ? null : v);
  revalidatePath("/sas");
  const q = new URLSearchParams({ tab: "marken", belege: brandId });
  for (const k of ["filter", "sort", "q", "nur"]) {
    const val = str(fd.get(k));
    if (val) q.set(k, val.slice(0, 60));
  }
  redirect(`/sas?${q.toString()}#b-${invoiceId}`);
}

export async function brandStatusAction(fd: FormData) {
  const s = await requireArea("amazon");
  await setBrandStatus(s.tenantId, z.string().uuid().parse(fd.get("id")), z.enum(SAS_BRAND_STATUS).parse(fd.get("status")));
  back("marken");
}

// ---- Deals

export async function importDealsAction(fd: FormData) {
  const s = await requireArea("amazon");
  const file = fileOf(fd.get("file"));
  let headers: string[] = [];
  let rows: string[][] = [];
  if (file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    ({ headers, rows } = readTable(buf));
    await addDocument(s.tenantId, file.name || "ASIN-Liste", file.type || "application/octet-stream", Buffer.from(buf), "asin_liste");
  } else {
    const m = parseDelimited(decodeText(new TextEncoder().encode(str(fd.get("text")))));
    headers = m[0] ?? [];
    rows = m.slice(1);
  }
  const deals = parseDealList(headers, rows);
  if (!deals.length) back("blackweek", { fehler: "Keine ASINs gefunden. Erwartet: Spalte mit ASIN (B0…), dazu Mindestrabatt in %." });
  await importDeals(s.tenantId, deals);
  back("blackweek", { ok: `${deals.length} ASINs eingelesen.` });
}

export async function dealStatusAction(fd: FormData) {
  const s = await requireArea("amazon");
  await setDealStatus(s.tenantId, z.string().uuid().parse(fd.get("id")), z.enum(SAS_DEAL_STATUS).parse(fd.get("status")));
  back("blackweek");
}

export async function clearDealsAction() {
  const s = await requireArea("amazon");
  await deleteDeals(s.tenantId);
  back("blackweek", { ok: "Deal-Liste geleert." });
}

// ---- Unterlagen

export async function uploadDocumentAction(fd: FormData) {
  const s = await requireArea("amazon");
  const file = fileOf(fd.get("file"));
  if (!file) back("unterlagen", { fehler: "Bitte eine Datei wählen." });
  if (file!.size > 15 * 1024 * 1024) back("unterlagen", { fehler: "Datei zu groß (höchstens 15 MB)." });
  const kind = z.enum(["praesentation", "markenliste", "asin_liste", "nachweis", "sonstiges"]).catch("sonstiges").parse(fd.get("kind"));
  const r = await addDocument(s.tenantId, file!.name || "Unterlage", file!.type || "application/octet-stream", Buffer.from(await file!.arrayBuffer()), kind);
  if (!r.stored && r.existing)
    back("unterlagen", { fehler: `Diese Datei liegt schon hier („${r.existing.name}“ vom ${r.existing.createdAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}) – nicht doppelt abgelegt.` });
  back("unterlagen", { ok: "Hochgeladen." });
}

export async function deleteDocumentAction(fd: FormData) {
  const s = await requireArea("amazon");
  await deleteDocument(s.tenantId, z.string().uuid().parse(fd.get("id")));
  back("unterlagen", { ok: fd.get("doppel") === "1" ? "Doppel entfernt – das Original bleibt." : "Gelöscht." });
}
