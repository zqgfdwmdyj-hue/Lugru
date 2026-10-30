import "server-only";
import { z } from "zod";
import { AMPEL_TEXT } from "@/lib/deal-ampel/logic";
import { dealPruefen } from "@/lib/deal-ampel/service";
import { buchhaltungStatus } from "@/lib/buchhaltung/service";
import { personen, zustaendigSetzen } from "@/lib/delegieren/service";
import { anVaGeben } from "@/lib/va/service";
import { feierabend } from "@/lib/feierabend/service";
import { addDaysIso } from "@/lib/dates";
import { FRIST_TYP_TEXT } from "@/lib/private/fristen";
import { fristenListe } from "@/lib/private/fristen-service";
import { AUFWAND_TEXT } from "@/lib/tagesplan/logic";
import { aufgabeVerschieben, tagesplan } from "@/lib/tagesplan/service";
import { defineTool } from "../types";
import { PRIORITY_OUT, abs, dmy, isoDate, json, uuid } from "./common";

// Herzstück-Werkzeuge (Bauauftrag Modul 1–12): Deal-Ampel, Tagesplan, Fristen, Buchhaltung, Delegieren, Feierabend.

export const dealPruefenTool = defineTool({
  name: "deal_pruefen",
  title: "Deal-Ampel: Einkauf prüfen",
  description:
    "Bewertet einen Einkauf (z. B. Deal aus der Deal-Gruppe) in Sekunden: ASIN, EAN oder Amazon-Link + Einkaufspreis (+ Menge). Je Land Gewinn/Marge beim aktuellen Buy-Box-Preis und beim 90-Tage-Mittel (USt je Land), Verkäufe/Monat, Angebote, Amazon-Anteil, Tief der letzten 12 Monate und Aktionsmuster; empfohlene Menge für 30–45 Tage; Ampel grün/gelb/rot mit Begründung. Für „Lohnt sich das?“, „Soll ich das kaufen?“.",
  area: "lieferanten",
  write: false,
  quelle: { text: "Keepa (DE/FR/IT/ES/UK), Amazon-Angebote (SP-API), Gebühren aus dem Seller-System" },
  input: z.object({
    code: z.string().trim().min(8).max(300).describe("ASIN, EAN oder Amazon-Link"),
    ek: z.number().positive().describe("Einkaufspreis je Stück in €"),
    ek_ist_netto: z.boolean().default(false).describe("true = Preis ohne USt; Standard brutto"),
    menge: z.number().int().positive().optional().describe("geplante Menge"),
    laender: z.array(z.string().regex(/^[A-Za-z]{2}$/)).max(8).optional().describe("z. B. [\"DE\",\"FR\"]; sonst laut Einstellungen"),
  }),
  run: async (ctx, i) => {
    const r = await dealPruefen(ctx.session.tenantId, { code: i.code, ek: i.ek, ekIstNetto: i.ek_ist_netto, menge: i.menge ?? null, laender: i.laender });
    return json({
      asin: r.asin,
      titel: r.titel ?? undefined,
      ampel: AMPEL_TEXT[r.ampel],
      begruendung: r.begruendung,
      rot: r.rot.length ? r.rot : undefined,
      gelb: r.gelb.length ? r.gelb : undefined,
      ek_netto: r.ekNetto,
      empfohlene_menge: r.abverkauf.empfohlen ? `${r.abverkauf.empfohlen.von}–${r.abverkauf.empfohlen.bis} Stück (30–45 Tage)` : undefined,
      abverkauf_tage_fuer_menge: r.abverkauf.tage ?? undefined,
      bestes_land: r.bestes?.land,
      laender: r.laender.map((l) => ({
        land: l.land,
        buybox_eur: l.vkEur,
        schnitt_90_eur: l.vk90Eur,
        tief_12_monate_eur: l.tief12Eur,
        gewinn_jetzt: l.aktuell?.gewinn ?? null,
        gewinn_schnitt_90: l.schnitt90?.gewinn ?? null,
        marge_schnitt_90_prozent: l.schnitt90?.marge ?? null,
        roi_schnitt_90_prozent: l.schnitt90?.roi ?? null,
        verkaeufe_monat: l.verkaeufeMonat,
        angebote: l.angebote,
        amazon_prozent: l.amazonProzent,
        aktionsmuster: l.aktionsmuster ?? undefined,
        fehler: l.fehler ?? undefined,
      })),
      eigener_bestand: r.eigen ?? undefined,
      gebuehren: { provision_prozent: Math.round(r.gebuehren.provision * 100), fba: r.gebuehren.fba, geschaetzt: r.gebuehren.geschaetzt || undefined },
      hinweise: r.hinweise.length ? r.hinweise : undefined,
      link: abs(ctx, `/lieferanten/deal-ampel?code=${encodeURIComponent(r.asin)}&ek=${encodeURIComponent(String(i.ek).replace(".", ","))}&netto=${i.ek_ist_netto ? "1" : "0"}${i.menge ? `&menge=${i.menge}` : ""}`),
    });
  },
});

// ---- Modul 1: Tagesplan ----------------------------------------------------------------------------------

export const tagesplanTool = defineTool({
  name: "tagesplan",
  title: "Tagesplan",
  description:
    "Realistischer Tagesplan: Arbeitszeit minus Termine, Familienzeit (Kinderzeit, Auszeit, Paarzeit, Ausschlafen, private Termine) und freie Zeiten = Kapazität; darin die eigenen Aufgaben nach Priorität und Frist mit Zeitfenster. Dazu: bewusst verschobene Aufgaben mit neuem Datum, Konflikte (z. B. Frist fällt in Auszeit), Ampel je Tag, „wartet auf …“ (an andere abgegeben). Private Sperrzeiten nur als „Privat belegt“ – Details nur mit mit_privat: true. Für „Was schaffe ich heute?“, „Wie voll ist die Woche?“.",
  area: "kalender",
  write: false,
  quelle: { text: "Aufgaben, Kalender und Privatbereich im Seller-System", jobs: ["Kalender"] },
  input: z.object({
    datum: isoDate.optional().describe("Tag (Standard heute)"),
    tage: z.number().int().min(1).max(14).default(1).describe("Anzahl Tage ab datum (Woche = 7)"),
    mit_privat: z.boolean().default(false).describe("Private Sperrzeiten mit Details zeigen (nur mit Privat-Freigabe)"),
  }),
  run: async (ctx, i) => {
    const start = i.datum ?? ctx.today;
    const p = await tagesplan(ctx.session, { start, tage: i.tage, mitPrivat: i.mit_privat && ctx.privat, heute: ctx.today });
    const link = (l: string | null) => (l ? abs(ctx, l) : undefined);
    return json({
      zeitraum: { von: start, bis: p.tage[p.tage.length - 1]?.tag },
      private_details: p.privatDetails,
      tage: p.tage.map((t) => ({
        tag: t.tag,
        arbeitszeit: t.arbeitszeit ? `${t.arbeitszeit.von}–${t.arbeitszeit.bis}` : "kein Arbeitstag",
        kapazitaet_min: t.kapazitaet,
        eingeplant_min: t.belegt,
        auslastung_prozent: t.auslastung,
        ampel: t.ampel,
        sperrzeiten: t.sperren.map((s) => ({ von: s.ganztags ? "ganztägig" : s.von, bis: s.ganztags ? undefined : s.bis, art: s.art, titel: s.titel })),
        geplant: t.geplant.map((g) => ({ id: g.id, von: g.von, bis: g.bis, titel: g.titel, prioritaet: PRIORITY_OUT[g.prioritaet], aufwand: AUFWAND_TEXT[g.aufwand], aufwand_geschaetzt: g.geschaetzt || undefined, aufwand_gelernt: g.gelernt || undefined, frist: g.faellig, link: link(g.link) })),
        konflikte: t.konflikte.length ? t.konflikte.map((k) => ({ aufgabe_id: k.aufgabeId, titel: k.titel, konflikt: k.text })) : undefined,
      })),
      verschoben: p.verschoben.map((v) => ({ id: v.id, titel: v.titel, frist: v.faellig, neues_datum: v.neu, prioritaet: PRIORITY_OUT[v.prioritaet] })),
      ohne_frist: p.ohneFrist.length,
      wartet_auf: p.wartetAuf.length ? p.wartetAuf.map((w) => ({ person: w.person, offen: w.aufgaben.length, ueberfaellig: w.aufgaben.filter((a) => a.ueberfaellig).length, aufgaben: w.aufgaben.slice(0, 10).map((a) => ({ id: a.id, titel: a.titel, frist: a.faellig })) })) : undefined,
      hinweise: p.hinweise.length ? p.hinweise : undefined,
      link: abs(ctx, `/kalender/tagesplan${i.datum ? `?tag=${i.datum}` : ""}`),
    });
  },
});

export const aufgabeVerschiebenTool = defineTool({
  name: "aufgabe_verschieben",
  title: "Aufgabe verschieben",
  description: "Setzt die Frist einer Aufgabe auf ein neues Datum (z. B. den Vorschlag aus „tagesplan“). Nur auf ausdrücklichen Wunsch benutzen.",
  area: "kalender",
  write: true,
  input: z.object({ id: uuid, datum: isoDate }),
  summary: (i) => `Aufgabe → ${dmy(i.datum)}`,
  run: async (ctx, i) => {
    const r = await aufgabeVerschieben(ctx.session, i.id, i.datum);
    if (!r) return { text: "Aufgabe nicht gefunden.", isError: true };
    return json({ ok: true, meldung: `„${r.titel}“ von ${dmy(r.vorher) ?? "ohne Frist"} auf ${dmy(i.datum)} verschoben.`, link: abs(ctx, `/kalender/tagesplan?tag=${i.datum}`) });
  },
});

// ---- Modul 7: Vorsorge, Fristen & Verträge (Privatbereich) ---------------------------------------------

export const fristenTool = defineTool({
  name: "fristen",
  title: "Fristen, Vorsorge & Verträge",
  description:
    "Fristen aus dem Privatbereich bis zu einem Datum: Vorsorge je Person (Zahnarzt, Check-up, Impfungen …), Ablauf von Ausweis/Reisepass/Führerschein, TÜV und Reifenwechsel, Garantien, Verträge & Abos mit letztem Kündigungstag; dazu Vorschläge („fällig in 3 Wochen – buchen?“) und Fixkosten je Monat aus Verträgen. bereich „geschaeft“ = nur Einträge mit Firmen-Kennzeichen, „privat“ = ohne. Überfällige und Einträge im Erinnerungs-Vorlauf sind immer dabei.",
  area: "privat",
  privat: true,
  write: false,
  quelle: { text: "Privatbereich → Fristen & Verträge (eigene Einträge)" },
  input: z.object({
    bis_datum: isoDate.optional().describe("Standard: heute + 90 Tage"),
    bereich: z.enum(["privat", "geschaeft", "alle"]).default("alle"),
  }),
  run: async (ctx, i) => {
    if (ctx.session.privateScope === "familie") return { text: "Fristen & Verträge gehören nicht zum Familien-Zugang.", isError: true };
    const bis = i.bis_datum ?? addDaysIso(ctx.today, 90);
    const r = await fristenListe(ctx.session, ctx.today, bis, i.bereich);
    return json({
      zeitraum: { von: ctx.today, bis },
      bereich: i.bereich,
      eintraege_gesamt: r.anzahl,
      fristen: r.liste.map((x) => ({
        datum: x.frist.datum,
        art: FRIST_TYP_TEXT[x.typ],
        titel: x.frist.titel,
        stand: x.frist.text,
        jetzt_kuemmern: x.frist.erinnern || undefined,
        ueberfaellig: x.frist.ueberfaellig || undefined,
        vorschlag: x.frist.vorschlag ?? undefined,
        firma: x.frist.firma || undefined,
      })),
      fixkosten_vertraege_je_monat: i.bereich === "geschaeft" ? r.fixkosten.firma : i.bereich === "privat" ? r.fixkosten.privat : r.fixkosten,
      link: abs(ctx, "/privat/fristen"),
    });
  },
});

// ---- Modul 5: Buchhaltung ---------------------------------------------------------------------------------

export const buchhaltungStatusTool = defineTool({
  name: "buchhaltung_status",
  title: "Buchhaltung: Stand des Monats",
  description:
    "Stand der Buchhaltung je Firma (LuGru/WiGru) und Monat: Belege neu/unsicher, Zahlungen ohne Beleg, Belege ohne Zahlung, Abstimmungsgrad in %, offene Zuordnungs- und Buchungsvorschläge, festgeschrieben ja/nein, Export für den Steuerberater erstellt ja/nein, letzte Kontoauszug-Uploads. Für „Wie weit ist die Buchhaltung für Oktober?“, „Was fehlt dem Steuerberater?“. Keine Steuerberatung.",
  area: "geld",
  write: false,
  quelle: { text: "Kontoauszüge (Sparkasse/Amex-Uploads) und Belege im Seller-System" },
  input: z.object({
    monat: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe("JJJJ-MM"),
    firma: z.string().max(40).optional().describe("Standard: Hauptfirma"),
  }),
  run: async (ctx, i) => {
    const s = await buchhaltungStatus(ctx.session.tenantId, i.monat, i.firma);
    const letzterImport = (art: string) => s.importe.find((x) => x.art === art);
    const imp = (art: string) => {
      const x = letzterImport(art);
      return x ? { zeitraum: `${x.von ?? "?"} – ${x.bis ?? "?"}`, hochgeladen: x.createdAt.toISOString().slice(0, 10), endsaldo: x.endsaldo ?? undefined } : "noch kein Upload";
    };
    return json({
      firma: s.firma,
      monat: s.monat,
      firmen: s.firmen,
      abstimmungsgrad_prozent: s.abstimmungsgrad,
      zahlungen: { gesamt: s.zahlungen.gesamt, zugeordnet: s.zahlungen.zugeordnet, vorschlaege_offen: s.zahlungen.vorschlaege, ohne_beleg: s.zahlungen.ohneBeleg },
      belege: { im_monat: s.belege.gesamt, neu: s.belege.neu, unsicher: s.belege.unsicher, ohne_zahlung: s.belege.ohneZahlung },
      buchungen: s.buchungen,
      festgeschrieben: s.buchungen.festgeschrieben > 0 && s.buchungen.vorschlag === 0 && s.buchungen.bestaetigt === 0,
      export_erstellt: s.export ? { am: s.export.am.toISOString().slice(0, 10), art: s.export.art === "datev" ? "DATEV" : "CSV + Belege (ZIP)", buchungen: s.export.buchungen } : false,
      uploads: { sparkasse: imp("sparkasse"), amex: imp("amex") },
      zahlungen_ohne_beleg: s.listen.ohneBeleg.slice(0, 15).map((z) => ({ datum: z.datum, betrag: z.betrag, gegenpartei: z.gegenpartei.slice(0, 60), amex: z.karte || undefined })),
      belege_ohne_zahlung: s.listen.belegeOhneZahlung.slice(0, 15).map((b) => ({ datum: b.datum, offen: b.rest, lieferant: b.lieferant, nummer: b.nummer })),
      hinweis: "Nur Stand und Vorschläge – steuerliche Bewertung beim Steuerberater.",
      link: abs(ctx, `/buchhaltung?firma=${encodeURIComponent(s.firma)}&monat=${s.monat}`),
    });
  },
});

// ---- Modul 2: Delegieren --------------------------------------------------------------------------------

export const aufgabeZuweisenTool = defineTool({
  name: "aufgabe_zuweisen",
  title: "Aufgabe zuweisen",
  description:
    "Setzt die Zuständigkeit einer Aufgabe: interne Person mit Konto (z. B. Assistenz – passende Anleitungen hängen automatisch an) oder extern (Prep Center, Steuerberater, eigener Name), „niemand“ entfernt sie. Mit an=\"va\" geht die Aufgabe an die VA im Discord-Kanal: eigener Thread mit Titel, Frist, Priorität, Anleitung, Anhängen und optionaler notiz. Nur auf ausdrücklichen Wunsch benutzen.",
  area: ["start", "kalender"],
  ownerOnly: true,
  write: true,
  input: z.object({
    id: uuid,
    person: z.string().trim().min(2).max(60).optional().describe("Name der Person (wie in „aufgaben“ unter zustaendig) oder „niemand“"),
    an: z.enum(["va"]).optional().describe("„va“ = an die VA im Discord-Kanal (statt person)"),
    notiz: z.string().trim().max(1500).optional().describe("Nur mit an=va: Notiz für die VA im Thread"),
  }),
  summary: (i) => (i.an === "va" ? `Aufgabe → VA (Discord)${i.notiz ? ` mit Notiz` : ""}` : `Aufgabe → ${i.person ?? "?"}`),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    if (i.an === "va") {
      const r = await anVaGeben(t, i.id, i.notiz);
      if (!r.ok) return { text: r.fehler, isError: true };
      return json({ ok: true, meldung: r.neu ? "An die VA gegeben – Thread im VA-Kanal angelegt." : "An die VA gegeben – im bestehenden Thread erneut gemeldet.", link: abs(ctx, "/delegation/va") });
    }
    if (!i.person) return { text: "person oder an=\"va\" angeben.", isError: true };
    let key: string | null = null;
    if (i.person.toLowerCase() !== "niemand") {
      const ps = await personen(t);
      const exakt = ps.find((p) => p.name.toLowerCase() === i.person!.toLowerCase());
      const teil = ps.filter((p) => p.name.toLowerCase().includes(i.person!.toLowerCase()));
      const p = exakt ?? (teil.length === 1 ? teil[0] : null);
      if (!p) return { text: teil.length > 1 ? `Mehrdeutig: ${teil.map((x) => x.name).join(", ")}.` : `Keine Person „${i.person}“. Bekannt: ${ps.map((x) => x.name).join(", ")} (externe Namen unter Delegation pflegen).`, isError: true };
      key = p.key;
    }
    const r = await zustaendigSetzen(t, i.id, key);
    if (!r.ok) return { text: "Aufgabe nicht gefunden.", isError: true };
    return json({ ok: true, meldung: r.name ? `Zuständig: ${r.name}.${r.va ? ` ${r.va}` : ""}` : "Zuständigkeit entfernt.", link: abs(ctx, "/delegation") });
  },
});

// ---- Modul 10: Feierabend ---------------------------------------------------------------------------------

export const feierabendTool = defineTool({
  name: "feierabend",
  title: "Feierabend-Check",
  description:
    "Abend-Check: heute erledigt, noch offen (rutscht auf morgen), morgen Termine, Top-3-Aufgaben und Sperrzeiten (privat nur „Privat belegt“, außer mit_privat). Mit rueckblick: true (sonntags automatisch) Wochenrückblick – erledigte Aufgaben je Person, mit Privat-Freigabe auch Familienzeit-Stunden und Paarzeit ja/nein.",
  area: "kalender",
  write: false,
  quelle: { text: "Aufgaben, Kalender und Privatbereich im Seller-System" },
  input: z.object({ rueckblick: z.boolean().default(false), mit_privat: z.boolean().default(false) }),
  run: async (ctx, i) => {
    const f = await feierabend(ctx.session, { heute: ctx.today, mitPrivat: i.mit_privat && ctx.privat, rueckblick: i.rueckblick });
    return json({
      heute: f.heute,
      erledigt: f.erledigt.map((e) => e.titel),
      offen_rutscht_auf_morgen: f.offen.map((o) => ({ id: o.id, titel: o.titel, frist: o.frist, wichtig: o.wichtig || undefined })),
      morgen: {
        datum: f.morgen,
        arbeitszeit: f.morgenArbeitszeit ? `${f.morgenArbeitszeit.von}–${f.morgenArbeitszeit.bis}` : "kein Arbeitstag",
        termine: f.morgenTermine.map((s) => ({ von: s.von, bis: s.bis, titel: s.titel })),
        sperrzeiten: f.morgenSperren.map((s) => ({ von: s.ganztags ? "ganztägig" : s.von, bis: s.ganztags ? undefined : s.bis, titel: s.titel })),
        top3: f.morgenTop3.map((g) => ({ titel: g.titel, von: g.von, aufwand: AUFWAND_TEXT[g.aufwand] })),
        konflikte: f.morgenKonflikte.length ? f.morgenKonflikte.map((k) => `${k.titel}: ${k.text}`) : undefined,
      },
      wochenrueckblick: f.rueckblick ?? undefined,
      va: f.va ? { text: f.va.text, erledigt: f.va.erledigt, rueckfragen: f.va.rueckfragen, automatisch_beantwortet: f.va.auto, unbeantwortet: f.va.offen } : undefined,
      hinweis: f.offen.length ? "Verschieben nur auf Wunsch: aufgabe_verschieben oder im Seller-System „Auf morgen schieben“." : undefined,
      link: abs(ctx, "/kalender/feierabend"),
    });
  },
});

export const HERZSTUECK = [dealPruefenTool, tagesplanTool, aufgabeVerschiebenTool, fristenTool, buchhaltungStatusTool, aufgabeZuweisenTool, feierabendTool];
