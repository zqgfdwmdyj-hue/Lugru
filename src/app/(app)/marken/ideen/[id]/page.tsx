import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { CONTENT_STATUS_LABEL, IDEA_STATUS_LABEL } from "@/lib/brands/ai";
import { OCCASIONS, occasionByKey } from "@/lib/brands/occasions";
import { formatEuro } from "@/lib/numbers";
import { checklistAction, deleteIdeaAction, setIdeaStatusAction } from "../../actions";
import { SaveForm, SuggestContent } from "../../forms";

const NEXT: Record<string, [string, string][]> = {
  idea: [["review", "Prüfen"], ["planned", "Umsetzen (geplant)"], ["rejected", "Verwerfen"]],
  review: [["planned", "Umsetzen (geplant)"], ["rejected", "Verwerfen"]],
  planned: [["in_progress", "In Umsetzung"], ["idea", "Zurück zu Idee"]],
  in_progress: [["live", "Ist live"], ["planned", "Zurück zu Geplant"]],
  live: [["in_progress", "Wieder in Umsetzung"]],
  rejected: [["idea", "Wieder aufnehmen"]],
};

export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = session.tenantId;
  const [row] = await db
    .select({ idea: schema.ideas, brand: schema.brands })
    .from(schema.ideas)
    .innerJoin(schema.brands, eq(schema.brands.id, schema.ideas.brandId))
    .where(and(eq(schema.ideas.id, id), eq(schema.ideas.tenantId, t)));
  if (!row) notFound();
  const { idea: i, brand: b } = row;
  const posts = await db.select().from(schema.contentPosts).where(and(eq(schema.contentPosts.tenantId, t), eq(schema.contentPosts.ideaId, i.id))).orderBy(desc(schema.contentPosts.createdAt));
  const [label, cls] = IDEA_STATUS_LABEL[i.status];
  const vk = i.targetPrice ? Number(i.targetPrice) : null;
  const ek = i.costEstimate ? Number(i.costEstimate) : null;
  // Grobe Kalkulation: Netto-VK (19 % bzw. 7 % bei Lebensmitteln), ca. 15 % Marktplatzgebühr, Versand/Verpackung pauschal.
  const vat = i.kind === "box" && /kulu/i.test(b.name) ? 0.07 : 0.19;
  const netVk = vk ? vk / (1 + vat) : null;
  const fees = vk ? vk * 0.15 : null;
  const profit = netVk !== null && ek !== null && fees !== null ? netVk - ek - fees - 4.5 : null;
  const done = i.checklist.filter((c) => c.done).length;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href={`/marken?marke=${b.id}`}>{b.name}</Link>{i.occasion && <> · <Link href={`/marken?marke=${b.id}&anlass=${i.occasion}`}>{occasionByKey(i.occasion)?.name}</Link></>}</div>
          <h1 style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{i.title} <span className={`tag ${cls}`}>{label}</span>{i.source === "ai" && <span className="tag tag-neutral">KI-Vorschlag</span>}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(NEXT[i.status] ?? []).map(([s, text], n) => (
            <form key={s} action={setIdeaStatusAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="status" value={s} /><button className={`btn${n === 0 ? " btn-primary" : ""}`} type="submit">{text}</button></form>
          ))}
        </div>
      </div>

      <div className="row">
        <div className="stack" style={{ flexGrow: 1, minWidth: 0 }}>
          <section className="card card-pad">
            <SaveForm kind="idea">
              <input type="hidden" name="id" value={i.id} />
              <div className="field"><label className="label" htmlFor="title">Titel</label><input className="input" id="title" name="title" defaultValue={i.title} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                <div className="field"><label className="label" htmlFor="kind">Art</label>
                  <select className="input" id="kind" name="kind" defaultValue={i.kind}><option value="box">Box / Set</option><option value="product">Produkt</option><option value="other">Sonstiges</option></select></div>
                <div className="field"><label className="label" htmlFor="occasion">Anlass</label>
                  <select className="input" id="occasion" name="occasion" defaultValue={i.occasion ?? ""}><option value="">ganzjährig</option>{OCCASIONS.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</select></div>
                <div className="field"><label className="label" htmlFor="launchDate">Launch</label><input className="input" id="launchDate" name="launchDate" type="date" defaultValue={i.launchDate ?? ""} /></div>
              </div>
              <div className="field"><label className="label" htmlFor="concept">Konzept</label><textarea className="textarea" id="concept" name="concept" defaultValue={i.concept ?? ""} style={{ minHeight: 80 }} /></div>
              <div className="field"><label className="label" htmlFor="contents">{i.kind === "product" ? "Merkmale" : "Inhalt"} – eine Zeile je Teil</label><textarea className="textarea" id="contents" name="contents" defaultValue={i.contents.join("\n")} style={{ minHeight: 110 }} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div className="field"><label className="label" htmlFor="targetPrice">Verkaufspreis brutto</label><input className="input" id="targetPrice" name="targetPrice" inputMode="decimal" defaultValue={i.targetPrice ?? ""} /></div>
                <div className="field"><label className="label" htmlFor="costEstimate">Einkauf netto (geschätzt)</label><input className="input" id="costEstimate" name="costEstimate" inputMode="decimal" defaultValue={i.costEstimate ?? ""} /></div>
              </div>
              <div className="field"><label className="label" htmlFor="sourcing">Beschaffung</label><textarea className="textarea" id="sourcing" name="sourcing" defaultValue={i.sourcing ?? ""} style={{ minHeight: 60 }} /></div>
              <div className="field"><label className="label" htmlFor="notes">Notizen</label><textarea className="textarea" id="notes" name="notes" defaultValue={i.notes ?? ""} style={{ minHeight: 60 }} /></div>
            </SaveForm>
          </section>

          <section className="card card-pad stack">
            <h2>Video-Ideen zu dieser {i.kind === "product" ? "Produktidee" : "Box"}</h2>
            <SuggestContent brandId={b.id} ideaId={i.id} />
            {posts.length === 0 && <div className="small muted">Noch keine. Die KI schreibt Hook, Ablauf, Szenen, Caption und Hashtags – drehen mit dem Handy.</div>}
            {posts.map((p) => (
              <div key={p.id} className="small" style={{ borderTop: "1px solid var(--row)", paddingTop: 8 }}>
                <span className={`tag ${CONTENT_STATUS_LABEL[p.status][1]}`}>{CONTENT_STATUS_LABEL[p.status][0]}</span> <strong>{p.format ? `${p.format}: ` : ""}{p.hook}</strong>
              </div>
            ))}
            {posts.length > 0 && <Link className="small" href={`/marken/content?marke=${b.id}`}>Im Content-Plan bearbeiten →</Link>}
          </section>
        </div>

        <aside className="col-side">
          <section className="card card-pad stack">
            <h2>Bis zum Launch <span className="muted small">{done}/{i.checklist.length}</span></h2>
            {i.checklist.map((c, n) => (
              <div key={n} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                <form action={checklistAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="op" value="toggle" /><input type="hidden" name="index" value={n} />
                  <button className="btn-link" type="submit" aria-label={c.done ? "Wieder öffnen" : "Erledigt"} style={{ fontSize: 16 }}>{c.done ? "☑" : "☐"}</button></form>
                <span style={{ flex: 1, textDecoration: c.done ? "line-through" : undefined, color: c.done ? "var(--muted)" : undefined }}>{c.text}</span>
                <form action={checklistAction}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="op" value="remove" /><input type="hidden" name="index" value={n} />
                  <button className="btn-link small muted" type="submit" aria-label="Entfernen">✕</button></form>
              </div>
            ))}
            <form action={checklistAction} style={{ display: "flex", gap: 6 }}>
              <input type="hidden" name="id" value={i.id} /><input type="hidden" name="op" value="add" />
              <input className="input" name="text" placeholder="Schritt ergänzen" style={{ flex: 1 }} />
              <button className="btn btn-small" type="submit">+</button>
            </form>
            <Link className="small" href="/einkauf">→ Ware im Einkauf bestellen</Link>
          </section>

          {(vk || ek) && (
            <section className="card card-pad stack small">
              <h2>Grobe Kalkulation</h2>
              <div className="between"><span>VK brutto</span><span className="num">{vk ? formatEuro(vk) : "–"}</span></div>
              <div className="between"><span>VK netto ({Math.round(vat * 100)} % USt)</span><span className="num">{netVk ? formatEuro(netVk) : "–"}</span></div>
              <div className="between"><span>Einkauf netto</span><span className="num">{ek ? formatEuro(-ek) : "–"}</span></div>
              <div className="between"><span>Gebühren ca. 15 %</span><span className="num">{fees ? formatEuro(-fees) : "–"}</span></div>
              <div className="between"><span>Versand/Verpackung pauschal</span><span className="num">{formatEuro(-4.5)}</span></div>
              <div className="between" style={{ borderTop: "1px solid var(--border)", paddingTop: 6, fontWeight: 600 }}><span>Gewinn je Stück ca.</span><span className="num" style={{ color: profit !== null && profit < 0 ? "var(--danger)" : undefined }}>{profit !== null ? formatEuro(profit) : "–"}</span></div>
              <div className="muted">Nur zur Orientierung – genaue Werte nach Einkauf unter Gewinn.</div>
            </section>
          )}

          {i.why && <section className="card card-pad small"><strong>Warum jetzt:</strong> {i.why}</section>}

          <form action={deleteIdeaAction}><input type="hidden" name="id" value={i.id} /><button className="btn-link small" type="submit" style={{ color: "var(--danger)" }}>Idee löschen</button></form>
        </aside>
      </div>
    </>
  );
}
