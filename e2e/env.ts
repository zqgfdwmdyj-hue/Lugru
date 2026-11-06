// Umgebung der automatischen Prüfungen – nur Testwerte, nichts davon gilt im echten System.
export const E2E_PORT = Number(process.env.E2E_PORT || 3200);
export const TD_PORT = Number(process.env.E2E_TESTDIENSTE_PORT || 4010);
export const TD = `http://127.0.0.1:${TD_PORT}`;
export const DATABASE_URL = process.env.E2E_DATABASE_URL || "postgres://seller:seller@localhost:5432/seller_e2e";
export const PASSWORT = process.env.TESTDATEN_PASSWORT || "E2E-Test-Passwort-2026";

export const E2E_ENV: Record<string, string> = {
  DATABASE_URL,
  APP_SECRET: process.env.E2E_APP_SECRET || "e2e-nur-fuer-automatische-pruefungen-0123456789",
  APP_URL: `http://localhost:${E2E_PORT}`,
  TESTDATEN_PASSWORT: PASSWORT,
  TESTUMGEBUNG: "1",
  ENABLE_SCHEDULER: "0",
  // B21: Discord-Call-Kanal live lesen (Gateway gegen den Discord-Nachbau), auch ohne Zeitplan.
  DISCORD_LIVE: "1",
  TESTDIENSTE_URL: TD,
  ANTHROPIC_BASE_URL: `${TD}/anthropic`,
  INTERNETMARKE_BASE_URL: `${TD}/im`,
  DHL_API_BASE_URL: `${TD}/dhl`,
  DHL_TRACKING_BASE_URL: `${TD}/dhl-track`,
  DHL_PICKUP_BASE_URL: `${TD}/dhl-pickup`,
  UPS_API_BASE_URL: `${TD}/ups`,
  // Rechnungsstation: Scanner-Ordner der Prüfungen, ohne Ruhezeit
  BELEG_EINGANG_DIR: `${process.cwd()}/.e2e-scan-eingang`,
  BELEG_EINGANG_RUHE_MS: "0",
  AMAZON_SP_BASE_URL: `${TD}/amazon`,
  AMAZON_LWA_URL: `${TD}/amazon-lwa`,
  EBAY_API_BASE_URL: `${TD}/ebay`,
  EBAY_MEDIA_URL: `${TD}/ebay/media`,
  EBAY_GRAPHQL_URL: `${TD}/ebay/graphql`,
  TEMU_BASE_URL: `${TD}/temu`,
  KEEPA_BASE_URL: `${TD}/keepa`,
  ECB_RATES_URL: `${TD}/ecb`,
  VIES_URL: `${TD}/vies`,
  LEXOFFICE_BASE_URL: `${TD}/lexoffice`,
  GOOGLE_DOCS_BASE_URL: `${TD}/gdocs`,
  DISCORD_API_BASE_URL: `${TD}/discord-api`,
  TESLA_BASE_URL: `${TD}/tesla`,
  TWILIO_BASE_URL: `${TD}/twilio`,
  ASANA_BASE_URL: `${TD}/asana`,
  // B29: sellerboard-MCP-Nachbau (Aufrufzähler, Tageslimit); kurze Pausen zwischen den Aufrufen
  SELLERBOARD_MCP_URL: `${TD}/sellerboard/mcp`,
  SELLERBOARD_GAP_MS: "30",
  SELLERBOARD_PREPARING_MS: "200",
  NEXT_TELEMETRY_DISABLED: "1",
  // B24: Wartezeit auf das Anmeldeformular der Browser-Automatik (live 60 s)
  AUTOMATIK_WARTEN_MS: "5000",
  // B27.2: Wartezeiten des ArbitrageOne-Abrufs (live 5 Min. je Schritt, Export-Liste 10 Min. alle 30 s)
  AO_SCHRITT_MS: "8000",
  AO_LISTE_MS: "30000",
  AO_LISTE_TAKT_MS: "2000",
  // Fotos/Videos der Retouren-Station (verschlüsselt) – eigener Ordner nur für die Prüfungen
  MEDIA_DIR: process.env.E2E_MEDIA_DIR || `${process.cwd()}/.e2e-medien`,
};
