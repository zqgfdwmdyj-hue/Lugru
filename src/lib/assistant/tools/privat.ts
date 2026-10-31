import "server-only";
import { z } from "zod";
import { privateCalendar } from "@/lib/private/calendar-data";
import { saveAppointment, saveTimeEntry, setStatus } from "@/lib/private/save";
import { ANLEGBARE_ARTEN, privatEintragAnlegen as eintragAnlegen } from "@/lib/private/anlegen";
import { privatEintragAendern as aendern, privatEintragLoeschen as loeschen, privatRueckgaengig } from "@/lib/private/aendern";
import { loadEntries, privateSettings, type PrivateKind } from "@/lib/private/service";
import { privatFinanzen as finanzenLaden } from "@/lib/private/geld-service";
import type { Anlage, Einkommen, Erinnerung, Fixkosten, Steuerfrage } from "@/lib/private/geld";
import { defineTool, type ToolCtx } from "../types";
import { abs, isoDate, json, uuid } from "./common";

// Privatbereich – nur über den Claude-Konnektor des Inhabers mit ausdrücklicher Privat-Freigabe (ctx.privat).
// Es gelten dieselben Sichtbarkeitsregeln wie auf den Privat-Seiten (eigenes Tagebuch, Freigaben, Umfang).

const time = z.string().regex(/^\d{1,2}:\d{2}$/, "Uhrzeit als HH:MM");
const status = z.enum(["geplant", "stattgefunden", "ausgefallen"]);

/** „a“, „b“, „beide“ oder ein Vorname aus den Privat-Einstellungen → Schlüssel. */
async function personKey(ctx: ToolCtx, v: string | undefined): Promise<string | undefined> {
  if (!v) return undefined;
  const x = v.trim().toLowerCase();
  if (x === "a" || x === "b" || x === "beide") return x;
  const names = (await privateSettings(ctx.session.tenantId)).partners;
  for (const k of ["a", "b"] as const) if (names[k] && names[k].trim().toLowerCase() === x) return k;
  return undefined;
}

const KINDS = ["termin", "kinder", "auszeit", "ausschlafen", "paarzeit", "intim", "zuwendung", "periode", "aufgabe", "tagebuch", "beobachtung", "gespraech", "danke", "stimmung", "dateidee", "zustaendig", "routine", "medplan"] as const;

export const privatKalender = defineTool({
  name: "privat_kalender",
  title: "Privatkalender",
  description:
    "Privater Kalender im Zeitraum: private Termine (Therapie, Arzt, Familie), Kinderzeit, Auszeit, Ausschlafen, Paarzeit, Nähe/Zuwendung, Periode und Familienkalender-Termine – mit Personen und Status. Für „Wann war die letzte Paarzeit?“, „Wer hat diese Woche die Kinder?“.",
  area: "privat",
  privat: true,
  write: false,
  quelle: { text: "Privatbereich und Familienkalender", jobs: ["Kalender"] },
  input: z.object({ von: isoDate, bis: isoDate.describe("Höchstens 92 Tage nach „von“") }),
  run: async (ctx, { von, bis }) => {
    if (bis < von) return { text: "„bis“ liegt vor „von“.", isError: true };
    const pc = await privateCalendar(ctx.session, von, bis, ctx.today);
    const names = pc.settings.partners;
    return json({
      zeitraum: `${von} – ${bis}`,
      personen: names,
      eintraege: pc.items.map((x) => ({ id: x.id, tag: x.day, bis_tag: x.endDay, von: x.from, bis: x.to, art: x.kind, titel: x.title, personen: x.people.map((p) => names[p]), status: x.status, notiz: x.note, kalender: x.calendar })),
      link: abs(ctx, `/privat/kalender?tag=${von}`),
    });
  },
});

export const privatEintraege = defineTool({
  name: "privat_eintraege",
  title: "Privat-Einträge lesen",
  description: `Liest Privat-Einträge bestimmter Arten (${KINDS.join(", ")}), optional nur in einem Zeitraum (nach Tag). Zum Beispiel Tagebuch, Therapie-Aufgaben, Gesprächsnotizen, Dankbarkeit.`,
  area: "privat",
  privat: true,
  write: false,
  quelle: { text: "Privatbereich im Seller-System" },
  input: z.object({ arten: z.array(z.enum(KINDS)).min(1).max(6), von: isoDate.optional(), bis: isoDate.optional(), limit: z.number().int().min(1).max(200).default(60) }),
  run: async (ctx, i) => {
    const rows = await loadEntries<Record<string, unknown>>(ctx.session, i.arten as PrivateKind[]);
    const inRange = rows.filter((e) => {
      const day = typeof e.data.day === "string" ? e.data.day : typeof e.data.start === "string" ? e.data.start : typeof e.data.due === "string" ? e.data.due : null;
      if (!day) return !i.von && !i.bis;
      return (!i.von || day >= i.von) && (!i.bis || day <= i.bis);
    });
    const dayOf = (e: (typeof rows)[number]) => String(e.data.day ?? e.data.start ?? e.data.due ?? "");
    inRange.sort((a, b) => dayOf(b).localeCompare(dayOf(a)));
    return json({ zeitraum: i.von || i.bis ? `${i.von ?? "…"} – ${i.bis ?? "…"}` : "alle", personen: (await privateSettings(ctx.session.tenantId)).partners, anzahl: inRange.length, eintraege: inRange.slice(0, i.limit).map((e) => ({ id: e.id, art: e.kind, daten: e.data, eigener: e.userId === ctx.session.userId, link: abs(ctx, `/privat/eintrag/${e.id}`) })), link: abs(ctx, "/privat") });
  },
});

export const privatTermin = defineTool({
  name: "privat_termin",
  title: "Privaten Termin speichern",
  description: "Legt einen privaten Termin an (oder ändert ihn mit id): Therapie (ads/paar), Arzt, Familie, privat, sonstiges. person = Name, „a“, „b“ oder „beide“. Wird nie automatisch in einen geteilten Kalender übertragen.",
  area: "privat",
  privat: true,
  write: true,
  input: z.object({
    id: uuid.optional(),
    tag: isoDate,
    uhrzeit: time.optional(),
    bis: time.optional(),
    art: z.enum(["ads", "paar", "arzt", "familie", "privat", "sonst"]).default("privat"),
    titel: z.string().trim().max(120).optional(),
    person: z.string().trim().max(40).optional(),
    notiz: z.string().trim().max(4000).optional(),
    status: status.optional(),
  }),
  summary: () => "Privater Termin",
  run: async (ctx, i) => {
    const fd = new FormData();
    const set = (k: string, v: string | undefined) => v !== undefined && fd.set(k, v);
    set("id", i.id);
    set("day", i.tag);
    set("time", i.uhrzeit);
    set("to", i.bis);
    set("with", i.art);
    set("title", i.titel);
    set("person", await personKey(ctx, i.person));
    set("notes", i.notiz);
    set("status", i.status);
    const r = await saveAppointment(ctx.session, fd);
    return r.ok ? json({ ok: true, meldung: r.message, id: r.id }) : { text: r.message, isError: true };
  },
});

export const privatZeit = defineTool({
  name: "privat_zeit",
  title: "Kinderzeit/Auszeit/Paarzeit eintragen",
  description:
    "Trägt Kinderzeit, Auszeit, Ausschlafen oder Paarzeit ein (oder ändert mit id). person = Name, „a“ oder „b“ (Kinderzeit auch „beide“); bei Paarzeit keine Person. Zeit mit von/bis oder als Stunden. Über mehrere Tage (Übernachtung, z. B. Mo 08:00 – Di 18:00): bis_tag setzen, von = Uhrzeit am ersten, bis = Uhrzeit am letzten Tag. Auszeit mit kinder_beim_partner = true legt zugleich die Kinderzeit des anderen an (ein Vorgang).",
  area: "privat",
  privat: true,
  write: true,
  input: z.object({
    id: uuid.optional(),
    art: z.enum(["kinder", "auszeit", "ausschlafen", "paarzeit"]),
    tag: isoDate,
    von: time.optional(),
    bis: time.optional(),
    stunden: z.number().min(0).max(72).optional(),
    bis_tag: isoDate.optional().describe("Letzter Tag bei Übernachtung/mehreren Tagen (nicht beim Ausschlafen)"),
    kinder_beim_partner: z.boolean().optional().describe("Nur Auszeit: der andere hat in dieser Zeit die Kinder allein"),
    person: z.string().trim().max(40).optional(),
    was: z.string().trim().max(200).optional().describe("Kinderzeit/Paarzeit: was ihr gemacht habt"),
    notiz: z.string().trim().max(500).optional(),
    status: status.optional(),
  }),
  summary: (i) => `Privat: ${i.art}`,
  run: async (ctx, i) => {
    const fd = new FormData();
    const set = (k: string, v: string | undefined) => v !== undefined && fd.set(k, v);
    set("id", i.id);
    set("day", i.tag);
    set("from", i.von);
    set("to", i.bis);
    set("hours", i.stunden !== undefined ? String(i.stunden) : undefined);
    set("toDay", i.bis_tag);
    if (i.art === "auszeit" && i.kinder_beim_partner) set("kidsBy", "partner");
    set("person", await personKey(ctx, i.person));
    set("what", i.was);
    set("note", i.notiz);
    set("status", i.status);
    const r = await saveTimeEntry(ctx.session, i.art, fd);
    return r.ok ? json({ ok: true, meldung: r.message, id: r.id }) : { text: r.message, isError: true };
  },
});

export const privatEintragAnlegen = defineTool({
  name: "privat_eintrag_anlegen",
  title: "Privat-Eintrag anlegen (übrige Arten)",
  description:
    "Legt einen Privat-Eintrag der übrigen Arten an: intim (Nähe; person = Initiative a/b/beide, wert = Nähe 1–5), zuwendung (Streicheln/Massage; variante, person = wer gibt, wert = Minuten), tagebuch (eigener Eintrag je Tag; text = Notiz, wert = Stimmung 1–5), beobachtung (an_person = über wen, text), gespraech (Paar-Gespräch; text = Thema), danke (text; person = von wem), stimmung (wert 1–5, text), dateidee (text), aufgabe (text = Aufgabe; person = für wen, tag = fällig). Termine und Kinderzeit/Auszeit/Paarzeit über privat_termin bzw. privat_zeit. Vertraulich wie der Privatbereich: nur mit Privat-Freigabe, nie für VA oder Konten „nur Familie“. Nur auf ausdrücklichen Wunsch.",
  area: "privat",
  privat: true,
  write: true,
  input: z.object({
    art: z.enum(ANLEGBARE_ARTEN),
    tag: isoDate.optional().describe("Standard heute"),
    uhrzeit: time.optional(),
    person: z.string().trim().max(40).optional().describe("Name, „a“, „b“ oder „beide“"),
    an_person: z.string().trim().max(40).optional().describe("Bei Beobachtung: über wen (Name, „a“ oder „b“)"),
    text: z.string().trim().max(2000).optional(),
    wert: z.number().min(0).max(600).optional(),
    variante: z.enum(["streicheln", "massage"]).optional().describe("Nur zuwendung"),
  }),
  summary: (i) => `Privat: ${i.art}`,
  run: async (ctx, i) => {
    const p = await personKey(ctx, i.person);
    const an = await personKey(ctx, i.an_person);
    const r = await eintragAnlegen(ctx.session, { art: i.art, tag: i.tag, uhrzeit: i.uhrzeit, person: p === "a" || p === "b" || p === "beide" ? p : undefined, anPerson: an === "a" || an === "b" ? an : undefined, text: i.text, wert: i.wert, variante: i.variante });
    return r.ok ? json({ ok: true, meldung: r.message, id: r.id, link: r.id ? abs(ctx, `/privat/eintrag/${r.id}`) : abs(ctx, "/privat") }) : { text: r.message, isError: true };
  },
});

export const privatEintragAendern = defineTool({
  name: "privat_eintrag_aendern",
  title: "Privat-Eintrag ändern",
  description:
    "Ändert einen bestehenden Privat-Eintrag (id aus privat_eintraege) – z. B. eine ersetzte oder veraltete Beobachtung. Arten: beobachtung (situation, problematik, veraenderung – leer = Feld entfernen – oder text; tag), tagebuch (text = Notiz, wert = Stimmung 1–5), stimmung (wert 1–5, text), intim (wert = Nähe 1–5, text), zuwendung (wert = Minuten, text, tag), gespraech (text = Thema, vereinbart), danke (text), dateidee (text, erledigt), aufgabe (text = Titel, tag = fällig, erledigt). Tagebuch, Beobachtung und Stimmung nur die eigenen. Termine/Zeiten über privat_termin bzw. privat_zeit. Nur auf ausdrücklichen Wunsch und mit genau den genannten Angaben; 7 Tage rückgängig machbar.",
  area: "privat",
  privat: true,
  write: true,
  input: z.object({
    id: uuid,
    tag: isoDate.optional(),
    text: z.string().max(2000).optional(),
    situation: z.string().max(1000).optional().describe("Nur Beobachtung"),
    problematik: z.string().max(1000).optional().describe("Nur Beobachtung; leer = entfernen"),
    veraenderung: z.string().max(1000).optional().describe("Nur Beobachtung: gewünschte Veränderung; leer = entfernen"),
    vereinbart: z.string().max(500).optional().describe("Nur Paar-Gespräch"),
    wert: z.number().min(0).max(600).optional(),
    erledigt: z.boolean().optional().describe("Nur Aufgabe (einmalig) und Date-Idee"),
  }),
  // Protokoll: nur dass geändert wurde und welche Angaben – nie Inhalte.
  summary: (i) => `Privat-Eintrag geändert (${["tag", "text", "situation", "problematik", "veraenderung", "vereinbart", "wert", "erledigt"].filter((k) => (i as Record<string, unknown>)[k] !== undefined).join(", ") || "–"})`,
  run: async (ctx, i) => {
    const { id, ...a } = i;
    const r = await aendern(ctx.session, id, a);
    return r.ok ? { text: JSON.stringify({ ok: true, meldung: r.meldung, id, art: r.art, link: abs(ctx, `/privat/eintrag/${id}`) }, null, 2), ids: [id], undo: r.undo } : { text: r.meldung, isError: true };
  },
  undo: (ctx, d) => privatRueckgaengig(ctx.session, d),
});

export const privatEintragLoeschen = defineTool({
  name: "privat_eintrag_loeschen",
  title: "Privat-Eintrag löschen",
  description:
    "Löscht einen Privat-Eintrag (id aus privat_eintraege) der Arten beobachtung, tagebuch, stimmung, intim, zuwendung, gespraech, danke, dateidee, aufgabe – z. B. eine ersetzte Beobachtung. Tagebuch, Beobachtung und Stimmung nur die eigenen. Nur auf ausdrücklichen Wunsch für genau diesen Eintrag; 7 Tage rückgängig machbar (Assistent-Verlauf).",
  area: "privat",
  privat: true,
  write: true,
  input: z.object({ id: uuid }),
  summary: () => "Privat-Eintrag gelöscht",
  run: async (ctx, i) => {
    const r = await loeschen(ctx.session, i.id);
    return r.ok ? { text: JSON.stringify({ ok: true, meldung: r.meldung, id: i.id, art: r.art, rueckgaengig: "7 Tage im Assistent-Verlauf", link: abs(ctx, "/assistent-verlauf") }, null, 2), ids: [i.id], undo: r.undo } : { text: r.meldung, isError: true };
  },
  undo: (ctx, d) => privatRueckgaengig(ctx.session, d),
});

export const privatStatus = defineTool({
  name: "privat_status",
  title: "Privat-Status setzen",
  description: "Setzt den Status eines privaten Termins bzw. einer Kinderzeit/Auszeit/Paarzeit: geplant, stattgefunden oder ausgefallen (verknüpfte Einträge ziehen mit).",
  area: "privat",
  privat: true,
  write: true,
  input: z.object({ id: uuid, status }),
  summary: (i) => `Privat: Status ${i.status}`,
  run: async (ctx, i) => {
    const r = await setStatus(ctx.session, i.id, i.status);
    return r.ok ? json({ ok: true, meldung: r.message }) : { text: r.message, isError: true };
  },
});

export const privatFinanzen = defineTool({
  name: "privat_finanzen",
  title: "Privates Geld",
  description:
    "Privates Geld der angemeldeten Person (nur Privatbereich): Gehalt/Ausschüttung aus der GmbH (geplant/erhalten), private Fixkosten je Monat, Rücklagen-Ziele mit Stand, Anlagen, Monatsübersicht Privatkonto (Einnahmen, Ausgaben, größte Ausgaben), fällige Erinnerungen und offene Fragen für den Steuerberater. Keine Steuerberatung.",
  area: "privat",
  privat: true,
  write: false,
  quelle: { text: "Privatbereich (eigene Einträge, Kontoauszüge Privatkonto)" },
  input: z.object({ monat: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("JJJJ-MM, Standard: aktueller Monat") }),
  run: async (ctx, i) => {
    if (ctx.session.privateScope === "familie") return { text: "Privates Geld gehört nicht zum Familien-Zugang.", isError: true };
    const g = await finanzenLaden(ctx.session, ctx.today, i.monat);
    return json({
      monat: g.monat,
      hinweis: "Nur Zahlen und Erinnerungen – steuerliche Fragen mit dem Steuerberater klären.",
      einkommen_jahr: g.summen.einkommenJahr,
      einkommen: g.einkommen.map((e) => e.data as Einkommen).filter((e) => e.monat.startsWith(g.monat.slice(0, 4))).map((e) => ({ monat: e.monat, art: e.art, betrag: e.betrag, status: e.status })),
      fixkosten_je_monat: g.summen.fixkostenMonat,
      fixkosten: g.fixkosten.map((e) => e.data as Fixkosten).map((f) => ({ name: f.name, betrag: f.betrag, rhythmus: f.rhythmus })),
      ruecklagen: g.summen.ruecklagen.map((r) => ({ name: r.name, prozent: r.prozent, fehlt: r.fehlt, monate_bis_ziel: r.monateBisZiel })),
      anlagen: g.anlagen.map((e) => e.data as Anlage).map((a) => ({ name: a.name, art: a.art, wert: a.wert, stand_am: a.standAm, sparrate: a.sparrate })),
      anlagen_und_ruecklagen: g.summen.vermoegen,
      privatkonto: g.konto.letzterImport ? { kontostand: g.konto.stand, monat: g.konto.monat, letzter_import_bis: g.konto.letzterImport.bis } : "noch kein Kontoauszug",
      erinnerungen_faellig: g.faellig.map((e: Erinnerung) => ({ titel: e.titel, faellig: e.faellig })),
      fragen_steuerberater: g.offeneFragen.map((e) => (e.data as Steuerfrage).frage),
      link: abs(ctx, `/privat/geld${i.monat ? `?monat=${i.monat}` : ""}`),
    });
  },
});

export const PRIVAT = [privatFinanzen, privatKalender, privatEintraege, privatTermin, privatZeit, privatEintragAnlegen, privatEintragAendern, privatEintragLoeschen, privatStatus];
