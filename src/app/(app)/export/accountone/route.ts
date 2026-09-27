import { getSession } from "@/lib/auth/session";
import { buildAccountOneCsv } from "@/lib/exports/accountone";
import { loadCogRows } from "@/lib/exports/cog";
import { todayIso } from "@/lib/dates";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  const account = new URL(request.url).searchParams.get("account")?.slice(0, 100) ?? null;
  const csv = buildAccountOneCsv(await loadCogRows(session.tenantId), account);
  const [y, m, d] = todayIso().split("-");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="AccountOne_COG_Export_${d}.${m}.${y}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
