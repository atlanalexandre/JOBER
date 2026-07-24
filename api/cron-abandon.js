// Cron — relance des réservations abandonnées
// Déclenché toutes les 30 min par Vercel (vercel.json)
// Pour chaque brouillon > 30 min non encore notifié :
//   1. Push notification (si abonnement existant)
//   2. Email de relance via Resend

// ── Web Push (copie de missions.js — imports relatifs non fiables sur Vercel) ──
async function sendWebPush(sub, notification) {
  const VAPID_PUB = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRV = process.env.VAPID_PRIVATE_KEY;
  if (!VAPID_PUB || !VAPID_PRV) return false;
  if (!sub?.endpoint || !sub?.p256dh || !sub?.auth) return false;
  try {
    const sc = globalThis.crypto.subtle;
    const b64u = buf => Buffer.from(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf).toString("base64url");
    const deb64u = s => { const p = s.replace(/-/g,"+").replace(/_/g,"/"); return Buffer.from(p.padEnd(p.length+(4-p.length%4)%4,"="),"base64"); };
    const aud = new URL(sub.endpoint).origin;
    const hdr = b64u(Buffer.from(JSON.stringify({typ:"JWT",alg:"ES256"})));
    const pay = b64u(Buffer.from(JSON.stringify({aud,exp:Math.floor(Date.now()/1000)+43200,sub:"mailto:admin@alane.fr"})));
    const inp = `${hdr}.${pay}`;
    const pubRaw = deb64u(VAPID_PUB);
    const prvKey = await sc.importKey("jwk",{kty:"EC",crv:"P-256",x:b64u(pubRaw.slice(1,33)),y:b64u(pubRaw.slice(33,65)),d:b64u(deb64u(VAPID_PRV))},{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
    const sig = await sc.sign({name:"ECDSA",hash:"SHA-256"},prvKey,Buffer.from(inp));
    const jwt = `${inp}.${b64u(sig)}`;
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

const esc = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).end();

  const CRON_SECRET      = process.env.CRON_SECRET;
  const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_API_KEY   = process.env.RESEND_API_KEY;
  const RESEND_FROM      = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
  const APP_URL          = process.env.APP_URL || "https://www.alane.fr";

  if (CRON_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${CRON_SECRET}`) return res.status(401).json({ error: "Non autorisé" });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).end();

  const hdrs = {
    "apikey":        SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
  };

  try {

  // Brouillons > 30 min, pas encore notifiés
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  let draftsRes;
  try {
    draftsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/booking_drafts?created_at=lt.${encodeURIComponent(cutoff)}&notified_at=is.null&select=*`,
      { headers: hdrs }
    );
  } catch (e) {
    console.error("[cron-abandon] fetch drafts error:", e.message);
    return res.status(200).json({ ok: true, checked: 0, notified: 0, error: e.message });
  }
  const drafts = draftsRes.ok ? await draftsRes.json().catch(() => []) : [];
  if (!Array.isArray(drafts) || drafts.length === 0) {
    return res.status(200).json({ ok: true, checked: 0, notified: 0 });
  }

  let notified = 0;
  for (const draft of drafts) {
    const presta = draft.prestataire_name ? esc(draft.prestataire_name) : null;
    const metier = draft.metier ? esc(draft.metier) : null;

    // ── 1. Push notification ──────────────────────────────────────────────────
    try {
      const psRes = await fetch(
        `${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${draft.client_id}&select=endpoint,p256dh,auth`,
        { headers: hdrs }
      );
      const subs = psRes.ok ? await psRes.json().catch(() => []) : [];
      if (Array.isArray(subs) && subs.length > 0) {
        const pushBody = presta
          ? `${presta} est toujours disponible — finalisez votre mission en quelques secondes.`
          : "Votre demande n'a pas été finalisée — reprenez où vous en étiez.";
        await Promise.all(subs.map(s => sendWebPush(s, {
          title: "Vous n'avez pas finalisé votre réservation 🔔",
          body: pushBody,
          url: "/",
          tag: "booking-abandon",
        })));
      }
    } catch (e) {
      console.error("[cron-abandon] push error:", e.message);
    }

    // ── 2. Email de relance ───────────────────────────────────────────────────
    if (RESEND_API_KEY) {
      try {
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${draft.client_id}`, { headers: hdrs });
        const uData = uRes.ok ? await uRes.json().catch(() => null) : null;
        const email = uData?.email;
        if (email) {
          const subject = presta
            ? `Votre réservation avec ${presta} n'est pas finalisée`
            : "Vous n'avez pas finalisé votre réservation";
          const detailRows = [
            presta  ? `<tr><td style="padding:6px 0;color:#666;width:120px">Prestataire</td><td style="font-weight:700">${presta}</td></tr>` : "",
            metier  ? `<tr><td style="padding:6px 0;color:#666">Mission</td><td style="font-weight:700">${metier}</td></tr>` : "",
            draft.date  ? `<tr><td style="padding:6px 0;color:#666">Date</td><td>${esc(draft.date)}</td></tr>` : "",
            draft.ville ? `<tr><td style="padding:6px 0;color:#666">Lieu</td><td>${esc(draft.ville)}</td></tr>` : "",
            draft.montant ? `<tr><td style="padding:6px 0;color:#666">Montant</td><td style="font-weight:700;color:#7C6FE0">${Number(draft.montant).toFixed(2).replace(".",",")} €</td></tr>` : "",
          ].filter(Boolean).join("");
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: RESEND_FROM,
              to: email,
              subject,
              html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
                <h2 style="color:#050E20;margin-bottom:4px">⏳ Vous avez une réservation en attente</h2>
                <p style="color:#444;margin-bottom:20px">Vous avez commencé une demande sur ALANE mais ne l'avez pas finalisée. Il suffit d'un clic pour reprendre là où vous en étiez.</p>
                ${detailRows ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;background:#fff;border-radius:10px;padding:16px;display:table">${detailRows}</table>` : ""}
                <a href="${APP_URL}" style="display:inline-block;padding:14px 28px;background:#7C6FE0;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Finaliser ma réservation →</a>
                <p style="margin-top:20px;font-size:12px;color:#888">Si vous ne souhaitez plus faire cette demande, ignorez simplement cet email. · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">ALANE</a></p>
              </div>`,
            }),
          }).catch(() => {});
        }
      } catch (e) {
        console.error("[cron-abandon] email error:", e.message);
      }
    }

    // ── 3. Marquer comme notifié ─────────────────────────────────────────────
    await fetch(`${SUPABASE_URL}/rest/v1/booking_drafts?id=eq.${draft.id}`, {
      method: "PATCH",
      headers: { ...hdrs, "Prefer": "return=minimal" },
      body: JSON.stringify({ notified_at: new Date().toISOString() }),
    }).catch(() => {});

    notified++;
  }

  console.log(`[cron-abandon] checked=${drafts.length} notified=${notified}`);
  return res.status(200).json({ ok: true, checked: drafts.length, notified });

  } catch (e) {
    console.error("[cron-abandon] unhandled error:", e.message, e.stack);
    return res.status(200).json({ ok: false, error: e.message });
  }
}
