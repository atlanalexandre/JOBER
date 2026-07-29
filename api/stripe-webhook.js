export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const STRIPE_SECRET_KEY      = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
  const STRIPE_WEBHOOK_SECRET  = (process.env.STRIPE_WEBHOOK_SECRET || "").replace(/\s/g, "");
  const SUPABASE_URL           = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY       = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");

  if (!STRIPE_SECRET_KEY) return res.status(500).end();

  // STRIPE_WEBHOOK_SECRET est obligatoire en production — sans lui, n'importe qui peut forger des événements
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET non configuré — webhook rejeté pour sécurité");
    return res.status(500).json({ error: "Webhook non configuré" });
  }

  const rawBody = await getRawBody(req);
  const sig     = req.headers["stripe-signature"];

  // Vérification signature — toujours obligatoire
  if (!sig) return res.status(400).json({ error: "Signature manquante" });
  try {
    const crypto = await import("crypto");
    const tsMatch = sig.match(/t=(\d+)/);
    const v1Matches = [...sig.matchAll(/v1=([a-f0-9]+)/g)].map(m => m[1]);
    const tsStr = tsMatch?.[1];
    if (!tsStr || !v1Matches.length) return res.status(400).json({ error: "Signature invalide" });
    if (Math.abs(Date.now() / 1000 - parseInt(tsStr, 10)) > 300) return res.status(400).json({ error: "Timestamp expiré" });
    const payload  = `${tsStr}.${rawBody.toString()}`;
    const expected = crypto.default.createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(payload).digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    const valid = v1Matches.some(v1 => {
      try { return expectedBuf.length === v1.length / 2 && crypto.default.timingSafeEqual(expectedBuf, Buffer.from(v1, "hex")); } catch { return false; }
    });
    if (!valid) return res.status(400).json({ error: "Signature invalide" });
  } catch { return res.status(400).json({ error: "Erreur signature" }); }

  let event;
  try { event = JSON.parse(rawBody.toString()); }
  catch { return res.status(400).json({ error: "JSON invalide" }); }

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object;

    // ── Recharge wallet ───────────────────────────────────────────
    if (intent.metadata?.type === "wallet_topup") {
      const topupUserId = intent.metadata?.user_id;
      const topupAmount = Number(intent.metadata?.amount_euros) || (intent.amount / 100);
      if (topupUserId && topupAmount > 0 && SUPABASE_URL && SERVICE_ROLE_KEY) {
        const wHdrs = {
          "apikey":        SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type":  "application/json",
          "Prefer":        "return=minimal",
        };
        try {
          const profR    = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${topupUserId}&select=prepaid_balance`, {
            headers: { ...wHdrs, "Prefer": "return=representation" },
          });
          const profData = await profR.json().catch(() => []);
          const current  = Number(Array.isArray(profData) && profData[0]?.prepaid_balance || 0);
          const newBal   = Math.round((current + topupAmount) * 100) / 100;
          const upd = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${topupUserId}`, {
            method: "PATCH", headers: wHdrs, body: JSON.stringify({ prepaid_balance: newBal }),
          });
          if (!upd.ok) {
            console.error("[stripe-webhook/wallet_topup] PATCH failed", upd.status);
            return res.status(500).json({ error: "Wallet update failed" });
          }
          await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
            method: "POST", headers: wHdrs,
            body: JSON.stringify({
              user_id: topupUserId, type: "cashback",
              title: "Wallet rechargé 💳",
              body: `${topupAmount.toFixed(2).replace(".", ",")} € ajoutés à votre wallet ALANE. Solde : ${newBal.toFixed(2).replace(".", ",")} €.`,
              read: false,
            }),
          }).catch(e => console.error("[wallet_topup] notification failed:", e));
          // Email de confirmation de recharge
          const RESEND_API_KEY_W = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
          const RESEND_FROM_W    = process.env.RESEND_FROM || "ALANE <no-reply@alane.fr>";
          if (RESEND_API_KEY_W) {
            try {
              const userR = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${topupUserId}`, {
                headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}` },
              });
              if (userR.ok) {
                const uData = await userR.json();
                const userEmail = uData?.email;
                const prenom = uData?.user_metadata?.prenom || "";
                if (userEmail) {
                  await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${RESEND_API_KEY_W}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                      from: RESEND_FROM_W,
                      to: userEmail,
                      subject: `Wallet rechargé — ${topupAmount.toFixed(2).replace(".", ",")} € disponibles sur ALANE`,
                      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#050E20;color:#fff;padding:32px;border-radius:16px"><h2 style="color:#F0B429;margin:0 0 8px">Wallet rechargé 💳</h2><p style="color:rgba(255,255,255,0.7);margin:0 0 20px">Bonjour${prenom ? " " + prenom : ""},</p><div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px 20px;margin:0 0 20px"><div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.08)"><span style="color:rgba(255,255,255,0.5)">Montant rechargé</span><strong>+${topupAmount.toFixed(2).replace(".", ",")} €</strong></div><div style="display:flex;justify-content:space-between;padding:6px 0"><span style="color:rgba(255,255,255,0.5)">Nouveau solde</span><strong style="color:#F0B429">${newBal.toFixed(2).replace(".", ",")} €</strong></div></div><p style="color:rgba(255,255,255,0.6);font-size:13px;line-height:1.6">Ces fonds seront utilisés automatiquement lors de votre prochain paiement de prestation, sans frais Stripe supplémentaires.</p><p style="color:rgba(255,255,255,0.3);font-size:12px;margin-top:24px">© ALANE — Cet email est envoyé automatiquement, merci de ne pas y répondre.</p></div>`,
                    }),
                  }).catch(e => console.error("[wallet_topup] email failed:", e));
                }
              }
            } catch {}
          }
        } catch (e) {
          console.error("[stripe-webhook/wallet_topup] error:", e);
          return res.status(500).json({ error: "Supabase unavailable" });
        }
      }
      return res.status(200).json({ received: true });
    }

    const missionId     = intent.metadata?.mission;
    const candidatureId = intent.metadata?.candidature_id;
    const prestataireId = intent.metadata?.prestataire_id;
    if (missionId && SUPABASE_URL && SERVICE_ROLE_KEY) {
      const headers = {
        "apikey":        SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type":  "application/json",
        "Prefer":        "return=minimal",
      };

      // Vérification anti-fraude : le prestataireId du metadata doit correspondre à la candidature en DB
      if (candidatureId && prestataireId) {
        try {
          const candVerif = await fetch(`${SUPABASE_URL}/rest/v1/candidatures?id=eq.${candidatureId}&prestataire_id=eq.${prestataireId}&select=id`, { headers });
          const candData = await candVerif.json().catch(() => []);
          if (!Array.isArray(candData) || candData.length === 0) {
            console.error("[stripe-webhook] prestataireId metadata mismatch — candidature not found for this prestataire, aborting assignment");
            return res.status(200).json({ received: true }); // Ne pas retenter — les metadata sont invalides
          }
        } catch(e) {
          console.error("[stripe-webhook] candidature verification error:", e.message);
          return res.status(500).json({ error: "Supabase unavailable" }); // Retenter
        }
      }

      // Idempotency : si ce PaymentIntent est déjà enregistré, ignorer silencieusement
      try {
        const idempotCheck = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}&stripe_payment_intent=eq.${intent.id}&select=id`, { headers });
        const idempotData = await idempotCheck.json().catch(() => []);
        if (Array.isArray(idempotData) && idempotData.length > 0) {
          console.log("[stripe-webhook] PaymentIntent already processed — skipping idempotent retry", intent.id);
          return res.status(200).json({ received: true });
        }
      } catch(e) {
        console.error("[stripe-webhook] idempotency check error:", e.message);
        return res.status(500).json({ error: "Supabase unavailable" });
      }

      const patch = { stripe_payment_intent: intent.id, status: "assigned" };
      if (prestataireId) patch.prestataire_id = prestataireId;

      // Opération critique : si Supabase est down, retourner 500 → Stripe retentera
      let missionPatch;
      try {
        missionPatch = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}&status=not.in.(completed,closed,cancelled,refused,rejected,assigned)`, {
          method: "PATCH", headers: { ...headers, "Prefer": "return=representation" }, body: JSON.stringify(patch),
        });
      } catch (e) {
        console.error("stripe-webhook: Supabase down, Stripe will retry", e);
        return res.status(500).json({ error: "Supabase unavailable" });
      }
      if (!missionPatch.ok) {
        console.error("stripe-webhook: mission PATCH failed", missionPatch.status, await missionPatch.text());
        return res.status(500).json({ error: "Mission update failed" });
      }
      const patchedRows = await missionPatch.json().catch(() => []);
      if (!Array.isArray(patchedRows) || patchedRows.length === 0) {
        console.log("[stripe-webhook] mission already processed (0 rows updated) — skipping secondary effects", intent.id);
        return res.status(200).json({ received: true });
      }

      // Opérations secondaires : on ne bloque pas Stripe si elles échouent
      if (candidatureId) {
        await fetch(`${SUPABASE_URL}/rest/v1/candidatures?id=eq.${candidatureId}`, {
          method: "PATCH", headers, body: JSON.stringify({ status: "accepted" }),
        }).catch(e => console.error("candidature accept failed:", e));
        await fetch(`${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${missionId}&id=neq.${candidatureId}`, {
          method: "PATCH", headers, body: JSON.stringify({ status: "rejected" }),
        }).catch(e => console.error("candidature reject failed:", e));
        if (prestataireId) {
          await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
            method: "POST", headers,
            body: JSON.stringify({ user_id: prestataireId, type: "mission", title: "Proposition acceptée ✅", body: "Votre proposition a été acceptée et le paiement confirmé. Préparez-vous pour la prestation !", read: false }),
          }).catch(e => console.error("notification failed:", e));
        }
      }
    }
  }

  if (event.type === "checkout.session.completed") {
    const session        = event.data.object;
    const userId         = session.metadata?.user_id || session.client_reference_id;
    const plan           = session.metadata?.plan;
    const billing        = session.metadata?.billing || "monthly";
    const subscriptionId = session.subscription || null;
    const customerId     = session.customer     || null;

    if (userId && plan && SUPABASE_URL && SERVICE_ROLE_KEY) {
      const hdrs = {
        "apikey":        SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type":  "application/json",
      };

      // Use actual current_period_end from Stripe subscription rather than estimating
      let endDate = null;
      if (subscriptionId && STRIPE_SECRET_KEY) {
        try {
          const subR = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
            headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` },
          });
          if (subR.ok) {
            const sub = await subR.json();
            if (sub.current_period_end) endDate = new Date(sub.current_period_end * 1000).toISOString();
          }
        } catch {}
      }
      if (!endDate) {
        const daysToAdd = billing === "yearly" ? 365 : 30;
        endDate = new Date(Date.now() + daysToAdd * 86400000).toISOString();
      }

      let existingUser;
      try {
        // GET first to merge — PUT replaces entirely, so we must preserve existing metadata
        const getR = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: hdrs });
        if (!getR.ok) {
          console.error("stripe-webhook: GET user failed before PUT, aborting to avoid metadata loss", getR.status);
          return res.status(500).json({ error: "User fetch failed" });
        }
        existingUser = await getR.json();
        const existingMeta = existingUser.user_metadata || {};
        const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
          method: "PUT",
          headers: hdrs,
          body: JSON.stringify({ user_metadata: {
            ...existingMeta,
            plan_abonnement: plan,
            subscription_end_date: endDate,
            ...(customerId ? { stripe_customer_id: customerId } : {}),
          }}),
        });
        if (!r.ok) {
          console.error("stripe-webhook: user metadata update failed", r.status);
          return res.status(500).json({ error: "User update failed" });
        }
        // Mettre à jour aussi la table profiles pour que le client puisse lire le plan
        await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
          method: "PATCH",
          headers: { ...hdrs, "Prefer": "return=minimal" },
          body: JSON.stringify({ plan_abonnement: plan, subscription_end_date: endDate }),
        }).catch(e => console.error("stripe-webhook: profiles PATCH failed", e));
      } catch (e) {
        console.error("stripe-webhook: Supabase down on checkout.session.completed", e);
        return res.status(500).json({ error: "Supabase unavailable" });
      }

      // Store subscription/customer IDs in profiles table for lifecycle tracking
      const profilePatch = {
        plan_abonnement: plan,
        subscription_end_date: endDate ? endDate.split("T")[0] : null,
        trial_exhausted: false,
        ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {}),
        ...(customerId     ? { stripe_customer_id: customerId }         : {}),
      };
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
        method: "PATCH",
        headers: { ...hdrs, "Prefer": "return=minimal" },
        body: JSON.stringify(profilePatch),
      }).catch(e => console.error("[checkout] profile patch failed:", e.message));

      // Email de confirmation d'abonnement
      const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
      const RESEND_FROM    = process.env.RESEND_FROM || "ALANE <no-reply@alane.fr>";
      const userEmail      = session.customer_details?.email || existingUser?.email;
      const userName       = existingUser?.user_metadata?.prenom || existingUser?.user_metadata?.name || "";
      const planLabel      = plan === "elite" ? "Elite" : "Premium";
      const billingLabel   = billing === "yearly" ? "annuel" : "mensuel";
      const endDateFr      = endDate ? new Date(endDate).toLocaleDateString("fr-FR", { day:"numeric", month:"long", year:"numeric" }) : "";
      if (RESEND_API_KEY && userEmail) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: userEmail,
            subject: `✅ Votre abonnement ${planLabel} est activé — ALANE`,
            html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#050E20;color:#fff;padding:32px;border-radius:16px">
  <h2 style="color:#F0B429;margin:0 0 8px">Abonnement ${planLabel} activé 🎉</h2>
  <p style="color:rgba(255,255,255,0.7);margin:0 0 24px">Bonjour${userName ? " " + userName : ""},</p>
  <p style="color:rgba(255,255,255,0.85);line-height:1.6">Votre abonnement <strong style="color:#F0B429">${planLabel} ${billingLabel}</strong> est maintenant actif sur ALANE.</p>
  <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px 20px;margin:20px 0">
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.08)"><span style="color:rgba(255,255,255,0.5)">Plan</span><strong>${planLabel}</strong></div>
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.08)"><span style="color:rgba(255,255,255,0.5)">Facturation</span><strong>${billingLabel}</strong></div>
    ${endDateFr ? `<div style="display:flex;justify-content:space-between;padding:6px 0"><span style="color:rgba(255,255,255,0.5)">Renouvellement</span><strong>${endDateFr}</strong></div>` : ""}
  </div>
  <p style="color:rgba(255,255,255,0.5);font-size:13px;line-height:1.6">Vous pouvez gérer ou annuler votre abonnement à tout moment depuis votre espace prestataire → Abonnements.</p>
  <p style="color:rgba(255,255,255,0.3);font-size:12px;margin-top:24px">© ALANE — Cet email est envoyé automatiquement, merci de ne pas y répondre.</p>
</div>`,
          }),
        }).catch(e => console.error("[checkout] confirmation email failed:", e.message));
      }
    }
  }

  // ── Subscription lifecycle (auto-renewal + cancellation) ──────────────────
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub        = event.data.object;
    const customerId = sub.customer;
    const isActive   = event.type === "customer.subscription.updated" && ["active", "trialing"].includes(sub.status);
    const plan       = isActive ? (sub.metadata?.plan || null) : null;

    if (customerId && SUPABASE_URL && SERVICE_ROLE_KEY) {
      const hdrs = {
        "apikey":        SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type":  "application/json",
      };

      // Find user by stripe_customer_id stored in profiles
      let userId = null;
      try {
        const profR = await fetch(`${SUPABASE_URL}/rest/v1/profiles?stripe_customer_id=eq.${customerId}&select=id`, { headers: hdrs });
        if (profR.ok) {
          const profData = await profR.json().catch(() => []);
          userId = Array.isArray(profData) && profData[0]?.id || null;
        }
      } catch {}

      if (!userId) {
        console.warn("[subscription] user not found for customer:", customerId);
        return res.status(200).json({ received: true });
      }

      // Fetch existing plan as fallback when subscription metadata has no plan set
      let existingPlan = null;
      try {
        const epR = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=plan_abonnement`, { headers: hdrs });
        if (epR.ok) {
          const epData = await epR.json().catch(() => []);
          existingPlan = Array.isArray(epData) && epData[0]?.plan_abonnement || null;
        }
      } catch {}

      if (isActive) {
        const effectivePlan = plan || existingPlan || "premium";
        const endDate = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;

        // Update user_metadata
        try {
          const getR = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: hdrs });
          if (getR.ok) {
            const u = await getR.json();
            const meta = u.user_metadata || {};
            await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
              method: "PUT", headers: hdrs,
              body: JSON.stringify({ user_metadata: { ...meta, plan_abonnement: effectivePlan, subscription_end_date: endDate } }),
            });
          }
        } catch (e) { console.error("[sub.updated] metadata update failed:", e.message); }

        // Update profiles table
        await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
          method: "PATCH",
          headers: { ...hdrs, "Prefer": "return=minimal" },
          body: JSON.stringify({
            plan_abonnement: effectivePlan,
            subscription_end_date: endDate ? endDate.split("T")[0] : null,
          }),
        }).catch(e => console.error("[sub.updated] profile patch failed:", e.message));

      } else {
        // Downgrade to free (subscription canceled or payment failed past grace period)
        try {
          const getR = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: hdrs });
          if (getR.ok) {
            const u = await getR.json();
            const meta = u.user_metadata || {};
            await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
              method: "PUT", headers: hdrs,
              body: JSON.stringify({ user_metadata: { ...meta, plan_abonnement: "free", subscription_end_date: null } }),
            });
          }
        } catch (e) { console.error("[sub.deleted] metadata downgrade failed:", e.message); }

        await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
          method: "PATCH",
          headers: { ...hdrs, "Prefer": "return=minimal" },
          body: JSON.stringify({ plan_abonnement: "free", subscription_end_date: null, stripe_subscription_id: null }),
        }).catch(e => console.error("[sub.deleted] profile downgrade failed:", e.message));
      }
    }
  }

  // ── Paiement échoué : remettre la mission en open pour qu'elle reste bookable ──
  if (event.type === "payment_intent.payment_failed") {
    const intent    = event.data.object;
    const missionId = intent.metadata?.mission;
    if (missionId && SUPABASE_URL && SERVICE_ROLE_KEY) {
      const headers = {
        "apikey":        SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type":  "application/json",
        "Prefer":        "return=minimal",
      };
      // Remettre en open uniquement si encore en pending_acceptance (pas déjà paid/cancelled)
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}&status=eq.pending_acceptance`, {
        method: "PATCH", headers,
        body: JSON.stringify({ status: "open", prestataire_id: null, stripe_payment_intent: null }),
      }).catch(e => console.error("[payment_failed] mission reopen failed:", e.message));

      // Notifier le client
      try {
        const mRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}&select=client_id,metier,titre`, { headers });
        const mData = await mRes.json().catch(() => []);
        const m = Array.isArray(mData) && mData[0];
        if (m?.client_id) {
          const label = m.titre || m.metier || "la prestation";
          await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
            method: "POST", headers,
            body: JSON.stringify({
              user_id: m.client_id, type: "mission",
              title: "Paiement échoué ⚠️",
              body: `Le paiement pour « ${label} » a échoué. Veuillez réessayer depuis l'application.`,
              read: false,
            }),
          }).catch(() => {});
        }
      } catch {}
      console.log("[payment_intent.payment_failed] mission remise en open:", missionId);
    }
  }

  // ── Paiement de renouvellement échoué : avertir le prestataire ──
  if (event.type === "invoice.payment_failed") {
    const invoice    = event.data.object;
    const customerId = invoice.customer;
    if (customerId && SUPABASE_URL && SERVICE_ROLE_KEY) {
      const hdrs = {
        "apikey":        SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type":  "application/json",
      };
      let userId = null;
      try {
        const profR = await fetch(`${SUPABASE_URL}/rest/v1/profiles?stripe_customer_id=eq.${customerId}&select=id`, { headers: hdrs });
        if (profR.ok) {
          const profData = await profR.json().catch(() => []);
          userId = Array.isArray(profData) && profData[0]?.id || null;
        }
      } catch {}
      if (userId) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...hdrs, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: userId,
            type: "system",
            title: "⚠️ Paiement de renouvellement échoué",
            body: "Le renouvellement de votre abonnement ALANE a échoué. Mettez à jour votre moyen de paiement dans votre espace pour conserver votre accès Premium.",
            read: false,
          }),
        }).catch(() => {});
        console.warn(`[invoice.payment_failed] Renewal failed for user ${userId} — customer ${customerId}`);
      }
    }
  }

  // ── Chargeback (dispute) : alerter l'admin immédiatement ──
  if (event.type === "charge.dispute.created") {
    const dispute   = event.data.object;
    const chargeId  = dispute.charge;
    const amount    = (dispute.amount / 100).toFixed(2) + " €";
    const reason    = dispute.reason || "inconnu";
    const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
    const RESEND_FROM    = process.env.RESEND_FROM || "ALANE <no-reply@alane.fr>";
    const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;
    if (RESEND_API_KEY && ADMIN_EMAIL) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: ADMIN_EMAIL,
          subject: `🚨 [CHARGEBACK] Dispute Stripe — ${amount}`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
            <h2 style="color:#c0392b">🚨 Chargeback Stripe</h2>
            <p>Un client a contesté un paiement. Répondez dans les délais Stripe (généralement 7 jours).</p>
            <table style="width:100%;font-size:14px;border-collapse:collapse">
              <tr><td style="padding:6px 0;color:#666">Montant disputé</td><td style="font-weight:700;color:#c0392b">${amount}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Charge ID</td><td style="font-size:12px">${chargeId || "—"}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Raison</td><td style="font-weight:700">${reason}</td></tr>
              <tr><td style="padding:6px 0;color:#666">Statut</td><td>${dispute.status || "—"}</td></tr>
            </table>
            <p style="margin-top:16px"><a href="https://dashboard.stripe.com/disputes/${dispute.id}" style="color:#7C6FE0;font-weight:700">Gérer dans Stripe Dashboard →</a></p>
          </div>`,
        }),
      }).catch(e => console.error("[dispute] email admin failed:", e.message));
    }
    console.warn("[charge.dispute.created] chargeback détecté:", dispute.id, amount, reason);
  }

  if (event.type === "account.updated") {
    const account = event.data.object;
    if (account.payouts_enabled && SUPABASE_URL && SERVICE_ROLE_KEY) {
      const hdrs2 = {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      };
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?stripe_account_id=eq.${account.id}`, {
        method: "PATCH", headers: hdrs2,
        body: JSON.stringify({ stripe_account_status: "enabled" }),
      }).catch(e => console.error("profile status update failed:", e));

      if (STRIPE_SECRET_KEY) {
        const COMMISSION2 = parseFloat(process.env.PLATFORM_COMMISSION_RATE || "0");
        const profRes2 = await fetch(`${SUPABASE_URL}/rest/v1/profiles?stripe_account_id=eq.${account.id}&select=id`, {
          headers: hdrs2,
        }).catch(() => null);
        if (profRes2?.ok) {
          const profData2 = await profRes2.json().catch(() => []);
          const prestataireId2 = Array.isArray(profData2) && profData2[0]?.id;
          if (prestataireId2) {
            const pendRes = await fetch(
              `${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${prestataireId2}&payout_status=eq.pending&select=id,montant_total`,
              { headers: hdrs2 }
            ).catch(() => null);
            if (pendRes?.ok) {
              const pendMissions = await pendRes.json().catch(() => []);
              for (const pm of (Array.isArray(pendMissions) ? pendMissions : [])) {
                const netCents2 = Math.round((pm.montant_total || 0) * (1 - COMMISSION2) * 100);
                if (netCents2 < 100) continue;

                // Verrou atomique TOCTOU : passe payout_status → processing avant d'émettre le virement
                const lockRes2 = await fetch(
                  `${SUPABASE_URL}/rest/v1/missions?id=eq.${pm.id}&payout_status=eq.pending`,
                  {
                    method: "PATCH",
                    headers: { ...hdrs2, "Prefer": "return=representation" },
                    body: JSON.stringify({ payout_status: "processing" }),
                  }
                ).catch(() => null);
                const lockData2 = lockRes2?.ok ? await lockRes2.json().catch(() => []) : [];
                if (!Array.isArray(lockData2) || lockData2.length === 0) {
                  console.log(`[account.updated] mission ${pm.id} already processing or transferred, skipping`);
                  continue;
                }

                const tParams2 = new URLSearchParams({
                  amount: String(netCents2), currency: "eur", destination: account.id,
                  "metadata[mission_id]": pm.id, "metadata[prestataire_id]": prestataireId2,
                });
                const tRes2 = await fetch("https://api.stripe.com/v1/transfers", {
                  method: "POST",
                  headers: {
                    "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Idempotency-Key": `transfer-mission-${pm.id}-${prestataireId2}`,
                  },
                  body: tParams2.toString(),
                }).catch(() => null);
                if (tRes2?.ok) {
                  const tData2 = await tRes2.json().catch(() => null);
                  await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${pm.id}`, {
                    method: "PATCH", headers: hdrs2,
                    body: JSON.stringify({ payout_status: "transferred", stripe_transfer_id: tData2?.id }),
                  }).catch(() => {});
                  console.log(`[account.updated] Pending transfer processed: ${tData2?.id} for mission ${pm.id}`);
                } else {
                  // Rollback du verrou si Stripe a échoué
                  await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${pm.id}`, {
                    method: "PATCH", headers: hdrs2,
                    body: JSON.stringify({ payout_status: "pending" }),
                  }).catch(() => {});
                }
              }
            }
          }
        }
      }
    }
  }

  return res.status(200).json({ received: true });
}
