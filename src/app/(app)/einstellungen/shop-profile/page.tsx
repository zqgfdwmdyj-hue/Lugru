import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { LINK_ARTEN, profileZusammen, STANDARD_SHOPS, type LinkArt } from "@/lib/deal-eingang/shop-logic";
import { paybackSpeichern, shopProfilSpeichern, shopProfilZuruecksetzen } from "./actions";

// Einstellungen → Shop-Profile: je Shop, wie der Kauf-Link aussieht (Amazon: Warenkorb-Link je Land, andere Shops:
// Produktseite + Hinweis), Lieferantenkürzel wie in der SKU, Payback-Hinweis. Payback-Schalter nur zur Anzeige.

const ART: Record<LinkArt, string> = { warenkorb_link: "Warenkorb-Link", produktseite: "Produktseite", suche: "Suche" };

export default async function ShopProfilePage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("dealeingang");
  const sp = await searchParams;
  const owner = session.role === "owner" && !session.readOnly;
  const [eigene, st] = await Promise.all([db.select().from(schema.shopProfile).where(eq(schema.shopProfile.tenantId, session.tenantId)), getSettings(session.tenantId)]);
  const geaendert = new Set(eigene.map((p) => p.kuerzel));
  const standard = new Set(STANDARD_SHOPS.map((p) => p.kuerzel));
  const profile = profileZusammen(eigene.map((r) => ({ kuerzel: r.kuerzel, name: r.name, domains: r.domains, linkArt: r.linkArt as LinkArt, linkMuster: r.linkMuster, hinweis: r.hinweis, payback: r.payback, aktiv: r.aktiv })));
  const leer = { kuerzel: "", name: "", domains: [] as string[], linkArt: "produktseite" as LinkArt, linkMuster: null, hinweis: null, payback: null, aktiv: true };
  return (
    <>
      <div className="page-head"><div><div className="crumb"><Link href="/einstellungen">Einstellungen</Link> · <Link href="/deal-eingang">Deal-Eingang</Link></div><h1>Shop-Profile & Payback</h1></div></div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="sp-meldung">{sp.meldung}</div>}
      <div className="notice notice-info small" style={{ marginBottom: 12 }}>
        Kaufen mit einem Tap: Das System bereitet nur den Link vor – kein automatischer Einkauf, kein Kauf-Bot, keine Zahlungsdaten oder Logins. „Warenkorb vorbereitet“ steht nur bei Amazon; bei anderen Shops öffnet die Produktseite, die Menge wählst du dort. Platzhalter im Link-Muster: {"{asin}"}, {"{menge}"}, {"{suche}"}, {"{url}"} (Produktlink aus dem Post). Muster mit {"{variante}"} (z. B. Shopify <code>/cart/{"{variante}"}:{"{menge}"}</code>) fallen auf die Produktseite zurück, solange die Variante unbekannt ist.
      </div>

      <section className="card card-pad stack" style={{ marginBottom: 12 }} data-testid="sp-payback">
        <h2 style={{ margin: 0 }}>Payback (Amazon.de)</h2>
        <div className="small">
          Geprüft am 01.11.2026: Eine feste Payback-Verknüpfung im Amazon-Konto gibt es nicht – Punkte nur, wenn der Einkauf in der PAYBACK-App bzw. auf payback.de startet (Warenkorb vorher leer). Gewerbe- und Großmengenkäufe sind laut Payback-Bedingungen ausgenommen. Der Warenkorb-Link aus dem Push startet nicht über Payback. <Link href="/wissen?q=Payback">Anleitung im Wissen →</Link>
        </div>
        <form action={paybackSpeichern} className="row small" style={{ gap: 8, alignItems: "center" }}>
          <label><input type="checkbox" name="paybackEingerichtet" defaultChecked={st.dealEingang.paybackEingerichtet} disabled={!owner} data-testid="sp-payback-schalter" /> Payback eingerichtet ✅ (nur Anzeige – blendet den Hinweis im Push aus; keine Payback-Nummer im System)</label>
          {owner && <button className="btn btn-small" type="submit" data-testid="sp-payback-speichern">Speichern</button>}
        </form>
      </section>

      <section className="card card-pad stack" data-testid="sp-liste">
        <h2 style={{ margin: 0 }}>Shops</h2>
        {[...profile, ...(owner ? [leer] : [])].map((p) => (
          <form key={p.kuerzel || "neu"} action={shopProfilSpeichern} className="stack" style={{ gap: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }} data-testid="sp-profil" data-kuerzel={p.kuerzel || "neu"}>
            <div className="row small" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              <label className="field">Kürzel<input className="input" name="kuerzel" defaultValue={p.kuerzel} readOnly={!!p.kuerzel} placeholder="neu, z. B. ALTER" style={{ width: 90 }} disabled={!owner} /></label>
              <label className="field">Name<input className="input" name="name" defaultValue={p.name} style={{ width: 140 }} disabled={!owner} /></label>
              <label className="field">Domains<input className="input" name="domains" defaultValue={p.domains.join(", ")} placeholder="shop.de" style={{ width: 170 }} disabled={!owner} /></label>
              <label className="field">Link-Art<select className="input" name="linkArt" defaultValue={p.linkArt} disabled={!owner}>{LINK_ARTEN.map((a) => <option key={a} value={a}>{ART[a]}</option>)}</select></label>
              <label className="field" style={{ flexGrow: 1 }}>Link-Muster<input className="input" name="linkMuster" defaultValue={p.linkMuster ?? ""} placeholder="leer = Produktlink aus dem Post" style={{ minWidth: 220 }} disabled={!owner} /></label>
            </div>
            <div className="row small" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              <label className="field" style={{ flexGrow: 1 }}>Hinweis im Push<input className="input" name="hinweis" defaultValue={p.hinweis ?? ""} placeholder="z. B. Gutscheincode im Warenkorb" disabled={!owner} /></label>
              <label className="field" style={{ flexGrow: 1 }}>Payback (wie?)<input className="input" name="payback" defaultValue={p.payback ?? ""} placeholder="leer = kein Payback; z. B. Kundenkonto verknüpfen" disabled={!owner} /></label>
              <label><input type="checkbox" name="aktiv" defaultChecked={p.aktiv} disabled={!owner} /> aktiv</label>
              {owner && <button className="btn btn-small" type="submit">{p.kuerzel ? "Speichern" : "Neu anlegen"}</button>}
              {owner && p.kuerzel && geaendert.has(p.kuerzel) && (
                <button className="btn btn-small" type="submit" formAction={shopProfilZuruecksetzen} title={standard.has(p.kuerzel) ? "Zurück zum Standard" : "Eigenes Profil entfernen"}>{standard.has(p.kuerzel) ? "Standard" : "Entfernen"}</button>
              )}
              <span className="muted">{standard.has(p.kuerzel) ? (geaendert.has(p.kuerzel) ? "Start-Profil, geändert" : "Start-Profil") : p.kuerzel ? "eigenes Profil" : ""}</span>
            </div>
          </form>
        ))}
      </section>
    </>
  );
}
