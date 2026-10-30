import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { protokollListe } from "@/lib/buchhaltung/service";

// Protokoll der Buchhaltung (GoBD): wer hat was wann geändert. Nur lesen – Einträge sind unveränderbar.
export default async function ProtokollPage() {
  const session = await requireArea("geld");
  const rows = await protokollListe(session.tenantId, 200);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/buchhaltung">Buchhaltung</Link></div>
          <h1>Protokoll</h1>
          <div className="small muted">Die letzten 200 Einträge. Einträge lassen sich weder ändern noch löschen.</div>
        </div>
      </div>
      <div className="card table-wrap">
        <table className="table small" data-testid="bh-protokoll">
          <thead>
            <tr><th>Zeit</th><th>Wer</th><th>Was</th><th>Aktion</th><th>Details</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{r.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</td>
                <td>{r.userName ?? "System"}</td>
                <td>{r.objekt}{r.objektId ? ` · ${r.objektId.slice(0, 24)}` : ""}</td>
                <td>{r.aktion}</td>
                <td className="muted" style={{ maxWidth: 420, overflowWrap: "anywhere" }}>{[r.vorher ? `vorher ${JSON.stringify(r.vorher)}` : "", r.nachher ? JSON.stringify(r.nachher) : ""].filter(Boolean).join(" → ").slice(0, 300)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
