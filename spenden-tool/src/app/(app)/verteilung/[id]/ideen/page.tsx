import Link from "next/link";
import { isDrink, packText, publicText, stripInternalDeep } from "@/lib/price-logic";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireLogin } from "@/lib/auth";
import { collagePrice, eventDateLabel, isPlaceholderName } from "@/lib/layout";
import { formatEuro } from "@/lib/numbers";
import { loadEvent, loadEventItems } from "@/lib/service";
import { aiConfigured } from "@/lib/price-research";
import { IDEA_MODES, ideasCostUsd, matchProducts, themeSuggestions } from "@/lib/ideas";
import { createIdeas, deleteIdeas } from "@/app/(app)/actions";
import { CopyButton } from "@/components/copy-button";
import { IdeasForm } from "./ideas-form";
import { type PosterGroup, PosterStudio, type PosterTile } from "./poster";
import type { IdeaPoster } from "@/db/schema";

const when = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const usd = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")} US-Cent`;

export default async function IdeenPage({ params }: { params: Promise<{ id: string }> }) {
  await requireLogin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const event = await loadEvent(id);
  if (!event) notFound();
  const [rows, ideas] = await Promise.all([
    loadEventItems(id),
    db.select().from(schema.eventIdeas).where(eq(schema.eventIdeas.eventId, id)).orderBy(desc(schema.eventIdeas.createdAt)),
  ]);
  const items = rows
    .filter((r) => !isPlaceholderName(r.product.name))
    .map((r) => ({ name: publicText(r.product.name), variant: r.product.variant ? publicText(r.product.variant) || null : null, price: r.item.price, priceNote: r.item.priceNote, packNote: r.item.packPrice != null ? packText(r.item, isDrink(r.product), r.product.variant) : null, packPrice: r.item.packPrice, image: r.product.imageFileId ? `/datei/${r.product.imageFileId}` : null }));
  // Plakat: Produktnamen der KI den Produkten (Foto, Spendenempfehlungen) zuordnen
  const posterData = (poster: IdeaPoster) => {
    const tiles: PosterTile[] = matchProducts(poster.hervorgehoben, items)
      .filter((m) => m.item)
      .slice(0, 9)
      .map(({ item }) => ({
        name: [item!.name, item!.variant].filter(Boolean).join(" "),
        image: item!.image,
        single: item!.price != null ? `${item!.priceNote ? `${item!.priceNote} ` : ""}${formatEuro(item!.price)}` : "",
        pack: item!.packPrice != null ? formatEuro(item!.packPrice) : null,
        packLabel: item!.packNote ?? null,
      }));
    const groups: PosterGroup[] = poster.gruppen.slice(0, 3).map((g) => ({
      titel: g.titel,
      text: g.text,
      images: matchProducts(g.produkte, items).map((m) => m.item?.image).filter((u): u is string => !!u).slice(0, 3),
    }));
    return { tiles, groups };
  };
  const month = Number(event.eventDate.slice(5, 7));
  const unnamed = rows.length - items.length;

  return (
    <>
      <div><h2>Ideen</h2><div className="small muted">{items.length} Produkte · Themenpakete, Rezepte und Werbetext von der KI · <Link href={`/verteilung/${id}/ausgabe`}>andere Ausgabe wählen</Link></div></div>
      {unnamed > 0 && <div className="notice notice-warn">{unnamed} Produkt(e) haben noch keinen Namen und werden nicht berücksichtigt.</div>}
      {aiConfigured() ? (
        <IdeasForm action={createIdeas.bind(null, id)} themes={themeSuggestions(month)} cost="3–5 Cent" modes={Object.entries(IDEA_MODES).map(([key, m]) => ({ key, label: m.label, hint: m.hint }))} />
      ) : (
        <div className="card card-pad muted">Die KI ist aus – dafür auf dem Server <code>ANTHROPIC_API_KEY</code> setzen (siehe README).</div>
      )}

      {ideas.map((idea) => {
        // Anzeige und Kopieren ohne Recherche-Anmerkungen („Marke nicht identifiziert“); gespeichert bleibt das Original.
        const r = stripInternalDeep(idea.result);
        return (
          <section key={idea.id} className="card card-pad stack idea-card" style={{ gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: 0 }}>{r.titel}</h2>
                <div className="small muted">{idea.request} · {when(idea.createdAt)}{idea.userName ? ` · ${idea.userName}` : ""} · ca. {usd(ideasCostUsd(idea.inputTokens, idea.outputTokens))}</div>
              </div>
              <form action={deleteIdeas.bind(null, idea.id, id)}><button className="btn btn-small" type="submit" title="Diese Ideen löschen">Löschen</button></form>
            </div>
            {r.einleitung && <p style={{ margin: 0 }}>{r.einleitung}</p>}

            {r.plakat && (() => {
              const d = posterData(r.plakat);
              return (
                <details open={idea.id === ideas[0].id}>
                  <summary className="idea-h" style={{ cursor: "pointer" }}>🖼️ Plakat zum Aushängen und Teilen</summary>
                  <div style={{ marginTop: 8 }}>
                    {d.tiles.length === 0 ? <div className="small muted">Die vorgeschlagenen Produkte wurden in der Verteilung nicht gefunden.</div> : <PosterStudio poster={r.plakat} tiles={d.tiles} groups={d.groups} fileBase={`spenden-${event.eventDate}`} />}
                  </div>
                </details>
              );
            })()}

            {r.pakete.length > 0 && (
              <div>
                <h3 className="idea-h">📦 Pakete</h3>
                <div className="idea-grid">
                  {r.pakete.map((p, i) => {
                    const matched = matchProducts(p.produkte, items);
                    const sum = matched.reduce((n, m) => n + (m.item?.price ?? 0), 0);
                    const complete = matched.every((m) => m.item?.price != null);
                    return (
                      <div key={i} className="idea-box">
                        <strong>{p.name}</strong>
                        {p.beschreibung && <div className="small">{p.beschreibung}</div>}
                        <ul className="small" style={{ margin: "6px 0", paddingLeft: 18 }}>
                          {matched.map((m, j) => <li key={j}>{m.label}{m.item?.price != null ? ` – ${collagePrice(m.item.price)}` : ""}</li>)}
                        </ul>
                        {sum > 0 && <div className="small"><strong>Zusammen {complete ? "" : "mind. "}{formatEuro(sum)}</strong> (Summe der Spendenpreise)</div>}
                        <CopyButton text={`${p.name}\n${p.beschreibung}\n${matched.map((m) => `• ${m.label}${m.item?.price != null ? ` ${collagePrice(m.item.price)}` : ""}`).join("\n")}${sum > 0 ? `\nZusammen ${formatEuro(sum)}` : ""}`} label="Kopieren" />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {r.rezepte.length > 0 && (
              <div>
                <h3 className="idea-h">🍲 Rezepte</h3>
                <div className="idea-grid">
                  {r.rezepte.map((rz, i) => (
                    <div key={i} className="idea-box">
                      <strong>{rz.name}</strong>{rz.dauer ? <span className="small muted"> · {rz.dauer}</span> : null}
                      <div className="small" style={{ marginTop: 4 }}><strong>Aus der Verteilung:</strong> {rz.aus_der_verteilung.join(", ")}</div>
                      {rz.zusaetzlich.length > 0 && <div className="small muted">Dazu: {rz.zusaetzlich.join(", ")}</div>}
                      <div className="small" style={{ marginTop: 6 }}>{rz.anleitung}</div>
                      <div style={{ marginTop: 6 }}><CopyButton text={`${rz.name}${rz.dauer ? ` (${rz.dauer})` : ""}\nAus der Verteilung: ${rz.aus_der_verteilung.join(", ")}${rz.zusaetzlich.length ? `\nDazu: ${rz.zusaetzlich.join(", ")}` : ""}\n\n${rz.anleitung}`} label="Rezept kopieren" /></div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(r.verwendung?.length ?? 0) > 0 && (() => {
              const list = r.verwendung!;
              const matched = matchProducts(list.map((v) => v.produkt), items);
              const all = list.map((v) => `${v.produkt}:\n${v.ideen.map((x) => `• ${x}`).join("\n")}`).join("\n\n");
              return (
                <div>
                  <h3 className="idea-h">💡 Wofür kann man das verwenden?</h3>
                  <div className="idea-grid">
                    {list.map((v, i) => (
                      <div key={i} className="idea-box" style={{ display: "flex", gap: 10 }}>
                        {matched[i]?.item?.image && <img src={`${matched[i].item!.image}?w=200`} alt="" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} loading="lazy" />}
                        <div style={{ minWidth: 0 }}>
                          <strong>{v.produkt}</strong>
                          <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{v.ideen.map((x, j) => <li key={j}>{x}</li>)}</ul>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 8 }}><CopyButton text={all} label="Alle Verwendungs-Ideen kopieren" /></div>
                </div>
              );
            })()}

            {r.aktionstext && (
              <div>
                <h3 className="idea-h">📣 Werbetext</h3>
                <pre className="small" style={{ whiteSpace: "pre-wrap", margin: "0 0 6px", fontFamily: "var(--sans)", background: "var(--surface-2)", padding: 12, borderRadius: 8 }}>{r.aktionstext}</pre>
                <CopyButton text={r.aktionstext} label="Text kopieren" />
              </div>
            )}

            {r.tipps.length > 0 && (
              <div>
                <h3 className="idea-h">💡 Tipps fürs Team</h3>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.tipps.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            )}
          </section>
        );
      })}
      {ideas.length === 0 && <div className="small muted">Noch keine Ideen für diese Verteilung.</div>}
    </>
  );
}
