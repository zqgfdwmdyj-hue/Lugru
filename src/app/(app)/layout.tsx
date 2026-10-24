import { and, count, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { cookies } from "next/headers";
import { SidebarNav } from "@/components/sidebar-nav";
import { NAV_OPEN_COOKIE } from "@/lib/nav";
import { logout } from "@/app/login/actions";
import { Suspense } from "react";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { AreaTabs } from "@/components/area-tabs";
import { getPrefs } from "@/lib/auth/prefs";
import { needsReview } from "@/lib/invoices/review";
import { bindingTask } from "@/lib/today/service";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const t = session.tenantId;
  const [[tasks], [inbox], [orders], [claims], [invoices], [amazonTodos], prefs] = await Promise.all([
    db.select({ n: count() }).from(schema.tasks).where(and(eq(schema.tasks.tenantId, t), eq(schema.tasks.status, "open"), bindingTask)),
    db.select({ n: count() }).from(schema.emails).where(and(eq(schema.emails.tenantId, t), eq(schema.emails.category, "critical"), eq(schema.emails.archived, false))),
    db.select({ n: count() }).from(schema.orders).where(and(eq(schema.orders.tenantId, t), eq(schema.orders.fulfillment, "FBM"), inArray(schema.orders.status, ["open", "label_created"]))),
    db.select({ n: count() }).from(schema.claims).where(and(eq(schema.claims.tenantId, t), inArray(schema.claims.status, ["detected", "queued"]))),
    db.select({ n: count() }).from(schema.invoices).where(and(eq(schema.invoices.tenantId, t), needsReview)),
    db.select({ n: count() }).from(schema.amazonTodos).where(and(eq(schema.amazonTodos.tenantId, t), eq(schema.amazonTodos.status, "open"), eq(schema.amazonTodos.priority, "high"))),
    getPrefs(session),
  ]);
  const access = { isOwner: session.role === "owner", areas: session.areas, privateAccess: session.privateAccess };
  const favorites = prefs.favorites ?? [];
  const openSaved = ((await cookies()).get(NAV_OPEN_COOKIE)?.value ?? "").split(".").filter((k) => /^[a-z]{2,20}$/.test(k));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-mark" src="/icons/mark.svg" alt="" width={28} height={28} />
          Seller-System
        </div>
        <input type="checkbox" id="nav-toggle" className="nav-toggle" aria-hidden="true" />
        <label htmlFor="nav-toggle" className="nav-burger">☰ Menü</label>
        <label htmlFor="nav-toggle" className="nav-backdrop" aria-hidden="true" />
        <div className="nav-drawer">
          <label htmlFor="nav-toggle" className="nav-close">✕ Schließen</label>
          <SidebarNav
            counts={{ tasks: tasks.n, inbox: inbox.n, orders: orders.n, claims: claims.n, invoices: invoices.n, amazonTodos: amazonTodos.n }}
            favorites={favorites}
            openSaved={openSaved}
            {...access}
          />
          <div className="sidebar-foot">
            <span>{session.tenantName}</span>
            <span>{session.name ?? session.email}{session.readOnly ? " · nur ansehen" : ""}</span>
            <form action={logout}>
              <button className="btn-link" type="submit" style={{ fontSize: 12 }}>Abmelden</button>
            </form>
          </div>
        </div>
      </aside>
      <main className="main">
        {session.readOnly && <Suspense fallback={null}><ReadOnlyBanner /></Suspense>}
        <AreaTabs favorites={favorites} canFavorite={!session.readOnly} {...access} />
        {children}
      </main>
    </div>
  );
}
