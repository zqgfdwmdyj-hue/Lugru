import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { parseMonthParam, prepCsv } from "@/lib/shipping/prep";
import { prepMonthRows } from "@/lib/shipping/prep-service";
import { getSettings } from "@/lib/settings";

// Sendungen des Prep Centers im Monat als CSV (Excel) – zum Abhaken gegen seine Rechnung.
export async function GET(req: Request) {
  const session = await requireArea("wawi");
  const month = parseMonthParam(new URL(req.url).searchParams.get("monat") ?? undefined, todayIso());
  const [rows, settings] = await Promise.all([prepMonthRows(session.tenantId, month), getSettings(session.tenantId)]);
  const name = (settings.prep.name || "PrepCenter").replace(/[^\w-]+/g, "_");
  return new Response(prepCsv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}_Versand_${month}.csv"`, "Cache-Control": "no-store" },
  });
}
