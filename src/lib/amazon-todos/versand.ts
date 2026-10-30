// Amazon-ToDos mit dem Versand abgleichen (B10): Bestell-Mails („Verkauft, jetzt liefern“ in allen EU-Sprachen)
// sind keine ToDos – sie folgen dem Auftrag. Versendete Aufträge → Mail archivieren; echte Probleme (Versandfrist
// abgelaufen, Mail zu einer Bestellung, die im Tool fehlt) als je EIN gebündeltes ToDo. Reine Logik, testbar.

/** „Verkauft, jetzt liefern“ in den EU-Sprachen (Betreff der Amazon-Bestell-Mail an den Händler). */
export const BESTELL_MAIL_RE =
  /verkauft[,!.]?\s*jetzt\s*(liefern|versenden)|sold[,!.]?\s*ship\s*now|venduto[,!.]?\s*spedisci(\s*ora)?|vendido[,!.]?\s*(env[ií]a|env[ií]e|env[ií]alo)(\s*(ahora|ya))?|vendu[,!.]?\s*exp[ée]di(ez|er)|verkocht[,!.]?\s*(nu\s*)?(verzenden|leveren)|sprzedano[,!.]?\s*wy[sś]lij|s[åa]ld[,!.]?\s*skicka/i;

/** FBA-Info „Amazon hat Ihre Artikel versandt“ – nur Info, sofort archivieren. */
export const FBA_VERSAND_RE =
  /amazon hat ihre artikel versandt|amazon has shipped your (item|order)|amazon a exp[ée]di[ée] vos articles|amazon ha spedito i tuoi articoli|amazon ha enviado tus art[ií]culos|amazon heeft (je|uw) artikel(en)? verzonden|amazon wys[łl]a[łl]/i;

export const istBestellMail = (subject: string | null | undefined) => BESTELL_MAIL_RE.test(subject ?? "");
export const istFbaVersandMail = (subject: string | null | undefined) => FBA_VERSAND_RE.test(subject ?? "");

/** Amazon-Bestellnummern (Format 123-1234567-1234567). */
export function bestellnummernAus(text: string): string[] {
  return [...new Set(text.match(/\b\d{3}-\d{7}-\d{7}\b/g) ?? [])].slice(0, 50);
}

export type AuftragKurz = { id: string; externalId: string; status: string; fulfillment: string; shipBy: string | null; orderDate: string };

/** Versendet (Label, Sendungsnummer, Prep Center, von Hand) oder storniert/zurück – braucht keine Handlung mehr. */
export const ERLEDIGT_STATUS = new Set(["label_created", "shipped", "delivered", "cancelled", "returned"]);

/** Versandfrist: „ship by“ aus dem Auftrag, sonst Bestelldatum + 2 Tage. */
export function versandfrist(a: Pick<AuftragKurz, "shipBy" | "orderDate">): string {
  return a.shipBy ?? new Date(Date.parse(a.orderDate) + 2 * 86_400_000).toISOString();
}

export type BestellMail = { emailId: string; subject: string; text: string; receivedAt: string };

export type Abgleich = {
  /** Mails, deren Auftrag versendet/storniert ist, und FBA-Info-Mails → archivieren. */
  archivieren: string[];
  /** Bestellnummern aus Mails, zu denen es (noch) keinen Auftrag im Tool gibt – nach der Wartezeit. */
  fehlend: { bestellnummer: string; emailId: string; receivedAt: string; subject: string }[];
  /** Aufträge aus Mails, die noch offen sind (zur Info). */
  offen: string[];
};

/**
 * Bestell-Mails gegen die Aufträge prüfen. Fehlende Aufträge erst nach `warteStunden` melden (der Auftragsimport
 * läuft zeitversetzt). Mails ohne Bestellnummer bleiben, wie sie sind.
 */
export function bestellMailsAbgleichen(mails: BestellMail[], auftraege: AuftragKurz[], now: number, warteStunden = 6): Abgleich {
  const byNr = new Map(auftraege.map((a) => [a.externalId, a]));
  const out: Abgleich = { archivieren: [], fehlend: [], offen: [] };
  for (const m of mails) {
    if (istFbaVersandMail(m.subject)) {
      out.archivieren.push(m.emailId);
      continue;
    }
    const nrn = bestellnummernAus(`${m.subject}\n${m.text}`);
    if (!nrn.length) continue;
    const gefunden = nrn.map((n) => byNr.get(n));
    if (gefunden.every((a) => a && ERLEDIGT_STATUS.has(a.status))) {
      out.archivieren.push(m.emailId);
      continue;
    }
    for (const [i, a] of gefunden.entries()) {
      if (a && !ERLEDIGT_STATUS.has(a.status)) out.offen.push(a.externalId);
      else if (!a && now - Date.parse(m.receivedAt) >= warteStunden * 3_600_000) out.fehlend.push({ bestellnummer: nrn[i], emailId: m.emailId, receivedAt: m.receivedAt, subject: m.subject });
    }
  }
  const seen = new Set<string>();
  out.fehlend = out.fehlend.filter((f) => (seen.has(f.bestellnummer) ? false : (seen.add(f.bestellnummer), true)));
  out.offen = [...new Set(out.offen)];
  return out;
}

/** FBM-Aufträge, deren Versandfrist abgelaufen ist und die noch nicht versendet sind – älteste Frist zuerst. */
export function ueberfaellig(auftraege: AuftragKurz[], now: number): (AuftragKurz & { frist: string })[] {
  return auftraege
    .filter((a) => a.fulfillment === "FBM" && a.status === "open")
    .map((a) => ({ ...a, frist: versandfrist(a) }))
    .filter((a) => Date.parse(a.frist) < now)
    .sort((x, y) => x.frist.localeCompare(y.frist));
}

export type AltToDo = { id: string; subject: string | null; category: string; bodyShort: string | null };

/**
 * Altbestand: offene ToDos, die eigentlich Bestell- oder FBA-Versand-Mails sind, schließen – mit Grund.
 * Ist der Auftrag noch offen oder fehlt er, steht er im Sammel-ToDo; das einzelne ToDo wird trotzdem geschlossen.
 */
export function altToDosSchliessen(todos: AltToDo[], auftraege: AuftragKurz[]): { id: string; grund: string }[] {
  const byNr = new Map(auftraege.map((a) => [a.externalId, a]));
  const out: { id: string; grund: string }[] = [];
  for (const t of todos) {
    if (istFbaVersandMail(t.subject)) {
      out.push({ id: t.id, grund: "automatisch: FBA-Versandinfo, keine Handlung nötig" });
      continue;
    }
    if (!istBestellMail(t.subject)) continue;
    const nrn = bestellnummernAus(`${t.subject ?? ""}\n${t.bodyShort ?? ""}`);
    const a = nrn.map((n) => byNr.get(n)).filter((x): x is AuftragKurz => Boolean(x));
    if (nrn.length && a.length === nrn.length && a.every((x) => ERLEDIGT_STATUS.has(x.status))) out.push({ id: t.id, grund: `automatisch: Auftrag ${nrn.join(", ")} versendet` });
    else if (a.length) out.push({ id: t.id, grund: `automatisch: Bestell-Mail folgt dem Auftrag ${nrn.join(", ")} (noch offen – steht im Sammel-ToDo, falls die Versandfrist abläuft)` });
    else if (nrn.length) out.push({ id: t.id, grund: `automatisch: Bestell-Mail – Auftrag ${nrn.join(", ")} fehlt im Tool (steht im Sammel-ToDo „Import-Lücke“)` });
    else out.push({ id: t.id, grund: "automatisch: Bestell-Mail ohne Bestellnummer – keine Handlung als ToDo" });
  }
  return out;
}

/** Kategorien, die nach Compliance/Konto kommen (Sortierung) und in der Liste standardmäßig ausgeblendet sind. */
export const LOGISTIK_KATEGORIEN = ["logistik_info"] as const;
/** Sammel-ToDos aus dem Versand-Abgleich. */
export const SAMMEL = {
  ueberfaellig: { key: "sammel:fbm-ueberfaellig", category: "versand_ueberfaellig" },
  fehlt: { key: "sammel:bestellung-fehlt", category: "import_luecke" },
} as const;

/** Sortier-Gewicht: Compliance/Konto/Rest 0, Versand-Sammel-ToDos 1, Logistik-Infos 2. */
export function kategorieGewicht(category: string): number {
  if ((LOGISTIK_KATEGORIEN as readonly string[]).includes(category)) return 2;
  if (category === SAMMEL.ueberfaellig.category || category === SAMMEL.fehlt.category) return 1;
  return 0;
}

/** Sammel-ToDo wieder öffnen? Nur wenn neue Bestellnummern dazugekommen sind (sonst bleibt „erledigt/ignoriert“). */
export function sammelWiederOeffnen(alt: string[], neu: string[]): boolean {
  const a = new Set(alt);
  return neu.some((n) => !a.has(n));
}
