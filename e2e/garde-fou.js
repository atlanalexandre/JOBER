// Garde-fou joué AVANT tout scénario : la Preview visée doit tourner sur la recette.
//
// Un scénario crée des comptes, réserve, annule, déclenche des tâches planifiées.
// Joué contre la production, il écrirait dans la vraie base. On ne se contente donc
// pas de la configuration : on inspecte ce qui est RÉELLEMENT déployé.
//
//   1. le code envoyé au navigateur cite la base de recette, et jamais la production ;
//   2. la clé Stripe du navigateur est une clé de test ;
//   3. les fonctions serveur lisent la même base que la recette (même décompte) ;
//   4. puis on dépose le cookie qui ouvre la protection des Preview Vercel.
import { chromium, request } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { RECETTE_URL, BYPASS, RECETTE_REF, PROD_REF, sql, optionsNavigateur, avecReprise } from "./outils.js";

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;

function refuser(raison) {
  throw new Error(`[garde-fou] ${raison}\nAucun scénario n'a été joué.`);
}

export default async function gardeFou() {
  if (!BYPASS) refuser("VERCEL_AUTOMATION_BYPASS_SECRET absent : la Preview est inaccessible.");
  if (new URL(RECETTE_URL).hostname.endsWith("alane.fr")) refuser(`${RECETTE_URL} est un domaine de production.`);

  const ctx = await request.newContext({ proxy, extraHTTPHeaders: { "x-vercel-protection-bypass": BYPASS } });
  try {
    const page = await avecReprise(() => ctx.get(RECETTE_URL + "/"), "garde-fou : accueil");
    if (!page.ok()) refuser(`la Preview répond ${page.status()}.`);
    const html = await page.text();
    const scripts = [...new Set(html.match(/\/assets\/[\w.-]+\.js/g) || [])];
    let code = "";
    for (const s of scripts) code += await avecReprise(async () => (await ctx.get(RECETTE_URL + s)).text(), `garde-fou : ${s}`);

    if (code.includes(PROD_REF)) refuser("le code déployé cite la base de PRODUCTION.");
    if (!code.includes(RECETTE_REF)) refuser("le code déployé ne cite pas la base de recette.");
    if (/pk_live_/.test(code)) refuser("la clé Stripe du navigateur est une clé LIVE.");

    const compte = await avecReprise(() => ctx.get(RECETTE_URL + "/api/prestataires?action=count"), "garde-fou : décompte");
    const { count } = await compte.json();
    const [{ n }] = await sql("select count(*)::int n from profiles where role='prestataire' and status='approved'");
    if (count !== n) {
      refuser(`les fonctions serveur voient ${count} prestataire(s) approuvé(s), la recette ${n} : elles ne lisent pas la recette.`);
    }
  } finally {
    await ctx.dispose();
  }

  // Cookie de passage : les requêtes du navigateur vers Supabase ou Stripe ne doivent
  // pas porter l'en-tête de contournement (il ferait échouer leur contrôle CORS).
  mkdirSync("e2e-resultats", { recursive: true });
  const navigateur = await chromium.launch(optionsNavigateur());
  const contexte = await navigateur.newContext();
  const onglet = await contexte.newPage();
  await avecReprise(() => onglet.goto(`${RECETTE_URL}/?x-vercel-protection-bypass=${BYPASS}&x-vercel-set-bypass-cookie=samesitenone`), "garde-fou : cookie");
  await contexte.storageState({ path: "e2e-resultats/.acces-preview.json" });
  await navigateur.close();
}
