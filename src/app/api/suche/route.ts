import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { productSearch } from "@/lib/products/service";

// ⌘K-Suche: Aufgaben, Produkte und Mails (Seiten sucht die Leiste selbst). Wie die Seite „Suche“ nur für Inhaber und
// Mitarbeiter ohne Bereichs-Einschränkung; Mails nur mit Zugriff auf den Posteingang. Privates kommt hier nie vor.

export const dynamic = "force-dynamic";

type Treffer = { art: "aufgabe" | "produkt" | "mail"; titel: string; zusatz?: string; link: string };

export async function GET(request: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2 || (s.role === "staff" && s.areas !== null)) return Response.json({ treffer: [] }, { headers: { "Cache-Control": "no-store" } });
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const T = schema.tasks;
  const M = schema.emails;
  const [aufgaben, produkte, mails] = await Promise.all([
    db.select({ id: T.id, titel: T.title, status: T.status, link: T.link }).from(T).where(and(eq(T.tenantId, s.tenantId), ilike(T.title, like))).orderBy(desc(T.createdAt)).limit(6),
    productSearch(s.tenantId, q, 6).catch(() => ({ rows: [], total: 0 })),
    canAccess(s, "posteingang")
      ? db.select({ id: M.id, betreff: M.subject, von: M.fromName, adresse: M.fromAddress }).from(M).where(and(eq(M.tenantId, s.tenantId), or(ilike(M.subject, like), ilike(M.fromName, like), ilike(M.fromAddress, like)))).orderBy(desc(M.receivedAt)).limit(6)
      : Promise.resolve([]),
  ]);
  const treffer: Treffer[] = [
    ...aufgaben.map((t) => ({ art: "aufgabe" as const, titel: `${t.status === "done" ? "✓ " : ""}${t.titel}`, link: t.link?.startsWith("/") ? t.link : `/suche?q=${encodeURIComponent(q)}` })),
    ...produkte.rows.map((p) => ({ art: "produkt" as const, titel: p.title ?? p.skus[0] ?? "Produkt", zusatz: p.skus.slice(0, 2).join(", "), link: p.href })),
    ...mails.map((m) => ({ art: "mail" as const, titel: m.betreff ?? "(ohne Betreff)", zusatz: m.von ?? m.adresse ?? undefined, link: `/posteingang/${m.id}` })),
  ];
  return Response.json({ treffer }, { headers: { "Cache-Control": "no-store" } });
}
