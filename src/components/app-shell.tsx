import "server-only";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { logout } from "@/app/login/actions";
import { getPrefs } from "@/lib/auth/prefs";
import { canAccess } from "@/lib/auth/areas";
import { needsReview } from "@/lib/invoices/review";
import { bindingTask } from "@/lib/today/service";
import { appVersion } from "@/lib/version";
import { unreadNotices } from "@/lib/pallets/shipment-service";
import { assistantAvailable } from "@/lib/assistant/chat";
import { NAV_OPEN_COOKIE, NAV_SCHMAL_COOKIE, offeneAusCookie } from "@/lib/nav";
import { AppSidebar } from "./app-sidebar";
import { TopBar, type Glocke } from "./top-bar";
import { HandyTabs } from "./handy-tabs";
import { AreaTabs } from "./area-tabs";
import { ReadOnlyBanner } from "./read-only-banner";
import { LockedBanner } from "./locked-banner";
import { AssistantBar } from "./assistant-bar";
import { TestBanner } from "./test-banner";
import { PushPruefen } from "./push-pruefen";

/**
 * Gemeinsamer Rahmen für Geschäft und Privat: linke Seitenleiste (gleich in beiden Bereichen, im Privatbereich sind die
 * geschäftlichen Gruppen eingeklappt und der Privat-Block offen), oben Suche/Stern/Glocke/Benutzer, unten am Handy
 * die Tab-Leiste.
 */
export async function AppShell({ session, bereich, children }: { session: Session; bereich: "geschaeft" | "privat"; children: React.ReactNode }) {
  const t = session.tenantId;
  const privatBereich = bereich === "privat";
  const M = schema.meldungen;
  const [[tasks], [inbox], [orders], [claims], [invoices], [amazonTodos], prefs, jar] = await Promise.all([
    (db.select({ n: count() }).from(schema.tasks).where(and(eq(schema.tasks.tenantId, t), eq(schema.tasks.status, "open"), bindingTask))),
    (db.select({ n: count() }).from(schema.emails).where(and(eq(schema.emails.tenantId, t), eq(schema.emails.category, "critical"), eq(schema.emails.archived, false)))),
    (db.select({ n: count() }).from(schema.orders).where(and(eq(schema.orders.tenantId, t), eq(schema.orders.fulfillment, "FBM"), inArray(schema.orders.status, ["open", "label_created"])))),
    (db.select({ n: count() }).from(schema.claims).where(and(eq(schema.claims.tenantId, t), inArray(schema.claims.status, ["detected", "queued"])))),
    (db.select({ n: count() }).from(schema.invoices).where(and(eq(schema.invoices.tenantId, t), needsReview))),
    (db.select({ n: count() }).from(schema.amazonTodos).where(and(eq(schema.amazonTodos.tenantId, t), eq(schema.amazonTodos.status, "open"), eq(schema.amazonTodos.priority, "high")))),
    getPrefs(session),
    cookies(),
  ]);
  const access = { isOwner: session.role === "owner", areas: session.areas, privateAccess: session.privateAccess };
  const assistant = privatBereich ? null : await assistantAvailable(t).catch(() => null);
  const pallets = canAccess(session, "paletten") ? (await unreadNotices(session, prefs.shipmentNoticesSeenAt ?? null, 1).catch(() => ({ count: 0 }))).count : 0;
  const favorites = prefs.favorites ?? [];
  // Glocke: letzte Push-Meldungen (30 Tage) und wie viele seit dem letzten Öffnen neu sind.
  const seit = new Date(Date.now() - 30 * 86_400_000);
  const gesehen = prefs.meldungenSeenAt ? new Date(prefs.meldungenSeenAt) : seit;
  const [liste, [neu]] = await Promise.all([
    db.select({ id: M.id, titel: M.titel, text: M.text, link: M.link, am: M.createdAt }).from(M).where(and(eq(M.tenantId, t), eq(M.userId, session.userId), gte(M.createdAt, seit))).orderBy(desc(M.createdAt)).limit(12),
    db.select({ n: count() }).from(M).where(and(eq(M.tenantId, t), eq(M.userId, session.userId), gte(M.createdAt, gesehen > seit ? gesehen : seit))),
  ]);
  const glocke: Glocke = { neu: prefs.meldungenSeenAt ? neu.n : Math.min(neu.n, liste.length), liste: liste.map((m) => ({ id: m.id, titel: m.titel, text: m.text, link: m.link, zeit: m.am.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) })) };
  const schmal = jar.get(NAV_SCHMAL_COOKIE)?.value === "1";
  const gemerkt = offeneAusCookie(jar.get(NAV_OPEN_COOKIE)?.value);
  const name = (session.name || session.email).split(" ")[0];
  const abmelden = (
    <form action={logout}>
      <button className="btn-link" type="submit">Abmelden</button>
    </form>
  );
  const foot = (
    <div className="sidebar-foot">
      <span>{session.tenantName}</span>
      <span>{session.name ?? session.email}{session.readOnly ? " · nur ansehen" : ""}</span>
      <form action={logout}>
        <button className="btn-link" type="submit" style={{ fontSize: 12 }}>Abmelden</button>
      </form>
      {appVersion() && <span title="Programmstand – nach update.sh sollte hier der neue Stand stehen" data-testid="app-version">Stand {appVersion()}</span>}
    </div>
  );

  return (
    <>
      <TestBanner />
      <div className={`shell${schmal ? " shell-schmal" : ""}${privatBereich ? " shell-privat" : ""}`}>
        <AppSidebar
          counts={{ tasks: tasks.n, inbox: inbox.n, orders: orders.n, claims: claims.n, invoices: invoices.n, amazonTodos: amazonTodos.n, pallets }}
          favorites={favorites}
          gemerkt={gemerkt}
          privatBereich={privatBereich}
          schmal={schmal}
          foot={foot}
          {...access}
        />
        <main className="main">
          <TopBar favorites={favorites} canFavorite={!session.readOnly} glocke={glocke} name={name} firma={session.tenantName} owner={session.role === "owner" && !session.readOnly} abmelden={abmelden} serverSuche={session.role === "owner" || session.areas === null} privatBereich={privatBereich} {...access} />
          {assistant?.enabled && assistant.hasKey && <AssistantBar name={name} />}
          {session.readOnly && <Suspense fallback={null}><ReadOnlyBanner /></Suspense>}
          {!session.readOnly && <PushPruefen />}
          {!privatBereich && <Suspense fallback={null}><LockedBanner /></Suspense>}
          {!privatBereich && <AreaTabs {...access} />}
          {children}
        </main>
        <HandyTabs {...access} />
      </div>
    </>
  );
}
