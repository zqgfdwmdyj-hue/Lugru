"use client";

import { useSearchParams } from "next/navigation";

/** Sichtbarer Hinweis, wenn ein Bereich gesperrt war und man umgeleitet wurde (auch am Handy, wo das Menü zu ist). */
export function LockedBanner() {
  const why = useSearchParams().get("gesperrt");
  if (why !== "1" && why !== "inhaber") return null;
  return (
    <div className="notice notice-warn small" data-testid="locked-banner" style={{ marginBottom: 12 }}>
      <strong>Kein Zugriff – </strong>
      {why === "inhaber"
        ? "Einstellungen, Anbindungen und Benutzer kann nur der Inhaber öffnen. Du wurdest zu deiner Startseite geleitet."
        : "dieser Bereich ist für dein Konto nicht freigegeben. Freigeben kann ihn der Inhaber unter Einstellungen → Benutzer."}
    </div>
  );
}
