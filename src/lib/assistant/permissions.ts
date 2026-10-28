import { canAccess } from "@/lib/auth/areas";
import type { ToolCtx, ToolDef } from "./types";

// Wer darf welches Werkzeug? Reine Logik (ohne Datenbank) – gemeinsam für Claude-Konnektor und Fragefeld.
export function toolAllowed(ctx: Pick<ToolCtx, "session" | "canWrite" | "privat">, t: Pick<ToolDef, "ownerOnly" | "privat" | "write" | "area">): boolean {
  if (t.ownerOnly && ctx.session.role !== "owner") return false;
  if (t.privat && !(ctx.privat && ctx.session.privateAccess && !ctx.session.readOnly)) return false;
  if (t.write && (!ctx.canWrite || ctx.session.readOnly)) return false;
  const areas = t.area === null ? [] : Array.isArray(t.area) ? t.area : [t.area];
  return areas.length === 0 || areas.some((a) => canAccess(ctx.session, a));
}
