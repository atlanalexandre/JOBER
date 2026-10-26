// ═══════════════════════════════════════════════════════════════════════════
// Rattrapage des prolongations payées mais jamais appliquées
// ═══════════════════════════════════════════════════════════════════════════
//
// Le client paie des heures supplémentaires (paiement Stripe `type=heures_supp`),
// puis l'application appelle `confirmer_heures_supp`. S'il ferme l'application
// entre les deux, rien ne rattachait le paiement : il était débité, les heures
// n'étaient pas ajoutées, le prestataire n'était pas payé pour elles — et
// cron-abandon écarte délibérément ces paiements (relecture du 23/10/2026).
//
// Toutes les 30 minutes, cron-abandon appelle `rattraperProlongations()` :
//   - un paiement abouti depuis plus de 15 minutes, et pas encore rattaché,
//     est appliqué par la MÊME fonction que l'application
//     (`appliquerHeuresSupp`), avec les mêmes contrôles ;
//   - s'il ne peut plus l'être (prolongation retirée, prestation close) ET
//     qu'il n'a de façon certaine jamais été appliqué, il est remboursé ;
//   - dans le doute, il n'est ni appliqué ni remboursé : l'équipe est prévenue
//     par un ticket. On ne rembourse jamais sur une supposition.
//
// « Jamais appliqué, de façon certaine » : chaque prolongation appliquée fait
// avancer le compteur `extra_hours_appliquees + heures_ajoutees_total`, et le
// paiement porte la valeur de ce compteur à sa création (`deja_appliquees`).
// Compteur inchangé ⇒ ce paiement n'a rien appliqué. Le seul identifiant
// `extra_hours_payment_intent` ne suffit pas : une prolongation suivante
// l'écrase.
// ═══════════════════════════════════════════════════════════════════════════
import { appliquerHeuresSupp } from "./missions.js";
import { notifier } from "./_push.js";
import { euros } from "./_email.js";

export const DELAI_AVANT_RATTRAPAGE_MS = 15 * 60 * 1000;
const FENETRE_S = 3 * 24 * 3600;

const compteur = (m) => String(Math.round((Number(m.extra_hours_appliquees || 0) + Number(m.heures_ajoutees_total || 0)) * 100) / 100);

/** Le paiement est-il déjà rattaché à la prestation ? */
export function dejaRattache(m, piId) {
  if (m.extra_hours_payment_intent === piId) return true;
  const detail = Array.isArray(m.heures_ajoutees_detail) ? m.heures_ajoutees_detail : [];
  return detail.some(l => l?.paiement === piId);
}

/**
 * Que faire de ce paiement ? « appliquer », « rien » ou « signaler ».
 * Fonction pure : `m` est la prestation lue, `pi` le paiement Stripe.
 */
export function decisionRattrapage(m, pi, maintenantMs = Date.now()) {
  // Prestation absente de CETTE base : la production et la recette partagent le
  // même compte Stripe de test, et chacune voit les paiements de l'autre. Rien
  // à faire ici — c'est l'autre base qui le traite.
  if (!m) return "rien";
  if ((pi.created || 0) * 1000 > maintenantMs - DELAI_AVANT_RATTRAPAGE_MS) return "rien"; // l'application a encore la main
  if (pi.latest_charge?.refunded || Number(pi.latest_charge?.amount_refunded || 0) > 0) return "rien";
  if (dejaRattache(m, pi.id)) return "rien";
  // Paiement antérieur au repère : on ne sait pas trancher.
  if (pi.metadata?.deja_appliquees === undefined) return "signaler";
  // Le compteur a bougé depuis le paiement : une prolongation a été appliquée —
  // peut-être celle-ci, peut-être une autre réglée deux fois. Un humain tranche.
  if (compteur(m) !== pi.metadata.deja_appliquees) return "signaler";
  return "appliquer";
}

async function lirePaiements(cleStripe, depuisS) {
  const q = encodeURIComponent(`metadata['type']:'heures_supp' AND status:'succeeded' AND created>${depuisS}`);
  const r = await fetch(`https://api.stripe.com/v1/payment_intents/search?query=${q}&limit=100&expand[]=data.latest_charge`,
    { headers: { "Authorization": `Bearer ${cleStripe}` } });
  const d = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(d?.data)) throw new Error(`recherche Stripe refusée (${r.status})`);
  return d.data;
}

async function signaler(pi, m, SUPABASE_URL, headers, raison) {
  const client = pi.metadata?.client || m?.client_id;
  if (!client) {
    console.error(`[rattrapage heures supp] ⚠️ ${pi.id} : ${raison} — aucun client pour le ticket, à traiter à la main.`);
    return;
  }
  // Un seul ticket par paiement.
  const dj = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets?subject=like.*${encodeURIComponent(pi.id)}*&select=id&limit=1`, { headers });
  const deja = dj.ok ? await dj.json().catch(() => null) : null;
  if (Array.isArray(deja) && deja.length) return;
  const t = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets`, {
    method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({
      subject: `[Interne] Prolongation payée non appliquée — ${euros((pi.amount_received || 0) / 100)} — ${pi.id}`,
      message: `Paiement de prolongation ${pi.id} (prestation ${pi.metadata?.mission || "?"}) : ${raison}. `
        + "À vérifier dans Stripe et sur la prestation : appliquer à la main, ou rembourser.",
      user_id: client, status: "open",
    }),
  });
  if (!t.ok) console.error(`[rattrapage heures supp] ⚠️ ${pi.id} : ticket NON créé (${t.status}) — ${raison}.`);
}

async function rembourser(pi, cleStripe) {
  // Même clé que `appliquerHeuresSupp` : jamais deux remboursements.
  const r = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: { "Authorization": `Bearer ${cleStripe}`, "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `refund-heures-supp-${pi.id}` },
    body: new URLSearchParams({ payment_intent: pi.id, reason: "requested_by_customer" }).toString(),
  });
  const d = await r.json().catch(() => null);
  return !!(d?.id || d?.error?.code === "charge_already_refunded");
}

export async function rattraperProlongations({ SUPABASE_URL, headers, cleStripe, maintenantMs = Date.now() }) {
  const bilan = { appliquees: 0, remboursees: 0, signalees: 0 };
  if (!cleStripe) return bilan;
  const paiements = await lirePaiements(cleStripe, Math.floor(maintenantMs / 1000) - FENETRE_S);
  for (const pi of paiements) {
    const missionId = pi.metadata?.mission;
    if (!missionId) continue;
    let m;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}`
        + "&select=id,client_id,status,extra_hours_payment_intent,extra_hours_appliquees,heures_ajoutees_total,heures_ajoutees_detail", { headers });
      const lignes = r.ok ? await r.json().catch(() => null) : null;
      if (!Array.isArray(lignes)) { console.error(`[rattrapage heures supp] ${pi.id} : prestation illisible (${r.status}) — au prochain passage.`); continue; }
      m = lignes[0] || null;
    } catch (e) {
      console.error(`[rattrapage heures supp] ${pi.id} : prestation illisible — au prochain passage :`, e.message);
      continue;
    }
    const decision = decisionRattrapage(m, pi, maintenantMs);
    if (decision === "rien") continue;
    if (decision === "signaler") {
      await signaler(pi, m, SUPABASE_URL, headers, m ? "rattachement incertain" : "prestation introuvable");
      bilan.signalees++;
      continue;
    }
    const resultat = await appliquerHeuresSupp({ missionId, paymentIntent: pi.id, clientId: pi.metadata?.client, SUPABASE_URL, headers });
    if (resultat.code === 200) {
      bilan.appliquees++;
      console.error(`[rattrapage heures supp] ${pi.id} appliqué à ${missionId} — l'application n'avait pas confirmé.`);
      continue;
    }
    if (resultat.code >= 500) continue; // panne passagère : au prochain passage
    // Plus applicable (prolongation retirée, prestation close, montant) et
    // jamais appliqué — le compteur l'atteste : le client est remboursé.
    if (await rembourser(pi, cleStripe)) {
      bilan.remboursees++;
      console.error(`[rattrapage heures supp] ${pi.id} remboursé : ${resultat.corps?.error || resultat.code}.`);
      if (m.client_id) {
        await notifier({ user_id: m.client_id, type: "mission", ref_id: missionId, title: "Prolongation remboursée",
          body: `Les heures supplémentaires réglées (${euros((pi.amount_received || 0) / 100)}) n'ont pas pu être ajoutées à votre prestation : vous êtes intégralement remboursé.` },
        SUPABASE_URL, headers).catch(e => console.error("[rattrapage heures supp] notification non envoyée :", e.message));
      }
    } else {
      await signaler(pi, m, SUPABASE_URL, headers, `non applicable (${resultat.corps?.error || resultat.code}) et remboursement refusé`);
      bilan.signalees++;
    }
  }
  return bilan;
}
