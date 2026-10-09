import { canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { invoicePdf } from "@/lib/invoices/outgoing";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !canAccess(session, "buchhaltung")) return new Response("Kein Zugriff", { status: 403 });
  const id = Number((await ctx.params).id);
  const f = Number.isInteger(id) ? await invoicePdf(session.tenantId, id) : null;
  if (!f) return new Response("Nicht gefunden", { status: 404 });
  return new Response(Buffer.from(f.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${f.name}"` } });
}
