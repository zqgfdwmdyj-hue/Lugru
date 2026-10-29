import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { CLAIM_TYPES } from "@/db/schema";
import { requireOwner } from "@/lib/auth/session";
import { CLAIM_TYPE_LABEL, getSettings } from "@/lib/settings";
import { mergeSuppliersAction, removeUser, saveSettings, saveSupplierName, setPrivateAccess } from "./actions";
import { similarSuppliers } from "@/lib/suppliers/duplicates";
import { ConfirmButton } from "@/components/confirm-button";
import { AccessForm, AddUserForm, PasswordForm, SetPasswordForm } from "./user-forms";
import { STAFF_AREAS as AREAS } from "@/lib/auth/areas";
import { formatSeen, isOnline } from "@/lib/auth/last-seen";
import { InvoiceSettingsCards } from "../rechnungen/ausgang/settings-cards";
import { MailboxManager } from "../posteingang/mailbox-manager";
import { getIntegration } from "@/lib/integrations/store";
import { imCreds, imPageFormats, type ImPageFormat } from "@/lib/integrations/clients/deutschepost";
import { isLabelPrinterFormat } from "@/lib/shipping/internetmarke";
import { AddressCheck } from "./address-check";

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

/** Formate für Etikettendrucker (Brother, Dymo, Rollen) zuerst anbieten. */

export default async function EinstellungenPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireOwner();
  const { meldung } = await searchParams;
  const s = await getSettings(session.tenantId);
  // Druckformate der Internetmarke (nur mit Anschrift) – wenn die Anbindung steht, als Auswahl.
  const im = imCreds(await getIntegration(session.tenantId, "deutschepost"));
  let pageFormats: ImPageFormat[] | null = null;
  let pageFormatError: string | null = null;
  if (im) {
    try {
      pageFormats = (await imPageFormats(im)).filter((f) => f.isAddressPossible);
    } catch (e) {
      pageFormatError = e instanceof Error ? e.message : String(e);
    }
  }
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, session.tenantId));
  const suppliers = await db.select().from(schema.suppliers).where(eq(schema.suppliers.tenantId, session.tenantId)).orderBy(asc(schema.suppliers.code));
  const pairs = similarSuppliers(suppliers);
  // Wie oft wird ein Shop verwendet (Chargen, Rechnungen)? Hilft bei der Entscheidung, welcher bleibt.
  const usage = new Map(
    (
      await db.execute<{ id: string; lots: number; invoices: number }>(sql`
        select s.id, (select count(*)::int from lots l where l.tenant_id = s.tenant_id and l.supplier_id = s.id) as lots,
               (select count(*)::int from invoices i where i.tenant_id = s.tenant_id and i.supplier_id = s.id) as invoices
          from suppliers s where s.tenant_id = ${session.tenantId}`)
    ).rows.map((r) => [r.id, r]),
  );
  const brands = await db.select({ id: schema.brands.id, name: schema.brands.name }).from(schema.brands).where(eq(schema.brands.tenantId, session.tenantId)).orderBy(asc(schema.brands.name));
  const members = await db
    .select({ userId: schema.users.id, email: schema.users.email, name: schema.users.name, lastLoginAt: schema.users.lastLoginAt, lastSeenAt: schema.users.lastSeenAt, privateAccess: schema.memberships.privateAccess, privateScope: schema.memberships.privateScope, role: schema.memberships.role, areas: schema.memberships.areas, brandIds: schema.memberships.brandIds, readOnly: schema.memberships.readOnly })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.tenantId, session.tenantId));
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 } as const;

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">System</div><h1>Einstellungen</h1></div>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Link className="btn" href="/einstellungen/claude">Claude & KI-Assistent →</Link>
          <Link className="btn" href="/anbindungen">Anbindungen →</Link>
          <Link className="btn" href="/einstellungen/testumgebung">Testumgebung →</Link>
        </span>
      </div>
      {meldung && <div className="notice notice-info" data-testid="settings-msg">{meldung}</div>}
      <AddressCheck />

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

        <section className="card card-pad stack" style={{ gap: 14 }} id="retouren-station">
          <h2>Retouren-Station</h2>
          <div style={grid}>
            <Field label="Fall erst ab Erstattung an den Kunden" name="rs_minBetrag" value={dec(s.retourenStation.minBetrag)} suffix="€" width={80} />
            <Field label="Fotos und Videos aufbewahren" name="rs_aufbewahrungTage" value={s.retourenStation.aufbewahrungTage} suffix="Tage" width={80} help="Solange ein Anspruch offen ist, bleiben sie" />
            <Field label="Aktivierungswort" name="rs_aktivierungswort" value={s.retourenStation.aktivierungswort} width={140} />
            <label className="check small" style={{ alignSelf: "end" }}><input type="checkbox" name="rs_aktivierungAn" defaultChecked={s.retourenStation.aktivierungAn} /> Befehle nur nach dem Aktivierungswort</label>
          </div>
          <div className="small muted">Mit Aktivierungswort lösen Gespräche im Raum nichts aus: „Station Etikett“ statt nur „Etikett“. Die Frist für Fälle aus der Station steht oben bei „{CLAIM_TYPE_LABEL.return_condition}“ (falsches Produkt: „{CLAIM_TYPE_LABEL.return_wrong_item}“) – gezählt ab dem Rückgabedatum.</div>
        </section>

        <section className="card card-pad stack" style={{ gap: 14, scrollMarginTop: 70 }} id="b2b" data-testid="settings-b2b">
          <h2>B2B-Deals</h2>
          <div className="small muted">Firma, auf die Deals und Rechnungen laufen (Rechnungen über Lexoffice dieser Firma – Schlüssel unter Anbindungen).</div>
          <div style={grid}>
            <Field label="Firma (Rechnungen)" name="b2b_firma_name" value={s.b2b.firma.name} width={220} />
            <Field label="Handelsname im Portal" name="b2b_firma_handelsname" value={s.b2b.firma.handelsname} width={220} />
            <Field label="Straße" name="b2b_firma_strasse" value={s.b2b.firma.strasse} width={220} />
            <Field label="PLZ" name="b2b_firma_plz" value={s.b2b.firma.plz} width={90} />
            <Field label="Ort" name="b2b_firma_ort" value={s.b2b.firma.ort} width={160} />
            <Field label="Land" name="b2b_firma_land" value={s.b2b.firma.land} width={60} />
            <Field label="USt-IdNr." name="b2b_firma_ustId" value={s.b2b.firma.ustId} width={160} />
            <Field label="E-Mail für Kunden" name="b2b_firma_email" value={s.b2b.firma.email} width={220} />
            <Field label="Telefon" name="b2b_firma_telefon" value={s.b2b.firma.telefon} width={160} />
          </div>
          <div className="field">
            <span className="label">Marktplätze in der Auswertung</span>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {["DE", "FR", "IT", "ES", "NL", "BE", "PL", "SE", "UK"].map((m) => <label key={m} className="check small"><input type="checkbox" name="b2b_mp" value={m} defaultChecked={s.b2b.marktplaetze.includes(m)} /> {m}</label>)}
            </div>
          </div>
          <div style={grid}>
            <Field label="Mindest-ROI für Kunden" name="b2b_minKundenRoi" value={pct(s.b2b.minKundenRoi)} suffix="%" width={70} help="Darunter warnt die Rechenhilfe" />
            <Field label="Mengenfaktor" name="b2b_mengenFaktor" value={dec(s.b2b.mengenFaktor)} suffix="× Verkäufe/Monat" width={70} help="Vorschlag max. Gesamtmenge je Deal" />
            <Field label="Max. Kunden je ASIN" name="b2b_maxKundenProAsin" value={s.b2b.maxKundenProAsin} width={70} />
            <Field label="Prep-Gebühr je Stück" name="b2b_prepGebuehr" value={dec(s.b2b.prepGebuehr)} suffix="€" width={70} help="In der Kundenrechnung" />
            <Field label="Versandanteil je Stück" name="b2b_versandAnteil" value={dec(s.b2b.versandAnteil)} suffix="€" width={70} help="Großhändler → Prep, in unserem Verdienst" />
            <Field label="„Fast weg“ ab" name="b2b_fastWegProzent" value={pct(s.b2b.fastWegProzent)} suffix="% vergeben" width={70} />
            <Field label="USt-Satz Inland" name="b2b_ustSatz" value={pct(s.b2b.ustSatz)} suffix="%" width={70} />
            <div className="field">
              <label className="label" htmlFor="b2b_fehlmengenRegel">Bei Fehlmenge kürzen</label>
              <select className="input" id="b2b_fehlmengenRegel" name="b2b_fehlmengenRegel" defaultValue={s.b2b.fehlmengenRegel} style={{ width: 220 }}>
                <option value="anteilig">anteilig nach Menge</option>
                <option value="zeitpunkt">nach Reservierungszeitpunkt</option>
              </select>
            </div>
            <label className="check small" style={{ alignSelf: "end" }}><input type="checkbox" name="b2b_nurBezahlteBestellen" defaultChecked={s.b2b.nurBezahlteBestellen} /> Nur bezahlte Reservierungen bestellen</label>
          </div>
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

        <section className="card card-pad stack" style={{ gap: 14 }} id="prep" data-testid="settings-prep">
          <h2>Prep Center</h2>
          <span className="small muted">Je Auftrag wird festgehalten, wer verschickt: du selbst oder das Prep Center (Labels kommen aus dem System). Die Monatsübersicht unter Aufträge → „Prep Center: Versand je Monat“ zählt Sendungen und Stück zum Abgleich mit seiner Rechnung.</span>
          <div style={grid}>
            <Field label="Name" name="prep_name" value={s.prep.name} width={220} />
            <div className="field">
              <label className="label" htmlFor="prep_default">Verschickt standardmäßig</label>
              <select className="select" id="prep_default" name="prep_default" defaultValue={s.prep.defaultShipper}>
                <option value="self">ich selbst</option>
                <option value="prep">Prep Center</option>
              </select>
              <span className="small muted">je Artikel abweichend unter „Labels: Warensendung &amp; DHL“</span>
            </div>
            <Field label="Gebühr je Sendung" name="prep_feeShipment" value={dec(s.prep.feeShipment)} suffix="€" width={90} help="0 = nur zählen" />
            <Field label="je weiteres Stück" name="prep_feeExtraItem" value={dec(s.prep.feeExtraItem)} suffix="€" width={90} help="ab dem 2. Stück einer Sendung" />
          </div>
        </section>

        <section className="card card-pad stack" style={{ gap: 14, scrollMarginTop: 70 }} id="warensendung" data-testid="settings-post">
          <h2>Warensendung (Deutsche Post)</h2>
          <span className="small muted">
            Für „Lieferschein → Labels“: ein Stück geht als Warensendung über die INTERNETMARKE (Porto mit Anschrift, bezahlt aus der Portokasse), ab zwei Stück als DHL-Paket. Absender wie oben.{" "}
            {im ? "Anbindung eingerichtet." : <Link href="/anbindungen?p=deutschepost#deutschepost">Anbindung einrichten</Link>}
          </span>
          <div style={grid}>
            <Field label="Produktnummer (PPL)" name="post_productCode" value={s.post.productCode} width={100} help="290 = Warensendung bis 1.000 g" />
            <Field label="Preis je Sendung" name="post_price" value={dec(s.post.price)} suffix="€" width={90} help="muss zur aktuellen Preisliste passen" />
            {pageFormats?.length ? (
              <div className="field">
                <label className="label" htmlFor="post_pageFormat">Druckformat</label>
                <select className="select" id="post_pageFormat" name="post_pageFormat" defaultValue={((f) => (f ? `${f.id}:${f.labelX}:${f.labelY}:${f.name}` : `${s.post.pageFormatId}:${s.post.labelX}:${s.post.labelY}`))(pageFormats.find((f) => f.id === s.post.pageFormatId))} style={{ maxWidth: 360 }}>
                  {!pageFormats.some((f) => f.id === s.post.pageFormatId) && <option value={`${s.post.pageFormatId}:${s.post.labelX}:${s.post.labelY}`}>{s.post.pageFormatName || `Format ${s.post.pageFormatId}`}</option>}
                  {[
                    { label: "Etikettendrucker (Rolle)", list: pageFormats.filter((f) => isLabelPrinterFormat(f.name)) },
                    { label: "Bogen und Normalpapier", list: pageFormats.filter((f) => !isLabelPrinterFormat(f.name)) },
                  ]
                    .filter((g) => g.list.length)
                    .map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.list.map((f) => (
                          <option key={f.id} value={`${f.id}:${f.labelX}:${f.labelY}:${f.name}`}>{f.name}{f.labelX * f.labelY > 1 ? ` (${f.labelX * f.labelY} je Seite)` : ""}</option>
                        ))}
                      </optgroup>
                    ))}
                </select>
                <span className="small muted">Etikettenbogen, Rolle oder Normalpapier – wie in der Portokasse.</span>
                <span className="small muted" data-testid="post-brother-hint">
                  <strong>Brother QL (z. B. QL-800):</strong> 62 × 29 mm (DK-11209) bietet die Post für die Internetmarke nicht an – die Marke darf auch nicht verkleinert werden. Für Warensendungen die Rolle <strong>DK-22205 (62 mm endlos)</strong> oder DK-11202 (62 × 100) einlegen und hier „Brother DK-22205 Endlos-Etikett 62mm“ wählen: ein Etikett mit Marke, Empfänger und Absender. Drucken mit 100 % („Tatsächliche Größe“), nicht „an Seite anpassen“. Die 62 × 29-Etiketten bleiben für Adressaufkleber.
                </span>
              </div>
            ) : (
              <Field label="Druckformat (Nr.)" name="post_pageFormatId" value={s.post.pageFormatId} width={80} help={pageFormatError ? `Liste nicht abrufbar: ${pageFormatError}` : "1 = DIN A4 Normalpapier; Auswahl erscheint nach Einrichtung der Anbindung"} />
            )}
            <Field label="Gewicht je Stück (für DHL)" name="post_itemGrams" value={s.post.itemGrams} suffix="g" width={80} help="wenn beim Artikel kein Gewicht hinterlegt ist" />
          </div>
        </section>

        <div><button className="btn btn-primary" type="submit">Einstellungen speichern</button></div>
      </form>

      <section className="stack" id="postfaecher" style={{ gap: 10, maxWidth: 720 }}>
        <MailboxManager tenantId={session.tenantId} />
        <Link className="small" href="/posteingang">Zum Posteingang →</Link>
      </section>

      <section className="stack" id="rechnungen" style={{ gap: 10 }}>
        <div className="between"><h2>Ausgangsrechnungen</h2><Link className="small" href="/rechnungen/ausgang">Zu den Ausgangsrechnungen →</Link></div>
        <InvoiceSettingsCards tenantId={session.tenantId} />
        <div className="small muted">Absenderdaten (Firma, Anschrift, USt-ID) für Rechnungen: <Link href="/ebay?ansicht=einstellungen&tab=invoices">eBay-Einstellungen → Rechnungen</Link>. Stotax-Anbindung: <Link href="/anbindungen?p=stotax#stotax">Anbindungen</Link>.</div>
      </section>

      <section className="card" style={{ overflow: "hidden" }} id="shops">
        <div className="card-head"><h2>Shops / Lieferanten</h2><span className="small muted">Kürzel aus den SKUs – hier einen lesbaren Namen vergeben</span></div>
        {pairs.length > 0 && (
          <details className="card-pad" style={{ borderBottom: "1px solid var(--border)" }} data-testid="supplier-dups">
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Mögliche Doppel prüfen ({pairs.length})</summary>
            <div className="small muted" style={{ margin: "6px 0 10px" }}>Nur Vorschläge – nichts wird automatisch zusammengeführt. Beim Zusammenführen wandern Chargen, Rechnungen, Regeln, Bestellungen und Kontakte zum behaltenen Eintrag; die SKUs bleiben unverändert.</div>
            <div className="stack" style={{ gap: 8 }}>
              {pairs.map(({ a, b, reason }) => {
                const u = (id: string) => usage.get(id) ?? { lots: 0, invoices: 0 };
                const label = (x: typeof a) => `${x.code}${x.name ? ` – ${x.name}` : ""} (${u(x.id).lots} Chargen, ${u(x.id).invoices} Rechnungen)`;
                return (
                  <div key={`${a.id}-${b.id}`} className="between" style={{ flexWrap: "wrap", gap: 8 }} data-testid="supplier-dup">
                    <span className="small"><strong>{label(a)}</strong> und <strong>{label(b)}</strong> · {reason}</span>
                    <span style={{ display: "flex", gap: 6 }}>
                      <form action={mergeSuppliersAction}><input type="hidden" name="keep" value={a.id} /><input type="hidden" name="drop" value={b.id} /><ConfirmButton confirm={`„${b.code}“ in „${a.code}“ zusammenführen? „${b.code}“ verschwindet danach aus der Liste.`}>„{a.code}“ behalten</ConfirmButton></form>
                      <form action={mergeSuppliersAction}><input type="hidden" name="keep" value={b.id} /><input type="hidden" name="drop" value={a.id} /><ConfirmButton confirm={`„${a.code}“ in „${b.code}“ zusammenführen? „${a.code}“ verschwindet danach aus der Liste.`}>„{b.code}“ behalten</ConfirmButton></form>
                    </span>
                  </div>
                );
              })}
            </div>
          </details>
        )}
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
        {(() => {
          const last = members.filter((m) => m.lastLoginAt && m.userId !== session.userId).sort((a, b) => b.lastLoginAt!.getTime() - a.lastLoginAt!.getTime())[0];
          const online = members.filter((m) => isOnline(m.lastSeenAt) && m.userId !== session.userId);
          return (
            <div className="small" data-testid="last-login-summary">
              {last ? <>Zuletzt angemeldet: <strong>{last.name ?? last.email}</strong> – {formatSeen(last.lastLoginAt)}</> : <span className="muted">Außer dir hat sich noch niemand angemeldet.</span>}
              {online.length > 0 && <> · gerade aktiv: {online.map((m) => m.name ?? m.email).join(", ")}</>}
            </div>
          );
        })()}
        <table className="table users-table">
          <thead><tr><th>Benutzer</th><th>Name</th><th>Zuletzt angemeldet</th><th>Rolle / Zugriff</th><th></th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <td>{m.email}</td><td>{m.name ?? "–"}</td>
                <td className="small" data-testid="user-last-login">
                  {isOnline(m.lastSeenAt) && <span className="tag tag-ok" style={{ marginRight: 6 }}>aktiv</span>}
                  {formatSeen(m.lastLoginAt)}
                  {m.lastSeenAt && !isOnline(m.lastSeenAt) && m.lastLoginAt && m.lastSeenAt.getTime() - m.lastLoginAt.getTime() > 5 * 60_000 && <div className="muted">zuletzt aktiv {formatSeen(m.lastSeenAt)}</div>}
                </td>
                <td>
                  {m.role === "owner" ? "Inhaber (alles)" : (
                    <details>
                      <summary style={{ cursor: "pointer" }}>
                        Mitarbeiter · {m.areas === null ? "alle Bereiche" : m.areas.length ? AREAS.filter((a) => m.areas!.includes(a.key)).map((a) => a.label.split(" (")[0]).join(", ") : "kein Bereich"}
                        {m.brandIds !== null && ` · Marken: ${brands.filter((b) => m.brandIds!.includes(b.id)).map((b) => b.name).join(", ") || "keine"}`}
                        {m.readOnly && <span className="tag tag-info" style={{ marginLeft: 6 }} data-testid="user-read-only">nur ansehen</span>}
                      </summary>
                      <AccessForm userId={m.userId} areas={m.areas} brandIds={m.brandIds} readOnly={m.readOnly} allAreas={AREAS.map((a) => ({ key: a.key, label: a.label }))} brands={brands} />
                    </details>
                  )}
                </td>
                <td className="right">
                  {m.readOnly ? (
                    <div className="small muted" style={{ marginBottom: 4 }} data-testid="private-access-readonly" title="Nur-ansehen-Konten bekommen „Privat“ nie – auch nicht, wenn es früher freigegeben wurde.">
                      🔒 Privat: gesperrt (nur ansehen)
                    </div>
                  ) : (
                    <form action={setPrivateAccess} style={{ marginBottom: 4, display: "inline-flex", gap: 4, alignItems: "center" }} data-testid="private-access">
                      <input type="hidden" name="userId" value={m.userId} />
                      <label className="small muted" htmlFor={`pa-${m.userId}`}>🔒 Privat</label>
                      <select className="select" id={`pa-${m.userId}`} name="level" defaultValue={m.privateAccess ? m.privateScope : "aus"} style={{ padding: "3px 6px", fontSize: 13 }} title="Bereich „Privat“ – wird einzeln vergeben, auch für Inhaber. „Nur Familie“: Kinderzeit, Ausschlafen, Auszeit, Zuständigkeiten – nichts aus Partnerschaft, Gesundheit oder Therapie.">
                        <option value="aus">kein Zugang</option>
                        <option value="familie">nur Familie</option>
                        <option value="voll">voll</option>
                      </select>
                      <button className="btn btn-small" type="submit">ändern</button>
                    </form>
                  )}
                  {m.userId !== session.userId && (
                    <div className="stack" style={{ gap: 4, alignItems: "flex-end" }}>
                      <SetPasswordForm userId={m.userId} login={m.email} />
                      <form action={removeUser}><input type="hidden" name="userId" value={m.userId} /><button className="btn-link small danger">Entfernen</button></form>
                    </div>
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
