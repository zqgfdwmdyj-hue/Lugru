// Testdaten für die Testumgebung und die automatischen Prüfungen: setzt eine TEST-Datenbank komplett zurück und füllt
// sie mit einer erfundenen Firma, Konten je Rolle und Daten für alle geprüften Abläufe. Keine echten Daten.
//
//   DATABASE_URL=postgres://…/seller_test APP_SECRET=… TESTDATEN_PASSWORT=… npx tsx --conditions=react-server scripts/testdaten.ts
//
// Sicherung gegen Versehen: läuft nur, wenn der Name der Datenbank „test“ oder „e2e“ enthält.
// Ohne TESTDATEN_PASSWORT wird ein zufälliges Passwort erzeugt und am Ende ausgegeben (gilt für alle Testkonten).
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { encryptSecret } from "../src/lib/crypto";

const url = process.env.DATABASE_URL ?? "";
let dbName = "";
try {
  dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
} catch {
  /* unten abgebrochen */
}
if (!/(test|e2e)/i.test(dbName)) {
  console.error(`ABBRUCH: Testdaten nur in einer Test-Datenbank (Name mit „test“ oder „e2e“), nicht in „${dbName || "?"}“.`);
  process.exit(1);
}
if (!process.env.APP_SECRET || process.env.APP_SECRET.length < 32) {
  console.error("ABBRUCH: APP_SECRET (mind. 32 Zeichen) fehlt – die Testumgebung braucht einen eigenen.");
  process.exit(1);
}
const PASSWORT = process.env.TESTDATEN_PASSWORT || randomBytes(12).toString("base64url");

// 1) Zurücksetzen: alles weg, Tabellen neu anlegen (Datenbank anlegen, falls es sie noch nicht gibt)
{
  const probe = new Pool({ connectionString: url });
  try {
    await probe.query("select 1");
  } catch (e) {
    if ((e as { code?: string }).code !== "3D000") throw e;
    const admin = new URL(url);
    admin.pathname = "/postgres";
    const a = new Pool({ connectionString: admin.href });
    await a.query(`CREATE DATABASE "${dbName.replace(/"/g, "")}"`);
    await a.end();
    console.log(`Datenbank „${dbName}“ angelegt.`);
  }
  await probe.end().catch(() => undefined);
}
const pool = new Pool({ connectionString: url });
await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
const db = drizzle(pool, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

// Datumshilfen relativ zu heute (Berliner Zeit), damit die Daten nicht veralten
const berlin = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const day = (offset: number) => berlin(new Date(Date.now() + offset * 86400_000));
const at = (offset: number, hour = 10) => new Date(`${day(offset)}T${String(hour).padStart(2, "0")}:00:00+01:00`);
const thisMonth = day(0).slice(0, 7);
const prevMonth = (() => {
  const [y, m] = thisMonth.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
})();

// 2) Firma und Einstellungen
const [tenant] = await db
  .insert(schema.tenants)
  .values({
    name: "Testfirma GmbH",
    settings: {
      vatRate: 0.19,
      importReminderDays: 7,
      shipper: { name1: "Testfirma GmbH", street: "Teststraße", houseNo: "1", zip: "12345", city: "Musterstadt", country: "DEU", email: "versand@example.invalid" },
      dhl: { sandbox: false, billingNumberPaket: "33333333330101" },
      prep: { name: "Test-Prep-Center", defaultShipper: "self", feeShipment: 2.5, feeExtraItem: 0.5 },
      pallets: { shipmentMail: true },
      assistant: { enabled: true, allowWrite: true, model: "claude-opus-5-5" },
    } as never,
  })
  .returning();
const T = tenant.id;

// 3) Konten je Rolle (alle mit demselben Testpasswort)
const hash = await bcrypt.hash(PASSWORT, 10);
const KONTEN = [
  { login: "inhaber", name: "Ina Inhaber", role: "owner" as const, areas: null, readOnly: false, privateAccess: true, privateScope: "voll" as const },
  { login: "lager", name: "Lars Lager", role: "staff" as const, areas: ["paletten"], readOnly: false, privateAccess: false, privateScope: "voll" as const },
  { login: "buero", name: "Bea Büro", role: "staff" as const, areas: ["start", "posteingang", "kalender", "wawi", "buchhaltung"], readOnly: false, privateAccess: false, privateScope: "voll" as const },
  { login: "pruefer", name: "Paul Prüfer", role: "staff" as const, areas: ["paletten", "wawi"], readOnly: true, privateAccess: false, privateScope: "voll" as const },
  { login: "familie", name: "Fiona Familie", role: "staff" as const, areas: [], readOnly: false, privateAccess: true, privateScope: "familie" as const },
];
const users: Record<string, string> = {};
for (const k of KONTEN) {
  const [u] = await db.insert(schema.users).values({ email: k.login, name: k.name, passwordHash: hash }).returning();
  users[k.login] = u.id;
  await db.insert(schema.memberships).values({ tenantId: T, userId: u.id, role: k.role, areas: k.areas, readOnly: k.readOnly, privateAccess: k.privateAccess, privateScope: k.privateScope });
}

// 4) Anbindungen mit Fantasie-Zugängen – zeigen in der Testumgebung auf die Testdienste
const integ = async (provider: string, config: Record<string, string>, secrets: Record<string, string>) =>
  db.insert(schema.integrations).values({ tenantId: T, provider, label: "Test", config, secretEncrypted: encryptSecret(JSON.stringify(secrets)) });
await integ("anthropic", {}, { apiKey: "test-ki-schluessel" });
await integ("deutschepost", { clientId: "test-client", username: "portokasse@example.invalid" }, { clientSecret: "test-secret", password: "test-passwort" });
await integ("dhl", { username: "test-dhl" }, { apiKey: "test-dhl-key", password: "test-passwort" });
await integ("dhl_tracking", {}, { apiKey: "test-track-key" });
await integ("keepa", {}, { apiKey: "test-keepa-schluessel" });
await integ("amazon_sp", { clientId: "amzn.test", sellerId: "TESTSELLER", marketplaceIds: "A1PA6795UKMFR9,A13V1IB3VIYZZH" }, { clientSecret: "test-secret", refreshToken: "test-refresh" });

// 5) Artikel: Gewicht, Warensendung, wer verschickt
await db.insert(schema.skuWeights).values([
  { tenantId: T, sku: "TEST-SOCKEN", grams: 300, wsMax: 2 },
  { tenantId: T, sku: "TEST-TASSE", grams: 450, wsMax: 0 },
  { tenantId: T, sku: "TEST-KABEL" },
  { tenantId: T, sku: "TEST-PREP-ARTIKEL", grams: 200, wsMax: 1, shipFrom: "prep" },
]);
const [socken, tasse] = await db
  .insert(schema.products)
  .values([
    { tenantId: T, asin: "B0TEST0001", title: "Testsocken (erfunden)", ean: "4000000000017" },
    { tenantId: T, asin: "B0TEST0002", title: "Testtasse (erfunden)", ean: "4000000000024" },
  ])
  .returning();
// Chargen (Einkauf) – über sie findet der Scanner FNSKU, SKU und EAN
await db.insert(schema.lots).values([
  { tenantId: T, productId: socken.id, sku: "TEST-SOCKEN", kind: "purchase" as const, skuSchema: "test", fnsku: "X00TEST0001", purchaseDate: day(-30), quantity: 30, unitCostNet: "2.10" },
  { tenantId: T, productId: tasse.id, sku: "TEST-TASSE", kind: "purchase" as const, skuSchema: "test", fnsku: "X00TEST0002", purchaseDate: day(-30), quantity: 10, unitCostNet: "3.40" },
]);
await db.insert(schema.ownStock).values([
  { tenantId: T, sku: "TEST-TASSE", quantity: 5, location: "Regal A" },
  { tenantId: T, sku: "TEST-SOCKEN", quantity: 20, location: "Regal B" },
]);

// 6) Aufträge: offen (Händlerversand) + vom Prep Center verschickt (diesen und letzten Monat)
const addr = (name: string, i: number) => ({ name1: name, street: "Musterweg", houseNo: String(i), zip: `1234${i}`, city: "Musterstadt", country: "DEU" });
const order = async (o: { ext: string; channel: "amazon" | "ebay"; status?: "open" | "shipped"; items: [string, string, number][]; name: string; date: Date; shippedAt?: Date; shippedBy?: "self" | "prep" }, i: number) => {
  const [row] = await db
    .insert(schema.orders)
    .values({ tenantId: T, channel: o.channel, externalId: o.ext, orderDate: o.date, fulfillment: "FBM", status: o.status ?? "open", buyerName: o.name, shipTo: addr(o.name, i), total: 19.9, shipBy: at(2), shippedAt: o.shippedAt, shippedBy: o.shippedBy, carrier: o.shippedAt ? "DHL" : null })
    .returning();
  // Positions-IDs wie bei per Schnittstelle geladenen Aufträgen (Amazon braucht sie für die Versandmeldung)
  await db.insert(schema.orderItems).values(o.items.map(([sku, title, quantity], n) => ({ tenantId: T, orderId: row.id, externalItemId: `${o.ext}-POS${n + 1}`, sku, title, quantity, price: 9.95 })));
};
const OFFEN: Parameters<typeof order>[0][] = [
  { ext: "TEST-AMZ-1001", channel: "amazon", items: [["TEST-SOCKEN", "Testsocken", 1]], name: "Erika Mustermann", date: at(-1) },
  { ext: "TEST-AMZ-1002", channel: "amazon", items: [["TEST-TASSE", "Testtasse", 1]], name: "Max Mustermann", date: at(-1) },
  { ext: "TEST-AMZ-1003", channel: "amazon", items: [["TEST-KABEL", "Testkabel", 2]], name: "Erika Beispiel", date: at(-2) },
  { ext: "TEST-EBAY-2001", channel: "ebay", items: [["TEST-SOCKEN", "Testsocken", 2]], name: "Hans Beispiel", date: at(-1) },
  { ext: "TEST-EBAY-2002", channel: "ebay", items: [["TEST-PREP-ARTIKEL", "Prep-Testartikel", 1]], name: "Grete Muster", date: at(-1) },
];
for (const [i, o] of OFFEN.entries()) await order(o, i + 1);
const PREP: Parameters<typeof order>[0][] = [
  { ext: "TEST-PREP-1", channel: "ebay", status: "shipped", items: [["TEST-PREP-ARTIKEL", "Prep-Testartikel", 1]], name: "Prep Kunde Eins", date: new Date(`${thisMonth}-01T09:00:00Z`), shippedAt: new Date(`${thisMonth}-01T10:00:00Z`), shippedBy: "prep" },
  { ext: "TEST-PREP-2", channel: "ebay", status: "shipped", items: [["TEST-PREP-ARTIKEL", "Prep-Testartikel", 3]], name: "Prep Kunde Zwei", date: new Date(`${thisMonth}-01T11:00:00Z`), shippedAt: new Date(`${thisMonth}-01T12:00:00Z`), shippedBy: "prep" },
  { ext: "TEST-PREP-3", channel: "ebay", status: "shipped", items: [["TEST-PREP-ARTIKEL", "Prep-Testartikel", 2]], name: "Prep Kunde Drei", date: new Date(`${prevMonth}-15T09:00:00Z`), shippedAt: new Date(`${prevMonth}-15T10:00:00Z`), shippedBy: "prep" },
];
for (const [i, o] of PREP.entries()) await order(o, i + 6);

// 7) Palettenlager: Kunde, Paletten, Sendungen
await db.insert(schema.palletCustomers).values({ tenantId: T, name: "Kunde Muster GmbH", email: "kunde@example.invalid", pricePerMonth: 12, freeDays: 0 });
await db.insert(schema.pallets).values(["TP-001", "TP-002", "TP-003"].map((code) => ({ tenantId: T, code, customer: "Kunde Muster GmbH", location: "Halle 1", inAt: day(-14) })));
await db.insert(schema.palletShipments).values([
  { tenantId: T, direction: "ein", customer: "Kunde Muster GmbH", title: "Testanlieferung 2 Paletten Testware", carrier: "dachser", trackingNo: "TEST4711", trackingUrl: "https://spedition.example.invalid/track?id=TEST4711", palletCount: 2, plannedDate: day(2), firstDate: day(2), status: "geplant", createdBy: users.inhaber },
  { tenantId: T, direction: "aus", customer: "Kunde Muster GmbH", title: "Testversand DHL 1 Palette", carrier: "dhl", trackingNo: "TEST-123456", palletCount: 1, plannedDate: day(1), firstDate: day(1), status: "unterwegs", createdBy: users.inhaber },
]);

// 8) FBA-Sendung (Scanner) und Inventur
const [inb] = await db.insert(schema.inboundShipments).values({ tenantId: T, name: "Test-FBA-Sendung 1", status: "draft", createdBy: users.inhaber }).returning();
await db.insert(schema.inboundBoxes).values([{ tenantId: T, shipmentId: inb.id, number: 1 }, { tenantId: T, shipmentId: inb.id, number: 2 }]);
await db.insert(schema.inboundItems).values({ tenantId: T, shipmentId: inb.id, productId: socken.id, sku: "TEST-SOCKEN", fnsku: "X00TEST0001", asin: "B0TEST0001", title: "Testsocken (erfunden)", plannedQuantity: 10 });
const [count] = await db.insert(schema.inventoryCounts).values({ tenantId: T, name: "Testinventur Regal A", status: "open", createdBy: users.inhaber }).returning();
await db.insert(schema.inventoryCountLines).values({ tenantId: T, countId: count.id, sku: "TEST-TASSE", expected: 5 });

// 9) Uhren: ein Übungs-Deal (verworfen) und zwei echte
await db.insert(schema.watchDeals).values([
  { tenantId: T, practice: true, maker: "Übungsmarke", model: "Lernmodell", status: "verworfen", rejectReason: "Übung", askPrice: 999, createdBy: users.inhaber },
  { tenantId: T, practice: false, maker: "Testmarke", model: "Taucher Echt", reference: "TT 100", status: "verkauft", taxMode: "differenz", buyPrice: 2800, buyDate: day(-40), costs: [{ label: "Revision", amount: 200 }], sellPrice: 3500, sellDate: day(-10), channel: "Chrono24", feePct: 6.5, createdBy: users.inhaber },
  { tenantId: T, practice: false, maker: "Testmarke", model: "Flieger Echt", reference: "TF 200", status: "gekauft", taxMode: "differenz", buyPrice: 1500, buyDate: day(-5), createdBy: users.inhaber },
  { tenantId: T, practice: false, maker: "Testmarke", model: "Abgelehnt Echt", status: "verworfen", rejectReason: "zu teuer", askPrice: 4200, createdBy: users.inhaber },
]);

// 10) Aufgaben
await db.insert(schema.tasks).values([
  { tenantId: T, title: "Testaufgabe: Lieferantenrechnung prüfen", category: "eigene", dueDate: day(1) },
  { tenantId: T, title: "Testaufgabe: Paletten zählen", category: "eigene", dueDate: day(3) },
]);

// 10b) Posteingang und Erstattungsanspruch (für Antwort-Entwurf und „als eingereicht markieren“)
await db.insert(schema.emails).values([
  { tenantId: T, messageKey: "<testanfrage-1@example.invalid>", fromAddress: "lieferant@example.invalid", fromName: "Test Lieferant", subject: "Testanfrage: Lieferzeit Testsocken", receivedAt: new Date(Date.now() - 86400_000), snippet: "Wann können Sie die nächste Bestellung abnehmen?", bodyText: "Guten Tag,\n\nwann können Sie die nächste Bestellung Testsocken abnehmen? Wir hätten 200 Stück ab KW 46.\n\nGrüße\nTest Lieferant (erfunden)", category: "action" as const },
  { tenantId: T, messageKey: "<testnewsletter-1@example.invalid>", fromAddress: "news@example.invalid", fromName: "Test Newsletter", subject: "Testnewsletter Oktober", receivedAt: new Date(Date.now() - 2 * 86400_000), snippet: "Neuigkeiten (erfunden)", bodyText: "Neuigkeiten (erfunden).", category: "noise" as const },
]);
await db.insert(schema.claims).values({ tenantId: T, type: "lost_warehouse" as const, status: "detected" as const, detectionKey: "test-verloren-1", title: "Testanspruch: 3 Testsocken im Lager verloren (erfunden)", sku: "TEST-SOCKEN", fnsku: "X00TEST0001", asin: "B0TEST0001", quantity: 3, unitCost: 2.1, expectedAmount: 29.97, eventDate: day(-20), deadline: day(5) });

// 11) Privatbereich (nur Inhaberin voll, „Fiona Familie“ nur Familieninfos). Das Wort PRIVATGEHEIM darf nirgends
// außerhalb des Privatbereichs auftauchen – die Prüfungen suchen danach (Suche, Kalender, Fragefeld, Claude ohne Freigabe).
await db.insert(schema.privateEntries).values([
  { tenantId: T, userId: users.inhaber, kind: "einstellungen", data: { partners: { a: "Ina", b: "Tom" }, kids: ["Kind A", "Kind B"], userPartner: { [users.inhaber]: "a" } } },
  { tenantId: T, userId: users.inhaber, kind: "termin", data: { day: day(2), time: "17:00", with: "paar", title: "PRIVATGEHEIM Termin", person: "beide", status: "geplant" } },
  { tenantId: T, userId: users.inhaber, kind: "paarzeit", data: { day: day(4), from: "19:00", to: "22:00", what: "PRIVATGEHEIM Date", status: "geplant" } },
  { tenantId: T, userId: users.inhaber, kind: "kinder", data: { day: day(1), person: "b", from: "15:00", to: "17:00", what: "Familienausflug Spielplatz", status: "geplant" } },
]);

await pool.end();
console.log(`Testdaten angelegt in „${dbName}“: Firma „Testfirma GmbH“, Konten: ${KONTEN.map((k) => `${k.login} (${k.role === "owner" ? "Inhaber" : k.readOnly ? "nur ansehen" : (k.areas ?? []).join("+") || "nur Privat"})`).join(", ")}.`);
if (!process.env.TESTDATEN_PASSWORT) console.log(`Passwort für alle Testkonten: ${PASSWORT}`);
