"use client";

import { useSearchParams } from "next/navigation";

/** Hinweis für Nur-ansehen-Konten – deutlicher, wenn gerade ein Klick abgewiesen wurde. */
export function ReadOnlyBanner() {
  const blocked = useSearchParams().get("nurlesen") === "1";
  return (
    <div className={`notice ${blocked ? "notice-warn" : "notice-info"} small`} data-testid="read-only-banner" style={{ marginBottom: 12 }}>
      {blocked ? <strong>Nicht ausgeführt – </strong> : <strong>👁 Nur ansehen – </strong>}
      dieses Konto kann nichts ändern, senden oder abfragen. Knöpfe zeigen, was es gibt, lösen aber nichts aus.
    </div>
  );
}
