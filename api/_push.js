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
  // Les clés VAPID identifient ALANE auprès d'Apple et de Google. Sans elles,
  // aucune notification ne part — et c'est le genre de panne qu'on cherche
  // pendant des heures parce que rien ne la signale.
  if (!VAPID_PUB || !VAPID_PRV) {
    console.error("[push] VAPID_PUBLIC_KEY ou VAPID_PRIVATE_KEY absente — aucune notification ne peut être envoyée.");
    return false;
  }
  if (!sub?.endpoint || !sub?.p256dh || !sub?.auth) {
    console.error("[push] abonnement incomplet, envoi impossible :", sub?.endpoint?.slice(0, 40) || "sans adresse");
    return false;
  }
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
    // Un envoi accepté rend 201, parfois 200. Tout le reste est un échec, et
    // il doit se voir : sans ce message, un utilisateur qui ne reçoit rien
    // n'avait aucun moyen de savoir pourquoi — ni nous.
    //
    // 410 signifie que l'abonnement n'existe plus (application désinstallée,
    // notifications révoquées) : l'appelant le supprime. C'est le seul échec
    // normal, il n'est donc pas signalé comme une erreur.
    if (r.status !== 201 && r.status !== 200 && r.status !== 410) {
      const corps = await r.text().catch(() => "");
      console.error(`[push] refusé (${r.status}) par ${new URL(sub.endpoint).host} :`, corps.slice(0, 200));
    }
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

/**
 * Notifier quelqu'un : dans l'application ET sur son téléphone.
 *
 * POURQUOI CE HELPER
 *
 * Le 18/08/2026, le dépôt comptait 86 insertions de notifications pour 20
 * envois push. L'écart n'était pas une décision : personne ne l'avait choisi.
 * Chaque nouvel événement écrivait sa ligne dans la cloche, et pensait ou non
 * au téléphone selon qui l'avait écrit et quel jour.
 *
 * Le résultat est incohérent pour l'utilisateur — la validation de sa
 * prestation ne le prévenait pas, alors qu'un retard de quinze minutes oui — et
 * impossible à maintenir : rien ne signale l'oubli, puisqu'une notification
 * absente ne casse rien.
 *
 * Un seul appel écrit donc les deux. Ajouter un événement, c'est appeler cette
 * fonction ; l'oublier devient aussi visible que d'oublier la notification
 * elle-même.
 *
 * @param {object} corps       la ligne `notifications` — user_id, title, body, type, ref_id
 * @param {string} supabaseUrl
 * @param {object} headers     en-têtes service role
 * @param {object} [options]
 * @param {boolean} [options.push=true]  mettre à false pour une notification
 *   discrète, qui n'a pas à faire vibrer un téléphone
 * @param {string} [options.url="/"]     destination du clic sur la push
 *
 * Ne lève jamais. Une notification est un service rendu, pas une étape d'un
 * traitement : son échec ne doit jamais interrompre ce qui l'a déclenchée —
 * surtout quand ce qui l'a déclenchée est un mouvement d'argent.
 */
export async function notifier(corps, supabaseUrl, headers, options = {}) {
  const { push = true, url = "/" } = options;
  const userId = corps?.user_id;
  if (!userId) {
    console.error("[notifier] notification sans destinataire, ignorée :", JSON.stringify(corps).slice(0, 120));
    return;
  }

  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/notifications`, {
      method: "POST",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ read: false, ...corps }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.error(`[notifier] insertion refusée pour ${userId} :`, txt.slice(0, 200));
    }
  } catch (e) {
    console.error(`[notifier] insertion impossible pour ${userId} :`, e.message);
  }

  if (!push) return;
  // Le titre et le corps sont ceux de la notification : deux textes différents
  // pour un même événement, c'est deux textes à maintenir, et l'un des deux
  // finit par mentir.
  await sendPushToUser(
    userId,
    { title: corps.title || "ALANE", body: corps.body || "", url },
    supabaseUrl,
    headers
  ).catch(e => console.error(`[notifier] push impossible pour ${userId} :`, e.message));
}
