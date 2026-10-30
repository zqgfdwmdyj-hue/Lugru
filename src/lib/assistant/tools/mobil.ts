import "server-only";
import { z } from "zod";
import { defineTool } from "../types";
import { abs, json } from "./common";

// Handy & Tesla (B13) für Claude im Sprachmodus: jede Antwort hat ein Feld `vorlesen` (kurzer Satz, keine Tabellen).

const fahrtBriefingTool = defineTool({
  name: "fahrt_briefing",
  title: "Fahrt-Briefing",
  description:
    "Vorlesbares Briefing für die Fahrt (≤ 60 Sekunden) passend zum Ziel – Lager/Prep Center (Remissionen, Retouren, FBM, Paletten), Lieferant (offene Bestellvorschläge, letzte Preisliste, offene Rechnungen), Post (Pakete), Heimweg (Feierabend kurz), sonst Morgenbericht – plus Anrufe, die in die Fahrzeit passen. Im Sprachmodus nur das Feld `vorlesen` sprechen.",
  area: null,
  write: false,
  input: z.object({ ziel: z.string().trim().max(200).optional().describe("Adresse, Ort oder Name (leer = Navi-Ziel bzw. nächster Termin mit Ort)"), minuten: z.number().int().min(1).max(240).optional() }),
  run: async (ctx, i) => {
    const { fahrtBriefing } = await import("@/lib/mobil/service");
    return json({ ...(await fahrtBriefing(ctx.session, { ziel: i.ziel ?? null, minuten: i.minuten ?? null, heute: ctx.today })), link: abs(ctx, "/kalender/tagesplan") });
  },
});

const anrufAufgabenTool = defineTool({
  name: "anruf_aufgaben",
  title: "Anruf-Aufgaben",
  description: "Offene Aufgaben vom Typ „Anruf“ (anrufen, zurückrufen, telefonieren) mit Telefonnummer (aus Aufgabe, Notiz oder Lieferanten-Profil), wichtige zuerst. Feld `vorlesen` für den Sprachmodus.",
  area: null,
  write: false,
  input: z.object({}),
  run: async (ctx) => {
    const { anrufAufgaben } = await import("@/lib/mobil/service");
    const { fahrtAnsage } = await import("@/lib/mobil/logic");
    const a = await anrufAufgaben(ctx.session);
    return json({ anzahl: a.length, anrufe: a.slice(0, 20).map((x) => ({ id: x.id, name: x.name, titel: x.titel, telefon: x.telefon, faellig: x.faellig, wichtig: x.prioritaet === "critical" })), vorlesen: fahrtAnsage(null, a.slice(0, 5)).replace(/^Gute Fahrt\. /, ""), link: abs(ctx, "/?ansicht=liste") });
  },
});

const anrufErledigtTool = defineTool({
  name: "anruf_erledigt",
  title: "Anruf erledigt",
  description: "Hakt eine Anruf-Aufgabe ab und speichert die Notiz (z. B. „nimmt 60 Stück“). Nur auf ausdrücklichen Wunsch. Folgeaufgaben nur als Vorschlag.",
  area: null,
  write: true,
  input: z.object({ id: z.string().uuid(), notiz: z.string().trim().max(500).optional() }),
  summary: (i) => `Anruf erledigt${i.notiz ? ` – Notiz: ${i.notiz.slice(0, 60)}` : ""}`,
  run: async (ctx, i) => {
    const { anrufErledigen } = await import("@/lib/mobil/service");
    const r = await anrufErledigen(ctx.session, { id: i.id, notiz: i.notiz ?? null });
    return { text: JSON.stringify(r), isError: !r.ok, ids: r.ok ? [i.id] : [] };
  },
});

const autoNaviTool = defineTool({
  name: "auto_navi",
  title: "Navi-Ziel ans Auto",
  description: "Schickt ein Navigationsziel an den Tesla (Fleet API). Nur auf ausdrücklichen Wunsch und nur für den Inhaber. Kein Laden, keine anderen Befehle; Klima nur, wenn ausdrücklich gewünscht.",
  area: null,
  ownerOnly: true,
  write: true,
  stufe: "gelb",
  input: z.object({ ziel: z.string().trim().min(3).max(300), klima: z.boolean().default(false) }),
  summary: (i) => `Navi-Ziel ans Auto: ${i.ziel.slice(0, 60)}${i.klima ? " + Klima" : ""}`,
  run: async (ctx, i) => {
    const { insAuto } = await import("@/lib/mobil/service");
    const r = await insAuto(ctx.session, i.ziel, { klima: i.klima });
    return { text: JSON.stringify({ ok: r.ok, vorlesen: r.text }), isError: !r.ok };
  },
});

const scanPruefenTool = defineTool({
  name: "scan_pruefen",
  title: "Scan prüfen (Deal-Ampel)",
  description: "EAN/ASIN + Einkaufspreis (brutto Standard) → Ampel, bestes Land, Gewinn/Stück, ROI, Angebote, empfohlene Menge, eigener Bestand/Kapital-Ampel. Wie deal_pruefen, mit Satz `vorlesen` („Grün. Frankreich. 4 Euro 20 pro Stück …“).",
  area: ["lieferanten", "dealeingang", "wawi"],
  write: false,
  input: z.object({ ean: z.string().trim().min(8).max(40), preis: z.number().positive().max(100000), menge: z.number().int().positive().max(100000).optional(), netto: z.boolean().default(false) }),
  run: async (ctx, i) => {
    const { scanPruefen } = await import("@/lib/mobil/service");
    try {
      return json({ ...(await scanPruefen(ctx.session.tenantId, { ean: i.ean, preis: i.preis, menge: i.menge ?? null, netto: i.netto })), link: abs(ctx, "/scan") });
    } catch (e) {
      return { text: JSON.stringify({ fehler: e instanceof Error ? e.message : String(e), vorlesen: "Das konnte ich nicht prüfen." }), isError: true };
    }
  },
});

export const MOBIL = [fahrtBriefingTool, anrufAufgabenTool, anrufErledigtTool, autoNaviTool, scanPruefenTool];
