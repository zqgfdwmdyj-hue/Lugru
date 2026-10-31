import { canAccess } from "@/lib/auth/areas";
import type { Session } from "@/lib/auth/session";
import type { ToolDef } from "./types";

// Wer darf welches Werkzeug? Reine Logik (ohne Datenbank) – gemeinsam für Claude-Konnektor und Fragefeld.

type Access = Pick<Session, "role" | "areas" | "readOnly" | "privateAccess">;
type Perm = Pick<ToolDef, "ownerOnly" | "privat" | "write" | "area">;

export function toolAllowed(ctx: { session: Access; canWrite: boolean; privat: boolean }, t: Perm): boolean {
  if (t.ownerOnly && ctx.session.role !== "owner") return false;
  if (t.privat && !(ctx.privat && ctx.session.privateAccess && !ctx.session.readOnly)) return false;
  if (t.write && (!ctx.canWrite || ctx.session.readOnly)) return false;
  const areas = t.area === null ? [] : Array.isArray(t.area) ? t.area : [t.area];
  return areas.length === 0 || areas.some((a) => canAccess(ctx.session, a));
}

export type ChannelRights = { lesen: string[]; aendern: string[] };
export type AccountRights = {
  /** Fragefeld im Seller-System: Bereiche des Kontos, nie Privat; Ändern nur wenn erlaubt und nach Bestätigung. */
  fragefeld: ChannelRights;
  /** Claude-Konnektor: nur der Inhaber kann verbinden; Rechte höchstens wie bei der Freigabe (lesen/ändern/privat). */
  claude: ChannelRights | null;
};

/**
 * Welche Werkzeuge hätte ein Konto in den beiden Wegen? Für Einstellungen → Claude („Wer darf was“) und die Abnahme.
 * Beim Claude-Konnektor gilt die größtmögliche Freigabe (lesen + ändern + privat) – die tatsächliche steht je Verbindung.
 */
export function accountRights<T extends Perm & { name: string }>(tools: T[], a: Access, o: { allowWrite: boolean }): AccountRights {
  const pick = (canWrite: boolean, privat: boolean): ChannelRights => {
    const ok = tools.filter((t) => toolAllowed({ session: a, canWrite, privat }, t));
    return { lesen: ok.filter((t) => !t.write).map((t) => t.name), aendern: ok.filter((t) => t.write).map((t) => t.name) };
  };
  return {
    fragefeld: pick(o.allowWrite && !a.readOnly, false),
    claude: a.role === "owner" ? pick(!a.readOnly, a.privateAccess) : null,
  };
}
