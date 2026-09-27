import { RETURN_STATUS, type ReturnStatus } from "./reconcile";
import type { ReturnView } from "./service";

export type ViewRow = ReturnView["rows"][number];

const OPEN_CASE = ["submitted", "partial", "escalated"];

/** Fall bei Amazon eingereicht und noch nicht entschieden. */
export const caseOpen = (r: ViewRow) => r.claims.some((c) => OPEN_CASE.includes(c.status));

/** Hier muss jemand etwas tun: Fall eröffnen. */
export const needsAction = (r: ViewRow) =>
  !r.resolved && !caseOpen(r) && ((["critical", "warn"].includes(r.tone) && r.status !== "waitAmazon") || r.overRefund > 0);

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

export function returnFilters(rows: ViewRow[]) {
  const present = (Object.keys(RETURN_STATUS) as ReturnStatus[]).filter((s) => rows.some((r) => r.status === s));
  const list: [string, string, (r: ViewRow) => boolean][] = [
    ["action", "Fall eröffnen", needsAction],
    ["caseOpen", "Fall bei Amazon offen", caseOpen],
    ["overRefund", "Zu viel erstattet", (r) => r.overRefund > 0],
    ...present.map((s) => [s, RETURN_STATUS[s].label, (r: ViewRow) => r.status === s] as [string, string, (r: ViewRow) => boolean]),
    ["resolved", "Erledigt", (r) => r.resolved],
    ["all", "Alle", () => true],
  ];
  return list.map(([id, label, fn]) => ({ id, label, fn, n: rows.filter(fn).length })).filter((f) => f.n > 0 || f.id === "action" || f.id === "all");
}

export function filterRows(rows: ViewRow[], filter: string, q: string) {
  const fs = returnFilters(rows);
  const f = fs.find((x) => x.id === filter) ?? fs.find((x) => x.id === "all")!;
  const nq = norm(q);
  return rows.filter((r) => f.fn(r) && (!nq || norm(`${r.orderId}${r.sku}${r.title}${r.claims.map((c) => c.amazonCaseId ?? "").join("")}`).includes(nq)));
}
