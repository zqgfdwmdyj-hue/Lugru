import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePortal } from "@/lib/b2b/portal-auth";
import { getSettings } from "@/lib/settings";
import { todayIso } from "@/lib/dates";
import { kundeAusPrognose, reservierbar, reservierungAktiv } from "@/lib/b2b/logic";

const eur = (n: number | null) => (n === null ? "–" : `${n.toFixed(2).replace(".", ",")} €`);
const datum = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "–");

/** Offene Deals für den angemeldeten Kunden – mit seinem Preis und seiner Rechnung je Land. */
export default async function PortalDealsPage({ searchParams }: { searchParams: Promise<{ marke?: string; land?: string; minroi?: string; q?: string; willkommen?: string }> }) {
  const s = await requirePortal();
  const sp = await searchParams;
  const t = s.tenantId;
  const set = await getSettings(t);
  const D = schema.deals;
  const R = schema.dealReservierungen;
  const KP = schema.dealKundenpreise;
  const deals = await db.select().from(D).where(and(eq(D.tenantId, t), eq(D.status, "aktiv"))).orderBy(desc(D.freigeschaltetAm)).limit(200);
  const ids = deals.map((d) => d.id);
  const res = ids.length ? await db.select({ dealId: R.dealId, kundeId: R.kundeId, menge: R.menge, status: R.status }).from(R).where(and(eq(R.tenantId, t), inArray(R.dealId, ids))) : [];
  const preise = new Map((ids.length ? await db.select({ dealId: KP.dealId, preis: KP.preisNetto }).from(KP).where(and(eq(KP.tenantId, t), eq(KP.kundeId, s.kundeId), inArray(KP.dealId, ids))) : []).map((p) => [p.dealId, p.preis]));
  const heute = todayIso();
  const marken = [...new Set(deals.map((d) => d.marke).filter((m): m is string => !!m))].sort();
  const minRoi = Number(sp.minroi) || null;
  const q = (sp.q ?? "").trim().toLowerCase();
  const zeilen = deals
    .map((d) => {
      const preis = preise.get(d.id) ?? d.kundenpreisNetto;
      const laender = set.b2b.marktplaetze.filter((l) => d.prognose[l]).map((l) => ({ land: l, ...kundeAusPrognose(d.prognose[l], preis, d.prepGebuehr) }));
      const bester = laender.filter((l) => l.roi !== null).sort((a, b) => b.roi! - a.roi!)[0] ?? null;
      const imLand = sp.land ? laender.find((l) => l.land === sp.land) ?? null : null;
      const rb = reservierbar(d, res.filter((r) => r.dealId === d.id), s.kundeId, heute);
      const meine = res.find((r) => r.dealId === d.id && r.kundeId === s.kundeId && reservierungAktiv(r.status));
      return { d, preis, bester, imLand, rb, meine };
    })
    .filter((z) => (!sp.marke || z.d.marke === sp.marke) && (!q || `${z.d.titel} ${z.d.asin} ${z.d.ean ?? ""} ${z.d.marke ?? ""}`.toLowerCase().includes(q)))
    .filter((z) => !minRoi || ((sp.land ? z.imLand?.roi : z.bester?.roi) ?? -Infinity) >= minRoi)
    .filter((z) => !sp.land || z.imLand?.roi !== null);

  return (
    <>
      {sp.willkommen && <div className="notice notice-ok">Passwort gespeichert – willkommen im Kundenportal.</div>}
      <h1 style={{ margin: 0 }}>Aktuelle Deals</h1>
      <form method="get" className="card card-pad" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
        <div className="field"><label className="label" htmlFor="q">Suche</label><input className="input" id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Titel, ASIN, EAN" style={{ width: 180 }} /></div>
        <div className="field">
          <label className="label" htmlFor="marke">Marke</label>
          <select className="input" id="marke" name="marke" defaultValue={sp.marke ?? ""} style={{ width: 160 }}><option value="">alle</option>{marken.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </div>
        <div className="field">
          <label className="label" htmlFor="land">Land</label>
          <select className="input" id="land" name="land" defaultValue={sp.land ?? ""} style={{ width: 110 }}><option value="">bestes</option>{set.b2b.marktplaetze.map((l) => <option key={l} value={l}>{l}</option>)}</select>
        </div>
        <div className="field"><label className="label" htmlFor="minroi">ROI ab %</label><input className="input" id="minroi" name="minroi" inputMode="numeric" defaultValue={sp.minroi ?? ""} style={{ width: 80 }} /></div>
        <button className="btn" type="submit">Filtern</button>
      </form>
      {zeilen.length === 0 && <div className="card card-pad muted" data-testid="portal-keine-deals">Gerade keine passenden Deals. Neue Deals kommen per Mail, wenn Sie das unter „Mein Konto“ eingestellt haben.</div>}
      <div style={{ display: "grid", gap: 10 }} data-testid="portal-deals">
        {zeilen.map(({ d, preis, bester, imLand, rb, meine }) => {
          const zeige = imLand ?? bester;
          return (
            <Link key={d.id} href={`/portal/deals/${d.id}`} className="card card-pad" style={{ display: "flex", gap: 12, alignItems: "center", color: "inherit", textDecoration: "none" }} data-testid="portal-deal">
              {d.bildUrl ? <img src={d.bildUrl} alt="" width={64} height={64} style={{ objectFit: "contain", background: "#fff", borderRadius: 6 }} /> : null}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{d.titel}</div>
                <div className="small muted">{d.marke ? `${d.marke} · ` : ""}ASIN {d.asin} · Frist {datum(d.frist)}</div>
                <div className="small">
                  <b>{eur(preis)}</b> netto/Stück · ab {d.mindestmengeKunde} Stück{rb.rest !== null ? ` · noch ${rb.rest} frei` : ""}
                  {zeige ? <> · {zeige.land}: Gewinn {eur(zeige.gewinn)}, ROI <b>{zeige.roi?.toFixed(0)} %</b></> : null}
                </div>
              </div>
              {meine ? <span className="tag tag-ok">{meine.menge} reserviert</span> : rb.rest === 0 || rb.kundenVoll ? <span className="tag tag-neutral">voll</span> : null}
            </Link>
          );
        })}
      </div>
      <div className="small muted">Prognosen ohne Garantie. Markenfreigabe bitte vor der Reservierung im eigenen Amazon-Konto prüfen.</div>
    </>
  );
}
