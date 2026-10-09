import { canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { invoiceXml } from "@/lib/invoices/outgoing";

export const dynamic = "force-dynamic";

/** E-Rechnung (EN 16931, CII) einer B2B-Rechnung. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !canAccess(session, "buchhaltung")) return new Response("Kein Zugriff", { status: 403 });
  const id = Number((await ctx.params).id);
  const f = Number.isInteger(id) ? await invoiceXml(session.tenantId, id) : null;
  if (!f) return new Response("Nicht gefunden", { status: 404 });
  return new Response(f.xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${f.name}"` } });
}
