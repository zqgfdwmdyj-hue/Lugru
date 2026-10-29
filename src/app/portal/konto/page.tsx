import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePortal } from "@/lib/b2b/portal-auth";
import { aboAction } from "../actions";
import { PasswortFormular } from "../formulare";

export default async function PortalKontoPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const s = await requirePortal();
  const sp = await searchParams;
  const K = schema.b2bKunden;
  const [k] = await db.select({ firma: K.firma, ansprechpartner: K.ansprechpartner, email: K.email, land: K.land, ustId: K.ustId, ustGueltig: K.ustGueltig, abo: K.abo }).from(K).where(and(eq(K.tenantId, s.tenantId), eq(K.id, s.kundeId)));
  const abo = k?.abo ?? { alle: true };
  const aus = abo.alle === false && !(abo.marken?.length || abo.kategorien?.length);
  return (
    <>
      <h1 style={{ margin: 0 }}>Mein Konto</h1>
      {sp.meldung === "abo" && <div className="notice notice-ok" data-testid="abo-gespeichert">Benachrichtigungen gespeichert.</div>}
      <section className="card card-pad stack" style={{ gap: 6 }}>
        <h2>Firma</h2>
        <div className="small">{k?.firma}{k?.ansprechpartner ? ` · ${k.ansprechpartner}` : ""}</div>
        <div className="small">{k?.email} · {k?.land}{k?.ustId ? ` · USt-IdNr. ${k.ustId} ${k.ustGueltig ? "(geprüft)" : "(noch nicht geprüft)"}` : ""}</div>
        <div className="small muted">Änderungen an Firma, Adresse oder USt-IdNr. bitte per Mail mitteilen.</div>
      </section>
      <section className="card card-pad stack" style={{ gap: 10 }}>
        <h2>Benachrichtigung bei neuen Deals</h2>
        <form action={aboAction} className="stack" style={{ gap: 8 }}>
          <label className="check small"><input type="checkbox" name="alle" defaultChecked={abo.alle !== false} /> Über alle neuen Deals per Mail informieren</label>
          <div className="field"><label className="label" htmlFor="marken">… sonst nur diese Marken (Komma)</label><input className="input" id="marken" name="marken" defaultValue={(abo.marken ?? []).join(", ")} style={{ maxWidth: 420 }} /></div>
          <div className="field"><label className="label" htmlFor="kategorien">… oder Kategorien (Komma)</label><input className="input" id="kategorien" name="kategorien" defaultValue={(abo.kategorien ?? []).join(", ")} style={{ maxWidth: 420 }} /></div>
          <label className="check small"><input type="checkbox" name="aus" defaultChecked={aus} /> Keine Mails zu neuen Deals</label>
          <div><button className="btn" type="submit" data-testid="abo-speichern">Speichern</button></div>
        </form>
      </section>
      <section className="card card-pad stack" style={{ gap: 10 }}>
        <h2>Passwort</h2>
        <PasswortFormular />
      </section>
    </>
  );
}
