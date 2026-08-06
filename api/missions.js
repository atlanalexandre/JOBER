import { resendBody } from "./_email.js";
import crypto from "crypto";

// Returns the UTC offset in ms for a given date in France (CEST = -7200000, CET = -3600000)
function frenchOffsetMs(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  // Last Sunday in March at 01:00 UTC (clocks go forward: CET→CEST)
  const marchEnd = new Date(Date.UTC(y, 2, 31)); marchEnd.setUTCDate(31 - marchEnd.getUTCDay()); marchEnd.setUTCHours(1, 0, 0, 0);
  // Last Sunday in October at 01:00 UTC (clocks go back: CEST→CET)
  const octEnd   = new Date(Date.UTC(y, 9, 31)); octEnd.setUTCDate(31 - octEnd.getUTCDay());   octEnd.setUTCHours(1, 0, 0, 0);
  return (d >= marchEnd && d < octEnd) ? -7200000 : -3600000;
}

// Web Push sender — RFC 8291 / RFC 8292 — no npm, Node.js 18+ native crypto
async function sendWebPush(sub, notification) {
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
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Geocode a French city/postal-code string via the free government API (no key needed)
const _geocodeCache = {};
async function geocodeFR(query) {
  if (!query) return null;
  const q = String(query).trim().toLowerCase();
  if (_geocodeCache[q]) return _geocodeCache[q];
  try {
    const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const d = await r.json();
    const feat = d?.features?.[0];
    if (!feat) return null;
    const [lon, lat] = feat.geometry.coordinates;
    const result = { lat, lon };
    _geocodeCache[q] = result;
    return result;
  } catch { return null; }
}

// HTML escaping — prevents XSS in email templates
const esc = (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

// SMS sanitization — strip CRLF to prevent header injection + cap length
const smsClean = (s, max = 160) => String(s||"").replace(/[\r\n\t]/g," ").trim().slice(0, max);

// Détection de conflit de créneau pour un prestataire
// Retourne la mission conflictuelle ou null si pas de conflit
async function checkPrestaireConflict(prestataire_id, missionDate, heureDebut, hours, supabaseUrl, headers, excludeMissionId = null) {
  if (!missionDate || !heureDebut) return null;
  const [h, m] = heureDebut.split(":").map(Number);
  const startMin = h * 60 + (m || 0);
  const endMin   = startMin + Math.ceil(Number(hours || 1) * 60);
  let url = `${supabaseUrl}/rest/v1/missions?prestataire_id=eq.${prestataire_id}&date=eq.${encodeURIComponent(missionDate)}&status=in.(assigned,pending_acceptance)&select=id,heure_debut,hours,metier`;
  if (excludeMissionId) url += `&id=neq.${excludeMissionId}`;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const existing = await res.json().catch(() => []);
    if (!Array.isArray(existing)) return null;
    for (const em of existing) {
      if (!em.heure_debut) continue;
      const [eh, em2] = em.heure_debut.split(":").map(Number);
      const eStart = eh * 60 + (em2 || 0);
      const eEnd   = eStart + Math.ceil(Number(em.hours || 1) * 60);
      if (startMin < eEnd && eStart < endMin) return em;
    }
  } catch {}
  return null;
}

// Rate limiting — Upstash Redis (persistant cross-instances) avec fallback in-memory
const _rl = new Map();
function _rlMemory(ip, max, windowMs) {
  const now = Date.now();
  const rec = _rl.get(ip) || { count: 0, reset: now + windowMs };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + windowMs; }
  rec.count++;
  _rl.set(ip, rec);
  return rec.count > max;
}
async function checkRateLimit(ip, max = 120, windowMs = 60_000) {
  const REDIS_URL   = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\s/g, "");
  const REDIS_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || "").replace(/\s/g, "");
  if (!REDIS_URL || !REDIS_TOKEN) return _rlMemory(ip, max, windowMs);
  try {
    const key = `rl:missions:${ip}`;
    const ttl = Math.ceil(windowMs / 1000);
    const r = await fetch(`${REDIS_URL}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify([["INCR", key], ["EXPIRE", key, ttl, "NX"]]),
    });
    if (!r.ok) return _rlMemory(ip, max, windowMs);
    const data = await r.json();
    const count = data?.[0]?.result ?? 1;
    return count > max;
  } catch { return _rlMemory(ip, max, windowMs); }
}

// Remboursement intégral d'une prestation payée mais non honorée : refus du
// prestataire, ou délai d'acceptation expiré. Ces trois chemins laissaient
// l'argent du client bloqué alors que l'écran d'attente lui annonce « votre
// paiement est intégralement remboursé ». Les seuls remboursements existants
// couvraient les annulations.
// Retourne { ok, mode, detail } — n'interrompt jamais l'appelant : mieux vaut une
// prestation correctement refusée avec un remboursement à reprendre à la main
// qu'une prestation bloquée en attente.
async function rembourserPrestation(mission, supabaseUrl, serviceHeaders, motif) {
  const intent = mission?.stripe_payment_intent;
  if (!intent) return { ok: true, mode: "aucun_paiement" };

  // Paiement par portefeuille prépayé : on recrédite le solde
  if (String(intent).startsWith("wallet_")) {
    const montant = Number(mission.montant_total) || 0;
    if (montant <= 0 || !mission.client_id) return { ok: true, mode: "wallet_vide" };
    try {
      const pr = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${mission.client_id}&select=prepaid_balance`, { headers: serviceHeaders });
      const pd = await pr.json().catch(() => []);
      const solde = Number(Array.isArray(pd) && pd[0]?.prepaid_balance || 0);
      await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${mission.client_id}`, {
        method: "PATCH",
        headers: { ...serviceHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({ prepaid_balance: Math.round((solde + montant) * 100) / 100 }),
      });
      console.log(`[remboursement/${motif}] portefeuille recrédité de ${montant} € — prestation ${mission.id}`);
      return { ok: true, mode: "wallet", detail: montant };
    } catch (e) {
      console.error(`[remboursement/${motif}] recrédit portefeuille échoué — prestation ${mission.id} :`, e.message);
      return { ok: false, mode: "wallet", detail: e.message };
    }
  }

  const cle = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
  if (!cle) {
    console.error(`[remboursement/${motif}] STRIPE_SECRET_KEY absente — remboursement NON effectué pour ${mission.id}`);
    return { ok: false, mode: "stripe", detail: "cle_absente" };
  }
  try {
    const r = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${cle}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Clé unique par prestation, indépendante du motif : plusieurs chemins
        // peuvent viser la même prestation — expiration côté application et
        // expiration par le cron notamment. Une clé par motif aurait fait tenter
        // deux remboursements à Stripe, dont le second en erreur.
        "Idempotency-Key": `refund-nonhonoree-${mission.id}`,
      },
      body: new URLSearchParams({ payment_intent: intent, reason: "requested_by_customer" }).toString(),
    });
    const d = await r.json();
    if (d.id) {
      console.log(`[remboursement/${motif}] Stripe OK ${d.id} — prestation ${mission.id}`);
      return { ok: true, mode: "stripe", detail: d.id };
    }
    console.error(`[remboursement/${motif}] Stripe a refusé — prestation ${mission.id} :`, JSON.stringify(d));
    return { ok: false, mode: "stripe", detail: d?.error?.message || "refus_stripe" };
  } catch (e) {
    console.error(`[remboursement/${motif}] appel Stripe impossible — prestation ${mission.id} :`, e.message);
    return { ok: false, mode: "stripe", detail: e.message };
  }
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
    const user = await r.json();
    if (!user?.id) return null;
    // Vérifier que le profil est approuvé — bloque les comptes pending/rejected/suspended
    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=status`,
      { headers: { "apikey": serviceRoleKey, "Authorization": `Bearer ${serviceRoleKey}` } }
    );
    if (!profileRes.ok) return null;
    const profiles = await profileRes.json().catch(() => []);
    const status = Array.isArray(profiles) && profiles[0]?.status;
    if (status !== "approved") return null;
    return user;
  } catch { return null; }
}

// Secteurs fermés aux clients, réglés depuis le backoffice (`disabled_sectors`).
// Renvoie toujours un tableau : en cas d'échec de lecture on ne ferme rien, mais
// on journalise — fermer par défaut bloquerait toute la plateforme sur une panne.
async function secteursDesactives(supabaseUrl, headers) {
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/platform_settings?key=eq.disabled_sectors&select=value`, { headers });
    const d = await r.json();
    const v = Array.isArray(d) && d[0]?.value;
    return Array.isArray(v) ? v : [];
  } catch (e) {
    console.error("[secteurs] lecture de disabled_sectors impossible :", e.message);
    return [];
  }
}

// Limite mensuelle de prestations d'un prestataire, offre de lancement comprise.
//
// L'inscription annonce aux 100 premiers prestataires « 10 prestations/mois
// gratuites ». Cette promesse n'était appliquée nulle part : le quota retombait
// systématiquement sur `plan_limits.free` (2), et un prestataire du lancement se
// voyait refuser sa 3ᵉ prestation avec un message parlant de « limite de son plan ».
// L'offre s'applique tant que le réglage `launch_phase` est actif.
async function limitePlanMensuelle(plan, prestataireId, supabaseUrl, headers) {
  let limites = { free: 2, premium: 10, elite: 999 };
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/platform_settings?key=eq.plan_limits&select=value`, { headers });
    const d = await r.json();
    if (Array.isArray(d) && d[0]?.value) limites = { ...limites, ...d[0].value };
  } catch (e) {
    console.error("[quota] lecture de plan_limits impossible, valeurs par défaut :", e.message);
  }
  const limite = Number(limites[plan] ?? limites.free) || 0;
  if (plan !== "free" || !prestataireId) return limite;

  try {
    const sr = await fetch(`${supabaseUrl}/rest/v1/platform_settings?key=eq.launch_phase&select=value`, { headers });
    const sd = await sr.json();
    const brut = Array.isArray(sd) && sd[0] ? sd[0].value : null;
    if (brut !== true && brut !== "true") return limite;

    // Les 100 premiers prestataires inscrits, dans l'ordre de création du profil.
    const cr = await fetch(`${supabaseUrl}/rest/v1/profiles?role=eq.prestataire&select=id&order=created_at.asc&limit=100`, { headers });
    const cd = await cr.json();
    if (Array.isArray(cd) && cd.some(p => p.id === prestataireId)) {
      return Math.max(limite, Number(limites.premium) || 10);
    }
  } catch (e) {
    console.error("[quota] offre de lancement non évaluée :", e.message);
  }
  return limite;
}

// Candidats à l'affectation automatique d'une prestation exécutée chez un tiers.
//
// L'article 5.2 des CGPS interdit au client d'exiger une personne déterminée dès
// qu'un tiers est en jeu : c'est le critère même que la loi retient pour distinguer
// une prestation de services d'une fourniture de main-d'œuvre. La sélection revient
// donc à la plateforme, et elle ne s'opère que sur des critères objectifs — métier,
// secteur, rayon d'intervention, disponibilité, tarif, quota.
//
// L'ordre retenu est lui aussi objectif : le plus proche d'abord, puis celui qui a
// réalisé le moins de prestations ce mois-ci. Ni note, ni abonnement, ni ancienneté :
// un classement fondé sur le comportement donnerait prise au reproche d'un pouvoir de
// direction déguisé.
async function candidatsPourMission(mission, supabaseUrl, headers, exclure = []) {
  const JOURS_SEMAINE = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
  const jourDemande = mission.date ? JOURS_SEMAINE[new Date(`${mission.date}T12:00:00`).getDay()] : null;
  const tarifMax = Number(mission.tarif_horaire) || 0;

  const pr = await fetch(
    `${supabaseUrl}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&missions_enabled=is.true&select=id,missions_completed_month,trial_exhausted,plan_abonnement`,
    { headers }
  );
  const profils = await pr.json().catch(() => []);
  if (!Array.isArray(profils) || !profils.length) return [];

  const exclus = new Set(exclure.filter(Boolean));
  const eligibles = profils.filter(p => !exclus.has(p.id) && !p.trial_exhausted);
  if (!eligibles.length) return [];

  // user_metadata porte métier, secteur, tarif, disponibilités et rayon.
  let metas = {};
  try {
    const ur = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=10000`, { headers });
    const ud = await ur.json();
    for (const u of (ud.users || [])) metas[u.id] = u.user_metadata || {};
  } catch (e) {
    console.error("[affectation] métadonnées prestataires illisibles :", e.message);
    return [];
  }

  const lieuMission = [mission.adresse, mission.ville].filter(Boolean).join(" ") || mission.ville;
  const coordMission = lieuMission ? await geocodeFR(lieuMission) : null;

  const retenus = [];
  for (const p of eligibles) {
    const m = metas[p.id] || {};

    // Métier : principal ou secondaire.
    const metiers = [m.metier, ...(Array.isArray(m.metiers_list) ? m.metiers_list.map(x => x?.metier || x) : [])]
      .filter(Boolean).map(x => String(x).toLowerCase());
    if (mission.metier && metiers.length && !metiers.includes(String(mission.metier).toLowerCase())) continue;
    if (mission.sector && (m.secteur || m.sector) && String(m.secteur || m.sector) !== String(mission.sector)) continue;

    // Tarif : le prestataire ne peut être affecté en dessous de ce qu'il demande.
    const tarifSien = Number(m.tarif_net) || 0;
    if (tarifMax > 0 && tarifSien > tarifMax + 0.01) continue;

    // Disponibilité déclarée ce jour-là.
    if (jourDemande && Array.isArray(m.dispon_jours) && m.dispon_jours.length && !m.dispon_jours.includes(jourDemande)) continue;

    // Rayon d'intervention.
    let distance = 0;
    if (coordMission && (m.ville || m.code_postal)) {
      const cp = await geocodeFR(m.ville || m.code_postal);
      if (cp) {
        distance = haversineKm(cp.lat, cp.lon, coordMission.lat, coordMission.lon);
        if (distance > (Number(m.zone_km) || 50)) continue;
      }
    }

    retenus.push({ id: p.id, distance, charge: Number(p.missions_completed_month) || 0 });
  }

  retenus.sort((a, b) => (a.distance - b.distance) || (a.charge - b.charge));
  return retenus.map(r => r.id);
}

// Passe au candidat suivant après un refus ou une absence de réponse, pour les
// prestations affectées par la plateforme (CGPS art. 5.2).
//
// Sans cela, un refus renverrait la prestation en « refused » et déclencherait un
// remboursement : le client serait renvoyé à la case départ pour un choix qu'il n'a
// jamais fait. La cascade préserve sa commande et, à défaut de candidat, bascule en
// diffusion — c'est alors le prestataire qui se propose, ce qui rend son autonomie
// visible et horodatée.
//
// Renvoie ce qui a été fait, pour que l'appelant journalise et notifie en conséquence.
async function affecterCandidatSuivant(mission, supabaseUrl, headers) {
  const dejaVus = [];
  if (mission.prestataire_id) dejaVus.push(mission.prestataire_id);
  try {
    const rf = await fetch(
      `${supabaseUrl}/rest/v1/candidatures?mission_id=eq.${mission.id}&select=prestataire_id`,
      { headers }
    );
    const cs = await rf.json().catch(() => []);
    if (Array.isArray(cs)) for (const c of cs) if (c.prestataire_id) dejaVus.push(c.prestataire_id);
  } catch (e) {
    console.error("[cascade] candidatures illisibles :", e.message);
  }

  const suivants = await candidatsPourMission(mission, supabaseUrl, headers, dejaVus);
  if (!suivants.length) {
    await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${mission.id}`, {
      method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ status: "open", prestataire_id: null, acceptance_deadline: null }),
    }).catch(e => console.error("[cascade] bascule en diffusion échouée :", e.message));
    return { mode: "diffusion", prestataire_id: null };
  }

  // Même délai que l'affectation initiale : quatre heures, borné par le début prévu.
  const echeance = new Date(Date.now() + 4 * 3600000).toISOString();
  const pr = await fetch(`${supabaseUrl}/rest/v1/missions?id=eq.${mission.id}`, {
    method: "PATCH", headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({ status: "pending_acceptance", prestataire_id: suivants[0], acceptance_deadline: echeance }),
  });
  const rows = await pr.json().catch(() => []);
  if (!pr.ok || !Array.isArray(rows) || rows.length === 0) {
    console.error(`[cascade] affectation du suivant refusée pour ${mission.id} : ${pr.status}`);
    return { mode: "echec", prestataire_id: null };
  }
  return { mode: "affectation", prestataire_id: suivants[0] };
}

// ── Email one-click action (GET) ────────────────────────────────────────────
const APP_URL_DEFAULT = (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr";

function emailActionHtml(title, message, color, icon) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title} — ALANE</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0A1628;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.card{background:#162547;border-radius:20px;padding:40px 32px;max-width:420px;width:100%;text-align:center;border:1px solid rgba(255,255,255,0.08)}.icon{font-size:52px;margin-bottom:20px}h1{font-size:22px;font-weight:700;color:${color};margin-bottom:12px}p{color:rgba(255,255,255,0.7);font-size:15px;line-height:1.5;margin-bottom:24px}a{display:inline-block;background:${color};color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-weight:700;font-size:15px}</style></head><body><div class="card"><div class="icon">${icon}</div><h1>${title}</h1><p>${message}</p><a href="${APP_URL_DEFAULT}">Ouvrir l'application</a></div></body></html>`;
}

async function handleEmailAction(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const { action, m: missionId, p: prestaId, exp, sig } = req.query || {};
  const SECRET = (process.env.BO_SESSION_SECRET || "").replace(/\s/g, "");

  const isUuidQ = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
  if (!action || !missionId || !prestaId) return res.status(400).send(emailActionHtml("Lien invalide", "Ce lien est incomplet ou corrompu.", "#F25E5E", "❌"));
  if (!["accept","refuse"].includes(action) || !isUuidQ(missionId) || !isUuidQ(prestaId)) return res.status(400).send(emailActionHtml("Lien invalide", "Paramètres incorrects.", "#F25E5E", "❌"));

  // Vérification HMAC — obligatoire. Sans BO_SESSION_SECRET configuré, les liens email sont désactivés.
  if (!SECRET) return res.status(503).send(emailActionHtml("Service non configuré", "BO_SESSION_SECRET n'est pas défini sur ce serveur. Configurez cette variable Vercel pour activer les liens email.", "#F5A623", "⚙️"));
  if (!exp || !sig) return res.status(401).send(emailActionHtml("Lien invalide", "Ce lien ne contient pas de signature de sécurité.", "#F25E5E", "🔒"));
  let sigOk = false;
  try {
    const { createHmac, timingSafeEqual } = await import("crypto");
    const payload2 = `${action}.${missionId}.${prestaId}.${exp}`;
    const expected = createHmac("sha256", SECRET).update(payload2).digest("base64url");
    const bufSig = Buffer.from(sig);
    const bufExp = Buffer.from(expected);
    sigOk = bufSig.length === bufExp.length && timingSafeEqual(bufSig, bufExp);
  } catch (e) { console.error("[email-action] sig verify error:", e.message); }
  if (!sigOk) return res.status(401).send(emailActionHtml("Lien invalide", "Ce lien est invalide ou a été modifié.", "#F25E5E", "🔒"));
  if (Math.floor(Date.now() / 1000) > parseInt(exp, 10)) return res.status(410).send(emailActionHtml("Lien expiré", "Ce lien n'est plus valide (validité 24h). Connectez-vous à l'application pour répondre.", "#F5A623", "⏱"));

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) { res.setHeader("Content-Type","text/html; charset=utf-8"); return res.status(500).send(emailActionHtml("Erreur serveur", "Configuration base de données manquante.", "#F25E5E", "⚠️")); }
  const hdrs = { "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };

  const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}&prestataire_id=eq.${prestaId}&status=eq.pending_acceptance&select=id,client_id,metier,titre,acceptance_deadline,date,heure_debut,hours,stripe_payment_intent,montant_total`, { headers: hdrs });
  const mission = (await mr.json().catch(() => []))[0];
  if (!mission) return res.status(409).send(emailActionHtml("Déjà traité", "Cette prestation a déjà été acceptée, refusée ou annulée.", "#A29BFE", "ℹ️"));

  // Vérification serveur du délai d'acceptation
  if (mission.acceptance_deadline && mission.acceptance_deadline < new Date().toISOString()) {
    await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}`, {
      method: "PATCH",
      headers: { ...hdrs, "Prefer": "return=minimal" },
      // Idem : l'expiration et son remboursement relèvent du cron.
      body: JSON.stringify({ prestataire_id: null }),
    }).catch(() => {});
    return res.status(410).send(emailActionHtml("Délai dépassé", "Le délai de réponse est dépassé. La prestation est de nouveau disponible pour d'autres prestataires.", "#F5A623", "⏱"));
  }

  const missionLabel = mission.titre || mission.metier || "la prestation";

  // Vérification conflit de créneau avant assignation
  if (action === "accept") {
    const conflict = await checkPrestaireConflict(prestaId, mission.date, mission.heure_debut, mission.hours, SUPABASE_URL, hdrs, missionId);
    if (conflict) {
      return res.status(409).send(emailActionHtml(
        "Créneau indisponible",
        `Vous avez déjà une prestation (<strong>${esc(conflict.metier || "autre prestation")}</strong>) sur ce créneau. Contactez ALANE pour régulariser.`,
        "#F5A623", "⚠️"
      ));
    }
  }

  // Même règle que dans l'application : un refus ne renvoie pas la prestation en
  // « open » avec l'argent du client bloqué, il la clôt et déclenche son
  // remboursement.
  const patchBody = action === "accept" ? { status: "assigned" } : { status: "refused", prestataire_id: null };
  if (action !== "accept") {
    const rembMail = await rembourserPrestation(mission, SUPABASE_URL, hdrs, "refus-email");
    if (!rembMail.ok) console.error(`[refus-email] remboursement à reprendre manuellement — prestation ${missionId}`);
  }
  await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${missionId}`, { method: "PATCH", headers: { ...hdrs, "Prefer": "return=minimal" }, body: JSON.stringify(patchBody) });

  if (mission.client_id) {
    const isAccepted = action === "accept";
    await fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method: "POST", headers: { ...hdrs, "Prefer": "return=minimal" }, body: JSON.stringify({ user_id: mission.client_id, type: "mission", title: isAccepted ? "Prestation acceptée ! 🎉" : "Prestation refusée", body: isAccepted ? `Votre prestataire a accepté la prestation "${missionLabel}" depuis son email.` : `Le prestataire a décliné "${missionLabel}". Vous pouvez choisir un autre prestataire.`, read: false, ref_id: missionId }) }).catch(() => {});
    sendPushToUser(mission.client_id, { title: isAccepted ? "Prestation acceptée ✅" : "Prestation refusée", body: isAccepted ? `Votre prestataire a accepté "${missionLabel}".` : `Le prestataire a décliné "${missionLabel}".`, url: "/" }, SUPABASE_URL, hdrs).catch(() => {});
  }

  return res.status(200).send(emailActionHtml(
    action === "accept" ? "Prestation acceptée !" : "Prestation refusée",
    action === "accept" ? `Vous avez accepté la prestation <strong style="color:#fff">${esc(missionLabel)}</strong>. Le client a été notifié.` : `Vous avez décliné la prestation <strong style="color:#fff">${esc(missionLabel)}</strong>.`,
    action === "accept" ? "#10D98F" : "#A29BFE",
    action === "accept" ? "✅" : "👋"
  ));
}

export default async function handler(req, res) {
  // GET → one-click email action (accept/refuse mission from email link)
  if (req.method === "GET") return handleEmailAction(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Rate limiting — 120 req/min par IP
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",").at(-1).trim();
  if (await checkRateLimit(ip)) return res.status(429).json({ error: "Trop de requêtes — réessayez dans une minute" });

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

  const SUPABASE_URL     = (process.env.VITE_SUPABASE_URL || "").replace(/\s/g, "");
  const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").replace(/\s/g, "");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuration serveur manquante" });
  }

  const headers = {
    "apikey":        SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type":  "application/json",
  };

  try {
    if (action === "create_mission") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { sector, metier, date, heure_debut, hours, tarif_horaire, ville, adresse, description, titre } = payload;

      // Validation serveur
      if (!sector || !metier) return res.status(400).json({ error: "Secteur et métier requis" });
      if (!date) return res.status(400).json({ error: "Date requise" });
      const todayStr = new Date().toISOString().slice(0, 10);
      if (date < todayStr) return res.status(400).json({ error: "La date de la prestation ne peut pas être dans le passé" });
      const parsedHours = Number(hours);
      if (!parsedHours || parsedHours <= 0 || parsedHours > 24) return res.status(400).json({ error: "Durée invalide (entre 0.5 et 24h)" });
      const parsedTarif = Number(tarif_horaire);
      if (!parsedTarif || parsedTarif < 1) return res.status(400).json({ error: "Tarif invalide (minimum 1 €/h)" });
      if (!ville) return res.status(400).json({ error: "Ville requise" });

      // Vérifier que le caller est bien un client
      const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=role,status`, { headers });
      const profile = (await profileRes.json().catch(() => []))[0];
      if (!profile || profile.role !== "client") return res.status(403).json({ error: "Réservé aux clients" });
      if (profile.status !== "approved") return res.status(403).json({ error: "Compte non approuvé" });

      const missionData = {
        client_id: caller.id,
        sector, metier, date, heure_debut: heure_debut || null,
        hours: parsedHours, tarif_horaire: parsedTarif,
        ville, adresse: adresse || null,
        description: description || null,
        titre: titre || null,
        status: "open",
      };
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/missions`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=representation", "Accept": "application/json" },
        body: JSON.stringify(missionData),
      });
      if (!insertRes.ok) {
        const err = await insertRes.text().catch(() => "");
        console.error("[create_mission] insert error:", err);
        return res.status(500).json({ error: "Erreur création prestation" });
      }
      const created = await insertRes.json().catch(() => []);
      const mission = Array.isArray(created) ? created[0] : created;
      return res.status(201).json({ success: true, mission });
    }

    if (action === "list_open") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { sector, metier, limit: rawLimit, offset: rawOffset } = payload;
      const pageLimit  = Math.min(Math.max(1, parseInt(rawLimit,  10) || 50), 100);
      const pageOffset = Math.max(0, parseInt(rawOffset, 10) || 0);
      // Exclure les missions dont la date est passée (missions fantômes)
      const todayStr = new Date().toISOString().slice(0, 10);
      let url = `${SUPABASE_URL}/rest/v1/missions?status=in.(open,needs_replacement)&or=(date.gte.${todayStr},date.is.null)&order=created_at.desc&limit=${pageLimit}&offset=${pageOffset}`;
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

      // Remettre en open les missions pending_acceptance dont la deadline est dépassée
      // (fallback si le prestataire ne se reconnecte jamais pour déclencher my_missions)
      const nowIsoLC = new Date().toISOString();
      const expiredPending = missions.filter(m =>
        m.status === "pending_acceptance" && m.acceptance_deadline && m.acceptance_deadline < nowIsoLC
      );
      if (expiredPending.length > 0) {
        await Promise.all(expiredPending.map(async m => {
          await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
            method: "PATCH",
            headers: { ...headers, "Prefer": "return=minimal" },
            // Statut volontairement inchangé : l'expiration d'une prestation payée
            // implique un remboursement, et cette écriture-là appartient au cron
            // (cron-reset-monthly), seul endroit où la logique d'argent est tenue.
            // La laisser ici renvoyait la prestation en « open » sans rembourser.
            body: JSON.stringify({ prestataire_id: null }),
          }).catch(() => {});
          m.status = "open";
          m.prestataire_id = null;
        }));
      }

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

      // ── Auto-validation après 24h (fallback si le cron Vercel n'est pas actif) ──
      const nowTs = Date.now();
      const toAutoValidate = missions.filter(m => {
        if (m.status !== "assigned" || !m.validation_prestataire) return false;
        if (!m.date) return false;
        const [h = 8, mn = 0] = (m.heure_debut || "08:00").split(":").map(Number);
        // heure_debut est en heure locale française — Vercel tourne en UTC
        const naiveMs = new Date(`${m.date}T${String(h).padStart(2,"0")}:${String(mn).padStart(2,"0")}:00`).getTime();
        const offsetMs = (() => {
          const d = new Date(naiveMs), y = d.getUTCFullYear();
          const dstStart = new Date(Date.UTC(y,2,31)); dstStart.setUTCDate(31-dstStart.getUTCDay()); dstStart.setUTCHours(1,0,0,0);
          const dstEnd   = new Date(Date.UTC(y,9,31)); dstEnd.setUTCDate(31-dstEnd.getUTCDay());     dstEnd.setUTCHours(1,0,0,0);
          return (d >= dstStart && d < dstEnd) ? -7200000 : -3600000;
        })();
        const missionEndMs = naiveMs + offsetMs + Number(m.hours || 1) * 3600000;
        return nowTs - missionEndMs >= 24 * 3600000;
      });

      if (toAutoValidate.length > 0) {
        await Promise.all(toAutoValidate.map(async m => {
          try {
            const hours = m.actual_hours ?? m.hours ?? 0;
            const montantTotal = Math.round(Number(hours) * Number(m.tarif_horaire || 0) * 100) / 100;
            await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${m.id}`, {
              method: "PATCH",
              headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify({ status: "completed", validation_client: true, validation_prestataire: true, montant_total: montantTotal || m.montant_total }),
            });
            // Mettre à jour le statut local pour que la réponse reflète déjà la validation
            m.status = "completed";
            m.validation_client = true;
            m.montant_total = montantTotal || m.montant_total;
            // Créditer le cashback client (même logique que l'action complete)
            if (m.client_id && montantTotal > 0) {
              try {
                const pr2 = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${m.client_id}&select=missions_completed_month`, { headers });
                const pr2Data = pr2.ok ? await pr2.json().catch(() => []) : [];
                const clientProfile = Array.isArray(pr2Data) && pr2Data[0];
                const missionsThisMonth = (clientProfile?.missions_completed_month || 0) + 1;
                const CASHBACK_TIERS = [
                  { min: 0,  max: 2,   rate: 0.005  },
                  { min: 3,  max: 5,   rate: 0.0075 },
                  { min: 6,  max: 9,   rate: 0.01   },
                  { min: 10, max: 999, rate: 0.015  },
                ];
                const rate = [...CASHBACK_TIERS].reverse().find(t => missionsThisMonth >= t.min)?.rate || 0.01;
                const cashbackEarned = Math.round(montantTotal * rate * 100) / 100;
                await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_cashback`, {
                  method: "POST",
                  headers: { ...headers, "Prefer": "return=minimal" },
                  body: JSON.stringify({ p_user_id: m.client_id, p_delta: cashbackEarned, p_missions: 1 }),
                }).catch(() => {});
                if (cashbackEarned > 0) {
                  fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                    method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
                    body: JSON.stringify({ user_id: m.client_id, type: "cashback", title: `+${cashbackEarned.toFixed(2).replace(".", ",")} € de cashback 🎁`, body: `Votre prestation "${m.metier || "la prestation"}" a été validée automatiquement. Cashback crédité.`, read: false }),
                  }).catch(() => {});
                }
              } catch (e2) { console.error(`auto-validate cashback ${m.id}:`, e2.message); }
            }
            // Notifier le prestataire
            if (m.prestataire_id) {
              fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({ user_id: m.prestataire_id, type: "mission", title: "Prestation validée automatiquement ✅", body: `Votre prestation "${m.metier || "la prestation"}" a été validée automatiquement (délai 24h dépassé). Votre paiement est en cours.`, read: false }),
              }).catch(() => {});
            }
          } catch (e) { console.error(`auto-validate mission ${m.id}:`, e.message); }
        }));
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
      // Notes moyennes par prestataire
      const ratingMap = {};
      if (prestaIds.length > 0) {
        try {
          const rRes = await fetch(`${SUPABASE_URL}/rest/v1/ratings?reviewee_provider_id=in.(${prestaIds.join(",")})&select=reviewee_provider_id,rating`, { headers });
          const rData = await rRes.json().catch(() => []);
          if (Array.isArray(rData)) {
            const grouped = {};
            rData.forEach(r => { if (!grouped[r.reviewee_provider_id]) grouped[r.reviewee_provider_id] = []; grouped[r.reviewee_provider_id].push(r.rating); });
            Object.keys(grouped).forEach(id => {
              const rats = grouped[id];
              ratingMap[id] = { avg: Math.round(rats.reduce((s, v) => s + v, 0) / rats.length * 10) / 10, count: rats.length };
            });
          }
        } catch {}
      }

      const enriched = candidatures.map(c => ({
        ...c,
        prenom:  nameMap[c.prestataire_id]?.prenom || "",
        nom:     nameMap[c.prestataire_id]?.nom    || "",
        rating:  ratingMap[c.prestataire_id]?.avg  || 0,
        reviews: ratingMap[c.prestataire_id]?.count || 0,
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
      if (!Array.isArray(candCheckData) || !candCheckData[0]) return res.status(403).json({ error: "Candidature invalide pour cette prestation" });
      // Utiliser le prestataire_id de la candidature, jamais celui du payload (évite l'assignation à un tiers)
      const verified_prestataire_id = candCheckData[0].prestataire_id;

      // Vérifier la limite mensuelle du prestataire avant l'assignation
      if (verified_prestataire_id && isUuid(verified_prestataire_id)) {
        const limitOk = await (async () => {
          try {
            const [urRes, prRes] = await Promise.all([
              fetch(`${SUPABASE_URL}/auth/v1/admin/users/${verified_prestataire_id}`, { headers }),
              fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${verified_prestataire_id}&select=missions_completed_month,trial_exhausted,plan_abonnement`, { headers }),
            ]);
            const urData = await urRes.json();
            const prData = await prRes.json();
            const prDataProfile = Array.isArray(prData) && prData[0];
            // profiles.plan_abonnement prioritaire — écrit en premier par le webhook Stripe
            // Le plan vient de `profiles`, jamais de user_metadata. À l'inscription,
            // le prestataire choisit son abonnement d'un simple appui — Premium ou Elite —
            // et cette valeur était écrite telle quelle dans user_metadata. Comme
            // `profiles.plan_abonnement` restait vide tant qu'aucun paiement n'avait eu
            // lieu, le repli sur user_metadata accordait le quota Elite (999 prestations)
            // à qui ne l'avait jamais payé. Seul le webhook Stripe renseigne `profiles`.
            let plan = prDataProfile?.plan_abonnement || "free";
            const endDate = urData.user_metadata?.subscription_end_date;
            const endDateMs = endDate ? new Date(endDate).getTime() : NaN;
            if (!isNaN(endDateMs) && plan !== "free" && endDateMs < Date.now()) {
              plan = "free";
              await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${verified_prestataire_id}`, { method:"PUT", headers, body: JSON.stringify({ user_metadata: { plan_abonnement:"free", subscription_end_date:null } }) }).catch(()=>{});
              await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${verified_prestataire_id}`, { method:"PATCH", headers:{ ...headers, "Prefer":"return=minimal" }, body: JSON.stringify({ plan_abonnement:"free" }) }).catch(()=>{});
            }

            const trialExhausted = Array.isArray(prData) && prData[0]?.trial_exhausted === true;
            const basePlanLimit = await limitePlanMensuelle(plan, verified_prestataire_id, SUPABASE_URL, headers);
            const limit = (trialExhausted && plan === "free") ? 0 : basePlanLimit;
            if (limit < 999) {
              // RPC atomique : FOR UPDATE sur la ligne profile pour éviter la race condition
              const slotRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_prestataire_slot`, {
                method: "POST", headers,
                body: JSON.stringify({ p_prestataire_id: verified_prestataire_id, p_limit: limit }),
              });
              const slots = slotRes.ok ? (await slotRes.json().catch(() => 0)) : 0;
              if (slots <= 0) return { error: `Limite atteinte — le prestataire a atteint sa limite de ${limit} prestation${limit > 1 ? "s" : ""}/mois pour son plan ${plan}.`, limit_reached: true };
            }
            return null;
          } catch { return { error: "Erreur vérification limite plan", limit_reached: false }; }
        })();
        if (limitOk) return res.status(403).json(limitOk);
      }

      // Vérifier si la mission a déjà un paiement Stripe — inclure status pour éviter double PaymentIntent
      // B-07: on utilise mission.tarif_horaire (fixé à la création) et non tarif_net du prestataire
      const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
      const mCheckRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=stripe_payment_intent,hours,tarif_horaire,client_id,status,metier,titre,date,heure_debut`, { headers });
      const mCheckData = await mCheckRes.json();
      const missionCheck = Array.isArray(mCheckData) && mCheckData[0];
      if (missionCheck && missionCheck.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      // Refus si déjà assignée : évite la création de double PaymentIntent en cas de requêtes concurrentes
      if (missionCheck && ["assigned","completed","closed","cancelled"].includes(missionCheck.status)) {
        return res.status(409).json({ error: "La prestation a déjà été assignée ou fermée" });
      }

      // Vérification conflit de créneau pour le prestataire avant de lancer le paiement
      if (verified_prestataire_id && missionCheck) {
        const conflict = await checkPrestaireConflict(verified_prestataire_id, missionCheck.date, missionCheck.heure_debut, missionCheck.hours, SUPABASE_URL, headers, mission_id);
        if (conflict) {
          return res.status(409).json({ error: `Ce prestataire a déjà une prestation assignée sur ce créneau (${missionCheck.date} ${missionCheck.heure_debut || ""}). Choisissez un autre prestataire.` });
        }
      }

      // Si un PaymentIntent existe déjà, vérifier son statut avant d'en créer un nouveau
      if (missionCheck && missionCheck.stripe_payment_intent && STRIPE_SECRET_KEY) {
        try {
          const piCheckRes = await fetch(`https://api.stripe.com/v1/payment_intents/${missionCheck.stripe_payment_intent}`, {
            headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` },
          });
          // Si Stripe retourne une erreur HTTP, bloquer — ne jamais assigner sans paiement
          if (!piCheckRes.ok) {
            console.error("[accept] Stripe PI check HTTP error:", piCheckRes.status);
            return res.status(503).json({ error: "Impossible de vérifier le paiement — réessayez dans quelques secondes" });
          }
          const piData = await piCheckRes.json();
          if (piData.status === "succeeded") {
            return res.status(409).json({ error: "Paiement déjà confirmé — la prestation sera bientôt assignée automatiquement" });
          }
          if (piData.client_secret && ["requires_payment_method", "requires_confirmation", "requires_action"].includes(piData.status)) {
            // Réutiliser le PI existant — le client peut réessayer le paiement
            return res.status(200).json({ payment_required: true, client_secret: piData.client_secret, amount: piData.amount / 100 });
          }
          // PI annulé ou invalide — réinitialiser pour créer un nouveau
          await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
            method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({ stripe_payment_intent: null }),
          }).catch(() => {});
          missionCheck.stripe_payment_intent = null;
        } catch (piErr) {
          // Erreur réseau → bloquer — ne pas assigner la mission sans vérifier le paiement
          console.error("[accept] PI status check failed:", piErr.message);
          return res.status(503).json({ error: "Impossible de vérifier le paiement — réessayez dans quelques secondes" });
        }
      }

      if (missionCheck && !missionCheck.stripe_payment_intent && STRIPE_SECRET_KEY) {
        // P-01: tarif_horaire = 0 → refuser la création du PaymentIntent
        const missionTarif = Number(missionCheck.tarif_horaire) || 0;
        if (missionTarif <= 0) return res.status(400).json({ error: "Tarif horaire non défini sur cette prestation — impossible de créer le paiement" });
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

      // Assigner la mission — condition sur status pour éviter la double-assignation en mode urgence
      // (si deux requêtes accept arrivent simultanément, une seule réussira)
      const missionPatch = { status: "assigned" };
      if (verified_prestataire_id) missionPatch.prestataire_id = verified_prestataire_id;
      const assignRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=not.in.(assigned,completed,closed,cancelled)`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation", "Content-Type": "application/json" },
        body: JSON.stringify(missionPatch),
      });
      const assignedRows = await assignRes.json().catch(() => []);
      if (!Array.isArray(assignedRows) || assignedRows.length === 0) {
        return res.status(409).json({ error: "Prestation déjà assignée à un autre prestataire" });
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

      // Notification au prestataire
      if (verified_prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: verified_prestataire_id,
            type: "mission",
            title: "Proposition acceptée ✅",
            body: "Votre proposition a été acceptée ! Préparez-vous pour la prestation.",
            read: false,
          }),
        });
        sendPushToUser(verified_prestataire_id, { title: "Proposition acceptée ✅", body: "Votre proposition a été acceptée ! Préparez-vous pour la prestation.", url: "/" }, SUPABASE_URL, headers).catch(() => {});
      }

      // Email de confirmation au client (awaité pour éviter la coupure Vercel avant envoi)
      const RESEND_API_KEY_AC = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
      const RESEND_FROM_AC    = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
      if (RESEND_API_KEY_AC && missionCheck?.client_id) {
        try {
          const clientAuthRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${missionCheck.client_id}`, { headers });
          const clientAuth = clientAuthRes.ok ? await clientAuthRes.json().catch(() => null) : null;
          const clientEmail = clientAuth?.email;
          if (clientEmail) {
            const clientPrenom = clientAuth?.user_metadata?.prenom || "";
            const mLabel = esc(missionCheck.titre || missionCheck.metier || "votre prestation");
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Authorization": `Bearer ${RESEND_API_KEY_AC}`, "Content-Type": "application/json" },
              body: resendBody({
                from: RESEND_FROM_AC,
                to: clientEmail,
                subject: `✅ Un prestataire a été assigné à votre prestation — ALANE`,
                html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#050E20;color:#fff;padding:32px;border-radius:16px">
  <h2 style="color:#10D98F;margin:0 0 16px">Prestataire assigné ✅</h2>
  <p style="color:rgba(255,255,255,0.85);line-height:1.6;margin-bottom:12px">Bonjour${clientPrenom ? " " + esc(clientPrenom) : ""},</p>
  <p style="color:rgba(255,255,255,0.85);line-height:1.6">Un prestataire a été assigné à <strong style="color:#F0B429">${mLabel}</strong>. Vous serez notifié(e) lorsque la prestation sera terminée et validée.</p>
  <p style="color:rgba(255,255,255,0.5);font-size:13px;margin-top:20px">Suivez l'avancement depuis votre espace ALANE.</p>
  <p style="color:rgba(255,255,255,0.3);font-size:12px;margin-top:24px">© ALANE — Cet email est envoyé automatiquement, merci de ne pas y répondre.</p>
</div>`,
              }),
            }).catch(e => console.error("[accept] Resend failed:", e.message));
          }
        } catch (e) { console.error("[accept] email client failed:", e.message); }
      }

      return res.status(200).json({ success: true });
    }

    if (action === "complete") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id } = payload;
      const client_id = caller.id;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      // Récupérer la mission pour avoir hours, tarif_horaire et prestataire_id
      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=hours,tarif_horaire,status,prestataire_id,metier,sector,client_id,validation_prestataire,recurrence,date,date_debut,date_fin,ville,adresse,description,heure_debut,actual_hours,arrival_delay_minutes,delay_status,stripe_payment_intent,montant_total`, { headers });
      const missions = await mr.json();
      const mission = Array.isArray(missions) && missions[0];
      if (!mission) return res.status(404).json({ error: "Prestation introuvable" });
      if (mission.client_id !== client_id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "assigned") return res.status(400).json({ error: "Prestation non assignée" });
      if (!mission.stripe_payment_intent) return res.status(400).json({ error: "Aucun paiement Stripe enregistré pour cette prestation — impossible de valider" });
      if (!mission.validation_prestataire) return res.status(400).json({ error: "Le prestataire n'a pas encore confirmé la fin de prestation" });

      let heuresEffectives = mission.actual_hours ?? mission.hours ?? 0;
      const tarifHoraire     = mission.tarif_horaire || 0;

      // Décalage jamais arbitré par le client : la prestation est facturée jusqu'à
      // l'heure de fin initialement prévue. Le champ était lu ici sans être utilisé —
      // un client qui n'avait rien accepté payait quand même les heures pleines.
      // Un refus explicite (`rejected`) a déjà ajusté `hours` et `actual_hours`.
      let ajustementRetard = null;
      if (mission.delay_status === "pending") {
        const retardH = (Number(mission.arrival_delay_minutes) || 0) / 60;
        const plafonnees = Math.max(0, Math.round((Number(mission.hours || 0) - retardH) * 100) / 100);
        if (plafonnees < heuresEffectives) {
          console.log(`[complete] décalage non accepté sur ${mission_id} : ${heuresEffectives}h ramenées à ${plafonnees}h`);
          // Conservé pour prévenir le prestataire : un ajustement appliqué en
          // silence, sans que l'intéressé sache pourquoi ni puisse répondre, est
          // exactement ce qui distingue une sanction d'un ajustement de prix.
          ajustementRetard = { avant: heuresEffectives, apres: plafonnees, retard: Number(mission.arrival_delay_minutes) || 0 };
          heuresEffectives = plafonnees;
        }
      }

      // Nombre de jours de la mission (missions multi-dates : 1 jour = 1 mission au compteur)
      const missionDayCount = (mission.date_debut && mission.date_fin)
        ? Math.max(1, Math.round((new Date(mission.date_fin) - new Date(mission.date_debut)) / 86400000) + 1)
        : 1;

      // Part revenant au prestataire : tarif × heures × JOURS.
      //
      // Le nombre de jours était omis. Sur une prestation récurrente de 5 jours, le
      // prestataire recevait donc une seule journée — 112 € au lieu de 560 € — et la
      // valeur écrasait `montant_total`, effaçant du même coup la trace de ce que le
      // client avait réellement payé. Le cashback, la facture et un éventuel
      // remboursement se calculaient ensuite tous sur ce montant amputé.
      const partPrestataire = Math.round(heuresEffectives * tarifHoraire * missionDayCount * 100) / 100;

      if (partPrestataire <= 0) {
        console.error(`[complete] montant nul — prestation ${mission_id} heures=${heuresEffectives} tarif=${tarifHoraire} jours=${missionDayCount}`);
        return res.status(400).json({ error: "Le montant de la prestation est nul ou invalide — contactez le support pour finaliser manuellement." });
      }

      // Total facturé au client : la part horaire plus les frais de service réellement
      // encaissés. Ces frais se déduisent de ce qui a été payé à la réservation, ce qui
      // évite de reproduire ici la grille tarifaire du tunnel. Ils sont conservés même
      // si la durée réelle diffère de la durée prévue — ils rémunèrent la mise en
      // relation, pas les heures.
      const totalPaye    = Number(mission.montant_total || 0);
      const partPrevue   = Math.round((Number(mission.hours) || 0) * tarifHoraire * missionDayCount * 100) / 100;
      const fraisService = (partPrevue > 0 && totalPaye > partPrevue)
        ? Math.round((totalPaye - partPrevue) * 100) / 100
        : 0;
      const totalClient  = Math.round((partPrestataire + fraisService) * 100) / 100;

      // Récupérer le palier cashback du client (missions_completed_month)
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${client_id}&select=cashback_balance,missions_completed_month`, { headers });
      const profiles = await pr.json();
      const profile = Array.isArray(profiles) && profiles[0];
      const missionsThisMonth = (profile?.missions_completed_month || 0) + missionDayCount;

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
      } catch {
        // Catch volontairement vide (règle CLAUDE.md 1.2) : la grille par défaut
        // ci-dessus est identique à celle de src/constants/plans.js. Si la lecture
        // de platform_settings échoue, on crédite donc le taux nominal plutôt que
        // de faire échouer la clôture de mission — le prestataire serait bloqué.
      }
      const rate = [...CASHBACK_TIERS].reverse().find(t => missionsThisMonth >= t.min)?.rate || 0.01;
      const cashbackEarned = Math.round(partPrestataire * rate * 100) / 100;
      const newBalance = Math.round(((profile?.cashback_balance || 0) + cashbackEarned) * 100) / 100;

      // Marquer mission completed — condition sur status=assigned pour éviter le double-crédit en cas de requête concurrente
      const completePatchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=eq.assigned`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation", "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", montant_total: totalClient, validation_client: true }),
      });
      const completedRows = await completePatchRes.json().catch(() => []);
      if (!Array.isArray(completedRows) || completedRows.length === 0) {
        return res.status(409).json({ error: "Prestation déjà validée" });
      }

      // Mise à jour atomique du cashback via RPC — p_missions = nombre de jours (multi-dates)
      let rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_cashback`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({ p_user_id: client_id, p_delta: cashbackEarned, p_missions: missionDayCount }),
      });
      // Retry une fois si échec réseau (503/504)
      if (!rpcRes.ok && [503, 504].includes(rpcRes.status)) {
        await new Promise(r => setTimeout(r, 800));
        rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_cashback`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=representation" },
          body: JSON.stringify({ p_user_id: client_id, p_delta: cashbackEarned, p_missions: missionDayCount }),
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
          title: "Prestation validée ✅",
          body: cashbackEarned > 0 && rpcRes.ok
            ? `Votre prestation a été validée. Cashback : +${cashbackEarned.toFixed(2)} € (solde : ${atomicBalance.toFixed ? atomicBalance.toFixed(2) : atomicBalance} €)`
            : "Votre prestation a été validée avec succès.",
          read: false,
        }),
      }).catch(() => {});

      // Le prestataire est informé de l'ajustement de durée, avec les chiffres et
      // une voie de contestation. Sans cela, il découvrirait un montant réduit sans
      // explication : c'est le silence, plus que l'ajustement lui-même, qui donne au
      // mécanisme l'allure d'une sanction.
      if (ajustementRetard && mission.prestataire_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: mission.prestataire_id,
            type: "mission",
            title: "Durée facturée ajustée ⏱",
            body: `La prestation « ${mission.metier || mission.sector || ""} » a démarré avec `
              + `${ajustementRetard.retard} min de décalage, non arbitré par le client. `
              + `${ajustementRetard.apres} h ont été facturées au lieu de ${ajustementRetard.avant} h, `
              + `soit le temps effectivement réalisé. Si ce décalage ne vous est pas imputable, `
              + `écrivez à direction@alane.fr : la prestation sera réexaminée.`,
            read: false,
          }),
        }).catch(() => {});
      }

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
              title: "🔄 Prestation récurrente planifiée",
              body: `Votre prochaine prestation ${mission.metier || mission.sector || ""} (${recurrenceLabel}) a été programmée pour le ${nextDateStr}.`,
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
            title: "Prestation validée ✅",
            body: `Votre prestation "${mission.metier || mission.sector || ""}" a été validée. Votre paiement de ${partPrestataire.toFixed(2)} € est en cours de traitement.`,
            read: false,
          }),
        }).catch(() => {});

        const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
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
                body: resendBody({
                  from: RESEND_FROM,
                  to: prestaEmail,
                  subject: "Prestation validée — votre paiement est en cours 💰",
                  html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
                    <h2 style="color:#A29BFE;margin:0 0 12px">Prestation validée ✅</h2>
                    <p>Bonjour ${esc(prestaName)},</p>
                    <p>Le client a validé votre prestation <strong>${esc(mission.metier || mission.sector || "")}</strong>.</p>
                    <p>Votre paiement de <strong style="color:#A29BFE">${partPrestataire.toFixed(2)} €</strong> a été initié automatiquement et sera versé sur votre IBAN sous 1 à 2 jours ouvrés.</p>
                    <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
                  </div>`,
                }),
              }).catch(() => {});
            }
          } catch {}
        }
      }

      // Virement automatique Stripe Connect
      const STRIPE_SK_PAYOUT = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
      const COMMISSION = parseFloat(process.env.PLATFORM_COMMISSION_RATE || "0");
      if (STRIPE_SK_PAYOUT && partPrestataire > 0 && mission.prestataire_id) {
        try {
          const ppRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${mission.prestataire_id}&select=stripe_account_id,stripe_account_status`, { headers });
          const ppData = await ppRes.json();
          const pp = Array.isArray(ppData) && ppData[0];
          if (pp?.stripe_account_id && pp.stripe_account_status === "enabled") {
            const netCents = Math.round(partPrestataire * (1 - COMMISSION) * 100);
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
          // Récupérer le compteur actuel du prestataire et son plan. La lecture de
          // user_metadata a été retirée : elle ne servait qu'au repli sur le plan
          // qu'elle annonce, désormais sans valeur — un appel de moins à l'API Auth.
          const prMonthRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${mission.prestataire_id}&select=missions_completed_month,trial_exhausted,plan_abonnement`, { headers });
          const prMonthData = await prMonthRes.json();
          const prProfile = Array.isArray(prMonthData) && prMonthData[0];
          if (prProfile && !prProfile.trial_exhausted) {
            const newCount = (prProfile.missions_completed_month || 0) + missionDayCount;
            // Le plan vient de `profiles`, jamais de user_metadata. À l'inscription,
            // le prestataire choisit son abonnement d'un simple appui — Premium ou Elite —
            // et cette valeur était écrite telle quelle dans user_metadata. Comme
            // `profiles.plan_abonnement` restait vide tant qu'aucun paiement n'avait eu
            // lieu, le repli sur user_metadata accordait le quota Elite (999 prestations)
            // à qui ne l'avait jamais payé. Seul le webhook Stripe renseigne `profiles`.
            const plan = prProfile?.plan_abonnement || "free";

            // Limite du plan, offre de lancement comprise — la même que celle
            // appliquée à l'acceptation, sinon le compteur marque « épuisé » avant
            // la limite réellement opposée au prestataire.
            const planLimit = await limitePlanMensuelle(plan, mission.prestataire_id, SUPABASE_URL, headers);

            const patchBody = { missions_completed_month: newCount };
            let justExhausted = false;
            // Si le prestataire est en plan free et vient d'atteindre sa limite → marquer trial_exhausted
            if (plan === "free" && newCount >= planLimit) {
              patchBody.trial_exhausted = true;
              justExhausted = true;
              console.log(`[complete] Prestataire ${mission.prestataire_id} a atteint sa limite free (${newCount}/${planLimit}) — trial_exhausted=true`);
            }
            await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${mission.prestataire_id}`, {
              method: "PATCH",
              headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify(patchBody),
            }).catch(e => console.error("[complete] prestataire missions_completed_month update error:", e.message));
            // Notifier le prestataire qu'il a épuisé son quota gratuit
            if (justExhausted) {
              await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                method: "POST",
                headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({
                  user_id: mission.prestataire_id,
                  type: "system",
                  title: "⛔ Quota mensuel épuisé",
                  body: `Vous avez atteint votre limite de ${planLimit} prestation${planLimit > 1 ? "s" : ""} gratuites ce mois-ci. Passez Premium pour continuer à accepter des prestations.`,
                  read: false,
                }),
              }).catch(() => {});
            }
          }
        } catch (e) {
          console.error("[complete] prestataire slot tracking error:", e.message);
        }
      }

      return res.status(200).json({ success: true, montantTotal: partPrestataire, totalClient, cashbackEarned, newBalance });
    }

    if (action === "dispute") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, message } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      // Cette validation manquait ici, seule action à en être dépourvue, alors que
      // l'identifiant part directement dans une URL PostgREST.
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,status,client_id,prestataire_id,metier,sector,date,heure_debut,hours,started_at`, { headers });
      const missions = await mr.json();
      const mission = Array.isArray(missions) && missions[0];
      if (!mission) return res.status(404).json({ error: "Prestation introuvable" });
      if (mission.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "completed") return res.status(400).json({ error: "La prestation doit être terminée pour signaler un litige" });

      // Délai de contestation de 48 h, imposé par les CGPS : « Au-delà de 48 heures
      // sans signalement par le Client, la Prestation est réputée définitivement
      // validée […] et aucune contestation ne pourra être acceptée. » Rien ne
      // l'appliquait : une prestation terminée depuis des mois restait contestable,
      // et la garantie donnée au prestataire n'en était pas une.
      //
      // Le point de départ est « la fin effective de la prestation », comme l'écrit
      // le contrat : le pointage réel s'il existe, sinon l'horaire prévu.
      const finPrestationMs = (() => {
        const dureeMs = Math.max(1, Number(mission.hours) || 1) * 3600000;
        if (mission.started_at) {
          const debut = new Date(mission.started_at).getTime();
          if (!isNaN(debut)) return debut + dureeMs;
        }
        if (!mission.date) return null;
        const naive = new Date(`${mission.date}T${mission.heure_debut || "08:00"}:00`);
        if (isNaN(naive.getTime())) return null;
        return naive.getTime() + frenchOffsetMs(naive) + dureeMs;
      })();
      if (finPrestationMs) {
        const depasseMs = Date.now() - (finPrestationMs + 48 * 3600000);
        if (depasseMs > 0) {
          const joursEcoules = Math.floor((Date.now() - finPrestationMs) / 86400000);
          console.error(`[dispute] hors délai sur ${mission_id} : ${joursEcoules} jour(s) depuis la fin`);
          return res.status(400).json({
            error: "Le délai de contestation de 48 h après la fin de la prestation est écoulé. "
                 + "Écrivez à direction@alane.fr si la situation le justifie.",
          });
        }
      } else {
        // Sans date exploitable, on ne bloque pas : refuser un litige légitime serait
        // pire que d'en accepter un tardif. Journalisé pour que ce cas soit visible.
        console.error(`[dispute] délai de 48 h non vérifiable sur ${mission_id} (date absente)`);
      }

      // Passer la prestation en litige. Le résultat était ignoré : un refus laissait
      // la prestation en « completed » alors que le client lisait « Signalement
      // envoyé » — le litige n'existait alors nulle part (règle 1.2). Le filtre sur
      // le statut évite aussi deux signalements concurrents.
      const patchLitige = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=eq.completed`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({ status: "disputed" }),
      });
      const litigeRows = await patchLitige.json().catch(() => []);
      if (!patchLitige.ok || !Array.isArray(litigeRows) || litigeRows.length === 0) {
        console.error(`[dispute] passage en litige refusé pour ${mission_id} : ${patchLitige.status}`);
        return res.status(409).json({ error: "Ce signalement n'a pas pu être enregistré — la prestation a peut-être changé d'état. Rechargez la page." });
      }

      // Ticket de support. Son échec était également ignoré : le backoffice liste les
      // prestations en litige, le litige ne disparaissait donc pas complètement, mais
      // le message du client — le seul élément qui explique le problème — était perdu.
      const ticketRes = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          subject: "Litige — " + (mission.metier || mission.sector || "Prestation"),
          message: message || "Contestation de la qualité de la prestation",
          user_id: caller.id,
          status: "open",
        }),
      });
      if (!ticketRes.ok) {
        const txt = await ticketRes.text().catch(() => "");
        console.error(`[dispute] ticket de support non créé pour ${mission_id} : ${ticketRes.status} ${txt}`);
      }

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
      if (!mission) return res.status(404).json({ error: "Prestation introuvable" });
      if (mission.prestataire_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "assigned") return res.status(400).json({ error: "Prestation non assignée" });
      if (mission.validation_prestataire) return res.status(400).json({ error: "Vous avez déjà confirmé la fin de cette prestation" });
      if (mission.date) {
        const [h, mn] = (mission.heure_debut || "08:00").split(":").map(Number);
        // heure_debut is stored as French local time (e.g. "14:00" = 14h CEST).
        // Vercel runs in UTC, so new Date("...T14:00:00") parses as 14:00 UTC (naive, 2h too late).
        // frenchOffsetMs returns the NEGATIVE UTC offset: -7200000 in summer, -3600000 in winter.
        // To convert French local → UTC: UTC = naive + frenchOffsetMs (adds a negative = subtracts).
        const missionStartNaive = new Date(`${mission.date}T${String(h).padStart(2,"0")}:${String(mn||0).padStart(2,"0")}:00`);
        const missionStartUTC = new Date(missionStartNaive.getTime() + frenchOffsetMs(missionStartNaive));
        const missionEndUTC = new Date(missionStartUTC.getTime() + Math.ceil(mission.hours || 1) * 3600000 - 15 * 60000);
        if (missionEndUTC > new Date()) return res.status(400).json({ error: "Vous ne pouvez pas confirmer une prestation qui n'est pas encore terminée" });
      }

      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&validation_prestataire=is.false`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation", "Accept": "application/json" },
        body: JSON.stringify({ validation_prestataire: true, contrat_presta_signe_at: contrat_presta_signe_at || new Date().toISOString() }),
      });
      const validatedRows = await patchRes.json().catch(() => []);
      if (!Array.isArray(validatedRows) || validatedRows.length === 0) {
        return res.status(400).json({ error: "La fin de prestation a déjà été confirmée — vérifiez votre espace." });
      }

      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          user_id: mission.client_id,
          type: "mission",
          title: "Prestation à valider ✅",
          body: `Le prestataire a confirmé la fin de prestation "${mission.metier || mission.sector || ""}". Validez-la depuis votre espace pour débloquer son paiement.`,
          read: false,
        }),
      }).catch(() => {});

      // Notification de confirmation au prestataire
      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          user_id: mission.prestataire_id,
          type: "mission",
          title: "Prestation confirmée 👍",
          body: `Votre fin de prestation "${mission.metier || mission.sector || ""}" a bien été enregistrée. En attente de validation client pour déclencher votre paiement.`,
          read: false,
        }),
      }).catch(() => {});

      // Send email to client (awaited — Vercel kills fire-and-forget before it completes)
      try {
        const clientUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${mission.client_id}`, { headers });
        const clientUser = await clientUserRes.json();
        const clientEmail = clientUser?.email;
        const clientName = clientUser?.user_metadata?.prenom || clientUser?.user_metadata?.nom || "";
        const metier = esc(mission.metier || mission.sector || "Prestation");
        const missionDate = esc(mission.date || "");
        const ville = esc(mission.ville || "");
        const appUrl = (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr";
        const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
        if (clientEmail && RESEND_API_KEY) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_API_KEY}` },
            body: resendBody({
              from: process.env.RESEND_FROM || "onboarding@resend.dev",
              to: clientEmail,
              subject: `✅ Validez la fin de prestation — ${metier} · ALANE`,
              html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0A1628;color:#fff;padding:0;border-radius:20px;overflow:hidden">
                <div style="background:linear-gradient(135deg,#1a2d5a,#0D1B3E);padding:32px 32px 24px">
                  <div style="font-size:28px;margin-bottom:8px">✅</div>
                  <h2 style="color:#A29BFE;margin:0 0 4px;font-size:20px;font-weight:800">Prestation à valider</h2>
                  <p style="margin:0;color:rgba(255,255,255,0.5);font-size:13px">ALANE · Plateforme de prestations</p>
                </div>
                <div style="padding:28px 32px">
                  ${clientName ? `<p style="margin:0 0 16px;color:rgba(255,255,255,0.85);font-size:15px">Bonjour ${clientName},</p>` : ""}
                  <p style="margin:0 0 20px;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.6">
                    Le prestataire a confirmé la fin de la prestation. Vous avez <strong style="color:#F0B429">24h pour valider</strong> depuis votre espace. Passé ce délai, la prestation sera validée automatiquement.
                  </p>
                  <div style="background:#0D1B3E;border:1px solid rgba(162,155,254,0.15);border-radius:14px;padding:18px;margin-bottom:24px">
                    <div style="font-size:12px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:12px">Détails de la prestation</div>
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
                    Valider la prestation →
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

    // Affectation d'un prestataire à une prestation dont le paiement vient d'aboutir.
    // Le front faisait ce PATCH lui-même : c'est précisément ce qu'interdit le
    // trigger prevent_missions_field_tampering (audit B-01), d'où l'échec
    // « Erreur lors de l'affectation de la prestation » alors que le paiement
    // était encaissé. L'écriture se fait donc ici, en service role, après
    // vérification que l'appelant est bien le client de cette prestation.
    if (action === "assign_after_payment") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, prestataire_id, acceptance_deadline, stripe_payment_intent } = payload;
      if (!mission_id || !isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      if (!prestataire_id || !isUuid(prestataire_id)) return res.status(400).json({ error: "prestataire_id invalide" });

      const mRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id,status,prestataire_id`, { headers });
      const mData = await mRes.json().catch(() => []);
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Prestation introuvable" });
      if (mission.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (!["open", "pending_acceptance"].includes(mission.status)) {
        return res.status(409).json({ error: "Cette prestation a déjà été traitée" });
      }

      // Le secteur doit être ouvert aux clients. Le backoffice annonce « les secteurs
      // désactivés sont masqués pour les clients » alors que la clé `disabled_sectors`
      // n'était lue nulle part : un secteur fermé restait réservable.
      const mSecRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=sector`, { headers });
      const secteurMission = ((await mSecRes.json().catch(() => []))[0] || {}).sector;
      if (secteurMission) {
        const fermes = await secteursDesactives(SUPABASE_URL, headers);
        if (fermes.includes(secteurMission)) {
          return res.status(400).json({ error: "Ce secteur n'est pas encore ouvert aux réservations." });
        }
      }

      // Le prestataire doit exister, être approuvé, et avoir accès aux prestations.
      // `missions_enabled` est le second verrou du backoffice, posé après vérification
      // des documents : il n'était lu que par l'interface du prestataire, si bien qu'un
      // compte non activé restait réservable par un client.
      const pRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${prestataire_id}&role=eq.prestataire&status=eq.approved&select=id,missions_enabled`, { headers });
      const pData = await pRes.json().catch(() => []);
      if (!Array.isArray(pData) || !pData[0]) return res.status(400).json({ error: "Prestataire indisponible" });
      if (pData[0].missions_enabled !== true) {
        console.error(`[assign_after_payment] prestataire ${prestataire_id} non activé (missions_enabled != true)`);
        return res.status(400).json({ error: "Ce prestataire n'a pas encore accès aux prestations (documents en cours de vérification). Choisissez un autre prestataire." });
      }

      // Tarif réellement annoncé par le prestataire. Second volet du contrôle du
      // montant : stripe-intent vérifie la cohérence du total, mais il ne connaît pas
      // encore le prestataire — la prestation est créée sans lui pour ne pas le
      // solliciter avant paiement. C'est donc ici qu'on s'assure que le tarif horaire
      // payé n'est pas inférieur à celui du prestataire qu'on lui affecte : sinon un
      // client pouvait payer au tarif d'un prestataire à 12 €/h et engager celui à
      // 25 €/h. Le prestataire est rémunéré sur ce montant, c'est lui qui perdrait.
      try {
        const mTarifRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=tarif_horaire`, { headers });
        const tarifPaye = Number(((await mTarifRes.json().catch(() => []))[0] || {}).tarif_horaire || 0);
        if (tarifPaye > 0) {
          const urT = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${prestataire_id}`, { headers });
          const tarifReel = Number(((await urT.json().catch(() => ({}))).user_metadata || {}).tarif_net || 0);
          if (tarifReel > 0 && tarifPaye < tarifReel - 0.01) {
            console.error(`[assign_after_payment] tarif payé ${tarifPaye} €/h inférieur au tarif du prestataire ${prestataire_id} (${tarifReel} €/h)`);
            return res.status(400).json({
              error: `Le tarif de ce prestataire est de ${tarifReel.toFixed(2).replace(".", ",")} €/h, `
                   + `supérieur au montant réglé. Recommencez la réservation depuis sa fiche.`,
            });
          }
        }
      } catch (e) {
        console.error("[assign_after_payment] contrôle du tarif impossible :", e.message);
      }

      // Rayon d'intervention. Le profil annonce « intervient jusqu'à X km » et ce
      // rayon n'était vérifié que lors d'une diffusion générale : une réservation
      // directe permettait d'engager un prestataire de Nice pour une adresse
      // parisienne. Contrôle ici, au moment décisif où la prestation lui est
      // réellement affectée.
      try {
        const mLieuRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=adresse,ville`, { headers });
        const mLieu = (await mLieuRes.json().catch(() => []))[0] || {};
        const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${prestataire_id}`, { headers });
        const ud = await ur.json().catch(() => ({}));
        const metaP = ud?.user_metadata || {};
        const rayonKm = Number(metaP.zone_km) || 50;
        const lieuPresta = metaP.ville || metaP.code_postal;
        const lieuPrestation = [mLieu.adresse, mLieu.ville].filter(Boolean).join(" ") || mLieu.ville;

        if (lieuPresta && lieuPrestation) {
          const [cP, cM] = await Promise.all([geocodeFR(lieuPresta), geocodeFR(lieuPrestation)]);
          if (cP && cM) {
            const dist = haversineKm(cP.lat, cP.lon, cM.lat, cM.lon);
            if (dist > rayonKm) {
              console.error(`[assign_after_payment] hors zone : ${Math.round(dist)} km > ${rayonKm} km (presta ${prestataire_id})`);
              return res.status(400).json({
                error: `Ce prestataire n'intervient que dans un rayon de ${rayonKm} km autour de ${metaP.ville || "sa zone"}. L'adresse de la prestation est à environ ${Math.round(dist)} km. Choisissez un prestataire plus proche.`,
              });
            }
          }
          // Géocodage indisponible : on laisse passer plutôt que de bloquer une
          // réservation légitime sur une défaillance de l'API adresse.
        }
      } catch (e) {
        console.error("[assign_after_payment] contrôle du rayon impossible :", e.message);
      }

      const patch = { prestataire_id, status: "pending_acceptance" };
      if (acceptance_deadline) patch.acceptance_deadline = acceptance_deadline;
      if (stripe_payment_intent) patch.stripe_payment_intent = stripe_payment_intent;

      // Filtre sur le statut : ne pas écraser une prestation traitée entre-temps
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=in.(open,pending_acceptance)`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify(patch),
      });
      const patched = await patchRes.json().catch(() => []);
      if (!Array.isArray(patched) || patched.length === 0) {
        const txt = patchRes.ok ? "" : await patchRes.text().catch(() => "");
        console.error("[assign_after_payment] échec du PATCH:", patchRes.status, txt);
        return res.status(500).json({ error: "Affectation impossible" });
      }
      return res.status(200).json({ success: true, mission_id });
    }

    // Refus automatique quand le prestataire n'a pas répondu dans le délai (S-06).
    // Déclenché par le compte à rebours du client, mais le délai est revérifié ici :
    // le front ne peut pas décider seul qu'il est écoulé. Il écrivait auparavant
    // directement missions.status et la notification, ce qui imposait de laisser
    // ouvertes la policy notifs_insert et l'écriture du statut depuis le front.
    if (action === "acceptance_timeout") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id } = payload;
      if (!mission_id || !isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      const mRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,client_id,prestataire_id,status,acceptance_deadline,stripe_payment_intent,montant_total,tiers_declaration,metier,sector,date,heure_debut,tarif_horaire,ville,adresse`, { headers });
      const mData = await mRes.json().catch(() => []);
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Prestation introuvable" });
      if (mission.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "pending_acceptance") {
        return res.status(400).json({ error: "La prestation n'est plus en attente d'acceptation" });
      }
      if (!mission.acceptance_deadline || new Date(mission.acceptance_deadline).getTime() > Date.now()) {
        return res.status(400).json({ error: "Le délai d'acceptation n'est pas écoulé" });
      }

      // Prestation affectée par la plateforme : l'absence de réponse fait passer au
      // candidat suivant, comme un refus. Le client n'a désigné personne et sa
      // commande tient toujours — la rembourser reviendrait à l'annuler pour une
      // indisponibilité qui ne le concerne pas.
      let cascadeTimeout = null;
      if (mission.tiers_declaration) {
        cascadeTimeout = await affecterCandidatSuivant(mission, SUPABASE_URL, headers);
        console.log(`[acceptance_timeout] délai dépassé sur prestation affectée ${mission_id} → ${cascadeTimeout.mode}`);
        return res.status(200).json({ success: true, cascade: cascadeTimeout.mode });
      }

      // Filtre sur le statut : évite d'écraser une acceptation concurrente
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=eq.pending_acceptance`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({ status: "refused" }),
      });
      const patched = await patchRes.json().catch(() => []);
      if (!Array.isArray(patched) || patched.length === 0) {
        return res.status(409).json({ error: "Prestation déjà traitée" });
      }

      // Le client a payé et personne n'a accepté : remboursement intégral.
      const rembTimeout = await rembourserPrestation(mission, SUPABASE_URL, headers, "delai-expire");
      if (!rembTimeout.ok) {
        console.error(`[acceptance_timeout] remboursement à reprendre manuellement — prestation ${mission_id}`);
      }

      let prestaName = "Le prestataire";
      if (mission.prestataire_id) {
        try {
          const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${mission.prestataire_id}`, { headers });
          const ud = await ur.json();
          if (ud?.user_metadata?.prenom) prestaName = ud.user_metadata.prenom;
        } catch (e) {
          console.error("[acceptance_timeout] lecture du prénom prestataire échouée :", e.message);
        }
      }

      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          user_id: mission.client_id,
          type:    "prestation",
          title:   "Prestation non confirmée",
          body:    `${prestaName} n'a pas répondu dans le délai imparti.${rembTimeout.ok ? " Votre paiement a été intégralement remboursé." : " Notre équipe procède au remboursement."} Vous pouvez choisir un autre prestataire.`,
          read:    false,
        }),
      }).catch(e => console.error("[acceptance_timeout] insertion notification échouée :", e.message));

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
      if (!mission) return res.status(404).json({ error: "Prestation introuvable" });
      if (mission.prestataire_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "assigned") return res.status(400).json({ error: "Prestation non assignée" });

      // Si déjà payée → needs_replacement (pas de re-paiement), sinon retour open
      const newStatus = mission.stripe_payment_intent ? "needs_replacement" : "open";
      // Le résultat de cette écriture n'était pas vérifié : un refus laissait la
      // prestation assignée au prestataire qui venait pourtant de se désister, alors
      // que son écran lui confirmait l'annulation. Le filtre sur le statut évite en
      // outre d'écraser une prestation entre-temps annulée par le client.
      const patchDesist = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=eq.assigned`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({ status: newStatus, prestataire_id: null, validation_prestataire: false }),
      });
      const desistRows = await patchDesist.json().catch(() => []);
      if (!patchDesist.ok || !Array.isArray(desistRows) || desistRows.length === 0) {
        console.error(`[cancel_prestataire] désistement refusé pour ${mission_id} : ${patchDesist.status}`);
        return res.status(409).json({ error: "Ce désistement n'a pas pu être enregistré — la prestation a peut-être changé d'état. Rechargez la page." });
      }

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
          const planLimit = await limitePlanMensuelle(cancelPlan, caller.id, SUPABASE_URL, headers);
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
          : "Prestataire désisté — prestation réouverte 🔄";
        const clientBody = mission.stripe_payment_intent
          ? `Votre prestation "${mission.metier || mission.sector}" du ${mission.date} recherche un remplaçant. Votre paiement est conservé, aucune nouvelle facturation ne sera effectuée.`
          : `Votre prestation "${mission.metier || mission.sector}" du ${mission.date} a été réouverte automatiquement. De nouveaux prestataires vont être notifiés.`;
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
                  title: "🔔 Prestation disponible — urgent !",
                  body: `Prestation ${mission.metier || mission.sector || ""} le ${mission.date || ""} à ${mission.ville || ""} (${mission.hours || ""}h). Postulez maintenant !`,
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
        return res.status(400).json({ error: "Utilisez l'annulation pour clore une prestation en cours" });
      }

      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=in.(open,rejected,refused)`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation", "Accept": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });
      if (!patchRes.ok) {
        const errText = await patchRes.text().catch(() => "");
        console.error("[close] Supabase PATCH failed:", patchRes.status, errText);
        return res.status(500).json({ error: "Erreur lors de la fermeture — réessayez" });
      }
      const updated = await patchRes.json().catch(() => []);
      if (!Array.isArray(updated) || updated.length === 0) {
        return res.status(409).json({ error: "La prestation n'a pas pu être fermée — statut inattendu, rechargez et réessayez." });
      }
      // Rejeter toutes les candidatures liées (évite les faux espoirs chez les prestataires)
      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${mission_id}&status=in.(pending,accepted)`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "rejected" }),
      }).catch(() => {});
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

      const pushTitle = "🔔 Nouvelle prestation disponible";
      const pushBody  = `${mission?.metier || sector || "Prestation"} · ${mission?.date || ""} · ${mission?.ville || ""} (${mission?.hours || ""}h)`;

      // Geocode mission ville once for distance filtering (best-effort, non-blocking)
      const missionCoords = await geocodeFR(mission?.ville).catch(() => null);

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

              // Geo filter: respect prestataire's zone_km (rayon d'intervention)
              const zoneKm = Number(meta.zone_km) || 50; // default 50 km
              if (missionCoords) {
                const prestaLocation = meta.ville || meta.code_postal;
                if (prestaLocation) {
                  const prestaCoords = await geocodeFR(prestaLocation).catch(() => null);
                  if (prestaCoords) {
                    const dist = haversineKm(missionCoords.lat, missionCoords.lon, prestaCoords.lat, prestaCoords.lon);
                    if (dist > zoneKm) {
                      console.log(`[broadcast] prestataire ${p.id} hors zone (${Math.round(dist)}km > ${zoneKm}km) — skipped`);
                      return;
                    }
                  }
                }
              }

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
              const RESEND_KEY_B = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
              const RESEND_FROM_B = process.env.RESEND_FROM || "ALANE <no-reply@alane.fr>";
              if (RESEND_KEY_B && ud.email) {
                const missionLabel = mission?.metier || sector || "Prestation";
                await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: { "Authorization": `Bearer ${RESEND_KEY_B}`, "Content-Type": "application/json" },
                  body: resendBody({
                    from: RESEND_FROM_B,
                    to: [ud.email],
                    subject: `🔔 Nouvelle prestation disponible : ${missionLabel}`,
                    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
                      <h2 style="color:#4F46E5">Nouvelle prestation ALANE</h2>
                      <p>Une nouvelle prestation correspond à votre profil :</p>
                      <div style="background:#f5f5f5;border-left:4px solid #4F46E5;padding:12px 16px;margin:16px 0;border-radius:4px">
                        <strong>${esc(missionLabel)}</strong><br/>
                        📅 ${esc(mission?.date || "Date à confirmer")}<br/>
                        📍 ${esc(mission?.ville || "Ville à confirmer")}<br/>
                        ⏱ ${esc(String(mission?.hours || "?"))}h
                      </div>
                      <p>Connectez-vous à ALANE pour vous positionner.</p>
                      <p style="margin-top:24px;color:#888;font-size:12px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
                    </div>`,
                  }),
                }).catch(() => {});
              }

              // SMS Brevo (si numéro dispo et clé configurée)
              const BREVO_KEY = (process.env.BREVO_API_KEY || "").replace(/\s/g, "");
              const phone = meta.telephone;
              console.log("[broadcast] SMS check - BREVO_KEY:", !!BREVO_KEY, "hasPhone:", !!phone);
              if (BREVO_KEY && phone) {
                const digits = phone.replace(/\D/g, "");
                const e164 = digits.startsWith("0") ? "33" + digits.slice(1) : digits.startsWith("33") ? digits : null;
                if (e164) {
                  const smsText = smsClean(`ALANE - Nouvelle prestation : ${mission?.metier || sector || "Prestation"} le ${mission?.date || "?"} a ${mission?.ville || "?"} (${mission?.hours || "?"}h). Connectez-vous pour vous positionner. — alane.fr`);
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
        return res.status(403).json({ error: "Non autorisé — aucune prestation partagée active" });
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
          title: `💬 Nouveau message de ${esc(sender_name || "votre contact")}`,
          body: message_preview ? message_preview.slice(0, 100) : "Vous avez reçu un nouveau message.",
          read: false,
          ref_id: caller.id,
        }),
      });

      // Email Resend (quand app fermée)
      const RESEND_KEY = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
      const RESEND_FROM = process.env.RESEND_FROM || "ALANE <no-reply@alane.fr>";
      if (RESEND_KEY && recipientEmail) {
        try {
          const er = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
            body: resendBody({
              from: RESEND_FROM,
              to: [recipientEmail],
              subject: `💬 Nouveau message de ${esc(sender_name || "votre contact")}`,
              html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
                <h2 style="color:#4F46E5">Nouveau message ALANE</h2>
                <p><strong>${esc(sender_name || "Votre contact")}</strong> vous a envoyé un message :</p>
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
      const BREVO_KEY = (process.env.BREVO_API_KEY || "").replace(/\s/g, "");
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
                content: smsClean(`ALANE - Nouveau message de ${(sender_name || "votre contact").slice(0,50)} : ${(message_preview || "").slice(0, 80)} — alane.fr`),
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

      // On first activation, push "en route" to client — only within 5 min of mission start
      if (isFirstUpdate) {
        try {
          const mRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id,metier,ville,date,heure_debut&limit=1`, { headers });
          const mRows = await mRes.json().catch(() => []);
          const mission = Array.isArray(mRows) && mRows[0];
          if (mission?.client_id) {
            let withinWindow = true;
            if (mission.date && mission.heure_debut) {
              try {
                const missionStart = new Date(`${mission.date}T${mission.heure_debut}:00`);
                const msUntilStart = missionStart.getTime() - Date.now();
                withinWindow = msUntilStart <= 60 * 60 * 1000;
              } catch(e) { /* date parse failed — allow notification */ }
            }
            if (withinWindow) {
              const notif = { title: "📍 Prestataire en route", body: `Votre prestataire est en route${mission.ville ? ` vers ${mission.ville}` : ""} et partage sa position en direct.`, url: "/mission_history" };
              sendPushToUser(mission.client_id, notif, SUPABASE_URL, headers).catch(() => {});
            }
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

    // État d'ouverture des secteurs. Volontairement accessible sans jeton : la
    // réponse ne contient que des nombres agrégés, et les deux appelants — l'accueil
    // client et le backoffice — n'envoyaient pas de Bearer, si bien que l'action
    // répondait toujours 401. Le verrou des secteurs et le compteur du backoffice
    // étaient donc inertes depuis leur création.
    if (action === "get_sector_status") {
      const cache = globalThis.__alaneSectorCache;
      if (cache && Date.now() - cache.ts < 300_000) {
        return res.status(200).json(cache.data);
      }

      const fermes = await secteursDesactives(SUPABASE_URL, headers);

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

      // L'ouverture dépend de la seule décision explicite de l'administrateur.
      // Elle dépendait auparavant d'un seuil de prestataires (`sector_min_prestataires`,
      // 30 par défaut) : dès que cette action redevenait joignable, tous les secteurs
      // se verrouillaient d'un coup et la plateforme n'était plus réservable. Le
      // nombre de prestataires reste renvoyé, pour information dans le backoffice.
      const KNOWN_SECTORS = ["proprete","logistique","hotellerie","restauration","commercial","distribution","divers"];
      const result = {};
      for (const s of KNOWN_SECTORS) {
        const disabled = fermes.includes(s);
        result[s] = { count: counts[s] || 0, open: !disabled, disabled };
      }
      globalThis.__alaneSectorCache = { ts: Date.now(), data: result };
      return res.status(200).json(result);
    }

    if (action === "cancel_client") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, reason } = payload;
      if (!mission_id) return res.status(400).json({ error: "mission_id requis" });
      if (!isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      const mRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id,prestataire_id,status,stripe_payment_intent,montant_total,metier,sector,date,heure_debut,hours,tarif_horaire,date_debut,date_fin,arrived_at,started_at`,
        { headers }
      );
      const mData = await mRes.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Prestation introuvable" });
      if (mission.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (!["open", "assigned", "pending_acceptance", "needs_replacement"].includes(mission.status)) {
        return res.status(400).json({ error: "Cette prestation ne peut plus être annulée" });
      }

      // Politique d'annulation : seuls les frais de service sont retenus si < 24h.
      // Ces frais varient — 4,90 € pour une prestation simple, 2,90 € par jour en
      // récurrent, 9,90 € en urgence — alors qu'un montant fixe de 4,90 € était
      // retenu. Un client en récurrent sur un jour se voyait donc prélever 4,90 €
      // pour 2,90 € payés, et une urgence ne laissait que 4,90 € sur 9,90 € encaissés.
      // Les frais réels se déduisent du total : montant payé moins la part horaire.
      // Le délai avant la prestation ne détermine plus la retenue des frais : ils sont
      // dus dans tous les cas d'annulation par le client. Le calcul est retiré plutôt
      // que laissé inutilisé, pour ne pas laisser croire qu'il compte encore.
      const FRAIS_DEFAUT = 4.90;
      // montant_total n'est défini qu'à la validation — pour les missions assigned non validées,
      // le montant réel est dans le PaymentIntent Stripe. On le récupère si nécessaire.
      let missionAmount = Number(mission.montant_total) || 0;
      if (!missionAmount && mission.stripe_payment_intent && STRIPE_SECRET_KEY) {
        try {
          const piRes = await fetch(`https://api.stripe.com/v1/payment_intents/${mission.stripe_payment_intent}`, {
            headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` },
          });
          if (piRes.ok) {
            const piData = await piRes.json();
            if (piData.amount_received > 0) missionAmount = piData.amount_received / 100;
            else if (piData.amount > 0) missionAmount = piData.amount / 100;
          }
        } catch {}
      }
      // Frais réellement payés = total encaissé − part horaire (tarif × heures × jours)
      const nbJours = (mission.date_debut && mission.date_fin)
        ? Math.max(1, Math.round((new Date(mission.date_fin) - new Date(mission.date_debut)) / 86400000) + 1)
        : 1;
      const partHoraire = Number(mission.tarif_horaire || 0) * Number(mission.hours || 0) * nbJours;
      const fraisDeduits = Math.round((missionAmount - partHoraire) * 100) / 100;
      // Garde-fou calibré sur la grille réelle (plans.js FRAIS_MER : 4,90 simple,
      // 2,90 par jour en récurrent, 9,90 en urgence) plutôt que sur un pourcentage
      // du total : en urgence, 9,90 € sur 24,90 € représentent 40 % du total et un
      // plafond proportionnel les aurait rejetés à tort. Si la déduction sort de
      // cette grille — données incomplètes, montant repris du PaymentIntent — on
      // retombe sur le forfait plutôt que de retenir un montant fantaisiste.
      const fraisPlausiblesMax = Math.max(9.90, 2.90 * nbJours) + 0.01;
      const fraisRetenus = (fraisDeduits > 0 && fraisDeduits <= fraisPlausiblesMax && fraisDeduits < missionAmount)
        ? fraisDeduits
        : Math.min(FRAIS_DEFAUT, missionAmount);

      // Défaillance du prestataire : annulation sans aucun frais.
      //
      // Un retard se juge en proportion, pas en minutes : 30 minutes sur une
      // prestation d'une heure, c'est la moitié du service perdu ; sur huit heures,
      // c'est un contretemps. Le droit d'annuler s'ouvre donc à
      //   seuil = min(60 min, max(20 min, 25 % de la durée prévue))
      // soit 20 min pour 1h, 30 min pour 2h, 60 min pour 4h et au-delà.
      //
      // Il se referme dès que la prestation a démarré : le prestataire est alors à
      // l'œuvre, et c'est l'arbitrage du décalage — fin à l'heure prévue, heures
      // réduites — qui rééquilibre. Annuler à ce stade le ferait travailler pour rien.
      //
      // Le retard est recalculé ici et jamais lu depuis la requête : c'est une
      // décision d'argent.
      let annulationPourRetard = false;
      if (!mission.started_at && mission.date && mission.heure_debut && mission.prestataire_id) {
        try {
          const [hR, mR] = String(mission.heure_debut).split(":").map(Number);
          const prevuNaive = new Date(`${mission.date}T${String(hR).padStart(2,"0")}:${String(mR||0).padStart(2,"0")}:00`);
          const prevuMs = prevuNaive.getTime() + frenchOffsetMs(prevuNaive);
          const retardMin = Math.floor((Date.now() - prevuMs) / 60000);
          const dureeMin = Math.max(1, Number(mission.hours) || 1) * 60;
          const seuilMin = Math.min(60, Math.max(20, Math.round(dureeMin * 0.25)));
          if (retardMin >= seuilMin) {
            annulationPourRetard = true;
            console.log(`[cancel_client] retard de ${retardMin} min ≥ seuil ${seuilMin} min (durée ${dureeMin} min) — annulation sans frais`);
          }
        } catch (e) {
          console.error("[cancel_client] calcul du seuil de retard impossible :", e.message);
        }
      }

      // Les frais de service sont retenus sur TOUTE annulation à l'initiative du
      // client, quel que soit le délai : ils rémunèrent la mise en relation, déjà
      // effectuée. C'est ce qu'annoncent les CGPS art. 8.1 (« en principe retenus et
      // non remboursables car ils couvrent des coûts déjà engagés ») et l'écran de
      // confirmation lui-même (« remboursement intégral hors frais de service »).
      // Seul le serveur disait le contraire au-delà de 24 h : il les remboursait.
      //
      // Unique exception, celle des CGPS art. 8.2 : la défaillance du prestataire.
      // Le client est alors intégralement remboursé, frais compris — il n'y est pour
      // rien, et facturer une mise en relation qui n'a produit personne serait
      // difficilement défendable.
      const retenirFrais = !annulationPourRetard;
      const refundAmount = retenirFrais
        ? Math.max(0, Math.round((missionAmount - fraisRetenus) * 100)) // en centimes
        : Math.round(missionAmount * 100);
      const keptAmount = retenirFrais ? fraisRetenus : 0;
      if (retenirFrais) {
        console.log(`[cancel_client] frais retenus ${fraisRetenus} € (déduits: ${fraisDeduits}, total: ${missionAmount}, horaire: ${partHoraire})`);
      }

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
      let walletRefunded = false;
      const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
      const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
      const RESEND_FROM    = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
      const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;
      const isWalletPaid = mission.stripe_payment_intent?.startsWith("wallet_");

      if (isWalletPaid && refundAmount > 0) {
        // Remboursement sur le wallet prépayé
        try {
          const profR = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=prepaid_balance`, { headers });
          const profData = await profR.json().catch(() => []);
          const currentBal = Number(Array.isArray(profData) && profData[0]?.prepaid_balance || 0);
          const refundEuros = refundAmount / 100;
          const newBal = Math.round((currentBal + refundEuros) * 100) / 100;
          await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}`, {
            method: "PATCH",
            headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({ prepaid_balance: newBal }),
          });
          walletRefunded = true;
        } catch (e) {
          console.error("[cancel_client] wallet refund failed:", e.message);
        }
      } else if (!isWalletPaid && mission.stripe_payment_intent && refundAmount > 0 && STRIPE_SECRET_KEY) {
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
              // Idempotency key: même mission = même remboursement, jamais de doublon
              "Idempotency-Key": `refund-cancel-${mission_id}`,
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
      // Si ce PATCH échoue, on retourne une erreur pour que le client puisse réessayer.
      // La prochaine tentative retrouvera le même remboursement Stripe grâce à l'Idempotency-Key
      // (pas de double débit), puis re-tentera le PATCH.
      const cancelPatchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      if (!cancelPatchRes.ok) {
        const patchErr = await cancelPatchRes.text().catch(() => "");
        console.error("[cancel_client] Supabase PATCH failed:", cancelPatchRes.status, patchErr);
        // Le remboursement Stripe a (peut-être) déjà été déclenché — on informe l'admin
        if (stripeRefundId && RESEND_API_KEY && ADMIN_EMAIL) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: resendBody({
              from: RESEND_FROM || "ALANE <onboarding@resend.dev>",
              to: ADMIN_EMAIL,
              subject: `[ACTION REQUISE] Annulation incomplète — prestation ${mission_id.slice(0,8)}`,
              html: `<p>Le remboursement Stripe <strong>${stripeRefundId}</strong> a réussi mais la prestation n'a pas pu être marquée "cancelled" en DB (erreur ${cancelPatchRes.status}).<br>Vérifier et corriger manuellement dans Supabase.</p>`,
            }),
          }).catch(() => {});
          return res.status(500).json({ error: "Erreur lors de la mise à jour de la prestation — votre remboursement a bien été déclenché. Contactez le support si ce message persiste." });
        }
        return res.status(500).json({ error: "Erreur lors de l'annulation — réessayez ou contactez le support." });
      }

      // Rejeter toutes les candidatures liées à cette mission
      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${mission_id}&status=in.(pending,accepted)`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "rejected" }),
      }).catch(() => {});

      // Email au client — confirmation de remboursement
      if (RESEND_API_KEY && clientEmail) {
        const refundEur = (refundAmount / 100).toFixed(2).replace(".", ",");
        const keptEur   = keptAmount.toFixed(2).replace(".", ",");
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: resendBody({
            from: RESEND_FROM,
            to: clientEmail,
            subject: refundAmount > 0 ? `Annulation confirmée — remboursement de ${refundEur} € en cours` : "Annulation confirmée",
            html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
              <h2 style="color:#050E20">✅ Annulation confirmée</h2>
              <p style="color:#444">Votre prestation <strong>${esc(mission.metier || mission.sector || "")}</strong> a bien été annulée.</p>
              <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
                <tr><td style="padding:6px 0;color:#666">Montant payé</td><td style="font-weight:700">${esc(String(missionAmount.toFixed(2).replace(".",",")))} €</td></tr>
                <tr><td style="padding:6px 0;color:#666">Remboursement</td><td style="font-weight:700;color:#10D98F">${refundEur} €</td></tr>
                ${keptAmount > 0 ? `<tr><td style="padding:6px 0;color:#666">Frais de service retenus</td><td style="font-weight:700;color:#F0B429">${keptEur} €</td></tr>` : ""}
              </table>
              <p style="font-size:13px;color:#666">${refundAmount > 0 ? (walletRefunded ? "Le remboursement a été crédité instantanément sur votre wallet ALANE." : (stripeRefundId ? "Le remboursement a été déclenché automatiquement. Il apparaîtra sur votre relevé bancaire sous 5 à 10 jours ouvrés." : "Le remboursement sera traité manuellement par notre équipe dans les 48h.")) : (mission.stripe_payment_intent ? "Les frais de service ont été retenus — aucun montant supplémentaire n'est dû." : "Aucun paiement n'avait été effectué pour cette mission.")}</p>
              ${keptAmount > 0
                ? `<p style="font-size:12px;color:#999">Les frais de service (${keptEur} €) sont retenus : ils couvrent la mise en relation, déjà effectuée.</p>`
                : `<p style="font-size:12px;color:#999">Votre prestataire ne s'est pas présenté : vous êtes intégralement remboursé, frais de service compris.</p>`}
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
          body: resendBody({
            from: RESEND_FROM,
            to: ADMIN_EMAIL,
            subject: `[ACTION REQUISE] Remboursement Stripe échoué — prestation ${mission_id.slice(0,8)}`,
            html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
              <h2 style="color:#c0392b">⚠️ Remboursement automatique échoué</h2>
              <p>Le remboursement automatique a échoué pour la prestation <strong>${esc(mission.metier || mission.sector || "—")}</strong>.</p>
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
        const missionLabel = mission.metier || mission.sector || "la prestation";
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: mission.prestataire_id,
            type: "mission",
            title: "Prestation annulée ❌",
            body: `La prestation "${missionLabel}" a été annulée par le client.`,
            read: false,
          }),
        }).catch(() => {});

        // SMS d'alerte immédiat si le prestataire était assigné (peut être en déplacement)
        if (mission.status === "assigned") {
          try {
            const prestaRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${mission.prestataire_id}`, { headers });
            const prestaData = await prestaRes.json();
            const prestaPhone = prestaData.user_metadata?.telephone || null;
            const BREVO_KEY = (process.env.BREVO_API_KEY || "").replace(/\s/g, "");
            if (BREVO_KEY && prestaPhone) {
              await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
                method: "POST",
                headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
                body: JSON.stringify({
                  sender: "ALANE",
                  recipient: prestaPhone.startsWith("+") ? prestaPhone : `+33${prestaPhone.replace(/^0/, "")}`,
                  content: `ANNULATION : La prestation "${missionLabel}" a été annulée par le client. Ne vous déplacez pas. Connectez-vous à l'app pour plus d'infos.`,
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
      if (!mission) return res.status(404).json({ error: "Prestation introuvable" });
      if (mission.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (mission.status !== "assigned") return res.status(400).json({ error: "La prestation n'est pas en cours" });
      if (!mission.heure_debut) return res.status(400).json({ error: "Heure de début non définie sur cette prestation" });

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
      const isWalletPaidInProgress = mission.stripe_payment_intent?.startsWith("wallet_");

      if (refundAmount > 0 && isWalletPaidInProgress) {
        // Remboursement proraté sur le wallet prépayé
        try {
          const profR = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=prepaid_balance`, { headers });
          const profData = await profR.json().catch(() => []);
          const currentBal = Number(Array.isArray(profData) && profData[0]?.prepaid_balance || 0);
          const newBal = Math.round((currentBal + refundAmount) * 100) / 100;
          await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}`, {
            method: "PATCH",
            headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({ prepaid_balance: newBal }),
          });
        } catch (e) {
          console.error("[cancel_in_progress] wallet refund failed:", e.message);
        }
      } else if (refundAmount > 0 && mission.stripe_payment_intent && !isWalletPaidInProgress) {
        // Stripe refund is mandatory when a payment was captured — abort cancellation on failure
        const STRIPE_SECRET_KEY_CANCEL = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
        if (!STRIPE_SECRET_KEY_CANCEL) {
          return res.status(500).json({ error: "Stripe non configuré — la prestation n'a pas été annulée. Contactez le support." });
        }
        try {
          const refundCents = Math.round(refundAmount * 100);
          const rfRes = await fetch("https://api.stripe.com/v1/refunds", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${STRIPE_SECRET_KEY_CANCEL}`,
              "Content-Type": "application/x-www-form-urlencoded",
              "Idempotency-Key": `refund-cancel-inprogress-${mission_id}`,
            },
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
            return res.status(500).json({ error: "Le remboursement Stripe a échoué — la prestation n'a pas été annulée. Contactez le support." });
          }
        } catch (e) {
          console.error("[cancel_in_progress] Stripe refund exception:", e.message);
          return res.status(500).json({ error: "Le remboursement Stripe a échoué — la prestation n'a pas été annulée. Contactez le support." });
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

      const missionLabel = mission.metier || mission.sector || "Prestation";

      // Email au prestataire
      const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
      const RESEND_FROM    = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
      if (RESEND_API_KEY && prestaEmail) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: resendBody({
            from: RESEND_FROM,
            to: prestaEmail,
            subject: `💶 Prestation interrompue — vous serez payé(e) pour ${billedHours}h`,
            html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
              <h2 style="color:#050E20">Prestation interrompue par le client</h2>
              <p style="color:#444">Bonjour ${esc(prestaName)},</p>
              <p style="color:#444">Le client a mis fin à la prestation <strong>${esc(missionLabel)}</strong> avant son terme prévu.</p>
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
      const BREVO_KEY_CANCEL = (process.env.BREVO_API_KEY || "").replace(/\s/g, "");
      if (BREVO_KEY_CANCEL && prestaPhone) {
        await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
          method: "POST",
          headers: { "api-key": BREVO_KEY_CANCEL, "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: "ALANE",
            recipient: prestaPhone.startsWith("+") ? prestaPhone : `+33${prestaPhone.replace(/^0/, "")}`,
            content: `Prestation "${missionLabel}" interrompue après ${elapsedHours.toFixed(1).replace(".",",")}h. Vous serez réglé(e) pour ${billedHours}h = ${proratedAmount.toFixed(2).replace(".",",")} € HT. L'équipe ALANE vous contacte sous 24h.`,
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
            title: "Prestation interrompue — paiement prorata 💶",
            body: `La prestation "${missionLabel}" a été interrompue. Vous serez payé(e) pour ${billedHours}h (${proratedAmount.toFixed(2).replace(".",",")} € HT). L'équipe ALANE vous contacte sous 24h.`,
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
            subject: `[ARRÊT EN COURS] Prestation ${mission_id.slice(0,8)} — paiement partiel ${billedHours}h / ${proratedAmount.toFixed(2)} € HT`,
            message: `Prestation interrompue par le client en cours d'exécution.\n\nMission : ${missionLabel}\nPrestataire : ${prestaName} (${prestaEmail || mission.prestataire_id})\nClient : ${clientEmail || caller.id}\n\nDurée prévue : ${totalHours}h\nDurée effectuée : ${elapsedHours.toFixed(2)}h\nHeures facturées : ${billedHours}h (arrondi supérieur)\nMontant dû au prestataire : ${proratedAmount.toFixed(2)} € HT\nMontant initial client : ${originalMontant.toFixed(2)} €\nRemboursement client : ${refundAmount.toFixed(2)} € ${stripeRefundId ? `(✅ effectué — ${stripeRefundId})` : "(⚠️ ÉCHEC — à traiter manuellement)"}\nPaymentIntent Stripe : ${mission.stripe_payment_intent}\n\nActions requises :\n1. ${stripeRefundId ? `Remboursement de ${refundAmount.toFixed(2)} € effectué automatiquement (${stripeRefundId})` : `Rembourser le client manuellement de ${refundAmount.toFixed(2)} € sur Stripe`}\n2. Virer le prorata de ${proratedAmount.toFixed(2)} € HT au prestataire`,
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
            body: resendBody({
              from: RESEND_FROM,
              to: ADMIN_EMAIL,
              subject: `[ACTION REQUISE] Arrêt en cours — ${missionLabel} — ${billedHours}h / ${proratedAmount.toFixed(2)} € HT`,
              html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px">
                <h2 style="color:#050E20">⚠️ Prestation interrompue en cours d'exécution</h2>
                <table style="width:100%;border-collapse:collapse;font-size:14px">
                  <tr><td style="padding:6px 0;color:#666">Prestation</td><td style="font-weight:700">${esc(missionLabel)}</td></tr>
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
      if (!m) return res.status(404).json({ error: "Prestation introuvable" });
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
      // Seuil aligné sur le reste de la plateforme, qui tolère 15 minutes avant de
      // s'inquiéter. À 5 minutes, un simple aléa de circulation imposait au client
      // une décision formelle.
      const hasDelay = delayMinutes > 15;

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
          notifBody = `Votre prestataire est arrivé(e) pour « ${label} ». La prestation démarre.`;
        }
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ user_id: m.client_id, type: "mission", title: notifTitle, body: notifBody, read: false }),
        }).catch(() => {});
        sendPushToUser(m.client_id, { title: notifTitle, body: notifBody, url: "/" }, SUPABASE_URL, headers).catch(() => {});
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
      if (!m2) return res.status(404).json({ error: "Prestation introuvable" });
      if (m2.delay_status !== "pending") return res.status(400).json({ error: "Aucun décalage en attente" });
      const delayMins = m2.arrival_delay_minutes || 0;
      const plannedHours = m2.hours || 0;
      const actualHours = response === "rejected"
        ? Math.max(0, Math.round((plannedHours - delayMins / 60) * 100) / 100)
        : plannedHours;
      // hours = durée effective du timer (réduite si refus) ; actual_hours = même valeur pour ancrer la facturation
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ delay_status: response, hours: actualHours, actual_hours: actualHours }),
      });
      if (m2.prestataire_id) {
        const label = m2.titre || m2.metier || "la prestation";
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            user_id: m2.prestataire_id, type: "mission",
            // Formulation volontairement contractuelle et non disciplinaire : ce
            // n'est pas une pénalité, c'est le prix du temps réellement effectué.
            // Le prestataire dispose d'un droit de réponse — sans lui, un ajustement
            // automatique décidé par le seul client s'apparente à un pouvoir de
            // sanction, ce qu'une plateforme n'exerce pas sur un indépendant.
            title: response === "approved" ? "Fin de prestation décalée ✅" : "Durée facturée ajustée ⏱",
            body: response === "approved"
              ? `Le client a accepté de décaler la fin de « ${label} » de ${delayMins} min. La durée initialement prévue reste due.`
              : `La prestation « ${label} » prend fin à l'heure convenue : ${actualHours} h seront facturées au lieu de ${plannedHours} h, `
                + `soit le temps effectivement réalisé après un démarrage décalé de ${delayMins} min. `
                + `Si ce décalage ne vous est pas imputable, écrivez à direction@alane.fr : la prestation sera réexaminée.`,
            read: false,
          }),
        }).catch(() => {});
      }
      return res.status(200).json({ ok: true, actual_hours: actualHours });
    }

    // Dépôt d'un avis. L'insertion se faisait depuis le navigateur : le contrôle
    // d'éligibilité — « avez-vous déjà travaillé ensemble ? » — était une requête du
    // front, contournable, et côté prestataire il n'existait pas du tout. Rien
    // n'empêchait donc de noter n'importe qui, autant de fois que voulu. Or la note
    // pilote le classement du catalogue et s'affiche à chaque client : un concurrent
    // ou un client mécontent pouvait effondrer un prestataire en quelques minutes.
    //
    // Tout est revérifié ici : la prestation existe, l'auteur y a pris part, elle est
    // terminée, et il n'a pas déjà donné son avis. Le destinataire est déduit de la
    // prestation, jamais transmis par l'appelant.
    // Déclaration d'intervention au bénéfice d'un tiers (CGPS art. 10B).
    //
    // Volontairement séparée de la création de la prestation : si la colonne
    // `tiers_declaration` n'existe pas encore, la réservation doit aboutir malgré
    // tout. Bloquer un tunnel de paiement sur une colonne manquante serait un
    // remède pire que le mal.
    // Affectation par la plateforme d'une prestation exécutée chez un tiers.
    // Remplace `assign_after_payment` dans ce cas : le client ne désigne personne, il
    // décrit un besoin (CGPS art. 5.2). Appelée après paiement, comme l'autre chemin.
    if (action === "affecter_tiers") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, acceptance_deadline, stripe_payment_intent } = payload;
      if (!mission_id || !isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });

      const amRes = await fetch(
        `${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id,status,metier,sector,date,heure_debut,ville,adresse,tarif_horaire,titre`,
        { headers }
      );
      const am = (await amRes.json().catch(() => []))[0];
      if (!am) return res.status(404).json({ error: "Prestation introuvable" });
      if (am.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (!["open", "pending_acceptance"].includes(am.status)) {
        return res.status(409).json({ error: "Cette prestation a déjà été traitée" });
      }

      const secteurFerme = await secteursDesactives(SUPABASE_URL, headers);
      if (am.sector && secteurFerme.includes(am.sector)) {
        return res.status(400).json({ error: "Ce secteur n'est pas encore ouvert aux réservations." });
      }

      // Le contrat-cadre est un préalable, pas une formalité : il porte les garanties
      // sur la nature de ce qui est vendu et sur le maintien du pouvoir
      // d'organisation. Sans lui, l'intervention chez un tiers n'est pas encadrée.
      try {
        const ccRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=contrat_cadre_pro`, { headers });
        const cc = (await ccRes.json().catch(() => []))[0];
        if (!cc || !cc.contrat_cadre_pro || !cc.contrat_cadre_pro.accepte_le) {
          return res.status(403).json({ error: "Le contrat-cadre Client Professionnel doit être accepté avant toute intervention au bénéfice d'un tiers." });
        }
      } catch (e) {
        console.error("[affecter_tiers] contrat-cadre illisible :", e.message);
        return res.status(500).json({ error: "Vérification du contrat-cadre impossible. Réessayez." });
      }

      const candidats = await candidatsPourMission({ ...am, id: mission_id }, SUPABASE_URL, headers);
      const patch = { status: "pending_acceptance" };
      if (stripe_payment_intent) patch.stripe_payment_intent = stripe_payment_intent;

      if (!candidats.length) {
        // Personne ne correspond : la prestation part en diffusion plutôt que de
        // rester bloquée. Un prestataire pourra l'accepter de lui-même — ce qui rend
        // son autonomie visible, et n'enferme pas le client dans une impasse.
        await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=in.(open,pending_acceptance)`, {
          method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ ...patch, status: "open", prestataire_id: null }),
        });
        console.log(`[affecter_tiers] aucun candidat pour ${mission_id} — diffusion`);
        return res.status(200).json({ success: true, mode: "diffusion", mission_id });
      }

      patch.prestataire_id = candidats[0];
      if (acceptance_deadline) patch.acceptance_deadline = acceptance_deadline;
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=in.(open,pending_acceptance)`, {
        method: "PATCH", headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify(patch),
      });
      const rows = await patchRes.json().catch(() => []);
      if (!patchRes.ok || !Array.isArray(rows) || rows.length === 0) {
        console.error(`[affecter_tiers] affectation refusée pour ${mission_id} : ${patchRes.status}`);
        return res.status(500).json({ error: "Affectation impossible" });
      }
      console.log(`[affecter_tiers] ${mission_id} → ${candidats[0]} (${candidats.length} candidat(s))`);
      return res.status(200).json({ success: true, mode: "affectation", mission_id });
    }

    // Acceptation du contrat-cadre Client Professionnel.
    //
    // Écrite par le service role : le navigateur ne peut pas s'auto-attribuer une
    // acceptation. La version est conservée — un contrat modifié devra être
    // réaccepté, et l'on saura toujours quelle rédaction liait le client à la date
    // d'une prestation donnée.
    if (action === "accepter_contrat_cadre") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { version, signataire, qualite } = payload;
      const v = String(version || "").trim().slice(0, 12);
      const nom = String(signataire || "").trim().replace(/\s+/g, " ").slice(0, 120);
      if (!v) return res.status(400).json({ error: "Version du contrat requise" });
      if (nom.length < 3) return res.status(400).json({ error: "Nom et prénom du signataire requis" });

      const corps = {
        version: v,
        accepte_le: new Date().toISOString(),
        signataire: nom,
        qualite: String(qualite || "").trim().slice(0, 80) || null,
      };
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({ contrat_cadre_pro: corps }),
      });
      const rows = await pr.json().catch(() => null);
      if (!pr.ok || !Array.isArray(rows) || rows.length === 0) {
        console.error(`[contrat_cadre] acceptation NON enregistrée pour ${caller.id} : ${pr.status} `
          + `${JSON.stringify(rows || {})}. Appliquer la migration 2026-08-05_contrat_cadre_professionnel.sql.`);
        return res.status(500).json({ error: "Votre acceptation n'a pas pu être enregistrée. Réessayez ou contactez-nous." });
      }
      console.log(`[contrat_cadre] accepté par ${caller.id} — version ${v}`);
      return res.status(200).json({ ok: true, contrat: corps });
    }

    if (action === "declarer_tiers") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, declaration } = payload;
      if (!mission_id || !isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      if (!declaration || typeof declaration !== "object") return res.status(400).json({ error: "declaration requise" });

      const mdRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id`, { headers });
      const md = (await mdRes.json().catch(() => []))[0];
      if (!md) return res.status(404).json({ error: "Prestation introuvable" });
      if (md.client_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });

      // Champs bornés et normalisés : ce texte est destiné à être relu par un tiers,
      // il ne doit ni déborder ni contenir de contenu arbitraire.
      const champ = (v, max) => {
        const t = String(v == null ? "" : v).trim().replace(/\s+/g, " ");
        return t ? t.slice(0, max) : null;
      };
      const propre = {
        beneficiaire:  champ(declaration.beneficiaire, 200),
        service_vendu: champ(declaration.service_vendu, 300),
        perimetre:     champ(declaration.perimetre, 500),
        livrable:      champ(declaration.livrable, 300),
        organisateur:  champ(declaration.organisateur, 200),
        declare_le:    new Date().toISOString(),
      };
      // Réponse « dans mon entreprise » : rien d'autre à déclarer. Elle est conservée
      // pour que la détection distingue un client multi-sites, qui commande
      // légitimement ailleurs, d'un client qui n'a jamais répondu.
      if (declaration.lieu === "etablissement_propre") {
        const patchLieu = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=representation" },
          body: JSON.stringify({ tiers_declaration: { lieu: "etablissement_propre", declare_le: new Date().toISOString() } }),
        });
        const okLieu = await patchLieu.json().catch(() => null);
        if (!patchLieu.ok || !Array.isArray(okLieu) || okLieu.length === 0) {
          console.error(`[declarer_tiers] déclaration de lieu NON enregistrée pour ${mission_id} : ${patchLieu.status}`);
          return res.status(200).json({ ok: false, enregistre: false });
        }
        return res.status(200).json({ ok: true, enregistre: true });
      }

      const manquants = ["beneficiaire", "service_vendu", "perimetre", "livrable", "organisateur"]
        .filter(k => !propre[k]);
      if (manquants.length) {
        return res.status(400).json({ error: `Déclaration incomplète : ${manquants.join(", ")}.` });
      }

      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify({ tiers_declaration: propre }),
      });
      const rows = await patchRes.json().catch(() => null);
      if (!patchRes.ok || !Array.isArray(rows) || rows.length === 0) {
        // Colonne absente : migration 2026-08-05_declaration_intervention_tiers non
        // appliquée. La réservation reste valide, la déclaration est perdue — d'où
        // le niveau « erreur », pour que ça se voie dans les journaux.
        console.error(`[declarer_tiers] déclaration NON enregistrée pour ${mission_id} : ${patchRes.status} `
          + `${JSON.stringify(rows || {})}. Appliquer la migration 2026-08-05_declaration_intervention_tiers.sql. `
          + `Contenu déclaré : ${JSON.stringify(propre)}`);
        return res.status(200).json({ ok: false, enregistre: false });
      }
      return res.status(200).json({ ok: true, enregistre: true });
    }

    if (action === "submit_rating") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id, rating, comment, tags } = payload;
      if (!mission_id || !isUuid(mission_id)) return res.status(400).json({ error: "mission_id invalide" });
      const note = Number(rating);
      if (!Number.isInteger(note) || note < 1 || note > 5) {
        return res.status(400).json({ error: "La note doit être comprise entre 1 et 5." });
      }
      const texte = comment == null ? null : String(comment).trim().slice(0, 1000) || null;

      const rmRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id,prestataire_id,status`, { headers });
      const rmData = await rmRes.json().catch(() => []);
      const rm = Array.isArray(rmData) && rmData[0];
      if (!rm) return res.status(404).json({ error: "Prestation introuvable" });

      const estClient = rm.client_id === caller.id;
      const estPresta = rm.prestataire_id === caller.id;
      if (!estClient && !estPresta) return res.status(403).json({ error: "Vous n'avez pas pris part à cette prestation." });
      if (!["completed", "closed"].includes(rm.status)) {
        return res.status(400).json({ error: "Vous pourrez déposer votre avis une fois la prestation terminée." });
      }
      const destinataire = estClient ? rm.prestataire_id : rm.client_id;
      if (!destinataire) return res.status(400).json({ error: "Aucun destinataire pour cet avis." });

      const dejaRes = await fetch(`${SUPABASE_URL}/rest/v1/ratings?mission_id=eq.${mission_id}&reviewer_id=eq.${caller.id}&select=id&limit=1`, { headers });
      const deja = await dejaRes.json().catch(() => []);
      if (Array.isArray(deja) && deja.length > 0) {
        return res.status(409).json({ error: "Vous avez déjà déposé un avis sur cette prestation." });
      }

      // Le nom affiché est lu en base, pas transmis par l'appelant.
      let nomDestinataire = null;
      try {
        const pnRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${destinataire}&select=prenom,nom`, { headers });
        const pn = (await pnRes.json().catch(() => []))[0];
        if (pn) nomDestinataire = [pn.prenom, pn.nom].filter(Boolean).join(" ") || null;
      } catch (e) {
        console.error("[submit_rating] nom du destinataire illisible :", e.message);
      }

      const corps = {
        reviewer_id: caller.id,
        reviewee_provider_id: destinataire,
        rating: note,
        comment: texte,
        mission_id,
      };
      if (nomDestinataire) corps.reviewee_name = nomDestinataire;
      if (Array.isArray(tags) && tags.length) corps.tags = tags.slice(0, 10).map(t => String(t).slice(0, 40));

      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/ratings`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=representation" },
        body: JSON.stringify(corps),
      });
      const insRows = await insRes.json().catch(() => []);
      if (!insRes.ok || !Array.isArray(insRows) || insRows.length === 0) {
        console.error(`[submit_rating] insertion refusée pour ${mission_id} : ${insRes.status} ${JSON.stringify(insRows)}`);
        return res.status(500).json({ error: "Votre avis n'a pas pu être enregistré. Réessayez." });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === "my_missions") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const [r1, r2] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${caller.id}&status=eq.pending_acceptance&select=id,sector,metier,date,heure_debut,hours,tarif_horaire,acceptance_deadline,client_id,titre,ville,adresse,description&order=created_at.desc`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/missions?prestataire_id=eq.${caller.id}&status=eq.assigned&select=id,sector,metier,date,date_debut,date_fin,heure_debut,hours,actual_hours,tarif_horaire,client_id,titre,ville,adresse,description,validation_prestataire,status,arrived_at,started_at,extra_hours_requested,extra_hours_status,delay_status,arrival_delay_minutes&order=created_at.desc`, { headers }),
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
            // Statut volontairement inchangé : l'expiration d'une prestation payée
            // implique un remboursement, et cette écriture-là appartient au cron
            // (cron-reset-monthly), seul endroit où la logique d'argent est tenue.
            // La laisser ici renvoyait la prestation en « open » sans rembourser.
            body: JSON.stringify({ prestataire_id: null }),
          });
          // Notifier le client que le prestataire n'a pas répondu dans les temps
          if (m.client_id) {
            await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
              method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
              body: JSON.stringify({
                user_id: m.client_id, type: "mission",
                title: "Prestataire non disponible ⏱️",
                body: `Le prestataire n'a pas répondu à temps pour la prestation "${m.metier || m.titre || ""}". Elle est de nouveau disponible.`,
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

      // Vérification quota (même logique que `accept`) — vérification atomique via RPC
      if (response === "accept") {
        const quotaResult = await (async () => {
          try {
            const [urRes, prRes] = await Promise.all([
              fetch(`${SUPABASE_URL}/auth/v1/admin/users/${caller.id}`, { headers }),
              fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=missions_completed_month,trial_exhausted,plan_abonnement`, { headers }),
            ]);
            const urData = await urRes.json();
            const prData = await prRes.json();
            const prProfile = Array.isArray(prData) && prData[0];
            // Le plan vient de `profiles`, jamais de user_metadata. À l'inscription,
            // le prestataire choisit son abonnement d'un simple appui — Premium ou Elite —
            // et cette valeur était écrite telle quelle dans user_metadata. Comme
            // `profiles.plan_abonnement` restait vide tant qu'aucun paiement n'avait eu
            // lieu, le repli sur user_metadata accordait le quota Elite (999 prestations)
            // à qui ne l'avait jamais payé. Seul le webhook Stripe renseigne `profiles`.
            let plan = prProfile?.plan_abonnement || "free";
            const endDate = urData.user_metadata?.subscription_end_date;
            const endDateMs = endDate ? new Date(endDate).getTime() : NaN;
            if (!isNaN(endDateMs) && plan !== "free" && endDateMs < Date.now()) {
              plan = "free";
              await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${caller.id}`, { method:"PUT", headers, body: JSON.stringify({ user_metadata: { plan_abonnement:"free", subscription_end_date:null } }) }).catch(()=>{});
              await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}`, { method:"PATCH", headers:{ ...headers, "Prefer":"return=minimal" }, body: JSON.stringify({ plan_abonnement:"free" }) }).catch(()=>{});
            }
            const trialExhausted = prProfile?.trial_exhausted === true;
            const basePlanLimit = await limitePlanMensuelle(plan, caller.id, SUPABASE_URL, headers);
            const limit = (trialExhausted && plan === "free") ? 0 : basePlanLimit;
            if (limit < 999) {
              const slotRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_prestataire_slot`, {
                method: "POST", headers,
                body: JSON.stringify({ p_prestataire_id: caller.id, p_limit: limit }),
              });
              const slots = slotRes.ok ? (await slotRes.json().catch(() => 0)) : 0;
              if (slots <= 0) return { error: `Limite atteinte — vous avez atteint votre limite de ${limit} prestation${limit > 1 ? "s" : ""}/mois pour votre plan ${plan}.`, limit_reached: true };
            }
            return null;
          } catch { return { error: "Erreur vérification limite plan", limit_reached: false }; }
        })();
        if (quotaResult) return res.status(403).json(quotaResult);
      }

      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&prestataire_id=eq.${caller.id}&status=eq.pending_acceptance&select=id,client_id,sector,metier,titre,acceptance_deadline,date,heure_debut,hours,stripe_payment_intent,montant_total,tarif_horaire,ville,adresse,tiers_declaration,prestataire_id`, { headers });
      const mData = await mr.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Prestation introuvable ou délai dépassé" });

      // Vérification serveur du délai d'acceptation (le contrôle frontend seul est insuffisant)
      if (mission.acceptance_deadline && mission.acceptance_deadline < new Date().toISOString()) {
        // Délai dépassé : le client sera remboursé par le cron d'expiration, qui
        // clôt la prestation. On ne la renvoie donc pas en « open » ici, ce qui
        // l'aurait rendue acceptable alors que le paiement va être rendu.
        await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ prestataire_id: null }),
        }).catch(() => {});
        return res.status(410).json({ error: "Le délai d'acceptation est dépassé. Le client va être remboursé et pourra vous solliciter à nouveau." });
      }

      // Vérification conflit de créneau — bloquer l'acceptation si le prestataire a déjà une mission ce jour/heure
      if (response === "accept") {
        const conflict = await checkPrestaireConflict(caller.id, mission.date, mission.heure_debut, mission.hours, SUPABASE_URL, headers, mission_id);
        if (conflict) {
          return res.status(409).json({ error: `Vous avez déjà une prestation assignée sur ce créneau (${mission.date} ${mission.heure_debut || ""}). Vous ne pouvez pas accepter deux prestations simultanées.` });
        }
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

      // Refus d'une demande directe : la prestation ne repart pas en « open » avec
      // l'argent du client toujours bloqué. Elle passe en « refused » et le client
      // est remboursé, conformément à ce que lui annonce l'écran d'attente
      // (« votre paiement est intégralement remboursé ») et au parcours qui lui
      // propose ensuite un autre prestataire.
      const patchBody = response === "accept"
        ? { status: "assigned" }
        : { status: "refused", prestataire_id: null };
      const respondPatch = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&status=eq.pending_acceptance`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=representation", "Accept": "application/json" },
        body: JSON.stringify(patchBody),
      });
      const respondedRows = await respondPatch.json().catch(() => []);
      if (!Array.isArray(respondedRows) || respondedRows.length === 0) {
        return res.status(409).json({ error: "La prestation n'est plus en attente — délai dépassé ou déjà assignée." });
      }

      // Prestation affectée par la plateforme (CGPS art. 5.2) : un refus n'annule
      // rien, il fait passer au candidat suivant. Le client n'a désigné personne, il
      // n'a donc pas à être renvoyé à la case départ ni remboursé d'une commande qui
      // tient toujours. À défaut de candidat, la prestation part en diffusion.
      let rembRefus = { ok: true, mode: "sans_objet" };
      let cascade = null;
      if (response !== "accept" && mission.tiers_declaration) {
        cascade = await affecterCandidatSuivant(mission, SUPABASE_URL, headers);
        console.log(`[respond_mission] refus sur prestation affectée ${mission_id} → ${cascade.mode}`);
      } else if (response !== "accept") {
        rembRefus = await rembourserPrestation(mission, SUPABASE_URL, headers, "refus-presta");
        if (!rembRefus.ok) console.error(`[respond_mission] remboursement à reprendre manuellement — prestation ${mission_id}`);
      }

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
            // Sur une prestation affectée par la plateforme, le client n'a désigné
            // personne : lui annoncer un « refus » et l'inviter à choisir quelqu'un
            // d'autre n'aurait aucun sens. On lui dit ce qui se passe réellement.
            title: isAccepted ? "Prestation acceptée ! 🎉"
              : cascade ? "Recherche d'un autre prestataire 🔄" : "Prestation refusée",
            body: isAccepted
              ? `${resolvedPrestaName} a accepté votre demande de mission.`
              : cascade
                ? (cascade.mode === "affectation"
                    ? "Le prestataire pressenti n'est pas disponible. Un autre professionnel correspondant à votre mission vient d'être sollicité — votre réservation et votre paiement sont conservés."
                    : "Le prestataire pressenti n'est pas disponible. Votre mission a été proposée à l'ensemble des professionnels du secteur — votre réservation et votre paiement sont conservés.")
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

        const RESEND_KEY  = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
        const RESEND_FROM = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
        if (RESEND_KEY && clientEmail) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
            body: resendBody({
              from: RESEND_FROM,
              to: [clientEmail],
              subject: isAccepted ? `✅ ${resolvedPrestaName} a accepté la prestation !` : `❌ ${resolvedPrestaName} a refusé la prestation`,
              html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
                <h2 style="color:${isAccepted?"#10D98F":"#F25E5E"};margin:0 0 12px">${isAccepted?"Prestation acceptée ✅":"Prestation refusée ❌"}</h2>
                <p>Bonjour ${esc(clientName)},</p>
                ${isAccepted
                  ? `<p><strong>${esc(resolvedPrestaName)}</strong> a accepté votre demande de prestation <strong>${esc(missionLabel)}</strong>.</p><p>Connectez-vous à ALANE pour suivre la prestation.</p>`
                  : `<p><strong>${esc(resolvedPrestaName)}</strong> a décliné votre prestation <strong>${esc(missionLabel)}</strong>.</p><p>Connectez-vous à ALANE pour choisir un autre prestataire.</p>`
                }
                <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
              </div>`,
            }),
          }).catch(() => {});
        }

        const BREVO_KEY = (process.env.BREVO_API_KEY || "").replace(/\s/g, "");
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
                  ? `ALANE - ${resolvedPrestaName} a accepté votre prestation ${missionLabel}. Connectez-vous pour suivre. — alane.fr`
                  : `ALANE - ${resolvedPrestaName} a refusé votre prestation ${missionLabel}. Connectez-vous pour choisir un autre prestataire. — alane.fr`),
              }),
            }).catch(() => {});
          }
        }

        // Web push client
        const pushTitle = isAccepted ? "Prestation acceptée ✅" : "Prestation refusée";
        const pushBody  = isAccepted
          ? `${resolvedPrestaName} a accepté votre demande de mission.`
          : `${resolvedPrestaName} a refusé. Connectez-vous pour choisir un autre prestataire.`;
        sendPushToUser(mission.client_id, { title: pushTitle, body: pushBody, url: "/" }, SUPABASE_URL, headers).catch(() => {});
      }

      // Reminder notification to prestataire when they accept
      if (response === "accept") {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ user_id: caller.id, type: "mission", title: "Rappel : signalez votre arrivée 📍", body: `N'oubliez pas de cliquer « Je suis sur place » dans l'app dès que vous arrivez pour la prestation ${mission.titre || mission.metier || ""}.`, read: false }),
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
        ? `✅ ${presta_name || "Votre prestataire"} a accepté la prestation !`
        : `❌ ${presta_name || "Le prestataire"} a refusé la prestation`;
      const smsText = smsClean(isAccepted
        ? `ALANE - ${presta_name || "Votre prestataire"} a accepté votre prestation ${mission_label || ""}. Connectez-vous pour suivre la prestation. — alane.fr`
        : `ALANE - ${presta_name || "Le prestataire"} a refusé votre prestation ${mission_label || ""}. Connectez-vous pour choisir un autre prestataire. — alane.fr`);

      const RESEND_KEY  = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
      const RESEND_FROM = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
      if (RESEND_KEY && clientEmail) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: resendBody({
            from: RESEND_FROM,
            to: [clientEmail],
            subject,
            html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
              <h2 style="color:${isAccepted?"#10D98F":"#F25E5E"};margin:0 0 12px">${isAccepted?"Prestation acceptée ✅":"Prestation refusée ❌"}</h2>
              <p>Bonjour ${esc(clientName)},</p>
              ${isAccepted
                ? `<p><strong>${esc(presta_name || "Votre prestataire")}</strong> a accepté votre demande de prestation <strong>${esc(mission_label || "")}</strong>.</p><p>Connectez-vous à ALANE pour suivre la prestation.</p>`
                : `<p><strong>${esc(presta_name || "Le prestataire")}</strong> a décliné votre demande pour la prestation <strong>${esc(mission_label || "")}</strong>.</p><p>Connectez-vous à ALANE pour choisir un autre prestataire.</p>`
              }
              <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
            </div>`,
          }),
        }).catch(() => {});
      } else {
        console.log("[notify_client] email skipped — RESEND_KEY:", !!RESEND_KEY, "hasEmail:", !!clientEmail);
      }

      const BREVO_KEY = (process.env.BREVO_API_KEY || "").replace(/\s/g, "");
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
      const sLabel = esc(mission_label || "Prestation");
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

      // Notification in-app (S-06) : insérée ici en service role, après la
      // vérification ci-dessus que l'appelant est bien le client de cette mission.
      // Le front l'insérait lui-même, ce qui obligeait à laisser la policy
      // notifs_insert ouverte à tout compte connecté.
      const delaiTexte = payload.same_day ? "1 heure" : "4 heures";
      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
        method: "POST",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          user_id: prestataire_id,
          type:    "prestation",
          title:   "Nouvelle demande de prestation",
          body:    `Un client vous propose une prestation. Vous avez ${delaiTexte} pour accepter ou refuser.`,
          read:    false,
        }),
      }).catch(e => console.error("[notify_prestataire] insertion notification échouée :", e.message));

      const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${prestataire_id}`, { headers });
      const ud = await ur.json();
      const prestaEmail = ud.email;
      const phone = ud.user_metadata?.telephone;
      const prestaName = ud.user_metadata?.prenom || "Prestataire";

      const RESEND_KEY  = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
      const RESEND_FROM = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
      if (!RESEND_KEY) console.error("[notify_prestataire] RESEND_API_KEY absente — email au prestataire NON envoyé.");
      if (!prestaEmail) console.error("[notify_prestataire] aucune adresse email pour ce prestataire — email NON envoyé.");
      if (RESEND_KEY && prestaEmail) {
        // Generate one-click action tokens (valid 24h)
        const EMAIL_SECRET = (process.env.BO_SESSION_SECRET || "").replace(/\s/g, "");
        let acceptUrl = `${(process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr"}/api/missions?action=accept&m=${missionId}&p=${prestataire_id}`;
        let refuseUrl = `${(process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr"}/api/missions?action=refuse&m=${missionId}&p=${prestataire_id}`;
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
          body: resendBody({
            from: RESEND_FROM,
            to: [prestaEmail],
            subject: "🔔 Nouvelle demande de prestation — répondez rapidement !",
            // Version texte : sans elle, l'email part en HTML seul, ce qui pèse
            // lourd dans le classement en spam. Les liens d'acceptation et de
            // refus y sont repris en clair pour rester utilisables.
            text: `Nouvelle demande de prestation sur ALANE\n\n${sLabel} — ${sVille}\n${sDate}${sHdeb ? " à " + sHdeb : ""}\n${sHours} h${sTarif ? " · " + sTarif + " EUR/h" : ""}\n${sAdresse ? sAdresse + "\n" : ""}\nAccepter : ${acceptUrl}\nRefuser : ${refuseUrl}\n\nCes liens sont valables 24 h.\nL'équipe ALANE`,
            html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
              <h2 style="color:#A29BFE;margin:0 0 12px">Nouvelle demande de prestation 🔔</h2>
              <p>Bonjour ${esc(prestaName)},</p>
              <p>Un client vous a envoyé une demande de prestation directe :</p>
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

      const BREVO_KEY = (process.env.BREVO_API_KEY || "").replace(/\s/g, "");
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
              content: smsClean(`ALANE - Demande de prestation : ${mission_label || "Prestation"} le ${date || "?"} à ${ville || "?"} (${hours || "?"}h). Connectez-vous pour répondre ! — alane.fr`),
            }),
          }).then(r => r.json()).then(d => console.log("[notify_prestataire] SMS:", JSON.stringify(d))).catch(e => console.log("[notify_prestataire] SMS error:", e.message));
        }
      } else {
        console.log("[notify_prestataire] SMS skipped — BREVO_KEY:", !!BREVO_KEY, "hasPhone:", !!phone);
      }

      // Web push (si souscription existante)
      sendPushToUser(prestataire_id, {
        title: "🔔 Nouvelle prestation pour vous",
        body: `${mission_label || "Prestation"}${date ? " · " + date : ""}${ville ? " · " + ville : ""}${hours ? " (" + hours + "h)" : ""}`,
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
      if (!mission) return res.status(404).json({ error: "Prestation introuvable ou non active" });

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
          const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
          const RESEND_FROM = process.env.RESEND_FROM || "ALANE <no-reply@alane.fr>";
          if (prestaEmail && RESEND_API_KEY) {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
              body: resendBody({
                from: RESEND_FROM,
                to: [prestaEmail],
                subject: "⏱ Demande d'heures supplémentaires",
                html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;background:#0A1628;color:#fff;padding:32px;border-radius:16px">
                  <h2 style="color:#A29BFE;margin:0 0 12px">⏱ Heures supplémentaires demandées</h2>
                  <p>Le client souhaite prolonger la prestation de <strong style="color:#fff">${eh}h supplémentaire${eh > 1 ? "s" : ""}</strong>.</p>
                  <p style="margin-top:12px">Ouvrez l'application pour accepter ou refuser cette demande :</p>
                  <p style="margin-top:16px"><a href="${(process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr"}" style="display:inline-block;background:#10D98F;color:#fff;text-decoration:none;padding:13px 24px;border-radius:10px;font-weight:700;font-size:15px">Ouvrir ALANE</a></p>
                  <p style="margin-top:24px;color:rgba(255,255,255,0.5);font-size:12px">L'équipe ALANE · <a href="https://www.alane.fr" style="color:#7C6FE0;text-decoration:none;">www.alane.fr</a></p>
                </div>`,
              }),
            });
          }
        } catch(e) {}

        // Web push au prestataire
        sendPushToUser(mission.prestataire_id, {
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
      if (!mission) return res.status(404).json({ error: "Prestation introuvable ou non active" });
      const extraH = Number(mission.extra_hours_requested || 0);

      if (response === "accept" && extraH > 0) {
        // Mettre à jour les heures totales et marquer accepté — cap à 24h
        const newHours = Math.min(24, Number(mission.hours || 0) + extraH);
        await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
          method: "PATCH",
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ hours: newHours, actual_hours: null, extra_hours_status: "accepted", extra_hours_requested: null }),
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
        sendPushToUser(mission.client_id, {
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

      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&prestataire_id=eq.${caller.id}&status=in.(assigned,pending_acceptance)&select=id,client_id,metier,titre,stripe_payment_intent,montant_total,heure_debut,sector,date,ville,hours`, { headers });
      const mData = await mr.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Prestation introuvable ou non annulable" });

      // Remboursement si la mission était payée — abort si le refund échoue
      if (mission.stripe_payment_intent) {
        const isWalletPaidPresta = mission.stripe_payment_intent.startsWith("wallet_");
        if (isWalletPaidPresta) {
          // Remboursement intégral sur le wallet du client
          const refundAmountEuros = Number(mission.montant_total) || 0;
          if (refundAmountEuros > 0 && mission.client_id) {
            try {
              const profR = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${mission.client_id}&select=prepaid_balance`, { headers });
              const profData = await profR.json().catch(() => []);
              const currentBal = Number(Array.isArray(profData) && profData[0]?.prepaid_balance || 0);
              const newBal = Math.round((currentBal + refundAmountEuros) * 100) / 100;
              await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${mission.client_id}`, {
                method: "PATCH",
                headers: { ...headers, "Prefer": "return=minimal" },
                body: JSON.stringify({ prepaid_balance: newBal }),
              });
            } catch (e) {
              console.error("[presta_cancel] wallet refund failed:", e.message);
            }
          }
        } else {
          if (!(process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "")) {
            return res.status(500).json({ error: "Stripe non configuré — la prestation n'a pas été annulée. Contactez le support." });
          }
          try {
            const refundRes = await fetch("https://api.stripe.com/v1/refunds", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${(process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "")}`,
                "Content-Type": "application/x-www-form-urlencoded",
                "Idempotency-Key": `refund-presta-cancel-${mission_id}`,
              },
              body: new URLSearchParams({
                payment_intent: mission.stripe_payment_intent,
                reason: "requested_by_customer",
              }).toString(),
            });
            const refundData = await refundRes.json();
            if (refundData.id) {
              console.log(`[presta_cancel] Remboursement Stripe OK: ${refundData.id} pour prestation ${mission_id}`);
            } else {
              console.error(`[presta_cancel] Remboursement Stripe échoué:`, JSON.stringify(refundData));
              return res.status(500).json({ error: "Le remboursement Stripe a échoué — la prestation n'a pas été annulée. Contactez le support." });
            }
          } catch (stripeErr) {
            console.error(`[presta_cancel] Erreur appel Stripe refund:`, stripeErr.message);
            return res.status(500).json({ error: "Le remboursement Stripe a échoué — la prestation n'a pas été annulée. Contactez le support." });
          }
        }
      }

      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "needs_replacement", prestataire_id: null }),
      });

      // Recherche d'un remplaçant. L'écran client annonce « nous recherchons un
      // remplaçant » : jusqu'ici personne n'était prévenu, la prestation devenait
      // seulement visible sur la place de marché. Trois canaux, dosés selon
      // l'urgence : notification et push pour tous les prestataires du secteur,
      // SMS réservé aux désistements de dernière minute.
      try {
        const libelle = mission.titre || mission.metier || "Prestation";
        const quand = [mission.date, mission.heure_debut ? String(mission.heure_debut).replace(":", "h") : null].filter(Boolean).join(" à ");
        const corps = `Une prestation « ${libelle} »${mission.ville ? " à " + mission.ville : ""}${quand ? " le " + quand : ""} cherche un prestataire : celui qui était prévu s'est désisté.`;

        // Urgence : la prestation a-t-elle lieu dans moins de 24 h ?
        let urgent = false;
        if (mission.date) {
          const [uh, um] = String(mission.heure_debut || "08:00").split(":").map(Number);
          const debutMs = new Date(`${mission.date}T${String(uh).padStart(2,"0")}:${String(um).padStart(2,"0")}:00`).getTime();
          urgent = debutMs - Date.now() < 24 * 3600000;
        }

        const candRes = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?role=eq.prestataire&status=eq.approved&id=neq.${caller.id}&select=id`,
          { headers }
        );
        const candidats = candRes.ok ? await candRes.json().catch(() => []) : [];

        // Métadonnées en lot pour filtrer par secteur — même approche que broadcast
        const metaMap = {};
        let pageMeta = 1;
        while (pageMeta <= 10) {
          const bRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000&page=${pageMeta}`, { headers });
          const bData = await bRes.json().catch(() => ({}));
          const lot = bData.users || [];
          for (const u of lot) metaMap[u.id] = u;
          if (lot.length < 1000) break;
          pageMeta++;
        }

        const cibles = (Array.isArray(candidats) ? candidats : []).filter(c => {
          const meta = metaMap[c.id]?.user_metadata || {};
          const secteurPresta = meta.secteur || meta.sector;
          // Sans secteur renseigné côté prestataire, on ne l'exclut pas : mieux vaut
          // une notification de trop qu'une prestation qui ne trouve personne.
          return !mission.sector || !secteurPresta || secteurPresta === mission.sector;
        });

        if (cibles.length) {
          await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
            method: "POST",
            headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify(cibles.map(c => ({
              user_id: c.id, type: "mission",
              title: urgent ? "Prestation urgente à reprendre 🔄" : "Prestation à reprendre 🔄",
              body: `${corps} Consultez les prestations disponibles.`,
              read: false,
            }))),
          }).catch(e => console.error("[presta_cancel] notifications remplaçants :", e.message));

          // Push : gratuit, et atteint le téléphone application fermée.
          await Promise.all(cibles.map(c => sendPushToUser(c.id, {
            title: urgent ? "🔄 Prestation urgente à reprendre" : "🔄 Prestation à reprendre",
            body: corps,
            url: "/",
          }, SUPABASE_URL, headers).catch(() => {})));

          // Prestataires réellement en mesure de prendre la prestation : même
          // métier, et disponibles ce jour-là. Ce filtre commande les deux canaux
          // sortants (email et SMS). Notification et push restent larges, au
          // niveau du secteur : ils ne coûtent rien et n'encombrent pas de boîte.
          const JOURS_FR = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
          const jourPrestation = mission.date
            ? JOURS_FR[new Date(`${mission.date}T12:00:00`).getDay()]
            : null;

          const eligibles = cibles.filter(c => {
            const meta = metaMap[c.id]?.user_metadata || {};
            // Métier : le principal ou l'un de ceux déclarés dans metiers_list
            const metiersPresta = [
              meta.metier,
              ...(Array.isArray(meta.metiers_list) ? meta.metiers_list.map(x => x?.metier) : []),
            ].filter(Boolean);
            if (mission.metier && !metiersPresta.includes(mission.metier)) return false;
            // Disponibilité déclarée pour ce jour de la semaine, exigée
            // explicitement : sans elle, on ne sollicite personne à l'extérieur.
            if (jourPrestation) {
              const jours = Array.isArray(meta.dispon_jours) ? meta.dispon_jours : [];
              if (!jours.includes(jourPrestation)) return false;
            }
            return true;
          });

          // EMAIL — toujours, pour les prestataires éligibles. C'est le canal de
          // référence hors urgence : il ne coûte rien et laisse une trace
          // consultable. Restreint aux éligibles, car un email hors sujet dégrade
          // la réputation du domaine d'envoi et fait basculer les suivants en spam.
          const RESEND_KEY_R = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
          const RESEND_FROM_R = process.env.RESEND_FROM || "ALANE <onboarding@resend.dev>";
          const APP_URL_R = (process.env.APP_URL || "").replace(/\s/g, "") || "https://www.alane.fr";
          if (RESEND_KEY_R) {
            const avecEmail = eligibles.filter(c => metaMap[c.id]?.email);
            const htmlMail = `<div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0A1628;color:#fff;padding:28px;border-radius:16px">
              <h2 style="color:#7C6FE0;margin:0 0 14px;font-size:19px">${urgent ? "Prestation urgente à reprendre" : "Prestation à reprendre"}</h2>
              <p style="color:rgba(255,255,255,0.85);line-height:1.7;margin:0 0 18px">Le prestataire prévu s'est désisté. Cette prestation correspond à votre métier et à vos disponibilités :</p>
              <table style="width:100%;color:rgba(255,255,255,0.85);font-size:14px;border-collapse:collapse">
                <tr><td style="padding:5px 0;color:rgba(255,255,255,0.5)">Prestation</td><td style="font-weight:700">${esc(libelle)}</td></tr>
                ${mission.ville ? `<tr><td style="padding:5px 0;color:rgba(255,255,255,0.5)">Lieu</td><td style="font-weight:700">${esc(mission.ville)}</td></tr>` : ""}
                ${quand ? `<tr><td style="padding:5px 0;color:rgba(255,255,255,0.5)">Date</td><td style="font-weight:700">${esc(quand)}</td></tr>` : ""}
                ${mission.hours ? `<tr><td style="padding:5px 0;color:rgba(255,255,255,0.5)">Durée</td><td style="font-weight:700">${esc(String(mission.hours))} h</td></tr>` : ""}
              </table>
              <div style="text-align:center;margin:26px 0 8px">
                <a href="${APP_URL_R}" style="display:inline-block;background:#7C6FE0;color:#fff;font-weight:700;padding:13px 30px;border-radius:10px;text-decoration:none">Voir la prestation →</a>
              </div>
              <p style="color:rgba(255,255,255,0.4);font-size:12px;text-align:center;margin:16px 0 0">Premier positionné, premier servi.</p>
            </div>`;
            const texteMail = `${urgent ? "Prestation urgente a reprendre" : "Prestation a reprendre"}\n\n`
              + `Le prestataire prevu s'est desiste. Cette prestation correspond a votre metier et a vos disponibilites.\n\n`
              + `Prestation : ${libelle}\n${mission.ville ? "Lieu : " + mission.ville + "\n" : ""}${quand ? "Date : " + quand + "\n" : ""}${mission.hours ? "Duree : " + mission.hours + " h\n" : ""}`
              + `\nVoir la prestation : ${APP_URL_R}\n\nPremier positionne, premier servi.\nL'equipe ALANE`;
            await Promise.all(avecEmail.map(c => fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Authorization": `Bearer ${RESEND_KEY_R}`, "Content-Type": "application/json" },
              body: resendBody({
                from: RESEND_FROM_R,
                to: [metaMap[c.id].email],
                subject: urgent
                  ? `Prestation urgente à reprendre — ${libelle}${mission.ville ? " · " + mission.ville : ""}`
                  : `Prestation à reprendre — ${libelle}${mission.ville ? " · " + mission.ville : ""}`,
                html: htmlMail,
                text: texteMail,
              }),
            }).catch(e => console.error("[presta_cancel] email remplaçant :", e.message))));
            console.log(`[presta_cancel] email remplaçant : ${avecEmail.length} envoyé(s)`);
          }

          // SMS — uniquement à moins de 24 h de la prestation, et aux mêmes
          // éligibles. Le SMS est facturé et intrusif : hors urgence, l'email et
          // le push suffisent.
          if (urgent) {
            const BREVO = (process.env.BREVO_API_KEY || "").replace(/\s/g, "");
            if (BREVO) {
              const avecTel = eligibles.filter(c => metaMap[c.id]?.user_metadata?.telephone);
              if (avecTel.length) {
                const texte = smsClean(`ALANE - Prestation a reprendre : ${libelle}${mission.ville ? " a " + mission.ville : ""}${quand ? " le " + quand : ""}. Le prestataire prevu s'est desiste. Connectez-vous pour la reprendre. alane.fr`);
                await Promise.all(avecTel.map(c => fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
                  method: "POST",
                  headers: { "api-key": BREVO, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    sender: "ALANE",
                    recipient: String(metaMap[c.id].user_metadata.telephone).replace(/[^0-9+]/g, ""),
                    content: texte,
                  }),
                }).catch(() => {})));
              }
              console.log(`[presta_cancel] SMS remplaçant : ${avecTel.length} envoyé(s) sur ${eligibles.length} éligible(s), ${cibles.length} notifié(s)`);
            }
          }
        }
      } catch (e) {
        console.error("[presta_cancel] recherche de remplaçant échouée :", e.message);
      }

      // Rejeter la candidature acceptée du prestataire qui annule
      await fetch(`${SUPABASE_URL}/rest/v1/candidatures?mission_id=eq.${mission_id}&prestataire_id=eq.${caller.id}&status=eq.accepted`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "rejected" }),
      }).catch(() => {});

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
        sendPushToUser(mission.client_id, {
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

      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&prestataire_id=eq.${caller.id}&status=eq.assigned&select=id,client_id,metier,titre,arrived_at,started_at,date,heure_debut,delay_status,arrival_delay_minutes`, { headers });
      const mData = await mr.json();
      const m = Array.isArray(mData) && mData[0];
      if (!m) return res.status(404).json({ error: "Prestation introuvable ou non assignée" });
      if (m.started_at) return res.status(200).json({ started_at: m.started_at }); // already started

      // Only allow start within [H-5min … H+2h] — rejects stale auto-start calls
      if (m.date && m.heure_debut) {
        try {
          const [h2, mn2] = m.heure_debut.split(":").map(Number);
          const missionStartNaive2 = new Date(`${m.date}T${String(h2).padStart(2,"0")}:${String(mn2||0).padStart(2,"0")}:00`);
          const missionStartUTC2 = new Date(missionStartNaive2.getTime() + frenchOffsetMs(missionStartNaive2));
          const now = Date.now();
          if (now < missionStartUTC2.getTime() - 5 * 60 * 1000) {
            return res.status(400).json({ error: "Trop tôt pour démarrer la prestation (disponible 5 minutes avant l'heure prévue)" });
          }
          if (now > missionStartUTC2.getTime() + 2 * 60 * 60 * 1000) {
            return res.status(400).json({ error: "Fenêtre de démarrage expirée" });
          }
        } catch(e) { /* date parse failed — allow */ }
      }
      // Require prestataire to have checked in first
      if (!m.arrived_at) {
        return res.status(400).json({ error: "Vous devez d'abord confirmer votre arrivée sur place" });
      }

      const startedAt = new Date().toISOString();

      // Retard au démarrage. Le décalage n'était mesuré qu'au pointage d'arrivée :
      // un prestataire arrivé à l'heure puis démarrant 36 minutes plus tard décalait
      // la fin d'autant, en silence et sans que le client ait son mot à dire. C'est
      // pourtant le démarrage qui détermine la fin, donc le service réellement rendu.
      const patchStart = { started_at: startedAt };
      if (m.date && m.heure_debut && m.delay_status !== "approved") {
        try {
          const [hd, md] = String(m.heure_debut).split(":").map(Number);
          const prevuNaive = new Date(`${m.date}T${String(hd).padStart(2,"0")}:${String(md||0).padStart(2,"0")}:00`);
          const prevuMs = prevuNaive.getTime() + frenchOffsetMs(prevuNaive);
          const retardDemarrage = Math.round((new Date(startedAt).getTime() - prevuMs) / 60000);
          // On retient le décalage le plus défavorable au client : celui de l'arrivée
          // ou celui du démarrage, sans jamais l'effacer.
          const retardRetenu = Math.max(retardDemarrage, Number(m.arrival_delay_minutes) || 0);
          if (retardDemarrage > 15 && retardRetenu > (Number(m.arrival_delay_minutes) || 0)) {
            patchStart.arrival_delay_minutes = retardRetenu;
            patchStart.delay_status = "pending";
            console.log(`[start_mission] retard de ${retardDemarrage} min sur ${mission_id} — accord du client requis`);
          }
        } catch (e) {
          console.error("[start_mission] calcul du retard impossible :", e.message);
        }
      }

      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify(patchStart),
      });

      // Le client est prévenu séparément : sans accord de sa part, la prestation
      // s'arrête à l'heure de fin initialement prévue.
      if (patchStart.delay_status === "pending" && m.client_id) {
        const labelR = m.titre || m.metier || "votre prestation";
        const corpsR = `Le prestataire a démarré « ${labelR} » avec ${patchStart.arrival_delay_minutes} min de retard. `
          + `Sans votre accord, la prestation prendra fin à l'heure initialement prévue.`;
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST", headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({ user_id: m.client_id, type: "mission", title: "⏰ Démarrage en retard", body: corpsR, read: false }),
        }).catch(() => {});
        sendPushToUser(m.client_id, { title: "⏰ Démarrage en retard", body: corpsR, url: "/" }, SUPABASE_URL, headers).catch(() => {});
      }

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
        sendPushToUser(m.client_id, { title: notifTitle, body: notifBody, url: "/" }, SUPABASE_URL, headers).catch(() => {});
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
      if (!mission) return res.status(404).json({ error: "Prestation introuvable ou non éligible au litige" });

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
      const ticketSubject = `⚠️ Litige — Prestation : ${label} (${mission.date || ""})`;
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
      const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").replace(/\s/g, "");
      const RESEND_FROM = process.env.RESEND_FROM || "ALANE <no-reply@alane.fr>";
      const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
      if (RESEND_API_KEY && ADMIN_EMAIL) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: resendBody({
            from: RESEND_FROM,
            to: ADMIN_EMAIL,
            subject: ticketSubject,
            html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;background:#f4f4f7;border-radius:12px"><h2 style="color:#c0392b">⚠️ Litige Client</h2><pre style="font-size:14px;line-height:1.6">${ticketMessage}</pre></div>`,
          }),
        }).catch(e => console.error("[raise_dispute] admin email failed:", e.message));
      }

      return res.status(200).json({ success: true });
    }

    // Notifie les deux parties quand le timer de mission atteint zéro, puis toutes les 2h
    if (action === "notify_end") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });
      const { mission_id } = payload;
      if (!mission_id || !isUuid(mission_id)) return res.status(400).json({ error: "mission_id requis" });

      const mr = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=id,client_id,prestataire_id,status,metier,sector,date,hours,actual_hours,started_at,validation_prestataire,validation_client,last_validation_reminder_at`, { headers });
      const mData = await mr.json();
      const m = Array.isArray(mData) && mData[0];
      if (!m) return res.status(404).json({ error: "Prestation introuvable" });
      if (m.client_id !== caller.id && m.prestataire_id !== caller.id) return res.status(403).json({ error: "Non autorisé" });
      if (m.status !== "assigned") return res.status(400).json({ error: "Prestation non en cours" });
      if (!m.started_at) return res.status(400).json({ error: "Prestation non démarrée" });

      const effectiveHours = m.actual_hours ?? m.hours ?? 1;
      const endMs = new Date(m.started_at).getTime() + Number(effectiveHours) * 3600000;
      if (endMs > Date.now() + 30000) return res.status(400).json({ error: "Prestation pas encore terminée" });

      // Dedup : pas plus d'une notification toutes les 2h
      if (m.last_validation_reminder_at) {
        const lastMs = new Date(m.last_validation_reminder_at).getTime();
        if (Date.now() - lastMs < 2 * 3600000) return res.status(200).json({ skipped: true });
      }

      const label = m.metier || m.sector || "la prestation";
      const notifs = [];
      if (!m.validation_prestataire && m.prestataire_id) {
        notifs.push(fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{ ...headers, "Prefer":"return=minimal" }, body: JSON.stringify({ user_id: m.prestataire_id, type:"mission", title:"⏱ Prestation terminée — confirmez !", body:`Votre prestation « ${label} » du ${m.date} est terminée. Confirmez pour recevoir votre paiement.`, read:false }) }));
        sendPushToUser(m.prestataire_id, { title:"⏱ Prestation terminée — confirmez !", body:`« ${label} » du ${m.date} — confirmez pour être payé(e).`, url:"/" }, SUPABASE_URL, headers).catch(() => {});
      }
      if (!m.validation_client && m.client_id) {
        notifs.push(fetch(`${SUPABASE_URL}/rest/v1/notifications`, { method:"POST", headers:{ ...headers, "Prefer":"return=minimal" }, body: JSON.stringify({ user_id: m.client_id, type:"mission", title:"✅ Prestation terminée — validez !", body:`Votre prestation « ${label} » du ${m.date} est terminée. Validez pour créditer votre cashback.`, read:false }) }));
        sendPushToUser(m.client_id, { title:"✅ Prestation terminée — validez !", body:`« ${label} » du ${m.date} — validez pour votre cashback.`, url:"/" }, SUPABASE_URL, headers).catch(() => {});
      }
      await Promise.all(notifs.map(p => p.catch(() => {})));
      await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}`, {
        method:"PATCH", headers:{ ...headers, "Prefer":"return=minimal" },
        body: JSON.stringify({ last_validation_reminder_at: new Date().toISOString() }),
      }).catch(() => {});

      return res.status(200).json({ notified: notifs.length });
    }

    // Vérifie et répare le plan + trial_exhausted en interrogeant Stripe
    if (action === "refresh_plan") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) { console.error("[refresh_plan] verifyUser failed — token invalide ou absent"); return res.status(401).json({ error: "Non authentifié" }); }

      const prRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=plan_abonnement,trial_exhausted,stripe_subscription_id,stripe_customer_id`, { headers });
      const prData = await prRes.json();
      const profile = Array.isArray(prData) && prData[0];
      if (!profile) { console.error("[refresh_plan] profil introuvable pour", caller.id, "prData:", JSON.stringify(prData)); return res.status(404).json({ error: "Profil introuvable" }); }

      // Le plan part de `profiles` et ne peut être relevé que par Stripe, plus bas.
      //
      // Cette action retenait le plus élevé entre `profiles` et `user_metadata`, puis
      // l'inscrivait dans `profiles`. Or user_metadata reçoit le plan choisi d'un
      // simple appui à l'inscription, sans paiement : il suffisait de sélectionner
      // Elite au moment de créer son compte pour que cette « réparation » accorde
      // définitivement 999 prestations par mois, le badge Elite et la première place
      // dans les résultats — sans jamais rien régler.
      //
      // Seuls le webhook Stripe, la vérification directe ci-dessous et le forçage
      // depuis le backoffice peuvent accorder un plan payant.
      let plan = profile.plan_abonnement || "free";
      console.log(`[refresh_plan] user=${caller.id} profil=${plan}`);
      let trialExhausted = !!profile.trial_exhausted;

      // Vérification Stripe directe si un abonnement existe
      const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
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
            }
            // Ne pas dégrader sur annulation Stripe — le webhook gère la rétrogradation.
            // Un plan défini manuellement via BO doit primer sur un abonnement Stripe annulé.
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

      // La limite effective est renvoyée au front, qui la devinait à partir d'une
      // constante : le plan gratuit y annonce 10 prestations alors que `plan_limits`
      // en accorde 2 hors offre de lancement. Un prestataire aurait donc lu « 2/10 »
      // en étant déjà bloqué. Le calcul du quota vit ici, l'affichage le suit.
      const limiteMensuelle = await limitePlanMensuelle(plan, caller.id, SUPABASE_URL, headers);
      return res.status(200).json({ plan, trial_exhausted: trialExhausted, limite_mensuelle: limiteMensuelle });
    }

    // ── Annuler l'abonnement Stripe (fin de période) ─────────────────────────
    if (action === "cancel_subscription") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });

      const prRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=stripe_subscription_id,stripe_customer_id,plan_abonnement`, { headers });
      const prData = await prRes.json();
      const profile = Array.isArray(prData) && prData[0];
      if (!profile) return res.status(404).json({ error: "Profil introuvable" });
      if (!profile.stripe_subscription_id) return res.status(400).json({ error: "Aucun abonnement actif trouvé" });

      const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY || "").replace(/\s/g, "");
      if (!STRIPE_KEY) return res.status(500).json({ error: "Configuration Stripe manquante" });

      const cancelRes = await fetch(`https://api.stripe.com/v1/subscriptions/${profile.stripe_subscription_id}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${STRIPE_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "cancel_at_period_end=true",
      });
      if (!cancelRes.ok) {
        const err = await cancelRes.json().catch(() => ({}));
        return res.status(500).json({ error: err?.error?.message || "Erreur Stripe lors de l'annulation" });
      }
      const sub = await cancelRes.json();
      const endDate = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
      return res.status(200).json({ success: true, cancel_at_period_end: true, current_period_end: endDate });
    }

    // ── Générer un token éphémère signé pour la facture (30 min) ─────────────
    // Évite d'exposer le JWT Supabase en query string (logs Vercel, historique browser, Referer)
    if (action === "generate_invoice_token") {
      const caller = await verifyUser(req, SUPABASE_URL, SERVICE_ROLE_KEY);
      if (!caller) return res.status(401).json({ error: "Non authentifié" });

      const { mission_id } = payload;
      if (!mission_id || !/^[0-9a-f-]{36}$/i.test(mission_id)) {
        return res.status(400).json({ error: "mission_id invalide" });
      }

      const mRes = await fetch(`${SUPABASE_URL}/rest/v1/missions?id=eq.${mission_id}&select=client_id,prestataire_id`, { headers });
      const mData = await mRes.json();
      const mission = Array.isArray(mData) && mData[0];
      if (!mission) return res.status(404).json({ error: "Prestation introuvable" });
      if (mission.client_id !== caller.id && mission.prestataire_id !== caller.id) {
        return res.status(403).json({ error: "Accès interdit" });
      }

      const secret = (process.env.BO_SESSION_SECRET || "").replace(/\s/g, "");
      if (!secret) return res.status(500).json({ error: "Configuration serveur manquante (BO_SESSION_SECRET)" });

      const exp = Math.floor(Date.now() / 1000) + 1800; // 30 min
      const data2sign = `${caller.id}.${mission_id}.${exp}`;
      const sig = crypto.createHmac("sha256", secret).update(data2sign).digest("hex");
      return res.status(200).json({ token: `${data2sign}.${sig}`, exp });
    }

    return res.status(400).json({ error: "Action invalide" });
  } catch (e) {
    console.error("missions error:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
