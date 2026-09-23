// Outils partagés par les scénarios : accès SQL à la RECETTE, et à elle seule.
//
// La préparation (valider un dossier, reculer une date pour simuler 48 h écoulées)
// et le contrôle (« la prestation est-elle bien passée au statut X ? ») passent par
// l'API de gestion Supabase, avec le jeton limité au projet de recette.
import { request } from "@playwright/test";
import { createHash, createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export const RECETTE_REF = "qoizrysxwjmhqwuteajj";
export const PROD_REF = "dezxefweqesurqbqxsta";
export const RECETTE_URL = (process.env.RECETTE_URL || "https://alane-recette.vercel.app").replace(/\s/g, "");
export const BYPASS = (process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "").replace(/\s/g, "");
const JETON = (process.env.SUPABASE_ACCESS_TOKEN || "").replace(/\s/g, "");
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;

/**
 * Réglages du navigateur. Dans l'environnement cloud de Claude, le trafic sort par un
 * proxy qui présente son propre certificat : Chromium doit faire confiance à CETTE
 * autorité, et à elle seule (empreinte de sa clé publique). Ailleurs, rien de spécial.
 */
export function optionsNavigateur() {
  const ca = "/root/.ccr/agent-proxy-ca.crt";
  if (!process.env.HTTPS_PROXY || !existsSync(ca)) return { proxy, args: [] };
  const spki = createPublicKey(readFileSync(ca)).export({ type: "spki", format: "der" });
  const empreinte = createHash("sha256").update(spki).digest("base64");
  return { proxy, args: [`--ignore-certificate-errors-spki-list=${empreinte}`] };
}

let contexte;
async function api() {
  if (!contexte) contexte = await request.newContext({ proxy });
  return contexte;
}

/** Exécute une requête SQL sur la base de RECETTE et renvoie les lignes. */
export async function sql(requete) {
  if (!JETON) throw new Error("SUPABASE_ACCESS_TOKEN absent : impossible de préparer la recette.");
  const res = await (await api()).post(
    `https://api.supabase.com/v1/projects/${RECETTE_REF}/database/query`,
    { headers: { Authorization: `Bearer ${JETON}` }, data: { query: requete } },
  );
  const corps = await res.json().catch(() => null);
  if (!res.ok() || !Array.isArray(corps)) {
    throw new Error(`[sql recette] ${res.status()} ${JSON.stringify(corps).slice(0, 300)}`);
  }
  return corps;
}

/** Appelle une fonction /api de la Preview, protection Vercel passée. */
export async function appelApi(chemin, options = {}) {
  const res = await (await api()).fetch(`${RECETTE_URL}${chemin}`, {
    ...options,
    headers: { "x-vercel-protection-bypass": BYPASS, ...(options.headers || {}) },
  });
  const texte = await res.text();
  let json = null;
  try { json = JSON.parse(texte); } catch { /* réponse non JSON : on garde le texte brut */ }
  return { statut: res.status(), json, texte };
}

/** Adresse e-mail unique, sur un domaine réservé qui ne délivre jamais rien. */
export function emailTest(prefixe) {
  return `${prefixe}.${Date.now()}.${Math.floor(Math.random() * 1e4)}@recette.alane.test`;
}

export const MOT_DE_PASSE = "Recette!2026-e2e";
