export const KNOWLEDGE_CATEGORIES = [
  "Amazon-Richtlinien",
  "FBA Prep & Versand",
  "Ansprüche & Fristen",
  "eBay",
  "TikTok Shop & Temu",
  "DHL & Versand",
  "Lieferanten",
  "Steuer & Buchhaltung",
  "Tools & Abläufe",
  "Eigene Notizen",
] as const;

export const SNIPPET_CATEGORIES = ["Kundennachrichten", "Amazon-Support", "A-bis-Z & Fälle"] as const;

export const ALL_CATEGORIES = [...KNOWLEDGE_CATEGORIES, ...SNIPPET_CATEGORIES] as const;
