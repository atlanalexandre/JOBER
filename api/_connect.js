// ═══════════════════════════════════════════════════════════════════════════
// Le compte de virement du prestataire (Stripe Connect) — source unique
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// La création du compte Connect et la génération du lien de configuration
// existaient en deux endroits : la validation du dossier dans `bo-action.js`,
// et le bouton du prestataire dans `stripe-connect.js`. Deux copies des mêmes
// paramètres Stripe, dans un projet où c'est exactement ce qui finit par
// diverger — le pays, les capacités demandées ou le type de compte auraient
// changé d'un côté sans l'autre.
//
// QUAND LE LIEN EST ENVOYÉ, ET POURQUOI CE MOMENT-LÀ
//
// Il partait à la VALIDATION DU COMPTE. C'était trop tôt : le lien de Stripe
// expire en vingt-quatre heures, et la validation d'un compte ne dit rien de
// l'état du dossier. Entre le moment où le compte est validé et celui où le
// prestataire est réellement prêt, il peut s'écouler des jours — le lien était
// mort avant d'avoir servi.
//
// Il part désormais à l'OUVERTURE DE L'ACCÈS AUX PRESTATIONS. Ce geste-là a un
// sens : il signifie que le dossier est complet et vérifié, donc que le
// prestataire va travailler et doit pouvoir être payé. C'est le moment où le
// lien a le plus de chances d'être utilisé dans sa fenêtre de validité.
//
// Et si les vingt-quatre heures passent quand même, le prestataire retrouve un
// bouton dans son espace : voir `api/stripe-connect.js`.
// ═══════════════════════════════════════════════════════════════════════════

const STRIPE_HEADERS = (cle) => ({
  "Authorization": `Bearer ${cle}`,
  "Content-Type":  "application/x-www-form-urlencoded",
});

/**
 * Garantit qu'un prestataire a un compte Connect, en le créant au besoin.
 *
 * Retourne { ok, compteId, cree, detail }. Ne crée jamais deux comptes : si
 * l'enregistrement en base échoue après la création chez Stripe, l'appel
 * ÉCHOUE plutôt que de rendre la main — sans quoi l'appel suivant recréerait
 * un compte, et le prestataire accumulerait des comptes orphelins sans jamais
 * en avoir un actif.
 */
export async function assurerCompteConnect({ profil, email, supabaseUrl, headers, stripeKey }) {
  if (!stripeKey) {
    console.error("[connect] STRIPE_SECRET_KEY absente — aucun compte de virement ne peut être créé.");
    return { ok: false, detail: "Stripe n'est pas configuré côté plateforme." };
  }
  if (profil?.stripe_account_id) {
    return { ok: true, compteId: profil.stripe_account_id, cree: false };
  }

  const params = new URLSearchParams({
    type: "express",
    country: "FR",
    email: email || "",
    "capabilities[transfers][requested]": "true",
    business_type: "individual",
    "individual[first_name]": profil?.prenom || "",
    "individual[last_name]":  profil?.nom    || "",
  });
  const res = await fetch("https://api.stripe.com/v1/accounts", {
    method: "POST", headers: STRIPE_HEADERS(stripeKey), body: params.toString(),
  });
  const acct = await res.json().catch(() => ({}));
  if (!res.ok || !acct.id) {
    console.error(`[connect] création de compte refusée pour ${profil?.id} :`,
      JSON.stringify(acct).slice(0, 300));
    return { ok: false, detail: `Stripe a refusé la création du compte : ${acct?.error?.message || "erreur inconnue"}` };
  }

  const up = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${profil.id}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({ stripe_account_id: acct.id, stripe_account_status: "pending" }),
  });
  const rows = await up.json().catch(() => []);
  if (!up.ok || !Array.isArray(rows) || rows.length === 0) {
    console.error(`[connect] compte ${acct.id} créé chez Stripe mais NON ENREGISTRÉ pour ${profil?.id} `
      + `(${up.status}) — à rattacher à la main pour éviter les comptes orphelins.`);
    return { ok: false, detail: "Le compte de virement a été créé mais n'a pas pu être enregistré." };
  }
  console.log(`[connect] compte ${acct.id} créé pour le prestataire ${profil.id}`);
  return { ok: true, compteId: acct.id, cree: true };
}

/**
 * Un lien de configuration frais.
 *
 * Les `account_links` de Stripe expirent en 24 h et ne servent qu'une fois : on
 * en régénère un à chaque besoin plutôt que d'en conserver un, qui serait périmé
 * le jour où l'on en a besoin.
 */
export async function lienConfiguration({ compteId, stripeKey, appUrl }) {
  const base = appUrl || "https://www.alane.fr";
  const res = await fetch("https://api.stripe.com/v1/account_links", {
    method: "POST",
    headers: STRIPE_HEADERS(stripeKey),
    body: new URLSearchParams({
      account: compteId,
      refresh_url: `${base}/provider/dashboard`,
      return_url:  `${base}/provider/dashboard`,
      type: "account_onboarding",
    }).toString(),
  });
  const link = await res.json().catch(() => ({}));
  if (!res.ok || !link.url) {
    console.error(`[connect] lien de configuration refusé pour ${compteId} :`,
      JSON.stringify(link).slice(0, 300));
    return { ok: false, detail: `Stripe a refusé le lien de configuration : ${link?.error?.message || "erreur inconnue"}` };
  }
  return { ok: true, url: link.url };
}
