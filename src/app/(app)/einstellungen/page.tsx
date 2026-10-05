import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { CLAIM_TYPES } from "@/db/schema";
import { requireOwner } from "@/lib/auth/session";
import { CLAIM_TYPE_LABEL, getSettings } from "@/lib/settings";
import { removeUser, saveSettings, saveSupplierName } from "./actions";
import { AccessForm, AddUserForm, PasswordForm } from "./user-forms";
import { AREAS } from "@/lib/auth/areas";

function Field({ label, name, value, suffix, help, type = "text", width = 160 }: { label: string; name: string; value?: string | number; suffix?: string; help?: string; type?: string; width?: number }) {
  return (
    <div className="field">
      <label className="label" htmlFor={name}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input className="input" id={name} name={name} type={type} defaultValue={value ?? ""} style={{ width }} />
        {suffix && <span className="small muted">{suffix}</span>}
      </div>
      {help && <span className="small muted">{help}</span>}
    </div>
  );
}

const pct = (n: number) => String(Math.round(n * 10000) / 100).replace(".", ",");
const dec = (n: number) => String(n).replace(".", ",");

export default async function EinstellungenPage() {
  const session = await requireOwner();
  const s = await getSettings(session.tenantId);
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
  const suppliers = await db.select().from(schema.suppliers).where(eq(schema.suppliers.tenantId, session.tenantId)).orderBy(asc(schema.suppliers.code));
  const brands = await db.select({ id: schema.brands.id, name: schema.brands.name }).from(schema.brands).where(eq(schema.brands.tenantId, session.tenantId)).orderBy(asc(schema.brands.name));
  const members = await db
    .select({ userId: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.memberships.role, areas: schema.memberships.areas, brandIds: schema.memberships.brandIds })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.tenantId, session.tenantId));
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 } as const;

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">System</div><h1>Einstellungen</h1></div>
        <Link className="btn" href="/anbindungen">Anbindungen →</Link>
      </div>

      <form action={saveSettings} className="stack" style={{ gap: 16 }}>
        <section className="card card-pad stack" style={{ gap: 14 }}>
          <h2>Allgemein</h2>
          <div style={grid}>
            <Field label="Firmenname" name="tenantName" value={tenant.name} width={220} />
            <Field label="MwSt-Satz" name="vatRate" value={pct(s.vatRate)} suffix="%" width={80} help="Für Brutto-EK aus SKUs" />
            <Field label="Import-Erinnerung nach" name="importReminderDays" value={s.importReminderDays} suffix="Tagen" width={80} />
          </div>
        </section>

        <section className="card card-pad stack" style={{ gap: 14 }}>
          <h2>Ansprüche</h2>
          <div style={grid}>
            <Field label="Fälle pro Tag (Amazon-Limit)" name="dailyLimit" value={s.claims.dailyLimit} width={80} />
            <Field label="Limit wird zurückgesetzt um" name="resetHour" value={s.claims.resetHour} suffix="Uhr" width={80} />
            <Field label="Ansprüche erst ab" name="minAmount" value={dec(s.claims.minAmount)} suffix="€" width={80} />
            <Field label="Problem-Versender Remission" name="problemCarriers" value={s.claims.problemCarriers} width={160} />
          </div>
          <div className="small muted">Remissionspakete dieser Versender (kommagetrennt, z. B. „TENDRON“) werden ab Tag 15 nach Auftrag automatisch zum Anspruch, solange du sie nicht als angekommen markierst.</div>
          <div className="small muted">Fristen je Art in Tagen ab dem Ereignis. <strong>Bitte mit den aktuellen Amazon-Richtlinien abgleichen</strong> – die Standardwerte sind nur Platzhalter.</div>
          <div style={grid}>
            {CLAIM_TYPES.map((t) => <Field key={t} label={CLAIM_TYPE_LABEL[t]} name={`window_${t}`} value={s.claims.windowDays[t]} suffix="Tage" width={80} />)}
          </div>
        </section>

        <section className="card card-pad stack" style={{ gap: 14 }}>
          <h2>Retouren-Abgleich</h2>
          <div style={grid}>
            <Field label="FBA: Rücksendefrist nach der Erstattung" name="returns_graceFba" value={s.returns.graceFba} suffix="Tage" width={80} />
            <Field label="FBA: Amazon-Zahlung erwartet bis Tag" name="returns_claimFba" value={s.returns.claimFba} width={80} />
            <Field label="Händlerversand: Rücksendefrist nach der Anfrage" name="returns_graceFbm" value={s.returns.graceFbm} suffix="Tage" width={80} />
            <div className="field">
              <label className="label" htmlFor="returns_marketplace">Seller Central für Links</label>
              <select className="select" id="returns_marketplace" name="returns_marketplace" defaultValue={s.returns.marketplace} style={{ width: 260 }}>
                {["sellercentral.amazon.de", "sellercentral-europe.amazon.com", "sellercentral.amazon.co.uk", "sellercentral.amazon.com"].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="small muted">Amazon ändert diese Fristen immer wieder. Prüfe die aktuelle Richtlinie in Seller Central.</div>
        </section>

        <section className="card card-pad stack" style={{ gap: 14 }}>
          <h2>Preise & Repricer</h2>
          <div style={grid}>
            <Field label="Verkaufsprovision (Standard)" name="referralRate" value={pct(s.pricing.referralRate)} suffix="%" width={80} />
            <Field label="Mindestgewinn je Einheit" name="minProfit" value={dec(s.pricing.minProfit)} suffix="€" width={80} />
            <Field label="Maximalpreis = Mindestpreis ×" name="maxPriceFactor" value={dec(s.pricing.maxPriceFactor)} width={80} />
            <Field label="FBA-Gebühr, wenn unbekannt" name="defaultFbaFee" value={dec(s.pricing.defaultFbaFee)} suffix="€" width={80} />
            <Field label="Lagerkosten je Einheit (geschätzt)" name="storageFee" value={dec(s.pricing.storageFee)} suffix="€" width={80} />
            <Field label="Mindest-ROI für „Max. EK“" name="minRoi" value={pct(s.pricing.minRoi)} suffix="%" width={80} />
          </div>
        </section>

        <section className="card card-pad stack" style={{ gap: 14 }}>
          <h2>Bestand</h2>
          <div style={grid}>
            <Field label="Warnung bei unverkäuflichem Bestand nach" name="unsellableWarnDays" value={s.aging.unsellableWarnDays} suffix="Tagen" width={80} />
            <Field label="Warnung ohne Verkauf nach" name="noSaleWarnDays" value={s.aging.noSaleWarnDays} suffix="Tagen" width={80} />
          </div>
        </section>

        <section className="card card-pad stack" style={{ gap: 14 }}>
          <h2>Versand (DHL)</h2>
          <div style={grid}>
            <Field label="Absender Name" name="shipper_name1" value={s.shipper.name1} width={220} />
            <Field label="Zusatz" name="shipper_name2" value={s.shipper.name2} width={220} />
            <Field label="Straße" name="shipper_street" value={s.shipper.street} width={220} />
            <Field label="Hausnummer" name="shipper_houseNo" value={s.shipper.houseNo} width={80} />
            <Field label="PLZ" name="shipper_zip" value={s.shipper.zip} width={100} />
            <Field label="Ort" name="shipper_city" value={s.shipper.city} width={180} />
            <Field label="Land (ISO-3)" name="shipper_country" value={s.shipper.country ?? "DEU"} width={80} />
            <Field label="E-Mail" name="shipper_email" value={s.shipper.email} width={220} />
            <Field label="Telefon" name="shipper_phone" value={s.shipper.phone} width={180} />
          </div>
          <div style={grid}>
            <Field label="Abrechnungsnr. Paket" name="dhl_billingNumberPaket" value={s.dhl.billingNumberPaket} width={200} help="14-stellig, EKP + 0101 + Teilnahme" />
            <Field label="Abrechnungsnr. Kleinpaket" name="dhl_billingNumberKleinpaket" value={s.dhl.billingNumberKleinpaket} width={200} />
            <Field label="Produktcode Kleinpaket" name="dhl_productKleinpaket" value={s.dhl.productKleinpaket} width={100} help="V62KP (früher Warenpost V62WP)" />
            <Field label="Kleinpaket bis" name="dhl_kleinpaketMaxKg" value={dec(s.dhl.kleinpaketMaxKg)} suffix="kg" width={80} />
            <Field label="Labelformat" name="dhl_labelFormat" value={s.dhl.labelFormat} width={140} help="910-300-700 = 103 × 199 mm" />
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" name="dhl_sandbox" defaultChecked={s.dhl.sandbox} /> DHL-Sandbox verwenden (Testlabels, nichts wird berechnet)
          </label>
        </section>

        <div><button className="btn btn-primary" type="submit">Einstellungen speichern</button></div>
      </form>

      <section className="card" style={{ overflow: "hidden" }}>
        <div className="card-head"><h2>Shops / Lieferanten</h2><span className="small muted">Kürzel aus den SKUs – hier einen lesbaren Namen vergeben</span></div>
        {suppliers.length === 0 ? <div className="card-pad muted">Noch keine – entstehen beim Import.</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 8, padding: 16 }}>
            {suppliers.map((sup) => (
              <form key={sup.id} action={saveSupplierName} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="hidden" name="id" value={sup.id} />
                <span className="num" style={{ width: 70, fontSize: 12 }}>{sup.code}</span>
                <label className="sr-only" htmlFor={`sup-${sup.id}`}>Name für {sup.code}</label>
                <input className="input" id={`sup-${sup.id}`} name="name" defaultValue={sup.name ?? ""} placeholder="Name" style={{ padding: "5px 8px", fontSize: 13 }} />
                <button className="btn btn-small" type="submit">OK</button>
              </form>
            ))}
          </div>
        )}
      </section>

      <section className="card card-pad stack" style={{ gap: 14 }}>
        <h2>Benutzer</h2>
        <table className="table">
          <thead><tr><th>E-Mail</th><th>Name</th><th>Rolle / Zugriff</th><th></th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <td>{m.email}</td><td>{m.name ?? "–"}</td>
                <td>
                  {m.role === "owner" ? "Inhaber (alles)" : (
                    <details>
                      <summary style={{ cursor: "pointer" }}>
                        Mitarbeiter · {m.areas === null ? "alle Bereiche" : m.areas.length ? AREAS.filter((a) => m.areas!.includes(a.key)).map((a) => a.label.split(" (")[0]).join(", ") : "kein Bereich"}
                        {m.brandIds !== null && ` · Marken: ${brands.filter((b) => m.brandIds!.includes(b.id)).map((b) => b.name).join(", ") || "keine"}`}
                      </summary>
                      <AccessForm userId={m.userId} areas={m.areas} brandIds={m.brandIds} allAreas={AREAS.map((a) => ({ key: a.key, label: a.label }))} brands={brands} />
                    </details>
                  )}
                </td>
                <td className="right">
                  {m.userId !== session.userId && (
                    <form action={removeUser}><input type="hidden" name="userId" value={m.userId} /><button className="btn-link small" style={{ color: "var(--danger)" }}>Entfernen</button></form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <AddUserForm />
        <h2 style={{ marginTop: 8 }}>Eigenes Passwort</h2>
        <PasswordForm />
      </section>
    </>
  );
}
