import "server-only";
import { db, schema } from "@/db";
import { syncClaims } from "@/lib/claims/service";
import { syncAllMailboxes } from "@/lib/inbox/service";
import { runAmazonTodos } from "@/lib/amazon-todos/service";
import { syncDrive, refreshInvoiceTasks } from "@/lib/invoices/service";
import { fetchSettlements, processPendingReports, scheduleMarktBerichte, scheduleReports, syncFbmOrders } from "@/lib/integrations/clients/amazon";
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
import { refreshShipments } from "@/lib/pallets/shipment-service";
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
        await step(t, "Amazon-Fall-Zentrale", async () => (await import("@/lib/amazon-faelle/service")).faelleAbgleich(t, { sinceDays: 30 }));
      }
      if (await has("amazon_sp")) {
        if (force || due(`${t}:amz-orders`, 4)) await step(t, "Amazon-Bestellungen", () => syncFbmOrders(t));
        if (force || due(`${t}:amz-reports`, 14)) {
          await step(t, "Amazon-Reports abholen", () => processPendingReports(t));
          await step(t, "Amazon-Reports anfordern", () => scheduleReports(t));
          await step(t, "Amazon-Berichte je Land anfordern", () => scheduleMarktBerichte(t));
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
      // B2B-Deals: abgelaufene Fristen schließen, Vorkasse-Zahlungen aus Lexoffice holen.
      if (force || due(`${t}:b2b`, 59)) {
        await step(t, "B2B-Deals Fristen", async () => (await import("@/lib/b2b/service")).fristenPruefen(t));
        if (await has("lexoffice")) await step(t, "B2B-Zahlungen (Lexoffice)", async () => (await import("@/lib/b2b/ablauf")).zahlungenAbgleichen(t));
      }
      // B2B-Deals: Erfolgskontrolle 30/60 Tage nach Wareneingang (Keepa, einmal am Tag).
      if (force || due(`${t}:b2b-kontrolle`, 719)) await step(t, "B2B-Erfolgskontrolle", async () => (await import("@/lib/b2b/kontrolle")).erfolgskontrolle(t));
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
        await step(t, "Paletten-Sendungen", () => refreshShipments(t, todayIso()));
      }
      // Termine im Privatkalender: Vorabend-Erinnerung mit Abfahrt (nur Push an den Inhaber, ab der eingestellten Uhrzeit).
      if (force || due(`${t}:vorabend`, 29)) await step(t, "Termin-Erinnerung (Vorabend)", async () => (await import("@/lib/private/termin-mail-service")).vorabendErinnerung(t));
      // Handy & Tesla: Verspätungs-Entwurf (alle 5 Min., nur mit Tesla), Fahrten fürs Fahrtenbuch (stündlich),
      // SMS „Frist morgen“ (einmal am Tag ab 17 Uhr, nur wenn SMS eingerichtet).
      if (await has("tesla")) {
        await step(t, "Tesla: Verspätung", async () => (await import("@/lib/mobil/fahrten")).verspaetungPruefen(t));
        if (force || due(`${t}:fahrten`, 59)) await step(t, "Tesla: Fahrtenbuch", async () => (await import("@/lib/mobil/fahrten")).fahrtenAbrufen(t));
        // Vorheizen vor Terminen mit Ort (nur wenn eingeschaltet; fragt das Auto nur, wenn ein Termin ansteht).
        if (force || due(`${t}:vorheizen`, 4)) await step(t, "Tesla: Vorheizen", async () => (await import("@/lib/mobil/auto")).vorheizenPruefen(t));
      }
      if (await has("twilio")) {
        const uhr = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(new Date());
        if (Number(uhr) >= 17 && (force || due(`${t}:sms-frist`, 179))) await step(t, "SMS: Frist morgen", async () => (await import("@/lib/mobil/sms")).fristMorgenSms(t));
      }
      // Geburtstage & Jahrestage: 14 und 3 Tage vorher, am Tag selbst (je Stufe einmal, nur Push an Privat-Zugang).
      if (force || due(`${t}:jahrestage`, 179)) await step(t, "Geburtstage & Jahrestage", async () => (await import("@/lib/private/erinnerungen")).jahrestagErinnerungen(t));
      // Deal-Eingang: Eingänge (WhatsApp-Inhalte) nach der Aufbewahrungsfrist löschen.
      // B15.1: Erinnerung „Versandbestätigung bei Amazon hochladen“, solange versendete Aufträge nicht gemeldet sind.
      if (force || due(`${t}:amazon-bestaetigung`, 59)) await step(t, "Amazon: Versandbestätigung", async () => (await import("@/lib/orders/bestaetigung")).bestaetigungErinnern(t));
      if (force || due(`${t}:deal-eingang-aufraeumen`, 1435)) await step(t, "Deal-Eingang aufräumen", async () => (await import("@/lib/deal-eingang/service")).aufraeumen(t));
      // Lernender Deal-Wert: 👍/👎 unter den ProfitPath-Nachrichten in Discord (alle 15 Min.), reales Ergebnis gekaufter
      // Deals 30/60/90 Tage nach Wareneingang und „bewährt?“ der Lugru-Deals aus dem Keepa-Zwischenspeicher (täglich).
      if (force || due(`${t}:deal-daumen`, 14)) await step(t, "Deal-Wert: 👍/👎 aus Discord", async () => (await import("@/lib/deal-eingang/wert")).discordDaumen(t));
      if (force || due(`${t}:deal-ergebnis`, 1435)) {
        const w = await import("@/lib/deal-eingang/wert");
        await step(t, "Deal-Wert: Ergebnisse je Kauf", () => w.ergebnisseAktualisieren(t));
        await step(t, "Deal-Wert: Lugru bewährt?", () => w.lugruBewaehrtPruefen(t));
      }
      // Retouren-Station: Fotos/Videos nach der Aufbewahrungsfrist löschen (offene Fälle behalten ihre Beweise).
      if (force || due("medien-aufraeumen", 1435)) await step(t, "Retouren-Station: Medien aufräumen", async () => (await import("@/lib/retouren-station/fall")).medienAufraeumen());
      if (force || due(`${t}:tasks`, 59)) {
        const s = await getSettings(t);
        await step(t, "Ansprüche", () => syncClaims(t));
        await step(t, "Bestandswarnungen", () => refreshStockWarnings(t));
        await step(t, "Service", () => refreshServiceTasks(t));
        await step(t, "Rechnungsaufgaben", () => refreshInvoiceTasks(t));
        await step(t, "Import-Erinnerung", () => refreshImportReminder(t, s.importReminderDays));
        // Verlust-Stopp-Aufgaben mit den vorhandenen Tageswerten abgleichen (schließt z. B. Aufgaben, die nur aus
        // Tagen ohne Verkauf entstanden sind) – ohne neuen sellerboard-Abruf.
        await step(t, "Verlust-Stopp (Abgleich)", async () => (await import("@/lib/money/verlust-service")).refreshVerlustTasks(t, todayIso()));
      }
      // Call-Archiv: neue Transkripte aus dem Discord-Kanal, einmal pro Woche.
      // Rechtsfälle (B14): Asana nur lesen alle 30 Min.; „nichts passiert“ einmal am Tag.
      if (await has("asana")) if (force || due(`${t}:asana`, 29)) await step(t, "Rechtsfälle (Asana)", async () => (await import("@/lib/recht/service")).asanaAbgleich(t));
      if (force || due(`${t}:recht-stillstand`, 1435)) await step(t, "Rechtsfälle: Stillstand", async () => (await import("@/lib/recht/service")).stillstandPruefen(t));
      // Discord-Kanäle der Deal-Gruppe (B14): stündlich lesen, Zusammenfassungen nach Rhythmus, Rohtexte nach 30 Tagen weg.
      if (force || due(`${t}:discord-wissen`, 59)) await step(t, "Gruppen-Kanäle (Discord)", async () => (await import("@/lib/discord-wissen/service")).discordWissenLauf(t));
      if (await has("discord_calls")) if (force || due(`${t}:calls`, 10079)) await step(t, "Call-Archiv (Discord)", async () => (await import("@/lib/calls/service")).discordCallsImport(t, todayIso()));
      // Call-Archiv: noch nicht ausgewertete Calls (Sammel-Import, Discord) nacheinander von der KI auswerten lassen.
      if (force || due(`${t}:call-auswertung`, 29)) await step(t, "Call-Auswertung", async () => (await import("@/lib/calls/service")).offeneCallsAuswerten(t, 20));
      // Planung: Standard-Freizeiten/Retourenwelle einmalig, Aufgaben aus freien Tagen schieben, Anleitungen prüfen.
      if (force || due(`${t}:planung`, 179)) {
        const z = await import("@/lib/zeit/service");
        await step(t, "Planung einrichten", () => z.planungEinrichten(t, todayIso()));
        await step(t, "Freie Zeiten", () => z.freieZeitenAnwenden(t, todayIso()));
        await step(t, "Anleitungen prüfen", () => z.anleitungenPruefen(t));
        await step(t, "Anleitungen Handy & Tesla", async () => (await import("@/lib/mobil/anleitungen")).mobilAnleitungen(t));
        await step(t, "Zuständigkeiten", async () => (await import("@/lib/delegieren/service")).zustaendigkeitenAnwenden(t));
        // EK-Import: am Folgetag EK in sellerboard gegen das System prüfen.
        await step(t, "EK-Gegenprüfung sellerboard", async () => (await import("@/lib/ek-import/service")).ekGegenpruefung(t));
      }
    }
    return { skipped: false };
  } finally {
    running = false;
  }
}

let started = false;

let takt = 0;
async function vaTakt() {
  const va = await import("@/lib/va/service");
  // Fehler protokolliert vaAbgleich selbst (job_runs „VA (Discord)“).
  for (const t of await va.vaMandanten()) await va.vaAbgleich(t).catch(() => null);
  // ProfitPath-Kanäle jede Minute (jeder zweite Takt).
  if (takt++ % 2 === 0) {
    const pp = await import("@/lib/deal-eingang/profitpath");
    for (const t of await pp.profitPathMandanten()) {
      const t0 = Date.now();
      await pp
        .profitPathAbgleich(t)
        .then((z) => z && recordJob(t, "ProfitPath (Discord)", null, Date.now() - t0))
        .catch((e) => recordJob(t, "ProfitPath (Discord)", e instanceof Error ? e.message : String(e), Date.now() - t0));
    }
  }
}
export function startScheduler() {
  if (started || process.env.ENABLE_SCHEDULER === "0") return;
  started = true;
  const tick = () => void runScheduledJobs().catch((e) => console.error("[Hintergrund]", e));
  setTimeout(tick, 60_000);
  // Alle 5 Minuten: Bestellungen und Bestandsabgleich (gegen Überverkauf); die übrigen Abrufe haben eigene Abstände.
  setInterval(tick, 5 * 60_000);
  // VA über Discord: alle 30 Sekunden (Antwort auf Datenfragen in ≤ 1 Minute) – nur mit eingerichtetem VA-Kanal.
  setInterval(() => void vaTakt().catch((e) => console.error("[VA]", e instanceof Error ? e.message : e)), 30_000);
  console.log("[Hintergrund] Abrufe aktiv (alle 5 Minuten).");
}
