import { canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { formatDate } from "@/lib/numbers";
import { chargeableFrom } from "@/lib/pallets/billing";
import { MONTH_RE, loadMonthBill } from "@/lib/pallets/service";
import { getSettings } from "@/lib/settings";

const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const de = (n: number) => n.toFixed(2).replace(".", ",");

/** Monatsabrechnung als CSV (Excel, Semikolon): Paletten mit Lager und Ein/Aus, danach Zusatzleistungen. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  if (!canAccess(session, "paletten")) return new Response("Keine Freigabe", { status: 403 });
  const raw = new URL(request.url).searchParams.get("monat") ?? "";
  const month = MONTH_RE.test(raw) ? raw : todayIso().slice(0, 7);
  const bill = await loadMonthBill(session.tenantId, month);
  const net = (await getSettings(session.tenantId)).pallets.pricesAre !== "brutto";
  const unit = net ? "EUR netto" : "EUR brutto";
  const header = ["Kunde", "Palette / Leistung", "Stellplatz", "Inhalt", "Eingelagert", "Kostenpflichtig ab", "Ausgelagert", "Kostenpflichtige Tage im Monat", `Lager (${unit})`, `Ein/Aus (${unit})`, `Betrag (${unit})`, "Notiz"];
  const lines = bill.groups.flatMap((g) => [
    ...g.lines.map((l) =>
      [g.customer, l.pallet.code, l.pallet.location ?? "", l.pallet.contents ?? "", formatDate(l.pallet.inAt), formatDate(chargeableFrom(l.pallet.inAt, g.rates.freeDays)), l.pallet.outAt ? formatDate(l.pallet.outAt) : "noch eingelagert", l.days, de(l.storage), de(l.inFee + l.outFee), de(l.amount), l.pallet.note ?? ""]
        .map(q)
        .join(";"),
    ),
    ...g.services.map((s) =>
      [g.customer, `${s.charge.description} (${String(s.charge.quantity).replace(".", ",")} × ${de(s.charge.unitPrice)})`, "", s.charge.palletCode ?? "", formatDate(s.charge.day), "", "", "", "", "", de(s.amount), "Zusatzleistung"].map(q).join(";"),
    ),
  ]);
  const sum = [q("Summe"), q(`${bill.count} Paletten`), "", "", "", "", "", "", q(de(bill.storage)), q(de(bill.fees)), q(de(bill.total)), q(bill.services ? `davon Leistungen ${de(bill.services)}` : "")].join(";");
  return new Response("﻿" + [header.map(q).join(";"), ...lines, sum].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="Paletten-Abrechnung-${month}.csv"`, "Cache-Control": "no-store" },
  });
}
