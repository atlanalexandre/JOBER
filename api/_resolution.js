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

import { montantsDeCloture } from "./_cloture.js";
import { plafonnerRemboursement, restituerCashback } from "./_cashback.js";

export const DELAI_OPPOSITION_MS = 48 * 3600000;

// Part remboursable au Client lorsqu'un litige se dénoue par un remboursement.
//
// Les frais de service restent acquis à ALANE — décision du 16/08/2026, alignée
// sur la règle déjà posée pour les annulations : ils rémunèrent la mise en
// relation et le traitement du paiement, qui ont bien eu lieu, et couvrent des
// coûts déjà engagés auprès de l'établissement de paiement.
//
// Le remboursement portait auparavant sur l'INTÉGRALITÉ du PaymentIntent, ce
// qui était une troisième règle, différente des deux autres, dans un projet où
// c'est exactement ce qui finit par diverger.
//
// Retourne { centimes, fraisRetenus } — ou { centimes: null } lorsque le
// montant ne peut pas être établi. Dans ce cas l'appelant rembourse la totalité
// : à défaut de savoir ce qui est dû, on ne retient rien au consommateur.
export function montantRemboursable(m) {
  const total = Number(m?.montant_total || 0);
  if (!(total > 0)) return { centimes: null, fraisRetenus: 0 };

  const { fraisService } = montantsDeCloture(m);
  if (!(fraisService > 0)) return { centimes: null, fraisRetenus: 0 };

  const aRembourser = Math.round((total - fraisService) * 100) / 100;
  if (!(aRembourser > 0)) return { centimes: null, fraisRetenus: 0 };

  return { centimes: Math.round(aRembourser * 100), fraisRetenus: fraisService };
}

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
  //
  // Ce que Stripe a RÉELLEMENT rendu, en euros. Renseigné par la réponse de
  // Stripe et non par le montant demandé : le remboursement est plafonné à ce
  // que la carte a supporté, et c'est le montant rendu — pas le montant voulu —
  // qui décide de ce qu'il reste à répartir.
  let rembourseEuros = null;

  if (mission.stripe_payment_intent) {
    if (!stripeKey) {
      console.error(`[resolution] STRIPE_SECRET_KEY absente — remboursement impossible pour ${mission.id}`);
      return { ok: false, detail: "Stripe non configuré — remboursement impossible." };
    }
    try {
      // Les frais de service restent acquis : on ne rembourse que la part
      // prestation. Sans montant établissable, on rembourse tout — mieux vaut
      // rendre trop que retenir une somme qu'on ne sait pas justifier.
      // Un montant PARTIEL a-t-il été proposé ? La plupart des litiges réels
      // le sont : deux heures sur trois faites, une partie du travail à
      // refaire. Sans ce montant, l'arbitre n'avait que « tout » ou « rien »,
      // et devait choisir celui qui lésait le moins mal — ce qui n'est pas
      // une décision.
      //
      // Le montant saisi fait foi ; il reste plafonné plus bas par ce que la
      // carte a réellement supporté.
      const partiel = Number(mission.resolution_montant);
      const surMesure = Number.isFinite(partiel) && partiel > 0;
      const { centimes, fraisRetenus } = surMesure
        ? { centimes: Math.round(partiel * 100), fraisRetenus: 0 }
        : montantRemboursable(mission);
      if (surMesure) {
        console.log(`[resolution] remboursement partiel de ${partiel.toFixed(2)} €`
          + ` pour ${mission.id} — montant fixé lors de la proposition.`);
      } else if (centimes === null) {
        console.error(`[resolution] frais de service non établissables pour ${mission.id}`
          + " — remboursement intégral par défaut.");
      } else {
        console.log(`[resolution] remboursement de ${(centimes / 100).toFixed(2)} €`
          + ` pour ${mission.id} — ${fraisRetenus.toFixed(2)} € de frais de service retenus.`);
      }
      // Plafonné à ce que la carte a réellement supporté : une part du prix a
      // pu être réglée en cashback, et Stripe refuse de rendre plus qu'il n'a
      // prélevé. Le refus arriverait APRÈS la clôture du litige, laissant le
      // client sans prestation et sans remboursement.
      const centimesDus = await plafonnerRemboursement(centimes, mission, supabaseUrl, headers);
      const corpsRemboursement = { payment_intent: mission.stripe_payment_intent };
      if (centimesDus !== null) corpsRemboursement.amount = String(centimesDus);

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
        body: new URLSearchParams(corpsRemboursement).toString(),
      });
      const data = await rf.json();
      if (!data?.id) {
        console.error(`[resolution] remboursement Stripe refusé pour ${mission.id} :`, JSON.stringify(data).slice(0, 300));
        return { ok: false, detail: `Remboursement Stripe échoué : ${data?.error?.message || "erreur inconnue"}` };
      }
      console.log(`[resolution] remboursement ${data.id} pour la prestation ${mission.id}`);
      rembourseEuros = Math.round(Number(data.amount || 0)) / 100;
      // Le cashback consommé revient au client : la prestation lui est
      // remboursée, l'avantage n'a donc pas été consommé.
      await restituerCashback(mission, supabaseUrl, headers, "resolution");
    } catch (e) {
      console.error(`[resolution] remboursement Stripe impossible pour ${mission.id} :`, e.message);
      return { ok: false, detail: "Erreur lors du remboursement Stripe — prestation non close." };
    }
  }

  // `annule`, et non `held`.
  //
  // « Retenu » est un état TEMPORAIRE : l'article 7.4 borne la retenue à
  // quatre-vingt-dix jours, après quoi elle se lève d'elle-même et le versement
  // part — et le back-office offre un bouton « Lever ». Or le client vient
  // d'être remboursé : verser au prestataire reviendrait à payer deux fois, sur
  // les fonds d'ALANE.
  //
  // Le hold posé ici n'avait par ailleurs ni motif ni échéance, ce qui
  // l'affichait « Retenu pour « null » » et le rendait éternel. Il ne
  // protégeait que par accident : la levée d'office filtre sur
  // `payout_hold_until`, qui était nul.
  // ═══════════════════════════════════════════════════════════════════════
  // CE QUI RESTE APRÈS UN REMBOURSEMENT PARTIEL VA AU PRESTATAIRE
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Règle fixée par Alexandre le 24/08/2026 : sur ce que le client a payé et
  // qui ne lui est pas rendu, ALANE ne garde que ses frais de service ; le
  // reste revient au prestataire.
  //
  //     prestataire = montant payé − remboursé au client − frais de service
  //
  // Auparavant le prestataire ne touchait RIEN dès qu'un remboursement était
  // prononcé, même de 30 %. Sur une prestation à 20,20 € remboursée de 6,06 €,
  // 8,94 € ne revenaient ni au client ni au prestataire : ils restaient chez
  // ALANE sans que personne l'ait décidé.
  //
  // La règle englobe l'ancien comportement : sur un remboursement TOTAL — le
  // prix de la prestation, frais retenus — le reste tombe à zéro tout seul.
  // Rien n'est ajouté pour ce cas, ce qui évite deux règles à maintenir.
  //
  // Deux bornes, parce qu'il s'agit d'argent :
  //   • jamais plus que ce que le prestataire aurait touché sans litige — un
  //     calcul faux ne peut pas le sur-payer ;
  //   • en dessous d'un euro, le virement est refusé par Stripe : on annule
  //     plutôt que de programmer un versement qui échouera.
  const { partPrestataire, fraisService } = montantsDeCloture(mission);
  const paye  = Number(mission.montant_total || 0);
  const rendu = rembourseEuros === null ? paye : rembourseEuros;
  const brut  = Math.round((paye - rendu - fraisService) * 100) / 100;
  const reste = Math.max(0, Math.min(brut, Math.round(partPrestataire * 100) / 100));
  const aVerser = reste >= 1;

  if (aVerser) {
    console.log(`[resolution] ${mission.id} : ${rendu.toFixed(2)} € rendus au client, `
      + `${fraisService.toFixed(2)} € de frais retenus, ${reste.toFixed(2)} € dus au prestataire.`);
  } else if (brut > 0) {
    console.log(`[resolution] ${mission.id} : reliquat de ${brut.toFixed(2)} € inférieur au minimum `
      + "d'un virement — versement annulé.");
  }

  // `completed` quand il reste quelque chose à verser : le traitement des
  // versements ne lit que ce statut, et un `closed` portant un versement en
  // attente ne serait jamais payé.
  const r = await patch(aVerser
    ? {
        status: "completed",
        payout_status: "pending",
        payout_amount: reste,
        payout_due_at: new Date().toISOString(),
        resolution_executee_cause: cause || null,
      }
    : {
        status: "closed",
        payout_status: "annule",
        resolution_executee_cause: cause || null,
      });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    console.error(`[resolution] clôture non enregistrée (${r.status}) pour ${mission.id} : ${detail.slice(0, 200)}`);
    // Le remboursement est parti : le signaler franchement plutôt que de
    // laisser croire que rien ne s'est passé.
    return { ok: false, detail: "Le client a été remboursé mais la prestation n'a pas pu être close — à reprendre à la main." };
  }
  return { ok: true, statut: aVerser ? "completed" : "closed", versementPrestataire: aVerser ? reste : 0 };
}
