import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { leadSenders, senderInfo, signature } from "@/lib/leads/service";
import { saveMailboxProfileAction } from "../../actions";

/** Absendername und Signatur eines Postfachs – für Einkaufsanfragen an Großhändler und Nachfass-Mails. */
export default async function PostfachPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("posteingang");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [box] = await db.select().from(schema.mailboxes).where(and(eq(schema.mailboxes.id, id), eq(schema.mailboxes.tenantId, session.tenantId)));
  if (!box) notFound();
  const senders = await leadSenders(session.tenantId);
  const generated = signature(await senderInfo(session.tenantId, session.userId), "de");
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/posteingang">Posteingang</Link></div><h1>{box.address}</h1></div>
      </div>
      {sp.meldung && <div className="notice notice-info" data-testid="box-msg">{sp.meldung}</div>}
      <div className="row">
        <form action={saveMailboxProfileAction} className="card card-pad stack" style={{ flexGrow: 1, gap: 10, maxWidth: 640 }}>
          <input type="hidden" name="id" value={box.id} />
          <h2>Absender & Signatur</h2>
          <div className="field">
            <label className="label" htmlFor="mb-name">Absendername</label>
            <input className="input" id="mb-name" name="fromName" defaultValue={box.fromName ?? ""} maxLength={80} placeholder="z. B. Max Mustermann – Firma GmbH" />
            <div className="small muted">So steht es beim Empfänger im Feld „Von“. Leer = nur die Adresse.</div>
          </div>
          <div className="field">
            <label className="label" htmlFor="mb-sig">Signatur</label>
            <textarea className="textarea" id="mb-sig" name="signature" defaultValue={box.signature ?? ""} maxLength={2000} style={{ minHeight: 180 }} placeholder={generated} />
            <div className="small muted">
              Wird an Einkaufsanfragen und Nachfass-Mails angehängt, die über dieses Postfach gehen – mit Grußformel, z. B. „Mit freundlichen Grüßen“ (bei englischen Mails wird daraus „Kind regards“). Leer = aus den Absenderdaten (Einstellungen → Versand), wie im Platzhalter.
            </div>
          </div>
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="leadDefault" defaultChecked={senders.defaultId === box.id} /> Für Einkaufsanfragen vorauswählen
          </label>
          <div><button className="btn btn-primary" type="submit">Speichern</button></div>
        </form>
        <aside className="col-side">
          <section className="card card-pad small muted">
            Im Schreibfenster bei „Großhändler finden“ wählst du je Anfrage, von welcher Adresse sie rausgeht – zuletzt benutzt ist vorausgewählt. Nachfass-Mails gehen vom selben Postfach wie die erste Anfrage.
          </section>
        </aside>
      </div>
    </>
  );
}
