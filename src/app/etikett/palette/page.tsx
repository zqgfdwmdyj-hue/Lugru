import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { formatDate } from "@/lib/numbers";
import { code128Svg } from "@/lib/labels/barcode";
import { PrintButton } from "@/components/print-button";

// Paletten-Etiketten (A6 quer, z. B. für den Etikettendrucker oder 4 je A4-Blatt).
// Aufruf: /etikett/palette?codes=P-0001,P-0002

export default async function PalettenEtikettPage({ searchParams }: { searchParams: Promise<{ codes?: string }> }) {
  const session = await requireArea("paletten");
  const sp = await searchParams;
  const codes = [...new Set((sp.codes ?? "").split(",").map((c) => c.trim()).filter(Boolean))].slice(0, 300);
  const P = schema.pallets;
  const rows = codes.length
    ? await db.select().from(P).where(and(eq(P.tenantId, session.tenantId), inArray(P.code, codes)))
    : [];
  // Je Nummer die neueste Einlagerung.
  const byCode = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!byCode.get(r.code) || byCode.get(r.code)!.inAt < r.inAt) byCode.set(r.code, r);
  const labels = codes.filter((c) => byCode.has(c)).map((c) => byCode.get(c)!);

  return (
    <>
      <style>{`
        @page { size: 148mm 105mm; margin: 0; }
        body { margin: 0; background: #fff; }
        .pl { width: 148mm; height: 105mm; box-sizing: border-box; padding: 8mm; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; font-family: Arial, sans-serif; color: #000; }
        .pl svg { width: 100%; height: 30mm; }
        .pl .code { font-size: 40pt; font-weight: bold; text-align: center; letter-spacing: 2px; }
        .pl .meta { display: flex; justify-content: space-between; gap: 6mm; font-size: 14pt; }
        .pl .place { font-size: 22pt; font-weight: bold; white-space: nowrap; }
        .pl .what { font-size: 11pt; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        @media screen { .pl { border: 1px dashed #bbb; margin: 8px; } .bar { padding: 12px; font-family: sans-serif; } }
        @media print { .bar { display: none; } }
      `}</style>
      <div className="bar">
        <PrintButton label={`${labels.length} Paletten-Etikett${labels.length === 1 ? "" : "en"} drucken`} />
        <span style={{ marginLeft: 12, fontSize: 13 }}>Format A6 quer (148 × 105 mm) · Skalierung 100 %</span>
      </div>
      {labels.map((p) => (
        <div className="pl" key={p.id}>
          <div className="code">{p.code}</div>
          <div dangerouslySetInnerHTML={{ __html: code128Svg(p.code) }} />
          {p.contents && <div className="what">{p.contents}{p.weightKg ? ` · ${String(p.weightKg).replace(".", ",")} kg` : ""}</div>}
          <div className="meta"><span>{p.customer ?? ""}</span>{p.location && <span className="place">{p.location}</span>}<span>Eingelagert {formatDate(p.inAt)}</span></div>
        </div>
      ))}
    </>
  );
}
