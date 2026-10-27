import { todayIso } from "@/lib/dates";
import { loadEntries, privateSettings, requirePrivate, type PrivateKind } from "@/lib/private/service";

const KINDS: PrivateKind[] = ["intim", "paarzeit", "kinder", "ausschlafen", "auszeit", "aufgabe", "termin", "tagebuch", "beobachtung", "gespraech", "danke", "stimmung", "zustaendig", "dateidee", "routine", "medplan", "periode", "zuwendung", "ritual"];

/** Alles, was ich in „Privat“ sehen darf, als Datei (JSON) – zum Sichern. */
export async function GET() {
  const session = await requirePrivate();
  const entries = await loadEntries(session, KINDS);
  const settings = await privateSettings(session.tenantId);
  const body = {
    exportiert: new Date().toISOString(),
    hinweis: "Export aus dem Bereich „Privat“ des Seller-Systems. Vertraulich behandeln.",
    // Umfang „familie“: nur Familieninfos – keine Therapie-Angaben.
    einstellungen: session.privateScope === "familie" ? { partner: settings.partners, kinder: settings.kids } : { partner: settings.partners, kinder: settings.kids, therapie: settings.therapists },
    eintraege: entries
      .sort((a, b) => a.kind.localeCompare(b.kind) || String((a.data as { day?: string }).day ?? "").localeCompare(String((b.data as { day?: string }).day ?? "")))
      .map((e) => ({ art: e.kind, eigener: e.userId === session.userId, ...e.data })),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="privat-export-${todayIso()}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
