// Lien de réinitialisation du mot de passe : secret, signature, vérification.
//
// Audit « sécurité », 01/10/2026. Trois défauts :
//
//  1. Sans `BO_SESSION_SECRET`, les liens étaient signés avec « alane-reset-fallback »,
//     écrit en clair dans le dépôt : qui le lisait pouvait fabriquer un lien valide
//     pour n'importe quelle adresse, et changer le mot de passe de n'importe quel
//     compte. Il n'y a plus de valeur publique : à défaut, le secret est dérivé de
//     la clé service role, qui ne quitte jamais le serveur. Et il est propre à cet
//     usage (dérivation dédiée) : une signature de session du back-office ne peut
//     pas servir de lien de réinitialisation, ni l'inverse.
//
//  2. Un lien restait utilisable pendant une heure, autant de fois qu'on voulait —
//     y compris après avoir servi. Il est désormais lié à l'état du compte
//     (`updated_at`, que Supabase change à chaque modification du compte : mot de
//     passe, connexion) : dès que le mot de passe a été changé, le lien ne vaut plus.
//
//  3. N'importe qui pouvait faire envoyer des e-mails en rafale à une adresse, depuis
//     le domaine d'ALANE. Une demande au plus toutes les dix minutes par compte ;
//     l'heure est notée dans `app_metadata`, que seul le serveur peut écrire.
import crypto from "crypto";

export const VALIDITE_LIEN_MS = 60 * 60 * 1000;
export const INTERVALLE_DEMANDES_MS = 10 * 60 * 1000;

/** Secret de signature des liens, ou null si le serveur n'a aucune clé. */
export function secretReinitialisation(env = process.env) {
  const base = (env.BO_SESSION_SECRET || "").replace(/\s/g, "")
            || (env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  if (!base) return null;
  return crypto.createHmac("sha256", base).update("alane:reinitialisation-mot-de-passe").digest("hex");
}

function empreinte(secret, email, horodatage, etatCompte) {
  return crypto.createHmac("sha256", secret)
    .update(`${String(email).trim().toLowerCase()}:${horodatage}:${etatCompte || ""}`)
    .digest("hex");
}

/** Jeton « emailB64.horodatage.empreinte », lié à l'état actuel du compte. */
export function signerLien(secret, email, etatCompte, maintenant = Date.now()) {
  const emailB64 = Buffer.from(String(email).trim().toLowerCase()).toString("base64url");
  return `${emailB64}.${maintenant}.${empreinte(secret, email, maintenant, etatCompte)}`;
}

/** Décode le jeton sans le valider : { email, horodatage } ou null. */
export function lireLien(jeton) {
  const parties = String(jeton || "").split(".");
  if (parties.length !== 3) return null;
  const [emailB64, h, sig] = parties;
  const horodatage = Number.parseInt(h, 10);
  if (!Number.isFinite(horodatage) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  let email;
  try { email = Buffer.from(emailB64, "base64url").toString("utf8"); }
  catch { return null; } // base64 illisible : jeton invalide, rien d'autre à signaler
  if (!email.includes("@")) return null;
  return { email, horodatage, sig };
}

/**
 * Vérifie un jeton contre l'état ACTUEL du compte.
 * @returns {"ok"|"invalide"|"expire"|"perime"}
 *   « perime » : la signature correspondait à un état antérieur du compte — le
 *   lien a déjà servi, ou le compte a été modifié depuis.
 */
export function verifierLien(secret, jeton, etatCompte, maintenant = Date.now()) {
  const l = lireLien(jeton);
  if (!l) return "invalide";
  if (l.horodatage > maintenant + 60_000) return "invalide";
  if (maintenant - l.horodatage > VALIDITE_LIEN_MS) return "expire";
  const attendu = empreinte(secret, l.email, l.horodatage, etatCompte);
  const ok = crypto.timingSafeEqual(Buffer.from(l.sig, "hex"), Buffer.from(attendu, "hex"));
  return ok ? "ok" : "perime";
}

/** Une demande est-elle trop rapprochée de la précédente ? */
export function demandeTropRapprochee(compte, maintenant = Date.now()) {
  const derniere = Date.parse(compte?.app_metadata?.reinit_demandee_at || "");
  return Number.isFinite(derniere) && maintenant - derniere < INTERVALLE_DEMANDES_MS;
}
