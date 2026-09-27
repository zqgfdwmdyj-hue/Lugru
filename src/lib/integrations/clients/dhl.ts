import "server-only";
import type { Address } from "@/db/schema";
import { toIso3 } from "@/lib/shipping/countries";
import { registerTester } from "../test";

// DHL Parcel DE Shipping API v2 (Geschäftskunden).
// Doku: developer.dhl.com → Parcel DE Shipping (Post & Parcel Germany)

export type DhlCreds = { apiKey: string; username: string; password: string };

const base = (sandbox: boolean) =>
  sandbox ? "https://api-sandbox.dhl.com/parcel/de/shipping/v2" : "https://api-eu.dhl.com/parcel/de/shipping/v2";

function headers(c: DhlCreds) {
  return {
    "dhl-api-key": c.apiKey,
    Authorization: `Basic ${Buffer.from(`${c.username}:${c.password}`).toString("base64")}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Language": "de-DE",
  };
}

function consignee(a: Address) {
  const street = a.street ?? "";
  const packstation = /packstation/i.exec(street);
  const postfiliale = /postfiliale/i.exec(street);
  if (packstation || postfiliale) {
    const locker = Number((street.match(/\d+/) ?? [a.houseNo ?? ""])[0]);
    return {
      name: a.name1,
      ...(packstation ? { lockerID: locker } : { retailID: locker }),
      postNumber: a.name2?.replace(/\D/g, "") || undefined,
      postalCode: a.zip,
      city: a.city,
      country: toIso3(a.country),
    };
  }
  return {
    name1: a.name1,
    name2: a.name2 || undefined,
    addressStreet: street,
    addressHouse: a.houseNo || undefined,
    postalCode: a.zip,
    city: a.city,
    country: toIso3(a.country),
    email: a.email || undefined,
    phone: a.phone || undefined,
  };
}

export type DhlLabelResult = { shipmentNo: string; labelPdf: Buffer; warnings: string[] };

export async function createDhlLabel(opts: {
  creds: DhlCreds;
  sandbox: boolean;
  product: string;
  billingNumber: string;
  shipper: Address;
  to: Address;
  weightKg: number;
  refNo?: string;
  printFormat?: string;
}): Promise<DhlLabelResult> {
  const url = new URL(`${base(opts.sandbox)}/orders`);
  url.searchParams.set("validate", "false");
  url.searchParams.set("docFormat", "PDF");
  url.searchParams.set("includeDocs", "include");
  url.searchParams.set("combine", "true");
  if (opts.printFormat) url.searchParams.set("printFormat", opts.printFormat);
  const body = {
    profile: "STANDARD_GRUPPENPROFIL",
    shipments: [
      {
        product: opts.product,
        billingNumber: opts.billingNumber,
        refNo: opts.refNo ? opts.refNo.slice(0, 35).padEnd(8, " ") : undefined,
        shipper: {
          name1: opts.shipper.name1,
          name2: opts.shipper.name2 || undefined,
          addressStreet: opts.shipper.street,
          addressHouse: opts.shipper.houseNo,
          postalCode: opts.shipper.zip,
          city: opts.shipper.city,
          country: toIso3(opts.shipper.country),
          email: opts.shipper.email || undefined,
          phone: opts.shipper.phone || undefined,
        },
        consignee: consignee(opts.to),
        details: { weight: { uom: "kg", value: Math.max(0.01, Math.round(opts.weightKg * 1000) / 1000) } },
      },
    ],
  };
  const res = await fetch(url, { method: "POST", headers: headers(opts.creds), body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as {
    status?: { title?: string; detail?: string };
    items?: { shipmentNo?: string; sstatus?: { title?: string; detail?: string; statusCode?: number }; label?: { b64?: string }; validationMessages?: { validationMessage?: string; property?: string }[] }[];
    detail?: string;
    title?: string;
  } | null;
  const item = json?.items?.[0];
  const messages = (item?.validationMessages ?? []).map((m) => `${m.property ? `${m.property}: ` : ""}${m.validationMessage ?? ""}`);
  if (!res.ok || !item?.shipmentNo || !item.label?.b64) {
    const reason = [item?.sstatus?.title, item?.sstatus?.detail, ...messages, json?.status?.detail, json?.detail, json?.title].filter(Boolean).join(" · ");
    throw new Error(`DHL hat das Label abgelehnt (${res.status}): ${reason || "unbekannter Fehler"}`);
  }
  return { shipmentNo: item.shipmentNo, labelPdf: Buffer.from(item.label.b64, "base64"), warnings: messages };
}

export async function cancelDhlLabel(creds: DhlCreds, sandbox: boolean, shipmentNo: string) {
  const url = new URL(`${base(sandbox)}/orders`);
  url.searchParams.set("shipment", shipmentNo);
  const res = await fetch(url, { method: "DELETE", headers: headers(creds) });
  if (!res.ok) throw new Error(`DHL-Storno fehlgeschlagen (${res.status})`);
}

registerTester("dhl", async (v) => {
  // Eine Prüf-Anfrage ohne Sendungen: 401/403 = Zugang falsch, 400 = Zugang ok (nur Daten fehlen).
  const results: string[] = [];
  for (const sandbox of [false, true]) {
    const url = new URL(`${base(sandbox)}/orders`);
    url.searchParams.set("validate", "true");
    const res = await fetch(url, { method: "POST", headers: headers({ apiKey: v.apiKey, username: v.username ?? "", password: v.password ?? "" }), body: JSON.stringify({ profile: "STANDARD_GRUPPENPROFIL", shipments: [] }) });
    const env = sandbox ? "Sandbox" : "Produktion";
    if (res.status === 401 || res.status === 403) {
      const j = (await res.json().catch(() => ({}))) as { detail?: string; title?: string };
      results.push(`${env}: abgelehnt (${j.detail ?? j.title ?? res.status})`);
      continue;
    }
    return `Zugang von DHL akzeptiert (${env}). Die Abrechnungsnummer wird beim ersten Label geprüft.`;
  }
  throw new Error(`DHL lehnt den Zugang ab – API-Key, Benutzer oder Passwort prüfen. ${results.join(" · ")}`);
});
