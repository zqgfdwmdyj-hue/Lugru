import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { CLAIM_STATUS_LABEL } from "@/lib/claims/labels";
import { addDaysIso, todayIso } from "@/lib/dates";
import { formatDate, formatEuro } from "@/lib/numbers";
import { retourenFaelle } from "@/lib/retouren-station/fall";
import { BEFUND_KURZ, ENTSCHEIDUNG_TEXT } from "@/lib/retouren-station/logic";

const ANSICHTEN = [
  ["fall_bereit", "Fälle bereit, nicht eingereicht"],
  ["eingereicht", "Eingereicht"],
  ["abgeschlossen", "Abgeschlossen"],
  ["pakete", "Pakete"],
] as const;

export default async function PruefungenPage({ searchParams }: { searchParams: Promise<{ ansicht?: string; q?: string }> }) {
  const session = await requireArea("amazon");
  const sp = await searchParams;
  const ansicht = ANSICHTEN.find(([k]) => k === sp.ansicht)?.[0] ?? "fall_bereit";
  const t = session.tenantId;
  const heute = todayIso();
  const in7 = addDaysIso(heute, 7);
  const P = schema.retourenPruefungen;
  const faelle = ansicht === "pakete" ? [] : await retourenFaelle(t, { status: ansicht, suche: sp.q ?? null });
  const pakete =
    ansicht === "pakete"
      ? await db
          .select({ id: P.id, am: P.angelegtAm, status: P.status, remission: P.remissionId, versender: P.versender, zusammenfassung: P.zusammenfassung, artikel: sql<number>`(select count(*)::int from retouren_positionen x where x.pruefung_id = ${P.id})` })
          .from(P)
          .where(eq(P.tenantId, t))
          .orderBy(desc(P.angelegtAm))
          .limit(200)
      : [];
  const [summe] = await db
    .select({ n: sql<number>`count(*)::int`, betrag: sql<number>`coalesce(sum(coalesce(c.expected_amount, x.erstattet_betrag)), 0)::float`, bald: sql<number>`count(*) filter (where c.deadline <= ${in7}::date)::int` })
    .from(sql`retouren_positionen x left join claims c on c.id = x.anspruch_id`)
    .where(sql`x.tenant_id = ${t} and x.entscheidung = 'fall' and (c.status is null or c.status in ('detected','queued'))`);

  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/remissionen">Remissionen</Link></div><h1>Retouren-Prüfungen & Fälle</h1></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Link className="btn btn-primary" href="/remissionen/station" data-testid="station-oeffnen">Retouren-Station öffnen</Link>
        </div>
      </div>
      <div className="small" data-testid="faelle-summe">
        Offene Fälle: <b>{summe.n}</b> · {formatEuro(summe.betrag)}{summe.bald ? <> · <span style={{ color: "var(--danger)" }}>{summe.bald} mit Frist in 7 Tagen</span></> : null}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {ANSICHTEN.map(([k, l]) => <Link key={k} className={`chip${ansicht === k ? " active" : ""}`} aria-current={ansicht === k ? "true" : undefined} href={`/remissionen/pruefungen?ansicht=${k}`}>{l}</Link>)}
      </div>

      {ansicht === "pakete" ? (
        <section className="card" style={{ overflow: "auto" }}>
          <table className="table">
            <thead><tr><th>Datum</th><th>Remission</th><th>Versender</th><th className="right">Artikel</th><th>Ergebnis</th><th>Status</th></tr></thead>
            <tbody>
              {pakete.length === 0 && <tr><td colSpan={6} className="muted">Noch keine Pakete geprüft – die Retouren-Station öffnen.</td></tr>}
              {pakete.map((x) => (
                <tr key={x.id}>
                  <td className="num"><Link href={`/remissionen/pruefungen/${x.id}`}>{x.am.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}</Link></td>
                  <td className="num">{x.remission ?? "–"}</td>
                  <td>{x.versender ?? "–"}</td>
                  <td className="num right">{x.artikel}</td>
                  <td className="small">{x.zusammenfassung ?? "–"}</td>
                  <td>{x.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="card" style={{ overflow: "auto" }}>
          <div className="card-head">
            <h2>{ANSICHTEN.find(([k]) => k === ansicht)?.[1]}</h2>
            <form method="get" style={{ display: "flex", gap: 6 }}>
              <input type="hidden" name="ansicht" value={ansicht} />
              <label className="sr-only" htmlFor="q">Suche</label>
              <input className="input" id="q" name="q" defaultValue={sp.q ?? ""} placeholder="LPN, Bestellung, SKU" style={{ width: 200 }} />
              <button className="btn btn-small" type="submit">Suchen</button>
            </form>
          </div>
          <table className="table" data-testid="faelle-liste">
            <thead><tr><th>Frist</th><th>Artikel</th><th>LPN / Bestellung</th><th>Befund</th><th className="right">Betrag</th><th>Status</th></tr></thead>
            <tbody>
              {faelle.length === 0 && <tr><td colSpan={6} className="muted">Keine Einträge.</td></tr>}
              {faelle.map((f) => {
                const st = f.status ? (CLAIM_STATUS_LABEL[f.status] ?? [f.status, "tag-neutral"]) : null;
                const bald = f.frist && f.frist <= in7;
                return (
                  <tr key={f.positionId}>
                    <td className="num" style={{ color: bald ? "var(--danger)" : undefined }}>{formatDate(f.frist)}</td>
                    <td style={{ maxWidth: 300 }}><Link href={`/remissionen/pruefungen/fall/${f.positionId}`}>{f.titel ?? "Artikel"}</Link>{f.ki_abweichung && <span className="tag tag-warn" style={{ marginLeft: 6 }}>KI weicht ab</span>}</td>
                    <td className="num small">{f.lpn ?? "–"}<div className="muted">{f.bestellnummer ?? ""}</div></td>
                    <td>{f.befund ? BEFUND_KURZ[f.befund as keyof typeof BEFUND_KURZ] : "–"}<div className="small muted">{f.entscheidung ? ENTSCHEIDUNG_TEXT[f.entscheidung as keyof typeof ENTSCHEIDUNG_TEXT] : ""}</div></td>
                    <td className="num right">{formatEuro(f.betrag)}</td>
                    <td>{st ? <span className={`tag ${st[1]}`}>{st[0]}</span> : <span className="small muted">kommt nach „Fertig“</span>}{f.fallnummer ? <div className="small num">{f.fallnummer}</div> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      <div className="small muted">Fälle werden nur vorgeschlagen, wenn der Befund nicht OK ist, der Kunde mindestens die Schwelle erstattet bekam (Einstellungen → Retouren-Station) und Amazon noch nichts gezahlt hat. Eingereicht wird in Seller Central – einen Fall automatisch eröffnen erlaubt Amazon nicht.</div>
    </>
  );
}
