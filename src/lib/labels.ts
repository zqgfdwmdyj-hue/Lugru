export const COST_SOURCE_LABEL: Record<string, string> = {
  template: "Eigene Vorlage",
  accountone: "AccountOne",
  sellerboard: "Sellerboard",
  inherited: "geerbt",
  manual: "manuell",
};

export const INBOUND_STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  ready: "Bereit",
  transmitted: "An Amazon übertragen",
  shipped: "Versandt",
  receiving: "Wird eingebucht",
  closed: "Abgeschlossen",
};

export const CHANNEL_LABEL: Record<string, string> = {
  amazon: "Amazon",
  ebay: "eBay",
  tiktok: "TikTok Shop",
  temu: "Temu",
  kaufland: "Kaufland",
  shop: "Eigener Shop",
  manual: "Manuell",
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  open: "Offen",
  label_created: "Label erstellt",
  shipped: "Versendet",
  delivered: "Zugestellt",
  cancelled: "Storniert",
  returned: "Retour",
};

export const MAIL_CATEGORY_LABEL: Record<string, [string, string]> = {
  critical: ["KRITISCH", "tag-critical"],
  action: ["HANDELN", "tag-warn"],
  info: ["INFO", "tag-info"],
  noise: ["UNWICHTIG", "tag-neutral"],
};

export const CASE_TYPE_LABEL: Record<string, string> = {
  a_to_z: "A-bis-Z-Garantie",
  chargeback: "Rückbelastung",
  ebay_not_received: "eBay: nicht erhalten",
  ebay_not_as_described: "eBay: nicht wie beschrieben",
  return_request: "Rücksendeanfrage",
  buyer_message: "Käufernachricht",
  account_health: "Kontozustand",
  other: "Sonstiges",
};

export const CASE_STATUS_LABEL: Record<string, [string, string]> = {
  open: ["OFFEN", "tag-warn"],
  waiting: ["WARTET", "tag-info"],
  won: ["GEWONNEN", "tag-ok"],
  lost: ["VERLOREN", "tag-critical"],
  closed: ["ERLEDIGT", "tag-neutral"],
};

export const RETURN_STATUS_LABEL: Record<string, string> = {
  announced: "Angekündigt",
  received: "Eingegangen",
  refunded: "Erstattet",
  rejected: "Abgelehnt",
  closed: "Abgeschlossen",
};
