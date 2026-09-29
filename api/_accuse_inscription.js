// ═══════════════════════════════════════════════════════════════════════════
// Accusé de réception de l'inscription d'un prestataire
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI (29/09/2026)
//
// Alexandre envoyait ce courriel à la main, à chaque inscription. Un courriel
// d'accueil automatique existait pourtant (`welcome`, api/support.js), mais il
// partait du NAVIGATEUR, avec la session de l'inscription — et depuis que la
// confirmation de l'adresse e-mail est active, l'inscription ne rend aucune
// session : l'écran s'arrête avant l'envoi. Il ne partait donc presque jamais,
// et annonçait de toute façon une validation « sous 24 h » qui n'a pas lieu.
//
// Il est désormais envoyé par le SERVEUR, au passage du traitement automatique
// (toutes les deux heures), à chaque prestataire en attente qui ne l'a pas
// encore reçu — et, quand la session existe, dès l'inscription. Une seule fois :
// `profiles.accuse_inscription_at` le marque.
//
// LE TEXTE EST PROVISOIRE : il vaut jusqu'à la création de la société (décision
// d'Alexandre). Pour le changer, c'est ICI, et nulle part ailleurs.
import { esc, emailHtml, sendEmail } from "./_email.js";

export const SUJET_ACCUSE_INSCRIPTION = "Votre demande d'inscription sur ALANE";

export function htmlAccuseInscription() {
  return emailHtml(`
    <p>Bonjour,</p>
    <p>Nous vous confirmons la bonne réception de votre demande d'inscription.</p>
    <p>La plateforme n'est pas encore ouverte au public. Votre profil sera validé prochainement, dès la mise en route d'Alane.</p>
    <p>Vous recevrez automatiquement une notification par e-mail dès que votre accès sera actif. Aucune démarche de votre part n'est nécessaire dans l'intervalle.</p>
    <p>Nous vous remercions de votre confiance et de votre patience.</p>
    <p>Cordialement,<br/>La direction</p>
  `);
}

/**
 * Envoie l'accusé de réception à UN prestataire, une seule fois.
 *
 * La prise vient d'abord : écriture conditionnelle sur `accuse_inscription_at`
 * (vide, prestataire, en attente). Deux passages simultanés — l'inscription et
 * le traitement automatique — ne peuvent donc pas l'envoyer deux fois. Si
 * l'envoi échoue, la prise est rendue et le passage suivant réessaie : un
 * courriel marqué envoyé qui n'est pas parti, c'est un inscrit oublié.
 *
 * @returns {Promise<"envoye"|"deja"|"echec">}
 */
export async function envoyerAccuseInscription(profilId, email, supabaseUrl, headers) {
  if (!profilId || !email) return "echec";
  const maintenant = new Date().toISOString();
  try {
    const prise = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${profilId}&role=eq.prestataire&status=eq.pending&accuse_inscription_at=is.null`,
      { method: "PATCH", headers: { ...headers, "Content-Type": "application/json", "Prefer": "return=representation" },
        body: JSON.stringify({ accuse_inscription_at: maintenant }) });
    const lignes = await prise.json().catch(() => null);
    if (!prise.ok || !Array.isArray(lignes)) {
      console.error(`[accusé d'inscription] prise impossible pour ${profilId} (${prise.status}) — rien envoyé.`);
      return "echec";
    }
    if (lignes.length === 0) return "deja"; // déjà envoyé, validé entre-temps, ou pas un prestataire

    const envoye = await sendEmail({ to: email, subject: SUJET_ACCUSE_INSCRIPTION, html: htmlAccuseInscription() });
    if (envoye === true) return "envoye";

    console.error(`[accusé d'inscription] envoi refusé pour ${esc(email)} — prise rendue, le passage suivant réessaiera.`);
    const rendu = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${profilId}&accuse_inscription_at=eq.${encodeURIComponent(maintenant)}`, {
      method: "PATCH", headers: { ...headers, "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ accuse_inscription_at: null }),
    }).catch(e => ({ ok: false, status: e.message }));
    if (!rendu.ok) console.error(`[accusé d'inscription] ⚠️ prise NON rendue pour ${profilId} (${rendu.status}) : ce prestataire ne recevra pas l'accusé. À envoyer à la main.`);
    return "echec";
  } catch (e) {
    console.error(`[accusé d'inscription] ${profilId} :`, e.message);
    return "echec";
  }
}
