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
  try {
    const { alsGekauft } = await import("@/lib/deal-eingang/kauf");
    const r = await alsGekauft(s.tenantId, id, { menge, preis, nr, weg: "knopf" }, s.userId);
    ziel = mit(`${PFAD}/${id}`, `Als gekauft gespeichert: ${menge} Stk${r.bestellungId ? " – Bestellung angelegt, Wareneingang und Rechnung werden erwartet" : ""}.`);
  } catch (e) {
    ziel = mit(`${PFAD}/${id}`, e instanceof DealEingangFehler ? e.message : `Nicht gespeichert – ${lesbarerFehler(e)}`);
  }
  revalidatePath(PFAD);
  redirect(ziel);
}

/** Abschnitt 11: 👍/👎 mit Kurzgrund (feste Auswahl). */
export async function bewertenAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("id"));
  const daumen = fd.get("daumen") === "hoch" ? "hoch" : fd.get("daumen") === "runter" ? "runter" : null;
  if (!daumen) redirect(mit(`${PFAD}/${id}`, "Bitte 👍 oder 👎 wählen."));
  const { bewerten } = await import("@/lib/deal-eingang/wert");
  await bewerten(s.tenantId, id, { daumen, grund: String(fd.get("grund") ?? "") || null, weg: fd.get("weg") === "push" ? "push" : "tool" });
  revalidatePath(PFAD);
  redirect(mit(`${PFAD}/${id}`, daumen === "hoch" ? "👍 gespeichert." : "👎 gespeichert."));
}

/** Einstellungen (nur Inhaber): Ziel-ROI, Budget je Deal/Tag/Woche, Schwelle des Deal-Werts für die Kauf-Meldung. */
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
    budgetJeDeal: fd.has("budgetJeDeal") ? euro("budgetJeDeal") : alt.budgetJeDeal,
    budgetJeTag: fd.has("budgetJeTag") ? euro("budgetJeTag") : alt.budgetJeTag,
    budgetJeWoche: fd.has("budgetJeWoche") ? euro("budgetJeWoche") : alt.budgetJeWoche,
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
  const { lugruHistorieEingaenge } = await import("@/lib/lugru-deals/historie");
  let text: string;
  try {
    const r = await lugruHistorieEingaenge(s.tenantId, 1000);
    text = `${r.neu} Lugru-Deals in den Deal-Eingang nachgetragen${r.verknuepft ? `, ${r.verknuepft} mit vorhandenen Eingängen verknüpft` : ""} (ohne Push)${r.offen ? ` – noch ${r.offen} offen, läuft automatisch weiter` : " – alle drin"}.`;
  } catch (e) {
    text = `Nachtragen fehlgeschlagen – ${lesbarerFehler(e)}`;
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
