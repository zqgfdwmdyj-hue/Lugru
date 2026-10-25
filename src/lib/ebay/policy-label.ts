// Versandprofile verständlich beschriften: Dienstleister und Versandart, Preis, Bearbeitungszeit – statt
// automatisch erzeugter eBay-Namen wie „Pauschal:DHL Paket(4,99 €),3 Werktage#5123456789“.
// Reine Logik, auch im Browser nutzbar.

export type ShippingPolicyInfo = { id: string; name: string; cost?: number; freeShipping?: boolean; service?: string; handlingDays?: number };

/** eBay-Versandart-Codes (DE) → Dienstleister + Versandart. */
const SERVICES: Record<string, string> = {
  DE_DHLPaket: "DHL Paket",
  DE_DHLPaeckchen: "DHL Päckchen",
  DE_DHLExpress: "DHL Express",
  DE_DHLPaketInternational: "DHL Paket International",
  DE_DeutschePostBrief: "Deutsche Post Brief",
  DE_DeutschePostWarensendung: "Deutsche Post Warensendung",
  DE_DeutschePostBuecherWarensendung: "Deutsche Post Bücher-/Warensendung",
  DE_HermesPaket: "Hermes Paket",
  DE_HermesPaeckchen: "Hermes Päckchen",
  DE_DPDClassic: "DPD Classic",
  DE_DPDExpress: "DPD Express",
  DE_GLSBusiness: "GLS Paket",
  DE_GLSPaket: "GLS Paket",
  DE_UPSStandard: "UPS Standard",
  DE_UPSExpress: "UPS Express",
  DE_Pickup: "Abholung",
  DE_SonstigeDomestic: "Sonstiger Versand",
  DE_Einschreiben: "Einschreiben",
  DE_Spedition: "Spedition",
};

/** Lesbarer Name einer Versandart; Unbekanntes wird aus dem Code abgeleitet (DE_FooBarPaket → „Foo Bar Paket“). */
export function serviceName(code: string | undefined): string | null {
  if (!code) return null;
  if (SERVICES[code]) return SERVICES[code];
  return code.replace(/^[A-Z]{2}_/, "").replace(/([a-zäöü])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim() || null;
}

/** Automatisch erzeugte Profilnamen (eBay) tragen keine Information über die Felder hinaus. */
const AUTO_NAME = /^(pauschal|flat|calculated|berechnet|kostenlos|free)\s*:/i;

/** Eigener Name des Profils ohne angehängte eBay-ID („…#5123456789“). */
export function cleanPolicyName(name: string): string {
  return name.replace(/#\d{6,}\s*$/, "").replace(/\s+/g, " ").trim();
}

export function shippingPolicyLabel(p: ShippingPolicyInfo): string {
  const parts: string[] = [];
  const svc = serviceName(p.service);
  if (svc) parts.push(svc);
  if (p.freeShipping) parts.push("kostenlos");
  else if (p.cost !== undefined) parts.push(`${p.cost.toFixed(2).replace(".", ",")} €`);
  if (p.handlingDays !== undefined) parts.push(p.handlingDays === 0 ? "Versand am selben Tag" : `Versand in ${p.handlingDays} Werktag${p.handlingDays === 1 ? "" : "en"}`);
  const own = cleanPolicyName(p.name);
  if (!parts.length) return own || "Versandprofil";
  // Eigene, sprechende Profilnamen bleiben als Zusatz sichtbar; automatisch erzeugte nicht.
  return own && !AUTO_NAME.test(own) ? `${parts.join(" · ")} („${own.slice(0, 40)}“)` : parts.join(" · ");
}
