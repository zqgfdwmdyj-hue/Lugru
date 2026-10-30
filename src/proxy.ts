import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { areaForPath, canAccess, homeFor, type Access } from "@/lib/auth/areas";

// Vorprüfung jeder Anfrage: ohne Sitzungs-Cookie zum Login; Mitarbeiter nur in freigegebene
// Bereiche (Seiten und Server Actions). Die Server Actions prüfen den
// Bereich zusätzlich selbst (requireArea).

type ProxyAccess = Access & { readOnly: boolean };
const cache = new Map<string, { access: ProxyAccess | null; at: number }>();
const TTL_MS = 30_000;

async function accessFor(token: string): Promise<ProxyAccess | null> {
  const id = createHash("sha256").update(token).digest("hex");
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.access;
  const [row] = await db
    .select({ role: schema.memberships.role, areas: schema.memberships.areas, readOnly: schema.memberships.readOnly, privateAccess: schema.memberships.privateAccess })
    .from(schema.sessions)
    .innerJoin(schema.memberships, and(eq(schema.memberships.userId, schema.sessions.userId), eq(schema.memberships.tenantId, schema.sessions.tenantId)))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())));
  const access = row ? { role: row.role, areas: row.areas ?? null, readOnly: row.role === "staff" && row.readOnly, privateAccess: row.privateAccess } : null;
  if (cache.size > 5000) cache.clear();
  cache.set(id, { access, at: Date.now() });
  return access;
}

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("session")?.value;
  const path = request.nextUrl.pathname;
  if (!token) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const login = new URL("/login", request.url);
    // Claude-Freigabe: nach dem Login dorthin zurück.
    if (path === "/oauth/authorize") login.searchParams.set("weiter", `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  const area = areaForPath(path);
  const access = await accessFor(token).catch(() => null);
  // Nur ansehen: keine schreibenden Anfragen. Server Actions weist requireSession freundlich ab
  // (zurück zur Seite mit Hinweis); alles andere hier hart.
  if (access?.readOnly && request.method !== "GET" && request.method !== "HEAD" && !request.headers.get("next-action")) {
    return NextResponse.json({ error: "Nur-ansehen-Konto: Änderungen sind gesperrt." }, { status: 403 });
  }
  if (!area) return NextResponse.next();
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
  // api/assistent (Fragefeld) prüft die Sitzung selbst – auch Nur-ansehen-Konten dürfen lesend fragen.
  // api/mcp (Claude-Konnektor) und .well-known (OAuth-Metadaten): eigene Anmeldung per Bearer-Token.
  // sendung/<token>: Sendungsverfolgung für Kunden ohne Anmeldung – die Seite prüft den befristeten Link selbst.
  // portal: Kundenportal der B2B-Deals mit eigener Anmeldung (Cookie b2b_portal) – jede Seite prüft sie selbst.
  // api/ebay und api/import ohne Proxy (große Uploads würden sonst gekürzt) – sie prüfen Sitzung und Bereich selbst.
  // api/deal-eingang: iPhone-Kurzbefehl mit Geräte-Schlüssel bzw. Sitzung – prüft beides selbst.
  // api/sellerboard/callback: Rücksprung landet am Handy oft in einem Fenster ohne Anmeldung; geschützt durch
  // signierten state + serverseitigen PKCE-Prüfwert.
  matcher: ["/((?!login|sendung/|portal|\\.well-known|api/mcp|api/assistent|api/oauth|api/cron|api/ebay|api/import|api/deal-eingang|api/public|api/sellerboard/callback|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|icons/).*)"],
};
