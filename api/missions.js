// Web Push sender — RFC 8291 / RFC 8292 — no npm, Node.js 18+ native crypto
async function sendWebPush(sub, notification) {
  const VAPID_PUB = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRV = process.env.VAPID_PRIVATE_KEY;
  if (!VAPID_PUB || !VAPID_PRV) return false;
  if (!sub?.endpoint || !sub?.p256dh || !sub?.auth) return false;
  try {
    const sc = globalThis.crypto.subtle;
    const b64u = buf => Buffer.from(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf).toString("base64url");
    const deb64u = s => { const p = s.replace(/-/g,"+").replace(/_/g,"/"); return Buffer.from(p.padEnd(p.length+(4-p.length%4)%4,"="),"base64"); };

    // VAPID JWT (RFC 8292)
    const aud = new URL(sub.endpoint).origin;
    const hdr = b64u(Buffer.from(JSON.stringify({typ:"JWT",alg:"ES256"})));
    const pay = b64u(Buffer.from(JSON.stringify({aud,exp:Math.floor(Date.now()/1000)+43200,sub:"mailto:admin@alane.fr"})));
    const inp = `${hdr}.${pay}`;
    const pubRaw = deb64u(VAPID_PUB);
    const prvKey = await sc.importKey("jwk",{kty:"EC",crv:"P-256",x:b64u(pubRaw.slice(1,33)),y:b64u(pubRaw.slice(33,65)),d:b64u(deb64u(VAPID_PRV))},{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
    const sig = await sc.sign({name:"ECDSA",hash:"SHA-256"},prvKey,Buffer.from(inp));
    const jwt = `${inp}.${b64u(sig)}`;

    // Payload encryption (RFC 8291, aes128gcm)
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const srvKP = await sc.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
    const srvPubRaw = new Uint8Array(await sc.exportKey("raw",srvKP.publicKey));
    const cliPubKey = await sc.importKey("raw",deb64u(sub.p256dh),{name:"ECDH",namedCurve:"P-256"},false,[]);
    const ecdh = await sc.deriveBits({name:"ECDH",public:cliPubKey},srvKP.privateKey,256);
    const authSec = deb64u(sub.auth);
    const cliPubRaw = deb64u(sub.p256dh);

    const hkdf = async (s, ikm, info, len) => {
      const k = await sc.importKey("raw",ikm,"HKDF",false,["deriveBits"]);
      return sc.deriveBits({name:"HKDF",hash:"SHA-256",salt:s,info},k,len*8);
    };
    const ikm = await hkdf(authSec, ecdh, Buffer.concat([Buffer.from("WebPush: info\0"), cliPubRaw, Buffer.from(srvPubRaw)]), 32);
    const cek = await hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
    const nonceRaw = await hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

    const aesKey = await sc.importKey("raw",cek,"AES-GCM",false,["encrypt"]);
    const plaintext = Buffer.concat([Buffer.from(JSON.stringify(notification)), Buffer.from([0x02])]);
    const cipher = await sc.encrypt({name:"AES-GCM",iv:nonceRaw},aesKey,plaintext);

    const rsBuf = Buffer.alloc(4); rsBuf.writeUInt32BE(4096,0);
    const record = Buffer.concat([salt, rsBuf, Buffer.from([65]), Buffer.from(srvPubRaw), Buffer.from(new Uint8Array(cipher))]);

    const r = await fetch(sub.endpoint, {
      method:"POST",
      headers:{"Content-Type":"application/octet-stream","Content-Encoding":"aes128gcm","Authorization":`vapid t=${jwt},k=${VAPID_PUB}`,"TTL":"86400"},
      body: record,
    });
    return r.ok || r.status === 201;
  } catch(e) {
    console.error("[sendWebPush] error:", e.message);
    return false;
  }
}

async function verifyUser(req, supabaseUrl, serviceRoleKey) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { "apikey": serviceRoleKey, "Authorization": `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, ...payload } = req.body || {};

  // Validation globale
  if (!action || typeof action !== "string" || action.length > 50) {
    return res.status(400).json({ error: "Action invalide" });
  }
  const isUuid = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }

  const headers = {
    "apikey":        SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
  };

  try {
    if (action === "list_open") {
      const { sector, metier } = payload;
      let url = `${SUPABASE_URL}/rest/v1/missions?status=eq.open&order=created_at.desc`;
      if (sector) url += `&sector=eq.${encodeURIComponent(sector)}`;
      if (metier) url += `&metier=eq.${encodeURIComponent(metier)}`;
      const r = await fetch(url, { headers });
      const missions = await r.json();
      return res.status(200).json(Array.isArray(missions) ? missions : []);
    }

    if (action === "list_client") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const client_id = caller.id;
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?client_id=eq.${client_id}&order=created_at.desc`,
        { headers }
      );
      const missions = await r.json();
      if (!Array.isArray(missions)) return res.status(200).json([]);

      const enriched = await Promise.all(missions.map(async (m) => {
        const cr = await fetch(
          `${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${m.id}&select=id,prestataire_id,status,created_at`,
          { headers }
        );
        const candidatures = await cr.json();
        return { ...m, candidatures: Array.isArray(candidatures) ? candidatures : [] };
      }));
      return res.status(200).json(enriched);
    }

    if (action === "get_candidatures") {
      const { mission_id } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${mission_id}&order=created_at.asc`,
        { headers }
      );
      const candidatures = await r.json();
      if (!Array.isArray(candidatures)) return res.status(200).json([]);

      const enriched = await Promise.all(candidatures.map(async (c) => {
        const pr = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=eq.${c.prestataire_id}&select=prenom,nom`,
          { headers }
        );
        const profiles = await pr.json();
        const profile = Array.isArray(profiles) && profiles[0];
        return { ...c, prenom: profile?.prenom || "", nom: profile?.nom || "" };
      }));
      return res.status(200).json(enriched);
    }

    if (action === "mes_candidatures") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const prestataire_id = caller.id;
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/candidatures?prestataire_id=eq.${prestataire_id}&order=created_at.desc`,
        { headers }
      );
      const candidatures = await r.json();
      if (!Array.isArray(candidatures)) return res.status(200).json([]);

      const enriched = await Promise.all(candidatures.map(async (c) => {
        const mr = await fetch(
          `${SUPABASE_URL}/rest/v1/missions?id=eq.${c.mission_id}&select=sector,metier,date,hours,ville,status,tarif_horaire`,
          { headers }
        );
        const missions = await mr.json();
        const mission = Array.isArray(missions) && missions[0];
        return { ...c, mission: mission || null };
      }));
      return res.status(200).json(enriched);
    }

    if (action === "apply") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, message } = payload;
      const prestataire_id = caller.id;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      if (message && (typeof message !== "string" || message.length > 1000)) return res.status(400).json({ error: "Message trop long (max 1000 caractères)" });

      // Vérifier la limite mensuelle selon le plan (lu depuis platform_settings)
      let PLAN_LIMITS = { free: 2, premium: 10, elite: 999 };
      try {
        const settingsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/platform_settings?key=eq.plan_limits&select=value`,
          { headers }
        );
        const settingsData = await settingsRes.json();
        if (Array.isArray(settingsData) && settingsData[0]?.value) {
          PLAN_LIMITS = settingsData[0].value;
        }
      } catch {}
      try {
        const [userRes, profileRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/auth/v1/admin/users/${prestataire_id}`, { headers }),
          fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${prestataire_id}&select=missions_completed_month`, { headers }),
        ]);
        const userData = await userRes.json();
        const profileData = await profileRes.json();
        let plan = userData.user_metadata?.plan_abonnement || "free";

        // Vérifier l'expiry de l'abonnement — downgrade auto si expiré
        const endDate = userData.user_metadata?.subscription_end_date;
        if (endDate && plan !== "free" && new Date(endDate) < new Date()) {
          plan = "free";
          fetch(`${SUPABASE_URL}/auth/v1/admin/users/${prestataire_id}`, {
            method: "PUT", headers,
            body: JSON.stringify({ user_metadata: { plan_abonnement: "free", subscription_end_date: null } }),
          }).catch(() => {});
        }

        const limit = PLAN_LIMITS[plan] ?? 2;
        if (limit < 999) {
          const completedThisMonth = (Array.isArray(profileData) && profileData[0]?.missions_completed_month) || 0;
          const assignedRes = await fetch(
            `${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${prestataire_id}&status=in.(assigned,pending_acceptance)&select=id`,
            { headers }
          );
          const assignedData = await assignedRes.json();
          const currentlyAssigned = Array.isArray(assignedData) ? assignedData.length : 0;
          const total = completedThisMonth + currentlyAssigned;
          if (total >= limit) {
            return res.status(403).json({
              error: `Limite atteinte — votre plan ${plan === "free" ? "Gratuit" : plan === "premium" ? "Premium" : "Elite"} autorise ${limit} mission${limit > 1 ? "s" : ""}/mois. Passez à un plan supérieur pour continuer.`,
              limit_reached: true,
              plan,
              limit,
            });
          }
        }
      } catch { /* si erreur, on laisse postuler */ }

      const r = await fetch(`${SUPABASE_URL}/rest/v1/candidatures`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ mission_id, prestataire_id, message: message || null, status: "pending" }),
      });
      if (!r.ok) {
        const err = await r.text();
        if (err.includes("unique")) return res.status(400).json({ error: "Vous avez déjà postulé à cette mission" });
        return res.status(500).json({ error: "Erreur candidature" });
      }

      // Notifier le client qu'une candidature a été reçue
      const missionRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id,metier,sector`, { headers });
      const missionData = await missionRes.json();
      const missionRow = Array.isArray(missionData) && missionData[0];
      const prestataireRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${prestataire_id}&select=prenom,nom`, { headers });
      const prestataireData = await prestataireRes.json();
      const presta = Array.isArray(prestataireData) && prestataireData[0];
      if (missionRow?.client_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: missionRow.client_id,
            type: "mission",
            title: "Nouvelle candidature 📋",
            body: `${presta ? `${presta.prenom} ${presta.nom}` : "Un prestataire"} a postulé à votre mission "${missionRow.metier || missionRow.sector}".`,
            read: false,
          }),
        });
      }
      return res.status(200).json({ success: true });
    }

    if (action === "accept") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { candidature_id, mission_id, prestataire_id } = payload;
      if (!candidature_id || !mission_id) return res.status(400).json({ error: "candidature_id et mission_id requis" });

      // Récupérer le tarif_net du prestataire depuis user_metadata
      let tarifHoraire = 0;
      if (prestataire_id) {
        try {
          const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${prestataire_id}`, { headers });
          const ud = await ur.json();
          tarifHoraire = Number(ud.user_metadata?.tarif_net) || 0;
        } catch {}
      }

      // Vérifier si la mission a déjà un paiement Stripe
      const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
      const mCheckRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=stripe_payment_intent,hours`, { headers });
      const mCheckData = await mCheckRes.json();
      const missionCheck = Array.isArray(mCheckData) && mCheckData[0];

      if (missionCheck && !missionCheck.stripe_payment_intent && STRIPE_SECRET_KEY) {
        try {
          const hours = missionCheck.hours || 1;
          const amountCents = Math.max(50, Math.round(tarifHoraire * hours * 100));
          const params = new URLSearchParams({
            amount: String(amountCents),
            currency: "eur",
            "metadata[mission]": mission_id,
            "metadata[candidature_id]": candidature_id,
            "metadata[prestataire_id]": prestataire_id || "",
          });
          const ir = await fetch("https://api.stripe.com/v1/payment_intents", {
            method: "POST",
            headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
          });
          const intent = await ir.json();
          if (intent.client_secret) {
            return res.status(200).json({ payment_required: true, client_secret: intent.client_secret, amount: amountCents / 100 });
          }
        } catch {}
      }

      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?id=eq.${candidature_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "accepted" }),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${mission_id}&id=neq.${candidature_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "rejected" }),
      });
      const missionPatch = { status: "assigned" };
      if (prestataire_id) missionPatch.prestataire_id = prestataire_id;
      if (tarifHoraire)   missionPatch.tarif_horaire  = tarifHoraire;
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify(missionPatch),
      });

      // Notification au prestataire
      if (prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: prestataire_id,
            type: "mission",
            title: "Candidature acceptée ✅",
            body: "Votre candidature a été acceptée ! Préparez-vous pour la mission.",
            read: false,
          }),
        });
      }
      return res.status(200).json({ success: true });
    }

    if (action === "complete") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id } = payload;
      const client_id = caller.id;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });

      // Récupérer la mission pour avoir hours, tarif_horaire et prestataire_id
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=hours,tarif_horaire,status,prestataire_id,metier,sector,client_id`, { headers });
      const missions = await mr.json();
      const mission = Array.isArray(missions) && missions[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable" });
      if (mission.client_id !== client_id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "assigned") return res.status(400).json({ error: "Mission non assignée" });

      const hours        = mission.hours || 0;
      const tarifHoraire = mission.tarif_horaire || 0;
      const montantTotal = Math.round(hours * tarifHoraire * 100) / 100;

      // Récupérer le palier cashback du client (missions_completed_month)
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${client_id}&select=cashback_balance,missions_completed_month`, { headers });
      const profiles = await pr.json();
      const profile = Array.isArray(profiles) && profiles[0];
      const missionsThisMonth = (profile?.missions_completed_month || 0) + 1;

      // Calcul du taux selon palier (doit rester synchronisé avec CASHBACK_TIERS dans constants/plans.js)
      const CASHBACK_TIERS = [
        { min:0,  max:4,        rate:0.01 },
        { min:5,  max:9,        rate:0.02 },
        { min:10, max:19,       rate:0.03 },
        { min:20, max:Infinity, rate:0.05 },
      ];
      const rate = [...CASHBACK_TIERS].reverse().find(t => missionsThisMonth >= t.min)?.rate || 0.01;
      const cashbackEarned = Math.round(montantTotal * rate * 100) / 100;
      const newBalance = Math.round(((profile?.cashback_balance || 0) + cashbackEarned) * 100) / 100;

      // Marquer mission completed + montant total
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "completed", montant_total: montantTotal }),
      });

      // Mettre à jour le cashback du client
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${client_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ cashback_balance: newBalance, missions_completed_month: missionsThisMonth }),
      });

      // Notification cashback au client
      if (cashbackEarned > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: client_id,
            type: "cashback",
            title: "Cashback crédité 💰",
            body: `+${cashbackEarned.toFixed(2)} € crédités sur votre wallet suite à la validation de votre mission. Solde : ${newBalance.toFixed(2)} €`,
            read: false,
          }),
        });
      }

      // Notification + email au prestataire
      if (mission.prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: mission.prestataire_id,
            type: "mission",
            title: "Mission validée ✅",
            body: `Votre mission "${mission.metier || mission.sector || ""}" a été validée. Votre paiement de ${montantTotal.toFixed(2)} € est en cours de traitement.`,
            read: false,
          }),
        }).catch(() => {});

        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        const RESEND_FROM    = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
        if (RESEND_API_KEY) {
          try {
            const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${mission.prestataire_id}`, { headers });
            const uData = await uRes.json();
            const prestaEmail = uData.email;
            const prestaName  = uData.user_metadata?.prenom || "Prestataire";
            if (prestaEmail) {
              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  from: RESEND_FROM,
                  to: prestaEmail,
                  subject: "Mission validée — votre paiement est en cours 💰",
                  html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
                    <h2 style="color:#A29BFE;margin:0 0 12px">Mission validée ✅</h2>
                    <p>Bonjour ${prestaName},</p>
                    <p>Le client a validé votre mission <strong>${mission.metier || mission.sector || ""}</strong>.</p>
                    <p>Votre paiement de <strong style="color:#A29BFE">${montantTotal.toFixed(2)} €</strong> est en cours de traitement et sera versé sur votre IBAN sous 3 à 5 jours ouvrés.</p>
                    <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE</p>
                  </div>`,
                }),
              }).catch(() => {});
            }
          } catch {}
        }
      }

      return res.status(200).json({ success: true, montantTotal, cashbackEarned, newBalance });
    }

    if (action === "reject") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { candidature_id } = payload;
      if (!candidature_id) return res.status(400).json({ error: "candidature_id requis" });
      if (!isUuid(candidature_id)) return res.status(400).json({ error: "candidature_id invalide" });

      // Verify the caller owns the mission associated with this candidature
      const cRes = await fetch(`${SUPABASE_URL}/rest/v1/candidatures?id=eq.${candidature_id}&select=mission_id`, { headers });
      const cData = await cRes.json();
      const cand = Array.isArray(cData) && cData[0];
      if (!cand) return res.status(404).json({ error: "Candidature introuvable" });
      const mRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${cand.mission_id}&select=client_id`, { headers });
      const mData = await mRes.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission || mission.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });

      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?id=eq.${candidature_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "rejected" }),
      });
      return res.status(200).json({ success: true });
    }

    if (action === "cancel_prestataire") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      const mr = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,prestataire_id,client_id,sector,metier,date,hours,ville`,
        { headers }
      );
      const mData = await mr.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable" });
      if (mission.prestataire_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "assigned") return res.status(400).json({ error: "Mission non assignée" });

      // Remettre la mission en open et effacer le prestataire
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "open", prestataire_id: null }),
      });

      // Rejeter la candidature du prestataire désisté
      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${mission_id}&prestataire_id=eq.${caller.id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "rejected" }),
      });

      // Notifier le client
      if (mission.client_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: mission.client_id,
            type: "mission",
            title: "Prestataire désisté — mission réouverte 🔄",
            body: `Votre mission "${mission.metier || mission.sector}" du ${mission.date} a été réouverte automatiquement. De nouveaux prestataires vont être notifiés.`,
            read: false,
          }),
        });
      }

      // Rediffuser aux prestataires approuvés du même secteur (sauf le désisté)
      const prRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&select=id`,
        { headers }
      );
      const prData = await prRes.json();
      if (Array.isArray(prData)) {
        const chunks = [];
        for (let i = 0; i < prData.length; i += 5) chunks.push(prData.slice(i, i + 5));
        for (const chunk of chunks) {
          await Promise.all(chunk.map(async (p) => {
            if (p.id === caller.id) return;
            try {
              const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${p.id}`, { headers });
              const ud = await ur.json();
              const meta = ud.user_metadata || {};
              const prestaSector = meta.secteur || meta.sector;
              if (mission.sector && prestaSector && prestaSector !== mission.sector) return;
              await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                method: "POST",
                headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({
                  user_id: p.id,
                  type: "mission",
                  title: "🔔 Mission disponible — urgent !",
                  body: `Mission ${mission.metier || mission.sector || ""} le ${mission.date || ""} à ${mission.ville || ""} (${mission.hours || ""}h). Postulez maintenant !`,
                  read: false,
                }),
              });
            } catch {}
          }));
        }
      }

      return res.status(200).json({ success: true });
    }

    if (action === "close") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      const mRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id`, { headers });
      const mData = await mRes.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission || mission.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });

      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "closed" }),
      });
      return res.status(200).json({ success: true });
    }

    if (action === "broadcast") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, sector } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      console.log("[broadcast] caller:", caller.id, "mission_id:", mission_id, "sector:", sector);

      // Fetch mission details
      const mr = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=sector,metier,date,hours,ville`,
        { headers }
      );
      const missions = await mr.json();
      const mission = Array.isArray(missions) && missions[0];
      console.log("[broadcast] mission:", mission);

      // Fetch all approved prestataires
      const pr = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&select=id`,
        { headers }
      );
      const profiles = await pr.json();
      console.log("[broadcast] approved prestataires count:", Array.isArray(profiles) ? profiles.length : profiles);

      // Fetch all push subscriptions for quick lookup
      const psRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=user_id,endpoint,p256dh,auth`, { headers });
      const allSubs = await psRes.json().catch(() => []);
      const subsByUser = {};
      if (Array.isArray(allSubs)) {
        for (const s of allSubs) {
          if (!subsByUser[s.user_id]) subsByUser[s.user_id] = [];
          subsByUser[s.user_id].push(s);
        }
      }

      const pushTitle = "🔔 Nouvelle mission disponible";
      const pushBody  = `${mission?.metier || sector || "Mission"} · ${mission?.date || ""} · ${mission?.ville || ""} (${mission?.hours || ""}h)`;

      let notified = 0;
      if (Array.isArray(profiles)) {
        const chunks = [];
        for (let i = 0; i < profiles.length; i += 5) chunks.push(profiles.slice(i, i + 5));
        for (const chunk of chunks) {
          await Promise.all(chunk.map(async (p) => {
            try {
              // Filter by sector using user_metadata
              const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${p.id}`, { headers });
              const ud = await ur.json();
              const meta = ud.user_metadata || {};
              const presta_sector = meta.secteur || meta.sector;
              console.log("[broadcast] prestataire", p.id, "presta_sector:", presta_sector, "mission sector:", sector);
              if (sector && presta_sector && presta_sector !== sector) return;

              // In-app notification
              await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                method: "POST",
                headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({
                  user_id: p.id,
                  type: "mission",
                  title: pushTitle,
                  body: `${pushBody}. Postulez dans votre espace !`,
                  read: false,
                }),
              });

              console.log("[broadcast] in-app notification sent to", p.id);

              // Email Resend (quand app fermée)
              const RESEND_KEY_B = process.env.RESEND_API_KEY;
              const RESEND_FROM_B = process.env.RESEND_FROM || "JOBER <no-reply@jober.fr>";
              if (RESEND_KEY_B && ud.email) {
                const missionLabel = mission?.metier || sector || "Mission";
                fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: { "Authorization": `Bearer ${RESEND_KEY_B}`, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    from: RESEND_FROM_B,
                    to: [ud.email],
                    subject: `🔔 Nouvelle mission disponible : ${missionLabel}`,
                    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
                      <h2 style="color:#4F46E5">Nouvelle mission JOBER</h2>
                      <p>Une nouvelle mission correspond à votre profil :</p>
                      <div style="background:#f5f5f5;border-left:4px solid #4F46E5;padding:12px 16px;margin:16px 0;border-radius:4px">
                        <strong>${missionLabel}</strong><br/>
                        📅 ${mission?.date || "Date à confirmer"}<br/>
                        📍 ${mission?.ville || "Ville à confirmer"}<br/>
                        ⏱ ${mission?.hours || "?"}h
                      </div>
                      <p>Connectez-vous à JOBER pour postuler.</p>
                    </div>`,
                  }),
                }).catch(() => {});
              }

              // SMS Brevo (si numéro dispo et clé configurée)
              const BREVO_KEY = process.env.BREVO_API_KEY;
              const phone = meta.telephone;
              console.log("[broadcast] SMS check - BREVO_KEY:", !!BREVO_KEY, "phone:", phone);
              if (BREVO_KEY && phone) {
                const digits = phone.replace(/\D/g, "");
                const e164 = digits.startsWith("0") ? "33" + digits.slice(1) : digits.startsWith("33") ? digits : null;
                if (e164) {
                  const smsText = `JOBER - Nouvelle mission : ${mission?.metier || sector || "Mission"} le ${mission?.date || "?"} a ${mission?.ville || "?"} (${mission?.hours || "?"}h). Connectez-vous pour postuler.`;
                  console.log("[broadcast] sending SMS to", e164);
                  fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
                    method: "POST",
                    headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
                    body: JSON.stringify({ sender: "JOBER", recipient: e164, content: smsText }),
                  }).then(r => r.json()).then(d => console.log("[broadcast] SMS response:", JSON.stringify(d))).catch(e => console.log("[broadcast] SMS error:", e.message));
                }
              }

              // Web push
              const subs = subsByUser[p.id];
              if (subs?.length) {
                await Promise.all(subs.map(s => sendWebPush(s, { title: pushTitle, body: pushBody, url: "/" })));
              }

              notified++;
            } catch {}
          }));
        }
      }
      return res.status(200).json({ success: true, notified });
    }

    if (action === "push_subscribe" || action === "push_unsubscribe") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { subscription } = payload;
      if (action === "push_subscribe") {
        if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
          return res.status(400).json({ error: "Subscription invalide" });
        }
        await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions`, {
          method: "POST",
          headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ user_id: caller.id, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }),
        });
      } else {
        if (!subscription?.endpoint) return res.status(400).json({ error: "Endpoint manquant" });
        await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${caller.id}&endpoint=eq.${encodeURIComponent(subscription.endpoint)}`, { method: "DELETE", headers });
      }
      return res.status(200).json({ success: true });
    }

    if (action === "chat_notify") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { recipient_id, sender_name, message_preview } = payload;
      if (!recipient_id || !isUuid(recipient_id)) return res.status(400).json({ error: "recipient_id requis" });

      // Fetch recipient info (email + phone)
      const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${recipient_id}`, { headers });
      const ud = await ur.json();
      const recipientEmail = ud.email;
      const phone = ud.user_metadata?.telephone;

      // In-app notification (with ref_id = sender id for direct chat navigation)
      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          user_id: recipient_id,
          type: "system",
          title: `💬 Nouveau message de ${sender_name || "votre contact"}`,
          body: message_preview ? message_preview.slice(0, 100) : "Vous avez reçu un nouveau message.",
          read: false,
          ref_id: caller.id,
        }),
      });

      // Email Resend (quand app fermée)
      const RESEND_KEY = process.env.RESEND_API_KEY;
      const RESEND_FROM = process.env.RESEND_FROM || "JOBER <no-reply@jober.fr>";
      if (RESEND_KEY && recipientEmail) {
        try {
          const er = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: RESEND_FROM,
              to: [recipientEmail],
              subject: `💬 Nouveau message de ${sender_name || "votre contact"}`,
              html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
                <h2 style="color:#4F46E5">Nouveau message JOBER</h2>
                <p><strong>${sender_name || "Votre contact"}</strong> vous a envoyé un message :</p>
                <div style="background:#f5f5f5;border-left:4px solid #4F46E5;padding:12px 16px;margin:16px 0;border-radius:4px;font-style:italic">${message_preview || ""}</div>
                <p>Connectez-vous à JOBER pour répondre.</p>
              </div>`,
            }),
          });
          const eb = await er.json().catch(() => ({}));
          console.log("[chat_notify] email status:", er.status, JSON.stringify(eb));
        } catch (e) { console.error("[chat_notify] email error:", e.message); }
      } else {
        console.log("[chat_notify] email skipped — RESEND_KEY:", !!RESEND_KEY, "recipientEmail:", recipientEmail);
      }

      // SMS Brevo
      const BREVO_KEY = process.env.BREVO_API_KEY;
      console.log("[chat_notify] phone:", phone, "BREVO_KEY set:", !!BREVO_KEY);
      if (BREVO_KEY && phone) {
        const digits = phone.replace(/\D/g, "");
        const e164 = digits.startsWith("0") ? "33" + digits.slice(1) : digits.startsWith("33") ? digits : null;
        console.log("[chat_notify] SMS e164:", e164);
        if (e164) {
          try {
            const sr = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
              method: "POST",
              headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
              body: JSON.stringify({
                sender: "ALANE",
                recipient: e164,
                content: `ALANE - Nouveau message de ${sender_name || "votre contact"} : ${(message_preview || "").slice(0, 80)}`,
              }),
            });
            const sb = await sr.json().catch(() => ({}));
            console.log("[chat_notify] SMS brevo status:", sr.status, JSON.stringify(sb));
          } catch (e) { console.error("[chat_notify] SMS error:", e.message); }
        }
      } else {
        console.log("[chat_notify] SMS skipped — BREVO_KEY:", !!BREVO_KEY, "phone:", phone);
      }

      return res.status(200).json({ success: true });
    }

    if (action === "update_position") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, lat, lng } = payload;
      if (!mission_id || lat == null || lng == null) return res.status(400).json({ error: "mission_id, lat, lng requis" });
      const prestataire_id = caller.id;
      // Upsert position (use mission_id as unique key per prestataire)
      await fetch(`${SUPABASE_URL}/rest/v1/tracking_positions?on_conflict=mission_id,prestataire_id`, {
        method: "POST",
        headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ mission_id, prestataire_id, lat, lng, updated_at: new Date().toISOString() }),
      });
      return res.status(200).json({ success: true });
    }

    if (action === "get_position") {
      const { mission_id } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/tracking_positions?mission_id=eq.${mission_id}&select=lat,lng,updated_at&order=updated_at.desc&limit=1`,
        { headers }
      );
      const rows = await r.json();
      return res.status(200).json(Array.isArray(rows) && rows[0] ? rows[0] : null);
    }

    if (action === "get_sector_status") {
      // Threshold configurable depuis le BO
      let minPrestataires = 30;
      try {
        const sr = await fetch(
          `${SUPABASE_URL}/rest/v1/platform_settings?key=eq.sector_min_prestataires&select=value`,
          { headers }
        );
        const sd = await sr.json();
        if (Array.isArray(sd) && sd[0]?.value != null) minPrestataires = Number(sd[0].value) || 20;
      } catch {}

      // IDs des prestataires approuvés
      const pr = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&select=id`,
        { headers }
      );
      const profileData = await pr.json();
      const approvedIds = new Set((Array.isArray(profileData) ? profileData : []).map(p => p.id));

      // Récupérer tous les users (metadata contient le secteur) — pagination pour > 1000 users
      let allUsers = [];
      let page = 1;
      while (true) {
        const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000&page=${page}`, { headers });
        const ud = await ur.json();
        const batch = ud.users || [];
        allUsers = allUsers.concat(batch);
        if (batch.length < 1000) break;
        page++;
      }

      // Compter par secteur
      const counts = {};
      for (const u of allUsers) {
        if (!approvedIds.has(u.id)) continue;
        const sector = u.user_metadata?.secteur || u.user_metadata?.sector;
        if (sector) counts[sector] = (counts[sector] || 0) + 1;
      }

      const KNOWN_SECTORS = ["proprete","logistique","hotellerie","restauration","commercial","distribution","divers"];
      const result = {};
      for (const s of KNOWN_SECTORS) {
        const count = counts[s] || 0;
        result[s] = { count, open: count >= minPrestataires, min: minPrestataires };
      }
      return res.status(200).json(result);
    }

    if (action === "cancel_client") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, reason, penalty } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      const mRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id,prestataire_id,status,stripe_payment_intent,montant_total,metier,sector`,
        { headers }
      );
      const mData = await mRes.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable" });
      if (mission.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (!["open", "assigned", "pending_acceptance"].includes(mission.status)) {
        return res.status(400).json({ error: "Cette mission ne peut plus être annulée" });
      }

      // Récupérer l'email du client pour le ticket
      let clientEmail = null;
      try {
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${caller.id}`, { headers });
        const uData = await uRes.json();
        clientEmail = uData.email || null;
      } catch {}

      // Marquer la mission comme annulée
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "cancelled", cancellation_reason: reason || null, cancellation_penalty: penalty || 0 }),
      });

      // Créer un ticket support prioritaire si paiement existant (remboursement traité manuellement par ALANE)
      if (mission.stripe_payment_intent) {
        const penaltyLabel = penalty === 0 ? "remboursement intégral à traiter" : penalty === 50 ? "remboursement 50% à traiter" : "aucun remboursement (annulation <24h)";
        await fetch(`${SUPABASE_URL}/rest/v1/support_tickets`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            subject: `[ANNULATION] Mission ${mission_id.slice(0, 8)} — ${penaltyLabel}`,
            message: `Mission annulée par le client.\n\nMission : ${mission.metier || mission.sector || "—"}\nMontant : ${mission.montant_total || "—"} €\nPaymentIntent Stripe : ${mission.stripe_payment_intent}\nPénalité appliquée : ${penalty ?? 0}%\nMotif : ${reason || "—"}\n\nAction requise : traiter le remboursement manuellement dans le dashboard Stripe.`,
            user_email: clientEmail,
            user_id: caller.id,
            status: "open",
          }),
        }).catch(() => {});

        // Alerter l'admin par email
        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        const RESEND_FROM    = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
        const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;
        if (RESEND_API_KEY && ADMIN_EMAIL) {
          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: RESEND_FROM,
              to: ADMIN_EMAIL,
              subject: `[ACTION REQUISE] Annulation mission — ${penaltyLabel}`,
              html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
                <h2 style="color:#050E20">⚠️ Annulation mission — remboursement à traiter</h2>
                <table style="width:100%;border-collapse:collapse;font-size:14px">
                  <tr><td style="padding:6px 0;color:#666">Mission</td><td style="font-weight:700">${mission.metier || mission.sector || "—"}</td></tr>
                  <tr><td style="padding:6px 0;color:#666">Montant</td><td style="font-weight:700">${mission.montant_total || "—"} €</td></tr>
                  <tr><td style="padding:6px 0;color:#666">PaymentIntent</td><td style="font-weight:700;font-size:12px">${mission.stripe_payment_intent}</td></tr>
                  <tr><td style="padding:6px 0;color:#666">Pénalité</td><td style="font-weight:700;color:${penalty === 0 ? "#10D98F" : "#F0B429"}">${penalty ?? 0}%</td></tr>
                  <tr><td style="padding:6px 0;color:#666">Motif</td><td>${reason || "—"}</td></tr>
                  <tr><td style="padding:6px 0;color:#666">Client</td><td>${clientEmail || caller.id}</td></tr>
                </table>
                <p style="margin-top:20px;font-size:13px;color:#666">Traiter le remboursement depuis le <a href="https://dashboard.stripe.com/payments/${mission.stripe_payment_intent}" style="color:#7C6FE0">dashboard Stripe</a>.</p>
              </div>`,
            }),
          }).catch(() => {});
        }
      }

      // Notifier le prestataire
      if (mission.prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: mission.prestataire_id,
            type: "mission",
            title: "Mission annulée ❌",
            body: `La mission "${mission.metier || mission.sector || ""}" a été annulée par le client. L'équipe ALANE vous contactera concernant le règlement.`,
            read: false,
          }),
        }).catch(() => {});
      }

      return res.status(200).json({ success: true });
    }

    if (action === "my_missions") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const [r1, r2] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${caller.id}&status=eq.pending_acceptance&select=id,sector,metier,date,hours,tarif_horaire,acceptance_deadline,client_id,titre,ville,adresse,description&order=created_at.desc`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${caller.id}&status=eq.assigned&select=id,sector,metier,date,hours,tarif_horaire,client_id,titre,ville,adresse,description&order=created_at.desc`, { headers }),
      ]);
      const [pending, assigned] = await Promise.all([r1.json(), r2.json()]);
      return res.status(200).json({
        pending:  Array.isArray(pending)  ? pending  : [],
        assigned: Array.isArray(assigned) ? assigned : [],
      });
    }

    if (action === "respond_mission") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, response, presta_name } = payload;
      if (!mission_id || !isUuid(mission_id)) return res.status(400).json({ error: "mission_id requis" });
      if (!["accept","refuse"].includes(response)) return res.status(400).json({ error: "response invalide" });

      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&prestataire_id=eq.${caller.id}&status=eq.pending_acceptance&select=id,client_id,sector,metier,titre`, { headers });
      const mData = await mr.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable ou délai dépassé" });

      const newStatus = response === "accept" ? "assigned" : "refused";
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (mission.client_id) {
        const missionLabel = mission.titre || mission.metier || "";
        const isAccepted = response === "accept";

        // Notification in-app client
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: mission.client_id,
            type: "mission",
            title: isAccepted ? "Mission acceptée ! 🎉" : "Mission refusée",
            body: isAccepted
              ? `${presta_name || "Votre prestataire"} a accepté votre demande de mission.`
              : `${presta_name || "Le prestataire"} a décliné votre demande. Vous pouvez choisir un autre prestataire.`,
            read: false,
          }),
        }).catch(() => {});

        // Email + SMS client
        const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${mission.client_id}`, { headers });
        const ud = await ur.json();
        const clientEmail = ud.email;
        const phone = ud.user_metadata?.telephone;
        const clientName = ud.user_metadata?.prenom || "Client";

        const RESEND_KEY  = process.env.RESEND_API_KEY;
        const RESEND_FROM = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
        if (RESEND_KEY && clientEmail) {
          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: RESEND_FROM,
              to: [clientEmail],
              subject: isAccepted ? `✅ ${presta_name || "Votre prestataire"} a accepté la mission !` : `❌ ${presta_name || "Le prestataire"} a refusé la mission`,
              html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
                <h2 style="color:${isAccepted?"#10D98F":"#F25E5E"};margin:0 0 12px">${isAccepted?"Mission acceptée ✅":"Mission refusée ❌"}</h2>
                <p>Bonjour ${clientName},</p>
                ${isAccepted
                  ? `<p><strong>${presta_name || "Votre prestataire"}</strong> a accepté votre demande de mission <strong>${missionLabel}</strong>.</p><p>Connectez-vous à ALANE pour suivre la mission.</p>`
                  : `<p><strong>${presta_name || "Le prestataire"}</strong> a décliné votre mission <strong>${missionLabel}</strong>.</p><p>Connectez-vous à ALANE pour choisir un autre prestataire.</p>`
                }
                <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE</p>
              </div>`,
            }),
          }).catch(() => {});
        }

        const BREVO_KEY = process.env.BREVO_API_KEY;
        if (BREVO_KEY && phone) {
          const digits = phone.replace(/\D/g, "");
          const e164 = digits.startsWith("0") ? "33" + digits.slice(1) : digits.startsWith("33") ? digits : null;
          if (e164) {
            fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
              method: "POST",
              headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
              body: JSON.stringify({
                sender: "ALANE",
                recipient: e164,
                content: isAccepted
                  ? `ALANE - ${presta_name || "Votre prestataire"} a accepté votre mission ${missionLabel}. Connectez-vous pour suivre.`
                  : `ALANE - ${presta_name || "Le prestataire"} a refusé votre mission ${missionLabel}. Connectez-vous pour choisir un autre prestataire.`,
              }),
            }).catch(() => {});
          }
        }
      }

      return res.status(200).json({ success: true });
    }

    if (action === "notify_client") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { client_id, type, mission_label, presta_name } = payload;
      if (!client_id || !isUuid(client_id)) return res.status(400).json({ error: "client_id requis" });

      const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${client_id}`, { headers });
      const ud = await ur.json();
      const clientEmail = ud.email;
      const phone = ud.user_metadata?.telephone;
      const clientName = ud.user_metadata?.prenom || "Client";

      const isAccepted = type === "accepted";
      const subject = isAccepted
        ? `✅ ${presta_name || "Votre prestataire"} a accepté la mission !`
        : `❌ ${presta_name || "Le prestataire"} a refusé la mission`;
      const smsText = isAccepted
        ? `ALANE - ${presta_name || "Votre prestataire"} a accepté votre mission ${mission_label || ""}. Connectez-vous pour suivre la mission.`
        : `ALANE - ${presta_name || "Le prestataire"} a refusé votre mission ${mission_label || ""}. Connectez-vous pour choisir un autre prestataire.`;

      const RESEND_KEY  = process.env.RESEND_API_KEY;
      const RESEND_FROM = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
      if (RESEND_KEY && clientEmail) {
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: [clientEmail],
            subject,
            html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
              <h2 style="color:${isAccepted?"#10D98F":"#F25E5E"};margin:0 0 12px">${isAccepted?"Mission acceptée ✅":"Mission refusée ❌"}</h2>
              <p>Bonjour ${clientName},</p>
              ${isAccepted
                ? `<p><strong>${presta_name || "Votre prestataire"}</strong> a accepté votre demande de mission <strong>${mission_label || ""}</strong>.</p><p>Connectez-vous à ALANE pour suivre la mission.</p>`
                : `<p><strong>${presta_name || "Le prestataire"}</strong> a décliné votre demande pour la mission <strong>${mission_label || ""}</strong>.</p><p>Connectez-vous à ALANE pour choisir un autre prestataire.</p>`
              }
              <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE</p>
            </div>`,
          }),
        }).catch(() => {});
      } else {
        console.log("[notify_client] email skipped — RESEND_KEY:", !!RESEND_KEY, "clientEmail:", clientEmail);
      }

      const BREVO_KEY = process.env.BREVO_API_KEY;
      if (BREVO_KEY && phone) {
        const digits = phone.replace(/\D/g, "");
        const e164 = digits.startsWith("0") ? "33" + digits.slice(1) : digits.startsWith("33") ? digits : null;
        if (e164) {
          fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
            method: "POST",
            headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ sender: "ALANE", recipient: e164, content: smsText }),
          }).then(r => r.json()).then(d => console.log("[notify_client] SMS:", JSON.stringify(d))).catch(e => console.log("[notify_client] SMS error:", e.message));
        }
      } else {
        console.log("[notify_client] SMS skipped — BREVO_KEY:", !!BREVO_KEY, "phone:", phone);
      }

      return res.status(200).json({ success: true });
    }

    if (action === "notify_prestataire") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { prestataire_id, mission_label, date, ville, hours } = payload;
      if (!prestataire_id || !isUuid(prestataire_id)) return res.status(400).json({ error: "prestataire_id requis" });

      const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${prestataire_id}`, { headers });
      const ud = await ur.json();
      const prestaEmail = ud.email;
      const phone = ud.user_metadata?.telephone;
      const prestaName = ud.user_metadata?.prenom || "Prestataire";

      const RESEND_KEY  = process.env.RESEND_API_KEY;
      const RESEND_FROM = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
      if (RESEND_KEY && prestaEmail) {
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: [prestaEmail],
            subject: "🔔 Nouvelle demande de mission — répondez rapidement !",
            html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
              <h2 style="color:#A29BFE;margin:0 0 12px">Nouvelle demande de mission 🔔</h2>
              <p>Bonjour ${prestaName},</p>
              <p>Un client vous a envoyé une demande de mission directe :</p>
              <div style="background:#162547;border-left:4px solid #A29BFE;padding:12px 16px;margin:16px 0;border-radius:4px">
                <strong>${mission_label || "Mission"}</strong><br/>
                📅 ${date || "Date à confirmer"}<br/>
                📍 ${ville || "Ville à confirmer"}<br/>
                ⏱ ${hours || "?"}h
              </div>
              <p>Connectez-vous à <strong>ALANE</strong> pour accepter ou refuser dans les délais impartis.</p>
              <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE</p>
            </div>`,
          }),
        }).catch(() => {});
      } else {
        console.log("[notify_prestataire] email skipped — RESEND_KEY:", !!RESEND_KEY, "prestaEmail:", prestaEmail);
      }

      const BREVO_KEY = process.env.BREVO_API_KEY;
      if (BREVO_KEY && phone) {
        const digits = phone.replace(/\D/g, "");
        const e164 = digits.startsWith("0") ? "33" + digits.slice(1) : digits.startsWith("33") ? digits : null;
        if (e164) {
          fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
            method: "POST",
            headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({
              sender: "ALANE",
              recipient: e164,
              content: `ALANE - Demande de mission : ${mission_label || "Mission"} le ${date || "?"} à ${ville || "?"} (${hours || "?"}h). Connectez-vous pour répondre !`,
            }),
          }).then(r => r.json()).then(d => console.log("[notify_prestataire] SMS:", JSON.stringify(d))).catch(e => console.log("[notify_prestataire] SMS error:", e.message));
        }
      } else {
        console.log("[notify_prestataire] SMS skipped — BREVO_KEY:", !!BREVO_KEY, "phone:", phone);
      }

      // Web push (si souscription existante)
      const psRes2 = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${prestataire_id}&select=endpoint,p256dh,auth`, { headers });
      const psRows = await psRes2.json().catch(() => []);
      if (Array.isArray(psRows)) {
        await Promise.all(psRows.map(s => sendWebPush(s, {
          title: "🔔 Nouvelle mission pour vous",
          body: `${mission_label || "Mission"}${date ? " · " + date : ""}${ville ? " · " + ville : ""}${hours ? " (" + hours + "h)" : ""}`,
          url: "/",
        })));
      }

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Action invalide" });
  } catch (e) {
    console.error("missions error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
