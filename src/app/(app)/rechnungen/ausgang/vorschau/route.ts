import { canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { ebayDb } from "@/lib/ebay/db/pg";
import { buildB2bInvoiceData, checkB2bInput } from "@/lib/ebay/invoices/b2b";
import { renderInvoicePdf } from "@/lib/ebay/invoices/pdf";
import { getInvoiceSettings } from "@/lib/ebay/invoices/store";
import { b2bInputFromForm } from "@/lib/invoices/b2b-form";

export const dynamic = "force-dynamic";

/** Vorschau einer B2B-Rechnung als PDF – ohne Nummer, nichts wird gespeichert. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !canAccess(session, "buchhaltung")) return new Response("Kein Zugriff", { status: 403 });
  const input = b2bInputFromForm(await req.formData());
  const s = await getInvoiceSettings(ebayDb(session.tenantId));
  const problems = checkB2bInput(input, s);
  if (problems.length) return new Response(`Vorschau nicht möglich:\n\n${problems.join("\n")}`, { status: 422, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const data = buildB2bInvoiceData(input, s, { number: "ENTWURF", date: new Date().toISOString(), orderId: "Vorschau" });
  const pdf = await renderInvoicePdf(data);
  return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="Vorschau.pdf"' } });
}
