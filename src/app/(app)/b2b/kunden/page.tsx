import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { Disclosure } from "@/components/disclosure";
import { SubmitButton } from "@/components/submit-button";
import { kundeAnlegenAction } from "./actions";
import { KundenFelder } from "./felder";

export default async function B2bKundenPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("b2b");
  const sp = await searchParams;
  const K = schema.b2bKunden;
  const Z = schema.b2bZugaenge;
  const kunden = await db
    .select({
      id: K.id,
      firma: K.firma,
      land: K.land,
      ustId: K.ustId,
      ustGueltig: K.ustGueltig,
      zahlungsart: K.zahlungsart,
      aktiv: K.aktiv,
      passwort: sql<boolean>`${Z.passwortHash} is not null`,
      eingeladen: Z.einladungBis,
      gesperrt: Z.gesperrt,
      letzterLogin: Z.letzterLogin,
      reservierungen: sql<number>`(select count(*) from deal_reservierungen r where r.kunde_id = ${K.id} and r.status not in ('storniert','erstattet'))::int`,
    })
    .from(K)
    .leftJoin(Z, eq(Z.kundeId, K.id))
    .where(eq(K.tenantId, session.tenantId))
    .orderBy(asc(K.firma));
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/b2b">B2B-Deals</Link></div><h1>B2B-Kunden</h1></div>
      </div>
      {sp.meldung && <div className="notice notice-warn">{sp.meldung}</div>}
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table" data-testid="kunden-liste">
          <thead><tr><th>Firma</th><th>Land</th><th>USt-IdNr.</th><th>Zahlung</th><th>Portal</th><th className="right">Reservierungen</th></tr></thead>
          <tbody>
            {kunden.length === 0 && <tr><td colSpan={6} className="muted">Noch keine B2B-Kunden.</td></tr>}
            {kunden.map((k) => (
              <tr key={k.id} style={{ opacity: k.aktiv ? 1 : 0.55 }}>
                <td><Link href={`/b2b/kunden/${k.id}`}>{k.firma}</Link>{!k.aktiv && <span className="tag tag-neutral" style={{ marginLeft: 6 }}>inaktiv</span>}</td>
                <td>{k.land}</td>
                <td className="num small">{k.ustId ?? "–"} {k.ustId ? (k.ustGueltig === true ? <span className="tag tag-ok">gültig</span> : k.ustGueltig === false ? <span className="tag tag-danger">ungültig</span> : <span className="tag tag-warn">ungeprüft</span>) : null}</td>
                <td className="small">{k.zahlungsart === "vorkasse" ? "Vorkasse" : "Rechnung"}</td>
                <td className="small">{k.gesperrt ? <span className="tag tag-danger">gesperrt</span> : k.passwort ? <span className="tag tag-ok">aktiv</span> : k.eingeladen && k.eingeladen > new Date() ? <span className="tag tag-info">eingeladen</span> : <span className="muted">–</span>}</td>
                <td className="num right">{k.reservierungen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card card-pad">
        <Disclosure summary="Kunde anlegen" defaultOpen={kunden.length === 0}>
          <form action={kundeAnlegenAction} className="stack" style={{ gap: 12, marginTop: 10 }}>
            <KundenFelder />
            <div><SubmitButton label="Anlegen" pendingLabel="Lege an …" testId="kunde-anlegen" /></div>
          </form>
        </Disclosure>
      </section>
      <div className="small muted">Kunden sehen im Portal nur Deals und ihre eigenen Reservierungen und Rechnungen. Reverse Charge nur mit per VIES geprüfter USt-IdNr. aus einem anderen EU-Land.</div>
    </>
  );
}
