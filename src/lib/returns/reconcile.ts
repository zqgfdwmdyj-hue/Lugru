// Retouren-Abgleich – übernommen aus dem bisherigen Retouren-Tool (analysis.py).
// Reine Logik ohne Datenbank: Erstattungen an Kunden werden mit eingegangenen Rücksendungen
// und Zahlungen von Amazon abgeglichen. Was nicht aufgeht, wird ein Anspruch.

import { daysBetween } from "@/lib/dates";

export type Mode = "fba" | "fbm";

export type TxRow = {
  orderId: string;
  sku: string | null;
  date: string | null;
  kind: "sale" | "refund" | "reimb" | "safet";
  quantity: number;
  productSales: number;
  shippingCredits: number;
  total: number;
  channel: "fba" | "fbm" | "";
  description: string | null;
};

export type FbaReturnRow = {
  orderId: string;
  sku: string | null;
  date: string | null;
  quantity: number;
  disposition: string | null;
  reason: string | null;
  title: string | null;
};

export type PaymentRow = {
  orderId: string;
  sku: string | null;
  amount: number;
  /** null = Menge unbekannt (Transaktionsbericht ohne Menge). */
  quantity: number | null;
  date: string | null;
  reason: string | null;
  source: "Erstattungsbericht" | "Transaktionsbericht";
};

export type FbmReturnRow = {
  orderId: string;
  sku: string | null;
  title: string | null;
  requestDate: string | null;
  tracking: string | null;
  deliveryDate: string | null;
  refundedAmount: number;
  quantity: number;
  reason: string | null;
  safetClaimId: string | null;
};

export type ReturnSettings = { graceFba: number; claimFba: number; graceFbm: number };

export const RETURN_STATUS = {
  notReimb: { label: "Nicht zurück, Amazon hat nicht gezahlt", tone: "critical", rank: 0 },
  partReimb: { label: "Nicht zurück, nur teilweise gezahlt", tone: "critical", rank: 1 },
  amazonDamaged: { label: "Von Amazon oder Transport beschädigt", tone: "critical", rank: 1 },
  missing: { label: "Nicht zurückgeschickt", tone: "critical", rank: 0 },
  nodoc: { label: "Erstattet, kein Versandnachweis", tone: "critical", rank: 1 },
  unknown: { label: "Nicht zurück, Zahlung ungeprüft", tone: "warn", rank: 2 },
  waitAmazon: { label: "Nicht zurück, Amazon-Zahlung ausstehend", tone: "warn", rank: 3 },
  wrongItem: { label: "Anderer Artikel zurückgeschickt", tone: "warn", rank: 3 },
  damaged: { label: "Vom Kunden beschädigt zurück", tone: "warn", rank: 4 },
  toRefund: { label: "Eingegangen, noch nicht erstattet", tone: "info", rank: 4 },
  pending: { label: "Frist läuft", tone: "neutral", rank: 5 },
  transit: { label: "Unterwegs", tone: "neutral", rank: 5 },
  open: { label: "Rücksendung angefragt", tone: "neutral", rank: 6 },
  reimbursed: { label: "Von Amazon bezahlt", tone: "ok", rank: 7 },
  expired: { label: "Nicht zurück, nicht erstattet", tone: "ok", rank: 8 },
  ok: { label: "Zurück erhalten", tone: "ok", rank: 9 },
} as const;
export type ReturnStatus = keyof typeof RETURN_STATUS;

export const REASON_LABEL: Record<string, string> = {
  NOT_AS_DESCRIBED: "Nicht wie beschrieben",
  DEFECTIVE: "Defekt",
  QUALITY_UNACCEPTABLE: "Qualität",
  APPAREL_TOO_SMALL: "Zu klein",
  APPAREL_TOO_LARGE: "Zu groß",
  APPAREL_STYLE: "Stil gefällt nicht",
  UNWANTED_ITEM: "Nicht mehr benötigt",
  ORDERED_WRONG_ITEM: "Falsch bestellt",
  FOUND_BETTER_PRICE: "Besserer Preis",
  MISSED_ESTIMATED_DELIVERY: "Zu spät geliefert",
  DAMAGED_BY_CARRIER: "Beim Transport beschädigt",
  DAMAGED_BY_FC: "Im Lager beschädigt",
  MISSING_PARTS: "Teile fehlen",
  NOT_COMPATIBLE: "Nicht kompatibel",
  EXTRA_ITEM: "Zusätzlicher Artikel",
  UNAUTHORIZED_PURCHASE: "Nicht autorisierter Kauf",
  NO_REASON_GIVEN: "Kein Grund",
  SWITCHEROO: "Anderer Artikel zurück",
  UNDELIVERABLE_UNKNOWN: "Unzustellbar",
  UNDELIVERABLE_REFUSED: "Annahme verweigert",
  PART_NOT_COMPATIBLE: "Nicht kompatibel",
};
export const reasonLabel = (code: string | null) => {
  const c = (code ?? "").trim();
  return c ? (REASON_LABEL[c.toUpperCase()] ?? c) : "";
};

const AMAZON_FAULT = new Set(["CARRIER_DAMAGED", "DISTRIBUTOR_DAMAGED", "WAREHOUSE_DAMAGED"]);
const CUSTOMER_DAMAGE = new Set(["CUSTOMER_DAMAGED", "DEFECTIVE"]);

export type ReturnRow = {
  mode: Mode;
  status: ReturnStatus;
  label: string;
  tone: string;
  rank: number;
  overRefund: number;
  orderId: string;
  sku: string;
  title: string;
  /** Erstattet am (FBA) bzw. Rücksendung angefragt am (FBM). */
  date: string | null;
  days: number | null;
  /** An den Kunden erstattet (Artikel + Versand). */
  amount: number;
  /** Offener Betrag, den Amazon noch schuldet. */
  open: number;
  /** Von Amazon noch erwartet (Frist läuft). */
  expect: number;
  amazon: { amount: number; quantity: number; date: string | null; source: string } | null;
  qtyRefunded: number;
  qtyReturned: number;
  returnDate: string | null;
  disposition: string;
  reason: string;
  tracking: string | null;
  safetClaimId: string | null;
  detail: string[];
};

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
const keyOf = (order: string, sku: string | null) => `${norm(order)}|${norm(sku)}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
export const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const de = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "–");
const fmtQty = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

type Sale = { quantity: number; product: number; ship: number };

function salesBy(tx: TxRow[], channels: string[]) {
  const m = new Map<string, Sale>();
  for (const r of tx) {
    if (r.kind !== "sale" || !channels.includes(r.channel)) continue;
    const s = m.get(keyOf(r.orderId, r.sku)) ?? { quantity: 0, product: 0, ship: 0 };
    s.quantity += r.quantity;
    s.product += r.productSales;
    s.ship += r.shippingCredits;
    m.set(keyOf(r.orderId, r.sku), s);
  }
  return m;
}

/** Betrag, der über Artikelpreis und Versand hinaus erstattet wurde, sonst 0. */
function overRefund(sale: Sale | undefined, refundProduct: number, refundShip: number) {
  if (!sale || sale.product <= 0) return 0;
  const extra = Math.max(0, refundProduct - sale.product) + Math.max(0, refundShip - Math.max(sale.ship, 0));
  return extra > 0.01 ? r2(extra) : 0;
}

function finish(row: Omit<ReturnRow, "label" | "tone" | "rank">): ReturnRow {
  const s = RETURN_STATUS[row.status];
  return { ...row, label: s.label, tone: s.tone, rank: s.rank };
}

// --- Versand durch Amazon -------------------------------------------------------------------

export function reconcileFba(
  input: { tx: TxRow[]; returns: FbaReturnRow[]; payments: PaymentRow[] },
  settings: ReturnSettings,
  today: string,
): { rows: ReturnRow[]; paymentsKnown: boolean } {
  const grace = settings.graceFba;
  const claimDay = Math.max(settings.claimFba, grace);
  const channels = ["fba", ""];

  type Refund = { orderId: string; sku: string; title: string; date: string | null; quantity: number; product: number; ship: number; total: number };
  const refunds = new Map<string, Refund>();
  for (const r of [...input.tx].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))) {
    if (r.kind !== "refund" || !channels.includes(r.channel)) continue;
    const k = keyOf(r.orderId, r.sku);
    const e = refunds.get(k) ?? { orderId: r.orderId, sku: r.sku ?? "", title: r.description ?? "", date: r.date, quantity: 0, product: 0, ship: 0, total: 0 };
    e.quantity += r.quantity;
    e.total += Math.abs(r.total);
    e.product += Math.abs(r.productSales);
    e.ship += Math.abs(r.shippingCredits);
    if (r.date && (!e.date || r.date < e.date)) e.date = r.date;
    refunds.set(k, e);
  }
  const sales = salesBy(input.tx, channels);

  type Ret = { quantity: number; dates: string[]; disp: Set<string>; reasons: Set<string> };
  const rets = new Map<string, Ret>();
  const retsByOrder = new Map<string, Ret>();
  const titles = new Map<string, string>();
  for (const r of input.returns) {
    for (const [m, k] of [
      [rets, keyOf(r.orderId, r.sku)],
      [retsByOrder, norm(r.orderId)],
    ] as const) {
      const e = m.get(k) ?? { quantity: 0, dates: [], disp: new Set<string>(), reasons: new Set<string>() };
      e.quantity += r.quantity;
      if (r.date) e.dates.push(r.date);
      if (r.disposition) e.disp.add(r.disposition.trim().toUpperCase());
      if (r.reason) e.reasons.add(r.reason.trim().toUpperCase());
      m.set(k, e);
    }
    if (r.title && r.sku) titles.set(norm(r.sku), r.title);
  }

  type Pay = { amount: number; quantity: number; quantityKnown: boolean; dates: string[]; reversed: boolean; source: string };
  const add = (m: Map<string, Pay>, k: string, p: PaymentRow) => {
    const e = m.get(k) ?? { amount: 0, quantity: 0, quantityKnown: true, dates: [], reversed: false, source: p.source };
    e.amount += p.amount;
    if (p.quantity === null) e.quantityKnown = false;
    else e.quantity += p.quantity;
    if (p.date) e.dates.push(p.date);
    if (p.amount < 0) e.reversed = true;
    m.set(k, e);
  };
  const payRep = new Map<string, Pay>();
  const payRepOrder = new Map<string, Pay>();
  const payTx = new Map<string, Pay>();
  const payTxOrder = new Map<string, Pay>();
  for (const p of input.payments) {
    const [a, b] = p.source === "Erstattungsbericht" ? [payRep, payRepOrder] : [payTx, payTxOrder];
    add(a, keyOf(p.orderId, p.sku), p);
    add(b, norm(p.orderId), p);
  }
  const paymentsKnown = input.payments.length > 0;

  const perOrder = new Map<string, number>();
  for (const e of refunds.values()) perOrder.set(norm(e.orderId), (perOrder.get(norm(e.orderId)) ?? 0) + 1);

  const rows: ReturnRow[] = [];
  for (const [k, e] of refunds) {
    // Nur eine SKU in der Bestellung: Rücksendung und Zahlung dürfen auch ohne SKU zugeordnet werden.
    const single = !e.sku || perOrder.get(norm(e.orderId)) === 1;
    const o = norm(e.orderId);
    const ret = rets.get(k) ?? (single ? retsByOrder.get(o) : undefined);
    const pay = payRep.get(k) ?? (single ? payRepOrder.get(o) : undefined) ?? payTx.get(k) ?? (single ? payTxOrder.get(o) : undefined);
    const refQty = Math.max(1, e.quantity);
    const retQty = ret?.quantity ?? 0;
    const days = e.date ? daysBetween(e.date, today) : null;
    const miss = Math.max(0, refQty - retQty);
    // Was der Kunde zurückbekommen hat. „Gesamt“ ist kleiner, weil Amazon einen Teil der Gebühr zurückgibt.
    const amount = e.product > 0 ? e.product + e.ship : e.total;
    const paid = !!pay && pay.amount > 0.005;
    const paidQty = paid ? (pay!.quantityKnown ? pay!.quantity : miss) : 0;
    const unit = amount / refQty;
    const disp = ret?.disp ?? new Set<string>();
    const reasons = ret?.reasons ?? new Set<string>();
    const lastRet = ret && ret.dates.length ? ret.dates.sort().at(-1)! : null;
    const notes: string[] = [];
    let status: ReturnStatus;
    let open = 0;
    let expect = 0;
    if (ret) notes.push(`${fmtQty(retQty)} von ${fmtQty(refQty)} zurück${lastRet ? `, Eingang ${de(lastRet)}` : ""}${disp.size ? ` · ${[...disp].sort().join(", ")}` : ""}`);
    if (miss === 0) {
      if ([...disp].some((d) => AMAZON_FAULT.has(d))) {
        if (paid) {
          status = "reimbursed";
          notes.push("Beschädigung durch Amazon oder Transport, von Amazon bezahlt.");
        } else {
          status = "amazonDamaged";
          open = unit * retQty;
          notes.push("Beschädigung beim Transport oder im Lager. Amazon muss dafür zahlen: Fall eröffnen.");
        }
      } else if (reasons.has("SWITCHEROO")) {
        status = paid ? "reimbursed" : "wrongItem";
        if (!paid) {
          open = amount;
          notes.push("Kunde hat einen anderen Artikel zurückgeschickt. Fall eröffnen.");
        }
      } else if ([...disp].some((d) => CUSTOMER_DAMAGE.has(d))) {
        status = "damaged";
        notes.push("Kunde hat den Artikel beschädigt oder defekt zurückgeschickt. Prüfe, ob der Artikel noch verkäuflich ist.");
      } else {
        status = "ok";
      }
      if (paid && status === "ok") notes.push("Amazon hat trotzdem gezahlt. Eine Rückbuchung durch Amazon ist möglich.");
    } else if (paid && paidQty >= miss) {
      status = "reimbursed";
      if (pay!.amount < unit * miss * 0.6) {
        notes.push(`Amazon hat ${eur(pay!.amount)} gezahlt, du hast ${eur(unit * miss)} erstattet. Amazon zahlt den eigenen Schätzwert, nicht den Verkaufspreis.`);
      }
    } else if (paid) {
      status = "partReimb";
      open = unit * (miss - paidQty);
      notes.push(`${fmtQty(paidQty)} von ${fmtQty(miss)} fehlenden Einheiten bezahlt. Fall eröffnen für den Rest.`);
    } else if (days !== null && days < grace) {
      status = "pending";
      notes.push(`Noch ${grace - days} Tage, bis die Rücksendefrist abläuft`);
    } else if (!paymentsKnown) {
      status = "unknown";
      open = unit * miss;
      notes.push("Lade den Bericht „Erstattungen“ hoch, um zu prüfen, ob Amazon gezahlt hat.");
    } else if (days !== null && days < claimDay) {
      status = "waitAmazon";
      expect = unit * miss;
      notes.push(`Seit ${days} Tagen erstattet, Amazon-Zahlung bis etwa Tag ${claimDay} erwartet`);
    } else {
      status = "notReimb";
      open = unit * miss;
      notes.push(`Seit ${days ?? "?"} Tagen erstattet, keine Rücksendung und keine Zahlung von Amazon. Fall eröffnen.`);
    }
    if (pay?.reversed) notes.push(paid ? "Enthält eine Rückbuchung." : "Amazon hat die Zahlung zurückgebucht.");

    const over = overRefund(sales.get(k), e.product, e.ship);
    if (over) {
      notes.push(`${eur(over)} mehr erstattet, als der Kunde bezahlt hat.`);
      open += over;
    }
    rows.push(
      finish({
        mode: "fba",
        status,
        overRefund: over,
        orderId: e.orderId,
        sku: e.sku,
        title: titles.get(norm(e.sku)) ?? e.title,
        date: e.date,
        days,
        amount: r2(amount),
        open: r2(open),
        expect: r2(expect),
        amazon: paid ? { amount: r2(pay!.amount), quantity: pay!.quantityKnown ? pay!.quantity : miss, date: pay!.dates.sort().at(-1) ?? null, source: pay!.source } : null,
        qtyRefunded: refQty,
        qtyReturned: retQty,
        returnDate: lastRet,
        disposition: [...disp].sort().join(", "),
        reason: [...reasons].sort().map(reasonLabel).join(", "),
        tracking: null,
        safetClaimId: null,
        detail: notes,
      }),
    );
  }
  return { rows: sortRows(rows), paymentsKnown };
}

// --- Händlerversand -----------------------------------------------------------------------------

export function reconcileFbm(input: { tx: TxRow[]; returns: FbmReturnRow[] }, settings: ReturnSettings, today: string): ReturnRow[] {
  const grace = settings.graceFbm;
  const sales = salesBy(input.tx, ["fbm", ""]);
  const refundsTx = new Map<string, { product: number; ship: number }>();
  const safetPaid = new Map<string, number>();
  for (const r of input.tx) {
    if (r.kind === "refund" && (r.channel === "fbm" || r.channel === "")) {
      const e = refundsTx.get(keyOf(r.orderId, r.sku)) ?? { product: 0, ship: 0 };
      e.product += Math.abs(r.productSales);
      e.ship += Math.abs(r.shippingCredits);
      refundsTx.set(keyOf(r.orderId, r.sku), e);
    }
    if (r.kind === "safet") safetPaid.set(norm(r.orderId), (safetPaid.get(norm(r.orderId)) ?? 0) + r.total);
  }

  const rows: ReturnRow[] = [];
  for (const r of input.returns) {
    const refunded = r.refundedAmount;
    const isRefunded = refunded > 0;
    const tracking = (r.tracking ?? "").trim();
    const days = r.requestDate ? daysBetween(r.requestDate, today) : null;
    const paid = safetPaid.get(norm(r.orderId)) ?? 0;
    const notes: string[] = [];
    let status: ReturnStatus;
    let open = 0;
    if (isRefunded && r.deliveryDate) {
      status = "ok";
      notes.push(`Zugestellt ${de(r.deliveryDate)}`);
    } else if (isRefunded && paid > 0) {
      status = "reimbursed";
      notes.push(`SAFE-T-Erstattung ${eur(paid)} erhalten`);
    } else if (isRefunded) {
      if (days !== null && days >= grace) {
        status = "missing";
        open = refunded;
        notes.push(`Seit ${days} Tagen angefragt, keine Zustellung.${tracking ? ` Sendung ${tracking} prüfen.` : " Keine Sendungsnummer."}`);
      } else if (!tracking) {
        status = "nodoc";
        open = refunded;
        notes.push("Erstattung ohne Sendungsnummer. Eigenes Etikett des Kunden oder Erstattung ohne Rücksendung.");
      } else {
        status = "transit";
        notes.push(`Sendung ${tracking}`);
      }
    } else if (r.deliveryDate) {
      status = "toRefund";
      notes.push(`Zugestellt ${de(r.deliveryDate)}. Erstattung fällig.`);
    } else if (days !== null && days >= grace) {
      status = "expired";
      notes.push("Keine Rücksendung, keine Erstattung.");
    } else {
      status = "open";
      notes.push(tracking ? `Sendung ${tracking}` : "Noch keine Sendungsnummer");
    }
    if (r.safetClaimId) notes.push(`SAFE-T-Antrag ${r.safetClaimId}`);
    const k = keyOf(r.orderId, r.sku);
    const rt = refundsTx.get(k);
    const over = rt ? overRefund(sales.get(k), rt.product, rt.ship) : 0;
    if (over) {
      notes.push(`${eur(over)} mehr erstattet, als der Kunde bezahlt hat.`);
      open += over;
    }
    rows.push(
      finish({
        mode: "fbm",
        status,
        overRefund: over,
        orderId: r.orderId,
        sku: r.sku ?? "",
        title: r.title ?? "",
        date: r.requestDate,
        days,
        amount: r2(refunded),
        open: r2(open),
        expect: 0,
        amazon: paid > 0 ? { amount: r2(paid), quantity: r.quantity, date: null, source: "SAFE-T" } : null,
        qtyRefunded: isRefunded ? r.quantity : 0,
        qtyReturned: r.deliveryDate ? r.quantity : 0,
        returnDate: r.deliveryDate,
        disposition: "",
        reason: reasonLabel(r.reason),
        tracking: tracking || null,
        safetClaimId: r.safetClaimId,
        detail: notes,
      }),
    );
  }
  return sortRows(rows);
}

function sortRows(rows: ReturnRow[]) {
  return rows.sort((a, b) => a.rank - b.rank || (b.days ?? 0) - (a.days ?? 0));
}

// --- Ansprüche --------------------------------------------------------------------------------------

export type ReturnClaim = {
  key: string;
  type: "return_not_received" | "return_damaged" | "return_wrong_item" | "refund_too_high" | "fbm_safet";
  title: string;
  sku: string | null;
  quantity: number;
  /** Wert laut Erstattung an den Kunden – wird genommen, wenn kein EK bekannt ist. */
  refundValue: number;
  /** Geldbetrag statt Einheiten (zu viel erstattet, SAFE-T): immer dieser Betrag. */
  moneyOnly: boolean;
  reference: string;
  eventDate: string;
  evidence: { label: string; value: string; source?: string }[];
};

/** Macht aus den Zeilen, bei denen Amazon zahlen muss, Ansprüche. */
export function returnClaims(rows: ReturnRow[], today: string): ReturnClaim[] {
  const out: ReturnClaim[] = [];
  for (const r of rows) {
    const eventDate = r.date ?? today;
    const ev = [
      { label: r.mode === "fba" ? "Kunde erstattet am" : "Rücksendung angefragt am", value: `${de(r.date)} · ${eur(r.amount)}`, source: r.mode === "fba" ? "Transaktionen" : "Retourenbericht Händlerversand" },
      ...(r.mode === "fba" ? [{ label: "Rücksendung eingegangen", value: `${fmtQty(r.qtyReturned)} von ${fmtQty(r.qtyRefunded)}${r.disposition ? ` (${r.disposition})` : ""}`, source: "FBA-Kundenrücksendungen" }] : []),
      { label: "Von Amazon gezahlt", value: r.amazon ? `${eur(r.amazon.amount)} für ${fmtQty(r.amazon.quantity)} Einheit(en)` : "nichts", source: r.amazon?.source ?? "Erstattungen" },
    ];
    const base = { sku: r.sku || null, reference: r.orderId, eventDate };
    if (r.status === "notReimb" || r.status === "partReimb") {
      const miss = r.qtyRefunded - r.qtyReturned;
      const qty = r.status === "partReimb" ? miss - (r.amazon?.quantity ?? 0) : miss;
      out.push({ ...base, key: `retnr:${r.orderId}:${r.sku}`, type: "return_not_received", title: `Erstattet, nie zurückgekommen – Bestellung ${r.orderId}`, quantity: Math.max(1, qty), refundValue: r2(r.open - r.overRefund), moneyOnly: false, evidence: ev });
    } else if (r.status === "amazonDamaged") {
      out.push({ ...base, key: `retdmg:${r.orderId}:${r.sku}`, type: "return_damaged", title: `Retoure bei Amazon beschädigt – Bestellung ${r.orderId}`, quantity: Math.max(1, r.qtyReturned), refundValue: r2(r.open - r.overRefund), moneyOnly: false, evidence: ev });
    } else if (r.status === "wrongItem") {
      out.push({ ...base, key: `retwrong:${r.orderId}:${r.sku}`, type: "return_wrong_item", title: `Anderer Artikel zurückgeschickt – Bestellung ${r.orderId}`, quantity: Math.max(1, r.qtyRefunded), refundValue: r2(r.amount), moneyOnly: false, evidence: [...ev, { label: "Rücksendegrund", value: r.reason || "SWITCHEROO", source: "FBA-Kundenrücksendungen" }] });
    } else if (r.status === "missing" || r.status === "nodoc") {
      out.push({
        ...base,
        key: `safet:${r.orderId}:${r.sku}`,
        type: "fbm_safet",
        title: `SAFE-T: erstattet, nicht zurück – Bestellung ${r.orderId}`,
        quantity: Math.max(1, r.qtyRefunded),
        refundValue: r2(r.amount),
        moneyOnly: true,
        evidence: [...ev, { label: "Sendungsnummer", value: r.tracking ?? "keine", source: "Retourenbericht Händlerversand" }],
      });
    }
    if (r.overRefund > 0) {
      out.push({ ...base, key: `overrefund:${r.mode}:${r.orderId}:${r.sku}`, type: "refund_too_high", title: `Zu viel erstattet – Bestellung ${r.orderId}`, quantity: 1, refundValue: r.overRefund, moneyOnly: true, evidence: [...ev, { label: "Mehr erstattet als bezahlt", value: eur(r.overRefund), source: "Transaktionen" }] });
    }
  }
  return out;
}

// --- Auswertungen -----------------------------------------------------------------------------------

export type MonthStat = { month: string; count: number; refunded: number; returned: number; paid: number; waiting: number; lost: number };

export function monthly(rows: ReturnRow[], resolved: (r: ReturnRow) => boolean = () => false): MonthStat[] {
  const m = new Map<string, MonthStat>();
  for (const r of rows) {
    if (!r.amount || !r.date) continue;
    const k = r.date.slice(0, 7);
    const s = m.get(k) ?? { month: k, count: 0, refunded: 0, returned: 0, paid: 0, waiting: 0, lost: 0 };
    const unit = r.amount / Math.max(r.qtyRefunded, 1);
    const back = Math.min(r.qtyReturned, r.qtyRefunded) * unit;
    s.count++;
    s.refunded += r.amount;
    s.returned += back;
    s.paid += r.amazon?.amount ?? 0;
    if (["pending", "waitAmazon", "transit", "unknown"].includes(r.status)) s.waiting += Math.max(0, r.amount - back);
    if (!resolved(r)) s.lost += r.open;
    m.set(k, s);
  }
  return [...m.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12)
    .map((s) => ({ ...s, refunded: r2(s.refunded), returned: r2(s.returned), paid: r2(s.paid), waiting: r2(s.waiting), lost: r2(s.lost) }));
}

export type SkuStat = {
  sku: string;
  title: string;
  sold: number;
  refunded: number;
  returned: number;
  notReturned: number;
  refundAmount: number;
  open: number;
  rate: number | null;
  topReasons: { reason: string; count: number }[];
};

export function skuStats(
  rows: ReturnRow[],
  tx: TxRow[],
  mode: Mode,
  reasonsIn: { sku: string | null; reason: string | null; quantity: number }[],
): SkuStat[] {
  const channels = mode === "fba" ? ["fba", ""] : ["fbm", ""];
  const sold = new Map<string, { sku: string; title: string; quantity: number }>();
  for (const r of tx) {
    if (r.kind !== "sale" || !channels.includes(r.channel) || !r.sku) continue;
    const s = sold.get(norm(r.sku)) ?? { sku: r.sku, title: r.description ?? "", quantity: 0 };
    s.quantity += r.quantity;
    sold.set(norm(r.sku), s);
  }
  const reasons = new Map<string, Map<string, number>>();
  for (const r of reasonsIn) {
    if (!r.reason || !r.sku) continue;
    const m = reasons.get(norm(r.sku)) ?? new Map<string, number>();
    const l = reasonLabel(r.reason);
    m.set(l, (m.get(l) ?? 0) + (r.quantity || 1));
    reasons.set(norm(r.sku), m);
  }
  const stats = new Map<string, SkuStat>();
  const empty = (sku: string, title: string): SkuStat => ({ sku, title, sold: 0, refunded: 0, returned: 0, notReturned: 0, refundAmount: 0, open: 0, rate: null, topReasons: [] });
  for (const r of rows) {
    const k = norm(r.sku);
    const s = stats.get(k) ?? empty(r.sku, r.title);
    s.refunded += r.qtyRefunded;
    s.returned += Math.min(r.qtyReturned, r.qtyRefunded);
    if (["notReimb", "partReimb", "missing", "nodoc", "unknown", "waitAmazon", "reimbursed"].includes(r.status)) s.notReturned += Math.max(0, r.qtyRefunded - r.qtyReturned);
    s.refundAmount += r.amount;
    s.open += r.open;
    stats.set(k, s);
  }
  for (const [k, v] of sold) {
    const s = stats.get(k) ?? empty(v.sku, v.title);
    s.sold = v.quantity;
    if (!s.title) s.title = v.title;
    stats.set(k, s);
  }
  return [...stats.entries()]
    .map(([k, s]) => ({
      ...s,
      rate: s.sold ? Math.round((s.refunded / s.sold) * 1000) / 10 : null,
      refundAmount: r2(s.refundAmount),
      open: r2(s.open),
      topReasons: [...(reasons.get(k) ?? new Map<string, number>())]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, count]) => ({ reason, count })),
    }))
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || b.refunded - a.refunded);
}
