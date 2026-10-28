// Testdienste für die Testumgebung und die automatischen Prüfungen: ein kleiner Server, der Claude, Deutsche Post
// (Internetmarke), DHL (Labels + Sendungsverfolgung), Amazon, eBay, Temu, Keepa und die EZB-Kurse nachbildet.
// Nichts geht an echte Dienste. Schreibende Aufrufe (Label kaufen, Versand melden, Preis ändern …) werden nur
// angenommen und mitgeschrieben („simuliert“). Erfundene Antworten.
//
// Start:  node scripts/testdienste.mjs           (Port TESTDIENSTE_PORT, Standard 4010)
// Im Seller-System (TESTUMGEBUNG=1) zeigen die *_BASE_URL-Variablen hierher, z. B.
//   ANTHROPIC_BASE_URL=http://testdienste:4010/anthropic   INTERNETMARKE_BASE_URL=http://testdienste:4010/im
// Übersicht:  GET /__log (alle Aufrufe), GET /__ki (Anfragen an die Test-KI), POST /__reset
import http from "node:http";
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";

const PORT = Number(process.env.TESTDIENSTE_PORT || 4010);
const SELF = (process.env.TESTDIENSTE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
let log = [];
let ki = [];
const remember = (list, entry, max = 500) => {
  list.push(entry);
  if (list.length > max) list.splice(0, list.length - max);
};

const pdf = async (lines) => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (const l of lines) {
    const p = d.addPage([283, 562]);
    p.drawText("TESTLABEL – KEIN PORTO", { x: 20, y: 530, size: 12, font: f });
    p.drawText(l.slice(0, 60), { x: 20, y: 500, size: 10, font: f });
  }
  return Buffer.from(await d.save());
};

// ---------------------------------------------------------------------------------------------------------
// Test-KI (Claude-Messages-API). Befehle im Text der letzten Frage:
//   „werkzeug:NAME {json}“ → ruft genau dieses Werkzeug auf (auch wenn es NICHT angeboten wurde)
//   „prep“ → prep_center (3 Monate) · „palette“ → sendungen · „aufgabe X“ → aufgabe_anlegen · „auftr“ → auftraege
// Denk-Schritte sind an Grundtext + Werkzeugliste gebunden („sig:<hash>“). Passt eine Signatur im Verlauf nicht mehr,
// antwortet die Test-KI wie die echte API mit 400 – außer die Anfrage verlangt block_binding „drop_block“.
let n = 0;
const prefixHash = (b) => createHash("sha256").update(JSON.stringify(b.system ?? "") + JSON.stringify((b.tools ?? []).map((t) => t.name))).digest("hex").slice(0, 16);
const reply = (b, content, stop) => ({ id: `msg_test_${++n}`, type: "message", role: "assistant", model: b.model, content: [{ type: "thinking", thinking: "", signature: `sig:${prefixHash(b)}` }, ...content], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 30 } });
const use = (name, input) => ({ type: "tool_use", id: `toolu_test_${++n}`, name, input });

function kiAnswer(req, b) {
  const msgs = b.messages ?? [];
  const want = `sig:${prefixHash(b)}`;
  const stale = msgs.filter((m) => m.role === "assistant" && Array.isArray(m.content)).flatMap((m) => m.content.filter((p) => p.type === "thinking")).filter((p) => p.signature !== want).length;
  const drop = b.thinking?.block_binding?.prefix_mismatch_behavior === "drop_block";
  const last = msgs[msgs.length - 1] ?? { content: "" };
  const parts = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
  const text = parts.filter((p) => p.type === "text" && !String(p.text).startsWith("<kontext>")).map((p) => p.text).join(" ");
  const results = parts.filter((p) => p.type === "tool_result");
  const resultText = results.map((r) => (typeof r.content === "string" ? r.content : (r.content ?? []).map((x) => x.text).join(""))).join("\n");
  remember(ki, { at: new Date().toISOString(), beta: req.headers["anthropic-beta"] ?? null, thinking: b.thinking ?? null, tools: (b.tools ?? []).map((t) => t.name), prefix: prefixHash(b), staleThinking: stale, dropBlock: drop, text, toolResult: resultText || null, toolError: results.some((r) => r.is_error) });
  if (stale && !drop) {
    const i = msgs.findIndex((m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((p) => p.type === "thinking" && p.signature !== want));
    return [400, { type: "error", error: { type: "invalid_request_error", message: `messages.${i}.content.0: Invalid \`signature\` in \`thinking\` block. The block is bound to a different conversation. Remove the block, or set block_binding.prefix_mismatch_behavior to "drop_block".` } }];
  }
  if (results.length) {
    const prev = msgs[msgs.length - 2];
    const name = prev?.content?.find?.((p) => p.type === "tool_use")?.name;
    const r = results[0];
    const content = typeof r.content === "string" ? r.content : (r.content ?? []).map((x) => x.text).join("");
    if (name === "prep_center" && !r.is_error) {
      const d = JSON.parse(content);
      const v = (d.verlauf ?? []).map((x) => `${x.monat}: ${x.sendungen} Sendungen, ${x.stueck} Stück${x.erwartete_kosten !== undefined ? `, ${x.erwartete_kosten} €` : ""}`).join("; ");
      return [200, reply(b, [{ type: "text", text: `${d.prep_center} im ${d.monat}: ${d.sendungen} Sendungen, ${d.stueck} Stück, erwartete Kosten ${d.erwartete_kosten ?? "–"} €. Verlauf: ${v}. So funktioniert es: ${d.so_funktioniert_es}` }], "end_turn")];
    }
    if (name === "sendungen" && !r.is_error) {
      const d = JSON.parse(content);
      return [200, reply(b, [{ type: "text", text: `Es sind **${d.anzahl} offene Sendungen** im Palettenlager.` }], "end_turn")];
    }
    return [200, reply(b, [{ type: "text", text: `Ergebnis von ${name}: ${r.is_error ? "FEHLER " : ""}${content.slice(0, 300)}` }], "end_turn")];
  }
  const cmd = /werkzeug:([a-z_]+)\s*(\{.*\})?/i.exec(text);
  if (cmd) return [200, reply(b, [{ type: "text", text: `Ich rufe ${cmd[1]} auf.` }, use(cmd[1], cmd[2] ? JSON.parse(cmd[2]) : {})], "tool_use")];
  if (/prep/i.test(text)) return [200, reply(b, [use("prep_center", { monate: 3 })], "tool_use")];
  if (/palette/i.test(text)) return [200, reply(b, [use("sendungen", { nur_offen: true })], "tool_use")];
  const auf = /aufgabe (.+)$/i.exec(text);
  if (auf) return [200, reply(b, [{ type: "text", text: "Ich lege das an:" }, use("aufgabe_anlegen", { titel: auf[1].trim(), faellig: "2026-11-02" })], "tool_use")];
  if (/auftr/i.test(text)) return [200, reply(b, [use("auftraege", {})], "tool_use")];
  return [200, reply(b, [{ type: "text", text: `Hallo aus der Test-KI (${stale ? `${stale} alter Denk-Schritt verworfen` : "kein alter Denk-Schritt"}).` }], "end_turn")];
}

// ---------------------------------------------------------------------------------------------------------
const carts = new Map();
let shopOrder = 900000;
let shipNo = 3400000000;

async function route(req, url, body) {
  const p = url.pathname;
  const json = (o) => [200, o];
  const parsed = () => {
    try {
      return JSON.parse(body || "{}");
    } catch {
      return {};
    }
  };
  // Claude
  if (p.startsWith("/anthropic/")) return p.endsWith("/v1/messages") ? kiAnswer(req, parsed()) : [404, { type: "error", error: { type: "not_found_error", message: "nicht nachgebildet" } }];
  // Deutsche Post INTERNETMARKE
  if (p === "/im/user") return new URLSearchParams(body).get("password") === "falsch" ? [401, { statusCode: "401", title: "Unauthorized", detail: "user account is not valid" }] : json({ access_token: "test-im-token", expires_in: 3000, walletBalance: 100000 });
  if (p === "/im/app/catalog") return json({ pageFormats: [{ id: 1, name: "DIN A4 Normalpapier", isAddressPossible: true, pageLayout: { labelCount: { labelX: 1, labelY: 1 } } }, { id: 26, name: "Testrolle 62 mm", isAddressPossible: true, pageLayout: { labelCount: { labelX: 1, labelY: 1 } } }] });
  if (p === "/im/app/shoppingcart" && req.method === "POST") return json({ shopOrderId: String(++shopOrder) });
  if (p === "/im/app/shoppingcart/pdf") {
    const b = parsed();
    carts.set(b.shopOrderId, (b.positions ?? []).map((x) => x.address?.receiver?.name ?? "?"));
    return json({ link: `${SELF}/im/pdf/${b.shopOrderId}`, shoppingCart: { shopOrderId: b.shopOrderId, voucherList: (b.positions ?? []).map((_, i) => ({ voucherId: `A00TEST${b.shopOrderId}${i}`, trackId: "" })) }, walletBallance: 100000 - (b.total ?? 0), type: "CheckoutShoppingCartAppResponse" });
  }
  if (p.startsWith("/im/pdf/")) return [200, await pdf((carts.get(p.split("/").pop()) ?? []).map((x) => `Warensendung an ${x}`)), "application/pdf"];
  // DHL Paket (Labels)
  if (p.startsWith("/dhl/") && p.endsWith("/orders") && req.method === "POST") {
    const items = [];
    for (const s of parsed().shipments ?? []) items.push({ shipmentNo: String(++shipNo), sstatus: { statusCode: 200 }, label: { b64: (await pdf([`DHL ${s.product} an ${s.consignee?.name1 ?? "?"} ${s.details?.weight?.value ?? "?"} kg`])).toString("base64") } });
    return json({ items });
  }
  // DHL Sendungsverfolgung
  if (p.startsWith("/dhl-track")) {
    const no = url.searchParams.get("trackingNumber") ?? "";
    const st = (statusCode, description, locality) => ({ statusCode, status: statusCode.toUpperCase(), description, timestamp: new Date().toISOString(), location: { address: { addressLocality: locality } } });
    if (/^TEST-ZUGESTELLT|E2EDHL2/.test(no)) return json({ shipments: [{ id: no, service: "parcel-de", status: st("delivered", "Die Sendung wurde zugestellt.", "Musterstadt") }] });
    if (/^TEST-|E2EDHL1/.test(no)) return json({ shipments: [{ id: no, service: "freight", status: st("transit", "Die Sendung ist auf dem Weg zum Empfänger.", "Testhausen"), estimatedTimeOfDelivery: "2026-11-05T10:00:00Z" }] });
    return [404, { title: "No result found", detail: "No shipment with given tracking number found." }];
  }
  // Amazon (Anmeldung + Selling Partner API)
  if (p.startsWith("/amazon-lwa")) return json({ access_token: "test-amazon-token", token_type: "bearer", expires_in: 3600 });
  if (p.startsWith("/amazon/")) {
    if (req.method !== "GET") return json({ payload: {}, status: "ACCEPTED", feedId: `TEST-${Date.now()}` });
    return json({ payload: { Orders: [], NextToken: null }, orders: [], items: [], inventorySummaries: [], pagination: {} });
  }
  // eBay
  if (p.startsWith("/ebay/identity/")) return json({ access_token: "test-ebay-token", expires_in: 7200, token_type: "User Access Token" });
  if (p.startsWith("/ebay/")) return req.method === "GET" ? json({ total: 0, orders: [], inventoryItems: [], offers: [], href: url.href }) : json({ simuliert: true });
  // Temu, Keepa, EZB
  if (p.startsWith("/temu/")) return json({ success: true, result: {} });
  if (p.startsWith("/keepa/product")) return json(keepaProdukte(url));
  if (p.startsWith("/keepa/")) return json({ tokensLeft: keepaTokens, products: [], asinList: [] });
  if (p.startsWith("/ecb")) return [200, `<?xml version="1.0"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube><Cube time="2026-10-28"><Cube currency="USD" rate="1.08"/><Cube currency="GBP" rate="0.85"/><Cube currency="PLN" rate="4.30"/></Cube></Cube></gesmes:Envelope>`, "application/xml"];
  return [404, { title: "Nicht nachgebildet", path: p }];
}

// Keepa-Nachbau: erfundener Verlauf über 365 Tage je ASIN und Land (Amazon zeitweise nicht auf Lager, Buy Box
// wechselt zwischen Amazon, einem FBA- und einem FBM-Händler). ASINs, die mit „B0FEHLT“ beginnen, kennt Keepa nicht.
let keepaTokens = 1200;
const KEEPA_LAND = {
  3: { basis: 1999, verkauft: 50, amazon: "A3JWKAKR8XB7XF" },
  4: { basis: 2149, verkauft: 20, amazon: "A1X6FK5RDHNB96" },
  8: { basis: 2099, verkauft: 0, amazon: "A11IL2PNWYJU7H" },
  9: { basis: 2249, verkauft: 30, amazon: "A1AT7YVPFBWXBL" },
  2: { basis: 1799, verkauft: 100, amazon: "A3P5ROKL5A1OLE" },
};
function keepaProdukte(url) {
  const asins = (url.searchParams.get("asin") ?? "").split(",").filter(Boolean);
  const land = KEEPA_LAND[Number(url.searchParams.get("domain"))] ?? KEEPA_LAND[3];
  keepaTokens -= asins.length * (1 + (url.searchParams.get("buybox") === "1" ? 2 : 0));
  const now = Date.now();
  const km = (ms) => Math.round(ms / 60000) - 21564000;
  const products = asins
    .filter((a) => !a.startsWith("B0FEHLT"))
    .map((asin) => {
      const csv = [];
      const [amazon, rang, angebote, bb, fba, fbm, bbHist] = [[], [], [], [], [], [], []];
      for (let d = 365; d >= 0; d -= 5) {
        const t = km(now - d * 86400000 - 3600000);
        const phase = Math.floor(d / 5) % 6;
        amazon.push(t, phase === 4 ? -1 : land.basis + phase * 50);
        bb.push(t, land.basis - 50 + phase * 40, phase === 5 ? 299 : 0);
        rang.push(t, 2000 + phase * 500);
        angebote.push(t, 10 + phase);
        fba.push(t, 6 + phase);
        fbm.push(t, 4);
        bbHist.push(String(t), phase === 4 ? "A1TESTFBA00001" : phase === 5 ? "A2TESTFBM00002" : land.amazon);
      }
      Object.assign(csv, { 0: amazon, 3: rang, 11: angebote, 18: bb, 34: fba, 35: fbm });
      return {
        asin,
        title: `Testprodukt ${asin} (erfunden)`,
        csv: Array.from({ length: 36 }, (_, i) => csv[i] ?? null),
        availabilityAmazon: 0,
        monthlySold: land.verkauft,
        lastUpdate: km(now - 3600000),
        stats: { outOfStockPercentage30: [17], outOfStockPercentage90: [17], outOfStockPercentageInInterval: [17], buyBoxStats: { [land.amazon]: { percentageWon: 67, isFBA: true }, A1TESTFBA00001: { percentageWon: 17, isFBA: true }, A2TESTFBM00002: { percentageWon: 16, isFBA: false } } },
        buyBoxSellerIdHistory: bbHist,
      };
    });
  return { tokensLeft: keepaTokens, products };
}

const dienstOf = (p) => (p.startsWith("/anthropic") ? "Claude" : p.startsWith("/im") ? "Deutsche Post" : p.startsWith("/dhl-track") ? "DHL Verfolgung" : p.startsWith("/dhl") ? "DHL Paket" : p.startsWith("/amazon") ? "Amazon" : p.startsWith("/ebay") ? "eBay" : p.startsWith("/temu") ? "Temu" : p.startsWith("/keepa") ? "Keepa" : p.startsWith("/ecb") ? "EZB" : "?");

http
  .createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const url = new URL(req.url, "http://x");
    const send = (code, data, type = "application/json") => {
      res.writeHead(code, { "Content-Type": type, "request-id": "req_test" });
      res.end(Buffer.isBuffer(data) || typeof data === "string" ? data : JSON.stringify(data));
    };
    if (url.pathname === "/__log") return send(200, log);
    if (url.pathname === "/__ki") return send(200, ki);
    if (url.pathname === "/__reset" && req.method === "POST") {
      log = [];
      ki = [];
      return send(200, { ok: true });
    }
    if (url.pathname === "/__gesund") return send(200, { ok: true });
    try {
      const [code, data, type] = await route(req, url, body);
      const write = req.method !== "GET" && !url.pathname.startsWith("/anthropic") && !/token|\/user$|identity|lwa/.test(url.pathname);
      remember(log, { at: new Date().toISOString(), dienst: dienstOf(url.pathname), method: req.method, path: url.pathname, status: code, simuliert: write });
      send(code, data, type);
    } catch (e) {
      remember(log, { at: new Date().toISOString(), dienst: dienstOf(url.pathname), method: req.method, path: url.pathname, status: 500, simuliert: false });
      send(500, { title: "Testdienst-Fehler", detail: String(e?.message ?? e) });
    }
  })
  .listen(PORT, () => console.log(`Testdienste bereit auf Port ${PORT}`));
