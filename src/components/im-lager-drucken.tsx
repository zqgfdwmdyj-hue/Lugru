"use client";

import { useState, useTransition } from "react";
import { dateiImLagerDruckenAction } from "@/app/(app)/drucken/actions";

// Knopf neben einem Label-PDF: als Druckauftrag an den Druckagenten im Lager (QL-1100, 102 mm) statt Browser-Druck.

export function ImLagerDrucken({ fileId, seite, text = "🖨 An QL-1100 im Lager" }: { fileId: string; seite: string; text?: string }) {
  const [laeuft, starte] = useTransition();
  const [erg, setErg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="btn" disabled={laeuft} data-testid="lager-drucken" onClick={() => starte(async () => setErg(await dateiImLagerDruckenAction(fileId, seite)))}>
        {laeuft ? "sendet …" : text}
      </button>
      {erg && <span className="small" role="status" data-testid="lager-drucken-meldung" style={{ color: erg.ok ? undefined : "var(--danger, #c0392b)" }}>{erg.text}</span>}
    </span>
  );
}
