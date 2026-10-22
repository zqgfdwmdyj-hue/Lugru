import { canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { formatDate } from "@/lib/numbers";
import { chargeableFrom } from "@/lib/pallets/billing";
import { MONTH_RE, loadMonthBill } from "@/lib/pallets/service";

const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const de = (n: number) => n.toFixed(2).replace(".", ",");

/** Monatsabrechnung als CSV (Excel, Semikolon). */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  if (!canAccess(session, "wawi")) return new Response("Keine Freigabe", { status: 403 });
  const raw = new URL(request.url).searchParams.get("monat") ?? "";
  const month = MONTH_RE.test(raw) ? raw : todayIso().slice(0, 7);
  const bill = await loadMonthBill(session.tenantId, month);
  const header = ["Kunde", "Palette", "Eingelagert", "Kostenpflichtig ab", "Ausgelagert", "Kostenpflichtige Tage im Monat", "Betrag (EUR)", "Notiz"];
  const lines = bill.groups.flatMap((g) =>
    g.lines.map((l) =>
      [g.customer, l.pallet.code, formatDate(l.pallet.inAt), formatDate(chargeableFrom(l.pallet.inAt, bill.rates.freeDays)), l.pallet.outAt ? formatDate(l.pallet.outAt) : "noch eingelagert", l.days, de(l.amount), l.pallet.note ?? ""].map(q).join(";"),
    ),
  );
  const sum = [q("Summe"), q(`${bill.count} Paletten`), "", "", "", "", q(de(bill.total)), ""].join(";");
  return new Response("﻿" + [header.map(q).join(";"), ...lines, sum].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="Paletten-Abrechnung-${month}.csv"`, "Cache-Control": "no-store" },
  });
}
