import Link from "next/link";
import { redirect } from "next/navigation";
import { homeFor } from "@/lib/auth/areas";
import { requireSession } from "@/lib/auth/session";
import { lockAction } from "./privat/actions";
import { PrivatNav } from "./privat-nav";

/**
 * Eigener Rahmen für „Privat“: statt der geschäftlichen Seitenleiste eine kompakte Privat-Navigation und
 * „Zurück zum Geschäft“. Zugang und PIN prüft jede Seite selbst (requirePrivate) – die Entsperr-Seite
 * liegt auch hier.
 */
/** Mit PIN und abgelaufener Freigabe: nur die Entsperr-Seite, keine Navigation. */
const isLocked = (s: { privatePin: boolean; privateUnlockedUntil: Date | null }) => s.privatePin && (s.privateUnlockedUntil?.getTime() ?? 0) <= Date.now();

export default async function PrivatLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session.privateAccess) redirect(`${homeFor(session)}?gesperrt=1`);
  const locked = isLocked(session);
  return (
    <div className="pshell">
      <header className="ptop">
        <div className="ptop-row">
          <Link href="/privat" className="ptop-brand">🔒 Privat</Link>
          <div className="ptop-actions">
            {session.privatePin && !locked && (
              <form action={lockAction}>
                <button className="btn btn-small" type="submit" title="Privat sofort sperren (PIN nötig)" data-testid="priv-lock">Sperren</button>
              </form>
            )}
            <Link className="btn btn-small" href="/" data-testid="back-to-business">← Zurück zum Geschäft</Link>
          </div>
        </div>
        {!locked && <PrivatNav family={session.privateScope === "familie"} />}
      </header>
      <main className="main pmain">{children}</main>
    </div>
  );
}
