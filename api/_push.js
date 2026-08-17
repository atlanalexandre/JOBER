// ═══════════════════════════════════════════════════════════════════════════
// Notifications poussées — source unique
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER
//
// `sendWebPush` existait en DEUX exemplaires — `api/missions.js` et
// `api/cron-abandon.js` — et ils avaient déjà divergé, ne serait-ce que par les
// commentaires. C'est le défaut récurrent de ce projet : une règle recopiée qui
// s'écarte de l'originale.
//
// Le troisième appelant a été l'occasion de trancher : le traitement de
// relance ne savait pas envoyer de notification du tout. Il ne relançait que
// par e-mail et par SMS, si bien que la cloche de l'application restait vide —
// et que sans clé Resend, plus rien ne partait.
//
// Chiffrement RFC 8291 (aes128gcm), signature VAPID RFC 8292, sans dépendance :
// `crypto` natif de Node 18+.
// ═══════════════════════════════════════════════════════════════════════════

// Web Push sender — RFC 8291 / RFC 8292 — no npm, Node.js 18+ native crypto
export async function sendWebPush(sub, notification) {
  const VAPID_PUB = (process.env.VAPID_PUBLIC_KEY || "").replace(/\s/g, "");
  const VAPID_PRV = (process.env.VAPID_PRIVATE_KEY || "").replace(/\s/g, "");
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

// Haversine distance in km between two lat/lng points

export async function sendPushToUser(userId, notification, supabaseUrl, serviceHeaders) {
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
