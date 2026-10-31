import { todayIso } from "@/lib/dates";
import { einsaetzeCsv } from "@/lib/private/haushaltshilfe";
import { haushaltshilfeMonat } from "@/lib/private/haushaltshilfe-service";
import { requirePrivate } from "@/lib/private/service";

/** Monatsauswertung Babysitter & Putzhilfe als CSV – nur mit vollem Privat-Zugang. */
export async function GET(req: Request) {
  const session = await requirePrivate({ full: true });
  const m = new URL(req.url).searchParams.get("monat") ?? "";
  const monat = /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : todayIso().slice(0, 7);
  const d = await haushaltshilfeMonat(session, monat, todayIso());
  return new Response(einsaetzeCsv(d.einsaetze, monat), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="babysitter-putzhilfe-${monat}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
