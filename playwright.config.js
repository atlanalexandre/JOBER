// Scénarios de bout en bout — joués contre la RECETTE, jamais contre la production.
//
//   npm run e2e                 → tous les scénarios
//   npx playwright test e2e/xx  → un seul fichier
//
// Variables lues :
//   RECETTE_URL                      adresse de la Preview (défaut : alane-recette.vercel.app)
//   VERCEL_AUTOMATION_BYPASS_SECRET  passe la protection des Preview Vercel
//   SUPABASE_ACCESS_TOKEN            jeton du projet de recette (préparation et contrôle des données)
//
// Avant tout scénario, `e2e/garde-fou.js` vérifie que la Preview interroge la base de
// recette et pas la production. S'il échoue, AUCUN scénario ne tourne : c'est voulu.
import { defineConfig, devices } from "@playwright/test";
import { optionsNavigateur } from "./e2e/outils.js";

const RECETTE_URL = (process.env.RECETTE_URL || "https://alane-recette.vercel.app").replace(/\s/g, "");
const { proxy, args } = optionsNavigateur();

export default defineConfig({
  testDir: "./e2e",
  // `.scenario.js` et non `.spec.js` : vitest ramasserait sinon ces fichiers.
  testMatch: "**/*.scenario.js",
  globalSetup: "./e2e/garde-fou.js",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Les scénarios partagent une seule base de recette : on les joue l'un après l'autre.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "e2e-rapport", open: "never" }]],
  outputDir: "e2e-resultats",
  use: {
    baseURL: RECETTE_URL,
    storageState: "e2e-resultats/.acces-preview.json",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    proxy,
    launchOptions: { args },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
});
