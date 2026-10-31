import { getSession } from "@/lib/auth/session";
import { neuesteMeldung } from "@/lib/push/service";

// Der Service Worker holt nach dem Push-Anstoß die neueste Meldung der angemeldeten Person (letzte Stunde).

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ titel: "Seller-System", text: "Neue Meldung – bitte öffnen.", link: "/" });
  const m = await neuesteMeldung(s.tenantId, s.userId);
  return Response.json(m ?? { titel: "Seller-System", text: "Neue Meldung – bitte öffnen.", link: "/" }, { headers: { "Cache-Control": "no-store" } });
}
