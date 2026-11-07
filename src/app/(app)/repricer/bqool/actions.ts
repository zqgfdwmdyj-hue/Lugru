"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireArea, requireOwner } from "@/lib/auth/session";
import { EXPORT_LAENDER, type ExportLand, type KatalogRegel, type MarkenRegel } from "@/lib/bqool/export-logic";
import { bqoolAbgleichAufgabe, bqoolEinstellungenSpeichern, bqoolExportErzeugen, istAlsSollUebernehmen, vorschlagFreigeben, zuweisungLoeschen, zuweisungSetzen } from "@/lib/bqool/export-service";
import { lesbarerFehler } from "@/lib/fehler-text";
import { parseAmount } from "@/lib/numbers";

const PFAD = "/repricer/bqool";
const zurueck = (meldung: string, extra = ""): never => redirect(`${PFAD}?meldung=${encodeURIComponent(meldung)}${extra}`);
const laenderAus = (fd: FormData) => fd.getAll("land").map(String).filter((l): l is ExportLand => (EXPORT_LAENDER as readonly string[]).includes(l));

async function schreibend() {
  const s = await requireArea("buchhaltung");
  if (s.readOnly) zurueck("Nur ansehen – Änderungen sind gesperrt.");
  return s;
}

export async function exportErzeugenAction(fd: FormData) {
  const s = await schreibend();
  const laender = laenderAus(fd);
  if (!laender.length) zurueck("Bitte mindestens ein Land wählen.");
  const nurAenderungen = fd.get("nur_aenderungen") === "1";
  let ziel = "";
  try {
    const r = await bqoolExportErzeugen(s.tenantId, s.userId, { laender, nurAenderungen });
    const n = Object.values(r.anzahl).reduce((a, b) => a + b, 0);
    ziel = `${PFAD}?export=${r.id}&meldung=${encodeURIComponent(`Export erzeugt: ${n} Zeilen (${Object.entries(r.anzahl).map(([l, x]) => `${l} ${x}`).join(", ")}). Dateien unten herunterladen und bei BQool hochladen.`)}`;
  } catch (e) {
    zurueck(`Export fehlgeschlagen – ${lesbarerFehler(e)}`);
  }
  revalidatePath(PFAD);
  redirect(ziel);
}

export async function zuweisungAction(fd: FormData) {
  const s = await schreibend();
  const sku = String(fd.get("sku") ?? "").trim();
  const regel = String(fd.get("regel") ?? "").trim();
  const laender = laenderAus(fd);
  const u = String(fd.get("untergrenze") ?? "").trim();
  const untergrenze = u ? parseAmount(u) : null;
  if (!sku || !regel || !laender.length) zurueck("SKU, Regel und mindestens ein Land angeben.");
  if (u && (untergrenze === null || untergrenze <= 0)) zurueck("Untergrenze als Betrag angeben (z. B. 12,99).");
  for (const land of laender) await zuweisungSetzen(s.tenantId, { land, sku, regel, untergrenze, quelle: "hand", grund: String(fd.get("grund") ?? "").trim() || null });
  revalidatePath(PFAD);
  zurueck(`${sku}: ${regel} in ${laender.join(", ")} gespeichert.`);
}

export async function zuweisungLoeschenAction(fd: FormData) {
  const s = await schreibend();
  await zuweisungLoeschen(s.tenantId, String(fd.get("land")), String(fd.get("sku")));
  revalidatePath(PFAD);
  zurueck("Zuweisung entfernt – die SKU bekommt wieder die Standardregel.");
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
  await bqoolAbgleichAufgabe(s.tenantId).catch(() => undefined);
  revalidatePath(PFAD);
  zurueck(`Aus BQool übernommen: ${r.liquidation} Liquidation (mit Untergrenze), ${r.andere} andere Regeln.`);
}

/** Staffel „30:10, 60:8, …, :0“ → Stufen. */
function staffelAus(t: string): KatalogRegel["staffel"] {
  const teile = t.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  if (!teile.length) return null;
  return teile.map((x) => {
    // „30:10 SB“ / „60:8 EQ“ – Unterregel optional (SB = Sales Booster, EQ = Equalizer)
    const [bis, rest] = x.split(":").map((y) => y.trim());
    const m = /^([\d.,]+)\s*(SB|EQ|Sales Booster|Equalizer)?$/i.exec(rest ?? "0");
    const u = m?.[2]?.toUpperCase();
    return { bisTage: bis ? Number(bis) : null, marge: m ? Number(m[1].replace(",", ".")) : NaN, ...(u ? { unterregel: u.startsWith("E") ? ("Equalizer" as const) : ("Sales Booster" as const) } : {}) };
  });
}

export async function katalogAction(fd: FormData) {
  const s = await schreibend();
  const namen = fd.getAll("name").map(String);
  const katalog: KatalogRegel[] = [];
  namen.forEach((n, i) => {
    const name = n.trim();
    if (!name || fd.get(`loeschen_${i}`) === "1") return;
    const laender = String(fd.get(`laender_${i}`) ?? "").toUpperCase().split(/[\s,;/]+/).filter((l): l is ExportLand => (EXPORT_LAENDER as readonly string[]).includes(l));
    katalog.push({ name, laender: laender.length ? laender : null, strategie: String(fd.get(`strategie_${i}`) ?? "").trim(), staffel: staffelAus(String(fd.get(`staffel_${i}`) ?? "")), festeUntergrenze: fd.get(`fest_${i}`) === "1", risiko: fd.get(`risiko_${i}`) === "1", hinweis: String(fd.get(`hinweis_${i}`) ?? "").trim() });
  });
  if (katalog.some((k) => k.staffel?.some((x) => !Number.isFinite(x.marge) || (x.bisTage !== null && !Number.isFinite(x.bisTage))))) zurueck("Staffel bitte als „Tage:Marge“ angeben, z. B. „30:10 SB, 60:8 EQ, :0“.");
  const markenRegeln: MarkenRegel[] = String(fd.get("marken") ?? "")
    .split("\n")
    .map((z) => z.trim())
    .filter(Boolean)
    .map((z) => {
      // „B0… DE Abverkauf“, „Philips i9000 FR Abverkauf“ bzw. „Marke * Regel“
      const m = /^(.+?)\s+(DE|FR|IT|ES|\*)\s+(.+)$/i.exec(z);
      return m ? { marke: m[1].trim(), land: m[2] === "*" ? null : (m[2].toUpperCase() as ExportLand), regel: m[3].trim() } : null;
    })
    .filter((x): x is MarkenRegel => !!x);
  const zahl = (k: string) => {
    const v = parseAmount(String(fd.get(k) ?? ""));
    return v === null ? undefined : v;
  };
  await bqoolEinstellungenSpeichern(s.tenantId, {
    katalog,
    markenRegeln,
    elektronikMarken: String(fd.get("elektronik") ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean),
    elektronikLaender: String(fd.get("elektronik_laender") ?? "").toUpperCase().split(/[\s,;/]+/).filter((l): l is ExportLand => (EXPORT_LAENDER as readonly string[]).includes(l)),
    maxFaktor: zahl("max_faktor"),
    costUst: zahl("cost_ust") !== undefined ? zahl("cost_ust")! / 100 : undefined,
    zusatzkosten: zahl("zusatzkosten"),
    fixGebuehr: zahl("fix"),
  });
  await bqoolAbgleichAufgabe(s.tenantId).catch(() => undefined);
  revalidatePath(PFAD);
  zurueck("Regeln gespeichert. Änderungen an Regeln bitte auch in BQool selbst eintragen – das System ändert keine BQool-Regeln.");
}

/** Freigegebenen Export per Browser-Automatik bei BQool hochladen – nur mit ausdrücklicher Bestätigung. */
export async function anBqoolAction(fd: FormData) {
  const s = await schreibend();
  const id = String(fd.get("export") ?? "");
  if (fd.get("bestaetigt") !== "1") zurueck("Bitte bestätigen, dass die Freigabe geprüft ist – erst dann ändert BQool die Preise.", `&export=${id}`);
  const { anBqoolUebertragen } = await import("@/lib/automatik/uebertragen");
  const r = await anBqoolUebertragen(s.tenantId, id);
  revalidatePath(PFAD);
  zurueck(r.text, `&export=${id}`);
}


// ---- B31.2 Täglicher BQool-Kreislauf: Freigabe, Jetzt starten, Nachkontrolle, Einstellungen (nur Inhaber) ----------

const laufZiel = (id: string | null) => (id ? `&lauf=${id}#freigabe` : "#freigabe");

/** Kreislauf jetzt starten: Ist je Land holen, Soll erzeugen, Freigabe anfragen (bzw. automatisch hochladen). */
export async function kreislaufStartenAction() {
  const s = await requireOwner();
  const { kreislaufStarten } = await import("@/lib/bqool/kreislauf");
  const r = await kreislaufStarten(s.tenantId, "knopf");
  revalidatePath(PFAD);
  zurueck(r.text, laufZiel(r.laufId));
}

/** Freigeben und hochladen – nur der Inhaber; danach Nachkontrolle in 30 Minuten. */
export async function kreislaufFreigebenAction(fd: FormData) {
  const s = await requireOwner();
  const id = String(fd.get("lauf") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) zurueck("Lauf nicht gefunden.");
  const { kreislaufFreigeben } = await import("@/lib/bqool/kreislauf");
  const r = await kreislaufFreigeben(s.tenantId, id, s.name || s.email);
  revalidatePath(PFAD);
  zurueck(r.text, laufZiel(id));
}

/** Heute nicht hochladen. */
export async function kreislaufAblehnenAction(fd: FormData) {
  const s = await requireOwner();
  const id = String(fd.get("lauf") ?? "");
  const { kreislaufAblehnen } = await import("@/lib/bqool/kreislauf");
  const ok = /^[0-9a-f-]{36}$/i.test(id) && (await kreislaufAblehnen(s.tenantId, id, s.name || s.email));
  revalidatePath(PFAD);
  zurueck(ok ? "Heute wird nichts zu BQool hochgeladen – morgen 06:00 kommt ein neuer Lauf." : "Lauf ist nicht mehr offen.", laufZiel(id));
}

/** Nachkontrolle jetzt (sonst automatisch 30 Minuten nach dem Upload). */
export async function nachkontrolleAction(fd: FormData) {
  const s = await requireOwner();
  const id = String(fd.get("lauf") ?? "");
  const { nachkontrolleAusfuehren } = await import("@/lib/bqool/kreislauf");
  const r = /^[0-9a-f-]{36}$/i.test(id) ? await nachkontrolleAusfuehren(s.tenantId, id) : { text: "Lauf nicht gefunden." };
  revalidatePath(PFAD);
  zurueck(`Nachkontrolle: ${r.text}`, laufZiel(id));
}

/**
 * Einstellungen: automatisch hochladen (nur mit bestätigtem Min-Verhalten in BQool), Min in der Datei
 * (effektiver Min bzw. Break-even als Sicherheitsnetz).
 */
export async function kreislaufEinstellungenAction(fd: FormData) {
  const s = await requireOwner();
  const minGeprueft = fd.get("min_geprueft") === "1";
  const automatisch = fd.get("automatisch") === "1";
  const minInDatei = fd.get("min_in_datei") === "sicherheitsnetz" ? "sicherheitsnetz" : "effektiv";
  const { getSettings } = await import("@/lib/settings");
  const alt = (await getSettings(s.tenantId)).bqool.kreislauf;
  await bqoolEinstellungenSpeichern(s.tenantId, { kreislauf: { minGeprueft, minGeprueftAm: minGeprueft ? (alt.minGeprueft ? alt.minGeprueftAm : new Date().toISOString()) : null, automatisch: automatisch && minGeprueft, minInDatei } });
  revalidatePath(PFAD);
  zurueck(automatisch && !minGeprueft ? "Automatisch hochladen geht erst, wenn das Min-Verhalten in BQool bestätigt ist – bleibt bei „Freigabe nötig“." : `Gespeichert: ${automatisch && minGeprueft ? "täglich automatisch hochladen (außer bei Regelwechsel oder Min unter Break-even)" : "Freigabe nötig"} · Min in der Datei: ${minInDatei === "effektiv" ? "effektiver Min" : "Break-even (Sicherheitsnetz)"}.`, "#kreislauf-einstellungen");
}
