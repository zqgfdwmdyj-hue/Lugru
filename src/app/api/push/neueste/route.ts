import { getSession } from "@/lib/auth/session";
import { neuesteMeldung } from "@/lib/push/service";

// Der Service Worker holt nach dem Push-Anstoß die neueste Meldung der angemeldeten Person (letzte Stunde) – mit der
// Adresse seines Abos, damit Test-Pushs nur auf dem gemeinten Gerät erscheinen. Abholen = „zugestellt“ im Protokoll.

export const dynamic = "force-dynamic";

const LEER = { titel: "Seller-System", text: "Neue Meldung – bitte öffnen.", link: "/" };

export async function GET(request: Request) {
  const s = await getSession();
  if (!s) return Response.json(LEER);
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  const m = await neuesteMeldung(s.tenantId, s.userId, endpoint && endpoint.length <= 2000 ? endpoint : null);
  return Response.json(m ?? LEER, { headers: { "Cache-Control": "no-store" } });
}
