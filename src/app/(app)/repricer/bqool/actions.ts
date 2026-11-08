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
  // B31.6: Min in der Datei immer ≥ effektiver Min (darunter nur über Liquidation) – keine Wahl mehr.
  const minInDatei = "effektiv" as const;
  const { getSettings } = await import("@/lib/settings");
  const alt = (await getSettings(s.tenantId)).bqool.kreislauf;
  await bqoolEinstellungenSpeichern(s.tenantId, { kreislauf: { minGeprueft, minGeprueftAm: minGeprueft ? (alt.minGeprueft ? alt.minGeprueftAm : new Date().toISOString()) : null, automatisch: automatisch && minGeprueft, minInDatei } });
  revalidatePath(PFAD);
  zurueck(automatisch && !minGeprueft ? "Automatisch hochladen geht erst, wenn das Min-Verhalten in BQool bestätigt ist – bleibt bei „Freigabe nötig“." : `Gespeichert: ${automatisch && minGeprueft ? "täglich automatisch hochladen (außer bei Regelwechsel oder Min unter Break-even)" : "Freigabe nötig"} · Min in der Datei: mindestens effektiver Min (darunter nur mit Liquidation).`, "#kreislauf-einstellungen");
}

// ---- B31.6 Liquidation wegen Min unter Marge ---------------------------------------------------------------------

const LIQ = "#liquidation";
const landSku = (fd: FormData) => {
  const land = String(fd.get("land") ?? "");
  const sku = String(fd.get("sku") ?? "").trim();
  if (!(EXPORT_LAENDER as readonly string[]).includes(land) || !sku) zurueck("Land und SKU fehlen.", LIQ);
  return { land: land as ExportLand, sku };
};

/** Test vor dem ersten Regelwechsel: Export nur mit dieser einen SKU (Liquidation + fester Min). */
export async function liquidationTestExportAction(fd: FormData) {
  const s = await requireOwner();
  const wahl = String(fd.get("wahl") ?? "");
  const [land, sku] = wahl.split("|");
  if (!(EXPORT_LAENDER as readonly string[]).includes(land) || !sku) zurueck("Bitte eine SKU für den Test wählen.", LIQ);
  const r = await bqoolExportErzeugen(s.tenantId, s.userId, { laender: [land as ExportLand], nurAenderungen: true, nurSkus: [wahl] });
  revalidatePath(PFAD);
  redirect(`${PFAD}?export=${r.id}&meldung=${encodeURIComponent(`Test-Export: nur ${sku} (${land}) mit Liquidation. Hochladen (unten „An BQool übertragen“ oder ZIP), nach dem nächsten BQool-Lauf prüft das System, ob Min und Regel stehen bleiben.`)}${LIQ}`);
}

export async function liquidationTestAction(fd: FormData) {
  const s = await requireOwner();
  const { liquidationTestBestaetigen } = await import("@/lib/bqool/liquidation");
  const bestanden = fd.get("bestanden") === "1";
  await liquidationTestBestaetigen(s.tenantId, bestanden, { land: String(fd.get("land") ?? "") || null, sku: String(fd.get("sku") ?? "") || null });
  revalidatePath(PFAD);
  zurueck(bestanden ? "Liquidation-Test als bestanden bestätigt – Regelwechsel kommen ab jetzt in die Datei (Freigabe bleibt nötig)." : "Liquidation-Test zurückgesetzt – Regelwechsel warten wieder auf den Test.", LIQ);
}

/** Rückkehr-Vorschlag: zurück auf die ursprüngliche Regel bzw. auf Liquidation bleiben. */
export async function rueckkehrAction(fd: FormData) {
  const s = await requireOwner();
  const { land, sku } = landSku(fd);
  const { rueckkehrAblehnen, rueckkehrFreigeben } = await import("@/lib/bqool/liquidation");
  if (fd.get("entscheidung") === "bleiben") {
    await rueckkehrAblehnen(s.tenantId, land, sku);
    revalidatePath(PFAD);
    zurueck(`${sku} (${land}) bleibt auf Liquidation.`, LIQ);
  }
  const regel = await rueckkehrFreigeben(s.tenantId, land, sku);
  revalidatePath(PFAD);
  zurueck(regel ? `${sku} (${land}): zurück auf „${regel}“ – kommt mit der nächsten Datei (Freigabe des Uploads bleibt nötig).` : "Keine ursprüngliche Regel gemerkt.", LIQ);
}

/** „Mindest-Verlust akzeptiert bis x €“ je Stück (leer = nur bis Break-even). */
export async function verlustFreigabeAction(fd: FormData) {
  const s = await requireOwner();
  const { land, sku } = landSku(fd);
  const roh = String(fd.get("verlust_bis") ?? "").trim();
  const wert = roh ? parseAmount(roh) : null;
  if (roh && (wert === null || wert < 0)) zurueck("Betrag je Stück angeben (z. B. 3,50).", LIQ);
  const { verlustFreigabeSetzen } = await import("@/lib/bqool/liquidation");
  await verlustFreigabeSetzen(s.tenantId, land, sku, wert);
  revalidatePath(PFAD);
  zurueck(wert ? `${sku} (${land}): Abverkauf mit Verlust bis ${roh} € je Stück freigegeben.` : `${sku} (${land}): Min nur bis Break-even.`, LIQ);
}

/** Liquidation-Stand jetzt prüfen (sonst täglich): aktiv im Ist, Test, Rückkehr-Vorschläge. */
export async function liquidationPruefenAction() {
  const s = await schreibend();
  const { liquidationenPflegen } = await import("@/lib/bqool/liquidation");
  const r = await liquidationenPflegen(s.tenantId);
  revalidatePath(PFAD);
  zurueck(`Liquidation geprüft: ${r.aktiviert} neu aktiv, ${r.vorgeschlagen} neue Rückkehr-Vorschläge, ${r.offen} offen${r.testBestanden ? " · Test bestanden" : ""}.`, LIQ);
}

// ---- B31.6a/b, B31.7, B31.8: Regel-Leiter, Ablauf, Zustand, Schnelldreher ------------------------------------------------
const LEITER = "#leiter";

/** Vorschlag der Regel-Leiter entscheiden (Freigeben / Ablehnen / Später; Schnelldreher-Ende: Verlängern / Abverkauf / Min). */
export async function leiterVorschlagAction(fd: FormData) {
  const s = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const e = String(fd.get("entscheidung") ?? "freigeben") as import("@/lib/bqool/leiter").Entscheidung;
  if (!/^[0-9a-f-]{36}$/i.test(id)) zurueck("Vorschlag fehlt.", LEITER);
  const { vorschlagEntscheiden } = await import("@/lib/bqool/leiter");
  const text = await vorschlagEntscheiden(s.tenantId, id, e, s.userId);
  revalidatePath(PFAD);
  revalidatePath("/repricer");
  zurueck(text, LEITER);
}

/** B31.6a: Liquidation läuft ab – verlängern, zurück auf Stufe 2, dauerhaft; „bis“ von Hand. */
export async function ablaufAction(fd: FormData) {
  const s = await requireOwner();
  const land = String(fd.get("land") ?? "");
  const sku = String(fd.get("sku") ?? "").trim();
  const wahl = String(fd.get("wahl") ?? "") as "verlaengern" | "zurueck" | "dauerhaft" | "bis";
  if (!(EXPORT_LAENDER as readonly string[]).includes(land) || !sku || !["verlaengern", "zurueck", "dauerhaft", "bis"].includes(wahl)) zurueck("Angaben fehlen.", LIQ);
  const { ablaufEntscheiden } = await import("@/lib/bqool/liquidation");
  const r = await ablaufEntscheiden(s.tenantId, land, sku, wahl, String(fd.get("bis") ?? "") || null);
  revalidatePath(PFAD);
  zurueck(r ? `${sku} (${land}): ${r}.` : "Keine Liquidation gefunden.", LIQ);
}

/** B31.7: Zustand von Hand für mehrere SKUs (Repricer-Seite, Mehrfachauswahl). */
export async function zustandAction(fd: FormData) {
  const s = await requireOwner();
  const { ZUSTAENDE } = await import("@/lib/bqool/leiter-logic");
  const z = String(fd.get("zustand") ?? "");
  const skus = [...new Set(fd.getAll("wahl").map((w) => String(w).split("|").slice(1).join("|")).filter(Boolean))];
  const ziel = `/repricer?bq=alle${fd.get("zurueck_q") ? `&q=${encodeURIComponent(String(fd.get("zurueck_q")))}` : ""}#bqool-liste`;
  if (!skus.length || (z !== "auto" && !(ZUSTAENDE as string[]).includes(z))) redirect(`${ziel.replace("#", `&meldung=${encodeURIComponent("Bitte SKUs und Zustand wählen.")}#`)}`);
  const { zustandSetzen } = await import("@/lib/bqool/leiter");
  await zustandSetzen(s.tenantId, skus, z as never, s.userId);
  revalidatePath("/repricer");
  revalidatePath(PFAD);
  redirect(ziel.replace("#", `&meldung=${encodeURIComponent(`Zustand ${z === "auto" ? "wieder automatisch" : `„${z}“`} für ${skus.length} SKU${skus.length === 1 ? "" : "s"} – Zielpreis und Min rechnen sich neu.`)}#`));
}

/** B31.8: Schnelldreher von Hand setzen/entfernen (Mehrfachauswahl). */
export async function schnelldreherAction(fd: FormData) {
  const s = await requireOwner();
  const an = fd.get("an") === "1";
  const eintraege = [...new Set(fd.getAll("wahl").map(String))].map((w) => ({ land: w.split("|")[0], sku: w.split("|").slice(1).join("|") })).filter((x) => (EXPORT_LAENDER as readonly string[]).includes(x.land) && x.sku);
  const ziel = `/repricer?bq=alle${fd.get("zurueck_q") ? `&q=${encodeURIComponent(String(fd.get("zurueck_q")))}` : ""}`;
  if (!eintraege.length) redirect(`${ziel}&meldung=${encodeURIComponent("Bitte SKUs wählen.")}#bqool-liste`);
  const { schnelldreherSetzen } = await import("@/lib/bqool/leiter");
  await schnelldreherSetzen(s.tenantId, eintraege, an);
  revalidatePath("/repricer");
  revalidatePath(PFAD);
  redirect(`${ziel}&meldung=${encodeURIComponent(`${eintraege.length} SKU${eintraege.length === 1 ? "" : "s"}: Schnelldreher ${an ? "gesetzt (Boden Break-even + 7 %, kein Abverkauf)" : "entfernt"}.`)}#bqool-liste`);
}

/** Einstellungen → Repricer → Leiter: Schwellen, Reihenfolge, Liquidation-Dauer, Schnelldreher, Zustand. */
export async function leiterEinstellungenAction(fd: FormData) {
  const s = await requireOwner();
  const { getSettings } = await import("@/lib/settings");
  const alt = (await getSettings(s.tenantId)).bqool.leiter;
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
    schnell: { ...alt.schnell, verkaeufe30: zahl("schnell_verkaeufe", alt.schnell.verkaeufe30), margeBoden: zahl("schnell_boden", alt.schnell.margeBoden), ohneBuyboxTage: zahl("schnell_ohne_bb", alt.schnell.ohneBuyboxTage), regel: String(fd.get("schnell_regel") ?? "").trim() || null },
    zustand: { ...alt.zustand, faktoren, mindestmarge: zahl("zustand_marge", alt.zustand.mindestmarge) },
  };
  await bqoolEinstellungenSpeichern(s.tenantId, { leiter });
  revalidatePath(PFAD);
  zurueck("Leiter-Einstellungen gespeichert – gelten ab dem nächsten Lauf (oder „Liquidation jetzt prüfen“).", "#leiter-einstellungen");
}
