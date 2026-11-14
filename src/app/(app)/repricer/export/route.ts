import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { repricerRows } from "@/lib/repricer";
import { isEstimated } from "@/lib/repricer-logic";

// Bestandsliste als Tabelle (deutsch): SKU, Mindest-/Maximalpreis (EK + Gebühren + Mindestgewinn), EK, FBA-Gebühr.
// Die Datei für ProfitGuard (Soll-Min nach Marge je Altersstufe) gibt es unter Repricer → ProfitGuard-Datei.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  const url = new URL(request.url);
  if (url.searchParams.get("format") !== "de") redirect("/repricer/profitguard");
  const rows = (await repricerRows(session.tenantId)).filter((r) => r.min !== null);
  const csv = ["﻿SKU;Mindestpreis;Maximalpreis;EK;FBA-Gebühr;Gebühren geschätzt", ...rows.map((r) => [r.sku, r.min!.toFixed(2), r.max!.toFixed(2), r.unitCost?.toFixed(2) ?? "", r.fbaFee.toFixed(2), isEstimated(r) ? "ja" : "nein"].map((v) => v.replace(".", ",")).join(";"))].join("\r\n");
  return new Response(csv + "\r\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="Repricer_Preise.csv"' } });
}
