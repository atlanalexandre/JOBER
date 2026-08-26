export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { plan, billing = "monthly" } = req.body || {};

  // Le rang sert à distinguer une montée en gamme d'une descente : les deux se
  // règlent au prorata, mais pas dans le même sens.
  const RANG = { free: 0, premium: 1, elite: 2 };
  const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
  const SUPABASE_URL      = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY  = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");

  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Stripe non configuré" });
  // `free` est accepté : résilier passe désormais par ici. L'écran se contentait
  // d'écrire « free » dans le profil sans rien dire à Stripe — le prestataire
  // était affiché gratuit et prélevé tous les mois, indéfiniment.
  if (!["premium","elite","free"].includes(plan)) return res.status(400).json({ error: "Plan invalide" });

  // Verify JWT to get user — requis pour lier le checkout à un compte
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Configuration serveur manquante" });
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Non authentifié" });
  let userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": auth },
    });
    if (!r.ok) return res.status(401).json({ error: "Token invalide" });
    const u = await r.json();
    userId = u.id || null;
  } catch {
    return res.status(401).json({ error: "Erreur d'authentification" });
  }
  if (!userId) return res.status(401).json({ error: "Utilisateur introuvable" });

  // DEUX NOMS POSSIBLES POUR LA MÊME VARIABLE.
  //
  // Le code réclamait `STRIPE_PRICE_ELITE_MONTHLY` ; les variables posées dans
  // Vercel s'appellent `STRIPE_ELITE_MONTHLY`, sans `PRICE_`. Les quatre
  // tarifs étaient donc introuvables, et aucun abonnement ne pouvait être
  // souscrit — ni Elite, ni Premium.
  //
  // On accepte les deux écritures plutôt que d'exiger une renomination : ces
  // variables sont marquées « Sensitive » dans Vercel, donc illisibles après
  // enregistrement. Les renommer imposerait de retrouver les quatre
  // identifiants de tarif dans Stripe et de tout ressaisir — quatre occasions
  // de se tromper, pour un préfixe.
  //
  // La forme longue reste la référence : c'est elle que la documentation
  // décrit, et c'est elle qu'on posera sur l'environnement de production.
  const suffixe = plan === "premium"
    ? (billing === "yearly" ? "PREMIUM_YEARLY" : "PREMIUM_MONTHLY")
    : (billing === "yearly" ? "ELITE_YEARLY"   : "ELITE_MONTHLY");
  const nomsPossibles = [`STRIPE_PRICE_${suffixe}`, `STRIPE_${suffixe}`];
  const nomTrouve = nomsPossibles.find(n => (process.env[n] || "").trim());
  const priceId = nomTrouve ? process.env[nomTrouve].replace(/\s/g, "") : null;

  // Résilier ne consulte aucun tarif : exiger un `priceId` ici refuserait la
  // résiliation avec « Tarif elite indisponible », ce qui n'a aucun sens.
  if (!priceId && plan !== "free") {
    console.error(`[abonnement] tarif introuvable pour ${plan}/${billing} — `
      + `ni ${nomsPossibles[0]} ni ${nomsPossibles[1]} ne sont renseignées.`);
    return res.status(500).json({
      error: `Tarif ${plan} indisponible. Renseignez ${nomsPossibles[0]} dans Vercel.`,
    });
  }
  if (nomTrouve === nomsPossibles[1]) {
    console.log(`[abonnement] tarif lu depuis ${nomTrouve} — nom hérité, `
      + `${nomsPossibles[0]} est la forme de référence.`);
  }

  const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, "") || (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr";

  // Reuse existing Stripe Customer to avoid duplicates
  let existingCustomerId = null;
  let abonnementActuel   = null;
  let planActuel         = "free";
  if (userId && SUPABASE_URL && SERVICE_ROLE_KEY) {
    try {
      const hdrs = { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}` };
      const profR = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=stripe_customer_id,stripe_subscription_id,plan_abonnement`, { headers: hdrs });
      if (profR.ok) {
        const profData = await profR.json();
        const prof = Array.isArray(profData) && profData[0];
        existingCustomerId = prof?.stripe_customer_id     || null;
        abonnementActuel   = prof?.stripe_subscription_id || null;
        planActuel         = prof?.plan_abonnement        || "free";
      }
    } catch (e) { console.error("[stripe-subscription] profil illisible — un nouveau client Stripe sera créé :", e.message); }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CHANGER D'ABONNEMENT : ON MODIFIE, ON N'EN CRÉE PAS UN SECOND
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Un prestataire en Premium qui passait Elite repartait dans un tunnel de
  // paiement neuf, et se retrouvait avec DEUX abonnements actifs : 29 € + 59 €
  // prélevés chaque mois. Le profil ne gardait que le dernier identifiant, si
  // bien que le premier n'était plus surveillé par personne.
  //
  // Pire : le jour où cet abonnement fantôme finissait par être résilié, le
  // webhook `customer.subscription.deleted` retrouvait le client par son
  // identifiant Stripe et le repassait en gratuit — un abonné Elite dégradé
  // alors qu'il payait toujours.
  //
  // Un changement de formule modifie donc l'abonnement EXISTANT. Stripe calcule
  // le prorata : ce qui reste du mois déjà payé vient en déduction.
  if (abonnementActuel) {
    const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${abonnementActuel}`, {
      headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` },
    });
    const sub = await subRes.json().catch(() => ({}));
    const vivant = subRes.ok && ["active", "trialing", "past_due"].includes(sub?.status);

    if (!vivant) {
      // Abonnement mort côté Stripe : la référence en base est périmée. On la
      // laisse au tunnel de paiement normal plus bas, et on le signale.
      console.log(`[abonnement] ${abonnementActuel} est ${sub?.status || "introuvable"} — souscription neuve pour ${userId}.`);
    } else if (plan === "free") {
      // ── Résiliation ────────────────────────────────────────────────
      //
      // À la FIN DE LA PÉRIODE, jamais dans la seconde : le mois est payé, il
      // est dû. Couper l'accès immédiatement reviendrait à garder l'argent sans
      // fournir le service.
      const annul = await fetch(`https://api.stripe.com/v1/subscriptions/${abonnementActuel}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ cancel_at_period_end: "true" }).toString(),
      });
      const d = await annul.json().catch(() => ({}));
      if (!annul.ok) {
        console.error(`[abonnement] résiliation refusée pour ${abonnementActuel} :`, JSON.stringify(d).slice(0, 300));
        return res.status(502).json({ error: `Stripe a refusé la résiliation : ${d?.error?.message || "erreur inconnue"}` });
      }
      const fin = d.current_period_end ? new Date(d.current_period_end * 1000) : null;
      console.log(`[abonnement] ${abonnementActuel} résilié en fin de période pour ${userId}.`);
      return res.status(200).json({
        change: true,
        message: fin
          ? `Votre abonnement prendra fin le ${fin.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}. Vous en gardez tous les avantages jusque-là.`
          : "Votre abonnement prendra fin à l'échéance de la période en cours. Vous en gardez tous les avantages jusque-là.",
      });
    } else {
      const ligne = sub.items?.data?.[0];
      if (!ligne?.id) {
        console.error(`[abonnement] ${abonnementActuel} sans ligne exploitable — changement impossible.`);
        return res.status(502).json({ error: "Votre abonnement n'a pas pu être lu. Écrivez à direction@alane.fr." });
      }
      const monte = (RANG[plan] ?? 0) > (RANG[planActuel] ?? 0);

      if (monte) {
        // ── Montée en gamme : tout de suite ──────────────────────────
        //
        // Le nouveau quota est disponible dans la seconde, il se paie dans la
        // seconde. Le laisser courir jusqu'au mois suivant offrirait une
        // formule supérieure à qui sait cliquer au bon moment.
        const maj = await fetch(`https://api.stripe.com/v1/subscriptions/${abonnementActuel}`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            "items[0][id]":    ligne.id,
            "items[0][price]": priceId,
            proration_behavior: "always_invoice",
            "metadata[plan]":    plan,
            "metadata[user_id]": userId || "",
            cancel_at_period_end: "false",
          }).toString(),
        });
        const d = await maj.json().catch(() => ({}));
        if (!maj.ok) {
          console.error(`[abonnement] montée refusée pour ${abonnementActuel} :`, JSON.stringify(d).slice(0, 300));
          return res.status(502).json({ error: `Stripe a refusé le changement : ${d?.error?.message || "erreur inconnue"}` });
        }
        console.log(`[abonnement] ${userId} : ${planActuel} → ${plan} (montée), abonnement ${abonnementActuel} modifié.`);
        return res.status(200).json({
          change: true,
          message: "Votre nouvelle formule est active. Seule la différence vous est facturée pour les jours restants du mois en cours.",
        });
      }

      // ── Descente en gamme : à la fin de la période payée ────────────
      //
      // Décision d'Alexandre du 24/08/2026 : AUCUNE DÉDUCTION pour une
      // rétrogradation en cours de mois.
      //
      // Cela ne peut pas vouloir dire « formule inférieure tout de suite, et le
      // trop-payé reste chez ALANE » : ce serait encaisser le prix d'Elite en
      // fournissant Premium, ce qu'un client conteste et obtient. La seule
      // lecture qui tienne est l'inverse : le prestataire GARDE sa formule
      // jusqu'au terme qu'il a payé, et la nouvelle prend effet ensuite. Rien
      // n'est déduit parce que rien n'est dû — il a consommé ce qu'il a réglé.
      //
      // Stripe appelle cela un « calendrier d'abonnement » : la phase en cours
      // va jusqu'à son terme, la suivante applique le nouveau tarif. Un
      // changement de prix immédiat, même sans prorata, ne saurait pas faire ça.
      let calendrierId = sub.schedule || null;
      let phaseEnCours = null;

      if (!calendrierId) {
        const cr = await fetch("https://api.stripe.com/v1/subscription_schedules", {
          method: "POST",
          headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ from_subscription: abonnementActuel }).toString(),
        });
        const cd = await cr.json().catch(() => ({}));
        if (!cr.ok || !cd.id) {
          console.error(`[abonnement] calendrier non créé pour ${abonnementActuel} :`, JSON.stringify(cd).slice(0, 300));
          return res.status(502).json({ error: `Stripe a refusé la programmation : ${cd?.error?.message || "erreur inconnue"}` });
        }
        calendrierId = cd.id;
        phaseEnCours = cd.phases?.[0] || null;
      } else {
        const lr = await fetch(`https://api.stripe.com/v1/subscription_schedules/${calendrierId}`, {
          headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` },
        });
        const ld = await lr.json().catch(() => ({}));
        // Un calendrier déjà posé signifie qu'un changement est en attente. On
        // le REMPLACE plutôt que d'en empiler un second : c'est la dernière
        // volonté du prestataire qui compte.
        phaseEnCours = ld.phases?.[0] || null;
        console.log(`[abonnement] calendrier ${calendrierId} déjà en place pour ${userId} — remplacé.`);
      }

      const prixActuel = phaseEnCours?.items?.[0]?.price;
      if (!phaseEnCours || !prixActuel || !phaseEnCours.start_date || !phaseEnCours.end_date) {
        console.error(`[abonnement] phase en cours illisible sur ${calendrierId} — programmation abandonnée.`);
        return res.status(502).json({ error: "Le changement n'a pas pu être programmé. Écrivez à direction@alane.fr." });
      }

      const prog = await fetch(`https://api.stripe.com/v1/subscription_schedules/${calendrierId}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          // La phase en cours est répétée à l'identique : Stripe exige qu'on la
          // redonne, et la moindre différence la réécrirait.
          "phases[0][items][0][price]":    typeof prixActuel === "string" ? prixActuel : prixActuel.id,
          "phases[0][items][0][quantity]": "1",
          "phases[0][start_date]":         String(phaseEnCours.start_date),
          "phases[0][end_date]":           String(phaseEnCours.end_date),
          // Puis la nouvelle formule, sans prorata : il n'y a rien à répartir,
          // le changement tombe pile à l'échéance.
          "phases[1][items][0][price]":    priceId,
          "phases[1][items][0][quantity]": "1",
          "phases[1][proration_behavior]": "none",
          // La métadonnée suit la phase : sans elle, le webhook qui applique le
          // nouveau plan au renouvellement ne saurait pas lequel appliquer.
          "phases[1][metadata][plan]":     plan,
          "phases[1][metadata][user_id]":  userId || "",
          end_behavior: "release",
        }).toString(),
      });
      const pd = await prog.json().catch(() => ({}));
      if (!prog.ok) {
        console.error(`[abonnement] programmation refusée sur ${calendrierId} :`, JSON.stringify(pd).slice(0, 300));
        return res.status(502).json({ error: `Stripe a refusé la programmation : ${pd?.error?.message || "erreur inconnue"}` });
      }

      const bascule = phaseEnCours.end_date ? new Date(phaseEnCours.end_date * 1000) : null;
      console.log(`[abonnement] ${userId} : ${planActuel} → ${plan} (descente) programmée `
        + `au ${bascule ? bascule.toISOString().slice(0, 10) : "terme de la période"} — calendrier ${calendrierId}.`);
      return res.status(200).json({
        change: true,
        // Le plan N'A PAS changé aujourd'hui : l'écran ne doit pas l'afficher
        // comme tel, sans quoi le prestataire croit avoir perdu sa formule.
        differe: true,
        message: bascule
          ? `Vous gardez votre formule actuelle jusqu'au ${bascule.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}, terme de la période déjà réglée. La nouvelle formule prendra effet ce jour-là, sans rien vous prélever d'ici là.`
          : "Vous gardez votre formule actuelle jusqu'au terme de la période déjà réglée. La nouvelle formule prendra effet à ce moment-là.",
      });
    }
  }

  // Aucun abonnement à modifier : résilier n'a pas de sens.
  if (plan === "free") {
    return res.status(400).json({ error: "Vous n'avez aucun abonnement en cours." });
  }

  try {
    const params = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${origin}/?sub_success=1&plan=${plan}`,
      cancel_url:  `${origin}/?sub_cancel=1`,
      "metadata[plan]":    plan,
      "metadata[billing]": billing,
      "metadata[user_id]": userId || "",
      // Pass plan in subscription metadata so lifecycle webhooks can read it
      "subscription_data[metadata][plan]":    plan,
      "subscription_data[metadata][user_id]": userId || "",
    });
    if (userId) params.set("client_reference_id", userId);
    if (existingCustomerId) {
      params.set("customer", existingCustomerId);
    }

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type":  "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await r.json();
    if (session.error) return res.status(400).json({ error: session.error.message });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("stripe-subscription error:", e);
    return res.status(500).json({ error: "Erreur Stripe" });
  }
}
