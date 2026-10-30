import "server-only";
import { z } from "zod";
import { AM_ZUG_TEXT, type AmZug } from "@/lib/recht/logic";
import { defineTool, type ToolCtx } from "../types";
import { abs, json, uuid } from "./common";

// Rechtsfälle beim Anwalt (B14) – nur der Inhaber. Private Fälle nur mit Privat-Freigabe des Claude-Konnektors
// (ctx.privat); sonst höchstens als Anzahl. Keine Rechtsberatung: nur Stand, Fristen, wer am Zug ist.

const QUELLE = { text: "Rechtsfälle im Seller-System (Asana des Anwalts – nur lesen – und Mails)", jobs: ["Rechtsfälle (Asana)"] };
const privatErlaubt = (ctx: ToolCtx) => ctx.privat && ctx.session.privateAccess && ctx.session.privateScope === "voll";
const pfad = (bereich: string, id?: string) => `${bereich === "privat" ? "/privat/rechtsfaelle" : "/rechtsfaelle"}${id ? `/${id}` : ""}`;

const rechtsfaelleTool = defineTool({
  name: "rechtsfaelle",
  title: "Rechtsfälle",
  description:
    "Fälle beim Anwalt: Titel, Aktenzeichen, Status, wer am Zug ist (Anwalt/wir/Gegenseite/Gericht), nächste Frist, letzter Stand. bereich=geschaeft (Standard) oder privat (nur mit Privat-Freigabe). Keine Rechtsberatung – nur Stand laut Anwalt.",
  area: null,
  ownerOnly: true,
  write: false,
  quelle: QUELLE,
  input: z.object({ bereich: z.enum(["geschaeft", "privat"]).default("geschaeft"), status: z.string().trim().max(60).optional().describe("Teil des Status, z. B. „offen“, „zuordnen“"), abgeschlossene: z.boolean().default(false) }),
  run: async (ctx, i) => {
    if (i.bereich === "privat" && !privatErlaubt(ctx)) return { text: "Private Rechtsfälle nur mit Privat-Freigabe des Claude-Konnektors (Privatbereich).", isError: true };
    const { faelleListe } = await import("@/lib/recht/service");
    const faelle = await faelleListe(ctx.session.tenantId, i.bereich, { status: i.status, mitAbgeschlossenen: i.abgeschlossene });
    return json({
      bereich: i.bereich,
      anzahl: faelle.length,
      faelle: faelle.slice(0, 60).map((f) => ({ id: f.id, titel: f.titel, aktenzeichen: f.aktenzeichen, firma: f.firma, status: f.status, am_zug: AM_ZUG_TEXT[f.amZug as AmZug], naechste_frist: f.naechsteFrist, frist_text: f.fristText, letzter_stand: f.letzterStand, letzte_bewegung: f.letzteBewegung?.toISOString().slice(0, 10) ?? null, quelle: f.quelle, link: abs(ctx, pfad(f.bereich, f.id)) })),
      link: abs(ctx, pfad(i.bereich)),
    });
  },
});

const rechtsfallTool = defineTool({
  name: "rechtsfall",
  title: "Rechtsfall",
  description: "Ein Rechtsfall mit Verlauf (Asana-Kommentare, Mails, Fristen, Status, Entwürfe). Private Fälle nur mit Privat-Freigabe.",
  area: null,
  ownerOnly: true,
  write: false,
  quelle: QUELLE,
  input: z.object({ id: uuid }),
  run: async (ctx, { id }) => {
    const { fallMitVerlauf } = await import("@/lib/recht/service");
    const r = await fallMitVerlauf(ctx.session.tenantId, id);
    if (!r) return { text: "Fall nicht gefunden.", isError: true };
    if (r.fall.bereich === "privat" && !privatErlaubt(ctx)) return { text: "Das ist ein privater Fall – nur mit Privat-Freigabe des Claude-Konnektors.", isError: true };
    const f = r.fall;
    return json({
      id: f.id,
      titel: f.titel,
      aktenzeichen: f.aktenzeichen,
      gegenstand: f.gegenstand,
      bereich: f.bereich,
      firma: f.firma,
      status: f.status,
      am_zug: AM_ZUG_TEXT[f.amZug as AmZug],
      naechste_frist: f.naechsteFrist,
      frist_text: f.fristText,
      letzter_stand: f.letzterStand,
      asana: f.asanaUrl,
      verlauf: r.verlauf.slice(0, 40).map((e) => ({ datum: e.datum.toISOString().slice(0, 10), art: e.art, text: e.text.slice(0, e.art === "mail" ? 1500 : 800) })),
      hinweis: "Keine Rechtsberatung – Inhalte sind Stand laut Anwalt/Mails.",
      link: abs(ctx, pfad(f.bereich, f.id)),
    });
  },
});

const rechtsfristenTool = defineTool({
  name: "rechtsfristen",
  title: "Rechtsfristen",
  description: "Fristen aus Rechtsfällen in den nächsten Tagen (Standard 14). Geschäftliche mit Titel; private mit Titel nur mit Privat-Freigabe, sonst nur als Anzahl.",
  area: null,
  ownerOnly: true,
  write: false,
  quelle: QUELLE,
  input: z.object({ tage: z.number().int().min(1).max(120).default(14) }),
  run: async (ctx, { tage }) => {
    const { rechtsfristen } = await import("@/lib/recht/service");
    const alle = await rechtsfristen(ctx.session.tenantId, ctx.today, tage);
    const zeig = privatErlaubt(ctx) ? alle : alle.filter((f) => f.bereich === "geschaeft");
    return json({
      zeitraum: `${ctx.today} + ${tage} Tage`,
      fristen: zeig.map((f) => ({ tag: f.tag, bereich: f.bereich, titel: f.titel, text: f.text.slice(0, 300), link: abs(ctx, pfad(f.bereich, f.fallId)) })),
      ...(privatErlaubt(ctx) ? {} : { private_fristen_anzahl: alle.length - zeig.length }),
      link: abs(ctx, "/rechtsfaelle"),
    });
  },
});

const rechtsfallMailEntwurfTool = defineTool({
  name: "rechtsfall_mail_entwurf",
  title: "Mail-Entwurf an den Anwalt",
  description: "Legt zu einem Rechtsfall einen Mail-Entwurf an den Anwalt an (wird nie automatisch gesendet – Ludwig öffnet ihn im Fall). Nur auf ausdrücklichen Wunsch und mit genau dem gewünschten Text.",
  area: null,
  ownerOnly: true,
  write: true,
  stufe: "gelb",
  input: z.object({ id: uuid, text: z.string().trim().min(5).max(8000) }),
  summary: (i) => `Entwurf an Anwalt (${i.text.length} Zeichen)`,
  run: async (ctx, { id, text }) => {
    const { fallMitVerlauf, mailEntwurf } = await import("@/lib/recht/service");
    const r = await fallMitVerlauf(ctx.session.tenantId, id);
    if (!r) return { text: "Fall nicht gefunden.", isError: true };
    if (r.fall.bereich === "privat" && !privatErlaubt(ctx)) return { text: "Privater Fall – nur mit Privat-Freigabe des Claude-Konnektors.", isError: true };
    const e = await mailEntwurf(ctx.session.tenantId, id, text);
    if (!e) return { text: "Fall nicht gefunden.", isError: true };
    return { text: json({ ok: true, entwurf: e.id, an: e.an ?? "(Anwalts-Adresse fehlt – Einstellungen auf der Seite Rechtsfälle)", betreff: e.betreff, gesendet: false, link: abs(ctx, pfad(r.fall.bereich, id)) }), ids: [e.id] };
  },
});

export const RECHT = [rechtsfaelleTool, rechtsfallTool, rechtsfristenTool, rechtsfallMailEntwurfTool];
