import { getSession } from "@/lib/auth/session";
import { repricerRows } from "@/lib/repricer";

// BQool-Import: SKU, Mindestpreis, Maximalpreis. Format per ?format=bqool|de
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  const format = new URL(request.url).searchParams.get("format") === "de" ? "de" : "bqool";
  const rows = (await repricerRows(session.tenantId)).filter((r) => r.min !== null);
  const csv =
    format === "bqool"
      ? ["SKU,Min Price,Max Price", ...rows.map((r) => `"${r.sku.replace(/"/g, '""')}",${r.min!.toFixed(2)},${r.max!.toFixed(2)}`)].join("\r\n")
      : ["﻿SKU;Mindestpreis;Maximalpreis;EK;FBA-Gebühr", ...rows.map((r) => [r.sku, r.min!.toFixed(2), r.max!.toFixed(2), r.unitCost?.toFixed(2) ?? "", r.fbaFee.toFixed(2)].map((v) => v.replace(".", ",")).join(";"))].join("\r\n");
  return new Response(csv + "\r\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="Repricer_${format === "bqool" ? "BQool" : "Preise"}.csv"` },
  });
}
