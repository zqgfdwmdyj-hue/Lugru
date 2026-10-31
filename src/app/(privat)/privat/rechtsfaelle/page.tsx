import { todayIso } from "@/lib/dates";
import { requirePrivate } from "@/lib/private/service";
import { faelleListe, rechtsfristen } from "@/lib/recht/service";
import { FallListe } from "@/app/(app)/rechtsfaelle/ansicht";
import { fallAnlegenAction } from "@/app/(app)/rechtsfaelle/actions";
import { PrivatHead } from "../ui";

// Private Rechtsfälle (B14) – nur Privatbereich mit vollem Umfang. Neue Anwalts-Mails ohne Fall landen hier
// als „bitte zuordnen“ (sicherer Standard), bis Ludwig sie geschäftlich oder privat einordnet.

export default async function PrivatRechtsfaellePage({ searchParams }: { searchParams: Promise<{ meldung?: string; alle?: string }> }) {
  const session = await requirePrivate({ full: true });
  const sp = await searchParams;
  const heute = todayIso();
  const [faelle, fristen] = await Promise.all([faelleListe(session.tenantId, "privat", { mitAbgeschlossenen: sp.alle === "1" }), rechtsfristen(session.tenantId, heute, 14)]);
  const privat = fristen.filter((f) => f.bereich === "privat");
  const zuordnen = faelle.filter((f) => f.status === "zuordnen").length;
  return (
    <>
      <PrivatHead active="rechtsfaelle" title="Rechtsfälle (privat)" />
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}
      {zuordnen > 0 && <div className="notice notice-info small" style={{ marginBottom: 12 }} data-testid="recht-zuordnen">{zuordnen} Mail{zuordnen === 1 ? "" : "s"} vom Anwalt ohne bekannten Fall – bitte öffnen und zuordnen (privat oder geschäftlich).</div>}
      <section className="card card-pad" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>Fristen in 14 Tagen</h2>
        {privat.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Keine.</p> : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {privat.map((f) => <li key={`${f.fallId}${f.tag}`}><a href={`/privat/rechtsfaelle/${f.fallId}`}>{f.tag.slice(8, 10)}.{f.tag.slice(5, 7)}. – {f.titel}</a></li>)}
          </ul>
        )}
      </section>
      <section className="card card-pad" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>Fälle</h2>
        <FallListe faelle={faelle} basis="/privat/rechtsfaelle" heute={heute} />
      </section>
      <section className="card card-pad">
        <h2 style={{ marginTop: 0 }}>Fall von Hand anlegen</h2>
        <form action={fallAnlegenAction} className="stack" style={{ gap: 8 }}>
          <input type="hidden" name="bereich" value="privat" />
          <div className="field"><label className="label" htmlFor="rp-titel">Titel</label><input className="input" id="rp-titel" name="titel" required maxLength={300} /></div>
          <div className="field"><label className="label" htmlFor="rp-az">Aktenzeichen</label><input className="input" id="rp-az" name="aktenzeichen" maxLength={60} /></div>
          <div><button className="btn" type="submit">Anlegen</button></div>
        </form>
      </section>
    </>
  );
}
