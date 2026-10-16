import Link from "next/link";
import { requireLogin } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { logout } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireLogin();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">♥</span>
          Spenden-Tool
        </div>
        <input type="checkbox" id="nav-toggle" className="nav-toggle" aria-hidden="true" />
        <label htmlFor="nav-toggle" className="nav-burger">☰ Menü</label>
        <Nav admin={me.isAdmin} />
        <div className="sidebar-foot">
          <Link href="/konto" className="small" style={{ display: "block", marginBottom: 4 }}>👤 {me.name}</Link>
          <form action={logout}>
            <button className="btn-link" type="submit" style={{ fontSize: 12 }}>Abmelden</button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
