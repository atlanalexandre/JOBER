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
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { sector, metier } = payload;
      let url = `${SUPABASE_URL}/rest/v1/missions?status=in.(open,needs_replacement)&order=created_at.desc`;
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
      if (!Array.isArray(missions) || missions.length === 0) return res.status(200).json([]);

      // Fetch all candidatures for all missions in parallel
      const missionIds = missions.map(m => m.id);
      const allCandidaturesRes = await fetch(
        `${SUPABASE_URL}/rest/v1/candidatures?mission_id=in.(${missionIds.join(",")})&select=id,mission_id,prestataire_id,status,created_at,message`,
        { headers }
      );
      const allCandidatures = await allCandidaturesRes.json().catch(() => []);
      const rawAll = Array.isArray(allCandidatures) ? allCandidatures : [];

      // Collect ALL prestataire IDs: from candidatures + directly assigned on missions
      const directPrestaIds = missions.map(m => m.prestataire_id).filter(Boolean);
      const allPrestaIds = [...new Set([...rawAll.map(c => c.prestataire_id).filter(Boolean), ...directPrestaIds])];
      const profileMap = {};
      if (allPrestaIds.length > 0) {
        const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=in.(${allPrestaIds.join(",")})&select=id,prenom,nom`, { headers });
        const profiles = await pr.json().catch(() => []);
        if (Array.isArray(profiles)) profiles.forEach(p => { profileMap[p.id] = p; });

        // Fallback: fetch user_metadata for profiles with empty names
        const emptyIds = allPrestaIds.filter(id => !profileMap[id]?.prenom && !profileMap[id]?.nom);
        if (emptyIds.length > 0) {
          const metaMap = {};
          await Promise.all(emptyIds.map(async id => {
            try {
              const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { headers });
              const u = await ur.json();
              if (u?.user_metadata?.prenom || u?.user_metadata?.nom) {
                metaMap[id] = { prenom: u.user_metadata.prenom || "", nom: u.user_metadata.nom || "" };
              }
            } catch {}
          }));
          Object.assign(profileMap, metaMap);
        }
      }

      // Group candidatures by mission and enrich with names
      const candByMission = {};
      for (const c of rawAll) {
        if (!candByMission[c.mission_id]) candByMission[c.mission_id] = [];
        candByMission[c.mission_id].push({
          ...c,
          prenom: profileMap[c.prestataire_id]?.prenom || "",
          nom:    profileMap[c.prestataire_id]?.nom    || "",
        });
      }

      // Enrich missions: candidatures + prestataire name directly on mission (for direct assignments without candidatures)
      const enriched = missions.map(m => ({
        ...m,
        candidatures: candByMission[m.id] || [],
        prestataire_prenom: m.prestataire_id ? (profileMap[m.prestataire_id]?.prenom || "") : "",
        prestataire_nom:    m.prestataire_id ? (profileMap[m.prestataire_id]?.nom    || "") : "",
      }));
      return res.status(200).json(enriched);
    }

    if (action === "get_candidatures") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id } = payload;
      if (!mission_id || !isUuid(mission_id)) return res.status(400).json({ error: "mission_id requis" });
      // Vérifier que le caller est bien le client de cette mission
      const mRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id`, { headers });
      const mData = await mRes.json();
      const missionCheck = Array.isArray(mData) && mData[0];
      if (!missionCheck || missionCheck.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${mission_id}&order=created_at.asc`,
        { headers }
      );
      const candidatures = await r.json();
      if (!Array.isArray(candidatures)) return res.status(200).json([]);

      const prestaIds = [...new Set(candidatures.map(c => c.prestataire_id).filter(Boolean))];
      const nameMap = {};
      if (prestaIds.length > 0) {
        const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=in.(${prestaIds.join(",")})&select=id,prenom,nom`, { headers });
        const profiles = await pr.json().catch(() => []);
        if (Array.isArray(profiles)) profiles.forEach(p => { nameMap[p.id] = { prenom: p.prenom || "", nom: p.nom || "" }; });
        // Fallback user_metadata for empty names
        const emptyIds = prestaIds.filter(id => !nameMap[id]?.prenom && !nameMap[id]?.nom);
        await Promise.all(emptyIds.map(async id => {
          try {
            const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { headers });
            const u = await ur.json();
            if (u?.user_metadata?.prenom || u?.user_metadata?.nom) {
              nameMap[id] = { prenom: u.user_metadata.prenom || "", nom: u.user_metadata.nom || "" };
            }
          } catch {}
        }));
      }
      const enriched = candidatures.map(c => ({
        ...c,
        prenom: nameMap[c.prestataire_id]?.prenom || "",
        nom:    nameMap[c.prestataire_id]?.nom    || "",
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

    if (action === "accept") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { candidature_id, mission_id, prestataire_id } = payload;
      if (!candidature_id || !mission_id) return res.status(400).json({ error: "candidature_id et mission_id requis" });
      if (!isUuid(candidature_id) || !isUuid(mission_id)) return res.status(400).json({ error: "IDs invalides" });

      // Vérifier que la candidature appartient bien à cette mission et récupérer le vrai prestataire_id
      const candCheckRes = await fetch(`${SUPABASE_URL}/rest/v1/candidatures?id=eq.${candidature_id}&mission_id=eq.${mission_id}&select=id,prestataire_id`, { headers });
      const candCheckData = await candCheckRes.json();
      if (!Array.isArray(candCheckData) || !candCheckData[0]) return res.status(403).json({ error: "Candidature invalide pour cette mission" });
      // Utiliser le prestataire_id de la candidature, jamais celui du payload (évite l'assignation à un tiers)
      const verified_prestataire_id = candCheckData[0].prestataire_id;

      // Vérifier la limite mensuelle du prestataire avant l'assignation
      if (verified_prestataire_id && isUuid(verified_prestataire_id)) {
        const limitOk = await (async () => {
          try {
            let PLAN_LIMITS = { free: 2, premium: 10, elite: 999 };
            const slRes = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings?key=eq.plan_limits&select=value`, { headers });
            const slData = await slRes.json();
            if (Array.isArray(slData) && slData[0]?.value) PLAN_LIMITS = slData[0].value;

            const [urRes, prRes] = await Promise.all([
              fetch(`${SUPABASE_URL}/auth/v1/admin/users/${verified_prestataire_id}`, { headers }),
              fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${verified_prestataire_id}&select=missions_completed_month,trial_exhausted`, { headers }),
            ]);
            const urData = await urRes.json();
            const prData = await prRes.json();
            let plan = urData.user_metadata?.plan_abonnement || "free";
            const endDate = urData.user_metadata?.subscription_end_date;
            if (endDate && plan !== "free" && new Date(endDate) < new Date()) {
              plan = "free";
              fetch(`${SUPABASE_URL}/auth/v1/admin/users/${verified_prestataire_id}`, { method:"PUT", headers, body: JSON.stringify({ user_metadata: { plan_abonnement:"free", subscription_end_date:null } }) }).catch(()=>{});
              fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${verified_prestataire_id}`, { method:"PATCH", headers:{ ...headers, "Prefer":"return=minimal" }, body: JSON.stringify({ plan_abonnement:"free" }) }).catch(()=>{});
            }

            const trialExhausted = Array.isArray(prData) && prData[0]?.trial_exhausted === true;
            const basePlanLimit = PLAN_LIMITS[plan] ?? 2;
            const limit = (trialExhausted && plan === "free") ? 0 : basePlanLimit;
            if (limit < 999) {
              const completed = (Array.isArray(prData) && prData[0]?.missions_completed_month) || 0;
              const asgnRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${verified_prestataire_id}&status=in.(assigned,pending_acceptance)&select=id`, { headers });
              const asgnData = await asgnRes.json();
              const total = completed + (Array.isArray(asgnData) ? asgnData.length : 0);
              if (total >= limit) return { error: `Limite atteinte — le prestataire a atteint sa limite de ${limit} mission${limit > 1 ? "s" : ""}/mois pour son plan ${plan}.`, limit_reached: true };
            }
            return null;
          } catch { return { error: "Erreur vérification limite plan", limit_reached: false }; }
        })();
        if (limitOk) return res.status(403).json(limitOk);
      }

      // Récupérer le tarif_net du prestataire depuis user_metadata
      let tarifHoraire = 0;
      if (verified_prestataire_id) {
        try {
          const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${verified_prestataire_id}`, { headers });
          const ud = await ur.json();
          tarifHoraire = Number(ud.user_metadata?.tarif_net) || 0;
        } catch {}
      }

      // Vérifier si la mission a déjà un paiement Stripe
      const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
      const mCheckRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=stripe_payment_intent,hours,client_id`, { headers });
      const mCheckData = await mCheckRes.json();
      const missionCheck = Array.isArray(mCheckData) && mCheckData[0];
      if (missionCheck && missionCheck.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });

      if (missionCheck && !missionCheck.stripe_payment_intent && STRIPE_SECRET_KEY) {
        try {
          const hours = missionCheck.hours || 1;
          const amountCents = Math.max(50, Math.round(tarifHoraire * hours * 100));
          const params = new URLSearchParams({
            amount: String(amountCents),
            currency: "eur",
            "metadata[mission]": mission_id,
            "metadata[candidature_id]": candidature_id,
            "metadata[prestataire_id]": verified_prestataire_id || "",
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
      if (verified_prestataire_id) missionPatch.prestataire_id = verified_prestataire_id;
      if (tarifHoraire)            missionPatch.tarif_horaire  = tarifHoraire;
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify(missionPatch),
      });

      // Notification au prestataire
      if (verified_prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: verified_prestataire_id,
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
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=hours,tarif_horaire,status,prestataire_id,metier,sector,client_id,validation_prestataire,recurrence,date,ville,adresse,description,heure_debut`, { headers });
      const missions = await mr.json();
      const mission = Array.isArray(missions) && missions[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable" });
      if (mission.client_id !== client_id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "assigned") return res.status(400).json({ error: "Mission non assignée" });
      if (!mission.validation_prestataire) return res.status(400).json({ error: "Le prestataire n'a pas encore confirmé la fin de mission" });

      const hours        = mission.hours || 0;
      const tarifHoraire = mission.tarif_horaire || 0;
      const montantTotal = Math.round(hours * tarifHoraire * 100) / 100;

      // Récupérer le palier cashback du client (missions_completed_month)
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${client_id}&select=cashback_balance,missions_completed_month`, { headers });
      const profiles = await pr.json();
      const profile = Array.isArray(profiles) && profiles[0];
      const missionsThisMonth = (profile?.missions_completed_month || 0) + 1;

      // Calcul du taux selon palier — lu depuis platform_settings pour rester synchronisé avec le BO
      let CASHBACK_TIERS = [
        { min:0,  max:2,  rate:0.005  },
        { min:3,  max:5,  rate:0.0075 },
        { min:6,  max:9,  rate:0.01   },
        { min:10, max:999, rate:0.015 },
      ];
      try {
        const cbRes = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings?key=eq.cashback_rates&select=value`, { headers });
        const cbData = await cbRes.json();
        if (Array.isArray(cbData) && Array.isArray(cbData[0]?.value)) CASHBACK_TIERS = cbData[0].value;
      } catch {}
      const rate = [...CASHBACK_TIERS].reverse().find(t => missionsThisMonth >= t.min)?.rate || 0.01;
      const cashbackEarned = Math.round(montantTotal * rate * 100) / 100;
      const newBalance = Math.round(((profile?.cashback_balance || 0) + cashbackEarned) * 100) / 100;

      // Marquer mission completed — condition sur status=assigned pour éviter le double-crédit en cas de requête concurrente
      const completePatchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=eq.assigned`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation", "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", montant_total: montantTotal, validation_client: true }),
      });
      const completedRows = await completePatchRes.json().catch(() => []);
      if (!Array.isArray(completedRows) || completedRows.length === 0) {
        return res.status(409).json({ error: "Mission déjà validée" });
      }

      // Mise à jour atomique du cashback via RPC pour éviter les race conditions (double-crédit)
      const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_cashback`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({ p_user_id: client_id, p_delta: cashbackEarned, p_missions: 1 }),
      });
      const rpcData = await rpcRes.json().catch(() => null);
      const atomicBalance = Array.isArray(rpcData) && rpcData[0]?.cashback_balance != null
        ? rpcData[0].cashback_balance
        : newBalance;

      // Notification cashback au client
      if (cashbackEarned > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: client_id,
            type: "cashback",
            title: "Cashback crédité 💰",
            body: `+${cashbackEarned.toFixed(2)} € crédités sur votre wallet suite à la validation de votre mission. Solde : ${atomicBalance.toFixed ? atomicBalance.toFixed(2) : atomicBalance} €`,
            read: false,
          }),
        });
      }

      // Création automatique de la prochaine occurrence si mission récurrente
      if (mission.recurrence && mission.date) {
        try {
          const currentDate = new Date(mission.date);
          let nextDate = new Date(currentDate);
          if (mission.recurrence === "weekly") {
            nextDate.setDate(nextDate.getDate() + 7);
          } else if (mission.recurrence === "biweekly") {
            nextDate.setDate(nextDate.getDate() + 14);
          } else if (mission.recurrence === "monthly") {
            const originalDay = currentDate.getDate();
            nextDate.setMonth(nextDate.getMonth() + 1);
            // Handle month-end edge cases (e.g. Jan 31 → Feb 28)
            if (nextDate.getDate() !== originalDay) {
              nextDate.setDate(0); // last day of the intended month
            }
          }
          const nextDateStr = nextDate.toISOString().slice(0, 10);
          const newMissionBody = {
            client_id: mission.client_id,
            sector: mission.sector,
            metier: mission.metier || null,
            date: nextDateStr,
            hours: mission.hours,
            ville: mission.ville || null,
            adresse: mission.adresse || null,
            description: mission.description || null,
            heure_debut: mission.heure_debut || null,
            tarif_horaire: mission.tarif_horaire || null,
            recurrence: mission.recurrence,
            parent_mission_id: mission_id,
            status: "open",
            prestataire_id: null,
            stripe_payment_intent: null,
            montant_total: null,
          };
          const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/missions`, {
            method: "POST",
            headers: { ...headers, "Prefer": "return=representation" },
            body: JSON.stringify(newMissionBody),
          });
          const insertData = await insertRes.json().catch(() => null);
          const newMissionId = Array.isArray(insertData) && insertData[0]?.id;

          // Notification in-app au client
          const recurrenceLabel = mission.recurrence === "weekly" ? "hebdomadaire" : mission.recurrence === "biweekly" ? "bi-mensuelle" : "mensuelle";
          await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
            method: "POST",
            headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({
              user_id: client_id,
              type: "mission",
              title: "🔄 Mission récurrente planifiée",
              body: `Votre prochaine mission ${mission.metier || mission.sector || ""} (${recurrenceLabel}) a été programmée pour le ${nextDateStr}.`,
              read: false,
            }),
          }).catch(() => {});
        } catch (recErr) {
          console.error("[complete] recurrence creation error:", recErr.message);
        }
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
                    <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
                  </div>`,
                }),
              }).catch(() => {});
            }
          } catch {}
        }
      }

      return res.status(200).json({ success: true, montantTotal, cashbackEarned, newBalance });
    }

    if (action === "dispute") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, message } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });

      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,client_id,prestataire_id,metier,sector`, { headers });
      const missions = await mr.json();
      const mission = Array.isArray(missions) && missions[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable" });
      if (mission.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "completed") return res.status(400).json({ error: "La mission doit être terminée pour signaler un litige" });

      // Passer la mission en litige
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "disputed" }),
      });

      // Créer un ticket de support
      await fetch(`${SUPABASE_URL}/rest/v1/support_tickets`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          subject: "Litige — " + (mission.metier || mission.sector || "Prestation"),
          message: message || "Contestation de la qualité de la prestation",
          user_id: caller.id,
          status: "open",
        }),
      });

      // Notification au prestataire
      if (mission.prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: mission.prestataire_id,
            type: "system",
            title: "Prestation contestée ⚠️",
            body: "Le client a signalé un problème sur votre prestation. ALANE examine le dossier sous 72h.",
            read: false,
          }),
        }).catch(() => {});
      }

      return res.status(200).json({ ok: true });
    }

    if (action === "validate_presta") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, contrat_presta_signe_at } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,prestataire_id,client_id,metier,sector,validation_prestataire,date,heure_debut,hours,ville`, { headers });
      const missions = await mr.json();
      const mission = Array.isArray(missions) && missions[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable" });
      if (mission.prestataire_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "assigned") return res.status(400).json({ error: "Mission non assignée" });
      if (mission.validation_prestataire) return res.status(400).json({ error: "Vous avez déjà confirmé la fin de cette mission" });
      if (mission.date) {
        const [h, mn] = (mission.heure_debut || "08:00").split(":").map(Number);
        // heure_debut is stored as French local time; server runs UTC.
        // Subtract UTC+1 (France minimum offset) to convert to UTC conservatively.
        const missionStartNaive = new Date(`${mission.date}T${String(h).padStart(2,"0")}:${String(mn||0).padStart(2,"0")}:00`);
        const missionStart = new Date(missionStartNaive.getTime() - 3600000);
        const missionEnd = new Date(missionStart.getTime() + Math.ceil(mission.hours || 1) * 3600000);
        if (missionEnd > new Date()) return res.status(400).json({ error: "Vous ne pouvez pas confirmer une mission qui n'est pas encore terminée" });
      }

      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ validation_prestataire: true, contrat_presta_signe_at: contrat_presta_signe_at || new Date().toISOString() }),
      });
      if (!patchRes.ok) return res.status(500).json({ error: "Erreur lors de la validation" });

      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          user_id: mission.client_id,
          type: "mission",
          title: "Mission à valider ✅",
          body: `Le prestataire a confirmé la fin de mission "${mission.metier || mission.sector || ""}". Validez-la depuis votre espace pour débloquer son paiement.`,
          read: false,
        }),
      }).catch(() => {});

      // Send email to client
      fetch(`${SUPABASE_URL}/auth/v1/admin/users/${mission.client_id}`, { headers })
        .then(r => r.json())
        .then(async clientUser => {
          const clientEmail = clientUser?.email;
          const clientName = clientUser?.user_metadata?.prenom || clientUser?.user_metadata?.nom || "";
          if (!clientEmail) return;
          const metier = mission.metier || mission.sector || "Mission";
          const missionDate = mission.date || "";
          const ville = mission.ville || "";
          const appUrl = process.env.APP_URL || "https://www.alane.fr";
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            },
            body: JSON.stringify({
              from: process.env.RESEND_FROM || "onboarding@resend.dev",
              to: clientEmail,
              subject: `✅ Validez la fin de mission — ${metier} · ALANE`,
              html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0A1628;color:#fff;padding:0;border-radius:20px;overflow:hidden">
                <div style="background:linear-gradient(135deg,#1a2d5a,#0D1B3E);padding:32px 32px 24px">
                  <div style="font-size:28px;margin-bottom:8px">✅</div>
                  <h2 style="color:#A29BFE;margin:0 0 4px;font-size:20px;font-weight:800">Mission à valider</h2>
                  <p style="margin:0;color:rgba(255,255,255,0.5);font-size:13px">ALANE · Plateforme de missions</p>
                </div>
                <div style="padding:28px 32px">
                  ${clientName ? `<p style="margin:0 0 16px;color:rgba(255,255,255,0.85);font-size:15px">Bonjour ${clientName},</p>` : ""}
                  <p style="margin:0 0 20px;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.6">
                    Le prestataire a confirmé la fin de la mission. Vous avez <strong style="color:#F0B429">24h pour valider</strong> depuis votre espace. Passé ce délai, la mission sera validée automatiquement.
                  </p>
                  <div style="background:#0D1B3E;border:1px solid rgba(162,155,254,0.15);border-radius:14px;padding:18px;margin-bottom:24px">
                    <div style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:12px">Détails de la mission</div>
                    <div style="display:flex;flex-direction:column;gap:8px">
                      <div style="display:flex;align-items:center;gap:10px">
                        <span style="font-size:16px">💼</span>
                        <span style="color:#fff;font-weight:700;font-size:15px">${metier}</span>
                      </div>
                      ${missionDate ? `<div style="display:flex;align-items:center;gap:10px"><span style="font-size:14px">📅</span><span style="color:rgba(255,255,255,0.7);font-size:13px">${missionDate}</span></div>` : ""}
                      ${ville ? `<div style="display:flex;align-items:center;gap:10px"><span style="font-size:14px">📍</span><span style="color:rgba(255,255,255,0.7);font-size:13px">${ville}</span></div>` : ""}
                    </div>
                  </div>
                  <a href="${appUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#A29BFE,#6C63FF);color:#fff;text-decoration:none;padding:14px 24px;border-radius:12px;font-weight:800;font-size:15px;letter-spacing:0.3px">
                    Valider la mission →
                  </a>
                </div>
                <div style="padding:16px 32px 24px;text-align:center">
                  <p style="margin:0;color:rgba(255,255,255,0.25);font-size:11px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
                </div>
              </div>`,
            }),
          });
        })
        .catch(() => {});

      return res.status(200).json({ success: true });
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
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,prestataire_id,client_id,sector,metier,date,hours,ville,stripe_payment_intent`,
        { headers }
      );
      const mData = await mr.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable" });
      if (mission.prestataire_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "assigned") return res.status(400).json({ error: "Mission non assignée" });

      // Si déjà payée → needs_replacement (pas de re-paiement), sinon retour open
      const newStatus = mission.stripe_payment_intent ? "needs_replacement" : "open";
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: newStatus, prestataire_id: null, validation_prestataire: false }),
      });

      // Rejeter la candidature du prestataire désisté
      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${mission_id}&prestataire_id=eq.${caller.id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "rejected" }),
      });

      // Consommer un slot mensuel si annulation dans les 24h précédant la mission
      try {
        const missionDate = new Date(mission.date);
        const hoursUntilMission = (missionDate - new Date()) / (1000 * 60 * 60);
        if (hoursUntilMission < 24) {
          const prRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=missions_completed_month`, { headers });
          const prData = await prRes.json();
          const current = Array.isArray(prData) && prData[0] ? (prData[0].missions_completed_month || 0) : 0;
          await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}`, {
            method: "PATCH",
            headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({ missions_completed_month: current + 1 }),
          });
        }
      } catch {}

      // Notifier le client
      if (mission.client_id) {
        const clientTitle = mission.stripe_payment_intent
          ? "Prestataire désisté — votre paiement est sécurisé 🔄"
          : "Prestataire désisté — mission réouverte 🔄";
        const clientBody = mission.stripe_payment_intent
          ? `Votre mission "${mission.metier || mission.sector}" du ${mission.date} recherche un remplaçant. Votre paiement est conservé, aucune nouvelle facturation ne sera effectuée.`
          : `Votre mission "${mission.metier || mission.sector}" du ${mission.date} a été réouverte automatiquement. De nouveaux prestataires vont être notifiés.`;
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ user_id: mission.client_id, type: "mission", title: clientTitle, body: clientBody, read: false }),
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

      const mRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id,status`, { headers });
      const mData = await mRes.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission || mission.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (!["open", "rejected", "refused", "closed"].includes(mission.status)) {
        return res.status(400).json({ error: "Utilisez l'annulation pour clore une mission en cours" });
      }

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
      console.log("[broadcast] mission_id:", mission_id, "sector:", sector);

      // Verify caller owns this mission
      const ownerCheck = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&client_id=eq.${caller.id}&select=id&limit=1`, { headers });
      const ownerData = await ownerCheck.json();
      if (!Array.isArray(ownerData) || ownerData.length === 0) return res.status(403).json({ error: "Non autorisé" });

      // Fetch mission details
      const mr = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=sector,metier,date,hours,ville`,
        { headers }
      );
      const missions = await mr.json();
      const mission = Array.isArray(missions) && missions[0];
      console.log("[broadcast] mission found:", !!mission);

      // Fetch all approved prestataires
      const pr = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&select=id`,
        { headers }
      );
      const profiles = await pr.json();
      console.log("[broadcast] approved prestataires count:", Array.isArray(profiles) ? profiles.length : profiles);

      // Fetch all auth users upfront to avoid N+1 (one call instead of one per prestataire)
      const allUsersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`, { headers });
      const allUsersData = await allUsersRes.json().catch(() => ({}));
      const userMetaMap = {};
      if (Array.isArray(allUsersData?.users)) {
        for (const u of allUsersData.users) userMetaMap[u.id] = u;
      }

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
              const ud = userMetaMap[p.id] || {};
              const meta = ud.user_metadata || {};
              const presta_sector = meta.secteur || meta.sector;
              console.log("[broadcast] checking prestataire sector:", presta_sector, "vs mission:", sector);
              if (sector && presta_sector !== sector) return;

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

              console.log("[broadcast] in-app notification sent");

              // Email Resend (quand app fermée)
              const RESEND_KEY_B = process.env.RESEND_API_KEY;
              const RESEND_FROM_B = process.env.RESEND_FROM || "ALANE <no-reply@alane.fr>";
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
                      <h2 style="color:#4F46E5">Nouvelle mission ALANE</h2>
                      <p>Une nouvelle mission correspond à votre profil :</p>
                      <div style="background:#f5f5f5;border-left:4px solid #4F46E5;padding:12px 16px;margin:16px 0;border-radius:4px">
                        <strong>${missionLabel}</strong><br/>
                        📅 ${mission?.date || "Date à confirmer"}<br/>
                        📍 ${mission?.ville || "Ville à confirmer"}<br/>
                        ⏱ ${mission?.hours || "?"}h
                      </div>
                      <p>Connectez-vous à ALANE pour postuler.</p>
                      <p style="margin-top:24px;color:#888;font-size:12px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
                    </div>`,
                  }),
                }).catch(() => {});
              }

              // SMS Brevo (si numéro dispo et clé configurée)
              const BREVO_KEY = process.env.BREVO_API_KEY;
              const phone = meta.telephone;
              console.log("[broadcast] SMS check - BREVO_KEY:", !!BREVO_KEY, "hasPhone:", !!phone);
              if (BREVO_KEY && phone) {
                const digits = phone.replace(/\D/g, "");
                const e164 = digits.startsWith("0") ? "33" + digits.slice(1) : digits.startsWith("33") ? digits : null;
                if (e164) {
                  const smsText = `ALANE - Nouvelle mission : ${mission?.metier || sector || "Mission"} le ${mission?.date || "?"} a ${mission?.ville || "?"} (${mission?.hours || "?"}h). Connectez-vous pour postuler. — alane.fr`;
                  console.log("[broadcast] sending SMS");
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
      const esc = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
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
      const RESEND_FROM = process.env.RESEND_FROM || "ALANE <no-reply@alane.fr>";
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
                <h2 style="color:#4F46E5">Nouveau message ALANE</h2>
                <p><strong>${sender_name || "Votre contact"}</strong> vous a envoyé un message :</p>
                <div style="background:#f5f5f5;border-left:4px solid #4F46E5;padding:12px 16px;margin:16px 0;border-radius:4px;font-style:italic">${esc(message_preview || "")}</div>
                <p>Connectez-vous à ALANE pour répondre.</p>
                <p style="margin-top:24px;color:#888;font-size:12px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
              </div>`,
            }),
          });
          const eb = await er.json().catch(() => ({}));
          console.log("[chat_notify] email status:", er.status, JSON.stringify(eb));
        } catch (e) { console.error("[chat_notify] email error:", e.message); }
      } else {
        console.log("[chat_notify] email skipped — RESEND_KEY:", !!RESEND_KEY, "hasEmail:", !!recipientEmail);
      }

      // SMS Brevo
      const BREVO_KEY = process.env.BREVO_API_KEY;
      console.log("[chat_notify] SMS check - BREVO_KEY:", !!BREVO_KEY, "hasPhone:", !!phone);
      if (BREVO_KEY && phone) {
        const digits = phone.replace(/\D/g, "");
        const e164 = digits.startsWith("0") ? "33" + digits.slice(1) : digits.startsWith("33") ? digits : null;
        console.log("[chat_notify] sending SMS");
        if (e164) {
          try {
            const sr = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
              method: "POST",
              headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
              body: JSON.stringify({
                sender: "ALANE",
                recipient: e164,
                content: `ALANE - Nouveau message de ${sender_name || "votre contact"} : ${(message_preview || "").slice(0, 80)} — alane.fr`,
              }),
            });
            const sb = await sr.json().catch(() => ({}));
            console.log("[chat_notify] SMS brevo status:", sr.status, JSON.stringify(sb));
          } catch (e) { console.error("[chat_notify] SMS error:", e.message); }
        }
      } else {
        console.log("[chat_notify] SMS skipped — BREVO_KEY:", !!BREVO_KEY, "hasPhone:", !!phone);
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
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
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
      const { mission_id, reason } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      const mRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id,prestataire_id,status,stripe_payment_intent,montant_total,metier,sector,date,heure_debut`,
        { headers }
      );
      const mData = await mRes.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable" });
      if (mission.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (!["open", "assigned", "pending_acceptance"].includes(mission.status)) {
        return res.status(400).json({ error: "Cette mission ne peut plus être annulée" });
      }

      // Calculer la pénalité côté serveur selon la politique d'annulation
      let penalty = 0;
      if (mission.stripe_payment_intent && mission.date) {
        const [h, mn] = (mission.heure_debut || "08:00").split(":").map(Number);
        const missionStart = new Date(`${mission.date}T${String(h).padStart(2,"0")}:${String(mn||0).padStart(2,"0")}:00`);
        const missionStartUTC = new Date(missionStart.getTime() - 3600000);
        const hoursUntilMission = (missionStartUTC - new Date()) / 3600000;
        if (hoursUntilMission < 24) penalty = 100;
        else if (hoursUntilMission < 48) penalty = 50;
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
        body: JSON.stringify({ status: "cancelled", cancellation_reason: reason || null, cancellation_penalty: penalty }),
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
                <p style="margin-top:16px;font-size:12px;color:#888">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
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

    if (action === "cancel_in_progress") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      const mRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id,prestataire_id,status,stripe_payment_intent,montant_total,metier,sector,date,heure_debut,hours,tarif_horaire`,
        { headers }
      );
      const mData = await mRes.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable" });
      if (mission.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "assigned") return res.status(400).json({ error: "La mission n'est pas en cours" });

      // Calcul du prorata arrondi à l'heure supérieure
      // Note: on ne vérifie pas côté serveur si la mission a démarré car
      // le serveur Vercel est en UTC et interprète heure_debut sans timezone —
      // le garde côté client (bouton caché si !isStarted) est suffisant.
      const missionStart = mission.date
        ? new Date(`${mission.date}T${mission.heure_debut || "00:00"}`)
        : null;
      const elapsedMs = Math.max(0, missionStart ? Date.now() - missionStart.getTime() : 0);
      const elapsedHours = elapsedMs / 3600000;
      const totalHours = Number(mission.hours) || 1;
      const roundedHours = Math.min(Math.ceil(elapsedHours * 10) / 10, totalHours);
      // Arrondi à l'heure entière supérieure (ex: 4h30 → 5h)
      const billedHours = Math.min(Math.ceil(elapsedHours), totalHours);
      const tarifHoraire = Number(mission.tarif_horaire) || 0;
      const proratedAmount = billedHours * tarifHoraire;

      // Mettre à jour la mission
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          status: "cancelled",
          montant_total: proratedAmount,
          cancellation_reason: `Interrompue en cours — prorata ${billedHours}h sur ${totalHours}h prévues`,
        }),
      });

      // Récupérer infos prestataire (email + téléphone)
      let prestaEmail = null;
      let prestaPhone = null;
      let prestaName = "";
      if (mission.prestataire_id) {
        try {
          const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${mission.prestataire_id}`, { headers });
          const uData = await uRes.json();
          prestaEmail = uData.email || null;
          prestaPhone = uData.user_metadata?.telephone || null;
          prestaName = [uData.user_metadata?.prenom, uData.user_metadata?.nom].filter(Boolean).join(" ") || "Prestataire";
        } catch {}
      }

      // Récupérer email client pour le ticket
      let clientEmail = null;
      try {
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${caller.id}`, { headers });
        const uData = await uRes.json();
        clientEmail = uData.email || null;
      } catch {}

      const missionLabel = mission.metier || mission.sector || "Mission";

      // Email au prestataire
      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      const RESEND_FROM    = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
      if (RESEND_API_KEY && prestaEmail) {
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: prestaEmail,
            subject: `💶 Mission interrompue — vous serez payé(e) pour ${billedHours}h`,
            html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
              <h2 style="color:#050E20">Mission interrompue par le client</h2>
              <p style="color:#444">Bonjour ${prestaName},</p>
              <p style="color:#444">Le client a mis fin à la mission <strong>${missionLabel}</strong> avant son terme prévu.</p>
              <div style="background:#fff;border-radius:10px;padding:16px;margin:20px 0;border-left:4px solid #7C6FE0">
                <table style="width:100%;font-size:14px;color:#333">
                  <tr><td style="padding:5px 0;color:#666">Durée prévue</td><td style="font-weight:700">${totalHours}h</td></tr>
                  <tr><td style="padding:5px 0;color:#666">Durée effectuée</td><td style="font-weight:700">${elapsedHours.toFixed(1).replace(".",",")}h</td></tr>
                  <tr><td style="padding:5px 0;color:#666">Heures facturées</td><td style="font-weight:700;color:#7C6FE0">${billedHours}h (arrondi heure supérieure)</td></tr>
                  <tr><td style="padding:5px 0;color:#666">Tarif horaire</td><td style="font-weight:700">${tarifHoraire.toFixed(2).replace(".",",")} € HT/h</td></tr>
                  <tr><td style="padding:5px 0;color:#666;border-top:1px solid #eee;padding-top:10px">Montant dû</td><td style="font-weight:800;color:#10D98F;font-size:17px;border-top:1px solid #eee;padding-top:10px">${proratedAmount.toFixed(2).replace(".",",")} € HT</td></tr>
                </table>
              </div>
              <p style="color:#444;font-size:13px">L'équipe ALANE traite votre règlement dans les meilleurs délais. Vous recevrez un virement sous 5 jours ouvrés.</p>
              <p style="color:#888;font-size:12px;margin-top:24px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
            </div>`,
          }),
        }).catch(() => {});
      }

      // SMS au prestataire via Twilio (optionnel — nécessite TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)
      const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID;
      const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
      const TWILIO_FROM  = process.env.TWILIO_FROM;
      if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM && prestaPhone) {
        const smsAuth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
        fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
          method: "POST",
          headers: { "Authorization": `Basic ${smsAuth}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            From: TWILIO_FROM,
            To: prestaPhone.startsWith("+") ? prestaPhone : `+33${prestaPhone.replace(/^0/, "")}`,
            Body: `ALANE — Mission "${missionLabel}" interrompue par le client après ${elapsedHours.toFixed(1).replace(".",",")}h. Vous serez réglé(e) pour ${billedHours}h = ${proratedAmount.toFixed(2).replace(".",",")} € HT. L'équipe ALANE vous contacte sous 24h.`,
          }).toString(),
        }).catch(() => {});
      }

      // Notification in-app au prestataire
      if (mission.prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: mission.prestataire_id,
            type: "mission",
            title: "Mission interrompue — paiement prorata 💶",
            body: `La mission "${missionLabel}" a été interrompue. Vous serez payé(e) pour ${billedHours}h (${proratedAmount.toFixed(2).replace(".",",")} € HT). L'équipe ALANE vous contacte sous 24h.`,
            read: false,
          }),
        }).catch(() => {});
      }

      // Ticket admin pour traiter le remboursement partiel
      if (mission.stripe_payment_intent) {
        await fetch(`${SUPABASE_URL}/rest/v1/support_tickets`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            subject: `[ARRÊT EN COURS] Mission ${mission_id.slice(0,8)} — paiement partiel ${billedHours}h / ${proratedAmount.toFixed(2)} € HT`,
            message: `Mission interrompue par le client en cours d'exécution.\n\nMission : ${missionLabel}\nPrestataire : ${prestaName} (${prestaEmail || mission.prestataire_id})\nClient : ${clientEmail || caller.id}\n\nDurée prévue : ${totalHours}h\nDurée effectuée : ${elapsedHours.toFixed(2)}h\nHeures facturées : ${billedHours}h (arrondi supérieur)\nMontant dû au prestataire : ${proratedAmount.toFixed(2)} € HT\nMontant initial : ${mission.montant_total || "—"} €\nPaymentIntent Stripe : ${mission.stripe_payment_intent}\n\nActions requises :\n1. Rembourser le client partiellement sur Stripe (montant initial - prorata prestataire - frais de service)\n2. Virer le prorata au prestataire`,
            user_email: clientEmail,
            user_id: caller.id,
            status: "open",
          }),
        }).catch(() => {});

        // Email admin
        const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
        if (RESEND_API_KEY && ADMIN_EMAIL) {
          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: RESEND_FROM,
              to: ADMIN_EMAIL,
              subject: `[ACTION REQUISE] Arrêt en cours — ${missionLabel} — ${billedHours}h / ${proratedAmount.toFixed(2)} € HT`,
              html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
                <h2 style="color:#050E20">⚠️ Mission interrompue en cours d'exécution</h2>
                <table style="width:100%;border-collapse:collapse;font-size:14px">
                  <tr><td style="padding:6px 0;color:#666">Mission</td><td style="font-weight:700">${missionLabel}</td></tr>
                  <tr><td style="padding:6px 0;color:#666">Prestataire</td><td style="font-weight:700">${prestaName} — ${prestaEmail||"—"}</td></tr>
                  <tr><td style="padding:6px 0;color:#666">Client</td><td>${clientEmail||caller.id}</td></tr>
                  <tr><td style="padding:6px 0;color:#666">Durée prévue</td><td>${totalHours}h</td></tr>
                  <tr><td style="padding:6px 0;color:#666">Durée effectuée</td><td>${elapsedHours.toFixed(2)}h</td></tr>
                  <tr><td style="padding:6px 0;color:#666">Heures facturées</td><td style="font-weight:700;color:#7C6FE0">${billedHours}h</td></tr>
                  <tr><td style="padding:6px 0;color:#666">Montant prestataire</td><td style="font-weight:700;color:#10D98F">${proratedAmount.toFixed(2)} € HT</td></tr>
                  <tr><td style="padding:6px 0;color:#666">PaymentIntent</td><td style="font-size:12px">${mission.stripe_payment_intent}</td></tr>
                </table>
                <p style="margin-top:16px;font-size:13px;color:#666">
                  Actions :<br>
                  1. Rembourser le client partiellement sur <a href="https://dashboard.stripe.com/payments/${mission.stripe_payment_intent}" style="color:#7C6FE0">Stripe</a><br>
                  2. Virer ${proratedAmount.toFixed(2)} € HT au prestataire
                </p>
                <p style="margin-top:16px;font-size:12px;color:#888">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
              </div>`,
            }),
          }).catch(() => {});
        }
      }

      return res.status(200).json({ success: true, billedHours, proratedAmount });
    }

    if (action === "my_missions") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const [r1, r2] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${caller.id}&status=eq.pending_acceptance&select=id,sector,metier,date,heure_debut,hours,tarif_horaire,acceptance_deadline,client_id,titre,ville,adresse,description&order=created_at.desc`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${caller.id}&status=eq.assigned&select=id,sector,metier,date,heure_debut,hours,tarif_horaire,client_id,titre,ville,adresse,description,validation_prestataire,status&order=created_at.desc`, { headers }),
      ]);
      const [pending, assigned] = await Promise.all([r1.json(), r2.json()]);
      const pendingList = Array.isArray(pending) ? pending : [];
      const nowIso = new Date().toISOString();
      const expired = pendingList.filter(m => m.acceptance_deadline && m.acceptance_deadline < nowIso);
      const stillPending = pendingList.filter(m => !m.acceptance_deadline || m.acceptance_deadline >= nowIso);
      if (expired.length > 0) {
        await Promise.all(expired.map(async m => {
          await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
            method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({ status: "open", prestataire_id: null }),
          });
          // Notifier le client que le prestataire n'a pas répondu dans les temps
          if (m.client_id) {
            await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
              method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify({
                user_id: m.client_id, type: "mission",
                title: "Prestataire non disponible ⏱️",
                body: `Le prestataire n'a pas répondu à temps pour la mission "${m.metier || m.titre || ""}". Elle est de nouveau disponible.`,
                read: false,
              }),
            }).catch(() => {});
          }
        }));
      }
      return res.status(200).json({
        pending:  stillPending,
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

      const patchBody = response === "accept"
        ? { status: "assigned" }
        : { status: "open", prestataire_id: null };
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify(patchBody),
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
                <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
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
                  ? `ALANE - ${presta_name || "Votre prestataire"} a accepté votre mission ${missionLabel}. Connectez-vous pour suivre. — alane.fr`
                  : `ALANE - ${presta_name || "Le prestataire"} a refusé votre mission ${missionLabel}. Connectez-vous pour choisir un autre prestataire. — alane.fr`,
              }),
            }).catch(() => {});
          }
        }

        // Web push client
        const psRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${mission.client_id}&select=endpoint,p256dh,auth`, { headers });
        const psSubs = await psRes.json().catch(() => []);
        if (Array.isArray(psSubs) && psSubs.length > 0) {
          const pushTitle = isAccepted ? "Mission acceptée ✅" : "Mission refusée";
          const pushBody  = isAccepted
            ? `${presta_name || "Votre prestataire"} a accepté votre demande de mission.`
            : `${presta_name || "Le prestataire"} a refusé. Connectez-vous pour choisir un autre prestataire.`;
          await Promise.all(psSubs.map(s => sendWebPush(s, { title: pushTitle, body: pushBody, url: "/" })));
        }
      }

      return res.status(200).json({ success: true });
    }

    if (action === "notify_client") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { client_id, type, mission_label, presta_name } = payload;
      if (!client_id || !isUuid(client_id)) return res.status(400).json({ error: "client_id requis" });

      // Vérifier que le caller est bien le prestataire d'une mission de ce client
      const relRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${caller.id}&client_id=eq.${client_id}&status=in.(pending_acceptance,assigned)&select=id&limit=1`,
        { headers }
      );
      const relData = await relRes.json();
      if (!Array.isArray(relData) || !relData[0]) return res.status(403).json({ error: "Non autorisé" });

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
        ? `ALANE - ${presta_name || "Votre prestataire"} a accepté votre mission ${mission_label || ""}. Connectez-vous pour suivre la mission. — alane.fr`
        : `ALANE - ${presta_name || "Le prestataire"} a refusé votre mission ${mission_label || ""}. Connectez-vous pour choisir un autre prestataire. — alane.fr`;

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
              <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
            </div>`,
          }),
        }).catch(() => {});
      } else {
        console.log("[notify_client] email skipped — RESEND_KEY:", !!RESEND_KEY, "hasEmail:", !!clientEmail);
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
        console.log("[notify_client] SMS skipped — BREVO_KEY:", !!BREVO_KEY, "hasPhone:", !!phone);
      }

      return res.status(200).json({ success: true });
    }

    if (action === "notify_prestataire") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { prestataire_id, mission_label, date, ville, hours } = payload;
      if (!prestataire_id || !isUuid(prestataire_id)) return res.status(400).json({ error: "prestataire_id requis" });
      // Verify caller has a mission with this prestataire
      const mCheckRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?client_id=eq.${caller.id}&prestataire_id=eq.${prestataire_id}&status=in.(pending_acceptance,assigned)&select=id&limit=1`, { headers });
      const mCheck = await mCheckRes.json().catch(() => []);
      if (!Array.isArray(mCheck) || mCheck.length === 0) return res.status(403).json({ error: "Non autorisé" });

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
              <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
            </div>`,
          }),
        }).catch(() => {});
      } else {
        console.log("[notify_prestataire] email skipped — RESEND_KEY:", !!RESEND_KEY, "hasEmail:", !!prestaEmail);
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
              content: `ALANE - Demande de mission : ${mission_label || "Mission"} le ${date || "?"} à ${ville || "?"} (${hours || "?"}h). Connectez-vous pour répondre ! — alane.fr`,
            }),
          }).then(r => r.json()).then(d => console.log("[notify_prestataire] SMS:", JSON.stringify(d))).catch(e => console.log("[notify_prestataire] SMS error:", e.message));
        }
      } else {
        console.log("[notify_prestataire] SMS skipped — BREVO_KEY:", !!BREVO_KEY, "hasPhone:", !!phone);
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
