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

//
// CONNECT V2 (05/10/2026)
//
// Les comptes étaient créés par l'API historique (`POST /v1/accounts`,
// `type: express`), que Stripe dit « legacy ». Ils le sont désormais par
// l'API Accounts v2 (`POST /v2/core/accounts`), à la demande de l'équipe
// Stripe Accelerate. Correspondance avec l'ancien compte « Express », d'après
// la spécification officielle (stripe/openapi, version 2026-09-30.endive) :
//   • `dashboard: "express"`                    — même tableau de bord Stripe ;
//   • `fees_collector: "application_express"`   — même règle de frais qu'Express ;
//   • `losses_collector: "application"`         — ALANE couvre les soldes négatifs,
//                                                 comme avec Express ;
//   • configuration `recipient`, capacité `stripe_balance.stripe_transfers`
//     — l'équivalent de `capabilities[transfers]` : le compte REÇOIT des
//     virements (`POST /v1/transfers`, inchangé : les identifiants `acct_…`
//     sont les mêmes en v1 et en v2).
// Les comptes déjà créés en v1 continuent de fonctionner sans changement :
// `statutCompte()` les lit en v2, et à défaut en v1.
// ═══════════════════════════════════════════════════════════════════════════

// La version d'API est OBLIGATOIRE en v2 et fixée ici, comme le fait la
// bibliothèque officielle (stripe-node 23 : `2026-09-30.endive`). Le corps est
// en JSON, et non en formulaire comme en v1.
export const STRIPE_VERSION_V2 = "2026-09-30.endive";
const STRIPE_HEADERS_V2 = (cle, idempotence) => ({
  "Authorization":  `Bearer ${cle}`,
  "Content-Type":   "application/json",
  "Stripe-Version": STRIPE_VERSION_V2,
  ...(idempotence ? { "Idempotency-Key": idempotence } : {}),
});

/** Le corps de création d'un compte de virement, en v2. Exporté pour les tests. */
export function corpsCompteV2({ profil, email }) {
  const prenom = (profil?.prenom || "").trim();
  const nom = (profil?.nom || "").trim();
  const individuel = { ...(prenom ? { given_name: prenom } : {}), ...(nom ? { surname: nom } : {}), ...(email ? { email } : {}) };
  return {
    ...(email ? { contact_email: email } : {}),
    ...(prenom || nom ? { display_name: [prenom, nom].filter(Boolean).join(" ") } : {}),
    dashboard: "express",
    identity: { country: "FR", entity_type: "individual", ...(Object.keys(individuel).length ? { individual: individuel } : {}) },
    configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
    defaults: {
      currency: "eur",
      locales: ["fr-FR"],
      responsibilities: { fees_collector: "application_express", losses_collector: "application" },
    },
    include: ["configuration.recipient", "requirements"],
  };
}

/**
 * Garantit qu'un prestataire a un compte Connect, en le créant au besoin.
 *
 * Retourne { ok, compteId, cree, detail }. Ne crée jamais deux comptes : si
 * l'enregistrement en base échoue après la création chez Stripe, l'appel
 * ÉCHOUE plutôt que de rendre la main — sans quoi l'appel suivant recréerait
 * un compte, et le prestataire accumulerait des comptes orphelins sans jamais
 * en avoir un actif. La clé d'idempotence, propre au prestataire, fait qu'un
 * second appel dans les 24 h retrouve le MÊME compte chez Stripe.
 */
export async function assurerCompteConnect({ profil, email, supabaseUrl, headers, stripeKey }) {
  if (!stripeKey) {
    console.error("[connect] STRIPE_SECRET_KEY absente — aucun compte de virement ne peut être créé.");
    return { ok: false, detail: "Stripe n'est pas configuré côté plateforme." };
  }
  if (profil?.stripe_account_id) {
    return { ok: true, compteId: profil.stripe_account_id, cree: false };
  }

  const res = await fetch("https://api.stripe.com/v2/core/accounts", {
    method: "POST",
    headers: STRIPE_HEADERS_V2(stripeKey, `compte-presta-${profil.id}`),
    body: JSON.stringify(corpsCompteV2({ profil, email })),
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
  console.log(`[connect] compte ${acct.id} créé (Accounts v2) pour le prestataire ${profil.id}`);
  return { ok: true, compteId: acct.id, cree: true };
}

/**
 * Un lien de configuration frais (`POST /v2/core/account_links`).
 *
 * Les liens de Stripe expirent vite et ne servent qu'une fois : on en
 * régénère un à chaque besoin plutôt que d'en conserver un, qui serait périmé
 * le jour où l'on en a besoin. Valable aussi pour un compte créé en v1.
 */
export async function lienConfiguration({ compteId, stripeKey, appUrl }) {
  const base = appUrl || "https://www.alane.fr";
  const res = await fetch("https://api.stripe.com/v2/core/account_links", {
    method: "POST",
    headers: STRIPE_HEADERS_V2(stripeKey),
    body: JSON.stringify({
      account: compteId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          refresh_url: `${base}/provider/dashboard`,
          return_url:  `${base}/provider/dashboard`,
        },
      },
    }),
  });
  const link = await res.json().catch(() => ({}));
  if (!res.ok || !link.url) {
    console.error(`[connect] lien de configuration refusé pour ${compteId} :`,
      JSON.stringify(link).slice(0, 300));
    return { ok: false, detail: `Stripe a refusé le lien de configuration : ${link?.error?.message || "erreur inconnue"}` };
  }
  return { ok: true, url: link.url };
}

/**
 * Le compte peut-il recevoir des virements ? Lu chez Stripe, en v2 d'abord
 * (`configuration.recipient.capabilities.stripe_balance.stripe_transfers.status`
 * = `active`), puis en v1 pour un compte que la v2 ne sait pas lire
 * (`payouts_enabled`, le critère historique de ce projet).
 *
 * Retourne "enabled", "pending", ou null si Stripe n'a pas répondu — null ne
 * veut JAMAIS dire « pas activé » : l'appelant garde alors l'état connu.
 */
export async function statutCompte(compteId, stripeKey) {
  if (!compteId || !stripeKey) return null;
  try {
    const r = await fetch(
      `https://api.stripe.com/v2/core/accounts/${encodeURIComponent(compteId)}?include[0]=configuration.recipient`,
      { headers: STRIPE_HEADERS_V2(stripeKey) }
    );
    const a = await r.json().catch(() => null);
    if (r.ok && a?.id) {
      const statut = a?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
      if (statut) return statut === "active" ? "enabled" : "pending";
    } else {
      console.warn(`[connect] lecture v2 de ${compteId} impossible (${r.status}) — essai en v1.`);
    }
    const r1 = await fetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(compteId)}`,
      { headers: { "Authorization": `Bearer ${stripeKey}` } });
    const a1 = await r1.json().catch(() => null);
    if (!r1.ok || !a1?.id) {
      console.error(`[connect] compte ${compteId} illisible chez Stripe (v1 ${r1.status}).`);
      return null;
    }
    return a1.payouts_enabled ? "enabled" : "pending";
  } catch (e) {
    console.error(`[connect] statut de ${compteId} illisible :`, e.message);
    return null;
  }
}

/**
 * Relit le statut chez Stripe et l'enregistre s'il a changé. Renvoie le statut
 * à retenir : celui de Stripe s'il a répondu, sinon celui déjà connu.
 */
export async function rafraichirStatutCompte({ compteId, statutConnu, stripeKey, supabaseUrl, headers }) {
  const statut = await statutCompte(compteId, stripeKey);
  if (!statut) return statutConnu || null;
  if (statut !== statutConnu) {
    const up = await fetch(`${supabaseUrl}/rest/v1/profiles?stripe_account_id=eq.${encodeURIComponent(compteId)}`, {
      method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ stripe_account_status: statut }),
    }).catch(e => { console.error(`[connect] statut de ${compteId} non enregistré :`, e.message); return null; });
    if (up && !up.ok) console.error(`[connect] statut de ${compteId} non enregistré (${up.status}).`);
  }
  return statut;
}
