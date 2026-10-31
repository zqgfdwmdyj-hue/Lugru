import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { ConfirmButton } from "@/components/confirm-button";
import { SubmitButton } from "@/components/submit-button";
import { RES_STATUS_TAG, RES_STATUS_TEXT, steuerFuer } from "@/lib/b2b/logic";
import { kundeSpeichernAction, sperrenAction, ustPruefenAction } from "../actions";
import { KundenFelder } from "../felder";
import { Einladung } from "../einladung";

const MELDUNGEN: Record<string, string> = { angelegt: "Kunde angelegt.", gespeichert: "Gespeichert." };

export default async function B2bKundePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("b2b");
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const t = session.tenantId;
  const K = schema.b2bKunden;
  const [k] = await db.select().from(K).where(and(eq(K.tenantId, t), eq(K.id, id)));
  if (!k) notFound();
  const [zugang] = await db.select().from(schema.b2bZugaenge).where(and(eq(schema.b2bZugaenge.tenantId, t), eq(schema.b2bZugaenge.kundeId, id)));
  const s = await getSettings(t);
  const steuer = steuerFuer({ kundeLand: k.land, ustId: k.ustId, ustGueltig: k.ustGueltig, firmaLand: s.b2b.firma.land || "DE", satz: s.b2b.ustSatz });
  const R = schema.dealReservierungen;
  const D = schema.deals;
  const res = await db
    .select({ r: R, nr: D.nr, titel: D.titel, dealId: D.id })
    .from(R)
    .innerJoin(D, eq(D.id, R.dealId))
    .where(and(eq(R.tenantId, t), eq(R.kundeId, id)))
    .orderBy(desc(R.createdAt))
    .limit(100);
  const meldung = sp.meldung ? (MELDUNGEN[sp.meldung] ?? sp.meldung) : null;
  const fmt = (d: Date | null) => (d ? d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : "–");

  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/b2b/kunden">B2B-Kunden</Link></div><h1>{k.firma}</h1></div>
      </div>
      {meldung && <div className="notice notice-info" data-testid="kunde-meldung">{meldung}</div>}

      <section className="card card-pad stack" style={{ gap: 8 }}>
        <h2>Umsatzsteuer</h2>
        <div className="small" data-testid="ust-status">
          {k.ustId ? <>USt-IdNr. <b className="num">{k.ustId}</b> – {k.ustGueltig === true ? <span className="tag tag-ok">gültig</span> : k.ustGueltig === false ? <span className="tag tag-danger">ungültig</span> : <span className="tag tag-warn">ungeprüft</span>}{k.ustGeprueftAm ? ` · geprüft ${fmt(k.ustGeprueftAm)}` : ""}{k.ustPruefKennung ? ` · Kennung ${k.ustPruefKennung}` : ""}</> : "Keine USt-IdNr."}
          {k.ustPruefName ? <div className="muted">VIES: {k.ustPruefName}</div> : null}
        </div>
        <div className="small">Rechnungen an diesen Kunden: <b>{steuer.art === "reverse_charge" ? "ohne USt (Reverse Charge)" : `mit ${Math.round(steuer.satz * 100)} % USt`}</b>{steuer.hinweis ? <div className="muted">{steuer.hinweis}</div> : null}</div>
        {k.ustId && (
          <form action={ustPruefenAction}><input type="hidden" name="id" value={k.id} /><SubmitButton className="btn" label="Bei VIES prüfen" pendingLabel="Prüfe …" testId="ust-pruefen" /></form>
        )}
      </section>

      <section className="card card-pad stack" style={{ gap: 8 }}>
        <h2>Kundenportal</h2>
        <div className="small" data-testid="zugang-status">
          {!zugang ? "Noch kein Zugang." : zugang.gesperrt ? <span className="tag tag-danger">gesperrt</span> : zugang.passwortHash ? <>Aktiv · letzte Anmeldung {fmt(zugang.letzterLogin)}</> : zugang.einladungBis && zugang.einladungBis > new Date() ? <>Eingeladen, Link gültig bis {fmt(zugang.einladungBis)}</> : "Einladung abgelaufen."}
        </div>
        {k.aktiv && !zugang?.gesperrt && <Einladung id={k.id} email={k.email} schonAktiv={!!zugang?.passwortHash} />}
        {zugang && (
          <form action={sperrenAction}>
            <input type="hidden" name="id" value={k.id} />
            <input type="hidden" name="gesperrt" value={zugang.gesperrt ? "0" : "1"} />
            {zugang.gesperrt ? <button className="btn btn-small" type="submit">Zugang wieder freigeben</button> : <ConfirmButton confirm="Portal-Zugang sperren? Der Kunde wird sofort abgemeldet.">Zugang sperren</ConfirmButton>}
          </form>
        )}
      </section>

      <section className="card" style={{ overflow: "auto" }}>
        <div className="card-head"><h2>Reservierungen</h2></div>
        <table className="table">
          <thead><tr><th>Deal</th><th className="right">Menge</th><th className="right">Preis</th><th>Status</th><th>Rechnung</th></tr></thead>
          <tbody>
            {res.length === 0 && <tr><td colSpan={5} className="muted">Keine.</td></tr>}
            {res.map(({ r, nr, titel, dealId }) => (
              <tr key={r.id}>
                <td><Link href={`/b2b/${dealId}`}>#{nr}</Link> <span className="small">{titel}</span></td>
                <td className="num right">{r.menge}{r.zugeteilt !== null && r.zugeteilt !== r.menge ? ` → ${r.zugeteilt}` : ""}</td>
                <td className="num right">{formatEuro(r.preisNetto)}</td>
                <td><span className={`tag ${RES_STATUS_TAG[r.status]}`}>{RES_STATUS_TEXT[r.status]}</span></td>
                <td className="small num">{r.rechnungNr ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card card-pad">
        <h2>Stammdaten</h2>
        <form action={kundeSpeichernAction} className="stack" style={{ gap: 12, marginTop: 10 }}>
          <input type="hidden" name="id" value={k.id} />
          <KundenFelder k={k} />
          <label className="check small"><input type="checkbox" name="aktiv" defaultChecked={k.aktiv} /> Aktiv (inaktiv = Portal gesperrt, keine Abo-Mails)</label>
          <div className="small muted">Neue USt-IdNr. oder neues Land → Prüfung erneut nötig.</div>
          <div><SubmitButton label="Speichern" pendingLabel="Speichere …" testId="kunde-speichern" /></div>
        </form>
      </section>
    </>
  );
}
