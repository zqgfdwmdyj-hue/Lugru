import "server-only";
import { getIntegration } from "../store";
import { registerTester } from "../test";
import { postDiscord } from "./discord";

// Lexware Office (früher Lexoffice) – öffentliche API: Kontakte, Rechnungen (Vorkasse), Zahlungsstand, Gutschriften.
// Höchstens 2 Anfragen je Sekunde; bei 429 kurz warten und einmal wiederholen. In der Testumgebung zeigt
// LEXOFFICE_BASE_URL auf die Testdienste.

const BASIS = () => (process.env.LEXOFFICE_BASE_URL || "https://api.lexware.io").replace(/\/$/, "");

let letzte = 0;
async function takt() {
  const warten = letzte + 520 - Date.now();
  letzte = Math.max(Date.now(), letzte + 520);
  if (warten > 0) await new Promise((r) => setTimeout(r, warten));
}

export class LexofficeFehler extends Error {
  constructor(public status: number, text: string) {
    super(text);
    this.name = "LexofficeFehler";
  }
}

async function anfrage<T>(key: string, method: string, pfad: string, body?: unknown, accept = "application/json"): Promise<T> {
  for (let versuch = 0; ; versuch++) {
    await takt();
    const res = await fetch(`${BASIS()}${pfad}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, Accept: accept, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429 && versuch < 2) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      let msg = t.slice(0, 300);
      try {
        const j = JSON.parse(t) as { message?: string; IssueList?: { i18nKey?: string; source?: string }[] };
        msg = [j.message, ...(j.IssueList ?? []).map((i) => `${i.source ?? ""} ${i.i18nKey ?? ""}`.trim())].filter(Boolean).join(" · ") || msg;
      } catch {
        // kein JSON
      }
      throw new LexofficeFehler(res.status, `Lexoffice ${res.status}: ${msg}`);
    }
    if (accept !== "application/json") return Buffer.from(await res.arrayBuffer()) as T;
    return (await res.json()) as T;
  }
}

export async function lexofficeKey(tenantId: string): Promise<string | null> {
  return (await getIntegration(tenantId, "lexoffice"))?.apiKey ?? null;
}

async function key(tenantId: string): Promise<string> {
  const k = await lexofficeKey(tenantId);
  if (!k) throw new Error("Lexoffice ist nicht verbunden (Anbindungen → Lexoffice).");
  return k;
}

export type LexKontakt = { firma: string; ansprechpartner: string | null; email: string | null; strasse: string | null; plz: string | null; ort: string | null; land: string; ustId: string | null; reverseCharge: boolean };

export async function kontaktAnlegen(tenantId: string, k: LexKontakt): Promise<string> {
  const [vor, ...nach] = (k.ansprechpartner ?? "").trim().split(/\s+/).reverse();
  const r = await anfrage<{ id: string }>(await key(tenantId), "POST", "/v1/contacts", {
    version: 0,
    roles: { customer: {} },
    company: {
      name: k.firma,
      ...(k.ustId ? { vatRegistrationId: k.ustId } : {}),
      allowTaxFreeInvoices: k.reverseCharge,
      ...(k.ansprechpartner ? { contactPersons: [{ lastName: vor, firstName: nach.reverse().join(" ") || undefined, emailAddress: k.email ?? undefined, primary: true }] } : {}),
    },
    addresses: { billing: [{ street: k.strasse ?? undefined, zip: k.plz ?? undefined, city: k.ort ?? undefined, countryCode: k.land }] },
    ...(k.email ? { emailAddresses: { business: [k.email] } } : {}),
  });
  return r.id;
}

export type LexPosition = { name: string; beschreibung?: string; menge: number; einheit: string; netto: number; steuersatz: number };
export type LexBeleg = { id: string; nummer: string | null; brutto: number | null; netto: number | null };

async function belegLesen(k: string, art: "invoices" | "credit-notes", id: string): Promise<LexBeleg> {
  const b = await anfrage<{ id: string; voucherNumber?: string; totalPrice?: { totalGrossAmount?: number; totalNetAmount?: number } }>(k, "GET", `/v1/${art}/${id}`);
  return { id: b.id, nummer: b.voucherNumber ?? null, brutto: b.totalPrice?.totalGrossAmount ?? null, netto: b.totalPrice?.totalNetAmount ?? null };
}

const steuerArt = (reverseCharge: boolean) => (reverseCharge ? "intraCommunitySupply" : "net");

/** Vorkasse-Rechnung (festgeschrieben) für einen Kontakt. */
export async function rechnungErstellen(tenantId: string, o: { kontaktId: string; positionen: LexPosition[]; reverseCharge: boolean; titel: string; einleitung: string; bemerkung: string; lieferdatum: string }): Promise<LexBeleg> {
  const k = await key(tenantId);
  const r = await anfrage<{ id: string }>(k, "POST", "/v1/invoices?finalize=true", {
    voucherDate: new Date().toISOString(),
    address: { contactId: o.kontaktId },
    lineItems: o.positionen.map((p) => ({ type: "custom", name: p.name.slice(0, 255), description: p.beschreibung, quantity: p.menge, unitName: p.einheit, unitPrice: { currency: "EUR", netAmount: p.netto, taxRatePercentage: o.reverseCharge ? 0 : p.steuersatz } })),
    totalPrice: { currency: "EUR" },
    taxConditions: { taxType: steuerArt(o.reverseCharge) },
    paymentConditions: { paymentTermLabel: "Vorkasse – zahlbar innerhalb von 7 Tagen", paymentTermDuration: 7 },
    shippingConditions: { shippingType: "delivery", shippingDate: `${o.lieferdatum}T00:00:00.000+01:00` },
    title: o.titel,
    introduction: o.einleitung,
    remark: o.bemerkung,
  });
  return belegLesen(k, "invoices", r.id);
}

/** Gutschrift zur Rechnung (z. B. Fehlmenge oder Erstattung), festgeschrieben. */
export async function gutschriftErstellen(tenantId: string, o: { rechnungId: string; kontaktId: string; positionen: LexPosition[]; reverseCharge: boolean; titel: string; bemerkung: string }): Promise<LexBeleg> {
  const k = await key(tenantId);
  const r = await anfrage<{ id: string }>(k, "POST", `/v1/credit-notes?finalize=true&precedingSalesVoucherId=${encodeURIComponent(o.rechnungId)}`, {
    voucherDate: new Date().toISOString(),
    address: { contactId: o.kontaktId },
    lineItems: o.positionen.map((p) => ({ type: "custom", name: p.name.slice(0, 255), description: p.beschreibung, quantity: p.menge, unitName: p.einheit, unitPrice: { currency: "EUR", netAmount: p.netto, taxRatePercentage: o.reverseCharge ? 0 : p.steuersatz } })),
    totalPrice: { currency: "EUR" },
    taxConditions: { taxType: steuerArt(o.reverseCharge) },
    title: o.titel,
    remark: o.bemerkung,
  });
  return belegLesen(k, "credit-notes", r.id);
}

/** Zahlungsstand einer Rechnung: offen, teilweise, bezahlt. */
export async function zahlungsstand(tenantId: string, rechnungId: string): Promise<{ offen: number | null; bezahlt: boolean; status: string | null }> {
  const p = await anfrage<{ openAmount?: number; paymentStatus?: string; voucherStatus?: string }>(await key(tenantId), "GET", `/v1/payments/${encodeURIComponent(rechnungId)}`);
  const offen = typeof p.openAmount === "number" ? p.openAmount : null;
  const bezahlt = p.paymentStatus === "balanced" || p.voucherStatus === "paid" || (offen !== null && offen <= 0.005);
  return { offen, bezahlt, status: p.paymentStatus ?? p.voucherStatus ?? null };
}

/** PDF einer Rechnung bzw. Gutschrift. */
export async function belegPdf(tenantId: string, art: "rechnung" | "gutschrift", id: string): Promise<Buffer> {
  return anfrage<Buffer>(await key(tenantId), "GET", `/v1/${art === "rechnung" ? "invoices" : "credit-notes"}/${encodeURIComponent(id)}/file`, undefined, "application/pdf");
}

registerTester("lexoffice", async (v) => {
  if (!v.apiKey) throw new Error("API-Schlüssel fehlt.");
  const p = await anfrage<{ companyName?: string; organizationId?: string }>(v.apiKey, "GET", "/v1/profile");
  return `Verbunden mit „${p.companyName ?? "?"}“ – muss die Deal-Firma aus Einstellungen → B2B-Deals sein.`;
});

registerTester("discord_b2b", async (v) => {
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(v.webhookUrl ?? "") && !process.env.TESTDIENSTE_URL) throw new Error("Bitte die Webhook-URL aus Discord einfügen (https://discord.com/api/webhooks/…).");
  await postDiscord(v.webhookUrl, "✅ Seller-System ist verbunden – hier erscheinen neue B2B-Deals.");
  return "Testnachricht gesendet – bitte im B2B-Kanal nachsehen.";
});
