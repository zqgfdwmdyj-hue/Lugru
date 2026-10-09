import "server-only";
import { db, schema } from "@/db";
import { syncClaims } from "@/lib/claims/service";
import { syncAllMailboxes } from "@/lib/inbox/service";
import { runAmazonTodos } from "@/lib/amazon-todos/service";
import { syncDrive, refreshInvoiceTasks } from "@/lib/invoices/service";
import { fetchSettlements, processPendingReports, scheduleReports, syncFbmOrders } from "@/lib/integrations/clients/amazon";
import { ebayConnected, syncEbayOrders } from "@/lib/integrations/clients/ebay";
import { ebayDb } from "@/lib/ebay/db/pg";
import { runIdealoDaily } from "@/lib/ebay/idealo/scheduler";
import { runInvoiceAutomation } from "@/lib/ebay/invoices/scheduler";
import { invoiceDeps } from "@/lib/ebay/invoices/deps";
import { syncCalendar } from "@/lib/calendar/sync";
import { runResearchIfDue } from "@/lib/research/service";
import { refreshBrandPlanning } from "@/lib/brands/service";
import { autoBoxes } from "@/lib/suppliers/boxes-service";
import { refreshOwnProducts } from "@/lib/brands/shop-service";
import { getIntegration } from "@/lib/integrations/store";
import { refreshServiceTasks } from "@/lib/service/tasks";
import { refreshStockWarnings } from "@/lib/stock/warnings";
import { syncChannelStock } from "@/lib/stock/channel-sync";
import { adoptEbayAttempts } from "@/lib/stock/ebay-link";
import { detectReplies } from "@/lib/leads/service";
import { pullDueFeeds, refreshMarket } from "@/lib/suppliers/feed-service";
import { getSettings } from "@/lib/settings";
import { refreshImportReminder } from "@/lib/tasks/system";

// Hintergrund-Abrufe. Läuft im Server-Prozess (alle 15 Minuten) oder per /api/cron.

const lastRun = new Map<string, number>();
const due = (key: string, minutes: number) => {
  const last = lastRun.get(key) ?? 0;
  if (Date.now() - last < minutes * 60_000) return false;
  lastRun.set(key, Date.now());
  return true;
};

async function step(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    console.error(`[Hintergrund] ${name}:`, e instanceof Error ? e.message : e);
  }
}

let running = false;

export async function runScheduledJobs(force = false) {
  if (running) return { skipped: true };
  running = true;
  try {
    const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants);
    for (const { id: t } of tenants) {
      const has = async (p: string) => Boolean(await getIntegration(t, p));
      if (force || due(`${t}:brands`, 360)) {
        await step("Marken-Planung", () => refreshBrandPlanning(t));
        await step("Eigene Produkte (Keepa)", () => refreshOwnProducts(t));
        await step("Box-Vorschläge", () => autoBoxes(t));
      }
      if (force || due(`${t}:mail`, 14)) {
        await step("Postfächer", () => syncAllMailboxes(t));
        await step("Antworten auf Einkaufsanfragen", () => detectReplies(t));
        await step("Amazon-ToDos", () => runAmazonTodos(t, { sinceDays: 3, max: 40 }));
      }
      if (await has("amazon_sp")) {
        if (force || due(`${t}:amz-orders`, 4)) await step("Amazon-Bestellungen", () => syncFbmOrders(t));
        if (force || due(`${t}:amz-reports`, 14)) {
          await step("Amazon-Reports abholen", () => processPendingReports(t));
          await step("Amazon-Reports anfordern", () => scheduleReports(t));
        }
        if (force || due(`${t}:amz-settlements`, 180)) await step("Abrechnungen", () => fetchSettlements(t));
      }
      if (await ebayConnected(t)) {
        if (force || due(`${t}:ebay-orders`, 4)) await step("eBay-Bestellungen", () => syncEbayOrders(t));
        if (force || due(`${t}:ebay`, 14)) {
          const edb = ebayDb(t);
          await step("eBay-Rechnungen", () => runInvoiceAutomation(edb, invoiceDeps(edb, t)));
          await step("eBay-Angebote in die Wawi", () => adoptEbayAttempts(t));
        }
        // idealo einmal am Tag – läuft im Hintergrund weiter, damit die übrigen Abrufe nicht warten.
        if (due(`${t}:idealo`, 60)) void step("idealo-Preise", () => runIdealoDaily(ebayDb(t)));
      }
      // Preislisten per Link (alle X Std je Feed), danach Amazon-Daten für Neues/Geändertes – im Keepa-Budget.
      if (force || due(`${t}:feeds`, 29)) await step("Lieferanten-Preislisten", () => pullDueFeeds(t));
      if (force || due(`${t}:keepa-feeds`, 59)) await step("Keepa-Abgleich Lieferanten", () => refreshMarket(t));
      // Nach dem Bestellabruf: neue Aufträge reservieren Ware → alle Kanäle auf den verfügbaren Bestand.
      if (force || due(`${t}:stock-sync`, 4)) await step("Bestandsabgleich Kanäle", () => syncChannelStock(t));
      if (await has("apple_calendar")) if (force || due(`${t}:calendar`, 14)) await step("Kalender", () => syncCalendar(t));
      if (force || due(`${t}:research`, 59)) await step("Themen-Recherche", () => runResearchIfDue(t));
      if (await has("google_drive")) if (force || due(`${t}:drive`, 59)) await step("Rechnungen", () => syncDrive(t, 100));
      if (force || due(`${t}:tasks`, 59)) {
        const s = await getSettings(t);
        await step("Ansprüche", () => syncClaims(t));
        await step("Bestandswarnungen", () => refreshStockWarnings(t));
        await step("Service", () => refreshServiceTasks(t));
        await step("Rechnungsaufgaben", () => refreshInvoiceTasks(t));
        await step("Import-Erinnerung", () => refreshImportReminder(t, s.importReminderDays));
      }
    }
    return { skipped: false };
  } finally {
    running = false;
  }
}

let started = false;
export function startScheduler() {
  if (started || process.env.ENABLE_SCHEDULER === "0") return;
  started = true;
  const tick = () => void runScheduledJobs().catch((e) => console.error("[Hintergrund]", e));
  setTimeout(tick, 60_000);
  // Alle 5 Minuten: Bestellungen und Bestandsabgleich (gegen Überverkauf); die übrigen Abrufe haben eigene Abstände.
  setInterval(tick, 5 * 60_000);
  console.log("[Hintergrund] Abrufe aktiv (alle 5 Minuten).");
}
