import { defineConfig, devices } from "@playwright/test";
import { E2E_ENV, E2E_PORT, TD_PORT } from "./e2e/env";

// Automatische Ablaufprüfungen (npm run e2e): frische Test-Datenbank mit erfundenen Daten, Testdienste statt echter
// Dienste, App im Testbetrieb. Vorher einmal bauen: npm run build. Bericht: playwright-report/index.html
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/ergebnis.json" }]],
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } }, grepInvert: /@nur-handy/ },
    { name: "handy", use: { ...devices["Pixel 7"] }, grep: /@handy|@nur-handy/ },
  ],
  webServer: [
    {
      command: "node scripts/testdienste.mjs",
      url: `http://127.0.0.1:${TD_PORT}/__gesund`,
      env: { TESTDIENSTE_PORT: String(TD_PORT), TESTDIENSTE_URL: `http://127.0.0.1:${TD_PORT}` },
      reuseExistingServer: false,
    },
    {
      // Erst die Test-Datenbank frisch füllen, dann die App starten.
      command: `npx tsx --conditions=react-server scripts/testdaten.ts && npx next start -p ${E2E_PORT}`,
      url: `http://localhost:${E2E_PORT}/login`,
      env: E2E_ENV,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: "pipe",
    },
  ],
});
