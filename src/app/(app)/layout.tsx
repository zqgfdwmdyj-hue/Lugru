import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { SidebarNav } from "@/components/sidebar-nav";
import { logout } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const [{ open }] = await db
    .select({ open: count() })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.tenantId, session.tenantId), eq(schema.tasks.status, "open")));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">S</span>
          Seller-System
        </div>
        <SidebarNav openTasks={open} />
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
