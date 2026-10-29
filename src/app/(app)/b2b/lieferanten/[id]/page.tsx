import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { SubmitButton } from "@/components/submit-button";
import { DEAL_STATUS_TAG, DEAL_STATUS_TEXT } from "@/lib/b2b/logic";
import { profilSpeichernAction } from "../actions";

const dez = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

function JaNein({ name, label, v }: { name: string; label: string; v: boolean | null | undefined }) {
  const wert = v === true ? "ja" : v === false ? "nein" : "";
  return (
    <div className="field">
      <label className="label" htmlFor={`p-${name}`}>{label}</label>
      <select className="input" id={`p-${name}`} name={name} defaultValue={wert} style={{ width: 160 }} data-testid={`p-${name}`}>
        <option value="">ungeklärt</option>
        <option value="ja">ja, erlaubt</option>
        <option value="nein">nein</option>
      </select>
    </div>
  );
}

export default async function LieferantProfilPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("b2b");
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const t = session.tenantId;
  const [s] = await db.select().from(schema.suppliers).where(and(eq(schema.suppliers.tenantId, t), eq(schema.suppliers.id, id)));
  if (!s) notFound();
  const [p] = await db.select().from(schema.lieferantenProfile).where(and(eq(schema.lieferantenProfile.tenantId, t), eq(schema.lieferantenProfile.supplierId, id)));
  const [pruefer] = p?.vertriebGeprueftVon ? await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, p.vertriebGeprueftVon)) : [];
  const D = schema.deals;
  const deals = await db.select({ id: D.id, nr: D.nr, titel: D.titel, status: D.status }).from(D).where(and(eq(D.tenantId, t), eq(D.supplierId, id))).orderBy(desc(D.nr)).limit(50);
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 } as const;
  const b = p?.bewertung ?? {};
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/b2b/lieferanten">Lieferanten-Freigaben</Link></div><h1>{s.name ?? s.code}</h1></div>
        <Link className="btn" href={`/lieferanten`}>Zu den Preislisten</Link>
      </div>
      {sp.meldung && <div className={`notice ${sp.meldung === "gespeichert" ? "notice-ok" : "notice-warn"}`} data-testid="profil-meldung">{sp.meldung === "gespeichert" ? "Gespeichert." : sp.meldung}</div>}
      <form action={profilSpeichernAction} className="card card-pad stack" style={{ gap: 12 }}>
        <input type="hidden" name="supplierId" value={s.id} />
        <h2>Vertriebsfreigabe</h2>
        <div className="small muted">Pflicht vor jedem Deal: Darf die Ware an andere Händler weiterverkauft und auf Amazon angeboten werden? Bei Markenware mit selektivem Vertrieb oft nicht.</div>
        <div style={grid}>
          <JaNein name="wiederverkaufErlaubt" label="Wiederverkauf an Händler" v={p?.wiederverkaufErlaubt} />
          <JaNein name="marktplatzErlaubt" label="Verkauf auf Marktplätzen" v={p?.marktplatzErlaubt} />
        </div>
        <div className="field">
          <label className="label" htmlFor="p-vertriebQuelle">Nachweis (woher die Auskunft stammt)</label>
          <input className="input" id="p-vertriebQuelle" name="vertriebQuelle" defaultValue={p?.vertriebQuelle ?? ""} placeholder="z. B. Mail von Herrn … am …, AGB § 7" style={{ maxWidth: 560 }} data-testid="p-vertriebQuelle" />
        </div>
        <div className="field">
          <label className="label" htmlFor="p-vertriebNotiz">Notiz zur Freigabe</label>
          <textarea className="input" id="p-vertriebNotiz" name="vertriebNotiz" rows={2} defaultValue={p?.vertriebNotiz ?? ""} style={{ maxWidth: 560 }} />
        </div>
        {p?.vertriebGeprueftAm && <div className="small muted">Zuletzt geändert {p.vertriebGeprueftAm.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}{pruefer ? ` von ${pruefer.name ?? pruefer.email}` : ""}.</div>}

        <h2 style={{ marginTop: 8 }}>Konditionen</h2>
        <div style={grid}>
          <div className="field"><label className="label" htmlFor="p-email">Bestell-E-Mail</label><input className="input" id="p-email" name="email" type="email" defaultValue={p?.email ?? ""} /></div>
          <div className="field"><label className="label" htmlFor="p-mbw">Mindestbestellwert €</label><input className="input" id="p-mbw" name="mindestbestellwert" inputMode="decimal" defaultValue={dez(p?.mindestbestellwert)} style={{ width: 110 }} /></div>
          <div className="field"><label className="label" htmlFor="p-vk">Versandkosten €</label><input className="input" id="p-vk" name="versandkosten" inputMode="decimal" defaultValue={dez(p?.versandkosten)} style={{ width: 110 }} /></div>
          <div className="field"><label className="label" htmlFor="p-zz">Zahlungsziel (Tage)</label><input className="input" id="p-zz" name="zahlungszielTage" inputMode="numeric" defaultValue={p?.zahlungszielTage ?? ""} style={{ width: 80 }} /></div>
          <div className="field"><label className="label" htmlFor="p-lz">Lieferzeit (Tage)</label><input className="input" id="p-lz" name="lieferzeitTage" inputMode="numeric" defaultValue={p?.lieferzeitTage ?? ""} style={{ width: 80 }} /></div>
        </div>
        <div className="field">
          <label className="label" htmlFor="p-marken">Marken (Komma)</label>
          <input className="input" id="p-marken" name="marken" defaultValue={(p?.marken ?? []).join(", ")} style={{ maxWidth: 560 }} />
        </div>
        <h2 style={{ marginTop: 8 }}>Bewertung (1–5)</h2>
        <div style={grid}>
          {([["b_antwortzeit", "Antwortzeit", b.antwortzeit], ["b_liefertreue", "Liefertreue", b.liefertreue], ["b_fehlmengen", "Fehlmengen (5 = keine)", b.fehlmengen], ["b_rechnungsqualitaet", "Rechnungsqualität", b.rechnungsqualitaet]] as const).map(([n, l, v]) => (
            <div className="field" key={n}><label className="label" htmlFor={`p-${n}`}>{l}</label><input className="input" id={`p-${n}`} name={n} inputMode="numeric" defaultValue={v ?? ""} style={{ width: 60 }} /></div>
          ))}
        </div>
        <div className="field">
          <label className="label" htmlFor="p-notiz">Notiz</label>
          <textarea className="input" id="p-notiz" name="notiz" rows={2} defaultValue={p?.notiz ?? ""} style={{ maxWidth: 560 }} />
        </div>
        <div><SubmitButton label="Speichern" pendingLabel="Speichere …" testId="profil-speichern" /></div>
      </form>
      {deals.length > 0 && (
        <section className="card" style={{ overflow: "auto" }}>
          <div className="card-head"><h2>Deals mit diesem Lieferanten</h2></div>
          <table className="table"><tbody>{deals.map((d) => <tr key={d.id}><td className="num"><Link href={`/b2b/${d.id}`}>#{d.nr}</Link></td><td>{d.titel}</td><td><span className={`tag ${DEAL_STATUS_TAG[d.status]}`}>{DEAL_STATUS_TEXT[d.status]}</span></td></tr>)}</tbody></table>
        </section>
      )}
    </>
  );
}
