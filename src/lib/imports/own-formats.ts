import "server-only";
import type { Table } from "@/lib/tabular";
import type { FileResult } from "./dispatch";

// Eigene CSV-Vorlagen (Aufträge aus eBay/TikTok/Temu, Planposten). Werden in den
// jeweiligen Modulen ergänzt.

export type OwnImportKind = string;

type Handler = {
  kind: string;
  detect: (table: Table) => boolean;
  apply: (opts: { tenantId: string; userId: string; fileName: string; table: Table }) => Promise<FileResult>;
};

const handlers: Handler[] = [];

export function registerOwnImport(h: Handler) {
  if (!handlers.some((x) => x.kind === h.kind)) handlers.push(h);
}

export function detectOwnImport(table: Table): string | null {
  return handlers.find((h) => h.detect(table))?.kind ?? null;
}

export async function applyOwnImport(opts: { tenantId: string; userId: string; fileName: string; table: Table; kind: string }) {
  const h = handlers.find((x) => x.kind === opts.kind)!;
  return h.apply(opts);
}
