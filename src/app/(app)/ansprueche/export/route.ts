import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { CLAIM_STATUSES } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { CLAIM_TYPE_LABEL } from "@/lib/settings";

const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  const wanted = (new URL(request.url).searchParams.get("status") ?? "").split(",").filter((s): s is (typeof CLAIM_STATUSES)[number] => (CLAIM_STATUSES as readonly string[]).includes(s));
  const C = schema.claims;
  const rows = await db.select().from(C).where(and(eq(C.tenantId, session.tenantId), wanted.length ? inArray(C.status, wanted) : undefined));
  const header = ["Art", "Titel", "Status", "SKU", "FNSKU", "ASIN", "Menge", "EK je Einheit", "Gefordert", "Erstattet", "Referenz", "Ereignis", "Frist", "Amazon-Fall", "Notizen"];
  const lines = rows.map((c) =>
    [CLAIM_TYPE_LABEL[c.type], c.title, c.status, c.sku, c.fnsku, c.asin, c.quantity, c.unitCost?.toFixed(2).replace(".", ","), c.expectedAmount?.toFixed(2).replace(".", ","), c.reimbursedAmount?.toFixed(2).replace(".", ","), c.reference, c.eventDate, c.deadline, c.amazonCaseId, c.notes].map(q).join(";"),
  );
  return new Response("﻿" + [header.map(q).join(";"), ...lines].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="Ansprueche.csv"', "Cache-Control": "no-store" },
  });
}
