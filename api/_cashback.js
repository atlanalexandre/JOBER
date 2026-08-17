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
    const d = await r.json().catch(() => []);
    const ligne = Array.isArray(d) && d[0];
    if (!ligne) return mission;
    return { ...mission, ...ligne };
  } catch (e) {
    console.error(`[cashback] colonnes illisibles sur ${mission.id} :`, e.message);
    return mission;
  }
}

/**
 * Plafonne un remboursement partiel à ce qui a été prélevé.
 *
 * @param {number|null} centimes  montant voulu, ou null pour « la totalité »
 * @returns {number|null} le même, ou le plafond s'il est dépassé
 *
 * `null` traverse sans changement : un remboursement sans montant rend
 * exactement ce que Stripe a encaissé, il est donc déjà juste.
 */
export async function plafonnerRemboursement(centimes, mission, supabaseUrl, headers) {
  if (centimes === null || centimes === undefined) return centimes;
  const m = await completerCashback(mission, supabaseUrl, headers);
  const plafond = Math.round(montantCharge(m) * 100);
  const voulu = Math.round(Number(centimes) || 0);
  if (voulu <= plafond) return voulu;

  console.warn(`[cashback] remboursement ramené de ${voulu} c à ${plafond} c sur ${m?.id}`
    + ` — ${Number(m?.cashback_applique || 0).toFixed(2)} € avaient été réglés en cashback.`);
  return plafond;
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

  try {
    const pr = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${mission.client_id}&select=cashback_balance`,
      { headers }
    );
    const pd = await pr.json().catch(() => []);
    const solde = Number(Array.isArray(pd) && pd[0]?.cashback_balance || 0);

    // Plafonné au solde réel : voir la course décrite en tête de fichier.
    const debit = Math.min(prevu, Math.max(0, solde));
    if (debit < prevu) {
      console.error(`[cashback] solde insuffisant sur ${mission.id} : ${prevu.toFixed(2)} € promis,`
        + ` ${solde.toFixed(2)} € disponibles. La réduction est honorée, l'écart est à la charge d'ALANE.`);
    }
    if (!(debit > 0)) {
      // Rien à débiter, mais la prestation ne doit pas être reprise en boucle.
      await marquerDebite(mission, supabaseUrl, headers, 0);
      return { debite: 0, ok: true };
    }

    const nouveau = Math.round((solde - debit) * 100) / 100;
    // Compare-and-swap sur le solde lu : un crédit concurrent — le cashback
    // d'une autre prestation validée entre-temps — ferait échouer le filtre
    // plutôt que d'écraser sa valeur.
    const up = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${mission.client_id}&cashback_balance=eq.${solde}`,
      {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({ cashback_balance: nouveau }),
      }
    );
    const upData = await up.json().catch(() => []);
    if (!up.ok || !Array.isArray(upData) || upData.length === 0) {
      console.error(`[cashback] débit de ${debit.toFixed(2)} € refusé sur ${mission.id}`
        + ` — solde modifié entre la lecture et l'écriture. Non consommé.`);
      return { debite: 0, ok: false };
    }

    await marquerDebite(mission, supabaseUrl, headers, debit);
    console.log(`[cashback] ${debit.toFixed(2)} € consommés sur ${mission.id}, solde ${nouveau.toFixed(2)} €`);
    return { debite: debit, ok: true };
  } catch (e) {
    console.error(`[cashback] débit impossible sur ${mission?.id} :`, e.message);
    return { debite: 0, ok: false };
  }
}

/**
 * Marque la prestation comme ayant consommé son cashback.
 *
 * Écrit `cashback_debite` ET la valeur réellement débitée : si le débit a été
 * plafonné, `cashback_applique` doit refléter ce qui a bougé, sinon le plafond
 * de remboursement porterait sur un cashback jamais prélevé.
 */
async function marquerDebite(mission, supabaseUrl, headers, debite) {
  try {
    const corps = { cashback_debite: true };
    if (debite !== Number(mission.cashback_applique || 0)) corps.cashback_applique = debite;
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
    }
  } catch (e) {
    console.error(`[cashback] marquage du débit impossible sur ${mission.id} :`, e.message);
  }
}

/**
 * Restitue le cashback consommé par une prestation remboursée.
 *
 * Le client est rendu à l'état d'avant la commande : la carte lui rend ce
 * qu'elle a prélevé, et le cashback lui revient. Sans cela, un client remboursé
 * d'une prestation qui n'a pas eu lieu perdrait un avantage qu'il n'a pas
 * consommé — pour une prestation annulée par le prestataire ou par ALANE, ce
 * serait une double peine.
 *
 * Ne lève jamais : le remboursement a déjà eu lieu quand on arrive ici, et une
 * exception ferait croire à son échec.
 */
export async function restituerCashback(missionBrute, supabaseUrl, headers, motif = "remboursement") {
  const mission = await completerCashback(missionBrute, supabaseUrl, headers);
  const montant = Number(mission?.cashback_applique || 0);
  if (!(montant > 0) || !mission?.cashback_debite || !mission?.client_id) return { rendu: 0 };

  try {
    // La procédure `increment_cashback` crédite de façon atomique. Le second
    // paramètre compte les prestations du mois : on n'en ajoute aucune, il ne
    // s'agit pas d'une prestation réalisée mais d'un avoir rendu.
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/increment_cashback`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_user_id: mission.client_id, p_delta: montant, p_missions: 0 }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.error(`[cashback/${motif}] restitution de ${montant.toFixed(2)} € refusée sur ${mission.id} :`, txt.slice(0, 200));
      return { rendu: 0 };
    }

    const up = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${mission.id}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ cashback_applique: 0, cashback_debite: false }),
    });
    if (!up.ok) {
      // Le client a récupéré son cashback ; la prestation le porte encore.
      // Signalé fort : un second passage le recréditerait.
      const txt = await up.text().catch(() => "");
      console.error(`[cashback/${motif}] ${montant.toFixed(2)} € rendus sur ${mission.id} mais la prestation`
        + ` n'a pas été mise à jour — RISQUE DE DOUBLE RESTITUTION :`, txt.slice(0, 200));
    }
    console.log(`[cashback/${motif}] ${montant.toFixed(2)} € restitués au client de ${mission.id}`);
    return { rendu: montant };
  } catch (e) {
    console.error(`[cashback/${motif}] restitution impossible sur ${mission.id} :`, e.message);
    return { rendu: 0 };
  }
}
