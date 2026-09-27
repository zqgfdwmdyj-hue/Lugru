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
