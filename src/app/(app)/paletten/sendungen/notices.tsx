import Link from "next/link";
import { and, eq, inArray, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { unreadNotices } from "@/lib/pallets/shipment-service";
import { markNoticesSeenAction } from "./actions";

const time = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);

/**
 * Hinweis oben im Palettenlager – für alle mit Zugriff, nicht nur für den, der es eingetragen hat:
 * neue Meldungen (Termin verschoben, angekommen, Problem …) und was heute erwartet wird bzw. überfällig ist.
 */
export async function ShipmentNotices({ session, compact = false }: { session: Session; compact?: boolean }) {
  const today = todayIso();
  const S = schema.palletShipments;
  const [notices, due] = await Promise.all([
    unreadNotices(session, undefined, compact ? 1 : 30),
    db
      .select({ id: S.id, plannedDate: S.plannedDate })
      .from(S)
      .where(and(eq(S.tenantId, session.tenantId), inArray(S.status, ["geplant", "unterwegs", "verzoegert", "problem"]), lte(S.plannedDate, today))),
  ]);
  const todayN = due.filter((d) => d.plannedDate === today).length;
  const lateN = due.length - todayN;
  if (!notices.count && !todayN && !lateN) return null;
  return (
    <section className={`notice ${notices.count ? "notice-warn" : "notice-info"}`} data-testid="ship-notices" style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <strong>
          🚚 Sendungen{todayN ? ` · heute erwartet: ${todayN}` : ""}
          {lateN ? ` · überfällig: ${lateN}` : ""}
          {notices.count ? ` · ${notices.count} neue Meldung${notices.count === 1 ? "" : "en"}` : ""}
        </strong>
        <span style={{ display: "flex", gap: 6 }}>
          <Link className="btn btn-small" href="/paletten/sendungen">Zu den Sendungen</Link>
          {notices.count > 0 && !session.readOnly && (
            <form action={markNoticesSeenAction}>
              <button className="btn btn-small" type="submit" data-testid="ship-notices-seen">Gelesen</button>
            </form>
          )}
        </span>
      </div>
      {!compact && notices.items.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
          {notices.items.slice(0, 3).map((n) => <NoticeLine key={n.id} n={n} />)}
          {notices.count > 3 && (
            <li className="muted" style={{ listStyle: "none", marginLeft: -18 }}>
              <details>
                <summary data-testid="ship-notices-more">… und {notices.count - 3} weitere anzeigen</summary>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {notices.items.slice(3).map((n) => <NoticeLine key={n.id} n={n} />)}
                  {notices.count > notices.items.length && <li>… ältere stehen im Verlauf der jeweiligen Sendung</li>}
                </ul>
              </details>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

type Notice = Awaited<ReturnType<typeof unreadNotices>>["items"][number];

function NoticeLine({ n }: { n: Notice }) {
  return (
    <li data-testid="ship-notice">
      <Link href={`/paletten/sendungen/${n.shipmentId}`}>{n.direction === "ein" ? "Anlieferung" : "Versand"}: {n.title}</Link> – {n.text}
      <span className="muted"> · {time(n.createdAt)}{n.userName ? ` · ${n.userName}` : ""}</span>
    </li>
  );
}
