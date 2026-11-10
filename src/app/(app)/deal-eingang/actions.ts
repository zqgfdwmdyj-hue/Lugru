"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireArea } from "@/lib/auth/session";
import { DealEingangFehler, eingangAnlegen, eingangPruefen, statusSetzen, STATUS_TEXT, tokenAnlegen, tokenWiderrufen, zeileAendern, type EingangDatei } from "@/lib/deal-eingang/service";
import { lesbarerFehler } from "@/lib/fehler-text";
import { parseAmount } from "@/lib/numbers";
import { wertSchwellenLesen } from "@/lib/deal-eingang/logic";

const PFAD = "/deal-eingang";
const mit = (pfad: string, meldung: string) => `${pfad}${pfad.includes("?") ? "&" : "?"}meldung=${encodeURIComponent(meldung)}`;

async function schreibend() {
  const s = await requireArea("dealeingang");
  if (s.readOnly) redirect(mit(PFAD, "Nur ansehen – Änderungen sind gesperrt."));
  return s;
}

export async function eingangAction(fd: FormData) {
  const s = await schreibend();
  const dateien: EingangDatei[] = [];
  for (const f of fd.getAll("datei")) if (f instanceof File && f.size) dateien.push({ name: f.name, mime: f.type || "application/octet-stream", bytes: new Uint8Array(await f.arrayBuffer()) });
  let ziel: string;
  try {
    const r = await eingangAnlegen(s.tenantId, s.userId, { weg: "manuell", text: String(fd.get("text") ?? ""), dateien, quelle: String(fd.get("quelle") ?? "") || null });
    if (r.neu) after(() => eingangPruefen(s.tenantId, r.id));
    ziel = mit(`${PFAD}/${r.id}`, r.neu ? "Wird geprüft – die Seite aktualisiert sich gleich." : "Diesen Eingang gibt es schon (letzte 24 Stunden).");
  } catch (e) {
    ziel = mit(PFAD, e instanceof DealEingangFehler ? e.message : `Nicht gespeichert – ${lesbarerFehler(e)}`);
  }
  redirect(ziel);
}

export async function neuPruefenAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  await eingangPruefen(s.tenantId, id);
  revalidatePath(`${PFAD}/${id}`);
  redirect(mit(`${PFAD}/${id}`, "Neu geprüft."));
}

export async function zeileAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  const nr = Number(fd.get("nr"));
  const t = (k: string) => String(fd.get(k) ?? "").trim();
  const zahl = (k: string) => (t(k) ? parseAmount(t(k)) : null);
  try {
    await zeileAendern(s.tenantId, id, nr, { asin: t("asin").toUpperCase() || null, ean: t("ean").replace(/\D/g, "") || null, ek: zahl("ek"), ekNetto: t("netto") !== "brutto", menge: zahl("menge"), packung: zahl("packung") });
  } catch (e) {
    redirect(mit(`${PFAD}/${id}`, `Nicht neu gerechnet – ${lesbarerFehler(e)}`));
  }
  revalidatePath(`${PFAD}/${id}`);
  redirect(mit(`${PFAD}/${id}`, `Zeile ${nr} neu gerechnet.`));
}

export async function statusAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  const status = String(fd.get("status")) as keyof typeof STATUS_TEXT;
  if (!(status in STATUS_TEXT)) redirect(mit(`${PFAD}/${id}`, "Unbekannter Status."));
  const grund = String(fd.get("grund") ?? "");
  if (status === "verworfen" && !grund.trim()) redirect(mit(`${PFAD}/${id}`, "Bitte einen Grund fürs Verwerfen angeben."));
  await statusSetzen(s.tenantId, id, status, grund);
  revalidatePath(PFAD);
  redirect(mit(`${PFAD}/${id}`, `Status: ${STATUS_TEXT[status]}.`));
}

export type TokenState = { token: string; name: string } | { fehler: string } | null;

/** Neuer Geräte-Schlüssel – nur in der Antwort des Formulars sichtbar, nie in der Adresse oder im Protokoll. */
export async function tokenAnlegenAction(_prev: TokenState, fd: FormData): Promise<TokenState> {
  const s = await requireArea("dealeingang");
  if (s.readOnly) return { fehler: "Nur ansehen – keine Schlüssel." };
  const name = String(fd.get("name") ?? "").trim() || "iPhone";
  const r = await tokenAnlegen(s.tenantId, s.userId, name);
  revalidatePath(`${PFAD}/kurzbefehl`);
  return { token: r.token, name };
}

export async function tokenWiderrufenAction(fd: FormData) {
  const s = await schreibend();
  await tokenWiderrufen(s.tenantId, s.userId, String(fd.get("id")));
  redirect(mit(`${PFAD}/kurzbefehl`, "Schlüssel widerrufen – das Gerät kann nichts mehr senden."));
}

/** „In Bestellvorschläge übernehmen“: Einkaufsentwurf mit empfohlener Menge (zählt in der Liquidität als freigegeben). */
export async function bestellvorschlagAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  const nr = Number(fd.get("nr")) || null;
  let m: string;
  try {
    const { inBestellvorschlaege } = await import("@/lib/deal-eingang/ablauf");
    const r = await inBestellvorschlaege(s.tenantId, s.userId, id, nr);
    m = `${r.zeilen} Zeile${r.zeilen === 1 ? "" : "n"} als Einkaufsentwurf angelegt – unter Einkauf prüfen und bestellen.`;
  } catch (e) {
    m = e instanceof DealEingangFehler ? e.message : `Fehler: ${e instanceof Error ? e.message : String(e)}`;
  }
  revalidatePath(PFAD);
  redirect(mit(`${PFAD}/${id}`, m));
}

/** „Als B2B-Deal anlegen“: Entwurf (nicht freigeschaltet) – Preis je Kunde im B2B-Bereich. */
export async function b2bAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  const nr = Number(fd.get("nr")) || null;
  let m: string;
  try {
    const { alsB2bDeal } = await import("@/lib/deal-eingang/ablauf");
    const r = await alsB2bDeal(s.tenantId, s.userId, id, nr);
    m = `B2B-Deal Nr. ${r.nr} als Entwurf angelegt – Preis je Kunde festlegen, dann freischalten.`;
  } catch (e) {
    m = e instanceof DealEingangFehler ? e.message : `Fehler: ${e instanceof Error ? e.message : String(e)}`;
  }
  revalidatePath(PFAD);
  redirect(mit(`${PFAD}/${id}`, m));
}

/** ProfitPath-Kanäle sofort abrufen (sonst jede Minute automatisch). */
export async function profitPathAction() {
  const s = await schreibend();
  let m: string;
  try {
    const { profitPathAbgleich } = await import("@/lib/deal-eingang/profitpath");
    const z = await profitPathAbgleich(s.tenantId);
    // Abschnitt 11: 👍/👎 unter den ProfitPath-Nachrichten gleich mit abholen (sonst alle 15 Minuten).
    const { discordDaumen } = await import("@/lib/deal-eingang/wert");
    const daumen = await discordDaumen(s.tenantId).catch(() => 0);
    m = z ? `ProfitPath: ${z.neu} neu, ${z.updates} Updates, ${z.uebersprungen} übersprungen${daumen ? `, ${daumen} Bewertung${daumen === 1 ? "" : "en"} (👍/👎) aus Discord` : ""}.` : "ProfitPath ist nicht eingerichtet oder läuft gerade.";
  } catch (e) {
    m = `ProfitPath: ${e instanceof Error ? e.message : String(e)}`;
  }
  revalidatePath(PFAD);
  redirect(mit(PFAD, m));
}

/** Abschnitt 10: „Gekauft: Menge, Preis“ – legt die Bestellung als „bestellt“ an (Wareneingang und Rechnung erwartet). */
export async function gekauftAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  const menge = Math.round(Number(String(fd.get("menge") ?? "").replace(",", ".")));
  const preis = parseAmount(fd.get("preis"));
  const nr = Number(fd.get("nr")) || null;
  let ziel: string;
  // B28.5: von Hand gewählter Lieferant (wenn die Quelle fehlt oder nicht passt)
  const supplierId = /^[0-9a-f-]{36}$/i.test(String(fd.get("lieferant") ?? "")) ? String(fd.get("lieferant")) : null;
  try {
    const { alsGekauft } = await import("@/lib/deal-eingang/kauf");
    const B = await import("@/lib/deal-eingang/bestellmail");
    const gewaehlt = supplierId ? await B.lieferantWaehlen(s.tenantId, id, supplierId) : null;
    const r = await alsGekauft(s.tenantId, id, { menge, preis, nr, weg: "knopf", lieferant: gewaehlt?.name ?? null }, s.userId);
    await wareSpeichern(s.tenantId, id, fd);
    let text = `Als gekauft gespeichert: ${menge} Stk${r.bestellungId ? " – Bestellung angelegt, Wareneingang und Rechnung werden erwartet" : ""}.${r.ankauf ? ` ${r.ankauf}` : ""}`;
    // B28.5: Bestellmail an den Lieferanten – nur Entwurf; gesendet wird erst mit „Senden“.
    if (fd.get("bestellmail") === "1") {
      const { bestellmailEntwurf } = B;
      try {
        const m = await bestellmailEntwurf(s.tenantId, id, s.userId, { nr: r.zeile, supplierId });
        text += ` Entwurf der Bestellmail an ${m.an} – bitte prüfen und senden.`;
      } catch (e) {
        text += ` Bestellmail: ${e instanceof DealEingangFehler ? e.message : lesbarerFehler(e)}`;
      }
      ziel = `${mit(`${PFAD}/${id}`, text)}#bestellmail`;
    } else ziel = mit(`${PFAD}/${id}`, text);
  } catch (e) {
    ziel = mit(`${PFAD}/${id}`, e instanceof DealEingangFehler ? e.message : `Nicht gespeichert – ${lesbarerFehler(e)}`);
  }
  revalidatePath(PFAD);
  redirect(ziel);
}

/** B28.5: Verpackung und „EAN weicht ab“ am Deal (aus dem Gekauft- bzw. Ware-Formular). */
async function wareSpeichern(tenantId: string, id: string, fd: FormData) {
  if (!fd.has("verpackung") && !fd.has("ean_abweichend")) return;
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const v = String(fd.get("verpackung") ?? "");
  const ean = String(fd.get("ean_abweichend") ?? "");
  const E = schema.dealEingaenge;
  await db
    .update(E)
    .set({ verpackung: (schema.DEAL_VERPACKUNG as readonly string[]).includes(v) ? (v as (typeof schema.DEAL_VERPACKUNG)[number]) : null, eanAbweichend: ean === "ja" ? true : ean === "nein" ? false : null })
    .where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
}

/** B28.5: Ware (Verpackung, EAN weicht ab) ohne „Gekauft“ speichern. */
export async function wareAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  await wareSpeichern(s.tenantId, id, fd);
  revalidatePath(`${PFAD}/${id}`);
  redirect(`${mit(`${PFAD}/${id}`, "Ware gespeichert.")}#gekauft`);
}

/** B28.5: Entwurf der Bestellmail erstellen (bzw. neu füllen). */
export async function bestellmailEntwurfAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  let m: string;
  try {
    const { bestellmailEntwurf } = await import("@/lib/deal-eingang/bestellmail");
    const lieferant = String(fd.get("lieferant") ?? "");
    const r = await bestellmailEntwurf(s.tenantId, id, s.userId, { supplierId: /^[0-9a-f-]{36}$/i.test(lieferant) ? lieferant : null });
    m = `Entwurf der Bestellmail an ${r.an} – bitte prüfen und senden.`;
  } catch (e) {
    m = e instanceof DealEingangFehler ? e.message : `Kein Entwurf – ${lesbarerFehler(e)}`;
  }
  revalidatePath(`${PFAD}/${id}`);
  redirect(`${mit(`${PFAD}/${id}`, m)}#bestellmail`);
}

/** B28.5: Entwurf speichern, senden oder verwerfen (Knopf „aktion“). Senden nur per Klick. */
export async function bestellmailAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  const mailId = String(fd.get("mail_id"));
  const aktion = String(fd.get("aktion") ?? "speichern");
  const d = { an: String(fd.get("an") ?? ""), betreff: String(fd.get("betreff") ?? ""), text: String(fd.get("text") ?? "") };
  let m: string;
  try {
    const B = await import("@/lib/deal-eingang/bestellmail");
    if (aktion === "verwerfen") {
      await B.bestellmailVerwerfen(s.tenantId, mailId);
      m = "Entwurf verworfen.";
    } else if (aktion === "senden") {
      const r = await B.bestellmailSenden(s.tenantId, mailId, s.userId, d);
      m = r.ok ? `Bestellmail an ${d.an} gesendet – Beleg am Deal und im Einkauf.` : `Nicht gesendet: ${r.fehler}`;
    } else {
      await B.bestellmailSpeichern(s.tenantId, mailId, d);
      m = "Entwurf gespeichert.";
    }
  } catch (e) {
    m = e instanceof DealEingangFehler ? e.message : `Fehler – ${lesbarerFehler(e)}`;
  }
  revalidatePath(`${PFAD}/${id}`);
  redirect(`${mit(`${PFAD}/${id}`, m)}#bestellmail`);
}

/** Abschnitt 11: 👍/👎 mit Kurzgrund (feste Auswahl). */
export async function bewertenAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  const daumen = fd.get("daumen") === "hoch" ? "hoch" : fd.get("daumen") === "runter" ? "runter" : null;
  if (!daumen) redirect(mit(`${PFAD}/${id}`, "Bitte 👍 oder 👎 wählen."));
  const { bewerten } = await import("@/lib/deal-eingang/wert");
  const gruende = fd.getAll("gruende").map(String);
  const freitext = String(fd.get("freitext") ?? "").trim() || null;
  await bewerten(s.tenantId, id, { daumen, grund: String(fd.get("grund") ?? "") || null, gruende, freitext, weg: fd.get("weg") === "push" ? "push" : "tool" });
  revalidatePath(PFAD);
  const mitGrund = daumen === "hoch" ? gruende.length > 0 || !!freitext : !!fd.get("grund") || !!freitext;
  redirect(mit(`${PFAD}/${id}`, `${daumen === "hoch" ? "👍" : "👎"} gespeichert${mitGrund ? " – mit Grund (zählt im Deal-Wert stärker)" : ""}.`));
}

/** Einstellungen (nur Inhaber): Ziel-ROI, Monatsrahmen, Budget-Hinweise je Deal/Tag/Woche, Schwelle des Deal-Werts. */
export async function einstellungenAction(fd: FormData) {
  const s = await schreibend();
  if (s.role !== "owner") redirect(mit(PFAD, "Nur der Inhaber ändert die Einstellungen."));
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, s.tenantId));
  const alt = t?.settings?.dealEingang ?? {};
  const euro = (k: string) => Math.max(0, Math.min(10_000_000, Math.round(parseAmount(fd.get(k)) ?? 0)));
  const dealEingang = {
    ...alt,
    // Jedes Formular schickt nur seine Felder – fehlende bleiben, wie sie sind.
    zielRoi: fd.has("zielRoi") ? Math.max(1, Math.min(500, Math.round(parseAmount(fd.get("zielRoi")) ?? alt.zielRoi ?? 20))) : alt.zielRoi,
    // B28.1: Ziel-Marge (vom Brutto-VK) für „max. EK für Ziel-Marge“, eine Nachkommastelle
    zielMarge: fd.has("zielMarge") ? Math.max(0.5, Math.min(80, Math.round((parseAmount(fd.get("zielMarge")) ?? alt.zielMarge ?? 10) * 10) / 10)) : alt.zielMarge,
    minRoiPa: fd.has("minRoiPa") ? Math.max(0, Math.min(2000, Math.round(parseAmount(fd.get("minRoiPa")) ?? alt.minRoiPa ?? 100))) : alt.minRoiPa,
    budgetJeDeal: fd.has("budgetJeDeal") ? euro("budgetJeDeal") : alt.budgetJeDeal,
    budgetJeTag: fd.has("budgetJeTag") ? euro("budgetJeTag") : alt.budgetJeTag,
    budgetJeWoche: fd.has("budgetJeWoche") ? euro("budgetJeWoche") : alt.budgetJeWoche,
    monatsrahmen: fd.has("monatsrahmen") ? euro("monatsrahmen") : alt.monatsrahmen,
    wertSchwelle: fd.has("wertSchwelle") ? Math.max(0, Math.min(100, Math.round(parseAmount(fd.get("wertSchwelle")) ?? alt.wertSchwelle ?? 70))) : alt.wertSchwelle,
    // B19.1: eigene Schwelle je Quelle, z. B. „Lugru Deals=60“
    wertSchwelleJe: fd.has("wertSchwelleJe") ? wertSchwellenLesen(String(fd.get("wertSchwelleJe") ?? "")) : alt.wertSchwelleJe,
  };
  // Weitere Einstellungen (nur wenn das Formular sie mitschickt): Aufbewahrung, Preislisten-Weiche, Reichweite,
  // eigene Mail-Adresse für Weiterleitungen, iCloud-Link zum fertigen Kurzbefehl.
  const zahl = (k: string, min: number, max: number, alt?: number) => (fd.has(k) ? Math.max(min, Math.min(max, Math.round(parseAmount(fd.get(k)) ?? alt ?? min))) : alt);
  if (fd.has("aufbewahrungMonate")) {
    const mail = String(fd.get("mailAdresse") ?? "").trim().toLowerCase();
    const link = String(fd.get("kurzbefehlLink") ?? "").trim();
    if (mail && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(mail)) redirect(mit(PFAD, "Mail-Adresse ungültig – nicht gespeichert."));
    if (link && !/^https:\/\/(www\.)?icloud\.com\/shortcuts\/[A-Za-z0-9]+/.test(link)) redirect(mit(PFAD, "Der Kurzbefehl-Link muss mit https://www.icloud.com/shortcuts/ beginnen – nicht gespeichert."));
    Object.assign(dealEingang, {
      aufbewahrungMonate: zahl("aufbewahrungMonate", 1, 60, alt.aufbewahrungMonate ?? 12),
      preislisteAbZeilen: zahl("preislisteAbZeilen", 3, 200, alt.preislisteAbZeilen ?? 15),
      maxReichweiteTage: zahl("maxReichweiteTage", 7, 365, alt.maxReichweiteTage ?? 60),
      mailAdresse: mail,
      kurzbefehlLink: link,
    });
  }
  await db.update(schema.tenants).set({ settings: { ...(t?.settings ?? {}), dealEingang } }).where(eq(schema.tenants.id, s.tenantId));
  revalidatePath(PFAD);
  redirect(mit(PFAD, "Einstellungen gespeichert."));
}

/** Abschnitt 11: reale Ergebnisse gekaufter Deals (30/60/90 Tage nach Wareneingang) und „bewährt?“ der Lugru-Deals jetzt rechnen. */
export async function ergebnisseAction(fd: FormData) {
  const s = await schreibend();
  const monat = String(fd.get("monat") ?? "");
  const { ergebnisseAktualisieren, lugruBewaehrtPruefen } = await import("@/lib/deal-eingang/wert");
  const n = await ergebnisseAktualisieren(s.tenantId);
  const b = await lugruBewaehrtPruefen(s.tenantId);
  revalidatePath(PFAD);
  redirect(mit(`${PFAD}/lernen${/^\d{4}-\d{2}$/.test(monat) ? `?monat=${monat}` : ""}`, `${n} Ergebnis${n === 1 ? "" : "se"} zugeordnet, ${b} Lugru-Deal${b === 1 ? "" : "s"} geprüft.`));
}

// ---- Lugru Deals (Deal-Kanäle in Discord) --------------------------------------------------------------------

const LUGRU = `${PFAD}/lugru`;

/** Neue Posts und Reaktionen sofort abrufen (sonst jede Minute bzw. alle 5 Min. automatisch). */
export async function lugruAbrufenAction() {
  const s = await schreibend();
  const { lugruAbgleich } = await import("@/lib/lugru-deals/discord");
  let text: string;
  try {
    const z = await lugruAbgleich(s.tenantId, new Date(), { erzwingen: true });
    text = !z ? "Nicht abgerufen – Anbindung „Lugru Deals“ (Kanal-IDs, Bot) fehlt oder ein Abruf läuft gerade." : `${z.gelesen} Nachrichten gelesen, ${z.erkannt} Deals erkannt (${z.neu} neu, ${z.eingaenge} in den Deal-Eingang${z.zusammengefasst ? `, ${z.zusammengefasst} zusammengefasst` : ""}), ${z.reaktionen} mit neuen Reaktionen.`;
  } catch (e) {
    text = `Abruf fehlgeschlagen – ${lesbarerFehler(e)}`;
  }
  revalidatePath(LUGRU);
  redirect(mit(LUGRU, text));
}

/** B19.1: Lugru-Deals ohne Eingang jetzt in den Deal-Eingang nachtragen (sonst automatisch alle 5 Min., ohne Push). */
export async function lugruEingaengeAction() {
  const s = await schreibend();
  const { lugruHistorieEingaenge, lugruHistorieNeuBewerten, NACHTRAG_JOB } = await import("@/lib/lugru-deals/historie");
  const { recordJob } = await import("@/lib/today/jobs");
  let text: string;
  const t0 = Date.now();
  try {
    const r = await lugruHistorieEingaenge(s.tenantId, 1000);
    const nb = r.neu + r.verknuepft < 1000 ? await lugruHistorieNeuBewerten(s.tenantId, 1000) : null;
    void recordJob(s.tenantId, NACHTRAG_JOB, null, Date.now() - t0);
    // B22.2: danach eigene Käufe abgleichen (neue Eingänge bekommen Menge/EK) und den Deal-Wert nachrechnen
    const k = await (await import("@/lib/lugru-deals/discord")).lugruKaufAbgleichMitStand(s.tenantId);
    const w = await (await import("@/lib/deal-eingang/wert")).wertNachholen(s.tenantId, 1000);
    text = `${r.neu} Lugru-Deals in den Deal-Eingang nachgetragen${r.verknuepft ? `, ${r.verknuepft} mit vorhandenen Eingängen verknüpft` : ""} (ohne Push)${r.offen ? ` – noch ${r.offen} offen, läuft automatisch weiter` : " – alle drin"}${r.fehler ? ` (${r.fehler} nicht lesbar, übersprungen)` : ""}${nb?.neu ? `; ${nb.neu} Ampeln nach den neuen Regeln neu bewertet${nb.offen ? ` (noch ${nb.offen})` : ""}` : ""}; ${k.neu + k.eingaenge ? `${k.neu} eigene Käufe erkannt, ${k.eingaenge} Eingänge als gekauft ergänzt` : "keine neuen eigenen Käufe"}; Deal-Wert für ${w.neu} Deals berechnet${w.offen ? ` (noch ${w.offen})` : ""}.`;
  } catch (e) {
    void recordJob(s.tenantId, NACHTRAG_JOB, lesbarerFehler(e), Date.now() - t0);
    text = `Nachtragen fehlgeschlagen – ${lesbarerFehler(e)}`;
  }
  revalidatePath(LUGRU);
  redirect(mit(LUGRU, text));
}

/** Eigene Käufe zu Lugru-Deals jetzt erkennen (sonst alle 6 Std.): sellerboard-SKUs, Chargen, Bestellungen, FBA-Sendungen, Deal-Eingang „gekauft“. */
export async function lugruKaufAction() {
  const s = await schreibend();
  let text: string;
  try {
    const k = await (await import("@/lib/lugru-deals/discord")).lugruKaufAbgleichMitStand(s.tenantId);
    // Kaufen mit einem Tap: vorbereitete Käufe (> 24 Std.) gleich mit abgleichen bzw. erinnern
    const v = await (await import("@/lib/deal-eingang/kauf")).kaufVorbereitetPruefen(s.tenantId);
    const vText = v.gekauft || v.erinnert ? ` Kauf vorbereitet: ${v.gekauft} als gekauft erkannt (sellerboard-SKU)${v.erinnert ? `, ${v.erinnert} Erinnerung(en) „noch offen?“` : ""}.` : "";
    text = (k.neu || k.eingaenge ? `${k.neu} eigene Käufe neu erkannt${k.eingaenge ? `, ${k.eingaenge} Einträge im Deal-Eingang als gekauft ergänzt (Menge, EK, Kaufdatum)` : ""}.` : "Keine weiteren eigenen Käufe gefunden (gleiche ASIN, 0–21 Tage nach dem Posten; sellerboard-SKUs, Chargen, Bestellungen, FBA-Sendungen).") + vText;
  } catch (e) {
    text = `Abgleich fehlgeschlagen – ${lesbarerFehler(e)}`;
  }
  revalidatePath(LUGRU);
  redirect(mit(LUGRU, text));
}

/** History einlesen bzw. fortsetzen (je Klick bis zu 2.000 Nachrichten je Kanal; sonst automatisch alle 5 Min.). */
export async function lugruHistorieAction(fd: FormData) {
  const s = await schreibend();
  const lg = await import("@/lib/lugru-deals/discord");
  if (fd.get("neu") === "1") await lg.lugruHistorieNeu(s.tenantId);
  let text: string;
  try {
    const r = await lg.lugruHistorie(s.tenantId, { seiten: 20 });
    const k = await lg.lugruKaufAbgleich(s.tenantId);
    text = !r ? "Anbindung „Lugru Deals“ fehlt (Kanal-IDs, Bot)." : `History: ${r.gelesen} Nachrichten gelesen, ${r.erkannt} Deals erkannt (${r.neu} neu)${r.fertig ? " – fertig" : " – läuft weiter (automatisch alle 5 Min.)"}; ${k} eigene Käufe erkannt.`;
  } catch (e) {
    text = `History fehlgeschlagen – ${lesbarerFehler(e)}`;
  }
  revalidatePath(LUGRU);
  redirect(mit(LUGRU, text));
}

/** B28.5 Einstellungen → Deal-Quellen: Lieferant je Deal-Quelle speichern bzw. entfernen. */
export async function dealQuelleAction(fd: FormData) {
  const s = await schreibend();
  const ziel = "/deal-eingang/quellen";
  let m: string;
  try {
    const B = await import("@/lib/deal-eingang/bestellmail");
    if (fd.get("aktion") === "entfernen") {
      await B.dealQuelleEntfernen(s.tenantId, String(fd.get("supplier_id")));
      m = "Deal-Quelle entfernt (der Lieferant bleibt im Einkauf).";
    } else {
      const name = String(fd.get("name") ?? "");
      await B.dealQuelleSpeichern(s.tenantId, {
        name,
        email: String(fd.get("email") ?? "").trim() || null,
        ansprechpartner: String(fd.get("ansprechpartner") ?? "").trim() || null,
        zahlungsweg: String(fd.get("zahlungsweg") ?? "").trim() || null,
        rechnungMitEan: fd.get("rechnung_mit_ean") === "1",
        dealQuellen: String(fd.get("quellen") ?? "").split(/[,;\n]/),
      });
      m = `Deal-Quelle „${name.trim()}“ gespeichert.`;
    }
  } catch (e) {
    m = e instanceof DealEingangFehler ? e.message : `Nicht gespeichert – ${lesbarerFehler(e)}`;
  }
  revalidatePath(ziel);
  redirect(mit(ziel, m));
}

/** B28.5: Liefer-/Rechnungsadresse, USt-IdNr. und Kopie für Bestellmails (nur Inhaber). */
export async function bestellEinstellungenAction(fd: FormData) {
  const s = await schreibend();
  const ziel = "/deal-eingang/quellen";
  if (s.role !== "owner") redirect(mit(ziel, "Nur der Inhaber ändert die Einstellungen."));
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, s.tenantId));
  const dealEingang = {
    ...(t?.settings?.dealEingang ?? {}),
    bestellAdresse: String(fd.get("bestellAdresse") ?? "").trim().slice(0, 500),
    bestellUstId: String(fd.get("bestellUstId") ?? "").trim().slice(0, 30),
    bestellKopie: fd.get("bestellKopie") === "1",
  };
  await db.update(schema.tenants).set({ settings: { ...(t?.settings ?? {}), dealEingang } }).where(eq(schema.tenants.id, s.tenantId));
  revalidatePath(ziel);
  redirect(mit(ziel, "Bestellmail-Einstellungen gespeichert."));
}

// ---- B28.8 Lernschleife Verlustprodukte (nur der Inhaber beantwortet, nicht die VA) ------------------------------

const LERNEN = `${PFAD}/lernen`;
/** Meldung als Query vor dem Anker (sonst landet sie im #-Teil und kommt nie beim Server an). */
const zurLernschleife = (meldung: string) => `${mit(LERNEN, meldung)}#lernschleife`;

async function nurInhaber() {
  const s = await requireArea("dealeingang");
  if (s.role !== "owner" || s.readOnly) redirect(zurLernschleife("Die Lernschleife beantwortet nur der Inhaber."));
  return s;
}

/** Antwort je Verlustprodukt: Nie wieder / Pech / Weiß nicht warum, optional Gründe und Freitext. */
export async function lernschleifeAntwortAction(fd: FormData) {
  const s = await nurInhaber();
  const { istLernAntwort, LERN_GRUENDE_EXTRA } = await import("@/lib/deal-eingang/lernschleife-logic");
  const { DAUMEN_GRUENDE, DAUMEN_GRUENDE_HOCH } = await import("@/db/tables/deal-eingang");
  const id = String(fd.get("id") ?? "");
  const antwort = fd.get("antwort");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !istLernAntwort(antwort)) redirect(zurLernschleife("Antwort fehlt."));
  const erlaubt = new Set<string>([...DAUMEN_GRUENDE, ...DAUMEN_GRUENDE_HOCH, ...LERN_GRUENDE_EXTRA]);
  const gruende = fd.getAll("grund").map(String).filter((g) => erlaubt.has(g));
  const freitext = String(fd.get("freitext") ?? "").trim() || null;
  const { lernschleifeBeantworten } = await import("@/lib/deal-eingang/lernschleife");
  const r = await lernschleifeBeantworten(s.tenantId, s.userId, id, antwort, gruende, freitext);
  revalidatePath(LERNEN);
  redirect(zurLernschleife(r ? `Gespeichert: ${(r.titel ?? r.asin ?? "Produkt").slice(0, 40)}.` : "Produkt nicht gefunden."));
}

/** Liste des Vormonats jetzt anlegen (sonst automatisch am 3. des Monats) – ohne Push. */
export async function lernschleifeErstellenAction() {
  const s = await nurInhaber();
  const { lernschleifeErstellen } = await import("@/lib/deal-eingang/lernschleife");
  const r = await lernschleifeErstellen(s.tenantId, undefined, { push: false });
  revalidatePath(LERNEN);
  redirect(zurLernschleife(`Lernschleife ${r.monat}: ${r.produkte} Verlustprodukt${r.produkte === 1 ? "" : "e"}, ${r.neu} neu.`));
}

/** B34.4: Ankauf als Ausstiegsweg – Ankaufspreis und Risikofelder am Deal (nur intern). */
export async function ankaufAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  if (s.role !== "owner") redirect(mit(`${PFAD}/${id}`, "Ankauf ist nur für den Inhaber (Insider-Wissen)."));
  const zahl = (k: string) => {
    const v = String(fd.get(k) ?? "").trim();
    if (!v) return null;
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  };
  const text = (k: string) => String(fd.get(k) ?? "").trim().slice(0, 200) || null;
  let meldung: string;
  try {
    const { ankaufSpeichern } = await import("@/lib/deal-eingang/ankauf");
    const { istLegitCheck } = await import("@/lib/deal-eingang/ankauf-logic");
    const legit = String(fd.get("legit") ?? "offen");
    const preis = zahl("preis") ?? null;
    const menge = zahl("menge_angemeldet");
    const ziel = zahl("zahlungsziel");
    const rueck = zahl("rueckverguetung");
    if ([preis, menge, ziel, rueck].some((n) => Number.isNaN(n))) throw new DealEingangFehler("Bitte Zahlen eingeben.");
    const a = await ankaufSpeichern(s.tenantId, id, {
      zeile: Number(fd.get("zeile")) || null,
      preis: preis !== null ? Math.round(preis * 100) / 100 : null,
      ankaeufer: text("ankaeufer"),
      legitCheck: istLegitCheck(legit) ? legit : "offen",
      legitNotiz: text("legit_notiz"),
      mengeAngemeldet: menge === null ? null : Math.round(menge),
      annahmefrist: /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get("annahmefrist") ?? "")) ? String(fd.get("annahmefrist")) : null,
      ankauftBestaetigtAm: /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get("bestaetigt") ?? "")) ? String(fd.get("bestaetigt")) : null,
      versandfrist: /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get("versandfrist") ?? "")) ? String(fd.get("versandfrist")) : null,
      zahlungszielTage: ziel === null ? null : Math.max(0, Math.round(ziel)),
      rueckverguetungProzent: rueck === null ? 0 : Math.min(20, Math.max(0, rueck)),
    });
    meldung = a.preis ? "Ankauf gespeichert – Vergleich Amazon / Ankauf unten." : "Ankauf gespeichert (ohne Ankaufspreis kein Vergleich).";
  } catch (e) {
    meldung = e instanceof DealEingangFehler ? e.message : `Nicht gespeichert – ${lesbarerFehler(e)}`;
  }
  revalidatePath(`${PFAD}/${id}`);
  redirect(`${mit(`${PFAD}/${id}`, meldung)}#ankauf`);
}

/** B34.5: Ausgang des Ankaufs (angekauft / liegt / Verlust) → Aufgabe erledigt, Lernschleife. */
export async function ankaufAusgangAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  if (s.role !== "owner") redirect(mit(`${PFAD}/${id}`, "Ankauf ist nur für den Inhaber (Insider-Wissen)."));
  let meldung: string;
  try {
    const { ankaufAusgangSetzen } = await import("@/lib/deal-eingang/ankauf");
    const { istAnkaufAusgang } = await import("@/lib/deal-eingang/ankauf-logic");
    const ausgang = String(fd.get("ausgang") ?? "");
    if (!istAnkaufAusgang(ausgang)) throw new DealEingangFehler("Bitte den Ausgang wählen.");
    meldung = await ankaufAusgangSetzen(s.tenantId, id, ausgang, String(fd.get("notiz") ?? "") || null);
  } catch (e) {
    meldung = e instanceof DealEingangFehler ? e.message : `Nicht gespeichert – ${lesbarerFehler(e)}`;
  }
  revalidatePath(`${PFAD}/${id}`);
  redirect(`${mit(`${PFAD}/${id}`, meldung)}#ankauf`);
}
