import "server-only";
import { z } from "zod";
import { abholOrte, abholungBuchen, abholungenListe, abholungLaden, abholungStornieren, abholungVorbereiten, labelsBereit, type AbholWunsch } from "@/lib/abholung/service";
import { datumText, DIENST_NAME, DHL_ART, naechsterAbholtag } from "@/lib/abholung/logic";
import { defineTool, type ToolDef } from "../types";
import { abs, actorOf, json, uuid } from "./common";

// Bauauftrag Abholung DHL/UPS: buchen per Sprache über Claude („DHL-Abholung morgen 10 bis 12 Uhr, 15 Pakete“) –
// erst Rückfrage mit Zusammenfassung, nach ausdrücklichem Ja buchen; stornieren über denselben Weg; Protokoll lesen.

const eingabe = z.object({
  dienst: z.enum(["dhl", "ups"]).describe("dhl oder ups"),
  datum: z.string().trim().max(30).optional().describe("Wie gesagt: „morgen“, „übermorgen“, „Montag“, „7.11.“ oder JJJJ-MM-TT. Leer = nächster Abholtag."),
  zeitfenster: z.string().trim().max(40).optional().describe("Wie gesagt, z. B. „10-12“ oder „10 bis 12 Uhr“. Leer = Standardfenster des Abholorts."),
  pakete: z.number().int().min(0).max(999).describe("Anzahl Pakete (genau die genannte Zahl)"),
  paletten: z.number().int().min(0).max(99).optional(),
  gewicht_kg: z.number().positive().max(99999).optional().describe("Gesamtgewicht in kg, nur wenn genannt"),
  abholort: z.string().trim().max(60).optional().describe("Schlüssel oder Name des Abholorts aus „abholungen“ (z. B. die Firma). Leer = Standardort."),
  hinweis: z.string().trim().max(200).optional().describe("Hinweis für den Fahrer – nur wenn genannt, sonst der hinterlegte"),
  bestaetigt: z.boolean().optional().describe("Erst weglassen: Das Werkzeug prüft und liefert die Zusammenfassung für die Rückfrage. Erst nach ausdrücklichem Ja des Nutzers mit true aufrufen – dann wird verbindlich gebucht."),
});

const wunsch = (i: z.infer<typeof eingabe>): AbholWunsch => ({ dienst: i.dienst, datum: i.datum ?? null, fenster: i.zeitfenster ?? null, pakete: i.pakete, paletten: i.paletten ?? 0, gewichtKg: i.gewicht_kg ?? null, ort: i.abholort ?? null, hinweis: i.hinweis ?? null });

export const abholungAnlegen = defineTool({
  name: "abholung_anlegen",
  title: "Abholung buchen (DHL/UPS)",
  description:
    "Bucht eine Paket-Abholung bei DHL (Geschäftskunden) oder UPS am hinterlegten Abholort. Nur auf ausdrücklichen Wunsch und mit genau den genannten Angaben. Ablauf: 1) ohne „bestaetigt“ aufrufen → Zusammenfassung und Hinweise dem Nutzer zeigen und fragen „Soll ich so buchen?“; 2) nur nach ausdrücklichem Ja mit bestaetigt=true erneut aufrufen → Bestätigungsnummer zurückmelden. DHL bucht keine feste Uhrzeit (Fenster = Öffnungszeit), mehr als 10 Pakete sind bei DHL eine Anfrage mit Bestätigung per Mail.",
  area: "service",
  write: true,
  stufe: "gelb",
  input: eingabe,
  summary: (i) => `${DIENST_NAME[i.dienst]}-Abholung ${i.datum ?? "nächster Abholtag"}${i.zeitfenster ? `, ${i.zeitfenster}` : ""}, ${i.pakete} Pakete${i.abholort ? `, ${i.abholort}` : ""}`,
  vorschau: async (ctx, i) => {
    const v = await abholungVorbereiten(ctx.session.tenantId, wunsch(i));
    return v.ok ? { anzahl: 1, beispiele: [v.zusammenfassung, ...v.hinweise] } : { anzahl: 0, beispiele: [], ausgeschlossen: { anzahl: 1, grund: v.fehler.join(" "), beispiele: v.zusammenfassung ? [v.zusammenfassung] : [] } };
  },
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    // Im Fragefeld bestätigt die Person vorher in der Oberfläche (Vorschau) – dort direkt buchen.
    if (!i.bestaetigt && ctx.channel !== "app") {
      const v = await abholungVorbereiten(t, wunsch(i));
      if (!v.ok) return { text: json({ gebucht: false, fehler: v.fehler, hinweise: v.hinweise, zusammenfassung: v.zusammenfassung, abholorte: v.orte, link: abs(ctx, "/versand/abholung") }), isError: true };
      return json({ gebucht: false, rueckfrage: `Soll ich das so buchen? ${v.zusammenfassung}`, zusammenfassung: v.zusammenfassung, hinweise: v.hinweise, naechster_schritt: "Nach ausdrücklichem Ja mit denselben Angaben und bestaetigt=true aufrufen." });
    }
    const a = actorOf(ctx);
    const r = await abholungBuchen(t, { userId: a.userId, name: a.userName }, wunsch(i), ctx.channel === "claude" ? "claude" : "seite");
    if (!r.ok) return { text: json({ gebucht: false, fehler: r.fehler, protokoll: r.id ? abs(ctx, "/versand/abholung") : undefined }), isError: true };
    return { text: json({ gebucht: true, status: r.status, bestaetigungsnummer: r.bestaetigung, meldung: r.text, hinweise: r.hinweise, link: abs(ctx, "/versand/abholung") }), ids: [r.id], undo: { id: r.id } };
  },
  undo: async (ctx, daten) => {
    const id = (daten as { id?: string })?.id;
    if (!id) return "Nichts zum Rückgängigmachen.";
    const a = actorOf(ctx);
    return (await abholungStornieren(ctx.session.tenantId, { userId: a.userId, name: a.userName }, id)).text;
  },
});

export const abholungStornierenTool = defineTool({
  name: "abholung_stornieren",
  title: "Abholung stornieren (DHL/UPS)",
  description: "Storniert eine gebuchte DHL- oder UPS-Abholung über die Schnittstelle (DHL: Auftragsnummer, UPS: PRN). Nur auf ausdrücklichen Wunsch; die Kennung kommt aus „abholungen“.",
  area: "service",
  write: true,
  stufe: "gelb",
  input: z.object({ id: uuid }),
  summary: () => "Abholung stornieren",
  vorschau: async (ctx, i) => {
    const a = await abholungLaden(ctx.session.tenantId, i.id);
    return a ? { anzahl: 1, beispiele: [`${DIENST_NAME[a.dienst]} ${datumText(a.datum)}, ${a.pakete} Pakete, ${a.ortName} – Nr. ${a.bestaetigung ?? "–"}`] } : { anzahl: 0, beispiele: [] };
  },
  run: async (ctx, i) => {
    const a = actorOf(ctx);
    const r = await abholungStornieren(ctx.session.tenantId, { userId: a.userId, name: a.userName }, i.id);
    return r.ok ? json({ ok: true, meldung: r.text }) : { text: r.text, isError: true };
  },
});

const STATUS: Record<string, string> = { gebucht: "gebucht", angefragt: "angefragt (Bestätigung per Mail)", storniert: "storniert", fehler: "nicht gebucht (Fehler)" };

export const abholungenTool = defineTool({
  name: "abholungen",
  title: "Abholungen (DHL/UPS)",
  description: "Protokoll der DHL-/UPS-Abholungen (Dienst, Datum, Fenster, Pakete, Bestätigungsnummer, wer gebucht/storniert hat), die hinterlegten Abholorte und wie viele Labels heute fertig sind. Vor „abholung_anlegen“ nutzen, wenn der Abholort unklar ist.",
  area: "service",
  write: false,
  input: z.object({ nur_offen: z.boolean().optional().describe("Nur kommende, gebuchte Abholungen") }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const [liste, orte, dhl, ups] = await Promise.all([abholungenListe(t, { nurOffen: i.nur_offen, limit: 50 }), abholOrte(t), labelsBereit(t, "dhl"), labelsBereit(t, "ups")]);
    return json({
      abholorte: orte.map((o) => ({ schluessel: o.key, name: o.name, ort: `${o.plz} ${o.ort}`, standard: o.standard || undefined, fenster: o.von && o.bis ? `${o.von}–${o.bis}` : undefined })),
      labels_heute: { dhl, ups },
      naechster_abholtag: { dhl: naechsterAbholtag("dhl"), ups: naechsterAbholtag("ups") },
      abholungen: liste.map((a) => ({
        id: a.id,
        dienst: DIENST_NAME[a.dienst],
        datum: a.datum,
        fenster: a.zeitVon && a.zeitBis ? `${a.zeitVon}–${a.zeitBis}` : undefined,
        pakete: a.pakete,
        paletten: a.paletten || undefined,
        abholort: a.ortName,
        status: STATUS[a.status] ?? a.status,
        bestaetigungsnummer: a.bestaetigung ?? undefined,
        art: a.abholArt ? (DHL_ART[a.abholArt] ?? a.abholArt) : undefined,
        gebucht_von: a.gebuchtVonName ?? undefined,
        storniert_von: a.storniertVonName ?? undefined,
        fehler: a.fehler ?? undefined,
      })),
      link: abs(ctx, "/versand/abholung"),
    });
  },
});

export const ABHOLUNG: ToolDef[] = [abholungAnlegen, abholungStornierenTool, abholungenTool];
