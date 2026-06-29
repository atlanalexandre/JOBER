// DST-aware UTC offset for France (CEST = -7200000ms, CET = -3600000ms)
function frenchOffsetMs(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const marchEnd = new Date(Date.UTC(y,2,31)); marchEnd.setUTCDate(31-marchEnd.getUTCDay()); marchEnd.setUTCHours(1,0,0,0);
  const octEnd   = new Date(Date.UTC(y,9,31)); octEnd.setUTCDate(31-octEnd.getUTCDay());   octEnd.setUTCHours(1,0,0,0);
  return (d >= marchEnd && d < octEnd) ? -7200000 : -3600000;
}

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
    return r.status;
  } catch(e) {
    console.error("[sendWebPush] error:", e.message);
    return null;
  }
}

// HTML escaping — prevents XSS in email templates
const esc = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

// SMS sanitization — strip CRLF to prevent header injection + cap length
const smsClean = (s, max = 160) => String(s||"").replace(/[\r\n\t]/g," ").trim().slice(0, max);

// Rate limiting en mémoire — 120 req/min par IP (reset Vercel cold start accepté)
const _rl = new Map();
function checkRateLimit(ip, max = 120, windowMs = 60_000) {
  const now = Date.now();
  const rec = _rl.get(ip) || { count: 0, reset: now + windowMs };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + windowMs; }
  rec.count++;
  _rl.set(ip, rec);
  return rec.count > max;
}

async function sendPushToUser(userId, notification, supabaseUrl, serviceHeaders) {
  try {
    const psRes = await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${userId}&select=endpoint,p256dh,auth`, { headers: serviceHeaders });
    const subs = await psRes.json().catch(() => []);
    if (!Array.isArray(subs) || subs.length === 0) return;
    await Promise.all(subs.map(async (s) => {
      const status = await sendWebPush(s, notification);
      if (status === 410) {
        await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${userId}&endpoint=eq.${encodeURIComponent(s.endpoint)}`, {
          method: "DELETE",
          headers: serviceHeaders,
        }).catch(() => {});
      }
    }));
  } catch(e) {
    console.error("[sendPushToUser] error:", e.message);
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

// ── Email one-click action (GET) ────────────────────────────────────────────
const APP_URL_DEFAULT = process.env.APP_URL || "https://www.alane.fr";

function emailActionHtml(title, message, color, icon) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title} — ALANE</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0A1628;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.card{background:#162547;border-radius:20px;padding:40px 32px;max-width:420px;width:100%;text-align:center;border:1px solid rgba(255,255,255,0.08)}.icon{font-size:52px;margin-bottom:20px}h1{font-size:22px;font-weight:700;color:${color};margin-bottom:12px}p{color:rgba(255,255,255,0.7);font-size:15px;line-height:1.5;margin-bottom:24px}a{display:inline-block;background:${color};color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:700;font-size:15px}</style></head><body><div class="card"><div class="icon">${icon}</div><h1>${title}</h1><p>${message}</p><a href="${APP_URL_DEFAULT}">Ouvrir l'application</a></div></body></html>`;
}

async function handleEmailAction(req, res) {
  const { action, m: missionId, p: prestaId, exp, sig } = req.query || {};
  const SECRET = process.env.BO_SESSION_SECRET;
  if (!SECRET) return res.status(500).send(emailActionHtml("Erreur serveur", "Configuration manquante.", "#F25E5E", "⚠️"));

  const isUuidQ = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
  if (!action || !missionId || !prestaId || !exp || !sig) return res.status(400).send(emailActionHtml("Lien invalide", "Ce lien est incomplet ou corrompu.", "#F25E5E", "❌"));
  if (!["accept","refuse"].includes(action) || !isUuidQ(missionId) || !isUuidQ(prestaId)) return res.status(400).send(emailActionHtml("Lien invalide", "Paramètres incorrects.", "#F25E5E", "❌"));

  let sigOk = false;
  try {
    const { createHmac, timingSafeEqual } = await import("crypto");
    const payload2 = `${action}.${missionId}.${prestaId}.${exp}`;
    const expected = createHmac("sha256", SECRET).update(payload2).digest("base64url");
    sigOk = timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {}
  if (!sigOk) return res.status(401).send(emailActionHtml("Lien invalide", "Ce lien est invalide ou a été modifié.", "#F25E5E", "🔒"));
  if (Math.floor(Date.now() / 1000) > parseInt(exp, 10)) return res.status(410).send(emailActionHtml("Lien expiré", "Ce lien n'est plus valide (validité 24h). Connectez-vous à l'application pour répondre.", "#F5A623", "⏱"));

  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).send(emailActionHtml("Erreur serveur", "Configuration base de données manquante.", "#F25E5E", "⚠️"));
  const hdrs = { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };

  const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}&prestataire_id=eq.${prestaId}&status=eq.pending_acceptance&select=id,client_id,metier,titre,acceptance_deadline`, { headers: hdrs });
  const mission = (await mr.json().catch(() => []))[0];
  if (!mission) return res.status(409).send(emailActionHtml("Déjà traité", "Cette mission a déjà été acceptée, refusée ou annulée.", "#A29BFE", "ℹ️"));

  // Vérification serveur du délai d'acceptation
  if (mission.acceptance_deadline && mission.acceptance_deadline < new Date().toISOString()) {
    await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}`, {
      method: "PATCH",
      headers: { ...hdrs, "Prefer": "return=minimal" },
      body: JSON.stringify({ status: "open", prestataire_id: null }),
    }).catch(() => {});
    return res.status(410).send(emailActionHtml("Délai dépassé", "Le délai de réponse est dépassé. La mission est de nouveau disponible pour d'autres prestataires.", "#F5A623", "⏱"));
  }

  const missionLabel = mission.titre || mission.metier || "la mission";
  const patchBody = action === "accept" ? { status: "assigned" } : { status: "open", prestataire_id: null };
  await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}`, { method: "PATCH", headers: { ...hdrs, "Prefer": "return=minimal" }, body: JSON.stringify(patchBody) });

  if (mission.client_id) {
    const isAccepted = action === "accept";
    await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method: "POST", headers: { ...hdrs, "Prefer": "return=minimal" }, body: JSON.stringify({ user_id: mission.client_id, type: "mission", title: isAccepted ? "Mission acceptée ! 🎉" : "Mission refusée", body: isAccepted ? `Votre prestataire a accepté la mission "${missionLabel}" depuis son email.` : `Le prestataire a décliné "${missionLabel}". Vous pouvez choisir un autre prestataire.`, read: false, ref_id: missionId }) }).catch(() => {});
    await sendPushToUser(mission.client_id, { title: isAccepted ? "Mission acceptée ✅" : "Mission refusée", body: isAccepted ? `Votre prestataire a accepté "${missionLabel}".` : `Le prestataire a décliné "${missionLabel}".`, url: "/" }, SUPABASE_URL, hdrs).catch(() => {});
  }

  return res.status(200).send(emailActionHtml(
    action === "accept" ? "Mission acceptée !" : "Mission refusée",
    action === "accept" ? `Vous avez accepté la mission <strong style="color:#fff">${esc(missionLabel)}</strong>. Le client a été notifié.` : `Vous avez décliné la mission <strong style="color:#fff">${esc(missionLabel)}</strong>.`,
    action === "accept" ? "#10D98F" : "#A29BFE",
    action === "accept" ? "✅" : "👋"
  ));
}

export default async function handler(req, res) {
  // GET → one-click email action (accept/refuse mission from email link)
  if (req.method === "GET") return handleEmailAction(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Rate limiting — 120 req/min par IP
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (checkRateLimit(ip)) return res.status(429).json({ error: "Trop de requêtes — réessayez dans une minute" });

  const { action, ...payload } = req.body || {};

  // Validation globale
  if (!action || typeof action !== "string" || action.length > 50) {
    return res.status(400).json({ error: "Action invalide" });
  }
  const isUuid = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

  // Validation des longueurs des champs texte libres (prévient abus + DoS email)
  const TEXT_MAX = { message: 2000, mission_label: 200, ville: 100, adresse: 300, description: 3000, sender_name: 100, message_preview: 500 };
  for (const [key, max] of Object.entries(TEXT_MAX)) {
    if (payload[key] != null && typeof payload[key] === "string" && payload[key].length > max) {
      return res.status(400).json({ error: `Champ '${key}' trop long (max ${max} caractères)` });
    }
  }

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
      const { sector, metier, limit: rawLimit, offset: rawOffset } = payload;
      const pageLimit  = Math.min(Math.max(1, parseInt(rawLimit,  10) || 50), 100);
      const pageOffset = Math.max(0, parseInt(rawOffset, 10) || 0);
      let url = `${SUPABASE_URL}/rest/v1/missions?status=in.(open,needs_replacement)&order=created_at.desc&limit=${pageLimit}&offset=${pageOffset}`;
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

      // T-01: batch mission lookup — one query instead of N
      const missionIds = [...new Set(candidatures.map(c => c.mission_id).filter(Boolean).filter(isUuid))];
      const missionsMap = {};
      if (missionIds.length > 0) {
        const mr = await fetch(
          `${SUPABASE_URL}/rest/v1/missions?id=in.(${missionIds.join(",")})&select=id,sector,metier,date,hours,ville,status,tarif_horaire`,
          { headers }
        );
        const missions = await mr.json();
        if (Array.isArray(missions)) {
          for (const m of missions) missionsMap[m.id] = m;
        }
      }
      const enriched = candidatures.map(c => ({ ...c, mission: missionsMap[c.mission_id] || null }));
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
              fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${verified_prestataire_id}&select=missions_completed_month,trial_exhausted,plan_abonnement`, { headers }),
            ]);
            const urData = await urRes.json();
            const prData = await prRes.json();
            const prDataProfile = Array.isArray(prData) && prData[0];
            // profiles.plan_abonnement prioritaire — écrit en premier par le webhook Stripe
            let plan = prDataProfile?.plan_abonnement || urData.user_metadata?.plan_abonnement || "free";
            const endDate = urData.user_metadata?.subscription_end_date;
            const endDateMs = endDate ? new Date(endDate).getTime() : NaN;
            if (!isNaN(endDateMs) && plan !== "free" && endDateMs < Date.now()) {
              plan = "free";
              await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${verified_prestataire_id}`, { method:"PUT", headers, body: JSON.stringify({ user_metadata: { plan_abonnement:"free", subscription_end_date:null } }) }).catch(()=>{});
              await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${verified_prestataire_id}`, { method:"PATCH", headers:{ ...headers, "Prefer":"return=minimal" }, body: JSON.stringify({ plan_abonnement:"free" }) }).catch(()=>{});
            }

            const trialExhausted = Array.isArray(prData) && prData[0]?.trial_exhausted === true;
            const basePlanLimit = PLAN_LIMITS[plan] ?? 2;
            const limit = (trialExhausted && plan === "free") ? 0 : basePlanLimit;
            if (limit < 999) {
              // RPC atomique : FOR UPDATE sur la ligne profile pour éviter la race condition
              const slotRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_prestataire_slot`, {
                method: "POST", headers,
                body: JSON.stringify({ p_prestataire_id: verified_prestataire_id, p_limit: limit }),
              });
              const slots = slotRes.ok ? (await slotRes.json().catch(() => 0)) : 0;
              if (slots <= 0) return { error: `Limite atteinte — le prestataire a atteint sa limite de ${limit} mission${limit > 1 ? "s" : ""}/mois pour son plan ${plan}.`, limit_reached: true };
            }
            return null;
          } catch { return { error: "Erreur vérification limite plan", limit_reached: false }; }
        })();
        if (limitOk) return res.status(403).json(limitOk);
      }

      // Vérifier si la mission a déjà un paiement Stripe — inclure status pour éviter double PaymentIntent
      // B-07: on utilise mission.tarif_horaire (fixé à la création) et non tarif_net du prestataire
      const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
      const mCheckRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=stripe_payment_intent,hours,tarif_horaire,client_id,status`, { headers });
      const mCheckData = await mCheckRes.json();
      const missionCheck = Array.isArray(mCheckData) && mCheckData[0];
      if (missionCheck && missionCheck.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      // Refus si déjà assignée : évite la création de double PaymentIntent en cas de requêtes concurrentes
      if (missionCheck && ["assigned","completed","closed","cancelled"].includes(missionCheck.status)) {
        return res.status(409).json({ error: "La mission a déjà été assignée ou fermée" });
      }

      if (missionCheck && !missionCheck.stripe_payment_intent && STRIPE_SECRET_KEY) {
        // P-01: tarif_horaire = 0 → refuser la création du PaymentIntent
        const missionTarif = Number(missionCheck.tarif_horaire) || 0;
        if (missionTarif <= 0) return res.status(400).json({ error: "Tarif horaire non défini sur cette mission — impossible de créer le paiement" });
        try {
          const hours = missionCheck.hours || 1;
          const amountCents = Math.max(50, Math.round(missionTarif * hours * 100));
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
        } catch (stripeErr) {
          console.error("[accept] Stripe PaymentIntent creation failed:", stripeErr.message);
          return res.status(500).json({ error: "Impossible de créer le paiement Stripe — réessayez" });
        }
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
      const missionPatchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=not.in.(assigned,completed,closed,cancelled)`,
        {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=representation", "Content-Type": "application/json" },
          body: JSON.stringify(missionPatch),
        }
      );
      const missionPatchData = await missionPatchRes.json().catch(() => []);
      if (!Array.isArray(missionPatchData) || missionPatchData.length === 0) {
        return res.status(409).json({ error: "La mission a déjà été assignée ou fermée" });
      }

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
        await sendPushToUser(verified_prestataire_id, { title: "Candidature acceptée ✅", body: "Votre candidature a été acceptée ! Préparez-vous pour la mission.", url: "/" }, SUPABASE_URL, headers).catch(() => {});
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
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=hours,tarif_horaire,status,prestataire_id,metier,sector,client_id,validation_prestataire,recurrence,date,ville,adresse,description,heure_debut,actual_hours,arrival_delay_minutes,delay_status`, { headers });
      const missions = await mr.json();
      const mission = Array.isArray(missions) && missions[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable" });
      if (mission.client_id !== client_id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "assigned") return res.status(400).json({ error: "Mission non assignée" });
      if (!mission.validation_prestataire) return res.status(400).json({ error: "Le prestataire n'a pas encore confirmé la fin de mission" });

      const hours        = mission.actual_hours ?? mission.hours ?? 0;
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
      let rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_cashback`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({ p_user_id: client_id, p_delta: cashbackEarned, p_missions: 1 }),
      });
      // Retry une fois si échec réseau (503/504)
      if (!rpcRes.ok && [503, 504].includes(rpcRes.status)) {
        await new Promise(r => setTimeout(r, 800));
        rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_cashback`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=representation" },
          body: JSON.stringify({ p_user_id: client_id, p_delta: cashbackEarned, p_missions: 1 }),
        }).catch(() => ({ ok: false, status: 0 }));
      }
      const rpcData = rpcRes.ok ? await rpcRes.json().catch(() => null) : null;
      let atomicBalance = newBalance;
      if (!rpcRes.ok) {
        console.error("[complete] increment_cashback RPC failed, fallback direct PATCH:", rpcRes.status, "mission_id:", mission_id);
        // Fallback : mise à jour directe avec service role key
        await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${client_id}`, {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ cashback_balance: newBalance, missions_completed_month: missionsThisMonth }),
        }).catch(e => console.error("[complete] fallback cashback PATCH failed:", e.message));
      } else {
        atomicBalance = Array.isArray(rpcData) && rpcData[0]?.cashback_balance != null
          ? rpcData[0].cashback_balance
          : newBalance;
      }

      // Notification mission validée — toujours envoyée, même si RPC cashback a échoué
      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          user_id: client_id,
          type: "mission",
          title: "Mission validée ✅",
          body: cashbackEarned > 0 && rpcRes.ok
            ? `Votre mission a été validée. Cashback : +${cashbackEarned.toFixed(2)} € (solde : ${atomicBalance.toFixed ? atomicBalance.toFixed(2) : atomicBalance} €)`
            : "Votre mission a été validée avec succès.",
          read: false,
        }),
      }).catch(() => {});

      // Notification cashback dédiée uniquement si RPC a réussi
      if (cashbackEarned > 0 && rpcRes.ok) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: client_id,
            type: "cashback",
            title: "Cashback crédité 💰",
            body: `+${cashbackEarned.toFixed(2)} € crédités sur votre wallet. Solde : ${atomicBalance.toFixed ? atomicBalance.toFixed(2) : atomicBalance} €`,
            read: false,
          }),
        }).catch(() => {});
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
                    <p>Le client a validé votre mission <strong>${esc(mission.metier || mission.sector || "")}</strong>.</p>
                    <p>Votre paiement de <strong style="color:#A29BFE">${montantTotal.toFixed(2)} €</strong> a été initié automatiquement et sera versé sur votre IBAN sous 1 à 2 jours ouvrés.</p>
                    <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
                  </div>`,
                }),
              }).catch(() => {});
            }
          } catch {}
        }
      }

      // Virement automatique Stripe Connect
      const STRIPE_SK_PAYOUT = process.env.STRIPE_SECRET_KEY;
      const COMMISSION = parseFloat(process.env.PLATFORM_COMMISSION_RATE || "0");
      if (STRIPE_SK_PAYOUT && montantTotal > 0 && mission.prestataire_id) {
        try {
          const ppRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${mission.prestataire_id}&select=stripe_account_id,stripe_account_status`, { headers });
          const ppData = await ppRes.json();
          const pp = Array.isArray(ppData) && ppData[0];
          if (pp?.stripe_account_id && pp.stripe_account_status === "enabled") {
            const netCents = Math.round(montantTotal * (1 - COMMISSION) * 100);
            if (netCents >= 100) {
              const tParams = new URLSearchParams({
                amount: String(netCents), currency: "eur", destination: pp.stripe_account_id,
                "metadata[mission_id]": mission_id, "metadata[prestataire_id]": mission.prestataire_id,
              });
              const tRes = await fetch("https://api.stripe.com/v1/transfers", {
                method: "POST",
                headers: { "Authorization": `Bearer ${STRIPE_SK_PAYOUT}`, "Content-Type": "application/x-www-form-urlencoded" },
                body: tParams.toString(),
              });
              if (tRes.ok) {
                const tData = await tRes.json();
                await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
                  method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({ payout_status: "transferred", stripe_transfer_id: tData.id }),
                }).catch(() => {});
                console.log(`[complete] Transfer ${tData.id} → ${pp.stripe_account_id} (${(netCents/100).toFixed(2)}€)`);
              } else {
                const eData = await tRes.json().catch(() => ({}));
                console.error("[complete] Transfer failed:", eData?.error?.message);
                await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
                  method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({ payout_status: "failed" }),
                }).catch(() => {});
              }
            }
          } else if (pp?.stripe_account_id) {
            await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
              method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify({ payout_status: "pending" }),
            }).catch(() => {});
            console.log(`[complete] Payout pending — Connect not yet enabled for ${mission.prestataire_id}`);
          }
        } catch (pe) { console.error("[complete] Payout error:", pe.message); }
      }

      // Incrémenter missions_completed_month du prestataire + auto-marquer trial_exhausted si limite atteinte
      if (mission.prestataire_id) {
        try {
          // Récupérer le compteur actuel du prestataire et son plan
          const [prMonthRes, prPlanRes] = await Promise.all([
            fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${mission.prestataire_id}&select=missions_completed_month,trial_exhausted,plan_abonnement`, { headers }),
            fetch(`${SUPABASE_URL}/auth/v1/admin/users/${mission.prestataire_id}`, { headers }),
          ]);
          const prMonthData = await prMonthRes.json();
          const prPlan = await prPlanRes.json();
          const prProfile = Array.isArray(prMonthData) && prMonthData[0];
          if (prProfile && !prProfile.trial_exhausted) {
            const newCount = (prProfile.missions_completed_month || 0) + 1;
            // profiles.plan_abonnement a priorité sur user_metadata (écrit en premier par le webhook Stripe)
            const plan = prProfile?.plan_abonnement || prPlan?.user_metadata?.plan_abonnement || "free";

            // Récupérer la limite du plan depuis platform_settings
            let PLAN_LIMITS_C = { free: 2, premium: 10, elite: 999 };
            try {
              const plRes = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings?key=eq.plan_limits&select=value`, { headers });
              const plData = await plRes.json();
              if (Array.isArray(plData) && plData[0]?.value) PLAN_LIMITS_C = plData[0].value;
            } catch {}
            const planLimit = PLAN_LIMITS_C[plan] ?? 2;

            const patchBody = { missions_completed_month: newCount };
            // Si le prestataire est en plan free et vient d'atteindre sa limite → marquer trial_exhausted
            if (plan === "free" && newCount >= planLimit) {
              patchBody.trial_exhausted = true;
              console.log(`[complete] Prestataire ${mission.prestataire_id} a atteint sa limite free (${newCount}/${planLimit}) — trial_exhausted=true`);
            }
            await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${mission.prestataire_id}`, {
              method: "PATCH",
              headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify(patchBody),
            }).catch(e => console.error("[complete] prestataire missions_completed_month update error:", e.message));
          }
        } catch (e) {
          console.error("[complete] prestataire slot tracking error:", e.message);
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
        // heure_debut is stored as French local time (e.g. "14:00" = 14h CEST).
        // Vercel runs in UTC, so new Date("...T14:00:00") parses as 14:00 UTC (naive, 2h too late).
        // frenchOffsetMs returns the NEGATIVE UTC offset: -7200000 in summer, -3600000 in winter.
        // To convert French local → UTC: UTC = naive + frenchOffsetMs (adds a negative = subtracts).
        const missionStartNaive = new Date(`${mission.date}T${String(h).padStart(2,"0")}:${String(mn||0).padStart(2,"0")}:00`);
        const missionStartUTC = new Date(missionStartNaive.getTime() + frenchOffsetMs(missionStartNaive));
        const missionEndUTC = new Date(missionStartUTC.getTime() + Math.ceil(mission.hours || 1) * 3600000 - 15 * 60000);
        if (missionEndUTC > new Date()) return res.status(400).json({ error: "Vous ne pouvez pas confirmer une mission qui n'est pas encore terminée" });
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

      // Send email to client (awaited — Vercel kills fire-and-forget before it completes)
      try {
        const clientUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${mission.client_id}`, { headers });
        const clientUser = await clientUserRes.json();
        const clientEmail = clientUser?.email;
        const clientName = clientUser?.user_metadata?.prenom || clientUser?.user_metadata?.nom || "";
        const metier = esc(mission.metier || mission.sector || "Mission");
        const missionDate = esc(mission.date || "");
        const ville = esc(mission.ville || "");
        const appUrl = process.env.APP_URL || "https://www.alane.fr";
        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        if (clientEmail && RESEND_API_KEY) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_API_KEY}` },
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
          }).catch(() => {});
        }
      } catch {}

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
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,prestataire_id,client_id,sector,metier,date,heure_debut,hours,ville,stripe_payment_intent`,
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

      // Consommer un slot mensuel si annulation moins de 2h avant la mission
      try {
        const missionStartNaive = mission.date
          ? new Date(`${mission.date}T${mission.heure_debut || "00:00"}:00`)
          : null;
        const missionStartUTC = missionStartNaive
          ? new Date(missionStartNaive.getTime() + frenchOffsetMs(missionStartNaive))
          : null;
        const hoursUntilMission = missionStartUTC ? (missionStartUTC - new Date()) / 3600000 : 999;
        if (hoursUntilMission < 2) {
          const prRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=missions_completed_month,trial_exhausted,plan_abonnement`, { headers });
          const prData = await prRes.json();
          const prProfile = Array.isArray(prData) && prData[0];
          const cancelPlan = prProfile?.plan_abonnement || "free";
          const current = prProfile ? (prProfile.missions_completed_month || 0) : 0;
          const newCount = current + 1;
          const planLimit = 2; // missions gratuites par mois
          const patchBody = { missions_completed_month: newCount };
          // Ne jamais marquer trial_exhausted pour un prestataire sur plan payant
          if (newCount >= planLimit && cancelPlan === "free") patchBody.trial_exhausted = true;
          await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}`, {
            method: "PATCH",
            headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify(patchBody),
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
        for (let i = 0; i < prData.length; i += 20) chunks.push(prData.slice(i, i + 20));
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

      // Fetch mission details (S-06: inclure broadcast_sent_at pour limiter la fréquence)
      const mr = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=sector,metier,date,hours,ville,broadcast_sent_at`,
        { headers }
      );
      const missions = await mr.json();
      const mission = Array.isArray(missions) && missions[0];

      // S-06: prevent duplicate broadcasts within 1 hour
      if (mission?.broadcast_sent_at) {
        const lastBroadcastMs = new Date(mission.broadcast_sent_at).getTime();
        if (!isNaN(lastBroadcastMs) && Date.now() - lastBroadcastMs < 60 * 60 * 1000) {
          return res.status(429).json({ error: "Broadcast déjà envoyé il y a moins d'une heure" });
        }
      }
      console.log("[broadcast] mission found:", !!mission);

      // Fetch all approved prestataires
      const pr = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&select=id`,
        { headers }
      );
      const profiles = await pr.json();
      console.log("[broadcast] approved prestataires count:", Array.isArray(profiles) ? profiles.length : profiles);

      // Fetch all auth users avec pagination (évite OOM sur 10k+ users)
      const userMetaMap = {};
      let broadcastPage = 1;
      while (true) {
        const batchRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000&page=${broadcastPage}`, { headers });
        const batchData = await batchRes.json().catch(() => ({}));
        const batch = batchData.users || [];
        for (const u of batch) userMetaMap[u.id] = u;
        if (batch.length < 1000) break;
        broadcastPage++;
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
        for (let i = 0; i < profiles.length; i += 20) chunks.push(profiles.slice(i, i + 20));
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
                await fetch("https://api.resend.com/emails", {
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
                        <strong>${esc(missionLabel)}</strong><br/>
                        📅 ${esc(mission?.date || "Date à confirmer")}<br/>
                        📍 ${esc(mission?.ville || "Ville à confirmer")}<br/>
                        ⏱ ${esc(String(mission?.hours || "?"))}h
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
                  const smsText = smsClean(`ALANE - Nouvelle mission : ${mission?.metier || sector || "Mission"} le ${mission?.date || "?"} a ${mission?.ville || "?"} (${mission?.hours || "?"}h). Connectez-vous pour postuler. — alane.fr`);
                  console.log("[broadcast] sending SMS");
                  await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
                    method: "POST",
                    headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
                    body: JSON.stringify({ sender: "ALANE", recipient: e164, content: smsText }),
                  }).then(r => r.json()).then(d => console.log("[broadcast] SMS response:", JSON.stringify(d))).catch(e => console.log("[broadcast] SMS error:", e.message));
                }
              }

              // Web push
              const subs = subsByUser[p.id];
              if (subs?.length) {
                await Promise.all(subs.map(async s => {
                  const status = await sendWebPush(s, { title: pushTitle, body: pushBody, url: "/" });
                  if (status === 410) {
                    await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${p.id}&endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE", headers }).catch(() => {});
                  }
                }));
              }

              notified++;
            } catch {}
          }));
        }
      }
      // S-06: stamp broadcast_sent_at to prevent duplicate sends within 1h
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ broadcast_sent_at: new Date().toISOString() }),
      }).catch(() => {});

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
        // Valider que l'endpoint est un HTTPS URL (évite injection via endpoint)
        try {
          const epUrl = new URL(subscription.endpoint);
          if (epUrl.protocol !== "https:") return res.status(400).json({ error: "Endpoint invalide — HTTPS requis" });
        } catch { return res.status(400).json({ error: "Endpoint invalide" }); }
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

      // S-04: verify caller shares an active mission with recipient
      const sharedMissionRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?or=(and(client_id.eq.${caller.id},prestataire_id.eq.${recipient_id}),and(client_id.eq.${recipient_id},prestataire_id.eq.${caller.id}))&status=in.(open,pending_acceptance,assigned)&select=id&limit=1`,
        { headers }
      );
      const sharedMissions = await sharedMissionRes.json().catch(() => []);
      if (!Array.isArray(sharedMissions) || sharedMissions.length === 0) {
        return res.status(403).json({ error: "Non autorisé — aucune mission partagée active" });
      }

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
                content: smsClean(`ALANE - Nouveau message de ${sender_name || "votre contact"} : ${(message_preview || "").slice(0, 80)} — alane.fr`),
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
      const latN = Number(lat); const lngN = Number(lng);
      if (isNaN(latN) || isNaN(lngN) || latN < -90 || latN > 90 || lngN < -180 || lngN > 180) {
        return res.status(400).json({ error: "Coordonnées GPS invalides" });
      }
      const prestataire_id = caller.id;

      // Check if this is the first position update (to send "en route" push)
      const existingRes = await fetch(
        `${SUPABASE_URL}/rest/v1/tracking_positions?mission_id=eq.${mission_id}&prestataire_id=eq.${prestataire_id}&select=id&limit=1`,
        { headers }
      );
      const existing = await existingRes.json().catch(() => []);
      const isFirstUpdate = !Array.isArray(existing) || existing.length === 0;

      // Upsert position (use mission_id as unique key per prestataire)
      await fetch(`${SUPABASE_URL}/rest/v1/tracking_positions?on_conflict=mission_id,prestataire_id`, {
        method: "POST",
        headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ mission_id, prestataire_id, lat, lng, updated_at: new Date().toISOString() }),
      });

      // On first activation, push "en route" to client
      if (isFirstUpdate) {
        try {
          const mRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id,metier,ville&limit=1`, { headers });
          const mRows = await mRes.json().catch(() => []);
          const mission = Array.isArray(mRows) && mRows[0];
          if (mission?.client_id) {
            const notif = { title: "📍 Prestataire en route", body: `Votre prestataire est en route${mission.ville ? ` vers ${mission.ville}` : ""} et partage sa position en direct.`, url: "/mission_history" };
            await sendPushToUser(mission.client_id, notif, SUPABASE_URL, headers);
          }
        } catch (e) { console.error("[update_position] push error:", e.message); }
      }

      return res.status(200).json({ success: true });
    }


    if (action === "get_position") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      // S-05: verify caller is the client or prestataire of this mission
      const authMissionRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&or=(client_id.eq.${caller.id},prestataire_id.eq.${caller.id})&select=id&limit=1`,
        { headers }
      );
      const authMissionData = await authMissionRes.json().catch(() => []);
      if (!Array.isArray(authMissionData) || authMissionData.length === 0) {
        return res.status(403).json({ error: "Non autorisé" });
      }

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
      if (!["open", "assigned", "pending_acceptance", "needs_replacement"].includes(mission.status)) {
        return res.status(400).json({ error: "Cette mission ne peut plus être annulée" });
      }

      // Politique d'annulation : seuls les frais de service sont retenus si < 24h
      const FRAIS_SERVICE = 4.90; // frais de service standard retenus en cas d'annulation < 24h
      let lessThan24h = false;
      if (mission.date) {
        const [h, mn] = (mission.heure_debut || "08:00").split(":").map(Number);
        const missionStart = new Date(`${mission.date}T${String(h).padStart(2,"0")}:${String(mn||0).padStart(2,"0")}:00`);
        const missionStartUTC = new Date(missionStart.getTime() + frenchOffsetMs(missionStart));
        lessThan24h = (missionStartUTC - new Date()) / 3600000 < 24;
      }

      const missionAmount = Number(mission.montant_total) || 0;
      // > 24h : remboursement intégral / < 24h : frais de service retenus (4,90€)
      const refundAmount = lessThan24h
        ? Math.max(0, Math.round((missionAmount - FRAIS_SERVICE) * 100)) // en centimes
        : Math.round(missionAmount * 100);
      const keptAmount = lessThan24h ? Math.min(FRAIS_SERVICE, missionAmount) : 0;

      // Récupérer l'email du client pour les notifications
      let clientEmail = null;
      try {
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${caller.id}`, { headers });
        const uData = await uRes.json();
        clientEmail = uData.email || null;
      } catch {}

      // ── Remboursement Stripe en PREMIER (avant de marquer cancelled en DB)
      // Si Vercel crashe entre les deux, la mission reste "assigned" (récupérable)
      // plutôt que "cancelled" sans remboursement (irrécupérable côté client)
      let stripeRefundId = null;
      let stripeRefundError = null;
      const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
      if (mission.stripe_payment_intent && refundAmount > 0 && STRIPE_SECRET_KEY) {
        try {
          const stripeBody = new URLSearchParams({
            payment_intent: mission.stripe_payment_intent,
            amount: String(refundAmount),
            reason: "requested_by_customer",
          });
          const stripeRes = await fetch("https://api.stripe.com/v1/refunds", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: stripeBody.toString(),
          });
          const stripeData = await stripeRes.json();
          if (stripeRes.ok && stripeData.id) {
            stripeRefundId = stripeData.id;
          } else {
            stripeRefundError = stripeData.error?.message || "Erreur Stripe inconnue";
            console.error("[cancel_client] Stripe refund failed:", stripeRefundError);
          }
        } catch (e) {
          stripeRefundError = e.message;
          console.error("[cancel_client] Stripe refund exception:", e.message);
        }
      }

      // ── Marquer la mission comme annulée (après tentative de remboursement)
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          status: "cancelled",
          cancellation_reason: reason || null,
          cancellation_penalty: keptAmount,
        }),
      });

      // Email au client — confirmation de remboursement
      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      const RESEND_FROM    = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
      const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;
      if (RESEND_API_KEY && clientEmail) {
        const refundEur = (refundAmount / 100).toFixed(2).replace(".", ",");
        const keptEur   = keptAmount.toFixed(2).replace(".", ",");
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: clientEmail,
            subject: `Annulation confirmée — remboursement de ${refundEur} € en cours`,
            html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
              <h2 style="color:#050E20">✅ Annulation confirmée</h2>
              <p style="color:#444">Votre mission <strong>${esc(mission.metier || mission.sector || "")}</strong> a bien été annulée.</p>
              <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
                <tr><td style="padding:6px 0;color:#666">Montant payé</td><td style="font-weight:700">${esc(String(missionAmount.toFixed(2).replace(".",",")))} €</td></tr>
                <tr><td style="padding:6px 0;color:#666">Remboursement</td><td style="font-weight:700;color:#10D98F">${refundEur} €</td></tr>
                ${lessThan24h ? `<tr><td style="padding:6px 0;color:#666">Frais de service retenus</td><td style="font-weight:700;color:#F0B429">${keptEur} €</td></tr>` : ""}
              </table>
              <p style="font-size:13px;color:#666">${stripeRefundId ? "Le remboursement a été déclenché automatiquement. Il apparaîtra sur votre relevé bancaire sous 5 à 10 jours ouvrés." : "Le remboursement sera traité manuellement par notre équipe dans les 48h."}</p>
              ${lessThan24h ? `<p style="font-size:12px;color:#999">Les frais de service (${keptEur} €) sont retenus car l'annulation a eu lieu moins de 24h avant le début de la prestation.</p>` : ""}
              <p style="margin-top:16px;font-size:12px;color:#888">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
            </div>`,
          }),
        }).catch(() => {});
      }

      // Email admin uniquement si le remboursement Stripe a échoué
      if (stripeRefundError && RESEND_API_KEY && ADMIN_EMAIL) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: ADMIN_EMAIL,
            subject: `[ACTION REQUISE] Remboursement Stripe échoué — mission ${mission_id.slice(0,8)}`,
            html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
              <h2 style="color:#c0392b">⚠️ Remboursement automatique échoué</h2>
              <p>Le remboursement automatique a échoué pour la mission <strong>${esc(mission.metier || mission.sector || "—")}</strong>.</p>
              <table style="width:100%;border-collapse:collapse;font-size:14px">
                <tr><td style="padding:6px 0;color:#666">PaymentIntent</td><td style="font-weight:700;font-size:12px">${esc(mission.stripe_payment_intent || "")}</td></tr>
                <tr><td style="padding:6px 0;color:#666">Montant à rembourser</td><td style="font-weight:700">${((refundAmount)/100).toFixed(2)} €</td></tr>
                <tr><td style="padding:6px 0;color:#666">Erreur</td><td style="color:#c0392b">${esc(stripeRefundError)}</td></tr>
                <tr><td style="padding:6px 0;color:#666">Client</td><td>${esc(clientEmail || caller.id)}</td></tr>
              </table>
              <p style="margin-top:16px"><a href="https://dashboard.stripe.com/payments/${esc(mission.stripe_payment_intent || "")}" style="color:#7C6FE0">Traiter manuellement dans Stripe →</a></p>
            </div>`,
          }),
        }).catch(() => {});
      }

      // Notifier le prestataire (in-app + SMS si assignée et potentiellement en route)
      if (mission.prestataire_id) {
        const missionLabel = mission.metier || mission.sector || "la mission";
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: mission.prestataire_id,
            type: "mission",
            title: "Mission annulée ❌",
            body: `La mission "${missionLabel}" a été annulée par le client.`,
            read: false,
          }),
        }).catch(() => {});

        // SMS d'alerte immédiat si le prestataire était assigné (peut être en déplacement)
        if (mission.status === "assigned") {
          try {
            const prestaRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${mission.prestataire_id}`, { headers });
            const prestaData = await prestaRes.json();
            const prestaPhone = prestaData.user_metadata?.telephone || null;
            const BREVO_KEY = process.env.BREVO_API_KEY;
            if (BREVO_KEY && prestaPhone) {
              await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
                method: "POST",
                headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
                body: JSON.stringify({
                  sender: "ALANE",
                  recipient: prestaPhone.startsWith("+") ? prestaPhone : `+33${prestaPhone.replace(/^0/, "")}`,
                  content: `ANNULATION : La mission "${missionLabel}" a été annulée par le client. Ne vous déplacez pas. Connectez-vous à l'app pour plus d'infos.`,
                }),
              }).catch(() => {});
            }
          } catch {}
        }
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
      if (!mission.heure_debut) return res.status(400).json({ error: "Heure de début non définie sur cette mission" });

      // Calcul du prorata arrondi à l'heure supérieure
      const missionStartNaive = mission.date
        ? new Date(`${mission.date}T${mission.heure_debut}`)
        : null;
      const missionStart = missionStartNaive
        ? new Date(missionStartNaive.getTime() + frenchOffsetMs(missionStartNaive))
        : null;
      const elapsedMs = Math.max(0, missionStart ? Date.now() - missionStart.getTime() : 0);
      const elapsedHours = elapsedMs / 3600000;
      const totalHours = Number(mission.hours) || 1;
      const roundedHours = Math.min(Math.ceil(elapsedHours * 10) / 10, totalHours);
      // Arrondi à l'heure entière supérieure (ex: 4h30 → 5h)
      const billedHours = Math.min(Math.ceil(elapsedHours), totalHours);
      const tarifHoraire = Number(mission.tarif_horaire) || 0;
      const proratedAmount = billedHours * tarifHoraire;

      // B-06: Stripe partial refund — executed BEFORE overwriting montant_total
      const originalMontant = Number(mission.montant_total) || 0;
      const refundAmount = Math.max(0, originalMontant - proratedAmount);
      let stripeRefundId = null;
      if (refundAmount > 0 && mission.stripe_payment_intent) {
        try {
          const STRIPE_SECRET_KEY_CANCEL = process.env.STRIPE_SECRET_KEY;
          if (STRIPE_SECRET_KEY_CANCEL) {
            const refundCents = Math.round(refundAmount * 100);
            const rfRes = await fetch("https://api.stripe.com/v1/refunds", {
              method: "POST",
              headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY_CANCEL}`, "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                payment_intent: mission.stripe_payment_intent,
                amount: String(refundCents),
                reason: "requested_by_customer",
              }).toString(),
            });
            const rfData = await rfRes.json();
            if (rfData?.id) {
              stripeRefundId = rfData.id;
              console.log("[cancel_in_progress] Stripe partial refund ok:", rfData.id, "amount:", refundCents);
            } else {
              console.error("[cancel_in_progress] Stripe refund failed:", JSON.stringify(rfData));
            }
          }
        } catch (e) {
          console.error("[cancel_in_progress] Stripe refund exception:", e.message);
        }
      }

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
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: prestaEmail,
            subject: `💶 Mission interrompue — vous serez payé(e) pour ${billedHours}h`,
            html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
              <h2 style="color:#050E20">Mission interrompue par le client</h2>
              <p style="color:#444">Bonjour ${prestaName},</p>
              <p style="color:#444">Le client a mis fin à la mission <strong>${esc(missionLabel)}</strong> avant son terme prévu.</p>
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

      // SMS au prestataire via Brevo
      const BREVO_KEY_CANCEL = process.env.BREVO_API_KEY;
      if (BREVO_KEY_CANCEL && prestaPhone) {
        await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
          method: "POST",
          headers: { "api-key": BREVO_KEY_CANCEL, "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: "ALANE",
            recipient: prestaPhone.startsWith("+") ? prestaPhone : `+33${prestaPhone.replace(/^0/, "")}`,
            content: `Mission "${missionLabel}" interrompue après ${elapsedHours.toFixed(1).replace(".",",")}h. Vous serez réglé(e) pour ${billedHours}h = ${proratedAmount.toFixed(2).replace(".",",")} € HT. L'équipe ALANE vous contacte sous 24h.`,
          }),
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
            message: `Mission interrompue par le client en cours d'exécution.\n\nMission : ${missionLabel}\nPrestataire : ${prestaName} (${prestaEmail || mission.prestataire_id})\nClient : ${clientEmail || caller.id}\n\nDurée prévue : ${totalHours}h\nDurée effectuée : ${elapsedHours.toFixed(2)}h\nHeures facturées : ${billedHours}h (arrondi supérieur)\nMontant dû au prestataire : ${proratedAmount.toFixed(2)} € HT\nMontant initial client : ${originalMontant.toFixed(2)} €\nRemboursement client : ${refundAmount.toFixed(2)} € ${stripeRefundId ? `(✅ effectué — ${stripeRefundId})` : "(⚠️ ÉCHEC — à traiter manuellement)"}\nPaymentIntent Stripe : ${mission.stripe_payment_intent}\n\nActions requises :\n1. ${stripeRefundId ? `Remboursement de ${refundAmount.toFixed(2)} € effectué automatiquement (${stripeRefundId})` : `Rembourser le client manuellement de ${refundAmount.toFixed(2)} € sur Stripe`}\n2. Virer le prorata de ${proratedAmount.toFixed(2)} € HT au prestataire`,
            user_email: clientEmail,
            user_id: caller.id,
            status: "open",
          }),
        }).catch(() => {});

        // Email admin
        const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
        if (RESEND_API_KEY && ADMIN_EMAIL) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: RESEND_FROM,
              to: ADMIN_EMAIL,
              subject: `[ACTION REQUISE] Arrêt en cours — ${missionLabel} — ${billedHours}h / ${proratedAmount.toFixed(2)} € HT`,
              html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
                <h2 style="color:#050E20">⚠️ Mission interrompue en cours d'exécution</h2>
                <table style="width:100%;border-collapse:collapse;font-size:14px">
                  <tr><td style="padding:6px 0;color:#666">Mission</td><td style="font-weight:700">${esc(missionLabel)}</td></tr>
                  <tr><td style="padding:6px 0;color:#666">Prestataire</td><td style="font-weight:700">${esc(prestaName)} — ${esc(prestaEmail||"—")}</td></tr>
                  <tr><td style="padding:6px 0;color:#666">Client</td><td>${esc(clientEmail||caller.id)}</td></tr>
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

    if (action === "checkin_mission") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id } = payload;
      if (!mission_id || !isUuid(mission_id)) return res.status(400).json({ error: "mission_id requis" });
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&prestataire_id=eq.${caller.id}&status=eq.assigned&select=id,client_id,metier,titre,arrived_at,heure_debut,hours,date`, { headers });
      const mData = await mr.json();
      const m = Array.isArray(mData) && mData[0];
      if (!m) return res.status(404).json({ error: "Mission introuvable" });
      if (m.arrived_at) return res.status(200).json({ arrived_at: m.arrived_at });

      const arrivedAt = new Date().toISOString();

      // Calcul du retard
      let delayMinutes = 0;
      if (m.heure_debut && m.date) {
        const [h, mn] = m.heure_debut.split(":").map(Number);
        const scheduledNaive = new Date(`${m.date}T${String(h).padStart(2,"0")}:${String(mn).padStart(2,"0")}:00`);
        const scheduledMs = scheduledNaive.getTime() + frenchOffsetMs(scheduledNaive);
        delayMinutes = Math.round((new Date(arrivedAt).getTime() - scheduledMs) / 60000);
      }
      const hasDelay = delayMinutes > 5;

      const patch = { arrived_at: arrivedAt };
      if (hasDelay) {
        patch.arrival_delay_minutes = delayMinutes;
        patch.delay_status = "pending";
      }
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify(patch),
      });

      if (m.client_id) {
        const label = m.titre || m.metier || "la prestation";
        let notifTitle, notifBody;
        if (hasDelay) {
          const [sh, smn] = m.heure_debut.split(":").map(Number);
          const endMins = sh * 60 + smn + Math.round((m.hours || 0) * 60) + delayMinutes;
          const newEndStr = `${String(Math.floor(endMins / 60) % 24).padStart(2,"0")}h${String(endMins % 60).padStart(2,"0")}`;
          const arrivedStr = new Date(arrivedAt).toLocaleString("fr-FR", { hour:"2-digit", minute:"2-digit", timeZone:"Europe/Paris" });
          notifTitle = `Prestataire arrivé(e) — ${delayMinutes} min de retard ⏰`;
          notifBody = `Votre prestataire est arrivé(e) à ${arrivedStr} pour « ${label} » (${delayMinutes} min de retard). Fin proposée à ${newEndStr}. Acceptez-vous le décalage ?`;
        } else {
          notifTitle = "Prestataire arrivé(e) sur place 📍";
          notifBody = `Votre prestataire est arrivé(e) pour « ${label} ». La mission démarre.`;
        }
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ user_id: m.client_id, type: "mission", title: notifTitle, body: notifBody, read: false }),
        }).catch(() => {});
        await sendPushToUser(m.client_id, { title: notifTitle, body: notifBody, url: "/" }, SUPABASE_URL, headers).catch(() => {});
      }

      return res.status(200).json({ arrived_at: arrivedAt, delay_minutes: delayMinutes });
    }

    if (action === "respond_delay") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, response } = payload;
      if (!mission_id || !isUuid(mission_id)) return res.status(400).json({ error: "mission_id requis" });
      if (!["approved", "rejected"].includes(response)) return res.status(400).json({ error: "response invalide" });
      const mr2 = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&client_id=eq.${caller.id}&status=eq.assigned&select=id,prestataire_id,hours,arrival_delay_minutes,delay_status,metier,titre`, { headers });
      const mData2 = await mr2.json();
      const m2 = Array.isArray(mData2) && mData2[0];
      if (!m2) return res.status(404).json({ error: "Mission introuvable" });
      if (m2.delay_status !== "pending") return res.status(400).json({ error: "Aucun décalage en attente" });
      const delayMins = m2.arrival_delay_minutes || 0;
      const actualHours = response === "rejected"
        ? Math.max(0, Math.round(((m2.hours || 0) - delayMins / 60) * 100) / 100)
        : m2.hours;
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ delay_status: response, actual_hours: actualHours }),
      });
      if (m2.prestataire_id) {
        const label = m2.titre || m2.metier || "la prestation";
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: m2.prestataire_id, type: "mission",
            title: response === "approved" ? "Décalage accepté ✅" : "Décalage refusé ⏰",
            body: response === "approved"
              ? `Le client a accepté le décalage de ${delayMins} min pour « ${label} ». La mission se termine à l'heure ajustée.`
              : `Le client a refusé le décalage pour « ${label} ». Fin à l'heure initiale (${actualHours}h facturées).`,
            read: false,
          }),
        }).catch(() => {});
      }
      return res.status(200).json({ ok: true, actual_hours: actualHours });
    }

    if (action === "my_missions") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const [r1, r2] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${caller.id}&status=eq.pending_acceptance&select=id,sector,metier,date,heure_debut,hours,tarif_horaire,acceptance_deadline,client_id,titre,ville,adresse,description&order=created_at.desc`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${caller.id}&status=eq.assigned&select=id,sector,metier,date,heure_debut,hours,tarif_horaire,client_id,titre,ville,adresse,description,validation_prestataire,status,arrived_at,started_at,extra_hours_requested,extra_hours_status&order=created_at.desc`, { headers }),
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

      // Vérification quota : bloquer l'acceptation si trial épuisé et plan free
      if (response === "accept") {
        const [prRow, urData] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=trial_exhausted,plan_abonnement`, { headers }).then(r => r.json()),
          fetch(`${SUPABASE_URL}/auth/v1/admin/users/${caller.id}`, { headers }).then(r => r.json()),
        ]);
        const trialExhausted = Array.isArray(prRow) && prRow[0]?.trial_exhausted === true;
        const plan = (Array.isArray(prRow) && prRow[0]?.plan_abonnement) || urData?.user_metadata?.plan_abonnement || "free";
        if (trialExhausted && plan === "free") {
          return res.status(403).json({ error: "quota_exhausted", message: "Votre quota gratuit est épuisé. Passez Premium pour accepter des prestations." });
        }
      }

      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&prestataire_id=eq.${caller.id}&status=eq.pending_acceptance&select=id,client_id,sector,metier,titre,acceptance_deadline`, { headers });
      const mData = await mr.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable ou délai dépassé" });

      // Vérification serveur du délai d'acceptation (le contrôle frontend seul est insuffisant)
      if (mission.acceptance_deadline && mission.acceptance_deadline < new Date().toISOString()) {
        // Remettre en open pour qu'elle soit re-proposable
        await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ status: "open", prestataire_id: null }),
        }).catch(() => {});
        return res.status(410).json({ error: "Le délai d'acceptation est dépassé. La mission est de nouveau disponible." });
      }

      // Récupérer le vrai nom du prestataire depuis la DB (pas depuis le payload client)
      let resolvedPrestaName = "Votre prestataire";
      try {
        const prRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=prenom,nom`, { headers });
        const prData = await prRes.json();
        if (Array.isArray(prData) && prData[0]) {
          resolvedPrestaName = [prData[0].prenom, prData[0].nom].filter(Boolean).join(" ") || resolvedPrestaName;
        }
      } catch {}

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
              ? `${resolvedPrestaName} a accepté votre demande de mission.`
              : `${resolvedPrestaName} a décliné votre demande. Vous pouvez choisir un autre prestataire.`,
            read: false,
            ref_id: mission_id,
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
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: RESEND_FROM,
              to: [clientEmail],
              subject: isAccepted ? `✅ ${resolvedPrestaName} a accepté la mission !` : `❌ ${resolvedPrestaName} a refusé la mission`,
              html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
                <h2 style="color:${isAccepted?"#10D98F":"#F25E5E"};margin:0 0 12px">${isAccepted?"Mission acceptée ✅":"Mission refusée ❌"}</h2>
                <p>Bonjour ${esc(clientName)},</p>
                ${isAccepted
                  ? `<p><strong>${esc(resolvedPrestaName)}</strong> a accepté votre demande de mission <strong>${esc(missionLabel)}</strong>.</p><p>Connectez-vous à ALANE pour suivre la mission.</p>`
                  : `<p><strong>${esc(resolvedPrestaName)}</strong> a décliné votre mission <strong>${esc(missionLabel)}</strong>.</p><p>Connectez-vous à ALANE pour choisir un autre prestataire.</p>`
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
            await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
              method: "POST",
              headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
              body: JSON.stringify({
                sender: "ALANE",
                recipient: e164,
                content: smsClean(isAccepted
                  ? `ALANE - ${resolvedPrestaName} a accepté votre mission ${missionLabel}. Connectez-vous pour suivre. — alane.fr`
                  : `ALANE - ${resolvedPrestaName} a refusé votre mission ${missionLabel}. Connectez-vous pour choisir un autre prestataire. — alane.fr`),
              }),
            }).catch(() => {});
          }
        }

        // Web push client
        const pushTitle = isAccepted ? "Mission acceptée ✅" : "Mission refusée";
        const pushBody  = isAccepted
          ? `${resolvedPrestaName} a accepté votre demande de mission.`
          : `${resolvedPrestaName} a refusé. Connectez-vous pour choisir un autre prestataire.`;
        await sendPushToUser(mission.client_id, { title: pushTitle, body: pushBody, url: "/" }, SUPABASE_URL, headers).catch(() => {});
      }

      // Reminder notification to prestataire when they accept
      if (response === "accept") {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ user_id: caller.id, type: "mission", title: "Rappel : signalez votre arrivée 📍", body: `N'oubliez pas de cliquer « Je suis sur place » dans l'app dès que vous arrivez pour la mission ${mission.titre || mission.metier || ""}.`, read: false }),
        }).catch(() => {});
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
      const smsText = smsClean(isAccepted
        ? `ALANE - ${presta_name || "Votre prestataire"} a accepté votre mission ${mission_label || ""}. Connectez-vous pour suivre la mission. — alane.fr`
        : `ALANE - ${presta_name || "Le prestataire"} a refusé votre mission ${mission_label || ""}. Connectez-vous pour choisir un autre prestataire. — alane.fr`);

      const RESEND_KEY  = process.env.RESEND_API_KEY;
      const RESEND_FROM = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
      if (RESEND_KEY && clientEmail) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: [clientEmail],
            subject,
            html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
              <h2 style="color:${isAccepted?"#10D98F":"#F25E5E"};margin:0 0 12px">${isAccepted?"Mission acceptée ✅":"Mission refusée ❌"}</h2>
              <p>Bonjour ${esc(clientName)},</p>
              ${isAccepted
                ? `<p><strong>${esc(presta_name || "Votre prestataire")}</strong> a accepté votre demande de mission <strong>${esc(mission_label || "")}</strong>.</p><p>Connectez-vous à ALANE pour suivre la mission.</p>`
                : `<p><strong>${esc(presta_name || "Le prestataire")}</strong> a décliné votre demande pour la mission <strong>${esc(mission_label || "")}</strong>.</p><p>Connectez-vous à ALANE pour choisir un autre prestataire.</p>`
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
          await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
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
      const { prestataire_id, mission_label, date, ville, hours, heure_debut, adresse, tarif_horaire } = payload;
      if (!prestataire_id || !isUuid(prestataire_id)) return res.status(400).json({ error: "prestataire_id requis" });
      // Sanitize tous les champs user-controlled avant injection HTML
      const sLabel = esc(mission_label || "Mission");
      const sDate  = esc(date || "Date à confirmer");
      const sVille = esc(ville || "Ville à confirmer");
      const sHdeb  = esc(heure_debut || "");
      const sAdresse = esc(adresse || "");
      const sHours = esc(String(hours || "?"));
      const sTarif = tarif_horaire ? esc(Number(tarif_horaire).toFixed(2).replace(".",",")) : "";
      // Verify caller has a mission with this prestataire
      const mCheckRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?client_id=eq.${caller.id}&prestataire_id=eq.${prestataire_id}&status=in.(pending_acceptance,assigned)&select=id&limit=1`, { headers });
      const mCheck = await mCheckRes.json().catch(() => []);
      if (!Array.isArray(mCheck) || mCheck.length === 0) return res.status(403).json({ error: "Non autorisé" });
      const missionId = mCheck[0].id;

      const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${prestataire_id}`, { headers });
      const ud = await ur.json();
      const prestaEmail = ud.email;
      const phone = ud.user_metadata?.telephone;
      const prestaName = ud.user_metadata?.prenom || "Prestataire";

      const RESEND_KEY  = process.env.RESEND_API_KEY;
      const RESEND_FROM = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
      if (RESEND_KEY && prestaEmail) {
        // Generate one-click action tokens (valid 24h)
        const EMAIL_SECRET = process.env.BO_SESSION_SECRET;
        let acceptUrl = `${process.env.APP_URL || "https://www.alane.fr"}/api/missions?action=accept&m=${missionId}&p=${prestataire_id}`;
        let refuseUrl = `${process.env.APP_URL || "https://www.alane.fr"}/api/missions?action=refuse&m=${missionId}&p=${prestataire_id}`;
        if (EMAIL_SECRET && missionId) {
          const { createHmac } = await import("crypto");
          const exp = Math.floor(Date.now() / 1000) + 86400;
          const makeToken = (act) => createHmac("sha256", EMAIL_SECRET).update(`${act}.${missionId}.${prestataire_id}.${exp}`).digest("base64url");
          acceptUrl += `&exp=${exp}&sig=${encodeURIComponent(makeToken("accept"))}`;
          refuseUrl += `&exp=${exp}&sig=${encodeURIComponent(makeToken("refuse"))}`;
        }

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: [prestaEmail],
            subject: "🔔 Nouvelle demande de mission — répondez rapidement !",
            html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
              <h2 style="color:#A29BFE;margin:0 0 12px">Nouvelle demande de mission 🔔</h2>
              <p>Bonjour ${esc(prestaName)},</p>
              <p>Un client vous a envoyé une demande de mission directe :</p>
              <div style="background:#162547;border-left:4px solid #A29BFE;padding:12px 16px;margin:16px 0;border-radius:4px">
                <strong style="font-size:15px">${sLabel}</strong><br/>
                📅 ${sDate}${sHdeb ? ` · ${sHdeb}` : ""}${sHdeb && hours ? ` → ${(() => { const [h,m]=(sHdeb||"00:00").split(":").map(Number); const end=new Date(2000,0,1,h,m); end.setMinutes(end.getMinutes()+Math.round(Number(hours||1)*60)); return String(end.getHours()).padStart(2,"0")+":"+String(end.getMinutes()).padStart(2,"0"); })()}` : ""}<br/>
                ⏱ ${sHours}h de travail${sTarif ? ` · ${sTarif} €/h HT` : ""}<br/>
                📍 ${sAdresse ? `${sAdresse}, ` : ""}${sVille}
              </div>
              <p style="margin:20px 0 8px">Répondez directement depuis cet email :</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="padding-right:8px"><a href="${acceptUrl}" style="display:block;text-align:center;background:#10D98F;color:#fff;text-decoration:none;padding:13px 0;border-radius:10px;font-weight:700;font-size:15px">✅ Accepter</a></td>
                <td style="padding-left:8px"><a href="${refuseUrl}" style="display:block;text-align:center;background:#F25E5E;color:#fff;text-decoration:none;padding:13px 0;border-radius:10px;font-weight:700;font-size:15px">❌ Refuser</a></td>
              </tr></table>
              <p style="margin-top:16px;font-size:13px;color:rgba(255,255,255,0.45)">Ces boutons sont valables 24h. Passé ce délai, connectez-vous à l'application.</p>
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
          await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
            method: "POST",
            headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({
              sender: "ALANE",
              recipient: e164,
              content: smsClean(`ALANE - Demande de mission : ${mission_label || "Mission"} le ${date || "?"} à ${ville || "?"} (${hours || "?"}h). Connectez-vous pour répondre ! — alane.fr`),
            }),
          }).then(r => r.json()).then(d => console.log("[notify_prestataire] SMS:", JSON.stringify(d))).catch(e => console.log("[notify_prestataire] SMS error:", e.message));
        }
      } else {
        console.log("[notify_prestataire] SMS skipped — BREVO_KEY:", !!BREVO_KEY, "hasPhone:", !!phone);
      }

      // Web push (si souscription existante)
      await sendPushToUser(prestataire_id, {
        title: "🔔 Nouvelle mission pour vous",
        body: `${mission_label || "Mission"}${date ? " · " + date : ""}${ville ? " · " + ville : ""}${hours ? " (" + hours + "h)" : ""}`,
        url: "/",
      }, SUPABASE_URL, headers).catch(() => {});

      return res.status(200).json({ success: true });
    }

    // ── Demande d'heures supplémentaires (client → prestataire) ────────
    if (action === "request_extra_hours") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, extra_hours } = payload;
      if (!mission_id || !isUuid(mission_id)) return res.status(400).json({ error: "mission_id requis" });
      const eh = Number(extra_hours);
      if (!eh || eh < 1 || eh > 8) return res.status(400).json({ error: "extra_hours invalide (1-8)" });

      // Vérifier que le client est bien propriétaire de la mission et qu'elle est en cours
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&client_id=eq.${caller.id}&status=eq.assigned&select=id,prestataire_id,metier,hours,extra_hours_status`, { headers });
      const mData = await mr.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable ou non active" });

      // Cap à 24h total pour éviter des prestations aberrantes
      const currentHours = Number(mission.hours || 0);
      if (currentHours + eh > 24) {
        return res.status(400).json({ error: `Durée totale dépasserait 24h (actuel ${currentHours}h + ${eh}h demandé)` });
      }
      // Refus si une demande est déjà en cours
      if (mission.extra_hours_status === "pending") {
        return res.status(409).json({ error: "Une demande d'heures supplémentaires est déjà en attente de réponse" });
      }

      // Enregistrer la demande
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ extra_hours_requested: eh, extra_hours_status: "pending" }),
      });

      // Notifier le prestataire
      if (mission.prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: mission.prestataire_id,
            type: "mission",
            title: "⏱ Demande d'heures supplémentaires",
            body: `Le client souhaite prolonger la prestation de ${eh}h supplémentaire${eh > 1 ? "s" : ""}. Acceptez ou refusez depuis l'application.`,
            read: false,
            ref_id: mission_id,
          }),
        }).catch(() => {});

        // Email au prestataire
        try {
          const prestaEmailRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${mission.prestataire_id}`, { headers: { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}` } });
          const prestaEmailData = await prestaEmailRes.json();
          const prestaEmail = prestaEmailData?.email;
          const RESEND_API_KEY = process.env.RESEND_API_KEY;
          const RESEND_FROM = process.env.RESEND_FROM || "ALANE <no-reply@alane.fr>";
          if (prestaEmail && RESEND_API_KEY) {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                from: RESEND_FROM,
                to: [prestaEmail],
                subject: "⏱ Demande d'heures supplémentaires",
                html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
                  <h2 style="color:#A29BFE;margin:0 0 12px">⏱ Heures supplémentaires demandées</h2>
                  <p>Le client souhaite prolonger la prestation de <strong style="color:#fff">${eh}h supplémentaire${eh > 1 ? "s" : ""}</strong>.</p>
                  <p style="margin-top:12px">Ouvrez l'application pour accepter ou refuser cette demande :</p>
                  <p style="margin-top:16px"><a href="${process.env.APP_URL || "https://www.alane.fr"}" style="display:inline-block;background:#10D98F;color:#fff;text-decoration:none;padding:13px 24px;border-radius:10px;font-weight:700;font-size:15px">Ouvrir ALANE</a></p>
                  <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
                </div>`,
              }),
            });
          }
        } catch(e) {}

        // Web push au prestataire
        await sendPushToUser(mission.prestataire_id, {
          title: "⏱ Demande d'heures supplémentaires",
          body: `Le client souhaite prolonger la prestation de ${eh}h supplémentaire${eh > 1 ? "s" : ""}. Acceptez ou refusez dans l'app.`,
          url: "/",
        }, SUPABASE_URL, headers).catch(() => {});
      }

      return res.status(200).json({ ok: true });
    }

    // ── Réponse aux heures supplémentaires (prestataire → client) ───────
    if (action === "respond_extra_hours") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, response } = payload;
      if (!mission_id || !isUuid(mission_id)) return res.status(400).json({ error: "mission_id requis" });
      if (!["accept", "refuse"].includes(response)) return res.status(400).json({ error: "response invalide" });

      // Vérifier que le prestataire est bien assigné à cette mission
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&prestataire_id=eq.${caller.id}&status=eq.assigned&select=id,client_id,metier,hours,extra_hours_requested`, { headers });
      const mData = await mr.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable ou non active" });
      const extraH = Number(mission.extra_hours_requested || 0);

      if (response === "accept" && extraH > 0) {
        // Mettre à jour les heures totales et marquer accepté — cap à 24h
        const newHours = Math.min(24, Number(mission.hours || 0) + extraH);
        await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ hours: newHours, extra_hours_status: "accepted", extra_hours_requested: null }),
        });
      } else {
        // Refus : effacer la demande
        await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ extra_hours_status: "refused", extra_hours_requested: null }),
        });
      }

      // Notifier le client
      if (mission.client_id) {
        const isAccepted = response === "accept";
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: mission.client_id,
            type: "mission",
            title: isAccepted ? "✅ Heures supplémentaires acceptées" : "❌ Heures supplémentaires refusées",
            body: isAccepted
              ? `Le prestataire a accepté la prolongation de ${extraH}h. La durée totale est mise à jour.`
              : "Le prestataire n'a pas pu accepter la prolongation.",
            read: false,
            ref_id: mission_id,
          }),
        }).catch(() => {});

        // Web push au client
        await sendPushToUser(mission.client_id, {
          title: isAccepted ? "✅ Heures supplémentaires acceptées" : "❌ Heures supplémentaires refusées",
          body: isAccepted
            ? `Le prestataire a accepté la prolongation de ${extraH}h.`
            : "Le prestataire n'a pas pu accepter la prolongation.",
          url: "/",
        }, SUPABASE_URL, headers).catch(() => {});
      }

      return res.status(200).json({ ok: true, newHours: response === "accept" ? Number(mission.hours || 0) + extraH : null });
    }

    // ── Annulation par le prestataire ─────────────────────────────────
    if (action === "presta_cancel") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id } = payload;
      if (!mission_id || !isUuid(mission_id)) return res.status(400).json({ error: "mission_id requis" });

      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&prestataire_id=eq.${caller.id}&status=in.(assigned,pending_acceptance)&select=id,client_id,metier,titre,stripe_payment_intent,montant_total,heure_debut`, { headers });
      const mData = await mr.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable ou non annulable" });

      // Remboursement Stripe si la mission était payée
      if (mission.stripe_payment_intent) {
        try {
          const refundRes = await fetch("https://api.stripe.com/v1/refunds", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${process.env.STRIPE_SECRET_KEY}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              payment_intent: mission.stripe_payment_intent,
              reason: "requested_by_customer",
            }).toString(),
          });
          const refundData = await refundRes.json();
          if (refundData.id) {
            console.log(`[presta_cancel] Remboursement Stripe OK: ${refundData.id} pour mission ${mission_id}`);
          } else {
            console.error(`[presta_cancel] Remboursement Stripe échoué:`, JSON.stringify(refundData));
          }
        } catch (stripeErr) {
          console.error(`[presta_cancel] Erreur appel Stripe refund:`, stripeErr.message);
        }
      }

      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "refused", prestataire_id: null }),
      });

      if (mission.client_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: mission.client_id,
            type: "mission",
            title: "❌ Prestataire indisponible",
            body: `Le prestataire ne peut plus assurer la prestation "${mission.titre || mission.metier}". Vous pouvez choisir un autre prestataire.`,
            read: false,
          }),
        }).catch(() => {});

        // Web push au client
        await sendPushToUser(mission.client_id, {
          title: "❌ Prestataire indisponible",
          body: `Le prestataire ne peut plus assurer la prestation "${mission.titre || mission.metier}". Vous pouvez choisir un autre prestataire.`,
          url: "/",
        }, SUPABASE_URL, headers).catch(() => {});
      }

      return res.status(200).json({ success: true });
    }

    // ── Démarrage effectif de la prestation ────────────────────────────
    if (action === "start_mission") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, auto_start } = payload;
      if (!mission_id || !isUuid(mission_id)) return res.status(400).json({ error: "mission_id requis" });

      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&prestataire_id=eq.${caller.id}&status=eq.assigned&select=id,client_id,metier,titre,arrived_at,started_at`, { headers });
      const mData = await mr.json();
      const m = Array.isArray(mData) && mData[0];
      if (!m) return res.status(404).json({ error: "Mission introuvable ou non assignée" });
      if (m.started_at) return res.status(200).json({ started_at: m.started_at }); // already started

      const startedAt = new Date().toISOString();
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ started_at: startedAt }),
      });

      // Notify client
      if (m.client_id) {
        const label = m.titre || m.metier || "la prestation";
        const notifTitle = auto_start ? "⏱ Démarrage automatique" : "🚀 Prestation démarrée !";
        const notifBody = auto_start
          ? `La prestation « ${label} » a démarré automatiquement (10 min après l'arrivée du prestataire). Le timer est lancé.`
          : `La prestation « ${label} » a démarré. Le timer est lancé.`;
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ user_id: m.client_id, type: "mission", title: notifTitle, body: notifBody, read: false }),
        }).catch(() => {});
        await sendPushToUser(m.client_id, { title: notifTitle, body: notifBody, url: "/" }, SUPABASE_URL, headers).catch(() => {});
      }

      return res.status(200).json({ started_at: startedAt });
    }

    if (action === "raise_dispute") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, reason } = payload;
      if (!mission_id || !isUuid(mission_id)) return res.status(400).json({ error: "mission_id requis" });

      // Vérifier que le caller est bien le client de la mission et que le status est "completed"
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&client_id=eq.${caller.id}&status=eq.completed&select=id,metier,titre,date,montant_total,prestataire_id`, { headers });
      const mData = await mr.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Mission introuvable ou non éligible au litige" });

      // Vérifier délai de contestation (7 jours après date de mission)
      if (mission.date) {
        const missionDate = new Date(mission.date + "T23:59:59");
        if (Date.now() - missionDate.getTime() > 7 * 86400000) {
          return res.status(400).json({ error: "Le délai de contestation de 7 jours est dépassé" });
        }
      }

      // Passer la mission en "disputed"
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "disputed" }),
      });

      // Récupérer email du client
      let clientEmail = null; let clientName = "";
      try {
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${caller.id}`, { headers });
        const uData = await uRes.json();
        clientEmail = uData.email || null;
        clientName = [uData.user_metadata?.prenom, uData.user_metadata?.nom].filter(Boolean).join(" ") || "Client";
      } catch {}

      const label = mission.titre || mission.metier || "prestation";
      const ticketSubject = `⚠️ Litige — Mission : ${label} (${mission.date || ""})`;
      const ticketMessage = `Client : ${clientName} (${clientEmail || caller.id})\nMission ID : ${mission_id}\nPrestataire ID : ${mission.prestataire_id || "inconnu"}\nMontant : ${mission.montant_total || 0} €\n\nMotif : ${reason || "(non précisé)"}\n\nAction : Vérifier et décider du remboursement depuis le Backoffice.`;

      // Créer ticket de support
      await fetch(`${SUPABASE_URL}/rest/v1/support_tickets`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          subject: ticketSubject,
          message: ticketMessage,
          user_email: clientEmail,
          user_name: clientName,
          user_id: caller.id,
          status: "open",
        }),
      }).catch(e => console.error("[raise_dispute] ticket creation failed:", e.message));

      // Notifier le client
      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ user_id: caller.id, type: "system", title: "Litige enregistré ✅", body: "Votre signalement a été transmis à notre équipe. Nous vous répondons sous 48h.", read: false }),
      }).catch(() => {});

      // Email admin
      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      const RESEND_FROM = process.env.RESEND_FROM || "ALANE <no-reply@alane.fr>";
      const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
      if (RESEND_API_KEY && ADMIN_EMAIL) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: ADMIN_EMAIL,
            subject: ticketSubject,
            html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px"><h2 style="color:#c0392b">⚠️ Litige Client</h2><pre style="font-size:14px;line-height:1.6">${ticketMessage}</pre></div>`,
          }),
        }).catch(e => console.error("[raise_dispute] admin email failed:", e.message));
      }

      return res.status(200).json({ success: true });
    }

    // Vérifie et répare le plan + trial_exhausted en interrogeant Stripe
    if (action === "refresh_plan") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });

      const prRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=plan_abonnement,trial_exhausted,stripe_subscription_id,stripe_customer_id`, { headers });
      const prData = await prRes.json();
      const profile = Array.isArray(prData) && prData[0];
      if (!profile) return res.status(404).json({ error: "Profil introuvable" });

      let plan = profile.plan_abonnement || "free";
      let trialExhausted = !!profile.trial_exhausted;

      // Vérification Stripe directe si un abonnement existe
      const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
      if (STRIPE_KEY && profile.stripe_subscription_id) {
        try {
          const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${profile.stripe_subscription_id}`, {
            headers: { "Authorization": `Bearer ${STRIPE_KEY}` },
          });
          if (subRes.ok) {
            const sub = await subRes.json();
            const isActive = sub.status === "active" || sub.status === "trialing";
            if (isActive) {
              const metaPlan = sub.metadata?.plan || sub.items?.data?.[0]?.price?.metadata?.plan;
              if (metaPlan && metaPlan !== "free") plan = metaPlan;
            } else if (sub.status === "canceled" || sub.status === "unpaid") {
              plan = "free";
            }
          }
        } catch (stripeErr) {
          console.error("[refresh_plan] Stripe check failed:", stripeErr.message);
        }
      }

      // Invariant : plan payant → jamais trial_exhausted
      const patchBody = { plan_abonnement: plan };
      if (plan !== "free") {
        patchBody.trial_exhausted = false;
        trialExhausted = false;
      }

      // Mise à jour DB (profiles + user_metadata)
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify(patchBody),
      }).catch(e => console.error("[refresh_plan] profile patch failed:", e.message));

      if (plan !== "free") {
        // Sync user_metadata — GET d'abord pour ne pas écraser les autres champs
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${caller.id}`, { headers }).catch(() => null);
        if (uRes?.ok) {
          const uData = await uRes.json();
          await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${caller.id}`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ user_metadata: { ...(uData.user_metadata || {}), plan_abonnement: plan } }),
          }).catch(e => console.error("[refresh_plan] user_metadata patch failed:", e.message));
        }
      }

      return res.status(200).json({ plan, trial_exhausted: trialExhausted });
    }

    return res.status(400).json({ error: "Action invalide" });
  } catch (e) {
    console.error("missions error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
