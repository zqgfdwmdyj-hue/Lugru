import Link from "next/link";

export type KpiState = "ok" | "unvollstaendig" | "fehlt";

const STATE_TAG: Record<KpiState, { cls: string; label: string }> = {
  ok: { cls: "tag-ok", label: "vollständig" },
  unvollstaendig: { cls: "tag-warn", label: "unvollständig" },
  fehlt: { cls: "tag-danger", label: "Daten fehlen" },
};

/**
 * Kennzahl mit Herkunft: Wert, Zustand (vollständig / unvollständig / Daten fehlen), was fehlt (mit Link zur
 * Korrektur), Zeitraum, Datenquelle und Stand. So wirkt eine Zahl aus unvollständigen Daten nie wie eine fertige.
 */
export function Kpi({
  label,
  value,
  state,
  note,
  missing,
  fixHref,
  fixLabel = "nachtragen",
  period,
  source,
  stand,
  danger,
  testid,
}: {
  label: string;
  value: React.ReactNode;
  state?: KpiState;
  note?: React.ReactNode;
  missing?: string[];
  fixHref?: string;
  fixLabel?: string;
  period?: string;
  source?: string;
  stand?: string;
  danger?: boolean;
  testid?: string;
}) {
  const tag = state ? STATE_TAG[state] : null;
  return (
    <div className="card card-pad kpi-card" data-testid={testid}>
      <div className="kpi-head">
        <span className="kpi-label">{label}</span>
        {tag && state !== "ok" && <span className={`tag ${tag.cls}`} data-testid={testid ? `${testid}-state` : undefined}>{tag.label}</span>}
      </div>
      <div className="kpi-value" style={{ color: danger ? "var(--danger)" : state === "fehlt" ? "var(--muted)" : undefined }}>{value}</div>
      {note && <div className="small muted">{note}</div>}
      {missing && missing.length > 0 && (
        <div className="small kpi-missing">
          Fehlt: {missing.join(" · ")}
          {fixHref && (
            <>
              {" "}
              <Link href={fixHref}>{fixLabel} →</Link>
            </>
          )}
        </div>
      )}
      {(period || source || stand) && (
        <div className="kpi-meta">
          {[period, source, stand ? `Stand ${stand}` : null].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
}

/**
 * Herkunft einer Gruppe von Kennzahlen – unter die Kacheln: Zeitraum · Quelle · Stand (und Hinweis, wenn der letzte
 * Abruf fehlschlug). Die Kacheln stehen dann in einem Element mit `data-kpi-group`.
 */
export function KpiMeta({ period, source, stand, fehler, testid = "kpi-meta" }: { period?: string; source: string; stand: string; fehler?: string | null; testid?: string }) {
  return (
    <div className="kpi-meta" data-testid={testid}>
      {period && <>Zeitraum: {period} · </>}Quelle: {source} · Stand: {stand}
      {fehler && (
        <span style={{ color: "var(--warn)" }} title={fehler}>
          {" "}
          · letzter Abruf fehlgeschlagen
        </span>
      )}
    </div>
  );
}
