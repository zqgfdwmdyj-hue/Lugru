import "server-only";
import { createHash } from "node:crypto";
import type { Address } from "@/db/schema";
import { registerTester } from "../test";
import { imCheckoutBody, imError, type ImLabel } from "@/lib/shipping/internetmarke";

// Deutsche Post INTERNETMARKE (REST v1): Porto mit Anschrift als PDF kaufen – z. B. Warensendung.
// Doku: developer.dhl.com → „Deutsche Post INTERNETMARKE (Post & Parcel Germany)“. Bezahlt wird aus der
// Portokasse; die Anmeldung braucht App-Zugang (Client-ID/Secret) und Portokasse-Benutzer zusammen.

export type ImCreds = { clientId: string; clientSecret: string; username: string; password: string };
export type ImPageFormat = { id: number; name: string; description: string; isAddressPossible: boolean; labelX: number; labelY: number };

// INTERNETMARKE_BASE_URL nur für Tests (nachgebildete Schnittstelle).
const BASE = process.env.INTERNETMARKE_BASE_URL || "https://api-eu.dhl.com/post/de/shipping/im/v1";

const tokens = new Map<string, { token: string; until: number; wallet: number }>();
const credKey = (c: ImCreds) => createHash("sha256").update(`${c.clientId}\n${c.username}\n${c.password}\n${c.clientSecret}`).digest("hex");

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

/** Anmelden (Client-ID/Secret + Portokasse in einem Aufruf) – Token wird bis kurz vor Ablauf wiederverwendet. */
export async function imLogin(c: ImCreds, fresh = false): Promise<{ token: string; wallet: number }> {
  const key = credKey(c);
  const hit = tokens.get(key);
  if (!fresh && hit && hit.until > Date.now()) return hit;
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret, username: c.username, password: c.password });
  const res = await fetch(`${BASE}/user`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body });
  const json = (await readJson(res)) as { access_token?: string; expires_in?: number; walletBalance?: number } | null;
  if (!res.ok || !json?.access_token) {
    const why = imError(res.status, json);
    throw new Error(res.status === 401 ? `Deutsche Post lehnt die Anmeldung ab – Client-ID/Secret oder Portokasse-Zugang prüfen; in der Portokasse unter „Meine Daten → Geschäftsanwendungen“ die Anwendung freigeben. (${why})` : `Deutsche Post: Anmeldung fehlgeschlagen (${why})`);
  }
  const entry = { token: json.access_token, until: Date.now() + Math.max(60, (json.expires_in ?? 3000) - 120) * 1000, wallet: json.walletBalance ?? 0 };
  tokens.set(key, entry);
  return entry;
}

async function call<T>(c: ImCreds, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const send = async (token: string) =>
    fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  let res = await send((await imLogin(c)).token);
  // Token abgelaufen o. Ä.: einmal neu anmelden.
  if (res.status === 401) res = await send((await imLogin(c, true)).token);
  const json = await readJson(res);
  if (!res.ok) throw new Error(`Deutsche Post (${path.split("?")[0]}): ${imError(res.status, json)}`);
  return json as T;
}

/** Seitenformate (Etikettenbogen, Rolle, Normalpapier …) – nur solche mit Anschrift sind für Warensendungen nutzbar. */
export async function imPageFormats(c: ImCreds): Promise<ImPageFormat[]> {
  const r = await call<{ pageFormats?: { id: number; name?: string; description?: string; isAddressPossible?: boolean; pageLayout?: { labelCount?: { labelX?: number; labelY?: number } } }[] }>(c, "GET", "/app/catalog?types=PAGE_FORMATS");
  return (r.pageFormats ?? []).map((p) => ({
    id: p.id,
    name: p.name ?? `Format ${p.id}`,
    description: p.description ?? "",
    isAddressPossible: Boolean(p.isAddressPossible),
    labelX: Math.max(1, p.pageLayout?.labelCount?.labelX ?? 1),
    labelY: Math.max(1, p.pageLayout?.labelCount?.labelY ?? 1),
  }));
}

export type ImOrderResult = { shopOrderId: string; vouchers: { voucherId: string; trackId: string | null }[]; pdf: Buffer; walletCents: number | null };

/**
 * Porto mit Anschrift kaufen (ein Warenkorb, ein PDF für alle Sendungen). `priceCents` je Sendung – die Summe
 * muss dem aktuellen Preis der Post entsprechen, sonst lehnt sie ab und es wird nichts berechnet.
 */
export async function imBuyLabels(c: ImCreds, opts: { sender: Address; labels: ImLabel[]; productCode: number; priceCents: number; pageFormat: Pick<ImPageFormat, "id" | "labelX" | "labelY"> }): Promise<ImOrderResult> {
  if (!opts.labels.length) throw new Error("Keine Sendungen.");
  const cart = await call<{ shopOrderId?: string }>(c, "POST", "/app/shoppingcart");
  if (!cart?.shopOrderId) throw new Error("Deutsche Post: Warenkorb konnte nicht angelegt werden.");
  const body = imCheckoutBody({ ...opts, shopOrderId: cart.shopOrderId });
  const r = await call<{ link?: string; shoppingCart?: { shopOrderId?: string; voucherList?: { voucherId?: string; trackId?: string }[] }; walletBallance?: number; walletBalance?: number }>(c, "POST", "/app/shoppingcart/pdf?directCheckout=true", body);
  if (!r?.link) throw new Error(`Deutsche Post: gekauft (Bestellung ${cart.shopOrderId}), aber kein PDF-Link erhalten – in der Portokasse unter „Bestellungen“ nachdrucken.`);
  const pdfRes = await fetch(r.link);
  if (!pdfRes.ok) throw new Error(`Deutsche Post: gekauft (Bestellung ${cart.shopOrderId}), PDF-Abruf fehlgeschlagen (${pdfRes.status}) – in der Portokasse unter „Bestellungen“ nachdrucken.`);
  return {
    shopOrderId: r.shoppingCart?.shopOrderId ?? cart.shopOrderId,
    vouchers: (r.shoppingCart?.voucherList ?? []).map((v) => ({ voucherId: v.voucherId ?? "", trackId: v.trackId || null })),
    pdf: Buffer.from(await pdfRes.arrayBuffer()),
    walletCents: r.walletBallance ?? r.walletBalance ?? null,
  };
}

export function imCreds(v: Record<string, string | undefined> | null): ImCreds | null {
  if (!v?.clientId || !v.clientSecret || !v.username || !v.password) return null;
  return { clientId: v.clientId, clientSecret: v.clientSecret, username: v.username, password: v.password };
}

registerTester("deutschepost", async (v) => {
  const c = imCreds(v);
  if (!c) throw new Error("Client-ID, Client-Secret, Portokasse-E-Mail und Passwort angeben.");
  const { wallet } = await imLogin(c, true);
  return `Verbunden. Guthaben in der Portokasse: ${(wallet / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}.`;
});
