import "server-only";
import type { Session } from "@/lib/auth/session";
import { addDaysIso } from "@/lib/dates";
import { letzterImport, kontostand, umsaetzeSeit, wiederkehrend } from "@/lib/bank/service";
import { einkommenJahr, faelligeErinnerungen, fixkostenMonat, letzteMonate, monatsUebersicht, ruecklageStand, vermoegen, type Anlage, type Einkommen, type Erinnerung, type Fixkosten, type GeldEintrag, type Ruecklage, type Steuerfrage } from "./geld";
import { loadEntries, type Entry } from "./service";

// Privates Geld je Person: Einträge (nur der Verfasser sieht sie) + Privatkonto (Kontoauszüge, nur eigene).

export async function privatFinanzen(session: Session, heute: string, monat?: string) {
  const eintraege = await loadEntries<GeldEintrag>(session, ["privatgeld"]);
  const von = <T extends GeldEintrag["typ"]>(typ: T) => eintraege.filter((e) => e.data.typ === typ) as Entry<Extract<GeldEintrag, { typ: T }>>[];
  const einkommen = von("einkommen");
  const fixkosten = von("fixkosten");
  const ruecklagen = von("ruecklage");
  const anlagen = von("anlage");
  const erinnerungen = von("erinnerung");
  const fragen = von("steuerberater");
  const m = monat && /^\d{4}-\d{2}$/.test(monat) ? monat : heute.slice(0, 7);
  const [umsaetze, stand, imp, wk] = await Promise.all([
    umsaetzeSeit(session.tenantId, "privat", session.userId, addDaysIso(heute, -400)),
    kontostand(session.tenantId, "privat", session.userId, heute),
    letzterImport(session.tenantId, "privat", session.userId),
    wiederkehrend(session.tenantId, "privat", session.userId, heute),
  ]);
  const konto = umsaetze.map((u) => ({ buchungstag: u.buchungstag, betrag: u.betrag, gegenpartei: u.gegenpartei, gruppe: u.gruppe }));
  return {
    monat: m,
    einkommen,
    fixkosten,
    ruecklagen,
    anlagen,
    erinnerungen,
    fragen,
    summen: {
      einkommenJahr: einkommenJahr(einkommen.map((e) => e.data as Einkommen), m.slice(0, 4)),
      fixkostenMonat: fixkostenMonat(fixkosten.map((e) => e.data as Fixkosten)),
      vermoegen: vermoegen(anlagen.map((e) => e.data as Anlage), ruecklagen.map((e) => e.data as Ruecklage)),
      ruecklagen: ruecklagen.map((e) => ({ id: e.id, name: (e.data as Ruecklage).name, ...ruecklageStand(e.data as Ruecklage) })),
    },
    faellig: faelligeErinnerungen(erinnerungen.map((e) => ({ ...(e.data as Erinnerung), id: e.id })), heute),
    offeneFragen: fragen.filter((f) => !(f.data as Steuerfrage).erledigt),
    konto: {
      stand,
      letzterImport: imp?.n ? { am: imp.am, bis: imp.bis, buchungen: imp.n } : null,
      monat: monatsUebersicht(konto, m),
      verlauf: letzteMonate(m === heute.slice(0, 7) ? heute : `${m}-28`, 6).map((x) => {
        const u = monatsUebersicht(konto, x);
        return { monat: x, einnahmen: u.einnahmen, ausgaben: u.ausgaben, saldo: u.saldo };
      }),
      wiederkehrend: wk.slice(0, 20),
    },
  };
}
