import "server-only";
import { getSession, type Session } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/areas";

// Zugang für die Schnittstelle der Station (Route-Handler): Sitzung, Bereich „Amazon FBA“, schreibend nur ohne
// Nur-ansehen-Konto. Antworten als JSON statt Weiterleitung, weil die Seite per fetch fragt.

export async function stationZugang(schreiben: boolean): Promise<{ session: Session } | { antwort: Response }> {
  const session = await getSession();
  if (!session) return { antwort: Response.json({ fehler: "Nicht angemeldet – bitte neu anmelden." }, { status: 401 }) };
  if (!canAccess(session, "amazon")) return { antwort: Response.json({ fehler: "Für die Retouren-Station fehlt die Freigabe „Amazon FBA“." }, { status: 403 }) };
  if (schreiben && session.readOnly) return { antwort: Response.json({ fehler: "Nur-ansehen-Konto: an der Station nichts ändern." }, { status: 403 }) };
  return { session };
}
