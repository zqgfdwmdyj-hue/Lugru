import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { code128Svg } from "@/lib/labels/barcode";
import { AutoPrint } from "@/components/auto-print";
import { PrintButton } from "@/components/print-button";

// FNSKU-Etiketten für den Brother QL-800 (62 × 29 mm, Endlos- oder Einzeletiketten).
// Aufruf: /etikett?skus=SKU1:3,SKU2:1  oder  /etikett?sendung=<id>  (&drucken=1)

type Label = { fnsku: string; title: string };

export default async function EtikettPage({ searchParams }: { searchParams: Promise<{ skus?: string; sendung?: string; drucken?: string; zustand?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const wanted = new Map<string, number>();
  if (sp.sendung && /^[0-9a-f-]{36}$/i.test(sp.sendung)) {
    const items = await db
      .select({ sku: schema.inboundItems.sku, n: schema.inboundItems.scannedQuantity })
      .from(schema.inboundItems)
      .where(and(eq(schema.inboundItems.shipmentId, sp.sendung), eq(schema.inboundItems.tenantId, session.tenantId)));
    for (const i of items) if (i.n > 0) wanted.set(i.sku, i.n);
  }
  for (const part of (sp.skus ?? "").split(",")) {
    const i = part.lastIndexOf(":");
    const sku = decodeURIComponent(i > 0 ? part.slice(0, i) : part).trim();
    const n = i > 0 ? Number(part.slice(i + 1)) : 1;
    if (sku) wanted.set(sku, Math.min(500, Math.max(1, Number.isFinite(n) ? n : 1)));
  }
  const rows = wanted.size
    ? await db
        .select({ sku: schema.lots.sku, fnsku: schema.lots.fnsku, title: schema.products.title, asin: schema.products.asin })
        .from(schema.lots)
        .innerJoin(schema.products, eq(schema.products.id, schema.lots.productId))
        .where(and(eq(schema.lots.tenantId, session.tenantId), inArray(schema.lots.sku, [...wanted.keys()])))
    : [];
  const labels: Label[] = [];
  const missing: string[] = [];
  for (const r of rows) {
    if (!r.fnsku) {
      missing.push(r.sku);
      continue;
    }
    for (let k = 0; k < (wanted.get(r.sku) ?? 0); k++) labels.push({ fnsku: r.fnsku, title: r.title ?? r.asin });
  }
  const svgs = new Map([...new Set(labels.map((l) => l.fnsku))].map((f) => [f, code128Svg(f)]));
  const condition = sp.zustand ?? "Neu";

  return (
    <>
      <style>{`
        @page { size: 62mm 29mm; margin: 0; }
        body { margin: 0; background: #fff; }
        .label { width: 62mm; height: 29mm; box-sizing: border-box; padding: 1.5mm 2.5mm; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; overflow: hidden; font-family: Arial, sans-serif; color: #000; }
        .label svg { width: 100%; height: 12mm; }
        .fnsku { font-size: 9pt; font-weight: bold; letter-spacing: .5px; }
        .title { font-size: 6.5pt; line-height: 1.1; max-height: 2.3em; overflow: hidden; }
        @media screen { .label { border: 1px dashed #bbb; margin: 8px; } .bar { padding: 12px; font-family: sans-serif; } }
        @media print { .bar { display: none; } }
      `}</style>
      <div className="bar">
        <PrintButton label={`${labels.length} Etiketten drucken`} />
        <span style={{ marginLeft: 12, fontSize: 13 }}>Drucker: Brother QL-800 · Papier 62 × 29 mm · Ränder: keine · Skalierung 100 %</span>
        {missing.length > 0 && <div style={{ color: "#b42318", marginTop: 8 }}>Ohne FNSKU (nicht gedruckt): {missing.join(", ")}</div>}
      </div>
      {labels.map((l, i) => (
        <div className="label" key={i}>
          <div dangerouslySetInnerHTML={{ __html: svgs.get(l.fnsku)! }} />
          <div className="fnsku">{l.fnsku}</div>
          <div className="title">{l.title.slice(0, 80)} · {condition}</div>
        </div>
      ))}
      <AutoPrint enabled={sp.drucken === "1" && labels.length > 0} />
    </>
  );
}
