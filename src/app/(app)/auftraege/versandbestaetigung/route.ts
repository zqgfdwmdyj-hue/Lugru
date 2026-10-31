import { getSession } from "@/lib/auth/session";
import { bestaetigungsDatei, offeneBestaetigungen } from "@/lib/orders/bestaetigung";

// Amazon-Versandbestätigung als Datei (Seller Central → Bestellungen → Bestellberichte hochladen) für alle
// FBM-Aufträge, die versendet sind, deren Versand Amazon aber nicht kennt – auch ohne Sendungsnummer
// (z. B. Prep Center). Nach dem Hochladen auf der Seite „Meldung offen“ bestätigen.
export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  const rows = await offeneBestaetigungen(session.tenantId, new Date(), { ohneWartezeit: true });
  return new Response(bestaetigungsDatei(rows), {
    headers: { "Content-Type": "text/tab-separated-values; charset=utf-8", "Content-Disposition": 'attachment; filename="Amazon_Versandbestaetigung.txt"' },
  });
}
