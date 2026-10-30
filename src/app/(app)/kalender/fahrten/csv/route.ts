import { requireSession } from "@/lib/auth/session";
import { fahrtenCsv, fahrtenListe } from "@/lib/mobil/fahrten";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = await requireSession();
  if (s.role !== "owner") return new Response("Kein Zugriff.", { status: 403 });
  const w = new URL(req.url).searchParams.get("woche") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w)) return new Response("Woche fehlt.", { status: 400 });
  const von = new Date(`${w}T00:00:00Z`);
  const csv = fahrtenCsv(await fahrtenListe(s.tenantId, von, new Date(von.getTime() + 7 * 86_400_000)));
  return new Response(`﻿${csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fahrtenbuch-${w}.csv"`, "Cache-Control": "no-store" } });
}
