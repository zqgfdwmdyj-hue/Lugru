import "server-only";
import { z } from "zod";
import { PUNKT_TEXT } from "@/lib/calls/logic";
import { callDetail, callsDurchsuchen, callsListe } from "@/lib/calls/service";
import { defineTool } from "../types";
import { abs, json } from "./common";

// Call-Archiv (nur lesen): Calls mit dem Consultant, Wochen-Calls der Deal-Gruppe und die daraus gezogenen Punkte.

export const calls = defineTool({
  name: "calls",
  title: "Calls (Consultant & Deal-Gruppe)",
  description:
    "Liste der Calls im Call-Archiv – Calls mit dem Amazon-Consultant (SAS-Programm) und Wochen-Calls der Deal-Gruppe: Datum, Titel, Art, Quelle, Überblick, wie viele Punkte noch zu prüfen sind, Aufgaben und offene Fragen. Optional Zeitraum und Art. Für Details und Punkte eines Calls „call_aufgaben“ mit der call_id.",
  area: "amazon",
  write: false,
  quelle: { text: "Call-Archiv im Seller-System (Import aus Google Docs/Discord, KI-Auswertung)" },
  input: z.object({
    von: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ab Datum (JJJJ-MM-TT)"),
    bis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("bis Datum (JJJJ-MM-TT)"),
    art: z.enum(["consultant", "gruppe"]).optional().describe("nur Consultant-Calls oder nur Wochen-Calls der Deal-Gruppe"),
  }),
  run: async (ctx, i) => {
    const liste = await callsListe(ctx.session.tenantId, { von: i.von, bis: i.bis, art: i.art });
    return json({
      zeitraum: i.von || i.bis ? { von: i.von ?? "Anfang", bis: i.bis ?? "heute" } : "alle",
      calls: liste.map((c) => ({ call_id: c.id, datum: c.datum, titel: c.titel, art: c.art === "gruppe" ? "Wochen-Call Deal-Gruppe" : "Consultant-Call", quelle: c.quelle, teilnehmer: c.zusammenfassung?.teilnehmer?.length ? c.zusammenfassung.teilnehmer : undefined, ueberblick: c.zusammenfassung?.ueberblick || undefined, auswertung: c.auswertung, zu_pruefen: c.vorschlaege, aufgaben: c.aufgaben, offene_fragen: c.fragenOffen, link: abs(ctx, `/calls/${c.id}`) })),
      offene_punkte: abs(ctx, "/calls/offen"),
      link: abs(ctx, "/calls"),
    });
  },
});

export const callAufgaben = defineTool({
  name: "call_aufgaben",
  title: "Punkte eines Calls",
  description:
    "Zusammenfassung (Überblick, Teilnehmer, Themen) sowie Vereinbarungen, Aufgaben (mit Verantwortlichem, Frist und Stand der Aufgabe), Entscheidungen und offene Fragen eines Calls (Consultant oder Deal-Gruppe) – mit Fundstelle im Transkript. Die call_id kommt aus „calls“.",
  area: "amazon",
  write: false,
  quelle: { text: "Call-Archiv im Seller-System" },
  input: z.object({ call_id: z.string().uuid().optional().describe("ID aus „calls“; ohne: der jüngste Call") }),
  run: async (ctx, i) => {
    const id = i.call_id ?? (await callsListe(ctx.session.tenantId))[0]?.id;
    if (!id) return json({ gefunden: false, hinweis: "Noch keine Calls im Archiv.", link: abs(ctx, "/calls") });
    const d = await callDetail(ctx.session.tenantId, id);
    if (!d) return json({ gefunden: false, link: abs(ctx, "/calls") });
    return json({
      call: { call_id: d.call.id, titel: d.call.titel, datum: d.call.datum, art: d.call.art === "gruppe" ? "Wochen-Call Deal-Gruppe" : "Consultant-Call", auswertung: d.call.auswertung, google_doc: d.call.quelleUrl ?? undefined },
      zusammenfassung: d.call.zusammenfassung ? { ueberblick: d.call.zusammenfassung.ueberblick, teilnehmer: d.call.zusammenfassung.teilnehmer, themen: d.call.zusammenfassung.themen } : undefined,
      punkte: d.punkte.map((p) => ({ art: PUNKT_TEXT[p.art], text: p.text, verantwortlich: p.verantwortlich ?? undefined, frist: p.frist ?? undefined, status: p.status, aufgabe: p.taskId ? (p.aufgabeStatus === "done" ? "erledigt" : "offen") : undefined, zitat: p.zitat ?? undefined, link: abs(ctx, `/calls/${p.callId}#p-${p.id}`) })),
      link: abs(ctx, `/calls/${d.call.id}`),
    });
  },
});

export const callsSuchen = defineTool({
  name: "calls_durchsuchen",
  title: "In allen Calls suchen",
  description:
    "Volltextsuche über alle Call-Transkripte und Zusammenfassungen (Wochen-Calls der Deal-Gruppe, Consultant-Calls, Zusammenfassungen der Gruppen-Chats – Feld herkunft call|chat): Was wurde wann zu einem Thema, Anbieter, Tool oder Trick gesagt? Liefert je Call Datum, Titel und wörtliche Ausschnitte mit Link. Für zusammengefasstes Wissen zuerst „wissen“ (herkunft call).",
  area: "amazon",
  write: false,
  quelle: { text: "Call-Archiv im Seller-System (Transkripte, wörtlich)" },
  input: z.object({
    suche: z.string().trim().min(2).max(100).describe("Suchwörter, z. B. „Temu Sperre“ oder ein Anbietername"),
    art: z.enum(["consultant", "gruppe"]).optional().describe("nur Consultant-Calls oder nur Wochen-Calls der Deal-Gruppe"),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  run: async (ctx, i) => {
    const treffer = await callsDurchsuchen(ctx.session.tenantId, i.suche, { art: i.art, limit: i.limit });
    return json({
      suche: i.suche,
      calls: treffer.map((c) => ({ call_id: c.id, datum: c.datum, titel: c.titel, herkunft: c.quelle === "chat" ? "chat" : "call", art: c.quelle === "chat" ? "Chat-Zusammenfassung Deal-Gruppe" : c.art === "gruppe" ? "Wochen-Call Deal-Gruppe" : "Consultant-Call", alle_suchwoerter: c.alleWoerter, treffer: c.treffer, ausschnitte: c.ausschnitte, link: abs(ctx, `/calls/${c.id}`) })),
      hinweis: treffer.length ? "Ausschnitte sind wörtlich aus dem Transkript (automatische Mitschrift – Namen und Zahlen können falsch erkannt sein)." : "Nichts gefunden – andere Wörter oder „wissen“ versuchen.",
      link: abs(ctx, "/calls"),
    });
  },
});

export const CALLS = [calls, callAufgaben, callsSuchen];
