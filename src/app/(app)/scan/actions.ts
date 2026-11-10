"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import type { scanPruefen } from "@/lib/mobil/service";
import { preisAusText } from "@/lib/scan/logic";
import { aktionSetzen, belegZumScan, offeneNachpruefen, offlineMelden, ScanFehler, scanAusfuehren, type Aktion } from "@/lib/scan/service";

export type ScanErgebnis = Awaited<ReturnType<typeof scanPruefen>>;
export type ScanState =
  | { ok: true; id: string; code: string; preis: number; modus: "laden" | "online"; shop: string | null; r: ScanErgebnis }
  | { ok: false; fehler: string; id?: string; code?: string; preis?: number }
  | null;

const zahl = (v: FormDataEntryValue | null) => preisAusText(typeof v === "string" ? v : null);

/** Scan prüfen (Deal-Ampel wie scan_pruefen) und unter „Heute gescannt“ speichern. */
export async function scanAction(_prev: ScanState, fd: FormData): Promise<ScanState> {
  const s = await requireSession();
  const code = String(fd.get("code") ?? "").trim();
  const preis = zahl(fd.get("preis"));
  const modus = fd.get("modus") === "online" ? "online" : "laden";
  const shop = String(fd.get("shop") ?? "").trim() || null;
  if (!code) return { ok: false, fehler: "Bitte EAN scannen oder eingeben." };
  if (!preis && modus !== "online") return { ok: false, fehler: "Bitte den Preis eingeben.", code };
  try {
    const x = await scanAusfuehren(s, {
      code,
      preis,
      modus,
      shop,
      netto: fd.get("netto") === "on" || fd.get("netto") === "1",
      rueckverguetung: zahl(fd.get("rueckverguetung")),
      menge: Number(fd.get("menge")) || null,
    });
    revalidatePath("/scan");
    if (!x.r) return { ok: false, fehler: `Prüfung fehlgeschlagen: ${x.fehler} – gespeichert, wird nachgeprüft.`, id: x.id, code, preis: preis ?? undefined };
    return { ok: true, id: x.id, code, preis: x.preis, modus, shop, r: x.r };
  } catch (e) {
    return { ok: false, fehler: e instanceof ScanFehler || e instanceof Error ? e.message : "Prüfung fehlgeschlagen.", code, preis: preis ?? undefined };
  }
}

/** Aktion je Scan (Einkaufsliste, Deal, Verwerfen, Kauf vorbereiten, Gekauft). */
export async function aktionAction(id: string, aktion: Aktion, o: { menge?: number | null; preis?: string | null; ort?: string | null } = {}) {
  const s = await requireSession();
  const r = await aktionSetzen(s, id, aktion, { menge: o.menge ?? null, preis: preisAusText(o.preis ?? null), ort: o.ort ?? null });
  revalidatePath("/scan");
  return r;
}

/** Foto zum Scan: Preisschild (Medienablage) oder Kassenbon (Rechnungsstation). */
export async function belegAction(fd: FormData): Promise<{ ok: boolean; text: string }> {
  const s = await requireSession();
  const id = String(fd.get("id") ?? "");
  const art = fd.get("art") === "kassenbon" ? "kassenbon" : "preisschild";
  const f = fd.get("datei");
  if (!(f instanceof File) || !f.size) return { ok: false, text: "Kein Foto." };
  const r = await belegZumScan(s, id, art, Buffer.from(await f.arrayBuffer()), f.type || "image/jpeg");
  revalidatePath("/scan");
  return r;
}

export type OfflineScan = { code: string; preis: string; netto: boolean; rueckverguetung: string; menge: string; modus: "laden" | "online"; shop: string; zeit: number };

/**
 * Offline gemerkte Scans nachreichen (Netz wieder da): prüfen, speichern (offline = true, Zeitpunkt vom Handy) und je
 * Scan ein Push mit dem Ergebnis. Danach offene Scans mit Fehler der letzten 24 Std. erneut versuchen.
 */
export async function nachreichenAction(liste: OfflineScan[]): Promise<{ geprueft: number; offen: number; fehler: string[] }> {
  const s = await requireSession();
  let geprueft = 0;
  let offen = 0;
  const fehler: string[] = [];
  for (const o of liste.slice(0, 30)) {
    try {
      const zeit = Number(o.zeit);
      const x = await scanAusfuehren(s, {
        code: String(o.code ?? ""),
        preis: preisAusText(o.preis),
        netto: Boolean(o.netto),
        rueckverguetung: preisAusText(o.rueckverguetung),
        menge: Number(o.menge) || null,
        modus: o.modus === "online" ? "online" : "laden",
        shop: o.shop || null,
        offline: true,
        gescanntAm: zeit > 0 && zeit <= Date.now() + 60_000 && zeit > Date.now() - 7 * 86_400_000 ? new Date(zeit) : new Date(),
      });
      await offlineMelden(s, x.id, x.r ? { ampel: x.r.ampel, vorlesen: x.r.vorlesen, titel: x.r.titel, asin: x.r.asin } : null, x.fehler);
      if (x.r) geprueft++;
      else offen++;
    } catch (e) {
      fehler.push(`${String(o.code).slice(0, 40)}: ${e instanceof Error ? e.message : "Fehler"}`);
    }
  }
  geprueft += await offeneNachpruefen(s).catch(() => 0);
  revalidatePath("/scan");
  return { geprueft, offen, fehler };
}
