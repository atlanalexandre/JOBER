import { verifyUser } from "./_auth.js";
import { lireFraisService, verifierMontant, messageIncoherence, ERREUR_MONTANT } from "./_montant.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe non configuré" });
  if (STRIPE_SECRET_KEY.startsWith("pk_")) {
    return res.status(500).json({ error: "Configuration Stripe incorrecte : STRIPE_SECRET_KEY doit être la clé secrète (sk_test_... ou sk_live_...), pas la clé publique (pk_...). Corrigez dans Vercel → Settings → Environment Variables → STRIPE_SECRET_KEY." });
  }

  const stripeHeaders = {
    "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  const { action, amount: clientAmount, description, metadata = {}, paymentMethodId, mission_id: intentMissionId } = req.body || {};
  const currency = "eur"; // toujours EUR — ne jamais accepter depuis le client

  // `customerId` était lu depuis le corps de la requête. Il ne l'est plus nulle
  // part : l'identifiant client Stripe se lit dans `profiles`, jamais dans ce que
  // le navigateur envoie. Voir clientStripeDuCompte() ci-dessous.

  // ── Identifiant client Stripe du compte appelant ──────────────────────────
  //
  // Un seul endroit, une seule règle : on lit `profiles.stripe_customer_id`, on
  // en crée un s'il n'existe pas, et on le persiste. Rien ne vient du client.
  //
  // Deux défauts se corrigent ici en même temps.
  //
  // 1. La carte enregistrée ne fonctionnait pas. `setup_card` créait bien un
  //    client Stripe, mais ne l'écrivait nulle part côté serveur : le navigateur
  //    le rangeait dans `user_metadata`. Or la création du PaymentIntent ne
  //    l'acceptait que s'il correspondait à `profiles.stripe_customer_id`, qui
  //    n'est renseigné que par le webhook d'abonnement. Pour tout client non
  //    abonné, la comparaison échouait, le PaymentIntent partait sans `customer`,
  //    et Stripe refusait la confirmation : un moyen de paiement rattaché à un
  //    client ne peut servir qu'avec ce client. La carte enregistrée était donc
  //    inutilisable pour quiconque n'avait pas d'abonnement.
  //
  // 2. `setup_card` acceptait un `customerId` venu du navigateur. Tant que rien
  //    n'était persisté, le dégât se limitait à rattacher sa propre carte au
  //    client Stripe d'un tiers. À partir du moment où l'on persiste, le même
  //    chemin permettrait de s'attribuer le client Stripe d'autrui puis de
  //    débiter sa carte enregistrée. Le paramètre est donc simplement ignoré.
  async function clientStripeDuCompte(caller, supabaseUrl, serviceRole) {
    const hdrs = {
      "apikey": serviceRole,
      "Authorization": `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
    };
    const pr = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${caller.id}&select=stripe_customer_id`, { headers: hdrs });
    const pd = pr.ok ? await pr.json().catch(() => []) : [];
    const existant = Array.isArray(pd) && pd[0]?.stripe_customer_id;
    if (existant) return existant;

    const cr = await fetch("https://api.stripe.com/v1/customers", {
      method: "POST",
      headers: { ...stripeHeaders, "Idempotency-Key": `cus-${caller.id}` },
      body: new URLSearchParams({ email: caller.email || "", "metadata[supabase_id]": caller.id }),
    });
    const customer = await cr.json();
    if (customer.error) throw new Error(customer.error.message);

    const patch = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${caller.id}`, {
      method: "PATCH",
      headers: { ...hdrs, "Prefer": "return=minimal" },
      body: JSON.stringify({ stripe_customer_id: customer.id }),
    });
    if (!patch.ok) {
      // Sans persistance, la carte enregistrée redeviendrait inutilisable au
      // paiement suivant. On le signale plutôt que de laisser le défaut revenir.
      console.error(`[stripe-intent] stripe_customer_id non persisté pour ${caller.id} (${patch.status})`);
    }
    return customer.id;
  }

  // ── Enregistrer une carte (SetupIntent) ───────────────────────────
  if (action === "setup_card") {
    const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
    const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
    const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE);
    if (!caller) return res.status(401).json({ error: "Non authentifié" });

    try {
      const customerId = await clientStripeDuCompte(caller, SUPABASE_URL, SERVICE_ROLE);
      const sir = await fetch("https://api.stripe.com/v1/setup_intents", {
        method: "POST",
        headers: stripeHeaders,
        body: new URLSearchParams({ customer: customerId, "payment_method_types[]": "card" }),
      });
      const si = await sir.json();
      if (si.error) return res.status(400).json({ error: si.error.message });
      return res.status(200).json({ clientSecret: si.client_secret, customerId });
    } catch (e) {
      return res.status(500).json({ error: "Erreur Stripe setup" });
    }
  }

  // ── Récupérer les détails d'un PaymentMethod ──────────────────────
  if (action === "get_pm") {
    const SUPABASE_URL_PM = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
    const SERVICE_ROLE_PM = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
    const callerPm = await verifyUser(req, SUPABASE_URL_PM, SERVICE_ROLE_PM);
    if (!callerPm) return res.status(401).json({ error: "Non authentifié" });
    const { pmId } = req.body || {};
    if (!pmId) return res.status(400).json({ error: "pmId requis" });
    try {
      const r = await fetch(`https://api.stripe.com/v1/payment_methods/${pmId}`, { headers: stripeHeaders });
      const pm = await r.json();
      if (pm.error) return res.status(400).json({ error: pm.error.message });

      // L'appelant était authentifié, mais rien ne vérifiait que le moyen de
      // paiement lui appartenait : n'importe quel compte connecté pouvait lire
      // la marque et les quatre derniers chiffres de la carte d'un autre, à
      // condition d'en connaître l'identifiant. On compare au client Stripe du
      // compte, lu dans `profiles` et jamais dans la requête.
      const hdrsOwn = { "apikey": SERVICE_ROLE_PM, "Authorization": `Bearer ${SERVICE_ROLE_PM}` };
      const prOwn = await fetch(`${SUPABASE_URL_PM}/rest/v1/profiles?id=eq.${callerPm.id}&select=stripe_customer_id`, { headers: hdrsOwn });
      const pdOwn = prOwn.ok ? await prOwn.json().catch(() => []) : [];
      const monClient = Array.isArray(pdOwn) && pdOwn[0]?.stripe_customer_id;
      if (!pm.customer || !monClient || pm.customer !== monClient) {
        console.error(`[get_pm] ${callerPm.id} a demandé ${pmId}, rattaché à ${pm.customer || "aucun client"}`);
        return res.status(403).json({ error: "Ce moyen de paiement n'est pas rattaché à votre compte" });
      }

      return res.status(200).json({ brand: pm.card?.brand || "card", last4: pm.card?.last4 || "••••" });
    } catch (e) {
      console.error("[get_pm] erreur :", e.message);
      return res.status(500).json({ error: "Erreur récupération carte" });
    }
  }

  // ── Supprimer la carte enregistrée ────────────────────────────────
  //
  // « Supprimer ma carte » n'effaçait que l'affichage, côté navigateur : le moyen
  // de paiement restait attaché au client Stripe. L'utilisateur croyait avoir
  // supprimé une donnée bancaire qui était toujours conservée.
  if (action === "detach_pm") {
    const SUPABASE_URL_DT = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
    const SERVICE_ROLE_DT = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
    const callerDt = await verifyUser(req, SUPABASE_URL_DT, SERVICE_ROLE_DT);
    if (!callerDt) return res.status(401).json({ error: "Non authentifié" });
    const { pmId: pmToDetach } = req.body || {};
    if (!pmToDetach) return res.status(400).json({ error: "pmId requis" });
    try {
      const r = await fetch(`https://api.stripe.com/v1/payment_methods/${pmToDetach}`, { headers: stripeHeaders });
      const pm = await r.json();
      if (pm.error) return res.status(400).json({ error: pm.error.message });

      // Même contrôle d'appartenance que get_pm : on ne détache que sa propre carte.
      const hdrsDt = { "apikey": SERVICE_ROLE_DT, "Authorization": `Bearer ${SERVICE_ROLE_DT}` };
      const prDt = await fetch(`${SUPABASE_URL_DT}/rest/v1/profiles?id=eq.${callerDt.id}&select=stripe_customer_id`, { headers: hdrsDt });
      const pdDt = prDt.ok ? await prDt.json().catch(() => []) : [];
      const monClientDt = Array.isArray(pdDt) && pdDt[0]?.stripe_customer_id;
      if (!pm.customer || !monClientDt || pm.customer !== monClientDt) {
        console.error(`[detach_pm] ${callerDt.id} a tenté de détacher ${pmToDetach}, rattaché à ${pm.customer || "aucun client"}`);
        return res.status(403).json({ error: "Ce moyen de paiement n'est pas rattaché à votre compte" });
      }

      const dr = await fetch(`https://api.stripe.com/v1/payment_methods/${pmToDetach}/detach`, {
        method: "POST", headers: stripeHeaders,
      });
      const detached = await dr.json();
      if (detached.error) {
        console.error(`[detach_pm] Stripe a refusé le détachement de ${pmToDetach} :`, detached.error.message);
        return res.status(400).json({ error: "La carte n'a pas pu être supprimée. Réessayez ou écrivez à direction@alane.fr." });
      }
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("[detach_pm] erreur :", e.message);
      return res.status(500).json({ error: "Erreur lors de la suppression de la carte" });
    }
  }

  // ── Portail de facturation Stripe (gérer / annuler abonnement) ───────────
  if (action === "billing_portal") {
    const SUPABASE_URL_BP = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
    const SERVICE_ROLE_BP = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
    const callerBp = await verifyUser(req, SUPABASE_URL_BP, SERVICE_ROLE_BP);
    if (!callerBp) return res.status(401).json({ error: "Non authentifié" });
    try {
      const hdrs = { "apikey": SERVICE_ROLE_BP, "Authorization": `Bearer ${SERVICE_ROLE_BP}` };
      const profR = await fetch(`${SUPABASE_URL_BP}/rest/v1/profiles?id=eq.${callerBp.id}&select=stripe_customer_id`, { headers: hdrs });
      const profData = profR.ok ? await profR.json().catch(() => []) : [];
      const customerId = Array.isArray(profData) && profData[0]?.stripe_customer_id || null;
      if (!customerId) return res.status(400).json({ error: "Aucun abonnement Stripe trouvé" });
      const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, "") || (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr";
      const portalR = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ customer: customerId, return_url: `${origin}/` }).toString(),
      });
      const portal = await portalR.json();
      if (portal.error) return res.status(400).json({ error: portal.error.message });
      return res.status(200).json({ url: portal.url });
    } catch (e) {
      console.error("billing_portal error:", e);
      return res.status(500).json({ error: "Erreur portail Stripe" });
    }
  }

  // ── Créer un PaymentIntent ────────────────────────────────────────
  const SUPABASE_URL_PI = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_PI = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  const callerPi = await verifyUser(req, SUPABASE_URL_PI, SERVICE_ROLE_PI);
  if (!callerPi) return res.status(401).json({ error: "Non authentifié" });
  if (description !== undefined && (typeof description !== "string" || description.length > 500)) return res.status(400).json({ error: "La description ne doit pas dépasser 500 caractères" });

  // mission_id obligatoire — le montant est toujours calculé depuis la DB, jamais depuis le client
  if (!intentMissionId || !/^[0-9a-f-]{36}$/i.test(intentMissionId)) {
    return res.status(400).json({ error: "mission_id requis et doit être un UUID valide" });
  }

  const hdrsPI = { "apikey": SERVICE_ROLE_PI, "Authorization": `Bearer ${SERVICE_ROLE_PI}`, "Content-Type": "application/json" };
  const mRes = await fetch(`${SUPABASE_URL_PI}/rest/v1/missions?id=eq.${intentMissionId}&select=id,client_id,prestataire_id,tarif_horaire,hours,montant_total,status,date_debut,date_fin`, { headers: hdrsPI });
  const mData = await mRes.json();
  const mission = Array.isArray(mData) && mData[0];
  if (!mission) return res.status(404).json({ error: "Prestation introuvable" });
  if (mission.client_id !== callerPi.id) return res.status(403).json({ error: "Accès interdit — vous n'êtes pas le client de cette prestation" });
  if (!["open", "pending_acceptance"].includes(mission.status)) {
    return res.status(400).json({ error: "Un paiement ne peut être créé que pour une prestation ouverte ou en attente d'attribution" });
  }
  const computed = mission.montant_total
    ? Number(mission.montant_total)
    : Number(mission.tarif_horaire || 0) * Number(mission.hours || 0);
  if (!computed || computed <= 0) return res.status(400).json({ error: "Montant de la prestation invalide ou non défini" });

  // Cohérence du montant à encaisser.
  //
  // Le commentaire ci-dessus affirmait que « le montant est toujours calculé depuis
  // la base, jamais depuis le client ». C'était faux dans les faits : la ligne
  // `missions` est insérée par le navigateur du client, et le déclencheur
  // `missions_field_tamper_guard` ne protège que les UPDATE — jamais les INSERT.
  // Un client pouvait donc créer sa prestation avec montant_total = 1 €, payer 1 €,
  // puis se faire affecter un prestataire à 200 €. Le prestataire était la victime :
  // c'est ce montant qui détermine sa rémunération.
  //
  // Le montant est vérifié par sa décomposition, sans reproduire toute la grille
  // tarifaire du tunnel de réservation : ce qui reste après la part horaire doit
  // être l'un des trois frais de service légitimes. Toute autre valeur signifie que
  // le total a été fabriqué.
  // La règle vit dans _montant.js, partagée avec le paiement par portefeuille :
  // deux chemins d'encaissement doivent appliquer le même contrôle.
  {
    const frais = await lireFraisService(SUPABASE_URL_PI, hdrsPI);
    const v = verifierMontant(mission, computed, frais);
    if (!v.ok) {
      console.error("[stripe-intent] " + messageIncoherence(intentMissionId, computed, v));
      return res.status(400).json({ error: ERREUR_MONTANT });
    }
  }
  const amount = computed;
  const missionMetaId = intentMissionId;

  // prestataire_id lu depuis la DB, jamais depuis le body client
  const prestataire_id_db = mission.prestataire_id || "";

  // Récupérer la candidature acceptée pour la lier au paiement
  let candidatureId = "";
  if (prestataire_id_db) {
    try {
      const cRes = await fetch(
        `${SUPABASE_URL_PI}/rest/v1/candidatures?mission_id=eq.${intentMissionId}&prestataire_id=eq.${prestataire_id_db}&status=eq.pending&select=id&limit=1`,
        { headers: hdrsPI }
      );
      const cData = await cRes.json().catch(() => []);
      if (Array.isArray(cData) && cData[0]) candidatureId = cData[0].id;
    } catch {}
  }

  if (amount < 1) return res.status(400).json({ error: "Montant invalide (min 1€)" });
  if (amount > 50000) return res.status(400).json({ error: "Montant invalide (max 50 000€)" });

  // Client Stripe du compte appelant, lu — et créé si besoin — côté serveur.
  //
  // Le PaymentIntent doit toujours porter le `customer` : sans lui, Stripe refuse
  // toute confirmation avec un moyen de paiement enregistré, puisqu'un moyen de
  // paiement rattaché à un client ne peut servir qu'avec ce client.
  //
  // L'échec n'interrompt pas le paiement : une carte saisie à la main fonctionne
  // sans `customer`. On journalise, la carte enregistrée sera seulement inopérante
  // pour cette tentative.
  let validatedCustomerId = null;
  try {
    validatedCustomerId = await clientStripeDuCompte(callerPi, SUPABASE_URL_PI, SERVICE_ROLE_PI);
  } catch (e) {
    console.error(`[stripe-intent] client Stripe indisponible pour ${callerPi.id} :`, e.message);
  }

  try {
    const params = {
      amount: String(Math.round(amount * 100)),
      currency,
      "payment_method_types[]": "card",
      "metadata[mission]":        missionMetaId,
      "metadata[client]":         callerPi.id || "",
      "metadata[prestataire_id]": prestataire_id_db,
      "metadata[candidature_id]": candidatureId,
    };
    if (validatedCustomerId) params.customer = validatedCustomerId;

    const r = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      // La clé d'idempotence protège du double-clic : deux envois identiques
      // rendent le même PaymentIntent au lieu d'en créer deux.
      //
      // Le montant en fait désormais partie. Sans lui, une seconde tentative avec
      // un montant différent réutilisait la clé, et Stripe répondait par une
      // erreur d'idempotence — affichée telle quelle, en anglais, à l'utilisateur.
      //
      // Le préfixe `pi2` marque le passage au PaymentIntent avec `customer` : les
      // clés `pi-` émises dans les vingt-quatre heures précédant le déploiement
      // portent des paramètres différents et auraient provoqué la même erreur.
      headers: { ...stripeHeaders, "Idempotency-Key": `pi2-${missionMetaId}-${callerPi.id}-${params.amount}` },
      body: new URLSearchParams(params),
    });
    const intent = await r.json();
    if (intent.error) return res.status(400).json({ error: intent.error.message });
    return res.status(200).json({ clientSecret: intent.client_secret, intentId: intent.id });
  } catch (e) {
    console.error("stripe-intent error:", e);
    return res.status(500).json({ error: "Erreur Stripe" });
  }
}
