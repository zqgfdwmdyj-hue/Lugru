// Rollen-Vorlagen und Warnungen für die Benutzerliste (B19.2). Reine Logik – getestet in tests/rollen.test.ts.
// Rechte selbst bleiben wie bisher: Rolle (Inhaber/Mitarbeiter), Bereiche, „nur ansehen“, Privat-Zugang (eigener
// Schalter, auch für Inhaber nur ausdrücklich). Die Vorlagen setzen nur diese Felder auf einen Schlag.

import type { AreaKey } from "./areas";

export type RollenVorlage = "inhaber" | "mitarbeiter" | "va" | "familie";

/** VA: Aufgaben, Amazon (Fälle, Ansprüche, Remissionen …), Service (Retouren) – kein Geld, kein B2B, kein Privat, keine Einstellungen. */
export const VA_BEREICHE: AreaKey[] = ["start", "amazon", "service"];

export const ROLLEN_LABEL: Record<RollenVorlage, string> = {
  inhaber: "Inhaber (alles)",
  mitarbeiter: "Mitarbeiter (Bereiche wählen)",
  va: "VA (Aufgaben, Fälle, Ansprüche, Retouren)",
  familie: "Nur Familie (Familienliste, Kinder-Termine, Schulbriefe)",
};

export type Mitglied = {
  userId: string;
  email: string;
  name: string | null;
  role: "owner" | "staff";
  areas: string[] | null;
  readOnly: boolean;
  privateAccess: boolean;
  privateScope: "voll" | "familie";
  lastLoginAt: Date | null;
};

/** Felder, die eine Vorlage setzt. Mitarbeiter: Bereiche bleiben (vom Inhaber kommend: keine – bitte freigeben). */
export function vorlageFelder(v: RollenVorlage, vorher: Pick<Mitglied, "role" | "areas">): { role: "owner" | "staff"; areas: string[] | null; readOnly: boolean; privateAccess?: boolean; privateScope?: "voll" | "familie" } {
  if (v === "inhaber") return { role: "owner", areas: null, readOnly: false };
  if (v === "va") return { role: "staff", areas: [...VA_BEREICHE], readOnly: false, privateAccess: false };
  if (v === "familie") return { role: "staff", areas: [], readOnly: false, privateAccess: true, privateScope: "familie" };
  return { role: "staff", areas: vorher.role === "owner" ? [] : vorher.areas, readOnly: false };
}

/** Welche Vorlage passt zum heutigen Stand? (für die Auswahl in der Liste) */
export function rolleVon(m: Pick<Mitglied, "role" | "areas" | "privateAccess" | "privateScope">): RollenVorlage {
  if (m.role === "owner") return "inhaber";
  if (m.areas && m.areas.length === 0 && m.privateAccess && m.privateScope === "familie") return "familie";
  if (m.areas && m.areas.length === VA_BEREICHE.length && VA_BEREICHE.every((a) => m.areas!.includes(a)) && !m.privateAccess) return "va";
  return "mitarbeiter";
}

export type Warnung = { userId: string; stufe: "rot" | "gelb"; text: string };

const TAG = 86_400_000;

/**
 * Warnungen je Konto: Privat „voll“ bei Nicht-Inhaber (rot), weiteres Inhaber-Konto (sieht alles), seit Langem bzw.
 * nie angemeldet, Mitarbeiter mit allen Bereichen (inkl. Geld/B2B), Konto der VA ohne VA-Rolle.
 */
export function zugriffsWarnungen(ms: Mitglied[], ich: string, o: { jetzt?: Date; vaLogin?: string | null } = {}): Warnung[] {
  const jetzt = o.jetzt ?? new Date();
  const out: Warnung[] = [];
  for (const m of ms) {
    if (m.userId === ich) continue;
    const wer = m.name ?? m.email;
    if (m.role === "staff" && m.privateAccess && m.privateScope === "voll" && !m.readOnly) out.push({ userId: m.userId, stufe: "rot", text: `${wer}: Privat „voll“ bei Nicht-Inhaber – sieht Paar, Therapie, Tagebuch. Auf „kein Zugang“ oder „nur Familie“ stellen.` });
    if (m.role === "owner") {
      const alt = !m.lastLoginAt ? "nie angemeldet" : jetzt.getTime() - m.lastLoginAt.getTime() > 30 * TAG ? `seit ${Math.floor((jetzt.getTime() - m.lastLoginAt.getTime()) / TAG)} Tagen nicht angemeldet` : null;
      out.push({ userId: m.userId, stufe: alt ? "rot" : "gelb", text: `${wer}: weiteres Inhaber-Konto – sieht alle Geschäftsbereiche (Geld, B2B, Einstellungen)${alt ? `, ${alt} – entfernen?` : ". Für Familie Rolle „Nur Familie“, für die VA „VA“."}` });
    }
    if (m.role === "staff" && m.areas === null && !m.readOnly) out.push({ userId: m.userId, stufe: "gelb", text: `${wer}: Mitarbeiter mit allen Bereichen – sieht auch Geld und B2B.` });
    if (o.vaLogin && m.email.toLowerCase() === o.vaLogin.toLowerCase() && rolleVon(m) !== "va") out.push({ userId: m.userId, stufe: "rot", text: `${wer}: Konto der VA ohne Rolle „VA“ – bitte auf „VA“ stellen (kein Privat, kein Geld, keine Einstellungen).` });
  }
  return out;
}

export const PRIVAT_LABEL = (m: Pick<Mitglied, "privateAccess" | "privateScope" | "readOnly">) => (m.readOnly ? "gesperrt (nur ansehen)" : !m.privateAccess ? "kein" : m.privateScope === "familie" ? "nur Familie" : "voll");
