"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireArea, requireOwner } from "@/lib/auth/session";
import { lesbarerFehler } from "@/lib/fehler-text";

const PFAD = "/repricer/listing-check";
const zurueck = (m: string): never => redirect(`${PFAD}?meldung=${encodeURIComponent(m)}`);

/** B32: Befund freigeben / ablehnen / später – Freigaben wirken erst mit der nächsten ProfitGuard-Datei. */
export async function befundAction(fd: FormData) {
  const s = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const e = String(fd.get("entscheidung") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["freigeben", "ablehnen", "spaeter"].includes(e)) zurueck("Angaben fehlen.");
  const { befundEntscheiden } = await import("@/lib/repricing/listing-check");
  const text = await befundEntscheiden(s.tenantId, id, e as "freigeben" | "ablehnen" | "spaeter", s.userId);
  revalidatePath(PFAD);
  zurueck(text);
}

/** Listing-Check jetzt laufen lassen (sonst täglich im Hintergrund). */
export async function checkJetztAction() {
  const s = await requireArea("buchhaltung");
  if (s.readOnly) zurueck("Nur ansehen – gesperrt.");
  let text = "";
  try {
    const { listingCheck } = await import("@/lib/repricing/listing-check");
    const r = await listingCheck(s.tenantId);
    text = `Listing-Check: ${r.geprueft} SKUs geprüft (A ${r.stufeA} / B ${r.stufeB} / C ${r.stufeC}), ${r.neu} neue Befunde, ${r.offen} offen${r.unvollstaendig ? ` · Check unvollständig (${r.unvollstaendig} ohne frische Keepa-Daten)` : ""}${r.istAlt ? " · ProfitGuard-Stand alt" : ""}.`;
  } catch (e) {
    text = `Listing-Check fehlgeschlagen – ${lesbarerFehler(e)}`;
  }
  revalidatePath(PFAD);
  zurueck(text);
}

/** B32.1: Schwellen (Tage, Prozent, Euro) in Einstellungen → Listing-Check ändern; leer = Standard. */
export async function schwellenAction(fd: FormData) {
  const s = await requireOwner();
  const { SCHWELLEN_FELDER } = await import("@/lib/repricing/listing-check-logic");
  const werte: Record<string, number> = {};
  for (const f of SCHWELLEN_FELDER) {
    const roh = String(fd.get(f.key) ?? "").trim().replace(",", ".");
    if (!roh) continue;
    const n = Number(roh);
    if (!Number.isFinite(n) || n < 0) zurueck(`„${f.text}“: bitte eine Zahl ≥ 0 eingeben.`);
    werte[f.key] = n;
  }
  const { repricingEinstellungenSpeichern } = await import("@/lib/repricing/soll-service");
  await repricingEinstellungenSpeichern(s.tenantId, { listingCheckSchwellen: werte });
  revalidatePath(PFAD);
  zurueck("Schwellen gespeichert – gelten ab dem nächsten Lauf.");
}
