import { and, count, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { SidebarNav } from "@/components/sidebar-nav";
import { logout } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const t = session.tenantId;
  const [[tasks], [inbox], [orders], [claims], [invoices]] = await Promise.all([
    db.select({ n: count() }).from(schema.tasks).where(and(eq(schema.tasks.tenantId, t), eq(schema.tasks.status, "open"))),
    db.select({ n: count() }).from(schema.emails).where(and(eq(schema.emails.tenantId, t), eq(schema.emails.category, "critical"), eq(schema.emails.archived, false))),
    db.select({ n: count() }).from(schema.orders).where(and(eq(schema.orders.tenantId, t), eq(schema.orders.fulfillment, "FBM"), inArray(schema.orders.status, ["open", "label_created"]))),
    db.select({ n: count() }).from(schema.claims).where(and(eq(schema.claims.tenantId, t), inArray(schema.claims.status, ["detected", "queued"]))),
    db.select({ n: count() }).from(schema.invoices).where(and(eq(schema.invoices.tenantId, t), inArray(schema.invoices.status, ["new", "review"]))),
  ]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">S</span>
          Seller-System
        </div>
        <input type="checkbox" id="nav-toggle" className="nav-toggle" aria-hidden="true" />
        <label htmlFor="nav-toggle" className="nav-burger">☰ Menü</label>
        <SidebarNav
          counts={{ tasks: tasks.n, inbox: inbox.n, orders: orders.n, claims: claims.n, invoices: invoices.n }}
          isOwner={session.role === "owner"}
        />
        <div className="sidebar-foot">
          <span>{session.tenantName}</span>
          <span>{session.name ?? session.email}</span>
          <form action={logout}>
            <button className="btn-link" type="submit" style={{ fontSize: 12 }}>Abmelden</button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
