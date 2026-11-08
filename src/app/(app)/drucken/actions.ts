"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { lesbarerFehler } from "@/lib/fehler-text";
import { VORLAGEN, type VorlageId } from "@/lib/druck/logic";

// Drucken aus dem Seller-System: Auftrag in die Warteschlange (der Druckagent im Lager holt ihn ab).

const zurueckZu = (pfad: string, text: string): never => {
  const p = pfad.startsWith("/") && !pfad.startsWith("//") ? pfad : "/drucken";
  const [ohne, anker] = p.split("#");
  redirect(`${ohne}${ohne.includes("?") ? "&" : "?"}druck=${encodeURIComponent(text)}${anker ? `#${anker}` : ""}`);
};

/** Vorlage drucken: Felder e_<name>, anzahl, zurueck (Seite). */
export async function druckenAction(fd: FormData) {
  const s = await requireSession();
  const vorlage = String(fd.get("vorlage") ?? "") as VorlageId;
  const zurueck = String(fd.get("zurueck") ?? "/drucken");
  if (!VORLAGEN[vorlage]) zurueckZu(zurueck, "Vorlage unbekannt.");
  const eingabe: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("e_") && typeof v === "string") eingabe[k.slice(2)] = v.trim().slice(0, 200);
  const anzahl = Math.min(500, Math.max(1, Number(fd.get("anzahl")) || 1));
  let text: string;
  try {
    const { auftragAnlegen } = await import("@/lib/druck/service");
    await auftragAnlegen(s, { vorlage, eingabe, anzahl, seite: zurueck.split("?")[0] });
    text = `${anzahl}× ${VORLAGEN[vorlage].text} an ${VORLAGEN[vorlage].drucker} gesendet.`;
  } catch (e) {
    text = `Nicht gedruckt – ${lesbarerFehler(e)}`;
  }
  revalidatePath("/drucken");
  zurueckZu(zurueck, text);
}

/** FNSKU-Etiketten für mehrere SKUs (Etiketten-Seite: skus=SKU:3,SKU2:1). */
export async function fnskuSendenAction(fd: FormData) {
  const s = await requireSession();
  const zurueck = String(fd.get("zurueck") ?? "/drucken");
  const zustand = String(fd.get("zustand") ?? "Neu").slice(0, 30);
  const { fnskuDrucken } = await import("@/lib/druck/sku");
  const texte: string[] = [];
  for (const teil of String(fd.get("skus") ?? "").split(",")) {
    const i = teil.lastIndexOf(":");
    const sku = decodeURIComponent(i > 0 ? teil.slice(0, i) : teil).trim();
    const n = Math.min(500, Math.max(1, Number(i > 0 ? teil.slice(i + 1) : 1) || 1));
    if (!sku) continue;
    try {
      texte.push((await fnskuDrucken(s, sku, n, "/etikett", { zustand })).text);
    } catch (e) {
      texte.push(`${sku}: ${lesbarerFehler(e)}`);
    }
  }
  revalidatePath("/drucken");
  zurueckZu(zurueck, texte.join(" ") || "Keine SKU angegeben.");
}

export async function erneutAction(fd: FormData) {
  const s = await requireSession();
  const { erneutDrucken } = await import("@/lib/druck/service");
  const id = await erneutDrucken(s, String(fd.get("id") ?? ""));
  revalidatePath("/drucken");
  zurueckZu(String(fd.get("zurueck") ?? "/drucken"), id ? "Erneut in die Warteschlange gestellt." : "Nicht möglich.");
}

export async function abbrechenAction(fd: FormData) {
  const s = await requireSession();
  const { auftragAbbrechen } = await import("@/lib/druck/service");
  await auftragAbbrechen(s, String(fd.get("id") ?? ""));
  revalidatePath("/drucken");
  zurueckZu(String(fd.get("zurueck") ?? "/drucken"), "Auftrag abgebrochen.");
}

/** Warteschlange jetzt prüfen (sonst alle 2 Min. im Hintergrund): Push > 15 Min., abgelaufen nach 7 Tagen. Nur Inhaber. */
export async function pruefenAction() {
  const s = await requireSession();
  if (s.role !== "owner" || s.readOnly) zurueckZu("/drucken", "Nur für Inhaber.");
  const { druckPruefen } = await import("@/lib/druck/service");
  const r = await druckPruefen(s.tenantId);
  revalidatePath("/drucken");
  zurueckZu("/drucken", `Geprüft: ${r.push} Push gesendet, ${r.abgelaufen} abgelaufen.`);
}

/** Gespeichertes Label-PDF (DHL, Internetmarke) an den QL-1100 im Lager – Knopf neben „Label drucken (PDF)“. */
export async function dateiImLagerDruckenAction(fileId: string, seite: string): Promise<{ ok: boolean; text: string }> {
  const s = await requireSession();
  const { darfDrucken: darf } = await import("@/lib/druck/logic");
  if (!darf(s, "dhl")) return { ok: false, text: "Keine Berechtigung zum Drucken." };
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return { ok: false, text: "Datei unbekannt." };
  const { and, eq } = await import("drizzle-orm");
  const { db, schema } = await import("@/db");
  const [f] = await db.select({ name: schema.files.name, mimeType: schema.files.mimeType, data: schema.files.data }).from(schema.files).where(and(eq(schema.files.id, fileId), eq(schema.files.tenantId, s.tenantId)));
  if (!f) return { ok: false, text: "Datei nicht gefunden." };
  if (!f.mimeType.includes("pdf")) return { ok: false, text: "Nur PDF-Labels können an den Drucker gehen." };
  try {
    const { pdfHochladen } = await import("@/lib/druck/dateien");
    const r = await pdfHochladen(s, f.name, new Uint8Array(f.data), { drucken: true, seite: seite.startsWith("/") ? seite.slice(0, 200) : "/drucken" });
    revalidatePath("/drucken");
    return { ok: Boolean(r.auftragId), text: r.text };
  } catch (e) {
    return { ok: false, text: `Nicht gedruckt – ${lesbarerFehler(e)}` };
  }
}

/** Seller-Central-PDF hochladen (Kartonlabels, FNSKU-Bogen, 102-mm-Label) – erkennen, zuordnen, optional drucken. */
export async function pdfAction(fd: FormData) {
  const s = await requireSession();
  if (s.readOnly) zurueckZu("/drucken/datei", "Nur-ansehen-Konto.");
  const f = fd.get("datei");
  if (!(f instanceof File) || !f.size) zurueckZu("/drucken/datei", "Bitte eine PDF-Datei wählen.");
  const datei = f as File;
  if (datei.size > 25 * 1024 * 1024) zurueckZu("/drucken/datei", "Größer als 25 MB.");
  const raster = String(fd.get("raster") ?? "");
  let text: string;
  try {
    const { pdfHochladen } = await import("@/lib/druck/dateien");
    const r = await pdfHochladen(s, datei.name, new Uint8Array(await datei.arrayBuffer()), { drucken: fd.get("drucken") === "1", anzahl: Number(fd.get("anzahl")) || 1, raster: raster === "27" || raster === "40" ? raster : null, seite: "/drucken/datei" });
    text = r.text;
  } catch (e) {
    text = `PDF nicht verarbeitet – ${lesbarerFehler(e)}`;
  }
  revalidatePath("/drucken");
  revalidatePath("/drucken/datei");
  zurueckZu("/drucken/datei", text);
}
