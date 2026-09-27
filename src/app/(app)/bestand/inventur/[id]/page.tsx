import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { bookCount, setCounted } from "../../actions";
import { CountScan } from "./count-scan";

export default async function InventurPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [c] = await db.select().from(schema.inventoryCounts).where(and(eq(schema.inventoryCounts.id, id), eq(schema.inventoryCounts.tenantId, session.tenantId)));
  if (!c) notFound();
  const lines = await db.select().from(schema.inventoryCountLines).where(eq(schema.inventoryCountLines.countId, id)).orderBy(asc(schema.inventoryCountLines.sku));
  const diff = lines.filter((l) => l.counted !== l.expected);
  const open = c.status === "open";
  return (
    <>
      <div className="crumb"><Link href="/bestand">Bestand</Link> › Inventur</div>
      <div className="page-head">
        <div><h1>{c.name}</h1><div className="small muted">{lines.length} Positionen · {diff.length} Abweichungen · {open ? "offen" : "gebucht"}</div></div>
        {open && <form action={bookCount}><input type="hidden" name="countId" value={c.id} /><button className="btn btn-primary" type="submit">Inventur buchen</button></form>}
      </div>
      {open && <CountScan countId={c.id} />}
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table">
          <thead><tr><th>SKU</th><th className="right">Soll</th><th className="right">Gezählt</th><th className="right">Differenz</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} style={{ background: l.counted !== l.expected ? "var(--warn-soft)" : undefined }}>
                <td className="num">{l.sku}</td>
                <td className="num right">{l.expected}</td>
                <td className="right">
                  {open ? (
                    <form action={setCounted} style={{ display: "inline-flex", gap: 4 }}>
                      <input type="hidden" name="lineId" value={l.id} />
                      <input className="input num" name="counted" defaultValue={l.counted} aria-label="Gezählt" style={{ width: 70, padding: "3px 6px", textAlign: "right" }} />
                    </form>
                  ) : <span className="num">{l.counted}</span>}
                </td>
                <td className="num right" style={{ color: l.counted - l.expected < 0 ? "var(--danger)" : undefined }}>{l.counted - l.expected || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
