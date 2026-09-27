import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { downloadFile, driveToken } from "@/lib/integrations/clients/drive";
import { getIntegration } from "@/lib/integrations/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Nicht gefunden", { status: 404 });
  const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.tenantId, session.tenantId)));
  if (!inv) return new Response("Nicht gefunden", { status: 404 });
  let bytes: Buffer | null = null;
  if (inv.fileId) {
    const [f] = await db.select().from(schema.files).where(eq(schema.files.id, inv.fileId));
    bytes = f?.data ?? null;
  } else if (inv.source === "drive" && inv.externalId) {
    const cfg = await getIntegration(session.tenantId, "google_drive");
    if (cfg?.serviceAccountJson) bytes = await downloadFile(await driveToken(cfg.serviceAccountJson), inv.externalId);
  }
  if (!bytes) return new Response("PDF nicht verfügbar", { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${inv.fileName.replace(/"/g, "")}"`, "Cache-Control": "private, max-age=3600" } });
}
