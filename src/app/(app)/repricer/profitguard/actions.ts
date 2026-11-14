"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireArea, requireOwner } from "@/lib/auth/session";
import { EXPORT_LAENDER, STRATEGIEN, staffelAusText, istStrategie, type ExportLand, type Strategie } from "@/lib/repricing/strategie-logic";
import { getSettings } from "@/lib/settings";
import { exportImportiertBestaetigen, istAlsSollUebernehmen, profitguardExportErzeugen, repricingAbgleichAufgabe, repricingEinstellungenSpeichern, vorschlagFreigeben, zuweisungLoeschen, zuweisungSetzen } from "@/lib/repricing/soll-service";
import { lesbarerFehler } from "@/lib/fehler-text";
import { parseAmount } from "@/lib/numbers";

// Repricer → ProfitGuard-Datei: Freigabe und Importdatei, Soll-Strategien, Liquidation, Regel-Leiter, Einstellungen.
// Nichts davon sendet etwas an ProfitGuard oder Amazon.

const PFAD = "/repricer/profitguard";
const LIQ = "#liquidation";
const zurueck = (meldung: string, extra = ""): never => redirect(`${PFAD}?meldung=${encodeURIComponent(meldung)}${extra}`);
const laenderAus = (fd: FormData) => fd.getAll("land").map(String).filter((l): l is ExportLand => (EXPORT_LAENDER as readonly string[]).includes(l));
const landSku = (fd: FormData) => {
  const land = String(fd.get("land") ?? "");
  const sku = String(fd.get("sku") ?? "").trim();
  if (!(EXPORT_LAENDER as readonly string[]).includes(land) || !sku) zurueck("Land und SKU fehlen.", LIQ);
  return { land, sku };
};

async function schreibend() {
  const s = await requireArea("buchhaltung");
  if (s.readOnly) zurueck("Nur ansehen – Änderungen sind gesperrt.");
  return s;
}

/** Importdatei für ProfitGuard erzeugen – mit Strategiewechsel/Liquidation/Min unter Break-even nur mit „Freigabe geprüft“. */
export async function exportErzeugenAction(fd: FormData) {
  const s = await schreibend();
  const laender = laenderAus(fd);
  if (!laender.length) zurueck("Bitte mindestens ein Land wählen.");
  const nurAenderungen = fd.get("nur_aenderungen") === "1";
  let r: Awaited<ReturnType<typeof profitguardExportErzeugen>> | null = null;
  try {
    r = await profitguardExportErzeugen(s.tenantId, s.userId, { laender, nurAenderungen, freigegeben: fd.get("freigabe") === "1" });
  } catch (e) {
    zurueck(`Datei konnte nicht erzeugt werden – ${lesbarerFehler(e)}`);
  }
  if (!r || !r.ok) return zurueck(r ? r.text : "Datei konnte nicht erzeugt werden.", "#export");
  const n = Object.values(r.anzahl).reduce((a, b) => a + b, 0);
  revalidatePath(PFAD);
  redirect(`${PFAD}?export=${r.id}&meldung=${encodeURIComponent(`Datei erzeugt: ${n} Zeilen (${Object.entries(r.anzahl).map(([l, x]) => `${l} ${x}`).join(", ")}). Unten herunterladen und in ProfitGuard unter „Export & Import“ importieren.`)}#export`);
}

/** Datei als in ProfitGuard importiert bestätigen (nur Vermerk). */
export async function importiertAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("export") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) zurueck("Datei fehlt.");
  await exportImportiertBestaetigen(s.tenantId, id, s.name || s.email);
  revalidatePath(PFAD);
  revalidatePath("/einstellungen/hintergrund");
  zurueck("Als in ProfitGuard importiert vermerkt – der nächste ProfitGuard-Export zeigt, ob alles übernommen wurde.", `&export=${id}#export`);
}

export async function zuweisungAction(fd: FormData) {
  const s = await schreibend();
  const sku = String(fd.get("sku") ?? "").trim();
  const regel = String(fd.get("regel") ?? "").trim();
  const laender = laenderAus(fd);
  const u = String(fd.get("untergrenze") ?? "").trim();
  const untergrenze = u ? parseAmount(u) : null;
  if (!sku || !istStrategie(regel) || !laender.length) zurueck("SKU, Strategie und mindestens ein Land angeben.");
  if (u && (untergrenze === null || untergrenze <= 0)) zurueck("Untergrenze als Betrag angeben (z. B. 12,99).");
  for (const land of laender) await zuweisungSetzen(s.tenantId, { land, sku, regel, untergrenze, quelle: "hand", grund: String(fd.get("grund") ?? "").trim() || null });
  revalidatePath(PFAD);
  zurueck(`${sku}: ${regel} in ${laender.join(", ")} gespeichert.`);
}

export async function zuweisungLoeschenAction(fd: FormData) {
  const s = await schreibend();
  await zuweisungLoeschen(s.tenantId, String(fd.get("land")), String(fd.get("sku")));
  revalidatePath(PFAD);
  zurueck("Zuweisung entfernt – die SKU bekommt wieder die Standard-Strategie.");
}

export async function vorschlagFreigebenAction(fd: FormData) {
  const s = await schreibend();
  const sku = String(fd.get("sku") ?? "");
  await vorschlagFreigeben(s.tenantId, sku);
  revalidatePath(PFAD);
  zurueck(`${sku} auf Abverkauf gesetzt (alle Länder).`);
}

export async function istUebernehmenAction() {
  const s = await schreibend();
  const r = await istAlsSollUebernehmen(s.tenantId);
  await repricingAbgleichAufgabe(s.tenantId).catch(() => undefined);
  revalidatePath(PFAD);
  zurueck(`Aus ProfitGuard übernommen: ${r.liquidation} Liquidation (mit Untergrenze), ${r.andere} andere Strategien.`);
}

/** Strategien: Margen-Staffeln (Standard, Abverkauf) und Strategiename je Soll-Strategie in ProfitGuard. */
export async function strategieEinstellungenAction(fd: FormData) {
  const s = await requireOwner();
  const alt = (await getSettings(s.tenantId)).repricing;
  const standard = staffelAusText(String(fd.get("staffel_standard") ?? ""));
  const abverkauf = staffelAusText(String(fd.get("staffel_abverkauf") ?? ""));
  if (!standard || !abverkauf) zurueck("Staffel im Format „30:10, 60:8, 90:7, :0“ angeben (bis Tage : Marge in %).", "#strategien");
  const namen = { ...alt.profitguard.strategieNamen };
  for (const st of STRATEGIEN) {
    const v = String(fd.get(`name_${st}`) ?? "").trim();
    if (v) namen[st as Strategie] = v.slice(0, 80);
  }
  await repricingEinstellungenSpeichern(s.tenantId, { staffeln: { standard: standard!, abverkauf: abverkauf! }, profitguard: { strategieNamen: namen, format: alt.profitguard.format } });
  revalidatePath(PFAD);
  revalidatePath("/repricer");
  zurueck("Strategien gespeichert – Soll-Min und Abgleich rechnen sich neu.", "#strategien");
}

/** Gelerntes Dateiformat verwerfen (dann gilt die Standard-CSV bis zum nächsten ProfitGuard-Export). */
export async function formatZuruecksetzenAction() {
  const s = await requireOwner();
  const alt = (await getSettings(s.tenantId)).repricing;
  await repricingEinstellungenSpeichern(s.tenantId, { profitguard: { strategieNamen: alt.profitguard.strategieNamen, format: null } });
  revalidatePath(PFAD);
  zurueck("Dateiformat zurückgesetzt – bis zum nächsten ProfitGuard-Export gilt die Standard-CSV.", "#strategien");
}

/** Rückkehr-Vorschlag: zurück auf die ursprüngliche Strategie bzw. auf Liquidation bleiben. */
export async function rueckkehrAction(fd: FormData) {
  const s = await requireOwner();
  const { land, sku } = landSku(fd);
  const { rueckkehrAblehnen, rueckkehrFreigeben } = await import("@/lib/repricing/liquidation");
  if (fd.get("entscheidung") === "bleiben") {
    await rueckkehrAblehnen(s.tenantId, land, sku);
    revalidatePath(PFAD);
    zurueck(`${sku} (${land}) bleibt auf Liquidation.`, LIQ);
  }
  const regel = await rueckkehrFreigeben(s.tenantId, land, sku);
  revalidatePath(PFAD);
  zurueck(regel ? `${sku} (${land}): zurück auf „${regel}“ – steht in der nächsten ProfitGuard-Datei.` : "Keine ursprüngliche Strategie gemerkt.", LIQ);
}

/** „Mindest-Verlust akzeptiert bis x €“ je Stück (leer = nur bis Break-even). */
export async function verlustFreigabeAction(fd: FormData) {
  const s = await requireOwner();
  const { land, sku } = landSku(fd);
  const roh = String(fd.get("verlust_bis") ?? "").trim();
  const wert = roh ? parseAmount(roh) : null;
  if (roh && (wert === null || wert < 0)) zurueck("Betrag je Stück angeben (z. B. 3,50).", LIQ);
  const { verlustFreigabeSetzen } = await import("@/lib/repricing/liquidation");
  await verlustFreigabeSetzen(s.tenantId, land, sku, wert);
  revalidatePath(PFAD);
  zurueck(wert ? `${sku} (${land}): Abverkauf mit Verlust bis ${roh} € je Stück freigegeben.` : `${sku} (${land}): Min nur bis Break-even.`, LIQ);
}

/** Liquidation, Regel-Leiter und Abgleich jetzt prüfen (sonst täglich). */
export async function liquidationPruefenAction() {
  const s = await schreibend();
  const { liquidationenPflegen } = await import("@/lib/repricing/liquidation");
  const r = await liquidationenPflegen(s.tenantId);
  await repricingAbgleichAufgabe(s.tenantId).catch(() => undefined);
  revalidatePath(PFAD);
  zurueck(`Geprüft: ${r.aktiviert} Liquidation(en) neu aktiv, ${r.vorgeschlagen} neue Rückkehr-Vorschläge, ${r.offen} offen.`, LIQ);
}

const LEITER = "#leiter";

/** Vorschlag der Regel-Leiter entscheiden (Freigeben / Ablehnen / Später; Schnelldreher-Ende: Verlängern / Abverkauf / Min). */
export async function leiterVorschlagAction(fd: FormData) {
  const s = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const e = String(fd.get("entscheidung") ?? "freigeben") as import("@/lib/repricing/leiter").Entscheidung;
  if (!/^[0-9a-f-]{36}$/i.test(id)) zurueck("Vorschlag fehlt.", LEITER);
  const { vorschlagEntscheiden } = await import("@/lib/repricing/leiter");
  const text = await vorschlagEntscheiden(s.tenantId, id, e, s.userId);
  revalidatePath(PFAD);
  revalidatePath("/repricer");
  zurueck(text, LEITER);
}

/** Liquidation läuft ab – verlängern, zurück auf Stufe 2, dauerhaft; „bis“ von Hand. */
export async function ablaufAction(fd: FormData) {
  const s = await requireOwner();
  const land = String(fd.get("land") ?? "");
  const sku = String(fd.get("sku") ?? "").trim();
  const wahl = String(fd.get("wahl") ?? "") as "verlaengern" | "zurueck" | "dauerhaft" | "bis";
  if (!(EXPORT_LAENDER as readonly string[]).includes(land) || !sku || !["verlaengern", "zurueck", "dauerhaft", "bis"].includes(wahl)) zurueck("Angaben fehlen.", LIQ);
  const { ablaufEntscheiden } = await import("@/lib/repricing/liquidation");
  const r = await ablaufEntscheiden(s.tenantId, land, sku, wahl, String(fd.get("bis") ?? "") || null);
  revalidatePath(PFAD);
  zurueck(r ? `${sku} (${land}): ${r}.` : "Keine Liquidation gefunden.", LIQ);
}

/** Zustand von Hand für mehrere SKUs (Repricer-Übersicht, Mehrfachauswahl). */
export async function zustandAction(fd: FormData) {
  const s = await requireOwner();
  const { ZUSTAENDE } = await import("@/lib/repricing/leiter-logic");
  const z = String(fd.get("zustand") ?? "");
  const skus = [...new Set(fd.getAll("wahl").map((w) => String(w).split("|").slice(1).join("|")).filter(Boolean))];
  const ziel = `/repricer?ab=alle${fd.get("zurueck_q") ? `&q=${encodeURIComponent(String(fd.get("zurueck_q")))}` : ""}#abgleich`;
  if (!skus.length || (z !== "auto" && !(ZUSTAENDE as string[]).includes(z))) redirect(`${ziel.replace("#", `&meldung=${encodeURIComponent("Bitte SKUs und Zustand wählen.")}#`)}`);
  const { zustandSetzen } = await import("@/lib/repricing/leiter");
  await zustandSetzen(s.tenantId, skus, z as never, s.userId);
  revalidatePath("/repricer");
  revalidatePath(PFAD);
  redirect(ziel.replace("#", `&meldung=${encodeURIComponent(`Zustand ${z === "auto" ? "wieder automatisch" : `„${z}“`} für ${skus.length} SKU${skus.length === 1 ? "" : "s"} – Zielpreis und Min rechnen sich neu.`)}#`));
}

/** Schnelldreher von Hand setzen/entfernen (Mehrfachauswahl) – zwei Aktionen, weil die Knöpfe außerhalb der Tabelle stehen. */
export async function schnelldreherAnAction(fd: FormData) {
  return schnelldreherSetzenAus(fd, true);
}
export async function schnelldreherAusAction(fd: FormData) {
  return schnelldreherSetzenAus(fd, false);
}
async function schnelldreherSetzenAus(fd: FormData, an: boolean) {
  const s = await requireOwner();
  const eintraege = [...new Set(fd.getAll("wahl").map(String))].map((w) => ({ land: w.split("|")[0], sku: w.split("|").slice(1).join("|") })).filter((x) => (EXPORT_LAENDER as readonly string[]).includes(x.land) && x.sku);
  const ziel = `/repricer?ab=alle${fd.get("zurueck_q") ? `&q=${encodeURIComponent(String(fd.get("zurueck_q")))}` : ""}`;
  if (!eintraege.length) redirect(`${ziel}&meldung=${encodeURIComponent("Bitte SKUs wählen.")}#abgleich`);
  const { schnelldreherSetzen } = await import("@/lib/repricing/leiter");
  await schnelldreherSetzen(s.tenantId, eintraege, an);
  revalidatePath("/repricer");
  revalidatePath(PFAD);
  redirect(`${ziel}&meldung=${encodeURIComponent(`${eintraege.length} SKU${eintraege.length === 1 ? "" : "s"}: Schnelldreher ${an ? "gesetzt (Boden-Marge, kein Abverkauf)" : "entfernt"}.`)}#abgleich`);
}

/** Leiter-Einstellungen: Schwellen, Reihenfolge, Liquidation-Dauer, Schnelldreher, Zustand. */
export async function leiterEinstellungenAction(fd: FormData) {
  const s = await requireOwner();
  const alt = (await getSettings(s.tenantId)).repricing.leiter;
  const zahl = (k: string, d: number) => {
    const v = parseAmount(String(fd.get(k) ?? ""));
    return v !== null && v >= 0 ? v : d;
  };
  const fest = String(fd.get("liquidation_bis_fest") ?? "").trim();
  const faktoren = { ...alt.zustand.faktoren };
  for (const k of Object.keys(faktoren) as (keyof typeof faktoren)[]) faktoren[k] = Math.min(1, zahl(`faktor_${k}`, faktoren[k]));
  const leiter = {
    ...alt,
    reihenfolge: fd.get("reihenfolge") === "liquidation_zuerst" ? ("liquidation_zuerst" as const) : ("abverkauf_zuerst" as const),
    reichweiteTage: zahl("reichweite_tage", alt.reichweiteTage),
    alterTage12: zahl("alter_12", alt.alterTage12),
    kapital12: zahl("kapital_12", alt.kapital12),
    ueberTage: zahl("ueber_tage", alt.ueberTage),
    bbQuote12: zahl("bb_quote_12", alt.bbQuote12),
    alterTage23: zahl("alter_23", alt.alterTage23),
    kapital23: zahl("kapital_23", alt.kapital23),
    liquidationTage: zahl("liquidation_tage", alt.liquidationTage),
    liquidationBisFest: /^\d{4}-\d{2}-\d{2}$/.test(fest) ? fest : null,
    verlaengernTage: zahl("verlaengern_tage", alt.verlaengernTage),
    schnell: { ...alt.schnell, verkaeufe30: zahl("schnell_verkaeufe", alt.schnell.verkaeufe30), margeBoden: zahl("schnell_boden", alt.schnell.margeBoden), ohneBuyboxTage: zahl("schnell_ohne_bb", alt.schnell.ohneBuyboxTage) },
    zustand: { ...alt.zustand, faktoren, mindestmarge: zahl("zustand_marge", alt.zustand.mindestmarge) },
  };
  await repricingEinstellungenSpeichern(s.tenantId, { leiter });
  revalidatePath(PFAD);
  zurueck("Leiter-Einstellungen gespeichert – gelten ab dem nächsten Lauf (oder „Jetzt prüfen“).", "#leiter-einstellungen");
}
