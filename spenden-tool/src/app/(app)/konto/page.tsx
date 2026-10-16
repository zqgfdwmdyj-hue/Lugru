import Link from "next/link";
import { requireLogin } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { OwnPasswordForm } from "../verwaltung/forms";

export default async function KontoPage() {
  const me = await requireLogin();
  return (
    <>
      <div className="crumb"><Link href="/">Verteilungen</Link></div>
      <div className="page-head"><div><h1>Mein Konto</h1><div className="small muted">Angemeldet als {me.name}{me.isAdmin ? " · Admin" : ""}</div></div></div>
      {me.id ? (
        <OwnPasswordForm />
      ) : (
        <div className="notice notice-warn">
          Du bist mit dem gemeinsamen Team-Passwort angemeldet. <Link href="/verwaltung">Unter Verwaltung</Link> eigene Zugänge anlegen – dann sieht man auch, wer was geändert hat.
        </div>
      )}
      <form action={logout}>
        <button className="btn" type="submit">Abmelden</button>
      </form>
    </>
  );
}
