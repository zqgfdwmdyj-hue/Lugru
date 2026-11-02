import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { canAccess } from "@/lib/auth/areas";
import type { Session } from "@/lib/auth/session";
import { WATCH_AENDERND, WATCH_HILFE, watchAntwort, watchBefehl, type WatchBefehl } from "./watch-logic";
import type { WatchErgebnis } from "./watch";

// Ein Kurzbefehl für alles: freies Diktat → passender Watch-Befehl (stand, dringend, erledigt, notiz, deal, bestand,
// tesla, kaufen, „Nummer 2“ für eine offene Rückfrage). Gleiche Rechte und Regeln wie die einzelnen Befehle.

export type WatchFrageErgebnis = WatchErgebnis & { befehl: WatchBefehl | null; url?: string };

const BEFEHL_TEXT: Record<WatchBefehl, string> = { stand: "Wie läuft's", dringend: "Was ist dringend", tesla: "Tesla", deal: "Deal prüfen", erledigt: "Erledigt", notiz: "Notiz", bestand: "Bestand", kaufen: "Kaufen", nummer: "Auswahl (Nummer)" };
export const befehlText = (b: WatchBefehl | null) => (b ? BEFEHL_TEXT[b] : "nicht erkannt");

const nein = (befehl: WatchBefehl | null, text: string): WatchFrageErgebnis => ({ ok: false, befehl, ...watchAntwort([text]) });

/**
 * `aendernErlaubt` = false: nur lesende Befehle ausführen (z. B. „Ausprobieren“ in den Einstellungen oder GET);
 * ändernde werden erkannt und benannt, aber nicht ausgeführt.
 */
export async function watchFrage(session: Session, textIn: string, o: { tokenId?: string | null; aendernErlaubt: boolean }): Promise<WatchFrageErgebnis> {
  const { befehl, text } = watchBefehl(textIn);
  if (!befehl) return nein(null, WATCH_HILFE);
  if (WATCH_AENDERND.includes(befehl) && !o.aendernErlaubt) return nein(befehl, `Erkannt: ${BEFEHL_TEXT[befehl]}. Ändernde Befehle nur über die Uhr bzw. den Kurzbefehl (POST).`);
  const w = await import("./watch");
  const mit = (r: WatchErgebnis): WatchFrageErgebnis => ({ ...r, befehl });
  switch (befehl) {
    case "stand":
      return mit(await w.watchStand(session));
    case "dringend":
      return mit(await w.watchDringend(session));
    case "tesla":
      return mit(await w.watchTesla(session));
    case "deal":
      return mit(await w.watchDeal(session, text));
    case "erledigt":
      return mit(await w.watchErledigt(session, text));
    case "notiz":
      return mit(await w.watchNotiz(session, text, { tokenId: o.tokenId ?? null }));
    case "bestand":
      return mit(await w.watchBestand(session, text));
    case "nummer": {
      // „Nummer 2“ beantwortet die jüngste offene Rückfrage (Erledigt oder Bestand) dieser Person.
      const R = schema.watchRueckfragen;
      const [r] = await db.select({ art: R.art }).from(R).where(and(eq(R.tenantId, session.tenantId), eq(R.userId, session.userId))).orderBy(desc(R.createdAt)).limit(1);
      if (!r) return nein(befehl, "Keine offene Rückfrage – bitte den Befehl neu sagen.");
      return mit(r.art === "bestand" ? await w.watchBestand(session, text) : await w.watchErledigt(session, text));
    }
    case "kaufen": {
      if (!canAccess(session, "dealeingang")) return nein(befehl, "Kein Zugang zum Deal-Eingang.");
      const zahl = text.match(/\d{1,5}/)?.[0];
      const { kaufOeffnen } = await import("@/lib/deal-eingang/kauf");
      const r = await kaufOeffnen(session.tenantId, { nr: zahl ? Number(zahl) : null });
      if (!r.ok) return nein(befehl, r.grund === "abgelaufen" ? `Deal ${zahl}: Nummer abgelaufen (24 Std.).` : r.grund === "kein_link" ? "Für diesen Deal gibt es keinen Kauf-Link." : zahl ? `Deal ${zahl} nicht gefunden.` : "Kein offener Deal in den letzten 24 Stunden.");
      const zeile = r.warenkorb ? `Deal ${r.nr ?? ""}: Warenkorb mit ${r.menge} Stück bei ${r.shop} – öffnet auf dem iPhone.` : `Deal ${r.nr ?? ""}: Produktseite bei ${r.shop} – Menge ${r.menge}.`;
      return { ok: true, befehl, url: r.url, geaendert: true, ...watchAntwort([zeile.replace("Deal :", "Deal:")]) };
    }
  }
}
