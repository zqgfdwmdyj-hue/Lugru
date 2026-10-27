import { spellingGroups, suspiciousName } from "@/lib/masterdata";

/**
 * Stammdaten prüfen: gleiche Firma/Marke in mehreren Schreibweisen und auffällige Angaben. Nur Hinweise –
 * zusammengeführt oder geändert wird nichts automatisch.
 */
export function SpellingCheck({ title, groups, suspicious }: { title: string; groups: ReturnType<typeof spellingGroups>; suspicious: { name: string; why: string; n: number }[] }) {
  const total = groups.length + suspicious.length;
  if (!total) return null;
  return (
    <details className="card card-pad small" data-testid="spelling-check">
      <summary style={{ cursor: "pointer" }}><strong>{title}: {total} Hinweis{total === 1 ? "" : "e"}</strong> <span className="muted">– uneinheitliche Schreibweisen, auffällige Angaben (nichts wird automatisch geändert)</span></summary>
      {groups.length > 0 && (
        <>
          <div className="muted" style={{ marginTop: 8 }}>Vermutlich gleich (ohne Rechtsform, Groß/klein, Satzzeichen verglichen):</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }} data-testid="spelling-groups">
            {groups.slice(0, 40).map((g) => (
              <li key={g.key}>{g.names.map((x) => `${x.name} (${x.n})`).join(" · ")}</li>
            ))}
          </ul>
          {groups.length > 40 && <div className="muted">… und {groups.length - 40} weitere.</div>}
        </>
      )}
      {suspicious.length > 0 && (
        <>
          <div className="muted" style={{ marginTop: 8 }}>Auffällige Angaben:</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }} data-testid="spelling-suspicious">
            {suspicious.slice(0, 30).map((x) => <li key={x.name}>„{x.name}“ ({x.n}×) – {x.why}</li>)}
          </ul>
        </>
      )}
    </details>
  );
}

/** Auffällige Namen zählen (für SpellingCheck). */
export function suspiciousOf(values: (string | null | undefined)[]) {
  const m = new Map<string, { why: string; n: number }>();
  for (const v of values) {
    const t = (v ?? "").trim();
    const why = suspiciousName(t);
    if (!why) continue;
    m.set(t, { why, n: (m.get(t)?.n ?? 0) + 1 });
  }
  return [...m].map(([name, x]) => ({ name, ...x })).sort((a, b) => b.n - a.n);
}
