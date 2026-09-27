// AccountOne-COG-Export im selben Format wie Arbitrage One:
//   "marketplace_article_nr","article_nr","ek_netto_euro"[,"source_account_id"]
// Komma getrennt, jedes Feld in Anführungszeichen, Dezimalpunkt, Windows-Zeilenenden.

export type CogRow = { asin: string; sku: string; unitCostNet: number };

const q = (v: string) => `"${v.replace(/"/g, '""')}"`;

export function formatCost(n: number): string {
  // Wie im Original ohne überflüssige Nullen: 12.6 statt 12.60.
  return String(Math.round(n * 100) / 100);
}

export function buildAccountOneCsv(rows: CogRow[], sourceAccountId?: string | null): string {
  const withAccount = Boolean(sourceAccountId && sourceAccountId.trim());
  const header = ["marketplace_article_nr", "article_nr", "ek_netto_euro"];
  if (withAccount) header.push("source_account_id");
  const lines = [header.map(q).join(",")];
  for (const r of rows) {
    const cells = [r.asin, r.sku, formatCost(r.unitCostNet)];
    if (withAccount) cells.push(sourceAccountId!.trim());
    lines.push(cells.map(q).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
