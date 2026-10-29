import { requireArea } from "@/lib/auth/session";
import { LAENDER } from "@/lib/amazon-markt/logic";
import { staffelDatei } from "@/lib/amazon-business/service";

// Upload-Datei „Preis und Menge“ (Amazon Business) mit den freigegebenen Staffelpreisen eines Landes.
export async function GET(req: Request) {
  const s = await requireArea("amazon");
  const land = new URL(req.url).searchParams.get("land") ?? "DE";
  if (!(LAENDER as string[]).includes(land)) return new Response("Land unbekannt", { status: 400 });
  const d = await staffelDatei(s.tenantId, land);
  if (!d.anzahl) return new Response("Keine freigegebenen Staffelpreise für dieses Land.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(d.text, {
    headers: {
      "Content-Type": "text/tab-separated-values; charset=utf-8",
      "Content-Disposition": `attachment; filename="staffelpreise-${land}.txt"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
