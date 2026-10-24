import "server-only";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { detectDocType, extractInvoiceDate, findDuplicates, type DupRow, type InvoiceChecks } from "./checks";
import { parseInvoiceFileName } from "./parse";

// Rechnungsprüfung: Erkennung (Datum, Belegart, Duplikate) für neue und vorhandene Rechnungen.
// Vorhandene Daten werden nie still geändert – ein abweichendes Datum wird als Vorschlag hinterlegt.

/** Erhöhen, wenn sich die Prüflogik ändert – dann werden alle Rechnungen einmal neu geprüft. */
export const CHECK_VERSION = 1;

type Row = typeof schema.invoices.$inferSelect;

const dupRow = (r: Pick<Row, "id" | "invoiceNumber" | "invoiceDate" | "totalGross" | "sourceKey" | "supplierId" | "vendor" | "docType">): DupRow => ({
  id: r.id,
  invoiceNumber: r.invoiceNumber,
  invoiceDate: r.invoiceDate,
  totalGross: r.totalGross,
  sourceKey: r.sourceKey,
  supplierId: r.supplierId,
  vendor: r.vendor,
  docType: r.docType,
});

/** Erkennung für eine neue Rechnung (beim Einlesen): Datum, Belegart, Hinweise. */
export function analyzeNew(text: string, fileName: string) {
  const name = parseInvoiceFileName(fileName);
  const date = extractInvoiceDate(text, name.date, todayIso());
  const doc = detectDocType(text, fileName);
  const checks: InvoiceChecks = { v: CHECK_VERSION };
  if (date.uncertain) checks.date = { uncertain: date.uncertain, suggestion: date.suggestion ?? null };
  if (doc.uncertain) checks.docType = { uncertain: doc.uncertain };
  return { invoiceDate: date.date, docType: doc.type, checks };
}

async function candidatesFor(tenantId: string, rows: Pick<Row, "invoiceNumber" | "totalGross">[]) {
  const nums = [...new Set(rows.map((r) => r.invoiceNumber).filter((n): n is string => Boolean(n)))];
  const amounts = [...new Set(rows.map((r) => r.totalGross).filter((n): n is number => n !== null))];
  if (!nums.length && !amounts.length) return [];
  const I = schema.invoices;
  return db
    .select({ id: I.id, invoiceNumber: I.invoiceNumber, invoiceDate: I.invoiceDate, totalGross: I.totalGross, sourceKey: I.sourceKey, supplierId: I.supplierId, vendor: I.vendor, docType: I.docType })
    .from(I)
    .where(
      and(
        eq(I.tenantId, tenantId),
        ne(I.status, "ignored"),
        or(
          nums.length ? sql`upper(regexp_replace(coalesce(${I.invoiceNumber}, ''), '[^A-Za-z0-9]', '', 'g')) in (${sql.join(nums.map((n) => sql`${n.toUpperCase().replace(/[^A-Z0-9]/g, "")}`), sql`, `)})` : undefined,
          amounts.length ? inArray(I.totalGross, amounts) : undefined,
        ),
      ),
    );
}

/** Mögliche Duplikate einer Rechnung (nur Hinweis). */
export async function duplicatesOf(tenantId: string, row: Pick<Row, "id" | "invoiceNumber" | "invoiceDate" | "totalGross" | "sourceKey" | "supplierId" | "vendor" | "docType">) {
  const others = await candidatesFor(tenantId, [row]);
  return findDuplicates(dupRow(row), others.map(dupRow));
}

/**
 * Prüft vorhandene Rechnungen (noch nicht mit der aktuellen Logik geprüft, oder die angegebenen):
 * Belegart setzen (außer von Hand gesetzt), Datum nur als Vorschlag, Duplikate als Hinweis.
 */
export async function recheckInvoices(tenantId: string, opts: { ids?: string[]; limit?: number } = {}) {
  const I = schema.invoices;
  const rows = await db
    .select()
    .from(I)
    .where(and(eq(I.tenantId, tenantId), opts.ids?.length ? inArray(I.id, opts.ids) : sql`coalesce((${I.checks}->>'v')::int, 0) < ${CHECK_VERSION}`))
    .limit(opts.limit ?? 500);
  if (!rows.length) return { checked: 0, flagged: 0 };
  const others = await candidatesFor(tenantId, rows);
  let flagged = 0;
  for (const r of rows) {
    const manual = r.checks.manual ?? [];
    const text = r.textExcerpt ?? "";
    const next: InvoiceChecks = { v: CHECK_VERSION, ...(manual.length ? { manual } : {}), ...(r.checks.notDuplicate ? { notDuplicate: true } : {}) };
    let docType = r.docType;
    if (!manual.includes("docType") && r.source !== "scan") {
      const d = detectDocType(text, r.fileName);
      docType = d.type;
      if (d.uncertain) next.docType = { uncertain: d.uncertain };
    }
    if (!manual.includes("date") && r.source !== "scan") {
      const name = parseInvoiceFileName(r.fileName);
      const found = extractInvoiceDate(text, name.date, todayIso());
      if (found.date && r.invoiceDate && found.date !== r.invoiceDate) {
        next.date = { uncertain: `Erkennung liest ${found.date.split("-").reverse().join(".")} statt ${r.invoiceDate.split("-").reverse().join(".")}${found.uncertain ? ` (${found.uncertain})` : ""}`, suggestion: found.uncertain ? (found.suggestion === r.invoiceDate ? null : found.date) : found.date };
      } else if (found.uncertain && (!r.invoiceDate || found.date === r.invoiceDate)) {
        next.date = { uncertain: found.uncertain, suggestion: found.suggestion && found.suggestion !== r.invoiceDate ? found.suggestion : null };
      }
    }
    if (!r.checks.notDuplicate) {
      const dups = findDuplicates(dupRow({ ...r, docType }), others.map(dupRow));
      if (dups.length) next.duplicateOf = dups;
    }
    if (next.date || next.docType || next.duplicateOf) flagged++;
    await db.update(I).set({ docType, checks: next }).where(and(eq(I.id, r.id), eq(I.tenantId, tenantId)));
  }
  return { checked: rows.length, flagged };
}

/** SQL-Bedingung: Rechnung hat einen offenen Prüfhinweis. */
export const hasOpenCheck = sql`(${schema.invoices.checks} ? 'date' or ${schema.invoices.checks} ? 'docType' or (${schema.invoices.checks} ? 'duplicateOf' and not coalesce((${schema.invoices.checks}->>'notDuplicate')::boolean, false)))`;

/**
 * SQL-Bedingung „zu prüfen“ – eine Definition für Reiter „Prüfen“, Zähler in der Navigation und die
 * Aufgabe: nicht ignoriert und (neu, zur Prüfung oder mit offenem Prüfhinweis).
 */
export const needsReview = sql`(${schema.invoices.status} <> 'ignored' and (${schema.invoices.status} in ('new', 'review') or ${hasOpenCheck}))`;
