import "server-only";
import type { Db } from "./db/db";
import { ebayDb } from "./db/pg";
import { backupDir } from "./backup/backup";
import { apiRouter } from "./routes/api";
import { invoiceRouter } from "./routes/invoices";
import { invoiceDeps } from "./invoices/deps";
import { maintenanceRouter } from "./routes/maintenance";
import { dispatch } from "./routes/dispatch";
import type { Router } from "./routes/router";

/** Routen, die nur der Inhaber aufrufen darf: Zugangsdaten, Verbindung, Rechnungsabsender, Sicherung. */
const OWNER_ONLY: [string, RegExp][] = [
  ["PUT", /^\/settings$/],
  ["POST", /^\/(optin|location|auth\/code)$/],
  ["GET", /^\/auth\/url$/],
  ["PUT", /^\/invoice-settings$/],
  ["POST", /^\/invoice-settings\/test-mail$/],
  ["POST", /^\/invoice-settings\/legacy$/],
  ["PUT", /^\/backup$/],
  ["POST", /^\/backup\/run$/],
];

function routersFor(db: Db, tenantId: string): Router[] {
  return [apiRouter(db), invoiceRouter(db, invoiceDeps(db, tenantId)), maintenanceRouter(db, backupDir())];
}

/** Führt einen Aufruf der eBay-API des Tools für einen Mandanten aus (wie der Express-Server im bisherigen Tool). */
export async function handleEbayApi(opts: {
  tenantId: string;
  role: "owner" | "staff";
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}): Promise<Response> {
  const { method, path } = opts;
  if (opts.role !== "owner" && OWNER_ONLY.some(([m, p]) => m === method && p.test(path))) {
    return Response.json({ error: "Nur der Inhaber darf das ändern." }, { status: 403 });
  }
  const db = ebayDb(opts.tenantId);
  return dispatch(routersFor(db, opts.tenantId), { method, path, query: opts.query, body: opts.body });
}
