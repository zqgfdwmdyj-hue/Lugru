import "server-only";
import { z } from "zod";
import { linkAllowed } from "@/lib/auth/areas";
import type { Session } from "@/lib/auth/session";
import type { ToolCtx } from "../types";

export const json = (o: unknown) => JSON.stringify(o);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als JJJJ-MM-TT");
export const uuid = z.string().regex(/^[0-9a-f-]{36}$/i, "Kennung (UUID) aus einer vorherigen Abfrage");
export const abs = (ctx: Pick<ToolCtx, "baseUrl">, path: string) => `${ctx.baseUrl}${path}`;
export const round2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);
export const dmy = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : null);
/** Für ILIKE: Platzhalter aus der Eingabe entschärfen. */
export const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
export const berlinDateTime = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d) : null;

/** Wer hat es getan – im Verlauf steht, dass es über den Assistenten kam. */
export const actorOf = (ctx: ToolCtx) => ({ userId: ctx.session.userId, userName: `${ctx.session.name || ctx.session.email} (über ${ctx.channel === "claude" ? "Claude" : "Assistent"})` });

/** Aufgaben-Sichtbarkeit wie auf der Startseite: eingeschränkte Mitarbeiter nur freigegebene Bereiche und eigene. */
export function visibleTask(s: Session, t: { link: string | null; createdBy: string | null }) {
  const restricted = s.role === "staff" && s.areas !== null;
  const brandLimited = s.role === "staff" && s.brandIds !== null;
  if (!restricted && !brandLimited) return true;
  return t.link ? linkAllowed(s, t.link) : !restricted || t.createdBy === s.userId;
}

export const PRIORITY_IN = { wichtig: "critical", normal: "normal", niedrig: "low" } as const;
export const PRIORITY_OUT: Record<string, string> = { critical: "wichtig", normal: "normal", low: "niedrig" };

export const taskBrief = (t: { id: string; title: string; dueDate: string | null; priority: string; category: string; status: string; notes: string | null; link: string | null; assigneeId?: string | null; anleitungIds?: string[] }, ctx: ToolCtx) => ({
  id: t.id,
  titel: t.title,
  faellig: t.dueDate,
  prioritaet: PRIORITY_OUT[t.priority] ?? t.priority,
  kategorie: t.category,
  status: t.status === "done" ? "erledigt" : "offen",
  notiz: t.notes ? t.notes.slice(0, 300) : undefined,
  zugewiesen: t.assigneeId ? true : undefined,
  anleitungen: t.anleitungIds?.length ? t.anleitungIds.map((id) => abs(ctx, `/wissen/${id}`)) : undefined,
  link: t.link ? abs(ctx, t.link) : undefined,
});
