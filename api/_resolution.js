// ═══════════════════════════════════════════════════════════════════════════
// Résolution des litiges — source unique (CGPS art. 17.1)
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// L'article 17.1 réécrit le 16/08/2026 ne connaît que trois causes de
// déblocage des fonds bloqués par un litige :
//
//   1. l'accord des parties — la proposition d'ALANE notifiée aux deux, sans
//      opposition de l'une ou de l'autre dans les 48 heures ;
//   2. les procédures propres au prestataire de services de paiement
//      (rétrofacturation, opposition bancaire, fraude) ;
//   3. une décision de justice ou d'une autorité compétente.
//
// ALANE ne décide pas. Elle constate l'une de ces trois causes et transmet
// l'instruction correspondante à Stripe.
//
// Le code faisait exactement l'inverse : `resolve_dispute`, `release_dispute`
// et `refund_dispute` tranchaient unilatéralement depuis le backoffice, sans
// proposition préalable, sans notification, et sans qu'aucune des parties
// puisse s'y opposer. Un remboursement Stripe partait dans la seconde.
//
// D'où ce module : les deux seuls dénouements que la Plateforme sait exécuter,
// écrits une fois, appelés par le backoffice (causes 2 et 3, sur
// justification) et par le traitement automatique (cause 1, à l'échéance).
//
// Ce qu'il ne contient PAS, volontairement : aucune règle décidant QUI a
// raison. Ce module exécute une cause déjà constatée ; il ne l'apprécie pas.
// ═══════════════════════════════════════════════════════════════════════════

export const DELAI_OPPOSITION_MS = 48 * 3600000;

// Les deux seules propositions formulables. Toute autre valeur est refusée
// côté base par `missions_resolution_proposee_check` : la contrainte et cette
// liste doivent bouger ensemble (CLAUDE.md §1.6).
export const RESOLUTIONS = ["verser_prestataire", "rembourser_client"];

export function libelleResolution(r) {
  if (r === "verser_prestataire") return "verser la rémunération au prestataire";
  if (r === "rembourser_client")  return "rembourser le client";
  return String(r || "");
}

// L'échéance d'opposition, à partir de la notification.
export function echeanceOppositionMs(notifieLeMs) {
  return notifieLeMs + DELAI_OPPOSITION_MS;
}

// Une proposition est réputée acceptée lorsqu'elle a été notifiée, que son
// délai est expiré et qu'aucune des deux parties ne s'y est opposée.
//
// L'opposition d'UNE SEULE partie suffit à faire obstacle au déblocage : c'est
// ce que dit l'article 17.1, et c'est ce qui distingue un accord d'une
// décision prise par la Plateforme.
export function accordRepute(m, nowMs = Date.now()) {
  if (!m || !m.resolution_proposee) return false;
  if (m.resolution_opposition_at) return false;
  const echeance = m.resolution_echeance_at ? Date.parse(m.resolution_echeance_at) : NaN;
  if (Number.isNaN(echeance)) return false;
  return nowMs >= echeance;
}

// Exécute un dénouement déjà constaté.
//
// `fetchJson` et `headers` sont injectés pour que ce module reste testable et
// n'aille pas lire l'environnement lui-même — la clé service role n'a pas à
// exister en deux endroits.
//
// Retourne { ok, statut, detail }. Ne remonte JAMAIS une erreur en silence :
// un remboursement Stripe qui échoue doit faire échouer l'appel, sans quoi la
// prestation serait close alors que le client n'a rien reçu.
export async function executerResolution({
  mission, resolution, supabaseUrl, headers, stripeKey, cause,
}) {
  if (!RESOLUTIONS.includes(resolution)) {
    return { ok: false, detail: `résolution inconnue : ${resolution}` };
  }
  const patch = (body) => fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${mission.id}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify(body),
  });

  if (resolution === "verser_prestataire") {
    // Le versement repasse en attente : le traitement des versements le
    // reprendra. Sans cette remise à zéro, une prestation dont le virement
    // avait échoué avant le litige resterait `failed` et ne serait jamais payée.
    const r = await patch({ status: "completed", payout_status: "pending", resolution_executee_cause: cause || null });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error(`[resolution] versement non enregistré (${r.status}) pour ${mission.id} : ${detail.slice(0, 200)}`);
      return { ok: false, detail: "La prestation n'a pas pu être rouverte au versement." };
    }
    return { ok: true, statut: "completed" };
  }

  // rembourser_client
  if (mission.stripe_payment_intent) {
    if (!stripeKey) {
      console.error(`[resolution] STRIPE_SECRET_KEY absente — remboursement impossible pour ${mission.id}`);
      return { ok: false, detail: "Stripe non configuré — remboursement impossible." };
    }
    try {
      const rf = await fetch("https://api.stripe.com/v1/refunds", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          // Idempotence : le traitement automatique repasse toutes les deux
          // heures. Sans cette clé, un échec réseau après l'appel Stripe mais
          // avant l'écriture en base rembourserait deux fois.
          "Idempotency-Key": `resolution-${mission.id}`,
        },
        body: new URLSearchParams({ payment_intent: mission.stripe_payment_intent }).toString(),
      });
      const data = await rf.json();
      if (!data?.id) {
        console.error(`[resolution] remboursement Stripe refusé pour ${mission.id} :`, JSON.stringify(data).slice(0, 300));
        return { ok: false, detail: `Remboursement Stripe échoué : ${data?.error?.message || "erreur inconnue"}` };
      }
      console.log(`[resolution] remboursement ${data.id} pour la prestation ${mission.id}`);
    } catch (e) {
      console.error(`[resolution] remboursement Stripe impossible pour ${mission.id} :`, e.message);
      return { ok: false, detail: "Erreur lors du remboursement Stripe — prestation non close." };
    }
  }

  const r = await patch({ status: "closed", payout_status: "held", resolution_executee_cause: cause || null });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    console.error(`[resolution] clôture non enregistrée (${r.status}) pour ${mission.id} : ${detail.slice(0, 200)}`);
    // Le remboursement est parti : le signaler franchement plutôt que de
    // laisser croire que rien ne s'est passé.
    return { ok: false, detail: "Le client a été remboursé mais la prestation n'a pas pu être close — à reprendre à la main." };
  }
  return { ok: true, statut: "closed" };
}
