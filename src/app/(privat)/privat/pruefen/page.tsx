import Link from "next/link";
import { requirePrivate } from "@/lib/private/service";
import { currentLinkIssues } from "@/lib/private/save";
import { repairLinkAction } from "../eintrag-actions";
import { PrivatHead } from "../ui";

/**
 * Verknüpfte Auszeit/Kinderzeit prüfen: Widersprüche (z. B. beide Seiten bei derselben Person) mit
 * Reparatur-Vorschlägen. Geändert wird erst nach Klick – der empfohlene Vorschlag steht zuerst.
 */
export default async function PruefenPage({ searchParams }: { searchParams: Promise<{ ok?: string; fehler?: string }> }) {
  const session = await requirePrivate();
  const sp = await searchParams;
  const issues = await currentLinkIssues(session);
  return (
    <>
      <PrivatHead active="kalender" title="Verknüpfungen prüfen" />
      {sp.ok && <div className="notice notice-ok small" role="status">{sp.ok}</div>}
      {sp.fehler && <div className="notice notice-warn small" role="status">{sp.fehler}</div>}
      <p className="small muted">Auszeit und Kinderzeit, die als ein Vorgang eingetragen wurden, gehören zusammen: dieselbe Zeit, dieselbe Planung, und die Kinder sind bei der jeweils anderen Person. Hier steht, wo das nicht mehr stimmt. Geändert wird erst, wenn du eine Variante wählst – die empfohlene (zuletzt bearbeitete Seite) steht zuerst.</p>
      {issues.length === 0 ? (
        <div className="notice notice-ok small" data-testid="link-ok">Alles stimmig – keine widersprüchlichen Verknüpfungen.</div>
      ) : (
        <div className="stack" data-testid="link-issues">
          {issues.map((i) => (
            <section key={i.key} className="card card-pad stack" style={{ gap: 8 }} data-testid="link-issue">
              <div>{i.text}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {i.fixes.map((f, n) => (
                  <form key={n} action={repairLinkAction}>
                    <input type="hidden" name="key" value={i.key} />
                    <input type="hidden" name="fix" value={n} />
                    <button className={`btn btn-small${n === 0 ? " btn-primary" : ""}`} type="submit" data-testid={`link-fix-${n}`}>{f.label}{n === 0 ? " (empfohlen)" : ""}</button>
                  </form>
                ))}
              </div>
              <div className="small">
                {[...i.auszeitIds.map((id) => ({ id, label: "Auszeit öffnen" })), ...i.kinderIds.map((id) => ({ id, label: "Kinderzeit öffnen" }))].map((x) => (
                  <Link key={x.id} href={`/privat/eintrag/${x.id}`} style={{ marginRight: 12 }}>{x.label}</Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <Link className="small" href="/privat/kalender">← Kalender</Link>
    </>
  );
}
