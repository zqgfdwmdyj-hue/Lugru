import { canAccess } from "@/lib/auth/areas";
import { kaufOeffnen } from "@/lib/deal-eingang/kauf";
import { mobilFehler, mobilNurPost, mobilOk } from "@/lib/mobil/antwort";
import { mobilPruefen } from "@/lib/mobil/token";

// „Kaufen 17“ (Watch/Siri-Kurzbefehl): { nr: 17 } oder { text: "Kaufen 17" } → Warenkorb-Link (bzw. Produktseite) des
// Deals mit dieser Kauf-Nummer (24 Std. gültig); ohne Nummer der neueste offene Deal. Markiert „Kauf vorbereitet“.
// Der Kurzbefehl öffnet „url“ auf dem iPhone – gekauft wird erst mit „Jetzt kaufen“ in der Amazon-App.

export const dynamic = "force-dynamic";

export const GET = mobilNurPost;

export async function POST(request: Request) {
  const p = await mobilPruefen(request, "kaufen", { schreibend: true });
  if (!p.ok) return mobilFehler(p.status, p.fehler);
  if (!canAccess(p.session, "dealeingang")) return mobilFehler(403, "Kein Zugang zum Deal-Eingang.");
  const b = (await request.json().catch(() => ({}))) as { nr?: unknown; text?: unknown; produktseite?: unknown };
  const roh = typeof b.nr === "number" ? String(b.nr) : typeof b.nr === "string" ? b.nr : typeof b.text === "string" ? b.text : "";
  const zahl = roh.match(/\d{1,5}/)?.[0];
  const r = await kaufOeffnen(p.session.tenantId, { nr: zahl ? Number(zahl) : null }, { produktseite: b.produktseite === true });
  if (!r.ok) {
    const text = r.grund === "abgelaufen" ? `Deal ${zahl}: Nummer abgelaufen (24 Stunden) – bitte im Deal-Eingang öffnen.` : r.grund === "kein_link" ? "Für diesen Deal gibt es keinen Kauf-Link." : zahl ? `Deal ${zahl} nicht gefunden.` : "Kein offener Deal in den letzten 24 Stunden.";
    return mobilFehler(404, text);
  }
  const antwort = r.warenkorb ? `Deal ${r.nr ?? ""}: Warenkorb mit ${r.menge} Stück bei ${r.shop} – Jetzt kaufen tippst du selbst.` : `Deal ${r.nr ?? ""}: Produktseite bei ${r.shop} – Menge ${r.menge} wählen.${r.gutschein ? ` Code ${r.gutschein}.` : ""}`;
  return mobilOk({ antwort: antwort.replace("Deal :", "Deal:"), url: r.url, nr: r.nr, menge: r.menge, shop: r.shop, warenkorb: r.warenkorb, gutschein: r.gutschein, details: `/deal-eingang/${r.eingangId}` });
}
