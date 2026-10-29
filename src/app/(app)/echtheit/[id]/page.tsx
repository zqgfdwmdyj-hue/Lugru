import Link from "next/link";
import { KpiMeta } from "@/components/kpi";
import { notFound } from "next/navigation";
import { and, desc, eq, ilike, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { canAccess } from "@/lib/auth/areas";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { ABDECKUNG_TEXT } from "@/lib/echtheit/logic";
import { markenOrdner } from "@/lib/echtheit/service";
import { belegUrteilAction, belegZuordnenAction, markeAliaseAction, markeEntfernenAction } from "../actions";

const eur = (n: number | null) => (n === null ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "–");
const ART: Record<string, { text: string; tag: string }> = {
  sicher: { text: "Rechnungsposition", tag: "tag-ok" },
  charge: { text: "über Charge", tag: "tag-ok" },
  manuell: { text: "von Hand", tag: "tag-ok" },
  text: { text: "im Text", tag: "" },
  pruefen: { text: "prüfen", tag: "tag-warn" },
};
const STATUS_TAG = { belegt: "tag-ok", teilweise: "tag-warn", luecke: "tag-danger", kein_verkauf: "" } as const;

export default async function EchtheitOrdnerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string; suche?: string }> }) {
  const session = await requireArea("amazon");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const o = await markenOrdner(session.tenantId, id, todayIso());
  if (!o) notFound();
  const buchhaltung = canAccess(session, "buchhaltung");
  const a = o.abdeckung;
  const schonDa = new Set(o.belege.map((b) => b.id));
  const suche = (sp.suche ?? "").trim().slice(0, 60);
  const muster = `%${suche.replace(/[\\%_]/g, "\\$&")}%`;
  const I = schema.invoices;
  const kandidaten = suche.length >= 2
    ? (await db
        .select({ id: I.id, vendor: I.vendor, invoiceNumber: I.invoiceNumber, invoiceDate: I.invoiceDate, totalGross: I.totalGross, fileName: I.fileName })
        .from(I)
        .where(and(eq(I.tenantId, session.tenantId), ne(I.status, "ignored"), or(ilike(I.invoiceNumber, muster), ilike(I.vendor, muster), ilike(I.fileName, muster))))
        .orderBy(desc(I.invoiceDate))
        .limit(20)).filter((k) => !schonDa.has(k.id))
    : [];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/echtheit">Echtheits-Ordner</Link></div>
          <h1 data-testid="echtheit-titel">{o.marke.marke}</h1>
        </div>
        {buchhaltung ? (
          <a className="btn btn-primary" href={`/echtheit/${o.marke.id}/paket`} data-testid="echtheit-paket">Audit-Paket (ZIP)</a>
        ) : (
          <span className="small muted">Audit-Paket nur mit Zugriff auf Rechnungen</span>
        )}
      </div>
      {sp.meldung && <div className="notice notice-ok small" style={{ marginBottom: 12 }} role="status">{sp.meldung}</div>}

      <div className="stack" style={{ gap: 6, marginBottom: 14 }} data-kpi-group>
      <div className="grid-kpi">
        <div className="card card-pad">
          <div className="kpi-label">Rechnungen</div>
          <div className="kpi-value" data-testid="echtheit-belege">{o.summe.belege}</div>
          <div className="small muted">{o.summe.bestaetigt} bestätigt{o.summe.pruefen ? ` · ${o.summe.pruefen} prüfen` : ""}</div>
        </div>
        <div className="card card-pad">
          <div className="kpi-label">Abdeckung (12 Monate)</div>
          <div className="kpi-value" data-testid="echtheit-abdeckung">{a.quote === null ? "kein Verkauf" : `${a.quote.toLocaleString("de-DE")} %`}</div>
          <div className="small muted">verkauft {a.verkauft} · mit Rechnung gekauft {a.gekauftBelegt}{a.gekauftOhneBeleg ? ` · ohne Rechnung ${a.gekauftOhneBeleg}` : ""}</div>
        </div>
        <div className="card card-pad">
          <div className="kpi-label">Offene Amazon-Fälle</div>
          <div className="kpi-value">{o.summe.offeneFaelle}</div>
          <div className="small muted">Echtheit, Konto, Reaktivierung …</div>
        </div>
      </div>
      <KpiMeta period="Verkauf: letzte 12 Monate" source="Rechnungen im Seller-System, Chargen (Einkauf), sellerboard (verkaufte Stück je Monat), Amazon-ToDos aus Systemmails" stand={new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} />
      </div>

      {o.faelle.length > 0 && (
        <>
          <h2>Amazon-Fälle (Kontozustand)</h2>
          <div className="stack" style={{ gap: 6, marginBottom: 14 }} data-testid="echtheit-faelle">
            {o.faelle.map((f) => (
              <div key={f.id} className="card card-pad small" style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
                <span>
                  <span className={`tag ${f.status === "open" ? "tag-danger" : ""}`}>{f.kategorie}</span> {f.betreff ?? "–"}
                  {f.asins.length > 0 && <span className="muted"> · {f.asins.slice(0, 4).join(", ")}</span>}
                </span>
                <span>
                  {f.frist && <>Frist {dmy(f.frist)} · </>}
                  <Link href={`/amazon-todos?q=${encodeURIComponent(f.asins[0] ?? o.marke.marke)}`}>{f.status === "open" ? "offen – ansehen" : "erledigt"}</Link>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Abdeckung je Artikel</h2>
      {a.zeilen.length === 0 ? (
        <div className="card card-pad small muted" style={{ marginBottom: 14 }}>Kein Artikel mit „{o.marke.marke}“ im Namen gefunden (sellerboard-Produkte). Ggf. weitere Schreibweisen unten ergänzen.</div>
      ) : (
        <div className="table-wrap card" style={{ marginBottom: 14 }}>
          <table className="table" data-testid="echtheit-abdeckung-tabelle">
            <thead>
              <tr>
                <th>Artikel</th>
                <th className="right">verkauft 12 M.</th>
                <th className="right">mit Rechnung</th>
                <th className="right">ohne Rechnung</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {a.zeilen.map((z) => (
                <tr key={z.sku} data-status={z.status}>
                  <td><Link href={`/produkte/sku/${encodeURIComponent(z.sku)}`}>{z.name ?? z.sku}</Link><div className="small muted">{z.sku}{z.asin ? ` · ${z.asin}` : ""}</div></td>
                  <td className="right num">{z.verkauft}</td>
                  <td className="right num">{z.gekauftBelegt}</td>
                  <td className="right num">{z.gekauftOhneBeleg || ""}</td>
                  <td><span className={`tag ${STATUS_TAG[z.status]}`}>{ABDECKUNG_TEXT[z.status]}</span>{z.fehlt > 0 && <div className="small muted">{z.fehlt} Stück ohne Nachweis</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Rechnungen</h2>
      {o.belege.length === 0 ? (
        <div className="card card-pad small muted" style={{ marginBottom: 14 }}>Keine Rechnung gefunden. Rechnung unten von Hand zuordnen.</div>
      ) : (
        <div className="stack" style={{ gap: 6, marginBottom: 14 }} data-testid="echtheit-belegliste">
          {o.belege.map((b) => (
            <div key={b.id} className="card card-pad small" data-testid="echtheit-beleg" style={b.urteil === "falsch" ? { opacity: 0.55 } : undefined}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
                <span>
                  <strong>{b.vendor ?? "–"}</strong> · {dmy(b.invoiceDate)} · Nr. {b.invoiceNumber ?? "–"}{buchhaltung ? ` · ${eur(b.totalGross)}` : ""}{" "}
                  <span className={`tag ${ART[b.art].tag}`} title={b.grund}>{ART[b.art].text}</span>
                  {b.urteil === "stimmt" && b.art !== "manuell" && <span className="tag tag-ok">bestätigt</span>}
                  {b.urteil === "falsch" && <span className="tag">falsch – zählt nicht</span>}
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  {buchhaltung && <Link href={`/rechnungen/${b.id}`}>öffnen</Link>}
                  {b.urteil === null ? (
                    <>
                      <form action={belegUrteilAction}><input type="hidden" name="marke" value={o.marke.id} /><input type="hidden" name="rechnung" value={b.id} /><input type="hidden" name="urteil" value="stimmt" /><button className="btn-link small" type="submit" data-testid="echtheit-stimmt">stimmt</button></form>
                      <form action={belegUrteilAction}><input type="hidden" name="marke" value={o.marke.id} /><input type="hidden" name="rechnung" value={b.id} /><input type="hidden" name="urteil" value="falsch" /><button className="btn-link small" type="submit" data-testid="echtheit-falsch">falsch</button></form>
                    </>
                  ) : (
                    <form action={belegUrteilAction}><input type="hidden" name="marke" value={o.marke.id} /><input type="hidden" name="rechnung" value={b.id} /><input type="hidden" name="urteil" value="zurueck" /><button className="btn-link small" type="submit">zurücknehmen</button></form>
                  )}
                </span>
              </div>
              {b.ausschnitt && <div className="muted" style={{ marginTop: 4 }}>„{b.ausschnitt}“</div>}
            </div>
          ))}
        </div>
      )}

      <details className="card card-pad" style={{ marginBottom: 14 }} open={!!suche}>
        <summary><strong>Rechnung von Hand zuordnen</strong></summary>
        <form method="get" style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input name="suche" defaultValue={suche} placeholder="Rechnungsnummer, Lieferant oder Dateiname" aria-label="Rechnung suchen" data-testid="echtheit-suche" />
          <button className="btn btn-small" type="submit">Suchen</button>
        </form>
        {suche && kandidaten.length === 0 && <p className="small muted">Nichts gefunden (oder schon im Ordner).</p>}
        {kandidaten.map((k) => (
          <form key={k.id} action={belegZuordnenAction} className="small" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
            <input type="hidden" name="marke" value={o.marke.id} />
            <input type="hidden" name="rechnung" value={k.id} />
            <span>{k.vendor ?? k.fileName} · {dmy(k.invoiceDate)} · Nr. {k.invoiceNumber ?? "–"}{buchhaltung ? ` · ${eur(k.totalGross)}` : ""}</span>
            <button className="btn btn-small" type="submit" data-testid="echtheit-zuordnen">zuordnen</button>
          </form>
        ))}
      </details>

      <details className="card card-pad">
        <summary><strong>Schreibweisen und Notiz</strong></summary>
        <form action={markeAliaseAction} className="stack" style={{ gap: 8, marginTop: 8, maxWidth: 560 }}>
          <input type="hidden" name="id" value={o.marke.id} />
          <label className="small">Weitere Schreibweisen (mit Komma)<input name="aliase" defaultValue={o.marke.aliase.join(", ")} /></label>
          <label className="small">Notiz (z. B. Ansprechpartner beim Großhändler, Autorisierung)<textarea name="notiz" rows={3} defaultValue={o.marke.notiz ?? ""} /></label>
          <div><button className="btn" type="submit">Speichern</button></div>
        </form>
        <form action={markeEntfernenAction} style={{ marginTop: 10 }}>
          <input type="hidden" name="id" value={o.marke.id} />
          <button className="btn-link small" type="submit">Ordner entfernen (Rechnungen bleiben)</button>
        </form>
      </details>
    </>
  );
}
