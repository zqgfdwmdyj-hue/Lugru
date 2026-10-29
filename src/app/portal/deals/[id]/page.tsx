import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requirePortal } from "@/lib/b2b/portal-auth";
import { getSettings } from "@/lib/settings";
import { kundeAusPrognose, RES_STATUS_TEXT, reservierungAktiv, steuerFuer } from "@/lib/b2b/logic";
import { portalDealStand } from "@/lib/b2b/reservierung";
import { ConfirmButton } from "@/components/confirm-button";
import { ReservierFormular } from "../../formulare";
import { stornierenAction } from "../../actions";

const eur = (n: number | null, w = "EUR") => (n === null ? "–" : `${n.toFixed(2).replace(".", ",")} ${w === "EUR" ? "€" : w === "GBP" ? "£" : w}`);
const datum = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "–");

export default async function PortalDealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const s = await requirePortal();
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const t = s.tenantId;
  const D = schema.deals;
  const [d] = await db.select().from(D).where(and(eq(D.tenantId, t), eq(D.id, id), inArray(D.status, ["aktiv", "geschlossen", "bestellt", "angekommen", "verteilt", "erledigt", "verfallen"])));
  if (!d) notFound();
  const stand = await portalDealStand(t, s.kundeId, d);
  // Nicht mehr offene Deals sieht nur, wer reserviert hat.
  if (d.status !== "aktiv" && !stand.meine) notFound();
  const set = await getSettings(t);
  const [k] = await db.select({ land: schema.b2bKunden.land, ustId: schema.b2bKunden.ustId, ustGueltig: schema.b2bKunden.ustGueltig }).from(schema.b2bKunden).where(and(eq(schema.b2bKunden.tenantId, t), eq(schema.b2bKunden.id, s.kundeId)));
  const steuer = steuerFuer({ kundeLand: k?.land ?? "DE", ustId: k?.ustId ?? null, ustGueltig: k?.ustGueltig ?? null, firmaLand: set.b2b.firma.land || "DE", satz: set.b2b.ustSatz });
  const laender = set.b2b.marktplaetze.filter((l) => d.prognose[l]).map((l) => ({ land: l, p: d.prognose[l], k: kundeAusPrognose(d.prognose[l], stand.preis, d.prepGebuehr) }));
  const meineAktiv = stand.meine && reservierungAktiv(stand.meine.status) ? stand.meine : null;
  const kannReservieren = d.status === "aktiv" && stand.offen && (!stand.meine || ["reserviert", "storniert"].includes(stand.meine.status)) && !(stand.kundenVoll && !meineAktiv) && (stand.rest === null || stand.rest > 0 || !!meineAktiv);
  const max = stand.max;

  return (
    <>
      <div className="small"><Link href="/portal">← Alle Deals</Link></div>
      {sp.meldung && <div className="notice notice-info" data-testid="portal-meldung">{sp.meldung}</div>}
      <section className="card card-pad" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {d.bildUrl ? <img src={d.bildUrl} alt="" width={120} height={120} style={{ objectFit: "contain", background: "#fff", borderRadius: 8 }} /> : null}
        <div className="stack" style={{ gap: 4, flex: 1, minWidth: 220 }}>
          <h1 style={{ margin: 0, fontSize: 20 }} data-testid="portal-deal-titel">{d.titel}</h1>
          <div className="small muted">Deal #{d.nr} · ASIN <a href={`https://www.amazon.de/dp/${d.asin}`} target="_blank" rel="noreferrer">{d.asin}</a>{d.ean ? ` · EAN ${d.ean}` : ""}{d.marke ? ` · ${d.marke}` : ""}</div>
          <div style={{ fontSize: 18 }}><b data-testid="portal-preis">{eur(stand.preis)}</b> <span className="small">netto je Stück {steuer.art === "reverse_charge" ? "(Reverse Charge, ohne USt)" : `zzgl. ${Math.round(steuer.satz * 100)} % USt`}</span></div>
          <div className="small">Ab {d.mindestmengeKunde} Stück{d.maxProKunde ? `, höchstens ${d.maxProKunde} je Kunde` : ""}{stand.rest !== null ? ` · noch ${stand.rest} frei` : ""} · reservieren bis {datum(d.frist)}{d.lieferzeitTage !== null ? ` · Lieferzeit ca. ${d.lieferzeitTage} Tage ab Bestellung` : ""}</div>
          {d.hinweis && <div className="small">{d.hinweis}</div>}
        </div>
      </section>

      <section className="card" style={{ overflow: "auto" }}>
        <div className="card-head"><h2>Prognose je Marktplatz</h2><span className="small muted">mit Ihrem Preis{d.prepGebuehr ? ` + Prep ${eur(d.prepGebuehr)}` : ""}</span></div>
        <table className="table" data-testid="portal-prognose">
          <thead><tr><th>Land</th><th className="right">Buy Box</th><th className="right">Ø 90 T.</th><th className="right">Tief 12 M.</th><th className="right">Verk./Monat</th><th className="right">Angebote</th><th className="right">Gebühren</th><th className="right">Gewinn</th><th className="right">ROI</th></tr></thead>
          <tbody>
            {laender.length === 0 && <tr><td colSpan={9} className="muted">Keine Marktdaten.</td></tr>}
            {laender.map(({ land, p, k: x }) => (
              <tr key={land}>
                <td><b>{land}</b>{p.aktionsmuster ? <div className="small" style={{ color: "var(--warn)" }}>{p.aktionsmuster}</div> : null}</td>
                <td className="num right">{eur(p.vk, p.waehrung)}</td>
                <td className="num right">{eur(p.vk90, p.waehrung)}</td>
                <td className="num right">{eur(p.tief12, p.waehrung)}</td>
                <td className="num right">{p.verkaeufeMonat ?? "–"}</td>
                <td className="num right">{p.angeboteFba === null && p.angeboteFbm === null ? "–" : (p.angeboteFba ?? 0) + (p.angeboteFbm ?? 0)}</td>
                <td className="num right">{eur(p.gebuehren)}</td>
                <td className="num right" style={{ fontWeight: 600 }}>{eur(x.gewinn)}</td>
                <td className="num right">{x.roi === null ? "–" : `${x.roi.toFixed(0)} %`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="card-pad small muted">Gewinn je Stück: Buy Box netto minus Amazon-Provision und FBA-Gebühr (teils geschätzt) minus Preis{d.prepGebuehr ? " und Prep-Gebühr" : ""}. Fremdwährungen zum EZB-Kurs. Prognose ohne Garantie.</div>
      </section>

      <section className="card card-pad stack" style={{ gap: 10 }}>
        <h2>Reservierung</h2>
        {stand.meine && (
          <div className="small" data-testid="portal-meine">
            Ihre Reservierung: <b>{stand.meine.menge} Stück</b> zu {eur(stand.meine.preisNetto)} – {RES_STATUS_TEXT[stand.meine.status]}{stand.meine.zugeteilt !== null && stand.meine.zugeteilt !== stand.meine.menge ? ` · zugeteilt ${stand.meine.zugeteilt} (Fehlmenge)` : ""}
          </div>
        )}
        {kannReservieren ? (
          <ReservierFormular dealId={d.id} min={d.mindestmengeKunde} max={max} menge={meineAktiv?.menge ?? null} aendern={!!meineAktiv} />
        ) : d.status === "aktiv" && !meineAktiv ? (
          <div className="small muted">{stand.kundenVoll ? "Für diesen Deal sind schon genug Händler dabei." : stand.rest === 0 ? "Leider ausverkauft." : "Reservieren ist nicht mehr möglich."}</div>
        ) : null}
        {meineAktiv?.status === "reserviert" && d.status === "aktiv" && (
          <form action={stornierenAction}><input type="hidden" name="dealId" value={d.id} /><ConfirmButton confirm="Reservierung wirklich stornieren?">Reservierung stornieren</ConfirmButton></form>
        )}
      </section>
    </>
  );
}
