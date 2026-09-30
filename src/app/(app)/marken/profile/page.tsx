import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { OCCASIONS } from "@/lib/brands/occasions";
import { visibleBrands } from "@/lib/brands/access";
import { createBrandAction } from "../actions";
import { SaveForm } from "../forms";

export default async function ProfilePage() {
  const session = await requireArea("marken");
  const brands = await visibleBrands(session);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/marken">Marken</Link></div><h1>Markenprofile</h1></div>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: 860 }}>
        Je genauer das Profil, desto passender die KI-Ideen und Skripte. Bei „Anlässe“ ankreuzen, was zur Marke passt, und wie viele Wochen vorher die Planung beginnen soll – dann erscheint rechtzeitig eine Aufgabe (auch im Kalender) und, mit KI-Schlüssel, fünf fertige Ideen.
      </p>
      {brands.map((b) => (
        <section key={b.id} className="card card-pad" style={{ borderTop: `4px solid ${b.color ?? "var(--accent)"}` }}>
          <SaveForm kind="brand">
            <input type="hidden" name="id" value={b.id} />
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }} className="profile-grid">
              <div className="stack" style={{ gap: 10 }}>
                <div className="field"><label className="label">Name</label><input className="input" name="name" defaultValue={b.name} /></div>
                <div className="field"><label className="label">Sortiment / Positionierung</label><textarea className="textarea" name="description" defaultValue={b.description ?? ""} style={{ minHeight: 80 }} /></div>
                <div className="field"><label className="label">Zielgruppe</label><input className="input" name="audience" defaultValue={b.audience ?? ""} /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div className="field"><label className="label">Preisrahmen</label><input className="input" name="priceRange" defaultValue={b.priceRange ?? ""} /></div>
                  <div className="field"><label className="label">Tonalität</label><input className="input" name="tone" defaultValue={b.tone ?? ""} /></div>
                </div>
                <div className="field"><label className="label">Umsatzsteuer der Produkte</label>
                  <select className="input" name="vatRate" defaultValue={String(Number(b.vatRate))} style={{ width: "auto" }}>
                    <option value="7">7 % (Lebensmittel, Süßigkeiten)</option><option value="19">19 % (Standard)</option><option value="0">0 %</option>
                  </select></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div className="field"><label className="label">Verkäuferkonto auf Amazon</label><input className="input" name="sellerName" defaultValue={b.sellerName ?? ""} placeholder="z. B. Firma GmbH" /></div>
                  <div className="field"><label className="label">Händlerkennung (Seller-ID)</label><input className="input" name="sellerId" defaultValue={b.sellerId ?? ""} placeholder="A1B2C3D4E5F6G7" style={{ fontFamily: "var(--mono)" }} /></div>
                </div>
                <label className="small" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <input type="checkbox" name="boxAuto" defaultChecked={b.boxAuto} />
                  <span><strong>Boxen selbstständig vorschlagen</strong> – einmal pro Woche aus neuen Lieferanten-Artikeln (mit TikTok-Trends, Keepa-Vergleich und Gewinnrechnung). Es entsteht eine Aufgabe, die Boxen stehen im Ideen-Board.{b.lastBoxRunAt ? ` Zuletzt: ${b.lastBoxRunAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}.` : ""}</span>
                </label>
                <div className="field"><label className="label">Amazon-Konto für den Artikelstamm</label>
                  <select className="input" name="amazonAccount" defaultValue={b.amazonAccount} style={{ width: "auto" }}>
                    <option value="haupt">Hauptkonto (Anbindungen → Amazon Seller Central)</option>
                    <option value="zweit">Zweites Konto (Anbindungen → Amazon – zweites Verkäuferkonto)</option>
                  </select></div>
                <details>
                  <summary className="label" style={{ cursor: "pointer" }}>Hersteller / Verantwortlicher (GPSR) – Vorlage für neue Artikel</summary>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
                    <input className="input" name="gpsr_companyName" defaultValue={b.gpsr.companyName ?? b.sellerName ?? ""} placeholder="Firma" />
                    <input className="input" name="gpsr_addressLine1" defaultValue={b.gpsr.addressLine1 ?? ""} placeholder="Straße und Nr." />
                    <input className="input" name="gpsr_postalCode" defaultValue={b.gpsr.postalCode ?? ""} placeholder="PLZ" />
                    <input className="input" name="gpsr_city" defaultValue={b.gpsr.city ?? ""} placeholder="Ort" />
                    <input className="input" name="gpsr_country" defaultValue={b.gpsr.country ?? "DE"} placeholder="Land (ISO)" />
                    <input className="input" name="gpsr_email" defaultValue={b.gpsr.email ?? ""} placeholder="E-Mail" />
                  </div>
                </details>
                <div className="small muted" style={{ marginTop: -6 }}>Für den Buy-Box-Abgleich in der Shop-Analyse. Die Kennung steht in Seller Central → Einstellungen → Kontoinformationen → Händlerkennung – oder dort mit „Ja, das sind wir“ übernehmen.</div>
                <div className="field"><label className="label">Links (Shop, TikTok, YouTube, Instagram) – einer pro Zeile</label><textarea className="textarea" name="links" defaultValue={b.links ?? ""} style={{ minHeight: 70, fontFamily: "var(--mono)", fontSize: 12 }} /></div>
                {b.links && (
                  <div className="small" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {b.links.split(/\r?\n/).filter((l) => /^https?:\/\//.test(l.trim())).map((l) => <a key={l} href={l.trim()} target="_blank" rel="noopener">{new URL(l.trim()).hostname} ↗</a>)}
                  </div>
                )}
                <div className="field"><label className="label">Trend-Suchbegriffe (Google News) – einer pro Zeile</label><textarea className="textarea" name="trendTopics" defaultValue={b.trendTopics ?? ""} style={{ minHeight: 70 }} /></div>
              </div>
              <div className="field">
                <label className="label">Anlässe und Vorlauf (Wochen)</label>
                <div className="stack" style={{ gap: 4 }}>
                  {OCCASIONS.map((o) => (
                    <div key={o.key} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                      <input type="checkbox" id={`${b.id}-${o.key}`} name={`occ:${o.key}`} defaultChecked={o.key in b.occasions} />
                      <label htmlFor={`${b.id}-${o.key}`} style={{ flex: 1 }}>{o.name}{o.hint ? <span className="small muted"> · {o.hint}</span> : null}</label>
                      <input className="input" name={`lead:${o.key}`} type="number" min={1} max={52} defaultValue={b.occasions[o.key] ?? o.leadWeeks} style={{ width: 70 }} aria-label={`Vorlauf ${o.name}`} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SaveForm>
        </section>
      ))}
      <form action={createBrandAction} className="card card-pad" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input className="input" name="name" placeholder="Weitere Marke anlegen" style={{ flex: "1 1 200px" }} />
        <button className="btn" type="submit">Anlegen</button>
      </form>
    </>
  );
}
