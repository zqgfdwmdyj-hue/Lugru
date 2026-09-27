import { notFound } from "next/navigation";
import { and, asc, desc, eq, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { CLAIM_STATUS_LABEL } from "@/lib/claims/labels";
import { claimCaseText } from "@/lib/claims/texts";
import { formatDate, formatEuro } from "@/lib/numbers";
import { CLAIM_TYPE_LABEL } from "@/lib/settings";
import { PrintButton } from "@/components/print-button";

// Druckbare Nachweis-Mappe für einen Anspruch – für Amazon oder den Anwalt.
export default async function MappePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [claim] = await db.select().from(schema.claims).where(and(eq(schema.claims.id, id), eq(schema.claims.tenantId, session.tenantId)));
  if (!claim) notFound();
  const t = session.tenantId;
  const L = schema.amazonLedgerEvents;
  const [lot, events, ledger, reimb, invoices] = await Promise.all([
    claim.lotId ? db.select().from(schema.lots).where(eq(schema.lots.id, claim.lotId)).then((r) => r[0]) : Promise.resolve(undefined),
    db.select().from(schema.claimEvents).where(eq(schema.claimEvents.claimId, id)).orderBy(asc(schema.claimEvents.createdAt)),
    claim.sku || claim.fnsku
      ? db.select().from(L).where(and(eq(L.tenantId, t), or(claim.sku ? eq(L.sku, claim.sku) : undefined, claim.fnsku ? eq(L.fnsku, claim.fnsku) : undefined))).orderBy(desc(L.eventDate)).limit(80)
      : Promise.resolve([]),
    claim.sku ? db.select().from(schema.amazonReimbursements).where(and(eq(schema.amazonReimbursements.tenantId, t), eq(schema.amazonReimbursements.sku, claim.sku))).orderBy(desc(schema.amazonReimbursements.approvalDate)) : Promise.resolve([]),
    claim.lotId
      ? db.select({ fileName: schema.invoices.fileName, date: schema.invoices.invoiceDate, number: schema.invoices.invoiceNumber, total: schema.invoices.totalGross }).from(schema.invoiceLots).innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLots.invoiceId)).where(eq(schema.invoiceLots.lotId, claim.lotId))
      : Promise.resolve([]),
  ]);

  const cell = { border: "1px solid #ccc", padding: "4px 6px", fontSize: 11, textAlign: "left" as const };
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 32, background: "#fff", fontSize: 13 }}>
      <style>{`@media print { .no-print { display: none } body { background: #fff } main { padding: 0 } }`}</style>
      <div className="no-print" style={{ marginBottom: 16 }}><PrintButton /></div>
      <div className="small muted">{session.tenantName} · Nachweis-Mappe · erstellt am {new Date().toLocaleDateString("de-DE")}</div>
      <h1 style={{ fontSize: 22, margin: "6px 0 4px" }}>{claim.title}</h1>
      <div>{CLAIM_TYPE_LABEL[claim.type]} · Status: {CLAIM_STATUS_LABEL[claim.status][0]}{claim.amazonCaseId ? ` · Amazon-Fall ${claim.amazonCaseId}` : ""}</div>

      <h2 style={{ fontSize: 15, marginTop: 20 }}>Eckdaten</h2>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          {[
            ["SKU / FNSKU / ASIN", `${claim.sku ?? "–"} / ${claim.fnsku ?? "–"} / ${claim.asin ?? "–"}`],
            ["Referenz", claim.reference ?? "–"],
            ["Ereignisdatum", formatDate(claim.eventDate)],
            ["Frist", formatDate(claim.deadline)],
            ["Menge", String(claim.quantity)],
            ["EK netto je Einheit", formatEuro(claim.unitCost)],
            ["Geforderter Betrag", formatEuro(claim.expectedAmount)],
            ["Bereits erstattet", formatEuro(claim.reimbursedAmount)],
            ["Einkauf (Charge)", lot ? `${lot.sku} · gekauft ${formatDate(lot.purchaseDate)}${lot.purchaseDateEstimated ? " (Jahr geschätzt)" : ""}` : "–"],
          ].map(([k, v]) => <tr key={k}><th style={{ ...cell, width: 200, background: "#f6f6f6" }}>{k}</th><td style={cell}>{v}</td></tr>)}
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, marginTop: 20 }}>Nachweise</h2>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>{claim.evidence.map((e, i) => <tr key={i}><th style={{ ...cell, width: 200, background: "#f6f6f6" }}>{e.label}</th><td style={cell}>{e.value}</td><td style={cell}>{e.source}</td></tr>)}</tbody>
      </table>

      <h2 style={{ fontSize: 15, marginTop: 20 }}>Rechnungen</h2>
      {invoices.length === 0 ? <p>Keine Rechnung verknüpft.</p> : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={cell}>Datei</th><th style={cell}>Datum</th><th style={cell}>Nummer</th><th style={cell}>Brutto</th></tr></thead>
          <tbody>{invoices.map((i, k) => <tr key={k}><td style={cell}>{i.fileName}</td><td style={cell}>{formatDate(i.date)}</td><td style={cell}>{i.number ?? "–"}</td><td style={cell}>{formatEuro(i.total)}</td></tr>)}</tbody>
        </table>
      )}

      <h2 style={{ fontSize: 15, marginTop: 20 }}>Bestandsprotokoll (letzte Einträge)</h2>
      {ledger.length === 0 ? <p>Keine Einträge.</p> : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>{["Datum", "Ereignis", "Menge", "Grund", "Zustand", "FC", "Referenz"].map((h) => <th key={h} style={cell}>{h}</th>)}</tr></thead>
          <tbody>{ledger.map((e) => <tr key={e.id}><td style={cell}>{formatDate(e.eventDate)}</td><td style={cell}>{e.eventType}</td><td style={cell}>{e.quantity}</td><td style={cell}>{e.reason ?? ""}</td><td style={cell}>{e.disposition ?? ""}</td><td style={cell}>{e.fulfillmentCenter ?? ""}</td><td style={cell}>{e.referenceId ?? ""}</td></tr>)}</tbody>
        </table>
      )}

      <h2 style={{ fontSize: 15, marginTop: 20 }}>Erstattungen zu dieser SKU</h2>
      {reimb.length === 0 ? <p>Keine.</p> : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>{["Datum", "ID", "Fall", "Grund", "Menge", "Betrag"].map((h) => <th key={h} style={cell}>{h}</th>)}</tr></thead>
          <tbody>{reimb.map((r) => <tr key={r.id}><td style={cell}>{formatDate(r.approvalDate)}</td><td style={cell}>{r.reimbursementId}</td><td style={cell}>{r.caseId ?? ""}</td><td style={cell}>{r.reason ?? ""}</td><td style={cell}>{r.quantityTotal}</td><td style={cell}>{formatEuro(r.amountTotal)}</td></tr>)}</tbody>
        </table>
      )}

      <h2 style={{ fontSize: 15, marginTop: 20 }}>Verlauf</h2>
      <ul>{events.map((e) => <li key={e.id}>{e.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} – {e.action}{e.note ? `: ${e.note}` : ""}</li>)}</ul>

      <h2 style={{ fontSize: 15, marginTop: 20 }}>Eingereichter Text</h2>
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", border: "1px solid #ccc", padding: 10 }}>{claimCaseText(claim)}</pre>
    </main>
  );
}
