// Enregistrement d'un document déposé — le seul chemin, pour tous les écrans.
//
// Le fichier est d'abord envoyé dans le bucket `Documents`, à `{user_id}/{type}`,
// par le navigateur. Sa ligne dans la table `documents`, elle, est écrite par le
// SERVEUR (`/api/notify-doc`) : le navigateur n'a pas — et ne doit pas avoir — le
// droit de modifier `prestataire_id` ni `verified`, qu'un « upsert » réclame.
// Les cinq écrans qui l'écrivaient eux-mêmes étaient tous refusés par la base,
// dont un qui affichait quand même « Envoyé » (constaté en recette le 25/09/2026).
import { supabase } from "./supabase.js";

/**
 * Enregistre en base un document dont le fichier vient d'être déposé.
 * Lève une erreur au message lisible si l'enregistrement échoue.
 */
export async function enregistrerDocument(type, { renouvellement = false } = {}) {
  const { data } = await supabase.auth.getSession();
  const jeton = data?.session?.access_token;
  if (!jeton) throw new Error("Session expirée — reconnectez-vous pour envoyer vos documents.");
  const r = await fetch("/api/notify-doc", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${jeton}` },
    body: JSON.stringify({ docType: type, isRenewal: renouvellement }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.enregistre) {
    console.error(`[documents] ${type} non enregistré : ${r.status}`, j.error || "");
    throw new Error(j.error || `Le document n'a pas pu être enregistré (${r.status}). Réessayez.`);
  }
}
