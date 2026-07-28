import { verifyUser } from "./_auth.js";

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

  // ── PAY MISSION FROM WALLET ─────────────────────────────────────
  if (action === "pay_mission") {
    if (!mission_id || !/^[0-9a-f-]{36}$/i.test(mission_id)) {
      return res.status(400).json({ error: "mission_id invalide" });
    }

    // 1. Fetch mission
    const mRes = await fetch(
      `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,client_id,prestataire_id,montant_total,tarif_horaire,hours,status`,
      { headers: hdrs }
    );
    const mData = await mRes.json().catch(() => []);
    const mission = Array.isArray(mData) && mData[0];
    if (!mission) return res.status(404).json({ error: "Mission introuvable" });
    if (mission.client_id !== caller.id) return res.status(403).json({ error: "Accès interdit" });
    if (!["open", "pending_acceptance"].includes(mission.status)) {
      return res.status(400).json({ error: "La mission n'est pas dans un état permettant le paiement" });
    }

    const amount = mission.montant_total
      ? Number(mission.montant_total)
      : Number(mission.tarif_horaire || 0) * Number(mission.hours || 0);
    if (!amount || amount <= 0) return res.status(400).json({ error: "Montant de la mission invalide" });

    // 2. Fetch current balance
    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=prepaid_balance`,
      { headers: hdrs }
    );
    const profData = await profRes.json().catch(() => []);
    const currentBalance = Number(Array.isArray(profData) && profData[0]?.prepaid_balance || 0);
    if (currentBalance < amount) {
      return res.status(400).json({
        error: `Solde insuffisant (${currentBalance.toFixed(2)} € disponible, ${amount.toFixed(2)} € requis)`,
      });
    }

    // 3. Deduct from prepaid_balance
    const newBalance = Math.round((currentBalance - amount) * 100) / 100;
    const deductRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}`, {
      method:  "PATCH",
      headers: { ...hdrs, "Prefer": "return=minimal" },
      body:    JSON.stringify({ prepaid_balance: newBalance }),
    });
    if (!deductRes.ok) {
      console.error("[wallet/pay_mission] balance deduct failed", deductRes.status);
      return res.status(500).json({ error: "Erreur mise à jour solde" });
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
      // Mission was already processed — restore balance
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}`, {
        method:  "PATCH",
        headers: { ...hdrs, "Prefer": "return=minimal" },
        body:    JSON.stringify({ prepaid_balance: currentBalance }),
      }).catch(() => {});
      return res.status(400).json({ error: "Mission déjà traitée ou état invalide" });
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
          title:   "Candidature acceptée ✅",
          body:    "Votre candidature a été acceptée. Préparez-vous pour la mission !",
          read:    false,
        }),
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, newBalance });
  }

  return res.status(400).json({ error: "Action inconnue" });
}
