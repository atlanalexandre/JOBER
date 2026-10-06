// ═══════════════════════════════════════════════════════════════════════════
// Le cashback en réduction sur le paiement
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI
//
// Le cashback était crédité, affiché, et dépensable nulle part. Le seul code
// qui le consommait était `pay_mission` (paiement depuis le portefeuille),
// devenu inatteignable à la fermeture du portefeuille le 16/08/2026.
//
// L'article 5B.1 des CGPS promet pourtant « un crédit utilisable pour le
// paiement total ou partiel de futures Prestations ». Une promesse écrite sans
// implémentation est le défaut que ce projet traque : elle ne se voit pas, et
// elle se découvre le jour où un client la réclame.
//
// Le cashback s'impute désormais en RÉDUCTION du paiement par carte.
//
// CE QUI EST RÉDUIT, ET CE QUI NE L'EST PAS
//
// La réduction porte sur ce que le CLIENT paie. Elle ne change ni la part du
// prestataire, ni les frais de service dus : le cashback est un avantage
// commercial accordé par ALANE, c'est donc ALANE qui l'absorbe.
//
// `montant_total` continue de porter le PRIX de la prestation — ce que le
// client doit. `cashback_applique` porte la part de ce prix réglée en cashback.
// Ce que la carte a supporté est la différence, et c'est cette différence, et
// elle seule, qui borne un remboursement.
//
//     montant_total          prix de la prestation, frais compris
//   − cashback_applique      part réglée en cashback
//   = montant réellement prélevé sur la carte
//
// Écrire la réduction dans `montant_total` aurait été plus court et faux : la
// facture du prestataire, le calcul des frais de service, le cashback de la
// prestation suivante et les statistiques de chiffre d'affaires le lisent tous.
// Une remise consentie par ALANE serait devenue une baisse du prix de vente.
//
// QUAND LE SOLDE EST DÉBITÉ
//
// À la CONFIRMATION du paiement, jamais à la création de l'intention.
//
// L'ordre inverse — réserver puis restituer si le paiement échoue — obligerait
// à restituer sur une douzaine de chemins d'annulation, de refus et
// d'expiration. En oublier un ferait disparaître le cashback d'un client en
// silence, sans erreur ni trace. Ici, un paiement abandonné ne consomme rien :
// il n'y a rien à défaire.
//
// Le prix de ce choix est une course possible : deux réservations menées de
// front peuvent afficher chacune la même réduction, alors que le solde ne la
// porte qu'une fois. Le débit est donc plafonné au solde réellement disponible
// au moment de la confirmation, et l'écart est journalisé. Il est borné au
// cashback lui-même — au plus 1,5 % d'une prestation — et une réduction promise
// puis honorée coûte moins qu'un client débité de son cashback pour rien.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ce qui doit rester à la charge de la carte, en euros.
 *
 * Stripe refuse les paiements en dessous de 0,50 € et `stripe-intent` impose
 * déjà un minimum d'un euro. Le cashback ne peut donc pas régler la totalité
 * d'une prestation : il en règle une part, et le reste passe par la carte.
 */
export const RESTE_A_PAYER_MIN = 1;

/** Arrondi au centime, sans jamais faire apparaître un centime de plus. */
const auCentimeInferieur = (x) => Math.floor((Number(x) || 0) * 100) / 100;

/**
 * Réduction applicable à une prestation, en euros.
 *
 * @param {number} solde         `profiles.cashback_balance`
 * @param {number} montantTotal  prix de la prestation, frais compris
 * @returns {number} 0 si rien n'est imputable
 *
 * Bornée par le solde, et par ce qui peut être retiré sans descendre le
 * paiement sous le minimum. Arrondie au centime INFÉRIEUR : une réduction
 * arrondie vers le haut consommerait un centime de cashback que le client n'a
 * pas, et le solde partirait en négatif.
 */
export function reductionCashback(solde, montantTotal) {
  const dispo = Number(solde) || 0;
  const total = Number(montantTotal) || 0;
  if (!(dispo > 0) || !(total > 0)) return 0;

  const imputableMax = total - RESTE_A_PAYER_MIN;
  if (!(imputableMax > 0)) return 0;

  return Math.max(0, auCentimeInferieur(Math.min(dispo, imputableMax)));
}

/**
 * Ce que la carte a réellement supporté, en euros.
 *
 * C'est le plafond de tout remboursement : Stripe refuse de rendre plus que ce
 * qu'il a prélevé, et un refus survenant APRÈS l'annulation d'une prestation
 * laisserait le client sans prestation et sans argent.
 */
export function montantCharge(mission) {
  const total = Number(mission?.montant_total || 0);
  const cb    = Number(mission?.cashback_applique || 0);
  return Math.max(0, Math.round((total - cb) * 100) / 100);
}

/**
 * Complète une prestation dont le `select` de l'appelant a omis les colonnes
 * de cashback.
 *
 * Une douzaine de requêtes lisent `missions` pour rembourser ou annuler. Exiger
 * de chacune qu'elle pense à deux colonnes de plus, c'est accepter qu'une
 * l'oublie — et l'oubli serait SILENCIEUX : un cashback jamais restitué, ou un
 * remboursement non plafonné que Stripe refuse après coup. Les helpers vont
 * donc chercher ce qui leur manque plutôt que de faire confiance à l'appelant.
 *
 * `undefined` signifie « colonne absente du select ». `null` et `0` sont des
 * valeurs lues, et n'entraînent aucune relecture.
 */
async function completerCashback(mission, supabaseUrl, headers) {
  if (!mission?.id) return mission;
  if (mission.cashback_applique !== undefined && mission.cashback_debite !== undefined) return mission;
  if (!supabaseUrl || !headers) return mission;

  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/missions?id=eq.${mission.id}&select=cashback_applique,cashback_debite`,
      { headers }
    );
    const d = await r.json().catch(() => null);
    const ligne = Array.isArray(d) && d[0];
    if (!ligne) {
      // Colonnes absentes = migration non appliquée. PostgREST refuse alors
      // toute la requête. On dégrade vers « aucun cashback » plutôt que de
      // bloquer un remboursement, mais cela doit se voir : sans ce message, un
      // plafond de remboursement disparaîtrait en silence.
      console.error(`[cashback] colonnes absentes sur ${mission.id} — migration `
        + `2026-08-17_cashback_en_reduction.sql non appliquée ? Traité comme sans cashback.`);
      return mission;
    }
    return { ...mission, ...ligne };
  } catch (e) {
    console.error(`[cashback] colonnes illisibles sur ${mission.id} :`, e.message);
    return mission;
  }
}

/**
 * Plafonne un remboursement partiel à ce qui RESTE remboursable.
 *
 * @param {number|null} centimes  montant voulu, ou null pour « la totalité »
 * @returns {number|null} le même, ou le plafond s'il est dépassé
 *
 * `null` traverse sans changement : un remboursement sans montant rend
 * exactement ce que Stripe peut encore rendre, il est donc déjà juste.
 *
 * Deux plafonds, le plus bas l'emporte :
 *  1. ce que la carte a supporté (prix moins cashback) ;
 *  2. ce que Stripe peut ENCORE rendre sur ce paiement — encaissé moins déjà
 *     remboursé. Le premier ne voyait qu'un remboursement à la fois : une
 *     réduction pour décalage puis un litige, chacun sous le plafond, pouvaient
 *     ensemble le dépasser, et Stripe refusait le second (06/10/2026).
 *     Stripe muet : on garde le premier, comme avant.
 */
export async function plafonnerRemboursement(centimes, mission, supabaseUrl, headers) {
  if (centimes === null || centimes === undefined) return centimes;
  const m = await completerCashback(mission, supabaseUrl, headers);
  const voulu = Math.round(Number(centimes) || 0);
  let plafond = Math.round(montantCharge(m) * 100);
  let raison = `${Number(m?.cashback_applique || 0).toFixed(2)} € avaient été réglés en cashback`;

  const reste = await resteRemboursable(m, supabaseUrl, headers);
  if (reste !== null && reste < plafond) {
    plafond = reste;
    raison = `il ne reste que ${(reste / 100).toFixed(2)} € remboursables sur ce paiement (remboursements antérieurs)`;
  }
  if (voulu <= plafond) return voulu;

  console.warn(`[cashback] remboursement ramené de ${voulu} c à ${plafond} c sur ${m?.id} — ${raison}.`);
  return plafond;
}

/**
 * Centimes encore remboursables sur le paiement de la prestation, d'après
 * Stripe (encaissé − déjà remboursé). null si on ne peut pas le savoir —
 * paiement absent ou non Stripe, clé absente, Stripe muet : l'appelant garde
 * alors son plafond.
 */
async function resteRemboursable(mission, supabaseUrl, headers) {
  const cle = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
  if (!cle || !mission?.id) return null;
  let intent = mission.stripe_payment_intent;
  if (intent === undefined) {
    try {
      const r = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${mission.id}&select=stripe_payment_intent&limit=1`, { headers });
      const l = await r.json().catch(() => null);
      intent = r.ok && Array.isArray(l) && l[0] ? l[0].stripe_payment_intent : null;
    } catch (e) {
      console.error(`[cashback] paiement de ${mission.id} illisible :`, e.message);
      return null;
    }
  }
  if (typeof intent !== "string" || !intent.startsWith("pi_")) return null;
  try {
    const r = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(intent)}?expand[]=latest_charge`,
      { headers: { "Authorization": `Bearer ${cle}` } });
    const pi = await r.json().catch(() => null);
    const charge = pi?.latest_charge;
    if (!r.ok || !charge || typeof charge !== "object") {
      console.warn(`[cashback] paiement ${intent} illisible chez Stripe (${r.status}) — plafond de la prestation seul.`);
      return null;
    }
    const encaisse = Number(charge.amount_captured ?? charge.amount ?? 0);
    const rendu = Number(charge.amount_refunded || 0);
    return Math.max(0, Math.round(encaisse - rendu));
  } catch (e) {
    console.warn(`[cashback] paiement ${intent} injoignable chez Stripe — plafond de la prestation seul :`, e.message);
    return null;
  }
}

/**
 * Débite le cashback effectivement consommé par une prestation payée.
 *
 * Appelée aux deux seuls endroits qui constatent un paiement abouti :
 * `assign_after_payment` et le webhook Stripe. Les deux peuvent traiter la même
 * prestation — d'où le filtre sur `cashback_debite`, qui rend le second appel
 * sans effet.
 *
 * Ne lève jamais : le paiement a eu lieu, la prestation doit suivre. Un échec
 * de débit laisse un cashback non consommé, ce qui est un manque à gagner pour
 * ALANE, jamais une perte pour le client.
 *
 * @returns {{debite:number, ok:boolean}}
 */
export async function debiterCashback(missionBrute, supabaseUrl, headers) {
  const mission = await completerCashback(missionBrute, supabaseUrl, headers);
  const prevu = Number(mission?.cashback_applique || 0);
  if (!(prevu > 0) || mission?.cashback_debite || !mission?.client_id) {
    return { debite: 0, ok: true };
  }

  // D'abord la fonction de la base, qui réserve, débite et note en UNE
  // transaction (migration 2026-10-05_cashback_debit_atomique). Les trois
  // écritures ci-dessous sont séparées : une coupure entre la réservation et le
  // débit laissait la prestation « débitée » sans débit — et une annulation
  // rendait ensuite un cashback jamais pris (relecture du 05/10/2026).
  // Fonction absente (migration non passée) ou en erreur : le chemin
  // ci-dessous, inchangé. Les deux respectent le même drapeau sous verrou.
  const atomique = await debiterParLaBase(mission, prevu, supabaseUrl, headers);
  if (atomique) return atomique;

  // La prestation est d'abord RÉSERVÉE pour le débit : écriture conditionnée à
  // « pas encore débitée ». Le drapeau n'était posé qu'APRÈS le débit du solde :
  // le webhook et `assign_after_payment`, arrivés à moins d'une seconde
  // d'intervalle, lisaient tous deux « pas débitée » et débitaient chacun la
  // réduction — le client la perdait deux fois (relecture du 04/10/2026). Le
  // second appel trouve désormais la prestation déjà prise et s'arrête. Toute
  // sortie sans débit rend la réservation.
  const prise = await fetch(
    `${supabaseUrl}/rest/v1/missions?id=eq.${mission.id}&or=(cashback_debite.is.null,cashback_debite.eq.false)`,
    { method: "PATCH", headers: { ...headers, "Prefer": "return=representation" }, body: JSON.stringify({ cashback_debite: true }) }
  ).catch(e => { console.error(`[cashback] réservation du débit impossible sur ${mission.id} :`, e.message); return null; });
  const prises = prise ? await prise.json().catch(() => null) : null;
  if (!prise || !prise.ok || !Array.isArray(prises)) {
    console.error(`[cashback] réservation du débit refusée sur ${mission.id} (${prise?.status}) — débit non tenté.`);
    return { debite: 0, ok: false };
  }
  if (prises.length === 0) return { debite: 0, ok: true }; // déjà débité par l'autre chemin
  const rendre = async () => {
    const r = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${mission.id}`, {
      method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" }, body: JSON.stringify({ cashback_debite: false }),
    }).catch(e => { console.error(`[cashback] réservation non rendue sur ${mission.id} :`, e.message); return null; });
    if (r && !r.ok) console.error(`[cashback] réservation non rendue sur ${mission.id} (${r.status}) : la prestation paraît débitée sans l'être.`);
  };

  try {
    // Jusqu'à trois tentatives : la prestation est réservée, et l'autre chemin
    // (webhook ou `assign_after_payment`), qui la trouve prise, s'arrête pour de
    // bon. Un compare-and-swap manqué une seule fois — un autre cashback crédité
    // entre la lecture et l'écriture — laissait donc le solde intact pour
    // toujours, la réduction consommée sans être débitée (relecture du 05/10/2026).
    let debit = 0, nouveau = 0;
    for (let essai = 1; ; essai++) {
      const pr = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${mission.client_id}&select=cashback_balance`,
        { headers }
      );
      const pd = await pr.json().catch(() => null);
      // Solde illisible : on ne débite ni ne marque rien. Lu comme 0, il faisait
      // réécrire `cashback_applique` à 0 alors que la carte avait payé le prix
      // réduit : le plafond de remboursement dépassait alors ce que la carte
      // avait supporté, et Stripe refusait le remboursement APRÈS l'annulation
      // (relecture du 29/09/2026).
      if (!pr.ok || !Array.isArray(pd) || !pd[0]) {
        console.error(`[cashback] solde illisible (${pr.status}) — débit non tenté sur ${mission.id}.`);
        await rendre();
        return { debite: 0, ok: false };
      }
      const solde = Number(pd[0].cashback_balance || 0);

      // Plafonné au solde réel : voir la course décrite en tête de fichier.
      debit = Math.min(prevu, Math.max(0, solde));
      if (debit < prevu) {
        console.error(`[cashback] solde insuffisant sur ${mission.id} : ${prevu.toFixed(2)} € promis,`
          + ` ${solde.toFixed(2)} € disponibles. La réduction est honorée, l'écart est à la charge d'ALANE.`);
      }
      if (!(debit > 0)) {
        // Rien à débiter : la prestation n'est PAS marquée débitée, pour qu'aucune
        // restitution ne rende un cashback jamais pris. `cashback_applique` reste
        // ce que la carte n'a pas payé : c'est lui qui borne les remboursements.
        await rendre();
        return { debite: 0, ok: true };
      }

      nouveau = Math.round((solde - debit) * 100) / 100;
      // Compare-and-swap sur le solde lu : un crédit concurrent — le cashback
      // d'une autre prestation validée entre-temps — fait échouer le filtre
      // plutôt que d'écraser sa valeur. On relit alors, et on recommence.
      const up = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${mission.client_id}&cashback_balance=eq.${solde}`,
        {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=representation" },
          body: JSON.stringify({ cashback_balance: nouveau }),
        }
      );
      const upData = await up.json().catch(() => []);
      if (up.ok && Array.isArray(upData) && upData.length > 0) break;
      if (!up.ok || essai >= 3) {
        console.error(`[cashback] débit de ${debit.toFixed(2)} € refusé sur ${mission.id}`
          + ` (${up.status}, essai ${essai}) — solde modifié entre la lecture et l'écriture. Non consommé.`);
        await rendre();
        return { debite: 0, ok: false };
      }
    }

    await marquerDebite(mission, supabaseUrl, headers, debit);
    console.log(`[cashback] ${debit.toFixed(2)} € consommés sur ${mission.id}, solde ${nouveau.toFixed(2)} €`);
    return { debite: debit, ok: true };
  } catch (e) {
    console.error(`[cashback] débit impossible sur ${mission?.id} :`, e.message);
    await rendre();
    return { debite: 0, ok: false };
  }
}

// Le débit par `debiter_cashback_mission`. Renvoie le résultat, ou null pour
// laisser le chemin en trois écritures prendre le relais.
async function debiterParLaBase(mission, prevu, supabaseUrl, headers) {
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/debiter_cashback_mission`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ p_mission_id: mission.id }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      // 404 / PGRST202 : migration non passée — attendu tant qu'elle ne l'est pas.
      if (r.status === 404 || txt.includes("PGRST202")) {
        console.warn("[cashback] debiter_cashback_mission absente — débit en trois écritures."
          + " Passer la migration 2026-10-05_cashback_debit_atomique.sql.");
      } else {
        console.error(`[cashback] debiter_cashback_mission en erreur (${r.status}) sur ${mission.id} — débit en trois écritures :`, txt.slice(0, 200));
      }
      return null;
    }
    const lignes = await r.json().catch(() => null);
    const l = Array.isArray(lignes) ? lignes[0] : lignes;
    if (!l?.etat) {
      console.error(`[cashback] réponse illisible de debiter_cashback_mission sur ${mission.id} — débit en trois écritures.`);
      return null;
    }
    const debit = Number(l.debite || 0);
    if (l.etat === "debite") {
      if (debit < prevu) {
        console.error(`[cashback] solde insuffisant sur ${mission.id} : ${prevu.toFixed(2)} € promis,`
          + ` ${debit.toFixed(2)} € débités. La réduction est honorée, l'écart est à la charge d'ALANE.`);
      }
      console.log(`[cashback] ${debit.toFixed(2)} € consommés sur ${mission.id}, solde ${Number(l.solde).toFixed(2)} €`);
      return { debite: debit, ok: true };
    }
    if (l.etat === "solde_nul") {
      console.error(`[cashback] solde insuffisant sur ${mission.id} : ${prevu.toFixed(2)} € promis, rien de disponible.`
        + " La réduction est honorée, l'écart est à la charge d'ALANE.");
    }
    if (l.etat === "profil_introuvable" || l.etat === "introuvable") {
      console.error(`[cashback] ${l.etat} pour ${mission.id} — rien débité.`);
      return { debite: 0, ok: false };
    }
    return { debite: 0, ok: true }; // deja_debite, rien, solde_nul
  } catch (e) {
    console.error(`[cashback] debiter_cashback_mission injoignable sur ${mission.id} — débit en trois écritures :`, e.message);
    return null;
  }
}

/**
 * Marque la prestation comme ayant consommé son cashback.
 *
 * `cashback_applique` n'est JAMAIS réécrit ici : il porte ce que la carte n'a
 * pas payé, et c'est lui qui borne les remboursements (montant_total −
 * cashback_applique = ce que Stripe peut rendre). Le réécrire à la baisse
 * quand le débit était plafonné faisait dépasser ce plafond, et Stripe
 * refusait le remboursement après l'annulation (relecture du 29/09/2026).
 * Un débit plafonné reste signalé dans les journaux par debiterCashback().
 */
async function marquerDebite(mission, supabaseUrl, headers, debit) {
  try {
    const corps = { cashback_debite: true };
    const r = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${mission.id}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify(corps),
    });
    // Écriture qui suit un mouvement d'argent : son résultat se vérifie.
    // Un refus de PostgREST résout normalement, il ne lève pas (CLAUDE.md).
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.error(`[cashback] marquage du débit refusé sur ${mission.id} :`, txt.slice(0, 200));
      return;
    }
    // Ce qui a RÉELLEMENT quitté le solde, que la restitution rendra — et non
    // `cashback_applique`, la réduction promise. Les deux diffèrent quand le
    // solde ne suffisait plus (deux réservations simultanées) : rendre la
    // réduction promise créditait un cashback jamais pris (relecture du
    // 30/09/2026). Écrit à part : sans la migration
    // 2026-09-30_cashback_montant_debite, PostgREST refuserait tout le marquage.
    const m = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${mission.id}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ cashback_debite_montant: debit }),
    });
    if (!m.ok) console.error(`[cashback] montant débité (${Number(debit).toFixed(2)} €) non noté sur ${mission.id} (${m.status}) — une restitution rendrait la réduction promise.`);
  } catch (e) {
    console.error(`[cashback] marquage du débit impossible sur ${mission.id} :`, e.message);
  }
}

/**
 * Ce que la restitution doit rendre : le montant réellement débité, borné par
 * la réduction. Illisible (colonne pas encore créée, ligne antérieure au
 * 30/09/2026) → la réduction, comme avant : c'est le cas normal, où les deux
 * sont égaux.
 */
async function montantARendre(missionId, reduction, supabaseUrl, headers) {
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${missionId}&select=cashback_debite_montant`, { headers });
    const d = await r.json().catch(() => null);
    const v = Array.isArray(d) && d[0] ? Number(d[0].cashback_debite_montant) : NaN;
    if (r.ok && Array.isArray(d) && d[0] && d[0].cashback_debite_montant !== null && Number.isFinite(v)) {
      return Math.max(0, Math.min(reduction, v));
    }
  } catch (e) {
    console.error(`[cashback] montant débité illisible sur ${missionId} :`, e.message);
  }
  return reduction;
}

/**
 * La prestation a-t-elle démarré ? Relu en base, jamais pris chez l'appelant :
 * c'est lui qui décide si le cashback est rendu.
 *
 * Démarrée = pointage enregistré (`started_at`), ou prestation déjà réalisée
 * (`completed`, `closed`). Illisible → réputée démarrée : on ne rend pas un
 * avantage sans pouvoir prouver qu'il n'a pas été consommé.
 */
async function prestationDemarree(missionId, supabaseUrl, headers) {
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${missionId}&select=started_at,status`, { headers });
    const d = await r.json().catch(() => null);
    const ligne = Array.isArray(d) && d[0];
    if (!r.ok || !ligne) {
      console.error(`[cashback] démarrage illisible sur ${missionId} (${r.status}) — réputée démarrée, rien rendu.`);
      return true;
    }
    return !!ligne.started_at || ["completed", "closed"].includes(ligne.status);
  } catch (e) {
    console.error(`[cashback] démarrage illisible sur ${missionId} :`, e.message, "— réputée démarrée, rien rendu.");
    return true;
  }
}

/**
 * Restitue le cashback consommé par une prestation annulée AVANT son début.
 *
 * Règle d'Alexandre (29/09/2026) : le cashback n'est rendu que si la
 * prestation est annulée en entier, avant d'avoir démarré — par le client, le
 * prestataire, ALANE ou faute de prestataire. Une fois la prestation démarrée,
 * il est consommé : une interruption, un remboursement partiel ou un litige ne
 * le rendent pas. La règle vit ici, et non chez chaque appelant : une douzaine
 * de chemins remboursent, et en oublier un rendrait le cashback en silence.
 *
 * Ne lève jamais : le remboursement a déjà eu lieu quand on arrive ici, et une
 * exception ferait croire à son échec.
 */
export async function restituerCashback(missionBrute, supabaseUrl, headers, motif = "remboursement") {
  const mission = await completerCashback(missionBrute, supabaseUrl, headers);
  let montant = Number(mission?.cashback_applique || 0);
  if (!(montant > 0) || !mission?.cashback_debite || !mission?.client_id) return { rendu: 0 };
  if (await prestationDemarree(mission.id, supabaseUrl, headers)) {
    console.log(`[cashback/${motif}] prestation ${mission.id} déjà démarrée — `
      + `${montant.toFixed(2)} € de cashback consommés, non rendus.`);
    return { rendu: 0, demarree: true };
  }

  // 1. On PREND la restitution avant de créditer : écriture conditionnelle sur
  //    `cashback_debite`, qui ne réussit qu'une fois. Le crédit venait d'abord,
  //    le marquage ensuite : l'expiration côté application et celle de la
  //    tâche planifiée, qui partagent le même remboursement Stripe, pouvaient
  //    rendre le cashback deux fois (relecture du 29/09/2026).
  //    `cashback_applique` n'est pas touché : il borne les remboursements
  //    (voir marquerDebite).
  try {
    const pris = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${mission.id}&cashback_debite=is.true`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify({ cashback_debite: false }),
    });
    const lignes = await pris.json().catch(() => null);
    if (!pris.ok || !Array.isArray(lignes)) {
      console.error(`[cashback/${motif}] restitution non engagée sur ${mission.id} (${pris.status}) — rien rendu.`);
      return { rendu: 0 };
    }
    if (!lignes.length) return { rendu: 0 }; // déjà rendue par un autre chemin
    montant = await montantARendre(mission.id, montant, supabaseUrl, headers);
    if (!(montant > 0)) return { rendu: 0 };

    // 2. Le crédit. La procédure `increment_cashback` est atomique ; son second
    //    paramètre compte les prestations du mois : aucune ici, c'est un avoir rendu.
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/increment_cashback`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_user_id: mission.client_id, p_delta: montant, p_missions: 0 }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.error(`[cashback/${motif}] restitution de ${montant.toFixed(2)} € refusée sur ${mission.id} :`, txt.slice(0, 200));
      // La restitution reste à faire : le marquage est rétabli pour qu'un
      // passage suivant la reprenne.
      const re = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${mission.id}&cashback_debite=is.false`, {
        method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ cashback_debite: true }),
      }).catch(() => null);
      if (!re?.ok) console.error(`[cashback/${motif}] ⚠️ ${montant.toFixed(2)} € NON rendus au client de ${mission.id}, `
        + "et marquage non rétabli : à créditer à la main (back-office, Ajuster le cashback).");
      return { rendu: 0 };
    }
    console.log(`[cashback/${motif}] ${montant.toFixed(2)} € restitués au client de ${mission.id}`);
    return { rendu: montant };
  } catch (e) {
    console.error(`[cashback/${motif}] restitution impossible sur ${mission.id} :`, e.message);
    return { rendu: 0 };
  }
}
