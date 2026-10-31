import { canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { customerKey } from "@/lib/pallets/billing";
import { MONTH_RE, loadMonthBill } from "@/lib/pallets/service";
import { buildStatementPdf, statementMail } from "@/lib/pallets/statement";
import { getSettings } from "@/lib/settings";

/** Monatsaufstellung eines Kunden als PDF (dasselbe, was per Mail rausgeht). */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  if (!canAccess(session, "paletten")) return new Response("Keine Freigabe", { status: 403 });
  const sp = new URL(request.url).searchParams;
  const month = sp.get("monat") ?? "";
  const kunde = (sp.get("kunde") ?? "").trim();
  if (!MONTH_RE.test(month) || !kunde) return new Response("Monat oder Kunde fehlt", { status: 400 });
  const bill = await loadMonthBill(session.tenantId, month);
  const group = bill.groups.find((g) => customerKey(g.customer) === customerKey(kunde));
  if (!group) return new Response("Für diesen Kunden ist im Monat nichts abzurechnen.", { status: 404 });
  const all = await getSettings(session.tenantId);
  const s = all.shipper;
  const pdf = await buildStatementPdf({
    vat: { rate: all.vatRate, pricesAre: all.pallets.pricesAre ?? "netto" },
    sender: { name: s.name1, street: s.street, houseNo: s.houseNo, zip: s.zip, city: s.city, email: s.email, phone: s.phone },
    month,
    group,
    today: todayIso(),
  });
  const { filename } = statementMail({ customer: group.customer, month, group });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      // Umlaute & Co. nur in filename* – im einfachen Header-Feld sind nur einfache Zeichen erlaubt.
      "Content-Disposition": `inline; filename="${filename.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
