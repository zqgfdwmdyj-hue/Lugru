import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { ekImport, ekImporte } from "@/lib/ek-import/service";
import { formatDate, formatEuro } from "@/lib/numbers";
import { anSellerboardAction, uebernehmenAction, verwerfenAction, vorschauAction } from "./actions";

// EK-Import: ArbitrageOne-Liste nur noch hier hochladen → Vorschau → übernehmen → sellerboard-Datei/Übertragung → Gegenprüfung.

const ART = { neu: "neu", geaendert: "geändert", gleich: "unverändert", unbekannt: "unbekannte SKU" } as const;
const SB = { offen: "noch nicht übertragen", datei: "Importdatei heruntergeladen", automatik_ok: "automatisch übertragen", automatik_fehler: "automatische Übertragung fehlgeschlagen" } as const;
const eur = (n: number | null) => (n === null ? "–" : formatEuro(n));

export default async function EkImportPage({ searchParams }: { searchParams: Promise<{ id?: string; meldung?: string; art?: string }> }) {
  const session = await requireArea("wawi");
  const sp = await searchParams;
  const [liste, aktiv] = await Promise.all([ekImporte(session.tenantId, 8), sp.id ? ekImport(session.tenantId, sp.id) : Promise.resolve(null)]);
  const zeilen = aktiv ? aktiv.zeilen.filter((z) => (sp.art ? (sp.art === "warnung" ? z.warnungen.length : z.art === sp.art) : z.art !== "gleich" || z.warnungen.length)) : [];
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/einkauf">Einkauf</Link></div><h1>EK-Import (→ sellerboard)</h1></div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}
      <p className="small muted" style={{ marginTop: 0 }}>Die EK-Liste aus ArbitrageOne (Export für sellerboard) nur noch hier hochladen – auch über <Link href="/uploads">Uploads</Link>. Erst Vorschau, dann übernehmen (Chargen-Logik wie bisher), dann die Datei zu sellerboard. Am Folgetag vergleicht das System den EK in sellerboard mit dem im System.</p>

      {!session.readOnly && (
        <form action={vorschauAction} className="card card-pad row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="ek-upload">
          <input type="file" name="datei" accept=".xls,.xlsx,.csv" required />
          <button className="btn btn-primary" type="submit">Vorschau</button>
        </form>
      )}

      {aktiv && (
        <section className="card card-pad stack" style={{ marginTop: 12 }} data-testid="ek-vorschau" data-status={aktiv.status}>
          <h2 style={{ margin: 0 }}>{aktiv.dateiname} – {aktiv.status === "vorschau" ? "Vorschau" : aktiv.status === "uebernommen" ? `übernommen am ${formatDate(aktiv.uebernommenAm?.toISOString() ?? null)}` : "verworfen"}</h2>
          <div className="row small" style={{ gap: 12, flexWrap: "wrap" }} data-testid="ek-anzahl">
            {(["geaendert", "neu", "gleich", "unbekannt"] as const).map((a) => (
              <Link key={a} href={`?id=${aktiv.id}&art=${a}`}>{ART[a]}: {aktiv.anzahl[a] ?? 0}</Link>
            ))}
            <Link href={`?id=${aktiv.id}&art=warnung`} style={{ color: aktiv.anzahl.warnungen ? "var(--warn)" : undefined }}>Warnungen: {aktiv.anzahl.warnungen ?? 0}</Link>
          </div>
          {aktiv.status === "vorschau" && !session.readOnly && (
            <div className="row" style={{ gap: 8 }}>
              <form action={uebernehmenAction}><input type="hidden" name="id" value={aktiv.id} /><button className="btn btn-primary" type="submit" data-testid="ek-uebernehmen">Übernehmen</button></form>
              <form action={verwerfenAction}><input type="hidden" name="id" value={aktiv.id} /><button className="btn" type="submit">Verwerfen</button></form>
            </div>
          )}
          {aktiv.status === "uebernommen" && (
            <div className="stack small" data-testid="ek-sellerboard">
              <div>sellerboard: <b>{SB[aktiv.sellerboard]}</b>{aktiv.geprueftAm ? ` · Gegenprüfung ${formatDate(aktiv.geprueftAm.toISOString())}: ${aktiv.pruefung?.abweichend.length ? `${aktiv.pruefung.abweichend.length} Abweichungen` : "alles gleich"}` : " · Gegenprüfung folgt am nächsten Tag"}</div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <a className="btn" href={`/einkauf/ek-import/datei?id=${aktiv.id}`} data-testid="ek-sellerboard-datei">sellerboard-Importdatei herunterladen</a>
                {!session.readOnly && <form action={anSellerboardAction}><input type="hidden" name="id" value={aktiv.id} /><button className="btn" type="submit" data-testid="ek-sellerboard-automatik">An sellerboard übertragen (Browser)</button></form>}
                <span className="muted">Datei: in sellerboard unter Produkte → Kosten importieren hochladen. Automatik: braucht die Anbindung „sellerboard – Anmeldung“.</span>
              </div>
              {aktiv.sellerboardProtokoll.length > 0 && <ul style={{ margin: 0 }}>{aktiv.sellerboardProtokoll.map((p, i) => <li key={i}>{formatDate(p.zeit)} {p.text}</li>)}</ul>}
            </div>
          )}
          <div className="table-wrap">
            <table className="table small">
              <thead><tr><th>SKU</th><th>ASIN</th><th>bisher</th><th>neu</th><th>Abweichung</th><th>Art</th><th>Hinweis</th></tr></thead>
              <tbody>
                {zeilen.slice(0, 300).map((z) => (
                  <tr key={z.sku} data-testid="ek-zeile" data-sku={z.sku} data-art={z.art}>
                    <td>{z.sku}</td><td>{z.asin}</td><td>{eur(z.ekAlt)}{z.quelleAlt ? <span className="muted"> ({z.quelleAlt})</span> : null}</td><td>{eur(z.ekNeu)}</td>
                    <td>{z.abweichungProzent !== null ? `${z.abweichungProzent > 0 ? "+" : ""}${String(z.abweichungProzent).replace(".", ",")} %` : "–"}</td><td>{ART[z.art]}</td>
                    <td style={{ color: z.warnungen.length ? "var(--warn)" : undefined }}>{z.warnungen.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {zeilen.length > 300 && <div className="small muted">Nur die ersten 300 von {zeilen.length}.</div>}
          </div>
        </section>
      )}

      <section className="card card-pad" style={{ marginTop: 12 }} data-testid="ek-liste">
        <h2 style={{ marginTop: 0 }}>Letzte Importe</h2>
        <table className="table small">
          <tbody>
            {liste.map((e) => (
              <tr key={e.id}>
                <td><Link href={`?id=${e.id}`}>{e.dateiname}</Link></td><td>{formatDate(e.createdAt.toISOString())}</td><td>{e.status}</td>
                <td>{e.anzahl.geaendert ?? 0} geändert · {e.anzahl.neu ?? 0} neu</td><td>{SB[e.sellerboard]}</td>
                <td>{e.geprueftAm ? (e.pruefung?.abweichend.length ? `${e.pruefung.abweichend.length} Abweichungen` : "geprüft ✓") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
