import Link from "next/link";
import { redirect } from "next/navigation";
import type { NachrichtEintrag } from "@/lib/inbox/persoenlich";
import { loadEntries, requirePrivate } from "@/lib/private/service";
import { getSettings } from "@/lib/settings";
import { PrivatHead } from "../ui";
import { persoenlichEinstellungenAction } from "./actions";
import { STATUS_TEXT } from "./status";

// Persönliche Mails (B32): nur hier – nie im geschäftlichen Posteingang, nie bei der VA. Sichtbar nur für den Inhaber.

const zeit = (iso: string) => new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function NachrichtenPage({ searchParams }: { searchParams: Promise<{ meldung?: string; alle?: string }> }) {
  const session = await requirePrivate({ full: true });
  if (session.role !== "owner") redirect("/privat?nurinhaber=1");
  const sp = await searchParams;
  const liste = (await loadEntries<NachrichtEintrag>(session, ["nachricht"])).filter((e) => !e.data.ignoriert).sort((a, b) => b.data.zuletztAm.localeCompare(a.data.zuletztAm));
  const offen = liste.filter((e) => e.data.status === "offen" || e.data.status === "unsicher");
  const ausgehend = liste.filter((e) => e.data.status === "ausgehend");
  const erledigt = liste.filter((e) => !["offen", "unsicher", "ausgehend"].includes(e.data.status));
  const cfg = (await getSettings(session.tenantId)).posteingang.persoenlich;

  const zeile = (e: (typeof liste)[number]) => {
    const [txt, cls] = STATUS_TEXT[e.data.status];
    return (
      <li key={e.id} className="card card-pad" style={{ listStyle: "none" }} data-testid="nachricht-zeile">
        <Link href={`/privat/nachrichten/${e.id}`} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
          <div className="between" style={{ gap: 8 }}>
            <strong>{e.data.name ?? e.data.von}</strong>
            <span className="small muted">{zeit(e.data.zuletztAm)}</span>
          </div>
          <div className="small" style={{ marginTop: 2 }}>{e.data.zusammenfassung || e.data.betreff}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <span className={`tag ${cls}`}>{txt}</span>
            {e.data.terminGeaendert && <span className="tag tag-warn">Termin abgesagt</span>}
            {e.data.termin && !e.data.terminGeaendert && !e.data.terminErledigt && e.data.termin.art !== "absage" && <span className="tag tag-info">Termin bestätigen?</span>}
          </div>
        </Link>
      </li>
    );
  };

  return (
    <>
      <PrivatHead active="nachrichten" title="Nachrichten" />
      <p className="small muted" style={{ marginTop: 0 }}>Persönliche Mails von Personen, Praxen und Dienstleistern – mit fertigem Antwortentwurf. Nur du siehst sie; im Geschäft, bei der VA und im Morgenbericht steht höchstens die Anzahl.</p>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }} data-testid="nachricht-meldung">{sp.meldung}</div>}

      <section className="stack" style={{ gap: 8 }} data-testid="nachrichten-offen">
        <h2 style={{ fontSize: 16, margin: 0 }}>Offen ({offen.length})</h2>
        {offen.length === 0 ? <div className="small muted">Keine offenen persönlichen Mails.</div> : <ul className="stack" style={{ gap: 8, padding: 0, margin: 0 }}>{offen.map(zeile)}</ul>}
      </section>

      {ausgehend.length > 0 && (
        <section className="stack" style={{ gap: 8, marginTop: 18 }} data-testid="nachrichten-ausgehend">
          <h2 style={{ fontSize: 16, margin: 0 }}>Ausgehend ({ausgehend.length})</h2>
          <ul className="stack" style={{ gap: 8, padding: 0, margin: 0 }}>{ausgehend.slice(0, 30).map(zeile)}</ul>
        </section>
      )}

      {erledigt.length > 0 && (
        <section className="stack" style={{ gap: 8, marginTop: 18 }} data-testid="nachrichten-erledigt">
          <h2 style={{ fontSize: 16, margin: 0 }}>Erledigt</h2>
          <ul className="stack" style={{ gap: 8, padding: 0, margin: 0 }}>{(sp.alle ? erledigt : erledigt.slice(0, 15)).map(zeile)}</ul>
          {!sp.alle && erledigt.length > 15 && <Link className="small" href="/privat/nachrichten?alle=1">Alle {erledigt.length} anzeigen</Link>}
        </section>
      )}

      <details className="card card-pad" style={{ marginTop: 22 }}>
        <summary><strong>Einstellungen</strong></summary>
        <form action={persoenlichEinstellungenAction} className="stack" style={{ gap: 8, marginTop: 10 }} data-testid="persoenlich-einstellungen">
          <label className="small"><input type="checkbox" name="aktiv" defaultChecked={cfg.aktiv !== false} /> Persönliche Mails erkennen und hier ablegen (aus: sie werden wie bisher ignoriert)</label>
          <label className="small"><input type="checkbox" name="kiEntwurf" defaultChecked={cfg.kiEntwurf !== false} /> Antwortentwurf mit KI (sonst Vorlage). Inhalte gehen nur an die KI, nie in Discord-Kanäle.</label>
          <label className="small"><input type="checkbox" name="slots" defaultChecked={Boolean(cfg.slots)} /> Bei Absagen zwei freie Termine aus dem Privatkalender vorschlagen</label>
          <label className="small"><input type="checkbox" name="discordDm" defaultChecked={Boolean(cfg.discordDm)} /> Zusätzlich als Discord-Direktnachricht an mich (nie in einen Kanal)</label>
          <div className="field">
            <label className="label" htmlFor="dmid">Meine Discord-Benutzer-ID</label>
            <input className="input" id="dmid" name="discordDmId" inputMode="numeric" defaultValue={cfg.discordDmId ?? ""} placeholder="z. B. 123456789012345678" />
            <div className="small muted">Discord → Einstellungen → Erweitert → Entwicklermodus an, dann Rechtsklick auf deinen Namen → „ID kopieren“. Der VA-Bot schickt die Nachricht.</div>
          </div>
          <div><button className="btn btn-small" type="submit">Speichern</button></div>
        </form>
      </details>
    </>
  );
}
