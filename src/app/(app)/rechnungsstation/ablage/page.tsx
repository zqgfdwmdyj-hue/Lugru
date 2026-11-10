import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { ablageListe } from "@/lib/belege/ablage";
import { freigebenAction } from "./actions";

export const metadata: Metadata = { title: "Download-Ordner – Seller-System" };

// B34.2 Download-Ordner am Arbeits-PC (Druckagent): was erkannt, umbenannt und wohin abgelegt wurde; Dubletten
// liegen im Ordner „Dubletten“ und werden nur nach Freigabe gelöscht.

const STATUS: Record<string, { text: string; tag: string }> = {
  ablegen: { text: "abgelegt", tag: "tag-ok" },
  kontoauszug: { text: "Kontoauszug", tag: "tag-info" },
  dublette: { text: "Dublette", tag: "tag-warn" },
  warten: { text: "wird gelesen", tag: "tag-neutral" },
  liegen_lassen: { text: "bleibt liegen", tag: "tag-neutral" },
  fehler: { text: "Fehler", tag: "tag-critical" },
};
const eur = (n: number | null) => (n === null ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const zeit = (d: Date | null) => (d ? d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");

export default async function AblagePage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const s = await requireArea("service", "buchhaltung", "geld");
  const sp = await searchParams;
  const liste = await ablageListe(s.tenantId, 200);
  const dubletten = liste.filter((z) => z.status === "dublette" && !z.geloeschtAm);
  const offen = dubletten.filter((z) => z.verschobenAm && !z.loeschenFreigegebenAm);
  const inhaber = s.role === "owner" && !s.readOnly;
  return (
    <div style={{ maxWidth: 1200 }} className="stack" data-testid="beleg-ablage">
      <div className="page-head">
        <div><div className="crumb">Finanzen › Rechnungen</div><h1>Download-Ordner (Belege)</h1></div>
        <Link href="/einstellungen/drucker" className="btn">Ordner einstellen</Link>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" data-testid="ablage-meldung">{sp.meldung}</div>}
      <p className="small muted">
        Der Druckagent am Arbeits-PC schaut in den Download-Ordner: Rechnungen werden umbenannt (JJJJ-MM-TT_Lieferant_Betrag_Rechnungsnr) und nach Monat/Lieferant abgelegt, Kontoauszüge importiert (nicht als Rechnung), Dubletten (gleiche Datei oder gleiche Nummer + Betrag) in den Ordner „Dubletten“ verschoben. Gelöscht wird nichts – außer Dubletten, die hier freigegeben werden.
      </p>

      <section className="card card-pad stack" style={{ gap: 8 }} data-testid="ablage-dubletten">
        <div className="between"><h2 style={{ margin: 0 }}>Dubletten ({dubletten.length})</h2>
          {inhaber && offen.length > 1 && (
            <form action={freigebenAction}><input type="hidden" name="alle" value="1" /><button className="btn btn-sm" type="submit" data-testid="ablage-alle-freigeben">Alle {offen.length} zum Löschen freigeben</button></form>
          )}
        </div>
        {dubletten.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Keine Dubletten.</p> : (
          <table className="table small">
            <thead><tr><th>Datei</th><th>Grund</th><th>Liegt in</th><th>Löschen</th></tr></thead>
            <tbody>
              {dubletten.map((z) => (
                <tr key={z.id} data-testid="ablage-dublette" data-id={z.id}>
                  <td>{z.dateiname}</td>
                  <td>{z.dubletteGrund ?? "–"}</td>
                  <td>{z.pfad ?? "noch nicht verschoben"}</td>
                  <td>
                    {z.loeschenFreigegebenAm ? <span className="tag tag-warn">freigegeben {zeit(z.loeschenFreigegebenAm)}</span>
                      : inhaber && z.verschobenAm ? <form action={freigebenAction}><input type="hidden" name="id" value={z.id} /><button className="btn btn-sm" type="submit" data-testid="ablage-freigeben">Löschen freigeben</button></form>
                      : <span className="muted">–</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>Zuletzt verarbeitet</h2>
        {liste.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Noch nichts – Download-Ordner und Ablage unter Einstellungen → Drucker beim Agenten eintragen.</p> : (
          <table className="table small" data-testid="ablage-liste">
            <thead><tr><th>Eingang</th><th>Datei</th><th>Status</th><th>Lieferant</th><th>Datum</th><th>Betrag</th><th>Nr.</th><th>Ablage</th></tr></thead>
            <tbody>
              {liste.map((z) => (
                <tr key={z.id} data-testid="ablage-zeile" data-status={z.status}>
                  <td>{zeit(z.createdAt)}</td>
                  <td>{z.dateiname}</td>
                  <td><span className={`tag ${STATUS[z.status]?.tag ?? ""}`}>{STATUS[z.status]?.text ?? z.status}</span>{z.geloeschtAm ? " · gelöscht" : ""}</td>
                  <td>{z.lieferant ?? "–"}</td>
                  <td>{z.datum ?? "–"}</td>
                  <td>{eur(z.betrag)}</td>
                  <td>{z.nummer ?? "–"}</td>
                  <td>{z.pfad ?? (z.ordner ? `${z.ordner}/${z.zielname ?? ""}` : z.meldung ?? "–")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
