import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { ausgehendListe, nachfassTage } from "@/lib/inbox/ausgang";
import { nachfassenAction, nachfassenPruefenAction } from "../actions";

// B32.5 Ausgehend: neu angeschriebene Geschäftskontakte (aus dem Mailprogramm oder dem System) ohne eingegangene
// Mail davor – mit „Nachfassen in n Tagen“. Persönliche gesendete Mails stehen nur im Privatbereich.

const BEZUG: Record<string, string> = { b2b_kunde: "B2B-Kunde", lieferant: "Lieferant", sonst: "Kontakt" };
const zeit = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });

export default async function AusgehendPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("posteingang");
  const sp = await searchParams;
  const [liste, standard] = await Promise.all([ausgehendListe(session.tenantId), nachfassTage(session.tenantId)]);

  return (
    <>
      <div className="page-head"><div><div className="crumb"><Link href="/posteingang">Posteingang</Link></div><h1>Ausgehend</h1></div></div>
      <p className="small muted" style={{ marginTop: 0 }}>Mails, die ihr neu verschickt habt (auch aus dem Mailprogramm am Handy, alle 15 Min. aus dem Gesendet-Ordner gelesen). Kommt bis zum Nachfass-Tag keine Antwort, entsteht eine Aufgabe „Nachfassen“.</p>
      {sp.meldung && <div className="notice notice-ok small" role="status" data-testid="ausgehend-meldung">{sp.meldung}</div>}
      <form action={nachfassenPruefenAction} style={{ margin: "8px 0" }}><button className="btn btn-small" type="submit" data-testid="nachfassen-pruefen">Fällige jetzt prüfen</button></form>
      <div className="card" style={{ overflow: "auto" }}>
        <table className="table sticky-head" data-testid="ausgehend-liste">
          <thead><tr><th>An</th><th>Betreff</th><th>Gesendet</th><th>Von</th><th>Stand</th><th>Nachfassen</th></tr></thead>
          <tbody>
            {liste.length === 0 && <tr><td colSpan={6} className="muted">Noch keine ausgehenden Mails erkannt.</td></tr>}
            {liste.map((a) => (
              <tr key={a.id} id={`a-${a.id}`} data-testid="ausgehend-zeile">
                <td className="small">{a.anName ? <><strong>{a.anName}</strong><div className="muted">{a.an}</div></> : a.an}<div><span className="tag tag-neutral">{BEZUG[a.bezug ?? "sonst"] ?? "Kontakt"}</span></div></td>
                <td style={{ maxWidth: 380 }}><strong>{a.betreff || "(ohne Betreff)"}</strong><div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.snippet}</div></td>
                <td className="num small">{zeit(a.gesendetAm)}</td>
                <td className="small">{a.absenderName ? `${a.absenderName} · ` : ""}{a.absender}</td>
                <td className="small">
                  {a.antwortEmailId ? <Link href={`/posteingang/${a.antwortEmailId}`} className="tag tag-ok" data-testid="ausgehend-antwort">Antwort da</Link> : a.nachfassTaskId ? <span className="tag tag-warn">Aufgabe „Nachfassen“</span> : <span className="tag tag-neutral">wartet</span>}
                </td>
                <td className="small">
                  {a.antwortEmailId ? "–" : (
                    <form action={nachfassenAction} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} data-testid="nachfassen-form">
                      <input type="hidden" name="id" value={a.id} />
                      {a.nachfassenAm && <span data-testid="nachfassen-am">am {a.nachfassenAm.split("-").reverse().join(".")}</span>}
                      <input className="input" name="tage" type="number" min={0} max={60} defaultValue={standard} style={{ width: 64 }} aria-label="Tage" />
                      <button className="btn btn-small" type="submit" data-testid="nachfassen-knopf">Nachfassen in {standard} Tagen</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
