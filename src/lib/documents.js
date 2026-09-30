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

/**
 * La photo du prestataire connecté, telle que les clients la verront : le
 * document `photo` du bucket, et non plus `profiles.avatar_url` (30/09/2026).
 * @returns {Promise<{ url: string|null, verifiee: boolean, deposee: boolean }>}
 *   `deposee: false` quand aucune photo n'a été déposée ; une lecture ratée
 *   est journalisée et rendue comme « pas de photo affichable ».
 */
export async function maPhoto(uid) {
  const { data: doc, error } = await supabase.from("documents")
    .select("verified").eq("prestataire_id", uid).eq("type", "photo").maybeSingle();
  if (error) {
    console.error("[documents] photo : ligne illisible :", error.message);
    return { url: null, verifiee: false, deposee: false };
  }
  if (!doc) return { url: null, verifiee: false, deposee: false };
  const { data: su, error: se } = await supabase.storage.from("Documents").createSignedUrl(`${uid}/photo`, 3600);
  if (se) console.error("[documents] photo : URL signée refusée :", se.message);
  return { url: su?.signedUrl || null, verifiee: doc.verified === true, deposee: true };
}

/**
 * Dépose une nouvelle photo et l'enregistre : elle
 * repasse EN ATTENTE, et n'est montrée aux clients qu'une fois validée.
 * Lève une erreur au message lisible.
 */
export async function deposerPhoto(uid, blob, { remplacement = false } = {}) {
  const { error } = await supabase.storage.from("Documents")
    .upload(`${uid}/photo`, blob, { upsert: true, contentType: blob.type || "image/jpeg" });
  if (error) {
    console.error("[documents] photo : envoi refusé :", error.message);
    throw new Error("La photo n'a pas pu être envoyée. Réessayez." + (error.message ? ` (${error.message})` : ""));
  }
  await enregistrerDocument("photo", { renouvellement: remplacement });
}
