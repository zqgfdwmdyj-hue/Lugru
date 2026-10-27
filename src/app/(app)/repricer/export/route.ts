import { getSession } from "@/lib/auth/session";
import { repricerRows } from "@/lib/repricer";
import { isEstimated } from "@/lib/repricer-logic";

// BQool-Import: SKU, Mindestpreis, Maximalpreis. Format per ?format=bqool|de
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "de" ? "de" : "bqool";
  // Für BQool standardmäßig nur Mindestpreise mit echten Gebühren; geschätzte nur ausdrücklich (?geschaetzt=1).
  const withEstimated = format === "de" || url.searchParams.get("geschaetzt") === "1";
  const rows = (await repricerRows(session.tenantId)).filter((r) => r.min !== null && (withEstimated || !isEstimated(r)));
  const csv =
    format === "bqool"
      ? ["SKU,Min Price,Max Price", ...rows.map((r) => `"${r.sku.replace(/"/g, '""')}",${r.min!.toFixed(2)},${r.max!.toFixed(2)}`)].join("\r\n")
      : ["﻿SKU;Mindestpreis;Maximalpreis;EK;FBA-Gebühr;Gebühren geschätzt", ...rows.map((r) => [r.sku, r.min!.toFixed(2), r.max!.toFixed(2), r.unitCost?.toFixed(2) ?? "", r.fbaFee.toFixed(2), isEstimated(r) ? "ja" : "nein"].map((v) => v.replace(".", ",")).join(";"))].join("\r\n");
  return new Response(csv + "\r\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="Repricer_${format === "bqool" ? "BQool" : "Preise"}.csv"` },
  });
}
