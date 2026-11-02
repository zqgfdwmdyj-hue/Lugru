import type { ReactNode } from "react";
import { betrifftSchnellAction } from "@/app/(app)/kalender/tagesplan/actions";

// Familienkalender: Termin mit einem Tipp zuordnen – ich / Familie / andere Person. Betrifft er nur die andere
// Person, blockt er die eigene Zeit (Tagesplan, Start, Fahrzeit) nicht mehr. Gilt für die ganze Serie.

type Wert = "a" | "b" | "familie";

export function BetrifftKnoepfe({
  eventId,
  aktuell,
  quelle,
  partner,
  ich,
  felder,
  ziel,
}: {
  eventId: string;
  aktuell: Wert;
  quelle: "gesetzt" | "titel" | "standard";
  partner: { a: string; b: string };
  ich: "a" | "b" | null;
  /** Versteckte Felder für den Rücksprung (Tagesplan: tag/privat). */
  felder?: ReactNode;
  /** Rücksprung auf eine Kalender-Adresse (z. B. „/kalender?monat=…&tag=…“). */
  ziel?: string;
}) {
  const andere = ich === "a" ? "b" : ich === "b" ? "a" : null;
  const name = (k: "a" | "b") => partner[k] || (k === "a" ? "Person A" : "Person B");
  // Reihenfolge aus Sicht der angemeldeten Person: ich – Familie – die andere Person.
  const knoepfe: { wert: Wert; text: string }[] = ich && andere
    ? [{ wert: ich, text: `${name(ich)} (ich)` }, { wert: "familie", text: "Beide" }, { wert: andere, text: `nur ${name(andere)}` }]
    : [{ wert: "a", text: name("a") }, { wert: "familie", text: "Beide" }, { wert: "b", text: name("b") }];
  return (
    <form action={betrifftSchnellAction} className="betrifft-knoepfe" data-testid="betrifft-schnell" aria-label="Wen betrifft der Termin?">
      {felder}
      {ziel && <input type="hidden" name="ziel" value={ziel} />}
      <input type="hidden" name="eventId" value={eventId} />
      <span className="small muted">betrifft:</span>
      {knoepfe.map((k) => (
        <button
          key={k.wert}
          type="submit"
          name="betrifft"
          value={k.wert}
          className={`chip${aktuell === k.wert ? " active" : ""}`}
          aria-pressed={aktuell === k.wert}
          title={aktuell === k.wert && quelle !== "gesetzt" ? (quelle === "titel" ? "erkannt am Vornamen im Titel" : "noch nicht zugeordnet – zählt für beide") : undefined}
          data-testid={`betrifft-schnell-${k.wert}`}
        >
          {k.text}
        </button>
      ))}
      {quelle === "gesetzt" && (
        <button type="submit" name="betrifft" value="automatisch" className="chip" title="Zuordnung löschen – wieder am Vornamen im Titel erkennen" data-testid="betrifft-schnell-automatisch">
          ↺
        </button>
      )}
    </form>
  );
}
