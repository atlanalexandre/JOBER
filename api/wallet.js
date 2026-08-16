import { verifyUser } from "./_auth.js";
import { lireFraisService, verifierMontant, messageIncoherence, ERREUR_MONTANT } from "./_montant.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Configuration serveur manquante" });

  const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
  if (!caller) return res.status(401).json({ error: "Non authentifié" });

  const { action, mission_id } = req.body || {};
  const hdrs = {
    "apikey":        SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
    "Prefer":        "return=representation",
  };

  // ── GET BALANCE ────────────────────────────────────────────────
  if (action === "get_balance") {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=prepaid_balance`, { headers: hdrs });
      const data = await r.json().catch(() => []);
      const balance = Number(Array.isArray(data) && data[0]?.prepaid_balance || 0);
      return res.status(200).json({ balance });
    } catch (e) {
      return res.status(500).json({ error: "Erreur lecture solde" });
    }
  }

  // ── TRANSFÉRER LE CASHBACK VERS LE PORTEFEUILLE PRÉPAYÉ ─────────
  // Le cashback était crédité mais ne pouvait être dépensé nulle part : aucun
  // code ne le débitait jamais. Le portefeuille prépayé, lui, est bien débité
  // par pay_mission ci-dessous. Le transfert se fait ici, en service role : le
  // client ne doit pas pouvoir écrire ses propres soldes.
  // L'action « transfer_cashback » a été retirée le 16/08/2026.
  //
  // Elle versait le cashback dans `prepaid_balance`, où il devenait indiscernable
  // des sommes rechargées par carte. Or leur nature diffère : le cashback est un
  // avantage commercial accordé par ALANE, les recharges sont de l'argent reçu du
  // client. Les mélanger rendait impossible de démontrer laquelle était laquelle
  // — donc de les traiter différemment, ce que le remboursement exige.
  //
  // Les deux soldes restent séparés, et le paiement consomme d'abord le cashback
  // (voir « pay_mission ») : le client dépense l'avantage avant son propre argent,
  // ce qui est l'ordre le plus favorable pour lui.

  // ── REMBOURSEMENT DU SOLDE ──────────────────────────────────────
  //
  // Le rechargement étant suspendu, le client doit pouvoir récupérer ce qu'il a
  // déposé. Un solde reçu du public, conservé sans terme et sans possibilité de
  // retrait, s'analyse mal — au regard du régime de la monnaie électronique
  // comme du droit des clauses abusives.
  //
  // Le remboursement s'impute sur les recharges enregistrées dans
  // `wallet_topups`, de la plus récente à la plus ancienne, chacune portant le
  // montant déjà rendu. Le CASHBACK n'est pas remboursable : ce n'est pas de
  // l'argent reçu du client, c'est un avantage commercial (CGPS art. 5B.4). Le
  // solde remboursable est donc plafonné à ce qui reste des recharges par carte.
  if (action === "rembourser_solde") {
    try {
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=prepaid_balance`, { headers: hdrs });
      const pd = await pr.json().catch(() => []);
      const prof = Array.isArray(pd) && pd[0];
      if (!prof) return res.status(404).json({ error: "Profil introuvable" });

      const solde = Number(prof.prepaid_balance || 0);
      if (solde <= 0) return res.status(400).json({ error: "Votre portefeuille est vide." });

      const tRes = await fetch(
        `${SUPABASE_URL}/rest/v1/wallet_topups?user_id=eq.${caller.id}`
        + `&select=stripe_payment_intent,amount,montant_rembourse&order=created_at.desc`,
        { headers: hdrs }
      );
      if (!tRes.ok) {
        const detail = await tRes.text().catch(() => "");
        console.error(`[rembourser_solde] registre illisible (${tRes.status}) : ${detail.slice(0, 200)}`);
        return res.status(503).json({ error: "Remboursement indisponible pour le moment — réessayez plus tard." });
      }
      const recharges = await tRes.json().catch(() => []);

      const remboursableC = (Array.isArray(recharges) ? recharges : []).reduce(
        (t, r) => t + Math.round((Number(r.amount || 0) - Number(r.montant_rembourse || 0)) * 100), 0
      );
      // On ne rend jamais plus que ce qui reste au portefeuille, ni plus que ce
      // qui a été rechargé par carte : le cashback consommé aurait sinon été
      // converti en euros remboursables.
      let resteC = Math.min(Math.round(solde * 100), Math.max(0, remboursableC));
      if (resteC <= 0) {
        return res.status(400).json({
          error: "Votre solde provient du cashback, qui n'est pas remboursable en argent (CGPS art. 5B.4). "
               + "Il reste utilisable pour régler vos prestations.",
        });
      }

      const STRIPE_SK = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
      if (!STRIPE_SK) return res.status(500).json({ error: "Stripe non configuré" });

      let rembourseC = 0;
      const emis = [];
      for (const r of recharges) {
        if (resteC <= 0) break;
        const restantSurCetteRechargeC = Math.round((Number(r.amount || 0) - Number(r.montant_rembourse || 0)) * 100);
        if (restantSurCetteRechargeC <= 0) continue;
        const partC = Math.min(resteC, restantSurCetteRechargeC);

        const rf = await fetch("https://api.stripe.com/v1/refunds", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${STRIPE_SK}`,
            "Content-Type": "application/x-www-form-urlencoded",
            // Une même recharge ne peut donner lieu qu'à un remboursement par
            // montant cumulé, quel que soit le nombre de tentatives du client.
            "Idempotency-Key": `wallet-refund-${r.stripe_payment_intent}-${Number(r.montant_rembourse || 0) + partC / 100}`,
          },
          body: new URLSearchParams({
            payment_intent: r.stripe_payment_intent,
            amount: String(partC),
            "metadata[type]": "wallet_refund",
            "metadata[user_id]": caller.id,
          }).toString(),
        }).catch(e => { console.error(`[rembourser_solde] appel Stripe échoué sur ${r.stripe_payment_intent} :`, e.message); return null; });

        const rd = rf ? await rf.json().catch(() => ({})) : {};
        if (!rf || !rf.ok || !rd.id) {
          // On s'arrête au premier échec plutôt que de continuer : le solde a
          // déjà été décrémenté des remboursements réussis, et poursuivre
          // masquerait l'incident derrière un succès partiel silencieux.
          console.error(`[rembourser_solde] Stripe a refusé ${r.stripe_payment_intent} :`, rd?.error?.message || rf?.status);
          break;
        }

        // La trace AVANT le solde : si l'écriture du solde échoue, on aura
        // remboursé sans débiter — récupérable. L'inverse ne l'est pas.
        const maj = await fetch(
          `${SUPABASE_URL}/rest/v1/wallet_topups?stripe_payment_intent=eq.${encodeURIComponent(r.stripe_payment_intent)}`,
          { method: "PATCH", headers: { ...hdrs, "Prefer": "return=minimal" },
            body: JSON.stringify({ montant_rembourse: Math.round((Number(r.montant_rembourse || 0) * 100 + partC)) / 100 }) }
        ).catch(() => null);
        if (!maj || !maj.ok) {
          console.error(`[rembourser_solde] remboursement ${rd.id} émis mais NON tracé sur ${r.stripe_payment_intent} — `
            + "à reprendre à la main avant toute nouvelle demande de ce client.");
          break;
        }

        rembourseC += partC;
        resteC -= partC;
        emis.push(rd.id);
      }

      if (rembourseC <= 0) {
        return res.status(502).json({ error: "Le remboursement n'a pas pu être émis. Écrivez à support@alane.fr." });
      }

      const nouveauSolde = Math.round((solde * 100 - rembourseC)) / 100;
      const patch = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&prepaid_balance=eq.${prof.prepaid_balance}`,
        { method: "PATCH", headers: { ...hdrs, "Prefer": "return=representation" },
          body: JSON.stringify({ prepaid_balance: nouveauSolde }) }
      );
      const patched = await patch.json().catch(() => []);
      if (!Array.isArray(patched) || patched.length === 0) {
        // Le solde a bougé entre la lecture et l'écriture. L'argent est parti :
        // il faut que cela se voie, pas que le client soit remboursé deux fois.
        console.error(`[rembourser_solde] ${(rembourseC/100).toFixed(2)} € remboursés à ${caller.id} `
          + `(${emis.join(", ")}) mais solde NON décrémenté — concurrence. À régulariser à la main.`);
        return res.status(409).json({ error: "Votre solde a changé pendant l'opération — contactez support@alane.fr." });
      }

      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
        method: "POST", headers: { ...hdrs, "Prefer": "return=minimal" },
        body: JSON.stringify({ user_id: caller.id, type: "system",
          title: "Remboursement de votre portefeuille",
          body: `${(rembourseC/100).toFixed(2).replace(".", ",")} € vous sont remboursés sur le moyen de paiement d'origine. `
              + `Comptez 5 à 10 jours ouvrés selon votre banque.`,
          read: false }),
      }).catch(() => {});

      console.log(`[rembourser_solde] ${(rembourseC/100).toFixed(2)} € remboursés à ${caller.id} — ${emis.join(", ")}`);
      return res.status(200).json({
        success: true,
        rembourse: Math.round(rembourseC) / 100,
        prepaid_balance: nouveauSolde,
        partiel: resteC > 0,
      });
    } catch (e) {
      console.error("[rembourser_solde] erreur :", e.message);
      return res.status(500).json({ error: "Erreur lors du remboursement" });
    }
  }

  // ── PAY MISSION FROM WALLET ─────────────────────────────────────
  if (action === "pay_mission") {
    if (!mission_id || !/^[0-9a-f-]{36}$/i.test(mission_id)) {
      return res.status(400).json({ error: "mission_id invalide" });
    }

    // 1. Fetch mission
    const mRes = await fetch(
      `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,client_id,prestataire_id,montant_total,tarif_horaire,hours,status,date_debut,date_fin`,
      { headers: hdrs }
    );
    const mData = await mRes.json().catch(() => []);
    const mission = Array.isArray(mData) && mData[0];
    if (!mission) return res.status(404).json({ error: "Prestation introuvable" });
    if (mission.client_id !== caller.id) return res.status(403).json({ error: "Accès interdit" });
    if (!["open", "pending_acceptance"].includes(mission.status)) {
      return res.status(400).json({ error: "La prestation n'est pas dans un état permettant le paiement" });
    }

    const amount = mission.montant_total
      ? Number(mission.montant_total)
      : Number(mission.tarif_horaire || 0) * Number(mission.hours || 0);
    if (!amount || amount <= 0) return res.status(400).json({ error: "Montant de la prestation invalide" });

    // Cohérence du montant — même contrôle que le paiement par carte.
    //
    // La ligne `missions` est insérée par le navigateur du client, et la garde
    // SQL `missions_creation_guard` ne pose qu'une borne basse : elle refuse des
    // frais de service négatifs, pas des frais nuls. Un client pouvait donc créer
    // sa prestation avec montant_total = tarif × heures, la régler depuis son
    // portefeuille, et ne payer aucun frais de service — soit l'intégralité de la
    // rémunération d'ALANE sur cette réservation.
    //
    // Le tunnel carte refusait ce montage depuis toujours. Le portefeuille était
    // le second chemin d'encaissement, et il n'était pas contrôlé.
    {
      const frais = await lireFraisService(SUPABASE_URL, hdrs);
      const v = verifierMontant(mission, amount, frais);
      if (!v.ok) {
        console.error("[wallet/pay_mission] " + messageIncoherence(mission_id, amount, v));
        return res.status(400).json({ error: ERREUR_MONTANT });
      }
    }

    // 2. Les deux soldes, lus séparément
    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=prepaid_balance,cashback_balance`,
      { headers: hdrs }
    );
    const profData = await profRes.json().catch(() => []);
    const prof0 = (Array.isArray(profData) && profData[0]) || {};
    const currentBalance = Number(prof0.prepaid_balance || 0);
    const currentCashback = Number(prof0.cashback_balance || 0);
    const disponible = Math.round((currentBalance + currentCashback) * 100) / 100;
    if (disponible < amount) {
      return res.status(400).json({
        error: `Solde insuffisant (${disponible.toFixed(2)} € disponible, ${amount.toFixed(2)} € requis)`,
      });
    }

    // 3. Débit : LE CASHBACK D'ABORD, les sommes rechargées ensuite.
    //
    // Les deux ne se valent pas. Le cashback est un avantage commercial accordé
    // par ALANE ; les recharges sont de l'argent reçu du client, qu'il peut se
    // faire rembourser. Consommer l'avantage en premier est donc l'ordre le plus
    // favorable au client : il conserve le plus longtemps possible ce qui lui est
    // restituable.
    //
    // Tout est calculé en centimes entiers : additionner deux soldes flottants
    // puis en soustraire un montant laisse des résidus d'un centime, et un solde
    // qui ne tombe jamais tout à fait à zéro.
    const enC = (v) => Math.round(Number(v || 0) * 100);
    const montantC = enC(amount);
    const prisSurCashbackC = Math.min(enC(currentCashback), montantC);
    const prisSurPrepaidC  = montantC - prisSurCashbackC;
    const newCashback = Math.round(enC(currentCashback) - prisSurCashbackC) / 100;
    const newBalance  = Math.round(enC(currentBalance) - prisSurPrepaidC) / 100;

    // Filtre sur les deux valeurs lues : un crédit concurrent — cashback d'une
    // autre prestation, remboursement — fait échouer l'écriture plutôt que de
    // l'écraser.
    const deductRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}`
      + `&prepaid_balance=eq.${currentBalance}&cashback_balance=eq.${currentCashback}`,
      {
        method:  "PATCH",
        headers: { ...hdrs, "Prefer": "return=representation" },
        body:    JSON.stringify({ prepaid_balance: newBalance, cashback_balance: newCashback }),
      }
    );
    const debite = await deductRes.json().catch(() => []);
    if (!deductRes.ok || !Array.isArray(debite) || debite.length === 0) {
      console.error("[wallet/pay_mission] débit refusé — solde modifié entre-temps", deductRes.status);
      return res.status(409).json({ error: "Votre solde a changé pendant l'opération — réessayez." });
    }

    // 4. Assign mission (atomic — status filter prevents double-assignment)
    const patch = { status: "assigned", stripe_payment_intent: `wallet_${mission_id}` };
    if (mission.prestataire_id) patch.prestataire_id = mission.prestataire_id;
    const mPatch = await fetch(
      `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=in.(open,pending_acceptance)`,
      { method: "PATCH", headers: hdrs, body: JSON.stringify(patch) }
    );
    const patched = await mPatch.json().catch(() => []);

    if (!Array.isArray(patched) || patched.length === 0) {
      // La prestation a été traitée entre-temps : on restaure LES DEUX soldes.
      // N'en restaurer qu'un ferait disparaître le cashback consommé.
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}`, {
        method:  "PATCH",
        headers: { ...hdrs, "Prefer": "return=minimal" },
        body:    JSON.stringify({ prepaid_balance: currentBalance, cashback_balance: currentCashback }),
      }).catch(e => console.error("[wallet/pay_mission] soldes NON restaurés :", e.message));
      return res.status(400).json({ error: "Prestation déjà traitée ou état invalide" });
    }

    // 5. Candidature + notification (secondary — non-blocking)
    if (mission.prestataire_id) {
      const candHdrs = { ...hdrs, "Prefer": "return=minimal" };
      await fetch(
        `${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${mission_id}&prestataire_id=eq.${mission.prestataire_id}`,
        { method: "PATCH", headers: candHdrs, body: JSON.stringify({ status: "accepted" }) }
      ).catch(() => {});
      await fetch(
        `${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${mission_id}&prestataire_id=neq.${mission.prestataire_id}`,
        { method: "PATCH", headers: candHdrs, body: JSON.stringify({ status: "rejected" }) }
      ).catch(() => {});
      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
        method: "POST",
        headers: { ...hdrs, "Prefer": "return=minimal" },
        body: JSON.stringify({
          user_id: mission.prestataire_id,
          type:    "mission",
          title:   "Proposition acceptée ✅",
          body:    "Votre proposition a été acceptée. Préparez-vous pour la prestation !",
          read:    false,
        }),
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, newBalance });
  }

  return res.status(400).json({ error: "Action inconnue" });
}
