import crypto from "crypto";

const APP_URL = process.env.APP_URL || "https://www.alane.fr";

function verifyToken(action, missionId, prestaId, exp, sig, secret) {
  const payload = `${action}.${missionId}.${prestaId}.${exp}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function htmlPage(title, message, color, icon) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title} — ALANE</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0A1628; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #162547; border-radius: 20px; padding: 40px 32px; max-width: 420px; width: 100%; text-align: center; border: 1px solid rgba(255,255,255,0.08); }
    .icon { font-size: 52px; margin-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 700; color: ${color}; margin-bottom: 12px; }
    p { color: rgba(255,255,255,0.7); font-size: 15px; line-height: 1.5; margin-bottom: 24px; }
    a { display: inline-block; background: ${color}; color: #fff; text-decoration: none; padding: 13px 28px; border-radius: 12px; font-weight: 700; font-size: 15px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="${APP_URL}">Ouvrir l'application</a>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  const { action, m: missionId, p: prestaId, exp, sig } = req.query || {};

  const SECRET = process.env.BO_SESSION_SECRET;
  if (!SECRET) return res.status(500).send(htmlPage("Erreur serveur", "Configuration manquante.", "#F25E5E", "⚠️"));

  // Validate params
  const isUuid = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
  if (!action || !missionId || !prestaId || !exp || !sig) {
    return res.status(400).send(htmlPage("Lien invalide", "Ce lien est incomplet ou corrompu.", "#F25E5E", "❌"));
  }
  if (!["accept", "refuse"].includes(action) || !isUuid(missionId) || !isUuid(prestaId)) {
    return res.status(400).send(htmlPage("Lien invalide", "Paramètres incorrects.", "#F25E5E", "❌"));
  }

  // Verify signature
  let sigOk = false;
  try { sigOk = verifyToken(action, missionId, prestaId, exp, sig, SECRET); } catch {}
  if (!sigOk) {
    return res.status(401).send(htmlPage("Lien invalide", "Ce lien est invalide ou a été modifié.", "#F25E5E", "🔒"));
  }

  // Check expiry (24h)
  if (Math.floor(Date.now() / 1000) > parseInt(exp, 10)) {
    return res.status(410).send(htmlPage("Lien expiré", "Ce lien n'est plus valide (validité 24h). Connectez-vous à l'application pour répondre.", "#F5A623", "⏱"));
  }

  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).send(htmlPage("Erreur serveur", "Configuration base de données manquante.", "#F25E5E", "⚠️"));
  }
  const headers = { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };

  // Check mission is still pending
  const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}&prestataire_id=eq.${prestaId}&status=eq.pending_acceptance&select=id,client_id,metier,titre`, { headers });
  const mData = await mr.json().catch(() => []);
  const mission = Array.isArray(mData) && mData[0];

  if (!mission) {
    return res.status(409).send(htmlPage(
      action === "accept" ? "Déjà traité" : "Déjà traité",
      "Cette mission a déjà été acceptée, refusée ou annulée. Consultez l'application pour voir son état.",
      "#A29BFE", "ℹ️"
    ));
  }

  const missionLabel = mission.titre || mission.metier || "la mission";

  // Execute action
  const patchBody = action === "accept"
    ? { status: "assigned" }
    : { status: "open", prestataire_id: null };

  await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify(patchBody),
  });

  // In-app notification to client
  if (mission.client_id) {
    const isAccepted = action === "accept";
    await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
      method: "POST",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({
        user_id: mission.client_id,
        type: "mission",
        title: isAccepted ? "Mission acceptée ! 🎉" : "Mission refusée",
        body: isAccepted
          ? `Votre prestataire a accepté la mission "${missionLabel}" depuis son email.`
          : `Le prestataire a décliné la mission "${missionLabel}". Vous pouvez choisir un autre prestataire.`,
        read: false,
        ref_id: missionId,
      }),
    }).catch(() => {});

    // Web push to client
    try {
      const psRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${mission.client_id}&select=endpoint,p256dh,auth`, { headers });
      const subs = await psRes.json().catch(() => []);
      if (Array.isArray(subs) && subs.length) {
        const VAPID_PUB = process.env.VAPID_PUBLIC_KEY;
        const VAPID_PRV = process.env.VAPID_PRIVATE_KEY;
        if (VAPID_PUB && VAPID_PRV) {
          const pushNotif = {
            title: isAccepted ? "Mission acceptée ✅" : "Mission refusée",
            body: isAccepted
              ? `Votre prestataire a accepté la mission "${missionLabel}".`
              : `Le prestataire a décliné "${missionLabel}". Choisissez un autre prestataire.`,
            url: "/",
          };
          // Import sendWebPush inline (can't import between serverless functions)
          const sc = globalThis.crypto.subtle;
          const b64u = buf => Buffer.from(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf).toString("base64url");
          const deb64u = s => { const p = s.replace(/-/g,"+").replace(/_/g,"/"); return Buffer.from(p.padEnd(p.length+(4-p.length%4)%4,"="),"base64"); };
          await Promise.all(subs.map(async (sub) => {
            try {
              const aud = new URL(sub.endpoint).origin;
              const hdr = b64u(Buffer.from(JSON.stringify({typ:"JWT",alg:"ES256"})));
              const pay = b64u(Buffer.from(JSON.stringify({aud,exp:Math.floor(Date.now()/1000)+43200,sub:"mailto:admin@alane.fr"})));
              const inp = `${hdr}.${pay}`;
              const pubRaw = deb64u(VAPID_PUB);
              const prvKey = await sc.importKey("jwk",{kty:"EC",crv:"P-256",x:b64u(pubRaw.slice(1,33)),y:b64u(pubRaw.slice(33,65)),d:b64u(deb64u(VAPID_PRV))},{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
              const sig2 = await sc.sign({name:"ECDSA",hash:"SHA-256"},prvKey,Buffer.from(inp));
              const jwt = `${inp}.${b64u(sig2)}`;
              const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
              const srvKP = await sc.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
              const srvPubRaw = new Uint8Array(await sc.exportKey("raw",srvKP.publicKey));
              const cliPubKey = await sc.importKey("raw",deb64u(sub.p256dh),{name:"ECDH",namedCurve:"P-256"},false,[]);
              const ecdh = await sc.deriveBits({name:"ECDH",public:cliPubKey},srvKP.privateKey,256);
              const authSec = deb64u(sub.auth);
              const cliPubRaw = deb64u(sub.p256dh);
              const hkdf = async (s2, ikm, info, len) => { const k = await sc.importKey("raw",ikm,"HKDF",false,["deriveBits"]); return sc.deriveBits({name:"HKDF",hash:"SHA-256",salt:s2,info},k,len*8); };
              const ikm = await hkdf(authSec, ecdh, Buffer.concat([Buffer.from("WebPush: info\0"), cliPubRaw, Buffer.from(srvPubRaw)]), 32);
              const cek = await hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
              const nonceRaw = await hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
              const aesKey = await sc.importKey("raw",cek,"AES-GCM",false,["encrypt"]);
              const plaintext = Buffer.concat([Buffer.from(JSON.stringify(pushNotif)), Buffer.from([0x02])]);
              const cipher = await sc.encrypt({name:"AES-GCM",iv:nonceRaw},aesKey,plaintext);
              const rsBuf = Buffer.alloc(4); rsBuf.writeUInt32BE(4096,0);
              const record = Buffer.concat([salt, rsBuf, Buffer.from([65]), Buffer.from(srvPubRaw), Buffer.from(new Uint8Array(cipher))]);
              const r2 = await fetch(sub.endpoint, { method:"POST", headers:{"Content-Type":"application/octet-stream","Content-Encoding":"aes128gcm","Authorization":`vapid t=${jwt},k=${VAPID_PUB}`,"TTL":"86400"}, body: record });
              if (r2.status === 410) {
                await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${mission.client_id}&endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method:"DELETE", headers }).catch(() => {});
              }
            } catch {}
          }));
        }
      }
    } catch {}
  }

  // Show confirmation HTML
  if (action === "accept") {
    return res.status(200).send(htmlPage(
      "Mission acceptée !",
      `Vous avez accepté la mission <strong style="color:#fff">${missionLabel}</strong>. Le client a été notifié. Préparez-vous pour la mission !`,
      "#10D98F", "✅"
    ));
  } else {
    return res.status(200).send(htmlPage(
      "Mission refusée",
      `Vous avez décliné la mission <strong style="color:#fff">${missionLabel}</strong>. Le client pourra choisir un autre prestataire.`,
      "#A29BFE", "👋"
    ));
  }
}
