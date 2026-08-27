import { resendBody, sendEmail, emailHtml, esc as escEmail } from "./_email.js";
import { sendPushToUser, notifier } from "./_push.js";
import { finPrestationMs, debutPrestationMs, echeanceVersementMs } from "./_temps.js";
import { montantsDeCloture } from "./_cloture.js";
import { accordRepute, executerResolution, libelleResolution } from "./_resolution.js";
import { aPurger, etatRcPro, TYPES_A_PURGER } from "./_conservation.js";
import { recapitulatifAnnuel, anneeARecapituler, recapitulatifDejaEnvoye, INFORMATION_FISCALE } from "./_fiscal.js";
import crypto from "crypto";
import { appUrl } from "./_url.js";

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
  // Le jeton reçu est comparé DÉPOUILLÉ de ses espaces, comme l'est celui lu
  // dans l'environnement.
  //
  // Sans cela, une seule espace invisible dans CRON_SECRET — le piège documenté
  // de ce projet, les variables Vercel ayant été collées depuis un iPad — suffit
  // à faire échouer la comparaison : Vercel envoie la valeur BRUTE dans l'en-tête,
  // le code la compare à la valeur NETTOYÉE. Le traitement automatique répond
  // alors 401 à chaque passage, et plus rien ne tourne : ni les virements, ni
  // l'auto-validation, ni la clôture des prestations, ni les litiges.
  //
  // Le refus était en outre muet. Il ne l'est plus : c'est la seule trace qui
  // permette de distinguer « le cron ne s'exécute pas » de « le cron est refusé ».
  const jetonRecu = token.replace(/\s/g, "");
  const isCron = cronSecret ? jetonRecu === cronSecret : false;
  const isBo   = boSecret ? verifyBoToken(token, boSecret) : false;
  if (!isCron && !isBo) {
    console.error(`[cron] appel REFUSÉ (401) — en-tête ${authHeader ? "présent" : "absent"}, `
      + `CRON_SECRET ${cronSecret ? "configuré" : "ABSENT"}. `
      + "Si l'appel vient de Vercel, comparer la variable CRON_SECRET du projet "
      + "au jeton envoyé : une espace ou un retour à la ligne invisible suffit.");
    return res.status(401).json({ error: "Unauthorized" });
  }

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

  // Ce que ce passage a réellement fait, remonté dans la réponse HTTP.
  // Le déclenchement manuel du backoffice n'annonçait que les rappels J-1 :
  // on lançait le traitement pour débloquer des virements, et il répondait
  // « Aucun email à envoyer ». On ne savait pas s'il avait travaillé.
  const bilan = { versements: 0, inscriptions: 0 };

  // ── Témoin de vie ─────────────────────────────────────────────────
  //
  // Rien ne disait si le traitement automatique tournait encore. Le backoffice
  // en était réduit à conseiller « vérifiez les journaux Vercel » quand un
  // virement traînait — c'est-à-dire à demander à un non-développeur d'aller
  // lire des journaux serveur pour savoir si une horloge bat.
  //
  // Chaque passage inscrit donc son horodatage et son mode. Le backoffice
  // l'affiche : un traitement mort se voit à l'écran, en une phrase.
  //
  // Écrit AVANT le reste : c'est un témoin de passage, pas de succès. Un
  // traitement qui démarre et échoue en cours de route doit quand même prouver
  // qu'il a démarré, sinon on cherche une panne d'horloge là où il y a une
  // panne de traitement.
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/platform_settings`, {
      method: "POST",
      headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        key: "cron_dernier_passage",
        value: { at: new Date().toISOString(), mode: queryAction === "reminders" ? "reminders" : "mensuel" },
      }),
    });
  } catch (e) {
    // Sans conséquence sur le traitement lui-même : on perd le témoin, pas le travail.
    console.error("[cron] témoin de passage non enregistré :", e.message);
  }

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
            await notifier({
                user_id: z.client_id,
                type: "mission",
                title: "Prestataire non disponible",
                body: `Le prestataire n'a pas répondu pour "${z.titre || z.metier || "votre prestation"}".${rembZ ? " Votre paiement a été intégralement remboursé." : " Notre équipe procède au remboursement."} Vous pouvez choisir un autre prestataire.`,
              }, SUPABASE_URL, headers).catch(() => {});
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
    // Le filtre portait sur `date=lt.aujourd'hui` : une prestation qui commençait
    // à 08 h 30 et n'avait toujours personne restait « en recherche » toute la
    // journée, et n'était clôturée qu'au premier passage après minuit. Le client
    // attendait quelqu'un qui ne viendrait pas, et son argent restait bloqué.
    //
    // L'échéance raisonnable, c'est l'HEURE DE DÉBUT : passée cette heure, la
    // prestation ne peut plus être rendue telle qu'elle a été commandée. On
    // examine donc aussi le jour même, et on tranche prestation par prestation
    // sur l'instant de début réel (heure locale française — `_temps.js`).
    //
    // Deuxième trou bouché : `date` est NULLE sur les prestations sur plusieurs
    // jours, qui portent `date_debut`. PostgREST écarte les NULL d'une
    // comparaison, ces prestations n'étaient donc JAMAIS examinées — une
    // prestation du 30/07 était encore « Remplaçant recherché » le 21/08.
    const todayStr = new Date().toISOString().slice(0, 10);
    // On ratisse jusqu'à DEMAIN inclus : les prestations à venir servent au
    // préavis ci-dessous. Le tri en JavaScript sépare ensuite ce qui est
    // dépassé (à clôturer) de ce qui approche (à annoncer).
    const demainStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    try {
      const pastRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?status=in.(open,needs_replacement)`
        + `&or=(date.lte.${demainStr},and(date.is.null,date_debut.lte.${demainStr}))`
        + `&select=id,client_id,metier,titre,status,stripe_payment_intent,montant_total,date,date_debut,heure_debut,alerte_sans_prestataire_at`
        + `&order=created_at.asc&limit=200`,
        { headers }
      );
      const candidates = await pastRes.json().catch(() => []);
      if (!pastRes.ok) {
        console.error(`[cron] prestations sans prestataire illisibles (${pastRes.status}) — `
          + "aucune clôture automatique ce passage. Vérifier que la migration "
          + "2026-08-21_alerte_avant_annulation.sql est appliquée.");
      }
      // Une troncature silencieuse laisserait croire que tout a été examiné.
      if (Array.isArray(candidates) && candidates.length === 200) {
        console.error("[cron] 200 prestations sans prestataire examinées — limite atteinte, "
          + "le reste attend le prochain passage.");
      }
      // Ne clôturer que celles dont l'heure de début est PASSÉE. Sans ce tri,
      // une prestation commandée pour 18 h serait annulée à 8 h du matin.
      const pastMissions = (Array.isArray(candidates) ? candidates : []).filter(m => {
        const debut = debutPrestationMs(m.date || m.date_debut, m.heure_debut);
        // Horaire illisible : on retombe sur l'ancienne règle — la veille au plus tard.
        if (debut === null) return String(m.date || m.date_debut || "") < todayStr;
        return Date.now() > debut;
      });
      // ── Prévenir le client AVANT l'échéance ───────────────────────
      //
      // Une prestation que personne n'accepte est annulée et remboursée à
      // l'heure prévue. Le client l'apprenait au moment de l'annulation : il
      // avait réservé, payé, organisé sa journée, et découvrait à 08 h 30 que
      // personne ne viendrait. Un avertissement quelques heures avant ne change
      // pas la règle, mais lui laisse le temps de s'organiser autrement.
      //
      // `alerte_sans_prestataire_at` garantit un seul envoi : ce traitement
      // repasse toutes les deux heures.
      const PREAVIS_MS = 6 * 3600000;
      const aPrevenir = (Array.isArray(candidates) ? candidates : []).filter(m => {
        if (m.alerte_sans_prestataire_at) return false;
        const debut = debutPrestationMs(m.date || m.date_debut, m.heure_debut);
        if (debut === null) return false;
        const reste = debut - Date.now();
        return reste > 0 && reste <= PREAVIS_MS;
      });
      for (const m of aPrevenir) {
        if (!m.client_id) continue;
        const debut = debutPrestationMs(m.date || m.date_debut, m.heure_debut);
        const heure = new Date(debut).toLocaleTimeString("fr-FR",
          { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
        const nom = m.titre || m.metier || "prestation";
        const cause = m.status === "needs_replacement"
          ? `Le prestataire de votre prestation "${nom}" s'est désisté et aucun remplaçant ne l'a encore reprise.`
          : `Votre prestation "${nom}" n'a encore été acceptée par aucun prestataire.`;
        // L'écriture d'abord : si elle échoue, on n'envoie pas — mieux vaut
        // pas d'alerte qu'une alerte toutes les deux heures jusqu'à l'échéance.
        const marque = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}&alerte_sans_prestataire_at=is.null`, {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=representation" },
          body: JSON.stringify({ alerte_sans_prestataire_at: new Date().toISOString() }),
        });
        const lignes = await marque.json().catch(() => []);
        if (!marque.ok || !Array.isArray(lignes) || lignes.length === 0) {
          console.error(`[cron] alerte de préavis non marquée sur ${m.id} (${marque.status}) — non envoyée.`);
          continue;
        }
        await notifier({
          user_id: m.client_id,
          type: "mission",
          title: "Personne n'a encore accepté votre prestation ⏳",
          body: `${cause} Elle commence à ${heure}. Si personne ne l'accepte d'ici là, `
              + "elle sera annulée automatiquement et intégralement remboursée, frais de service compris.",
        }, SUPABASE_URL, headers).catch(() => {});
      }
      if (aPrevenir.length) console.log(`[cron] ${aPrevenir.length} client(s) prévenu(s) avant échéance`);

      const differeesPersistantes = [];
      if (pastMissions.length) {
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
              differeesPersistantes.push(m.id);
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
            await notifier({
                user_id: m.client_id,
                type: "mission",
                title: rembourse ? "Prestation annulée — vous êtes remboursé 💶" : "Prestation clôturée automatiquement",
                body: (() => {
                  const nom = m.titre || m.metier || "prestation";
                  const cause = m.status === "needs_replacement"
                    ? `Le prestataire de votre prestation "${nom}" s'est désisté et aucun remplaçant n'a été trouvé avant l'heure prévue.`
                    : `Votre prestation "${nom}" n'a trouvé aucun prestataire avant l'heure prévue.`;
                  return rembourse
                    ? `${cause} L'intégralité de votre paiement vous est remboursée, frais de service compris — comptez 5 à 10 jours ouvrés selon votre banque.`
                    : `${cause} Elle a été clôturée automatiquement.`;
                })(),
              }, SUPABASE_URL, headers).catch(() => {});
          }
        }));
        // Le journal annonçait la clôture de toutes les prestations examinées, y
        // compris celles qui avaient échoué. Il dit maintenant ce qui s'est
        // réellement passé, remboursements et reports compris.
        console.log(`[cron] prestations dépassées : ${cloturees} clôturée(s) dont `
          + `${remboursees} remboursée(s), ${differees} différée(s) sur ${pastMissions.length} examinée(s)`);
      }
      if (differeesPersistantes.length) {
        // Une prestation qu'on n'arrive pas à rembourser reste visible exprès —
        // mais si elle le reste des semaines, personne ne le sait. On le dit.
        console.error(`[cron] remboursement toujours impossible sur : ${differeesPersistantes.join(", ")}`);
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
                await notifier({ user_id: r.prestataire_id, type: "system",
                    title: "Retenue levée ✅",
                    body: "Le délai de retenue est écoulé sans réclamation confirmée : votre versement est de nouveau programmé."}, SUPABASE_URL, headers).catch(() => {});
              }
            }
          } else if (levees.status !== 400) {
            console.error(`[versements] levée des retenues impossible (${levees.status})`);
          }
        } catch (e) {
          console.error("[versements] levée des retenues interrompue :", e.message);
        }
        // ── Propositions de résolution acceptées tacitement (CGPS art. 17.1) ──
        //
        // ALANE propose, elle ne décide pas. Passé 48 heures sans opposition
        // de l'une ou l'autre partie, l'accord est réputé formé et
        // l'instruction correspondante est transmise à Stripe.
        //
        // Une opposition — d'une seule des deux parties suffit — laisse les
        // fonds où ils sont. Rien ne se débloque alors sans un accord, une
        // décision de justice, ou une procédure de l'établissement de paiement.
        try {
          const echues = await fetch(
            `${SUPABASE_URL}/rest/v1/missions`
            + `?status=eq.disputed&resolution_opposition_at=is.null`
            + `&resolution_proposee=not.is.null`
            + `&resolution_echeance_at=lte.${encodeURIComponent(maintenant)}`
            + `&select=id,client_id,prestataire_id,metier,titre,stripe_payment_intent,`
            + `montant_total,tarif_horaire,hours,actual_hours,date_debut,date_fin,`
            + `delay_status,arrival_delay_minutes,`
            + `resolution_proposee,resolution_echeance_at,resolution_opposition_at,resolution_montant`
            + `&limit=100`,
            { headers }
          );
          if (!echues.ok) {
            // Colonne inconnue → migration non appliquée. Il faut que ça se voie :
            // sans elle, les litiges restent bloqués indéfiniment.
            const detail = await echues.text().catch(() => "");
            console.error(`[resolution] lecture impossible (${echues.status}) : ${detail.slice(0, 200)}`
              + " — vérifier que la migration 2026-08-16_proposition_de_resolution.sql est appliquée.");
          } else {
            const lots = await echues.json().catch(() => []);
            for (const m of (Array.isArray(lots) ? lots : [])) {
              // Relecture par la fonction partagée : le filtre PostgREST et la
              // règle métier doivent dire la même chose, et c'est la règle qui
              // fait foi.
              if (!accordRepute(m)) continue;

              // Verrou atomique — on marque la cause AVANT d'appeler Stripe.
              // Deux exécutions concurrentes du traitement ne peuvent pas
              // rembourser deux fois.
              //
              // Le verrou porte sur `resolution_executee_cause` et non sur
              // `status` : inventer un statut intermédiaire supposerait de
              // toucher à la contrainte de `missions.status`, et un statut
              // inconnu du reste du code ferait disparaître la prestation de
              // tous les écrans.
              const verrou = await fetch(
                `${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}&resolution_executee_cause=is.null`,
                { method: "PATCH", headers: { ...headers, "Prefer": "return=representation" },
                  body: JSON.stringify({ resolution_executee_cause: "accord_tacite" }) }
              );
              const pris = await verrou.json().catch(() => []);
              if (!Array.isArray(pris) || pris.length === 0) continue;

              const out = await executerResolution({
                mission: m, resolution: m.resolution_proposee,
                supabaseUrl: SUPABASE_URL, headers,
                stripeKey: (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, ""),
                cause: "accord_tacite",
              });
              if (!out.ok) {
                // Relâcher le verrou : la prestation sera reprise au prochain
                // passage plutôt que de rester coincée.
                console.error(`[resolution] exécution impossible — prestation ${m.id} : ${out.detail}`);
                await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
                  method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({ resolution_executee_cause: null }),
                }).catch(e => console.error(`[resolution] verrou non relâché ${m.id} :`, e.message));
                continue;
              }

              console.log(`[resolution] accord tacite exécuté (${m.resolution_proposee}) — prestation ${m.id}`);
              const quoi = libelleResolution(m.resolution_proposee);
              // Le remboursement porte sur le prix de la prestation, pas sur
              // les frais de service (CGPS art. 17.1). Le taire ferait découvrir
              // l'écart sur le relevé bancaire, ce qui rouvre le litige.
              // Le reliquat versé au prestataire doit être ANNONCÉ. Il est
              // calculé après coup à partir du remboursement réel : sans cette
              // ligne, il découvre un virement d'un montant qu'il n'attendait
              // pas, et le client croit que le prestataire n'a rien touché.
              const reliquat = Number(out.versementPrestataire || 0);
              const precision = m.resolution_proposee !== "rembourser_client" ? "" :
                "\n\nLe remboursement porte sur le prix de la prestation ; les frais de service restent acquis à ALANE (article 17.1 des CGPS)."
                + (reliquat > 0
                    ? `\n\nLa part de la prestation qui n'a pas été remboursée, soit ${reliquat.toFixed(2).replace(".", ",")} €, est versée au prestataire.`
                    : "");
              for (const uid of [m.client_id, m.prestataire_id]) {
                if (!uid) continue;
                await notifier({ user_id: uid, type: "mission", ref_id: m.id, title: "Litige clôturé ✅",
                    body: `Le délai d'opposition est écoulé sans opposition : la proposition de ${quoi} est réputée acceptée par les deux parties et a été exécutée.${precision}\n\nCette exécution ne préjuge d'aucun droit : chacune des parties conserve l'intégralité de ses recours contre l'autre.`}, SUPABASE_URL, headers).catch(e => console.error(`[resolution] notification non envoyée ${m.id} :`, e.message));
              }
            }
          }
        } catch (e) {
          console.error("[resolution] traitement interrompu :", e.message);
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
          // Combien de versements ne peuvent pas partir faute de compte de
          // paiement en face. Compté pour être dit : voir plus bas.
          let bloquesSansConnect = 0;

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
                //
                // CE `continue` ÉTAIT MUET, et c'est le pire défaut de ce fichier :
                // le versement retombait en attente à chaque passage, indéfiniment,
                // sans une ligne de journal. Le back-office affichait « en retard »
                // et accusait le traitement automatique, qui tournait très bien —
                // il ne pouvait simplement pas verser, faute de compte de paiement
                // en face. On cherchait une panne d'horloge là où il manquait un
                // destinataire.
                bloquesSansConnect++;
                console.error(`[versements] prestation ${m.id} NON VERSÉE : le prestataire `
                  + `${m.prestataire_id} n'a pas de compte Stripe Connect actif `
                  + `(compte ${pp?.stripe_account_id ? `« ${pp.stripe_account_status || "sans statut"} »` : "absent"}). `
                  + "Le versement restera en attente tant que ce compte n'est pas activé.");
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

              // La COMPENSATION AUTOMATIQUE a été retirée le 16/08/2026.
              //
              // ALANE prélevait jusqu'à la moitié de chaque versement pour
              // récupérer une somme due. Les trois conseils consultés
              // convergent : c'est ce pouvoir autonome sur les fonds d'autrui —
              // avec le blocage et l'affectation — qui rend la qualification de
              // simple mandataire difficile à soutenir. Le troisième le range
              // explicitement parmi les fonctions « à éviter », qui « évoquent
              // davantage un opérateur financier qu'un simple intermédiaire ».
              //
              // Les créances ne disparaissent pas : elles restent enregistrées,
              // notifiées, et se règlent d'accord entre les parties ou par les
              // voies de droit commun (CGPS art. 8B.3 réécrit). Ce qui disparaît,
              // c'est le prélèvement d'office.
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
                  }),
                }).catch(e => console.error(`[versements] statut non écrit ${m.id} :`, e.message));

                emis++;
                bilan.versements++;
                console.log(`[versements] ${td.id} → ${pp.stripe_account_id} (${(cents/100).toFixed(2)} €`
                  + `) — prestation ${m.id}`);
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
          // Un bilan qui ne compte que les succès laisse croire qu'il n'y avait
          // rien à faire.
          if (bloquesSansConnect) {
            console.error(`[versements] ${bloquesSansConnect} virement(s) IMPOSSIBLES : `
              + "prestataire sans compte Stripe Connect actif. Ils resteront en retard "
              + "à chaque passage tant que Connect n'est pas en place — ce n'est pas une "
              + "panne du traitement automatique.");
          }
        }
      } catch (e) {
        console.error("[versements] traitement interrompu :", e.message);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Conservation des documents — CGPS art. 14.4 (purge RGPD) et 19.1 (RC Pro)
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Deux promesses écrites que rien n'exécutait : les pièces d'identité
  // dormaient indéfiniment dans le stockage, et une RC Pro périmée depuis deux
  // ans passait inaperçue.
  //
  // Une fois par jour suffit — la fenêtre est en mois, pas en heures. Le
  // traitement passe toutes les deux heures : on ne l'exécute qu'au premier
  // passage suivant minuit, pour ne pas relancer douze fois le même prestataire.
  {
    const heureUTC = new Date().getUTCHours();
    let purges = 0, rcRelances = 0, rcSuspendus = 0, resiliations = 0;
    if (heureUTC < 2) {
      // ── Purge des positions GPS ──
      //
      // `tracking_positions` n'était purgée par rien. Chaque prestation y
      // laissait un point, conservé indéfiniment : à l'échelle de quelques
      // milliers de prestations, cela dessine les déplacements des prestataires
      // sur des mois, alors que la finalité — permettre au client de suivre
      // l'arrivée — s'éteint avec la prestation.
      //
      // Le partage lui-même est borné à la fenêtre de la prestation
      // (`fenetrePartagePosition`), qui se ferme une heure après la fin. Vingt-
      // quatre heures laissent donc une marge confortable, y compris pour une
      // prestation qui aurait débordé.
      try {
        const limite = new Date(Date.now() - 24 * 3600000).toISOString();
        const pRes = await fetch(
          `${SUPABASE_URL}/rest/v1/tracking_positions?updated_at=lt.${encodeURIComponent(limite)}`,
          { method: "DELETE", headers: { ...headers, "Prefer": "return=representation" } }
        );
        if (!pRes.ok) {
          const detail = await pRes.text().catch(() => "");
          console.error(`[positions] purge impossible (${pRes.status}) : ${detail.slice(0, 200)}`);
        } else {
          const supprimees = await pRes.json().catch(() => []);
          if (Array.isArray(supprimees) && supprimees.length > 0) {
            console.log(`[positions] ${supprimees.length} position(s) GPS purgée(s)`);
          }
        }
      } catch (e) {
        console.error("[positions] purge interrompue :", e.message);
      }

      // ── Purge des pièces d'identité (art. 14.4) ──
      try {
        const dRes = await fetch(
          `${SUPABASE_URL}/rest/v1/documents`
          + `?purged_at=is.null&type=in.(${TYPES_A_PURGER.join(",")})`
          + `&select=id,prestataire_id,type,storage_path,verified,verified_at,created_at,purged_at`
          + `&limit=500`,
          { headers }
        );
        if (!dRes.ok) {
          const detail = await dRes.text().catch(() => "");
          console.error(`[conservation] lecture des documents impossible (${dRes.status}) : ${detail.slice(0, 200)}`
            + " — vérifier que la migration 2026-08-14_conservation_documents.sql est appliquée.");
        } else {
          const docs = await dRes.json().catch(() => []);
          const aSupprimer = (Array.isArray(docs) ? docs : [])
            .map(d => ({ d, verdict: aPurger(d) }))
            .filter(x => x.verdict.purger && x.d.storage_path);

          for (const { d, verdict } of aSupprimer) {
            // Le FICHIER part, la LIGNE reste. Elle est la preuve que la
            // vérification a eu lieu — obligation de vigilance (art. L8222-1
            // du Code du travail, CGPS art. 10B.8 et 10D.4). Supprimer la ligne
            // effacerait la démarche en même temps que la pièce.
            //
            // Casse du bucket : « Documents » avec une majuscule. Une erreur de
            // casse a empêché toute suppression de fichier pendant des mois.
            const del = await fetch(`${SUPABASE_URL}/storage/v1/object/Documents`, {
              method: "DELETE", headers,
              body: JSON.stringify({ prefixes: [d.storage_path] }),
            }).catch(e => { console.error(`[conservation] suppression ${d.storage_path} :`, e.message); return null; });

            if (!del || !del.ok) {
              // On n'écrit surtout pas `purged_at` : la ligne serait marquée
              // purgée alors que le fichier est toujours là, et plus rien ne
              // repasserait dessus. Le silence ici, c'est la pièce d'identité
              // qu'on croit supprimée et qui ne l'est pas.
              console.error(`[conservation] fichier NON supprimé (${del?.status}) — document ${d.id}, `
                + `chemin ${d.storage_path}. Il sera repris au prochain passage.`);
              continue;
            }

            const maj = await fetch(`${SUPABASE_URL}/rest/v1/documents?id=eq.${d.id}`, {
              method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify({ purged_at: new Date().toISOString(), storage_path: null }),
            }).catch(() => null);
            if (!maj || !maj.ok) {
              console.error(`[conservation] document ${d.id} : fichier supprimé mais ligne non marquée (${maj?.status})`);
              continue;
            }
            purges++;
            console.log(`[conservation] ${d.type} purgé (${verdict.cause}) — document ${d.id}`);
          }
          if (purges) console.log(`[conservation] ${purges} pièce(s) d'identité supprimée(s)`);
        }
      } catch (e) {
        console.error("[conservation] purge interrompue :", e.message);
      }

      // ── Résiliations arrivées à échéance (CGPS art. 16.2, P2B) ──
      //
      // Un préavis qu'on ne suit pas d'effet n'est pas un préavis : le compte
      // resterait ouvert indéfiniment, et la décision notifiée à l'intéressé ne
      // serait jamais appliquée. Le contraire est aussi vrai — c'est pourquoi
      // la date est vérifiée ici, et non au moment de la programmation.
      try {
        const maintenantIso = new Date().toISOString();
        const rRes = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?resiliation_prevue_at=lte.${encodeURIComponent(maintenantIso)}`
          + `&select=id,resiliation_prevue_at,resiliation_motif&limit=100`,
          { headers }
        );
        if (!rRes.ok) {
          if (rRes.status !== 400) console.error(`[resiliation] lecture impossible (${rRes.status})`);
        } else {
          const aResilier = await rRes.json().catch(() => []);
          for (const p of (Array.isArray(aResilier) ? aResilier : [])) {
            // Une prestation en cours bloque la résiliation : le client attend
            // quelqu'un, et le prestataire attend son versement. On repousse
            // plutôt que de laisser les deux sans interlocuteur.
            const enCours = await fetch(
              `${SUPABASE_URL}/rest/v1/missions?or=(client_id.eq.${p.id},prestataire_id.eq.${p.id})`
              + `&status=in.(open,pending_acceptance,assigned)&select=id&limit=1`,
              { headers }
            ).catch(() => null);
            const rows = enCours?.ok ? await enCours.json().catch(() => []) : [];
            if (Array.isArray(rows) && rows.length > 0) {
              console.log(`[resiliation] ${p.id} reportée : prestation en cours`);
              continue;
            }

            // Idem pour un versement encore dû : supprimer le compte le ferait
            // disparaître avec l'argent.
            const du = await fetch(
              `${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${p.id}`
              + `&payout_status=in.(pending,processing,held)&status=eq.completed&select=id&limit=1`,
              { headers }
            ).catch(() => null);
            const duRows = du?.ok ? await du.json().catch(() => []) : [];
            if (Array.isArray(duRows) && duRows.length > 0) {
              console.log(`[resiliation] ${p.id} reportée : versement encore dû`);
              continue;
            }

            const sup = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${p.id}`, { method: "DELETE", headers })
              .catch(e => { console.error(`[resiliation] suppression impossible ${p.id} :`, e.message); return null; });
            if (!sup || !sup.ok) {
              console.error(`[resiliation] compte ${p.id} NON supprimé (${sup?.status}) — sera repris demain`);
              continue;
            }
            resiliations++;
            console.log(`[resiliation] compte ${p.id} résilié à l'échéance du préavis`);
          }
          if (resiliations) console.log(`[resiliation] ${resiliations} compte(s) résilié(s)`);
        }
      } catch (e) {
        console.error("[resiliation] traitement interrompu :", e.message);
      }

      // ── Attestations RC Pro (art. 19.1) ──
      try {
        const rcRes = await fetch(
          `${SUPABASE_URL}/rest/v1/documents?type=eq.rc_pro&expires_at=not.is.null`
          + `&select=id,prestataire_id,expires_at&order=expires_at&limit=500`,
          { headers }
        );
        if (rcRes.ok) {
          const rcs = await rcRes.json().catch(() => []);
          // Une seule attestation par prestataire et par type (contrainte
          // unique), mais on garde la plus lointaine par sécurité : un
          // renouvellement déposé ne doit pas être ignoré au profit de l'ancien.
          const parPresta = new Map();
          for (const rc of (Array.isArray(rcs) ? rcs : [])) {
            if (!rc.prestataire_id) continue;
            const prec = parPresta.get(rc.prestataire_id);
            if (!prec || String(rc.expires_at) > String(prec.expires_at)) parPresta.set(rc.prestataire_id, rc);
          }

          for (const [prestataireId, rc] of parPresta) {
            const etat = etatRcPro(rc.expires_at);
            if (etat === "valide" || etat === "inconnue") continue;

            const pRes = await fetch(
              `${SUPABASE_URL}/rest/v1/profiles?id=eq.${prestataireId}&select=missions_enabled,rc_pro_relance_at`,
              { headers }
            ).catch(() => null);
            const pRows = pRes?.ok ? await pRes.json().catch(() => []) : [];
            const prof = Array.isArray(pRows) && pRows[0];
            if (!prof) continue;

            // Une relance tous les sept jours au plus : on prévient, on ne harcèle pas.
            const derniere = prof.rc_pro_relance_at ? new Date(prof.rc_pro_relance_at).getTime() : 0;
            const relancable = Date.now() - derniere >= 7 * 86400000;

            const finLe = new Date(`${String(rc.expires_at).slice(0,10)}T12:00:00Z`)
              .toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });

            // La suspension ne dépend PAS de la relance : elle intervient au
            // terme des trente jours de tolérance, que l'e-mail soit parti ou non.
            if (etat === "suspendable" && prof.missions_enabled === true) {
              await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${prestataireId}`, {
                method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({ missions_enabled: false }),
              }).catch(e => console.error(`[rc_pro] suspension impossible ${prestataireId} :`, e.message));
              await notifier({ user_id: prestataireId, type: "system",
                  title: "Accès suspendu — attestation RC Pro expirée",
                  body: `Votre attestation de responsabilité civile professionnelle a expiré le ${finLe} et n'a pas été renouvelée `
                      + `dans les trente jours (CGPS art. 19.1). Vous ne recevez plus de propositions de prestation. `
                      + `Déposez une attestation à jour depuis votre espace Documents pour rétablir votre accès.`}, SUPABASE_URL, headers).catch(() => {});
              rcSuspendus++;
              console.log(`[rc_pro] prestataire ${prestataireId} suspendu — attestation expirée le ${rc.expires_at}`);
              continue;
            }

            if (!relancable) continue;
            await notifier({ user_id: prestataireId, type: "system",
                title: etat === "expiree" ? "Attestation RC Pro expirée" : "Attestation RC Pro bientôt expirée",
                body: etat === "expiree"
                  ? `Votre attestation RC Pro a expiré le ${finLe}. Sans renouvellement sous trente jours, votre accès aux `
                    + `propositions sera suspendu (CGPS art. 19.1). Déposez la nouvelle depuis votre espace Documents.`
                  : `Votre attestation RC Pro expire le ${finLe}. Pensez à déposer la nouvelle depuis votre espace Documents `
                    + `pour continuer à recevoir des propositions.`}, SUPABASE_URL, headers).catch(() => {});
            await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${prestataireId}`, {
              method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify({ rc_pro_relance_at: new Date().toISOString() }),
            }).catch(() => {});
            rcRelances++;
          }
          if (rcRelances || rcSuspendus) {
            console.log(`[rc_pro] ${rcRelances} relance(s), ${rcSuspendus} suspension(s)`);
          }
        } else if (rcRes.status !== 400) {
          console.error(`[rc_pro] lecture impossible (${rcRes.status})`);
        }
      } catch (e) {
        console.error("[rc_pro] traitement interrompu :", e.message);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Récapitulatif annuel des revenus — article 242 bis, II du CGI
  // ═══════════════════════════════════════════════════════════════════════
  //
  // L'opérateur de plateforme adresse EN JANVIER, à chaque utilisateur, le
  // montant brut qu'il a perçu l'année précédente. Rien ne le faisait.
  //
  // Le traitement passe toutes les deux heures : sans garde, le même courriel
  // partirait des centaines de fois en janvier. `recapitulatif_annuel_at` porte
  // la date du dernier envoi, et `recapitulatifDejaEnvoye` la compare à l'année
  // récapitulée.
  {
    const anneeRecap = anneeARecapituler();
    const RESEND_API_KEY_GLOBAL = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
    // RESEND_FROM porte des espaces SIGNIFICATIFS — « ALANE <no-reply@… > » — et
    // ne doit donc pas être nettoyé (règle CLAUDE.md 1.4, exception explicite).
    const RESEND_FROM_GLOBAL = process.env.RESEND_FROM || "onboarding@resend.dev";
    let recapEnvoyes = 0;
    if (anneeRecap && RESEND_API_KEY_GLOBAL) {
      try {
        const debut = `${anneeRecap}-01-01`;
        const fin   = `${anneeRecap + 1}-01-01`;

        const prRes = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire`
          + `&select=id,prenom,recapitulatif_annuel_at&limit=1000`,
          { headers }
        );
        if (!prRes.ok) {
          const detail = await prRes.text().catch(() => "");
          console.error(`[recapitulatif] profils illisibles (${prRes.status}) : ${detail.slice(0, 200)}`
            + " — vérifier que la migration 2026-08-16_conformite_dac7.sql est appliquée.");
        } else {
          const profils = (await prRes.json().catch(() => []))
            .filter(p => !recapitulatifDejaEnvoye(p.recapitulatif_annuel_at, anneeRecap));

          for (const p of profils) {
            try {
              const mRes = await fetch(
                `${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${p.id}`
                + `&date=gte.${debut}&date=lt.${fin}`
                + `&select=payout_status,payout_amount,payout_compensation`,
                { headers }
              );
              if (!mRes.ok) continue;
              const recap = recapitulatifAnnuel(await mRes.json().catch(() => []));

              // Aucune prestation versée : pas de récapitulatif. Envoyer « vous
              // avez perçu 0 € » à quelqu'un qui n'a jamais travaillé avec ALANE
              // n'informe personne et ressemble à une erreur.
              if (recap.operations === 0) continue;

              const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${p.id}`, { headers });
              const uData = await uRes.json().catch(() => ({}));
              if (!uData?.email) continue;

              const eur = (v) => v.toFixed(2).replace(".", ",");
              const envoi = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { "Authorization": `Bearer ${RESEND_API_KEY_GLOBAL}`, "Content-Type": "application/json" },
                body: resendBody({
                  from: RESEND_FROM_GLOBAL,
                  to: uData.email,
                  subject: `Récapitulatif ${anneeRecap} de vos revenus ALANE`,
                  html: `<div style="font-family:sans-serif;max-width:560px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
                    <h2 style="color:#A29BFE;margin:0 0 12px">Récapitulatif ${anneeRecap}</h2>
                    <p>Bonjour ${esc(p.prenom || "")},</p>
                    <p>Conformément à l'article 242 bis du Code général des impôts, voici le récapitulatif
                    des sommes perçues via ALANE en ${anneeRecap}. Il vous est adressé pour vos déclarations,
                    et une copie en est transmise à l'administration fiscale.</p>
                    <table style="width:100%;border-collapse:collapse;margin:20px 0">
                      <tr><td style="padding:8px 0;color:rgba(255,255,255,0.6)">Prestations réglées</td>
                          <td style="text-align:right;font-weight:700">${recap.operations}</td></tr>
                      <tr><td style="padding:8px 0;color:rgba(255,255,255,0.6)">Montant brut perçu</td>
                          <td style="text-align:right;font-weight:800;color:#A29BFE;font-size:18px">${eur(recap.brut)} €</td></tr>
                      ${recap.retenues > 0 ? `<tr><td style="padding:8px 0;color:rgba(255,255,255,0.6)">dont retenues (CGPS art. 8B.3)</td>
                          <td style="text-align:right;font-weight:700">${eur(recap.retenues)} €</td></tr>
                      <tr><td style="padding:8px 0;color:rgba(255,255,255,0.6)">Versé sur votre compte</td>
                          <td style="text-align:right;font-weight:700">${eur(recap.verse)} €</td></tr>` : ""}
                    </table>
                    <p style="font-size:13px;color:rgba(255,255,255,0.7);line-height:1.7">
                      <strong style="color:#fff">${esc(INFORMATION_FISCALE.titre)}</strong><br/>
                      ${esc(INFORMATION_FISCALE.texte).replace(/\n/g, "<br/>")}
                    </p>
                    <p style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:20px">
                      C'est le montant BRUT qui est déclaré : il n'est pas net de vos cotisations,
                      que vous restez seul à devoir régler.
                    </p>
                    <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
                  </div>`,
                }),
              }).catch(e => { console.error(`[recapitulatif] envoi échoué pour ${p.id} :`, e.message); return null; });

              // La date n'est écrite QUE si l'envoi a réussi : la marquer d'office
              // ferait croire à une obligation remplie qui ne l'est pas, et le
              // prestataire n'aurait jamais son récapitulatif.
              if (!envoi || !envoi.ok) {
                console.error(`[recapitulatif] non envoyé à ${p.id} (${envoi?.status}) — sera repris au prochain passage`);
                continue;
              }
              await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${p.id}`, {
                method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({ recapitulatif_annuel_at: new Date().toISOString() }),
              }).catch(e => console.error(`[recapitulatif] date non enregistrée pour ${p.id} :`, e.message));
              recapEnvoyes++;
            } catch (e) {
              console.error(`[recapitulatif] échec sur ${p.id} :`, e.message);
            }
          }
          if (recapEnvoyes) console.log(`[recapitulatif] ${recapEnvoyes} récapitulatif(s) ${anneeRecap} envoyé(s)`);
        }
      } catch (e) {
        console.error("[recapitulatif] traitement interrompu :", e.message);
      }
    }
  }

  // ── Dossiers prestataires en attente : prévenir ALANE ─────────────
  //
  // POURQUOI CE BALAYAGE EXISTE
  //
  // L'alerte partait d'un appel lancé par le NAVIGATEUR juste après la création
  // du compte (`notify_signup` dans api/support.js). Deux défauts la rendaient
  // muette :
  //
  //   • l'appel est en `.catch(() => {})` côté front, et un `.catch()` n'attrape
  //     que les erreurs réseau. Un 401 se résout normalement et disparaît sans
  //     laisser de trace. Or l'appel exige un jeton, et `signUp()` ne renvoie
  //     pas toujours de session — quand la confirmation par e-mail est active,
  //     il n'y en a aucune ;
  //   • le navigateur peut être fermé ou perdre le réseau avant la fin.
  //
  // Une alerte dont l'envoi dépend d'un navigateur n'est pas une alerte. Huit
  // comptes attendaient une validation que personne ne savait en attente, dont
  // un depuis le 5 août.
  //
  // Ce balayage ne dépend de rien : il relève les comptes prestataires en
  // attente jamais signalés, envoie UN courriel qui les liste, et les marque.
  // `notify_signup` marque lui aussi quand il réussit — l'alerte immédiate est
  // conservée quand elle fonctionne, et n'est pas redoublée.
  {
    try {
      const enAttenteRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.pending`
        + `&alerte_inscription_at=is.null&select=id,prenom,nom,created_at`
        + `&order=created_at.asc&limit=100`,
        { headers }
      );
      if (!enAttenteRes.ok) {
        const detail = await enAttenteRes.text().catch(() => "");
        console.error(`[inscriptions] relevé impossible (${enAttenteRes.status}) : ${detail.slice(0, 200)}`
          + " — vérifier que la migration 2026-08-24_alerte_inscription_prestataire.sql est appliquée.");
      } else {
        const aSignaler = await enAttenteRes.json().catch(() => []);
        if (Array.isArray(aSignaler) && aSignaler.length) {
          // Le total en attente, y compris les comptes déjà signalés : un dossier
          // signalé une fois puis oublié reste un dossier oublié.
          let totalEnAttente = aSignaler.length;
          try {
            const cnt = await fetch(
              `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.pending&select=id`,
              { headers: { ...headers, "Prefer": "count=exact", "Range": "0-0" } }
            );
            const plage = cnt.headers.get("content-range") || "";
            const n = Number(String(plage).split("/")[1]);
            if (Number.isFinite(n)) totalEnAttente = n;
          } catch { /* le total exact n'est qu'un confort : la liste, elle, est juste */ }

          // Les adresses e-mail vivent dans `auth.users`, pas dans `profiles`.
          const emails = {};
          try {
            const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`, { headers });
            const ud = await ur.json();
            for (const u of (ud.users || [])) emails[u.id] = u.email || "";
          } catch (e) {
            console.error("[inscriptions] adresses illisibles :", e.message);
          }

          const lignes = aSignaler.map(p => {
            const nom = [p.prenom, p.nom].filter(Boolean).join(" ") || "(sans nom)";
            const depuis = p.created_at ? new Date(p.created_at).toLocaleDateString("fr-FR") : "—";
            return `<tr>`
              + `<td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600">${escEmail(nom)}</td>`
              + `<td style="padding:8px 0;border-bottom:1px solid #eee">${escEmail(emails[p.id] || "")}</td>`
              + `<td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;white-space:nowrap">${escEmail(depuis)}</td>`
              + `</tr>`;
          }).join("");

          const lien = appUrl();
          const html = emailHtml(`
            <p><strong>${aSignaler.length} dossier${aSignaler.length > 1 ? "s" : ""} prestataire${aSignaler.length > 1 ? "s" : ""}</strong>
               attend${aSignaler.length > 1 ? "ent" : ""} votre validation.</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0">
              <tr><th style="text-align:left;padding:6px 0;color:#888;font-weight:600;font-size:13px">Nom</th>
                  <th style="text-align:left;padding:6px 0;color:#888;font-weight:600;font-size:13px">Email</th>
                  <th style="text-align:left;padding:6px 0;color:#888;font-weight:600;font-size:13px">Inscrit le</th></tr>
              ${lignes}
            </table>
            <p>Tant que leur dossier n'est pas examiné, ces comptes n'apparaissent dans aucun
               catalogue et ne reçoivent aucune proposition.</p>
            <p style="color:#888;font-size:13px">${totalEnAttente} compte${totalEnAttente > 1 ? "s" : ""} prestataire${totalEnAttente > 1 ? "s" : ""} en attente au total.</p>
            <p style="text-align:center;margin:24px 0"><a href="${lien}?bo=1"
               style="background:#7C6FE0;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700">Ouvrir le backoffice</a></p>
          `);

          // ADMIN_EMAIL n'est PAS dépouillé de ses espaces : c'est l'exception
          // documentée de la règle 1.4, elle vaut couramment « ALANE <adresse> ».
          const destinataire = (process.env.ADMIN_EMAIL || "").trim() || "direction@alane.fr";
          const envoye = await sendEmail({
            to: destinataire,
            subject: `👤 ${aSignaler.length} dossier${aSignaler.length > 1 ? "s" : ""} prestataire${aSignaler.length > 1 ? "s" : ""} à valider`,
            html,
          });

          // On ne marque QUE si l'envoi a été accepté : marquer un envoi qui a
          // échoué revient à perdre définitivement ces comptes, sans que rien
          // ne le signale. `sendEmail` renvoie `true` sur acceptation, et a déjà
          // journalisé le refus le cas échéant.
          if (envoye === true) {
            const maintenant = new Date().toISOString();
            const ids = aSignaler.map(p => p.id);
            const maj = await fetch(
              `${SUPABASE_URL}/rest/v1/profiles?id=in.(${ids.join(",")})`,
              {
                method: "PATCH",
                headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({ alerte_inscription_at: maintenant }),
              }
            );
            if (!maj.ok) {
              const detail = await maj.text().catch(() => "");
              console.error(`[inscriptions] marquage refusé (${maj.status}) : ${detail.slice(0, 200)}`
                + " — l'alerte repartira au prochain passage.");
            } else {
              bilan.inscriptions = ids.length;
              console.log(`[inscriptions] ${ids.length} dossier(s) signalé(s) à ${destinataire}.`);
            }
          } else {
            console.error("[inscriptions] alerte NON envoyée — les dossiers restent à signaler.");
          }
        }
      }
    } catch (e) {
      console.error("[inscriptions] balayage interrompu :", e.message);
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
  // `lienApp`, pas `appUrl` : la variable locale portait le nom de la fonction
  // importée et s'initialisait avec elle — `const appUrl = appUrl()`. JavaScript
  // lit alors la variable en cours de déclaration, jamais l'import, et lève
  // « Cannot access 'appUrl' before initialization » à CHAQUE rappel construit.
  // Le traitement automatique répondait donc « Erreur rappels » depuis le
  // regroupement de l'URL dans _url.js. Trois autres endroits avaient la même
  // faute : relances de validation, auto-validation, et api/missions.js.
  const lienApp = appUrl();
  const loc = encodeURIComponent([m.adresse, m.ville].filter(Boolean).join(", ") || "");
  const titleEnc = encodeURIComponent(`Mission ALANE — ${m.metier||"Mission"}`);
  const descEnc  = encodeURIComponent(`Prestation via ALANE. Voir détails : ${lienApp}`);
  const heureDebut = m.heure_debut || "08:00";
  const [hd, md2] = heureDebut.split(":").map(Number);
  const endMin = hd * 60 + md2 + Math.round(Number(m.hours) * 60);
  const heureFin = `${String(Math.floor(endMin/60)%24).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`;
  const [y,mo,d] = tomorrowStr.split("-");
  const gcStart = `${y}${mo}${d}T${heureDebut.replace(":","").padEnd(6,"0")}`;
  const gcEnd   = `${y}${mo}${d}T${heureFin.replace(":","").padEnd(6,"0")}`;
  const gcUrl   = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${titleEnc}&dates=${gcStart}/${gcEnd}&details=${descEnc}&location=${loc}`;
  const icsUrl  = `${lienApp}/api/support?ics=1&title=${titleEnc}&date=${tomorrowStr}&start=${encodeURIComponent(heureDebut)}&end=${encodeURIComponent(heureFin)}&location=${loc}&description=${descEnc}`;
  return `<div style="text-align:center;margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
<a href="${gcUrl}" style="display:inline-block;background:#4285F4;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700;font-size:13px;margin:4px;">📅 Google Agenda</a>
<a href="${icsUrl}" style="display:inline-block;background:#555;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700;font-size:13px;margin:4px;">🗓 Apple / Outlook</a>
</div>`;
})()}
<div style="text-align:center;margin-top:16px;"><a href='${appUrl()}' style="display:inline-block;background:linear-gradient(135deg,#7C6FE0,#5B4FCF);color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:700;font-size:14px;">Voir ma prestation →</a></div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href='${appUrl()}' style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
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
          // `date=lte` et non `lt` : une prestation terminée AUJOURD'HUI était
          // exclue jusqu'au lendemain. Le prestataire qui finit à 14 h n'était
          // donc relancé que le jour suivant, alors que son paiement dépend de
          // sa confirmation et que l'auto-validation tombe à 24 h. Le filtre en
          // JavaScript ci-dessous vérifie de toute façon que la prestation est
          // réellement terminée.
          `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&date=lte.${todayStr}&select=id,client_id,prestataire_id,metier,sector,date,hours,actual_hours,ville,heure_debut,validation_prestataire,validation_client,last_validation_reminder_at`,
          { headers }
        );
        const pastMissionsRaw = await pastRes.json();
        const now = Date.now();
        // Deux heures entre deux relances. Le nom disait douze : la valeur était
        // juste, le nom mentait, et c'est le nom qu'on relit.
        const DELAI_ENTRE_RELANCES_MS = 2 * 60 * 60 * 1000;
        const pastMissions = Array.isArray(pastMissionsRaw) ? pastMissionsRaw.filter(m => {
          if (!m.heure_debut) return true;
          // Conversion heure française → UTC : elle manquait, la relance de
          // validation partait avec une à deux heures de retard.
          const endMs = finPrestationMs({ ...m, started_at: null });
          if (endMs === null || endMs >= now) return false;
          // Ne pas renvoyer une relance déjà partie il y a moins de deux heures
          if (m.last_validation_reminder_at) {
            const lastReminderMs = new Date(m.last_validation_reminder_at).getTime();
            if (!isNaN(lastReminderMs) && now - lastReminderMs < DELAI_ENTRE_RELANCES_MS) return false;
          }
          return true;
        }) : [];
        // La relance ne partait QUE par e-mail et par SMS, et tout le bloc était
        // conditionné à la présence de la clé Resend : sans elle, plus rien.
        //
        // La cloche de l'application restait donc vide, alors que c'est le
        // premier endroit où l'on regarde. Les notifications in-app et les
        // notifications poussées partent maintenant d'abord, indépendamment de
        // toute clé tierce ; l'e-mail et le SMS restent, en plus.
        if (pastMissions.length) {
          await Promise.all(pastMissions.map(async (m) => {
            const label = m.metier || m.sector || "votre prestation";
            const notifier = async (userId, title, corps) => {
              if (!userId) return 0;
              const r = await notifier({ user_id: userId, type: "mission", title, body: corps}, SUPABASE_URL, headers).catch(e => { console.error("[relance] notification non insérée :", e.message); return null; });
              if (r && !r.ok) {
                const detail = await r.text().catch(() => "");
                console.error(`[relance] notification refusée (${r.status}) : ${detail.slice(0, 200)}`);
              }
              await sendPushToUser(userId, { title, body: corps, url: "/" }, SUPABASE_URL, headers).catch(() => {});
              return 1;
            };

            let envoyees = 0;
            if (!m.validation_prestataire) {
              envoyees += await notifier(m.prestataire_id, "⏱ Confirmez la fin de votre prestation",
                `« ${label} » du ${m.date} est terminée. Confirmez-la pour déclencher votre paiement.`);
            }
            if (m.validation_prestataire && !m.validation_client) {
              envoyees += await notifier(m.client_id, "✅ Prestation à valider",
                `Le prestataire a confirmé la fin de « ${label} » du ${m.date}. Validez-la depuis votre espace.`);
            }
            validationSent += envoyees;
            if (envoyees > 0) {
              const up = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
                method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({ last_validation_reminder_at: new Date().toISOString() }),
              }).catch(e => { console.error("[relance] horodatage non écrit :", e.message); return null; });
              if (up && !up.ok) {
                // Sans cet horodatage, la relance repart à CHAQUE passage du
                // traitement, toutes les deux heures. C'est la colonne qui
                // manquait en base jusqu'au 16/08/2026.
                const detail = await up.text().catch(() => "");
                console.error(`[relance] horodatage refusé (${up.status}) : ${detail.slice(0, 200)}`
                  + " — les relances vont se répéter.");
              }
            }

            if (!RESEND_API_KEY) return;
            const clientEmail  = userMap[m.client_id]?.email;
            const prestaEmail  = userMap[m.prestataire_id]?.email;
            const clientName   = nameMap[m.client_id]  || "Client";
            const prestaName   = nameMap[m.prestataire_id] || "Prestataire";
            const lienApp      = appUrl();
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
<a href="${lienApp}" style="display:inline-block;background:#7C6FE0;color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:700;font-size:14px;">Confirmer ma prestation →</a>
</div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href="${lienApp}" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
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
<a href="${lienApp}" style="display:inline-block;background:#F0B429;color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:700;font-size:14px;">Valider la prestation →</a>
</div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;"><p style="color:#4A4E6A;font-size:11px;margin:0;">L'équipe ALANE · <a href="${lienApp}" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p></td></tr>
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
            // L'horodatage anti-répétition est posé plus haut, avec les
            // notifications : il ne dépend plus de l'envoi des e-mails.
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
          `${SUPABASE_URL}/rest/v1/missions?status=eq.assigned&date=lte.${yesterdayStr}&select=id,client_id,prestataire_id,hours,actual_hours,tarif_horaire,metier,sector,date,date_debut,date_fin,heure_debut,started_at,montant_total,delay_status,arrival_delay_minutes,validation_prestataire,cashback_credited,extra_hours_tarif,extra_hours_appliquees`,
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
              const lienApp = appUrl();

              // Lire le profil client au moment du traitement pour éviter les données périmées
              const cpRes  = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${m.client_id}&select=cashback_balance,commandes_mois`, { headers });
              const cpData = await cpRes.json();
              const profile = Array.isArray(cpData) && cpData[0] ? cpData[0] : {};
              const missionsThisMonth = (profile.commandes_mois || 0) + jours;
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
                notifier({ user_id: m.client_id, type: "mission", title: "Prestation validée automatiquement ✅", body: `Votre prestation "${mLabel}" a été validée automatiquement (délai 24h dépassé).${cashbackEarned > 0 ? ` Cashback crédité : +${cashbackEarned.toFixed(2)} €` : ""}`}, SUPABASE_URL, headers).catch(()=>{}),
                // Notification prestataire
                m.prestataire_id && notifier({ user_id: m.prestataire_id, type: "mission", title: "Prestation validée ✅", body: `Votre prestation "${mLabel}" a été validée. Votre paiement de ${partPrestataire.toFixed(2)} € est programmé à la fermeture du délai de 48 h dont le client dispose pour signaler un problème.`}, SUPABASE_URL, headers).catch(()=>{}),
                // Email prestataire — réutilise userMap déjà chargé
                (async () => {
                  if (!m.prestataire_id || !RESEND_API_KEY) return;
                  const prestaEmail = userMap[m.prestataire_id]?.email;
                  const prestaPrenom = userMap[m.prestataire_id]?.meta?.prenom || nameMap[m.prestataire_id] || "Prestataire";
                  if (!prestaEmail) return;
                  await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
                    body: resendBody({ from: RESEND_FROM, to: [prestaEmail], subject: `Prestation validée — votre paiement est en cours 💰`, html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px"><h2 style="color:#A29BFE;margin:0 0 12px">Prestation validée automatiquement ✅</h2><p>Bonjour ${esc(prestaPrenom)},</p><p>Le délai de validation de 24h étant écoulé, votre prestation <strong>${mLabel}</strong> a été automatiquement validée.</p><p>Votre paiement de <strong style="color:#A29BFE">${partPrestataire.toFixed(2)} €</strong> est programmé le <strong>${new Date(echeanceVersementMs(m)).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long" })}</strong>, à la fermeture du délai de 48 h dont le client dispose pour signaler un problème. Il sera ensuite versé sur votre IBAN sous 1 à 2 jours ouvrés.</p><div style="margin-top:18px;padding:12px;border-radius:10px;background:rgba(255,255,255,0.06)"><div style="font-weight:700;font-size:12px;margin-bottom:5px">${esc(INFORMATION_FISCALE.titre)}</div><div style="font-size:11px;line-height:1.7;color:rgba(255,255,255,0.75)">${esc(INFORMATION_FISCALE.texte).replace(/\n/g, "<br/>")}</div></div><p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="${lienApp}" style="color:#7C6FE0;">www.alane.fr</a></p></div>` }),
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
                    body: resendBody({ from: RESEND_FROM, to: [clientEmail], subject: `Prestation validée automatiquement — ALANE`, html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px"><h2 style="color:#F0B429;margin:0 0 12px">Prestation validée ✅</h2><p>Bonjour ${esc(clientPrenom)},</p><p>Votre prestation <strong>${mLabel}</strong> a été automatiquement validée, le délai de confirmation de 24h étant écoulé.</p>${cashbackEarned > 0 ? `<p>Votre cashback de <strong style="color:#F0B429">+${cashbackEarned.toFixed(2)} €</strong> a été crédité sur votre wallet.</p>` : ""}<p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="${lienApp}" style="color:#7C6FE0;">www.alane.fr</a></p></div>` }),
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
              const appUrl2 = appUrl();
              const prestaEmail2 = userMap[m.prestataire_id]?.email;
              const clientEmail2 = userMap[m.client_id]?.email;
              const prestaName2  = nameMap[m.prestataire_id] || "Prestataire";
              const clientName2  = nameMap[m.client_id] || "Client";
              const sends2 = [];
              // In-app notification prestataire
              if (m.prestataire_id)
                sends2.push(notifier({ user_id: m.prestataire_id, type: "mission", title: "Confirmez la fin de votre prestation ✅", body: `Votre prestation "${mLabel}" est terminée. Confirmez depuis votre espace pour déclencher votre paiement.`}, SUPABASE_URL, headers).catch(() => {}));
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
                await notifier({
                    user_id: m.prestataire_id,
                    type: "mission",
                    title: "Pointage manquant ⚠️",
                    body: `L'horaire de votre prestation « ${mLabel2} » est dépassé et vous n'avez pas signalé votre arrivée. Ouvrez l'application pour la démarrer, sinon elle ne pourra pas être validée ni payée.`,
                  }, SUPABASE_URL, headers).catch(() => {});
              }
              if (smsEnabled && m.prestataire_id) {
                const tel = userMap[m.prestataire_id]?.meta?.telephone;
                if (tel) await sendSms(BREVO_API_KEY, tel, smsTexte(`ALANE - Pointage manquant : votre prestation ${mLabel2} devait avoir commence. Signalez votre arrivee dans l'application, sans quoi elle ne pourra pas etre payee. alane.fr`));
              }
            } catch(e) { console.error(`sans-pointage mission ${m.id}:`, e); }
          }
        }
      } catch(e) { console.error("end-notif in reminders error:", e); }

      return res.status(200).json({ success: true, reminders: sent, validationReminders: validationSent, autoValidated, endNotifSent, missions: missions.length, versements: bilan.versements, inscriptions: bilan.inscriptions });
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
          await notifier({
              user_id: zm.client_id, type: "mission",
              title: "Prestataire non disponible ⏱️",
              body: `Le prestataire n'a pas répondu à temps pour la prestation "${zm.titre || zm.metier || ""}".${rembOk ? " Votre paiement a été intégralement remboursé." : " Notre équipe procède au remboursement."} Vous pouvez choisir un autre prestataire.`,
            }, SUPABASE_URL, headers).catch(() => {});
        }
      }));
      console.log(`cron: expired ${zombies.length} pending_acceptance missions`);
    }
  } catch (e) { console.error("cron zombie expiry error:", e); }


  // ── Mode reset mensuel (défaut) ─────────────────────────────────
  try {
    // Reset mensuel : remet les DEUX compteurs à 0 — le quota du prestataire
    // (missions_completed_month) et les commandes du client (commandes_mois) —
    // ET débloque trial_exhausted pour TOUS les profils.
    // Le quota free (2 missions/mois) est mensuel — trial_exhausted doit se réinitialiser chaque 1er du mois.
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?or=(missions_completed_month.gt.0,commandes_mois.gt.0,trial_exhausted.is.true)`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ missions_completed_month: 0, commandes_mois: 0, trial_exhausted: false }),
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
