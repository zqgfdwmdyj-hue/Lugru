import { getSession } from "@/lib/auth/session";
import { CLAIM_STATUS_LABEL } from "@/lib/claims/labels";
import { formatDate } from "@/lib/numbers";
import { filterRows } from "@/lib/returns/filters";
import { loadReturnRows } from "@/lib/returns/service";

const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const de = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toFixed(2).replace(".", ","));

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  const sp = new URL(request.url).searchParams;
  const mode = sp.get("modus") === "fbm" ? "fbm" : "fba";
  const view = await loadReturnRows(session.tenantId, mode);
  const rows = filterRows(view.rows, sp.get("filter") ?? "all", sp.get("q") ?? "");
  const header = ["Status", "Bestellnummer", "SKU", "Artikel", mode === "fba" ? "Erstattet am" : "Angefragt am", "Tage", "Erstattet", "Menge erstattet", "Menge zurück", "Von Amazon", "Offen", "Anspruch", "Fallnummer", "Details"];
  const lines = rows.map((r) =>
    [
      r.label,
      r.orderId,
      r.sku,
      r.title,
      formatDate(r.date),
      r.days ?? "",
      de(r.amount),
      r.qtyRefunded,
      r.qtyReturned,
      de(r.amazon?.amount),
      de(r.open),
      r.claims.map((c) => CLAIM_STATUS_LABEL[c.status][0]).join(", "),
      r.claims.map((c) => c.amazonCaseId ?? "").filter(Boolean).join(", "),
      r.detail.join(" · "),
    ]
      .map(q)
      .join(";"),
  );
  return new Response("﻿" + [header.map(q).join(";"), ...lines].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="Retouren-Abgleich-${mode.toUpperCase()}.csv"`, "Cache-Control": "no-store" },
  });
}
