import "server-only";
import { applyImport } from "@/lib/imports/apply";
import { ImportFormatError, parseArbitrageOne, readSheet } from "@/lib/imports/arbitrageone";
import { detectReport, REPORT_KINDS } from "@/lib/reports/amazon";
import { applyReport } from "@/lib/reports/apply";
import { getSettings } from "@/lib/settings";
import { formatVorschlag, spaltenProtokoll, vorschlagText } from "@/lib/reports/format-vorschlag";
import { readTable } from "@/lib/tabular";
import "@/lib/hooks-registry";
import { detectOwnImport, applyOwnImport } from "./own-formats";

export type FileResult = {
  fileName: string;
  ok: boolean;
  label?: string;
  summary: string;
  hints?: string[];
  /** Amazon-Bericht: Art und Zahlen für den Datei-Import (import_status). */
  report?: { kind: string; rows: number; inserted: number; details?: Record<string, unknown> };
};

const A1_LABEL = { sellerboard: "Arbitrage One – Sellerboard-Export", accountone: "Arbitrage One – AccountOne COG", template: "Arbitrage One – eigene Vorlage" };

export async function importAnyFile(opts: { tenantId: string; userId: string; fileName: string; bytes: Uint8Array }): Promise<FileResult> {
  const { tenantId, userId, fileName, bytes } = opts;

  // 1. Arbitrage One
  try {
    const parsed = parseArbitrageOne(readSheet(bytes));
    if (parsed.rows.length === 0) return { fileName, ok: false, label: A1_LABEL[parsed.source], summary: "Keine Zeilen mit SKU gefunden." };
    const settings = await getSettings(tenantId);
    const s = await applyImport({ tenantId, userId, fileName, parsed, vatRate: settings.vatRate });
    const hints: string[] = [];
    if (s.returnsInherited) hints.push(`${s.returnsInherited} Retouren mit geerbtem EK`);
    if (s.returnsWithoutOrigin) hints.push(`${s.returnsWithoutOrigin} Retouren ohne Ursprungs-Charge`);
    if (s.costConflicts) hints.push(`${s.costConflicts} EK-Abweichungen zwischen Exporten`);
    if (s.skipped.length) hints.push(`${s.skipped.length} Zeilen übersprungen`);
    return {
      fileName,
      ok: true,
      label: A1_LABEL[s.source],
      summary: `${s.rows} Chargen: ${s.created} neu, ${s.updated} aktualisiert.`,
      hints,
    };
  } catch (e) {
    if (!(e instanceof ImportFormatError)) throw e;
  }

  const table = readTable(bytes);
  if (table.headers.length === 0) return { fileName, ok: false, summary: "Die Datei ist leer." };

  // 2. Amazon-Reports
  const kind = detectReport(table);
  if (kind) {
    const r = await applyReport({ tenantId, userId, fileName, kind, table });
    return {
      fileName,
      ok: true,
      label: REPORT_KINDS[kind],
      summary: `${r.rows} Zeilen gelesen, ${r.inserted} neu.${r.message ? ` ${r.message}.` : ""}`,
      report: { kind, rows: r.rows, inserted: r.inserted, details: r.details },
    };
  }

  // 3. Eigene Vorlagen (Aufträge, Planposten …)
  const own = detectOwnImport(table);
  if (own) return applyOwnImport({ tenantId, userId, fileName, table, kind: own });

  const vorschlag = formatVorschlag(table.headers);
  return {
    fileName,
    ok: false,
    summary: `Format nicht erkannt.${vorschlag ? ` ${vorschlagText(vorschlag)}` : ""}`,
    // Vollständige Spaltenliste fürs Protokoll unbekannter Formate (Uploads → „Unbekannte Formate“), damit die Art nachgebaut werden kann.
    hints: [spaltenProtokoll(table.headers)],
  };
}
