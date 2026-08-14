import { resendBody } from "./_email.js";
import { finPrestationMs, echeanceVersementMs } from "./_temps.js";
import { montantsDeCloture } from "./_cloture.js";
import { repartirCompensation } from "./_creances.js";
import crypto from "crypto";

function verifyBoToken(token, secret) {
  if (!token) return false;
  const parts = token.split(".");
  // Support new format (ts.nonce.sig) and legacy format (ts.sig)
  const tsStr  = parts[0];
  const sig    = parts.length >= 3 ? parts[2] : parts[1];
  const payload = parts.length >= 3 ? `${parts[0]}.${parts[1]}` : parts[0];
  if (!tsStr || !sig) return false;
  const ts = parseInt(tsStr, 10);
  if (Date.now() / 1000 - ts > 86400) return false;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const expBuf = Buffer.from(expected, "hex");
  try {
    const sigBuf = Buffer.from(sig, "hex");
    if (expBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(expBuf, sigBuf);
  } catch { return false; }
}

function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function formatPhone(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[\s.\-()]/g, "");
  if (cleaned.startsWith("+33")) return cleaned;
  if (cleaned.startsWith("0")) return "+33" + cleaned.slice(1);
  return null;
}

// Prépare un texte pour SMS : retire emojis, tirets cadratins et tout caractère
// hors alphabet GSM-7. Deux raisons : les opérateurs les transcodent en « . » ou
// « ? » — le rappel partait avec un point parasite en tête et en fin — et un seul
// caractère hors GSM force l'encodage UCS-2, qui réduit le SMS de 160 à 70
// caractères et double donc le coût d'envoi.
function smsTexte(s, max = 160) {
  return String(s || "")
    // Sélecteurs de variante traités à part : eslint refuse un caractère combinant
    // dans une classe de caractères (no-misleading-character-class), et la règle est
    // en erreur — la CI restait rouge.
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "")
    .replace(/[—–]/g, "-").replace(/[«»""]/g, '"').replace(/['']/g, "'")
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);
}

// Remboursement d'une prestation payée que personne n'a acceptée. Ce cron
// renvoyait la prestation en « open » sans jamais rembourser : le client avait
// payé pour un prestataire précis, personne n'avait répondu, et son argent
// restait bloqué indéfiniment. C'est le chemin réellement emprunté, le
// navigateur du client étant rarement resté ouvert pour déclencher l'expiration
// côté application.
async function rembourserPrestation(mission, supabaseUrl, hdrs) {
  const intent = mission?.stripe_payment_intent;
  if (!intent) return true;
  if (String(intent).startsWith("wallet_")) {
    const montant = Number(mission.montant_total) || 0;
    if (montant <= 0 || !mission.client_id) return true;
    try {
      const pr = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${mission.client_id}&select=prepaid_balance`, { headers: hdrs });
      const pd = await pr.json().catch(() => []);
      const solde = Number(Array.isArray(pd) && pd[0]?.prepaid_balance || 0);
      await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${mission.client_id}`, {
        method: "PATCH", headers: { ...hdrs, "Prefer": "return=minimal" },
        body: JSON.stringify({ prepaid_balance: Math.round((solde + montant) * 100) / 100 }),
      });
      console.log(`[cron/expiration] portefeuille recrédité de ${montant} € — prestation ${mission.id}`);
      return true;
    } catch (e) {
      console.error(`[cron/expiration] recrédit portefeuille échoué — ${mission.id} :`, e.message);
      return false;
    }
  }
  const cle = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
  if (!cle) {
    console.error(`[cron/expiration] STRIPE_SECRET_KEY absente — remboursement NON effectué pour ${mission.id}`);
    return false;
  }
  try {
    const r = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${cle}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Même clé que dans missions.js : une prestation non honorée ne peut être
        // remboursée qu'une fois, quel que soit le chemin qui le déclenche.
        "Idempotency-Key": `refund-nonhonoree-${mission.id}`,
      },
      body: new URLSearchParams({ payment_intent: intent, reason: "requested_by_customer" }).toString(),
    });
    const d = await r.json();
    if (d.id) { console.log(`[cron/expiration] Stripe OK ${d.id} — prestation ${mission.id}`); return true; }
    console.error(`[cron/expiration] Stripe a refusé — ${mission.id} :`, JSON.stringify(d));
    return false;
  } catch (e) {
    console.error(`[cron/expiration] appel Stripe impossible — ${mission.id} :`, e.message);
    return false;
  }
}

function sendSms(apiKey, to, content) {
  const phone = formatPhone(to);
  if (!phone) return Promise.resolve();
  return fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ sender: "ALANE", recipient: phone, content }),
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace("Bearer ", "");
  const cronSecret  = (process.env.CRON_SECRET || "").replace(/\s/g, "");
  const boSecret    = (process.env.BO_SESSION_SECRET || "").replace(/\s/g, "");

  if (!cronSecret) {
    console.error("[cron] CRITIQUE: CRON_SECRET non configuré — accès non authentifié bloqué. Configurez CRON_SECRET dans Vercel.");
  }
  const isCron = cronSecret ? authHeader === `Bearer ${cronSecret}` : false;
  const isBo   = boSecret ? verifyBoToken(token, boSecret) : false;
  if (!isCron && !isBo) return res.status(401).json({ error: "Unauthorized" });

  // Valider le paramètre ?action — seule la valeur "reminders" est acceptée
  const queryAction = req.query?.action;
  if (queryAction !== undefined && queryAction !== "reminders") {
    return res.status(400).json({ error: "Action inconnue — valeur acceptée : reminders" });
  }

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Configuration serveur manquante" });

  const headers = {
    "apikey":        SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
  };

  // ── Expiry des pending_acceptance zombies (toutes routes) ───────
  {
    const nowIso = new Date().toISOString();
    try {
      const zRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?status=eq.pending_acceptance&acceptance_deadline=lt.${nowIso}&select=id,client_id,metier,titre,stripe_payment_intent,montant_total`,
        { headers }
      );
      const zombies = await zRes.json().catch(() => []);
      if (Array.isArray(zombies) && zombies.length) {
        await Promise.all(zombies.map(async z => {
          // Remboursement puis clôture. La prestation était remise en « open »
          // avec le paiement du client toujours bloqué : il avait payé pour un
          // prestataire précis qui n'a pas répondu, et son argent restait
          // immobilisé sur une prestation flottante que personne ne lui avait
          // demandé de remettre en circulation.
          const rembZ = await rembourserPrestation(z, SUPABASE_URL, headers);
          if (!rembZ) console.error(`[cron/expiration] remboursement à reprendre manuellement — prestation ${z.id}`);
          await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${z.id}`, {
            method: "PATCH",
            headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({ status: "refused", prestataire_id: null, broadcast_sent_at: null }),
          }).catch(() => {});
          if (z.client_id) {
            await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
              method: "POST",
              headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify({
                user_id: z.client_id,
                type: "mission",
                title: "Prestataire non disponible",
                body: `Le prestataire n'a pas répondu pour "${z.titre || z.metier || "votre prestation"}".${rembZ ? " Votre paiement a été intégralement remboursé." : " Notre équipe procède au remboursement."} Vous pouvez choisir un autre prestataire.`,
                read: false,
              }),
            }).catch(() => {});
          }
        }));
        console.log(`[cron] expired ${zombies.length} pending_acceptance zombie(s)`);
      }
    } catch (e) { console.error("[cron] zombie expiry error:", e); }
  }

  // ── Clôture et remboursement des prestations dépassées (toutes routes) ──
  //
  // Ce bloc se trouvait après le retour du mode « rappels » : il ne s'exécutait donc
  // qu'au passage mensuel, le 1er du mois. Or c'est lui qui rembourse une prestation
  // payée que personne n'a honorée. Un client dont le prestataire s'était désisté le 2
  // attendait son remboursement jusqu'au 1er du mois suivant — près de trente jours
  // d'argent immobilisé, pour une prestation qui n'a jamais eu lieu.
  //
  // Il tourne désormais à chaque passage, comme l'expiration des zombies au-dessus,
  // soit toutes les deux heures.
  {
    const todayStr = new Date().toISOString().slice(0, 10);
    try {
      const pastRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?status=in.(open,needs_replacement)&date=lt.${todayStr}&select=id,client_id,metier,titre,status,stripe_payment_intent,montant_total`,
        { headers }
      );
      const pastMissions = await pastRes.json().catch(() => []);
      if (Array.isArray(pastMissions) && pastMissions.length) {
        let cloturees = 0, remboursees = 0, differees = 0;
        await Promise.all(pastMissions.map(async m => {
          // Une prestation en « needs_replacement » a DÉJÀ été payée : c'est
          // précisément ce qui la distingue d'une prestation « open » réouverte
          // (voir missions.js, presta_cancel). Elle était pourtant clôturée sans le
          // moindre remboursement, avec une notification annonçant simplement
          // qu'aucun prestataire n'avait été trouvé. Le client avait payé, personne
          // n'était venu, et l'argent restait acquis à la plateforme — en
          // contradiction directe avec le contrat, qui promet un remboursement
          // intégral en l'absence de remplaçant.
          const aPaye = !!m.stripe_payment_intent;
          let rembourse = false;
          if (aPaye) {
            rembourse = await rembourserPrestation(m, SUPABASE_URL, headers);
            if (!rembourse) {
              differees++;
              console.error(`[cron] remboursement impossible pour la prestation ${m.id} — `
                + `clôture différée, elle sera reprise au prochain passage.`);
              return; // ne pas clôturer : la prestation doit rester visible tant que l'argent n'est pas rendu
            }
            remboursees++;
          }
          cloturees++;
          await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
            method: "PATCH",
            headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({ status: rembourse ? "cancelled" : "closed" }),
          }).catch(() => {});
          // Rejeter toutes candidatures en attente
          await fetch(`${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${m.id}&status=eq.pending`, {
            method: "PATCH",
            headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({ status: "rejected" }),
          }).catch(() => {});
          if (m.client_id) {
            await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
              method: "POST",
              headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify({
                user_id: m.client_id,
                type: "mission",
                title: rembourse ? "Prestation annulée — vous êtes remboursé 💶" : "Prestation clôturée automatiquement",
                body: rembourse
                  ? `Votre prestation "${m.titre || m.metier || "prestation"}" n'a pas trouvé de prestataire avant sa date. `
                    + `L'intégralité de votre paiement vous est remboursée, frais de service compris — comptez 5 à 10 jours ouvrés selon votre banque.`
                  : `Votre prestation "${m.titre || m.metier || "prestation"}" n'a pas trouvé de prestataire avant sa date — elle a été clôturée automatiquement.`,
                read: false,
              }),
            }).catch(() => {});
          }
        }));
        // Le journal annonçait la clôture de toutes les prestations examinées, y
        // compris celles qui avaient échoué. Il dit maintenant ce qui s'est
        // réellement passé, remboursements et reports compris.
        console.log(`[cron] prestations dépassées : ${cloturees} clôturée(s) dont `
          + `${remboursees} remboursée(s), ${differees} différée(s) sur ${pastMissions.length} examinée(s)`);
      }
    } catch (e) { console.error("[cron] auto-close past missions error:", e); }
  }

  // ── Versements arrivés à échéance (toutes routes) ──────────────────
  //
  // Le virement au prestataire ne part plus à la validation du client mais à la
  // fermeture de la fenêtre de contestation de quarante-huit heures prévue par
  // l'article 17.1 des CGPS.
  //
  // Ce bloc est placé AVANT le retour anticipé du mode « rappels » : il doit
  // tourner à chaque passage, soit toutes les deux heures, et non une fois par
  // mois. C'est l'erreur qu'avait faite le remboursement des prestations non
  // honorées, découverte le 06/08 — un client attendait son argent jusqu'au
  // 1er du mois suivant.
  {
    const STRIPE_SK_V = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
    if (STRIPE_SK_V) {
      try {
        const maintenant = new Date().toISOString();

        // ── Retenues arrivées à leur terme (CGPS art. 7.4) ──
        //
        // « Elle ne peut excéder quatre-vingt-dix jours [...] Passé ce délai sans
        // réclamation confirmée, les sommes sont versées. » Une retenue qu'on ne
        // lève jamais n'est plus une retenue, c'est une confiscation : elle doit
        // tomber d'elle-même, sans qu'un humain ait à y penser.
        try {
          const levees = await fetch(
            `${SUPABASE_URL}/rest/v1/missions`
            + `?payout_status=eq.held&payout_hold_until=lte.${encodeURIComponent(maintenant)}`
            + `&select=id,prestataire_id`,
            { method: "PATCH", headers: { ...headers, "Prefer": "return=representation" },
              body: JSON.stringify({ payout_status: "pending", payout_hold_reason: null,
                                     payout_hold_at: null, payout_hold_until: null }) }
          );
          if (levees.ok) {
            const rows = await levees.json().catch(() => []);
            for (const r of (Array.isArray(rows) ? rows : [])) {
              console.log(`[versements] retenue levée d'office (90 j) — prestation ${r.id}`);
              if (r.prestataire_id) {
                await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                  method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({ user_id: r.prestataire_id, type: "system",
                    title: "Retenue levée ✅",
                    body: "Le délai de retenue est écoulé sans réclamation confirmée : votre versement est de nouveau programmé.",
                    read: false }),
                }).catch(() => {});
              }
            }
          } else if (levees.status !== 400) {
            console.error(`[versements] levée des retenues impossible (${levees.status})`);
          }
        } catch (e) {
          console.error("[versements] levée des retenues interrompue :", e.message);
        }
        // `status=eq.completed` est le verrou : un litige fait passer la
        // prestation en `disputed` et l'exclut d'office. Une retenue au titre de
        // l'article 7.4 des CGPS suivra le même chemin quand elle sera outillée.
        const aVerser = await fetch(
          `${SUPABASE_URL}/rest/v1/missions`
          + `?payout_status=eq.pending&status=eq.completed`
          + `&payout_due_at=lte.${encodeURIComponent(maintenant)}`
          + `&select=id,prestataire_id,payout_amount`
          + `&limit=200`,
          { headers }
        );
        if (!aVerser.ok) {
          // PostgREST répond 400 (code 42703) sur une colonne inconnue, pas 404.
          // C'est le symptôme d'une migration non appliquée, et il faut qu'il se
          // voie : sans elle, plus aucun prestataire n'est payé.
          const detail = await aVerser.text().catch(() => "");
          console.error(`[versements] lecture impossible (${aVerser.status}) : ${detail.slice(0, 200)}`
            + " — vérifier que la migration 2026-08-12_versement_differe_48h.sql est appliquée.");
        } else {
          const lots = await aVerser.json().catch(() => []);
          const COMMISSION_V = parseFloat(process.env.PLATFORM_COMMISSION_RATE || "0");
          let emis = 0;

          for (const m of (Array.isArray(lots) ? lots : [])) {
            // Verrou atomique : on passe en `processing` AVANT d'appeler Stripe.
            // Deux exécutions concurrentes du cron ne peuvent pas verser deux fois.
            const verrou = await fetch(
              `${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}&payout_status=eq.pending`,
              { method: "PATCH", headers: { ...headers, "Prefer": "return=representation" },
                body: JSON.stringify({ payout_status: "processing" }) }
            );
            const pris = await verrou.json().catch(() => []);
            if (!Array.isArray(pris) || pris.length === 0) continue;

            try {
              const pr = await fetch(
                `${SUPABASE_URL}/rest/v1/profiles?id=eq.${m.prestataire_id}&select=stripe_account_id,stripe_account_status`,
                { headers }
              );
              const pd = await pr.json().catch(() => []);
              const pp = Array.isArray(pd) && pd[0];

              if (!pp?.stripe_account_id || pp.stripe_account_status !== "enabled") {
                // Compte Connect pas encore actif : on repasse en attente. Le
                // webhook `account.updated` rattrapera le versement à l'activation.
                await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
                  method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({ payout_status: "pending" }),
                }).catch(e => console.error(`[versements] retour en attente ${m.id} :`, e.message));
                continue;
              }

              // Le montant a été figé à la clôture par api/missions.js. On ne le
              // recalcule PAS ici : la clôture plafonne les heures quand le
              // client n'a jamais arbitré un décalage d'horaire, sans réécrire
              // `actual_hours`. Refaire le calcul verserait plus que le facturé.
              const part = Number(m.payout_amount ?? 0);
              let net = Math.round(part * (1 - COMMISSION_V) * 100) / 100;

              // ── Compensation d'une créance (CGPS art. 8B.3) ──
              //
              // Retenue au maximum de la MOITIÉ du versement, sur les créances
              // actives et déjà notifiées. Le calcul et ses limites vivent dans
              // api/_creances.js ; ici on ne fait que l'appliquer et l'inscrire.
              let compensation = 0;
              let imputations = [];
              try {
                const cRes = await fetch(
                  `${SUPABASE_URL}/rest/v1/creances_prestataires`
                  + `?prestataire_id=eq.${m.prestataire_id}&statut=eq.active&montant_restant=gt.0`
                  + `&select=id,montant_restant,statut,notifiee_at,created_at&order=created_at`,
                  { headers }
                );
                if (cRes.ok) {
                  const creances = await cRes.json().catch(() => []);
                  if (Array.isArray(creances) && creances.length) {
                    const r = repartirCompensation(net, creances);
                    compensation = r.compensationTotale;
                    imputations = r.imputations;
                    net = r.montantVerse;
                    for (const e of r.ecartees) {
                      console.log(`[versements] créance ${e.creance_id} écartée sur ${m.id} : ${e.motif}`);
                    }
                  }
                } else if (cRes.status !== 400 && cRes.status !== 404) {
                  console.error(`[versements] lecture des créances impossible (${cRes.status}) — prestation ${m.id}`);
                }
              } catch (e) {
                // On verse le montant plein plutôt que de bloquer : ne pas
                // récupérer une créance est rattrapable au versement suivant,
                // ne pas payer un prestataire ne l'est pas.
                console.error(`[versements] compensation non appliquée sur ${m.id} :`, e.message);
              }

              const cents = Math.round(net * 100);

              if (cents < 100) {
                await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
                  method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({ payout_status: "failed" }),
                }).catch(() => {});
                console.error(m.payout_amount == null
                  ? `[versements] montant absent — prestation ${m.id} : payout_amount non renseigné à la clôture, virement à faire à la main`
                  : `[versements] montant trop faible (${cents} c) — prestation ${m.id}`);
                continue;
              }

              const tr = await fetch("https://api.stripe.com/v1/transfers", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${STRIPE_SK_V}`,
                  "Content-Type": "application/x-www-form-urlencoded",
                  // Une prestation ne peut donner lieu qu'à un seul virement, quel
                  // que soit le nombre de passages du cron.
                  "Idempotency-Key": `payout-${m.id}`,
                },
                body: new URLSearchParams({
                  amount: String(cents), currency: "eur", destination: pp.stripe_account_id,
                  "metadata[mission_id]": m.id, "metadata[prestataire_id]": m.prestataire_id,
                }).toString(),
              });
              const td = await tr.json().catch(() => ({}));

              if (tr.ok && td.id) {
                await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
                  method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({
                    payout_status: "transferred", stripe_transfer_id: td.id,
                    ...(compensation > 0 ? { payout_compensation: compensation } : {}),
                  }),
                }).catch(e => console.error(`[versements] statut non écrit ${m.id} :`, e.message));

                // Les imputations s'inscrivent APRÈS le virement : une créance
                // décrémentée sur un virement qui n'est jamais parti serait une
                // somme réclamée deux fois au prestataire.
                for (const imp of imputations) {
                  const dec = await fetch(`${SUPABASE_URL}/rest/v1/creances_prestataires?id=eq.${imp.creance_id}`, {
                    method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                    body: JSON.stringify({
                      montant_restant: imp.restantApres,
                      statut: imp.restantApres <= 0 ? "eteinte" : "active",
                      updated_at: new Date().toISOString(),
                    }),
                  }).catch(() => null);
                  if (!dec || !dec.ok) {
                    console.error(`[versements] créance ${imp.creance_id} NON décrémentée après le virement ${td.id} `
                      + `(${imp.montant} € retenus sur ${m.id}) — à reprendre à la main.`);
                    continue;
                  }
                  await fetch(`${SUPABASE_URL}/rest/v1/compensations_versements`, {
                    method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
                    body: JSON.stringify({ creance_id: imp.creance_id, mission_id: m.id, montant: imp.montant }),
                  }).catch(e => console.error(`[versements] journal de compensation non écrit :`, e.message));
                }

                if (compensation > 0 && m.prestataire_id) {
                  await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                    method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
                    body: JSON.stringify({ user_id: m.prestataire_id, type: "system",
                      title: "Retenue sur votre versement",
                      body: `${compensation.toFixed(2)} € ont été retenus sur ce versement au titre d'une somme due (CGPS art. 8B.3). `
                          + `Montant versé : ${(cents/100).toFixed(2)} €. Le détail figure dans votre espace ; `
                          + `vous pouvez contester à direction@alane.fr sous quinze jours.`,
                      read: false }),
                  }).catch(() => {});
                }

                emis++;
                console.log(`[versements] ${td.id} → ${pp.stripe_account_id} (${(cents/100).toFixed(2)} €`
                  + `${compensation > 0 ? `, ${compensation.toFixed(2)} € compensés` : ""}) — prestation ${m.id}`);
              } else {
                await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
                  method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({ payout_status: "failed" }),
                }).catch(() => {});
                console.error(`[versements] Stripe a refusé — prestation ${m.id} :`, td?.error?.message || tr.status);
              }
            } catch (e) {
              // On ne laisse jamais une prestation coincée en `processing` :
              // elle ne serait plus jamais reprise par aucun passage.
              await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
                method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({ payout_status: "pending" }),
              }).catch(() => {});
              console.error(`[versements] échec sur ${m.id} :`, e.message);
            }
          }
          if (emis) console.log(`[versements] ${emis} virement(s) émis`);
        }
      } catch (e) {
        console.error("[versements] traitement interrompu :", e.message);
      }
    }
  }

  // ── Mode rappels quotidiens ─────────────────────────────────────
  if (req.query?.action === "reminders") {
    const RESEND_API_KEY    = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
    const RESEND_FROM       = process.env.RESEND_FROM || "onboarding@resend.dev";
    const BREVO_API_KEY = (process.env.BREVO_API_KEY || "").replace(/\s/g, "");
    const smsEnabled = !!BREVO_API_KEY;

    try {
      // Charger tous les utilisateurs (paginé) et profils une seule fois
      const userMap = {};
      let usersPage = 1;
      while (true) {
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000&page=${usersPage}`, { headers });
        const uData = await uRes.json();
        const batch = uData.users || [];
        batch.forEach(u => { userMap[u.id] = { email: u.email, meta: u.user_metadata || {} }; });
        if (batch.length < 1000) break;
        usersPage++;
      }
      const profilesRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,prenom,nom`, { headers });
      const profiles  = await profilesRes.json();
      const nameMap   = {};
      (Array.isArray(profiles) ? profiles : []).forEach(p => { nameMap[p.id] = `${p.prenom||""} ${p.nom||""}`.trim(); });

      // ── 1. Rappels de mission pour demain ────────────────────────
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);

      const missionsRes  = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&date=eq.${tomorrowStr}&select=id,client_id,prestataire_id,metier,sector,date,heure_debut,hours,ville,adresse`,
        { headers }
      );
      const missionsData = await missionsRes.json();
      const missions     = Array.isArray(missionsData) ? missionsData : [];

      let sent = 0;
      if (missions.length && RESEND_API_KEY) {
        await Promise.all(missions.map(async (m) => {
          const clientEmail  = userMap[m.client_id]?.email;
          const prestaEmail  = userMap[m.prestataire_id]?.email;
          const clientName   = nameMap[m.client_id] || "Client";
          const prestaName   = nameMap[m.prestataire_id] || "Prestataire";
          const missionInfo  = `${esc(m.metier||"Mission")} · ${esc(m.ville||"")} · ${m.hours}h`;

          const emailBody = (toName, toRole) => `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#0A1628;font-family:system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A1628;padding:32px 0;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0D1B3E;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
<tr><td style="background:linear-gradient(135deg,#7C6FE0,#162547);padding:28px;text-align:center;">
<div style="font-size:40px;margin-bottom:10px;">⏰</div>
<h1 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 6px;">Rappel : prestation demain !</h1>
<p style="color:rgba(255,255,255,0.7);font-size:13px;margin:0;">${missionInfo}</p>
</td></tr>
<tr><td style="padding:28px;">
<p style="color:#F0F0F5;font-size:15px;margin:0 0 16px;">Bonjour <strong>${esc(toName)}</strong>,</p>
<p style="color:#8B8FA8;font-size:14px;line-height:1.7;margin:0 0 20px;">Votre prestation est prévue <strong style="color:#F0B429;">demain</strong>. Voici un rappel des détails :</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#162547;border-radius:12px;padding:16px 20px;border:1px solid rgba(124,111,224,0.2);">
${[
  ["💼 Poste", m.metier||"—"],
  ["📅 Date", tomorrowStr],
  ...(m.heure_debut ? [["🕐 Heure de début", m.heure_debut], ["🕔 Heure de fin", (() => { const [h,min] = m.heure_debut.split(":").map(Number); const e = h*60+min+Math.round(Number(m.hours)*60); return `${String(Math.floor(e/60)%24).padStart(2,"0")}:${String(e%60).padStart(2,"0")}`; })()] ] : [["⏱️ Durée", `${m.hours}h`]]),
  ["📍 Lieu", [m.adresse, m.ville].filter(Boolean).join(", ")||"—"],
  toRole === "client" ? ["👷 Prestataire", prestaName] : ["🏢 Client", clientName],
].map(([l,v])=>`<tr><td style="color:#8B8FA8;font-size:13px;padding:6px 0;">${l}</td><td style="color:#F0F0F5;font-size:13px;font-weight:700;text-align:right;">${esc(String(v))}</td></tr>`).join("")}
</table>
${toRole === "prestataire" ? `
<div style="margin-top:16px;background:#1A2B4A;border-left:4px solid #F0B429;border-radius:0 10px 10px 0;padding:14px 16px;">
  <p style="color:#F0B429;font-size:13px;font-weight:800;margin:0 0 8px;">🚗 Anticipez votre temps de trajet !</p>
  <p style="color:#B0B8CC;font-size:13px;line-height:1.6;margin:0 0 12px;">Calculez votre itinéraire dès maintenant et prévoyez d'arriver <strong style="color:#F0F0F5;">au moins 10 minutes avant l'heure de début</strong>. Un retard impacte votre note et peut limiter votre accès aux prochaines prestations.</p>
  ${(() => { const addr = [m.adresse, m.ville].filter(Boolean).join(", "); return addr ? `<a href="https://www.google.com/maps/dir/?api=1&amp;destination=${encodeURIComponent(addr)}" style="display:inline-block;padding:9px 18px;background:#F0B429;color:#050E20;border-radius:8px;text-decoration:none;font-weight:800;font-size:13px;">📍 Calculer mon itinéraire →</a>` : ""; })()}
</div>` : ""}
${(() => {
  const appUrl = (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr";
  const loc = encodeURIComponent([m.adresse, m.ville].filter(Boolean).join(", ") || "");
  const titleEnc = encodeURIComponent(`Mission ALANE — ${m.metier||"Mission"}`);
  const descEnc  = encodeURIComponent(`Prestation via ALANE. Voir détails : ${appUrl}`);
  const heureDebut = m.heure_debut || "08:00";
  const [hd, md2] = heureDebut.split(":").map(Number);
  const endMin = hd * 60 + md2 + Math.round(Number(m.hours) * 60);
  const heureFin = `${String(Math.floor(endMin/60)%24).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;
  const [y,mo,d] = tomorrowStr.split("-");
  const gcStart = `${y}${mo}${d}T${heureDebut.replace(":","").padEnd(6,"0")}`;
  const gcEnd   = `${y}${mo}${d}T${heureFin.replace(":","").padEnd(6,"0")}`;
  const gcUrl   = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${titleEnc}&dates=${gcStart}/${gcEnd}&details=${descEnc}&location=${loc}`;
  const icsUrl  = `${appUrl}/api/support?ics=1&title=${titleEnc}&date=${tomorrowStr}&start=${encodeURIComponent(heureDebut)}&end=${encodeURIComponent(heureFin)}&location=${loc}&description=${descEnc}`;
  return `<div style="text-align:center;margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
<a href="${gcUrl}" style="display:inline-block;background:#4285F4;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700;font-size:13px;margin:4px;">📅 Google Agenda</a>
<a href="${icsUrl}" style="display:inline-block;background:#555;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700;font-size:13px;margin:4px;">🗓 Apple / Outlook</a>
</div>`;
})()}
<div style="text-align:center;margin-top:16px;"><a href='${(process.env.APP_URL || "").replace(/\s/g, "")||"https://www.alane.fr"}' style="display:inline-block;background:linear-gradient(135deg,#7C6FE0,#5B4FCF);color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:700;font-size:14px;">Voir ma prestation →</a></div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href='${(process.env.APP_URL || "").replace(/\s/g, "")||"https://www.alane.fr"}' style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
</table></td></tr></table></body></html>`;

          const sends = [];
          if (clientEmail) sends.push(
            fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
              body: resendBody({ from: RESEND_FROM, to: [clientEmail], subject: `⏰ Rappel prestation demain — ${m.metier||"Mission"} · ALANE`, html: emailBody(clientName, "client") }),
            }).catch(()=>{})
          );
          if (prestaEmail) sends.push(
            fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
              body: resendBody({ from: RESEND_FROM, to: [prestaEmail], subject: `⏰ Rappel prestation demain — ${m.metier||"Mission"} · ALANE`, html: emailBody(prestaName, "prestataire") }),
            }).catch(()=>{})
          );
          if (smsEnabled) {
            // Deux messages distincts : « Bonne prestation ! » n'a pas de sens pour
            // le client, qui ne réalise pas la prestation mais la reçoit.
            const quoi   = `${m.metier||"Prestation"}${m.ville ? " a " + m.ville : ""}`;
            const quand  = m.heure_debut ? String(m.heure_debut).replace(":", "h") : "";
            const smsPrestataire = smsTexte(`ALANE - Rappel : votre prestation ${quoi} est demain${quand ? " a " + quand : ""}. Bonne prestation ! alane.fr`);
            const smsClientRappel = smsTexte(`ALANE - Rappel : votre prestataire intervient demain${quand ? " a " + quand : ""} pour ${quoi}. alane.fr`);
            const clientPhone = userMap[m.client_id]?.meta?.telephone;
            const prestaPhone = userMap[m.prestataire_id]?.meta?.telephone;
            if (clientPhone) sends.push(sendSms(BREVO_API_KEY, clientPhone, smsClientRappel));
            if (prestaPhone) sends.push(sendSms(BREVO_API_KEY, prestaPhone, smsPrestataire));
          }
          await Promise.all(sends);
          sent += sends.length;
        }));
      }

      // ── 2. Rappels de validation ciblés selon qui n'a pas encore validé ──
      const todayStr = new Date().toISOString().slice(0, 10);
      let validationSent = 0;
      try {
        const pastRes = await fetch(
          `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&date=lt.${todayStr}&select=id,client_id,prestataire_id,metier,sector,date,hours,actual_hours,ville,heure_debut,validation_prestataire,validation_client,last_validation_reminder_at`,
          { headers }
        );
        const pastMissionsRaw = await pastRes.json();
        const now = Date.now();
        const TWELVE_HOURS_MS = 2 * 60 * 60 * 1000; // relance toutes les 2h
        const pastMissions = Array.isArray(pastMissionsRaw) ? pastMissionsRaw.filter(m => {
          if (!m.heure_debut) return true;
          // Conversion heure française → UTC : elle manquait, la relance de
          // validation partait avec une à deux heures de retard.
          const endMs = finPrestationMs({ ...m, started_at: null });
          if (endMs === null || endMs >= now) return false;
          // N-05: skip missions that already got a reminder less than 12h ago
          if (m.last_validation_reminder_at) {
            const lastReminderMs = new Date(m.last_validation_reminder_at).getTime();
            if (!isNaN(lastReminderMs) && now - lastReminderMs < TWELVE_HOURS_MS) return false;
          }
          return true;
        }) : [];
        if (pastMissions.length && RESEND_API_KEY) {
          await Promise.all(pastMissions.map(async (m) => {
            const clientEmail  = userMap[m.client_id]?.email;
            const prestaEmail  = userMap[m.prestataire_id]?.email;
            const clientName   = nameMap[m.client_id]  || "Client";
            const prestaName   = nameMap[m.prestataire_id] || "Prestataire";
            const appUrl       = (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr";
            const missionLabel = `${esc(m.metier||"Mission")} · ${esc(m.ville||"")} · ${m.date}`;

            // Email prestataire : uniquement s'il n'a pas encore confirmé la fin de mission
            const prestaHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#0A1628;font-family:system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A1628;padding:32px 0;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0D1B3E;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
<tr><td style="background:linear-gradient(135deg,#7C6FE0,#162547);padding:28px;text-align:center;">
<div style="font-size:40px;margin-bottom:10px;">📋</div>
<h1 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 6px;">Confirmez la fin de votre prestation</h1>
<p style="color:rgba(255,255,255,0.7);font-size:13px;margin:0;">${missionLabel}</p>
</td></tr>
<tr><td style="padding:28px;">
<p style="color:#F0F0F5;font-size:15px;margin:0 0 16px;">Bonjour <strong>${esc(prestaName)}</strong>,</p>
<p style="color:#8B8FA8;font-size:14px;line-height:1.7;margin:0 0 20px;">Votre prestation du <strong style="color:#A29BFE;">${m.date}</strong> est terminée mais vous n'avez pas encore confirmé la fin de prestation depuis votre espace.<br/><br/>Cette confirmation est <strong style="color:#fff;">indispensable pour déclencher votre paiement</strong>.</p>
<div style="text-align:center;margin-top:20px;">
<a href="${appUrl}" style="display:inline-block;background:#7C6FE0;color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:700;font-size:14px;">Confirmer ma prestation →</a>
</div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href="${appUrl}" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
</table></td></tr></table></body></html>`;

            // Email client : uniquement si le prestataire a déjà confirmé mais le client n'a pas validé
            const clientHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#0A1628;font-family:system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A1628;padding:32px 0;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0D1B3E;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
<tr><td style="background:linear-gradient(135deg,#F0B429,#E09B10);padding:28px;text-align:center;">
<div style="font-size:40px;margin-bottom:10px;">✅</div>
<h1 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 6px;">Validez votre prestation</h1>
<p style="color:rgba(255,255,255,0.8);font-size:13px;margin:0;">${missionLabel}</p>
</td></tr>
<tr><td style="padding:28px;">
<p style="color:#F0F0F5;font-size:15px;margin:0 0 16px;">Bonjour <strong>${esc(clientName)}</strong>,</p>
<p style="color:#8B8FA8;font-size:14px;line-height:1.7;margin:0 0 20px;">Votre prestataire a confirmé la fin de la prestation du <strong style="color:#F0B429;">${m.date}</strong>. Il ne vous reste plus qu'à valider depuis votre espace pour finaliser le paiement et obtenir votre cashback.</p>
<div style="text-align:center;margin-top:20px;">
<a href="${appUrl}" style="display:inline-block;background:#F0B429;color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:700;font-size:14px;">Valider la prestation →</a>
</div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href="${appUrl}" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
</table></td></tr></table></body></html>`;

            const vSends = [];
            // Relance prestataire seulement s'il n'a pas encore confirmé
            if (!m.validation_prestataire && prestaEmail)
              vSends.push(fetch("https://api.resend.com/emails", { method:"POST", headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"}, body: resendBody({ from: RESEND_FROM, to:[prestaEmail], subject:`📋 Confirmez la fin de votre prestation du ${m.date} — ALANE`, html: prestaHtml }) }).catch(()=>{}));
            // Relance client seulement si prestataire a confirmé mais client n'a pas encore validé
            if (m.validation_prestataire && !m.validation_client && clientEmail)
              vSends.push(fetch("https://api.resend.com/emails", { method:"POST", headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"}, body: resendBody({ from: RESEND_FROM, to:[clientEmail], subject:`✅ Validez votre prestation du ${m.date} — ALANE`, html: clientHtml }) }).catch(()=>{}));
            if (smsEnabled) {
              const smsPresta  = smsTexte(`ALANE - Confirmez la fin de votre prestation ${m.metier||"Prestation"} du ${m.date} pour recevoir votre paiement. alane.fr`);
              const smsCashback = smsTexte(`ALANE - Votre prestataire a confirme la prestation du ${m.date}. Validez-la pour obtenir votre cashback. alane.fr`);
              const clientPhone = userMap[m.client_id]?.meta?.telephone;
              const prestaPhone = userMap[m.prestataire_id]?.meta?.telephone;
              if (!m.validation_prestataire && prestaPhone) vSends.push(sendSms(BREVO_API_KEY, prestaPhone, smsPresta));
              if (m.validation_prestataire && !m.validation_client && clientPhone) vSends.push(sendSms(BREVO_API_KEY, clientPhone, smsCashback));
            }
            await Promise.all(vSends);
            validationSent += vSends.length;
            // N-05: stamp last_validation_reminder_at to prevent duplicate sends within 12h
            if (vSends.length > 0) {
              fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
                method: "PATCH",
                headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({ last_validation_reminder_at: new Date().toISOString() }),
              }).catch(() => {});
            }
          }));
        }
      } catch (e) { console.error("cron validation reminders error:", e); }

      // ── 3. Auto-validation après 24h — que le prestataire ait confirmé ou non ─────
      let autoValidated = 0;
      try {
        // DST-safe : soustraire 1 jour calendaire plutôt que 86400000ms
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);

        // On récupère toutes les missions assignées (peu importe validation_prestataire)
        // dont la date est <= hier (filtre large — on affine en JS avec heure_debut + hours)
        const avRes = await fetch(
          `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&date=lte.${yesterdayStr}&select=id,client_id,prestataire_id,hours,actual_hours,tarif_horaire,metier,sector,date,date_debut,date_fin,heure_debut,started_at,montant_total,delay_status,arrival_delay_minutes,validation_prestataire,cashback_credited`,
          { headers }
        );
        const autoMissionsRaw = await avRes.json();

        // Vérifier que 24h se sont effectivement écoulées depuis la FIN de la mission (heure_debut + hours)
        const nowTs = Date.now();
        const autoMissions = Array.isArray(autoMissionsRaw) ? autoMissionsRaw.filter(m => {
          if (!m.date) return true;
          // Formule de fuseau déportée dans _temps.js (règle CLAUDE.md : on ne la
          // recopie plus). Horaire prévu, pas le pointage réel : le délai de 24 h
          // court depuis la fin annoncée au client.
          const missionEndMs = finPrestationMs({ ...m, started_at: null, actual_hours: null });
          return missionEndMs === null || nowTs - missionEndMs >= 24 * 3600000;
        }) : [];

        if (autoMissions.length) {
          // Charger les taux cashback depuis platform_settings
          let CASHBACK_TIERS = [
            { min:0, max:2, rate:0.005 }, { min:3, max:5, rate:0.0075 },
            { min:6, max:9, rate:0.01 }, { min:10, max:999, rate:0.015 },
          ];
          try {
            const cbRes  = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings?key=eq.cashback_rates&select=value`, { headers });
            const cbData = await cbRes.json();
            if (Array.isArray(cbData) && Array.isArray(cbData[0]?.value)) CASHBACK_TIERS = cbData[0].value;
          } catch (e) { console.error("cron cashback_rates fetch error:", e); }

          // Traitement séquentiel pour éviter les écritures concurrentes sur le même client
          for (const m of autoMissions) {
            try {
              // B-05: skip if cashback was already credited (idempotence)
              if (m.cashback_credited) {
                console.log(`cron auto-validate: cashback already credited for mission ${m.id}, skipping`);
                continue;
              }
              // Montants calculés par api/_cloture.js, comme la validation par le
              // client. Ce chemin en tenait sa propre version : elle omettait le
              // nombre de jours (une prestation de cinq jours n'en payait qu'un),
              // écrasait `montant_total` par la seule part horaire — effaçant les
              // frais de service encaissés, donc la trace de ce que le client avait
              // payé — et ignorait le plafonnement des heures en cas de décalage
              // d'horaire jamais arbitré.
              const { jours, partPrestataire, totalClient } = montantsDeCloture(m);
              if (partPrestataire <= 0) {
                console.error(`cron auto-validate: montant nul pour ${m.id} `
                  + `(heures=${m.actual_hours ?? m.hours}, tarif=${m.tarif_horaire}) — non clôturée`);
                continue;
              }
              const mLabel = esc(m.metier || m.sector || "Prestation");
              const appUrl = (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr";

              // Lire le profil client au moment du traitement pour éviter les données périmées
              const cpRes  = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${m.client_id}&select=cashback_balance,missions_completed_month`, { headers });
              const cpData = await cpRes.json();
              const profile = Array.isArray(cpData) && cpData[0] ? cpData[0] : {};
              const missionsThisMonth = (profile.missions_completed_month || 0) + jours;
              const rate = [...CASHBACK_TIERS].reverse().find(t => missionsThisMonth >= t.min)?.rate || 0.01;
              const cashbackEarned = Math.round(partPrestataire * rate * 100) / 100;
              const newBalance = Math.round(((profile.cashback_balance || 0) + cashbackEarned) * 100) / 100;

              // Marquer la mission complétée et cashback crédité (B-05: cashback_credited = idempotence guard)
              const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
                method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({
                  status: "completed", validation_client: true, validation_prestataire: true,
                  montant_total: totalClient, cashback_credited: true,
                  // Ce chemin ne programmait AUCUN virement : la prestation était
                  // clôturée, le prestataire recevait un e-mail lui annonçant un
                  // paiement « sous 3 à 5 jours ouvrés », et rien n'était jamais
                  // émis. Seule la validation explicite par le client payait.
                  payout_status: "pending",
                  payout_amount: partPrestataire,
                  payout_due_at: new Date(echeanceVersementMs(m)).toISOString(),
                }),
              });
              if (!patchRes.ok) {
                console.error(`cron auto-validate: PATCH mission ${m.id} failed`, await patchRes.text());
                continue;
              }

              await Promise.all([
                // Mise à jour atomique du cashback via RPC pour éviter les race conditions
                fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_cashback`, {
                  method: "POST", headers: { ...headers, "Prefer": "return=representation" },
                  body: JSON.stringify({ p_user_id: m.client_id, p_delta: cashbackEarned, p_missions: jours }),
                }).catch(e => console.error("cron cashback update error:", e)),
                // Notification client
                fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                  method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({ user_id: m.client_id, type: "mission", title: "Prestation validée automatiquement ✅", body: `Votre prestation "${mLabel}" a été validée automatiquement (délai 24h dépassé).${cashbackEarned > 0 ? ` Cashback crédité : +${cashbackEarned.toFixed(2)} €` : ""}`, read: false }),
                }).catch(()=>{}),
                // Notification prestataire
                m.prestataire_id && fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                  method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({ user_id: m.prestataire_id, type: "mission", title: "Prestation validée ✅", body: `Votre prestation "${mLabel}" a été validée. Votre paiement de ${partPrestataire.toFixed(2)} € est programmé à la fermeture du délai de 48 h dont le client dispose pour signaler un problème.`, read: false }),
                }).catch(()=>{}),
                // Email prestataire — réutilise userMap déjà chargé
                (async () => {
                  if (!m.prestataire_id || !RESEND_API_KEY) return;
                  const prestaEmail = userMap[m.prestataire_id]?.email;
                  const prestaPrenom = userMap[m.prestataire_id]?.meta?.prenom || nameMap[m.prestataire_id] || "Prestataire";
                  if (!prestaEmail) return;
                  await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
                    body: resendBody({ from: RESEND_FROM, to: [prestaEmail], subject: `Prestation validée — votre paiement est en cours 💰`, html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px"><h2 style="color:#A29BFE;margin:0 0 12px">Prestation validée automatiquement ✅</h2><p>Bonjour ${esc(prestaPrenom)},</p><p>Le délai de validation de 24h étant écoulé, votre prestation <strong>${mLabel}</strong> a été automatiquement validée.</p><p>Votre paiement de <strong style="color:#A29BFE">${partPrestataire.toFixed(2)} €</strong> est programmé le <strong>${new Date(echeanceVersementMs(m)).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long" })}</strong>, à la fermeture du délai de 48 h dont le client dispose pour signaler un problème. Il sera ensuite versé sur votre IBAN sous 1 à 2 jours ouvrés.</p><p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="${appUrl}" style="color:#7C6FE0;">www.alane.fr</a></p></div>` }),
                  }).catch(()=>{});
                })(),
                // Email client — confirmation auto-validation
                (async () => {
                  if (!RESEND_API_KEY) return;
                  const clientEmail = userMap[m.client_id]?.email;
                  const clientPrenom = userMap[m.client_id]?.meta?.prenom || nameMap[m.client_id] || "Client";
                  if (!clientEmail) return;
                  await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
                    body: resendBody({ from: RESEND_FROM, to: [clientEmail], subject: `Prestation validée automatiquement — ALANE`, html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px"><h2 style="color:#F0B429;margin:0 0 12px">Prestation validée ✅</h2><p>Bonjour ${esc(clientPrenom)},</p><p>Votre prestation <strong>${mLabel}</strong> a été automatiquement validée, le délai de confirmation de 24h étant écoulé.</p>${cashbackEarned > 0 ? `<p>Votre cashback de <strong style="color:#F0B429">+${cashbackEarned.toFixed(2)} €</strong> a été crédité sur votre wallet.</p>` : ""}<p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="${appUrl}" style="color:#7C6FE0;">www.alane.fr</a></p></div>` }),
                  }).catch(()=>{});
                })(),
              ]);
              autoValidated++;
            } catch (e) { console.error(`cron auto-validate mission ${m.id} error:`, e); }
          }
        }
      } catch (e) { console.error("cron auto-validation error:", e); }

      // ── 4. Notifications de fin de mission (missions terminées depuis la dernière exécution) ──
      let endNotifSent = 0;
      try {
        const enRes = await fetch(
          `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&end_notif_sent=not.is.true&select=id,client_id,prestataire_id,metier,sector,date,heure_debut,hours,ville,started_at`,
          { headers }
        );
        const enMissions = await enRes.json().catch(() => []);
        if (Array.isArray(enMissions)) {
          const nowMs = Date.now();
          const ended = enMissions.filter(m => {
            // Une prestation n'est terminée que si le prestataire l'a réellement
            // démarrée. Sans started_at, le calcul se faisait sur l'horaire prévu :
            // le client recevait « prestation terminée, validez » alors que
            // personne n'avait déclaré s'être présenté.
            if (m.started_at) {
              return nowMs >= new Date(m.started_at).getTime() + Number(m.hours || 1) * 3600000;
            }
            return false;
          });

          // Prestations dont l'horaire est dépassé sans aucun pointage : on alerte
          // le prestataire, et surtout on ne dit pas au client qu'elle est terminée.
          // Le calcul était recopié ici avec le signe du décalage inversé
          // (`naive - offset` au lieu de `naive + offset`) : l'alerte partait
          // quatre heures trop tard en été. Il passe désormais par _temps.js.
          const sansPointage = enMissions.filter(m => {
            if (m.started_at || !m.date) return false;
            const finMs = finPrestationMs(m);
            return finMs !== null && nowMs >= finMs;
          });
          for (const m of ended) {
            try {
              const mLabel = esc(m.metier || m.sector || "Prestation");
              const appUrl2 = (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr";
              const prestaEmail2 = userMap[m.prestataire_id]?.email;
              const clientEmail2 = userMap[m.client_id]?.email;
              const prestaName2  = nameMap[m.prestataire_id] || "Prestataire";
              const clientName2  = nameMap[m.client_id] || "Client";
              const sends2 = [];
              // In-app notification prestataire
              if (m.prestataire_id)
                sends2.push(fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                  method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({ user_id: m.prestataire_id, type: "mission", title: "Confirmez la fin de votre prestation ✅", body: `Votre prestation "${mLabel}" est terminée. Confirmez depuis votre espace pour déclencher votre paiement.`, read: false }),
                }).catch(() => {}));
              if (RESEND_API_KEY && prestaEmail2)
                sends2.push(fetch("https://api.resend.com/emails", { method:"POST", headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"}, body: resendBody({ from: RESEND_FROM, to:[prestaEmail2], subject:`🎉 Prestation terminée — confirmez pour être payé(e) · ALANE`, html:`<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px"><h2 style="color:#10D98F">Prestation terminée !</h2><p>Bonjour ${esc(prestaName2)},</p><p>Votre prestation <strong>${mLabel}</strong> vient de se terminer. <strong>Confirmez la fin</strong> depuis votre espace ALANE pour déclencher votre paiement.</p><a href="${appUrl2}" style="display:inline-block;background:#10D98F;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:700;margin-top:16px">Confirmer ma prestation →</a><p style="margin-top:24px;color:rgba(255,255,255,0.4);font-size:11px">L'équipe ALANE · <a href="${appUrl2}" style="color:#7C6FE0;">www.alane.fr</a></p></div>` }) }).catch(()=>{}));
              if (smsEnabled && m.prestataire_id) {
                const prestaPhone2 = userMap[m.prestataire_id]?.meta?.telephone;
                if (prestaPhone2) sends2.push(sendSms(BREVO_API_KEY, prestaPhone2, `✅ ALANE - Votre prestation ${mLabel} est terminée. Confirmez depuis l'app pour recevoir votre paiement. — alane.fr`));
              }
              if (RESEND_API_KEY && clientEmail2)
                sends2.push(fetch("https://api.resend.com/emails", { method:"POST", headers:{"Authorization":`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"}, body: resendBody({ from: RESEND_FROM, to:[clientEmail2], subject:`✅ Prestation terminée — validation en attente · ALANE`, html:`<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px"><h2 style="color:#F0B429">Prestation terminée</h2><p>Bonjour ${esc(clientName2)},</p><p>La prestation <strong>${mLabel}</strong> vient de se terminer. Votre prestataire va confirmer la fin depuis son espace. Vous serez notifié(e) pour valider.</p><a href="${appUrl2}" style="display:inline-block;background:#F0B429;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:700;margin-top:16px">Suivre ma prestation →</a><p style="margin-top:24px;color:rgba(255,255,255,0.4);font-size:11px">L'équipe ALANE · <a href="${appUrl2}" style="color:#7C6FE0;">www.alane.fr</a></p></div>` }) }).catch(()=>{}));
              await Promise.all(sends2);
              endNotifSent += sends2.length;
              await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
                method:"PATCH", headers:{ ...headers, "Prefer":"return=minimal" },
                body: JSON.stringify({ end_notif_sent: true }),
              }).catch(()=>{});
            } catch(e) { console.error(`end-notif mission ${m.id}:`, e); }
          }

          // Horaire dépassé sans démarrage : on relance le prestataire, sans
          // jamais annoncer au client une prestation qui n'a pas été pointée.
          // Le drapeau end_notif_sent n'est pas posé : la relance se répétera
          // à chaque passage tant que rien n'est pointé.
          for (const m of sansPointage) {
            try {
              const mLabel2 = esc(m.metier || m.sector || "Prestation");
              if (m.prestataire_id) {
                await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                  method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({
                    user_id: m.prestataire_id,
                    type: "mission",
                    title: "Pointage manquant ⚠️",
                    body: `L'horaire de votre prestation « ${mLabel2} » est dépassé et vous n'avez pas signalé votre arrivée. Ouvrez l'application pour la démarrer, sinon elle ne pourra pas être validée ni payée.`,
                    read: false,
                  }),
                }).catch(() => {});
              }
              if (smsEnabled && m.prestataire_id) {
                const tel = userMap[m.prestataire_id]?.meta?.telephone;
                if (tel) await sendSms(BREVO_API_KEY, tel, smsTexte(`ALANE - Pointage manquant : votre prestation ${mLabel2} devait avoir commence. Signalez votre arrivee dans l'application, sans quoi elle ne pourra pas etre payee. alane.fr`));
              }
            } catch(e) { console.error(`sans-pointage mission ${m.id}:`, e); }
          }
        }
      } catch(e) { console.error("end-notif in reminders error:", e); }

      return res.status(200).json({ success: true, reminders: sent, validationReminders: validationSent, autoValidated, endNotifSent, missions: missions.length });
    } catch (e) {
      console.error("cron reminders error:", e);
      return res.status(500).json({ error: "Erreur rappels" });
    }
  }

  // ── Expiration des missions pending_acceptance dont le délai est dépassé ──
  // Appelé par tous les modes pour éviter les zombies
  try {
    const nowIso = new Date().toISOString();
    const zRes = await fetch(
      `${SUPABASE_URL}/rest/v1/missions?status=eq.pending_acceptance&acceptance_deadline=lt.${nowIso}&select=id,client_id,metier,titre`,
      { headers }
    );
    const zombies = await zRes.json().catch(() => []);
    if (Array.isArray(zombies) && zombies.length > 0) {
      await Promise.all(zombies.map(async zm => {
        const rembOk = await rembourserPrestation(zm, SUPABASE_URL, headers);
        if (!rembOk) console.error(`[cron/expiration] remboursement à reprendre manuellement — prestation ${zm.id}`);
        await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${zm.id}`, {
          method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
          // « refused » et non « open » : le client est remboursé, la prestation
          // est donc close. La laisser ouverte avec son paiement remboursé
          // permettrait à un prestataire de l'accepter sans contrepartie.
          body: JSON.stringify({ status: "refused", prestataire_id: null }),
        }).catch(() => {});
        if (zm.client_id) {
          await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
            method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({
              user_id: zm.client_id, type: "mission",
              title: "Prestataire non disponible ⏱️",
              body: `Le prestataire n'a pas répondu à temps pour la prestation "${zm.titre || zm.metier || ""}".${rembOk ? " Votre paiement a été intégralement remboursé." : " Notre équipe procède au remboursement."} Vous pouvez choisir un autre prestataire.`,
              read: false,
            }),
          }).catch(() => {});
        }
      }));
      console.log(`cron: expired ${zombies.length} pending_acceptance missions`);
    }
  } catch (e) { console.error("cron zombie expiry error:", e); }


  // ── Mode reset mensuel (défaut) ─────────────────────────────────
  try {
    // Reset mensuel : remet missions_completed_month à 0 ET débloque trial_exhausted pour TOUS les profils.
    // Le quota free (2 missions/mois) est mensuel — trial_exhausted doit se réinitialiser chaque 1er du mois.
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?or=(missions_completed_month.gt.0,trial_exhausted.is.true)`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ missions_completed_month: 0, trial_exhausted: false }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("cron-reset-monthly error:", err);
      return res.status(500).json({ error: "Erreur reset" });
    }

    // Downgrade des abonnements expirés — traité par batch de 50, paginé sur tous les utilisateurs
    let downgrades = 0;
    try {
      const allUsers = [];
      let downgradePage = 1;
      while (true) {
        const usersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000&page=${downgradePage}`, { headers });
        const usersData = await usersRes.json();
        const batch = usersData.users || [];
        allUsers.push(...batch);
        if (batch.length < 1000) break;
        downgradePage++;
      }
      const now = new Date();
      const toDowngrade = allUsers.filter(u => {
        const meta = u.user_metadata || {};
        return meta.plan_abonnement && meta.plan_abonnement !== "free" && meta.subscription_end_date
          && new Date(meta.subscription_end_date) < now;
      });
      const BATCH_SIZE = 50;
      for (let i = 0; i < toDowngrade.length; i += BATCH_SIZE) {
        const batch = toDowngrade.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async u => {
          const meta = u.user_metadata || {};
          await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
            method: "PUT", headers,
            body: JSON.stringify({ user_metadata: { ...meta, plan_abonnement: "free", subscription_end_date: null } }),
          }).catch(() => {});
          downgrades++;
        }));
        if (i + BATCH_SIZE < toDowngrade.length) await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) { console.error("cron downgrade error:", e); }

    console.log(`cron-reset-monthly: prestations reset, ${downgrades} abonnements expirés downgradés`);
    return res.status(200).json({ success: true, downgrades });
  } catch (e) {
    console.error("cron-reset-monthly:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
