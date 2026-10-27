import Link from "next/link";
import { and, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { occasionByKey, upcomingOccasions } from "@/lib/brands/occasions";
import { visibleBrands } from "@/lib/brands/access";
import { todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { formatDate, formatEuro } from "@/lib/numbers";
import { createIdeaAction } from "./actions";
import { SuggestIdeas } from "./forms";
import { BoxSuggest } from "../lieferanten/[id]/scan-form";
import { getSettings } from "@/lib/settings";
import { ideaDateKind, ideaPhase, ideaUnaccepted, isOverdue, PHASE_LABEL, PHASES, phaseOrder } from "@/lib/brands/phases";

const COLUMNS = ["idea", "review", "planned", "in_progress", "live"] as const;

export default async function MarkenPage({ searchParams }: { searchParams: Promise<{ marke?: string; anlass?: string; verworfen?: string }> }) {
  const session = await requireArea("marken");
  const sp = await searchParams;
  const t = session.tenantId;
  const brands = await visibleBrands(session);
  const brand = brands.find((b) => b.id === sp.marke) ?? null;
  const today = todayIso();
  const I = schema.ideas;
  const where: SQL[] = [eq(I.tenantId, t), inArray(I.brandId, brands.length ? brands.map((b) => b.id) : ["00000000-0000-0000-0000-000000000000"])];
  if (brand) where.push(eq(I.brandId, brand.id));
  if (sp.anlass) where.push(eq(I.occasion, sp.anlass));
  where.push(inArray(I.status, sp.verworfen ? ["rejected"] : [...COLUMNS]));
  const [ideas, ai, offerCount, settings] = await Promise.all([
    db.select().from(I).where(and(...where)).orderBy(desc(I.updatedAt)).limit(400),
    getIntegration(t, "anthropic"),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.supplierOffers).where(and(eq(schema.supplierOffers.tenantId, t), isNotNull(schema.supplierOffers.price))).then((r) => r[0]?.n ?? 0),
    getSettings(t),
  ]);
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const shown = brand ? [brand] : brands;
  const href = (p: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ marke: brand?.id, anlass: sp.anlass, ...p })) if (v) q.set(k, v);
    return `/marken${q.size ? `?${q}` : ""}`;
  };

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Marken & Content</div><h1>Ideen & Saison</h1></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn" href="/marken/content">Content-Plan</Link>
          <Link className="btn" href="/marken/profile">Markenprofile</Link>
        </div>
      </div>
      {!ai?.apiKey && (
        <div className="notice notice-info small">
          Für automatische Ideen und Video-Skripte unter <Link href="/anbindungen?p=anthropic#anthropic">Anbindungen → KI (Claude)</Link> einen Schlüssel eintragen. Ohne Schlüssel funktionieren Saisonplaner, Board und Checklisten trotzdem.
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link href={href({ marke: undefined })} className={`chip${!brand ? " active" : ""}`}>Alle Marken</Link>
        {brands.map((b) => (
          <Link key={b.id} href={href({ marke: b.id })} className={`chip${brand?.id === b.id ? " active" : ""}`}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: b.color ?? "var(--accent)", marginRight: 6 }} />
            {b.name}
          </Link>
        ))}
        {sp.anlass && <Link href={href({ anlass: undefined })} className="chip active">Anlass: {occasionByKey(sp.anlass)?.name ?? sp.anlass} ✕</Link>}
      </div>

      {/* Projekte nach Phasen – eigene vor KI-Vorschlägen, Überfälliges zuerst */}
        <div className="stack" data-testid="idea-board">
          <div className="between">
            <h2>{sp.verworfen ? "Verworfene Ideen" : "Projekte"}</h2>
            <Link className="small" href={href({ verworfen: sp.verworfen ? undefined : "1" })}>{sp.verworfen ? "← zurück zu den Projekten" : "Verworfene anzeigen"}</Link>
          </div>
          <div className="idea-board">
            {(sp.verworfen ? [null] : PHASES).map((phase) => {
              const list = phaseOrder(
                ideas.filter((i) => (phase ? i.status !== "rejected" && ideaPhase(i.status) === phase : i.status === "rejected")).map((i) => ({ ...i, date: i.launchDate, done: i.status === "live" || ideaUnaccepted(i.status) })),
                today,
              );
              return (
                <div key={phase ?? "rejected"} className="idea-col" data-testid={`phase-${phase ?? "verworfen"}`}>
                  <div className="idea-col-head">{phase ? PHASE_LABEL[phase] : "Verworfen"} <span className="muted">{list.length}</span></div>
                  {list.map((i) => {
                    const b = brandById.get(i.brandId);
                    const margin = i.targetPrice && i.costEstimate ? Number(i.targetPrice) - Number(i.costEstimate) : null;
                    const done = i.checklist.filter((c) => c.done).length;
                    const late = isOverdue(i.launchDate, i.status === "live" || ideaUnaccepted(i.status), today);
                    return (
                      <Link key={i.id} href={`/marken/ideen/${i.id}`} className="idea-card" data-testid="idea-card">
                        <div className="small muted">
                          {b && <span className="brand-dot" style={{ background: b.color ?? "var(--area)" }} aria-hidden="true" />}{b?.name}{i.occasion ? ` · ${occasionByKey(i.occasion)?.name ?? i.occasion}` : ""}
                          {i.status === "review" && <span className="tag tag-warn" style={{ marginLeft: 6 }}>prüfen</span>}
                          {i.source === "ai" && <span className="tag tag-neutral" style={{ marginLeft: 6 }}>KI-Vorschlag</span>}
                          {late && <span className="tag tag-danger" style={{ marginLeft: 6 }} data-testid="idea-overdue">überfällig</span>}
                        </div>
                        <div style={{ fontWeight: 600 }}>{i.title}</div>
                        {i.concept && <div className="small" style={{ color: "var(--ink-2)" }}>{i.concept.slice(0, 140)}{i.concept.length > 140 ? " …" : ""}</div>}
                        <div className="small muted">
                          {i.targetPrice ? `VK ${formatEuro(Number(i.targetPrice))}` : ""}{margin !== null ? ` · Marge ca. ${formatEuro(margin)}` : ""}
                          {i.checklist.length && ["planned", "in_progress"].includes(i.status) ? ` · ${done}/${i.checklist.length} erledigt` : ""}
                          {i.launchDate ? <span style={{ color: late ? "var(--danger)" : undefined }} data-kind={ideaDateKind(i.status)}> · {ideaDateKind(i.status) === "termin" ? `Launch ${formatDate(i.launchDate)}` : `Wunsch-Launch ${formatDate(i.launchDate)} (unverbindlich)`}</span> : ""}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

      {/* Saisonplaner */}
      <section className="card card-pad stack">
        <h2>Anstehende Anlässe</h2>
        <div className="season-grid">
          {shown.flatMap((b) =>
            upcomingOccasions(today, b.occasions, 366)
              .filter((u, n, all) => brand || u.planning || all.filter((x) => !x.planning).indexOf(u) < 3)
              .map((u) => {
              const count = ideas.filter((i) => i.brandId === b.id && i.occasion === u.key).length;
              return (
                <div key={`${b.id}-${u.key}`} className="season-card" style={{ borderTopColor: b.color ?? "var(--accent)" }}>
                  <div className="between small"><strong>{b.name}</strong><span className={u.planning ? "tag tag-warn" : "tag tag-neutral"}>{u.planning ? "jetzt planen" : `ab ${formatDate(u.planFrom)}`}</span></div>
                  <div style={{ fontSize: 17, fontWeight: 600 }}>{u.name}</div>
                  <div className="small muted">{formatDate(u.date)} · noch {u.daysLeft} Tage{u.hint ? ` · ${u.hint}` : ""}</div>
                  <Link className="small" href={href({ marke: b.id, anlass: u.key })}>{count ? `${count} Idee${count === 1 ? "" : "n"} ansehen` : "noch keine Ideen"}</Link>
                  {ai?.apiKey && <SuggestIdeas brandId={b.id} occasion={u.key} label="KI-Ideen" />}
                </div>
              );
            }),
          )}
        </div>
      </section>

      <div className="brand-forms">
          <section className="card card-pad stack">
            <h2>Neue Idee</h2>
            <form action={createIdeaAction} className="stack" style={{ gap: 8 }}>
              <select className="input" name="brandId" defaultValue={brand?.id ?? brands[0]?.id} aria-label="Marke">
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <input className="input" name="title" required placeholder="z. B. Mystery-Box „Gruselnacht“" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <select className="input" name="kind" defaultValue="box" aria-label="Art">
                  <option value="box">Box / Set</option>
                  <option value="product">Produkt</option>
                  <option value="other">Sonstiges</option>
                </select>
                <select className="input" name="occasion" defaultValue={sp.anlass ?? ""} aria-label="Anlass">
                  <option value="">ganzjährig</option>
                  {upcomingOccasions(today).map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                </select>
              </div>
              <div><button className="btn btn-primary btn-small" type="submit">Anlegen</button></div>
            </form>
          </section>
          {offerCount > 0 && (
            <BoxSuggest
              feedId={null}
              offerCount={offerCount}
              brands={(brand ? [brand, ...brands.filter((x) => x.id !== brand.id)] : brands).map((x) => ({ id: x.id, name: x.name }))}
              occasions={upcomingOccasions(today).map((o) => ({ key: o.key, name: o.name }))}
              hasAi={Boolean(ai?.apiKey)}
              defaultFba={settings.pricing.defaultFbaFee + 1.5}
            />
          )}
          {ai?.apiKey && (
            <details className="card card-pad stack">
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>KI: Ideen auf Zuruf</summary>
              <div className="small muted">Ohne festen Anlass – z. B. neue Box-Themen, Trend-Produkte oder Zubehör für ein geplantes Video.</div>
              {shown.map((b) => (
                <div key={b.id} className="stack" style={{ gap: 4 }}>
                  <strong className="small">{b.name}</strong>
                  <SuggestIdeas brandId={b.id} withWish label={`KI: Ideen für ${b.name}`} />
                </div>
              ))}
            </details>
          )}
      </div>

    </>
  );
}
