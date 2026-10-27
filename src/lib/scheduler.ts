import "server-only";
import { db, schema } from "@/db";
import { syncClaims } from "@/lib/claims/service";
import { syncAllMailboxes } from "@/lib/inbox/service";
import { runAmazonTodos } from "@/lib/amazon-todos/service";
import { syncDrive, refreshInvoiceTasks } from "@/lib/invoices/service";
import { fetchSettlements, processPendingReports, scheduleReports, syncFbmOrders } from "@/lib/integrations/clients/amazon";
import { ebayConnected, syncEbayOrders } from "@/lib/integrations/clients/ebay";
import { refreshTemuListings, linkTemuBySku, syncTemuOrders, temuConnected } from "@/lib/integrations/clients/temu";
import { ebayDb } from "@/lib/ebay/db/pg";
import { runIdealoDaily } from "@/lib/ebay/idealo/scheduler";
import { runInvoiceAutomation } from "@/lib/ebay/invoices/scheduler";
import { invoiceDeps } from "@/lib/ebay/invoices/deps";
import { syncCalendar } from "@/lib/calendar/sync";
import { runResearchIfDue } from "@/lib/research/service";
import { refreshBrandPlanning, refreshWeeklyContent } from "@/lib/brands/service";
import { autoBoxes } from "@/lib/suppliers/boxes-service";
import { refreshOwnProducts } from "@/lib/brands/shop-service";
import { getIntegration } from "@/lib/integrations/store";
import { refreshServiceTasks } from "@/lib/service/tasks";
import { refreshStockWarnings } from "@/lib/stock/warnings";
import { syncChannelStock } from "@/lib/stock/channel-sync";
import { runTransfers } from "@/lib/temu/transfer";
import { reviewDue } from "@/lib/ebay-review/service";
import { adoptEbayAttempts, ensureEbayStock } from "@/lib/stock/ebay-link";
import { sendPendingReceipts } from "@/lib/invoices/receipts";
import { sendPendingToStotax } from "@/lib/invoices/stotax";
import { cogReminder } from "@/lib/exports/cog";
import { detectReplies, loadMissingBrands } from "@/lib/leads/service";
import { autoFollowUps } from "@/lib/board/service";
import { pullDueFeeds, refreshMarket } from "@/lib/suppliers/feed-service";
import { continueManualCheck } from "@/lib/suppliers/manual-check";
import { getSettings } from "@/lib/settings";
import { refreshImportReminder } from "@/lib/tasks/system";
import { autoSendStatements, refreshPalletReminders } from "@/lib/pallets/service";
import { todayIso } from "@/lib/dates";
import { recordJob } from "@/lib/today/jobs";
import { sbConnected } from "@/lib/sellerboard/connection";
import { startSellerboardSync } from "@/lib/sellerboard/sync";
import { jobEnded, jobStarted } from "@/lib/perf";

// Hintergrund-Abrufe. Läuft im Server-Prozess (alle 15 Minuten) oder per /api/cron.

const lastRun = new Map<string, number>();
const due = (key: string, minutes: number) => {
  const last = lastRun.get(key) ?? 0;
  if (Date.now() - last < minutes * 60_000) return false;
  lastRun.set(key, Date.now());
  return true;
};

async function step(tenantId: string, name: string, fn: () => Promise<unknown>) {
  const t0 = Date.now();
  jobStarted(name);
  try {
    await fn();
    void recordJob(tenantId, name, null, Date.now() - t0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Hintergrund] ${name}:`, msg);
    void recordJob(tenantId, name, msg, Date.now() - t0);
  } finally {
    jobEnded(name);
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
        await step(t, "Marken-Planung", () => refreshBrandPlanning(t));
        await step(t, "Content-Plan der Woche", () => refreshWeeklyContent(t));
        await step(t, "Eigene Produkte (Keepa)", () => refreshOwnProducts(t));
        await step(t, "Box-Vorschläge", () => autoBoxes(t));
      }
      if (force || due(`${t}:mail`, 14)) {
        await step(t, "Postfächer", () => syncAllMailboxes(t));
        await step(t, "Antworten auf Einkaufsanfragen", () => detectReplies(t));
        await step(t, "Nachfassen bei Einkaufsanfragen", () => autoFollowUps(t));
        await step(t, "Amazon-ToDos", () => runAmazonTodos(t, { sinceDays: 3, max: 40 }));
      }
      if (await has("amazon_sp")) {
        if (force || due(`${t}:amz-orders`, 4)) await step(t, "Amazon-Bestellungen", () => syncFbmOrders(t));
        if (force || due(`${t}:amz-reports`, 14)) {
          await step(t, "Amazon-Reports abholen", () => processPendingReports(t));
          await step(t, "Amazon-Reports anfordern", () => scheduleReports(t));
        }
        if (force || due(`${t}:amz-settlements`, 180)) await step(t, "Abrechnungen", () => fetchSettlements(t));
      }
      if (await ebayConnected(t)) {
        if (force || due(`${t}:ebay-orders`, 4)) await step(t, "eBay-Bestellungen", () => syncEbayOrders(t));
        if (force || due(`${t}:ebay`, 14)) {
          const edb = ebayDb(t);
          await step(t, "eBay-Rechnungen", () => runInvoiceAutomation(edb, invoiceDeps(edb, t)));
          await step(t, "eBay-Angebote in die Wawi", () => adoptEbayAttempts(t));
          // Laufende eBay-Angebote ohne Wawi-Bestand: Bestand aus der eBay-Menge anlegen.
          await step(t, "eBay-Bestand in die Wawi", () => ensureEbayStock(t));
        }
        // idealo einmal am Tag – läuft im Hintergrund weiter, damit die übrigen Abrufe nicht warten.
        if (due(`${t}:idealo`, 60)) void step(t, "idealo-Preise", () => runIdealoDaily(ebayDb(t)));
        // Angebote prüfen: einmal am Tag neu laden, Ungeprüfte und seit 7 Tagen nicht Geprüfte – im Hintergrund.
        if (due(`${t}:ebay-review`, 59)) void step(t, "eBay-Angebote prüfen", () => reviewDue(t));
      }
      if (await temuConnected(t)) {
        if (force || due(`${t}:temu-orders`, 4)) await step(t, "Temu-Bestellungen", () => syncTemuOrders(t));
        // Neue Temu-Angebote: Stand bei Temu (unvollständig, Entwurf → aktiv, dann Bestandsabgleich).
        if (force || due(`${t}:temu-goods`, 29)) await step(t, "Temu-Angebote", () => refreshTemuListings(t));
        // Per Excel-Vorlage oder Shop-Synchronisierung eingestellte Temu-Produkte über die SKU verknüpfen.
        if (force || due(`${t}:temu-link`, 359)) await step(t, "Temu-Produkte verknüpfen", () => linkTemuBySku(t));
      }
      // eBay-Angebote übernehmen: liegengebliebene Aufträge (z. B. nach einem Neustart) fortsetzen.
      if (force || due(`${t}:ebay-transfers`, 5)) await step(t, "eBay-Übernahme", () => runTransfers(t));
      // Preislisten per Link (alle X Std je Feed), danach Amazon-Daten für Neues/Geändertes – im Keepa-Budget.
      if (force || due(`${t}:feeds`, 29)) await step(t, "Lieferanten-Preislisten", () => pullDueFeeds(t));
      // Fehlende Markenlisten aus dem Verpackungsregister: langsam, im Hintergrund, pausiert bei Drosselung.
      if (due(`${t}:lucid-brands`, 29)) void step(t, "Markenlisten Verpackungsregister", () => loadMissingBrands(t, { limit: 80 }));
      if (force || due(`${t}:keepa-feeds`, 59)) {
        await step(t, "Keepa-Abgleich Lieferanten", () => refreshMarket(t));
        // Von Hand Gezogenes (Seller-Knopf) einmal prüfen – nur mit den Tokens, die danach übrig sind.
        await step(t, "Gezogenes einmal prüfen", () => continueManualCheck(t));
      }
      // Nach dem Bestellabruf: neue Aufträge reservieren Ware → alle Kanäle auf den verfügbaren Bestand.
      if (force || due(`${t}:stock-sync`, 4)) await step(t, "Bestandsabgleich Kanäle", () => syncChannelStock(t));
      if (await has("apple_calendar")) if (force || due(`${t}:calendar`, 14)) await step(t, "Kalender", () => syncCalendar(t));
      if (force || due(`${t}:research`, 59)) await step(t, "Themen-Recherche", () => runResearchIfDue(t));
      if (await has("google_drive")) if (force || due(`${t}:drive`, 59)) await step(t, "Rechnungen", () => syncDrive(t, 100));
      // EK-Liste für AccountOne (tax.fish braucht die EKs für PAN-EU-Verbringungen): Erinnerung bei Neuem, höchstens alle 4 Wochen.
      if (force || due(`${t}:cog-reminder`, 720)) await step(t, "EK-Liste AccountOne", () => cogReminder(t));
      // Ausgangsrechnungen (eBay + B2B) an Stotax Select – neue sofort, Fehlgeschlagene nach einer Stunde erneut.
      if (await has("stotax"))
        if (force || due(`${t}:stotax`, 14)) {
          await step(t, "Rechnungen an Stotax", () => sendPendingToStotax(t));
          await step(t, "Belege an Stotax", () => sendPendingReceipts(t));
        }
      // sellerboard (nur lesend): alles einmal täglich, Bestand + Sendungen alle 4 Std., Verkaufs-Kennzahlen der
      // Startseite alle ~30 Min. (in den größeren Abgleichen enthalten) – im Hintergrund.
      if (await sbConnected(t)) {
        if (due(`${t}:sb-daily`, 1435)) startSellerboardSync(t, "alles");
        else if (due(`${t}:sb-stock`, 239)) startSellerboardSync(t, "bestand");
        else if (due(`${t}:sb-sales`, 29)) startSellerboardSync(t, "verkauf");
      }
      // Paletten-Lager: Erinnerungen (freie Zeit endet, lange Standzeit) und Monatsaufstellungen am Monatsanfang.
      if (force || due(`${t}:pallets`, 59)) {
        await step(t, "Paletten-Erinnerungen", () => refreshPalletReminders(t, todayIso()));
        await step(t, "Paletten-Monatsaufstellungen", () => autoSendStatements(t, todayIso()));
      }
      if (force || due(`${t}:tasks`, 59)) {
        const s = await getSettings(t);
        await step(t, "Ansprüche", () => syncClaims(t));
        await step(t, "Bestandswarnungen", () => refreshStockWarnings(t));
        await step(t, "Service", () => refreshServiceTasks(t));
        await step(t, "Rechnungsaufgaben", () => refreshInvoiceTasks(t));
        await step(t, "Import-Erinnerung", () => refreshImportReminder(t, s.importReminderDays));
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
