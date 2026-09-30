import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { areaForPath, canAccess, homeFor, type Access } from "@/lib/auth/areas";

// Vorprüfung jeder Anfrage: ohne Sitzungs-Cookie zum Login; Mitarbeiter nur in freigegebene
// Bereiche (Seiten und Server Actions). Die Server Actions prüfen den
// Bereich zusätzlich selbst (requireArea).

const cache = new Map<string, { access: Access | null; at: number }>();
const TTL_MS = 30_000;

async function accessFor(token: string): Promise<Access | null> {
  const id = createHash("sha256").update(token).digest("hex");
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.access;
  const [row] = await db
    .select({ role: schema.memberships.role, areas: schema.memberships.areas })
    .from(schema.sessions)
    .innerJoin(schema.memberships, and(eq(schema.memberships.userId, schema.sessions.userId), eq(schema.memberships.tenantId, schema.sessions.tenantId)))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())));
  const access = row ? { role: row.role, areas: row.areas ?? null } : null;
  if (cache.size > 5000) cache.clear();
  cache.set(id, { access, at: Date.now() });
  return access;
}

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("session")?.value;
  const path = request.nextUrl.pathname;
  if (!token) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const area = areaForPath(path);
  if (!area) return NextResponse.next();
  const access = await accessFor(token).catch(() => null);
  // Ohne gültige Sitzung entscheidet die Seite selbst (requireSession → Login).
  if (!access || canAccess(access, area)) return NextResponse.next();
  if (request.method !== "GET" || path.startsWith("/api/")) {
    return NextResponse.json({ error: "Für diesen Bereich hast du keine Freigabe." }, { status: 403 });
  }
  const home = homeFor(access);
  const target = new URL(home === path ? "/kein-zugriff" : home, request.url);
  target.searchParams.set("gesperrt", "1");
  return NextResponse.redirect(target);
}

export const config = {
  // api/ebay und api/import ohne Proxy (große Uploads würden sonst gekürzt) – sie prüfen Sitzung und Bereich selbst.
  matcher: ["/((?!login|api/oauth|api/cron|api/ebay|api/import|api/public|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
