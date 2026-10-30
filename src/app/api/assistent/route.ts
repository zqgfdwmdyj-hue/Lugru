import { and, desc, eq } from "drizzle-orm";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { appUrl } from "@/lib/oauth/state";
import { assistantAvailable, chatTurn, GROSSE_MENGE, visibleTranscript, type ConfirmCall } from "@/lib/assistant/chat";
import { getSettings } from "@/lib/settings";
import { prepareCall } from "@/lib/assistant/registry";

// Fragefeld: eine Runde als Ereignis-Strom (eine JSON-Zeile je Ereignis). Prüft Sitzung und Rechte selbst
// (ohne Proxy, damit auch Nur-ansehen-Konten lesend fragen können).

const CH = schema.assistantChats;

async function ctxFor(req: Request) {
  const session = await getSession();
  if (!session) return null;
  const [avail, s, [u]] = await Promise.all([assistantAvailable(session.tenantId), getSettings(session.tenantId), db.select({ sprache: schema.users.sprache }).from(schema.users).where(eq(schema.users.id, session.userId))]);
  return { session, channel: "app" as const, canWrite: avail.allowWrite && !session.readOnly, privat: false, today: todayIso(), baseUrl: appUrl(req), sprache: u?.sprache ?? undefined, stufen: s.assistant.stufen };
}

export async function POST(req: Request) {
  const ctx = await ctxFor(req);
  if (!ctx) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  // Nur JSON (Formulare fremder Seiten können diesen Typ nicht ohne Vorabprüfung senden).
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return Response.json({ error: "Nur JSON." }, { status: 415 });
  const body = (await req.json().catch(() => ({}))) as { chatId?: unknown; text?: unknown; confirm?: unknown; einzeln?: unknown; grosseMenge?: unknown };
  const einzeln = Array.isArray(body.einzeln) ? body.einzeln.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < 50) : [];
  const grosseMenge = body.grosseMenge === true;
  const chatId = typeof body.chatId === "string" && /^[0-9a-f-]{36}$/i.test(body.chatId) ? body.chatId : null;
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
  const confirm = body.confirm === true ? true : body.confirm === false ? false : undefined;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of chatTurn(ctx, { chatId, text: text || undefined, confirm, einzeln, grosseMenge })) controller.enqueue(enc.encode(`${JSON.stringify(ev)}\n`));
      } catch (e) {
        console.error("[Fragefeld]", e);
        controller.enqueue(enc.encode(`${JSON.stringify({ type: "error", message: "Unerwarteter Fehler – bitte noch einmal versuchen." })}\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

/** ?chat=<id> → sichtbarer Verlauf (+ wartende Bestätigung); ohne → die letzten eigenen Gespräche. */
export async function GET(req: Request) {
  const ctx = await ctxFor(req);
  if (!ctx) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const s = ctx.session;
  const id = new URL(req.url).searchParams.get("chat");
  if (id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Nicht gefunden." }, { status: 404 });
    const [c] = await db.select().from(CH).where(and(eq(CH.tenantId, s.tenantId), eq(CH.userId, s.userId), eq(CH.id, id)));
    if (!c) return Response.json({ error: "Nicht gefunden." }, { status: 404 });
    const pend = c.pending as { toolUses: { name: string; input: unknown; write: boolean }[]; calls?: ConfirmCall[] } | null;
    const pending = pend?.toolUses.filter((u) => u.write) ?? [];
    const calls: ConfirmCall[] | null = pending.length
      ? (pend?.calls ??
        pending.map((u) => {
          const p = prepareCall(ctx, u.name, u.input);
          return p.ok ? { title: p.tool.title, summary: p.tool.summary?.(p.input as never) ?? "" } : { title: u.name, summary: "" };
        }))
      : null;
    return Response.json({ id: c.id, messages: visibleTranscript(c.messages as BetaMessageParam[]), confirm: calls, grosseMenge: calls?.some((x) => (x.vorschau?.anzahl ?? 0) > GROSSE_MENGE) ?? false });
  }
  const rows = await db.select({ id: CH.id, title: CH.title, updatedAt: CH.updatedAt }).from(CH).where(and(eq(CH.tenantId, s.tenantId), eq(CH.userId, s.userId))).orderBy(desc(CH.updatedAt)).limit(10);
  return Response.json({ chats: rows });
}
