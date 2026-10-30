import "server-only";
import { z } from "zod";
import { antwortAnVa, vaAufgaben, vaHeute, vaNachrichtenListe, vaStatus, VN_ART, VT_STATUS } from "@/lib/va/service";
import { defineTool } from "../types";
import { abs, isoDate, json, uuid } from "./common";

// VA über Discord: Aufgaben bei der VA, ihre Nachrichten, Antwort in den Thread (nur Inhaber).

const QUELLE = { text: "Discord VA-Kanal (Abgleich alle 30 Sekunden)", jobs: ["VA (Discord)"] };

export const vaAufgabenTool = defineTool({
  name: "va_aufgaben",
  title: "Aufgaben bei der VA",
  description: "Aufgaben, die per Discord an die VA gegeben wurden: Titel, Frist, Status (offen, Rückfrage, erledigt), seit wann, letzte Erinnerung. Dazu die Tageszeile „VA heute: … erledigt, … Rückfragen, … automatisch beantwortet“.",
  area: "start",
  ownerOnly: true,
  write: false,
  quelle: QUELLE,
  input: z.object({ status: z.enum(["offen", "rueckfrage", "erledigt"]).optional().describe("leer = alle") }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const [st, rows, heute] = await Promise.all([vaStatus(t), vaAufgaben(t, i.status ?? null), vaHeute(t, ctx.today)]);
    if (!st.eingerichtet) return json({ eingerichtet: false, hinweis: "Anbindung „Discord – VA-Kanal“ fehlt (Einstellungen → Anbindungen).", link: abs(ctx, "/einstellungen/anbindungen") });
    return json({
      heute: heute?.text,
      letzter_abgleich: st.letzterAbgleich?.toISOString() ?? null,
      letzter_fehler: st.letzterFehler ?? undefined,
      aufgaben: rows.map((r) => ({ id: r.taskId, titel: r.titel, frist: r.faellig, status: VT_STATUS[r.status], im_system: r.taskStatus === "done" ? "erledigt" : "offen", seit: r.seit.toISOString().slice(0, 10), erledigt_am: r.erledigtAm?.toISOString().slice(0, 10), letzte_erinnerung: r.letzteErinnerung ?? undefined })),
      link: abs(ctx, "/delegation/va"),
    });
  },
});

export const vaNachrichtenTool = defineTool({
  name: "va_nachrichten",
  title: "Nachrichten der VA",
  description: "Nachrichten der VA aus dem Discord-Kanal und den Aufgaben-Threads mit Einordnung (Bitte, Frage, Info, erledigt, Rückfrage), automatischer Antwort und ob Ludwigs Antwort noch fehlt. Text auf Deutsch (englische Nachrichten übersetzt, Original im Feld „original“). Standard: letzte 7 Tage.",
  area: "start",
  ownerOnly: true,
  write: false,
  quelle: QUELLE,
  input: z.object({ seit: isoDate.optional().describe("ab diesem Tag (YYYY-MM-DD)"), nur_offen: z.boolean().default(false).describe("nur Fragen/Bitten ohne Antwort") }),
  run: async (ctx, i) => {
    const seit = new Date(`${i.seit ?? new Date(Date.parse(`${ctx.today}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`);
    const rows = await vaNachrichtenListe(ctx.session.tenantId, { seit, nurOffen: i.nur_offen, limit: 80 });
    return json({
      seit: seit.toISOString().slice(0, 10),
      nachrichten: rows.map(({ n, aufgabe }) => ({
        id: n.id,
        zeit: n.gesendetAm.toISOString(),
        text: n.text.slice(0, 500),
        original: n.original ? { sprache: n.sprache ?? "en", text: n.original.slice(0, 500) } : undefined,
        art: VN_ART[n.art] ?? n.art,
        aufgabe: aufgabe ?? undefined,
        automatisch_beantwortet: n.autoBeantwortet || undefined,
        antwort: n.antwort?.slice(0, 300) ?? undefined,
        wartet_auf_antwort: Boolean(n.ludwigTaskId && !n.beantwortetAm) || undefined,
        dateien: n.dateiIds.length ? n.dateiIds.map((d) => abs(ctx, `/datei/${d}`)) : undefined,
      })),
      link: abs(ctx, "/delegation/va"),
    });
  },
});

export const vaNachrichtTool = defineTool({
  name: "va_nachricht",
  title: "Nachricht an die VA",
  description: "Schreibt der VA im Discord: mit aufgabe_id in den Thread dieser Aufgabe (beantwortet offene Rückfragen dort und hakt Ludwigs Rückfrage-Aufgabe ab), mit nachricht_id als Antwort auf eine bestimmte Nachricht (aus va_nachrichten), sonst in den VA-Kanal. Text auf Deutsch – an eine englischsprachige VA geht er automatisch übersetzt (Glossar; Nummern, Beträge und Links unverändert). Nur auf ausdrücklichen Wunsch benutzen.",
  area: "start",
  ownerOnly: true,
  write: true,
  input: z.object({ aufgabe_id: uuid.optional(), nachricht_id: uuid.optional(), text: z.string().trim().min(1).max(3800) }),
  summary: (i) => `An die VA: ${i.text.slice(0, 80)}`,
  run: async (ctx, i) => {
    const r = await antwortAnVa(ctx.session.tenantId, { nachrichtId: i.nachricht_id ?? null, taskId: i.nachricht_id ? null : (i.aufgabe_id ?? null) }, i.text, ctx.session.name);
    if (!r.ok) return { text: r.fehler, isError: true };
    return json({ ok: true, meldung: r.wo === "thread" ? "Im Thread an die VA geschickt." : "Im VA-Kanal gepostet.", link: abs(ctx, "/delegation/va") });
  },
});

export const VA = [vaAufgabenTool, vaNachrichtenTool, vaNachrichtTool];
